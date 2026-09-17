// ============================================================
// 首页布局 · clone-huangjinwu (精仿·黄金屋 huangjinwu.org)
// 实测 probe-html2/probe-huangjinwu.{html,css} 抓取真实 /static/default/style.css?v=hIZ8PgznfXiz (44KB, 含 dark/green 多主题变体):
//   :root (23 变量):
//     --font-family-ui: -apple-system,BlinkMacSystemFont,"Microsoft YaHei","PingFang SC","Segoe UI","Helvetica Neue",Arial,sans-serif
//     --bg-color #f0f4fb / --bg-gradient linear-gradient(180deg,#f5f8ff 0%,#eef3fb 100%)
//     --card-bg #fff / --header-bg rgba(255,255,255,.92) / --footer-bg #e2eaf5
//     --hover-color #e8f1ff
//     --primary-color #0f172a (深墨) / --secondary-color #2563eb (蓝) / --logo-color #1d4ed8
//     --text-color #1e293b / --text-light #64748b / --text-muted #94a3b8
//     --border-color #dbe4f0
//     --shadow 0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(37,99,235,.06)
//     --shadow-hover 0 8px 24px rgba(37,99,235,.14), 0 2px 8px rgba(15,23,42,.06)
//     --reader-text #1e293b / --reader-bg #f8fafc / --reader-border #d8e3f0
//     --btn-primary-hover-bg #1d4ed8 / --btn-primary-hover-text #fff
//     --border-radius 6px / --border-radius-lg 10px
//   body font-family: var(--font-family-ui) font-size 1.6rem line-height 1.65
//   a color var(--primary-color) → hover var(--secondary-color)
//   .container max-width 1180px
//   .headers backdrop-filter saturate(1.2) blur(12px), bg var(--header-bg), 1px border-bottom
//   .navbar gap 1.6rem padding 1.6rem 0
//   .book-grid { display:grid; gap:2.4rem; grid-template-columns:1fr; margin-bottom:3.2rem; }
// 结构 (侧栏 + 顶 nav + 主区网格):
//   顶 sticky header (logo + sidebar menu + search) + 主体推荐封面网格 + 最近更新列表 + 排行榜
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate, formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { BookOpen, ChevronRight, Flame, Library, Search, TrendingUp } from 'lucide-react'

function CloneSkeleton() {
  return (
    <div className="space-y-6">
      <Sk className="h-20 w-full" />
      <div>
        <Sk className="mb-3 h-7 w-44" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Sk className="aspect-[3/4] w-full" />
              <Sk className="mx-auto h-3.5 w-4/5" />
              <Sk className="mx-auto h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Sk className="col-span-2 h-72 w-full" />
        <Sk className="h-72 w-full" />
      </div>
    </div>
  )
}

/** 区块标题: 黄金屋 DNA — left blue dot + 主字 + 右 more (link blue) */
function HjwSecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <div className="mb-4 flex items-end justify-between border-b pb-2.5" style={{ borderColor: withAlpha(v.primary, 0.18) }}>
      <h3 className="flex items-center gap-2.5 text-lg font-bold leading-none" style={{ color: v.text }}>
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-md"
          style={{ background: withAlpha(v.primary, 0.1), color: v.primary }}
          aria-hidden
        >
          <BookOpen className="h-3.5 w-3.5" />
        </span>
        {main}
        <em className="not-italic text-sm font-normal" style={{ color: v.primary }}>{sub}</em>
      </h3>
      <span className="flex items-center gap-0.5 text-[11px] transition-opacity hover:opacity-70" style={{ color: v.primary }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/** 封面卡 (.module-card DNA: cover + title + author + meta) */
function HjwCoverCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group cursor-pointer p-2.5 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: '10px',
        boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
      }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div className="relative">
        <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" style={{ borderRadius: '6px' }} />
        <span className="absolute left-1.5 top-1.5"><StatusBadge status={book.status} small /></span>
      </div>
      <h4 className="mt-2 line-clamp-1 text-[14px] font-semibold leading-5 transition-colors" style={{ color: v.text }} title={book.name}>
        {book.name}
      </h4>
      <p className="mt-0.5 truncate text-[12px]" style={{ color: v.textMuted }}>{book.author}</p>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="rounded px-1.5 py-0.5" style={{ background: withAlpha(v.primary, 0.1), color: v.primary }}>{book.category}</span>
        <span className="tabular-nums" style={{ color: v.textMuted }}>{formatWords(book.wordCount)}</span>
      </div>
    </article>
  )
}

