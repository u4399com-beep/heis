// ============================================================
// Obscura — 本项目自研轻量无头浏览器引擎（--stealth 隐身模式）
//
// 设计要点:
//  - 基于 Playwright chromium 复用: 全局单例浏览器常驻 + 页面池(默认并发 2),
//    避免每次渲染冷启动 launch(~1s+) 的开销
//  - 默认开启 --stealth 隐身模式: STEALTH_INIT_SCRIPTS(静态抹平)+buildIdentityInitScript(按 UA 参数化身份脚本)
//    在每个页面文档创建前注入(全 frame), 抹平 navigator.webdriver / window.chrome / plugins /
//    WebGL / canvas / userAgentData / permissions 等 常见自动化指纹 (参考 puppeteer-extra-stealth
//    思路的本地精简实现); hh-d2: 另经 CDP Network.setUserAgentOverride(+userAgentMetadata) 让
//    【网络层 sec-ch-ua* 头】与 JS userAgentData 与 UA 字符串三方自洽(头组侧 JS 抹平不可达)
//  - 指纹随机化: 每个域名槽位首次创建时随机 视口/UA/dpr/locale/时区(移动性按 UA 派生, hh-d2)
//  - 挑战自动等待: 命中 Cloudflare("Just a moment...")/JS跳转壳等特征时,
//    每 1s 轮询 content 最多 challengeWaitMs, 等待站点侧自动放行
//  - Cookie 回传: 渲染完成后将 context.cookies() 转成 Set-Cookie 风格字符串
//    返回给 fetcher 写入 CookieJar —— HTTP 引擎与浏览器引擎凭证打通的关键
//    (如 cf_clearance 回流后, 纯 HTTP 抓取也能过盾)
//
// 隔离说明(重要): 页面池的每个槽位持有独立 BrowserContext(浏览器级隔离)。
//  - 同域名复用同一 context: 保留 cookie(挑战凭证/会话), 指纹稳定, 像真实回访用户
//  - 跨域名复用前销毁重建 context 并换新指纹: 杜绝 cookie/localStorage 跨站串扰
//    (若未来出现同域多账号等更细粒度隔离需求, 可将槽位桶改为 Map<domain, Slot[]>)
// ============================================================
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright'

// ---------- 类型定义 ----------
/** Obscura 渲染选项(全部可选) */
export interface ObscuraFetchOptions {
  /** 覆盖 UA(默认用随机指纹自带 UA); 传入后本次槽位使用该 UA */
  userAgent?: string
  /** goto 超时 ms, 默认 20000 */
  timeout?: number
  /** 渲染后等待出现的选择器(容忍超时) */
  waitSelector?: string
  /** 渲染后额外等待 ms */
  waitMs?: number
  /** 挑战特征等待上限 ms, 默认 15000 */
  challengeWaitMs?: number
  /** 渲染稳定化采样上限 ms(HTML 尺寸连续 2 次几乎不增长则提前结束), 默认 6000;
   *  解决 AJAX 页面在 waitMs 后仍持续注入内容(如章节列表延迟加载)被提前截取的问题 */
  settleMs?: number
  /** 渲染后需要点击以展开懒加载内容的选择器(如"点击展开完整目录"按钮);
   *  点击后自动等待 AJAX 注入, 再进入 settle 采样。找不到元素时静默跳过 */
  clickSelector?: string
  /** goto 时携带的 Referer */
  referer?: string
}

/** Obscura 抓取结果 */
export interface ObscuraFetchResult {
  html: string
  /** Set-Cookie 风格字符串数组: "name=value; path=/; domain=.example.com" */
  cookies: string[]
  /** 最终 URL(挑战页可能发生跳转) */
  finalUrl: string
  /** 本次是否经历了挑战等待 */
  challengeWaited: boolean
}

/** 浏览器指纹(用于 context 创建) */
export interface ObscuraFingerprint {
  viewport: { width: number; height: number }
  userAgent: string
  locale: string
  timezoneId: string
  colorScheme: 'light' | 'dark'
  deviceScaleFactor: number
  /** 是否移动端视口(用于 UA/触屏一致性) */
  mobile: boolean
}

// ---------- 指纹池 ----------
/** 桌面常见分辨率池 */
const DESKTOP_SIZES: Array<[number, number]> = [
  [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [2560, 1440],
]
/** 移动端常见分辨率池(逻辑像素) */
const MOBILE_SIZES: Array<[number, number]> = [
  [390, 844], [393, 852], [414, 896], [360, 800], [412, 915],
]
/** 与视口类别匹配的精简 UA 池(hh-d2: Chrome 137~140, 与 fetcher UA_POOL(ff 轮 http 链)同版本纪律。
 *  收窄为 Chromium 家族: 本引擎即 Chromium, Safari/Firefox UA 与之结构性不自洽
 *  (真 Safari 无 window.chrome/userAgentData/sec-ch-ua, 引擎侧无法完整伪装出该语义);
 *  HTTP 链池(ff UA_POOL)仍保留 Safari/Firefox 条目 —— 纯头组语义无 JS 配对面, 两者不冲突 */
const DESKTOP_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
]
const MOBILE_UAS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2102J2SC Build/TKQ1.220829.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.0.0 Mobile Safari/537.36',
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
function jitter(n: number, max: number): number {
  const d = Math.floor(Math.random() * (max * 2 + 1)) - max
  return Math.max(1, n + d)
}

/** UA 移动性判定(与 fetcher.isMobileUa 同语义; obscura 禁止反向 import fetcher 防循环依赖, 本地复制) */
export function isMobileUaLocal(ua: string): boolean {
  return /iPhone|iPad|Android|Mobile Safari|;\s*Mobile\//.test(ua)
}

/** 随机生成一份浏览器指纹(桌面/移动池 + 小幅抖动)
 *  hh-d2: 传入 UA 覆盖时移动性按 UA 派生(原先纯随机 22% —— Android UA 可能拿到桌面视口/
 *  无触屏 context, sec-ch-ua-mobile ?1 配 maxTouchPoints=0 自相矛盾, 探针实证暴露) */
export function randomFingerprint(overrides?: { userAgent?: string }): ObscuraFingerprint {
  const mobile = overrides?.userAgent ? isMobileUaLocal(overrides.userAgent) : Math.random() < 0.22
  if (mobile) {
    const [w, h] = pick(MOBILE_SIZES)
    return {
      viewport: { width: w, height: h },
      userAgent: overrides?.userAgent || pick(MOBILE_UAS),
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      colorScheme: 'light',
      // 移动端 DPR 绝大多数为 2, 少量低端机为 1 (1~2 随机)
      deviceScaleFactor: Math.random() < 0.82 ? 2 : 1,
      mobile: true,
    }
  }
  const [w, h] = pick(DESKTOP_SIZES)
  return {
    viewport: { width: jitter(w, 8), height: jitter(h, 8) },
    userAgent: overrides?.userAgent || pick(DESKTOP_UAS),
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    // 桌面端绝大多数为 1, 少量高分屏为 2 (1~2 随机)
    deviceScaleFactor: Math.random() < 0.88 ? 1 : 2,
    mobile: false,
  }
}

