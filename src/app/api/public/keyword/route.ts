// 关键词独立访问页 — 下拉关键词作为关联词, 页面均指向主书籍信息页
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { withGuard, str } from '../../_lib/http'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const kw = str(url.searchParams.get('kw'), 100).trim()
    const tag = (str(url.searchParams.get('tag'), 100).trim() || kw).slice(0, 100)

    if (!tag) return ok({ tag: '', book: null, related: [] })

    // 主书籍: 命中该标签的书籍(按词频)
    const hits = await db.bookTag.findMany({
      where: { tag },
      orderBy: { hits: 'desc' },
      include: { book: { include: { category: true } } },
      take: 10,
    })

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

    return ok({
      tag,
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
    })
  })
}
