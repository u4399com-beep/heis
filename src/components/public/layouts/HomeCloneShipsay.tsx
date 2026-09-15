// ============================================================
// 首页布局 · clone-shipsay (精仿·船说CMS demo.shipsay.com)
// 实测 probe-html2/probe-shipsay.{html,css} 抓取完整 HTML+CSS (probe-shipsay.html 377 行 + probe-shipsay.css 18.5KB)
// 实测 CSS 关键变量 (从 /static/shipsay/style.css 提取):
//   body { color: #666; font-size: 14px; background: #f4f4f4; }
//   body font-family: "微软雅黑", "Microsoft Yahei", Arial, Tahoma, Verdana, sans-serif
//   a { color: #1a1a1a; text-decoration: none; }
//   a:hover, .hot, .act * { color: #ed4259; }   /* hover 红色 */
//   .fullflag { color: #fff; background: #ed4259; border: 1px solid #ed4259; }   /* ★红徽章 */
//   .red { color: #bf2c24; } / .blue { color: #4284ed; } / .orange { color: #f0643a; }
//   .dark { color: #33373d; } / .green { color: green; } / .yellow { color: #f0c53a; }
//   .purple { color: #a091ff; } / .gray { color: #666; } / .w_gray { color: #969ba3; }
//   .intro { text-indent: 2em; line-height: 1.8em; min-height: 50px; margin-top: 1em; }
//   .container { max-width: 960px; margin: 0 auto; display: flex; flex-flow: wrap; }
//   .section { width: 100%; margin: 10px 0 0; padding: 10px; background: #fff; }
//   .navigation bg #3e3d43 / nav a color #fbfbfb height 41px line-height 41px padding 0 20px
//   nav a:hover { color: #fbfbfb; border-top: 2px solid #ed4259; background: #252428; line-height: 37px; }
//   .side_commend bg #ffffff, padding 10px 10px 5px, width 700px
//   .side_commend li width 49%, margin 10px 6px 18px 0, line-height 1.7em
//   .side_commend img 100x133, hover transform scale(1.1)
//   .img_span span (overlay): position absolute, top 108px, bg rgba(0,0,0,.4), color #fff, w 100px h 25px
//   .side_commend h2 font-size 1.15em, height 24px, line-height 24px
//   .side_commend .li_bottom flex, align-items center, em border 1px solid #ccc padding 0 2px font-size 10px
//   aside width 250px, margin-left 10px, bg #fff, padding 10px 10px 5px
//   .popular li flex space-between, height 41px, border-bottom 1px dotted #e6e6e6
//   .sortvisit width 312px, margin-top 5px; > a color #555 weight 700 border-bottom 1px solid #ddd
//   .sortvisit > ul > div: flex, width 100%, margin-bottom 10px, height 85px, overflow hidden
//   .sortvisit > ul > div img 60x80, box-shadow 0 1px 5px rgba(0,0,0,.35)
//   .sortvisit ul li width 50%, height 38px, line-height 38px, border-bottom 1px dashed #ccc
//   .lastupdate width 700px, bg #fff, padding 10px
//   .lastupdate li flex, height 41px, border-bottom 1px dotted #e6e6e6
//   .lastupdate li *:nth-child(1) width 9% / (2) 25% / (3) 41% / (4) 25% text-align right
//   #footer bg #3e3d43, color #fbfbfb
//   radius: 3px (实测 .side_commend li 等 3px 圆角)
// HTML 结构 (从抓到的首页 HTML 提取):
//   header > .container.head (logo + form.search + .header_right icons)
//   .navigation > nav.container > a (8 分类: 首页/玄幻/武侠/都市/历史/科幻/游戏/女生/其他)
//   .container > .side_commend.side_commend_width (700px) > p.title + ul.flex (6 大神小说宽卡)
//     li: .img_span > a > img + span(category/status) + .w100 > a > h2 + p.indent + .li_bottom
//   .container > aside (250px) > .popular > p.title + ul.popular > li (book + author.gray)
//   .container > .section.flex > 8 .sortvisit (312px each, 3 per row) > a (cat name) + ul (1 大卡 + 12 链表)
//   .container > .lastupdate (700px) > p.title + ul.odd (最新章节 4 列: 类别/书名/章节/作者+时间)
//   .container > .section.link (友情链接)
//   #footer > footer.container (站点信息)
// 结构: 顶 header (logo+搜索+icon nav) + nav (深灰底 8 分类) + 大神小说 6 宽卡 + 热门小说 aside 链表
//   + 分类列表 8 卡 (sortvisit) + 最新章节 lastupdate + 友情链接 + footer
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate, formatWords } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk } from '../bits'
import {
  BookOpen,
  ChevronRight,
  Coffee,
  Flame,
  History,
  Home as HomeIcon,
  Library,
  Link as LinkIcon,
  Search,
  ThumbsUp,
} from 'lucide-react'

