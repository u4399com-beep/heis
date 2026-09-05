const MOCK = 42713
Bun.serve({
  port: MOCK, hostname: '127.0.0.1', idleTimeout: 0,
  fetch(req) {
    if (new URL(req.url).pathname === '/big') return new Response(new Uint8Array(21 * 1024 * 1024))
    return new Response('ok-small')
  },
})
async function post(label: string, body: unknown | string) {
  const t0 = Date.now()
  try {
    const res = await fetch('http://127.0.0.1:3011/fetch', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    })
    const j: any = await res.json()
    console.log(`${label}: HTTP ${res.status} relayError=${j.relayError ?? 'none'} status=${j.status ?? '-'} b64len=${j.bodyB64?.length ?? 0} (${Date.now() - t0}ms)`)
  } catch (e: any) {
    console.log(`${label}: THROW ${e?.name}: ${String(e?.message).slice(0, 80)} (${Date.now() - t0}ms)`)
  }
}
await post('P1 small', { url: `http://127.0.0.1:${MOCK}/small`, timeoutMs: 15000 })
await post('P2 big21MB', { url: `http://127.0.0.1:${MOCK}/big`, timeoutMs: 60000 })
await post('P3 req1.5MB', '{"url":"http://127.0.0.1:' + MOCK + '/small","pad":"' + 'p'.repeat(1536 * 1024) + '"}')
await post('P4 badjson', '{invalid json')
process.exit(0)
