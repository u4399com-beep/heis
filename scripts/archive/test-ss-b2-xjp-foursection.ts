// ============================================================
// ss-b2 四段实测: xinjianpan 规则 list/book/toc/content 全绿
// 经 /api/admin/rules/test 引擎级测试(与测试面板同口径)
// 运行: bun run scripts/test-ss-b2-xjp-foursection.ts
// ============================================================
export {} // module 守卫(tsc: 顶层 await + 防全局 BASE 重名)
const BASE = 'http://127.0.0.1:3000'
// ss-b3: seed 文件按任务书改名 seed-rule-xjp.ts, RULE_NAME 规范化为「…·直连+var c解密代理正文」
const { ruleConfig, RULE_NAME } = await import('./seed-rule-xjp')

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: (await res.json()) as any }
}

async function testSection(section: 'list' | 'book' | 'toc' | 'content', url: string) {
  // ss-b3 限流: toc 段测试页数钳 2(真网礼貌预算 ≤20 请求/站; 全量目录由实测任务承载)
  const sectionRule =
    section === 'toc'
      ? { ...ruleConfig.toc, pagination: { ...ruleConfig.toc.pagination, maxPages: 2 } }
      : ruleConfig[section]
  const r = await post(`${BASE}/api/admin/rules/test`, {
    section,
    url,
    rule: sectionRule,
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
    console.log(`  - ${it.name} | ${it.author} | ${it.status} | ${String(it.intro ?? '').slice(0, 40)}… | ${it.bookUrl}`)
  }
}

console.log('======== ② book (/txt/oaa/ 修罗武神) ========')
const book = await testSection('book', 'https://www.xinjianpan.com/txt/oaa/')
if (book) {
  console.log(`engine=${book.engine} ms=${book.ms}`)
  const f = book.fields ?? {}
  console.log(`name=${f.name} author=${f.author} status=${f.status} latestChapter=${f.latestChapter}`)
  console.log(`cover=${String(f.cover).slice(0, 90)}`)
  console.log(`intro(${String(f.intro ?? '').length}字)=${String(f.intro ?? '').slice(0, 60)}…`)
  const fieldCount = Object.entries(f).filter(([, v]) => v && String(v).trim()).length
  console.log(`非空字段数: ${fieldCount}`)
}

console.log('======== ③ toc (/txt/oaa/ 修罗武神) ========')
const toc = await testSection('toc', 'https://www.xinjianpan.com/txt/oaa/')
if (toc) {
  console.log(`count=${toc.count} pages=${toc.pages} engine=${toc.engine} ms=${toc.ms}`)
  for (const it of (toc.sample ?? []).slice(0, 5)) console.log(`  - ${it.title} → ${String(it.url).slice(0, 100)}`)
}

console.log('======== ④ content (第1章 经代理) ========')
const content = await testSection('content', 'http://127.0.0.1:3015/content?u=https://www.xinjianpan.com/txt/oaa/vl7.html')
if (content) {
  console.log(`engine=${content.engine} ms=${content.ms} pages=${content.pages} rawLength=${content.rawLength} cleanedLength=${content.cleanedLength}`)
  console.log(`正文头140: ${String(content.cleanedText ?? '').slice(0, 140).replace(/\n/g, '⏎')}`)
}

const okAll = list && book && toc && content
console.log(okAll ? '\nALL-4-GREEN' : '\nHAS-FAIL')
process.exit(okAll ? 0 : 1)
