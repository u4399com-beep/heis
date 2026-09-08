// ============================================================
// Next.js 16 代理中间件 (nodejs runtime) — 文件名 proxy.ts (Next 16 新约定, 取代 middleware.ts)
// 职责:
//   1) 安全响应头注入: X-Content-Type-Options / X-Frame-Options / CSP 等
//   2) /api/admin/* 鉴权: 校验 heis_admin 签名 Cookie, 失败 → 401
//   3) /api/admin/* 与 /api/public/* 每 IP 令牌桶限流
//   4) 移除 X-Powered-By 头
//   5) 每请求生成 reqId (5-a 可观测性):
//        - 优先取 x-request-id 请求头 (上游网关已生成时透传)
//        - 否则 crypto.randomUUID().slice(0, 8) 生成短 ID
//        - 回写 X-Request-Id 响应头供客户端/日志关联
//        - 同时 forward 到下游 request headers, 供 API 路由日志打 tag
//
// 注: 使用 runtime: 'nodejs' 以直接复用 src/lib/auth.ts 的 node:crypto 同步实现,
//     避免引入 Web Crypto (async) 改动 verifySession 签名。Next 16 已支持该 runtime。
// ============================================================
import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME, verifySession, parseCookies } from '@/lib/auth'
import { withReqId } from '@/lib/logger'

export const config = {
  // Next 16: proxy.ts 始终运行于 Node.js runtime (无需也不能在此声明 runtime)
  // 匹配所有路径, 仅排除纯静态资源 (_next/static, _next/image, favicon.ico)
  // 其他路径(包括 /, /api/*, /_next/data/*, /sitemap.xml, /robots.txt) 都会经过
  // 代理以注入安全响应头 + 鉴权
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

// ---- 每 IP 令牌桶限流 (in-process, 单实例部署足够) ----
// 不同路由类(admin/public/auth)使用独立桶, 避免互相挤占额度;
// 同一 (routeClass, ip) 共享一个桶, 容量/补充速率由调用方传入
interface Bucket { tokens: number; last: number }
const MAX_BUCKETS = 10_000
const buckets = new Map<string, Bucket>()

/** 取客户端 IP: 优先 TCP 套接字 IP(req.ip), 兜底 X-Forwarded-For 首段
 *  R3-30 修复: 原实现优先 XFF 首段 → 攻击者只需在每个请求里塞不同 XFF 值即可绕过
 *  每 IP 令牌桶(每次新 IP 都是新桶, 满载 capacity 立即可消费)。req.ip 是 TCP 套接字
 *  对端地址(由 Caddy 反向代理握手建立), 攻击者无法伪造 —— 只有真正持有连接的客户端
 *  才能被 req.ip 命中。XFF 仅作为 req.ip 不可读时的兜底(Next 16 边缘运行时下 req.ip 缺失)。
 *  信任链: 本服务部署于 Caddy 后, Caddy 始终以真实客户端 IP 建立到本服务的 TCP 连接,
 *  故 req.ip 在 nodejs runtime 下即真实客户端 IP, 无须依赖 XFF 头部信任。 */
function clientIp(req: NextRequest): string {
  // NextRequest 在 nodejs runtime 下携带 ip 字段(TCP 套接字对端)
  const sockIp = (req as unknown as { ip?: string }).ip
  if (sockIp && sockIp.trim()) return sockIp.trim()
  // req.ip 不可读时降级 XFF(边缘运行时/调试场景); 生产 nodejs runtime 永不触达此分支
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}

/**
 * 令牌桶消费: 满载 capacity, 每秒补充 refillPerSec。返回 true=放行, false=限流。
 * 桶键 = `${routeClass}:${ip}`, 不同路由类独立计数, 避免互相挤占。
 * Map 上限 MAX_BUCKETS, 溢出时按插入序淘汰最旧项 (避免攻击者通过伪造 IP 撑爆内存)
 *
 * R5-12 残留风险记录: 10000 个伪造 XFF 的 DoS 仍可逐出合法 IP 的桶 —— 但 R3-30 已修复
 *  clientIp() 优先 req.ip(TCP 套接字对端, 不可伪造), XFF 仅在 req.ip 不可读的边缘运行时下
 *  兜底使用, 生产 nodejs runtime 下攻击者无法通过伪造 XFF 增加桶数量, 此风险已实质性消除。
 *  保留 FIFO 淘汰作为防御纵深(应对未来 NAT 后多客户端共享出口 IP 的合法突发场景)。
 */
function rateLimit(routeClass: string, ip: string, capacity: number, refillPerSec: number): boolean {
  const now = Date.now()
  const key = `${routeClass}:${ip}`
  let b = buckets.get(key)
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) {
      const firstKey = buckets.keys().next().value
      if (firstKey) buckets.delete(firstKey)
    }
    b = { tokens: capacity - 1, last: now }
    buckets.set(key, b)
    return true
  }
  const dt = (now - b.last) / 1000
  b.tokens = Math.min(capacity, b.tokens + dt * refillPerSec)
  b.last = now
  if (b.tokens < 1) return false
  b.tokens -= 1
  return true
}

