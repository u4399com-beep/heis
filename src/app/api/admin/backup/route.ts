// ============================================================
// 数据备份导出 — GET /api/admin/backup
// 导出全库 JSON (settings / categories / sites / friendLinks / rules /
//   books (含 chapters + tags) / tasks (不含 logs) / downloadJobs)
// - books > 500 时仅导出元数据(不含 chapters) + warn 字段
// - 大于 5MB 时改走 ReadableStream 串流; 小数据直接 JSON.stringify
// - Content-Disposition: attachment; filename="heis-backup-YYYYMMDD-HHmm.json"
// ============================================================
import { db } from '@/lib/db'
import { fail } from '@/lib/api'
import { withGuard } from '../../_lib/http'
import { logger } from '@/lib/logger'

const BACKUP_VERSION = 1
// R4A-12: 降低大书库阈值 500 → 200 —— 499 书 × 500 章节场景 dumpBooksFull 单 findMany
// 加载所有行到内存, JSON.stringify payload 多百 MB 堆峰值。200 上限与 metadata-only
// 模式仍保留(站群场景常见 100~200 书仍可正常导出含章节)
const BIG_BOOKS_THRESHOLD = 200
const STREAM_THRESHOLD_BYTES = 5 * 1024 * 1024 // 5 MB

/** 日期片段 YYYYMMDD-HHmm (本地时区, 仅文件名用途) */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  )
}

/** books + chapters + tags 全量打包
 *  R4A-12: 按 50 本一批流式加载, 防 499×500=250k 章节行一次性入内存堆峰值 */
async function dumpBooksFull() {
  const allBooks: any[] = []
  const BATCH = 50
  let cursor: string | undefined
  // 用 cursor 分页(比 skip/take 高效, 不必每次跳过 N 行)
  for (;;) {
    const books: any[] = await db.book.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: {
        chapters: {
          orderBy: { idx: 'asc' },
          select: {
            id: true, bookId: true, idx: true, title: true, volume: true,
            url: true, content: true, storage: true, filePath: true,
            wordCount: true, fetched: true, createdAt: true, updatedAt: true,
          },
        },
        tags: { select: { id: true, bookId: true, tag: true, source: true, hits: true } },
      },
    })
    if (books.length === 0) break
    allBooks.push(...books)
    cursor = books[books.length - 1].id
    // 让出事件循环防长请求阻塞其它请求
    await new Promise((r) => setImmediate(r))
  }
  return allBooks
}

