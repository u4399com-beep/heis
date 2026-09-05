// ============================================================
// 阅读布局 · immersive 沉浸暗色（仿 uaa.com 阅读器公知特征）
// 全屏暗底接管 + 大字号高行距 + 顶部进度线 + 底部翻章条
// + 悬浮字号胶囊 + 滚动自动收纳 chrome + 暗色目录抽屉
// ============================================================
'use client'

import { useEffect, useRef, useState } from 'react'
import { AArrowDown, AArrowUp, ArrowUpToLine, ChevronLeft, ChevronRight, ListTree, Moon, Sun } from 'lucide-react'
import { readOf } from '@/lib/crawl/themes'
import { usePublic } from '../ctx'
import { formatWords } from '../seo'
import { Sk } from '../bits'
import {
  TocDrawer,
  actualFontPx,
  contentToHtml,
  textureStyle,
  useReadingProgress,
  type ReadLayoutProps,
} from './shared'

export function ReadImmersive({ data, loading, fontSize, night, onFontSize, onToggleNight }: ReadLayoutProps) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const read = readOf(theme)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [drawer, setDrawer] = useState(false)
  const [chromeHidden, setChromeHidden] = useState(false)
  const lastY = useRef(0)
  const progress = useReadingProgress(scrollerRef, data?.chapter.id)

  const ch = data?.chapter
  const bk = data?.book

  // 沉浸画布配色：始终暗底（浅色主题也转入暗色画布）; night = 墨黑加深
  const canvas = night ? '#000000' : theme.dark ? undefined : '#14171c'
  const textColor = night ? '#b9bfc7' : theme.dark ? v.text : '#d7dade'
  const metaColor = night ? '#767d87' : theme.dark ? v.textMuted : '#8a919c'
  const hairline = night ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.12)'
  const pillBg = night ? 'rgba(20,22,26,0.92)' : theme.dark ? 'rgba(10,10,14,0.66)' : 'rgba(16,18,22,0.78)'

  const fontPx = actualFontPx(fontSize, read)

  // 接管滚动：锁定 body, 卸载还原
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // 滚动方向驱动的 chrome 自动收纳（下滚收起 / 上滚唤出）
  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const y = el.scrollTop
    const dy = y - lastY.current
    if (dy > 6 && y > 80) setChromeHidden(true)
    else if (dy < -6) setChromeHidden(false)
    lastY.current = y
  }

  const navBtn =
    'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium backdrop-blur transition-all hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30 sm:flex-none sm:px-6'

  return (
    <div
      className="read-layout-immersive fixed inset-0 z-40 flex flex-col"
      style={{
        background: canvas || v.bg,
        color: textColor,
        fontFamily: v.fontFamily,
        ...textureStyle(read.texture, read.texture === 'vignette' && !night),
      }}
      aria-label="沉浸阅读"
    >
      {/* 顶部进度线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5" aria-hidden>
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${v.primary}, ${v.accent})`,
            transition: 'width 80ms linear',
            boxShadow: `0 0 8px ${v.primary}`,
          }}
        />
      </div>

      {/* 顶栏：返回 + 书名章节 + 目录（滚动收纳） */}
      <header
        className={`relative z-10 flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-4 transition-all duration-300 sm:px-6 ${
          chromeHidden ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => bk && navigate({ view: 'book', bookId: bk.id })}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full px-3 text-sm backdrop-blur transition-opacity hover:opacity-75"
          style={{ background: pillBg, color: textColor, border: `1px solid ${hairline}` }}
          aria-label={`退出沉浸阅读, 返回《${bk?.name || ''}》书籍页`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="max-w-[9rem] truncate sm:max-w-[14rem]">{bk?.name || '书籍详情'}</span>
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-xs" style={{ color: metaColor }}>
          {bk ? `第${ch ? ch.idx : '…'}章` : ''} {ch ? `· ${ch.title}` : ''}
        </p>
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium backdrop-blur transition-opacity hover:opacity-75"
          style={{ background: pillBg, color: textColor, border: `1px solid ${hairline}` }}
          aria-label="打开章节目录"
          aria-expanded={drawer}
        >
          <ListTree className="h-3.5 w-3.5" aria-hidden />
          目录
        </button>
      </header>

      {/* 正文滚动容器（沉浸式使用内部滚动, 进度按容器计） */}
      <div ref={scrollerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <article className="mx-auto w-full px-5 pb-40 pt-6 sm:px-8" aria-label="章节正文">
          {loading || !ch || !bk ? (
            <div className="space-y-5 pt-6">
              <Sk className="mx-auto h-8 w-2/3" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
              {Array.from({ length: 10 }).map((_, i) => (
                <Sk key={i} className="mx-auto h-4 w-full" style={{ backgroundColor: 'rgba(255,255,255,0.1)', opacity: 1 - i * 0.07 }} />
              ))}
            </div>
          ) : (
            <>
              <header className="mb-8">
                <p className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: v.primary }}>
                  {bk.name}
                </p>
                <h1 className="mt-2 text-2xl font-black leading-snug sm:text-3xl" style={{ color: textColor, fontFamily: v.titleFont }}>
                  {ch.title}
                </h1>
                <p className="mt-2 text-xs" style={{ color: metaColor }}>
                  {bk.author} · {formatWords(ch.wordCount)} · 第 {ch.idx} 章
                </p>
                <span className="mt-5 block h-px w-full" style={{ background: hairline }} aria-hidden />
              </header>

              {/* 大字号高行距正文（uaa DNA）, 内容来自后端清洗白名单 */}
              <div
                style={{
                  color: textColor,
                  fontSize: fontPx,
                  lineHeight: read.lineHeight,
                  maxWidth: read.measure,
                  margin: '0 auto',
                }}
              >
                <div
                  className="[&_p]:my-5"
                  dangerouslySetInnerHTML={{ __html: contentToHtml(ch.content) || '<p>本章节内容为空</p>' }}
                />
              </div>

              {/* 章末：翻章大按钮 + 回顶部 */}
              <div className="mx-auto mt-14 flex max-w-xl flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={!data?.prev}
                  onClick={() => data?.prev && navigate({ view: 'read', chapterId: data.prev.id })}
                  className={navBtn}
                  style={{ background: pillBg, color: textColor, border: `1px solid ${hairline}` }}
                  aria-label="上一章"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  上一章
                </button>
                <button
                  type="button"
                  disabled={!data?.next}
                  onClick={() => data?.next && navigate({ view: 'read', chapterId: data.next.id })}
                  className={navBtn}
                  style={{ background: `linear-gradient(120deg, ${v.primary}, ${v.accent})`, color: v.primaryText, border: 'none' }}
                  aria-label="下一章"
                >
                  下一章
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="inline-flex min-h-[44px] items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                  style={{ color: metaColor }}
                  aria-label="回到顶部"
                >
                  <ArrowUpToLine className="h-3.5 w-3.5" aria-hidden />
                  回顶部
                </button>
              </div>
            </>
          )}
        </article>
      </div>

      {/* 底部翻章条（滚动收纳） */}
      <footer
        className={`relative z-10 shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 transition-all duration-300 sm:px-6 ${
          chromeHidden ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'
        }`}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            disabled={!data?.prev}
            onClick={() => data?.prev && navigate({ view: 'read', chapterId: data.prev.id })}
            className={navBtn}
            style={{ background: pillBg, color: textColor, border: `1px solid ${hairline}` }}
            aria-label="上一章"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            上一章
          </button>
          {/* 阅读进度感（百分比） */}
          <span className="hidden w-14 shrink-0 text-center text-xs tabular-nums sm:inline" style={{ color: metaColor }} aria-hidden>
            {Math.round(progress)}%
          </span>
          <button
            type="button"
            disabled={!data?.next}
            onClick={() => data?.next && navigate({ view: 'read', chapterId: data.next.id })}
            className={navBtn}
            style={{ background: pillBg, color: textColor, border: `1px solid ${hairline}` }}
            aria-label="下一章"
          >
            下一章
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </footer>

      {/* 悬浮字号/墨黑胶囊（不随滚动收纳, 常驻控制） */}
      <div
        className="absolute bottom-24 right-4 z-20 flex flex-col items-center gap-1 rounded-full px-1.5 py-1.5 backdrop-blur sm:bottom-28 sm:right-6"
        style={{ background: pillBg, border: `1px solid ${hairline}` }}
        role="group"
        aria-label="阅读设置"
      >
        <button
          type="button"
          onClick={() => onFontSize(-1)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-opacity hover:opacity-75"
          style={{ color: textColor }}
          aria-label="减小字号"
        >
          <AArrowDown className="h-4 w-4" aria-hidden />
        </button>
        <span className="w-8 text-center text-[10px] tabular-nums" style={{ color: metaColor }}>{fontPx}</span>
        <button
          type="button"
          onClick={() => onFontSize(1)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-opacity hover:opacity-75"
          style={{ color: textColor }}
          aria-label="增大字号"
        >
          <AArrowUp className="h-4 w-4" aria-hidden />
        </button>
        <span className="my-0.5 h-px w-6" style={{ background: hairline }} aria-hidden />
        <button
          type="button"
          onClick={onToggleNight}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-opacity hover:opacity-75"
          style={{ color: night ? v.primary : textColor }}
          aria-label={night ? '切换默认暗色' : '切换墨黑模式'}
          aria-pressed={night}
        >
          {night ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
        </button>
      </div>

      <TocDrawer open={drawer} onClose={() => setDrawer(false)} bookId={bk?.id} activeChapterId={ch?.id} variant="immersive" />
    </div>
  )
}
