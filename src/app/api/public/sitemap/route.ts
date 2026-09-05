// sitemap.xml 生成 (站群: 可带 ?site= 指定站点)
import { db } from '@/lib/db'
import { withGuard, str } from '../../_lib/http'

/** 站点域名 → 安全的 https base (仅接受合法域名格式, 防注入非法URL) */
function siteBase(domain: string): string | null {
  const d = domain.trim().toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/.test(d)) return null
  return `https://${d}`
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

    const books = await db.book.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 5000,
      select: { id: true, updatedAt: true },
    })
    const chapters = await db.chapter.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 5000,
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
