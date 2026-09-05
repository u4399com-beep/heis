// ============================================================
// verify-ll-c-runner.ts — ll-c runner 域断言(epoch 绑定窗口修复 + Referer 链翻页接线)
//   1. 静态源码断言: executeTask 的 rt/myEpoch 绑定同步在函数入口(首个 await 之前)
//      —— 修前在 await ensureDirs()+loadConfig() 之后读 epoch, 窗口内 stop→start 会让
//         旧循环绑定【新一轮】epoch → 双循环并发采集(修前源码序实锤)
//   2. 静态源码断言: pageFetchGated 翻页 Referer 链接线 + types pageFetch 可选 refererUrl
//   3. e2e(真实 TaskRunner+DB, 建删还原): refererChain 规则 三级目录翻页 ——
//      /toc2 Referer=bookUrl(第1页链根, 修前后一致) + /toc3 Referer=/toc2(修前恒 bookUrl,
//      修后链式回溯 —— 本断言修前必失败, 甄别确定性来源)
//   4. e2e: 快速 stop→start(epoch 竞态压窗)健康收尾守卫(恰2启动/恰1完成/6章/无重复完成)
// 运行: bun scripts/verify-ll-c-runner.ts (参考 verify-ee-d-epoch.ts 模式, 全程建删还原)
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

// ---------------- Part 1/2: 静态源码断言 ----------------
console.log('\n== 1. executeTask epoch 绑定窗口(静态源码断言) ==')
{
  const src = readFileSync('src/lib/crawl/runner.ts', 'utf8')
  const entry = src.indexOf('private async executeTask(')
  // 代码形态定位: 真实 await 语句(换行+缩进), 避免命中注释里的文字
  // zz-d 适配: executeTask 首个 await(ensureDirs)已随 running 标志泄漏修复移入 try 块
  // (缩进 4→6 空格, 绑定语义不变: rt/myEpoch 仍同步在入口、先于任何 await), 定位器改为
  // 缩进无关形态(断言意图不变: 首个真实 await 处之前完成绑定; 注释行因 '//' 不命中)
  const firstAwaitRel = src.slice(entry).search(/\n[ \t]+await ensureDirs\(\)/)
  const firstAwait = firstAwaitRel < 0 ? -1 : entry + firstAwaitRel
  ok('executeTask 在场', entry > 0 && firstAwait > entry)
  const head = src.slice(entry, firstAwait)
  ok('【核心】rt/myEpoch 绑定在首个 await 之前(同步入口绑定)', head.includes('const myEpoch = rt.epoch') && head.includes('this.runtimes.get(taskId)'), head.replace(/\s+/g, ' ').slice(0, 120))
  const body = src.slice(entry, src.indexOf('private async gateFetch'))
  ok('executeTask 全函数体恰一次 epoch 绑定(无第二捕获点)', (body.match(/const myEpoch = rt\.epoch/g) || []).length === 1)
  const cbSig = src.indexOf('private async crawlOneBook(')
  const cbBody = src.slice(cbSig, src.indexOf('private async saveProgress'))
  ok('crawlOneBook 仍无 rt.epoch 重捕获(jj-d 语义保持)', !/const myEpoch = rt\.epoch/.test(cbBody))
}

