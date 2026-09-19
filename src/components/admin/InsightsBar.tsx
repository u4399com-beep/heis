'use client'

// ============================================================
// InsightsBar — feat-ui-4 仪表盘洞察条
// 4 卡聚合: 今日采集 / 任务队列 / 规则健康度 / 错误摘要
//
// 数据源:
// - stats (props, 由 Dashboard 从 /api/admin/stats 拉取)
// - /api/admin/tasks 二次拉取: 聚合 task.stats 算 rule 健康度 + 取 top 错误任务
//
// 设计要点:
// - 仅读不写, 不与既有端点冲突
// - 二次拉取 30s 节流, 且 Dashboard 自动刷新开关关闭时也停止
// - 4 卡 grid: lg 4 列, sm 2 列, mobile 1 列
// - 卡片点击导航到对应区块 (onNavigate)
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Activity,
  AlertOctagon,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileText,
  HeartPulse,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import {
  api,
  fmtDateTime,
  fmtNum,
  fmtWords,
  safeJsonParse,
  useAliveRef,
  type StatsData,
  type TaskRow,
  type TaskStats,
  type TaskStatus,
} from './helpers'

const REFRESH_MS = 30_000

interface RuleAgg {
  ruleId: string
  ruleName: string
  totalTasks: number
  successTasks: number
  errorTasks: number
  errors: number
  booksCreated: number
  chaptersCreated: number
  lastRunAt: string | null
  /** 0~100 健康度: successTasks / totalTasks, errors>0 时再扣 5/errors/100 */
  health: number
  /** agent-PP-ui5: 0~100 采集质量评分 (与 health 不同维度):
   *  base = successTasks/totalTasks * 100
   *  - 若 booksCreated > 0 但 chaptersCreated / booksCreated < 10(疑似截断/只有书没章): -15
   *  - 若 errors / max(1, booksCreated) > 0.5(高错误率): -20
   *  - 若 errors / max(1, booksCreated) > 1.0(异常高错误率): 再 -15
   *  - 若 totalTasks >= 5(数据充足): +5 加分(可信度高)
   *  最终 clamp 0~100 */
  quality: number
  /** 用于 tooltip 展示的中间量 */
  avgChaptersPerBook: number
}

interface ErrorTask {
  id: string
  name: string
  ruleName: string
  errors: number
  lastBooksCreated: number
  lastChaptersCreated: number
  status: TaskStatus
  updatedAt: string
}

interface TasksAgg {
  rules: RuleAgg[]
  topErrors: ErrorTask[]
}

function aggregateTasks(tasks: TaskRow[]): TasksAgg {
  const ruleMap = new Map<string, RuleAgg>()
  for (const t of tasks) {
    const rid = t.rule?.id || t.ruleId
    if (!rid) continue
    const rname = t.rule?.name || rid
    const st = safeJsonParse<TaskStats>(t.stats, {})
    let r = ruleMap.get(rid)
    if (!r) {
      r = {
        ruleId: rid,
        ruleName: rname,
        totalTasks: 0,
        successTasks: 0,
        errorTasks: 0,
        errors: 0,
        booksCreated: 0,
        chaptersCreated: 0,
        lastRunAt: null,
        health: 100,
        quality: 100,
        avgChaptersPerBook: 0,
      }
      ruleMap.set(rid, r)
    }
    r.totalTasks += 1
    if (t.status === 'done') r.successTasks += 1
    if (t.status === 'error') r.errorTasks += 1
    r.errors += st.errors || 0
    r.booksCreated += st.booksCreated || 0
    r.chaptersCreated += st.chaptersCreated || 0
    if (!r.lastRunAt || t.updatedAt > r.lastRunAt) r.lastRunAt = t.updatedAt
  }
  for (const r of ruleMap.values()) {
    const denom = Math.max(1, r.totalTasks)
    // 健康度: 成功率 - 错误占比罚分
    const base = (r.successTasks / denom) * 100
    const penalty = Math.min(50, (r.errors / Math.max(1, r.booksCreated + r.chaptersCreated)) * 100)
    r.health = Math.max(0, Math.min(100, Math.round(base - penalty)))
    // agent-PP-ui5: 质量评分 — 基于成功率 + 内容完整度 + 错误密度
    r.avgChaptersPerBook = r.booksCreated > 0 ? r.chaptersCreated / r.booksCreated : 0
    let q = base
    if (r.booksCreated > 0 && r.avgChaptersPerBook < 10) q -= 15
    const errorRate = r.errors / Math.max(1, r.booksCreated)
    if (errorRate > 0.5) q -= 20
    if (errorRate > 1.0) q -= 15
    if (r.totalTasks >= 5) q += 5
    r.quality = Math.max(0, Math.min(100, Math.round(q)))
  }
  const rules = Array.from(ruleMap.values()).sort((a, b) => a.health - b.health || b.errors - a.errors)
  const topErrors: ErrorTask[] = tasks
    .map((t) => {
      const st = safeJsonParse<TaskStats>(t.stats, {})
      return {
        id: t.id,
        name: t.name,
        ruleName: t.rule?.name || t.ruleId,
        errors: st.errors || 0,
        lastBooksCreated: st.booksCreated || 0,
        lastChaptersCreated: st.chaptersCreated || 0,
        status: t.status,
        updatedAt: t.updatedAt,
      }
    })
    .filter((e) => e.errors > 0 || e.status === 'error')
    .sort((a, b) => b.errors - a.errors)
    .slice(0, 5)
  return { rules, topErrors }
}

