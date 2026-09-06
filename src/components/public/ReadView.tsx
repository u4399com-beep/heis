// ============================================================
// 阅读视图 — 多布局编排器
// - 数据获取 / 字号·行距·字距·夜间偏好持久化 / SEO 保持不变
// - 布局形态按 theme.read.layout 分发三种阅读原型:
//     classic 典书版(仿 guichuideng) / immersive 沉浸暗色(仿 uaa) / paginated 分页横滑 / pili 霹雳书屋
// - 主题缺 read 配置时经 readOf() 回退缺省值, 向后兼容
// - 阅读位置记忆 + 书签 + 阅读时长在子布局内通过 useReadPosMemory/useReadingTimeTracker 处理
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import { fetchChapter } from './data'
import type { ChapterData } from './types'
import { usePublic } from './ctx'
import { formatWords, useSiteSEO } from './seo'
import { ErrorState } from './bits'
import { readOf } from '@/lib/crawl/themes'
import { ReadClassic } from './read-layouts/ReadClassic'
import { ReadImmersive } from './read-layouts/ReadImmersive'
import { ReadPaginated } from './read-layouts/ReadPaginated'
import { ReadPili } from './read-layouts/ReadPili'

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

export function ReadView({ chapterId }: { chapterId?: string }) {
  const { site, theme } = usePublic()
  const [data, setData] = useState<ChapterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 字号/夜间模式/行距/字距持久化到 localStorage（SSR 侧返回默认值，前台视图均为客户端渲染，无 hydration 冲突）
  const [fontSize, setFontSize] = useState(readStoredFontSize)
  const [night, setNight] = useState(readStoredNight)
  const [lineHeight, setLineHeight] = useState(readStoredLineHeight)
  const [letterSpacing, setLetterSpacing] = useState(readStoredLetterSpacing)
  const [prevCh, setPrevCh] = useState(chapterId)
  if (prevCh !== chapterId) {
    setPrevCh(chapterId)
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

  if (layout === 'immersive')
    return (
      <div key={`wrap-${chapterId || ''}`} className="animate-in fade-in duration-300">
        <ReadImmersive key={`ri-${chapterId || ''}`} {...shared} />
      </div>
    )
  if (layout === 'paginated')
    return (
      <div key={`wrap-${chapterId || ''}`} className="animate-in fade-in duration-300">
        <ReadPaginated key={`rp-${chapterId || ''}`} {...shared} />
      </div>
    )
  if (layout === 'pili')
    return (
      <div key={`wrap-${chapterId || ''}`} className="animate-in fade-in duration-300">
        <ReadPili key={`rpl-${chapterId || ''}`} {...shared} />
      </div>
    )
  return (
    <div key={`wrap-${chapterId || ''}`} className="animate-in fade-in duration-300">
      <ReadClassic key={`rc-${chapterId || ''}`} {...shared} />
    </div>
  )
}
