// 书籍批量操作: delete / category / status / recrawl / t2s(存量繁转简)
// 语义与单条路由严格对齐: 单删 404 → 跳过不计 affected; 状态/分类白名单校验一致
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { deleteBookTxt, readChapterTxt, DATA_ROOT, NOVELS_DIR } from '@/lib/crawl/storage'
// 繁转简导出由 cleaner 提供(采集链路同源); 若导出未就绪属并行在途, 收编后自然可用
import { t2sText, t2sHtml } from '@/lib/crawl/cleaner'
import { TaskRunner } from '@/lib/crawl/runner'
import { withGuard, safeJoin, errText } from '../../../_lib/http'
import { parseBatchBody, payloadString, skipItem, type BatchSkippedItem } from '../../../_lib/batch'
import { removeCoverIfOrphan } from '../_cover'
import { promises as fs } from 'fs'

const BOOK_STATUSES = ['unknown', 'ongoing', 'completed'] as const
/** 单批重采上限: 逐本建任务并立即启动, 过大易压垮调度 */
const RECRAWL_MAX = 20
/** 单批繁转简上限: 分钟级同步长请求, 必须分批 */
const T2S_MAX_BOOKS = 50
/** 繁转简章节分批大小 + 批间让出事件循环 */
const T2S_CHAPTER_BATCH = 100

