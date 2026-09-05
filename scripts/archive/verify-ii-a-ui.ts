// ============================================================
// Task ii-a 回归脚本 (playwright, 只读不改库)
// 1. 前台 4 页 0 pageerror / 0 console error
// 2. 阅读页三布局(classic/immersive/paginated, 经 ?theme= 覆盖链路 = hh-b 主题预览链复验)
// 3. 主题预览链路一例(主题卡片 → 预览前台 → ?theme= 覆盖 + 指示胶囊)
// 4. 修复证据①: 停用站点(status=false)不得出现在前台站点切换器(路由拦截注入, 不写库)
// 5. 修复证据②: BookDetail loadBook 卫旗 —— 晚到的旧书响应不得污染新书表单(路由延迟, 不写库)
// 6. 管理端 10 Section 逐页 0 pageerror / 0 console error
// 运行: bun scripts/verify-ii-a-ui.ts
// ============================================================
export {}
import { chromium, type Page, type Browser, type BrowserContext } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = 'http://localhost:3000'
const SHOT = resolve(process.cwd(), 'tmp/ii-a')
mkdirSync(SHOT, { recursive: true })

let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!ok) failures++
}

interface Stat {
  pe: number
  ce: number
  msgs: string[]
}
function makeCollector(pg: Page): Stat {
  const s: Stat = { pe: 0, ce: 0, msgs: [] }
  pg.on('pageerror', (e) => {
    s.pe++
    s.msgs.push(`pageerror: ${String(e).slice(0, 140)}`)
  })
  pg.on('console', (m) => {
    if (m.type() === 'error') {
      s.ce++
      s.msgs.push(`console: ${m.text().slice(0, 140)}`)
    }
  })
  return s
}
const statClean = (s: Stat) => s.pe === 0 && s.ce === 0
const statErr = (s: Stat) => (s.msgs.length ? s.msgs.slice(0, 2).join(' ; ') : '-')

async function jsonGet<T = Record<string, unknown>>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    const j = (await res.json()) as { ok?: boolean; data?: unknown }
    if (!j?.ok || j.data === undefined) return null
    return j.data as T
  } catch {
    return null
  }
}

let browserRef: Browser | null = null

