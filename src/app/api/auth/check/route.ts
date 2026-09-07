// 会话状态: GET → { ok:true, data:{ authenticated: boolean } }
import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, verifySession, parseCookies } from '@/lib/auth'

export async function GET(req: Request) {
  const cookies = parseCookies(req.headers.get('cookie'))
  const authenticated = verifySession(cookies[SESSION_COOKIE_NAME])
  return NextResponse.json({ ok: true, data: { authenticated } })
}
