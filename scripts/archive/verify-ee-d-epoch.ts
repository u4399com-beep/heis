// ============================================================
// Task ee-d 验证脚本⑤ — 停止后立刻重启: 旧循环收尾误标任务 done
// 场景: 单本任务, /book 每次请求 stall 4s(章节快速)。
//   t0      control(start) → 第1轮(epoch=1), 卡在书籍页 fetch
//   t0+0.7s control(stop)  → status=stopped(rt.stopped=true)
//   t0+1.0s control(start) → 第2轮(epoch=2, rt.stopped 重置为 false, status=running)
//   t0+4.05s 第1轮书籍页 fetch 返回 → 各检查点因 epoch 漂移 break → 走到 executeTask
//            【结束块】—— 该块无 isStale 防护, 且 rt.stopped 已被新一轮重置为 false:
//            修前: 写 "✅ 任务完成" 日志 + status='done'(此刻第2轮书籍页还在 stall, 约再 1s
//                  后才返回) —— 运行中任务被旧循环误标完成。
//   t0+5.1s 第2轮正常完成(书籍页→目录→6章) → status='done'(再次)
// 断言(日志按 cuid 单调序): 第2次"任务启动"之后、第2轮首条"书籍页:"日志之前,
//   不得出现"✅ 任务完成"日志; 全程恰 1 条"任务完成"; 第2轮健康收尾(6章全采)。
//   修前: 存在早于第2轮"书籍页"的"任务完成"日志(FAIL) → 修后: 无(PASS)
// 运行: bun scripts/verify-ee-d-epoch.ts (真实 TaskRunner + 真实 DB, 结束清理还原)
// ============================================================
import http from 'http'

export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- mock: 书籍页(内嵌6章目录, 每次请求 stall 4s) + 6 个快速章节页 ----------------
const PORT = 3379
const BASE = `http://127.0.0.1:${PORT}`
const BOOK_STALL_MS = 4000

const chapterHtml = (n: number) =>
  `<html><body><div id="content">《第${n}章》正文内容。${'段落测试文本，用于验证。'.repeat(40)}</div></body></html>`

const server = http.createServer((req, res) => {
  res.on('error', () => {})
  const u = new URL(req.url || '/', BASE)
  const reply = (html: string) => {
    try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) } catch { /* 客户端已断开 */ }
  }
  if (u.pathname === '/book') {
    const toc = Array.from({ length: 6 }, (_, i) => `<li><a href="/c${i + 1}">第${i + 1}章 测试</a></li>`).join('')
    return setTimeout(() => reply(`<html><head><title>换代收尾验证书</title></head><body>
      <h1 id="name">换代收尾验证书</h1><div id="author">测试作者</div>
      <div id="intro">用于验证停止后立刻重启时旧循环收尾语义的测试书。</div>
      <ul id="toc">${toc}</ul></body></html>`), BOOK_STALL_MS)
  }
  const m = u.pathname.match(/^\/c(\d)$/)
  if (m) return reply(chapterHtml(Number(m[1])))
  reply('<html><body>index</body></html>')
})
server.on('clientError', (_e: any, s: any) => { try { s.end() } catch { /* ignore */ } })
await new Promise<void>((r) => server.listen(PORT, () => r()))

const { db } = await import('../src/lib/db')
const { TaskRunner } = await import('../src/lib/crawl/runner')

const RULE_NAME = `eed-换代收尾验证-${Date.now()}`
const BOOK_URL = `${BASE}/book`
const ruleConfig = {
  list: { enabled: true, urlTemplate: '', fields: {} },
  book: {
    enabled: true,
    fields: {
      name: { type: 'css', expression: '#name', attr: 'text' },
      author: { type: 'css', expression: '#author', attr: 'text' },
      intro: { type: 'css', expression: '#intro', attr: 'html' },
    },
  },
  toc: {
    enabled: true,
    itemSelector: { type: 'css', expression: 'ul#toc > li' },
    fields: {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: { content: { type: 'css', expression: '#content', attr: 'html' } },
    pagination: { enabled: false, maxPages: 1 },
  },
  fetch: { engine: 'http', uaMode: 'rotate', timeout: 20000, retries: 0, hostGateLimit: 3, autoCookie: true, referer: true },
  clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: true },
}

let ruleId = ''
let taskId = ''
let bookId = ''

