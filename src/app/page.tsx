// ============================================================
// 小说管理系统 — 主入口 (唯一路由, server component)
// 通过查询串/伪静态路径在 后台管理 / 前台站群站点 之间切换:
//   /                          → 后台管理
//   /?view=home|book|read|...  → 前台站点(查询串模式)
//   /book/123.html             → 前台书籍页(伪静态模式, 需 rewrite 配合)
//   /?admin=1                  → 强制后台
// 站群: /?view=...&site=<siteId> 或 /book/123.html?site=<siteId>
//
// R24: 改 server component — server 端 fetch site + sites 数据传给 PublicSite,
// 让 SSR 时就有 site/theme (避免 SSR sites=[] → theme=THEMES[0]非 clone → skeleton)
// ============================================================
import { db } from '@/lib/db'
import AdminApp from '@/components/admin/AdminApp'
import PublicSite from '@/components/public/PublicSite'
import { LoginGate } from '@/components/admin/LoginGate'
import { parseViewPath, PSEUDO_PRESETS, type PseudoStaticStyle } from '@/lib/pseudostatic'
import { headers } from 'next/headers'
import type { SiteInfo } from '@/components/public/types'

export const dynamic = 'force-dynamic'

type PublicViewObj = {
  view: 'home' | 'book' | 'read' | 'search' | 'keyword' | 'category' | 'history' | 'ranking' | 'fulltext'
  bookId?: string
  chapterId?: string
  q?: string
  tag?: string
  cat?: string
  site?: string
  page?: number
  theme?: string
}

export default async function Home({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams
  const view = typeof sp.view === 'string' ? sp.view : undefined
  const forceAdmin = sp.admin === '1'

  let publicView: PublicViewObj | undefined = undefined
  if (!forceAdmin && view) {
    // 查询串模式(?view=xxx)
    publicView = {
      view: view as PublicViewObj['view'],
      bookId: sp.id as string | undefined,
      chapterId: sp.chapter as string | undefined,
      q: sp.q as string | undefined,
      tag: sp.tag as string | undefined,
      cat: sp.cat as string | undefined,
      site: sp.site as string | undefined,
      page: sp.page ? Number(sp.page) : undefined,
      theme: sp.theme as string | undefined,
    }
  } else if (!forceAdmin) {
    // 伪静态路径模式 — server 端从 pathname 解析
    const h = await headers()
    const pathname = h.get('x-invoke-path') || h.get('x-pathname') || '/'
    const searchStr = h.get('x-invoke-query') || ''
    if (pathname && pathname !== '/') {
      for (const preset of PSEUDO_PRESETS) {
        const parsed = parseViewPath(pathname, searchStr, preset.id as PseudoStaticStyle)
        if (parsed.view !== 'home' || parsed.bookId || parsed.chapterId || parsed.cat || parsed.tag) {
          publicView = parsed as PublicViewObj
          break
        }
      }
    }
  }

  const isSite = !!publicView && !forceAdmin

  if (isSite && publicView) {
    // server 端 fetch site + sites + books + categories, 让 SSR 时就有完整数据
    // (避免 SSR sites=[] → theme=THEMES[0]非 clone → skeleton; 避免 books=[] → clone 组件只渲染"加载中")
    const siteId = publicView.site
    const [site, sites] = await Promise.all([
      siteId
        ? db.site.findUnique({ where: { id: siteId } })
        : db.site.findFirst({ where: { isDefault: true } }),
      db.site.findMany({ where: { status: true } }),
    ])
    // fetch books (复用 /api/public/books 的 offset wrap 逻辑) + categories
    const offset = (site as any)?.offset || 0
    const [total0, categories0] = await Promise.all([
      db.book.count({}),
      db.category.findMany({ orderBy: { sortOrder: 'asc' }, take: 60 }),
    ])
    const wrapOffset = total0 > 0 ? offset % total0 : 0
    const books0 = await db.book.findMany({
      orderBy: { updatedAt: 'desc' },
      skip: wrapOffset,
      take: 48,
      include: { category: true },
    })
    const books = books0.map((b: any) => ({
      id: b.id, name: b.name, author: b.author,
      intro: (b.intro || '').slice(0, 120), cover: b.cover, status: b.status,
      wordCount: b.wordCount, latestChapter: b.latestChapter,
      category: b.category?.name || '未分类', categoryId: b.categoryId, updatedAt: b.updatedAt,
    }))
    const categories = categories0.map((c: any) => ({ id: c.id, name: c.name }))
    // R24: server 端渲染 <link> 加载源站 CSS — server component 的 <link> 会 hoist 到 <head>
    // (CloneCSSLoader 是 client component, SSR 时 useEffect 不执行 + <link> 不 hoist → SSR 无源站 CSS)
    const themeId = (site as any)?.themeId || 'aurora'
    const cssUrl = themeId.startsWith('clone-')
      ? `/clone-css/${themeId.replace('clone-', '')}.css`
      : null
    return (
      <>
        {cssUrl && <link rel="stylesheet" href={cssUrl} />}
        <PublicSite
          initialSiteId={site?.id || ''}
          initialView={publicView}
          initialSite={(site as unknown as SiteInfo) || null}
          initialSites={(sites as unknown as SiteInfo[]) || []}
          initialBooks={books}
          initialCategories={categories}
          embedMode
        />
      </>
    )
  }

  return (
    <LoginGate>
      <AdminApp />
    </LoginGate>
  )
}
