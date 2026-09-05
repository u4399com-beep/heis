// ============================================================
// bun fetch 中继桥 (gg 轮) — 端口 3011, 仅绑定 127.0.0.1
// ============================================================
// 场景: 采集引擎跑在 node 运行时(next dev)时, RequestInit.proxy 被全局 fetch(undici)
// 静默忽略 → 引擎对代理请求只能走 curl 子进程链, 而 curl 的 OpenSSL TLS 指纹被部分
// WAF 按 JA3 拦截(gg-b wanben GoEdge 实录: 同代理同 URL, bun 直抓 200 / 引擎 curl 链
// 403 交替)。本服务以 bun 运行时(BoringSSL 栈 + RequestInit.proxy 原生支持)代为发起
// 请求, 引擎侧(src/lib/crawl/fetcher.ts relayHop)把响应重组为 Response 形态嵌入逐跳
// 循环 → node+代理场景获得 bun 级 TLS 指纹。
//
// 协议:
//   GET  /health → { ok: true, runtime: 'bun' }
//   POST /fetch   body: { url, headers: Record<string,string>, proxy?, timeoutMs? }
//                 → 200 { status, headers: [k,v][], setCookie: string[], bodyB64 }
//                    (目标侧所有响应 —— 含 3xx/4xx/5xx —— 均忠实转发为 200 信封,
//                     redirect:'manual' 不跟随, 引擎逐跳循环全权处理)
//                 → 502 { relayError } 仅中继层失败(不可达目标/代理协议不支持/超时)
//
// 安全: hostname 钉 127.0.0.1(不对外); url 仅 http/https; 请求头键经安全名单过滤;
//       请求体/响应体均流式限量读(1MB/20MB, ss-d: 超限即取消不全量缓冲); 超时上限 RELAY_MAX_TIMEOUT_MS;
//       redirect:'manual' 不跟随(引擎逐跳全权处理, 无跟随后复检面)。
//       SSRF 面裁(ss-d 留档): 本桥是引擎专属传输介质而非代理 —— 目标 host 由引擎侧
//       hostGate/isLoopbackTarget 把关, 且 verify-gg-d-relay-token C 段依赖回环目标可达,
//       桥内私网段拦截会破坏既有断言资产与回环豁免语义, 故不加(记录不修)。
// ============================================================

const PORT = 3011
const HOST = '127.0.0.1'
const RELAY_MAX_BODY_BYTES = 20 * 1024 * 1024
const RELAY_MAX_REQUEST_BYTES = 1024 * 1024
const RELAY_MAX_TIMEOUT_MS = 120_000
// ss-d: 显式 idleTimeout(秒)。Bun 缺省 idleTimeout 对 GET 在途请求 ~12s 即杀(ss-d 三档实测),
// 本桥全 POST 契约实测 130s 在途存活 —— 显式化 200s 覆盖 RELAY_MAX_TIMEOUT_MS=120s +
// 20MB 响应 base64 重组开销, 防未来 Bun 阈值变化静默破坏慢站中继(中继桥存在的意义)。
const RELAY_IDLE_TIMEOUT_S = 200

/** 流式限量读 body(请求/响应两用): 超限立即取消返回超限标记, 防全量缓冲内存炸面(ss-d) */
async function readBodyCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<{ ok: true; buf: Buffer } | { ok: false; size: number }> {
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

/**
 * 请求体限量读(ss-d2): 内存面与 readBodyCapped 同 —— 只缓冲 ≤cap 部分; 超限后继续**丢弃式排空**
 * (不缓冲, 5s 截止防无限流)而非立即 cancel —— Bun.serve 早拒+未消费体会导致 keep-alive 失步
 * (残留体字节被服务端解析器当下一请求, 连接被杀, 复用方 fetch 抛 "socket closed unexpectedly",
 * 本机实测复现)。排空保持连接同步, 失步仅存于 >5s 超长流这种极端形态。
 */
async function readRequestCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<{ ok: true; buf: Buffer } | { ok: false; size: number }> {
  if (!body) return { ok: true, buf: Buffer.alloc(0) }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const deadline = Date.now() + 5000
  let over = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) {
        over = true
        if (Date.now() > deadline) break
      } else {
        chunks.push(value)
      }
    }
  } finally {
    try { await reader.cancel().catch(() => {}) } catch { /* 已关闭 */ }
  }
  return over ? { ok: false, size: total } : { ok: true, buf: Buffer.concat(chunks) }
}

/** 头键白名单(RFC 7230 token 简化版): 与引擎 safeHeaderKey 同向, 防头注入/非法键 */
function safeHeaderKey(k: string): string | null {
  if (!k || k.length > 128) return null
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(k) ? k : null
}
function safeHeaderValue(v: string): string {
  // 剥 CR/LF/NUL(响应头值本不该有, 防御性)
  return String(v).replace(/[\r\n\0]+/g, ' ').slice(0, 8192)
}

