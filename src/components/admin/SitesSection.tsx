'use client'

// ============================================================
// 站群系统 — 站点卡片 + TDK/SEO/GEO 编辑 + 默认站点
// 批量操作: 卡片多选 + 批量删除(默认站保护)/换主题/设偏移量/加入·移出链轮
// (共享批量设施 batch.tsx; 链轮动作走 sites/batch wheel)
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
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
import { Check, Globe, Loader2, Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  BatchActionButton,
  BatchBar,
  BatchCheckbox,
  runBatch,
  useBatchSelection,
} from './batch'
import { api, type SiteRow } from './helpers'

interface SiteTheme {
  id: string
  name: string
  layout: string
  dark: boolean
  preview: [string, string, string]
}

interface SiteForm {
  name: string
  domain: string
  themeId: string
  title: string
  description: string
  keywords: string
  icbm: string
  geoRegion: string
  geoPlacename: string
  offset: number
  isDefault: boolean
  status: boolean
  inLinkWheel: boolean
}

const emptyForm: SiteForm = {
  name: '',
  domain: '',
  themeId: 'aurora',
  title: '',
  description: '',
  keywords: '',
  icbm: '35.86166,104.195397',
  geoRegion: 'CN',
  geoPlacename: '中国',
  offset: 0,
  isDefault: false,
  status: true,
  inLinkWheel: true,
}