try {
  const rule = await db.rule.create({ data: { name: RULE_NAME, description: 'ee-d 换代收尾验证用', config: JSON.stringify(ruleConfig), enabled: true } })
  ruleId = rule.id
  const task = await db.task.create({
    data: {
      name: 'eed-换代收尾验证任务',
      ruleId, mode: 'single', bookUrl: BOOK_URL,
      recrawlMode: 'incremental', storageMode: 'db',
      threadMin: 3, threadMax: 3, intervalMin: 100, intervalMax: 200,
      smartCategory: false, smartComplete: false, autoSuggest: false,
      status: 'pending',
    },
  })
  taskId = task.id

  console.log('\n== 时序: start → +0.7s stop → +0.3s start(第2轮) → 第1轮书籍页(4s stall)返回时第2轮仍在书籍页 ==')
  const t0 = Date.now()
  const s1 = await TaskRunner.instance.control(taskId, 'start')
  ok('第1轮启动成功', s1.ok, s1.message)
  await sleep(700)
  const sp = await TaskRunner.instance.control(taskId, 'stop')
  ok('stop 指令成功', sp.ok, sp.message)
  await sleep(300)
  const s2 = await TaskRunner.instance.control(taskId, 'start')
  ok('第2轮启动成功(停止后立刻重启)', s2.ok, s2.message)

  // 等待真正完成: status=done 且第2轮已采到 ≥3 章(排除旧循环"提前 done"的假完成: 那一刻 fetched=0)
  const t1 = Date.now()
  let reallyDone = false
  while (Date.now() - t1 < 60_000) {
    const t = await db.task.findUnique({ where: { id: taskId } })
    const bk = await db.book.findFirst({ where: { sourceUrl: BOOK_URL } })
    const fetched = bk ? await db.chapter.count({ where: { bookId: bk.id, fetched: true } }) : 0
    if (t?.status === 'done' && fetched >= 6) { reallyDone = true; if (bk) bookId = bk.id; break }
    await sleep(500)
  }
  ok('第2轮真正完成(done 且 6 章入库)', reallyDone, `耗时${Date.now() - t1}ms bookId=${bookId}`)
  await sleep(800) // 收尾日志落库稳定窗口

  // ---------- 日志时序断言 ----------
  const logs = await db.taskLog.findMany({ where: { taskId }, orderBy: { id: 'asc' } })
  console.log('  ---- 日志序列(诊断) ----')
  for (const l of logs) console.log(`    ${l.level} ${l.message.slice(0, 80)}`)
  const starts = logs.filter((l) => l.message.startsWith('▶ 任务启动'))
  const dones = logs.filter((l) => l.message.includes('✅ 任务完成'))
  const bookPages = logs.filter((l) => l.message.startsWith('书籍页:'))
  ok('恰 2 条任务启动日志(两轮各一)', starts.length === 2, `count=${starts.length}`)
  // 注: 旧循环的书籍页日志(其 4s fetch 在第2轮期间返回)与第2轮的书籍页日志都在,
  // 不能取"第2次启动后的首条书籍页"当第2轮标志 —— 用"最后一条书籍页"作第2轮标志:
  // 修后语义 = 全部书籍页(两轮的)都先于唯一的"任务完成"; 修前旧循环会在第2轮书籍页
  // 之前写"任务完成"(即存在晚于首条"任务完成"的书籍页日志)
  const lastBookPage = bookPages[bookPages.length - 1]
  const firstDone = dones[0]
  ok(
    '【核心】无旧循环伪造的"任务完成"(全部书籍页日志须早于首条"任务完成")',
    !!lastBookPage && !!firstDone && lastBookPage.id < firstDone.id,
    `lastBookPage=${lastBookPage?.message.slice(0, 60)} firstDone=${firstDone?.message.slice(0, 60)}`
  )
  ok('全程恰 1 条"任务完成"日志', dones.length === 1, `count=${dones.length}`)
  if (dones.length === 1 && lastBookPage) ok('"任务完成"位于最后一条书籍页之后(真实收尾序)', dones[0].id > lastBookPage.id)

  // ---------- 第2轮健康收尾 ----------
  const t = await db.task.findUnique({ where: { id: taskId } })
  ok('最终任务状态 done', t?.status === 'done', `status=${t?.status}`)
  const chs = bookId ? await db.chapter.findMany({ where: { bookId }, orderBy: { idx: 'asc' } }) : []
  ok('6 章全部入库且采集完成(第2轮健康收尾)', chs.length === 6 && chs.every((c) => c.fetched), chs.map((c) => `${c.title}:${c.fetched}`).join(','))
  ok('章节正文非空', chs.every((c) => (c.wordCount || 0) > 0))
} catch (e: any) {
  fail++
  console.log(`  ✗ 脚本异常: ${e?.stack?.slice(0, 500) || e}`)
} finally {
  try {
    if (taskId) await db.taskLog.deleteMany({ where: { taskId } })
    if (taskId) await db.task.delete({ where: { id: taskId } }).catch(() => {})
    if (bookId) await db.book.delete({ where: { id: bookId } }).catch(() => {})
    const bk2 = await db.book.findFirst({ where: { sourceUrl: BOOK_URL } })
    if (bk2) await db.book.delete({ where: { id: bk2.id } }).catch(() => {})
    if (ruleId) await db.rule.delete({ where: { id: ruleId } }).catch(() => {})
    console.log('\n清理完成: 任务/日志/书籍/章节/规则已删除还原')
  } catch (e: any) {
    console.log('清理异常:', e?.message)
  }
  server.closeAllConnections?.()
  server.close()
  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
  process.exit(fail ? 1 : 0)
}
