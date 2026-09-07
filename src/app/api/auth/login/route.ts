// 登录: POST { password }
// 成功 → 设置签名 HttpOnly Cookie + 200 {ok:true,data:{}}
// 失败 → 401 {ok:false,error:'密码错误'}
// 限流 → 429 {ok:false,error:'登录尝试过于频繁...', code:'RATE_LIMITED'} + Retry-After
import { NextResponse } from 'next/server'
import {
  verifyPassword,
  createSession,
  consumeLoginAttempt,
  clearLoginAttempts,
  loginRetryAfterSec,
} from '@/lib/auth'
import { readBody } from '@/lib/api'

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return (req as unknown as { ip?: string }).ip || 'unknown'
}

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!consumeLoginAttempt(ip)) {
    const retry = loginRetryAfterSec(ip)
    return NextResponse.json(
      { ok: false, error: `登录尝试过于频繁, 请 ${retry} 秒后再试`, code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(retry) } },
    )
  }
  const body = await readBody<{ password?: unknown }>(req)
  const pw = typeof body?.password === 'string' ? body.password : ''
  if (!verifyPassword(pw)) {
    return NextResponse.json({ ok: false, error: '密码错误' }, { status: 401 })
  }
  clearLoginAttempts(ip)
  const { cookie } = createSession()
  return NextResponse.json({ ok: true, data: {} }, { headers: { 'Set-Cookie': cookie } })
}
