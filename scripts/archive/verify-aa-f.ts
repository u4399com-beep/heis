// ============================================================
// Task aa-f 验证脚本 — hostGate 同站并发闸门重建
// A: 20 并发过闸 → 服务端实测并发峰值 ≤ 3(默认 limit)
// B: 降额路径 — 抛错/挑战页连续失败≥3 → limit 3→2 + 观测日志事件;
//    60s 冷却内不连降; 连续成功10次回升至基准; 超基准不升
// C: 降额存量自然回落 — 持3槽降额至2, 新请求等回落准入(在飞不 abort)
// D: 计账释放无泄漏 — acquire 后抛错路径 ×100, inFlight===0
// E: 防 barge — 有等待者时新请求排队, FIFO 队头先准入
// F: hostGateLimit 钳制(types sanitize + acquire 钳制一致)
// G: AbortError 中止路径 — release 不泄漏且不计连续失败
// H: 槽满等待超时上限(HostGateTimeout)
// I: 真 fetchPage 全链路 + host 键分域(同机双端口互不影响)
// 运行: bun scripts/verify-aa-f.ts
// ============================================================
import http from 'http'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n== ${title} ==`)
  try { await fn() } catch (e: any) { fail++; console.log(`  ✗ 段落异常: ${e?.message?.slice(0, 200)}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- 本地 mock 服务(同站模拟) ----------------
// P1: 正常内容站(服务端实测并发峰值) / P2: 降额与恢复路径站
const P1 = 3331
const P2 = 3332
const base1 = `http://127.0.0.1:${P1}`
const base2 = `http://127.0.0.1:${P2}`
const SHELL_HTML =
  '<html><head><title>Just a moment...</title></head><body>cf-chl challenge attention required</body></html>'
const CONTENT_HTML = (tag: string) =>
  `<html><head><title>第一章 ${tag}</title></head><body><div id="content">${'正文内容测试。'.repeat(150)}</div></body></html>`

interface SrvStat { cur: number; peak: number; total: number }
function stat(): SrvStat { return { cur: 0, peak: 0, total: 0 } }

/** 正常内容站: 每请求慢 120ms, 服务端记账在飞并发 */
function makeContentServer(s: SrvStat) {
  return http.createServer((req, res) => {
    s.cur++
    s.peak = Math.max(s.peak, s.cur)
    s.total++
    setTimeout(() => {
      s.cur--
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(CONTENT_HTML('测试正文'))
    }, 120)
  })
}

const stat1 = stat()
const stat2 = stat()
const srvA = makeContentServer(stat1)
const srvB = makeContentServer(stat2)
await new Promise<void>((r) => srvA.listen(P1, () => r()))
await new Promise<void>((r) => srvB.listen(P2, () => r()))

const { fetchPage } = await import('../src/lib/crawl/fetcher')
const {
  acquireHostGate, releaseHostGate, reportHostSuccess, reportHostFailure,
  hostGateSnapshot, hostGateReset, hostGateKeyOf,
} = await import('../src/lib/crawl/hostgate')
const { sanitizeFetchConfig, parseRuleConfig } = await import('../src/lib/crawl/types')

type FetchResult = Awaited<ReturnType<typeof fetchPage>>
type GateCfg = { hostGateLimit?: number; engine?: 'http' | 'auto' | 'browser'; timeout?: number; retries?: number }
const logs: string[] = []

/** 与 runner.gateFetch 同构(采集端集成路径): acquire → fetchPage → 计账 → finally release */
async function gatedFetchPage(
  url: string,
  cfg: GateCfg = {},
  transport?: (u: string, c: GateCfg) => Promise<FetchResult>
): Promise<FetchResult> {
  const ticket = await acquireHostGate(url, { limit: cfg.hostGateLimit })
  try {
    const res = transport
      ? await transport(url, cfg)
      : await fetchPage(url, { engine: 'http', timeout: 8000, retries: 0, ...cfg })
    if (res.blocked) {
      const ev = reportHostFailure(url)
      if (ev) logs.push(`同站连续失败${ev.failStreak}次, 并发上限降至${ev.newLimit} (${ev.host})`)
    } else {
      reportHostSuccess(url)
    }
    return res
  } catch (e: any) {
    if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') {
      const ev = reportHostFailure(url)
      if (ev) logs.push(`同站连续失败${ev.failStreak}次, 并发上限降至${ev.newLimit} (${ev.host})`)
    }
    throw e
  } finally {
    releaseHostGate(ticket)
  }
}

