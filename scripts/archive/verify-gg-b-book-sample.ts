export {}
// gg-b 收编: wanben 真实书页样本(66KB, r1 代理窗口 S1 抢抓)离线核对 book 段选择器
// — fields={} 疑云最终甄别(选择器对错二分)
import { parseBook } from '../src/lib/crawl/parser'
import { readFileSync } from 'node:fs'

async function main() {
  const html = readFileSync('tmp/gg-b/wanben-book-95406838.html', 'utf8')
  const res = await fetch('http://localhost:3000/api/admin/rules/cmthf0hne08gbnktx1wnobuo5')
  const j: any = await res.json()
  if (!j.ok) { console.error('规则加载失败'); process.exit(2) }
  const cfg = JSON.parse(j.data.config)
  const book = parseBook(html, 'https://www.wanbenshenzhan.com/95406838/', cfg.book)
  console.log('parsed:', JSON.stringify(book, null, 1).slice(0, 800))
  const ok = !!(book.name && book.author && book.intro)
  console.log('VERDICT:', ok
    ? 'BOOK-SELECTORS-HIT ✅ — fields={} 疑云=fetch 层(node 运行时+代理直入 curl 链, TLS 指纹被 GoEdge 拦), 非选择器问题'
    : 'SELECTORS-MISS ❌ — 需修选择器')
  process.exit(ok ? 0 : 1)
}
main()
