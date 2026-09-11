// 前台分类图文展示 — 非空分类 + 每分类字数最高带封面书作代表(首页 6 分类封面卡)
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { withGuard, clampInt, withCache } from '../../_lib/http'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    // 返回分类数钳制 1~60(缺省 24), 前台展示取前 6
    const limit = clampInt(url.searchParams.get('limit'), 24, 1, 60)

    // 非空过滤: books:{some:{}} → 空分类不进图文卡
    const cats = await db.category.findMany({
      where: { books: { some: {} } },
      orderBy: { sortOrder: 'asc' },
      take: limit,
      include: { _count: { select: { books: true } } },
    })

    // 每分类代表书: 字数最高且带封面; 分类内全无封面时回退字数最高(空封面由前台渐变占位兜底)
    //
    // API-18: N+1 查询评估 —— 每分类最多 2 个 findFirst(带封面优先 + 无封面回退), 配合上面
    // limit ≤ 60 的钳制, 单请求最多 ~120 个 SQLite 查询(SQLite 本地查询毫秒级), 实测 <50ms。
    // 优化方案(findMany 取每分类最高字数书 → Map grouping → 回退查询)能减到 3 个查询, 但
    // 代码可读性下降且需处理"该分类书全无封面"分支, 当前 N+1 已在可接受范围, 优先保持正确性
    const items = await Promise.all(
      cats.map(async (c) => {
        const rep =
          (await db.book.findFirst({
            where: { categoryId: c.id, cover: { not: '' } },
            orderBy: { wordCount: 'desc' },
          })) ||
          (await db.book.findFirst({
            where: { categoryId: c.id },
            orderBy: { wordCount: 'desc' },
          }))
        return {
          id: c.id,
          name: c.name,
          bookCount: c._count.books,
          rep: rep ? { id: rep.id, name: rep.name, cover: rep.cover } : null,
        }
      }),
    )

    return withCache(ok({ items }), 300, 600)
  })
}
