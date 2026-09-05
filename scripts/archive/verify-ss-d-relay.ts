export {}
// ============================================================
// ss-d2 — fetch-relay(3011) 修复闭环断言(全回环不出网)
// 收编 scripts/.ss-d-tmp/{probe-relay-caps2,probe-relay-slow,idle-*} 长期逻辑, 探针目录已归档
// 断言面:
//   A 残改回归(ss-d 已改, ss-d2 补空体边角): 小响应 200 信封 / 响应体>20MB 流式截断 502 /
//     请求体 content-length 预检 502 / 请求体流式(chunked)硬帽 502 / 非JSON·空体·null·数字体 →
//     502 {relayError}(禁 Bun 500 错误页 — ss-d2 实锤残改回归点) / url·proxy 形态非法 502
//   B idleTimeout 实证: 上游静默 15s(Bun 缺省 idleTimeout ≈10-12s 必杀窗口) → 显式
//     RELAY_IDLE_TIMEOUT_S=200 下 200 信封存活; timeoutMs 小帽仍触发 AbortSignal 502
//   C 契约保持: 302 手动逐跳信封(Location 头穿透) / setCookie 多条专用通道 / 头组穿透
// 运行: bun scripts/verify-ss-d-relay.ts   (前置: 3011 fetch-relay 存活)
// ============================================================

import { connect } from 'node:net'

/** raw socket 手工 chunked POST(无 content-length): 6×256KB 逐块 5ms 投递, 直击流式硬帽路径 */
function rawChunkedPost(): Promise<{ status: number; body: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let buf = ''
    let done = false
    const finish = () => {
      if (done) return
      done = true
      const m = buf.match(/^HTTP\/1\.1 (\d{3})/)
      const bi = buf.indexOf('\r\n\r\n')
      resolve({ status: m ? Number(m[1]) : 0, body: bi >= 0 ? buf.slice(bi + 4) : buf, ms: Date.now() - t0 })
    }
    const sock = connect({ port: 3011, host: '127.0.0.1' }, () => {
      sock.write('POST /fetch HTTP/1.1\r\nHost: 127.0.0.1:3011\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n')
      const chunk = new Uint8Array(256 * 1024).fill(112)
      let i = 0
      const step = () => {
        if (done) return
        if (i < 6) {
          i++
          sock.write(`${chunk.byteLength.toString(16)}\r\n`)
          sock.write(chunk)
          sock.write('\r\n')
          setTimeout(step, 5)
        } else {
          sock.write('0\r\n\r\n')
        }
      }
      step()
    })
    sock.on('data', (d: Buffer) => {
      buf += d.toString()
      if (buf.includes('relayError')) { try { sock.destroy() } catch {} finish() }
    })
    sock.on('close', finish)
    sock.on('error', finish)
    setTimeout(finish, 15000)
  })
}

const RELAY = 'http://127.0.0.1:3011'
const MOCK = 42721

// 最小 Bun 类型面(运行时由 bun 提供真实实现, 与 verify-dd-b-mirror.ts 同惯例)
declare const Bun: {
  serve(options: {
    port: number
    hostname: string
    idleTimeout: number
    fetch: (req: Request) => Response | Promise<Response>
  }): { stop(closeActiveConnections?: boolean): void }
}
const results: { name: string; pass: boolean; detail: string }[] = []
const ok = (name: string, pass: boolean, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const mock = Bun.serve({
  port: MOCK,
  hostname: '127.0.0.1',
  idleTimeout: 0, // mock 自身永不 idle 杀, 被测对象是 relay
  async fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/slow15') {
      await new Promise((r) => setTimeout(r, 15000))
      return new Response('slow-ok-' + 'x'.repeat(200))
    }
    if (u.pathname === '/slow5') {
      await new Promise((r) => setTimeout(r, 5000))
      return new Response('slow5-ok')
    }
    if (u.pathname === '/big') return new Response(new Uint8Array(21 * 1024 * 1024))
    if (u.pathname === '/start') {
      const h = new Headers()
      h.set('Location', '/final')
      h.append('Set-Cookie', 'a=1; Path=/')
      h.append('Set-Cookie', 'b=2; Path=/')
      return new Response('jump', { status: 302, headers: h })
    }
    if (u.pathname === '/final') {
      return Response.json({
        marker: 'relay-final-ok',
        ua: req.headers.get('user-agent') || '',
        cookie: req.headers.get('cookie') || '',
      })
    }
    return new Response('ok-small')
  },
})

