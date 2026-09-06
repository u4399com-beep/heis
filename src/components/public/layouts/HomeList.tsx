// ============================================================
// 首页布局 · list（纸墨书香 paper）
// 居中报头 + 编号排行榜式行列表，衬线书卷气
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { BookOpen, Feather } from 'lucide-react'

function ListSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <Sk className="h-6 w-8" />
          <Sk className="aspect-[3/4] w-14 shrink-0" />
          <div className="flex-1 space-y-2">
            <Sk className="h-4 w-1/2" />
            <Sk className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function HomeList({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <ListSkeleton />
  if (!books.length) return null

  return (
    <div className="mx-auto max-w-3xl">
      {/* 居中报头 */}
      <div className="mb-8 text-center">
        <h1
          className="text-3xl font-black tracking-[0.2em] sm:text-4xl"
          style={{ color: v.text, fontFamily: v.titleFont }}
        >
          {site.name}
        </h1>
        <div className="mt-3 flex items-center justify-center gap-3" aria-hidden>
          <span className="h-px w-16" style={{ background: withAlpha(v.primary, 0.5) }} />
          <Feather className="h-4 w-4" style={{ color: v.accent }} />
          <span className="h-px w-16" style={{ background: withAlpha(v.primary, 0.5) }} />
        </div>
        {site.description && (
          <p className="mx-auto mt-3 max-w-xl text-xs leading-relaxed tracking-widest" style={{ color: v.textMuted }}>
            {site.description}
          </p>
        )}
      </div>

      {/* 排行榜式编号行列表 */}
      <section
        className="overflow-hidden"
        style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow }}
        aria-label="书籍排行"
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${v.border}`, background: v.surfaceAlt }}
        >
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-widest" style={{ color: v.text, fontFamily: v.titleFont }}>
            <BookOpen className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
            书籍排行
          </h2>
          <span className="text-[11px]" style={{ color: v.textMuted }}>按最近更新排序</span>
        </div>
        <ol>
          {books.map((b, i) => {
            const top = i < 3
            return (
              <li
                key={b.id}
                className="group cursor-pointer px-4 py-3.5 transition-colors sm:px-5"
                style={{ borderBottom: i < books.length - 1 ? `1px dashed ${withAlpha(v.border, 0.9)}` : undefined }}
                {...bookNavProps(navigate, b.id)}
                aria-label={`查看《${b.name}》详情`}
              >
                <div className="flex items-start gap-3 sm:gap-4">
                  {/* 编号 */}
                  <span
                    className="mt-0.5 w-9 shrink-0 text-center text-xl font-black tabular-nums"
                    style={{ color: top ? v.primary : v.textMuted, fontFamily: v.titleFont, opacity: top ? 1 : 0.7 }}
                    aria-label={`第 ${i + 1} 名`}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <BookCover name={b.name} cover={b.cover} showAuthor={b.author} className="aspect-[3/4] w-14 shrink-0 sm:w-16" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className="text-base font-bold transition-colors"
                        style={{ color: top ? v.primary : v.text, fontFamily: v.titleFont }}
                      >
                        {b.name}
                      </h3>
                      <StatusBadge status={b.status} small />
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs" style={{ color: v.textMuted }}>
                      <span>{b.author}</span>
                      <span style={{ color: v.accent }}>{b.category}</span>
                      <span>{formatWords(b.wordCount)}</span>
                    </p>
                    <p className="mt-1.5 line-clamp-1 text-xs leading-relaxed" style={{ color: v.textMuted }}>
                      {b.intro || `最新章节：${b.latestChapter || '暂无'}`}
                    </p>
                    <p className="mt-1 line-clamp-1 text-[11px]" style={{ color: withAlpha(v.primary, 0.85) }}>
                      最新：{b.latestChapter || '暂无章节'}
                    </p>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
