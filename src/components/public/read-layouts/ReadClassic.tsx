// ============================================================
// 阅读布局 · classic 典书版（仿 guichuideng.info 经典书站 DNA）
// 居中窄栏纸面 + 衬线正文 + 面包屑 + 章节头尾装饰分隔
// + 上一章/目录/下一章 经典三键导航 + 懒加载目录抽屉
// + feat-a: 阅读位置记忆 / 书签 / 行距·字距控制 (统一设置面板)
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowUpToLine, ChevronLeft, ChevronRight, ListTree } from 'lucide-react'
import { readOf } from '@/lib/crawl/themes'
import { usePublic } from '../ctx'
import { formatWords, withAlpha } from '../seo'
import { Sk } from '../bits'
import { isBookmarked, toggleBookmark } from './bookmarks'
import {
  BookmarkToggle,
  ChapterDeco,
  ChapterEndDeco,
  ChapterPaginationBar,
  ReaderSettingsPopover,
  TocDrawer,
  actualFontPx,
  contentToHtml,
  readerActionsRef,
  textureStyle,
  useReadPosMemory,
  useReadingProgress,
  useReadingTimeTracker,
  type ReadLayoutProps,
} from './shared'

export function ReadClassic({
  data,
  loading,
  fontSize,
  night,
  lineHeight,
  letterSpacing,
  onFontSize,
  onLineHeight,
  onLetterSpacing,
  onToggleNight,
  chapterPagination,
  onChapterPage,
}: ReadLayoutProps) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const read = readOf(theme)
  const [drawer, setDrawer] = useState(false)
  const progress = useReadingProgress(undefined, data?.chapter.id)

  const ch = data?.chapter
  const bk = data?.book

  // feat-a B: 书签状态 (data 变化时同步)
  const [bookmarked, setBookmarked] = useState(false)
  // feat-a A/D: 位置记忆 + 阅读时长 (data 就绪后激活)
  const ready = !loading && !!ch && !!bk
  const { restoredHint } = useReadPosMemory({
    bookId: bk?.id,
    chapterId: ch?.id,
    title: ch?.title,
    ready,
  })
  useReadingTimeTracker(bk?.id)

  // feat-a B: data 变化时重新读 localStorage bookmarked
  if (typeof window !== 'undefined' && bk && ch) {
    const next = isBookmarked(bk.id, ch.id)
    if (next !== bookmarked) {
      // 直接在 render 期间检测并 setState (与原 prevCh 同款模式, 安全)
      setBookmarked(next)
    }
  }

  // feat-round-5 B1: 注册全局阅读器动作 (供 ReadView 键盘快捷键派发)
  // useEffect 无 deps — 每次 render 后写入最新闭包, 卸载时清空 (避免读到陈旧 data)
  useEffect(() => {
    const actions = {
      onPrev: () => data?.prev && navigate({ view: 'read', chapterId: data.prev.id }),
      onNext: () => data?.next && navigate({ view: 'read', chapterId: data.next.id }),
      onScrollTop: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
      onScrollBottom: () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }),
    }
    readerActionsRef.current = actions
    return () => {
      if (readerActionsRef.current === actions) readerActionsRef.current = {}
    }
  })

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
  // feat-a B/C: 工具条按钮统一样式 (Aa 设置 / 书签)
  const toolBtn =
    'inline-flex h-11 w-11 items-center justify-center transition-opacity hover:opacity-75'

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

      {/* 文头工具条（inline 形态）: 面包屑式返回 + Aa设置/书签/目录 */}
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
          {/* feat-a C: 统一 Aa 设置面板 (字号/行距/字距/夜间) */}
          <ReaderSettingsPopover
            fontSize={fontSize}
            lineHeight={lineHeight}
            letterSpacing={letterSpacing}
            night={night}
            onFontSize={onFontSize}
            onLineHeight={onLineHeight}
            onLetterSpacing={onLetterSpacing}
            onToggleNight={onToggleNight}
            dark={night || theme.dark}
            triggerClassName={toolBtn}
            triggerStyle={{
              color: v.text,
              border: `1px solid ${lineColor}`,
              borderRadius: v.radius,
              background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6),
            }}
          />
          {/* feat-a B: 书签切换 */}
          <BookmarkToggle
            bookmarked={bookmarked}
            onToggle={() => {
              if (!bk || !ch) return
              const added = toggleBookmark(bk.id, { id: ch.id, idx: ch.idx, title: ch.title })
              setBookmarked(added)
            }}
            triggerClassName={toolBtn}
            triggerStyle={{
              border: `1px solid ${lineColor}`,
              borderRadius: v.radius,
              background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6),
            }}
            activeColor={v.primary}
            inactiveColor={v.text}
          />
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3.5 text-xs font-medium transition-opacity hover:opacity-75"
            style={{ border: `1px solid ${lineColor}`, color: v.text, borderRadius: v.radius, background: withAlpha(v.surfaceAlt, night ? 0.15 : 0.6) }}
            aria-label="打开章节目录抽屉"
            aria-expanded={drawer}
            data-reader-toc-trigger=""
          >
            <ListTree className="h-3.5 w-3.5" aria-hidden />
            目录
          </button>
        </div>
      </div>

      {/* feat-a A: 位置恢复 inline 提示 (2s 自动消失) */}
      {restoredHint && (
        <div
          className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-xs shadow-md"
          style={{ background: withAlpha(v.primary, 0.95), color: v.primaryText }}
          role="status"
        >
          已定位到上次阅读位置
        </div>
      )}

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
                lineHeight,
                letterSpacing: `${letterSpacing}px`,
                maxWidth: read.measure,
                margin: '0 auto',
              }}
            >
              <div
                className={`text-justify read-content-dropcap ${read.indent ? '[&_p]:my-3 [&_p]:indent-8' : '[&_p]:my-4'}`}
                style={{
                  ...(read.justify ? { textAlign: 'justify' } : null),
                  '--reader-accent': decoColor,
                  '--reader-title-font': v.titleFont,
                } as CSSProperties}
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

            {/* agent-P: 章节内容分页(站点开启 byWords/byPages 且 totalPages>1 时渲染) */}
            {chapterPagination && chapterPagination.mode !== 'off' && chapterPagination.totalPages > 1 && onChapterPage && (
              <ChapterPaginationBar
                pagination={chapterPagination}
                onPage={onChapterPage}
                theme={theme}
                night={night}
              />
            )}
          </>
        )}
      </article>

      <TocDrawer open={drawer} onClose={() => setDrawer(false)} bookId={bk?.id} activeChapterId={ch?.id} variant="classic" />
    </div>
  )
}
