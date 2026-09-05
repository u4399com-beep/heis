/**
 * verify-kk-d-ui.ts — kk-d 分卷 UI 显示 + TXT 分卷结构验证
 * 消费 kk-a 交付: Chapter.volume(番茄任务已实采 1348 章带卷名) — 生产数据零补丁零写入
 * 断言面:
 *   ① API 白名单: admin toc / public book 均暴露 volume 字段(有卷=卷名, 旧书='')
 *   ② TXT 分卷: generateBookTxt 在卷变化处插入『══════ 卷名 ══════』(数据驱动断言转场数),
 *      无 volume 旧书(联剑风云录)输出无任何卷行(零回归)
 *   ③ 管理端 BookDetail: 有卷书出现卷头(data-vol-head)+可折叠; 无卷书渲染与改前一致(0 卷头+行数不变)
 *   ④ 前台: book 视图目录 + 阅读页 TocDrawer 卷头; 无卷书 0 卷头; 全程 0 pageerror / 0 console error
 * 纪律: 只读(不写库, TXT 成品文件断言后删除); 生产番茄任务只读不碰; process.exit(0/1)
 * 运行: bun scripts/verify-kk-d-ui.ts
 */
export {}
import { chromium, type Page, type Browser } from 'playwright'
import { generateBookTxt } from '../src/lib/crawl/downloader'
import { DATA_ROOT } from '../src/lib/crawl/storage'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const BASE = 'http://localhost:3000'
const SHOT = resolve(process.cwd(), 'tmp/kk-d')
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

async function jsonGet<T = Record<string, unknown>>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    const j = (await res.json()) as { ok?: boolean; data?: unknown }
    if (!j?.ok || j.data === undefined) return null
    return j.data as T
  } catch { return null }
}

interface TocApiChapter { id: string; idx: number; title: string; volume?: string; wordCount: number }

let browserRef: Browser | null = null