console.log('\n== 2. pageFetch Referer 链接线(静态源码断言) ==')
{
  const src = readFileSync('src/lib/crawl/runner.ts', 'utf8')
  ok('pageFetchGated 带 prevUrl 可选参', /const pageFetchGated = \(u: string, prevUrl\?: string\)/.test(src))
  ok('接线体按 refererChain 条件覆写 refererUrl', /fetchCfgBase\.refererChain && prevUrl \? \{ \.\.\.fetchCfg, refererUrl: prevUrl \} : fetchCfg/.test(src))
  const tsrc = readFileSync('src/lib/crawl/types.ts', 'utf8')
  ok('FetchConfig.pageFetch 类型含可选 refererUrl', /pageFetch\?: \(url: string, refererUrl\?: string\) => Promise<\{ html: string \}>/.test(tsrc))
  const psrc = readFileSync('src/lib/crawl/parser.ts', 'utf8')
  ok('parseToc 翻页捕获 refererForNext', psrc.includes('const refererForNext = url'))
  ok('parseContent 翻页捕获 refererForNext', psrc.indexOf('const refererForNext = url') !== psrc.lastIndexOf('const refererForNext = url'))
  ok('fetchPaginationPage 透传 refererUrl', /fetchPaginationPage\(url: string, fetchCfg: Parameters<typeof fetchPage>\[1\], refererUrl\?: string\)/.test(psrc))
}

// ---------------- mock 服务 ----------------
const servers: http.Server[] = []
function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse, referer: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const referers: Record<string, string> = {}
    const server = http.createServer((req, res) => {
      res.on('error', () => {})
      const referer = String(req.headers['referer'] || '')
      const u = new URL(req.url || '/', 'http://x')
      referers[u.pathname] = referer
      ;(server as unknown as { __referers?: Record<string, string> }).__referers = referers
      handler(req, res, referer)
    })
    server.on('clientError', (_e: unknown, s: import('net').Socket) => { try { s.end() } catch { /* ignore */ } })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      servers.push(server)
      resolve(port)
    })
  })
}
function referersOf(server: http.Server): Record<string, string> {
  return (server as unknown as { __referers?: Record<string, string> }).__referers || {}
}
const chapterHtml = (n: number) =>
  `<html><body><div id="content">《第${n}章》正文。${'段落测试文本，用于验证链路。'.repeat(40)}</div></body></html>`

async function cleanup(ruleId: string, taskId: string, bookUrl: string) {
  try {
    if (taskId) {
      await db.taskLog.deleteMany({ where: { taskId } }).catch(() => {})
      await db.task.delete({ where: { id: taskId } }).catch(() => {})
    }
    const bk = await db.book.findFirst({ where: { sourceUrl: bookUrl } })
    if (bk) await db.book.delete({ where: { id: bk.id } }).catch(() => {})
    if (ruleId) await db.rule.delete({ where: { id: ruleId } }).catch(() => {})
  } catch (e) {
    console.log('清理异常:', (e as Error)?.message)
  }
}

const { db } = await import('../src/lib/db')
const { TaskRunner } = await import('../src/lib/crawl/runner')

const baseRuleFetch = { engine: 'http', uaMode: 'rotate', timeout: 20000, retries: 0, hostGateLimit: 3, autoCookie: true, referer: true }
const ruleSections = () => ({
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
    pagination: { enabled: true, maxPages: 5, nextLink: { type: 'css', expression: 'a.next', attr: 'href' } },
  },
  content: {
    enabled: true,
    fields: { content: { type: 'css', expression: '#content', attr: 'html' } },
    pagination: { enabled: false, maxPages: 1 },
  },
  clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: true },
})

