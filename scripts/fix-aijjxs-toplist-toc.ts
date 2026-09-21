// 修复脚本: aijjxs toplist 规则的 toc 段 + 历史 task 的脏 URL
//
// 问题根因(完整分析):
// 1. list.fields.bookUrl.replaceFrom 在 fix-aijjxs-bookurl.ts 修复前未配置 → task 的
//    discoveredBookUrls / bookUrl 字段存的是 /txt/{id}.html 形态(未替换)
// 2. toplist 规则的 toc.tocLink 用 const 模板 {q.id} 需要 URL 查询参数 id,
//    而 /txt/{id}.html 没有查询参数 → tocLink 拼成 /read// (双斜杠), 抓回 404/首页
// 3. toplist 规则的 book 段用 og:novel:* 元数据, 而 /txt/{id}.html 页面没有 og 元数据
//    (只有 /read/{id}/ 才有) → parsed.name 空, bookName fallback 到 urlPathName="txt/xxx.html"
// 4. 增量重采 route 用 book.sourceUrl 作为 task.bookUrl, 但旧 task 创建时
//    book.sourceUrl 是错的 /txt/{id}.html, 后来被另一 task 更新为 /read/{id}/,
//    旧 task.bookUrl 字段不会跟着变 → 续采时仍用错的 URL
//
// 修复方案:
// A. 修 toplist 规则 cmu18j0jp0000nyls0capyu4a:
//    - toc.tocLink 从 const {q.id} 改为 css a.download-btn[href^="/read/"] (双 URL 适配)
//    - toc.itemSelector 加 :not(:first-child) 排除"内容简介"非真章节
// B. 修 5 个坏 task:
//    - 4 个增量重采 task 的 bookUrl 字段: /txt/{id}.html → /read/{id}/
//    - 1 个范围 task 的 progress.discoveredBookUrls 批量替换: /txt/{id}.html → /read/{id}/
//
// 验证:
// - 修后 list 段测试 → bookUrl 仍是 /read/{id}/ (规则 list 段早已正确)
// - 修后 toc 段(tocLink=css a.download-btn[href^="/read/"] + itemSelector 加 :not) →
//   /txt/{id}.html 抓到 /read/{id}/, 提取真实章节列表(排除"内容简介")
// - 修后增量重采 task 续采时 bookUrl=/read/{id}/, book 段 og 元数据正常 → 书名正确
import { db } from '/home/z/my-project/src/lib/db'

const TOPLIST_RULE_ID = 'cmu18j0jp0000nyls0capyu4a'
const BAD_TASK_IDS = [
  'cmu1fwysb002anypldv39v64w', // 增量重采:《这个地下城长蘑菇了》
  'cmu1fwyrk001snyplovckcwzy', // 增量重采:《从谎言之神到诸世之主》
  'cmu1fwyrc001mnypla7y8cj6a', // 增量重采:《前任无双》
  'cmu1fwyr6001inyplm83g48kl', // 增量重采:《开海》
  'cmu194uz60007nytxtu94sf3q', // 范围任务: toplist 分类列表
]
const URL_REWRITE = (u: string) => u.replace(/^https?:\/\/www\.aijjxs\.com\/txt\/(\d+)\.html$/, 'https://www.aijjxs.com/read/$1/')

