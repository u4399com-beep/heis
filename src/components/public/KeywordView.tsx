// ============================================================
// 关键词落地页 — 大标题=tag + 主书籍卡片 + 次要书单 + 相关词云
// R13-1A: 当 source='suggest'|'pseo' 时切到 PSEO 落地页模式
//   - H1 改为 "{关键词}" - 相关小说推荐
//   - meta description 改为 "{关键词}" 相关小说在线阅读, ...
//   - 顶部加 "搜索其他关键词" 搜索框
//   - 底部加 "相关搜索" 区块(同引擎聚合的相关词, 再链到其他 keyword 落地页)
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import { BookOpen, ListTree, Network, Search, Tag, User } from 'lucide-react'
import { fetchKeyword, fetchRelatedKeywords } from './data'
import type { KeywordData } from './types'
import { usePublic } from './ctx'
import { formatWords, useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { BookCover } from './BookCover'
import { EmptyState, ErrorState, Sk, StatusBadge, TagCloud } from './bits'

export function KeywordView({ tag }: { tag?: string }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [data, setData] = useState<KeywordData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [prevTag, setPrevTag] = useState(tag)
  // R13-1A: 底部"相关搜索"区块 — 同引擎聚合的相关词
  const [relatedSearch, setRelatedSearch] = useState<string[]>([])
  // R13-1A: 顶部"搜索其他关键词"输入框
  const [searchInput, setSearchInput] = useState('')
  if (prevTag !== tag) {
    setPrevTag(tag)
    setData(null)
    setError('')
    setRelatedSearch([])
    setLoading(!!tag)
  }
  const effectiveLoading = tag ? loading : false

  useEffect(() => {
    if (!tag) return
    let alive = true
    fetchKeyword(tag)
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
  }, [tag])

  // R13-1A: 拉取底部"相关搜索"区块(同引擎聚合的相关词)
  // P2 fix (R13-1C): 加 .catch 防御 unhandled rejection —— fetchRelatedKeywords 内部
  // 已 try/catch 返回 [], 理论上永不 reject; 但网络栈异常(连接重置/超时在 try 外的 await)
  // 极端路径下仍可能 reject, 加 .catch 兜底返回空数组, 防 console 噪音与潜在告警
  useEffect(() => {
    if (!tag) return
    let alive = true
    fetchRelatedKeywords(tag)
      .then((words) => {
        if (!alive) return
        setRelatedSearch(words)
      })
      .catch(() => {
        if (!alive) return
        setRelatedSearch([])
      })
    return () => {
      alive = false
    }
  }, [tag])

  // R13-1A: PSEO 落地页模式 — source='suggest'|'pseo'(无主书籍时也走 PSEO 模式)
  const isPSEO = !data?.source || data.source === 'suggest' || data.source === 'pseo'

  useSiteSEO({
    title: tag
      ? (isPSEO
          ? `"${tag}" 相关小说推荐 - ${site.name}`
          : generateTitle({ bookName: tag, siteName: site.name }))
      : generateTitle({ siteName: site.name, category: '关键词' }),
    description: tag
      ? (isPSEO
          ? `"${tag}" 相关小说在线阅读, "${tag}" 全文免费阅读, "${tag}" TXT 下载 - ${site.name}`
          : data?.book
            ? generateMetaDescription({ bookName: data.book.name, author: data.book.author, category: tag, intro: data.book.intro, wordCount: data.book.wordCount, siteName: site.name })
            : generateMetaDescription({ siteName: site.name, category: tag, intro: `"${tag}"相关小说专题` }))
      : generateMetaDescription({ siteName: site.name, category: '关键词' }),
    keywords: tag ? generateKeywords({ existingKeywords: tag, bookName: data?.book?.name, siteName: site.name }) : generateKeywords({ siteName: site.name, category: '关键词' }),
    // 关键词落地页为聚合过渡页，统一 noindex 防止低质索引
    robots: 'noindex,follow',
    canonicalPath: tag ? `/?view=keyword&tag=${encodeURIComponent(tag)}&site=${site.id}` : undefined,
    site,
    jsonLd: tag
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: `"${tag}" 相关小说推荐`,
            description: isPSEO
              ? `"${tag}" 相关小说在线阅读, "${tag}" 全文免费阅读, "${tag}" TXT 下载 - ${site.name}`
              : `${tag}相关小说专题页`,
            url: `${typeof window !== 'undefined' ? window.location.origin : ''}/?view=keyword&tag=${encodeURIComponent(tag)}&site=${site.id}`,
            isPartOf: { '@type': 'WebSite', name: site.name },
          },
        ]
      : [],
  })

  if (!tag) return <ErrorState message="缺少关键词参数" />
  if (error) return <ErrorState message="关键词页面加载失败" detail={error} />

  const main = data?.book

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      {/* 大标题 = tag (R13-1A: PSEO 模式改为 "{关键词}" - 相关小说推荐) */}
      <header className="mb-8 text-center">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
          style={{ background: withAlpha(v.primary, theme.dark ? 0.2 : 0.1), color: v.primary }}
        >
          <Tag className="h-3.5 w-3.5" aria-hidden />
          {isPSEO ? '相关小说推荐' : '关键词专题'}
        </span>
        <h1
          className="mt-4 text-3xl font-black tracking-wide sm:text-4xl"
          style={{
            color: v.text,
            fontFamily: v.titleFont,
          }}
        >
          {isPSEO ? `"${tag}" 相关小说推荐` : tag}
        </h1>
        <p className="mt-2 text-xs" style={{ color: v.textMuted }}>
          {isPSEO
            ? `${site.name} · 精选"${tag}"相关小说, 在线阅读 + 全文免费阅读 + TXT 下载`
            : `${site.name} · 围绕"${tag}"精选的小说合集`}
        </p>
      </header>

      {/* R13-1A: 顶部 "搜索其他关键词" 搜索框 */}
      <section className="mb-8" aria-label="搜索其他关键词">
        <form
          className="mx-auto flex max-w-md items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const q = searchInput.trim()
            if (!q) return
            // 跳到 keyword 落地页(走 PSEO 模式), 让用户继续浏览相关小说
            navigate({ view: 'keyword', tag: q, site: site.id })
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: v.textMuted }} aria-hidden />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索其他关键词(如: 凡人修仙传)"
              className="w-full rounded-full py-2 pl-9 pr-4 text-sm outline-none transition-shadow focus:ring-2"
              style={{
                background: v.surface,
                border: `1px solid ${v.border}`,
                color: v.text,
                borderRadius: v.radius,
              }}
              aria-label="搜索其他关键词"
            />
          </div>
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition-opacity hover:opacity-85"
            style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
            aria-label="搜索"
          >
            <Search className="h-4 w-4" aria-hidden />
            搜索
          </button>
        </form>
      </section>

      {effectiveLoading ? (
        <div className="space-y-6">
          <div className="flex gap-5 p-5" style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }}>
            <Sk className="aspect-[3/4] w-32 shrink-0" />
            <div className="flex-1 space-y-3 py-1">
              <Sk className="h-6 w-1/2" />
              <Sk className="h-4 w-1/4" />
              <Sk className="h-4 w-full" />
              <Sk className="h-4 w-4/5" />
            </div>
          </div>
        </div>
      ) : !data ? (
        <EmptyState text="未找到该关键词的内容" />
      ) : !main ? (
        <div className="space-y-8">
          <EmptyState text={`暂无与"${tag}"直接匹配的主打书籍`} hint="看看下面的相关词，或许有惊喜" />
          {data.otherBooks.length > 0 && (
            <section aria-label="相关书籍">
              <h2 className="mb-3 text-sm font-bold tracking-widest" style={{ color: v.text }}>相关书籍</h2>
              <ul className="space-y-1">
                {data.otherBooks.map((b, i) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => navigate({ view: 'book', bookId: b.id })}
                      className="flex w-full items-center gap-3 border-b py-2.5 text-left text-sm transition-colors hover:opacity-70"
                      style={{ borderColor: withAlpha(v.border, 0.7), color: v.text }}
                    >
                      <span className="w-6 text-xs tabular-nums" style={{ color: v.textMuted }}>{String(i + 1).padStart(2, '0')}</span>
                      {b.name}
                      <span className="ml-auto text-xs" style={{ color: v.textMuted }}>{b.author}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-10">
          {/* 主书籍卡片 */}
          <section
            className="p-5 sm:p-7"
            style={{
              background: v.surface,
              border: `1px solid ${v.border}`,
              borderRadius: v.radius,
              boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
            }}
            aria-label="主关键词书籍"
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:gap-7">
              <div className="mx-auto w-36 shrink-0 sm:mx-0">
                <BookCover name={main.name} cover={main.cover} showAuthor={main.author} className="aspect-[3/4] w-full" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <span className="text-[10px] font-bold tracking-[0.3em]" style={{ color: v.accent }}>
                  {isPSEO ? '相关小说推荐' : '主关键词书籍'}
                </span>
                <h2 className="text-2xl font-black leading-snug" style={{ color: v.text, fontFamily: v.titleFont }}>
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'book', bookId: main.id })}
                    className="transition-opacity hover:opacity-80"
                    style={{ color: 'inherit', font: 'inherit' }}
                    aria-label={`查看《${main.name}》详情`}
                  >
                    {main.name}
                  </button>
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: v.textMuted }}>
                  <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" aria-hidden />{main.author}</span>
                  <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: v.surfaceAlt, color: v.primary }}>{main.category}</span>
                  <StatusBadge status={main.status} />
                  <span>{formatWords(main.wordCount)}</span>
                </div>
                <p className="max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>{main.intro || '暂无简介'}</p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'book', bookId: main.id })}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold transition-opacity hover:opacity-85"
                    style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
                    aria-label={`查看《${main.name}》详情`}
                  >
                    <BookOpen className="h-4 w-4" aria-hidden />
                    查看书籍详情
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'book', bookId: main.id })}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
                    style={{ border: `1px solid ${v.border}`, color: v.text, borderRadius: v.radius, background: v.surfaceAlt }}
                    aria-label={`查看《${main.name}》章节目录`}
                  >
                    <ListTree className="h-4 w-4" aria-hidden />
                    章节目录
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* 次要书单 */}
          {data.otherBooks.length > 0 && (
            <section aria-label="其他相关书籍">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-widest" style={{ color: v.text }}>
                <Network className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
                其他相关书籍
              </h2>
              <ul className="space-y-1">
                {data.otherBooks.map((b, i) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => navigate({ view: 'book', bookId: b.id })}
                      className="flex w-full items-center gap-3 border-b py-3 text-left text-sm transition-colors hover:opacity-70"
                      style={{ borderColor: withAlpha(v.border, 0.7), color: v.text }}
                    >
                      <span className="w-7 text-center text-base font-black italic tabular-nums" style={{ color: i < 3 ? v.primary : v.textMuted }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="flex-1 truncate font-medium">{b.name}</span>
                      <span className="text-xs" style={{ color: v.textMuted }}>{b.author}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* 相关词云 */}
      {data && data.related.length > 0 && (
        <section className="pt-10" aria-label="相关关键词">
          <h2 className="mb-3 text-sm font-bold tracking-widest" style={{ color: v.text }}>相关关键词</h2>
          <TagCloud tags={data.related} />
        </section>
      )}

      {/* R13-1A: 底部 "相关搜索" 区块 — 同引擎聚合的相关词, 链到其他 keyword 落地页 */}
      {relatedSearch.length > 0 && (
        <section className="pt-10" aria-label="相关搜索">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-widest" style={{ color: v.text }}>
            <Search className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
            相关搜索
          </h2>
          <div className="flex flex-wrap gap-2">
            {relatedSearch.map((kw, i) => (
              <a
                key={`rs-${i}`}
                href={`/?view=keyword&tag=${encodeURIComponent(kw)}&site=${encodeURIComponent(site.id)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault()
                  navigate({ view: 'keyword', tag: kw, site: site.id })
                }}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08),
                  color: v.primary,
                  border: `1px solid ${withAlpha(v.primary, 0.3)}`,
                  borderRadius: v.radius,
                }}
                aria-label={`查看"${kw}"相关小说推荐`}
              >
                {kw}
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
