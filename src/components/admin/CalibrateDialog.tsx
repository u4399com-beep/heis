'use client'

// ============================================================
// CalibrateDialog — 采集规则「极限校准」(zz-c)
// 逐规则探测不被源站封禁的最大并发 / 最小间隔, 实时展示探测轨迹,
// 推荐参数(同站并发上限 hostGateLimit 等)可一键写回规则。
//
// 视图状态机:
//   boot        打开对话框先 GET 一次恢复历史(done 直接展示上次结果)
//   config      配置段: 档位 Select + 高级(源站地址), 「开始校准」
//   running     1.5s 轮询 GET 展示实时 trace; 关闭对话框不中断后台校准
//   done        结果段: 结论卡 + 应用推荐 + 可折叠 trace 全表
//   error       上次校准失败 → 错误信息 + 重新校准
//   unavailable 校准 API 未就绪/网络异常 → 优雅降级提示, 不白屏
//
// API 契约(zz-a 同步实现, 未就绪时全部容错降级):
//   POST   /api/admin/rules/{id}/calibrate        202 开始 | 409 进行中 | 404 规则不存在
//   GET    /api/admin/rules/{id}/calibrate        状态 + 轨迹 + 结果
//   DELETE /api/admin/rules/{id}/calibrate        取消
//   POST   /api/admin/rules/{id}/calibrate/apply  写回 hostGateLimit(ab-c 已实装,
//          契约体 { recommended: { hostGateLimit } }); 失败时降级为 读规则 config →
//          改写 fetch.hostGateLimit → PUT 回写
//          (PUT 支持部分更新; 仍失败则展示可复制 JSON 引导手动填入)
//   POST   /api/admin/rules/calibrate-all         全量校准(工具栏入口, 轮询同名 GET 展示进度)
//
// 容错要点: 响应兼容项目 { ok, data } 信封与契约裸对象两种形态;
// 裸 404(HTML/空体, Next 路由不存在)判为「服务暂不可用」, JSON 404 判为「规则不存在」。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Activity,
  Ban,
  CheckCircle2,
  ChevronDown,
  Copy,
  Gauge,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api, fmtDateTime, safeJsonParse, type RuleRow } from './helpers'

// ============================================================
// 类型(按 zz-a 契约定义于 UI 侧, 不动全局 types.ts)
// ============================================================
type CalibrateProfile = 'lenient' | 'standard' | 'strict'

interface CalibrateTraceRow {
  /** 运行时容错为 string, 展示层做中文映射 + 兜底原文 */
  stage: string
  param: number
  requests: number
  hit429: number
  hit403: number
  other: number
  pass: boolean
  note?: string
}

interface CalibrateResult {
  ok: boolean
  maxConcurrency: number
  minIntervalMs: number
  safeThresholdNote: string
  recommended: {
    hostGateLimit: number
    threadMin: number
    threadMax: number
    intervalMin: number
    intervalMax: number
  }
  trace: CalibrateTraceRow[]
  message: string
  durationMs: number
  finishedAt: string
}

interface CalibrateState {
  status: 'idle' | 'running' | 'done' | 'error'
  result?: CalibrateResult
  startedAt?: string
  elapsedMs?: number
  /** 契约外容错字段: error/message/顶层 trace */
  error?: string
  message?: string
  trace?: CalibrateTraceRow[]
}

// ============================================================
// 常量
// ============================================================
const POLL_MS = 1500
const DEFAULT_SITE_BASE = 'http://127.0.0.1:3040'

const PROFILE_META: { value: CalibrateProfile; label: string; desc: string }[] = [
  { value: 'lenient', label: '宽松 (lenient)', desc: '模拟源站封禁宽松的场景, 大步进探测, 快速摸到上限' },
  { value: 'standard', label: '标准 (standard)', desc: '模拟源站封禁中等严格度, 步进均衡, 通用推荐' },
  { value: 'strict', label: '严格 (strict)', desc: '模拟源站封禁严格的站点, 小步进保守探测, 结果更稳妥' },
]

const STAGE_LABEL: Record<string, string> = {
  concurrency: '并发探测',
  rate: '速率探测',
  verify: '整链验证',
}

// ============================================================
// 容错请求 / 解析工具
// ============================================================
function isPlainObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

