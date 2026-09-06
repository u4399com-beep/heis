'use client'

// ============================================================
// FieldRule 编辑器 — 可复用的单字段提取规则编辑组件
// 支持 css选择器 / XPath / 正则表达式 / JSON路径 / 常量模板 五种提取方式
//
// feat-round-11 A1: 头部紧凑摘要徽章(TypeBadge + 表达式预览 + attr pill)
//   让字段列表一眼可扫, 不展开也能看到该字段在做什么。
// feat-round-11 A2: "测试此字段" 按钮(testContext 提供时显示)
//   复用既有 /api/admin/rules/test, 客户端过滤出本字段值, 内联 Popover 展示;
//   "查看高亮" 按钮内联展开 DebugHtmlViewer 聚焦本字段(mark 闪烁)。
// feat-round-11 A3: 未配置态的"添加"按钮升级为模板下拉
//   8 种常见字段模板(书名/作者/简介/封面/章节标题/章节链接/正文/最新章节)一键预填。
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  FlaskConical,
  Loader2,
  Sparkles,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type CleanConfig, type DebugMatch, type FetchConfig, type FieldRule, type PageRule, type RuleSection, type RuleTestResult } from './helpers'
import { DebugHtmlViewer } from './DebugHtmlViewer'

interface FieldRuleEditorProps {
  /** 字段名(中文标签) */
  label: string
  value?: FieldRule
  onChange: (rule: FieldRule | undefined) => void
  /** 表达式输入示例提示 */
  placeholder?: string
  /** feat-round-11 A2: 字段键(用于单字段测试过滤结果); 留空则不显示测试按钮 */
  fieldKey?: string
  /** feat-round-11 A2: 单字段测试所需上下文; 提供 + fieldKey 同时存在才显示"测试此字段"按钮 */
  testContext?: FieldTestContext
}

/** feat-round-11 A2: 单字段测试上下文 — 父组件透传本段配置 + 测试 URL */
export interface FieldTestContext {
  section: RuleSection
  pageRule: PageRule
  fetchConfig: FetchConfig
  /** 仅 content 段需要(与既有 TestPanel 同口径) */
  cleanConfig?: CleanConfig
  /** 预填测试地址(来自 TestPanel 的 URL 输入框) */
  defaultUrl?: string
}

const TYPE_OPTIONS: { value: FieldRule['type']; label: string }[] = [
  { value: 'css', label: 'CSS 选择器' },
  { value: 'xpath', label: 'XPath' },
  { value: 'regex', label: '正则表达式' },
  { value: 'json', label: 'JSON 路径' },
  { value: 'const', label: '常量模板' },
]

