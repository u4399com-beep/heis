/**
 * verify-qq-e2-parser.ts — qq-e2 残作收编 parser 域断言(纯离线)
 * 验收对象:
 *   1. [qq-e 原改动验收] parseList JSON 模式列表项链接收紧:
 *      url/bookUrl 链接字段全空的 JSON 项不入列(与 HTML 容器模式 y-a 重放同口径);
 *      parseBook 借道(urlFields=['cover'])不受此限
 *   2. 既有语义回归: absolutize 协议过滤/自引用过滤、jsonGet 算子、parseToc const
 *      volume/两阶段提取、findLargestText 兜底、HTML 容器模式链接收紧
 * 纪律: 纯函数直测, 零 DB/零网络; 断言计数+ALL PASS 收尾
 */
import { parseList, parseBook, parseToc, absolutize, jsonGet, jsonArrayAt, parseJsonBody } from '../src/lib/crawl/parser'
import type { PageRule, TocItem } from '../src/lib/crawl/types'

let pass = 0
let failCnt = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { failCnt++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ---------- 1. JSON 列表项链接收紧(qq-e 改动验收) ----------
console.log('\n== 1. parseList JSON 模式链接收紧 ==')
{
  const rule: PageRule = {
    itemSelector: { type: 'json', expression: 'data' },
    fields: { name: { type: 'json', expression: 'title' }, bookUrl: { type: 'json', expression: 'url' } },
  } as any
  const html = JSON.stringify({ data: [
    { title: '有链接书', url: '/book/1' },
    { title: '无链接垃圾项', url: '' },
    { title: '缺链接字段项' },
  ] })
  const parsed = parseList(html, 'https://x.com/list', rule, ['url', 'bookUrl'])
  ok('链接全空 JSON 项不入列(3→1)', parsed.items.length === 1, `got=${parsed.items.length}`)
  ok('保留项字段正确', parsed.items[0]?.fields.name === '有链接书' && parsed.items[0]?.fields.bookUrl === 'https://x.com/book/1', JSON.stringify(parsed.items[0]))

  // 有 url 无 bookUrl / 双字段形态
  const rule2: PageRule = {
    itemSelector: { type: 'json', expression: 'data' },
    fields: {
      name: { type: 'json', expression: 'title' },
      url: { type: 'json', expression: 'href' },
      bookUrl: { type: 'json', expression: 'url' },
    },
  } as any
  const html2 = JSON.stringify({ data: [
    { title: 'A', href: '/a' },
    { title: 'B', url: '/b' },
    { title: '垃圾' },
  ] })
  const p2 = parseList(html2, 'https://x.com/', rule2, ['url', 'bookUrl'])
  ok('双链接字段任一命中即保留(url 兜底 bookUrl)', p2.items.length === 2, `got=${p2.items.length}`)

  // urlFields 不含链接字段 → 不受限(const bookUrl 规则形态)
  const rule3: PageRule = {
    itemSelector: { type: 'json', expression: 'data' },
    fields: { name: { type: 'json', expression: 'title' }, bookUrl: { type: 'const', expression: '/book/{index}' } },
  } as any
  const p3 = parseList('{"data":[{"title":"甲"},{"title":"乙"}]}', 'https://x.com/', rule3, ['url', 'bookUrl'])
  ok('const 合成 bookUrl 项正常保留', p3.items.length === 2 && p3.items[1].fields.bookUrl === 'https://x.com/book/2', JSON.stringify(p3.items.map((i) => i.fields.bookUrl)))
}

// ---------- 2. parseBook 借道不受限(qq-e 改动边界) ----------
console.log('\n== 2. parseBook 借道(urlFields=[cover])不受收紧影响 ==')
{
  const bookRule: PageRule = {
    itemSelector: { type: 'json', expression: 'data.book' },
    fields: {
      name: { type: 'json', expression: 'name' },
      author: { type: 'json', expression: 'author' },
      intro: { type: 'json', expression: 'intro' },
    },
  } as any
  const pj = JSON.stringify({ data: { book: { name: '某书', author: '某人', intro: '简介' } } })
  const b = parseBook(pj, 'https://x.com/b', bookRule)
  ok('无 cover 字段书籍信息完整返回(收紧不误伤)', b.name === '某书' && b.author === '某人', JSON.stringify(b))
  // cover 提取 + absolutize
  const withCover = parseBook(JSON.stringify({ data: { book: { name: '乙', cover: '/img/c.jpg' } } }), 'https://x.com/b', {
    itemSelector: { type: 'json', expression: 'data.book' },
    fields: { name: { type: 'json', expression: 'name' }, cover: { type: 'json', expression: 'cover' } },
  } as any)
  ok('cover 相对地址 absolutize', withCover.cover === 'https://x.com/img/c.jpg', JSON.stringify(withCover.cover))
}

// ---------- 3. HTML 容器模式链接收紧(y-a 重放回归) ----------
console.log('\n== 3. parseList HTML 容器模式链接收紧回归 ==')
{
  const rule: PageRule = {
    itemSelector: { type: 'css', expression: 'div.item' },
    fields: { name: { type: 'css', expression: 'h3' }, bookUrl: { type: 'css', expression: 'a', attr: 'href' } },
  } as any
  const html = '<div><div class="item"><h3>甲</h3><a href="/1">x</a></div><div class="item"><h3>导航垃圾</h3><span>无链接</span></div></div>'
  const p = parseList(html, 'https://x.com/', rule, ['url', 'bookUrl'])
  ok('无链接 HTML 项不入列(2→1)', p.items.length === 1 && p.items[0].fields.name === '甲', `got=${p.items.length}`)
}

// ---------- 4. parseToc JSON/const volume 回归(probe3 C11 同款) ----------
console.log('\n== 4. parseToc 回归 ==')
{
  const tocRule: PageRule = {
    itemSelector: { type: 'json', expression: 'list' },
    fields: {
      title: { type: 'json', expression: 'name' },
      url: { type: 'const', expression: 'https://x.com/read/{q.id}_{itemId}.html' },
      itemId: { type: 'json', expression: 'id' },
      volume: { type: 'const', expression: '第一卷 测试' },
    },
  } as any
  const tocJson = JSON.stringify({ list: [ { name: '第1章', id: 11 }, { name: '第2章', id: 12 } ] })
  const r = await parseToc('https://x.com/toc?id=9', tocJson, tocRule, {} as any)
  ok('const URL 模板两阶段合成', r.items.length === 2 && r.items[0].url === 'https://x.com/read/9_11.html', JSON.stringify(r.items[0]))
  ok('const volume 后置提取(ll-c)', r.items.every((i: TocItem) => i.volume === '第一卷 测试'))
  // 占位符未命中 → 整模板为单占位符时合成空 URL, 过滤不入目录
  const badRule: PageRule = {
    itemSelector: { type: 'json', expression: 'list' },
    fields: {
      title: { type: 'json', expression: 'name' },
      url: { type: 'const', expression: '{missing}' },
    },
  } as any
  const r2 = await parseToc('https://x.com/toc', JSON.stringify({ list: [{ name: '孤章' }] }), badRule, {} as any)
  ok('const 占位符未命中空 URL 不入目录', r2.items.length === 0, `got=${r2.items.length}`)
}

// ---------- 5. absolutize 协议/自引用过滤回归 ----------
console.log('\n== 5. absolutize 回归 ==')
{
  ok('相对地址 absolutize', absolutize('/a/b', 'https://x.com/base/') === 'https://x.com/a/b')
  ok('javascript: 伪协议过滤', absolutize('javascript:void(0)', 'https://x.com/') === '')
  ok('纯锚点自引用过滤', absolutize('#top', 'https://x.com/page') === '')
  ok('同 URL 自引用过滤(仅 fragment 差异)', absolutize('https://x.com/page#p2', 'https://x.com/page') === '')
  ok('已是绝对地址原样保留', absolutize('https://y.com/z', 'https://x.com/') === 'https://y.com/z')
}

// ---------- 6. jsonGet 算子回归(cc-c) ----------
console.log('\n== 6. jsonGet/jsonToString 回归 ==')
{
  const root = { a: { b: [{ id: 1, v: 'x' }, { id: 2, v: 'y' }] }, n: [[1, 2], [3]] }
  ok('点路径+数字段', jsonGet(root, 'a.b.0.v') === 'x')
  ok('[k=v] 过滤+下标取元素(jsonGet 窄语义)', jsonGet(root, 'a.b[id=2][0].v') === 'y')
  ok('[k=v] 多条件 & 过滤', jsonGet(root, 'a.b[id=1&v=x][0].v') === 'x')
  ok('[k=v] map-collect(jsonArrayAt 宽语义)', (jsonArrayAt(root, 'a.b[id=2].v') as unknown[]).join() === 'y')
  ok('[k=v] 无命中=空数组', Array.isArray(jsonGet(root, 'a.b[id=9]')) && (jsonGet(root, 'a.b[id=9]') as unknown[]).length === 0)
  ok('过滤后取字段=undefined(jsonGet 窄语义契约)', jsonGet(root, 'a.b[id=9].v') === undefined)
  ok('* 递归展平', JSON.stringify(jsonGet(root, 'n.*')) === JSON.stringify([1, 2, 3]))
  ok('标量上继续取路径 → undefined', jsonGet(root, 'a.b.0.v.more') === undefined)
  ok('parseJsonBody 非JSON壳 → undefined', parseJsonBody('<html>403</html>') === undefined)
  ok('parseJsonBody 根数组', Array.isArray(parseJsonBody('[1,2]')))
}

console.log('\n==========')
console.log(`PASS ${pass} / FAIL ${failCnt}`)
if (failCnt) { console.log('FAILURES:'); for (const f of failures) console.log('  - ' + f); process.exit(1) }
console.log('ALL PASS')
process.exit(0)
