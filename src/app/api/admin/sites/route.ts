// 站群站点 CRUD
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { THEMES } from '@/lib/crawl/themes'
import { withGuard, str, clampInt } from '../../_lib/http'

/** 域名格式: 支持多级域名 + 可选端口; 另放行 localhost[:port](种子默认站即此形态, 旧正则误拒致默认站无法回存) */
const DOMAIN_RE = /^(localhost(:\d{1,5})?|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?)$/

function validTheme(raw: unknown): string {
  const id = str(raw, 50).trim()
  return THEMES.some((t) => t.id === id) ? id : 'aurora'
}

export async function GET() {
  return withGuard(async () => {
    const sites = await db.site.findMany({ orderBy: { createdAt: 'asc' } })
    return ok(sites)
  })
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody(req)
    const name = str(body?.name, 100).trim()
    if (!name) return fail('站点名称必填')
    const domain = str(body?.domain, 253).trim().toLowerCase()
    if (!domain) return fail('域名必填')
    if (!DOMAIN_RE.test(domain)) return fail('域名格式非法(例: www.example.com 或 localhost:3000)')
    const exists = await db.site.findUnique({ where: { domain } })
    if (exists) return fail('该域名已存在')

    const isFirst = (await db.site.count()) === 0
    const makeDefault = body?.isDefault === true || isFirst
    const siteData = {
      name,
      domain,
      themeId: validTheme(body?.themeId),
      title: str(body?.title, 200).trim() || name,
      description: str(body?.description, 500),
      keywords: str(body?.keywords, 500),
      icbm: str(body?.icbm, 50).trim() || '35.86166,104.195397',
      geoRegion: str(body?.geoRegion, 10).trim() || 'CN',
      geoPlacename: str(body?.geoPlacename, 50).trim() || '中国',
      offset: clampInt(body?.offset, 0, 0, 1_000_000_000),
      isDefault: makeDefault,
      status: body?.status !== false,
      // 站群链轮: 缺省参与, 仅显式 false 才退出
      inLinkWheel: body?.inLinkWheel !== false,
    }
    let site
    try {
      if (makeDefault) {
        // 事务: 清旧默认 + 新建原子化。拆开两步时 create 失败(如并发同名域名 P2002)
        // 会留下全站零默认站(sitemap/下载站点信息 findFirst(isDefault) 落空);
        // 同时防并发首建双双 isDefault=true(SQLite 写串行保证恰好一个默认站)
        const [, created] = await db.$transaction([
          db.site.updateMany({ data: { isDefault: false } }),
          db.site.create({ data: siteData }),
        ])
        site = created
      } else {
        site = await db.site.create({ data: siteData })
      }
    } catch (e: any) {
      // 预检与 create 之间存在并发同名域名窗口 → 唯一约束冲突转友好 400
      if (e?.code === 'P2002') return fail('该域名已存在')
      throw e
    }
    return ok(site)
  })
}
