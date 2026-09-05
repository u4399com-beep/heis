// ============================================================
// 抓取器 — 反反爬策略
// HTTP 引擎: UA轮换/Cookie罐/Referer/编码识别/重试/Cookie挑战重试
// 浏览器引擎: 优先 Obscura(--stealth 轻量无头, 见 ./obscura.ts),
//             失败降级裸 Playwright JS渲染
// auto 模式: HTTP 被拦截(403/412/429/503/验证码特征/JS挑战)自动升级浏览器渲染
// ============================================================
import iconv from 'iconv-lite'
import { type FetchConfig, DEFAULT_FETCH_CONFIG, isValidMirrorHost } from './types'
import { obscuraFetch, checkObscuraAvailable, clickSelectorAnywhere, buildIdentityInitScript, applyUaCdpOverride } from './obscura'

// ---------- UA 池 ----------
// C.3(y-a重放): Chrome 系版本升级至当前稳定段 137~140(原池 118~131 过旧, 属明显
// 爬虫指纹特征); Edge 与 Chromium 同主版本号配对(Edg/137↔Chrome/137, 真实 Edge
// 即如此), 防 UA 与版本指纹自相矛盾。注: 引擎请求头从不携带 sec-ch-ua 等
// Client Hints 头(grep 全库无此头), 不存在"sec-ch-ua 与 UA 版本不一致"的配对面;
// Safari/Firefox 条目不在本轮范围, 保持原样(最小改动)
export const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2102J2SC Build/TKQ1.220829.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.0.0 Mobile Safari/537.36',
  // —— 扩充池(Chrome 137~140 / Edge / Firefox 126+ / Safari 17.5 / Android / iOS), 与上无重复 ——
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
]

export function randomUa(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)]
}

// ---------- 浏览器指纹头组 (ff-b 增强①) ----------
/**
 * 场景: UA 轮换只解决了 User-Agent 单头, 真实浏览器还固定携带一组与 UA 严格配套的
 * Client Hints(sec-ch-ua*)与 Fetch Metadata(Sec-Fetch-*)头 —— "只有 UA 没有配套头组"
 * 与"sec-ch-ua 版本和 UA 版本不一致"/"Android UA 配桌面 platform"一样, 都是自相矛盾的
 * 非浏览器指纹。本层按【实际选中的 UA】推导完整指纹头组(仅 HTTP 链注入, 见 buildHeaders):
 *  - Chromium 系(Chrome/Edge): sec-ch-ua(品牌版本从 UA 提取, 与 UA 同版)+ sec-ch-ua-mobile
 *    (?0/?1 按 UA 移动性)+ sec-ch-ua-platform(按 UA 平台段: Windows/macOS/Linux/Android/iOS);
 *  - Sec-Fetch-*(Chromium/Firefox 导航均发送): Dest: document/Mode: navigate/User: ?1,
 *    Site 按 Referer 与目标 host 关系取 none(直接输入)/same-origin(同站来源)/cross-site;
 *  - Safari 不发送 Client Hints 与 Sec-Fetch-*(Fetch Metadata 不支持) → 一律不注入,
 *    防"Safari UA 带 Chromium 专属头"的反向破绽; Firefox 发送 Sec-Fetch-* 但无 Client Hints;
 *  - Upgrade-Insecure-Requests: 三家浏览器文档导航均发送。
 * 一致性即本能力的核心: Android 移动 UA 必然配 sec-ch-ua-mobile: ?1 + platform "Android"。
 * 注入点纪律: 仅 fetchHttp/fetchViaCurl(HTTP 链)经 buildHeaders({fingerprint:true}) 启用;
 * 裸 Playwright 链刻意不注入 —— 真浏览器自身发送原生 Sec-Fetch-* 与 sec-ch-ua, extraHTTPHeaders
 * 再注入同名头会产生重复头/覆盖冲突(双值头反而可疑), UA 之外的头组交给真浏览器自洽。
 */
const CHROME_VER_RE = /Chrome\/(\d+)/
const EDGE_VER_RE = /Edg(?:e|A|iOS)?\/(\d+)/

/** UA 移动性判定: 池内 iPhone/iPad/Android 与通用 Mobile 标记 */
export function isMobileUa(ua: string): boolean {
  return /iPhone|iPad|Android|Mobile Safari|;\s*Mobile\//.test(ua)
}

/** UA 家族判定(决定头组构成) */
function uaFamilyOf(ua: string): 'chromium' | 'safari' | 'firefox' | 'unknown' {
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Chrome\/|\bEdg\b/.test(ua)) return 'chromium'
  if (/Safari\//.test(ua)) return 'safari'
  return 'unknown'
}

/** sec-ch-ua-platform 值: 从 UA 平台段推导(Chromium 系才发送, 需与 UA 自洽) */
function uaPlatformHint(ua: string): string {
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad|iOS|iPhone OS/.test(ua)) return 'iOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS|Macintosh/.test(ua)) return 'macOS'
  if (/CrOS/.test(ua)) return 'Chrome OS'
  if (/X11|Linux/.test(ua)) return 'Linux'
  return 'Windows'
}

/** Sec-Fetch-Site: 按 Referer 与目标 host 关系还原真实导航语义 */
function secFetchSite(referer: string, targetUrl: string): string {
  if (!referer) return 'none'
  try {
    const rHost = new URL(referer).host.toLowerCase()
    const tHost = new URL(targetUrl).host.toLowerCase()
    return rHost === tHost ? 'same-origin' : 'cross-site'
  } catch {
    return 'none'
  }
}

/** 从 UA 生成完整指纹头组(与 buildHeaders 合并, cfg.headers 可覆盖单项) */
export function fingerprintHeadersFor(ua: string, referer: string, targetUrl: string): Record<string, string> {
  const family = uaFamilyOf(ua)
  const headers: Record<string, string> = {
    'Upgrade-Insecure-Requests': '1',
  }
  if (family === 'chromium' || family === 'firefox') {
    headers['Sec-Fetch-Dest'] = 'document'
    headers['Sec-Fetch-Mode'] = 'navigate'
    headers['Sec-Fetch-Site'] = secFetchSite(referer, targetUrl)
    headers['Sec-Fetch-User'] = '?1'
  }
  if (family === 'chromium') {
    const cv = ua.match(CHROME_VER_RE)?.[1] || ''
    const ev = ua.match(EDGE_VER_RE)?.[1] || ''
    if (cv) {
      const brands = ev
        ? `"Chromium";v="${cv}", "Google Chrome";v="${cv}", "Microsoft Edge";v="${ev}", "Not:A-Brand";v="24"`
        : `"Chromium";v="${cv}", "Google Chrome";v="${cv}", "Not:A-Brand";v="24"`
      headers['sec-ch-ua'] = brands
      headers['sec-ch-ua-mobile'] = isMobileUa(ua) ? '?1' : '?0'
      headers['sec-ch-ua-platform'] = `"${uaPlatformHint(ua)}"`
    }
  }
  return headers
}

// ---------- Cookie 罐 (按域名) ----------
/** 会话条目 TTL(ff-b 增强④): 挑战/会话 Cookie(如 cf_clearance)与出口 IP+UA 绑定,
 *  30 分钟前的陈旧会话继续携带反而是"过期会话+拒绝服务"的 403 诱因 —— 真实浏览器
 *  会话同样有时效。过期条目在 get/count 惰性清扫; 跨请求复用本体(按 host 缓存、
 *  下次同 host 直接带)是既有 autoCookie 全局罐能力, 本轮仅补时效与失效清理 */
const COOKIE_SESSION_TTL_MS = 30 * 60 * 1000

class CookieJar {
  private jars = new Map<string, Map<string, { v: string; at: number }>>()
  /** 未过期条目判定(过期即惰性删除) */
  private fresh(jar: Map<string, { v: string; at: number }>, k: string, e: { at: number }): boolean {
    if (Date.now() - e.at < COOKIE_SESSION_TTL_MS) return true
    jar.delete(k)
    return false
  }
  get(domain: string): string {
    const jar = this.jars.get(domain)
    if (!jar || jar.size === 0) return ''
    const out: string[] = []
    for (const [k, e] of jar) {
      if (this.fresh(jar, k, e)) out.push(`${k}=${e.v}`)
    }
    return out.join('; ')
  }
  /** 当前域名已存(未过期)cookie 数(用于判断本次响应是否刚种下新 Cookie) */
  count(domain: string): number {
    const jar = this.jars.get(domain)
    if (!jar) return 0
    let n = 0
    for (const [k, e] of jar) {
      if (this.fresh(jar, k, e)) n++
    }
    return n
  }
  store(domain: string, setCookieHeaders: string[]) {
    if (!setCookieHeaders?.length) return
    let jar = this.jars.get(domain)
    if (!jar) { jar = new Map(); this.jars.set(domain, jar) }
    for (const raw of setCookieHeaders) {
      const [pair] = raw.split(';')
      const idx = pair.indexOf('=')
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), { v: pair.slice(idx + 1).trim(), at: Date.now() })
    }
  }
  seed(domain: string, cookieStr?: string) {
    if (!cookieStr) return
    let jar = this.jars.get(domain)
    if (!jar) { jar = new Map(); this.jars.set(domain, jar) }
    for (const pair of cookieStr.split(';')) {
      const idx = pair.indexOf('=')
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), { v: pair.slice(idx + 1).trim(), at: Date.now() })
    }
  }
  /** 清空指定 host 的罐(ff-b): 403 且无新 Cookie 时疑陈旧会话, 清空重走 autoCookie */
  clear(domain: string) {
    this.jars.delete(domain)
  }
}
const globalForJar = globalThis as unknown as { __novelCookieJar_v3?: CookieJar }
// 版本化缓存键: dev 热更新时旧进程实例可能缺少新方法/旧条目结构(纯字符串 vs 时间戳对象),
// 结构不匹配则重建(v2 纯串实例不含 TTL 时间戳, 复用会让 fresh() 读到 undefined)
function validJar(j: CookieJar | undefined): j is CookieJar {
  return !!j && typeof j.count === 'function' && typeof j.store === 'function' && typeof j.clear === 'function'
}
export const cookieJar = validJar(globalForJar.__novelCookieJar_v3)
  ? globalForJar.__novelCookieJar_v3
  : new CookieJar()
globalForJar.__novelCookieJar_v3 = cookieJar

