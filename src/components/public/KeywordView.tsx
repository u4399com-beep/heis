// ============================================================
// 关键词落地页 — 大标题=tag + 主书籍卡片 + 次要书单 + 相关词云
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import { BookOpen, ListTree, Network, Tag, User } from 'lucide-react'
import { fetchKeyword } from './data'
import type { KeywordData } from './types'
import { usePublic } from './ctx'
import { formatWords, useSiteSEO, withAlpha } from './seo'
import { BookCover } from './BookCover'
import { EmptyState, ErrorState, Sk, StatusBadge, TagCloud } from './bits'

export function KeywordView({ tag }: { tag?: string }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [data, setData] = useState<KeywordData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [prevTag, setPrevTag] = useState(tag)
  if (prevTag !== tag) {
    setPrevTag(tag)
    setData(null)
    setError('')
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

  useSiteSEO({
    title: tag ? `${tag} - ${site.name}` : `关键词 - ${site.name}`,
    description: tag
      ? data?.book
        ? `${tag}主题小说推荐：《${data.book.name}》${data.book.author} 著，${formatWords(data.book.wordCount)}，${data.book.intro.slice(0, 80)}`
        : `${site.name}为您呈现“${tag}”相关的小说专题`
      : undefined,
    keywords: tag ? `${tag},${data?.book?.name || ''},${site.keywords}`.replace(/,+$/, '') : site.keywords,
    // 关键词落地页为聚合过渡页，统一 noindex 防止低质索引
    robots: 'noindex,follow',
    canonicalPath: tag ? `/?view=keyword&tag=${encodeURIComponent(tag)}&site=${site.id}` : undefined,
    site,
    jsonLd: tag
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: tag,
            description: `${tag}相关小说专题页`,
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
      {/* 大标题 = tag */}
      <header className="mb-8 text-center">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
          style={{ background: withAlpha(v.primary, theme.dark ? 0.2 : 0.1), color: v.primary }}
        >
          <Tag className="h-3.5 w-3.5" aria-hidden />
          关键词专题
        </span>
        <h1
          className="mt-4 text-3xl font-black tracking-wide sm:text-4xl"
          style={{
            color: v.text,
            fontFamily: v.titleFont,
            ...(theme.id === 'aurora'
              ? { background: `linear-gradient(90deg, ${v.primary}, ${v.accent})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }
              : {}),
          }}
        >
          {tag}
        </h1>
        <p className="mt-2 text-xs" style={{ color: v.textMuted }}>
          {site.name} · 围绕“{tag}”精选的小说合集
        </p>
      </header>

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
          <EmptyState text={`暂无与“${tag}”直接匹配的主打书籍`} hint="看看下面的相关词，或许有惊喜" />
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
                <span className="text-[10px] font-bold tracking-[0.3em]" style={{ color: v.accent }}>主关键词书籍</span>
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
    </div>
  )
}
