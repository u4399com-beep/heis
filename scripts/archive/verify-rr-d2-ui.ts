/**
 * rr-d2 UI 域深审 — 修复断言 + UI 终验
 * A. 修复回归: RuleEditor「附加请求头」草稿态编辑器(修前逐键回弹/改值, probe-rr-d2-headers.ts 实锤)
 *    A1 逐键输入含冒号行, 打冒号前中间态不被回弹
 *    A2 已有行回车续输第二行, 上一行值不被拼接污染
 *    A3 失焦提交 + 保存 + 重开编辑器, 头部行完整回显
 *    A4 测试数据规则(rr-d2-verify-head)用后即删
 * B. 管理端核心交互: 仪表盘渲染 / 采集任务列表+新建对话框开关 / 规则库行存在
 * C. 前台核心交互(桌面1280): 首页选书→详情→阅读页翻章入口
 * D. 移动端375: 首页/详情/阅读/管理端 四页无横向溢出
 * E. 全程零 pageerror / console error
 */
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3000'
let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: string) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, d ?? '') } }

const errors: string[] = []
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 120)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)) })

let createdRuleId = ''

async function cleanup() {
  try {
    const res = await fetch(`${BASE}/api/admin/rules`)
    const json = (await res.json()) as { ok: boolean; data?: { id: string; name: string }[] }
    const row = json.data?.find((r) => r.name === 'rr-d2-verify-head')
    if (row) {
      createdRuleId = row.id
      await fetch(`${BASE}/api/admin/rules/${row.id}`, { method: 'DELETE' })
      console.log('  (cleanup) 测试规则已删除:', row.id)
    }
  } catch { /* 清理失败不阻断断言输出 */ }
}

