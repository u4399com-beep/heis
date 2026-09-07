// ============================================================
// verify-mm-b-hostgate.ts — mm-b 反反爬增强: 浏览器类桥模式 hostGateLimit 自动钳制
//   背景: scrapling 桥对 stealthy/playwright 有全局 BoundedSemaphore(3)(server.py),
//   引擎 hostGateLimit>3 时多余并发只在桥内信号量排队白占 hostGate 槽位。
//   增强: gateFetch 对 fetchMode=scrapling-stealthy|playwright 把 acquire limit 钳到
//   min(配置, 3); static(无桥内信号量)与 native 不受影响。
//   1. 单元矩阵: effectiveHostGateLimit(fetchMode, configured) 判定
//   2. e2e(真实 TaskRunner+mock 桥并发记账): stealthy+limit8+8线程 → 桥内最大并发≤3
//   3. 差分组: static+limit8+8线程 → 桥内最大并发>3(钳制不误伤 static)
//   修前双证: 增强未实现时 §1 缺导出必败 + §2 实测桥内并发=8>3 必败
// 运行: bun scripts/verify-mm-b-hostgate.ts (建删还原, mock 全部 close)
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

// ---------------- Part 1: 单元矩阵 ----------------
console.log('\n== 1. effectiveHostGateLimit 单元矩阵 ==')
type EffFn = (cfg: { fetchMode?: string; hostGateLimit?: number }) => number | undefined
let eff: EffFn | null = null
try {
  const mod = await import('../src/lib/crawl/fetcher') as unknown as { effectiveHostGateLimit?: EffFn }
  eff = mod.effectiveHostGateLimit ?? null
} catch { /* 增强未实现 */ }
if (!eff) {
  fail++; console.log('  ✗ FAIL: fetcher.effectiveHostGateLimit 未导出(增强未实现)')
} else {
  ok('stealthy+8 → 3(钳制到桥内信号量)', eff({ fetchMode: 'scrapling-stealthy', hostGateLimit: 8 }) === 3, `=${eff({ fetchMode: 'scrapling-stealthy', hostGateLimit: 8 })}`)
  ok('playwright+10 → 3', eff({ fetchMode: 'scrapling-playwright', hostGateLimit: 10 }) === 3)
  ok('stealthy+2 → 2(低于钳制线不放大)', eff({ fetchMode: 'scrapling-stealthy', hostGateLimit: 2 }) === 2)
  ok('stealthy 未配置 → undefined(引擎缺省 3, 行为不变)', eff({ fetchMode: 'scrapling-stealthy' }) === undefined)
  ok('【零回归】static+8 → 8(无桥内信号量, 不钳制)', eff({ fetchMode: 'scrapling-static', hostGateLimit: 8 }) === 8)
  ok('【零回归】native+8 → 8', eff({ fetchMode: 'native', hostGateLimit: 8 }) === 8)
  ok('【零回归】未配 fetchMode+8 → 8', eff({ hostGateLimit: 8 }) === 8)
}

// ---------------- mock 桥(兼源站): 并发记账 ----------------
interface Recorder { max: number; inflight: number; posts: number }
function startMockBridgeSite(delayMs: number): Promise<{ port: number; rec: Recorder; close: () => void }> {
  const rec: Recorder = { max: 0, inflight: 0, posts: 0 }
  const bookHtml = (n: number) => `<html><head><title>钳制验证书</title></head><body>
    <h1 id="name">钳制验证书</h1><div id="author">测试作者</div><div id="intro">验证浏览器类桥模式 hostGateLimit 钳制的测试书。</div>
    <ul id="toc">${Array.from({ length: n }, (_, i) => `<li><a href="/c${i + 1}">第${i + 1}章 钳制</a></li>`).join('')}</ul></body></html>`
  const server = http.createServer((req, res) => {
    res.on('error', () => {})
    if (req.method !== 'POST' || !(req.url || '').startsWith('/fetch')) {
      res.writeHead(404).end()
      return
    }
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let target = '/'
      try { target = new URL(JSON.parse(raw).url).pathname } catch { /* ignore */ }
      rec.posts++
      rec.inflight++
      rec.max = Math.max(rec.max, rec.inflight)
      setTimeout(() => {
        rec.inflight--
        let html = bookHtml(8)
        const m = target.match(/^\/c(\d+)$/)
        if (m) html = `<html><head><title>c${m[1]}</title></head><body><div id="content">第${m[1]}章正文。${'钳制验证正文，用于并发观测。'.repeat(30)}</div></body></html>`
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, status: 200, html, finalUrl: '' }))
      }, delayMs)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({ port, rec, close: () => server.close() })
    })
  })
}

