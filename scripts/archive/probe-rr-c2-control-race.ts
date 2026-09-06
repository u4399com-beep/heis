// ============================================================
// probe-rr-c2-control-race.ts — rr-c2 探针: control(stop/start) 并发 DB 状态写乱序实证
//
// 背景: verify-ll-c-runner.ts Part4(stop→立刻start压窗) 连续 21/4 失败:
//   症状 = 恰2条启动日志 + 0条完成日志 + 书籍页日志仅1条 + 最终 status=stopped。
//   唯一自洽解释: control('stop') 的 update(status='stopped') 与 control('start') 的
//   update(status='running') 并发在途, 前者发出更早却【后提交】(SQLite busy 重试/连接池
//   非FIFO) → 新循环 executeTask#2 批次头 live.status==='stopped' 守卫自杀 → 任务卡 stopped。
//   本探针高频轮询 status 迁移序列直接捕获该乱序。
//
// DB 纪律: 只建本探针自有 rule/task 行(名字前缀 rr-c2-probe-); cleanup 全部按【精确 id /
// 探针专属随机端口 sourceUrl】删除; 无任何无 scope findFirst/delete。
// ============================================================
import http from 'http'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// mock 源站: /book 立即返回(与 verify-ll-c-runner 同型, executeTask#2 在竞态后 ~50-150ms
// 即抵达批次头守卫), /cN 立即返回章节; 6 章与 verify Part4 同量级
const server = http.createServer((req, res) => {
  const p = new URL(req.url || '/', 'http://x').pathname
  if (p === '/book') {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<html><body><h1 id="name">rrc2竞态探针书</h1>
        <ul id="toc">${Array.from({ length: 6 }, (_, i) => `<li><a href="/c${i + 1}">第${i + 1}章 测试</a></li>`).join('')}</ul>
        </body></html>`)
    } catch { /* ignore */ }
    return
  }
  const m = p.match(/^\/c(\d)$/)
  if (m) {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<html><body><div id="content">第${m[1]}章正文。${'内容测试'.repeat(30)}</div></body></html>`)
    } catch { /* ignore */ }
    return
  }
  try { res.writeHead(404); res.end('nf') } catch { /* ignore */ }
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
const port = (server.address() as { port: number }).port
const BASE = `http://127.0.0.1:${port}`
const bookUrl = `${BASE}/book`

const { db } = await import('../src/lib/db')
const { TaskRunner } = await import('../src/lib/crawl/runner')
const runner = TaskRunner.instance

const ruleCfg = {
  list: { enabled: true, urlTemplate: '', fields: {} },
  book: { enabled: true, fields: { name: { type: 'css', expression: '#name', attr: 'text' } } },
  toc: {
    enabled: true,
    itemSelector: { type: 'css', expression: 'ul#toc > li' },
    fields: { title: { type: 'css', expression: 'a', attr: 'text' }, url: { type: 'css', expression: 'a', attr: 'href' } },
    pagination: { enabled: false, maxPages: 1 },
  },
  content: { enabled: true, fields: { content: { type: 'css', expression: '#content', attr: 'html' } }, pagination: { enabled: false, maxPages: 1 } },
  clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: true },
  fetch: { engine: 'http', uaMode: 'desktop', timeout: 15000, retries: 0, hostGateLimit: 3, autoCookie: true, referer: false },
}

const rule = await db.rule.create({
  data: { name: `rr-c2-probe-race-${Date.now()}`, description: 'rr-c2 control 写序探针(用完即删)', config: JSON.stringify(ruleCfg), enabled: true },
})

const ROUNDS = 20
const buggyRounds: string[] = []
for (let round = 1; round <= ROUNDS; round++) {
  const task = await db.task.create({
    data: { name: `rr-c2-probe-race-${round}`, ruleId: rule.id, mode: 'single', bookUrl, recrawlMode: 'incremental', storageMode: 'db', threadMin: 3, threadMax: 3, intervalMin: 50, intervalMax: 100, smartCategory: false, smartComplete: false, autoSuggest: false, status: 'pending' },
  })
  const id = task.id
  try {
    const s1 = await runner.control(id, 'start')
    if (!s1.ok) { console.log(`R${round}: start#1 意外失败 ${s1.message}`); continue }
    // 压窗: 与 verify-ll-c-runner Part4 完全同型 —— stop 与 start#2 并发发出
    const spP = runner.control(id, 'stop')
    const s2P = runner.control(id, 'start')
    const [spRes, s2Res] = await Promise.all([spP, s2P])
    // 高频轮询 status 迁移序列(~2-5ms 粒度, 覆盖 3s: 章节采集+收尾)
    const seq: { t: number; s: string }[] = []
    let last = ''
    const t0 = Date.now()
    while (Date.now() - t0 < 3000) {
      const t = await db.task.findUnique({ where: { id }, select: { status: true } })
      if (t && t.status !== last) { last = t.status; seq.push({ t: Date.now() - t0, s: t.status }) }
      await sleep(2)
    }
    const finalStatus = last
    // 判定: 正常轮最终=done(第2轮6章采完); 乱序轮最终=stopped(守卫自杀, 第2轮被迟到停止写杀死)
    const reordered = finalStatus === 'stopped' && s2Res.ok
    if (reordered) buggyRounds.push(`R${round}`)
    console.log(`R${round}: stop=${spRes.message} start2=${s2Res.message} final=${finalStatus} seq=${JSON.stringify(seq)}${reordered ? '  ←★乱序实锤' : ''}`)
  } finally {
    await runner.control(id, 'stop').catch(() => {})
    await db.task.delete({ where: { id } }).catch(() => {})
  }
}

// cleanup(全部精确 scope): 本探针 mock 随机端口 sourceUrl 的书(章级行 onDelete: Cascade)
await db.book.deleteMany({ where: { sourceUrl: bookUrl } })
await db.taskLog.deleteMany({ where: { task: { ruleId: rule.id } } })
await db.rule.delete({ where: { id: rule.id } })
server.closeAllConnections?.()
server.close()

console.log(`\n===== 探针结论: ${ROUNDS} 轮中乱序复现 ${buggyRounds.length} 轮 =====`)
for (const b of buggyRounds) console.log('  ' + b)
process.exit(0)