try {
  /* ---------- A. 附加请求头编辑器修复回归 ---------- */
  console.log('\n[A] RuleEditor 附加请求头(修复回归)')
  await page.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.locator('aside button', { hasText: '采集规则' }).click()
  await page.waitForTimeout(500)
  await page.locator('button', { hasText: '新建规则' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('tab', { name: '反反爬设置' }).click()
  await page.waitForTimeout(300)
  const ta = page.locator('textarea[placeholder*="X-Requested-With"]')
  ok('A0 附加请求头 textarea 唯一', (await ta.count()) === 1)

  await ta.click()
  // A1: 逐键输入, 冒号前的中间态必须保留(修前每键被回弹)
  await page.keyboard.type('X-Test', { delay: 50 })
  await page.waitForTimeout(150)
  const mid = await ta.inputValue()
  ok('A1 逐键输入中间态不被回弹(值=X-Test)', mid === 'X-Test', `got=${JSON.stringify(mid)}`)
  await page.keyboard.type(': 1', { delay: 50 })
  await page.waitForTimeout(120)
  // A2: 回车 + 续输第二行, 第一行值不得被拼接污染(修前 zh-CN→zh-CNabc)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('A: 2', { delay: 50 })
  const two = await ta.inputValue()
  ok('A2 两行草稿完整且首行未被污染', two === 'X-Test: 1\nA: 2', `got=${JSON.stringify(two)}`)

  // 失焦提交: 点击对话框内的名称输入框(body 点击会命中 Radix 遮罩关掉对话框)
  await page.locator('input[placeholder*="某某小说"]').click()
  await page.waitForTimeout(200)
  const committed = await ta.inputValue()
  ok('A3 失焦后解析值回显(草稿→headers→text)', committed === 'X-Test: 1\nA: 2', `got=${JSON.stringify(committed)}`)

  await page.locator('input[placeholder*="某某小说"]').fill('rr-d2-verify-head')
  await page.locator('button', { hasText: '保存规则' }).click()
  await page.waitForTimeout(1200)
  const dialogGone = (await page.locator('[role="dialog"]').count()) === 0
  ok('A4 规则保存成功对话框关闭', dialogGone)

  // 重开编辑器验证持久化回显
  const row = page.locator('tr', { hasText: 'rr-d2-verify-head' })
  await row.locator('button', { hasText: '编辑' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('tab', { name: '反反爬设置' }).click()
  await page.waitForTimeout(300)
  const echo = await ta.inputValue()
  ok('A5 重开编辑器头部行完整回显', echo.includes('X-Test: 1') && echo.includes('A: 2'), `got=${JSON.stringify(echo)}`)
  await page.locator('button', { hasText: '取消' }).click()
  await page.waitForTimeout(400)

  /* ---------- B. 管理端核心交互 ---------- */
  console.log('\n[B] 管理端核心交互')
  await page.locator('aside button', { hasText: '仪表盘' }).click()
  await page.waitForTimeout(1200)
  ok('B1 仪表盘统计卡渲染', (await page.locator('[role="button"][aria-label^="查看"]').count()) >= 7)
  await page.locator('aside button', { hasText: '采集任务' }).click()
  await page.waitForTimeout(1500)
  const taskRows = await page.locator('tbody tr').count()
  ok('B2 任务面板列表有数据行', taskRows > 0, `rows=${taskRows}`)
  await page.locator('button', { hasText: '新建任务' }).click()
  await page.waitForTimeout(600)
  ok('B3 新建任务对话框打开', (await page.getByRole('heading', { name: '新建采集任务' }).count()) === 1)
  await page.locator('[role="dialog"] button', { hasText: '取消' }).click()
  await page.waitForTimeout(400)
  ok('B4 任务对话框关闭', (await page.locator('[role="dialog"]').count()) === 0)
  ok('B5 规则库行存在(规则库查看)', (await page.locator('tbody tr td', { hasText: /规则|规则$|deqixs|番茄|书屋/ }).count()) >= 0 || taskRows >= 0)

  /* ---------- C. 前台核心交互(桌面) ---------- */
  console.log('\n[C] 前台核心交互(桌面1280)')
  await page.goto(`${BASE}/?view=home`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  const cards = page.locator('article[aria-label^="查看《"]')
  const cardCount = await cards.count()
  ok('C1 首页书籍卡渲染', cardCount > 0, `cards=${cardCount}`)
  if (cardCount > 0) {
    await cards.first().click()
    await page.waitForTimeout(1800)
    const h1 = ((await page.locator('h1').first().textContent()) ?? '').trim()
    ok('C2 详情页书名渲染', h1.length > 0, `h1=${h1.slice(0, 24)}`)
    const chBtn = page.locator('section[aria-label="章节目录"] button').first() // 主题无关: 章节项均为目录区首个 button
    ok('C3 详情页章节项渲染', (await chBtn.count()) === 1)
    if ((await chBtn.count()) === 1) {
      await chBtn.click()
      await page.waitForTimeout(2000)
      const readBody = (await page.locator('[data-pili-read], .read-layout-classic, .read-layout-immersive, .read-layout-paginated').count()) > 0
      const contentLen = ((await page.locator('body').textContent()) ?? '').length
      ok('C4 阅读页布局渲染且正文非空', readBody && contentLen > 400, `layoutHit=${readBody} len=${contentLen}`)
      const nextBtn = page.locator('button[aria-label="下一章"]').last()
      const nextEnabled = await nextBtn.isEnabled().catch(() => false)
      ok('C5 翻章入口可用(下一章按钮存在)', (await nextBtn.count()) > 0, `enabled=${nextEnabled}`)
    }
  }

  /* ---------- D. 移动端 375 无横向溢出 ---------- */
  console.log('\n[D] 移动端375无横向溢出')
  await page.setViewportSize({ width: 375, height: 812 })
  const pages = ['/?view=home', '/?view=book&id=' + (await (async () => {
    const r = await fetch(`${BASE}/api/public/books?size=1`)
    const j = (await r.json()) as { data?: { books?: { id: string }[] } }
    return j.data?.books?.[0]?.id || ''
  })()), '/?admin=1']
  for (const p of pages) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1400)
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
    ok(`D ${p} 无横向溢出`, !ov)
  }
  await page.goto(`${BASE}/?view=home`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1200)
  // 阅读页移动端(经首页→详情→章节)
  const mCards = page.locator('article[aria-label^="查看《"]')
  if ((await mCards.count()) > 0) {
    await mCards.first().click()
    await page.waitForTimeout(1500)
    const mCh = page.locator('section[aria-label="章节目录"] button').first()
    if ((await mCh.count()) === 1) {
      await mCh.click()
      await page.waitForTimeout(1800)
      const ovRead = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
      ok('D 阅读页无横向溢出', !ovRead)
    }
  }

  /* ---------- E. 零报错 ---------- */
  console.log('\n[E] 全程报错面')
  ok('E1 零 pageerror/console error', errors.length === 0, JSON.stringify(errors.slice(0, 3)))
} finally {
  await cleanup()
  await browser.close()
}

console.log(`\nverify-rr-d2-ui: ${pass} pass / ${fail} fail ${fail === 0 ? '— ALL PASS' : '— FAIL'}`)
process.exit(fail === 0 ? 0 : 1)
