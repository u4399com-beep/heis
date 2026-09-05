// ============================================================
// API 层内部通用加固工具 (仅供本目录 route.ts 使用, 不会成为路由)
// 职责: 统一异常兜底 / 参数钳制 / LIKE 通配符过滤 / 路径穿越防护
// ============================================================
import { fail } from '@/lib/api'
import path from 'path'

/** 包裹 handler: 任何未捕获异常 → 500 信封, 不泄露内部堆栈 */
export async function withGuard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (e: any) {
    console.error('[api] unhandled error:', e?.message || e)
    return fail('服务器内部错误', 500)
  }
}

/**
 * 批量操作 skipped 项的错误文本消毒(tt-b):
 * 逐条 catch 中 Prisma 异常的 e.message 含内部细节(查询原文/schema 文件路径), 原样塞进
 * skipped.reason 会随 200 信封泄漏给客户端。此处按已知错误码转友好文案, 其余一律归
 * "操作失败"并在服务端 console 留全量原文(排查能力不丢)。
 */
export function errText(e: unknown): string {
  const code = (e as any)?.code
  if (code === 'P2025') return '记录已被删除(并发变更), 请刷新后重试'
  if (code === 'P2003') return '关联数据不存在(并发变更), 请刷新后重试'
  if (code === 'P2002') return '唯一约束冲突(数据已存在)'
  console.error('[api] batch item error:', (e as any)?.message || e)
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

/** URL 校验: 仅允许 http/https, 返回规范化字符串或 null */
export function httpUrl(v: unknown, maxLen = 2000): string | null {
  const s = str(v, maxLen).trim()
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
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
