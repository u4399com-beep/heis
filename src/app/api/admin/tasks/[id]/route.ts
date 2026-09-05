// 任务详情/在线调节(线程/间隔等)/删除
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { TaskRunner } from '@/lib/crawl/runner'
import { withGuard, str } from '../../../_lib/http'
import { normalizeTaskData, validateTaskPair } from '../_shared'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const task = await db.task.findUnique({ where: { id }, include: { rule: true } })
    if (!task) return fail('任务不存在', 404)
    return ok({ ...task, live: TaskRunner.instance.isRunning(id) })
  })
}

// 在线调节: 线程范围/间隔范围/重采模式等, 运行中也可调整
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const exist = await db.task.findUnique({ where: { id } })
    if (!exist) return fail('任务不存在', 404)

    const { data, error } = normalizeTaskData({ ...exist, ...body }, 'partial')
    if (error) return fail(error)

    // ruleId 变更时校验目标规则存在, 防FK 500
    if (body?.ruleId !== undefined) {
      const ruleId = str(body.ruleId, 64).trim()
      if (!ruleId) return fail('请选择采集规则')
      const rule = await db.rule.findUnique({ where: { id: ruleId } })
      if (!rule) return fail('规则不存在', 404)
      data.ruleId = ruleId
    }

    // 模式与URL联动: 用"现值+补丁"合并后的生效值校验
    const pairErr = validateTaskPair(
      (data.mode as string) ?? exist.mode,
      (data.bookUrl as string) ?? exist.bookUrl,
      (data.listUrl as string) ?? exist.listUrl
    )
    if (pairErr) return fail(pairErr)

    // FK 竞态兜底(主控z遗留项): ruleId 校验通过后规则被并发删除 → update 落 P2003 原会裸 500
    let task: Awaited<ReturnType<typeof db.task.update>>
    try {
      task = await db.task.update({ where: { id }, data })
    } catch (e: any) {
      if (e?.code === 'P2003') return fail('所选采集规则已被删除, 请刷新后重试', 409)
      if (e?.code === 'P2025') return fail('任务不存在, 请刷新后重试', 404)
      throw e
    }

    // ll-d: autoRefresh 开关交互链闭环 — PUT 显式携带 autoRefresh/refreshIntervalMin 时同步排定面:
    // ① 终态任务补开开关(或改间隔) → 立即按合并后间隔排定(原实现只在 done/error 时与进程重启
    //    recoverOnBoot 排定, 完成后才补开开关会静默失效直到下次重启);
    // ② 显式关闭 → 立即取消已排定 timer(与 DELETE/stop 语义对齐, 不再依赖触发时复核)。
    // 运行中/未终态不排定(完成时统一处理); TaskMonitor 在线调参 PUT 不含这两个字段 → 零扰动。
    if (body?.autoRefresh !== undefined || body?.refreshIntervalMin !== undefined) {
      try {
        const mergedAuto = data.autoRefresh !== undefined ? data.autoRefresh : exist.autoRefresh
        const mergedInterval = data.refreshIntervalMin !== undefined ? Number(data.refreshIntervalMin) : exist.refreshIntervalMin
        if (mergedAuto === false) {
          TaskRunner.instance.cancelAutoRefresh(id)
        } else if (['done', 'error', 'stopped'].includes(exist.status) && !TaskRunner.instance.isRunning(id)) {
          TaskRunner.instance.scheduleAutoRefresh(id, mergedInterval, task.name)
        }
      } catch { /* 排定面异常不影响任务更新主流程 */ }
    }

    return ok(task)
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const exist = await db.task.findUnique({ where: { id } })
    if (!exist) return fail('任务不存在', 404)
    // 运行中先发停止信号, 再删记录
    if (TaskRunner.instance.isRunning(id)) {
      await TaskRunner.instance.control(id, 'stop')
    }
    // jj-e: 取消已排定的自动刷新定时器(防幽灵 timer 触发后撞 404)
    TaskRunner.instance.cancelAutoRefresh(id)
    try {
      await db.task.delete({ where: { id } })
    } catch (e: any) {
      // tt-b: 存在性预检与 delete 间的并发删除窗口原会裸 500 → 回归 404 契约
      if (e?.code === 'P2025') return fail('任务不存在, 请刷新后重试', 404)
      throw e
    }
    return ok()
  })
}
