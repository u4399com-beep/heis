// ============================================================
// 搜索视图 — 搜索框 + 主题化结果列表 + 相关词 + 热搜词 + 搜索历史
// ============================================================
'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, Flame, History, Search, Trash2, X } from 'lucide-react'
import { fetchSearch } from './data'
import type { SearchData } from './types'
import { usePublic } from './ctx'
import { siteKeywordList, useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { EmptyState, ErrorState, TagCloud } from './bits'
import { ThemeBookList } from './BookCard'
import { addSearchHistory, clearSearchHistory, getSearchHistory } from './search-history'

export function SearchView({ q }: { q?: string }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [input, setInput] = useState(q || '')
  const [data, setData] = useState<SearchData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hotTags, setHotTags] = useState<string[] | null>(null)
  const [historyTick, setHistoryTick] = useState(0) // 移除/清空后强制重读 history

  // props变化时的状态调整 — 渲染期同步（React官方推荐模式）
  const [prevQ, setPrevQ] = useState(q)
  if (prevQ !== q) {
    setPrevQ(q)
    setInput(q || '')
    setData(null)
    setError('')
    setLoading(!!q)
  }

  // 提交搜索: 走 navigate 触发 effect, 同时记录历史
  useEffect(() => {
    if (!q) return
    addSearchHistory(q)
  }, [q])

  // 仅在 q 为空(初始态)时拉一次热搜词池
  useEffect(() => {
    if (q) return
    let alive = true
    fetch('/api/public/tags?n=20', { cache: 'no-store' })
      .then((r) => r.json().catch(() => null))
      .then((j: { ok?: boolean; data?: { tags?: unknown } } | null) => {
        if (!alive) return
        if (!j?.ok || !j.data) {
          setHotTags([])
          return
        }
        const tags = Array.isArray(j.data.tags)
          ? (j.data.tags as unknown[]).filter((t): t is string => typeof t === 'string' && !!t.trim())
          : []
        setHotTags(tags)
      })
      .catch(() => {
        if (alive) setHotTags([])
      })
    return () => {
      alive = false
    }
  }, [q])

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

  // historyTick 变化时重读 localStorage 拿最新历史 (historyTick 仅作重渲染触发器)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const historyList = useMemo(() => getSearchHistory(), [historyTick])

  useSiteSEO({
    title: q ? generateTitle({ bookName: `"${q}"搜索结果`, siteName: site.name }) : generateTitle({ siteName: site.name, category: '搜索' }),
    description: q ? generateMetaDescription({ siteName: site.name, chapterTitle: `"${q}"搜索结果`, intro: `站内搜索${q}的小说` }) : generateMetaDescription({ siteName: site.name, category: '搜索', intro: '站内搜索，支持书名/作者/关键词检索' }),
    keywords: q ? generateKeywords({ existingKeywords: q, siteName: site.name }) : generateKeywords({ siteName: site.name, category: '搜索' }),
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

  // 清空搜索历史 (本地)
  const onClearHistory = () => {
    clearSearchHistory()
    setHistoryTick((t) => t + 1)
  }

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

      {/* 空态: 热搜词 + 搜索历史 */}
      {!q && (
        <div className="mx-auto max-w-2xl space-y-6 pt-10">
          {/* 搜索历史 */}
          {historyList.length > 0 && (
            <section aria-label="搜索历史">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-wide" style={{ color: v.text }}>
                  <History className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
                  搜索历史
                </h2>
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="inline-flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
                  style={{ color: v.textMuted }}
                  aria-label="清空搜索历史"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  清空历史
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {historyList.map((term) => (
                  <button
                    key={`hist-${term}`}
                    type="button"
                    onClick={() => startSearch(term)}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-colors hover:opacity-85"
                    style={{
                      background: v.surface,
                      color: v.text,
                      border: `1px solid ${withAlpha(v.border, 0.9)}`,
                      borderRadius: v.radius,
                    }}
                    aria-label={`搜索 ${term}`}
                  >
                    <Clock className="h-3 w-3" style={{ color: v.textMuted }} aria-hidden />
                    {term}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 热搜词 */}
          <section aria-label="热门搜索">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-wide" style={{ color: v.text }}>
                <Flame className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
                热门搜索
              </h2>
            </div>
            {hotTags === null ? (
              <div className="flex flex-wrap gap-2" aria-hidden>
                {Array.from({ length: 8 }).map((_, i) => (
                  <span
                    key={i}
                    className="h-7 w-16 animate-pulse rounded-full"
                    style={{ background: withAlpha(v.border, 0.4) }}
                  />
                ))}
              </div>
            ) : hotTags.length === 0 ? (
              <p className="text-xs" style={{ color: v.textMuted }}>暂无热门搜索词</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {hotTags.map((t, i) => (
                  <button
                    key={`hot-${t}`}
                    type="button"
                    onClick={() => startSearch(t)}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-opacity hover:opacity-85"
                    style={{
                      background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08),
                      color: v.primary,
                      border: `1px solid ${withAlpha(v.primary, 0.35)}`,
                      borderRadius: v.radius,
                    }}
                    aria-label={`搜索 ${t}`}
                  >
                    {i < 3 && <Flame className="h-3 w-3" aria-hidden />}
                    {t}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 兜底: 站点关键词词云 */}
          {siteKeywordList(site).length > 0 && (
            <section aria-label="站点关键词">
              <div className="mb-3">
                <h2 className="text-sm font-bold tracking-wide" style={{ color: v.text }}>站点关键词</h2>
              </div>
              <TagCloud tags={siteKeywordList(site)} align="left" />
            </section>
          )}

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
