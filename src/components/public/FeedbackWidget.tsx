// ============================================================
// FeedbackWidget — 前台悬浮反馈按钮 + 弹窗
// 浮动按钮 fixed bottom-right (z-40), 移动端略小; 点击展开 Dialog
// 类型 4 卡片: bug/suggestion/praise/other (红/琥珀/粉/锌 配色)
// 字数计数 5~1000; 可选联系方式; 隐私提示
// ============================================================
'use client'

import { useState } from 'react'
import {
  Bug,
  Heart,
  Lightbulb,
  Loader2,
  MessageCircle,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type FeedbackType = 'bug' | 'suggestion' | 'praise' | 'other'

interface TypeOption {
  value: FeedbackType
  label: string
  desc: string
  Icon: typeof Bug
  /** 色调: icon 圆背景 + 选中描边/底色 */
  ring: string
  iconColor: string
  selectedBg: string
  selectedBorder: string
  hoverBorder: string
}

const TYPES: TypeOption[] = [
  {
    value: 'bug',
    label: '问题反馈',
    desc: '页面错误 / 加载失败 / 操作异常',
    Icon: Bug,
    ring: 'bg-red-500/15',
    iconColor: 'text-red-400',
    selectedBg: 'bg-red-950/30',
    selectedBorder: 'border-red-500',
    hoverBorder: 'hover:border-red-500/60',
  },
  {
    value: 'suggestion',
    label: '功能建议',
    desc: '希望增加 / 改进的特性',
    Icon: Lightbulb,
    ring: 'bg-amber-500/15',
    iconColor: 'text-amber-400',
    selectedBg: 'bg-amber-950/30',
    selectedBorder: 'border-amber-500',
    hoverBorder: 'hover:border-amber-500/60',
  },
  {
    value: 'praise',
    label: '表扬鼓励',
    desc: '体验很好, 给作者加鸡腿',
    Icon: Heart,
    ring: 'bg-pink-500/15',
    iconColor: 'text-pink-400',
    selectedBg: 'bg-pink-950/30',
    selectedBorder: 'border-pink-500',
    hoverBorder: 'hover:border-pink-500/60',
  },
  {
    value: 'other',
    label: '其他',
    desc: '合作 / 投诉 / 内容举报',
    Icon: MessageCircle,
    ring: 'bg-zinc-500/15',
    iconColor: 'text-zinc-300',
    selectedBg: 'bg-zinc-800/40',
    selectedBorder: 'border-zinc-400',
    hoverBorder: 'hover:border-zinc-500/60',
  },
]

const CONTENT_MIN = 5
const CONTENT_MAX = 1000
const CONTACT_MAX = 100

export function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('bug')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const contentLen = content.length
  const contentValid = contentLen >= CONTENT_MIN && contentLen <= CONTENT_MAX
  const canSubmit = contentValid && !submitting

  const reset = () => {
    setType('bug')
    setContent('')
    setContact('')
  }

  const onSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/public/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          content: content.trim(),
          contact: contact.trim(),
          url: typeof window !== 'undefined' ? window.location.href : '',
        }),
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null
      if (!j?.ok) {
        const msg = j?.message || j?.error || '提交失败, 请稍后再试'
        toast.error(msg)
        return
      }
      toast.success('感谢反馈！我们会尽快处理')
      setOpen(false)
      reset()
    } catch {
      toast.error('网络异常, 请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* 浮动按钮 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="提交反馈"
        className="feedback-fab fixed bottom-5 right-5 z-40 inline-flex items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-950/50 transition-transform hover:bg-violet-500 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
      >
        <MessageCircle className="h-5 w-5" aria-hidden />
        <span className="sr-only">反馈</span>
      </button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) {
            // 关闭后稍延重置, 避免 dialog 关闭动画期表单闪烁空态
            setTimeout(reset, 200)
          }
        }}
      >
        <DialogContent className="border-zinc-700 bg-zinc-900 text-zinc-100 sm:max-w-[min(520px,96vw)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4 text-violet-400" aria-hidden />
              意见反馈
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              遇到问题或有想法？告诉我们, 让站点变得更好
            </DialogDescription>
          </DialogHeader>

          {/* 类型 4 卡片 2x2 */}
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map((t) => {
              const active = type === t.value
              const Icon = t.Icon
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  aria-pressed={active}
                  className={`flex items-start gap-2.5 rounded-md border p-3 text-left transition-colors ${
                    active
                      ? `${t.selectedBorder} ${t.selectedBg}`
                      : `border-zinc-700 ${t.hoverBorder} hover:bg-zinc-800/60`
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${t.ring} ${t.iconColor}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-zinc-100">{t.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-zinc-500">{t.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* 内容 textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="feedback-content" className="text-xs font-medium text-zinc-300">
                反馈内容 <span className="text-red-400">*</span>
              </label>
              <span
                className={`text-[10px] tabular-nums ${
                  contentLen > CONTENT_MAX ? 'text-red-400' : contentLen >= CONTENT_MIN ? 'text-zinc-400' : 'text-zinc-600'
                }`}
              >
                {contentLen}/{CONTENT_MAX}
              </span>
            </div>
            <Textarea
              id="feedback-content"
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, CONTENT_MAX))}
              placeholder="请详细描述你遇到的问题或想法 (5~1000 字)..."
              className="min-h-28 resize-y border-zinc-700 bg-zinc-950/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:border-violet-500 focus-visible:ring-violet-500/30"
              maxLength={CONTENT_MAX}
              aria-label="反馈内容"
            />
          </div>

          {/* 联系方式 */}
          <div className="space-y-1.5">
            <label htmlFor="feedback-contact" className="text-xs font-medium text-zinc-300">
              联系方式 <span className="text-zinc-600">(可选)</span>
            </label>
            <Input
              id="feedback-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value.slice(0, CONTACT_MAX))}
              placeholder="邮箱/QQ (可选, 方便我们回复)"
              maxLength={CONTACT_MAX}
              className="h-9 border-zinc-700 bg-zinc-950/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:border-violet-500 focus-visible:ring-violet-500/30"
              aria-label="联系方式"
            />
          </div>

          {/* 隐私提示 */}
          <p className="flex items-center gap-1.5 text-[10px] leading-snug text-zinc-500">
            <ShieldCheck className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden />
            反馈内容将包含当前页面地址和浏览器信息, 用于问题定位
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-violet-600 hover:bg-violet-500"
              onClick={onSubmit}
              disabled={!canSubmit}
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              提交反馈
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
