// ============================================================
// Task cc-c 验证脚本 — 番茄聚合API(fq.taijiwang.top) 引擎扩展 + 四层规则
// 运行: bun scripts/verify-cc-c.ts
// A: jsonGet 扩展单测([n]下标/[k=v]过滤/*/递归展平 + 旧语法零回归)
// B: jsonArrayAt map-collect 单测(嵌套数组下钻 + bqg713 并集范式零回归)
// C: 本地 mock 番茄API(按 legado V3.2 结构) 四段引擎级验证(库内规则配置, 含 sanitize 往返)
//    list(search 嵌套过滤/展平/脏项丢弃) → book(detail 字段+状态映射) → toc(*展平+const itemId)
//    → content(data.content \n 分段 plainText 清洗)
// D: {offset:N} 模板语义 + sanitize 透传断言
// ============================================================
export {}
import { jsonGet, jsonArrayAt, parseList, parseBook, parseToc, parseContent, extractField, urlVars, absolutize } from '../src/lib/crawl/parser'
import { cleanContentHtml } from '../src/lib/crawl/cleaner'
import { fetchPage } from '../src/lib/crawl/fetcher'
import { parseRuleConfig } from '../src/lib/crawl/types'
import { ruleConfig, RULE_NAME } from './seed-rule-fanqie'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

import type { Server } from 'http'
import { createServer } from 'http'
const MOCK_PORT = 45171
const received: { path: string; query: Record<string, string> }[] = []

const BOOKS_P1 = [
  { book_id: '7110012345678901', book_name: '剑来', author: '烽火戏诸侯', thumb_url: 'https://img.example/711.jpg', abstract: '大千世界，无奇不有。我陈平安，唯有一剑，可搬山、倒海、降妖、镇魔。', category: '仙侠' },
  { book_id: '7110012345678902', book_name: '剑道第一仙', author: '萧瑾瑜', thumb_url: 'https://img.example/712.jpg', abstract: '苏原携一剑临异界，快意恩仇。', category: '玄幻' },
]
const BOOKS_P2 = [
  { book_id: '7110012345678903', book_name: '我有一剑', author: '青鸾峰上', thumb_url: 'https://img.example/713.jpg', abstract: '重生都市，我有一剑。', category: '玄幻' },
  { book_id: '7110012345678904', book_name: '剑徒之路', author: '情何以甚', thumb_url: 'https://img.example/714.jpg', abstract: '以剑证道。', category: '奇幻' },
]

function makeServer(): Promise<Server> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url || '/', `http://127.0.0.1:${MOCK_PORT}`)
      const q: Record<string, string> = {}
      u.searchParams.forEach((v, k) => { q[k] = v })
      received.push({ path: u.pathname, query: q })
      const json = (body: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(body))
      }
      if (u.pathname === '/api/search') {
        const offset = parseInt(q.offset || '0', 10)
        const books = offset >= 10 ? BOOKS_P2 : BOOKS_P1
        return json({
          code: 0,
          data: {
            search_tabs: [
              { tab_type: 1, title: '全部', data: [{ book_data: [{ book_id: '999', book_name: '全部tab干扰书不应出现', author: '干扰', thumb_url: '', abstract: '', category: '干扰' }] }] },
              { tab_type: 3, title: '小说', data: [{ book_data: books.slice(0, 1) }, { book_data: books.slice(1) }] },
              { tab_type: 8, title: '漫画', data: [{ book_data: [{ book_id: '888', book_name: '漫画干扰书不应出现', author: '干扰8' }] }] },
            ],
          },
        })
      }
      if (u.pathname === '/api/detail') {
        return json({
          code: 0,
          data: { data: { book_id: q.book_id, book_name: '剑来', author: '烽火戏诸侯', thumb_url: 'https://img.example/711.jpg', abstract: '大千世界，无奇不有。我陈平安，唯有一剑，可搬山、倒海、降妖、镇魔、斩仙。', category: '仙侠', tags: '仙侠,古典仙侠', creation_status: '0', word_number: 7801234, score: '8.9' } },
        })
      }
      if (u.pathname === '/api/book') {
        return json({
          code: 0,
          data: {
            data: {
              chapterListWithVolume: [
                [{ itemId: '7110000000000001', title: '第1章 惊蛰' }, { itemId: '7110000000000002', title: '第2章 开门' }],
                [{ itemId: '7110000000000003', title: '第3章 山福地水洞天' }],
              ],
              volumeNameList: ['第一卷 惊蛰', '第二卷 山福地水洞天'],
            },
          },
        })
      }
      if (u.pathname === '/api/content') {
        const paras = ['陈平安沿着山道往下走，山间起了薄雾。', '少年背着竹篓，脚步轻快，清晨的露水打湿了裤脚。', '山下小镇尚未醒来，唯有面馆的灯亮着。']
        return json({ code: 0, data: { content: paras.join('\n') + '\n' + Array.from({ length: 30 }, (_, i) => `第${i + 1}段正文内容，少年握紧了手中的剑。`).join('\n') } })
      }
      res.writeHead(404); res.end('not found')
    })
    srv.listen(MOCK_PORT, '127.0.0.1', () => resolve(srv))
  })
}

