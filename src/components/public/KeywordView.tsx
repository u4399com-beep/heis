// ============================================================
// 关键词落地页视图 — 主书籍 + 其他相关书籍 + 相关关键词
// R25: clone-* 主题走 KeywordViewLookup → clone-themes/<site>/KeywordView
//      SSR: page.tsx server fetch keyword data, 传 initialKeyword 让 SSR 渲染关键词落地页
// ============================================================
'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Tag } from 'lucide-react'
import { fetchKeyword } from './data'
import type { KeywordData } from './types'
import { usePublic } from './ctx'
import { useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { ErrorState, Sk, TagCloud, BookGridSkeleton } from './bits'
import { BookCover } from './BookCover'
import { formatWords } from './seo'

// R25: KeywordView lookup table — clone-* 主题动态加载对应 KeywordView 组件, ssr=true 让 SSR 直接渲染源站 DOM
const KeywordViewLookup: Record<string, React.ComponentType<any>> = {
  'clone-aijjxs': dynamic(() => import('./clone-themes/aijjxs').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
  'clone-ddyueshu': dynamic(() => import('./clone-themes/ddyueshu').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
  'clone-pilishuwu': dynamic(() => import('./clone-themes/pilishuwu').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
  'clone-23qb': dynamic(() => import('./clone-themes/23qb').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
  'clone-101kks': dynamic(() => import('./clone-themes/101kks').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
  'clone-huangjinwu': dynamic(() => import('./clone-themes/huangjinwu').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
  'clone-ggd66': dynamic(() => import('./clone-themes/ggd66').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
  'clone-shipsay': dynamic(() => import('./clone-themes/shipsay').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
  'clone-x2552': dynamic(() => import('./clone-themes/x2552').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
  'clone-trxsw': dynamic(() => import('./clone-themes/trxsw').then(m => m.KeywordView), { ssr: true, loading: () => <BookGridSkeleton count={6} /> }),
}

export function KeywordView({ tag, initialKeyword, initialCategories }: { tag?: string; initialKeyword?: KeywordData | null; initialCategories?: any[] }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  // R25: SSR 首载用 page.tsx server fetch 的 initialKeyword 初始化, 让 SSR 时 loading=false → clone KeywordView 组件渲染关键词落地页
  const [data, setData] = useState<KeywordData | null>(initialKeyword && initialKeyword.tag === tag ? initialKeyword : null)
  const [loading, setLoading] = useState(!(initialKeyword && initialKeyword.tag === tag))
  const [error, setError] = useState('')
  // R25: firstRender ref — SSR 首载已有 initialKeyword 时跳过首次 effect 避免 client fetch 覆盖
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current && data && data.tag === tag) {
      firstRender.current = false
      return
    }
    if (!tag) return
    let alive = true
    fetchKeyword(tag)
      .then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch((e: Error) => { if (alive) { setError(e.message); setLoading(false) } })
    return () => { alive = false }
  }, [tag, site.id, data, firstRender])
  useSiteSEO({
    title: generateTitle({ category: tag, siteName: site.name }),
    description: generateMetaDescription({ category: tag, siteName: site.name, intro: `${tag}相关小说推荐` }),
    keywords: generateKeywords({ category: tag, siteName: site.name }),
    canonicalPath: `/?view=keyword&tag=${encodeURIComponent(tag || '')}&site=${site.id}`, site,
  })

  // R25: clone-* 主题走 KeywordViewLookup
  const Clone = KeywordViewLookup[theme.layout]
  if (Clone) {
    // 把 KeywordData 转成 books[] 数组传给 clone 组件
    const books = data?.book ? [data.book, ...data.otherBooks.map((b) => ({ ...b, cover: '', status: 'unknown', wordCount: 0, category: '', intro: '' }))] : []
    return (
      <Clone
        tag={tag || ''}
        books={books}
        loading={loading}
        initialCategories={initialCategories}
      />
    )
  }

  if (loading) return <div className="mx-auto max-w-5xl px-4 py-8"><Sk className="h-96 w-full" /></div>
  if (error) return <div className="mx-auto max-w-5xl px-4 py-8"><ErrorState message="加载失败" detail={error} /></div>
  if (!data || !data.book) return <div className="mx-auto max-w-5xl px-4 py-8 text-center" style={{ color: v.textMuted }}>暂无相关书籍</div>
  const main = data.book
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium" style={{ background: withAlpha(v.primary, 0.1), color: v.primary }}>
          <Tag className="h-3.5 w-3.5" aria-hidden /> 关键词
        </span>
        <h1 className="mt-3 text-3xl font-black" style={{ color: v.text }}>「{tag}」相关小说</h1>
      </header>
      <section className="mb-8 flex gap-5 p-5" style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }}>
        <div className="w-28 shrink-0 sm:w-36">
          <BookCover name={main.name} cover={main.cover} className="aspect-[3/4] w-full" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-xl font-black" style={{ color: v.text }}>
            <button onClick={() => navigate({ view: 'book', bookId: main.id })} style={{ color: 'inherit' }}>{main.name}</button>
          </h2>
          <p className="text-sm" style={{ color: v.textMuted }}>{main.author} · {main.category} · {formatWords(main.wordCount)}</p>
          <p className="text-sm line-clamp-3" style={{ color: v.textMuted }}>{main.intro}</p>
        </div>
      </section>
      {data.otherBooks.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold" style={{ color: v.text }}>其他相关书籍</h2>
          <ul className="space-y-1">
            {data.otherBooks.map((b, i) => (
              <li key={b.id}>
                <button onClick={() => navigate({ view: 'book', bookId: b.id })} className="flex w-full items-center gap-3 py-2 text-left text-sm" style={{ borderBottom: `1px solid ${withAlpha(v.border, 0.5)}` }}>
                  <span className="w-6 text-xs tabular-nums" style={{ color: v.textMuted }}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 truncate font-medium">{b.name}</span>
                  <span className="text-xs" style={{ color: v.textMuted }}>{b.author}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.related.length > 0 && (
        <section className="pt-4">
          <h2 className="mb-3 text-sm font-bold" style={{ color: v.text }}>相关关键词</h2>
          <TagCloud tags={data.related} />
        </section>
      )}
    </div>
  )
}