// ---------- 编码识别 ----------
function stripBom(s: string): string {
  // 去 UTF-8 BOM(\uFEFF): 避免首段隐形字符污染标题匹配/正文开头
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function decodeBuffer(buf: ArrayBuffer, contentType?: string): string {
  let charset = ''
  const ct = contentType || ''
  // 兼容 charset="gb2312" / charset='gbk' 引号变体(原正则遇到引号即失配, 编码退化为 utf8 产生乱码)
  const m1 = ct.match(/charset\s*=\s*["']?([\w-]+)/i)
  if (m1) charset = m1[1]
  const head = Buffer.from(buf.slice(0, 2048))
  if (!charset) {
    const headStr = head.toString('latin1')
    const m2 = headStr.match(/<meta[^>]+charset=["']?([\w-]+)/i)
    if (m2) charset = m2[1]
    else if (headStr.includes('charset=gb')) charset = 'gbk'
  }
  charset = charset.toLowerCase()
  if (!charset || charset === 'utf-8' || charset === 'utf8') {
    try { return stripBom(new TextDecoder('utf-8', { fatal: false }).decode(buf)) } catch { return stripBom(Buffer.from(buf).toString('utf8')) }
  }
  // encodingExists 兜底: 非法/未知名编码(如 x-mac-cyrillic)退回 utf8, 不让 iconv 抛错
  if (iconv.encodingExists(charset)) {
    return stripBom(iconv.decode(Buffer.from(buf), charset))
  }
  return stripBom(Buffer.from(buf).toString('utf8'))
}

// ---------- JS 跳转挑战识别 ----------
/**
 * 判定"JS跳转挑战壳"页:
 *  - 内容 <1200 字 且 含 window.location / location.href / location.replace 等跳转脚本
 *  - 或含 http-equiv="refresh" 且内容很短(<1200)
 * 典型: 反爬中间页只输出一段脚本跳到真实地址 / 首次访问种 Cookie 后刷新
 */
export function isJsChallenge(html: string): boolean {
  if (!html) return false
  const s = html.trim()
  if (!s || s.length >= 1200) return false
  const hasRedirect = /window\.location\s*[.[]|location\.href\s*=|location\.replace\s*\(|location\.assign\s*\(/.test(s)
  const hasRefresh = /http-equiv\s*=\s*["']?refresh/i.test(s)
  return hasRedirect || hasRefresh
}

// ---------- 验证码/拦截特征 ----------
const BLOCK_MARKERS = [
  'captcha', 'verify', '验证码', '安全验证', '滑动验证', '人机验证',
  'access denied', 'forbidden', '请开启javascript', 'enable javascript',
  'just a moment', 'cf-browser-verification', 'checking your browser',
  'cf-chl', 'challenge-platform', 'cf_chl_', 'attention required',
]
/** 结构化挑战标记: 命中即判拦, 不适用"长页面+正常标题"豁免
 *  修复: 与 obscura.looksLikeChallenge 对齐(补 cf-turnstile/ddos-guard 及 CF 中文 Turnstile
 *  页特征)——原先 HTTP 引擎遇到 5165.org 那种中文盾页会漏判为正常内容直接入库 */
const STRONG_BLOCK_MARKERS = [
  'just a moment', 'cf-browser-verification', 'cf-chl', 'challenge-platform',
  'cf_chl_', 'checking your browser', 'attention required',
  'cf-turnstile', 'ddos-guard', 'challenge.js',
  '正在进行安全验证', '本网站使用安全服务',
  // 繁体变体(ixdzs 系"請稍等，正在進行安全驗證..."盾页)与"正在验证浏览器"标题站
  // ——原先只配简体, 繁体盾页被漏判为正常内容直接入库
  '正在進行安全驗證', '正在驗證瀏覽器', '正在验证浏览器', '安全驗證',
]

function hasNormalTitle(html: string): boolean {
  const m = html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i)
  if (!m) return false
  const t = m[1].trim().toLowerCase()
  if (t.length < 2) return false
  // 修复: 补 '请稍候/请稍後'(CF 中文盾页标题)——原先这类标题被当正常标题豁免, 盾页被当正文
  const bad = ['just a moment', 'attention required', 'access denied', 'forbidden', '请开启', '验证', '请稍候', '请稍後', '403', '404']
  return !bad.some((k) => t.includes(k))
}

export function looksBlocked(html: string): boolean {
  if (!html) return true
  // 用 isJsChallenge 区分: 极短 JS 跳转壳直接判拦
  if (isJsChallenge(html)) return true
  const lower = html.toLowerCase()
  // CF JS Detections 脚本(challenge-platform/scripts/jsd/main.js)是 Bot Management 下
  // 正常页面普遍内嵌的探测脚本, 不代表当前是挑战页 —— 页面有正常标题且足够长时豁免,
  // 否则真实内容页(101kks 实测)被永久拒收
  const jsdBenign = lower.includes('challenge-platform/scripts/jsd') && html.length >= 1200 && hasNormalTitle(html)
  // 强挑战特征(CF 等): 无论长短一律判拦
  if (!jsdBenign && STRONG_BLOCK_MARKERS.some((k) => lower.includes(k))) return true
  // 保留原规则: 极短内容视为被拦
  if (html.length < 200) return true
  // 含正常 <title> 且长度 >= 1200 的页面视为正常内容页,
  // 不因正文/导航提及"验证码/verify/enable javascript"等词误判
  if (html.length >= 1200 && hasNormalTitle(html)) return false
  return BLOCK_MARKERS.some((k) => lower.slice(0, 4000).includes(k))
}

// ---------- 浏览器渲染 (Playwright, 惰性加载) ----------
let browserAvailable: boolean | null = null
let browserCheckedAt = 0
let pwModule: any = null
/** 探测失败的重新检查间隔: 原先 false 永久缓存, chromium 后装好/瞬时故障后引擎永远不可用 */
const BROWSER_PROBE_RETRY_MS = 60_000

/** 每域 UA 钉扎: 同域连续请求保持同一 UA —— Cookie 罐是按域共享的, 若每个章节都换 UA,
 *  "同一会话 UA 跳变"本身就是一个典型爬虫特征; 整轮失败时清除钉扎, 下次调用换新身份 */
const globalForUa = globalThis as unknown as { __novelDomainUa_v2?: Map<string, string> }
const domainUa: Map<string, string> = globalForUa.__novelDomainUa_v2 || new Map()
globalForUa.__novelDomainUa_v2 = domainUa

function pickUaFor(domain: string, cfg: FetchConfig): string {
  if (cfg.uaMode === 'custom' && cfg.customUa) return cfg.customUa
  const pinned = domain ? domainUa.get(domain) : undefined
  if (pinned) {
    // ff-b uaMode=mobile/desktop: 钉扎 UA 与请求类别不符(模式在线切换)时重选,
    // 防止"desktop 模式拿到上一次 mobile 钉扎的 iPhone UA"自相矛盾
    if (cfg.uaMode !== 'mobile' && cfg.uaMode !== 'desktop') return pinned
    if (isMobileUa(pinned) === (cfg.uaMode === 'mobile')) return pinned
  }
  // ff-b: mobile/desktop 两档 = 池内移动/桌面子集随机(同域钉扎语义不变);
  // rotate/fixed 维持全池随机
  let ua: string
  if (cfg.uaMode === 'mobile' || cfg.uaMode === 'desktop') {
    const subset = UA_POOL.filter((u) => isMobileUa(u) === (cfg.uaMode === 'mobile'))
    ua = subset.length ? subset[Math.floor(Math.random() * subset.length)] : randomUa()
  } else {
    ua = randomUa()
  }
  if (domain) {
    if (domainUa.size > 200) domainUa.clear() // 防站群场景无限增长
    domainUa.set(domain, ua)
  }
  return ua
}

export async function checkBrowser(): Promise<boolean> {
  // 失败结果只缓存 60s: 防瞬时异常把裸 Playwright 降级路径永久判死; 成功结果仍永久缓存
  if (browserAvailable === true) return true
  if (browserAvailable === false && Date.now() - browserCheckedAt < BROWSER_PROBE_RETRY_MS) return false
  try {
    pwModule = await import('playwright')
    const { chromium } = pwModule
    await chromium.launch({ headless: true, args: ['--no-sandbox'] }).then((b: any) => b.close())
    browserAvailable = true
  } catch (e: any) {
    console.warn('[fetcher] playwright chromium unavailable:', e?.message?.slice(0, 120))
    browserAvailable = false
  }
  browserCheckedAt = Date.now()
  return browserAvailable
}

/**
 * 浏览器渲染入口: 优先 Obscura(--stealth 隐身模式: 指纹随机化 + 挑战自动等待 + Cookie 回传),
 * Obscura 不可用或渲染抛错时, 降级回裸 Playwright 直连(renderWithBrowserRaw)。
 * 出口代理(dd-a): 配置了代理且目标非回环时跳过 Obscura 直接走裸 Playwright 专用 launch
 * —— Obscura 单例页面池不支持代理(支持矩阵见代理池段注释), 而裸路径每次请求独立
 * launch, per-context proxy 无槽位复用串扰面。选路统一经 pickProxyFor 单一函数
 */
async function renderWithBrowser(url: string, cfg: FetchConfig, ua: string): Promise<string> {
  if (pickProxyFor(url, cfg)) return renderWithBrowserRaw(url, cfg, ua)
  try {
    if (await checkObscuraAvailable()) {
      const res = await obscuraFetch(url, {
        userAgent: ua,
        timeout: cfg.timeout,
        waitSelector: cfg.waitSelector,
        waitMs: cfg.waitMs,
        // 点击展开懒加载内容("点击展开全部目录"交互型站点)
        clickSelector: cfg.clickSelector,
        // 渲染稳定化: AJAX 站点在 waitMs 后仍可能继续注入内容(章节列表/段落组装),
        // 上限取 max(6s, waitMs), 稳定后提前退出
        settleMs: Math.max(6000, cfg.waitMs || 0),
      })
      // 浏览器引擎拿到的挑战凭证(cf_clearance 等)写回 CookieJar —— 打通 HTTP 引擎后续直连
      if (res.cookies.length) cookieJar.store(originHost(url), res.cookies)
      return res.html
    }
  } catch (e: any) {
    console.warn('[fetcher] Obscura 渲染失败, 降级裸 Playwright:', e?.message?.slice(0, 120))
  }
  return renderWithBrowserRaw(url, cfg, ua)
}

/** 裸 Playwright 直连渲染(降级路径, 原 renderWithBrowser 实现)
 *  出口代理(dd-a): 目标非回环且配置了代理时, launch 挂占位全局 proxy(chromium 逐
 *  context 覆盖的前提, Playwright 文档: 所有 context 覆盖后全局值永不使用, 可为任意串)
 *  + newContext 注入真实代理(per-context, 本浏览器实例仅本请求专用, 无共享串扰);
 *  无代理时保持原样 launch(零回归) */
async function renderWithBrowserRaw(url: string, cfg: FetchConfig, ua: string): Promise<string> {
  if (!pwModule) {
    const ok = await checkBrowser()
    if (!ok) throw new Error('浏览器渲染引擎不可用(未安装playwright/chromium), 请使用HTTP引擎')
  }
  const { chromium } = pwModule
  const proxy = pickProxyFor(url, cfg)
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    ...(proxy ? { proxy: { server: 'http://per-context-placeholder' } } : {}),
  })
  const timeoutMs = cfg.timeout && cfg.timeout > 0 ? cfg.timeout : 20000
  try {
    const ctx = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: buildHeaders(url, cfg, ua),
      ...(proxy ? { proxy: playwrightProxyParts(proxy) } : {}),
    })
    // 反自动化检测脚本
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })
    // hh-d2: 身份脚本(UA 参数化) —— UA/platform/vendor/maxTouchPoints/userAgentData/WebGL 按
    // UA 身份逐 frame 自洽(与 Obscura 隐身栈同一份实现, 降级路径不降指纹)
    await ctx.addInitScript(buildIdentityInitScript(ua))
    const page = await ctx.newPage()
    // hh-d2: CDP Network.setUserAgentOverride(+userAgentMetadata) 让网络层 sec-ch-ua* 头与
    // UA 字符串三方自洽(含移动分支); 与 Obscura 同一 helper, 失败容忍(JS 面仍有身份脚本)
    await applyUaCdpOverride(page, ua)
    if (cfg.waitSelector) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      try { await page.waitForSelector(cfg.waitSelector, { timeout: cfg.waitMs || 8000 }) } catch { /* 容忍 */ }
    } else {
      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      })
    }
    if (cfg.waitMs) await page.waitForTimeout(cfg.waitMs)
    // 点击展开懒加载内容(与 Obscura 路径对齐, 裸 Playwright 降级路径同样支持);
    // gg: 主 frame+跨域 iframe 全遍历(挑战复选框在跨域 iframe 内, dd-d 缺口补齐),
    // 找不到元素静默跳过语义不变
    if (cfg.clickSelector) {
      const clicked = await clickSelectorAnywhere(page, cfg.clickSelector)
      if (clicked) await page.waitForTimeout(1200)
    }
    let html: string
    try {
      html = await page.content()
    } catch {
      // 点击"展开"可能实为链接触发整页导航: content() 在导航提交期间会抛错,
      // 退避后重试一次拿导航后的真实内容, 仍失败才向上抛
      await page.waitForTimeout(1500)
      html = await page.content()
    }
    await ctx.close()
    return html
  } finally {
    await browser.close()
  }
}

