'use client'

// ============================================================
// LoginGate — 后台登录闸门
// 挂载时拉 /api/auth/check; 未登录则展示居中登录卡片,
// 登录成功后页面 reload (Cookie 已写入, 二次进入即放行到 AdminApp)
// feat-a E: 渐变背景 + 玻璃质感卡片 + BookOpen 脉冲图标 + 焦点光晕 + 页脚说明
// ============================================================
import { useEffect, useState } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'

type GateState = 'loading' | 'unauth' | 'authed'

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>('loading')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/check', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: { authenticated?: boolean } }) => {
        if (cancelled) return
        if (j?.ok && j?.data?.authenticated) setState('authed')
        else setState('unauth')
      })
      .catch(() => {
        if (!cancelled) setState('unauth')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-300">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="size-5 animate-spin" />
          <span>正在验证会话…</span>
        </div>
      </div>
    )
  }

  if (state === 'authed') {
    return <>{children}</>
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting || !password) return
    setSubmitting(true)
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const j: { ok?: boolean; error?: string } = await r.json().catch(() => ({}))
      if (r.ok && j?.ok) {
        toast.success('登录成功, 即将进入后台…')
        // Cookie 已写入, reload 让 LoginGate 重新校验放行
        setTimeout(() => window.location.reload(), 200)
        return
      }
      if (r.status === 429) {
        toast.error(j?.error || '请求过于频繁, 请稍后再试')
      } else {
        toast.error(j?.error || '密码错误')
      }
    } catch {
      toast.error('网络错误, 请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="animate-login-gradient relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-[#3b1e6e] via-[#4338ca] to-zinc-950 p-4">
      <Toaster richColors position="top-center" />
      <Card
        className="relative z-10 w-full max-w-sm border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl"
        style={{ boxShadow: '0 12px 48px rgba(0,0,0,0.45)' }}
      >
        <CardHeader className="text-center">
          <div className="animate-book-pulse mx-auto mb-3 flex size-14 items-center justify-center rounded-full border border-violet-300/40 bg-violet-500/20 text-violet-200 ring-1 ring-violet-300/30">
            <BookOpen className="size-7" aria-hidden />
          </div>
          <CardTitle className="text-xl text-zinc-50">小说管理系统 · 登录</CardTitle>
          <CardDescription className="text-zinc-300/80">
            请输入管理员密码以进入后台
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" autoComplete="on">
            <div className="flex flex-col gap-2">
              <Label htmlFor="heis-admin-pw" className="text-zinc-200">
                密码
              </Label>
              <Input
                id="heis-admin-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoFocus
                autoComplete="current-password"
                required
                maxLength={256}
                className="border-white/15 bg-zinc-950/60 text-zinc-50 placeholder:text-zinc-500 transition-all focus-visible:border-violet-400/70 focus-visible:ring-violet-400/50 focus-visible:ring-[3px]"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting || !password}
              className="w-full bg-violet-600 hover:bg-violet-500"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  登录中…
                </>
              ) : (
                '登录'
              )}
            </Button>
          </form>
          <p className="mt-5 text-center text-[11px] text-zinc-400/80">
            🔒 会话 12 小时 · 登录信息仅本地保存
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
