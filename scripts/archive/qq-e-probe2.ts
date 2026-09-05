// qq-e 探针2: cleaner/parser 边界侦察(只读)
import { cleanContentHtml, cleanChapterTitle, cleanTextField, t2sText } from '../src/lib/crawl/cleaner'
import { parseList, parseBook, absolutize, jsonGet, jsonArrayAt, parseJsonBody } from '../src/lib/crawl/parser'

console.log('--- C1: JSON模式列表项无URL(测试面板count虚高?) ---')
const jsonList = JSON.stringify({ data: [
  { title: '有链接书', url: '/book/1' },
  { title: '无链接书(垃圾项)', url: '' },
  { title: '另一个无链接', url: null },
]})
const rule: any = {
  type: 'json', expression: 'data',
  fields: { name: { type: 'json', expression: 'title' }, bookUrl: { type: 'json', expression: 'url' } },
}
const parsed = parseList(jsonList, 'https://x.com/list', rule, ['url', 'bookUrl'])
console.log('items =', parsed.items.length, JSON.stringify(parsed.items.map((i) => i.fields)))

console.log('--- C2: cleanChapterTitle 边界 ---')
console.log(JSON.stringify(cleanChapterTitle('第1章 大战《书名》')), JSON.stringify(cleanChapterTitle('第2章 转折_www.x.com首发')))
console.log(JSON.stringify(cleanChapterTitle('www.x.com')), JSON.stringify(cleanChapterTitle('龙争-虎斗 www.y.com')))
console.log(JSON.stringify(cleanChapterTitle('第3章 \u0000\u0001控制符')))

console.log('--- C3: NUL/CRLF 注入面 cleanTextField ---')
console.log(JSON.stringify(cleanTextField('标题\u0000\u0008\x0b尾')))
console.log(JSON.stringify(cleanTextField('a\r\nb\rc')))

console.log('--- C4: cleanContentHtml script/style 泄漏面 ---')
const dirty = '<div><p>正文一</p><script>alert(1)</script><style>.x{}</style><p>正文二</p><iframe src="x"></iframe></div>'
console.log(JSON.stringify(cleanContentHtml(dirty)))

console.log('--- C5: URL掩码 + 广告正则保护 ---')
const withUrl = '<p>正文一</p><p>请访问 https://example.com/book?id=1 看后续</p><p>广告 www.spam.com 速来</p>'
console.log(JSON.stringify(cleanContentHtml(withUrl)))

console.log('--- C6: 实体单遍解码 ---')
console.log(JSON.stringify(cleanTextField('&amp;lt;字面量&amp;gt;')))
console.log(JSON.stringify(cleanTextField('&#x1F600; emoji 实体')))

console.log('--- C7: absolutize 边界 ---')
console.log(JSON.stringify(absolutize('javascript:void(0)', 'https://a.com/b/c')), JSON.stringify(absolutize('#top', 'https://a.com/b/c')), JSON.stringify(absolutize('./', 'https://a.com/b/c')))
console.log(JSON.stringify(absolutize('/x?q=1', 'https://a.com/b/c')))

console.log('--- C8: jsonGet 算子 ---')
const j = JSON.parse('{"a":[{"k":1,"v":"x"},{"k":2,"v":"y"}],"n":[[1,2],[3]]}')
console.log(JSON.stringify(jsonGet(j, 'a[k=2].v')), JSON.stringify(jsonGet(j, 'n.*')), JSON.stringify(jsonGet(j, 'a.1.v')))
console.log(JSON.stringify(jsonArrayAt(j, 'a.v')))

console.log('--- C9: 繁体检测误伤守卫(乾县) ---')
console.log(JSON.stringify(t2sText('乾县位于陕西')), JSON.stringify(t2sText('書劍恩仇錄')))

console.log('--- C10: parseBook cover-only 规则不受 urlFields 收紧影响 ---')
const bookRule: any = { type: 'json', expression: 'data.book', fields: { name: { type: 'json', expression: 'name' } } }
const pj = JSON.stringify({ data: { book: { name: '某书' } } })
console.log(JSON.stringify(parseBook(pj, 'https://x.com/b', bookRule)))
process.exit(0)