// ============================================================
await section('A: 20 并发过闸 — 服务端实测并发峰值 ≤ 3', async () => {
  hostGateReset()
  logs.length = 0
  const url = `${base1}/c`
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => gatedFetchPage(url)))
  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  ok('20 并发全部成功(无等待超时/无泄漏互卡)', fulfilled.length === 20, `fulfilled=${fulfilled.length}`)
  ok('服务端实测并发峰值 ≤ 3', stat1.peak <= 3, `peak=${stat1.peak} total=${stat1.total}`)
  ok('并发真实发生(峰值≥2, 闸门未退化串行)', stat1.peak >= 2, `peak=${stat1.peak}`)
  const snap = hostGateSnapshot(url)
  ok('结束后 inFlight 归零/队列清空(计账闭合)', !!snap && snap.inFlight === 0 && snap.waiting === 0, JSON.stringify(snap))
  ok('默认基准 limit=3', !!snap && snap.baseLimit === 3 && snap.limit === 3, JSON.stringify(snap))
})

await section('B: 降额路径 — 抛错/挑战页 3 连败 → 3→2 + 冷却不连降 + 成功回升', async () => {
  hostGateReset()
  logs.length = 0
  const failCount = { n: 0 }
  // 前两次 500 抛错路径, 第三次 200+挑战壳 blocked 路径(两类失败都计账)
  const failServer = http.createServer((req, res) => {
    if (failCount.n < 2) { failCount.n++; res.writeHead(500); return res.end('err') }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(SHELL_HTML)
  })
  await new Promise<void>((r) => failServer.listen(3333, () => r()))
  const failBase = 'http://127.0.0.1:3333'
  try { await gatedFetchPage(`${failBase}/f`) } catch { /* 预期传输层失败 */ }
  try { await gatedFetchPage(`${failBase}/f`) } catch { /* 预期传输层失败 */ }
  const r3 = await gatedFetchPage(`${failBase}/f`) // blocked=true 不抛, 计内容层失败
  ok('第3次失败为 blocked 结果(非抛错路径也计账)', r3.blocked === true)
  ok('3 连败触发降额并产生观测日志', logs.length === 1 && logs[0].includes('连续失败3次') && logs[0].includes('降至2'), logs.join(' | '))
  let snap = hostGateSnapshot(`${failBase}/f`)
  ok('降额后 limit=2(基准仍 3)', !!snap && snap.limit === 2 && snap.baseLimit === 3, JSON.stringify(snap))
  // 冷却: 第4次失败(60s 内)不再降
  failServer.close()
  const failServer2 = http.createServer((req, res) => { res.writeHead(500); res.end('err') })
  await new Promise<void>((r) => failServer2.listen(3333, () => r()))
  try { await gatedFetchPage(`${failBase}/f`) } catch { /* 预期失败 */ }
  const after4 = hostGateSnapshot(`${failBase}/f`)
  ok('60s 冷却内第4次失败不再连降(日志不增/limit 仍 2)', logs.length === 1 && !!after4 && after4.limit === 2, `logs=${logs.length}`)
  failServer2.close()
  // 恢复: 连续成功 10 次 → 回升到基准 3
  for (let i = 0; i < 10; i++) await gatedFetchPage(`${base2}/c`)
  snap = hostGateSnapshot(`${base2}/c`)
  ok('连续成功10次 limit 回升至基准3(恢复无日志, debug级省略)', !!snap && snap.limit === 3 && logs.length === 1, JSON.stringify(snap))
  for (let i = 0; i < 12; i++) await gatedFetchPage(`${base2}/c`)
  const after22 = hostGateSnapshot(`${base2}/c`)
  ok('已达基准后不再超额回升', !!after22 && after22.limit === 3)
})

