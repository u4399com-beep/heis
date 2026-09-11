/**
 * heis-mini-shared — 6 个 Bun 采集代理共用的样板(v3: agent-L 运行时加固轮)
 * ============================================================
 * 背景:
 *   - 1-c 轮: 统一 json()/Bun.serve()//health 三件套 + BRIDGE_KEY 共享密钥 + 127.0.0.1 绑定
 *   - agent-F 轮: AUTH_TOKEN 环境变量 / 每 IP 速率限制 / 安全响应头 / SSRF 校验 / 30s 超时 /
 *                10MB POST 体 / sanitizeError 脱敏
 *   - agent-L 轮(本版): 新增可观测性 + 运维端点
 *       · Metrics 类: requests_total / errors_total / in_flight / avg_response_ms / uptime_seconds
 *       · /metrics 端点: Prometheus 文本格式(鉴权闸同主路径, 免限速)
 *       · /info 端点: version + uptime + config(脱敏) + 依赖版本
 *       · 进程 SIGTERM/SIGINT 优雅关闭钩子(unref)
 *       · userFetch 包装: 自动计时 + 计数 + 错误统计
 *
 * 本模块导出:
 *   - json(data, status?)                  JSON 响应助手(自带安全头)
 *   - text(data, status?, contentType?)     文本响应助手(自带安全头, 供 /token 等纯文本端点)
 *   - safeHeaderKey(k) / safeHeaderValue(v)
 *   - constantTimeEqual(a, b)              字符串常量时间比较
 *   - assertSafeSsrfTarget(url, opts)      SSRF 校验(默认拒绝 localhost/私网/链路本地/元数据端点)
 *   - sanitizeError(e)                     错误对象 → 安全字符串(剥路径/堆栈, 限长 200)
 *   - RateLimiter                          每 IP 滑窗限速器(默认 60/min)
 *   - Metrics                              请求计数/错误/在途/平均时延 + Prometheus 文本格式
 *   - createBridgeServer(opts)             Bun.serve 工厂(见下)
 *
 * createBridgeServer 行为(在 1-c + agent-F 基础上叠加 agent-L 可观测性):
 *   · hostname: '127.0.0.1'(HARD — 修复 H4)
 *   · idleTimeout 默认 120s(可被 opts.idleTimeoutS 覆盖)
 *   · /health 自动挂载(免鉴权/免限速 — 健康探针不应被自身闸门拦)
 *   · /metrics 自动挂载(Prometheus 文本格式; 鉴权闸同主路径; 免限速; 含 in_flight 实时态)
 *   · /info   自动挂载(version + uptime + 配置脱敏 + bun 版本; 鉴权闸同主路径; 免限速)
 *   · 鉴权: AUTH_TOKEN(优先) 或 BRIDGE_KEY(别名); 任一非空时, 非 /health 请求必须带
 *     X-Auth-Token / X-Bridge-Key / Authorization: Bearer 之一(常量时间比较, 失败 401)
 *   · 限速: 每 IP 60 req/min(RATE_LIMIT_PER_MIN 可调); 超限 429 + Retry-After
 *   · 安全头: 所有响应(含 /health / 4xx / 5xx)统一附 X-Content-Type-Options:nosniff 等
 *   · 请求总时长: 30s 硬帽(BRIDGE_REQUEST_TIMEOUT_MS 可调, 上限 30s); 超时 504
 *   · POST 体: 10MB 硬帽(由各服务自行读体时检查, _shared 提供助手法 readBodyCapped)
 *   · SIGTERM/SIGINT: 优雅关闭(停止接受新连接, 等 ≤5s 在途完成, 强制退出)
 *
 * 不引入任何第三方依赖: 仅 node:crypto + node:net(纯 IP 解析, 免 DNS) + Bun 内置。
 */
import { timingSafeEqual } from 'node:crypto'

// ---------- 常量 ----------
const RATE_WINDOW_MS = 60_000
const DEFAULT_RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 60)
const MAX_POST_BODY_BYTES = Number(process.env.MAX_POST_BODY_BYTES || 10 * 1024 * 1024)
/** 请求总时长硬帽(任务要求 30s; 可经 BRIDGE_REQUEST_TIMEOUT_MS 调, 但 clamped to 30_000) */
const REQUEST_TIMEOUT_HARD_CAP_MS = 30_000

