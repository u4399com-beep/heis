// CloakBrowser — 基于 puppeteer-extra + stealth 的反检测浏览器引擎 (enhanced 3-tier stealth)
//
// 作为 Obscura 引擎的补充, 处理 Obscura 无法突破的 CF/WAF 站点(hetushu/shucong 等 hard WAF)
//
// 端口: 3016
// 端点:
//   GET  /health → 健康检查
//   POST /fetch  → { url, tier?: 'lite'|'standard'|'maximum', timeoutMs? }
//                  → { ok, html, status, finalUrl, cookies, tier }
//
// 3-tier 隐身配置:
//   lite     : 仅 puppeteer-extra-stealth(当前行为, 用于低安全站点)
//   standard : + canvas/audio noise + WebGL spoof + CDP UA override (CF 站点)
//   maximum  : + request interception(屏蔽 tracking/ads) + font/screen color +
//              hardware concurrency + device memory + IMEI-like device ID
//              (hard WAF 站点: hetushu/shucong/wanbenshenzhan)
//
// 12 隐身 flags(puppeteer-extra-stealth + custom):
//   1. navigator.webdriver = undefined
//   2. window.chrome runtime object
//   3. navigator.plugins (PDF Viewer etc)
//   4. navigator.languages (zh-CN, zh, en)
//   5. WebGL vendor/renderer override
//   6. navigator.permissions.query
//   7. canvas noise (toDataURL/toBlob)
//   8. audio noise (AudioContext)
//   9. navigator.hardwareConcurrency (8)
//  10. navigator.deviceMemory (8)
//  11. navigator.connection (effectiveType, rtt, downlink)
//  12. CDP Network.setUserAgentOverride + userAgentMetadata
//
// 关键设计:
//   - per-session 噪声种子(非 per-request): 维持会话内 canvas/audio 指纹一致性,
//     跨请求复用同一指纹(同 cookie/UA 一致性), 防"指纹漂移"被探针识别
//   - CDP 集成: Network.setUserAgentOverride + userAgentMetadata, Page.addScriptToEvaluateOnNewDocument,
//     Emulation.setDeviceMetricsOverride —— 头组/JS/网络层三方自洽(参考 Obscura hh-d2 实证)
//   - 增强 CF 处理: 等 CF challenge 30s; 尝试点 Turnstile checkbox;
//     仍失败 → 先访问 /robots.txt 拿 cf_clearance, 再访问目标 URL
//   - Cookie 回流: 返回 Set-Cookie 风格数组供引擎复用
//   - 并发限制 2(与 Obscura 一致)

import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { createBridgeServer, json } from '../_shared/server'

puppeteer.use(StealthPlugin())

const PORT = Number(process.env.PORT) || 3016
const MAX_CONCURRENT = 2

// ---------- 隐身层级类型 ----------
type StealthTier = 'lite' | 'standard' | 'maximum'

interface SessionSeed {
  /** 会话级 canvas 噪声种子(整数) */
  canvasNoise: number
  /** 会话级 audio 噪声种子(整数) */
  audioNoise: number
  /** 会话级 device ID(IMEI-like, 15 位数字) */
  deviceId: string
  /** 创建时间戳(用于过期检测) */
  createdAt: number
}

const sessions = new Map<string, SessionSeed>()
// R8-4: per-sessionKey seed creation Promise 锁 —— 并发 /fetch 调用时第一个创建者占锁,
// 后续 caller await 同一 Promise, 避免两 caller 都看不到 existing → 都创建新 seed → 第二覆盖第一
const seedPromises = new Map<string, Promise<SessionSeed>>()

/** 取/创建会话种子: 同 URL host 复用种子, 维持会话内指纹一致性。
 *  R8-4: 改为 async + Promise 锁 —— 第一个 caller 创建种子并写入 Promise Map, 后续 caller
 *  await 同一 Promise, 保证并发同 host 请求拿到同一 SessionSeed(防"指纹漂移"被探针识别)。 */