// ---------------- Part 3: Referer 链翻页 e2e ----------------
console.log('\n== 3. e2e: refererChain 规则三级目录翻页(真实 runner→gateFetch→buildHeaders) ==')
{
  let ruleId = ''
  let taskId = ''
  let bookUrl = ''
  try {
    const port = await startServer((req, res) => {
      const reply = (html: string) => { try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) } catch { /* ignore */ } }
      const p = new URL(req.url || '/', 'http://x').pathname
      if (p === '/book') return reply(`<html><head><title>R链验证书</title></head><body>
        <h1 id="name">R链验证书</h1><div id="author">测试作者</div><div id="intro">用于验证 Referer 链翻页的测试书。</div>
        <ul id="toc"><li><a href="/c1">第1章</a></li></ul><a class="next" href="/toc2">下一页</a></body></html>`)
      if (p === '/toc2') return reply(`<html><head><title>R链验证书</title></head><body>
        <ul id="toc"><li><a href="/c2">第2章</a></li></ul><a class="next" href="/toc3">下一页</a></body></html>`)
      if (p === '/toc3') return reply(`<html><head><title>R链验证书</title></head><body>
        <ul id="toc"><li><a href="/c3">第3章</a></li></ul></body></html>`)
      const m = p.match(/^\/c(\d)$/)
      if (m) return reply(chapterHtml(Number(m[1])))
      reply('<html><body>index</body></html>')
    })
    const BASE = `http://127.0.0.1:${port}`
    bookUrl = `${BASE}/book`
    const cfg = ruleSections()
    const rule = await db.rule.create({ data: { name: `llc-referer-${Date.now()}`, description: 'll-c Referer 链翻页验证', config: JSON.stringify({ ...cfg, fetch: { ...baseRuleFetch, refererChain: true } }), enabled: true } })
    ruleId = rule.id
    const task = await db.task.create({
      data: { name: 'llc-referer-chain-task', ruleId, mode: 'single', bookUrl, recrawlMode: 'incremental', storageMode: 'db', threadMin: 2, threadMax: 2, intervalMin: 50, intervalMax: 100, smartCategory: false, smartComplete: false, autoSuggest: false, status: 'pending' },
    })
    taskId = task.id
    const s = await TaskRunner.instance.control(taskId, 'start')
    ok('任务启动', s.ok, s.message)
    let done = false
    const t1 = Date.now()
    while (Date.now() - t1 < 30_000) {
      const t = await db.task.findUnique({ where: { id: taskId } })
      if (t?.status === 'done') { done = true; break }
      await sleep(300)
    }
    ok('任务完成', done)
    const refs = referersOf(servers[servers.length - 1])
    ok('【核心】/toc2 Referer=书籍页(链根, 修前后一致)', refs['/toc2'] === bookUrl, `实际=${refs['/toc2']}`)
    ok('【核心·修前必败】/toc3 Referer=/toc2(翻页链逐页回溯, 修前恒 bookUrl)', refs['/toc3'] === `${BASE}/toc2`, `实际=${refs['/toc3']} 期望=${BASE}/toc2`)
    ok('章节请求 Referer=书籍页(ff-b② 语义回归守卫)', refs['/c1'] === bookUrl, `实际=${refs['/c1']}`)
    const bk = await db.book.findFirst({ where: { sourceUrl: bookUrl } })
    const chs = bk ? await db.chapter.findMany({ where: { bookId: bk.id } }) : []
    ok('3 章跨页全部入库采齐', chs.length === 3 && chs.every((c) => c.fetched), chs.map((c) => `${c.title}:${c.fetched}`).join(','))
    await cleanup(ruleId, taskId, bookUrl)
  } catch (e) {
    fail++
    console.log('  ✗ 脚本异常:', (e as Error)?.stack?.slice(0, 400) || e)
    await cleanup(ruleId, taskId, bookUrl)
  }
}

