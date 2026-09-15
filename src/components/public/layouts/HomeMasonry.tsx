// ============================================================
// 首页布局 · masonry（森林绿土 forest）
// CSS column-count 瀑布流（移动 2 列 / 桌面 3 列）
// 每 6 本第 1/6/12 作为"特写"卡片加大封面
// 底部本周热推横向滚动条
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { coverSrc, formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { Flame, TrendingUp } from 'lucide-react'

/** 用 CSS columns 实现的瀑布流, 内部每个卡片需 break-inside: avoid */
function MasonrySkeleton() {
  return (
    <div className="space-y-8">
      <Sk className="h-14 w-full" />
      <div className="columns-2 gap-4 md:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
        {Array.from({ length: 12 }).map((_, i) => {
          const heights = [180, 240, 200, 280, 220, 320, 200, 260, 180, 300, 240, 220]
          return <Sk key={i} className="w-full" style={{ height: heights[i % heights.length] }} />
        })}
      </div>
    </div>
  )
}

/** 是否特写（第 1/6/12 本作为大卡片） */
function isFeature(index: number): boolean {
  return index === 0 || index === 5 || index === 11
}

export function HomeMasonry({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <MasonrySkeleton />
  if (!books.length) return null

  const featured = books.slice(0, 12) // 主体瀑布流
  const hot = books.slice(0, 8) // 底部本周热推（复用前 8 本）

  return (
    <div className="space-y-10">
      {/* 顶部 sticky 站头 */}
      <header
        className="sticky top-0 z-10 -mx-4 px-4 py-4 sm:-mx-6 sm:px-6"
        style={{
          background: withAlpha(v.bg, 0.92),
          backdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${withAlpha(v.border, 0.6)}`,
        }}
        aria-label="站点信息"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black leading-tight sm:text-3xl" style={{ color: v.text, fontFamily: v.titleFont }}>
              {site.name}
            </h1>
            <p className="mt-0.5 line-clamp-1 text-xs" style={{ color: v.textMuted }}>
              {site.description || '探索更多精彩故事'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums" style={{ color: v.textMuted }}>
            <TrendingUp className="h-3 w-3" style={{ color: v.accent }} aria-hidden />
            共 {books.length} 本
          </div>
        </div>
      </header>

      {/* 主体瀑布流 */}
      <section aria-label="书籍瀑布流">
        <style>{`
          @media (min-width: 768px) {
            .home-masonry-cols { column-count: 3 !important; }
          }
        `}</style>
        <div
          className="home-masonry-cols"
          style={{ columnCount: 2, columnGap: '1.5rem' }}
        >
          {featured.map((b, i) => {
            const featured2 = isFeature(i)
            return (
              <article
                key={b.id}
                className="group mb-6 cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1"
                style={{
                  display: 'inline-block',
                  width: '100%',
                  breakInside: 'avoid',
                  background: v.surface,
                  border: `1px solid ${withAlpha(v.border, 0.7)}`,
                  borderRadius: v.radius,
                  boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
                }}
                {...bookNavProps(navigate, b.id)}
                aria-label={`查看《${b.name}》详情`}
              >
                <div className="relative">
                  <BookCover
                    name={b.name}
                    cover={b.cover}
                    className={featured2 ? 'aspect-[3/4] w-full' : 'aspect-[4/3] w-full'}
                  />
                  <span className="absolute left-2 top-2"><StatusBadge status={b.status} small /></span>
                  {featured2 && (
                    <span
                      className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: v.accent, color: v.primaryText }}
                    >
                      特写
                    </span>
                  )}
                </div>
                <div className="space-y-1.5 p-4">
                  <h3 className="line-clamp-1 text-base font-bold" style={{ color: v.text, fontFamily: v.titleFont }}>
                    {b.name}
                  </h3>
                  <p className="line-clamp-1 text-xs" style={{ color: v.textMuted }}>
                    {b.author} · {b.category} · {formatWords(b.wordCount)}
                  </p>
                  <p
                    className="text-xs leading-relaxed"
                    style={{
                      color: v.textMuted,
                      display: '-webkit-box',
                      WebkitLineClamp: featured2 ? 4 : 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {b.intro || `${b.author} 倾情打造 ${b.category} 长篇力作。`}
                  </p>
                  {b.latestChapter && (
                    <p className="line-clamp-1 text-[11px] italic" style={{ color: withAlpha(v.accent, 0.9) }}>
                      ↳ {b.latestChapter}
                    </p>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* 底部本周热推横向滚动 */}
      <section aria-label="本周热推">
        <div className="mb-3 flex items-center gap-3">
          <Flame className="h-4 w-4" style={{ color: v.accent }} aria-hidden />
          <h2 className="text-sm font-bold tracking-wider" style={{ color: v.text }}>本周热推</h2>
          <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />
        </div>
        <div
          className="flex gap-3 overflow-x-auto pb-2"
          style={{ scrollbarWidth: 'thin' }}
          role="list"
        >
          {hot.map((b) => {
            const cs = coverSrc(b.cover)
            return (
              <article
                key={b.id}
                className="group flex w-44 shrink-0 cursor-pointer items-center gap-3 p-2 transition-transform duration-200 hover:-translate-y-1"
                style={{
                  background: v.surface,
                  border: `1px solid ${withAlpha(v.border, 0.6)}`,
                  borderRadius: v.radius,
                }}
                {...bookNavProps(navigate, b.id)}
                aria-label={`查看《${b.name}》详情`}
              >
                <div
                  className="h-16 w-12 shrink-0 overflow-hidden"
                  style={{ borderRadius: v.radius, background: v.surfaceAlt }}
                >
                  {cs ? (
                    <img src={cs} alt={b.name} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <BookCover name={b.name} cover={b.cover} className="h-full w-full" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="line-clamp-1 text-xs font-bold" style={{ color: v.text }}>{b.name}</h4>
                  <p className="line-clamp-1 text-[10px]" style={{ color: v.textMuted }}>{b.author}</p>
                  <p className="line-clamp-1 text-[10px] tabular-nums" style={{ color: v.accent }}>
                    {formatWords(b.wordCount)}
                  </p>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