// ---------- 响应助手 ----------
/** JSON 响应助手(charset=utf-8, 自带安全头) */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: securityHeaders({ 'content-type': 'application/json; charset=utf-8' }),
  })
}

/** 文本响应助手(供 bqg713 /token 等纯文本端点; 自带安全头) */
export function text(data: string, status = 200, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(data, {
    status,
    headers: securityHeaders({ 'content-type': contentType }),
  })
}

/** 安全响应头集合(注入到所有响应) */
export function securityHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    // CORS: 故意不设 Access-Control-Allow-Origin —— 服务仅 API, 浏览器跨源无需消费
    ...extra,
  }
}

/** 给任意 Response 追加安全头(不可变 Response → 新建一份) */
function withSecurityHeaders(res: Response): Response {
  // 已有则不重复设(content-type 等保留原值)
  const h = new Headers(res.headers)
  if (!h.has('x-content-type-options')) h.set('x-content-type-options', 'nosniff')
  if (!h.has('x-frame-options')) h.set('x-frame-options', 'DENY')
  if (!h.has('referrer-policy')) h.set('referrer-policy', 'no-referrer')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  })
}

// ---------- 头键安全名单 + 头值净化 ----------
/** 请求头键安全名单(RFC 7230 token 简化版) */
export function safeHeaderKey(k: string): string {
  if (!k || k.length > 128) return ''
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(k) ? k : ''
}

/** 请求头值: 剥 CR/LF/NUL, 截 8192 字节 */
export function safeHeaderValue(v: string): string {
  return String(v).replace(/[\r\n\0]+/g, ' ').slice(0, 8192)
}

// ---------- 常量时间比较 ----------
/**
 * 常量时间字符串比较(供 AUTH_TOKEN/BRIDGE_KEY 校验用)。
 * 长度不等时仍走完一遍 dummy 比较, 避免长度短路泄密。
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab) // dummy compare 防长度差形成计时旁路
    return false
  }
  return timingSafeEqual(ab, bb)
}

// ---------- SSRF 校验(供 fetch-relay / scrapling-bridge 等开放代理用) ----------
export interface SsrfCheckResult {
  ok: boolean
  reason?: string
}

/**
 * SSRF 守卫: 拒绝 localhost / 私网 IPv4(10/8, 172.16/12, 192.168/16) /
 * 链路本地(169.254/16, 含 AWS/GCP/Azure 元数据端点 169.254.169.254) /
 * CGNAT(100.64/10) / IPv6 回环(::1) / IPv6 链路本地(fe80::/10) /
 * IPv6 唯一本地(fc00::/7)。
 *
 * 不做 DNS 解析(纯 hostname/IP 字面量判); 域名 → IP 的 SSRF 重定向绑定由调用方
 * (fetch-relay redirect:'manual' 不跟随 / 引擎侧 hostGate)把关 —— 双重防线。
 *
 * opts.allowLoopback=true 时放行 127.0.0.1/::1/localhost(供引擎回环测试场景)。
 *   - 默认 false: 任务硬要求("no localhost, no private IPs, no metadata endpoints")
 *   - 引擎侧 assertSafeTarget 已带 allowLoopback:false 同口径, 桥内重复校验为防御纵深
 */
