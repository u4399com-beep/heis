'use client'

// ============================================================
// TaskMonitor — 任务实时监控 (feat-round-10)
// 2s 轮询任务状态 + 增量日志; 在线调节线程/间隔; 进度与统计
// feat-round-10 A: 增强日志查看器(过滤/搜索/自动滚动) + 速率迷你图 + 错误统计 + 分段进度
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  CircleStop,
  Clock,
  Database,
  Download,
  Gauge,
  Loader2,
  MemoryStick,
  PauseCircle,
  RefreshCw,
  RotateCw,
  ScrollText,
  Terminal,
  Timer,
  XCircle,
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
import { TaskLogViewer, type TaskLog } from './TaskLogViewer'

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

// feat-round-10 A2: 速率图回看窗口(分钟)
const RATE_WINDOW_MIN = 10

/** agent-H-features: 任务快照端点响应数据 (/api/admin/tasks/[id]/snapshot) */
interface SnapshotData {
  running: boolean
  paused: boolean
  status: string
  requestCount: number
  bytesFetched: number
  runStartedAt: number
  currentUrl: string
  maxRequests: number
  memBooksInQueue: number
  memChaptersInQueue: number
  memResumeSetsSize: number
  recentLogs: { level: string; message: string; ts: number }[]
  failedBookUrlsCount: number
  eta: number | null
}

