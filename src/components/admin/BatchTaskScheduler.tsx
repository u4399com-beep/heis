'use client'

// ============================================================
// BatchTaskScheduler — 批量任务调度 (agent-PP-ui5)
// 用户为多条任务建立队列, 可指定依赖关系(任务 B 等待任务 A 完成后启动),
// 一键创建队列并按依赖顺序自动启动; 失败可继续/中止。
//
// 数据源: /api/admin/rules (规则列表), /api/admin/tasks (创建 + 控制 + 状态轮询)
// 不修改任何 API; 仅复用现有 POST/PUT/control 接口
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleStop,
  Layers,
  Loader2,
  Plus,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type RuleRow } from './helpers'

interface QueueItem {
  /** 客户端临时 id (UUID 不必要, 简单计数器) */
  clientId: string
  /** 选定规则 id */
  ruleId: string
  /** 任务名(默认从规则名推导) */
  name: string
  /** 采集模式: single 走 bookUrl; range 走 listUrl + listStart/listEnd */
  mode: 'single' | 'range'
  bookUrl: string
  listUrl: string
  listStart: number
  listEnd: number
  /** 依赖前一个队列项 (clientId); 为空则无依赖, 与第一项并行启动 */
  dependsOn: string | null
  /** 创建后的服务端 task id */
  serverTaskId?: string
  /** 调度状态: pending(等待依赖) / created(已入库未启动) / running / done / error / skipped */
  status: 'pending' | 'created' | 'running' | 'done' | 'error' | 'skipped'
  /** 错误信息 */
  error?: string
}

type Phase = 'config' | 'running' | 'done'

interface BatchTaskSchedulerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 由 RulesSection 的"快速任务"按钮预选的规则 (开对话框时预填一条) */
  preselectRuleId?: string | null
  /** 创建完成后通知 TasksSection 刷新 */
  onCreated?: () => void
}

let _clientSeq = 0
function newClientId(): string {
  _clientSeq += 1
  return `c${_clientSeq}`
}

function emptyItem(ruleId = '', name = ''): QueueItem {
  return {
    clientId: newClientId(),
    ruleId,
    name,
    mode: 'single',
    bookUrl: '',
    listUrl: '',
    listStart: 1,
    listEnd: 1,
    dependsOn: null,
    status: 'pending',
  }
}

