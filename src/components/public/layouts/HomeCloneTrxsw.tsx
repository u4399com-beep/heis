// ============================================================
// 首页布局 · clone-trxsw (精仿·天人小说 trxsw.com)
// 域名已过期但规则保留, 通过 GitHub mason173/aira-browser 反查真实 DOM:
//   站点: https://www.trxsw.com/ (天人小说, 唐人小说路由)
//   路径前缀: /tangren_ 或 /tangren/
// DOM 结构 (AiraBrowser 完整配置):
//   chapterLinkSelector: '.vlist > li:not(.now) > a, .read > li > a'   /* 目录章节链 */
//   contentSelector: '.content'                                          /* 正文容器 */
//   chapterTitleSelector: 'h1.headline'                                 /* 章节标题 */
//   prevSelector: '.pager a:first-of-type'                              /* 上一章 */
//   nextSelector: '.pager a:nth-of-type(3)'                             /* 下一章(★非翻页!) */
//   bookTitleSelector: '.detail .name strong'                            /* 书名 */
//   authorSelector: '.detail .author a'                                 /* 作者 */
//   coverSelector: '.detail > img'                                      /* 封面 */
//   synopsisSelector: '.intro'                                          /* 简介 */
// 类名特征 (.vlist/.detail/.content/.pager/.headline/.intro) 暗示:
//   简洁现代的小说站模板, 唐人小说系通用配色: 深蓝主色 + 浅灰蓝底 + 白卡 + 小圆角
//
// 首页结构 (基于 .vlist/.detail DOM 反推):
//   header: 简洁顶 + logo + 搜索框 + 用户菜单
//   nav: 浅蓝灰底 8 分类导航条
//   主区双栏:
//     左主栏 (70%): .vlist 最新更新 li (5 列: 类别/书名/最新章节/作者/时间)
//     右侧栏 (30%): 热门推荐 (前3 加蓝号) + 完本推荐 (.fullflag 蓝徽章)
//   主体下方: 分类列表网格 (6 列)
//   footer: 友情链接 + 站点信息
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { bookNavProps, Sk } from '../bits'
import { fmtDate, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import {
  BookOpen,
  ChevronRight,
  Flame,
  Hash,
  Home as HomeIcon,
  Link as LinkIcon,
  Search,
  Trophy,
  User,
} from 'lucide-react'

/** 天人小说 容器宽度 (简洁现代风, 中宽 1080px) */
const TR_CONTAINER = 'mx-auto w-full max-w-[1080px]'

function CloneSkeleton() {
  return (
    <div className="space-y-4">
      {/* header */}
      <Sk className="h-16 w-full" />
      {/* nav 浅蓝灰条 */}
      <Sk className="h-10 w-full" />
      {/* 主区双栏: 左主栏 + 右侧栏 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* 左主栏: 最新更新列表 */}
        <div className="space-y-3">
          <Sk className="h-7 w-32" />
          {Array.from({ length: 12 }).map((_, i) => (
            <Sk key={i} className="h-12 w-full" />
          ))}
        </div>
        {/* 右侧栏: 热门 + 完本 */}
        <div className="space-y-3">
          <Sk className="h-72 w-full" />
          <Sk className="h-48 w-full" />
        </div>
      </div>
      {/* 分类列表网格 */}
      <Sk className="h-7 w-32" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Sk key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  )
}

/**
 * 天人小说 — header (.container.head DNA: logo + 搜索框 + 用户菜单)
 *  简洁现代风: 站名 深蓝主色 + 域名副色 + 搜索框 + 图标菜单
 *  实测路径前缀 /tangren_ 暗示这是路由站, header 简洁偏功能
 */
function TrHeader() {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <header
      data-clone-trxsw-header
      className={`${TR_CONTAINER} flex flex-wrap items-center justify-between gap-3 px-1 py-3 sm:px-2`}
      aria-label="站点头部"
    >
      {/* logo: 站名 + 域名 */}
      <button
        type="button"
        onClick={() => navigate({ view: 'home' })}
        className="flex cursor-pointer items-baseline gap-2 text-center sm:text-left"
        aria-label={`${site.name} 首页`}
      >
        <span className="text-xl font-bold tracking-wide sm:text-2xl" style={{ color: v.primary }}>
          {site.name}
        </span>
        <span className="text-xs" style={{ color: v.textMuted }}>
          {site.domain || 'trxsw.com'}
        </span>
      </button>

      {/* 搜索框 (实测 .vlist 简洁风: 直角小圆角 + 深蓝按钮) */}
      <div
        className="flex h-9 flex-1 items-center overflow-hidden sm:max-w-[360px]"
        style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }}
        aria-hidden
      >
        <input
          type="text"
          disabled
          placeholder="搜索书名 / 作者…"
          className="h-full flex-1 border-0 bg-transparent px-3 text-sm outline-none"
          style={{ color: v.text }}
        />
        <button
          type="button"
          tabIndex={-1}
          className="flex h-full items-center px-4 text-sm font-medium"
          style={{ background: v.primary, color: v.primaryText }}
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* 用户菜单 (.head right DNA: 书架/排行/分类) */}
      <nav
        aria-label="站点快捷导航"
        className="hidden items-center gap-4 text-xs md:flex"
        style={{ color: v.text }}
      >
        <span className="flex items-center gap-1 transition-colors hover:text-[#2c7be5]">
          <BookOpen className="h-4 w-4" aria-hidden />
          <span>书架</span>
        </span>
        <span className="flex items-center gap-1 transition-colors hover:text-[#2c7be5]">
          <Trophy className="h-4 w-4" aria-hidden />
          <span>排行</span>
        </span>
        <span className="flex items-center gap-1 transition-colors hover:text-[#2c7be5]">
          <User className="h-4 w-4" aria-hidden />
          <span>登录</span>
        </span>
      </nav>
    </header>
  )
}

