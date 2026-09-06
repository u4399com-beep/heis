/**
 * verify-kk-c-ui.ts — kk-c 第9轮 API/UI 域深审 · UI 侧断言(playwright, 只读不改库)
 * 1. 修复复现/回归: TaskMonitor 自动刷新只读展示 — 番茄任务(autoRefresh=true, 15min)监控面板
 *    必须出现"自动刷新 · 每 15 分钟"文案(修复前缺失必失败), 且为只读(面板内无自动刷新开关)
 * 2. 管理端 10 Section + 前台 6 视图 0 pageerror / 0 console error
 * 3. 移动端 375 无横向溢出 + 监控面板 2s 轮询健康(gg-c 回归)
 * 纪律: 生产番茄任务只读不碰(不点任何控制按钮); process.exit(0/1)
 * 运行: bun scripts/verify-kk-c-ui.ts
 */
export {}
import { chromium, type Page, type Browser } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = 'http://localhost:3000'
const SHOT = resolve(process.cwd(), 'tmp/kk-c')
mkdirSync(SHOT, { recursive: true })

let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!ok) failures++
}

interface Stat { pe: number; ce: number; msgs: string[] }
function makeCollector(pg: Page): Stat {
  const s: Stat = { pe: 0, ce: 0, msgs: [] }
  pg.on('pageerror', (e) => { s.pe++; s.msgs.push(`pageerror: ${String(e).slice(0, 140)}`) })
  pg.on('console', (m) => { if (m.type() === 'error') { s.ce++; s.msgs.push(`console: ${m.text().slice(0, 140)}`) } })
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
  } catch { return null }
}

let browserRef: Browser | null = null