export function BatchTaskScheduler({ open, onOpenChange, preselectRuleId, onCreated }: BatchTaskSchedulerProps) {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [items, setItems] = useState<QueueItem[]>([])
  const [phase, setPhase] = useState<Phase>('config')
  const [busy, setBusy] = useState(false)
  // 链执行: 失败后是否中止(true) 还是继续后续无依赖任务(false, 缺省)
  const [abortOnFail, setAbortOnFail] = useState(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 打开时拉规则列表, 首条预填 (来自 preselectRuleId)
  useEffect(() => {
    if (!open) return
    api
      .get<RuleRow[]>('/api/admin/rules')
      .then((rs) => {
        const list = Array.isArray(rs) ? rs : []
        setRules(list)
        // 首次打开 + 预选规则 → 自动加一条
        setItems((prev) => {
          if (prev.length > 0) return prev
          if (preselectRuleId) {
            const r = list.find((x) => x.id === preselectRuleId)
            if (r) return [emptyItem(r.id, `${r.name}-批量`)]
          }
          return [emptyItem()]
        })
      })
      .catch(() => setRules([]))
  }, [open, preselectRuleId])

  // 关闭时复位
  useEffect(() => {
    if (!open) {
      setPhase('config')
      setBusy(false)
      // 保留 items 草稿 (用户切回对话框可继续编辑) 除非已全部完成
    }
  }, [open])

  const ruleName = useCallback(
    (rid: string) => rules.find((r) => r.id === rid)?.name || '(未选规则)',
    [rules],
  )

  // 编辑某项
  const patchItem = useCallback((clientId: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.clientId === clientId ? { ...it, ...patch } : it)))
  }, [])

  const addItem = useCallback(() => {
    setItems((prev) => {
      // 默认依赖前一项 (任务链) — 用户可改为 null(并行) 或更早的项
      const last = prev[prev.length - 1]
      const it = emptyItem()
      it.dependsOn = last ? last.clientId : null
      return [...prev, it]
    })
  }, [])

  const removeItem = useCallback((clientId: string) => {
    setItems((prev) => {
      const next = prev.filter((it) => it.clientId !== clientId)
      // 任何依赖被删除项的任务, dependsOn 上调到被删项的 dependsOn
      const removed = prev.find((it) => it.clientId === clientId)
      if (removed) {
        for (const it of next) {
          if (it.dependsOn === clientId) it.dependsOn = removed.dependsOn
        }
      }
      return next
    })
  }, [])

  // 校验: 每条 item 必须选规则; single 必须填 bookUrl; range 必须填 listUrl 且 listStart<=listEnd
  const validation = useMemo(() => {
    const errors: string[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.ruleId) errors.push(`第 ${i + 1} 条未选规则`)
      if (it.mode === 'single') {
        if (!/^https?:\/\//i.test(it.bookUrl.trim())) errors.push(`第 ${i + 1} 条 bookUrl 非法`)
      } else {
        if (!/^https?:\/\//i.test(it.listUrl.trim())) errors.push(`第 ${i + 1} 条 listUrl 非法`)
        if (it.listStart > it.listEnd) errors.push(`第 ${i + 1} 条 listStart > listEnd`)
      }
    }
    return { ok: errors.length === 0, errors }
  }, [items])

  // 计算队列执行顺序 (拓扑序): dependsOn 为 null 的项先并行; 有依赖的项等依赖完成后再启动
  // 注: 客户端只负责按依赖顺序"依次创建 + 启动", 不真正并行等待依赖完成 (单线程 await 链)
  const sortedByDependency = useMemo(() => {
    // 简单: 按依赖深度排序 (深度浅的先)
    const depthMap = new Map<string, number>()
    const computeDepth = (it: QueueItem): number => {
      if (!it.dependsOn) return 0
      if (depthMap.has(it.clientId)) return depthMap.get(it.clientId)!
      const dep = items.find((x) => x.clientId === it.dependsOn)
      const d = dep ? computeDepth(dep) + 1 : 0
      depthMap.set(it.clientId, d)
      return d
    }
    return [...items].map((it) => ({ it, d: computeDepth(it) })).sort((a, b) => a.d - b.d).map((x) => x.it)
  }, [items])

  // 创建一条任务 (POST /api/admin/tasks, 默认不启动)
  const createOne = useCallback(async (item: QueueItem): Promise<string> => {
    const body = {
      name: item.name.trim() || `${ruleName(item.ruleId)}-批量`,
      ruleId: item.ruleId,
      mode: item.mode,
      bookUrl: item.bookUrl.trim(),
      listUrl: item.listUrl.trim(),
      listStart: item.listStart,
      listEnd: item.listEnd,
      bookStart: 0,
      bookEnd: 0,
      recrawlMode: 'incremental',
      storageMode: 'db',
      threadMin: 2,
      threadMax: 3,
      intervalMin: 1000,
      intervalMax: 2000,
      smartCategory: true,
      smartComplete: true,
      autoSuggest: false,
      autoRefresh: false,
      refreshIntervalMin: 30,
    }
    const created = await api.post<{ id: string }>('/api/admin/tasks', body)
    return created.id
  }, [ruleName])

  // 控制任务: start / stop
  const controlOne = useCallback(async (taskId: string, action: 'start' | 'stop') => {
    await api.post(`/api/admin/tasks/${taskId}/control`, { action })
  }, [])

  // 查询任务状态: 返回 status
  const fetchStatus = useCallback(async (taskId: string): Promise<string> => {
    const data = await api.get<{ status: string }>(`/api/admin/tasks/${taskId}`)
    return data?.status || 'pending'
  }, [])

  // 等待任务到达终态 (done / error / stopped), 超时 30min
  const waitForTerminal = useCallback(async (taskId: string, signal: { aborted: boolean }): Promise<'done' | 'error' | 'stopped' | 'aborted'> => {
    const deadline = Date.now() + 30 * 60 * 1000
    while (Date.now() < deadline) {
      if (signal.aborted) return 'aborted'
      await new Promise((r) => setTimeout(r, 3000))
      if (!aliveRef.current) return 'aborted'
      try {
        const s = await fetchStatus(taskId)
        if (s === 'done') return 'done'
        if (s === 'error') return 'error'
        if (s === 'stopped') return 'stopped'
      } catch {
        // 短暂网络错误, 继续轮询
      }
    }
    return 'error'
  }, [fetchStatus])

  // 执行链: 按依赖序依次创建 + 启动 + 等待
  const runChain = useCallback(async () => {
    if (!validation.ok) {
      toast.error(validation.errors[0])
      return
    }
    setPhase('running')
    setBusy(true)
    const abortSignal = { aborted: false }
    let chainFailed = false
    let firstCreatedId: string | null = null
    try {
      for (const item of sortedByDependency) {
        if (!aliveRef.current) return
        // 失败链 + abortOnFail + 当前任务依赖失败项 → 跳过
        if (chainFailed && abortOnFail && item.dependsOn) {
          patchItem(item.clientId, { status: 'skipped', error: '前置任务失败, 链已中止' })
          continue
        }
        // 无依赖 或 依赖已完成: 创建并启动
        patchItem(item.clientId, { status: 'created', error: undefined })
        let taskId: string
        try {
          taskId = await createOne(item)
        } catch (e) {
          patchItem(item.clientId, { status: 'error', error: e instanceof Error ? e.message : '创建失败' })
          chainFailed = true
          continue
        }
        if (!firstCreatedId) firstCreatedId = taskId
        patchItem(item.clientId, { serverTaskId: taskId, status: 'running' })
        try {
          await controlOne(taskId, 'start')
        } catch (e) {
          patchItem(item.clientId, { status: 'error', error: `启动失败: ${e instanceof Error ? e.message : ''}` })
          chainFailed = true
          continue
        }
        // 等待终态 (有依赖才等; 无依赖的并行启动后不阻塞后续)
        if (item.dependsOn) {
          const result = await waitForTerminal(taskId, abortSignal)
          if (result === 'done') {
            patchItem(item.clientId, { status: 'done' })
          } else if (result === 'aborted') {
            // 对话框关闭/卸载: 不再更新状态
            return
          } else {
            patchItem(item.clientId, { status: result === 'stopped' ? 'skipped' : 'error', error: `任务终态: ${result}` })
            chainFailed = true
          }
        } else {
          // 无依赖: 仅启动, 不等待 (允许并行执行)
          patchItem(item.clientId, { status: 'running' })
        }
      }
      if (firstCreatedId) {
        onCreated?.()
      }
      toast.success(`批量调度完成: ${sortedByDependency.length} 条任务已下发`)
      setPhase('done')
    } finally {
      setBusy(false)
    }
  }, [validation, sortedByDependency, createOne, controlOne, waitForTerminal, patchItem, abortOnFail, onCreated])

  const close = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const completedCount = items.filter((i) => i.status === 'done').length
  const errorCount = items.filter((i) => i.status === 'error' || i.status === 'skipped').length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scroll max-h-[92vh] sm:max-w-3xl overflow-y-auto border-zinc-800 bg-zinc-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-100">
            <span className="flex size-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-400">
              <Layers className="size-4" />
            </span>
            批量任务调度
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            为多条任务建立队列, 配置依赖关系(默认链式: B 等 A 完成后启动), 一键创建并按依赖顺序自动启动
          </DialogDescription>
        </DialogHeader>

        {/* 工具栏: 添加 + 失败策略 */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
              onClick={addItem}
              disabled={phase === 'running' || busy}
              aria-label="添加队列项"
            >
              <Plus className="size-3" />
              添加任务
            </Button>
            <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">
              共 {items.length} 条
            </Badge>
            {phase !== 'config' && (
              <>
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-400">
                  <CheckCircle2 className="mr-1 size-2.5" />
                  完成 {completedCount}
                </Badge>
                {errorCount > 0 && (
                  <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-[10px] text-red-400">
                    <X className="mr-1 size-2.5" />
                    失败 {errorCount}
                  </Badge>
                )}
              </>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={abortOnFail}
              onChange={(e) => setAbortOnFail(e.target.checked)}
              disabled={phase === 'running' || busy}
              className="size-3.5 accent-violet-500"
            />
            失败时中止后续依赖任务
          </label>
        </div>

        {/* 队列列表 */}
        <ScrollArea className="max-h-[48vh] rounded-md border border-zinc-800">
          <div className="divide-y divide-zinc-800">
            {items.length === 0 ? (
              <div className="px-3 py-12 text-center text-xs text-zinc-600">
                <Bot className="mx-auto mb-2 size-6" />
                暂无队列项, 点击「添加任务」开始
              </div>
            ) : (
              items.map((item, idx) => (
                <QueueRow
                  key={item.clientId}
                  item={item}
                  index={idx}
                  rules={rules}
                  items={items}
                  ruleName={ruleName}
                  patch={patchItem}
                  onRemove={() => removeItem(item.clientId)}
                  disabled={phase === 'running' || busy}
                />
              ))
            )}
          </div>
        </ScrollArea>

        {/* 校验提示 */}
        {!validation.ok && phase === 'config' && (
          <p className="text-[11px] text-amber-400" role="alert">
            {validation.errors[0]}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800" onClick={close}>
            关闭
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!validation.ok || busy || items.length === 0}
            onClick={() => void runChain()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
            {phase === 'config' ? '一键创建并启动链' : phase === 'done' ? '已下发' : '执行中…'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function statusMeta(s: QueueItem['status']): { label: string; chip: string; icon: React.ReactNode } {
  switch (s) {
    case 'pending':
      return { label: '等待中', chip: 'border-zinc-700 bg-zinc-900 text-zinc-400', icon: null }
    case 'created':
      return { label: '已创建', chip: 'border-sky-500/40 bg-sky-500/10 text-sky-400', icon: null }
    case 'running':
      return { label: '运行中', chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400', icon: <Loader2 className="mr-1 size-2.5 animate-spin" /> }
    case 'done':
      return { label: '已完成', chip: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300', icon: <CheckCircle2 className="mr-1 size-2.5" /> }
    case 'error':
      return { label: '失败', chip: 'border-red-500/40 bg-red-500/10 text-red-400', icon: <X className="mr-1 size-2.5" /> }
    case 'skipped':
      return { label: '已跳过', chip: 'border-amber-500/40 bg-amber-500/10 text-amber-400', icon: <CircleStop className="mr-1 size-2.5" /> }
    default:
      return { label: s, chip: 'border-zinc-700 text-zinc-400', icon: null }
  }
}

function QueueRow({
  item,
  index,
  rules,
  items,
  ruleName,
  patch,
  onRemove,
  disabled,
}: {
  item: QueueItem
  index: number
  rules: RuleRow[]
  items: QueueItem[]
  ruleName: (id: string) => string
  patch: (clientId: string, p: Partial<QueueItem>) => void
  onRemove: () => void
  disabled: boolean
}) {
  const status = statusMeta(item.status)
  const depName = item.dependsOn ? items.find((x) => x.clientId === item.dependsOn)?.name || '(已删除)' : null
  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-zinc-700 bg-zinc-950 text-[10px] text-zinc-400">
          #{index + 1}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${status.chip}`}>
          {status.icon}
          {status.label}
        </Badge>
        {depName && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
                <ArrowRight className="size-2.5" />
                依赖: {depName.length > 16 ? depName.slice(0, 16) + '…' : depName}
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-xs">{depName}</TooltipContent>
          </Tooltip>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="ml-auto inline-flex size-6 items-center justify-center rounded text-zinc-500 hover:bg-red-500/20 hover:text-red-400 disabled:opacity-30"
          aria-label="移除该队列项"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-zinc-500">规则</Label>
          <Select
            value={item.ruleId}
            onValueChange={(v) => {
              const r = rules.find((x) => x.id === v)
              patch(item.clientId, { ruleId: v, name: r ? `${r.name}-批量` : item.name })
            }}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-200">
              <SelectValue placeholder="选择规则" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900">
              {rules.map((r) => (
                <SelectItem key={r.id} value={r.id} className="text-xs text-zinc-200">
                  {r.name}{!r.enabled ? ' (停用)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-zinc-500">任务名</Label>
          <Input
            className="h-8 border-zinc-700 bg-zinc-950 text-xs"
            value={item.name}
            onChange={(e) => patch(item.clientId, { name: e.target.value })}
            disabled={disabled}
            placeholder={item.ruleId ? `${ruleName(item.ruleId)}-批量` : '任务名'}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-zinc-500">采集模式</Label>
          <Select
            value={item.mode}
            onValueChange={(v) => patch(item.clientId, { mode: v as 'single' | 'range' })}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 border-zinc-700 bg-zinc-950 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">单本采集</SelectItem>
              <SelectItem value="range">范围采集</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-zinc-500">依赖前序任务</Label>
          <Select
            value={item.dependsOn || '__none__'}
            onValueChange={(v) => patch(item.clientId, { dependsOn: v === '__none__' ? null : v })}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 border-zinc-700 bg-zinc-950 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">无依赖 (并行启动)</SelectItem>
              {items
                .filter((x) => x.clientId !== item.clientId)
                .map((x) => (
                  <SelectItem key={x.clientId} value={x.clientId}>
                    {x.name || ruleName(x.ruleId)} (#{items.indexOf(x) + 1})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {item.mode === 'single' ? (
        <div className="space-y-1">
          <Label className="text-[10px] text-zinc-500">书籍页 URL</Label>
          <Input
            className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs"
            placeholder="https://example.com/book/123.html"
            value={item.bookUrl}
            onChange={(e) => patch(item.clientId, { bookUrl: e.target.value })}
            disabled={disabled}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="space-y-1">
            <Label className="text-[10px] text-zinc-500">列表 URL (支持 {`{page}`})</Label>
            <Input
              className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs"
              placeholder="https://example.com/sort/1_{page}.html"
              value={item.listUrl}
              onChange={(e) => patch(item.clientId, { listUrl: e.target.value })}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-zinc-500">起始页</Label>
            <Input
              type="number"
              min={1}
              className="h-8 border-zinc-700 bg-zinc-950 text-xs"
              value={item.listStart}
              onChange={(e) => patch(item.clientId, { listStart: Math.max(1, Number(e.target.value) || 1) })}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-zinc-500">结束页</Label>
            <Input
              type="number"
              min={1}
              className="h-8 border-zinc-700 bg-zinc-950 text-xs"
              value={item.listEnd}
              onChange={(e) => patch(item.clientId, { listEnd: Math.max(1, Number(e.target.value) || 1) })}
              disabled={disabled}
            />
          </div>
        </div>
      )}
      {item.error && (
        <p className="text-[10px] text-red-400" role="alert">
          {item.error}
        </p>
      )}
    </div>
  )
}
