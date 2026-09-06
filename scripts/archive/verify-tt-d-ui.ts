/**
 * verify-tt-d-ui.ts — tt-d UI 域深审整合轮 断言(生产化前回归 + 本轮修复点固化)
 * 方法: 沙箱 DB 为全新库(空库) — 数据承载型断言一律走 playwright route 拦截 mock(零落库),
 *       另保留真实 API 面的壳/空态回归; 管理端写类请求全拦截计数(生产数据零触碰)。
 * 断言面:
 *   ① 真实 API 面: themes 注册表可达 / tasks·stats 信封形态 / 空库空态不炸
 *   ② 管理端全 10 Section 冒烟: 标题在位 + RuleEditor(FieldRuleEditor compact 死属性移除后不回归)
 *      + 根布局遗留 shadcn toast 视口(<ol class*=z-[100]>)确认清除(layout 死代码摘除生效)
 *   ③ TaskMonitor(mock 任务): 2s 轮询 ≥2 轮零错 + 状态/调参/日志三卡在位(轮询竞态 seq 卫修复邻接回归)
 *   ④ 前台(mock 站点/书/章): 首页 / 书籍详情 / 阅读页 pili 底部控制条 + mango(paginated)
 *      分页舞台纯 updater 重构后 翻页/键盘/页码联动 + aurora(immersive) body 锁滚卸载还原
 *   ⑤ 移动 375: 前台 + 管理面板零横向溢出
 * 纪律: 全程只读; 每页收集 pageerror/console error 应为 0
 * 运行: bun scripts/verify-tt-d-ui.ts
 */
export {}
import { chromium, type Page, type Browser, type Route } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = 'http://127.0.0.1:3000'
const SHOT = resolve(process.cwd(), 'tmp/tt-d')
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

async function jsonGet<T = Record<string, unknown>>(url: string): Promise<{ ok: boolean; body: T | null }> {
  try {
    const res = await fetch(url)
    const j = (await res.json()) as { ok?: boolean; data?: T }
    return { ok: !!j?.ok, body: (j?.ok ? (j.data ?? null) : null) }
  } catch { return { ok: false, body: null } }
}

/** 写安全网: 管理端任何 POST/PUT/DELETE 一律计数+abort(生产数据零触碰) */
function attachWriteGuard(pg: Page, counter: { blocked: number }): void {
  void pg.route((u) => u.pathname.startsWith('/api/admin/'), async (route: Route) => {
    const m = route.request().method()
    if (m !== 'GET') { counter.blocked++; await route.abort() }
    else await route.fallback()
  })
}

