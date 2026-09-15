// ============================================================
// 可复用细节组件库 — 供新首页布局组合使用
// HeroBanner: 渐变光效 hero 横幅
// RankingList: 排行榜样式（前3名差异徽章）
// CategoryStrip: 水平滑动分类导航条
// ChapterTeaser: 章节预览卡片
// ============================================================
'use client'

import type { ReactNode } from 'react'
import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { coverSrc, fmtDate, formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { ArrowRight, ChevronRight, Clock, Flame, Hash, Star, TrendingUp } from 'lucide-react'

// ============================================================
// HeroBanner: 渐变光效 hero 横幅（用于 hero 区）
// ============================================================
export function HeroBanner({
  title,
  subtitle,
  cover,
  action,
  actionLabel,
}: {
  title: string
  subtitle?: string
  cover?: string
  action?: () => void
  actionLabel?: string
}) {
  const { theme } = usePublic()
  const v = theme.vars
  const cs = cover ? coverSrc(cover) : null

  return (
    <section
      className="relative overflow-hidden px-6 py-12 sm:px-10 sm:py-16"
      style={{
        background: `linear-gradient(135deg, ${withAlpha(v.primary, 0.95)} 0%, ${withAlpha(v.accent, 0.85)} 100%)`,
        borderRadius: v.radius,
        boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
      }}
      aria-label={title}
    >
      {/* 背景封面 + 光效 */}
      <div className="absolute inset-0" aria-hidden>
        {cs && (
          <img
            src={cs}
            alt=""
            loading="lazy"
            className="h-full w-full scale-110 object-cover opacity-25"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        )}
        {/* 辉光圆斑 */}
        <div
          className="absolute -right-12 -top-12 h-64 w-64 rounded-full"
          style={{ background: `radial-gradient(circle, ${withAlpha(v.primaryText, 0.18)} 0%, transparent 70%)` }}
          aria-hidden
        />
        <div
          className="absolute -bottom-16 -left-12 h-72 w-72 rounded-full"
          style={{ background: `radial-gradient(circle, ${withAlpha(v.accent, 0.4)} 0%, transparent 70%)` }}
          aria-hidden
        />
      </div>
      <div className="relative max-w-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.45em] opacity-85" style={{ color: v.primaryText }}>
          Featured · 精选
        </p>
        <h1
          className="mt-2 text-3xl font-black leading-tight sm:text-5xl"
          style={{ color: v.primaryText, textShadow: '0 2px 12px rgba(0,0,0,0.25)' }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="mt-3 line-clamp-2 text-sm leading-relaxed opacity-90 sm:text-base" style={{ color: v.primaryText }}>
            {subtitle}
          </p>
        )}
        {action && actionLabel && (
          <button
            type="button"
            onClick={action}
            className="mt-5 inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold transition-all hover:scale-105"
            style={{
              background: v.primaryText,
              color: v.primary,
              borderRadius: v.radius,
            }}
            aria-label={actionLabel}
          >
            {actionLabel}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </section>
  )
}

// ============================================================
// RankingList: 排行榜样式（前3名差异徽章，4-10 名等宽小数字）
// ============================================================
export function RankingList({
  items,
  title,
  icon,
}: {
  items: { id: string; name: string; author: string; meta?: string }[]
  title: string
  icon?: ReactNode
}) {
  const { theme, navigate } = usePublic()
  const v = theme.vars

  if (!items.length) return null

  // 前三名配色徽章
  const medal = (i: number) => {
    if (i === 0) return { bg: v.accent, color: v.primaryText, label: 'No.1' }
    if (i === 1) return { bg: withAlpha(v.accent, 0.7), color: v.primaryText, label: 'No.2' }
    if (i === 2) return { bg: withAlpha(v.accent, 0.45), color: v.primaryText, label: 'No.3' }
    return null
  }

  return (
    <section aria-label={title}>
      <div className="mb-4 flex items-center gap-3">
        <Flame className="h-4 w-4" style={{ color: v.accent }} aria-hidden />
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-wider" style={{ color: v.text }}>
          {icon || null}
          {title}
        </h2>
        <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />
      </div>
      <ol className="divide-y" style={{ borderColor: withAlpha(v.border, 0.5) }}>
        {items.map((b, i) => {
          const m = medal(i)
          return (
            <li
              key={b.id}
              className="group flex cursor-pointer items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              role="button"
              tabIndex={0}
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate({ view: 'book', bookId: b.id })
                }
              }}
              aria-label={`查看《${b.name}》详情`}
            >
              {m ? (
                <span
                  className="flex h-7 w-9 shrink-0 items-center justify-center text-[11px] font-black"
                  style={{ background: m.bg, color: m.color, borderRadius: v.radius }}
                  aria-hidden
                >
                  {m.label}
                </span>
              ) : (
                <span className="w-9 shrink-0 text-center text-sm font-bold tabular-nums" style={{ color: v.textMuted }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-1 text-sm font-bold transition-opacity group-hover:opacity-75" style={{ color: v.text }}>
                  {b.name}
                </h3>
                <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: v.textMuted }}>
                  {b.author}{b.meta ? ` · ${b.meta}` : ''}
                </p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: v.primary }} aria-hidden />
            </li>
          )
        })}
      </ol>
    </section>
  )
}