/** 船说CMS 容器宽度 (实测 .container max-width 960px) */
const SS_CONTAINER = 'mx-auto w-full max-w-[960px]'

function CloneSkeleton() {
  return (
    <div className="space-y-5">
      {/* header */}
      <Sk className="h-20 w-full" />
      {/* nav 深灰条 */}
      <Sk className="h-11 w-full" />
      {/* 大神小说 + aside 热门 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_250px]">
        <div className="space-y-3">
          <Sk className="h-7 w-40" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-2">
                <Sk className="aspect-[3/4] w-20 shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <Sk className="h-4 w-3/4" />
                  <Sk className="h-12 w-full" />
                  <Sk className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <Sk className="h-72 w-full" />
      </div>
      {/* sortvisit 分类列表 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Sk key={i} className="h-48 w-full" />
        ))}
      </div>
      {/* lastupdate + aside */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_250px]">
        <Sk className="h-64 w-full" />
        <Sk className="h-64 w-full" />
      </div>
    </div>
  )
}

/** 船说CMS — header (.container.head DNA: logo + 搜索 + 图标菜单)
 *  实测: padding 16px 5px, justify-content space-between, align-items center
 *  #logo span font-size 1.5em color #3e3d43 / #logo p color #bf2c24
 *  form: 36px height, 300px wide, input border 1px #e6e6e6 + #search_btn bg #bf2c24
 */
function SsHeader() {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <header
      data-clone-shipsay-header
      className={`${SS_CONTAINER} flex flex-wrap items-center justify-between gap-3 px-1 py-3 sm:px-1.5`}
      aria-label="站点头部"
    >
      {/* logo: 站名 + 域名 (船说CMS DNA: 站名 #3e3d43 + 域名 #bf2c24) */}
      <button
        type="button"
        onClick={() => navigate({ view: 'home' })}
        className="flex cursor-pointer flex-col items-center text-center sm:items-start"
        aria-label={`${site.name} 首页`}
      >
        <span className="text-2xl font-bold tracking-widest" style={{ color: v.text }}>
          {site.name}
        </span>
        <span className="text-xs font-bold" style={{ color: v.accent }}>
          {site.domain || 'shipsay.com'}
        </span>
      </button>

      {/* 搜索框 (实测: 300px wide, 36px high, 红色按钮 #bf2c24) */}
      <div
        className="flex h-9 flex-1 items-center overflow-hidden sm:max-w-[300px]"
        style={{ background: v.surface }}
        aria-hidden
      >
        <input
          type="text"
          disabled
          placeholder="搜索书名 / 作者…"
          className="h-full flex-1 border-r-0 px-3 text-sm outline-none"
          style={{
            background: v.surface,
            color: v.text,
            border: `1px solid ${v.border}`,
            borderRadius: 0,
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          className="flex h-full items-center px-3 text-sm font-medium"
          style={{ background: v.accent, color: '#fbfbfb' }}
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* 图标菜单 (.header_right DNA: 首页隐藏, 书库/完本/足迹) */}
      <nav
        aria-label="站点快捷导航"
        className="hidden items-end gap-4 text-xs md:flex"
        style={{ color: v.text }}
      >
        <span className="flex flex-col items-center gap-1">
          <Library className="h-4 w-4" aria-hidden />
          <span>书库</span>
        </span>
        <span className="flex flex-col items-center gap-1">
          <Coffee className="h-4 w-4" aria-hidden />
          <span>完本</span>
        </span>
        <span className="flex flex-col items-center gap-1">
          <History className="h-4 w-4" aria-hidden />
          <span>足迹</span>
        </span>
      </nav>
    </header>
  )
}

/** 船说CMS — .navigation > nav.container (深灰底 #3e3d43 + 8 分类, hover 红色 border-top)
 *  实测 #3e3d43 是 shipsay 站点固定的导航深灰底, 不映射到主题 vars (主题 vars 没有"深灰"槽位) */
