// ============================================================
// 首页布局 · clone-x2552 (精仿·爱文学 x2552.com)
// 实测 CSS (x2552.com 直连 200, GBK 编码 HTML, /heibing/css/style.css 10.7KB):
//   body color #666 bg transparent font 12px/120% 微软雅黑
//   a color #2f468f (蓝紫) → hover #ff6600 (橙)
//   .main width 960px margin 0 auto clear both (老式 960px 框架)
//   .m_head height 60px (logo 180px + h_body 780px)
//   .m_menu height 40px font 14px weight bold line-height 39px (12 个分类导航)
//   .board margin-top 8px height 263px (滑动书卡 carousel)
//     .board dd img 120x150 border 1px #E4E4E4 padding 5px
//   .block border 1px #E4E4E4 margin-top 8px (区块容器)
//   .blocktitle height 40px line-height 40px font 14px (with bg pattern sprite)
//   .update li border-bottom 1px dotted #E4E4E4 padding 0 10px text-align right font 12px
//     .update p float left text-align left (书名+章节)
//   .ultop / .ulcenter / .ulitem li border-bottom 1px dotted #F2F2F2 padding 0 3px list-style decimal inside
//   table border 1px #E4E4E4 margin 10px width 98%
//   td,th border-bottom 1px dotted #E4E4E4 padding 0 3px
// 结构: 顶 m_head (logo + search) + m_menu (12 分类) + 3 列布局 (centeri 760 / left 190 / right 190)
//   左: 最新更新表 + 排行榜 / 中: 大卡推荐 + 章节更新 / 右: 完结 + 热门
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { ChevronRight, Flame, Library, Search, Star } from 'lucide-react'

function CloneSkeleton() {
  return (
    <div className="space-y-4">
      <Sk className="h-16 w-full" />
      <Sk className="h-10 w-full" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div className="col-span-1 space-y-3">
          <Sk className="h-44 w-full" />
          <Sk className="h-44 w-full" />
        </div>
        <div className="col-span-2 space-y-3">
          <Sk className="h-44 w-full" />
          <Sk className="h-44 w-full" />
        </div>
        <div className="col-span-1 space-y-3">
          <Sk className="h-44 w-full" />
          <Sk className="h-44 w-full" />
        </div>
      </div>
    </div>
  )
}

/** 区块标题 (.blocktitle DNA: 高度 40px font 14px + bg pattern) */
function X2552SecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <div
      className="mb-2 flex items-center justify-between px-3 py-2 text-[14px] font-bold leading-tight"
      style={{ background: v.surfaceAlt, borderBottom: `1px solid ${v.border}`, color: v.text }}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden style={{ color: v.primary }}>■</span>
        {main}
        <em className="not-italic text-[12px] font-normal" style={{ color: v.textMuted }}>{sub}</em>
      </span>
      <span className="flex items-center gap-0.5 text-[11px] font-normal transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/** 大卡 (.block dd DNA: 120x150 封面 + 标题 + 简介) */
function X2552BigCard({ book, idx }: { book: BookItem; idx: number }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group flex cursor-pointer gap-3 p-2.5"
      style={{ background: v.surface, border: `1px solid ${v.border}` }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div className="w-[80px] shrink-0 sm:w-[96px]">
        <BookCover
          name={book.name}
          cover={book.cover}
          className="aspect-[4/5] w-full"
          style={{ border: '1px solid #E4E4E4', padding: 2, background: '#fff', borderRadius: 0 }}
        />
      </div>
      <dl className="min-w-0 flex-1 py-0.5">
        <dt
          className="flex items-baseline gap-2 border-b pb-1 text-[14px] font-bold leading-5"
          style={{ borderColor: v.border }}
        >
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
            style={{ background: v.primary, color: v.primaryText }}
            aria-hidden
          >
            No.{idx + 1}
          </span>
          <span className="truncate" style={{ color: v.primary }} title={book.name}>{book.name}</span>
        </dt>
        <dd
          className="mt-1 line-clamp-3 text-[12px] leading-[1.6]"
          style={{ color: v.textMuted, textIndent: '2em' }}
        >
          {book.intro || '暂无简介'}
        </dd>
        <dd className="mt-1.5 flex items-center gap-2 text-[11px]" style={{ color: v.textMuted }}>
          <span>{book.author}</span>
          <span>·</span>
          <StatusBadge status={book.status} small />
          <span className="ml-auto">[{book.category}]</span>
        </dd>
      </dl>
    </article>
  )
}

