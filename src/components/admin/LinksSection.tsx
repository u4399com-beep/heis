'use client'

// ============================================================
// 友链链轮 — 站群链轮设置 + 友情链接管理
// ⚠️ 本组件为客户端组件, 禁止 import '@/lib/links'(含 Prisma 会打进
//    客户端包) — 模式/数量等常量在此本地定义, 语义与后端保持一致。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { ConfirmDialog } from './ConfirmDialog'
import { Link2, Loader2, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, safeJsonParse } from './helpers'

// ---------------- 本地常量 (与后端 src/lib/links.ts 语义一致) ----------------

const WHEEL_MODES = ['home', 'book', 'mixed'] as const
type WheelMode = (typeof WHEEL_MODES)[number]

const WHEEL_COUNT_MIN = 1
const WHEEL_COUNT_MAX = 30
const WHEEL_COUNT_DEFAULT = 6

const WHEEL_MODE_OPTIONS: { value: WheelMode; label: string; desc: string }[] = [
  { value: 'home', label: '随机站点主页', desc: '每个链位随机指向参与链轮站点的主页, 每站最多一条' },
  { value: 'book', label: '随机书籍页', desc: '每个链位随机指向参与站点的随机书籍页, 同站可出现不同书' },
  { value: 'mixed', label: '混合', desc: '主页链与书籍链交替混合, 兼顾权重传递与内链多样性' },
]

interface WheelCfg {
  enabled: boolean
  mode: WheelMode
  count: number
}

const DEFAULT_CFG: WheelCfg = { enabled: true, mode: 'home', count: WHEEL_COUNT_DEFAULT }

/** 与后端 sanitizeWheelConfig 同语义的本地消毒 */
function sanitizeWheelCfgLocal(raw: unknown): WheelCfg {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const mode = String(o.mode ?? '')
  const n = typeof o.count === 'number' ? o.count : Number(o.count)
  return {
    enabled: o.enabled !== false,
    mode: (WHEEL_MODES as readonly string[]).includes(mode) ? (mode as WheelMode) : 'home',
    count: Number.isFinite(n) ? Math.min(WHEEL_COUNT_MAX, Math.max(WHEEL_COUNT_MIN, Math.trunc(n))) : DEFAULT_CFG.count,
  }
}

// ---------------- 友链行 ----------------

