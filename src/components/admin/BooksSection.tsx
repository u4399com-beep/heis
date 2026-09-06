'use client'

// ============================================================
// 书籍管理区块 — 搜索/筛选/分页表格 + 重采/删除确认 + 手动新增
// 批量操作: 全选/行复选框 + 删除/设分类/设状态/批量重采/繁转简
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { BookDetail } from './BookDetail'
import {
  BatchActionButton,
  BatchBar,
  BatchCheckbox,
  runBatch,
  useBatchSelection,
  type BatchOutcome,
} from './batch'
import {
  api,
  BOOK_STATUS_META,
  coverUrl,
  fmtDateTime,
  fmtNum,
  fmtWords,
  type BookListRow,
  type CategoryRow,
} from './helpers'

interface BooksSectionProps {
  /** 跳转到下载区块并预选书籍 */
  onGoDownload: (bookId: string) => void
}

export function BooksSection({ onGoDownload }: BooksSectionProps) {
  const [rows, setRows] = useState<BookListRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('all')
  const [categories, setCategories] = useState<CategoryRow[]>([])

  const [detailId, setDetailId] = useState<string | null>(null)
  const [recrawlBook, setRecrawlBook] = useState<{ book: BookListRow; mode: 'full' | 'incremental' } | null>(null)
  const [deleting, setDeleting] = useState<BookListRow | null>(null)
  const [creating, setCreating] = useState(false)

  // ---- 批量操作状态(跨页保留已选) ----
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows])
  const batch = useBatchSelection(rowIds)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchConfirm, setBatchConfirm] = useState<'' | 'delete' | 'recrawl' | 't2s'>('')
  const [batchRecrawlMode, setBatchRecrawlMode] = useState<'full' | 'incremental'>('incremental')
  // 下拉动作选择展示值(触发后复位回 placeholder, 防止残留显示被误认为已生效状态)
  const [batchCategoryPick, setBatchCategoryPick] = useState('')
  const [batchStatusPick, setBatchStatusPick] = useState('')
  const [batchRecrawlPick, setBatchRecrawlPick] = useState('')

  const SIZE = 20
  const seqRef = useRef(0)
  const aliveRef = useRef(true)

  // 卸载后停止异步 setState
  useEffect(() => {
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 搜索防抖: 避免每次按键都发请求, 同时降低旧响应覆盖新结果的概率
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300)
    return () => clearTimeout(t)
  }, [qInput])

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    try {
      const data = await api.get<{ total: number; books: BookListRow[] }>('/api/admin/books', {
        page,
        size: SIZE,
        q: q.trim() || undefined,
        categoryId: categoryId || undefined,
        status: status === 'all' ? undefined : status,
      })
      if (!aliveRef.current || seq !== seqRef.current) return
      const books = data.books || []
      const totalCount = data.total || 0
      // 数据收缩(删除/筛选)导致当前页越界时, 回退到最后一页
      const maxPage = Math.max(1, Math.ceil(totalCount / SIZE))
      if (books.length === 0 && page > maxPage) {
        setPage(maxPage)
        return
      }
      setRows(books)
      setTotal(totalCount)
    } catch (e) {
      if (aliveRef.current && seq === seqRef.current) toast.error(e instanceof Error ? e.message : '加载书籍失败')
    } finally {
      if (aliveRef.current && seq === seqRef.current) setLoading(false)
    }
  }, [page, q, categoryId, status])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    api.get<CategoryRow[]>('/api/admin/categories').then((cs) => setCategories(Array.isArray(cs) ? cs : [])).catch(() => setCategories([]))
  }, [])

  const doRecrawl = async () => {
    if (!recrawlBook) return
    try {
      const task = await api.post<{ id: string; name: string }>(`/api/admin/books/${recrawlBook.book.id}/recrawl`, { mode: recrawlBook.mode })
      toast.success(`重采任务「${task.name}」已创建并启动, 可在采集任务区监控`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建重采任务失败')
    } finally {
      setRecrawlBook(null)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/api/admin/books/${deleting.id}`)
      toast.success(`书籍「${deleting.name}」已删除`)
      setDeleting(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  // ---- 批量动作: 统一走 runBatch(成功→清选+刷新; 失败→已 toast, 保持现场) ----
  const runBooksBatch = async (body: Record<string, unknown>, describe: (r: BatchOutcome) => string) => {
    setBatchRunning(true)
    try {
      const res = await runBatch('/api/admin/books/batch', { ids: batch.selectedOrdered, ...body }, describe)
      if (res) {
        batch.clearSelection()
        load()
      }
    } finally {
      setBatchRunning(false)
    }
  }

  const doBatchDelete = () => {
    setBatchConfirm('')
    void runBooksBatch({ action: 'delete' }, (r) => `已删除 ${r.affected ?? 0} 本书籍及其章节/标签/下载记录`)
  }

  const doBatchCategory = (categoryId: string) => {
    setBatchCategoryPick('')
    void runBooksBatch(
      { action: 'category', payload: { categoryId } },
      (r) => (categoryId ? `已将 ${r.affected ?? 0} 本书籍移入所选分类` : `已将 ${r.affected ?? 0} 本书籍设为未分类`)
    )
  }

  const doBatchStatus = (st: string) => {
    setBatchStatusPick('')
    void runBooksBatch({ action: 'status', payload: { status: st } }, (r) => `已更新 ${r.affected ?? 0} 本书籍的连载状态`)
  }

  const doBatchRecrawl = () => {
    setBatchConfirm('')
    setBatchRecrawlPick('')
    void runBooksBatch(
      { action: 'recrawl', payload: { mode: batchRecrawlMode } },
      (r) => `已为 ${r.affected ?? 0} 本书籍创建${batchRecrawlMode === 'full' ? '完全覆盖' : '增量更新'}重采任务并启动`
    )
  }

  const doBatchT2s = () => {
    setBatchConfirm('')
    void runBooksBatch({ action: 't2s' }, (r) =>
      r.noop
        ? '所选书籍内容均为简体, 未发生任何转换'
        : `繁转简完成: 更新 ${r.affected ?? 0} 本书籍 / ${r.chapters ?? 0} 个章节${r.txtFailed ? `, ${r.txtFailed} 个 TXT 章节读写失败` : ''}`
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / SIZE))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <BookMarked className="h-5 w-5 text-violet-400" />
            书籍管理
            <span className="text-xs font-normal text-zinc-500">(共 {fmtNum(total)} 本)</span>
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">支持增量补新 / 完全覆盖重采 / 一键生成TXT成品</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              className="h-9 w-44 border-zinc-700 bg-zinc-950 pl-8 text-sm"
              placeholder="书名 / 作者…"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <Select
            value={categoryId || 'all'}
            onValueChange={(v) => {
              setCategoryId(v === 'all' ? '' : v)
              setPage(1)
            }}
          >
            <SelectTrigger className="h-9 w-32 border-zinc-700 bg-zinc-950 text-sm">
              <SelectValue placeholder="全部分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-sm">全部分类</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-sm">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="h-9 w-28 border-zinc-700 bg-zinc-950 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-sm">全部状态</SelectItem>
              <SelectItem value="ongoing" className="text-sm">连载中</SelectItem>
              <SelectItem value="completed" className="text-sm">已完结</SelectItem>
              <SelectItem value="unknown" className="text-sm">未知</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            手动新增
          </Button>
        </div>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-0">
          {/* 批量操作条(已选>0 时出现, 跨页保留) */}
          <BatchBar count={batch.selectedCount} onClear={batch.clearSelection} hint="翻页/刷新后保留已选">
            <BatchActionButton
              running={batchRunning}
              className="text-red-400 hover:text-red-300"
              onClick={() => setBatchConfirm('delete')}
            >
              <Trash2 className="h-3 w-3" />
              删除
            </BatchActionButton>
            <Select value={batchCategoryPick} onValueChange={(v) => { setBatchCategoryPick(v); doBatchCategory(v === '__clear__' ? '' : v) }}>
              <SelectTrigger className="h-7 w-28 border-zinc-700 bg-zinc-950 text-xs">
                <SelectValue placeholder="设为分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear__" className="text-xs">未分类</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={batchStatusPick} onValueChange={(v) => { setBatchStatusPick(v); doBatchStatus(v) }}>
              <SelectTrigger className="h-7 w-24 border-zinc-700 bg-zinc-950 text-xs">
                <SelectValue placeholder="设为状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ongoing" className="text-xs">连载中</SelectItem>
                <SelectItem value="completed" className="text-xs">已完结</SelectItem>
                <SelectItem value="unknown" className="text-xs">未知</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={batchRecrawlPick}
              onValueChange={(v) => {
                setBatchRecrawlPick(v)
                setBatchRecrawlMode(v === 'full' ? 'full' : 'incremental')
                setBatchConfirm('recrawl')
              }}
            >
              <SelectTrigger className="h-7 w-24 border-zinc-700 bg-zinc-950 text-xs">
                <SelectValue placeholder="批量重采" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="incremental" className="text-xs">增量更新</SelectItem>
                <SelectItem value="full" className="text-xs text-red-400">完全覆盖</SelectItem>
              </SelectContent>
            </Select>
            <BatchActionButton
              running={batchRunning}
              className="text-amber-400 hover:text-amber-300"
              onClick={() => setBatchConfirm('t2s')}
              title="存量繁体内容转简体(书名字段+章节标题/正文)"
            >
              繁转简
            </BatchActionButton>
          </BatchBar>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载书籍…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500">没有符合条件的书籍</div>
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
                        ariaLabel="全选本页书籍"
                      />
                    </TableHead>
                    <TableHead className="text-xs text-zinc-500">书籍</TableHead>
                    <TableHead className="text-xs text-zinc-500">作者</TableHead>
                    <TableHead className="hidden text-xs text-zinc-500 md:table-cell">分类</TableHead>
                    <TableHead className="text-xs text-zinc-500">状态</TableHead>
                    <TableHead className="hidden text-xs text-zinc-500 sm:table-cell">章节</TableHead>
                    <TableHead className="hidden text-xs text-zinc-500 sm:table-cell">字数</TableHead>
                    <TableHead className="hidden text-xs text-zinc-500 lg:table-cell">更新时间</TableHead>
                    <TableHead className="text-right text-xs text-zinc-500">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => {
                    const meta = BOOK_STATUS_META[b.status] || BOOK_STATUS_META.unknown
                    return (
                      <TableRow key={b.id} className="border-zinc-800/70">
                        <TableCell className="pr-0">
                          <BatchCheckbox
                            checked={batch.selected.has(b.id)}
                            onCheckedChange={() => batch.toggle(b.id)}
                            ariaLabel={`选择《${b.name}》`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-[53px] w-10 shrink-0 overflow-hidden rounded border border-zinc-800 bg-zinc-950">
                              {b.cover ? (
                                <img src={coverUrl(b.cover)} alt={b.name} className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">无封面</div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="max-w-[200px] truncate font-medium text-zinc-200" title={b.name}>
                                {b.name}
                              </div>
                              {b.latestChapter && (
                                <div className="max-w-[200px] truncate text-[11px] text-zinc-500" title={b.latestChapter}>
                                  {b.latestChapter}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-400">{b.author}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-xs text-zinc-400">
                            {b.category?.name || '未分类'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}>{meta.label}</span>
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs text-zinc-400 sm:table-cell">{fmtNum(b._count?.chapters || 0)}</TableCell>
                        <TableCell className="hidden font-mono text-xs text-zinc-400 sm:table-cell">{fmtWords(b.wordCount)}</TableCell>
                        <TableCell className="hidden text-xs text-zinc-500 lg:table-cell">{fmtDateTime(b.updatedAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-0.5">
                            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-violet-400 hover:text-violet-300" onClick={() => setDetailId(b.id)}>
                              <Eye className="h-3 w-3" />
                              详情
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs text-teal-400 hover:text-teal-300"
                              onClick={() => setRecrawlBook({ book: b, mode: 'incremental' })}
                            >
                              <RefreshCw className="h-3 w-3" />
                              增量
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs text-amber-400 hover:text-amber-300"
                              onClick={() => setRecrawlBook({ book: b, mode: 'full' })}
                            >
                              <Layers className="h-3 w-3" />
                              覆盖
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-emerald-400 hover:text-emerald-300" onClick={() => onGoDownload(b.id)}>
                              <Download className="h-3 w-3" />
                              TXT
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400/80 hover:text-red-400" onClick={() => setDeleting(b)}>
                              <Trash2 className="h-3.5 w-3.5" />
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
          <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2.5">
            <span className="text-xs text-zinc-500">
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0 border-zinc-700 bg-zinc-900 text-zinc-300"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0 border-zinc-700 bg-zinc-900 text-zinc-300"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <BookDetail bookId={detailId} onClose={() => setDetailId(null)} onChanged={load} />

      {/* 重采确认 */}
      <ConfirmDialog
        open={!!recrawlBook}
        onOpenChange={(v) => !v && setRecrawlBook(null)}
        title={recrawlBook?.mode === 'full' ? '确认完全覆盖重采集?' : '确认增量更新?'}
        description={
          recrawlBook?.mode === 'full' ? (
            <>
              将为《{recrawlBook?.book.name}》
              <span className="text-red-400">清空并重建全部章节数据</span>, 旧内容不可恢复。任务会立即启动。
            </>
          ) : (
            <>将为《{recrawlBook?.book.name}》创建增量更新任务, 仅补充新章节, 已有章节不受影响。任务会立即启动。</>
          )
        }
        tone={recrawlBook?.mode === 'full' ? 'danger' : 'teal'}
        onConfirm={doRecrawl}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="确认删除书籍?"
        description={`将删除《${deleting?.name}》及其全部章节与关键词数据, 该操作不可恢复。`}
        confirmText="删除"
        onConfirm={doDelete}
      />

      {/* 批量删除确认 */}
      <ConfirmDialog
        open={batchConfirm === 'delete'}
        onOpenChange={(v) => !v && setBatchConfirm('')}
        title={`确认批量删除 ${batch.selectedCount} 本书籍?`}
        description="将删除所选书籍及其全部章节、标签与下载记录(含 TXT 文件), 该操作不可恢复。"
        confirmText="删除"
        onConfirm={doBatchDelete}
      />

      {/* 批量重采确认 */}
      <ConfirmDialog
        open={batchConfirm === 'recrawl'}
        onOpenChange={(v) => !v && setBatchConfirm('')}
        title={`确认为 ${batch.selectedCount} 本书籍批量重采?`}
        description={
          <>
            将逐本创建{batchRecrawlMode === 'full' ? '完全覆盖' : '增量更新'}重采任务并立即启动, 可在采集任务区监控。
            {batchRecrawlMode === 'full' && (
              <>
                完全覆盖会<span className="text-red-400">清空并重建全部章节数据</span>, 旧内容不可恢复。
              </>
            )}
          </>
        }
        tone={batchRecrawlMode === 'full' ? 'danger' : 'teal'}
        onConfirm={doBatchRecrawl}
      />

      {/* 批量繁转简确认 */}
      <ConfirmDialog
        open={batchConfirm === 't2s'}
        onOpenChange={(v) => !v && setBatchConfirm('')}
        title={`确认对 ${batch.selectedCount} 本书籍执行繁转简?`}
        description={
          <>
            将逐本转换书名/作者/简介/关键词/最新章节及章节标题与正文, txt 存储章节同步定点重写文件。
            转换为同步处理, 章节量大时可能耗时数分钟, 期间请勿关闭页面。单批最多 50 本。
          </>
        }
        tone="amber"
        confirmText="开始转换"
        onConfirm={doBatchT2s}
      />

      <CreateBookDialog open={creating} onOpenChange={setCreating} onSaved={load} categories={categories} />
    </div>
  )
}

// ---------------- 手动新增书籍 ----------------
function CreateBookDialog({
  open,
  onOpenChange,
  onSaved,
  categories,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
  categories: CategoryRow[]
}) {
  const [form, setForm] = useState({ name: '', author: '', intro: '', cover: '', keywords: '', categoryName: '', storageMode: 'db' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm({ name: '', author: '', intro: '', cover: '', keywords: '', categoryName: '', storageMode: 'db' })
  }, [open])

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('书名必填')
      return
    }
    setSaving(true)
    try {
      await api.post('/api/admin/books', { ...form, name: form.name.trim() })
      toast.success('书籍已创建')
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scroll max-h-[90vh] sm:max-w-[min(560px,96vw)] overflow-y-auto border-zinc-800 bg-zinc-900">
        <DialogHeader>
          <DialogTitle className="text-base text-zinc-100">手动新增书籍</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">手工录入的书籍可立即用于 TXT 生成或前台展示</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">书名 *</Label>
            <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">作者</Label>
            <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="佚名" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">分类</Label>
            <Input
              className="h-9 border-zinc-700 bg-zinc-950 text-sm"
              list="admin-category-options"
              value={form.categoryName}
              onChange={(e) => setForm({ ...form, categoryName: e.target.value })}
              placeholder="输入或选择分类名"
            />
            <datalist id="admin-category-options">
              {categories.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">关键词</Label>
            <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="逗号分隔" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">封面 URL</Label>
            <Input className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs" value={form.cover} onChange={(e) => setForm({ ...form, cover: e.target.value })} placeholder="https://…" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">存储模式</Label>
            <div className="flex h-9 items-center justify-between rounded-md border border-zinc-700 bg-zinc-950 px-3">
              <span className="text-xs text-zinc-400">{form.storageMode === 'txt' ? '生成 TXT 文件' : '写入数据库'}</span>
              <Switch checked={form.storageMode === 'txt'} onCheckedChange={(v) => setForm({ ...form, storageMode: v ? 'txt' : 'db' })} />
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-zinc-400">简介</Label>
            <Textarea className="admin-scroll max-h-32 min-h-20 border-zinc-700 bg-zinc-950 text-sm" value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
