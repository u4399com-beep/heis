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
 *
 * R6-3: 旧实现的"按 maxBytes 边读边截断"只是注释承诺, 实际仍走 `await req.json()` —— 该方法
 *  在 Next.js/undici 下会把整个 body 流收集成单一字符串再 JSON.parse, 全程无 maxBytes 上限。
 *  Content-Length 缺失(chunked encoding)的 500MB body 因此可绕过 R5-5 公开路由 100KB 反馈上限
 *  与 admin 5MB 上限, 单请求即 OOM。修法: chunked 形态下主动用 reader 流式读取, 累计字节
 *  超 maxBytes 即抛 BodyTooLargeError(由 withGuard 转 413); Content-Length 显式超限保留早退。
 *  Content-Length 存在且 ≤ maxBytes 时走原 `await req.json()` 快速路径(零回归)。
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
    // R6-3: Content-Length 缺失(chunked encoding) → 流式读取 + 字节计数 + 超限中止。
    //  body 为 null(Web Response 标准)或无 getReader(非流式)时回退 req.json()(无法防护,
    //  但实测 Next.js Route Handler 的 Request 始终带 body 流)。
    if (!lenHdr && req.body && typeof req.body.getReader === 'function') {
      return await readBodyStreamed<T>(req, maxBytes)
    }
    return (await req.json()) as T
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw e
    return {} as T
  }
}

/** R6-3: chunked 形态流式读取 + 字节上限防护 ——
 *  逐 chunk 累计字节, 超 maxBytes 即抛 BodyTooLargeError(由 withGuard 转 413)。
 *  读完后 JSON.parse 完整字符串; 解析失败按既有 readBody 语义返回 {}。 */
async function readBodyStreamed<T>(req: Request, maxBytes: number): Promise<T> {
  // 控制流已保证 req.body 非 null 且带 getReader(调用前已校验)
  const reader = req.body!.getReader()
  const dec = new TextDecoder('utf-8')
  let acc = ''
  let total = 0
  let overflow = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      // value 为 Uint8Array, 按 byteLength 计数(UTF-8 字节数, 与 maxBytes 同口径)
      const chunkLen = value.byteLength ?? 0
      total += chunkLen
      if (total > maxBytes) {
        overflow = true
        try { await reader.cancel().catch(() => {}) } catch { /* ignore */ }
        break
      }
      acc += dec.decode(value, { stream: true })
    }
    acc += dec.decode() // flush
  } finally {
    try { reader.releaseLock?.() } catch { /* ignore */ }
  }
  if (overflow) {
    throw new BodyTooLargeError(maxBytes)
  }
  try {
    return JSON.parse(acc) as T
  } catch {
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
  if (v == null || v === '') return def
  const n = Number(v)
  return isNaN(n) ? def : n
}
