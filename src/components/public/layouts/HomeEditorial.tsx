// ============================================================
// 首页布局 · editorial（编辑周刊 editorial）
// 顶部周刊刊头（ISSUE N° + 期号 + 横线分隔）
// 主体"本期导读"双栏：左大封面 hero + 右 5 行目录
// 底部"本周精选"3x3 网格（封面 + 编辑短评）
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { ArrowRight, Feather, Sparkles } from 'lucide-react'

function EditorialSkeleton() {
  return (
    <div className="space-y-10">
      {/* 刊头骨架 */}
      <Sk className="h-16 w-full" />
      {/* 本期导读骨架 */}
      <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
        <Sk className="aspect-[3/4] w-full max-w-md" />
        <div className="space-y-4 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Sk className="h-6 w-8" />
              <Sk className="h-4 flex-1" />
              <Sk className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>
      {/* 底部 3x3 网格骨架 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Sk className="aspect-[3/4] w-full" />
            <Sk className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 编辑短评伪文本：从书名+分类组合生成稳定的简短评语 */
function editorialReview(b: BookItem): string {
  const seed = (b.name.length + b.author.length) % 7
  const reviews = [
    `${b.category}题材佳作，叙事节奏明快。`,
    '跌宕起伏的逆袭之作，余味悠长。',
    `作者${b.author}笔力浑厚，情节铺陈精巧。`,
    '细腻入微的人物刻画，值得一读。',
    '近年同类型作品中的稀缺力作。',
    '开篇即抓人，章章皆有伏笔。',
    `${formatWords(b.wordCount)}巨制，沉浸式阅读体验。`,
  ]
  return reviews[seed]
}

export function HomeEditorial({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <EditorialSkeleton />
  if (!books.length) return null

  const [cover, ...rest] = books
  const headlines = rest.slice(0, 5) // 右侧 5 行目录
  const grid = rest.slice(5, 14) // 底部 3x3 网格

  // 期号：用今天日期作为周刊期号
  const now = new Date()
  const issueNum = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const titleFont = v.titleFont || v.fontFamily

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      {/* 周刊刊头 */}
      <header
        className="flex flex-wrap items-baseline justify-between gap-4 pb-3"
        style={{ borderBottom: `3px double ${v.primary}` }}
        aria-label="周刊刊头"
      >
        <div>
          <p className="text-[11px] uppercase tracking-[0.45em]" style={{ color: v.accent }}>
            EDITORIAL · ISSUE N°
          </p>
          <p
            className="mt-1 text-3xl font-black italic sm:text-4xl"
            style={{ color: v.text, fontFamily: titleFont, fontVariantNumeric: 'tabular-nums' }}
          >
            {issueNum}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tracking-[0.2em]" style={{ color: v.text }}>
            {site.name}
          </p>
          <p className="mt-0.5 text-[11px] italic" style={{ color: v.textMuted }}>
            {site.description || '精选每周佳作 · 严肃阅读'}
          </p>
        </div>
      </header>

      {/* 本期导读 */}
      <section
        className="grid gap-8 md:grid-cols-[3fr_2fr]"
        aria-label="本期导读"
      >
        {/* 左 60%：大封面 hero */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span
              className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.3em]"
              style={{ background: v.accent, color: v.primaryText }}
            >
              封面故事
            </span>
            <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />
          </div>
          <div
            className="mt-3 w-full max-w-md cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1 sm:w-72"
            style={{
              border: `2px solid ${v.accent}`,
              padding: 4,
              borderRadius: v.radius,
              background: v.bg,
              boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
            }}
            {...bookNavProps(navigate, cover.id)}
            aria-label={`查看《${cover.name}》详情`}
          >
            <BookCover name={cover.name} cover={cover.cover} className="aspect-[3/4] w-full" />
          </div>
          <div className="mt-4 max-w-md">
            <h1
              className="text-2xl font-black leading-tight sm:text-3xl"
              style={{ color: v.text, fontFamily: titleFont }}
            >
              <button
                type="button"
                onClick={() => navigate({ view: 'book', bookId: cover.id })}
                className="text-left transition-opacity hover:opacity-80"
                style={{ color: 'inherit', font: 'inherit' }}
                aria-label={`查看《${cover.name}》详情`}
              >
                {cover.name}
              </button>
            </h1>
            <p className="mt-1.5 text-xs italic tracking-wide" style={{ color: v.accent }}>
              {cover.author} · {cover.category}
            </p>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{
                color: v.textMuted,
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {cover.intro || `${cover.author} 倾情打造的${cover.category}长篇。本期封面故事，编辑强推，开篇即抓人，章章皆有伏笔。`}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => navigate({ view: 'book', bookId: cover.id })}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-opacity hover:opacity-85"
                style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
              >
                阅读全文
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
              <span className="text-[11px] tabular-nums" style={{ color: v.textMuted }}>
                {formatWords(cover.wordCount)}
              </span>
              <StatusBadge status={cover.status} small />
            </div>
          </div>
        </div>

        {/* 右 40%：5 行目录 */}
        <div className="flex flex-col border-t pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0" style={{ borderColor: withAlpha(v.border, 0.6) }}>
          <p className="mb-3 text-[10px] uppercase tracking-[0.35em]" style={{ color: v.accent }}>
            <Feather className="mr-1 inline h-3 w-3" aria-hidden />本期目录
          </p>
          <ul className="flex-1 divide-y" style={{ borderColor: withAlpha(v.border, 0.5) }}>
            {headlines.map((b, i) => (
              <li
                key={b.id}
                className="group flex cursor-pointer items-baseline gap-3 py-3 first:pt-0 last:pb-0"
                {...bookNavProps(navigate, b.id)}
                aria-label={`查看《${b.name}》详情`}
              >
                <span
                  className="w-7 shrink-0 text-xl font-black italic tabular-nums"
                  style={{ color: withAlpha(v.accent, 0.7), fontFamily: titleFont }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-1 text-sm font-bold transition-opacity group-hover:opacity-75" style={{ color: v.text }}>
                    {b.name}
                  </h3>
                  <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: v.textMuted }}>
                    {b.latestChapter || b.category}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] tabular-nums italic" style={{ color: v.textMuted }}>
                  {formatWords(b.wordCount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 本周精选 3x3 网格 */}
      <section aria-label="本周精选">
        <div className="mb-4 flex items-center gap-3">
          <Sparkles className="h-4 w-4" style={{ color: v.accent }} aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-[0.3em]" style={{ color: v.text }}>
            本周精选
          </h2>
          <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />
          <span className="text-[11px] italic" style={{ color: v.textMuted }}>编辑短评</span>
        </div>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
          {grid.map((b) => (
            <article
              key={b.id}
              className="group cursor-pointer"
              {...bookNavProps(navigate, b.id)}
              aria-label={`查看《${b.name}》详情`}
            >
              <div
                className="overflow-hidden transition-transform duration-200 group-hover:-translate-y-1"
                style={{
                  border: `1px solid ${withAlpha(v.border, 0.6)}`,
                  borderRadius: v.radius,
                  background: v.surface,
                  boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
                }}
              >
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
              </div>
              <h3 className="mt-2 line-clamp-1 text-sm font-bold" style={{ color: v.text, fontFamily: titleFont }}>
                {b.name}
              </h3>
              <p className="mt-0.5 line-clamp-1 text-[10px] italic" style={{ color: v.accent }}>
                {b.author} · {b.category}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: v.textMuted }}>
                <span className="mr-1" style={{ color: v.accent }} aria-hidden>“</span>
                {editorialReview(b)}
                <span className="ml-1" style={{ color: v.accent }} aria-hidden>”</span>
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* 底部页脚信息 */}
      <footer
        className="flex items-center justify-between pt-6 text-[10px] uppercase tracking-[0.3em]"
        style={{ borderTop: `1px solid ${withAlpha(v.border, 0.6) }`, color: v.textMuted }}
      >
        <span>© {now.getFullYear()} {site.name}</span>
        <span className="italic">{books.length} books · weekly issue</span>
      </footer>
    </div>
  )
}
