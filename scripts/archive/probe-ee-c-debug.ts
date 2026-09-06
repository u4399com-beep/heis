// ============================================================
// Task ee-c 调试探针 — immersive pill 结构检查
// 运行: bun scripts/probe-ee-c-debug.ts
// ============================================================
export {}
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'

async function main() {
  const sites = (await (await fetch(`${BASE}/api/admin/sites`)).json()).data as { id: string; themeId: string }[]
  const site = sites.find((s) => s.themeId === 'aurora')!
  const books = ((await (await fetch(`${BASE}/api/public/books?site=${site.id}&size=3`)).json()).data as { books: { id: string }[] }).books
  let chId = ''
  for (const b of books) {
    const d = (await (await fetch(`${BASE}/api/public/book?id=${b.id}&tocPage=1&tocSize=2`)).json()).data as { chapters: { id: string }[] }
    if (d.chapters.length) {
      chId = d.chapters[0].id
      break
    }
  }
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${BASE}/?view=read&chapter=${chId}&site=${site.id}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3200)
  const info = await page.evaluate(() => {
    const root = document.querySelector('.read-layout-immersive')
    const groups = Array.from(document.querySelectorAll('[aria-label="阅读设置"]')).map((el) => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      cls: el.className.slice(0, 60),
      spans: el.querySelectorAll('span').length,
    }))
    return {
      hasRoot: !!root,
      groupCount: groups.length,
      groups,
      bodyOverflow: document.body.style.overflow,
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await page.screenshot({ path: '/home/z/my-project/tmp/ee-c/debug-immersive.png' })
  await browser.close()
}
main()
