// ============================================================
// gg-a A1 修前基准: 用当前(内存拼接)实现为最少的书(联剑风云录 41章)生成一份 TXT 留档
// 目的: 流式落盘改造后, 重新生成并逐字节 diff, 证明输出格式零变化
// 运行: bun scripts/verify-gg-a-txt-baseline.ts
// ============================================================
export {}

import { generateBookTxt } from '../src/lib/crawl/downloader'
import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { DATA_ROOT } from '../src/lib/crawl/storage'

// 确定性 PRNG 替换 Math.random: generateBookTxt 的广告选取/混淆插入依赖 Math.random,
// 两次运行必须逐字节一致才能做 diff —— 用 mulberry32 固定随机序列(混淆+广告路径全开)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
;(Math as { random: () => number }).random = mulberry32(20260206)

const BOOK_ID = 'cmtdrei6r00rkmv4zeu0bix4f' // 联剑风云录 41章(库内最少), db 存储
const BASELINE = path.join(process.cwd(), 'tmp/gg-a/baseline.txt')

const res = await generateBookTxt(BOOK_ID, {}, '测试站', 'https://example.test')
const abs = path.join(DATA_ROOT, res.rel)
const buf = await fs.readFile(abs)
const sha = createHash('sha256').update(buf).digest('hex')
await fs.mkdir(path.dirname(BASELINE), { recursive: true })
await fs.writeFile(BASELINE, buf)
await fs.unlink(abs) // 基准留档后删除成品, 保持 downloads 目录干净
console.log(`[baseline] rel=${res.rel} size=${res.size} chapters=${res.chapters}`)
console.log(`[baseline] sha256=${sha}`)
console.log(`[baseline] saved → tmp/gg-a/baseline.txt (${buf.length} bytes)`)
process.exit(0)
