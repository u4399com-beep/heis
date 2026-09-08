// ============================================================
// 后台管理员鉴权 (轻量级、零依赖)
// 单管理员模型: 密码来自环境变量 ADMIN_PASSWORD, 不引入 Prisma User 表
// 会话: HttpOnly Cookie 内置 HMAC-SHA256 签名 token, 服务端无状态校验
//
// 安全要点:
//   - 任何"密码/密钥"比较必须 timingSafeEqual, 禁止使用 === / !==
//   - 会话 token = base64url(payload).base64url(hmac_sha256(payload, secret))
//     payload = JSON {exp: ms, nonce: 16B hex}
//   - 校验时重算 HMAC + 长度先短路 + timingSafeEqual + 检查 exp
//   - 一次性随机密码: 进程启动时若 ADMIN_PASSWORD 未设则生成并打印到 stderr,
//     避免线上"裸奔" (但运维务必在 .env / docker env 中显式设置 ADMIN_PASSWORD)
//   - 登录爆破防护: 进程内每 IP 5 次/60s 滑窗 (与 middleware 的 token-bucket 解耦,
//     因 middleware 是 Edge/nodejs 不同 runtime, 共享 Map 不可靠)
// ============================================================
import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto'

export const SESSION_COOKIE_NAME = 'heis_admin'
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000 // 12h

// ---- 登录尝试限流 (in-process, per IP) ----
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_WINDOW_MS = 60_000
/** R3-31: loginAttempts Map 上限 —— 防 XFF 伪造/IP 翻动攻击者撑爆内存。
 *  满载时按插入序 FIFO 淘汰最旧项(与 proxy.ts buckets 同款) */
const MAX_LOGIN_MAP = 10_000
/** R3-31: 周期性清扫窗口外过期条目, 防长期未触达 IP 条目无界累积(扫描间隔 5min) */
const LOGIN_SWEEP_INTERVAL_MS = 5 * 60_000
interface AttemptEntry { count: number; firstAt: number }
const loginAttempts = new Map<string, AttemptEntry>()

/** R3-31: 周期性扫描 loginAttempts, 删除 firstAt 已超过 LOGIN_WINDOW_MS 的条目。
 *  惰性启动: 首次写入条目时挂载定时器, 全局仅一个(挂到 globalThis 防 HMR 多实例)。
 *  定时器 unref 不阻止进程退出; 触发时同步扫描清旧, 任何异常均吞掉防影响登录主路径 */
function ensureLoginSweep(): void {
  const g = globalThis as unknown as { __heisLoginSweepTimer?: ReturnType<typeof setInterval> | null }
  if (g.__heisLoginSweepTimer) return
  const timer = setInterval(() => {
    try {
      const now = Date.now()
      for (const [k, e] of loginAttempts) {
        if (now - e.firstAt > LOGIN_WINDOW_MS) loginAttempts.delete(k)
      }
    } catch { /* ignore */ }
  }, LOGIN_SWEEP_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  g.__heisLoginSweepTimer = timer
}

/** R3-31: 容量上限 FIFO 淘汰(满载时删最早一条), 防 XFF 伪造撑爆内存 */
function trimLoginMap(): void {
  while (loginAttempts.size >= MAX_LOGIN_MAP) {
    const oldest = loginAttempts.keys().next().value
    if (oldest === undefined) break
    loginAttempts.delete(oldest)
  }
}

// ---- 密钥解析 (惰性, 单次缓存; 缓存挂到 globalThis 以避免 dev HMR 模块重载
//      导致随机 fallback 密码被重新生成而令既有会话全部失效) ----
const G = globalThis as unknown as {
  __heisAdminPw?: string
  __heisAdminSecret?: string
}

function resolvePassword(): string {
  if (G.__heisAdminPw) return G.__heisAdminPw
  const env = process.env.ADMIN_PASSWORD?.trim()
  if (env) {
    G.__heisAdminPw = env
    return env
  }
  // 一次性随机密码: 进程级 fallback, 避免线上"裸奔"。每次进程启动都会变化,
  // 运维务必在 .env / docker env 中显式设置 ADMIN_PASSWORD。
  // 缓存到 globalThis, dev HMR 不会重置; 模块自身重载不会生成新密码。
  const rand = randomBytes(12).toString('base64url')
  G.__heisAdminPw = rand
  const bar = '='.repeat(60)
  console.warn(bar)
  console.warn('[安全警告] 未设置 ADMIN_PASSWORD 环境变量!')
  console.warn('[安全警告] 已生成一次性临时密码(进程重启后失效):')
  console.warn(`[安全警告]     临时密码 = ${rand}`)
  console.warn('[安全警告] 生产环境务必在 .env / docker env 中设置 ADMIN_PASSWORD!')
  console.warn(bar)
  return rand
}

function resolveSecret(): string {
  if (G.__heisAdminSecret) return G.__heisAdminSecret
  const env = process.env.SESSION_SECRET?.trim()
  if (env) {
    G.__heisAdminSecret = env
    return env
  }
  // SESSION_SECRET 未设: 由 ADMIN_PASSWORD 派生 SHA256, 保证可用 (但更新密码
  // 会令所有旧会话立即失效 —— 这是合理行为)
  const derived = createHash('sha256').update(resolvePassword()).digest('hex')
  G.__heisAdminSecret = derived
  return derived
}

/** 等长短路 + timingSafeEqual 比较, 不泄露长度信息 */
function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) {
    // 等长比较以保持相似时间消耗, 避免基于返回时间推断长度差
    timingSafeEqual(ba, ba)
    return false
  }
  return timingSafeEqual(ba, bb)
}

