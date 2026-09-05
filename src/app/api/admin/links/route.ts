// 友情链接 CRUD — name 1~60 / url http(s) 白名单 / logo http(s) 或站内路径 / sortOrder 钳制
// 变更后失效读侧缓存(links.ts), 页脚立即拿到新数据
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, str, clampInt, httpUrl } from '../../_lib/http'
import { invalidateLinksCache } from '@/lib/links'

const SORT_MAX = 99_999

/**
 * 友链地址消毒: 仅接受 http/https。
 * - 无 scheme:// → 自动补 https:// (输入 "example.com" → "https://example.com")
 * - 已带 scheme:// → 原样校验, 白名单外(scheme: ///javascript: 等)一律拒
 *   ⚠️ scheme 检测必须先行: 否则 "ftp://bad.example.com" 会被拼成
 *   "https://ftp://bad.example.com" — URL 解析为合法 https 且 host=ftp, 绕过 ftp 拒绝。
 */
function normalizeLinkUrl(raw: unknown): string | null {
  const s = str(raw, 2000).trim()
  if (!s) return null
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
  return httpUrl(candidate, 2000)
}

/**
 * logo 消毒: 空串 | http(s) 外链 | 站内 / 开头路径。
 * // 开头拒绝 — 协议相对地址(http:/https:随页面)在 https 站点下正常,
 * 但会被第三方页面反解析出访客来源, 且混入外站协议语义, 一律不接受。
 */
function normalizeLogo(raw: unknown): { value: string; error?: string } {
  const s = str(raw, 2000).trim()
  if (!s) return { value: '' }
  if (s.startsWith('//')) return { value: '', error: 'logo 不支持 // 开头的协议相对地址' }
  if (s.startsWith('/')) return { value: s }
  if (/^https?:\/\//i.test(s)) {
    const v = httpUrl(s, 2000)
    return v ? { value: v } : { value: '', error: 'logo 地址非法(仅支持 http/https)' }
  }
  return { value: '', error: 'logo 仅支持 http(s) 外链或站内 / 开头路径' }
}

export async function GET() {
  return withGuard(async () => {
    const links = await db.friendLink.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
    return ok(links)
  })
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody<Record<string, any>>(req)
    const name = str(body?.name, 60).trim()
    if (!name) return fail('名称必填(1~60字)')
    const url = normalizeLinkUrl(body?.url)
    if (!url) return fail('链接地址非法(仅支持 http/https)')
    const logo = normalizeLogo(body?.logo)
    if (logo.error) return fail(logo.error)

    const link = await db.friendLink.create({
      data: {
        name,
        url,
        logo: logo.value,
        sortOrder: clampInt(body?.sortOrder, 0, 0, SORT_MAX),
        enabled: body?.enabled !== false,
      },
    })
    invalidateLinksCache()
    return ok(link)
  })
}

export async function PUT(req: Request) {
  return withGuard(async () => {
    const body = await readBody<Record<string, any>>(req)
    const id = str(body?.id, 64).trim()
    if (!id) return fail('缺少 id')
    const exist = await db.friendLink.findUnique({ where: { id } })
    if (!exist) return fail('友链不存在', 404)

    const data: Record<string, unknown> = {}
    if (body?.name !== undefined) {
      const name = str(body.name, 60).trim()
      if (!name) return fail('名称不能为空(1~60字)')
      data.name = name
    }
    if (body?.url !== undefined) {
      const url = normalizeLinkUrl(body.url)
      if (!url) return fail('链接地址非法(仅支持 http/https)')
      data.url = url
    }
    if (body?.logo !== undefined) {
      const logo = normalizeLogo(body.logo)
      if (logo.error) return fail(logo.error)
      data.logo = logo.value
    }
    if (body?.sortOrder !== undefined) data.sortOrder = clampInt(body.sortOrder, 0, 0, SORT_MAX)
    if (body?.enabled !== undefined) data.enabled = !!body.enabled

    try {
      const link = await db.friendLink.update({ where: { id }, data })
      invalidateLinksCache()
      return ok(link)
    } catch (e: any) {
      // tt-b: 预检与 update 间的并发删除窗口(P2025)原会裸 500 → 404 契约
      if (e?.code === 'P2025') return fail('友链不存在, 请刷新后重试', 404)
      throw e
    }
  })
}

export async function DELETE(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const id = str(url.searchParams.get('id'), 64).trim()
    if (!id) return fail('缺少 id')
    const exist = await db.friendLink.findUnique({ where: { id } })
    if (!exist) return fail('友链不存在', 404)
    try {
      await db.friendLink.delete({ where: { id } })
    } catch (e: any) {
      // tt-b: 预检与 delete 间的并发删除窗口(P2025)原会裸 500 → 404 契约
      if (e?.code === 'P2025') return fail('友链不存在, 请刷新后重试', 404)
      throw e
    }
    invalidateLinksCache()
    return ok()
  })
}
