/**
 * verify-rr-d-ui.ts — rr-d 第13轮 UI 深审 断言脚本(playwright)
 * 覆盖: ①BooksSection 括号错配修复(源码+运行时文案) ②前台核心交互链(首页→详情→阅读→翻章)
 *       ③管理端任务对话框(开合+设计宽度720) ④移动端375无横向溢出 ⑤sticky footer/ARIA 抽查
 *       ⑥全程零 pageerror / 零 console error
 * 纪律: 只读浏览+关闭型交互(不创建任务/不删改数据); query 路由直航 + onClick 章节文本定位(qq轮坑位)。
 * 运行: bun scripts/verify-rr-d-ui.ts
 */
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const BASE = 'http://localhost:3000'
const errors: string[] = []
let pass = 0
let fail = 0
const ok = (n: string, c: boolean, d?: string) => {
  if (c) {
    pass++
    console.log('  ✓', n)
  } else {
    fail++
    failures.push(n)
    console.log('  ✗', n, d ?? '')
  }
}
const failures: string[] = []

// ---- 源码级断言(修复②): 括号错配 ----
{
  console.log('\n== S. 源码级(修复② 括号错配) ==')
  const src = readFileSync('src/components/admin/BooksSection.tsx', 'utf-8')
  ok('S1 源码为「将为《…》」正确闭合', /将为《\{recrawlBook\?\.book\.name\}》/.test(src))
  ok('S2 源码不再含错配形态《…』', !/为《\{recrawlBook\?\.book\.name\}』/.test(src))
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 120)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120))
})

