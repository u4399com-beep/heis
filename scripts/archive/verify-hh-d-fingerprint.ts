// ============================================================
// hh-d 浏览器指纹暴露面探针 — Playwright 引擎真实指纹对抗测试
//
// 三段模式:
//   bun scripts/verify-hh-d-fingerprint.ts baseline   修前基线: ①裸 Playwright(两种 UA 形态)
//                                                     + ②Obscura 现防护 全量留档 tmp/hh-d/baseline.json
//                                                     + 头组对抗实验证据(CDP metadata vs route 改写)
//   bun scripts/verify-hh-d-fingerprint.ts verify     增强后断言: Obscura 增强态 0 暴露(逐项)
//                                                     + 截图存 tmp/hh-d/
//   bun scripts/verify-hh-d-fingerprint.ts real       真实检测站: bot.sannysoft.com 逐项截图
//                                                     + abrahamjuliot.github.io/creepjs 信任分数
//                                                     (串行+2s 间隔, 仅观察不留依赖, 不可达如实留档跳过)
//
// 探针页为本脚本内嵌 HTML(loopback node:http/Bun.serve 加载, 可离线复跑), 服务端把本次请求
// 回显头(sec-ch-ua*/user-agent)注入页面 —— UA ↔ navigator.userAgentData ↔ Sec-CH-UA 三方
// 自洽可在一页内对照。检测项(10 项, 前 9 项=脚本可修面, 第 10 项=平台级记录):
//   1 navigator.webdriver 暴露      2 UA↔UA-CH brands↔Sec-CH-UA 头三方自洽(+platform/vendor)
//   3 window.chrome 对象形态        4 permissions.query notifications 语义
//   5 plugins/languages/hardwareConcurrency/deviceMemory/maxTouchPoints 合理性
//   6 WebGL vendor/renderer 软件渲染特征   7 canvas 指纹(空白特征+与裸基线哈希同源+稳定性)
//   8 Notification.permission 恒 denied 特征   9 iframe contentWindow 一致性
//  10 CDP Runtime.enable console.debug 序列法(getter 副作用; Playwright 平台固有面, 单独归档)
// 运行注意: playwright bun 脚本 import 项目模块 → 显式 process.exit
// ============================================================
export {}

declare const Bun: {
  serve(opts: { port: number; fetch: (req: Request) => Response }): { stop(stopActive?: boolean): void }
  write(path: string, data: Uint8Array | string): Promise<number>
}
declare function require(id: string): unknown

import * as fs from 'fs'
import path from 'path'

// ---------- 产物目录 ----------
const OUT_DIR = '/home/z/my-project/tmp/hh-d'
fs.mkdirSync(OUT_DIR, { recursive: true })
function saveJson(name: string, data: unknown): void {
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2))
}
function saveShot(name: string, buf: Buffer): void {
  fs.writeFileSync(path.join(OUT_DIR, name), buf)
}