/** 头组构造(HTTP 内容链专用; ff-b 增强①: opts.fingerprint=true 时注入完整浏览器指纹头组)
 *  - 指纹纪律: 仅 fetchHttp(逐跳)/fetchViaCurl 传入 fingerprint —— 裸 Playwright 链
 *    (renderWithBrowser)与 fetchBinary 刻意不传: 真浏览器自发自洽的原生 sec-ch-ua/Sec-Fetch-*,
 *    再注入同名头会产生重复/冲突(双值头反而可疑); 资源请求的 Sec-Fetch-Dest 语义也不同
 *  - refererChain(ff-b 增强②): cfg.refererChain && cfg.refererUrl 时 Referer 用运行时注入的
 *    来源页 URL(目录页→书籍页→章节页同链路), 未注入回退站点 origin(零回归)
 *  - 合并次序: 基础头 → 指纹头组 → cfg.headers(规则显式配置最优先, 可覆盖任意单项) */
function buildHeaders(url: string, cfg: FetchConfig, ua: string, opts?: { fingerprint?: boolean }): Record<string, string> {
  let origin = ''
  try { origin = new URL(url).origin } catch { /* ignore */ }
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
    'Cache-Control': 'no-cache',
  }
  const chainReferer = cfg.refererChain && cfg.refererUrl ? cfg.refererUrl : ''
  if (opts?.fingerprint) {
    // 指纹头组按【实际选中 UA】+【生效 Referer】推导(Sec-Fetch-Site 语义依赖后者);
    // 先于 cfg.headers 合并 —— 规则显式配置的头永远最优先
    Object.assign(headers, fingerprintHeadersFor(ua, chainReferer || origin, url))
  }
  Object.assign(headers, cfg.headers)
  if (chainReferer) headers.Referer = chainReferer
  else if (cfg.referer !== false && origin) headers.Referer = origin
  // Cookie 合并去重: 同名键以罐中值(服务端最新 Set-Cookie)为准, 避免拼出 "a=1; a=9" 重复 Cookie 头
  const merged = new Map<string, string>()
  for (const src of [cfg.cookies, cookieJar.get(originHost(url))]) {
    if (!src) continue
    for (const pair of src.split(';')) {
      const idx = pair.indexOf('=')
      if (idx > 0) merged.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
    }
  }
  if (merged.size) headers.Cookie = Array.from(merged.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
  return headers
}

function originHost(url: string): string {
  try { return new URL(url).origin } catch { return '' }
}

// ---------- 出口代理池 (dd-a: proxy rotation, 反反爬核心) ----------
/**
 * 面向 ybswo.com 这类"换出口IP才能过 CF 盾"的站点: FetchConfig.proxyUrl 配置
 * 逗号分隔多条代理, 多条时随机轮换。支持矩阵(本机 Bun 1.3.14 + node v24 实测,
 * 探针与 scripts/verify-dd-a-proxy.ts 记录, 如实不虚报):
 *  - bun 运行时 fetch(scripts/e2e/seed 等 bun 脚本): RequestInit.proxy 支持
 *    http/https(实测生效); socks5 不支持(实测抛 UnsupportedProxyProtocol)
 *    —— 同一请求即时失败并自然落 curl 链, socks5 代理在 http 链的实际生效路径为 curl
 *  - node 运行时 fetch(undici): 【重要】next dev/prod 实测以 node 运行(ps: node …/next dev),
 *    undici fetch 对 RequestInit.proxy 是【静默忽略】(请求伪装直连, 最危险虚报形态) ——
 *    故 node 运行时配置了代理的尝试直接走 curl 链(fetchViaCurl -x, 全形态实测可用),
 *    绝不让代理静默失效; curl 不可用时该次代理尝试如实失败交由轮换/降级接管
 *  - 裸 Playwright(renderWithBrowserRaw): per-context proxy 全形态(bun/node 皆然;
 *    chromium 逐 context 覆盖的前提是 launch 带占位全局 proxy, 见该函数注释)
 *  - Obscura stealth 路径: 不支持代理 —— 单例浏览器页面池按域复用槽位, 若为
 *    per-context proxy 给 launch 挂占位全局 proxy, 无代理 context 会继承占位值
 *    导致直连全断(实测 ERR_PROXY_CONNECTION_FAILED); 故配置了代理的请求跳过
 *    Obscura 直接走裸 Playwright 专用 launch(renderWithBrowser 内分流)
 */
const MAX_PROXY_POOL = 10

/** 当前运行时 fetch 是否原生支持 RequestInit.proxy:
 *  bun 支持(http/https); node/undici 静默忽略(不得伪装直连) */
const PROXY_FETCH_SUPPORTED = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

/** 代理条目形态校验: scheme 白名单(http/https/socks5(h)/socks4(a)) + 无空白/逗号的
 *  host[:port] 形态(凭证以 http://u:p@host:port 内联), 单条 ≤500 字符。
 *  与 types.ts sanitizeFetchConfig 内联校验同口径(两处保持一致, 改动需同步) */
export function isValidProxySpec(s: string): boolean {
  return s.length <= 500 && /^(https?|socks5h?|socks4a?):\/\/[^\s,]+$/.test(s)
}

/** 代理池解析: 逗号分隔多条, 去空/去重/逐条校验, 上限 MAX_PROXY_POOL */
export function parseProxyPool(proxyUrl: string | undefined | null): string[] {
  if (!proxyUrl) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of proxyUrl.split(',')) {
    const s = raw.trim()
    if (!s || seen.has(s) || !isValidProxySpec(s) || out.length >= MAX_PROXY_POOL) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** 回环豁免: 目标 host 为 localhost/*.localhost/127.0.0.0/8/::1/0.0.0.0 时跳过代理直连
 *  —— 否则本地 mock 服务/token 代理 tokenUrl(如 bqg713-proxy 127.0.0.1:3010)会被代理
 *  转发出不去。hostname 对 IPv6 含方括号需剥离 */
export function isLoopbackTarget(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  } catch {
    return false
  }
}

/**
 * 代理选路(三链路单一收敛点, 返回本次请求使用的代理, ''=直连):
 * - 未配置 / 目标回环 → 直连
 * - 配置多条 → 均匀随机轮换(与 UA 池同款 random 模式, 分布可测试验证)
 * fetchHttp(bun fetch)/fetchViaCurl(curl)/renderWithBrowserRaw(per-context)一律经
 * 本函数取代理, 避免三处重复实现漂移
 */
export function pickProxyFor(url: string, cfg: FetchConfig): string {
  const pool = parseProxyPool(cfg.proxyUrl)
  if (!pool.length || isLoopbackTarget(url)) return ''
  return pool[Math.floor(Math.random() * pool.length)]
}

/** 日志用代理脱敏: 隐藏内联凭证(u:p@ → ***@) */
function redactProxy(proxy: string): string {
  return proxy.replace(/^(https?|socks5h?|socks4a?):\/\/[^@/]+@/i, '$1://***@')
}

/** Playwright per-context proxy 参数: 内联凭证拆出 username/password
 *  (Playwright 不接受 server 内嵌凭证), 无凭证原样返回 */
function playwrightProxyParts(proxy: string): { server: string; username?: string; password?: string } {
  try {
    const u = new URL(proxy)
    if (u.username || u.password) {
      const out: { server: string; username?: string; password?: string } = {
        server: `${u.protocol}//${u.host}`,
      }
      const un = decodeURIComponent(u.username)
      const pw = decodeURIComponent(u.password)
      if (un) out.username = un
      if (pw) out.password = pw
      return out
    }
  } catch { /* 已过 isValidProxySpec, 理论不达 */ }
  return { server: proxy }
}

// ---------- HTTP 引擎 ----------
/** 单链最大跳数: 与 undici/浏览器 redirect:follow 默认上限(20)对齐,
 * 超限抛错防重定向环; 逐跳 Set-Cookie 收集依赖自循环, 上限是防环保险丝 */
const MAX_REDIRECT_HOPS = 20

// ---------- Retry-After 头抢救 (ab-b: 429 限流冷却精确感知) ----------
/**
 * 场景(zz-b 遗留收编): 真 429 在 HTTP 引擎以抛错形态抵达 runner.gateFetch, 但抛错对象
 * 原先只保留 status/bodyHtml, Retry-After 头在抛错瞬间丢失 → 限流冷却一律走 30s 兜底。
 * 现把解析出的毫秒值挂到抛错对象新字段 retryAfterMs(既有 status/bodyHtml 行为零变化),
 * runner 抛错路径透传给 reportHostRateLimited —— 服务端给多少歇多久(上限/噪声底由
 * hostgate 侧钳制), 不再盲目硬等 30s。
 * 解析语义(RFC 7231 Retry-After 两种形态):
 *  - 整数秒: '2' → 2000('0' 如实返回 0, <1s 噪声底由 hostgate 兜底 30s);
 *  - HTTP 日期: Date.parse 兜底, 取"距现时刻"毫秒(已过期返回 0);
 *  - 缺失/空/垃圾 → undefined(调用方不挂字段, 上层走 30s 兜底)。
 * 导出供验证脚本直接单测解析语义(verify-ab-b-ratelimit)
 */
export function parseRetryAfterHeaderMs(raw: string | null | undefined): number | undefined {
  const s = (raw ?? '').trim()
  if (!s) return undefined
  if (/^\d+$/.test(s)) {
    const sec = parseInt(s, 10)
    return Number.isSafeInteger(sec) ? sec * 1000 : undefined
  }
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return undefined
  return Math.max(0, t - Date.now())
}

/** 把 Retry-After 毫秒值挂到 HTTP 抛错对象(ab-b): 头缺失/解析失败时不挂字段
 *  (err.retryAfterMs 保持 undefined), 既有 err.status/err.bodyHtml 行为完全不变。
 *  res.headers 兼容 native fetch 与 gg 中继重组形态(均为 Headers 实例) */
function attachRetryAfterMs(err: any, headers: { get(name: string): string | null }): void {
  const ms = parseRetryAfterHeaderMs(headers?.get ? headers.get('retry-after') : null)
  if (ms !== undefined) err.retryAfterMs = ms
}

