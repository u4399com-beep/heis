/** ss-c ConfirmDialog 视觉抽检探针(一次性): /?admin=1 触发 规则删除/任务删除/站点删除 确认框 → 截图 + Escape/遮罩/取消 行为核对 */
import { chromium } from 'playwright'

const errors: string[] = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 100)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 100)) })

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: string) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, d ?? '') } }
const dialog = page.locator('[data-slot="alert-dialog-content"]')

await page.goto('http://127.0.0.1:3000/?admin=1', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(2200)

// ---- 用例1: 采集规则 → 行内删除(ConfirmDialog danger) ----
await page.locator('aside button', { hasText: '采集规则' }).click()
await page.waitForTimeout(1200)
await page.locator('button:text-is("删除")').first().click()
await page.waitForTimeout(400)
ok('规则删除: 对话框打开', await dialog.isVisible())
const title1 = ((await page.locator('[data-slot="alert-dialog-title"]').textContent()) ?? '').trim()
ok('规则删除: 标题=确认删除规则?', title1 === '确认删除规则?', title1)
const desc1 = ((await page.locator('[data-slot="alert-dialog-description"]').textContent()) ?? '').trim()
ok('规则删除: 描述含「不可恢复」', desc1.includes('不可恢复'), desc1.slice(0, 40))
const actionCls = (await dialog.locator('button:text-is("删除")').getAttribute('class')) ?? ''
ok('规则删除: 确认钮 danger 红样式', actionCls.includes('bg-red-600') && actionCls.includes('hover:bg-red-700'), actionCls)
const cancelCls = (await dialog.locator('button:text-is("取消")').getAttribute('class')) ?? ''
ok('规则删除: 取消钮 zinc 描边样式', cancelCls.includes('border-zinc-700') && cancelCls.includes('text-zinc-300'), cancelCls)
const contentCls = (await dialog.getAttribute('class')) ?? ''
ok('规则删除: 容器 zinc-900 底/zinc-800 描边', contentCls.includes('bg-zinc-900') && contentCls.includes('border-zinc-800'), contentCls)
await page.screenshot({ path: 'tmp/ss-c-confirm-rule.png' })

// Escape 关闭(Radix 默认, 改前改后一致)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
ok('规则删除: Escape 关闭', !(await dialog.isVisible()))

// 遮罩点击不关(Radix AlertDialog 默认 prevent interactOutside, 行为不变)
await page.locator('button:text-is("删除")').first().click()
await page.waitForTimeout(400)
await page.mouse.click(30, 400)
await page.waitForTimeout(400)
ok('规则删除: 点遮罩不关闭(Radix AlertDialog 默认语义不变)', await dialog.isVisible())
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// ---- 用例2: 采集任务 → 行内 title="删除" ----
await page.locator('aside button', { hasText: '采集任务' }).click()
await page.waitForTimeout(1200)
await page.locator('button[title="删除"]').first().click()
await page.waitForTimeout(400)
ok('任务删除: 对话框打开', await dialog.isVisible())
const title2 = ((await page.locator('[data-slot="alert-dialog-title"]').textContent()) ?? '').trim()
ok('任务删除: 标题=确认删除任务?', title2 === '确认删除任务?', title2)
await page.screenshot({ path: 'tmp/ss-c-confirm-task.png' })
await dialog.locator('button:text-is("取消")').click()
await page.waitForTimeout(400)
ok('任务删除: 取消钮关闭', !(await dialog.isVisible()))

// ---- 用例3: 站群系统 → 行内 title="删除"(非默认站) ----
await page.locator('aside button', { hasText: '站群系统' }).click()
await page.waitForTimeout(1200)
await page.locator('button[title="删除"]').first().click()
await page.waitForTimeout(400)
ok('站点删除: 对话框打开', await dialog.isVisible())
const title3 = ((await page.locator('[data-slot="alert-dialog-title"]').textContent()) ?? '').trim()
ok('站点删除: 标题=确认删除站点?', title3 === '确认删除站点?', title3)
await page.screenshot({ path: 'tmp/ss-c-confirm-site.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

ok('零 pageerror/console error', errors.length === 0, errors.join(' | ').slice(0, 200))

console.log(`\nprobe-ss-c-confirm-visual: ${pass} pass / ${fail} fail — ${fail === 0 ? 'ALL PASS' : 'FAILURES'}`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
