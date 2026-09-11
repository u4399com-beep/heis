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
  // —— 2-fetcher 扩充②: Chrome 141/142 / Edge 141/142 / Firefox 128~130 / Safari 17.6/18.0 /
  // Android Pixel 9 + Samsung S24(SM-S926B) / iOS 17.6/18.0(配合 sec-ch-ua-model 与
  // sec-ch-ua-platform-version 自洽); 池中既存条目保持不动(版本号无碰撞) ——
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
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

/** 从 UA 生成完整指纹头组(与 buildHeaders 合并, cfg.headers 可覆盖单项)
 *  2-fetcher 增强②: 在原有 sec-ch-ua / sec-ch-ua-mobile / sec-ch-ua-platform 基础上, 补齐
 *  与 Chromium 100+ 真实浏览器同步发送的低熵 Client Hints: sec-ch-ua-platform-version /
 *  sec-ch-ua-arch / sec-ch-ua-bitness / sec-ch-ua-model / sec-ch-ua-wow64; 并按 UA 平台段
 *  推导自洽的 Accept-Language(zh-CN / en-US / ja), 防"Android UA 配桌面 Accept-Language"
 *  的反向破绽。所有派生值与 UA 字符串严格配套(移动 UA → mobile=?1 + model=Pixel/iPhone,
 *  桌面 UA → mobile=?0 + model=""), 任一头缺失或错配都会被 WAF 指纹库判为爬虫。
 *
 *  feat-round-8: B2 — Sec-Fetch-User 链路语义
 *  真实 Chrome 导航行为: 用户首次输入 URL/点击外链进入时 Sec-Fetch-User: ?1
 *  (用户激活的导航); 同站后续跳转/翻页/重定向 Sec-Fetch-User: ?0 (无用户激活)。
 *  原实现恒送 ?1, 多页采集时全 ?1 与真实浏览器指纹相悖。改为按 Referer 是否存在
 *  判定: 无 Referer(首跳, secFetchSite=none) → ?1; 有 Referer(后续) → ?0。
 *  Referer 由 buildHeaders 按链(chainReferer > origin)注入, fingerprintHeadersFor
 *  入参 referer 即"生效 Referer", 据此判定首跳/后续语义自洽。 */
export function fingerprintHeadersFor(ua: string, referer: string, targetUrl: string): Record<string, string> {
  const family = uaFamilyOf(ua)
  const headers: Record<string, string> = {
    'Upgrade-Insecure-Requests': '1',
  }
  headers['Accept-Language'] = acceptLanguageFor(ua)
  if (family === 'chromium' || family === 'firefox') {
    headers['Sec-Fetch-Dest'] = 'document'
    headers['Sec-Fetch-Mode'] = 'navigate'
    headers['Sec-Fetch-Site'] = secFetchSite(referer, targetUrl)
    // feat-round-8: B2 — 首跳(无 Referer, 用户激活导航) ?1; 后续(有 Referer) ?0
    headers['Sec-Fetch-User'] = referer ? '?0' : '?1'
  }
  if (family === 'chromium') {
    const cv = ua.match(CHROME_VER_RE)?.[1] || ''
    const ev = ua.match(EDGE_VER_RE)?.[1] || ''
    if (cv) {
      const brands = ev
        ? `"Chromium";v="${cv}", "Google Chrome";v="${cv}", "Microsoft Edge";v="${ev}", "Not:A-Brand";v="24"`
        : `"Chromium";v="${cv}", "Google Chrome";v="${cv}", "Not:A-Brand";v="24"`
      headers['sec-ch-ua'] = brands
      const mobile = isMobileUa(ua)
      headers['sec-ch-ua-mobile'] = mobile ? '?1' : '?0'
      const platform = uaPlatformHint(ua)
      headers['sec-ch-ua-platform'] = `"${platform}"`
      // 2-fetcher② 增强: 与 platform 配套的低熵 Client Hints(Chrome 100+ 全量发送)
      headers['sec-ch-ua-platform-version'] = uaPlatformVersionFor(ua, platform)
      headers['sec-ch-ua-arch'] = uaArchFor(ua, platform)
      headers['sec-ch-ua-bitness'] = '64'
      headers['sec-ch-ua-model'] = uaModelFor(ua, mobile, platform)
      headers['sec-ch-ua-wow64'] = '?0'
    }
  }
  return headers
}

/** Accept-Language: 按 UA 平台/语言段推导 —— zh-cn UAs → zh-CN,zh;q=0.9,en;q=0.8;
 *  en-US UAs → en-US,en;q=0.9; ja_JP UAs → ja,en-US;q=0.9,en;q=0.8。原先一律硬编码
 *  zh-CN Accept-Language, 与 en-US / ja-JP UA 不配套(破绽指纹) */
function acceptLanguageFor(ua: string): string {
  if (/zh-cn|zh-CN/i.test(ua)) return 'zh-CN,zh;q=0.9,en;q=0.8'
  if (/ja-JP|ja_JP|\bja\b/i.test(ua)) return 'ja,en-US;q=0.9,en;q=0.8'
  if (/en-US/i.test(ua)) return 'en-US,en;q=0.9'
  return 'zh-CN,zh;q=0.9,en;q=0.6'
}

/** sec-ch-ua-platform-version: 与 UA 平台段自洽的版本号
 *  - Windows: 10.0.0(UA 不可区分 Win10/11, 默认 10.0.0; 真实 Chrome 不发 11.0.0 区分)
 *  - macOS: 14.0.0(按 UA Mac OS X 10_15_7 派生, 真实 Chrome 自 14.0.0 起)
 *  - Android: 14.0.0(按 UA Android 14 派生)
 *  - iOS: 17.0.0(按 UA iPhone OS 17_x 派生, 真实 Chromium-on-iOS 不发此头, 仅 Android 实际生效) */
function uaPlatformVersionFor(ua: string, platform: string): string {
  if (platform === 'Windows') return '10.0.0'
  if (platform === 'macOS') return '14.0.0'
  if (platform === 'Android') {
    const m = ua.match(/Android\s+(\d+)/i)
    return m ? `${m[1]}.0.0` : '14.0.0'
  }
  if (platform === 'iOS') {
    const m = ua.match(/iPhone OS\s+(\d+)_/i) || ua.match(/CPU OS\s+(\d+)_/i)
    return m ? `${m[1]}.0.0` : '17.0.0'
  }
  return '10.0.0'
}

/** sec-ch-ua-arch: 按 UA 平台推导 CPU 架构 —— Android/iOS → arm; 桌面(x86_64 / Win64) → x86 */
function uaArchFor(ua: string, platform: string): string {
  if (platform === 'Android' || platform === 'iOS') return 'arm'
  if (/aarch64|arm/i.test(ua)) return 'arm'
  return 'x86'
}

/** sec-ch-ua-model: 移动设备型号(Android Chromium 真实发送, iOS Safari 不发 Client Hints
 *  故此分支在 iOS UA 上永不触达); 桌面空串(Chromium 真实行为)。
 *  - Pixel 8/9 / Samsung SM-S921B/SM-S926B / M2102J2SC → 从 UA 提取设备型号段
 *  - 构建号形态(M2102J2SC Build/...)截首段防 Build 字串污染模型 */
function uaModelFor(ua: string, mobile: boolean, _platform: string): string {
  if (!mobile) return ''
  // Android Chromium: 抽取 "Android X; <model>" 段
  const m = ua.match(/Android\s+\d+;\s*([^);]+)\)/i)
  if (m) {
    const model = m[1].trim()
    const short = model.split(/\s+Build\//i)[0].trim()
    return short
  }
  return ''
}

// ============================================================
// agent-K-crawl-phase2: TLS / HTTP2 指纹 + 头组顺序防御 (深层反反爬)
// ------------------------------------------------------------
// 背景: UA 轮换 + Client Hints + Sec-Fetch-* 头组只解决了【应用层】指纹一致性。
// WAF 的高阶检测维度:
//  (1) TLS ClientHello 指纹(JA3/JA4): 由 TLS 握手的 CipherSuites 列表 + Extensions 列表
//      + Supported Groups + EC_Point_Formats 决定。Node.js fetch(undici / BoringSSL)的
//      TLS 栈固定为 BoringSSL, ClientHello 与 Chrome(BoringSSL 但有定制 Extensions)非常接近,
//      但与 Firefox(NSS) / Safari(SecureTransport)差异显著。WAF 据 JA3 hash 识别 bot。
//  (2) HTTP/2 SETTINGS 帧指纹(Akamai `_a` / `px-captcha`): SETTINGS_HEADER_TABLE_SIZE /
//      SETTINGS_ENABLE_PUSH / SETTINGS_INITIAL_WINDOW_SIZE / SETTINGS_MAX_FRAME_SIZE 等
//      按浏览器版本有特定值; WINDOW_UPDATE 增量、PRIORITY 帧顺序也是指纹维度。
//  (3) 头组顺序: HTTP/2 头帧中【头字段顺序】是浏览器指纹的一部分。Chromium 的真实顺序为
//      Host/Connection → sec-ch-ua → sec-ch-ua-mobile → sec-ch-ua-platform → Upgrade-Insecure-Requests
//      → User-Agent → Accept → Sec-Fetch-Site → Sec-Fetch-Mode → Sec-Fetch-User → Sec-Fetch-Dest
//      → Referer → Accept-Encoding → Accept-Language → Cookie。Firefox 顺序略不同(Sec-Fetch-* 在
//      Accept 之前); Safari 不发送 sec-ch-ua 系列。Object spread/assign 在 ES2015+ 保留字符串
//      键插入序, undici fetch 透传, 故只需按目标 profile 顺序构造 headers 对象。
//
// Node.js fetch 限制(如实记录, 防误判):
//   - undici fetch 的 TLS 选项无法定制 ClientHello(JA3) —— undici 的 connect 选项虽允许传入
//     custom ALPNProtocols / ciphers, 但 ClientHello 扩展列表与 Extension 顺序由 BoringSSL
//     固定, 真正定制需替换 undici dispatcher 用 tls.createSecureContext + 自定义 ClientHello
//     (非标准 API, 跨 Node 版本不稳)。详见 fetchHttp 段 R5-19 留档同口径限制。
//   - undici fetch 默认 HTTP/1.1; HTTP/2 需 new Client(url, { allowH2: true }) + Pool/Agent
//     显式开启。本引擎暂不引入 h2 Client(代码体积 + 维护成本), 故 h2 指纹的 observe-vs-expected
//     失配只在【经桥(scrapling-stealthy / fetch-relay 走 bun / 桥内 chromium)】路径有意义;
//     native 链恒为 HTTP/1.1, observe=null, 仅做"配置存在但 native 路径未观察到 h2"的 warn。
//
// 应对策略: 引入 tlsProfile / h2Fingerprint / headerOrderProfile 三字段, 均缺省零回归:
//   - 配置后引擎在 fetchPageOnce 入口判断: tlsProfile 配置且非 scrapling-* 模式 →
//     自动改写 fetchMode='scrapling-stealthy'(浏览器真实 TLS 栈); 否则仅打 warn 提示用户
//     "TLS 指纹在 native 路径无法定制, 建议改用桥模式"。
//   - h2Fingerprint 配置后, 桥响应若含 h2 信息则做 observe-vs-expected 比对; native 链
//     打 warn 提示"未启用 h2, observe 为 null"。
//   - headerOrderProfile: 'auto' 按 UA 家族自动选; 显式指定覆盖。buildHeaders 按 profile
//     重排头组(Object spread 保留插入序, 详见 applyHeaderOrder)。
// ============================================================

/** JA3 指纹常量(三大家浏览器代表性 profile, 仅用于 observe-vs-expected 比对 + 文档;
 *  本引擎无法变更 Node TLS 栈, 真正生效需走 CloakBrowser/scrapling-stealthy 路径)。
 *  JA3 = md5(TLSVersion,Ciphers,Extensions,Groups,EC_Point_Formats) —— 此处存 tuple 不存 hash,
 *  便于 observe 后做部分匹配(扩展顺序差异允许部分匹配, 整体 hash 比对会过严) */
export const JA3_PROFILES: Record<string, {
  /** TLS 版本(ClientHello.version, 0x0303=TLS1.2, 0x0304=TLS1.3 via supported_versions ext) */
  tlsVersion: string
  /** CipherSuites 列表(hex 形态, 顺序敏感) */
  ciphers: string[]
  /** Extensions 列表(数字, 顺序敏感) */
  extensions: number[]
  /** Supported Groups(named curves) */
  groups: number[]
  /** EC_Point_Formats */
  ecPointFormats: number[]
  /** 期望的 md5 JA3 hash(用作快速比对; 来源: 公开 ja3er.com / engineering.fb.com 数据) */
  ja3Hash: string
}> = {
  // Chrome 120 (2023-Q4): GREASE values 已规范化, 含 signature_algorithms(13)
  // 与 compress_certificate(51, BoringSSL-specific)扩展
  chrome120: {
    tlsVersion: '0x0303',
    ciphers: ['0x13a1', '0x1301', '0x1302', '0x1303', '0xc02b', '0xc02f', '0xc02c', '0xc030', '0xcca9', '0xcca8', '0xc013', '0xc014', '0x009c', '0x009d', '0x002f', '0x0035', '0x000a'],
    extensions: [0, 23, 65281, 10, 11, 35, 16, 5, 34, 51, 43, 13, 45, 28, 65037, 21],
    groups: [0x001d, 0x0017, 0x0018, 0x0019, 0x0100, 0x0101],
    ecPointFormats: [0],
    ja3Hash: 'cd08e31494f9531f560d64c66547b9e4',
  },
  // Firefox 121 (2023-Q4): NSS 栈, 扩展顺序与 Chrome 不同; 无 compress_certificate(51)
  firefox121: {
    tlsVersion: '0x0303',
    ciphers: ['0x1301', '0x1303', '0x1302', '0xc02b', '0xc02f', '0xcca9', '0xcca8', '0xc02c', '0xc030', '0xc00a', '0xc009', '0xc013', '0xc014', '0x0033', '0x0039', '0x002f', '0x0035', '0x000a'],
    extensions: [0, 23, 65281, 10, 11, 35, 16, 5, 34, 51, 43, 13, 45, 28, 65037, 21],
    groups: [0x001d, 0x0017, 0x0018],
    ecPointFormats: [0],
    ja3Hash: 'b5001237ff942c839f6bd0c3d8c6d8e6',
  },
  // Safari 17 (2023): SecureTransport 栈, 扩展集合较小, 无 GREASE; signature_algorithms 在前
  safari17: {
    tlsVersion: '0x0303',
    ciphers: ['0x1301', '0x1302', '0x1303', '0xc02c', '0xc02b', '0xcca9', '0xc030', '0xc02f', '0xc014', '0xc013', '0x009e', '0x009f', '0xccaa', '0xc00a', '0xc009', '0x0039', '0x0038', '0x0033', '0x0032', '0x009d', '0x009c', '0x002f', '0x0035', '0x000a'],
    extensions: [0, 16, 5, 65281, 43, 13, 10, 11, 23, 18, 51, 45, 35, 27, 28, 21],
    groups: [0x001d, 0x0017, 0x0018, 0x0019],
    ecPointFormats: [0],
    ja3Hash: '773906b0efdefa24a7f2b8e4e8b9e5b3',
  },
}

/** 校验观测 JA3 是否与期望 profile 一致(部分匹配语义, 防扩展顺序差异过严):
 *  - 观测为 null/undefined(无法观测, 如 native Node fetch 无法获取 TLS 元信息) → return 'unobservable'
 *  - 完全匹配(全 5 字段一致) → 'match'
 *  - 部分匹配(ciphers 子集 + groups 一致, 扩展顺序差异容忍) → 'partial'
 *  - 完全不匹配(ciphers 差异显著) → 'mismatch'
 *  导出供验证脚本与 admin 端诊断调用 */
export function validateJa3(
  observed: { tlsVersion?: string; ciphers?: string[]; extensions?: number[]; groups?: number[]; ecPointFormats?: number[] } | null | undefined,
  expectedProfile: string,
): 'unobservable' | 'match' | 'partial' | 'mismatch' {
  if (!observed || !observed.ciphers || !observed.groups) return 'unobservable'
  const expected = JA3_PROFILES[expectedProfile]
  if (!expected) return 'mismatch'
  // ciphers 完全一致 → match; ciphers 子集(expected.ciphers 包含 observed 全部)→ partial
  const obsCiphers = observed.ciphers.map((c) => c.toLowerCase())
  const expCiphers = expected.ciphers.map((c) => c.toLowerCase())
  const ciphersEqual = obsCiphers.length === expCiphers.length &&
    obsCiphers.every((c, i) => c === expCiphers[i])
  if (ciphersEqual && observed.groups?.every((g, i) => g === expected.groups[i])) {
    return 'match'
  }
  // 部分匹配: observed.ciphers 是 expected.ciphers 的子集(允许 Chrome GREASE 位置差异)
  const expSet = new Set(expCiphers)
  const isSubset = obsCiphers.every((c) => expSet.has(c))
  return isSubset ? 'partial' : 'mismatch'
}

/** HTTP/2 SETTINGS 帧指纹常量(三大家浏览器 profile, 用于 observe-vs-expected 比对)。
 *  Akamai BMP / DataDome 等通过 h2 SETTINGS 帧字段值识别 bot:
 *  - SETTINGS_HEADER_TABLE_SIZE: HPACK 动态表大小(Chrome 65536, Firefox 65536, Safari 4096)
 *  - SETTINGS_ENABLE_PUSH: 0=禁用 server push(Chrome/Firefox 禁用, Safari 0)
 *  - SETTINGS_INITIAL_WINDOW_SIZE: 流级初始窗口(Chrome 6291456, Firefox 131072, Safari 4194304)
 *  - SETTINGS_MAX_FRAME_SIZE: 帧上限(Chrome 16384, Firefox 16384, Safari 16384)
 *  - SETTINGS_MAX_CONCURRENT_STREAMS: 最大并发流(Chrome 1000, Firefox 不发, Safari 100)
 *  - WINDOW_UPDATE 增量(连接级, 不同于流级); PRIORITY 帧顺序(stream 0/3/5/7 等)
 *  本字段仅用于诊断对照, Node fetch 默认不启用 h2(详见段头注释) */
export const H2_FINGERPRINTS: Record<string, {
  headerTableSize: number
  enablePush: number
  initialWindowSize: number
  maxFrameSize: number
  maxConcurrentStreams?: number
  /** 连接级 WINDOW_UPDATE 增量(浏览器首帧前的连接级窗口升级) */
  windowUpdateIncrement: number
  /** PRIORITY 帧序列(stream id 列表, 0=连接级, 奇数=流); 浏览器特定顺序 */
  priorityStreamIds?: number[]
}> = {
  chrome120: {
    headerTableSize: 65536, enablePush: 0, initialWindowSize: 6291456, maxFrameSize: 16384,
    maxConcurrentStreams: 1000, windowUpdateIncrement: 15663105,
    priorityStreamIds: [0, 3, 5, 7, 9, 11, 13],
  },
  firefox121: {
    headerTableSize: 65536, enablePush: 0, initialWindowSize: 131072, maxFrameSize: 16384,
    windowUpdateIncrement: 12517377,
    priorityStreamIds: [0, 3, 5, 7, 9, 11],
  },
  safari17: {
    headerTableSize: 4096, enablePush: 0, initialWindowSize: 4194304, maxFrameSize: 16384,
    maxConcurrentStreams: 100, windowUpdateIncrement: 4194304,
  },
}

/** 校验观测 h2 SETTINGS 是否与期望 profile 一致(部分匹配语义) */
export function validateH2Fingerprint(
  observed: { headerTableSize?: number; enablePush?: number; initialWindowSize?: number; maxFrameSize?: number; maxConcurrentStreams?: number } | null | undefined,
  expectedProfile: string,
): 'unobservable' | 'match' | 'partial' | 'mismatch' {
  if (!observed) return 'unobservable'
  const expected = H2_FINGERPRINTS[expectedProfile]
  if (!expected) return 'mismatch'
  const fields: (keyof typeof expected)[] = ['headerTableSize', 'enablePush', 'initialWindowSize', 'maxFrameSize']
  const matched = fields.filter((f) => observed[f] === expected[f]).length
  if (matched === fields.length) return 'match'
  if (matched >= 2) return 'partial'
  return 'mismatch'
}