async function getSeed(sessionKey: string): Promise<SessionSeed> {
  // 快路径: 已有未过期 seed 直接返回(99% 命中)
  const existing = sessions.get(sessionKey)
  if (existing && Date.now() - existing.createdAt < 30 * 60 * 1000) return existing
  // 慢路径: 检查是否有 in-flight Promise; 有则 await, 没有则创建并占锁
  const inflight = seedPromises.get(sessionKey)
  if (inflight) {
    try {
      return await inflight
    } catch {
      // in-flight 失败(罕见): 删除条目, 下方继续走创建路径
      seedPromises.delete(sessionKey)
    }
  }
  // 创建新 seed 的 Promise(executor 同步运行, 占锁写 Map)
  const p = (async () => {
    // 二次查 sessions(可能在 await 间隙已被其他 caller 写入)
    const cur = sessions.get(sessionKey)
    if (cur && Date.now() - cur.createdAt < 30 * 60 * 1000) return cur
    // 用 crypto 生成 15 位 IMEI-like device ID(用于 navigator.userAgentData + cookie)
    const buf = new Uint8Array(8)
    for (let i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256)
    // IMEI 格式: 15 位数字(0-9), 前缀 86(中国区段)
    let deviceId = '86'
    for (let i = 0; i < 13; i++) deviceId += String(buf[i % buf.length] % 10)
    const seed: SessionSeed = {
      canvasNoise: Math.floor(Math.random() * 1_000_000_000),
      audioNoise: Math.floor(Math.random() * 1_000_000_000),
      deviceId,
      createdAt: Date.now(),
    }
    // LRU 防泄漏: 上限 200 会话
    if (sessions.size > 200) {
      const firstKey = sessions.keys().next().value
      if (firstKey) sessions.delete(firstKey)
    }
    sessions.set(sessionKey, seed)
    return seed
  })()
  seedPromises.set(sessionKey, p)
  try {
    return await p
  } finally {
    // 创建完成后清除 in-flight 锁, 让后续 caller 走快路径(查 sessions 命中)
    // 用 setTimeout(0) 避免立即清掉导致并发 caller 仍走慢路径
    setTimeout(() => seedPromises.delete(sessionKey), 100)
  }
}

/** 从 URL 提取 host 作为 session key */
function sessionKeyOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return url.slice(0, 80) }
}

let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
let inFlight = 0

async function ensureBrowser() {
  if (browser && browser.connected) return browser
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--lang=zh-CN',
    ],
  })
  return browser
}

// ---------- 12 隐身 flags 注入脚本 ----------

/**
 * 标准 + 最大档位共享的 canvas/audio/WebGL/permissions/languages 噪声脚本
 * (基础 stealth plugin 已抹平 webdriver / chrome runtime / plugins; 此处补 noise 层)
 *
 * 关键: canvas/audio 噪声基于 per-session 种子, 同会话内多次绘制产生相同噪声 →
 * 站点侧"两次 canvas hash 不一致"探针失效, 同时噪声本身又阻止"对照已知白板指纹"识别
 */
