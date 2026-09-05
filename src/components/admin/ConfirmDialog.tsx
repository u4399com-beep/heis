"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * 管理端通用确认对话框 — 封装 AlertDialog 确认弹窗样板（rr 轮 cleanup-report 整合机会① 的落地）。
 *
 * 形态基线：迁移自管理端 17 处受控 AlertDialog 确认弹窗，骨架全等：
 * Content(zinc-900 底/zinc-800 描边) + Title(zinc-100) + Description(zinc-400)
 * + Cancel(zinc 描边钮"取消") + Action(色调确认钮)。
 *
 * 行为契约（与既有用例零差异）：
 * - onConfirm 直传 AlertDialogAction 的 onClick：Radix Action 点击即自动关闭（先回调后关闭），
 *   关闭经 onOpenChange(false) 通知调用方清状态；Escape / 点遮罩 / 取消钮走同一通道。
 * - 回调返回 Promise 时不拦截关闭（与既有 fire-and-forget 形态一致），
 *   异步错误处理沿用项目惯例（回调内 try/catch + toast）。
 * - loading=true 时确认钮禁用并显示 spinner（对应批量操作运行中防重复点击形态）。
 */

const CONFIRM_TONE_CLASS = {
  /** 删除类（红） */
  danger: "bg-red-600 text-white hover:bg-red-700",
  /** 重操作类（琥珀：繁转简 / 章节标记未采） */
  amber: "bg-amber-600 text-white hover:bg-amber-700",
  /** 增量任务类（青：重采-增量更新） */
  teal: "bg-teal-600 text-white hover:bg-teal-700",
} as const

export type ConfirmTone = keyof typeof CONFIRM_TONE_CLASS

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description: React.ReactNode
  /** 确认钮文案，默认"确认" */
  confirmText?: React.ReactNode
  /** 取消钮文案，默认"取消" */
  cancelText?: React.ReactNode
  /** 确认钮色调，默认 danger */
  tone?: ConfirmTone
  /** 确认回调，可为异步；点击后对话框照常关闭，错误处理归回调 */
  onConfirm?: () => void | Promise<void>
  /** 置真时确认钮禁用 + spinner（由调用方状态驱动，如批量运行中） */
  loading?: boolean
  /** 仅禁用确认钮（无 spinner） */
  confirmDisabled?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  tone = "danger",
  onConfirm,
  loading = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-zinc-800 bg-zinc-900">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-zinc-100">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-zinc-400">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800">
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            className={CONFIRM_TONE_CLASS[tone]}
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
