// ============================================================
// 阅读视图 — 多布局编排器
// - 数据获取 / 字号·夜间偏好持久化 / SEO 保持不变
// - 布局形态按 theme.read.layout 分发三种阅读原型:
//     classic 典书版(仿 guichuideng) / immersive 沉浸暗色(仿 uaa) / paginated 分页横滑
// - 主题缺 read 配置时经 readOf() 回退缺省值, 向后兼容
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

export function ReadView({ chapterId }: { chapterId?: string }) {
  const { site, theme } = usePublic()
  const [data, setData] = useState<ChapterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 字号/夜间模式持久化到 localStorage（SSR 侧返回默认值，前台视图均为客户端渲染，无 hydration 冲突）
  const [fontSize, setFontSize] = useState(readStoredFontSize)
  const [night, setNight] = useState(readStoredNight)
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
    onFontSize: (delta: number) => setFontSize((s) => Math.min(24, Math.max(14, s + delta))),
    onToggleNight: () => setNight((n) => !n),
  }

  if (layout === 'immersive') return <ReadImmersive key={`ri-${chapterId || ''}`} {...shared} />
  if (layout === 'paginated') return <ReadPaginated key={`rp-${chapterId || ''}`} {...shared} />
  if (layout === 'pili') return <ReadPili key={`rpl-${chapterId || ''}`} {...shared} />
  return <ReadClassic key={`rc-${chapterId || ''}`} {...shared} />
}
