// 站点更新/删除
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { THEMES } from '@/lib/crawl/themes'
import { withGuard, str, clampInt } from '../../../_lib/http'

// 与 POST 同步: 放行 localhost[:port](种子默认站域名即 localhost:3000, 旧正则误拒致站点无法回存)
const DOMAIN_RE = /^(localhost(:\d{1,5})?|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?)$/

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const exist = await db.site.findUnique({ where: { id } })
    if (!exist) return fail('站点不存在', 404)

    const data: Record<string, unknown> = {}
    if (body?.name !== undefined) {
      const name = str(body.name, 100).trim()
      if (!name) return fail('站点名称不能为空')
      data.name = name
    }
    // 字段长度与 POST 保持一致: title 200 / description·keywords 500 / icbm 50 / geoRegion 10 / geoPlacename 50
    const FIELD_CAPS = { title: 200, description: 500, keywords: 500, icbm: 50, geoRegion: 10, geoPlacename: 50 } as const
    for (const k of ['title', 'description', 'keywords', 'icbm', 'geoRegion', 'geoPlacename'] as const) {
      if (body?.[k] !== undefined) data[k] = str(body[k], FIELD_CAPS[k])
    }
    if (body?.themeId !== undefined) {
      const tid = str(body.themeId, 50).trim()
      if (!THEMES.some((t) => t.id === tid)) return fail('未知主题模板')
      data.themeId = tid
    }
    if (body?.domain !== undefined) {
      const domain = str(body.domain, 253).trim().toLowerCase()
      if (!domain || !DOMAIN_RE.test(domain)) return fail('域名格式非法(例: www.example.com 或 localhost:3000)')
      data.domain = domain
    }
    if (body?.offset !== undefined) data.offset = clampInt(body.offset, 0, 0, 1_000_000_000)
    if (body?.status !== undefined) data.status = !!body.status
    if (body?.inLinkWheel !== undefined) data.inLinkWheel = !!body.inLinkWheel
    if (body?.isDefault === true) data.isDefault = true

    try {
      let site
      if (data.isDefault === true) {
        // 事务: 清旧默认 + 写本站默认原子化 — 拆开两步时 update 失败(如并发删除本站)
        // 会留下全站零默认站(sitemap/下载站点信息 findFirst(isDefault) 落空)
        const [, updated] = await db.$transaction([
          db.site.updateMany({ data: { isDefault: false } }),
          db.site.update({ where: { id }, data }),
        ])
        site = updated
      } else {
        site = await db.site.update({ where: { id }, data })
      }
      return ok(site)
    } catch (e: any) {
      // domain 改成其它站已占用域名 → 唯一约束冲突(原先裸 500); P2025 = 并发删除本站
      if (e?.code === 'P2002') return fail('该域名已存在')
      if (e?.code === 'P2025') return fail('站点不存在, 请刷新后重试', 404)
      throw e
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const site = await db.site.findUnique({ where: { id } })
    if (!site) return fail('站点不存在', 404)
    if (site.isDefault) return fail('默认站点不可删除')
    try {
      await db.site.delete({ where: { id } })
    } catch (e: any) {
      // tt-b: 预检与 delete 间的并发删除/默认站切换窗口(P2025)原会裸 500 → 404 契约
      if (e?.code === 'P2025') return fail('站点不存在, 请刷新后重试', 404)
      throw e
    }
    return ok()
  })
}
