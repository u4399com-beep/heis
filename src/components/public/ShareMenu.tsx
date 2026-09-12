// ============================================================
// 分享菜单 — 复制链接 + 微信/QQ/微博 社交分享
// R7-20 GG 新增:
//   - 复制当前 pseudostatic URL 到剪贴板 (navigator.clipboard 兜底 execCommand)
//   - 微信: 无 deeplink, 显示二维码弹层让用户扫码 (微信内浏览器才支持直接 share)
//   - QQ:    https://connect.qq.com/widget/shareqq/index.html?url=...&title=...&desc=...
//   - 微博:  https://service.weibo.com/share/share.php?url=...&title=...
// 兼容 SSR: 服务端不访问 window/navigator, 仅在 onClick 内取值
// ============================================================
'use client'

import { useState } from 'react'
import { Check, Link2, MessageCircle, QrCode, Share2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePublic } from './ctx'
import { withAlpha } from './seo'

interface ShareMenuProps {
  /** 分享标题 (书名 + 章节名等); 默认用 document.title */
  title?: string
  /** 分享描述 (简介片段); 默认空 */
  desc?: string
  /** 触发按钮自定义 className / Style */
  triggerClassName?: string
  triggerStyle?: React.CSSProperties
}

/** 微信分享二维码弹层 (SVG data URI 内嵌, 无外部依赖) */
function WechatQrDialog({ url, onClose }: { url: string; onClose: () => void }) {
  // 简易 QR (用 Google Chart API 兜底; 离线/隐私模式直接显示链接文本)
  // 注意: 这是个 GET 图像, 不传 cookie/credentials; 网络不通时降级显示 URL 文本
  const qrSrc = `https://chart.googleapis.com/chart?cht=qr&chs=240x240&chl=${encodeURIComponent(url)}&choe=UTF-8`
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="微信扫码分享"
      onClick={onClose}
    >
      <div
        className="mx-4 max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-sm font-bold text-zinc-800 dark:text-zinc-100">微信扫一扫分享</p>
        <div className="mx-auto mb-3 h-56 w-56 overflow-hidden rounded-lg bg-white">
          <img
            src={qrSrc}
            alt="微信分享二维码"
            className="h-full w-full"
            onError={(e) => {
              // 降级: 显示 URL 文本
              const t = e.currentTarget.parentElement
              if (t) {
                t.innerHTML = `<p class="break-all px-3 py-6 text-xs text-zinc-600">${url}</p>`
              }
            }}
          />
        </div>
        <p className="mb-3 break-all text-[11px] text-zinc-500 dark:text-zinc-400">{url}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-700 transition-opacity hover:opacity-80 dark:bg-zinc-800 dark:text-zinc-200"
        >
          关闭
        </button>
      </div>
    </div>
  )
}

export function ShareMenu({ title, desc, triggerClassName, triggerStyle }: ShareMenuProps) {
  const { theme } = usePublic()
  const v = theme.vars
  const [copied, setCopied] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  /** 安全获取当前 URL (SSR 时返回空串) */
  const getCurrentUrl = (): string => {
    if (typeof window === 'undefined') return ''
    return window.location.href
  }

  /** 安全获取标题 */
  const getTitle = (): string => title || (typeof document !== 'undefined' ? document.title : '') || ''

  /** 复制到剪贴板 — navigator.clipboard 优先, 兜底 execCommand */
  const copyLink = async (url: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url)
        return true
      }
    } catch {
      /* fall through to execCommand */
    }
    try {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      ta.style.pointerEvents = 'none'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }

  const onCopy = async () => {
    const url = getCurrentUrl()
    if (!url) return
    const ok = await copyLink(url)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  const onShareQQ = () => {
    const url = getCurrentUrl()
    const t = getTitle()
    const u = `https://connect.qq.com/widget/shareqq/index.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(t)}&desc=${encodeURIComponent(desc || '')}`
    window.open(u, '_blank', 'noopener,noreferrer')
  }

  const onShareWeibo = () => {
    const url = getCurrentUrl()
    const t = getTitle()
    const u = `https://service.weibo.com/share/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(t)}`
    window.open(u, '_blank', 'noopener,noreferrer')
  }

  const onShareWechat = () => {
    setQrOpen(true)
  }

  const itemStyle: React.CSSProperties = {
    color: v.text,
    background: 'transparent',
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={triggerClassName || 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-opacity hover:opacity-85'}
            style={triggerStyle || {
              border: `1px solid ${withAlpha(v.border, 0.7)}`,
              color: v.text,
              borderRadius: v.radius,
              background: v.surfaceAlt,
            }}
            aria-label="分享"
            aria-haspopup="menu"
          >
            <Share2 className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">分享</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[180px]"
          style={{ background: v.surface, border: `1px solid ${v.border}`, color: v.text, borderRadius: v.radius }}
        >
          <DropdownMenuItem onClick={onCopy} style={itemStyle} aria-label="复制链接">
            {copied ? (
              <Check className="mr-2 h-4 w-4 text-green-500" aria-hidden />
            ) : (
              <Link2 className="mr-2 h-4 w-4" aria-hidden />
            )}
            <span>{copied ? '已复制' : '复制链接'}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onShareWechat} style={itemStyle} aria-label="分享到微信">
            <MessageCircle className="mr-2 h-4 w-4 text-green-600" aria-hidden />
            <span>微信扫一扫</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onShareQQ} style={itemStyle} aria-label="分享到 QQ">
            <QrCode className="mr-2 h-4 w-4 text-blue-500" aria-hidden />
            <span>分享到 QQ</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onShareWeibo} style={itemStyle} aria-label="分享到微博">
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#e6162d' }} aria-hidden>
              <path d="M9.31 8.17c-3.43.86-6.06 3.34-6.06 6.43 0 3.62 3.74 6.55 8.36 6.55s8.36-2.93 8.36-6.55c0-3.46-3.16-6.27-7.13-6.55-.26-.04-.69-.04-.96 0-.27.03-.27.13.06.21.69.21 1.66.62 1.66 1.61 0 .86-.71 1.4-1.66 1.61-.83.18-1.31.21-1.31.21s1.27.13 1.69-.07c.43-.21.83-.43.83-.86 0-.39-.27-.66-.69-.83-.27-.13-.39-.16-.39-.16zM10.97 13.62c-.07.13-.07.21-.21.34-.07.13-.21.21-.34.21s-.27-.07-.34-.21l-2.21-3.27c-.07-.13-.07-.27.07-.34.07-.07.21-.07.34 0l2.55 1.95c.13.07.21.21.21.34 0 .07-.07.13-.07.21z" />
              <path d="M19.4 4.7c-.34-.34-.86-.43-1.36-.27-.13.07-.21.13-.21.27 0 .13.07.21.21.27.27.07.55.21.71.43.21.21.34.5.34.86 0 .13.07.21.21.27.13.07.27.07.34 0 .13-.07.21-.21.21-.34.07-.55-.07-1.07-.45-1.49zM21.4 2.6c-.86-.86-2.13-1.16-3.27-.86-.27.07-.43.27-.43.55 0 .27.21.5.43.55.27.07.55.13.86.27.43.21.71.43.99.71.27.27.5.55.71.99.13.27.21.55.27.86.07.21.27.43.55.43.27 0 .5-.21.55-.43.07-.43.07-.86.07-1.36-.13-1.07-.55-2.13-1.36-2.86z" />
            </svg>
            <span>分享到微博</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {qrOpen && <WechatQrDialog url={getCurrentUrl()} onClose={() => setQrOpen(false)} />}
    </>
  )
}
