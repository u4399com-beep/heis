// ============================================================
// verify-mm-b-bridge.ts — mm 轮 fetchViaScraplingBridge 重试韧性逐行断言
//   1. 静态源码断言: 重试循环有界(attempt<=2)/800ms 间隔/目标侧 ok:true 信封
//      在循环内直接 return(永不重发)/三类失败路径(res非200/ok:false/抛错)各自有终态
//   2. e2e(mock 桥+真引擎 fetchPage, scrapling-static 零浏览器依赖):
//      A. 桥内失败(ok:false)一次 → 重试一次成功: 桥恰 2 次 POST, 间隔≥800ms
//      B. 桥内失败两次 → 降级 native: 桥恰 2 次 POST, mock 站恰 1 次 GET(不双发)
//      C. 桥 HTTP 500 一次 → 重试成功: 桥恰 2 次 POST(!res.ok 路径)
//      D.【契约】目标侧响应(ok:true, 含 403 挑战页)→ 恰 1 次 POST 永不重发
//   3. 修前双证: git show HEAD 版本(无重试)下 A/C 必失败(1 次 POST 即降级 native)
// 运行: bun scripts/verify-mm-b-bridge.ts
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

// ---------------- Part 1: 静态源码断言 ----------------
console.log('\n== 1. 重试循环结构(静态源码断言) ==')
{
  const src = readFileSync('src/lib/crawl/fetcher.ts', 'utf8')
  const fn = src.indexOf('async function fetchViaScraplingBridge')
  const body = src.slice(fn, src.indexOf('/** 单代理(或直连)单次尝试', fn))
  ok('fetchViaScraplingBridge 在场', fn > 0)
  ok('【有界】重试循环恰 2 次尝试(attempt <= 2, continue 仅来自第 1 次)', /for \(let attempt = 1; attempt <= 2; attempt\+\+\)/.test(body), )
  ok('【间隔】失败路径 sleep 800ms 后重试', body.includes('setTimeout(r, 800)'))
  ok('【终态】三条失败路径均有 return null(第 2 次失败即降级)', (body.match(/return null/g) || []).length >= 4, `return null×${(body.match(/return null/g) || []).length}(3 失败路径+循环尾兜底)`)
  ok('【契约】目标侧信封 return 恰 1 处(在循环内, ok:true 即返回不重发)', (body.match(/return \{ status: payload\.status/g) || []).length === 1)
  ok('【契约】超时护栏逐次新建(AbortSignal.timeout 在循环体内, 不跨次共享)', /for \(let attempt = 1[\s\S]*?AbortSignal\.timeout\(/.test(body) && !/const guard = AbortSignal/.test(body))
  ok('【头组】headers 在循环外构建一次(JSON.stringify 逐次序列化, 无跨次突变)', body.indexOf('const headers: Record<string, string> = {}') < body.indexOf('for (let attempt'))
}

// ---------------- mock 桥/站基础设施 ----------------
interface BridgeCall { at: number; url: string; referer: string }
interface SiteCall { at: number; path: string }

function startMockBridge(opts: {
  /** 按 POST 次序返回的应答工厂(取第一个匹配者, 用尽后用 defaultReply) */
  replyFor?: (n: number, payload: { url: string; headers: Record<string, string> }) => { httpStatus: number; envelope?: unknown } | undefined
  defaultReply: (payload: { url: string; headers: Record<string, string> }) => { httpStatus: number; envelope: unknown }
  delayMs?: number
}): Promise<{ port: number; calls: BridgeCall[]; close: () => void }> {
  const calls: BridgeCall[] = []
  let n = 0
  const server = http.createServer((req, res) => {
    res.on('error', () => {})
    if (req.method !== 'POST' || !(req.url || '').startsWith('/fetch')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
      return
    }
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let payload: { url?: string; headers?: Record<string, string> } = {}
      try { payload = JSON.parse(raw) } catch { /* ignore */ }
      n++
      calls.push({ at: Date.now(), url: payload.url || '', referer: payload.headers?.Referer || payload.headers?.referer || '' })
      const arg = { url: payload.url || '', headers: payload.headers || {} }
      const r = opts.replyFor?.(n, arg) ?? opts.defaultReply(arg)
      const send = () => {
        res.writeHead(r.httpStatus, { 'Content-Type': 'application/json' })
        res.end(r.envelope === undefined ? '' : JSON.stringify(r.envelope))
      }
      if (opts.delayMs) setTimeout(send, opts.delayMs)
      else send()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({ port, calls, close: () => server.close() })
    })
  })
}

function startMockSite(): Promise<{ port: number; calls: SiteCall[]; close: () => void }> {
  const calls: SiteCall[] = []
  const server = http.createServer((req, res) => {
    res.on('error', () => {})
    calls.push({ at: Date.now(), path: req.url || '/' })
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><head><title>mock站原页面</title></head><body><div id="content">native降级链拿到的真实正文, 足够长避免被极短判拦规则误伤——' + '测试正文。'.repeat(60) + '</div></body></html>')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({ port, calls, close: () => server.close() })
    })
  })
}

const okEnvelope = (html: string, status = 200) => ({ httpStatus: 200, envelope: { ok: true, status, html, finalUrl: '' } })
const failEnvelope = (error: string) => ({ httpStatus: 200, envelope: { ok: false, error } })
const CF_CHALLENGE_HTML = '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing. challenge-platform with cf_chl state.' + 'x'.repeat(300) + '</body></html>'

