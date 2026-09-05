// ============================================================
// 阅读布局公共件 — 三种阅读原型 (classic/immersive/paginated) 共享
// - contentToHtml: 正文渲染白名单兜底（从旧 ReadView 平移, 语义不变）
// - useReadingProgress: 窗口滚动 / 指定滚动容器双模式进度
// - textureStyle: 纸纹 / 暗角氛围
// - ChapterDeco / ChapterEndDeco: 章节头尾装饰分隔
// - TocDrawer: 懒加载分页目录抽屉（classic 右抽屉 / immersive 全屏暗色）
// ============================================================
'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import type { ReadVars } from '@/lib/crawl/themes'
import { fetchBook } from '../data'
import type { ChapterData } from '../types'
import { usePublic } from '../ctx'
import { withAlpha } from '../seo'

/** 三种阅读布局的统一入参（数据与用户偏好由 ReadView 编排, 布局组件只管形态） */
export interface ReadLayoutProps {
  data: ChapterData | null
  loading: boolean
  fontSize: number
  night: boolean
  onFontSize: (delta: number) => void
  onToggleNight: () => void
}

/** 纯文本正文兜底：无 <p>/<br> 的内容按换行切段并转义，避免 \n 被 HTML 塌陷成一行 */
export function contentToHtml(raw: string): string {
  const content = (raw || '').trim()
  if (!content) return ''
  if (/<\s*(p|div|br)\b/i.test(content)) return content
  return content
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<p>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('')
}

/**
 * 阅读进度（0~100）：scrollerRef 为空时监听窗口滚动, 否则监听该容器内部滚动。
 * key 变化（换章/换布局）后自动重测。rAF 节流, 卸载清理。
 */
export function useReadingProgress(scrollerRef?: RefObject<HTMLElement | null>, key?: string): number {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const el = scrollerRef?.current || null
    let raf = 0
    const measure = () => {
      if (el) {
        const max = el.scrollHeight - el.clientHeight
        setProgress(max > 0 ? Math.min(100, Math.max(0, (el.scrollTop / max) * 100)) : 0)
      } else {
        const doc = document.documentElement
        const max = doc.scrollHeight - window.innerHeight
        setProgress(max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0)
      }
    }
    const onScroll = () => {
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        measure()
      })
    }
    measure()
    const target: HTMLElement | Window = el || window
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [key])
  return progress
}

/** 用户字号档（14~24, 默认 17）+ 主题字号基准偏移 → 实际正文 px */
export function actualFontPx(userPx: number, read: ReadVars): number {
  return Math.round(Math.min(28, Math.max(13, userPx + (read.fontBase - 17))))
}

/** 纸面/氛围纹理（叠加在面板或画布上, 夜间关闭） */
export function textureStyle(kind: ReadVars['texture'], show: boolean): CSSProperties | undefined {
  if (!show) return undefined
  if (kind === 'paper') {
    return {
      backgroundImage:
        'radial-gradient(rgba(80,60,30,0.05) 1px, transparent 1.2px), radial-gradient(rgba(80,60,30,0.028) 1px, transparent 1.2px)',
      backgroundSize: '5px 5px, 9px 9px',
      backgroundPosition: '0 0, 3px 4px',
    }
  }
  if (kind === 'vignette') {
    return { boxShadow: 'inset 0 0 140px rgba(0,0,0,0.5)' }
  }
  return undefined
}

/** 章节头装饰分隔（rule=细横线 / ornament=菱形花饰） */
export function ChapterDeco({ kind, color }: { kind: ReadVars['chapterDeco']; color: string }) {
  if (kind === 'ornament') {
    return (
      <div className="mt-3 flex items-center justify-center gap-2" aria-hidden>
        <span className="h-px w-10 sm:w-14" style={{ background: `linear-gradient(90deg, transparent, ${color})` }} />
        <span className="inline-block h-1.5 w-1.5 rotate-45" style={{ background: color }} />
        <span className="h-px w-10 sm:w-14" style={{ background: `linear-gradient(270deg, transparent, ${color})` }} />
      </div>
    )
  }
  if (kind === 'rule') {
    return <span className="mx-auto mt-3 block h-px w-16" style={{ background: color }} aria-hidden />
  }
  return null
}

/** 章节尾装饰（与头呼应的收束符） */
export function ChapterEndDeco({ kind, color }: { kind: ReadVars['chapterDeco']; color: string }) {
  if (kind === 'none') return null
  if (kind === 'ornament') {
    return (
      <div className="mt-10 flex items-center justify-center gap-2" aria-hidden>
        <span className="h-px w-8" style={{ background: withAlpha(color, 0.4) }} />
        <span className="text-xs" style={{ color }}>❦</span>
        <span className="h-px w-8" style={{ background: withAlpha(color, 0.4) }} />
      </div>
    )
  }
  return (
    <div className="mt-10 flex items-center justify-center gap-2" aria-hidden>
      <span className="h-px w-12" style={{ background: `linear-gradient(90deg, transparent, ${withAlpha(color, 0.7)})` }} />
      <span className="inline-block h-1 w-1 rotate-45" style={{ background: withAlpha(color, 0.8) }} />
      <span className="h-px w-12" style={{ background: `linear-gradient(270deg, transparent, ${withAlpha(color, 0.7)})` }} />
    </div>
  )
}

/* ---------------- 目录抽屉 ---------------- */

interface TocEntry {
  id: string
  idx: number
  title: string
  volume?: string
}

