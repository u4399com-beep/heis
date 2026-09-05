import { chromium } from 'playwright'
export {}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://127.0.0.1:3000/?view=home', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)
const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map(a => (a as HTMLAnchorElement).getAttribute('href') || ''))].slice(0, 20))
console.log('LINKS:', hrefs.join(' | '))
const bodyText = await page.textContent('body')
console.log('BODY sample:', (bodyText || '').replace(/\s+/g, ' ').slice(0, 300))
await browser.close()
process.exit(0)
