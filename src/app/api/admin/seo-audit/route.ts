// ============================================================
// 站点 SEO 体检 — GET /api/admin/seo-audit
// 扫描所有站点 (?site=<id> 仅扫一个), 对每个站点逐项检查并计算评分
//
// 检查维度: TDK / 域名 / 内容(书籍数) / 友链链轮 / 主题 / GEO / sitemap / offset
// 评分: 起始 100, 每个 error -10, warning -3, info -1, 下限 0
// 返回 { sites: [...], summary: {...} }
// ============================================================
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { withGuard, str } from '../../_lib/http'
import { THEMES } from '@/lib/crawl/themes'

type Severity = 'error' | 'warning' | 'info'
type Category = 'tdk' | 'domain' | 'content' | 'links' | 'theme' | 'geo' | 'sitemap' | 'offset' | 'tech'

interface Issue {
  severity: Severity
  category: Category
  message: string
  fix: string
}

interface SiteReport {
  siteId: string
  siteName: string
  domain: string
  score: number
  issues: Issue[]
  passed: string[]
}

interface AuditSummary {
  totalSites: number
  avgScore: number
  totalIssues: number
  totalErrors: number
}

const PRIVATE_HOST_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.6[4-9]\.|100\.[7-9]\d\.|100\.1[01]\d\.|100\.12[0-7]\.|0\.)/

const DOMAIN_RE = /^(localhost(:\d{1,5})?|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?)$/

