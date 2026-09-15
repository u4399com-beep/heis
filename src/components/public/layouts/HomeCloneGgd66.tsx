// ============================================================
// 首页布局 · clone-ggd66 (精仿·格格党 ggd66.com)
// 实测 CSS (ggd66.com 直连 200, /static/simple/style.css 11.5KB):
//   body bg #f9f9f9, color #888, font 15px "微软雅黑",Microsoft Yahei,simsun,arial,sans-serif, line-height 150%
//   a color #00886d (mint green) → hover #f50 (orange-red!)
//   .header bg #56ccb5 OR #1abc9c (mint) height 50px line-height 50px white text shadow
//   .container width 90% max-width 75pc (1200px)
//   .content-left float left 73% / .content-right float right 25%
//   #fengtui .item float left 50% padding 10px 0 0 — book cards 2-col
//   #fengtui .item .image width 90pt img 120x150 border 1px #ccc padding 1px
//   #fengtui .item dl dt border-bottom 1px dotted #ccc font-weight 700 15px line-height 25px
//     dt span float right font-weight 400 14px (作者名)
//   #fengtui .item dl dd text-indent 2em height 90pt 14px line-height 24px
//   #fengyou ul li / #zuixin ul li: border-bottom 1px dashed #ccc height 28px line-height 28px font 14px
//     li a font 15px / li span float right 14px (作者)
//   breadcrumb bg #cdf3eb (light mint) border 1px #ccc radius 4px padding 8px 15px
//   h2 border-bottom 1px #ccc color #333 font 18px weight 500
//   footer bg #56ccb5 white text text-align center font 14px padding 10px 0
// 结构: 顶 mint header (logo + nav) + breadcrumb + content (左73% 热门推荐2列 + 最新更新 / 右25% 搜索+排行榜)
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { ChevronRight, Flame, Search } from 'lucide-react'

function CloneSkeleton() {
  return (
    <div className="space-y-4">
      <Sk className="h-12 w-full" />
      <Sk className="h-7 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="col-span-2 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-3">
              <Sk className="aspect-[4/5] w-20 shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <Sk className="h-4 w-3/5" />
                <Sk className="h-12 w-full" />
              </div>
            </div>
          ))}
        </div>
        <Sk className="h-72 w-full" />
      </div>
    </div>
  )
}

/** 区块标题 (h2 DNA: border-bottom 1px #ccc color #333 font 18px weight 500) */
function GgdSecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <h2
      className="mb-3 flex items-end justify-between border-b pb-2 text-[18px] font-medium leading-tight"
      style={{ borderColor: v.border, color: v.text }}
    >
      <span className="flex items-baseline gap-2">
        <span aria-hidden>◆</span>
        {main}
        <em className="not-italic text-[14px] font-normal" style={{ color: v.primary }}>{sub}</em>
      </span>
      <span className="flex items-center gap-0.5 text-[12px] font-normal transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </h2>
  )
}

/** 热门小说大卡 (#fengtui .item DNA: image 90pt + dl dt + dd) */
function GgdBigCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group flex cursor-pointer gap-3 py-2.5"
      style={{ borderBottom: `1px dashed ${v.border}` }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div className="w-[90px] shrink-0 sm:w-[100px]">
        <BookCover
          name={book.name}
          cover={book.cover}
          className="aspect-[4/5] w-full"
          style={{ border: '1px solid #ccc', padding: 1, background: '#fff', borderRadius: 0 }}
        />
      </div>
      <dl className="min-w-0 flex-1 py-0.5">
        <dt
          className="flex items-baseline gap-2 border-b pb-1 text-[15px] font-bold leading-6"
          style={{ borderColor: v.border }}
        >
          <span className="truncate" style={{ color: v.primary }} title={book.name}>{book.name}</span>
          <span className="shrink-0 text-[13px] font-normal" style={{ color: v.textMuted }}>{book.author}</span>
        </dt>
        <dd
          className="mt-1.5 line-clamp-3 text-[13px] leading-[24px]"
          style={{ color: v.textMuted, textIndent: '2em' }}
        >
          {book.intro || '暂无简介'}
        </dd>
        <dd className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: v.textMuted }}>
          <StatusBadge status={book.status} small />
          <span>[{book.category}]</span>
          <span className="ml-auto tabular-nums">{formatWords(book.wordCount)}</span>
        </dd>
      </dl>
    </article>
  )
}

/** 列表行 (#fengyou li / #zuixin li DNA: [分类] 书名 作者) */
function GgdListRow({ book, showCat = true }: { book: BookItem; showCat?: boolean }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  return (
    <li
      className="flex items-center gap-2 px-1 py-1 text-[14px] leading-[28px] transition-colors hover:opacity-80"
      style={{ borderBottom: `1px dashed ${v.border}` }}
    >
      {showCat && (
        <span className="shrink-0 text-[12px]" style={{ color: v.primary }}>[{book.category}]</span>
      )}
      <button
        type="button"
        onClick={() => navigate({ view: 'book', bookId: book.id })}
        className="min-w-0 flex-1 truncate text-left transition-colors hover:underline"
        style={{ color: v.primary }}
        aria-label={`查看《${book.name}》详情`}
        title={book.name}
      >
        {book.name}
      </button>
      <span className="shrink-0 text-[12px] tabular-nums" style={{ color: v.textMuted }}>{book.author}</span>
    </li>
  )
}