export function TaskMonitor({ taskId, onBack }: TaskMonitorProps) {
  const [task, setTask] = useState<TaskRow | null>(null)
  const [live, setLive] = useState(false)
  const [logs, setLogs] = useState<TaskLog[]>([])
  const [controlsLoading, setControlsLoading] = useState<string>('')
  const [tuning, setTuning] = useState<Tuning>({ threadMin: 1, threadMax: 3, intervalMin: 500, intervalMax: 2000 })
  // agent-H-features: 任务实时快照 (3s 轮询; 仅 status==='running' 时拉取)
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null)
  const [snapshotBusy, setSnapshotBusy] = useState(false)

  const lastLogIdRef = useRef<string>('')
  const taskSeqRef = useRef(0) // 任务状态响应序号: 防慢响应迟到覆盖新状态(2s 轮询与控制后手动刷新并发时)
  const tuningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tuningRef = useRef(tuning)
  const aliveRef = useRef(true)
  const pullingLogsRef = useRef(false)
  const failCountRef = useRef(0)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  // 挂载/重挂载时复位 aliveRef(StrictMode dev 下会 卸载→重挂载, 旧实现只设 false 不复位 → 卡 loading)
  useEffect(() => {
    aliveRef.current = true
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
  // feat-round-10 A: 同时保留 ts 毫秒时间戳 (速率图分桶用)
  const appendLogs = useCallback((rows: { id: string; level: string; message: string; createdAt: string }[]) => {
    if (!rows.length) return
    setLogs((prev) => {
      const seen = new Set(prev.map((l) => l.id))
      const fresh = rows
        .filter((r) => !seen.has(r.id))
        .map((r) => ({
          id: r.id,
          level: r.level,
          message: r.message,
          time: fmtTime(r.createdAt),
          ts: safeTs(r.createdAt),
        }))
      if (!fresh.length) return prev
      const next = [...prev, ...fresh]
      return next.length > 800 ? next.slice(next.length - 800) : next
    })
    lastLogIdRef.current = rows[rows.length - 1].id
  }, [])

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

  // agent-H-features: 任务实时快照轮询 —— 仅 status==='running' 时 3s 拉一次; 其他状态停止拉取
  // (pause 时保留已存快照供查看, 但不再更新; stopped/done/error 时清空快照)
  useEffect(() => {
    if (status !== 'running') {
      setSnapshot(null)
      return
    }
    let active = true
    const tick = async () => {
      try {
        const data = await api.get<SnapshotData>(`/api/admin/tasks/${taskId}/snapshot`)
        if (active && aliveRef.current) setSnapshot(data)
      } catch {
        // 静默失败: 短时网络抖动不弹 toast(主轮询已有 failCount 兜底)
      }
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [taskId, status])

  // agent-H-features: 导出失败书籍列表 —— 浏览器直接下载 .txt(text/plain)
  const handleExportFailed = () => {
    // 直接打开新窗口下载; 浏览器会自动触发下载对话框
    window.open(`/api/admin/tasks/${taskId}/failed-books`, '_blank')
  }

  // agent-H-features: 重试仅失败书籍 —— POST /api/admin/tasks 创建 mode='urls' 的新任务,
  // 克隆源任务配置 + 失败 URL 列表; 创建成功后提示用户返回列表查看
  const handleRetryFailed = async () => {
    setSnapshotBusy(true)
    try {
      const res = await api.post<{ id: string; name: string }>('/api/admin/tasks', { retryFailedFromTaskId: taskId })
      toast.success(`已创建重试任务「${res.name}」, 请在任务列表中启动`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重试失败书籍创建失败')
    } finally {
      setSnapshotBusy(false)
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

  // feat-round-10 A2/A3: 日志级别计数 (用于 ErrorStats + 分段进度条 + 速率图)
  const logCounts = useMemo(() => {
    let success = 0
    let warn = 0
    let error = 0
    for (const l of logs) {
      if (l.level === 'success') success += 1
      else if (l.level === 'warn') warn += 1
      else if (l.level === 'error') error += 1
    }
    return { success, warn, error }
  }, [logs])

  // feat-round-10 A2: 速率图数据 — success 日志且消息含"章"或"chapter"(忽略大小写), 按分钟分桶 (近 RATE_WINDOW_MIN 分钟)
  const speedData = useMemo(() => {
    const now = Date.now()
    const windowMs = RATE_WINDOW_MIN * 60 * 1000
    const startMs = now - windowMs
    // 初始化 10 个分钟桶 (从 9 分钟前到当前分钟)
    const buckets: { minuteIdx: number; ts: number; count: number; label: string }[] = []
    const currentMinute = Math.floor(now / 60000)
    for (let i = 0; i < RATE_WINDOW_MIN; i++) {
      const minuteIdx = currentMinute - (RATE_WINDOW_MIN - 1 - i)
      const ts = minuteIdx * 60000
      const d = new Date(ts)
      const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      buckets.push({ minuteIdx, ts, count: 0, label })
    }
    // 遍历日志, 命中桶则累加
    const bucketMap = new Map(buckets.map((b) => [b.minuteIdx, b]))
    for (const l of logs) {
      if (l.level !== 'success') continue
      // 关键字: 章 (中文) 或 chapter (英文, 忽略大小写)
      if (!/章|chapter/i.test(l.message)) continue
      if (l.ts < startMs) continue
      const minuteIdx = Math.floor(l.ts / 60000)
      const b = bucketMap.get(minuteIdx)
      if (b) b.count += 1
    }
    return buckets
  }, [logs])

  // feat-round-10 A3: 速率 = 近10分钟 success+章 日志总数 / 10 分钟 (章/分)
  const ratePerMin = useMemo(() => {
    const total = speedData.reduce((sum, b) => sum + b.count, 0)
    return total / RATE_WINDOW_MIN
  }, [speedData])

  // feat-round-10 A3: 预估剩余 = 剩余章节数 / 速率 (分钟)
  const etaMin = useMemo(() => {
    const remaining = Math.max(0, (progress.contentTotal || 0) - (progress.contentDone || 0))
    if (ratePerMin <= 0 || remaining <= 0) return null
    return Math.ceil(remaining / ratePerMin)
  }, [ratePerMin, progress.contentTotal, progress.contentDone])

  // feat-round-10 A4: 分段进度条比例 (success/warn/error 占这三者之和)
  const segmentProps = useMemo(() => {
    const total = logCounts.success + logCounts.warn + logCounts.error
    if (total === 0) return { successPct: 0, warnPct: 0, errorPct: 0, hasData: false }
    return {
      successPct: (logCounts.success / total) * 100,
      warnPct: (logCounts.warn / total) * 100,
      errorPct: (logCounts.error / total) * 100,
      hasData: true,
    }
  }, [logCounts])

  // feat-round-10 A1: 清空显示的日志 (服务端日志不动; lastLogIdRef 继续指向最新, 后续只增量拉新日志)
  const handleClearLogs = useCallback(() => {
    setLogs([])
  }, [])

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

        {/* 进度 + 分段进度条 + 速率图 (feat-round-10 A2/A4) */}
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
            {/* feat-round-10 A4: 章节进度行 + 悬浮 ETA Tooltip */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-zinc-400">
                  章节正文 <span className="tabular-nums text-zinc-300">{progress.contentDone || 0} / {progress.contentTotal || 0}</span>
                  {progress.contentTotal ? <span className="ml-1 text-zinc-500">({contentPct}%)</span> : null}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 font-mono text-zinc-300 outline-none transition-colors hover:text-violet-300"
                      aria-label="预估剩余时间"
                    >
                      <Clock className="h-3 w-3" aria-hidden />
                      <span>
                        {etaMin === null ? '预估 -' : `预估剩余 ~${etaMin}min`}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="border border-zinc-700 bg-zinc-900 text-zinc-200">
                    <div className="space-y-0.5 text-xs">
                      <div>当前速率: <span className="font-mono text-violet-300">{ratePerMin.toFixed(2)} 章/分</span></div>
                      <div>剩余章节: <span className="font-mono">{Math.max(0, (progress.contentTotal || 0) - (progress.contentDone || 0))}</span></div>
                      <div>预估剩余: <span className="font-mono">{etaMin === null ? '-' : `~${etaMin} 分钟`}</span></div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
              {/* 章节进度条 (简单) */}
              <Progress value={contentPct} className="h-2 bg-zinc-800" />
              {/* feat-round-10 A4: 分段进度条 — 日志级别比例 (绿/琥珀/红) */}
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>日志级别分布</span>
                  <span className="tabular-nums">
                    成功 {logCounts.success} · 警告 {logCounts.warn} · 错误 {logCounts.error}
                  </span>
                </div>
                <div
                  className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800"
                  role="img"
                  aria-label={`日志级别分布: 成功 ${logCounts.success} 警告 ${logCounts.warn} 错误 ${logCounts.error}`}
                >
                  {segmentProps.hasData ? (
                    <>
                      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${segmentProps.successPct}%` }} />
                      <div className="h-full bg-amber-500 transition-all" style={{ width: `${segmentProps.warnPct}%` }} />
                      <div className="h-full bg-red-500 transition-all" style={{ width: `${segmentProps.errorPct}%` }} />
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">暂无日志数据</div>
                  )}
                </div>
              </div>
            </div>
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

      {/* feat-round-10 A3: 错误统计行 (5 个小卡片: 成功/警告/错误/速率/预估剩余) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <ErrorStatCard
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
          label="成功"
          value={fmtNum(logCounts.success)}
          tone="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
        />
        <ErrorStatCard
          icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
          label="警告"
          value={fmtNum(logCounts.warn)}
          tone="border-amber-500/30 bg-amber-500/10 text-amber-400"
        />
        <ErrorStatCard
          icon={<XCircle className="h-4 w-4" aria-hidden />}
          label="错误"
          value={fmtNum(logCounts.error)}
          tone="border-red-500/30 bg-red-500/10 text-red-400"
        />
        <ErrorStatCard
          icon={<Timer className="h-4 w-4" aria-hidden />}
          label="速率"
          value={`${ratePerMin.toFixed(1)} 章/分`}
          tone="border-violet-500/30 bg-violet-500/10 text-violet-400"
        />
        <ErrorStatCard
          icon={<Clock className="h-4 w-4" aria-hidden />}
          label="预估剩余"
          value={etaMin === null ? '-' : `~${etaMin}min`}
          tone="border-sky-500/30 bg-sky-500/10 text-sky-400"
        />
      </div>

      {/* feat-round-10 A2: 速率迷你图 (近10分钟速率) */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center justify-between text-xs text-zinc-300">
            <span className="flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5 text-violet-400" aria-hidden />
              近 {RATE_WINDOW_MIN} 分钟章节速率
            </span>
            <span className="font-mono text-violet-300">
              {ratePerMin.toFixed(2)} 章/分
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          {speedData.every((b) => b.count === 0) ? (
            <div className="flex h-[80px] items-center justify-center text-xs text-zinc-600">暂无速率数据</div>
          ) : (
            <div style={{ width: '100%', height: 80 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={speedData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#8b5cf6"
                    strokeWidth={1.5}
                    fill="url(#speedGradient)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* agent-H-features: 实时快照面板 (3s 轮询, 仅 running 时刷新) */}
      <TaskSnapshotPanel
        snapshot={snapshot}
        busy={snapshotBusy}
        onExportFailed={handleExportFailed}
        onRetryFailed={handleRetryFailed}
      />

      {/* 实时日志 (feat-round-10 A1: 抽离至 TaskLogViewer) */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
            <ScrollText className="h-4 w-4 text-violet-400" />
            实时日志
            <span className="text-xs font-normal text-zinc-500">(2秒增量轮询 · 共 {logs.length} 条)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <TaskLogViewer logs={logs} onClear={handleClearLogs} />
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

// feat-round-10 A3: 错误统计小卡片 (图标 + 标签 + 值)
function ErrorStatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: string
}) {
  return (
    <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${tone}`}>
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
        <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  )
}

// agent-H-features: 实时快照面板 —— 显示 currentUrl/requestCount/bytesFetched/ETA/内存压力/最近日志
// + 请求预算进度条 + 失败书籍导出/重试按钮; 仅 running 时由父组件轮询刷新, 非运行时显示空态提示
function TaskSnapshotPanel({
  snapshot,
  busy,
  onExportFailed,
  onRetryFailed,
}: {
  snapshot: SnapshotData | null
  busy: boolean
  onExportFailed: () => void
  onRetryFailed: () => void
}) {
  // 当前 URL 截断到 60 字符
  const truncateUrl = (s: string): string => {
    if (!s) return '-'
    return s.length > 60 ? s.slice(0, 57) + '...' : s
  }

  // 字节数 → 人类可读 (B/KB/MB/GB)
  const fmtBytes = (n: number): string => {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  // ETA 秒 → 人类可读 ("~12分30秒" / "~45秒" / "-")
  const fmtEta = (s: number | null): string => {
    if (s === null || !Number.isFinite(s)) return '-'
    if (s < 60) return `~${s}秒`
    const m = Math.floor(s / 60)
    const sec = s % 60
    if (m < 60) return `~${m}分${sec > 0 ? `${sec}秒` : ''}`
    const h = Math.floor(m / 60)
    const mm = m % 60
    return `~${h}时${mm > 0 ? `${mm}分` : ''}`
  }

  // 请求预算进度比 (requestCount / maxRequests * 100), maxRequests=0 时不显示
  const budgetPct = snapshot && snapshot.maxRequests > 0
    ? Math.min(100, Math.round((snapshot.requestCount / snapshot.maxRequests) * 100))
    : 0

  // 内存压力级别 (resumeSetsSize 越接近 50000 上限越告急)
  const memPressureLevel = (size: number): { pct: number; tone: string } => {
    const pct = Math.min(100, Math.round((size / 50000) * 100))
    if (pct < 50) return { pct, tone: 'bg-emerald-500' }
    if (pct < 80) return { pct, tone: 'bg-amber-500' }
    return { pct, tone: 'bg-red-500' }
  }

  const memTone = snapshot ? memPressureLevel(snapshot.memResumeSetsSize) : null

  // 最近日志自动滚动 (新日志到达时滚到底部)
  const logsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [snapshot?.recentLogs])

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm text-zinc-200">
          <span className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-violet-400" aria-hidden />
            实时快照
            <span className="text-xs font-normal text-zinc-500">(3秒轮询 · 仅运行中刷新)</span>
          </span>
          {snapshot && snapshot.running && (
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
              实时
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-2">
        {!snapshot || !snapshot.running ? (
          <div className="flex h-24 items-center justify-center text-xs text-zinc-600">
            {snapshot ? '任务未运行, 快照已停止刷新' : '尚未获取快照数据'}
          </div>
        ) : (
          <>
            {/* 当前 URL */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <Database className="h-3 w-3" aria-hidden />
                当前请求 URL
              </div>
              <div className="truncate font-mono text-xs text-zinc-300" title={snapshot.currentUrl || '-'}>
                {truncateUrl(snapshot.currentUrl)}
              </div>
            </div>

            {/* 计数器行: 请求数 / 已下载 / ETA / 失败数 */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SnapshotStat label="请求总数" value={fmtNum(snapshot.requestCount)} icon={<RefreshCw className="h-3 w-3" />} tone="text-sky-400" />
              <SnapshotStat label="已下载" value={fmtBytes(snapshot.bytesFetched)} icon={<Database className="h-3 w-3" />} tone="text-emerald-400" />
              <SnapshotStat label="ETA" value={fmtEta(snapshot.eta)} icon={<Clock className="h-3 w-3" />} tone="text-violet-400" />
              <SnapshotStat
                label="失败书籍"
                value={fmtNum(snapshot.failedBookUrlsCount)}
                icon={<AlertTriangle className="h-3 w-3" />}
                tone={snapshot.failedBookUrlsCount > 0 ? 'text-red-400' : 'text-zinc-400'}
              />
            </div>

            {/* 请求预算进度条 (maxRequests > 0 时显示) */}
            {snapshot.maxRequests > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">请求预算</span>
                  <span className="font-mono text-zinc-300">
                    {fmtNum(snapshot.requestCount)} / {fmtNum(snapshot.maxRequests)}
                    <span className="ml-1 text-zinc-500">({budgetPct}%)</span>
                  </span>
                </div>
                <Progress
                  value={budgetPct}
                  className={
                    budgetPct >= 90
                      ? 'h-2 bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-red-500'
                      : 'h-2 bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-violet-500'
                  }
                />
                {budgetPct >= 90 && (
                  <div className="flex items-center gap-1 text-[11px] text-red-400">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    请求预算即将耗尽, 任务将在超出后自动停止
                  </div>
                )}
              </div>
            )}

            {/* 内存压力行 (resume Sets size, 接近 50000 上限时变红) */}
            {memTone && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-zinc-400">
                    <MemoryStick className="h-3 w-3" aria-hidden />
                    内存压力 (resume Sets)
                  </span>
                  <span className="font-mono text-zinc-300">
                    {fmtNum(snapshot.memResumeSetsSize)} / 50,000
                    <span className="ml-1 text-zinc-500">({memTone.pct}%)</span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full transition-all ${memTone.tone}`}
                    style={{ width: `${Math.max(2, memTone.pct)}%` }}
                    role="img"
                    aria-label={`内存压力 ${memTone.pct}%`}
                  />
                </div>
              </div>
            )}

            {/* 失败书籍导出 + 重试按钮 (failedBookUrlsCount > 0 时显示) */}
            {snapshot.failedBookUrlsCount > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                <span className="text-xs text-red-300">
                  共有 {fmtNum(snapshot.failedBookUrlsCount)} 本失败书籍
                </span>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800"
                  onClick={onExportFailed}
                >
                  <Download className="h-3 w-3" aria-hidden />
                  导出失败列表
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 border-amber-500/40 bg-amber-500/10 text-xs text-amber-400 hover:bg-amber-500/20"
                  disabled={busy}
                  onClick={onRetryFailed}
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RotateCw className="h-3 w-3" aria-hidden />}
                  重试仅失败书籍
                </Button>
              </div>
            )}

            {/* 最近日志 (auto-scroll 到底部; 来自 snapshot.recentLogs, 不走 logs 主轮询) */}
            <div className="space-y-1">
              <div className="text-[11px] text-zinc-500">最近日志 (来自任务快照, 最多 10 条)</div>
              <div
                ref={logsRef}
                className="max-h-48 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] leading-relaxed"
              >
                {snapshot.recentLogs && snapshot.recentLogs.length > 0 ? (
                  <ul className="space-y-0.5">
                    {snapshot.recentLogs.map((l, i) => (
                      <li key={`${l.ts}-${i}`} className="flex gap-2">
                        <span className="shrink-0 text-zinc-600">
                          {new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                        </span>
                        <span className={LOG_LEVEL_STYLE[l.level] || 'text-zinc-300'}>
                          {l.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex h-12 items-center justify-center text-zinc-600">暂无日志</div>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// agent-H-features: 快照小统计卡片 (图标 + 标签 + 值)
function SnapshotStat({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] text-zinc-500">
        <span className={tone}>{icon}</span>
        {label}
      </div>
      <div className={`mt-0.5 truncate font-mono text-sm font-semibold tabular-nums ${tone}`} title={value}>
        {value}
      </div>
    </div>
  )
}

/** HH:mm:ss 时间格式 (展示用) */
function fmtTime(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

/** 毫秒时间戳 (速率图分桶用); 解析失败回退 0 */
function safeTs(s: string): number {
  const d = new Date(s)
  if (isNaN(d.getTime())) return 0
  return d.getTime()
}