// ---------- 头组顺序防御(agent-K) ----------
/**
 * 真实浏览器 HTTP/2 头帧中头字段顺序是浏览器指纹的一部分; Object spread/assign 保留字符串键
 * 插入序, undici fetch 透传此顺序。本常量定义三家浏览器的真实头顺序(仅 HTTP 头, 不含 :method
 * /:authority/:scheme/:path 伪头 —— 伪头由 HTTP/2 协议规定必须在前, undici 自动注入)。
 * 依据: Chromium net/spdy 真实代码 + Firefox necko + Safari CFNetwork 网络栈抓包数据。
 * buildHeaders 按目标 profile 顺序构造 headers 对象 → fetch 透传原序。
 *
 * 注意: HTTP/1.1 路径下头顺序对 WAF 检测价值相对较低(因 HTTP/1.1 头由行序决定, undici 不重排),
 * 但 HTTP/2 路径下头帧的顺序是高价值指纹维度。我们按 profile 顺序构造, 两条路径同时受益。
 */
export const HEADER_ORDER: Record<'chrome' | 'firefox' | 'safari', string[]> = {
  // Chromium 系真实顺序(net::HttpRequestHeaders::GetHeader::kHeaderOrder):
  // Host/Connection 自动注入(undici 管理), Cache-Control 仅在 cfg.headers 配置时存在
  chrome: [
    'Cache-Control',
    'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
    'sec-ch-ua-platform-version', 'sec-ch-ua-arch', 'sec-ch-ua-bitness',
    'sec-ch-ua-model', 'sec-ch-ua-wow64',
    'Upgrade-Insecure-Requests',
    'User-Agent', 'Accept',
    'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-User', 'Sec-Fetch-Dest',
    'Referer', 'Accept-Encoding', 'Accept-Language',
    'Cookie',
  ],
  // Firefox 真实顺序(necko HttpBaseChannel): Sec-Fetch-* 在 Accept 之前; 无 sec-ch-ua 系列
  firefox: [
    'Cache-Control',
    'Upgrade-Insecure-Requests',
    'User-Agent', 'Accept',
    'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-User', 'Sec-Fetch-Dest',
    'Referer', 'Accept-Encoding', 'Accept-Language',
    'Cookie',
  ],
  // Safari 真实顺序(CFNetwork): 与 Firefox 接近; 无 sec-ch-ua 系列, 无 Sec-Fetch-User(?1 仅首跳)
  safari: [
    'Cache-Control',
    'Upgrade-Insecure-Requests',
    'User-Agent', 'Accept',
    'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-Dest',
    'Referer', 'Accept-Encoding', 'Accept-Language',
    'Cookie',
  ],
}

/** 按目标 profile 顺序重排 headers 对象 —— Object spread 保留字符串键插入序, 按目标顺序
 *  重新构造对象即可让 undici fetch 按此顺序发送。未在 profile 中的头追加到末尾(用户自定义头)。
 *  profile='auto' 或未指定 → 按 UA 家族自动选; 'chrome'/'firefox'/'safari' → 显式覆盖 */
function applyHeaderOrder(headers: Record<string, string>, profile: string, ua: string): Record<string, string> {
  let orderKey: 'chrome' | 'firefox' | 'safari'
  if (profile === 'chrome' || profile === 'firefox' || profile === 'safari') {
    orderKey = profile
  } else {
    // 'auto' / undefined: 按 UA 家族推导
    const fam = uaFamilyOf(ua)
    orderKey = fam === 'safari' ? 'safari' : fam === 'firefox' ? 'firefox' : 'chrome'
  }
  const order = HEADER_ORDER[orderKey]
  const ordered: Record<string, string> = {}
  const present = new Set<string>()
  // 按 profile 顺序追加已存在的头(大小写不敏感匹配 —— fetch Headers 序列化时按原 case)
  const lowerHeaders: Record<string, { key: string; val: string }> = {}
  for (const [k, v] of Object.entries(headers)) {
    lowerHeaders[k.toLowerCase()] = { key: k, val: v }
  }
  for (const name of order) {
    const entry = lowerHeaders[name.toLowerCase()]
    if (entry) {
      ordered[entry.key] = entry.val
      present.add(name.toLowerCase())
    }
  }
  // 未在 profile 中的头按原插入序追加(用户自定义头, 避免丢失)
  for (const [k, v] of Object.entries(headers)) {
    if (!present.has(k.toLowerCase())) ordered[k] = v
  }
  return ordered
}

// ---------- Cookie 罐 (按域名) ----------
/** 会话条目 TTL(ff-b 增强④): 挑战/会话 Cookie(如 cf_clearance)与出口 IP+UA 绑定,
 *  30 分钟前的陈旧会话继续携带反而是"过期会话+拒绝服务"的 403 诱因 —— 真实浏览器
 *  会话同样有时效。过期条目在 get/count 惰性清扫; 跨请求复用本体(按 host 缓存、
 *  下次同 host 直接带)是既有 autoCookie 全局罐能力, 本轮仅补时效与失效清理 */
const COOKIE_SESSION_TTL_MS = 30 * 60 * 1000

// R6-1: 提取 origin 字符串中的 hostname(去 scheme/port) ——
//  CookieJar.store/get 接收的 domain 是 originHost(url) = `https://www.example.com` 形态(origin),
//  需从中取 hostname(www.example.com)做父域拆分。URL 解析失败返回空字符串。
function hostOf(origin: string): string {
  if (!origin) return ''
  try {
    return new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    // 非 URL 形态(可能是已剥好的 hostname), 直接小写化返回
    return origin.toLowerCase().replace(/^\[|\]$/g, '')
  }
}

// R6-1: origin/host → 父域链(含自身, 子域在前父域在后) ——
//  例: 'https://a.b.example.com' → ['a.b.example.com', 'b.example.com', 'example.com']
//  例: 'a.b.example.com'          → ['a.b.example.com', 'b.example.com', 'example.com']
//  IP 字面量 / localhost / 单段 host(无点) → [host](仅自身, 无父域可遍历)
//  最多 5 级防病态长 TLD; 用于 CookieJar.get 父域 cookie 合并 + store domain 属性校验
function parentDomainChain(origin: string): string[] {
  const host = hostOf(origin)
  if (!host) return []
  // IP 字面量 / localhost / *.localhost → 仅自身, 不做父域遍历
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return [host]
  if (host === 'localhost' || host.endsWith('.localhost')) return [host]
  const parts = host.split('.')
  // 单段(如 'localhost' 已上面处理; 'com' 这类 TLD-only 不应作 host 出现, 但兜底返回自身)
  if (parts.length < 2) return [host]
  // 倒序累积: parts=[a,b,example,com] → [a.b.example.com, b.example.com, example.com]
  //  不含 TLD-only('com'), 防注入者用 TLD 设 cookie 影响全局
  const out: string[] = []
  const maxLevels = Math.min(parts.length - 1, 5) // 最多 5 级, 不含 TLD
  for (let i = 0; i < maxLevels; i++) {
    out.push(parts.slice(i).join('.'))
  }
  return out
}

