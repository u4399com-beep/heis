// 统计
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { TaskRunner } from '@/lib/crawl/runner'
import { withGuard } from '../../_lib/http'

const globalForBoot = globalThis as unknown as { __novelBootRecovered?: boolean }

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
    return ok({
      books, chapters, rules, tasks, runningTasks, sites, tags, downloads,
      totalWords: wordAgg._sum.wordCount || 0,
      recentTasks, recentBooks, categories,
    })
  })
}
