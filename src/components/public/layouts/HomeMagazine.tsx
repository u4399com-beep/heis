// ============================================================
// 首页布局 · magazine（玫瑰剧场 rose）
// 左大封面 + 右榜单的双栏杂志头 + 按栏目化分区，红金戏剧化
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { Drama, Feather, Flame } from 'lucide-react'

function MagazineSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-2">
        <Sk className="aspect-[3/4] w-full max-w-sm" />
        <div className="space-y-4 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Sk className="h-5 w-2/3" />
              <Sk className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Sk className="aspect-[3/4] w-full" />
            <Sk className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function HomeMagazine({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <MagazineSkeleton />
  if (!books.length) return null

  const [cover, ...rest] = books
  const headlines = rest.slice(0, 5)

  // 栏目化：按分类分区
  const columns = new Map<string, BookItem[]>()
  for (const b of rest.slice(5)) {
    const key = b.category || '未分类'
    const arr = columns.get(key) || []
    if (arr.length < 4) arr.push(b)
    columns.set(key, arr)
  }

  return (
    <div className="space-y-10">
      {/* 双栏杂志头 */}
      <section
        className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-8"
        style={{
          background: v.surface,
          border: `1px solid ${v.border}`,
          borderRadius: v.radius,
          boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
        }}
        aria-label="本期主打"
      >
        {/* 左：大封面 */}
        <div className="relative p-5 sm:p-6">
          <span
            className="absolute left-0 top-5 z-10 px-3 py-1 text-xs font-bold tracking-widest sm:top-6"
            style={{ background: v.primary, color: v.primaryText }}
          >
            本期主打
          </span>
          <div
            className="mx-auto w-52 cursor-pointer overflow-hidden sm:w-60"
            style={{ border: `2px solid ${v.accent}`, borderRadius: v.radius, padding: 4, background: v.bg }}
            {...bookNavProps(navigate, cover.id)}
            aria-label={`查看《${cover.name}》详情`}
          >
            <BookCover name={cover.name} cover={cover.cover} className="aspect-[3/4] w-full" />
          </div>
          <div className="mt-4 text-center">
            <h1 className="text-xl font-black sm:text-2xl" style={{ color: v.text, fontFamily: v.titleFont }}>
              <button
                type="button"
                onClick={() => navigate({ view: 'book', bookId: cover.id })}
                className="transition-opacity hover:opacity-80"
                style={{ color: 'inherit', font: 'inherit' }}
                aria-label={`查看《${cover.name}》详情`}
              >
                {cover.name}
              </button>
            </h1>
            <p className="mt-1 text-xs" style={{ color: v.textMuted }}>
              {cover.author} · {formatWords(cover.wordCount)}
            </p>
          </div>
        </div>
        {/* 右：头条榜单 */}
        <div className="flex flex-col border-t p-5 sm:p-6 md:border-l md:border-t-0" style={{ borderColor: v.border }}>
          <div className="mb-3 flex items-center gap-2">
            <Flame className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
            <h2 className="text-sm font-bold tracking-[0.3em]" style={{ color: v.accent, fontFamily: v.titleFont }}>
              头条书目
            </h2>
            <span className="ml-auto text-[10px] tracking-widest" style={{ color: v.textMuted }}>{site.name}</span>
          </div>
          <ul className="flex-1 divide-y" style={{ borderColor: withAlpha(v.border, 0.6) }}>
            {headlines.map((b, i) => (
              <li
                key={b.id}
                className="group cursor-pointer py-3 first:pt-0 last:pb-0"
                {...bookNavProps(navigate, b.id)}
                aria-label={`查看《${b.name}》详情`}
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-lg font-black italic" style={{ color: withAlpha(v.accent, 0.8), fontFamily: v.titleFont }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className="text-base font-bold leading-snug transition-colors group-hover:text-opacity-80"
                        style={{ color: v.text, fontFamily: v.titleFont }}
                      >
                        {b.name}
                      </h3>
                      <StatusBadge status={b.status} small />
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs" style={{ color: v.textMuted }}>
                      {b.intro || `${b.author} · ${b.category}`}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 栏目化分区 */}
      {[...columns.entries()].map(([col, list]) => (
        <section key={col} aria-label={`${col}栏目`}>
          <div className="mb-4 flex items-center gap-3">
            <span className="h-5 w-1" style={{ background: v.accent }} aria-hidden />
            <h2 className="flex items-center gap-2 text-lg font-black tracking-widest" style={{ color: v.text, fontFamily: v.titleFont }}>
              <Drama className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
              {col}
            </h2>
            <span className="h-px flex-1" style={{ background: withAlpha(v.accent, 0.35) }} aria-hidden />
            <Feather className="h-3.5 w-3.5" style={{ color: v.textMuted }} aria-hidden />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {list.map((b) => (
              <article
                key={b.id}
                className="cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1"
                style={{ background: v.surfaceAlt, border: `1px solid ${withAlpha(v.border, 0.7)}`, borderRadius: v.radius }}
                {...bookNavProps(navigate, b.id)}
                aria-label={`查看《${b.name}》详情`}
              >
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                <div className="p-2.5">
                  <h3 className="line-clamp-1 text-sm font-bold" style={{ color: v.text, fontFamily: v.titleFont }}>{b.name}</h3>
                  <p className="line-clamp-1 text-[11px]" style={{ color: v.textMuted }}>{b.author}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
