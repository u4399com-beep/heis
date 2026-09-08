// ============================================================
// 阅读布局公共件 — 四种阅读原型 (classic/immersive/paginated/pili) 共享
// - contentToHtml: 正文渲染白名单兜底（从旧 ReadView 平移, 语义不变）
// - useReadingProgress: 窗口滚动 / 指定滚动容器双模式进度
// - useReadPosMemory: 阅读位置记忆 + 滚动定位恢复 (feat-a A/D)
// - useReadingTimeTracker: 阅读时长统计 (feat-a D)
// - ReaderSettingsPopover / BookmarkToggle: 阅读器工具栏通用控件 (feat-a B/C)
// - textureStyle: 纸纹 / 暗角氛围
// - ChapterDeco / ChapterEndDeco: 章节头尾装饰分隔
// - TocDrawer: 懒加载分页目录抽屉 + 书签 tab + 阅读时长 (feat-a B/D)
// ============================================================
'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Moon,
  Sun,
  Type,
  X,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { ReadVars } from '@/lib/crawl/themes'
import { fetchBook } from '../data'
import type { ChapterData } from '../types'
import { usePublic } from '../ctx'
import { withAlpha } from '../seo'
import {
  getReadPos,
  getReadTimeMs,
  saveReadPos,
  setReadTimeMs,
  formatReadTime,
} from './reading-memory'
import { listBookmarks, toggleBookmark, formatRelativeTime, type Bookmark as BookmarkItem } from './bookmarks'
import { getReadChapters, markChapterRead } from './chapter-progress'

/** 三种阅读布局的统一入参（数据与用户偏好由 ReadView 编排, 布局组件只管形态） */
export interface ReadLayoutProps {
  data: ChapterData | null
  loading: boolean
  fontSize: number
  night: boolean
  /** 行距 (1.5-2.2, 默认 1.8) — feat-a C */
  lineHeight: number
  /** 字距 (px, -0.5 到 2, 默认 0) — feat-a C */
  letterSpacing: number
  onFontSize: (delta: number) => void
  /** delta 调整行距, 调用方钳制到 [1.5, 2.2] */
  onLineHeight: (delta: number) => void
  /** delta 调整字距, 调用方钳制到 [-0.5, 2] */
  onLetterSpacing: (delta: number) => void
  onToggleNight: () => void
}

/* ---------------- feat-round-5 B1: 阅读器键盘快捷键动作注册 ---------------- */

/**
 * 阅读器全局动作注册表 — 各布局在 render 期间把 prev/next/scrollTop/scrollBottom
 * 写入此 module-level ref, ReadView 的 keydown 处理器读 ref 派发。
 * 同一时刻仅一个阅读器实例挂载 (key=chapterId 强制 remount), 故单槽 ref 安全。
 */
export interface ReaderActions {
  onPrev?: () => void
  onNext?: () => void
  onScrollTop?: () => void
  onScrollBottom?: () => void
}

export const readerActionsRef: { current: ReaderActions } = { current: {} }

/** 行距预设 (feat-a C) */
export const LINE_HEIGHT_PRESETS: { label: string; value: number }[] = [
  { label: '紧凑', value: 1.6 },
  { label: '标准', value: 1.8 },
  { label: '宽松', value: 2.1 },
]

/** 字距预设 (feat-a C, 单位 px) */
export const LETTER_SPACING_PRESETS: { label: string; value: number }[] = [
  { label: '紧凑', value: -0.3 },
  { label: '标准', value: 0 },
  { label: '宽松', value: 1 },
]

/** 纯文本正文兜底：无 <p>/<br> 的内容按换行切段并转义，避免 \n 被 HTML 塌陷成一行 */
export function contentToHtml(raw: string): string {
  const content = (raw || '').trim()
  if (!content) return ''
  if (/<\s*(p|div|br)\b/i.test(content)) return sanitizeReaderHtml(content)
  return content
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<p>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('')
}

