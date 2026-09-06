// ============================================================
// Task bb-f 验证脚本 — 三条新规则四段回归(只读验证, 不改任何规则/业务代码)
// A1 daweixs.com  四段×2遍 (重点: autoCookie 破解 nginx 403 挑战的 Cookie 链可复用性)
// A2 dafengdagengren.com 四段×2遍 + 捧场/月票残留抽查(API 1500字预览 + 引擎级全文复查)
// A3 yybsw.com    四段×1遍 (UA 门禁: 规则钉移动 UA, 验证库内配置生效)
// 过线: list≥10 / book name+author+intro / toc≥50 / content≥2000
// 运行: bun scripts/verify-bb-f.ts
// ============================================================
const BASE = 'http://localhost:3000'

// 探针 URL 与各 seed 脚本一致(bb-b/bb-a2 实测可采样本)
const PROBES: Record<string, { list: string; book: string; toc: string; content: string }> = {
  daweixs: {
    list: 'https://www.daweixs.com/paihangbang/',
    book: 'https://www.daweixs.com/781_781707/',
    toc: 'https://www.daweixs.com/781_781707/',
    content: 'https://www.daweixs.com/781_781707/253172718.html',
  },
  dafeng: {
    list: 'https://www.dafengdagengren.com/paihangbang/',
    book: 'https://www.dafengdagengren.com/0_2/',
    toc: 'https://www.dafengdagengren.com/0_2/',
    content: 'https://www.dafengdagengren.com/0_2/23409004.html',
  },
  yybsw: {
    // {page} 占位符由测试路由替换为 1(都市分类真分页列表第 1 页)
    list: 'https://www.yybsw.com/list/dushi{page}.html',
    book: 'https://www.yybsw.com/book/27714/',
    toc: 'https://www.yybsw.com/book/27714/',
    content: 'https://www.yybsw.com/book/27714/7701301.html',
  },
}

const RULE_NAMES: Record<string, string> = {
  daweixs: '大微小说网 (daweixs.com)',
  dafeng: '大奉打更人 (dafengdagengren.com)',
  yybsw: '夜伴书屋 (yybsw.com)',
}

interface TestResult {
  httpStatus: number
  ok: boolean
  message?: string
  data?: any
  ms: number
}

async function apiTest(section: string, url: string, cfg: any): Promise<TestResult> {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, url, rule: cfg[section], fetch: cfg.fetch, clean: cfg.clean }),
  })
  const ms = Date.now() - t0
  const json: any = await res.json().catch(() => ({}))
  return { httpStatus: res.status, ok: !!json.ok, message: json.message, data: json.data, ms }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 判定一段是否过线, 返回 [过线, 摘要] */
function judge(section: string, r: TestResult): [boolean, string] {
  if (!r.ok) {
    return [false, `FAIL http=${r.httpStatus} msg=${(r.message || '').slice(0, 160)}`]
  }
  const d = r.data
  if (section === 'list') {
    const pass = (d.count ?? 0) >= 10
    return [pass, `count=${d.count} engine=${d.engine} ${d.ms}ms${pass ? '' : ' (未过线<10)'}`]
  }
  if (section === 'book') {
    const f = d.fields || {}
    const pass = !!(f.name && f.author && f.intro)
    return [pass, `name=${(f.name || '').slice(0, 20)}/author=${(f.author || '').slice(0, 12)}/intro=${(f.intro || '').length}字/status=${f.status || '-'}${pass ? '' : ' (缺 name/author/intro)'}`]
  }
  if (section === 'toc') {
    const pass = (d.count ?? 0) >= 50
    return [pass, `count=${d.count} pages=${d.pages} ${d.ms}ms${pass ? '' : ' (未过线<50)'}`]
  }
  const pass = (d.cleanedLength ?? 0) >= 2000
  return [pass, `raw=${d.rawLength} clean=${d.cleanedLength} pages=${d.pages} ${d.ms}ms${pass ? '' : ' (未过线<2000)'}`]
}

async function runRound(key: string, round: number, cfg: any): Promise<boolean> {
  console.log(`\n-- ${RULE_NAMES[key]} 第${round}遍 --`)
  let allPass = true
  for (const section of ['list', 'book', 'toc', 'content'] as const) {
    let r = await apiTest(section, PROBES[key][section], cfg)
    if (!r.ok || !judge(section, r)[0]) {
      // 失败先重试 1 次
      const first = r
      await sleep(1200)
      r = await apiTest(section, PROBES[key][section], cfg)
      if (!r.ok || !judge(section, r)[0]) {
        const [_, sum] = judge(section, r)
        console.log(`  [${section}] ❌ ${sum}`)
        if (first.ok !== r.ok || first.httpStatus !== r.httpStatus) {
          console.log(`       首试: http=${first.httpStatus} ok=${first.ok} msg=${(first.message || '').slice(0, 120)}`)
        }
        if (!r.ok) console.log(`       返回片段: ${JSON.stringify(r.message || r.data || {}).slice(0, 200)}`)
        allPass = false
        continue
      }
      console.log(`  [${section}] ⚠ 首试未过重试通过: ${judge(section, r)[1]} (首试: ${first.ok ? judge(section, first)[1] : 'http=' + first.httpStatus + ' ' + (first.message || '').slice(0, 80)})`)
      if (!judge(section, r)[0]) allPass = false
      continue
    }
    console.log(`  [${section}] ✅ ${judge(section, r)[1]}`)
    await sleep(350)
  }
  return allPass
}