function buildStandardStealthScript(seed: SessionSeed): string {
  return `
(() => {
  try {
    const SEED_CANVAS = ${seed.canvasNoise};
    const SEED_AUDIO = ${seed.audioNoise};
    const DEVICE_ID = ${JSON.stringify(seed.deviceId)};

    // ---------- flag 4: navigator.languages (zh-CN, zh, en) ----------
    try {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en'],
        configurable: true,
      });
      Object.defineProperty(navigator, 'language', {
        get: () => 'zh-CN',
        configurable: true,
      });
    } catch (e) {}

    // ---------- flag 5: WebGL vendor/renderer override ----------
    try {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (p) {
        // UNMASKED_VENDOR_WEBGL = 37445; UNMASKED_RENDERER_WEBGL = 37446
        if (p === 37445) return 'Google Inc. (Intel)';
        if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return getParameter.call(this, p);
      };
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function (p) {
          if (p === 37445) return 'Google Inc. (Intel)';
          if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)';
          return getParameter2.call(this, p);
        };
      }
    } catch (e) {}

    // ---------- flag 6: navigator.permissions.query ----------
    try {
      const origQuery = navigator.permissions && navigator.permissions.query;
      if (origQuery) {
        navigator.permissions.query = function (parameters) {
          if (parameters && parameters.name === 'notifications') {
            return Promise.resolve({ state: 'granted', name: 'notifications', onchange: null });
          }
          return origQuery.call(this, parameters);
        };
      }
    } catch (e) {}

    // ---------- flag 7: canvas noise (toDataURL/toBlob) ----------
    try {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      // 伪噪声函数: 基于种子的轻量像素扰动(≤3 通道), 与种子稳定关联
      function noiseVal(x, y, ch) {
        // 简单 LCG: 同种子同位置产生相同噪声, 跨次调用一致性
        let s = (SEED_CANVAS + x * 2654435761 + y * 40503 + ch * 65599) >>> 0;
        s = (s ^ (s >>> 13)) * 1597334677;
        return (s >>> 0) % 3; // 0/1/2 三个噪声等级, 极轻微像素扰动
      }
      function applyNoise(canvas) {
        try {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const w = canvas.width, h = canvas.height;
          if (w === 0 || h === 0) return;
          // 仅对 ≤256x256 的小 canvas 加噪(性能保护, 大图按需随机取若干像素)
          if (w * h > 65536) {
            // 抽样: 仅扰动 200 个随机像素
            for (let i = 0; i < 200; i++) {
              const x = (SEED_CANVAS + i * 97) % w;
              const y = ((SEED_CANVAS >> 8) + i * 53) % h;
              try {
                const pix = ctx.getImageData(x, y, 1, 1);
                pix.data[0] = (pix.data[0] + noiseVal(x, y, 0)) & 0xff;
                ctx.putImageData(pix, x, y);
              } catch (e) { /* CORS canvas 跳过 */ }
            }
          } else {
            const img = ctx.getImageData(0, 0, w, h);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                img.data[idx] = (img.data[idx] + noiseVal(x, y, 0)) & 0xff;
              }
            }
            ctx.putImageData(img, 0, 0);
          }
        } catch (e) { /* 跨域 canvas 不读取, 静默跳过 */ }
      }
      HTMLCanvasElement.prototype.toDataURL = function () {
        try { applyNoise(this); } catch (e) {}
        return origToDataURL.apply(this, arguments);
      };
      HTMLCanvasElement.prototype.toBlob = function (cb) {
        try { applyNoise(this); } catch (e) {}
        return origToBlob.apply(this, arguments);
      };
    } catch (e) {}

    // ---------- flag 8: audio noise (AudioContext) ----------
    try {
      const origCreateAnalyser = (window.AudioContext || window.webkitAudioContext).prototype.createAnalyser;
      (window.AudioContext || window.webkitAudioContext).prototype.createAnalyser = function () {
        const analyser = origCreateAnalyser.call(this);
        const origGetFloat = analyser.getFloatFrequencyData.bind(analyser);
        analyser.getFloatFrequencyData = function (array) {
          origGetFloat(array);
          // 注入小幅噪声: 同种子同位置产生相同扰动, 探针无法对照已知音频指纹
          for (let i = 0; i < array.length; i++) {
            let s = (SEED_AUDIO + i * 2654435761) >>> 0;
            s = (s ^ (s >>> 13)) * 1597334677;
            const noise = ((s >>> 0) % 100) / 1000; // [-0.05, +0.05] dB 噪声
            array[i] = array[i] + (noise - 0.05);
          }
        };
        return analyser;
      };
    } catch (e) {}

    // ---------- flag 9: navigator.hardwareConcurrency (8) ----------
    try {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    } catch (e) {}

    // ---------- flag 10: navigator.deviceMemory (8) ----------
    try {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
    } catch (e) {}

    // ---------- flag 11: navigator.connection (effectiveType, rtt, downlink) ----------
    try {
      if (!navigator.connection) {
        const conn = {
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false,
          type: 'wifi',
          onchange: null,
        };
        Object.defineProperty(navigator, 'connection', { get: () => conn, configurable: true });
      }
    } catch (e) {}

    // ---------- DEVICE_ID 注入到 navigator.userAgentData.brands 作 brand 之一 ----------
    // (仅 standard/maximum 档; lite 档不加, 保持 stealth plugin 原行为)
    try {
      if (navigator.userAgentData && navigator.userAgentData.brands) {
        // 不破坏原 brands, 仅追加一个 device-id-like brand(用于服务端审计/会话关联)
        const brands = navigator.userAgentData.brands;
        // 不可直接 pushbrands 数组(只读), 用 Proxy 拦截
        Object.defineProperty(navigator.userAgentData, 'brands', {
          get: () => brands.concat([{ brand: 'DevID', version: DEVICE_ID.slice(0, 4) }]),
          configurable: true,
        });
      }
    } catch (e) {}

    // ---------- flag 1: navigator.webdriver = undefined (stealth plugin 已抹, 双保险) ----------
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
    } catch (e) {}

    // ---------- flag 2: window.chrome runtime object (stealth plugin 已造, 双保险) ----------
    try {
      if (!window.chrome) {
        window.chrome = {
          runtime: {},
          loadTimes: function () { return {}; },
          csi: function () { return {}; },
          app: {},
        };
      }
    } catch (e) {}

    // ---------- flag 3: navigator.plugins (PDF Viewer etc, stealth plugin 已配, 双保险) ----------
    try {
      if (!navigator.plugins || navigator.plugins.length === 0) {
        const fakePlugins = [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        ];
        Object.defineProperty(navigator, 'plugins', {
          get: () => fakePlugins,
          configurable: true,
        });
      }
    } catch (e) {}
  } catch (e) { /* 整体 try/catch 容错: 任一 flag 失败不影响其余 */ }
})();
  `.trim()
}