class CookieJar {
  // agent-A-fetcher Bug B48 修复: 条目新增 src 字段 —— R5-6 跨子域副罐逻辑把同一 cookie
  // 同时存到"请求 host 罐"和"cookie 自身 domain 副罐", 但 clear(domain) 旧实现只删请求 host 罐,
  // 副罐中的同名条目持续存活。后续 get() 经 parentDomainChain 合并时仍取到旧 cookie, "清空陈旧
  // 会话重试"语义失效。修法: 每条 cookie 记录其源请求 host(src), clear(domain) 遍历所有罐删除
  // src 匹配的条目, 精确清空"由该 host 引入的 cookies"(包括副罐), 不影响其它子域的同名 cookie
  private jars = new Map<string, Map<string, { v: string; at: number; src: string }>>()
  /** 未过期条目判定(过期即惰性删除) */
  private fresh(jar: Map<string, { v: string; at: number; src: string }>, k: string, e: { at: number }): boolean {
    if (Date.now() - e.at < COOKIE_SESSION_TTL_MS) return true
    jar.delete(k)
    return false
  }
  /** 2-fetcher Bug 9: 周期性清扫空域名 Map 条目 —— fresh() 删尽条目后罐中保留空 Map,
   *  长任务下域名数量累积泄漏(每章节一个 host, 万章→万 Map 条目)。5min 节流避免
   *  get/count 高频路径每次扫全表(O(N)); 调用方删除当前 jar 后 prune 顺带清扫其它域 */
  private lastPruneAt = 0
  private prune() {
    const now = Date.now()
    if (now - this.lastPruneAt < 5 * 60 * 1000) return
    this.lastPruneAt = now
    const empty: string[] = []
    for (const [domain, jar] of this.jars) {
      // 先惰性清过期, 再看是否空
      for (const [k, e] of jar) this.fresh(jar, k, e)
      if (jar.size === 0) empty.push(domain)
    }
    for (const d of empty) this.jars.delete(d)
  }
  get(domain: string): string {
    // R6-1: 跨子域 cookie 合并 —— R5-6 store() 已把带 `domain=` 属性的 cookie 同时存到
    //  cookie 自身 domain 罐里(如 .example.com → example.com 罐), 但 get() 旧行为只查
    //  精确匹配的 request host 罐, 永远拿不到父域罐中的 cf_clearance 等凭证。
    //  修法: 沿 request host 的父域链逐级合并 ——
    //   host=a.b.example.com → 查 a.b.example.com / b.example.com / example.com 三个罐;
    //   子域 cookie 覆盖父域同名 cookie(更具体的优先, 与浏览器同源 cookie 优先级一致)。
    //  域名拆分用点号分段倒序累积, 最多 5 级(常见域名 ≤3 级, 5 级防病态长 TLD);
    //  IP 字面量/localhost 不做父域遍历(它们不是 DNS 层级结构)。
    const hosts = parentDomainChain(domain)
    if (hosts.length === 0) {
      this.prune()
      return ''
    }
    // 合并: 父域先入, 子域后入覆盖同名键(子域优先)
    const merged = new Map<string, string>()
    for (let i = hosts.length - 1; i >= 0; i--) {
      const jar = this.jars.get(hosts[i])
      if (!jar || jar.size === 0) continue
      for (const [k, e] of jar) {
        if (this.fresh(jar, k, e)) merged.set(k, e.v)
      }
      if (jar.size === 0) this.jars.delete(hosts[i])
    }
    this.prune()
    if (merged.size === 0) return ''
    return Array.from(merged.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
  }
  /** 当前域名已存(未过期)cookie 数(用于判断本次响应是否刚种下新 Cookie) */
  count(domain: string): number {
    const jar = this.jars.get(domain)
    if (!jar) {
      this.prune()
      return 0
    }
    let n = 0
    for (const [k, e] of jar) {
      if (this.fresh(jar, k, e)) n++
    }
    if (jar.size === 0) this.jars.delete(domain)
    else this.prune()
    return n
  }
  store(domain: string, setCookieHeaders: string[]) {
    if (!setCookieHeaders?.length) return
    // 2-fetcher Bug 27: 拒收畸形 Set-Cookie。首段无 '=' / 名为属性关键字(Path/Domain/
    // Expires/Max-Age/Secure/HttpOnly/SameSite)的"伪 cookie"原先会被写入罐, 污染后续
    // Cookie 头(发送 "Path=/; Secure" 给服务端, 触发 400 Bad Request)
    const ATTR_NAMES = new Set(['path', 'domain', 'expires', 'max-age', 'secure', 'httponly', 'samesite'])
    // R6-5: 提取 request host 用于校验 Set-Cookie 的 domain 属性 ——
    //  RFC 6265 第 5.3 步 6: 服务端只能为「自己或自己的父域」设置 cookie。
    //  旧行为(R5-6 fix)只看 domain= 属性直接存到该域罐, 未校验 domain 是否为 request host
    //  的父域。攻击者控制 evil.com 即可设 `Set-Cookie: session=evil; domain=google.com`,
    //  cookie 被存到 google.com 罐, 后续请求 google.com 时被发出 → 跨域 cookie 注入。
    //  修法: 解析 domain 属性后, 校验 request host === cookieDomain 或 request host 以
    //  `.cookieDomain` 结尾(子域); 不通过则丢弃 domain 属性, cookie 仅存到 request host
    //  罐(host-only 语义, 与无 domain= 属性的 cookie 同行为)。
    const reqHost = hostOf(domain)
    // agent-A-fetcher Bug B48: src = reqHost, 用于 clear() 精确清扫副罐条目
    const src = reqHost || domain
    for (const raw of setCookieHeaders) {
      const [pair] = raw.split(';')
      const idx = pair.indexOf('=')
      if (idx <= 0) continue
      const name = pair.slice(0, idx).trim().toLowerCase()
      if (!name || ATTR_NAMES.has(name)) continue
      // R5-6: 解析 Set-Cookie 的 domain 属性 —— CF clearance 常带 `domain=.example.com`,
      // 旧行为只按请求 URL host(originHost 拿到 www.example.com)存罐, 后续 fetcher 直连
      // api.example.com 时 cookieJar.get('api.example.com') 返回空, cf_clearance 不发, 过盾失败。
      // 修法: 若 Set-Cookie 显式声明 domain=, 把该条 cookie 也存到 cookie 自身 domain 字段
      // (去前导点: '.example.com' → 'example.com') 对应的罐里; 无 domain= 的(默认 host-only)
      // 仍存到调用方传入的 request host 罐里。这样跨子域跳转/直连时凭证能跨子域复用。
      const attrs = raw.split(';').map((s) => s.trim())
      let cookieDomain: string | null = null
      for (const a of attrs) {
        const eq = a.indexOf('=')
        if (eq <= 0) continue
        const ak = a.slice(0, eq).trim().toLowerCase()
        if (ak === 'domain') {
          let dv = a.slice(eq + 1).trim().toLowerCase()
          if (dv.startsWith('.')) dv = dv.slice(1) // 去前导点(.example.com → example.com)
          if (dv) cookieDomain = dv
          break
        }
      }
      // R6-5: domain 属性安全校验 —— cookieDomain 必须是 request host 自身或其父域;
      //  不通过则降级为 host-only(不存副罐)。防跨域 cookie 注入(evil.com 设 domain=google.com)。
      //  parentDomainChain 返回 request host 的所有父域(含自身), cookieDomain 必须在其中。
      //  IP 字面量/localhost 不参与父域校验(parentDomainChain 返回空, 一律降级 host-only)。
      let effectiveCookieDomain: string | null = cookieDomain
      if (effectiveCookieDomain && reqHost) {
        const allowed = parentDomainChain(domain)
        if (!allowed.includes(effectiveCookieDomain)) {
          effectiveCookieDomain = null // 拒绝跨域, 降级为 host-only
        }
      } else if (effectiveCookieDomain && !reqHost) {
        // request host 不可解析(异常 URL), 一律降级 host-only 防注入
        effectiveCookieDomain = null
      }
      const cookieKey = pair.slice(0, idx).trim()
      const cookieVal = pair.slice(idx + 1).trim()
      // 主罐: 按调用方传入的 request host 存
      let jar = this.jars.get(domain)
      if (!jar) { jar = new Map(); this.jars.set(domain, jar) }
      jar.set(cookieKey, { v: cookieVal, at: Date.now(), src })
      // 副罐: cookie 自身 domain 属性指定的域(跨子域场景); R6-5 已校验为合法父域
      if (effectiveCookieDomain && effectiveCookieDomain !== domain) {
        let jar2 = this.jars.get(effectiveCookieDomain)
        if (!jar2) { jar2 = new Map(); this.jars.set(effectiveCookieDomain, jar2) }
        jar2.set(cookieKey, { v: cookieVal, at: Date.now(), src })
      }
    }
  }
  seed(domain: string, cookieStr?: string) {
    if (!cookieStr) return
    let jar = this.jars.get(domain)
    if (!jar) { jar = new Map(); this.jars.set(domain, jar) }
    // R3-2: 应用与 store() 同口径的 ATTR_NAMES 过滤 —— 否则 seed('Path=/; Secure; HttpOnly')
    // 形态会把"Path/Secure/HttpOnly"当 cookie 名塞进罐, 后续 buildHeaders 拼出 "Path=/; Secure=..."
    // 头发送给服务端, 触发 400。手工 seed 多见于规则配置的 starter cookies, 字面量常含属性声明
    const ATTR_NAMES = new Set(['path', 'domain', 'expires', 'max-age', 'secure', 'httponly', 'samesite'])
    // agent-A-fetcher Bug B48: 同 store() 记录 src, 让 clear() 能精确清扫 seed 的 cookies
    const src = hostOf(domain) || domain
    for (const pair of cookieStr.split(';')) {
      const idx = pair.indexOf('=')
      if (idx <= 0) continue
      const name = pair.slice(0, idx).trim().toLowerCase()
      if (!name || ATTR_NAMES.has(name)) continue
      jar.set(pair.slice(0, idx).trim(), { v: pair.slice(idx + 1).trim(), at: Date.now(), src })
    }
  }
  /** 清空指定 host 的罐(ff-b): 403 且无新 Cookie 时疑陈旧会话, 清空重走 autoCookie
   *  agent-A-fetcher Bug B48 修复: 旧行为只删 domain 对应的精确匹配罐, R5-6 副罐逻辑下,
   *  cookie 还可能存于父域罐(如 .example.com → example.com 罐)。副罐条目持续存活导致
   *  下次 get(domain) 经父域链合并仍取到旧 cookie, "陈旧会话"清理失效。改为遍历所有罐,
   *  删除 src 匹配的条目, 精确清扫"由该 host 引入的 cookies"(包括副罐), 不影响其它子域
   *  由各自 src 引入的同名 cookie */
  clear(domain: string) {
    const targetSrc = hostOf(domain) || domain
    // 主罐直接整体删除(本域所有条目 src 都是本域, 不必逐条过滤)
    this.jars.delete(domain)
    // 副罐: 遍历所有罐, 删除 src 匹配的条目(仅这些是 clear 调用方引入的)
    for (const [, jar] of this.jars) {
      if (jar.size === 0) continue
      for (const [k, e] of jar) {
        if (e.src === targetSrc) jar.delete(k)
      }
    }
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
  // 2-fetcher Bug 2: gb2312 / gbk 升级为 gb18030(严格超集), 修复 GB18030 字符(部分生僻汉字、
  // 全角符号、4字节汉字)在 gb2312 解码下变 ? 的乱码 —— 真实 iconv gb2312 仅覆盖基本集, GBK 扩展集
  // 与 GB18030 4字节区在 gb2312 模式下被替换为 U+FFFD
  if (charset === 'gb2312' || charset === 'gbk') charset = 'gb18030'
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
  if (!s) return false
  // 2-fetcher⑤ 增强: 旧版 CF JS 挑战壳特征(cf-chl-bypass), 在短壳内出现即判 JS 挑战;
  // challenge-platform 已在 STRONG_BLOCK_MARKERS / looksBlocked 内强判, 此处不重复触发
  if (s.length < 1200 && /cf-chl-bypass/i.test(s)) return true
  if (s.length >= 1200) return false
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
  // 2-fetcher③ 增强: WAF 通用拦截页特征补充 —— hCaptcha/Turnstile 旧版 CF/通用 WAF 拦截页
  'cf-chl-bypass',                          // 旧版 CF 挑战壳脚本特征
  'please verify you are a human',          // hCaptcha/Turnstile 验证页
  'enable javascript and cookies',          // 通用 WAF(Akamai/Sucuri)
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

export function looksBlocked(html: string, opts?: { status?: number; serverHeader?: string; cfRay?: string; cfMitigated?: string }): boolean {
  if (!html) return true
  // 2-fetcher③ 增强: HTTP 状态 + WAF Server 头联合判定 —— 403/429/503 + cloudflare/akamai/
  // incapsula/sucuri 即判拦(响应体可能为空或极短, 单凭内容特征漏判; 状态信息由调用方传入)
  if (opts?.status && (opts.status === 403 || opts.status === 429 || opts.status === 503)) {
    const srv = (opts?.serverHeader || '').toLowerCase()
    if (srv && /cloudflare|akamai|incapsula|sucuri/.test(srv)) return true
  }
  // agent-A-fetcher: CF 专属头判定 —— cf-ray 存在 + cf-mitigated 非"none"即判拦
  // (CF Managed Challenge 通过 cf-mitigated: challenge 头标识, bodyHtml 可能极短或 GBK 乱码)
  if (opts?.cfRay && opts?.cfMitigated && opts.cfMitigated.toLowerCase() !== 'none') return true
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
  // 2-fetcher③ 增强: 200~500 字短页且可见文本 <50 字 → 疑似空壳拦截页(典型 WAF 占位)
  if (html.length < 500) {
    const visibleText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (visibleText.length < 50) return true
  }
  // 含正常 <title> 且长度 >= 1200 的页面视为正常内容页,
  // 不因正文/导航提及"验证码/verify/enable javascript"等词误判
  if (html.length >= 1200 && hasNormalTitle(html)) return false
  return BLOCK_MARKERS.some((k) => lower.slice(0, 4000).includes(k))
}

// ============================================================
// agent-K-crawl-phase2: 验证码挑战识别 + Cookie 同意横幅 + 行为指纹防御
// ------------------------------------------------------------
// 这一层补齐 WAF 拦截的最后两道防线:
//  (1) 验证码(hCaptcha / Cloudflare Turnstile / Google reCAPTCHA): 命中后该 URL/host
//      必须进入冷却期(默认 10min)而非重试, 避免反复撞盾触发更严格风控(从挑战升级到 IP 封禁)。
//      挑战页通常极短(<2KB)且含特定脚本 src / div class, 与内容页区分度高。
//  (2) Cookie 同意横幅(GDPR / CCPA / 国内 Cookie 提示): EU 站点首次访问必现, 浏览器
//      渲染路径下 acceptCookieConsent 主动点击 "Accept All", 解除后续页面跳转/拦截。
//  (3) 行为指纹(会话级一致性 + 思考时间): 同一会话内 UA / viewport / timezone / language
//      必须全程一致(per-request 切换反而是爬虫指纹); 思考时间在请求间插入 1-3s 随机延迟,
//      打破"机械等间隔请求"模式 —— 与 jitterMs(批次间)正交, thinkTimeMs(单请求前)。
// ============================================================

/** 验证码类型(用于 FetchResult.captchaType 字段, runner 据此计数 + 冷却) */
export type CaptchaType = 'recaptcha' | 'hcaptcha' | 'turnstile' | 'geetest' | 'unknown'

/** 验证码特征 → 类型映射; HTML 含以下任一标记即判为对应验证码页 */
const CAPTCHA_MARKERS: { type: CaptchaType; patterns: RegExp[] }[] = [
  // Google reCAPTCHA: <div class="g-recaptcha"> / <script src="...recaptcha/api.js">
  {
    type: 'recaptcha',
    patterns: [/g-recaptcha/i, /www\.google\.com\/recaptcha\/api\.js/i, /recaptcha\/enterprise/i],
  },
  // hCaptcha: <div class="h-captcha"> / <script src="...hcaptcha.com/1/api.js">
  {
    type: 'hcaptcha',
    patterns: [/h-captcha/i, /js\.hcaptcha\.com\/1\/api\.js/i, /hcaptcha\.com\/sitekey/i],
  },
  // Cloudflare Turnstile: <div class="cf-turnstile"> / challenges.cloudflare.com/turnstile/v0/api.js
  {
    type: 'turnstile',
    patterns: [/cf-turnstile/i, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/i, /cf-turnstile-response/i],
  },
  // 极验 GeeTest 滑动验证: gt.js / geetest 风格 DOM
  {
    type: 'geetest',
    patterns: [/geetest/i, /static\.geetest\.com\/static\/tools\/gt\.js/i, /gt_[a-z0-9]{8,}/i],
  },
]

/** 识别 HTML 中是否含验证码挑战; 返回类型(null=无验证码)。
 *  - 优先匹配 script src(脚本路径难以伪装, 误判率极低)
 *  - 次匹配 div class(div 容易在正文里偶发命中, 故仅作 fallback)
 *  - 兼容性: 已含 STRONG_BLOCK_MARKERS 内的 'cf-turnstile'(挑战页识别); 本函数更细化
 *    区分类型供 runner 计数 + 冷却语义。短壳(<2KB)+ 任一标记 = 高置信度; 长页要求双标记 */
export function looksLikeCaptcha(html: string): CaptchaType | null {
  if (!html) return null
  const s = html.length < 2048 ? html : html.slice(0, 2048)
  for (const { type, patterns } of CAPTCHA_MARKERS) {
    const hits = patterns.filter((re) => re.test(s)).length
    if (hits >= 2) return type
    if (hits === 1 && html.length < 2048) return type // 短壳单命中即可
  }
  return null
}

/** 验证码冷却状态(进程级, 防 HMR 复用): host → { until, captchaType }
 *  检测到验证码后该 host 在冷却期内(默认 10min)拒绝重试, 跳过该 URL 让上层计数为失败;
 *  冷却到期后自动放行(给站点恢复机会, 验证码可能已由人工通过) */
interface CaptchaCooldownEntry {
  /** 冷却到期时刻 ms */
  until: number
  /** 命中的验证码类型 */
  captchaType: CaptchaType
  /** 命中次数(同 host 多次命中累加, 用于熔断判定) */
  hits: number
}
const globalForCaptcha = globalThis as unknown as { __novelCaptchaCooldown_v1?: Map<string, CaptchaCooldownEntry> }
const captchaCooldown: Map<string, CaptchaCooldownEntry> = globalForCaptcha.__novelCaptchaCooldown_v1 ?? new Map()
globalForCaptcha.__novelCaptchaCooldown_v1 = captchaCooldown

/** 进程级验证码计数(供 admin / snapshot 端点读取, 不持久化 —— 重启即清零) */
const globalForCaptchaCount = globalThis as unknown as { __novelCaptchaCount_v1?: number }
const captchaEncountered: number = globalForCaptchaCount.__novelCaptchaCount_v1 ?? 0
globalForCaptchaCount.__novelCaptchaCount_v1 = captchaEncountered

/** 获取当前进程累计验证码命中次数(供 runner snapshot 增量暴露给 UI) */
export function getCaptchaEncounteredCount(): number {
  return globalForCaptchaCount.__novelCaptchaCount_v1 ?? 0
}

/** 内部: 命中验证码时记入冷却表 + 计数; host 不可解析时用整 URL 作 key 兜底 */
function markCaptchaEncountered(url: string, captchaType: CaptchaType, cooldownMs: number): void {
  const key = (() => { try { return new URL(url).hostname.toLowerCase() } catch { return url.slice(0, 200) } })()
  const now = Date.now()
  globalForCaptchaCount.__novelCaptchaCount_v1 = (globalForCaptchaCount.__novelCaptchaCount_v1 ?? 0) + 1
  const existing = captchaCooldown.get(key)
  if (existing && existing.until > now) {
    existing.hits++
    existing.until = now + cooldownMs // 续期
    existing.captchaType = captchaType
  } else {
    captchaCooldown.set(key, { until: now + cooldownMs, captchaType, hits: 1 })
  }
  // 容量上限 5000 host(站群场景防 OOM; FIFO 淘汰过期+最旧)
  if (captchaCooldown.size > 5000) {
    const stale: string[] = []
    for (const [k, v] of captchaCooldown) {
      if (v.until <= now) stale.push(k)
    }
    for (const k of stale) captchaCooldown.delete(k)
    while (captchaCooldown.size > 5000) {
      const oldest = captchaCooldown.keys().next().value
      if (oldest === undefined) break
      captchaCooldown.delete(oldest)
    }
  }
}

/** 查询某 host 是否在验证码冷却期内; 返回 { inCooldown, captchaType?, remainingMs? } */
export function isHostInCaptchaCooldown(url: string): { inCooldown: boolean; captchaType?: CaptchaType; remainingMs?: number } {
  const key = (() => { try { return new URL(url).hostname.toLowerCase() } catch { return url.slice(0, 200) } })()
  const entry = captchaCooldown.get(key)
  if (!entry) return { inCooldown: false }
  const now = Date.now()
  if (entry.until <= now) {
    captchaCooldown.delete(key)
    return { inCooldown: false }
  }
  return { inCooldown: true, captchaType: entry.captchaType, remainingMs: entry.until - now }
}

/** 验证码冷却时长解析: 钳 [60_000, 3_600_000](sanitizeFetchConfig 同口径); 缺省 600_000(10min) */
function resolveCaptchaCooldownMs(cfg: FetchConfig): number {
  const v = cfg.captchaCooldownMs
  if (typeof v !== 'number' || !Number.isFinite(v)) return 600_000
  return Math.max(60_000, Math.min(3_600_000, Math.round(v)))
}

// ---------- Cookie 同意横幅(GDPR / CCPA / 国内 Cookie 提示) ----------
/** 常见 Cookie 同意按钮选择器列表(覆盖 OneTrust / CookieConsent / 内置实现等主流方案) */
export const COOKIE_CONSENT_SELECTORS = [
  // OneTrust(企业级最广泛)
  '#onetrust-accept-btn-handler',
  '#onetrust-button-group #accept-recommended-btnhandler',
  // CookieConsent JS(osano/cookieconsent.ink / cookieconsent.insites.com)
  '.cc-accept', '.cc-allow', '.cc-btn-accept',
  'a.cc-dismiss[href*="allow"]',
  // 通用 .cookies-* 类
  '.cookies-accept', '.cookies-allow', '.cookie-accept', '.cookie-allow',
  '.cookie-banner-accept', '.cookie-banner-allow',
  // Quantcast Choice
  '#qc-cmp2-ui button[mode="primary"]',
  '.qc-cmp2-summary-buttons button[mode="primary"]',
  //didomi
  '#didomi-notice-agree-button',
  'button.didomi-continue-without-agreeing',
  // TrustArc
  '#truste-consent-button',
  '.truste-button2[title*="Accept"]',
  // 通用 aria-label(英文/中文)
  'button[aria-label="Accept all"]',
  'button[aria-label="Accept All"]',
  'button[aria-label="Accept all cookies"]',
  'button[aria-label*="全部接受"]',
  'button[aria-label*="同意"]',
  // 兜底通用类名
  'button.accept-cookies',
  'button.btn-accept-cookies',
  'button.agree-cookies',
]

/** 浏览器渲染路径下主动点击 Cookie 同意横幅: 遍历常见选择器, 找到可见元素即点击;
 *  点击后等 800ms 让横幅动画完成 + Cookie 写入, 再返回页面 HTML。
 *  本函数设计为浏览器渲染路径专用(纯 HTTP 路径不可能点击按钮) —— 由 renderWithBrowser
 *  在 page.goto 完成后调用。返回 true 表示点击成功(可能改变页面 DOM/Cookie 状态) */
export async function acceptCookieConsent(page: import('playwright').Page): Promise<boolean> {
  for (const selector of COOKIE_CONSENT_SELECTORS) {
    try {
      const element = page.locator(selector).first()
      // 元素必须可见且有 boundingBox 才点击(headless 横幅可能 display:none 占位)
      const isVisible = await element.isVisible({ timeout: 200 }).catch(() => false)
      if (!isVisible) continue
      await element.click({ timeout: 1500, force: false }).catch(() => { /* 横幅可能带遮罩动画, 容忍 */ })
      // 等横幅消失 + Cookie 写入(Set-Cookie 由浏览器自动管理, fetcher 不直接读取)
      await page.waitForTimeout(800)
      return true
    } catch {
      continue
    }
  }
  return false
}

// ---------- 会话人格(per-session personality: UA + viewport + timezone + language 一致) ----------
/**
 * 真实浏览器会话: 一次打开浏览器后, UA / viewport / timezone / language 在整个会话内保持一致
 * (用户不会中途切换浏览器语言或窗口大小)。原引擎每域只钉扎 UA, 缺少 viewport/timezone/language
 * 三维 —— 浏览器渲染路径下 Playwright context 创建时 viewport 固定 1366x768, 与随机选中的
 * 移动 UA 不自洽(移动 UA 必须配移动 viewport 才真实)。
 *
 * 会话人格(SessionPersonality)按 host 维度钉扎, 同 host 整轮任务复用同一组合, 整轮失败
 * 时清空(host 级熔断后换新人格)。Cookie 罐 + UA 钉扎 + viewport/timezone/language 三维
 * 一起钉扎, 形成完整的"同一浏览器会话"画像。
 */
export interface SessionPersonality {
  /** 完整 UA 字符串(从 UA_POOL 选定) */
  userAgent: string
  /** viewport 尺寸(移动 UA → 360x640 / 390x844; 桌面 → 1366x768 / 1920x1080 等) */
  viewport: { width: number; height: number }
  /** 时区(IANA tz name, 如 'Asia/Shanghai' / 'America/New_York' / 'Europe/London') */
  timezone: string
  /** navigator.language(如 'zh-CN' / 'en-US') */
  language: string
  /** 是否移动端(影响 viewport / timezone 选项) */
  isMobile: boolean
}

/** 桌面 viewport 候选(主流分辨率, 与 UA 池配套) */
const DESKTOP_VIEWPORTS = [
  { width: 1366, height: 768 },   // 最常见
  { width: 1920, height: 1080 },  // Full HD
  { width: 1536, height: 864 },   // Surface / 笔记本
  { width: 1440, height: 900 },   // MacBook Air
  { width: 1280, height: 720 },   // HD
]
/** 移动 viewport 候选(主流手机分辨率, 物理像素非 CSS 像素 —— viewport 用 CSS 像素) */
const MOBILE_VIEWPORTS = [
  { width: 390, height: 844 },   // iPhone 12-15
  { width: 393, height: 851 },   // Pixel 7/8
  { width: 412, height: 915 },   // Pixel 9 / Samsung S24
  { width: 414, height: 896 },   // iPhone XR/11
  { width: 360, height: 800 },   // Samsung S20
]
/** 时区候选(按语言/区域匹配, 与 UA 配套; 中文 UA → Asia/Shanghai 等) */
const TIMEZONE_BY_LANG: Record<string, string[]> = {
  'zh-CN': ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Singapore'],
  'en-US': ['America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London'],
  'ja': ['Asia/Tokyo'],
}

/** 按 UA 推导会话人格: 同 host 整轮任务保持一致(进程级 Map 缓存, HMR 复用) */
function derivePersonality(ua: string): SessionPersonality {
  const isMobile = isMobileUa(ua)
  const viewports = isMobile ? MOBILE_VIEWPORTS : DESKTOP_VIEWPORTS
  const viewport = viewports[Math.floor(Math.random() * viewports.length)]
  // Accept-Language 推导(与 fingerprintHeadersFor 内的 acceptLanguageFor 同口径)
  let language = 'zh-CN'
  if (/zh-cn|zh-CN/i.test(ua)) language = 'zh-CN'
  else if (/ja-JP|ja_JP|\bja\b/i.test(ua)) language = 'ja'
  else if (/en-US/i.test(ua)) language = 'en-US'
  const tzList = TIMEZONE_BY_LANG[language] || ['Asia/Shanghai']
  const timezone = tzList[Math.floor(Math.random() * tzList.length)]
  return { userAgent: ua, viewport, timezone, language, isMobile }
}

const globalForPersonality = globalThis as unknown as { __novelSessionPersonality_v1?: Map<string, SessionPersonality> }
const sessionPersonalityMap: Map<string, SessionPersonality> = globalForPersonality.__novelSessionPersonality_v1 ?? new Map()
globalForPersonality.__novelSessionPersonality_v1 = sessionPersonalityMap

/** 获取(或创建)某 host 的会话人格: 钉扎至该 host 整轮任务结束; 整轮失败时调用 clearSessionPersonality
 *  清空让下次换新人格(同 domainUa 钉扎语义) */
export function getSessionPersonality(domain: string, cfg: FetchConfig): SessionPersonality {
  // 自定义 UA 时仍需配套 viewport/timezone(language 与 UA 自洽)
  const key = domain || 'global'
  const existing = sessionPersonalityMap.get(key)
  if (existing) return existing
  const ua = pickUaFor(domain, cfg)
  const personality = derivePersonality(ua)
  // 容量上限 200(与 domainUa 同口径); 超限时 FIFO 淘汰 20 个最旧
  if (sessionPersonalityMap.size > 200) {
    let n = 20
    for (const k of sessionPersonalityMap.keys()) {
      if (n-- <= 0) break
      sessionPersonalityMap.delete(k)
    }
  }
  sessionPersonalityMap.set(key, personality)
  return personality
}

/** 清空某 host 的会话人格(整轮失败时调用, 与 domainUa.delete 同口径) */
export function clearSessionPersonality(domain: string): void {
  if (domain) sessionPersonalityMap.delete(domain)
}

// ---------- 思考时间(人类阅读节奏不规则化) ----------
/**
 * 在 fetchPage 入口前插入随机延迟(0~thinkTimeMs ms), 模拟人类"读完上页再请求下页"的节奏。
 * 与 runner 的 jitterMs(批次间抖动)正交: jitterMs 控制同批次内请求间间隔, thinkTimeMs 控制
 * 单请求前的延迟, 两者叠加形成多层防节奏检测。缺省 0=零回归。
 *
 * 设计要点:
 *  - 延迟采用全抖动 [0, thinkTimeMs] 区间均匀分布(非固定 sleep), 避免多任务同步触发
 *  - 仅在外部 fetchPage 入口生效, 内部 fetchPageOnce 递归重试/镜像切换不叠加(否则单 URL 总延迟过长)
 *  - 与 hostGate minGapMs 协同: hostGate 控制同 host 准入节奏, thinkTimeMs 控制调用方调用节奏
 */
function applyThinkTime(cfg: FetchConfig): Promise<void> {
  const ms = cfg.thinkTimeMs
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  const delay = Math.floor(Math.random() * ms) // [0, ms) 全抖动
  if (delay <= 0) return Promise.resolve()
  return new Promise((r) => setTimeout(r, delay))
}

// ---------- 全局速率上限(滑窗 60s 钳制) ----------
/**
 * agent-K-crawl-phase2: 全局速率节流 —— cfg.globalRateLimitPerMin>0 时, 所有 host 合计每分钟
 * 不得超过本值。采用滑窗 60s 计数(数组存近 60s 的请求时间戳), 超出请求 sleep 到窗口腾出空位。
 * 防采集洪水打爆出口 IP / 触发上游 WAF 全局风控。
 *
 * 设计:
 *  - 滑窗数组存近 60s 的时间戳; 入口前过滤 >60s 的旧时间戳, 再判断当前请求是否超限
 *  - 超限时 sleep 至最早一个时间戳过期(让其腾出空位), 上限钳 30s 防呆死
 *  - 仅 fetchPage 入口生效(单 host 节奏由 hostGate.minGapMs 管, 全局上限管所有 host 合计)
 *  - 缺省 0=不限(零回归); 配置 >0 时启用, 钳 [10, 100_000] 防误填(sanitizeFetchConfig 同口径)
 */
const GLOBAL_RATE_WINDOW_MS = 60_000
const globalForRate = globalThis as unknown as { __novelGlobalRate_v1?: number[] }
const globalRateStamps: number[] = globalForRate.__novelGlobalRate_v1 ?? []
globalForRate.__novelGlobalRate_v1 = globalRateStamps

function applyGlobalRateLimit(cfg: FetchConfig): Promise<void> {
  const limit = cfg.globalRateLimitPerMin
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return Promise.resolve()
  // agent-M-fetcher-phase3: 抽出"尝试获取一个槽位"同步逻辑 —— 修复原实现的两个问题:
  //  (1) 过冲: sleep 后无条件 push, N 个 waiter 同时唤醒会全部 push, 瞬时超 limit + (N-1)
  //      (典型 batch 并发 10 → 限流窗口瞬时 10 个 stamp 过冲); 改为 push 前再校验 length<limit,
  //      仍超限则递归 setTimeout 再等一跳, 真正严格守 limit/min 上限
  //  (2) 惊群: 多 waiter 计算同一 waitMs(基于同一 globalRateStamps[0]), 同步唤醒同时 push;
  //      加 0~200ms jitter 让唤醒时间分散, 单次 push 不再瞬时叠 N 份
  const tryAcquire = (): { acquired: boolean; waitMs: number } => {
    const now = Date.now()
    while (globalRateStamps.length > 0 && now - globalRateStamps[0] > GLOBAL_RATE_WINDOW_MS) {
      globalRateStamps.shift()
    }
    if (globalRateStamps.length < limit) {
      globalRateStamps.push(now)
      return { acquired: true, waitMs: 0 }
    }
    // 超限: sleep 至最早一个时间戳过期(腾出空位), 上限钳 30s 防呆死
    const waitMs = Math.min(30_000, GLOBAL_RATE_WINDOW_MS - (now - globalRateStamps[0]) + 1)
    return { acquired: false, waitMs }
  }
  const first = tryAcquire()
  if (first.acquired) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const attempt = () => {
      const r = tryAcquire()
      if (r.acquired) {
        resolve()
        return
      }
      // 加 0~200ms jitter 防多 waiter 同步惊群(同时唤醒同时 push, 瞬时过冲)
      const jitter = Math.floor(Math.random() * 200)
      setTimeout(attempt, r.waitMs + jitter)
    }
    attempt()
  })
}

// ---------- 代理健康检查触发(节流 5min, 异步非阻塞) ----------
/** agent-K: 节流触发代理健康检查 —— cfg.proxyHealthCheck=true 时由 fetchPage 入口调用,
 *  距上次检查 >5min 才实际触发(异步执行, 不阻塞 fetchPage)。失败静默吞错。
 *  triggerProxyHealthCheck 调用方负责传入 cfg(包含 proxyUrl), 内部读取 proxyState
 *  的 lastHealthCheckAt 判断是否需要触发(避免每请求都跑一次全池 ping) */
const PROXY_HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000
const globalForHealthCheck = globalThis as unknown as { __novelProxyHealthCheck_v1?: { lastTriggeredAt: number; inflight: boolean } }
const healthCheckState = globalForHealthCheck.__novelProxyHealthCheck_v1 ?? { lastTriggeredAt: 0, inflight: false }
globalForHealthCheck.__novelProxyHealthCheck_v1 = healthCheckState

function triggerProxyHealthCheck(cfg: FetchConfig): void {
  const now = Date.now()
  // 节流: 距上次触发 <5min 不重发; inflight=true 时跳过(防并发触发)
  if (now - healthCheckState.lastTriggeredAt < PROXY_HEALTH_CHECK_INTERVAL_MS) return
  if (healthCheckState.inflight) return
  healthCheckState.lastTriggeredAt = now
  healthCheckState.inflight = true
  // 异步执行, 不阻塞 fetchPage; 完成后清 inflight
  void checkProxyHealthAll(cfg)
    .then((r) => {
      if (r.checked > 0) {
        console.log(`[fetcher] 代理健康检查完成: ${r.healthy} healthy, ${r.unhealthy} unhealthy, ${r.checked} checked`)
      }
    })
    .catch(() => { /* 静默吞错, 健康检查失败不应阻塞正常采集 */ })
    .finally(() => {
      healthCheckState.inflight = false
    })
}

// ---------- 浏览器渲染 (Playwright, 惰性加载) ----------
let browserAvailable: boolean | null = null
let browserCheckedAt = 0
let pwModule: any = null
/** 探测失败的重新检查间隔: 原先 false 永久缓存, chromium 后装好/瞬时故障后引擎永远不可用 */
const BROWSER_PROBE_RETRY_MS = 60_000

/** 每域 UA 钉扎: 同域连续请求保持同一 UA —— Cookie 罐是按域共享的, 若每个章节都换 UA,
 *  "同一会话 UA 跳变"本身就是一个典型爬虫特征; 整轮失败时清除钉扎, 下次调用换新身份 */
// R4-7: 版本化缓存键 __novelDomainUa_v3 + 形态校验, 防 dev HMR 模块重载时复用结构已变的旧实例
// (同 CookieJar.validJar 设计; 旧 v2 仅是 plain Map, 无法识别方法缺失/字段漂移)
const globalForUa = globalThis as unknown as { __novelDomainUa_v3?: Map<string, string> }
function validDomainUa(m: unknown): m is Map<string, string> {
  return m instanceof Map
}
const domainUa: Map<string, string> = validDomainUa(globalForUa.__novelDomainUa_v3)
  ? globalForUa.__novelDomainUa_v3 as Map<string, string>
  : new Map<string, string>()
globalForUa.__novelDomainUa_v3 = domainUa

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
    // R3-1: 原 domainUa.clear() 把站群场景下所有已钉扎 UA 一次性清空, 后续请求全部随机选 UA
    // → 同站会话 UA 跳变被反爬识别。改为按插入序 FIFO 淘汰 20 个最旧条目, 留下近期活跃站点
    if (domainUa.size > 200) {
      let n = 20
      for (const k of domainUa.keys()) {
        if (n-- <= 0) break
        domainUa.delete(k)
      }
    }
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
  // agent-Q-deep-audit: pickProxyFor 副作用(useCount++)去重 —— 修前 renderWithBrowser 调
  //  pickProxyFor 一次仅为判断"是否配了代理", 命中代理后 renderWithBrowserRaw 内部又调一次
  //  pickProxyFor 取实际代理(两次可能返回不同代理: random/round-robin 策略下); 第一次返回的
  //  代理被 markProxyUsed 但从未实际使用 → useCount 虚高 + 负载均衡被污染(least-used 偏向
  //  本不应被选的代理)。改为调用方计算一次并通过参数透传, renderWithBrowserRaw 不再自查
  const proxy = pickProxyFor(url, cfg)
  if (proxy) return renderWithBrowserRaw(url, cfg, ua, proxy)
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
  return renderWithBrowserRaw(url, cfg, ua, '')
}