// ---------- 测矩阵 UA(与增强后 obscura UA 池同源: Chromium 家族 137~140 + 非 Chromium 对照) ----------
const MATRIX: Array<{ key: string; ua: string; note: string }> = [
  { key: 'win', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36', note: '桌面 Windows Chrome' },
  { key: 'mac', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36', note: '桌面 macOS Chrome' },
  { key: 'linux', ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', note: '桌面 Linux Chrome' },
  { key: 'edge', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0', note: '桌面 Windows Edge' },
  { key: 'android', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36', note: '移动 Android Chrome' },
  { key: 'safari', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', note: '非 Chromium 对照: Safari(Chromium 引擎语义抹平面)' },
]
const GATE_KEYS = ['win', 'mac', 'linux', 'edge', 'android'] // 0 暴露门槛矩阵(脚本可修面)
const CHROME_VER_RE = /Chrome\/(\d+)/
const EDGE_VER_RE = /Edg\/(\d+)/
function isMobileUa(ua: string): boolean {
  return /iPhone|iPad|Android|Mobile Safari|;\s*Mobile\//.test(ua)
}
function uaFamilyOf(ua: string): 'chromium' | 'safari' | 'firefox' | 'unknown' {
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Chrome\/|\bEdg\b/.test(ua)) return 'chromium'
  if (/Safari\//.test(ua)) return 'safari'
  return 'unknown'
}
function uaPlatformHint(ua: string): string {
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad|iOS|iPhone OS/.test(ua)) return 'iOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS|Macintosh/.test(ua)) return 'macOS'
  if (/CrOS/.test(ua)) return 'Chrome OS'
  if (/X11|Linux/.test(ua)) return 'Linux'
  return 'Windows'
}
/** navigator.platform 期望值(增强层以同一映射注入) */
function navPlatformFor(ua: string): string {
  if (/Android/.test(ua)) return 'Linux armv8l'
  if (/Windows/.test(ua)) return 'Win32'
  if (/Mac OS|Macintosh/.test(ua)) return 'MacIntel'
  return 'Linux x86_64'
}

// ---------- 探针页(内嵌 HTML; __REQ_HEADERS__ 由服务端注入本次请求回显头) ----------
const PROBE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>hh-d fingerprint probe</title></head>
<body><div id="pad">指纹探针页(离线内嵌, 无外部资源)。填充文本以保证页面长度:
${'探针填充文本用于通过引擎长度启发式。'.repeat(40)}</div>
<iframe id="probe-frame" width="10" height="10" style="border:0"></iframe>
<script>
(function () {
  var HEADERS = __REQ_HEADERS__;
  function djb2(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(16);
  }
  function probe() {
    var out = {};
    var ua = navigator.userAgent;
    out.ua = ua;
    out.headlessInUa = /HeadlessChrome/i.test(ua);
    // 1 webdriver
    var wd;
    try { wd = navigator.webdriver; } catch (e) { wd = 'throw'; }
    out.webdriver = (typeof wd === 'undefined') ? 'undefined' : String(wd);
    out.webdriverInNav = false;
    try { out.webdriverInNav = 'webdriver' in navigator; } catch (e) {}
    // 2 userAgentData(JS 面)
    var uad = null;
    try { uad = navigator.userAgentData || null; } catch (e) {}
    var high = null;
    if (uad && typeof uad.getHighEntropyValues === 'function') {
      try {
        return uad.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList']).then(function (h) {
          high = h;
          return finish();
        }).catch(function () { return finish(); });
      } catch (e) { /* fallthrough */ }
    }
    return Promise.resolve().then(finish);
    function finish() {
      out.uaData = uad ? {
        brands: (uad.brands || []).map(function (b) { return b.brand + ';v=' + b.version; }),
        mobile: !!uad.mobile,
        platform: uad.platform || '',
        high: high ? {
          architecture: high.architecture || '', bitness: high.bitness || '', model: high.model || '',
          platformVersion: high.platformVersion || '', uaFullVersion: high.uaFullVersion || '',
          fullVersionList: (high.fullVersionList || []).map(function (b) { return b.brand + ';v=' + b.version; })
        } : null
      } : null;
      // 头组(服务端回显)
      out.hdr = {
        ua: HEADERS['user-agent'] || '',
        secChUa: HEADERS['sec-ch-ua'] || null,
        mobile: HEADERS['sec-ch-ua-mobile'] || null,
        platform: HEADERS['sec-ch-ua-platform'] || null
      };
      // 3 window.chrome 形态
      out.chromeObj = {
        exists: typeof window.chrome !== 'undefined',
        app: !!(window.chrome && window.chrome.app),
        runtime: !!(window.chrome && window.chrome.runtime),
        csi: typeof (window.chrome && window.chrome.csi) === 'function',
        loadTimes: typeof (window.chrome && window.chrome.loadTimes) === 'function'
      };
      // 4 permissions.query(notifications)
      var p = Promise.resolve('no-api');
      if (navigator.permissions && navigator.permissions.query) {
        p = navigator.permissions.query({ name: 'notifications' }).then(function (r) { return String(r.state); })
          .catch(function (e) { return 'throw:' + String(e && e.name || e); });
      }
      return p.then(function (permState) {
        out.permissionsNotifications = permState;
        out.notificationPermission = (typeof Notification !== 'undefined') ? String(Notification.permission) : 'absent';
        // 5 合理性
        out.pluginsLength = navigator.plugins ? navigator.plugins.length : -1;
        try { out.pluginsPdf = !!(navigator.plugins && navigator.plugins.namedItem && navigator.plugins.namedItem('application/pdf')); } catch (e) { out.pluginsPdf = false; }
        out.languages = (navigator.languages || []).slice ? (navigator.languages || []).slice(0, 6) : [];
        out.hardwareConcurrency = navigator.hardwareConcurrency || null;
        out.deviceMemory = (typeof navigator.deviceMemory === 'number') ? navigator.deviceMemory : null;
        out.platform = navigator.platform || '';
        out.vendor = navigator.vendor || '';
        out.maxTouchPoints = navigator.maxTouchPoints || 0;
        // 窗口几何(记录项)
        out.outerWidth = window.outerWidth || 0;
        out.outerHeight = window.outerHeight || 0;
        out.innerWidth = window.innerWidth || 0;
        out.screen = { w: screen.width || 0, h: screen.height || 0, availH: screen.availHeight || 0, depth: screen.colorDepth || 0 };
        out.dpr = window.devicePixelRatio || 0;
        // 6 WebGL vendor/renderer
        (function () {
          var gl = null;
          try {
            var c = document.createElement('canvas');
            gl = c.getContext('webgl') || c.getContext('experimental-webgl');
          } catch (e) {}
          if (!gl) { out.webgl = { vendor: null, renderer: null, error: 'no-context' }; return; }
          try {
            var dbg = gl.getExtension('WEBGL_debug_renderer_info');
            out.webgl = {
              vendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
              renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
            };
          } catch (e) { out.webgl = { vendor: null, renderer: null, error: String(e) }; }
        })();
        // 7 canvas 指纹
        (function () {
          try {
            var c = document.createElement('canvas');
            c.width = 240; c.height = 60;
            var ctx = c.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '15px "Arial"';
            ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 100, 20);
            ctx.fillStyle = '#069'; ctx.fillText('Cwm fjordbank glyphs vext quiz \\u{1F603}', 2, 15);
            ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('hh-d probe \\u4f60\\u597d', 4, 30);
            var url1 = c.toDataURL();
            var url2 = c.toDataURL();
            var blank = true;
            try {
              var d = ctx.getImageData(0, 0, c.width, c.height).data;
              for (var i = 0; i < d.length; i++) { if (d[i] !== 0) { blank = false; break; } }
            } catch (e) { blank = false; }
            out.canvas = { hash: djb2(url1), hash2: djb2(url2), stable: url1 === url2, len: url1.length, blank: blank };
          } catch (e) { out.canvas = { error: String(e) }; }
        })();
        // 9 iframe contentWindow 一致性(iframe 于页面加载即创建, 此处已过注入窗口)
        (function () {
          try {
            var f = document.getElementById('probe-frame');
            var cw = f && f.contentWindow;
            out.iframe = cw ? {
              chromeExists: typeof cw.chrome !== 'undefined',
              chromeApp: !!(cw.chrome && cw.chrome.app),
              chromeRuntime: !!(cw.chrome && cw.chrome.runtime),
              uaDataExists: !!(cw.navigator && cw.navigator.userAgentData),
              uadBrands: (cw.navigator && cw.navigator.userAgentData && cw.navigator.userAgentData.brands || []).map(function (b) { return b.brand + ';v=' + b.version; })
            } : null;
          } catch (e) { out.iframe = { error: String(e) }; }
        })();
        // 10 CDP Runtime.enable console.debug 序列法(getter 副作用探测)
        out.cdp = (function () {
          var r = {};
          function mk() {
            var hit = false;
            var o = {};
            try { Object.defineProperty(o, 'leakKey', { get: function () { hit = true; return 1; }, configurable: true }); } catch (e) {}
            return { o: o, get: function () { return hit; } };
          }
          try { var a = mk(); console.debug(a.o); r.direct = a.get(); } catch (e) { r.direct = 'err'; }
          try { var b = mk(); console.debug('%o', b.o); r.fmt = b.get(); } catch (e) { r.fmt = 'err'; }
          try { var c2 = mk(); console.debug({ nested: c2.o }); r.nested = c2.get(); } catch (e) { r.nested = 'err'; }
          r.leaked = r.direct === true || r.fmt === true || r.nested === true;
          try { console.clear && console.clear(); } catch (e) {}
          return r;
        })();
        window.__FP = out;
        window.__FP_DONE = true;
        return out;
      });
    }
  }
  window.__FP_RUN = probe;
  probe();
})();
</script></body></html>`

// ---------- loopback 探针服务(每 UA 独立端口 = 独立 origin = Obscura 独立槽位, 强制指纹互不串扰) ----------
const PORT_BASE = 18921
const ports: Record<string, number> = {}
MATRIX.forEach((m, i) => { ports[m.key] = PORT_BASE + i })
function urlFor(key: string): string {
  return `http://127.0.0.1:${ports[key]}/`
}
const servers: Array<ReturnType<typeof Bun.serve>> = []
function startServers(): void {
  for (const key of Object.keys(ports)) {
    servers.push(Bun.serve({
      port: ports[key],
      fetch: (req) => {
        const headers: Record<string, string> = {}
        req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
        // 防 </script> 提前闭合(头组值不可能含 <, 双保险转义)
        const json = JSON.stringify(headers).replace(/</g, '\\u003c')
        return new Response(PROBE_HTML.replace('__REQ_HEADERS__', json), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      },
    }))
  }
}
function stopServers(): void {
  for (const s of servers) { try { s.stop(true) } catch { /* ignore */ } }
}

// ---------- 探针执行 ----------
interface FpResult {
  ua: string
  headlessInUa: boolean
  webdriver: string
  webdriverInNav: boolean
  uaData: { brands: string[]; mobile: boolean; platform: string; high: Record<string, unknown> | null } | null
  hdr: { ua: string; secChUa: string | null; mobile: string | null; platform: string | null }
  chromeObj: { exists: boolean; app: boolean; runtime: boolean; csi: boolean; loadTimes: boolean }
  permissionsNotifications: string
  notificationPermission: string
  pluginsLength: number
  pluginsPdf: boolean
  languages: string[]
  hardwareConcurrency: number | null
  deviceMemory: number | null
  platform: string
  vendor: string
  maxTouchPoints: number
  outerWidth: number
  outerHeight: number
  innerWidth: number
  screen: { w: number; h: number; availH: number; depth: number }
  dpr: number
  webgl: { vendor: string | null; renderer: string | null; error?: string }
  canvas: { hash: string; hash2: string; stable: boolean; len: number; blank: boolean } | { error: string }
  iframe: Record<string, unknown> | null
  cdp: { direct: unknown; fmt: unknown; nested: unknown; leaked: boolean }
}

async function runProbeInPage(goto: () => Promise<{ evaluate: (s: string) => Promise<FpResult>; screenshot: (o?: { fullPage?: boolean }) => Promise<Buffer> }>, shotName: string | null): Promise<FpResult> {
  const page = await goto()
  if (shotName) {
    try { const buf = await page.screenshot({ fullPage: true }); saveShot(shotName, buf) } catch { /* ignore */ }
  }
  const res = await page.evaluate('window.__FP')
  return res as FpResult
}

type PwPage = { evaluate: (s: string) => Promise<FpResult>; screenshot: (o?: { fullPage?: boolean }) => Promise<Buffer>; goto: (u: string, o?: Record<string, unknown>) => Promise<unknown>; waitForFunction: (s: string, arg?: unknown, o?: Record<string, unknown>) => Promise<unknown> }

async function runBare(pw: typeof import('playwright'), ua: string | undefined, shotName: string | null): Promise<{ fp: FpResult; chromiumVersion: string }> {
  // 与 renderWithBrowserRaw 现行为逐项一致: args/viewport/webdriver-only init/最小 extra 头
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] })
  try {
    const ctx = await browser.newContext({
      ...(ua ? { userAgent: ua } : {}),
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6' },
    })
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })
    const page = (await ctx.newPage()) as unknown as PwPage
    await page.goto(urlFor('win'), { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForFunction('window.__FP_DONE === true', undefined, { timeout: 10000 })
    const fp = await runProbeInPage(async () => page, ua ? null : shotName)
    return { fp, chromiumVersion: browser.version() }
  } finally {
    await browser.close()
  }
}