/**
 * 最大档位追加: font fingerprint / screen color depth / hardware
 * (与 standard 共享 noise 层, 此处补"硬件特征一致性"层)
 */
function buildMaximumStealthScript(seed: SessionSeed): string {
  return `
(() => {
  try {
    // ---------- font fingerprint: 抹平字体测量差异 ----------
    // 测宽结果加 ±0.5px 噪声, 防 canvas-based font fingerprint 探针对比
    const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
    if (origMeasureText) {
      CanvasRenderingContext2D.prototype.measureText = function (text) {
        const m = origMeasureText.call(this, text);
        // 基于种子+文本 hash 的稳定扰动: 同会话同文本得同结果(探针复测一致)
        let h = ${seed.canvasNoise};
        for (let i = 0; i < text.length; i++) h = ((h * 31) + text.charCodeAt(i)) | 0;
        const delta = ((h & 0xff) / 0xff - 0.5) * 0.5; // ±0.25px
        return {
          width: m.width + delta,
          actualBoundingBoxLeft: m.actualBoundingBoxLeft || 0,
          actualBoundingBoxRight: m.actualBoundingBoxRight || 0,
          actualBoundingBoxAscent: m.actualBoundingBoxAscent || 0,
          actualBoundingBoxDescent: m.actualBoundingBoxDescent || 0,
          fontBoundingBoxAscent: m.fontBoundingBoxAscent || 0,
          fontBoundingBoxDescent: m.fontBoundingBoxDescent || 0,
        };
      };
    }

    // ---------- screen color depth / pixel depth ----------
    try {
      Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });
      Object.defineProperty(screen, 'availWidth', { get: () => screen.width, configurable: true });
      Object.defineProperty(screen, 'availHeight', { get: () => screen.height - 40, configurable: true });
    } catch (e) {}

    // ---------- device ID cookie: 自动种 cookie 让服务端识别本"设备" ----------
    try {
      if (document.cookie.indexOf('_devid=') === -1) {
        document.cookie = '_devid=${seed.deviceId}; path=/; max-age=86400; SameSite=Lax';
      }
    } catch (e) {}
  } catch (e) {}
})();
  `.trim()
}

