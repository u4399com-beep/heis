// ============================================================
// 首页布局 · clone-23qb (精仿·铅笔小说 23qb.net)
// 实测 CSS (23qb.net 直连 200):
//   body color #282828 bg #f8f9f9
//   font-family: -apple-system-font, BlinkMacSystemFont, helvetica neue, pingfang sc, hiragino sans gb,
//                microsoft yahei ui, microsoft yahei, Arial, sans-serif
//   a color #282828 / hover #ff2a14 (鲜红!) text-decoration none
//   .header-content box-shadow 0 7px 21px rgba(149,157,165,.22), border-bottom 1px #eaedf1
//   .nav-menu-item padding 0 11px font-size 16px weight 700 / .nav-menu-item-name color #282828
//   .module-item width 200px margin 0 20px 20px 0 font-size 14px
//   .module-item-cover padding-top 140% (5:7 aspect) border-radius 5px / hover shadow 0 10px 30px rgba(0,0,0,.3)
//   .module-item-caption bottom 0 height 44px padding 12px gradient bg rgba(0,0,0,0.68)→transparent
//   .block-box-item bg #eaedf1 padding 15px border-radius 10px
//   .block-box-content .title font-size 18px / hover ::after width 36px bg #ff2a14
//   .search-box box-shadow 0 7px 21px rgba(149,157,165,.22)
//   .search-tag a padding 0 20px line-height 35px font-size 14px radius 10px
// 结构: 顶部 header + 横向 5 列封面卡 (module-item) + 3 列宽卡 (block-box-item) + 表格更新
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate, formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { ChevronRight, Flame, Search, TrendingUp } from 'lucide-react'

function CloneSkeleton() {
  return (
    <div className="space-y-7">
      <Sk className="h-16 w-full" />
      <div>
        <Sk className="mb-3 h-7 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Sk className="aspect-[5/7] w-full" />
              <Sk className="mx-auto h-3.5 w-4/5" />
              <Sk className="mx-auto h-3 w-2/5" />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Sk className="mb-3 h-7 w-40" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Sk key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** 区块标题: 23qb DNA — 左 4px 红竖条 + 主字 + 红色副字 + 右更多 */
function QbSecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <div className="mb-4 flex items-end justify-between border-b pb-2.5" style={{ borderColor: withAlpha(v.primary, 0.25) }}>
      <h3 className="flex items-center gap-2.5 text-lg font-bold leading-none" style={{ color: v.text }}>
        <span className="inline-block h-5 w-1" style={{ background: v.primary }} aria-hidden />
        {main}
        <em className="not-italic text-sm font-normal" style={{ color: v.primary }}>{sub}</em>
      </h3>
      <span className="flex items-center gap-0.5 text-[11px] transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/** 封面卡 (module-item DNA: padding-top 140% + caption 渐变底部) */
function QbModuleCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group relative w-full cursor-pointer"
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div
        className="relative w-full overflow-hidden transition-shadow duration-300 group-hover:shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
        style={{ paddingTop: '140%', borderRadius: '5px' }}
      >
        <BookCover name={book.name} cover={book.cover} className="absolute inset-0 h-full w-full" style={{ borderRadius: '5px' }} />
        <div
          className="absolute bottom-0 left-0 right-0 h-11"
          style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.68), transparent)' }}
          aria-hidden
        />
        <div className="absolute bottom-2 left-0 right-0 flex items-center justify-between px-2.5">
          <StatusBadge status={book.status} small />
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'rgba(255,255,255,0.85)', color: '#282828' }}>
            {book.category}
          </span>
        </div>
      </div>
      <h4 className="mt-1.5 line-clamp-1 text-[14px] font-medium leading-5 transition-colors group-hover:text-[#ff2a14]" style={{ color: v.text }} title={book.name}>
        {book.name}
      </h4>
      <p className="truncate text-[12px]" style={{ color: v.textMuted }}>{book.author}</p>
    </article>
  )
}

