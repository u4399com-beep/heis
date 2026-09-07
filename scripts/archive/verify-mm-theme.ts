/**
 * verify-mm-theme.ts — mm 轮「霹雳书屋 pili 主题」端到端验证
 * 断言面:
 *   ① /api/admin/themes 注册表含 pili 且字段齐(id/name/layout/read/vars/preview)
 *   ② /?view=home&theme=pili 渲染: 0 pageerror/0 console error + pili 特征
 *      (白底报头/奶油分类条/橙色区块标题/封面网格/最近更新表格/橙头排行榜/主橙 computed style)
 *   ③ 书籍视图 pili 分支: 详情头(封面角标/标题作者/标签chips/橙色按钮/统计行) + 橙 tab + 四列章节网格
 *      + 分卷对称断言(有卷→卷头渲染, 无卷→零卷头)
 *   ④ 阅读页 pili 分支: 顶部 read-header 条 + 正文大栏 + 底部 chapter-control(上一章/目录/下一章)
 *      + 目录抽屉开合 + 夜间切换
 *   ⑤ 移动端 375px: 首页/书籍/阅读 三视图无水平溢出
 *   ⑥ 管理端 ThemesSection: pili 卡片自动出现 + 书屋版 ReadMiniPreview 素描 + 截图
 * 纪律: 全程只读(写类请求 playwright 拦截计数=0); 书/章数据运行时动态发现, 不硬编码书名
 * 运行: bun scripts/verify-mm-theme.ts
 */
export {}
import { chromium, type Page, type Browser, type Route } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = 'http://127.0.0.1:3000'
const SHOT = resolve(process.cwd(), 'tmp/mm/verify')
mkdirSync(SHOT, { recursive: true })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = ''): void {
  if (ok) { pass++; console.log(`✅ ${name}${extra ? ` | ${extra}` : ''}`) }
  else { fail++; console.log(`❌ ${name}${extra ? ` | ${extra}` : ''}`) }
}

interface Stat { pe: number; ce: number; msgs: string[]; bad: string[] }
function makeCollector(pg: Page): Stat {
  const s: Stat = { pe: 0, ce: 0, msgs: [], bad: [] }
  pg.on('pageerror', (e) => { s.pe++; s.msgs.push(`pageerror: ${String(e).slice(0, 140)}`) })
  pg.on('console', (m) => {
    if (m.type() !== 'error') return
    // 资源加载 404(缺封面文件等运行时数据态)单独归档到 s.bad, 不计入页面逻辑 console error;
    // 后续断言会额外核查全部 4xx 均为封面请求(数据态)而非页面/接口逻辑缺陷
    if (m.text().startsWith('Failed to load resource')) return
    s.ce++; s.msgs.push(`console: ${m.text().slice(0, 140)}`)
  })
  pg.on('response', (r) => { if (r.status() >= 400) s.bad.push(`${r.status()} ${r.url()}`) })
  return s
}
const statClean = (s: Stat) => s.pe === 0 && s.ce === 0 && s.bad.every((u) => u.includes('/api/public/cover'))
const statErr = (s: Stat) => (s.msgs.length ? s.msgs.slice(0, 2).join(' ; ') : s.bad.length ? s.bad.slice(0, 2).join(' ; ') : '-')

async function jsonGet<T = Record<string, unknown>>(url: string): Promise<{ status: number; body: T | null; ok: boolean; message?: string }> {
  try {
    const res = await fetch(url)
    const j = (await res.json()) as { ok?: boolean; data?: T; message?: string }
    return { status: res.status, body: (j?.ok ? (j.data ?? null) : null), ok: !!j?.ok, message: j?.message }
  } catch { return { status: 0, body: null, ok: false } }
}

/** 写安全网: 管理端任何 POST/PUT/DELETE 一律计数+abort(兜底防误触写库) */
function attachWriteGuard(pg: Page, counter: { blocked: number }): void {
  void pg.route((u) => u.pathname.startsWith('/api/admin/'), async (route: Route) => {
    const m = route.request().method()
    if (m !== 'GET') { counter.blocked++; await route.abort() }
    else await route.fallback()
  })
}

