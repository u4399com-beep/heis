// ============================================================
// gg-a A2 下载生成并发上限验证
// flood 模式(修前证据): git stash 路由修复后运行 —— 6 并发 POST 全部 200(无上限)=修前失败实证
// cap   模式(修后): 6 并发 POST → 恰 3 个 200 + 3 个 429(信封含限额文案); 全部完成后 done;
//                   陈旧 pending(2h 前)被入口自愈清扫置 error 并让出额度
// 运行: bun scripts/verify-gg-a-dlcap.ts flood | cap
// ============================================================
export {}

import { db } from '../src/lib/db'
import { promises as fs } from 'fs'
import path from 'path'
import { DATA_ROOT } from '../src/lib/crawl/storage'

const PROBE_BOOK_ID = 'cmtdrei6r00rkmv4zeu0bix4f' // 联剑风云录 41章(生成快)
const BASE = 'http://localhost:3000'
const OPTIONS = JSON.stringify({ siteInfo: false, insertAds: false, obfuscate: false }) // 快速生成形态

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}

async function cleanupProbeJobs() {
  const jobs = await db.downloadJob.findMany({ where: { bookId: PROBE_BOOK_ID } })
  for (const j of jobs) {
    if (j.filePath) {
      const full = path.join(DATA_ROOT, j.filePath)
      if (full.startsWith(path.join(DATA_ROOT, 'downloads') + path.sep)) {
        await fs.rm(full, { force: true }).catch(() => {})
      }
    }
    await db.downloadJob.delete({ where: { id: j.id } }).catch(() => {})
  }
  return jobs.length
}

async function postDownload(): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/admin/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId: PROBE_BOOK_ID, options: { siteInfo: false, insertAds: false, obfuscate: false } }),
  })
  let body: any = null
  try { body = await res.json() } catch { /* ignore */ }
  return { status: res.status, body }
}

const mode = process.argv[2] || 'cap'

if (mode === 'flood') {
  console.log('\n== 修前证据: 无上限实现 6 并发 POST ==')
  await cleanupProbeJobs()
  const results = await Promise.all(Array.from({ length: 6 }, () => postDownload()))
  const oks = results.filter((r) => r.status === 200).length
  const created = results.filter((r) => r.status === 200 && r.body?.data?.id).length
  console.log(`  6 并发 POST → ${oks} 个 200(全部放行, created=${created}), 状态序列: ${results.map((r) => r.status).join(',')}`)
  assert('修前: 6 个并发生成作业全部被放行(无上限=可刷 N 个全量生成)', oks === 6 && created === 6)
  const cleaned = await cleanupProbeJobs()
  console.log(`  清理探针任务 ${cleaned} 条`)
} else {
  console.log('\n== ① 修后: 6 并发 POST → 恰 3 放行 + 3×429 ==')
  await cleanupProbeJobs()
  const results = await Promise.all(Array.from({ length: 6 }, () => postDownload()))
  const oks = results.filter((r) => r.status === 200).length
  const r429 = results.filter((r) => r.status === 429).length
  const rejectedMsg = results.find((r) => r.status === 429)?.body?.message || ''
  console.log(`  状态序列: ${results.map((r) => r.status).join(',')}`)
  assert('恰 3 个放行(200)', oks === 3, `got ${oks}`)
  assert('恰 3 个 429', r429 === 3, `got ${r429}`)
  assert('429 信封为统一 {ok:false,message} 且含限额文案', results.every((r) => r.status !== 429 || (r.body?.ok === false && rejectedMsg.includes('3 个下载任务进行中'))), rejectedMsg)

  // 等待 3 个生成作业完成(41章书秒级), 断言终态与成品文件存在
  let doneCount = 0
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const jobs = await db.downloadJob.findMany({ where: { bookId: PROBE_BOOK_ID } })
    doneCount = jobs.filter((j) => j.status === 'done' && j.filePath).length
    if (doneCount === 3) {
      for (const j of jobs) {
        if (j.filePath) {
          const exists = await fs.stat(path.join(DATA_ROOT, j.filePath)).then(() => true).catch(() => false)
          assert(`成品文件在盘(${path.basename(j.filePath)})`, exists)
        }
      }
      break
    }
  }
  assert('3 个放行任务全部完成(done+成品在盘)', doneCount === 3, `done=${doneCount}`)
  await cleanupProbeJobs()

  console.log('\n== ② 陈旧 pending 自愈清扫(重启孤儿不再占用额度) ==')
  const staleBook = await db.book.findFirstOrThrow({ where: { id: PROBE_BOOK_ID } })
  void staleBook
  await db.downloadJob.create({
    data: {
      bookId: PROBE_BOOK_ID,
      options: OPTIONS,
      status: 'pending',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 小时前 = 超过 1h 孤儿阈值
    },
  })
  const post2 = await postDownload()
  assert('存在 1 条陈旧 pending 时新 POST 仍放行(清扫让出额度)', post2.status === 200, `status=${post2.status}`)
  const staleAfter = await db.downloadJob.findFirst({ where: { bookId: PROBE_BOOK_ID, createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } })
  assert('陈旧 pending 已被置 error(自愈)', staleAfter?.status === 'error', `status=${staleAfter?.status}`)
  assert('error 文案指向重新发起', (staleAfter?.error || '').includes('重新发起'))
  await cleanupProbeJobs()

  console.log('\n== ③ 额度释放后恢复正常创建(非永久锁死) ==')
  const post3 = await postDownload()
  assert('清场后 POST 正常 200', post3.status === 200, `status=${post3.status}`)
  await cleanupProbeJobs()
}

console.log(`\n== 结果: ${pass} pass / ${fail} fail ==`)
process.exit(fail > 0 ? 1 : 0)