interface FetchResult {
  ok: boolean
  html: string
  status: number
  finalUrl: string
  cookies: Array<Record<string, unknown>>
  tier: StealthTier
}

// ---------- CDP 集成: Network.setUserAgentOverride + Page.addScriptToEvaluateOnNewDocument ----------

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

/** flag 12: CDP Network.setUserAgentOverride + userAgentMetadata(brands/mobile/platform 全自洽) */
async function applyCdpUaOverride(page: any, ua: string): Promise<void> {
  try {
    const cdp = await page.target().createCDPSession()
    // 解析 Chrome 版本生成 brands
    const chromeVer = ua.match(/Chrome\/(\d+)/)?.[1] || '152'
    const fullVer = `${chromeVer}.0.0.0`
    const brands = [
      { brand: 'Chromium', version: chromeVer },
      { brand: 'Google Chrome', version: chromeVer },
      { brand: 'Not:A-Brand', version: '24' },
    ]
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: ua,
      platform: 'Windows',
      userAgentMetadata: {
        brands,
        fullVersionList: [
          { brand: 'Chromium', version: fullVer },
          { brand: 'Google Chrome', version: fullVer },
          { brand: 'Not:A-Brand', version: '24.0.0.0' },
        ],
        fullVersion: fullVer,
        mobile: false,
        platform: 'Windows',
        platformVersion: '10.0.0',
        architecture: 'x86',
        bitness: '64',
        model: '',
        wow64: false,
      },
    })
  } catch (e) {
    // 失败容忍: stealth plugin 仍能抹平 JS 面, 仅头组侧缺失(降级路径)
  }
}

/** Page.addScriptToEvaluateOnNewDocument: 注入 stealth 脚本(在每个新文档创建前执行) */
async function injectStealthScripts(page: any, scripts: string[]): Promise<void> {
  try {
    const cdp = await page.target().createCDPSession()
    for (const script of scripts) {
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: script })
    }
  } catch (e) {
    // 降级: 用 page.evaluateOnNewDocument(可能不支持所有版本)
    try {
      for (const script of scripts) {
        await page.evaluateOnNewDocument(script)
      }
    } catch { /* 整体失败容忍 */ }
  }
}

/** Emulation.setDeviceMetricsOverride: 屏幕尺寸 + deviceScaleFactor */
async function applyDeviceMetrics(page: any, width: number, height: number): Promise<void> {
  try {
    const cdp = await page.target().createCDPSession()
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    })
  } catch (e) { /* 容忍: setViewport 兜底 */ }
}

// ---------- 最大档位: request interception (屏蔽 tracking/ads) ----------

const BLOCKED_REQUEST_PATTERNS = [
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /facebook\.net\/.*\/fbevents/i,
  /hotjar\.com/i,
  /mixpanel\.com/i,
  /segment\.io/i,
  /scorecardresearch\.com/i,
  /quantserve\.com/i,
  /criteo\.com/i,
  /taboola\.com/i,
  /outbrain\.com/i,
  /adservice\.google\./i,
  /amazon-adsystem\.com/i,
  /clarity\.ms/i,
  /bing\.com\/b\/at\.gif/i,
  /cnzz\.com/i,
  /umeng\.com/i,
  /baidu\.com\/hm\.js/i,
  /qq\.com\/qstats/i,
]