export function SitesSection() {
  const [sites, setSites] = useState<SiteRow[]>([])
  const [themes, setThemes] = useState<SiteTheme[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SiteRow | null>(null)
  const [form, setForm] = useState<SiteForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<SiteRow | null>(null)
  // ---- 批量操作状态(共享设施; 默认站删除由服务端跳过并附 skipped) ----
  const siteIds = useMemo(() => sites.map((s) => s.id), [sites])
  const batch = useBatchSelection(siteIds)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const [pendingTheme, setPendingTheme] = useState('')
  const [pendingOffset, setPendingOffset] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ss, ts] = await Promise.all([api.get<SiteRow[]>('/api/admin/sites'), api.get<SiteTheme[]>('/api/admin/themes')])
      setSites(Array.isArray(ss) ? ss : [])
      setThemes(Array.isArray(ts) ? ts : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载站点失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const themeOf = (id: string) => themes.find((t) => t.id === id)

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  const openEdit = (s: SiteRow) => {
    setEditing(s)
    setForm({
      name: s.name,
      domain: s.domain,
      themeId: s.themeId,
      title: s.title,
      description: s.description,
      keywords: s.keywords,
      icbm: s.icbm,
      geoRegion: s.geoRegion,
      geoPlacename: s.geoPlacename,
      offset: s.offset,
      isDefault: s.isDefault,
      status: s.status,
      inLinkWheel: s.inLinkWheel ?? true,
    })
    setDialogOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) return toast.error('站点名称必填')
    if (!form.domain.trim()) return toast.error('域名必填')
    setSaving(true)
    try {
      const body = { ...form, domain: form.domain.trim().toLowerCase() }
      if (editing) {
        await api.put(`/api/admin/sites/${editing.id}`, body)
        toast.success('站点已更新')
      } else {
        await api.post('/api/admin/sites', body)
        toast.success('站点已创建')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (s: SiteRow, status: boolean) => {
    try {
      await api.put(`/api/admin/sites/${s.id}`, { status })
      setSites((rs) => rs.map((r) => (r.id === s.id ? { ...r, status } : r)))
      toast.success(status ? `站点「${s.name}」已启用` : `站点「${s.name}」已停用`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/api/admin/sites/${deleting.id}`)
      toast.success(`站点「${deleting.name}」已删除`)
      setDeleting(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  // ---- 批量动作: 统一走 runBatch(成功→清选+刷新; 默认站删除由服务端跳过并附 skipped) ----
  const runSitesBatch = async (body: Record<string, unknown>, describe: (r: { affected?: number }) => string) => {
    setBatchRunning(true)
    try {
      const res = await runBatch('/api/admin/sites/batch', { ids: batch.selectedOrdered, ...body }, (r) => describe(r))
      if (res) {
        batch.clearSelection()
        load()
      }
      return res
    } finally {
      setBatchRunning(false)
    }
  }

  const doBatchDelete = () => {
    setBatchConfirmOpen(false)
    void runSitesBatch({ action: 'delete' }, (r) => `已删除 ${r.affected ?? 0} 个站点`)
  }

  const doBatchWheel = (inLinkWheel: boolean) => {
    void runSitesBatch(
      { action: 'wheel', payload: { inLinkWheel } },
      (r) => `已${inLinkWheel ? '加入' : '移出'}站群链轮 ${r.affected ?? 0} 个站点`
    )
  }

  const doBatchTheme = () => {
    if (!pendingTheme) return
    const theme = themes.find((t) => t.id === pendingTheme)
    void runSitesBatch(
      { action: 'theme', payload: { themeId: pendingTheme } },
      (r) => `已将 ${r.affected ?? 0} 个站点切换到「${theme?.name || pendingTheme}」主题`
    )
  }

  const doBatchOffset = () => {
    const offset = Math.max(0, Math.trunc(Number(pendingOffset) || 0))
    void runSitesBatch(
      { action: 'offset', payload: { offset } },
      (r) => `已将 ${r.affected ?? 0} 个站点的书库偏移量设为 ${offset}`
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <Globe className="h-5 w-5 text-violet-400" />
            站群系统
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">每个站点绑定独立主题与偏移量, TDK/SEO/GEO 独立配置</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            新建站点
          </Button>
        </div>
      </div>

      {/* 批量操作条(已选>0 时出现) */}
      <BatchBar count={batch.selectedCount} onClear={batch.clearSelection} hint="默认站点删除将被跳过">
        <BatchActionButton
          running={batchRunning}
          className="text-red-400 hover:text-red-300"
          onClick={() => setBatchConfirmOpen(true)}
        >
          <Trash2 className="h-3 w-3" />
          删除
        </BatchActionButton>
        <BatchActionButton
          running={batchRunning}
          className="text-emerald-400 hover:text-emerald-300"
          onClick={() => doBatchWheel(true)}
          title="所选站点参与站群链轮(页脚互链)"
        >
          加入链轮
        </BatchActionButton>
        <BatchActionButton
          running={batchRunning}
          className="text-zinc-300 hover:text-zinc-100"
          onClick={() => doBatchWheel(false)}
          title="所选站点退出站群链轮"
        >
          移出链轮
        </BatchActionButton>
        <Select value={pendingTheme} onValueChange={setPendingTheme}>
          <SelectTrigger className="h-7 w-36 border-zinc-700 bg-zinc-950 text-xs">
            <SelectValue placeholder="切换主题模板" />
          </SelectTrigger>
          <SelectContent>
            {themes.map((t) => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                <span className="flex items-center gap-2">
                  <span className="flex overflow-hidden rounded-sm border border-zinc-700">
                    {t.preview.map((c, i) => (
                      <span key={i} className="h-3 w-3" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                  {t.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <BatchActionButton running={batchRunning} disabled={!pendingTheme} className="text-violet-400 hover:text-violet-300" onClick={doBatchTheme}>
          应用主题
        </BatchActionButton>
        <Input
          type="number"
          min={0}
          className="h-7 w-24 border-zinc-700 bg-zinc-950 text-xs"
          placeholder="偏移量"
          value={pendingOffset}
          onChange={(e) => setPendingOffset(e.target.value)}
        />
        <BatchActionButton running={batchRunning} className="text-violet-400 hover:text-violet-300" onClick={doBatchOffset}>
          应用偏移
        </BatchActionButton>
      </BatchBar>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载站点…
        </div>
      ) : sites.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="py-16 text-center text-sm text-zinc-500">暂无站点, 点击右上角「新建站点」创建第一个站点</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sites.map((s) => {
              const theme = themeOf(s.themeId)
              return (
                <Card key={s.id} className={`border-zinc-800 bg-zinc-900/60 ${s.status ? '' : 'opacity-60'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="pt-0.5">
                          <BatchCheckbox
                            checked={batch.selected.has(s.id)}
                            onCheckedChange={() => batch.toggle(s.id)}
                            ariaLabel={`选择站点「${s.name}」`}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium text-zinc-100">{s.name}</span>
                            {s.isDefault && (
                              <Badge className="border-transparent bg-amber-500/15 text-[10px] text-amber-400">
                                <Star className="mr-0.5 h-2.5 w-2.5" />
                                默认
                              </Badge>
                            )}
                            {s.inLinkWheel === false && (
                              <Badge variant="outline" className="border-zinc-700 bg-zinc-950 text-[10px] text-zinc-500">
                                链轮关
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">{s.domain}</div>
                        </div>
                      </div>
                      <Switch checked={s.status} onCheckedChange={(v) => toggleStatus(s, v)} />
                    </div>

                  {theme && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex overflow-hidden rounded border border-zinc-700">
                        {theme.preview.map((c, i) => (
                          <span key={i} className="h-4 w-6" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <Badge variant="outline" className="border-zinc-700 bg-zinc-950 text-[10px] text-zinc-300">
                        {theme.name} · {theme.layout}
                        {theme.dark ? ' · 暗色' : ''}
                      </Badge>
                    </div>
                  )}

                  <div className="mt-3 space-y-1 text-xs text-zinc-500">
                    <div className="truncate" title={s.title}>
                      <span className="text-zinc-600">T:</span> {s.title || '-'}
                    </div>
                    <div className="line-clamp-2" title={s.description}>
                      <span className="text-zinc-600">D:</span> {s.description || '-'}
                    </div>
                    <div className="truncate" title={s.keywords}>
                      <span className="text-zinc-600">K:</span> {s.keywords || '-'}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3">
                    <span className="font-mono text-xs text-zinc-400">offset {s.offset}</span>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100" onClick={() => openEdit(s)}>
                        <Pencil className="h-3 w-3" />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs text-red-400/80 hover:text-red-400"
                        disabled={s.isDefault}
                        title={s.isDefault ? '默认站点不可删除' : '删除'}
                        onClick={() => setDeleting(s)}
                      >
                        <Trash2 className="h-3 w-3" />
                        删除
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="admin-scroll max-h-[92vh] sm:max-w-[min(680px,96vw)] overflow-y-auto border-zinc-800 bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="text-base text-zinc-100">{editing ? '编辑站点' : '新建站点'}</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">TDK 用于前台 meta 标签, 偏移量使各站点书库切片不同</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">站点名称 *</Label>
              <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">域名 *</Label>
              <Input
                className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
                placeholder="www.example.com"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">前台主题</Label>
              <Select value={form.themeId} onValueChange={(v) => setForm({ ...form, themeId: v })}>
                <SelectTrigger className="h-9 border-zinc-700 bg-zinc-950 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-sm">
                      <span className="flex items-center gap-2">
                        <span className="flex overflow-hidden rounded-sm border border-zinc-700">
                          {t.preview.map((c, i) => (
                            <span key={i} className="h-3 w-3" style={{ backgroundColor: c }} />
                          ))}
                        </span>
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">
                书库偏移量 <span className="text-zinc-600">不同站点展示不同切片</span>
              </Label>
              <Input
                type="number"
                min={0}
                className="h-9 border-zinc-700 bg-zinc-950 text-sm"
                value={form.offset}
                onChange={(e) => setForm({ ...form, offset: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-zinc-400">SEO 标题 (T)</Label>
              <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="默认使用站点名称" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-zinc-400">SEO 描述 (D)</Label>
              <Textarea className="admin-scroll max-h-28 min-h-16 border-zinc-700 bg-zinc-950 text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-zinc-400">SEO 关键词 (K)</Label>
              <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="逗号分隔" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">ICBM 坐标</Label>
              <Input className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs" value={form.icbm} onChange={(e) => setForm({ ...form, icbm: e.target.value })} placeholder="35.86166,104.195397" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">geo.region</Label>
                <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" value={form.geoRegion} onChange={(e) => setForm({ ...form, geoRegion: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">geo.placename</Label>
                <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" value={form.geoPlacename} onChange={(e) => setForm({ ...form, geoPlacename: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 sm:col-span-1">
              <div>
                <div className="text-xs font-medium text-zinc-300">设为默认站点</div>
                <div className="text-[10px] text-zinc-600">保存后自动取消其他默认</div>
              </div>
              <Switch checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 sm:col-span-1">
              <div>
                <div className="text-xs font-medium text-zinc-300">启用站点</div>
                <div className="text-[10px] text-zinc-600">停用后前台不渲染该站点</div>
              </div>
              <Switch checked={form.status} onCheckedChange={(v) => setForm({ ...form, status: v })} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 sm:col-span-2">
              <div>
                <div className="text-xs font-medium text-zinc-300">参与站群链轮</div>
                <div className="text-[10px] text-zinc-600">关闭后其他站点页脚链轮不再指向本站(不影响本站页脚展示)</div>
              </div>
              <Switch checked={form.inLinkWheel} onCheckedChange={(v) => setForm({ ...form, inLinkWheel: v })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              保存站点
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除确认 */}
      <ConfirmDialog
        open={batchConfirmOpen}
        onOpenChange={setBatchConfirmOpen}
        title={`确认批量删除 ${batch.selectedCount} 个站点?`}
        description="将删除所选站点配置, 书库数据不受影响。默认站点不可删除, 将被自动跳过。"
        confirmText="删除"
        onConfirm={doBatchDelete}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="确认删除站点?"
        description={`将删除站点「${deleting?.name}」(${deleting?.domain}), 书库数据不受影响。`}
        confirmText="删除"
        onConfirm={doDelete}
      />
    </div>
  )
}
