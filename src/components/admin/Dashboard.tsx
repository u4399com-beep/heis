'use client'

// ============================================================
// 仪表盘 — feat-b 数据可视化增强
// 布局: 系统健康 → 统计卡片 → 采集活动(面积) + 状态分布(饼)
//       → 分类字数排行(条) + 任务状态分布(条) → 最近任务 + 最近入库 + 分类分布
// ============================================================
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Activity,
  BarChart3,
  BookOpen,
  Download,
  FileText,
  Globe,
  LayoutDashboard,
  ListTodo,
  Loader2,
  PieChart as PieIcon,
  RefreshCw,
  ScrollText,
  Tag,
} from 'lucide-react'
import { HealthCard } from './HealthCard'
import {
  api,
  BOOK_STATUS_META,
  coverUrl,
  fmtDateTime,
  fmtNum,
  fmtWords,
  PHASE_META,
  safeJsonParse,
  TASK_STATUS_META,
  type StatsData,
  type TaskProgress,
  type TaskStatus,
} from './helpers'

// ---------------- 图表主题色 ----------------
const CHART_COLORS = {
  violet: '#8b5cf6',
  fuchsia: '#d946ef',
  sky: '#0ea5e9',
  emerald: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
  zinc: '#71717a',
  zincLight: '#a1a1aa',
  grid: 'rgba(255,255,255,0.06)',
  tick: '#a1a1aa',
  tooltipBg: '#18181b',
  tooltipBorder: '#3f3f46',
} as const

// 书籍状态 → 图表色 (语义色: 完成=绿, 连载=蓝, 未知=zinc)
const BOOK_STATUS_CHART_COLOR: Record<string, string> = {
  completed: CHART_COLORS.emerald,
  ongoing: CHART_COLORS.blue,
  unknown: CHART_COLORS.zinc,
}

// 任务状态 → 图表色
const TASK_STATUS_CHART_COLOR: Record<string, string> = {
  running: CHART_COLORS.emerald,
  paused: CHART_COLORS.amber,
  stopped: CHART_COLORS.zinc,
  done: CHART_COLORS.blue,
  error: CHART_COLORS.red,
  pending: CHART_COLORS.zincLight,
}

// recharts Tooltip 内容样式 (深色面板)
const tooltipContentStyle = {
  background: CHART_COLORS.tooltipBg,
  border: `1px solid ${CHART_COLORS.tooltipBorder}`,
  borderRadius: 8,
  fontSize: 12,
  color: '#e4e4e7',
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
} as const

interface DashboardProps {
  onNavigate?: (section: string) => void
}

