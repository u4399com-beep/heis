'use client'

// ============================================================
// TaskMonitor — 任务实时监控
// 2s 轮询任务状态 + 增量日志; 在线调节线程/间隔; 进度与统计
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Progress } from '@/components/ui/progress'
import {
  ArrowLeft,
  CirclePause,
  CirclePlay,
  CircleStop,
  Loader2,
  PauseCircle,
  RefreshCw,
  ScrollText,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  fmtNum,
  LOG_LEVEL_STYLE,
  PHASE_META,
  safeJsonParse,
  TASK_STATUS_META,
  type TaskProgress,
  type TaskRow,
  type TaskStats,
  type TaskStatus,
} from './helpers'

interface TaskMonitorProps {
  taskId: string
  onBack: () => void
}

interface Tuning {
  threadMin: number
  threadMax: number
  intervalMin: number
  intervalMax: number
}

export function TaskMonitor({ taskId, onBack }: TaskMonitorProps) {
  const [task, setTask] = useState<TaskRow | null>(null)
  const [live, setLive] = useState(false)
  const [logs, setLogs] = useState<{ id: string; level: string; message: string; time: string }[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [controlsLoading, setControlsLoading] = useState<string>('')
  const [tuning, setTuning] = useState<Tuning>({ threadMin: 1, threadMax: 3, intervalMin: 500, intervalMax: 2000 })

  const lastLogIdRef = useRef<string>('')
  const taskSeqRef = useRef(0) // 任务状态响应序号: 防慢响应迟到覆盖新状态(2s 轮询与控制后手动刷新并发时)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tuningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tuningRef = useRef(tuning)
  const aliveRef = useRef(true)
  const pullingLogsRef = useRef(false)
  const failCountRef = useRef(0)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  // 卸载后所有异步回调停止 setState
  useEffect(() => {
    return () => {
      aliveRef.current = false
      if (tuningTimer.current) clearTimeout(tuningTimer.current)
    }
  }, [])

  const progress = safeJsonParse<TaskProgress>(task?.progress, {})
  const stats = safeJsonParse<TaskStats>(task?.stats, {})
  const status: TaskStatus = (task?.status as TaskStatus) || 'pending'
  const statusMeta = TASK_STATUS_META[status] || TASK_STATUS_META.pending

  // 拉取任务详情 (控制操作后手动刷新; 单次失败只提示, 连续失败由轮询兜底退出)
  const refreshTask = useCallback(async () => {
    const seq = ++taskSeqRef.current
    try {
      const data = await api.get<TaskRow & { live?: boolean }>(`/api/admin/tasks/${taskId}`)
      if (!aliveRef.current || seq !== taskSeqRef.current) return
      setTask(data)
      setLive(!!data.live)
    } catch {
      if (aliveRef.current && seq === taskSeqRef.current) toast.error('刷新任务状态失败')
    }
  }, [taskId])

  // 初始化在线调参(仅在首次加载任务时同步一次)
  const tuningInitRef = useRef(false)
  useEffect(() => {
    if (task && !tuningInitRef.current) {
      tuningInitRef.current = true
      setTuning({
        threadMin: task.threadMin,
        threadMax: task.threadMax,
        intervalMin: task.intervalMin,
        intervalMax: task.intervalMax,
      })
    }
  }, [task])

  // 追加日志并处理滚动 (按 id 去重, 防历史回填与轮询重叠产生重复行/重复 key)
  const appendLogs = useCallback((rows: { id: string; level: string; message: string; createdAt: string }[]) => {
    if (!rows.length) return
    setLogs((prev) => {
      const seen = new Set(prev.map((l) => l.id))
      const fresh = rows.filter((r) => !seen.has(r.id)).map((r) => ({ id: r.id, level: r.level, message: r.message, time: fmtTime(r.createdAt) }))
      if (!fresh.length) return prev
      const next = [...prev, ...fresh]
      return next.length > 800 ? next.slice(next.length - 800) : next
    })
    lastLogIdRef.current = rows[rows.length - 1].id
  }, [])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // 增量拉取日志: after=lastId 翻页回填(每页200, 单轮最多8页), 进行中防重入
  // 注: 不依赖 lastLogIdRef 非空 — 任务初启动尚无日志时也能拉到第一批, 否则会永远"暂无日志"
  const pullLogs = useCallback(async () => {
    if (pullingLogsRef.current) return
    pullingLogsRef.current = true
    try {
      for (let i = 0; i < 8; i++) {
        const after = lastLogIdRef.current || undefined
        const rows = await api.get<{ id: string; level: string; message: string; createdAt: string }[]>(
          `/api/admin/tasks/${taskId}/logs`,
          { after },
        )
        if (!aliveRef.current) return
        if (!Array.isArray(rows) || rows.length === 0) break
        appendLogs(rows)
        if (rows.length < 200) break
      }
    } catch {
      /* 静默重试 */
    } finally {
      pullingLogsRef.current = false
    }
  }, [taskId, appendLogs])

  // 首次加载: 回填历史日志
  useEffect(() => {
    pullLogs()
  }, [pullLogs])

  // 轮询: 任务状态 + 增量日志 (连续 5 次失败视为任务已删除/连接中断, 自动返回)
  useEffect(() => {
    const tick = async () => {
      const seq = ++taskSeqRef.current
      try {
        const data = await api.get<TaskRow & { live?: boolean }>(`/api/admin/tasks/${taskId}`)
        if (!aliveRef.current || seq !== taskSeqRef.current) return
        failCountRef.current = 0
        setTask(data)
        setLive(!!data.live)
      } catch {
        failCountRef.current += 1
        if (failCountRef.current >= 5 && aliveRef.current) {
          toast.error('任务不存在或连接中断')
          onBackRef.current()
        }
        return
      }
      pullLogs()
    }
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  }, [taskId, pullLogs])

  const control = async (action: 'start' | 'pause' | 'stop') => {
    setControlsLoading(action)
    try {
      await api.post(`/api/admin/tasks/${taskId}/control`, { action })
      toast.success(action === 'start' ? '任务已启动' : action === 'pause' ? '任务已暂停' : '任务已停止')
      await refreshTask()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setControlsLoading('')
    }
  }

  // 在线调参(防抖 PUT): 副作用全部放在 updater 外, 保证 setState 纯函数
  const applyTuning = (patch: Partial<Tuning>) => {
    const next = { ...tuningRef.current, ...patch }
    // 与后端钳制规则对齐: 线程 1~32, 间隔 0~600000, 且 下限<=上限
    next.threadMin = Math.min(32, Math.max(1, Math.round(Number(next.threadMin)) || 1))
    next.threadMax = Math.min(32, Math.max(next.threadMin, Math.round(Number(next.threadMax)) || next.threadMin))
    next.intervalMin = Math.min(600_000, Math.max(0, Math.round(Number(next.intervalMin)) || 0))
    next.intervalMax = Math.min(600_000, Math.max(next.intervalMin, Math.round(Number(next.intervalMax)) || next.intervalMin))
    tuningRef.current = next
    setTuning(next)
    if (tuningTimer.current) clearTimeout(tuningTimer.current)
    tuningTimer.current = setTimeout(async () => {
      try {
        await api.put(`/api/admin/tasks/${taskId}`, {
          threadMin: next.threadMin,
          threadMax: next.threadMax,
          intervalMin: next.intervalMin,
          intervalMax: next.intervalMax,
        })
        if (aliveRef.current) toast.success('参数已在线生效')
      } catch (e) {
        if (aliveRef.current) toast.error(e instanceof Error ? e.message : '参数下发失败')
      }
    }, 600)
  }

  // 钳制到 0~100, 防止 done 计数含"更新"导致超 100%
  const booksPct = progress.booksTotal ? Math.min(100, Math.round(((progress.booksDone || 0) / progress.booksTotal) * 100)) : 0
  const contentPct = progress.contentTotal ? Math.min(100, Math.round(((progress.contentDone || 0) / progress.contentTotal) * 100)) : 0

  if (!task) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在连接任务…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 顶部: 返回 + 标题 + 控制 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            返回列表
          </Button>
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
              <Terminal className="h-5 w-5 text-violet-400" />
              {task.name}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              规则: {task.rule?.name || '-'} · 模式: {task.mode === 'single' ? '单本' : '范围'} · 重采:{' '}
              {task.recrawlMode === 'full' ? '完全覆盖' : '增量更新'} · 存储: {task.storageMode === 'db' ? '数据库' : 'TXT'}
              {/* jj-e 只读提示: 任务已开自动刷新时监控面板可感知(开关/间隔编辑在 TaskDialog) */}
              {!!task.autoRefresh && (
                <span className="ml-2 inline-flex items-center gap-1 text-teal-400">
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  自动刷新: 每 {task.refreshIntervalMin} 分钟
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${statusMeta.className}`}>
            {status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
            {statusMeta.label}
          </span>
          <Badge variant="outline" className={live ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}>
            {live ? '进程在线' : '进程离线'}
          </Badge>
          <Button size="sm" className="gap-1.5" disabled={status === 'running' || !!controlsLoading} onClick={() => control('start')}>
            {controlsLoading === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CirclePlay className="h-3.5 w-3.5" />}
            启动
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            disabled={status !== 'running' || !!controlsLoading}
            onClick={() => control('pause')}
          >
            {controlsLoading === 'pause' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CirclePause className="h-3.5 w-3.5" />}
            暂停
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
            disabled={status !== 'running' || !!controlsLoading}
            onClick={() => control('stop')}
          >
            {controlsLoading === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleStop className="h-3.5 w-3.5" />}
            停止
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* 在线调参 */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <PauseCircle className="h-4 w-4 text-amber-400" />
              在线调节 <span className="text-xs font-normal text-zinc-500">(防抖 600ms 自动下发)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-4 pt-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">线程数范围</span>
                <span className="text-xs font-mono text-violet-300">
                  {tuning.threadMin} ~ {tuning.threadMax}
                </span>
              </div>
              <Slider
                min={1}
                max={32} // 与后端钳制 1~32 对齐(缺省 16 会在任务上限>16 时被拖动静默降值)
                step={1}
                value={[tuning.threadMin, tuning.threadMax]}
                onValueChange={([a, b]) => applyTuning({ threadMin: Math.min(a, b), threadMax: Math.max(a, b) })}
              />
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Input
                  type="number"
                  min={1}
                  className="h-7 w-16 border-zinc-700 bg-zinc-950 text-xs"
                  value={tuning.threadMin}
                  onChange={(e) => applyTuning({ threadMin: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span>至</span>
                <Input
                  type="number"
                  min={1}
                  className="h-7 w-16 border-zinc-700 bg-zinc-950 text-xs"
                  value={tuning.threadMax}
                  onChange={(e) => applyTuning({ threadMax: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span>线程(随机取值)</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">请求间隔范围 (ms)</span>
                <span className="text-xs font-mono text-violet-300">
                  {tuning.intervalMin} ~ {tuning.intervalMax}
                </span>
              </div>
              <Slider
                min={0}
                max={600_000} // 与后端钳制 0~600000 对齐(缺省 10000 会在任务间隔>10s 时被拖动静默降值)
                step={100}
                value={[tuning.intervalMin, tuning.intervalMax]}
                onValueChange={([a, b]) => applyTuning({ intervalMin: Math.min(a, b), intervalMax: Math.max(a, b) })}
              />
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Input
                  type="number"
                  min={0}
                  className="h-7 w-20 border-zinc-700 bg-zinc-950 text-xs"
                  value={tuning.intervalMin}
                  onChange={(e) => applyTuning({ intervalMin: Math.max(0, Number(e.target.value) || 0) })}
                />
                <span>至</span>
                <Input
                  type="number"
                  min={0}
                  className="h-7 w-20 border-zinc-700 bg-zinc-950 text-xs"
                  value={tuning.intervalMax}
                  onChange={(e) => applyTuning({ intervalMax: Math.max(0, Number(e.target.value) || 0) })}
                />
                <span>毫秒</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 进度 */}
        <Card className="border-zinc-800 bg-zinc-900/60 xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-200">
              运行进度
              <span className="ml-2 text-xs font-normal text-zinc-500">
                阶段: {PHASE_META[progress.phase || 'idle'] || progress.phase}
                {progress.phaseNote ? ` · ${progress.phaseNote}` : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-2">
            <ProgressRow
              label={`书籍 ${progress.booksDone || 0} / ${progress.booksTotal || 0}`}
              pct={booksPct}
              hint={progress.discovered ? `已发现 ${progress.discovered} 本` : undefined}
            />
            <ProgressRow
              label={`章节正文 ${progress.contentDone || 0} / ${progress.contentTotal || 0}`}
              pct={contentPct}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <StatChip label="新建书籍" value={stats.booksCreated || 0} tone="text-emerald-400 border-emerald-500/30 bg-emerald-500/10" />
              <StatChip label="更新书籍" value={stats.booksUpdated || 0} tone="text-teal-400 border-teal-500/30 bg-teal-500/10" />
              <StatChip label="新增章节" value={stats.chaptersCreated || 0} tone="text-violet-400 border-violet-500/30 bg-violet-500/10" />
              <StatChip label="更新章节" value={stats.chaptersUpdated || 0} tone="text-sky-400 border-sky-500/30 bg-sky-500/10" />
              <StatChip label="封面" value={stats.coversSaved || 0} tone="text-amber-400 border-amber-500/30 bg-amber-500/10" />
              <StatChip label="下拉词" value={stats.suggestWords || 0} tone="text-rose-400 border-rose-500/30 bg-rose-500/10" />
              <StatChip label="错误" value={stats.errors || 0} tone="text-red-400 border-red-500/30 bg-red-500/10" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 实时日志 */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
            <ScrollText className="h-4 w-4 text-violet-400" />
            实时日志
            <span className="text-xs font-normal text-zinc-500">(2秒增量轮询 · 共 {logs.length} 条)</span>
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className={`h-7 gap-1 border-zinc-700 text-xs ${autoScroll ? 'text-emerald-400' : 'text-zinc-400'}`}
            onClick={() => setAutoScroll((v) => !v)}
          >
            {autoScroll ? '自动滚动中' : '滚动已暂停'}
          </Button>
        </CardHeader>
        <CardContent className="p-0 pb-4">
          <div
            ref={scrollRef}
            className="admin-scroll mx-4 max-h-96 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed"
          >
            {logs.length === 0 ? (
              <div className="py-8 text-center text-zinc-600">暂无日志, 启动任务后开始输出</div>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="flex gap-2 py-0.5">
                  <span className="shrink-0 text-zinc-600">{l.time}</span>
                  <span className={`break-all ${LOG_LEVEL_STYLE[l.level] || 'text-zinc-300'}`}>{l.message}</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ProgressRow({ label, pct, hint }: { label: string; pct: number; hint?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="flex items-center gap-2 font-mono text-zinc-300">
          {hint && <span className="text-zinc-600">{hint}</span>}
          {pct}%
        </span>
      </div>
      <Progress value={pct} className="h-2 bg-zinc-800" />
    </div>
  )
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${tone}`}>
      {label}
      <span className="font-semibold">{fmtNum(value)}</span>
    </span>
  )
}

function fmtTime(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}
