// 书籍管理(列表/手动新增)
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, str, likeSafe, httpUrl, clampInt } from '../../_lib/http'

const BOOK_STATUSES = ['unknown', 'ongoing', 'completed'] as const

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const q = likeSafe(url.searchParams.get('q'))
    const categoryId = str(url.searchParams.get('categoryId'), 64).trim()
    const status = str(url.searchParams.get('status'), 20).trim()
    // 分页边界: page≥1 / size 1~50, 防 skip/take 负数导致 Prisma 500
    const page = clampInt(url.searchParams.get('page'), 1, 1, 1_000_000)
    const size = clampInt(url.searchParams.get('size'), 20, 1, 50)

    const where: Record<string, unknown> = {}
    if (q) where.OR = [{ name: { contains: q } }, { author: { contains: q } }]
    if (categoryId) where.categoryId = categoryId
    // 状态白名单: 非法值忽略(不报错, 保持列表可用), 防任意字符串进查询
    if (status && (BOOK_STATUSES as readonly string[]).includes(status)) where.status = status

    const [total, books] = await Promise.all([
      db.book.count({ where }),
      db.book.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
        include: {
          category: true,
          _count: { select: { chapters: true, tags: true } },
        },
      }),
    ])
    return ok({ total, page, size, books })
  })
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody(req)
    const name = str(body?.name, 200).trim()
    if (!name) return fail('书名必填')

    // 分类: 优先 id(须存在), 其次按名称 upsert
    let categoryId: string | null = str(body?.categoryId, 64).trim() || null
    if (categoryId) {
      const cat = await db.category.findUnique({ where: { id: categoryId } })
      if (!cat) return fail('所选分类不存在', 404)
    } else {
      const categoryName = str(body?.categoryName, 50).trim()
      if (categoryName) {
        const cat = await db.category.upsert({
          where: { name: categoryName },
          create: { name: categoryName },
          update: {},
        })
        categoryId = cat.id
      }
    }

    // 状态白名单
    const status = (BOOK_STATUSES as readonly string[]).includes(body?.status)
      ? body.status
      : 'unknown'
    // 来源URL: 有值时必须是合法 http(s)
    const sourceUrl = httpUrl(body?.sourceUrl) || ''
    if (body?.sourceUrl && !sourceUrl) return fail('来源地址格式非法(需 http/https)')

    let book
    try {
      book = await db.book.create({
        data: {
          name,
          author: str(body?.author, 100).trim() || '佚名',
          intro: str(body?.intro, 20_000),
          cover: str(body?.cover, 2000),
          status,
          keywords: str(body?.keywords, 500),
          categoryId,
          sourceUrl,
          storageMode: body?.storageMode === 'txt' ? 'txt' : 'db',
        },
      })
    } catch (e: any) {
      // 修复(y-c): 预检与 create 之间存在微竞态(目标分类恰被并发删除), 外键约束错误
      // 落入 withGuard 变裸 500 —— 转 409 引导刷新重试
      if (e?.code === 'P2003') return fail('分类不存在或已被删除, 请刷新后重试', 409)
      throw e
    }
    return ok(book)
  })
}
