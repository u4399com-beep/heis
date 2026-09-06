// ============================================================
// Task ee-d 验证脚本⑥ — 章节 HTTP 超时(AbortError)被当"任务中止"静默吞掉
// 场景: 单本任务, 6 章全部 stall 30s, 规则 engine=http + timeout=2000 + retries=0,
//       线程 1 → 每章 2s 超时(bun fetch AbortController abort → AbortError)。
//       runner 的 AbortError 豁免原语义 = "stop/换代造成的在途中止不计失败"(x-a),
//       但当前快照 stop 根本不中止在途请求(TaskRuntime.abortControllers 声明后从未
//       使用, 注释里的 abortAll 不存在) —— 实际唯一 AbortError 来源就是 fetch 超时:
//       修前: 章节超时零日志/不计 stats.errors/gateFetch 不喂 reportHostFailure
//             (慢站对 hostGate 降额链完全不可见), 任务"成功完成"0章无任何痕迹;
//             与列表页路径(超时计 errors+日志)和浏览器链(TimeoutError 计 errors)双重不一致
//       修后: fetchHttp 超时抛错带 isFetchTimeout 标记 → runner 分类为源站超时:
//             每章 error 日志含"超时" + stats.errors===6 + 连败3次触发降额(1条 info 日志)
// 断言: errors 计数/日志可见性/降额联动/章节保持未采(增量重试语义不变)
// 运行: bun scripts/verify-ee-d-timeout.ts (真实 TaskRunner + 真实 DB, 结束清理还原)
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

// ---------------- mock: 书籍页快速 + 6 个 stall 30s 的章节页 ----------------
const PORT = 3380
const BASE = `http://127.0.0.1:${PORT}`
const STALL_MS = 30_000

const server = http.createServer((req, res) => {
  res.on('error', () => {})
  const u = new URL(req.url || '/', BASE)
  const reply = (html: string) => {
    try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) } catch { /* 客户端已超时断开 */ }
  }
  if (u.pathname === '/book') {
    const toc = Array.from({ length: 6 }, (_, i) => `<li><a href="/c${i + 1}">第${i + 1}章 超时测试</a></li>`).join('')
    return reply(`<html><head><title>超时可见性验证书</title></head><body>
      <h1 id="name">超时可见性验证书</h1><div id="author">测试作者</div>
      <div id="intro">用于验证章节 HTTP 超时在 runner 侧分类可见性的测试书。</div>
      <ul id="toc">${toc}</ul></body></html>`)
  }
  const m = u.pathname.match(/^\/c(\d)$/)
  if (m) return setTimeout(() => reply(`<html><body><div id="content">第${m[1]}章正文。${'慢响应占位文本。'.repeat(50)}</div></body></html>`), STALL_MS)
  reply('<html><body>index</body></html>')
})
server.on('clientError', (_e: any, s: any) => { try { s.end() } catch { /* ignore */ } })
await new Promise<void>((r) => server.listen(PORT, () => r()))

const { db } = await import('../src/lib/db')
const { TaskRunner } = await import('../src/lib/crawl/runner')

const RULE_NAME = `eed-超时可见性验证-${Date.now()}`
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
  fetch: { engine: 'http', uaMode: 'rotate', timeout: 2000, retries: 0, hostGateLimit: 3, autoCookie: true, referer: true },
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
    await sleep(600)
  }
  return 'timeout'
}

try {
  const rule = await db.rule.create({ data: { name: RULE_NAME, description: 'ee-d 超时可见性验证用', config: JSON.stringify(ruleConfig), enabled: true } })
  ruleId = rule.id
  const task = await db.task.create({
    data: {
      name: 'eed-超时可见性验证任务',
      ruleId, mode: 'single', bookUrl: BOOK_URL,
      recrawlMode: 'incremental', storageMode: 'db',
      threadMin: 1, threadMax: 1, intervalMin: 100, intervalMax: 200,
      smartCategory: false, smartComplete: false, autoSuggest: false,
      status: 'pending',
    },
  })
  taskId = task.id

  console.log('\n== 场景: 6章全部 30s stall × 规则 timeout=2s × 单线程 → 6次章节超时 ==')
  const start = await TaskRunner.instance.control(taskId, 'start')
  ok('任务启动成功', start.ok, start.message)
  const st = await waitTaskDone(90_000)
  ok('任务正常结束', st === 'done', `status=${st}`)

  const bk = await db.book.findFirst({ where: { sourceUrl: BOOK_URL } })
  bookId = bk?.id || ''
  const chs = bookId ? await db.chapter.findMany({ where: { bookId }, orderBy: { idx: 'asc' } }) : []
  ok('6 章目录入库', chs.length === 6, `count=${chs.length}`)
  ok('0 章误采(超时章保持 fetched=false 供增量重试)', chs.every((c) => !c.fetched && !c.content), chs.map((c) => `${c.title}:${c.fetched}`).join(','))

  const t = await db.task.findUnique({ where: { id: taskId } })
  const stats = JSON.parse(t?.stats || '{}')
  ok('【核心】stats.errors===6(超时计入失败, 与列表页/浏览器链口径一致)', stats.errors === 6, `errors=${stats.errors}`)

  const logs = await db.taskLog.findMany({ where: { taskId }, orderBy: { id: 'asc' } })
  const timeoutErrs = logs.filter((l) => l.level === 'error' && l.message.includes('超时'))
  ok('【核心】6 条章节级超时 error 日志(可见性, 修前为 0 条)', timeoutErrs.length === 6, `count=${timeoutErrs.length}`)
  ok('超时日志含章节定位(章节名+URL 信息)', timeoutErrs.every((l) => l.message.includes('章节失败')), timeoutErrs[0]?.message.slice(0, 100))
  const derates = logs.filter((l) => l.level === 'info' && l.message.includes('并发上限降至2'))
  ok('【核心】超时喂入 hostGate 降额链: 3连败触发降额 3→2 恰 1 次(60s 冷却)', derates.length === 1, `count=${derates.length}`)
  ok('无 HostGateTimeout 误分类(非闸门超时场景)', !logs.some((l) => l.message.includes('同站并发闸门等待超时')))
  ok('无任务崩溃 error', !logs.some((l) => l.message.includes('任务崩溃')))
} catch (e: any) {
  fail++
  console.log(`  ✗ 脚本异常: ${e?.stack?.slice(0, 500) || e}`)
} finally {
  try {
    if (taskId) await db.taskLog.deleteMany({ where: { taskId } })
    if (taskId) await db.task.delete({ where: { id: taskId } }).catch(() => {})
    if (bookId) await db.book.delete({ where: { id: bookId } }).catch(() => {})
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