// ---- 安全响应头 ----
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-DNS-Prefetch-Control': 'off',
}

// HTML 页面 CSP
// R5-22: 按运行环境分级 —— 生产环境去除 'unsafe-eval'(Next dev 用于 HMR/eval, 生产无需),
//  收紧 XSS 攻击面; dev 保留 'unsafe-inline' + 'unsafe-eval' 让 Next.js HMR 正常工作。
//  进一步收紧(如 nonce 替代 unsafe-inline)需 Next.js 16 nonce-based CSP, 单独立项推进。
const isProd = process.env.NODE_ENV === 'production'
const CSP_HTML =
  "default-src 'self'; " +
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}; ` +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; " +
  "font-src 'self' data:; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'"

function applyHeaders(res: NextResponse, isHtml: boolean, reqId: string): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
  if (isHtml) res.headers.set('Content-Security-Policy', CSP_HTML)
  // 关闭 X-Powered-By (next.config.ts 也设了 poweredByHeader:false, 双保险)
  res.headers.delete('X-Powered-By')
  // 5-a: 回写 reqId 到响应头, 供客户端/运维日志关联同一请求
  res.headers.set('X-Request-Id', reqId)
  return res
}

function isHtmlResponse(req: NextRequest, pathname: string): boolean {
  if (pathname === '/' || pathname.endsWith('.html')) return true
  const accept = req.headers.get('accept') || ''
  return accept.includes('text/html')
}

function tooManyRequests(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message, code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': '60' } },
  )
}

function unauthenticated(): NextResponse {
  return NextResponse.json(
    { ok: false, error: '未登录或会话已过期', code: 'UNAUTHENTICATED' },
    { status: 401 },
  )
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  const ip = clientIp(req)

  // 5-a: 每请求生成 reqId —— 优先取上游 x-request-id 头, 否则本地生成 8 位短 UUID
  // (8 位足够单实例去重, 又不至于让日志行膨胀; 上游网关已注入则透传以串联全链路)
  const reqId =
    (req.headers.get('x-request-id') || '').trim().slice(0, 64) ||
    crypto.randomUUID().slice(0, 8)
  // 绑定 reqId 子 logger (供本函数自身的 debug 日志; 下游 API 路由通过请求头读取 reqId)
  const reqLogger = withReqId(reqId)
  reqLogger.debug('incoming request', { method: req.method, path: pathname, ip })

  // 1) /api/admin/* —— 鉴权 + 60 req/min
  if (pathname.startsWith('/api/admin/')) {
    if (!rateLimit('admin', ip, 60, 1)) {
      return applyHeaders(tooManyRequests('请求过于频繁, 请稍后再试'), false, reqId)
    }
    const cookies = parseCookies(req.headers.get('cookie'))
    if (!verifySession(cookies[SESSION_COOKIE_NAME])) {
      return applyHeaders(unauthenticated(), false, reqId)
    }
  } else if (pathname.startsWith('/api/public/')) {
    // 2) /api/public/* —— 120 req/min, 不需鉴权
    if (!rateLimit('public', ip, 120, 2)) {
      return applyHeaders(tooManyRequests('请求过于频繁, 请稍后再试'), false, reqId)
    }
  } else if (pathname.startsWith('/api/auth/')) {
    // 3) /api/auth/* —— 60 req/min (login 路由自带更严格的 5次/60s 滑窗)
    if (!rateLimit('auth', ip, 60, 1)) {
      return applyHeaders(tooManyRequests('请求过于频繁, 请稍后再试'), false, reqId)
    }
  }

  // 4) 其他路径(含 /, /sitemap.xml, /robots.txt, /_next/data/*) 直通 + 加安全头
  // 5-a: 把 reqId 透传到下游 request headers, 供 API 路由读取并打 tag
  // (NextResponse.next({ request: { headers } }) 在 nodejs runtime 下会合并到
  //  下游 req.headers; 下游通过 req.headers.get('x-request-id') 取得 reqId)
  const forwardHeaders = new Headers(req.headers)
  forwardHeaders.set('x-request-id', reqId)
  const res = NextResponse.next({ request: { headers: forwardHeaders } })
  return applyHeaders(res, isHtmlResponse(req, pathname), reqId)
}
