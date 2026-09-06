// ============================================================
// 阅读布局 · pili 书屋版（仿霹雳书屋 pilishuwu.com 正文页）
// 暖纸画布 + 顶部细 read-header 条(返回书页/章题/字号夜间) + 段首缩进大栏
// + 底部 chapter-control(上一章/目录抽屉/下一章 橙色主按钮) + 懒加载目录抽屉
// ============================================================
'use client'

import { useState } from 'react'
import { AArrowDown, AArrowUp, ChevronLeft, ChevronRight, ListTree, Moon, Sun } from 'lucide-react'
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
  useReadingProgress,
  type ReadLayoutProps,
} from './shared'

export function ReadPili({ data, loading, fontSize, night, onFontSize, onToggleNight }: ReadLayoutProps) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const read = readOf(theme)
  const [drawer, setDrawer] = useState(false)
  const progress = useReadingProgress(undefined, data?.chapter.id)

  const ch = data?.chapter
  const bk = data?.book

  // 夜间调色: 日间=原站暖纸画布 #ede7da, 夜间=沉稳暗底
  const canvasBg = night ? '#15171c' : '#ede7da'
  const barBg = night ? '#1c2026' : '#f4f0e9'
  const lineColor = night ? 'rgba(255,255,255,0.1)' : '#ddd5c4'
  // 正文大栏纸面(原站 .text-wrap basic_bg DNA): 暖白卡 + 细边框浮在米色画布上
  const cardBg = night ? '#1e232b' : '#faf5eb'
  const cardBorder = night ? 'rgba(255,255,255,0.12)' : '#d8d8d8'
  const textColor = night ? '#c9cdd4' : '#262626'
  const metaColor = night ? '#8b929e' : '#8c8577'
  const titleColor = night ? '#e6e9ee' : '#262626'

  const fontPx = actualFontPx(fontSize, read)

  const ctrlBtn = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 px-3 text-sm font-medium transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35'

  return (
    <div data-pili-read className="read-layout-pili flex min-h-screen flex-col" style={{ background: canvasBg, transition: 'background-color .3s' }}>
      {/* 阅读进度条 */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5" aria-hidden>
        <div style={{ width: `${progress}%`, height: '100%', background: `linear-gradient(90deg, ${v.primary}, ${v.accent})`, transition: 'width 80ms linear' }} />
      </div>

      {/* 顶部细 read-header 条: 返回书页 + 章题 + 阅读设置 */}
      <header
        data-pili-read-header
        className="sticky top-0 z-50 border-b"
        style={{ background: barBg, borderColor: lineColor, transition: 'background-color .3s' }}
      >
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-3 py-2 sm:px-6">
          <button
            type="button"
            onClick={() => bk && navigate({ view: 'book', bookId: bk.id })}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1 text-sm transition-opacity hover:opacity-70"
            style={{ color: v.primary }}
            aria-label={`返回《${bk?.name || ''}》书籍页`}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            书页
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-sm font-medium" style={{ color: titleColor }}>
            {ch ? ch.title : loading ? '加载中…' : ''}
          </p>
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="阅读设置">
            <button
              type="button"
              onClick={() => onFontSize(-1)}
              className="inline-flex h-11 w-11 items-center justify-center transition-opacity hover:opacity-70"
              style={{ color: textColor }}
              aria-label="减小字号"
            >
              <AArrowDown className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onFontSize(1)}
              className="inline-flex h-11 w-11 items-center justify-center transition-opacity hover:opacity-70"
              style={{ color: textColor }}
              aria-label="增大字号"
            >
              <AArrowUp className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onToggleNight}
              className="inline-flex h-11 w-11 items-center justify-center transition-opacity hover:opacity-70"
              style={{ color: night ? v.primary : textColor }}
              aria-label={night ? '切换日间模式' : '切换夜间模式'}
              aria-pressed={night}
            >
              {night ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </div>
      </header>

      {/* 正文大栏(原站 read-main-wrap 900px DNA, 主题 measure 控制) */}
      <main className="w-full flex-1 px-3 pb-28 pt-6 sm:px-6">
        <article
          className="mx-auto px-5 py-7 sm:px-10 sm:py-9"
          style={{
            maxWidth: Math.max(read.measure, 640) + 80,
            color: textColor,
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            borderRadius: v.radius,
            boxShadow: night ? 'none' : '0 1px 3px rgba(125,54,15,0.05)',
            transition: 'background-color .3s',
          }}
          aria-label="章节正文"
        >
          {loading || !ch || !bk ? (
            <div className="space-y-4 py-2">
              <Sk className="mx-auto h-7 w-1/2" style={{ backgroundColor: night ? 'rgba(255,255,255,0.12)' : '#e0d9c8' }} />
              <div className="mx-auto space-y-4" style={{ maxWidth: read.measure }}>
                {Array.from({ length: 10 }).map((_, i) => (
                  <Sk key={i} className="h-4 w-full" style={{ backgroundColor: night ? 'rgba(255,255,255,0.12)' : '#e0d9c8', opacity: 1 - i * 0.07 }} />
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* 章节头: 居中标题 + 细横线装饰 + 出处 */}
              <header className="mb-8 text-center">
                <h1 className="text-xl font-bold leading-snug sm:text-2xl" style={{ color: titleColor }}>{ch.title}</h1>
                <ChapterDeco kind={read.chapterDeco} color={night ? '#5a6470' : v.primary} />
                <p className="mt-3 text-xs" style={{ color: metaColor }}>
                  {bk.name} · {bk.author} · {formatWords(ch.wordCount)}
                </p>
              </header>

              {/* 正文: 段首缩进 + 主题行高/字号, 内容来自后端清洗白名单 */}
              <div
                style={{
                  fontSize: fontPx,
                  lineHeight: read.lineHeight,
                  maxWidth: read.measure,
                  margin: '0 auto',
                  color: textColor,
                }}
              >
                {/* 原站 read-content 直接排在 text-wrap 纸面上, 卡内不再二次缩窄居中 */}
                <div
                  data-pili-content
                  className={read.indent ? '[&_p]:my-3 [&_p]:indent-8' : '[&_p]:my-4'}
                  style={read.justify ? { textAlign: 'justify' } : undefined}
                  dangerouslySetInnerHTML={{ __html: contentToHtml(ch.content) || '<p>本章节内容为空</p>' }}
                />
              </div>

              <ChapterEndDeco kind={read.chapterDeco} color={night ? '#5a6470' : v.primary} />

              {/* 文内章节导航(非固定, 移动端在底部条之上多一组入口) */}
              <nav
                className="mx-auto mt-10 flex max-w-md items-center justify-center gap-3 sm:hidden"
                aria-label="章节导航"
              >
                <button
                  type="button"
                  disabled={!data?.prev}
                  onClick={() => data?.prev && navigate({ view: 'read', chapterId: data.prev.id })}
                  className={ctrlBtn}
                  style={{ border: `1px solid ${lineColor}`, borderRadius: v.radius, color: data?.prev ? v.primary : metaColor }}
                  aria-label="上一章"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  上一章
                </button>
                <button
                  type="button"
                  onClick={() => setDrawer(true)}
                  className={ctrlBtn}
                  style={{ border: `1px solid ${lineColor}`, borderRadius: v.radius, color: textColor }}
                  aria-label="打开目录"
                >
                  <ListTree className="h-4 w-4" aria-hidden />
                  目录
                </button>
                <button
                  type="button"
                  disabled={!data?.next}
                  onClick={() => data?.next && navigate({ view: 'read', chapterId: data.next.id })}
                  className={ctrlBtn}
                  style={{ border: `1px solid ${lineColor}`, borderRadius: v.radius, color: data?.next ? v.primary : metaColor }}
                  aria-label="下一章"
                >
                  下一章
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </nav>
            </>
          )}
        </article>
      </main>

      {/* 底部 chapter-control: 上一章 / 目录 / 下一章(橙色主按钮) */}
      <nav
        data-pili-chapter-control
        className="fixed inset-x-0 bottom-0 z-50 border-t"
        style={{ background: barBg, borderColor: lineColor, boxShadow: night ? 'none' : '0 -2px 10px rgba(125,54,15,0.06)', transition: 'background-color .3s' }}
        aria-label="章节控制条"
      >
        <div className="mx-auto flex w-full max-w-4xl items-center gap-2.5 px-3 py-2.5 sm:px-6">
          <button
            type="button"
            disabled={!data?.prev}
            onClick={() => data?.prev && navigate({ view: 'read', chapterId: data.prev.id })}
            className={ctrlBtn}
            style={{ border: `1px solid ${withAlpha(v.primary, 0.5)}`, borderRadius: v.radius, color: data?.prev ? v.primary : metaColor, background: v.surface }}
            aria-label="上一章"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            上一章
          </button>
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className={ctrlBtn}
            style={{ border: `1px solid ${withAlpha(v.primary, 0.5)}`, borderRadius: v.radius, color: v.primary, background: v.surface }}
            aria-label="打开章节目录"
            aria-expanded={drawer}
          >
            <ListTree className="h-4 w-4" aria-hidden />
            目录
          </button>
          <button
            type="button"
            disabled={!data?.next}
            onClick={() => data?.next && navigate({ view: 'read', chapterId: data.next.id })}
            className={ctrlBtn}
            style={{ background: v.primary, borderRadius: v.radius, color: v.primaryText, boxShadow: '0 1px 4px rgba(253,137,41,0.4)' }}
            aria-label="下一章"
          >
            下一章
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </nav>

      <TocDrawer open={drawer} onClose={() => setDrawer(false)} bookId={bk?.id} activeChapterId={ch?.id} variant="classic" />
    </div>
  )
}
