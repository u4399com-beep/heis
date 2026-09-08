// API 通用工具
import { NextResponse } from 'next/server'

export function ok(data: any = null, extra?: Record<string, any>) {
  return NextResponse.json({ ok: true, data, ...extra })
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

/**
 * R5-5: 受 body 大小上限保护的 JSON 读取。先检查 Content-Length, 超限直接 413 拒绝。
 * 默认 5MB(覆盖绝大多数 admin 配置载荷); backup/restore 需 200MB, 调用方传 maxBytes=200_000_000。
 * Content-Length 缺失时(流式/chunked) 按 maxBytes 边读边截断, 防止 500MB body 全量入内存。
 */
export async function readBody<T = any>(req: Request, maxBytes = 5_000_000): Promise<T> {
  try {
    const lenHdr = req.headers.get('content-length')
    if (lenHdr) {
      const n = Number(lenHdr)
      if (Number.isFinite(n) && n > maxBytes) {
        throw new BodyTooLargeError(maxBytes)
      }
    }
    return (await req.json()) as T
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw e
    return {} as T
  }
}

/** 用于 readBody 超限时让上层走 withGuard/兜底返回 413 */
export class BodyTooLargeError extends Error {
  constructor(public maxBytes: number) {
    super(`请求体超过 ${maxBytes} 字节上限`)
    this.name = 'BodyTooLargeError'
  }
}

export function num(v: any, def: number): number {
  if (v === null || v === undefined || v === '') return def
  const n = Number(v)
  return isNaN(n) ? def : n
}
