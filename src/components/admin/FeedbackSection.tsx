// ============================================================
// 用户反馈管理 — 后台区块
// 顶部统计 (total / new / resolved) + 过滤 (status/type/search)
// 表格: 类型徽章 / 内容截断+tooltip / 联系 / 状态徽章 / 时间 / 操作
// 行点击 → 详情对话框: 全文 + 元信息 + 状态/管理员备注可编辑
// ============================================================
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from './ConfirmDialog'
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Inbox,
  Loader2,
  MessageSquare,
  MessageSquareReply,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  FEEDBACK_STATUS_META,
  FEEDBACK_TYPE_META,
  fmtDateTime,
  type FeedbackDetail,
  type FeedbackListResp,
  type FeedbackRow,
} from './helpers'

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'new', label: '新' },
  { value: 'read', label: '已读' },
  { value: 'resolved', label: '已处理' },
  { value: 'ignored', label: '已忽略' },
]

const TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'bug', label: '问题' },
  { value: 'suggestion', label: '建议' },
  { value: 'praise', label: '表扬' },
  { value: 'other', label: '其他' },
]

const CONTENT_PREVIEW_LEN = 80
const PAGE_SIZE = 20
// feat-bb-2: 本地缓存「已回复」反馈 ID (adminNote 非空), 列表行显示「已回复」徽章
// localStorage 仅存 ID 集合, 丢失不严重影响业务; 调大反馈成功后同步更新
const REPLIED_KEY = 'heis-feedback-replied'
const REPLIED_MAX = 500 // 上限防 localStorage 膨胀

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + '…'
}

