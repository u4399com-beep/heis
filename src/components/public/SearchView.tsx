// ============================================================
// 搜索视图 — 搜索框 + 主题化结果列表 + 相关词
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { fetchSearch } from './data'
import type { SearchData } from './types'
import { usePublic } from './ctx'
import { siteKeywordList, useSiteSEO, withAlpha } from './seo'
import { EmptyState, ErrorState, TagCloud } from './bits'
import { ThemeBookList } from './BookCard'

export function SearchView({ q }: { q?: string }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [input, setInput] = useState(q || '')
  const [data, setData] = useState<SearchData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // props变化时的状态调整 — 渲染期同步（React官方推荐模式）
  const [prevQ, setPrevQ] = useState(q)
  if (prevQ !== q) {
    setPrevQ(q)
    setInput(q || '')
    setData(null)
    setError('')
    setLoading(!!q)
  }

  useEffect(() => {
    if (!q) return
    let alive = true
    fetchSearch(q)
      .then((d) => {
        if (!alive) return
        setData(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        if (!alive) return
        setError(e.message)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [q])

  // 触发搜索时置为loading（事件回调内setState合法）
  const startSearch = (word: string) => {
    navigate({ view: 'search', q: word.trim() })
  }

  useSiteSEO({
    title: q ? `“${q}”的搜索结果 - ${site.name}` : `搜索 - ${site.name}`,
    description: q ? `${site.name}站内搜索“${q}”的结果页面` : `${site.name}站内搜索，支持书名/作者/关键词检索`,
    keywords: q ? `${q},${site.keywords}`.replace(/,+$/, '') : site.keywords,
    // 搜索结果页对搜索引擎无独立价值，统一 noindex 防止低质索引
    robots: 'noindex,follow',
    canonicalPath: q ? `/?view=search&q=${encodeURIComponent(q)}&site=${site.id}` : `/?view=search&site=${site.id}`,
    site,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'SearchResultsPage',
        name: q ? `搜索 ${q}` : '站内搜索',
        url: `${typeof window !== 'undefined' ? window.location.origin : ''}/?view=search&q=${encodeURIComponent(q || '')}&site=${site.id}`,
      },
    ],
  })


  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {/* 大搜索框 */}
      <form
        className="mx-auto flex max-w-xl items-center gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          startSearch(input)
        }}
      >
        <div
          className="flex w-full items-center gap-2 px-4 py-2.5"
          style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow }}
        >
          <Search className="h-4 w-4 shrink-0" style={{ color: v.primary }} aria-hidden />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入书名 / 作者 / 关键词"
            className="w-full bg-transparent text-sm outline-none placeholder:opacity-60"
            style={{ color: v.text }}
            aria-label="搜索关键词"
            autoFocus
          />
          {input && (
            <button type="button" onClick={() => setInput('')} aria-label="清空输入" style={{ color: v.textMuted }}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="shrink-0 px-5 py-2.5 text-sm font-bold transition-opacity hover:opacity-85"
          style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
        >
          搜索
        </button>
      </form>

      {/* 空态提示 + 热词 */}
      {!q && (
        <div className="pt-12">
          <p className="mb-4 text-center text-sm" style={{ color: v.textMuted }}>试试这些热门搜索词</p>
          <TagCloud tags={siteKeywordList(site)} align="center" />
          <EmptyState text="输入关键词开始搜索" hint="支持书名、作者、简介与关键词匹配" />
        </div>
      )}

      {/* 结果 */}
      {q && (
        <div className="pt-8">
          {error ? (
            <ErrorState message="搜索失败" detail={error} />
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-base font-bold" style={{ color: v.text, fontFamily: v.titleFont }}>
                  “{q}” 的搜索结果
                  {!loading && data && <span className="ml-2 text-xs font-normal" style={{ color: v.textMuted }}>共 {data.books.length} 本</span>}
                </h1>
              </div>
              <ThemeBookList books={data?.books || []} loading={loading} />

              {/* 相关搜索词 */}
              {!loading && data && data.relatedTags.length > 0 && (
                <section className="pt-10" aria-label="相关搜索词">
                  <h2 className="mb-3 text-sm font-bold tracking-widest" style={{ color: v.text }}>相关搜索词</h2>
                  <div className="flex flex-wrap gap-2">
                    {data.relatedTags.map((t) => (
                      <button
                        key={`${t.tag}-${t.bookId}`}
                        type="button"
                        onClick={() => navigate({ view: 'keyword', tag: t.tag })}
                        className="rounded-full px-3 py-1.5 text-xs transition-opacity hover:opacity-80"
                        style={{ background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08), color: v.primary, border: `1px solid ${withAlpha(v.primary, 0.35)}` }}
                        aria-label={`查看关键词 ${t.tag}`}
                      >
                        {t.tag}
                        <span className="ml-1 opacity-60">{t.bookName}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {!loading && data && !data.books.length && (
                <EmptyState text={`没有找到与“${q}”相关的书籍`} hint="试试相关搜索词，或更换关键词" />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
