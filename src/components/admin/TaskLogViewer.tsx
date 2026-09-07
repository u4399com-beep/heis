'use client'

// ============================================================
// TaskLogViewer — 任务日志查看器 (feat-round-10 A1)
// 由 TaskMonitor 抽离, 专注日志显示交互:
// - 自动滚动到底 (用户手动上滑则暂停, 浮动 "↓ 新日志" 按钮回到底)
// - 日志级别过滤 (info/success/warn/error 四档 pill 按钮 + 计数)
// - 文本搜索 (大小写不敏感)
// - 清空显示 (本地视图, 不动服务端日志)
// - 复制全部已显示日志到剪贴板
// - 颜色: info=zinc-300 / success=emerald-400 / warn=amber-400 / error=red-400
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ClipboardCopy, Eraser, Search } from 'lucide-react'
import { toast } from 'sonner'

export interface TaskLog {
  id: string
  level: string
  message: string
  /** HH:mm:ss 格式时间 (展示用) */
  time: string
  /** 毫秒时间戳 (速率图分桶用) */
  ts: number
}

interface TaskLogViewerProps {
  logs: TaskLog[]
  onClear: () => void
}

type Level = 'info' | 'success' | 'warn' | 'error'

const LEVEL_META: Record<Level, { label: string; dot: string; text: string; activeBg: string; activeBorder: string }> = {
  info: { label: '信息', dot: 'bg-zinc-400', text: 'text-zinc-300', activeBg: 'bg-zinc-700/60', activeBorder: 'border-zinc-500' },
  success: { label: '成功', dot: 'bg-emerald-400', text: 'text-emerald-400', activeBg: 'bg-emerald-500/15', activeBorder: 'border-emerald-500/50' },
  warn: { label: '警告', dot: 'bg-amber-400', text: 'text-amber-400', activeBg: 'bg-amber-500/15', activeBorder: 'border-amber-500/50' },
  error: { label: '错误', dot: 'bg-red-400', text: 'text-red-400', activeBg: 'bg-red-500/15', activeBorder: 'border-red-500/50' },
}

const LEVEL_ORDER: Level[] = ['info', 'success', 'warn', 'error']

