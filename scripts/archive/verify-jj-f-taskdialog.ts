/**
 * verify-jj-f-taskdialog.ts — jj-e 新 UI(自动刷新开关) playwright 断言
 * 1. 管理页任务区打开 → 新建任务对话框 → "完成后自动刷新"开关在场
 * 2. 打开开关 → 间隔输入显示 → 填 2 → 保存被前端校验拦(5~1440)
 * 3. 编辑番茄任务 → 开关为勾选态 + 间隔 15
 * 4. 全程 0 pageerror / 0 console error
 */
import { chromium } from 'playwright'

let pass = 0
let failCnt = 0
const fails: string[] = []
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { failCnt++; fails.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)))
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  await page.goto('http://localhost:3000/?admin=1', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  // 进入任务区(桌面侧栏可见按钮; 移动导航同名按钮 hidden, :visible 过滤)
  const tasksTab = page.locator('button:visible', { hasText: '采集任务' }).first()
  ok('侧栏"采集任务"按钮在场', await tasksTab.count() > 0)
  await tasksTab.click()
  await page.waitForTimeout(1500)

  // 新建任务对话框
  const newBtn = page.locator('button').filter({ hasText: /新建任务/ }).first()
  ok('找到新建任务按钮', await newBtn.count() > 0)
  if (!(await newBtn.count())) { await page.screenshot({ path: 'tmp/jjf-fail.png' }); await browser.close(); console.log('FAIL: 新建按钮未见, 截图 tmp/jjf-fail.png'); process.exit(1) }
  await newBtn.click()
  await page.waitForTimeout(1000)
  const dialog = page.locator('[role="dialog"]')
  ok('对话框打开', await dialog.count() > 0)

  // 自动刷新开关在场(默认关闭 → 间隔输入隐藏)
  const switchLabel = dialog.locator('text=完成后自动刷新').first()
  ok('"完成后自动刷新"文案在场', await switchLabel.count() > 0)
  const input0 = dialog.locator('input[aria-label="自动刷新间隔分钟数"]')
  ok('关态下间隔输入隐藏', await input0.count() === 0 || !(await input0.isVisible().catch(() => false)))

  // 打开开关 → 输入显示
  const sw = dialog.locator('button[role="switch"][aria-label="自动刷新开关"], button[role="switch"]').filter({ hasNot: page.locator('x') }).last()
  // 精确: 用 aria-label 定位
  const swExact = dialog.locator('button[aria-label="自动刷新开关"]')
  ok('aria-label 开关可定位', await swExact.count() > 0)
  await swExact.click()
  await page.waitForTimeout(400)
  // 开态下间隔输入显示 → 填 2 → 先填名称(表单校验先撞名称), 再保存 → 间隔校验拦截(5~1440 toast)
  const input1 = dialog.locator('input[aria-label="自动刷新间隔分钟数"]')
  ok('开态下间隔输入显示', await input1.isVisible().catch(() => false))
  await dialog.locator('input').first().fill('jj-f-UI探针-不保存')
  // 选规则(校验链: 名称→规则→URL→间隔)
  await dialog.locator('button[role="combobox"]').first().click()
  await page.waitForTimeout(500)
  await page.locator('[role="option"]').first().click()
  await page.waitForTimeout(300)
  // 填书籍页 URL(single 模式校验)
  await dialog.locator('input[placeholder*="书籍"], input').nth(1).fill('https://example.com/book/1').catch(() => {})
  await page.waitForTimeout(300)
  await input1.fill('2')
  await dialog.locator('button').filter({ hasText: /创建任务/ }).click()
  await page.waitForTimeout(800)
  const toastTxt = await page.locator('[data-sonner-toast], [role="status"]').allInnerTexts().catch(() => [] as string[])
  ok('前端校验拦截(5~1440 toast)', toastTxt.some((t) => t.includes('自动刷新间隔')), JSON.stringify(toastTxt).slice(0, 120))
  // 关闭对话框(取消)
  await dialog.locator('button').filter({ hasText: '取消' }).click().catch(() => {})
  await page.waitForTimeout(600)

  // 编辑番茄任务 → 勾选态+间隔15(编辑按钮 title="编辑")
  const editBtn = page.locator('button[title="编辑"]:visible').last()
  ok('行内编辑按钮在场', await editBtn.count() > 0)
  // 倒序找番茄行: 任务列表按 updatedAt desc, 番茄任务在最新更新端
  const rows = page.locator('tr', { hasText: '番茄·剑仙 实时更新' })
  if (await rows.count()) {
    await rows.first().locator('button[title="编辑"]').click()
    await page.waitForTimeout(900)
    const d2 = page.locator('[role="dialog"]')
    const swOn = d2.locator('button[aria-label="自动刷新开关"][data-state="checked"]')
    ok('番茄任务开关为勾选态', await swOn.count() > 0, `state=${await swOn.count()}`)
    const iv = d2.locator('input[aria-label="自动刷新间隔分钟数"]')
    ok('番茄任务间隔=15', (await iv.inputValue().catch(() => '')) === '15', `got=${await iv.inputValue().catch(() => '?')}`)
    await d2.locator('button').filter({ hasText: '取消' }).click().catch(() => {})
  } else {
    console.log('  (番茄行未找到, 跳过勾选态断言)')
  }

  ok('0 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  ok('0 console error', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(`\nPASS ${pass} / FAIL ${failCnt}`)
  if (failCnt) { console.log('FAILURES:', fails.join(' | ')); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e); process.exit(1) })