function SsNav() {
  const v = usePublic().theme.vars
  // 实测 8 分类: 首页 / 玄幻 / 武侠 / 都市 / 历史 / 科幻 / 游戏 / 女生 / 其他
  const cats = ['首页', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生', '其他']
  return (
    <div
      data-clone-shipsay-navigation
      className={`${SS_CONTAINER} flex flex-wrap items-stretch`}
      style={{ background: '#3e3d43', borderTop: `2px solid ${v.primary}` }}
      aria-label="分类导航"
    >
      {cats.map((t, i) => (
        <span
          key={t}
          className="relative flex items-center px-5 text-[15px]"
          style={{
            color: '#fbfbfb',
            height: 41,
            borderTop: i === 0 ? '2px solid #ed4259' : '2px solid transparent',
            background: i === 0 ? '#252428' : 'transparent',
          }}
          aria-hidden={i !== 0}
        >
          {t}
        </span>
      ))}
    </div>
  )
}

/** 船说CMS — 区块标题 (.title DNA: flex, weight 700, color #555, border-bottom 1px solid #ddd, padding-bottom 8px) */
function SsTitle({ icon, main }: { icon: React.ReactNode; main: string }) {
  const v = usePublic().theme.vars
  return (
    <p
      className="flex items-center gap-2 border-b pb-2 text-[15px] font-bold leading-tight"
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

/** 船说CMS — .fullflag 红徽章 (★核心 DNA: #ed4259 红底白字 1px 边) */
function SsFullFlag({ status }: { status?: string | null }) {
  const v = usePublic().theme.vars
  return (
    <span
      className="inline-block px-1.5 py-0.5 text-[10px] font-medium leading-tight"
      style={{
        color: v.primaryText,
        background: v.primary,
        border: `1px solid ${v.primary}`,
      }}
    >
      {status === 'completed' ? '已完结' : status === 'ongoing' ? '连载中' : '未知'}
    </span>
  )
}

/**
 * 大神小说宽卡 (.side_commend li DNA: img_span + w100 h2 + p.indent + li_bottom)
 * 实测: width 49%, margin 10px 6px 18px 0, line-height 1.7em
 *   .img_span > a > img (100x133) + span overlay (bg rgba(0,0,0,.4) bottom 25px)
 *   .w100 > a > h2 (1.15em 24px height) + p.indent (text-indent 2em, 3 lines clamp)
 *   .li_bottom: 作者链 + em 字数 (orange) + em 时间 (blue)
 */
function SsWideCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      data-clone-shipsay-widecard
      className="flex w-full cursor-pointer gap-3 py-2"
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      {/* .img_span: img + overlay span (类别 / 状态) */}
      <div className="relative w-[100px] shrink-0 overflow-hidden">
        <BookCover
          name={book.name}
          cover={book.cover}
          className="h-[133px] w-full"
          style={{ borderRadius: 0 }}
        />
        <span
          className="absolute bottom-0 left-0 flex h-6 w-full items-center justify-center text-[11px]"
          style={{ background: 'rgba(0,0,0,.4)', color: '#fff' }}
        >
          {book.category} / {book.status === 'completed' ? '完结' : '连载'}
        </span>
      </div>
      {/* .w100: h2 + p.indent + .li_bottom */}
      <div className="min-w-0 flex-1">
        <h2
          className="line-clamp-1 text-[15px] font-bold leading-6 transition-colors"
          style={{ color: v.text }}
          title={book.name}
        >
          {book.name}
        </h2>
        <p
          className="mt-1 line-clamp-3 text-[12px] leading-[1.7]"
          style={{ color: v.textMuted, textIndent: '2em' }}
        >
          {book.intro || '暂无简介'}
        </p>
        {/* .li_bottom: 作者 + em 字数 + em 时间 */}
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          <span className="flex items-center gap-1 truncate" style={{ color: v.textMuted }}>
            <BookOpen className="h-3 w-3" style={{ color: v.primary }} aria-hidden />
            {book.author}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <em
              className="not-italic tabular-nums"
              style={{ color: '#f0643a', border: `1px solid ${v.border}`, padding: '0 4px', fontSize: 10 }}
            >
              {formatWords(book.wordCount)}
            </em>
            <em
              className="not-italic tabular-nums"
              style={{ color: '#4284ed', border: `1px solid ${v.border}`, padding: '0 4px', fontSize: 10 }}
            >
              {book.updatedAt ? fmtDate(book.updatedAt).slice(5) : '—'}
            </em>
          </span>
        </div>
      </div>
    </article>
  )
}

/**
 * 热门小说链表 (aside .popular li DNA: flex space-between, height 41px, border-bottom 1px dotted #e6e6e6)
 *   li *:first-child (book name + author.gray) line-height 41px font-size 1.1em
 */
function SsPopularRow({ book, idx }: { book: BookItem; idx: number }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  return (
    <li
      className="flex items-center justify-between gap-2 px-1 transition-colors hover:bg-[rgba(237,66,89,0.06)]"
      style={{ borderBottom: `1px dotted ${v.border}`, height: 41 }}
    >
      <button
        type="button"
        onClick={() => navigate({ view: 'book', bookId: book.id })}
        className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left text-[14px] transition-colors hover:underline"
        style={{ color: v.text }}
        title={book.name}
        aria-label={`查看《${book.name}》详情`}
      >
        <span
          className="w-5 shrink-0 text-center text-[13px] font-bold tabular-nums"
          style={{ color: idx < 3 ? v.accent : v.textMuted }}
        >
          {idx + 1}
        </span>
        <span className="truncate">{book.name}</span>
      </button>
      <span className="shrink-0 text-[12px]" style={{ color: v.textMuted }}>{book.author}</span>
    </li>
  )
}

/**
 * 分类列表 (.sortvisit DNA: 312px wide, > a 类别名 + ul (1 div 大卡 + 12 li 链表))
 * 实测: width 312px, margin-top 5px
 *   .sortvisit > a: color #555 weight 700, padding 0 0 8px 8px, border-bottom 1px solid #ddd
 *   .sortvisit > ul: flex wrap padding 10px justify-content space-between
 *   .sortvisit > ul > div: flex width 100% height 85px overflow hidden (1 大卡)
 *     img 60x80, box-shadow 0 1px 5px rgba(0,0,0,.35)
 *   .sortvisit ul li: width 50%, height 38px, line-height 38px, border-bottom 1px dashed #ccc
 */
function SsSortVisit({ title, books }: { title: string; books: BookItem[] }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  if (!books.length) return null
  const head = books[0]
  const tail = books.slice(1, 13)
  return (
    <section
      data-clone-shipsay-sortvisit
      className="mt-1.5 w-full"
      style={{ background: v.surface, border: `1px solid ${v.border}` }}
      aria-label={title}
    >
      {/* 类别标题 (.sortvisit > a DNA: weight 700 + border-bottom 1px #ddd) */}
      <a
        className="block cursor-pointer border-b px-2 py-2 text-[15px] font-bold transition-colors hover:text-[#ed4259]"
        style={{ borderColor: v.border, color: v.text }}
        aria-hidden
      >
        {title}
      </a>
      <div className="px-2 py-2">
        {/* 头部大卡 (.sortvisit > ul > div DNA: flex, height 85px, img 60x80) */}
        <article
          className="mb-2.5 flex cursor-pointer gap-3 pb-2"
          style={{ borderBottom: `1px dashed ${v.border}`, height: 90, overflow: 'hidden' }}
          {...bookNavProps(navigate, head.id)}
          aria-label={`查看《${head.name}》详情`}
        >
          <div className="w-[60px] shrink-0">
            <BookCover
              name={head.name}
              cover={head.cover}
              className="h-[80px] w-full"
              style={{ borderRadius: 0, boxShadow: '0 1px 5px rgba(0,0,0,.35)' }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="line-clamp-1 text-[14px] font-bold leading-5 transition-colors hover:text-[#ed4259]"
              style={{ color: v.text }}
              title={head.name}
            >
              {head.name}
            </h3>
            <p className="text-[11px]" style={{ color: v.textMuted }}>{head.author}</p>
            <p
              className="mt-1 line-clamp-3 text-[11px] leading-[1.5]"
              style={{ color: v.textMuted, textIndent: '2em' }}
            >
              {head.intro || '暂无简介'}
            </p>
          </div>
        </article>

        {/* 链表 (.sortvisit ul li DNA: width 50%, height 38px, line-height 38px, border-bottom 1px dashed #ccc) */}
        <ul className="flex flex-wrap justify-between">
          {tail.map((b) => (
            <li
              key={b.id}
              className="flex min-w-0 w-1/2 items-center gap-1 px-1"
              style={{ height: 38, borderBottom: `1px dashed ${v.border}` }}
            >
              <button
                type="button"
                onClick={() => navigate({ view: 'book', bookId: b.id })}
                className="min-w-0 flex-1 truncate text-left text-[13px] transition-colors hover:text-[#ed4259]"
                style={{ color: v.text }}
                title={b.name}
                aria-label={`查看《${b.name}》详情`}
              >
                {b.name}
              </button>
              <i className="not-italic shrink-0 text-[11px]" style={{ color: v.textMuted }}>{b.author}</i>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * 最新章节列表 (.lastupdate DNA: width 700px, bg #fff, padding 10px)
 *   li flex height 41px border-bottom 1px dotted #e6e6e6
 *   li *:nth-child(1) width 9% (category)
 *   li *:nth-child(2) width 25% (book name)
 *   li *:nth-child(3) width 41% (chapter)
 *   li *:nth-child(4) width 25%, text-align right (author + time)
 */
function SsLastUpdate({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  if (!books.length) return null
  return (
    <section
      data-clone-shipsay-lastupdate
      className="w-full px-2.5 py-2.5"
      style={{ background: v.surface, border: `1px solid ${v.border}` }}
      aria-label="最新章节"
    >
      <SsTitle icon={<Flame className="h-4 w-4" />} main="最新章节" />
      <ul className="mt-2">
        {books.map((b) => (
          <li
            key={b.id}
            className="flex items-center text-[13px]"
            style={{ height: 41, borderBottom: `1px dotted ${v.border}` }}
          >
            {/* 9% 类别 */}
            <span className="w-[12%] shrink-0 truncate text-center text-[12px]" style={{ color: v.textMuted }}>
              「{b.category}」
            </span>
            {/* 25% 书名 */}
            <button
              type="button"
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              className="w-[24%] shrink-0 truncate px-1 text-left text-[14px] transition-colors hover:text-[#ed4259]"
              style={{ color: v.text }}
              title={b.name}
              aria-label={`查看《${b.name}》详情`}
            >
              {b.name}
            </button>
            {/* 41% 章节 */}
            <button
              type="button"
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              className="min-w-0 w-[40%] shrink-0 truncate px-1 text-left text-[12px] transition-colors hover:text-[#ed4259]"
              style={{ color: v.textMuted }}
              title={b.latestChapter || '暂无章节'}
              aria-label={`阅读《${b.name}》最新章节`}
            >
              {b.latestChapter || '暂无章节'}
            </button>
            {/* 25% 作者 + 时间 */}
            <span className="ml-auto w-[24%] shrink-0 truncate text-right text-[12px]" style={{ color: v.textMuted }}>
              {b.author} &nbsp; {b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function HomeCloneShipsay({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-shipsay-home><CloneSkeleton /></div>
  if (!books.length) return null

  // 大神小说 6 宽卡
  const featured = books.slice(0, 6)
  // 热门小说链表 12 (按字数倒序)
  const popular = [...books]
    .sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0))
    .slice(0, 12)
  // 最新章节列表 20
  const latest = [...books]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 20)
  // 8 个 sortvisit 分类, 每个 13 本 (1 大卡 + 12 链表)
  const sortBooks = books.slice(6)
  const sortVisits: Array<{ title: string; items: BookItem[] }> = [
    { title: '玄幻魔法', items: sortBooks.slice(0, 13) },
    { title: '武侠修真', items: sortBooks.slice(13, 26) },
    { title: '都市言情', items: sortBooks.slice(26, 39) },
    { title: '历史军事', items: sortBooks.slice(39, 52) },
    { title: '科幻灵异', items: sortBooks.slice(52, 65) },
    { title: '游戏竞技', items: sortBooks.slice(65, 78) },
  ].filter((s) => s.items.length > 0)

  return (
    <div data-clone-shipsay-home className="space-y-2.5">
      {/* 顶 header (.container.head DNA: logo + 搜索 + 图标 nav) */}
      <SsHeader />

      {/* nav (.navigation > nav.container DNA: 深灰底 + 8 分类) */}
      <SsNav />

      {/* 第一区: .side_commend 大神小说 (700px) + aside 热门小说 (250px) */}
      <div className={`${SS_CONTAINER} flex flex-col gap-2.5 lg:flex-row lg:gap-2.5`}>
        {/* .side_commend.side_commend_width (700px) */}
        <section
          data-clone-shipsay-section="featured"
          className="min-w-0 flex-1 px-2.5 py-2.5"
          style={{ background: v.surface, border: `1px solid ${v.border}` }}
          aria-label="大神小说"
        >
          <SsTitle icon={<ThumbsUp className="h-4 w-4" />} main="大神小说" />
          <div className="mt-2 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            {featured.map((b) => <SsWideCard key={b.id} book={b} />)}
          </div>
        </section>

        {/* aside (250px) — .popular 热门小说 */}
        <aside
          className="w-full shrink-0 px-2.5 py-2.5 lg:w-[250px]"
          style={{ background: v.surface, border: `1px solid ${v.border}` }}
          aria-label="热门小说"
        >
          <SsTitle icon={<Flame className="h-4 w-4" />} main="热门小说" />
          <ul className="mt-1">
            {popular.map((b, i) => <SsPopularRow key={b.id} book={b} idx={i} />)}
          </ul>
        </aside>
      </div>

      {/* 第二区: .section.flex > 8 .sortvisit (312px each, 3 per row) */}
      <div className={`${SS_CONTAINER} flex flex-wrap gap-2.5`}>
        {sortVisits.map((s) => (
          <div key={s.title} className="w-full sm:w-[calc(50%-0.625rem)] lg:w-[312px]">
            <SsSortVisit title={s.title} books={s.items} />
          </div>
        ))}
      </div>

      {/* 第三区: .lastupdate (700px) + aside 完本推荐 (250px) */}
      <div className={`${SS_CONTAINER} flex flex-col gap-2.5 lg:flex-row lg:gap-2.5`}>
        <div className="min-w-0 flex-1">
          <SsLastUpdate books={latest} />
        </div>

        {/* aside 完本推荐 (展示 .fullflag 红徽章 + 直角封面卡) */}
        <aside
          className="w-full shrink-0 px-2.5 py-2.5 lg:w-[250px]"
          style={{ background: v.surface, border: `1px solid ${v.border}` }}
          aria-label="完本推荐"
        >
          <SsTitle icon={<Coffee className="h-4 w-4" />} main="完本推荐" />
          <ul className="mt-2 space-y-2.5">
            {books
              .filter((b) => b.status === 'completed')
              .slice(0, 4)
              .map((b) => (
                <SsCompletedCard key={b.id} book={b} />
              ))}
          </ul>
        </aside>
      </div>

      {/* 第四区: .section.link 友情链接 */}
      <div
        className={`${SS_CONTAINER} px-2.5 py-2.5`}
        style={{ background: v.surface, border: `1px solid ${v.border}` }}
        aria-label="友情链接"
      >
        <p
          className="mb-2 flex items-center gap-2 border-b pb-2 text-[15px] font-bold leading-tight"
          style={{ borderColor: v.border, color: v.text }}
        >
          <LinkIcon className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
          友情链接
        </p>
        <div className="flex flex-wrap gap-3 text-[13px]" style={{ color: v.textMuted }}>
          <span className="transition-colors hover:text-[#ed4259]">{site.name}</span>
          <span className="transition-colors hover:text-[#ed4259]">船说CMS</span>
          <span className="transition-colors hover:text-[#ed4259]">网络小说</span>
          <span className="transition-colors hover:text-[#ed4259]">免费阅读</span>
        </div>
      </div>

      {/* #footer (深灰底 + 站点信息) */}
      <footer
        className={`${SS_CONTAINER} px-4 py-3 text-center text-[12px]`}
        style={{ background: '#3e3d43', color: '#fbfbfb' }}
      >
        <p>
          <HomeIcon className="mr-1 inline h-3 w-3" aria-hidden />
          <span className="font-bold">{site.name}</span>
          {' '}— 书友最值得收藏的网络小说阅读网
        </p>
        <p className="mt-1 opacity-80">简体版 · 繁體版</p>
      </footer>
    </div>
  )
}

/** 完本推荐卡 (.fullflag 红徽章 + 直角封面卡 DNA) */
function SsCompletedCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <li>
      <a
        {...bookNavProps(navigate, book.id)}
        className="flex cursor-pointer gap-2 p-1 transition-all hover:border-[#ed4259]"
        style={{ border: `1px solid ${v.border}` }}
        aria-label={`查看《${book.name}》详情`}
      >
        <div className="w-[50px] shrink-0">
          <BookCover
            name={book.name}
            cover={book.cover}
            className="h-[67px] w-full"
            style={{ borderRadius: 0 }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="line-clamp-1 text-[13px] font-bold leading-5 transition-colors hover:text-[#ed4259]"
            style={{ color: v.text }}
            title={book.name}
          >
            {book.name}
          </p>
          <p className="text-[11px]" style={{ color: v.textMuted }}>{book.author}</p>
          <div className="mt-1">
            <SsFullFlag status={book.status} />
          </div>
        </div>
      </a>
    </li>
  )
}