async function relayPost(body: unknown, timeoutMs = 60000): Promise<{ status: number; json: any; ms: number }> {
  const t0 = Date.now()
  const res = await fetch(`${RELAY}/fetch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = { _nonJson: text.slice(0, 120) } }
  return { status: res.status, json, ms: Date.now() - t0 }
}

async function main() {
  // ── A 残改回归面 ──
  const health = await fetch(`${RELAY}/health`).then((r) => r.json() as Promise<any>)
  ok('A0 /health ok+runtime=bun', health.ok === true && health.runtime === 'bun', JSON.stringify(health))

  const p1 = await relayPost({ url: `http://127.0.0.1:${MOCK}/small`, timeoutMs: 15000 })
  ok('A1 小响应 200 信封', p1.status === 200 && p1.json.status === 200 && p1.json.bodyB64 === Buffer.from('ok-small').toString('base64'), `${p1.ms}ms b64len=${p1.json.bodyB64?.length}`)

  const p2 = await relayPost({ url: `http://127.0.0.1:${MOCK}/big`, timeoutMs: 60000 })
  ok('A2 响应体21MB>20MB → 502 流式截断', p2.status === 502 && /响应体超限/.test(p2.json.relayError ?? '') && !p2.json.bodyB64, `${p2.ms}ms ${p2.json.relayError ?? JSON.stringify(p2.json).slice(0, 80)}`)

  const p3 = await relayPost(`{"url":"http://127.0.0.1:${MOCK}/small","pad":"${'p'.repeat(1536 * 1024)}"}`)
  ok('A3 请求体1.5MB>1MB(content-length 预检) → 502', p3.status === 502 && /请求体超限/.test(p3.json.relayError ?? ''), `${p3.ms}ms ${p3.json.relayError ?? ''}`)

  // 无 content-length 的 chunked 流式请求体: Bun fetch+ReadableStream 在 Bun1.3.14 对
  // Bun.serve 有 400/431 客户端伪影(见 worklog 检查点1), 故用 raw socket 手工 chunked 逐块投递,
  // 直击 relay readBodyCapped 流式硬帽真实路径(引擎 undici 客户端同形态)
  const raw = await rawChunkedPost()
  ok('A4 请求体流式(chunked 无 content-length)1.5MB → 502 硬帽', raw.status === 502 && /请求体超限/.test(raw.body) , `${raw.ms}ms HTTP ${raw.status} ${raw.body.slice(0, 80)}`)

  const p5 = await relayPost('{invalid json')
  ok('A5 非JSON → 502 relayError', p5.status === 502 && p5.json.relayError === '请求体非 JSON', JSON.stringify(p5.json).slice(0, 80))

  const p6 = await fetch(`${RELAY}/fetch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '', signal: AbortSignal.timeout(15000) })
  const j6 = (await p6.json()) as any
  ok('A6 空体 → 502 relayError(禁 Bun 500 错误页, ss-d2 翻转)', p6.status === 502 && j6.relayError === '请求体非 JSON', `HTTP ${p6.status} ${JSON.stringify(j6).slice(0, 80)}`)

  const p7 = await relayPost('null')
  ok('A7 字面量 null → 502(非 500 错误页)', p7.status === 502 && p7.json.relayError === '请求体非 JSON', `HTTP ${p7.status}`)
  const p8 = await relayPost('123')
  ok('A8 数字体 → 502(非 500 错误页)', p8.status === 502 && p8.json.relayError === '请求体非 JSON', `HTTP ${p8.status}`)

  const p9 = await relayPost({ url: 'ftp://evil.example/x' })
  ok('A9 url 非 http/https → 502 url 非法', p9.status === 502 && /url 非法/.test(p9.json.relayError ?? ''), JSON.stringify(p9.json).slice(0, 80))
  const p10 = await relayPost({ url: `http://127.0.0.1:${MOCK}/small`, proxy: 'gopher://x' })
  ok('A10 proxy 形态非法 → 502', p10.status === 502 && /proxy 形态非法/.test(p10.json.relayError ?? ''), JSON.stringify(p10.json).slice(0, 80))

  // ── B idleTimeout 面 ──
  const b1 = await relayPost({ url: `http://127.0.0.1:${MOCK}/slow15`, timeoutMs: 30000 }, 45000)
  const b1body = b1.json.bodyB64 ? Buffer.from(b1.json.bodyB64, 'base64').toString('utf8') : ''
  ok('B1 上游静默15s 存活(idleTimeout=200 实证, 缺省≈10-12s 必杀)', b1.status === 200 && b1.json.status === 200 && b1body.startsWith('slow-ok'), `${b1.ms}ms body=${b1body.slice(0, 12)} err=${b1.json.relayError ?? 'none'}`)

  const b2 = await relayPost({ url: `http://127.0.0.1:${MOCK}/slow5`, timeoutMs: 1500 })
  ok('B2 timeoutMs 小帽仍生效(AbortSignal → 502 TimeoutError)', b2.status === 502 && /Timeout|abort|time/i.test(b2.json.relayError ?? ''), `${b2.ms}ms ${b2.json.relayError ?? ''}`)

  // ── C 契约保持面 ──
  const c1 = await relayPost({ url: `http://127.0.0.1:${MOCK}/start`, timeoutMs: 10000 })
  const loc = (c1.json.headers ?? []).find((h: [string, string]) => h[0].toLowerCase() === 'location')?.[1]
  const sc = c1.json.setCookie ?? []
  ok('C1 302 manual 逐跳信封(status/Location 穿透)', c1.status === 200 && c1.json.status === 302 && loc === '/final', `status=${c1.json.status} loc=${loc}`)
  ok('C2 set-cookie 专用通道保留多条', Array.isArray(sc) && sc.length === 2 && sc[0].startsWith('a=1'), JSON.stringify(sc))
  const c3 = await relayPost({ url: `http://127.0.0.1:${MOCK}/final`, headers: { 'User-Agent': 'ss-d2-ua-probe', Cookie: 'k=v' }, timeoutMs: 10000 })
  const c3body = c3.json.bodyB64 ? JSON.parse(Buffer.from(c3.json.bodyB64, 'base64').toString('utf8')) : null
  ok('C3 头组穿透(UA/Cookie 到达源站)', c3body?.ua === 'ss-d2-ua-probe' && c3body?.cookie === 'k=v', JSON.stringify(c3body))

  const failed = results.filter((r) => !r.pass).length
  console.log(failed === 0 ? `\nALL PASS — fetch-relay 修复闭环 ${results.length}/${results.length}` : `\n${failed}/${results.length} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

process.on('exit', () => { try { mock.stop(true) } catch {} })
main().catch((e) => { console.error('verify ERROR', e instanceof Error ? e.message : e); process.exit(1) })