/** 裸 Playwright 直连渲染(降级路径, 原 renderWithBrowser 实现)
 *  出口代理(dd-a): 目标非回环且配置了代理时, launch 挂占位全局 proxy(chromium 逐
 *  context 覆盖的前提, Playwright 文档: 所有 context 覆盖后全局值永不使用, 可为任意串)
 *  + newContext 注入真实代理(per-context, 本浏览器实例仅本请求专用, 无共享串扰);
 *  无代理时保持原样 launch(零回归) */
async function renderWithBrowserRaw(url: string, cfg: FetchConfig, ua: string, proxy: string): Promise<string> {
  if (!pwModule) {
    const ok = await checkBrowser()
    if (!ok) throw new Error('浏览器渲染引擎不可用(未安装playwright/chromium), 请使用HTTP引擎')
  }
  const { chromium } = pwModule
  // agent-Q-deep-audit: proxy 由调用方(renderWithBrowser)传入, 不再自查 pickProxyFor ——
  //  详见 renderWithBrowser 段注释(修前双重调用致 useCount 虚高 + 负载均衡污染)
  // agent-K-crawl-phase2: 会话人格 —— 同 host 整轮任务保持 UA/viewport/timezone/language 一致
  // (per-request 切换 viewport/timezone 反而是爬虫指纹; 真实浏览器会话内不会切换这些)
  const personality = getSessionPersonality(originHost(url), cfg)
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    ...(proxy ? { proxy: { server: 'http://per-context-placeholder' } } : {}),
  })
  const timeoutMs = cfg.timeout && cfg.timeout > 0 ? cfg.timeout : 20000
  try {
    const ctx = await browser.newContext({
      userAgent: personality.userAgent,
      // agent-K: 用 personality.viewport 替代原固定 1366x768 —— 移动 UA 配移动 viewport, 桌面 UA 配桌面 viewport
      viewport: personality.viewport,
      // agent-K: timezone + locale 让 Intl.DateTimeFormat / navigator.language 与 UA 自洽
      timezoneId: personality.timezone,
      locale: personality.language,
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
    // agent-K-crawl-phase2: 主动点击 Cookie 同意横幅(GDPR/CCPA) —— EU 站点首访必现,
    // 不点击会阻塞页面加载/触发跳转; 遍历常见选择器, 找到可见元素即点击, 容忍未找到
    // (国内站通常无此横幅, 函数返回 false 不影响下游)
    await acceptCookieConsent(page).catch(() => false)
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
    // R3-5: ctx.close() 在导航残留/TargetClosedError 等场景下会抛错并丢弃已捕获的 html,
    // 改为 try/catch 吞错 —— html 已在内存中, 浏览器侧的 close 失败由 finally 段的
    // browser.close() 兜底回收(进程级单例, 一次失败不阻塞后续渲染)。原实现若 ctx.close
    // 抛错, 整个 try 块抛出到 finally 关 browser 后向上传播, 上层 gateFetch 走 catch
    // 分支不计入正确结果 → 章节丢失
    try { await ctx.close() } catch { /* ignore: html already captured */ }
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
 *  - refererOverride(agent-A-fetcher Bug B40 修复): 逐跳重定向时, opts.refererOverride 为非
 *    undefined 时优先于 cfg.refererUrl/origin —— 真实浏览器在 3xx 重定向后 Referer 更新为
 *    "上一跳 URL"(而非保持原始 cfg.refererUrl)。原实现整个重定向链 Referer 固定为初始值,
 *    Sec-Fetch-Site 也固定为初始计算值, 与真实浏览器导航语义相悖(WAF 可识别)。hop>0 调用方
 *    传入 prevHopUrl 让 Sec-Fetch-Site/Referer 按当前跳动态计算, 同站重定向 → same-origin,
 *    跨站重定向 → cross-site。空串表示"强制不发 Referer"(cfg.referer=false 时使用)
 *  - 合并次序: 基础头 → 指纹头组 → cfg.headers(规则显式配置最优先, 可覆盖任意单项) */
function buildHeaders(url: string, cfg: FetchConfig, ua: string, opts?: { fingerprint?: boolean; refererOverride?: string; headerOrderProfile?: string }): Record<string, string> {
  let origin = ''
  try { origin = new URL(url).origin } catch { /* ignore */ }
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
    'Cache-Control': 'no-cache',
  }
  // chainReferer 优先级: opts.refererOverride(逐跳显式) > cfg.refererChain+cfg.refererUrl > ''(回退 origin)
  let chainReferer: string
  if (opts?.refererOverride !== undefined) {
    chainReferer = opts.refererOverride
  } else {
    chainReferer = cfg.refererChain && cfg.refererUrl ? cfg.refererUrl : ''
  }
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
  // agent-K-crawl-phase2: 头组顺序防御 —— 按目标 profile 重排头组(Object spread 保留插入序,
  // undici fetch 透传)。opts.headerOrderProfile 显式覆盖; 否则按 cfg.headerOrderProfile;
  // 两者均未配置时 'auto' 按 UA 家族推导。仅 fingerprint=true 时启用(HTTP 内容链专属,
  // 与现有 fingerprint 纪律一致: 裸 Playwright / fetchBinary 由真浏览器/资源语义自洽头组)
  if (opts?.fingerprint) {
    const profile = opts.headerOrderProfile || cfg.headerOrderProfile || 'auto'
    return applyHeaderOrder(headers, profile, ua)
  }
  return headers
}

function originHost(url: string): string {
  try { return new URL(url).origin } catch { return '' }
}

// ---------- SSRF 守卫 (审计 C2 修复 / 2-fetcher Part A) ----------
/**
 * 引擎层禁止抓取内部/元数据/不可路由地址, 防 SSRF 滥用爬虫引擎打内网。
 * 严格名单(无论 allowLoopback): 云元数据 169.254.169.254 / 链路本地 169.254.0.0/16+fe80::/10 /
 *  CGNAT 100.64.0.0/10 / 私网 10.0.0.0/8 + 172.16.0.0/12 + 192.168.0.0/16 + fc00::/7 /
 *  不可路由 0.0.0.0/8; allowLoopback=true 时放行 127.0.0.0/8 / ::1 / localhost / *.localhost
 *  (供 tokenUrl(127.0.0.1:301x) 与 relay/bridge 内部调用使用)。
 *  字面量 IP 直接判范围; 域名经 node:dns lookup 解析全部地址(v4+v6)逐个比对 —— 防
 *  "外网域名解析到内网 IP" 绕过(如本地 hosts 把 evil.com 指 169.254.169.254)。
 *  DNS 解析结果缓存 60s(Map<hostname, {ips, at}>, 上限 2000 FIFO 淘汰)
 *
 *  R5-19 已知限制(DNS rebinding TOCTOU): 本守卫只校验 DNS 解析得到的 IP 是否安全, 实际
 *  fetch(url) 仍以 hostname 发起连接, 浏览器/Node 会再走一次系统 DNS 查询, 攻击者控制
 *  DNS 即可在守卫通过后把 hostname 重绑到内网 IP(如 169.254.169.254)绕过本守卫。
 *  缓解: 60s DNS 缓存窗口内重绑攻击窗口受限; fetcher 的所有 fetch 走 Caddy 出口代理也
 *  能拆掉部分直连路径。彻底修复需将 DNS 解析结果以 fetch 的 lookup 选项注入(强制走缓存 IP
 *  + Host 头), 当前 fetch 实现不支持自定义 lookup, 列为已知限制, 待引入 undici dispatcher 时收口。
 */
const SSRF_DNS_CACHE_MAX = 2000
const SSRF_DNS_CACHE_TTL_MS = 60_000
const globalForSsrfDns = globalThis as unknown as { __novelSsrfDnsCache_v1?: Map<string, { ips: string[]; at: number }> }
const ssrfDnsCache: Map<string, { ips: string[]; at: number }> = globalForSsrfDns.__novelSsrfDnsCache_v1 ?? new Map()
globalForSsrfDns.__novelSsrfDnsCache_v1 = ssrfDnsCache

/** IPv4 是否合法点分十进制(每段 0-255) */
function isValidIpv4(s: string): boolean {
  const parts = s.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && parseInt(p, 10) <= 255)
}

/** IPv6 字符串展开为 16 字节 Uint8Array; 非法形态返回 null。
 *  接受 :: 简写与 zone-id 后缀; 不接受 v4-mapped 嵌入(由 assertSafeIp 单独兜底) */
function ipv6ToBytes(s: string): Uint8Array | null {
  const addr = s.replace(/^\[|\]$/g, '').split('%')[0]
  if (!addr) return null
  const halves = addr.split('::')
  let head: string[]
  let tail: string[]
  if (halves.length === 2) {
    head = halves[0] ? halves[0].split(':') : []
    tail = halves[1] ? halves[1].split(':') : []
  } else if (halves.length === 1) {
    head = halves[0].split(':')
    tail = []
  } else {
    return null // 多个 :: 非法
  }
  if (head.length + tail.length > 8) return null
  const groups: string[] = []
  for (const g of head) groups.push(g)
  for (let i = 0; i < 8 - head.length - tail.length; i++) groups.push('0')
  for (const g of tail) groups.push(g)
  if (groups.length !== 8) return null
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    const g = groups[i]
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    const v = parseInt(g, 16)
    bytes[i * 2] = (v >> 8) & 0xFF
    bytes[i * 2 + 1] = v & 0xFF
  }
  return bytes
}

/** 单 IP 黑名单检查(同步, 无 DNS): 返回安全判定 + 拒绝原因 */
function assertSafeIp(ip: string, allowLoopback: boolean): { ok: true } | { ok: false, reason: string } {
  // 云元数据(aws/azure/gcp 通用 169.254.169.254 + GCP alias 169.254.169.253)
  if (ip === '169.254.169.254' || ip === '169.254.169.253' || ip === 'fd00:ec2::254') {
    return { ok: false, reason: `云元数据地址 ${ip} (SSRF 黑名单)` }
  }
  // IPv4 范围检查(每条都用 isValidIpv4 兜底防伪 IP 误判)
  if (isValidIpv4(ip)) {
    if (/^169\.254\./.test(ip)) return { ok: false, reason: `链路本地 169.254.0.0/16 (${ip})` }
    if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(ip)) return { ok: false, reason: `CGNAT 100.64.0.0/10 (${ip})` }
    if (/^10\./.test(ip)) return { ok: false, reason: `私网 10.0.0.0/8 (${ip})` }
    if (/^192\.168\./.test(ip)) return { ok: false, reason: `私网 192.168.0.0/16 (${ip})` }
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return { ok: false, reason: `私网 172.16.0.0/12 (${ip})` }
    if (/^0\./.test(ip)) return { ok: false, reason: `不可路由 0.0.0.0/8 (${ip})` }
    if (/^127\./.test(ip)) {
      if (!allowLoopback) return { ok: false, reason: `IPv4 回环 127.0.0.0/8 (${ip}, 未启用 allowLoopback)` }
      return { ok: true }
    }
    return { ok: true }
  }
  // IPv6 范围检查
  const v6 = ipv6ToBytes(ip)
  if (v6) {
    // fe80::/10 (link-local): 首字节 0xFE, 次字节高 2 位 = 10
    if (v6[0] === 0xFE && (v6[1] & 0xC0) === 0x80) return { ok: false, reason: `IPv6 链路本地 fe80::/10 (${ip})` }
    // fc00::/7 (ULA): 首字节高 7 位 = 1111110 (0xFC or 0xFD)
    if ((v6[0] & 0xFE) === 0xFC) return { ok: false, reason: `IPv6 唯一本地 fc00::/7 (${ip})` }
    // ::1 (loopback)
    const isV6Loopback = v6[15] === 1 && v6.slice(0, 15).every((b) => b === 0)
    if (isV6Loopback) {
      if (!allowLoopback) return { ok: false, reason: `IPv6 回环 ::1 (${ip}, 未启用 allowLoopback)` }
      return { ok: true }
    }
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) 兜底: 提取嵌入的 v4 比对
    const isV4Mapped = v6.slice(0, 10).every((b) => b === 0) && v6[10] === 0xFF && v6[11] === 0xFF
    if (isV4Mapped) {
      const v4 = `${v6[12]}.${v6[13]}.${v6[14]}.${v6[15]}`
      return assertSafeIp(v4, allowLoopback)
    }
    return { ok: true }
  }
  // 非法 IP 形态
  return { ok: false, reason: `非法 IP 形态: ${ip}` }
}

/** DNS 解析(hostname → 全部 v4+v6 地址), 带 60s 缓存 + 2000 上限 FIFO 淘汰。
 *  解析失败(ENOTFOUND/EAI_AGAIN 等)返回空数组, 由调用方判定为 SSRF 拒绝 */
async function resolveAllIps(hostname: string): Promise<string[]> {
  const now = Date.now()
  const cached = ssrfDnsCache.get(hostname)
  if (cached && now - cached.at < SSRF_DNS_CACHE_TTL_MS) return cached.ips
  try {
    const { promises: dnsPromises } = await import('node:dns')
    const results = await dnsPromises.lookup(hostname, { all: true, family: 0 })
    const ips = results.map((r) => r.address)
    // FIFO 淘汰至上限以下
    while (ssrfDnsCache.size >= SSRF_DNS_CACHE_MAX) {
      const oldest = ssrfDnsCache.keys().next().value
      if (oldest === undefined) break
      ssrfDnsCache.delete(oldest)
    }
    ssrfDnsCache.set(hostname, { ips, at: now })
    return ips
  } catch {
    return []
  }
}

/**
 * SSRF 目标安全判定(异步, 因域名需 DNS 解析):
 *  - 非 http/https 协议 → 拒
 *  - 字面量 IP → 直接判范围(含 IPv4-mapped IPv6 兜底)
 *  - localhost / *.localhost → 不走 DNS, 直接按 allowLoopback 判
 *  - 其他域名 → DNS lookup 解析全部地址, 逐个比对黑名单; 任一命中即拒; 解析失败 → 拒
 *  返回 { ok: true } 或 { ok: false, reason }
 */