/** dafeng 专项: 引擎级全文复查(与测试路由同管线: fetchPage→parseContent→cleanContentHtml), 全文查"捧场/月票" */
async function dafengResidueDeepCheck(cfg: any): Promise<void> {
  const { fetchPage } = await import('../src/lib/crawl/fetcher')
  const { parseContent } = await import('../src/lib/crawl/parser')
  const { cleanContentHtml } = await import('../src/lib/crawl/cleaner')
  const url = PROBES.dafeng.content
  const res = await fetchPage(url, cfg.fetch)
  if (res.blocked) { console.log('  [deep] ✗ 首抓被判拦截, 引擎级复查失败'); return }
  const parsed = await parseContent(url, res.html, cfg.content, cfg.fetch)
  const cleaned = cleanContentHtml(parsed.content || '', cfg.clean)
  const text = cleaned
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const hits = {
    捧场: (text.match(/捧场/g) || []).length,
    月票: (text.match(/月票/g) || []).length,
    纵横币: (text.match(/纵横币/g) || []).length,
  }
  console.log(`  [deep] 引擎级全文复查(不截断): 全文=${text.length}字, 捧场×${hits.捧场} 月票×${hits.月票} 纵横币×${hits.纵横币}`)
  console.log(`  [deep] 尾部120字: ${JSON.stringify(text.slice(-120))}`)
}

async function main() {
  // 取库内规则配置(只读)
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`)
  const listJson: any = await listRes.json()
  const rules: any[] = Array.isArray(listJson.data) ? listJson.data : listJson.data?.rules || []
  const cfgOf: Record<string, any> = {}
  for (const [key, name] of Object.entries(RULE_NAMES)) {
    const r = rules.find((x) => x.name === name)
    if (!r) { console.log(`❌ 规则不在库内: ${name}`); process.exit(1) }
    // 库内 config 为 JSON 字符串(与 RulesSection safeJsonParse 口径一致)
    cfgOf[key] = typeof r.config === 'string' ? JSON.parse(r.config) : r.config
    console.log(`库内规则: ${name} id=${r.id} enabled=${r.enabled}`)
    if (key === 'yybsw') {
      const f = cfgOf[key]?.fetch || {}
      console.log(`  yybsw UA 门禁配置核对: uaMode=${f.uaMode}, customUa=${JSON.stringify(f.customUa || f.ua || '').slice(0, 90)}`)
    }
    if (key === 'dafeng') {
      console.log(`  dafeng 清洗配置核对: removeSelectors=${JSON.stringify(cfgOf[key]?.clean?.removeSelectors)}`)
    }
  }

  const tally: Record<string, string[]> = {}
  for (const key of ['daweixs', 'dafeng', 'yybsw']) {
    tally[key] = []
    const rounds = key === 'yybsw' ? 1 : 2
    for (let i = 1; i <= rounds; i++) {
      const pass = await runRound(key, i, cfgOf[key])
      tally[key].push(`第${i}遍: ${pass ? '✅全过线' : '❌有段失败'}`)
      if (i < rounds) await sleep(1000)
    }
  }

  // dafeng 清洗抽查: API 预览层(1500字) + 引擎级全文层
  console.log(`\n-- dafeng 捧场/月票清洗抽查 --`)
  const api = await apiTest('content', PROBES.dafeng.content, cfgOf.dafeng)
  if (api.ok) {
    const d = api.data
    const previewHits = {
      捧场: ((d.cleanedText || '') + (d.cleanedHtml || '')).match(/捧场/g)?.length ?? 0,
      月票: ((d.cleanedText || '') + (d.cleanedHtml || '')).match(/月票/g)?.length ?? 0,
    }
    console.log(`  [api] clean=${d.cleanedLength}字(预览截1500), 预览内 捧场×${previewHits.捧场} 月票×${previewHits.月票}`)
  } else {
    console.log(`  [api] ❌ content 测试失败: ${api.message}`)
  }
  try { await dafengResidueDeepCheck(cfgOf.dafeng) } catch (e: any) { console.log(`  [deep] ✗ 异常: ${e?.message?.slice(0, 160)}`) }

  console.log(`\n===== 汇总 =====`)
  let final = true
  for (const [key, lines] of Object.entries(tally)) {
    console.log(`${RULE_NAMES[key]}: ${lines.join(' | ')}`)
    if (lines.some((l) => l.includes('❌'))) final = false
  }
  console.log(final ? '✅ 三规则回归总体通过' : '❌ 存在失败段落(见上)')
  if (!final) process.exit(2)
}

main()

export {}
