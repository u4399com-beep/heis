// 因子隔离: A=单server+GET+sleep15; B=单server+POST+sleep15; C=单server+GET+upstream15(单listener)
const mode = process.argv[2]
const up = mode === 'upstream15' ? Bun.serve({ port: 3997, idleTimeout: 0, async fetch() { await new Promise((r) => setTimeout(r, 15000)); return new Response('slow') } }) : null
Bun.serve({
  port: 3995,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (mode === 'post') await req.text()
    if (mode === 'upstream15') await fetch('http://127.0.0.1:3997/slow').then((r) => r.text())
    else await new Promise((r) => setTimeout(r, 15000))
    return new Response('done-' + mode)
  },
})
console.log(`up mode=${mode}`)
