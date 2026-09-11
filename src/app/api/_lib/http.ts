// ============================================================
// API 层内部通用加固工具 (仅供本目录 route.ts 使用, 不会成为路由)
// 职责: 统一异常兜底 / 参数钳制 / LIKE 通配符过滤 / 路径穿越防护
// 5-a: unhandled 与 batch-item 异常改走结构化 logger (带 reqId/脱敏/分级)
// ============================================================
import { fail, BodyTooLargeError } from '@/lib/api'
import { logger } from '@/lib/logger'
import path from 'path'

/** 包裹 handler: 任何未捕获异常 → 500 信封, 不泄露内部堆栈 */
export async function withGuard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (e: any) {
    // R5-5: readBody 超限 → 413 Payload Too Large (而非 500)
    if (e instanceof BodyTooLargeError) {
      return fail(`请求体过大(超过 ${(e.maxBytes / 1024 / 1024).toFixed(1)}MB 上限)`, 413)
    }
    // 5-a: 结构化日志 — err/stack/code 字段, 敏感字段自动脱敏
    logger.error('api unhandled error', {
      err: e?.message,
      stack: e?.stack?.slice(0, 500),
      code: e?.code,
    })
    return fail('服务器内部错误', 500)
  }
}

/**
 * 批量操作 skipped 项的错误文本消毒(tt-b):
 * 逐条 catch 中 Prisma 异常的 e.message 含内部细节(查询原文/schema 文件路径), 原样塞进
 * skipped.reason 会随 200 信封泄漏给客户端。此处按已知错误码转友好文案, 其余一律归
 * "操作失败"并在服务端 logger.warn 留 err/code (5-a: 结构化日志, 敏感字段自动脱敏)。
 */
export function errText(e: unknown): string {
  const code = (e as any)?.code
  if (code === 'P2025') return '记录已被删除(并发变更), 请刷新后重试'
  if (code === 'P2003') return '关联数据不存在(并发变更), 请刷新后重试'
  if (code === 'P2002') return '唯一约束冲突(数据已存在)'
  // 5-a: 结构化日志 — err/code 字段, 敏感字段自动脱敏
  logger.warn('batch item error', { err: (e as any)?.message, code: (e as any)?.code })
  return '操作失败(内部错误), 请重试'
}

/** 整数钳制: 缺失(null/undefined/'')→默认值; NaN/Infinity/越界→边界内安全值 */
export function clampInt(v: unknown, def: number, min: number, max: number): number {
  // 注意: Number(null)===0, 必须先短路缺失场景, 否则未传的分页参数会被钳成 min(如 size 变 1)
  if (v === null || v === undefined || v === '') return def
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** 字符串安全化: 非字符串→'', 超长截断 */
export function str(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return v === null || v === undefined ? '' : String(v).slice(0, maxLen)
  return v.slice(0, maxLen)
}

/** 搜索词清洗: trim + 去除 SQLite LIKE 通配符 (% _) + 截断 */
export function likeSafe(v: unknown, maxLen = 100): string {
  return str(v, maxLen).trim().replace(/[%_\\]/g, ' ')
}

/**
 * URL 校验: 仅允许 http/https, 返回规范化字符串或 null
 * R7-12 修复: 含 `{page}`/`{cat}`/`{offset:N}`/`{keyword}` 等采集占位符的 URL 不被 new URL()
 * 编码成 `%7Bpage%7D`。先临时替换占位符为 ASCII 安全 token, 通过 URL 校验+规范化后再还原,
 * 既保证协议白名单(http/https)又保留占位符字面量供 runner.ts 后续替换。
 */
export function httpUrl(v: unknown, maxLen = 2000): string | null {
  const s = str(v, maxLen).trim()
  if (!s) return null
  try {
    // 提取所有 {...} 占位符, 临时替换为 ___PH<i>___ (URL 路径允许的 ASCII 字符)
    const placeholders: string[] = []
    const masked = s.replace(/\{[^{}]+\}/g, (m) => {
      const i = placeholders.length
      placeholders.push(m)
      return `___PH${i}___`
    })
    const u = new URL(masked)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    let norm = u.toString()
    // 还原占位符(URL.toString() 不会编码 ___PH<i>___ 因为下划线是 URL 安全字符)
    for (let i = 0; i < placeholders.length; i++) {
      norm = norm.replace(`___PH${i}___`, placeholders[i])
    }
    return norm
  } catch {
    return null
  }
}

/** 是否纯对象(非数组/非null) */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 路径穿越防护: resolve 后必须仍位于 root 目录内(含分隔符边界)。
 * 防御 ../、绝对路径、%2e%2e 解码后穿越、以及 startsWith 前缀的兄弟目录绕过 (data-x vs data)。
 * 返回解析后的绝对路径, 非法返回 null。
 */
export function safeJoin(root: string, rel: string): string | null {
  if (!rel || rel.includes('\0')) return null
  const resolved = path.resolve(root, rel)
  const prefix = path.resolve(root)
  if (resolved === prefix) return null
  if (!resolved.startsWith(prefix + path.sep)) return null
  return resolved
}

/**
 * feat-J: 为公共 GET 路由设置 Cache-Control 头。
 * - sMaxAge: CDN 边缘缓存秒数(默认 60s) — 让 CDN 兜住热点查询, 公共路由 120 req/min 容量上限内
 *   命中缓存后零 DB 查询
 * - staleWhileRevalidate: SWR 窗口(默认 300s) — 过期后仍可返回旧响应同时后台重抓
 * 注: 此函数仅在 Response 已生成后追加头, 不影响 JSON 序列化
 */
export function withCache(res: Response, sMaxAge = 60, staleWhileRevalidate = 300): Response {
  res.headers.set(
    'Cache-Control',
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  )
  return res
}
