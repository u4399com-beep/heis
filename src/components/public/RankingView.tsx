// ============================================================
// R17: 排行榜视图壳 — 按主题分发到 clone-themes/<site>/RankingView
// R19-1B 接线: clone-themes 由 R19-1A 重建, 此处填充 CloneRankingViews lookup table (10 套)
// 未知 layout 走通用网格兜底 (与 R15-1B 同口径)
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import { Trophy, ChevronRight } from 'lucide-react'
import { fetchBooks, type BooksData } from './data'
import { usePublic } from './ctx'
import { useSiteSEO } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { EmptyState, ErrorState, BookGridSkeleton } from './bits'
import { BookCover } from './BookCover'
import { bookNavProps, StatusBadge } from './bits'
import { formatWords, } from './seo'
import { Pagination } from './Pagination'
import type { BookItem } from './types'
import { RankingView as CloneRankingViewAijjxs } from './clone-themes/aijjxs'
import { RankingView as CloneRankingViewDdyueshu } from './clone-themes/ddyueshu'
import { RankingView as CloneRankingViewPilishuwu } from './clone-themes/pilishuwu'
import { RankingView as CloneRankingView23qb } from './clone-themes/23qb'
import { RankingView as CloneRankingView101kks } from './clone-themes/101kks'
import { RankingView as CloneRankingViewHuangjinwu } from './clone-themes/huangjinwu'
import { RankingView as CloneRankingViewGgd66 } from './clone-themes/ggd66'
import { RankingView as CloneRankingViewShipsay } from './clone-themes/shipsay'
import { RankingView as CloneRankingViewX2552 } from './clone-themes/x2552'
import { RankingView as CloneRankingViewTrxsw } from './clone-themes/trxsw'
import type { RankingViewProps } from './clone-themes/aijjxs/shared'

// R19-1B: clone-themes 排行榜组件 lookup table (按 theme.layout 选择对应组件, fallback aijjxs)
// lookup table 必须定义在 render 函数外部 (eslint-react/no-render-defined-component)
const CloneRankingViews: Record<string, React.ComponentType<RankingViewProps>> = {
  'clone-aijjxs': CloneRankingViewAijjxs,
  'clone-ddyueshu': CloneRankingViewDdyueshu,
  'clone-pilishuwu': CloneRankingViewPilishuwu,
  'clone-23qb': CloneRankingView23qb,
  'clone-101kks': CloneRankingView101kks,
  'clone-huangjinwu': CloneRankingViewHuangjinwu,
  'clone-ggd66': CloneRankingViewGgd66,
  'clone-shipsay': CloneRankingViewShipsay,
  'clone-x2552': CloneRankingViewX2552,
  'clone-trxsw': CloneRankingViewTrxsw,
}

const RANKING_TABS = [
  { id: 'allvisit', name: '总点击' },
  { id: 'allvote', name: '总推荐' },
  { id: 'goodnum', name: '总收藏' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
  { id: 'postdate', name: '最新入库' },
] as const

export function RankingView({ page }: { page: number }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [tab, setTab] = useState<string>('allvisit')
  const [state, setState] = useState<{ data?: BooksData; error?: string } | null>(null)
  const key = `${site.id}|ranking|${tab}|${page}`

  useEffect(() => {
    let alive = true
    fetchBooks({ site: site.id, sort: tab as any, page, size: 30 })
      .then((d) => { if (alive) setState({ data: d }) })
      .catch((e: Error) => { if (alive) setState({ error: e.message }) })
    return () => { alive = false }
  }, [key, site.id, tab, page])

  const loading = !state || !state.data
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''

  useSiteSEO({
    title: generateTitle({ category: '排行榜', siteName: site.name }),
    description: generateMetaDescription({ category: '排行榜', siteName: site.name, intro: '小说排行榜,总点击榜,总推荐榜,总收藏榜,字数排行' }),
    keywords: generateKeywords({ category: '排行榜', siteName: site.name }),
    canonicalPath: `/?view=ranking&page=${page}&site=${site.id}`,
    site,
  })

  // R19-1B: 按 theme.layout 选 CloneRankingViews lookup table 中的对应组件 (fallback aijjxs)
  const CloneRankingView = CloneRankingViews[theme.layout] || CloneRankingViewAijjxs
  if (!loading && data) {
    return <CloneRankingView books={data.books} loading={loading} tab={tab} onTabChange={setTab} page={page} total={data.total} size={data.size} onPage={(p: number) => navigate({ view: 'ranking', page: p })} />
  }

  // 通用兜底
  const books: BookItem[] = data?.books || []
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
            <li key={b.id} className="flex items-center gap-3 p-3 transition-colors hover:bg-black/5" style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }} {...bookNavProps(navigate, b.id)} role="button" tabIndex={0}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: i < 3 ? v.accent : v.surfaceAlt, color: i < 3 ? '#fff' : v.textMuted }}>{i + 1}</span>
              <div className="w-10 shrink-0 overflow-hidden rounded" style={{ border: `1px solid ${v.border}` }}><BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" /></div>
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