async function fetchHttp(url: string, cfg: FetchConfig, ua: string, proxy = '', transport: 'native' | 'relay' = 'native'): Promise<string> {
  // 超时防御: 规则配置里 timeout 可能是 0/null/负数, setTimeout(fn, 0) 会立即中止请求
  const timeoutMs = cfg.timeout && cfg.timeout > 0 ? cfg.timeout : 20000
  const controller = new AbortController()
  // ee-d: 本计时器是“超时型 AbortError”的唯一来源(stop 不中止在途——abortControllers 声明后从未使用),
  // 打标后 runner/gateFetch 可区分“源站超时”与“停止/换代在途中止”, 前者计失败嗂 hostGate, 后者才享 x-a 豁免
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  // 出口代理(dd-a): ''=直连; bun fetch 原生 RequestInit.proxy 仅支持 http/https,
  // socks5 条目在此链即时失败(UnsupportedProxyProtocol)后由 fetchHttpWithCurlFallback
  // 同代理重试 curl 链(-x 全形态), 支持矩阵见代理池段注释
  try {
    // redirect:'manual' 自循环逐跳收集(y-a增强重放, 补 x-a 遗留②): 原先 redirect:'follow'
    // 只能拿到【最终响应】的 Set-Cookie —— 多跳重定向中, 经 301/302 中间跳种会话 Cookie
    // 的站(首访种 Cookie 再跳真实页)中间跳 Cookie 全部丢失, 同站 http→https 升级链路
    // https 侧永远拿不到会话 Cookie(x-a 修复只解决了"归属域", 没解决"只收最终一跳")。
    // 改为逐跳: 每跳 Set-Cookie 归属到【该跳实际 URL】的域键(与 curl 路径按轮归属同语义),
    // 后续跳经 buildHeaders 带上前面跳种下的 Cookie —— 等价于真实浏览器跟随重定向的
    // Cookie 行为。相对 Location 解析; 20 跳上限; 跨 scheme 降级(https→http)拒绝,
    // http→https 升级放行(国内站 301 升级 https 常态, 不能因安全策略拒采)。
    // 注: Bun fetch redirect:'manual' 实测(1.3.14)返回真实 3xx 响应, 状态行/Location/
    // getSetCookie 全可读, 无 opaque-redirect 屏蔽(见 scripts/archive/probe-bun-manual-redirect.ts)
    let hopUrl = url
    for (let hop = 0; ; hop++) {
      if (hop > MAX_REDIRECT_HOPS) {
        throw new Error(`HTTP 重定向超过 ${MAX_REDIRECT_HOPS} 跳上限(疑似重定向环)`)
      }
      // ff-b①: HTTP 内容链逐跳注入完整指纹头组(与 UA 自洽的 sec-ch-ua*/Sec-Fetch-*)
      const headers = buildHeaders(hopUrl, cfg, ua, { fingerprint: true })
      // 出口代理逐跳同代理(会话连贯性/出口固定); 交叉类型携带非标准 proxy 字段
      // (Bun 运行时扩展生效, 不依赖 bun-types 全局声明)
      const init: RequestInit & { proxy?: string } = { headers, redirect: 'manual', signal: controller.signal }
      if (proxy) init.proxy = proxy
      // gg 中继桥: transport='relay' 时逐跳经 bun 中继服务发起(响应重组为 Response 形态,
      // status/location/getSetCookie/arrayBuffer 全保持 —— 逐跳重定向/Cookie 收集/超时/
      // 指纹头组语义全部复用本循环, 与 native 传输唯一差异在底层传输介质)
      const res = transport === 'relay' && proxy
        ? await relayHop(hopUrl, headers, proxy, controller.signal, timeoutMs)
        : await fetch(hopUrl, init)
      if (cfg.autoCookie !== false) {
        const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
        // 每跳 Cookie 记到该跳 URL 的 origin 名下: 跨域重定向不串味, 同站跳转按域聚合
        cookieJar.store(originHost(hopUrl), setCookies)
      }
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        // rr-c3 卫生: manual 重定向链上 3xx 响应体从不读取, 显式 cancel 立即释放连接
        // (不消费的 body 由 GC 延迟回收, 重定向密集站滞后占用连接池; 可选链短路安全,
        //  relay 重组形态无 body 字段时为 no-op; catch 兜底防空 rejection)
        try { void res.body?.cancel().catch(() => {}) } catch { /* ignore */ }
        let next: URL
        try {
          next = new URL(location, hopUrl) // 相对 Location(./x、/x、//host)按当前跳解析
        } catch {
          // 非法 Location: 视作最终响应走 !res.ok 抛错语义(带 status+bodyHtml)
          // ee-d: 错误体同样走 charset 感知解码(GBK 站挑战壳若按 utf8 读成 FFFD, looksBlocked/isJsChallenge 全部漏判)
          const bodyHtml = await res.arrayBuffer().then((b) => decodeBuffer(b, res.headers.get('content-type') ?? undefined)).catch(() => '')
          const err: any = new Error(`HTTP ${res.status}(Location 非法)`)
          err.status = res.status
          err.bodyHtml = bodyHtml
          attachRetryAfterMs(err, res.headers) // ab-b: 有 res 在手, 错误形态统一抢救 Retry-After
          throw err
        }
        if (next.protocol !== new URL(hopUrl).protocol) {
          // 跨 scheme: 仅放行 http→https 升级; 降级(https→http)与其余一律拒绝,
          // 防止降级明文跳转把会话 Cookie 带到不安全上下文
          const upgrade = new URL(hopUrl).protocol === 'http:' && next.protocol === 'https:'
          if (!upgrade) {
            const err: any = new Error(`HTTP ${res.status} 重定向跨 scheme 被拒绝(${new URL(hopUrl).protocol}→${next.protocol})`)
            err.status = res.status
            attachRetryAfterMs(err, res.headers) // ab-b: 同上(3xx 错误形态, 头在才挂)
            throw err
          }
        }
        hopUrl = next.toString()
        continue
      }
      if (!res.ok) {
        // 读出错误响应体供挑战识别(isJsChallenge/CF壳), 挂在 error.bodyHtml 上
        // ee-d: 与成功路径同走 decodeBuffer(charset 三级探测), 否则 GBK 站 403 壳页乱码化后挑战识别失效
        const bodyHtml = await res.arrayBuffer().then((b) => decodeBuffer(b, res.headers.get('content-type') ?? undefined)).catch(() => '')
        const err: any = new Error(`HTTP ${res.status}`)
        err.status = res.status
        err.bodyHtml = bodyHtml
        // ab-b(429 主通道): 真 429 以抛错形态抵达 runner.gateFetch —— 此处是 Retry-After
        // 头唯一能被抢救的位置(zz-b 遗留: 原先头信息在此丢失, 限流冷却一律 30s 兜底)
        attachRetryAfterMs(err, res.headers)
        throw err
      }
      const buf = await res.arrayBuffer()
      return decodeBuffer(buf, res.headers.get("content-type") ?? undefined)
    }
  } catch (e: any) {
    // ee-d: fetch 超时(本计时器 abort)打标 isFetchTimeout —— 上层据此分类为源站超时
    // (计 errors+写日志+嗂 hostGate 连败), 不再被 x-a 停止豁免分支静默吞掉
    if ((e?.name === 'AbortError' || e?.code === 'ABORT_ERR') && timedOut) e.isFetchTimeout = true
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ---------- curl 子进程传输(反 TLS 指纹封锁) ----------
/**
 * 场景: 部分站点的 WAF/CDN(uukanshu.cc 实测)按 TLS 指纹(JA3)封锁常见 HTTP 客户端 ——
 * Bun/Node fetch(BoringSSL 栈)必被 403, 而系统 curl(OpenSSL 栈)可直连。
 * 故在 HTTP 引擎内提供第二级传输: curl 子进程。
 * - argv 数组式 spawn(不经 shell, 无注入面), 仅支持 http/https
 * - 复用 CookieJar(autoCookie)与 buildHeaders(UA轮换/Referer)
 * - 响应头落临时文件(-D), body 走 stdout(二进制安全), 10MB 上限防内存炸
 */
let curlAvailable: boolean | null = null
let curlCheckedAt = 0
const CURL_PROBE_RETRY_MS = 60_000

/** Buffer(视图) -> 独立 ArrayBuffer(拷贝, 防共享池越界) */
function toArrayBufferView(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

async function checkCurl(): Promise<boolean> {
  if (curlAvailable === true) return true
  if (curlAvailable === false && Date.now() - curlCheckedAt < CURL_PROBE_RETRY_MS) return false
  try {
    const { spawn } = await import('node:child_process')
    curlAvailable = await new Promise<boolean>((resolve) => {
      const child = spawn('curl', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
      const t = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        resolve(false)
      }, 5000)
      child.on('error', () => { clearTimeout(t); resolve(false) })
      child.on('close', (code) => { clearTimeout(t); resolve(code === 0) })
    })
  } catch {
    curlAvailable = false
  }
  curlCheckedAt = Date.now()
  return curlAvailable
}

/** curl 子进程传输(内部实现, 导出仅供诊断/冒烟脚本直接复用)
 *  proxy(dd-a): 非空时以 -x 透传(http/https/socks5(h)/socks4(a) 全形态, 内联凭证
 *  http://u:p@host:port 原生支持; 值清洗控制字符防 curl 参数注入) */
export async function fetchViaCurl(url: string, cfg: FetchConfig, ua: string, proxy = ''): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('curl 传输仅支持 http/https URL')
  if (!(await checkCurl())) throw new Error('curl 子进程不可用')
  // ff-b①: curl 子进程同为 HTTP 内容链, 指纹头组与 bun fetch 链同口径(双传输一致指纹, 防降级后头组消失露馅)
  const headers = buildHeaders(url, cfg, ua, { fingerprint: true })
  const timeoutMs = cfg.timeout && cfg.timeout > 0 ? cfg.timeout : 20000
  const [{ tmpdir }, { join }, { randomUUID }] = await Promise.all([
    import('node:os'), import('node:path'), import('node:crypto'),
  ])
  const headerFile = join(tmpdir(), `novel-curl-${randomUUID()}.hdr`)
  const args: string[] = [
    '-sS', '-L', '--max-redirs', '5', '--compressed',
    '--max-time', String(Math.max(2, Math.ceil(timeoutMs / 1000))),
    '-D', headerFile, '-o', '-',
  ]
  for (const [k, v] of Object.entries(headers)) {
    // 控制字符清洗: 防 header 值/键换行注入额外 curl 指令(argv 传输仍单参数, 但 curl 自身按行解析);
    // 键同样要洗(键来自 cfg.headers 用户配置), 且去冒号防 curl 把键值对解析错位
    const key = String(k).replace(/[\r\n\0:]+/g, '').trim()
    const clean = String(v).replace(/[\r\n\0]+/g, ' ').trim()
    if (key && clean) args.push('-H', `${key}: ${clean}`)
  }
  if (proxy) {
    // 出口代理: -x 全形态; 控制字符清洗与头注入同口径(curl 按行解析参数值)
    args.push('-x', proxy.replace(/[\r\n\0]+/g, ''))
  }
  args.push('--', url)
  const { spawn } = await import('node:child_process')
  const { readFile, unlink } = await import('node:fs/promises')

  return await new Promise<string>((resolve, reject) => {
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let total = 0
    const MAX_HTML_BYTES = 10 * 1024 * 1024
    let stderr = ''
    let settled = false
    // 溢出标记: 原实现超限 SIGKILL 后 close 处理器仍会把已收到的部分 body 当成功内容 resolve,
    // 截断 HTML 会被上层解析成半截正文/目录入库 —— 必须改为 reject
    let overflow = false
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    }, timeoutMs + 5000)
    child.stdout.on('data', (c: Buffer) => {
      if (overflow) return
      total += c.length
      if (total > MAX_HTML_BYTES) {
        overflow = true
        chunks.length = 0 // 立即释放已收数据, 不留大块缓冲到 close
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        return
      }
      chunks.push(c)
    })
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 600) stderr += c.toString()
    })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      // 修复: error 路径(spawn 后期失败/进程无法被 kill)原先不删临时头文件, 造成 tmp 泄漏
      try { void unlink(headerFile).catch(() => {}) } catch { /* ignore */ }
      reject(e)
    })
    child.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      ;(async () => {
        let headerRaw = ''
        try {
          headerRaw = await readFile(headerFile, 'utf8')
        } catch { /* 无头文件: curl 提前失败 */ }
        try { await unlink(headerFile) } catch { /* ignore */ }
        const body = Buffer.concat(chunks)
        // 修复: 10MB 上限溢出后(SIGKILL)原先仍会走到 resolve 返回截断内容
        if (overflow) {
          reject(new Error(`curl 响应体超过 ${Math.round(MAX_HTML_BYTES / 1024 / 1024)}MB 上限, 已中止`))
          return
        }
        if (!headerRaw) {
          reject(new Error(`curl 无响应${stderr ? `: ${stderr.slice(0, 160)}` : ''}`))
          return
        }
        // 头文件可能含多轮重定向响应: 按状态行切分逐轮解析 ——
        // 1) 最终状态码/Content-Type 取最后一轮; 2) 每轮 Set-Cookie 归属到该轮实际 URL 的域
        // (经 Location 链逐轮解析)。原先所有轮次的 Cookie 全记在初始 URL 域键下,
        // 跨域/http→https 重定向时会把 B 域 Cookie 发给 A 域(串味+跨站泄漏)
        // ab-b: retryAfter 随轮解析(最终响应轮的 Retry-After 头, 供 429 抛错对象抢救, 同 fetchHttp 口径)
        type CurlRound = { status: number; location: string; contentType: string; setCookies: string[]; retryAfter: string }
        const rounds: CurlRound[] = []
        let cur: CurlRound | null = null
        for (const line of headerRaw.split(/\r?\n/)) {
          const sm = line.match(/^HTTP\/[\d.]+\s+(\d{3})/i)
          if (sm) { cur = { status: parseInt(sm[1], 10), location: '', contentType: '', setCookies: [], retryAfter: '' }; rounds.push(cur); continue }
          if (!cur) continue
          const idx = line.indexOf(':')
          if (idx <= 0) continue
          const key = line.slice(0, idx).trim().toLowerCase()
          const val = line.slice(idx + 1).trim()
          if (key === 'content-type') cur.contentType = val
          else if (key === 'set-cookie') cur.setCookies.push(val)
          else if (key === 'location') cur.location = val
          else if (key === 'retry-after') cur.retryAfter = val // ab-b
        }
        let roundUrl = url
        let status = 0
        let contentType = ''
        let retryAfter = '' // ab-b: 最终响应轮的 Retry-After 原始值
        for (const r of rounds) {
          if (cfg.autoCookie !== false && r.setCookies.length) {
            cookieJar.store(originHost(roundUrl), r.setCookies)
          }
          status = r.status
          contentType = r.contentType
          retryAfter = r.retryAfter
          if (r.status >= 300 && r.status < 400 && r.location) {
            try { roundUrl = new URL(r.location, roundUrl).toString() } catch { /* 非法 Location: 域键保持不变 */ }
          }
        }
        if (status >= 400) {
          const err: any = new Error(`HTTP ${status}(curl)`)
          err.status = status
          err.bodyHtml = decodeBuffer(toArrayBufferView(body), contentType)
          // ab-b: curl 错误形态同样抢救 Retry-After(缺省/非法不挂字段 → 上层 30s 兜底)
          const ram = parseRetryAfterHeaderMs(retryAfter)
          if (ram !== undefined) err.retryAfterMs = ram
          reject(err)
          return
        }
        if (!body.length) {
          reject(new Error(`curl 响应体为空${stderr ? `: ${stderr.slice(0, 160)}` : ''}`))
          return
        }
        resolve(decodeBuffer(toArrayBufferView(body), contentType))
      })().catch(reject)
    })
  })
}

