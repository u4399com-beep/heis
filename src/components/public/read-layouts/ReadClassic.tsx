// ============================================================
// 阅读布局 · classic 典书版（仿 guichuideng.info 经典书站 DNA）
// 居中窄栏纸面 + 衬线正文 + 面包屑 + 章节头尾装饰分隔
// + 上一章/目录/下一章 经典三键导航 + 懒加载目录抽屉
// ============================================================
'use client'

import { useState } from 'react'
import { AArrowDown, AArrowUp, ArrowUpToLine, ChevronLeft, ChevronRight, ListTree, Moon, Sun } from 'lucide-react'
import { readOf } from '@/lib/crawl/themes'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { Sk } from '../bits'
import {
  ChapterDeco,
  ChapterEndDeco,
  TocDrawer,
  actualFontPx,
  contentToHtml,
  textureStyle,
  useReadingProgress,
  type ReadLayoutProps,
} from './shared'

export function ReadClassic({ data, loading, fontSize, night, onFontSize, onToggleNight }: ReadLayoutProps) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const read = readOf(theme)
  const [drawer, setDrawer] = useState(false)
  const progress = useReadingProgress(undefined, data?.chapter.id)

  const ch = data?.chapter
  const bk = data?.book

  // 夜间调色（与旧版语义一致：暗主题更沉, 浅主题切深底）
  const panelBg = night
    ? theme.dark
      ? 'rgba(0,0,0,0.45)'
      : '#15171c'
    : v.surface
  const textColor = night ? '#c9cdd4' : v.text
  const titleColor = night ? '#e6e9ee' : v.text
  const metaColor = night ? '#8b929e' : v.textMuted
  const lineColor = night ? 'rgba(255,255,255,0.08)' : withAlpha(v.border, 0.8)
  const decoColor = night ? (theme.dark ? v.accent : '#5a6470') : theme.id === 'paper' || theme.id === 'scrolls' ? v.accent : v.primary

  const fontPx = actualFontPx(fontSize, read)

  const navBtn = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 px-4 text-sm font-medium transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-35 sm:flex-none sm:px-5'

  return (
    <div className="read-layout-classic mx-auto w-full max-w-3xl px-3 py-5 sm:px-6 sm:py-8">
      {/* 阅读进度条 */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5" aria-hidden>
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${v.primary}, ${v.accent})`,
            transition: 'width 80ms linear',
          }}
        />
      </div>

      {/* 文头工具条（inline 形态）: 面包屑式返回 + 字号/夜间/目录 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => bk && navigate({ view: 'book', bookId: bk.id })}
          className="inline-flex min-h-[44px] items-center gap-1 text-sm transition-opacity hover:opacity-70"
          style={{ color: v.primary, fontFamily: v.titleFont }}
          aria-label={`返回《${bk?.name || ''}》书籍页`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {bk?.name || '书籍详情'}
        </button>
        <div className="flex items-center gap-1.5" role="group" aria-label="阅读设置">
          <button
            type="button"
            onClick={() => onFontSize(-1)}
            className="inline-flex h-11 w-11 items-center justify-center transition-opacity hover:opacity-75"
            style={{ color: v.text, border: `1px solid ${lineColor}`, borderRadius: v.radius, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
            aria-label="减小字号"
          >
            <AArrowDown className="h-4 w-4" aria-hidden />
          </button>
          <span className="w-10 text-center text-xs tabular-nums" style={{ color: metaColor }}>{fontPx}px</span>
          <button
            type="button"
            onClick={() => onFontSize(1)}
            className="inline-flex h-11 w-11 items-center justify-center transition-opacity hover:opacity-75"
            style={{ color: v.text, border: `1px solid ${lineColor}`, borderRadius: v.radius, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
            aria-label="增大字号"
          >
            <AArrowUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onToggleNight}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3.5 text-xs font-medium transition-opacity hover:opacity-75"
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
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3.5 text-xs font-medium transition-opacity hover:opacity-75"
            style={{ border: `1px solid ${lineColor}`, color: v.text, borderRadius: v.radius, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
            aria-label="打开章节目录抽屉"
            aria-expanded={drawer}
          >
            <ListTree className="h-3.5 w-3.5" aria-hidden />
            目录
          </button>
        </div>
      </div>

      {/* 纸面正文面板 */}
      <article
        className="px-4 py-7 sm:px-10 sm:py-10"
        style={{
          background: panelBg,
          border: `1px solid ${night ? 'transparent' : v.border}`,
          borderRadius: v.radius,
          boxShadow: night || v.cardShadow === 'none' ? undefined : v.cardShadow,
          ...textureStyle(read.texture, read.texture === 'paper' && !night),
        }}
        aria-label="章节正文"
      >
        {/* 面包屑（guichuideng DNA: 站名 › 书名 › 章节名） */}
        <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: metaColor }} aria-label="面包屑">
          <button type="button" onClick={() => navigate({ view: 'home' })} className="min-h-[44px] transition-opacity hover:opacity-70" style={{ color: 'inherit' }}>
            {site.name}
          </button>
          <span aria-hidden>›</span>
          {bk && (
            <button type="button" onClick={() => navigate({ view: 'book', bookId: bk.id })} className="min-h-[44px] transition-opacity hover:opacity-70" style={{ color: 'inherit' }}>
              《{bk.name}》
            </button>
          )}
          <span aria-hidden>›</span>
          <span className="truncate" style={{ color: v.primary }}>{ch ? ch.title : '…'}</span>
        </nav>

        {loading || !ch || !bk ? (
          <div className="space-y-4 py-4">
            <Sk className="mx-auto h-7 w-1/2" />
            <div className="mx-auto max-w-2xl space-y-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Sk key={i} className="h-4 w-full" style={{ opacity: 1 - i * 0.08 }} />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* 章节头：居中衬线标题 + 装饰分隔 + 出处 */}
            <header className="mb-7 text-center">
              <h1 className="text-xl font-black leading-snug sm:text-2xl" style={{ color: titleColor, fontFamily: v.titleFont }}>
                {ch.title}
              </h1>
              <ChapterDeco kind={read.chapterDeco} color={decoColor} />
              <p className="mt-2.5 text-xs" style={{ color: metaColor }}>
                {bk.name} · {bk.author} · {formatWords(ch.wordCount)}
              </p>
            </header>

            {/* 正文：主题化行宽/行高/缩进/对齐, 内容来自后端清洗白名单 */}
            <div
              className="text-justify"
              style={{
                color: textColor,
                fontFamily: v.fontFamily,
                fontSize: fontPx,
                lineHeight: read.lineHeight,
                maxWidth: read.measure,
                margin: '0 auto',
              }}
            >
              <div
                className={read.indent ? '[&_p]:my-3 [&_p]:indent-8' : '[&_p]:my-4'}
                style={read.justify ? { textAlign: 'justify' } : undefined}
                dangerouslySetInnerHTML={{ __html: contentToHtml(ch.content) || '<p>本章节内容为空</p>' }}
              />
            </div>

            <ChapterEndDeco kind={read.chapterDeco} color={decoColor} />

            {/* 经典三键导航（guichuideng DNA: 虚线上下缘 + 文字键组） */}
            <nav
              className="mt-8 flex flex-wrap items-center justify-center gap-2 border-t border-dashed pt-5 sm:gap-3"
              style={{ borderColor: lineColor }}
              aria-label="章节导航"
            >
              <button
                type="button"
                disabled={!data?.prev}
                onClick={() => data?.prev && navigate({ view: 'read', chapterId: data.prev.id })}
                className={navBtn}
                style={{ border: `1px solid ${lineColor}`, borderRadius: v.radius, color: data?.prev ? v.primary : metaColor, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.55) }}
                aria-label="上一章"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                上一章
              </button>
              <button
                type="button"
                onClick={() => setDrawer(true)}
                className={navBtn}
                style={{ border: `1px solid ${v.primary}`, borderRadius: v.radius, color: v.primary, background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08) }}
                aria-label="打开目录"
              >
                <ListTree className="h-4 w-4" aria-hidden />
                目录
              </button>
              <button
                type="button"
                disabled={!data?.next}
                onClick={() => data?.next && navigate({ view: 'read', chapterId: data.next.id })}
                className={navBtn}
                style={{ border: `1px solid ${lineColor}`, borderRadius: v.radius, color: data?.next ? v.primary : metaColor, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.55) }}
                aria-label="下一章"
              >
                下一章
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex min-h-[44px] items-center gap-1 px-3 text-xs transition-opacity hover:opacity-70"
                style={{ color: metaColor, border: `1px solid ${lineColor}`, borderRadius: v.radius, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.55) }}
                aria-label="回到顶部"
              >
                <ArrowUpToLine className="h-3.5 w-3.5" aria-hidden />
                回顶部
              </button>
            </nav>
          </>
        )}
      </article>

      <TocDrawer open={drawer} onClose={() => setDrawer(false)} bookId={bk?.id} activeChapterId={ch?.id} variant="classic" />
    </div>
  )
}