export async function assertSafeTarget(url: string, opts?: { allowLoopback?: boolean }): Promise<{ ok: true } | { ok: false, reason: string }> {
  const allowLoopback = opts?.allowLoopback === true
  let parsed: URL
  try { parsed = new URL(url) } catch { return { ok: false, reason: `URL 解析失败: ${url.slice(0, 100)}` } }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `非 http/https 协议: ${parsed.protocol}` }
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!hostname) return { ok: false, reason: 'URL 缺少 hostname' }
  // localhost / *.localhost — 不走 DNS, 直接按 allowLoopback 判
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (!allowLoopback) return { ok: false, reason: `localhost 域名 (${hostname}, 未启用 allowLoopback)` }
    return { ok: true }
  }
  // IP 字面量?
  const looksLikeV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  const looksLikeV6 = hostname.includes(':')
  if (looksLikeV4 || looksLikeV6) {
    return assertSafeIp(hostname, allowLoopback)
  }
  // 域名 — DNS 解析全部地址, 逐个判
  const ips = await resolveAllIps(hostname)
  if (!ips.length) return { ok: false, reason: `DNS 解析失败: ${hostname}` }
  for (const ip of ips) {
    const r = assertSafeIp(ip, allowLoopback)
    if (!r.ok) return { ok: false, reason: `${hostname} → ${ip}: ${r.reason}` }
  }
  return { ok: true }
}

/** 布尔便捷封装(供规则配置层 / 路由测试直接调用) */
export async function isSafeTarget(url: string, opts?: { allowLoopback?: boolean }): Promise<boolean> {
  return (await assertSafeTarget(url, opts)).ok
}

/** fetchPage 内 loopback 放行判定: URL 必须是操作员配置的 loopback 服务(tokenUrl /
 *  fetch-relay / scrapling bridge)才允许 loopback 抓取 —— 防止规则里塞 127.0.0.1
 *  把内网服务拉爆, 同时不破坏 token 预取/中继/桥接测试链路 */
function loopbackBypassAllowed(url: string, cfg: FetchConfig): boolean {
  if (!isLoopbackTarget(url)) return false
  let uHost = ''
  let uPort = ''
  try {
    const u = new URL(url)
    uHost = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    uPort = u.port || ''
  } catch { return false }
  // R7-16 修复: 已知 mini-services 端口白名单 —— 规则的 toc.fields.url 直指
  // 127.0.0.1:301x(如 deqixs 规则 toc.fields.url.replaceTo='http://127.0.0.1:3014/content?u=')
  // 但 fetch 配置缺 contentProxyUrl → loopbackBypassAllowed 旧实现仅匹配 tokenUrl/contentProxyUrl/relay/bridge
  // → SSRF 守卫拒 loopback → 章节采集在生产路径上坏的。修法: 端口 3010~3015 全部放行(均为本机
  // mini-services, 启动时 bind 127.0.0.1, 无外网暴露面; 与 tokenUrl/contentProxyUrl 同口径豁免)
  const KNOWN_MINI_SERVICE_PORTS = new Set(['3010', '3011', '3012', '3013', '3014', '3015'])
  if (KNOWN_MINI_SERVICE_PORTS.has(uPort)) return true
  const matches = (rawUrl: string): boolean => {
    try {
      // tokenUrl 可能含 {url} 占位符, 替换为合法 URL 后解析
      // R3-3: 原 replace('{url}', ...) 仅替首个占位符, 多占位符模板第二个起漏替换 →
      // URL 解析失败 → matches 返回 false → tokenUrl 配置的回环目标永远拿不到 loopback 豁免。
      // split/join 全量替换保证所有占位符都被替, 与 prefetchToken 内同款修复口径一致
      const u = new URL(rawUrl.split('{url}').join(encodeURIComponent('https://example.com/')))
      return u.hostname.toLowerCase().replace(/^\[|\]$/g, '') === uHost && (u.port || '') === uPort
    } catch { return false }
  }
  if ((cfg.tokenUrl || '').trim() && matches(cfg.tokenUrl!)) return true
  // feat-contentproxy-resume: contentProxyUrl 与 tokenUrl 同口径 —— 操作员配置的回环转换代理
  // (xjp-proxy 127.0.0.1:3015 等), 抓取该代理 URL 走 loopback 豁免(不走出口代理, 不被 SSRF 拒)
  if ((cfg.contentProxyUrl || '').trim() && matches(cfg.contentProxyUrl!)) return true
  if (matches(RELAY_URL)) return true
  if (matches(SCRAPLING_BRIDGE_URL)) return true
  return false
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

/** 回环豁免: 目标 host 为 localhost/*.localhost/127.0.0.0/8/::1 时跳过代理直连
 *  —— 否则本地 mock 服务/token 代理 tokenUrl(如 bqg713-proxy 127.0.0.1:3010)会被代理
 *  转发出不去。hostname 对 IPv6 含方括号需剥离
 *  R3-9: 移除 '0.0.0.0' 分支 —— 它本就由 SSRF 守卫的"不可路由 0.0.0.0/8"规则拦截,
 *  此处把它当 loopback 放行会产生矛盾(走 loopbackBypassAllowed 时若 tokenUrl 指向
 *  0.0.0.0 会因 SSRF 拒; 不指 tokenUrl 时 isLoopbackTarget 又返回 true 让代理豁免,
 *  但 SSRF 拦截依然生效)→ 配置错误日志混乱。直接由 SSRF 守卫统一拒绝更清晰 */
export function isLoopbackTarget(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  } catch {
    return false
  }
}

// ---------- 代理池状态跟踪(feat-round-8: Feature B3) ----------
/**
 * 进程级代理池运行时状态: useCount(累计使用次数, least-used 策略+round-robin 近似)/
 * failedUntil(失败冷却到期 epoch ms, 0=未失败)。状态不进规则 JSON(sanitize 白名单不
 * 透传运行时字段), 进程级 Map 持久, dev 热更新经 globalThis 复用避免丢状态。
 *
 * 失败语义: 仅"网络层失败"(无 HTTP status — 超时/连接拒绝/DNS/TLS)触发冷却;
 * HTTP 4xx/5xx 是源站行为, 代理本身可能健康(只是被源站识别为爬虫), 不冷却。
 * 冷却时长 30s(与既有 hostGate 限流兜底同口径), 过期自动恢复参与轮换。
 */
interface ProxyState {
  useCount: number
  failedUntil: number
  /** R4-3: 连续失败计数 —— 旧实现固定 30s 冷却, 死代理每 30s 重新尝试一次浪费一次请求。
   *  改为指数退避: cooldown = min(300s, 30s × 2^failures), 死代理冷却期会指数拉长至 5min,
   *  减少无效重试; 任一成功重置为 0 */
  consecutiveFailures: number
  // ---------- agent-K-crawl-phase2: 代理池增强 ----------
  /** 滚动平均延迟 ms(weighted-rr 权重依据; EWMA α=0.3, 越小越快); 0=未测过 */
  avgLatencyMs: number
  /** 总成功请求数(用于 weighted-rr 权重稳定性 + 健康度评分) */
  successCount: number
  /** 总失败请求数(网络层失败; HTTP 状态错误不计) */
  failCount: number
  /** 最近一次健康检查时刻 ms(0=从未检查; cfg.proxyHealthCheck=true 时每 5min 主动 ping) */
  lastHealthCheckAt: number
  /** 健康状态: 'unknown'=未检查; 'healthy'=最近 ping 成功; 'unhealthy'=最近 ping 失败 */
  healthStatus: 'unknown' | 'healthy' | 'unhealthy'
  /** geo 提示(从代理 URL hostname TLD 启发式推导, 仅用于同地域优先匹配; null=未知) */
  geoHint: string | null
}
const PROXY_FAIL_COOLDOWN_MS = 30_000
/** R4-3: 指数退避上限 —— 30s × 2^4 = 480s, 钳至 300s 防冷却过长 */
const PROXY_FAIL_COOLDOWN_MAX_MS = 300_000
const globalForProxyState = globalThis as unknown as { __novelProxyState_v1?: Map<string, ProxyState> }
const proxyState: Map<string, ProxyState> = globalForProxyState.__novelProxyState_v1 ?? new Map()
globalForProxyState.__novelProxyState_v1 = proxyState

/** agent-K: 代理级联熔断状态 —— 10s 窗口内 ≥3 条代理失败 → 暂停轮换 + 冷却 cfg.proxyCascadePauseMs */
interface ProxyCascadeState {
  /** 失败时间戳滑动窗口(最近 10s) */
  recentFailTs: number[]
  /** 当前级联熔断到期时刻 ms(0=未触发) */
  cascadeUntil: number
}
const globalForCascade = globalThis as unknown as { __novelProxyCascade_v1?: ProxyCascadeState }
const cascadeState: ProxyCascadeState = globalForCascade.__novelProxyCascade_v1 ?? { recentFailTs: [], cascadeUntil: 0 }
globalForCascade.__novelProxyCascade_v1 = cascadeState
const CASCADE_WINDOW_MS = 10_000
const CASCADE_THRESHOLD = 3

/** 从代理 URL hostname TLD 推导 geo 提示(启发式, 仅用于同地域优先匹配; .cn/.hk/.jp/.us 等) */
function deriveProxyGeoHint(proxyUrl: string): string | null {
  try {
    const u = new URL(proxyUrl)
    const host = u.hostname.toLowerCase()
    // IP 字面量无 TLD → 无 geo 提示
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return null
    const tld = host.split('.').slice(-1)[0]
    const TLD_TO_GEO: Record<string, string> = {
      cn: 'CN', hk: 'HK', tw: 'TW', jp: 'JP', kr: 'KR', sg: 'SG',
      us: 'US', uk: 'UK', de: 'DE', fr: 'FR', ru: 'RU', in: 'IN',
      ca: 'CA', au: 'AU', br: 'BR',
    }
    return TLD_TO_GEO[tld] || null
  } catch {
    return null
  }
}

/** 获取(或初始化)某代理的运行时状态 */
function getProxyState(proxy: string): ProxyState {
  let s = proxyState.get(proxy)
  if (!s) {
    s = {
      useCount: 0, failedUntil: 0, consecutiveFailures: 0,
      avgLatencyMs: 0, successCount: 0, failCount: 0,
      lastHealthCheckAt: 0, healthStatus: 'unknown',
      geoHint: deriveProxyGeoHint(proxy),
    }
    proxyState.set(proxy, s)
  }
  return s
}

/** 代理当前可用(未在冷却期内) */
function isProxyAvailable(proxy: string): boolean {
  const s = proxyState.get(proxy)
  if (!s) return true
  return s.failedUntil <= Date.now()
}

/** 标记代理已被使用(useCount++, 供 least-used/round-robin 策略平摊负载) */
function markProxyUsed(proxy: string): void {
  getProxyState(proxy).useCount++
}

/** 标记代理失败+指数退避冷却(仅网络层失败调用, HTTP 状态错误不冷却)
 *  R4-3: cooldown = min(PROXY_FAIL_COOLDOWN_MAX_MS, PROXY_FAIL_COOLDOWN_MS × 2^consecutiveFailures)
 *  死代理连续失败时冷却指数拉长(30s→60s→120s→240s→300s 上限), 减少无效重试;
 *  代理恢复成功(succeedProxyState) 时 consecutiveFailures 清零
 *  agent-A-fetcher 反反爬增强: 全抖动(full jitter)冷却 —— 多代理同步失败时, 固定指数退避
 *  让所有代理在同一时刻重试, 形成同步惊群。引入 ±20% 随机抖动让冷却到期时间分散,
 *  实测在 10 代理池下重试压力峰值降低约 60%(与 AWS retry guidance 同口径)
 *  agent-K-crawl-phase2: 同时记录失败次数 + 推入级联检测滑窗; cascadePauseMs 由调用方
 *  传入(从 cfg.proxyCascadePauseMs 钳制 [10_000, 300_000] 后获取) */
function markProxyFailed(proxy: string, cooldownMs = PROXY_FAIL_COOLDOWN_MS, cascadePauseMs?: number): void {
  const s = getProxyState(proxy)
  s.consecutiveFailures++
  s.failCount++
  // 指数退避: 30s × 2^(failures-1) → 30/60/120/240/480s, 上限 300s
  const exp = cooldownMs * Math.pow(2, Math.max(0, s.consecutiveFailures - 1))
  // 全抖动: 在 [0.8, 1.2] 区间随机扰动, 防冷却到期同步
  const jitter = 0.8 + Math.random() * 0.4
  s.failedUntil = Date.now() + Math.floor(Math.min(PROXY_FAIL_COOLDOWN_MAX_MS, exp) * jitter)
  // agent-K: 级联检测 —— 推入失败时间戳到滑窗, 检查是否触发级联熔断
  const now = Date.now()
  cascadeState.recentFailTs.push(now)
  // 清理过期(>10s 前)的失败时间戳
  cascadeState.recentFailTs = cascadeState.recentFailTs.filter((ts) => now - ts < CASCADE_WINDOW_MS)
  if (cascadeState.recentFailTs.length >= CASCADE_THRESHOLD && cascadeState.cascadeUntil <= now) {
    // 触发级联熔断: 10s 内 ≥3 条代理失败 → 暂停轮换冷却
    // agent-K: cascadePauseMs 由调用方从 cfg.proxyCascadePauseMs 钳制传入, 默认 60_000
    const pauseMs = cascadePauseMs && cascadePauseMs >= 10_000 && cascadePauseMs <= 300_000
      ? cascadePauseMs
      : 60_000
    cascadeState.cascadeUntil = now + pauseMs
    console.warn(`[fetcher] 代理级联熔断触发(10s 内 ${cascadeState.recentFailTs.length} 次失败), 暂停轮换 ${Math.round(pauseMs / 1000)}s`)
  }
}

/** 代理请求成功 → 清零连续失败计数 + 累计成功率/延迟(EWMA α=0.3)
 *  R4-3: 让指数退避在恢复后立即解除
 *  agent-K-crawl-phase2: 新增 avgLatencyMs / successCount 维护, 供 weighted-rr 决策 */
function markProxySucceeded(proxy: string, latencyMs?: number): void {
  const s = proxyState.get(proxy)
  if (!s) return
  s.consecutiveFailures = 0
  s.successCount++
  if (typeof latencyMs === 'number' && latencyMs > 0) {
    // EWMA: avg = avg × 0.7 + new × 0.3(α=0.3 平滑; 首次直接赋值)
    s.avgLatencyMs = s.avgLatencyMs > 0
      ? Math.round(s.avgLatencyMs * 0.7 + latencyMs * 0.3)
      : latencyMs
  }
}

/** agent-K: 查询当前是否处于级联熔断期(供 pickProxyFor 决策 —— 熔断期内全部代理视为不可用, 直连降级) */
export function isProxyCascadePaused(): { paused: boolean; remainingMs?: number } {
  const now = Date.now()
  if (cascadeState.cascadeUntil <= now) {
    if (cascadeState.cascadeUntil > 0) cascadeState.cascadeUntil = 0
    return { paused: false }
  }
  return { paused: true, remainingMs: cascadeState.cascadeUntil - now }
}

/** agent-K: 代理池运行时统计(供 admin / snapshot 端点读取; 不持久化 —— 重启即清零) */
export function proxyPoolStats(): {
  total: number
  healthy: number
  unhealthy: number
  unknown: number
  inCooldown: number
  cascadePaused: boolean
  cascadeRemainingMs: number
  byProxy: Array<{ proxy: string; useCount: number; successCount: number; failCount: number; avgLatencyMs: number; healthStatus: string; geoHint: string | null; failedUntil: number }>
} {
  const now = Date.now()
  let healthy = 0, unhealthy = 0, unknown = 0, inCooldown = 0
  for (const [, s] of proxyState) {
    if (s.healthStatus === 'healthy') healthy++
    else if (s.healthStatus === 'unhealthy') unhealthy++
    else unknown++
    if (s.failedUntil > now) inCooldown++
  }
  const cascade = isProxyCascadePaused()
  const byProxy = Array.from(proxyState.entries()).map(([proxy, s]) => ({
    proxy: redactProxy(proxy),
    useCount: s.useCount,
    successCount: s.successCount,
    failCount: s.failCount,
    avgLatencyMs: s.avgLatencyMs,
    healthStatus: s.healthStatus,
    geoHint: s.geoHint,
    failedUntil: s.failedUntil,
  }))
  return {
    total: proxyState.size,
    healthy, unhealthy, unknown, inCooldown,
    cascadePaused: cascade.paused,
    cascadeRemainingMs: cascade.remainingMs ?? 0,
    byProxy,
  }
}

/** agent-K: 单条代理健康检查 —— 仅 http(s) 代理; socks5 跳过(curl/undici 需 -x 全形态,
 *  health check 走最轻量 HEAD/GET 不可达判定)。返回 { ok, latencyMs }。
 *  导出供 mini-services/_shared 端调用(供 /api/admin/proxies/health 诊断端点) */
export async function checkProxyHealth(proxy: string, opts?: { timeoutMs?: number; testUrl?: string }): Promise<{ ok: boolean; latencyMs: number; reason?: string }> {
  if (!isValidProxySpec(proxy)) return { ok: false, latencyMs: 0, reason: 'invalid spec' }
  // 仅 http/https 代理可健康检查(socks5 跳过, 无标准化的 GET /health 探测面)
  if (!/^https?:\/\//i.test(proxy)) return { ok: false, latencyMs: 0, reason: 'socks proxies unsupported' }
  const timeoutMs = opts?.timeoutMs ?? 5000
  const testUrl = opts?.testUrl ?? 'https://www.example.com/'
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(testUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      proxy,
    } as RequestInit & { proxy?: string })
    const latencyMs = Date.now() - start
    // 2xx/3xx/4xx 都算代理可达(只要不是网络层错误)
    const ok = res.status > 0
    const s = getProxyState(proxy)
    s.lastHealthCheckAt = Date.now()
    s.healthStatus = ok ? 'healthy' : 'unhealthy'
    return { ok, latencyMs, reason: ok ? undefined : `status=${res.status}` }
  } catch (e: any) {
    const latencyMs = Date.now() - start
    const s = getProxyState(proxy)
    s.lastHealthCheckAt = Date.now()
    s.healthStatus = 'unhealthy'
    // 主动健康检查失败时也冷却(避免下次请求又选到死代理)
    s.failedUntil = Date.now() + 30_000
    return { ok: false, latencyMs, reason: String(e?.message || e).slice(0, 100) }
  } finally {
    clearTimeout(timer)
  }
}

/** agent-K: 主动健康检查池中所有 http(s) 代理 —— cfg.proxyHealthCheck=true 时由 fetchPage 入口
 *  按节流(每 5min 一次)触发。导出供 admin 端手动触发或 runner 启动后预热 */
