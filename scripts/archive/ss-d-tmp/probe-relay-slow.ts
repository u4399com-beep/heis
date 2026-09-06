// probe-ss-d: fetch-relay(3011) 慢上游(15s)是否被 Bun 缺省 idleTimeout 杀连接
// 预期(修复前): ERROR socket closed; 预期(修复后): 200 信封 slow-ok
const MOCK_PORT = 42711
Bun.serve({
  port: MOCK_PORT,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch() {
    await new Promise((r) => setTimeout(r, 15000))
    return new Response('slow-ok-' + 'x'.repeat(200))
  },
})
const t0 = Date.now()
try {
  const res = await fetch('http://127.0.0.1:3011/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `http://127.0.0.1:${MOCK_PORT}/slow`, timeoutMs: 30000 }),
    signal: AbortSignal.timeout(40000),
  })
  const j: any = await res.json()
  const body = j.bodyB64 ? Buffer.from(j.bodyB64, 'base64').toString('utf8') : ''
  console.log(`PROBE ${res.status} relayStatus=${j.status} body=${body.slice(0, 20)} in ${Date.now() - t0}ms relayError=${j.relayError ?? 'none'}`)
  console.log(j.status === 200 && body.startsWith('slow-ok') ? 'PROBE PASS' : 'PROBE FAIL(信封形态不对)')
} catch (e: any) {
  console.log(`PROBE FAIL ${e?.name}: ${String(e?.message).slice(0, 120)} after ${Date.now() - t0}ms`)
}
process.exit(0)