async function main(): Promise<void> {
  /* ---------- 0. 准备(库内现有数据, 只读) ---------- */
  const sites = (await jsonGet<{ id: string; name: string; themeId: string; isDefault?: boolean; status?: boolean }[]>(`${BASE}/api/admin/sites`)) || []
  const defSite = sites.find((s) => s.isDefault && s.status !== false) || sites.find((s) => s.status !== false) || sites[0]
  if (!defSite) {
    console.log('❌ 无可用站点')
    process.exit(1)
  }
  const themes = (await jsonGet<{ id: string; name: string }[]>(`${BASE}/api/admin/themes`)) || []
  const themeIndex = (tid: string) => themes.findIndex((t) => t.id === tid)
  console.log(`站点: ${defSite.name}(${defSite.themeId}) 主题数=${themes.length}`)

  const firstChapterOf = async (): Promise<{ bookId: string; catId: string; chId: string } | null> => {
    const booksRaw = await jsonGet<{ books?: { id: string; categoryId?: string }[] }>(`${BASE}/api/public/books?site=${defSite.id}&size=5`)
    for (const b of booksRaw?.books || []) {
      const detail = await jsonGet<{ chapters?: { id: string }[] }>(`${BASE}/api/public/book?id=${b.id}&tocPage=1&tocSize=3`)
      const chs = detail?.chapters || []
      if (chs.length >= 1) return { bookId: b.id, catId: (b.categoryId as string) || '', chId: chs[0].id }
    }
    return null
  }
  const probe = await firstChapterOf()
  if (!probe) {
    console.log('❌ 默认站点无可用书籍章节')
    process.exit(1)
  }

  const browser = await chromium.launch()
  browserRef = browser
  const bail = async (e: unknown) => {
    console.error('verify crashed:', e)
    await browser.close().catch(() => {})
    process.exit(1)
  }
  process.on('SIGINT', () => void bail(new Error('SIGINT')))

  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const stat = makeCollector(page)
  const arm = () => {
    stat.pe = 0
    stat.ce = 0
    stat.msgs = []
  }
  const visit = async (name: string, url: string, waitMs: number, shot?: string) => {
    arm()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(waitMs)
    const bodyLen = await page.evaluate(() => document.body.innerText.length)
    check(`${name} 0 pageerror / 0 console error`, statClean(stat), `bodyText=${bodyLen} pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
    if (shot) await page.screenshot({ path: `${SHOT}/${shot}.png` })
  }

  /* ---------- 1. 前台四页 ---------- */
  await visit('前台·首页', `${BASE}/?view=home&site=${defSite.id}`, 2500, 'home')
  await visit('前台·分类页', `${BASE}/?view=category&cat=${probe.catId}&site=${defSite.id}`, 2200, 'category')
  await visit('前台·书籍页', `${BASE}/?view=book&id=${probe.bookId}&site=${defSite.id}`, 2200, 'book')
  await visit('前台·搜索页(带词)', `${BASE}/?view=search&q=${encodeURIComponent('剑')}&site=${defSite.id}`, 2500, 'search')

  /* ---------- 2. 阅读页三布局(经 ?theme= 覆盖 = hh-b 主题预览链路复验) ---------- */
  const readUrl = (themeId: string) => `${BASE}/?view=read&chapter=${probe.chId}&site=${defSite.id}&theme=${themeId}`

  // classic (bamboo)
  arm()
  await page.goto(readUrl('bamboo'), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)
  {
    const hit = await page.locator('.read-layout-classic').count()
    const o1 = await page.locator('.read-layout-immersive').count()
    const o2 = await page.locator('.read-layout-paginated').count()
    const crumb = await page.locator('[aria-label="面包屑"]').count()
    check('阅读·classic(theme=bamboo) 0 报错 + 类名互斥 + 面包屑', statClean(stat) && hit >= 1 && o1 === 0 && o2 === 0 && crumb >= 1, `命中=${hit} 他布局=${o1}/${o2} 面包屑=${crumb} ${statErr(stat)}`)
    await page.screenshot({ path: `${SHOT}/read-classic.png` })
  }

  // immersive (aurora)
  arm()
  await page.goto(readUrl('aurora'), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)
  {
    const hit = await page.locator('.read-layout-immersive').count()
    const o1 = await page.locator('.read-layout-classic').count()
    const o2 = await page.locator('.read-layout-paginated').count()
    const overlay = page.locator('.read-layout-immersive').first()
    const pos = await overlay.evaluate((el) => getComputedStyle(el).position).catch(() => 'none')
    const locked = await page.evaluate(() => document.body.style.overflow === 'hidden')
    check('阅读·immersive(theme=aurora) 0 报错 + 类名互斥 + fixed/锁滚', statClean(stat) && hit >= 1 && o1 === 0 && o2 === 0 && pos === 'fixed' && locked, `命中=${hit} pos=${pos} 锁滚=${locked} ${statErr(stat)}`)
    await page.screenshot({ path: `${SHOT}/read-immersive.png` })
  }

  // paginated (mango)
  arm()
  await page.goto(readUrl('mango'), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)
  {
    const hit = await page.locator('.read-layout-paginated').count()
    const o1 = await page.locator('.read-layout-classic').count()
    const o2 = await page.locator('.read-layout-immersive').count()
    const stageLabel = (await page.locator('[aria-label*="章节正文, 共"]').first().getAttribute('aria-label').catch(() => '')) || ''
    check('阅读·paginated(theme=mango) 0 报错 + 类名互斥 + 舞台页码', statClean(stat) && hit >= 1 && o1 === 0 && o2 === 0 && /共 \d+ 页/.test(stageLabel), `命中=${hit} 他布局=${o1}/${o2} label="${stageLabel}" ${statErr(stat)}`)
    await page.screenshot({ path: `${SHOT}/read-paginated.png` })
  }

  /* ---------- 3. 管理端 10 Section 逐页 0 报错 ---------- */
  const navBtn = (label: string) => page.locator('button:visible', { hasText: label }).first()
  arm()
  await page.goto(`${BASE}/?admin=1`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)
  check('管理端·仪表盘 0 pageerror / 0 console error', statClean(stat), `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
  await page.screenshot({ path: `${SHOT}/admin-dashboard.png` })

  const SECTIONS = ['采集规则', '采集任务', '书籍管理', '分类管理', '站群系统', '友链链轮', '主题模板', 'TXT下载', '系统设置'] as const
  for (const label of SECTIONS) {
    arm()
    await navBtn(label).click()
    await page.waitForTimeout(1600)
    const bodyLen = await page.evaluate(() => document.body.innerText.length)
    check(`管理端·${label} 0 pageerror / 0 console error`, statClean(stat), `bodyText=${bodyLen} pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
  }

  /* ---------- 4. 修复证据②: BookDetail loadBook 卫旗(路由延迟注入, 不写库) ---------- */
  {
    arm()
    await navBtn('书籍管理').click()
    await page.waitForTimeout(1800)
    const books = (await jsonGet<{ books?: { id: string; name: string }[] }>(`${BASE}/api/admin/books?page=1&size=20`))?.books || []
    const named = books.filter((b) => b.name && b.name.length >= 2)
    const uniq: { id: string; name: string }[] = []
    for (const b of named) {
      if (!uniq.some((x) => x.name === b.name)) uniq.push(b)
      if (uniq.length === 2) break
    }
    if (uniq.length < 2) {
      check('修复证据②·库内需两本不同名书籍', false, `named=${named.length}`)
    } else {
      const [bA, bB] = uniq
      // 拦截 A 的详情响应延迟 900ms; B 正常速度(RegExp 匹配完整 URL, 避免 glob {cuid} 花括号歧义)
      const reA = new RegExp('/api/admin/books/' + bA.id + '(\\?.*)?$')
      await ctx.route(reA, async (route) => {
        await new Promise((r) => setTimeout(r, 900))
        await route.continue()
      })
      const rowA = page.locator('tr', { hasText: bA.name }).first()
      await rowA.locator('button:has-text("详情")').click()
      await page.waitForTimeout(250) // 对话框打开, A 详情仍在途
      await page.keyboard.press('Escape') // 关闭(关闭不取消已发出的 A 请求)
      await page.waitForTimeout(350)
      const rowB = page.locator('tr', { hasText: bB.name }).first()
      await rowB.locator('button:has-text("详情")').click()
      await page.waitForTimeout(1600) // B 详情先到(渲染 B), A 的迟到响应后到(应被卫旗丢弃)
      const nameVal = await page.locator('[role="dialog"] input').first().inputValue().catch(() => '')
      check('修复证据②·晚到的旧书响应被丢弃, 表单仍为新书', nameVal === bB.name, `书名输入框="${nameVal}" 期望="${bB.name}"(A="${bA.name}")`)
      check('修复证据②·过程 0 pageerror / 0 console error', statClean(stat), `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
      await page.screenshot({ path: `${SHOT}/fix-bookdetail-guard.png` })
      await page.keyboard.press('Escape')
      await ctx.unroute(reA)
    }
  }

  /* ---------- 5. 主题预览链路一例(rose) ---------- */
  {
    const roseIdx = themeIndex('rose')
    if (roseIdx < 0) {
      check('主题预览链路·rose 在注册表', false)
    } else {
      arm()
      await navBtn('主题模板').click()
      await page.waitForTimeout(1600)
      const previewBtns = page.getByRole('button', { name: '预览前台' })
      const cnt = await previewBtns.count()
      check('主题预览链路·主题卡片预览按钮齐备', cnt === themes.length, `按钮=${cnt} 主题=${themes.length}`)
      await previewBtns.nth(roseIdx).click()
      await page.waitForTimeout(2600)
      const url = page.url()
      check('主题预览链路·URL 携带 theme=rose', url.includes('theme=rose'), url)
      const capsule = await page.locator('[aria-label="主题预览指示"]').innerText().catch(() => '')
      check('主题预览链路·预览指示胶囊在位', capsule.includes('预览主题'), `capsule="${capsule.replace(/\n/g, ' ')}"`)
      const bg = await page.evaluate(() => {
        const el = document.querySelector('div[style*="background"]')
        return el ? (el.getAttribute('style') || '') : ''
      })
      check('主题预览链路·前台根容器应用主题背景', /background/.test(bg) && bg.length > 10, `style="${bg.slice(0, 80)}"`)
      check('主题预览链路·全程 0 pageerror / 0 console error', statClean(stat), `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
      await page.screenshot({ path: `${SHOT}/preview-rose.png` })
    }
  }

  /* ---------- 6. 修复证据①: 停用站点不出现在前台切换器(路由拦截注入, 不写库) ---------- */
  {
    const probeName = 'ii-a停用探针站'
    await ctx.route('**/api/admin/sites', async (route) => {
      const resp = await route.fetch()
      const j = (await resp.json()) as { data?: unknown[] }
      j.data?.push({
        id: 'ii-a-fake-disabled', name: probeName, domain: 'ii-a-probe.invalid', themeId: 'aurora',
        title: '', description: '', keywords: '', icbm: '', geoRegion: '', geoPlacename: '',
        offset: 0, isDefault: false, status: false, inLinkWheel: false, createdAt: '', updatedAt: '',
      })
      await route.fulfill({ response: resp, json: j })
    })
    arm()
    await page.goto(`${BASE}/?view=home&site=${defSite.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2800)
    const headerText = await page.locator('header').first().innerText().catch(() => '')
    check('修复证据①·前台页头仍为启用中的默认站点', headerText.includes(defSite.name) && !headerText.includes(probeName), `header 含默认站=${headerText.includes(defSite.name)} 含探针=${headerText.includes(probeName)}`)
    await page.locator('[aria-label="切换站点"]').click()
    await page.waitForTimeout(600)
    const probeItems = await page.locator('[role="menuitem"]', { hasText: probeName }).count()
    const allItems = await page.locator('[role="menuitem"]').count()
    check('修复证据①·停用站点(status=false)不进站点切换器', probeItems === 0, `探针菜单项=${probeItems} 总菜单项=${allItems}`)
    check('修复证据①·过程 0 pageerror / 0 console error', statClean(stat), `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
    await page.screenshot({ path: `${SHOT}/fix-disabled-site.png` })
    await page.keyboard.press('Escape')
    await ctx.unroute('**/api/admin/sites')
  }

  await browser.close()
  browserRef = null
  console.log(`\n===== verify-ii-a-ui: ${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} =====`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('verify crashed:', e)
  if (browserRef) await browserRef.close().catch(() => {})
  process.exit(1)
})
