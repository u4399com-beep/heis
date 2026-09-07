// ============================================================
// rr-a 四段实测: deqixs 规则 list/book/toc/content 全绿
// 经 /api/admin/rules/test 引擎级测试(与测试面板同口径)
// 运行: bun run scripts/test-rr-a-foursection.ts
// ============================================================
export {} // module 守卫(tsc: 顶层 await + 防全局 BASE 重名)
const BASE = 'http://127.0.0.1:3000'
const { ruleConfig, RULE_NAME } = await import('./seed-rule-deqixs')

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: (await res.json()) as any }
}

async function testSection(section: 'list' | 'book' | 'toc' | 'content', url: string) {
  const r = await post(`${BASE}/api/admin/rules/test`, {
    section,
    url,
    rule: ruleConfig[section],
    fetch: ruleConfig.fetch,
    clean: ruleConfig.clean,
    limit: 5,
  })
  const d = r.json?.data
  if (!r.json?.ok) {
    console.log(`[${section}] FAIL(${r.status}): ${r.json?.message ?? JSON.stringify(r.json).slice(0, 200)}`)
    return null
  }
  return d
}

console.log(`规则: ${RULE_NAME}`)
console.log('======== ① list ========')
const list = await testSection('list', ruleConfig.list.urlTemplate!)
if (list) {
  console.log(`count=${list.count} engine=${list.engine} ms=${list.ms} htmlSize=${list.htmlSize}`)
  for (const it of (list.sample ?? []).slice(0, 3)) {
    console.log(`  - ${it.name} | ${it.author} | ${String(it.intro ?? '').slice(0, 40)}… | ${it.bookUrl}`)
  }
}

console.log('======== ② book (/books/126/) ========')
const book = await testSection('book', 'https://www.deqixs.cc/books/126/')
if (book) {
  console.log(`engine=${book.engine} ms=${book.ms}`)
  const f = book.fields ?? {}
  console.log(`name=${f.name} author=${f.author} status=${f.status} category=${f.category}`)
  console.log(`latestChapter=${f.latestChapter} cover=${String(f.cover).slice(0, 80)}`)
  console.log(`intro(${String(f.intro ?? '').length}字)=${String(f.intro ?? '').slice(0, 60)}…`)
  const fieldCount = Object.entries(f).filter(([, v]) => v && String(v).trim()).length
  console.log(`非空字段数: ${fieldCount}`)
}

console.log('======== ③ toc (/books/126/) ========')
const toc = await testSection('toc', 'https://www.deqixs.cc/books/126/')
if (toc) {
  console.log(`count=${toc.count} pages=${toc.pages} engine=${toc.engine} ms=${toc.ms}`)
  for (const it of (toc.sample ?? []).slice(0, 5)) console.log(`  - ${it.title} → ${String(it.url).slice(0, 90)}`)
  console.log(`  … 末2条:`)
  // 测试面板只回 sample(前5), 全量首末自证交 verify 脚本
}

console.log('======== ④ content (第1章 经代理) ========')
const content = await testSection('content', 'http://127.0.0.1:3014/content?u=https://www.deqixs.cc/books/126/81417.html')
if (content) {
  console.log(`engine=${content.engine} ms=${content.ms} pages=${content.pages} rawLength=${content.rawLength} cleanedLength=${content.cleanedLength}`)
  console.log(`正文头120: ${String(content.cleanedText ?? '').slice(0, 120).replace(/\n/g, '⏎')}`)
}

const okAll = list && book && toc && content
console.log(okAll ? '\nALL-4-GREEN' : '\nHAS-FAIL')
process.exit(okAll ? 0 : 1)
