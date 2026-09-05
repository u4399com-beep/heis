// 前台书籍列表 — 支持站群偏移量/分类/搜索/分页
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { withGuard, str, likeSafe, clampInt } from '../../_lib/http'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const siteId = str(url.searchParams.get('site'), 64).trim()
    const q = likeSafe(url.searchParams.get('q'))
    const cat = str(url.searchParams.get('cat'), 64).trim()
    const status = str(url.searchParams.get('status'), 20).trim()
    const sort = str(url.searchParams.get('sort'), 20).trim() || 'latest'
    // 分页边界: page≥1 / size 1~60, 防 skip/take 负数导致 Prisma 500
    const page = clampInt(url.searchParams.get('page'), 1, 1, 1_000_000)
    const size = clampInt(url.searchParams.get('size'), 24, 1, 60)

    // 站群: 偏移量 + 可选域名 (站点不存在时 offset 保持 0)
    let offset = 0
    if (siteId) {
      const site = await db.site.findUnique({ where: { id: siteId } })
      if (site) offset = Math.max(0, site.offset)
    }

    const where: Record<string, unknown> = {}
    if (q) where.OR = [{ name: { contains: q } }, { author: { contains: q } }, { keywords: { contains: q } }]
    if (cat) where.categoryId = cat
    // 状态白名单: 非法值忽略(不报错), 防任意字符串进查询
    if (status && ['unknown', 'ongoing', 'completed'].includes(status)) where.status = status

    // 排序白名单(防 orderBy 注入任意字段)
    const orderBy = sort === 'words' ? { wordCount: 'desc' as const } : { updatedAt: 'desc' as const }

    const [total, books] = await Promise.all([
      db.book.count({ where }),
      db.book.findMany({
        where,
        orderBy,
        skip: offset + (page - 1) * size,
        take: size,
        include: { category: true },
      }),
    ])

    return ok({
      total: Math.max(0, total - offset),
      page,
      size,
      books: books.map((b) => ({
        id: b.id,
        name: b.name,
        author: b.author,
        intro: (b.intro || '').slice(0, 120),
        cover: b.cover,
        status: b.status,
        wordCount: b.wordCount,
        latestChapter: b.latestChapter,
        category: b.category?.name || '未分类',
        categoryId: b.categoryId,
        updatedAt: b.updatedAt,
      })),
    })
  })
}
