// ============================================================
// Task bb-g 回归脚本 — biquge.tw 四段(只读, 不改规则不触库)
// 运行: bun scripts/verify-bb-g-regress.ts
// ============================================================
const BASE = 'http://localhost:3000'
const NAME = '笔趣阁(www.biquge.tw)·直连SSR采集'
const PROBES = {
  list: 'https://www.biquge.tw/sort/1.html',
  book: 'https://www.biquge.tw/book/9002.html',
  toc: 'https://www.biquge.tw/book/9002.html',
  content: 'https://www.biquge.tw/book/9002/286409.html',
}

async function main() {
  const res = await fetch(`${BASE}/api/admin/rules?take=100`)
  const json: any = await res.json()
  const rules: any[] = Array.isArray(json.data) ? json.data : json.data?.rules || []
  const rule = rules.find((r) => r.name === NAME)
  if (!rule) { console.log('❌ 规则不在库内:', NAME); process.exit(1) }
  const cfg = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config
  console.log(`规则: ${NAME} id=${rule.id}`)

  let allPass = true
  const test = async (section: string, url: string): Promise<any> => {
    const r = await fetch(`${BASE}/api/admin/rules/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, url, rule: cfg[section], fetch: cfg.fetch, clean: cfg.clean }),
    })
    const j: any = await r.json()
    if (!j.ok) { console.log(`  [${section}] ❌ ${j.message}`); allPass = false; return null }
    return j.data
  }
  const d1 = await test('list', PROBES.list)
  if (d1) {
    const pass = (d1.count ?? 0) >= 10
    if (!pass) allPass = false
    console.log(`  [list] ✅ count=${d1.count} engine=${d1.engine} ${d1.ms}ms${pass ? '' : ' ❌未过线<10'}`)
  }
  const d2 = await test('book', PROBES.book)
  if (d2) {
    const f = d2.fields || {}
    const pass = !!(f.name && f.author)
    if (!pass) allPass = false
    console.log(`  [book] ✅ name=${(f.name || '').slice(0, 24)} author=${(f.author || '').slice(0, 16)} intro=${(f.intro || '').length}字${pass ? '' : ' ❌缺字段'}`)
  }
  const d3 = await test('toc', PROBES.toc)
  if (d3) {
    const pass = (d3.count ?? 0) >= 50
    if (!pass) allPass = false
    console.log(`  [toc] ✅ count=${d3.count} pages=${d3.pages} ${d3.ms}ms${pass ? '' : ' ❌未过线<50'}`)
  }
  const d4 = await test('content', PROBES.content)
  if (d4) {
    const pass = (d4.cleanedLength ?? 0) >= 2000
    if (!pass) allPass = false
    console.log(`  [content] ✅ raw=${d4.rawLength} clean=${d4.cleanedLength} pages=${d4.pages} ${d4.ms}ms 开头=${JSON.stringify((d4.cleanedText || '').slice(0, 40))}${pass ? '' : ' ❌未过线<2000'}`)
  }
  console.log(allPass ? '✅ biquge.tw 四段回归全绿' : '❌ 存在失败段')
  if (!allPass) process.exit(2)
}
main()

export {}