/** 校验密码 (constant-time) */
export function verifyPassword(pw: string): boolean {
  return safeEqualStr(pw || '', resolvePassword())
}

/** 生成会话: 返回 Set-Cookie 头值与过期时间戳 */
export function createSession(): { cookie: string; expiresAt: number } {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS
  const nonce = randomBytes(16).toString('hex')
  const payloadJson = JSON.stringify({ exp: expiresAt, nonce })
  const payload = Buffer.from(payloadJson, 'utf8').toString('base64url')
  const hmac = createHmac('sha256', resolveSecret()).update(payload).digest('base64url')
  const token = `${payload}.${hmac}`
  const maxAgeSec = Math.floor(SESSION_MAX_AGE_MS / 1000)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  const cookie =
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`
  return { cookie, expiresAt }
}

/** 清除会话 Cookie (logout) */
export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  // R3-33: 显式 Expires=epoch 与 Max-Age=0 双保险 —— Max-Age=0 在某些代理/老浏览器
  // 下被忽略或与已有 Cookie 的 Max-Age 不对齐导致不立即失效; Expires 永远有效(已过去)
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`
}

/** 校验会话 token: 重算 HMAC + 等长短路 + timingSafeEqual + 检查 exp */
export function verifySession(cookieValue: string | null | undefined): boolean {
  if (!cookieValue) return false
  const parts = cookieValue.split('.')
  if (parts.length !== 2) return false
  const [payload, hmac] = parts
  if (!payload || !hmac) return false
  const expected = createHmac('sha256', resolveSecret()).update(payload).digest('base64url')
  if (!safeEqualStr(expected, hmac)) return false
  let parsed: { exp?: unknown; nonce?: unknown }
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) return false
  if (Date.now() > parsed.exp) return false
  // R3-32: payload 仅允许 {exp, nonce} 两键 —— 伪造者构造合法 HMAC 后无法塞额外字段
  // (虽然不知道 secret, 但防御深度: 漏写/被泄漏场景下额外字段一律拒)。nonce 必须是
  // 16B hex 串(createSession 生成形态), 不合规即拒
  if (typeof parsed.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(parsed.nonce)) return false
  const allowedKeys = new Set(['exp', 'nonce'])
  for (const k of Object.keys(parsed)) {
    if (!allowedKeys.has(k)) return false
  }
  return true
}

/** 解析 Cookie 头为 name→value 字典 (简单实现, 不做 RFC6265 完整语法) */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (!k) continue
    try { out[k] = decodeURIComponent(v) } catch { out[k] = v }
  }
  return out
}

// ============================================================
// 登录尝试限流 (in-process, per IP)
// 滑窗 60s 内最多 5 次; 超出后请求被拒, 直到窗口滑过
// ============================================================

/** 消费一次登录尝试配额; 返回 true=允许, false=已被限流 */
export function consumeLoginAttempt(ip: string): boolean {
  const now = Date.now()
  const e = loginAttempts.get(ip)
  if (!e || now - e.firstAt > LOGIN_WINDOW_MS) {
    // R3-31: 写入新条目前先 FIFO 淘汰 + 启动周期清扫(惰性, 仅首次挂载)
    trimLoginMap()
    ensureLoginSweep()
    loginAttempts.set(ip, { count: 1, firstAt: now })
    return true
  }
  if (e.count >= MAX_LOGIN_ATTEMPTS) return false
  e.count++
  return true
}

/** 当前 IP 限流剩余秒数 (供 Retry-After 头) */
export function loginRetryAfterSec(ip: string): number {
  const e = loginAttempts.get(ip)
  if (!e) return 0
  const rem = LOGIN_WINDOW_MS - (Date.now() - e.firstAt)
  return Math.max(0, Math.ceil(rem / 1000))
}

/** 登录成功后清空该 IP 的尝试计数 */
export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip)
}
