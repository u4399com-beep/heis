// 分类管理
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, str, clampInt } from '../../_lib/http'

export async function GET() {
  return withGuard(async () => {
    const cats = await db.category.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { books: true } } },
    })
    return ok(cats)
  })
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody(req)
    const name = str(body?.name, 50).trim()
    if (!name) return fail('分类名必填')
    const max = await db.category.aggregate({ _max: { sortOrder: true } })
    const cat = await db.category.upsert({
      where: { name },
      create: { name, sortOrder: clampInt(body?.sortOrder, (max._max.sortOrder || 0) + 1, 0, 1_000_000) },
      update: {},
    })
    return ok(cat)
  })
}
