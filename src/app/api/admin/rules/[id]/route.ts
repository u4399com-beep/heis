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

/** R6-4: 清理规则关联的校准任务运行时状态 + 持久化结果 ——
 *  R5-11 audit 指出规则删除时未清理 globalThis `__novelCalibJobs_v1` Map 与 Setting
 *  `calibration:<ruleId>` 行, 导致:
 *   - 内存泄漏: Map 条目驻留至进程重启(~1KB / 已校准规则)
 *   - DB bloat: Setting 行永久残留(~5KB / 已校准规则)
 *   - 信息泄漏: 已删规则的校准结果仍可经 GET /api/admin/rules/<id>/calibrate 查到
 *  修法: 删除规则后同步清理两处状态(静默失败, 不阻塞删除主流程)。
 *  注: jobMap 与 calibrate 路由共用 globalThis 单例, 此处只 delete 当前规则的 key,
 *      不影响其他规则的在途 job。 */
function cleanupCalibrateArtifacts(ruleId: string): void {
  // 1) 清理进程级 Map 中的 job 条目(running 态的 abortFlag 不再被触发, 但 Map 占内存)
  try {
    const g = globalThis as unknown as { __novelCalibJobs_v1?: Map<string, unknown> }
    g.__novelCalibJobs_v1?.delete(ruleId)
  } catch { /* ignore */ }
  // 2) 清理 Setting 表中的持久化校准结果(异步, 失败不阻塞)
  try {
    void db.setting.delete({ where: { key: `calibration:${ruleId}` } }).catch(() => {})
  } catch { /* ignore */ }
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
      // R6-4: 删除成功后清理校准 job Map + Setting 残留
      cleanupCalibrateArtifacts(id)
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
