// ============================================================
// 主题化书籍卡片 / 通用结果列表
// (R14-1C 清理: 删除未使用的 BookLine / BookPoster export — 0 引用)
// ============================================================
'use client'

import { BookOpen, User } from 'lucide-react'
import type { BookItem } from './types'
import { usePublic } from './ctx'
import { formatWords, withAlpha } from './seo'
import { BookCover } from './BookCover'
import { bookNavProps, EmptyState, StatusBadge, BookGridSkeleton } from './bits'

/** 通用书籍卡片（网格布局，主题化圆角/阴影/描边） */
export function BookCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group relative cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: v.radius,
        boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
      }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      {/* feat-round-5 S1: 封面梯度光晕 (hover 时显现) */}
      <div aria-hidden className="pointer-events-none absolute -inset-2 -z-10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-70" style={{ background: `radial-gradient(circle at 50% 25%, ${withAlpha(v.primary, 0.5)}, transparent 70%)` }} />
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

/**
 * 通用主题结果列表 — 供 搜索/分类 页复用：
 * R10-1A: 9 套精仿主题均使用同样的通用卡片网格 (BookCard) 渲染搜索/分类结果
 */
export function ThemeBookList({ books, loading }: { books: BookItem[]; loading?: boolean }) {
  if (loading) {
    // feat-round-7 B3: 网格布局 loading 用通用 BookGridSkeleton
    return <BookGridSkeleton count={12} />
  }

  if (!books.length) return <EmptyState text="没有找到相关书籍" hint="换个关键词或分类试试" />

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {books.map((b) => <BookCard key={b.id} book={b} />)}
    </div>
  )
}

/** 开始阅读入口按钮（跳第一章） */
export function ReadFirstButton({
  firstChapterId,
  bookId,
  label = '开始阅读',
}: {
  firstChapterId?: string
  bookId?: string
  label?: string
}) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <button
      type="button"
      disabled={!firstChapterId}
      onClick={() => firstChapterId && navigate({ view: 'read', bookId, chapterId: firstChapterId })}
      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
      aria-label={label}
    >
      <BookOpen className="h-4 w-4" aria-hidden />
      {label}
    </button>
  )
}
