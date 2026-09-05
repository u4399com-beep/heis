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

    const logs = await db.taskLog.findMany({
      where: { taskId: id, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: 200,
    })
    return ok(logs)
  })
}