export async function POST(req: Request) {
  return withGuard(async () => {
    const parsed = parseBatchBody(await readBody(req), ['delete', 'category', 'status', 'recrawl', 't2s'])
    if (!parsed.ok) return fail(parsed.message)
    const { action, ids, payload } = parsed
    const skipped: BatchSkippedItem[] = []

    switch (action) {
      // ---------------- 批量删除(与单条 DELETE 对齐: 清txt目录 + 级联删章节/标签/下载记录) ----------------
      case 'delete': {
        const books = await db.book.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, cover: true } })
        const byId = new Map(books.map((b) => [b.id, b]))
        for (const id of ids) {
          if (!byId.has(id)) {
            skipped.push(skipItem('书籍不存在(可能已删除)'))
            continue
          }
          await deleteBookTxt(id)
        }
        const existIds = books.map((b) => b.id)
        const res = existIds.length ? await db.book.deleteMany({ where: { id: { in: existIds } } }) : { count: 0 }
        // 本地独占封面文件清理(共享引用/外链不动, 尽力而为; 与单条 DELETE 同语义)
        for (const b of books) {
          await removeCoverIfOrphan(b.cover)
        }
        return ok({ affected: res.count, skipped })
      }

      // ---------------- 批量设分类(空串→null 置为未分类) ----------------
      case 'category': {
        const cid = payloadString(payload, 'categoryId', 64) || ''
        if (cid) {
          const cat = await db.category.findUnique({ where: { id: cid }, select: { id: true } })
          if (!cat) return fail('所选分类不存在', 404)
        }
        const res = await db.book.updateMany({
          where: { id: { in: ids } },
          data: { categoryId: cid || null },
        })
        return ok({ affected: res.count, skipped })
      }

      // ---------------- 批量设状态(白名单与单条 PUT 一致) ----------------
      case 'status': {
        const st = payloadString(payload, 'status', 20) || ''
        if (!(BOOK_STATUSES as readonly string[]).includes(st)) return fail('无效的书籍状态')
        const res = await db.book.updateMany({ where: { id: { in: ids } }, data: { status: st } })
        return ok({ affected: res.count, skipped })
      }

      // ---------------- 批量重采(单批>20整体拒绝; 逐本建任务并启动; 单失败进 skipped) ----------------
      case 'recrawl': {
        if (ids.length > RECRAWL_MAX) {
          return fail(`单次批量重采最多 ${RECRAWL_MAX} 本, 请分批操作`, 400)
        }
        const mode = payloadString(payload, 'mode', 10) === 'full' ? 'full' : 'incremental'
        const books = await db.book.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, sourceUrl: true, sourceRuleId: true, storageMode: true },
        })
        const byId = new Map(books.map((b) => [b.id, b]))
        const fallbackRule = await db.rule.findFirst({ select: { id: true } })
        if (!fallbackRule) return fail('系统中无采集规则, 请先创建')

        let affected = 0
        for (const id of ids) {
          const b = byId.get(id)
          if (!b) {
            skipped.push(skipItem('书籍不存在(可能已删除)'))
            continue
          }
          if (!b.sourceUrl) {
            skipped.push(skipItem('无来源地址, 无法重采集', b.name))
            continue
          }
          try {
            // 与单条 /books/[id]/recrawl 一致: 优先来源规则, 失效则回退任一可用规则
            let ruleId = b.sourceRuleId
            if (!ruleId || !(await db.rule.findUnique({ where: { id: ruleId }, select: { id: true } }))) {
              ruleId = fallbackRule.id
            }
            const task = await db.task.create({
              data: {
                name: `${mode === 'full' ? '完全覆盖' : '增量更新'}重采:《${b.name.slice(0, 80)}》`,
                ruleId,
                mode: 'single',
                bookUrl: b.sourceUrl,
                recrawlMode: mode,
                storageMode: b.storageMode === 'txt' ? 'txt' : 'db',
                threadMin: 2,
                threadMax: 4,
                intervalMin: 300,
                intervalMax: 1200,
                smartCategory: false,
                smartComplete: true,
                autoSuggest: false,
              },
            })
            const res = await TaskRunner.instance.control(task.id, 'start')
            if (!res.ok) {
              skipped.push(skipItem(`任务已创建但启动失败: ${res.message}`, b.name))
              continue
            }
            affected++
          } catch (e: any) {
            // tt-b: e.message 含 Prisma 查询原文/路径, 不得入信封 → errText 消毒
            skipped.push(skipItem(errText(e), b.name))
          }
        }
        return ok({ affected, skipped })
      }

      // ---------------- 存量繁转简(单批>50拒绝; 书间让出; 零写库检测门; txt定点重写) ----------------
      case 't2s': {
        if (ids.length > T2S_MAX_BOOKS) {
          return fail(`繁转简单次最多 ${T2S_MAX_BOOKS} 本(同步转换耗时较长), 请分批操作`, 400)
        }
        const books = await db.book.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, author: true, intro: true, keywords: true, latestChapter: true },
        })
        const byId = new Map(books.map((b) => [b.id, b]))

        let bookUpdated = 0
        let chapterUpdated = 0
        let txtFailed = 0

        for (const id of ids) {
          const b = byId.get(id)
          if (!b) {
            skipped.push(skipItem('书籍不存在(可能已删除)'))
            continue
          }
          try {
            // 1) 书籍 5 字段: name/author/intro/keywords/latestChapter — 仅变化才 update
            const data: Record<string, string> = {}
            for (const k of ['name', 'author', 'intro', 'keywords', 'latestChapter'] as const) {
              const v = b[k]
              if (typeof v !== 'string' || !v) continue
              const cv = t2sText(v)
              if (typeof cv === 'string' && cv !== v) data[k] = cv
            }
            if (Object.keys(data).length > 0) {
              await db.book.update({ where: { id }, data })
              bookUpdated++
            }

            // 2) 章节: title(t2sText) + content(t2sHtml), 每批 100 章按 idx 顺序游标推进
            let lastIdx = -1
            for (;;) {
              const chapters = await db.chapter.findMany({
                where: { bookId: id, idx: { gt: lastIdx } },
                orderBy: { idx: 'asc' },
                take: T2S_CHAPTER_BATCH,
                select: { id: true, idx: true, title: true, content: true, storage: true, filePath: true },
              })
              if (chapters.length === 0) break
              lastIdx = chapters[chapters.length - 1].idx

              for (const ch of chapters) {
                if (ch.storage === 'txt') {
                  // txt 模式: 正文以文件为准 → readChapterTxt 读原文, 首行 title 其余正文, 定点重写
                  const full = ch.filePath ? safeJoin(DATA_ROOT, ch.filePath) : null
                  if (!full || !full.startsWith(NOVELS_DIR)) {
                    txtFailed++
                    continue
                  }
                  const raw = await readChapterTxt(ch.filePath || '')
                  if (raw === null) {
                    txtFailed++
                    continue
                  }
                  const nl = raw.indexOf('\n')
                  const firstLine = nl === -1 ? raw : raw.slice(0, nl)
                  const rest = nl === -1 ? '' : raw.slice(nl) // 保留起始换行(标题与正文间空行结构)
                  const newTitle = t2sText(firstLine)
                  const newRest = t2sText(rest) // txt 正文为纯文本, 用 t2sText
                  if (
                    typeof newTitle !== 'string' ||
                    typeof newRest !== 'string' ||
                    (newTitle === firstLine && newRest === rest)
                  ) {
                    continue
                  }
                  try {
                    await fs.writeFile(full, `${newTitle}${newRest}`, 'utf-8')
                  } catch {
                    txtFailed++
                    continue
                  }
                  const dbTitle = newTitle.trim()
                  if (dbTitle && dbTitle !== ch.title) {
                    await db.chapter.update({ where: { id: ch.id }, data: { title: dbTitle } })
                  }
                  chapterUpdated++
                } else {
                  // db 模式: title → t2sText, content → t2sHtml; wordCount 与单条编辑同口径重算
                  const newTitle = t2sText(ch.title || '')
                  const newContent = ch.content ? t2sHtml(ch.content) : ch.content
                  if (typeof newTitle !== 'string') continue
                  if (newTitle === ch.title && newContent === ch.content) continue
                  const data: Record<string, unknown> = { title: newTitle }
                  if (ch.content && typeof newContent === 'string') {
                    data.content = newContent
                    data.wordCount = newContent.replace(/<[^>]+>/g, '').length
                  }
                  await db.chapter.update({ where: { id: ch.id }, data })
                  chapterUpdated++
                }
              }
              // 批间让出事件循环, 避免长请求饿死其它并发处理
              await new Promise((r) => setImmediate(r))
            }
          } catch (e: any) {
            skipped.push(skipItem(`转换失败: ${errText(e)}`, b.name))
          }
          // 书间让出: 逐本处理期间让其它请求有机会插队
          await new Promise((r) => setImmediate(r))
        }

        // 零写库检测门: 全程未产生任何 DB/文件写入 → 如实回报 noop, 前端不按成功转换提示
        return ok({
          affected: bookUpdated,
          chapters: chapterUpdated,
          txtFailed,
          skipped,
          noop: bookUpdated + chapterUpdated === 0,
        })
      }

      default:
        return fail('无效的批量操作')
    }
  })
}
