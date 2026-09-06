/**
 * verify-ll-d-ui.ts — ll-d API/UI 第10轮深验(kk 轮新代码面: 分卷 UI 全链路 + 任务自动刷新交互链)
 * 断言面:
 *   ① API 域(只读): 任务 autoRefresh 出口(TaskMonitor 徽标数据源) / admin toc + public book 的
 *      volume 白名单与越权字段泄漏核对(对照 Chapter model 全字段) / clampInt 钳制 / ERR 信封一致
 *   ② 管理端真实数据: 番茄书(全空卷) BookDetail 分组不启用=零回归
 *   ③ 管理端 mock 分卷边界(route 拦截, 零写库): 空卷归「正文」/ 卷头折叠 aria-expanded /
 *      超长卷名(153 CJK)换行无溢出 / 换书折叠状态重置竞态
 *   ④ 前台: 真实数据零回归 + mock 分卷(空卷 fallback/窄屏 375 无溢出/theme=paper 适配) +
 *      阅读页 TocDrawer 卷头 + Escape
 *   ⑤ 任务链: TaskMonitor 自动刷新徽标(⟳每N分钟) + TaskDialog autoRefresh 开关交互链
 *      (开关双向/前端校验 5~1440/PUT payload) — 全程写类请求被 playwright 拦截(fulfill/abort),
 *      生产番茄任务只读不碰, 实际落库写路径 = 0
 * 纪律: 只读(不写库不写 data/); 禁触 task control; 0 pageerror/0 console error 收集
 * 运行: bun scripts/verify-ll-d-ui.ts
 */