const MOCK = `http://127.0.0.1:${MOCK_PORT}`

async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n== ${title} ==`)
  try { await fn() } catch (e: any) { fail++; console.log(`  ✗ 段落异常: ${e?.stack?.slice(0, 400) || e}`) }
}

async function main() {
  const srv = await makeServer()

  // ---------------- A. jsonGet 扩展单测 ----------------
  await section('A. jsonGet 扩展单测', () => {
    const root = {
      tabs: [
        { tab_type: 1, title: 'A' },
        { tab_type: 3, title: 'B' },
        { tab_type: 3, title: 'C' },
      ],
      nested: [[{ v: 1 }, { v: 2 }], [{ v: 3 }]],
      deep: [[['x', 'y'], ['z']]],
    }
    ok('旧语法: 数字段下标', jsonGet(root, 'tabs.0.title') === 'A')
    ok('旧语法: []装饰可剔', jsonGet(root, 'tabs[].0.title') === 'A')
    ok('旧语法: 数组上非数字段=undefined', jsonGet(root, 'tabs.title') === undefined)
    ok('扩展: [n]下标', jsonGet(root, 'tabs[1].title') === 'B')
    ok('扩展: [k=v]过滤(数字值)', JSON.stringify(jsonArrayAt(root, 'tabs[tab_type=3].title')) === JSON.stringify(['B', 'C']))
    // jsonGet 严格语义: 过滤结果仍是数组, 后续非数字段=undefined; 取单元素需显式 [0]
    ok('扩展: [k=v]过滤+下标取元素(jsonGet)', jsonGet(root, 'tabs[tab_type=1][0].title') === 'A')
    ok('扩展: [k=v]过滤 map-collect(jsonArrayAt 宽语义)', (jsonArrayAt(root, 'tabs[tab_type=1].title') as unknown[]).join() === 'A')
    ok('扩展: [k=v]无命中=空数组', Array.isArray(jsonGet(root, 'tabs[tab_type=9]')) && (jsonGet(root, 'tabs[tab_type=9]') as unknown[]).length === 0)
    ok('扩展: 无命中后再取字段=undefined', jsonGet(root, 'tabs[tab_type=9].title') === undefined)
    ok('扩展: *一层展平', (jsonGet(root, 'nested.*') as unknown[]).length === 3)
    ok('扩展: *递归展平', (jsonGet(root, 'deep.*') as unknown[]).join(',') === 'x,y,z')
    ok('扩展: *非数组=undefined(旧语义)', jsonGet(root, 'tabs.0.*') === undefined)
    ok('扩展: 过滤+&多条件', (jsonArrayAt(root, 'tabs[tab_type=3&title=B].title') as unknown[]).join() === 'B')
  })

  // ---------------- B. jsonArrayAt map-collect 单测 ----------------
  await section('B. jsonArrayAt map-collect 单测', () => {
    const root = {
      search_tabs: [
        { tab_type: 1, data: [{ book_data: [{ id: 'X1' }] }] },
        { tab_type: 3, data: [{ book_data: [{ id: 'A1' }, { id: 'A2' }] }, { book_data: [{ id: 'A3' }] }] },
      ],
      hotlist: [{ id: 'h1', title: '热1' }],
      sort1: [{ id: 's1', title: '排1' }],
      rows: [[1, 2], [3]],
    }
    ok('三层嵌套下钻+过滤', (jsonArrayAt(root, 'search_tabs[tab_type=3].data.book_data') as { id: string }[]).map((x) => x.id).join() === 'A1,A2,A3')
    ok('无过滤跨tab取全部', (jsonArrayAt(root, 'search_tabs.data.book_data') as { id: string }[]).length === 4)
    ok('旧范式零回归: 多榜单并集', (jsonArrayAt(root, 'hotlist,sort1') as { id: string }[]).map((x) => x.id).join() === 'h1,s1')
    ok('旧范式零回归: 纯数组路径', (jsonArrayAt(root, 'hotlist') as unknown[]).length === 1)
    ok('数组的数组: *展平成平面', (jsonArrayAt(root, 'rows.*') as unknown[]).join() === '1,2,3')
    ok('旧语义保持: 数组的数组无*则一层', (jsonArrayAt(root, 'rows') as unknown[]).length === 2)
  })

  // ---------------- C. 四段引擎级验证(库内规则配置) ----------------
  await section('C1. 库内规则取回+sanitize往返', async () => {
    const res = await fetch('http://localhost:3000/api/admin/rules?take=100')
    const j: any = await res.json()
    const rules: any[] = Array.isArray(j.data) ? j.data : j.data?.rules || []
    const rule = rules.find((r) => r.name === RULE_NAME)
    ok('规则已入库', !!rule, rule?.id)
    if (!rule) throw new Error('规则未入库')
    const cfg = parseRuleConfig(typeof rule.config === 'string' ? rule.config : JSON.stringify(rule.config))
    ok('sanitize 保留 itemSelector json 表达式', (cfg.list.itemSelector as any)?.expression === 'data.search_tabs[tab_type=3].data.book_data')
    ok('sanitize 保留 {offset:10} urlTemplate', cfg.list.urlTemplate?.includes('{offset:10}') === true)
    ok('sanitize 保留 replaceFrom($1 合成)', (cfg.list.fields as any)?.bookUrl?.replaceFrom === '^(\\d+)$')
    ok('sanitize 保留 toc const url 模板', (cfg.toc.fields as any)?.url?.type === 'const' && (cfg.toc.fields as any)?.url?.expression.includes('{itemId}'))
    ok('sanitize 保留 customUa', (cfg.fetch.customUa || '').includes('SearchCraft/3.6.5'))
    ok('sanitize 保留 plainText', cfg.clean.plainText === true)
    ;(globalThis as any).__fanqieCfg = cfg
  })

  const cfgAny = (globalThis as any).__fanqieCfg
  if (!cfgAny) throw new Error('库内规则缺失')
  const cfg = cfgAny

  await section('C2. list 段(search 嵌套过滤+展平)', async () => {
    const url = `${MOCK}/api/search?key=%E5%89%91&tab_type=3&offset=0`
    const res = await fetchPage(url, cfg.fetch)
    ok('mock 200', !res.blocked, `engine=${res.engine} ${res.html.length}B`)
    const parsed = parseList(res.html, url, cfg.list, ['url', 'bookUrl'])
    ok('发现 2 本(tab_type=3 专属)', parsed.items.length === 2, `count=${parsed.items.length}`)
    const names = parsed.items.map((i) => i.fields.name).join(',')
    ok('干扰书(tab_type=1/8)未混入', !names.includes('干扰'), names)
    ok('书名正确', names === '剑来,剑道第一仙', names)
    ok('作者提取', parsed.items[0]?.fields.author === '烽火戏诸侯')
    ok('简介提取', (parsed.items[0]?.fields.intro || '').includes('大千世界'))
    ok('分组残片合并(book_data 跨组展平)', parsed.items.length === 2)
    const bu = parsed.items[0]?.fields.bookUrl || ''
    ok('bookUrl=detail API 合成', bu === `${MOCK}/api/detail?book_id=7110012345678901`, bu)
    const s2 = received.find((r) => r.path === '/api/search')
    ok('mock 收到 key=剑', s2?.query.key === '剑', JSON.stringify(s2?.query))
    ok('mock 收到 tab_type=3', s2?.query.tab_type === '3')
    // 第2页: {offset:10} 语义 (p=2 → offset=10)
    const url2 = `${MOCK}/api/search?key=%E5%89%91&tab_type=3&offset=10`
    const res2 = await fetchPage(url2, cfg.fetch)
    const p2 = parseList(res2.html, url2, cfg.list, ['url', 'bookUrl'])
    ok('第2页(offset=10)翻到新一批', p2.items[0]?.fields.name === '我有一剑', p2.items[0]?.fields.name)
  })

  await section('C3. book 段(detail 字段+状态映射)', async () => {
    const bookUrl = `${MOCK}/api/detail?book_id=7110012345678901`
    const res = await fetchPage(bookUrl, cfg.fetch)
    const book = parseBook(res.html, bookUrl, cfg.book)
    ok('name 字段', book.name === '剑来', book.name)
    ok('author 字段', book.author === '烽火戏诸侯', book.author)
    ok('category 字段', book.category === '仙侠', book.category)
    ok('keywords(tags) 字段', book.keywords === '仙侠,古典仙侠', book.keywords)
    ok('intro 字段', (book.intro || '').includes('搬山、倒海'))
    ok('cover 字段', book.cover === 'https://img.example/711.jpg', book.cover)
    ok('status: creation_status=0 → 连载中', book.status === '连载中', book.status)
  })

  await section('C4. toc 段(*展平 + const itemId 合成)', async () => {
    const bookUrl = `${MOCK}/api/detail?book_id=7110012345678901`
    // 与 runner.extractToc 同口径: tocLink 以 urlVars(书籍页URL) 提取 + absolutize(书籍页URL)
    const link = absolutize(
      extractField('', null as any, null, null, cfg.toc.tocLink, { vars: urlVars(bookUrl) }),
      bookUrl
    )
    const tocUrl = `${MOCK}/api/book?book_id=7110012345678901&bid=7110012345678901`
    ok('tocLink 合成 /api/book?book_id&bid', link === tocUrl, link)
    const res = await fetchPage(tocUrl, cfg.fetch)
    const toc = await parseToc(tocUrl, res.html, cfg.toc, cfg.fetch)
    ok('3 章(数组的数组已展平)', toc.items.length === 3, `count=${toc.items.length} pages=${toc.pages}`)
    ok('章序正确(跨卷)', toc.items.map((i) => i.title).join('/') === '第1章 惊蛰/第2章 开门/第3章 山福地水洞天', toc.items.map((i) => i.title).join('/'))
    const u1 = toc.items[0]?.url || ''
    ok('章节URL=content API 且 item_id 取自章对象', u1 === `${MOCK}/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id=7110000000000001&bid=7110012345678901`, u1)
    ok('bid 取自目录页查询参数', u1.includes('bid=7110012345678901'))
  })

  await section('C5. content 段(\\n 分段 plainText 清洗)', async () => {
    const cu = `${MOCK}/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id=7110000000000001&bid=7110012345678901`
    const res = await fetchPage(cu, cfg.fetch)
    const parsed = await parseContent(cu, res.html, cfg.content, cfg.fetch)
    ok('正文非空', parsed.content.length > 200, `raw=${parsed.content.length}`)
    const cleaned = cleanContentHtml(parsed.content, cfg.clean)
    ok('clean ≥200', cleaned.length >= 200, `clean=${cleaned.length}`)
    ok('段落以空行分隔(\\n\\n)', cleaned.includes('\n\n'), JSON.stringify(cleaned.slice(0, 60)))
    ok('开头干净无 junk', /^陈平安沿着山道往下走/.test(cleaned), JSON.stringify(cleaned.slice(0, 30)))
    ok('无 \n 残留字面量', !cleaned.includes('\\n'))
  })

  await section('C6. {offset:N} 模板语义', () => {
    const tpl = 'https://fq.taijiwang.top/api/search?key=%E5%89%91&tab_type=3&offset={offset:10}'
    // 与 runner.listURL 构造同一表达式
    const build = (p: number) => tpl
      .replace(/\{offset:(\d+)\}/g, (_, n: string) => String((p - 1) * Math.max(1, parseInt(n, 10) || 1)))
      .replace('{page}', String(p))
    ok('p=1 → offset=0', build(1).endsWith('offset=0'))
    ok('p=2 → offset=10', build(2).endsWith('offset=10'))
    ok('p=5 → offset=40', build(5).endsWith('offset=40'))
    const tpl2 = 'https://x/list/{page}.html'
    ok('无 {offset:N} 时旧模板不受影响', tpl2.replace(/\{offset:(\d+)\}/g, 'X').replace('{page}', '3') === 'https://x/list/3.html')
  })

  srv.close()
  console.log(`\n${'='.repeat(46)}\n结果: ${pass} 通过 / ${fail} 失败`)
  if (fail > 0) process.exit(2)
}

main()
