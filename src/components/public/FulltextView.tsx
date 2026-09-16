// ============================================================
// R17: 全本完本视图壳 — 按主题分发到 clone-themes/<site>/FulltextView
// 重建窗口期: 通用网格兜底
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

// R17: clone-themes 全本组件懒加载
const CloneFulltextViews: Record<string, React.ComponentType<any>> = {}

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

  const CloneFulltext = CloneFulltextViews[theme.layout]
  if (CloneFulltext && !loading && data) {
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