async function main() {
  /* ---------- 0. 基线(只读) ---------- */
  const tasks = (await jsonGet<{ id: string; name: string; status: string; autoRefresh: boolean; refreshIntervalMin: number }[]>(`${BASE}/api/admin/tasks`)) || []
  const tomato = tasks.find((t) => t.autoRefresh === true)
  check('基线: 存在 autoRefresh=true 任务(番茄)', !!tomato, `${tomato?.name} interval=${tomato?.refreshIntervalMin}`)
  if (!tomato) { console.log('无 autoRefresh 任务, 无法验证监控展示面'); process.exit(1) }

  const sitesRaw = await jsonGet<{ id: string; name: string; isDefault?: boolean }[]>(`${BASE}/api/admin/sites`)
  const defSite = (sitesRaw || []).find((s) => s.isDefault) || (sitesRaw || [])[0]
  const booksPub = (await jsonGet<{ books: { id: string }[] }>(`${BASE}/api/public/books?site=${defSite?.id || ''}&size=5`))?.books || []
  let chId = ''
  let bookIdPub = ''
  for (const b of booksPub) {
    const d = await jsonGet<{ chapters?: { id: string }[] }>(`${BASE}/api/public/book?id=${b.id}&tocPage=1&tocSize=3`)
    if ((d?.chapters || []).length >= 1) { bookIdPub = b.id; chId = d!.chapters![0].id; break }
  }
  check('基线: 站点/前台书章就绪', !!defSite && !!bookIdPub && !!chId)

  const browser = await chromium.launch()
  browserRef = browser

  try {
    /* ---------- 1. 修复复现/回归: TaskMonitor 自动刷新只读展示 ---------- */
    {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
      await pg.locator('aside button', { hasText: '采集任务' }).click()
      await pg.waitForSelector('table tbody tr', { timeout: 15000 })
      // 定位番茄任务行 → 点监控(只读入口)
      const row = pg.locator('table tbody tr', { hasText: tomato.name }).first()
      check('任务列表含番茄任务行', (await row.count()) > 0, tomato.name)
      await row.locator('button[title="监控"]').click()
      // 等监控面板挂载(返回列表按钮出现)
      await pg.waitForSelector('button:has-text("返回列表")', { timeout: 15000 })
      await pg.waitForTimeout(1200)

      // ★ 核心断言(修复前缺失必失败): 监控面板出现"自动刷新"文案 + 间隔分钟数
      const refreshHint = pg.locator('text=自动刷新')
      const hintCount = await refreshHint.count()
      check('监控面板出现「自动刷新」只读提示(修复复现/回归)', hintCount > 0, `count=${hintCount}`)
      if (hintCount > 0) {
        const hintText = (await refreshHint.first().innerText()).replace(/\s+/g, '')
        check('提示含间隔分钟数', hintText.includes(String(tomato.refreshIntervalMin)) && hintText.includes('分钟'), hintText.slice(0, 40))
      }
      // 只读语义: 监控面板内不提供自动刷新开关(开关仅存在于 TaskDialog)
      const switchInMonitor = await pg.locator('button[role="switch"][aria-label="自动刷新开关"]').count()
      check('监控面板无自动刷新开关(只读语义)', switchInMonitor === 0)

      // 监控面板基础健康: 顶部状态徽标 + 进度卡 + 日志区在位; 观察 3 个轮询周期 0 报错
      check('监控面板状态徽标在位', (await pg.locator('text=进程在线').count()) + (await pg.locator('text=进程离线').count()) > 0)
      check('监控面板进度卡在位', (await pg.locator('text=运行进度').count()) > 0)
      check('监控面板日志区在位', (await pg.locator('text=实时日志').count()) > 0)
      await pg.waitForTimeout(6500)
      check('监控面板 2s 轮询 3 周期 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'monitor-autorefresh.png') })
      await pg.close()
    }

    /* ---------- 2. 管理端 10 Section 0-error 扫描 ---------- */
    {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
      const navLabels = ['仪表盘', '采集规则', '采集任务', '书籍管理', '分类管理', '站群系统', '友链链轮', '主题模板', 'TXT下载', '系统设置']
      let allOk = true
      const bad: string[] = []
      for (const label of navLabels) {
        await pg.locator('aside button', { hasText: label }).click()
        await pg.waitForTimeout(650)
        if (!statClean(st)) {
          allOk = false
          bad.push(`${label}:${statErr(st)}`)
          st.pe = 0; st.ce = 0; st.msgs = []
        }
      }
      check('管理端 10 Section 逐页 0 pageerror/0 console error', allOk, bad.join(' | ') || '全部干净')
      await pg.close()
    }

    /* ---------- 3. 前台 6 视图 0-error 扫描 ---------- */
    {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      const siteQ = defSite ? `&site=${defSite.id}` : ''
      const views: [string, string][] = [
        ['首页', `${BASE}/?view=home${siteQ}`],
        ['搜索', `${BASE}/?view=search&q=${encodeURIComponent('仙')}${siteQ}`],
        ['分类', `${BASE}/?view=category${siteQ}`],
        ['书籍', `${BASE}/?view=book&id=${bookIdPub}${siteQ}`],
        ['阅读', `${BASE}/?view=read&chapter=${chId}${siteQ}`],
        ['主题预览', `${BASE}/?view=home&theme=rose${siteQ}`],
      ]
      let allOk = true
      const bad: string[] = []
      for (const [name, url] of views) {
        await pg.goto(url, { waitUntil: 'networkidle' })
        await pg.waitForTimeout(500)
        if (!statClean(st)) {
          allOk = false
          bad.push(`${name}:${statErr(st)}`)
          st.pe = 0; st.ce = 0; st.msgs = []
        }
      }
      check('前台 6 视图 0 pageerror/0 console error', allOk, bad.join(' | ') || '全部干净')
      const capsule = await pg.locator('text=预览主题：').count()
      check('主题预览胶囊在位(hh-b 回归)', capsule > 0)
      await pg.close()
    }

    /* ---------- 4. 移动端 375 无横向溢出 ---------- */
    {
      const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?view=home${defSite ? `&site=${defSite.id}` : ''}`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(600)
      const m = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
      check('移动端首页 375 无横向溢出', m.sw <= m.iw + 1, `scrollWidth=${m.sw}`)
      check('移动端首页 0 报错', statClean(st), statErr(st))
      await pg.close()
    }
  } finally {
    await browserRef?.close()
  }

  console.log('\n==========')
  console.log(`FAIL ${failures}`)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(1) })
