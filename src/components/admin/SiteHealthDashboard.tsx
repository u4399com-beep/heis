'use client'

// ============================================================
// SiteHealthDashboard — 站点健康检查 (agent-PP-ui5)
// 拉取 /api/admin/sites 列表, 客户端并行 HEAD 请求每个站点 domain,
// 展示 HTTP 状态 + 响应时延 + 可用性汇总; 不修改任何 API。
//
// 注意: 浏览器跨域 fetch 受 CORS 限制 —— 用 mode='no-cors' 探测可达性,
// 响应 type 为 'opaque' 时无法读 status, 但能区分"网络可达"与"DNS/连接失败"。
// 对同源站点(管理后台同域 + /api/admin/sites/[id]/route 探针)可读 status。
// 故采用: 优先尝试同源探测(/?site=xxx), 失败回退 no-cors 直连 domain。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Globe, HeartPulse, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api, fmtDateTime, useAliveRef, type SiteRow } from './helpers'

interface SiteProbe {
  siteId: string
  siteName: string
  domain: string
  /** 健康状态: ok 同源可读且 2xx; reachable opaque 模式可达但读不到状态; down 网络失败; checking 进行中 */
  status: 'checking' | 'ok' | 'reachable' | 'down' | 'timeout'
  /** HTTP 状态码 (仅同源可读, 否则 null) */
  httpStatus: number | null
  /** 响应时延 ms */
  latencyMs: number | null
  /** 错误信息 */
  error?: string
  /** 检测时间戳 */
  checkedAt: string | null
}

interface SiteHealthDashboardProps {
  /** 是否嵌入到 SitesSection 顶部 (而非作为弹窗) — 保留接口预留, 当前实现总以嵌入形式渲染 */
  embedded?: boolean
  /** 自动刷新间隔 ms, 默认 60s; 0 表示不自动 */
  autoRefreshMs?: number
}

const PROBE_TIMEOUT_MS = 8000

