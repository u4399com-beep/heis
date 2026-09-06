// ============================================================
// Task ee-c 参考站侦察 — guichuideng.info 布局 DNA 抓取 (playwright)
// 产出: tmp/ee-c/gcd-*.html / gcd-*.png + 提取布局特征
// 运行: bun scripts/probe-ee-c-gcd.ts
// ============================================================
export {}
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = '/home/z/my-project/tmp/ee-c'
mkdirSync(OUT, { recursive: true })

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
  })
  const page = await ctx.newPage()
  const shot = async (name: string) => {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
  }
  const save = (name: string, text: string) => writeFileSync(`${OUT}/${name}`, text)

  // 1) /book/ 首页 (JS stub 自跳转 → 等 URL 稳定)
  await page.goto('https://www.guichuideng.info/book/', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(6000) // 反爬 stub 自跳转 + 渲染
  const html1 = await page.content()
  save('gcd-home.html', html1)
  await shot('gcd-home')
  console.log('home url =', page.url(), 'len =', html1.length)

  // 2) 找第一本书链接
  const bookHref = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a[href*="/book/"]'))
    const cand = as.find((a) => {
      const h = a.getAttribute('href') || ''
      return /\/book\/\d+(_\d+)?\.html|\/book\/\d+\/?$/i.test(h)
    })
    return cand ? (cand as HTMLAnchorElement).href : ''
  })
  console.log('first book href =', bookHref)
  if (bookHref) {
    await page.goto(bookHref, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(5000)
    save('gcd-book.html', await page.content())
    await shot('gcd-book')
    console.log('book url =', page.url())

    // 3) 找第一章链接进阅读页
    const chHref = await page.evaluate(() => {
      const as = Array.from(document.querySelectorAll('a'))
      const cand = as.find((a) => /\/book\/\d+.*\.html|\/\d+_\d+\.html/i.test(a.getAttribute('href') || '') && (a.textContent || '').trim().length > 2)
      return cand ? (cand as HTMLAnchorElement).href : ''
    })
    console.log('first chapter href =', chHref)
    if (chHref) {
      await page.goto(chHref, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(5000)
      save('gcd-read.html', await page.content())
      await shot('gcd-read')
      console.log('read url =', page.url())
    }
  }

  await browser.close()
  console.log('DONE')
}

main()