async function enableRequestInterception(page: any): Promise<void> {
  try {
    await page.setRequestInterception(true)
    page.on('request', (req: any) => {
      const url = req.url() || ''
      const type = req.resourceType()
      // R8-14: page.close() 后 pending request 事件可能仍触发, req.abort()/req.continue()
      // 在 detached request 上抛错 → unhandled rejection。把 abort/continue 包 try/catch
      try {
        // 屏蔽已知 tracking pixel / ad 网络; 图片/img/css/js 不阻断
        if (BLOCKED_REQUEST_PATTERNS.some((p) => p.test(url))) {
          return req.abort()
        }
        // 屏蔽 beacon 信标(type=ping)
        if (type === 'ping' || type === 'beacon') {
          return req.abort()
        }
        return req.continue()
      } catch { /* R8-14: detached request 上的 abort/continue 抛错, 静默吞掉防 unhandled rejection */ }
    })
  } catch (e) { /* 容忍: 失败则原样放行所有请求 */ }
}

// ---------- CF 挑战等待 + Turnstile 点击 + cf_clearance 兜底 ----------

const CF_CHALLENGE_MARKERS = [
  'challenge-platform', 'Just a moment', 'cf-chl', 'cf_chl_', 'attention required',
  'cf-turnstile', 'cf-browser-verification', 'checking your browser',
  '正在進行安全驗證', '正在驗證瀏覽器', '正在验证浏览器', '安全驗證',
]

function isCfChallenge(html: string): boolean {
  if (!html) return false
  const lower = html.toLowerCase()
  return CF_CHALLENGE_MARKERS.some((k) => lower.includes(k.toLowerCase()))
}

async function tryClickTurnstile(page: any): Promise<void> {
  try {
    const frames = page.frames()
    for (let i = 0; i < frames.length && i < 8; i++) {
      try {
        const frameUrl = frames[i].url() || ''
        const isCfFrame = /challenges\.cloudflare\.com|cdn-cgi\/challenge-platform/.test(frameUrl)
        const sel = isCfFrame ? 'input[type=checkbox]' : '.cf-turnstile input[type=checkbox]'
        const cnt = await frames[i].locator(sel).count().catch(() => 0)
        if (cnt === 0) continue
        await frames[i].click(sel, { timeout: 1500 }).catch(() => {})
        return
      } catch { /* 静默: 换下一个 frame */ }
    }
  } catch { /* 整体容忍 */ }
}

/** 等 CF challenge 自动放行, 最长 30s, 期间每 2s 尝试点 Turnstile checkbox */
async function waitCfChallenge(page: any, maxMs = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 2000))
    await tryClickTurnstile(page)
    try {
      const html = await page.content()
      if (!isCfChallenge(html)) return true
    } catch { /* 页面 reload 中, 继续 */ }
  }
  return false
}

/** 兜底: 先访问 /robots.txt(轻量页面) 拿 cf_clearance, 再回访目标 */
async function tryCfClearanceFallback(page: any, targetUrl: string, timeoutMs: number): Promise<boolean> {
  try {
    const u = new URL(targetUrl)
    const robotsUrl = `${u.origin}/robots.txt`
    await page.goto(robotsUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 15000) }).catch(() => {})
    await new Promise((r) => setTimeout(r, 1500))
    // 再回访目标
    const resp = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: timeoutMs }).catch(() => null)
    if (resp) {
      const html = await page.content().catch(() => '')
      return !isCfChallenge(html) && html.length > 200
    }
  } catch { /* 兜底失败容忍 */ }
  return false
}

// ---------- 主抓取流程 ----------

// R8-2: 全局注册表 —— 记录每个 in-flight 请求的 page 引用, 供 hard timeout 时强制关闭。
// 旧实现 Promise.race 让 timeoutPromise 抢先 reject, 但 fetchPromise 仍持有 page 引用,
// page.goto 卡死时 page.close() 在 fetchPage 的 finally 中要等 goto 完成才执行, 浏览器页累积
// 最终 OOM。修法: 在 fetchPage 入口把 page 写入 Map, /fetch 的 timeout 分支显式调 page.close()
// 强制中断 goto(同时 await 的 goto 会 reject, fetchPage finally 再 close 是 no-op)。
const activeFetchPages = new Map<string, { page: any; abort: AbortController }>()

