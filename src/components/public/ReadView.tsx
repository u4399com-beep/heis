// ============================================================
// 阅读视图 — 多布局编排器
// - 数据获取 / 字号·行距·字距·夜间偏好持久化 / SEO 保持不变
// - 布局形态按 theme.read.layout 分发三种阅读原型:
//     classic 典书版(仿 guichuideng) / immersive 沉浸暗色(仿 uaa) / paginated 分页横滑 / pili 霹雳书屋
// - 主题缺 read 配置时经 readOf() 回退缺省值, 向后兼容
// - 阅读位置记忆 + 书签 + 阅读时长在子布局内通过 useReadPosMemory/useReadingTimeTracker 处理
// - feat-round-5:
//     B1: 键盘快捷键 (←/→ 上下章, Home/End 滚动, b/t/s 切换书签/目录/设置, ? 帮助, Esc 关闭)
//     B2: 顶部 3px 阅读进度条
//     B3: 章节切换方向感知滑动动画 (next 从右滑入, prev 从左滑入)
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import { Clock, HelpCircle, Keyboard } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { fetchChapter } from './data'
import type { ChapterData } from './types'
import { usePublic } from './ctx'
import { formatWords, useSiteSEO, withAlpha } from './seo'
import { ErrorState } from './bits'
import { readOf } from '@/lib/crawl/themes'
import { ReadClassic } from './read-layouts/ReadClassic'
import { ReadImmersive } from './read-layouts/ReadImmersive'
import { ReadPaginated } from './read-layouts/ReadPaginated'
import { ReadPili } from './read-layouts/ReadPili'
import { readerActionsRef, useReadingProgress } from './read-layouts/shared'

const READER_FONT_KEY = 'public_reader_fontSize'
const READER_NIGHT_KEY = 'public_reader_night'
// feat-a C: 行距 / 字距持久化
const READER_LINE_HEIGHT_KEY = 'public_reader_lineHeight'
const READER_LETTER_SPACING_KEY = 'public_reader_letterSpacing'

const DEFAULT_LINE_HEIGHT = 1.8
const DEFAULT_LETTER_SPACING = 0

function readStoredFontSize(): number {
  if (typeof window === 'undefined') return 17
  try {
    const n = Number(window.localStorage.getItem(READER_FONT_KEY))
    return Number.isFinite(n) && n >= 14 && n <= 24 ? n : 17
  } catch {
    return 17
  }
}

function readStoredNight(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(READER_NIGHT_KEY) === '1'
  } catch {
    return false
  }
}

function readStoredLineHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_LINE_HEIGHT
  try {
    const n = Number(window.localStorage.getItem(READER_LINE_HEIGHT_KEY))
    return Number.isFinite(n) && n >= 1.5 && n <= 2.2 ? n : DEFAULT_LINE_HEIGHT
  } catch {
    return DEFAULT_LINE_HEIGHT
  }
}

function readStoredLetterSpacing(): number {
  if (typeof window === 'undefined') return DEFAULT_LETTER_SPACING
  try {
    const n = Number(window.localStorage.getItem(READER_LETTER_SPACING_KEY))
    return Number.isFinite(n) && n >= -0.5 && n <= 2 ? n : DEFAULT_LETTER_SPACING
  } catch {
    return DEFAULT_LETTER_SPACING
  }
}

type NavDirection = 'next' | 'prev' | 'none'

const SHORTCUTS_LIST: { keys: string[]; desc: string }[] = [
  { keys: ['←'], desc: '上一章' },
  { keys: ['→'], desc: '下一章' },
  { keys: ['Home'], desc: '回到顶部' },
  { keys: ['End'], desc: '滚到底部' },
  { keys: ['b'], desc: '加入/移除书签' },
  { keys: ['t'], desc: '打开/关闭目录' },
  { keys: ['s'], desc: '打开/关闭阅读设置' },
  { keys: ['?'], desc: '打开本帮助' },
  { keys: ['Esc'], desc: '关闭弹层' },
]

