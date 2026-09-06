export {}
// probe-ss-d2: qimao-proxy 三候选(①idleTimeout 缺配 ④上游5xx/429不重试 ⑤/health并发冷启动探针竞态)
// 方法: 复刻 mini-services/qimao-proxy/index.ts 修前原文(upstreamJSON 逐行照抄 + /health 竞态形态照抄),
//       上游指向本进程可控 mock, 逐项实锤修前行为(与 live 服务同构同罪, 因上游域名固定无法注入故障)
const MOCK = 42741

// ---------- mock 上游(命中计数 + 模式) ----------
const hits = new Map<string, number>()
const server = Bun.serve({
  port: MOCK,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(req) {
    const p = new URL(req.url).pathname
    hits.set(p, (hits.get(p) ?? 0) + 1)
    if (p === '/ok') return Response.json({ data: { books: [{ id: '1' }] } })
    if (p === '/flaky-500') {
      if ((hits.get(p) ?? 0) === 1) return Response.json({ errors: 'boom' }, { status: 500 })
      return Response.json({ data: { books: [{ id: '1' }] } })
    }
    if (p === '/flaky-429') {
      if ((hits.get(p) ?? 0) === 1) return Response.json({ errors: 'rate' }, { status: 429 })
      return Response.json({ data: { books: [{ id: '1' }] } })
    }
    if (p === '/always-429') return Response.json({ errors: 'rate' }, { status: 429 })
    if (p === '/slow-13000') {
      await new Promise((r) => setTimeout(r, 13000))
      return Response.json({ data: { books: [] } })
    }
    return Response.json({ data: { books: [] } })
  },
})

// ---------- 修前 upstreamJSON 原文照抄(qimao-proxy/index.ts:86-104, 仅 UA 头省略) ----------
const UPSTREAM_TIMEOUT_MS = 15000
async function upstreamJSON_before(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; json?: any; error?: string }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { ...headers, 'user-agent': 'okhttp/3.12.0' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch { return { ok: false, status: res.status, error: `非JSON响应(${text.length}B): ${text.slice(0, 80)}` } }
      if (!res.ok) return { ok: false, status: res.status, json, error: `上游 ${res.status}: ${JSON.stringify(json?.errors || json?.Status || '').slice(0, 120)}` }
      return { ok: true, status: res.status, json }
    } catch (e) {
      if (attempt === 2) return { ok: false, status: -1, error: `上游网络错误: ${String(e).slice(0, 120)}` }
      await new Promise((r) => setTimeout(r, 600)) // 瞬态韧性: 退避后重试一次
    }
  }
  return { ok: false, status: -1, error: 'unreachable' }
}

// ---------- 修前 /health 探针竞态形态照抄(qimao-proxy/index.ts:142-159, 上游 URL 参数化) ----------
let apiReachable = false
let apiLastCheck = 0
const seen = new Map<string, number>()
async function health_before(): Promise<{ apiReachable: boolean; upstream: number | null }> {
  const now = Date.now()
  if (now - apiLastCheck > 60_000) {
    const r = await upstreamJSON_before(`http://127.0.0.1:${MOCK}/ok`, {})
    apiReachable = r.ok && !!r.json?.data?.books
    apiLastCheck = now
    seen.set('api', r.status)
  }
  return { apiReachable, upstream: seen.get('api') ?? null }
}

// ---------- P1(④): 上游 500 一次后 200 → 修前不重试, 1 命中即败 ----------
{
  const r = await upstreamJSON_before(`http://127.0.0.1:${MOCK}/flaky-500`, {})
  console.log(`P1[④ 5xx不重试] ok=${r.ok} status=${r.status} hits=${hits.get('/flaky-500')} error=${r.error ?? 'none'}`)
  console.log(r.ok === false && hits.get('/flaky-500') === 1 ? '  → 实锤: 5xx 不重试(1命中即败)' : '  → 翻转?')
}
// ---------- P2(④): 429 同罪 ----------
{
  const r = await upstreamJSON_before(`http://127.0.0.1:${MOCK}/flaky-429`, {})
  console.log(`P2[④ 429不重试] ok=${r.ok} status=${r.status} hits=${hits.get('/flaky-429')}`)
  console.log(r.ok === false && hits.get('/flaky-429') === 1 ? '  → 实锤: 429 不重试(1命中即败)' : '  → 翻转?')
}
// ---------- P3(⑤): 冷启动 5 并发 /health → 上游 5 命中(竞态) ----------
{
  apiLastCheck = 0 // 强制冷启动
  const rs = await Promise.all(Array.from({ length: 5 }, () => health_before()))
  console.log(`P3[⑤ health竞态] 并发5 → 上游命中 ${hits.get('/ok') - 1} 次(含 P0 基线扣减) apiReachable 一致=${rs.every((r) => r.apiReachable === rs[0]!.apiReachable)}`)
  console.log((hits.get('/ok') ?? 0) - 1 >= 5 ? '  → 实锤: 并发每请求各打一次上游' : '  → 翻转?')
}
// ---------- P4(①): 无 idleTimeout + 上游静默 13s → 客户端连接被杀 ----------
{
  const replica = Bun.serve({
    port: 42742,
    hostname: '127.0.0.1',
    // 无 idleTimeout(修前 qimao 原样)
    fetch: () => upstreamJSON_before(`http://127.0.0.1:${MOCK}/slow-13000`, {}),
  })
  const t0 = Date.now()
  try {
    const res = await fetch('http://127.0.0.1:42742/', { signal: AbortSignal.timeout(40000) })
    console.log(`P4[① idleTimeout] HTTP ${res.status} in ${Date.now() - t0}ms(未杀? 缺省阈值需复核)`)
  } catch (e: any) {
    console.log(`P4[① idleTimeout] THROW ${e?.name} after ${Date.now() - t0}ms → 实锤: handler 在途静默 >12s 连接被缺省 idleTimeout 杀`)
  }
  replica.stop(true)
}

server.stop(true)
process.exit(0)