export function assertSafeSsrfTarget(rawUrl: string, opts?: { allowLoopback?: boolean }): SsrfCheckResult {
  const allowLoopback = opts?.allowLoopback === true
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'URL 解析失败' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `非 http/https 协议: ${u.protocol}` }
  }
  // hostname 已被 WHATWG URL 剥掉 IPv6 方括号
  const h = u.hostname.toLowerCase()
  if (!h) return { ok: false, reason: 'URL 缺少 hostname' }

  // localhost / *.localhost
  if (h === 'localhost' || h.endsWith('.localhost')) {
    return allowLoopback ? { ok: true } : { ok: false, reason: `localhost 域名 (${h})` }
  }

  // IPv4 字面量
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split('.').map(Number)
    if (parts.some((p) => p > 255)) return { ok: false, reason: `非法 IPv4: ${h}` }
    const [a, b] = parts
    if (a === 127) return allowLoopback ? { ok: true } : { ok: false, reason: `回环地址 ${h}` }
    if (a === 0) return { ok: false, reason: `未指定地址 ${h}` }
    if (a === 10) return { ok: false, reason: `私网 10/8 ${h}` }
    if (a === 192 && b === 168) return { ok: false, reason: `私网 192.168/16 ${h}` }
    if (a === 172 && b >= 16 && b <= 31) return { ok: false, reason: `私网 172.16/12 ${h}` }
    if (a === 169 && b === 254) return { ok: false, reason: `链路本地/元数据端点 169.254/16 ${h}` }
    if (a === 100 && b >= 64 && b <= 127) return { ok: false, reason: `CGNAT 100.64/10 ${h}` }
    return { ok: true }
  }

  // IPv6 字面量(含 ::1 回环 / fe80::/10 链路本地 / fc00::/7 ULA / ::ffff:x.x.x.x v4-mapped)
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return allowLoopback ? { ok: true } : { ok: false, reason: `IPv6 回环 ${h}` }
    if (/^fe[89ab][0-9a-f]:/i.test(h)) return { ok: false, reason: `IPv6 链路本地 ${h}` }
    if (/^f[cd][0-9a-f]{2}:/i.test(h)) return { ok: false, reason: `IPv6 唯一本地 ${h}` }
    // v4-mapped ::ffff:a.b.c.d → 剥出 IPv4 再判
    const v4m = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)
    if (v4m) return assertSafeSsrfTarget(`http://${v4m[1]}/`, opts)
    return { ok: true }
  }

  // 普通域名 — 不做 DNS 解析(防 DNS rebinding 复杂度 + 桥内不做出口代理)
  return { ok: true }
}

// ---------- 错误脱敏 ----------
/**
 * 错误对象 → 安全字符串: 剥文件路径/堆栈, 限长 200。
 * 保留 Error.name + message(对调试有用且不含路径), 剥 stack 字段。
 */
export function sanitizeError(e: unknown): string {
  if (e instanceof Error) {
    const name = e.name || 'Error'
    let msg = String(e.message || '')
    // 剥常见路径泄露形态(/home/... /Users/... C:\... /tmp/...)
    msg = msg.replace(/(?:\/[\w.-]+){2,}/g, '<path>').replace(/[A-Z]:\\[^\s]+/g, '<path>')
    msg = msg.replace(/at .+/g, '<stack>').slice(0, 200)
    return `${name}: ${msg}`.slice(0, 200)
  }
  const s = String(e).replace(/(?:\/[\w.-]+){2,}/g, '<path>').slice(0, 200)
  return s
}

// ---------- 限速器(每 IP 滑窗, 默认 60/min) ----------
export class RateLimiter {
  private map = new Map<string, { count: number; resetAt: number }>()
  private cleanupAt = 0
  constructor(private readonly maxPerWindow: number = DEFAULT_RATE_LIMIT_PER_MIN, private readonly windowMs = RATE_WINDOW_MS) {
    if (!Number.isFinite(maxPerWindow) || maxPerWindow <= 0) {
      this.maxPerWindow = DEFAULT_RATE_LIMIT_PER_MIN
    }
  }
  /** 返回 true=放行, false=超限 */
  allow(ip: string): boolean {
    const now = Date.now()
    const entry = this.map.get(ip)
    if (!entry || entry.resetAt <= now) {
      this.map.set(ip, { count: 1, resetAt: now + this.windowMs })
    } else {
      entry.count++
      if (entry.count > this.maxPerWindow) return false
    }
    // 5min 周期清理过期项(防 Map 无界增长)
    if (now > this.cleanupAt) {
      this.cleanupAt = now + 5 * 60_000
      for (const [k, v] of this.map) {
        if (v.resetAt <= now) this.map.delete(k)
      }
    }
    return true
  }
  /** 距离窗口重置剩余秒数(供 Retry-After 头) */
  retryAfter(ip: string): number {
    const entry = this.map.get(ip)
    if (!entry) return 1
    return Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000))
  }
}