/** 章节更新行 (.update li DNA: 时间 + 章节名 + 书名) */
function X2552UpdateRow({ book, idx }: { book: BookItem; idx: number }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  return (
    <li
      className="flex items-center gap-2 px-2 py-1.5 text-[12px] leading-5"
      style={{ borderBottom: `1px dotted ${v.border}` }}
    >
      <span className="shrink-0 text-[11px] tabular-nums" style={{ color: v.textMuted }}>
        {String(idx + 1).padStart(2, '0')}.
      </span>
      <button
        type="button"
        onClick={() => navigate({ view: 'home' })}
        className="hidden shrink-0 rounded px-1.5 py-0.5 text-[11px] transition-opacity hover:opacity-80 sm:block"
        style={{ background: v.surfaceAlt, color: v.textMuted }}
        aria-label={`分类 ${book.category}`}
      >
        [{book.category}]
      </button>
      <button
        type="button"
        onClick={() => navigate({ view: 'book', bookId: book.id })}
        className="min-w-0 flex-1 truncate text-left transition-colors hover:underline"
        style={{ color: v.primary }}
        title={book.name}
        aria-label={`查看《${book.name}》详情`}
      >
        <span className="font-medium">{book.name}</span>
        <span className="ml-1.5 text-[11px]" style={{ color: v.textMuted }}>{book.latestChapter || '暂无章节'}</span>
      </button>
      <span className="hidden shrink-0 text-[11px] tabular-nums sm:block" style={{ color: v.textMuted }}>
        {book.updatedAt ? fmtDate(book.updatedAt) : '—'}
      </span>
    </li>
  )
}

