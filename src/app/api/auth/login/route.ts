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
  // R4A-1: 优先 TCP 套接字 IP(req.ip) —— 与 proxy.ts 同款 R3-30 修复, 防 XFF 头部
  // 伪造绕过每 IP 5 次/60s 登录限流。XFF 仅作为 req.ip 不可读时的兜底(Next 16 边缘运行时)
  const sockIp = (req as unknown as { ip?: string }).ip
  if (sockIp && sockIp.trim()) return sockIp.trim()
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
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
