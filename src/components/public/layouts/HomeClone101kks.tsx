// ============================================================
// 首页布局 · clone-101kks (精仿·101看書 101kks.com, 繁体)
// 实测 probe-html2/probe-101kks.{html,css} 抓取真实 /css/style.css + /css/block_booklist.css:
//   charset: utf8 (繁体)
//   body { background:#f2f3f4; color:#333; font-size:14px; font-family:"Microsoft YaHei"; }
//   a color #666 / hover #06c (Microsoft blue) text-decoration none
//   header { background:#fff2df; }   /* ★米黄头 */
//   .headbox max-width 1250px (主容器)
//   .bookbox padding 10px overflow hidden
//   .bookimg 48x64 float left, .booknav width calc(100% - 58px) float left
//   .booklist-card: bg #fff, radius 10px, shadow 0 2px 10px rgba(0,0,0,0.08), border 1px solid rgba(0,0,0,0.06), height 128px
//   .booklist-card:hover: translateY(-2px), shadow 0 6px 20px rgba(0,0,0,0.12)
//   .booklist-cover-section: flex 0 0 120px, gradient linear-gradient(135deg, #667eea 0%, #764ba2 100%)
//   .booklist-title: font-size 14px weight 600 color #2c3e50 line-height 1.3 (line-clamp 2)
//   .booklist-meta: gap 12px font-size 12px color #7f8c8d
//   .booklist-grid: grid auto-fill minmax(280px, 1fr) gap 12px (3 列 @≥1200px)
// 结构: 顶部 logo+搜索 + 9 宫格封面卡片 + 4 列宽卡 (.booklist-card 含 cover-section 渐变 + info-section) + 表格更新
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate, formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { ChevronRight, Flame, Library, Search, TrendingUp } from 'lucide-react'

function CloneSkeleton() {
  return (
    <div className="space-y-7">
      <Sk className="h-16 w-full" />
      <div>
        <Sk className="mb-3 h-7 w-40" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-3">
              <Sk className="h-28 w-24 shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <Sk className="h-4 w-3/4" />
                <Sk className="h-3 w-2/5" />
                <Sk className="h-12 w-full" />
                <Sk className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Sk className="mb-3 h-7 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Sk className="aspect-[3/4] w-full" />
              <Sk className="mx-auto h-3.5 w-4/5" />
              <Sk className="mx-auto h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 区块标题: 蓝紫渐变圆角胶囊 + 主字 + 右更多 */
function KksSecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <div className="mb-4 flex items-end justify-between border-b pb-2.5" style={{ borderColor: withAlpha(v.primary, 0.2) }}>
      <h3 className="flex items-center gap-2.5 text-lg font-bold leading-none" style={{ color: v.text }}>
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold"
          style={{ background: `linear-gradient(135deg, ${v.primary} 0%, ${v.accent} 100%)`, color: v.primaryText }}
          aria-hidden
        >
          ❶
        </span>
        {main}
        <em className="not-italic text-sm font-normal" style={{ color: v.primary }}>{sub}</em>
      </h3>
      <span className="flex items-center gap-0.5 text-[11px] transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/** 宽卡: .booklist-card DNA: 120px 渐变 cover-section + info-section (title + meta + desc) */
function KksWideCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group flex cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: '10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
      }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div
        className="relative flex h-32 w-[120px] shrink-0 items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${v.primary} 0%, ${v.accent} 100%)` }}
        aria-hidden
      >
        <div className="relative h-[110px] w-[78px]">
          <BookCover name={book.name} cover={book.cover} className="absolute inset-0 h-full w-full" style={{ borderRadius: '3px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
        <div>
          <h4
            className="line-clamp-2 text-[14px] font-semibold leading-tight"
            style={{ color: v.text }}
            title={book.name}
          >
            {book.name}
          </h4>
          <div className="mt-1 flex items-center gap-3 text-[12px]" style={{ color: v.textMuted }}>
            <span className="truncate">{book.author}</span>
            <StatusBadge status={book.status} small />
          </div>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-[1.5]" style={{ color: v.textMuted }}>
            {book.intro || '暂无简介'}
          </p>
        </div>
        <div className="flex items-center justify-between text-[11px]" style={{ color: v.textMuted }}>
          <span className="rounded px-1.5 py-0.5" style={{ background: withAlpha(v.primary, 0.1), color: v.primary }}>{book.category}</span>
          <span className="tabular-nums">{formatWords(book.wordCount)}</span>
        </div>
      </div>
    </article>
  )
}

/** 封面网格小卡: bookimg 48x64 + booknav (title + author) */
function KksCoverCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group cursor-pointer p-2.5 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: '10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
      }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" style={{ borderRadius: '4px' }} />
      <h4 className="mt-2 line-clamp-2 text-[13px] font-medium leading-tight" style={{ color: v.text }} title={book.name}>
        {book.name}
      </h4>
      <p className="mt-0.5 truncate text-[11px]" style={{ color: v.textMuted }}>{book.author}</p>
    </article>
  )
}