/** 最近更新列表 (.latest-update DNA: 类别/书名+最新章节/字数/更新时间) */
function HjwUpdateList({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const rows = books.slice(0, 14)
  if (!rows.length) return null
  return (
    <section data-clone-hjw-section="latest" aria-label="最近更新">
      <HjwSecTitle main="最近" sub="更新" />
      <div
        className="overflow-hidden"
        style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '10px', boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow }}
      >
        {rows.map((b, i) => (
          <div
            key={b.id}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors"
            style={{ borderBottom: i < rows.length - 1 ? `1px solid ${withAlpha(v.border, 0.5)}` : 'none' }}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums"
              style={{ background: withAlpha(v.primary, 0.1), color: v.primary }}
              aria-hidden
            >
              {i + 1}
            </span>
            <button
              type="button"
              onClick={() => navigate({ view: 'home' })}
              className="hidden shrink-0 rounded px-2 py-0.5 text-[11px] transition-opacity hover:opacity-80 sm:block"
              style={{ background: withAlpha(v.primary, 0.08), color: v.primary }}
              aria-label={`分类 ${b.category}`}
            >
              {b.category}
            </button>
            <button
              type="button"
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              className="min-w-0 flex-1 truncate text-left text-[14px] font-medium transition-colors hover:underline"
              style={{ color: v.text }}
              aria-label={`查看《${b.name}》详情`}
              title={b.name}
            >
              {b.name}
              <span className="ml-2 text-[12px] font-normal" style={{ color: v.textMuted }}>{b.latestChapter || '暂无章节'}</span>
            </button>
            <span className="hidden shrink-0 text-[11px] tabular-nums sm:block" style={{ color: v.textMuted }}>
              {formatWords(b.wordCount)}
            </span>
            <span className="hidden shrink-0 text-[11px] tabular-nums sm:block" style={{ color: v.textMuted }}>
              {b.updatedAt ? fmtDate(b.updatedAt) : '—'}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** 排行榜 (.rank-panel DNA: 序号 + 书名 + 字数) */
function HjwRankPanel({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const ranked = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 12)
  if (!ranked.length) return null
  return (
    <section
      data-clone-hjw-rank
      aria-label="点击排行"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: '10px',
        boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
      }}
    >
      <header
        className="flex items-center gap-2 px-4 py-3 text-sm font-bold"
        style={{ borderBottom: `1px solid ${withAlpha(v.border, 0.6)}`, color: v.text }}
      >
        <Flame className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
        点击排行榜
      </header>
      <ol className="px-2 py-1.5">
        {ranked.map((b, i) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              className="flex min-h-[38px] w-full items-center gap-2.5 border-b px-2 py-2 text-left transition-colors last:border-b-0 hover:opacity-80"
              style={{ borderColor: withAlpha(v.border, 0.5) }}
              aria-label={`查看排行榜第${i + 1}名《${b.name}》`}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums"
                style={{
                  background: i < 3 ? v.primary : withAlpha(v.textMuted, 0.12),
                  color: i < 3 ? v.primaryText : v.textMuted,
                }}
              >
                {i + 1}
              </span>
              <span className="line-clamp-1 flex-1 text-[13px]" style={{ color: v.text }}>{b.name}</span>
              <span className="shrink-0 text-[10px] tabular-nums" style={{ color: v.textMuted }}>{formatWords(b.wordCount)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function HomeCloneHuangjinwu({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-hjw-home><CloneSkeleton /></div>
  if (!books.length) return null

  const featured = books.slice(0, 10)
  const fresh = books.slice(10, 20)

  return (
    <div data-clone-hjw-home className="space-y-6">
      {/* 顶 header: backdrop blur + logo + nav menu + search bar (.headers DNA) */}
      <section
        className="sticky top-0 z-20 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-5 sm:py-4"
        style={{
          background: withAlpha(v.surface, 0.92),
          backdropFilter: 'saturate(1.2) blur(12px)',
          WebkitBackdropFilter: 'saturate(1.2) blur(12px)',
          borderBottom: `1px solid ${v.border}`,
          boxShadow: '0 1px 0 rgba(15,23,42,0.04), 0 8px 32px rgba(15,23,42,0.06)',
        }}
        aria-label="站点导航"
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: `linear-gradient(135deg, ${v.primary} 0%, ${v.accent} 100%)`, color: v.primaryText }}
            aria-hidden
          >
            <Library className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-bold leading-tight" style={{ color: v.primary }}>{site.name}</p>
            <p className="text-[11px]" style={{ color: v.textMuted }}>书中自有黄金屋</p>
          </div>
        </div>
        <nav
          aria-label="分类快捷导航"
          className="hidden flex-1 items-center gap-1 overflow-x-auto text-sm md:flex"
        >
          {['首页', '排行榜', '书库', '标签', '作者', '电子书'].map((t, i) => (
            <span
              key={t}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors"
              style={{
                background: i === 0 ? withAlpha(v.primary, 0.1) : 'transparent',
                color: i === 0 ? v.primary : v.text,
              }}
              aria-hidden={i !== 0}
            >
              {t}
            </span>
          ))}
        </nav>
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-1.5"
          style={{ background: v.surfaceAlt, color: v.textMuted, flex: 1, maxWidth: 320 }}
          aria-hidden
        >
          <Search className="h-4 w-4 opacity-70" />
          <span className="text-sm opacity-80">可搜书名、作者、角色…</span>
        </div>
      </section>

      {/* 站点欢迎 hero: bg-gradient + 大字号站点名 + slogan */}
      <section
        className="relative overflow-hidden px-6 py-8 sm:px-10 sm:py-10"
        style={{
          background: `linear-gradient(135deg, ${withAlpha(v.primary, 0.08)} 0%, ${withAlpha(v.accent, 0.06)} 100%), ${v.surface}`,
          border: `1px solid ${v.border}`,
          borderRadius: '10px',
          boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
        }}
        aria-label="站点欢迎横幅"
      >
        <TrendingUp className="absolute -right-4 -top-4 h-24 w-24 opacity-15" style={{ color: v.primary }} aria-hidden />
        <div className="relative max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: v.primary }}>
            黄金屋
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-snug sm:text-3xl" style={{ color: v.text }}>
            {site.name} · 书中自有颜如玉
          </h1>
          {site.description && (
            <p className="mt-2 line-clamp-2 text-sm" style={{ color: v.textMuted }}>
              {site.description}
            </p>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-5">
        {/* 左主栏 */}
        <div className="min-w-0 flex-1 space-y-6">
          <section data-clone-hjw-section="featured" aria-label="精品推荐">
            <HjwSecTitle main="精品" sub="推荐" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {featured.map((b) => <HjwCoverCard key={b.id} book={b} />)}
            </div>
          </section>

          {fresh.length > 0 && (
            <section data-clone-hjw-section="fresh" aria-label="最新入库">
              <HjwSecTitle main="最新" sub="入库" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {fresh.map((b) => <HjwCoverCard key={b.id} book={b} />)}
              </div>
            </section>
          )}

          <HjwUpdateList books={books} />
        </div>

        {/* 右侧栏: 排行榜 + 站点公告 */}
        <aside className="w-full shrink-0 lg:w-[280px]">
          <HjwRankPanel books={books} />
          <section
            className="mt-4 px-4 py-3 text-xs leading-relaxed"
            style={{
              background: `linear-gradient(180deg, ${withAlpha(v.primary, 0.06)}, ${withAlpha(v.accent, 0.04)})`,
              color: v.textMuted,
              border: `1px solid ${v.border}`,
              borderRadius: '10px',
            }}
            aria-label="站点公告"
          >
            <p className="mb-1 font-bold" style={{ color: v.text }}>站点公告</p>
            <p style={{ opacity: 0.9 }}>本站所有小说均可免费在线阅读, 完结好书持续收录中。使用顶部搜索框可按书名 / 作者查找。</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
