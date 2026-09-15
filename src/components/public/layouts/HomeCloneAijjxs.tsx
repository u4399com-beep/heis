// ============================================================
// 首页布局 · clone-aijjxs (精仿·久久小说 aijjxs.com)
// 实测 CSS 变量直接落地:
//   --bg #f3efe7 / --paper #fffdf8 / --ink #1f2937 / --muted #6b7280
//   --line #e5dccd / --brand #0f766e (青绿) / --brand-dark #115e59
//   --accent #b45309 (琥珀) / --shadow 0 10px 30px rgba(17,24,39,0.08) / --radius 14px
//   body font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif, line-height 1.7
//   a: var(--brand-dark) #115e59 / hover var(--brand) #0f766e
// 结构 (实测 .wrap max-width 1220px + .top header card + .layout grid 1fr 330px):
//   顶 banner (奶油+青绿) + 5 列封面卡片网格 (book.booknav DNA: 48x64 缩略图+右侧书名+作者+简介)
//   + 表格最近更新 (book_r grid: 类别/书名+最新章节/字数/更新时间/状态) + 横向琥珀排行榜
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate, formatWords, withAlpha } from '../seo'
import { BookCover } from '../BookCover'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { ChevronRight, Flame, TrendingUp } from 'lucide-react'

function CloneSkeleton() {
  return (
    <div className="space-y-8">
      <Sk className="h-28 w-full" />
      <div>
        <Sk className="mb-3 h-7 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Sk className="aspect-[3/4] w-full" />
              <Sk className="mx-auto h-3.5 w-4/5" />
              <Sk className="mx-auto h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Sk className="mb-3 h-7 w-40" />
        <div className="space-y-1.5">
          {Array.from({ length: 12 }).map((_, i) => (
            <Sk key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** 区块标题: 左 4px 圆角青绿竖条 + 主字 + 琥珀副字 + 右更多 */
function AijjxsSecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <div className="mb-3 flex items-end justify-between border-b pb-2.5" style={{ borderColor: withAlpha(v.primary, 0.25) }}>
      <h3 className="flex items-center gap-2 text-base font-bold leading-none" style={{ color: v.text }}>
        <span className="inline-block h-4 w-1 rounded" style={{ background: v.primary }} aria-hidden />
        {main}
        <em className="not-italic text-sm" style={{ color: v.accent }}>{sub}</em>
      </h3>
      <span className="flex items-center gap-0.5 text-[11px] transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/** 5 列封面卡 (.book.book_r DNA: 48x64 缩略图 + 右侧书名+作者+简介) */
function AijjxsCoverCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group flex cursor-pointer gap-3 p-2.5 transition-shadow"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: '12px',
        boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
      }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div className="w-12 shrink-0">
        <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-[13px] font-medium leading-5" style={{ color: v.primary }} title={book.name}>
          {book.name}
        </h4>
        <p className="truncate text-[11px] leading-4" style={{ color: v.textMuted }}>
          {book.author}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-[1.5]" style={{ color: v.textMuted }}>
          {book.intro || '暂无简介'}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <StatusBadge status={book.status} small />
          <span className="text-[10px]" style={{ color: v.textMuted }}>{book.category}</span>
        </div>
      </div>
    </article>
  )
}

/** 表格最近更新 (book_r grid: 类别/书名+最新章节/字数/状态) */
function AijjxsUpdateTable({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const rows = books.slice(0, 18)
  if (!rows.length) return null
  return (
    <section data-aijjxs-section="latest" aria-label="最近更新">
      <AijjxsSecTitle main="最近" sub="更新" />
      <div className="overflow-hidden" style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow }}>
        <table data-aijjxs-table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
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
              <tr key={b.id} className="border-t transition-colors" style={{ borderColor: withAlpha(v.border, 0.6) }}>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'home' })}
                    className="transition-opacity hover:underline"
                    style={{ color: v.accent }}
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

