// 采集任务 CRUD
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, str } from '../../_lib/http'
import { normalizeTaskData, validateTaskPair, TASK_STATUSES, type NormalizedTask } from './_shared'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const status = str(url.searchParams.get('status'), 20).trim()
    // 状态白名单过滤: 非法值忽略(不报错, 保持列表可用)
    const validStatus = (TASK_STATUSES as readonly string[]).includes(status) ? status : undefined
    const tasks = await db.task.findMany({
      where: validStatus ? { status: validStatus } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: { rule: { select: { id: true, name: true } } },
    })
    return ok(tasks)
  })
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody(req)

    const ruleId = str(body?.ruleId, 64).trim()
    if (!ruleId) return fail('请选择采集规则')
    const rule = await db.rule.findUnique({ where: { id: ruleId } })
    if (!rule) return fail('规则不存在', 404)

    const { data, error } = normalizeTaskData(body ?? {}, 'full')
    if (error) return fail(error)
    const pairErr = validateTaskPair(data.mode, data.bookUrl, data.listUrl)
    if (pairErr) return fail(pairErr)

    // full 模式下所有字段均已规范化
    // FK 竞态兜底(主控z遗留项): ruleId 校验通过后规则被并发删除 → create 落 P2003 原会裸 500
    try {
      const task = await db.task.create({
        data: { ...(data as NormalizedTask), ruleId },
      })
      return ok(task)
    } catch (e: any) {
      if (e?.code === 'P2003') return fail('所选采集规则已被删除, 请刷新后重试', 409)
      throw e
    }
  })
}
