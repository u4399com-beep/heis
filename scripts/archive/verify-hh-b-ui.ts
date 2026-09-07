// ============================================================
// Task hh-b 验证脚本 — 主题预览深链/覆盖/还原 + ReadMiniPreview 主题着色 (playwright, 只读不改库)
// 1. themes API: 8 主题全量返回且 read.layout 字段在位(与注册表顺序对齐)
// 2. 后台主题区块: 8 张卡片 ReadMiniPreview 缩略图存在, 且内联 style 含对应主题 preview 三色着色
// 3. 逐主题点击卡片"预览前台"(8 主题): URL 含 theme=<id> + 前台根容器背景 == 该主题 vars.bg
//    (期望值读自 src/lib/crawl/themes.ts THEMES 注册表) + "预览主题"指示胶囊在位
// 4. 覆盖语义(实现口径): 站内导航保持预览(URL 无 theme, 背景仍为预览主题, 胶囊仍在);
//    切换站点即还原(胶囊消失, 背景回归目标站点自身主题)
// 5. 移动端 375×812 预览态无横向溢出; 全程 0 pageerror / 0 console error
// 运行: bun scripts/verify-hh-b-ui.ts
// ============================================================
export {}
import { chromium, type Page, type Browser } from 'playwright'
import { mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { THEMES } from '../src/lib/crawl/themes'

const BASE = 'http://localhost:3000'
const SHOT = resolve(process.cwd(), 'tmp/hh-b')
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

/** CSS 颜色/背景值归一化: hex→rgb、rgba(→rgb(、去空白 (供内联 style / computed style / 注册表三方比对) */
function normCss(s: string): string {
  let out = (s || '').toLowerCase()
  out = out.replace(/#([0-9a-f]{6})\b/g, (_m, h: string) => {
    const n = parseInt(h, 16)
    return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`
  })
  out = out.replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/g, (_m, a: string, b: string, c: string) => `rgb(${parseInt(a + a, 16)},${parseInt(b + b, 16)},${parseInt(c + c, 16)})`)
  out = out.replace(/rgba\(/g, 'rgb(')
  return out.replace(/\s+/g, '')
}

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
  /* ---------- 0. 准备: 站点(默认站 + aurora 切换目标站) ---------- */
  const sitesRaw = await jsonGet<Record<string, unknown>[]>(`${BASE}/api/admin/sites`)
  const sites = ((sitesRaw?.['items'] as unknown) || sitesRaw || []) as { id: string; name: string; themeId: string; isDefault?: boolean }[]
  const defSite = sites.find((s) => s.isDefault) || sites[0]
  const auroraSite = sites.find((s) => s.themeId === 'aurora') // 切站还原目标(与 rose 背景差异悬殊)
  if (!defSite || !auroraSite) {
    console.log('❌ 站点不足(默认站或 aurora 站缺失):', sites.map((s) => `${s.name}:${s.themeId}`).join(', '))
    process.exit(1)
  }
  console.log(`站点: 默认=${defSite.name}(${defSite.themeId}) 切换目标=${auroraSite.name}(aurora)`)

  /* ---------- 0.5 themes API: read.layout 字段在位(第5项检查) ---------- */
  const apiThemes = await jsonGet<{ id: string; name: string; read?: { layout?: string }; preview: [string, string, string] }[]>(`${BASE}/api/admin/themes`)
  const layoutsOk =
    !!apiThemes &&
    apiThemes.length === 8 &&
    apiThemes.every((t) => ['classic', 'immersive', 'paginated'].includes(t.read?.layout || '')) &&
    apiThemes.every((t, i) => t.id === THEMES[i].id) // 注册表顺序对齐 → DOM nth 配对成立
  const layoutForms = new Set((apiThemes || []).map((t) => t.read?.layout))
  check(
    'themes API 8 主题 read.layout 在位且与注册表顺序对齐(三布局形态齐备)',
    layoutsOk && layoutForms.size === 3,
    `n=${apiThemes?.length} forms=${[...layoutForms].join('/')} ids_match=${apiThemes?.every((t, i) => t.id === THEMES[i].id)}`,
  )

  const browser = await chromium.launch()
  browserRef = browser
  const bail = async (e: unknown) => {
    console.error('verify crashed:', e)
    await browser.close().catch(() => {})
    process.exit(1)
  }
  process.on('SIGINT', () => void bail(new Error('SIGINT')))

  /* ============================================================
   * Part 1 — 后台主题区块: ReadMiniPreview 存在性 + 主题三色着色断言 (desktop)
   * ============================================================ */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const stat = makeCollector(page)
  const arm = () => {
    stat.pe = 0
    stat.ce = 0
    stat.msgs = []
  }
  const navBtn = (label: string) => page.locator('button:visible', { hasText: label }).first()

  arm()
  await page.goto(`${BASE}/?admin=1`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2200)
  await navBtn('主题模板').click()
  await page.waitForTimeout(1800)

  // 8 张卡片缩略图(div[aria-hidden].h-12, 按 THEMES 注册表顺序渲染); style=根+全部子孙元素拼接
  // (bg/primary 在根元素的 background/border 上, accent 元素在子 span 上)
  const miniStyles = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('div[aria-hidden="true"].h-12')).map((el) =>
      [el, ...Array.from(el.querySelectorAll<HTMLElement>('span, div'))]
        .map((e) => e.getAttribute('style') || '')
        .join(' '),
    ),
  )
  check('后台主题区块 0 pageerror / 0 console error', statClean(stat), `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
  check('ReadMiniPreview 缩略图 8 张互斥可见', miniStyles.length === 8, `count=${miniStyles.length}`)
  if (miniStyles.length === 8) {
    for (let i = 0; i < THEMES.length; i++) {
      const t = THEMES[i]
      const st = normCss(miniStyles[i])
      const bgHit = st.includes(normCss(t.preview[0])) // 底色 = 主题 bg(preview[0])
      const primaryHit = st.includes(`${normCss(t.preview[1]).replace(/\)$/, '')},`) // primary 各级淡色 rgba 前缀
      const accentHit = st.includes(`${normCss(t.preview[2]).replace(/\)$/, '')},`) // accent 元素
      check(`卡片[${t.name}] 缩略图主题三色着色(bg+primary+accent)`, bgHit && primaryHit && accentHit, `bg=${bgHit} primary=${primaryHit} accent=${accentHit}`)
    }
  } else {
    failures += THEMES.length
  }
  await page.screenshot({ path: `${SHOT}/admin-themes.png` })

  const btnCount = await page.locator('button:has-text("预览前台")').count()
  check('主题卡片"预览前台"按钮 8 枚', btnCount === 8, `count=${btnCount}`)

  /* ============================================================
   * Part 2 — 逐主题点击"预览前台" ×8: URL/theme 深链 + 根容器背景 == vars.bg + 预览胶囊
   * ============================================================ */
  // 前台根容器背景(gradient 主题取 backgroundImage, 纯色取 backgroundColor)
  const rootBg = (): Promise<string | null> =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.min-h-screen.w-full.flex-col')
      if (!el) return null
      const cs = getComputedStyle(el)
      return cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor
    })

  for (let i = 0; i < THEMES.length; i++) {
    const t = THEMES[i]
    arm()
    await page.goto(`${BASE}/?admin=1`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1800)
    await navBtn('主题模板').click()
    await page.waitForTimeout(1500)
    await page.locator('button:has-text("预览前台")').nth(i).click()
    await page.waitForURL((u) => u.searchParams.get('theme') === t.id, { timeout: 20000 })
    await page.waitForSelector('.min-h-screen.w-full.flex-col', { timeout: 20000 })
    await page.waitForTimeout(2200) // 站点数据 + 首页内容渲染
    const urlOk = page.url().includes(`theme=${t.id}`)
    const bg = await rootBg()
    const bgOk = !!bg && normCss(bg) === normCss(t.vars.bg)
    const capsule = await page.locator('[aria-label="主题预览指示"]', { hasText: t.name }).count()
    check(
      `预览·${t.id}(${t.name}) URL含theme + 根容器背景==vars.bg + 预览胶囊`,
      urlOk && bgOk && capsule === 1,
      `url=${urlOk} bg=${bgOk} capsule=${capsule} actual=${(bg || 'null').slice(0, 72)} pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`,
    )
    await page.screenshot({ path: `${SHOT}/preview-${t.id}.png` })
  }

  /* ============================================================
   * Part 3 — 覆盖语义: 站内导航保持预览 / 切换站点即还原 (rose 预览 → 站内 → 切 aurora 站)
   * ============================================================ */
  const rose = THEMES.find((t) => t.id === 'rose')!
  const aurora = THEMES.find((t) => t.id === 'aurora')!
  arm()
  await page.goto(`${BASE}/?view=home&theme=rose`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.min-h-screen.w-full.flex-col', { timeout: 20000 })
  await page.waitForTimeout(2200)
  const bgRose = await rootBg()
  const capRose = await page.locator('[aria-label="主题预览指示"]').count()
  check('C1·入口?theme=rose 背景==rose bg + 胶囊在位', !!bgRose && normCss(bgRose) === normCss(rose.vars.bg) && capRose === 1, `bg=${(bgRose || 'null').slice(0, 60)} capsule=${capRose}`)
  await page.screenshot({ path: `${SHOT}/c1-rose-preview.png` })

  // C2 站内导航(点击书籍卡片): URL 无 theme, 覆盖保持(背景仍 rose, 胶囊仍在)
  await page.locator('[aria-label^="查看《"]').first().click()
  await page.waitForURL((u) => u.searchParams.get('view') === 'book', { timeout: 15000 })
  await page.waitForTimeout(1800)
  const bgRose2 = await rootBg()
  const urlNoTheme = !page.url().includes('theme=')
  const capRose2 = await page.locator('[aria-label="主题预览指示"]').count()
  check(
    'C2·站内导航后 URL无theme + 覆盖保持(背景仍rose + 胶囊仍在)',
    urlNoTheme && !!bgRose2 && normCss(bgRose2) === normCss(rose.vars.bg) && capRose2 === 1,
    `urlNoTheme=${urlNoTheme} bg=${(bgRose2 || 'null').slice(0, 60)} capsule=${capRose2}`,
  )
  await page.screenshot({ path: `${SHOT}/c2-rose-insite.png` })

  // C3 切换站点: 覆盖解除(胶囊消失) + 背景回归目标站点自身主题(aurora)
  await page.locator('[aria-label="切换站点"]').click()
  await page.waitForTimeout(600)
  await page.locator(`[aria-label="切换到站点 ${auroraSite.name}"]`).click()
  await page.waitForTimeout(2200)
  const bgAurora = await rootBg()
  const capGone = await page.locator('[aria-label="主题预览指示"]').count()
  check(
    'C3·切换站点后覆盖解除 + 背景回归目标站点主题(aurora bg)',
    capGone === 0 && !!bgAurora && normCss(bgAurora) === normCss(aurora.vars.bg),
    `capsule=${capGone} bg=${(bgAurora || 'null').slice(0, 72)}`,
  )
  check('C3·语义链路全程 0 pageerror / 0 console error', statClean(stat), `pe=${stat.pe} ce=${stat.ce} ${statErr(stat)}`)
  await page.screenshot({ path: `${SHOT}/c3-switch-site.png` })
  await ctx.close()

  /* ============================================================
   * Part 4 — 移动端 375×812: 预览态无横向溢出
   * ============================================================ */
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const mpage = await mctx.newPage()
  const mstat = makeCollector(mpage)
  await mpage.goto(`${BASE}/?view=home&theme=nocturne`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await mpage.waitForTimeout(2500)
  const { sw, iw } = await mpage.evaluate(() => ({
    sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    iw: window.innerWidth,
  }))
  check('移动端·375×812 预览态(theme=nocturne) 无横向溢出', sw <= iw + 1, `scrollWidth=${sw} innerWidth=${iw}`)
  check('移动端·预览态 0 pageerror / 0 console error', mstat.pe === 0 && mstat.ce === 0, `pe=${mstat.pe} ce=${mstat.ce} ${statErr(mstat)}`)
  await mpage.screenshot({ path: `${SHOT}/mobile-preview.png` })
  await mctx.close()

  await browser.close()

  console.log('\n== hh-b 汇总 ==')
  console.log(`失败项 = ${failures}`)
  if (failures > 0) process.exit(1)
  console.log('ALL PASS')
  process.exit(0) // 显式退出: bun 脚本 import 项目模块(themes.ts)后须显式收尾
}

main().catch((e) => {
  console.error('verify crashed (unhandled):', e)
  try {
    void browserRef?.close()
  } catch {}
  try {
    execSync('pkill -f chrome-headless-shell || true')
  } catch {}
  process.exit(1)
})