interface FetchBody {
  url?: unknown
  headers?: unknown
  proxy?: unknown
  timeoutMs?: unknown
}

/** 日志脱钉: 仅 host+path(查询串可能含 token, 不落日志) */
function safeHostPath(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.host}${u.pathname}`
  } catch {
    return '(unparseable-url)'
  }
}

Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: RELAY_IDLE_TIMEOUT_S,
  async fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/health') {
      return Response.json({ ok: true, runtime: 'bun', ts: Date.now() })
    }
    if (u.pathname !== '/fetch' || req.method !== 'POST') {
      return new Response('not found', { status: 404 })
    }

    let body: FetchBody
    try {
      // ss-d: 请求体限量读(流式硬帽 1MB, 与 scrapling-bridge MAX_REQUEST_BYTES 同量级);
      // ss-d2: content-length 硬拒改流式排空(见 readRequestCapped 注) —— 早拒会致 keep-alive 失步
      const reqBody = await readRequestCapped(req.body, RELAY_MAX_REQUEST_BYTES)
      if (!reqBody.ok) {
        return Response.json({ relayError: `请求体超限(>${RELAY_MAX_REQUEST_BYTES}B)` }, { status: 502 })
      }
      // ss-d2: 空体/字面量 null 解析为 null → body.url 抛 TypeError → Bun 500 错误页(残改实录,
      // 引擎契约是 502 {relayError} 信封) → 非对象解析结果一律归 502 请求体非 JSON
      const parsed = JSON.parse(reqBody.buf.toString('utf8') || 'null') as FetchBody
      if (!parsed || typeof parsed !== 'object') {
        return Response.json({ relayError: '请求体非 JSON' }, { status: 502 })
      }
      body = parsed
    } catch {
      return Response.json({ relayError: '请求体非 JSON' }, { status: 502 })
    }

    const url = typeof body.url === 'string' ? body.url : ''
    if (!/^https?:\/\//i.test(url) || url.length > 2048) {
      return Response.json({ relayError: 'url 非法(仅 http/https)' }, { status: 502 })
    }
    const proxy = typeof body.proxy === 'string' && body.proxy ? body.proxy : undefined
    if (proxy && (!/^(https?|socks5h?|socks4a?):\/\/[^\s,]+$/.test(proxy) || proxy.length > 500)) {
      return Response.json({ relayError: 'proxy 形态非法' }, { status: 502 })
    }
    const timeoutMs = Math.min(
      Math.max(typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? body.timeoutMs : 20_000, 1000),
      RELAY_MAX_TIMEOUT_MS,
    )

    const headers: Record<string, string> = {}
    if (body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)) {
      for (const [k, v] of Object.entries(body.headers as Record<string, unknown>)) {
        const key = safeHeaderKey(k)
        if (key && (typeof v === 'string' || typeof v === 'number')) headers[key] = safeHeaderValue(String(v))
      }
    }

    const startedAt = Date.now()
    try {
      const init: RequestInit & { proxy?: string } = {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      }
      if (proxy) init.proxy = proxy
      const res = await fetch(url, init)
      // ss-d: 流式限量读响应体(超限即 cancel, 不再全量缓冲后才查上限)
      const upBody = await readBodyCapped(res.body, RELAY_MAX_BODY_BYTES)
      if (!upBody.ok) {
        console.log(`[fetch-relay] FAIL ${res.status} ${safeHostPath(url)} (${Date.now() - startedAt}ms): 响应体超限(>${RELAY_MAX_BODY_BYTES}B, 已取消)`)
        return Response.json({ relayError: `响应体超限(>${RELAY_MAX_BODY_BYTES}B)` }, { status: 502 })
      }
      const buf = upBody.buf
      // 响应头: set-cookie 走专用通道保留多条, 其余按 [k,v] 对保留
      const hdrs: [string, string][] = []
      res.headers.forEach((v, k) => {
        if (k.toLowerCase() === 'set-cookie') return
        hdrs.push([k, v])
      })
      const setCookie: string[] =
        typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
          ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie().map(safeHeaderValue)
          : []
      return Response.json({
        status: res.status,
        headers: hdrs,
        setCookie,
        bodyB64: Buffer.from(buf).toString('base64'),
      })
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      // ss-d: 中继层失败留档(仅 host+path, 不落全 URL —— 目标 URL 查询串可能含 token)
      console.log(`[fetch-relay] FAIL ${safeHostPath(url)} (${Date.now() - startedAt}ms): ${msg.slice(0, 200)}`)
      return Response.json({ relayError: msg.slice(0, 300) }, { status: 502 })
    }
  },
})

console.log(`[fetch-relay] bun fetch 中继桥已启动 http://${HOST}:${PORT} (/health /fetch)`)
