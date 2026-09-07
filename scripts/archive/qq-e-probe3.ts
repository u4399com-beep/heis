// qq-e 探针3: 修正规则形态后的 parseList/parseBook JSON 行为 + 干净 regressions
import { parseList, parseBook, parseToc } from '../src/lib/crawl/parser'

console.log('--- C1-fix: JSON itemSelector 模式, 无URL垃圾项 ---')
const jsonList = JSON.stringify({ data: [
  { title: '有链接书', url: '/book/1' },
  { title: '无链接书(垃圾项)', url: '' },
]})
const rule: any = {
  itemSelector: { type: 'json', expression: 'data' },
  fields: { name: { type: 'json', expression: 'title' }, bookUrl: { type: 'json', expression: 'url' } },
}
const parsed = parseList(jsonList, 'https://x.com/list', rule, ['url', 'bookUrl'])
console.log('items =', parsed.items.length, JSON.stringify(parsed.items.map((i) => i.fields)))

console.log('--- C10-fix: parseBook JSON(cover-only) ---')
const bookRule: any = {
  itemSelector: { type: 'json', expression: 'data.book' },
  fields: { name: { type: 'json', expression: 'name' } },
}
const pj = JSON.stringify({ data: { book: { name: '某书' } } })
console.log(JSON.stringify(parseBook(pj, 'https://x.com/b', bookRule)))

console.log('--- C11: parseToc JSON 模式 const volume + 无href过滤 ---')
const tocJson = JSON.stringify({ list: [
  { name: '第1章', id: 11 },
  { name: '第2章', id: 12 },
  { name: '坏项', id: 13 },
]})
const tocRule: any = {
  itemSelector: { type: 'json', expression: 'list' },
  fields: {
    title: { type: 'json', expression: 'name' },
    url: { type: 'const', expression: 'https://x.com/read/{q.id}_{itemId}.html' },
    itemId: { type: 'json', expression: 'id' },
    volume: { type: 'const', expression: '第一卷 测试' },
  },
}
parseToc('https://x.com/toc?id=9', tocJson, tocRule, {} as any).then((r) => {
  console.log(JSON.stringify(r.items.map((i) => ({ t: i.title, u: i.url, v: i.volume }))))
  // C12: content 翻页 visited 防环语义纯查(无网络) — 仅确认导出可用
  console.log('parseToc JSON ok, pages =', r.pages)
  process.exit(0)
}).catch((e) => { console.error('ERR', e); process.exit(1) })
