'use client'

// ============================================================
// FieldRule 编辑器 — 可复用的单字段提取规则编辑组件
// 支持 css选择器 / XPath / 正则表达式 三种提取方式
// ============================================================
import { useState } from 'react'
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
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import type { FieldRule } from './helpers'

interface FieldRuleEditorProps {
  /** 字段名(中文标签) */
  label: string
  value?: FieldRule
  onChange: (rule: FieldRule | undefined) => void
  /** 表达式输入示例提示 */
  placeholder?: string
}

const TYPE_OPTIONS: { value: FieldRule['type']; label: string }[] = [
  { value: 'css', label: 'CSS 选择器' },
  { value: 'xpath', label: 'XPath' },
  { value: 'regex', label: '正则表达式' },
  { value: 'json', label: 'JSON 路径' },
  { value: 'const', label: '常量模板' },
]

export function FieldRuleEditor({ label, value, onChange, placeholder }: FieldRuleEditorProps) {
  const [advanced, setAdvanced] = useState(false)

  if (!value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <span className="text-xs text-zinc-500">{label} · 未配置</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-200"
          onClick={() =>
            onChange({ type: 'css', expression: '', attr: 'text', stripTags: false })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
    )
  }

  const patch = (p: Partial<FieldRule>) => onChange({ ...value, ...p })
  const isRegex = value.type === 'regex'
  // json/const 模式不消费取值方式(attr 无意义, 与 types.ts FieldRule 注释口径一致)
  const isPlain = value.type === 'json' || value.type === 'const'
  const expressionEmpty = !value.expression || !value.expression.trim()

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
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
