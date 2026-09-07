// ============================================================
// Task ee-c 验证脚本 — 阅读主题多布局重构 (playwright, 只读不改库)
// 1. 前台首页/分类/书籍页/阅读页 四页 × 0 pageerror 0 console error
// 2. ≥2 套主题阅读页布局类名差异断言 (classic/paginated/immersive 三原型)
//    bamboo→read-layout-classic / mango→read-layout-paginated / aurora→read-layout-immersive
// 3. 阅读页功能保留断言: 字号调节/章节导航/正文渲染/沉浸接管(锁滚动)
// 运行: bun scripts/verify-ee-c-ui.ts
// ============================================================
export {}
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'

interface Stat {
  pageErrors: number
  consoleErrors: number
  texts: string[]
}
const newStat = (): Stat => ({ pageErrors: 0, consoleErrors: 0, texts: [] })

async function jsonGet(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url)
    const j = (await res.json()) as { ok?: boolean; data?: unknown }
    if (!j?.ok || j.data === undefined) return null
    return j.data as Record<string, unknown>
  } catch {
    return null
  }
}

async function main() {
  /* ---------- 0. 准备: 站点/书籍/章节 ---------- */
  const sitesRaw = await jsonGet(`${BASE}/api/admin/sites`)
  const sites = (sitesRaw?.['items'] || sitesRaw || []) as { id: string; name: string; themeId: string; isDefault?: boolean }[]
  const byTheme = (tid: string) => sites.find((s) => s.themeId === tid)
  const targetSites = { bamboo: byTheme('bamboo'), mango: byTheme('mango'), aurora: byTheme('aurora') }
  const defaultSite = sites.find((s) => s.isDefault) || sites[0]
  if (!defaultSite || !targetSites.bamboo || !targetSites.mango || !targetSites.aurora) {
    console.log('❌ 站点不足(bamboo/mango/aurora 三主题站点缺失), sites =', sites.map((s) => `${s.name}:${s.themeId}`).join(', '))
    process.exit(1)
  }
  console.log(`站点: 默认=${defaultSite.name}(${defaultSite.themeId}) bamboo=${!!targetSites.bamboo} mango=${!!targetSites.mango} aurora=${!!targetSites.aurora}`)

  const firstChapterOf = async (siteId: string): Promise<{ bookId: string; catId: string; chId: string } | null> => {
    const booksRaw = await jsonGet(`${BASE}/api/public/books?site=${siteId}&size=5`)
    const books = (booksRaw?.['books'] || []) as { id: string; categoryId?: string }[]
    for (const b of books) {
      const detail = await jsonGet(`${BASE}/api/public/book?id=${b.id}&tocPage=1&tocSize=3`)
      const chapters = (detail?.['chapters'] || []) as { id: string }[]
      if (chapters.length) return { bookId: b.id, catId: (b.categoryId as string) || '', chId: chapters[0].id }
    }
    return null
  }
  const defBook = await firstChapterOf(defaultSite.id)
  if (!defBook) {
    console.log('❌ 默认站点无可用书籍章节')
    process.exit(1)
  }

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  let stat = newStat()
  const arm = () => {
    stat = newStat()
    page.on('pageerror', (e) => {
      stat.pageErrors++
      stat.texts.push(`pageerror: ${String(e).slice(0, 120)}`)
    })
    page.on('console', (m) => {
      if (m.type() === 'error') {
        stat.consoleErrors++
        stat.texts.push(`console: ${m.text().slice(0, 120)}`)
      }
    })
  }
  const clean = () => stat.pageErrors === 0 && stat.consoleErrors === 0
  const errs = () => (stat.texts.length ? JSON.stringify(stat.texts.slice(0, 3)) : '-')

  let failures = 0
  const check = (name: string, ok: boolean, extra = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
    if (!ok) failures++
  }

  /* ---------- 1. 四页 × 0 报错 (默认站点 bamboo) ---------- */
  const pages4: [string, string][] = [
    ['首页', `${BASE}/?view=home&site=${defaultSite.id}`],
    ['分类页', `${BASE}/?view=category&cat=${defBook.catId}&site=${defaultSite.id}`],
    ['书籍页', `${BASE}/?view=book&id=${defBook.bookId}&site=${defaultSite.id}`],
    ['阅读页', `${BASE}/?view=read&chapter=${defBook.chId}&site=${defaultSite.id}`],
  ]
  for (const [name, url] of pages4) {
    arm()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(name === '阅读页' ? 3500 : 2800)
    const bodyLen = (await page.evaluate(() => document.body.innerText.length))
    check(`四页·${name} 0 报错`, clean(), `bodyText=${bodyLen} pageerror=${stat.pageErrors} console=${stat.consoleErrors} ${errs()}`)
    if (name === '阅读页') {
      const hasArticle = await page.locator('[aria-label="章节正文"]').count()
      const contentLen = hasArticle ? (await page.locator('[aria-label="章节正文"]').first().innerText()).replace(/\s/g, '').length : 0
      const fontBtns = await page.locator('[aria-label="增大字号"]').count()
      const prevBtn = await page.locator('[aria-label="上一章"]').count()
      const nextBtn = await page.locator('[aria-label="下一章"]').count()
      check('阅读页·正文渲染白名单', contentLen > 300, `正文去空白=${contentLen}`)
      check('阅读页·字号/翻章控件保留', fontBtns >= 1 && prevBtn >= 1 && nextBtn >= 1, `字号键=${fontBtns} 上一章=${prevBtn} 下一章=${nextBtn}`)
    }
  }

  /* ---------- 2. ≥2 套主题阅读页布局类名差异 ---------- */
  const layoutCase = async (
    name: string,
    site: { id: string; name: string } | undefined,
    expectClass: string,
    otherClasses: string[],
    extraProbe: () => Promise<[string, boolean]>,
  ) => {
    if (!site) {
      check(`布局·${name}`, false, '站点缺失')
      return
    }
    const info = await firstChapterOf(site.id)
    if (!info) {
      check(`布局·${name}`, false, '无章节')
      return
    }
    arm()
    await page.goto(`${BASE}/?view=read&chapter=${info.chId}&site=${site.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3500)
    const hit = await page.locator(`.${expectClass}`).count()
    const others: Record<string, number> = {}
    for (const oc of otherClasses) others[oc] = await page.locator(`.${oc}`).count()
    const othersAbsent = otherClasses.every((oc) => others[oc] === 0)
    check(`布局·${name} 类名=${expectClass}`, hit >= 1 && othersAbsent, `命中=${hit} 他布局类=${JSON.stringify(others)} ${errs()}`)
    const [label, ok] = await extraProbe()
    check(`布局·${name} ${label}`, ok)
  }

  // bamboo → classic: 面包屑 + 虚线三键导航
  await layoutCase('bamboo典书版', targetSites.bamboo, 'read-layout-classic', ['read-layout-immersive', 'read-layout-paginated'], async () => {
    const crumb = await page.locator('[aria-label="面包屑"]').count()
    const backTop = await page.locator('[aria-label="回到顶部"]').count()
    return [`面包屑=${crumb} 回顶=${backTop}`, crumb >= 1]
  })

  // mango → paginated: 多列舞台 + 页码指示 + 页进度
  await layoutCase('mango分页横滑', targetSites.mango, 'read-layout-paginated', ['read-layout-classic', 'read-layout-immersive'], async () => {
    const stage = await page.locator('[aria-label*="章节正文, 共"]').count()
    const stageLabel = stage ? await page.locator('[aria-label*="章节正文, 共"]').first().getAttribute('aria-label') : ''
    return [`舞台=${stage} 标签="${stageLabel || ''}"`, stage >= 1 && /共 \d+ 页/.test(stageLabel || '')]
  })

  // aurora → immersive: fixed 接管 + body 锁滚动 + 悬浮字号胶囊
  await layoutCase('aurora沉浸暗色', targetSites.aurora, 'read-layout-immersive', ['read-layout-classic', 'read-layout-paginated'], async () => {
    const overlay = await page.locator('.read-layout-immersive').first()
    const pos = await overlay.evaluate((el) => getComputedStyle(el).position)
    const locked = await page.evaluate(() => document.body.style.overflow === 'hidden')
    const pill = await page.locator('[aria-label="阅读设置"]').count()
    return [`position=${pos} body锁滚=${locked} 胶囊=${pill}`, pos === 'fixed' && locked && pill >= 1]
  })

  // 目录抽屉功能 (classic 变体)
  {
    arm()
    const info = await firstChapterOf(targetSites.bamboo!.id)
    await page.goto(`${BASE}/?view=read&chapter=${info!.chId}&site=${targetSites.bamboo!.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)
    await page.locator('[aria-label="打开章节目录抽屉"]').first().click()
    let drawerOk = false
    let drawerText = ''
    try {
      await page.locator('[role="dialog"][aria-label="章节目录"]').waitFor({ state: 'visible', timeout: 6000 })
      await page.waitForTimeout(1200)
      drawerText = (await page.locator('[role="dialog"][aria-label="章节目录"]').innerText()).replace(/\s/g, '')
      drawerOk = drawerText.includes('章节目录') && drawerText.length > 40
    } catch {
      drawerOk = false
    }
    check('目录抽屉·懒加载渲染', drawerOk, `内容长=${drawerText.length}`)
    await page.keyboard.press('Escape')
  }

  await browser.close()

  console.log('\n== ee-c 汇总 ==')
  console.log(`失败项 = ${failures}`)
  if (failures > 0) process.exit(1)
  console.log('ALL PASS')
}

main()
