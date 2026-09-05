// 任务控制: start / pause / stop
import { readBody, ok, fail } from '@/lib/api'
import { TaskRunner } from '@/lib/crawl/runner'
import { db } from '@/lib/db'
import { withGuard, str } from '../../../../_lib/http'

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

    // 启动前重置终态(状态机: done/error/stopped → pending 后由 runner 置 running)
    // zz-d: updateMany 条件原子写 —— 修前无条件 update 存在竞态覆写窗口(读到旧终态快照
    // 的并发 start 可把已被其他请求置为 running/paused 的状态覆写回 pending, 标签漂移);
    // 条件不满足(count=0)时静默放行, 后续 TaskRunner.control 的状态机校验兜底
    if (act === 'start' && ['done', 'error', 'stopped'].includes(task.status)) {
      try {
        const r = await db.task.updateMany({ where: { id, status: { in: ['done', 'error', 'stopped'] } }, data: { status: 'pending' } })
        if (r.count === 0) {
          // 并发窗口内状态已变(任务被删/已被他请求推进): 按当前实际状态重查给准确反馈
          const cur = await db.task.findUnique({ where: { id }, select: { status: true } })
          if (!cur) return fail('任务不存在, 请刷新后重试', 404)
        }
      } catch (e: any) {
        // tt-b: 预检与重置间的并发删除窗口(P2025)原会裸 500 → 404 契约
        if (e?.code === 'P2025') return fail('任务不存在, 请刷新后重试', 404)
        throw e
      }
    }
    // 运行/暂停/停止的具体状态机校验在 TaskRunner.control 内:
    // 运行中 start → 拒绝; 未运行 pause → 拒绝; stop 幂等
    const res = await TaskRunner.instance.control(id, act)
    if (!res.ok) return fail(res.message)
    return ok({ action: act })
  })
}