interface RawResp {
  status: number
  json: unknown
  /** 响应体是否为合法 JSON(裸 404/HTML 错误页为 false → 视为路由未实现) */
  jsonOk: boolean
}

async function rawFetch(url: string, init?: RequestInit): Promise<RawResp> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { status: res.status, json, jsonOk: json !== null }
  } catch {
    return { status: 0, json: null, jsonOk: false }
  }
}

const httpOk = (r: RawResp) => r.status >= 200 && r.status < 300

/** 兼容项目 { ok, data } 信封与契约裸对象两种响应形态 */
function unwrap(json: unknown): Record<string, unknown> | null {
  if (!isPlainObj(json)) return null
  if (typeof json.ok === 'boolean' && 'data' in json) {
    return isPlainObj(json.data) ? json.data : null
  }
  return json
}

/** 从未知 JSON 中提取校准状态(字段缺失/类型不齐逐项兜底; status 非法返回 null) */
function pickState(json: unknown): CalibrateState | null {
  const raw = unwrap(json)
  if (!raw) return null
  const status = raw.status
  if (status !== 'idle' && status !== 'running' && status !== 'done' && status !== 'error') return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return {
    status,
    result: isPlainObj(raw.result) ? (raw.result as unknown as CalibrateResult) : undefined,
    startedAt: str(raw.startedAt),
    elapsedMs: num(raw.elapsedMs),
    error: str(raw.error),
    message: str(raw.message),
    trace: Array.isArray(raw.trace) ? (raw.trace as unknown as CalibrateTraceRow[]) : undefined,
  }
}

/** 裸 404(Next 路由不存在)= 服务暂不可用; JSON 404(契约)= 规则不存在 */
function classifyError(res: RawResp): 'ruleMissing' | 'unavailable' {
  if (res.status === 404) return res.jsonOk ? 'ruleMissing' : 'unavailable'
  return 'unavailable'
}

function errMessage(res: RawResp, fallback: string): string {
  if (!isPlainObj(res.json)) return fallback
  const msg = res.json.message
  const err = res.json.error
  if (typeof msg === 'string' && msg) return msg
  if (typeof err === 'string' && err) return err
  return fallback
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  if (m <= 0) return `${s} 秒`
  return `${m} 分 ${String(s % 60).padStart(2, '0')} 秒`
}

function fmtParam(row: { stage: string; param: number }): string {
  if (row.stage === 'concurrency') return `${row.param} 并发`
  if (row.stage === 'rate') return `${row.param} ms`
  return row.param > 0 ? String(row.param) : '—'
}

// ============================================================
// 小型展示组件
// ============================================================
function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="truncate text-sm font-semibold text-zinc-100" title={value}>
        {value}
        {suffix && <span className="ml-1 text-xs font-normal text-zinc-500">{suffix}</span>}
      </p>
    </div>
  )
}

