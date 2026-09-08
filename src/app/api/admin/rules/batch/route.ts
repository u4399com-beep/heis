// 规则批量操作: delete(整批原子 — 任一规则被任务引用则 409 整批拒绝)
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard } from '../../../_lib/http'
import { parseBatchBody } from '../../../_lib/batch'

/** R6-4: 与单条 DELETE 同款清理校准 job Map + Setting 残留, 防内存泄漏 + DB bloat。 */
function cleanupCalibrateArtifacts(ruleId: string): void {
  try {
    const g = globalThis as unknown as { __novelCalibJobs_v1?: Map<string, unknown> }
    g.__novelCalibJobs_v1?.delete(ruleId)
  } catch { /* ignore */ }
  try {
    void db.setting.delete({ where: { key: `calibration:${ruleId}` } }).catch(() => {})
  } catch { /* ignore */ }
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const parsed = parseBatchBody(await readBody(req), ['delete'])
    if (!parsed.ok) return fail(parsed.message)
    const { ids } = parsed

    // 整批预检: 语义与单删一致(被任务引用的规则不可删), 但批量上升为"整批原子" —
    // 任一规则存在引用即拒绝整批, 不做部分删除(避免一半删除一半报错的中间态)
    const used = await db.task.groupBy({
      by: ['ruleId'],
      where: { ruleId: { in: ids } },
      _count: { ruleId: true },
    })
    if (used.length > 0) {
      const rules = await db.rule.findMany({
        where: { id: { in: used.map((u) => u.ruleId) } },
        select: { id: true, name: true },
      })
      const conflicts = used.map((u) => ({
        name: rules.find((r) => r.id === u.ruleId)?.name || u.ruleId,
        count: u._count.ruleId,
      }))
      return fail(
        `以下规则仍被采集任务引用, 已整批拒绝删除: ${conflicts
          .map((c) => `「${c.name}」(${c.count} 个任务)`)
          .join('、')}`,
        409
      )
    }

    try {
      const res = await db.rule.deleteMany({ where: { id: { in: ids } } })
      // R6-4: 批量删除成功后, 逐条清理校准 job Map + Setting 残留(与单删同款)
      for (const id of ids) cleanupCalibrateArtifacts(id)
      return ok({ affected: res.count })
    } catch (e: any) {
      // P2003 外键约束(并发期间新建了引用任务) → 兜底为整批拒绝, 不留半删状态
      // R4A-16: 删除原 P2005 分支 —— deleteMany 不抛 P2025(只有 unique where 的 delete/update
      //  抛 P2025), 该 catch 是死代码; 未来重构若误依赖该分支会产生误导。
      if (e?.code === 'P2003') {
        return fail('删除时发现规则仍被任务引用(并发变更), 已整批拒绝, 请刷新后重试', 409)
      }
      throw e
    }
  })
}
