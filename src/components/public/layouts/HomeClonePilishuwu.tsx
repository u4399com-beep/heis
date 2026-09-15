// ============================================================
// 首页布局 · clone-pilishuwu (精仿·霹雳书屋 pilishuwu.com)
// 站点 Cloudflare 防护, 直连 403 (jsd 挑战), 参考已有 HomePili 设计 + 站点形态描述:
//   - 列表 = /book/index.html 或 /sort/{cat}/{page}.html (.book-item 卡片)
//   - 书籍页 = /book/{id}.html (h1 书名 + og:novel:* meta + .intro 简介 + .cover img 封面)
//   - 目录页 = /book/{id}/ (.list dd>a 或 #list li>a)
//   - 正文 = /book/{bid}/{cid}.html div#content
// 风格特征(基于 pilishuwu.com 系通用模板 + HomePili.tsx 已有仿站):
//   - 白卡书城 DNA: 左主栏(精品推荐封面网格/最新入库/最近更新表格) + 右侧橙色头排行榜
//   - 奶油区块标题(左橙竖条) + 复古直角白卡 + 橙色点缀红号次
//   - 主色: 暖橙 #f77720 (border-top 3px, header gradient), 副色: 深橙 #c4521a, 米黄 #fef9ef
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
      <div>
        <Sk className="mb-3 h-7 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
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

/** 区块标题: in-title-big DNA — 左 5px 橙竖条 + 主字 + 橙色副字 + 右更多 */
function PiliSecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <div className="mb-3 flex items-end justify-between border-b pb-2" style={{ borderColor: withAlpha(v.primary, 0.3) }}>
      <h3 className="flex items-center gap-2.5 text-base font-bold leading-none" style={{ color: v.text }}>
        <span className="inline-block h-5 w-1.5" style={{ background: v.primary }} aria-hidden />
        {main}
        <em className="not-italic text-sm" style={{ color: v.primary }}>{sub}</em>
      </h3>
      <span className="flex items-center gap-0.5 text-[11px] transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/** 封面卡 (mod-cover-list DNA: 居中封面 + 书名 + 作者) */
function PiliCoverCard({ book }: { book: BookItem }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <article
      className="group cursor-pointer p-2 transition-shadow"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: v.radius,
        boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
      }}
      {...bookNavProps(navigate, book.id)}
      aria-label={`查看《${book.name}》详情`}
    >
      <div className="relative">
        <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" showAuthor={book.author} />
        <span className="absolute left-1 top-1"><StatusBadge status={book.status} small /></span>
      </div>
      <h4 className="mt-2 truncate text-center text-[13px] font-medium leading-5" style={{ color: v.text }} title={book.name}>{book.name}</h4>
      <p className="truncate text-center text-[11px] leading-4" style={{ color: v.textMuted }}>{book.author}</p>
    </article>
  )
}

/** 橙头排行榜 (in-phlist / in-monrank DNA: 渐变橙头 + 前 3 名橙号) */
function PiliRankPanel({ books }: { books: BookItem[] }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const ranked = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 10)
  if (!ranked.length) return null
  return (
    <section
      data-clone-pili-rank
      aria-label="点击排行"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: v.radius,
        boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
      }}
    >
      <header
        className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold"
        style={{ background: `linear-gradient(90deg, ${v.primary}, ${withAlpha(v.primary, 0.6)})`, color: v.primaryText, borderRadius: `${v.radius} ${v.radius} 0 0` }}
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
              className="flex min-h-[40px] w-full items-center gap-2.5 border-b px-1.5 py-2 text-left transition-colors last:border-b-0 hover:opacity-80"
              style={{ borderColor: withAlpha(v.border, 0.6) }}
              aria-label={`查看排行榜第${i + 1}名《${b.name}》`}
            >
              <span
                className="w-5 shrink-0 text-center text-sm font-bold tabular-nums"
                style={{ color: i < 3 ? v.primary : v.textMuted }}
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

