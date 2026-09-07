// qq-e 探针6: playwright chromium 可用性 + plugins 集合稳定性实断
import { chromium } from 'playwright'
import { STEALTH_INIT_SCRIPTS, buildIdentityInitScript } from '../src/lib/crawl/obscura'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ userAgent: UA })
for (const s of STEALTH_INIT_SCRIPTS) await ctx.addInitScript(s)
await ctx.addInitScript(buildIdentityInitScript(UA))
const page = await ctx.newPage()
await page.goto('about:blank')
const r = await page.evaluate(() => {
  const nav = navigator as any
  return {
    pluginsIdentity: (nav.plugins === nav.plugins),
    mimeIdentity: (nav.mimeTypes === nav.mimeTypes),
    pluginsLen: nav.plugins.length,
    namedByMime: !!nav.plugins.namedItem('application/pdf'),
    uadBrands: nav.userAgentData ? nav.userAgentData.brands.map((b: any) => b.brand).join('|') : '(none)',
    webdriver: nav.webdriver,
    touch: nav.maxTouchPoints,
  }
})
console.log(JSON.stringify(r, null, 2))
await browser.close()
process.exit(0)
