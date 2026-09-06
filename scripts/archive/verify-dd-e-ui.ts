// ============================================================
// dd-e UI 实证验证(playwright, 只读) — agent-browser 禁用(白屏幻影前科)
// ①公开前台 /?view=home 0 pageerror 0 console error(回归)
// ②前台分类深链 /?view=category&cat=<id> 渲染分类名(PublicSite cat 深链修复验证)
// ③后台规则编辑器: 反反爬设置页签 → 高级折叠区展开 → token 四字段+hostGateLimit 渲染
// 运行: bun scripts/verify-dd-e-ui.ts (需 dev server 存活)
// ============================================================
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'

let passed = 0
let failed = 0
function assert(cond: boolean, name: string, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS: ${name}`)
  } else {
    failed++
    console.log(`  FAIL: ${name} ${detail}`)
  }
}

async function main() {
  // 取一个真实分类 id(只读 API)
  const catsRes = await fetch(`${BASE}/api/admin/categories`)
  const catsJson = (await catsRes.json()) as { ok: boolean; data?: { id: string; name: string }[] }
  const cats = Array.isArray(catsJson.data) ? catsJson.data : []
  const cat = cats.find((c) => c.name)
  console.log(`分类: ${cat ? `${cat.name}(${cat.id})` : '无(深链用例跳过)'}`)

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  let pageErrors = 0
  let consoleErrors = 0
  const errTexts: string[] = []
  page.on('pageerror', (e) => {
    pageErrors++
    errTexts.push(`pageerror: ${String(e).slice(0, 200)}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') {
      consoleErrors++
      errTexts.push(`console: ${m.text().slice(0, 200)}`)
    }
  })

  try {
    // ---------- ① 前台首页回归 ----------
    console.log('\n== ① 前台 /?view=home ==')
    await page.goto(`${BASE}/?view=home`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)
    const homeText = await page.evaluate(() => document.body.innerText)
    assert(homeText.length > 200, '前台首页渲染(bodyText>200)', `len=${homeText.length}`)
    assert(pageErrors === 0 && consoleErrors === 0, '前台 0 pageerror 0 console error', JSON.stringify(errTexts.slice(0, 3)))

    // ---------- ② 分类深链(cat 修复验证) ----------
    if (cat) {
      console.log('\n== ② 深链 /?view=category&cat=<id> ==')
      pageErrors = 0
      consoleErrors = 0
      errTexts.length = 0
      await page.goto(`${BASE}/?view=category&cat=${cat.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(3000)
      const catText = await page.evaluate(() => document.body.innerText)
      const catTitle = await page.title()
      // 修复前(initialView 硬拽 cat:undefined): 标题/页头回退为"全部分类", 分类名不出现在页头
      assert(catTitle.includes(cat.name) && !catText.includes('全部分类'), '深链分类页头为具体分类(cat 存活)', `title="${catTitle}"`)
      assert(pageErrors === 0 && consoleErrors === 0, '深链 0 pageerror 0 console error', JSON.stringify(errTexts.slice(0, 3)))
    }

    // ---------- ③ 后台规则编辑器高级折叠区 ----------
    console.log('\n== ③ 后台规则编辑器高级区 ==')
    pageErrors = 0
    consoleErrors = 0
    errTexts.length = 0
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2500)
    await page.locator('button:has-text("采集规则"):visible').first().click()
    await page.waitForTimeout(1500)
    // 打开编辑器: 优先编辑既有规则(能验证存量 token 配置回显), 否则新建
    const editBtn = page.locator('button:has-text("编辑"):visible').first()
    if ((await editBtn.count()) > 0) {
      await editBtn.click()
      console.log('  (编辑既有规则)')
    } else {
      await page.locator('button:has-text("新建规则"):visible').first().click()
      console.log('  (新建规则)')
    }
    await page.waitForTimeout(1500)
    // 切到 反反爬设置 页签
    await page.locator('[role="tab"]:has-text("反反爬设置")').click()
    await page.waitForTimeout(800)
    // 高级折叠区默认收起, 展开它
    const trigger = page.locator('button:has-text("高级选项")')
    assert((await trigger.count()) > 0, '高级选项折叠触发器存在')
    await trigger.first().click()
    await page.waitForTimeout(600)
    for (const label of ['Token 预取地址 tokenUrl', 'Token 提取表达式 tokenPattern', 'Token 注入方式 tokenInjection', 'Token 请求头名 tokenHeaderName', '同站并发上限 hostGateLimit']) {
      const vis = await page.locator(`label:has-text("${label}"):visible`).count()
      assert(vis > 0, `高级区字段可见: ${label}`)
    }
    const advText = await page.evaluate(() => document.body.innerText)
    assert(advText.includes('30s 缓存') || advText.includes('预取'), '说明文案渲染')
    // 往返安全性 UI 佐证: 编辑器 state 含高级字段时页签切换后仍保存(静态检查由 verify-dd-e-editor.ts 覆盖)
    assert(pageErrors === 0 && consoleErrors === 0, '后台编辑器 0 pageerror 0 console error', JSON.stringify(errTexts.slice(0, 3)))
  } finally {
    await browser.close()
  }

  console.log(`\nverify-dd-e-ui: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}
main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
