// ============================================================
// ii-c 深审验证②: fetcher.ts fetchMode=scrapling-* × 既有能力 叠加矩阵
//
// 段A refererChain/refererUrl × scrapling(ii-c 修复证据): 修前 runner 注入的链 Referer
//     在 scrapling 模式被静默丢失(bridge headers 只组 cfg.headers+cookies) → 修后与
//     native buildHeaders 同语义(链 Referer > origin 回退 > cfg.referer:false 关闭)
// 段B proxyUrl × scrapling: 非回环目标代理透传 body.proxy / 回环目标豁免 / 桥调用本身恒直连
// 段C tokenUrl 预取 × scrapling: 分流点在 fetchPageOnce 顶层(预取之前) → scrapling 模式
//     预取跳过、{token} 占位符原样交桥(hh-c 存档语义, 本脚本固化为守护断言)
// 段D scrapling 桥不可达 → native 链 × mirrorDomains: 传输层失败降级后镜像切换照常
// 段E hostgate × scrapling 记账: blocked+非JSON → 失败喂给降额(3连败 limit 3→2);
//     正常内容 → 成功(10连升 limit 回升 3) —— 与 runner.gateFetch 记账条件同构
// 段F fetchMode × engine 优先序: scrapling-* 在 fetchPageOnce 顶层先于 engine 分支
// 段G 目标侧响应如实透传: 403+正常长页 → blocked=false 不抛错(与 native throw 语义差异,
//     hh-c 存档); 200+挑战页 → blocked=true; ok:false 信封 → native 恰一次不双发
// 产物: tmp/ii-c/verify-ii-c-fetchmode.json; 显式 process.exit(0)
// ============================================================
import { fetchPage } from '../src/lib/crawl/fetcher'
import { hostGateReset, acquireHostGate, releaseHostGate, reportHostFailure, reportHostSuccess, hostGateSnapshot, hostGateKeyOf } from '../src/lib/crawl/hostgate'
import { parseJsonBody } from '../src/lib/crawl/parser'
import { writeFileSync } from 'node:fs'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'

