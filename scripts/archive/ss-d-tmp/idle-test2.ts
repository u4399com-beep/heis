// 复现实验: 单进程单 server, default idleTimeout, handler sleep 15s — 三次独立运行
const mode = process.argv[2] // 'sleep15' | 'sleep35' | 'upstream15'
Bun.serve({
  port: 3995,
  async fetch() {
    if (mode === 'upstream15') {
      await fetch('http://127.0.0.1:3996/slow', { signal: AbortSignal.timeout(30000) }).then((r) => r.text())
      return new Response('upstream-done')
    }
    await new Promise((r) => setTimeout(r, mode === 'sleep35' ? 35000 : 15000))
    return new Response('done')
  },
})
Bun.serve({ port: 3996, idleTimeout: 0, async fetch() { await new Promise((r) => setTimeout(r, 15000)); return new Response('slow') } })
console.log(`server up mode=${mode}`)