function loadRepliedCache(): Set<string> {
  try {
    const raw = localStorage.getItem(REPLIED_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function saveRepliedCache(s: Set<string>): void {
  try {
    // 超过上限时保留最新的 REPLIED_MAX 个 (FIFO 丢最早进入的, 但 Set 不保序→转为数组仅截裁)
    const arr = [...s]
    const trimmed = arr.length > REPLIED_MAX ? arr.slice(arr.length - REPLIED_MAX) : arr
    localStorage.setItem(REPLIED_KEY, JSON.stringify(trimmed))
  } catch {
    /* 静默 */
  }
}

export function FeedbackSection() {
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [stats, setStats] = useState<{ total: number; new: number; resolved: number }>({ total: 0, new: 0, resolved: 0 })
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchActive, setSearchActive] = useState('')

  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<FeedbackDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editStatus, setEditStatus] = useState('new')
  const [editNote, setEditNote] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleting, setDeleting] = useState<FeedbackRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // feat-bb-2: 本地「已回复」ID 缓存 (adminNote 非空的反馈)
  const [repliedCache, setRepliedCache] = useState<Set<string>>(() => new Set())

  // 初始挂载加载本地缓存 (仅在客户端, 避免 SSR 不匹配)
  useEffect(() => {
    setRepliedCache(loadRepliedCache())
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get<FeedbackListResp>('/api/admin/feedback', {
        page,
        size: PAGE_SIZE,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        type: typeFilter !== 'all' ? typeFilter : undefined,
        q: searchActive || undefined,
      })
      setRows(r?.rows || [])
      setPages(r?.pages || 1)
      setTotal(r?.total || 0)
      setStats(r?.stats || { total: 0, new: 0, resolved: 0 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载反馈失败')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, typeFilter, searchActive])

  useEffect(() => {
    load()
  }, [load])

  const openDetail = async (row: FeedbackRow) => {
    setDetailOpen(true)
    setDetail(null)
    setDetailLoading(true)
    setEditStatus(row.status)
    setEditNote('')
    try {
      const d = await api.get<FeedbackDetail>(`/api/admin/feedback/${row.id}`)
      setDetail(d)
      setEditStatus(d.status)
      setEditNote(d.adminNote || '')
      // feat-bb-2: 同步「已回复」缓存 — 如果 adminNote 非空, 记入 localStorage
      if (d.adminNote && d.adminNote.trim()) {
        setRepliedCache((prev) => {
          if (prev.has(d.id)) return prev
          const n = new Set(prev)
          n.add(d.id)
          saveRepliedCache(n)
          return n
        })
      } else {
        // adminNote 为空 → 从缓存中移除 (以防之前被错误记入)
        setRepliedCache((prev) => {
          if (!prev.has(d.id)) return prev
          const n = new Set(prev)
          n.delete(d.id)
          saveRepliedCache(n)
          return n
        })
      }
      // 首次查看(new)自动置 read; 其它情况静默 PATCH 不破坏管理员已设的状态
      if (d.status === 'new') {
        try {
          await api.patch<FeedbackDetail>(`/api/admin/feedback/${d.id}`, { status: 'read' })
          setEditStatus('read')
          setDetail({ ...d, status: 'read' })
        } catch {
          /* 静默 */
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载详情失败')
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const saveDetail = async () => {
    if (!detail) return
    setSaving(true)
    try {
      await api.patch<FeedbackDetail>(`/api/admin/feedback/${detail.id}`, {
        status: editStatus,
        adminNote: editNote,
      })
      toast.success('反馈已更新')
      // feat-bb-2: 同步「已回复」缓存 — 保存后根据 editNote 判定
      const hasNote = !!(editNote && editNote.trim())
      setRepliedCache((prev) => {
        if (hasNote === prev.has(detail.id)) return prev
        const n = new Set(prev)
        if (hasNote) n.add(detail.id)
        else n.delete(detail.id)
        saveRepliedCache(n)
        return n
      })
      setDetailOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新失败')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await api.del(`/api/admin/feedback/${deleting.id}`)
      toast.success('反馈已删除')
      setDeleting(null)
      if (detail?.id === deleting.id) {
        setDetailOpen(false)
        setDetail(null)
      }
      // 删除后若当前页空了, 回退一页
      if (rows.length === 1 && page > 1) setPage((p) => p - 1)
      else load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleteLoading(false)
    }
  }

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearchActive(searchInput.trim())
  }

  const resetFilters = () => {
    setStatusFilter('all')
    setTypeFilter('all')
    setSearchInput('')
    setSearchActive('')
    setPage(1)
  }

  const statsCards = useMemo(
    () => [
      { key: 'total', label: '反馈总数', value: stats.total, color: 'text-zinc-100', ring: 'border-zinc-700 bg-zinc-900/60' },
      { key: 'new', label: '新反馈', value: stats.new, color: 'text-sky-400', ring: 'border-sky-500/30 bg-sky-950/30' },
      { key: 'resolved', label: '已处理', value: stats.resolved, color: 'text-emerald-400', ring: 'border-emerald-500/30 bg-emerald-950/30' },
    ],
    [stats],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <MessageSquare className="h-5 w-5 text-violet-400" />
            用户反馈
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">前台悬浮按钮提交的反馈, 可批量管理状态与处理备注</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          onClick={load}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          刷新
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-3">
        {statsCards.map((s) => (
          <Card key={s.key} className={`border ${s.ring}`}>
            <CardContent className="py-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{s.label}</div>
              <div className={`mt-1 text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 过滤条 */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
        <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v) }}>
          <SelectTrigger className="h-8 w-32 border-zinc-700 bg-zinc-950 text-xs" aria-label="状态过滤">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => { setPage(1); setTypeFilter(v) }}>
          <SelectTrigger className="h-8 w-32 border-zinc-700 bg-zinc-950 text-xs" aria-label="类型过滤">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <form onSubmit={onSearchSubmit} className="flex flex-1 min-w-[160px] items-center gap-2">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索反馈内容..."
            className="h-8 flex-1 border-zinc-700 bg-zinc-950 text-xs"
            maxLength={100}
            aria-label="搜索反馈"
          />
          <Button type="submit" size="sm" variant="outline" className="h-8 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800">
            搜索
          </Button>
        </form>

        {(statusFilter !== 'all' || typeFilter !== 'all' || searchActive) && (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-zinc-400 hover:text-zinc-200" onClick={resetFilters}>
            重置
          </Button>
        )}
      </div>

      {/* feat-bb-2: 状态快捷筛选条 (一键过滤状态) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-zinc-500">快捷筛选:</span>
        {STATUS_OPTIONS.filter((o) => o.value !== 'all').map((o) => {
          const active = statusFilter === o.value
          const meta = FEEDBACK_STATUS_META[o.value]
          const dot = meta?.dot || 'bg-zinc-500'
          const count = o.value === 'new' ? stats.new : o.value === 'resolved' ? stats.resolved : null
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => { setPage(1); setStatusFilter(active ? 'all' : o.value) }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                active
                  ? 'border-violet-500/60 bg-violet-500/15 text-violet-200'
                  : 'border-zinc-700 bg-zinc-900/40 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
              aria-pressed={active}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
              {o.label}
              {count !== null && <span className="ml-0.5 font-mono tabular-nums opacity-70">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* 表格 */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载反馈…
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-zinc-500">
            <Inbox className="h-8 w-8 text-zinc-600" aria-hidden />
            <p className="font-medium text-zinc-300">暂无反馈</p>
            <p className="text-xs text-zinc-600">用户在前台提交反馈后, 将在此处显示</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 bg-zinc-900/80 hover:bg-zinc-900/80">
                <TableHead className="w-20 text-zinc-400">类型</TableHead>
                <TableHead className="text-zinc-400">内容</TableHead>
                <TableHead className="w-32 text-zinc-400">联系</TableHead>
                <TableHead className="w-24 text-zinc-400">状态</TableHead>
                <TableHead className="w-32 text-zinc-400">提交时间</TableHead>
                <TableHead className="w-28 text-right text-zinc-400">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const tm = FEEDBACK_TYPE_META[r.type] || FEEDBACK_TYPE_META.other
                const sm = FEEDBACK_STATUS_META[r.status] || FEEDBACK_STATUS_META.new
                const preview = truncate(r.content, CONTENT_PREVIEW_LEN)
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer border-zinc-800 hover:bg-zinc-900/40"
                    onClick={() => openDetail(r)}
                  >
                    <TableCell>
                      <Badge className={`border ${tm.className}`}>
                        <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${tm.dot}`} aria-hidden />
                        {tm.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md text-xs text-zinc-200">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="line-clamp-2 cursor-help text-zinc-300">{preview}</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-md whitespace-pre-wrap text-xs">
                          {r.content}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400">
                      {r.contact ? (
                        <span className="font-mono" title={r.contact}>{truncate(r.contact, 20)}</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge className={`border ${sm.className}`}>
                          <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${sm.dot}`} aria-hidden />
                          {sm.label}
                        </Badge>
                        {/* feat-bb-2: 「已回复」徽章 (adminNote 非空, 本地缓存) */}
                        {repliedCache.has(r.id) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-[10px] text-violet-300">
                                <MessageSquareReply className="h-2.5 w-2.5" />
                                已回复
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              <div>管理员已添加备注</div>
                              <div className="text-zinc-400">基于本机记录, 打开详情可查看完整备注</div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-zinc-400" title={r.createdAt}>
                      {fmtDateTime(r.createdAt)}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                          onClick={() => openDetail(r)}
                          aria-label="查看详情"
                        >
                          <Eye className="h-3 w-3" />
                          查看
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-red-400/80 hover:text-red-400"
                          onClick={() => setDeleting(r)}
                          aria-label="删除反馈"
                        >
                          <Trash2 className="h-3 w-3" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 分页 */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            第 {page}/{pages} 页 · 共 {total} 条
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* 详情对话框 */}
      <Dialog open={detailOpen} onOpenChange={(v) => { setDetailOpen(v); if (!v) setDetail(null) }}>
        <DialogContent className="border-zinc-700 bg-zinc-900 text-zinc-100 sm:max-w-[min(640px,96vw)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-violet-400" aria-hidden />
              反馈详情
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">
              查看用户提交的完整内容并更新处理状态
            </DialogDescription>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="flex items-center justify-center py-10 text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : (
            <div className="space-y-3">
              {/* 元信息 */}
              <div className="grid grid-cols-2 gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
                <div>
                  <div className="text-zinc-500">类型</div>
                  <div className="mt-0.5">
                    <Badge className={`border ${FEEDBACK_TYPE_META[detail.type]?.className || FEEDBACK_TYPE_META.other.className}`}>
                      {FEEDBACK_TYPE_META[detail.type]?.label || detail.type}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500">联系方式</div>
                  <div className="mt-0.5 font-mono text-zinc-300">{detail.contact || '—'}</div>
                </div>
                <div>
                  <div className="text-zinc-500">提交时间</div>
                  <div className="mt-0.5 text-zinc-300">{fmtDateTime(detail.createdAt)}</div>
                </div>
                <div>
                  <div className="text-zinc-500">来源 IP</div>
                  <div className="mt-0.5 font-mono text-zinc-300">{detail.ip || '—'}</div>
                </div>
                {detail.url && (
                  <div className="col-span-2">
                    <div className="text-zinc-500">页面地址</div>
                    <div className="mt-0.5 truncate font-mono text-zinc-400" title={detail.url}>
                      {detail.url}
                    </div>
                  </div>
                )}
                {detail.userAgent && (
                  <div className="col-span-2">
                    <div className="text-zinc-500">浏览器标识</div>
                    <div className="mt-0.5 line-clamp-2 break-all font-mono text-[10px] text-zinc-500" title={detail.userAgent}>
                      {detail.userAgent}
                    </div>
                  </div>
                )}
              </div>

              {/* 反馈内容 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-300">反馈内容</Label>
                <div className="max-h-48 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-sm leading-relaxed text-zinc-100 whitespace-pre-wrap">
                  {detail.content}
                </div>
              </div>

              {/* 状态选择 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-300">处理状态</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger className="h-9 border-zinc-700 bg-zinc-950 text-sm" aria-label="处理状态">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new" className="text-sm">新</SelectItem>
                    <SelectItem value="read" className="text-sm">已读</SelectItem>
                    <SelectItem value="resolved" className="text-sm">已处理</SelectItem>
                    <SelectItem value="ignored" className="text-sm">已忽略</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 管理员备注 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-300">管理员备注</Label>
                <Textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value.slice(0, 1000))}
                  placeholder="可选, 记录处理过程或后续动作..."
                  className="min-h-20 resize-y border-zinc-700 bg-zinc-950/60 text-sm placeholder:text-zinc-600 focus-visible:border-violet-500 focus-visible:ring-violet-500/30"
                  maxLength={1000}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
              onClick={() => setDetailOpen(false)}
              disabled={saving || !detail}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-violet-600 hover:bg-violet-500"
              onClick={saveDetail}
              disabled={saving || !detail}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => { if (!v) setDeleting(null) }}
        title="删除反馈"
        description={
          deleting ? (
            <>
              确定删除该条反馈吗？删除后不可恢复。
              <br />
              <span className="mt-1 inline-block max-h-20 overflow-y-auto text-zinc-400">
                “{truncate(deleting.content, 80)}”
              </span>
            </>
          ) : (
            '确定删除吗？'
          )
        }
        confirmText="删除"
        confirmDisabled={deleteLoading}
        loading={deleteLoading}
        onConfirm={doDelete}
      />
    </div>
  )
}
