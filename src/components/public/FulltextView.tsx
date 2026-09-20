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

// R35-1A: clone-themes 按需 dynamic import — 只为当前请求的 layout 创建 dynamic 组件 wrapper
// 之前: 模块顶层 10 个 dynamic() 立刻求值 → 每次 FulltextView 模块加载都创建 10 个 wrapper (内存浪费)
// 现在: cloneFulltextLoaders 只是个函数引用表 (零开销), getCloneFulltext(layout) 首次调用才 dynamic() 并缓存
// SSR 行为不变 (ssr=true 让 SSR 渲染 clone DOM, 防 ssr=false 客户端 JS OOM 空白);
// webpack 仍会为 10 个 import() 各建一个 async chunk (源码静态分析必要), 但模块
// 顶层求值从 10 次 dynamic() 调用降到 0, 渲染时也只创建 1 个 wrapper (per layout 缓存)
type CloneFulltextModule = { FulltextView: React.ComponentType<any> }
const cloneFulltextLoaders: Record<string, () => Promise<CloneFulltextModule>> = {
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
const cloneFulltextCache = new Map<string, React.ComponentType<any>>()
function getCloneFulltext(layout: string): React.ComponentType<any> | undefined {
  const loader = cloneFulltextLoaders[layout]
  if (!loader) return undefined
  let cached = cloneFulltextCache.get(layout)
  if (!cached) {
    cached = dynamic(() => loader().then(m => m.FulltextView), {
      ssr: true,
      loading: () => <BookGridSkeleton count={12} />,
    })
    cloneFulltextCache.set(layout, cached)
  }
  return cached
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
  // R35-1A: FulltextViewLookup 已重命名为 getCloneFulltext, per-layout cache (module 级 Map)
  const Clone = getCloneFulltext(theme.layout)
  if (Clone) {
    return (
      // eslint-disable-next-line react-hooks/static-components -- Clone 来自 module 级缓存, 同 layout 跨渲染稳定
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
