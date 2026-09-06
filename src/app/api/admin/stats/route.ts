// 统计
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { TaskRunner } from '@/lib/crawl/runner'
import { logger } from '@/lib/logger'
import { withGuard } from '../../_lib/http'

const globalForBoot = globalThis as unknown as { __novelBootRecovered?: boolean }

// ---------------- 时间序列辅助: 近 7 天分桶 ----------------
// 生成 [{day:'MM-DD', count:0}, ...] 共 7 项(最旧在前, 含今日, 全 0 占位)
function empty7d(): Array<{ day: string; count: number }> {
  const out: Array<{ day: string; count: number }> = []
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    out.push({ day: `${mm}-${dd}`, count: 0 })
  }
  return out
}

/** 把 createdAt 列表分桶到 7 天序列(就地填 count) */
function bucketize7d(
  rows: Array<{ createdAt: Date }>,
): Array<{ day: string; count: number }> {
  const buckets = empty7d()
  // day 字符串 → bucket 索引, O(1) 查
  const idx = new Map<string, number>()
  buckets.forEach((b, i) => idx.set(b.day, i))
  for (const r of rows) {
    const d = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)
    if (isNaN(d.getTime())) continue
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const key = `${mm}-${dd}`
    const i = idx.get(key)
    if (i !== undefined) buckets[i].count++
  }
  return buckets
}

export async function GET() {
  return withGuard(async () => {
    // 服务启动恢复: 曾在运行的任务转入暂停 (每个进程仅执行一次)
    if (!globalForBoot.__novelBootRecovered) {
      globalForBoot.__novelBootRecovered = true
      TaskRunner.instance.recoverOnBoot().catch(() => {})
    }

    // API-5: 仪表盘加载时顺手做一次全局 TaskLog 清理(30 天前) —— 单任务级清理已在 logs 路由做,
    // 此处兜底跨任务清理(例如已删除任务的孤儿日志、长期未访问任务的历史日志)
    try {
      await db.taskLog.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
      })
    } catch { /* 清理失败不阻塞仪表盘渲染 */ }

    const [books, chapters, rules, tasks, runningTasks, sites, tags, downloads] = await Promise.all([
      db.book.count(),
      db.chapter.count(),
      db.rule.count(),
      db.task.count(),
      db.task.count({ where: { status: { in: ['running', 'paused'] } } }),
      db.site.count(),
      db.bookTag.count(),
      db.downloadJob.count(),
    ])
    const wordAgg = await db.chapter.aggregate({ _sum: { wordCount: true } })
    const recentTasks = await db.task.findMany({ orderBy: { updatedAt: 'desc' }, take: 6, include: { rule: { select: { name: true } } } })
    const recentBooks = await db.book.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: { id: true, name: true, author: true, cover: true, status: true, updatedAt: true, _count: { select: { chapters: true } } },
    })
    // API-12: 加 take: 500 上限, 防止分类膨胀时把全表拉回(分类一般 <60, 500 足够余量)
    const categories = await db.category.findMany({
      select: { id: true, name: true, _count: { select: { books: true } } },
      orderBy: { sortOrder: 'asc' },
      take: 500,
    })

    // ============= feat-b: 可视化扩展字段 (每个独立 try/catch, 失败 → 空数组, 不阻塞主流程) =============
    // 1) 分类字数排行 — book.groupBy(categoryId, _sum wordCount) + categories 名称合并
    let wordsByCategory: Array<{ name: string; words: number }> = []
    try {
      const catAgg = await db.book.groupBy({
        by: ['categoryId'],
        _sum: { wordCount: true },
        where: { categoryId: { not: null } },
      })
      const wmap = new Map<string, number>()
      for (const row of catAgg) {
        if (row.categoryId) wmap.set(row.categoryId, row._sum.wordCount || 0)
      }
      wordsByCategory = categories
        .map((c) => ({ name: c.name, words: wmap.get(c.id) || 0 }))
        .sort((a, b) => b.words - a.words)
    } catch (e) {
      logger.warn('stats wordsByCategory failed', { err: (e as Error)?.message })
    }

    // 2) 书籍状态分布 — book.groupBy(status)
    let booksByStatus: Array<{ status: string; count: number }> = []
    try {
      const rows = await db.book.groupBy({ by: ['status'], _count: true })
      booksByStatus = rows.map((r) => ({ status: r.status, count: r._count }))
    } catch (e) {
      logger.warn('stats booksByStatus failed', { err: (e as Error)?.message })
    }

    // 3) 近 7 天章节入库曲线 — fetch createdAt 后分桶 (select 仅取 createdAt, 控制 IO)
    let chaptersLast7d: Array<{ day: string; count: number }> = empty7d()
    try {
      const since = new Date(Date.now() - 6 * 24 * 3600 * 1000)
      since.setHours(0, 0, 0, 0)
      const rows = await db.chapter.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      })
      chaptersLast7d = bucketize7d(rows)
    } catch (e) {
      logger.warn('stats chaptersLast7d failed', { err: (e as Error)?.message })
    }

    // 4) 近 7 天书籍入库曲线
    let booksLast7d: Array<{ day: string; count: number }> = empty7d()
    try {
      const since = new Date(Date.now() - 6 * 24 * 3600 * 1000)
      since.setHours(0, 0, 0, 0)
      const rows = await db.book.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      })
      booksLast7d = bucketize7d(rows)
    } catch (e) {
      logger.warn('stats booksLast7d failed', { err: (e as Error)?.message })
    }

    // 5) 任务状态分布 — task.groupBy(status)
    let taskStatusBreakdown: Array<{ status: string; count: number }> = []
    try {
      const rows = await db.task.groupBy({ by: ['status'], _count: true })
      taskStatusBreakdown = rows.map((r) => ({ status: r.status, count: r._count }))
    } catch (e) {
      logger.warn('stats taskStatusBreakdown failed', { err: (e as Error)?.message })
    }

    return ok({
      books, chapters, rules, tasks, runningTasks, sites, tags, downloads,
      totalWords: wordAgg._sum.wordCount || 0,
      recentTasks, recentBooks, categories,
      // feat-b 可视化字段
      wordsByCategory,
      booksByStatus,
      chaptersLast7d,
      booksLast7d,
      taskStatusBreakdown,
    })
  })
}