/** 表格最近更新 (.bookbox DNA) */
function KksUpdateTable({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const rows = books.slice(0, 15)
  if (!rows.length) return null
  return (
    <section data-clone-101kks-section="latest" aria-label="最近更新">
      <KksSecTitle main="最近" sub="更新" />
      <div className="overflow-hidden" style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '10px' }}>
        <table data-clone-101kks-table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
          <thead>
            <tr style={{ background: v.surfaceAlt, color: v.textMuted }}>
              <th scope="col" className="w-12 px-3 py-2 text-xs font-normal">#</th>
              <th scope="col" className="px-3 py-2 text-xs font-normal">书名</th>
              <th scope="col" className="hidden w-24 px-3 py-2 text-xs font-normal sm:table-cell">作者</th>
              <th scope="col" className="hidden px-3 py-2 text-xs font-normal sm:table-cell">最新章节</th>
              <th scope="col" className="hidden w-24 px-3 py-2 text-right text-xs font-normal sm:table-cell">更新时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr key={b.id} className="border-t transition-colors" style={{ borderColor: withAlpha(v.border, 0.55) }}>
                <td className="px-3 py-2.5 text-center tabular-nums" style={{ color: v.textMuted }}>{i + 1}</td>
                <td className="min-w-0 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'book', bookId: b.id })}
                    className="block max-w-full truncate text-left transition-colors hover:underline"
                    style={{ color: v.primary }}
                    aria-label={`查看《${b.name}》详情`}
                  >
                    {b.name}
                  </button>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 sm:table-cell" style={{ color: v.textMuted }}>{b.author}</td>
                <td className="hidden min-w-0 px-3 py-2.5 sm:table-cell">
                  <span className="block max-w-full truncate text-[12px]" style={{ color: v.textMuted }} title={b.latestChapter || ''}>
                    {b.latestChapter || '—'}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[12px] tabular-nums sm:table-cell" style={{ color: v.textMuted }}>
                  {b.updatedAt ? fmtDate(b.updatedAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function HomeClone101kks({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-101kks-home><CloneSkeleton /></div>
  if (!books.length) return null

  const featured = books.slice(0, 9)
  const fresh = books.slice(9, 21)

  return (
    <div data-clone-101kks-home className="space-y-7">
      {/* 顶 banner: 蓝紫渐变 + 站点名 + 搜索框 + slogan */}
      <section
        className="relative overflow-hidden px-5 py-6 sm:px-8 sm:py-8"
        style={{
          background: `linear-gradient(120deg, ${v.primary} 0%, ${v.accent} 100%)`,
          borderRadius: '12px',
        }}
        aria-label="站点欢迎横幅"
      >
        <TrendingUp className="absolute -right-4 -top-4 h-28 w-28 opacity-15" style={{ color: v.primaryText }} aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: v.primaryText, opacity: 0.85 }}>
              101看書 · 無廣告彈窗
            </p>
            <h1 className="mt-1 text-2xl font-black leading-tight sm:text-3xl" style={{ color: v.primaryText }}>
              {site.name}
            </h1>
            {site.description && (
              <p className="mt-1 line-clamp-1 text-sm" style={{ color: v.primaryText, opacity: 0.9 }}>
                {site.description}
              </p>
            )}
          </div>
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.18)', color: v.primaryText, maxWidth: 320 }}
            aria-hidden
          >
            <Search className="h-4 w-4 opacity-80" />
            <span className="text-sm opacity-80">搜索书名 / 作者…</span>
          </div>
        </div>
      </section>

      {/* 精品推荐宽卡 3 列 (.booklist-card DNA) */}
      <section data-clone-101kks-section="featured" aria-label="精品推荐">
        <KksSecTitle main="精品" sub="推荐" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((b) => <KksWideCard key={b.id} book={b} />)}
        </div>
      </section>

      {/* 最新入库封面网格 6 列 */}
      {fresh.length > 0 && (
        <section data-clone-101kks-section="fresh" aria-label="最新入库">
          <KksSecTitle main="最新" sub="入库" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {fresh.map((b) => <KksCoverCard key={b.id} book={b} />)}
          </div>
        </section>
      )}

      <KksUpdateTable books={books} />

      {/* 站点信息条 (.headbox DNA: max-width 容器 + 横向 flex 信息) */}
      <section
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
        style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '10px', color: v.textMuted }}
        aria-label="站点信息"
      >
        <span className="flex items-center gap-1.5">
          <Library className="h-3.5 w-3.5" style={{ color: v.primary }} aria-hidden />
          {site.name}
        </span>
        <span className="flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5" style={{ color: v.accent }} aria-hidden />
          全免费 · 无广告弹窗
        </span>
        <span className="tabular-nums">共 {books.length} 本</span>
      </section>
    </div>
  )
}
