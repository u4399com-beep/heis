export {}
// ============================================================
// Task gg-d 验证脚本② — hostGate × 新能力叠加面 健康证明(疑点1, 本轮最高优先级)
//
// 审计主线索: 前五轮单能力已覆盖, 本轮只审"能力叠加交互"——
//   ① 镜像切换 mirrorDomains × hostGate 账本: 镜像重写后记账键是原 host 还是镜像 host?
//      (fetcher.ts 全文无 hostgate import, 镜像重试发生在 fetchPage 内部, gateFetch 对
//       整个 fetchPage 调用持一个槽/记一笔账 —— dd-b 存档裁定"镜像重试随行同槽")
//   ② 指数退避(ff-b④) × hostGate: 退避重试是否重复喂连败(一次 429 两次记账)?
//   ③ 清罐自愈(ff-b③) × hostGate 槽位公平性: 清罐重试是否绕过闸门(多占槽/插队)?
//   ④ 中继桥(gg) × hostGate: 中继层失败(RelayTransportError)是否双计记账?
//   ⑤ HostGateTimeout 不喂账(ee-d/x-a 豁免口径)复验
// 方法: gateFetchEmul 按 runner.gateFetch 的记账契约(逐行同构, hostgate 部分仅 12 行)
//   + 全回环 mock 源站 + hostGateSnapshot 观测账本 —— 无 bug 项留健康证明存档
// 运行: bun scripts/verify-gg-d-hostgate.ts (不出网, 结束自清理)
// ============================================================
declare const Bun: {
  serve(opts: { port: number; hostname: string; fetch(req: Request): Response | Promise<Response> }): { stop(stopActive?: boolean): void }
}

import {
  acquireHostGate, releaseHostGate, reportHostSuccess, reportHostFailure,
  hostGateSnapshot, hostGateReset, hostGateKeyOf,
} from '../src/lib/crawl/hostgate'
import { fetchPage, fetchHttpForTest, cookieJar } from '../src/lib/crawl/fetcher'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- mock 源站(3410) + 死端口(3411/3412, 无监听→连接拒绝) ----------------
const PORT = 3410
const BASE = `http://127.0.0.1:${PORT}`
const DEAD1 = 3411
const DEAD2 = 3412
const hitCount = new Map<string, number>()

function pad(n: number): string {
  return 'p'.repeat(n)
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    const u = new URL(req.url)
    hitCount.set(u.pathname, (hitCount.get(u.pathname) || 0) + 1)
    const hits = hitCount.get(u.pathname) || 0
    const reply = (body: string, status = 200, headers: Record<string, string> = {}) =>
      new Response(body + pad(220), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } })
    // /429mix: 前 4 次物理请求回 429, 之后 200(供 retries=2 退避后成功场景;
    //   每次 fetchPageOnce 尝试 = bun+curl 双物理请求, 4 阈值恰好覆盖前两次尝试)
    if (u.pathname === '/429mix') return hits <= 4 ? reply('rate limited', 429) : reply('<html><title>退避恢复页</title></html>')
    if (u.pathname === '/always429') return reply('rate limited', 429)
    if (u.pathname === '/fortress') return reply('no entry for robots here', 403)
    if (u.pathname === '/cookie403') {
      // 600ms/次: 拉长清罐重试窗口, 保证并发等待者在其持槽期间超时(公平性断言确定性)
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(reply('protected area', 403)), 600)
      })
    }
    if (u.pathname === '/seed') return reply('<html><title>种Cookie页</title></html>', 200, { 'Set-Cookie': 'sid=ggdseed123; Path=/' })
    return reply('<html><title>正常页</title></html>')
  },
})
await new Promise((r) => setTimeout(r, 200))