// ---------- UA 身份解析 + 参数化身份脚本(hh-d2 增强) ----------
// 目标: 同一 UA 下 navigator.userAgent/appVersion/platform/vendor/userAgentData(含高熵值)/
// window.chrome 有无/WebGL GPU 字符串/maxTouchPoints 全部自洽 —— 与 ff 轮 http 链指纹头组
// (fingerprintHeadersFor)同一套版本纪律: brands 版本 == UA Chrome 版本, Edge UA 必含 Edge 品牌,
// 移动 UA 必配 mobile:true + Android 平台。
type UaFamily = 'chromium' | 'safari' | 'firefox' | 'unknown'
interface UaIdentity {
  ua: string
  family: UaFamily
  os: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'other'
  mobile: boolean
  chromeVer: string
  edgeVer: string
  fullVersion: string
  navPlatform: string
  chPlatform: string
  vendor: string
  model: string
  platformVersion: string
  architecture: string
  bitness: string
  brands: Array<{ brand: string; version: string }>
  fullVersionList: Array<{ brand: string; version: string }>
  gpu: { vendor: string; renderer: string }
}

/** WebGL UNMASKED vendor/renderer 按 UA 平台取真实形态字符串(无 SwiftShader/Mesa 软渲染字样);
 *  原静态脚本统一掩蔽为 Intel Iris(macOS 形态) —— Windows/Linux/Android UA 下 GPU 字符串
 *  与平台矛盾本身即指纹(creepjs 类检测), hh-d2 改为按平台自洽 */
export const GPU_BY_OS: Record<UaIdentity['os'], { vendor: string; renderer: string }> = {
  windows: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  macos: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' },
  linux: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.6.0 NVIDIA 530.41.03)' },
  android: { vendor: 'Google Inc. (Qualcomm)', renderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)' },
  ios: { vendor: 'Apple Inc.', renderer: 'Apple GPU' },
  other: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
}

/** 从 UA 解析身份(brands 结构与 ff 轮 fingerprintHeadersFor 同构: Chromium/Google Chrome[/Edge]/Not:A-Brand) */
export function parseUaIdentity(ua: string): UaIdentity {
  const family: UaFamily = /Firefox\//.test(ua) ? 'firefox' : /Chrome\/|\bEdg\b/.test(ua) ? 'chromium' : /Safari\//.test(ua) ? 'safari' : 'unknown'
  const os: UaIdentity['os'] = /Android/.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Windows/.test(ua) ? 'windows' : /Mac OS|Macintosh/.test(ua) ? 'macos' : /X11|Linux|CrOS/.test(ua) ? 'linux' : 'other'
  const mobile = isMobileUaLocal(ua)
  const chromeVer = ua.match(/Chrome\/(\d+)/)?.[1] || ''
  const edgeVer = ua.match(/Edg(?:e|A|iOS)?\/(\d+)/)?.[1] || ''
  const navPlatform = /Android/.test(ua) ? 'Linux armv8l' : /iPad/.test(ua) ? 'MacIntel' : /iPhone/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Win32' : /Mac OS|Macintosh/.test(ua) ? 'MacIntel' : 'Linux x86_64'
  const chPlatform = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'Chrome OS' : /X11|Linux/.test(ua) ? 'Linux' : 'Windows'
  // ii-c 修前缺陷: 旧正则 /Android[^;)]*[;)]\s*([^;)]+?)(?:\s+Build\/\S+)?\s*\)/ 只认
  // "Android <ver>; <model>"两段形态, 三段 UA(Linux; U; Android 13; zh-cn; M2102J2SC Build/…)
  // 在捕获前存在 locale 中间段 → 整体失配 model=''(探针实证), 与 UA 字符串内可见机型矛盾;
  // 改为允许任意个 "; 分隔中间段后取最后一个段为机型(每段不含 ;/), 分词无歧义无回溯风险
  const model = /Android/.test(ua) ? ((ua.match(/Android[^;)]*(?:;[^;)]+)*;\s*([^;)]+?)(?:\s+Build\/\S+)?\s*\)/)?.[1] || '').trim()) : ''
  const platformVersion = /Android/.test(ua) ? (ua.match(/Android\s+([\d.]+)/)?.[1] || '') : /iPhone|iPad|iPod/.test(ua) ? (ua.match(/OS\s+(\d+[._]\d+)/)?.[1]?.replace('_', '.') || '') : /Windows/.test(ua) ? '10.0.0' : /Mac OS|Macintosh/.test(ua) ? '10.15.7' : ''
  const fullVersion = chromeVer ? `${chromeVer}.0.0.0` : ''
  const brands: Array<{ brand: string; version: string }> = []
  const fullVersionList: Array<{ brand: string; version: string }> = []
  if (chromeVer) {
    brands.push({ brand: 'Chromium', version: chromeVer }, { brand: 'Google Chrome', version: chromeVer })
    fullVersionList.push({ brand: 'Chromium', version: fullVersion }, { brand: 'Google Chrome', version: fullVersion })
    if (edgeVer) {
      brands.push({ brand: 'Microsoft Edge', version: edgeVer })
      fullVersionList.push({ brand: 'Microsoft Edge', version: `${edgeVer}.0.0.0` })
    }
    brands.push({ brand: 'Not:A-Brand', version: '24' })
    fullVersionList.push({ brand: 'Not:A-Brand', version: '24.0.0.0' })
  }
  return {
    ua,
    family,
    os,
    mobile,
    chromeVer,
    edgeVer,
    fullVersion,
    navPlatform,
    chPlatform,
    vendor: family === 'chromium' ? 'Google Inc.' : family === 'safari' ? 'Apple Computer, Inc.' : '',
    model,
    platformVersion,
    architecture: os === 'android' || os === 'ios' ? 'arm' : 'x86',
    bitness: '64',
    brands,
    fullVersionList,
    gpu: GPU_BY_OS[os],
  }
}

/** CDP Network.setUserAgentOverride 的 userAgentMetadata(仅 Chromium 家族; 实验证据: 传入后
 *  引擎按 metadata 生成 sec-ch-ua/sec-ch-ua-mobile/sec-ch-ua-platform 头并原生填充 JS
 *  userAgentData —— route 改写实验(基线③)证明 route.continue 删不掉原生 CH 头, CDP 是唯一通路) */
export function buildUaMetadata(id: UaIdentity): Record<string, unknown> {
  return {
    brands: id.brands,
    fullVersionList: id.fullVersionList,
    fullVersion: id.fullVersion,
    mobile: id.mobile,
    platform: id.chPlatform,
    platformVersion: id.platformVersion,
    architecture: id.architecture,
    bitness: id.bitness,
    model: id.model,
    wow64: false,
  }
}

