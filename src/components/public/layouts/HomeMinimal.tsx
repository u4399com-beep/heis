// ============================================================
// 首页布局 · minimal（青竹听雨 bamboo）
// 大量留白 + 双栏细线文字列表 + 顶部锚点式分类导航，无封面图
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { bookNavProps, Sk } from '../bits'
import { MoveRight, Wind } from 'lucide-react'

function MinimalSkeleton() {
  return (
    <div className="grid gap-x-16 gap-y-1 md:grid-cols-2">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-4">
          <Sk className="h-3 w-5" />
          <Sk className="h-4 w-1/3" />
          <Sk className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

export function HomeMinimal({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <MinimalSkeleton />
  if (!books.length) return null

  return (
    <div className="mx-auto max-w-5xl">
      {/* 极简报头：大量留白 */}
      <div className="pb-10 pt-4 text-center">
        <p className="text-[11px] tracking-[0.5em]" style={{ color: v.textMuted }}>MINIMAL READING</p>
        <h1 className="mt-4 text-3xl font-light tracking-[0.35em] sm:text-4xl" style={{ color: v.text }}>
          {site.name}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-xs leading-loose" style={{ color: v.textMuted }}>
          {site.description || '删繁就简，静心阅读。'}
        </p>
        <span className="mx-auto mt-6 block h-px w-10" style={{ background: v.primary }} aria-hidden />
      </div>

      {/* 双栏细线文字列表（无封面） */}
      <section aria-label="书籍列表">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="flex items-center gap-2 text-sm tracking-[0.3em]" style={{ color: v.textMuted }}>
            <Wind className="h-3.5 w-3.5" aria-hidden />
            近期更新
          </h2>
          <span className="text-[11px] tabular-nums" style={{ color: v.textMuted }}>{books.length} 部作品</span>
        </div>
        <div className="grid gap-x-16 md:grid-cols-2">
          {books.map((b, i) => (
            <article
              key={b.id}
              className="group flex cursor-pointer items-center gap-4 border-b py-4 transition-colors"
              style={{ borderColor: withAlpha(v.border, 0.8) }}
              {...bookNavProps(navigate, b.id)}
              aria-label={`查看《${b.name}》详情`}
            >
              <span className="w-5 shrink-0 text-right text-[11px] tabular-nums" style={{ color: v.textMuted }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <h3
                  className="truncate text-[15px] font-normal tracking-wide transition-colors group-hover:opacity-70"
                  style={{ color: v.text }}
                >
                  {b.name}
                  <span className="ml-2 align-middle text-[10px]" style={{ color: v.accent }}>{b.category}</span>
                </h3>
                <p className="mt-0.5 truncate text-[11px]" style={{ color: v.textMuted }}>
                  {b.author} · {b.latestChapter || '暂无章节'}
                </p>
              </div>
              <span className="hidden shrink-0 text-[11px] tabular-nums sm:block" style={{ color: v.textMuted }}>
                {formatWords(b.wordCount)}
              </span>
              <MoveRight
                className="h-3.5 w-3.5 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                style={{ color: v.primary }}
                aria-hidden
              />
            </article>
          ))}
        </div>
      </section>

      {/* 底部一句箴言 */}
      <p className="pt-12 text-center text-[11px] tracking-[0.4em]" style={{ color: v.textMuted }}>
        少即是多 · 静水流深
      </p>
    </div>
  )
}
