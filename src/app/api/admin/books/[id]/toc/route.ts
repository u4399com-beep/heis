// 书籍目录(管理端)
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { withGuard, clampInt } from '../../../../_lib/http'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const url = new URL(req.url)
    // 分页边界: page≥1 / size 1~200, 防 skip/take 负数导致 Prisma 500
    const page = clampInt(url.searchParams.get('page'), 1, 1, 1_000_000)
    const size = clampInt(url.searchParams.get('size'), 50, 1, 200)

    // R4A-5: skip 上限钳制 —— admin toc 与 public/book 同款 DoS 风险(尽管 admin 限流 60/min
    // 仍可被脚本饱和 DB)。cap 在 10000 行(与 /api/public/books 同口径)
    const requestedSkip = (page - 1) * size
    const effectiveSkip = Math.min(requestedSkip, 10_000)

    const book = await db.book.findUnique({ where: { id }, select: { id: true } })
    if (!book) return fail('书籍不存在', 404)

    const [total, chapters] = await Promise.all([
      db.chapter.count({ where: { bookId: id } }),
      db.chapter.findMany({
        where: { bookId: id },
        orderBy: { idx: 'asc' },
        skip: effectiveSkip,
        take: size,
        select: { id: true, idx: true, title: true, url: true, storage: true, filePath: true, wordCount: true, fetched: true, volume: true, updatedAt: true },
      }),
    ])
    return ok({ total, page, size, chapters })
  })
}