/** feat-round-11 A1: 类型 → 徽章颜色映射(css=blue / xpath=amber / regex=rose / json=emerald / const=zinc) */
const TYPE_BADGE_META: Record<FieldRule['type'], { label: string; className: string }> = {
  css: { label: 'CSS', className: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  xpath: { label: 'XPath', className: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  regex: { label: '正则', className: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  json: { label: 'JSON', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  const: { label: '常量', className: 'bg-zinc-600/30 text-zinc-300 border-zinc-500/40' },
}

/** feat-round-11 A3: 常见字段模板 — 一键预填 type/expression/attr */
const FIELD_TEMPLATES: { label: string; hint: string; rule: FieldRule }[] = [
  { label: '书名', hint: 'CSS · h1 · text', rule: { type: 'css', expression: 'h1', attr: 'text' } },
  { label: '作者', hint: 'CSS · .author · text', rule: { type: 'css', expression: '.author', attr: 'text' } },
  { label: '简介', hint: 'CSS · .intro · text', rule: { type: 'css', expression: '.intro', attr: 'text' } },
  { label: '封面', hint: 'CSS · img · src', rule: { type: 'css', expression: 'img', attr: 'src' } },
  { label: '章节标题', hint: 'CSS · a · text', rule: { type: 'css', expression: 'a', attr: 'text' } },
  { label: '章节链接', hint: 'CSS · a · href', rule: { type: 'css', expression: 'a', attr: 'href' } },
  { label: '正文', hint: 'CSS · #content · html', rule: { type: 'css', expression: '#content', attr: 'html' } },
  { label: '最新章节', hint: 'CSS · .latest · text', rule: { type: 'css', expression: '.latest', attr: 'text' } },
]

/** 表达式预览截断长度(spec: 40 字符) */
const EXPR_PREVIEW_MAX = 40
/** 单字段测试结果值截断长度(spec: 100 字符) */
const FIELD_VALUE_PREVIEW_MAX = 100

/** 按码点截断(避免代理对斩半) */
function cutByCodePoints(s: string, max: number): string {
  const arr = Array.from(s || '')
  if (arr.length <= max) return arr.join('')
  return arr.slice(0, max).join('') + '…'
}

export function FieldRuleEditor({ label, value, onChange, placeholder, fieldKey, testContext }: FieldRuleEditorProps) {
  const [advanced, setAdvanced] = useState(false)

  if (!value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <span className="text-xs text-zinc-500">{label} · 未配置</span>
        {/* feat-round-11 A3: 模板下拉 — 替代原单一"添加"按钮 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <Plus className="h-3.5 w-3.5" />
              添加
              <ChevronDown className="h-3 w-3 text-zinc-500" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-zinc-800 bg-zinc-900">
            <DropdownMenuLabel className="text-xs text-zinc-400">空白规则</DropdownMenuLabel>
            <DropdownMenuItem
              className="text-xs text-zinc-200"
              onClick={() => onChange({ type: 'css', expression: '', attr: 'text', stripTags: false })}
            >
              <Sparkles className="h-3.5 w-3.5 text-zinc-500" />
              从空白开始
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuLabel className="text-xs text-zinc-400">常用模板</DropdownMenuLabel>
            {FIELD_TEMPLATES.map((t) => (
              <DropdownMenuItem
                key={t.label}
                className="flex flex-col items-start gap-0.5 text-xs text-zinc-200"
                onClick={() => onChange({ ...t.rule, stripTags: false })}
              >
                <span className="font-medium">{t.label}</span>
                <span className="font-mono text-[10px] text-zinc-500">{t.hint}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  const patch = (p: Partial<FieldRule>) => onChange({ ...value, ...p })
  const isRegex = value.type === 'regex'
  // json/const 模式不消费取值方式(attr 无意义, 与 types.ts FieldRule 注释口径一致)
  const isPlain = value.type === 'json' || value.type === 'const'
  const expressionEmpty = !value.expression || !value.expression.trim()
  const canTest = !!(testContext && fieldKey && !expressionEmpty)
  // feat-round-11 A1: attr 仅在 css/xpath/regex 三型有意义(json/const 不展示 attr pill)
  const showAttrPill = !isPlain && !!value.attr

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        {/* feat-round-11 A1: 紧凑摘要徽章 — 标签 + 类型徽章 + 表达式预览 + attr pill */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-zinc-300">{label}</span>
          {/* 类型徽章 */}
          <span
            className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-medium ${TYPE_BADGE_META[value.type].className}`}
            title={TYPE_OPTIONS.find((t) => t.value === value.type)?.label || value.type}
          >
            {TYPE_BADGE_META[value.type].label}
          </span>
          {/* 表达式预览 */}
          <span
            className="min-w-0 max-w-[200px] truncate font-mono text-[11px] text-zinc-400"
            title={value.expression || '未配置'}
          >
            {value.expression ? cutByCodePoints(value.expression, EXPR_PREVIEW_MAX) : <span className="text-zinc-600">未配置</span>}
          </span>
          {/* attr pill */}
          {showAttrPill && (
            <span className="inline-flex h-5 shrink-0 items-center rounded bg-zinc-800 px-1 text-[10px] text-zinc-400" title={`取值方式: ${value.attr}`}>
              {isRegex ? `组${value.attr}` : value.attr}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* feat-round-11 A2: 单字段测试按钮 */}
          {canTest && <FieldTestButton label={label} fieldKey={fieldKey!} testContext={testContext!} />}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-zinc-500 hover:text-red-400"
            title="移除该字段规则"
            onClick={() => onChange(undefined)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[130px_1fr]">
        <Select value={value.type} onValueChange={(v) => patch({ type: v as FieldRule['type'] })}>
          <SelectTrigger className="h-8 border-zinc-700 bg-zinc-950 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className={`h-8 border-zinc-700 bg-zinc-950 font-mono text-xs ${expressionEmpty ? 'border-red-500/60' : ''}`}
          placeholder={placeholder || '提取表达式'}
          value={value.expression}
          onChange={(e) => patch({ expression: e.target.value })}
        />
      </div>
      {expressionEmpty && <div className="mt-1 text-[11px] text-red-400/80">表达式为空, 该字段将被忽略</div>}

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <Label className="w-14 shrink-0 text-right text-xs text-zinc-500">
            {isRegex ? '捕获组' : '取值'}
          </Label>
          <Input
            className="h-8 flex-1 border-zinc-700 bg-zinc-950 font-mono text-xs"
            placeholder={
              isRegex
                ? '捕获组序号, 如 1'
                : isPlain
                  ? 'json/const 类型不使用取值方式'
                  : 'text / html / href / src / 属性名'
            }
            disabled={isPlain}
            value={value.attr || ''}
            onChange={(e) => patch({ attr: e.target.value || undefined })}
          />
        </div>
        <button
          type="button"
          className="flex items-center gap-1 self-center text-xs text-zinc-500 hover:text-zinc-300"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          后处理选项
        </button>
      </div>

      {advanced && (
        <div className="mt-2 space-y-2 rounded border border-zinc-800 bg-zinc-950/60 p-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`strip-${label}`}
              checked={!!value.stripTags}
              onCheckedChange={(v) => patch({ stripTags: v === true })}
              className="border-zinc-600"
            />
            <Label htmlFor={`strip-${label}`} className="text-xs text-zinc-400">
              剔除 HTML 标签(只留文本)
            </Label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <Label className="w-14 shrink-0 text-right text-xs text-zinc-500">替换源</Label>
              <Input
                className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs"
                placeholder="支持正则"
                value={value.replaceFrom || ''}
                onChange={(e) => patch({ replaceFrom: e.target.value || undefined })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-14 shrink-0 text-right text-xs text-zinc-500">替换为</Label>
              <Input
                className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs"
                placeholder="空串可删除"
                value={value.replaceTo || ''}
                onChange={(e) => patch({ replaceTo: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="w-14 shrink-0 text-right text-xs text-zinc-500">截取第</Label>
            <Input
              type="number"
              className="h-8 w-20 border-zinc-700 bg-zinc-950 text-xs"
              placeholder="序号"
              value={value.index ?? ''}
              onChange={(e) => patch({ index: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
            <span className="text-xs text-zinc-600">项(逗号分隔结果, 留空不截取)</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// feat-round-11 A2: FieldTestButton — 单字段测试触发 + 结果 Popover
// 复用既有 /api/admin/rules/test 路由(发送完整 section 配置), 客户端过滤出本字段值。
// "查看高亮" 按钮内联展开 DebugHtmlViewer 聚焦本字段(mark 闪烁), 与 TestPanel 同款 IFRAME_CSS。
// ============================================================
interface FieldTestButtonProps {
  label: string
  fieldKey: string
  testContext: FieldTestContext
}

interface FieldTestState {
  loading: boolean
  error: string
  result: RuleTestResult | null
  /** 客户端过滤出的本字段值(取首条匹配; book 段/ content 段直接取唯一值) */
  fieldValue: string
  /** debugMatches 中本字段的首条匹配(用于"查看高亮"定位) */
  matchIdx: number
  /** 是否已展开 DebugHtmlViewer */
  showDebug: boolean
}

function FieldTestButton({ label, fieldKey, testContext }: FieldTestButtonProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<FieldTestState>({
    loading: false,
    error: '',
    result: null,
    fieldValue: '',
    matchIdx: 0,
    showDebug: false,
  })
  const aliveRef = useRef(true)
  // 测试 URL 输入框(预填 testContext.defaultUrl, 用户可改)
  const [url, setUrl] = useState(testContext.defaultUrl || '')

  // 挂载/重挂载时复位 aliveRef(与 TestPanel 同款 StrictMode 兼容做法)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 注: 不在 effect 中同步 defaultUrl → url(避免 set-state-in-effect 反模式);
  // 改在 Popover 打开时刷新(handleOpenChange), 关闭时保留用户编辑过的 URL

  const runTest = async () => {
    if (!url.trim()) {
      toast.error('请先在右侧测试面板填入测试 URL')
      return
    }
    setState({ loading: true, error: '', result: null, fieldValue: '', matchIdx: 0, showDebug: false })
    try {
      const data = await api.post<RuleTestResult>('/api/admin/rules/test', {
        section: testContext.section,
        url: url.trim(),
        rule: testContext.pageRule,
        fetch: testContext.fetchConfig,
        // 清洗配置仅在 content 段生效(后端只在该段消费), 与 TestPanel 同口径
        ...(testContext.section === 'content' && testContext.cleanConfig ? { clean: testContext.cleanConfig } : {}),
      })
      if (!aliveRef.current) return
      // 客户端过滤: 从 debugMatches 找本字段首条匹配; 兜底走 fields/sample
      const matches = (data.debugMatches || []) as DebugMatch[]
      const firstMatch = matches.find((m) => m.field === fieldKey)
      let fieldValue = ''
      let matchIdx = 0
      if (firstMatch) {
        fieldValue = firstMatch.value
        matchIdx = firstMatch.idx
      } else if (data.fields && typeof data.fields === 'object') {
        // book 段: fields 是 Record<string, string>
        fieldValue = (data.fields as Record<string, string>)[fieldKey] || ''
      } else if (Array.isArray(data.sample) && data.sample.length > 0) {
        // list/toc 段: sample 是 Record<string, string>[]
        const first = data.sample[0] as Record<string, string>
        fieldValue = first?.[fieldKey] || ''
      } else if (fieldKey === 'content' && data.cleanedText) {
        fieldValue = data.cleanedText
      }
      setState({ loading: false, error: '', result: data, fieldValue, matchIdx, showDebug: false })
    } catch (e) {
      if (!aliveRef.current) return
      setState({
        loading: false,
        error: e instanceof Error ? e.message : '测试失败',
        result: null,
        fieldValue: '',
        matchIdx: 0,
        showDebug: false,
      })
    }
  }

  // Popover 打开时刷新 URL(从父组件 testContext.defaultUrl 拿最新值, 避免陈旧);
  // 关闭时复位内部结果状态(下次打开为干净态)。
  // 放在事件处理器而非 effect 中, 避开 set-state-in-effect 反模式。
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setUrl(testContext.defaultUrl || '')
    }
    setState({ loading: false, error: '', result: null, fieldValue: '', matchIdx: 0, showDebug: false })
  }

  const hasDebugHtml = !!(state.result?.debugHtml)
  const valuePreview = cutByCodePoints(state.fieldValue, FIELD_VALUE_PREVIEW_MAX)

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
          title={`单独测试此字段(${fieldKey})`}
        >
          <FlaskConical className="h-3 w-3" />
          测试
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-80 border-zinc-800 bg-zinc-900 p-3 text-zinc-200"
      >
        <div className="mb-2 flex items-center gap-1.5">
          <FlaskConical className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-xs font-medium text-zinc-200">单字段测试</span>
          <span className="text-[10px] text-zinc-500">{label}</span>
          <span className="ml-auto font-mono text-[10px] text-zinc-600">{fieldKey}</span>
        </div>

        {/* URL 输入 + 测试按钮 */}
        <div className="flex gap-1.5">
          <Input
            className="h-7 flex-1 border-zinc-700 bg-zinc-950 font-mono text-[11px]"
            placeholder="测试 URL(取自右侧测试面板)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !state.loading) runTest()
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={state.loading}
            onClick={runTest}
          >
            {state.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
            运行
          </Button>
        </div>

        {/* 错误 */}
        {state.error && (
          <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-400">
            {state.error}
          </div>
        )}

        {/* 结果: 字段值 */}
        {state.result && !state.error && (
          <div className="mt-2 space-y-2">
            <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
                <span>提取值</span>
                <span>{state.fieldValue.length} 字符</span>
              </div>
              <div className="admin-scroll max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-200">
                {valuePreview || <span className="italic text-zinc-600">(空)</span>}
              </div>
            </div>

            {/* 元信息 */}
            <div className="flex flex-wrap gap-1.5 text-[10px] text-zinc-500">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">
                {state.result.engine === 'browser' ? '浏览器渲染' : state.result.engine === 'http' ? 'HTTP直连' : state.result.engine}
              </span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">{state.result.ms}ms</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">
                HTML {(state.result.htmlSize / 1024).toFixed(1)}KB
              </span>
            </div>

            {/* 查看高亮按钮 */}
            {hasDebugHtml ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-full gap-1.5 border-zinc-700 bg-transparent text-[11px] text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
                onClick={() => setState((s) => ({ ...s, showDebug: !s.showDebug }))}
              >
                <Eye className="h-3 w-3" />
                {state.showDebug ? '收起高亮' : '查看高亮'}
              </Button>
            ) : (
              <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-[10px] text-zinc-600">
                该字段类型({state.result.type})无 DOM 高亮(仅 CSS 型可定位元素)
              </div>
            )}

            {/* 内联 DebugHtmlViewer — activeMatch 聚焦本字段, 与 TestPanel 同款 iframe */}
            {state.showDebug && hasDebugHtml && (
              <div className="overflow-hidden rounded border border-zinc-800">
                <DebugHtmlViewer
                  debugHtml={state.result!.debugHtml || ''}
                  rawHtml={state.result!.rawHtml || ''}
                  activeMatch={{ field: fieldKey, idx: state.matchIdx }}
                />
              </div>
            )}
          </div>
        )}

        {/* 空闲态提示 */}
        {!state.result && !state.loading && !state.error && (
          <div className="mt-2 text-[10px] leading-relaxed text-zinc-600">
            复用本段完整规则测试, 仅在结果中过滤出 <span className="font-mono text-zinc-400">{fieldKey}</span> 字段值;
            首次需要抓取目标页面, 耗时与右侧测试面板一致。
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
