// 四段测试一个规则: bun run scripts/test-rule-sections.ts <ruleId> [bookProbeUrl] [contentProbeUrl]
// export {}: 使本文件成为 module, 顶层 await 合法且不再与 seed-rules-v2.ts 的全局 const BASE 冲突
export {}
const [ruleId, , contentProbe] = process.argv.slice(2)
const BASE = 'http://localhost:3000'
const res = await fetch(`${BASE}/api/admin/rules/${ruleId}`).then(r => r.json())
if (!res.ok) { console.error('规则不存在:', res.message); process.exit(1) }
const cfg = JSON.parse(res.data.config)

async function test(section: string, url: string, rule: any, extra: any = {}) {
  const t0 = Date.now()
  const r = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, url, rule, fetch: cfg.fetch, clean: cfg.clean, ...extra }),
  }).then(r => r.json())
  const ms = Date.now() - t0
  if (!r.ok) { console.log(`  [${section}] ❌ ${r.message} (${ms}ms)`); return null }
  const d = r.data
  if (section === 'list') {
    console.log(`  [list] ✅ engine=${d.engine} count=${d.count} ${d.ms}ms`)
    for (const it of (d.sample || []).slice(0, 2)) console.log('    ', JSON.stringify(it).slice(0, 160))
    return d.sample?.[0]
  }
  if (section === 'book') {
    console.log(`  [book] ✅ engine=${d.engine} fields=${d.count} ${d.ms}ms`)
    console.log('    ', JSON.stringify(d.fields).slice(0, 400))
    return d.fields
  }
  if (section === 'toc') {
    console.log(`  [toc] ✅ engine=${d.engine} count=${d.count} pages=${d.pages} ${d.ms}ms`)
    for (const it of (d.sample || []).slice(0, 3)) console.log('    ', JSON.stringify(it).slice(0, 140))
    return d.sample
  }
  console.log(`  [content] ✅ engine=${d.engine} pages=${d.pages} raw=${d.rawLength} clean=${d.cleanedLength} ${d.ms}ms`)
  console.log('    text:', JSON.stringify((d.cleanedText || '').slice(0, 180)))
  return d
}

console.log('== 列表页 ==')
const listUrl = cfg.list.urlTemplate.replace('{page}', '1')
const first = await test('list', listUrl, cfg.list)
// 相对 bookUrl 绝对化
let bookUrl = first?.bookUrl || process.argv[3] || ''
if (bookUrl && !/^https?:\/\//.test(bookUrl)) {
  bookUrl = new URL(bookUrl, listUrl).toString()
  if (first?.bookUrl) first.bookUrl = bookUrl
}
if (bookUrl) {
  const fields = await test('book', bookUrl, cfg.book)
  console.log('== 目录页 ==')
  await test('toc', bookUrl, cfg.toc)
  console.log('== 正文页 ==')
  const contentUrl = contentProbe || ''
  if (contentUrl) await test('content', contentUrl, cfg.content)
} else {
  console.log('  !! 无 bookUrl, 跳过 book/toc/content')
}
