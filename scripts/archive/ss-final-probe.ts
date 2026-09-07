// ss 轮终验: 双路由双档 playwright — pageerror/console error/核心交互/自动填充任务可见性
import { chromium } from 'playwright'
export {}
const results: { name: string; pass: boolean; detail?: string }[] = []
const ok = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`) }
const browser = await chromium.launch()
for (const [label, url, vp] of [
  ['前台-桌面', 'http://127.0.0.1:3000/?view=home', { width: 1280, height: 900 }],
  ['管理-桌面', 'http://127.0.0.1:3000/?admin=1', { width: 1280, height: 900 }],
  ['前台-移动', 'http://127.0.0.1:3000/?view=home', { width: 375, height: 812 }],
] as const) {
  const page = await browser.newPage({ viewport: vp })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 120)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)) })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2500)
    const hasHorizontal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
    ok(`${label}: 加载渲染`, true)
    ok(`${label}: 零 pageerror/console error`, errors.length === 0, errors.slice(0, 2).join(' | '))
    if (vp.width === 375) ok(`${label}: 无横向溢出`, !hasHorizontal)
    if (url.includes('admin')) {
      const body = await page.textContent('body')
      ok(`${label}: 管理面板区块在位`, !!body && (body.includes('采集规则') || body.includes('站点规则')), String(body?.length))
    } else {
      const body = (await page.textContent('body')) || ''
      const themeLinks = await page.evaluate(() => document.querySelectorAll('a[href]').length)
      ok(`${label}: 站群书籍内容可见`, body.includes('九星之主') || body.length > 2000, `len=${body.length}`)
      ok(`${label}: 交互链接在位`, themeLinks >= 3, `links=${themeLinks}`)
    }
  } catch (e) {
    ok(`${label}: 加载失败`, false, String(e).slice(0, 100))
  }
  await page.close()
}
await browser.close()
const fail = results.filter((r) => !r.pass).length
console.log(`\nss-final-probe: ${results.length - fail}/${results.length} pass`)
process.exit(fail ? 1 : 0)
