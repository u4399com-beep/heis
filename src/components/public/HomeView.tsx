// ============================================================
// 首页视图 — 按 theme.layout 分发到 clone-themes/<site>/HomeClone
// 8 页型契约: home/book/read/category/ranking/fulltext/search/keyword
// ============================================================
'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowDownWideNarrow, Home as HomeIcon } from 'lucide-react'
import { fetchBooks, type BooksData } from './data'
import { usePublic } from './ctx'
import { siteKeywordList, useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { EmptyState, ErrorState, SuggestTagCloud, TagCloud, BookGridSkeleton } from './bits'
import { CategoryShowcase } from './CategoryShowcase'
import type { BookItem } from './types'

// R17: 从 clone-themes/ 懒加载 10 套首页布局
const HomeCloneAijjxs = dynamic(() => import('./clone-themes/aijjxs').then(m => m.HomeClone))
const HomeCloneDdyueshu = dynamic(() => import('./clone-themes/ddyueshu').then(m => m.HomeClone))
const HomeClonePilishuwu = dynamic(() => import('./clone-themes/pilishuwu').then(m => m.HomeClone))
const HomeClone23qb = dynamic(() => import('./clone-themes/23qb').then(m => m.HomeClone))
const HomeClone101kks = dynamic(() => import('./clone-themes/101kks').then(m => m.HomeClone))
const HomeCloneHuangjinwu = dynamic(() => import('./clone-themes/huangjinwu').then(m => m.HomeClone))
const HomeCloneGgd66 = dynamic(() => import('./clone-themes/ggd66').then(m => m.HomeClone))
const HomeCloneShipsay = dynamic(() => import('./clone-themes/shipsay').then(m => m.HomeClone))
const HomeCloneX2552 = dynamic(() => import('./clone-themes/x2552').then(m => m.HomeClone))
const HomeCloneTrxsw = dynamic(() => import('./clone-themes/trxsw').then(m => m.HomeClone))

interface FetchState { key: string; data?: BooksData; error?: string }

export function HomeView({ page, cat }: { page: number; cat?: string }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [sort, setSort] = useState<'latest' | 'words'>('latest')
  const [state, setState] = useState<FetchState | null>(null)
  const key = `${site.id}|${cat || ''}|${sort}|${page}`

  useEffect(() => {
    let alive = true
    fetchBooks({ site: site.id, cat, sort, page, size: 48 })
      .then(d => { if (alive) setState({ key, data: d }) })
      .catch((e: Error) => { if (alive) setState({ key, error: e.message }) })
    return () => { alive = false }
  }, [key, site.id, cat, sort, page])

  const loading = !state || state.key !== key
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''
  const catName = cat ? data?.books[0]?.category || '当前分类' : ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  useSiteSEO({
    title: site.title || generateTitle({ siteName: site.name, category: catName || undefined }),
    description: site.description || generateMetaDescription({ siteName: site.name, category: catName || undefined, intro: '精品小说在线阅读' }),
    keywords: site.keywords || generateKeywords({ siteName: site.name, category: catName || undefined }),
    canonicalPath: cat ? `/?cat=${cat}&site=${site.id}` : `/?site=${site.id}`,
    site,
    jsonLd: useMemo(() => [{
      '@context': 'https://schema.org', '@type': 'WebSite',
      name: site.name, url: `${origin}/`, description: site.description, inLanguage: 'zh-CN',
      potentialAction: { '@type': 'SearchAction', target: `${origin}/?view=search&q={search_term_string}&site=${site.id}`, 'query-input': 'required name=search_term_string' },
    }], [origin, site.id, site.name, site.description]),
  })

  const books: BookItem[] = data?.books || []
  const navCat = (site as any).navCategoryCount || 16
  const modLimit = (site as any).homeModuleLimit || 20

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <section className="mb-5"><SuggestTagCloud count={16} refresh /></section>
      <div className="mb-6"><CategoryShowcase /></div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setSort('latest'); navigate({ view: 'home', cat, page: 1 }) }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ background: sort === 'latest' ? v.primary : v.surface, color: sort === 'latest' ? v.primaryText : v.text, border: `1px solid ${sort === 'latest' ? v.primary : v.border}`, borderRadius: v.radius }}
            aria-pressed={sort === 'latest'}><HomeIcon className="h-3.5 w-3.5" aria-hidden />最新更新</button>
          <button type="button" onClick={() => { setSort('words'); navigate({ view: 'home', cat, page: 1 }) }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ background: sort === 'words' ? v.primary : v.surface, color: sort === 'words' ? v.primaryText : v.text, border: `1px solid ${sort === 'words' ? v.primary : v.border}`, borderRadius: v.radius }}
            aria-pressed={sort === 'words'}><ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />字数最多</button>
        </div>
        {cat && <button type="button" onClick={() => navigate({ view: 'home' })}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
          style={{ background: withAlpha(v.accent, 0.14), color: v.accent, border: `1px solid ${withAlpha(v.accent, 0.4)}` }}
          aria-label="清除分类筛选">分类：{catName} · 点击清除</button>}
      </div>
      {error ? <ErrorState message="书籍列表加载失败" detail={error} /> : !loading && !books.length ? <EmptyState /> : (
        <>
          {theme.layout === 'clone-aijjxs' && <HomeCloneAijjxs books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {theme.layout === 'clone-ddyueshu' && <HomeCloneDdyueshu books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {theme.layout === 'clone-pilishuwu' && <HomeClonePilishuwu books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {theme.layout === 'clone-23qb' && <HomeClone23qb books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {theme.layout === 'clone-101kks' && <HomeClone101kks books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {theme.layout === 'clone-huangjinwu' && <HomeCloneHuangjinwu books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {theme.layout === 'clone-ggd66' && <HomeCloneGgd66 books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {theme.layout === 'clone-shipsay' && <HomeCloneShipsay books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {theme.layout === 'clone-x2552' && <HomeCloneX2552 books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {theme.layout === 'clone-trxsw' && <HomeCloneTrxsw books={books} loading={loading} navCategoryCount={navCat} homeModuleLimit={modLimit} />}
          {!['clone-aijjxs','clone-ddyueshu','clone-pilishuwu','clone-23qb','clone-101kks','clone-huangjinwu','clone-ggd66','clone-shipsay','clone-x2552','clone-trxsw'].includes(theme.layout) && loading && <BookGridSkeleton count={12} />}
        </>
      )}
      {!loading && books.length > 0 && (
        <section className="pt-8" aria-label="热门标签">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-bold tracking-widest" style={{ color: v.text }}>热门标签</span>
          </div>
          <TagCloud tags={siteKeywordList(site)} />
        </section>
      )}
    </div>
  )
}
