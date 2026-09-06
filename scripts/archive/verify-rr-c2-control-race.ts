// ============================================================
// verify-rr-c2-control-race.ts — rr-c2 断言: control 每 task 串行化(状态写乱序修复)
//
// 根因(探针 probe-rr-c2-control-race 20轮3轮实锤): 并发 control(stop)+control(start) 的
//   db.task.update 状态写不保证调用序提交(SQLite 连接池/busy 重试非FIFO) → update('stopped')
//   晚于 update('running') 落库 → 新一轮循环批次头 live.status==='stopped' 守卫自杀,
//   任务卡 stopped(verify-ll-c-runner Part4 21/4 的根因)。
// 修法: runner.control 拆 wrapper+controlInner, 每 task promise 链串行化(入队=调用时刻,
//   同步先于任何 await), 状态写调用序=提交序。
//
// 断言:
//   1. 静态源码: 串行化 wrapper 在场(链/入队/吞错/尾自删四要素)
//   2. e2e×12 轮(真实 runner+DB, 建删还原): start→并发 stop+start 压窗 →
//      每轮最终 status=done 且 6 章入库 且 恰1条完成日志(守卫自杀/双循环都过不了这关)
// DB 纪律: 只建本断言自有 rule/task 行(前缀 rrc2-verify-); cleanup 全部精确 id /
//   探针专属随机端口 sourceUrl; 无任何无 scope findFirst/delete。
// ============================================================
import http from 'http'
import { readFileSync } from 'fs'

export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- Part 1: 静态源码断言 ----------------
console.log('\n== 1. control 每 task 串行化(静态源码断言) ==')
{
  const src = readFileSync('src/lib/crawl/runner.ts', 'utf8')
  ok('control wrapper 在场(委托 controlInner)', /async control\(taskId: string, action: ControlAction\)/.test(src) && /prev\.then\(\(\) => this\.controlInner\(taskId, action\)\)/.test(src))
  ok('入队时机=调用时刻(同步, 先于任何 await)', /const prev = this\.controlChains\.get\(taskId\) \?\? Promise\.resolve\(\)/.test(src))
  ok('链上吞错(单次失败不阻断后续)', /const tail = run\.catch\(\(\) => \{\}\)/.test(src))
  ok('尾 settles 自删 Map 项(防长任务无界增长)', /controlChains\.get\(taskId\) === tail\) this\.controlChains\.delete\(taskId\)/.test(src))
  ok('原 control 主体迁移为 controlInner(非删除)', src.indexOf('private async controlInner(taskId') > 0 && src.indexOf('case \'stop\': {') > src.indexOf('private async controlInner(taskId'))
}

// ---------------- mock 服务 ----------------
const server = http.createServer((req, res) => {
  const p = new URL(req.url || '/', 'http://x').pathname
  if (p === '/book') {
    const toc = Array.from({ length: 6 }, (_, i) => `<li><a href="/c${i + 1}">第${i + 1}章 测试</a></li>`).join('')
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<html><body><h1 id="name">rrc2串行化验证书</h1><div id="author">测试作者</div><div id="intro">用于验证 control 串行化的测试书。</div><ul id="toc">${toc}</ul></body></html>`)
    } catch { /* ignore */ }
    return
  }
  const m = p.match(/^\/c(\d)$/)
  if (m) {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<html><body><div id="content">《第${m[1]}章》正文。${'段落测试文本，用于验证链路。'.repeat(40)}</div></body></html>`)
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
    fields: { title: { type: 'css', expression: 'a', attr: 'text' }, url: { type: 'css', expression: 'a', attr: 'href' } },
    pagination: { enabled: false, maxPages: 1 },
  },
  content: { enabled: true, fields: { content: { type: 'css', expression: '#content', attr: 'html' } }, pagination: { enabled: false, maxPages: 1 } },
  clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: true },
  fetch: { engine: 'http', uaMode: 'rotate', timeout: 20000, retries: 0, hostGateLimit: 3, autoCookie: true, referer: true },
}

console.log('\n== 2. e2e×12: start→并发 stop+start 压窗, 每轮必须真正完成 ==')
const rule = await db.rule.create({
  data: { name: `rrc2-verify-control-${Date.now()}`, description: 'rr-c2 control 串行化断言', config: JSON.stringify(ruleCfg), enabled: true },
})

const ROUNDS = 12
for (let round = 1; round <= ROUNDS; round++) {
  const task = await db.task.create({
    data: { name: `rrc2-verify-control-${round}`, ruleId: rule.id, mode: 'single', bookUrl, recrawlMode: 'incremental', storageMode: 'db', threadMin: 3, threadMax: 3, intervalMin: 50, intervalMax: 100, smartCategory: false, smartComplete: false, autoSuggest: false, status: 'pending' },
  })
  const id = task.id
  try {
    const s1 = await runner.control(id, 'start')
    // 与 verify-ll-c-runner Part4 同型压窗: stop 与 start#2 并发发出, 且各轮已由上一轮预热 DB 写负载
    const spP = runner.control(id, 'stop')
    const s2P = runner.control(id, 'start')
    const [spRes, s2Res] = await Promise.all([spP, s2P])
    let done = false
    const t0 = Date.now()
    while (Date.now() - t0 < 20_000) {
      const t = await db.task.findUnique({ where: { id }, select: { status: true } })
      if (t?.status === 'done') { done = true; break }
      await sleep(150)
    }
    const bk = await db.book.findFirst({ where: { sourceUrl: bookUrl } })
    const fetched = bk ? await db.chapter.count({ where: { bookId: bk.id, fetched: true } }) : 0
    const logs = await db.taskLog.findMany({ where: { taskId: id }, orderBy: { id: 'asc' } })
    const dones = logs.filter((l) => l.message.includes('✅ 任务完成')).length
    const starts = logs.filter((l) => l.message.startsWith('▶ 任务启动')).length
    ok(
      `R${round} 压窗后真正完成(done+6章+恰1完成日志)`,
      done && fetched >= 6 && dones === 1 && spRes.ok && s2Res.ok && starts === 2,
      `status=${done ? 'done' : '超时'} fetched=${fetched} dones=${dones} starts=${starts}`,
    )
  } finally {
    await runner.control(id, 'stop').catch(() => {})
    await db.task.delete({ where: { id } }).catch(() => {})
  }
}

// cleanup(精确 scope): 断言专属 mock 随机端口 sourceUrl(章级行 onDelete: Cascade)
await db.book.deleteMany({ where: { sourceUrl: bookUrl } })
await db.rule.delete({ where: { id: rule.id } })
server.closeAllConnections?.()
server.close()

console.log(`\n===== verify-rr-c2-control-race: ${pass} pass / ${fail} fail =====`)
process.exit(fail ? 1 : 0)
