async function probe(port: number, sleepMs: number, label: string) {
  const t0 = Date.now()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/?sleep=${sleepMs}`, { signal: AbortSignal.timeout(40000) })
    const text = await res.text()
    console.log(`${label}: HTTP ${res.status} "${text}" in ${Date.now() - t0}ms`)
  } catch (e: any) {
    console.log(`${label}: ERROR ${e?.name}: ${e?.message} after ${Date.now() - t0}ms`)
  }
}
await probe(3990, 3000, 'default idle / 3s sleep (control)')
await probe(3990, 15000, 'default idle / 15s sleep')
await probe(3991, 15000, 'idleTimeout=0 / 15s sleep')
await probe(3990, 35000, 'default idle / 35s sleep (vs bqg713 idleTimeout:30)')
