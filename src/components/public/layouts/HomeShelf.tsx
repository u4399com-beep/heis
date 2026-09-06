// ============================================================
// 首页布局 · shelf（星夜幻紫 aurora）
// 顶部渐变 hero 精选 + 按分类分组的横向滚动玻璃书架
// ============================================================
'use client'

import type { BookItem } from '../types'
import type { CSSProperties } from 'react'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, SecTitle, Sk, StatusBadge } from '../bits'
import { BookOpen, ChevronRight, Sparkles } from 'lucide-react'

function ShelfSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <Sk className="aspect-[3/4] w-full max-w-[280px]" />
        <div className="space-y-3 pt-2">
          <Sk className="h-8 w-2/3" />
          <Sk className="h-4 w-1/3" />
          <Sk className="h-4 w-full" />
          <Sk className="h-4 w-5/6" />
          <Sk className="h-10 w-36" />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, r) => (
        <div key={r} className="space-y-3">
          <Sk className="h-5 w-28" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 7 }).map((_, i) => (
              <Sk key={i} className="aspect-[3/4] w-24 shrink-0 sm:w-28" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function HomeShelf({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <ShelfSkeleton />
  if (!books.length) return null

  const [featured, ...rest] = books
  const restList = rest.slice(0, 14)

  // 按分类分组 → 横向书架行
  const groups = new Map<string, BookItem[]>()
  for (const b of restList) {
    const key = b.category || '未分类'
    const arr = groups.get(key) || []
    arr.push(b)
    groups.set(key, arr)
  }

  const glass: CSSProperties = {
    background: v.surface,
    border: `1px solid ${v.border}`,
    borderRadius: v.radius,
    backdropFilter: 'blur(12px)',
    boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
  }

  return (
    <div className="space-y-10">
      {/* 顶部渐变 hero 精选 */}
      <section
        className="overflow-hidden p-5 sm:p-8"
        style={{
          background: `linear-gradient(120deg, ${withAlpha(v.primary, 0.28)}, ${withAlpha(v.accent, 0.14)} 55%, transparent)`,
          border: `1px solid ${v.border}`,
          borderRadius: v.radius,
        }}
        aria-label="精选推荐"
      >
        <div className="grid gap-6 md:grid-cols-[220px_1fr] md:gap-8">
          <div
            className="cursor-pointer overflow-hidden transition-transform duration-300 hover:scale-[1.02] mx-auto w-44 md:mx-0 md:w-full"
            style={glass}
            {...bookNavProps(navigate, featured.id)}
            aria-label={`查看《${featured.name}》详情`}
          >
            <BookCover name={featured.name} cover={featured.cover} className="aspect-[3/4] w-full" />
          </div>
          <div className="flex flex-col justify-center gap-3">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: withAlpha(v.accent, 0.16), color: v.accent, border: `1px solid ${withAlpha(v.accent, 0.4)}` }}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              本站精选
            </span>
            <h2
              className="text-2xl font-black leading-tight sm:text-3xl"
              style={{ color: v.text, fontFamily: v.titleFont }}
            >
              <button
                type="button"
                onClick={() => navigate({ view: 'book', bookId: featured.id })}
                className="transition-opacity hover:opacity-80"
                style={{ color: 'inherit', font: 'inherit' }}
                aria-label={`查看《${featured.name}》详情`}
              >
                {featured.name}
              </button>
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: v.textMuted }}>
              <StatusBadge status={featured.status} />
              <span>{featured.author}</span>
              <span style={{ color: v.primary }}>{featured.category}</span>
              <span>{formatWords(featured.wordCount)}</span>
            </div>
            <p className="line-clamp-3 max-w-xl text-sm leading-relaxed" style={{ color: v.textMuted }}>
              {featured.intro || '暂无简介'}
            </p>
            <p className="text-xs" style={{ color: v.textMuted }}>
              最新：<span style={{ color: v.accent }}>{featured.latestChapter || '暂无章节'}</span>
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => navigate({ view: 'book', bookId: featured.id })}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
                style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
              >
                <BookOpen className="h-4 w-4" aria-hidden />
                查看详情
              </button>
            </div>
          </div>
        </div>
        {/* 次级精选封面条 */}
        {restList.length > 0 && (
          <div className="mt-6 flex gap-3 overflow-x-auto pb-1">
            {restList.slice(0, 8).map((b) => (
              <button
                key={b.id}
                type="button"
                className="w-24 shrink-0 overflow-hidden text-left transition-transform hover:scale-[1.04] sm:w-28"
                style={glass}
                onClick={() => navigate({ view: 'book', bookId: b.id })}
                aria-label={b.name}
              >
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                <p className="line-clamp-1 px-2 py-1.5 text-xs" style={{ color: v.text }}>{b.name}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 按分类分组的横向书架 */}
      {[...groups.entries()].map(([cat, list]) => (
        <section key={cat} aria-label={`${cat}书架`}>
          <SecTitle
            icon={<BookOpen className="h-4 w-4" aria-hidden />}
            right={
              list[0]?.categoryId ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 text-xs transition-opacity hover:opacity-70"
                  style={{ color: v.textMuted }}
                  onClick={() => {
                    navigate({ view: 'category', cat: list[0].categoryId || '' })
                  }}
                  aria-label={`查看更多${cat}分类书籍`}
                >
                  更多 <ChevronRight className="h-3 w-3" aria-hidden />
                </button>
              ) : undefined
            }
          >
            {cat}
          </SecTitle>
          <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
            {list.map((b) => (
              <article
                key={b.id}
                className="w-24 shrink-0 cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1 sm:w-28"
                style={glass}
                {...bookNavProps(navigate, b.id)}
                aria-label={`查看《${b.name}》详情`}
              >
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                <div className="space-y-0.5 p-2">
                  <h3 className="line-clamp-1 text-xs font-semibold" style={{ color: v.text }}>{b.name}</h3>
                  <p className="line-clamp-1 text-[10px]" style={{ color: v.textMuted }}>{b.author}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