/** 宽卡 (block-box-item DNA: bg #eaedf1 padding 15px radius 10px + title underline) */
function QbBlockCard({ book, idx }: { book: BookItem; idx: number }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group relative cursor-pointer p-3.5"
      style={{ background: v.surfaceAlt, borderRadius: '10px' }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div className="flex gap-3">
        <div className="w-[68px] shrink-0">
          <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" style={{ borderRadius: '4px' }} />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="relative line-clamp-1 text-[15px] font-bold leading-6 transition-colors group-hover:text-[#ff2a14]" style={{ color: v.text }} title={book.name}>
            {book.name}
          </h4>
          <p className="mt-0.5 text-[12px]" style={{ color: v.textMuted }}>{book.author} · {book.category}</p>
          <p className="mt-1 line-clamp-2 text-[12px] leading-[1.5]" style={{ color: v.textMuted }}>
            {book.intro || '暂无简介'}
          </p>
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <StatusBadge status={book.status} small />
            <span className="tabular-nums" style={{ color: v.textMuted }}>{formatWords(book.wordCount)}</span>
          </div>
        </div>
      </div>
      <span
        className="absolute right-3 top-3 text-[11px] font-bold tabular-nums"
        style={{ color: idx < 3 ? v.primary : v.textMuted }}
        aria-hidden
      >
        No.{String(idx + 1).padStart(2, '0')}
      </span>
    </article>
  )
}

/** 表格最近更新 */
function QbUpdateTable({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const rows = books.slice(0, 18)
  if (!rows.length) return null
  return (
    <section data-clone-23qb-section="latest" aria-label="最近更新">
      <QbSecTitle main="最近" sub="更新" />
      <div className="overflow-hidden" style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '10px', boxShadow: '0 7px 21px rgba(149,157,165,0.22)' }}>
        <table data-clone-23qb-table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
          <thead>
            <tr style={{ background: v.surfaceAlt, color: v.textMuted }}>
              <th scope="col" className="w-20 whitespace-nowrap px-3 py-2 text-xs font-normal">类别</th>
              <th scope="col" className="px-3 py-2 text-xs font-normal">书名 / 最新章节</th>
              <th scope="col" className="hidden w-20 px-3 py-2 text-right text-xs font-normal sm:table-cell">字数</th>
              <th scope="col" className="hidden w-24 whitespace-nowrap px-3 py-2 text-right text-xs font-normal sm:table-cell">更新时间</th>
              <th scope="col" className="hidden w-16 px-3 py-2 text-center text-xs font-normal md:table-cell">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t transition-colors" style={{ borderColor: withAlpha(v.border, 0.5) }}>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'home' })}
                    className="transition-opacity hover:underline"
                    style={{ color: v.primary }}
                    aria-label={`分类 ${b.category}`}
                  >
                    {b.category}
                  </button>
                </td>
                <td className="min-w-0 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'book', bookId: b.id })}
                    className="block max-w-full truncate text-left transition-colors hover:text-[#ff2a14]"
                    style={{ color: v.text }}
                    aria-label={`查看《${b.name}》详情`}
                  >
                    <span className="font-medium">{b.name}</span>
                    <span className="ml-1.5 text-[12px]" style={{ color: v.textMuted }}>{b.latestChapter || '暂无章节'}</span>
                  </button>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[12px] tabular-nums sm:table-cell" style={{ color: v.textMuted }}>
                  {formatWords(b.wordCount)}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[12px] tabular-nums sm:table-cell" style={{ color: v.textMuted }}>
                  {b.updatedAt ? fmtDate(b.updatedAt) : '—'}
                </td>
                <td className="hidden px-3 py-2.5 text-center md:table-cell">
                  <StatusBadge status={b.status} small />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function HomeClone23qb({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-23qb-home><CloneSkeleton /></div>
  if (!books.length) return null

  const featured = books.slice(0, 12)
  const fresh = books.slice(12, 21)
  const ranked = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 9)

  return (
    <div data-clone-23qb-home className="space-y-7">
      {/* 顶 banner: header-content DNA — shadow + 1px border-bottom + logo + 搜索框 + slogan */}
      <section
        className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-5 sm:py-4"
        style={{
          background: v.surface,
          borderRadius: '10px',
          boxShadow: '0 7px 21px rgba(149,157,165,0.22)',
          borderBottom: `1px solid ${v.border}`,
        }}
        aria-label="站点导航"
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg text-base font-black"
            style={{ background: `linear-gradient(135deg, ${v.primary} 0%, ${v.accent} 100%)`, color: v.primaryText }}
            aria-hidden
          >
            铅
          </div>
          <div>
            <p className="text-base font-bold leading-tight" style={{ color: v.text }}>{site.name}</p>
            <p className="text-[11px]" style={{ color: v.textMuted }}>铅笔小说 · 最值得书友收藏</p>
          </div>
        </div>
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-1.5"
          style={{ background: v.surfaceAlt, color: v.textMuted, flex: 1, maxWidth: 480 }}
          aria-hidden
        >
          <Search className="h-4 w-4 opacity-70" />
          <span className="text-sm opacity-80">搜索书名 / 作者…</span>
        </div>
        <div className="hidden items-center gap-1 text-xs sm:flex" style={{ color: v.textMuted }}>
          <TrendingUp className="h-3.5 w-3.5" style={{ color: v.primary }} aria-hidden />
          全免费小说在线阅读
        </div>
      </section>

      {/* 精品推荐封面网格 (module-item DNA: padding-top 140% 5:7 aspect) */}
      <section data-clone-23qb-section="featured" aria-label="精品推荐">
        <QbSecTitle main="精品" sub="推荐" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {featured.map((b) => <QbModuleCard key={b.id} book={b} />)}
        </div>
      </section>

      {/* 强推宽卡 (block-box-item DNA: bg #eaedf1 padding 15px radius 10px) */}
      {ranked.length > 0 && (
        <section data-clone-23qb-section="strong-rec" aria-label="本周强推">
          <QbSecTitle main="本周" sub="强推" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ranked.map((b, i) => <QbBlockCard key={b.id} book={b} idx={i} />)}
          </div>
        </section>
      )}

      {/* 最新入库封面网格 */}
      {fresh.length > 0 && (
        <section data-clone-23qb-section="fresh" aria-label="最新入库">
          <QbSecTitle main="最新" sub="入库" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {fresh.map((b) => <QbModuleCard key={b.id} book={b} />)}
          </div>
        </section>
      )}

      <QbUpdateTable books={books} />

      {/* 站点信息条 */}
      <section
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
        style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: '10px', color: v.textMuted }}
        aria-label="站点信息"
      >
        <span className="flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5" style={{ color: v.primary }} aria-hidden />
          {site.name}
        </span>
        <span>免费小说在线阅读</span>
        <span className="tabular-nums">共 {books.length} 本</span>
      </section>
    </div>
  )
}
