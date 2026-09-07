// 登出: POST → 清除会话 Cookie
import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth'

export async function POST() {
  return NextResponse.json(
    { ok: true, data: {} },
    { headers: { 'Set-Cookie': clearSessionCookie() } },
  )
}