/**
 * 按 UA 参数化的身份脚本(附加在 STEALTH_INIT_SCRIPTS 之后注入, 每个 frame 文档创建前执行):
 *  - UA/appVersion/platform/vendor/productSub 钉到身份值
 *  - Chromium 家族: navigator.userAgentData(brands/mobile/platform + getHighEntropyValues 全量高熵)
 *  - 非 Chromium(Safari/Firefox 语义): userAgentData 整体摘除(own+原型链 delete,
 *    in 判定与真 Safari 同为 false; 原型槽不可删时退回 own undefined 遮蔽)+ window.chrome 删除
 *    (真引擎无此物)
 *  - maxTouchPoints: 移动 5 / 桌面 0(与 context hasTouch 自洽; 原静态脚本强制 0 会与移动 UA 矛盾)
 *  - WebGL vendor/renderer 按 UA 平台自洽(覆盖静态脚本的通用掩蔽值)
 * 注: 必须在静态脚本之后注册 —— 覆盖其 UA/maxTouchPoints/WebGL 定义, 并在 Safari 分支
 * 抹掉静态脚本伪造的 window.chrome(原静态脚本 9 会在 DOMContentLoaded 把父页 chrome 重新
 * 挂进 iframe, 已随本增强移除, iframe 一致性改由 per-frame 身份脚本原生保证)
 */
export function buildIdentityInitScript(ua: string): string {
  const id = parseUaIdentity(ua)
  return '(function () {\n' +
    '  try {\n' +
    `    var I = ${JSON.stringify(id)};\n` +
    '    var nav = navigator;\n' +
    '    function def(obj, key, getter) { try { Object.defineProperty(obj, key, { get: getter, configurable: true }); } catch (e) {} }\n' +
    '    var appVersion = String(I.ua).replace(/^Mozilla\\//, \'\');\n' +
    "    def(nav, 'userAgent', function () { return I.ua; });\n" +
    "    def(nav, 'appVersion', function () { return appVersion; });\n" +
    "    def(nav, 'platform', function () { return I.navPlatform; });\n" +
    "    def(nav, 'vendor', function () { return I.vendor; });\n" +
    "    def(nav, 'vendorSub', function () { return ''; });\n" +
    "    def(nav, 'productSub', function () { return I.family === 'firefox' ? '20100101' : '20030107'; });\n" +
    "    def(nav, 'maxTouchPoints', function () { return I.mobile ? 5 : 0; });\n" +
    "    if (I.family === 'chromium') {\n" +
    '      var uad = {\n' +
    '        brands: I.brands.map(function (b) { return { brand: b.brand, version: b.version }; }),\n' +
    '        mobile: I.mobile,\n' +
    '        platform: I.chPlatform,\n' +
    '        toJSON: function () { return { brands: this.brands, mobile: this.mobile, platform: this.platform }; },\n' +
    '        getHighEntropyValues: function (hints) {\n' +
    '          return Promise.resolve().then(function () {\n' +
    '            var all = {\n' +
    '              architecture: I.architecture,\n' +
    '              bitness: I.bitness,\n' +
    '              model: I.model,\n' +
    '              mobile: I.mobile,\n' +
    '              platform: I.chPlatform,\n' +
    '              platformVersion: I.platformVersion,\n' +
    '              uaFullVersion: I.fullVersion,\n' +
    '              fullVersionList: I.fullVersionList.map(function (b) { return { brand: b.brand, version: b.version }; }),\n' +
    '              wow64: false,\n' +
    "              formFactors: [I.mobile ? 'Mobile' : 'Desktop']\n" +
    '            };\n' +
    '            var out = {};\n' +
    '            (hints || []).forEach(function (h) { if (Object.prototype.hasOwnProperty.call(all, h)) out[h] = all[h]; });\n' +
    '            return out;\n' +
    '          });\n' +
    '        }\n' +
    '      };\n' +
    "      def(nav, 'userAgentData', function () { return uad; });\n" +
    '    } else {\n' +
    // ii-c 修前残留: 仅 own delete + own undefined 遮蔽 —— Chromium 引擎下 userAgentData 若挂
    // 在 Navigator.prototype(own delete 删不掉原型槽), 探针实证 'userAgentData' in navigator
    // 恒 true(真 Safari: false, 值 undefined 但 in=false)反成特征。改为 own+原型链逐层 delete,
    // 全部删净则不落任何 own 属性(in=false 与真 Safari 一致); 原型槽不可配置删不掉时才退回
    // own undefined 遮蔽(旧行为兜底)
    '      try { delete nav.userAgentData; } catch (e) {}\n' +
    '      try {\n' +
    '        var up = Object.getPrototypeOf(nav);\n' +
    '        var uh = 0;\n' +
    '        while (up && uh < 4) {\n' +
    "          if (Object.prototype.hasOwnProperty.call(up, 'userAgentData')) {\n" +
    '            try { delete up.userAgentData; } catch (e2) {}\n' +
    '          }\n' +
    '          up = Object.getPrototypeOf(up);\n' +
    '          uh++;\n' +
    '        }\n' +
    '      } catch (e) {}\n' +
    "      if ('userAgentData' in nav) def(nav, 'userAgentData', function () { return undefined; });\n" +
    '    }\n' +
    "    if (I.family !== 'chromium') {\n" +
    '      try { delete window.chrome; } catch (e) { try { window.chrome = undefined; } catch (e2) {} }\n' +
    '    }\n' +
    '    (function () {\n' +
    '      try {\n' +
    '        var vendor = I.gpu.vendor, renderer = I.gpu.renderer;\n' +
    '        var patch = function (proto) {\n' +
    '          if (!proto || !proto.getParameter) return;\n' +
    '          var orig = proto.getParameter;\n' +
    '          proto.getParameter = function (p) {\n' +
    '            try {\n' +
    '              if (p === 37445) return vendor;\n' +
    '              if (p === 37446) return renderer;\n' +
    '              if (p === 7936) return \'WebKit\';\n' +
    '              if (p === 7937) return \'WebKit WebGL\';\n' +
    '            } catch (e) {}\n' +
    '            return orig.call(this, p);\n' +
    '          };\n' +
    '        };\n' +
    '        if (window.WebGLRenderingContext) patch(window.WebGLRenderingContext.prototype);\n' +
    '        if (window.WebGL2RenderingContext) patch(window.WebGL2RenderingContext.prototype);\n' +
    '      } catch (e) {}\n' +
    '    })();\n' +
    '  } catch (e) {}\n' +
    '})();'
}