/** 探测轨迹表 — running 实时 / done 全表共用 */
function TraceTable({ rows }: { rows: CalibrateTraceRow[] }) {
  const noted = rows.filter((r) => typeof r.note === 'string' && r.note)
  return (
    <div className="space-y-2">
      <ScrollArea className="max-h-56 rounded-md border border-zinc-800 bg-zinc-950/60">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-xs text-zinc-500">阶段</TableHead>
              <TableHead className="text-right text-xs text-zinc-500">参数</TableHead>
              <TableHead className="text-right text-xs text-zinc-500">请求</TableHead>
              <TableHead className="text-right text-xs text-zinc-500">429</TableHead>
              <TableHead className="hidden text-right text-xs text-zinc-500 sm:table-cell">403</TableHead>
              <TableHead className="hidden text-right text-xs text-zinc-500 sm:table-cell">其他</TableHead>
              <TableHead className="text-center text-xs text-zinc-500">结果</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={`${row.stage}-${row.param}-${i}`} className="border-zinc-800/70">
                <TableCell className="text-xs text-zinc-300">{STAGE_LABEL[row.stage] ?? row.stage}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono text-xs text-zinc-200">
                  {fmtParam(row)}
                </TableCell>
                <TableCell className="text-right text-xs text-zinc-400">{row.requests}</TableCell>
                <TableCell
                  className={cn('text-right text-xs', row.hit429 > 0 ? 'text-amber-400' : 'text-zinc-500')}
                >
                  {row.hit429}
                </TableCell>
                <TableCell
                  className={cn(
                    'hidden text-right text-xs sm:table-cell',
                    row.hit403 > 0 ? 'text-red-400' : 'text-zinc-500',
                  )}
                >
                  {row.hit403}
                </TableCell>
                <TableCell className="hidden text-right text-xs text-zinc-500 sm:table-cell">{row.other}</TableCell>
                <TableCell className="text-center">
                  {row.pass ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 bg-emerald-500/10 px-1.5 text-xs text-emerald-400"
                    >
                      通过
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-red-500/40 bg-red-500/10 px-1.5 text-xs text-red-400"
                    >
                      未过
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
      {noted.length > 0 && (
        <div className="space-y-1 rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
          {noted.map((r, i) => (
            <p key={i} className="text-xs leading-relaxed text-zinc-500">
              · {STAGE_LABEL[r.stage] ?? r.stage} {fmtParam(r)}: {r.note}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// 单规则校准对话框
// ============================================================
interface CalibrateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: RuleRow | null
}

type View = 'boot' | 'config' | 'running' | 'done' | 'error' | 'unavailable'

export function CalibrateDialog({ open, onOpenChange, rule }: CalibrateDialogProps) {
  const [view, setView] = useState<View>('boot')
  const [profile, setProfile] = useState<CalibrateProfile>('standard')
  const [siteBase, setSiteBase] = useState(DEFAULT_SITE_BASE)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [state, setState] = useState<CalibrateState | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [traceOpen, setTraceOpen] = useState(true)
  const [fallbackJson, setFallbackJson] = useState<string | null>(null)
  const [pollFailed, setPollFailed] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [bootSeq, setBootSeq] = useState(0)

  const localStartRef = useRef(0)
  const pollInFlightRef = useRef(false)

  const ruleId = rule?.id ?? ''

  // ---- 打开时恢复历史状态(boot) ----
  useEffect(() => {
    if (!open || !ruleId) return
    let alive = true
    setView('boot')
    setErrorMsg('')
    setApplied(false)
    setFallbackJson(null)
    setPollFailed(false)
    ;(async () => {
      const res = await rawFetch(`/api/admin/rules/${ruleId}/calibrate`)
      if (!alive) return
      if (httpOk(res)) {
        const st = pickState(res.json)
        // 2xx 但无有效 status(如信封 data 为空的 idle 形态) → 视为空闲
        if (!st) {
          setState(null)
          setView('config')
          return
        }
        setState(st)
        if (st.status === 'running') setView('running')
        else if (st.status === 'done' && st.result) setView('done')
        else if (st.status === 'error') {
          setErrorMsg(st.error || st.message || '上次校准失败')
          setView('error')
        } else if (st.status === 'idle') {
          // ab-c: 无活动 job 时路由在 idle 附 last={result,profile,finishedAt}(最近一次持久化结果,
          // 见 calibrate/route.ts GET)—— 旧实现从未读取 last, 「打开恢复上次结果」永不生效,
          // 重开对话框恒落配置视图。此处回显历史结果(形状防御: 非纯对象忽略)
          const raw = unwrap(res.json)
          const last = raw && isPlainObj(raw.last) ? raw.last : null
          const lastResult = last && isPlainObj(last.result) ? (last.result as unknown as CalibrateResult) : null
          if (lastResult) {
            setState({ ...st, result: lastResult })
            setView('done')
          } else setView('config')
        } else setView('config')
      } else if (classifyError(res) === 'ruleMissing') {
        setErrorMsg('规则不存在, 可能已被删除, 请刷新列表后重试')
        setView('error')
      } else {
        setView('unavailable')
      }
    })()
    return () => {
      alive = false
    }
  }, [open, ruleId, bootSeq])

  // ---- running 轮询(1.5s): 对话框关闭即停, 后台校准不受影响 ----
  const pollRunning = useCallback(async () => {
    if (!ruleId || pollInFlightRef.current) return
    pollInFlightRef.current = true
    try {
      const res = await rawFetch(`/api/admin/rules/${ruleId}/calibrate`)
      if (!httpOk(res)) {
        // 单次瞬时失败不中断轮询, 仅提示并等下一跳自愈
        setPollFailed(true)
        return
      }
      const st = pickState(res.json)
      if (!st) return
      setPollFailed(false)
      setState(st)
      if (st.status === 'done') {
        if (st.result) setView('done')
        else {
          setErrorMsg(st.error || st.message || '校准已结束但未返回结果')
          setView('error')
        }
      } else if (st.status === 'error') {
        setErrorMsg(st.error || st.message || '校准失败, 请稍后重试')
        setView('error')
      } else if (st.status === 'idle') {
        // 后台已被取消/清理 → 回到配置视图
        setView('config')
      }
    } finally {
      pollInFlightRef.current = false
    }
  }, [ruleId])

  useEffect(() => {
    if (!open || view !== 'running' || !ruleId) return
    void pollRunning() // 进入 running 视图立即拉一次
    const timer = window.setInterval(pollRunning, POLL_MS)
    return () => window.clearInterval(timer)
  }, [open, view, ruleId, pollRunning])

  // ---- running 时已耗时秒级跳动 ----
  useEffect(() => {
    if (!open || view !== 'running') return
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open, view])

  const handleOpenChange = (v: boolean) => {
    if (!v && open && view === 'running') {
      toast.info('校准在后台继续进行, 可稍后回来查看结果')
    }
    onOpenChange(v)
  }

  // ---- 开始校准 ----
  const startCalibrate = async () => {
    if (!ruleId || starting) return
    setStarting(true)
    setErrorMsg('')
    try {
      const res = await rawFetch(`/api/admin/rules/${ruleId}/calibrate`, {
        method: 'POST',
        body: JSON.stringify({ profile, siteBase: siteBase.trim() || undefined }),
      })
      if (httpOk(res)) {
        localStartRef.current = Date.now()
        setState((prev) => ({ ...(prev ?? {}), status: 'running', result: undefined }))
        setApplied(false)
        setFallbackJson(null)
        setView('running')
        toast.success('校准已开始, 正在逐级探测安全阈值')
      } else if (res.status === 409) {
        // 已有校准进行中 → 切到进行中视图接续轮询
        toast.info('该规则已有校准进行中, 已切换到实时视图')
        setView('running')
      } else if (classifyError(res) === 'ruleMissing') {
        toast.error('规则不存在, 请刷新列表后重试')
      } else {
        setView('unavailable')
      }
    } finally {
      setStarting(false)
    }
  }

  // ---- 取消校准 ----
  const cancelCalibrate = async () => {
    if (!ruleId || cancelling) return
    setCancelling(true)
    try {
      const res = await rawFetch(`/api/admin/rules/${ruleId}/calibrate`, { method: 'DELETE' })
      if (httpOk(res)) {
        toast.success('已发送取消请求, 校准将尽快停止')
        void pollRunning()
      } else {
        toast.error(errMessage(res, '取消失败, 校准仍在后台进行'))
      }
    } finally {
      setCancelling(false)
    }
  }

  // ---- 应用推荐并发上限到规则 ----
  const applyRecommended = async () => {
    const rec = state?.result?.recommended
    if (!ruleId || !rec || applying) return
    const hostGateLimit = Math.max(1, Math.round(Number(rec.hostGateLimit) || 1))
    setApplying(true)
    try {
      // ① 契约路径: 专用 apply 接口
      const res = await rawFetch(`/api/admin/rules/${ruleId}/calibrate/apply`, {
        method: 'POST',
        // ab-c: 契约形态 { recommended: { hostGateLimit } }(apply 路由已实装;
        // 服务端另有平铺 hostGateLimit 兼容与 Setting calibration:<id> 回落, 三级降级结构不变)
        body: JSON.stringify({ recommended: { hostGateLimit } }),
      })
      if (httpOk(res)) {
        setApplied(true)
        toast.success('已写入规则')
        return
      }
      // ② 降级: apply 路由未实现(404/405)或异常 → 读规则 config JSON,
      //    改写 config.fetch.hostGateLimit 后经 PUT 部分更新回写
      try {
        const detail = await api.get<{ config: string }>(`/api/admin/rules/${ruleId}`)
        const rawCfg = safeJsonParse<Record<string, unknown>>(detail?.config ?? '', {})
        const fetchCfg: Record<string, unknown> = isPlainObj(rawCfg.fetch) ? { ...rawCfg.fetch } : {}
        fetchCfg.hostGateLimit = hostGateLimit
        await api.put(`/api/admin/rules/${ruleId}`, { config: { ...rawCfg, fetch: fetchCfg } })
        setApplied(true)
        toast.success('已写入规则(经规则配置回写)')
      } catch {
        // ③ 终极兜底: 展示可复制 JSON, 引导手动填入规则
        setFallbackJson(JSON.stringify({ fetch: { hostGateLimit } }, null, 2))
        toast.error('自动写入失败, 推荐值请手动填入规则(已生成可复制配置)')
      }
    } finally {
      setApplying(false)
    }
  }

  const copyFallbackJson = async () => {
    if (!fallbackJson) return
    try {
      await navigator.clipboard.writeText(fallbackJson)
      toast.success('已复制推荐配置')
    } catch {
      toast.error('复制失败, 请手动选择文本复制')
    }
  }

  // ---- 派生数据 ----
  const result = state?.result
  const traceRows = state?.result?.trace ?? state?.trace ?? []
  const lastStage = traceRows.length > 0 ? traceRows[traceRows.length - 1]?.stage : undefined
  const startedTs = state?.startedAt
    ? new Date(state.startedAt).getTime()
    : localStartRef.current
  const elapsedMs = state?.elapsedMs ?? (startedTs > 0 ? Math.max(0, nowTick - startedTs) : 0)
  const profileDesc = PROFILE_META.find((p) => p.value === profile)?.desc ?? ''

  if (!rule) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] border-zinc-800 bg-zinc-900 sm:max-w-xl lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-zinc-100">
            <Gauge className="h-5 w-5 shrink-0 text-violet-400" />
            <span className="truncate">极限校准 — {rule.name}</span>
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            自动探测该规则不被源站封禁的最大并发与最小间隔, 并生成推荐采集参数
          </DialogDescription>
        </DialogHeader>

        <div className="admin-scroll max-h-[70vh] overflow-y-auto pr-1">
          {/* ---- boot: 恢复历史状态 ---- */}
          {view === 'boot' && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在获取校准状态…
            </div>
          )}

          {/* ---- config: 配置段 ---- */}
          {view === 'config' && (
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">校准档位</Label>
                <Select value={profile} onValueChange={(v) => setProfile(v as CalibrateProfile)}>
                  <SelectTrigger className="w-full border-zinc-700 bg-zinc-950 text-sm text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-900">
                    {PROFILE_META.map((p) => (
                      <SelectItem key={p.value} value={p.value} className="text-sm text-zinc-200">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-zinc-500">{profileDesc}</p>
              </div>

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                  >
                    <ChevronDown
                      className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')}
                    />
                    高级选项
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-400">源站地址</Label>
                    <Input
                      className="h-9 border-zinc-700 bg-zinc-950 text-sm text-zinc-200"
                      value={siteBase}
                      onChange={(e) => setSiteBase(e.target.value)}
                      placeholder={DEFAULT_SITE_BASE}
                    />
                    <p className="text-xs text-zinc-500">
                      校准探测将以此地址模拟真实采集请求, 默认为本机探测服务
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Button className="w-full gap-1.5" onClick={startCalibrate} disabled={starting}>
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
                开始校准
              </Button>
              <p className="text-center text-xs text-zinc-600">
                校准期间会向源站发送探测请求, 请耐心等待完成
              </p>
            </div>
          )}

          {/* ---- running: 进行中段 ---- */}
          {view === 'running' && (
            <div className="space-y-3 py-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    校准进行中
                  </Badge>
                  <span className="text-xs text-zinc-500">已耗时 {fmtDuration(elapsedMs)}</span>
                  {lastStage && (
                    <span className="text-xs text-zinc-500">
                      当前阶段: {STAGE_LABEL[lastStage] ?? lastStage}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  onClick={cancelCalibrate}
                  disabled={cancelling}
                >
                  {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                  取消校准
                </Button>
              </div>

              {pollFailed && (
                <p className="flex items-center gap-1.5 text-xs text-amber-400">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  状态获取暂时失败, 正在自动重试…
                </p>
              )}

              {traceRows.length > 0 ? (
                <TraceTable rows={traceRows} />
              ) : (
                <div className="flex items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 py-10 text-xs text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在准备探测环境, 轨迹数据稍后呈现…
                </div>
              )}

              <p className="text-xs text-zinc-600">关闭对话框不会中断校准, 后台完成后可随时回来查看结果</p>
            </div>
          )}

          {/* ---- done: 结果段 ---- */}
          {view === 'done' && result && (
            <div className="space-y-4 py-1">
              <div className="flex flex-wrap items-center gap-3">
                {result.ok ? (
                  <Badge className="gap-1.5 border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    校准通过
                  </Badge>
                ) : (
                  <Badge className="gap-1.5 border-red-500/40 bg-red-500/15 px-3 py-1 text-sm text-red-400">
                    <XCircle className="h-4 w-4" />
                    未找到安全阈值
                  </Badge>
                )}
                <span className="text-xs text-zinc-500">
                  耗时 {fmtDuration(Number(result.durationMs) || 0)}
                  {result.finishedAt ? ` · 完成于 ${fmtDateTime(result.finishedAt)}` : ''}
                </span>
              </div>

              {/* 核心结论卡 */}
              <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  <Stat label="极限并发" value={String(result.maxConcurrency)} suffix="并发" />
                  <Stat label="极限间隔" value={String(result.minIntervalMs)} suffix="ms" />
                  <Stat
                    label="推荐线程"
                    value={`${result.recommended.threadMin} ~ ${result.recommended.threadMax}`}
                    suffix="线程"
                  />
                  <Stat
                    label="推荐间隔"
                    value={`${result.recommended.intervalMin} ~ ${result.recommended.intervalMax}`}
                    suffix="ms"
                  />
                  <Stat
                    label="同站并发上限"
                    value={String(result.recommended.hostGateLimit)}
                    suffix="hostGateLimit"
                  />
                </div>
              </div>

              {result.safeThresholdNote && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-300">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{result.safeThresholdNote}</span>
                </div>
              )}

              {result.message && <p className="text-sm leading-relaxed text-zinc-300">{result.message}</p>}

              {fallbackJson && (
                <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-zinc-400">推荐配置 JSON(手动填入规则 fetch 段)</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                      onClick={copyFallbackJson}
                    >
                      <Copy className="h-3 w-3" />
                      复制
                    </Button>
                  </div>
                  <pre className="admin-scroll max-h-32 overflow-auto rounded bg-zinc-950 p-2 font-mono text-xs text-emerald-300">
                    {fallbackJson}
                  </pre>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={applyRecommended} disabled={applying || applied} className="gap-1.5">
                  {applying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : applied ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Gauge className="h-4 w-4" />
                  )}
                  {applied ? '已写入规则' : '应用推荐并发上限到规则'}
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => setView('config')}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重新校准
                </Button>
              </div>

              {/* trace 全表折叠可展开 */}
              <Collapsible open={traceOpen} onOpenChange={setTraceOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                  >
                    <ChevronDown
                      className={cn('h-3.5 w-3.5 transition-transform', traceOpen && 'rotate-180')}
                    />
                    探测轨迹 ({traceRows.length} 条)
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <TraceTable rows={traceRows} />
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {/* ---- error: 上次校准失败 ---- */}
          {view === 'error' && (
            <div className="space-y-4 py-1">
              <Badge className="gap-1.5 border-red-500/40 bg-red-500/15 px-3 py-1 text-sm text-red-400">
                <XCircle className="h-4 w-4" />
                校准失败
              </Badge>
              <p className="text-sm leading-relaxed text-zinc-300">{errorMsg || '校准过程中出现错误'}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => setView('config')}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重新校准
                </Button>
              </div>
            </div>
          )}

          {/* ---- unavailable: 校准服务暂不可用 ---- */}
          {view === 'unavailable' && (
            <div className="space-y-4 py-1">
              <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-300">校准服务暂不可用</p>
                  <p className="text-xs leading-relaxed text-amber-300/80">
                    校准接口尚未就绪或网络异常, 请稍后重试; 规则数据不受影响。
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                onClick={() => setBootSeq((s) => s + 1)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// 全量校准对话框(加分项) — 逐条校准全部规则, 进度 x/y + 结果摘要
// ============================================================
interface AllResultRow {
  ruleId?: string
  ruleName?: string
  name?: string
  ok?: boolean
  maxConcurrency?: number
  minIntervalMs?: number
  message?: string
  error?: string
}

interface CalibrateAllDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AllView = 'config' | 'running' | 'done' | 'error'

export function CalibrateAllDialog({ open, onOpenChange }: CalibrateAllDialogProps) {
  const [view, setView] = useState<AllView>('config')
  const [profile, setProfile] = useState<CalibrateProfile>('standard')
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 })
  const [results, setResults] = useState<AllResultRow[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [starting, setStarting] = useState(false)
  const pollInFlightRef = useRef(false)

  const pollAll = useCallback(async () => {
    if (pollInFlightRef.current) return
    pollInFlightRef.current = true
    try {
      const res = await rawFetch('/api/admin/rules/calibrate-all')
      if (!httpOk(res)) return
      const raw = unwrap(res.json)
      if (!raw) return
      const status = typeof raw.status === 'string' ? raw.status : ''
      const total = typeof raw.total === 'number' ? raw.total : 0
      const current = typeof raw.currentIndex === 'number' ? raw.currentIndex : 0
      setProgress({ current, total })
      if (status === 'done') {
        // ab-c: 路由 done 态 results 为 Record<ruleId, CalibrationResult>(对象映射, 见
        // calibrate-all/route.ts GET)而非数组 —— 旧实现 Array.isArray 判定恒 false,
        // 摘要列表永远为空(恒显「未返回结果摘要」)。两种形态都兼容
        const rv: unknown = raw.results
        let rows: AllResultRow[] = []
        if (Array.isArray(rv)) rows = rv as unknown as AllResultRow[]
        else if (isPlainObj(rv)) {
          rows = Object.entries(rv).map(([ruleId, r]) => ({
            ruleId,
            ...(isPlainObj(r) ? (r as Partial<AllResultRow>) : {}),
          }))
        }
        setResults(rows)
        setView('done')
      } else if (status === 'error') {
        setErrorMsg(typeof raw.error === 'string' && raw.error ? raw.error : '全量校准失败')
        setView('error')
      } else if (status === 'running' || status === 'pending') {
        setView('running')
      }
      // idle → 保持当前视图(未开始/已复位)
    } finally {
      pollInFlightRef.current = false
    }
  }, [])

  // 打开时恢复一次后台进度(若全量校准正在后台运行则接续展示)
  useEffect(() => {
    if (open) void pollAll()
  }, [open, pollAll])

  useEffect(() => {
    if (!open || view !== 'running') return
    const timer = window.setInterval(pollAll, POLL_MS)
    return () => window.clearInterval(timer)
  }, [open, view, pollAll])

  const handleOpenChange = (v: boolean) => {
    if (!v && open && view === 'running') {
      toast.info('全量校准在后台继续进行, 可稍后回来查看进度')
    }
    onOpenChange(v)
  }

  const startAll = async () => {
    if (starting) return
    setStarting(true)
    try {
      const res = await rawFetch('/api/admin/rules/calibrate-all', {
        method: 'POST',
        body: JSON.stringify({ profile }),
      })
      if (httpOk(res)) {
        // ab-c: 0 条启用规则时路由返回 200 + status:'idle' + message(明确不启动, 见
        // calibrate-all/route.ts POST)—— 旧实现一律切 running 视图, 而轮询对 idle 不改视图,
        // 界面会永久卡在「0 / …」进度页。识别 idle 直接提示并留在配置视图
        const started = unwrap(res.json)
        if (started && started.status === 'idle') {
          toast.info(typeof started.message === 'string' && started.message ? started.message : '当前没有启用的采集规则, 无可校准对象')
          return
        }
        setProgress({ current: 0, total: 0 })
        setResults([])
        setView('running')
      } else if (res.status === 409) {
        toast.info('全量校准已在进行中, 已切换到进度视图')
        setView('running')
        void pollAll()
      } else {
        toast.error(
          res.jsonOk
            ? errMessage(res, '全量校准启动失败')
            : '全量校准服务暂不可用, 请稍后重试',
        )
      }
    } finally {
      setStarting(false)
    }
  }

  const okCount = results.filter((r) => r.ok).length
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] border-zinc-800 bg-zinc-900 sm:max-w-lg lg:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-zinc-100">
            <Activity className="h-5 w-5 shrink-0 text-violet-400" />
            全量校准
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            对全部采集规则逐条执行极限校准, 生成每条规则的安全阈值与推荐参数
          </DialogDescription>
        </DialogHeader>

        <div className="admin-scroll max-h-[70vh] overflow-y-auto pr-1">
          {view === 'config' && (
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">校准档位</Label>
                <Select value={profile} onValueChange={(v) => setProfile(v as CalibrateProfile)}>
                  <SelectTrigger className="w-full border-zinc-700 bg-zinc-950 text-sm text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-900">
                    {PROFILE_META.map((p) => (
                      <SelectItem key={p.value} value={p.value} className="text-sm text-zinc-200">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-zinc-500">
                  {PROFILE_META.find((p) => p.value === profile)?.desc}
                </p>
              </div>
              <Button className="w-full gap-1.5" onClick={startAll} disabled={starting}>
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                开始全量校准
              </Button>
              <p className="text-center text-xs text-zinc-600">
                将逐条校准全部采集规则, 耗时与规则数量成正比, 请耐心等待
              </p>
            </div>
          )}

          {view === 'running' && (
            <div className="space-y-4 py-1">
              <div className="flex items-center justify-between gap-2">
                <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  全量校准进行中
                </Badge>
                <span className="text-xs text-zinc-500">
                  {progress.current} / {progress.total || '…'}
                </span>
              </div>
              <Progress value={pct} className="h-2 bg-zinc-800" />
              <p className="text-xs text-zinc-600">关闭对话框不会中断校准, 后台完成后可随时回来查看进度</p>
            </div>
          )}

          {view === 'done' && (
            <div className="space-y-3 py-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge className="gap-1.5 border-teal-500/40 bg-teal-500/15 px-3 py-1 text-sm text-teal-400">
                  <CheckCircle2 className="h-4 w-4" />
                  全量校准完成
                </Badge>
                <span className="text-xs text-zinc-500">
                  共 {results.length} 条 · 通过 {okCount} 条
                </span>
              </div>
              {results.length === 0 ? (
                <div className="rounded-md border border-zinc-800 bg-zinc-950/60 py-8 text-center text-xs text-zinc-500">
                  校准已完成, 但未返回结果摘要
                </div>
              ) : (
                <ScrollArea className="max-h-64 rounded-md border border-zinc-800 bg-zinc-950/60">
                  <div className="divide-y divide-zinc-800/70">
                    {results.map((r, i) => (
                      <div key={r.ruleId ?? i} className="flex items-start gap-2 p-3">
                        {r.ok ? (
                          <Badge
                            variant="outline"
                            className="mt-0.5 shrink-0 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-xs text-emerald-400"
                          >
                            通过
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="mt-0.5 shrink-0 border-red-500/40 bg-red-500/10 px-1.5 text-xs text-red-400"
                          >
                            未过
                          </Badge>
                        )}
                        <div className="min-w-0 space-y-0.5">
                          <p className="truncate text-sm text-zinc-200">{r.ruleName ?? r.name ?? r.ruleId ?? `规则 #${i + 1}`}</p>
                          <p className="truncate text-xs text-zinc-500" title={r.message ?? r.error ?? ''}>
                            {r.ok
                              ? `极限并发 ${r.maxConcurrency ?? '-'} · 极限间隔 ${r.minIntervalMs ?? '-'}ms`
                              : r.error ?? r.message ?? '未找到安全阈值'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => setView('config')}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重新校准
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => onOpenChange(false)}
                >
                  关闭
                </Button>
              </div>
            </div>
          )}

          {view === 'error' && (
            <div className="space-y-4 py-1">
              <Badge className="gap-1.5 border-red-500/40 bg-red-500/15 px-3 py-1 text-sm text-red-400">
                <XCircle className="h-4 w-4" />
                全量校准失败
              </Badge>
              <p className="text-sm leading-relaxed text-zinc-300">{errorMsg}</p>
              <Button
                variant="outline"
                className="gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                onClick={() => setView('config')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新校准
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
