// ============================================================
// 首页布局 · clone-shipsay (精仿·船说CMS demo.shipsay.com)
// 实测 CSS (stealthy 模式抓取 29KB, /static/shipsay/style.css 18.5KB):
//   body color #666, font-size 14px, bg #f4f4f4
//   body font-family: "微软雅黑","Microsoft Yahei", Arial, Tahoma, Verdana, sans-serif
//   a color #1a1a1a → hover #ed4259 (red-pink!)
//   .red #bf2c24 / .blue #4284ed / .orange #f0643a / .yellow #f0c53a / .purple #a091ff
//   .container max-width 1200px margin 0 auto
//   header > .container.head (logo + search form + header_right icons)
//   .navigation > nav.container > a (8 分类)
//   .side_commend .side_commend_width > p.title (i.fa + 主字) + ul.flex > li (book cards)
//     每个 li: .img_span > a > img + span(类别) + .w100 > a > h2 + p.indent + .li_bottom
//   aside .popular > p.title + ul.popular > li > a(book) + a.gray(author)
//   .section.flex > .sortvisit (按分类) ul (mixed div first item + li items)
// 结构: 顶 header (logo+搜索+icon nav) + nav (8 分类) + 大神小说 6 宽卡 + 热门小说 aside 12 链表 + 分类列表 8 卡
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate, formatWords } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk } from '../bits'
import { BookOpen, ChevronRight, Coffee, Flame, History, Home, Library, Search, ThumbsUp } from 'lucide-react'

function CloneSkeleton() {
  return (
    <div className="space-y-6">
      <Sk className="h-24 w-full" />
      <Sk className="h-9 w-full" />
      <div>
        <Sk className="mb-3 h-7 w-40" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Sk className="aspect-[3/4] w-full" />
              <Sk className="h-4 w-full" />
              <Sk className="h-3 w-3/5" />
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

/** 区块标题 (.title DNA: i.fa + 主字) */
function SsSecTitle({ icon, main }: { icon: React.ReactNode; main: string }) {
  const v = usePublic().theme.vars
  return (
    <p
      className="mb-3 flex items-center gap-2 border-b pb-2 text-[16px] font-bold leading-tight"
      style={{ borderColor: v.border, color: v.text }}
    >
      <span aria-hidden style={{ color: v.primary }}>{icon}</span>
      {main}
      <span className="ml-auto flex items-center gap-0.5 text-[11px] font-normal transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </p>
  )
}

/** 大神小说宽卡 (.side_commend li DNA: img_span + w100 h2 + p.indent) */
function SsWideCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group flex cursor-pointer flex-col gap-2"
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div className="relative">
        <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" style={{ borderRadius: '4px' }} />
        <span
          className="absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px]"
          style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}
        >
          {book.category} / {book.status === 'completed' ? '完结' : '连载'}
        </span>
      </div>
      <h2
        className="line-clamp-1 text-[15px] font-bold leading-5 transition-colors"
        style={{ color: v.text }}
        title={book.name}
      >
        {book.name}
      </h2>
      <p
        className="line-clamp-3 text-[12px] leading-[1.6]"
        style={{ color: v.textMuted, textIndent: '2em' }}
      >
        {book.intro || '暂无简介'}
      </p>
      <div className="flex items-center justify-between text-[11px]">
        <span className="truncate" style={{ color: v.textMuted }}>{book.author}</span>
        <div className="flex items-center gap-2">
          <em className="not-italic font-bold tabular-nums" style={{ color: v.accent }}>{formatWords(book.wordCount)}</em>
          <span style={{ color: v.textMuted }}>·</span>
          <span className="tabular-nums" style={{ color: v.textMuted }}>{book.updatedAt ? fmtDate(book.updatedAt) : '—'}</span>
        </div>
      </div>
    </article>
  )
}

