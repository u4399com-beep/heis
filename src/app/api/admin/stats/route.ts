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
    const categories = await db.category.findMany({
      select: { id: true, name: true, _count: { select: { books: true } } },
      orderBy: { sortOrder: 'asc' },
    })
    return ok({
      books, chapters, rules, tasks, runningTasks, sites, tags, downloads,
      totalWords: wordAgg._sum.wordCount || 0,
      recentTasks, recentBooks, categories,
    })
  })
}
