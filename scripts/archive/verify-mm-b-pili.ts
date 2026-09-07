// ============================================================
// verify-mm-b-pili.ts — 霹雳书屋规则链路端到端断言(mm-b 深审, 离线样本级)
//   规则: cmtlefjho025hqjh4yzuenady(生产任务 cmtlefji2… 已实证 176 章入库)
//   1. tocLink: a[href*='/menu/'] 从书籍页提取目录页(相对→绝对)
//   2. parseToc: menu 样本 → 176 章, 全绝对 URL(/5/2951/read/*.html→https://www.pilishuwu.com/…)
//   3. reorderToc: 无卷 176 章按"第N章"序号升序零回归(kk-a/ll-c 面)
//   4. 无 menu 链接书降级: tocLink 落空 → 书籍页内联 40 章(span.works-chapter-item)
//   5. parseContent+cleanContentHtml: read 样本正文干净(adPatterns 不误伤, 开篇句在位)
//   6. parseBook: 书名/作者/简介提取
//   7. 字节级防伪象: tocLink 表达式逐字节比对(工作区已出现 5 次输出管道吞字,
//      一律以 Buffer 比对定夺 —— 本断言固化该教训)
// 运行: bun scripts/verify-mm-b-pili.ts (只读, 零 DB 写)
// ============================================================
import { readFileSync } from 'fs'