async function fetchPage(url: string, tier: StealthTier, timeoutMs: number, reqId: string): Promise<FetchResult> {
  const b = await ensureBrowser()
  const page = await b.newPage()
  const abort = new AbortController()
  activeFetchPages.set(reqId, { page, abort })
  await page.setViewport({ width: 1920, height: 1080 })
  await page.setUserAgent(DEFAULT_UA)

  const sessionKey = sessionKeyOf(url)
  const seed = await getSeed(sessionKey)

  // 标准档+: CDP UA override + stealth 脚本注入
  if (tier === 'standard' || tier === 'maximum') {
    await applyCdpUaOverride(page, DEFAULT_UA)
    const scripts = [buildStandardStealthScript(seed)]
    if (tier === 'maximum') scripts.push(buildMaximumStealthScript(seed))
    await injectStealthScripts(page, scripts)
    await applyDeviceMetrics(page, 1920, 1080)
  }

  // 最大档位: request interception (屏蔽 tracking/ads)
  if (tier === 'maximum') {
    await enableRequestInterception(page)
  }

  let status = 0
  let finalUrl = url

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs })
    if (response) {
      status = response.status()
      finalUrl = page.url()
    }

    let html = await page.content()

    // CF challenge 检测: 等 30s + 尝试点 Turnstile
    if (isCfChallenge(html)) {
      const cleared = await waitCfChallenge(page, 30000)
      if (!cleared) {
        // 兜底: 先访问 /robots.txt 拿 cf_clearance
        const ok = await tryCfClearanceFallback(page, url, timeoutMs)
        if (ok) {
          finalUrl = page.url()
          status = 200
        }
      }
      await new Promise((r) => setTimeout(r, 1500))
      html = await page.content().catch(() => html)
    }

    // R8-21: cookies 用显式 URL 过滤 —— tryCfClearanceFallback 走过 /robots.txt (同 origin),
    // page.cookies() 无参返回所有域的 cookies, 但若 /robots.txt 响应设置了非目标域 cookie,
    // 调用方按目标 origin 存储会误归。显式传 targetUrl 让 puppeteer 仅返回匹配该 URL 的 cookies
    let cookies: any[]
    try {
      cookies = await page.cookies(url)
    } catch {
      // 显式 URL 过滤失败兜底: 全量取(原行为)
      cookies = await page.cookies().catch(() => [])
    }
    return { ok: html.length > 100, html, status, finalUrl, cookies: cookies as unknown as Array<Record<string, unknown>>, tier }
  } catch (e: any) {
    const html = await page.content().catch(() => '')
    return { ok: false, html, status, finalUrl, cookies: [], tier }
  } finally {
    activeFetchPages.delete(reqId)
    await page.close().catch(() => {})
  }
}