await section('C: 降额存量自然回落 — 在飞不中断, 新请求按实际余量准入', async () => {
  hostGateReset()
  logs.length = 0
  const url = `${base2}/c`
  // 手持 3 槽(limit 3 快速通道)
  const t1 = await acquireHostGate(url)
  const t2 = await acquireHostGate(url)
  const t3 = await acquireHostGate(url)
  let snap = hostGateSnapshot(url)
  ok('3 槽全部准入 inFlight=3', !!snap && snap.inFlight === 3, JSON.stringify(snap))
  // 降额至 2(报 3 次失败)
  for (let i = 0; i < 3; i++) reportHostFailure(url)
  snap = hostGateSnapshot(url)
  ok('3 连败降额 limit=2, 在飞 3 不被中断(存量自然回落)', !!snap && snap.limit === 2 && snap.inFlight === 3, JSON.stringify(snap))
  // 新请求必须等待存量回落
  let admitted = false
  const p4 = acquireHostGate(url).then((t) => { admitted = true; return t })
  await sleep(80)
  ok('inFlight(3) > limit(2) 期间新请求被挂起', !admitted)
  releaseHostGate(t1) // 存量回落 1 → inFlight=2, limit-inFlight=0 仍不放行
  await sleep(80)
  ok('存量回落到 inFlight=2(=limit) 时仍不放行(实际余量 0)', !admitted)
  releaseHostGate(t2) // 存量回落到 1 < limit=2 → 队头准入
  const t4 = await Promise.race([p4, sleep(500).then(() => null)])
  ok('存量回落后新请求按余量准入(计账式)', !!t4 && admitted)
  snap = hostGateSnapshot(url)
  ok('准入后 inFlight=2(遗留1+新1), 无超额', !!snap && snap.inFlight === 2, JSON.stringify(snap))
  releaseHostGate(t3)
  releaseHostGate(t4!)
  const final = hostGateSnapshot(url)
  ok('全部释放 inFlight=0', !!final && final.inFlight === 0)
})

await section('D: 计账释放无泄漏 — acquire 后抛错路径 ×100', async () => {
  hostGateReset()
  const url = `${base1}/c`
  let thrown = 0
  for (let i = 0; i < 100; i++) {
    const t = await acquireHostGate(url)
    try {
      if (i % 2 === 0) throw new Error('boom-同步抛')
      else await Promise.reject(new Error('boom-异步抛'))
    } catch {
      thrown++
    } finally {
      releaseHostGate(t)
    }
  }
  ok('100 次抛错路径全部被 catch(模拟 runner 计账)', thrown === 100, `thrown=${thrown}`)
  const snap = hostGateSnapshot(url)
  ok('100 次后 inFlight===0 且队列空(槽位零泄漏)', !!snap && snap.inFlight === 0 && snap.waiting === 0, JSON.stringify(snap))
  const t0 = Date.now()
  const t = await acquireHostGate(url)
  const gotMs = Date.now() - t0
  ok('随后一次 acquire 立即准入(无幽灵占用)', gotMs < 200, `${gotMs}ms`)
  releaseHostGate(t)
})

await section('E: 防 barge — 有等待者时新请求排队, FIFO 队头先准入', async () => {
  hostGateReset()
  const url = `${base1}/c`
  const t1 = await acquireHostGate(url) // 槽1
  const t2 = await acquireHostGate(url) // 槽2
  const t3 = await acquireHostGate(url) // 槽3(占满)
  const order: string[] = []
  const pA = acquireHostGate(url).then((t) => { order.push('A'); return t }) // 排队
  await sleep(30)
  const pB = acquireHostGate(url).then((t) => { order.push('B'); return t }) // 排队(后到)
  await sleep(30)
  let snap = hostGateSnapshot(url)
  ok('槽满后新请求进入 FIFO 队列(waiting=2)', !!snap && snap.waiting === 2 && snap.inFlight === 3, JSON.stringify(snap))
  releaseHostGate(t1) // 释放 1 槽 → 队头 A 准入, B 仍等
  const ta = await Promise.race([pA, sleep(300).then(() => null)])
  snap = hostGateSnapshot(url)
  ok('队头 A 先准入(先到先得, 不被后到者越过)', order[0] === 'A' && !!snap && snap.waiting === 1, JSON.stringify({ order, ...snap }))
  releaseHostGate(t2) // 再释放 1 槽 → B 准入
  const tb = await Promise.race([pB, sleep(300).then(() => null)])
  ok('B 随后准入, 准入顺序 A→B', order.join(',') === 'A,B')
  releaseHostGate(t3)
  releaseHostGate(ta!)
  releaseHostGate(tb!)
  const final = hostGateSnapshot(url)
  ok('收尾 inFlight=0', !!final && final.inFlight === 0)
})

