// 关键词独立访问页 — 下拉关键词作为关联词, 页面均指向主书籍信息页
// R13-1A: 新增 ?book={bookId} 参数, 返回该书的 PSEO 长尾词列表
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { withGuard, str, withCache } from '../../_lib/http'
import { fetchSuggestKeywordsForBook, type PSEOKeyword } from '@/lib/crawl/suggest'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const kw = str(url.searchParams.get('kw'), 100).trim()
    const tag = (str(url.searchParams.get('tag'), 100).trim() || kw).slice(0, 100)
    const bookId = str(url.searchParams.get('book'), 64).trim()

    // R13-1A: ?book={bookId} 模式 — 返回该书的 PSEO 关键词列表(用于 BookView 底部"相关搜索词")
    if (bookId) {
      const book = await db.book.findUnique({
        where: { id: bookId },
        select: { id: true, name: true, author: true, categoryId: true, category: { select: { name: true } } },
      })
      if (!book) return ok({ book: null, pseoKeywords: [] as PSEOKeyword[] })
      const category = book.category?.name || ''
      const pseoKeywords = await fetchSuggestKeywordsForBook(book.name, book.author, 10, category)
      // 命中 source='suggest' 的标签 — 用于 KeywordView 判断是否走 PSEO 落地页模式
      return withCache(ok({ book: { id: book.id, name: book.name, author: book.author, category }, pseoKeywords }))
    }

    if (!tag) return ok({ tag: '', book: null, related: [] })

    // 主书籍: 命中该标签的书籍(按词频)
    const hits = await db.bookTag.findMany({
      where: { tag },
      orderBy: { hits: 'desc' },
      include: { book: { include: { category: true } } },
      take: 10,
    })

    // R13-1A: 主源标签 source('suggest'|'manual'|'pseo') — 用于 KeywordView 区分是否走 PSEO 落地页模式
    const tagSource = hits[0]?.source || 'suggest'

    // 相关词: 同一本书的其他标签
    const mainBook = hits[0]?.book
    let related: string[] = []
    if (mainBook) {
      const tags = await db.bookTag.findMany({
        where: { bookId: mainBook.id, tag: { not: tag } },
        orderBy: { hits: 'desc' },
        take: 16,
      })
      related = tags.map((t) => t.tag)
    }

    return withCache(ok({
      tag,
      source: tagSource,
      book: mainBook
        ? {
            id: mainBook.id,
            name: mainBook.name,
            author: mainBook.author,
            intro: (mainBook.intro || '').slice(0, 200),
            cover: mainBook.cover,
            status: mainBook.status,
            wordCount: mainBook.wordCount,
            category: mainBook.category?.name || '未分类',
          }
        : null,
      otherBooks: hits.slice(1).map((h) => ({ id: h.book.id, name: h.book.name, author: h.book.author })),
      related,
    }))
  })
}
