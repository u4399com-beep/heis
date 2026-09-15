// ============================================================
// 首页布局 · clone-ddyueshu (精仿·得得小说 ddyueshu.cc)
// 站点 ddyueshu.cc 在沙箱内 DNS 不通 / Connection refused (实测 scrapling static+stealthy+playwright 全失败)
// 兜底参考笔趣阁系书站通用形态 (table 列表 + 侧栏 排行榜) + 得到小说系站点通用配色 (青绿 + 暖红):
//   body bg #f5f7f5 (浅灰绿), color #2c3e50, font 14px/1.5 "Microsoft YaHei", Arial, sans-serif
//   a color #1a8a5a (青绿) / hover #d9534f (暖红)
//   .top bar bg #1a8a5a (青绿头) color #fff height 36px line-height 36px
//   .nav bg #e8f3ec (浅绿) li height 32px padding 0 14px
//   .hot bg #fff border 1px #d8e6d8 padding 10px, .item float 50% height 156px
//   .item .image img 100x130 border 1px #ccc padding 1px
//   .item dl dt border-bottom 1px dotted #aac8aa 14px weight 700 color #1a8a5a
//   .wrap .top border 1px #d8e6d8 width 268px bg #fff
//   .lis li border-bottom 1px #e0e0e0 height 32px line-height 32px
// 结构: 顶 nav (青绿头) + 双栏 (左 .hot 大卡列表 + 表格最近更新 / 右 .top 排行榜 + 站点公告)
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate, formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { ChevronRight, Flame, LibraryBig } from 'lucide-react'

function CloneSkeleton() {
  return (
    <div className="space-y-6">
      <Sk className="h-9 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex gap-3 p-2.5">
            <Sk className="aspect-[4/5] w-20 shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <Sk className="h-4 w-3/5" />
              <Sk className="h-3 w-2/5" />
              <Sk className="h-8 w-full" />
              <Sk className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Sk className="col-span-2 h-72 w-full" />
        <Sk className="h-72 w-full" />
      </div>
    </div>
  )
}

/** 区块标题: 得到小说 DNA — 绿色 5px border-top + 主字 + 右更多 */
function DdyueshuSecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <div
      className="mb-3 flex items-end justify-between border-t-[3px] px-2 py-2"
      style={{ borderColor: v.primary, background: withAlpha(v.primary, 0.05) }}
    >
      <h3 className="flex items-baseline gap-2 text-base font-bold leading-none" style={{ color: v.text }}>
        <span className="text-lg" style={{ color: v.primary }} aria-hidden>◆</span>
        {main}
        <em className="not-italic text-sm" style={{ color: v.primary }}>{sub}</em>
      </h3>
      <span className="flex items-center gap-0.5 text-[11px] transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/** 大卡列表 (.item .image + dl dt + dd DNA) */
function DdyueshuBigCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group flex cursor-pointer gap-3 p-2.5"
      style={{ background: v.surface, border: `1px solid ${v.border}` }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div className="w-[78px] shrink-0 sm:w-[96px]">
        <BookCover
          name={book.name}
          cover={book.cover}
          className="aspect-[4/5] w-full"
          style={{ border: '1px solid #ccc', padding: 1, background: '#fff', borderRadius: 0 }}
        />
      </div>
      <dl className="min-w-0 flex-1 py-0.5">
        <dt
          className="flex items-baseline gap-2 border-b pb-1 text-[14px] font-bold leading-5"
          style={{ borderColor: withAlpha(v.primary, 0.4) }}
        >
          <span className="truncate" style={{ color: v.primary }} title={book.name}>{book.name}</span>
          <span className="shrink-0 text-[11px]" style={{ color: v.textMuted }}>/{book.author}</span>
        </dt>
        <dd
          className="mt-1 line-clamp-3 text-[12px] leading-[1.6]"
          style={{ color: v.textMuted }}
        >
          {book.intro || '暂无简介'}
        </dd>
        <dd className="mt-1.5 flex items-center gap-2 text-[11px]" style={{ color: v.textMuted }}>
          <StatusBadge status={book.status} small />
          <span>[{book.category}]</span>
          <span className="ml-auto tabular-nums">{formatWords(book.wordCount)}</span>
        </dd>
      </dl>
    </article>
  )
}