// ---------- bun 中继桥 (gg: node 运行时+代理的 TLS 指纹出路) ----------
/**
 * 场景(gg-b wanben 实录): node 运行时(next dev)下 RequestInit.proxy 被全局 fetch(undici)
 * 静默忽略, 引擎因此直入 curl 链(fetchHttpWithCurlSingle node+proxy 分支), 而 curl 的
 * OpenSSL TLS 指纹被部分 WAF 按 JA3 拦截(同一代理同一 URL: bun 直抓 200 / 引擎 curl 链
 * 403 交替实录), 代理链在 dev 服务里全灭。
 * 中继桥: 独立 bun mini-service(127.0.0.1:3011, Bun 运行时 RequestInit.proxy 原生支持)
 * 代为发起请求, 引擎侧把响应重组为 Response 形态嵌入 fetchHttp 逐跳循环 → node+代理
 * 场景获得 bun 级 TLS 指纹, 逐跳重定向/Cookie/超时/指纹头组语义零改动。
 * 可用性: /health 探测结果缓存 RELAY_PROBE_RETRY_MS; 中继不在/中继层失败 → 原 curl 链
 * 兜底(零回归); 目标侧响应(含 403/5xx)如实上抛不双发。
 * socks5 形态: bun RequestInit.proxy 不支持 → 中继报 relayError → 落 curl(-x 全形态),
 * 与 native 链"socks5 即时失败后 curl 重试"同契约。
 */
/** 中继层错误(区别于目标侧 HTTP 错误): 仅此类错误触发 curl 兜底, 防失败请求双发 */
class RelayTransportError extends Error {
  constructor(message: string) { super(message); this.name = 'RelayTransportError' }
}

const RELAY_URL = process.env.FETCH_RELAY_URL || 'http://127.0.0.1:3011'
const RELAY_PROBE_RETRY_MS = 60_000
let relayAvailable: boolean | null = null
let relayCheckedAt = 0

/** 中继可用性探测(/health), 结果按 RELAY_PROBE_RETRY_MS 缓存; 失败短超时快返 */
async function checkRelay(): Promise<boolean> {
  if (relayAvailable === true) return true
  if (relayAvailable === false && Date.now() - relayCheckedAt < RELAY_PROBE_RETRY_MS) return false
  try {
    const res = await fetch(`${RELAY_URL}/health`, { signal: AbortSignal.timeout(1500) })
    relayAvailable = res.ok
  } catch {
    relayAvailable = false
  }
  relayCheckedAt = Date.now()
  return relayAvailable
}

/** 中继响应重组形态: fetchHttp 逐跳循环消费的最小 Response 面。
 *  body 为可选(rr-c3 卫生: native Response 携带真实流, 中继重组形态无 body 字段 ——
 *  3xx/!ok 分支的 res.body?.cancel() 对中继形态为 no-op, 可选链短路安全) */
interface RelayResponseLike {
  status: number
  ok: boolean
  headers: Headers
  arrayBuffer(): Promise<ArrayBuffer>
  readonly body?: { cancel(): Promise<void> } | null
}

/** 单跳经中继发起: 返回所有目标侧响应(含 3xx/4xx/5xx, 忠实转发不拦截);
 *  仅中继服务自身不可达/内部错误/代理协议不支持时抛 RelayTransportError。
 *  clientSignal 透传 fetchHttp 的超时控制器(AbortError 原样上抛, 超时分类语义不变);
 *  中继侧超时给 clientTimeoutMs+3000 冗余(客户端先超时, 口径一致) */
async function relayHop(url: string, headers: Headers | Record<string, string>, proxy: string, clientSignal: AbortSignal, clientTimeoutMs: number): Promise<RelayResponseLike> {
  // buildHeaders 返回普通对象, 引擎逐跳处也可能是 Headers 实例 —— 两种形态都收
  const headerObj: Record<string, string> = {}
  if (headers && typeof (headers as Headers).forEach === 'function') {
    ;(headers as Headers).forEach((v, k) => { headerObj[k] = v })
  } else {
    for (const [k, v] of Object.entries(headers as Record<string, string>)) headerObj[k] = v
  }
  let res: Response
  try {
    res = await fetch(`${RELAY_URL}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, headers: headerObj, proxy, timeoutMs: clientTimeoutMs + 3000 }),
      signal: clientSignal,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') throw e
    throw new RelayTransportError(`中继不可达(${RELAY_URL}): ${String(e?.message || e).slice(0, 120)}`)
  }
  let payload: { status?: number; headers?: [string, string][]; setCookie?: string[]; bodyB64?: string; relayError?: string }
  try {
    payload = await res.json()
  } catch (e: any) {
    throw new RelayTransportError(`中继响应非 JSON(HTTP ${res.status}): ${String(e?.message || e).slice(0, 100)}`)
  }
  if (payload.relayError || typeof payload.status !== 'number' || typeof payload.bodyB64 !== 'string') {
    throw new RelayTransportError(`中继层失败: ${String(payload.relayError || '响应形态非法').slice(0, 160)}`)
  }
  const h = new Headers()
  for (const [k, v] of payload.headers || []) {
    if (k.toLowerCase() === 'set-cookie') continue // set-cookie 走专用通道保留多条
    try { h.append(k, v) } catch { /* 非法头键跳过(与引擎头键白名单同向) */ }
  }
  for (const c of payload.setCookie || []) {
    try { h.append('set-cookie', c) } catch { /* ignore */ }
  }
  const buf = Buffer.from(payload.bodyB64, 'base64')
  return {
    status: payload.status,
    ok: payload.status >= 200 && payload.status < 300,
    headers: h,
    arrayBuffer: async () => toArrayBufferView(buf),
  }
}

// ---------- scrapling 桥 (hh-c: 第三方抓取工具接入) ----------
/**
 * 场景: 引擎接入第三方抓取工具 Scrapling(Python 自适应抓取框架)。桥服务
 * mini-services/scrapling-bridge(127.0.0.1:3012, 与 bqg713-proxy:3010/fetch-relay:3011
 * 同 mini-service 范式)内以 Scrapling 三类 Fetcher 代发请求:
 *   - static:     curl_cffi TLS 指纹伪装(chrome impersonate)——与 curl 链的差异在
 *                 curl_cffi 会完整模拟浏览器 TLS 握手与头组, 对 JA3 指纹封锁是第三条出路
 *   - stealthy:   patchright 反检测浏览器 + solve_cloudflare(CF Turnstile/Interstitial
 *                 挑战自动求解)——Obscura 之外的第二个隐身浏览器面
 *   - playwright: 裸 Playwright chromium JS 渲染(与引擎裸 Playwright 链同源, 独立浏览器栈)
 * 分流点: fetchPageOnce 顶层(镜像组循环之内, 逐镜像 host 各走一次桥)——scrapling-* 模式
 * 把整次抓取交桥代发, 目标侧响应(含 4xx/5xx)如实透传不再双发; native 专有步骤
 * (token 预取/autoCookie/Cookie 挑战重试/清罐自愈/指数退避/浏览器升级链)跳过——
 * 隐身与反爬能力由桥内 Scrapling Fetcher 自身承担(可接受语义, 存档 worklog hh-c)。
 * 失败语义(照 fetch-relay 先例, 仅传输层错误降级): 桥进程不可达/桥内异常(ok:false)/
 * 响应形态非法 → 返回 null → 落入既有 native HTTP 链一次(warn 日志); 代理语义: 桥调用
 * 本身恒为回环直连(不注入代理), 规则配了 proxyUrl 且目标非回环时把代理经 body.proxy
 * 交桥内 Fetcher 走代理(pickProxyFor 复用 isLoopbackTarget 回环豁免)。
 * fetchMode 非法值: sanitize 白名单已拦截, scraplingModeOf 再兜底(运行时对象直改防线)
 * —— 两道防线后仍非 scrapling-* 一律 native 链, 缺省(未配置)零行为变化。
 */
const SCRAPLING_BRIDGE_URL = process.env.SCRAPLING_BRIDGE_URL || 'http://127.0.0.1:3012'
const SCRAPLING_MODES = ['static', 'stealthy', 'playwright'] as const
type ScraplingMode = (typeof SCRAPLING_MODES)[number]

/** fetchMode → 桥模式判定: 'scrapling-static|stealthy|playwright' → 对应模式;
 *  'native'/未配置/非法值 → null(native 链)。导出供测试脚本复用 */
export function scraplingModeOf(fetchMode: string | undefined | null): ScraplingMode | null {
  if (!fetchMode || !fetchMode.startsWith('scrapling-')) return null
  const mode = fetchMode.slice('scrapling-'.length)
  return (SCRAPLING_MODES as readonly string[]).includes(mode) ? (mode as ScraplingMode) : null
}

/**
 * mm-b 反反爬增强: 浏览器类桥模式的 hostGateLimit 自动钳制。
 * 桥服务对 stealthy/playwright 有全局 BoundedSemaphore(3)(server.py BROWSER_SEM,
 * 独立 launch 浏览器内存开销大): 引擎侧 hostGateLimit>3 时, 超出部分的请求并不能
 * 提升采集吞吐, 只会在桥内信号量排队 —— 而"在桥内排队"有两个真实代价:
 *  ① 白占 hostGate 槽位(同 host 的其他工作/并行任务被 starving);
 *  ② 引擎客户端护栏(AbortSignal timeout)在排队期间到点后, 请求被放弃但桥内浏览器
 *     会话继续跑完(孤儿工作), mm 重试还会再叠一次。
 * 故 gateFetch 准入时把 per-host limit 钳到 min(配置, SCRAPLING_BROWSER_CONCURRENCY):
 *  - stealthy/playwright → 钳制; 超出部分的请求改走 HostGate 等待(30s 上限),
 *    超时即 HostGateTimeout —— 系统既有设计面(bb-d: warn/不计失败/章节保持未采集,
 *    增量重试恢复), 不产生孤儿浏览器工作;
 *  - static(curl_cffi, 桥内无信号量)/native/未配置 → 原值透传(零回归);
 *  - 未配置 hostGateLimit(undefined)→ 原样(引擎缺省 3 恰等于钳制线, 无需干预)。
 * 行为注记: 大 timeout 的 stealthy 配置(桥内排队可在护栏内等到槽位)原先可能"晚到
 * 成功", 钳制后改为 30s HostGateTimeout + 增量重试 —— 与 hostGate 对超并发的一贯
 * 语义对齐; pili 生产配置(limit=2)不受影响。
 * 跨 host 共享: 桥信号量是进程级全局 3, 多 host 并行任务叠加时仍可能在桥内短暂排队
 * (per-host 闸无法表达全局上限), 该残余排队有界且无害, 不在本钳制职责内。
 */
export const SCRAPLING_BROWSER_CONCURRENCY = 3

export function effectiveHostGateLimit(cfg: Pick<FetchConfig, 'fetchMode' | 'hostGateLimit'>): number | undefined {
  const mode = scraplingModeOf(cfg.fetchMode)
  if (mode !== 'stealthy' && mode !== 'playwright') return cfg.hostGateLimit
  const limit = cfg.hostGateLimit
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return limit
  return Math.min(limit, SCRAPLING_BROWSER_CONCURRENCY)
}

interface ScraplingBridgeResult {
  status: number
  html: string
  finalUrl: string
}

/** 经 scrapling 桥抓取一次: 成功返回 {status,html,finalUrl}; 桥不可达/桥内失败返回 null
 *  (调用方降级 native 链, warn 已在此打)。目标侧响应(含 4xx/5xx)在 ok:true 信封内如实
 *  透传 —— 与中继桥契约同向: 仅传输层失败触发降级, 目标请求不双发 */
async function fetchViaScraplingBridge(url: string, cfg: FetchConfig, mode: ScraplingMode): Promise<ScraplingBridgeResult | null> {
  const bridge = (cfg.scraplingBridgeUrl || '').trim() || SCRAPLING_BRIDGE_URL
  // 目标侧代理: 规则配了 proxyUrl 且目标非回环 → 随机选一条交桥(桥内 Fetcher 走代理);
  // 桥调用本身是回环直连(node fetch 不带 proxy 选项, 与 isLoopbackTarget 豁免语义一致)
  const proxy = pickProxyFor(url, cfg)
  // 显式头组透传: 规则 headers 最优先 + cookies 收敛为 Cookie 头(桥内 static 模式可覆盖
  // 其 stealthy_headers 生成的同名头; stealthy/playwright 经 extra_headers 透传);
  // native 专有的指纹头组/token 预取头不在此组装(桥内 Fetcher 自生成自洽头组)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(cfg.headers || {})) headers[k] = v
  if (cfg.cookies && !headers.Cookie) headers.Cookie = cfg.cookies
  // Referer 与 native buildHeaders 同语义(ii-c 修前补齐: refererChain/refererUrl 运行时注入
  // 的来源页在 scrapling 模式曾被静默丢失 —— 规则组合 fetchMode=scrapling-* × refererChain
  // 时目录页→书籍页→章节页 Referer 链断裂): 优先级镜像 buildHeaders = 链 Referer(refererUrl)
  // > origin 回退(cfg.referer !== false) > 规则显式 cfg.headers.Referer(与 native 一致被回退覆盖)
  {
    const chainReferer = cfg.refererChain && cfg.refererUrl ? cfg.refererUrl : ''
    let origin = ''
    try { origin = new URL(url).origin } catch { /* ignore */ }
    if (chainReferer) headers.Referer = chainReferer
    else if (cfg.referer !== false && origin) headers.Referer = origin
  }
  const timeoutMs = cfg.timeout && cfg.timeout > 0 ? cfg.timeout : 20000
  // mm 轮韧性增强: 桥内浏览器实例逐请求独立, 瞬态崩溃(TargetClosedError/Page crashed,
  // 多 chromium 并存内存挤压场景)或桥重启窗口, 一次即降级 native —— 对 CF 挑战站 native
  // 必然 403, 整条采集链当场断裂(生产实锤: pili 任务首页 crash→全任务 0 书)。此处仅对
  // "桥内失败"重试一次(间隔 800ms, 浏览器重启 typically <1s); 目标侧真实响应(payload.ok)
  // 永不重发, 与"不双发"契约一致
  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryHint = attempt === 1 ? '重试一次' : '降级 native 链'
    try {
      const res = await fetch(`${bridge}/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, mode, headless: true, proxy: proxy || undefined, timeoutMs, headers }),
        // 客户端侧护栏只防桥进程僵死(桥自身对目标限时); 冗余 15s, 下限 45s(stealthy
        // 首启含浏览器冷启动 + solve_cloudflare 挑战求解耗时)
        signal: AbortSignal.timeout(Math.max(timeoutMs + 15_000, 45_000)),
      })
      if (!res.ok) {
        console.warn(`[fetcher] scrapling 桥响应形态非法(HTTP ${res.status}), ${retryHint}`)
        if (attempt === 1) {
          await new Promise((r) => setTimeout(r, 800))
          continue
        }
        return null
      }
      const payload = (await res.json()) as { ok?: boolean; status?: number; html?: string; finalUrl?: string; error?: string }
      if (!payload?.ok || typeof payload.status !== 'number' || typeof payload.html !== 'string') {
        console.warn(`[fetcher] scrapling 桥内失败(${String(payload?.error || '响应形态非法').slice(0, 140)}), ${retryHint}`)
        if (attempt === 1) {
          await new Promise((r) => setTimeout(r, 800))
          continue
        }
        return null
      }
      return { status: payload.status, html: payload.html, finalUrl: payload.finalUrl || url }
    } catch (e: any) {
      console.warn(`[fetcher] scrapling 桥不可达(${bridge}): ${String(e?.message || e).slice(0, 120)}, ${retryHint}`)
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 800))
        continue
      }
      return null
    }
  }
  return null
}

