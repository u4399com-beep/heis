// 解壳探针: book4.cc 列表页 html_b base64 解码 → 真实 DOM 结构分析
// 用法: bun run scripts/probe-cc-a-unwrap.ts [path]
import { readFileSync } from 'node:fs'

const file = process.argv[2] || '/home/z/my-project/tmp/cc-a/list-raw.html'
const raw = readFileSync(file, 'utf8')

// 提取 html_b="..." base64 串
const m = raw.match(/html_b\s*=\s*"([A-Za-z0-9+/=]+)"/)
if (!m) {
  console.log('!! html_b not found, shell page?')
  console.log(raw.slice(0, 1500))
  process.exit(1)
}
const html = Buffer.from(m[1], 'base64').toString('utf8')
console.log('decoded length:', html.length)

// 打印壳页 JS 渲染逻辑(尾部)
const tail = raw.slice(Math.max(0, raw.length - 3000))
console.log('=== SHELL TAIL (JS logic) ===')
console.log(tail)

// 真实 DOM 结构分析
console.log('=== DECODED HTML head 800 ===')
console.log(html.slice(0, 800))
console.log('=== 分析: 标题/链接结构 ===')
// 找列表项: 打印 body 主体中间段
const bodyIdx = html.indexOf('<body')
console.log('=== body ~ 6000 chars ===')
console.log(html.slice(bodyIdx, bodyIdx + 6000))
process.exit(0)

export {}