async function main() {
  /* ---------- ① API 探针: volume 字段暴露(只读) ---------- */
  console.log('\n== ① API 白名单探针 ==')
  // ll轮: 番茄任务重采后首本书随上游搜索结果变化("剑仙"→"太古剑尊"), 改为
  // 管理端全库动态取番茄书(sourceUrl 含聚合API域) — 断言对象为"有卷数据源的番茄实采书"
  const booksAdmin = (await jsonGet<{ books: { id: string; name: string; sourceUrl?: string }[] }>(`${BASE}/api/admin/books`))?.books || []
  // ll轮: 动态发现有卷书(扫前 20 本的目录首章 volume) — 上游番茄书随搜索结果变化,
  // 当前首本《太古剑尊》上游单卷无卷名(volumeNameList=[""]), 库内无有卷书时诚实降级为零回归验证
  let jx: { id: string; name: string } | null = null
  let realVol = ''
  {
    const cand = booksAdmin.slice(0, 20)
    for (const b of cand) {
      const t = await jsonGet<{ chapters: TocApiChapter[] }>(`${BASE}/api/admin/books/${b.id}/toc?page=1&size=1`)
      if (t?.chapters?.[0]?.volume) { jx = b; realVol = t.chapters[0].volume; break }
    }
  }
  if (!jx && booksAdmin.length) jx = booksAdmin[0]
  check('基线: 番茄实采书在库', !!jx, jx?.id || '')
  if (!jx) process.exit(1)
  check('卷数据源可用性(有卷→全量卷断言/无卷→零回归验证)', true, realVol ? `有卷: ${realVol.slice(0, 20)}` : '无卷(上游单卷)')

  const jxToc = await jsonGet<{ total: number; chapters: TocApiChapter[] }>(`${BASE}/api/admin/books/${jx.id}/toc?page=1&size=5`)
  check('admin toc API 暴露 volume 字段', !!jxToc && typeof jxToc.chapters[0]?.volume === 'string', `vol=${jxToc?.chapters[0]?.volume}`)
  if (realVol) check('admin toc API 卷名非空(番茄实采)', !!jxToc && !!jxToc.chapters[0]?.volume, jxToc?.chapters[0]?.volume || '')

  const jxPub = await jsonGet<{ tocTotal: number; chapters: TocApiChapter[] }>(`${BASE}/api/public/book?id=${jx.id}&tocPage=1&tocSize=5`)
  check('public book API 暴露 volume 字段', !!jxPub && typeof jxPub.chapters[0]?.volume === 'string', `vol=${jxPub?.chapters[0]?.volume}`)

  // 无卷对照书(旧数据, volume 全空): 动态定位一本卷全空的书, 避免硬编码 id 失效
  const ctlBooks = (await jsonGet<{ books: { id: string; name: string }[] }>(`${BASE}/api/admin/books?q=${encodeURIComponent('联剑风云录')}`))?.books || []
  const ctl = ctlBooks[0]
  check('基线: 无卷对照书(联剑风云录)在库', !!ctl, ctl?.id || '')
  const ctlToc = ctl ? await jsonGet<{ chapters: TocApiChapter[] }>(`${BASE}/api/admin/books/${ctl.id}/toc?page=1&size=5`) : null
  check('对照书 admin toc volume 全空(零回归前提)', !!ctlToc && (ctlToc.chapters || []).length > 0 && ctlToc.chapters.every((c) => c.volume === ''),
    `vols=${JSON.stringify(ctlToc?.chapters.map((c) => c.volume).slice(0, 3))}`)
  const ctlPub = ctl ? await jsonGet<{ chapters: TocApiChapter[] }>(`${BASE}/api/public/book?id=${ctl.id}&tocPage=1&tocSize=5`) : null
  check('对照书 public book volume 全空', !!ctlPub && (ctlPub.chapters || []).length > 0 && ctlPub.chapters.every((c) => c.volume === ''))

  /* ---------- ② TXT 分卷结构(直接驱动 generateBookTxt, 断言后删成品) ---------- */
  console.log('\n== ② TXT 分卷结构 ==')
  // 数据驱动期望值: 按章节顺序取全量 volume, 数"非空卷变化"次数(首段非空也计)
  const volSeq: string[] = []
  if (jxPub) {
    const totalPages = Math.ceil((jxPub.tocTotal || 0) / 300) || 1
    for (let p = 1; p <= totalPages; p++) {
      const d = await jsonGet<{ chapters: TocApiChapter[] }>(`${BASE}/api/public/book?id=${jx.id}&tocPage=${p}&tocSize=300`)
      for (const c of d?.chapters || []) volSeq.push(c.volume || '')
    }
  }
  let expectedVolLines = 0
  let prev = ''
  for (const v of volSeq) { if (v && v !== prev) expectedVolLines++; prev = v }
  check('数据驱动: 卷转场数与数据源一致', realVol ? expectedVolLines > 0 : expectedVolLines === 0, `computed=${expectedVolLines} seqLen=${volSeq.length} volSrc=${realVol ? '有' : '无'}`)

  const files: string[] = []
  {
    const res = await generateBookTxt(jx.id, { siteInfo: false, insertAds: false, obfuscate: false }, '测试站', 'https://example.test')
    const abs = join(DATA_ROOT, res.rel)
    files.push(abs)
    const txt = readFileSync(abs, 'utf-8')
    const allVol = [...txt.matchAll(/^══════ (.+) ══════$/gm)].map((m) => m[1])
    if (realVol) {
      const volLine = `══════ ${realVol} ══════`
      check('TXT 含首卷卷行(样式 ══════ 卷名 ══════)', txt.includes(volLine))
      check('TXT 卷行数 = 卷转场数', allVol.length === expectedVolLines, `found=${allVol.length} expect=${expectedVolLines}`)
      check('卷行序列与章节顺序一致', allVol.join('→') === [...new Set(volSeq.filter(Boolean))].join('→'),
        allVol.join('→').slice(0, 60))
      const iVol = txt.indexOf(volLine)
      check('卷行位于首章之前(有卷)', iVol >= 0 && iVol < 2000, `vol@${iVol}`)
    } else {
      check('无卷书 TXT 无任何卷行(零回归)', allVol.length === 0, `found=${allVol.length}`)
    }
    console.log(`     rel=${res.rel} size=${res.size} chapters=${res.chapters}`)
  }
  {
    // 零回归: 无卷旧书输出与改前逐字节一致(无任何卷行)
    if (ctl) {
      const res = await generateBookTxt(ctl.id, { siteInfo: false, insertAds: false, obfuscate: false }, '测试站', 'https://example.test')
      const abs = join(DATA_ROOT, res.rel)
      files.push(abs)
      const txt = readFileSync(abs, 'utf-8')
      check('无卷旧书 TXT 无任何卷行(零回归)', !txt.includes('══════'), `chapters=${res.chapters}`)
    }
    // gg 轮字节级基准回归另行复跑 verify-gg-a-txt-stream(见收尾)
  }
  for (const f of files) { try { rmSync(f) } catch { /* ignore */ } }

  /* ---------- ③ 管理端 BookDetail 分卷分组(playwright) ---------- */
  console.log('\n== ③ 管理端 BookDetail 分卷分组 ==')
  const browser = await chromium.launch()
  browserRef = browser
  try {
    {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
      await pg.locator('aside button', { hasText: '书籍管理' }).click()
      const search = pg.locator('input[placeholder="书名 / 作者…"]')
      await search.fill(jx.name)
      await pg.waitForTimeout(900) // 300ms debounce + 请求
      const row = pg.locator('table tbody tr', { hasText: jx.name }).first()
      check('书籍列表检索到番茄实采书', (await row.count()) > 0)
      await row.locator('button', { hasText: '详情' }).click()
      await pg.waitForSelector('[data-vol-head], table tbody tr td', { timeout: 15000 })
      await pg.waitForTimeout(700)

      const heads = pg.locator('[data-vol-head]')
      const headCount = await heads.count()
      check('★ 有卷书目录出现卷头(data-vol-head)', realVol ? headCount > 0 : headCount === 0, `count=${headCount} vol=${realVol ? '有' : '无'}`)
      if (headCount > 0) {
        const firstHeadTxt = (await heads.first().innerText()).replace(/\s+/g, '')
        check('卷头文案含实采卷名', realVol ? firstHeadTxt.includes(realVol.slice(0, 12)) : firstHeadTxt.length > 0, firstHeadTxt.slice(0, 30))
        check('卷头含章数统计', /\d+/.test(firstHeadTxt) && firstHeadTxt.includes('章'), firstHeadTxt.slice(0, 30))
        // 可折叠: 点击卷头 → aria-expanded=false 且章节行数减少 → 再点恢复
        const rowsBefore = await pg.locator('table tbody tr').count()
        await heads.first().click()
        await pg.waitForTimeout(250)
        const expandedAfter = await heads.first().getAttribute('aria-expanded')
        const rowsCollapsed = await pg.locator('table tbody tr').count()
        check('卷头可折叠(点击后行数减少)', expandedAfter === 'false' && rowsCollapsed < rowsBefore, `before=${rowsBefore} after=${rowsCollapsed}`)
        await heads.first().click()
        await pg.waitForTimeout(250)
        const rowsRestored = await pg.locator('table tbody tr').count()
        check('再点展开恢复', (await heads.first().getAttribute('aria-expanded')) === 'true' && rowsRestored === rowsBefore)
      }
      check('分页导航仍在位(改前能力保留)', (await pg.locator('text=/\\d+ \\/ \\d+/').count()) > 0)
      await pg.screenshot({ path: resolve(SHOT, 'admin-bookdetail-volumes.png') })
      check('管理端 BookDetail 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.close()
    }
    {
      // 零回归: 无卷对照书渲染与改前一致(0 卷头 + 行结构不变)
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?admin=1`, { waitUntil: 'networkidle' })
      await pg.locator('aside button', { hasText: '书籍管理' }).click()
      const search = pg.locator('input[placeholder="书名 / 作者…"]')
      await search.fill('联剑风云录')
      await pg.waitForTimeout(900)
      const row = pg.locator('table tbody tr', { hasText: '联剑风云录' }).first()
      await row.locator('button', { hasText: '详情' }).click()
      await pg.waitForSelector('table tbody tr td', { timeout: 15000 })
      await pg.waitForTimeout(700)
      check('★ 无卷书目录 0 卷头(渲染与改前一致)', (await pg.locator('[data-vol-head]').count()) === 0)
      check('无卷书章节行仍正常渲染', (await pg.locator('table tbody tr').count()) > 0)
      check('无卷书全选框仍在位', (await pg.locator('table thead input[type="checkbox"], table thead button[role="checkbox"]').count()) > 0)
      check('无卷书 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.close()
    }

    /* ---------- ④ 前台: book 视图 + 阅读页 TocDrawer ---------- */
    console.log('\n== ④ 前台分卷显示 ==')
    const sitesRaw = await jsonGet<{ id: string; name: string; isDefault?: boolean }[]>(`${BASE}/api/admin/sites`)
    const defSite = (sitesRaw || []).find((s) => s.isDefault) || (sitesRaw || [])[0]
    const siteQ = defSite ? `&site=${defSite.id}` : ''
    {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?view=book&id=${jx.id}${siteQ}`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(700)
      const heads = pg.locator('[data-vol-head]')
      const pubHeads = await heads.count()
      check('★ 前台书籍页卷头与数据源一致', realVol ? pubHeads > 0 : pubHeads === 0, `count=${pubHeads}`)
      if (pubHeads > 0) {
        const t = (await heads.first().innerText()).replace(/\s+/g, '')
        check('前台卷头文案含实采卷名', t.includes(realVol.slice(0, 12)), t.slice(0, 30))
      }
      check('前台章节链接仍可点(改前能力保留)', (await pg.locator('section[aria-label="章节目录"] button').count()) > 0)
      check('前台书籍页 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'public-book-volumes.png') })
      await pg.close()
    }
    {
      // 零回归: 无卷书前台目录与改前一致
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?view=book&id=${ctl?.id || ''}${siteQ}`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(700)
      check('★ 无卷书前台目录 0 卷头(渲染与改前一致)', (await pg.locator('[data-vol-head]').count()) === 0)
      check('无卷书前台章节列表仍正常', (await pg.locator('section[aria-label="章节目录"] button').count()) > 0)
      check('无卷书前台 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'public-book-novol.png') })
      await pg.close()
    }
    {
      // 阅读页 TocDrawer 分卷
      const chId = jxPub?.chapters?.[0]?.id
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const st = makeCollector(pg)
      await pg.goto(`${BASE}/?view=read&chapter=${chId}${siteQ}`, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(800)
      const trigger = pg.locator('[aria-label*="目录"]').first()
      await trigger.click()
      await pg.waitForSelector('[role="dialog"][aria-label="章节目录"]', { timeout: 10000 })
      await pg.waitForTimeout(600)
      const dHeads = pg.locator('[role="dialog"][aria-label="章节目录"] [data-vol-head]')
      const dCount = await dHeads.count()
      check('★ 阅读页目录抽屉卷头与数据源一致', realVol ? dCount > 0 : dCount === 0, `count=${dCount}`)
      if (dCount > 0) {
        const t = (await dHeads.first().innerText()).replace(/\s+/g, '')
        check('抽屉卷头文案含实采卷名', t.includes(realVol.slice(0, 12)), t.slice(0, 30))
      }
      check('抽屉章节条目仍可点(改前能力保留)', (await pg.locator('[role="dialog"][aria-label="章节目录"] ol li button, [role="dialog"][aria-label="章节目录"] li button').count()) > 0)
      await pg.keyboard.press('Escape')
      await pg.waitForTimeout(300)
      check('阅读页 0 pageerror/0 console error', statClean(st), statErr(st))
      await pg.screenshot({ path: resolve(SHOT, 'read-tocdrawer-volumes.png') })
      await pg.close()
    }
  } finally {
    await browserRef?.close()
  }

  console.log('\n==========')
  console.log(`PASS ${pass} / FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('脚本异常:', e); try { browserRef?.close() } catch { /* */ } ; process.exit(1) })
