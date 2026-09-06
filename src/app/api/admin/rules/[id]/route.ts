// 规则详情/更新/删除
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { collectRegexIssues } from '@/lib/crawl/types'
import { withGuard, str, isPlainObject } from '../../../_lib/http'

/** 规则配置序列化: 对象→JSON字符串; 字符串→原样; 均限制大小 */
function configToString(v: unknown): string | null {
  if (isPlainObject(v)) {
    const s = JSON.stringify(v)
    return s.length > 200_000 ? null : s
  }
  if (typeof v === 'string') return v.length > 200_000 ? null : v
  return null
}

/** regex 入口防线(gg-a, 与 POST /api/admin/rules 同款口径): 非法/灾难型嵌套量词正则 400 拒绝 */
function regexGate(v: unknown): string | null {
  const issues = collectRegexIssues(v)
  if (!issues.length) return null
  return `规则配置存在非法/危险正则, 已拒绝保存: ${issues.map((i) => `${i.field} ${i.reason}`).join('; ')}`
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const rule = await db.rule.findUnique({ where: { id } })
    if (!rule) return fail('规则不存在', 404)
    return ok(rule)
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const exist = await db.rule.findUnique({ where: { id } })
    if (!exist) return fail('规则不存在', 404)

    const data: Record<string, unknown> = {}
    if (body?.name !== undefined) {
      const name = str(body.name, 100).trim()
      if (!name) return fail('规则名称不能为空')
      data.name = name
    }
    if (body?.description !== undefined) data.description = str(body.description, 500)
    if (body?.enabled !== undefined) data.enabled = !!body.enabled
    if (body?.config !== undefined) {
      const regexError = regexGate(body.config)
      if (regexError) return fail(regexError, 400)
      const config = configToString(body.config)
      if (config === null) return fail('规则配置过大或类型非法')
      data.config = config
    }
    const rule = await db.rule.update({ where: { id }, data })
    return ok(rule)
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const exist = await db.rule.findUnique({ where: { id } })
    if (!exist) return fail('规则不存在', 404)
    const inUse = await db.task.count({ where: { ruleId: id } })
    if (inUse > 0) return fail(`该规则被 ${inUse} 个采集任务引用, 请先删除任务`)
    try {
      await db.rule.delete({ where: { id } })
    } catch (e: any) {
      // 预检与 delete 之间存在并发窗口: 新任务引用了该规则(P2003 外键约束) / 规则被并发删除(P2025)
      // 与 rules/batch 的整批拒绝语义对齐, 不再裸 500
      if (e?.code === 'P2003') return fail('删除时发现规则仍被任务引用(并发变更), 请刷新后重试', 409)
      if (e?.code === 'P2025') return fail('规则不存在, 请刷新后重试', 404)
      throw e
    }
    return ok()
  })
}