// ---------- 判定器(修前失败/修后通过的同一把尺) ----------
interface ItemVerdict { id: string; name: string; exposed: boolean; detail: string; platformInherent?: boolean }
const SOFTWARE_GL_RE = /swiftshader|llvmpipe|offscreen|headless|software renderer|basic render/i
function parseBrands(s: string | null): Array<{ brand: string; version: string }> {
  if (!s) return []
  const out: Array<{ brand: string; version: string }> = []
  const re = /"([^"]+)"\s*;\s*v\s*=\s*"?([0-9.]+)"?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push({ brand: m[1], version: m[2] })
  return out
}
/** JS 面 brands(探针页输出为 "Brand;v=x" 字符串)与头组 brands(结构化)统一归一(hh-d2 修 tsc) */
function normalizeBrand(b: string | { brand: string; version: string }): { brand: string; version: string } {
  if (typeof b === 'string') {
    const m = b.match(/^(.*?);v=([0-9.]+)$/)
    return { brand: m ? m[1] : b, version: m ? m[2] : '' }
  }
  return b
}
function classify(fp: FpResult, bareCanvasHash?: string): ItemVerdict[] {
  const items: ItemVerdict[] = []
  const family = uaFamilyOf(fp.ua)
  const chromiumFamily = family === 'chromium'
  const ver = fp.ua.match(CHROME_VER_RE)?.[1] || ''
  const ev = fp.ua.match(EDGE_VER_RE)?.[1] || ''
  const mobile = isMobileUa(fp.ua)
  const platformHint = uaPlatformHint(fp.ua)
  const expectNavPlatform = navPlatformFor(fp.ua)

  // 1 webdriver
  const wdTruthy = !(fp.webdriver === 'undefined' || fp.webdriver === 'false' || fp.webdriver === 'absent')
  items.push({ id: 'webdriver', name: 'navigator.webdriver', exposed: wdTruthy, detail: `webdriver=${fp.webdriver} inNav=${fp.webdriverInNav}` })

  // 2 UA ↔ UA-CH ↔ Sec-CH-UA 头 三方自洽
  {
    const probs: string[] = []
    if (fp.headlessInUa) probs.push('UA 含 HeadlessChrome')
    if (chromiumFamily) {
      if (!ver) probs.push('UA 无 Chrome 版本')
      const jsBrands = (fp.uaData?.brands || []).map(normalizeBrand)
      const hdrBrands = parseBrands(fp.hdr.secChUa)
      const allBrands: Array<{ brand: string; version: string }> = [...jsBrands, ...hdrBrands]
      if (allBrands.some((b) => /headless/i.test(b.brand))) probs.push('brands 含 Headless')
      for (const b of allBrands) {
        if ((b.brand === 'Chromium' || b.brand === 'Google Chrome' || b.brand === 'Microsoft Edge') && b.version !== ver) {
          probs.push(`brand ${b.brand};v=${b.version} ≠ UA 版本 ${ver}`)
        }
      }
      const needGoogle = jsBrands.concat(hdrBrands).filter((b) => b.brand === 'Google Chrome' && b.version === ver)
      if (needGoogle.length === 0) probs.push('brands 缺 Google Chrome(Chromium 构建裸奔特征)')
      if (ev && !allBrands.some((b) => b.brand === 'Microsoft Edge')) probs.push('Edge UA 但 brands 缺 Microsoft Edge')
      if (!fp.uaData) probs.push('JS 无 userAgentData')
      if (!fp.hdr.secChUa) probs.push('导航缺 sec-ch-ua 头')
      const expectMobileHdr = mobile ? '?1' : '?0'
      if (fp.hdr.mobile !== expectMobileHdr) probs.push(`sec-ch-ua-mobile=${fp.hdr.mobile} 期望 ${expectMobileHdr}`)
      if (fp.uaData && String(fp.uaData.mobile) !== String(mobile)) probs.push(`JS mobile=${fp.uaData.mobile} 期望 ${mobile}`)
      if (fp.hdr.platform !== `"${platformHint}"`) probs.push(`sec-ch-ua-platform=${fp.hdr.platform} 期望 "${platformHint}"`)
      if (fp.uaData && fp.uaData.platform !== platformHint) probs.push(`JS platform=${fp.uaData.platform} 期望 ${platformHint}`)
      const fvl = (fp.uaData?.high as { fullVersionList?: string[] } | null)?.fullVersionList || []
      if (fvl.length && fvl.some((b) => /Chrome|Chromium|Edge/.test(b) && !b.includes(`;v=${ver}`))) probs.push(`fullVersionList 与 UA 版本不符: ${fvl.join(' ')}`)
      if (fp.vendor !== 'Google Inc.') probs.push(`vendor=${fp.vendor || '(空)'} 期望 Google Inc.`)
      if (fp.platform !== expectNavPlatform) probs.push(`navigator.platform=${fp.platform} 期望 ${expectNavPlatform}`)
    } else {
      // 非 Chromium 家族: 真 Safari/Firefox 不发 Client Hints, 也无 userAgentData
      if (fp.uaData) probs.push('非 Chromium UA 但 JS 有 userAgentData')
      if (fp.hdr.secChUa || fp.hdr.mobile || fp.hdr.platform) probs.push(`非 Chromium UA 但发 CH 头: ${fp.hdr.secChUa}`)
      if (family === 'safari' && fp.vendor !== 'Apple Computer, Inc.') probs.push(`vendor=${fp.vendor} 期望 Apple Computer, Inc.`)
      if (family === 'safari' && fp.platform !== 'MacIntel') probs.push(`platform=${fp.platform} 期望 MacIntel`)
      if (family === 'firefox' && fp.vendor !== '') probs.push(`vendor=${fp.vendor} 期望空(Firefox)`)
      if (fp.headlessInUa) probs.push('UA 含 HeadlessChrome')
    }
    items.push({ id: 'ua-ch-consistency', name: 'UA↔UA-CH↔Sec-CH-UA 三方自洽(+platform/vendor)', exposed: probs.length > 0, detail: probs.join('; ') || '自洽' })
  }

  // 3 window.chrome 形态
  {
    const c = fp.chromeObj
    const exposed = chromiumFamily ? !(c.exists && c.app && c.runtime && c.csi && c.loadTimes) : c.exists
    items.push({ id: 'window-chrome', name: 'window.chrome 形态', exposed, detail: `exists=${c.exists} app=${c.app} runtime=${c.runtime} csi=${c.csi} loadTimes=${c.loadTimes}(family=${family})` })
  }

  // 4 permissions.query notifications + Notification.permission 一致性
  {
    const q = fp.permissionsNotifications
    const n = fp.notificationPermission
    const consistent = (q === 'prompt' && n === 'default') || (q === 'granted' && n === 'granted') || (q === 'denied' && n === 'denied')
    const exposed = q === 'denied' || q.startsWith('throw') || q === 'no-api' || !consistent
    items.push({ id: 'permissions', name: 'permissions.query(notifications)+Notification 一致', exposed, detail: `query=${q} Notification=${n}` })
  }

  // 5 硬件/环境合理性
  {
    const probs: string[] = []
    if (chromiumFamily) {
      if (fp.pluginsLength < 5) probs.push(`plugins.length=${fp.pluginsLength} 期望≥5`)
      if (!fp.pluginsPdf) probs.push('plugins 缺 application/pdf')
    } else if (fp.pluginsLength === 0) {
      probs.push(`plugins.length=0(非 Chromium 引擎裸值)`)
    }
    if (!Array.isArray(fp.languages) || fp.languages.length < 1 || !fp.languages.includes('zh-CN')) probs.push(`languages=${JSON.stringify(fp.languages)}`)
    const hc = fp.hardwareConcurrency
    if (!hc || hc < 2 || hc > 64) probs.push(`hardwareConcurrency=${hc}`)
    const dm = fp.deviceMemory
    if (chromiumFamily && (dm === null || dm < 1 || dm > 8)) probs.push(`deviceMemory=${dm}`)
    if (mobile && fp.maxTouchPoints < 1) probs.push(`移动 UA 但 maxTouchPoints=${fp.maxTouchPoints}`)
    if (!mobile && fp.maxTouchPoints !== 0 && family === 'firefox') probs.push(`maxTouchPoints=${fp.maxTouchPoints}(Firefox 桌面=0)`)
    items.push({ id: 'sanity', name: 'plugins/languages/hwConcurrency/deviceMemory/touch 合理', exposed: probs.length > 0, detail: probs.join('; ') || `plugins=${fp.pluginsLength} hc=${hc} dm=${dm} touch=${fp.maxTouchPoints}` })
  }

  // 6 WebGL 软件渲染特征
  {
    const v = fp.webgl.vendor || ''
    const r = fp.webgl.renderer || ''
    const bad = SOFTWARE_GL_RE.test(v) || SOFTWARE_GL_RE.test(r) || !v || !r
    items.push({ id: 'webgl', name: 'WebGL vendor/renderer 无软件渲染特征', exposed: bad, detail: `vendor="${v}" renderer="${r}"${fp.webgl.error ? ` err=${fp.webgl.error}` : ''}` })
  }

  // 7 canvas(空白特征 + 与裸基线哈希同源)
  {
    if ('error' in fp.canvas) {
      items.push({ id: 'canvas', name: 'canvas 指纹', exposed: true, detail: `error=${fp.canvas.error}` })
    } else {
      const probs: string[] = []
      if (fp.canvas.blank) probs.push('canvas 全空白(字体缺失/headless 特征)')
      if (bareCanvasHash && fp.canvas.hash === bareCanvasHash) probs.push(`canvas 哈希与裸基线同源(${fp.canvas.hash})= 未加噪声`)
      items.push({ id: 'canvas', name: 'canvas 指纹非空白且区别于裸基线', exposed: probs.length > 0, detail: `${probs.join('; ') || 'hash=' + fp.canvas.hash} stable=${fp.canvas.stable}(噪声开启时 stable=false 属对抗特性)` })
    }
  }

  // 8 Notification.permission 恒 denied 特征
  {
    items.push({ id: 'notification', name: 'Notification.permission ≠ denied', exposed: fp.notificationPermission === 'denied' || fp.notificationPermission === 'absent', detail: `Notification.permission=${fp.notificationPermission}` })
  }

  // 9 iframe contentWindow 一致性
  {
    const f = fp.iframe || {}
    const probs: string[] = []
    if (chromiumFamily) {
      if (!f.chromeExists) probs.push('iframe 无 window.chrome')
      else if (!f.chromeApp || !f.chromeRuntime) probs.push(`iframe chrome 残缺(app=${f.chromeApp} runtime=${f.chromeRuntime})`)
      if (!f.uaDataExists) probs.push('iframe 无 userAgentData')
      const ib = (f.uadBrands as string[]) || []
      if (ib.length && ib.some((b) => /headless/i.test(b))) probs.push(`iframe brands 含 Headless: ${ib.join(' ')}`)
      if (ib.length && ver && ib.some((b) => (b.startsWith('Chromium') || b.startsWith('Google Chrome')) && !b.endsWith(`;v=${ver}`))) probs.push(`iframe brands 版本与 UA 不符: ${ib.join(' ')}`)
    } else {
      if (f.chromeExists) probs.push('非 Chromium UA 但 iframe 有 window.chrome')
      if (f.uaDataExists) probs.push('非 Chromium UA 但 iframe 有 userAgentData')
    }
    items.push({ id: 'iframe', name: 'iframe contentWindow 一致性', exposed: probs.length > 0, detail: probs.join('; ') || JSON.stringify(f).slice(0, 160) })
  }

  // 10 CDP Runtime.enable(平台级, 单独归档不计入 0 暴露门槛)
  items.push({ id: 'cdp-runtime', name: 'CDP Runtime.enable console.debug 序列法', exposed: !!fp.cdp.leaked, platformInherent: true, detail: `direct=${fp.cdp.direct} fmt=${fp.cdp.fmt} nested=${fp.cdp.nested}(Playwright 协议接管固有面, 归档不计门槛)` })

  return items
}

