// ============================================================
// 首页布局 · mosaic（夕阳橙紫 sunset）
// 顶部大封面 + 2x2 小封面拼贴 hero
// 中部 12 列 grid-auto-flow dense 马赛克墙
// 底部横向滚动近期入库
// ============================================================
'use client'

import type { CSSProperties } from 'react'
import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { LayoutGrid, Sparkles, Clock } from 'lucide-react'

function MosaicSkeleton() {
  return (
    <div className="space-y-8">
      {/* hero 骨架：左大 + 右 2x2 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Sk className="aspect-[3/4] w-full sm:col-span-2 sm:row-span-2" style={{ minHeight: 280 }} />
        {Array.from({ length: 4 }).map((_, i) => (
          <Sk key={i} className="aspect-square w-full" />
        ))}
      </div>
      {/* 马赛克墙骨架 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Sk key={i} className="aspect-[3/4] w-full" />
        ))}
      </div>
    </div>
  )
}

/** 马赛克墙格子大小规则：偶数 1x2，奇数 2x1，第 6 倍数 2x2 */
function cellSpan(index: number): CSSProperties {
  if ((index + 1) % 6 === 0) {
    // 第 6/12/18 倍数：跨 2 行 2 列
    return { gridRow: 'span 2', gridColumn: 'span 2' }
  }
  if (index % 2 === 0) {
    return { gridRow: 'span 1', gridColumn: 'span 2' }
  }
  return { gridRow: 'span 2', gridColumn: 'span 1' }
}

export function HomeMosaic({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <MosaicSkeleton />
  if (!books.length) return null

  const [featured, ...rest] = books
  const heroQuartet = rest.slice(0, 4) // 2x2 小拼贴
  const wall = rest.slice(4) // 马赛克墙
  const recent = rest.slice(0, 12) // 底部横向滚动（复用前 12 本，避免空）

  return (
    <div className="space-y-10">
      {/* 顶部今日精选 hero */}
      <section
        className="grid gap-3 sm:grid-cols-3"
        aria-label="今日精选"
        style={{
          background: `linear-gradient(135deg, ${withAlpha(v.primary, 0.08)}, ${withAlpha(v.accent, 0.05)})`,
          padding: '1rem',
          borderRadius: v.radius,
          border: `1px solid ${withAlpha(v.border, 0.6)}`,
        }}
      >
        <div className="mb-2 flex items-center gap-2 sm:col-span-3">
          <Sparkles className="h-4 w-4" style={{ color: v.accent }} aria-hidden />
          <h2 className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: v.accent }}>
            今日精选
          </h2>
          <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />
        </div>
        {/* 左大封面 */}
        <article
          className="group relative cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1 sm:col-span-2 sm:row-span-2"
          style={{
            border: `1px solid ${v.border}`,
            borderRadius: v.radius,
            background: v.surface,
            boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
          }}
          {...bookNavProps(navigate, featured.id)}
          aria-label={`查看《${featured.name}》详情`}
        >
          <BookCover name={featured.name} cover={featured.cover} className="aspect-[4/3] w-full sm:aspect-auto sm:h-full" />
          <div
            className="absolute inset-x-0 bottom-0 p-4 pt-12"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)' }}
          >
            <span className="absolute left-2 top-2"><StatusBadge status={featured.status} small /></span>
            <h3 className="text-lg font-black sm:text-2xl" style={{ color: '#fff' }}>
              {featured.name}
            </h3>
            <p className="mt-1 line-clamp-1 text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {featured.author} · {featured.category} · {formatWords(featured.wordCount)}
            </p>
          </div>
        </article>
        {/* 右 2x2 小拼贴 */}
        {heroQuartet.map((b) => (
          <article
            key={b.id}
            className="group relative cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1"
            style={{
              border: `1px solid ${v.border}`,
              borderRadius: v.radius,
              background: v.surface,
            }}
            {...bookNavProps(navigate, b.id)}
            aria-label={`查看《${b.name}》详情`}
          >
            <BookCover name={b.name} cover={b.cover} className="aspect-square w-full" />
            <div
              className="absolute inset-0 flex flex-col justify-end p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 70%)' }}
            >
              <h4 className="line-clamp-1 text-sm font-bold" style={{ color: '#fff' }}>{b.name}</h4>
              <p className="line-clamp-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.8)' }}>{b.author}</p>
            </div>
          </article>
        ))}
      </section>

      {/* 中部马赛克墙 */}
      <section aria-label="分类马赛克墙">
        <div className="mb-4 flex items-center gap-3">
          <LayoutGrid className="h-5 w-5" style={{ color: v.primary }} aria-hidden />
          <h2 className="flex items-center gap-2 text-lg font-black" style={{ color: v.text }}>
            分类马赛克
          </h2>
          <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.7) }} aria-hidden />
          <span className="text-xs tabular-nums" style={{ color: v.textMuted }}>{wall.length} 本</span>
        </div>
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: 'repeat(12, 1fr)',
            gridAutoRows: '120px',
            gridAutoFlow: 'dense',
          }}
        >
          {wall.map((b, i) => (
            <article
              key={b.id}
              className="group relative cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
              style={{
                ...cellSpan(i),
                border: `1px solid ${withAlpha(v.border, 0.6)}`,
                borderRadius: v.radius,
                background: v.surface,
                boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
              }}
              {...bookNavProps(navigate, b.id)}
              aria-label={`查看《${b.name}》详情`}
            >
              <BookCover name={b.name} cover={b.cover} className="h-full w-full" />
              <div
                className="absolute inset-0 flex flex-col justify-end p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 70%)' }}
              >
                <h4 className="line-clamp-1 text-sm font-bold" style={{ color: '#fff' }}>{b.name}</h4>
                <p className="line-clamp-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {b.author} · {formatWords(b.wordCount)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 底部横向滚动 */}
      <section aria-label="近期入库">
        <div className="mb-3 flex items-center gap-3">
          <Clock className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
          <h2 className="text-sm font-bold tracking-wider" style={{ color: v.text }}>近期入库</h2>
          <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />
        </div>
        <div
          className="flex gap-3 overflow-x-auto pb-2"
          style={{ scrollbarWidth: 'thin' }}
          role="list"
        >
          {recent.map((b) => (
            <article
              key={b.id}
              className="group w-24 shrink-0 cursor-pointer"
              {...bookNavProps(navigate, b.id)}
              aria-label={`查看《${b.name}》详情`}
            >
              <div
                className="overflow-hidden transition-transform duration-200 group-hover:-translate-y-1"
                style={{ border: `1px solid ${withAlpha(v.border, 0.6)}`, borderRadius: v.radius }}
              >
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-24" />
              </div>
              <h4 className="mt-1.5 line-clamp-1 text-[11px] font-medium" style={{ color: v.text }}>{b.name}</h4>
            </article>
          ))}
        </div>
        <p className="mt-2 text-[11px]" style={{ color: v.textMuted }}>
          {site.name} · {books.length} 部作品持续更新
        </p>
      </section>
    </div>
  )
}
