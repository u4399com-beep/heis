// ============================================================
// 全本完本小说视图 — sort=fulltext (status=completed)
// R25: clone-* 主题走 FulltextViewLookup → clone-themes/<site>/FulltextView
//      SSR: page.tsx server fetch books by sort=fulltext, 传 initialBooks 让 SSR 渲染全本列表
// ============================================================
'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { BookCheck } from 'lucide-react'
import { fetchBooks, type BooksData } from './data'
import { usePublic } from './ctx'
import { useSiteSEO } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { EmptyState, ErrorState, BookGridSkeleton, bookNavProps, StatusBadge } from './bits'
import { BookCover } from './BookCover'
import { formatWords } from './seo'
import { Pagination } from './Pagination'
import type { BookItem } from './types'

// R25: FulltextView lookup table — clone-* 主题动态加载对应 FulltextView 组件, ssr=true 让 SSR 直接渲染源站 DOM
const FulltextViewLookup: Record<string, React.ComponentType<any>> = {
  'clone-aijjxs': dynamic(() => import('./clone-themes/aijjxs').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-ddyueshu': dynamic(() => import('./clone-themes/ddyueshu').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-pilishuwu': dynamic(() => import('./clone-themes/pilishuwu').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-23qb': dynamic(() => import('./clone-themes/23qb').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-101kks': dynamic(() => import('./clone-themes/101kks').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-huangjinwu': dynamic(() => import('./clone-themes/huangjinwu').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-ggd66': dynamic(() => import('./clone-themes/ggd66').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-shipsay': dynamic(() => import('./clone-themes/shipsay').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-x2552': dynamic(() => import('./clone-themes/x2552').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
  'clone-trxsw': dynamic(() => import('./clone-themes/trxsw').then(m => m.FulltextView), { ssr: true, loading: () => <BookGridSkeleton count={12} /> }),
}

interface FetchState { key: string; data?: BooksData; error?: string }

export function FulltextView({ page, initialBooks, initialCategories }: { page: number; initialBooks?: any; initialCategories?: any[] }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  // R25: SSR 首载用 page.tsx server fetch 的 initialBooks 初始化 state, 让 SSR 时 loading=false → clone FulltextView 组件渲染全本列表
  const key = `${site.id}|fulltext|${page}`
  const [state, setState] = useState<FetchState | null>(initialBooks && initialBooks.books ? { key, data: initialBooks as BooksData } : null)
  // R25: firstRender ref — SSR 首载已有 initialBooks 时跳过首次 effect 避免 client fetch 覆盖
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current && state && state.data) {
      firstRender.current = false
      return
    }
    let alive = true
    fetchBooks({ site: site.id, sort: 'fulltext' as any, page, size: 24 })
      .then(d => { if (alive) setState({ key, data: d }) })
      .catch((e: Error) => { if (alive) setState({ key, error: e.message }) })
    return () => { alive = false }
  }, [key, site.id, page, state])
  const loading = !state || state.key !== key
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''
  useSiteSEO({
    title: generateTitle({ category: '全本小说', siteName: site.name }),
    description: generateMetaDescription({ category: '全本小说', siteName: site.name, intro: '全本完结小说在线阅读' }),
    keywords: generateKeywords({ category: '全本小说', siteName: site.name }),
    canonicalPath: `/?view=fulltext&page=${page}&site=${site.id}`, site,
  })
  const books: BookItem[] = data?.books || []
  // R25: clone-* 主题走 FulltextViewLookup, 否则走通用布局
  const Clone = FulltextViewLookup[theme.layout]
  if (Clone) {
    return (
      <Clone
        books={books}
        loading={loading}
        page={data?.page || page}
        total={data?.total || 0}
        size={data?.size || 24}
        onPage={(p: number) => navigate({ view: 'fulltext', page: p })}
        initialCategories={initialCategories}
      />
    )
  }
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <BookCheck className="h-6 w-6" style={{ color: v.primary }} aria-hidden />
        <h1 className="text-xl font-black" style={{ color: v.text }}>全本完本小说</h1>
      </div>
      {error ? <ErrorState message="全本列表加载失败" detail={error} /> : loading ? <BookGridSkeleton count={12} /> : !books.length ? <EmptyState text="暂无全本小说" /> : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {books.map((b) => (
            <article key={b.id} className="group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1.5"
              style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow }}
              {...bookNavProps(navigate, b.id)} aria-label={`查看《${b.name}》详情`}>
              <div className="relative">
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                <span className="absolute left-2 top-2"><StatusBadge status={b.status} small /></span>
              </div>
              <div className="space-y-1 p-3">
                <h3 className="line-clamp-1 text-sm font-bold" style={{ color: v.text }}>{b.name}</h3>
                <p className="line-clamp-1 text-xs" style={{ color: v.textMuted }}>{b.author}</p>
                <p className="line-clamp-1 text-[11px]" style={{ color: v.textMuted }}>{formatWords(b.wordCount)}</p>
              </div>
            </article>
          ))}
        </div>
      )}
      {data && data.total > data.size && (
        <Pagination page={data.page} total={data.total} size={data.size} onPage={(p) => navigate({ view: 'fulltext', page: p })} center />
      )}
    </div>
  )
}
