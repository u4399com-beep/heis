// cc-d2 四段测试探针: 走 dev server /api/admin/rules/test(真 server 侧引擎)
// 前置: seed 已入库(规则名匹配 seed-rule-bqg713.ts), proxy 3010 存活
// 断言: list/book/toc 200 且数字合理; content 段 200(修复前 403)且 raw 长度合理
// 运行: bun scripts/verify-cc-d2-foursection.ts
export {}
const BASE = 'http://localhost:3000'
const RULE_NAME = '笔趣阁bqg713(www.bqg713.cc)·纯JSON API站采集'
const BOOK_ID = 2530 // cc-d 逆向用测试书(相宫类都市文), 与 proxy 自检向量同书

interface TestResp {
  ok: boolean
  message?: string
  data?: { engine?: string; count?: number; pages?: number; rawLength?: number; cleanedLength?: number; fields?: Record<string, string>; sample?: unknown[]; cleanedText?: string }
}

async function testSection(section: string, url: string, rule: unknown, fetchCfg: unknown, clean?: unknown): Promise<NonNullable<TestResp['data']>> {
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, url, rule, fetch: fetchCfg, clean, limit: 5 }),
  })
  const j = (await res.json()) as TestResp
  console.log(`[${section}] HTTP ${res.status}: ${JSON.stringify(j.data ?? j.message).slice(0, 300)}`)
  if (!res.ok || !j.ok || !j.data) throw new Error(`${section} 段测试失败: ${j.message || res.status}`)
  return j.data
}

async function main() {
  // 0) 取库内规则 + 断言 token 三件套入库往返存活
  const lr = await fetch(`${BASE}/api/admin/rules?take=100`).then((r) => r.json() as Promise<{ ok: boolean; data?: { rules?: { id: string; name: string; config: string }[] } | { rules?: { id: string; name: string; config: string }[] } }>)
  const rules = Array.isArray(lr.data) ? lr.data : lr.data?.rules || []
  const mine = rules.find((r) => r.name === RULE_NAME)
  if (!mine) throw new Error('库内未找到 bqg713 规则')
  console.log('[0] 规则 id=' + mine.id)
  const cfg = JSON.parse(mine.config) as {
    list: unknown; book: unknown; toc: unknown; content: unknown; fetch: Record<string, unknown>; clean: unknown
  }
  if (cfg.fetch.tokenUrl !== 'http://127.0.0.1:3010/rewrite?url={url}') throw new Error('tokenUrl 入库往返丢失')
  if (cfg.fetch.tokenPattern !== 'token') throw new Error('tokenPattern 入库往返丢失')
  if (cfg.fetch.tokenInjection !== 'url') throw new Error('tokenInjection 入库往返丢失')
  console.log('[0] token 三件套入库往返 OK:', cfg.fetch.tokenUrl, '/', cfg.fetch.tokenPattern, '/', cfg.fetch.tokenInjection)

  // 1) list 段
  const list = await testSection('list', 'https://www.bqg713.cc/api/index?sort=all', cfg.list, cfg.fetch)
  if (!list.count || list.count < 10) throw new Error('list count=' + list.count)

  // 2) book 段
  const book = await testSection('book', `https://www.bqg713.cc/api/book?id=${BOOK_ID}`, cfg.book, cfg.fetch)
  const name = book.fields?.name || ''
  if (!name) throw new Error('book 未取到书名')

  // 3) toc 段(书籍页URL进, tocLink const 模板 {q.id} 注入 → booklist)
  const toc = await testSection('toc', `https://www.bqg713.cc/api/book?id=${BOOK_ID}`, cfg.toc, cfg.fetch)
  if (!toc.count || toc.count < 50) throw new Error('toc count=' + toc.count)
  const firstToc = (toc.sample as { url: string; title: string }[] | undefined)?.[0]
  if (!firstToc?.url.includes('apibi.cc/api/chapter') || !firstToc.url.includes(`id=${BOOK_ID}`) || !firstToc.url.includes('chapterid=1')) {
    throw new Error('toc 章节 URL 形态不对: ' + firstToc?.url)
  }
  console.log('[toc] 首章样本:', firstToc.title, '→', firstToc.url)

  // 4) content 段(修复前: www 域明文参数 403; 修复后: apibi.cc + token 注入 200)
  const content = await testSection('content', firstToc.url, cfg.content, cfg.fetch, cfg.clean)
  if (!content.rawLength || content.rawLength < 1000) throw new Error('content rawLength=' + content.rawLength)
  const preview = content.cleanedText || ''
  if (/token=|apibi\.cc|bqg713/.test(preview)) throw new Error('content 预览含 token/域名残留')
  console.log('PASS: 四段全绿 list=' + list.count + '本 book=' + name + ' toc=' + toc.count + '章 content raw=' + content.rawLength + ' clean=' + content.cleanedLength)
}
main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
