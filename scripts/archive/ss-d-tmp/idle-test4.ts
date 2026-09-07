// POST 长时 survival 探测: sleep 秒数由 query 指定
const SLEEP = Number(process.argv[2] || 15)
Bun.serve({
  port: 3995,
  hostname: '127.0.0.1',
  async fetch(req) { await req.text(); await new Promise((r) => setTimeout(r, SLEEP * 1000)); return new Response(`done-${SLEEP}s`) },
})
console.log('up')
