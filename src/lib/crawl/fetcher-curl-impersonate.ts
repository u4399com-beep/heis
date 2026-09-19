// ============================================================
// curl-impersonate 桥客户端 (R29-1B) — TLS 指纹模拟降级层
// ============================================================
// 背景: 8 级降级链 native(bun/node fetch, BoringSSL/undici) → curl(系统 curl,
//   OpenSSL) → fetch-relay(bun, BoringSSL) → scrapling-static(curl_cffi) →
//   scrapling-stealthy(patchright) → Obscura → uc-bridge(undetected-chromedriver) →
//   moli-bridge(Rust AI 浏览器)。
// 其中 native / curl / fetch-relay 的 TLS 栈 ClientHello 指纹(JA3/JA4)固定,
// 部分 WAF(Akamai/Cloudflare/DataDome/PerimeterX/某些自建 GoEdge)按 JA3 hash
// 拦截常见 HTTP 客户端, 即使 UA + Client Hints + Sec-Fetch-* 头组完全自洽, TLS
// 握手阶段就被拒连 / 403。curl-impersonate(lwthiker/curl-impersonate)是 curl 的
// 补丁版, 用 BoringSSL + nghttp2 + 定制 ClientHello 完整模拟 Chrome/Firefox/Safari
// 的 TLS 握手指纹 + HTTP/2 SETTINGS 帧指纹 + 头组顺序; curl_cffi(Yifei-Kong/
// curl_cffi)是其 Python 绑定, 通过 requests-style API 暴露 impersonate 参数。
//
// 本模块(mini-services/curl-impersonate-bridge:3018 的 HTTP 客户端)在 fetchViaCurl
// (OpenSSL 栈)被 JA3-strict WAF 拦截后, 调用本桥用 curl_cffi 重发请求 — 仅传输
// 层语义, 不双发目标请求; 桥不可达 / curl_cffi 未装 / 桥内异常 → 抛错, 引擎侧
// fetchHttpWithCurlSingle 据此走原错误传播路径(零回归)。
//
// 协议(mini-services/curl-impersonate-bridge/server.py):
//   GET  /health → 200 { ok:true, curlCffiAvailable:bool, version, impersonates:list, ts }
//                  curlCffiAvailable=false 时本模块缓存 60s 视为不可用, 跳过降级(零回归)
//   POST /fetch   body: { url, headers?, proxy?, timeoutMs?, impersonate?, method? }
//                → 200 { ok:true,  status, headers:[[k,v]], setCookie:[], bodyB64 } 目标侧
//                  任何响应(含 3xx 跟随后终态/4xx/5xx)都算 ok:true 如实透传 —— 仅传输层
//                  语义; 引擎侧不再对目标双发请求(与 fetch-relay / scrapling 同契约)
//                → 200 { ok:false, error }  桥内异常(url 非法 / curl_cffi 未装 / 网络
//                  层失败 / 超时 / 代理协议不支持 / SSRF 拒绝), 引擎侧据此降级下一级
//
// 安全模型: CURL_IMPERSONATE_BRIDGE_URL 由操作员在 env 配置(可信源), 裸 fetch 直连桥
//   端点; assertSafeTarget 在 fetchPage 入口已校验目标 url 合法性。桥内 server.py 另有
//   SSRF 守卫(双重保险, 与 fetch-relay / scrapling-bridge 同范式)。
// ============================================================

/** 桥地址(操作员 env 配置, 默认本机 3018) */
export const CURL_IMPERSONATE_BRIDGE_URL =
  process.env.CURL_IMPERSONATE_BRIDGE_URL || 'http://127.0.0.1:3018'

/** 可用性探测结果缓存窗口(60s, 与 checkRelay / checkUcBridge 同口径) */
const CURL_IMPERSONATE_PROBE_RETRY_MS = 60_000

/** 永久性失败(curl_cffi 未装)缓存窗口(5 分钟, 与 uc-bridge 同口径)。
 *  curl_cffi 未装时 /health 返回 {ok:true, curlCffiAvailable:false}, 引擎侧 5 分钟内
 *  不再撞桥(避免每章节请求都试 /fetch 再失败, 万章任务万级 warn 洪泛 dev.log)。
 *  操作员装好 curl_cffi 后 5 分钟内自愈。 */
const CURL_IMPERSONATE_PERMANENT_FAIL_MS = 5 * 60_000

