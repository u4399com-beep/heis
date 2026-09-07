'use client'

// ============================================================
// 系统健康监控卡片 (feat-b)
// 数据源: GET /api/admin/health
// 展示: 状态徽章 + 运行时长 + 堆内存进度 + 6 个 mini-service 状态点 + DB 状态
// 行为: 自动每 30s 刷新 + 手动刷新; 401 (session 失效) → "重新登录" 提示
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { AlertTriangle, Database, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  fmtMB,
  fmtUptime,
  type HealthData,
  type HealthStatus,
} from './helpers'

interface HealthCardProps {
  /** 会话失效时回调, 用于触发父级登录页 (可选) */
  onSessionExpired?: () => void
}

const REFRESH_MS = 30_000

// mini-service 显示名 (与 /api/admin/health 端口表对齐)
const SERVICE_META: Record<string, { label: string; optional?: boolean }> = {
  bqg713: { label: 'bqg713 代理' },
  'fetch-relay': { label: 'fetch-relay 中继' },
  scrapling: { label: 'scrapling 桥 (可选)', optional: true },
  qimao: { label: '七猫代理' },
  deqixs: { label: 'deqixs 代理' },
  xjp: { label: 'xjp 代理' },
}
// 渲染顺序 (固定, 与端口表一致)
const SERVICE_ORDER = ['bqg713', 'fetch-relay', 'scrapling', 'qimao', 'deqixs', 'xjp'] as const

const STATUS_META: Record<HealthStatus, { label: string; dot: string; chip: string }> = {
  healthy: {
    label: '系统正常',
    dot: 'bg-emerald-400',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  },
  degraded: {
    label: '部分降级',
    dot: 'bg-amber-400',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  },
  unhealthy: {
    label: '系统异常',
    dot: 'bg-red-400',
    chip: 'bg-red-500/15 text-red-300 border-red-500/40',
  },
}

interface HealthResult {
  status: number
  data: HealthData | null
  ok: boolean
}

async function fetchHealth(): Promise<HealthResult> {
  const res = await fetch('/api/admin/health', {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  })
  if (res.status === 401) return { status: 401, data: null, ok: false }
  let json: { ok?: boolean; data?: HealthData } | null = null
  try {
    json = (await res.json()) as { ok?: boolean; data?: HealthData }
  } catch {
    return { status: res.status, data: null, ok: false }
  }
  if (!json?.ok || !json.data) return { status: res.status, data: null, ok: false }
  return { status: res.status, data: json.data, ok: true }
}

export function HealthCard({ onSessionExpired }: HealthCardProps) {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [unauthorized, setUnauthorized] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  // 把回调存入 ref, 让 load 闭包稳定 (避免父组件传入内联箭头导致每次渲染新建 load)
  const cbRef = useRef(onSessionExpired)
  useEffect(() => {
    cbRef.current = onSessionExpired
  }, [onSessionExpired])

  const load = useCallback(async (opts: { isFirst: boolean }) => {
    if (opts.isFirst) setLoading(true)
    else setRefreshing(true)
    try {
      const r = await fetchHealth()
      if (r.status === 401) {
        setUnauthorized(true)
        cbRef.current?.()
      } else if (r.ok && r.data) {
        setHealth(r.data)
        setUnauthorized(false)
        setLastUpdated(Date.now())
      }
    } catch {
      // 静默失败, 保留上次数据
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // 首次挂载拉取 + 30s 自动刷新 (load 稳定, 不会反复重建 effect)
  useEffect(() => {
    load({ isFirst: true })
    const t = setInterval(() => load({ isFirst: false }), REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  // ---- 渲染辅助 ----
  const meta = STATUS_META[health?.status || 'healthy']
  const heapPct = health
    ? Math.min(100, Math.round((health.memory.heapUsed / Math.max(1, health.memory.heapTotal)) * 100))
    : 0
  const updatedStr = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--'

  return (
    <Card className="border-zinc-800 bg-zinc-900/60 py-0">
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:gap-6">
        {/* 状态徽章 */}
        <div className="flex items-center gap-3 lg:min-w-[180px]">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${meta.dot}`}
              aria-hidden
            />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${meta.dot}`} aria-hidden />
          </span>
          <div className="min-w-0">
            <div
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.chip}`}
            >
              <ShieldCheck className="h-3 w-3" />
              {meta.label}
            </div>
            <div className="mt-1 truncate text-[11px] text-zinc-500" title={`最近刷新 ${updatedStr}`}>
              {loading ? '加载中…' : unauthorized ? '会话已失效' : `最近刷新 ${updatedStr}`}
            </div>
          </div>
        </div>

        {/* 运行时长 */}
        <div className="min-w-0 lg:w-auto">
          <div className="text-[11px] text-zinc-500">运行时长</div>
          {loading ? (
            <Skeleton className="mt-1 h-5 w-32" />
          ) : (
            <div className="mt-0.5 text-sm font-medium tabular-nums text-zinc-200" title={fmtUptime(health?.uptime)}>
              {fmtUptime(health?.uptime)}
            </div>
          )}
        </div>

        {/* 堆内存 */}
        <div className="min-w-0 flex-1 lg:max-w-[260px]">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span>堆内存</span>
            <span className="tabular-nums text-zinc-400">
              {loading ? '— / —' : `${fmtMB(health?.memory.heapUsed)} / ${fmtMB(health?.memory.heapTotal)}`}
            </span>
          </div>
          {loading ? (
            <Skeleton className="mt-1 h-2 w-full" />
          ) : (
            <Progress value={heapPct} className="mt-1.5 h-1.5 bg-zinc-800" />
          )}
        </div>

        {/* mini-services 6 点 */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">服务</span>
          <div className="flex items-center gap-1.5">
            {SERVICE_ORDER.map((key) => {
              const svc = health?.services?.[key]
              const sm = SERVICE_META[key]
              const reachable = !!svc?.reachable
              const optional = !!sm?.optional
              // 颜色: reachable=green, optional-unreachable=gray, required-unreachable=red
              const color = reachable
                ? 'bg-emerald-400'
                : optional
                  ? 'bg-zinc-600'
                  : 'bg-red-400'
              const tip = `${sm?.label || key}: ${reachable ? '可达' : optional ? '未启用 (可选)' : '不可达'}${svc?.selfTestOk === false ? ' (自检失败)' : ''}`
              return (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <span
                      role="img"
                      aria-label={tip}
                      title={tip}
                      className={`inline-block h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-white/10 ${color} ${loading ? 'opacity-40' : ''}`}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{tip}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>

        {/* DB 状态 */}
        <div className="flex items-center gap-2 lg:ml-auto">
          {loading ? (
            <Skeleton className="h-6 w-20" />
          ) : (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${
                health?.db === 'ok'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/40 bg-red-500/10 text-red-300'
              }`}
            >
              <Database className="h-3 w-3" />
              {health?.db === 'ok' ? 'DB 正常' : 'DB 异常'}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            onClick={() => load({ isFirst: false })}
            disabled={loading || refreshing}
            aria-label="刷新健康状态"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            刷新
          </Button>
        </div>

        {/* 401 提示 */}
        {unauthorized && (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            会话已失效, 请重新登录
          </div>
        )}
      </CardContent>
    </Card>
  )
}