// ---------------- Part 4: 快速 stop→start epoch 竞态压窗 e2e ----------------
console.log('\n== 4. e2e: 快速 stop→start(epoch 竞态压窗)健康收尾守卫 ==')
{
  let ruleId = ''
  let taskId = ''
  let bookUrl = ''
  try {
    const port = await startServer((req, res) => {
      const reply = (html: string) => { try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) } catch { /* ignore */ } }
      const p = new URL(req.url || '/', 'http://x').pathname
      if (p === '/book') {
        const toc = Array.from({ length: 6 }, (_, i) => `<li><a href="/c${i + 1}">第${i + 1}章 测试</a></li>`).join('')
        return reply(`<html><head><title>llc竞态压窗书</title></head><body>
          <h1 id="name">llc竞态压窗书</h1><div id="author">测试作者</div><div id="intro">用于验证快速 stop→start 不产生双循环的测试书。</div>
          <ul id="toc">${toc}</ul></body></html>`)
      }
      const m = p.match(/^\/c(\d)$/)
      if (m) return reply(chapterHtml(Number(m[1])))
      reply('<html><body>index</body></html>')
    })
    const BASE = `http://127.0.0.1:${port}`
    bookUrl = `${BASE}/book`
    const cfg = ruleSections()
    cfg.toc.pagination = { enabled: false, maxPages: 1 } as never
    const rule = await db.rule.create({ data: { name: `llc-epoch-${Date.now()}`, description: 'll-c epoch 绑定窗口验证', config: JSON.stringify({ ...cfg, fetch: { ...baseRuleFetch } }), enabled: true } })
    ruleId = rule.id
    const task = await db.task.create({
      data: { name: 'llc-epoch-race-task', ruleId, mode: 'single', bookUrl, recrawlMode: 'incremental', storageMode: 'db', threadMin: 3, threadMax: 3, intervalMin: 50, intervalMax: 100, smartCategory: false, smartComplete: false, autoSuggest: false, status: 'pending' },
    })
    taskId = task.id
    // 压窗: start 后【不间隔】连续发 stop+start(两个 control 的 db await 与 executeTask#1 的
    // ensureDirs/loadConfig await 交叠 —— 修前旧循环可在此窗口读到【新一轮】epoch 而永不漂移退出)
    const s1 = await TaskRunner.instance.control(taskId, 'start')
    ok('第1轮启动', s1.ok, s1.message)
    // 两个 control 的 db await 相互交叠, 且与 executeTask#1 的入口同步段后首个异步点交叠
    const spP = TaskRunner.instance.control(taskId, 'stop')
    const s2P = TaskRunner.instance.control(taskId, 'start')
    const spRes = await spP
    ok('stop 成功', spRes.ok, spRes.message)
    const s2Res = await s2P
    ok('第2轮启动(停止后立刻重启)', s2Res.ok, s2Res.message)
    let reallyDone = false
    const t1 = Date.now()
    while (Date.now() - t1 < 40_000) {
      const t = await db.task.findUnique({ where: { id: taskId } })
      const bk = await db.book.findFirst({ where: { sourceUrl: bookUrl } })
      const fetched = bk ? await db.chapter.count({ where: { bookId: bk.id, fetched: true } }) : 0
      if (t?.status === 'done' && fetched >= 6) { reallyDone = true; break }
      await sleep(300)
    }
    ok('真正完成(done 且 6 章入库)', reallyDone)
    await sleep(1200) // 僵尸循环(若有)收尾日志窗口
    const logs = await db.taskLog.findMany({ where: { taskId }, orderBy: { id: 'asc' } })
    const starts = logs.filter((l) => l.message.startsWith('▶ 任务启动'))
    const dones = logs.filter((l) => l.message.includes('✅ 任务完成'))
    const bookLogs = logs.filter((l) => l.message.startsWith('书籍页:'))
    ok('恰 2 条任务启动日志', starts.length === 2, `count=${starts.length}`)
    ok('【双循环判别】恰 1 条任务完成(僵尸循环会再写一条)', dones.length === 1, `count=${dones.length}`)
    ok('书籍页日志 ≤2 条(双循环会 >2)', bookLogs.length <= 2, `count=${bookLogs.length}`)
    ok('全部书籍页早于任务完成(无旧循环伪造完成)', !!dones[0] && bookLogs.every((b) => b.id < dones[0].id))
    const t = await db.task.findUnique({ where: { id: taskId } })
    ok('最终状态 done', t?.status === 'done', `status=${t?.status}`)
    await cleanup(ruleId, taskId, bookUrl)
  } catch (e) {
    fail++
    console.log('  ✗ 脚本异常:', (e as Error)?.stack?.slice(0, 400) || e)
    await cleanup(ruleId, taskId, bookUrl)
  }
}

for (const s of servers) { s.closeAllConnections?.(); s.close() }
console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)