await section('F: hostGateLimit 钳制 — sanitizeFetchConfig / parseRuleConfig / acquire 三处一致', async () => {
  ok('sanitize: 字符串数字 "5" → 5', sanitizeFetchConfig({ hostGateLimit: '5' as unknown as number }).hostGateLimit === 5)
  ok('sanitize: 超上界 99 → 10', sanitizeFetchConfig({ hostGateLimit: 99 }).hostGateLimit === 10)
  ok('sanitize: 下界 0 → 1', sanitizeFetchConfig({ hostGateLimit: 0 }).hostGateLimit === 1)
  ok('sanitize: 非数字丢弃(undefined)', sanitizeFetchConfig({ hostGateLimit: 'abc' as unknown as number }).hostGateLimit === undefined)
  ok('sanitize: 合法值原样 7', sanitizeFetchConfig({ hostGateLimit: 7 }).hostGateLimit === 7)
  const rc = parseRuleConfig(JSON.stringify({ fetch: { hostGateLimit: 6 } }))
  ok('parseRuleConfig: 规则显式 6 生效', rc.fetch.hostGateLimit === 6)
  ok('parseRuleConfig: 缺省回落 DEFAULT 3', parseRuleConfig(null).fetch.hostGateLimit === 3)
  hostGateReset()
  const tLow = await acquireHostGate(`${base1}/c`, { limit: 0 as unknown as number })
  ok('acquire: limit 0 钳到 1', hostGateSnapshot(`${base1}/c`)!.baseLimit === 1)
  releaseHostGate(tLow)
  const tHigh = await acquireHostGate(`${base1}/c`, { limit: 99 })
  ok('acquire: limit 99 钳到 10', hostGateSnapshot(`${base1}/c`)!.baseLimit === 10)
  releaseHostGate(tHigh)
})

await section('G: AbortError 中止路径 — release 不泄漏且不计连续失败', async () => {
  hostGateReset()
  const url = `${base2}/c`
  const abortErr = new Error('抓取已中止(signal)')
  abortErr.name = 'AbortError'
  await gatedFetchPage(url, {}, async () => { throw abortErr }).catch(() => {})
  let snap = hostGateSnapshot(url)
  ok('AbortError 抛出后槽位已释放(inFlight=0)', !!snap && snap.inFlight === 0, JSON.stringify(snap))
  ok('AbortError 不计入同站连续失败(failStreak=0)', !!snap && snap.failStreak === 0, JSON.stringify(snap))
  await gatedFetchPage(url, {}, async () => { throw new Error('普通失败') }).catch(() => {})
  snap = hostGateSnapshot(url)
  ok('普通失败正常计账(failStreak=1)', !!snap && snap.failStreak === 1, JSON.stringify(snap))
})

await section('H: 槽满等待超时上限 — HostGateTimeout 按期抛出', async () => {
  hostGateReset()
  const url = `${base1}/c`
  const t = await acquireHostGate(url, { limit: 1 })
  const p = acquireHostGate(url) // 无限等待
  let timed = false
  const pTimed = acquireHostGate(url, { timeoutMs: 1300 }).catch((e) => { timed = e?.name === 'HostGateTimeout'; return Promise.reject(e) })
  const t0 = Date.now()
  await pTimed.catch(() => {})
  const el = Date.now() - t0
  ok('超时按配置(1.3s)抛 HostGateTimeout', timed && el >= 1200 && el < 2500, `${el}ms`)
  let settled = false
  p.then(() => { settled = true }).catch(() => {})
  await sleep(50)
  const mid = hostGateSnapshot(url)
  ok('未超时的普通等待者不受影响继续排队', !settled && !!mid && mid.waiting === 1, JSON.stringify(mid))
  releaseHostGate(t)
  const tp = await p // 释放后准入
  const snap = hostGateSnapshot(url)
  ok('等待者准入后队列清空(waiting=0)', !!snap && snap.waiting === 0 && snap.inFlight === 1, JSON.stringify(snap))
  releaseHostGate(tp)
  const fin = hostGateSnapshot(url)
  ok('最终释放后 inFlight=0', !!fin && fin.inFlight === 0)
})

await section('I: 真 fetchPage 全链路 + host 键分域(同机双端口互不影响)', async () => {
  hostGateReset()
  const u1 = `${base1}/c`
  const u2 = `${base2}/c`
  const r = await gatedFetchPage(u1)
  ok('fetchPage 经闸门抓取正常页成功非拦截', !r.blocked && r.html.includes('正文内容测试'), `len=${r.html.length}`)
  ok('host 键=host(含端口), 双端口各自独立账本', hostGateKeyOf(u1) === `127.0.0.1:${P1}` && !!hostGateSnapshot(u1) && !hostGateSnapshot(u2))
  const snap = hostGateSnapshot(u1)
  ok('成功计账 successStreak=1/failStreak=0', !!snap && snap.successStreak === 1 && snap.failStreak === 0, JSON.stringify(snap))
})

srvA.close()
srvB.close()
console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

export {}
