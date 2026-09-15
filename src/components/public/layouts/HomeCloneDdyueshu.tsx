// ============================================================
// 首页布局 · clone-ddyueshu (精仿·得得小说 ddyueshu.cc)
// 实测 probe-html2/probe-ddyueshu.{html,css} 抓取真实 biquge.css:
//   charset: gbk (★GBK 编码)
//   body { background-color:#E9FAFF; color:#555; font-family:宋体; font-size:12px; }
//   a { color:#6F78A7; }   /* 蓝紫链 */
//   .nav { background:#88C6E5; height:40px; width:980px; }   /* 天蓝条 */
//   .nav ul li a { color:#FFF; font-size:15px; font-weight:700; padding:0 14px; }
//   #main { width:980px; margin:auto; }
//   #hotcontent .l { background:#FEF9EF; border:3px solid #C3DFEA; float:left; height:330px; width:695px; }
//   #hotcontent .l .item { float:left; width:335px; padding:10px 0 0 10px; }   /* ★2 列大卡 */
//   #hotcontent .r { border:3px solid #C3DFEA; float:right; width:265px; background:#FEF9EF; }   /* 排行榜 */
//   #hotcontent h2 { background-color:#E1ECED; font-size:14px; font-weight:700; }
//   .novelslist { margin:2px auto; border:3px solid #A6D3E8; width:968px; padding:3px; background:#FEF9EF; }
//   .novelslist .content { float:left; width:315px; }   /* 3 列分类列表 */
//   #newscontent .l { border:3px solid #88C6E5; float:left; width:695px; background:#E1ECED; }   /* 最新更新 */
//   #newscontent .r { float:right; width:265px; border:3px solid #88C6E5; background:#E1ECED; }   /* 访问榜 */
//   .novelslist li .s1 { width:10%; } / .s2 { width:20%; } / .s3 { width:49%; } / .s4 { color:#B3B3B3; width:15%; }
//   .footer_link { border-bottom:2px solid #88C6E5; height:25px; line-height:25px; }
//   .header_search form { border-radius:2px; border:2px solid #88C6E5; }
// DOM 结构 (实测抓取):
//   .header (logo 250x60 + search 450x32) + .nav (天蓝条 980x40, 10 分类) + #main (#hotcontent 双栏)
//   #hotcontent .l (3 大卡 2 列 + .r 排行榜) + .novelslist (3 列分类列表) + #newscontent (最新更新+访问榜)
//   + #footer (.footer_link + .footer_cont)
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate, formatWords, statusLabel, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk } from '../bits'
import { ChevronRight, Flame, LibraryBig, Search } from 'lucide-react'