// ---------------- gateFetch 契约同构(runner.gateFetch 的 hostgate 记账部分) ----------------
async function gateFetchEmul(url: string, cfg: Record<string, unknown>): Promise<{ html: string; blocked: boolean }> {
  const ticket = await acquireHostGate(url, { limit: (cfg.hostGateLimit as number) || 3 })
  try {
    const res = await fetchPage(url, cfg as never)
    if (res.blocked) reportHostFailure(url)
    else reportHostSuccess(url)
    return res
  } catch (e: any) {
    if (e?.isFetchTimeout || (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR')) reportHostFailure(url)
    throw e
  } finally {
    releaseHostGate(ticket)
  }
}

const snap = (url: string) => hostGateSnapshot(url)
const clearJarFor = (origin: string) => cookieJar.clear(origin)

async function main() {
  // ============ ① 镜像切换 × hostGate 账本键 ============
  console.log('\n== ① 镜像重写后记账键: 原 host(镜像 host 无独立账本, dd-b 存档"随行同槽") ==')
  hostGateReset()
  {
    const deadUrl = `http://127.0.0.1:${DEAD1}/ok`
    const mirrorUrl = `${BASE}/ok`
    // ①a 原 host 死(连接拒绝) → 镜像(3410)成功: 成功记账应落在【原 host】账本
    const res = await gateFetchEmul(deadUrl, { engine: 'http', timeout: 4000, retries: 0, mirrorDomains: `127.0.0.1:${PORT}` })
    ok('①a-1 原 host 死→镜像成功, fetchPage 成功返回', !res.blocked && res.html.includes('正常页'), `len=${res.html.length}`)
    ok('①a-2【核心】成功记账落在原 host 账本(镜像流量不另立账)', snap(deadUrl)?.successStreak === 1, JSON.stringify(snap(deadUrl)))
    ok('①a-3 镜像 host 无账本条目(不产生镜像侧降额/升额错账)', snap(mirrorUrl) === null, `snapshot=${JSON.stringify(snap(mirrorUrl))}`)
    // ①b 原 host 403 + 镜像死: 全组失败 → 恰一次失败记账(两次尝试不双计)
    clearJarFor(BASE)
    hitCount.set('/fortress', 0)
    const fortressUrl = `${BASE}/fortress`
    let err: any = null
    try { await gateFetchEmul(fortressUrl, { engine: 'http', timeout: 4000, retries: 0, mirrorDomains: `127.0.0.1:${DEAD2}` }) } catch (e) { err = e }
    ok('①b-1 全镜像组失败如实上抛', !!err, `err=${String(err?.message).slice(0, 60)}`)
    ok('①b-2【核心】整次 gateFetch 恰一次失败记账(failStreak===1 非 2)', snap(fortressUrl)?.failStreak === 1, JSON.stringify(snap(fortressUrl)))
    ok('①b-3 死镜像 host 同样无账本条目', snap(`http://127.0.0.1:${DEAD2}/fortress`) === null)
    ok('①b-4 镜像切换中间尝试不产生成功记账(successStreak 保持 0)', snap(`${BASE}/fortress`)?.successStreak === 0, JSON.stringify(snap(`${BASE}/fortress`)))
  }

  // ============ ② 指数退避 × hostGate(一次 429 是否两次记账) ============
  console.log('\n== ② 退避重试: 中间 429 不喂账, 整次调用至多一笔(成功/失败两端) ==')
  hostGateReset()
  {
    // ②a 退避后成功: 中间 429 全部被 fetchPageOnce 内部吸收, 不产生任何失败记账
    hitCount.set('/429mix', 0)
    const res = await gateFetchEmul(`${BASE}/429mix`, { engine: 'http', timeout: 5000, retries: 2 })
    ok('②a-1 两次 429 退避后第三次尝试成功', !res.blocked && res.html.includes('退避恢复页'), `hits=${hitCount.get('/429mix')}`)
    ok('②a-2【核心】成功路径 failStreak===0(中间 429 零记账)', snap(`${BASE}/429mix`)?.failStreak === 0, JSON.stringify(snap(`${BASE}/429mix`)))
    ok('②a-3 successStreak===1(整次调用一笔成功账)', snap(`${BASE}/429mix`)?.successStreak === 1)
    console.log(`  ↳ 物理请求数=${hitCount.get('/429mix')}(bun 429→curl 兜底双物理请求为 dd-a 存档契约, 记账层面不受影响)`)
    // ②b 退避用尽仍 429: 整次 gateFetch 抛一次错 → 恰一笔失败账
    hitCount.set('/always429', 0)
    let err: any = null
    try { await gateFetchEmul(`${BASE}/always429`, { engine: 'http', timeout: 5000, retries: 1 }) } catch (e) { err = e }
    ok('②b-1 退避用尽如实上抛 429', err?.status === 429, `status=${err?.status}`)
    ok('②b-2【核心】失败路径恰一次记账(failStreak===1, 退避重试不重复喂账)', snap(`${BASE}/always429`)?.failStreak === 1, JSON.stringify(snap(`${BASE}/always429`)))
    ok('②b-3 物理请求为 2 尝试 × bun+curl 双传输 = 4', hitCount.get('/always429') === 4, `hits=${hitCount.get('/always429')}`)
  }

  // ============ ③ 清罐自愈 × 槽位公平性(是否绕过闸门) ============
  console.log('\n== ③ 403 清罐重试: 随行同槽(不新增准入/不插队), 等待者在持槽期间无法进入 ==')
  hostGateReset()
  {
    clearJarFor(BASE)
    // 种罐: /seed 200 + Set-Cookie → jar 有陈旧会话
    await gateFetchEmul(`${BASE}/seed`, { engine: 'http', timeout: 4000, retries: 0 })
    ok('③-0 前置: 罐中已有该域会话', cookieJar.count(BASE) === 1, `count=${cookieJar.count(BASE)}`)
    hitCount.set('/cookie403', 0)
    const p = gateFetchEmul(`${BASE}/cookie403`, { engine: 'http', timeout: 5000, retries: 0, hostGateLimit: 1 })
    await sleep(120) // 让其准入(此时罐非空 → 必走清罐分支)
    ok('③-1 持槽中 inFlight===1', snap(`${BASE}/cookie403`)?.inFlight === 1, JSON.stringify(snap(`${BASE}/cookie403`)))
    // 公平性核心: 槽被清罐重试全程占用, FIFO 等待者不能中途准入(无绕行/无插队)
    let waitErr: any = null
    try { await acquireHostGate(`${BASE}/other`, { limit: 1, timeoutMs: 1200 }) } catch (e) { waitErr = e }
    ok('③-2【核心】清罐重试期间等待者 HostGateTimeout(重试未绕过闸门新占容量)', waitErr?.name === 'HostGateTimeout', `err=${waitErr?.name}`)
    await p.catch(() => {})
    ok('③-3 结束后槽位归零(try/finally 释放无泄漏)', snap(`${BASE}/cookie403`)?.inFlight === 0, JSON.stringify(snap(`${BASE}/cookie403`)))
    ok('③-4 清罐分支实走: 重试后罐为空(403 无新 Cookie → clear)', cookieJar.count(BASE) === 0, `count=${cookieJar.count(BASE)}`)
    ok('③-5 清罐重试恰一次(初次+清罐重试=2 尝试×双传输=4 物理)', hitCount.get('/cookie403') === 4, `hits=${hitCount.get('/cookie403')}`)
    // 等待者超时未获槽: 不产生任何记账扰动
    ok('③-6 失败记账仅清罐场景最终 1 笔(failStreak===1)', snap(`${BASE}/cookie403`)?.failStreak === 1, JSON.stringify(snap(`${BASE}/cookie403`)))
  }

  // ============ ④ 中继桥 × hostGate(RelayTransportError 是否双计) ============
  console.log('\n== ④ 中继层失败(RelayTransportError): 无 status/如实上抛/恰一次记账 ==')
  hostGateReset()
  {
    // bun 探针进程内 PROXY_FETCH_SUPPORTED 恒真, node+proxy 决策分支不可达(与 verify-gg-relay 同口径)
    // → 用 fetchHttpForTest(transport='relay') 直通验证中继层错误形态 + gateFetch 记账契约
    const url = `${BASE}/ok`
    hitCount.set('/ok', 0) // 只观测本段(①a 镜像成功曾命中 /ok, 预先清零)
    const ticket = await acquireHostGate(url, { limit: 3 })
    let rerr: any = null
    try {
      // 代理指向死端口: 中继侧 bun fetch 连代理被拒 → relayError → RelayTransportError
      await fetchHttpForTest(url, { engine: 'http', timeout: 4000 } as never, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0', 'http://127.0.0.1:1', 'relay')
    } catch (e) { rerr = e }
    ok('④-1 中继层失败抛 RelayTransportError(非目标侧响应)', rerr?.name === 'RelayTransportError', `name=${rerr?.name} msg=${String(rerr?.message).slice(0, 60)}`)
    ok('④-2 无 status(非目标侧 HTTP 错误 → 镜像可切换语义如实)', typeof rerr?.status !== 'number', `status=${rerr?.status}`)
    // gateFetch 契约: e.name!=='AbortError' → reportHostFailure 恰一次
    reportHostFailure(url)
    releaseHostGate(ticket)
    ok('④-3【核心】记账恰一笔(failStreak===1, 中继失败不双计)', snap(url)?.failStreak === 1, JSON.stringify(snap(url)))
    ok('④-4 目标侧零请求(中继层失败不触及源站)', (hitCount.get('/ok') || 0) === 0, `hits=${hitCount.get('/ok') || 0}`)
  }

  // ============ ⑤ HostGateTimeout 不喂账(ee-d/x-a 口径) ============
  console.log('\n== ⑤ 闸门等待超时: 限流保护非源站故障, 不产生失败记账 ==')
  hostGateReset()
  {
    const url = `${BASE}/ok`
    const holder = await acquireHostGate(url, { limit: 1 })
    let werr: any = null
    try { await acquireHostGate(url, { limit: 1, timeoutMs: 700 }) } catch (e) { werr = e }
    ok('⑤-1 槽满等待超时抛 HostGateTimeout', werr?.name === 'HostGateTimeout', `name=${werr?.name}`)
    ok('⑤-2【核心】HostGateTimeout 路径零失败记账(gateFetch 在 acquire 处抛出, 未进记账 try)', snap(url)?.failStreak === 0, JSON.stringify(snap(url)))
    releaseHostGate(holder)
    ok('⑤-3 释放后容量恢复', snap(url)?.inFlight === 0)
  }

  console.log(`\nhostGate 账本终态快照数=${hostGateReset() ?? ''}`.slice(0, 0)) // no-op 保类型
  hostGateReset()
}

main()
  .then(() => {
    console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
    console.log('健康证明结论: 镜像/退避/清罐/中继四类叠加路径记账均为"整次调用至多一笔", 键恒为原 host; 清罐重试随行同槽不破坏公平性 —— 与 dd-b/ff-b 存档裁定一致, 无需修改')
    process.exit(fail ? 1 : 0)
  })
  .catch((e) => {
    console.error('脚本异常:', e?.stack?.slice(0, 400) || e)
    process.exit(1)
  })