/** 单代理(或直连)单次尝试: bun fetch 失败(网络错误/4xx/5xx)时自动落 curl 子进程。
 *  超时(AbortError)不落 curl: 同超时下 curl 也救不了, 白等。
 *  挑战壳(200+JS跳转)不在此处理, 由上层 Cookie 重试/浏览器升级链负责。
 *  代理尝试在 node 运行时直接走 curl(undici 静默忽略 proxy, 见 PROXY_FETCH_SUPPORTED) */
async function fetchHttpWithCurlSingle(url: string, cfg: FetchConfig, ua: string, proxy: string): Promise<string> {
  if (proxy && !PROXY_FETCH_SUPPORTED) {
    // node 运行时 + 代理: 内置 fetch 不支持 proxy 选项(静默忽略→伪装直连)。
    // gg 中继桥优先(若 bun 中继服务在位): bun 级 TLS 指纹过 WAF(wanben GoEdge 实录
    // curl 指纹被拦); 中继不在/中继层失败 → curl 链兜底(既有行为, 零回归)。
    // 超时(AbortError)不落 curl(同超时 curl 也救不了, 白等); 目标侧响应如实上抛不双发。
    if (await checkRelay()) {
      try {
        return await fetchHttp(url, cfg, ua, proxy, 'relay')
      } catch (e: any) {
        if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') throw e
        if (!(e instanceof RelayTransportError)) throw e
        console.warn('[fetcher] 中继桥失败, 落 curl 链:', String(e?.message || e).slice(0, 140))
      }
    }
    return fetchViaCurl(url, cfg, ua, proxy)
  }
  try {
    return await fetchHttp(url, cfg, ua, proxy)
  } catch (e: any) {
    if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') throw e
    try {
      return await fetchViaCurl(url, cfg, ua, proxy)
    } catch (curlErr: any) {
      console.warn('[fetcher] curl 传输未成:', String(curlErr?.message || curlErr).slice(0, 140))
      // 原错误是 HTTP 状态错误(带 status)时仍抛原错误保留 bodyHtml 语义;
      // 原错误是纯网络层失败(无 status, 如 TLS 指纹被 WAF 拒连)时改抛 curl 的错误 ——
      // 它带 status/bodyHtml, 上层 fetchPage 的 fallbackStatus/Cookie 挑战重试判定依赖这些字段,
      // 原先一律重抛原错误会让"curl 拿到 403+Set-Cookie"的挑战信号丢失, Cookie 重试链路失效
      if (e?.status) throw e
      throw curlErr || e
    }
  }
}

/** @internal 测试专用(gg 中继桥验证): 显式指定 transport 执行单次 HTTP 尝试 ——
 *  bun 运行时下 PROXY_FETCH_SUPPORTED 恒真, node+proxy 决策分支在 bun 探针里不可达,
 *  故以直通入口验证 relay 传输与 fetchHttp 逐跳语义的组合(循环回环端到端) */
export async function fetchHttpForTest(url: string, cfg: FetchConfig, ua: string, proxy: string, transport: 'native' | 'relay'): Promise<string> {
  return fetchHttp(url, cfg, ua, proxy, transport)
}

/**
 * HTTP 双传输封装 + 出口代理轮换(dd-a, 失败降级契约):
 * 配置了代理且目标非回环时, Fisher-Yates 洗牌后逐条尝试(每条 = bun fetch→curl 兜底
 * 单次尝试); 任一条成功即返回; 全部失败 → 降级直连重试一次(与 token 预取
 * "静默降级不硬断"同口径)。轮换/降级全程仅 warn 级日志, 不因代理失败中断采集;
 * 降级直连成功与否如实返回/抛出(错误保留 status/bodyHtml 供上层挑战链判定)。
 * token 预取(prefetchToken)/token 挑战求解(trySolveTokenChallenge)亦经本函数,
 * 代理/回环豁免语义自动贯穿; 目标回环或未配置代理时行为与原实现完全一致(零回归)
 */
export async function fetchHttpWithCurlFallback(url: string, cfg: FetchConfig, ua: string): Promise<string> {
  const pool = parseProxyPool(cfg.proxyUrl)
  if (!pool.length || isLoopbackTarget(url)) {
    return fetchHttpWithCurlSingle(url, cfg, ua, '')
  }
  const order = pool.slice()
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  let lastErr: any = null
  for (const proxy of order) {
    try {
      return await fetchHttpWithCurlSingle(url, cfg, ua, proxy)
    } catch (e: any) {
      lastErr = e
      console.warn(`[fetcher] 代理请求失败, 轮换下一条(${redactProxy(proxy)}): ${String(e?.message || e).slice(0, 140)}`)
    }
  }
  console.warn(`[fetcher] 全部 ${order.length} 条代理失败(末次: ${String(lastErr?.message || lastErr).slice(0, 120)}), 降级直连重试: ${url.slice(0, 200)}`)
  return fetchHttpWithCurlSingle(url, cfg, ua, '')
}

// ---------- 通用 token 预取钩子(bb-d) ----------
/** 场景: 部分站点(bqg713 系 content 段等)的接口/页面需要先从另一端点取得动态 token
 *  才能放行(缺失/非法值一律 403)。这里提供【通用预取型】token 能力:
 *   - cfg.tokenUrl: 预取地址(响应体含 token 的任意端点); 支持 {url} 占位符
 *     (=当前请求 URL 的 encodeURIComponent, 外部转换代理形态)
 *   - cfg.tokenPattern: 提取表达式 — 'regex:' 前缀=正则(取第一捕获组, 无捕获组取全匹配);
 *     否则按 JSON 点路径(如 'data.token', 语法同 parser.jsonGet)
 *   - cfg.tokenInjection: 'url'=替换请求 URL 中的 {token} / %7Btoken%7D 占位符
 *     (规则 const 模板不认识的 {token} 占位符可用百分号编码形态存活到 fetch 时),
 *     无占位符时追加 ?token=/&token= 查询参数; 'header'=注入请求头 tokenHeaderName(默认 X-Token)
 *   - 预取失败/提取为空 → 静默降级为无 token 直连(不硬断链路);
 *     同 (host+tokenUrl+pattern) 30s 进程内缓存, 防逐章双请求拖慢与预取端限流
 *   注: bqg713 现状为【按章 AES-CBC 加密参数】型 token(每次请求需对 {id,chapterid}
 *   加密, 密钥派生自站点混淆 JS), 不属"可预取 token"形态, 本钩子无法表达 ——
 *   该站仍需站点专属解密或外置转换代理(见 worklog bb-d 留档), 钩子面向通用形态 */