export async function GET() {
  return withGuard(async () => {
    const exportedAt = new Date().toISOString()

    const [settings, categories, sites, friendLinks, rules, bookCount, taskCount, downloadCount, chapterCount] = await Promise.all([
      db.setting.findMany({ take: 500 }),
      db.category.findMany({ take: 500 }),
      db.site.findMany({ take: 500 }),
      db.friendLink.findMany({ take: 500 }),
      db.rule.findMany({ take: 500 }),
      db.book.count(),
      db.task.count(),
      db.downloadJob.count(),
      db.chapter.count(),
    ])

    // 任务不带 logs (logs 表过大, 通常几万行, 备份体积失控)
    const [tasks, downloadJobs] = await Promise.all([
      db.task.findMany({ take: 5000 }),
      db.downloadJob.findMany({ take: 5000 }),
    ])

    const bigBooks = bookCount > BIG_BOOKS_THRESHOLD
    // bigBooks=true → 仅元数据(无 chapters/tags), 避免备份体积过大
    const books = bigBooks ? await db.book.findMany({}) : await dumpBooksFull()

    // 统计计数 (chapters 全量统计, 不论降级模式)
    const counts = {
      settings: settings.length,
      categories: categories.length,
      sites: sites.length,
      friendLinks: friendLinks.length,
      rules: rules.length,
      books: bookCount,
      chapters: chapterCount,
      tasks: taskCount,
      downloadJobs: downloadCount,
    }

    const payload = {
      version: BACKUP_VERSION,
      exportedAt,
      counts,
      warnings: bigBooks
        ? [`书籍数量超过 ${BIG_BOOKS_THRESHOLD}, 仅导出书籍元数据(不含章节正文), 以避免备份体积过大`]
        : [],
      data: {
        settings: settings.map((s) => ({ key: s.key, value: s.value })),
        categories: categories.map((c) => ({
          id: c.id, name: c.name, sortOrder: c.sortOrder, createdAt: c.createdAt,
        })),
        sites: sites.map((s) => ({
          id: s.id, name: s.name, domain: s.domain, themeId: s.themeId,
          title: s.title, description: s.description, keywords: s.keywords,
          icbm: s.icbm, geoRegion: s.geoRegion, geoPlacename: s.geoPlacename,
          offset: s.offset, isDefault: s.isDefault, status: s.status,
          inLinkWheel: s.inLinkWheel,
          // 章节分页 + SEO 模板 + 伪静态风格(R7-19/R7-20) — 缺失则 restore 后站点配置
          // 静默回退到 schema 默认值(pagination='off' / pseudoStatic='query' / 模板空),
          // 用户备份→还原后所有站点的分页/SEO/伪静态配置全部丢失, 链轮 URL 也回退到查询串
          chapterPaginationMode: s.chapterPaginationMode,
          chapterPaginationWords: s.chapterPaginationWords,
          chapterPaginationPages: s.chapterPaginationPages,
          chapterSeoAuto: s.chapterSeoAuto,
          chapterSeoTitleTemplate: s.chapterSeoTitleTemplate,
          chapterSeoDescTemplate: s.chapterSeoDescTemplate,
          chapterSeoKeywordsTemplate: s.chapterSeoKeywordsTemplate,
          pseudoStaticStyle: s.pseudoStaticStyle,
          createdAt: s.createdAt, updatedAt: s.updatedAt,
        })),
        friendLinks: friendLinks.map((l) => ({
          id: l.id, name: l.name, url: l.url, logo: l.logo,
          sortOrder: l.sortOrder, enabled: l.enabled,
          createdAt: l.createdAt, updatedAt: l.updatedAt,
        })),
        rules: rules.map((r) => ({
          id: r.id, name: r.name, description: r.description,
          config: r.config, enabled: r.enabled, createdAt: r.createdAt, updatedAt: r.updatedAt,
        })),
        books: books.map((b) => {
          const any = b as unknown as {
            chapters?: unknown[]
            tags?: unknown[]
          }
          return {
            id: b.id, name: b.name, author: b.author,
            categoryId: b.categoryId, intro: b.intro, cover: b.cover,
            status: b.status, keywords: b.keywords, latestChapter: b.latestChapter,
            wordCount: b.wordCount, sourceUrl: b.sourceUrl, sourceRuleId: b.sourceRuleId,
            storageMode: b.storageMode, collectedAt: b.collectedAt,
            createdAt: b.createdAt, updatedAt: b.updatedAt,
            chapters: any.chapters || [],
            tags: any.tags || [],
          }
        }),
        tasks: tasks.map((t) => ({
          id: t.id, name: t.name, ruleId: t.ruleId, mode: t.mode,
          bookUrl: t.bookUrl, listUrl: t.listUrl, listStart: t.listStart,
          listEnd: t.listEnd, bookStart: t.bookStart, bookEnd: t.bookEnd,
          recrawlMode: t.recrawlMode, storageMode: t.storageMode,
          fetchConfig: t.fetchConfig, threadMin: t.threadMin, threadMax: t.threadMax,
          intervalMin: t.intervalMin, intervalMax: t.intervalMax,
          smartCategory: t.smartCategory, smartComplete: t.smartComplete,
          autoSuggest: t.autoSuggest, autoRefresh: t.autoRefresh,
          refreshIntervalMin: t.refreshIntervalMin, status: t.status,
          progress: t.progress, stats: t.stats,
          createdAt: t.createdAt, updatedAt: t.updatedAt,
        })),
        downloadJobs: downloadJobs.map((d) => ({
          id: d.id, bookId: d.bookId, options: d.options, status: d.status,
          filePath: d.filePath, error: d.error, size: d.size, createdAt: d.createdAt,
        })),
      },
    }

    const filename = `heis-backup-${stamp(new Date())}.json`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    }

    let body: string
    try {
      body = JSON.stringify(payload)
    } catch (e) {
      logger.error('backup serialize failed', { err: (e as Error)?.message })
      return fail('备份序列化失败', 500)
    }

    if (Buffer.byteLength(body, 'utf8') < STREAM_THRESHOLD_BYTES) {
      return new Response(body, { headers })
    }

    // 大数据串流: 把已 stringify 的 body 切块发送
    const encoder = new TextEncoder()
    const chunkSize = 256 * 1024 // 256 KB / 块
    const stream = new ReadableStream({
      start(controller) {
        try {
          for (let i = 0; i < body.length; i += chunkSize) {
            controller.enqueue(encoder.encode(body.slice(i, i + chunkSize)))
          }
          controller.close()
        } catch (e) {
          controller.error(e)
        }
      },
    })
    return new Response(stream, { headers })
  })
}
