// hh-a 四段正式验证: aijjxs.com 规则 2 遍全过线(无 flaky)
// 用法: bun run scripts/verify-hh-a-foursection.ts
// 口径:
//  - 规则配置取自库内 GET /api/admin/rules(name 查找, 库内 config 为 JSON 字符串需 parse),
//    即消毒后真实生效配置(ee-b 教训: 四段测试必须显式传规则 fetch, 缺省 auto+rotate 会假绿)
//  - rules/test 的 URL 参数传已展开 URL({page}→1, cc-b 占位符坑)
//  - 门槛: list≥10 本 / book name+author+intro 全字段 / toc≥50 章 / content 清洗后≥2000 字符
//  - 2 遍全过线才算通过, 两遍数字并排打印比对 flaky
const BASE = 'http://localhost:3000'
const RULE_NAME = '久久小说网 (aijjxs.com)'

const PROBE = {
  list: 'https://www.aijjxs.com/txt/xuanhuan/index_1.html',
  book: 'https://www.aijjxs.com/txt/57196.html',
  toc: 'https://www.aijjxs.com/txt/57196.html',
  content: 'https://www.aijjxs.com/read/11/57196/3.html',
}

interface Envelope<T = any> { ok: boolean; data?: T; message?: string }

async function api<T = any>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return (await res.json()) as Envelope<T>
}

async function loadRuleConfig(): Promise<{ toc: any; book: any; list: any; content: any; fetch: any; clean: any }> {
  const r = await api<any>('/api/admin/rules?take=100')
  const arr = Array.isArray(r?.data) ? r.data : []
  const rule = arr.find((x: any) => x.name === RULE_NAME)
  if (!rule) throw new Error(`库内规则未找到: ${RULE_NAME}`)
  const cfg = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config
  console.log(`规则已加载: ${rule.name} id=${rule.id}`)
  return cfg
}

async function testSection(section: string, url: string, ruleSection: unknown, cfg: Record<string, any>): Promise<Record<string, any> | null> {
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, url, rule: ruleSection, fetch: cfg.fetch, clean: cfg.clean }),
  })
  const json = (await res.json()) as Envelope<any>
  if (!json.ok) {
    console.log(`  [${section}] ❌ ${json.message}`)
    return null
  }
  return json.data
}

interface PassResult {
  listCount: number
  bookFields: Record<string, string>
  tocCount: number
  cleanLen: number
  ms: { list: number; book: number; toc: number; content: number }
}

async function runPass(tag: string, cfg: Record<string, any>): Promise<PassResult | null> {
  console.log(`---- 第 ${tag} 遍 ----`)
  let ok = true

  const list = await testSection('list', PROBE.list, cfg.list, cfg)
  const listMs = list?.ms ?? 0
  const listCount = (list?.count as number) ?? 0
  const first = (list?.items || list?.sample || [])[0] as any
  if (first) console.log(`  [list] count=${listCount} 首项=${JSON.stringify({ name: first.name, author: first.author, status: first.status })}`)
  if (listCount < 10) { ok = false; console.log('  !! list<10 未过线') }
  // 字段完整度抽查: 首项 6 字段全非空
  if (first) {
    const need = ['name', 'bookUrl', 'author', 'status', 'intro', 'cover']
    const missing = need.filter((k) => !(first as Record<string, string>)[k])
    if (missing.length) { ok = false; console.log('  !! list 首项缺字段:', missing.join(',')) }
    else console.log('  [list] 首项 6 字段(name/bookUrl/author/status/intro/cover)全非空 ✓')
  }

  const book = await testSection('book', PROBE.book, cfg.book, cfg)
  const bookMs = book?.ms ?? 0
  const bf = (book?.fields || {}) as Record<string, string>
  console.log(`  [book] fields=${JSON.stringify({ name: bf.name, author: bf.author, category: bf.category, status: bf.status, introLen: (bf.intro || '').length, cover: (bf.cover || '').slice(0, 40) })}`)
  if (!bf.name || !bf.author || !bf.intro) { ok = false; console.log('  !! book name/author/intro 缺失未过线') }

  const toc = await testSection('toc', PROBE.toc, cfg.toc, cfg)
  const tocMs = toc?.ms ?? 0
  const tocCount = (toc?.count as number) ?? 0
  const t0 = (toc?.sample || [])[0] as any
  if (t0) console.log(`  [toc] count=${tocCount} 首项=${JSON.stringify(t0).slice(0, 120)}`)
  if (tocCount < 50) { ok = false; console.log('  !! toc<50 未过线') }

  const content = await testSection('content', PROBE.content, cfg.content, cfg)
  const contentMs = content?.ms ?? 0
  const cleanLen = (content?.cleanedLength as number) ?? 0
  const head = ((content?.cleanedText || '') as string).slice(0, 60).replace(/\s+/g, ' ')
  console.log(`  [content] raw=${content?.rawLength} clean=${cleanLen} 开头=${JSON.stringify(head)}`)
  if (cleanLen < 2000) { ok = false; console.log('  !! content<2000 未过线') }

  console.log(ok ? `  ✅ 第 ${tag} 遍全过线` : `  ❌ 第 ${tag} 遍存在未过线段落`)
  return ok ? { listCount, bookFields: bf, tocCount, cleanLen, ms: { list: listMs, book: bookMs, toc: tocMs, content: contentMs } } : null
}

async function main() {
  const cfg = (await loadRuleConfig()) as unknown as Record<string, any>
  const r1 = await runPass('1', cfg)
  await new Promise((r) => setTimeout(r, 1500))
  const r2 = await runPass('2', cfg)
  if (!r1 || !r2) {
    console.log('❌ 四段验证未通过(2 遍门槛)')
    process.exit(2)
  }
  console.log('---- 两遍数字比对 ----')
  console.log(`list: R1=${r1.listCount} R2=${r2.listCount} / toc: R1=${r1.tocCount} R2=${r2.tocCount} / content clean: R1=${r1.cleanLen} R2=${r2.cleanLen}`)
  console.log(`ms: R1=${JSON.stringify(r1.ms)} R2=${JSON.stringify(r2.ms)}`)
  const stable = r1.listCount === r2.listCount && r1.tocCount === r2.tocCount
  console.log(stable ? '✅ 两遍数字一致, 无 flaky' : '⚠ 两遍数字有差(列表/目录类源站时点漂移或 flaky, 见上方明细)')
  console.log('✅ 四段 2 遍全过线')
}

main().catch((e) => { console.error('verify ERROR', e); process.exit(1) })

export {}
