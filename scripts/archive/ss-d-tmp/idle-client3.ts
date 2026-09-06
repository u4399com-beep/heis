const mode = process.argv[2]
const t0 = Date.now()
try {
  const res = await fetch('http://127.0.0.1:3995/', mode === 'post15' ? { method: 'POST', body: JSON.stringify({ a: 1 }), headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(45000) } : { signal: AbortSignal.timeout(45000) })
  console.log(`OK ${await res.text()} in ${Date.now() - t0}ms`)
} catch (e: any) { console.log(`ERR ${e?.name}: ${String(e?.message).slice(0, 80)} after ${Date.now() - t0}ms`) }