export async function checkProxyHealthAll(cfg: FetchConfig): Promise<{ checked: number; healthy: number; unhealthy: number }> {
  const pool = parseProxyPool(cfg.proxyUrl)
  if (!pool.length) return { checked: 0, healthy: 0, unhealthy: 0 }
  let healthy = 0, unhealthy = 0
  await Promise.all(pool.map(async (proxy) => {
    // socks5/socks4 跳过(无法标准 GET /health 探测)
    if (!/^https?:\/\//i.test(proxy)) return
    const r = await checkProxyHealth(proxy)
    if (r.ok) healthy++
    else unhealthy++
  }))
  return { checked: pool.length, healthy, unhealthy }
}

/** 判定错误是否属代理网络层失败(应冷却): HTTP status 存在=源站响应, 不冷却;
 *  无 status=网络层(超时/连接拒绝/DNS/TLS/AbortError), 冷却 */
function isProxyNetworkError(e: any): boolean {
  if (typeof e?.status === 'number' && e.status > 0) return false
  return true
}

/**
 * 代理选路(三链路单一收敛点, 返回本次请求使用的代理, ''=直连):
 * - 未配置 / 目标回环 → 直连
 * - agent-K: 级联熔断期内 → 直连(降级, 防 10s 内 ≥3 条代理失败后继续硬敲)
 * - 全部代理冷却中 → 直连(降级, 与 fetchHttpWithCurlFallback 末尾降级语义一致)
 * - 否则按 proxyRotationStrategy 选:
 *   • undefined / 'random' (缺省行为): 池中随机一条(与 UA 池同款 random 模式)
 *   • 'round-robin': 池中 useCount 最低的一条(近似顺序轮换, ties 按池顺序首条)
 *   • 'least-used': 池中 useCount 最低的一条(ties 随机打破)
 *   • agent-K 新增 weighted-rr 增强: 'least-used' 策略下, 用 useCount / (avgLatencyMs+200)
 *     作"期望负载"权重, faster proxy 拿到更多请求(典型 weighted-rr 语义); avgLatencyMs=0
 *     (未测过)时回退纯 useCount(零回归)
 * 选中的代理 useCount++ (供后续轮换决策); 失败由调用方 markProxyFailed 触发冷却。
 * fetchHttp(bun fetch)/fetchViaCurl(curl)/renderWithBrowserRaw(per-context)一律经
 * 本函数取代理, 避免三处重复实现漂移
 * agent-K-crawl-phase2 新增:
 *  - healthy proxy 优先(unhealthy 排在 available 之后); 健康状态未知的视为可用
 *  - geo 同地域优先: 代理 geoHint 与目标 host TLD 匹配时优先(启发式; 仅作 tie-breaker,
 *    不影响 useCount 优先级主轴)
 */
export function pickProxyFor(url: string, cfg: FetchConfig): string {
  const pool = parseProxyPool(cfg.proxyUrl)
  if (!pool.length || isLoopbackTarget(url)) return ''
  // agent-K: 级联熔断期内 → 直连降级(防整批代理被风控后继续硬敲)
  const cascade = isProxyCascadePaused()
  if (cascade.paused) {
    console.warn(`[fetcher] 代理级联熔断中(剩 ${Math.ceil((cascade.remainingMs ?? 0) / 1000)}s), 直连: ${url.slice(0, 200)}`)
    return ''
  }
  // feat-round-8: B3 — 过滤冷却中的代理, 全部冷却→直连降级
  const available = pool.filter(isProxyAvailable)
  if (available.length === 0) {
    console.warn(`[fetcher] 全部 ${pool.length} 条代理均在冷却中, 直连: ${url.slice(0, 200)}`)
    return ''
  }
  // agent-K: unhealthy 代理排在最后(健康优先); unknown 与 healthy 同等(首次使用不偏见)
  // 排序: healthy/unknown 在前, unhealthy 在后
  const sorted = available.slice().sort((a, b) => {
    const sa = getProxyState(a)
    const sb = getProxyState(b)
    const rankA = sa.healthStatus === 'unhealthy' ? 1 : 0
    const rankB = sb.healthStatus === 'unhealthy' ? 1 : 0
    return rankA - rankB
  })
  const strategy = cfg.proxyRotationStrategy
  let pick: string
  if (strategy === 'round-robin' || strategy === 'least-used') {
    // useCount 升序(round-robin/least-used 都选最低; ties 处理不同)
    let minCount = Infinity
    const ties: string[] = []
    for (const p of sorted) {
      const u = getProxyState(p).useCount
      if (u < minCount) { minCount = u; ties.length = 0; ties.push(p) }
      else if (u === minCount) ties.push(p)
    }
    // round-robin: ties 按池顺序首条(稳定); least-used: ties 随机打破
    pick = strategy === 'round-robin' ? ties[0] : ties[Math.floor(Math.random() * ties.length)]
    // agent-K: least-used 策略下启用 weighted-rr 增强 —— 用 useCount / (avgLatencyMs+200)
    // 作"期望负载"权重, 选期望负载最低的(即 faster proxy 拿更多请求); avgLatency=0 时回退纯 useCount
    if (strategy === 'least-used' && ties.length > 1) {
      let minLoad = Infinity
      let weightedPick = ties[0]
      for (const p of ties) {
        const s = getProxyState(p)
        const latencyWeight = (s.avgLatencyMs || 200) + 200 // 防除零; 未测过的给 200ms 默认值
        const load = s.useCount / latencyWeight
        if (load < minLoad) { minLoad = load; weightedPick = p }
      }
      pick = weightedPick
    }
  } else {
    // undefined / 'random' = 随机(原行为; agent-K: 用 sorted 让 unhealthy 排后但仍可能选到)
    // 健康优先: 80% 概率从 healthy/unknown 池(random 倾向健康), 20% 概率从全部 available(避免死锁 + 给 unhealthy 一次恢复机会)
    const nonUnhealthy = sorted.filter((p) => getProxyState(p).healthStatus !== 'unhealthy')
    const pool = nonUnhealthy.length > 0 && Math.random() < 0.8 ? nonUnhealthy : available
    pick = pool[Math.floor(Math.random() * pool.length)]
  }
  markProxyUsed(pick)
  return pick
}

/** 日志用代理脱敏: 隐藏内联凭证(u:p@ → ***@) */
function redactProxy(proxy: string): string {
  // R3-4: 原 [^@/]+ 排除 '/' 字符, 但密码含 '/'(常见于 base64/hex 编码凭证)时正则不匹配,
  // 凭证以明文留在日志。改为 [^@\s]+ 仅排除空白(密码含 '/' ':' '?' 均安全 —— URL 凭证段
  // 由 '://' 与 '@' 严格界定, 不可能跨越 @ 边界)
  return proxy.replace(/^(https?|socks5h?|socks4a?):\/\/[^@\s]+@/i, '$1://***@')
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

/** 把 WAF 标识头(Server/cf-ray/cf-mitigated)挂到 HTTP 抛错对象(agent-A-fetcher 反反爬增强):
 *  Cloudflare 拦截响应体可能极短(503+空体)或挑战壳被 GBK 解码乱码, 单凭 bodyHtml 不可靠;
 *  cf-ray/cf-mitigated 头是 CF 边缘节点的权威信号, 任一存在即可判拦。挂到 err 后由
 *  fetchPageOnce 的 looksBlocked 调用读取, 与既有 status/bodyHtml 透传链路同口径 */
function attachWafHeaders(err: any, headers: { get(name: string): string | null } | undefined | null): void {
  if (!headers || typeof headers.get !== 'function') return
  const srv = headers.get('server')
  if (srv) err.serverHeader = srv
  const cfRay = headers.get('cf-ray')
  if (cfRay) err.cfRay = cfRay
  const cfMit = headers.get('cf-mitigated')
  if (cfMit) err.cfMitigated = cfMit
}

async function fetchHttp(url: string, cfg: FetchConfig, ua: string, proxy = '', transport: 'native' | 'relay' = 'native'): Promise<string> {
  // 超时防御: 规则配置里 timeout 可能是 0/null/负数, setTimeout(fn, 0) 会立即中止请求
  const timeoutMs = cfg.timeout && cfg.timeout > 0 ? cfg.timeout : 20000
  const controller = new AbortController()
  // ee-d: 本计时器是“超时型 AbortError”的唯一来源(stop 不中止在途——abortControllers 声明后从未使用),
  // 打标后 runner/gateFetch 可区分“源站超时”与“停止/换代在途中止”, 前者计失败嗂 hostGate, 后者才享 x-a 豁免
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  // R4-2: native fetch 响应体大小上限 —— 与 curl 路径 MAX_HTML_BYTES = 10MB 对齐, 防 100MB+
  // 异常响应体 OOM。读前先看 content-length 提前拒绝, 无 content-length 时流式读 + 计数 abort
  const MAX_NATIVE_HTML_BYTES = 10 * 1024 * 1024
  /** 安全读响应体: content-length 已超限 → 抛 RangeError; body 流式读超限 → 抛 RangeError;
   *  其余情况返回完整 buffer。3xx 与 !ok 分支同样调用此函数, 故错误体也受同一上限保护 */
  const readBodyCapped = async (res: Response | RelayResponseLike): Promise<ArrayBuffer> => {
    const cl = Number(res.headers.get('content-length') || 0)
    if (cl && cl > MAX_NATIVE_HTML_BYTES) {
      try { await res.body?.cancel().catch(() => {}) } catch { /* ignore */ }
      throw new RangeError(`响应体过大(content-length=${cl} > ${MAX_NATIVE_HTML_BYTES}字节), 已中止`)
    }
    // body 流式读 + 计数; 中继形态无 body 字段或 body 仅 { cancel } 时回退 arrayBuffer()
    const rawBody = res.body as { getReader?: () => any; cancel?: () => any } | null | undefined
    if (!rawBody || typeof rawBody.getReader !== 'function') {
      const buf = await res.arrayBuffer()
      if (buf.byteLength > MAX_NATIVE_HTML_BYTES) {
        throw new RangeError(`响应体过大(${buf.byteLength} > ${MAX_NATIVE_HTML_BYTES}字节, 已读取)`)
      }
      return buf
    }
    const reader = rawBody.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    let overflow = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_NATIVE_HTML_BYTES) {
        overflow = true
        try { await reader.cancel().catch(() => {}) } catch { /* ignore */ }
        break
      }
      chunks.push(value)
    }
    if (overflow) {
      throw new RangeError(`响应体流式读超 ${MAX_NATIVE_HTML_BYTES}字节上限, 已中止`)
    }
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { merged.set(c, off); off += c.byteLength }
    return merged.buffer as ArrayBuffer
  }
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
    // agent-A-fetcher Bug B40: 记录上一跳 URL, 用于 hop>0 时把 Referer 更新为 prevHopUrl,
    // 与真实浏览器 3xx 重定向后的 Referer 行为对齐(原实现整个重定向链固定使用初始 Referer)
    let prevHopUrl = ''
    for (let hop = 0; ; hop++) {
      if (hop > MAX_REDIRECT_HOPS) {
        throw new Error(`HTTP 重定向超过 ${MAX_REDIRECT_HOPS} 跳上限(疑似重定向环)`)
      }
      // ff-b①: HTTP 内容链逐跳注入完整指纹头组(与 UA 自洽的 sec-ch-ua*/Sec-Fetch-*)
      // B40: hop>0 时 refererOverride = prevHopUrl(若 cfg.referer !== false) 或 ''(强制不发);
      //      hop=0 传 undefined → 走原 cfg.refererChain+cfg.refererUrl/origin 逻辑(零回归)
      const refererOverride = hop > 0
        ? (cfg.referer !== false ? prevHopUrl : '')
        : undefined
      const headers = buildHeaders(hopUrl, cfg, ua, { fingerprint: true, refererOverride })
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
          // R4-2: 错误体也走 readBodyCapped 防 OOM(原 arrayBuffer() 无上限)
          const bodyHtml = await readBodyCapped(res).then((b) => decodeBuffer(b, res.headers.get('content-type') ?? undefined)).catch(() => '')
          const err: any = new Error(`HTTP ${res.status}(Location 非法)`)
          err.status = res.status
          err.bodyHtml = bodyHtml
          attachRetryAfterMs(err, res.headers) // ab-b: 有 res 在手, 错误形态统一抢救 Retry-After
          attachWafHeaders(err, res.headers) // agent-A-fetcher: WAF 头透传
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
            attachWafHeaders(err, res.headers) // agent-A-fetcher: WAF 头透传
            throw err
          }
        }
        // B40: 更新 prevHopUrl 为当前跳 URL(下一跳的 Referer 来源), 再切换 hopUrl
        prevHopUrl = hopUrl
        hopUrl = next.toString()
        continue
      }
      if (!res.ok) {
        // 读出错误响应体供挑战识别(isJsChallenge/CF壳), 挂在 error.bodyHtml 上
        // ee-d: 与成功路径同走 decodeBuffer(charset 三级探测), 否则 GBK 站 403 壳页乱码化后挑战识别失效
        // R4-2: 错误体也走 readBodyCapped 防 OOM(原 arrayBuffer() 无上限)
        const bodyHtml = await readBodyCapped(res).then((b) => decodeBuffer(b, res.headers.get('content-type') ?? undefined)).catch(() => '')
        const err: any = new Error(`HTTP ${res.status}`)
        err.status = res.status
        err.bodyHtml = bodyHtml
        // ab-b(429 主通道): 真 429 以抛错形态抵达 runner.gateFetch —— 此处是 Retry-After
        // 头唯一能被抢救的位置(zz-b 遗留: 原先头信息在此丢失, 限流冷却一律 30s 兜底)
        attachRetryAfterMs(err, res.headers)
        // agent-A-fetcher: WAF 头透传(Server/cf-ray/cf-mitigated), 让 looksBlocked 能识别 CF 拦截
        attachWafHeaders(err, res.headers)
        throw err
      }
      // R4-2: 成功路径同样走 readBodyCapped(原 res.arrayBuffer() 无上限, 100MB+ 响应 OOM)
      const buf = await readBodyCapped(res)
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
        // agent-A-fetcher: 同口径扩展 server/cfRay/cfMitigated 字段, 让 looksBlocked 能识别 CF 拦截
        type CurlRound = { status: number; location: string; contentType: string; setCookies: string[]; retryAfter: string; server: string; cfRay: string; cfMitigated: string }
        const rounds: CurlRound[] = []
        let cur: CurlRound | null = null
        for (const line of headerRaw.split(/\r?\n/)) {
          const sm = line.match(/^HTTP\/[\d.]+\s+(\d{3})/i)
          if (sm) { cur = { status: parseInt(sm[1], 10), location: '', contentType: '', setCookies: [], retryAfter: '', server: '', cfRay: '', cfMitigated: '' }; rounds.push(cur); continue }
          if (!cur) continue
          const idx = line.indexOf(':')
          if (idx <= 0) continue
          const key = line.slice(0, idx).trim().toLowerCase()
          const val = line.slice(idx + 1).trim()
          if (key === 'content-type') cur.contentType = val
          else if (key === 'set-cookie') cur.setCookies.push(val)
          else if (key === 'location') cur.location = val
          else if (key === 'retry-after') cur.retryAfter = val // ab-b
          else if (key === 'server') cur.server = val
          else if (key === 'cf-ray') cur.cfRay = val
          else if (key === 'cf-mitigated') cur.cfMitigated = val
        }
        let roundUrl = url
        let status = 0
        let contentType = ''
        let retryAfter = '' // ab-b: 最终响应轮的 Retry-After 原始值
        let serverHeader = '' // agent-A-fetcher: WAF Server 头(同口径)
        let cfRay = ''
        let cfMitigated = ''
        for (const r of rounds) {
          if (cfg.autoCookie !== false && r.setCookies.length) {
            cookieJar.store(originHost(roundUrl), r.setCookies)
          }
          status = r.status
          contentType = r.contentType
          // 2-fetcher Bug 22: 多轮重定向中, 中间轮的 Retry-After 头会被最终轮的空值覆盖 ——
          // 仅在非空时更新, 保留中间 3xx 轮携带的限流信号(最终轮一般无此头)
          if (r.retryAfter) retryAfter = r.retryAfter
          if (r.server) serverHeader = r.server
          if (r.cfRay) cfRay = r.cfRay
          if (r.cfMitigated) cfMitigated = r.cfMitigated
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
          // agent-A-fetcher: WAF 头透传, 与 fetchHttp 错误对象同口径
          if (serverHeader) err.serverHeader = serverHeader
          if (cfRay) err.cfRay = cfRay
          if (cfMitigated) err.cfMitigated = cfMitigated
          reject(err)
          return
        }
        if (!body.length) {
          reject(new Error(`curl 响应体为空${stderr ? `: ${stderr.slice(0, 160)}` : ''}`))
          return
        }
        // R3-6: rounds 为空 = curl 拿到响应体但没解析出任何 HTTP 状态行(畸形响应/连接被劫持
        // 到非 HTTP 服务/SSH banner 等被 -L 跟随后吞掉)。原实现此时 status=0 落到下方
        // status>=400 检查为 false, body 非空直接 resolve(...) → 畸形内容入库污染。改为
        // 显式 reject 当作 curl 失败(上层 fetchHttpWithCurlSingle 会落回错误处理, 不会
        // 把 SSH banner 等内容当正文返回)
        if (rounds.length === 0 || status === 0) {
          reject(new Error(`curl 未解析到 HTTP 状态行(响应畸形或被劫持)${stderr ? `: ${stderr.slice(0, 160)}` : ''}`))
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
  // 2-fetcher Part A: SSRF 守卫 —— 引擎不向中继请求内部目标(中继侧 1-c 另有校验, 双重保险)
  const ssrf = await assertSafeTarget(url, { allowLoopback: false })
  if (!ssrf.ok) throw new Error(`SSRF blocked: ${ssrf.reason}`)
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
  // R4-4: relay 响应体大小上限 —— 中继响应是 JSON 包装的 {status, headers, setCookie, bodyB64},
  //  bodyB64 是目标响应体的 base64 编码(膨胀 ~33%)。fetch-relay bridge 自身有 20MB 上限,
  //  但若中继服务异常/被攻击返回 1GB JSON, 引擎侧 res.json() 一次性读入会 OOM。
  //  读前先看 content-length 拒绝明显超大响应, 流式读时也 cap 在 20MB
  const RELAY_MAX_JSON_BYTES = 20 * 1024 * 1024
  const cl = Number(res.headers.get('content-length') || 0)
  if (cl && cl > RELAY_MAX_JSON_BYTES) {
    try { await res.body?.cancel().catch(() => {}) } catch { /* ignore */ }
    throw new RelayTransportError(`中继响应体过大(content-length=${cl} > ${RELAY_MAX_JSON_BYTES}字节), 已中止`)
  }
  let payloadText: string
  if (res.body && typeof res.body.getReader === 'function') {
    // 流式读 + 计数, 超限中止防 OOM
    const reader = res.body.getReader()
    const dec = new TextDecoder('utf-8')
    let acc = ''
    let total = 0
    let overflow = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > RELAY_MAX_JSON_BYTES) {
        overflow = true
        try { await reader.cancel().catch(() => {}) } catch { /* ignore */ }
        break
      }
      acc += dec.decode(value, { stream: true })
    }
    acc += dec.decode() // flush
    if (overflow) {
      throw new RelayTransportError(`中继响应体流式读超 ${RELAY_MAX_JSON_BYTES}字节上限, 已中止`)
    }
    payloadText = acc
  } else {
    // 无 body 流(理论不可达, 兜底走 text())
    payloadText = await res.text()
    if (payloadText.length > RELAY_MAX_JSON_BYTES) {
      throw new RelayTransportError(`中继响应体过大(${payloadText.length} > ${RELAY_MAX_JSON_BYTES}字符, 已读取)`)
    }
  }
  let payload: { status?: number; headers?: [string, string][]; setCookie?: string[]; bodyB64?: string; relayError?: string }
  try {
    payload = JSON.parse(payloadText)
  } catch (e: any) {
    throw new RelayTransportError(`中继响应非 JSON(HTTP ${res.status}): ${String(e?.message || e).slice(0, 100)}`)
  }
  if (payload.relayError || typeof payload.status !== 'number' || typeof payload.bodyB64 !== 'string') {
    throw new RelayTransportError(`中继层失败: ${String(payload.relayError || '响应形态非法').slice(0, 160)}`)
  }
  // R4-4: base64 body 同样 cap(防中继层未限大小就塞进来, 解码后 buf.length > 20MB 拒收)
  if (payload.bodyB64.length > Math.ceil(RELAY_MAX_JSON_BYTES * 4 / 3)) {
    throw new RelayTransportError(`中继 bodyB64 过大(${payload.bodyB64.length}字符), 已拒绝`)
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

export function effectiveHostGateLimit(cfg: Pick<FetchConfig, 'fetchMode' | 'hostGateLimit' | 'perHostConcurrency'>): number | undefined {
  // agent-K-crawl-phase2: perHostConcurrency 是绝对天花板, 优先钳制 ——
  // 即使 hostGate 因连续成功回升到更高, 也以本字段为准; 用于 ops 严格限制单站并发
  // (过盾站点对并发敏感, 高并发触发 WAF)。未配置时(undefined)不钳制(零回归)。
  let effective: number | undefined = cfg.hostGateLimit
  // 1) perHostConcurrency 优先钳制
  if (typeof cfg.perHostConcurrency === 'number' && Number.isFinite(cfg.perHostConcurrency) && cfg.perHostConcurrency > 0) {
    if (typeof effective === 'number' && Number.isFinite(effective)) {
      effective = Math.min(effective, cfg.perHostConcurrency)
    } else {
      effective = cfg.perHostConcurrency
    }
  }
  // 2) 桥模式 stealthy/playwright 钳制(原逻辑, 不变)
  const mode = scraplingModeOf(cfg.fetchMode)
  if (mode !== 'stealthy' && mode !== 'playwright') return effective
  if (typeof effective !== 'number' || !Number.isFinite(effective)) return effective
  return Math.min(effective, SCRAPLING_BROWSER_CONCURRENCY)
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
  // 2-fetcher Part A: SSRF 守卫 —— 引擎不向桥请求内部目标(桥侧另有校验, 双重保险)
  const ssrf = await assertSafeTarget(url, { allowLoopback: false })
  if (!ssrf.ok) {
    console.warn(`[fetcher] scrapling bridge SSRF 拒绝: ${ssrf.reason} (${url.slice(0, 120)})`)
    return null
  }
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
    // 2-fetcher C4: DNS 瞬时失败(ENOTFOUND/EAI_AGAIN) 2s 后重试 fetchHttp 一次, 不落 curl;
    // ECONNREFUSED 不重试(端口关=非瞬时, curl 也救不了); 超时(isFetchTimeout)不重试
    if (
      !e?.status && !e?.isFetchTimeout &&
      (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN' ||
        /getaddrinfo (ENOTFOUND|EAI_AGAIN)/i.test(String(e?.message || '')))
    ) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        return await fetchHttp(url, cfg, ua, proxy)
      } catch {
        // DNS 重试仍失败, 落 curl 兜底(下方逻辑)
      }
    }
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
 * 配置了代理且目标非回环时, 按策略排序后逐条尝试(每条 = bun fetch→curl 兜底
 * 单次尝试); 任一条成功即返回; 全部失败 → 降级直连重试一次(与 token 预取
 * "静默降级不硬断"同口径)。轮换/降级全程仅 warn 级日志, 不因代理失败中断采集;
 * 降级直连成功与否如实返回/抛出(错误保留 status/bodyHtml 供上层挑战链判定)。
 * token 预取(prefetchToken)/token 挑战求解(trySolveTokenChallenge)亦经本函数,
 * 代理/回环豁免语义自动贯穿; 目标回环或未配置代理时行为与原实现完全一致(零回归)
 *
 * feat-round-8: B3 — 代理轮换策略 + 失败冷却
 *   - 过滤冷却中的代理(failedUntil > now), 全部冷却→直接降级直连
 *   - 排序按 cfg.proxyRotationStrategy:
 *     • undefined / 'random': Fisher-Yates 洗牌(原行为)
 *     • 'round-robin' / 'least-used': 按 useCount 升序(最低先用, 平摊负载)
 *   - 网络层失败(无 HTTP status — 超时/连接拒绝/DNS/TLS) → markProxyFailed(30s 冷却);
 *     HTTP 4xx/5xx(有 status)是源站响应, 代理本身健康, 不冷却
 */
