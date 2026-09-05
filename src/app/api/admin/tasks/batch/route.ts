// 任务批量操作: start / pause / stop / delete
// start/pause/stop 逐个复用 tasks/[id]/control 真实路径(终态重置 + TaskRunner.control),
// 单个失败不中断整批, 失败项进 skipped[{name, reason}]; delete 对运行中任务跳过(isRunning 语义)
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { TaskRunner } from '@/lib/crawl/runner'
import { withGuard, errText } from '../../../_lib/http'
import { parseBatchBody, skipItem, type BatchSkippedItem } from '../../../_lib/batch'

const ACTIONS = ['start', 'pause', 'stop', 'delete'] as const
type BatchAction = (typeof ACTIONS)[number]

/** 终态: start 前需重置为 pending(与单条 control 路由一致) */
const FINAL_STATUSES = ['done', 'error', 'stopped']

export async function POST(req: Request) {
  return withGuard(async () => {
    const parsed = parseBatchBody(await readBody(req), [...ACTIONS])
    if (!parsed.ok) return fail(parsed.message)
    const { action, ids } = parsed
    const act = action as BatchAction
    const skipped: BatchSkippedItem[] = []
    let affected = 0

    if (act === 'delete') {
      const rows = await db.task.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      const byId = new Map(rows.map((t) => [t.id, t]))
      for (const id of ids) {
        const t = byId.get(id)
        if (!t) {
          skipped.push(skipItem('任务不存在(可能已删除)'))
          continue
        }
        // 运行中任务跳过而非强停 — 与单删"先停止再删"的主动语义不同, 批量选择保护优先
        if (TaskRunner.instance.isRunning(id)) {
          skipped.push(skipItem('任务运行中, 请先停止再删除', t.name))
          continue
        }
        try {
          // jj-e: 删除前取消已排定的自动刷新定时器(防幽灵 timer 触发后撞 404)
          TaskRunner.instance.cancelAutoRefresh(id)
          await db.task.delete({ where: { id } })
          affected++
        } catch (e: any) {
          // tt-b: e.message 含 Prisma 查询原文/路径, 不得入信封 → errText 消毒
          skipped.push(skipItem(errText(e), t.name))
        }
      }
      return ok({ affected, skipped })
    }

    // start / pause / stop: 逐个走与单条完全相同的控制路径
    const rows = await db.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, status: true },
    })
    const byId = new Map(rows.map((t) => [t.id, t]))
    for (const id of ids) {
      const t = byId.get(id)
      if (!t) {
        skipped.push(skipItem('任务不存在(可能已删除)'))
        continue
      }
      try {
        // 启动前重置终态(状态机: done/error/stopped → pending 后由 runner 置 running)
        if (act === 'start' && FINAL_STATUSES.includes(t.status)) {
          await db.task.update({ where: { id }, data: { status: 'pending' } })
        }
        // 运行/暂停/停止的状态机校验在 TaskRunner.control 内(运行中 start 拒绝 / 未运行 pause 拒绝 / stop 幂等)
        const res = await TaskRunner.instance.control(id, act)
        if (!res.ok) {
          skipped.push(skipItem(res.message, t.name))
          continue
        }
        affected++
      } catch (e: any) {
        skipped.push(skipItem(errText(e), t.name))
      }
    }
    return ok({ affected, skipped })
  })
}
