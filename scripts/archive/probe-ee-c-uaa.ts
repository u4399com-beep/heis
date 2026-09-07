// ============================================================
// Task ee-c 参考站侦察 — uaa.com 可达性单发探测 (playwright)
// 运行: bun scripts/probe-ee-c-uaa.ts
// ============================================================
export {}
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  })
  const page = await ctx.newPage()
  try {
    await page.goto('https://www.uaa.com/', { waitUntil: 'domcontentloaded', timeout: 40000 })
    await page.waitForTimeout(12000) // 给 CF 挑战一点时间
    const title = await page.title()
    const html = await page.content()
    writeFileSync('/home/z/my-project/tmp/ee-c/uaa-pw.html', html)
    console.log('title =', title, 'len =', html.length)
    console.log('isChallenge =', /just a moment|cf-challenge|turnstile/i.test(html))
  } catch (e) {
    console.log('FAIL', String(e).slice(0, 200))
  }
  await browser.close()
}
main()