// ---------------- 通用图表卡 (header + 图区 + 空态/加载态) ----------------
function ChartCard({
  title,
  icon: Icon,
  loading,
  isEmpty,
  children,
  action,
}: {
  title: string
  icon: typeof Activity
  loading: boolean
  isEmpty: boolean
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-950/60 text-violet-400 ring-1 ring-zinc-800">
            <Icon className="h-3.5 w-3.5" />
          </span>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {loading ? (
          <div className="h-[240px] w-full animate-pulse rounded-md bg-zinc-800/40" />
        ) : isEmpty ? (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center">
            <Icon className="h-6 w-6 text-zinc-700" />
            <p className="text-xs text-zinc-500">暂无数据，开始采集后这里会显示统计图表</p>
          </div>
        ) : (
          <div className="h-[240px] w-full">{children}</div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------- 自定义 Tooltip: 采集活动 ----------------
function ActivityTooltipContent({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={tooltipContentStyle} className="px-3 py-2">
      <div className="mb-1 text-[11px] text-zinc-400">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-zinc-300">{p.name}</span>
          <span className="ml-auto font-mono text-zinc-100">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------- 自定义 Tooltip: 状态饼图 ----------------
function StatusTooltipContent({ active, payload }: {
  active?: boolean
  payload?: Array<{
    name: string
    value: number
    payload?: { status: string; count: number; color: string; label: string; pct: string }
  }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={tooltipContentStyle} className="px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: d.color }} />
        <span className="text-zinc-300">{d.label}</span>
      </div>
      <div className="mt-1 font-mono text-xs text-zinc-100">{d.count} 本 · {d.pct}</div>
    </div>
  )
}

// ---------------- 自定义 Legend: 状态饼图 (含计数 + 百分比) ----------------
function renderStatusLegend(value: string, entry: { payload?: unknown }) {
  const p = entry?.payload as { count?: number; pct?: string } | undefined
  const count = p?.count ?? 0
  const pct = p?.pct ?? ''
  return (
    <span className="text-xs text-zinc-300">
      {value} <span className="font-mono text-zinc-400">{count} · {pct}</span>
    </span>
  )
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<StatsData>('/api/admin/stats')
      setStats(data)
    } catch {
      // 静默失败, 卡片显示 0
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次挂载拉取 (StrictMode 双挂载也安全: 不依赖外部 ref, 仅响应最新一次 setState)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await api.get<StatsData>('/api/admin/stats')
        if (!cancelled) setStats(data)
      } catch {
        // 静默失败
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // tone=图标色 + glow=渐变光晕色(卡片右上角微光, feat-round-3 样式细节)
  const cards = [
    { key: 'books', label: '书籍', value: stats?.books ?? 0, icon: BookOpen, tone: 'text-violet-400', glow: 'from-violet-500/15', section: 'books' },
    {
      key: 'chapters',
      label: '章节',
      value: stats?.chapters ?? 0,
      sub: `总字数 ${fmtWords(stats?.totalWords)}`,
      icon: FileText,
      tone: 'text-sky-400',
      glow: 'from-sky-500/15',
      section: 'books',
    },
    { key: 'rules', label: '采集规则', value: stats?.rules ?? 0, icon: ScrollText, tone: 'text-amber-400', glow: 'from-amber-500/15', section: 'rules' },
    {
      key: 'tasks',
      label: '采集任务',
      value: stats?.tasks ?? 0,
      sub: `运行中 ${stats?.runningTasks ?? 0}`,
      icon: ListTodo,
      tone: 'text-emerald-400',
      glow: 'from-emerald-500/15',
      section: 'tasks',
    },
    { key: 'sites', label: '站点', value: stats?.sites ?? 0, icon: Globe, tone: 'text-teal-400', glow: 'from-teal-500/15', section: 'sites' },
    { key: 'tags', label: '下拉词', value: stats?.tags ?? 0, icon: Tag, tone: 'text-rose-400', glow: 'from-rose-500/15', section: 'books' },
    { key: 'downloads', label: '下载成品', value: stats?.downloads ?? 0, icon: Download, tone: 'text-orange-400', glow: 'from-orange-500/15', section: 'downloads' },
  ]

  // ---- 可视化数据准备 ----
  // 采集活动: 把 chaptersLast7d + booksLast7d 合并为一个数据集 {day, chapters, books}
  const activityData =
    stats?.chaptersLast7d && stats?.booksLast7d
      ? stats.chaptersLast7d.map((c, i) => ({
          day: c.day,
          chapters: c.count,
          books: stats.booksLast7d[i]?.count ?? 0,
        }))
      : []
  const activityTotal = activityData.reduce((s, d) => s + d.chapters + d.books, 0)

  // 书籍状态饼图
  const statusData =
    stats?.booksByStatus?.map((s) => {
      const meta = BOOK_STATUS_META[s.status] || BOOK_STATUS_META.unknown
      return {
        status: s.status,
        name: meta.label,
        label: meta.label,
        value: s.count,
        count: s.count,
        color: BOOK_STATUS_CHART_COLOR[s.status] || CHART_COLORS.zinc,
      }
    }) || []
  const statusTotal = statusData.reduce((s, d) => s + d.count, 0)
  const statusDataWithPct = statusData.map((d) => ({
    ...d,
    pct: statusTotal > 0 ? `${((d.count / statusTotal) * 100).toFixed(1)}%` : '0%',
  }))

  // 分类字数排行 (top 10, 字数降序)
  const wordsByCategory = (stats?.wordsByCategory || [])
    .filter((c) => c.words > 0)
    .slice(0, 10)
    .map((c) => ({ name: c.name, words: c.words, wordsLabel: fmtWords(c.words) }))
  const wordsTotal = wordsByCategory.reduce((s, d) => s + d.words, 0)

  // 任务状态分布 (固定 6 状态顺序: pending/running/paused/stopped/done/error)
  const TASK_STATUS_ORDER: TaskStatus[] = ['pending', 'running', 'paused', 'stopped', 'done', 'error']
  const taskStatusData = TASK_STATUS_ORDER.map((st) => {
    const found = stats?.taskStatusBreakdown?.find((s) => s.status === st)
    const meta = TASK_STATUS_META[st]
    return {
      status: st,
      label: meta.label,
      count: found?.count ?? 0,
      color: TASK_STATUS_CHART_COLOR[st],
    }
  })
  const taskTotal = taskStatusData.reduce((s, d) => s + d.count, 0)

  const maxCat = Math.max(1, ...(stats?.categories || []).map((c) => c._count?.books || 0))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <LayoutDashboard className="h-5 w-5 text-violet-400" />
            仪表盘
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">书库与采集系统运行总览</p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={load}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          刷新数据
        </Button>
      </div>

      {/* 系统健康 (auto-refresh 30s) */}
      <HealthCard onSessionExpired={() => setStats(null)} />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-7">
        {cards.map((c) => (
          <Card
            key={c.key}
            role="button"
            tabIndex={0}
            aria-label={`查看${c.label}`}
            className="cursor-pointer border-zinc-800 bg-zinc-900/60 transition-all duration-200 hover:-translate-y-1 hover:scale-[1.02] hover:border-violet-600/60 hover:bg-zinc-900 hover:shadow-lg hover:shadow-violet-950/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
            onClick={() => onNavigate?.(c.section)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNavigate?.(c.section)
              }
            }}
          >
            <CardContent className="relative overflow-hidden p-4">
              {/* feat-round-3: 右上角色调光晕(渐变 radial, 与卡片图标色呼应) */}
              <div
                className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br ${c.glow} to-transparent blur-xl`}
                aria-hidden
              />
              <div className="relative flex items-center justify-between">
                <span className="text-xs text-zinc-500">{c.label}</span>
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-950/60 ring-1 ring-zinc-800 ${c.tone}`}
                  aria-hidden
                >
                  <c.icon className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="relative mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                {loading ? <Loader2 className="h-5 w-5 animate-spin text-zinc-600" /> : fmtNum(c.value)}
              </div>
              {c.sub && <div className="relative mt-0.5 text-[11px] text-zinc-500">{c.sub}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 第二行: 采集活动 + 状态分布 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="近7天采集活动"
          icon={Activity}
          loading={loading}
          isEmpty={!loading && activityTotal === 0}
        >
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={activityData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="gChapters" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.violet} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={CHART_COLORS.violet} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gBooks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.sky} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={CHART_COLORS.sky} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fill: CHART_COLORS.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: CHART_COLORS.tick, fontSize: 12 }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <RTooltip content={<ActivityTooltipContent />} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: '#a1a1aa' }}
                formatter={(value: string) => <span className="text-xs text-zinc-300">{value}</span>}
              />
              <Area
                type="monotone"
                dataKey="chapters"
                name="章节"
                stroke={CHART_COLORS.violet}
                strokeWidth={2}
                fill="url(#gChapters)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="books"
                name="书籍"
                stroke={CHART_COLORS.sky}
                strokeWidth={2}
                fill="url(#gBooks)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="书籍状态分布"
          icon={PieIcon}
          loading={loading}
          isEmpty={!loading && statusTotal === 0}
        >
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={statusDataWithPct}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={86}
                paddingAngle={2}
                isAnimationActive={false}
              >
                {statusDataWithPct.map((d) => (
                  <Cell key={d.status} fill={d.color} stroke="#18181b" strokeWidth={2} />
                ))}
              </Pie>
              <RTooltip content={<StatusTooltipContent />} />
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, color: '#a1a1aa' }}
                formatter={renderStatusLegend}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* 第三行: 分类字数排行 + 任务状态分布 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="分类字数排行 (Top 10)"
          icon={BarChart3}
          loading={loading}
          isEmpty={!loading && wordsTotal === 0}
          action={
            !loading && wordsTotal > 0 ? (
              <span className="text-[11px] text-zinc-500">总计 {fmtWords(wordsTotal)}</span>
            ) : null
          }
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={wordsByCategory}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
            >
              <defs>
                <linearGradient id="gCatWords" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={CHART_COLORS.violet} />
                  <stop offset="100%" stopColor={CHART_COLORS.fuchsia} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: CHART_COLORS.tick, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtWords(v)} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: CHART_COLORS.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={72}
              />
              <RTooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={tooltipContentStyle}
                formatter={(v: number) => [fmtWords(v), '字数']}
                labelFormatter={(l: unknown) => `分类: ${String(l)}`}
              />
              <Bar dataKey="words" fill="url(#gCatWords)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="任务状态分布"
          icon={ListTodo}
          loading={loading}
          isEmpty={!loading && taskTotal === 0}
          action={
            !loading && taskTotal > 0 ? (
              <span className="text-[11px] text-zinc-500">共 {taskTotal} 个任务</span>
            ) : null
          }
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={taskStatusData}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: CHART_COLORS.tick, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fill: CHART_COLORS.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <RTooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={tooltipContentStyle}
                formatter={(v: number) => [v, '任务数']}
                labelFormatter={(l: unknown) => `状态: ${String(l)}`}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                {taskStatusData.map((d) => (
                  <Cell key={d.status} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* 底行: 最近任务 + (最近入库 + 分类分布) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 最近任务 */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm text-zinc-200">最近任务</CardTitle>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500 hover:text-zinc-200" onClick={() => onNavigate?.('tasks')}>
              查看全部
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!stats?.recentTasks?.length ? (
              <div className="py-8 text-center text-xs text-zinc-600">暂无任务</div>
            ) : (
              <div className="space-y-2">
                {stats.recentTasks.map((t) => {
                  const meta = TASK_STATUS_META[t.status as TaskStatus] || TASK_STATUS_META.pending
                  const prog = safeJsonParse<TaskProgress>(t.progress, {})
                  // 钳制到 0~100, 防止 booksDone 计入更新导致超 100%
                  const pct = prog.contentTotal
                    ? Math.min(100, Math.round(((prog.contentDone || 0) / prog.contentTotal) * 100))
                    : prog.booksTotal
                      ? Math.min(100, Math.round(((prog.booksDone || 0) / prog.booksTotal) * 100))
                      : t.status === 'done'
                        ? 100
                        : 0
                  return (
                    <div key={t.id} className="rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-zinc-200" title={t.name}>
                          {t.name}
                        </span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${meta.className}`}>{meta.label}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
                        <span>
                          {t.rule?.name || '-'} · {PHASE_META[prog.phase || 'idle'] || ''}
                          {prog.phaseNote ? ` · ${prog.phaseNote}` : ''}
                        </span>
                        <span>{fmtDateTime(t.updatedAt)}</span>
                      </div>
                      <Progress value={pct} className="mt-2 h-1.5 bg-zinc-800" />
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* 最近入库 */}
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm text-zinc-200">最近入库书籍</CardTitle>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500 hover:text-zinc-200" onClick={() => onNavigate?.('books')}>
                查看全部
              </Button>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {!stats?.recentBooks?.length ? (
                <div className="py-8 text-center text-xs text-zinc-600">暂无书籍</div>
              ) : (
                <div className="admin-scroll max-h-64 space-y-2 overflow-y-auto">
                  {stats.recentBooks.map((b) => {
                    const meta = BOOK_STATUS_META[b.status] || BOOK_STATUS_META.unknown
                    return (
                      <div key={b.id} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
                        <div className="h-[53px] w-10 shrink-0 overflow-hidden rounded border border-zinc-800 bg-zinc-900">
                          {b.cover ? (
                            <img src={coverUrl(b.cover)} alt={b.name} className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">无封面</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-zinc-200">{b.name}</span>
                            <Badge variant="outline" className={`shrink-0 text-[10px] ${meta.className}`}>
                              {meta.label}
                            </Badge>
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500">
                            {b.author} · {b._count?.chapters || 0} 章 · {fmtDateTime(b.updatedAt)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 分类分布 */}
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-zinc-200">分类分布</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {!stats?.categories?.length ? (
                <div className="py-8 text-center text-xs text-zinc-600">暂无分类</div>
              ) : (
                <div className="admin-scroll max-h-64 space-y-2 overflow-y-auto pr-1">
                  {stats.categories.map((c) => {
                    const count = c._count?.books || 0
                    return (
                      <div key={c.id} className="flex items-center gap-3">
                        <span className="w-20 shrink-0 truncate text-right text-xs text-zinc-400" title={c.name}>
                          {c.name}
                        </span>
                        <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                            style={{ width: `${Math.round((count / maxCat) * 100)}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right font-mono text-xs text-zinc-500">{count}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
