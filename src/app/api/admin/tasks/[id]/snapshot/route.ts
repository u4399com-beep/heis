// 任务实时快照 (agent-H-features)
// 返回运行中任务的内存态计数器(requestCount/bytesFetched/currentUrl/recentLogs 等),
// 不读 DB(进度可能落后内存 5~10s), 由调用方按需 merge DB progress 数据。
// ETA 公式: (totalBooks - processedBooks) * (now - runStartedAt) / processedBooks
//  其中 totalBooks = progress.booksTotal, processedBooks = progress.booksDone
//  processedBooks > 0 才计算, 否则 eta=null
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { TaskRunner } from '@/lib/crawl/runner'
import { withGuard } from '../../../../_lib/http'

interface ProgressSnapshot {
  booksTotal?: number
  booksDone?: number
  memBooksInQueue?: number
  memChaptersInQueue?: number
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const task = await db.task.findUnique({ where: { id }, select: { id: true, status: true, progress: true } })
    if (!task) return fail('任务不存在', 404)

    // 优先用内存 TaskRuntime 的实时值; 无运行时(任务未启动/已终态释放)则回退 DB progress
    const snap = TaskRunner.instance.snapshot(id)

    // 解析 DB progress JSON 提取 booksTotal/booksDone(供 ETA 计算)与 memBooksInQueue/memChaptersInQueue
    let dbProgress: ProgressSnapshot = {}
    try {
      const p = task.progress ? JSON.parse(task.progress) : {}
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        dbProgress = {
          booksTotal: typeof p.booksTotal === 'number' ? p.booksTotal : undefined,
          booksDone: typeof p.booksDone === 'number' ? p.booksDone : undefined,
          memBooksInQueue: typeof p.memBooksInQueue === 'number' ? p.memBooksInQueue : undefined,
          memChaptersInQueue: typeof p.memChaptersInQueue === 'number' ? p.memChaptersInQueue : undefined,
        }
      }
    } catch { /* 脏 progress 视为空 */ }

    // 任务未运行(无内存态): 返回 running:false, 仍带 DB progress 数据供 UI 渲染最终态
    if (!snap) {
      return ok({
        running: false,
        paused: false,
        status: task.status,
        requestCount: 0,
        bytesFetched: 0,
        runStartedAt: 0,
        currentUrl: '',
        maxRequests: 0,
        memBooksInQueue: dbProgress.memBooksInQueue ?? 0,
        memChaptersInQueue: dbProgress.memChaptersInQueue ?? 0,
        memResumeSetsSize: 0,
        recentLogs: [],
        failedBookUrlsCount: 0,
        eta: null,
      })
    }

    // ETA 计算: 剩余书籍数 * (now - runStartedAt) / 已处理书籍数
    // processedBooks > 0 才算, 否则 null(任务尚未处理任何书籍或刚启动)
    const total = dbProgress.booksTotal ?? 0
    const done = dbProgress.booksDone ?? 0
    const now = Date.now()
    let eta: number | null = null
    if (snap.runStartedAt > 0 && done > 0 && total > done) {
      const elapsedMs = now - snap.runStartedAt
      if (elapsedMs > 1000) { // 至少 1s 才算, 避免冷启动除 0 异常
        const perBookMs = elapsedMs / done
        const remaining = total - done
        eta = Math.ceil((remaining * perBookMs) / 1000) // 秒
      }
    }

    return ok({
      running: snap.running,
      paused: snap.paused,
      status: task.status,
      requestCount: snap.requestCount,
      bytesFetched: snap.bytesFetched,
      runStartedAt: snap.runStartedAt,
      currentUrl: snap.currentUrl,
      maxRequests: snap.maxRequests,
      memBooksInQueue: dbProgress.memBooksInQueue ?? 0,
      memChaptersInQueue: dbProgress.memChaptersInQueue ?? 0,
      memResumeSetsSize: snap.memResumeSetsSize,
      recentLogs: snap.recentLogs,
      failedBookUrlsCount: snap.failedBookUrlsCount,
      eta,
    })
  })
}
