// 站点批量操作: delete(默认站保护跳过) / theme(校验 THEMES 注册表) / offset(clampInt 钳制) / wheel(链轮参与开关)
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { THEMES } from '@/lib/crawl/themes'
import { withGuard, clampInt, errText } from '../../../_lib/http'
import { parseBatchBody, payloadString, skipItem, type BatchSkippedItem } from '../../../_lib/batch'

export async function POST(req: Request) {
  return withGuard(async () => {
    const parsed = parseBatchBody(await readBody(req), ['delete', 'theme', 'offset', 'wheel'])
    if (!parsed.ok) return fail(parsed.message)
    const { action, ids, payload } = parsed
    const skipped: BatchSkippedItem[] = []

    switch (action) {
      // ---------------- 批量删除: 默认站点保护(与单删一致), 跳过而非整批拒绝 ----------------
      case 'delete': {
        const rows = await db.site.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, isDefault: true },
        })
        const byId = new Map(rows.map((s) => [s.id, s]))
        let affected = 0
        for (const id of ids) {
          const s = byId.get(id)
          if (!s) {
            skipped.push(skipItem('站点不存在(可能已删除)'))
            continue
          }
          if (s.isDefault) {
            skipped.push(skipItem('默认站点不可删除', s.name))
            continue
          }
          try {
            await db.site.delete({ where: { id } })
            affected++
          } catch (e: any) {
            // tt-b: e.message 含 Prisma 查询原文/路径, 不得入信封 → errText 消毒
            skipped.push(skipItem(errText(e), s.name))
          }
        }
        return ok({ affected, skipped })
      }

      // ---------------- 批量换主题: themeId 必须在 THEMES 注册表内(与单条 PUT 校验一致) ----------------
      case 'theme': {
        const tid = payloadString(payload, 'themeId', 50) || ''
        if (!THEMES.some((t) => t.id === tid)) return fail('未知主题模板')
        const res = await db.site.updateMany({ where: { id: { in: ids } }, data: { themeId: tid } })
        return ok({ affected: res.count, skipped })
      }

      // ---------------- 批量设书库偏移量: clampInt 钳制(与单条 PUT 一致) ----------------
      case 'offset': {
        const offset = clampInt(payload.offset, 0, 0, 1_000_000_000)
        const res = await db.site.updateMany({ where: { id: { in: ids } }, data: { offset } })
        return ok({ affected: res.count, skipped })
      }

      // ---------------- 批量加入/移出站群链轮: inLinkWheel 布尔化(与单条 PUT 一致) ----------------
      case 'wheel': {
        const inLinkWheel = payload.inLinkWheel !== false
        const res = await db.site.updateMany({ where: { id: { in: ids } }, data: { inLinkWheel } })
        return ok({ affected: res.count, skipped })
      }

      default:
        return fail('无效的批量操作')
    }
  })
}
