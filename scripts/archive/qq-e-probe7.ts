// qq-e 探针7: 深挖 script3(plugins) 为何未生效
import { chromium } from 'playwright'
import { STEALTH_INIT_SCRIPTS, buildIdentityInitScript } from '../src/lib/crawl/obscura'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ userAgent: UA })
const page = await ctx.newPage()
page.on('console', (m) => console.log('[page console]', m.type(), m.text().slice(0, 200)))
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.goto('about:blank')

// 基线: 裸环境 plugins
console.log('bare plugins.length =', await page.evaluate(() => navigator.plugins.length))

// 逐段执行 stealth 脚本(手动, 捕获错误)
for (let i = 0; i < STEALTH_INIT_SCRIPTS.length; i++) {
  const r = await page.evaluate((src) => {
    try { new Function(src)(); return 'ok' } catch (e: any) { return 'ERR: ' + (e?.message || e) }
  }, STEALTH_INIT_SCRIPTS[i])
  console.log(`stealth[${i}] →`, r)
}
console.log('after manual inject plugins.length =', await page.evaluate(() => navigator.plugins.length))
console.log('pluginsIdentity =', await page.evaluate(() => navigator.plugins === navigator.plugins))
console.log('namedByMime =', await page.evaluate(() => !!navigator.plugins.namedItem('application/pdf')))

// addInitScript 逐段注册定位是哪一段破坏
const ctx2 = await browser.newContext({ userAgent: UA })
for (let i = 0; i < 3; i++) await ctx2.addInitScript(STEALTH_INIT_SCRIPTS[i])
const p2 = await ctx2.newPage()
await p2.goto('about:blank')
console.log('ctx2(0..2) plugins.length =', await p2.evaluate(() => navigator.plugins.length))
const ctx3 = await browser.newContext({ userAgent: UA })
await ctx3.addInitScript(STEALTH_INIT_SCRIPTS[3])
const p3 = await ctx3.newPage()
await p3.goto('about:blank')
console.log('ctx3(only 3) plugins.length =', await p3.evaluate(() => navigator.plugins.length))
await browser.close()
process.exit(0)
