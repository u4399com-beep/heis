// ============================================================
// Task jj-c 验证脚本 — UI 域生产就绪深审 (playwright, 只读不改库)
// 1. 0 pageerror / 0 console error 扫描: 管理端 10 Section + 前台 6 视图(含主题预览) + 移动端溢出
// 2. BookDetail.loadBook 竞态复现: 慢响应旧书数据不得覆盖新书对话框 (修复前必失败)
// 3. TaskMonitor 观测运行中番茄任务(只读, 不碰控制按钮):
//    3a. 监控轮询进行 + 列表轮询暂停/恢复 (网络请求计数)
//    3b. 线程滑块 aria-valuemax=32 / 间隔滑块 aria-valuemax=600000 (与后端钳制对齐, 修复前 16/10000 必失败)
//    3c. 进度/日志面板渲染正常
// 运行: bun scripts/verify-jj-c-ui.ts
// ============================================================
export {}
import { chromium, type Page, type Browser } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = 'http://localhost:3000'
const SHOT = resolve(process.cwd(), 'tmp/jj-c')
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
  /* ---------- 0. 基线数据(只读) ---------- */
  const sitesRaw = await jsonGet<{ id: string; name: string; themeId: string; isDefault?: boolean }[]>(`${BASE}/api/admin/sites`)
  const sites = sitesRaw || []
  const defSite = sites.find((s) => s.isDefault) || sites[0]
  if (!defSite) {
    console.log('❌ 无可用站点')
    process.exit(1)
  }
  const booksRaw = await jsonGet<{ books: { id: string; name: string }[] }>(`${BASE}/api/admin/books?page=1&size=2`)
  const bookA = booksRaw?.books?.[0]
  const bookB = booksRaw?.books?.[1]
  check('基线: 默认站点与前两本书就绪', !!defSite && !!bookA && !!bookB, `site=${defSite.name} A=${bookA?.name} B=${bookB?.name}`)

  const tasksRaw = await jsonGet<{ id: string; name: string; status: string }[]>(`${BASE}/api/admin/tasks`)
  const runningTask = (tasksRaw || []).find((t) => t.status === 'running')
  check('基线: 存在运行中任务(番茄采集)', !!runningTask, runningTask?.name || '无')

  // 前台样例: 书籍/章节
  let chId = ''
  let bookIdPub = ''
  const booksPub = (await jsonGet<{ books: { id: string; categoryId?: string }[] }>(`${BASE}/api/public/books?site=${defSite.id}&size=5`))?.books || []
  for (const b of booksPub) {
    const d = await jsonGet<{ chapters?: { id: string }[] }>(`${BASE}/api/public/book?id=${b.id}&tocPage=1&tocSize=3`)
    if ((d?.chapters || []).length >= 1) {
      bookIdPub = b.id
      chId = d!.chapters![0].id
      break
    }
  }
  check('基线: 前台样例书/章就绪', !!bookIdPub && !!chId)

  const browser = await chromium.launch()
  browserRef = browser

  try {
    /* ---------- 1. 管理端 10 Section 0-error 扫描 ---------- */
    {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
      const navLabels = ['仪表盘', '采集规则', '采集任务', '书籍管理', '分类管理', '站群系统', '友链链轮', '主题模板', 'TXT下载', '系统设置']
      let allOk = true
      const bad: string[] = []
      for (const label of navLabels) {
        const btn = pg.locator('aside button', { hasText: label })
        await btn.click()
        await pg.waitForTimeout(650)
        if (!statClean(st)) {
          allOk = false
          bad.push(`${label}:${statErr(st)}`)
          st.pe = 0
          st.ce = 0
          st.msgs = []
        }
      }
      check('管理端 10 Section 逐页 0 pageerror/0 console error', allOk, bad.join(' | ') || '全部干净')
      await pg.screenshot({ path: resolve(SHOT, 'admin-sweep.png') })
      await pg.close()
    }

    /* ---------- 2. 前台视图 0-error 扫描(含主题预览) ---------- */
    {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      const views: [string, string][] = [
        ['首页', `${BASE}/?view=home&site=${defSite.id}`],
        ['搜索', `${BASE}/?view=search&q=${encodeURIComponent('仙')}&site=${defSite.id}`],
        ['分类', `${BASE}/?view=category&site=${defSite.id}`],
        ['书籍', `${BASE}/?view=book&id=${bookIdPub}&site=${defSite.id}`],
        ['阅读', `${BASE}/?view=read&chapter=${chId}&site=${defSite.id}`],
        ['主题预览', `${BASE}/?view=home&theme=rose&site=${defSite.id}`],
      ]
      let allOk = true
      const bad: string[] = []
      for (const [name, url] of views) {
        await pg.goto(url, { waitUntil: 'networkidle' })
        await pg.waitForTimeout(500)
        if (!statClean(st)) {
          allOk = false
          bad.push(`${name}:${statErr(st)}`)
          st.pe = 0
          st.ce = 0
          st.msgs = []
        }
      }
      check('前台 6 视图 0 pageerror/0 console error', allOk, bad.join(' | ') || '全部干净')
      // 主题预览胶囊(hh-b 回归)
      await pg.goto(`${BASE}/?view=home&theme=rose&site=${defSite.id}`, { waitUntil: 'networkidle' })
      const capsule = await pg.locator('text=预览主题：').count()
      check('主题预览指示胶囊在位(hh-b 回归)', capsule > 0)
      await pg.close()
    }

    /* ---------- 3. 移动端 375 无横向溢出 ---------- */
    {
      const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?view=home&site=${defSite.id}`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(600)
      const m = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
      check('移动端首页 375 无横向溢出', m.sw <= m.iw + 1, `scrollWidth=${m.sw}`)
      check('移动端首页 0 报错', statClean(st), statErr(st))
      await pg.close()
    }

    /* ---------- 4. BookDetail.loadBook 竞态(修复前必失败) ---------- */
    if (bookA && bookB && bookA.id !== bookB.id) {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      // 拦截书籍 A 详情请求延迟 1200ms(精确匹配详情 URL, 不影响 /toc 与列表)
      const pattern = new RegExp(`/api/admin/books/${bookA.id}$`)
      await pg.route(pattern, async (route) => {
        await new Promise((r) => setTimeout(r, 1200))
        await route.continue()
      })
      await pg.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
      await pg.locator('aside button', { hasText: '书籍管理' }).click()
      await pg.waitForSelector('table tbody tr', { timeout: 15000 })

      const rowA = pg.getByRole('row').filter({ hasText: bookA.name }).first()
      await rowA.getByRole('button', { name: '详情' }).click()
      await pg.waitForTimeout(200) // 对话框已开, 慢响应在途
      await pg.keyboard.press('Escape') // 立即关闭
      await pg.waitForTimeout(150)

      const rowB = pg.getByRole('row').filter({ hasText: bookB.name }).first()
      await rowB.getByRole('button', { name: '详情' }).click()
      // 等书籍 B 加载完成(书名输入框 = B)
      const nameInput = pg.getByRole('dialog').locator('input').first()
      let loadedB = false
      try {
        await pg.waitForFunction(
          ([sel, want]) => {
            const el = document.querySelector(sel as string) as HTMLInputElement | null
            return !!el && el.value === want
          },
          ['[role="dialog"] input', bookB.name] as [string, string],
          { timeout: 8000 },
        )
        loadedB = true
      } catch {
        loadedB = (await nameInput.inputValue().catch(() => '')) === bookB.name
      }
      check('竞态前置: 书籍 B 对话框加载完成', loadedB, `input=${await nameInput.inputValue().catch(() => '?')}`)

      // 等 A 的慢响应落地(1200ms 已过) — 陈旧数据不得覆盖
      await pg.waitForTimeout(1800)
      const val = await nameInput.inputValue().catch(() => '')
      check('竞态修复: 慢响应旧书 A 不覆盖新书 B 对话框', val === bookB.name, `input=${val} 期望=${bookB.name}`)
      check('竞态场景 0 报错', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'bookdetail-race.png') })
      await pg.unroute(pattern)
      await pg.close()
    } else {
      check('竞态场景: 书籍不足 2 本, 跳过', true)
    }

    /* ---------- 5. TaskMonitor 观测运行中任务(只读) ---------- */
    if (runningTask) {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      let listReq = 0
      let detailReq = 0
      pg.on('request', (r) => {
        const u = r.url()
        if (/\/api\/admin\/tasks$/.test(u)) listReq++
        else if (new RegExp(`/api/admin/tasks/${runningTask.id}$`).test(u)) detailReq++
      })
      await pg.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
      await pg.locator('aside button', { hasText: '采集任务' }).click()
      await pg.waitForSelector('table tbody tr', { timeout: 15000 })
      await pg.waitForTimeout(3300)
      listReq = 0 // 基线清零

      const runRow = pg.getByRole('row').filter({ hasText: '运行中' }).first()
      await runRow.getByRole('button', { name: '监控' }).click()
      await pg.waitForSelector('text=实时日志', { timeout: 10000 })

      // 3b. 滑块量程与后端钳制对齐 (双拇指范围滑块: 4 个 thumb = 线程min/线程max/间隔min/间隔max)
      const sliders = pg.locator('[role="slider"]')
      const maxs = await sliders.evaluateAll((els) => els.map((e) => e.getAttribute('aria-valuemax')))
      check('线程滑块 aria-valuemax=32 (后端钳制对齐)', maxs.length >= 2 && maxs[1] === '32', `thumbs=${maxs.join(',')}`)
      check('间隔滑块 aria-valuemax=600000 (后端钳制对齐)', maxs.length >= 4 && maxs[3] === '600000', `thumbs=${maxs.join(',')}`)

      // 3a. 监控轮询进行 & 列表轮询暂停 (7s 计数)
      await pg.waitForTimeout(7000)
      check('监控打开期间: 列表轮询暂停(gg-c 回归)', listReq === 0, `list=${listReq}`)
      check('监控打开期间: 任务详情轮询进行(2s)', detailReq >= 3, `detail=${detailReq}`)

      // 3c. 进度与日志渲染
      const hasPhase = (await pg.locator('text=阶段:').count()) > 0
      const logRows = await pg.locator('[class*="font-mono"] >> text=/\\d{2}:\\d{2}:\\d{2}/').count()
      const bodyText = await pg.locator('body').innerText()
      check('监控: 阶段进度渲染', hasPhase)
      check('监控: 实时日志有内容(运行中任务)', logRows > 0 || /暂无日志/.test(bodyText) === false, `rows=${logRows}`)
      check('监控视图 0 报错', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'monitor-running.png') })

      // 返回列表 → 轮询恢复
      listReq = 0
      detailReq = 0
      await pg.getByRole('button', { name: '返回列表' }).click()
      await pg.waitForSelector('table tbody tr', { timeout: 10000 })
      await pg.waitForTimeout(7000)
      check('返回列表后: 列表轮询恢复(gg-c 回归)', listReq >= 2, `list=${listReq}`)
      check('列表视图 0 报错', statClean(st), statErr(st))
      await pg.close()
    } else {
      check('TaskMonitor 观测: 无运行中任务, 跳过', true)
    }
  } finally {
    await browserRef?.close().catch(() => {})
  }

  console.log(failures === 0 ? '\nALL PASS' : `\nFAILED: ${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify crashed:', e)
  browserRef?.close().catch(() => {})
  process.exit(1)
})
