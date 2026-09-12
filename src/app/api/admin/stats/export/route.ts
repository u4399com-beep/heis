// ============================================================
// 仪表盘数据 CSV 导出 — GET /api/admin/stats/export
//
// 规格: 与 GET /api/admin/stats 共享同一数据采集逻辑(分桶/聚合/计数), 输出 CSV
//   给管理员下载用于离线分析。?scope=summary|trends|categories|tasks 默认 summary。
//   ?scope=all 把所有维度合并为多段 CSV (段间空行 + 段标题注释行)。
//
// CSV 转义规则 (RFC 4180):
//   - 字段含 [, "\n\r] 任一字符 → 整体加双引号包裹, 内部双引号转义为 ""
//   - 字段为 null/undefined → 空串
//   - 行分隔符 \r\n (Excel/Numbers 友好)
//
// 输出 Content-Type: text/csv; charset=utf-8 + BOM (Excel 中文不乱码)
//   Content-Disposition: attachment; filename="heis-stats-YYYYMMDD-HHmm.csv"
//   Cache-Control: no-store (仪表盘数据实时, 不缓存)
// ============================================================
import { db } from '@/lib/db'
import { withGuard } from '../../../_lib/http'
import { logger } from '@/lib/logger'

const SCOPES = new Set(['summary', 'trends', 'categories', 'tasks', 'all'])
const DEFAULT_SCOPE = 'summary'

/** RFC 4180 CSV 字段转义: 含 [, "\n\r] 任一字符 → 整体加双引号, 内部 " 转 "" */
function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'string' ? v : String(v)
  if (/["\n\r,]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** 多行 CSV 拼装: header 行 + 数据行; 每行用 \r\n 分隔 (Excel/Numbers 友好) */
function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines: string[] = [headers.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','))
  }
  return lines.join('\r\n')
}

/** 日期片段 YYYYMMDD-HHmm (本地时区, 仅文件名用途, 与 backup/route.ts 同款) */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  )
}

/** 近 7 天分桶(本地时区, 与 stats/route.ts 同款逻辑) */
function empty7d(): Array<{ day: string; count: number }> {
  const out: Array<{ day: string; count: number }> = []
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    out.push({ day: `${mm}-${dd}`, count: 0 })
  }
  return out
}

function bucketize7d(rows: Array<{ createdAt: Date }>): Array<{ day: string; count: number }> {
  const buckets = empty7d()
  const idx = new Map<string, number>()
  buckets.forEach((b, i) => idx.set(b.day, i))
  for (const r of rows) {
    const d = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)
    if (isNaN(d.getTime())) continue
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const key = `${mm}-${dd}`
    const i = idx.get(key)
    if (i !== undefined) buckets[i].count++
  }
  return buckets
}

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const scopeRaw = (url.searchParams.get('scope') || DEFAULT_SCOPE).trim().slice(0, 20)
    const scope = SCOPES.has(scopeRaw) ? scopeRaw : DEFAULT_SCOPE

    // 采集数据: 复用 stats/route.ts 的查询, 一次性拉取所有维度再按 scope 切片导出
    const [books, chapters, rules, tasks, runningTasks, sites, tags, downloads] = await Promise.all([
      db.book.count(),
      db.chapter.count(),
      db.rule.count(),
      db.task.count(),
      db.task.count({ where: { status: { in: ['running', 'paused'] } } }),
      db.site.count(),
      db.bookTag.count(),
      db.downloadJob.count(),
    ])
    const wordAgg = await db.chapter.aggregate({ _sum: { wordCount: true } })

    // 趋势数据
    let chaptersLast7d: Array<{ day: string; count: number }> = empty7d()
    let booksLast7d: Array<{ day: string; count: number }> = empty7d()
    try {
      const since = new Date(Date.now() - 6 * 24 * 3600 * 1000)
      since.setHours(0, 0, 0, 0)
      const [cRows, bRows] = await Promise.all([
        db.chapter.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
        db.book.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      ])
      chaptersLast7d = bucketize7d(cRows)
      booksLast7d = bucketize7d(bRows)
    } catch (e) {
      logger.warn('stats/export trends failed', { err: (e as Error)?.message })
    }

    // 分类分布
    let catRows: Array<{ name: string; words: number; books: number }> = []
    try {
      const categories = await db.category.findMany({
        select: { id: true, name: true, _count: { select: { books: true } } },
        take: 500,
      })
      const catAgg = await db.book.groupBy({
        by: ['categoryId'],
        _sum: { wordCount: true },
        where: { categoryId: { not: null } },
      })
      const wmap = new Map<string, number>()
      for (const row of catAgg) {
        if (row.categoryId) wmap.set(row.categoryId, row._sum.wordCount || 0)
      }
      catRows = categories.map((c) => ({
        name: c.name,
        words: wmap.get(c.id) || 0,
        books: c._count.books,
      }))
    } catch (e) {
      logger.warn('stats/export categories failed', { err: (e as Error)?.message })
    }

    // 任务状态分布
    let taskRows: Array<{ status: string; count: number }> = []
    try {
      const rows = await db.task.groupBy({ by: ['status'], _count: true })
      taskRows = rows.map((r) => ({ status: r.status, count: r._count }))
    } catch (e) {
      logger.warn('stats/export tasks failed', { err: (e as Error)?.message })
    }

    // 拼装 CSV
    const sections: Array<{ title: string; csv: string }> = []

    if (scope === 'summary' || scope === 'all') {
      sections.push({
        title: '汇总指标',
        csv: buildCsv(
          ['指标', '值'],
          [
            ['书籍数', books],
            ['章节数', chapters],
            ['规则数', rules],
            ['任务数', tasks],
            ['运行中任务', runningTasks],
            ['站点数', sites],
            ['标签数', tags],
            ['下载任务数', downloads],
            ['总字数', wordAgg._sum.wordCount || 0],
          ],
        ),
      })
    }

    if (scope === 'trends' || scope === 'all') {
      const trendRows: Array<Array<unknown>> = []
      const c7Map = new Map(chaptersLast7d.map((b) => [b.day, b.count]))
      const b7Map = new Map(booksLast7d.map((b) => [b.day, b.count]))
      for (const b of booksLast7d) {
        trendRows.push([b.day, b7Map.get(b.day) || 0, c7Map.get(b.day) || 0])
      }
      sections.push({
        title: '近 7 天入库趋势',
        csv: buildCsv(['日期', '书籍入库数', '章节入库数'], trendRows),
      })
    }

    if (scope === 'categories' || scope === 'all') {
      sections.push({
        title: '分类分布',
        csv: buildCsv(
          ['分类名', '书籍数', '总字数'],
          catRows.map((c) => [c.name, c.books, c.words]),
        ),
      })
    }

    if (scope === 'tasks' || scope === 'all') {
      sections.push({
        title: '任务状态分布',
        csv: buildCsv(
          ['状态', '任务数'],
          taskRows.map((t) => [t.status, t.count]),
        ),
      })
    }

    // 多段 CSV: 段间空行 + 注释行 (# 段标题), 单段则直接返回
    let csv: string
    if (sections.length === 1) {
      csv = sections[0].csv
    } else {
      csv = sections.map((s) => `# ${s.title}\r\n${s.csv}`).join('\r\n\r\n')
    }

    // 加 UTF-8 BOM 让 Excel 正确识别中文 (BOM = EF BB BF)
    const bom = '\uFEFF'
    const body = bom + csv + '\r\n'

    const filename = `heis-stats-${stamp(new Date())}.csv`
    const headers: Record<string, string> = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    }

    return new Response(body, { headers })
  })
}
