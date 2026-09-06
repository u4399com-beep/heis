// ============================================================
// Task ee-c 交互微探针 — paginated 翻页/immersive 收纳/字号联动
// 运行: bun scripts/probe-ee-c-interact.ts
// ============================================================
export {}
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'

async function main() {
  const sites = (await (await fetch(`${BASE}/api/admin/sites`)).json()).data as { id: string; themeId: string }[]
  const pick = (tid: string) => sites.find((s) => s.themeId === tid)!
  const firstCh = async (siteId: string) => {
    const books = ((await (await fetch(`${BASE}/api/public/books?site=${siteId}&size=3`)).json()).data as { books: { id: string }[] }).books
    for (const b of books) {
      const d = (await (await fetch(`${BASE}/api/public/book?id=${b.id}&tocPage=1&tocSize=2`)).json()).data as { chapters: { id: string }[] }
      if (d.chapters.length) return d.chapters[0].id
    }
    return ''
  }

  const browser = await chromium.launch()

  // 1) paginated 翻页: 页码 aria-label 变化
  {
    const site = pick('mango')
    const chId = await firstCh(site.id)
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${BASE}/?view=read&chapter=${chId}&site=${site.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3200)
    const before = await page.locator('[aria-label*="章节正文, 共"]').first().getAttribute('aria-label')
    await page.locator('[aria-label="下一页"]').first().click()
    await page.waitForTimeout(900)
    const after = await page.locator('[aria-label*="章节正文, 共"]').first().getAttribute('aria-label')
    console.log(`paginated 翻页: "${before}" → "${after}" ${before !== after ? 'OK' : 'FAIL'}`)
    // 尾页翻章: 点下一页直到禁用/翻章
    for (let i = 0; i < 6; i++) {
      const disabled = await page.locator('nav[aria-label="章节导航"] [aria-label="下一页"]').isDisabled()
      if (disabled) break
      await page.locator('nav[aria-label="章节导航"] [aria-label="下一页"]').click()
      await page.waitForTimeout(500)
    }
    const tailLabel = await page.locator('[aria-label*="章节正文, 共"]').first().getAttribute('aria-label')
    console.log(`paginated 连点至尾: ${tailLabel}`)
    await page.close()
  }

  // 2) immersive 滚动收纳: 下滚 chrome hidden, 上滚唤出
  {
    const site = pick('aurora')
    const chId = await firstCh(site.id)
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${BASE}/?view=read&chapter=${chId}&site=${site.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3200)
    const scrollEl = page.locator('.read-layout-immersive .overflow-y-auto').first()
    const topBefore = await page.locator('.read-layout-immersive > header').evaluate((el) => getComputedStyle(el).transform)
    await scrollEl.evaluate((el) => (el.scrollTop = 600))
    await page.waitForTimeout(600)
    const topAfterDown = await page.locator('.read-layout-immersive > header').evaluate((el) => getComputedStyle(el).transform)
    await scrollEl.evaluate((el) => (el.scrollTop = 560))
    await page.waitForTimeout(600)
    const topAfterUp = await page.locator('.read-layout-immersive > header').evaluate((el) => getComputedStyle(el).transform)
    console.log(`immersive 收纳: 初=${topBefore} 下滚后=${topAfterDown} 上滚后=${topAfterUp} ${topAfterDown !== topBefore && topAfterUp === topBefore ? 'OK' : 'CHECK'}`)
    // 字号联动
    const px0 = await page.locator('.read-layout-immersive [role="group"][aria-label="阅读设置"] span').first().innerText()
    await page.locator('[aria-label="增大字号"]').first().click()
    const px1 = await page.locator('.read-layout-immersive [role="group"][aria-label="阅读设置"] span').first().innerText()
    console.log(`immersive 字号: ${px0} → ${px1} ${px0 !== px1 ? 'OK' : 'FAIL'}`)
    await page.close()
  }

  // 3) classic 抽屉 ESC 关闭 + 字号持久化
  {
    const site = pick('bamboo')
    const chId = await firstCh(site.id)
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${BASE}/?view=read&chapter=${chId}&site=${site.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await page.locator('[aria-label="增大字号"]').first().click()
    await page.locator('[aria-label="打开章节目录抽屉"]').first().click()
    await page.waitForTimeout(1200)
    const drawerOpen = await page.locator('[role="dialog"][aria-label="章节目录"]').isVisible()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const drawerGone = (await page.locator('[role="dialog"][aria-label="章节目录"]').count()) === 0
    const stored = await page.evaluate(() => window.localStorage.getItem('public_reader_fontSize'))
    console.log(`classic: 抽屉开=${drawerOpen} ESC关=${drawerGone} 字号持久化=${stored} ${drawerOpen && drawerGone ? 'OK' : 'FAIL'}`)
    await page.close()
  }

  await browser.close()
  console.log('INTERACT DONE')
}
main()
