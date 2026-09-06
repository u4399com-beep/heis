'use client'

// ============================================================
// StepIndicator — 可复用的多步骤指示器
// 圆点 + 连接线 + 文案; 完成态(绿+✓) / 当前态(紫环) / 未来态(灰)
// 移动端: 横向滚动 (admin-scroll 已由 AdminApp 全局注入)
// ============================================================
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StepIndicatorProps {
  /** 步骤标签数组 (按顺序) */
  steps: string[]
  /** 当前步骤索引 (0-based) */
  current: number
  className?: string
}

export function StepIndicator({ steps, current, className }: StepIndicatorProps) {
  const safeCurrent = Math.max(0, Math.min(current, steps.length - 1))
  return (
    <div className={cn('w-full', className)}>
      <div className="admin-scroll overflow-x-auto pb-1">
        <ol className="flex min-w-max items-start gap-1 px-1">
          {steps.map((label, i) => {
            const completed = i < safeCurrent
            const active = i === safeCurrent
            const last = i === steps.length - 1
            return (
              <li
                key={`${label}-${i}`}
                className="flex flex-col items-center text-center"
                style={{ minWidth: '5rem', flex: last && last ? '0 0 auto' : '1 1 0' }}
              >
                <div className="flex w-full items-center">
                  {/* 左连线 (首步隐藏) */}
                  <div
                    aria-hidden
                    className={cn(
                      'h-0.5 flex-1 transition-colors',
                      i === 0 ? 'opacity-0' : completed ? 'bg-emerald-500' : active ? 'bg-zinc-700' : 'bg-zinc-800',
                    )}
                  />
                  {/* 圆点 */}
                  <div
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                      completed && 'border-emerald-500 bg-emerald-500 text-white',
                      active && 'border-violet-500 bg-zinc-900 text-violet-300 ring-2 ring-violet-500/40',
                      !completed && !active && 'border-zinc-700 bg-zinc-900 text-zinc-600',
                    )}
                  >
                    {completed ? <Check className="size-4" aria-hidden /> : <span className="text-xs font-semibold tabular-nums">{i + 1}</span>}
                  </div>
                  {/* 右连线 (末步隐藏) */}
                  <div
                    aria-hidden
                    className={cn(
                      'h-0.5 flex-1 transition-colors',
                      last ? 'opacity-0' : completed ? 'bg-emerald-500' : 'bg-zinc-800',
                    )}
                  />
                </div>
                <span
                  className={cn(
                    'mt-1.5 text-[10px] leading-tight transition-colors',
                    active ? 'font-medium text-violet-300' : completed ? 'text-zinc-300' : 'text-zinc-500',
                  )}
                >
                  {label}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