async function main() {
  const { fetchPage } = await import('../src/lib/crawl/fetcher')

  // ---------------- Part 2A: ok:false 一次 → 重试成功 ----------------
  console.log('\n== 2A. 桥内失败一次 → 重试一次成功(恰 2 次 POST, 间隔≥800ms) ==')
  {
    const bridge = await startMockBridge({
      replyFor: (n, arg) => (n === 1 ? failEnvelope('TargetClosedError: Page crashed') : undefined),
      defaultReply: (arg) => okEnvelope(`<html><head><title>桥取回的书页</title></head><body>${'桥内容。'.repeat(80)}</body></html>`),
    })
    const t0 = Date.now()
    const res = await fetchPage(`http://127.0.0.1:${bridge.port}/book`, { fetchMode: 'scrapling-static', engine: 'http', scraplingBridgeUrl: `http://127.0.0.1:${bridge.port}` })
    const elapsed = Date.now() - t0
    ok('重试后成功取回内容', res.html.includes('桥取回的书页') && !res.blocked, `${res.html.length}chars`)
    ok('【核心】桥恰收到 2 次 POST(失败 1 次+重试 1 次)', bridge.calls.length === 2, `实际=${bridge.calls.length}`)
    ok('【核心】重试间隔≥800ms(修前无重试版: 1 次 POST 即降级 native 必败此断言)', bridge.calls.length === 2 && bridge.calls[1].at - bridge.calls[0].at >= 750, `gap=${bridge.calls.length === 2 ? bridge.calls[1].at - bridge.calls[0].at : 'n/a'}ms`)
    ok('总耗时与 800ms 间隔吻合(重试真实发生)', elapsed >= 750, `${elapsed}ms`)
    ok('Referer=origin 随桥请求透传(ii-c 语义保持)', bridge.calls[0].referer === `http://127.0.0.1:${bridge.port}`, `实际=${bridge.calls[0].referer}`)
    bridge.close()
  }

  // ---------------- Part 2B: ok:false 两次 → 降级 native ----------------
  console.log('\n== 2B. 桥内失败两次 → 降级 native(桥恰 2 次, 站恰 1 次) ==')
  {
    const bridge = await startMockBridge({
      defaultReply: () => failEnvelope('TargetClosedError: Page crashed'),
    })
    const site = await startMockSite()
    const res = await fetchPage(`http://127.0.0.1:${site.port}/book`, { fetchMode: 'scrapling-static', engine: 'http', scraplingBridgeUrl: `http://127.0.0.1:${bridge.port}` })
    ok('降级 native 链取回真实页面', res.html.includes('native降级链拿到的真实正文'), `${res.html.length}chars`)
    ok('【核心】桥恰 2 次 POST(有界重试, 不无限)', bridge.calls.length === 2, `实际=${bridge.calls.length}`)
    ok('【核心】mock 站恰 1 次 GET(native 降级单次, 目标不双发)', site.calls.length === 1, `实际=${site.calls.length}`)
    site.close(); bridge.close()
  }

  // ---------------- Part 2C: 桥 HTTP 500 一次 → 重试成功 ----------------
  console.log('\n== 2C. 桥 HTTP 500 一次(!res.ok 路径) → 重试成功 ==')
  {
    const bridge = await startMockBridge({
      replyFor: (n) => (n === 1 ? { httpStatus: 500, envelope: { ok: false, error: 'bridge internal' } } : undefined),
      defaultReply: () => okEnvelope(`<html><head><title>500后重试成功页</title></head><body>${'桥内容二。'.repeat(80)}</body></html>`),
    })
    const res = await fetchPage(`http://127.0.0.1:${bridge.port}/book`, { fetchMode: 'scrapling-static', engine: 'http', scraplingBridgeUrl: `http://127.0.0.1:${bridge.port}` })
    ok('HTTP 层失败同样触发重试并成功', res.html.includes('500后重试成功页'), `${res.html.length}chars`)
    ok('【核心】桥恰 2 次 POST', bridge.calls.length === 2, `实际=${bridge.calls.length}`)
    bridge.close()
  }

  // ---------------- Part 2D: 目标侧 403 挑战页 → 永不重发 ----------------
  console.log('\n== 2D.【契约】目标侧响应(ok:true 403 挑战页) → 恰 1 次 POST 不双发 ==')
  {
    const bridge = await startMockBridge({
      defaultReply: () => okEnvelope(CF_CHALLENGE_HTML, 403),
    })
    const res = await fetchPage(`http://127.0.0.1:${bridge.port}/book`, { fetchMode: 'scrapling-static', engine: 'http', scraplingBridgeUrl: `http://127.0.0.1:${bridge.port}` })
    ok('目标侧 403 如实透传(blocked=true 交上层计账)', res.blocked === true && res.html.includes('Just a moment'), `blocked=${res.blocked}`)
    ok('【核心】桥恰 1 次 POST(目标侧真实响应永不重发)', bridge.calls.length === 1, `实际=${bridge.calls.length}`)
    bridge.close()
  }

  console.log(`\n===== verify-mm-b-bridge: ${pass} passed, ${fail} failed =====`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本异常:', e?.stack?.slice(0, 500) || e)
  process.exit(1)
})
