// ============================================================
// Task gg-c 验证脚本 — 前台全页深度验证 + UI 卫生修复回归 (playwright, 只读不改库)
// 1. 全页 0 pageerror / 0 console error: 首页/分类/书籍/搜索 + 阅读页三布局(classic/immersive/paginated) + 管理端全部 Section
// 2. 三布局类名互斥命中 (复用 ee-c 口径)
// 3. A 修复回归: paginated 快速翻章 + 卸载后无残留(detached scrollTo 计数=0)
// 4. B 修复回归: monitor 打开时列表轮询暂停但监控轮询进行, 返回列表后恢复 (网络请求计数)
// 5. 移动端 375×812: 首页+阅读页无横向溢出
// 运行: bun scripts/verify-gg-c-ui.ts
// ============================================================
export {}
import { chromium, type Page, type Browser } from 'playwright'
import { mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const BASE = 'http://localhost:3000'
const SHOT = resolve(process.cwd(), 'tmp/gg-c')
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

async function main() {
  /* ---------- 0. 准备: 站点/书籍/章节 (库内现有数据, 只读) ---------- */
  const sitesRaw = await jsonGet<Record<string, unknown>[]>(`${BASE}/api/admin/sites`)
  const sites = ((sitesRaw?.['items'] as unknown) || sitesRaw || []) as { id: string; name: string; themeId: string }[]
  const byTheme = (tid: string) => sites.find((s) => s.themeId === tid)
  const defSite = sites.find((s) => (s as { isDefault?: boolean }).isDefault) || sites[0]
  const t = { bamboo: byTheme('bamboo'), mango: byTheme('mango'), aurora: byTheme('aurora') }
  if (!defSite || !t.bamboo || !t.mango || !t.aurora) {
    console.log('❌ 站点不足(bamboo/mango/aurora 缺失):', sites.map((s) => `${s.name}:${s.themeId}`).join(', '))
    process.exit(1)
  }
  console.log(`站点: 默认=${defSite.name}(${defSite.themeId}) bamboo/mango/aurora 就绪`)

  const firstChapterOf = async (siteId: string): Promise<{ bookId: string; catId: string; chId: string; nextChId: string } | null> => {
    const booksRaw = await jsonGet<{ books?: { id: string; categoryId?: string }[] }>(`${BASE}/api/public/books?site=${siteId}&size=5`)
    for (const b of booksRaw?.books || []) {
      const detail = await jsonGet<{ chapters?: { id: string }[] }>(`${BASE}/api/public/book?id=${b.id}&tocPage=1&tocSize=3`)
      const chs = detail?.chapters || []
      if (chs.length >= 2) return { bookId: b.id, catId: (b.categoryId as string) || '', chId: chs[0].id, nextChId: chs[1].id }
    }
    return null
  }
  const defBook = await firstChapterOf(defSite.id)
  if (!defBook) {
    console.log('❌ 默认站点无可用书籍章节')
    process.exit(1)
  }

  const browser = await chromium.launch()
  browserRef = browser
  // 崩溃时也释放浏览器进程(防孤儿 chromium)
  const bail = async (e: unknown) => {
    console.error('verify crashed:', e)
    await browser.close().catch(() => {})
    process.exit(1)
  }
  process.on('SIGINT', () => void bail(new Error('SIGINT')))

  /* ============================================================
   * Part 1 — 前台全页 + 阅读页三布局 (desktop 1440×900)
   * ============================================================ */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
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

  /* ---------- 1. 常规四页 ---------- */
  await visit('首页', `${BASE}/?view=home&site=${defSite.id}`, 2500, 'home')
  await visit('分类页', `${BASE}/?view=category&cat=${defBook.catId}&site=${defSite.id}`, 2500, 'category')
  await visit('书籍页', `${BASE}/?view=book&id=${defBook.bookId}&site=${defSite.id}`, 2500, 'book')
  await visit('搜索页(带词)', `${BASE}/?view=search&q=${encodeURIComponent('剑')}&site=${defSite.id}`, 2800, 'search')

  /* ---------- 2. 阅读页三布局: 0 报错 + 类名互斥 + 特征探针 ---------- */
  const layoutCase = async (
    name: string,
    site: { id: string; themeId: string },
    expectClass: string,
    otherClasses: string[],
    extraProbe: () => Promise<[string, boolean]>,
    shot?: string,
  ) => {
    const info = await firstChapterOf(site.id)
    if (!info) {
      check(`阅读·${name}`, false, '无章节')
      return
    }
    arm()
    await page.goto(`${BASE}/?view=read&chapter=${info.chId}&site=${site.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3200)
    const hit = await page.locator(`.${expectClass}`).count()
    const others: Record<string, number> = {}
    for (const oc of otherClasses) others[oc] = await page.locator(`.${oc}`).count()
    check(`阅读·${name} 0 报错 + 类名=${expectClass} 互斥`, statClean(stat) && hit >= 1 && otherClasses.every((oc) => others[oc] === 0), `命中=${hit} 他布局=${JSON.stringify(others)} pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
    const [label, ok] = await extraProbe()
    check(`阅读·${name} ${label}`, ok)
    if (shot) await page.screenshot({ path: `${SHOT}/${shot}.png` })
  }

  await layoutCase('bamboo典书版', t.bamboo, 'read-layout-classic', ['read-layout-immersive', 'read-layout-paginated'], async () => {
    const crumb = await page.locator('[aria-label="面包屑"]').count()
    return [`面包屑=${crumb}`, crumb >= 1]
  }, 'read-classic')

  await layoutCase('aurora沉浸暗色', t.aurora, 'read-layout-immersive', ['read-layout-classic', 'read-layout-paginated'], async () => {
    const overlay = page.locator('.read-layout-immersive').first()
    const pos = await overlay.evaluate((el) => getComputedStyle(el).position)
    const locked = await page.evaluate(() => document.body.style.overflow === 'hidden')
    return [`position=${pos} body锁滚=${locked}`, pos === 'fixed' && locked]
  }, 'read-immersive')

  // mango → paginated: 类名互斥 + A 修复两项交互断言在本段内完成
  {
    const info = (await firstChapterOf(t.mango.id))!
    arm()
    await page.goto(`${BASE}/?view=read&chapter=${info.chId}&site=${t.mango.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3200)
    const hit = await page.locator('.read-layout-paginated').count()
    const o1 = await page.locator('.read-layout-classic').count()
    const o2 = await page.locator('.read-layout-immersive').count()
    const stageLabel = (await page.locator('[aria-label*="章节正文, 共"]').first().getAttribute('aria-label').catch(() => '')) || ''
    check(
      '阅读·mango分页横滑 0 报错 + 类名=read-layout-paginated 互斥',
      statClean(stat) && hit >= 1 && o1 === 0 && o2 === 0,
      `命中=${hit} classic=${o1} immersive=${o2} pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`,
    )
    check('阅读·mango分页横滑 舞台页码标签', /共 \d+ 页/.test(stageLabel), `label="${stageLabel}"`)
    await page.screenshot({ path: `${SHOT}/read-paginated.png` })

    /* ---------- 3. A 修复回归①: 快速翻章无残留报错 ---------- */
    arm()
    await page.locator('[aria-label="下一章"]').click()
    await page.waitForTimeout(90)
    await page.locator('[aria-label="下一章"]').click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(1200)
    const stageAfter = await page.locator('[aria-label*="章节正文, 共"]').count()
    check('A修复·paginated 快速翻章 0 残留报错', statClean(stat) && stageAfter >= 1, `pe=${stat.pe} ce=${stat.ce} 舞台=${stageAfter} ${statErr(stat)}`)

    /* ---------- 4. A 修复回归②: 卸载后 detached scrollTo 计数 = 0 ---------- */
    // 拦截 Element.prototype.scrollTo, 统计对已脱离 DOM 元素的调用(修复前: 卸载后 160ms snapTimer 仍会打一发)
    await page.evaluate(() => {
      const w = window as unknown as { __detScroll: number; __origScrollTo?: unknown }
      w.__detScroll = 0
      if (!w.__origScrollTo) {
        w.__origScrollTo = Element.prototype.scrollTo
        const orig = w.__origScrollTo as unknown as (this: Element, ...a: unknown[]) => void
        Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
          if (!this.isConnected) (window as unknown as { __detScroll: number }).__detScroll++
          orig.apply(this, args)
        } as unknown as typeof Element.prototype.scrollTo
      }
    })
    // 触发一次 stage 滚动事件 → onStageScroll 武装 160ms snapTimer → 立即返回书籍页卸载组件
    await page.evaluate(() => document.querySelector('.reader-cols')?.dispatchEvent(new Event('scroll')))
    await page.locator('button[aria-label^="返回《"]').click()
    await page.waitForTimeout(450) // > 160ms snap 窗口
    const det = await page.evaluate(() => (window as unknown as { __detScroll: number }).__detScroll)
    const onBook = await page.locator('[aria-label="增大字号"]').count() // paginated 工具条已卸载
    check('A修复·卸载后 detached scrollTo 计数=0', det === 0, `detScroll=${det} 已离开阅读页=${onBook === 0}`)
    check('A修复·卸载过程 0 pageerror / 0 console error', statClean(stat), `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
  }

  /* ---------- 5. 管理端全部 Section ---------- */
  // 注: 桌面视口下移动端底部导航(lg:hidden)在 DOM 但不可见, 须用 :visible 过滤避免点击不可见节点
  const navBtn = (label: string) => page.locator('button:visible', { hasText: label }).first()
  arm()
  await page.goto(`${BASE}/?admin=1`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)
  const net = { list: 0, monitor: 0 }
  page.on('request', (r) => {
    let p: string
    try {
      p = new URL(r.url()).pathname
    } catch {
      return
    }
    if (!p.startsWith('/api/admin/tasks')) return
    if (p === '/api/admin/tasks') net.list++
    else if (p.startsWith('/api/admin/tasks/')) net.monitor++
  })
  const resetNet = () => {
    net.list = 0
    net.monitor = 0
  }
  check('管理端·默认(仪表盘) 0 pageerror / 0 console error', statClean(stat), `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
  await page.screenshot({ path: `${SHOT}/admin-dashboard.png` })

  const SECTIONS = ['采集规则', '采集任务', '书籍管理', '分类管理', '站群系统', '友链链轮', '主题模板', 'TXT下载', '系统设置'] as const
  for (const label of SECTIONS) {
    arm()
    await navBtn(label).click()
    await page.waitForTimeout(1800)
    const bodyLen = await page.evaluate(() => document.body.innerText.length)
    check(`管理端·${label} 0 pageerror / 0 console error`, statClean(stat), `bodyText=${bodyLen} pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
    if (label === '采集任务') await page.screenshot({ path: `${SHOT}/admin-tasks.png` })
  }

  /* ---------- 6. B 修复回归: monitor 打开暂停列表轮询 / 关闭恢复 ---------- */
  {
    const tasksRaw = await jsonGet<{ id: string }[]>(`${BASE}/api/admin/tasks`)
    const taskId = (Array.isArray(tasksRaw) ? tasksRaw[0]?.id : '') || ''
    if (!taskId) {
      check('B修复·存在可监控任务', false, '任务列表为空')
    } else {
      // 进入采集任务 section(上循环最后一个 section=系统设置, 需先切回)
      await navBtn('采集任务').click()
      await page.waitForTimeout(1800) // 首次 load 完成

      // Phase1: 列表视图 7s → 3s 轮询应 ≥2 次
      resetNet()
      await page.waitForTimeout(7000)
      check('B修复·列表视图 3s 轮询进行中', net.list >= 2, `7s 内 list 请求=${net.list}`)

      // Phase2: 打开监控 → 列表轮询暂停 / 监控 2s 轮询进行
      arm()
      await page.locator('[title="监控"]').first().click()
      await page.waitForTimeout(2200) // monitor 首帧 + 首个 2s tick
      resetNet()
      await page.waitForTimeout(7000)
      check('B修复·monitor 打开时列表轮询已暂停', net.list === 0, `7s 内 list 请求=${net.list}`)
      check('B修复·monitor 打开时监控轮询进行中', net.monitor >= 2, `7s 内 monitor 请求=${net.monitor}`)
      const monitorUi = await page.locator('text=在线调节').count()
      check('B修复·monitor 视图 0 pageerror / 0 console error', statClean(stat) && monitorUi >= 1, `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
      await page.screenshot({ path: `${SHOT}/admin-monitor.png` })

      // Phase3: 返回列表 → 轮询恢复
      await page.locator('button', { hasText: '返回列表' }).first().click()
      await page.waitForTimeout(1600)
      resetNet()
      await page.waitForTimeout(7000)
      check('B修复·返回列表后 3s 轮询恢复', net.list >= 2, `7s 内 list 请求=${net.list}`)
      check('B修复·往返全程 0 pageerror / 0 console error', statClean(stat), `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
    }
  }
  await ctx.close()

  /* ============================================================
   * Part 2 — 移动端断点 375×812: 首页+阅读页无横向溢出
   * ============================================================ */
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const mpage = await mctx.newPage()
  const mstat = makeCollector(mpage)

  const overflowCheck = async (name: string, url: string, waitMs: number, shot?: string) => {
    mstat.pe = 0
    mstat.ce = 0
    mstat.msgs = []
    await mpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await mpage.waitForTimeout(waitMs)
    const { sw, iw } = await mpage.evaluate(() => ({
      sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      iw: window.innerWidth,
    }))
    check(`移动端·${name} 无横向溢出`, sw <= iw + 1, `scrollWidth=${sw} innerWidth=${iw}`)
    check(`移动端·${name} 0 pageerror / 0 console error`, statClean(mstat), `pe=${mstat.pe} ce=${mstat.ce} ${statErr(mstat)}`)
    if (shot) await mpage.screenshot({ path: `${SHOT}/${shot}.png` })
  }
  await overflowCheck('首页', `${BASE}/?view=home&site=${defSite.id}`, 2500, 'mobile-home')
  await overflowCheck('阅读页(classic)', `${BASE}/?view=read&chapter=${defBook.chId}&site=${defSite.id}`, 3000, 'mobile-read')
  await mctx.close()

  await browser.close()

  console.log('\n== gg-c 汇总 ==')
  console.log(`失败项 = ${failures}`)
  if (failures > 0) process.exit(1)
  console.log('ALL PASS')
}

main().catch((e) => {
  console.error('verify crashed (unhandled):', e)
  try {
    void browserRef?.close()
  } catch {}
  // 兜底清扫本进程派生的孤儿 chromium
  try {
    execSync('pkill -f chrome-headless-shell || true')
  } catch {}
  process.exit(1)
})