let curlImpersonateAvailable: boolean | null = null
let curlImpersonateCheckedAt = 0
/** 永久性失败截止时刻(0=无永久失败)。命中时 checkCurlImpersonateBridge 立即返回
 *  false 不再发 /health 探测(否则 /health 仍 200 + curlCffiAvailable:false,
 *  探测结果无意义且每请求 ECONNREFUSED 叠加) */
let curlImpersonatePermanentFailUntil = 0

/** 桥响应体上限(与 fetch-relay 同量级, 防 OOM) */
const CURL_IMPERSONATE_MAX_JSON_BYTES = 20 * 1024 * 1024

/**
 * curl-impersonate 桥可用性探测(/health), 结果按 60s 缓存(与 checkRelay 同口径)。
 * 解析 /health body 中的 curlCffiAvailable 字段: false 表示 curl_cffi 未装(永久
 * 失败), 设 5 分钟窗口不再撞桥; true 才视为可用。桥进程不可达(ECONNREFUSED)→
 * 视为不可用, 60s 内不再撞。
 */
export async function checkCurlImpersonateBridge(): Promise<boolean> {
  if (curlImpersonateAvailable === true) return true
  // 永久失败窗口内立即返回 false, 跳过 /health 探测
  if (curlImpersonatePermanentFailUntil > 0 && Date.now() < curlImpersonatePermanentFailUntil) {
    return false
  }
  if (curlImpersonateAvailable === false && Date.now() - curlImpersonateCheckedAt < CURL_IMPERSONATE_PROBE_RETRY_MS) {
    return false
  }
  try {
    const res = await fetch(`${CURL_IMPERSONATE_BRIDGE_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) {
      curlImpersonateAvailable = false
    } else {
      // 解析 /health body, 检查 curlCffiAvailable 字段
      // 协议: GET /health → 200 { ok:true, curlCffiAvailable:boolean, ... }
      // curlCffiAvailable=false 表示桥进程在跑但 curl_cffi 未装, 调用 /fetch 必然失败;
      // 视为永久失败设 5 分钟窗口, 不再撞桥
      let curlCffiAvailable = true
      try {
        const data = (await res.json()) as { ok?: unknown; curlCffiAvailable?: unknown }
        if (data && data.curlCffiAvailable === false) curlCffiAvailable = false
      } catch {
        // /health body 非 JSON(老版本桥) → 兼容默认 curlCffiAvailable=true, 由 /fetch 实测兜底
      }
      if (!curlCffiAvailable) {
        curlImpersonateAvailable = false
        curlImpersonatePermanentFailUntil = Date.now() + CURL_IMPERSONATE_PERMANENT_FAIL_MS
        console.warn(
          `[fetcher] curl-impersonate-bridge /health curlCffiAvailable=false` +
            `(curl_cffi 未装? 需在 mini-services/curl-impersonate-bridge/.venv 装 curl_cffi),` +
            `桥降级 ${CURL_IMPERSONATE_PERMANENT_FAIL_MS / 1000}s 后重探`,
        )
      } else {
        curlImpersonateAvailable = true
      }
    }
  } catch {
    // 桥进程不可达(ECONNREFUSED / 超时) → 视为不可用, 60s 内不再撞
    curlImpersonateAvailable = false
  }
  curlImpersonateCheckedAt = Date.now()
  return curlImpersonateAvailable
}

/** 把引擎 FetchConfig.tlsProfile 映射为 curl_cffi impersonate 字符串。
 *  curl_cffi 支持的 profile 列表(2024-2025 主流): chrome99/100/101/104/107/110/116/
 *  119/120/123/124/131, edge99/101, safari15_3/15_5/17_0/17_2_ios, firefox102/109/117/120。
 *  引擎 FetchConfig.tlsProfile 现支持 chrome120/firefox121/safari17 三档(types.ts 白名单);
 *  firefox121 → firefox120(curl_cffi 无 121, 用最接近的 120); safari17 → safari17_0;
 *  chrome120 → chrome120; 未配置 → chrome120(最通用, Chrome 占浏览器市占 70%+)。
 *  映射不在白名单内时返回 chrome120 兜底(防 curl_cffi 抛 CURLIgnoredError) */
export function tlsProfileToImpersonate(tlsProfile: string | undefined | null): string {
  if (!tlsProfile) return 'chrome120'
  const p = String(tlsProfile).toLowerCase()
  if (p === 'chrome120') return 'chrome120'
  if (p === 'firefox121' || p === 'firefox120') return 'firefox120'
  if (p === 'safari17' || p === 'safari17_0') return 'safari17_0'
  return 'chrome120'
}

/** curl-impersonate 桥请求参数 */
export interface CurlImpersonateOptions {
  url: string
  /** 引擎组装好的请求头组(含 UA / Client Hints / Sec-Fetch-* / Cookie / Referer) */
  headers?: Record<string, string>
  /** 出口代理(http(s)/socks5 全形态; 桥内 curl_cffi 走 curl -x 全形态) */
  proxy?: string
  /** 超时 ms(钳 [2000, 30000], 与 fetch-relay 同口径) */
  timeoutMs?: number
  /** curl_cffi impersonate profile 字符串(见 tlsProfileToImpersonate); 缺省 'chrome120' */
  impersonate?: string
  /** HTTP 方法(GET/HEAD; 桥不支持 POST — 仅作传输层, 引擎层 fetcher.ts 调用本桥只为
   *  GET 章节正文 / 列表 HTML, 不发 POST) */
  method?: 'GET' | 'HEAD'
  /** 客户端侧 AbortSignal(超时护栏只防桥进程僵死, 桥自身对目标限时 30s) */
  clientSignal?: AbortSignal
}

/** curl-impersonate 桥响应信封 */
export interface CurlImpersonateResult {
  /** 解码后的目标响应体(已按 charset 转 string; 桥返回 base64, 本模块解码后交给调用方) */
  html: string
  /** 目标侧 HTTP 状态码(3xx 跟随后终态) */
  status: number
  /** 目标侧 Set-Cookie 全部(curl_cffi 跟随重定向后所有轮次的 set-cookie 收集) */
  setCookies: string[]
  /** 目标侧响应头(去除 Set-Cookie 后的全部头, 供上层 WAF 检测识别 cf-ray 等) */
  headers: [string, string][]
  /** 跟随重定向后的最终 URL(桥侧简化为原 url, curl_cffi 跨版本 final_url 不可靠) */
  finalUrl: string
}

/**
 * curl-impersonate 桥错误。status 字段供 fetchHttpWithCurlSingle 的错误传播逻辑判定:
 * 有 status 表示桥成功拿到目标侧 HTTP 响应(403/5xx 等, 上层 fallbackStatus/Cookie
 * 挑战重试判定依赖这些字段); 无 status 表示桥内异常(传输层失败), 走原错误传播路径。
 */
export class CurlImpersonateError extends Error {
  /** 目标侧 HTTP 状态码(0=桥内异常, 未拿到目标侧响应) */
  status: number
  /** 目标侧响应体(与 status>0 配套, 供上层 looksBlocked / fallbackStatus 判定) */
  bodyHtml?: string
  /** Retry-After 头(秒数, 429/503 抢救, 与 fetchHttp 错误对象同口径) */
  retryAfterMs?: number
  /** WAF 头透传(与 fetchHttp / fetchViaCurl 错误对象同口径) */
  serverHeader?: string
  cfRay?: string
  cfMitigated?: string
  constructor(message: string) {
    super(message)
    this.name = 'CurlImpersonateError'
    this.status = 0
  }
}

/** Retry-After 头解析(与 fetcher.ts parseRetryAfterHeaderMs 同口径) */
function parseRetryAfterMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (/^\d+$/.test(s)) {
    const v = parseInt(s, 10)
    if (Number.isFinite(v) && v > 0) return Math.min(v, 3600) * 1000
    return undefined
  }
  const d = Date.parse(s)
  if (Number.isFinite(d)) {
    const ms = d - Date.now()
    return ms > 0 ? Math.min(ms, 3600_000) : 0
  }
  return undefined
}

/**
 * 经 curl-impersonate 桥抓取一次。成功返回 {html, status, setCookies, headers, finalUrl}。
 * 桥不可达 / curl_cffi 未装 / 桥内异常 → 抛 CurlImpersonateError(status=0)。目标侧 HTTP
 * 响应(4xx/5xx)→ 抛 CurlImpersonateError(status=<目标侧码>, bodyHtml=<响应体>), 让上层
 * fetchHttpWithCurlSingle 的错误传播逻辑判定是否透传该错误(若 curl 原始错误也有 status
 * 则保留原错误语义, 否则用 curl-impersonate 的 status 错误)。
 *
 * 失败语义(照 fetchViaUcBridge / fetchViaScraplingBridge 契约同向):
 *   - 桥进程不可达 / curl_cffi 未装 → CurlImpersonateError(status=0, message='桥不可达: ...')
 *     → 引擎走原错误传播路径(零回归)
 *   - 桥内异常(ok:false, error 含 SSRF/超时/网络层失败) → CurlImpersonateError(status=0,
 *     message='桥内失败: ...') → 引擎走原错误传播路径
 *   - 目标侧 4xx/5xx(ok:true, status>=400) → CurlImpersonateError(status=<码>,
 *     bodyHtml=<响应体>) → 引擎可用该错误替代原 curl 网络层错误(无 status 的),
 *     保留目标侧 bodyHtml 供 fallbackStatus/Cookie 挑战重试判定
 */
export async function fetchViaCurlImpersonate(opts: CurlImpersonateOptions): Promise<CurlImpersonateResult> {
  // 可用性短超时快返(与 checkRelay / checkUcBridge 同口径): 桥不在时每请求
  // ECONNREFUSED ~50ms, 60s 内缓存避免叠加
  if (!(await checkCurlImpersonateBridge())) {
    const err = new CurlImpersonateError(`curl-impersonate-bridge 不可达(进程未启 / curl_cffi 未装 / 60s 缓存窗口内)`)
    err.status = 0
    throw err
  }
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 20000
  // 钳到桥侧硬帽 30s(与 fetch-relay 同口径)
  const clampedTimeout = Math.min(Math.max(timeoutMs, 2000), 30_000)
  const impersonate = opts.impersonate || 'chrome120'
  const method = opts.method || 'GET'
  const body = JSON.stringify({
    url: opts.url,
    headers: opts.headers || {},
    proxy: opts.proxy || '',
    timeoutMs: clampedTimeout,
    impersonate,
    method,
  })
  let res: Response
  try {
    res = await fetch(`${CURL_IMPERSONATE_BRIDGE_URL}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // 客户端护栏只防桥进程僵死(桥自身对目标限时 30s); 冗余 15s, 下限 45s(防止
      // curl_cffi 冷启 + 慢站超时叠加, 与 fetchViaScraplingBridge 同口径)
      signal: opts.clientSignal ?? AbortSignal.timeout(Math.max(clampedTimeout + 15_000, 45_000)),
    })
  } catch (e: any) {
    // 桥进程不可达 / 客户端超时
    const err = new CurlImpersonateError(
      `curl-impersonate-bridge 不可达(${CURL_IMPERSONATE_BRIDGE_URL}): ${String(e?.message || e).slice(0, 140)}`,
    )
    err.status = 0
    throw err
  }
  if (!res.ok) {
    // 桥响应形态非法(非 200, 理论不可达 — 桥内 ok:false 也走 200 信封, 此处仅桥进程
    // 崩溃 / 内部 500 等极端情况)
    const err = new CurlImpersonateError(`curl-impersonate-bridge 响应形态非法(HTTP ${res.status})`)
    err.status = 0
    throw err
  }
  // 流式读 + 计数(与 relayHop 同口径, 防中继层未限大小就塞进来 OOM)
  let payloadText: string
  const cl = Number(res.headers.get('content-length') || 0)
  if (cl && cl > CURL_IMPERSONATE_MAX_JSON_BYTES) {
    try { await res.body?.cancel().catch(() => {}) } catch { /* ignore */ }
    const err = new CurlImpersonateError(`curl-impersonate-bridge 响应体过大(content-length=${cl} > ${CURL_IMPERSONATE_MAX_JSON_BYTES}字节), 已中止`)
    err.status = 0
    throw err
  }
  if (res.body && typeof (res.body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    const dec = new TextDecoder('utf-8')
    let acc = ''
    let total = 0
    let overflow = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > CURL_IMPERSONATE_MAX_JSON_BYTES) {
        overflow = true
        try { await reader.cancel().catch(() => {}) } catch { /* ignore */ }
        break
      }
      acc += dec.decode(value, { stream: true })
    }
    acc += dec.decode() // flush
    if (overflow) {
      const err = new CurlImpersonateError(`curl-impersonate-bridge 响应体流式读超 ${CURL_IMPERSONATE_MAX_JSON_BYTES}字节上限, 已中止`)
      err.status = 0
      throw err
    }
    payloadText = acc
  } else {
    // 无 body 流(理论不可达, 兜底走 text())
    payloadText = await res.text()
    if (payloadText.length > CURL_IMPERSONATE_MAX_JSON_BYTES) {
      const err = new CurlImpersonateError(`curl-impersonate-bridge 响应体过大(${payloadText.length} > ${CURL_IMPERSONATE_MAX_JSON_BYTES}字符, 已读取)`)
      err.status = 0
      throw err
    }
  }
  let payload: {
    ok?: boolean
    status?: number
    headers?: [string, string][]
    setCookie?: string[]
    bodyB64?: string
    finalUrl?: string
    error?: string
  }
  try {
    payload = JSON.parse(payloadText)
  } catch (e: any) {
    const err = new CurlImpersonateError(`curl-impersonate-bridge 响应非 JSON: ${String(e?.message || e).slice(0, 100)}`)
    err.status = 0
    throw err
  }
  // ok:false → 桥内异常(传输层失败 / curl_cffi 未装 / SSRF 拒绝 / 超时)
  if (payload.ok === false || typeof payload.status !== 'number' || typeof payload.bodyB64 !== 'string') {
    const err = new CurlImpersonateError(`curl-impersonate-bridge 桥内失败: ${String(payload.error || '响应形态非法').slice(0, 200)}`)
    err.status = 0
    throw err
  }
  // ok:true → 目标侧响应(含 3xx 跟随后终态 / 4xx / 5xx)如实透传
  const status = payload.status
  // 解码 bodyB64 → utf-8 string(与 relayHop 同口径; charset 由 curl_cffi 自动协商,
  // 中文站通常返回 utf-8, 与引擎 decodeBuffer 二级探测口径同源)
  let html: string
  try {
    const buf = Buffer.from(payload.bodyB64, 'base64')
    // bodyB64 上限校验(与 relayHop 同口径, 防中继层未限大小就塞进来 OOM)
    if (payload.bodyB64.length > Math.ceil(CURL_IMPERSONATE_MAX_JSON_BYTES * 4 / 3)) {
      const err = new CurlImpersonateError(`curl-impersonate-bridge bodyB64 过大(${payload.bodyB64.length}字符), 已拒绝`)
      err.status = 0
      throw err
    }
    // 简单 utf-8 解码(curl_cffi 已按响应 Content-Type 自动解码; 引擎层 decodeBuffer
    // 的 charset 头 + meta + 字节嗅探三级探测在调用方 fetchHttpWithCurlSingle 不可见,
    // 此处直接 toString('utf-8') 兜底, 与 fetch-relay 的 toArrayBufferView 同口径)
    html = buf.toString('utf-8')
  } catch (e: any) {
    const err = new CurlImpersonateError(`curl-impersonate-bridge bodyB64 解码失败: ${String(e?.message || e).slice(0, 100)}`)
    err.status = 0
    throw err
  }
  const headers = Array.isArray(payload.headers) ? payload.headers : []
  const setCookies = Array.isArray(payload.setCookie) ? payload.setCookie : []
  // 目标侧 4xx/5xx → 抛 CurlImpersonateError(status=<码>, bodyHtml=<响应体>), 让上层
  // fallbackStatus / Cookie 挑战重试判定可消费(与 fetchViaCurl 错误对象同口径)
  if (status >= 400) {
    const err = new CurlImpersonateError(`HTTP ${status}(curl-impersonate)`)
    err.status = status
    err.bodyHtml = html
    // 解析 WAF 头(与 fetchViaCurl 同口径: server/cf-ray/cf-mitigated/retry-after)
    for (const [k, v] of headers) {
      const lk = String(k).toLowerCase()
      if (lk === 'server') err.serverHeader = String(v)
      else if (lk === 'cf-ray') err.cfRay = String(v)
      else if (lk === 'cf-mitigated') err.cfMitigated = String(v)
      else if (lk === 'retry-after') {
        const ram = parseRetryAfterMs(String(v))
        if (ram !== undefined) err.retryAfterMs = ram
      }
    }
    throw err
  }
  return {
    html,
    status,
    setCookies,
    headers,
    finalUrl: payload.finalUrl || opts.url,
  }
}