async function runTask(port: number, fetchMode: string): Promise<{ ruleId: string; taskId: string; done: boolean; chapters: number }> {
  const { db } = await import('../src/lib/db')
  const { TaskRunner } = await import('../src/lib/crawl/runner')
  const rule = await db.rule.create({
    data: {
      name: `mmb-hostgate-${Date.now()}`,
      description: 'mm-b hostGateLimit 钳制验证',
      config: JSON.stringify({
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
        fetch: { engine: 'http', fetchMode, uaMode: 'rotate', timeout: 20000, retries: 0, waitMs: 50, hostGateLimit: 8, scraplingBridgeUrl: `http://127.0.0.1:${port}` },
        clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: true },
      }),
      enabled: true,
    },
  })
  const bookUrl = `http://127.0.0.1:${port}/book`
  const task = await db.task.create({
    data: { name: 'mmb-hostgate-task', ruleId: rule.id, mode: 'single', bookUrl, recrawlMode: 'incremental', storageMode: 'db', threadMin: 8, threadMax: 8, intervalMin: 50, intervalMax: 100, smartCategory: false, smartComplete: false, autoSuggest: false, status: 'pending' },
  })
  await TaskRunner.instance.control(task.id, 'start')
  let done = false
  const t0 = Date.now()
  while (Date.now() - t0 < 60_000) {
    const t = await db.task.findUnique({ where: { id: task.id } })
    if (t?.status === 'done') { done = true; break }
    if (t?.status === 'error') break
    await sleep(300)
  }
  const bk = await db.book.findFirst({ where: { sourceUrl: bookUrl } })
  const chapters = bk ? await db.chapter.count({ where: { bookId: bk.id, fetched: true } }) : 0
  return { ruleId: rule.id, taskId: task.id, done, chapters }
}

async function cleanup(ruleId: string, taskId: string, port: number) {
  try {
    const { db } = await import('../src/lib/db')
    if (taskId) {
      await db.taskLog.deleteMany({ where: { taskId } }).catch(() => {})
      await db.task.delete({ where: { id: taskId } }).catch(() => {})
    }
    const bk = await db.book.findFirst({ where: { sourceUrl: `http://127.0.0.1:${port}/book` } })
    if (bk) await db.book.delete({ where: { id: bk.id } }).catch(() => {})
    if (ruleId) await db.rule.delete({ where: { id: ruleId } }).catch(() => {})
  } catch (e) {
    console.log('清理异常:', (e as Error)?.message)
  }
}

// ---------------- Part 2/3: e2e ----------------
async function main() {
  console.log('\n== 2. e2e: scrapling-stealthy + hostGateLimit=8 + 8线程 → 桥内最大并发≤3 ==')
  {
    const bridge = await startMockBridgeSite(250)
    let ids = { ruleId: '', taskId: '' }
    try {
      const r = await runTask(bridge.port, 'scrapling-stealthy')
      ids = { ruleId: r.ruleId, taskId: r.taskId }
      ok('任务完成', r.done)
      ok('8 章全部入库采齐', r.chapters === 8, `实际=${r.chapters}`)
      ok('【核心】桥内最大并发≤3(BoundedSemaphore(3) 对齐; 修前=8 必败此断言)', bridge.rec.max <= 3, `max=${bridge.rec.max} posts=${bridge.rec.posts}`)
    } finally {
      await cleanup(ids.ruleId, ids.taskId, bridge.port)
      bridge.close()
    }
  }

  console.log('\n== 3. 差分组: scrapling-static + hostGateLimit=8 → 桥内并发>3(不钳制) ==')
  {
    const bridge = await startMockBridgeSite(250)
    let ids = { ruleId: '', taskId: '' }
    try {
      const r = await runTask(bridge.port, 'scrapling-static')
      ids = { ruleId: r.ruleId, taskId: r.taskId }
      ok('任务完成', r.done)
      ok('8 章全部入库采齐', r.chapters === 8, `实际=${r.chapters}`)
      ok('【核心】桥内最大并发>3(static 无桥内信号量, 钳制不误伤)', bridge.rec.max > 3, `max=${bridge.rec.max} posts=${bridge.rec.posts}`)
    } finally {
      await cleanup(ids.ruleId, ids.taskId, bridge.port)
      bridge.close()
    }
  }

  console.log(`\n===== verify-mm-b-hostgate: ${pass} passed, ${fail} failed =====`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本异常:', e?.stack?.slice(0, 500) || e)
  process.exit(1)
})
