// 下载任务: 详情/删除
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { promises as fs } from 'fs'
import { DOWNLOADS_DIR, DATA_ROOT } from '@/lib/crawl/storage'
import { withGuard, safeJoin } from '../../../_lib/http'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const job = await db.downloadJob.findUnique({ where: { id }, include: { book: { select: { name: true } } } })
    if (!job) return fail('任务不存在', 404)
    return ok(job)
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const job = await db.downloadJob.findUnique({ where: { id } })
    if (!job) return fail('任务不存在', 404)
    // filePath 为相对 data/ 的路径, 删除前必须做目录边界校验(防路径穿越)
    if (job.filePath) {
      const full = safeJoin(DATA_ROOT, job.filePath)
      // 成品文件必须位于 downloads/ 目录内
      if (full && full.startsWith(DOWNLOADS_DIR)) {
        try { await fs.rm(full) } catch { /* ignore */ }
      }
    }
    try {
      await db.downloadJob.delete({ where: { id } })
    } catch (e: any) {
      // tt-b: 预检与 delete 间的并发删除窗口(P2025)原会裸 500 → 404 契约
      if (e?.code === 'P2025') return fail('任务不存在, 请刷新后重试', 404)
      throw e
    }
    return ok()
  })
}