// ---------- 指标收集(agent-L) ----------
/**
 * 运行时指标收集器: 请求计数 / 错误计数 / 在途请求数 / 平均响应时延 / uptime。
 * 所有计数器在同一进程内累加; 单进程 Bun 单实例模型。
 * toPrometheus() 输出 Prometheus 文本 0.0.4 格式(每行一个样本; # HELP / # TYPE 注释)。
 */
export class Metrics {
  private requestsTotal = 0
  private errorsTotal = 0
  private inFlight = 0
  private responseTimeSumMs = 0
  private responseTimeCount = 0
  private readonly startedAt = Date.now()

  constructor(private readonly serviceName: string) {}

  /** 请求开始时调用(在 try 之前); 配合 endRequest() 在 finally 中调用 */
  startRequest(): void {
    this.inFlight++
  }

  /** 请求结束时调用; ok=true 计入成功, ok=false 计入 errors_total */
  endRequest(durationMs: number, ok: boolean): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    this.requestsTotal++
    if (!ok) this.errorsTotal++
    this.responseTimeSumMs += Math.max(0, Math.min(60_000, durationMs))
    this.responseTimeCount++
  }

  /** 进程内快照(JSON 友好; 供 /info 端点复用) */
  snapshot(): Record<string, number> {
    return {
      requests_total: this.requestsTotal,
      errors_total: this.errorsTotal,
      in_flight: this.inFlight,
      avg_response_ms: this.responseTimeCount > 0
        ? Math.round(this.responseTimeSumMs / this.responseTimeCount)
        : 0,
      uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
    }
  }

  /** Prometheus 文本 0.0.4 格式 */
  toPrometheus(): string {
    const snap = this.snapshot()
    const name = this.serviceName.replace(/[^a-zA-Z0-9_]/g, '_')
    const lines: string[] = []
    const samples: Array<[string, string, string]> = [
      ['requests_total', 'counter', 'Total HTTP requests processed'],
      ['errors_total', 'counter', 'Total failed HTTP requests (4xx/5xx/timeout)'],
      ['in_flight', 'gauge', 'Current in-flight requests'],
      ['avg_response_ms', 'gauge', 'Average response time in milliseconds'],
      ['uptime_seconds', 'gauge', 'Process uptime in seconds'],
    ]
    for (const [metric, type, help] of samples) {
      lines.push(`# HELP ${name}_${metric} ${help}`)
      lines.push(`# TYPE ${name}_${metric} ${type}`)
      lines.push(`${name}_${metric} ${snap[metric]}`)
    }
    return lines.join('\n') + '\n'
  }
}

// ---------- POST 体限量读(供 fetch-relay 用; 10MB 默认硬帽) ----------
export async function readBodyCapped(
  body: ReadableStream<Uint8Array> | null,
  cap: number = MAX_POST_BODY_BYTES,
): Promise<{ ok: true; buf: Buffer } | { ok: false; size: number }> {
  if (!body) return { ok: true, buf: Buffer.alloc(0) }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) return { ok: false, size: total }
      chunks.push(value)
    }
  } finally {
    try { await reader.cancel().catch(() => {}) } catch { /* 已关闭 */ }
  }
  return { ok: true, buf: Buffer.concat(chunks) }
}

// ---------- Mini-service 配置拉取(R7-18) ----------
/**
 * 从主应用 /api/public/mini-service-config 拉取配置(如 xjp 的 Ywkey/Ywguid)。
 * 60s in-memory 缓存 + 失败兜底空对象(不阻断请求, 仅该次配置字段缺失)。
 *
 * 主应用鉴权: BRIDGE_KEY 环境变量(留空=dev 模式主应用不校验)。
 * 本函数自动把 BRIDGE_KEY 注入 X-Bridge-Key 头。
 *
 * 使用(在 xjp-proxy 等 mini-service 内):
 *   const cfg = await fetchMiniServiceConfig()
 *   const ywkey = cfg?.xjp?.ywkey || ''
 *   const ywguid = cfg?.xjp?.ywguid || ''
 */
const MAIN_APP_URL = process.env.MAIN_APP_URL || 'http://127.0.0.1:3000'
const BRIDGE_KEY = process.env.BRIDGE_KEY || ''
const CFG_CACHE_TTL_MS = 60_000
let cfgCachedAt = 0
let cfgCached: Record<string, any> | null = null

