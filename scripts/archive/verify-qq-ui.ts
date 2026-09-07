/** qq轮 UI 终验: 首页/详情/阅读/管理端 渲染+零console error(query路由直航版) */
import { chromium } from 'playwright'
let errors: string[] = []
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 100)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 100)) })

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: string) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, d ?? '') } }
// tt 轮动态化: 原硬编码 qq 时代 SITE/BOOK ID 已随库恢复漂移 —— 改为 API 动态发现
// (章节数最多的书 + 站群首个站点), 与 ll-d-ui 同范式
const booksRes = await fetch('http://localhost:3000/api/admin/books?size=50').then((r) => r.json()).catch(() => null)
const bookRows: { id: string; name?: string; _count?: { chapters?: number } }[] = booksRes?.data?.books || booksRes?.data || []
const topBook = [...bookRows].sort((a, b) => (b._count?.chapters || 0) - (a._count?.chapters || 0))[0]
const sitesRes = await fetch('http://localhost:3000/api/admin/sites').then((r) => r.json()).catch(() => null)
const siteRows: { id: string }[] = sitesRes?.data || []
const SITE = topBook ? (siteRows[0]?.id || '') : ''
const BOOK = topBook?.id || ''
ok('动态发现书+站', !!BOOK && !!SITE, `book=${topBook?.name?.slice(0, 14)}(${topBook?._count?.chapters}章) site=${SITE.slice(0, 8)}`)

// 1. 首页
await page.goto('http://localhost:3000/?view=home', { waitUntil: 'networkidle', timeout: 30000 })
ok('首页渲染', (await page.title()).length > 0)
const body = await page.locator('body').textContent() ?? ''
ok('首页有内容(≥200字)', body.length > 200, `len=${body.length}`)

// 2. 详情页(直航 query 路由)
await page.goto(`http://localhost:3000/?view=book&id=${BOOK}&site=${SITE}`, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(1200)
const h1 = (await page.locator('h1').first().textContent() ?? '').trim()
ok('详情页书名渲染', h1.length > 0, `h1=${h1.slice(0, 30)}`)
// 章节项为 onClick 导航(无锚点): 按章节文本元素定位
const chItems = await page.locator('text=/第\\s*[0-9一二三四五六七八九十百千]+章/').count()
ok('详情页章节项>0', chItems > 0, `got=${chItems}`)

// 3. 阅读页(点击首个章节项)
if (chItems > 0) {
  await page.locator('text=/第\\s*[0-9一二三四五六七八九十百千]+章/').first().click()
  await page.waitForTimeout(1800)
  const content = await page.locator('body').textContent() ?? ''
  ok('阅读页正文渲染', content.length > 300, `len=${content.length}`)
}

// 4. 管理端任务面板
await page.goto('http://localhost:3000/?admin=1', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(2500)
const adminText = await page.locator('body').textContent() ?? ''
ok('管理端含任务数据', adminText.includes('番茄'), '任务面板未含番茄任务名')

// 5. 移动端视口
await page.setViewportSize({ width: 390, height: 844 })
await page.goto('http://localhost:3000/?view=home', { waitUntil: 'networkidle', timeout: 30000 })
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
ok('移动端无横向溢出', !overflow)

ok('零 pageerror/console error', errors.length === 0, JSON.stringify(errors.slice(0, 3)))
await browser.close()
console.log(`\nverify-qq-ui: ${pass} pass / ${fail} fail ${fail === 0 ? '— ALL PASS' : '— FAIL'}`)
process.exit(fail === 0 ? 0 : 1)
