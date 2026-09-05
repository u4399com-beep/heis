// 章节批量操作: delete / markUnfetched
// 语义与单条 DELETE 对齐: txt 章节文件删除前必须 safeJoin(DATA_ROOT) 边界校验且位于 novels/ 内
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { DATA_ROOT, NOVELS_DIR } from '@/lib/crawl/storage'
import { withGuard, safeJoin, errText } from '../../../_lib/http'
import { parseBatchBody, skipItem, type BatchSkippedItem } from '../../../_lib/batch'
import { promises as fs } from 'fs'

export async function POST(req: Request) {
  return withGuard(async () => {
    const parsed = parseBatchBody(await readBody(req), ['delete', 'markUnfetched'])
    if (!parsed.ok) return fail(parsed.message)
    const { action, ids } = parsed
    const skipped: BatchSkippedItem[] = []

    const rows = await db.chapter.findMany({
      where: { id: { in: ids } },
      select: { id: true, storage: true, filePath: true },
    })
    const found = new Set(rows.map((r) => r.id))
    for (const id of ids) {
      if (!found.has(id)) skipped.push(skipItem('章节不存在(可能已删除)'))
    }

    switch (action) {
      // ---------------- 批量删除(逐条对齐单删: txt 孤儿文件尽力清理) ----------------
      case 'delete': {
        for (const ch of rows) {
          if (ch.storage === 'txt' && ch.filePath) {
            const full = safeJoin(DATA_ROOT, ch.filePath)
            if (full && full.startsWith(NOVELS_DIR)) {
              try {
                await fs.rm(full, { force: true })
              } catch {
                /* 尽力而为 */
              }
            }
          }
        }
        const res = rows.length
          ? await db.chapter.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
          : { count: 0 }
        return ok({ affected: res.count, skipped })
      }

      // ---------------- 批量标记未采: fetched=false + content/filePath/wordCount 清空, url 保留供重采 ----------------
      case 'markUnfetched': {
        let affected = 0
        for (const ch of rows) {
          // txt 章节清空 filePath 前先清理对应文件, 防孤儿文件残留(边界校验同上)
          if (ch.storage === 'txt' && ch.filePath) {
            const full = safeJoin(DATA_ROOT, ch.filePath)
            if (full && full.startsWith(NOVELS_DIR)) {
              try {
                await fs.rm(full, { force: true })
              } catch {
                /* 尽力而为 */
              }
            }
          }
          try {
            await db.chapter.update({
              where: { id: ch.id },
              data: { fetched: false, content: null, filePath: null, wordCount: 0 },
            })
            affected++
          } catch (e: any) {
            // tt-b(同 oo 轮番茄 chapter.update P2025 型): 预检与 update 间章节被并发级联删除
            // (书籍删除/采集引擎重建)原会裸 500 且中断整批 → 单项降级 skipped, 批内其余继续
            skipped.push(skipItem(errText(e)))
          }
        }
        return ok({ affected, skipped })
      }

      default:
        return fail('无效的批量操作')
    }
  })
}