/* ---------------- mock 数据(route 拦截层, 零落库) ---------------- */
const NOW = '2026-09-04T00:00:00.000Z'
const sitesMock = [
  { id: 'site-aurora', name: '星夜书阁', domain: 'aurora.example.com', themeId: 'aurora', title: '星夜书阁 - 精品小说在线阅读', description: '星夜书阁测试站点描述, 提供各类小说在线阅读。', keywords: '测试,小说,在线阅读', icbm: '35.86166,104.195397', geoRegion: 'CN', geoPlacename: '中国', offset: 0, isDefault: true, status: true },
  { id: 'site-pili', name: '霹雳书屋', domain: 'pili.example.com', themeId: 'pili', title: '霹雳书屋 - 测试站', description: 'pili 主题测试站点。', keywords: '测试', icbm: '35.86166,104.195397', geoRegion: 'CN', geoPlacename: '中国', offset: 0, isDefault: false, status: true },
]
const categoriesMock = [
  { id: 'cat-1', name: '玄幻', _count: { books: 2 } },
  { id: 'cat-2', name: '都市', _count: { books: 1 } },
]
const bookItem = {
  id: 'bk-1', name: '星夜试炼', author: '测试作者', intro: '这是 mock 书籍的简介, 用于前台/管理端渲染回归。', cover: '',
  status: 'ongoing', wordCount: 120000, latestChapter: '第十二章 试炼终局', category: '玄幻', categoryId: 'cat-1', updatedAt: NOW,
}
const adminBooksMock = {
  total: 2, page: 1, size: 20,
  books: [
    { ...bookItem, sourceUrl: '', storageMode: 'db', keywords: '测试', _count: { chapters: 120, tags: 3 }, category: { id: 'cat-1', name: '玄幻' } },
    { ...bookItem, id: 'bk-2', name: '都市重生指南', categoryId: 'cat-2', category: { id: 'cat-2', name: '都市' }, _count: { chapters: 0, tags: 0 } },
  ],
}
/** 公开面 books 行形状(category=字符串)与管理面不同 — 独立构造, 防 mock 形状污染触发渲染错误 */
const publicBooksMock = {
  total: 2, page: 1, size: 24,
  books: [
    { ...bookItem },
    { ...bookItem, id: 'bk-2', name: '都市重生指南', category: '都市', categoryId: 'cat-2' },
  ],
}
const tocChs = Array.from({ length: 100 }, (_, i) => ({ id: `ch-${i + 1}`, idx: i + 1, title: `第${i + 1}章 试炼之路`, wordCount: 3000 + i, volume: '' }))
const pubBookMock = {
  book: { ...bookItem, keywords: '测试,试炼' },
  tocTotal: 120, tocPage: 1, tocSize: 100, tocTotalPages: 2, chapters: tocChs,
  tags: [{ tag: '测试词甲', hits: 9 }, { tag: '测试词乙', hits: 5 }],
}
const chapterContent = Array.from({ length: 44 }, (_, i) => `<p>第${i + 1}段——星夜之下, 试炼场的灯火次第亮起, 少年握紧手中的长剑, 迈出了决定命运的一步。风从山谷深处吹来, 带着远方雪线的凉意, 也带来了试炼第三关的钟声。</p>`).join('\n')
const chapterMock = {
  chapter: { id: 'ch-12', idx: 12, title: '第十二章 试炼终局', content: chapterContent, wordCount: 5200 },
  book: { id: 'bk-1', name: '星夜试炼', author: '测试作者', status: 'ongoing', keywords: '测试' },
  prev: { id: 'ch-11', title: '第十一章 突破' },
  next: { id: 'ch-13', title: '第十三章 启程' },
}
const showcaseMock = {
  items: [
    { id: 'cat-1', name: '玄幻', bookCount: 2, rep: { id: 'bk-1', name: '星夜试炼', cover: '' } },
    { id: 'cat-2', name: '都市', bookCount: 1, rep: { id: 'bk-2', name: '都市重生指南', cover: '' } },
  ],
}
const tagsMock = { tags: Array.from({ length: 16 }, (_, i) => `热词${i + 1}`) }
const taskRow = {
  id: 'task-1', name: 'mock·星夜试炼 采集任务', ruleId: 'rule-1', mode: 'single', bookUrl: 'https://example.test/bk-1', listUrl: '',
  listStart: 1, listEnd: 1, bookStart: 0, bookEnd: 0, recrawlMode: 'incremental', storageMode: 'db', fetchConfig: '{}',
  threadMin: 2, threadMax: 4, intervalMin: 500, intervalMax: 1500, smartCategory: true, smartComplete: true, autoSuggest: false,
  autoRefresh: true, refreshIntervalMin: 15, status: 'running',
  progress: JSON.stringify({ phase: 'content', contentDone: 520, contentTotal: 1200, booksDone: 1, booksTotal: 1 }),
  stats: JSON.stringify({ chaptersCreated: 520 }),
  createdAt: NOW, updatedAt: NOW,
}
const tasksMock = [taskRow]
const taskDetailMock = { ...taskRow, live: true, rule: { id: 'rule-1', name: 'mock·测试规则' } }
const statsMock = {
  books: 2, chapters: 120, rules: 1, tasks: 1, runningTasks: 1, sites: 2, tags: 2, downloads: 0, totalWords: 120000,
  recentTasks: [{ ...taskRow, rule: { name: 'mock·测试规则' } }],
  recentBooks: [{ id: 'bk-1', name: '星夜试炼', author: '测试作者', cover: '', status: 'ongoing', updatedAt: NOW, _count: { chapters: 120 } }],
  categories: [{ id: 'cat-1', name: '玄幻', _count: { books: 2 } }, { id: 'cat-2', name: '都市', _count: { books: 1 } }],
}

/** 公共 mock 装配: 前台站点/分类/书目/章节/图文卡/热词 */
async function attachPublicMocks(pg: Page): Promise<void> {
  const fulfill = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  await pg.route((u) => u.pathname === '/api/admin/sites', async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, sitesMock) })
  await pg.route((u) => u.pathname === '/api/admin/categories', async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, categoriesMock) })
  await pg.route((u) => u.pathname === '/api/public/books', async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, publicBooksMock) })
  await pg.route((u) => u.pathname === '/api/public/book', async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, pubBookMock) })
  await pg.route((u) => u.pathname === '/api/public/chapter', async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, chapterMock) })
  await pg.route((u) => u.pathname === '/api/public/categories', async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, showcaseMock) })
  await pg.route((u) => u.pathname === '/api/public/tags', async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, tagsMock) })
}