/** 最近更新表格 (in-rise-ta DNA: 时间/分类/书名+最新章) */
function PiliUpdateTable({ books }: { books: BookItem[] }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const rows = books.slice(0, 18)
  if (!rows.length) return null
  return (
    <section data-clone-pili-section="latest" aria-label="最近更新">
      <PiliSecTitle main="最近" sub="更新" />
      <div className="overflow-hidden" style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }}>
        <table data-clone-pili-table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
          <thead>
            <tr style={{ background: v.surfaceAlt, color: v.textMuted }}>
              <th scope="col" className="w-24 whitespace-nowrap px-3 py-2 font-normal">时间</th>
              <th scope="col" className="w-24 whitespace-nowrap px-3 py-2 font-normal">分类</th>
              <th scope="col" className="px-3 py-2 font-normal">书名 / 最新章节</th>
              <th scope="col" className="hidden w-24 px-3 py-2 text-right font-normal sm:table-cell">字数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t" style={{ borderColor: withAlpha(v.border, 0.55) }}>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-[12px]" style={{ color: v.textMuted }}>{fmtDate(b.updatedAt)}</td>
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
                    style={{ color: v.text }}
                    aria-label={`查看《${b.name}》详情`}
                  >
                    <span className="font-medium">《{b.name}》</span>
                    <span className="ml-1.5 text-[12px]" style={{ color: v.textMuted }}>{b.latestChapter || '暂无章节'}</span>
                  </button>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[12px] tabular-nums sm:table-cell" style={{ color: v.textMuted }}>
                  {formatWords(b.wordCount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function HomeClonePilishuwu({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-clone-pili-home><CloneSkeleton /></div>
  if (!books.length) return null

  const featured = books.slice(0, 10)
  const fresh = books.slice(10, 22)

  return (
    <div data-clone-pili-home className="space-y-8">
      {/* 顶 banner: 暖橙渐变 + 站点名 + slogan */}
      <section
        className="relative overflow-hidden px-6 py-8 sm:px-10 sm:py-10"
        style={{
          background: `linear-gradient(135deg, ${v.primary} 0%, ${withAlpha(v.primary, 0.7)} 100%)`,
          borderRadius: v.radius,
        }}
        aria-label="站点欢迎横幅"
      >
        <TrendingUp className="absolute -right-6 -top-6 h-32 w-32 opacity-15" style={{ color: v.primaryText }} aria-hidden />
        <div className="relative max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: v.primaryText, opacity: 0.9 }}>
            霹雳书屋
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-snug sm:text-3xl" style={{ color: v.primaryText }}>
            {site.name} · 免费小说阅读
          </h1>
          {site.description && (
            <p className="mt-2 line-clamp-2 text-sm" style={{ color: v.primaryText, opacity: 0.9 }}>
              {site.description}
            </p>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-6">
        {/* 左主栏 */}
        <div className="min-w-0 flex-1 space-y-8">
          <section data-clone-pili-section="featured" aria-label="精品推荐">
            <PiliSecTitle main="精品" sub="推荐" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {featured.map((b) => <PiliCoverCard key={b.id} book={b} />)}
            </div>
          </section>

          {fresh.length > 0 && (
            <section data-clone-pili-section="fresh" aria-label="最新入库">
              <PiliSecTitle main="最新" sub="入库" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {fresh.map((b) => <PiliCoverCard key={b.id} book={b} />)}
              </div>
            </section>
          )}

          <PiliUpdateTable books={books} />
        </div>

        {/* 右侧栏: 橙头排行榜 + 书屋公告 */}
        <aside className="w-full shrink-0 lg:w-[264px]">
          <PiliRankPanel books={books} />
          <section
            className="mt-4 px-4 py-3 text-xs leading-relaxed"
            style={{
              background: `linear-gradient(180deg, ${withAlpha(v.primary, 0.08)}, ${withAlpha(v.accent, 0.04)})`,
              color: v.textMuted,
              border: `1px solid ${v.border}`,
              borderRadius: v.radius,
            }}
            aria-label="书屋公告"
          >
            <p className="mb-1 font-bold" style={{ color: v.text }}>书屋公告</p>
            <p style={{ opacity: 0.9 }}>本站所有小说均可免费在线阅读, 完结好书持续收录中。使用顶部搜索框可按书名 / 作者查找。</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
