// ============================================================
// Task bb-f 验证脚本(前台) — playwright 前台渲染验证(只读)
// 1. 后台首页 / (+ 采集规则页切换)  2. 前台首页 /?view=home (+页脚友链区)
// 3. 真实书籍公开页 /?view=book&id=... (+点进正文阅读)
// 记录: bodyText 长度 / pageerror 数 / console error 数
// 运行: bun scripts/verify-bb-f-ui.ts
// ============================================================
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'

interface StepStat {
  pageErrors: number
  consoleErrors: number
  consoleTexts: string[]
  pageErrTexts: string[]
}

async function main() {
  // 真实书籍 id(只读取 DB 经公开 API)
  const booksRes = await fetch(`${BASE}/api/public/books?take=3`)
  const booksJson: any = await booksRes.json()
  const book = booksJson?.data?.books?.[0]
  if (!book?.id) { console.log('❌ 无真实书籍可用'); process.exit(1) }
  console.log(`真实书籍: id=${book.id} name=${book.name} author=${book.author}`)

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  let stat: StepStat = { pageErrors: 0, consoleErrors: 0, consoleTexts: [], pageErrTexts: [] }
  const reset = () => { stat = { pageErrors: 0, consoleErrors: 0, consoleTexts: [], pageErrTexts: [] } }
  page.on('pageerror', (e) => { stat.pageErrors++; stat.pageErrTexts.push(String(e).slice(0, 150)) })
  page.on('console', (m) => { if (m.type() === 'error') { stat.consoleErrors++; stat.consoleTexts.push(m.text().slice(0, 150)) } })

  const bodyInfo = async () => {
    const bodyText = await page.evaluate(() => document.body.innerText)
    const title = await page.title()
    return { bodyText, title }
  }
  const reportErrs = (s: StepStat) => {
    const lines: string[] = []
    if (s.pageErrors) lines.push(`pageerror 文本: ${JSON.stringify(s.pageErrTexts.slice(0, 3))}`)
    if (s.consoleErrors) lines.push(`console error 文本: ${JSON.stringify(s.consoleTexts.slice(0, 3))}`)
    return lines.join('; ') || '-'
  }

  // ---------- 1. 后台首页 / ----------
  console.log('\n== B1 后台首页 / ==')
  reset()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)
  let { bodyText, title } = await bodyInfo()
  console.log(`title="${title}" bodyText=${bodyText.length}字 pageerror=${stat.pageErrors} consoleError=${stat.consoleErrors}`)
  console.log(`  ${reportErrs(stat)}`)

  // 切到 采集规则 页
  reset()
  await page.locator('button:has-text("采集规则"):visible').first().click()
  await page.waitForTimeout(2000)
  const adminRules = await bodyInfo()
  const hasDaweixs = adminRules.bodyText.includes('大微小说网')
  const hasDafeng = adminRules.bodyText.includes('大奉打更人')
  const hasYybsw = adminRules.bodyText.includes('夜伴书屋')
  console.log(`采集规则页: bodyText=${adminRules.bodyText.length}字 大微=${hasDaweixs} 大奉=${hasDafeng} 夜伴=${hasYybsw} pageerror=${stat.pageErrors} consoleError=${stat.consoleErrors}`)
  console.log(`  ${reportErrs(stat)}`)

  // ---------- 2. 前台首页 /?view=home ----------
  console.log('\n== B2 前台首页 /?view=home ==')
  reset()
  await page.goto(`${BASE}/?view=home`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)
  const home = await bodyInfo()
  const footerCount = await page.locator('footer').count()
  let footerVisible = false
  if (footerCount) footerVisible = await page.locator('footer').first().isVisible()
  const friendByAria = await page.locator('[aria-label="友情链接"]').count()
  const friendByText = home.bodyText.includes('友情链接')
  const linksJson: any = await (await fetch(`${BASE}/api/public/links`)).json()
  const friendN = (linksJson?.data?.friend || []).length
  const wheelN = (linksJson?.data?.wheel || []).length
  console.log(`title="${home.title}" bodyText=${home.bodyText.length}字(>500: ${home.bodyText.length > 500}) pageerror=${stat.pageErrors} consoleError=${stat.consoleErrors}`)
  console.log(`页脚: footer数=${footerCount} 可见=${footerVisible} 友链模块(aria)=${friendByAria} 友链文本=${friendByText} | 数据: friend=${friendN}条 wheel(站群链轮)=${wheelN}条`)
  console.log(`  ${reportErrs(stat)}`)

  // ---------- 3. 书籍公开页 /?view=book&id=... ----------
  console.log(`\n== B3 书籍公开页 /?view=book&id=${book.id} ==`)
  reset()
  await page.goto(`${BASE}/?view=book&id=${book.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  // 目录区可能出现较晚(详情+分页目录两次请求), 等待目录节渲染
  let tocSeen = true
  try { await page.locator('[aria-label="章节目录"]').waitFor({ state: 'visible', timeout: 10000 }) } catch { tocSeen = false }
  await page.waitForTimeout(1500)
  const bp = await bodyInfo()
  const nameOk = bp.bodyText.includes(book.name)
  const introLikely = bp.bodyText.includes('插画家') // 简介片段
  // 目录条目按文本计(本书章节名"第N节", 分页每页 100 条)
  const tocText = tocSeen ? await page.locator('[aria-label="章节目录"]').innerText() : ''
  const chapterItems = (tocText.match(/第\d+[节章]/g) || []).length
  const tocHeader = (tocText.match(/共\s*\d+\s*章[^\n]*/) || [''])[0]
  console.log(`title="${bp.title}" bodyText=${bp.bodyText.length}字 含书名=${nameOk} 含简介片段=${introLikely} 目录节可见=${tocSeen} 目录头="${tocHeader}" 目录条目=${chapterItems} pageerror=${stat.pageErrors} consoleError=${stat.consoleErrors}`)
  console.log(`  ${reportErrs(stat)}`)

  // 点"开始阅读" → 阅读页(正文渲染)
  reset()
  let readChecked = false
  try {
    await page.locator('button:has-text("开始阅读"):visible, a:has-text("开始阅读"):visible').first().click({ timeout: 8000 })
    await page.waitForTimeout(3000)
    const rv = await bodyInfo()
    const contentLikely = rv.bodyText.replace(/\s/g, '').length
    readChecked = contentLikely > 300
    console.log(`阅读页: bodyText=${rv.bodyText.length}字(去空白${contentLikely}) 正文可信=${readChecked} url=${decodeURIComponent(page.url()).slice(0, 90)} pageerror=${stat.pageErrors} consoleError=${stat.consoleErrors}`)
    console.log(`  ${reportErrs(stat)}`)
  } catch (e: any) {
    console.log(`阅读页: 点击"开始阅读"未成(${String(e).slice(0, 80)}) — 仅记录不判失败`)
  }

  await browser.close()
  console.log('\n== B 汇总 ==')
  console.log(`后台首页: title非空=${!!title} bodyText=${bodyText.length}`)
  console.log(`采集规则页: 规则列表可见=${hasDaweixs && hasDafeng && hasYybsw}`)
  console.log(`前台首页: bodyText>500=${home.bodyText.length > 500} footer可见=${footerVisible} 友链模块可见=${friendByAria > 0 || friendByText}`)
  console.log(`书籍页: 含书名=${nameOk} 含简介=${introLikely} 目录节=${tocSeen} 目录条目=${chapterItems} 阅读页正文=${readChecked}`)
}

main()

export {}
