// ============================================================
// 数据备份导入 — POST /api/admin/backup/restore
// 接受备份 JSON 体, 校验版本与结构后导入
// - mode='merge' (默认): upsert (按 id 逐条创建/更新, 保留引用)
// - mode='replace': 先删除目标表全部记录再插入 (危险, 客户端须二次确认)
// - 整个导入包在 db.$transaction 内, 任一失败 → 回滚
// - counts 不匹配实际数据只警告, 不拒绝
// - 返回 { ok, data: { imported: { books, chapters, rules, ... }, warnings, took } }
// ============================================================
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, isPlainObject } from '../../../_lib/http'
import { logger } from '@/lib/logger'

const BACKUP_VERSION = 1

/** 校验 + 导入主流程 */
export async function POST(req: Request) {
  return withGuard(async () => {
    const startedAt = Date.now()
    const body = await readBody<Record<string, unknown>>(req)
    if (!isPlainObject(body)) return fail('请求体必须是对象')

    // 客户端标准形态: { data: <完整备份对象>, mode: 'merge'|'replace' }
    // 备份对象本身也有 version 字段 → body.data.version 才是真正的备份版本
    // 兼容形态: 直接把整个备份对象作为 body 上传 (无 mode 包装) — 此时 mode 默认 merge
    let payload: Record<string, unknown>
    let mode: 'merge' | 'replace' = 'merge'

    const bodyData = body.data
    if (isPlainObject(bodyData) && (bodyData as Record<string, unknown>).version !== undefined) {
      // 标准包装
      payload = bodyData as Record<string, unknown>
      if (body.mode === 'replace') mode = 'replace'
    } else if (body.version !== undefined) {
      // 兼容: body 本身就是备份对象
      payload = body
    } else {
      return fail('备份格式不正确: 缺少 version 字段')
    }

    const version = Number(payload.version)
    if (!Number.isFinite(version) || version !== BACKUP_VERSION) {
      return fail(`备份版本不匹配 (当前支持 v${BACKUP_VERSION}, 收到 v${isNaN(version) ? '未知' : version})`)
    }
    const data = payload.data
    if (!isPlainObject(data)) return fail('备份缺少 data 字段')

    const warnings: string[] = []
    // 计数校验 (advisory)
    const counts = payload.counts
    if (isPlainObject(counts)) {
      const arr = (data as Record<string, unknown[]>)
      const checkPairs: [string, string][] = [
        ['books', 'books'], ['chapters', 'chapters'], ['rules', 'rules'],
        ['tasks', 'tasks'], ['sites', 'sites'], ['friendLinks', 'friendLinks'],
        ['categories', 'categories'], ['settings', 'settings'], ['downloadJobs', 'downloadJobs'],
      ]
      for (const [ck, dk] of checkPairs) {
        const expected = (counts as Record<string, unknown>)[ck]
        const actual = arr[dk]
        if (typeof expected === 'number' && Array.isArray(actual) && actual.length !== expected) {
          warnings.push(`${ck} 计数不匹配 (备份头部 ${expected} / 实际 ${actual.length})`)
        }
      }
    }

    // 取出各表数组 (缺失则空数组)
    const list = <T,>(key: string): T[] => {
      const v = (data as Record<string, unknown>)[key]
      return Array.isArray(v) ? (v as T[]) : []
    }

    const settings = list<{ key: string; value: string }>('settings')
    const categories = list<{ id: string; name: string; sortOrder?: number; createdAt?: string }>('categories')
    const sites = list<Record<string, unknown>>('sites')
    const friendLinks = list<Record<string, unknown>>('friendLinks')
    const rules = list<Record<string, unknown>>('rules')
    const books = list<Record<string, unknown>>('books')
    const tasks = list<Record<string, unknown>>('tasks')
    const downloadJobs = list<Record<string, unknown>>('downloadJobs')

    const imported = {
      settings: 0, categories: 0, sites: 0, friendLinks: 0, rules: 0,
      books: 0, chapters: 0, tags: 0, tasks: 0, downloadJobs: 0,
    }

    try {
      await db.$transaction(async (tx) => {
        // replace 模式: 按依赖倒序删除 (downloadJobs → tasks → chapters/tags → books → rules → sites/categories/friendLinks/links → settings)
        if (mode === 'replace') {
          await tx.downloadJob.deleteMany({})
          await tx.taskLog.deleteMany({}) // 删 task logs 孤儿 (即使备份不含也需清)
          await tx.task.deleteMany({})
          await tx.bookTag.deleteMany({})
          await tx.chapter.deleteMany({})
          await tx.book.deleteMany({})
          await tx.rule.deleteMany({})
          await tx.friendLink.deleteMany({})
          await tx.site.deleteMany({})
          await tx.category.deleteMany({})
          await tx.setting.deleteMany({})
        }

        // settings: key 唯一, 直接 upsert
        for (const s of settings) {
          if (!s || typeof s.key !== 'string' || !s.key) continue
          await tx.setting.upsert({
            where: { key: s.key },
            create: { key: s.key, value: typeof s.value === 'string' ? s.value : JSON.stringify(s.value ?? null) },
            update: { value: typeof s.value === 'string' ? s.value : JSON.stringify(s.value ?? null) },
          })
          imported.settings++
        }

        // categories: id 唯一
        for (const c of categories) {
          if (!c || typeof c.id !== 'string' || !c.id) continue
          await tx.category.upsert({
            where: { id: c.id },
            create: {
              id: c.id, name: String(c.name || '').slice(0, 100) || `分类-${c.id.slice(-4)}`,
              sortOrder: Number(c.sortOrder) || 0,
            },
            update: {
              name: String(c.name || '').slice(0, 100),
              sortOrder: Number(c.sortOrder) || 0,
            },
          })
          imported.categories++
        }

        // sites: id 唯一, domain 唯一
        for (const s of sites) {
          if (!s || typeof s.id !== 'string' || !s.id) continue
          const domain = String(s.domain || '').trim().toLowerCase()
          if (!domain) continue
          await tx.site.upsert({
            where: { id: s.id },
            create: {
              id: s.id, name: String(s.name || '').slice(0, 100) || `站点-${s.id.slice(-4)}`,
              domain,
              themeId: String(s.themeId || 'aurora').slice(0, 50),
              title: String(s.title || '').slice(0, 200),
              description: String(s.description || '').slice(0, 500),
              keywords: String(s.keywords || '').slice(0, 500),
              icbm: String(s.icbm || '35.86166,104.195397').slice(0, 50),
              geoRegion: String(s.geoRegion || 'CN').slice(0, 10),
              geoPlacename: String(s.geoPlacename || '中国').slice(0, 50),
              offset: Number(s.offset) || 0,
              isDefault: !!s.isDefault,
              status: s.status !== false,
              inLinkWheel: s.inLinkWheel !== false,
            },
            update: {
              name: String(s.name || '').slice(0, 100),
              themeId: String(s.themeId || 'aurora').slice(0, 50),
              title: String(s.title || '').slice(0, 200),
              description: String(s.description || '').slice(0, 500),
              keywords: String(s.keywords || '').slice(0, 500),
              icbm: String(s.icbm || '').slice(0, 50),
              geoRegion: String(s.geoRegion || 'CN').slice(0, 10),
              geoPlacename: String(s.geoPlacename || '中国').slice(0, 50),
              offset: Number(s.offset) || 0,
              status: s.status !== false,
              inLinkWheel: s.inLinkWheel !== false,
            },
          })
          imported.sites++
        }

        // friendLinks
        for (const l of friendLinks) {
          if (!l || typeof l.id !== 'string' || !l.id) continue
          const url = String(l.url || '').trim()
          if (!url) continue
          await tx.friendLink.upsert({
            where: { id: l.id },
            create: {
              id: l.id, name: String(l.name || '').slice(0, 60) || `友链-${l.id.slice(-4)}`,
              url: url.slice(0, 2000),
              logo: String(l.logo || '').slice(0, 2000),
              sortOrder: Number(l.sortOrder) || 0,
              enabled: l.enabled !== false,
            },
            update: {
              name: String(l.name || '').slice(0, 60),
              url: url.slice(0, 2000),
              logo: String(l.logo || '').slice(0, 2000),
              sortOrder: Number(l.sortOrder) || 0,
              enabled: l.enabled !== false,
            },
          })
          imported.friendLinks++
        }

        // rules
        for (const r of rules) {
          if (!r || typeof r.id !== 'string' || !r.id) continue
          await tx.rule.upsert({
            where: { id: r.id },
            create: {
              id: r.id, name: String(r.name || '').slice(0, 200) || `规则-${r.id.slice(-4)}`,
              description: r.description == null ? null : String(r.description).slice(0, 1000),
              config: String(r.config || '{}').slice(0, 200_000),
              enabled: r.enabled !== false,
            },
            update: {
              name: String(r.name || '').slice(0, 200),
              description: r.description == null ? null : String(r.description).slice(0, 1000),
              config: String(r.config || '{}').slice(0, 200_000),
              enabled: r.enabled !== false,
            },
          })
          imported.rules++
        }

        // books + 嵌套 chapters + tags
        for (const b of books) {
          if (!b || typeof b.id !== 'string' || !b.id) continue
          const categoryId = typeof b.categoryId === 'string' && b.categoryId ? b.categoryId : null
          await tx.book.upsert({
            where: { id: b.id },
            create: {
              id: b.id,
              name: String(b.name || '').slice(0, 200) || `书籍-${b.id.slice(-4)}`,
              author: String(b.author || '佚名').slice(0, 100),
              categoryId,
              intro: String(b.intro || '').slice(0, 10_000),
              cover: String(b.cover || '').slice(0, 500),
              status: String(b.status || 'unknown').slice(0, 20),
              keywords: String(b.keywords || '').slice(0, 500),
              latestChapter: String(b.latestChapter || '').slice(0, 200),
              wordCount: Number(b.wordCount) || 0,
              sourceUrl: String(b.sourceUrl || '').slice(0, 500),
              sourceRuleId: typeof b.sourceRuleId === 'string' ? b.sourceRuleId : null,
              storageMode: String(b.storageMode || 'db').slice(0, 20),
              collectedAt: parseDate(b.collectedAt),
            },
            update: {
              name: String(b.name || '').slice(0, 200),
              author: String(b.author || '佚名').slice(0, 100),
              categoryId,
              intro: String(b.intro || '').slice(0, 10_000),
              cover: String(b.cover || '').slice(0, 500),
              status: String(b.status || 'unknown').slice(0, 20),
              keywords: String(b.keywords || '').slice(0, 500),
              latestChapter: String(b.latestChapter || '').slice(0, 200),
              wordCount: Number(b.wordCount) || 0,
              sourceUrl: String(b.sourceUrl || '').slice(0, 500),
              sourceRuleId: typeof b.sourceRuleId === 'string' ? b.sourceRuleId : null,
              storageMode: String(b.storageMode || 'db').slice(0, 20),
              collectedAt: parseDate(b.collectedAt),
            },
          })
          imported.books++

          // chapters
          const chs = Array.isArray(b.chapters) ? b.chapters as Record<string, unknown>[] : []
          for (const c of chs) {
            if (!c || typeof c.id !== 'string' || !c.id) continue
            const idx = Number(c.idx)
            if (!Number.isFinite(idx)) continue
            try {
              await tx.chapter.upsert({
                where: { id: c.id },
                create: {
                  id: c.id, bookId: b.id, idx,
                  title: String(c.title || '').slice(0, 200) || `第${idx}章`,
                  volume: String(c.volume || '').slice(0, 100),
                  url: String(c.url || '').slice(0, 500),
                  content: c.content == null ? null : String(c.content),
                  storage: String(c.storage || 'db').slice(0, 20),
                  filePath: c.filePath == null ? null : String(c.filePath).slice(0, 500),
                  wordCount: Number(c.wordCount) || 0,
                  fetched: !!c.fetched,
                },
                update: {
                  idx,
                  title: String(c.title || '').slice(0, 200),
                  volume: String(c.volume || '').slice(0, 100),
                  url: String(c.url || '').slice(0, 500),
                  content: c.content == null ? null : String(c.content),
                  storage: String(c.storage || 'db').slice(0, 20),
                  filePath: c.filePath == null ? null : String(c.filePath).slice(0, 500),
                  wordCount: Number(c.wordCount) || 0,
                  fetched: !!c.fetched,
                },
              })
              imported.chapters++
            } catch (e) {
              // 单章失败: 在 merge 模式下尝试更新已有 (idx+bookId 唯一约束冲突时)
              warnings.push(`章节 ${c.id} 导入失败: ${(e as Error)?.message?.slice(0, 100) || '未知错误'}`)
            }
          }

          // tags
          const tags = Array.isArray(b.tags) ? b.tags as Record<string, unknown>[] : []
          for (const t of tags) {
            if (!t || typeof t.tag !== 'string' || !t.tag) continue
            try {
              await tx.bookTag.upsert({
                where: { bookId_tag: { bookId: b.id, tag: String(t.tag).slice(0, 100) } },
                create: {
                  bookId: b.id, tag: String(t.tag).slice(0, 100),
                  source: String(t.source || 'suggest').slice(0, 20),
                  hits: Number(t.hits) || 0,
                },
                update: {
                  source: String(t.source || 'suggest').slice(0, 20),
                  hits: Number(t.hits) || 0,
                },
              })
              imported.tags++
            } catch {
              // tag 失败静默 (可能 bookId 不存在)
            }
          }
        }

        // tasks
        for (const t of tasks) {
          if (!t || typeof t.id !== 'string' || !t.id) continue
          const ruleId = String(t.ruleId || '')
          if (!ruleId) continue // 没有关联 rule 的任务无法重建
          await tx.task.upsert({
            where: { id: t.id },
            create: {
              id: t.id,
              name: String(t.name || '').slice(0, 200) || `任务-${t.id.slice(-4)}`,
              ruleId,
              mode: String(t.mode || 'single').slice(0, 20),
              bookUrl: String(t.bookUrl || '').slice(0, 500),
              listUrl: String(t.listUrl || '').slice(0, 500),
              listStart: Number(t.listStart) || 1,
              listEnd: Number(t.listEnd) || 1,
              bookStart: Number(t.bookStart) || 0,
              bookEnd: Number(t.bookEnd) || 0,
              recrawlMode: String(t.recrawlMode || 'incremental').slice(0, 20),
              storageMode: String(t.storageMode || 'db').slice(0, 20),
              fetchConfig: String(t.fetchConfig || '{}').slice(0, 100_000),
              threadMin: Number(t.threadMin) || 1,
              threadMax: Number(t.threadMax) || 3,
              intervalMin: Number(t.intervalMin) || 500,
              intervalMax: Number(t.intervalMax) || 2000,
              smartCategory: t.smartCategory !== false,
              smartComplete: t.smartComplete !== false,
              autoSuggest: t.autoSuggest !== false,
              autoRefresh: !!t.autoRefresh,
              refreshIntervalMin: Number(t.refreshIntervalMin) || 30,
              status: String(t.status || 'pending').slice(0, 20),
              progress: String(t.progress || '{}').slice(0, 100_000),
              stats: String(t.stats || '{}').slice(0, 100_000),
            },
            update: {
              name: String(t.name || '').slice(0, 200),
              mode: String(t.mode || 'single').slice(0, 20),
              bookUrl: String(t.bookUrl || '').slice(0, 500),
              listUrl: String(t.listUrl || '').slice(0, 500),
              listStart: Number(t.listStart) || 1,
              listEnd: Number(t.listEnd) || 1,
              bookStart: Number(t.bookStart) || 0,
              bookEnd: Number(t.bookEnd) || 0,
              recrawlMode: String(t.recrawlMode || 'incremental').slice(0, 20),
              storageMode: String(t.storageMode || 'db').slice(0, 20),
              fetchConfig: String(t.fetchConfig || '{}').slice(0, 100_000),
              threadMin: Number(t.threadMin) || 1,
              threadMax: Number(t.threadMax) || 3,
              intervalMin: Number(t.intervalMin) || 500,
              intervalMax: Number(t.intervalMax) || 2000,
              smartCategory: t.smartCategory !== false,
              smartComplete: t.smartComplete !== false,
              autoSuggest: t.autoSuggest !== false,
              autoRefresh: !!t.autoRefresh,
              refreshIntervalMin: Number(t.refreshIntervalMin) || 30,
              status: String(t.status || 'pending').slice(0, 20),
              progress: String(t.progress || '{}').slice(0, 100_000),
              stats: String(t.stats || '{}').slice(0, 100_000),
            },
          })
          imported.tasks++
        }

        // downloadJobs
        for (const d of downloadJobs) {
          if (!d || typeof d.id !== 'string' || !d.id) continue
          const bookId = String(d.bookId || '')
          if (!bookId) continue
          try {
            await tx.downloadJob.upsert({
              where: { id: d.id },
              create: {
                id: d.id, bookId,
                options: String(d.options || '{}').slice(0, 100_000),
                status: String(d.status || 'pending').slice(0, 20),
                filePath: d.filePath == null ? null : String(d.filePath).slice(0, 500),
                error: d.error == null ? null : String(d.error).slice(0, 500),
                size: Number(d.size) || 0,
              },
              update: {
                options: String(d.options || '{}').slice(0, 100_000),
                status: String(d.status || 'pending').slice(0, 20),
                filePath: d.filePath == null ? null : String(d.filePath).slice(0, 500),
                error: d.error == null ? null : String(d.error).slice(0, 500),
                size: Number(d.size) || 0,
              },
            })
            imported.downloadJobs++
          } catch {
            // bookId 不存在则跳过
          }
        }
      })
    } catch (e) {
      logger.error('restore transaction failed', { err: (e as Error)?.message, code: (e as { code?: string })?.code })
      return fail(`导入失败已回滚: ${(e as Error)?.message?.slice(0, 200) || '未知错误'}`, 500)
    }

    return ok({
      imported,
      warnings,
      took: Date.now() - startedAt,
    })
  })
}

/** ISO/字符串 → Date, 失败回退 undefined (让 Prisma 用 default) */
function parseDate(v: unknown): Date | undefined {
  if (v == null) return undefined
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d
  }
  return undefined
}