const TOKEN_CACHE_TTL_MS = 30_000
/** 容量上限(rr-c3): {url} 占位符形态(生产 bqg713 规则 tokenUrl=…/rewrite?url={url} 在用)
 *  按解析后 URL 逐章分键, TTL 仅在"同键再次命中"时惰性删过期条目 —— 逐章单次访问的键
 *  永不回收, 长任务 Map 无界增长(probe-rr-c3-token-cache 实证: 800 目标→800 条目, 人为
 *  过期条目新写入后仍存活)。超限先全表清扫过期条目, 仍超限按插入序删最旧; 固定 tokenUrl
 *  (会话型)形态每 host 恒 1 条, 上限永不触及, 缓存语义零变化 */
const TOKEN_CACHE_MAX = 256

function tokenCacheTrim(cache: Map<string, { token: string; at: number }>) {
  if (cache.size <= TOKEN_CACHE_MAX) return
  const now = Date.now()
  for (const [k, e] of cache) {
    if (now - e.at >= TOKEN_CACHE_TTL_MS) cache.delete(k)
  }
  while (cache.size > TOKEN_CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

const globalForToken = globalThis as unknown as { __novelTokenPrefetch_v1?: Map<string, { token: string; at: number }> }
function tokenCache(): Map<string, { token: string; at: number }> {
  if (!globalForToken.__novelTokenPrefetch_v1) globalForToken.__novelTokenPrefetch_v1 = new Map()
  return globalForToken.__novelTokenPrefetch_v1
}

/** token 提取: 'regex:' 前缀=正则第一捕获组(无捕获组取全匹配), 否则 JSON 点路径。
 *  JSON 路径惰性 import parser(其顶层依赖 fetchPage, 避免模块环) */
async function extractToken(body: string, pattern: string): Promise<string> {
  if (!body) return ''
  const p = (pattern || '').trim()
  if (!p) return ''
  if (p.startsWith('regex:')) {
    try {
      const m = new RegExp(p.slice(6)).exec(body)
      return m ? (m[1] ?? m[0] ?? '').trim() : ''
    } catch { return '' }
  }
  try {
    const { parseJsonBody, jsonGet, jsonToString } = await import('./parser')
    const root = parseJsonBody(body)
    if (root === undefined) return ''
    return jsonToString(jsonGet(root, p)).trim()
  } catch { return '' }
}

/** token 预取(带 30s 进程内缓存): 失败返回 ''(静默降级, 不硬断链路) */
async function prefetchToken(targetUrl: string, cfg: FetchConfig, ua: string): Promise<string> {
  const tokenUrl = (cfg.tokenUrl || '').trim()
  const pattern = (cfg.tokenPattern || '').trim()
  if (!tokenUrl || !pattern) return ''
  let real = tokenUrl
  if (real.includes('{url}')) real = real.replace('{url}', encodeURIComponent(targetUrl))
  // 缓存键用【解析后】预取 URL(bb-g 修复): 原 tokenUrl 原串含 {url} 占位符时, 同 host 30s 内
  // 所有目标 URL 共享同一缓存槽 —— 第二章复用第一章的 f(url) token 必被目标端 403。
  // 固定 tokenUrl(会话型)时 real === tokenUrl, 缓存语义不变
  const cacheKey = `${originHost(targetUrl)}|${real}|${pattern}`
  const cached = tokenCache().get(cacheKey)
  if (cached && Date.now() - cached.at < TOKEN_CACHE_TTL_MS) return cached.token
  try {
    const body = await fetchHttpWithCurlFallback(real, cfg, ua)
    const token = await extractToken(body, pattern)
    if (token) {
      const cache = tokenCache()
      cache.set(cacheKey, { token, at: Date.now() })
      tokenCacheTrim(cache) // rr-c3: 有界化(修前逐章分键条目永不清扫 → 长任务无界增长)
    }
    return token
  } catch { return '' }
}

// ---------- 镜像域名自动故障切换 (dd-b) ----------
/**
 * 场景: bqg713 系站点正文 API 钉死单域(apibi.cc), 域死则全站章节全失败, 换模板域名
 * 需手工平移。引擎级通用能力: FetchConfig.mirrorDomains 配置镜像组, 失败驱动逐 host
 * 重写重试(transport 级, 本文件内闭环)。
 * 设计裁定(存档 worklog dd-b):
 *  - 镜像组 = URL 自身 host + mirrorDomains 全部条目(通用口径: URL host 无须出现在
 *    列表内, 组内即触发); 组以 URL host 打头, "从当前 host 的下一个开始/环形回绕"语义
 *    由构造保证(首尝试即当前 host, 逐个后移, 至多组大小次);
 *  - 触发条件 transport 级: 网络错误/超时(无 status)与 HTTP 403/5xx; 404 与 2xx/3xx
 *    不触发(404=资源不存在, 换镜像无意义, 存档裁定); 401/412/429 等其余 4xx 亦不触发
 *    (auto 引擎下交既有浏览器升级链处理, 与镜像职责正交);
 *  - hostGate 关系: 镜像重试在本层(fetchPage 内)完成, 不经 hostGate 闸门 —— 故障切换是
 *    失败驱动的低频路径且至多组大小次有界, 按新 host 重新排队会显著复杂化计账且收益为零
 *    (runner.gateFetch 对整个 fetchPage 调用持一个闸门槽, 内部镜像重试随行同槽);
 *  - 每个镜像 host 独立走完整 fetchPageOnce 流程(token 预取 {url} 占位符按重写后 URL
 *    取值 → 逐章 token 天然按镜像域重签, 代理池/回环豁免/UA/Cookie 逻辑照常);
 *    不做跨请求"上次好域"记忆(有状态缓存会延迟故障发现, 保持无状态可测);
 *  - fetchBinary(封面等静态资源)刻意不接镜像: 非内容链路且失败优雅降级 null。
 */
const MAX_MIRROR_HOSTS = 10

/** 镜像组解析: URL host 打头 + mirrorDomains 逗号分隔条目(小写化/去空/去重/逐条形态
 *  校验, 上限 MAX_MIRROR_HOSTS; 与 URL host 相同的条目剔除)。未配置或 URL 不可解析
 *  → 返回空(单 host 直通, 零行为变化) */
export function mirrorGroupFor(url: string, cfg: Pick<FetchConfig, 'mirrorDomains'>): string[] {
  const raw = (cfg.mirrorDomains || '').trim()
  if (!raw) return []
  let host = ''
  try { host = new URL(url).host.toLowerCase() } catch { return [] }
  if (!host) return []
  const seen = new Set<string>([host])
  const group = [host]
  for (const item of raw.split(',')) {
    const s = item.trim().toLowerCase()
    if (!s || seen.has(s) || !isValidMirrorHost(s) || group.length >= MAX_MIRROR_HOSTS + 1) continue
    seen.add(s)
    group.push(s)
  }
  return group
}

/** host 重写: 仅换 hostname(条目带 :port 时连 port 一起换, 条目缺省端口则保留原 port),
 *  scheme/path/query/fragment 原样保留。URL 不可解析返回 null(调用方跳过该镜像) */
export function rewriteMirrorHost(url: string, hostEntry: string): string | null {
  try {
    const u = new URL(url)
    const idx = hostEntry.lastIndexOf(':')
    if (idx > 0) {
      u.hostname = hostEntry.slice(0, idx)
      u.port = hostEntry.slice(idx + 1)
    } else {
      u.hostname = hostEntry
    }
    return u.toString()
  } catch {
    return null
  }
}

/** 镜像切换触发判定: 有显式 status 时仅 403/5xx 可切换; 无 status = 网络层错误/超时
 *  (DNS 失败/连接拒绝/TLS/AbortError) —— 域名级故障的典型形态, 可切换。
 *  404(资源不存在, 换镜像无意义, 存档裁定)/3xx/其余 4xx 不触发 */
export function isMirrorSwitchableError(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status
  if (typeof status === 'number' && Number.isFinite(status) && status > 0) {
    return status === 403 || (status >= 500 && status <= 599)
  }
  return true
}

// ---------- 统一入口 ----------
export interface FetchResult {
  html: string
  engine: 'http' | 'browser'
  blocked: boolean
}

/**
 * 统一抓取入口: 未配置 mirrorDomains 时单 host 直通 fetchPageOnce(与历史行为逐字节一致);
 * 配置后按镜像组失败驱动切换(dd-b, 语义见镜像段注释)
 */
export async function fetchPage(url: string, cfgOverride?: Partial<FetchConfig>): Promise<FetchResult> {
  const cfg: FetchConfig = { ...DEFAULT_FETCH_CONFIG, ...cfgOverride }
  const group = mirrorGroupFor(url, cfg)
  if (group.length <= 1) return fetchPageOnce(url, cfg)
  let lastErr: unknown = null
  for (let i = 0; i < group.length; i++) {
    const hostUrl = rewriteMirrorHost(url, group[i])
    if (!hostUrl) continue
    try {
      return await fetchPageOnce(hostUrl, cfg)
    } catch (e) {
      lastErr = e
      // 不可切换错误(404/3xx/其余4xx)原样上抛: 换镜像无意义, 错误语义与单 host 契约一致
      if (!isMirrorSwitchableError(e)) throw e
      console.warn(
        `[fetcher] 镜像切换: ${group[i]} 失败(${String((e as Error)?.message || e).slice(0, 120)}), ` +
        (i + 1 < group.length ? `改试下一镜像 ${group[i + 1]}` : `镜像组已尽(共${group.length}个 host)`)
      )
    }
  }
  throw lastErr ?? new Error('抓取失败(镜像组全部尝试失败)')
}

/**
 * Token 挑战 HTTP 求解器(ixdzs/101kks 系"正在验证浏览器"盾):
 * 页面 body 内嵌 `let token = "..."` 并执行 `location.href = pathname + "?challenge=" + token`,
 * 纯 HTTP 即可求解 —— 取 token → 带 Cookie 请求 原地址+challenge 参数 → 得真实页面。
 * 求解后新 Cookie 已随响应写入 jar, 后续请求直连。
 * 返回 null 表示不匹配该模式或求解后仍被拦(交回上层升级链)。
 */
async function trySolveTokenChallenge(url: string, html: string, cfg: FetchConfig, ua: string): Promise<string | null> {
  if (!html || html.length > 5000) return null
  const m = html.match(/token\s*=\s*"([A-Za-z0-9+/=_-]{20,})"/)
  // 必须同时命中 "?challenge=" 拼接模式才认: 防止 CF "Attention Required" 等无关拦截页
  // 里的 challenge-platform 字样误触发求解(白烧两跳请求)
  if (!m || !/["'`]\s*\?\s*challenge\s*=?|challenge\s*=\s*"?["'`+]|\+\s*encodeURIComponent/i.test(html)) return null
  const challengeUrl = `${url}${url.includes('?') ? '&' : '?'}challenge=${encodeURIComponent(m[1])}`
  try {
    const solved = await fetchHttpWithCurlFallback(challengeUrl, cfg, ua)
    return looksBlocked(solved) ? null : solved
  } catch {
    return null
  }
}

/** 单 host 完整抓取流程(原 fetchPage 本体): token 预取 → HTTP 重试链 → auto 浏览器升级。
 *  每个镜像 host 独立走一遍完整流程 —— token 预取 {url} 占位符按当前 host 的 URL 取值,
 *  逐章 token 天然按镜像域重签(与 token 钩子组合的正确性来源, verify-dd-b-mirror ④ 实证);
 *  auto 引擎两条出口错误附加 .status=lastStatus: 镜像层按状态判定可切换性(纯网络错误
 *  无 status 天然可切换; 404 等不可切换错误透传状态后仍不可切换) */
async function fetchPageOnce(url: string, cfg: FetchConfig): Promise<FetchResult> {
  // hh-c: scrapling 桥分流 —— fetchMode='scrapling-*' 时整次抓取交桥代发, 目标侧响应
  // 如实返回(不双发); native 专有步骤(token 预取/autoCookie/Cookie 重试/浏览器升级链)
  // 跳过, 隐身能力由桥内 Scrapling Fetcher 承担。桥不可达/桥内异常 → null → 落入下方
  // 既有 native 链降级一次(warn 日志在 fetchViaScraplingBridge 打出)。非法 fetchMode
  // 在 sanitize 白名单已丢弃, scraplingModeOf 此处再兜底(运行时对象直改注入防线)。
  // 未配置 fetchMode / 'native' → scraplingModeOf=null, 下方原流程零行为变化
  const slMode = scraplingModeOf(cfg.fetchMode)
  if (slMode) {
    const bridged = await fetchViaScraplingBridge(url, cfg, slMode)
    if (bridged) {
      const blocked = looksBlocked(bridged.html)
      if (blocked) {
        console.warn(`[fetcher] scrapling(${slMode}) 内容疑似被拦截(HTTP ${bridged.status}): ${url.slice(0, 160)}`)
      }
      return { html: bridged.html, engine: 'http', blocked }
    }
  }

  const ua = pickUaFor(originHost(url), cfg)

  // 通用 token 预取(bb-d): tokenUrl+tokenPattern 配置齐全时先取 token, 再按 tokenInjection
  // 注入('url'=URL 占位符替换/查询参数追加, 'header'=请求头); 未配置/预取失败原样直连
  let reqUrl = url
  let effCfg: FetchConfig = cfg
  if ((cfg.tokenUrl || '').trim() && (cfg.tokenPattern || '').trim()) {
    const token = await prefetchToken(url, cfg, ua)
    if (token) {
      if (cfg.tokenInjection === 'header') {
        // 请求头名同样清洗控制字符与冒号(与 curl 头注入防护同口径)
        const name = (cfg.tokenHeaderName || 'X-Token').replace(/[\r\n\0:]+/g, '').trim() || 'X-Token'
        // 头【值】同样清洗控制字符(bb-g 修复): token 来自远端预取响应体, 值含 CR/LF 时
        // bun fetch Headers 直接抛 TypeError(硬断链路) / curl 值被空格化、语义破坏 ——
        // 剥除后仍非空才注入, 否则按预取失败同口径静默降级直连
        const safeToken = token.replace(/[\x00-\x1f\x7f]+/g, '').trim()
        if (safeToken) effCfg = { ...cfg, headers: { ...cfg.headers, [name]: safeToken } }
      } else {
        const enc = encodeURIComponent(token)
        if (reqUrl.includes('{token}')) reqUrl = reqUrl.replace('{token}', enc)
        else if (/%7Btoken%7D/i.test(reqUrl)) reqUrl = reqUrl.replace(/%7Btoken%7D/i, enc)
        else {
          // 查询参数追加必须在 #fragment 之前(bb-g 修复): fragment 后的 query 服务端不可见,
          // 原「直接尾追」会把 token 落进锚点导致目标端永远收不到
          const h = reqUrl.indexOf('#')
          const sep = reqUrl.includes('?') ? '&' : '?'
          reqUrl = h >= 0 ? reqUrl.slice(0, h) + sep + 'token=' + enc + reqUrl.slice(h) : reqUrl + sep + 'token=' + enc
        }
      }
    }
  }

  const domain = originHost(reqUrl)

  const fallbackStatus = cfg.browserFallbackStatus || [403, 412, 429, 503]
  let lastErr: any = null
  let lastStatus = 0

  // 强制浏览器
  if (cfg.engine === 'browser') {
    const html = await renderWithBrowser(reqUrl, effCfg, ua)
    // 浏览器结果同样过拦截判定: 裸 Playwright 降级路径不识别挑战页, 原先固定 blocked=false
    // 会把盾页当正常内容返回, 上层解析入库产生脏书(obscura 路径已有挑战抛错, 此处是双保险)
    return { html, engine: 'browser', blocked: looksBlocked(html) }
  }

  // HTTP 尝试(带重试)
  // Cookie 挑战重试(修复 guichuideng.info 场景): 首访 403 响应携带 Set-Cookie
  // (autoCookie 已存入 jar), 带新 Cookie 重发一次 HTTP 即可 200 —— 因此
  // fallbackStatus 命中时, 若本次响应刚种下新 Cookie 或返回体是 JS 挑战壳,
  // 不立即 break 升级浏览器, 而是继续下一轮(带新 Cookie), 最多追加 2 次;
  // 追加用尽仍失败才 break 升级。429/503 仍走原退避重试路径。
  const baseAttempts = (cfg.retries ?? 0) + 1
  const MAX_COOKIE_RETRIES = 2
  let cookieRetries = 0
  let attempt = 0
  while (attempt < baseAttempts + cookieRetries) {
    attempt++
    const cookiesBefore = cookieJar.count(domain)
    try {
      let html = await fetchHttpWithCurlFallback(reqUrl, effCfg, ua)
      // Token 挑战 HTTP 求解: 命中"正在验证浏览器"式 token 重定向盾时, 纯 HTTP 取 token 重放,
      // 免浏览器升级(ixdzs/101kks 系)。http 与 auto 引擎均受益
      if (looksBlocked(html)) {
        const solved = await trySolveTokenChallenge(reqUrl, html, effCfg, ua)
        if (solved) html = solved
      }
      if (cfg.engine === 'http') return { html, engine: 'http', blocked: looksBlocked(html) }
      if (!looksBlocked(html)) return { html, engine: 'http', blocked: false }
      // auto 模式: 200 但内容疑似挑战壳 —— 若刚种下新 Cookie 或响应体是 JS 跳转壳,
      // 与 403 场景同策略追加带 Cookie 重试(有的站以 200+跳转壳代替 403), 用尽再升级浏览器
      const gotNewCookieOk = cookieJar.count(domain) > cookiesBefore
      if ((gotNewCookieOk || isJsChallenge(html)) && cookieRetries < MAX_COOKIE_RETRIES) {
        cookieRetries++
        await new Promise((r) => setTimeout(r, 350))
        continue
      }
      lastErr = new Error('内容疑似被拦截(验证码/JS挑战)')
      break
    } catch (e: any) {
      lastErr = e
      lastStatus = e?.status || 0
      const bodyHtml: string = e?.bodyHtml || ''
      // Token 挑战求解(错误路径): 403/412 响应体同样可能是 token 挑战页, 求解成功视同成功
      if (bodyHtml && looksBlocked(bodyHtml)) {
        const solved = await trySolveTokenChallenge(reqUrl, bodyHtml, effCfg, ua)
        if (solved) return { html: solved, engine: 'http', blocked: false }
      }
      if (fallbackStatus.includes(lastStatus)) {
        const gotNewCookie = cookieJar.count(domain) > cookiesBefore
        if ((gotNewCookie || isJsChallenge(bodyHtml)) && cookieRetries < MAX_COOKIE_RETRIES) {
          cookieRetries++
          await new Promise((r) => setTimeout(r, 350))
          continue // 带刚种下的新 Cookie 重发
        }
        // ff-b③: 403 且罐中已有会话但无新 Cookie —— 疑"陈旧会话 Cookie 被目标端拒绝"
        // (挑战 Cookie 与出口 IP/UA 绑定, 出口轮换后旧罐变毒药)。清空该域罐以全新会话
        // 重试一次(有 cookieRetries 上限兜底不死循环); 罐为空则直接 break 升级浏览器
        if (lastStatus === 403 && cookieJar.count(domain) > 0 && cookieRetries < MAX_COOKIE_RETRIES) {
          cookieJar.clear(domain)
          cookieRetries++
          await new Promise((r) => setTimeout(r, 350))
          continue
        }
        // ff-b④: 429/瞬时 5xx(500/502/504) 且重试额度未用尽 → 指数退避重试 HTTP 级
        // (1.5s×2^n 封顶 8s; 瞬时故障升级浏览器收益低)。retries=0(默认)时 baseAttempts=1
        // 额度天然耗尽 → 行为与原先完全一致(break 升级), 仅显式配 retries≥1 的规则享受退避。
        // 503 不参与(常为 CF 挑战壳, 保留升级浏览器语义); 超时不在此路径(isFetchTimeout 另行喂 hostGate)
        if (
          (lastStatus === 429 || lastStatus === 500 || lastStatus === 502 || lastStatus === 504) &&
          attempt < baseAttempts + cookieRetries
        ) {
          const delay = Math.min(1500 * Math.pow(2, attempt - 1), 8000)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        break
      }
      await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }

  // 本轮 HTTP 全部失败: 释放该域 UA 钉扎, 下次抓取换新 UA 再试
  domainUa.delete(domain)

  // auto: 升级浏览器渲染
  if (cfg.engine === 'auto') {
    const ok = await checkBrowser()
    if (ok) {
      try {
        const html = await renderWithBrowser(reqUrl, effCfg, ua)
        return { html, engine: 'browser', blocked: looksBlocked(html) }
      } catch (e: any) {
        const err: any = new Error(`HTTP(${lastStatus || lastErr?.message}) 与浏览器渲染均失败: ${e?.message?.slice(0, 100)}`)
        err.status = lastStatus
        // ab-b: 合成错误透传底层 429 的 Retry-After(gateFetch 抛错路径靠它精确感知限流冷却)
        if (lastErr && typeof lastErr.retryAfterMs === 'number') err.retryAfterMs = lastErr.retryAfterMs
        throw err
      }
    }
    const err: any = new Error(
      `抓取失败(${lastStatus || lastErr?.message || '被拦截'})且浏览器渲染引擎不可用; 可安装chromium或在规则中配置Cookie/UA`
    )
    err.status = lastStatus
    // ab-b: 同上, 合成错误透传 Retry-After(缺失/非法时不挂字段 → 上层 30s 兜底)
    if (lastErr && typeof lastErr.retryAfterMs === 'number') err.retryAfterMs = lastErr.retryAfterMs
    throw err
  }
  throw lastErr || new Error('抓取失败')
}

/** 获取二进制资源(封面等) */
export async function fetchBinary(
  url: string,
  cfgOverride?: Partial<FetchConfig>
): Promise<{ buf: Buffer; contentType: string } | null> {
  const cfg: FetchConfig = { ...DEFAULT_FETCH_CONFIG, ...cfgOverride }
  const ua = pickUaFor(originHost(url), cfg)
  const headers = buildHeaders(url, cfg, ua)
  // 大文件内存保护: 封面等资源超过上限直接放弃, 防异常站点回 4GB 响应拖爆内存
  const MAX_BINARY_BYTES = 25 * 1024 * 1024
  const timeoutMs = cfg.timeout && cfg.timeout > 0 ? cfg.timeout : 20000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' })
    if (!res.ok) {
      // rr-c3 卫生: 与 fetchHttp 3xx 分支同口径, 失败路径 body 显式 cancel 释放连接
      try { void res.body?.cancel().catch(() => {}) } catch { /* ignore */ }
      return null
    }
    const lenHeader = Number(res.headers.get('content-length') || 0)
    if (lenHeader > MAX_BINARY_BYTES) {
      // 超限早退时取消响应体: 不消费 body 会占住连接直到服务端断开
      try { await res.body?.cancel() } catch { /* ignore */ }
      return null
    }
    // 计时器覆盖到响应体读完: 原先 clearTimeout 在 body 读取前, body 传输挂死时无超时兜底
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BINARY_BYTES) return null
    return { buf, contentType: res.headers.get('content-type') || '' }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
