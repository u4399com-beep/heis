// ============================================================
// R17: 全本完本视图壳 — 按主题分发到 clone-themes/<site>/FulltextView
// R19-1B 接线: clone-themes 由 R19-1A 重建, 此处填充 CloneFulltextViews lookup table (10 套)
// 未知 layout 走通用网格兜底 (与 R15-1B 同口径)
// ============================================================
'use client'

import { useEffect, useState } from 'react'
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
import { FulltextView as CloneFulltextViewAijjxs } from './clone-themes/aijjxs'
import { FulltextView as CloneFulltextViewDdyueshu } from './clone-themes/ddyueshu'
import { FulltextView as CloneFulltextViewPilishuwu } from './clone-themes/pilishuwu'
import { FulltextView as CloneFulltextView23qb } from './clone-themes/23qb'
import { FulltextView as CloneFulltextView101kks } from './clone-themes/101kks'
import { FulltextView as CloneFulltextViewHuangjinwu } from './clone-themes/huangjinwu'
import { FulltextView as CloneFulltextViewGgd66 } from './clone-themes/ggd66'
import { FulltextView as CloneFulltextViewShipsay } from './clone-themes/shipsay'
import { FulltextView as CloneFulltextViewX2552 } from './clone-themes/x2552'
import { FulltextView as CloneFulltextViewTrxsw } from './clone-themes/trxsw'
import type { FulltextViewProps } from './clone-themes/aijjxs/shared'

// R19-1B: clone-themes 全本组件 lookup table (按 theme.layout 选择对应组件, fallback aijjxs)
// lookup table 必须定义在 render 函数外部 (eslint-react/no-render-defined-component)
const CloneFulltextViews: Record<string, React.ComponentType<FulltextViewProps>> = {
  'clone-aijjxs': CloneFulltextViewAijjxs,
  'clone-ddyueshu': CloneFulltextViewDdyueshu,
  'clone-pilishuwu': CloneFulltextViewPilishuwu,
  'clone-23qb': CloneFulltextView23qb,
  'clone-101kks': CloneFulltextView101kks,
  'clone-huangjinwu': CloneFulltextViewHuangjinwu,
  'clone-ggd66': CloneFulltextViewGgd66,
  'clone-shipsay': CloneFulltextViewShipsay,
  'clone-x2552': CloneFulltextViewX2552,
  'clone-trxsw': CloneFulltextViewTrxsw,
}

export function FulltextView({ page }: { page: number }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [state, setState] = useState<{ data?: BooksData; error?: string } | null>(null)
  const key = `${site.id}|fulltext|${page}`

  useEffect(() => {
    let alive = true
    fetchBooks({ site: site.id, sort: 'fulltext' as any, page, size: 24 })
      .then((d) => { if (alive) setState({ data: d }) })
      .catch((e: Error) => { if (alive) setState({ error: e.message }) })
    return () => { alive = false }
  }, [key, site.id, page])

  const loading = !state || !state.data
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''

  useSiteSEO({
    title: generateTitle({ category: '全本小说', siteName: site.name }),
    description: generateMetaDescription({ category: '全本小说', siteName: site.name, intro: '全本完结小说在线阅读,完结小说TXT下载' }),
    keywords: generateKeywords({ category: '全本小说', siteName: site.name }),
    canonicalPath: `/?view=fulltext&page=${page}&site=${site.id}`,
    site,
  })

  // R19-1B: 按 theme.layout 选 CloneFulltextViews lookup table 中的对应组件 (fallback aijjxs)
  const CloneFulltext = CloneFulltextViews[theme.layout] || CloneFulltextViewAijjxs
  if (!loading && data) {
    return <CloneFulltext books={data.books} loading={loading} page={page} total={data.total} size={data.size} onPage={(p: number) => navigate({ view: 'fulltext', page: p })} />
  }

  // 通用兜底
  const books: BookItem[] = data?.books || []
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