export async function fetchHttpWithCurlFallback(url: string, cfg: FetchConfig, ua: string): Promise<string> {
  const pool = parseProxyPool(cfg.proxyUrl)
  if (!pool.length || isLoopbackTarget(url)) {
    return fetchHttpWithCurlSingle(url, cfg, ua, '')
  }
  // feat-round-8: B3 — 过滤冷却中的代理
  const available = pool.filter(isProxyAvailable)
  if (available.length === 0) {
    console.warn(`[fetcher] 全部 ${pool.length} 条代理均在冷却中, 降级直连: ${url.slice(0, 200)}`)
    return fetchHttpWithCurlSingle(url, cfg, ua, '')
  }
  // 排序: round-robin/least-used 按 useCount 升序; undefined/random Fisher-Yates 洗牌(原行为)
  const strategy = cfg.proxyRotationStrategy
  let order: string[]
  if (strategy === 'round-robin' || strategy === 'least-used') {
    order = available.slice().sort((a, b) => getProxyState(a).useCount - getProxyState(b).useCount)
  } else {
    order = available.slice()
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
  }
  let lastErr: any = null
  for (const proxy of order) {
    markProxyUsed(proxy)
    // agent-K: 记录请求开始时刻, 成功后传给 markProxySucceeded 计算 EWMA 延迟
    const reqStart = Date.now()
    try {
      const result = await fetchHttpWithCurlSingle(url, cfg, ua, proxy)
      // R4-3: 代理请求成功 → 清零连续失败计数, 让指数退避在代理恢复后立即解除
      // agent-K: 传入 latencyMs 供 weighted-rr 权重更新(更快代理拿到更多请求)
      markProxySucceeded(proxy, Date.now() - reqStart)
      return result
    } catch (e: any) {
      lastErr = e
      // feat-round-8: B3 — 网络层失败(无 HTTP status)标记代理冷却 30s; HTTP 状态错误不冷却
      // R4-3: 冷却改为指数退避(30s→60s→120s→240s→300s 上限)
      // agent-K: markProxyFailed 内推入级联检测滑窗, 10s 内 ≥3 条失败触发熔断;
      // cascadePauseMs 从 cfg.proxyCascadePauseMs 钳制传入(sanitize 已钳 [10_000, 300_000])
      if (isProxyNetworkError(e)) {
        markProxyFailed(proxy, PROXY_FAIL_COOLDOWN_MS, cfg.proxyCascadePauseMs)
        console.warn(`[fetcher] 代理网络层失败+指数退避冷却(${redactProxy(proxy)}): ${String(e?.message || e).slice(0, 140)}`)
      } else {
        console.warn(`[fetcher] 代理请求失败(源站响应, 不冷却)(${redactProxy(proxy)}): ${String(e?.message || e).slice(0, 140)}`)
      }
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

const globalForToken = globalThis as unknown as {
  __novelTokenPrefetch_v1?: Map<string, { token: string; at: number }>
  /** R4-1: in-flight token 预取 promise —— 并发调用同 cacheKey 时复用同一 promise, 防
   *  TTL 过期瞬间 N 个并行章节请求同时 miss cache、同时触发 N 次 fetchHttpWithCurlFallback
   *  打爆 token 端点(触发对端 429 / 自伤出口 IP)。Promise resolve 后清条目 */
  __novelTokenInflight_v1?: Map<string, Promise<string>>
}
function tokenCache(): Map<string, { token: string; at: number }> {
  if (!globalForToken.__novelTokenPrefetch_v1) globalForToken.__novelTokenPrefetch_v1 = new Map()
  return globalForToken.__novelTokenPrefetch_v1
}
function tokenInflight(): Map<string, Promise<string>> {
  if (!globalForToken.__novelTokenInflight_v1) globalForToken.__novelTokenInflight_v1 = new Map()
  return globalForToken.__novelTokenInflight_v1
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
  // 2-fetcher Bug 11: 全量替换 {url}(原 replace 只替首个, 多占位符模板第二个起漏替换)
  if (real.includes('{url}')) real = real.split('{url}').join(encodeURIComponent(targetUrl))
  // 2-fetcher Part A: SSRF 守卫 —— tokenUrl 是操作员配置的预取端点(常为 127.0.0.1:301x
  // 转换代理), 允许 loopback; 但仍拒绝云元数据/私网(防恶意规则把 tokenUrl 指 10.0.0.1)
  const ssrf = await assertSafeTarget(real, { allowLoopback: true })
  if (!ssrf.ok) {
    console.warn(`[fetcher] prefetchToken SSRF 拒绝: ${ssrf.reason} (${real.slice(0, 120)})`)
    return ''
  }
  // 缓存键用【解析后】预取 URL(bb-g 修复): 原 tokenUrl 原串含 {url} 占位符时, 同 host 30s 内
  // 所有目标 URL 共享同一缓存槽 —— 第二章复用第一章的 f(url) token 必被目标端 403。
  // 固定 tokenUrl(会话型)时 real === tokenUrl, 缓存语义不变
  const cacheKey = `${originHost(targetUrl)}|${real}|${pattern}`
  const cached = tokenCache().get(cacheKey)
  if (cached && Date.now() - cached.at < TOKEN_CACHE_TTL_MS) return cached.token
  // R4-1: in-flight 去重 —— TTL 过期瞬间 N 个并行章节请求同时 miss cache, 原实现每个都
  // 触发一次 fetchHttpWithCurlFallback(real, ...), N× 负载打在 token 端点上(触发对端 429
  // 或自伤出口 IP)。现复用同一 in-flight promise, N 个 caller 共享一次预取结果
  const inflightMap = tokenInflight()
  const existing = inflightMap.get(cacheKey)
  if (existing) {
    try {
      return await existing
    } catch {
      // 上一次预取失败, 落到下方自己重试一次(单次, 不再 in-flight 嵌套)
    }
  }
  const p = (async () => {
    try {
      const body = await fetchHttpWithCurlFallback(real, cfg, ua)
      const token = await extractToken(body, pattern)
      if (token) {
        const cache = tokenCache()
        cache.set(cacheKey, { token, at: Date.now() })
        tokenCacheTrim(cache) // rr-c3: 有界化(修前逐章分键条目永不清扫 → 长任务无界增长)
      }
      return token
    } finally {
      // 完成后清 in-flight 条目, 让下次 TTL 过期能重新预取
      inflightMap.delete(cacheKey)
    }
  })()
  inflightMap.set(cacheKey, p)
  return p
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
  /** agent-K-crawl-phase2: 命中验证码时为 true + captchaType 标识具体类型(recaptcha/
   *  hcaptcha/turnstile/geetest/unknown); runner 据此计数 + 该 host 进入冷却期。普通页面
   *  与无验证码的 WAF 挑战页(JS 挑战壳)不会触发此字段(仍走原 blocked=true 路径) */
  captchaDetected?: boolean
  captchaType?: CaptchaType
}

// ---------- In-flight 请求去重 (agent-A-fetcher 反反爬增强) ----------
/**
 * 短时间窗口内同 URL+cfg 多个并发请求合并为一次实际抓取, 第二+ 个 caller 共享首请求结果,
 * 避免重复打盾被 WAF 识别为爆发式爬虫(尤其 admin rules/test 路由双击、列表页 → 章节并发场景)。
 * - 进程级 Map 持久, dev HMR 经 globalThis 复用避免状态丢失
 * - TTL 30s: 同一 URL 在 30s 内并发去重, 超时强制重新抓取(防首请求卡死阻塞所有 caller)
 * - 容量上限 500: 防长任务下无界增长(典型批量采集 ≤ 100 个不同 URL 并发)
 * - 安全条件: 仅在 cfg 无 pageFetch 函数注入 + 无 refererChain+refererUrl 逐请求注入时启用 ——
 *   两者都是"每次请求独立"的运行时项, 合并会破坏逐请求语义; token 预取虽也是动态, 但 30s
 *   内同 URL token 通常相同(tokenCache 复用), 不影响去重正确性
 * - 副作用共享: Cookie 罐写入/UA 钉扎/代理状态更新等副作用由首请求触发, 共享 caller 复用,
 *   实际减少对端压力(单次抓取 vs N 次抓取), 与"反反爬"目的一致
 */
const INFLIGHT_MAX_ENTRIES = 500
const INFLIGHT_TTL_MS = 30_000
const globalForInflight = globalThis as unknown as { __novelFetchInflight_v1?: Map<string, { p: Promise<FetchResult>; at: number }> }
const inflightMap: Map<string, { p: Promise<FetchResult>; at: number }> = globalForInflight.__novelFetchInflight_v1 ?? new Map()
globalForInflight.__novelFetchInflight_v1 = inflightMap

function inflightTrim(): void {
  const now = Date.now()
  // 先清过期条目(已 settled 但未删除的残留, 极少见 — finally 块应已清)
  for (const [k, v] of inflightMap) {
    if (now - v.at > INFLIGHT_TTL_MS) inflightMap.delete(k)
  }
  // 仍超限按插入序删最旧(FIFO, 与 ssrfDnsCache/tokenCache 同口径)
  while (inflightMap.size > INFLIGHT_MAX_ENTRIES) {
    const oldest = inflightMap.keys().next().value
    if (oldest === undefined) break
    inflightMap.delete(oldest)
  }
}

/** 计算去重 cache key: 返回 null 表示"跳过去重"(cfg 含运行时注入项, 签名不可稳定序列化) */
function inflightKey(url: string, cfg: FetchConfig): string | null {
  // pageFetch 是函数(运行时注入, 每次不同), 含此字段时跳过(签名不可序列化)
  if (cfg.pageFetch) return null
  // refererChain + refererUrl 同时存在 = runner/parser 逐请求注入来源页 URL, 不同来源页的请求
  // 即使 URL 相同也应独立抓取(浏览器场景下不同 Referer 是不同导航), 跳过去重避免误合并
  if (cfg.refererChain && cfg.refererUrl) return null
  const sig = JSON.stringify({
    e: cfg.engine,
    u: cfg.uaMode,
    cu: cfg.customUa || '',
    h: cfg.headers || null,
    c: cfg.cookies || '',
    rc: cfg.refererChain ? 1 : 0,
    tu: cfg.tokenUrl || '',
    tp: cfg.tokenPattern || '',
    ti: cfg.tokenInjection || '',
    cpu: cfg.contentProxyUrl || '',
    pu: cfg.proxyUrl || '',
    md: cfg.mirrorDomains || '',
    fm: cfg.fetchMode || '',
    sbu: cfg.scraplingBridgeUrl || '',
  })
  return `${url}|${sig}`
}

/**
 * 统一抓取入口: 未配置 mirrorDomains 时单 host 直通 fetchPageOnce(与历史行为逐字节一致);
 * 配置后按镜像组失败驱动切换(dd-b, 语义见镜像段注释)
 * agent-A-fetcher 反反爬增强: 顶层 in-flight 去重 —— 同 URL+cfg 在 30s 窗口内的并发请求
 * 共享首请求结果(成功/失败均透传, 首请求内已有完整重试链路); cfg 含运行时注入项时跳过
 */
export async function fetchPage(url: string, cfgOverride?: Partial<FetchConfig>): Promise<FetchResult> {
  const cfg: FetchConfig = { ...DEFAULT_FETCH_CONFIG, ...cfgOverride }
  // agent-K-crawl-phase2: 思考时间(行为指纹防御) —— 在 fetchPage 入口前 sleep random(0, thinkTimeMs),
  // 模拟人类"读完上页再请求下页"的节奏不规则性。仅在外部入口生效(内部 fetchPageOnce 递归不叠加)。
  // 缺省 thinkTimeMs=0=零回归; 配置 >0 时启用全抖动 [0, ms) 延迟, 与 jitterMs(批次间)正交
  await applyThinkTime(cfg)
  // agent-K-crawl-phase2: 全局速率上限节流(滑窗 60s)—— cfg.globalRateLimitPerMin>0 时,
  // 所有 host 合计每分钟不得超过本值; 超出在 fetchPage 入口 sleep 节流。防采集洪水打爆出口 IP
  await applyGlobalRateLimit(cfg)
  // agent-K-crawl-phase2: 代理健康检查触发(cfg.proxyHealthCheck=true 时每 5min 一次, 异步非阻塞)
  // 失败/异常静默吞错(健康检查本身不应阻塞正常采集); 检查结果写入 proxyState.healthStatus,
  // 下次 pickProxyFor 时自动 unhealthy 排后
  if (cfg.proxyHealthCheck === true) triggerProxyHealthCheck(cfg)
  // In-flight 去重: 同 URL+cfg 并发合并(零回归条件: cfg 无 pageFetch / 无 refererChain+refererUrl)
  const dedupKey = inflightKey(url, cfg)
  if (dedupKey) {
    inflightTrim()
    const existing = inflightMap.get(dedupKey)
    if (existing && Date.now() - existing.at < INFLIGHT_TTL_MS) {
      // 共享在途请求结果(成功/失败均透传, 不重试 — 首请求内已有 cookie/backoff/镜像重试链路)
      // shallow clone 防调用方误改共享对象
      return existing.p.then((r) => ({ ...r }))
    }
    const p = (async () => {
      try {
        return await fetchPageUncached(url, cfg)
      } finally {
        // 完成后清条目, 让下次 TTL 过期后能重新抓取
        inflightMap.delete(dedupKey)
      }
    })()
    inflightMap.set(dedupKey, { p, at: Date.now() })
    return p
  }
  return fetchPageUncached(url, cfg)
}

/** fetchPage 的实际执行体(去重 wrapper 之下的"非缓存"实现, 既有逻辑零变化) */
async function fetchPageUncached(url: string, cfg: FetchConfig): Promise<FetchResult> {
  // 2-fetcher Part A: SSRF 守卫 —— 默认禁止抓取内部/元数据/私网地址; loopback 仅对
  // 操作员配置的 tokenUrl(127.0.0.1:301x)/fetch-relay/scrapling bridge 内部调用放行
  const allowLoopback = loopbackBypassAllowed(url, cfg)
  const ssrf = await assertSafeTarget(url, { allowLoopback })
  if (!ssrf.ok) throw new Error(`SSRF blocked: ${ssrf.reason}`)
  const group = mirrorGroupFor(url, cfg)
  if (group.length <= 1) return fetchPageOnce(url, cfg)
  let lastErr: unknown = null
  for (let i = 0; i < group.length; i++) {
    const hostUrl = rewriteMirrorHost(url, group[i])
    if (!hostUrl) continue
    // 2-fetcher Part A: 镜像 host 也走 SSRF 守卫(防 admin 配置 mirrorDomains 指向内网)
    // R5-13: 原硬编码 allowLoopback:false 会把 URL 自身的 loopback token 代理(如 127.0.0.1:3010)
    //  在 i=0 首次迭代(=URL 自身 host)时拒掉 → 该镜像被跳过 → 章节抓取静默失败。
    //  改用 loopbackBypassAllowed(hostUrl, cfg) 与外层 SSRF 守卫同口径(配置豁免则放行)
    const mirrorSsrf = await assertSafeTarget(hostUrl, { allowLoopback: loopbackBypassAllowed(hostUrl, cfg) })
    if (!mirrorSsrf.ok) {
      console.warn(`[fetcher] 镜像 ${group[i]} SSRF 拒绝: ${mirrorSsrf.reason}`)
      lastErr = new Error(`SSRF blocked: ${mirrorSsrf.reason}`)
      continue
    }
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
  // R3-8: 原实现把 token=... 与 "?challenge=" 两个特征作【独立 OR】判定 —— 任意"含 token 字符串
  // + 出现 ?challenge 字样"的拦截页都会误触发求解(如 CF "Attention Required" 挑战页 HTML 内嵌
  // challenge-platform 脚本 + 含 token=... 字面量)。改为要求两特征【同时】出现且在 500 字符
  // 邻近范围内(典型 token 挑战壳体极短 <2k, 二者必紧邻)。仅命中 token= 而无 challenge 拼接,
  // 或仅命中 challenge 而无 token= 的形态一律放弃求解(交回浏览器升级链, 不浪费双跳请求)
  // R4-6: 原正则只匹配双引号 token —— 源站用 `let token = '...'`(单引号)或反引号时求解漏触发,
  //  降级走浏览器渲染(慢)。改为 ["'`] 字符组同时支持双引号/单引号/反引号, 且开闭引号必须一致
  const m = html.match(/(?:let|var)\s+token\s*=\s*(["'`])([A-Za-z0-9+/=_-]{20,})\1/)
  if (!m) return null
  const tokenIdx = m.index ?? -1
  const token = m[2]
  // challenge 拼接模式: location.href = ... + "?challenge=" + token, 允许 ? 或 = 单独成块,
  // 但要求是同一行/紧邻 token 定义(<500 字符)。encodeURIComponent 分支显式列出防止误命中
  const chalRe = /location\.href\s*=\s*[^;]{0,200}\?\s*challenge\s*=?|location\.href\s*=\s*[^;]{0,200}\+\s*encodeURIComponent/
  const cm = html.match(chalRe)
  if (!cm) return null
  const chalIdx = cm.index ?? -1
  if (tokenIdx < 0 || chalIdx < 0) return null
  if (Math.abs(tokenIdx - chalIdx) > 500) return null
  const challengeUrl = `${url}${url.includes('?') ? '&' : '?'}challenge=${encodeURIComponent(token)}`
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
  // agent-K-crawl-phase2: 验证码冷却期检查 —— 该 host 命中过 hCaptcha/Turnstile/reCAPTCHA 后,
  // 在冷却期内(默认 10min)直接抛错而非重试, 避免反复撞盾升级风控(从挑战升级到 IP 封禁)。
  // 调用方(runner.gateFetch)按 fetchPage 抛错处理: 章节失败计数 + 增量重试恢复; 冷却到期
  // 后自动恢复采集。冷却期内所有 URL(不分目录/书籍/章节)同 host 一并暂停
  const cd = isHostInCaptchaCooldown(url)
  if (cd.inCooldown) {
    const err: any = new Error(
      `host 在验证码冷却期内(${cd.captchaType}, 剩 ${Math.ceil((cd.remainingMs || 0) / 1000)}s): ${url.slice(0, 200)}`,
    )
    err.name = 'CaptchaCooldown'
    err.captchaType = cd.captchaType
    err.captchaCooldownRemainingMs = cd.remainingMs
    throw err
  }
  // hh-c: scrapling 桥分流 —— fetchMode='scrapling-*' 时整次抓取交桥代发, 目标侧响应
  // 如实返回(不双发); native 专有步骤(token 预取/autoCookie/Cookie 重试/浏览器升级链)
  // 跳过, 隐身能力由桥内 Scrapling Fetcher 承担。桥不可达/桥内异常 → null → 落入下方
  // 既有 native 链降级一次(warn 日志在 fetchViaScraplingBridge 打出)。非法 fetchMode
  // 在 sanitize 白名单已丢弃, scraplingModeOf 此处再兜底(运行时对象直改注入防线)。
  // 未配置 fetchMode / 'native' → scraplingModeOf=null, 下方原流程零行为变化
  // agent-K-crawl-phase2: 桥路径同样做验证码检测 —— stealthy 模式桥内可能通过挑战,
  // 但若目标侧硬性需要人工过盾, 桥返回的 html 仍含验证码标记, 此处识别并冷却
  const slMode = scraplingModeOf(cfg.fetchMode)
  if (slMode) {
    const bridged = await fetchViaScraplingBridge(url, cfg, slMode)
    if (bridged) {
      // 验证码优先识别(若命中, 即使 looksBlocked=false 也算 blocked —— 验证码页本身可能正常返回)
      const captchaType = looksLikeCaptcha(bridged.html)
      if (captchaType) {
        markCaptchaEncountered(url, captchaType, resolveCaptchaCooldownMs(cfg))
        console.warn(`[fetcher] scrapling(${slMode}) 命中验证码 ${captchaType}, host 进入冷却期: ${url.slice(0, 160)}`)
        return { html: bridged.html, engine: 'http', blocked: true, captchaDetected: true, captchaType }
      }
      const blocked = looksBlocked(bridged.html, { status: bridged.status })
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
    // R4-1: prefetchToken 现可 reject(in-flight promise 异常上抛), 失败时静默降级直连(零回归)
    const token = await prefetchToken(url, cfg, ua).catch(() => '')
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
          // 2-fetcher Bug 12: URL 已含 token 参数时改用 searchParams.set 而非追加, 防重复 token=
          // 污染(原直接尾追会拼出 ?token=old&token=new 双值头); 查询参数操作必须在 #fragment
          // 之前(bb-g 修复): fragment 后的 query 服务端不可见, 原「直接尾追」会把 token 落进锚点
          let tokenExists = false
          try { tokenExists = new URL(reqUrl).searchParams.has('token') } catch { /* URL 解析失败回退原逻辑 */ }
          if (tokenExists) {
            try {
              const u = new URL(reqUrl)
              u.searchParams.set('token', enc)
              reqUrl = u.toString()
            } catch {
              const h = reqUrl.indexOf('#')
              const sep = reqUrl.includes('?') ? '&' : '?'
              reqUrl = h >= 0 ? reqUrl.slice(0, h) + sep + 'token=' + enc + reqUrl.slice(h) : reqUrl + sep + 'token=' + enc
            }
          } else {
            const h = reqUrl.indexOf('#')
            const sep = reqUrl.includes('?') ? '&' : '?'
            reqUrl = h >= 0 ? reqUrl.slice(0, h) + sep + 'token=' + enc + reqUrl.slice(h) : reqUrl + sep + 'token=' + enc
          }
        }
      }
    }
  }

  // feat-contentproxy-resume: 内容代理 URL(xjp-proxy/deqixs-proxy 等服务端解密代理)。
  // 配置后正文段 fetch 不走原始 URL, 而是请求 contentProxyUrl(替换 {url} 为原始章节 URL 的
  // encodeURIComponent), 代理返回 JSON {ok:true, content:string}(纯文本, \n 分段), 引擎
  // 把每行 wrap 成 <p> 作为 html 传给 parser(content 字段可设 const 类型直接拿全文)。
  // 必须在 fetchPageOnce 内部 token 预取之后、原 URL fetch 之前 —— 拦截掉原 URL 抓取。
  // SSRF 守卫: contentProxyUrl 是操作员配置的回环转换代理, allowLoopback:true 放行(与 tokenUrl 同口径);
  // 仍拒绝云元数据/私网(防恶意规则把 contentProxyUrl 指 10.0.0.1)。代理失败/响应非法 → 静默降级原 URL 直连
  const contentProxyUrl = (cfg.contentProxyUrl || '').trim()
  if (contentProxyUrl) {
    // {url} 占位符全量替换(与 prefetchToken 同款 split/join, 防 replace 只替首个多占位符漏替换)
    const proxyUrl = contentProxyUrl.split('{url}').join(encodeURIComponent(url))
    const ssrf = await assertSafeTarget(proxyUrl, { allowLoopback: true })
    if (ssrf.ok) {
      try {
        const body = await fetchHttpWithCurlFallback(proxyUrl, cfg, ua)
        let parsed: unknown = undefined
        try { parsed = JSON.parse(body) } catch { parsed = undefined }
        // 容错形态: {ok:true, content:string} 或 {ok:false, error:string}
        const obj = parsed as { ok?: unknown; content?: unknown; error?: unknown } | undefined
        if (obj && obj.ok === true && typeof obj.content === 'string' && obj.content) {
          // 代理返回纯文本(\n 分段), 转 HTML 给 parser(每行一个 <p>, 过滤空行)
          const html = obj.content
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => `<p>${l.replace(/[<>&]/g, (c) => c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;')}</p>`)
            .join('')
          if (html) {
            return { html, engine: 'http', blocked: false }
          }
        }
        // ok=false || content 空 → 静默降级原 URL(fetcher 注释)
        console.warn(`[fetcher] contentProxyUrl 响应未给出有效内容, 降级直连原 URL: ${String(obj?.error || 'ok/content 字段缺失').slice(0, 120)} (proxy=${proxyUrl.slice(0, 120)})`)
      } catch (e) {
        // 代理抓取失败/超时/JSON 解析失败 → 静默降级原 URL 直连(零回归)
        console.warn(`[fetcher] contentProxyUrl 抓取失败, 降级直连原 URL: ${String((e as Error)?.message || e).slice(0, 120)} (proxy=${proxyUrl.slice(0, 120)})`)
      }
    } else {
      // SSRF 拒绝 → 静默降级原 URL 直连(不抛, 与 token 预取失败同口径)
      console.warn(`[fetcher] contentProxyUrl SSRF 拒绝: ${ssrf.reason} (proxy=${proxyUrl.slice(0, 120)})`)
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
    // agent-K-crawl-phase2: 浏览器路径同样做验证码检测 —— Obscura 路径已尝试过隐身但若仍
    // 被反爬升级到验证码挑战, 此处识别并触发 host 冷却期(避免反复撞盾)
    const captchaType = looksLikeCaptcha(html)
    if (captchaType) {
      markCaptchaEncountered(url, captchaType, resolveCaptchaCooldownMs(cfg))
      console.warn(`[fetcher] 浏览器渲染命中验证码 ${captchaType}, host 进入冷却期: ${url.slice(0, 160)}`)
      return { html, engine: 'browser', blocked: true, captchaDetected: true, captchaType }
    }
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
  // 2-fetcher Bug 3: 独立 backoff 计数器, 解耦 cookie 重试与 429/5xx 退避额度
  let backoffRetries = 0
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
      if (cfg.engine === 'http') {
        // agent-K-crawl-phase2: http 引擎结果同样做验证码检测(挑战壳可能 200 返回)
        const ct = looksLikeCaptcha(html)
        if (ct) {
          markCaptchaEncountered(url, ct, resolveCaptchaCooldownMs(cfg))
          console.warn(`[fetcher] HTTP 命中验证码 ${ct}, host 进入冷却期: ${url.slice(0, 160)}`)
          return { html, engine: 'http', blocked: true, captchaDetected: true, captchaType: ct }
        }
        return { html, engine: 'http', blocked: looksBlocked(html) }
      }
      if (!looksBlocked(html)) {
        // agent-K-crawl-phase2: auto 引擎成功路径同样做验证码检测(非 blocked 但可能含验证码 div)
        const ct2 = looksLikeCaptcha(html)
        if (ct2) {
          markCaptchaEncountered(url, ct2, resolveCaptchaCooldownMs(cfg))
          console.warn(`[fetcher] HTTP 命中验证码 ${ct2}, host 进入冷却期: ${url.slice(0, 160)}`)
          return { html, engine: 'http', blocked: true, captchaDetected: true, captchaType: ct2 }
        }
        return { html, engine: 'http', blocked: false }
      }
      // auto 模式: 200 但内容疑似挑战壳 —— 若刚种下新 Cookie 或响应体是 JS 跳转壳,
      // 与 403 场景同策略追加带 Cookie 重试(有的站以 200+跳转壳代替 403), 用尽再升级浏览器
      const gotNewCookieOk = cookieJar.count(domain) > cookiesBefore
      if ((gotNewCookieOk || isJsChallenge(html)) && cookieRetries < MAX_COOKIE_RETRIES) {
        cookieRetries++
        // agent-A-fetcher: 抖动 200~500ms 防并发同 host 多任务同步重试(原固定 350ms)
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 300))
        continue
      }
      lastErr = new Error('内容疑似被拦截(验证码/JS挑战)')
      break
    } catch (e: any) {
      lastErr = e
      lastStatus = e?.status || 0
      const bodyHtml: string = e?.bodyHtml || ''
      // Token 挑战求解(错误路径): 403/412 响应体同样可能是 token 挑战页, 求解成功视同成功
      // agent-A-fetcher: looksBlocked 增传 WAF 头(serverHeader/cfRay/cfMitigated), CF 拦截可
      // 在 bodyHtml 极短或 GBK 乱码时仍被识别为 blocked, 触发后续浏览器升级链而非徒劳重试
      if (bodyHtml && looksBlocked(bodyHtml, {
        status: lastStatus,
        serverHeader: e?.serverHeader,
        cfRay: e?.cfRay,
        cfMitigated: e?.cfMitigated,
      })) {
        const solved = await trySolveTokenChallenge(reqUrl, bodyHtml, effCfg, ua)
        if (solved) return { html: solved, engine: 'http', blocked: false }
      }
      if (fallbackStatus.includes(lastStatus)) {
        const gotNewCookie = cookieJar.count(domain) > cookiesBefore
        if ((gotNewCookie || isJsChallenge(bodyHtml)) && cookieRetries < MAX_COOKIE_RETRIES) {
          cookieRetries++
          // agent-A-fetcher: 抖动 200~500ms 防并发同步(与成功路径同口径)
          await new Promise((r) => setTimeout(r, 200 + Math.random() * 300))
          continue // 带刚种下的新 Cookie 重发
        }
        // ff-b③: 403 且罐中已有会话但无新 Cookie —— 疑"陈旧会话 Cookie 被目标端拒绝"
        // (挑战 Cookie 与出口 IP/UA 绑定, 出口轮换后旧罐变毒药)。清空该域罐以全新会话
        // 重试一次(有 cookieRetries 上限兜底不死循环); 罐为空则直接 break 升级浏览器
        if (lastStatus === 403 && cookieJar.count(domain) > 0 && cookieRetries < MAX_COOKIE_RETRIES) {
          cookieJar.clear(domain)
          cookieRetries++
          // agent-A-fetcher: 抖动 200~500ms 防并发同步(同上)
          await new Promise((r) => setTimeout(r, 200 + Math.random() * 300))
          continue
        }
        // ff-b④ + 2-fetcher Bug 3: 429/瞬时 5xx(500/502/504) 指数退避重试 HTTP 级
        // (1.5s×2^n 封顶 8s; 瞬时故障升级浏览器收益低)。Bug 3 修复: 原先用
        // `attempt < baseAttempts + cookieRetries` 判定, 但 cookieRetries 已在前面 ++ 后
        // 再到此处, 边界 429 会跳过退避直接 break 升级浏览器。改为独立 backoffRetries 计数器,
        // 与 cookieRetries 解耦; maxBackoffRetries = min(2, retries) 上限确保退避不无限。
        // 503 不参与(常为 CF 挑战壳, 保留升级浏览器语义); 超时不在此路径(isFetchTimeout 另行喂 hostGate)
        // agent-A-fetcher 反反爬增强: 全抖动(full jitter) —— delay = random(0, base × 2^attempt),
        // 与固定退避相比, 全抖动让并发重试请求均匀分散到 [0, temp) 区间, 显著降低同步惊群
        // (AWS Architecture Blog "Exponential Backoff and Jitter" guidance)
        const maxBackoffRetries = Math.min(2, cfg.retries ?? 0)
        if (
          (lastStatus === 429 || lastStatus === 500 || lastStatus === 502 || lastStatus === 504) &&
          backoffRetries < maxBackoffRetries
        ) {
          backoffRetries++
          // Full jitter: delay = uniform random in [0, min(cap, base * 2^(attempt-1))]
          const base = 1500
          const cap = 8000
          const temp = Math.min(cap, base * Math.pow(2, backoffRetries - 1))
          const delay = Math.floor(Math.random() * temp)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        break
      }
      // agent-A-fetcher: 其余 4xx 错误(404/410 等)等待使用 attempt 比例退避
      // 原固定 400*attempt 改为带 ±25% 抖动, 防瞬时同步重试
      const baseDelay = 400 * attempt
      const jitteredDelay = Math.floor(baseDelay * (0.75 + Math.random() * 0.5))
      await new Promise((r) => setTimeout(r, jitteredDelay))
    }
  }

  // 本轮 HTTP 全部失败: 释放该域 UA 钉扎, 下次抓取换新 UA 再试
  domainUa.delete(domain)
  // agent-K-crawl-phase2: 同步释放会话人格钉扎(viewport/timezone/language 与 UA 同步换新,
  // 整轮失败后下次抓取用新组合, 避免"同 host 反复失败但 UA/viewport 永久不变"被识别为 bot)
  clearSessionPersonality(domain)

  // auto: 升级浏览器渲染
  if (cfg.engine === 'auto') {
    const ok = await checkBrowser()
    if (ok) {
      try {
        const html = await renderWithBrowser(reqUrl, effCfg, ua)
        // agent-K-crawl-phase2: auto 升级浏览器路径同样做验证码检测
        const captchaType = looksLikeCaptcha(html)
        if (captchaType) {
          markCaptchaEncountered(url, captchaType, resolveCaptchaCooldownMs(cfg))
          console.warn(`[fetcher] auto 升级浏览器命中验证码 ${captchaType}, host 进入冷却期: ${url.slice(0, 160)}`)
          return { html, engine: 'browser', blocked: true, captchaDetected: true, captchaType }
        }
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
  // 2-fetcher Part A: SSRF 守卫(allowLoopback=false), 防 SSRF 滥用封面抓取打内网
  const ssrf = await assertSafeTarget(url, { allowLoopback: false })
  if (!ssrf.ok) {
    console.warn(`[fetcher] fetchBinary SSRF 拒绝: ${ssrf.reason} (${url.slice(0, 120)})`)
    return null
  }
  const ua = pickUaFor(originHost(url), cfg)
  // 大文件内存保护: 封面等资源超过上限直接放弃, 防异常站点回 4GB 响应拖爆内存
  const MAX_BINARY_BYTES = 25 * 1024 * 1024
  const timeoutMs = cfg.timeout && cfg.timeout > 0 ? cfg.timeout : 20000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // 2-fetcher Bug 23: redirect:'follow' 把 Cookie 头原样带到重定向目标 —— 跨域重定向时
    // 会泄漏同站 Cookie 给重定向目标域。改为 manual, 逐跳重新 buildHeaders(每跳 Cookie 按
    // 该跳 URL 域取罐中值), 跨域跳转自动不带原域 Cookie。上限 5 跳(封面资源重定向罕见)
    const MAX_BINARY_REDIRECT_HOPS = 5
    let hopUrl = url
    let res: Response | null = null
    for (let hop = 0; hop <= MAX_BINARY_REDIRECT_HOPS; hop++) {
      const headers = buildHeaders(hopUrl, cfg, ua)
      res = await fetch(hopUrl, { headers, signal: controller.signal, redirect: 'manual' })
      // R4-5: fetchBinary 逐跳存储 Set-Cookie —— 旧行为从未调用 cookieJar.store, 重定向链中
      // 中间跳(如 CDN anti-hotlink)种下的会话 Cookie 全部丢失, 后续同域正文/章节抓取拿不到
      // 会话 Cookie → 403。与 fetchHttp 逐跳同口径调用 store
      if (cfg.autoCookie !== false) {
        const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
        if (setCookies.length) cookieJar.store(originHost(hopUrl), setCookies)
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        // 不消费 3xx 响应体, 显式 cancel 释放连接
        try { void res.body?.cancel().catch(() => {}) } catch { /* ignore */ }
        let next: URL
        try { next = new URL(res.headers.get('location')!, hopUrl) } catch { return null }
        // 仅放行 http→https 升级, 拒绝跨 scheme 降级(防明文跳转泄漏 Cookie)
        if (next.protocol !== new URL(hopUrl).protocol) {
          const upgrade = new URL(hopUrl).protocol === 'http:' && next.protocol === 'https:'
          if (!upgrade) return null
        }
        hopUrl = next.toString()
        continue
      }
      break
    }
    if (!res || !res.ok) {
      // rr-c3 卫生: 与 fetchHttp 3xx 分支同口径, 失败路径 body 显式 cancel 释放连接
      try { void res?.body?.cancel().catch(() => {}) } catch { /* ignore */ }
      return null
    }
    const lenHeader = Number(res.headers.get('content-length') || 0)
    if (lenHeader > MAX_BINARY_BYTES) {
      // 超限早退时取消响应体: 不消费 body 会占住连接直到服务端断开
      try { await res.body?.cancel() } catch { /* ignore */ }
      return null
    }
    // 2-fetcher Bug 1: 流式读取 + 运行计数, 超限即中止 —— 原先 res.arrayBuffer() 一次性
    // 读入内存再判大小, 异常站点回 4GB 响应已 OOM。getReader 逐 chunk 累加, 超 MAX 即抛
    if (!res.body) {
      // 无 body 流(某些运行时 / 中继形态)回退 arrayBuffer 读取
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_BINARY_BYTES) return null
      return { buf, contentType: res.headers.get('content-type') || '' }
    }
    const reader = res.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    let overflow = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_BINARY_BYTES) {
        overflow = true
        try { await reader.cancel() } catch { /* ignore */ }
        break
      }
      chunks.push(Buffer.from(value))
    }
    if (overflow) {
      console.warn(`[fetcher] fetchBinary 响应体超过 ${Math.round(MAX_BINARY_BYTES / 1024 / 1024)}MB 上限, 已中止: ${url.slice(0, 120)}`)
      return null
    }
    const buf = Buffer.concat(chunks)
    return { buf, contentType: res.headers.get('content-type') || '' }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
