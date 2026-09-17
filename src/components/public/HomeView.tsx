// ============================================================
// 首页视图 — R20-1A: 10 套 clone-themes dynamic import 分发
// ============================================================
'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowDownWideNarrow, Home as HomeIcon } from 'lucide-react'
import { fetchBooks, type BooksData } from './data'
import { usePublic } from './ctx'
import { siteKeywordList, useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { EmptyState, ErrorState, SuggestTagCloud, TagCloud, BookGridSkeleton, bookNavProps, StatusBadge } from './bits'
import { CategoryShowcase } from './CategoryShowcase'
import { BookCover } from './BookCover'
import { formatWords } from './seo'
import type { BookItem } from './types'

// R20-1A: 10 套 clone-themes dynamic import (按 theme.layout 分发, ssr:false 仅客户端渲染)
const CloneHomeViews = {
  'clone-aijjxs': dynamic(() => import('./clone-themes/aijjxs').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-ddyueshu': dynamic(() => import('./clone-themes/ddyueshu').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-pilishuwu': dynamic(() => import('./clone-themes/pilishuwu').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-23qb': dynamic(() => import('./clone-themes/23qb').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-101kks': dynamic(() => import('./clone-themes/101kks').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-huangjinwu': dynamic(() => import('./clone-themes/huangjinwu').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-ggd66': dynamic(() => import('./clone-themes/ggd66').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-shipsay': dynamic(() => import('./clone-themes/shipsay').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-x2552': dynamic(() => import('./clone-themes/x2552').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-trxsw': dynamic(() => import('./clone-themes/trxsw').then(m => m.HomeClone), { ssr: false, loading: () => <BookGridSkeleton count={12} /> }),
} as const

interface FetchState { key: string; data?: BooksData; error?: string }

function GenericBookGrid({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  if (loading) return <BookGridSkeleton count={12} />
  if (!books.length) return <EmptyState />
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {books.map((b) => (
        <article key={b.id} className="group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1.5"
          style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow }}
          {...bookNavProps(navigate, b.id)} aria-label={`查看《${b.name}》详情`}>
          <div className="relative">
            <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
            <span className="absolute left-2 top-2"><StatusBadge status={b.status} small /></span>
            <span className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: withAlpha(v.primaryText, 0.9), color: v.primary }}>{formatWords(b.wordCount)}</span>
          </div>
          <div className="space-y-1 p-3">
            <h3 className="line-clamp-1 text-sm font-bold" style={{ color: v.text }}>{b.name}</h3>
            <p className="line-clamp-1 text-xs" style={{ color: v.textMuted }}>{b.author}</p>
            <p className="line-clamp-1 text-[11px]" style={{ color: v.textMuted }}>
              <span className="mr-1 rounded-full px-1.5 py-px" style={{ background: v.surfaceAlt, color: v.accent }}>{b.category}</span>
              {b.latestChapter || '暂无章节'}
            </p>
          </div>
        </article>
      ))}
    </div>
  )
}

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
      {error ? <ErrorState message="书籍列表加载失败" detail={error} /> : (() => {
        // R20-1A: 按 theme.layout 分发到 clone-themes/<site>/HomeClone, fallback GenericBookGrid
        const CloneHome = CloneHomeViews[theme.layout as keyof typeof CloneHomeViews]
        if (CloneHome) {
          return (
            <CloneHome
              books={books}
              loading={loading}
              navCategoryCount={site.navCategoryCount}
              homeModuleLimit={site.homeModuleLimit}
            />
          )
        }
        return <GenericBookGrid books={books} loading={loading} />
      })()}
      {!loading && books.length > 0 && (
        <section className="pt-8" aria-label="热门标签">
          <div className="mb-3 flex items-center gap-2"><span className="text-sm font-bold tracking-widest" style={{ color: v.text }}>热门标签</span></div>
          <TagCloud tags={siteKeywordList(site)} />
        </section>
      )}
    </div>
  )
}
