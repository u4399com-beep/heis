// ============================================================
// 排行榜视图 — 7 tab 切换(总/月/周/日点击榜 + 总推荐 + 字数 + 最近更新)
// R25: clone-* 主题走 RankingViewLookup → clone-themes/<site>/RankingView
//      SSR: page.tsx server fetch books by sort, 传 initialBooks 让 SSR 渲染排行榜
// ============================================================
'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Trophy, ChevronRight } from 'lucide-react'
import { fetchBooks, type BooksData } from './data'
import { usePublic } from './ctx'
import { useSiteSEO } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { EmptyState, ErrorState, BookGridSkeleton, bookNavProps, StatusBadge } from './bits'
import { BookCover } from './BookCover'
import { formatWords } from './seo'
import { Pagination } from './Pagination'
import type { BookItem } from './types'

const RANKING_TABS = [
  { id: 'allvisit', name: '总点击' },
  { id: 'allvote', name: '总推荐' },
  { id: 'goodnum', name: '总收藏' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
] as const

// R35-1A: clone-themes 按需 dynamic import — 只为当前请求的 layout 创建 dynamic 组件 wrapper
// 之前: 模块顶层 10 个 dynamic() 立刻求值 → 每次 RankingView 模块加载都创建 10 个 wrapper (内存浪费)
// 现在: cloneRankLoaders 只是个函数引用表 (零开销), getCloneRank(layout) 首次调用才 dynamic() 并缓存
// SSR 行为不变 (ssr=true 让 SSR 渲染 clone DOM, 防 ssr=false 客户端 JS OOM 空白);
// webpack 仍会为 10 个 import() 各建一个 async chunk (源码静态分析必要), 但模块
// 顶层求值从 10 次 dynamic() 调用降到 0, 渲染时也只创建 1 个 wrapper (per layout 缓存)
type CloneRankModule = { RankingView: React.ComponentType<any> }
const cloneRankLoaders: Record<string, () => Promise<CloneRankModule>> = {
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
const cloneRankCache = new Map<string, React.ComponentType<any>>()
function getCloneRank(layout: string): React.ComponentType<any> | undefined {
  const loader = cloneRankLoaders[layout]
  if (!loader) return undefined
  let cached = cloneRankCache.get(layout)
  if (!cached) {
    cached = dynamic(() => loader().then(m => m.RankingView), {
      ssr: true,
      loading: () => <BookGridSkeleton count={12} />,
    })
    cloneRankCache.set(layout, cached)
  }
  return cached
}

interface FetchState { key: string; data?: BooksData; error?: string }

export function RankingView({ page, initialBooks, initialCategories }: { page: number; initialBooks?: any; initialCategories?: any[] }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [tab, setTab] = useState<string>('allvisit')
  // R25: SSR 首载用 page.tsx server fetch 的 initialBooks 初始化 state, 让 SSR 时 loading=false → clone RankingView 组件渲染排行列表
  const key = `${site.id}|ranking|${tab}|${page}`
  const [state, setState] = useState<FetchState | null>(initialBooks && initialBooks.books ? { key: `${site.id}|ranking|allvisit|${page}`, data: initialBooks as BooksData } : null)
  // R25: firstRender ref — SSR 首载已有 initialBooks 时跳过首次 effect 避免 client fetch 覆盖
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current && state && state.data) {
      firstRender.current = false
      return
    }
    let alive = true
    fetchBooks({ site: site.id, sort: tab as any, page, size: 30 })
      .then(d => { if (alive) setState({ key, data: d }) })
      .catch((e: Error) => { if (alive) setState({ key, error: e.message }) })
    return () => { alive = false }
  }, [key, site.id, tab, page, state])
  const loading = !state || state.key !== key
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''
  useSiteSEO({
    title: generateTitle({ category: '排行榜', siteName: site.name }),
    description: generateMetaDescription({ category: '排行榜', siteName: site.name, intro: '小说排行榜,总点击榜,总推荐榜' }),
    keywords: generateKeywords({ category: '排行榜', siteName: site.name }),
    canonicalPath: `/?view=ranking&page=${page}&site=${site.id}`, site,
  })
  const books: BookItem[] = data?.books || []
  // R25: clone-* 主题走 RankingViewLookup, 否则走通用布局
  // R35-1A: RankingViewLookup 已重命名为 getCloneRank, per-layout cache (module 级 Map)
  const Clone = getCloneRank(theme.layout)
  if (Clone) {
    return (
      // eslint-disable-next-line react-hooks/static-components -- Clone 来自 module 级缓存, 同 layout 跨渲染稳定
      <Clone
        books={books}
        loading={loading}
        tab={tab}
        onTabChange={(t: string) => { setTab(t); navigate({ view: 'ranking', page: 1 }) }}
        page={data?.page || page}
        total={data?.total || 0}
        size={data?.size || 30}
        onPage={(p: number) => navigate({ view: 'ranking', page: p })}
        initialCategories={initialCategories}
      />
    )
  }
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <Trophy className="h-6 w-6" style={{ color: v.primary }} aria-hidden />
        <h1 className="text-xl font-black" style={{ color: v.text }}>排行榜</h1>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {RANKING_TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => { setTab(t.id); navigate({ view: 'ranking', page: 1 }) }}
            className="px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ background: tab === t.id ? v.primary : v.surface, color: tab === t.id ? v.primaryText : v.text, border: `1px solid ${tab === t.id ? v.primary : v.border}`, borderRadius: v.radius }}
            aria-pressed={tab === t.id}>{t.name}</button>
        ))}
      </div>
      {error ? <ErrorState message="排行榜加载失败" detail={error} /> : loading ? <BookGridSkeleton count={12} /> : !books.length ? <EmptyState text="暂无排行数据" /> : (
        <ol className="space-y-2">
          {books.map((b, i) => (
            <li key={b.id} className="flex items-center gap-3 p-3 transition-colors hover:bg-black/5"
              style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }}
              {...bookNavProps(navigate, b.id)} role="button" tabIndex={0}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                style={{ background: i < 3 ? v.accent : v.surfaceAlt, color: i < 3 ? '#fff' : v.textMuted }}>{i + 1}</span>
              <div className="w-10 shrink-0 overflow-hidden rounded" style={{ border: `1px solid ${v.border}` }}>
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-bold" style={{ color: v.text }}>{b.name}</h3>
                <p className="truncate text-xs" style={{ color: v.textMuted }}>{b.author} · {b.category} · {formatWords(b.wordCount)}</p>
              </div>
              <StatusBadge status={b.status} small />
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: v.textMuted }} aria-hidden />
            </li>
          ))}
        </ol>
      )}
      {data && data.total > data.size && (
        <Pagination page={data.page} total={data.total} size={data.size} onPage={(p) => navigate({ view: 'ranking', page: p })} center />
      )}
    </div>
  )
}
