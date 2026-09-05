'use client'

// ============================================================
// TaskDialog — 新建 / 编辑采集任务
// 模式: 单本 | 范围; 重采: 完全覆盖 | 增量; 存储: 数据库 | TXT
// ============================================================
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RadioGroup } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { api, type RuleRow, type TaskRow } from './helpers'

interface TaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null 表示新建 */
  task: TaskRow | null
  onSaved: () => void
}

interface TaskForm {
  name: string
  ruleId: string
  mode: 'single' | 'range'
  bookUrl: string
  listUrl: string
  listStart: number
  listEnd: number
  bookStart: number
  bookEnd: number
  recrawlMode: 'full' | 'incremental'
  storageMode: 'db' | 'txt'
  threadMin: number
  threadMax: number
  intervalMin: number
  intervalMax: number
  smartCategory: boolean
  smartComplete: boolean
  autoSuggest: boolean
  autoRefresh: boolean
  refreshIntervalMin: number
}

const emptyForm: TaskForm = {
  name: '',
  ruleId: '',
  mode: 'single',
  bookUrl: '',
  listUrl: '',
  listStart: 1,
  listEnd: 1,
  bookStart: 0,
  bookEnd: 0,
  recrawlMode: 'incremental',
  storageMode: 'db',
  threadMin: 1,
  threadMax: 3,
  intervalMin: 500,
  intervalMax: 2000,
  smartCategory: true,
  smartComplete: true,
  autoSuggest: true,
  autoRefresh: false,
  refreshIntervalMin: 30,
}