/** 排行榜 (li DNA: 序号 + 书名 + 作者) */
function GgdRankList({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const ranked = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 12)
  if (!ranked.length) return null
  return (
    <section
      data-clone-ggd-rank
      aria-label="点击排行"
      style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '4px' }}
    >
      <header
        className="flex items-center gap-2 px-3 py-2 text-sm font-bold"
        style={{ background: v.primary, color: v.primaryText, borderBottom: `1px solid ${v.border}` }}
      >
        <Flame className="h-4 w-4" aria-hidden />
        阅读排行榜
      </header>
      <ol className="px-1 py-1">
        {ranked.map((b, i) => (
          <li key={b.id} className="border-b last:border-b-0" style={{ borderColor: withAlpha(v.border, 0.55) }}>
            <button
              type="button"
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              className="flex min-h-[32px] w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:opacity-80"
              aria-label={`查看排行榜第${i + 1}名《${b.name}》`}
            >
              <span
                className="w-5 shrink-0 text-center text-sm font-bold tabular-nums"
                style={{ color: i < 3 ? v.accent : v.textMuted }}
              >
                {i + 1}.
              </span>
              <span className="line-clamp-1 flex-1 text-[13px]" style={{ color: v.primary }}>{b.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums" style={{ color: v.textMuted }}>{b.author}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function HomeCloneGgd66({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-ggd-home><CloneSkeleton /></div>
  if (!books.length) return null

  const featured = books.slice(0, 6)
  const latest = books.slice(6, 22)

  return (
    <div data-clone-ggd-home className="space-y-4">
      {/* 顶 mint header (.header DNA: bg #56ccb5 height 50px white text logo + nav) */}
      <header
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
        style={{ background: v.primary, color: v.primaryText }}
        aria-label="站点导航"
      >
        <a
          href="/"
          className="flex items-center gap-2 text-lg font-bold"
          style={{ color: v.primaryText, textShadow: '1px 1px 2px rgba(0,0,0,0.3)' }}
          aria-label={site.name}
        >
          <span aria-hidden>◆</span>
          {site.name}
        </a>
        <nav aria-label="主导航" className="flex flex-wrap items-center gap-1 text-sm">
          {['首 页', '书 库', '全本', '搜索'].map((t, i) => (
            <span
              key={t}
              className="px-2 py-1"
              style={{ color: v.primaryText, textShadow: '1px 1px 1px rgba(0,0,0,0.4)', opacity: i === 0 ? 1 : 0.95 }}
              aria-hidden={i !== 0}
            >
              {t}
            </span>
          ))}
        </nav>
        <div className="hidden items-center gap-2 text-sm sm:flex" style={{ color: v.primaryText }}>
          <span>阅读历史</span>
          <span>·</span>
          <span>登录</span>
        </div>
      </header>

      {/* breadcrumb (.breadcrumb DNA: bg #cdf3eb border 1px #ccc radius 4px padding 8px 15px) */}
      <nav
        aria-label="面包屑导航"
        className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px]"
        style={{ background: v.surfaceAlt, border: `1px solid ${v.border}` }}
      >
        <span style={{ color: v.textMuted }}>»</span>
        <span style={{ color: v.text }}>首页</span>
        <span style={{ color: v.textMuted }}>/</span>
        <span style={{ color: v.textMuted }}>小说在线阅读</span>
        <span className="ml-auto flex items-center gap-1 text-[12px]" style={{ color: v.primary }}>
          <Search className="h-3.5 w-3.5" aria-hidden />
          搜索从这里开始
        </span>
      </nav>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
        {/* 左主栏 73% (.content-left: 热门推荐 + 最新更新) */}
        <div className="min-w-0 flex-1 space-y-4">
          <section data-clone-ggd-section="featured" aria-label="热门小说推荐">
            <GgdSecTitle main="热门小说" sub="推荐" />
            <div
              className="px-3"
              style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '4px', boxShadow: '0 1px 1px rgba(0,0,0,0.05)' }}
            >
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {featured.map((b) => <GgdBigCard key={b.id} book={b} />)}
              </div>
            </div>
          </section>

          <section data-clone-ggd-section="latest" aria-label="最新小说">
            <GgdSecTitle main="最新" sub="入库" />
            <div
              className="px-3 py-1"
              style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '4px' }}
            >
              <ul>
                {latest.map((b) => <GgdListRow key={b.id} book={b} />)}
              </ul>
            </div>
          </section>
        </div>

        {/* 右栏 25% (.content-right: 搜索 + 排行榜) */}
        <aside className="w-full shrink-0 lg:w-[260px] space-y-4">
          <section
            aria-label="搜索"
            className="rounded-md p-3"
            style={{ background: v.surface, border: `2px solid ${v.primary}`, borderRadius: '5px' }}
          >
            <div
              className="flex items-center gap-2 rounded-md px-3 py-2"
              style={{ background: v.surfaceAlt }}
              aria-hidden
            >
              <Search className="h-4 w-4" style={{ color: v.primary }} />
              <span className="text-sm" style={{ color: v.textMuted }}>搜索书名 / 作者…</span>
            </div>
          </section>

          <GgdRankList books={books} />

          <section
            className="px-4 py-3 text-xs leading-relaxed"
            style={{
              background: v.surfaceAlt,
              color: v.textMuted,
              border: `1px solid ${v.border}`,
              borderRadius: '4px',
            }}
            aria-label="站点公告"
          >
            <p className="mb-1 font-bold" style={{ color: v.text }}>{site.name} 公告</p>
            <p style={{ opacity: 0.9 }}>本站为广大书友提供免费小说在线阅读, 完结好书持续收录中。使用顶部搜索框可按书名 / 作者查找。</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
