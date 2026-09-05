// 分类批量操作: delete(force 事务"先摘书再删类") / order(按勾选顺序重排)
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard } from '../../../_lib/http'
import { parseBatchBody, skipItem, type BatchSkippedItem } from '../../../_lib/batch'

export async function POST(req: Request) {
  return withGuard(async () => {
    const parsed = parseBatchBody(await readBody(req), ['delete', 'order'])
    if (!parsed.ok) return fail(parsed.message)
    const { action, ids, payload } = parsed
    const skipped: BatchSkippedItem[] = []

    switch (action) {
      // ---------------- 批量删除: force=false 有书 409 附各分类本书数; force=true 事务摘书+删类 ----------------
      case 'delete': {
        const rows = await db.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        const byId = new Map(rows.map((c) => [c.id, c]))
        for (const id of ids) {
          if (!byId.has(id)) skipped.push(skipItem('分类不存在(可能已删除)'))
        }
        if (rows.length === 0) return ok({ affected: 0, skipped })

        // 预检各分类在册书籍数(与单删"请先移除"语义对齐, 批量提供 force 通道)
        const counts = await db.book.groupBy({
          by: ['categoryId'],
          where: { categoryId: { in: rows.map((c) => c.id) } },
          _count: { _all: true },
        })
        const withBooks = counts.filter((c) => (c._count?._all || 0) > 0)
        const force = payload.force === true

        if (withBooks.length > 0 && !force) {
          const detail = withBooks
            .map((c) => `「${byId.get(c.categoryId as string)?.name || c.categoryId}」${c._count?._all || 0} 本`)
            .join('、')
          return fail(`以下分类仍有书籍, 已整批拒绝删除: ${detail}。可勾选「强制删除」将书籍移出分类后再删`, 409)
        }

        // force: 事务内"先摘书再删类", 任一步失败整体回滚(与单删的拒绝语义相比多提供的显式破坏性通道)
        let booksDetached = 0
        try {
          await db.$transaction(async (tx) => {
            for (const c of rows) {
              const r = await tx.book.updateMany({ where: { categoryId: c.id }, data: { categoryId: null } })
              booksDetached += r.count
              await tx.category.delete({ where: { id: c.id } })
            }
          })
        } catch (e: any) {
          if (e?.code === 'P2025') {
            return fail('部分分类已不存在(并发变更), 已整体回滚, 请刷新后重试', 409)
          }
          throw e
        }
        return ok({ affected: rows.length, booksDetached, skipped })
      }

      // ---------------- 批量重排: ids 即目标顺序(前端按勾选顺序), 整体预检 + 事务按下标写 sortOrder ----------------
      case 'order': {
        // 修复(y-c): payload.order 不走 parseBatchBody 的 ids 通道(那里有 500 上限),
        // 超大数组会逐条 update 全部塞进单个 $transaction 打成巨型事务
        if (ids.length > 500) return fail('单批最多重排 500 个分类', 400)
        const rows = await db.category.findMany({ where: { id: { in: ids } }, select: { id: true } })
        if (rows.length !== ids.length) {
          return fail('部分分类不存在, 已整体取消重排, 请刷新后重试', 404)
        }
        try {
          await db.$transaction(async (tx) => {
            for (let i = 0; i < ids.length; i++) {
              await tx.category.update({ where: { id: ids[i] }, data: { sortOrder: i } })
            }
          })
        } catch (e: any) {
          if (e?.code === 'P2025') {
            return fail('部分分类已不存在(并发变更), 请刷新后重试', 409)
          }
          throw e
        }
        return ok({ affected: ids.length, skipped })
      }

      default:
        return fail('无效的批量操作')
    }
  })
}