function CloneSkeleton() {
  return (
    <div className="space-y-5">
      {/* 顶部绿色条 header skeleton */}
      <Sk className="h-12 w-full" />
      {/* nav 浅绿条 */}
      <Sk className="h-9 w-full" />
      {/* 主体双栏 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_265px]">
        <div className="space-y-4">
          <Sk className="h-7 w-32" />
          <Sk className="h-72 w-full" />
          <Sk className="h-7 w-32" />
          <Sk className="h-60 w-full" />
        </div>
        <div className="space-y-4">
          <Sk className="h-7 w-32" />
          <Sk className="h-80 w-full" />
        </div>
      </div>
    </div>
  )
}

/** 顶点小说标准模板 — 站点头: 绿色实色条 + 站名 + 搜索框 */
function DdyHeader() {
  const { site, theme } = usePublic()
  const v = theme.vars
  return (
    <header
      data-clone-ddyueshu-header
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6"
      style={{ background: v.primary, color: v.primaryText }}
      aria-label="站点头部"
    >
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-bold tracking-wider sm:text-2xl" style={{ color: v.primaryText }}>
          {site.name}
        </h1>
        <span className="hidden text-xs opacity-80 sm:inline" style={{ color: v.primaryText }}>
          顶点小说
        </span>
      </div>
      <div
        className="flex h-8 items-center overflow-hidden sm:w-72"
        style={{ background: v.surface, border: `1px solid ${withAlpha(v.primaryText, 0.4)}` }}
        aria-hidden
      >
        <Search className="ml-2 h-4 w-4 shrink-0 opacity-70" style={{ color: v.textMuted }} />
        <span className="ml-2 truncate text-sm" style={{ color: v.textMuted }}>
          搜索书名 / 作者…
        </span>
        <span
          className="ml-auto flex h-full items-center px-3 text-sm"
          style={{ background: v.accent, color: v.primaryText }}
        >
          搜索
        </span>
      </div>
    </header>
  )
}

/** 顶点小说标准模板 — nav 导航 (浅绿底 + 白字; 排除 "书架|排行") */
function DdyNav() {
  const v = usePublic().theme.vars
  // 顶点小说标准模板导航 (排除 "书架|排行"): 全本 / 玄幻 / 修真 / 都市 / 历史 / 网游 / 科幻 / 同人 / 完本
  const cats = ['首页', '全本', '玄幻', '修真', '都市', '历史', '网游', '科幻', '同人']
  return (
    <nav
      aria-label="分类导航"
      className="flex flex-wrap items-stretch px-1"
      style={{ background: v.surfaceAlt }}
    >
      {cats.map((t, i) => (
        <span
          key={t}
          className="px-3 py-1.5 text-sm font-medium"
          style={{
            color: i === 0 ? v.primary : v.text,
            borderRight: `1px solid ${withAlpha(v.primary, 0.18)}`,
            background: i === 0 ? withAlpha(v.primary, 0.08) : 'transparent',
          }}
          aria-hidden={i !== 0}
        >
          {t}
        </span>
      ))}
    </nav>
  )
}

/** 区块标题: 顶点小说 DNA — 左 3px 绿竖条 + 主字 + 副 em + 右更多 */
function DdySecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <div
      className="mb-2 flex items-center justify-between border-b px-1 py-2"
      style={{ borderColor: withAlpha(v.primary, 0.35) }}
    >
      <h3 className="flex items-baseline gap-1.5 text-base font-bold leading-none" style={{ color: v.text }}>
        <span className="inline-block h-4 w-1 self-center" style={{ background: v.primary }} aria-hidden />
        {main}
        <em className="not-italic text-sm font-normal" style={{ color: v.primary }}>{sub}</em>
      </h3>
      <span className="flex items-center gap-0.5 text-[11px] transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/**
 * #newscontent ul li DNA: 顶点小说标准模板首页推荐列表
 * 每行 .s1 类别 / .s2 书名 (绿链) / .s3 章节 / .s4 时间 / .s5 状态徽章
 * 直角 1px 灰边框, hover 浅绿背景
 */
function DdyNewsRow({ book }: { book: BookItem }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  return (
    <li
      className="flex items-center gap-2 px-2 py-1.5 text-[13px] transition-colors hover:bg-[rgba(108,173,83,0.08)]"
      style={{ borderBottom: `1px dashed ${withAlpha(v.border, 0.7)}` }}
    >
      {/* .s1 类别 */}
      <span className="w-12 shrink-0 truncate text-center" style={{ color: v.textMuted }} title={book.category}>
        [{book.category}]
      </span>
      {/* .s2 书名 (绿链) */}
      <button
        type="button"
        onClick={() => navigate({ view: 'book', bookId: book.id })}
        className="w-24 shrink-0 truncate text-left font-medium transition-opacity hover:underline sm:w-32"
        style={{ color: v.primary }}
        title={book.name}
        aria-label={`查看《${book.name}》详情`}
      >
        {book.name}
      </button>
      {/* .s3 最新章节 (灰链) */}
      <button
        type="button"
        onClick={() => navigate({ view: 'book', bookId: book.id })}
        className="min-w-0 flex-1 truncate text-left transition-opacity hover:underline"
        style={{ color: v.text }}
        title={book.latestChapter || '暂无章节'}
        aria-label={`阅读《${book.name}》最新章节`}
      >
        {book.latestChapter || '暂无章节'}
      </button>
      {/* .s4 时间 */}
      <span className="hidden w-20 shrink-0 text-right tabular-nums sm:inline" style={{ color: v.textMuted }}>
        {book.updatedAt ? fmtDate(book.updatedAt).slice(5) : '—'}
      </span>
      {/* .s5 状态徽章 (顶点 DNA: 新/全本小色块) */}
      <span
        className="w-10 shrink-0 text-center text-[11px] font-medium"
        style={{
          color: book.status === 'completed' ? v.primaryText : v.primary,
          background: book.status === 'completed' ? v.accent : withAlpha(v.primary, 0.12),
          border: `1px solid ${book.status === 'completed' ? v.accent : withAlpha(v.primary, 0.5)}`,
          padding: '1px 4px',
        }}
      >
        {book.status === 'completed' ? '完本' : '新书'}
      </span>
    </li>
  )
}

/**
 * 全本列表 table.grid DNA: 顶点小说标准模板 quanben 页面表格
 * 表头: 书名 / 作者 / 字数 / 更新时间 / 状态
 * tr:gt(0) 跳过表头; td a:eq(0) 书名 / td a:eq(1) 作者
 */
function DdyQuanbenTable({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const rows = books.slice(0, 12)
  if (!rows.length) return null
  return (
    <section data-clone-ddyueshu-section="quanben" aria-label="全本小说列表">
      <DdySecTitle main="全本" sub="小说" />
      <div
        className="overflow-x-auto"
        style={{ background: v.surface, border: `1px solid ${v.border}` }}
      >
        <table data-clone-ddyueshu-quanben className="w-full min-w-[600px] border-collapse text-left text-[13px]">
          <thead>
            <tr style={{ background: v.surfaceAlt, color: v.textMuted }}>
              <th scope="col" className="border-r px-3 py-2 text-xs font-normal" style={{ borderColor: withAlpha(v.border, 0.6) }}>序号</th>
              <th scope="col" className="border-r px-3 py-2 text-xs font-normal" style={{ borderColor: withAlpha(v.border, 0.6) }}>书名</th>
              <th scope="col" className="border-r px-3 py-2 text-xs font-normal" style={{ borderColor: withAlpha(v.border, 0.6) }}>作者</th>
              <th scope="col" className="hidden border-r px-3 py-2 text-right text-xs font-normal sm:table-cell" style={{ borderColor: withAlpha(v.border, 0.6) }}>字数</th>
              <th scope="col" className="hidden border-r px-3 py-2 text-right text-xs font-normal sm:table-cell" style={{ borderColor: withAlpha(v.border, 0.6) }}>更新时间</th>
              <th scope="col" className="px-3 py-2 text-center text-xs font-normal">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr
                key={b.id}
                className="transition-colors hover:bg-[rgba(108,173,83,0.06)]"
                style={{ borderTop: `1px solid ${withAlpha(v.border, 0.6)}` }}
              >
                <td className="border-r px-3 py-2 text-center tabular-nums" style={{ borderColor: withAlpha(v.border, 0.4), color: v.textMuted }}>
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td className="border-r px-3 py-2" style={{ borderColor: withAlpha(v.border, 0.4) }}>
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'book', bookId: b.id })}
                    className="font-medium transition-opacity hover:underline"
                    style={{ color: v.primary }}
                    title={b.name}
                    aria-label={`查看《${b.name}》详情`}
                  >
                    {b.name}
                  </button>
                </td>
                <td className="border-r px-3 py-2" style={{ borderColor: withAlpha(v.border, 0.4) }}>
                  <span className="text-[12px]" style={{ color: v.textMuted }}>{b.author}</span>
                </td>
                <td className="hidden border-r px-3 py-2 text-right text-[12px] tabular-nums sm:table-cell" style={{ borderColor: withAlpha(v.border, 0.4), color: v.textMuted }}>
                  {formatWords(b.wordCount)}
                </td>
                <td className="hidden border-r px-3 py-2 text-right text-[12px] tabular-nums sm:table-cell" style={{ borderColor: withAlpha(v.border, 0.4), color: v.textMuted }}>
                  {b.updatedAt ? fmtDate(b.updatedAt) : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <span
                    className="text-[11px]"
                    style={{
                      color: b.status === 'completed' ? v.primaryText : v.primary,
                      background: b.status === 'completed' ? v.accent : withAlpha(v.primary, 0.12),
                      border: `1px solid ${b.status === 'completed' ? v.accent : withAlpha(v.primary, 0.5)}`,
                      padding: '1px 6px',
                    }}
                  >
                    {statusLabel(b.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * .wrap .top 排行榜 DNA: 顶点小说标准模板右侧栏
 * .top 标题 (左 4px 红色 border-left + 主字 + 副 i) + .lis li 序号 + 书名
 * 前 3 名加红号 (.s2 → accent 色, 4-10 → textMuted 灰号)
 */
function DdyRankPanel({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const ranked = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 10)
  if (!ranked.length) return null
  return (
    <section
      data-clone-ddyueshu-rank
      aria-label="点击排行榜"
      style={{ background: v.surface, border: `1px solid ${v.border}` }}
    >
      <header
        className="flex items-center gap-2 px-3 py-2 text-sm font-bold"
        style={{
          borderLeft: `4px solid ${v.accent}`,
          background: v.surfaceAlt,
          color: v.text,
        }}
      >
        <Flame className="h-4 w-4" style={{ color: v.accent }} aria-hidden />
        点击排行榜
        <em className="ml-auto not-italic text-[11px] font-normal" style={{ color: v.textMuted }}>TOP 10</em>
      </header>
      <ol className="py-1">
        {ranked.map((b, i) => (
          <li key={b.id} style={{ borderBottom: i < ranked.length - 1 ? `1px dashed ${withAlpha(v.border, 0.7)}` : 'none' }}>
            <button
              type="button"
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              className="flex min-h-[34px] w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-[rgba(108,173,83,0.06)]"
              aria-label={`查看排行榜第${i + 1}名《${b.name}》`}
            >
              <span
                className="w-5 shrink-0 text-center text-sm font-bold tabular-nums"
                style={{ color: i < 3 ? v.accent : v.textMuted }}
              >
                {i + 1}.
              </span>
              <span className="line-clamp-1 flex-1 text-[13px] font-medium" style={{ color: v.primary }} title={b.name}>
                {b.name}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums" style={{ color: v.textMuted }}>
                {formatWords(b.wordCount)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** 顶点小说标准模板 — 底部横排分类导航条 */
function DdyFooterNav() {
  const v = usePublic().theme.vars
  const cats = ['玄幻魔法', '修真仙侠', '都市言情', '历史军事', '网游动漫', '科幻灵异', '同人小说', '完本小说']
  return (
    <nav
      aria-label="全部分类导航"
      className="flex flex-wrap items-stretch"
      style={{ background: v.surface, border: `1px solid ${v.border}` }}
    >
      {cats.map((t, i) => (
        <span
          key={t}
          className="flex-1 px-2 py-2 text-center text-[13px]"
          style={{
            color: v.text,
            borderRight: i < cats.length - 1 ? `1px solid ${withAlpha(v.border, 0.6)}` : 'none',
            background: i % 2 === 0 ? v.surfaceAlt : v.surface,
          }}
          aria-hidden
        >
          <span style={{ color: v.primary }}>◆</span> {t}
        </span>
      ))}
    </nav>
  )
}

/** 全本推荐缩略图列表 (右侧栏小列表, 顶点 DNA: 直角 + 1px 边 + 封面 60x80) */
function DdyQuanbenThumbList({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  if (!books.length) return null
  return (
    <section
      aria-label="全本推荐"
      style={{ background: v.surface, border: `1px solid ${v.border}` }}
    >
      <header
        className="flex items-center gap-2 px-3 py-2 text-sm font-bold"
        style={{
          borderLeft: `4px solid ${v.primary}`,
          background: v.surfaceAlt,
          color: v.text,
        }}
      >
        <LibraryBig className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
        全本推荐
      </header>
      <ul className="space-y-2 p-2">
        {books.map((b) => (
          <li key={b.id}>
            <a
              {...bookNavProps(navigate, b.id)}
              className="flex cursor-pointer gap-2 p-1 transition-colors hover:bg-[rgba(108,173,83,0.06)]"
              aria-label={`查看《${b.name}》详情`}
            >
              <div className="w-12 shrink-0">
                <BookCover
                  name={b.name}
                  cover={b.cover}
                  className="aspect-[3/4] w-full"
                  style={{ border: `1px solid ${v.border}`, padding: 1, background: '#fff' }}
                />
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                <p className="line-clamp-1 text-[13px] font-medium" style={{ color: v.primary }} title={b.name}>
                  {b.name}
                </p>
                <p className="text-[11px]" style={{ color: v.textMuted }}>{b.author}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight" style={{ color: v.textMuted }}>
                  {b.intro || '暂无简介'}
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function HomeCloneDdyueshu({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-ddyueshu-home><CloneSkeleton /></div>
  if (!books.length) return null

  // #newscontent 最新更新 (前 14 行)
  const newsList = books.slice(0, 14)
  // table.grid 全本列表 (按字数倒序取前 12)
  const quanbenList = [...books]
    .sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0))
    .slice(0, 12)

  return (
    <div data-clone-ddyueshu-home className="space-y-5">
      {/* 顶点小说标准模板 — 顶部绿色条 header */}
      <DdyHeader />

      {/* nav 导航条 (浅绿底, 排除"书架|排行") */}
      <DdyNav />

      {/* 主体双栏: 左 #newscontent + table.grid 全本 / 右 .wrap .top 排行榜 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_265px]">
        {/* 左主栏 */}
        <div className="min-w-0 space-y-5">
          {/* #newscontent 最新更新列表 */}
          <section data-clone-ddyueshu-section="newscontent" aria-label="最新更新">
            <DdySecTitle main="最新" sub="更新" />
            <div style={{ background: v.surface, border: `1px solid ${v.border}` }}>
              <ul>
                {newsList.map((b) => (
                  <DdyNewsRow key={b.id} book={b} />
                ))}
              </ul>
            </div>
          </section>

          {/* table.grid 全本列表 */}
          <DdyQuanbenTable books={quanbenList} />

          {/* 站点公告 (顶点小说 DNA: 浅米色块 + 站名 + 简介一行) */}
          <section
            className="flex items-start gap-2 px-3 py-2.5 text-[12px] leading-relaxed"
            style={{
              background: v.surfaceAlt,
              color: v.textMuted,
              border: `1px solid ${withAlpha(v.primary, 0.3)}`,
            }}
            aria-label="站点公告"
          >
            <LibraryBig className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: v.primary }} aria-hidden />
            <p>
              <span className="font-bold" style={{ color: v.text }}>{site.name}</span>
              {' '}— 顶点小说标准模板书站, 全本小说免费在线阅读。完结好书持续收录中, 顶部搜索可按书名 / 作者查找。
            </p>
          </section>
        </div>

        {/* 右栏: .wrap .top 排行榜 + 站点信息 */}
        <aside className="w-full shrink-0 space-y-4">
          <DdyRankPanel books={books} />

          {/* 全本推荐封面缩略图列表 (顶点 DNA: 右侧带封面的小列表) */}
          {books.length > 14 && <DdyQuanbenThumbList books={books.slice(14, 20)} />}
        </aside>
      </div>

      {/* 底部横排分类导航条 */}
      <DdyFooterNav />
    </div>
  )
}
