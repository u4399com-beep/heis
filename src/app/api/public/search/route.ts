// 前台搜索
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { withGuard, likeSafe, clampInt } from '../../_lib/http'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const q = likeSafe(url.searchParams.get('q'))
    // limit 边界: 1~50, 防 take 负数导致 Prisma 500
    const limit = clampInt(url.searchParams.get('limit'), 20, 1, 50)
    if (!q) return ok({ q, books: [] })

    const books = await db.book.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { author: { contains: q } },
          { intro: { contains: q } },
          { keywords: { contains: q } },
        ],
      },
      orderBy: { wordCount: 'desc' },
      take: limit,
      include: { category: true },
    })
    // 相关搜索词(来自下拉关键词库)
    const relatedTags = await db.bookTag.findMany({
      where: { tag: { contains: q } },
      take: 12,
      include: { book: { select: { id: true, name: true } } },
    })
    return ok({
      q,
      books: books.map((b) => ({
        id: b.id, name: b.name, author: b.author, intro: (b.intro || '').slice(0, 150),
        cover: b.cover, status: b.status, wordCount: b.wordCount,
        category: b.category?.name || '未分类',
      })),
      relatedTags: relatedTags.map((t) => ({ tag: t.tag, bookId: t.book.id, bookName: t.book.name })),
    })
  })
}
