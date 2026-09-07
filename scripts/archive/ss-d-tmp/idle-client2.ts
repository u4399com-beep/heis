const t0 = Date.now()
try {
  const res = await fetch('http://127.0.0.1:3995/', { signal: AbortSignal.timeout(45000) })
  console.log(`OK ${await res.text()} in ${Date.now() - t0}ms`)
} catch (e: any) {
  console.log(`ERR ${e?.name}: ${String(e?.message).slice(0, 100)} after ${Date.now() - t0}ms`)
}
