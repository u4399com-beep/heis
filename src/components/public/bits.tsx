// ============================================================
// 前台通用小组件 — 状态徽章 / 标签云 / 空态 / 错误态 / 主题化骨架
// ============================================================
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { AlertCircle, BookOpen, Feather, Inbox, RefreshCw } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { usePublic, usePublicOptional, type ViewParams } from './ctx'
import { statusLabel, statusStyle, withAlpha } from './seo'
import { fetchSuggestTags } from './data'

/** 可点击书籍卡片的键盘可达属性（Enter/Space 触发，配合 onClick 使用） */
export function bookNavProps(navigate: (p: ViewParams) => void, bookId: string) {
  const open = () => navigate({ view: 'book', bookId })
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
    },
  }
}

/** 完结状态徽章（连载中/已完结/未知，主题化配色） */
export function StatusBadge({ status, small }: { status?: string | null; small?: boolean }) {
  const { theme } = usePublic()
  const st = statusStyle(theme, status)
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-medium ${small ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-xs'}`}
      style={st}
    >
      <Feather className={small ? 'h-2.5 w-2.5' : 'h-3 w-3'} aria-hidden />
      {statusLabel(status)}
    </span>
  )
}

/** 标签云（点击跳关键词落地页） */
export function TagCloud({ tags, align }: { tags: string[]; align?: 'center' | 'left' }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  if (!tags.length) return null
  return (
    <div className={`flex flex-wrap gap-2 ${align === 'center' ? 'justify-center' : ''}`}>
      {tags.map((t, i) => (
        <button
          key={`${t}-${i}`}
          type="button"
          onClick={() => navigate({ view: 'keyword', tag: t })}
          className="rounded-full px-3 py-1 text-xs transition-opacity hover:opacity-80"
          style={{
            background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08),
            color: v.primary,
            border: `1px solid ${withAlpha(v.primary, 0.35)}`,
            borderRadius: v.radius,
          }}
          aria-label={`关键词 ${t}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

/** Fisher-Yates 洗牌(返回新数组, 不修改入参) */
function shufflePick(pool: readonly string[], n: number): string[] {
  const a = [...pool]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a.slice(0, Math.max(0, n))
}

/**
 * 随机下拉词云(全站搜索热词) — 词池由 fetchSuggestTags 缓存, 客户端洗牌抽 count 个;
 * 「换一批」仅 setRound 重洗不重新请求; 加载中骨架 8 个; 词池为空/拉取失败静默 null。
 * 点击跳搜索页(区别于 TagCloud 的关键词落地页)。
 */
export function SuggestTagCloud({ count, refresh }: { count: number; refresh?: boolean }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const [pool, setPool] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    let alive = true
    fetchSuggestTags().then((d) => {
      if (!alive) return
      if (d && d.tags.length) {
        setPool(d.tags)
        setFailed(false)
      } else {
        setFailed(true) // 词池空/拉取失败 → 整块静默不渲染
      }
    })
    return () => {
      alive = false
    }
  }, [])

  // round 变化 → 重洗一批; pool 就绪前返回空数组走骨架分支
  const picks = useMemo(() => shufflePick(pool || [], count), [pool, count, round])

  if (failed) return null
  if (!pool) {
    return (
      <div className="flex flex-wrap items-center gap-2" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <Sk key={i} className="h-7 w-16" style={{ borderRadius: v.radius }} />
        ))}
      </div>
    )
  }
  if (!picks.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {picks.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => navigate({ view: 'search', q: t })}
          className="rounded-full px-3 py-1 text-xs transition-opacity hover:opacity-80"
          style={{
            background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08),
            color: v.primary,
            border: `1px solid ${withAlpha(v.primary, 0.35)}`,
            borderRadius: v.radius,
          }}
          aria-label={`搜索 ${t}`}
        >
          {t}
        </button>
      ))}
      {refresh && (
        <button
          type="button"
          onClick={() => setRound((r) => r + 1)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-opacity hover:opacity-80"
          style={{ color: v.textMuted, border: `1px dashed ${withAlpha(v.border, 0.9)}`, borderRadius: v.radius }}
          aria-label="换一批搜索推荐词"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          换一批
        </button>
      )}
    </div>
  )
}

/** 区块标题（主题化） */
export function SecTitle({ icon, children, right }: { icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  const { theme } = usePublic()
  const v = theme.vars
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-wide" style={{ color: v.text }}>
        {icon ? <span style={{ color: v.primary }}>{icon}</span> : <span className="inline-block h-4 w-1 rounded-full" style={{ background: v.primary }} aria-hidden />}
        {children}
      </h2>
      {right}
    </div>
  )
}

/** 空状态 */
export function EmptyState({ text = '暂无内容', hint }: { text?: string; hint?: string }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: v.surfaceAlt, color: v.textMuted }}>
        <Inbox className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-sm font-medium" style={{ color: v.text }}>{text}</p>
      {hint && <p className="text-xs" style={{ color: v.textMuted }}>{hint}</p>}
      <button
        type="button"
        onClick={() => navigate({ view: 'home' })}
        className="mt-1 rounded-full px-4 py-1.5 text-xs font-medium transition-opacity hover:opacity-85"
        style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
      >
        返回首页
      </button>
    </div>
  )
}

/** 错误态（如"书籍不存在"） */
export function ErrorState({ message = '内容加载失败', detail }: { message?: string; detail?: string }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: withAlpha(v.primary, 0.12), color: v.primary }}>
        <AlertCircle className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-base font-semibold" style={{ color: v.text }}>{message}</p>
      {detail && <p className="max-w-md text-xs leading-relaxed" style={{ color: v.textMuted }}>{detail}</p>}
      <button
        type="button"
        onClick={() => navigate({ view: 'home' })}
        className="mt-1 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-opacity hover:opacity-85"
        style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
      >
        <BookOpen className="h-3.5 w-3.5" aria-hidden />
        返回首页
      </button>
    </div>
  )
}

/** 主题化骨架块（未挂载 Provider 时使用中性色兜底） */
export function Sk({ className, style }: { className?: string; style?: CSSProperties }) {
  const ctx = usePublicOptional()
  return <Skeleton className={className} style={{ backgroundColor: ctx?.theme.vars.surfaceAlt || 'rgba(255,255,255,0.12)', ...style }} />
}