createBridgeServer({
  name: 'cloak-browser',
  port: PORT,
  idleTimeoutS: 250,
  selfTest: async () => {
    try {
      const b = await ensureBrowser()
      const page = await b.newPage()
      await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 10000 })
      const title = await page.title()
      await page.close()
      return title.length > 0
    } catch { return false }
  },
  async fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/health') {
      return json({
        ok: true,
        service: 'cloak-browser',
        port: PORT,
        browserReady: !!browser?.connected,
        inFlight,
        sessions: sessions.size,
        tiers: ['lite', 'standard', 'maximum'],
      })
    }
    if (u.pathname === '/fetch') {
      if (inFlight >= MAX_CONCURRENT) return json({ ok: false, error: '并发已满' }, 503)
      inFlight++
      // 硬超时包装: fetchPage 可能因浏览器 hang 而永不返回, 用 Promise.race 保证 inFlight 释放
      // R8-3: hard timeout 固定 120s —— 旧实现按 Content-Length 决定 30s/120s, 但 /fetch POST
      // 永远有 body, 30s 分支是死代码且不可配置; 统一 120s 与 fetchPage 内 timeoutMs 上限对齐
      const hardTimeout = 120000
      // R8-2: 生成 reqId 用于 activeFetchPages 注册 —— timeout 时通过 reqId 查找并强制 close page
      const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const fetchPromise = (async () => {
        const body: any = await req.json()
        const url = String(body?.url || '')
        if (!url || !/^https?:\/\//.test(url)) return { ok: false, error: 'url required' } as any
        const tier: StealthTier = body?.tier === 'standard' || body?.tier === 'maximum' ? body.tier : 'lite'
        const timeoutMs = Math.min(Number(body?.timeoutMs) || 30000, 120000)
        return await fetchPage(url, tier, timeoutMs, reqId)
      })()
      try {
        const result = await Promise.race([
          fetchPromise,
          new Promise<any>((_, reject) => setTimeout(() => {
            // R8-2: timeout 时显式 close page + abort, 防 hung page 泄漏 ——
            // fetchPage 的 finally 要等 page.goto 完成才执行, hung site 下 goto 卡死数分钟,
            // 浏览器页累积最终 OOM。这里强制 close 让 goto 立即 reject, finally 顺带执行清理
            const entry = activeFetchPages.get(reqId)
            if (entry) {
              try { entry.abort.abort() } catch { /* 已 abort, 忽略 */ }
              try { entry.page.close().catch(() => {}) } catch { /* page 已关, 忽略 */ }
            }
            reject(new Error('fetch hard timeout'))
          }, hardTimeout)),
        ])
        if (result.error) return json({ ok: false, error: result.error }, 400)
        return json({
          ok: result.ok,
          html: result.html,
          status: result.status,
          finalUrl: result.finalUrl,
          cookies: result.cookies?.slice(0, 20),
          tier: result.tier,
        })
      } catch (e: any) {
        // R8-2 兜底: timeout 已处理 page close, 这里再查一次防漏(极端情况下 timeout 回调
        // 还未执行就抛出 race reject, 或 fetchPromise 已 reject 但 page 仍在 activeFetchPages)
        const entry = activeFetchPages.get(reqId)
        if (entry) {
          try { entry.page.close().catch(() => {}) } catch { /* ignore */ }
        }
        return json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 502)
      } finally {
        inFlight = Math.max(0, inFlight - 1)
      }
    }
    return json({ ok: false, error: `未知路径 ${u.pathname}` }, 404)
  },
})

// feat-cloak-anticrawler E: SIGTERM 优雅关闭 —— 持久浏览器实例 + 在飞请求计数等待,
// 让父进程(Next.js)发 SIGTERM 时本服务也能干净退出, 不留 orphan chromium 进程。
// 重复触发幂等(inFlight > 0 时最多等 10s 后强制 exit, 避免被卡死)。
let cloakShutdownInProgress = false
async function shutdownCloakBrowser(sig: string): Promise<void> {
  if (cloakShutdownInProgress) return
  cloakShutdownInProgress = true
  console.log(`[cloak-browser] 收到 ${sig}, 开始优雅关闭(browser close + 等在飞)`)
  // 等在飞请求最多 10s(与 fetcher 端口径一致), 让进行中的 fetchPage 完成 cookie 回流
  const waitDeadline = Date.now() + 10_000
  while (inFlight > 0 && Date.now() < waitDeadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
  if (inFlight > 0) {
    console.warn(`[cloak-browser] 优雅关闭超时, 仍有 ${inFlight} 个在飞请求, 强制退出`)
  }
  try {
    if (browser) {
      await browser.close().catch(() => {})
      browser = null
    }
  } catch { /* 已死则忽略 */ }
  process.exit(0)
}
try {
  process.once('SIGTERM', () => { void shutdownCloakBrowser('SIGTERM') })
  process.once('SIGINT', () => { void shutdownCloakBrowser('SIGINT') })
} catch { /* 某些运行时 process 只读, 忽略 */ }