export function ReadView({ chapterId }: { chapterId?: string }) {
  const { site, theme } = usePublic()
  const v = theme.vars
  const [data, setData] = useState<ChapterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // feat-round-5 B3: 章节切换方向 (用于滑动动画)
  const [direction, setDirection] = useState<NavDirection>('none')
  // 字号/夜间模式/行距/字距持久化到 localStorage（SSR 侧返回默认值，前台视图均为客户端渲染，无 hydration 冲突）
  const [fontSize, setFontSize] = useState(readStoredFontSize)
  const [night, setNight] = useState(readStoredNight)
  const [lineHeight, setLineHeight] = useState(readStoredLineHeight)
  const [letterSpacing, setLetterSpacing] = useState(readStoredLetterSpacing)
  const [prevCh, setPrevCh] = useState(chapterId)
  // feat-round-5 B1: 帮助对话框
  const [helpOpen, setHelpOpen] = useState(false)
  if (prevCh !== chapterId) {
    setPrevCh(chapterId)
    // feat-round-5 B3: 用旧 data 的 prev/next id 推断切换方向
    if (chapterId && data?.next?.id === chapterId) setDirection('next')
    else if (chapterId && data?.prev?.id === chapterId) setDirection('prev')
    else setDirection('none')
    setData(null)
    setError('')
    setLoading(!!chapterId)
  }

  useEffect(() => {
    if (!chapterId) return
    let alive = true
    fetchChapter(chapterId)
      .then((d) => {
        if (!alive) return
        setData(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        if (!alive) return
        setError(e.message)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [chapterId])

  // 设置持久化
  useEffect(() => {
    try {
      window.localStorage.setItem(READER_FONT_KEY, String(fontSize))
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [fontSize])
  useEffect(() => {
    try {
      window.localStorage.setItem(READER_NIGHT_KEY, night ? '1' : '0')
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [night])
  useEffect(() => {
    try {
      window.localStorage.setItem(READER_LINE_HEIGHT_KEY, String(lineHeight))
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [lineHeight])
  useEffect(() => {
    try {
      window.localStorage.setItem(READER_LETTER_SPACING_KEY, String(letterSpacing))
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [letterSpacing])

  // feat-round-5 B1: 键盘快捷键
  useEffect(() => {
    const isEditableTarget = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false
      const tag = t.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
    }
    const triggerClick = (sel: string) => {
      const el = document.querySelector<HTMLButtonElement>(sel)
      if (el) {
        el.click()
        return true
      }
      return false
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      // 在输入框/文本域内不触发快捷键
      if (isEditableTarget(e.target)) return
      const k = e.key
      if (k === 'ArrowLeft') {
        e.preventDefault()
        readerActionsRef.current.onPrev?.()
      } else if (k === 'ArrowRight') {
        e.preventDefault()
        readerActionsRef.current.onNext?.()
      } else if (k === 'Home') {
        e.preventDefault()
        readerActionsRef.current.onScrollTop?.()
      } else if (k === 'End') {
        e.preventDefault()
        readerActionsRef.current.onScrollBottom?.()
      } else if (k === 'b' || k === 'B') {
        e.preventDefault()
        triggerClick('[data-reader-bookmark-trigger]')
      } else if (k === 't' || k === 'T') {
        e.preventDefault()
        triggerClick('[data-reader-toc-trigger]')
      } else if (k === 's' || k === 'S') {
        e.preventDefault()
        triggerClick('[data-reader-settings-trigger]')
      } else if (k === '?') {
        e.preventDefault()
        setHelpOpen((o) => !o)
      } else if (k === 'Escape') {
        // Esc 关闭帮助; 其他弹层 (TocDrawer/Popover) 各自处理自己的 Esc
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // feat-round-5 B2: 顶部阅读进度条 (窗口滚动模式 — classic/pili 有效; immersive/paginated 有自己的进度条)
  const progress = useReadingProgress(undefined, chapterId)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  useSiteSEO({
    title: data ? `${data.chapter.title}_${data.book.name} - ${site.name}` : `阅读 - ${site.name}`,
    description: data ? `${data.book.name} ${data.chapter.title} 在线阅读，${formatWords(data.chapter.wordCount)}。` : undefined,
    keywords: data?.book.keywords || undefined,
    canonicalPath: data ? `/?view=read&chapter=${data.chapter.id}&site=${site.id}` : undefined,
    site,
    jsonLd: data
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: data.chapter.title,
            name: data.chapter.title,
            isPartOf: { '@type': 'Book', name: data.book.name },
            author: { '@type': 'Person', name: data.book.author },
            inLanguage: 'zh-CN',
            wordCount: data.chapter.wordCount,
            url: `${origin}/?view=read&chapter=${data.chapter.id}&site=${site.id}`,
          },
        ]
      : [],
  })

  if (!chapterId) return <ErrorState message="缺少章节参数" />
  if (error) return <ErrorState message="章节不存在" detail={error} />

  // 按主题阅读布局原型分发（缺省回退 classic）
  const layout = readOf(theme).layout
  const shared = {
    data,
    loading,
    fontSize,
    night,
    lineHeight,
    letterSpacing,
    onFontSize: (delta: number) => setFontSize((s) => Math.min(24, Math.max(14, s + delta))),
    onLineHeight: (delta: number) => setLineHeight((s) => Math.min(2.2, Math.max(1.5, Math.round((s + delta) * 100) / 100))),
    onLetterSpacing: (delta: number) =>
      setLetterSpacing((s) => Math.min(2, Math.max(-0.5, Math.round((s + delta) * 100) / 100))),
    onToggleNight: () => setNight((n) => !n),
  }

  // feat-round-5 B3: 滑动动画 class (基于方向)
  const slideClass =
    direction === 'next'
      ? 'animate-in fade-in slide-in-from-right-4 duration-300'
      : direction === 'prev'
        ? 'animate-in fade-in slide-in-from-left-4 duration-300'
        : 'animate-in fade-in duration-300'

  const wrapKey = `${chapterId || ''}-${direction}`

  // feat-round-5 B1: 帮助按钮 + 对话框
  // 位置 bottom-20 left-4 (~80px): 高于 ReadPili 的固定底栏 (~64px) 与其他布局的页脚
  const helpButton = (
    <button
      type="button"
      onClick={() => setHelpOpen(true)}
      aria-label="键盘快捷键帮助"
      title="键盘快捷键 (?)"
      className="fixed bottom-20 left-4 z-[60] inline-flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur transition-opacity hover:opacity-85 sm:bottom-24 sm:left-6"
      style={{
        background: withAlpha(v.surface, 0.85),
        borderColor: withAlpha(v.border, 0.8),
        color: v.text,
      }}
    >
      <HelpCircle className="h-4 w-4" aria-hidden />
    </button>
  )

  const helpDialog = (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" aria-hidden />
            键盘快捷键
          </DialogTitle>
        </DialogHeader>
        <ul className="space-y-2">
          {SHORTCUTS_LIST.map((s) => (
            <li key={s.keys.join('+')} className="flex items-center justify-between gap-3 text-sm">
              <span style={{ color: 'var(--muted-foreground)' }}>{s.desc}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex h-7 min-w-7 items-center justify-center rounded border bg-muted px-1.5 text-xs font-semibold"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground" style={{ borderColor: 'var(--border)' }}>
          <Clock className="h-3 w-3" aria-hidden />
          输入框/文本域聚焦时不触发快捷键
        </p>
      </DialogContent>
    </Dialog>
  )

  // feat-round-5 B2: 顶部 3px 进度条 (window 滚动模式 — classic/pili 显示真实进度;
  // immersive/paginated 使用内部滚动, 此条进度恒 0% 不显示, 由各布局自带进度条接管)
  const topProgressBar = (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px]" aria-hidden>
      <div
        style={{
          width: `${progress}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${v.primary}, ${v.accent})`,
          transition: 'width 120ms linear',
          boxShadow: progress > 0 ? `0 0 6px ${withAlpha(v.primary, 0.5)}` : 'none',
        }}
      />
    </div>
  )

  if (layout === 'immersive')
    return (
      <>
        {topProgressBar}
        <div key={`wrap-${wrapKey}`} className={slideClass}>
          <ReadImmersive key={`ri-${chapterId || ''}`} {...shared} />
        </div>
        {helpButton}
        {helpDialog}
      </>
    )
  if (layout === 'paginated')
    return (
      <>
        {topProgressBar}
        <div key={`wrap-${wrapKey}`} className={slideClass}>
          <ReadPaginated key={`rp-${chapterId || ''}`} {...shared} />
        </div>
        {helpButton}
        {helpDialog}
      </>
    )
  if (layout === 'pili')
    return (
      <>
        {topProgressBar}
        <div key={`wrap-${wrapKey}`} className={slideClass}>
          <ReadPili key={`rpl-${chapterId || ''}`} {...shared} />
        </div>
        {helpButton}
        {helpDialog}
      </>
    )
  return (
    <>
      {topProgressBar}
      <div key={`wrap-${wrapKey}`} className={slideClass}>
        <ReadClassic key={`rc-${chapterId || ''}`} {...shared} />
      </div>
      {helpButton}
      {helpDialog}
    </>
  )
}