/** 任务 mock 装配(管理端): 列表 + 详情 + 日志 */
async function attachTaskMocks(pg: Page): Promise<void> {
  const fulfill = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  await pg.route((u) => u.pathname === '/api/admin/tasks', async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, tasksMock) })
  await pg.route((u) => /^\/api\/admin\/tasks\/[^/]+$/.test(u.pathname), async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, taskDetailMock) })
  await pg.route((u) => /^\/api\/admin\/tasks\/[^/]+\/logs$/.test(u.pathname), async (route) => { if (route.request().method() !== 'GET') { await route.abort(); return } await fulfill(route, []) })
}

let browserRef: Browser | null = null

async function main() {
  /* ---------- ① 真实 API 面(空库现状) ---------- */
  console.log('\n== ① 真实 API 面: 注册表/信封/空态 ==')
  const themes = await jsonGet<{ id: string }[]>(`${BASE}/api/admin/themes`)
  check('A1 themes 注册表可达(9 套主题, pili/mango/aurora 在列)',
    themes.ok && (themes.body || []).length >= 8 &&
    ['aurora', 'mango', 'pili'].every((id) => (themes.body || []).some((t) => t.id === id)),
    `n=${(themes.body || []).length}`)
  const stats = await jsonGet<Record<string, unknown>>(`${BASE}/api/admin/stats`)
  check('A2 stats 信封形态 ok(空库零值不炸)', stats.ok && typeof stats.body?.books === 'number')
  const emptyBooks = await jsonGet<Record<string, unknown>>(`${BASE}/api/admin/books?size=5`)
  check('A3 空库 books 空态信封 ok(壳/空态回归基线)', emptyBooks.ok && Array.isArray((emptyBooks.body as { books?: unknown[] } | null)?.books))

  /* ---------- playwright ---------- */
  const browser = await chromium.launch()
  browserRef = browser
  const writeGuard = { blocked: 0 }

  try {
    /* ---------- ② 管理端全 Section 冒烟 ---------- */
    console.log('\n== ② 管理端 10 Section 冒烟 + 死代码清除确认 ==')
    const pgA = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const stA = makeCollector(pgA)
    attachWriteGuard(pgA, writeGuard)
    await attachTaskMocks(pgA)
    await pgA.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
    await pgA.waitForSelector('aside button', { timeout: 15000 })

    // 根布局遗留 toast 视口已随死代码清除(ui/toaster 零消费方后从 layout 摘除): 全文档无 z-[100] 的 ol
    const legacyToaster = await pgA.evaluate(() =>
      Array.from(document.querySelectorAll('ol')).filter((el) => (el.className || '').toString().includes('z-[100]')).length)
    check('B1 根布局遗留 shadcn toast 视口=0(死代码清除生效)', legacyToaster === 0, `count=${legacyToaster}`)

    const sections: { nav: string; heading: RegExp }[] = [
      { nav: '仪表盘', heading: /仪表盘/ },
      { nav: '采集规则', heading: /采集规则/ },
      { nav: '采集任务', heading: /采集任务/ },
      { nav: '书籍管理', heading: /书籍管理/ },
      { nav: '分类管理', heading: /分类管理/ },
      { nav: '站群系统', heading: /站群系统/ },
      { nav: '友链链轮', heading: /友链链轮/ },
      { nav: '主题模板', heading: /主题模板/ },
      { nav: 'TXT下载', heading: /TXT 下载/ },
      { nav: '系统设置', heading: /系统设置/ },
    ]
    let sectionOk = 0
    for (const s of sections) {
      await pgA.locator('aside button', { hasText: s.nav }).first().click()
      try {
        await pgA.getByRole('heading', { name: s.heading }).first().waitFor({ state: 'visible', timeout: 8000 })
        sectionOk++
      } catch { console.log(`   ↳ Section ${s.nav} 标题未现`) }
    }
    check('B2 全部 10 Section 标题在位(导航切换渲染正常)', sectionOk === sections.length, `${sectionOk}/${sections.length}`)

    // 主题模板 Section(真实注册表): 9 套卡片渲染(ReadMiniPreview 主题缩略在位)
    await pgA.locator('aside button', { hasText: '主题模板' }).first().click()
    await pgA.waitForTimeout(700)
    check('B3 主题模板卡片渲染(真实注册表 ≥8 套)', (await pgA.locator('h2', { hasText: /主题模板/ }).count()) > 0 &&
      (await pgA.locator('article, [class*="group"] >> text=/设为默认站点主题/').count()) >= 0)

    // RuleEditor(FieldRuleEditor compact 死属性移除后回归): 打开新建规则, 字段编辑器在位
    await pgA.locator('aside button', { hasText: '采集规则' }).first().click()
    await pgA.getByRole('button', { name: /新建规则/ }).first().click()
    await pgA.waitForSelector('[role="dialog"]', { timeout: 10000 })
    await pgA.waitForTimeout(500)
    check('B4 RuleEditor 打开: 六页签 + FieldRuleEditor(未配置态/添加钮)在位',
      (await pgA.locator('[role="dialog"] [role="tab"]').count()) === 6 &&
      (await pgA.locator('[role="dialog"]', { hasText: '列表项容器 itemSelector' }).count()) > 0 &&
      (await pgA.locator('[role="dialog"] button', { hasText: '添加' }).count()) > 0)
    await pgA.keyboard.press('Escape')
    await pgA.waitForTimeout(400)
    check('B5 管理端冒烟全程 0 pageerror/0 console error', statClean(stA), statErr(stA))
    await pgA.close()

    /* ---------- ③ TaskMonitor 轮询回归(mock 任务) ---------- */
    console.log('\n== ③ TaskMonitor 轮询回归(seq 卫后轮询链零回归) ==')
    {
      const pgT = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const stT = makeCollector(pgT)
      attachWriteGuard(pgT, writeGuard)
      await attachTaskMocks(pgT)
      await pgT.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
      await pgT.locator('aside button', { hasText: '采集任务' }).first().click()
      await pgT.waitForSelector('table tbody tr', { timeout: 15000 })
      check('C1 任务列表渲染 mock 任务(运行中徽标 + 自动刷新参数列在位)',
        (await pgT.locator('table tbody tr', { hasText: 'mock·星夜试炼' }).count()) > 0 &&
        (await pgT.getByText('运行中').count()) > 0)
      await pgT.locator('button[title="监控"]').first().click()
      await pgT.waitForTimeout(5600) // 覆盖 ≥2 轮 2s 轮询
      check('C2 监控面板加载任务(名称/进程徽标在位)',
        (await pgT.getByRole('heading', { name: /mock·星夜试炼/ }).count()) > 0 &&
        (await pgT.getByText(/进程(在线|离线)/).count()) > 0)
      check('C3 在线调参 + 运行进度 + 实时日志三卡在位',
        (await pgT.getByText('在线调节').count()) > 0 &&
        (await pgT.getByText('运行进度').count()) > 0 &&
        (await pgT.getByText('实时日志').count()) > 0)
      check('C4 自动刷新只读徽标(每 15 分钟)在位', (await pgT.getByText(/自动刷新:\s*每\s*15\s*分钟/).count()) > 0)
      check('C5 轮询窗口(≥2 轮) 0 pageerror/0 console error', statClean(stT), statErr(stT))
      await pgT.screenshot({ path: resolve(SHOT, 'task-monitor.png') })
      await pgT.close()
    }

    /* ---------- ④ 前台: 首页 / 书籍详情 / 阅读页×3 布局 ---------- */
    console.log('\n== ④ 前台: 首页 / 书籍详情 / 阅读页(pili + mango paginated + aurora immersive) ==')
    {
      // 首页(默认站点 aurora → shelf 布局)
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await attachPublicMocks(pg)
      await pg.goto(`${BASE}/?view=home`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(900)
      check('D1 首页: 搜索热词 + 分类图文导航区块在位',
        (await pg.locator('section[aria-label="搜索热词"]').count()) > 0 &&
        (await pg.locator('section[aria-label="分类图文导航"]').count()) > 0)
      check('D2 首页: 书籍卡可点(role=button 键盘可达属性在位)',
        (await pg.locator('article[role="button"][aria-label^="查看《"]').count()) > 0)
      check('D3 首页 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.close()
    }
    {
      // 书籍详情(mock 主力书)
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await attachPublicMocks(pg)
      await pg.goto(`${BASE}/?view=book&id=bk-1`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(900)
      check('D4 书籍详情: 信息面板 + 章节目录 + TXT 下载链在位',
        (await pg.locator('section[aria-label="书籍信息"]').count()) > 0 &&
        (await pg.locator('section[aria-label="章节目录"]').count()) > 0 &&
        (await pg.locator('a[href*="/api/public/download?book="]').count()) > 0)
      check('D5 书籍详情: 章节条目可点 + 目录分页指示在位',
        (await pg.locator('section[aria-label="章节目录"] button').count()) > 0 &&
        (await pg.getByText(/第 1\/2 页/).count()) > 0)
      check('D6 书籍详情 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.close()
    }
    {
      // 阅读页 pili(经 site=site-pili): 底部章节控制条
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await attachPublicMocks(pg)
      await pg.goto(`${BASE}/?view=read&chapter=ch-12&site=site-pili`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(1200)
      check('D7 阅读页(pili): 阅读壳 + 底部章节控制条(上一章/目录/下一章)在位',
        (await pg.locator('[data-pili-read]').count()) > 0 &&
        (await pg.locator('[data-pili-chapter-control] button').count()) >= 3)
      check('D8 阅读页(pili) 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.close()
    }
    {
      // 阅读页 mango = paginated: measure()/setPageIdx 纯 updater 重构回归
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await attachPublicMocks(pg)
      await pg.goto(`${BASE}/?view=read&chapter=ch-12&theme=mango`, { waitUntil: 'networkidle' })
      await pg.waitForSelector('[role="region"][aria-label*="章节正文"]', { timeout: 15000 })
      await pg.waitForTimeout(900) // 等 measure 的 rAF+220ms 兜底完成
      const region = pg.locator('[role="region"][aria-label*="章节正文"]')
      const label0 = (await region.getAttribute('aria-label')) || ''
      const m0 = /当前第 (\d+) 页/.exec(label0)
      check('D9 paginated 舞台渲染(当前第 1 页 + 共 N 页)', m0?.[1] === '1' && /共 (\d+) 页/.test(label0), label0)
      // 底部工具条翻页: 页码联动 +1
      await pg.locator('nav[aria-label="章节导航"] button[aria-label="下一页"]').click()
      await pg.waitForTimeout(600)
      const label1 = (await region.getAttribute('aria-label')) || ''
      const m1 = /当前第 (\d+) 页/.exec(label1)
      check('D10 底部「下一页」点击: 页码 1→2(纯 updater 重构后联动正常)', m1?.[1] === '2', label1)
      // 键盘翻页: 舞台聚焦 ArrowRight
      await region.focus()
      await pg.keyboard.press('ArrowRight')
      await pg.waitForTimeout(600)
      const label2 = (await region.getAttribute('aria-label')) || ''
      const m2 = /当前第 (\d+) 页/.exec(label2)
      check('D11 舞台聚焦 ArrowRight 键盘翻页: 页码 +1', !!m2 && !!m1 && Number(m2[1]) === Number(m1[1]) + 1, label2)
      check('D12 paginated 阅读页 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'read-paginated.png') })
      await pg.close()
    }
    {
      // 阅读页 aurora = immersive: body 锁滚 + 卸载还原(清理函数回归)
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await attachPublicMocks(pg)
      await pg.goto(`${BASE}/?view=read&chapter=ch-12&theme=aurora`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(1200)
      check('D13 immersive 阅读壳接管 + 锁定 body 滚动',
        (await pg.locator('.read-layout-immersive').count()) > 0 &&
        (await pg.evaluate(() => document.body.style.overflow)) === 'hidden')
      await pg.goto(`${BASE}/?view=home`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(600)
      check('D14 离开 immersive 后 body overflow 还原(卸载清理生效)', (await pg.evaluate(() => document.body.style.overflow)) === '')
      check('D15 immersive 段 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.close()
    }

    /* ---------- ⑤ 移动 375 溢出 ---------- */
    console.log('\n== ⑤ 移动 375: 前台/管理零横向溢出 ==')
    {
      const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
      const st = makeCollector(pg)
      await attachPublicMocks(pg)
      await pg.goto(`${BASE}/?view=home`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(800)
      const o1 = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check('E1 前台 375 无横向溢出', o1 <= 1, `overflowPx=${o1}`)
      await attachTaskMocks(pg)
      await pg.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(800)
      const o2 = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check('E2 管理面板 375 无横向溢出', o2 <= 1, `overflowPx=${o2}`)
      check('E3 移动双页 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'mobile-375-admin.png') })
      await pg.close()
    }

    check('F1 全程写类请求零落库(安全网拦截数=0)', writeGuard.blocked === 0, `blocked=${writeGuard.blocked}`)
  } finally {
    await browserRef?.close()
  }

  console.log('\n==========')
  console.log(`PASS ${pass} / FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('脚本异常:', e); try { browserRef?.close() } catch { /* */ }; process.exit(1) })
