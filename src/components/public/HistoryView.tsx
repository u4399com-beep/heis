// ============================================================
// 我的书架 — 公开阅读历史页
// - 数据源: listReadPos() 返回 localStorage 中所有保存过阅读位置的书籍
// - 每本书的封面/书名/作者经 fetchBook 异步补全 (Promise.all, 上限 50)
// - 卡片: 封面 + 标题/作者 + 阅读进度条 + 已读时长 + 相对时间 + 继续阅读/移除
// - 清空历史: AlertDialog 二次确认
// - 空态: BookMarked 大图标 + 文案 + 去书城入口
// - agent-W: 顶部"继续阅读"快捷入口 (最近一本书) + HistoryCard memo
// ============================================================
'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { BookMarked, BookOpen, ChevronRight, Clock, Library, PlayCircle, Trash2, X } from 'lucide-react'
import { fetchBook } from './data'
import type { BookDetail } from './types'
import { usePublic } from './ctx'
import { useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { BookCover } from './BookCover'
import { Sk } from './bits'
import { clearReadPos, formatReadTime, listReadPos, type ReadPos } from './read-layouts/reading-memory'
import { formatRelativeTime } from './read-layouts/bookmarks'

interface ShelfEntry extends ReadPos {
  bookId: string
}

interface EnrichedEntry extends ShelfEntry {
  book?: BookDetail
  failed?: boolean
}

const MAX_BOOKS = 50

export function HistoryView() {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [entries, setEntries] = useState<ShelfEntry[] | null>(null)
  const [enriched, setEnriched] = useState<Record<string, BookDetail | undefined>>({})
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  // 挂载时读取历史 (fresh mount 自然重读 listReadPos, 离开阅读页后回来进度即最新)
  useEffect(() => {
    setEntries(listReadPos().slice(0, MAX_BOOKS))
  }, [])

  // 批量补全书籍详情 (Promise.all, 上限 50)
  useEffect(() => {
    if (!entries) return
    let alive = true
    const missing = entries.filter((e) => !enriched[e.bookId] && !failedIds.has(e.bookId))
    if (!missing.length) return
    Promise.all(
      missing.map((e) =>
        fetchBook(e.bookId, 1, 1)
          .then((d) => ({ bookId: e.bookId, book: d.book as BookDetail }))
          .catch(() => ({ bookId: e.bookId, book: null as BookDetail | null })),
      ),
    ).then((results) => {
      if (!alive) return
      setEnriched((prev) => {
        const next = { ...prev }
        for (const r of results) {
          if (r.book) next[r.bookId] = r.book
        }
        return next
      })
      setFailedIds((prev) => {
        const next = new Set(prev)
        for (const r of results) {
          if (!r.book) next.add(r.bookId)
        }
        return next
      })
    })
    return () => {
      alive = false
    }
    // 仅在 entries 变化时触发 (enriched 渐进填充不再触发新请求, missing 为空时 effect 自动 return)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])

  const list = useMemo<EnrichedEntry[]>(() => {
    if (!entries) return []
    return entries.map((e) => ({
      ...e,
      book: enriched[e.bookId],
      failed: failedIds.has(e.bookId),
    }))
  }, [entries, enriched, failedIds])

  const loading = entries === null

  const removeOne = useCallback((bookId: string) => {
    clearReadPos(bookId)
    setEntries((prev) => (prev ? prev.filter((e) => e.bookId !== bookId) : prev))
  }, [])

  const clearAll = () => {
    if (!entries) return
    for (const e of entries) clearReadPos(e.bookId)
    setEntries([])
    setConfirmOpen(false)
  }

  // agent-W: 顶部"继续阅读"快捷入口 — 取最近一本有 chapterId 的书, 一键直跳阅读页
  const latestEntry = entries && entries.length > 0 ? entries[0] : null

  const onContinueLatest = useCallback(() => {
    if (!latestEntry?.chapterId) return
    navigate({ view: 'read', bookId: latestEntry.bookId, chapterId: latestEntry.chapterId })
  }, [latestEntry?.chapterId, latestEntry?.bookId, navigate])

  const onContinueBook = useCallback((bookId: string, chapterId: string) => {
    navigate({ view: 'read', bookId, chapterId })
  }, [navigate])

  useSiteSEO({
    title: generateTitle({ siteName: site.name, category: '我的书架' }),
    description: generateMetaDescription({ siteName: site.name, category: '我的书架', intro: '最近阅读过的小说与阅读进度' }),
    keywords: generateKeywords({ siteName: site.name, category: '书架' }),
    robots: 'noindex,nofollow',
    canonicalPath: `/?view=history&site=${site.id}`,
    site,
  })

  /* ---------- 加载骨架 ---------- */
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Sk className="h-8 w-40" />
          <Sk className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Sk className="aspect-[3/4] w-full" />
              <Sk className="h-4 w-4/5" />
              <Sk className="h-3 w-2/3" />
              <Sk className="h-2 w-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  /* ---------- 空态 ---------- */
  if (!entries || !entries.length) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-col items-center gap-5 text-center">
          <span
            className="flex h-20 w-20 items-center justify-center rounded-full"
            style={{ background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08), color: v.primary }}
          >
            <BookMarked className="h-9 w-9" aria-hidden />
          </span>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold" style={{ color: v.text, fontFamily: v.titleFont }}>
              还没有阅读记录
            </h1>
            <p className="text-sm" style={{ color: v.textMuted }}>
              去书城找本书读读吧, 你的阅读进度会自动保存在这里
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate({ view: 'home' })}
            className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-85"
            style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
          >
            <Library className="h-4 w-4" aria-hidden />
            去书城
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* 头部 */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: withAlpha(v.primary, theme.dark ? 0.18 : 0.1), color: v.primary }}
            aria-hidden
          >
            <Library className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-wide sm:text-2xl" style={{ color: v.text, fontFamily: v.titleFont }}>
              我的书架
            </h1>
            <p className="text-xs" style={{ color: v.textMuted }}>
              最近阅读的书籍 · 共 {entries.length} 本
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
          style={{
            color: v.textMuted,
            border: `1px solid ${withAlpha(v.border, 0.9)}`,
            borderRadius: v.radius,
            background: v.surface,
          }}
          aria-label="清空全部阅读历史"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          清空历史
        </button>
      </header>

      {/* agent-W: 继续阅读快捷入口 (最近一本书) — 仅当最近一本有 chapterId 时显示 */}
      {latestEntry?.chapterId && (
        <button
          type="button"
          onClick={onContinueLatest}
          className="group mb-6 flex w-full items-center gap-4 overflow-hidden rounded-xl p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg sm:p-5"
          style={{
            background: `linear-gradient(120deg, ${withAlpha(v.primary, theme.dark ? 0.18 : 0.1)}, ${withAlpha(v.accent, theme.dark ? 0.12 : 0.06)})`,
            border: `1px solid ${withAlpha(v.primary, 0.4)}`,
            borderRadius: v.radius,
          }}
          aria-label={`继续阅读 ${latestEntry.title || '最近章节'}`}
        >
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ background: v.primary, color: v.primaryText }}
            aria-hidden
          >
            <PlayCircle className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium tracking-wider" style={{ color: v.textMuted }}>
              继续阅读 · 上次 {formatRelativeTime(latestEntry.ts)}
            </p>
            <p className="mt-0.5 line-clamp-1 text-sm font-semibold" style={{ color: v.text }}>
              {latestEntry.title || '点击继续阅读'}
            </p>
            {latestEntry.readTimeMs && latestEntry.readTimeMs > 0 && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] tabular-nums" style={{ color: v.textMuted }}>
                <Clock className="h-2.5 w-2.5" aria-hidden />
                已读 {formatReadTime(latestEntry.readTimeMs)}
              </p>
            )}
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" style={{ color: v.primary }} aria-hidden />
        </button>
      )}

      {/* 卡片网格 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {list.map((e) => (
          <HistoryCard
            key={e.bookId}
            entry={e}
            onRemove={() => removeOne(e.bookId)}
            onContinue={() => onContinueBook(e.bookId, e.chapterId)}
          />
        ))}
      </div>

      {/* 清空确认对话框 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent style={{ background: v.surface, color: v.text, border: `1px solid ${v.border}`, borderRadius: v.radius }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: v.text }}>清空全部阅读历史?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: v.textMuted }}>
              将移除 {entries.length} 本书的阅读进度与阅读时长记录, 此操作不可恢复。已加入书签的章节不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel style={{ background: 'transparent', color: v.text, border: `1px solid ${withAlpha(v.border, 0.8)}` }}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={clearAll}
              style={{ background: v.primary, color: v.primaryText }}
            >
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 单本历史卡片 — agent-W: memo 化, 避免 entries/enriched 状态变化时全量重渲染 */
const HistoryCard = memo(function HistoryCard({
  entry,
  onRemove,
  onContinue,
}: {
  entry: EnrichedEntry
  onRemove: () => void
  onContinue: () => void
}) {
  const { theme } = usePublic()
  const v = theme.vars
  const book = entry.book
  const pct = Math.min(100, Math.max(0, Math.round(entry.scrollRatio * 100)))
  const name = book?.name || '未知书名'
  const author = book?.author || ''
  const cover = book?.cover
  // book 还未加载到且未失败时, 视为加载中; 失败时使用 fallback (封面占位+书名)
  const stillLoading = !book && !entry.failed

  return (
    <article
      className="group relative flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
      style={{
        background: v.surface,
        border: `1px solid ${v.border}`,
        borderRadius: v.radius,
        boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
      }}
    >
      {/* 移除按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full text-white/90 opacity-0 transition-opacity hover:bg-black/40 group-hover:opacity-100 focus:opacity-100"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        aria-label="从书架移除"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>

      {/* 封面 */}
      <div className="relative">
        {stillLoading ? (
          <Sk className="aspect-[3/4] w-full" />
        ) : (
          <BookCover name={name} cover={cover} showAuthor={author} className="aspect-[3/4] w-full" />
        )}
        {/* 进度遮罩条 */}
        <div
          className="absolute inset-x-0 bottom-0 h-1"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          aria-hidden
        >
          <div
            className="h-full"
            style={{ width: `${pct}%`, background: v.primary }}
          />
        </div>
        <span
          className="absolute bottom-1.5 left-1.5 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums text-white"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          aria-label={`阅读进度 ${pct}%`}
        >
          {pct}%
        </span>
      </div>

      {/* 信息 */}
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <h3 className="line-clamp-1 text-sm font-semibold" style={{ color: v.text }}>{name}</h3>
        {author && (
          <p className="line-clamp-1 text-xs" style={{ color: v.textMuted }}>{author}</p>
        )}
        {entry.title && (
          <p className="line-clamp-1 text-[11px]" style={{ color: v.textMuted }} title={entry.title}>
            读到: {entry.title}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-1 pt-1 text-[10px]" style={{ color: v.textMuted }}>
          <span className="inline-flex items-center gap-0.5" title="累计阅读时长">
            <Clock className="h-2.5 w-2.5" aria-hidden />
            {entry.readTimeMs && entry.readTimeMs > 0 ? formatReadTime(entry.readTimeMs) : '未统计'}
          </span>
          <span className="inline-flex items-center gap-0.5" title="上次阅读时间">
            {formatRelativeTime(entry.ts)}
          </span>
        </div>

        <button
          type="button"
          onClick={onContinue}
          disabled={!entry.chapterId}
          className="mt-1 inline-flex items-center justify-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
          aria-label={`继续阅读 ${name}`}
        >
          <BookOpen className="h-3 w-3" aria-hidden />
          继续阅读
        </button>
      </div>
    </article>
  )
})
