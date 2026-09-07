'use client'

// ============================================================
// TaskWizard — 采集任务创建向导 (CREATE 专用)
// 4 步: 选规则 → 配范围 → 调度&存储 → 确认&启动
// 编辑模式仍走 TaskDialog (单表单, 快速改字段)
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { RadioGroup } from '@/components/ui/radio-group'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Info,
  Loader2,
  Play,
  Save,
  Snail,
  Gauge,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, safeParseRuleConfig, type RuleRow } from './helpers'
import { StepIndicator } from './StepIndicator'

interface TaskWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  /** 空规则态跳转到规则页 (可选) */
  onNavigateToRules?: () => void
}

// ---- 表单 ----
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

const EMPTY_FORM: TaskForm = {
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
  threadMin: 2,
  threadMax: 3,
  intervalMin: 1000,
  intervalMax: 2000,
  smartCategory: true,
  smartComplete: true,
  autoSuggest: true,
  autoRefresh: false,
  refreshIntervalMin: 30,
}

const STEPS = ['选规则', '配范围', '调度', '确认']

// ---- 节奏预设 ----
type PresetKey = 'slow' | 'standard' | 'fast'
const PRESETS: Record<PresetKey, {
  label: string
  icon: typeof Snail
  thread: [number, number]
  interval: [number, number]
  hint: string
}> = {
  slow: {
    label: '慢速',
    icon: Snail,
    thread: [1, 2],
    interval: [3000, 5000],
    hint: '1-2线程 / 3-5秒',
  },
  standard: {
    label: '标准',
    icon: Gauge,
    thread: [2, 3],
    interval: [1000, 2000],
    hint: '2-3线程 / 1-2秒',
  },
  fast: {
    label: '快速',
    icon: Zap,
    thread: [3, 5],
    interval: [500, 1000],
    hint: '3-5线程 / 0.5-1秒',
  },
}

const num = (v: number) => (Number.isFinite(v) ? v : 0)