export function TaskLogViewer({ logs, onClear }: TaskLogViewerProps) {
  // 过滤开关 (默认全开)
  const [filters, setFilters] = useState<Record<Level, boolean>>({
    info: true,
    success: true,
    warn: true,
    error: true,
  })
  const [search, setSearch] = useState('')
  // 用户是否手动上滑 (暂停自动滚动)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  // 新日志计数 (用户上滑后到达的新日志数)
  const [newCount, setNewCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLogCountRef = useRef(0)

  // 各级别计数 (来自全部 logs, 不受过滤影响)
  const counts = useMemo(() => {
    const c: Record<Level, number> = { info: 0, success: 0, warn: 0, error: 0 }
    for (const l of logs) {
      if (l.level in c) c[l.level as Level] += 1
    }
    return c
  }, [logs])

  // 过滤后的日志 (级别 + 搜索)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter((l) => {
      if (!filters[l.level as Level]) return false
      if (q && !l.message.toLowerCase().includes(q)) return false
      return true
    })
  }, [logs, filters, search])

  // 滚动检测: 用户上滑 → 暂停自动滚动; 用户回到底部 → 恢复
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < 50
    if (atBottom) {
      setUserScrolledUp(false)
      setNewCount(0)
    } else if (!userScrolledUp) {
      setUserScrolledUp(true)
    }
  }, [userScrolledUp])

  // 自动滚动: 新日志到达 + 未暂停 → 滚到底
  useEffect(() => {
    if (userScrolledUp) {
      // 用户暂停时, 累加新日志数 (与上次相比的增量)
      if (logs.length > prevLogCountRef.current) {
        setNewCount((n) => n + (logs.length - prevLogCountRef.current))
      }
      prevLogCountRef.current = logs.length
      return
    }
    if (scrollRef.current && logs.length !== prevLogCountRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      prevLogCountRef.current = logs.length
    }
  }, [filtered, userScrolledUp, logs.length])

  // 初次挂载 + logs 由空 → 有数据 时滚到底
  useEffect(() => {
    if (scrollRef.current && !userScrolledUp) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const jumpToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    setUserScrolledUp(false)
    setNewCount(0)
  }, [])

  const toggleFilter = useCallback((lvl: Level) => {
    setFilters((prev) => ({ ...prev, [lvl]: !prev[lvl] }))
  }, [])

  const handleCopy = useCallback(async () => {
    if (filtered.length === 0) {
      toast.info('没有可复制的日志')
      return
    }
    const text = filtered.map((l) => `[${l.time}] [${l.level.toUpperCase()}] ${l.message}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${filtered.length} 条日志`)
    } catch {
      // 降级: 选中 textarea
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        toast.success(`已复制 ${filtered.length} 条日志`)
      } catch {
        toast.error('复制失败, 浏览器不支持')
      }
      document.body.removeChild(ta)
    }
  }, [filtered])

  const handleClear = useCallback(() => {
    onClear()
    setNewCount(0)
    setUserScrolledUp(false)
    prevLogCountRef.current = 0
    toast.info('已清空显示的日志 (服务端日志不受影响)')
  }, [onClear])

  return (
    <div className="space-y-2">
      {/* 工具栏: 级别过滤 pill + 搜索 + 清空 + 复制 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="日志级别过滤">
          {LEVEL_ORDER.map((lvl) => {
            const meta = LEVEL_META[lvl]
            const active = filters[lvl]
            const cnt = counts[lvl]
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleFilter(lvl)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? `${meta.activeBg} ${meta.activeBorder} ${meta.text}`
                    : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400'
                }`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                {meta.label}
                <span className="tabular-nums opacity-70">{cnt}</span>
              </button>
            )
          })}
        </div>

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索日志…"
            aria-label="搜索日志文本"
            className="h-7 w-40 rounded-full border border-zinc-700 bg-zinc-950 pl-7 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40 sm:w-52"
          />
        </div>

        <button
          type="button"
          onClick={handleClear}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
          aria-label="清空显示的日志"
          title="清空显示 (服务端日志不受影响)"
        >
          <Eraser className="h-3 w-3" aria-hidden />
          清空
        </button>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
          aria-label="复制已显示的日志"
          title="复制已显示日志到剪贴板"
        >
          <ClipboardCopy className="h-3 w-3" aria-hidden />
          复制
        </button>
      </div>

      {/* 日志容器 (相对定位以承载浮动按钮) */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="admin-scroll max-h-96 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed"
          role="log"
          aria-label="任务日志"
          aria-live="polite"
        >
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-zinc-600">
              {logs.length === 0 ? '暂无日志, 启动任务后开始输出' : '当前过滤条件下无匹配日志'}
            </div>
          ) : (
            filtered.map((l) => {
              const meta = LEVEL_META[(l.level in LEVEL_META ? l.level : 'info') as Level]
              return (
                <div key={l.id} className="flex items-start gap-2 py-0.5">
                  <span className="shrink-0 tabular-nums text-zinc-600">{l.time}</span>
                  <span className={`mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                  <span className={`break-all ${meta.text}`}>{l.message}</span>
                </div>
              )
            })
          )}
        </div>

        {/* 浮动 "↓ 新日志" 按钮 — 仅当用户上滑 + 有新日志到达时显示 */}
        {userScrolledUp && newCount > 0 && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg animate-pulse hover:bg-violet-500"
            aria-label={`跳到最新日志 (${newCount} 条新日志)`}
          >
            <ArrowDown className="h-3 w-3" aria-hidden />
            {newCount} 条新日志
          </button>
        )}
      </div>

      {/* 状态行: 显示条数 / 总条数 */}
      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span className="tabular-nums">
          显示 {filtered.length} / {logs.length} 条
        </span>
        {userScrolledUp && (
          <span className="text-amber-400/80">自动滚动已暂停</span>
        )}
      </div>
    </div>
  )
}
