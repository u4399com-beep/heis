// 前台书籍详情 + 目录(TDK/SEO数据源)
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { withGuard, str, clampInt, withCache } from '../../_lib/http'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const id = str(url.searchParams.get('id'), 64).trim()
    const tocPage = clampInt(url.searchParams.get('tocPage'), 1, 1, 1_000_000)
    const tocSize = clampInt(url.searchParams.get('tocSize'), 100, 1, 300)
    if (!id) return fail('缺少id')

    // R4A-4: skip 上限钳制 —— (tocPage-1)*tocSize 最坏 300M 行, SQLite OFFSET 全表扫描
    // 会让单个请求占用 DB 数秒, 120 req/min 限流下能饱和整个 DB。cap 在 10000(与
    // /api/public/books API-7 同口径), 超出返回空 urlset 不报错(公共路由容错优先)
    const requestedSkip = (tocPage - 1) * tocSize
    const effectiveSkip = Math.min(requestedSkip, 10_000)

    const book = await db.book.findUnique({
      where: { id },
      include: { category: true },
    })
    if (!book) return fail('书籍不存在', 404)

    const [total, tags, chapters] = await Promise.all([
      db.chapter.count({ where: { bookId: id } }),
      db.bookTag.findMany({ where: { bookId: id }, orderBy: { hits: 'desc' }, take: 30 }),
      db.chapter.findMany({
        where: { bookId: id },
        orderBy: { idx: 'asc' },
        select: { id: true, idx: true, title: true, wordCount: true, volume: true },
        skip: effectiveSkip,
        take: tocSize,
      }),
    ])

    return withCache(ok({
      book: {
        id: book.id,
        name: book.name,
        author: book.author,
        intro: book.intro,
        cover: book.cover,
        status: book.status,
        keywords: book.keywords,
        wordCount: book.wordCount,
        latestChapter: book.latestChapter,
        // 安全面(rr-d): sourceUrl 是采集源地址, 仅管理端需要(重采/来源展示), 前台零消费 —
        // 列表/搜索/关键词路由本就不含该字段, 详情路由原先独漏 → 公开面剥离, 防采集源站暴露
        category: book.category?.name || '未分类',
        categoryId: book.categoryId,
        updatedAt: book.updatedAt,
      },
      tocTotal: total,
      tocPage,
      tocSize,
      tocTotalPages: Math.ceil(total / tocSize) || 1,
      chapters,
      tags,
    }))
  })
}
