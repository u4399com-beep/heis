// ============================================================
// 首页布局 · grid（活力橙夏 mango）
// 大圆角卡片网格 2/3/4/5/6 列 + 圆角大封面 + 顶部暖色横幅
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { LibraryBig, Sun } from 'lucide-react'

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Sk className="aspect-[3/4] w-full" />
          <Sk className="h-4 w-4/5" />
          <Sk className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

export function HomeGrid({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <GridSkeleton />
  if (!books.length) return null

  return (
    <div className="space-y-8">
      {/* 暖色横幅 */}
      <section
        className="relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14"
        style={{
          background: `linear-gradient(120deg, ${withAlpha(v.primary, 0.9)}, ${withAlpha(v.accent, 0.75)})`,
          borderRadius: v.radius,
        }}
        aria-label="站点欢迎横幅"
      >
        <Sun className="absolute -right-6 -top-6 h-36 w-36 opacity-20" style={{ color: v.primaryText }} aria-hidden />
        <div className="relative max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.3em] opacity-80" style={{ color: v.primaryText }}>
            今日书单
          </p>
          <h1 className="mt-2 text-2xl font-black leading-snug sm:text-3xl" style={{ color: v.primaryText }}>
            {site.name} · 好书每天看
          </h1>
          {site.description && (
            <p className="mt-2 line-clamp-2 text-sm opacity-85" style={{ color: v.primaryText }}>
              {site.description}
            </p>
          )}
        </div>
      </section>

      {/* 卡片网格 */}
      <section aria-label="书籍网格">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-black" style={{ color: v.text }}>
            <LibraryBig className="h-5 w-5" style={{ color: v.primary }} aria-hidden />
            全部书籍
          </h2>
          <span className="text-xs" style={{ color: v.textMuted }}>持续更新中</span>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {books.map((b) => (
            <article
              key={b.id}
              className="group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1.5"
              style={{
                background: v.surface,
                border: `1px solid ${v.border}`,
                borderRadius: v.radius,
                boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
              }}
              {...bookNavProps(navigate, b.id)}
              aria-label={`查看《${b.name}》详情`}
            >
              <div className="relative">
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                <span className="absolute left-2 top-2"><StatusBadge status={b.status} small /></span>
                <span
                  className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: withAlpha(v.primaryText, 0.9), color: v.primary }}
                >
                  {formatWords(b.wordCount)}
                </span>
              </div>
              <div className="space-y-1 p-3">
                <h3 className="line-clamp-1 text-sm font-bold" style={{ color: v.text }}>{b.name}</h3>
                <p className="line-clamp-1 text-xs" style={{ color: v.textMuted }}>{b.author}</p>
                <p className="line-clamp-1 text-[11px]" style={{ color: v.textMuted }}>
                  <span className="mr-1 rounded-full px-1.5 py-px" style={{ background: v.surfaceAlt, color: v.accent }}>{b.category}</span>
                  {b.latestChapter || '暂无章节'}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