/** 排行榜 (.ultop li DNA: 序号 + 书名) */
function X2552RankList({ books, title }: { books: BookItem[]; title: string }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const ranked = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 10)
  if (!ranked.length) return null
  return (
    <section
      className="overflow-hidden"
      style={{ background: v.surface, border: `1px solid ${v.border}` }}
      aria-label={title}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2 text-[14px] font-bold leading-tight"
        style={{ background: v.surfaceAlt, borderBottom: `1px solid ${v.border}`, color: v.text }}
      >
        <Flame className="h-3.5 w-3.5" style={{ color: v.accent }} aria-hidden />
        {title}
      </div>
      <ol className="px-1.5 py-1">
        {ranked.map((b, i) => (
          <li
            key={b.id}
            className="flex items-center gap-2 px-1 py-1.5 text-[13px] leading-5"
            style={{ borderBottom: i < ranked.length - 1 ? `1px dotted ${v.border}` : 'none' }}
          >
            <span
              className="w-4 shrink-0 text-center text-[12px] font-bold tabular-nums"
              style={{ color: i < 3 ? v.accent : v.textMuted }}
            >
              {i + 1}
            </span>
            <button
              type="button"
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              className="min-w-0 flex-1 truncate text-left transition-colors hover:underline"
              style={{ color: v.primary }}
              title={b.name}
              aria-label={`查看《${b.name}》详情`}
            >
              {b.name}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function HomeCloneX2552({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-x2552-home><CloneSkeleton /></div>
  if (!books.length) return null

  const featured = books.slice(0, 4)
  const updates = books.slice(4, 24)
  const ranked = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0))
  const completed = books.filter((b) => b.status === 'completed').slice(0, 8)
  const rankedToShow = completed.length >= 4 ? completed : ranked.slice(8, 16)

  return (
    <div data-clone-x2552-home className="mx-auto max-w-[960px] space-y-4">
      {/* 顶 m_head (logo + search) DNA: width 960, height 60, .h_logo 180 + .h_body 780 */}
      <header
        className="flex flex-wrap items-center gap-4 px-4 py-3"
        style={{ background: v.surface, borderBottom: `2px solid ${v.primary}` }}
        aria-label="站点导航"
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md text-base font-black"
            style={{ background: `linear-gradient(135deg, ${v.primary} 0%, ${v.accent} 100%)`, color: v.primaryText }}
            aria-hidden
          >
            文
          </div>
          <div>
            <p className="text-base font-bold leading-tight" style={{ color: v.text }}>{site.name}</p>
            <p className="text-[11px]" style={{ color: v.textMuted }}>爱文学 · 全本免费小说在线阅读</p>
          </div>
        </div>
        <div
          className="flex flex-1 items-center gap-2 rounded-md border px-3 py-1.5"
          style={{ background: v.surfaceAlt, borderColor: v.border }}
          aria-hidden
        >
          <Search className="h-4 w-4 opacity-70" style={{ color: v.primary }} />
          <span className="text-sm" style={{ color: v.textMuted }}>搜索书名 / 作者…</span>
        </div>
        <div className="hidden items-center gap-3 text-[12px] sm:flex" style={{ color: v.textMuted }}>
          <span>设为首页</span>
          <span>·</span>
          <span>加入收藏</span>
        </div>
      </header>

      {/* m_menu (12 分类 nav DNA: height 40, font 14 bold) */}
      <nav
        aria-label="分类导航"
        className="flex flex-wrap items-center gap-1 px-2 py-2 text-sm"
        style={{ background: v.primary, color: v.primaryText }}
      >
        {['首页', '玄幻魔法', '武侠修真', '都市言情', '历史军事', '侦探推理', '趣味动漫', '科幻小说', '僵尸小说', '恐怖小说', '同人', '全本'].map((t, i) => (
          <span
            key={t}
            className="px-2 py-1 text-[13px] font-bold"
            style={{ color: v.primaryText, opacity: i === 0 ? 1 : 0.95 }}
            aria-hidden={i !== 0}
          >
            {t}
          </span>
        ))}
      </nav>

      {/* 3 列布局 (.main > #left 190 + #centeri 760 + #right 190) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[190px_minmax(0,1fr)_190px]">
        {/* 左栏: 最新更新表 + 排行榜 */}
        <aside className="space-y-3">
          <section data-clone-x2552-section="left-latest" aria-label="最近更新">
            <X2552SecTitle main="最近" sub="更新" />
            <div style={{ background: v.surface, border: `1px solid ${v.border}` }}>
              <ul className="py-1">
                {updates.slice(0, 10).map((b, i) => <X2552UpdateRow key={b.id} book={b} idx={i} />)}
              </ul>
            </div>
          </section>
          <X2552RankList books={books} title="点击排行" />
        </aside>

        {/* 中栏: 大卡推荐 + 章节更新表 */}
        <div className="min-w-0 space-y-3">
          <section data-clone-x2552-section="featured" aria-label="精品推荐">
            <X2552SecTitle main="精品" sub="推荐" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {featured.map((b, i) => <X2552BigCard key={b.id} book={b} idx={i} />)}
            </div>
          </section>

          <section data-clone-x2552-section="updates" aria-label="章节更新">
            <X2552SecTitle main="章节" sub="更新" />
            <div style={{ background: v.surface, border: `1px solid ${v.border}` }}>
              <ul className="py-1">
                {updates.map((b, i) => <X2552UpdateRow key={b.id} book={b} idx={i} />)}
              </ul>
            </div>
          </section>
        </div>

        {/* 右栏: 完结榜单 + 入库新书 */}
        <aside className="space-y-3">
          <X2552RankList books={rankedToShow} title="完结精选" />
          <section
            aria-label="入库新书"
            style={{ background: v.surface, border: `1px solid ${v.border}` }}
          >
            <div
              className="flex items-center gap-1.5 px-3 py-2 text-[14px] font-bold leading-tight"
              style={{ background: v.surfaceAlt, borderBottom: `1px solid ${v.border}`, color: v.text }}
            >
              <Star className="h-3.5 w-3.5" style={{ color: v.accent }} aria-hidden />
              入库新书
            </div>
            <ul className="px-2 py-1">
              {updates.slice(10, 18).map((b, i) => (
                <li
                  key={b.id}
                  className="flex items-center gap-2 px-1 py-1.5 text-[12px] leading-5"
                  style={{ borderBottom: i < 6 ? `1px dotted ${v.border}` : 'none' }}
                >
                  <span className="w-3 shrink-0 text-[11px] font-bold tabular-nums" style={{ color: v.textMuted }}>{i + 1}.</span>
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'book', bookId: b.id })}
                    className="min-w-0 flex-1 truncate text-left transition-colors hover:underline"
                    style={{ color: v.primary }}
                    title={b.name}
                    aria-label={`查看《${b.name}》详情`}
                  >
                    {b.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {/* 站点底部信息条 */}
      <section
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12px]"
        style={{ background: v.surface, border: `1px solid ${v.border}`, color: v.textMuted }}
        aria-label="站点信息"
      >
        <span className="flex items-center gap-1.5">
          <Library className="h-3.5 w-3.5" style={{ color: v.primary }} aria-hidden />
          {site.name}
        </span>
        <span className="flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5" style={{ color: v.accent }} aria-hidden />
          全本免费小说在线阅读
        </span>
        <span className="tabular-nums">共 {books.length} 本</span>
      </section>
    </div>
  )
}
