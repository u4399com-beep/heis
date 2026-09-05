// ============================================================
// 阅读布局 · paginated 分页横滑型
// 固定高度舞台 + CSS 多列分页 + 横向滑动/点按翻页
// + 页码指示与页进度 + 侧翼点按热区 + 底部工具条/翻章
// ============================================================
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AArrowDown, AArrowUp, ChevronLeft, ChevronRight, ListTree, Moon, Sun } from 'lucide-react'
import { readOf } from '@/lib/crawl/themes'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { Sk } from '../bits'
import {
  ChapterDeco,
  TocDrawer,
  actualFontPx,
  contentToHtml,
  textureStyle,
  type ReadLayoutProps,
} from './shared'

export function ReadPaginated({ data, loading, fontSize, night, onFontSize, onToggleNight }: ReadLayoutProps) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const read = readOf(theme)
  const stageRef = useRef<HTMLDivElement>(null)
  const [pageIdx, setPageIdx] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [drawer, setDrawer] = useState(false)
  const snapTimer = useRef(0)

  const ch = data?.chapter
  const bk = data?.book

  // 夜间调色（与旧版语义一致）
  const stageBg = night ? (theme.dark ? 'rgba(0,0,0,0.45)' : '#15171c') : v.surface
  const textColor = night ? '#c9cdd4' : v.text
  const titleColor = night ? '#e6e9ee' : v.text
  const metaColor = night ? '#8b929e' : v.textMuted
  const lineColor = night ? 'rgba(255,255,255,0.08)' : withAlpha(v.border, 0.8)
  const decoColor = night ? (theme.dark ? v.accent : '#5a6470') : v.primary

  const fontPx = actualFontPx(fontSize, read)

  /** 页数测量：scrollWidth / clientWidth（列宽+列距已含在内容排布里） */
  const measure = useCallback(() => {
    const el = stageRef.current
    if (!el || el.clientWidth === 0) return
    const pages = Math.max(1, Math.round(el.scrollWidth / el.clientWidth))
    setPageCount(pages)
    // setState updater 保持纯函数(与 TaskMonitor.applyTuning 同款纪律), 吸附副作用置于 updater 外:
    // 以滚动位置反推钳制后的目标页, 与 updater 内计算等价(updater 本身亦由 scrollLeft 取整派生)
    setPageIdx((idx) => Math.min(idx, pages - 1))
    const clampedIdx = Math.min(pages - 1, Math.round(el.scrollLeft / el.clientWidth))
    const target = clampedIdx * el.clientWidth
    if (Math.abs(el.scrollLeft - target) > 2) el.scrollTo({ left: target })
  }, [])

  // 数据/字号变化后等一帧排版完成再测, 并监听窗口尺寸
  useEffect(() => {
    const raf = window.requestAnimationFrame(measure)
    const t = window.setTimeout(measure, 220)
    window.addEventListener('resize', measure)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(t)
      window.removeEventListener('resize', measure)
    }
  }, [measure, data?.chapter.id, fontSize, loading])

  // 吸附定时器随卸载清理: 卸载后 160ms 定时器仍会对 detached 舞台 scrollTo(无害空转, 卫生级)
  useEffect(() => {
    return () => window.clearTimeout(snapTimer.current)
  }, [])

  const goPage = useCallback((dir: 1 | -1) => {
    const el = stageRef.current
    if (!el) return
    const pages = Math.max(1, Math.round(el.scrollWidth / el.clientWidth))
    const idx = Math.round(el.scrollLeft / el.clientWidth)
    const next = idx + dir
    if (next < 0 || next > pages - 1) return
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
  }, [])

  // 滚动同步页码 + 停止后吸附到整页（吸收触摸板惯性残量）
  const onStageScroll = () => {
    const el = stageRef.current
    if (!el || el.clientWidth === 0) return
    setPageIdx(Math.min(pageCount - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))))
    window.clearTimeout(snapTimer.current)
    snapTimer.current = window.setTimeout(() => {
      const target = Math.round(el.scrollLeft / el.clientWidth) * el.clientWidth
      if (Math.abs(el.scrollLeft - target) > 2) el.scrollTo({ left: target, behavior: 'smooth' })
    }, 160)
  }

  // 键盘翻页（舞台聚焦时）
  const onStageKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault()
      goPage(1)
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      goPage(-1)
    }
  }

  // 侧翼热区/按钮翻页: 越界即翻章（分页阅读器惯例）
  const step = (dir: 1 | -1) => {
    const el = stageRef.current
    if (!el) return
    const idx = Math.round(el.scrollLeft / el.clientWidth)
    if (dir === 1 && idx >= pageCount - 1) {
      if (data?.next) navigate({ view: 'read', chapterId: data.next.id })
      return
    }
    if (dir === -1 && idx <= 0) {
      if (data?.prev) navigate({ view: 'read', chapterId: data.prev.id })
      return
    }
    goPage(dir)
  }

  const pill =
    'inline-flex min-h-[44px] items-center justify-center gap-1.5 px-3.5 text-xs font-medium transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-35'
  const iconPill =
    'inline-flex h-11 w-11 items-center justify-center transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-30'

  const pct = Math.round(((pageIdx + 1) / pageCount) * 100)

  return (
    <div className="read-layout-paginated mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      {/* 页进度条（页码驱动, 与滚动布局区分） */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5" aria-hidden>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${v.primary}, ${v.accent})`,
            transition: 'width 120ms linear',
          }}
        />
      </div>

      {/* 文头工具条: 返回 + 字号/夜间/目录 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => bk && navigate({ view: 'book', bookId: bk.id })}
          className="inline-flex min-h-[44px] items-center gap-1 text-sm transition-opacity hover:opacity-70"
          style={{ color: v.primary }}
          aria-label={`返回《${bk?.name || ''}》书籍页`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {bk?.name || '书籍详情'}
        </button>
        <div className="flex items-center gap-1.5" role="group" aria-label="阅读设置">
          <button
            type="button"
            onClick={() => onFontSize(-1)}
            className={iconPill}
            style={{ color: v.text, border: `1px solid ${lineColor}`, borderRadius: v.radius, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
            aria-label="减小字号"
          >
            <AArrowDown className="h-4 w-4" aria-hidden />
          </button>
          <span className="w-10 text-center text-xs tabular-nums" style={{ color: metaColor }}>{fontPx}px</span>
          <button
            type="button"
            onClick={() => onFontSize(1)}
            className={iconPill}
            style={{ color: v.text, border: `1px solid ${lineColor}`, borderRadius: v.radius, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
            aria-label="增大字号"
          >
            <AArrowUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onToggleNight}
            className={pill}
            style={{
              background: night ? v.primary : withAlpha(v.surfaceAlt, 0.6),
              color: night ? v.primaryText : v.text,
              border: `1px solid ${night ? v.primary : lineColor}`,
              borderRadius: v.radius,
            }}
            aria-label={night ? '切换日间模式' : '切换夜间模式'}
            aria-pressed={night}
          >
            {night ? <Sun className="h-3.5 w-3.5" aria-hidden /> : <Moon className="h-3.5 w-3.5" aria-hidden />}
            {night ? '日间' : '夜间'}
          </button>
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className={pill}
            style={{ border: `1px solid ${lineColor}`, color: v.text, borderRadius: v.radius, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
            aria-label="打开章节目录抽屉"
            aria-expanded={drawer}
          >
            <ListTree className="h-3.5 w-3.5" aria-hidden />
            目录
          </button>
        </div>
      </div>

      {/* 章节题头（左对齐, 与典书版居中制式区分） */}
      {loading || !ch || !bk ? (
        <div className="mb-4 space-y-2">
          <Sk className="h-7 w-2/3" />
          <Sk className="h-3 w-1/3" />
        </div>
      ) : (
        <header className="mb-4">
          <h1 className="text-xl font-black leading-snug sm:text-2xl" style={{ color: titleColor, fontFamily: v.titleFont }}>
            {ch.title}
          </h1>
          <ChapterDeco kind={read.chapterDeco === 'ornament' ? 'rule' : read.chapterDeco} color={decoColor} />
          <p className="mt-2 text-xs" style={{ color: metaColor }}>
            {bk.name} · {bk.author} · {formatWords(ch.wordCount)}
          </p>
        </header>
      )}

      {/* 分页舞台：固定高度 + 多列横滑 */}
      <div
        className="relative overflow-hidden"
        style={{
          height: 'min(72vh, 760px)',
          background: stageBg,
          border: `1px solid ${night ? 'transparent' : v.border}`,
          borderRadius: v.radius,
          boxShadow: night || v.cardShadow === 'none' ? undefined : v.cardShadow,
        }}
      >
        <div
          ref={stageRef}
          onScroll={onStageScroll}
          onKeyDown={onStageKey}
          tabIndex={0}
          role="region"
          aria-label={`章节正文, 共 ${pageCount} 页, 当前第 ${pageIdx + 1} 页`}
          className="reader-cols h-full w-full overflow-x-auto overflow-y-hidden outline-none [scrollbar-width:thin]"
          style={{
            columnWidth: read.measure,
            columnGap: 56,
            columnFill: 'auto',
            color: textColor,
            fontSize: fontPx,
            lineHeight: read.lineHeight,
            ...textureStyle(read.texture, read.texture === 'vignette' && !night),
          }}
        >
          <div className="h-full py-6 pl-6 pr-10 sm:py-8 sm:pl-8 sm:pr-12">
            {loading || !ch || !bk ? (
              <div className="space-y-4" style={{ maxWidth: read.measure }}>
                {Array.from({ length: 14 }).map((_, i) => (
                  <Sk key={i} className="h-4 w-full" style={{ opacity: 1 - i * 0.05 }} />
                ))}
              </div>
            ) : (
              <div
                className={read.indent ? '[&_p]:my-2.5 [&_p]:indent-8' : '[&_p]:my-3.5'}
                style={read.justify ? { textAlign: 'justify' } : undefined}
                dangerouslySetInnerHTML={{ __html: contentToHtml(ch.content) || '<p>本章节内容为空</p>' }}
              />
            )}
          </div>
        </div>

        {/* 侧翼点按热区（移动端隐形, 桌面悬停显现箭头） */}
        <button
          type="button"
          onClick={() => step(-1)}
          className="group absolute inset-y-0 left-0 z-10 flex w-[14%] items-center justify-start pl-1 sm:pl-2"
          aria-label="上一页"
        >
          <span
            className="inline-flex h-11 w-11 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-70"
            style={{ background: withAlpha(v.primary, 0.14), color: v.primary }}
            aria-hidden
          >
            <ChevronLeft className="h-5 w-5" />
          </span>
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          className="group absolute inset-y-0 right-0 z-10 flex w-[14%] items-center justify-end pr-1 sm:pr-2"
          aria-label="下一页"
        >
          <span
            className="inline-flex h-11 w-11 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-70"
            style={{ background: withAlpha(v.primary, 0.14), color: v.primary }}
            aria-hidden
          >
            <ChevronRight className="h-5 w-5" />
          </span>
        </button>
      </div>

      {/* 底部工具条（bottom 形态）: 页码 + 翻章 */}
      <nav className="mt-4 flex items-center justify-between gap-2" aria-label="章节导航">
        <button
          type="button"
          disabled={!data?.prev}
          onClick={() => data?.prev && navigate({ view: 'read', chapterId: data.prev.id })}
          className={pill}
          style={{ border: `1px solid ${lineColor}`, borderRadius: v.radius, color: data?.prev ? v.text : metaColor, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
          aria-label="上一章"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          上一章
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => step(-1)}
            className={iconPill}
            style={{ border: `1px solid ${lineColor}`, borderRadius: v.radius, color: v.text, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
            aria-label="上一页"
            disabled={pageIdx <= 0}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="min-w-16 text-center text-xs tabular-nums" style={{ color: metaColor }}>
            {pageIdx + 1} / {pageCount} 页
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            className={iconPill}
            style={{ border: `1px solid ${lineColor}`, borderRadius: v.radius, color: v.text, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
            aria-label="下一页"
            disabled={pageIdx >= pageCount - 1 && !data?.next}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          disabled={!data?.next}
          onClick={() => data?.next && navigate({ view: 'read', chapterId: data.next.id })}
          className={pill}
          style={{ border: `1px solid ${lineColor}`, borderRadius: v.radius, color: data?.next ? v.text : metaColor, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
          aria-label="下一章"
        >
          下一章
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </nav>

      <TocDrawer open={drawer} onClose={() => setDrawer(false)} bookId={bk?.id} activeChapterId={ch?.id} variant="classic" />
    </div>
  )
}
