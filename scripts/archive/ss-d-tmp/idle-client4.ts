const SLEEP = Number(process.argv[2])
const t0 = Date.now()
try {
  const res = await fetch('http://127.0.0.1:3995/', { method: 'POST', body: '{"a":1}', signal: AbortSignal.timeout(SLEEP * 1000 + 15000) })
  console.log(`OK ${await res.text()} in ${Date.now() - t0}ms`)
} catch (e: any) { console.log(`ERR ${e?.name}: ${String(e?.message).slice(0, 80)} after ${Date.now() - t0}ms`) }
