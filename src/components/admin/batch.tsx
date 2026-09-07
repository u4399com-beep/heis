'use client'

// ============================================================
// 批量操作共享设施 — 多选状态 / 复选框 / 批量操作条 / 统一执行器
// 设计:
// - useBatchSelection: 跨渲染保留 Set(翻页/轮询刷新不丢已选), toggleAll 支持半选态
// - BatchCheckbox: 暗色 zinc/violet 配色, 支持 indeterminate
// - BatchBar: 已选 N 项 + 动作插槽 + 取消选择
// - BatchActionButton: running 防重(批量请求进行中一律禁用)
// - runBatch: 统一 {ok, data:{affected, skipped}} 解包 + toast
// ============================================================
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from './helpers'

// ---------------- 结果类型 ----------------

/** 服务端批量结果的跳过项 */
export interface BatchSkipped {
  name?: string
  reason: string
}

/** 服务端批量结果 data 部分(各路由可附额外字段) */
export interface BatchOutcome {
  /** 实际处理成功数(缺失记录一律降级为跳过, 不计入) */
  affected?: number
  skipped?: BatchSkipped[]
  /** books/batch t2s 附加 */
  chapters?: number
  txtFailed?: number
  noop?: boolean
  /** categories/batch delete force 附加 */
  booksDetached?: number
  [key: string]: unknown
}

// ---------------- 多选状态 ----------------

/**
 * 多选状态 hook: 已选集合为跨渲染保留的 Set —
 * 翻页/3s轮询导致 rows 更新后已选项不丢失, 仅由 clearSelection(或批量成功后)显式清空。
 * toggleAll 为"当前行集"语义: 全选中→取消本页行; 部分/未选→补齐本页行(半选态展示在 BatchCheckbox)。
 */
export function useBatchSelection(rowIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const all = rowIds.length > 0 && rowIds.every((id) => prev.has(id))
      const next = new Set(prev)
      for (const id of rowIds) {
        if (all) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [rowIds])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const selectedCount = selected.size
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id))
  const indeterminate = !allSelected && rowIds.some((id) => selected.has(id))

  /** 按勾选先后顺序返回已选 id(Set 保持插入序 — 分类"按勾选顺序重排"依赖此顺序) */
  const selectedOrdered = useMemo(() => Array.from(selected), [selected])

  return { selected, selectedOrdered, selectedCount, allSelected, indeterminate, toggle, toggleAll, clearSelection }
}

// ---------------- 复选框 ----------------

/** 暗色复选框: zinc 边框 / violet 选中, 支持 indeterminate 半选态; stopPropagation 防误触行事件 */
export function BatchCheckbox({
  checked,
  indeterminate,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel: string
}) {
  return (
    <Checkbox
      aria-label={ariaLabel}
      checked={indeterminate ? 'indeterminate' : checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      onClick={(e) => e.stopPropagation()}
      className="border-zinc-600 bg-zinc-950 data-[state=checked]:border-violet-500 data-[state=checked]:bg-violet-600 data-[state=checked]:text-white data-[state=indeterminate]:border-violet-500 data-[state=indeterminate]:bg-violet-600 data-[state=indeterminate]:text-white"
    />
  )
}

// ---------------- 批量操作条 ----------------

/** 批量操作条: 已选 N 项 + 动作插槽 + 取消选择; count 为 0 时不渲染 */
export function BatchBar({
  count,
  onClear,
  children,
  hint,
}: {
  count: number
  onClear: () => void
  children?: ReactNode
  hint?: string
}) {
  if (count <= 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-violet-500/10 px-4 py-2.5">
      <span className="text-xs font-medium text-violet-300">
        已选 <span className="font-mono">{count}</span> 项
      </span>
      {hint && <span className="hidden text-[10px] text-zinc-500 md:inline">{hint}</span>}
      <span className="mx-0.5 hidden h-4 w-px bg-zinc-700 sm:block" />
      {children}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
        onClick={onClear}
      >
        <X className="h-3 w-3" />
        取消选择
      </Button>
    </div>
  )
}

/** 批量动作按钮: running 期间禁用(防重), 自动展示加载态 */
export function BatchActionButton({
  running,
  disabled,
  className = '',
  title,
  onClick,
  children,
}: {
  running?: boolean
  disabled?: boolean
  className?: string
  title?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title={title}
      disabled={running || disabled}
      onClick={onClick}
      className={`h-7 gap-1 border-zinc-700 bg-zinc-950 px-2.5 text-xs hover:bg-zinc-800 ${className}`}
    >
      {running && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </Button>
  )
}

// ---------------- 统一执行器 ----------------

/**
 * 批量操作统一执行器: 请求 {ok,data:{affected,skipped}} 信封并按结果 toast。
 * - 成功: toast.success(描述或"已处理 N 项"); 有 skipped 时附前 3 条原因
 * - 失败: toast.error(服务端 message)
 * 返回 data 供调用方读取附加字段; 失败返回 null(toast 已提示, 调用方据此跳过清选/刷新)。
 */
export async function runBatch<T extends BatchOutcome = BatchOutcome>(
  url: string,
  body: Record<string, unknown>,
  describe?: (res: T) => string
): Promise<T | null> {
  try {
    const data = await api.post<T>(url, body)
    const affected = Number(data?.affected) || 0
    const skipped = Array.isArray(data?.skipped) ? data.skipped : []
    const base = describe?.(data) || `已处理 ${affected} 项`
    if (skipped.length > 0) {
      const detail = skipped
        .slice(0, 3)
        .map((s) => `${s.name ? `「${s.name}」` : ''}${s.reason}`)
        .join('; ')
      toast.success(base, {
        description: `${skipped.length} 项已跳过: ${detail}${skipped.length > 3 ? ' …' : ''}`,
      })
    } else {
      toast.success(base)
    }
    return data
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '批量操作失败')
    return null
  }
}
