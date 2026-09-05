// probe-ss-d: fetch-relay 请求体/响应体上限翻转断言
const MOCK = 42712
Bun.serve({
  port: MOCK, hostname: '127.0.0.1', idleTimeout: 0,
  fetch(req) {
    if (new URL(req.url).pathname === '/big') return new Response(new Uint8Array(21 * 1024 * 1024))
    return new Response('ok-small')
  },
})
async function post(body: unknown | string) {
  const t0 = Date.now()
  const res = await fetch('http://127.0.0.1:3011/fetch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  const j: any = await res.json()
  return `${res.status} relayError=${j.relayError ?? 'none'} status=${j.status ?? '-'} b64len=${j.bodyB64?.length ?? 0} (${Date.now() - t0}ms)`
}
console.log('P1 小响应正常:', await post({ url: `http://127.0.0.1:${MOCK}/small`, timeoutMs: 15000 }))
console.log('P2 响应21MB>20MB帽:', await post({ url: `http://127.0.0.1:${MOCK}/big`, timeoutMs: 60000 }))
console.log('P3 请求体1.5MB>1MB帽:', await post('{"url":"http://127.0.0.1:' + MOCK + '/small","pad":"' + 'p'.repeat(1536 * 1024) + '"}'))
console.log('P4 请求体非JSON:', await post('{invalid json'))
process.exit(0)
