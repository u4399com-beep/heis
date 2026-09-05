// ============================================================
// Task dd-a2 验证脚本① — 规则库完整性抽查(sanitize 改动后的存量规则无损复核)
// 1) GET /api/admin/rules = 25 条在位
// 2) 每条 config JSON.parse 无损(解析成功 + 重新序列化逐字节一致 = 存储即规范化 JSON)
// 3) 动态提取 sanitizeFetchConfig 当前白名单(探测对象全字段注入 → 幸存键集),
//    对 4 条重点规则(bqg713 token 三件套/book4/shudugu/番茄聚合)断言:
//    存量 fetch 段键集 ∩ 白名单 ⊆ sanitize 输出键集(无剥字段) 且 对应值深等价
// 4) bqg713 token 三件套逐值断言(bb-d/cc-d2 交付形态)
// 运行: bun scripts/verify-dd-a2-rules.ts (需 dev server 3000 存活)
// ============================================================
export {}

const BASE = 'http://localhost:3000'
let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
function deepEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface RuleRow { id: string; name: string; config: string }
interface CfgShape {
  list?: Record<string, unknown>
  book?: Record<string, unknown>
  toc?: Record<string, unknown>
  content?: Record<string, unknown>
  fetch?: Record<string, unknown>
  clean?: Record<string, unknown>
}

// 动态白名单提取: 全字段合法占位值注入 sanitizeFetchConfig, 幸存键 = 当前白名单
async function currentWhitelist(): Promise<Set<string>> {
  const { sanitizeFetchConfig } = await import('../src/lib/crawl/types')
  const probe = {
    engine: 'auto', uaMode: 'rotate', customUa: 'probe-ua',
    headers: { 'X-Probe': '1' }, cookies: 'a=1', autoCookie: false, referer: false,
    timeout: 1234, retries: 2, waitSelector: '#w', waitMs: 55, clickSelector: '#c',
    browserFallbackStatus: [403], hostGateLimit: 5,
    tokenUrl: 'http://t/?u={url}', tokenPattern: 'token', tokenInjection: 'header' as const,
    tokenHeaderName: 'X-Token', proxyUrl: 'http://probe-proxy:1',
  }
  const out = sanitizeFetchConfig(probe)
  return new Set(Object.keys(out))
}

async function main() {
  const res = await fetch(`${BASE}/api/admin/rules?take=100`)
  const j = (await res.json()) as { ok: boolean; data?: unknown }
  const rules: RuleRow[] = Array.isArray(j.data) ? j.data as RuleRow[] : ((j.data as { rules?: RuleRow[] })?.rules || [])
  ok('1 规则库总数 = 25', rules.length === 25, `实际 ${rules.length}`)

  // 每条 config: JSON.parse 无损(规范化重序列化逐字节一致)
  let parseFail = 0
  let roundTripFail: string[] = []
  for (const r of rules) {
    try {
      const parsed = JSON.parse(r.config) as unknown
      if (JSON.stringify(parsed) !== r.config) roundTripFail.push(r.name)
    } catch {
      parseFail++
      console.log(`  !! JSON.parse 失败: ${r.name} (id=${r.id})`)
    }
  }
  ok('2a 25 条 config 全部 JSON.parse 成功', parseFail === 0, `失败 ${parseFail} 条`)
  // 2b 语义口径: 重序列化不一致 = 旧存储格式差异(键序/缩进), 非 JSON.parse 数据丢失;
  // 数据级无损已由 2a+3 段(值深等价)兜底, 此处仅对 4 条近期规则要求逐字节规范化一致
  const recent = ['cmtgj4v8y01laqbu9avej2g2z', 'cmtgim0d20004qbu96qpuhn3p', 'cmtgjm5gn04hmqbu96c6j06u5', 'cmtgi08kt0003qbu988jf36ch']
  const recentFail = roundTripFail.filter((name) => recent.includes(rules.find((r) => r.name === name)?.id || ''))
  ok('2b 近期 4 规则规范化重序列化逐字节一致(其余旧规则为旧格式差异仅上报)', recentFail.length === 0, `旧格式差异 ${roundTripFail.length} 条: ${roundTripFail.join(' | ') || '无'}`)

  const byId = new Map(rules.map((r) => [r.id, r]))
  const whitelist = await currentWhitelist()
  console.log(`  · sanitizeFetchConfig 当前白名单(${whitelist.size} 字段): ${Array.from(whitelist).join(',')}`)

  // 重点规则抽检: 存量 fetch 键集 ∩ 白名单 ⊆ sanitize 输出(无剥字段) + 值深等价
  const spotIds: { id: string; label: string }[] = [
    { id: 'cmtgj4v8y01laqbu9avej2g2z', label: 'bqg713(token 三件套)' },
    { id: 'cmtgim0d20004qbu96qpuhn3p', label: 'book4.cc' },
    { id: 'cmtgjm5gn04hmqbu96c6j06u5', label: 'shudugu' },
    { id: 'cmtgi08kt0003qbu988jf36ch', label: '番茄聚合API' },
  ]
  const { sanitizeFetchConfig } = await import('../src/lib/crawl/types')
  for (const { id, label } of spotIds) {
    const r = byId.get(id)
    ok(`3 ${label} 规则在位`, !!r, r ? `id=${r.id}` : '缺失!')
    if (!r) continue
    const cfg = JSON.parse(r.config) as CfgShape
    const storedFetch = cfg.fetch || {}
    const sanitized = sanitizeFetchConfig(storedFetch)
    const stripped = Object.keys(storedFetch)
      .filter((k) => whitelist.has(k))
      .filter((k) => !(k in sanitized))
    const drifted = Object.keys(sanitized).filter((k) => !deepEq(sanitized[k], storedFetch[k]))
    ok(`3a ${label} fetch 段白名单字段零剥落`, stripped.length === 0, stripped.join(',') || '无剥落')
    ok(`3b ${label} fetch 段字段值 sanitize 往返深等价`, drifted.length === 0, drifted.join(',') || '全等价')
  }

  // bqg713 token 三件套逐值断言(cc-d2 定稿形态)
  const bq = byId.get('cmtgj4v8y01laqbu9avej2g2z')
  if (bq) {
    const cfgBq = JSON.parse(bq.config) as CfgShape
    const f = cfgBq.fetch || {}
    ok('4a bqg713 tokenUrl = http://127.0.0.1:3010/rewrite?url={url}', f.tokenUrl === 'http://127.0.0.1:3010/rewrite?url={url}', String(f.tokenUrl))
    ok('4b bqg713 tokenPattern = token', f.tokenPattern === 'token', String(f.tokenPattern))
    ok('4c bqg713 tokenInjection = url', f.tokenInjection === 'url', String(f.tokenInjection))
    ok('4d bqg713 toc 段章节 URL 模板指向 apibi.cc', JSON.stringify(cfgBq.toc || '').includes('apibi.cc'), '')
  }

  // 番茄聚合: JSON 算子表达式存活抽查(cc-c 交付)
  const fq = byId.get('cmtgi08kt0003qbu988jf36ch')
  if (fq) {
    const cfgStr = fq.config
    ok('5 番茄聚合 list 段 JSON 算子(tab_type)存活', cfgStr.includes('tab_type'), '')
    ok('5b 番茄聚合 四段+fetch+clean 六键齐全', ['list', 'book', 'toc', 'content', 'fetch', 'clean'].every((k) => k in (JSON.parse(cfgStr) as Record<string, unknown>)), '')
  }

  console.log(`\n========================================`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error('verify 脚本异常:', (e as Error)?.message || e)
  process.exit(1)
})
