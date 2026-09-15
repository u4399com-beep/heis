// ============================================================
// 首页布局 · showcase（海洋蓝珊瑚 ocean）
// 左侧 sticky 侧边栏 + 右侧主区
// 移动端侧边栏隐藏，md+ 显示双栏
// 含本站统计（连载 vs 完结 progressbar）
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { Bookmark, Flame, Sparkles, CheckCircle2, Library, Hash } from 'lucide-react'

function ShowcaseSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* 左侧栏骨架 */}
      <aside className="hidden space-y-4 lg:block">
        <Sk className="h-12 w-full" />
        <Sk className="h-3 w-full" />
        <Sk className="h-3 w-2/3" />
        <Sk className="h-px w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Sk className="h-3 w-5" />
            <Sk className="h-4 flex-1" />
            <Sk className="h-3 w-8" />
          </div>
        ))}
        <Sk className="h-px w-full" />
        <Sk className="h-20 w-full" />
      </aside>
      {/* 右侧主区骨架 */}
      <div className="space-y-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Sk className="aspect-[3/4] w-full" />
              <Sk className="h-4 w-4/5" />
            </div>
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Sk className="h-20 w-16 shrink-0" />
            <div className="flex-1 space-y-2">
              <Sk className="h-4 w-1/2" />
              <Sk className="h-3 w-3/4" />
            </div>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Sk key={i} className="aspect-[3/4] w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function HomeShowcase({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <ShowcaseSkeleton />
  if (!books.length) return null

  // 站点统计：按 status 分组
  const ongoing = books.filter((b) => b.status === 'ongoing').length
  const completed = books.filter((b) => b.status === 'completed').length
  const unknown = books.length - ongoing - completed
  const total = books.length || 1
  const ongoingPct = Math.round((ongoing / total) * 100)
  const completedPct = Math.round((completed / total) * 100)

  // 分类列表（去重）
  const catMap = new Map<string, number>()
  for (const b of books) {
    const k = b.category || '未分类'
    catMap.set(k, (catMap.get(k) || 0) + 1)
  }
  const categories = [...catMap.entries()].slice(0, 8)

  // 三个区段数据
  const featured = books.slice(0, 3) // 本周强推 3 列卡片
  const fresh = books.slice(3, 8) // 新书速递 5 行
  const finished = books.filter((b) => b.status === 'completed').slice(0, 8) // 完结佳作
  const fallbackFinished = finished.length ? finished : books.slice(8, 12)

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* 左侧 sticky 侧边栏 */}
      <aside
        className="hidden lg:sticky lg:top-20 lg:block lg:self-start"
        aria-label="站点导航"
      >
        <div
          className="space-y-4 p-5"
          style={{
            background: v.surface,
            border: `1px solid ${v.border}`,
            borderRadius: v.radius,
            boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
          }}
        >
          {/* logo + 名 + 简介 */}
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${v.primary}, ${v.accent})`,
                  color: v.primaryText,
                  borderRadius: v.radius,
                }}
                aria-hidden
              >
                <Bookmark className="h-4 w-4" aria-hidden />
              </span>
              <h1 className="text-lg font-black leading-tight" style={{ color: v.text, fontFamily: v.titleFont }}>
                {site.name}
              </h1>
            </div>
            <p className="mt-3 line-clamp-3 text-xs leading-relaxed" style={{ color: v.textMuted }}>
              {site.description || '专注优质原创内容'}
            </p>
          </div>

          <div className="h-px w-full" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />

          {/* 分类列表 */}
          <nav aria-label="分类导航">
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: v.accent }}>
              <Hash className="mr-1 inline h-3 w-3" aria-hidden />分类
            </p>
            <ul className="space-y-0.5">
              {categories.map(([name, count]) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'category', cat: name })}
                    className="group flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:opacity-80"
                    style={{ color: v.text, borderRadius: v.radius }}
                    aria-label={`查看分类 ${name}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.primary }} aria-hidden />
                    <span className="flex-1 truncate">{name}</span>
                    <span className="text-[11px] tabular-nums" style={{ color: v.textMuted }}>{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="h-px w-full" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />

          {/* 本站统计 */}
          <div>
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: v.accent }}>
              <Library className="mr-1 inline h-3 w-3" aria-hidden />本站统计
            </p>
            <dl className="space-y-1.5 text-xs" style={{ color: v.text }}>
              <div className="flex items-center justify-between">
                <dt>总藏书</dt>
                <dd className="font-bold tabular-nums" style={{ color: v.primary }}>{books.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1"><Sparkles className="h-3 w-3" aria-hidden />连载中</dt>
                <dd className="font-bold tabular-nums" style={{ color: v.primary }}>{ongoing}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden />已完结</dt>
                <dd className="font-bold tabular-nums" style={{ color: v.accent }}>{completed}</dd>
              </div>
            </dl>
            {/* 横向 stacked bar */}
            <div
              className="mt-3 h-2 w-full overflow-hidden flex"
              style={{ background: v.surfaceAlt, borderRadius: v.radius }}
              role="img"
              aria-label={`连载 ${ongoingPct}% / 完结 ${completedPct}%`}
            >
              <span style={{ width: `${ongoingPct}%`, background: v.primary }} aria-hidden />
              <span style={{ width: `${completedPct}%`, background: v.accent }} aria-hidden />
              <span style={{ width: `${100 - ongoingPct - completedPct}%`, background: withAlpha(v.textMuted, 0.3) }} aria-hidden />
            </div>
            {unknown > 0 && (
              <p className="mt-1 text-[10px]" style={{ color: v.textMuted }}>未知状态 {unknown} 本</p>
            )}
          </div>
        </div>
      </aside>

      {/* 右侧主区滚动 */}
      <div className="space-y-10">
        {/* 本周强推 3 列 */}
        <section aria-label="本周强推">
          <div className="mb-4 flex items-center gap-3">
            <Flame className="h-5 w-5" style={{ color: v.accent }} aria-hidden />
            <h2 className="text-lg font-black" style={{ color: v.text }}>本周强推</h2>
            <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {featured.map((b) => (
              <article
                key={b.id}
                className="group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1"
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
                </div>
                <div className="p-3">
                  <h3 className="line-clamp-1 text-sm font-bold" style={{ color: v.text, fontFamily: v.titleFont }}>{b.name}</h3>
                  <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: v.textMuted }}>{b.author} · {b.category}</p>
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed" style={{ color: v.textMuted }}>
                    {b.intro || '暂无简介'}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 新书速递 5 行紧凑列表 */}
        <section aria-label="新书速递">
          <div className="mb-4 flex items-center gap-3">
            <Sparkles className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
            <h2 className="text-sm font-bold tracking-wider" style={{ color: v.text }}>新书速递</h2>
            <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />
          </div>
          <ul className="divide-y" style={{ borderColor: withAlpha(v.border, 0.5) }}>
            {fresh.map((b) => (
              <li
                key={b.id}
                className="group flex cursor-pointer items-center gap-3 py-3 first:pt-0 last:pb-0"
                {...bookNavProps(navigate, b.id)}
                aria-label={`查看《${b.name}》详情`}
              >
                <div
                  className="h-20 w-16 shrink-0 overflow-hidden"
                  style={{ border: `1px solid ${withAlpha(v.border, 0.6)}`, borderRadius: v.radius }}
                >
                  <BookCover name={b.name} cover={b.cover} className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="line-clamp-1 text-sm font-bold" style={{ color: v.text, fontFamily: v.titleFont }}>{b.name}</h3>
                    <StatusBadge status={b.status} small />
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: v.textMuted }}>
                    {b.author} · {b.category} · {formatWords(b.wordCount)}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed" style={{ color: v.textMuted }}>
                    {b.intro || '暂无简介'}
                  </p>
                  {b.latestChapter && (
                    <p className="mt-0.5 line-clamp-1 text-[10px]" style={{ color: v.accent }}>
                      最新：{b.latestChapter}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 完结佳作 4 列 */}
        <section aria-label="完结佳作">
          <div className="mb-4 flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4" style={{ color: v.accent }} aria-hidden />
            <h2 className="text-sm font-bold tracking-wider" style={{ color: v.text }}>完结佳作</h2>
            <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.6) }} aria-hidden />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {fallbackFinished.map((b) => (
              <article
                key={b.id}
                className="group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1"
                style={{
                  background: v.surface,
                  border: `1px solid ${withAlpha(v.border, 0.7)}`,
                  borderRadius: v.radius,
                }}
                {...bookNavProps(navigate, b.id)}
                aria-label={`查看《${b.name}》详情`}
              >
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                <div className="p-2.5">
                  <h3 className="line-clamp-1 text-xs font-bold" style={{ color: v.text }}>{b.name}</h3>
                  <p className="line-clamp-1 text-[10px]" style={{ color: v.textMuted }}>{b.author}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