function validIcbm(s: string): boolean {
  if (!s) return false
  const m = s.split(',').map((x) => x.trim())
  if (m.length !== 2) return false
  const [lat, lng] = m.map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

/** 对单个站点执行所有 SEO 检查 */
async function auditSite(
  site: {
    id: string; name: string; domain: string; themeId: string;
    title: string; description: string; keywords: string;
    icbm: string; geoRegion: string; geoPlacename: string;
    offset: number; inLinkWheel: boolean;
  },
  bookCount: number,
  linkWheelCount: number,
  themeIds: Set<string>,
): Promise<SiteReport> {
  const issues: Issue[] = []
  const passed: string[] = []

  // ---- TDK ----
  const t = (site.title || '').trim()
  if (!t) {
    issues.push({ severity: 'error', category: 'tdk', message: '缺失站点标题 (title)', fix: '在站点设置中填写 title (建议 5-30 字)' })
  } else if (t.length < 5 || t.length > 30) {
    issues.push({ severity: 'warning', category: 'tdk', message: `标题长度 ${t.length} 字, 建议 5-30 字`, fix: '调整 title 长度以利于搜索结果展示' })
  } else {
    passed.push('标题长度合规 (5-30 字)')
  }

  const d = (site.description || '').trim()
  if (!d) {
    issues.push({ severity: 'error', category: 'tdk', message: '缺失页面描述 (description)', fix: '在站点设置中填写 description (建议 20-200 字)' })
  } else if (d.length < 20 || d.length > 200) {
    issues.push({ severity: 'warning', category: 'tdk', message: `描述长度 ${d.length} 字, 建议 20-200 字`, fix: '调整 description 长度以提升搜索点击率' })
  } else {
    passed.push('描述长度合规 (20-200 字)')
  }

  const kw = (site.keywords || '').trim()
  if (!kw) {
    issues.push({ severity: 'warning', category: 'tdk', message: '缺失关键词 (keywords)', fix: '在站点设置中填写 keywords (逗号分隔 3-10 个核心词)' })
  } else {
    passed.push('已设置关键词')
  }

  // ---- Domain ----
  const dom = (site.domain || '').toLowerCase()
  if (!dom) {
    issues.push({ severity: 'error', category: 'domain', message: '缺失域名', fix: '在站点设置中填写域名' })
  } else if (!DOMAIN_RE.test(dom)) {
    issues.push({ severity: 'error', category: 'domain', message: '域名格式非法', fix: '使用形如 www.example.com 或 localhost:3000 的合法域名' })
  } else if (dom === 'localhost' || dom.startsWith('localhost:') || PRIVATE_HOST_RE.test(dom)) {
    issues.push({ severity: 'warning', category: 'domain', message: '域名为 localhost 或私网地址, 不利于线上 SEO', fix: '切换到正式域名后再做 SEO 推广' })
  } else if (!dom.includes('.')) {
    issues.push({ severity: 'warning', category: 'domain', message: '域名未包含顶级域', fix: '使用形如 example.com 的完整域名' })
  } else {
    passed.push('域名格式合法')
  }

  // ---- Content (书籍数) ----
  if (bookCount === 0) {
    issues.push({ severity: 'warning', category: 'content', message: '该站点未关联任何书籍', fix: '为该站点添加采集任务或调整 offset 关联书籍' })
  } else if (bookCount < 5) {
    issues.push({ severity: 'info', category: 'content', message: `仅 ${bookCount} 本书, 内容量较少`, fix: '增加采集以丰富内容, 一般建议 ≥ 50 本' })
  } else {
    passed.push(`内容规模合适 (${bookCount} 本)`)
  }

  // ---- Friend links / link wheel ----
  if (linkWheelCount === 0) {
    issues.push({ severity: 'warning', category: 'links', message: '无友链参与链轮 (inLinkWheel)', fix: '在友链管理中至少启用一条 inLinkWheel 链接' })
  } else {
    passed.push(`链轮友链 ${linkWheelCount} 条`)
  }

  // ---- Theme ----
  if (!themeIds.has(site.themeId)) {
    issues.push({ severity: 'error', category: 'theme', message: `主题 ${site.themeId} 不存在`, fix: '在站点设置中选择已注册的主题' })
  } else {
    passed.push(`主题已注册 (${site.themeId})`)
  }

  // ---- GEO ----
  if (!site.icbm || !validIcbm(site.icbm)) {
    issues.push({ severity: 'warning', category: 'geo', message: 'ICBM 坐标格式不合法 (期望 "lat,lng")', fix: '填写形如 "35.86166,104.195397" 的经纬度' })
  } else {
    passed.push('ICBM 坐标合法')
  }
  if (!site.geoRegion) {
    issues.push({ severity: 'info', category: 'geo', message: '未设置 geoRegion', fix: '设置 ISO 国家码, 如 CN / US / JP' })
  } else {
    passed.push(`geoRegion = ${site.geoRegion}`)
  }
  if (!site.geoPlacename) {
    issues.push({ severity: 'info', category: 'geo', message: '未设置 geoPlacename', fix: '设置地区名称, 如 "中国" / "北京"' })
  } else {
    passed.push(`geoPlacename = ${site.geoPlacename}`)
  }

  // ---- Sitemap ----
  // 轻量校验: 站点域名合法则 sitemap 可生成 (sitemap 路由会拒绝私网域名)
  if (dom && DOMAIN_RE.test(dom) && !PRIVATE_HOST_RE.test(dom) && dom !== 'localhost' && !dom.startsWith('localhost:')) {
    passed.push('sitemap 可生成')
  } else {
    issues.push({ severity: 'warning', category: 'sitemap', message: '域名不合法或为私网, sitemap 将无法生成', fix: '修正域名后 sitemap 路由自动可用' })
  }

  // ---- Offset ----
  if (site.offset > 1_000_000) {
    issues.push({ severity: 'warning', category: 'offset', message: `offset 过大 (${site.offset.toLocaleString()}), 可能破坏分页`, fix: '将 offset 控制在 100 万以内' })
  } else if (site.offset < 0) {
    issues.push({ severity: 'error', category: 'offset', message: `offset 为负数 (${site.offset})`, fix: 'offset 必须 ≥ 0' })
  } else {
    passed.push(`offset 合理 (${site.offset.toLocaleString()})`)
  }

  // ---- Score ----
  let score = 100
  for (const it of issues) {
    if (it.severity === 'error') score -= 10
    else if (it.severity === 'warning') score -= 3
    else if (it.severity === 'info') score -= 1
  }
  score = Math.max(0, score)

  return {
    siteId: site.id,
    siteName: site.name,
    domain: site.domain,
    score,
    issues,
    passed,
  }
}

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const siteFilter = str(url.searchParams.get('site'), 64).trim()

    const sites = await db.site.findMany({ take: 500 })
    const themeIds = new Set(THEMES.map((t) => t.id))

    // 友链链轮统计
    const linkWheelCount = await db.friendLink.count({
      where: { enabled: true, url: { contains: 'http' } },
    })

    // 每个站点的书籍数 = 全库 books 数 (offset 仅影响分页起止, 不改变可访问书籍集合)
    // 体检语义: 站点无内容来源 → 全库为空时所有站点同样告警
    const totalBooks = await db.book.count()

    const targets = siteFilter ? sites.filter((s) => s.id === siteFilter) : sites
    if (siteFilter && targets.length === 0) {
      return fail('指定的站点不存在', 404)
    }

    const reports: SiteReport[] = []
    for (const site of targets) {
      const report = await auditSite(
        {
          id: site.id, name: site.name, domain: site.domain, themeId: site.themeId,
          title: site.title, description: site.description, keywords: site.keywords,
          icbm: site.icbm, geoRegion: site.geoRegion, geoPlacename: site.geoPlacename,
          offset: site.offset, inLinkWheel: site.inLinkWheel,
        },
        totalBooks,
        linkWheelCount,
        themeIds,
      )
      reports.push(report)
    }

    // 排序: 错误多的站点在前, 同错按分数升序
    reports.sort((a, b) => {
      const ae = a.issues.filter((i) => i.severity === 'error').length
      const be = b.issues.filter((i) => i.severity === 'error').length
      if (ae !== be) return be - ae
      return a.score - b.score
    })

    const totalIssues = reports.reduce((s, r) => s + r.issues.length, 0)
    const totalErrors = reports.reduce((s, r) => s + r.issues.filter((i) => i.severity === 'error').length, 0)
    const avgScore = reports.length === 0
      ? 0
      : Math.round(reports.reduce((s, r) => s + r.score, 0) / reports.length)

    const summary: AuditSummary = {
      totalSites: reports.length,
      avgScore,
      totalIssues,
      totalErrors,
    }

    return ok({ sites: reports, summary })
  })
}