// ---------- --stealth 注入脚本 ----------
// 每段脚本独立 try/catch 包裹, 任何一段异常都不影响页面正常运行。
// 说明: 脚本以字符串形式保存, 由 addInitScript 在每个文档(含 iframe)创建前执行。
export const STEALTH_INIT_SCRIPTS: string[] = [
  // 1. navigator.webdriver 抹平(hh-d2 重做): --disable-blink-features=AutomationControlled 下
  //    引擎原生即 real-Chrome 形态(prototype getter → false, 无 own 属性) —— 原方案
  //    "own 属性返回 undefined"反成特征('webdriver' in nav 为真但值 undefined, 真站
  //    bot.sannysoft.com "WebDriver (New)" 行实测标记 present/failed)。改为删 own 属性+
  //    兜底把 prototype 值钉 false(异常环境), 与真 Chrome 观测面逐点一致
  `(() => { try {
      const nav = navigator;
      try { delete nav.webdriver; } catch (e) {}
      try {
        let cur; try { cur = nav.webdriver; } catch (e) { cur = undefined; }
        if (cur !== false) {
          const proto = Object.getPrototypeOf(nav) || nav;
          Object.defineProperty(proto, 'webdriver', { get: function () { return false; }, configurable: true });
        }
      } catch (e) {}
      if ('webdriver' in window) { try { delete window.webdriver; } catch (e) {} }
    } catch (e) {} })();`,

  // 2. 伪 window.chrome 对象 (runtime/app/csi/loadTimes 细节)
  `(() => { try {
      if (window.chrome && window.chrome.runtime && window.chrome.app) return;
      const c = window.chrome || {};
      if (!c.app) {
        c.app = {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: function () { return null; },
          installState: function () { return 'not_installed'; },
        };
      }
      if (!c.runtime) {
        c.runtime = {
          PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
          PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
          RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          connect: function () { return null; },
          sendMessage: function () {},
          id: undefined,
        };
      }
      if (!c.csi) {
        c.csi = function () { return { onloadT: Date.now(), startE: Date.now(), pageT: Math.floor(Math.random() * 3000) + 100 }; };
      }
      if (!c.loadTimes) {
        c.loadTimes = function () {
          const t = Date.now() / 1000;
          return { requestTime: t, startLoadTime: t, commitLoadTime: t, finishDocumentLoadTime: t, finishLoadTime: t, firstPaintTime: t, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' };
        };
      }
      window.chrome = c;
    } catch (e) {} })();`,

  // 3. navigator.plugins / mimeTypes 伪造 (PDF Viewer 等 5 项, 数组行为完整)
  `(() => { try {
      const nav = navigator;
      const data = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', type: 'application/pdf', suffixes: 'pdf' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', type: 'application/pdf', suffixes: 'pdf' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', type: 'application/pdf', suffixes: 'pdf' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', type: 'application/pdf', suffixes: 'pdf' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format', type: 'application/pdf', suffixes: 'pdf' },
      ];
      const mtEnabled = function () { return this.enabledPlugin != null; };
      const plugins = data.map(function (p) {
        const plugin = { name: p.name, filename: p.filename, description: p.description, length: 1 };
        const mime = { type: p.type, suffixes: p.suffixes, description: p.description, enabledPlugin: plugin };
        Object.defineProperty(mime, 'enabledPlugin', { get: function () { return plugin; }, configurable: true });
        Object.defineProperty(plugin, '0', { value: mime, enumerable: true, configurable: true });
        plugin.item = function (i) { return i === 0 ? mime : null; };
        plugin.namedItem = function (n) { return n === p.type ? mime : null; };
        return plugin;
      });
      const mimeTypes = plugins.map(function (plugin, i) { return plugins[i]['0']; });
      const makeCollection = function (list, nameKey) {
        const coll = { length: list.length };
        list.forEach(function (item, i) { Object.defineProperty(coll, String(i), { value: item, enumerable: true, configurable: true }); });
        coll.item = function (i) { return i >= 0 && i < list.length ? list[i] : null; };
        coll.namedItem = function (n) {
          for (let i = 0; i < list.length; i++) { if (list[i][nameKey] === n) return list[i]; }
          // hh-d2: plugins 集合按 MIME 名二次命中(application/pdf) —— 各 PDF 插件均只挂
          // application/pdf 一个 MIME, 检测面常以 MIME 名直接检索 plugins.namedItem
          if (nameKey === 'name') {
            for (let i = 0; i < list.length; i++) { const m = list[i]['0']; if (m && m.type === n) return list[i]; }
          }
          return null;
        };
        coll.refresh = function () {};
        // hh-d2: 挂原生原型使 instanceof 通过(bot.sannysoft.com "Plugins is of type PluginArray"
        // 行实测 failed) —— own 的 item/namedItem/refresh/Symbol.iterator 遮蔽原型方法, 不会触发
        // 原生方法的 Illegal invocation; 逐 frame init 脚本在真引擎无 PluginArray 接口时静默跳过
        try {
          if (nameKey === 'name' && window.PluginArray) Object.setPrototypeOf(coll, window.PluginArray.prototype);
          else if (nameKey === 'type' && window.MimeTypeArray) Object.setPrototypeOf(coll, window.MimeTypeArray.prototype);
        } catch (e) {}
        try { Object.defineProperty(coll, Symbol.iterator, { value: Array.prototype[Symbol.iterator], configurable: true }); } catch (e) {}
        return coll;
      };
      // qq-e: 集合按文档缓存一次 —— 原实现 getter 每次访问都 makeCollection 新建,
      // navigator.plugins !== navigator.plugins 恒 true(真浏览器返回同一 PluginArray
      // 对象), 访问稳定性本身即指纹面。首次访问构建, 之后返回同一对象(逐 document
      // 独立: init 脚本在每个 frame/文档创建前重跑, 缓存变量随之重置, 无跨文档泄漏)
      // qq-e2 修正: 本数组是【注入浏览器的原生 JS 字符串】, 不得写 TS 类型注解 ——
      // addInitScript 原样下发, 带 unknown 注解的 let 声明在浏览器是 SyntaxError,
      // 整段 plugins/mimeTypes 伪装脚本静默全灭(new Function 编译实证, probe4 O2)。
      // 保留缓存语义, 仅去注解(守卫断言见 verify-qq-e2-obscura):
      let pluginsColl = null
      let mimeColl = null
      Object.defineProperty(nav, 'plugins', { get: function () { if (!pluginsColl) pluginsColl = makeCollection(plugins, 'name'); return pluginsColl; }, configurable: true });
      Object.defineProperty(nav, 'mimeTypes', { get: function () { if (!mimeColl) mimeColl = makeCollection(mimeTypes, 'type'); return mimeColl; }, configurable: true });
      try { Object.defineProperty(nav, 'javaEnabled', { value: function () { return false; }, configurable: true }); } catch (e) {}
    } catch (e) {} })();`,

  // 4. navigator.languages 固定为中文环境
  `(() => { try {
      Object.defineProperty(navigator, 'languages', { get: function () { return ['zh-CN', 'zh', 'en']; }, configurable: true });
      Object.defineProperty(navigator, 'language', { get: function () { return 'zh-CN'; }, configurable: true });
    } catch (e) {} })();`,

  // 5. hardwareConcurrency(4~16核)/deviceMemory(8GB) 随机合理值
  `(() => { try {
      const cores = [4, 6, 8, 8, 10, 12, 16][Math.floor(Math.random() * 7)];
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: function () { return cores; }, configurable: true });
      Object.defineProperty(navigator, 'deviceMemory', { get: function () { return 8; }, configurable: true });
      try { Object.defineProperty(navigator, 'maxTouchPoints', { get: function () { return 0; }, configurable: true }); } catch (e) {}
    } catch (e) {} })();`,

  // 6. WebGL vendor/renderer 掩蔽 (UNMASKED_VENDOR_WEBGL=37445 / UNMASKED_RENDERER_WEBGL=37446)
  `(() => { try {
      const vendor = 'Intel Inc.';
      const renderer = 'Intel Iris OpenGL Engine';
      const patch = function (proto) {
        if (!proto) return;
        const orig = proto.getParameter;
        if (!orig) return;
        proto.getParameter = function (p) {
          try {
            if (p === 37445) return vendor;
            if (p === 37446) return renderer;
            if (p === 7936) return 'WebKit';              // VENDOR
            if (p === 7937) return 'WebKit WebGL';        // RENDERER
          } catch (e) {}
          return orig.call(this, p);
        };
      };
      if (window.WebGLRenderingContext) patch(window.WebGLRenderingContext.prototype);
      if (window.WebGL2RenderingContext) patch(window.WebGL2RenderingContext.prototype);
    } catch (e) {} })();`,

  // 7. canvas 指纹噪声 (toDataURL/toBlob/getImageData 注入不可见微扰动; 不破坏正常渲染)
  `(() => { try {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      const addNoise = function (ctx, w, h) {
        try {
          if (!ctx || !w || !h || w * h > 4000000) return;
          const img = origGetImageData.call(ctx, 0, 0, w, h);
          const d = img.data;
          // 仅对 <0.1% 像素的 alpha 做 ±1 微扰, 视觉不可见但足以打乱哈希
          for (let i = 3; i < d.length; i += 4 * 128) {
            if (Math.random() < 0.35) d[i] = Math.max(0, Math.min(255, d[i] + (Math.random() < 0.5 ? 1 : -1)));
          }
          ctx.putImageData(img, 0, 0);
        } catch (e) {}
      };
      HTMLCanvasElement.prototype.toDataURL = function () {
        try { addNoise(this.getContext('2d'), this.width, this.height); } catch (e) {}
        return origToDataURL.apply(this, arguments);
      };
      HTMLCanvasElement.prototype.toBlob = function (cb) {
        try { addNoise(this.getContext('2d'), this.width, this.height); } catch (e) {}
        const rest = Array.prototype.slice.call(arguments, 1);
        return origToBlob.apply(this, [cb].concat(rest));
      };
      CanvasRenderingContext2D.prototype.getImageData = function () {
        const img = origGetImageData.apply(this, arguments);
        try {
          const d = img.data;
          for (let i = 3; i < d.length; i += 4 * 257) { if (d[i] > 0) d[i] = d[i] - 1; }
        } catch (e) {}
        return img;
      };
    } catch (e) {} })();`,

  // 8. permissions.query 对 notifications 恒返回 granted (headless 经典检测点)
  `(() => { try {
      const nav = navigator;
      if (!nav.permissions || !nav.permissions.query) return;
      const origQuery = nav.permissions.query.bind(nav.permissions);
      nav.permissions.query = function (parameters) {
        try {
          if (parameters && parameters.name === 'notifications') {
            return Promise.resolve({ state: 'granted', name: 'notifications', onchange: null });
          }
        } catch (e) {}
        return origQuery(parameters);
      };
      // hh-d2: Notification.permission 同步 granted —— 仅 query=granted 而 Notification.permission
      // 恒 denied 是自相矛盾的双暴露面(修前探针实证: query=granted Notification=denied)
      try {
        if (typeof Notification !== 'undefined') {
          Object.defineProperty(Notification, 'permission', { get: function () { return 'granted'; }, configurable: true });
        }
      } catch (e) {}
    } catch (e) {} })();`,

  // 9. [hh-d2 已移除] 原"同源 iframe 补挂 window.chrome"脚本 —— addInitScript 本就逐 frame
  //    执行(脚本 2 已在每 frame 造 chrome), 此脚本在 DOMContentLoaded 把父页 chrome 重新挂进
  //    iframe 反而破坏非 Chromium UA(Safari/Firefox 语义)下身份脚本删 chrome 后的一致性;
  //    iframe 指纹一致性改由 per-frame 身份脚本(buildIdentityInitScript)原生保证

  // 10. 屏蔽 HeadlessChrome 特征: UA/appVersion 中的 HeadlessChrome 字样替换为 Chrome
  `(() => { try {
      const fix = function (s) { return typeof s === 'string' ? s.replace(/HeadlessChrome/g, 'Chrome') : s; };
      const ua = fix(navigator.userAgent);
      const av = fix(navigator.appVersion);
      Object.defineProperty(navigator, 'userAgent', { get: function () { return ua; }, configurable: true });
      Object.defineProperty(navigator, 'appVersion', { get: function () { return av; }, configurable: true });
      if (navigator.vendor) {
        Object.defineProperty(navigator, 'vendor', { get: function () { return 'Google Inc.'; }, configurable: true });
      }
    } catch (e) {} })();`,
]