// ============================================================
// CategoryStrip: 水平滑动分类导航条
// ============================================================
export function CategoryStrip({
  categories,
  activeId,
  onSelect,
}: {
  categories: { id: string; name: string; count?: number }[]
  activeId?: string
  onSelect: (id: string) => void
}) {
  const { theme } = usePublic()
  const v = theme.vars

  if (!categories.length) return null

  return (
    <nav aria-label="分类导航" className="relative">
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'thin' }}
        role="tablist"
      >
        {categories.map((c) => {
          const active = c.id === activeId
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(c.id)}
              className="flex shrink-0 items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium transition-all hover:-translate-y-0.5"
              style={{
                background: active ? v.primary : withAlpha(v.primary, theme.dark ? 0.14 : 0.07),
                color: active ? v.primaryText : v.primary,
                border: `1px solid ${active ? v.primary : withAlpha(v.primary, 0.3)}`,
                borderRadius: v.radius,
              }}
              aria-label={`查看分类 ${c.name}`}
            >
              <Hash className="h-3 w-3" aria-hidden />
              {c.name}
              {typeof c.count === 'number' && (
                <span className="ml-0.5 text-[10px] tabular-nums opacity-80">{c.count}</span>
              )}
            </button>
          )
        })}
      </div>
      {/* 右侧渐隐遮罩 */}
      <div
        className="pointer-events-none absolute right-0 top-0 h-full w-12"
        style={{ background: `linear-gradient(to left, ${v.bg} 0%, transparent 100%)` }}
        aria-hidden
      />
    </nav>
  )
}

// ============================================================
// ChapterTeaser: 章节预览卡片（书名 + 最新章节 + 更新时间）
// ============================================================
export function ChapterTeaser({
  book,
  onClick,
}: {
  book: BookItem
  onClick: () => void
}) {
  const { theme } = usePublic()
  const v = theme.vars

  return (
    <article
      className="group flex cursor-pointer items-center gap-3 p-3 transition-all duration-200 hover:-translate-y-0.5"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      style={{
        background: v.surface,
        border: `1px solid ${withAlpha(v.border, 0.6)}`,
        borderRadius: v.radius,
      }}
      aria-label={`预览《${book.name}》章节`}
    >
      <div
        className="h-16 w-12 shrink-0 overflow-hidden"
        style={{ border: `1px solid ${withAlpha(v.border, 0.5)}`, borderRadius: v.radius }}
      >
        <BookCover name={book.name} cover={book.cover} className="h-full w-full" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="line-clamp-1 text-sm font-bold transition-opacity group-hover:opacity-75" style={{ color: v.text, fontFamily: v.titleFont }}>
            {book.name}
          </h3>
          <span className="shrink-0 text-[10px] tabular-nums" style={{ color: v.textMuted }}>
            {formatWords(book.wordCount)}
          </span>
        </div>
        <p className="mt-1 line-clamp-1 text-[11px]" style={{ color: v.accent }}>
          <TrendingUp className="mr-1 inline h-3 w-3" aria-hidden />
          {book.latestChapter || '暂无章节'}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[10px] tabular-nums" style={{ color: v.textMuted }}>
          <Clock className="mr-1 inline h-2.5 w-2.5" aria-hidden />
          {book.updatedAt ? fmtDate(book.updatedAt) : '近期更新'} · {book.category}
        </p>
      </div>
      <ChevronRight
        className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: v.primary }}
        aria-hidden
      />
    </article>
  )
}

/** StarRating helper: 可选小星星装饰（用 v.accent） */
export function StarMark({ count = 5 }: { count?: number }) {
  const { theme } = usePublic()
  const v = theme.vars
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <Star key={i} className="h-2.5 w-2.5" style={{ color: v.accent }} aria-hidden />
      ))}
    </span>
  )
}