// ---------- 模式: baseline ----------
async function modeBaseline(): Promise<void> {
  const pw = await import('playwright')
  startServers()
  const out: Record<string, unknown> = { at: new Date().toISOString(), note: 'hh-d 修前基线(裸 Playwright + Obscura 增强前)' }
  try {
    console.log('== ① 裸 Playwright 基线 ==')
    const b1 = await runBare(pw, undefined, 'probe-bare-defaultua.png')
    console.log(`  [bare 默认UA] chromium=${b1.chromiumVersion} ua=${b1.fp.ua.slice(0, 72)}`)
    const b2 = await runBare(pw, MATRIX[0].ua, null)
    console.log(`  [bare 伪装UA win137] ua=${b2.fp.ua.slice(0, 72)}`)
    out.bare = { defaultUa: { fp: b1.fp, items: classify(b1.fp) }, spoofedUa: { fp: b2.fp, items: classify(b2.fp) } }
    ;(out.bare as Record<string, unknown>).chromiumVersion = b1.chromiumVersion
    for (const it of (out.bare as { spoofedUa: { items: ItemVerdict[] } }).spoofedUa.items) {
      console.log(`    - ${it.exposed ? '❌暴露' : '✅'} ${it.id}: ${it.detail.slice(0, 140)}`)
    }

    console.log('\n== ② Obscura 现防护(增强前)基线 ==')
    const { checkObscuraAvailable, withObscuraPage } = (await import('../src/lib/crawl/obscura')) as typeof import('../src/lib/crawl/obscura')
    const ok = await checkObscuraAvailable()
    if (!ok) throw new Error('Obscura 不可用')
    const obscuraPre: Record<string, unknown> = {}
    for (const m of MATRIX) {
      const page = await withObscuraPage(urlFor(m.key), async (p) => {
        await p.goto(urlFor(m.key), { waitUntil: 'domcontentloaded', timeout: 20000 })
        await p.waitForFunction('window.__FP_DONE === true', undefined, { timeout: 10000 }).catch(() => {})
        const buf = await p.screenshot({ fullPage: true }).catch(() => null)
        if (buf) saveShot(`probe-obscura-pre-${m.key}.png`, buf as Buffer)
        return (await p.evaluate('window.__FP')) as FpResult
      }, { userAgent: m.ua })
      const items = classify(page)
      obscuraPre[m.key] = { note: m.note, fp: page, items }
      const nExposed = items.filter((i) => i.exposed && !i.platformInherent).length
      console.log(`  [obscura-pre ${m.key}] 暴露 ${nExposed} 项: ${items.filter((i) => i.exposed).map((i) => i.id).join(',') || '无'}`)
    }
    out.obscuraPre = obscuraPre

    console.log('\n== ③ 头组对抗实验证据(增强设计选型) ==')
    const experiments = await cdpVsRouteExperiment(pw)
    out.experiments = experiments
    console.log(`  CDP metadata 生效=${experiments.cdpMetadata.headerApplied} (JS brands 自洽=${experiments.cdpMetadata.jsBrandsOk}, 头=${experiments.cdpMetadata.headerSecChUa})`)
    console.log(`  route 改写生效=${experiments.routeRewrite.headerApplied} (头=${experiments.routeRewrite.headerSecChUa})`)

    saveJson('baseline.json', out)
    console.log(`\n基线已留档 ${OUT_DIR}/baseline.json`)
  } finally {
    stopServers()
  }
}