/** 懒加载分页目录抽屉: 打开时才拉取目录（100 条/页, 页内翻页） */
export function TocDrawer({
  open,
  onClose,
  bookId,
  activeChapterId,
  variant,
}: {
  open: boolean
  onClose: () => void
  bookId?: string
  activeChapterId?: string
  variant: 'classic' | 'immersive'
}) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  // 分页加载态: loaded 记录"哪一页的数据", 请求页与展示页不一致即视为加载中
  // (避免在 effect 体内同步 setState, react-hooks/set-state-in-effect)
  const [loaded, setLoaded] = useState<{ page: number; entries: TocEntry[]; totalPages: number; total: number } | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!open || !bookId) return
    let alive = true
    fetchBook(bookId, page, 100)
      .then((d) => {
        if (!alive) return
        setLoaded({
          page,
          entries: d.chapters.map((c) => ({ id: c.id, idx: c.idx, title: c.title, volume: c.volume })),
          totalPages: d.tocTotalPages,
          total: d.tocTotal,
        })
      })
      .catch(() => {
        if (!alive) return
        setLoaded({ page, entries: [], totalPages: 1, total: 0 })
      })
    return () => {
      alive = false
    }
  }, [open, bookId, page])

  const pending = !loaded || loaded.page !== page
  const entries = loaded && loaded.page === page ? loaded.entries : null
  const totalPages = loaded && loaded.page === page ? loaded.totalPages : 1
  const total = loaded && loaded.page === page ? loaded.total : 0

  // Escape 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const goChapter = useCallback(
    (id: string) => {
      onClose()
      navigate({ view: 'read', chapterId: id })
    },
    [navigate, onClose],
  )

  if (!open) return null

  const dark = variant === 'immersive'
  const panelBg = dark ? '#14181d' : v.surface
  const panelBorder = dark ? 'rgba(255,255,255,0.1)' : v.border
  const activeBg = withAlpha(v.primary, dark ? 0.28 : 0.12)

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="章节目录">
      {/* 遮罩 */}
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="关闭目录"
        tabIndex={-1}
      />
      {/* 抽屉面板：右侧滑出, immersive 变体走暗色 */}
      <aside
        className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l shadow-2xl"
        style={{ background: panelBg, borderColor: panelBorder, color: dark ? '#d9dce1' : v.text, fontFamily: v.fontFamily }}
      >
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: panelBorder }}>
          <div className="min-w-0">
            <p className="text-sm font-bold">章节目录</p>
            {total > 0 && (
              <p className="mt-0.5 text-[11px] tabular-nums opacity-60">
                共 {total} 章 · 第 {page}/{totalPages} 页
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center transition-opacity hover:opacity-70"
            aria-label="关闭目录"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {pending || !entries ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm opacity-60">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              目录加载中…
            </div>
          ) : entries.length === 0 ? (
            <p className="py-16 text-center text-sm opacity-60">暂无章节</p>
          ) : (
            <ol>
              {(() => {
                // 目录单条渲染(分卷/非分卷两分支共用, 标记与改前一致)
                const renderEntry = (c: TocEntry) => {
                  const active = c.id === activeChapterId
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => goChapter(c.id)}
                        className="flex min-h-[44px] w-full items-baseline gap-2.5 rounded px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-black/5"
                        style={active ? { background: activeBg, color: v.primary } : undefined}
                        aria-current={active ? 'true' : undefined}
                      >
                        <span className="w-9 shrink-0 text-right text-[11px] tabular-nums opacity-55">{String(c.idx).padStart(2, '0')}</span>
                        <span className="line-clamp-1 flex-1">{c.title}</span>
                      </button>
                    </li>
                  )
                }

                // 分卷分组(kk-a): 仅当本页出现卷名才启用(连续相同 volume 一组);
                // 旧书全空卷 → 平铺与改前完全一致(零回归)
                if (!entries.some((e) => e.volume)) return entries.map(renderEntry)
                const gs: { volume: string; entries: TocEntry[] }[] = []
                for (const e of entries) {
                  const vol = e.volume || ''
                  const last = gs[gs.length - 1]
                  if (last && last.volume === vol) last.entries.push(e)
                  else gs.push({ volume: vol, entries: [e] })
                }
                return gs.map((g, gi) => (
                  <Fragment key={`vol-${gi}-${g.volume}`}>
                    <li data-vol-head className="list-none">
                      <div className="flex items-center gap-2 px-2.5 pb-1 pt-3">
                        {/* min-w-0+break-all: 抽屉窄容器下超长卷名可断行, 防溢出 */}
                        <span className="min-w-0 break-all text-[11px] font-bold tracking-[0.2em]" style={{ color: v.primary }}>
                          {g.volume || '正文'}
                        </span>
                        <span className="h-px flex-1" style={{ background: withAlpha(v.primary, dark ? 0.25 : 0.18) }} aria-hidden />
                        <span className="text-[10px] tabular-nums opacity-50">{g.entries.length}章</span>
                      </div>
                    </li>
                    {g.entries.map(renderEntry)}
                  </Fragment>
                ))
              })()}
            </ol>
          )}
        </div>

        {/* 页内翻页 */}
        {totalPages > 1 && (
          <nav
            className="flex items-center justify-between gap-2 border-t px-3 py-2.5"
            style={{ borderColor: panelBorder }}
            aria-label="目录翻页"
          >
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex min-h-[36px] items-center gap-1 rounded px-3 text-xs transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-35"
              style={{ border: `1px solid ${panelBorder}` }}
              aria-label="上一页目录"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              上一页
            </button>
            <span className="text-xs tabular-nums opacity-60">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex min-h-[36px] items-center gap-1 rounded px-3 text-xs transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-35"
              style={{ border: `1px solid ${panelBorder}` }}
              aria-label="下一页目录"
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </nav>
        )}
      </aside>
    </div>
  )
}
