// ============================================================
// gg-a A1 流式落盘改造验证: 修后 generateBookTxt 输出必须与修前内存拼接基准逐字节一致
// 基准: tmp/gg-a/baseline.txt (verify-gg-a-txt-baseline.ts 生成, sha256 记录在案)
// 另含: 半成品清理断言(写盘失败 → 无残留文件)
// 运行: bun scripts/verify-gg-a-txt-stream.ts
// ============================================================
export {}

import { generateBookTxt } from '../src/lib/crawl/downloader'
import { openDownloadTxtWriter } from '../src/lib/crawl/storage'
import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { DATA_ROOT } from '../src/lib/crawl/storage'

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
;(Math as { random: () => number }).random = mulberry32(20260206) // 与基准脚本同种子: 混淆/广告路径全开且确定性

const BOOK_ID = 'cmtdrei6r00rkmv4zeu0bix4f' // 联剑风云录 41章(库内最少)
const BASELINE = path.join(process.cwd(), 'tmp/gg-a/baseline.txt')
const EXPECTED_SHA = '04bede38676a29568ea39636c72c680b7b25523d00ba9abb32630a8836ff2032'

console.log('\n== ① 修后流式生成 vs 修前基准逐字节对比 ==')
{
  const baseBuf = await fs.readFile(BASELINE)
  const baseSha = createHash('sha256').update(baseBuf).digest('hex')
  assert('基准文件 sha256 与开工记录一致(基准未被污染)', baseSha === EXPECTED_SHA, baseSha)

  const res = await generateBookTxt(BOOK_ID, {}, '测试站', 'https://example.test')
  const abs = path.join(DATA_ROOT, res.rel)
  const newBuf = await fs.readFile(abs)
  const newSha = createHash('sha256').update(newBuf).digest('hex')
  assert(`字节数一致(${newBuf.length} vs ${baseBuf.length})`, newBuf.length === baseBuf.length)
  assert(`sha256 逐字节一致(流式落盘 ≡ 内存拼接)`, newSha === EXPECTED_SHA, `got ${newSha}`)
  assert('Buffer.equals 逐字节相等', newBuf.equals(baseBuf))
  assert('章节数一致(41)', res.chapters === 41)
  console.log(`     rel=${res.rel} size=${res.size}`)
  await fs.unlink(abs) // 成品清理, 保持 downloads 目录干净
}

console.log('\n== ② 半成品清理(中途失败 → 无残留文件) ==')
{
  // 直接驱动 writer: 模拟"写了若干段后失败" → abort() 应删除半成品
  const w = await openDownloadTxtWriter('gg_a_stream_abort_probe')
  const relPath = path.join(DATA_ROOT, w.rel)
  await w.write('部分内容'.repeat(100))
  assert('写入后文件存在', await fs.stat(relPath).then(() => true).catch(() => false))
  await w.abort()
  assert('abort() 后半成品文件已删除', await fs.stat(relPath).then(() => false).catch(() => true))
}

console.log('\n== ③ 空分隔符 gap 语义(chapterGap="") ==')
{
  // chapterGap='' 时 join ≡ 无缝拼接, emit 的 gap 分支写 '' 应为 no-op 且无额外字节
  const w = await openDownloadTxtWriter('gg_a_stream_gap_probe')
  const relPath = path.join(DATA_ROOT, w.rel)
  await w.write('A')
  await w.write('')   // 空段 no-op
  await w.write('B')
  const { size } = await w.finish()
  const content = await fs.readFile(relPath, 'utf-8')
  assert(`写入序列 A,'',B → "AB"(size=${size})`, content === 'AB')
  await fs.unlink(relPath)
}

console.log(`\n== 结果: ${pass} pass / ${fail} fail ==`)
process.exit(fail > 0 ? 1 : 0)
