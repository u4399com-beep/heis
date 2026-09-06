// ============================================================
// ii-c 深审验证①: obscura.ts 指纹增强段(hh-d 新代码)完整逐行审的实证脚本
//
// 段A parseUaIdentity 身份矩阵: 机型三段 UA 修复(M2102J2SC 修前 model='' 探针实证
//     tmp/ii-c/probe-fp-obscura.json) / brands 版本==UA Chrome 主版本 / Edge 品牌配对 /
//     移动性 / 平台映射 / GPU 按 os 自洽
// 段B buildIdentityInitScript 注入脚本字符串: new Function 语法校验 + 敌意 UA
//     (引号/反斜杠/</script>/unicode)JSON 序列化保真
// 段C 真浏览器 chromium UA: 主 frame + srcdoc iframe + 晚创建 iframe + 跨源 iframe
//     四面覆盖(UA/brands/platform/vendor/maxTouchPoints/WebGL)+ 注入排序证据
//     (WebGL 为身份脚本按平台 GPU 而非静态脚本 Intel Iris → 参数化脚本确在静态脚本之后)
// 段D 真浏览器 Android UA: maxTouchPoints=5 + getHighEntropyValues 全量高熵自洽
// 段E M2102 UA 端到端: JS model + CDP 网络层 sec-ch-ua-model 双面 == 'M2102J2SC'(修复证据)
// 段F 真浏览器 Safari UA: 'userAgentData' in navigator === false(修前 true, 修后与真 Safari
//     一致)/ window.chrome 无 / vendor Apple / productSub 20030107
// 段G Safari UA 网络层: UA 头原样 + 无 sec-ch-ua*(CDP 无 metadata 时引擎按覆写 UA 重推 CH,
//     Safari UA 无 Chrome 品牌故原生不发送 —— 探针实证, 存档项)
// 段H Edge UA 网络层: sec-ch-ua 含 Microsoft Edge 且版本==UA Edg 主版本(buildUaMetadata 生效)
// 段I WebGL GPU↔UA 平台匹配(windows/macos/android 三面 == parseUaIdentity().gpu)
// 产物: tmp/ii-c/verify-ii-c-obscura.json; 显式 process.exit(0)
// ============================================================
import { chromium } from 'playwright'
import {
  STEALTH_INIT_SCRIPTS,
  buildIdentityInitScript,
  parseUaIdentity,
  buildUaMetadata,
  applyUaCdpOverride,
  GPU_BY_OS,
} from '../src/lib/crawl/obscura'
import { writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'

const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
const UA_LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0'
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
const UA_M2102 = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2102J2SC Build/TKQ1.220829.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.0.0 Mobile Safari/537.36'
const UA_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0'
const UA_HOSTILE = 'Mozilla/5.0 (X11; Linux) Chrome/139.0.0.0 "quo\\ted"</script>\u4e2d\u6587 Safari/537.36'

let pass = 0
let fail = 0
const failures: string[] = []
function ok(cond: boolean, label: string) {
  if (cond) { pass++ } else { fail++; failures.push(label) }
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}`)
}

function isMobile(ua: string): boolean {
  return /iPhone|iPad|Android|Mobile Safari|;\s*Mobile\//.test(ua)
}

async function makeStealthContext(browser: Awaited<ReturnType<typeof chromium.launch>>, ua: string, viewport: { width: number; height: number }, isMobileFlag?: boolean) {
  const ctx = await browser.newContext({
    userAgent: ua,
    viewport,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    deviceScaleFactor: 2,
    isMobile: isMobileFlag ?? isMobile(ua),
    hasTouch: isMobileFlag ?? isMobile(ua),
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6' },
  })
  for (const s of STEALTH_INIT_SCRIPTS) await ctx.addInitScript(s)
  await ctx.addInitScript(buildIdentityInitScript(ua))
  return ctx
}

function httpServer(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ srv: Server; port: number }> {
  return new Promise((resolve) => {
    const srv = createServer(handler)
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: (srv.address() as { port: number }).port }))
  })
}

async function main() {
  const result: Record<string, unknown> = {}
  console.log('=== A parseUaIdentity 身份矩阵 ===')
  {
    // 机型三段 UA(ii-c 修复证据: 修前 model='' → 修后 'M2102J2SC')
    const m2102 = parseUaIdentity(UA_M2102)
    ok(m2102.model === 'M2102J2SC', `A1 三段 Android UA model==='M2102J2SC'(修前'', 实际'${m2102.model}')`)
    const pixel = parseUaIdentity(UA_ANDROID)
    ok(pixel.model === 'Pixel 8', `A2 两段 Android UA model==='Pixel 8'(实际'${pixel.model}')`)
    ok(parseUaIdentity(UA_WIN).model === '', 'A3 非 Android UA model 为空')
    // brands 版本 == UA Chrome 主版本; Edge 品牌配对
    for (const [ua, label] of [[UA_WIN, 'win139'], [UA_MAC, 'mac138'], [UA_LINUX, 'linux140'], [UA_EDGE, 'edge139'], [UA_ANDROID, 'android139']] as const) {
      const id = parseUaIdentity(ua)
      const chromeMajor = ua.match(/Chrome\/(\d+)/)?.[1] || ''
      ok(id.chromeVer === chromeMajor && id.fullVersion === `${chromeMajor}.0.0.0`, `A4.${label} chromeVer/fullVersion == UA 主版本`)
      ok(id.brands.some((b) => b.brand === 'Chromium' && b.version === chromeMajor) && id.brands.some((b) => b.brand === 'Google Chrome' && b.version === chromeMajor), `A5.${label} brands 含 Chromium+Google Chrome 且主版本一致`)
      const hasEdgeInUa = /Edg\/|EdgA\/|Edge\//.test(ua)
      ok(id.brands.some((b) => b.brand === 'Microsoft Edge') === hasEdgeInUa, `A6.${label} Edge 品牌${hasEdgeInUa ? '必含' : '不含'}`)
      ok(id.brands[id.brands.length - 1].brand === 'Not:A-Brand', `A7.${label} grease 收尾`)
    }
    // 家族/平台/移动性
    const sid = parseUaIdentity(UA_SAFARI)
    ok(sid.family === 'safari' && sid.vendor === 'Apple Computer, Inc.' && sid.navPlatform === 'MacIntel', 'A8 Safari UA: family/vendor/navPlatform')
    const fid = parseUaIdentity(UA_FIREFOX)
    ok(fid.family === 'firefox' && fid.vendor === '' && fid.navPlatform === 'Win32', 'A9 Firefox UA: family/vendor空/navPlatform Win32')
    ok(parseUaIdentity(UA_ANDROID).navPlatform === 'Linux armv8l' && parseUaIdentity(UA_ANDROID).chPlatform === 'Android' && parseUaIdentity(UA_ANDROID).mobile === true, 'A10 Android UA: navPlatform/chPlatform/mobile')
    ok(parseUaIdentity(UA_EDGE).edgeVer === '139' && parseUaIdentity(UA_EDGE).os === 'windows', 'A11 Edge UA: edgeVer/os')
    ok(isMobile(UA_ANDROID) === parseUaIdentity(UA_ANDROID).mobile && !parseUaIdentity(UA_WIN).mobile, 'A12 移动性与 UA 一致')
    // buildUaMetadata 结构
    const md = buildUaMetadata(parseUaIdentity(UA_ANDROID))
    ok((md as { platform: string }).platform === 'Android' && (md as { mobile: boolean }).mobile === true && (md as { model: string }).model === 'Pixel 8' && (md as { architecture: string }).architecture === 'arm', 'A13 buildUaMetadata(Android): platform/mobile/model/architecture')
    ok(GPU_BY_OS.windows.renderer.includes('D3D11') && GPU_BY_OS.macos.renderer.includes('Apple M1') && GPU_BY_OS.android.renderer.includes('Adreno') && GPU_BY_OS.linux.renderer.includes('NVIDIA'), 'A14 GPU_BY_OS 四平台字符串形态')
  }

  console.log('=== B buildIdentityInitScript 语法/敌意 UA 保真 ===')
  {
    for (const [ua, label] of [[UA_WIN, 'win'], [UA_SAFARI, 'safari'], [UA_FIREFOX, 'firefox'], [UA_HOSTILE, 'hostile']] as const) {
      const script = buildIdentityInitScript(ua)
      let syntaxOk = true
      try { new Function(script) } catch { syntaxOk = false }
      ok(syntaxOk, `B1.${label} 注入脚本 new Function 语法通过`)
      ok(script.includes(JSON.stringify(parseUaIdentity(ua))), `B2.${label} 身份对象 JSON 内嵌保真`)
    }
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-blink-features=AutomationControlled', '--disable-features=IsolateOrigins,site-per-process', '--lang=zh-CN'],
  })
  try {
    // —— 本地双源(跨源 iframe 用)——
    const srvA = await httpServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><head><title>srcA</title></head><body>main-payload-0123456789-abcdefghijklmnop</body></html>') })
    const srvB = await httpServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><head><title>srcB</title></head><body>cross-origin-frame-payload-0123456789</body></html>') })

    console.log('=== C chromium UA: 全 frame 覆盖 + 排序证据(WebGL=身份 GPU 非 Intel Iris) ===')
    {
      const ctx = await makeStealthContext(browser, UA_WIN, { width: 1440, height: 900 }, false)
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${srvA.port}/`, { waitUntil: 'domcontentloaded' })
      // 晚创建 srcdoc iframe
      await page.evaluate(() => { const f = document.createElement('iframe'); f.srcdoc = '<html><body>late-frame</body></html>'; document.body.appendChild(f) })
      // 跨源 iframe(不同端口=不同 origin)
      await page.evaluate((u) => { const f = document.createElement('iframe'); f.src = u; document.body.appendChild(f) }, `http://127.0.0.1:${srvB.port}/`)
      await page.waitForTimeout(900)
      const frames = page.frames()
      // 主 frame + 晚创建 srcdoc frame + 跨源 frame(服务 A 页面本身无 iframe, 两个均为运行时动态创建)
      ok(frames.length >= 3, `C1 frame 数 ${frames.length} >= 3(主+晚创建 srcdoc+跨源)`) 
      for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]
        const js = await fr.evaluate(() => {
          const n = navigator as unknown as { userAgent: string; userAgentData?: { brands: Array<{ brand: string; version: string }>; platform: string }; platform: string; vendor: string; maxTouchPoints: number }
          const c = document.createElement('canvas')
          const gl = c.getContext('webgl') as WebGLRenderingContext | null
          return {
            uaOk: n.userAgent.includes('Chrome/139.0.0.0 Safari/537.36') && !n.userAgent.includes('Headless'),
            brands: n.userAgentData ? n.userAgentData.brands.map((b) => `${b.brand}:${b.version}`).join('|') : '',
            platform: n.platform,
            vendor: n.vendor,
            mtp: n.maxTouchPoints,
            glVendor: gl ? gl.getParameter(37445) : '',
            glRenderer: gl ? gl.getParameter(37446) : '',
            chromeObj: typeof (window as { chrome?: unknown }).chrome,
          }
        }).catch(() => null)
        ok(!!js, `C2.${i} frame[${i}](${fr.url().slice(0, 30)}) evaluate 成功`)
        if (!js) continue
        ok(js.uaOk, `C3.${i} frame[${i}] UA 钉到身份值(无 HeadlessChrome)`)
        ok(js.brands.includes('Chromium:139') && js.brands.includes('Google Chrome:139'), `C4.${i} frame[${i}] brands 主版本 139`)
        ok(js.platform === 'Win32' && js.vendor === 'Google Inc.' && js.mtp === 0, `C5.${i} frame[${i}] platform/vendor/maxTouchPoints`)
        ok(js.glVendor === 'Google Inc. (Intel)' && js.glRenderer.includes('UHD Graphics 630') && !js.glRenderer.includes('Intel Iris'), `C6.${i} frame[${i}] WebGL=身份 GPU(排序证据: 非静态脚本 Intel Iris 掩蔽值)`)
        ok(js.chromeObj === 'object', `C7.${i} frame[${i}] window.chrome 在位(chromium 家族)`)
      }
      await ctx.close()
    }

    console.log('=== D Android UA: 移动分支 + 高熵自洽 ===')
    {
      const ctx = await makeStealthContext(browser, UA_ANDROID, { width: 390, height: 844 }, true)
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${srvA.port}/`, { waitUntil: 'domcontentloaded' })
      const js = await page.evaluate(async () => {
        const n = navigator as unknown as { userAgent: string; maxTouchPoints: number; platform: string; userAgentData?: { mobile: boolean; platform: string; getHighEntropyValues(h: string[]): Promise<Record<string, unknown>> } }
        const c = document.createElement('canvas')
        const gl = c.getContext('webgl') as WebGLRenderingContext | null
        return {
          mtp: n.maxTouchPoints,
          platform: n.platform,
          mobile: n.userAgentData?.mobile,
          uadPlatform: n.userAgentData?.platform,
          hev: n.userAgentData ? await n.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'model', 'mobile', 'platform', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64', 'formFactors']) : null,
          glRenderer: gl ? gl.getParameter(37446) : '',
        }
      })
      ok(js.mtp === 5, `D1 maxTouchPoints=5(实际 ${js.mtp})`)
      ok(js.mobile === true && js.uadPlatform === 'Android', 'D2 userAgentData.mobile/platform')
      const hev = (js.hev || {}) as Record<string, unknown>
      ok(hev.model === 'Pixel 8' && hev.mobile === true && hev.platform === 'Android' && hev.architecture === 'arm' && hev.bitness === '64', `D3 高熵 model/mobile/platform/arch/bitness(实际 model=${String(hev.model)})`)
      ok(hev.uaFullVersion === '139.0.0.0' && Array.isArray(hev.fullVersionList) && (hev.fullVersionList as Array<{ brand: string; version: string }>).some((b) => b.brand === 'Google Chrome' && b.version === '139.0.0.0'), 'D4 高熵 uaFullVersion/fullVersionList')
      ok(Array.isArray(hev.formFactors) && (hev.formFactors as string[])[0] === 'Mobile', `D5 formFactors=['Mobile'](实际 ${JSON.stringify(hev.formFactors)})`)
      ok(hev.wow64 === false, 'D6 wow64=false')
      ok(js.glRenderer.includes('Adreno'), `D7 WebGL renderer=Adreno(android GPU, 实际 ${String(js.glRenderer).slice(0, 40)})`)
      // 高熵 hints 过滤语义: 未知 hint 不落键
      const filtered = await page.evaluate(() => (navigator as unknown as { userAgentData?: { getHighEntropyValues(h: string[]): Promise<Record<string, unknown>> } }).userAgentData!.getHighEntropyValues(['bogusHint', 'model']))
      ok(Object.keys(filtered).length === 1 && (filtered as { model?: string }).model === 'Pixel 8', 'D8 getHighEntropyValues 未知 hint 过滤(仅返回在位键)')
      await ctx.close()
    }

    console.log('=== E M2102 UA 端到端(JS model + CDP 网络层 sec-ch-ua-model) ===')
    {
      // sec-ch-ua-model 属高熵 Client Hint: 仅当源站以 Accept-CH 显式索取时发送;
      // mock 以 Accept-CH+Critical-CH 索取后, Chromium 会带 hint 重访 —— 捕获全部请求,
      // 断言任一跳携带 model
      const seen: Array<Record<string, string>> = []
      const srv = await httpServer((req, res) => {
        seen.push(req.headers as Record<string, string>)
        res.setHeader('content-type', 'text/html')
        res.setHeader('Accept-CH', 'sec-ch-ua-model')
        res.setHeader('Critical-CH', 'sec-ch-ua-model')
        res.end('<html><body>header-probe-0123456789</body></html>')
      })
      const ctx = await makeStealthContext(browser, UA_M2102, { width: 390, height: 844 }, true)
      const page = await ctx.newPage()
      await applyUaCdpOverride(page, UA_M2102)
      await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'domcontentloaded' })
      const model = await page.evaluate(() => (navigator as unknown as { userAgentData?: { getHighEntropyValues(h: string[]): Promise<Record<string, unknown>> } }).userAgentData!.getHighEntropyValues(['model']))
      ok((model as { model?: string }).model === 'M2102J2SC', `E1 JS getHighEntropyValues model==='M2102J2SC'(实际 ${JSON.stringify(model)})`)
      await new Promise<void>((r) => setTimeout(r, 2500))
      const withModel = seen.filter((h) => h['sec-ch-ua-model'])
      ok(withModel.length > 0 && withModel[0]['sec-ch-ua-model'] === '"M2102J2SC"', `E2 网络层 Accept-CH 索取后 sec-ch-ua-model === "M2102J2SC"(捕获 ${seen.length} 跳, 带 model ${withModel.length} 跳)`)
      ok(seen.some((h) => (h['user-agent'] || '').includes('M2102J2SC')), 'E3 网络层 UA 原样')
      await ctx.close()
      srv.srv.close()
    }

    console.log('=== F Safari UA: userAgentData 摘除(修前 in=true → 修后 false)+ chrome 删除 ===')
    {
      const ctx = await makeStealthContext(browser, UA_SAFARI, { width: 1440, height: 900 }, false)
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${srvA.port}/`, { waitUntil: 'domcontentloaded' })
      const js = await page.evaluate(() => {
        const n = navigator as unknown as { userAgent: string; userAgentData?: unknown; vendor: string; productSub: string; platform: string; maxTouchPoints: number }
        const iframeNav = document.createElement('iframe')
        document.body.appendChild(iframeNav)
        let frameIn: boolean | null = null
        try { frameIn = 'userAgentData' in (iframeNav.contentWindow!.navigator as unknown as object) } catch { frameIn = null }
        return {
          uadIn: 'userAgentData' in n,
          uadVal: n.userAgentData,
          uadDesc: Object.getOwnPropertyDescriptor(n, 'userAgentData'),
          chrome: typeof (window as { chrome?: unknown }).chrome,
          vendor: n.vendor,
          productSub: n.productSub,
          platform: n.platform,
          mtp: n.maxTouchPoints,
          frameIn,
        }
      })
      ok(js.uadIn === false, `F1 'userAgentData' in navigator === false(修前 true; 实际 ${js.uadIn})`)
      ok(js.uadVal === undefined && js.uadDesc === undefined, 'F2 无 own userAgentData 属性(无遮蔽残留)')
      ok(js.frameIn === false, `F3 子 frame 同语义 in===false(实际 ${String(js.frameIn)})`)
      ok(js.chrome === 'undefined', `F4 window.chrome 已删(实际 ${js.chrome})`)
      ok(js.vendor === 'Apple Computer, Inc.' && js.productSub === '20030107' && js.platform === 'MacIntel' && js.mtp === 0, 'F5 vendor/productSub/platform/maxTouchPoints')
      await ctx.close()
    }

    console.log('=== G Safari UA 网络层: UA 原样 + 无 sec-ch-ua(存档项守护) ===')
    {
      const seen: Array<Record<string, string>> = []
      const srv = await httpServer((req, res) => { seen.push(req.headers as Record<string, string>); res.setHeader('content-type', 'text/html'); res.end('<html><body>header-probe-0123456789</body></html>') })
      const portG = srv.port
      const ctx = await makeStealthContext(browser, UA_SAFARI, { width: 1440, height: 900 }, false)
      const page = await ctx.newPage()
      await applyUaCdpOverride(page, UA_SAFARI)
      await page.goto(`http://127.0.0.1:${portG}/`, { waitUntil: 'domcontentloaded' })
      const hdr = seen[0] || {}
      ok((hdr['user-agent'] || '') === UA_SAFARI, 'G1 网络层 UA == Safari UA 原样')
      ok(!hdr['sec-ch-ua'] && !hdr['sec-ch-ua-mobile'] && !hdr['sec-ch-ua-platform'], 'G2 无 sec-ch-ua* 泄漏(CDP 无 metadata 时引擎按覆写 UA 重推 CH, Safari UA 无 Chrome 品牌不发送)')
      ok(!((hdr['user-agent'] || '').includes('HeadlessChrome')), 'G3 UA 无 HeadlessChrome 残留')
      await ctx.close()
      srv.srv.close()
    }

    console.log('=== H Edge UA 网络层: sec-ch-ua 含 Microsoft Edge 版本配对 ===')
    {
      const seen: Array<Record<string, string>> = []
      const srv = await httpServer((req, res) => { seen.push(req.headers as Record<string, string>); res.setHeader('content-type', 'text/html'); res.end('<html><body>header-probe-0123456789</body></html>') })
      const portH = srv.port
      const ctx = await makeStealthContext(browser, UA_EDGE, { width: 1440, height: 900 }, false)
      const page = await ctx.newPage()
      await applyUaCdpOverride(page, UA_EDGE)
      await page.goto(`http://127.0.0.1:${portH}/`, { waitUntil: 'domcontentloaded' })
      const hdr = seen[0] || {}
      ok((hdr['sec-ch-ua'] || '').includes('"Microsoft Edge";v="139"'), `H1 sec-ch-ua 含 Edge 品牌(实际 ${String(hdr['sec-ch-ua'])})`)
      ok((hdr['sec-ch-ua-platform'] || '') === '"Windows"' && (hdr['sec-ch-ua-mobile'] || '') === '?0', 'H2 platform/mobile 与 UA 自洽')
      await ctx.close()
      srv.srv.close()
    }

    console.log('=== I WebGL GPU↔UA 平台匹配(win/mac/linux) ===')
    {
      for (const [ua, expect] of [[UA_WIN, GPU_BY_OS.windows], [UA_MAC, GPU_BY_OS.macos], [UA_LINUX, GPU_BY_OS.linux]] as const) {
        const ctx = await makeStealthContext(browser, ua, { width: 1280, height: 800 }, false)
        const page = await ctx.newPage()
        await page.goto(`http://127.0.0.1:${srvA.port}/`, { waitUntil: 'domcontentloaded' })
        const js = await page.evaluate(() => {
          const c = document.createElement('canvas')
          const gl = c.getContext('webgl') as WebGLRenderingContext | null
          return gl ? { v: gl.getParameter(37445), r: gl.getParameter(37446), short: gl.getParameter(7936) } : null
        })
        ok(!!js && js.v === expect.vendor && js.r === expect.renderer, `I ${expect.renderer.slice(0, 24)}… 与 UA 平台匹配`)
        ok(!!js && js.short === 'WebKit', 'I+ WebGL VENDOR(7936)=WebKit')
        await ctx.close()
      }
    }

    srvA.srv.close()
    srvB.srv.close()
  } finally {
    await browser.close()
  }

  result.pass = pass
  result.fail = fail
  result.failures = failures
  result.at = Date.now()
  writeFileSync('/home/z/my-project/tmp/ii-c/verify-ii-c-obscura.json', JSON.stringify(result, null, 2))
  console.log(`\n=== verify-ii-c-obscura: ${pass} pass / ${fail} fail ===`)
  if (failures.length) console.log('FAILURES:', failures.join(' ; '))
  process.exit(fail ? 1 : 0)
}
void main()