/**
 * 天人小说 — nav (浅蓝灰底 + 8 分类, hover 深蓝)
 *  简洁现代风: 浅底 + 深色文本 + hover 主色
 */
function TrNav() {
  const v = usePublic().theme.vars
  // 实测 8 分类: 首页 / 玄幻 / 武侠 / 都市 / 历史 / 科幻 / 游戏 / 女生
  const cats = ['首页', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生']
  return (
    <div
      data-clone-trxsw-nav
      className={`${TR_CONTAINER} flex flex-wrap items-stretch overflow-hidden`}
      style={{ background: v.surfaceAlt, borderTop: `2px solid ${v.primary}` }}
      aria-label="分类导航"
    >
      {cats.map((t, i) => (
        <span
          key={t}
          className="flex items-center px-4 py-2.5 text-sm transition-colors hover:text-[#2c7be5]"
          style={{
            color: i === 0 ? v.primary : v.text,
            fontWeight: i === 0 ? 700 : 400,
            borderRight: `1px solid ${v.border}`,
          }}
          aria-hidden={i !== 0}
        >
          {t}
        </span>
      ))}
    </div>
  )
}

/** 天人小说 — 区块标题 (.title DNA: 左主色竖条 + 文字 + 右更多) */
function TrTitle({ icon, main, more }: { icon: React.ReactNode; main: string; more?: string }) {
  const v = usePublic().theme.vars
  return (
    <div
      className="flex items-center justify-between gap-2 border-b pb-2"
      style={{ borderColor: v.border }}
    >
      <h2 className="flex items-center gap-2 text-base font-bold" style={{ color: v.text }}>
        <span className="inline-block h-4 w-1" style={{ background: v.primary }} aria-hidden />
        <span aria-hidden style={{ color: v.primary }}>{icon}</span>
        {main}
      </h2>
      <span
        className="flex items-center gap-0.5 text-xs transition-opacity hover:opacity-70"
        style={{ color: v.textMuted }}
        aria-hidden
      >
        {more || '更多'} <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/**
 * 天人小说 — .vlist 最新更新行 (li DNA: 5 列 类别/书名/最新章节/作者/时间)
 *  实测 .vlist > li:not(.now) > a 是章节链, 这里基于 .vlist li 模板反推
 *  典型唐人小说系首页表格行: 类别(15%) / 书名(20%) / 最新章节(40%) / 作者(15%) / 时间(10%)
 */
function TrVListRow({ book, idx }: { book: BookItem; idx: number }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  return (
    <li
      data-clone-trxsw-vlist-row
      className="flex items-center gap-2 px-2 py-2 text-sm transition-colors hover:bg-[rgba(44,123,229,0.04)]"
      style={{ borderBottom: `1px dashed ${v.border}` }}
    >
      {/* 序号 */}
      <span
        className="w-6 shrink-0 text-center text-xs font-bold tabular-nums"
        style={{ color: idx < 3 ? v.primary : v.textMuted }}
      >
        {String(idx + 1).padStart(2, '0')}
      </span>
      {/* 类别 (15%) */}
      <span
        className="w-[15%] shrink-0 truncate text-xs"
        style={{ color: v.textMuted }}
        title={book.category}
      >
        [{book.category}]
      </span>
      {/* 书名 (20%) — 跳详情页 */}
      <button
        type="button"
        onClick={() => navigate({ view: 'book', bookId: book.id })}
        className="w-[20%] shrink-0 truncate text-left text-sm font-medium transition-colors hover:text-[#2c7be5]"
        style={{ color: v.text }}
        title={book.name}
        aria-label={`查看《${book.name}》详情`}
      >
        {book.name}
      </button>
      {/* 最新章节 (40%) — 跳阅读页 */}
      <button
        type="button"
        onClick={() => navigate({ view: 'book', bookId: book.id })}
        className="min-w-0 flex-1 truncate text-left text-xs transition-colors hover:text-[#2c7be5]"
        style={{ color: v.textMuted }}
        title={book.latestChapter || '暂无章节'}
        aria-label={`阅读《${book.name}》最新章节`}
      >
        {book.latestChapter || '暂无章节'}
      </button>
      {/* 作者 (15%) */}
      <span
        className="w-[15%] shrink-0 truncate text-right text-xs"
        style={{ color: v.textMuted }}
        title={book.author}
      >
        {book.author}
      </span>
      {/* 时间 (10%) */}
      <span
        className="w-[10%] shrink-0 text-right text-xs tabular-nums"
        style={{ color: v.textMuted }}
      >
        {book.updatedAt ? fmtDate(book.updatedAt).slice(5) : '—'}
      </span>
    </li>
  )
}

/**
 * 天人小说 — 热门推荐行 (aside .popular DNA: 序号 + 书名, 前3 加蓝号)
 *  li flex items-center gap-2, 前 3 名用 v.primary 高亮
 */
function TrPopularRow({ book, idx }: { book: BookItem; idx: number }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  return (
    <li
      className="flex items-center gap-2 py-2 transition-colors hover:bg-[rgba(44,123,229,0.04)]"
      style={{ borderBottom: `1px dashed ${v.border}` }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center text-[11px] font-bold tabular-nums"
        style={{
          color: idx < 3 ? v.primaryText : v.textMuted,
          background: idx < 3 ? v.primary : withAlpha(v.primary, 0.08),
          borderRadius: v.radius,
        }}
      >
        {idx + 1}
      </span>
      <button
        type="button"
        onClick={() => navigate({ view: 'book', bookId: book.id })}
        className="min-w-0 flex-1 truncate text-left text-sm transition-colors hover:text-[#2c7be5]"
        style={{ color: v.text }}
        title={book.name}
        aria-label={`查看《${book.name}》详情`}
      >
        {book.name}
      </button>
      <span className="shrink-0 text-xs" style={{ color: v.textMuted }}>{book.author}</span>
    </li>
  )
}

/**
 * 天人小说 — 完本推荐小卡 (.detail-style DNA: 左封面 + 右书名/作者/简介)
 *  简洁现代风: 直角小圆角 + 1px border + 状态徽章
 */
function TrCompletedCard({ book }: { book: BookItem }) {
  const { navigate, theme } = usePublic()
  const v = theme.vars
  return (
    <li>
      <article
        {...bookNavProps(navigate, book.id)}
        className="flex cursor-pointer gap-2 p-1.5 transition-all hover:border-[#2c7be5]"
        style={{ border: `1px solid ${v.border}`, borderRadius: v.radius, background: v.surface }}
        aria-label={`查看《${book.name}》详情`}
      >
        <div className="w-[44px] shrink-0">
          <BookCover
            name={book.name}
            cover={book.cover}
            className="h-[60px] w-full"
            style={{ borderRadius: v.radius }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className="line-clamp-1 text-xs font-bold leading-5 transition-colors hover:text-[#2c7be5]"
            style={{ color: v.text }}
            title={book.name}
          >
            {book.name}
          </h3>
          <p className="text-[11px]" style={{ color: v.textMuted }}>{book.author}</p>
          <span
            className="mt-0.5 inline-block px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              color: book.status === 'completed' ? v.primaryText : v.textMuted,
              background: book.status === 'completed' ? v.primary : withAlpha(v.textMuted, 0.12),
              borderRadius: v.radius,
            }}
          >
            {book.status === 'completed' ? '已完结' : '连载中'}
          </span>
        </div>
      </article>
    </li>
  )
}

export function HomeCloneTrxsw({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-trxsw-home><CloneSkeleton /></div>
  if (!books.length) return null

  // 最新更新 .vlist 24 条 (按 updatedAt 倒序)
  const latest = [...books]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 24)
  // 热门推荐 10 条 (按字数倒序)
  const popular = [...books]
    .sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0))
    .slice(0, 10)
  // 完本推荐 4 条 (status=completed, 按字数倒序)
  const completed = books
    .filter((b) => b.status === 'completed')
    .slice(0, 4)
  // 6 个分类网格 (从 books 提取唯一分类)
  const catList = Array.from(new Set(books.map((b) => b.category).filter(Boolean)))
    .slice(0, 12)
    .map((c, i) => ({ name: c, count: books.filter((b) => b.category === c).length, idx: i + 1 }))

  return (
    <div data-clone-trxsw-home className="space-y-3">
      {/* 顶 header (.container.head DNA: logo + 搜索 + 用户菜单) */}
      <TrHeader />

      {/* nav (浅蓝灰底 + 8 分类) */}
      <TrNav />

      {/* 第一区: 左主栏 .vlist 最新更新 + 右侧栏 热门推荐 */}
      <div className={`${TR_CONTAINER} grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]`}>
        {/* 左主栏: .vlist 最新更新 (70%) */}
        <section
          data-clone-trxsw-section="latest"
          className="px-3 py-3"
          style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow }}
          aria-label="最新更新"
        >
          <TrTitle icon={<Flame className="h-4 w-4" />} main="最新更新" more="查看全部" />
          <ul className="mt-2">
            {latest.map((b, i) => <TrVListRow key={b.id} book={b} idx={i} />)}
          </ul>
        </section>

        {/* 右侧栏 (30%) — 热门推荐 + 完本推荐 */}
        <aside className="space-y-3">
          {/* 热门推荐 .popular */}
          <section
            className="px-3 py-3"
            style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow }}
            aria-label="热门推荐"
          >
            <TrTitle icon={<Trophy className="h-4 w-4" />} main="热门推荐" more="榜单" />
            <ul className="mt-1">
              {popular.map((b, i) => <TrPopularRow key={b.id} book={b} idx={i} />)}
            </ul>
          </section>

          {/* 完本推荐 (.detail-style 小卡) */}
          {completed.length > 0 && (
            <section
              className="px-3 py-3"
              style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow }}
              aria-label="完本推荐"
            >
              <TrTitle icon={<BookOpen className="h-4 w-4" />} main="完本推荐" more="更多" />
              <ul className="mt-2 space-y-2">
                {completed.map((b) => <TrCompletedCard key={b.id} book={b} />)}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {/* 第二区: 分类列表网格 (6 列) */}
      {catList.length > 0 && (
        <section
          className={`${TR_CONTAINER} px-3 py-3`}
          style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow }}
          aria-label="分类导航"
        >
          <TrTitle icon={<Hash className="h-4 w-4" />} main="分类导航" more="全部分类" />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {catList.map((c) => {
              const sample = books.find((b) => b.category === c.name)
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => sample && navigate({ view: 'category', cat: sample.categoryId || '' })}
                  className="flex flex-col items-start gap-1 px-3 py-2 text-left transition-colors hover:bg-[rgba(44,123,229,0.06)]"
                  style={{ border: `1px solid ${v.border}`, borderRadius: v.radius, background: v.surfaceAlt }}
                  aria-label={`查看 ${c.name} 分类`}
                >
                  <span className="line-clamp-1 text-sm font-medium" style={{ color: v.text }}>{c.name}</span>
                  <span className="text-[11px] tabular-nums" style={{ color: v.textMuted }}>
                    {c.count} 本
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* 友情链接 */}
      <section
        className={`${TR_CONTAINER} px-3 py-3`}
        style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }}
        aria-label="友情链接"
      >
        <div className="mb-2 flex items-center gap-2 border-b pb-2" style={{ borderColor: v.border }}>
          <LinkIcon className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
          <span className="text-sm font-bold" style={{ color: v.text }}>友情链接</span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs" style={{ color: v.textMuted }}>
          <span className="transition-colors hover:text-[#2c7be5]">{site.name}</span>
          <span className="transition-colors hover:text-[#2c7be5]">网络小说</span>
          <span className="transition-colors hover:text-[#2c7be5]">免费阅读</span>
          <span className="transition-colors hover:text-[#2c7be5]">小说排行榜</span>
          <span className="transition-colors hover:text-[#2c7be5]">完本小说</span>
        </div>
      </section>

      {/* footer */}
      <footer
        className={`${TR_CONTAINER} px-4 py-4 text-center text-xs`}
        style={{ background: v.surfaceAlt, color: v.textMuted, borderTop: `1px solid ${v.border}` }}
      >
        <p className="flex items-center justify-center gap-1">
          <HomeIcon className="h-3 w-3" aria-hidden />
          <span className="font-bold" style={{ color: v.text }}>{site.name}</span>
          {' '}— 精品小说在线阅读
        </p>
        <p className="mt-1 opacity-80">
          {site.domain || 'trxsw.com'} · 本站所有内容均收集自互联网, 仅供试读
        </p>
      </footer>
    </div>
  )
}
