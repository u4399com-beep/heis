// ============================================================
// Task bb-d 验证脚本2 — HostGateTimeout 分类(runner 真实链路)
// 场景: 本地 mock 站, 规则 hostGateLimit=1 + 任务3线程 → 章节批次 3 章同抓,
//       1 章持槽(mock 35s 慢响应), 另 2 章在闸门排队 30s 超时抛 HostGateTimeout
//       (目录故意给 6 章: 避开 runner 的 toc<5 浏览器重取旁路, 保持验证纯粹;
//        3线程×limit1 → 每批次 1 章持槽成功 + 2 章超时, 两批次合计 4 warn/2 成功/4 未采)
// 断言: (1) 日志分类正确 — 4 条 warn 级"同站并发闸门等待超时"(含 host+可恢复语义),
//           0 条 error 级章节失败日志, stats.errors=0
//       (2) 章节状态不受污染 — 4 章保持 fetched=false(未采集), 持槽的 2 章正常入库
//       (3) "稍后增量重试可恢复" — mock 改快后增量重跑, 4 章补齐 fetched=true
// 运行: bun scripts/verify-bb-d-2.ts (直接起真实 TaskRunner, 全程真实 DB)
// ============================================================
import http from 'http'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- mock: 书籍页(内嵌6章目录) + 6 个章节页 ----------------
const PORT = 3342
const BASE = `http://127.0.0.1:${PORT}`
const STALL_MS = 35_000
const state = { fast: false }

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', BASE)
  const reply = (html: string) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  }
  if (u.pathname === '/book') {
    return reply(`<html><head><title>闸门超时测试书</title></head><body>
      <h1 id="name">闸门超时测试书</h1><div id="author">测试作者</div>
      <div id="intro">这是一本用于验证 HostGateTimeout 分类的测试书。</div>
      <ul id="toc"><li><a href="/c1">第1章 甲</a></li><li><a href="/c2">第2章 乙</a></li><li><a href="/c3">第3章 丙</a></li><li><a href="/c4">第4章 丁</a></li><li><a href="/c5">第5章 戊</a></li><li><a href="/c6">第6章 己</a></li></ul>
      </body></html>`)
  }
  if (u.pathname.startsWith('/c')) {
    const stall = state.fast ? 80 : STALL_MS
    return setTimeout(() => reply(`<html><body><div id="content">《${u.pathname}》正文内容。${'段落测试文本。'.repeat(80)}</div></body></html>`), stall)
  }
  reply('<html><body>index</body></html>')
})
await new Promise<void>((r) => server.listen(PORT, () => r()))

const { db } = await import('../src/lib/db')
const { TaskRunner } = await import('../src/lib/crawl/runner')

const RULE_NAME = `bbd2-闸门超时分类验证-${Date.now()}`
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
  fetch: { engine: 'http', uaMode: 'rotate', timeout: 60000, retries: 0, hostGateLimit: 1, autoCookie: true, referer: true },
  clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: true },
}

let ruleId = ''
let taskId = ''
let bookId = ''

async function waitTaskDone(timeoutMs: number): Promise<string> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const t = await db.task.findUnique({ where: { id: taskId } })
    if (t && t.status !== 'running') return t.status
    await sleep(700)
  }
  // 诊断: 超时未结束时打印尾部日志与进度快照
  const logs = await db.taskLog.findMany({ where: { taskId }, orderBy: { id: 'desc' }, take: 5 })
  const t = await db.task.findUnique({ where: { id: taskId } })
  console.log('  [诊断] 状态:', t?.status, 'progress:', (t?.progress || '').slice(0, 200))
  for (const l of logs.reverse()) console.log('  [诊断] 尾部日志:', l.level, l.message.slice(0, 100))
  return 'timeout'
}