export function SiteHealthDashboard({ autoRefreshMs = 60_000 }: SiteHealthDashboardProps) {
  const [sites, setSites] = useState<SiteRow[]>([])
  const [probes, setProbes] = useState<Record<string, SiteProbe>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const aliveRef = useAliveRef()
  const seqRef = useRef(0)

  // 拉取站点列表
  const loadSites = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<SiteRow[]>('/api/admin/sites')
      const list = Array.isArray(data) ? data : []
      setSites(list)
      // 初始化所有站点为 checking
      setProbes(() => {
        const init: Record<string, SiteProbe> = {}
        for (const s of list) {
          init[s.id] = {
            siteId: s.id,
            siteName: s.name,
            domain: s.domain,
            status: 'checking',
            httpStatus: null,
            latencyMs: null,
            checkedAt: null,
          }
        }
        return init
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载站点失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 单个站点探测: 优先同源 /?site=xxx, 失败回退 no-cors 直连 domain
  const probeOne = useCallback(async (site: SiteRow): Promise<SiteProbe> => {
    const start = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const base: SiteProbe = {
      siteId: site.id,
      siteName: site.name,
      domain: site.domain,
      status: 'checking',
      httpStatus: null,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
    }
    // 1. 同源探测: 走 Next.js 路由 /?site=xxx (会经 PublicSite 渲染, 同源可读 status)
    const sameOriginUrl = `/?site=${encodeURIComponent(site.id)}`
    try {
      const res = await fetch(sameOriginUrl, {
        method: 'GET',
        signal: ctrl.signal,
        cache: 'no-store',
        redirect: 'follow',
      })
      const latency = Date.now() - start
      clearTimeout(timer)
      const status = res.status
      if (status >= 200 && status < 500) {
        return { ...base, status: 'ok', httpStatus: status, latencyMs: latency }
      }
      // 5xx → 服务异常
      return { ...base, status: 'ok', httpStatus: status, latencyMs: latency, error: `HTTP ${status}` }
    } catch {
      // 同源失败 → 退到 no-cors 直连 domain
    }
    clearTimeout(timer)
    // 2. no-cors 直连 domain (opaque 响应, 只能判可达性)
    if (!site.domain) {
      return { ...base, status: 'down', error: '未配置域名' }
    }
    const ctrl2 = new AbortController()
    const timer2 = setTimeout(() => ctrl2.abort(), PROBE_TIMEOUT_MS)
    const directUrl = site.domain.startsWith('http') ? site.domain : `https://${site.domain}`
    try {
      const start2 = Date.now()
      await fetch(directUrl, {
        method: 'GET',
        mode: 'no-cors',
        signal: ctrl2.signal,
        cache: 'no-store',
      })
      const latency = Date.now() - start2
      clearTimeout(timer2)
      // opaque 响应: 不可读 status, 但能到这里说明网络可达
      return { ...base, status: 'reachable', httpStatus: null, latencyMs: latency }
    } catch (e) {
      clearTimeout(timer2)
      if (e instanceof DOMException && e.name === 'AbortError') {
        return { ...base, status: 'timeout', error: `探测超时 (${PROBE_TIMEOUT_MS}ms)` }
      }
      return { ...base, status: 'down', error: e instanceof Error ? e.message : '网络不可达' }
    }
  }, [])

  // 批量探测所有站点
  const probeAll = useCallback(async (opts: { isFirst: boolean }) => {
    const seq = ++seqRef.current
    if (opts.isFirst) setRefreshing(true)
    try {
      // 并行探测, 最多 6 个并发
      const concurrency = 6
      const queue = [...sites]
      const results: SiteProbe[] = []
      const workers: Promise<void>[] = []
      for (let i = 0; i < concurrency; i++) {
        workers.push(
          (async () => {
            while (queue.length > 0) {
              const site = queue.shift()
              if (!site) return
              if (!aliveRef.current || seq !== seqRef.current) return
              setProbes((prev) => ({ ...prev, [site.id]: { ...prev[site.id], status: 'checking' } }))
              const result = await probeOne(site)
              if (!aliveRef.current || seq !== seqRef.current) return
              results.push(result)
              setProbes((prev) => ({ ...prev, [site.id]: result }))
            }
          })(),
        )
      }
      await Promise.all(workers)
    } finally {
      if (aliveRef.current && seq === seqRef.current) setRefreshing(false)
    }
  }, [sites, probeOne, aliveRef])

  // 首次加载 + 自动刷新
  useEffect(() => {
    loadSites()
  }, [loadSites])

  useEffect(() => {
    if (sites.length === 0) return
    void probeAll({ isFirst: true })
    if (autoRefreshMs <= 0) return
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void probeAll({ isFirst: false })
      }
    }, autoRefreshMs)
    return () => clearInterval(t)
  }, [sites.length, probeAll, autoRefreshMs])

  // 汇总统计
  const summary = (() => {
    const arr = Object.values(probes)
    const total = arr.length
    const ok = arr.filter((p) => p.status === 'ok' && p.httpStatus && p.httpStatus < 400).length
    const reachable = arr.filter((p) => p.status === 'reachable').length
    const down = arr.filter((p) => p.status === 'down' || p.status === 'timeout' || (p.httpStatus && p.httpStatus >= 500)).length
    const checking = arr.filter((p) => p.status === 'checking').length
    return { total, ok, reachable, down, checking }
  })()

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-zinc-950/60 text-emerald-400 ring-1 ring-zinc-800">
              <HeartPulse className="size-3.5" />
            </span>
            站点健康检查
            <span className="text-xs font-normal text-zinc-500">客户端并行探测 HTTP 状态 + 时延</span>
          </div>
          <div className="flex items-center gap-2">
            {/* 汇总徽章 */}
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-400">
              <ShieldCheck className="mr-1 size-2.5" />
              健康 {summary.ok}
            </Badge>
            <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-[10px] text-sky-400">
              可达 {summary.reachable}
            </Badge>
            {summary.down > 0 && (
              <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-[10px] text-red-400">
                <TriangleAlert className="mr-1 size-2.5" />
                异常 {summary.down}
              </Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-zinc-700 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={() => probeAll({ isFirst: true })}
              disabled={refreshing || loading}
              aria-label="刷新站点健康状态"
            >
              {refreshing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              刷新
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex h-32 items-center justify-center text-xs text-zinc-500">
            <Loader2 className="mr-2 size-4 animate-spin" />
            正在加载站点列表…
          </div>
        ) : sites.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
            <Globe className="mr-2 size-4" />
            暂无站点, 请先在站群系统添加
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((s) => {
              const p = probes[s.id] || {
                siteId: s.id,
                siteName: s.name,
                domain: s.domain,
                status: 'checking' as const,
                httpStatus: null,
                latencyMs: null,
                checkedAt: null,
              }
              return <ProbeCard key={s.id} probe={p} />
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function probeTone(p: SiteProbe): { dot: string; chip: string; label: string } {
  if (p.status === 'checking') return { dot: 'bg-zinc-400', chip: 'border-zinc-700 bg-zinc-900 text-zinc-400', label: '检测中…' }
  if (p.status === 'ok' && p.httpStatus && p.httpStatus < 400) {
    return { dot: 'bg-emerald-400', chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400', label: `HTTP ${p.httpStatus}` }
  }
  if (p.status === 'ok' && p.httpStatus && p.httpStatus >= 500) {
    return { dot: 'bg-red-400', chip: 'border-red-500/40 bg-red-500/10 text-red-400', label: `HTTP ${p.httpStatus}` }
  }
  if (p.status === 'reachable') return { dot: 'bg-sky-400', chip: 'border-sky-500/40 bg-sky-500/10 text-sky-400', label: '可达 (opaque)' }
  if (p.status === 'timeout') return { dot: 'bg-amber-400', chip: 'border-amber-500/40 bg-amber-500/10 text-amber-400', label: '超时' }
  return { dot: 'bg-red-400', chip: 'border-red-500/40 bg-red-500/10 text-red-400', label: '异常' }
}

function latencyTone(ms: number | null): string {
  if (ms === null) return 'text-zinc-600'
  if (ms < 500) return 'text-emerald-400'
  if (ms < 1500) return 'text-amber-400'
  return 'text-red-400'
}

function ProbeCard({ probe }: { probe: SiteProbe }) {
  const tone = probeTone(probe)
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`size-1.5 shrink-0 rounded-full ${tone.dot} ${probe.status === 'checking' ? 'animate-pulse' : ''}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-zinc-200" title={probe.siteName}>{probe.siteName}</p>
          <p className="truncate font-mono text-[10px] text-zinc-500" title={probe.domain}>{probe.domain || '(无域名)'}</p>
        </div>
        <Badge variant="outline" className={`shrink-0 text-[10px] ${tone.chip}`}>
          {tone.label}
        </Badge>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500">
        <span className={`font-mono tabular-nums ${latencyTone(probe.latencyMs)}`}>
          {probe.latencyMs !== null ? `${probe.latencyMs} ms` : '— ms'}
        </span>
        {probe.checkedAt && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-zinc-600">{fmtDateTime(probe.checkedAt).split(' ')[1] || '-'}</span>
            </TooltipTrigger>
            <TooltipContent className="text-xs">检测于 {fmtDateTime(probe.checkedAt)}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {probe.error && (
        <p className="mt-1 truncate text-[10px] text-red-400/80" title={probe.error}>
          {probe.error}
        </p>
      )}
    </div>
  )
}
