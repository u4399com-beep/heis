'use client'

// ============================================================
// feat-round-11 B3: InstallPrompt — "安装到主屏幕" 横幅
// 监听 beforeinstallprompt 事件, 捕获 deferredPrompt, 展示底部居中横幅;
// 用户点击"安装" → 调用 prompt() + 记录用户选择;
// appinstalled 事件触发 → 隐藏横幅 + toast "已安装";
// 关闭后 localStorage 标记 dismissedAt, 7 天内不再展示。
// 仅在 PWA 安装条件满足时(浏览器发出 beforeinstallprompt)才会显示。
// ============================================================
import { useEffect, useState } from 'react'
import { Download, X, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

const DISMISS_KEY = 'heis:pwa-install-dismissed'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < DISMISS_TTL_MS
  } catch {
    return false
  }
}

function markDismissed(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    /* localStorage 不可用(隐私模式) — 静默降级, 仅本次会话不显示 */
  }
}

export function InstallPrompt() {
  // 懒初始化: 检测当前是否已 standalone 模式(ios Safari / Android PWA 已安装)
  // 在 useState initializer 中同步检测, 避免 effect 内 set-state 反模式
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [installed, setInstalled] = useState(() => {
    if (typeof window === 'undefined') return false
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // iOS Safari 不支持 display-mode: standalone, 用 navigator.standalone 兜底
      (window.navigator as { standalone?: boolean }).standalone === true
    return standalone
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    // 已安装(standalone)则不再监听 beforeinstallprompt(installed state 已懒初始化)
    if (installed) return

    const onBeforeInstall = (e: Event) => {
      // 阻止浏览器默认 mini-info-bar(Chrome 76+ 默认不再弹, 但保险)
      e.preventDefault()
      // 已被用户主动关闭且在 7 天 TTL 内 → 不再展示
      if (isDismissed()) return
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    const onInstalled = () => {
      setInstalled(true)
      setVisible(false)
      setDeferred(null)
      toast.success('已安装, 可在主屏幕打开')
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [installed])

  // 已安装或不展示 → 不渲染
  if (installed || !visible || !deferred) return null

  const handleInstall = async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === 'accepted') {
        // 安装成功 — appinstalled 事件会接管隐藏+toast, 这里仅清 deferred
        setDeferred(null)
        setVisible(false)
      } else {
        // 用户取消 — 视为 dismiss, 7 天内不再展示
        markDismissed()
        setDeferred(null)
        setVisible(false)
      }
    } catch {
      // prompt() 抛错(浏览器策略变化) — 静默关闭, 不打扰
      setDeferred(null)
      setVisible(false)
    }
  }

  const handleClose = () => {
    markDismissed()
    setVisible(false)
    setDeferred(null)
  }

  return (
    <div
      role="dialog"
      aria-label="安装应用到主屏幕"
      className="heis-install-banner fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2"
    >
      <div className="flex items-center gap-3 rounded-lg border border-violet-700/60 bg-zinc-900 p-3 shadow-xl">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-500/15">
          <Download className="h-4 w-4 text-violet-300" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-zinc-100">安装到主屏幕</div>
          <div className="truncate text-[11px] text-zinc-400">离线也能读, 像原生 App 一样打开</div>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 bg-violet-600 px-2.5 text-[11px] hover:bg-violet-500"
          onClick={handleInstall}
        >
          <CheckCircle2 className="h-3 w-3" />
          安装
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          aria-label="关闭安装提示"
          onClick={handleClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
