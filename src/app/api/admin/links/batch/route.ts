// 友链批量操作 — delete / enable / disable
// body: { ids: string[], action: 'delete' | 'enable' | 'disable' }
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, isPlainObject } from '../../../_lib/http'
import { invalidateLinksCache } from '@/lib/links'

/** ids 消毒: 仅收字符串数组, 去重/去空/限长, 上限 500 */
function sanitizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const set = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const id = v.trim().slice(0, 64)
    if (id) set.add(id)
    if (set.size >= 500) break
  }
  return [...set]
}

const ACTIONS = ['delete', 'enable', 'disable'] as const
type Action = (typeof ACTIONS)[number]

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody<Record<string, any>>(req)
    if (!isPlainObject(body)) return fail('请求体必须是对象')
    const ids = sanitizeIds(body?.ids)
    if (!ids.length) return fail('请先选择要操作的友链')
    const action = String(body?.action ?? '')
    if (!(ACTIONS as readonly string[]).includes(action)) return fail(`不支持的操作: ${action.slice(0, 32)}`)

    const where = { id: { in: ids } }
    let affected = 0
    if (action === 'delete') {
      const r = await db.friendLink.deleteMany({ where })
      affected = r.count
    } else {
      const r = await db.friendLink.updateMany({ where, data: { enabled: action === 'enable' } })
      affected = r.count
    }
    invalidateLinksCache()
    return ok({ affected })
  })
}