/** 琥珀排行榜 (右侧栏, 1-3 名带色) */
function AijjxsRankPanel({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const ranked = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 10)
  if (!ranked.length) return null
  return (
    <section
      data-aijjxs-rank
      aria-label="点击排行"
      style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow }}
    >
      <header
        className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold"
        style={{ background: `linear-gradient(90deg, ${v.accent}, ${withAlpha(v.accent, 0.6)})`, color: '#fff', borderRadius: `${v.radius} ${v.radius} 0 0` }}
      >
        <Flame className="h-4 w-4" aria-hidden />
        点击排行
      </header>
      <ol className="px-2 py-1.5">
        {ranked.map((b, i) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => navigate({ view: 'book', bookId: b.id })}
              className="flex min-h-[38px] w-full items-center gap-2.5 border-b px-1.5 py-2 text-left transition-colors last:border-b-0 hover:opacity-80"
              style={{ borderColor: withAlpha(v.border, 0.55) }}
              aria-label={`查看排行榜第${i + 1}名《${b.name}》`}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
                style={{
                  background: i < 3 ? v.accent : withAlpha(v.textMuted, 0.15),
                  color: i < 3 ? '#fff' : v.textMuted,
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

export function HomeCloneAijjxs({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-aijjxs-home><CloneSkeleton /></div>
  if (!books.length) return null

  const featured = books.slice(0, 10)
  const fresh = books.slice(10, 22)

  return (
    <div data-clone-aijjxs-home className="space-y-8">
      {/* 顶 banner: 奶油渐变底 + 青绿 CTA + 琥珀点缀 */}
      <section
        className="relative overflow-hidden px-6 py-8 sm:px-10 sm:py-10"
        style={{
          background: `linear-gradient(135deg, ${withAlpha(v.primary, 0.12)} 0%, ${withAlpha(v.accent, 0.08)} 100%), ${v.surface}`,
          border: `1px solid ${v.border}`,
          borderRadius: v.radius,
          boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
        }}
        aria-label="站点欢迎横幅"
      >
        <TrendingUp className="absolute -right-4 -top-4 h-24 w-24 opacity-15" style={{ color: v.primary }} aria-hidden />
        <div className="relative max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: v.primary }}>
            久久小说下载网
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-snug sm:text-3xl" style={{ color: v.text }}>
            {site.name} · TXT 小说免费下载
          </h1>
          {site.description && (
            <p className="mt-2 line-clamp-2 text-sm" style={{ color: v.textMuted }}>
              {site.description}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3 text-xs" style={{ color: v.textMuted }}>
            <span className="flex items-center gap-1"><Flame className="h-3.5 w-3.5" style={{ color: v.accent }} aria-hidden />全本 TXT 下载</span>
            <span>·</span>
            <span>持续收录完结好书</span>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-6">
        {/* 左主栏 */}
        <div className="min-w-0 flex-1 space-y-8">
          <section data-clone-aijjxs-section="featured" aria-label="精品推荐">
            <AijjxsSecTitle main="精品" sub="推荐" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
              {featured.map((b) => <AijjxsCoverCard key={b.id} book={b} />)}
            </div>
          </section>

          {fresh.length > 0 && (
            <section data-clone-aijjxs-section="fresh" aria-label="最新入库">
              <AijjxsSecTitle main="最新" sub="入库" />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {fresh.map((b) => <AijjxsCoverCard key={b.id} book={b} />)}
              </div>
            </section>
          )}

          <AijjxsUpdateTable books={books} />
        </div>

        {/* 右侧栏: 琥珀排行榜 */}
        <aside className="w-full shrink-0 lg:w-[264px]">
          <AijjxsRankPanel books={books} />
          <section
            className="mt-4 px-4 py-3 text-xs leading-relaxed"
            style={{
              background: `linear-gradient(180deg, ${withAlpha(v.accent, 0.08)}, ${withAlpha(v.primary, 0.05)})`,
              color: v.textMuted,
              border: `1px solid ${v.border}`,
              borderRadius: v.radius,
            }}
            aria-label="站点公告"
          >
            <p className="mb-1 font-bold" style={{ color: v.text }}>站点公告</p>
            <p style={{ opacity: 0.9 }}>本站所有小说均可免费在线阅读与下载, 完结好书持续收录中。使用顶部搜索框可按书名 / 作者查找。</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