export function TaskWizard({ open, onOpenChange, onSaved, onNavigateToRules }: TaskWizardProps) {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM)
  const [nameTouched, setNameTouched] = useState(false)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // 打开时复位 + 拉取规则
  useEffect(() => {
    if (!open) return
    setStep(0)
    setForm(EMPTY_FORM)
    setNameTouched(false)
    setRulesLoading(true)
    api
      .get<RuleRow[]>('/api/admin/rules')
      .then((rs) => setRules(Array.isArray(rs) ? rs : []))
      .catch(() => setRules([]))
      .finally(() => setRulesLoading(false))
  }, [open])

  const patch = useCallback((p: Partial<TaskForm>) => setForm((f) => ({ ...f, ...p })), [])

  // ---- 启用规则 (按更新时间倒序) ----
  const enabledRules = useMemo(() => rules.filter((r) => r.enabled), [rules])
  const selectedRule = useMemo(() => rules.find((r) => r.id === form.ruleId) || null, [rules, form.ruleId])

  // ---- 选中规则时自动建议任务名 (用户未手编时跟随) ----
  useEffect(() => {
    if (!selectedRule || nameTouched) return
    const base = selectedRule.name
    const suffix = form.mode === 'single' ? '单书采集' : `范围${form.listStart}-${form.listEnd}`
    patch({ name: `${base}-${suffix}` })
  }, [selectedRule, form.mode, form.listStart, form.listEnd, nameTouched, patch])

  // ---- 当前匹配的预设 ----
  const activePreset = useMemo<PresetKey | null>(() => {
    for (const k of Object.keys(PRESETS) as PresetKey[]) {
      const p = PRESETS[k]
      if (
        form.threadMin === p.thread[0] &&
        form.threadMax === p.thread[1] &&
        form.intervalMin === p.interval[0] &&
        form.intervalMax === p.interval[1]
      ) {
        return k
      }
    }
    return null
  }, [form.threadMin, form.threadMax, form.intervalMin, form.intervalMax])

  // ---- 步骤校验 ----
  const stepValid = useMemo(() => {
    if (step === 0) return !!form.ruleId
    if (step === 1) {
      if (form.mode === 'single') {
        return /^https?:\/\//i.test(form.bookUrl.trim())
      }
      if (!/^https?:\/\//i.test(form.listUrl.trim())) return false
      if (form.listStart > form.listEnd) return false
      if (form.bookStart > 0 && form.bookEnd > 0 && form.bookStart > form.bookEnd) return false
      return true
    }
    if (step === 2) {
      if (form.threadMin > form.threadMax) return false
      if (form.intervalMin > form.intervalMax) return false
      if (form.autoRefresh && (form.refreshIntervalMin < 5 || form.refreshIntervalMin > 1440)) return false
      return true
    }
    return true
  }, [step, form])

  // ---- 创建任务 ----
  const createTask = async (start: boolean) => {
    if (!form.name.trim()) {
      toast.error('请填写任务名称')
      setStep(0)
      return
    }
    if (!form.ruleId) {
      toast.error('请选择采集规则')
      setStep(0)
      return
    }
    setSaving(true)
    try {
      const body = { ...form, name: form.name.trim() }
      const created = await api.post<{ id: string }>('/api/admin/tasks', body)
      if (start) {
        try {
          await api.post(`/api/admin/tasks/${created.id}/control`, { action: 'start' })
          toast.success(`任务「${form.name.trim()}」已创建并启动`)
        } catch (e) {
          toast.error(e instanceof Error ? `已创建但启动失败: ${e.message}` : '已创建但启动失败')
        }
      } else {
        toast.success(`任务「${form.name.trim()}」已创建`)
      }
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  // ---- 选中规则的 URL 模板 (作为 placeholder) ----
  const listUrlTemplate = useMemo(() => {
    if (!selectedRule) return 'https://example.com/sort/1_{page}.html'
    try {
      const cfg = safeParseRuleConfig(selectedRule.config)
      return cfg.list?.urlTemplate || 'https://example.com/sort/1_{page}.html'
    } catch {
      return 'https://example.com/sort/1_{page}.html'
    }
  }, [selectedRule])

  const bookUrlPlaceholder = 'https://example.com/book/123.html'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scroll max-h-[92vh] sm:max-w-2xl overflow-y-auto border-zinc-800 bg-zinc-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-100">
            <span className="flex size-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-400">
              <Play className="size-4" />
            </span>
            新建采集任务向导
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            四步配置: 选规则 → 配范围 → 调度存储 → 确认启动
          </DialogDescription>
        </DialogHeader>

        <StepIndicator steps={STEPS} current={step} className="py-1" />

        <div className="min-h-[18rem]">
          {step === 0 && (
            <Step1ChooseRule
              rules={enabledRules}
              loading={rulesLoading}
              selectedId={form.ruleId}
              onSelect={(id) => patch({ ruleId: id })}
              onNavigateToRules={() => {
                onOpenChange(false)
                onNavigateToRules?.()
              }}
            />
          )}
          {step === 1 && (
            <Step2Range
              form={form}
              patch={patch}
              listUrlTemplate={listUrlTemplate}
              bookUrlPlaceholder={bookUrlPlaceholder}
              onNameEdit={() => setNameTouched(true)}
            />
          )}
          {step === 2 && (
            <Step3Schedule
              form={form}
              patch={patch}
              activePreset={activePreset}
              onPreset={(k) => {
                const p = PRESETS[k]
                patch({
                  threadMin: p.thread[0],
                  threadMax: p.thread[1],
                  intervalMin: p.interval[0],
                  intervalMax: p.interval[1],
                })
              }}
            />
          )}
          {step === 3 && <Step4Confirm form={form} ruleName={selectedRule?.name || '-'} />}
        </div>

        {/* 底部导航 */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 pt-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                <ChevronLeft className="size-3.5" />
                上一步
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!stepValid}
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              >
                下一步
                <ChevronRight className="size-3.5" />
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800"
                  disabled={saving}
                  onClick={() => createTask(false)}
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  创建但不启动
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={saving}
                  onClick={() => createTask(true)}
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  创建并立即启动
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// 步骤 1: 选规则
// ============================================================
function Step1ChooseRule({
  rules,
  loading,
  selectedId,
  onSelect,
  onNavigateToRules,
}: {
  rules: RuleRow[]
  loading: boolean
  selectedId: string
  onSelect: (id: string) => void
  onNavigateToRules: () => void
}) {
  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在加载采集规则…
      </div>
    )
  }
  if (rules.length === 0) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-zinc-800 text-zinc-500">
          <FileText className="size-6" />
        </div>
        <div>
          <p className="text-sm text-zinc-300">暂无采集规则</p>
          <p className="mt-1 text-xs text-zinc-500">请先在采集规则页创建, 再回到此向导</p>
        </div>
        <Button size="sm" variant="outline" className="border-zinc-700 bg-transparent text-violet-300 hover:bg-zinc-800" onClick={onNavigateToRules}>
          前往采集规则页 →
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-zinc-400">选择采集规则</Label>
        <span className="text-[10px] text-zinc-600">仅展示已启用规则 · 共 {rules.length} 条</span>
      </div>
      <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {rules.map((r) => {
          const active = r.id === selectedId
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              aria-pressed={active}
              className={`group relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                active
                  ? 'border-violet-500 bg-violet-950/30'
                  : 'border-zinc-800 bg-zinc-950/60 hover:border-violet-600 hover:bg-zinc-900'
              }`}
            >
              {active && (
                <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-violet-500 text-white">
                  <Check className="size-3" />
                </span>
              )}
              <div className="flex w-full items-center gap-2 pr-6">
                <span className={`truncate text-sm font-medium ${active ? 'text-violet-200' : 'text-zinc-200'}`}>{r.name}</span>
              </div>
              <p className="line-clamp-2 text-xs text-zinc-500">{r.description || '— 无描述 —'}</p>
              <Badge
                variant="outline"
                className={`mt-1 border-transparent text-[10px] ${
                  r.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-700/40 text-zinc-500'
                }`}
              >
                {r.enabled ? '已启用' : '已停用'}
              </Badge>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// 步骤 2: 配范围
// ============================================================
function Step2Range({
  form,
  patch,
  listUrlTemplate,
  bookUrlPlaceholder,
  onNameEdit,
}: {
  form: TaskForm
  patch: (p: Partial<TaskForm>) => void
  listUrlTemplate: string
  bookUrlPlaceholder: string
  onNameEdit: () => void
}) {
  return (
    <div className="space-y-4">
      {/* 任务名 */}
      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-400">任务名称 *</Label>
        <Input
          className="h-9 border-zinc-700 bg-zinc-950 text-sm"
          placeholder="自动建议: 规则名-模式, 可自行修改"
          value={form.name}
          onChange={(e) => {
            patch({ name: e.target.value })
            onNameEdit()
          }}
        />
        <p className="text-[10px] text-zinc-600">已根据所选规则与范围自动生成, 可手动调整</p>
      </div>

      {/* 模式 */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-zinc-300">采集模式</Label>
        <RadioGroup
          value={form.mode}
          onValueChange={(v) => patch({ mode: v as TaskForm['mode'] })}
          className="grid grid-cols-2 gap-2"
        >
          <ModeTab active={form.mode === 'single'} title="单本采集" desc="直接指定一个书籍页地址" onClick={() => patch({ mode: 'single' })} />
          <ModeTab active={form.mode === 'range'} title="范围采集" desc="遍历列表页翻页, 批量发现书籍" onClick={() => patch({ mode: 'range' })} />
        </RadioGroup>
      </div>

      {/* 范围配置 */}
      {form.mode === 'single' ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">书籍页 URL *</Label>
          <Input
            className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
            placeholder={bookUrlPlaceholder}
            value={form.bookUrl}
            onChange={(e) => patch({ bookUrl: e.target.value })}
          />
          <p className="text-[10px] text-zinc-600">指向单本小说的详情页地址</p>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">
              列表页 URL * <span className="text-zinc-600">支持 {'{page}'} 占位符</span>
            </Label>
            <Input
              className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
              placeholder={listUrlTemplate || 'https://example.com/sort/1_{page}.html'}
              value={form.listUrl}
              onChange={(e) => patch({ listUrl: e.target.value })}
            />
            <p className="text-[10px] text-zinc-600">列表地址支持 {'{page}'} 占位符, 将自动翻页采集</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">列表页起始页码</Label>
              <Input
                type="number"
                min={1}
                className="h-8 border-zinc-700 bg-zinc-950 text-sm"
                value={form.listStart}
                onChange={(e) => patch({ listStart: Math.max(1, num(Number(e.target.value))) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">列表页结束页码</Label>
              <Input
                type="number"
                min={1}
                className="h-8 border-zinc-700 bg-zinc-950 text-sm"
                value={form.listEnd}
                onChange={(e) => patch({ listEnd: Math.max(1, num(Number(e.target.value))) })}
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
                onChange={(e) => patch({ bookStart: Math.max(0, num(Number(e.target.value))) })}
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
                onChange={(e) => patch({ bookEnd: Math.max(0, num(Number(e.target.value))) })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ModeTab({ active, title, desc, onClick }: { active: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border p-3 text-left transition-colors ${
        active ? 'border-violet-500/60 bg-violet-500/10' : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
            active ? 'border-violet-500' : 'border-zinc-600'
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

// ============================================================
// 步骤 3: 调度与存储
// ============================================================
function Step3Schedule({
  form,
  patch,
  activePreset,
  onPreset,
}: {
  form: TaskForm
  patch: (p: Partial<TaskForm>) => void
  activePreset: PresetKey | null
  onPreset: (k: PresetKey) => void
}) {
  return (
    <div className="space-y-5">
      {/* 节奏预设 */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-zinc-300">节奏预设</Label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(PRESETS) as PresetKey[]).map((k) => {
            const p = PRESETS[k]
            const Icon = p.icon
            const active = activePreset === k
            return (
              <button
                key={k}
                type="button"
                onClick={() => onPreset(k)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1 rounded-lg border p-3 transition-colors ${
                  active
                    ? 'border-violet-500 bg-violet-600 text-white'
                    : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <Icon className="size-4" />
                <span className="text-xs font-medium">{p.label}</span>
                <span className={`text-[10px] ${active ? 'text-violet-100' : 'text-zinc-500'}`}>{p.hint}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 线程数 slider */}
      <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-zinc-300">线程数</Label>
          <span className="font-mono text-xs text-violet-300">
            {form.threadMin} ~ {form.threadMax} 线程
          </span>
        </div>
        <Slider
          min={1}
          max={10}
          step={1}
          value={[form.threadMin, form.threadMax]}
          onValueChange={(v) => {
            const [a, b] = v
            if (typeof a === 'number' && typeof b === 'number') {
              patch({ threadMin: a, threadMax: b })
            }
          }}
        />
      </div>

      {/* 请求间隔 slider */}
      <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-zinc-300">请求间隔</Label>
          <span className="font-mono text-xs text-violet-300">
            {form.intervalMin} ~ {form.intervalMax} ms
          </span>
        </div>
        <Slider
          min={100}
          max={10000}
          step={100}
          value={[form.intervalMin, form.intervalMax]}
          onValueChange={(v) => {
            const [a, b] = v
            if (typeof a === 'number' && typeof b === 'number') {
              patch({ intervalMin: a, intervalMax: b })
            }
          }}
        />
      </div>

      {/* 存储模式 */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-zinc-300">存储模式</Label>
        <RadioGroup
          value={form.storageMode}
          onValueChange={(v) => patch({ storageMode: v as TaskForm['storageMode'] })}
          className="grid grid-cols-2 gap-2"
        >
          <ModeTab
            active={form.storageMode === 'db'}
            title="数据库"
            desc="章节正文存 SQLite, 前台直接读取"
            onClick={() => patch({ storageMode: 'db' })}
          />
          <ModeTab
            active={form.storageMode === 'txt'}
            title="TXT 文件"
            desc="每章一个 txt, 存 data/novels 目录"
            onClick={() => patch({ storageMode: 'txt' })}
          />
        </RadioGroup>
      </div>

      {/* 智能开关 */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-zinc-300">智能选项</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SmartToggle
            label="智能分类"
            desc="无分类时自动归类"
            checked={form.smartCategory}
            onChange={(v) => patch({ smartCategory: v })}
          />
          <SmartToggle
            label="智能完结"
            desc="自动判断连载/完结"
            checked={form.smartComplete}
            onChange={(v) => patch({ smartComplete: v })}
          />
          <SmartToggle
            label="自动下拉词"
            desc="入库后抓取搜索下拉词"
            checked={form.autoSuggest}
            onChange={(v) => patch({ autoSuggest: v })}
          />
        </div>
      </div>

      {/* 自动刷新 */}
      <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <div>
              <div className="text-xs font-medium text-zinc-300">完成后自动刷新</div>
              <div className="text-[10px] text-zinc-600">任务完成后按间隔自动增量续采</div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-zinc-500 hover:text-zinc-300" aria-label="自动刷新说明">
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[16rem] text-left">
                开启后, 任务完成会按下方间隔(分钟)自动触发一次增量续采, 持续同步连载新章节。手动停止会取消排定。
              </TooltipContent>
            </Tooltip>
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
            <span className="text-[10px] text-zinc-600">范围 5 ~ 1440 分钟</span>
          </div>
        )}
      </div>
    </div>
  )
}

function SmartToggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium text-zinc-300">{label}</div>
        <div className="truncate text-[10px] text-zinc-600">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

// ============================================================
// 步骤 4: 确认
// ============================================================
function Step4Confirm({ form, ruleName }: { form: TaskForm; ruleName: string }) {
  const rows: { k: string; v: string }[] = [
    { k: '任务名称', v: form.name || '(未填写)' },
    { k: '采集规则', v: ruleName },
    { k: '采集模式', v: form.mode === 'single' ? '单本采集' : '范围采集' },
    {
      k: '采集范围',
      v:
        form.mode === 'single'
          ? form.bookUrl || '(未填写)'
          : `${form.listUrl || '(未填写)'} · 页 ${form.listStart}-${form.listEnd}${form.bookStart > 0 || form.bookEnd > 0 ? ` · 书 ${form.bookStart}-${form.bookEnd}` : ''}`,
    },
    { k: '线程数', v: `${form.threadMin} ~ ${form.threadMax}` },
    { k: '请求间隔', v: `${form.intervalMin} ~ ${form.intervalMax} ms` },
    { k: '存储模式', v: form.storageMode === 'db' ? '数据库 (SQLite)' : 'TXT 文件' },
    {
      k: '智能选项',
      v: [
        form.smartCategory ? '智能分类' : null,
        form.smartComplete ? '智能完结' : null,
        form.autoSuggest ? '自动下拉词' : null,
      ]
        .filter(Boolean)
        .join(' / ') || '无',
    },
    {
      k: '自动刷新',
      v: form.autoRefresh ? `开启 · 每 ${form.refreshIntervalMin} 分钟` : '关闭',
    },
  ]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
        <Check className="size-4" />
        请确认以下配置无误, 然后选择创建方式
      </div>
      <Card className="border-zinc-800 bg-zinc-950/60">
        <dl className="divide-y divide-zinc-800">
          {rows.map((r) => (
            <div key={r.k} className="grid grid-cols-3 gap-2 px-3 py-2 text-xs">
              <dt className="text-zinc-500">{r.k}</dt>
              <dd className="col-span-2 break-all font-mono text-zinc-200">{r.v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-500">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <div>
          <strong className="text-zinc-300">创建并立即启动</strong>: 任务进入待运行队列, 由 runner 拉起执行;
          <strong className="ml-2 text-zinc-300">创建但不启动</strong>: 仅入库, 稍后可在列表手动启动。
        </div>
      </div>
    </div>
  )
}