/** 热门小说链表 (aside .popular li DNA: a(book) + a.gray(author)) */
function SsPopularRow({ book, idx }: { book: BookItem; idx: number }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  return (
    <li
      className="flex items-center gap-2 px-1 py-1.5 text-[13px] leading-5 transition-colors hover:opacity-80"
      style={{ borderBottom: `1px dashed ${v.border}` }}
    >
      <span
        className="w-5 shrink-0 text-center text-sm font-bold tabular-nums"
        style={{ color: idx < 3 ? v.accent : v.textMuted }}
      >
        {idx + 1}
      </span>
      <button
        type="button"
        onClick={() => navigate({ view: 'book', bookId: book.id })}
        className="min-w-0 flex-1 truncate text-left transition-colors hover:underline"
        style={{ color: v.primary }}
        title={book.name}
        aria-label={`查看《${book.name}》详情`}
      >
        {book.name}
      </button>
      <span className="shrink-0 text-[12px]" style={{ color: v.textMuted }}>{book.author}</span>
    </li>
  )
}

/** 分类列表 (.sortvisit DNA: 类别名 + ul 包含 1 大卡 + N 链表) */
function SsSortVisit({ title, books }: { title: string; books: BookItem[] }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  if (!books.length) return null
  const head = books[0]
  const tail = books.slice(1, 7)
  return (
    <section
      className="min-w-0 flex-1"
      style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '4px' }}
      aria-label={title}
    >
      <header
        className="px-3 py-2 text-[14px] font-bold"
        style={{ background: v.surfaceAlt, color: v.primary, borderBottom: `1px solid ${v.border}` }}
      >
        {title}
      </header>
      <div className="p-3">
        {/* 头部大卡 */}
        <article
          className="group mb-2 flex cursor-pointer gap-3 pb-2"
          style={{ borderBottom: `1px dashed ${v.border}` }}
          {...bookNavProps(navigate, head.id)}
          aria-label={`查看《${head.name}》详情`}
        >
          <div className="w-[60px] shrink-0">
            <BookCover name={head.name} cover={head.cover} className="aspect-[3/4] w-full" style={{ borderRadius: '3px' }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-1 text-[14px] font-bold leading-5 transition-colors" style={{ color: v.primary }} title={head.name}>
              {head.name}
            </h3>
            <p className="text-[11px]" style={{ color: v.textMuted }}>{head.author}</p>
            <p
              className="mt-1 line-clamp-3 text-[12px] leading-[1.5]"
              style={{ color: v.textMuted, textIndent: '2em' }}
            >
              {head.intro || '暂无简介'}
            </p>
          </div>
        </article>
        {/* 链表 */}
        <ul>
          {tail.map((b, i) => (
            <li
              key={b.id}
              className="flex items-center gap-1.5 px-1 py-1 text-[13px] leading-5"
              style={{ borderBottom: i < tail.length - 1 ? `1px dashed ${v.border}` : 'none' }}
            >
              <button
                type="button"
                onClick={() => navigate({ view: 'book', bookId: b.id })}
                className="min-w-0 flex-1 truncate text-left transition-colors hover:underline"
                style={{ color: v.text }}
                title={b.name}
                aria-label={`查看《${b.name}》详情`}
              >
                {b.name}
              </button>
              <span className="shrink-0 text-[11px]" style={{ color: v.textMuted }}>{b.author}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function HomeCloneShipsay({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-shipsay-home><CloneSkeleton /></div>
  if (!books.length) return null

  const featured = books.slice(0, 6)
  const popular = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 12)
  // 分 8 个 sortvisit, 每个 7 本 (1 大卡 + 6 链表)
  const sortBooks = books.slice(6)
  const sortVisits: Array<{ title: string; items: BookItem[] }> = [
    { title: '玄幻魔法', items: sortBooks.slice(0, 7) },
    { title: '武侠修真', items: sortBooks.slice(7, 14) },
    { title: '都市言情', items: sortBooks.slice(14, 21) },
    { title: '历史军事', items: sortBooks.slice(21, 28) },
    { title: '科幻灵异', items: sortBooks.slice(28, 35) },
    { title: '游戏竞技', items: sortBooks.slice(35, 42) },
  ].filter((s) => s.items.length > 0)

  return (
    <div data-clone-shipsay-home className="space-y-6">
      {/* 顶 header (.container.head DNA: logo + search + header_right icons) */}
      <header
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6"
        style={{ background: v.surface, borderBottom: `1px solid ${v.border}` }}
        aria-label="站点导航"
      >
        <div className="flex items-center gap-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-md"
            style={{ background: v.primary, color: v.primaryText }}
            aria-hidden
          >
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-bold leading-tight" style={{ color: v.text }}>{site.name}</p>
            <p className="text-[11px]" style={{ color: v.textMuted }}>{site.domain || 'demo.shipsay.com'}</p>
          </div>
        </div>
        <div
          className="flex flex-1 items-center gap-2 rounded-md px-3 py-1.5 sm:max-w-md"
          style={{ background: v.surfaceAlt }}
          aria-hidden
        >
          <Search className="h-4 w-4 opacity-70" style={{ color: v.textMuted }} />
          <span className="text-sm" style={{ color: v.textMuted }}>搜索书名 / 作者…</span>
        </div>
        <nav aria-label="图标导航" className="hidden items-center gap-4 text-xs md:flex" style={{ color: v.textMuted }}>
          <span className="flex flex-col items-center gap-0.5"><Home className="h-4 w-4" /><span>首页</span></span>
          <span className="flex flex-col items-center gap-0.5"><Library className="h-4 w-4" /><span>书库</span></span>
          <span className="flex flex-col items-center gap-0.5"><Coffee className="h-4 w-4" /><span>完本</span></span>
          <span className="flex flex-col items-center gap-0.5"><History className="h-4 w-4" /><span>足迹</span></span>
        </nav>
      </header>

      {/* 分类导航条 (.navigation > nav.container > a DNA) */}
      <nav
        aria-label="分类导航"
        className="flex flex-wrap items-center gap-1 px-2 py-2 text-sm"
        style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '4px' }}
      >
        {['首页', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生', '其他'].map((t, i) => (
          <span
            key={t}
            className="rounded px-3 py-1 text-[13px]"
            style={{
              background: i === 0 ? v.primary : 'transparent',
              color: i === 0 ? v.primaryText : v.text,
            }}
            aria-hidden={i !== 0}
          >
            {t}
          </span>
        ))}
      </nav>

      {/* 大神小说 section (.side_commend DNA: p.title + ul.flex > li 6 大卡) */}
      <section data-clone-shipsay-section="featured" aria-label="大神小说">
        <SsSecTitle icon={<ThumbsUp className="h-4 w-4" />} main="大神小说" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {featured.map((b) => <SsWideCard key={b.id} book={b} />)}
        </div>
      </section>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
        {/* 左主栏: 分类列表 sortvisit (3 个一组, 共 6 个) */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sortVisits.slice(0, 3).map((s) => (
              <SsSortVisit key={s.title} title={s.title} books={s.items} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sortVisits.slice(3, 6).map((s) => (
              <SsSortVisit key={s.title} title={s.title} books={s.items} />
            ))}
          </div>
        </div>

        {/* 右栏: 热门小说链表 */}
        <aside className="w-full shrink-0 lg:w-[260px]">
          <section
            className="p-3"
            style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '4px' }}
            aria-label="热门小说"
          >
            <p
              className="mb-2 flex items-center gap-2 border-b pb-2 text-[15px] font-bold leading-tight"
              style={{ borderColor: v.border, color: v.text }}
            >
              <Flame className="h-4 w-4" style={{ color: v.accent }} aria-hidden />
              热门小说
            </p>
            <ul>
              {popular.map((b, i) => <SsPopularRow key={b.id} book={b} idx={i} />)}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