let pass = 0
let fail = 0
const failures: string[] = []
function ok(cond: boolean, label: string) {
  if (cond) { pass++ } else { fail++; failures.push(label) }
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}`)
}

function httpServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ srv: Server; port: number }> {
  return new Promise((resolve) => {
    const srv = createServer(handler)
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: (srv.address() as { port: number }).port }))
  })
}

interface BridgeCall { body: { url: string; mode: string; proxy?: string; headers: Record<string, string>; timeoutMs: number }; at: number }

const LONG_HTML = '<html><head><title>Normal Page Title</title></head><body>' + 'payload-text-0123456789-'.repeat(80) + '</body></html>'
const CHALLENGE_HTML = '<html><head><title>请稍候</title></head><body>captcha 验证码</body></html>'
const FORBIDDEN_BODY_HTML = '<html><head><title>Target 403 Body Title</title></head><body>' + 'denied-payload-0123456789-'.repeat(80) + '</body></html>'

async function main() {
  const result: Record<string, unknown> = {}
  // —— mock scrapling 桥: 记录每次调用, 信封可控 ——
  const bridgeCalls: BridgeCall[] = []
  let bridgeEnvelope: (call: BridgeCall) => unknown = () => ({ ok: true, status: 200, html: LONG_HTML, finalUrl: '' })
  let bridgeHttpFail = false // 桥进程存活但 HTTP 500(可观测的传输层失败形态, 触发降级)
  const bridge = await httpServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      const call: BridgeCall = { body, at: Date.now() }
      bridgeCalls.push(call)
      if (bridgeHttpFail) { res.statusCode = 500; res.end('bridge internal error') ; return }
      const payload = bridgeEnvelope(call) as Record<string, unknown>
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(payload))
    })
  })
  // —— mock 目标站 A(403 源)/ B(正常源)/ token 源 ——
  let targetAHits = 0
  const targetA = await httpServer((req, res) => { targetAHits++; res.statusCode = 403; res.setHeader('content-type', 'text/html'); res.end(CHALLENGE_HTML) })
  let targetBHits = 0
  const targetB = await httpServer((req, res) => { targetBHits++; res.setHeader('content-type', 'text/html'); res.end(LONG_HTML.replace('Normal Page Title', 'Mirror B Title')) })
  let tokenHits = 0
  const tokenSrv = await httpServer((req, res) => { tokenHits++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: { token: 'tok-abc-123' } })) })
  let nativeHits = 0
  const nativeTarget = await httpServer((req, res) => { nativeHits++; res.setHeader('content-type', 'text/html'); res.end(LONG_HTML.replace('Normal Page Title', 'Native Fallback Title')) })

  try {
    const bridgeBase = `http://127.0.0.1:${bridge.port}`
    console.log('=== A refererChain × scrapling(修复证据) ===')
    {
      bridgeCalls.length = 0
      const r = await fetchPage('http://caller.example/book/1.html', { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase, refererChain: true, refererUrl: 'http://caller.example/toc/1.html' })
      ok(r.html === LONG_HTML && bridgeCalls.length === 1, 'A0 scrapling 桥单次命中')
      ok(bridgeCalls[0].body.headers.Referer === 'http://caller.example/toc/1.html', `A1 链 Referer=refererUrl(修前 undefined, 实际 ${bridgeCalls[0].body.headers.Referer})`)

      bridgeCalls.length = 0
      await fetchPage('http://caller.example/book/1.html', { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase })
      ok(bridgeCalls[0].body.headers.Referer === 'http://caller.example/book/1.html' || bridgeCalls[0].body.headers.Referer === 'http://caller.example', `A2 未启用链 → origin 回退(实际 ${bridgeCalls[0].body.headers.Referer})`)

      bridgeCalls.length = 0
      await fetchPage('http://caller.example/book/1.html', { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase, referer: false })
      ok(!bridgeCalls[0].body.headers.Referer, `A3 referer:false → 无 Referer(实际 ${String(bridgeCalls[0].body.headers.Referer)})`)

      bridgeCalls.length = 0
      await fetchPage('http://caller.example/book/1.html', { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase, refererChain: true, refererUrl: 'http://caller.example/toc/2.html', headers: { Referer: 'http://explicit.example/x' } })
      ok(bridgeCalls[0].body.headers.Referer === 'http://caller.example/toc/2.html', `A4 链 Referer 优先于规则显式头(与 buildHeaders 次序一致, 实际 ${bridgeCalls[0].body.headers.Referer})`)

      bridgeCalls.length = 0
      await fetchPage('http://caller.example/book/1.html', { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase, headers: { Referer: 'http://explicit.example/x' } })
      ok(bridgeCalls[0].body.headers.Referer === 'http://caller.example/book/1.html' || bridgeCalls[0].body.headers.Referer === 'http://caller.example', `A5 规则显式头被 origin 回退覆盖(与 native buildHeaders 同次序, 实际 ${bridgeCalls[0].body.headers.Referer})`)

      bridgeCalls.length = 0
      await fetchPage('http://caller.example/book/1.html', { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase, headers: { 'X-Rule': '1' }, cookies: 'sid=abc' })
      ok(bridgeCalls[0].body.headers['X-Rule'] === '1' && bridgeCalls[0].body.headers.Cookie === 'sid=abc', 'A6 规则 headers/cookies 透传不回退')
    }

    console.log('=== B proxyUrl × scrapling ===')
    {
      bridgeCalls.length = 0
      await fetchPage('http://203.0.113.7/book/1.html', { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase, proxyUrl: 'http://10.0.0.1:8080,http://10.0.0.2:8080' })
      const p = bridgeCalls[0].body.proxy
      ok(p === 'http://10.0.0.1:8080' || p === 'http://10.0.0.2:8080', `B1 非回环目标 → 代理透传 body.proxy(实际 ${String(p)})`)
      ok(bridgeCalls[0].body.url === 'http://203.0.113.7/book/1.html', 'B2 桥收到的目标 URL 原样')

      bridgeCalls.length = 0
      await fetchPage(`http://127.0.0.1:${nativeTarget.port}/page`, { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase, proxyUrl: 'http://10.0.0.1:8080' })
      ok(bridgeCalls[0].body.proxy === undefined, `B3 回环目标 → 代理豁免(实际 ${String(bridgeCalls[0].body.proxy)})`)
    }

    console.log('=== C tokenUrl 预取 × scrapling(存档语义固化) ===')
    {
      bridgeCalls.length = 0
      tokenHits = 0
      const r = await fetchPage('http://api.example/book/{token}.html', { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase, tokenUrl: `http://127.0.0.1:${tokenSrv.port}/token?url={url}`, tokenPattern: 'data.token', tokenInjection: 'url' })
      ok(tokenHits === 0, `C1 scrapling 模式 token 预取跳过(token 服务命中 ${tokenHits} 次)`)
      ok(bridgeCalls.length === 1 && bridgeCalls[0].body.url === 'http://api.example/book/{token}.html', 'C2 {token} 占位符原样交桥(native 注入链不生效)')
      ok(r.html === LONG_HTML, 'C3 桥响应正常返回')
    }

    console.log('=== D 桥传输层失败(HTTP 500, 可观测) → native 降级 × mirrorDomains ===')
    {
      bridgeCalls.length = 0
      bridgeHttpFail = true
      targetAHits = 0
      targetBHits = 0
      const r = await fetchPage(`http://127.0.0.1:${targetA.port}/book/1.html`, {
        engine: 'http',
        fetchMode: 'scrapling-static',
        scraplingBridgeUrl: bridgeBase,
        mirrorDomains: `127.0.0.1:${targetB.port}`,
      })
      // native 链单尝试 = bun fetch 403 → curl 兜底 403(源 A 两次命中); B 一次 bun 200 成功
      ok(targetAHits === 2 && targetBHits === 1, `D1 逐镜像 native 请求(A bun+curl:${targetAHits}/B bun:${targetBHits})`)
      ok(r.html.includes('Mirror B Title') && r.blocked === false, 'D2 桥挂 → native 链 403 → 镜像切换到 B 成功')
      ok(bridgeCalls.length === 2, `D3 每个镜像 host 各走一次桥分流(实际 ${bridgeCalls.length})`)
      bridgeHttpFail = false
    }

    console.log('=== E hostgate × scrapling 记账(与 runner.gateFetch 条件同构) ===')
    {
      hostGateReset()
      const t = `127.0.0.1:${nativeTarget.port}`
      const ticket = await acquireHostGate(`http://${t}/page`, { limit: 3 })
      // E1: 挑战页 → blocked=true → gateFetch 条件(res.blocked && parseJsonBody===undefined)成立 → 失败
      bridgeEnvelope = () => ({ ok: true, status: 200, html: CHALLENGE_HTML, finalUrl: '' })
      const r1 = await fetchPage(`http://${t}/page`, { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase })
      ok(r1.blocked === true && parseJsonBody(r1.html) === undefined, 'E1 scrapling 挑战页 → blocked=true 且非 JSON(gateFetch 失败记账条件命中)')
      reportHostFailure(`http://${t}/page`); reportHostFailure(`http://${t}/page`); reportHostFailure(`http://${t}/page`)
      const snap1 = hostGateSnapshot(`http://${t}/page`)
      ok(snap1?.limit === 2 && snap1.failStreak === 0, `E2 3 连败 → 降额 limit 3→2(实际 ${JSON.stringify(snap1)})`)
      // E3: 正常内容 → blocked=false → 成功 → 回升
      bridgeEnvelope = () => ({ ok: true, status: 200, html: LONG_HTML, finalUrl: '' })
      const r2 = await fetchPage(`http://${t}/page`, { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase })
      ok(r2.blocked === false && hostGateKeyOf(`http://${t}/page`) === t, 'E3 scrapling 正常内容 → blocked=false, 记账键恒原 host')
      for (let i = 0; i < 10; i++) reportHostSuccess(`http://${t}/page`)
      const snap2 = hostGateSnapshot(`http://${t}/page`)
      ok(snap2?.limit === 3, `E4 10 连成功 → limit 回升至基准 3(实际 ${JSON.stringify(snap2)})`)
      releaseHostGate(ticket)
      hostGateReset()
    }

    console.log('=== F fetchMode × engine 优先序 ===')
    {
      bridgeCalls.length = 0
      const r = await fetchPage(`http://127.0.0.1:${nativeTarget.port}/page`, { engine: 'browser', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase })
      ok(bridgeCalls.length === 1 && r.html === LONG_HTML, 'F1 scrapling-* 先于 engine 分支(整次抓取交桥, 不触发浏览器升级链)')
    }

    console.log('=== G 目标侧响应如实透传 + 降级不双发 ===')
    {
      bridgeCalls.length = 0
      nativeHits = 0
      bridgeEnvelope = () => ({ ok: true, status: 403, html: FORBIDDEN_BODY_HTML, finalUrl: '' })
      const r1 = await fetchPage(`http://127.0.0.1:${nativeTarget.port}/page`, { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase })
      ok(r1.html.includes('denied-payload') && r1.blocked === false && nativeHits === 0, `G1 目标侧 403 如实透传(blocked=${r1.blocked}, native 请求 ${nativeHits} 次=不双发)`)
      bridgeCalls.length = 0
      nativeHits = 0
      bridgeEnvelope = () => ({ ok: false, error: 'mock-bridge-inner-fail' })
      const r2 = await fetchPage(`http://127.0.0.1:${nativeTarget.port}/page`, { engine: 'http', fetchMode: 'scrapling-static', scraplingBridgeUrl: bridgeBase })
      ok(bridgeCalls.length === 1 && nativeHits === 1 && r2.html.includes('Native Fallback Title'), `G2 桥内失败(ok:false) → native 恰一次降级(桥 ${bridgeCalls.length}/native ${nativeHits})`)
    }

    bridge.srv.close()
    targetA.srv.close()
    targetB.srv.close()
    tokenSrv.srv.close()
    nativeTarget.srv.close()
  } finally {
    for (const s of [bridge, targetA, targetB, tokenSrv, nativeTarget]) { try { s.srv.close() } catch { /* ignore */ } }
  }

  result.pass = pass
  result.fail = fail
  result.failures = failures
  result.at = Date.now()
  writeFileSync('/home/z/my-project/tmp/ii-c/verify-ii-c-fetchmode.json', JSON.stringify(result, null, 2))
  console.log(`\n=== verify-ii-c-fetchmode: ${pass} pass / ${fail} fail ===`)
  if (failures.length) console.log('FAILURES:', failures.join(' ; '))
  process.exit(fail ? 1 : 0)
}
void main()
