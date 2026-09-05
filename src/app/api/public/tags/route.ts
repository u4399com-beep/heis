// 全站搜索下拉词 — distinct 标签按热度取池 + Fisher-Yates 随机洗牌(首页/页脚随机展示与换一批)
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { withGuard, clampInt } from '../../_lib/http'

// 词池上限: distinct 标签按最高 hits 降序截取
const POOL_SIZE = 400

/** Fisher-Yates 洗牌(返回新数组, 不修改入参) */
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a
}

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    // 返回条数钳制 1~120(缺省 24), 防止超大 n 拖垮响应
    const n = clampInt(url.searchParams.get('n'), 24, 1, 120)

    // distinct 词池: 同一词挂在多本书时取最大 hits, 按热度降序截 400
    const grouped = await db.bookTag.groupBy({
      by: ['tag'],
      _max: { hits: true },
    })
    const pool = grouped
      .map((g) => ({ tag: g.tag, hits: g._max.hits ?? 0 }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, POOL_SIZE)
      .map((g) => g.tag)

    // 每次请求随机洗牌 → 前台「换一批」/ 多站点展示天然去重
    return ok({ tags: shuffle(pool).slice(0, n) })
  })
}