try {
  // ---- 动态取数据(禁硬编码ID) ----
  const jget = async (url: string) => {
    const r = await fetch(BASE + url)
    return (await r.json())?.data
  }
  const sites = (await jget('/api/admin/sites')) || []
  const defSite = sites.find((s: any) => s.isDefault) || sites[0]
  const booksPub = (await jget(`/api/public/books?site=${defSite?.id || ''}&size=5`))?.books || []
  // 选一本实采有章节的书(公开列表无章节数, 用管理端 _count 过滤)
  const booksAdmin = (await jget('/api/admin/books?page=1&size=20'))?.books || []
  const bookWithChapters = booksAdmin.find((b: any) => (b._count?.chapters || 0) > 0)

  console.log('\n== F. 前台核心交互链(1280 桌面) ==')
  // 首页
  await page.goto(`${BASE}/?view=home&site=${defSite?.id || ''}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(800)
  const homeText = (await page.locator('body').textContent()) ?? ''
  ok('F1 首页渲染有内容', homeText.length > 200, `len=${homeText.length}`)
  ok('F2 搜索输入带 aria-label', (await page.locator('input[aria-label="站内搜索"]').count()) >= 1)
  ok('F3 embedMode 返回后台按钮存在', (await page.locator('button[aria-label="返回后台管理系统"]').count()) === 1)

  // 详情页(query 直航)
  if (bookWithChapters) {
    const b = bookWithChapters
    await page.goto(`${BASE}/?view=book&id=${b.id}&site=${defSite?.id || ''}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1000)
    const h1 = ((await page.locator('h1').first().textContent()) ?? '').trim()
    ok('F4 详情页书名渲染', h1.length > 0, `h1=${h1.slice(0, 24)}`)
    const chBtns = page.locator('section[aria-label="章节目录"] button')
    ok('F5 目录区章节项>0', (await chBtns.count()) > 0)
    if ((await chBtns.count()) > 0) {
      await chBtns.first().click()
      await page.waitForTimeout(1500)
      const readText = (await page.locator('body').textContent()) ?? ''
      ok('F6 点击章节进阅读页(正文渲染)', readText.length > 300, `len=${readText.length}`)
      ok('F7 阅读页目录抽屉按钮存在', (await page.locator('button[aria-label="打开章节目录抽屉"], button[aria-label="打开章节目录"]').count()) >= 1)
      // 翻章(下一章)
      const nextBtn = page.locator('button[aria-label="下一章"]').first()
      if ((await nextBtn.count()) > 0 && (await nextBtn.isEnabled())) {
        await nextBtn.click()
        await page.waitForTimeout(1500)
        ok('F8 下一章翻章成功(仍为阅读视图)', ((await page.locator('body').textContent()) ?? '').includes('下一章'))
      }
    }
  } else {
    ok('F4 存在可探针书籍', false, '书库无有章节书籍?')
  }

  // ---- 管理端 ----
  console.log('\n== M. 管理端(任务对话框 + 书籍重采文案) ==')
  await page.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2500)
  ok('M1 管理端仪表盘渲染', ((await page.locator('body').textContent()) ?? '').includes('仪表盘'))

  // 任务面板: 打开新建任务对话框, 断言 mm 轮 720 设计宽度未回归
  await page.locator('aside button').filter({ hasText: '采集任务' }).first().click()
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '新建任务' }).first().click()
  await page.waitForTimeout(900)
  const dlg = page.locator('[data-slot="dialog-content"]').first()
  ok('M2 任务对话框打开', (await dlg.count()) === 1)
  if ((await dlg.count()) === 1) {
    const w = await dlg.evaluate((el) => el.getBoundingClientRect().width)
    ok('M3 对话框宽度=720(mm 轮修复零回归)', Math.round(w) === 720, `w=${Math.round(w)}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }

  // 书籍管理: 打开「覆盖」重采确认, 断言括号修复后的文案
  await page.locator('aside button').filter({ hasText: '书籍管理' }).first().click()
  await page.waitForTimeout(1500)
  const coverBtns = page.getByRole('button', { name: '覆盖' })
  if ((await coverBtns.count()) > 0) {
    await coverBtns.first().click()
    await page.waitForTimeout(700)
    const confirmText = (await page.locator('[role="alertdialog"]').textContent()) ?? ''
    ok('M4 重采确认文案括号闭合(《…》)', confirmText.includes('》') && !confirmText.includes('』'), confirmText.slice(0, 60))
    await page.getByRole('button', { name: '取消' }).first().click()
    await page.waitForTimeout(400)
  } else {
    ok('M4 存在可探针书籍行', false, '书籍列表为空, 无法验证重采文案')
  }

  // ---- 移动端 375 ----
  console.log('\n== MB. 移动端 375 ==')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`${BASE}/?view=home&site=${defSite?.id || ''}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1000)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  ok('MB1 前台无横向溢出', !overflow)

  // sticky footer: 滚到底部 footer 在视口内(min-h-screen flex-col 布局成立)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(600)
  const footerVisible = await page.locator('footer').last().isVisible()
  ok('MB2 前台 footer 滚动可达(sticky 布局)', footerVisible)

  // 管理端移动端: 任务表格横向滚动容器(不撑破页面)
  await page.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  await page.locator('nav[aria-label="后台导航"] button').filter({ hasText: '采集任务' }).first().click()
  await page.waitForTimeout(1500)
  const hasScrollWrap = (await page.locator('div.admin-scroll.overflow-x-auto').count()) >= 1
  ok('MB3 任务表格横向滚动容器存在', hasScrollWrap)
  const overflowAdmin = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  ok('MB4 管理端 375 无页面级横向溢出', !overflowAdmin)

  console.log('\n== E. 全程零报错 ==')
  ok('E1 零 pageerror / 零 console error', errors.length === 0, JSON.stringify(errors.slice(0, 3)))
} finally {
  await browser.close()
}

console.log(`\nverify-rr-d-ui: ${pass} pass / ${fail} fail ${fail === 0 ? '— ALL PASS' : '— FAIL'}`)
if (fail) {
  console.log('FAILURES:', failures.join(' | '))
  process.exit(1)
}
process.exit(0)