try {
  // ---------- 造数据 ----------
  const rule = await db.rule.create({ data: { name: RULE_NAME, description: 'bb-d 验证用', config: JSON.stringify(ruleConfig), enabled: true } })
  ruleId = rule.id
  const task = await db.task.create({
    data: {
      name: 'bbd2-闸门超时分类验证任务',
      ruleId, mode: 'single', bookUrl: BOOK_URL,
      recrawlMode: 'incremental', storageMode: 'db',
      threadMin: 3, threadMax: 3, intervalMin: 500, intervalMax: 500,
      smartCategory: false, smartComplete: false, autoSuggest: false,
      status: 'pending',
    },
  })
  taskId = task.id

  // ---------- 第1轮: 槽满场景(3线程 × hostGateLimit=1, c1 慢 35s) ----------
  console.log('\n== 第1轮: 3线程 × hostGateLimit=1 × 章节35s慢响应 → 预期2章 HostGateTimeout ==')
  const start = await TaskRunner.instance.control(taskId, 'start')
  ok('任务启动成功', start.ok, start.message)
  const st1 = await waitTaskDone(90_000)
  ok('第1轮任务正常结束(非 error/timeout)', st1 === 'done', `status=${st1}`)

  const logs1 = await db.taskLog.findMany({ where: { taskId }, orderBy: { id: 'asc' } })
  const gateWarns = logs1.filter((l) => l.level === 'warn' && l.message.includes('同站并发闸门等待超时'))
  const errLogs = logs1.filter((l) => l.level === 'error')
  ok('4 条 HostGateTimeout warn 级日志(两批次×每批2章超时)', gateWarns.length === 4, `count=${gateWarns.length}`)
  ok('warn 日志含 host 标识(127.0.0.1:3342)', gateWarns.every((l) => l.message.includes('127.0.0.1:3342')), gateWarns[0]?.message.slice(0, 120))
  ok('warn 日志含"稍后增量重试可恢复"语义', gateWarns.every((l) => l.message.includes('稍后增量重试可恢复')))
  ok('0 条 error 级日志(HostGateTimeout 不再按普通章节失败计 errors)', errLogs.length === 0, errLogs.map((l) => l.message.slice(0, 80)).join(' | '))
  const task1 = await db.task.findUnique({ where: { id: taskId } })
  const stats1 = JSON.parse(task1?.stats || '{}')
  ok('stats.errors === 0(章节状态不污染计账)', stats1.errors === 0, `errors=${stats1.errors}`)
  const chapters = await db.chapter.findMany({ where: { bookId: { not: '' } }, orderBy: { idx: 'asc' } })
  const bk = await db.book.findFirst({ where: { sourceUrl: BOOK_URL } })
  bookId = bk!.id
  const chs = await db.chapter.findMany({ where: { bookId }, orderBy: { idx: 'asc' } })
  ok('6 章目录入库', chs.length === 6, `count=${chs.length}`)
  const fetchedChs = chs.filter((c) => c.fetched)
  const unfetchedChs = chs.filter((c) => !c.fetched)
  ok('恰好 2 章采集成功入库(两批次的持槽章)', fetchedChs.length === 2, `fetched=${fetchedChs.map((c) => c.title).join(',')}`)
  ok('成功章正文已入库(wordCount>0)', fetchedChs.every((c) => c.wordCount > 0), `wordCounts=${fetchedChs.map((c) => c.wordCount).join(',')}`)
  ok('4 章保持未采集(fetched=false, 状态未污染)', unfetchedChs.length === 4, unfetchedChs.map((c) => c.title).join(','))
  ok('未采集章 url 保留(增量重试可定位)', unfetchedChs.every((c) => c.url.startsWith(BASE)))
  ok('超时章没有误存脏正文', unfetchedChs.every((c) => !c.content && !c.filePath))

  // ---------- 第2轮: mock 改快 → 增量重跑补齐("稍后增量重试可恢复") ----------
  console.log('\n== 第2轮: mock 改快响应, 增量重跑 → 4 个未采集章补齐 ==')
  state.fast = true
  const start2 = await TaskRunner.instance.control(taskId, 'start')
  ok('第2轮启动成功', start2.ok, start2.message)
  const st2 = await waitTaskDone(60_000)
  ok('第2轮任务正常结束', st2 === 'done', `status=${st2}`)
  const chs2 = await db.chapter.findMany({ where: { bookId }, orderBy: { idx: 'asc' } })
  ok('增量重跑后 6 章全部 fetched=true', chs2.every((c) => c.fetched), chs2.map((c) => `${c.title}:${c.fetched}`).join(','))
  const logs2 = await db.taskLog.findMany({ where: { taskId }, orderBy: { id: 'asc' } })
  ok('第2轮无新增 HostGateTimeout 日志(仍为第1轮的 4 条)', logs2.filter((l) => l.message.includes('同站并发闸门等待超时')).length === 4)
  ok('第2轮全程 0 error 日志', logs2.filter((l) => l.level === 'error').length === 0)
} catch (e: any) {
  fail++
  console.log(`  ✗ 脚本异常: ${e?.stack?.slice(0, 500) || e}`)
} finally {
  // ---------- 清理还原 DB ----------
  try {
    if (taskId) await db.taskLog.deleteMany({ where: { taskId } })
    if (taskId) await db.task.delete({ where: { id: taskId } }).catch(() => {})
    if (bookId) await db.book.delete({ where: { id: bookId } }).catch(() => {}) // 章节 Cascade
    if (ruleId) await db.rule.delete({ where: { id: ruleId } }).catch(() => {})
    console.log('\n清理完成: 任务/日志/书籍/章节/规则已删除还原')
  } catch (e: any) {
    console.log('清理异常:', e?.message)
  }
  server.close()
  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
  process.exit(fail ? 1 : 0)
}

export {}
