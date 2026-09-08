// 任务控制: start / pause / stop
import { readBody, ok, fail } from '@/lib/api'
import { TaskRunner } from '@/lib/crawl/runner'
import { db } from '@/lib/db'
import { withGuard } from '../../../../_lib/http'

const ACTIONS = ['start', 'pause', 'stop'] as const
type ControlAction = (typeof ACTIONS)[number]

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const action = String(body?.action || '')
    if (!(ACTIONS as readonly string[]).includes(action)) return fail('无效操作')
    const act = action as ControlAction

    const task = await db.task.findUnique({ where: { id } })
    if (!task) return fail('任务不存在', 404)

    // R5-7: 先调用 TaskRunner.control, 成功后再更新 DB 终态重置 ——
    //  旧行为先把 DB 置 pending 再 control, 若 control 因熔断冷却返回 {ok:false},
    //  DB 已被改为 pending 但 runtime 没启动, 任务永久卡在 pending 误导用户。
    //  现先 control(若失败直接 return fail, DB 不变), 成功后才 updateMany 置 pending。
    // 运行/暂停/停止的具体状态机校验在 TaskRunner.control 内:
    // 运行中 start → 拒绝; 未运行 pause → 拒绝; stop 幂等
    const res = await TaskRunner.instance.control(id, act)
    if (!res.ok) return fail(res.message)

    // control 成功后, 才把 done/error/stopped → pending 由 runner 置 running
    // zz-d: updateMany 条件原子写 —— 修前无条件 update 存在竞态覆写窗口(读到旧终态快照
    // 的并发 start 可把已被其他请求置为 running/paused 的状态覆写回 pending, 标签漂移);
    // 条件不满足(count=0)时静默放行(runtime 已接管, 不再依赖 DB 状态)
    if (act === 'start' && ['done', 'error', 'stopped'].includes(task.status)) {
      try {
        await db.task.updateMany({ where: { id, status: { in: ['done', 'error', 'stopped'] } }, data: { status: 'pending' } })
      } catch (e: any) {
        // tt-b: 预检与重置间的并发删除窗口(P2025)原会裸 500 → 404 契约
        // 注: control 已成功(runtime 已开始); DB 状态后续由 runner 自动同步, 这里返回 ok 即可
        if (e?.code === 'P2025') return ok({ action: act })
        throw e
      }
    }
    return ok({ action: act })
  })
}
