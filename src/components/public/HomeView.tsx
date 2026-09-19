// 首页视图 — R24 推倒重建窗口期通用兜底
// ============================================================
'use client'
import React from 'react'
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


// R34-1A: clone-themes 按需 dynamic import — 只为当前请求的 layout 创建 dynamic 组件 wrapper
// 之前: 模块顶层 10 个 dynamic() 立刻求值 → 每次 HomeView 模块加载都创建 10 个 wrapper (内存浪费)
// 现在: cloneLoaders 只是个函数引用表 (零开销), getClone(layout) 首次调用才 dynamic() 并缓存
// SSR 行为不变 (ssr=true 让 SSR 渲染 clone DOM, 防 ssr=false 客户端 JS OOM 空白);
// webpack 仍会为 10 个 import() 各建一个 async chunk (源码静态分析必要), 但模块
// 顶层求值从 10 次 dynamic() 调用降到 0, 渲染时也只创建 1 个 wrapper (per layout 缓存)
type CloneHomeModule = { HomeClone: React.ComponentType<any> }
const cloneLoaders: Record<string, () => Promise<CloneHomeModule>> = {
  'clone-aijjxs': () => import('./clone-themes/aijjxs'),
  'clone-ddyueshu': () => import('./clone-themes/ddyueshu'),
  'clone-pilishuwu': () => import('./clone-themes/pilishuwu'),
  'clone-23qb': () => import('./clone-themes/23qb'),
  'clone-101kks': () => import('./clone-themes/101kks'),
  'clone-huangjinwu': () => import('./clone-themes/huangjinwu'),
  'clone-ggd66': () => import('./clone-themes/ggd66'),
  'clone-shipsay': () => import('./clone-themes/shipsay'),
  'clone-x2552': () => import('./clone-themes/x2552'),
  'clone-trxsw': () => import('./clone-themes/trxsw'),
}
const cloneHomeCache = new Map<string, React.ComponentType<any>>()
function getCloneHome(layout: string): React.ComponentType<any> | undefined {
  const loader = cloneLoaders[layout]
  if (!loader) return undefined
  let cached = cloneHomeCache.get(layout)
  if (!cached) {
    // dynamic() 接收的 loader 必须 return 模块 (含 default 或具名 export);
    // cloneLoaders 返回 { HomeClone } 具名 export → unwrap 出来给 dynamic
    cached = dynamic(() => loader().then(m => m.HomeClone), {
      ssr: true,
      loading: () => <BookGridSkeleton count={12} />,
    })
    cloneHomeCache.set(layout, cached)
  }
  return cached
}

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

export function HomeView({ page, cat, initialBooks, initialCategories }: { page: number; cat?: string; initialBooks?: any[]; initialCategories?: any[] }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [sort, setSort] = useState<'latest' | 'words'>('latest')
  // R24: SSR 首载用 page.tsx server fetch 的 initialBooks 初始化 state, 让 SSR 时 loading=false → clone 组件渲染 books 数据
  const key = `${site.id}|${cat || ''}|${sort}|${page}`
  const [state, setState] = useState<FetchState | null>(initialBooks && initialBooks.length > 0 ? { key, data: { books: initialBooks, total: initialBooks.length, page: 1, size: 48 } as any } : null)
  useEffect(() => {
    // initialBooks 已是 server fetch 的首屏数据, 首次 effect 跳过避免覆盖; sort/page/cat 变化时重新 fetch
    if (state && state.key === key && state.data) return
    let alive = true
    fetchBooks({ site: site.id, cat, sort, page, size: 48 })
      .then(d => { if (alive) setState({ key, data: d }) })
      .catch((e: Error) => { if (alive) setState({ key, error: e.message }) })
    return () => { alive = false }
  }, [key, site.id, cat, sort, page, state])
  const loading = !state || state.key !== key
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''
  const catName = cat ? data?.books[0]?.category || '当前分类' : ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  useSiteSEO({
    title: site.title || generateTitle({ siteName: site.name, category: catName || undefined }),
    description: site.description || generateMetaDescription({ siteName: site.name, category: catName || undefined, intro: '精品小说在线阅读' }),
    keywords: site.keywords || generateKeywords({ siteName: site.name, category: catName || undefined }),
    canonicalPath: cat ? `/?cat=${cat}&site=${site.id}` : `/?site=${site.id}`, site,
    jsonLd: useMemo(() => [{
      '@context': 'https://schema.org', '@type': 'WebSite',
      name: site.name, url: `${origin}/`, description: site.description, inLanguage: 'zh-CN',
      potentialAction: { '@type': 'SearchAction', target: `${origin}/?view=search&q={search_term_string}&site=${site.id}`, 'query-input': 'required name=search_term_string' },
    }], [origin, site.id, site.name, site.description]),
  })
  const books: BookItem[] = data?.books || []
  // R34-1A: getCloneHome 在 cloneHomeCache (module 级 Map) 缓存, 同 layout 跨渲染返回同一实例
  // (不会每次渲染重建 → state 不重置); 首次调用时 dynamic() 创建 wrapper 是 lazy init 模式
  const Clone = getCloneHome(theme.layout)
  // R24: clone-* 主题完全接管首页 — 不渲染通用 wrapper/SuggestTagCloud/CategoryShowcase/排序按钮/热门标签
  // 源站首页有自己的 header/navigation/分类区块, 通用组件会遮盖源站布局
  if (Clone) {
    return (
      // eslint-disable-next-line react-hooks/static-components -- Clone 来自 module 级缓存, 同 layout 跨渲染稳定
      <Clone books={books} loading={loading}
        navCategoryCount={(site as any).navCategoryCount}
        homeModuleLimit={(site as any).homeModuleLimit}
        initialCategories={initialCategories} />
    )
  }
  // 非 clone 主题: 通用布局 (搜索推荐 + 分类导航 + 排序 + 书网格 + 热门标签)
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
      {error ? <ErrorState message="书籍列表加载失败" detail={error} /> : <GenericBookGrid books={books} loading={loading} />}
      {!loading && books.length > 0 && (
        <section className="pt-8" aria-label="热门标签">
          <div className="mb-3 flex items-center gap-2"><span className="text-sm font-bold tracking-widest" style={{ color: v.text }}>热门标签</span></div>
          <TagCloud tags={siteKeywordList(site)} />
        </section>
      )}
    </div>
  )
}
