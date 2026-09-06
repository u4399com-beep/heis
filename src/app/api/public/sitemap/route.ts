// sitemap.xml 生成 (站群: 可带 ?site= 指定站点)
// API-13/20: sitemap index 模式 + 私网 IP 拒绝
//   - ?index=1        → <sitemapindex> 列出所有分页 URL(每页 50000 条, 最多 1000 页 = 50M URLs)
//   - ?page=N&site=X  → 该页 <urlset>(take:50000, skip:(N-1)*50000, books+chapters 合并分页)
//   - 无 ?page/无 ?index → 旧行为(单页 take:5000)向后兼容
//   - siteBase 拒绝 127.0.0.1 等 loopback/私网/CGNAT 地址段
import { db } from '@/lib/db'
import { withGuard, str, clampInt } from '../../_lib/http'

const PAGE_SIZE = 50_000
const MAX_PAGES = 1000 // 50_000 * 1_000 = 50M URLs 上限
const LEGACY_TAKE = 5000 // 向后兼容单页上限

/** 私网/loopback/链路本地/CGNAT 段正则(API-20) —— 防止把内网地址写进 sitemap 暴露给搜索引擎 */
const PRIVATE_HOST_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.6[4-9]\.|100\.[7-9]\d\.|100\.1[01]\d\.|100\.12[0-7]\.|0\.)/

/** 站点域名 → 安全的 https base (仅接受合法域名格式 + 拒绝私网段, 防注入非法URL/暴露内网) */
function siteBase(domain: string): string | null {
  const d = domain.trim().toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/.test(d)) return null
  // API-20: 拒绝 127.0.0.1 / 10.x / 192.168.x / 172.16-31.x / 169.254.x / 100.64-127.x(CGNAT) 等私网段
  // (原 siteBase 仅校验域名格式, 127.0.0.1 也合法通过, 被写入 sitemap 暴露给搜索引擎)
  if (PRIVATE_HOST_RE.test(d)) return null
  return `https://${d}`
}

/** 计算 sitemap 总页数(books+chapters 合并, 上限 MAX_PAGES) */
async function totalPages(): Promise<number> {
  const [books, chapters] = await Promise.all([db.book.count(), db.chapter.count()])
  const total = books + chapters
  if (total === 0) return 1 // 至少 1 页, 让 sitemap 不空
  return Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE))
}

/** 取第 N 页的 URL 条目(N 从 1 起) —— books 在前, chapters 在后, 跨表合并分页 */
async function fetchPageEntries(page: number, base: string): Promise<string[]> {
  const skip = (page - 1) * PAGE_SIZE
  if (skip < 0) return []

  const booksCount = await db.book.count()
  const entries: string[] = []

  // books 段
  if (skip < booksCount) {
    const takeBooks = Math.min(PAGE_SIZE, booksCount - skip)
    const books = await db.book.findMany({
      orderBy: { updatedAt: 'desc' },
      skip,
      take: takeBooks,
      select: { id: true, updatedAt: true },
    })
    for (const b of books) {
      entries.push(`  <url><loc>${base}/?view=book&id=${encodeURIComponent(b.id)}</loc><lastmod>${b.updatedAt.toISOString()}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`)
    }
    // chapters 段(若 books 不满一页)
    const remaining = PAGE_SIZE - books.length
    if (remaining > 0) {
      const chapters = await db.chapter.findMany({
        orderBy: { updatedAt: 'desc' },
        take: remaining,
        select: { id: true, updatedAt: true },
      })
      for (const c of chapters) {
        entries.push(`  <url><loc>${base}/?view=read&chapter=${encodeURIComponent(c.id)}</loc><lastmod>${c.updatedAt.toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`)
      }
    }
    return entries
  }

  // skip 已越过 books 段: 进入 chapters 段
  const chapterSkip = skip - booksCount
  const chapters = await db.chapter.findMany({
    orderBy: { updatedAt: 'desc' },
    skip: chapterSkip,
    take: PAGE_SIZE,
    select: { id: true, updatedAt: true },
  })
  for (const c of chapters) {
    entries.push(`  <url><loc>${base}/?view=read&chapter=${encodeURIComponent(c.id)}</loc><lastmod>${c.updatedAt.toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`)
  }
  return entries
}

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const siteId = str(url.searchParams.get('site'), 64).trim()
    let base = url.origin
    if (siteId) {
      const site = await db.site.findUnique({ where: { id: siteId } })
      const custom = site?.domain && site.domain !== 'localhost:3000' ? siteBase(site.domain) : null
      if (custom) base = custom
    }

    const pageParam = url.searchParams.get('page')
    const indexParam = url.searchParams.get('index')

    // ?page=N → 返回该页 <urlset>(take:50000, skip:(N-1)*50000)
    if (pageParam !== null) {
      const page = clampInt(pageParam, 1, 1, MAX_PAGES)
      const total = await totalPages()
      // 超出实际页数 → 返回空 urlset(不报错, 公共路由容错优先)
      const entries = page > total ? [] : await fetchPageEntries(page, base)
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
      return new Response(xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=600',
        },
      })
    }

    // ?index=1 → 返回 <sitemapindex> 列出所有分页 URL
    if (indexParam !== null) {
      const total = await totalPages()
      // 子 sitemap URL: /api/public/sitemap?page=N&site=X(保留 site 参数以保持 base 一致)
      const siteQs = siteId ? `&site=${encodeURIComponent(siteId)}` : ''
      const sitemapEntries: string[] = []
      for (let i = 1; i <= total; i++) {
        sitemapEntries.push(
          `  <sitemap><loc>${base}/api/public/sitemap?page=${i}${siteQs}</loc><lastmod>${new Date().toISOString()}</lastmod></sitemap>`
        )
      }
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join('\n')}
</sitemapindex>`
      return new Response(xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=600',
        },
      })
    }

    // 无 ?page/无 ?index → 旧行为(单页 take:5000) 向后兼容
    const books = await db.book.findMany({
      orderBy: { updatedAt: 'desc' },
      take: LEGACY_TAKE,
      select: { id: true, updatedAt: true },
    })
    const chapters = await db.chapter.findMany({
      orderBy: { updatedAt: 'desc' },
      take: LEGACY_TAKE,
      select: { id: true, updatedAt: true },
    })

    const entries: string[] = []
    entries.push(`  <url><loc>${base}/?view=home</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`)
    for (const b of books) {
      entries.push(`  <url><loc>${base}/?view=book&id=${encodeURIComponent(b.id)}</loc><lastmod>${b.updatedAt.toISOString()}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`)
    }
    for (const c of chapters) {
      entries.push(`  <url><loc>${base}/?view=read&chapter=${encodeURIComponent(c.id)}</loc><lastmod>${c.updatedAt.toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`)
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=600',
      },
    })
  })
}