async function main() {
  // ---- A. 修 toplist 规则 toc 段 ----
  const r = await db.rule.findUnique({ where: { id: TOPLIST_RULE_ID } })
  if (!r) { console.log('Rule not found'); process.exit(1) }
  const cfg = JSON.parse(r.config)

  // toc.tocLink: 从 const 模板改成 css 选择器
  //   - /txt/{id}.html 页面有 1 个 <a class="download-btn" href="/read/{id}/">在线阅读全文</a>
  //   - /read/{id}/ 页面没有 a.download-btn[href^="/read/"] (它是目录页本身, 含 800+ 章节 a)
  //   当 tocLink 解析为空时, runner.extractToc 会跳到第2步: 用书籍页本身解析目录 (parseToc)
  //   此时 toc.itemSelector 命中 ul.chapter-list li, 拿到全量章节
  const oldTocLink = cfg.toc.tocLink
  cfg.toc.tocLink = {
    type: 'css',
    expression: 'a.download-btn[href^="/read/"]',
    attr: 'href',
  }
  // toc.itemSelector: 加 :not(:first-child) 排除第一个 li "内容简介"(非真章节)
  // 原表达式 ul.chapter-list li 会把"内容简介"作为第1章采进库, 章节序号错乱
  const oldItemSel = cfg.toc.itemSelector?.expression
  if (cfg.toc.itemSelector) {
    cfg.toc.itemSelector.expression = 'ul.chapter-list li:not(:first-child)'
  }
  console.log('[A] toc.tocLink:', oldTocLink, '→', cfg.toc.tocLink)
  console.log('[A] toc.itemSelector:', oldItemSel, '→', cfg.toc.itemSelector?.expression)

  await db.rule.update({
    where: { id: TOPLIST_RULE_ID },
    data: { config: JSON.stringify(cfg) },
  })
  console.log('[A] rule updated, id=', TOPLIST_RULE_ID)

  // ---- B1. 修 4 个增量重采 task 的 bookUrl 字段 ----
  for (const tid of BAD_TASK_IDS) {
    const t = await db.task.findUnique({ where: { id: tid } })
    if (!t) { console.log(`[B1] task ${tid} not found, skip`); continue }
    const updates: { bookUrl?: string; progress?: string } = {}
    // 修 bookUrl 字段
    if (t.bookUrl && /\/txt\/\d+\.html/.test(t.bookUrl)) {
      const newUrl = URL_REWRITE(t.bookUrl)
      if (newUrl !== t.bookUrl) {
        updates.bookUrl = newUrl
        console.log(`[B1] task ${tid} bookUrl: ${t.bookUrl} → ${newUrl}`)
      }
    }
    // 修 progress.discoveredBookUrls (仅范围 task cmu194uz6 有)
    if (t.progress) {
      try {
        const p = JSON.parse(t.progress)
        let changed = false
        if (Array.isArray(p.discoveredBookUrls)) {
          const newList = p.discoveredBookUrls.map((u: string) => {
            if (typeof u === 'string' && /\/txt\/\d+\.html/.test(u)) {
              const nu = URL_REWRITE(u)
              if (nu !== u) { changed = true; return nu }
            }
            return u
          })
          if (changed) {
            p.discoveredBookUrls = newList
            console.log(`[B2] task ${tid} progress.discoveredBookUrls rewritten (${newList.length} items)`)
          }
        }
        if (changed) {
          updates.progress = JSON.stringify(p)
        }
      } catch (e) {
        console.log(`[B2] task ${tid} progress parse failed, skip`)
      }
    }
    if (Object.keys(updates).length > 0) {
      await db.task.update({ where: { id: tid }, data: updates })
      console.log(`[B] task ${tid} updated`)
    } else {
      console.log(`[B] task ${tid} no changes needed`)
    }
  }

  // ---- 验证: 重读规则确认 ----
  const r2 = await db.rule.findUnique({ where: { id: TOPLIST_RULE_ID } })
  const cfg2 = JSON.parse(r2!.config)
  console.log('\n=== verify rule ===')
  console.log('toc.tocLink:', JSON.stringify(cfg2.toc.tocLink))
  console.log('toc.itemSelector:', JSON.stringify(cfg2.toc.itemSelector))
  console.log('list.fields.bookUrl:', JSON.stringify(cfg2.list.fields.bookUrl))

  // ---- 验证: 重读 task 确认 bookUrl ----
  console.log('\n=== verify tasks ===')
  for (const tid of BAD_TASK_IDS) {
    const t = await db.task.findUnique({ where: { id: tid }, select: { id: true, bookUrl: true, progress: true } })
    if (!t) continue
    let discBad = 0
    try {
      const p = JSON.parse(t.progress || '{}')
      if (Array.isArray(p.discoveredBookUrls)) {
        discBad = p.discoveredBookUrls.filter((u: string) => /\/txt\/\d+\.html/.test(u)).length
      }
    } catch {}
    const bookUrlBad = t.bookUrl ? /\/txt\/\d+\.html/.test(t.bookUrl) : false
    console.log(`  ${tid}: bookUrl=${t.bookUrl || '(empty)'} badBookUrl=${bookUrlBad} discBad=${discBad}`)
  }

  await db.$disconnect()
  console.log('\n✅ Done')
}

main().catch(e => { console.error(e); process.exit(1) })
