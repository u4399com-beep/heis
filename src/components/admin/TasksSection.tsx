'use client'

// ============================================================
// 采集任务区块 — 任务表格 + 启动/暂停/停止 + 编辑 + 监控入口
// 批量操作: 全选/行复选框 + 批量启动/暂停/停止/删除(单失败不中断附 skipped)
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from './ConfirmDialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Activity,
  CirclePause,
  CirclePlay,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { TaskDialog } from './TaskDialog'
import { TaskMonitor } from './TaskMonitor'
import {
  BatchActionButton,
  BatchBar,
  BatchCheckbox,
  runBatch,
  useBatchSelection,
} from './batch'
import {
  api,
  fmtDateTime,
  PHASE_META,
  safeJsonParse,
  TASK_STATUS_META,
  type TaskProgress,
  type TaskRow,
  type TaskStatus,
} from './helpers'

export function TasksSection() {
  const [rows, setRows] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TaskRow | null>(null)
  const [deleting, setDeleting] = useState<TaskRow | null>(null)
  const [monitorId, setMonitorId] = useState<string | null>(null)
  const [acting, setActing] = useState<string>('')

  // ---- 批量操作状态(3s 轮询刷新不丢已选) ----
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows])
  const batch = useBatchSelection(rowIds)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const seqRef = useRef(0)
  const aliveRef = useRef(true)

  // 卸载后停止异步 setState
  useEffect(() => {
    return () => {
      aliveRef.current = false
    }
  }, [])

  const load = useCallback(async (silent = false) => {
    const seq = ++seqRef.current
    if (!silent) setLoading(true)
    try {
      const data = await api.get<TaskRow[]>('/api/admin/tasks')
      if (!aliveRef.current || seq !== seqRef.current) return
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      if (!silent && aliveRef.current && seq === seqRef.current) toast.error(e instanceof Error ? e.message : '加载任务失败')
    } finally {
      if (!silent && aliveRef.current && seq === seqRef.current) setLoading(false)
    }
  }, [])

  // 列表 3s 轮询: 监控视图打开期间暂停(TaskMonitor 自带 2s 监控轮询, 双轮询叠加属空转), 返回列表自动恢复
  // 注: 组件内条件 return(TaskMonitor 替换渲染)位于全部 hooks 之后, 本 effect 以依赖切换实现暂停, 不引入 hooks 违规
  useEffect(() => {
    if (monitorId) return
    load()
    pollRef.current = setInterval(() => load(true), 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [load, monitorId])

  const control = async (task: TaskRow, action: 'start' | 'pause' | 'stop') => {
    setActing(task.id + action)
    try {
      await api.post(`/api/admin/tasks/${task.id}/control`, { action })
      toast.success(action === 'start' ? `任务「${task.name}」已启动` : action === 'pause' ? `任务「${task.name}」已暂停` : `任务「${task.name}」已停止`)
      load(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setActing('')
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/api/admin/tasks/${deleting.id}`)
      toast.success(`任务「${deleting.name}」已删除`)
      setDeleting(null)
      load(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  // ---- 批量控制: start/pause/stop 立即执行(单失败不中断, 服务端附 skipped); delete 需确认 ----
  const runTasksBatch = async (action: string, describe: (n: number) => string) => {
    setBatchRunning(true)
    try {
      const res = await runBatch('/api/admin/tasks/batch', { action, ids: batch.selectedOrdered }, (r) => describe(r.affected ?? 0))
      if (res) {
        batch.clearSelection()
        await load(true)
      }
    } finally {
      setBatchRunning(false)
    }
  }

  if (monitorId) {
    return <TaskMonitor taskId={monitorId} onBack={() => setMonitorId(null)} />
  }

  const running = rows.filter((r) => r.status === 'running').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <ListChecks className="h-5 w-5 text-violet-400" />
            采集任务
            {running > 0 && (
              <Badge className="border-transparent bg-emerald-500/15 text-emerald-400">{running} 个运行中</Badge>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">随机线程范围 + 随机间隔范围, 支持运行中在线调节参数</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={() => load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            新建任务
          </Button>
        </div>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-0">
          {/* 批量操作条(已选>0 时出现) */}
          <BatchBar count={batch.selectedCount} onClear={batch.clearSelection} hint="运行中任务删除将被跳过">
            <BatchActionButton running={batchRunning} className="text-emerald-400 hover:text-emerald-300" onClick={() => void runTasksBatch('start', (n) => `已启动 ${n} 个任务`)}>
              <CirclePlay className="h-3 w-3" />
              启动
            </BatchActionButton>
            <BatchActionButton running={batchRunning} className="text-amber-400 hover:text-amber-300" onClick={() => void runTasksBatch('pause', (n) => `已暂停 ${n} 个任务`)}>
              <CirclePause className="h-3 w-3" />
              暂停
            </BatchActionButton>
            <BatchActionButton running={batchRunning} className="text-zinc-300 hover:text-zinc-100" onClick={() => void runTasksBatch('stop', (n) => `已停止 ${n} 个任务`)}>
              <Square className="h-3 w-3" />
              停止
            </BatchActionButton>
            <BatchActionButton running={batchRunning} className="text-red-400 hover:text-red-300" onClick={() => setBatchDeleteConfirm(true)}>
              <Trash2 className="h-3 w-3" />
              删除
            </BatchActionButton>
          </BatchBar>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载任务…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500">暂无采集任务, 点击右上角「新建任务」开始采集</div>
          ) : (
            <div className="admin-scroll overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="w-9 pr-0">
                      <BatchCheckbox
                        checked={batch.allSelected}
                        indeterminate={batch.indeterminate}
                        onCheckedChange={batch.toggleAll}
                        ariaLabel="全选本页任务"
                      />
                    </TableHead>
                    <TableHead className="text-xs text-zinc-500">任务</TableHead>
                    <TableHead className="text-xs text-zinc-500">规则</TableHead>
                    <TableHead className="text-xs text-zinc-500">模式</TableHead>
                    <TableHead className="hidden text-xs text-zinc-500 md:table-cell">重采 / 存储</TableHead>
                    <TableHead className="hidden text-xs text-zinc-500 lg:table-cell">线程 / 间隔</TableHead>
                    <TableHead className="text-xs text-zinc-500">状态</TableHead>
                    <TableHead className="hidden text-xs text-zinc-500 xl:table-cell">更新时间</TableHead>
                    <TableHead className="text-right text-xs text-zinc-500">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => {
                    const meta = TASK_STATUS_META[t.status as TaskStatus] || TASK_STATUS_META.pending
                    const prog = safeJsonParse<TaskProgress>(t.progress, {})
                    const canStart = t.status !== 'running'
                    const canPause = t.status === 'running'
                    const canStop = t.status === 'running'
                    return (
                      <TableRow key={t.id} className="border-zinc-800/70">
                        <TableCell className="pr-0">
                          <BatchCheckbox
                            checked={batch.selected.has(t.id)}
                            onCheckedChange={() => batch.toggle(t.id)}
                            ariaLabel={`选择任务「${t.name}」`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-zinc-200">{t.name}</div>
                          {t.status === 'running' && (
                            <div className="mt-0.5 text-[11px] text-zinc-500">
                              {PHASE_META[prog.phase || 'idle'] || ''}
                              {prog.phaseNote ? ` · ${prog.phaseNote}` : ''}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-zinc-400">{t.rule?.name || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
                            {t.mode === 'single' ? '单本' : '范围'}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex flex-wrap gap-1">
                            <Badge
                              variant="outline"
                              className={
                                t.recrawlMode === 'full'
                                  ? 'border-red-500/30 bg-red-500/10 text-[11px] text-red-400'
                                  : 'border-teal-500/30 bg-teal-500/10 text-[11px] text-teal-400'
                              }
                            >
                              {t.recrawlMode === 'full' ? '完全覆盖' : '增量更新'}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={
                                t.storageMode === 'txt'
                                  ? 'border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-400'
                                  : 'border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-400'
                              }
                            >
                              {t.storageMode === 'txt' ? 'TXT' : '数据库'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs text-zinc-400 lg:table-cell">
                          {t.threadMin}~{t.threadMax} 线程
                          <br />
                          {t.intervalMin}~{t.intervalMax} ms
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${meta.className}`}>
                            {t.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-xs text-zinc-500 xl:table-cell">{fmtDateTime(t.updatedAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-0.5">
                            <IconBtn
                              title={canStart ? '启动' : '运行中'}
                              disabled={!canStart || acting === t.id + 'start'}
                              onClick={() => control(t, 'start')}
                              className="text-emerald-400 hover:text-emerald-300"
                            >
                              {acting === t.id + 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CirclePlay className="h-3.5 w-3.5" />}
                            </IconBtn>
                            <IconBtn
                              title="暂停"
                              disabled={!canPause || acting === t.id + 'pause'}
                              onClick={() => control(t, 'pause')}
                              className="text-amber-400 hover:text-amber-300"
                            >
                              {acting === t.id + 'pause' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CirclePause className="h-3.5 w-3.5" />}
                            </IconBtn>
                            <IconBtn
                              title="停止"
                              disabled={!canStop || acting === t.id + 'stop'}
                              onClick={() => control(t, 'stop')}
                              className="text-red-400 hover:text-red-300"
                            >
                              {acting === t.id + 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                            </IconBtn>
                            <IconBtn
                              title="监控"
                              onClick={() => setMonitorId(t.id)}
                              className="text-violet-400 hover:text-violet-300"
                            >
                              <Activity className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn
                              title="编辑"
                              onClick={() => {
                                setEditing(t)
                                setDialogOpen(true)
                              }}
                              className="text-zinc-400 hover:text-zinc-100"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="删除" onClick={() => setDeleting(t)} className="text-red-400/80 hover:text-red-400">
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconBtn>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} task={editing} onSaved={() => load(true)} />

      {/* 批量删除确认 */}
      <ConfirmDialog
        open={batchDeleteConfirm}
        onOpenChange={setBatchDeleteConfirm}
        title={`确认批量删除 ${batch.selectedCount} 个任务?`}
        description="将删除所选任务及其全部日志。正在运行中的任务会被跳过(保护优先, 请先停止再删)。"
        confirmText="删除"
        onConfirm={() => {
          setBatchDeleteConfirm(false)
          void runTasksBatch('delete', (n) => `已删除 ${n} 个任务`)
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="确认删除任务?"
        description={`将删除任务「${deleting?.name}」及其全部日志。若任务正在运行, 建议先停止再删除。`}
        confirmText="删除"
        onConfirm={doDelete}
      />
    </div>
  )
}

function IconBtn({
  title,
  children,
  onClick,
  disabled,
  className = '',
}: {
  title: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`h-7 w-7 p-0 ${className}`}
    >
      {children}
    </Button>
  )
}