export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  const { parseRuleConfig } = await import('../src/lib/crawl/types')
  const { extractField, urlVars, absolutize, parseToc, parseBook, parseContent } = await import('../src/lib/crawl/parser')
  const { reorderToc, extractChapterNo } = await import('../src/lib/crawl/sorter')
  const { cleanContentHtml } = await import('../src/lib/crawl/cleaner')
  const { db } = await import('../src/lib/db')

  const ruleRow = await db.rule.findUnique({ where: { id: 'cmtlefjho025hqjh4yzuenady' } })
  ok('pili 规则在库', !!ruleRow)
  if (!ruleRow) { process.exit(1) }
  const rule = parseRuleConfig(ruleRow.config)

  const bookHtml = readFileSync('tmp/mm/pili-book-info.html', 'utf8')
  const menuHtml = readFileSync('tmp/mm/pili-menu1.html', 'utf8')
  const readHtml = readFileSync('tmp/mm/pili-read.html', 'utf8')
  const BOOK_URL = 'https://www.pilishuwu.com/5/2951/info.html'
  const MENU_URL = 'https://www.pilishuwu.com/5/2951/menu/1.html'

  console.log('\n== 1. tocLink 提取 + 相对→绝对 ==')
  {
    // 字节级比对(防输出管道吞字伪象第 5 例: a[href*='/menu/'] 曾显示为 aref*...)
    const expr = rule.toc.tocLink?.expression || ''
    ok('【防伪象】tocLink 表达式逐字节 == a[href*=\'/menu/\']', Buffer.from(expr, 'utf8').equals(Buffer.from("a[href*='/menu/']", 'utf8')), `bytes=${Buffer.from(expr, 'utf8').toString('hex')}`)
    const $ = (await import('cheerio')).load(bookHtml)
    const link = extractField(bookHtml, $, null, null, rule.toc.tocLink!, { vars: urlVars(BOOK_URL) })
    const abs = absolutize(link, BOOK_URL)
    ok('tocLink 命中 menu 链接', link === "/5/2951/menu/1.html", `raw=${link}`)
    ok('absolutize → 绝对地址', abs === MENU_URL, `abs=${abs}`)
  }

  console.log('\n== 2. parseToc(menu 样本) → 176 章全绝对 URL ==')
  let tocItems: ReturnType<typeof reorderToc> = []
  {
    const r = await parseToc(MENU_URL, menuHtml, rule.toc, {})
    tocItems = r.items as never
    ok('章节数 176(与生产任务入库一致)', r.items.length === 176, `实际=${r.items.length}`)
    ok('全部条目持绝对 https URL(相对 /5/2951/read/*.html 已解析)', r.items.every((it) => /^https:\/\/www\.pilishuwu\.com\/5\/2951\/read\/\d+\.html$/.test(it.url)))
    ok('URL 全唯一(去重面)', new Set(r.items.map((it) => it.url)).size === r.items.length)
    ok('标题非空且含"第N章"形态', r.items.every((it) => /^第\d+章/.test(it.title)), `首条=${r.items[0]?.title?.slice(0, 24)}`)
    ok('无卷字段(该书无分卷字段, 走标题序号路径)', r.items.every((it) => !it.volume))
  }

  console.log('\n== 3. reorderToc 无卷 176 章零回归 ==')
  {
    const sorted = reorderToc(tocItems)
    const nos = sorted.map((it) => extractChapterNo(it.title))
    ok('重排后序号严格升序 1..176(零回归)', nos.every((n, i) => n === i + 1), `首=${nos[0]} 末=${nos[nos.length - 1]}`)
    ok('重排不改变集合(URL 集合不变)', new Set(sorted.map((it) => it.url)).size === new Set(tocItems.map((it) => it.url)).size)
    // 乱序注入再重排: 源站若乱序返回也能修复
    const shuffled = [...tocItems].sort(() => Math.random() - 0.5)
    const resorted = reorderToc(shuffled)
    const nos2 = resorted.map((it) => extractChapterNo(it.title))
    ok('乱序输入 → 重排修复为 1..176', nos2.every((n, i) => n === i + 1))
  }

  console.log('\n== 4. 无 menu 链接书降级(书籍页内联 40 章) ==')
  {
    // 模拟"无 menu 链接的书": 剥掉书籍页全部 /menu/ 链接后 tocLink 落空
    const stripped = bookHtml.replace(/href="\/5\/2951\/menu\/[^"]*"/g, 'href="#nomenu"')
    const $2 = (await import('cheerio')).load(stripped)
    const link2 = extractField(stripped, $2, null, null, rule.toc.tocLink!, { vars: urlVars(BOOK_URL) })
    const abs2 = absolutize(link2, BOOK_URL)
    ok('tocLink 落空(返回空, runner 走书籍页直解/嗅探降级)', abs2 === '', `raw=${JSON.stringify(link2)} abs=${JSON.stringify(abs2)}`)
    // 降级路径实况: 书籍页本身按 itemSelector 直解(runner extractToc 第 2 步)
    const r2 = await parseToc(BOOK_URL, stripped, rule.toc, {})
    ok('书籍页内联章节可直解为目录(40 项, 降级有产出)', r2.items.length === 40, `实际=${r2.items.length}`)
    ok('降级目录同样持绝对 URL', r2.items.every((it) => /^https:\/\/www\.pilishuwu\.com\//.test(it.url)))
  }

  console.log('\n== 5. parseContent + 清洗(adPatterns 不误伤) ==')
  {
    const c = await parseContent('https://www.pilishuwu.com/5/2951/read/845013.html', readHtml, rule.content, {})
    ok('正文提取非空(div.read-content html)', c.content.length > 3000, `${c.content.length}chars`)
    const cleaned = cleanContentHtml(c.content, rule.clean)
    ok('清洗后正文体量保持(>90%, adPatterns 未误伤正文)', cleaned.length > c.content.length * 0.9, `raw=${c.content.length} clean=${cleaned.length}`)
    ok('开篇句在位(正文完整性)', cleaned.includes('雪下了四个小时'))
    ok('无广告残留', !/请记住本站|本站所收录|最快更新|pilishuwu|霹雳书屋/.test(cleaned))
    ok('无替换符/控制符', !cleaned.includes('\uFFFD'))
    const titleField = rule.content.fields.title
    if (!titleField) { ok('章节标题提取(规则含 title 字段前置)', false, 'title field missing'); }
    else {
      const ch = (await import('cheerio')).load(readHtml)
      // 样本 read 页为第1章: 标题提取应为"第N章"形态且与正文匹配(样本=第1章 开篇"雪下了四个小时")
      const title = extractField(readHtml, ch, null, null, titleField, {})
      ok('章节标题提取(h3.j_chapterName, 与样本章对应)', /^第\d+章/.test(title) && title.includes('第1章'), `title=${title.slice(0, 30)}`)
    }
  }

  console.log('\n== 6. parseBook 书籍字段 ==')
  {
    const b = parseBook(bookHtml, BOOK_URL, rule.book)
    ok('书名=全球高考', b.name === '全球高考', `name=${b.name}`)
    ok('作者=木苏里(regex 段)', b.author === '木苏里', `author=${b.author}`)
    ok('简介非空', (b.intro || '').length > 50, `${(b.intro || '').length}chars`)
    ok('封面为绝对 URL', /^https:\/\//.test(b.cover || ''), `cover=${(b.cover || '').slice(0, 60)}`)
  }

  await db.$disconnect()
  console.log(`\n===== verify-mm-b-pili: ${pass} passed, ${fail} failed =====`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本异常:', e?.stack?.slice(0, 500) || e)
  process.exit(1)
})
