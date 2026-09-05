// ============================================================
// gg-a C clickSelector 跨域 iframe 支持验证(dd-d 上报引擎缺口)
// mock: loopback 双端口(A/B/C 同机不同端口=互为跨域), 主页嵌 2 个跨域 iframe,
//       目标按钮在第二个 iframe 内, 点击后 postMessage 通知父页打标记
//       (模拟 Turnstile/hCaptcha "复选框在 challenges.cloudflare.com iframe 内"交互流:
//        iframe 内交互完成 → 通过 postMessage/cookie 影响主文档)
// ① 浏览器链端到端(fetchPage engine=browser → Obscura renderStealth): 点击生效 → 主文档含标记
// ② 裸 Playwright 降级路径共享助手直测(clickSelectorAnywhere): 多 frame 遍历命中/全不命中 false
// 如实记录: 真实 Turnstile 挑战无法在本沙箱验证(域内 iframe 从未物化, dd-d 留档),
//           本增强为能力面补齐 —— 跨域 iframe 内元素交互是 Playwright 原生能力,
//           用同构 mock(跨源 iframe+postMessage 回传)验证交互链路。
// 运行: bun scripts/verify-gg-a-frameclick.ts
// ============================================================
export {}

declare const Bun: {
  serve(opts: { port: number; fetch: (req: Request) => Response }): { stop(stopActive?: boolean): void }
  write(path: string, data: Uint8Array | string): Promise<number>
}

import { fetchPage } from '../src/lib/crawl/fetcher'

class SkipSignal extends Error {}

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}

// ---------- loopback mock 服务 ----------
const portA = Number(18901)
const portB = Number(18902)
const portC = Number(18903)
const PADDING = '这是一段用于通过引擎极短内容判拦启发式的填充文本。'.repeat(80)
const MAIN_HTML = `<!doctype html><html><head><title>挑战验证主页</title></head>
<body><h1>主页面</h1><p>${PADDING}</p>
<iframe id="f1" src="http://127.0.0.1:${portB}/inner" width="300" height="120"></iframe>
<iframe id="f2" src="http://127.0.0.1:${portC}/inner" width="300" height="120"></iframe>
<script>
window.addEventListener('message', function (e) {
  if (e.data === 'CHALLENGE_PASSED') {
    var d = document.createElement('div'); d.id = 'gg-marker';
    d.textContent = 'OK' + String(Date.now());
    document.body.appendChild(d);
  }
});
</script></body></html>`
const INNER_HTML = `<!doctype html><html><head><title>挑战组件</title></head>
<body><div id="status">pending</div><button id="chal-btn">verify</button>
<script>
document.getElementById('chal-btn').addEventListener('click', function () {
  document.getElementById('status').textContent = 'CLICKED';
  window.parent.postMessage('CHALLENGE_PASSED', '*');
});
</script></body></html>`

const srvA = Bun.serve({ port: portA, fetch: () => new Response(MAIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) })
const srvB = Bun.serve({ port: portB, fetch: () => new Response(INNER_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) })
const srvC = Bun.serve({ port: portC, fetch: () => new Response(INNER_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) })
const MAIN_URL = `http://127.0.0.1:${portA}/`

console.log('\n== ① 浏览器链端到端(fetchPage engine=browser + clickSelector) ==')
{
  const res = await fetchPage(MAIN_URL, {
    engine: 'browser',
    clickSelector: '#chal-btn',
    waitMs: 500,
    timeout: 25000,
    referer: false,
  })
  const hasMarker = /OK1\d{12}/.test(res.html)
  assert('跨域 iframe 内按钮点击生效(主文档出现运行期时间戳标记)', hasMarker, `htmlLen=${res.html.length}`)
  assert('引擎=browser', res.engine === 'browser')
  assert('结果非 blocked(正常内容页)', res.blocked === false)
}

console.log('\n== ② clickSelectorAnywhere 助手直测(裸 Playwright 降级路径共享) ==')
{
  const pw = await import('playwright')
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.goto(MAIN_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 2, undefined, { timeout: 8000 })
    await page.waitForTimeout(1200) // iframe 内部文档加载就绪窗口(助手语义: 不等 frame load, 调用方负责)
    const obscuraMod: any = await import('../src/lib/crawl/obscura')
    if (typeof obscuraMod.clickSelectorAnywhere !== 'function') {
      console.log('  ⏭ clickSelectorAnywhere 未实现(修前形态), 跳过助手直测')
      throw new SkipSignal()
    }
    const clickSelectorAnywhere = obscuraMod.clickSelectorAnywhere as (p: any, sel: string) => Promise<boolean>
    const clicked = await clickSelectorAnywhere(page, '#chal-btn')
    assert('助手返回 true(在某个跨域 frame 内命中)', clicked === true)
    await page.waitForTimeout(800)
    const markerInDom = await page.evaluate(() => !!document.querySelector('#gg-marker'))
    assert('点击后主文档 DOM 含标记(postMessage 回传, evaluate 断言)', markerInDom)
    const again = await clickSelectorAnywhere(page, '#not-exist-anywhere')
    assert('全 frame 未命中 → false(静默跳过语义)', again === false)
  } finally {
    await browser.close()
  }
}

srvA.stop(true); srvB.stop(true); srvC.stop(true)
void SkipSignal
console.log(`\n== 结果: ${pass} pass / ${fail} fail ==`)
process.exit(fail > 0 ? 1 : 0)