/** 实验证据: ①CDP Network.setUserAgentOverride+userAgentMetadata 能否让 sec-ch-ua 头与 JS brands 同步生效
 *  ②context.route 头改写(strip+注入)能否生效 —— 决定增强层实现路径 */
async function cdpVsRouteExperiment(pw: typeof import('playwright')): Promise<Record<string, { headerApplied: boolean; jsBrandsOk: boolean; headerSecChUa: string | null; jsBrands: string[] | null }>> {
  const out: Record<string, { headerApplied: boolean; jsBrandsOk: boolean; headerSecChUa: string | null; jsBrands: string[] | null }> = {}
  const winUa = MATRIX[0].ua
  const meta = {
    brands: [{ brand: 'Chromium', version: '137' }, { brand: 'Google Chrome', version: '137' }, { brand: 'Not:A-Brand', version: '24' }],
    mobile: false, platform: 'Windows', platformVersion: '10.0.0', architecture: 'x86', bitness: '64', model: '', uaFullVersion: '137.0.0.0',
  }
  // ① CDP metadata
  {
    const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] })
    try {
      const ctx = await browser.newContext({ userAgent: winUa, viewport: { width: 1366, height: 768 } })
      const page = await ctx.newPage()
      const cdp = await (ctx as unknown as { newCDPSession(p: unknown): { send: (m: string, o?: unknown) => Promise<unknown> } }).newCDPSession(page)
      await cdp.send('Network.setUserAgentOverride', { userAgent: winUa, platform: 'Win32', userAgentMetadata: meta })
      await page.goto(urlFor('win'), { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.waitForFunction('window.__FP_DONE === true', undefined, { timeout: 10000 })
      const fp = (await page.evaluate('window.__FP')) as FpResult
      const hdrBrands = parseBrands(fp.hdr.secChUa)
      out.cdpMetadata = {
        headerApplied: hdrBrands.some((b) => b.brand === 'Google Chrome' && b.version === '137'),
        jsBrandsOk: (fp.uaData?.brands || []).some((b) => b.includes('Google Chrome') && b.includes('137')),
        headerSecChUa: fp.hdr.secChUa,
        jsBrands: fp.uaData?.brands || null,
      }
      await ctx.close()
    } finally {
      await browser.close()
    }
  }
  // ② route 改写
  {
    const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] })
    try {
      const ctx = await browser.newContext({ userAgent: winUa, viewport: { width: 1366, height: 768 } })
      await ctx.route('**/*', (route) => {
        const h = route.request().headers()
        for (const k of Object.keys(h)) { if (/^sec-ch-ua/i.test(k)) delete h[k] }
        h['sec-ch-ua'] = '"Chromium";v="137", "Google Chrome";v="137", "Not:A-Brand";v="24"'
        h['sec-ch-ua-mobile'] = '?0'
        h['sec-ch-ua-platform'] = '"Windows"'
        void route.continue({ headers: h })
      })
      const page = await ctx.newPage()
      await page.goto(urlFor('win'), { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.waitForFunction('window.__FP_DONE === true', undefined, { timeout: 10000 })
      const fp = (await page.evaluate('window.__FP')) as FpResult
      const hdrBrands = parseBrands(fp.hdr.secChUa)
      out.routeRewrite = {
        headerApplied: hdrBrands.length === 3 && hdrBrands.every((b) => b.version === '137'),
        jsBrandsOk: false, // route 不改 JS 面(仅作头组通道证据)
        headerSecChUa: fp.hdr.secChUa,
        jsBrands: fp.uaData?.brands || null,
      }
      await ctx.close()
    } finally {
      await browser.close()
    }
  }
  return out
}

