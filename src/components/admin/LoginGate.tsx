'use client'

// ============================================================
// LoginGate — 后台登录闸门
// 挂载时拉 /api/auth/check; 未登录则展示居中登录卡片,
// 登录成功后页面 reload (Cookie 已写入, 二次进入即放行到 AdminApp)
// ============================================================
import { useEffect, useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-4">
      <Toaster richColors position="top-center" />
      <Card className="w-full max-w-sm border-zinc-800 bg-zinc-900/80 backdrop-blur-sm shadow-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-zinc-800 text-zinc-200 ring-1 ring-zinc-700">
            <Lock className="size-6" />
          </div>
          <CardTitle className="text-xl text-zinc-100">小说管理系统 · 登录</CardTitle>
          <CardDescription className="text-zinc-400">
            请输入管理员密码以进入后台
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" autoComplete="on">
            <div className="flex flex-col gap-2">
              <Label htmlFor="heis-admin-pw" className="text-zinc-300">
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
                className="bg-zinc-950/50 border-zinc-700 text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
            <Button type="submit" disabled={submitting || !password} className="w-full">
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
        </CardContent>
      </Card>
    </div>
  )
}
