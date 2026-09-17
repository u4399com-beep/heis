// ============================================================
// 首页布局 · biquge（仿笔趣阁 biquge.com 经典表格风格）
// 白底直角卡 + 表格式书籍列表 + 绿色书名链接 + 类别/最新章节/更新时间分列
// 设计参考: 笔趣阁站典型 home table 布局, 适配主题配色(可由 combo 主题驱动)
// ============================================================
'use client'

import type { BookItem } from '../types'
import { usePublic } from '../ctx'
import { fmtDate, formatWords, withAlpha } from '../seo'
import { bookNavProps, Sk, StatusBadge } from '../bits'
import { BookOpen, ChevronRight } from 'lucide-react'

function BiqugeSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Sk className="mb-3 h-7 w-32" />
        <div className="space-y-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <Sk key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
      <div>
        <Sk className="mb-3 h-7 w-32" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Sk key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** 区块标题: 左竖条 + 主标题 + 右侧"更多"链接 */
function BiqugeSecTitle({ main, sub }: { main: string; sub: string }) {
  const v = usePublic().theme.vars
  return (
    <div
      className="mb-3 flex items-end justify-between border-b pb-2"
      style={{ borderColor: withAlpha(v.primary, 0.3) }}
    >
      <h3 className="flex items-center gap-2 text-base font-bold leading-none" style={{ color: v.text }}>
        <span className="inline-block h-4 w-1" style={{ background: v.primary }} aria-hidden />
        {main}
        <em className="not-italic text-sm" style={{ color: v.primary }}>{sub}</em>
      </h3>
      <span className="flex items-center gap-0.5 text-[11px] transition-opacity hover:opacity-70" style={{ color: v.textMuted }} aria-hidden>
        更多 <ChevronRight className="h-3 w-3" />
      </span>
    </div>
  )
}

/** 最新更新表格: 笔趣阁 DNA 表格式 (类别/书名+最新章节/字数/更新时间/状态) */
function BiqugeUpdateTable({ books }: { books: BookItem[] }) {
  const { navigate } = usePublic()
  const v = usePublic().theme.vars
  const rows = books.slice(0, 18)
  if (!rows.length) return null
  return (
    <section data-biquge-section="latest-updates" aria-label="最近更新">
      <BiqugeSecTitle main="最新" sub="更新" />
      <div
        className="overflow-x-auto"
        style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }}
      >
        <table data-biquge-table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
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
                className="border-t transition-colors hover:bg-[rgba(0,0,0,0.02)]"
                style={{ borderColor: withAlpha(v.border, 0.55) }}
              >
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

/** 最新入库: 简洁直角小卡列表(书名+作者+类别), 笔趣阁风格 */
function BiqugeFreshList({ books }: { books: BookItem[] }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const fresh = books.slice(18, 30)
  if (!fresh.length) return null
  return (
    <section data-biquge-section="fresh" aria-label="最新入库">
      <BiqugeSecTitle main="最新" sub="入库" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {fresh.map((b) => (
          <article
            key={b.id}
            className="cursor-pointer p-2 transition-colors hover:bg-[rgba(0,0,0,0.02)]"
            style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }}
            {...bookNavProps(navigate, b.id)}
            aria-label={`查看《${b.name}》详情`}
          >
            <h4 className="truncate text-[13px] font-medium" style={{ color: v.primary }} title={b.name}>
              《{b.name}》
            </h4>
            <p className="mt-0.5 flex items-center justify-between text-[11px]">
              <span className="truncate" style={{ color: v.textMuted }}>{b.author}</span>
              <span className="shrink-0" style={{ color: v.accent }}>{b.category}</span>
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

export function HomeBiquge({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { site, theme } = usePublic()
  const v = theme.vars

  if (loading) return <div data-biquge-home><BiqugeSkeleton /></div>
  if (!books.length) return null

  // 简单报头: 站点名 + slogan (笔趣阁风格居左)
  return (
    <div data-biquge-home className="space-y-8">
      <header className="flex items-center gap-2.5 border-b pb-3" style={{ borderColor: withAlpha(v.primary, 0.3) }}>
        <BookOpen className="h-5 w-5" style={{ color: v.primary }} aria-hidden />
        <h2 className="text-lg font-bold tracking-wide" style={{ color: v.text }}>
          {site.name}
        </h2>
        <span className="ml-auto text-[11px]" style={{ color: v.textMuted }}>
          共 {books.length} 本
        </span>
      </header>

      <BiqugeUpdateTable books={books} />
      <BiqugeFreshList books={books} />
    </div>
  )
}
