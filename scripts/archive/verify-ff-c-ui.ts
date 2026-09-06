// ============================================================
// Task ff-c UI 验证 — 前台关键页 0 pageerror / 0 console error
// + BookView TXT 下载按钮走 ?book= 通道且服务端可达(修死链后回归)
// + 管理端书籍删除/分类编辑回归由 verify-ff-c-fixes.ts 覆盖(HTTP 层)
// 运行: bun scripts/verify-ff-c-ui.ts (只读, 不写库)
// ============================================================
export {}
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'

let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!ok) failures++
}

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
  const sites = (sitesRaw?.['items'] || sitesRaw || []) as { id: string; name: string; themeId: string }[]
  const defaultSite = (sitesRaw && !sitesRaw['items'] ? (sitesRaw as unknown as { isDefault?: boolean }[]) : []).find?.((s) => (s as { isDefault?: boolean }).isDefault)
  const siteId =
    (defaultSite as { id?: string } | undefined)?.id ||
    (sites as { id?: string }[]).find((s) => s.id)?.id ||
    ''
  if (!siteId) {
    console.log('❌ 无可用站点')
    process.exit(1)
  }
  console.log(`站点: ${siteId}`)

  // 选一本带章节的书
  const booksRaw = await jsonGet(`${BASE}/api/public/books?site=${siteId}&size=5`)
  const books = (booksRaw?.['books'] || []) as { id: string; name: string }[]
  let bookId = ''
  let chId = ''
  for (const b of books) {
    const detail = await jsonGet(`${BASE}/api/public/book?id=${b.id}&tocPage=1&tocSize=3`)
    const chapters = (detail?.['chapters'] || []) as { id: string }[]
    if (chapters.length) {
      bookId = b.id
      chId = chapters[0].id
      break
    }
  }
  if (!bookId || !chId) {
    console.log('❌ 无可用书籍/章节')
    process.exit(1)
  }

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const stat = { pageErrors: 0, consoleErrors: 0, msgs: [] as string[] }
  page.on('pageerror', (e) => {
    stat.pageErrors++
    stat.msgs.push(`pageerror: ${String(e).slice(0, 120)}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') {
      stat.consoleErrors++
      stat.msgs.push(`console: ${m.text().slice(0, 120)}`)
    }
  })

  const clean = () => stat.pageErrors === 0 && stat.consoleErrors === 0

  /* ---------- 1. 首页 ---------- */
  await page.goto(`${BASE}/?view=home&site=${siteId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  check('首页 0 pageerror / 0 console error', clean(), stat.msgs.slice(0, 2).join(' ; '))

  /* ---------- 2. 书籍详情页 + TXT 下载按钮 ---------- */
  await page.goto(`${BASE}/?view=book&id=${bookId}&site=${siteId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  check('书籍页 0 pageerror / 0 console error', clean(), stat.msgs.slice(0, 2).join(' ; '))
  const txtHref = await page.locator('a', { hasText: 'TXT 下载' }).first().getAttribute('href').catch(() => null)
  check('TXT 按钮存在', !!txtHref, `href=${txtHref}`)
  check('TXT 按钮走 ?book= 通道', !!txtHref && txtHref.includes(`?book=${bookId}`), `href=${txtHref}`)
  if (txtHref) {
    // 服务端可达性(有成品→200; 无成品→404 信封, 两者均非 500/路由死链)
    const res = await fetch(`${BASE}${txtHref}`)
    check('TXT 链接服务端可达(200 或 404 信封)', res.status === 200 || res.status === 404, `status=${res.status}`)
  }

  /* ---------- 3. 阅读页 ---------- */
  await page.goto(`${BASE}/?view=read&chapter=${chId}&site=${siteId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  check('阅读页 0 pageerror / 0 console error', clean(), stat.msgs.slice(0, 2).join(' ; '))
  const bodyText = (await page.locator('body').innerText().catch(() => '')).length
  check('阅读页正文已渲染', bodyText > 200, `len=${bodyText}`)

  await browser.close()

  console.log(`\n== ff-c UI 汇总: 失败项 = ${failures} ==`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify crashed:', e)
  process.exit(1)
})
