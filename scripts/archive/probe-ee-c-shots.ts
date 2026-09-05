// ============================================================
// Task ee-c 目检脚本 — 三阅读布局截图 (desktop + mobile)
// 产出: tmp/ee-c/shot-*.png
// 运行: bun scripts/probe-ee-c-shots.ts
// ============================================================
export {}
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const OUT = '/home/z/my-project/tmp/ee-c'
mkdirSync(OUT, { recursive: true })

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
  // 桌面
  for (const tid of ['bamboo', 'mango', 'aurora']) {
    const site = pick(tid)
    const chId = await firstCh(site.id)
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${BASE}/?view=read&chapter=${chId}&site=${site.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3200)
    await page.screenshot({ path: `${OUT}/shot-${tid}-read.png` })
    if (tid === 'mango') {
      // 翻一页再截
      await page.locator('[aria-label="下一页"]').first().click()
      await page.waitForTimeout(700)
      await page.screenshot({ path: `${OUT}/shot-${tid}-read-p2.png` })
    }
    if (tid === 'bamboo') {
      await page.locator('[aria-label="打开章节目录抽屉"]').first().click()
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/shot-${tid}-drawer.png` })
    }
    await page.close()
  }
  // 移动端 (bamboo classic + aurora immersive)
  for (const tid of ['bamboo', 'aurora']) {
    const site = pick(tid)
    const chId = await firstCh(site.id)
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(`${BASE}/?view=read&chapter=${chId}&site=${site.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3200)
    await page.screenshot({ path: `${OUT}/shot-${tid}-mobile.png` })
    await page.close()
  }
  await browser.close()
  console.log('SHOTS DONE')
}
main()