export {}
import { chromium, type Page, type Browser, type Route } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = 'http://127.0.0.1:3000'
const SHOT = resolve(process.cwd(), 'tmp/ll-d')
mkdirSync(SHOT, { recursive: true })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = ''): void {
  if (ok) { pass++; console.log(`✅ ${name}${extra ? ` | ${extra}` : ''}`) }
  else { fail++; console.log(`❌ ${name}${extra ? ` | ${extra}` : ''}`) }
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

async function jsonGet<T = Record<string, unknown>>(url: string): Promise<{ status: number; body: T | null; ok: boolean; message?: string }> {
  try {
    const res = await fetch(url)
    const j = (await res.json()) as { ok?: boolean; data?: T; message?: string }
    return { status: res.status, body: (j?.ok ? (j.data ?? null) : null), ok: !!j?.ok, message: j?.message }
  } catch { return { status: 0, body: null, ok: false } }
}

interface TocApiChapter { id: string; idx: number; title: string; volume?: string; wordCount: number; [k: string]: unknown }

let browserRef: Browser | null = null

/* ---------- mock 数据(kk 轮分卷边界; 只存在于 playwright route 拦截层, 不落库) ---------- */
const NOW = '2026-09-03T00:00:00.000Z'
// 153 个 CJK 字符的超长卷名(> runner.ts 落库钳制上限 120, 压力取上限以上)
const LONG_VOL = '第一卷' + '千'.repeat(150)
const adminCh = (id: string, idx: number, title: string, volume: string) => ({
  id, idx, title, url: 'https://example.test/x', storage: 'db', filePath: null,
  wordCount: 1000, fetched: true, volume, updatedAt: NOW,
})
// mockA: 空卷 + 超长卷名×2 + 普通卷名 → 3 组(正文/第一卷千…/第二卷)
const tocMockA = {
  total: 4, page: 1, size: 50,
  chapters: [
    adminCh('c1', 1, '楔子', ''),
    adminCh('c2', 2, '第一章 起点', LONG_VOL),
    adminCh('c3', 3, '第二章 转折', LONG_VOL),
    adminCh('c4', 4, '第三章 结束', '第二卷'),
  ],
}
// mockB: 另一本书(与 mockA 首卷同名) → 验证换书后 volCollapsed 重置
const tocMockB = {
  total: 2, page: 1, size: 50,
  chapters: [
    adminCh('d1', 1, '序章', LONG_VOL),
    adminCh('d2', 2, '末章', '第二卷'),
  ],
}
const adminBookMock = (id: string, chapters: number) => ({
  id, name: '分卷边界·管理端测', author: '测试者', intro: '分卷边界 mock 简介', cover: '',
  status: 'ongoing', keywords: '', categoryId: null, sourceUrl: '', storageMode: 'db',
  updatedAt: NOW, tags: [], _count: { chapters, tags: 0 },
})
const pubCh = (id: string, idx: number, title: string, volume: string) => ({ id, idx, title, wordCount: 1000, volume })
const pubBookMock = {
  book: {
    id: 'mockbook', name: '分卷边界·前台测', author: '测试者', intro: '这是分卷边界测试书籍的简介。',
    cover: '', status: 'ongoing', keywords: '测试', wordCount: 3000, latestChapter: '第二章 转折',
    sourceUrl: '', category: '测试', categoryId: null, updatedAt: NOW,
  },
  tocTotal: 3, tocPage: 1, tocSize: 100, tocTotalPages: 1,
  chapters: [pubCh('c1', 1, '楔子', ''), pubCh('c2', 2, '第一章 起点', LONG_VOL), pubCh('c3', 3, '第二章 转折', LONG_VOL)],
  tags: [],
}

/** 写安全网: 管理端任何 POST/PUT/DELETE 一律计数+abort(兜底防误触写库) */
function attachWriteGuard(pg: Page, counter: { blocked: number }): void {
  void pg.route((u) => u.pathname.startsWith('/api/admin/'), async (route: Route) => {
    const m = route.request().method()
    if (m !== 'GET') { counter.blocked++; await route.abort() }
    else await route.fallback()
  })
}

async function main() {
  /* ---------- ① API 域探针(只读) ---------- */
  console.log('\n== ① API 域: autoRefresh 出口 + volume 白名单 + 钳制 + 信封 ==')
  const tasksRes = await jsonGet<{ id: string; name: string; status: string; autoRefresh: boolean; refreshIntervalMin: number }[]>(`${BASE}/api/admin/tasks`)
  const autoTasks = (tasksRes.body || []).filter((t) => t.autoRefresh === true)
  const prod = autoTasks.find((t) => t.name.includes('番茄')) || autoTasks[0]
  check('A1 生产番茄任务在库且 autoRefresh=true + 间隔合法', !!prod && prod.refreshIntervalMin >= 5 && prod.refreshIntervalMin <= 1440,
    prod ? `id=${prod.id} status=${prod.status} interval=${prod.refreshIntervalMin}` : 'no autoRefresh task')
  if (!prod) process.exit(1)

  const det = await jsonGet<Record<string, unknown>>(`${BASE}/api/admin/tasks/${prod.id}`)
  check('A2 任务详情出口含 autoRefresh/refreshIntervalMin(TaskMonitor 徽标数据源)',
    det.ok && typeof det.body?.autoRefresh === 'boolean' && typeof det.body?.refreshIntervalMin === 'number',
    `status=${det.body?.status}`)

  // 番茄书(当前生产书): 动态定位章节最多的一本
  const booksRes = await jsonGet<{ total: number; books: { id: string; name: string; _count?: { chapters: number } }[] }>(`${BASE}/api/admin/books?size=50`)
  const books = booksRes.body?.books || []
  const tomato = [...books].sort((a, b) => (b._count?.chapters || 0) - (a._count?.chapters || 0))[0]
  check('A3 番茄书在库(章节数最大)', !!tomato && (tomato._count?.chapters || 0) > 1000,
    tomato ? `${tomato.name} chapters=${tomato._count?.chapters}` : 'none')
  if (!tomato) process.exit(1)
  const bookId = tomato.id

  const toc = await jsonGet<{ total: number; page: number; size: number; chapters: TocApiChapter[] }>(`${BASE}/api/admin/books/${bookId}/toc?page=1&size=5`)
  const ch0 = toc.body?.chapters?.[0]
  check('A4 admin toc 暴露 volume 字段', !!ch0 && typeof ch0.volume === 'string', `vol=${JSON.stringify(ch0?.volume)}`)
  const adminKeys = ch0 ? Object.keys(ch0).sort().join(',') : ''
  const adminExpected = ['id', 'idx', 'title', 'url', 'storage', 'filePath', 'wordCount', 'fetched', 'volume', 'updatedAt'].sort().join(',')
  check('A5 admin toc 键集合=白名单(无 content/bookId/createdAt 越权泄漏)', adminKeys === adminExpected, adminKeys)

  const pub = await jsonGet<{ tocTotal: number; tocPage: number; tocSize: number; tocTotalPages: number; chapters: TocApiChapter[] }>(`${BASE}/api/public/book?id=${bookId}&tocPage=1&tocSize=100`)
  const pch0 = pub.body?.chapters?.[0]
  const pubKeys = pch0 ? Object.keys(pch0).sort().join(',') : ''
  const pubExpected = ['id', 'idx', 'title', 'wordCount', 'volume'].sort().join(',')
  check('A6 public book 键集合=白名单(无 url/storage/filePath/content 泄漏)', pubKeys === pubExpected, pubKeys)
  check('A7 public book volume 字段暴露', !!pch0 && typeof pch0.volume === 'string')
  check('A8 番茄书现状: 首页 100 章 volume 全空(源站该书无卷结构 → 前后台零回归前提)',
    (pub.body?.chapters || []).length === 100 && (pub.body?.chapters || []).every((c) => c.volume === ''),
    `tocTotal=${pub.body?.tocTotal}`)

  const clamp = await jsonGet<{ tocPage: number; tocSize: number }>(`${BASE}/api/public/book?id=${bookId}&tocPage=0&tocSize=99999`)
  check('A9 clampInt 钳制: tocPage 0→1 / tocSize 99999→300', clamp.body?.tocPage === 1 && clamp.body?.tocSize === 300,
    `page=${clamp.body?.tocPage} size=${clamp.body?.tocSize}`)

  const e1 = await jsonGet(`${BASE}/api/public/book`)
  const e2 = await jsonGet(`${BASE}/api/public/book?id=nonexistent-ll-d`)
  const e3 = await jsonGet(`${BASE}/api/admin/tasks/nonexistent-ll-d`)
  check('A10 ERR 信封一致 {ok:false,message}: 缺参/书404/任务404',
    (!e1.ok && !!e1.message) && (!e2.ok && !!e2.message) && (!e3.ok && !!e3.message),
    `${e1.message}/${e2.message}/${e3.message}`)

  /* ---------- playwright ---------- */
  const browser = await chromium.launch()
  browserRef = browser
  const writeGuard = { blocked: 0 }
  const realChId = pch0?.id as string

  try {
    /* ---------- ②③ 管理端: 真实数据零回归 + mock 分卷边界 ---------- */
    console.log('\n== ② 管理端真实数据: 番茄书(全空卷)BookDetail ==')
    const pgA = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const stA = makeCollector(pgA)
    attachWriteGuard(pgA, writeGuard)
    await pgA.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
    await pgA.locator('aside button', { hasText: '书籍管理' }).click()
    const search = pgA.locator('input[placeholder="书名 / 作者…"]')
    await search.fill(tomato.name.slice(0, 12))
    await pgA.waitForTimeout(900)
    const row = pgA.locator('table tbody tr', { hasText: tomato.name.slice(0, 12) }).first()
    check('B0 书籍列表检索到番茄书', (await row.count()) > 0)
    await row.locator('button', { hasText: '详情' }).click()
    await pgA.waitForSelector('table tbody tr td', { timeout: 15000 })
    await pgA.waitForTimeout(800)
    check('B1 全空卷书目录 0 卷头(分组不启用=渲染与改前一致)', (await pgA.locator('[data-vol-head]').count()) === 0)
    check('B2 章节行仍正常渲染 + 全选框在位', (await pgA.locator('table tbody tr').count()) > 0 &&
      (await pgA.locator('table thead button[role="checkbox"], table thead input[type="checkbox"]').count()) > 0)
    check('B3 真实数据段 0 pageerror/0 console error', statClean(stA), statErr(stA))
    await pgA.keyboard.press('Escape')
    await pgA.waitForTimeout(400)

    console.log('\n== ③ 管理端 mock 分卷边界(空卷/超长卷名/折叠/换书竞态) ==')
    let tocMock: typeof tocMockA | typeof tocMockB = tocMockA
    // 拦截该书的详情与目录(仅这条路径, 其余走真实 GET)
    await pgA.route((u) => u.pathname === `/api/admin/books/${bookId}`, async (route) => {
      if (route.request().method() !== 'GET') { await route.abort(); return }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: adminBookMock(bookId, 4) }) })
    })
    await pgA.route((u) => u.pathname === `/api/admin/books/${bookId}/toc`, async (route) => {
      if (route.request().method() !== 'GET') { await route.abort(); return }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: tocMock }) })
    })
    await row.locator('button', { hasText: '详情' }).click()
    await pgA.waitForSelector('[data-vol-head]', { timeout: 15000 })
    await pgA.waitForTimeout(500)
    const heads = pgA.locator('[data-vol-head]')
    check('B4 mock 分卷书卷头 ×3(正文/超长卷名/第二卷)', (await heads.count()) === 3, `count=${await heads.count()}`)
    const firstTxt = (await heads.first().innerText()).replace(/\s+/g, '')
    check('B5 空卷归「正文」组', firstTxt.includes('正文'), firstTxt.slice(0, 20))
    check('B6 卷头 aria-expanded 默认 true', (await heads.first().getAttribute('aria-expanded')) === 'true')

    const rowsBefore = await pgA.locator('table tbody tr').count()
    await heads.first().click() // 首组=正文(1 章)
    await pgA.waitForTimeout(250)
    const rowsCollapsed = await pgA.locator('table tbody tr').count()
    check('B7 点击卷头折叠: aria-expanded=false + 行数减少',
      (await heads.first().getAttribute('aria-expanded')) === 'false' && rowsCollapsed === rowsBefore - 1,
      `before=${rowsBefore} after=${rowsCollapsed}`)
    await heads.first().click()
    await pgA.waitForTimeout(250)
    check('B8 再点展开恢复', (await heads.first().getAttribute('aria-expanded')) === 'true' &&
      (await pgA.locator('table tbody tr').count()) === rowsBefore)

    // 超长卷名(153 CJK): 断言口径=可见且断行收敛(修复后 break-all 生效, 宽度受表格容器约束, 不再撑破布局)
    const longSpan = pgA.locator('[data-vol-head] span', { hasText: '第一卷' }).first()
    const longBox = await longSpan.boundingBox()
    check('B9 超长卷名(153 CJK)可见且换行收敛(宽≤容器820=未撑破布局)', !!longBox && longBox.width <= 820,
      longBox ? `w=${Math.round(longBox.width)} h=${Math.round(longBox.height)}` : 'no box')

    // 换书折叠状态竞态: 折叠超长卷名组 → 关闭 → 换 mockB(同卷名)重开 → 应默认展开
    await pgA.locator('[data-vol-head]', { hasText: '第一卷' }).first().click()
    await pgA.waitForTimeout(250)
    await pgA.keyboard.press('Escape')
    await pgA.waitForTimeout(500)
    tocMock = tocMockB
    await row.locator('button', { hasText: '详情' }).click()
    await pgA.waitForSelector('[data-vol-head]', { timeout: 15000 })
    await pgA.waitForTimeout(500)
    const headsB = pgA.locator('[data-vol-head]')
    check('B10 换书后折叠状态重置(同卷名新书默认展开, 无跨书串状态)',
      (await headsB.count()) === 2 && (await headsB.first().getAttribute('aria-expanded')) === 'true',
      `count=${await headsB.count()}`)
    check('B11 mock 分卷段 0 pageerror/0 console error', statClean(stA), statErr(stA))
    await pgA.screenshot({ path: resolve(SHOT, 'admin-vol-mock.png') })
    await pgA.keyboard.press('Escape')
    await pgA.waitForTimeout(300)
    await pgA.close()

    /* ---------- ④ 前台: 真实数据 + mock 分卷 + TocDrawer ---------- */
    console.log('\n== ④ 前台书籍页/阅读页分卷 ==')
    {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?view=book&id=${bookId}`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(900)
      check('C0 真实数据: 前台书籍页 0 卷头(全空卷零回归)', (await pg.locator('[data-vol-head]').count()) === 0)
      check('C1 章节链接可点 + TXT 下载链接在位',
        (await pg.locator('section[aria-label="章节目录"] button').count()) > 0 &&
        (await pg.locator('a[href*="/api/public/download?book="]').count()) > 0)
      check('C2 目录分页在位(4252 章/100 每页)', (await pg.getByText(/第 1\/\d+ 页/).count()) > 0)
      check('C3 真实前台 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.close()
    }
    {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.route((u) => u.pathname === '/api/public/book', async (route) => {
        if (route.request().method() !== 'GET') { await route.abort(); return }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: pubBookMock }) })
      })
      await pg.goto(`${BASE}/?view=book&id=${bookId}`, { waitUntil: 'networkidle' })
      await pg.waitForSelector('[data-vol-head]', { timeout: 15000 })
      await pg.waitForTimeout(500)
      const heads = pg.locator('[data-vol-head]')
      check('C4 mock: 前台卷头 ×2', (await heads.count()) === 2, `count=${await heads.count()}`)
      const t0 = (await heads.nth(0).innerText()).replace(/\s+/g, '')
      const t1 = (await heads.nth(1).innerText()).replace(/\s+/g, '')
      check('C5 卷头文案: 空卷→正文 / 超长卷名透传', t0.includes('正文') && t1.includes('第一卷') && t1.includes('千'), `${t0.slice(0, 8)}/${t1.slice(0, 12)}…`)
      check('C6 卷头含章数统计', /\d+章/.test(t0), t0.slice(0, 16))
      // 窄屏 375: 分卷头不撑破布局
      await pg.setViewportSize({ width: 375, height: 812 })
      await pg.waitForTimeout(500)
      const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check('C7 窄屏 375 无横向溢出(超长卷名换行收敛)', overflow <= 1, `overflowPx=${overflow}`)
      check('C8 窄屏 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'public-vol-mobile.png') })
      // 主题适配: paper 主题覆盖下卷头仍按主题变量渲染
      await pg.setViewportSize({ width: 1440, height: 900 })
      await pg.goto(`${BASE}/?view=book&id=${bookId}&theme=paper`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(700)
      check('C9 theme=paper 主题覆盖下卷头仍渲染', (await pg.locator('[data-vol-head]').count()) === 2)
      check('C10 前台 mock 段 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.close()
    }
    {
      // 阅读页 TocDrawer 分卷(classic 布局)
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.route((u) => u.pathname === '/api/public/book', async (route) => {
        if (route.request().method() !== 'GET') { await route.abort(); return }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: pubBookMock }) })
      })
      await pg.goto(`${BASE}/?view=read&chapter=${realChId}`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(900)
      // mm 适配: 默认主题现为 pili(ReadPili 底部固定条), 文内导航(sm:hidden)与底条按钮
      // 同含「目录」子串 —— 定位须可见性过滤, 否则桌面端 first() 命中 0×0 隐藏按钮点击超时
      await pg.locator('[aria-label*="目录"]:visible').first().click()
      await pg.waitForSelector('[role="dialog"][aria-label="章节目录"]', { timeout: 10000 })
      await pg.waitForTimeout(600)
      const dHeads = pg.locator('[role="dialog"][aria-label="章节目录"] [data-vol-head]')
      check('C11 抽屉卷头 ×2(正文/超长卷名)', (await dHeads.count()) === 2, `count=${await dHeads.count()}`)
      const dt = (await dHeads.nth(1).innerText()).replace(/\s+/g, '')
      check('C12 抽屉卷头文案含超长卷名前缀', dt.includes('第一卷'), dt.slice(0, 12))
      check('C13 抽屉章节条目可点', (await pg.locator('[role="dialog"][aria-label="章节目录"] li button').count()) > 0)
      await pg.keyboard.press('Escape')
      await pg.waitForTimeout(300)
      check('C14 Escape 关闭抽屉', (await pg.locator('[role="dialog"][aria-label="章节目录"]').count()) === 0)
      check('C15 阅读页 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'read-tocdrawer-ll.png') })
      await pg.close()
    }

    /* ---------- ⑤ TaskMonitor 徽标 + TaskDialog 交互链(写请求全拦截) ---------- */
    console.log('\n== ⑤ TaskMonitor 自动刷新徽标 + TaskDialog autoRefresh 交互链 ==')
    const pgT = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const stT = makeCollector(pgT)
    attachWriteGuard(pgT, writeGuard)
    // PUT 捕获器(后注册优先): fulfill 模拟成功, 请求不落库, payload 可断言
    const taskPutBodies: Record<string, unknown>[] = []
    await pgT.route((u) => u.pathname === `/api/admin/tasks/${prod.id}`, async (route) => {
      const req = route.request()
      if (req.method() === 'PUT') {
        taskPutBodies.push((req.postDataJSON() || {}) as Record<string, unknown>)
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { ...prod } }) })
      } else {
        await route.fallback()
      }
    })
    await pgT.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
    await pgT.locator('aside button', { hasText: '采集任务' }).click()
    await pgT.waitForSelector('table tbody tr', { timeout: 15000 })
    const taskRow = pgT.locator('table tbody tr', { hasText: '番茄' }).first()
    check('D1 任务列表含生产番茄任务', (await taskRow.count()) > 0)
    await taskRow.locator('button[title="监控"]').click()
    await pgT.waitForTimeout(3200) // 覆盖 ≥1 轮 2s 轮询(任务详情靠轮询首拉, 1200ms 会撞"正在连接"时序误报)
    check('D2 监控面板显示任务名', (await pgT.getByText('番茄小说聚合API').count()) > 0)
    const badge = pgT.locator('span', { hasText: '自动刷新' }).first()
    const badgeTxt = (await badge.count()) > 0 ? await badge.innerText() : ''
    check('D3 ★ 自动刷新只读徽标(⟳每N分钟)在位', /自动刷新:\s*每\s*\d+\s*分钟/.test(badgeTxt.replace(/\s+/g, ' ').trim()), badgeTxt.trim())
    check('D4 进程在线徽标与状态徽标在位', (await pgT.getByText(/进程(在线|离线)/).count()) > 0)
    await pgT.waitForTimeout(3200) // 覆盖 ≥1 轮 2s 轮询
    check('D5 监控轮询窗口 0 pageerror/0 console error', statClean(stT), statErr(stT))
    await pgT.screenshot({ path: resolve(SHOT, 'task-monitor-badge.png') })
    await pgT.locator('button', { hasText: '返回列表' }).click()
    await pgT.waitForTimeout(800)

    // TaskDialog 交互链
    await taskRow.locator('button[title="编辑"]').click()
    await pgT.waitForSelector('[aria-label="自动刷新开关"]', { timeout: 10000 })
    const sw = pgT.locator('[aria-label="自动刷新开关"]')
    const intervalInput = pgT.locator('input[aria-label="自动刷新间隔分钟数"]')
    check('D6 开关 aria-label 在位且回填 checked', (await sw.getAttribute('data-state')) === 'checked')
    // tt 轮动态化: 回填值断言对齐任务实际间隔(A1 已动态发现; autofill 任务=30m 亦合法, 原硬编码 15 已漂移)
    check('D7 间隔输入 aria-label 在位且回填任务实际间隔', (await intervalInput.inputValue()) === String(prod.refreshIntervalMin), `got=${await intervalInput.inputValue()} expect=${prod.refreshIntervalMin}`)
    // 双向切换: off → 间隔区消失; on → 恢复(纯前端状态, 不提交)
    await sw.click()
    await pgT.waitForTimeout(200)
    const offOk = (await sw.getAttribute('data-state')) === 'unchecked' && (await intervalInput.count()) === 0
    await sw.click()
    await pgT.waitForTimeout(200)
    check('D8 开关双向切换联动间隔区显隐', offOk && (await sw.getAttribute('data-state')) === 'checked' && (await intervalInput.count()) === 1)
    // 非法间隔(3): 前端校验拦截 → 0 个 PUT 发出
    await intervalInput.fill('3')
    await pgT.locator('button', { hasText: '保存修改' }).click()
    await pgT.waitForTimeout(600)
    check('D9 非法间隔(<5)前端校验拦截 + toast 提示',
      taskPutBodies.length === 0 && (await pgT.locator('[data-sonner-toast]', { hasText: '5 ~ 1440' }).count()) > 0,
      `putCount=${taskPutBodies.length}`)
    // 合法保存: 恰 1 个 PUT 且 payload 正确(被 fulfill, 不落库)
    await intervalInput.fill('15')
    await pgT.locator('button', { hasText: '保存修改' }).click()
    await pgT.waitForTimeout(900)
    const body0 = taskPutBodies[0] || {}
    check('D10 合法保存: 恰 1 个 PUT 且 payload autoRefresh/refreshIntervalMin 正确',
      taskPutBodies.length === 1 && body0.autoRefresh === true && body0.refreshIntervalMin === 15,
      `putCount=${taskPutBodies.length} payload=${JSON.stringify({ autoRefresh: body0.autoRefresh, refreshIntervalMin: body0.refreshIntervalMin })}`)
    check('D11 保存后对话框关闭', (await pgT.locator('[role="dialog"]', { hasText: '编辑采集任务' }).count()) === 0)
    check('D12 任务段 0 pageerror/0 console error', statClean(stT), statErr(stT))
    await pgT.screenshot({ path: resolve(SHOT, 'task-dialog-chain.png') })
    await pgT.close()

    check('D13 全程写类请求零落库(安全网拦截数=0, PUT 均被 mock fulfill)', writeGuard.blocked === 0, `blocked=${writeGuard.blocked}`)
  } finally {
    await browserRef?.close()
  }

  console.log('\n==========')
  console.log(`PASS ${pass} / FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('脚本异常:', e); try { browserRef?.close() } catch { /* */ }; process.exit(1) })