interface LinkRow {
  id: string
  name: string
  url: string
  logo: string
  sortOrder: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface LinkForm {
  name: string
  url: string
  logo: string
  sortOrder: number
  enabled: boolean
}

const emptyForm: LinkForm = { name: '', url: '', logo: '', sortOrder: 0, enabled: true }

/** 客户端轻校验: 无 scheme 补 https; 带 scheme 仅放行 http(s) — 与后端一致防 ftp:// 绕过 */
function validateUrlLocal(raw: string): string | null {
  const s = raw.trim()
  if (!s || s.length > 2000) return null
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s)
  if (hasScheme && !/^https?:\/\//i.test(s)) return null
  const candidate = hasScheme ? s : `https://${s}`
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

/** 客户端 logo 轻校验: 空 | / 开头(非 //) | http(s) */
function validateLogoLocal(raw: string): string | null {
  const s = raw.trim()
  if (!s) return ''
  if (s.startsWith('//')) return null
  if (s.startsWith('/')) return s
  if (/^https?:\/\//i.test(s)) return s
  return null
}

export function LinksSection() {
  const [links, setLinks] = useState<LinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [cfg, setCfg] = useState<WheelCfg>(DEFAULT_CFG)
  const [cfgSaving, setCfgSaving] = useState(false)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const [deleting, setDeleting] = useState<LinkRow | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LinkRow | null>(null)
  const [form, setForm] = useState<LinkForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, settings] = await Promise.all([
        api.get<LinkRow[]>('/api/admin/links'),
        api.get<Record<string, unknown>>('/api/admin/settings'),
      ])
      setLinks(Array.isArray(rows) ? rows : [])
      // settings.linkwheel 可能为字符串(JSON)或对象
      const raw = settings?.linkwheel
      const parsed = typeof raw === 'string' ? safeJsonParse<unknown>(raw, null) : raw
      setCfg(sanitizeWheelCfgLocal(parsed))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载友链失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ---------------- 链轮设置 ----------------

  const saveCfg = async () => {
    setCfgSaving(true)
    try {
      await api.put('/api/admin/settings', { linkwheel: { enabled: cfg.enabled, mode: cfg.mode, count: cfg.count } })
      toast.success('链轮设置已保存')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setCfgSaving(false)
    }
  }

  // ---------------- 友链 CRUD ----------------

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  const openEdit = (l: LinkRow) => {
    setEditing(l)
    setForm({ name: l.name, url: l.url, logo: l.logo, sortOrder: l.sortOrder, enabled: l.enabled })
    setDialogOpen(true)
  }

  const save = async () => {
    const name = form.name.trim()
    if (!name) return toast.error('名称必填')
    if (name.length > 60) return toast.error('名称需在 60 字以内')
    const url = validateUrlLocal(form.url)
    if (!url) return toast.error('链接地址非法(仅支持 http/https)')
    const logo = validateLogoLocal(form.logo)
    if (logo === null) return toast.error('logo 仅支持 http(s) 外链或站内 / 开头路径(不支持 // 开头)')
    const sortOrder = Math.min(99_999, Math.max(0, Math.trunc(Number(form.sortOrder)) || 0))

    setSaving(true)
    try {
      const body = { name, url, logo, sortOrder, enabled: form.enabled }
      if (editing) {
        await api.put('/api/admin/links', { id: editing.id, ...body })
        toast.success('友链已更新')
      } else {
        await api.post('/api/admin/links', body)
        toast.success('友链已创建')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (l: LinkRow) => {
    setTogglingId(l.id)
    try {
      await api.put('/api/admin/links', { id: l.id, enabled: !l.enabled })
      setLinks((rs) => rs.map((r) => (r.id === l.id ? { ...r, enabled: !l.enabled } : r)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setTogglingId(null)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await api.del('/api/admin/links', { id: deleting.id })
      toast.success(`友链「${deleting.name}」已删除`)
      setDeleting(null)
      setSelected((prev) => {
        const n = new Set(prev)
        n.delete(deleting.id)
        return n
      })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  // ---------------- 批量 ----------------

  const runBatch = async (action: 'delete' | 'enable' | 'disable') => {
    const ids = [...selected]
    if (!ids.length) return
    setBatchRunning(true)
    try {
      const r = await api.post<{ affected: number }>('/api/admin/links/batch', { ids, action })
      const label = action === 'delete' ? '删除' : action === 'enable' ? '启用' : '停用'
      toast.success(`已${label} ${r?.affected ?? ids.length} 条友链`)
      setConfirmBatchDelete(false)
      setSelected(new Set())
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量操作失败')
    } finally {
      setBatchRunning(false)
    }
  }

  const modeDesc = useMemo(() => WHEEL_MODE_OPTIONS.find((o) => o.value === cfg.mode)?.desc ?? '', [cfg.mode])
  const allSelected = links.length > 0 && links.every((l) => selected.has(l.id))
  const someSelected = selected.size > 0 && !allSelected

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <Link2 className="h-5 w-5 text-violet-400" />
            友链链轮
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">页脚友情链接管理 + 站群互链链轮(不指向当前站, 不加 nofollow 传递权重)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            新增友链
          </Button>
        </div>
      </div>

      {/* 链轮设置卡 */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-zinc-200">站群链轮</CardTitle>
          <CardDescription className="text-xs text-zinc-500">
            开启后前台页脚自动输出「站群链轮」区块: 实时随机互链, 永不指向当前站; 站点级参与开关在「站群系统」编辑
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 p-4 pt-0 md:grid-cols-3">
          <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
            <div>
              <div className="text-xs font-medium text-zinc-300">启用链轮</div>
              <div className="text-[10px] text-zinc-600">关闭后页脚仅显示友情链接</div>
            </div>
            <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">链轮模式</Label>
            <Select value={cfg.mode} onValueChange={(v) => setCfg({ ...cfg, mode: v as WheelMode })}>
              <SelectTrigger className="h-9 border-zinc-700 bg-zinc-950 text-sm" aria-label="链轮模式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WHEEL_MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-sm">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] leading-snug text-zinc-600">{modeDesc}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">
              链位数量 <span className="text-zinc-600">1~30, 实际不足时宁缺毋滥</span>
            </Label>
            <Input
              type="number"
              min={WHEEL_COUNT_MIN}
              max={WHEEL_COUNT_MAX}
              className="h-9 border-zinc-700 bg-zinc-950 text-sm"
              value={cfg.count}
              onChange={(e) => {
                const n = Math.trunc(Number(e.target.value))
                setCfg({ ...cfg, count: Number.isFinite(n) ? Math.min(WHEEL_COUNT_MAX, Math.max(WHEEL_COUNT_MIN, n)) : WHEEL_COUNT_MIN })
              }}
            />
            <Button size="sm" className="mt-1 h-8 gap-1.5" onClick={saveCfg} disabled={cfgSaving}>
              {cfgSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存链轮设置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 批量操作条 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
          <span>已选 {selected.size} 条</span>
          <div className="mx-1 h-4 w-px bg-violet-500/40" />
          <Button size="sm" variant="outline" className="h-7 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" disabled={batchRunning} onClick={() => runBatch('enable')}>
            批量启用
          </Button>
          <Button size="sm" variant="outline" className="h-7 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" disabled={batchRunning} onClick={() => runBatch('disable')}>
            批量停用
          </Button>
          <Button size="sm" variant="outline" className="h-7 border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20" disabled={batchRunning} onClick={() => setConfirmBatchDelete(true)}>
            批量删除
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-zinc-400 hover:text-zinc-200" disabled={batchRunning} onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
          {batchRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
        </div>
      )}

      {/* 友链表格 */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载友链…
        </div>
      ) : links.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="py-16 text-center text-sm text-zinc-500">暂无友情链接, 点击右上角「新增友链」添加第一条</CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 bg-zinc-900/80 hover:bg-zinc-900/80">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(v) => setSelected(v === true ? new Set(links.map((l) => l.id)) : new Set())}
                    aria-label="全选友链"
                  />
                </TableHead>
                <TableHead className="text-zinc-400">名称</TableHead>
                <TableHead className="text-zinc-400">地址</TableHead>
                <TableHead className="w-20 text-zinc-400">排序</TableHead>
                <TableHead className="w-20 text-zinc-400">状态</TableHead>
                <TableHead className="w-28 text-right text-zinc-400">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((l) => (
                <TableRow key={l.id} className={`border-zinc-800 ${l.enabled ? '' : 'opacity-55'}`}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(l.id)}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const n = new Set(prev)
                          if (v === true) n.add(l.id)
                          else n.delete(l.id)
                          return n
                        })
                      }
                      aria-label={`选择 ${l.name}`}
                    />
                  </TableCell>
                  <TableCell className="max-w-40 truncate font-medium text-zinc-100" title={l.name}>
                    {l.name}
                  </TableCell>
                  <TableCell className="max-w-72 truncate font-mono text-xs text-zinc-400" title={l.url}>
                    {l.url}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400">{l.sortOrder}</TableCell>
                  <TableCell>
                    <button type="button" onClick={() => toggleEnabled(l)} disabled={togglingId === l.id} title="点击切换状态" className="cursor-pointer disabled:cursor-wait">
                      <Badge className={`border ${l.enabled ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400' : 'border-zinc-600 bg-zinc-700/60 text-zinc-400'}`}>
                        {togglingId === l.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : l.enabled ? '启用' : '停用'}
                      </Badge>
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100" onClick={() => openEdit(l)}>
                        <Pencil className="h-3 w-3" />
                        编辑
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-red-400/80 hover:text-red-400" onClick={() => setDeleting(l)}>
                        <Trash2 className="h-3 w-3" />
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 新增/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[min(520px,96vw)] border-zinc-800 bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="text-base text-zinc-100">{editing ? '编辑友链' : '新增友链'}</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">展示在前台页脚「友情链接：」区块, sortOrder 升序排列</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">名称 *</Label>
              <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" placeholder="例: 笔趣阁" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">链接地址 *</Label>
              <Input
                className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
                placeholder="example.com 或 https://example.com (仅 http/https)"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Logo (可选)</Label>
              <Input
                className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
                placeholder="https://…/logo.png 或 /logo.png"
                value={form.logo}
                onChange={(e) => setForm({ ...form, logo: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">排序 (升序)</Label>
                <Input
                  type="number"
                  min={0}
                  max={99_999}
                  className="h-9 border-zinc-700 bg-zinc-950 text-sm"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: Math.trunc(Number(e.target.value)) || 0 })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-zinc-300">启用</div>
                  <div className="text-[10px] text-zinc-600">停用后前台不展示</div>
                </div>
                <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存友链
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 单删确认 */}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="确认删除友链?"
        description={`将删除「${deleting?.name}」(${deleting?.url}), 前台页脚立即不再展示。`}
        confirmText="删除"
        onConfirm={doDelete}
      />

      {/* 批量删除确认 */}
      <ConfirmDialog
        open={confirmBatchDelete}
        onOpenChange={setConfirmBatchDelete}
        title={`确认批量删除 ${selected.size} 条友链?`}
        description="删除后前台页脚立即不再展示, 该操作不可撤销。"
        confirmText="删除"
        loading={batchRunning}
        onConfirm={() => runBatch('delete')}
      />
    </div>
  )
}
