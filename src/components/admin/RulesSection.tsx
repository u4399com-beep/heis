'use client'

// ============================================================
// 采集规则区块 — 列表 / 新建 / 编辑 / 复制 / 删除 / 启用开关
// 批量操作: 全选/行复选框 + 批量删除(整批原子, 被任务引用则 409)
// 极限校准: 每行「校准」入口 + 工具栏「全量校准」(CalibrateDialog, zz-c)
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from './ConfirmDialog'
import { Copy, FileCode2, Gauge, Activity, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { RuleEditor } from './RuleEditor'
import { CalibrateAllDialog, CalibrateDialog } from './CalibrateDialog'
import {
  BatchActionButton,
  BatchBar,
  BatchCheckbox,
  runBatch,
  useBatchSelection,
} from './batch'
import { api, fmtDateTime, safeJsonParse, parseRuleConfig, type RuleConfig, type RuleRow } from './helpers'

export function RulesSection() {
  const [rows, setRows] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<RuleRow | null>(null)
  const [deleting, setDeleting] = useState<RuleRow | null>(null)
  // ---- 极限校准(zz-c): 单规则对话框 + 全量校准对话框 ----
  const [calibrating, setCalibrating] = useState<RuleRow | null>(null)
  const [calibrateAllOpen, setCalibrateAllOpen] = useState(false)

  // ---- 批量操作状态(按当前筛选结果多选) ----
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<RuleRow[]>('/api/admin/rules')
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载规则失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleEnabled = async (row: RuleRow, enabled: boolean) => {
    try {
      await api.put(`/api/admin/rules/${row.id}`, { enabled })
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, enabled } : r)))
      toast.success(enabled ? `规则「${row.name}」已启用` : `规则「${row.name}」已停用`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const copyRule = async (row: RuleRow) => {
    try {
      await api.post('/api/admin/rules', {
        name: `${row.name} (副本)`,
        description: row.description,
        // 旧格式/损坏 JSON 兜底为默认配置, 复制不再失败
        config: safeJsonParse<RuleConfig>(row.config, parseRuleConfig(null)),
      })
      toast.success('规则已复制')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '复制失败')
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/api/admin/rules/${deleting.id}`)
      toast.success(`规则「${deleting.name}」已删除`)
      setDeleting(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const filtered = rows.filter(
    (r) =>
      !keyword.trim() ||
      r.name.toLowerCase().includes(keyword.toLowerCase()) ||
      (r.description || '').toLowerCase().includes(keyword.toLowerCase()),
  )

  // ---- 批量删除(整批原子: 任一规则被任务引用服务端整批 409 拒绝) ----
  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered])
  const batch = useBatchSelection(filteredIds)

  const doBatchDelete = () => {
    setBatchConfirmOpen(false)
    setBatchRunning(true)
    void (async () => {
      try {
        const res = await runBatch('/api/admin/rules/batch', { action: 'delete', ids: batch.selectedOrdered }, (r) => `已删除 ${r.affected ?? 0} 条采集规则`)
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
            <FileCode2 className="h-5 w-5 text-violet-400" />
            采集规则
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">配置列表页 / 书籍页 / 目录页 / 内容页四段采集逻辑, 支持试采验证</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="h-9 w-48 border-zinc-700 bg-zinc-950 text-sm"
            placeholder="搜索规则…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            onClick={() => setCalibrateAllOpen(true)}
          >
            <Activity className="h-3.5 w-3.5" />
            全量校准
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              setEditing(null)
              setEditorOpen(true)
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            新建规则
          </Button>
        </div>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-0">
          {/* 批量操作条(已选>0 时出现) */}
          <BatchBar count={batch.selectedCount} onClear={batch.clearSelection} hint="任一规则被任务引用时整批拒绝">
            <BatchActionButton
              running={batchRunning}
              className="text-red-400 hover:text-red-300"
              onClick={() => setBatchConfirmOpen(true)}
            >
              <Trash2 className="h-3 w-3" />
              删除
            </BatchActionButton>
          </BatchBar>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载规则…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500">
              {rows.length === 0 ? '暂无采集规则, 点击右上角「新建规则」开始配置' : '没有匹配的规则'}
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
                      ariaLabel="全选本页规则"
                    />
                  </TableHead>
                  <TableHead className="text-xs text-zinc-500">名称</TableHead>
                  <TableHead className="text-xs text-zinc-500">描述</TableHead>
                  <TableHead className="hidden text-xs text-zinc-500 md:table-cell">状态</TableHead>
                  <TableHead className="hidden text-xs text-zinc-500 lg:table-cell">更新时间</TableHead>
                  <TableHead className="text-right text-xs text-zinc-500">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="border-zinc-800/70">
                    <TableCell className="pr-0">
                      <BatchCheckbox
                        checked={batch.selected.has(r.id)}
                        onCheckedChange={() => batch.toggle(r.id)}
                        ariaLabel={`选择规则「${r.name}」`}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-zinc-200">{r.name}</TableCell>
                    <TableCell className="max-w-[320px] truncate text-xs text-zinc-500" title={r.description || ''}>
                      {r.description || '-'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Switch checked={r.enabled} onCheckedChange={(v) => toggleEnabled(r, v)} />
                    </TableCell>
                    <TableCell className="hidden text-xs text-zinc-500 lg:table-cell">{fmtDateTime(r.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                          onClick={() => {
                            setEditing(r)
                            setEditorOpen(true)
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                          onClick={() => setCalibrating(r)}
                        >
                          <Gauge className="h-3 w-3" />
                          校准
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                          onClick={() => copyRule(r)}
                        >
                          <Copy className="h-3 w-3" />
                          复制
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-red-400/80 hover:text-red-400"
                          onClick={() => setDeleting(r)}
                        >
                          <Trash2 className="h-3 w-3" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RuleEditor open={editorOpen} onOpenChange={setEditorOpen} rule={editing} onSaved={load} />

      {/* 极限校准(zz-c): 打开时对话框自行 GET 恢复历史状态; running 时关闭不中断后台校准 */}
      <CalibrateDialog
        open={!!calibrating}
        onOpenChange={(v) => {
          if (!v) setCalibrating(null)
        }}
        rule={calibrating}
      />
      <CalibrateAllDialog open={calibrateAllOpen} onOpenChange={setCalibrateAllOpen} />

      {/* 批量删除确认 */}
      <ConfirmDialog
        open={batchConfirmOpen}
        onOpenChange={setBatchConfirmOpen}
        title={`确认批量删除 ${batch.selectedCount} 条规则?`}
        description="将删除所选采集规则, 该操作不可恢复。若任一规则仍被采集任务引用, 整批将被拒绝(409), 不会出现部分删除。"
        confirmText="删除"
        onConfirm={doBatchDelete}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="确认删除规则?"
        description={`将删除规则「${deleting?.name}」, 该操作不可恢复。已引用该规则的采集任务不受影响, 但无法再启动。`}
        confirmText="删除"
        onConfirm={doDelete}
      />
    </div>
  )
}