interface InsightsBarProps {
  stats: StatsData | null
  loading: boolean
  autoRefresh: boolean
  onNavigate?: (section: string) => void
  /** 跳到指定任务的监控视图 (透传到 TasksSection) */
  onViewTask?: (taskId: string) => void
}

function healthTone(h: number): { dot: string; chip: string; label: string } {
  if (h >= 80) return { dot: 'bg-emerald-400', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', label: '健康' }
  if (h >= 50) return { dot: 'bg-amber-400', chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40', label: '一般' }
  return { dot: 'bg-red-400', chip: 'bg-red-500/15 text-red-300 border-red-500/40', label: '需关注' }
}

export function InsightsBar({ stats, loading, autoRefresh, onNavigate, onViewTask }: InsightsBarProps) {
  const [agg, setAgg] = useState<TasksAgg | null>(null)
  const [aggLoading, setAggLoading] = useState(true)
  const [aggRefreshing, setAggRefreshing] = useState(false)
  const aliveRef = useAliveRef()
  const seqRef = useRef(0)

  const loadAgg = useCallback(async (opts: { isFirst: boolean }) => {
    const seq = ++seqRef.current
    if (opts.isFirst) setAggLoading(true)
    else setAggRefreshing(true)
    try {
      const data = await api.get<TaskRow[]>('/api/admin/tasks')
      if (!aliveRef.current || seq !== seqRef.current) return
      setAgg(aggregateTasks(Array.isArray(data) ? data : []))
    } catch {
      // 静默: 卡片显示空态
    } finally {
      if (aliveRef.current && seq === seqRef.current) {
        setAggLoading(false)
        setAggRefreshing(false)
      }
    }
  }, [aliveRef])

  // 首次挂载 + 30s 轮询 (autoRefresh=false 时仅拉一次)
  useEffect(() => {
    loadAgg({ isFirst: true })
    if (!autoRefresh) return
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadAgg({ isFirst: false })
      }
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [loadAgg, autoRefresh])

  // 今日采集: booksLast7d[6] / chaptersLast7d[6] 是今日(由后端 empty7d + bucketize7d 生成)
  const todayBooks = stats?.booksLast7d?.[6]?.count ?? 0
  const todayChapters = stats?.chaptersLast7d?.[6]?.count ?? 0
  const todayWords = useMemo(() => {
    // 后端无今日字数直出; 用今日章节数 × 全站平均字数估算
    if (todayChapters === 0) return 0
    const avgPerCh = stats?.chapters ? Math.round((stats.totalWords || 0) / Math.max(1, stats.chapters)) : 0
    return todayChapters * avgPerCh
  }, [todayChapters, stats?.chapters, stats?.totalWords])

  // 任务队列: pending + running + paused
  const queue = useMemo(() => {
    const arr = stats?.taskStatusBreakdown || []
    const find = (s: string) => arr.find((x) => x.status === s)?.count ?? 0
    return {
      pending: find('pending'),
      running: find('running'),
      paused: find('paused'),
      done: find('done'),
      error: find('error'),
      total: arr.reduce((s, x) => s + x.count, 0),
    }
  }, [stats?.taskStatusBreakdown])

  const pendingRunning = queue.pending + queue.running
  const queuePct = queue.total > 0 ? Math.round((queue.done / queue.total) * 100) : 0

  // 规则健康度 Top 5 (健康度最低/错误最多)
  const topRules = useMemo(() => (agg?.rules || []).slice(0, 5), [agg])
  // agent-VV-ui6: 规则使用统计 — 按 booksCreated 倒序的 Top 5 (哪些规则产书最多)
  const topRulesByProduction = useMemo(
    () => (agg?.rules || []).slice().sort((a, b) => b.booksCreated - a.booksCreated || b.chaptersCreated - a.chaptersCreated).slice(0, 5),
    [agg],
  )
  const totalBooksProduced = useMemo(() => (agg?.rules || []).reduce((s, r) => s + r.booksCreated, 0), [agg])
  const totalChaptersProduced = useMemo(() => (agg?.rules || []).reduce((s, r) => s + r.chaptersCreated, 0), [agg])
  const totalRules = agg?.rules.length ?? 0
  const healthyRules = useMemo(() => (agg?.rules || []).filter((r) => r.health >= 80).length, [agg])
  const warningRules = useMemo(() => (agg?.rules || []).filter((r) => r.health >= 50 && r.health < 80).length, [agg])
  const criticalRules = useMemo(() => (agg?.rules || []).filter((r) => r.health < 50).length, [agg])

  const topErrors = agg?.topErrors || []

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {/* ---------- 1. 今日采集 ---------- */}
      <Card
        className="group relative cursor-pointer border-zinc-800 bg-zinc-900/60 transition-colors hover:border-sky-500/40"
        role="button"
        tabIndex={0}
        aria-label="查看书籍管理"
        onClick={() => onNavigate?.('books')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onNavigate?.('books')
          }
        }}
      >
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-950/60 text-sky-400 ring-1 ring-zinc-800">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              今日采集
            </div>
            <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-500">
              近 24h
            </Badge>
          </div>
          {loading ? (
            <div className="space-y-2">
              <div className="h-7 w-24 animate-pulse rounded bg-zinc-800/40" />
              <div className="h-3 w-32 animate-pulse rounded bg-zinc-800/40" />
            </div>
          ) : (
            <>
              <div className="flex items-end gap-3">
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-zinc-100">
                    {fmtNum(todayBooks)}
                    <span className="ml-1 text-xs font-normal text-zinc-500">本</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">书籍入库</div>
                </div>
                <div className="ml-auto">
                  <div className="text-2xl font-semibold tabular-nums text-zinc-100">
                    {fmtNum(todayChapters)}
                    <span className="ml-1 text-xs font-normal text-zinc-500">章</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">章节入库</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-500">
                <FileText className="h-3 w-3" aria-hidden />
                <span>约 {fmtWords(todayWords)} 字</span>
                <ArrowRight className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- 2. 任务队列 ---------- */}
      <Card
        className="group relative cursor-pointer border-zinc-800 bg-zinc-900/60 transition-colors hover:border-emerald-500/40"
        role="button"
        tabIndex={0}
        aria-label="查看采集任务"
        onClick={() => onNavigate?.('tasks')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onNavigate?.('tasks')
          }
        }}
      >
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-950/60 text-emerald-400 ring-1 ring-zinc-800">
                <ListChecks className="h-3.5 w-3.5" />
              </span>
              任务队列
            </div>
            <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-500">
              共 {queue.total} 个
            </Badge>
          </div>
          {loading ? (
            <div className="space-y-2">
              <div className="h-7 w-24 animate-pulse rounded bg-zinc-800/40" />
              <div className="h-1.5 w-full animate-pulse rounded bg-zinc-800/40" />
            </div>
          ) : (
            <>
              <div className="flex items-end gap-3">
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-zinc-100">
                    {fmtNum(pendingRunning)}
                    <span className="ml-1 text-xs font-normal text-zinc-500">活跃</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">待 {queue.pending} · 运 {queue.running} · 暂 {queue.paused}</div>
                </div>
                <div className="ml-auto flex flex-col items-end gap-1">
                  {queue.error > 0 ? (
                    <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-[10px] text-red-300">
                      <AlertOctagon className="mr-1 h-2.5 w-2.5" aria-hidden />
                      {queue.error} 失败
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-300">
                      <CheckCircle2 className="mr-1 h-2.5 w-2.5" aria-hidden />
                      全部正常
                    </Badge>
                  )}
                  <span className="text-[10px] text-zinc-600">完成 {queue.done}</span>
                </div>
              </div>
              <Progress value={queuePct} className="mt-3 h-1.5 bg-zinc-800" />
              <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-600">
                <span>完成率</span>
                <span className="tabular-nums">{queuePct}%</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- 3. 规则健康度 ---------- */}
      <Card
        className="group relative cursor-pointer border-zinc-800 bg-zinc-900/60 transition-colors hover:border-violet-500/40"
        role="button"
        tabIndex={0}
        aria-label="查看采集规则"
        onClick={() => onNavigate?.('rules')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onNavigate?.('rules')
          }
        }}
      >
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-950/60 text-violet-400 ring-1 ring-zinc-800">
                <HeartPulse className="h-3.5 w-3.5" />
              </span>
              规则健康度
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                loadAgg({ isFirst: false })
              }}
              disabled={aggLoading || aggRefreshing}
              aria-label="刷新规则健康度"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            >
              {aggRefreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </button>
          </div>
          {aggLoading ? (
            <div className="space-y-2">
              <div className="h-7 w-24 animate-pulse rounded bg-zinc-800/40" />
              <div className="h-1.5 w-full animate-pulse rounded bg-zinc-800/40" />
            </div>
          ) : totalRules === 0 ? (
            <div className="flex flex-col items-center gap-2 py-3 text-center text-[11px] text-zinc-600">
              <HeartPulse className="h-5 w-5" />
              暂无规则
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-end gap-3">
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-zinc-100">
                    {totalRules}
                    <span className="ml-1 text-xs font-normal text-zinc-500">规则</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                    <span className="text-emerald-400">●{healthyRules}</span>
                    <span className="text-amber-400">●{warningRules}</span>
                    <span className="text-red-400">●{criticalRules}</span>
                  </div>
                </div>
                <div className="ml-auto flex flex-wrap justify-end gap-1">
                  {topRules.slice(0, 3).map((r) => {
                    const tone = healthTone(r.health)
                    return (
                      <Tooltip key={r.ruleId}>
                        <TooltipTrigger asChild>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] ${tone.chip}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                            {r.health}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          <div className="font-medium">{r.ruleName}</div>
                          <div className="mt-0.5 text-[10px] text-zinc-400">
                            健康 {r.health} · 质量 {r.quality} · 任务 {r.totalTasks} · 失败 {r.errorTasks} · 错误 {r.errors} · 入库 {r.booksCreated} 本 / {r.chaptersCreated} 章
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            均 {r.avgChaptersPerBook.toFixed(1)} 章/本
                          </div>
                          {r.lastRunAt && (
                            <div className="text-[10px] text-zinc-500">最近运行 {fmtDateTime(r.lastRunAt)}</div>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                {topRules.map((r) => {
                  const tone = healthTone(r.health)
                  const qTone = healthTone(r.quality)
                  return (
                    <div key={r.ruleId} className="flex items-center gap-2 text-[11px]">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-zinc-300" title={r.ruleName}>{r.ruleName}</span>
                      <span className="tabular-nums text-zinc-500">{r.errors}</span>
                      <span className="text-zinc-600">err</span>
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`inline-flex items-center gap-0.5 rounded px-1 text-[9px] font-mono ${qTone.chip}`} title="质量评分">
                              Q{r.quality}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            <div>采集质量评分: {r.quality}</div>
                            <div className="text-zinc-400">均 {r.avgChaptersPerBook.toFixed(1)} 章/本 · 错误 {r.errors} · 入库 {r.booksCreated}本/{r.chaptersCreated}章</div>
                          </TooltipContent>
                        </Tooltip>
                        <div className="w-10">
                          <Progress value={r.health} className="h-1 bg-zinc-800" />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* agent-VV-ui6: 规则使用统计 — Top 5 产书规则 (按 booksCreated 倒序) */}
              {topRulesByProduction.length > 0 && totalBooksProduced > 0 && (
                <div className="mt-3 border-t border-zinc-800 pt-2.5">
                  <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-500">
                    <span className="flex items-center gap-1">
                      <BarChart3 className="h-3 w-3 text-violet-400" aria-hidden />
                      产书 Top {Math.min(5, topRulesByProduction.length)}
                    </span>
                    <span className="font-mono tabular-nums">
                      累计 {fmtNum(totalBooksProduced)} 本 / {fmtNum(totalChaptersProduced)} 章
                    </span>
                  </div>
                  <div className="space-y-1">
                    {topRulesByProduction.map((r, i) => {
                      const pct = totalBooksProduced > 0 ? (r.booksCreated / totalBooksProduced) * 100 : 0
                      return (
                        <div key={`prod-${r.ruleId}`} className="flex items-center gap-2 text-[10px]">
                          <span className="w-4 shrink-0 text-right font-mono text-zinc-600 tabular-nums">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-zinc-300" title={r.ruleName}>{r.ruleName}</span>
                          <div className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
                            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style={{ width: `${Math.max(2, pct)}%` }} />
                          </div>
                          <span className="w-12 shrink-0 text-right font-mono tabular-nums text-zinc-300">{r.booksCreated}</span>
                          <span className="text-zinc-600">本</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- 4. 错误摘要 ---------- */}
      <Card
        className="group relative cursor-pointer border-zinc-800 bg-zinc-900/60 transition-colors hover:border-red-500/40"
        role="button"
        tabIndex={0}
        aria-label="查看采集任务错误"
        onClick={() => onNavigate?.('tasks')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onNavigate?.('tasks')
          }
        }}
      >
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-950/60 text-red-400 ring-1 ring-zinc-800">
                <TriangleAlert className="h-3.5 w-3.5" />
              </span>
              错误摘要
            </div>
            <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-500">
              Top {Math.min(5, topErrors.length)}
            </Badge>
          </div>
          {aggLoading ? (
            <div className="space-y-2">
              <div className="h-7 w-24 animate-pulse rounded bg-zinc-800/40" />
              <div className="h-3 w-full animate-pulse rounded bg-zinc-800/40" />
            </div>
          ) : topErrors.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-3 text-center text-[11px] text-zinc-600">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              暂无错误任务
            </div>
          ) : (
            <>
              <div className="admin-scroll max-h-40 space-y-1.5 overflow-y-auto">
                {topErrors.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (onViewTask) onViewTask(t.id)
                      else onNavigate?.('tasks')
                    }}
                    className="flex w-full items-center gap-2 rounded border border-zinc-800 bg-zinc-950/50 p-2 text-left transition-colors hover:border-red-500/40 hover:bg-zinc-900"
                    aria-label={`查看任务 ${t.name} 错误`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-[10px] font-bold text-red-300">
                      {t.errors > 99 ? '99+' : t.errors}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-zinc-200" title={t.name}>{t.name}</div>
                      <div className="truncate text-[10px] text-zinc-500" title={t.ruleName}>
                        {t.ruleName} · {fmtDateTime(t.updatedAt)}
                      </div>
                    </div>
                    <ArrowRight className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden />
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[10px] text-zinc-600">
                <Activity className="h-2.5 w-2.5" aria-hidden />
                <span>点击任务进入监控查看错误日志</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
