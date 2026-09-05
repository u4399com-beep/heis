// 下载任务批量操作: delete(逐条 safeJoin+DOWNLOADS_DIR 限定后删成品文件) / retry / regenerate
// retry/regenerate 委托既有 POST handler(../route.ts): 完整复用其入参消毒/书籍校验/任务创建/异步生成路径
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { DATA_ROOT, DOWNLOADS_DIR } from '@/lib/crawl/storage'
import { withGuard, safeJoin, errText } from '../../../_lib/http'
import { parseBatchBody, skipItem, type BatchSkippedItem } from '../../../_lib/batch'
import { promises as fs } from 'fs'
import { POST as createDownloadJob } from '../route'

/** 成品文件清理(与单删完全同语义: 边界校验通过才删, 尽力而为) */
async function removeArtifact(filePath: string | null | undefined) {
  if (!filePath) return
  const full = safeJoin(DATA_ROOT, filePath)
  if (full && full.startsWith(DOWNLOADS_DIR)) {
    try {
      await fs.rm(full)
    } catch {
      /* ignore */
    }
  }
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const parsed = parseBatchBody(await readBody(req), ['delete', 'retry', 'regenerate'])
    if (!parsed.ok) return fail(parsed.message)
    const { action, ids } = parsed
    const skipped: BatchSkippedItem[] = []
    let affected = 0

    const rows = await db.downloadJob.findMany({
      where: { id: { in: ids } },
      include: { book: { select: { name: true } } },
    })
    const byId = new Map(rows.map((j) => [j.id, j]))

    for (const id of ids) {
      const job = byId.get(id)
      const label = job?.book?.name || job?.id
      if (!job) {
        skipped.push(skipItem('记录不存在(可能已删除)'))
        continue
      }

      if (action === 'delete') {
        // 逐条对齐单删: 成品文件 safeJoin 边界校验 + DOWNLOADS_DIR 限定后才删
        await removeArtifact(job.filePath)
        try {
          await db.downloadJob.delete({ where: { id } })
          affected++
        } catch (e: any) {
          // tt-b: e.message 含 Prisma 查询原文/路径, 不得入信封 → errText 消毒
          skipped.push(skipItem(errText(e), label))
        }
        continue
      }

      // retry: 仅失败任务; regenerate: 仅已完成任务
      if (action === 'retry' && job.status !== 'error') {
        skipped.push(skipItem('仅失败任务可重试', label))
        continue
      }
      if (action === 'regenerate' && job.status !== 'done') {
        skipped.push(skipItem('仅已完成任务可重新生成', label))
        continue
      }

      // 委托既有 POST handler: 原样携带旧任务 options, 由 POST 重新消毒校验
      // (书籍已删/无章节/配置脏数据等都会走 POST 的既有报错路径 → 进 skipped)
      let options: Record<string, unknown> = {}
      try {
        const parsedOptions: unknown = JSON.parse(job.options || '{}')
        if (parsedOptions && typeof parsedOptions === 'object' && !Array.isArray(parsedOptions)) {
          options = parsedOptions as Record<string, unknown>
        }
      } catch {
        /* 空对象兜底 */
      }
      try {
        const res = await createDownloadJob(
          new Request('http://internal/api/admin/downloads', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bookId: job.bookId, ...options }),
          })
        )
        const json: { ok?: boolean; message?: string } | null = await res.json().catch(() => null)
        if (!json?.ok) {
          skipped.push(skipItem(json?.message || `重建生成任务失败(${res.status})`, label))
          continue
        }
        // 旧记录保留(旧成品文件在新任务完成前仍可下载), 新任务在列表中自行推进
        affected++
      } catch (e: any) {
        skipped.push(skipItem(errText(e), label))
      }
    }

    return ok({ affected, skipped })
  })
}
