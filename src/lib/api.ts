// API 通用工具
import { NextResponse } from 'next/server'

export function ok(data: any = null, extra?: Record<string, any>) {
  return NextResponse.json({ ok: true, data, ...extra })
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

export async function readBody<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    return {} as T
  }
}

export function num(v: any, def: number): number {
  if (v === null || v === undefined || v === '') return def
  const n = Number(v)
  return isNaN(n) ? def : n
}