interface ThemeApiRow {
  id: string
  name: string
  desc: string
  layout: string
  dark: boolean
  read?: { layout?: string; measure?: number; lineHeight?: number; fontBase?: number; indent?: boolean; toolbar?: string; texture?: string; chapterDeco?: string }
  vars?: Record<string, unknown>
  preview?: string[]
}

let browserRef: Browser | null = null

async function main() {
  /* ---------- ① 注册表 API ---------- */
  console.log('\n== ① /api/admin/themes 含 pili 且字段齐 ==')
  const themesRes = await jsonGet<ThemeApiRow[]>(`${BASE}/api/admin/themes`)
  const themes = Array.isArray(themesRes.body) ? themesRes.body : []
  const pili = themes.find((t) => t.id === 'pili')
  check('A1 themes API 可用且 pili 在注册表', themesRes.ok && !!pili, `total=${themes.length}`)
  if (!pili) process.exit(1)
  check('A2 pili 基础字段: name 霹雳书屋 / layout pili / dark=false',
    pili.name === '霹雳书屋' && pili.layout === 'pili' && pili.dark === false,
    `name=${pili.name} layout=${pili.layout} dark=${pili.dark}`)
  check('A3 pili 阅读配置: layout=pili/measure=680/lineHeight=1.9/fontBase=18/indent/toolbar=bottom/texture=none/chapterDeco=rule',
    pili.read?.layout === 'pili' && pili.read?.measure === 680 && pili.read?.lineHeight === 1.9 &&
    pili.read?.fontBase === 18 && pili.read?.indent === true && pili.read?.toolbar === 'bottom' &&
    pili.read?.texture === 'none' && pili.read?.chapterDeco === 'rule',
    JSON.stringify(pili.read))
  const vv = (pili.vars || {}) as Record<string, string>
  check('A4 pili vars: headerStyle=pili + 提炼配色(主橙/点缀红/白面/棕系文字)',
    vv.headerStyle === 'pili' && vv.primary === '#fd8929' && vv.accent === '#d71704' &&
    vv.surface === '#ffffff' && vv.text === '#333333' && vv.textMuted === '#999999' && vv.bg === '#f0efee',
    `headerStyle=${vv.headerStyle} primary=${vv.primary} accent=${vv.accent}`)
  check('A5 pili preview 三色 = #ffffff/#fd8929/#d71704',
    Array.isArray(pili.preview) && pili.preview.join(',') === '#ffffff,#fd8929,#d71704',
    (pili.preview || []).join(','))
  check('A6 注册表其余 8 套主题零回归(总数=9 且无重复 id)',
    themes.length === 9 && new Set(themes.map((t) => t.id)).size === themes.length, `total=${themes.length}`)

  /* ---------- playwright ---------- */
  const browser = await chromium.launch()
  browserRef = browser
  const writeGuard = { blocked: 0 }

  try {
    /* ---------- ② 首页 pili 布局 ---------- */
    console.log('\n== ② /?view=home&theme=pili 布局与配色 ==')
    const pgHome = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const stHome = makeCollector(pgHome)
    attachWriteGuard(pgHome, writeGuard)
    await pgHome.goto(`${BASE}/?view=home&theme=pili`, { waitUntil: 'networkidle' })
    await pgHome.waitForSelector('[data-pili-home]', { timeout: 20000 })
    await pgHome.waitForTimeout(1200)

    check('B1 pili 布局根节点渲染', (await pgHome.locator('[data-pili-home]').count()) === 1)
    check('B2 白底报头 + 奶油分类导航条', (await pgHome.locator('[data-pili-header]').count()) === 1 && (await pgHome.locator('[data-pili-nav]').count()) === 1)
    check('B3 pili 特征区块: 封面网格/最近更新表格/橙头排行榜',
      (await pgHome.locator('[data-pili-section]').count()) >= 2 &&
      (await pgHome.locator('[data-pili-table]').count()) === 1 &&
      (await pgHome.locator('[data-pili-rank]').count()) === 1)
    const coverCards = await pgHome.locator('[data-pili-home] article').count()
    check('B4 封面网格有书卡(精品推荐/最新入库)', coverCards >= 5, `cards=${coverCards}`)
    const rankRows = await pgHome.locator('[data-pili-rank] ol li').count()
    check('B5 排行榜条目在位', rankRows > 0, `rows=${rankRows}`)
    // 主橙 computed style: 排行榜渐变橙头 + 奶油分类条
    const rankHeadBg = await pgHome.evaluate(() => {
      const el = document.querySelector('[data-pili-rank] header')
      return el ? getComputedStyle(el).backgroundImage + '|' + getComputedStyle(el).backgroundColor : ''
    })
    check('B6 排行榜头部主橙渐变(#fd8929 → computed rgb(253,137,41))', rankHeadBg.includes('253, 137, 41'), rankHeadBg.slice(0, 120))
    const navBg = await pgHome.evaluate(() => {
      const el = document.querySelector('[data-pili-nav]')
      return el ? getComputedStyle(el).backgroundImage : ''
    })
    check('B7 分类条奶油渐变(#fff5e5 → computed rgb(255,245,229))', navBg.includes('255, 245, 229'), navBg.slice(0, 120))
    const bodyBg = await pgHome.evaluate(() => getComputedStyle(document.body).backgroundColor)
    void bodyBg // 页面底色由 wrapper div 承载, body 不强断言
    const bgOf = await pgHome.evaluate(() => {
      const el = document.querySelector('[data-pili-home]')?.closest('div')
      let cur: HTMLElement | null = el as HTMLElement | null
      while (cur) {
        const bg = getComputedStyle(cur).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)') return bg
        cur = cur.parentElement
      }
      return ''
    })
    check('B8 页面底色暖灰(#f0efee → computed rgb(240,239,238))', bgOf === 'rgb(240, 239, 238)', bgOf)
    check('B9 首页 0 pageerror/0 console error', statClean(stHome), statErr(stHome))
    await pgHome.screenshot({ path: resolve(SHOT, 'pili-home.png'), fullPage: true })
    await pgHome.close()

    /* ---------- ③ 书籍视图 pili 分支 ---------- */
    console.log('\n== ③ /?view=book&theme=pili 详情头+章节网格 ==')
    const booksRes = await jsonGet<{ total: number; books: { id: string; name: string; _count?: { chapters: number } }[] }>(`${BASE}/api/admin/books?size=50`)
    const books = booksRes.body?.books || []
    const target = [...books].sort((a, b) => (b._count?.chapters || 0) - (a._count?.chapters || 0))[0]
    check('C0 库内有书(动态发现目标书)', !!target, target ? `${target.name} chapters=${target._count?.chapters}` : 'none')
    if (!target) process.exit(1)
    const pub = await jsonGet<{ tocTotal: number; chapters: { id: string; idx: number; title: string; volume?: string }[] }>(
      `${BASE}/api/public/book?id=${target.id}&tocPage=1&tocSize=100`)
    const ch0 = pub.body?.chapters?.[0]
    const hasVolume = (pub.body?.chapters || []).some((c) => !!c.volume)
    check('C1 目标书目录可读 + 首章可定位', pub.ok && !!ch0, `tocTotal=${pub.body?.tocTotal} ch0=${ch0?.title?.slice(0, 12)}`)

    const pgBook = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const stBook = makeCollector(pgBook)
    attachWriteGuard(pgBook, writeGuard)
    await pgBook.goto(`${BASE}/?view=book&id=${target.id}&theme=pili`, { waitUntil: 'networkidle' })
    await pgBook.waitForSelector('[data-pili-book]', { timeout: 20000 })
    await pgBook.waitForTimeout(900)
    check('C2 pili 详情头渲染', (await pgBook.locator('[data-pili-book]').count()) === 1)
    const headTxt = (await pgBook.locator('[data-pili-book] h1').innerText()).replace(/\s+/g, '')
    check('C3 标题「书名（作者：X）」结构', headTxt.includes(target.name) && headTxt.includes('作者：'), headTxt.slice(0, 40))
    check('C4 橙色大按钮: 开始阅读/章节目录',
      (await pgBook.locator('[data-pili-book] button[aria-label="开始阅读"]').count()) === 1 &&
      (await pgBook.locator('[data-pili-book] button[aria-label="查看完整章节目录"]').count()) === 1)
    const statsTxt = (await pgBook.locator('[data-pili-book]').innerText()).replace(/\s+/g, '')
    check('C5 统计行(分类/字数/状态/最新)', statsTxt.includes('字数：') && statsTxt.includes('状态：') && statsTxt.includes('最新：'))
    check('C6 橙 tab「查看完整章节目录」', (await pgBook.locator('[data-pili-toc-tab]').count()) === 1 &&
      (await pgBook.locator('[data-pili-toc-tab]').innerText()).includes('查看完整章节目录'))
    const gridBtns = await pgBook.locator('[data-pili-toc] button').count()
    check('C7 四列章节网格有章节项', gridBtns > 0, `items=${gridBtns}`)
    // 分卷对称断言(动态): 有卷→卷头渲染; 无卷→零卷头
    const volHeads = await pgBook.locator('[data-vol-head]').count()
    check('C8 分卷对称断言', hasVolume ? volHeads > 0 : volHeads === 0, `hasVolume=${hasVolume} volHeads=${volHeads}`)
    check('C9 书籍页 0 pageerror/0 console error', statClean(stBook), statErr(stBook))
    await pgBook.screenshot({ path: resolve(SHOT, 'pili-book.png'), fullPage: false })
    await pgBook.close()

    /* ---------- ④ 阅读页 pili 分支 ---------- */
    console.log('\n== ④ /?view=read&theme=pili 书屋版阅读 ==')
    const pgRead = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const stRead = makeCollector(pgRead)
    attachWriteGuard(pgRead, writeGuard)
    await pgRead.goto(`${BASE}/?view=read&chapter=${ch0!.id}&theme=pili`, { waitUntil: 'networkidle' })
    await pgRead.waitForSelector('[data-pili-read]', { timeout: 20000 })
    await pgRead.waitForTimeout(1000)
    check('D1 阅读根节点 + 顶部 read-header 条', (await pgRead.locator('[data-pili-read]').count()) === 1 && (await pgRead.locator('[data-pili-read-header]').count()) === 1)
    check('D2 底部 chapter-control 三键(上一章/目录/下一章)',
      (await pgRead.locator('[data-pili-chapter-control]').count()) === 1 &&
      (await pgRead.locator('[data-pili-chapter-control] button[aria-label="上一章"]').count()) === 1 &&
      (await pgRead.locator('[data-pili-chapter-control] button[aria-label="打开章节目录"]').count()) === 1 &&
      (await pgRead.locator('[data-pili-chapter-control] button[aria-label="下一章"]').count()) === 1)
    const nextBg = await pgRead.evaluate(() => {
      const el = document.querySelector('[data-pili-chapter-control] button[aria-label="下一章"]')
      return el ? getComputedStyle(el).backgroundColor : ''
    })
    check('D3 下一章主按钮主橙底色', nextBg === 'rgb(253, 137, 41)', nextBg)
    const paras = await pgRead.locator('[data-pili-content] p').count()
    check('D4 正文段落渲染(段首缩进由 indent:true 控制)', paras > 0, `paras=${paras}`)
    const paraIndent = paras > 0 ? await pgRead.evaluate(() => {
      const p = document.querySelector('[data-pili-content] p')
      return p ? getComputedStyle(p).textIndent : ''
    }) : ''
    check('D5 段首缩进生效(text-indent≥16px)', parseFloat(paraIndent) >= 16, `indent=${paraIndent}`)
    // 目录抽屉开合
    await pgRead.locator('[data-pili-chapter-control] button[aria-label="打开章节目录"]').click()
    await pgRead.waitForSelector('[role="dialog"][aria-label="章节目录"]', { timeout: 10000 })
    check('D6 目录抽屉打开', (await pgRead.locator('[role="dialog"][aria-label="章节目录"]').count()) === 1)
    await pgRead.keyboard.press('Escape')
    await pgRead.waitForTimeout(400)
    check('D7 Escape 关闭抽屉', (await pgRead.locator('[role="dialog"][aria-label="章节目录"]').count()) === 0)
    // 夜间切换
    const nightBtn = pgRead.locator('[data-pili-read-header] button[aria-label="切换夜间模式"]')
    await nightBtn.click()
    await pgRead.waitForTimeout(500)
    const nightBg = await pgRead.evaluate(() => {
      const el = document.querySelector('[data-pili-read]')
      return el ? getComputedStyle(el).backgroundColor : ''
    })
    check('D8 夜间模式画布切换(→#15171c)', nightBg === 'rgb(21, 23, 28)', nightBg)
    // 切回日间(夜间后按钮 aria-label 变为「切换日间模式」)
    await pgRead.locator('[data-pili-read-header] button[aria-label="切换日间模式"]').click()
    await pgRead.waitForTimeout(500)
    const dayBg = await pgRead.evaluate(() => {
      const el = document.querySelector('[data-pili-read]')
      return el ? getComputedStyle(el).backgroundColor : ''
    })
    check('D9 切回日间画布还原(#ede7da)', dayBg === 'rgb(237, 231, 218)', dayBg)
    check('D10 阅读页 0 pageerror/0 console error(4xx 均为封面数据态)', statClean(stRead), statErr(stRead))
    await pgRead.screenshot({ path: resolve(SHOT, 'pili-read.png'), fullPage: false })
    await pgRead.close()

    /* ---------- ⑤ 移动端 375 无水平溢出 ---------- */
    console.log('\n== ⑤ 移动端 375px 无水平溢出 ==')
    const pgM = await browser.newPage({ viewport: { width: 375, height: 812 } })
    const stM = makeCollector(pgM)
    attachWriteGuard(pgM, writeGuard)
    await pgM.goto(`${BASE}/?view=home&theme=pili`, { waitUntil: 'networkidle' })
    await pgM.waitForSelector('[data-pili-home]', { timeout: 20000 })
    await pgM.waitForTimeout(1000)
    const ovHome = await pgM.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('E1 首页 375 无水平溢出', ovHome <= 1, `overflowPx=${ovHome}`)
    await pgM.goto(`${BASE}/?view=book&id=${target.id}&theme=pili`, { waitUntil: 'networkidle' })
    await pgM.waitForSelector('[data-pili-book]', { timeout: 20000 })
    await pgM.waitForTimeout(900)
    const ovBook = await pgM.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('E2 书籍页 375 无水平溢出', ovBook <= 1, `overflowPx=${ovBook}`)
    await pgM.goto(`${BASE}/?view=read&chapter=${ch0!.id}&theme=pili`, { waitUntil: 'networkidle' })
    await pgM.waitForSelector('[data-pili-read]', { timeout: 20000 })
    await pgM.waitForTimeout(900)
    const ovRead = await pgM.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('E3 阅读页 375 无水平溢出', ovRead <= 1, `overflowPx=${ovRead}`)
    check('E4 移动端 0 pageerror/0 console error', statClean(stM), statErr(stM))
    await pgM.goto(`${BASE}/?view=home&theme=pili`, { waitUntil: 'networkidle' })
    await pgM.waitForTimeout(1000)
    await pgM.screenshot({ path: resolve(SHOT, 'pili-home-mobile.png'), fullPage: false })
    await pgM.close()

    /* ---------- ⑥ 管理端主题卡片 ---------- */
    console.log('\n== ⑥ 管理端 ThemesSection pili 卡片 ==')
    const pgAdm = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const stAdm = makeCollector(pgAdm)
    attachWriteGuard(pgAdm, writeGuard)
    await pgAdm.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
    await pgAdm.locator('aside button', { hasText: '主题模板' }).click()
    await pgAdm.waitForTimeout(1500)
    const piliCard = pgAdm.locator('div', { has: pgAdm.locator('span.font-medium', { hasText: '霹雳书屋' }) }).last()
    check('F1 主题卡片自动出现(霹雳书屋)', (await pgAdm.getByText('霹雳书屋', { exact: true }).count()) >= 1)
    const cardBadge = pgAdm.locator('span', { hasText: '阅读·书屋版' }).first()
    check('F2 pili 卡片带「阅读·书屋版」徽标', (await cardBadge.count()) >= 1)
    check('F3 pili 卡片布局徽标 pili', (await pgAdm.locator('span', { hasText: /^pili$/ }).count()) >= 1)
    check('F4 管理端 0 pageerror/0 console error', statClean(stAdm), statErr(stAdm))
    await pgAdm.screenshot({ path: resolve(SHOT, 'admin-themes-pili.png'), fullPage: false })
    await pgAdm.close()

    check('G1 全程写类请求零落库(安全网拦截数=0)', writeGuard.blocked === 0, `blocked=${writeGuard.blocked}`)
  } finally {
    await browserRef?.close()
  }

  console.log('\n==========')
  console.log(`PASS ${pass} / FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('脚本异常:', e); try { browserRef?.close() } catch { /* */ }; process.exit(1) })