export function TaskDialog({ open, onOpenChange, task, onSaved }: TaskDialogProps) {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [form, setForm] = useState<TaskForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    api.get<RuleRow[]>('/api/admin/rules').then((rs) => setRules(Array.isArray(rs) ? rs : [])).catch(() => setRules([]))
    if (task) {
      setForm({
        name: task.name,
        ruleId: task.ruleId,
        mode: task.mode === 'range' ? 'range' : 'single',
        bookUrl: task.bookUrl,
        listUrl: task.listUrl,
        listStart: task.listStart ?? 1,
        listEnd: task.listEnd ?? 1,
        bookStart: task.bookStart ?? 0,
        bookEnd: task.bookEnd ?? 0,
        recrawlMode: task.recrawlMode === 'full' ? 'full' : 'incremental',
        storageMode: task.storageMode === 'txt' ? 'txt' : 'db',
        threadMin: task.threadMin,
        threadMax: task.threadMax,
        intervalMin: task.intervalMin,
        intervalMax: task.intervalMax,
        smartCategory: task.smartCategory,
        smartComplete: task.smartComplete,
        autoSuggest: task.autoSuggest,
        autoRefresh: task.autoRefresh ?? false,
        refreshIntervalMin: task.refreshIntervalMin ?? 30,
      })
    } else {
      setForm(emptyForm)
    }
  }, [open, task])

  const patch = (p: Partial<TaskForm>) => setForm((f) => ({ ...f, ...p }))

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('请填写任务名称')
      return
    }
    if (!form.ruleId) {
      toast.error('请选择采集规则')
      return
    }
    if (form.mode === 'single') {
      if (!form.bookUrl.trim()) {
        toast.error('单本模式必须填写书籍页 URL')
        return
      }
      if (!/^https?:\/\//i.test(form.bookUrl.trim())) {
        toast.error('书籍页 URL 需以 http:// 或 https:// 开头')
        return
      }
    } else {
      if (!form.listUrl.trim()) {
        toast.error('范围模式必须填写列表页 URL (含 {page})')
        return
      }
      if (!/^https?:\/\//i.test(form.listUrl.trim())) {
        toast.error('列表页 URL 需以 http:// 或 https:// 开头')
        return
      }
      if (form.listStart > form.listEnd) {
        toast.error('列表页起始页码不能大于结束页码')
        return
      }
      if (form.bookStart > 0 && form.bookEnd > 0 && form.bookStart > form.bookEnd) {
        toast.error('书籍序号起始不能大于结束')
        return
      }
    }
    if (form.threadMin > form.threadMax) {
      toast.error('线程数下限不能大于上限')
      return
    }
    if (form.intervalMin > form.intervalMax) {
      toast.error('请求间隔下限不能大于上限 (ms)')
      return
    }
    if (form.autoRefresh && (form.refreshIntervalMin < 5 || form.refreshIntervalMin > 1440)) {
      toast.error('自动刷新间隔需在 5 ~ 1440 分钟之间')
      return
    }
    setSaving(true)
    try {
      const body = { ...form, name: form.name.trim() }
      if (task) {
        await api.put(`/api/admin/tasks/${task.id}`, body)
        toast.success('任务已更新')
      } else {
        await api.post('/api/admin/tasks', body)
        toast.success('任务已创建')
      }
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const num = (v: number) => Number.isFinite(v) ? v : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scroll max-h-[92vh] sm:max-w-[min(720px,96vw)] overflow-y-auto border-zinc-800 bg-zinc-900">
        <DialogHeader>
          <DialogTitle className="text-base text-zinc-100">{task ? '编辑采集任务' : '新建采集任务'}</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            线程与间隔均取随机范围值, 请求节奏更接近真人浏览
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">任务名称 *</Label>
              <Input
                className="h-9 border-zinc-700 bg-zinc-950 text-sm"
                placeholder="例: 玄幻频道批量采集"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">采集规则 *</Label>
              <Select value={form.ruleId} onValueChange={(v) => patch({ ruleId: v })}>
                <SelectTrigger className="h-9 border-zinc-700 bg-zinc-950 text-sm">
                  <SelectValue placeholder="选择规则" />
                </SelectTrigger>
                <SelectContent>
                  {rules.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-sm">
                      {r.name}
                      {!r.enabled ? ' (已停用)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          {/* 模式 */}
          <div className="space-y-3">
            <Label className="text-xs font-medium text-zinc-300">采集模式</Label>
            <RadioGroup
              value={form.mode}
              onValueChange={(v) => patch({ mode: v as TaskForm['mode'] })}
              className="grid grid-cols-2 gap-3"
            >
              <ModeCard
                value="single"
                current={form.mode}
                title="单本采集"
                desc="直接指定一个书籍页地址"
                onSelect={() => patch({ mode: 'single' })}
              />
              <ModeCard
                value="range"
                current={form.mode}
                title="范围采集"
                desc="遍历列表页翻页, 批量发现书籍"
                onSelect={() => patch({ mode: 'range' })}
              />
            </RadioGroup>

            {form.mode === 'single' ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">书籍页 URL *</Label>
                <Input
                  className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
                  placeholder="https://example.com/book/123.html"
                  value={form.bookUrl}
                  onChange={(e) => patch({ bookUrl: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">
                    列表页 URL * <span className="text-zinc-600">支持 {'{page}'} 占位符</span>
                  </Label>
                  <Input
                    className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
                    placeholder="https://example.com/sort/1_{page}.html"
                    value={form.listUrl}
                    onChange={(e) => patch({ listUrl: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-400">列表页起始页码</Label>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 border-zinc-700 bg-zinc-950 text-sm"
                      value={form.listStart}
                      onChange={(e) => patch({ listStart: num(Number(e.target.value)) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-400">列表页结束页码</Label>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 border-zinc-700 bg-zinc-950 text-sm"
                      value={form.listEnd}
                      onChange={(e) => patch({ listEnd: num(Number(e.target.value)) })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-400">
                      书籍序号起始 <span className="text-zinc-600">0 = 不限</span>
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      className="h-8 border-zinc-700 bg-zinc-950 text-sm"
                      value={form.bookStart}
                      onChange={(e) => patch({ bookStart: num(Number(e.target.value)) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-400">
                      书籍序号结束 <span className="text-zinc-600">0 = 不限</span>
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      className="h-8 border-zinc-700 bg-zinc-950 text-sm"
                      value={form.bookEnd}
                      onChange={(e) => patch({ bookEnd: num(Number(e.target.value)) })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <Separator className="bg-zinc-800" />

          {/* 重采模式 + 存储模式 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-zinc-300">重采模式</Label>
              <RadioGroup
                value={form.recrawlMode}
                onValueChange={(v) => patch({ recrawlMode: v as TaskForm['recrawlMode'] })}
                className="space-y-2"
              >
                <RadioOption
                  value="full"
                  current={form.recrawlMode}
                  onSelect={() => patch({ recrawlMode: 'full' })}
                  title="完全覆盖重采集"
                  desc="清空该书已有章节后全部重建"
                />
                <RadioOption
                  value="incremental"
                  current={form.recrawlMode}
                  onSelect={() => patch({ recrawlMode: 'incremental' })}
                  title="只增量更新"
                  desc="仅补充新章节, 不动已有数据"
                />
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-zinc-300">存储模式</Label>
              <RadioGroup
                value={form.storageMode}
                onValueChange={(v) => patch({ storageMode: v as TaskForm['storageMode'] })}
                className="space-y-2"
              >
                <RadioOption
                  value="db"
                  current={form.storageMode}
                  onSelect={() => patch({ storageMode: 'db' })}
                  title="直接写入数据库"
                  desc="章节正文存 SQLite, 前台直接读取"
                />
                <RadioOption
                  value="txt"
                  current={form.storageMode}
                  onSelect={() => patch({ storageMode: 'txt' })}
                  title="生成 TXT 文件"
                  desc="每章一个 txt, 存 data/novels 目录"
                />
              </RadioGroup>
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          {/* 线程 + 间隔 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">线程数下限</Label>
              <Input
                type="number"
                min={1}
                className="h-9 border-zinc-700 bg-zinc-950 text-sm"
                value={form.threadMin}
                onChange={(e) => patch({ threadMin: Math.max(1, num(Number(e.target.value))) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">线程数上限</Label>
              <Input
                type="number"
                min={1}
                className="h-9 border-zinc-700 bg-zinc-950 text-sm"
                value={form.threadMax}
                onChange={(e) => patch({ threadMax: Math.max(1, num(Number(e.target.value))) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">请求间隔下限 (ms)</Label>
              <Input
                type="number"
                min={0}
                className="h-9 border-zinc-700 bg-zinc-950 text-sm"
                value={form.intervalMin}
                onChange={(e) => patch({ intervalMin: Math.max(0, num(Number(e.target.value))) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">请求间隔上限 (ms)</Label>
              <Input
                type="number"
                min={0}
                className="h-9 border-zinc-700 bg-zinc-950 text-sm"
                value={form.intervalMax}
                onChange={(e) => patch({ intervalMax: Math.max(0, num(Number(e.target.value))) })}
              />
            </div>
          </div>

          {/* 智能开关 */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SwitchRow label="智能分类" desc="无分类时自动归类" checked={form.smartCategory} onChange={(v) => patch({ smartCategory: v })} />
            <SwitchRow label="智能完结" desc="自动判断连载/完结" checked={form.smartComplete} onChange={(v) => patch({ smartComplete: v })} />
            <SwitchRow label="自动下拉词" desc="入库后抓取搜索下拉词" checked={form.autoSuggest} onChange={(v) => patch({ autoSuggest: v })} />
          </div>

          {/* 自动刷新(jj-e 实时更新) */}
          <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium text-zinc-300">完成后自动刷新</div>
                <div className="text-[10px] text-zinc-600">任务完成后按间隔重新采集, 持续同步连载新章节(实时更新)</div>
              </div>
              <Switch checked={form.autoRefresh} onCheckedChange={(v) => patch({ autoRefresh: v })} aria-label="自动刷新开关" />
            </div>
            {form.autoRefresh && (
              <div className="flex items-center gap-2 pt-1">
                <Label className="shrink-0 text-[10px] text-zinc-500">刷新间隔(分钟)</Label>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  className="h-8 w-28 border-zinc-700 bg-zinc-950 text-sm"
                  value={form.refreshIntervalMin}
                  onChange={(e) => patch({ refreshIntervalMin: Math.max(0, num(Number(e.target.value))) })}
                  aria-label="自动刷新间隔分钟数"
                />
                <span className="text-[10px] text-zinc-600">5 ~ 1440; 手动停止会取消排定</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {task ? '保存修改' : '创建任务'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeCard({
  value,
  current,
  title,
  desc,
  onSelect,
}: {
  value: string
  current: string
  title: string
  desc: string
  onSelect: () => void
}) {
  const active = value === current
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={`rounded-lg border p-3 text-left transition-colors ${
        active ? 'border-violet-500/60 bg-violet-500/10' : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
      }`}
    >
      <div className="flex items-center gap-2">
        {/* 纯视觉单选点: HTML 不允许 <button> 嵌套 <button>(RadioGroupItem 会渲染成 button), 故改为 span */}
        <span
          aria-hidden
          className={`flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border shadow-xs dark:bg-input/30 ${
            active ? 'border-violet-500 text-violet-500' : 'border-zinc-600'
          }`}
        >
          {active && <span className="size-2 rounded-full bg-violet-500" />}
        </span>
        <span className={`text-sm font-medium ${active ? 'text-violet-300' : 'text-zinc-300'}`}>{title}</span>
      </div>
      <p className="mt-1 pl-6 text-xs text-zinc-500">{desc}</p>
    </button>
  )
}

function RadioOption({
  value,
  current,
  title,
  desc,
  onSelect,
}: {
  value: string
  current: string
  title: string
  desc: string
  onSelect: () => void
}) {
  const active = value === current
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={`flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors ${
        active ? 'border-violet-500/60 bg-violet-500/10' : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border shadow-xs dark:bg-input/30 ${
          active ? 'border-violet-500 text-violet-500' : 'border-zinc-600'
        }`}
      >
        {active && <span className="size-2 rounded-full bg-violet-500" />}
      </span>
      <span>
        <span className={`block text-sm ${active ? 'text-violet-300' : 'text-zinc-300'}`}>{title}</span>
        <span className="block text-xs text-zinc-500">{desc}</span>
      </span>
    </button>
  )
}

function SwitchRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <div>
        <div className="text-xs font-medium text-zinc-300">{label}</div>
        <div className="text-[10px] text-zinc-600">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