// ---------- 挑战特征识别 ----------
/** 强挑战特征(结构化标记, 一旦命中基本必是挑战页) */
const CHALLENGE_STRONG_MARKERS = [
  'just a moment', 'cf-browser-verification', 'cf_chl_', 'challenge-platform',
  'cf-chl', 'checking your browser', 'attention required', 'ddos-guard', 'challenge.js',
  'cf-turnstile',
  // Cloudflare 中文版 Turnstile 拦截页特征("请稍候…"标题 + 安全验证提示)
  '正在进行安全验证', '本网站使用安全服务',
  // 繁体变体(ixdzs 系"請稍等，正在進行安全驗證..."盾页), 与 fetcher.STRONG_BLOCK_MARKERS 对齐 ——
  // 原先 obscura 不识别繁体盾页, 挑战循环不等待直接把盾页当渲染结果返回给上层入库
  '正在進行安全驗證', '正在驗證瀏覽器', '正在验证浏览器', '安全驗證',
]
/** 软挑战特征(普通长页面正文中也可能出现, 需配合标题/长度守卫) */
const CHALLENGE_SOFT_MARKERS = [
  'captcha', '验证码', '人机验证', '安全验证', '滑动验证',
  '请开启javascript', 'enable javascript',
]

/** JS 跳转壳: 极短 + location 跳转脚本, 或 meta refresh 短页 */
export function isJsRedirectShell(html: string): boolean {
  const s = (html || '').trim()
  if (!s) return true
  const hasRedirect = /window\.location\s*[.[]|location\.href\s*=|location\.replace\s*\(|location\.assign\s*\(/.test(s)
  const hasRefresh = /http-equiv\s*=\s*["']?refresh/i.test(s)
  if (s.length < 1200 && hasRedirect) return true
  if (s.length < 1200 && hasRefresh) return true
  return false
}

function hasNormalTitle(html: string): boolean {
  const m = html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i)
  if (!m) return false
  const t = m[1].trim().toLowerCase()
  if (t.length < 2) return false
  // 标题本身就是挑战提示的不算正常标题
  const bad = ['just a moment', 'attention required', 'access denied', 'forbidden', '请开启', '验证', '驗證', '请稍候', '请稍後']
  return !bad.some((k) => t.includes(k))
}

/** 浏览器侧挑战判定: 命中强特征 / 软特征且非"长+正常标题"页 / JS跳转壳 */
export function looksLikeChallenge(html: string): boolean {
  if (isJsRedirectShell(html)) return true
  const lower = (html || '').toLowerCase()
  // CF JS Detections 脚本(challenge-platform/scripts/jsd/main.js)是 Bot Management 下
  // 正常页面普遍内嵌的探测脚本 —— 页面有正常标题且足够长时不算挑战(否则真实内容页
  // 会误触发 40s 挑战等待循环后抛超时, 101kks 实测)
  const jsdBenign = lower.includes('challenge-platform/scripts/jsd') && lower.length >= 1200 && hasNormalTitle(html)
  if (!jsdBenign && CHALLENGE_STRONG_MARKERS.some((k) => lower.includes(k))) return true
  if (CHALLENGE_SOFT_MARKERS.some((k) => lower.includes(k))) {
    // 长且带正常标题的真实内容页, 不因正文/导航提及"验证码"等词误判
    if (lower.length >= 1200 && hasNormalTitle(html)) return false
    return true
  }
  return false
}

// ---------- 单例浏览器 + 页面池 ----------
interface PoolSlot {
  ctx: BrowserContext
  page: Page
  /** 槽位当前绑定的 origin */
  domain: string
  fp: ObscuraFingerprint
  busy: boolean
  /** hh-d2: 保活的 CDP 会话(Network.setUserAgentOverride 随会话存活), 随槽位 context 一起销毁 */
  cdp?: CDPSession | null
}

/** chromium 启动参数: 防检测 + 容器环境兼容 */
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-infobars',
  '--window-size=1366,900',
  '--lang=zh-CN',
]

/** 页面池并发上限(可用 OBSCURA_CONCURRENCY 环境变量覆盖) */
const MAX_CONCURRENCY = (() => {
  const n = Number(process.env.OBSCURA_CONCURRENCY || '')
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2
})()
/** 空闲自动回收: 5 分钟无活动页面则关闭整个浏览器 */
const IDLE_CLOSE_MS = 5 * 60 * 1000
/** 探测失败后的重试间隔(避免服务器长时间反复白等 launch) */
const PROBE_RETRY_MS = 60_000

// 全局单例状态 (挂到 globalThis, 防 Next dev 热更新多实例)
interface ObscuraGlobal {
  pwModule?: typeof import('playwright') | null
  browser?: Browser | null
  launchPromise?: Promise<Browser> | null
  slots: PoolSlot[]
  pendingCreates: number
  waiters: Array<() => void>
  idleTimer?: ReturnType<typeof setTimeout> | null
  probeOk: boolean | null
  probeAt: number
  hooksRegistered: boolean
}
const globalForObscura = globalThis as unknown as { __obscuraState?: ObscuraGlobal }
const S: ObscuraGlobal = globalForObscura.__obscuraState ?? {
  pwModule: null,
  browser: null,
  launchPromise: null,
  slots: [],
  pendingCreates: 0,
  waiters: [],
  idleTimer: null,
  probeOk: null,
  probeAt: 0,
  hooksRegistered: false,
}
globalForObscura.__obscuraState = S

function originOf(url: string): string {
  try { return new URL(url).origin } catch { return '' }
}

/** hh-d2: CDP Network.setUserAgentOverride(+userAgentMetadata) —— 网络层 sec-ch-ua* 头与原生 JS
 *  userAgentData 由 metadata 驱动(route 改写删不掉引擎原生 CH 头, CDP 是唯一通路, 实验证据
 *  tmp/hh-d/baseline.json experiments.cdpMetadata: headerApplied=true + jsBrandsOk=true)。
 *  chromium 家族带 metadata(brands==UA 版本/移动性/平台全自洽); 非 chromium 家族(Safari/Firefox
 *  语义)仅覆 UA 字符串, JS 面一致性由身份脚本负责。失败容忍: 会话建立失败不阻塞渲染(JS 面仍有身份脚本) */
export async function applyUaCdpOverride(page: Page, ua: string): Promise<CDPSession | null> {
  try {
    const cdp = await page.context().newCDPSession(page)
    const id = parseUaIdentity(ua)
    const params: Record<string, unknown> = { userAgent: ua, platform: id.navPlatform }
    if (id.family === 'chromium') params.userAgentMetadata = buildUaMetadata(id)
    await (cdp as unknown as { send(method: string, p?: Record<string, unknown>): Promise<unknown> }).send(
      'Network.setUserAgentOverride',
      params,
    )
    return cdp
  } catch {
    return null
  }
}

async function ensureBrowser(): Promise<Browser> {
  if (S.browser && S.browser.isConnected()) return S.browser
  if (S.launchPromise) return S.launchPromise
  S.launchPromise = (async () => {
    if (!S.pwModule) {
      // 惰性 import('playwright'): 避免未用浏览器引擎时加载 ~几十ms 的模块开销
      S.pwModule = await import('playwright')
    }
    // playwright 类型无 any 滥用: launch 参数全部字面量
    const b = await S.pwModule.chromium.launch({ headless: true, args: LAUNCH_ARGS })
    // 浏览器重启(旧实例崩溃)时清空旧槽位, 避免持有已死 context
    const stale = S.slots.splice(0, S.slots.length)
    await Promise.allSettled(stale.map((s) => s.ctx.close().catch(() => {})))
    S.browser = b
    registerExitHooks()
    return b
  })()
  try {
    return await S.launchPromise
  } finally {
    S.launchPromise = null
  }
}

async function newStealthContext(fp: ObscuraFingerprint): Promise<BrowserContext> {
  const browser = await ensureBrowser()
  const ctx = await browser.newContext({
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    colorScheme: fp.colorScheme,
    deviceScaleFactor: fp.deviceScaleFactor,
    isMobile: fp.mobile,
    hasTouch: fp.mobile,
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6' },
  })
  for (const script of STEALTH_INIT_SCRIPTS) {
    await ctx.addInitScript(script)
  }
  // hh-d2: 按 UA 参数化的身份脚本 —— 必须在静态脚本之后注册(覆盖其 UA/platform/vendor/
  // maxTouchPoints/WebGL 定义), 使 JS 面与 UA 身份(含移动分支/Safari·Firefox 语义)逐 frame 自洽
  await ctx.addInitScript(buildIdentityInitScript(fp.userAgent))
  return ctx
}

async function createSlot(domain: string, fp: ObscuraFingerprint): Promise<PoolSlot> {
  const ctx = await newStealthContext(fp)
  try {
    const page = await ctx.newPage()
    const cdp = await applyUaCdpOverride(page, fp.userAgent)
    const slot: PoolSlot = { ctx, page, domain, fp, busy: true, cdp }
    S.slots.push(slot)
    return slot
  } catch (e) {
    // 修复: newPage 失败时关闭已创建的 context, 防止每次失败泄漏一个空 context
    try { await ctx.close().catch(() => {}) } catch { /* ignore */ }
    throw e
  }
}

/** 就地重建槽位: 关旧 context → 建新 context/page, 槽位对象引用保持不变(仍在 S.slots 中) */
async function recreateSlot(slot: PoolSlot, domain: string, fp: ObscuraFingerprint): Promise<void> {
  try { await slot.ctx.close().catch(() => {}) } catch { /* ignore */ }
  const ctx = await newStealthContext(fp)
  const page = await ctx.newPage()
  const cdp = await applyUaCdpOverride(page, fp.userAgent)
  slot.ctx = ctx
  slot.page = page
  slot.domain = domain
  slot.fp = fp
  slot.cdp = cdp
  slot.busy = true
}

function resetIdleTimer(): void {
  if (S.idleTimer) clearTimeout(S.idleTimer)
  // unref: 不阻止 CLI/一次性脚本自然退出
  S.idleTimer = setTimeout(() => {
    S.idleTimer = null
    if (S.slots.length > 0 && S.slots.every((s) => !s.busy)) {
      void shutdownObscura()
    }
  }, IDLE_CLOSE_MS)
  if (typeof S.idleTimer.unref === 'function') S.idleTimer.unref()
}

/** 进程退出/信号时尽力回收浏览器 */
function registerExitHooks(): void {
  if (S.hooksRegistered || typeof process === 'undefined') return
  S.hooksRegistered = true
  try {
    process.once('exit', () => { void shutdownObscura() })
    process.once('SIGINT', () => { void shutdownObscura().finally(() => process.exit(0)) })
    process.once('SIGTERM', () => { void shutdownObscura().finally(() => process.exit(0)) })
  } catch { /* 某些运行时只读, 忽略 */ }
}

/** 唤醒一个排队中的等待者(信号量释放/容量空出/失败重试路径都要调, 防等待者饿死) */
function wakeNext(): void {
  const next = S.waiters.shift()
  if (next) next()
}

/**
 * 从页面池获取一个 stealth 页面执行 fn, 用完释放不销毁。
 * - 同域名复用槽位: 保留 cookie(挑战凭证) 与指纹
 * - 跨域名复用: 销毁重建 context + 新指纹, 做好 cookie 隔离(见文件头隔离说明)
 * - 池满时排队等待(信号量语义, 并发默认 2)
 */
// ---------- 点击助手(主 frame + 跨域 iframe 全遍历, gg) ----------
/**
 * gg: clickSelector 跨域 iframe 支持(dd-d 上报引擎缺口) ——
 * page.click 只作用于主 frame, Turnstile/hCaptcha 类"复选框在 challenges.cloudflare.com
 * 跨域 iframe 内"的挑战无法交互。Playwright 的 frame 抽象原生支持跨源 frame 定位:
 * 遍历 page.frames() 逐 frame 尝试点击(首 frame=主 frame, 与原 page.click 行为一致),
 * 任一命中即返回 true; 全部未命中(含主 frame 无该元素 —— 列表页/正文页常态)返回 false,
 * 调用方保持既有"找不到静默跳过"语义不变。
 * 总闸 9s + 最多 8 frame: 防多 iframe 页面最坏 3s×N 拖慢采集; 单 frame 超时默认 3000ms
 * (与原 page.click 超时一致)。如实记录: 真实 Turnstile 无法在本沙箱验证(域内 iframe
 * 从未物化, dd-d 留档), 本增强为能力面补齐(verify-gg-a-frameclick 同构 mock 实证)。
 */
export async function clickSelectorAnywhere(page: Page, selector: string, perFrameTimeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + 9000
  const frames = page.frames()
  for (let i = 0; i < frames.length && i < 8; i++) {
    const remain = deadline - Date.now()
    if (remain <= 200) break
    try {
      // count() 立即返回不等待: 该 frame 明确无此元素则零开销跳过
      // (不烧 perFrame 超时 —— 主 frame 无按钮时不再白等 3s)
      const cnt = await frames[i].locator(selector).count()
      if (cnt === 0) continue
      await frames[i].click(selector, { timeout: Math.min(perFrameTimeoutMs, remain) })
      return true
    } catch { /* 有元素但点击失败(被遮挡/不可点/竞态消失): 换下一个 */ }
  }
  return false
}

export async function withObscuraPage<T>(
  url: string,
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts: { userAgent?: string } = {}
): Promise<T> {
  const domain = originOf(url)
  if (!domain) throw new Error(`Obscura: 无效 URL: ${url}`)
  let slot: PoolSlot | null = null
  try {
    // 信号量获取
    for (;;) {
      // 修复: 优先复用同域空闲槽位 —— 原先 find(!busy) 拿到哪个算哪个, 两个空闲槽
      // 分属不同域时跨域请求会撞掉另一个域的 context(cookie/指纹被无谓销毁重建)
      const free = S.slots.find((s) => !s.busy && s.domain === domain && !s.page.isClosed())
        ?? S.slots.find((s) => !s.busy)
      if (free) {
        free.busy = true // 先占位再异步重建, 防止并发抢占同一空槽
        if (free.domain !== domain || free.page.isClosed()) {
          try {
            await recreateSlot(free, domain, randomFingerprint({ userAgent: opts.userAgent }))
          } catch (e) {
            free.busy = false // 重建失败归还槽位(旧 ctx 已关, 下次获取时会再次重建)
            // 修复: 失败路径也必须唤醒一个等待者, 否则排队的请求会永久饥饿挂起
            wakeNext()
            throw e
          }
        }
        slot = free
        break
      }
      if (S.slots.length + S.pendingCreates < MAX_CONCURRENCY) {
        S.pendingCreates++
        try {
          slot = await createSlot(domain, randomFingerprint({ userAgent: opts.userAgent }))
        } finally {
          S.pendingCreates--
          // 建槽失败时容量已释放, 唤醒一个等待者去重试(否则等待队列可能永久挂起)
          wakeNext()
        }
        break
      }
      await new Promise<void>((resolve) => S.waiters.push(resolve))
    }
    resetIdleTimer()
    return await fn(slot.page, slot.ctx)
  } finally {
    if (slot) {
      slot.busy = false
      wakeNext()
      resetIdleTimer()
    }
  }
}

// ---------- 可用性探测 ----------
/**
 * 探测 Obscura 是否可用(成功后浏览器实例保留为单例直接复用, 不浪费 launch)。
 * 失败结果缓存 PROBE_RETRY_MS, 之后允许重新探测(例如 chromium 后装场景)。
 */
export async function checkObscuraAvailable(): Promise<boolean> {
  if (S.probeOk === true && S.browser && S.browser.isConnected()) return true
  if (S.probeOk === false && Date.now() - S.probeAt < PROBE_RETRY_MS) return false
  try {
    const b = await ensureBrowser()
    S.probeOk = b.isConnected()
  } catch (e: unknown) {
    // any 规避: 统一取 message 即可
    const msg = (e as { message?: string })?.message
    console.warn('[obscura] chromium 不可用:', (msg || String(e)).slice(0, 120))
    S.probeOk = false
  }
  S.probeAt = Date.now()
  return S.probeOk
}

// ---------- 挑战自动等待渲染 ----------
/**
 * --stealth 模式渲染:
 * 1. goto(domcontentloaded) → 读 content
 * 2. 命中挑战特征 → 每 1s 轮询 content+url, 最多 challengeWaitMs(默认 40s), 通过即止
 * 3. waitSelector(容忍超时)/waitMs 支持
 * 4. 全量回传 context.cookies() 为 Set-Cookie 风格字符串数组
 */
export async function renderStealth(url: string, opts: ObscuraFetchOptions = {}): Promise<ObscuraFetchResult> {
  const timeout = opts.timeout ?? 20000
  // Turnstile 管理型挑战(无交互自动验证)常需 10~25s, 慢尾可达 35s+, 默认 40s 上限
  const challengeWaitMs = opts.challengeWaitMs ?? 40000
  return withObscuraPage(url, async (page, ctx) => {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout,
        ...(opts.referer ? { referer: opts.referer } : {}),
      })
    } catch (e: any) {
      // 修复: CF 管理型挑战会扣住导航直至验证通过, goto 常在 domcontentloaded 前超时,
      // 但页面其实活着且后续会自动 reload —— 只有超时类错误才落入下方挑战等待循环抢救,
      // 其余(DNS/连接拒绝)照常抛出; about:blank 空页也不抢救防把空壳当成功内容
      const msg = String(e?.message || e)
      if (!/timeout|timed?\s?out/i.test(msg) || page.url() === 'about:blank') throw e
    }
    let html = await page.content()
    let challengeWaited = false

    // —— 挑战等待循环: CF 等盾会自动验证并刷新页面 ——
    const start = Date.now()
    while (looksLikeChallenge(html) && Date.now() - start < challengeWaitMs) {
      challengeWaited = true
      await page.waitForTimeout(1000)
      try {
        html = await page.content()
      } catch {
        // 修复: 盾通过时页面正在 reload, content() 会抛 "Execution context destroyed";
        // 置空让 isJsRedirectShell('')=true 继续轮询, 下一轮即可拿到真实页面
        html = ''
      }
    }
    if (challengeWaited) {
      // 盾通过后页面通常自动 reload, 等 DOM 稳定再取内容
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(500)
      try { html = await page.content() } catch { /* 保持上一轮内容 */ }
    }

    // 挑战未通过: 抛错交由调用方降级/重试, 绝不能把挑战拦截页当成功内容返回
    // (否则清洗/解析流程会把"请稍候…"拦截页存进数据库);
    // 提前到 waitSelector/settle 采样之前: 失败时不再白等最多 ~14s 才报错
    if (looksLikeChallenge(html)) {
      throw new Error(`Obscura 挑战等待超时(${Math.round(challengeWaitMs / 1000)}s)仍未通过: ${(() => { try { return new URL(url).hostname } catch { return url } })()}`)
    }

    if (opts.waitSelector) {
      await page.waitForSelector(opts.waitSelector, { timeout: opts.waitMs || 8000 }).catch(() => { /* 容忍超时 */ })
    }
    if (opts.waitMs) await page.waitForTimeout(opts.waitMs)

    // —— 点击展开懒加载内容(ixdzs/101kks 系"点击展开全部目录"交互)——
    // AJAX 预取了数据但只有点击才注入 DOM; gg: 主 frame+跨域 iframe 全遍历
    // (Turnstile/hCaptcha 类挑战复选框在跨域 iframe 内, dd-d 缺口补齐);
    // 找不到元素(列表页/正文页)时静默跳过(全 frame 未命中=false → 跳过, 语义不变)
    if (opts.clickSelector) {
      const clicked = await clickSelectorAnywhere(page, opts.clickSelector)
      if (clicked) await page.waitForTimeout(1200)
    }

    // —— 渲染稳定化采样: AJAX 页面在 waitMs 后仍可能持续注入内容(章节列表延迟加载、
    // 段落客户端组装等), 每 700ms 采样 HTML 尺寸, 连续 2 次增长 <0.5% 视为稳定;
    // 最多再等 settleMs(默认 6000), 稳定后提前退出避免无谓延迟
    const settleMs = opts.settleMs ?? 6000
    if (settleMs > 0) {
      const settleStart = Date.now()
      let lastLen = html.length
      try { lastLen = (await page.content()).length } catch { /* 导航中: 用上一轮长度 */ }
      let stable = 0
      while (Date.now() - settleStart < settleMs && stable < 2) {
        await page.waitForTimeout(700)
        let len = lastLen
        try { len = (await page.content()).length } catch { break /* 页面导航中 */ }
        if (Math.abs(len - lastLen) <= Math.max(64, lastLen * 0.005)) stable++
        else stable = 0
        lastLen = len
      }
    }

    let finalHtml = html
    // 点击"展开"按钮可能实为链接触发整页导航: content() 在导航提交期间会抛
    // "Execution context destroyed", 单次失败退回上一轮采样会把点击前的空目录当最终结果;
    // 短退避重试拿导航后的真实内容, 重试耗尽仍失败才退回上一轮
    for (let retry = 0; retry < 3; retry++) {
      try { finalHtml = await page.content(); break } catch {
        if (retry === 2) break
        try { await page.waitForTimeout(700) } catch { break /* 页面已销毁 */ }
      }
    }

    // 双重保险: waitSelector/settle 期间延迟加载的挑战页(如二次盾)仍要拦住
    if (looksLikeChallenge(finalHtml)) {
      throw new Error(`Obscura 渲染结果仍为挑战页: ${(() => { try { return new URL(url).hostname } catch { return url } })()}`)
    }

    // —— Cookie 回传: 转为 Set-Cookie 风格字符串, 供 fetcher 写入 CookieJar ——
    // 域过滤: context 里可能混有挑战/重定向过程中第三方域的 Cookie, 全量回传会被
    // fetcher 存进目标域的 CookieJar 造成跨域串味; 只保留与目标 host 匹配的条目
    let host = ''
    try { host = new URL(url).hostname.toLowerCase() } catch { /* url 已在入口校验 */ }
    const domainMatch = (cookieDomain?: string): boolean => {
      if (!host) return true
      const bare = (cookieDomain || '').replace(/^\./, '').toLowerCase()
      if (!bare) return true
      return host === bare || host.endsWith('.' + bare)
    }
    const cookies = await ctx.cookies()
    const cookieStrings = cookies
      .filter((c) => domainMatch(c.domain))
      .map((c) => {
        const parts = [`${c.name}=${c.value}`, `path=${c.path || '/'}`, `domain=${c.domain}`]
        if (c.secure) parts.push('Secure')
        if (c.httpOnly) parts.push('HttpOnly')
        return parts.join('; ')
      })

    return {
      html: finalHtml,
      cookies: cookieStrings,
      finalUrl: page.url(),
      challengeWaited,
    }
  }, { userAgent: opts.userAgent })
}

// ---------- 统一入口 ----------
/** Obscura 抓取: 不可用时抛错(由调用方决定降级策略) */
export async function obscuraFetch(url: string, opts: ObscuraFetchOptions = {}): Promise<ObscuraFetchResult> {
  const ok = await checkObscuraAvailable()
  if (!ok) throw new Error('Obscura 不可用: chromium 未安装或启动失败')
  return renderStealth(url, opts)
}

/** 主动关闭浏览器与页面池(空闲回收/进程退出/测试收尾时调用) */
export async function shutdownObscura(): Promise<void> {
  if (S.idleTimer) { clearTimeout(S.idleTimer); S.idleTimer = null }
  const slots = S.slots.splice(0, S.slots.length)
  await Promise.allSettled(slots.map((s) => s.ctx.close().catch(() => {})))
  const b = S.browser
  S.browser = null
  S.probeOk = null
  S.probeAt = 0
  // 唤醒所有等待者: 让它们重新评估(浏览器已关, 按需重建或快速失败), 防止永久挂起
  const waiters = S.waiters.splice(0, S.waiters.length)
  for (const w of waiters) w()
  if (b) {
    try { await b.close() } catch { /* 已死则忽略 */ }
  }
}
