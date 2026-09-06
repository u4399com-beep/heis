// ============================================================
// 反馈管理 — 后台列表 GET (带 status/type/搜索过滤 + 分页)
// 鉴权由 middleware 处理; 此处只负责业务逻辑
// ============================================================
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { withGuard, likeSafe, clampInt } from '../../_lib/http'

export const dynamic = 'force-dynamic'

const PAGE_MIN = 1
const PAGE_MAX = 10_000
const SIZE_MIN = 5
const SIZE_MAX = 100

const STATUS_SET = new Set(['new', 'read', 'resolved', 'ignored'])
const TYPE_SET = new Set(['bug', 'suggestion', 'praise', 'other'])

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const page = clampInt(url.searchParams.get('page'), 1, PAGE_MIN, PAGE_MAX)
    const size = clampInt(url.searchParams.get('size'), 20, SIZE_MIN, SIZE_MAX)
    const status = url.searchParams.get('status') || ''
    const type = url.searchParams.get('type') || ''
    const q = likeSafe(url.searchParams.get('q'), 100)

    const where: Record<string, unknown> = {}
    if (status && STATUS_SET.has(status)) where.status = status
    if (type && TYPE_SET.has(type)) where.type = type
    if (q) where.content = { contains: q }

    const [rows, total] = await Promise.all([
      db.feedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
        select: {
          id: true,
          type: true,
          contact: true,
          content: true,
          url: true,
          siteId: true,
          status: true,
          ip: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.feedback.count({ where }),
    ])

    // 统计概览: total / new / resolved
    const [allCount, newCount, resolvedCount] = await Promise.all([
      db.feedback.count(),
      db.feedback.count({ where: { status: 'new' } }),
      db.feedback.count({ where: { status: 'resolved' } }),
    ])

    return ok({
      rows,
      total,
      page,
      size,
      pages: Math.max(1, Math.ceil(total / size)),
      stats: { total: allCount, new: newCount, resolved: resolvedCount },
    })
  })
}