// ---------- 模式: verify(增强后断言) ----------
let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}
async function modeVerify(): Promise<void> {
  startServers()
  try {
    const { checkObscuraAvailable, withObscuraPage } = (await import('../src/lib/crawl/obscura')) as typeof import('../src/lib/crawl/obscura')
    const ok = await checkObscuraAvailable()
    if (!ok) throw new Error('Obscura 不可用(chromium 未安装)')
    // 裸基线 canvas 哈希参照(存在则加载, 用于"与裸基线同源=未加噪"判定)
    let bareCanvasHash: string | undefined
    try {
      const base = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'baseline.json'), 'utf8')) as { bare?: { spoofedUa?: { fp?: FpResult } } }
      const c = base.bare?.spoofedUa?.fp?.canvas
      if (c && !('error' in c)) bareCanvasHash = c.hash
    } catch { /* 无基线文件则跳过同源判定 */ }

    console.log('== Obscura 增强后指纹断言(修前暴露 → 修后 0 暴露门槛矩阵) ==')
    const results: Record<string, { note: string; items: ItemVerdict[]; fp: FpResult }> = {}
    for (const m of MATRIX) {
      const fp = await withObscuraPage(urlFor(m.key), async (p) => {
        await p.goto(urlFor(m.key), { waitUntil: 'domcontentloaded', timeout: 20000 })
        await p.waitForFunction('window.__FP_DONE === true', undefined, { timeout: 10000 }).catch(() => {})
        const buf = await p.screenshot({ fullPage: true }).catch(() => null)
        if (buf) saveShot(`probe-obscura-post-${m.key}.png`, buf as Buffer)
        return (await p.evaluate('window.__FP')) as FpResult
      }, { userAgent: m.ua })
      const items = classify(fp, bareCanvasHash)
      results[m.key] = { note: m.note, items, fp }
      const exposedFixable = items.filter((i) => i.exposed && !i.platformInherent)
      const cdp = items.find((i) => i.id === 'cdp-runtime')
      console.log(`\n  [${m.key}] ${m.note} ua=${fp.ua.slice(0, 64)}…`)
      for (const it of items) {
        const tag = it.platformInherent ? (it.exposed ? '⚠平台级' : '✅') : it.exposed ? '❌' : '✅'
        console.log(`    ${tag} ${it.id}: ${it.detail.slice(0, 150)}`)
      }
      assert(`[${m.key}] 脚本可修面 0 暴露(9 项)`, exposedFixable.length === 0, exposedFixable.map((i) => `${i.id}(${i.detail.slice(0, 80)})`).join(' | '))
      if (cdp) console.log(`    ⚠ cdp-runtime(平台级, 不计门槛): exposed=${cdp.exposed}`)
    }
    console.log(`\n== 结果: ${pass} pass / ${fail} fail ==`)
    saveJson('verify-hh-d.json', { at: new Date().toISOString(), gateKeys: GATE_KEYS, results })
  } finally {
    stopServers()
  }
}

