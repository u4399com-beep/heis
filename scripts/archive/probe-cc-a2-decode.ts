// cc-a2 探针0: 解码 bookJson.html 的 dstr → book_data 结构 + chapter_list 单项全字段
import { readFileSync } from 'node:fs'

const raw = readFileSync('/home/z/my-project/tmp/cc-a/bookJson.html', 'utf8')
const m = raw.match(/dstr="([A-Za-z0-9+/=]+)"/)
if (!m) { console.log('dstr not found'); process.exit(1) }
const json = decodeURIComponent(Buffer.from(m[1], 'base64').toString('utf8'))
const data = JSON.parse(json)
console.log('top keys:', Object.keys(data))
for (const k of Object.keys(data)) {
  const v = (data as Record<string, unknown>)[k]
  if (Array.isArray(v)) { console.log(`  ${k}: array(${v.length})`) } else { console.log(`  ${k}:`, String(v).slice(0, 120)) }
}
const list = (data as { chapter_list?: unknown[] }).chapter_list || []
console.log('chapter_list[0]:', JSON.stringify(list[0]))
console.log('chapter_list[1]:', JSON.stringify(list[1]))
console.log('chapter_list[last]:', JSON.stringify(list[list.length - 1]))

// 章节 file_name 双层解包验证
const fn = (list[0] as { file_name?: string }).file_name || ''
console.log('\nfile_name[0]:', fn.slice(0, 80), '...')
const layer1 = Buffer.from(fn.replace(/\.html$/, ''), 'base64').toString('utf8')
console.log('layer1 decode:', layer1)
const inner = layer1.split('/').pop() || ''
const layer2 = Buffer.from(inner.replace(/\.json$/, ''), 'base64').toString('utf8')
console.log('layer2 decode:', layer2)
process.exit(0)
export {}
