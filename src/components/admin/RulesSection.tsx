'use client'

// ============================================================
// 采集规则区块 — 列表 / 新建 / 编辑 / 复制 / 删除 / 启用开关
// 批量操作: 全选/行复选框 + 批量删除(整批原子, 被任务引用则 409)
// 极限校准(zz-c): 每行「校准」入口 + 工具栏「全量校准」(CalibrateDialog)
// 导入/导出: JSON 文件下载 / 上传解析后逐条 POST (feat-round-6)
// 复制增强: 复制后滚动到新行并高亮闪烁 (feat-round-6)
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from './ConfirmDialog'
import { Copy, Download, FileCode2, Gauge, Activity, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
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

// ---- 导入规则条目形态 (导出/导入共用) ----
interface RuleImportItem {
  name: string
  description: string
  config: unknown // 对象或 JSON 字符串
  enabled: boolean
}

const FLASH_STYLE = `
@keyframes heis-rule-flash {
  0% { background-color: rgb(139 92 246 / 0.35); }
  100% { background-color: transparent; }
}
.heis-rule-flash { animation: heis-rule-flash 1.6s ease-out; }
`

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

  // ---- 导入/导出 (feat-round-6) ----
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = useState(false)
  const [pendingImport, setPendingImport] = useState<RuleImportItem[] | null>(null)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)

  // ---- 复制后高亮闪烁 (feat-round-6) ----
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // feat-round-6: 卸载时清掉闪烁定时器, 避免设置已卸载组件状态
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

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
      const created = await api.post<{ id: string }>('/api/admin/rules', {
        name: `${row.name} (副本)`,
        description: row.description,
        // 旧格式/损坏 JSON 兜底为默认配置, 复制不再失败
        config: safeJsonParse<RuleConfig>(row.config, parseRuleConfig(null)),
      })
      toast.success('规则已复制')
      await load()
      // feat-round-6: 滚动到新行 + 高亮闪烁
      setFlashId(created.id)
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-rule-id="${created.id}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      })
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      flashTimerRef.current = setTimeout(() => setFlashId(null), 1800)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '复制失败')
    }
  }

  // ---- feat-round-6: 导出规则 (选中 > 0 则导出选中, 否则导出全部已启用) ----
  const exportRules = () => {
    const selectedRows = batch.selected.size > 0 ? rows.filter((r) => batch.selected.has(r.id)) : rows.filter((r) => r.enabled)
    if (selectedRows.length === 0) {
      toast.error('没有可导出的规则 (无选中且无已启用规则)')
      return
    }
    const payload = selectedRows.map((r) => {
      let configVal: unknown = r.config
      try {
        configVal = JSON.parse(r.config)
      } catch {
        // 保留原始字符串 (容错: 损坏 JSON 不阻断导出)
      }
      return {
        name: r.name,
        description: r.description || '',
        config: configVal,
        enabled: r.enabled,
      } satisfies RuleImportItem
    })
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
    const filename = `heis-rules-${stamp}.json`
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${payload.length} 条规则 → ${filename}`)
  }

  // ---- feat-round-6: 导入规则 (文件选择 → 校验 → 确认 → 逐条 POST) ----
  const onPickImportFile = () => fileInputRef.current?.click()

  const onImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 清空 input.value 以便下次能选同一文件
    e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('文件过大 (>5MB), 请检查是否选错文件')
      return
    }
    try {
      const text = await file.text()
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        toast.error('JSON 解析失败, 请检查文件格式')
        return
      }
      const validation = validateImport(data)
      if (!validation.ok) {
        toast.error(validation.error)
        return
      }
      // 去重命名: 与现有 rows 同名 → 追加 " (导入)" 后缀
      const existingNames = new Set(rows.map((r) => r.name))
      const seen = new Set<string>()
      const prepared: RuleImportItem[] = validation.rules.map((r) => {
        let name = r.name
        if (existingNames.has(name) || seen.has(name)) {
          name = `${r.name} (导入)`
          let i = 2
          while (existingNames.has(name) || seen.has(name)) {
            name = `${r.name} (导入${i})`
            i++
          }
        }
        seen.add(name)
        return { ...r, name }
      })
      // N > 5 需确认
      if (prepared.length > 5) {
        setPendingImport(prepared)
        setImportConfirmOpen(true)
      } else {
        void runImport(prepared)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '读取文件失败')
    }
  }

  const runImport = async (items: RuleImportItem[]) => {
    setImporting(true)
    const total = items.length
    const tid = toast.loading(`导入中 0/${total}…`)
    let ok = 0
    let fail = 0
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      try {
        await api.post('/api/admin/rules', it)
        ok++
      } catch (e) {
        fail++
        toast.error(`规则「${it.name}」导入失败: ${e instanceof Error ? e.message : '未知错误'}`)
      }
      toast.loading(`导入中 ${i + 1}/${total}…`, { id: tid })
    }
    if (fail === 0) {
      toast.success(`成功导入 ${ok} 条规则`, { id: tid })
    } else {
      toast.warning(`导入完成: 成功 ${ok} / 失败 ${fail}`, { id: tid })
    }
    setImporting(false)
    await load()
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
      <style dangerouslySetInnerHTML={{ __html: FLASH_STYLE }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <FileCode2 className="h-5 w-5 text-violet-400" />
            采集规则
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">配置列表页 / 书籍页 / 目录页 / 内容页四段采集逻辑, 支持试采验证</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-9 w-48 border-zinc-700 bg-zinc-950 text-sm"
            placeholder="搜索规则…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            onClick={onPickImportFile}
            disabled={importing}
            title="从 JSON 文件导入规则"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            导入
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            onClick={exportRules}
            title="导出选中规则(无选中则导出全部已启用)"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </Button>
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
      {/* 隐藏的导入文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={onImportFileChange}
      />

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
                  <TableRow
                    key={r.id}
                    data-rule-id={r.id}
                    className={`border-zinc-800/70 ${flashId === r.id ? 'heis-rule-flash' : ''}`}
                  >
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

      {/* 导入确认 (>5 条时弹出) */}
      <ConfirmDialog
        open={importConfirmOpen}
        onOpenChange={(v) => {
          setImportConfirmOpen(v)
          if (!v) setPendingImport(null)
        }}
        title={`将导入 ${pendingImport?.length ?? 0} 条规则, 是否继续?`}
        description="将逐条创建采集规则 (重名自动追加「(导入)」后缀)。导入过程中单条失败不会中断其余, 完成后会汇报成功/失败数。"
        confirmText="开始导入"
        tone="teal"
        loading={importing}
        onConfirm={() => {
          if (pendingImport) {
            setImportConfirmOpen(false)
            void runImport(pendingImport)
          } else {
            setImportConfirmOpen(false)
          }
        }}
      />
    </div>
  )
}

// ---- feat-round-6: 导入文件校验 ----
function validateImport(data: unknown): { ok: true; rules: RuleImportItem[] } | { ok: false; error: string } {
  if (!Array.isArray(data)) return { ok: false, error: '导入文件应为 JSON 数组' }
  if (data.length === 0) return { ok: false, error: '导入文件为空' }
  if (data.length > 200) return { ok: false, error: '导入规则数量过多 (>200), 请分批导入' }
  const rules: RuleImportItem[] = []
  for (let i = 0; i < data.length; i++) {
    const item = data[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `第 ${i + 1} 条规则不是对象` }
    }
    const obj = item as Record<string, unknown>
    const name = obj.name
    if (typeof name !== 'string' || !name.trim()) {
      return { ok: false, error: `第 ${i + 1} 条规则缺少 name 字段或为空` }
    }
    const config = obj.config
    if (
      config !== undefined &&
      config !== null &&
      typeof config !== 'object' &&
      typeof config !== 'string'
    ) {
      return { ok: false, error: `第 ${i + 1} 条规则 config 字段类型非法 (需对象或字符串)` }
    }
    const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true
    const description = typeof obj.description === 'string' ? obj.description : ''
    rules.push({
      name: name.trim(),
      description,
      config: config ?? '',
      enabled,
    })
  }
  return { ok: true, rules }
}