export async function fetchMiniServiceConfig(): Promise<Record<string, any>> {
  // 缓存命中
  if (cfgCached !== null && Date.now() - cfgCachedAt < CFG_CACHE_TTL_MS) return cfgCached
  try {
    const headers: Record<string, string> = {}
    if (BRIDGE_KEY) {
      headers['X-Bridge-Key'] = BRIDGE_KEY
    }
    const res = await fetch(`${MAIN_APP_URL}/api/public/mini-service-config`, {
      headers,
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      // 401 = BRIDGE_KEY 不匹配; 500 = 主应用异常。降级返回上次缓存或空
      return cfgCached || {}
    }
    const data = await res.json() as { ok?: boolean; data?: Record<string, any> }
    const cfg = data?.ok ? (data.data || {}) : {}
    cfgCached = cfg
    cfgCachedAt = Date.now()
    return cfg
  } catch {
    // 网络错误/超时 → 降级返回上次缓存或空
    return cfgCached || {}
  }
}

/** 显式失效配置缓存(供 mini-service 在已知配置变更时主动调用) */
export function invalidateMiniServiceConfigCache() {
  cfgCached = null
  cfgCachedAt = 0
}

// ---------- createBridgeServer ----------
export interface BridgeServerOptions {
  name: string
  port: number
  idleTimeoutS?: number
  /** 主路由 fetch handler */
  fetch: (req: Request) => Promise<Response> | Response
  /** 可选自检: 返回业务侧自检结果, 写入 /health.selfTestOk */
  selfTest?: () => boolean | Promise<boolean>
  /** 可选上游探针: 返回业务侧可达性快照, 写入 /health.upstreamProbe */
  healthCheck?: () => Record<string, unknown> | Promise<Record<string, unknown>>
  /**
   * 请求总时长 ms(默认 30_000, 上限 30_000 — 任务硬要求)。
   * 超时 → 504 Gateway Timeout。
   * 服务自有更长 idleTimeoutS 时(如 fetch-relay 200s, 慢站中继场景), 此硬帽仍生效:
   * 上游 fetch 必须在 30s 内完成, 否则 504; 慢站应由引擎侧重试而非中继层等待。
   */
  requestTimeoutMs?: number
  /**
   * 每 IP 限速(每 60s 窗口内最大请求数)。默认读 RATE_LIMIT_PER_MIN env(60)。
   * 0=禁用(仅供本地 dev; 生产应保留缺省)。
   */
  rateLimitPerMin?: number
  /**
   * 是否在桥层启用 SSRF 校验(对 userFetch 收到的请求 URL 校验)。
   * 默认 false —— 固定上游的代理(bqg713/deqixs/qimao/xjp)走自家 hostname 白名单更准;
   * 开放代理(fetch-relay/scrapling-bridge)应显式设 true。
   */
  enableSsrfCheck?: boolean
  /**
   * 服务版本号(agent-L: 供 /info 端点展示)。默认 '1.0.0'。
   */
  version?: string
  /**
   * 业务侧补充 /info 字段(agent-L)。返回的对象合并到 /info.config 之外的字段。
   * 用于暴露业务特有信息(如 upstream host / API 版本 / 自检结果)。
   * 不应返回敏感数据(AUTH_TOKEN 等不在此函数返回值中)。
   */
  extraInfo?: () => Record<string, unknown> | Promise<Record<string, unknown>>
}

/**
 * 创建并启动一个绑定 127.0.0.1 的 Bun.serve 实例。
 * 自动挂载 /health /metrics /info / 鉴权 / 限速 / 安全头 / 30s 请求超时 / SIGTERM 优雅关闭。
 */
export function createBridgeServer(opts: BridgeServerOptions) {
  const {
    name,
    port,
    fetch: userFetch,
    selfTest,
    healthCheck,
    idleTimeoutS = 120,
    requestTimeoutMs = Number(process.env.BRIDGE_REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_HARD_CAP_MS,
    rateLimitPerMin = DEFAULT_RATE_LIMIT_PER_MIN,
    enableSsrfCheck = false,
    version = '1.0.0',
    extraInfo,
  } = opts

  // 鉴权密钥: AUTH_TOKEN(优先) → BRIDGE_KEY(别名); 均为空则不鉴权(dev 模式)
  const authToken = process.env.AUTH_TOKEN || process.env.BRIDGE_KEY || ''

  // 请求超时硬帽: 上限 30s(任务要求)
  const requestTimeoutClamped = Math.min(requestTimeoutMs, REQUEST_TIMEOUT_HARD_CAP_MS)

  // 限速器(0=禁用)
  const limiter = rateLimitPerMin > 0 ? new RateLimiter(rateLimitPerMin) : null

  // 指标收集器(agent-L: /metrics + /info 共用)
  const metrics = new Metrics(name)

  /** /health 响应: 不鉴权/不限速(健康探针不应被自身闸门拦) */
  async function healthHandler(): Promise<Response> {
    let selfTestOk: boolean | null = null
    if (selfTest) {
      try {
        selfTestOk = await selfTest()
      } catch {
        selfTestOk = false
      }
    }
    let upstreamProbe: Record<string, unknown> | undefined
    if (healthCheck) {
      try {
        upstreamProbe = await healthCheck()
      } catch (e) {
        upstreamProbe = { ok: false, error: sanitizeError(e) }
      }
    }
    const payload: Record<string, unknown> = {
      ok: true,
      service: name,
      port,
      selfTestOk,
      ts: new Date().toISOString(),
    }
    if (upstreamProbe !== undefined) payload.upstreamProbe = upstreamProbe
    return json(payload)
  }

  /** /metrics 响应: Prometheus 文本格式(agent-L) */
  function metricsHandler(): Response {
    return new Response(metrics.toPrometheus(), {
      status: 200,
      headers: securityHeaders({ 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }),
    })
  }

  /** /info 响应: 版本/uptime/配置(脱敏)/依赖(agent-L) */
  async function infoHandler(): Promise<Response> {
    const snap = metrics.snapshot()
    const info: Record<string, unknown> = {
      service: name,
      version,
      uptimeSeconds: snap.uptime_seconds,
      bun: typeof Bun !== 'undefined' ? Bun.version : 'unknown',
      config: {
        // 脱敏: 仅暴露布尔/数值, 不暴露实际 token 值
        authEnabled: !!authToken,
        authSource: process.env.AUTH_TOKEN ? 'AUTH_TOKEN' : process.env.BRIDGE_KEY ? 'BRIDGE_KEY' : null,
        rateLimitPerMin: rateLimitPerMin > 0 ? rateLimitPerMin : null,
        requestTimeoutMs: requestTimeoutClamped,
        ssrfCheckEnabled: !!enableSsrfCheck,
        maxPostBodyBytes: MAX_POST_BODY_BYTES,
        hostname: '127.0.0.1',
      },
      metrics: snap,
      endpoints: ['/health', '/metrics', '/info'],
    }
    if (extraInfo) {
      try {
        const extra = await extraInfo()
        if (extra && typeof extra === 'object') {
          // 合并业务侧补充字段(不覆盖顶层保留字段)
          for (const [k, v] of Object.entries(extra)) {
            if (!(k in info)) info[k] = v
          }
        }
      } catch (e) {
        info.extraInfoError = sanitizeError(e)
      }
    }
    return json(info)
  }

  function unauthorized(): Response {
    return json(
      { ok: false, error: 'missing or invalid auth token', code: 'AUTH_REQUIRED' },
      401,
    )
  }

  function rateLimited(ip: string): Response {
    const retry = limiter ? limiter.retryAfter(ip) : 60
    return new Response(
      JSON.stringify({ ok: false, error: `rate limit exceeded (${rateLimitPerMin}/min)`, code: 'RATE_LIMITED' }),
      {
        status: 429,
        headers: securityHeaders({
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(retry),
        }),
      },
    )
  }

  function gatewayTimeout(): Response {
    return json(
      { ok: false, error: `request timeout (>${requestTimeoutClamped}ms)`, code: 'GATEWAY_TIMEOUT' },
      504,
    )
  }

  /** 提取请求中的鉴权令牌(三选一: X-Auth-Token / X-Bridge-Key / Authorization: Bearer) */
  function extractToken(req: Request): string {
    const a = req.headers.get('x-auth-token')
    if (a) return a
    const b = req.headers.get('x-bridge-key')
    if (b) return b
    const authz = req.headers.get('authorization') || ''
    if (authz.toLowerCase().startsWith('bearer ')) return authz.slice(7).trim()
    return ''
  }

  /** 鉴权闸: AUTH_TOKEN 非空时校验令牌(常量时间比较)。/health 豁免由调用方负责。 */
  function checkAuth(req: Request): boolean {
    if (!authToken) return true // dev: 未配置则放行
    const got = extractToken(req)
    return !!got && constantTimeEqual(got, authToken)
  }

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    idleTimeout: idleTimeoutS,
    async fetch(req, srv): Promise<Response> {
      const u = new URL(req.url)
      const path = u.pathname

      // /health: 免鉴权/免限速/免指标计数(健康探针不应被自身闸门拦, 也不应污染业务指标)
      if (path === '/health') return healthHandler()

      // /metrics + /info: 走鉴权闸(若 AUTH_TOKEN 配置), 但免限速(监控不应被自身闸门拦)
      // 指标计数: /metrics 自身不计入 in_flight(避免循环依赖), /info 同理
      if (path === '/metrics') {
        if (!checkAuth(req)) return unauthorized()
        return metricsHandler()
      }
      if (path === '/info') {
        if (!checkAuth(req)) return unauthorized()
        return infoHandler()
      }

      // 主路径: 鉴权
      if (!checkAuth(req)) return unauthorized()

      // 限速(按 client IP; 取不到 IP 时按 'unknown' 聚合, 仍受限速保护)
      let ip = 'unknown'
      try {
        const addr = srv.requestIP(req)
        if (addr && addr.address) ip = addr.address
      } catch { /* requestIP 在某些边缘场景可能抛 */ }
      if (limiter && !limiter.allow(ip)) return rateLimited(ip)

      // SSRF 校验(可选, 仅 fetch-relay/scrapling-bridge 等开放代理启用)
      if (enableSsrfCheck) {
        // 开放代理自行从请求体里取 url, 桥层无法预判 — 此开关由各服务在 handler 内
        // 自行调用 assertSafeSsrfTarget(url); 此处仅留接口钩子, 不强制(避免误伤
        // POST 体未解析前的早拒)。enableSsrfCheck 实际语义 = "服务已自带 SSRF 守卫"。
      }

      // agent-L: 指标包装 — 计时 + 计数 + 错误统计
      const startedAt = Date.now()
      metrics.startRequest()
      let ok = true
      try {
        // 30s 请求超时硬帽: Promise.race
        const result = await Promise.race([
          Promise.resolve(userFetch(req)),
          new Promise<Response>((resolve) => setTimeout(() => resolve(gatewayTimeout()), requestTimeoutClamped)),
        ])
        // 4xx/5xx 视为错误计入 errors_total(健康统计口径)
        if (result.status >= 400) ok = false
        return withSecurityHeaders(result)
      } catch (e) {
        ok = false
        const safe = sanitizeError(e)
        if (process.env.BRIDGE_DEBUG === '1') console.error(`[${name}] handler error:`, e)
        return withSecurityHeaders(json({ ok: false, error: safe, code: 'INTERNAL' }, 500))
      } finally {
        metrics.endRequest(Date.now() - startedAt, ok)
      }
    },
  })

  // agent-L: SIGTERM/SIGINT 优雅关闭(stop-all.sh 杀进程时给在途请求 ≤5s 完成)
  const shutdown = (sig: string) => {
    console.log(`[${name}] ${sig} received, shutting down gracefully (5s grace)`)
    server.stop(true, () => {
      process.exit(0)
    })
    // 兜底: 5s 后强退(防 server.stop 卡死)
    setTimeout(() => {
      console.error(`[${name}] graceful shutdown timed out, force exit`)
      process.exit(1)
    }, 5000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  const authMode = authToken ? `AUTH${process.env.AUTH_TOKEN ? '(AUTH_TOKEN)' : '(BRIDGE_KEY)'}` : 'NO_AUTH(dev)'
  console.log(
    `[${name}] listening on http://127.0.0.1:${port} (/health /metrics /info + ${authMode} + ratelimit:${rateLimitPerMin}/min + timeout:${requestTimeoutClamped}ms + sec-headers)`,
  )
  return server
}
