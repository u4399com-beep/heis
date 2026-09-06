// 任务日志(增量轮询)
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { withGuard, str } from '../../../../_lib/http'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const url = new URL(req.url)
    const after = str(url.searchParams.get('after'), 64).trim()

    // 任务存在性校验: 不存在的任务直接 404, 避免前端对僵尸任务空轮询
    const task = await db.task.findUnique({ where: { id }, select: { id: true } })
    if (!task) return fail('任务不存在', 404)

    // API-5: 顺手清理本任务 30 天前的 TaskLog —— runner 持续 push 增量日志, 不收敛会无限增长
    // 拉高 DB 体积/拖慢 findMany; 读取路径上顺手 deleteMany, 失败不阻塞主流程
    try {
      await db.taskLog.deleteMany({
        where: { taskId: id, createdAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
      })
    } catch { /* 清理失败不阻塞日志读取 */ }

    const logs = await db.taskLog.findMany({
      where: { taskId: id, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: 200,
    })
    return ok(logs)
  })
}
