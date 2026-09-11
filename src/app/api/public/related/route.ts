// 前台相关推荐 — 同分类按字数倒序, 不足则用全站字数最高的书补足
// ?id=<bookId>&site=<siteId>&limit=6
// 不修改 /api/public/book (约束); 独立端点供 BookView "相关推荐" 区块消费
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { withGuard, str, clampInt, withCache } from '../../_lib/http'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const id = str(url.searchParams.get('id'), 64).trim()
    const limit = clampInt(url.searchParams.get('limit'), 6, 1, 12)
    if (!id) return fail('缺少id')

    const book = await db.book.findUnique({
      where: { id },
      select: { id: true, categoryId: true },
    })
    if (!book) return fail('书籍不存在', 404)

    const pick = (
      b: {
        id: string
        name: string
        author: string
        cover: string
        status: string
        wordCount: number
        category: { name: string } | null
        categoryId: string | null
      },
    ) => ({
      id: b.id,
      name: b.name,
      author: b.author,
      cover: b.cover,
      status: b.status,
      wordCount: b.wordCount,
      category: b.category?.name || '未分类',
      categoryId: b.categoryId,
    })

    const ids = new Set<string>([id])
    const out: ReturnType<typeof pick>[] = []

    // 1) 同分类 (排除当前书), 按字数倒序
    if (book.categoryId) {
      const same = await db.book.findMany({
        where: { id: { not: id }, categoryId: book.categoryId },
        orderBy: { wordCount: 'desc' },
        take: limit,
        include: { category: true },
      })
      for (const b of same) {
        if (ids.has(b.id)) continue
        ids.add(b.id)
        out.push(pick(b))
        if (out.length >= limit) break
      }
    }

    // 2) 不足则用全站字数最高的书补足 (排除已选 + 当前书)
    if (out.length < limit) {
      const fill = await db.book.findMany({
        where: { id: { notIn: [...ids] } },
        orderBy: { wordCount: 'desc' },
        take: limit - out.length,
        include: { category: true },
      })
      for (const b of fill) {
        if (ids.has(b.id)) continue
        ids.add(b.id)
        out.push(pick(b))
        if (out.length >= limit) break
      }
    }

    return withCache(ok({ books: out }))
  })
}
