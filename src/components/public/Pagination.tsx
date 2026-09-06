// ============================================================
// 主题化分页控件（页码按钮，total/size 计算总数；越界钳制 + 首末页省略号）
// ============================================================
'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CSSProperties } from 'react'
import { usePublic } from './ctx'
import { withAlpha } from './seo'

function pageWindow(page: number, total: number): number[] {
  const span = 5
  let start = Math.max(1, page - Math.floor(span / 2))
  const end = Math.min(total, start + span - 1)
  start = Math.max(1, end - span + 1)
  const arr: number[] = []
  for (let i = start; i <= end; i++) arr.push(i)
  return arr
}

export function Pagination({
  page,
  total,
  size,
  onPage,
  center,
}: {
  page: number
  total: number
  size: number
  onPage: (p: number) => void
  center?: boolean
}) {
  const { theme } = usePublic()
  const v = theme.vars
  const totalPages = Math.max(1, Math.ceil(total / size))
  if (totalPages <= 1) return null
  // 数据收缩后 page 可能越界，钳制后再渲染，保证当前页高亮/禁用态正确
  const cur = Math.min(Math.max(1, page), totalPages)
  const pages = pageWindow(cur, totalPages)
  const ellipsisLeft = pages[0] > 1
  const ellipsisRight = pages[pages.length - 1] < totalPages

  const btn = (active: boolean): CSSProperties => ({
    background: active ? v.primary : v.surface,
    color: active ? v.primaryText : v.text,
    border: `1px solid ${active ? v.primary : v.border}`,
    borderRadius: v.radius,
  })
  const dots = (
    <span className="px-1 text-xs tabular-nums" style={{ color: v.textMuted }} aria-hidden>
      …
    </span>
  )

  return (
    <nav
      className={`flex flex-wrap items-center gap-2 py-6 ${center ? 'justify-center' : ''}`}
      aria-label="分页导航"
    >
      <button
        type="button"
        disabled={cur <= 1}
        onClick={() => onPage(cur - 1)}
        className="inline-flex h-8 w-8 items-center justify-center transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
        style={btn(false)}
        aria-label="上一页"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      {ellipsisLeft && (
        <>
          <button
            type="button"
            onClick={() => onPage(1)}
            className="h-8 min-w-8 px-2 text-sm font-medium tabular-nums transition-opacity hover:opacity-80"
            style={btn(cur === 1)}
            aria-label="第 1 页"
          >
            1
          </button>
          {dots}
        </>
      )}
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPage(p)}
          className="h-8 min-w-8 px-2 text-sm font-medium tabular-nums transition-opacity hover:opacity-80"
          style={{ ...btn(p === cur), ...(p === cur ? { boxShadow: `0 0 0 3px ${withAlpha(v.primary, 0.18)}` } : {}) }}
          aria-label={`第 ${p} 页`}
          aria-current={p === cur ? 'page' : undefined}
        >
          {p}
        </button>
      ))}
      {ellipsisRight && (
        <>
          {dots}
          <button
            type="button"
            onClick={() => onPage(totalPages)}
            className="h-8 min-w-8 px-2 text-sm font-medium tabular-nums transition-opacity hover:opacity-80"
            style={btn(cur === totalPages)}
            aria-label={`第 ${totalPages} 页`}
          >
            {totalPages}
          </button>
        </>
      )}
      <button
        type="button"
        disabled={cur >= totalPages}
        onClick={() => onPage(cur + 1)}
        className="inline-flex h-8 w-8 items-center justify-center transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
        style={btn(false)}
        aria-label="下一页"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
      <span className="ml-1 text-xs" style={{ color: v.textMuted }}>
        共 {totalPages} 页 · {total} 本
      </span>
    </nav>
  )
}