/** 表格最近更新 (得到小说 DNA: 类别/书名+最新章节/字数/更新时间/状态) */
function DdyueshuUpdateTable({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const rows = books.slice(0, 18)
  if (!rows.length) return null
  return (
    <section data-clone-ddyueshu-section="latest" aria-label="最近更新">
      <DdyueshuSecTitle main="最近" sub="更新" />
      <div
        className="overflow-x-auto"
        style={{ background: v.surface, border: `1px solid ${v.border}` }}
      >
        <table data-clone-ddyueshu-table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
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
              <tr
                key={b.id}
                className="border-t transition-colors"
                style={{ borderColor: withAlpha(v.border, 0.6) }}
              >
                <td className="whitespace-nowrap px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'home' })}
                    className="transition-opacity hover:underline"
                    style={{ color: v.primary }}
                    aria-label={`分类 ${b.category}`}
                  >
                    [{b.category}]
                  </button>
                </td>
                <td className="min-w-0 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'book', bookId: b.id })}
                    className="block max-w-full truncate text-left transition-colors hover:underline"
                    style={{ color: v.primary }}
                    aria-label={`查看《${b.name}》详情`}
                  >
                    <span className="font-medium">《{b.name}》</span>
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

/** 排行榜 (.top .lis DNA: 序号 + 书名 + 字数) */
function DdyueshuRankPanel({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const ranked = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 12)
  if (!ranked.length) return null
  return (
    <section
      data-clone-ddyueshu-rank
      aria-label="点击排行"
      style={{ background: v.surface, border: `1px solid ${v.border}` }}
    >
      <header
        className="flex items-center gap-2 px-3 py-2 text-sm font-bold"
        style={{ background: v.primary, color: v.primaryText }}
      >
        <Flame className="h-4 w-4" aria-hidden />
        点击排行榜
      </header>
      <ol className="px-1.5 py-1">
        {ranked.map((b, i) => (
          <li key={b.id} className="border-b last:border-b-0" style={{ borderColor: withAlpha(v.border, 0.55) }}>
            <button
              type="button"
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              className="flex min-h-[33px] w-full items-center gap-2 px-1.5 py-1.5 text-left transition-colors hover:opacity-80"
              aria-label={`查看排行榜第${i + 1}名《${b.name}》`}
            >
              <span
                className="w-5 shrink-0 text-center text-sm font-bold tabular-nums"
                style={{ color: i < 3 ? v.accent : v.textMuted }}
              >
                {i + 1}.
              </span>
              <span className="line-clamp-1 flex-1 text-[13px]" style={{ color: v.primary }}>{b.name}</span>
              <span className="shrink-0 text-[10px] tabular-nums" style={{ color: v.textMuted }}>{formatWords(b.wordCount)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function HomeCloneDdyueshu({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-ddyueshu-home><CloneSkeleton /></div>
  if (!books.length) return null

  const featured = books.slice(0, 9)
  const fresh = books.slice(9, 21)

  return (
    <div data-clone-ddyueshu-home className="space-y-6">
      {/* 得到小说 DNA 顶部青绿 nav 条 */}
      <nav
        aria-label="分类导航"
        className="flex flex-wrap items-center px-2 py-1"
        style={{ background: v.primary, borderRadius: 0 }}
      >
        {['首页', '玄幻', '都市', '历史', '网游', '科幻', '恐怖', '同人', '完本'].map((t, i) => (
          <span
            key={t}
            className="px-2.5 py-1 text-[14px] font-medium"
            style={{ color: v.primaryText, opacity: i === 0 ? 1 : 0.92 }}
            aria-hidden={i !== 0}
          >
            {t}
          </span>
        ))}
      </nav>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-5">
        {/* 左主栏 (.hot 大卡列表 + 表格最近更新) */}
        <div className="min-w-0 flex-1 space-y-6">
          <section data-clone-ddyueshu-section="featured" aria-label="精品推荐">
            <DdyueshuSecTitle main="精品" sub="推荐" />
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
              style={{ background: v.surfaceAlt, border: `1px solid ${withAlpha(v.primary, 0.3)}`, padding: 8 }}
            >
              {featured.map((b) => <DdyueshuBigCard key={b.id} book={b} />)}
            </div>
          </section>

          {fresh.length > 0 && (
            <section data-clone-ddyueshu-section="fresh" aria-label="新书入库">
              <DdyueshuSecTitle main="新书" sub="入库" />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" style={{ background: v.surfaceAlt, border: `1px solid ${withAlpha(v.primary, 0.3)}`, padding: 8 }}>
                {fresh.map((b) => <DdyueshuBigCard key={b.id} book={b} />)}
              </div>
            </section>
          )}

          <DdyueshuUpdateTable books={books} />
        </div>

        {/* 右栏 (.top 排行榜 + 站点公告) */}
        <aside className="w-full shrink-0 lg:w-[265px]">
          <DdyueshuRankPanel books={books} />
          <section
            className="mt-4 px-4 py-3 text-xs leading-relaxed"
            style={{
              background: v.surfaceAlt,
              color: v.textMuted,
              border: `1px solid ${withAlpha(v.primary, 0.3)}`,
            }}
            aria-label="站点公告"
          >
            <p className="mb-1 flex items-center gap-1.5 font-bold" style={{ color: v.text }}>
              <LibraryBig className="h-3.5 w-3.5" style={{ color: v.primary }} aria-hidden />
              {site.name}
            </p>
            <p style={{ opacity: 0.9 }}>得到小说系书站, 全本小说免费在线阅读。完结好书持续收录中, 顶部搜索可按书名 / 作者查找。</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