/**
 * R4A-6: 阅读侧 defense-in-depth —— 写侧 cleanContentHtml/R3-34 已防 stored XSS, 但
 * DB 数据若被绕过(直接 DB 写 / 备份还原 R4A-3 / 旧数据 R3-34 前)或未来写侧回归, 读者
 * 浏览器会直接执行恶意 HTML。客户端轻量正则消毒(不用 cheerio, 客户端包大小敏感):
 *  1. 剥 <script>/<iframe>/<object>/<embed>/<noscript> 完整标签 + 内部文本
 *  2. 剥 on* 事件属性(onclick/onerror/onload…)
 *  3. 剥 javascript: URLs(href/src 含此协议的标签整段去掉)
 * 不影响正常 <p>/<br>/<a href=https...>/<img src=https...> 白名单标签
 */
function sanitizeReaderHtml(html: string): string {
  // 1. 完整剥危险标签及其内部文本(script/style 等的内容必丢, 防 <script>alert(1)</script> 渗漏)
  let out = html
    .replace(/<(script|style|noscript|iframe|object|embed|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style|noscript|iframe|object|embed|template)\b[^>]*\/?>/gi, ' ')
  // 2. 剥 on* 事件属性(<a onclick=...> <img onerror=...>)——匹配 on 开头 + 字母数字 + ="..."或='...'或=`...`
  out = out.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s>]+)/gi, '')
  // 3. 剥 javascript: / vbscript: / data:text/html URL(href/src 属性值整段去掉该属性, 防 javascript:alert(1))
  out = out.replace(/\s+(href|src)\s*=\s*"(?:javascript|vbscript|data:text\/html)[^"]*"/gi, '')
  out = out.replace(/\s+(href|src)\s*=\s*'(?:javascript|vbscript|data:text\/html)[^']*'/gi, '')
  out = out.replace(/\s+(href|src)\s*=\s*`(?:javascript|vbscript|data:text\/html)[^`]*`/gi, '')
  // 无引号形态: <a href=javascript:alert(1)>
  out = out.replace(/\s+(href|src)\s*=\s*(?:javascript|vbscript|data:text\/html)[^\s>]+/gi, '')
  return out
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
  }, [key, scrollerRef])
  return progress
}

/* ---------------- 阅读位置记忆 (feat-a A) ---------------- */

interface UseReadPosMemoryOpts {
  bookId?: string
  chapterId?: string
  title?: string
  /** 滚动容器 ref; 留空则监听 window 滚动 */
  scrollerRef?: RefObject<HTMLElement | null>
  /** 数据是否就绪 (loading=false 且 chapter 加载完); 为 true 才会执行位置恢复 */
  ready?: boolean
  /** 自定义 ratio 取值 (用于 paginated 横向分页) */
  getRatio?: () => number
  /** 自定义 ratio 应用 (用于 paginated 横向分页) */
  setRatio?: (r: number) => void
}

/**
 * 阅读位置记忆 (feat-a A):
 * - 监听 scroll, 300ms debounce 写入 localStorage (key: heis_readpos_<bookId>)
 * - ready 变 true 且 chapterId 与 saved 匹配时, 100ms 后定位到 scrollRatio
 * - chapterId 切换为新章节 (与 saved 不同) 时, 立即更新 saved 为新章 + ratio 0
 * - 返回 restored (true 表示本次定位恢复完成), restoredToast 可由调用方渲染为 inline 提示
 *
 * 注意: hook 内部不会自动渲染提示, 调用方应使用返回的 restoredHint 控制提示显隐;
 * 提示自动在 2s 后消失 (内部计时, 调用方无需管理)。
 */
export function useReadPosMemory({
  bookId,
  chapterId,
  title,
  scrollerRef,
  ready,
  getRatio,
  setRatio,
}: UseReadPosMemoryOpts): { restoredHint: boolean } {
  const [restoredHint, setRestoredHint] = useState(false)
  const lastSavedChapterRef = useRef<string | undefined>(undefined)
  const hintTimerRef = useRef<number>(0)
  // feat-round-10 B1: 已读标记 ref — 同章节已标过就不再写 localStorage
  const markedReadRef = useRef<boolean>(false)

  // 默认 ratio 读取 (window 或 scrollerRef 的纵向滚动)
  const defaultGetRatio = useCallback((): number => {
    const el = scrollerRef?.current
    if (el) {
      const max = el.scrollHeight - el.clientHeight
      return max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0
    }
    if (typeof window === 'undefined') return 0
    const doc = document.documentElement
    const max = doc.scrollHeight - window.innerHeight
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
  }, [scrollerRef])

  // 默认 ratio 应用
  const defaultSetRatio = useCallback((r: number): void => {
    const el = scrollerRef?.current
    if (el) {
      const max = el.scrollHeight - el.clientHeight
      el.scrollTo({ top: Math.round(max * r) })
      return
    }
    if (typeof window === 'undefined') return
    const doc = document.documentElement
    const max = doc.scrollHeight - window.innerHeight
    window.scrollTo({ top: Math.round(max * r) })
  }, [scrollerRef])

  const readRatio = getRatio ?? defaultGetRatio
  const applyRatio = setRatio ?? defaultSetRatio

  // 1. 位置恢复 (ready 翻 true 且 chapterId 匹配 saved) + 100ms 延迟等渲染
  useEffect(() => {
    if (!bookId || !chapterId || !ready) return
    const saved = getReadPos(bookId)
    if (!saved || saved.chapterId !== chapterId) return
    // 100ms 延迟等正文排版完成 (尤其 paginated 多列)
    const t = window.setTimeout(() => {
      applyRatio(saved.scrollRatio)
      setRestoredHint(true)
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current)
      hintTimerRef.current = window.setTimeout(() => setRestoredHint(false), 2000)
    }, 100)
    lastSavedChapterRef.current = chapterId
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterId, ready])

  // 2. 切换到新章节 (与 saved 不同) 时, 立即更新 saved 为新章 + ratio 0
  useEffect(() => {
    if (!bookId || !chapterId) return
    const saved = getReadPos(bookId)
    if (saved && saved.chapterId === chapterId) {
      lastSavedChapterRef.current = chapterId
      // feat-round-10 B1: 章节切换时, 重置已读标记 ref; 若 saved 记录中已读过该章,
      // 直接置 true 避免重复写入 (跨刷新页面恢复场景)
      markedReadRef.current = getReadChapters(bookId).has(chapterId)
      return
    }
    // 新章节: 写入 ratio 0 + 当前标题
    saveReadPos(bookId, chapterId, 0, title || '')
    lastSavedChapterRef.current = chapterId
    // feat-round-10 B1: 新章节尚未标记已读
    markedReadRef.current = getReadChapters(bookId).has(chapterId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterId])

  // feat-round-10 B1: 章节就绪后, 若 saved 记录的 ratio 已 >= 0.1, 立即标记已读
  // (覆盖场景: 用户上次读到一半退出, 重新打开 → 章节加载完成即视为已读)
  useEffect(() => {
    if (!bookId || !chapterId || !ready) return
    if (markedReadRef.current) return
    const saved = getReadPos(bookId)
    if (saved && saved.chapterId === chapterId && saved.scrollRatio >= 0.1) {
      markChapterRead(bookId, chapterId)
      markedReadRef.current = true
    }
  }, [bookId, chapterId, ready])

  // 3. scroll 监听 debounce 300ms 保存 + feat-round-10 B1: 滚动 >10% 标记已读
  useEffect(() => {
    if (!bookId || !chapterId) return
    let timer = 0
    const save = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const r = readRatio()
        saveReadPos(bookId, chapterId, r, title || '')
        // feat-round-10 B1: 滚动超过 10% 即视为"已读"; 用 ref 去重避免高频写 localStorage
        if (!markedReadRef.current && r >= 0.1) {
          markChapterRead(bookId, chapterId)
          markedReadRef.current = true
        }
      }, 300)
    }
    const el = scrollerRef?.current
    const target: HTMLElement | Window = el || window
    target.addEventListener('scroll', save, { passive: true })
    return () => {
      if (timer) window.clearTimeout(timer)
      target.removeEventListener('scroll', save)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterId, title, scrollerRef])

  // 4. 卸载清理 hint 计时器
  useEffect(() => {
    return () => {
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current)
    }
  }, [])

  return { restoredHint }
}

/* ---------------- 阅读时长统计 (feat-a D) ---------------- */

/**
 * 累计阅读时长:
 * - 1s 心跳: 若 document.visible 且 (now - lastScrollAt) < 30s, 累加 1000ms
 * - 每 30s 落盘 localStorage (与 read pos 共享同一记录)
 * - 卸载时立即落盘
 * - 暴露 readTimeMs state 给调用方 (TocDrawer header 展示用)
 */
export function useReadingTimeTracker(bookId?: string): number {
  const [readTimeMs, setReadTimeMsState] = useState(0)
  const lastScrollAtRef = useRef<number>(Date.now())
  const accumRef = useRef<number>(0)

  // 监听 scroll, 更新 lastScrollAt
  useEffect(() => {
    if (!bookId) return
    lastScrollAtRef.current = Date.now()
    const onScroll = () => {
      lastScrollAtRef.current = Date.now()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [bookId])

  // 心跳累加 + 落盘
  useEffect(() => {
    if (!bookId) return
    accumRef.current = getReadTimeMs(bookId)
    setReadTimeMsState(accumRef.current)
    let tickTimer = 0
    let saveTimer = 0
    const tick = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        Date.now() - lastScrollAtRef.current < 30000
      ) {
        accumRef.current += 1000
        setReadTimeMsState(accumRef.current)
      }
    }
    const save = () => {
      // 注意: 这里调用 imported setReadTimeMs (持久化), 而非本地 setReadTimeMsState
      setReadTimeMs(bookId, accumRef.current)
    }
    tickTimer = window.setInterval(tick, 1000)
    saveTimer = window.setInterval(save, 30000)
    const onVis = () => {
      // 切回可见时刷新 lastScrollAt, 避免瞬间过期
      if (document.visibilityState === 'visible') lastScrollAtRef.current = Date.now()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(tickTimer)
      window.clearInterval(saveTimer)
      document.removeEventListener('visibilitychange', onVis)
      // 卸载时落盘
      save()
    }
  }, [bookId])

  return readTimeMs
}

/* ---------------- 阅读器统一设置面板 (feat-a C) ---------------- */

interface ReaderSettingsPopoverProps {
  fontSize: number
  lineHeight: number
  letterSpacing: number
  night: boolean
  onFontSize: (delta: number) => void
  onLineHeight: (delta: number) => void
  onLetterSpacing: (delta: number) => void
  onToggleNight: () => void
  /** 触发按钮的样式 (不同布局颜色/边框不同, 由调用方传入) */
  triggerClassName?: string
  triggerStyle?: CSSProperties
  /** 暗色面板 (immersive 用) */
  dark?: boolean
  ariaLabel?: string
}

/**
 * 阅读器统一设置面板 (feat-a C):
 * - 触发器: "Aa" 小按钮 (Type 图标)
 * - 内容: 字号 slider / 行距预设 / 字距预设 / 夜间开关
 * - 兼容亮色/暗色 (immersive 用 dark=true)
 */
export function ReaderSettingsPopover({
  fontSize,
  lineHeight,
  letterSpacing,
  night,
  onFontSize,
  onLineHeight,
  onLetterSpacing,
  onToggleNight,
  triggerClassName,
  triggerStyle,
  dark,
  ariaLabel = '阅读设置',
}: ReaderSettingsPopoverProps) {
  const panelBg = dark ? '#14181d' : '#fff'
  const panelBorder = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'
  const textMuted = dark ? '#8a919c' : '#666'
  const textPrimary = dark ? '#e6e9ee' : '#1a1a1a'
  const accentPrimary = dark ? '#a78bfa' : '#7c3aed'

  // 行距/字距命中预设 (用于高亮当前档)
  const lhPresetIdx = (() => {
    let best = -1
    let bestDist = Infinity
    LINE_HEIGHT_PRESETS.forEach((p, i) => {
      const d = Math.abs(p.value - lineHeight)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    return bestDist < 0.05 ? best : -1
  })()
  const lsPresetIdx = (() => {
    let best = -1
    let bestDist = Infinity
    LETTER_SPACING_PRESETS.forEach((p, i) => {
      const d = Math.abs(p.value - letterSpacing)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    return bestDist < 0.05 ? best : -1
  })()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={triggerClassName}
          style={triggerStyle}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          data-reader-settings-trigger=""
        >
          <Type className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-72 p-4 shadow-xl"
        style={{ background: panelBg, border: `1px solid ${panelBorder}`, color: textPrimary }}
      >
        {/* 字号 */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between text-xs" style={{ color: textMuted }}>
            <span>字号</span>
            <span className="tabular-nums" style={{ color: textPrimary }}>{fontSize}px</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onFontSize(-1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-sm transition-opacity hover:opacity-70"
              style={{ border: `1px solid ${panelBorder}`, color: textPrimary }}
              aria-label="减小字号"
              disabled={fontSize <= 14}
            >
              −
            </button>
            <Slider
              value={[fontSize]}
              min={14}
              max={24}
              step={1}
              onValueChange={(v) => {
                const n = v[0]
                if (typeof n === 'number' && n !== fontSize) {
                  onFontSize(n - fontSize)
                }
              }}
              className="flex-1"
              aria-label="字号"
            />
            <button
              type="button"
              onClick={() => onFontSize(1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-sm transition-opacity hover:opacity-70"
              style={{ border: `1px solid ${panelBorder}`, color: textPrimary }}
              aria-label="增大字号"
              disabled={fontSize >= 24}
            >
              +
            </button>
          </div>
        </div>

        {/* 行距预设 */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between text-xs" style={{ color: textMuted }}>
            <span>行距</span>
            <span className="tabular-nums" style={{ color: textPrimary }}>{lineHeight.toFixed(1)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {LINE_HEIGHT_PRESETS.map((p, i) => {
              const active = i === lhPresetIdx
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    onLineHeight(p.value - lineHeight)
                  }}
                  className="rounded px-2 py-1.5 text-xs transition-colors"
                  style={{
                    border: `1px solid ${active ? accentPrimary : panelBorder}`,
                    background: active ? (dark ? 'rgba(167,139,250,0.18)' : 'rgba(124,58,237,0.12)') : 'transparent',
                    color: active ? accentPrimary : textPrimary,
                  }}
                  aria-pressed={active}
                  aria-label={`行距 ${p.label} ${p.value}`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* 字距预设 */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between text-xs" style={{ color: textMuted }}>
            <span>字距</span>
            <span className="tabular-nums" style={{ color: textPrimary }}>{letterSpacing.toFixed(1)}px</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {LETTER_SPACING_PRESETS.map((p, i) => {
              const active = i === lsPresetIdx
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    onLetterSpacing(p.value - letterSpacing)
                  }}
                  className="rounded px-2 py-1.5 text-xs transition-colors"
                  style={{
                    border: `1px solid ${active ? accentPrimary : panelBorder}`,
                    background: active ? (dark ? 'rgba(167,139,250,0.18)' : 'rgba(124,58,237,0.12)') : 'transparent',
                    color: active ? accentPrimary : textPrimary,
                  }}
                  aria-pressed={active}
                  aria-label={`字距 ${p.label} ${p.value}px`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* 夜间开关 */}
        <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: panelBorder }}>
          <span className="flex items-center gap-1.5 text-xs" style={{ color: textPrimary }}>
            {night ? <Moon className="h-3.5 w-3.5" aria-hidden /> : <Sun className="h-3.5 w-3.5" aria-hidden />}
            夜间模式
          </span>
          <Switch checked={night} onCheckedChange={onToggleNight} aria-label="切换夜间模式" />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ---------------- 书签切换按钮 (feat-a B) ---------------- */

interface BookmarkToggleProps {
  /** 调用方传入当前是否已收藏 (由调用方持有 state, 避免每次 localStorage 读) */
  bookmarked: boolean
  onToggle: () => void
  triggerClassName?: string
  triggerStyle?: CSSProperties
  activeColor?: string
  inactiveColor?: string
  ariaLabel?: string
}

export function BookmarkToggle({
  bookmarked,
  onToggle,
  triggerClassName,
  triggerStyle,
  activeColor,
  inactiveColor,
  ariaLabel,
}: BookmarkToggleProps) {
  const Icon = bookmarked ? BookmarkCheck : Bookmark
  return (
    <button
      type="button"
      onClick={onToggle}
      className={triggerClassName}
      style={{ ...triggerStyle, color: bookmarked ? activeColor || triggerStyle?.color : inactiveColor || triggerStyle?.color }}
      aria-label={ariaLabel || (bookmarked ? '移除书签' : '加入书签')}
      aria-pressed={bookmarked}
      title={bookmarked ? '移除书签' : '加入书签'}
      data-reader-bookmark-trigger=""
    >
      <Icon className={bookmarked ? 'h-4 w-4 fill-current' : 'h-4 w-4'} aria-hidden />
    </button>
  )
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
  // feat-a B: 目录/书签 tab 切换
  const [tab, setTab] = useState<'toc' | 'bookmark'>('toc')
  // feat-a B: 书签列表 (localStorage, open/tab 切换时刷新)
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  // feat-a D: 阅读时长 (open 时从 localStorage 读, 用于 header 展示)
  const [readTimeMs, setReadTimeMsState] = useState(0)
  // feat-round-10 B2: 已读章节集合 (localStorage, open/tab 切换时刷新)
  const [readSet, setReadSet] = useState<Set<string>>(() => new Set())
  // 使用 render-time 检测 open/tab 变化 (与 ReadView 的 prevCh 同款), 避免 effect 内同步 setState
  const [prevRefresh, setPrevRefresh] = useState<{ open: boolean; tab: string } | null>(null)
  const refreshKey = `${open ? '1' : '0'}|${tab}`
  if (!prevRefresh || `${prevRefresh.open ? '1' : '0'}|${prevRefresh.tab}` !== refreshKey) {
    setPrevRefresh({ open, tab })
    if (open && bookId) {
      setBookmarks(listBookmarks(bookId))
      setReadTimeMsState(getReadTimeMs(bookId))
      setReadSet(getReadChapters(bookId))
    }
  }
  // feat-round-10 B2: 书签 id 集合 (render-time 推导, 不需额外 state)
  const bookmarkIds = new Set(bookmarks.map((b) => b.chapterId))

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
  // feat-a B/D: open/tab 变化时刷新书签 + 阅读时长
  // 已移至 render-time 检测 (见上方 prevRefresh), 避免 effect 内同步 setState

  const pending = !loaded || loaded.page !== page
  const entries = loaded && loaded.page === page ? loaded.entries : null
  const totalPages = loaded && loaded.page === page ? loaded.totalPages : 1
  const total = loaded && loaded.page === page ? loaded.total : 0

  // feat-round-10 B2/B3: 阅读进度 (已读 / 总章数, 钳制 0-100)
  const readCount = readSet.size
  const readPct = total > 0 ? Math.min(100, Math.round((readCount / total) * 100)) : 0

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

  // feat-a B: 移除单个书签 (TocDrawer 内自带, 不影响父组件 bookmarked state)
  const removeBookmark = (chapterId: string) => {
    if (!bookId) return
    const b = bookmarks.find((x) => x.chapterId === chapterId)
    if (!b) return
    // toggleBookmark 通过 chapterId 移除 (idx/title 仍是同一记录)
    toggleBookmark(bookId, { id: chapterId, idx: b.idx, title: b.title })
    setBookmarks(listBookmarks(bookId))
  }

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
        <header className="border-b px-4 py-3" style={{ borderColor: panelBorder }}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold">{tab === 'toc' ? '章节目录' : '书签列表'}</p>
              {tab === 'toc' ? (
                total > 0 ? (
                  <p className="mt-0.5 text-[11px] tabular-nums opacity-60">
                    已读 {readCount}/{total} 章 · 第 {page}/{totalPages} 页
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] tabular-nums opacity-60">
                    第 {page}/{totalPages} 页
                  </p>
                )
              ) : (
                <p className="mt-0.5 text-[11px] tabular-nums opacity-60">
                  共 {bookmarks.length} 个书签
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
          </div>

          {/* feat-round-10 B3: 阅读进度条 + 阅读时长 (仅目录 tab) */}
          {tab === 'toc' && total > 0 && (
            <div className="mt-2 space-y-1.5">
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: dark ? 'rgba(255,255,255,0.08)' : withAlpha(v.border, 0.4) }}
                role="progressbar"
                aria-valuenow={readPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="阅读进度"
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${readPct}%`, background: `linear-gradient(90deg, ${v.primary}, ${v.accent})` }}
                />
              </div>
              {readTimeMs > 0 && (
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: dark ? '#8a919c' : v.textMuted }}>
                  <Clock className="h-3 w-3" aria-hidden />
                  <span>已读 {readCount} 章 · {readPct}% · 累计 {formatReadTime(readTimeMs)}</span>
                </div>
              )}
              {readTimeMs === 0 && (
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: dark ? '#8a919c' : v.textMuted }}>
                  <Clock className="h-3 w-3" aria-hidden />
                  <span>已读 {readCount} 章 · {readPct}%</span>
                </div>
              )}
            </div>
          )}

          {/* feat-a B: 目录/书签 tab 切换 */}
          <div
            className="mt-2.5 grid grid-cols-2 gap-0.5 rounded p-0.5 text-xs"
            style={{ background: dark ? 'rgba(255,255,255,0.06)' : withAlpha(v.border, 0.35) }}
            role="tablist"
            aria-label="目录/书签切换"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'toc'}
              onClick={() => setTab('toc')}
              className="rounded px-2 py-1.5 text-center transition-colors"
              style={{
                background: tab === 'toc' ? panelBg : 'transparent',
                color: tab === 'toc' ? v.primary : 'inherit',
                fontWeight: tab === 'toc' ? 600 : 400,
              }}
            >
              目录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'bookmark'}
              onClick={() => setTab('bookmark')}
              className="rounded px-2 py-1.5 text-center transition-colors"
              style={{
                background: tab === 'bookmark' ? panelBg : 'transparent',
                color: tab === 'bookmark' ? v.primary : 'inherit',
                fontWeight: tab === 'bookmark' ? 600 : 400,
              }}
            >
              书签{bookmarks.length > 0 ? ` (${bookmarks.length})` : ''}
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {tab === 'bookmark' ? (
            bookmarks.length === 0 ? (
              <div className="px-3 py-12 text-center text-xs opacity-60">
                <Bookmark className="mx-auto mb-2 h-6 w-6 opacity-50" aria-hidden />
                暂无书签，点击阅读页工具栏的书签图标添加
              </div>
            ) : (
              <ol>
                {bookmarks.map((b) => {
                  const active = b.chapterId === activeChapterId
                  return (
                    <li key={b.chapterId}>
                      <div
                        className="flex min-h-[44px] w-full items-center gap-2 rounded px-2.5 py-2.5 transition-colors hover:bg-black/5"
                        style={active ? { background: activeBg } : undefined}
                      >
                        <button
                          type="button"
                          onClick={() => goChapter(b.chapterId)}
                          className="flex min-w-0 flex-1 items-baseline gap-2 text-left text-sm"
                          style={active ? { color: v.primary } : undefined}
                          aria-current={active ? 'true' : undefined}
                          aria-label={`阅读 ${b.title}`}
                        >
                          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums opacity-55">{String(b.idx).padStart(2, '0')}</span>
                          <span className="line-clamp-1 flex-1">{b.title}</span>
                        </button>
                        <span className="shrink-0 text-[10px] tabular-nums opacity-50">{formatRelativeTime(b.ts)}</span>
                        <button
                          type="button"
                          onClick={() => removeBookmark(b.chapterId)}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs transition-opacity hover:opacity-70"
                          style={{ color: dark ? '#aeb4bc' : v.textMuted }}
                          aria-label={`移除书签 ${b.title}`}
                        >
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )
          ) : pending || !entries ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm opacity-60">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              目录加载中…
            </div>
          ) : entries.length === 0 ? (
            <p className="py-16 text-center text-sm opacity-60">暂无章节</p>
          ) : (
            <ol>
              {(() => {
                // feat-round-10 B2: 目录单条渲染 — 状态图标 + 行背景
                // 状态优先级: 当前(高亮紫底+左紫边) > 书签(琥珀 Bookmark 图标) > 已读(绿 Check 弱化) > 未读(zinc 圆点)
                const renderEntry = (c: TocEntry) => {
                  const active = c.id === activeChapterId
                  const read = readSet.has(c.id)
                  const marked = bookmarkIds.has(c.id)
                  // 行内联样式: 当前 → violet 底色 + 左紫边; 已读 → zinc 底色; 未读 → 透明
                  const rowStyle: CSSProperties = active
                    ? {
                        background: withAlpha(v.primary, dark ? 0.22 : 0.12),
                        borderLeft: `2px solid ${v.primary}`,
                        color: v.primary,
                        opacity: 1,
                      }
                    : read
                      ? {
                          background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)',
                          opacity: 0.65,
                        }
                      : { opacity: 1 }
                  return (
                    <li key={c.id} className="relative">
                      <button
                        type="button"
                        onClick={() => goChapter(c.id)}
                        className="flex min-h-[44px] w-full items-center gap-2 rounded px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-black/5"
                        style={rowStyle}
                        aria-current={active ? 'true' : undefined}
                        aria-label={`阅读 ${c.title}${active ? ' (当前)' : read ? ' (已读)' : ''}`}
                      >
                        {/* feat-round-10 B2: 状态图标 — 16px inline */}
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                          {active ? (
                            // 当前章节: 脉冲紫圆点
                            <span
                              className="inline-block h-2 w-2 animate-pulse rounded-full"
                              style={{ background: v.primary, boxShadow: `0 0 6px ${withAlpha(v.primary, 0.7)}` }}
                            />
                          ) : marked ? (
                            // 书签: 琥珀 Bookmark 图标
                            <Bookmark className="h-3.5 w-3.5 fill-current" style={{ color: '#f59e0b' }} />
                          ) : read ? (
                            // 已读: 绿 Check
                            <Check className="h-3.5 w-3.5" style={{ color: '#10b981' }} />
                          ) : (
                            // 未读: zinc 小圆点
                            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)' }} />
                          )}
                        </span>
                        <span className="w-7 shrink-0 text-right text-[11px] tabular-nums opacity-55">{String(c.idx).padStart(2, '0')}</span>
                        <span className="line-clamp-1 flex-1">{c.title}</span>
                      </button>
                      {/* feat-round-10 S2: 已加书签但非当前章节 — 右上角琥珀 Bookmark 小图标 */}
                      {marked && !active && (
                        <Bookmark
                          className="pointer-events-none absolute right-2 top-1.5 h-3 w-3 fill-current"
                          style={{ color: '#f59e0b' }}
                          aria-hidden
                        />
                      )}
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

        {/* 页内翻页 — 仅目录 tab 显示 */}
        {tab === 'toc' && totalPages > 1 && (
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
