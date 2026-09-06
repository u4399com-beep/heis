/**
 * rr-d2 疑点① 最小复现探针: RuleEditor「附加请求头」Textarea 键盘输入回弹
 * 假设: value=headersToText(输入) ⇄ onChange=textToHeaders 双向受控,
 *       无冒号行被 textToHeaders(i>0 判定)丢弃 → 逐键输入新 header key 被回弹吞掉。
 * 判定: 键盘逐字输入 "X-Probe" 后 textarea 值若为空串/不完整 → bug 证实; 完整保留 → 误报排除。
 */
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors: string[] = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 120)))

await page.goto('http://127.0.0.1:3000/?admin=1', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(1200)

// 进入 采集规则 区块
await page.locator('aside button', { hasText: '采集规则' }).click()
await page.waitForTimeout(600)
// 新建规则 → RuleEditor 打开
await page.locator('button', { hasText: '新建规则' }).click()
await page.waitForTimeout(600)
// 切到 反反爬设置 页签
await page.getByRole('tab', { name: '反反爬设置' }).click()
await page.waitForTimeout(400)

// 定位「附加请求头」下的 textarea(placeholder 含 X-Requested-With)
const ta = page.locator('textarea[placeholder*="X-Requested-With"]')
const n = await ta.count()
if (n !== 1) {
  console.log(`PROBE-ABORT: 附加请求头 textarea 命中 ${n} 个(预期 1)`)
  await browser.close()
  process.exit(0)
}

// 逐键输入(真实 keydown 节奏, 每键间隔 60ms)
await ta.click()
await page.keyboard.type('X-Probe', { delay: 60 })
await page.waitForTimeout(300)
const afterKey = (await ta.inputValue()) ?? ''

// 对照组: 粘贴完整 "K: V" 行(带冒号) — 预期可保留
await ta.fill('')
await ta.click()
await page.keyboard.insertText('X-Probe2: 1')
await page.waitForTimeout(300)
const afterPaste = (await ta.inputValue()) ?? ''

// 对照组2: 继续在已有行下追加新行 "abc"(无冒号) — 预期该行被吞
await ta.fill('Accept-Language: zh-CN')
await ta.click()
await page.keyboard.press('End')
await page.keyboard.press('Enter')
await page.keyboard.type('abc', { delay: 60 })
await page.waitForTimeout(300)
const afterAppend = (await ta.inputValue()) ?? ''

console.log('A) 逐键输入 "X-Probe" 后值 =', JSON.stringify(afterKey))
console.log('B) insertText 整行 "X-Probe2: 1" 后值 =', JSON.stringify(afterPaste))
console.log('C) 已有行下追加无冒号行 "abc" 后值 =', JSON.stringify(afterAppend))

const bug =
  afterKey === '' || // 逐键输入全被吞
  afterKey.length < 'X-Probe'.length || // 或部分被吞
  !afterAppend.includes('abc') // 追加无冒号行被吞(已有行也被回弹则更实锤)
console.log(bug ? '\n★BUG 证实: 键盘自然输入新 header 被回弹丢弃' : '\n误报排除: 键盘输入可正常保留')
console.log('pageerror:', errors.length)
await browser.close()
process.exit(0)
