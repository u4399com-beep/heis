'use client'

// ============================================================
// 分类管理 — 简单 CRUD
// 批量操作: 全选/行复选框 + 批量删除(强制删除勾选) + 按勾选顺序重排
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ConfirmDialog } from './ConfirmDialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FolderTree, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  BatchActionButton,
  BatchBar,
  BatchCheckbox,
  runBatch,
  useBatchSelection,
} from './batch'
import { api, fmtDateTime, type CategoryRow } from './helpers'

export function CategoriesSection() {
  const [rows, setRows] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CategoryRow | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<CategoryRow | null>(null)

  // ---- 批量操作状态(selectedOrdered 保序 — 重排依赖勾选顺序) ----
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows])
  const batch = useBatchSelection(rowIds)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const [batchForce, setBatchForce] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<CategoryRow[]>('/api/admin/categories')
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载分类失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setName('')
    setDialogOpen(true)
  }

  const openEdit = (row: CategoryRow) => {
    setEditing(row)
    setName(row.name)
    setDialogOpen(true)
  }

  const save = async () => {
    if (!name.trim()) {
      toast.error('请输入分类名称')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/api/admin/categories/${editing.id}`, { name: name.trim() })
        toast.success('分类已更新')
      } else {
        await api.post('/api/admin/categories', { name: name.trim() })
        toast.success('分类已创建')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/api/admin/categories/${deleting.id}`)
      toast.success(`分类「${deleting.name}」已删除`)
      setDeleting(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  // ---- 批量删除: force=false 有书 409 附各分类本书数; force=true 事务摘书+删类 ----
  const doBatchDelete = () => {
    setBatchConfirmOpen(false)
    setBatchRunning(true)
    void (async () => {
      try {
        const res = await runBatch(
          '/api/admin/categories/batch',
          { action: 'delete', ids: batch.selectedOrdered, payload: { force: batchForce } },
          (r) =>
            r.booksDetached
              ? `已删除 ${r.affected ?? 0} 个分类, ${r.booksDetached} 本书籍已移出分类(变为未分类)`
              : `已删除 ${r.affected ?? 0} 个分类`
        )
        if (res) {
          batch.clearSelection()
          load()
        }
      } finally {
        setBatchRunning(false)
      }
    })()
  }

  // ---- 按勾选顺序重排: ids 即目标顺序, 整体预检 + 事务按下标写 sortOrder ----
  const doBatchOrder = () => {
    setBatchRunning(true)
    void (async () => {
      try {
        const res = await runBatch(
          '/api/admin/categories/batch',
          { action: 'order', ids: batch.selectedOrdered },
          (r) => `已按勾选顺序重排 ${r.affected ?? 0} 个分类`
        )
        if (res) {
          batch.clearSelection()
          load()
        }
      } finally {
        setBatchRunning(false)
      }
    })()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <FolderTree className="h-5 w-5 text-violet-400" />
            分类管理
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">书籍分类字典, 采集时智能分类会自动归类到这里</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            新建分类
          </Button>
        </div>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-0">
          {/* 批量操作条(已选>0 时出现) */}
          <BatchBar count={batch.selectedCount} onClear={batch.clearSelection} hint="重排按勾选先后顺序">
            <BatchActionButton
              running={batchRunning}
              className="text-red-400 hover:text-red-300"
              onClick={() => {
                setBatchForce(false)
                setBatchConfirmOpen(true)
              }}
            >
              <Trash2 className="h-3 w-3" />
              删除
            </BatchActionButton>
            <BatchActionButton
              running={batchRunning}
              className="text-violet-400 hover:text-violet-300"
              onClick={doBatchOrder}
              title="按勾选先后顺序重新排序(从上到下)"
            >
              按勾选顺序重排
            </BatchActionButton>
          </BatchBar>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="w-9 pr-0">
                    <BatchCheckbox
                      checked={batch.allSelected}
                      indeterminate={batch.indeterminate}
                      onCheckedChange={batch.toggleAll}
                      ariaLabel="全选分类"
                    />
                  </TableHead>
                  <TableHead className="text-xs text-zinc-500">分类名称</TableHead>
                  <TableHead className="text-xs text-zinc-500">书籍数量</TableHead>
                  <TableHead className="hidden text-xs text-zinc-500 md:table-cell">创建时间</TableHead>
                  <TableHead className="text-right text-xs text-zinc-500">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow className="border-zinc-800/70">
                    <TableCell colSpan={5} className="py-12 text-center text-sm text-zinc-500">
                      暂无分类, 点击右上角「新建分类」添加
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((c) => (
                    <TableRow key={c.id} className="border-zinc-800/70">
                      <TableCell className="pr-0">
                        <BatchCheckbox
                          checked={batch.selected.has(c.id)}
                          onCheckedChange={() => batch.toggle(c.id)}
                          ariaLabel={`选择分类「${c.name}」`}
                        />
                      </TableCell>
                      <TableCell className="font-medium text-zinc-200">{c.name}</TableCell>
                      <TableCell className="font-mono text-xs text-zinc-400">{c._count?.books || 0}</TableCell>
                      <TableCell className="hidden text-xs text-zinc-500 md:table-cell">{fmtDateTime(c.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100" onClick={() => openEdit(c)}>
                            <Pencil className="h-3 w-3" />
                            编辑
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-red-400/80 hover:text-red-400" onClick={() => setDeleting(c)}>
                            <Trash2 className="h-3 w-3" />
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[min(420px,96vw)] border-zinc-800 bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="text-base text-zinc-100">{editing ? '编辑分类' : '新建分类'}</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">分类名称全局唯一</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">名称 *</Label>
            <Input
              className="h-9 border-zinc-700 bg-zinc-950 text-sm"
              placeholder="例: 玄幻奇幻"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !saving && save()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除确认(含强制删除勾选) — 保留原样不迁移 ConfirmDialog: 描述区内嵌交互控件 BatchCheckbox
          + space-y-2 布局变体 + 强制删除条件文案, 属非纯确认框形态(ss-c 逐处甄别留置, 见 worklog) */}
      <AlertDialog
        open={batchConfirmOpen}
        onOpenChange={(v) => {
          if (!v) {
            setBatchConfirmOpen(false)
            setBatchForce(false)
          }
        }}
      >
        <AlertDialogContent className="border-zinc-800 bg-zinc-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">确认批量删除 {batch.selectedCount} 个分类?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-zinc-400">
              <span className="block">
                将删除所选分类, 该操作不可恢复。若分类下仍有书籍, 默认整批拒绝(409)并提示各分类本书数。
              </span>
              <span className="flex items-center gap-2 text-xs">
                <BatchCheckbox checked={batchForce} onCheckedChange={setBatchForce} ariaLabel="强制删除" />
                强制删除: 事务内先将书籍移出分类(变为未分类)再删除分类
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800">取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={doBatchDelete}>
              {batchForce ? '强制删除' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="确认删除分类?"
        description={
          <>
            将删除分类「{deleting?.name}」
            {(deleting?._count?.books || 0) > 0 ? (
              <>
                。该分类下仍有 <span className="text-amber-400">{deleting?._count?.books}</span> 本书籍, 请先转移再删除。
              </>
            ) : (
              '。'
            )}
          </>
        }
        confirmText="删除"
        onConfirm={doDelete}
      />
    </div>
  )
}
