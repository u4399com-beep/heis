// ============================================================
// 主题化书籍卡片 / 行 / 海报 / 通用结果列表
// ============================================================
'use client'

import { BookOpen, Clock3, User } from 'lucide-react'
import type { BookItem } from './types'
import { usePublic } from './ctx'
import { fmtDate, formatWords, withAlpha } from './seo'
import { BookCover } from './BookCover'
import { bookNavProps, EmptyState, Sk, StatusBadge } from './bits'

/** 通用书籍卡片（网格布局，主题化圆角/阴影/描边） */
export function BookCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: v.radius,
        boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
      }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div className="relative">
        <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" />
        <span className="absolute left-2 top-2">
          <StatusBadge status={book.status} small />
        </span>
      </div>
      <div className="space-y-1 p-2.5">
        <h3 className="line-clamp-1 text-sm font-semibold" style={{ color: v.text }}>{book.name}</h3>
        <p className="flex items-center gap-1 text-xs" style={{ color: v.textMuted }}>
          <User className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{book.author}</span>
        </p>
        <p className="flex items-center justify-between text-[11px]" style={{ color: v.textMuted }}>
          <span className="truncate" style={{ color: v.primary }}>{book.category}</span>
          <span>{formatWords(book.wordCount)}</span>
        </p>
      </div>
    </article>
  )
}

/** 通用书籍行（列表布局：横向封面 + 信息） */
export function BookLine({ book, index }: { book: BookItem; index?: number }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group flex cursor-pointer items-center gap-3 py-3 transition-colors"
      style={{ borderBottom: `1px solid ${withAlpha(v.border, 0.7)}` }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      {typeof index === 'number' && (
        <span
          className="w-8 shrink-0 text-center text-lg font-bold tabular-nums"
          style={{ color: index < 3 ? v.primary : v.textMuted, fontFamily: v.titleFont }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
      )}
      <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-14 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="line-clamp-1 text-sm font-semibold" style={{ color: v.text }}>{book.name}</h3>
          <StatusBadge status={book.status} small />
        </div>
        <p className="flex flex-wrap items-center gap-x-3 text-xs" style={{ color: v.textMuted }}>
          <span className="truncate">{book.author}</span>
          <span style={{ color: v.primary }}>{book.category}</span>
          <span>{formatWords(book.wordCount)}</span>
        </p>
        <p className="line-clamp-1 text-xs" style={{ color: v.textMuted }}>{book.intro || book.latestChapter}</p>
      </div>
      <span className="hidden shrink-0 items-center gap-1 text-xs sm:flex" style={{ color: v.textMuted }}>
        <Clock3 className="h-3 w-3" aria-hidden />
        {fmtDate(book.updatedAt)}
      </span>
    </article>
  )
}

/** 影院海报卡（底部渐变遮罩标题） */
export function BookPoster({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group relative cursor-pointer overflow-hidden transition-transform duration-200 hover:scale-[1.03]"
      style={{ borderRadius: v.radius, boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" />
      <div
        className="absolute inset-x-0 bottom-0 p-2.5 pt-8"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 55%, transparent 100%)' }}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <StatusBadge status={book.status} small />
          <span className="text-[10px]" style={{ color: v.accent }}>{formatWords(book.wordCount)}</span>
        </div>
        <h3 className="line-clamp-1 text-sm font-semibold text-white">{book.name}</h3>
        <p className="line-clamp-1 text-[11px] text-white/70">{book.author}</p>
      </div>
    </article>
  )
}

/**
 * 通用主题结果列表 — 供 搜索/分类 页复用：
 * 按 theme.layout 自动切换 卡片网格 / 文字行 / 海报墙
 */
export function ThemeBookList({ books, loading }: { books: BookItem[]; loading?: boolean }) {
  const { theme } = usePublic()
  const layout = theme.layout

  if (loading) {
    if (layout === 'list' || layout === 'minimal') {
      return (
        <div className="space-y-4 py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Sk className="aspect-[3/4] w-14 shrink-0" />
              <div className="flex-1 space-y-2">
                <Sk className="h-4 w-1/3" />
                <Sk className="h-3 w-1/2" />
                <Sk className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      )
    }
    return (
      <div className="grid grid-cols-2 gap-4 py-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Sk className="aspect-[3/4] w-full" />
            <Sk className="h-4 w-4/5" />
            <Sk className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (!books.length) return <EmptyState text="没有找到相关书籍" hint="换个关键词或分类试试" />

  if (layout === 'list' || layout === 'minimal') {
    return (
      <div className="divide-y-0">
        {books.map((b, i) => <BookLine key={b.id} book={b} index={i} />)}
      </div>
    )
  }
  if (layout === 'theater') {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {books.map((b) => <BookPoster key={b.id} book={b} />)}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {books.map((b) => <BookCard key={b.id} book={b} />)}
    </div>
  )
}

/** 开始阅读入口按钮（跳第一章） */
export function ReadFirstButton({ firstChapterId, label = '开始阅读' }: { firstChapterId?: string; label?: string }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <button
      type="button"
      disabled={!firstChapterId}
      onClick={() => firstChapterId && navigate({ view: 'read', chapterId: firstChapterId })}
      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
      aria-label={label}
    >
      <BookOpen className="h-4 w-4" aria-hidden />
      {label}
    </button>
  )
}