// ---------- 模式: real(真实检测站) ----------
async function modeReal(): Promise<void> {
  const report: Record<string, unknown> = { at: new Date().toISOString() }
  startServers() // 探针服务保持一致执行环境(真实站访问不经过它)
  try {
    const { withObscuraPage } = (await import('../src/lib/crawl/obscura')) as typeof import('../src/lib/crawl/obscura')
    const winUa = MATRIX[0].ua
    console.log('== bot.sannysoft.com(仅观察, 逐项截图) ==')
    try {
      const rows = await withObscuraPage('https://bot.sannysoft.com/', async (p) => {
        await p.goto('https://bot.sannysoft.com/', { waitUntil: 'domcontentloaded', timeout: 45000 })
        await p.waitForTimeout(6000)
        const buf = await p.screenshot({ fullPage: true }).catch(() => null)
        if (buf) saveShot('sannysoft-obscura.png', buf as Buffer)
        const table = await p.evaluate(() => {
          const outRows: Array<{ test: string; result: string }> = []
          document.querySelectorAll('table tr').forEach((tr) => {
            const tds = tr.querySelectorAll('td')
            if (tds.length >= 2) outRows.push({ test: (tds[0].textContent || '').trim(), result: (tds[tds.length - 1].textContent || '').trim() })
          })
          return outRows
        })
        // 逐项截图: 非 pass 行单独截(表头/空行跳过)
        const trs = await p.$$('table tr')
        let idx = 0
        for (const tr of trs) {
          const cls = await tr.getAttribute('class').catch(() => null)
          idx++
          if (cls && /failed/i.test(cls)) {
            try { const b = await (tr as unknown as { screenshot(): Promise<Buffer> }).screenshot(); saveShot(`sannysoft-row-${idx}-${cls}.png`, b) } catch { /* ignore */ }
          }
        }
        return table
      }, { userAgent: winUa })
      const fails = rows.filter((r) => /failed|missing/i.test(r.result))
      report.sannysoft = { totalRows: rows.length, failRows: fails, all: rows }
      console.log(`  行数=${rows.length} 未过行=${fails.length}${fails.length ? ' → ' + fails.map((f) => f.test).join(', ') : ' (全绿)'}`)
    } catch (e) {
      report.sannysoft = { skipped: true, reason: String((e as Error).message || e).slice(0, 200) }
      console.log(`  ⏭ 不可达/失败, 如实留档: ${String((e as Error).message || e).slice(0, 160)}`)
    }
    await new Promise((r) => setTimeout(r, 2000))

    console.log('\n== abrahamjuliot.github.io/creepjs(信任分数) ==')
    try {
      const creep = await withObscuraPage('https://abrahamjuliot.github.io/creepjs/', async (p) => {
        await p.goto('https://abrahamjuliot.github.io/creepjs/', { waitUntil: 'domcontentloaded', timeout: 45000 })
        await p.waitForTimeout(20000) // creepjs 检测链路较长
        const buf = await p.screenshot({ fullPage: true }).catch(() => null)
        if (buf) saveShot('creepjs-obscura.png', buf as Buffer)
        return await p.evaluate(() => {
          const pick = (sel: string): string => (document.querySelector(sel)?.textContent || '').trim()
          return {
            trust: pick('#fp .score-card .unblurred') || pick('.score-card') || '',
            lies: pick('#lies .unblurred') || (document.querySelector('#lies')?.textContent || '').trim().slice(0, 120),
            heading: (document.querySelector('h1')?.textContent || '').trim(),
          }
        })
      }, { userAgent: winUa })
      report.creepjs = creep
      console.log(`  trust="${String(creep.trust).slice(0, 80)}" lies="${String(creep.lies).slice(0, 80)}"`)
    } catch (e) {
      report.creepjs = { skipped: true, reason: String((e as Error).message || e).slice(0, 200) }
      console.log(`  ⏭ 不可达/失败, 如实留档: ${String((e as Error).message || e).slice(0, 160)}`)
    }
    saveJson('real-sites.json', report)
    console.log(`\n真实站报告已留档 ${OUT_DIR}/real-sites.json`)
  } finally {
    stopServers()
  }
}

// ---------- 入口 ----------
const mode = (process.argv[2] || 'verify').toLowerCase()
try {
  if (mode === 'baseline') await modeBaseline()
  else if (mode === 'verify') await modeVerify()
  else if (mode === 'real') await modeReal()
  else {
    console.log('用法: bun scripts/verify-hh-d-fingerprint.ts [baseline|verify|real]')
    process.exit(2)
  }
  process.exit(fail > 0 ? 1 : 0)
} catch (e) {
  console.error('probe 失败:', (e as Error).message)
  process.exit(1)
}
