// ============================================================
// dd-d 任务A 探针: ybswo.com CF Managed Challenge(Turnstile) 交互式解盾尝试
// 真实 Chromium(headless) + 点击 Turnstile iframe 复选框 + 最长 75s 轮询判定;
// 若通过 → 抓 cf_clearance cookie + 用纯 fetch 复放验证(为 HTTP 引擎复用评估);
// 若不通过 → 记录挑战页形态与循环证据(不做第三次加载, 预算克制)。
// 运行: bun scripts/probe-dd-d-turnstile.ts (显式 exit(0))
// ============================================================
export {}

// 根 tsconfig 无 @types/bun(cc-d2 裁定), Bun 全局用最小类型面(verify-dd-b-mirror.ts 同款 shim)
declare const Bun: { write(path: string, data: string): Promise<void> }

import { chromium } from 'playwright'

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const URL = 'https://www.ybswo.com/'

function isRealContent(html: string): boolean {
  return /夜伴书屋|完美书库|media-title/.test(html)
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    userAgent: DESKTOP_UA,
    locale: 'zh-CN',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
  })
  const page = await ctx.newPage()
  const started = Date.now()
  let lastTitle = ''
  let clickAttempts = 0
  let clickErr = ''
  let passed = false

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    const deadline = Date.now() + 75000
    while (Date.now() < deadline) {
      const html = await page.content().catch(() => '')
      lastTitle = await page.title().catch(() => '')
      if (isRealContent(html)) { passed = true; break }
      // Turnstile 复选框在跨域 iframe 内, 尝试点击(label/checkbox/input)
      if (clickAttempts < 3) {
        try {
          const fl = page.frameLocator('iframe[src*="challenges.cloudflare.com"]')
          const box = fl.locator('input[type="checkbox"], label.ctp-checkbox-label, #challenge-stage')
          await box.first().click({ timeout: 2500 })
          clickAttempts++
          console.log(`  click#${clickAttempts} 已发送(Turnstile iframe)`)
        } catch (e) {
          clickAttempts++
          clickErr = e instanceof Error ? e.message.slice(0, 120) : String(e)
        }
      }
      await page.waitForTimeout(5000)
    }
    const html = await page.content().catch(() => '')
    console.log(`结果: passed=${passed} 用时=${((Date.now() - started) / 1000).toFixed(0)}s 最终title="${lastTitle}"`)
    console.log(`点击尝试=${clickAttempts}${clickErr ? ' 末次点击错误: ' + clickErr : ''}`)
    console.log(`挑战页体量=${html.length}B 真实内容标记=${isRealContent(html)} turnstile=${/turnstile/i.test(html)} challenge-platform=${/challenge-platform/i.test(html)}`)

    if (passed) {
      await Bun.write('/home/z/my-project/tmp/dd-d/ybswo-pass.html', html)
      const cookies = await ctx.cookies(URL)
      const cf = cookies.find((c) => c.name === 'cf_clearance')
      console.log(`cf_clearance: ${cf ? cf.value.slice(0, 24) + '…(len=' + cf.value.length + ')' : '(none)'}`)
      if (cf) {
        // 纯 fetch 复放验证(HTTP 引擎复用评估): 同 IP 同 UA 带 cookie 请求 1 发
        const res = await fetch(URL, {
          headers: { 'User-Agent': DESKTOP_UA, Cookie: `cf_clearance=${cf.value}` },
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        })
        const buf = new Uint8Array(await res.arrayBuffer())
        const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 2000))
        console.log(`cookie复放: ${res.status} ${buf.length}B 真实内容=${isRealContent(head)}`)
      }
    } else {
      // 挑战循环证据: 存样本
      await Bun.write('/home/z/my-project/tmp/dd-d/ybswo-challenge-loop.html', html)
      console.log('(挑战样本已存 tmp/dd-d/ybswo-challenge-loop.html)')
    }
  } catch (e) {
    console.log(`ERROR ${Date.now() - started}ms — ${e instanceof Error ? e.message : e}`)
  } finally {
    await browser.close().catch(() => {})
  }
  process.exit(0)
}

await main()
