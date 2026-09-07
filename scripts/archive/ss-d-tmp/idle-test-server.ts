// default idleTimeout server
Bun.serve({
  port: 3990,
  async fetch(req) {
    const u = new URL(req.url)
    const sleepMs = Number(u.searchParams.get('sleep') || '0')
    if (sleepMs) await new Promise((r) => setTimeout(r, sleepMs))
    return new Response('done-default')
  },
})
// idleTimeout: 0 (disabled?) server
Bun.serve({
  port: 3991,
  idleTimeout: 0,
  async fetch(req) {
    const u = new URL(req.url)
    const sleepMs = Number(u.searchParams.get('sleep') || '0')
    if (sleepMs) await new Promise((r) => setTimeout(r, sleepMs))
    return new Response('done-zero')
  },
})
console.log('test servers up')
