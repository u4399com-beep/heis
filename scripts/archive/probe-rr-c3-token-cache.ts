// ============================================================
// probe-rr-c3-token-cache.ts — rr-c3 疑似真bug#2 复现探针
// 疑点: fetcher.prefetchToken 的进程内 token 缓存(globalThis.__novelTokenPrefetch_v1)
//   - cacheKey = origin|解析后tokenUrl|pattern; {url} 占位符形态(生产 bqg713 规则
//     tokenUrl=http://127.0.0.1:3010/rewrite?url={url} 在用)下解析后URL逐章不同
//   - 命中检查带 30s TTL, 但【未命中的过期条目永远不被删除】且【写入无容量上限】
//   → 长任务逐章写入, Map 无界增长(猎区②: 长任务 Map/Set 无界增长)
// 预期(修前): P1 Map 条目数 === 独立目标数(无上限); P2 人为过期的条目在新写入后仍存活
// 语义守卫(修后必须保持): P3 同目标 30s 内重复请求 token 端点只打 1 次; P4 不同目标各自取到正确 token
// 运行: bun scripts/probe-rr-c3-token-cache.ts (证实=exit 0)
// ============================================================

const results: { name: string; pass: boolean; note: string }[] = []
function record(name: string, pass: boolean, note: string) {
  results.push({ name, pass, note })
  console.log(`${pass ? '✓' : '✗'} [${name}] ${note}`)
}

const BunRT = (globalThis as unknown as { Bun: { serve: (o: { port: number; fetch: (req: Request) => Response }) => { port: number; stop: (f: boolean) => void } } }).Bun

const tokenHits = new Map<string, number>()
const server = BunRT.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/tk') {
      const target = u.searchParams.get('u') || ''
      tokenHits.set(target, (tokenHits.get(target) || 0) + 1)
      // token = f(目标URL): {url} 外置转换代理形态
      return Response.json({ data: { token: 'tk-' + Buffer.from(target).toString('base64url').slice(0, 24) } })
    }
    if (u.pathname === '/guard') return new Response('<html><title>t</title><body>' + 'x'.repeat(300) + '</body></html>')
    return new Response('no', { status: 404 })
  },
})
const base = `http://127.0.0.1:${server.port}`
console.log(`mock server: ${base}`)

const { fetchPage } = await import('../src/lib/crawl/fetcher')

const cfg = {
  engine: 'http' as const,
  tokenUrl: `${base}/tk?u={url}`,
  tokenPattern: 'data.token',
  tokenInjection: 'url' as const,
  timeout: 5000,
  retries: 0,
}

const N = 800
for (let i = 0; i < N; i++) {
  const res = await fetchPage(`${base}/guard?id=${i}`, cfg)
  if (res.blocked) { record('前置: 目标页抓取', false, `第${i}章 blocked`); process.exit(1) }
}

const g = globalThis as unknown as { __novelTokenPrefetch_v1?: Map<string, { token: string; at: number }> }
const cache = g.__novelTokenPrefetch_v1
if (!cache) { record('P1 缓存存在', false, 'globalThis.__novelTokenPrefetch_v1 不存在'); process.exit(1) }

// P1: 无界增长 — N 个独立目标 → N 条缓存, 无任何上限/清扫
record('P1 无界增长', cache.size === N, `独立目标 ${N} 个 → 缓存条目 ${cache.size} 条(修前预期相等=无上限)`)

// P3 语义守卫: 同目标 30s 内重复 → token 端点每目标只打 1 次(先于 P2, 避免人为过期干扰)
const repeatTarget = `${base}/guard?id=0`
await fetchPage(repeatTarget, cfg)
await fetchPage(repeatTarget, cfg)
const hits = tokenHits.get(`${base}/guard?id=0`) || 0
record('P3 同目标缓存命中', hits === 1, `重复 3 次请求同一目标, /tk 对该目标命中 ${hits} 次(语义: 30s 内应恰 1)`)

// P2: 过期条目永不回收 — 人为把一条置为 31s 前, 再触发一次新写入(第 801 章), 过期条目仍在
const firstKey = cache.keys().next().value as string
const expiredAt = Date.now() - 31_000
cache.set(firstKey, { token: (cache.get(firstKey) as { token: string }).token, at: expiredAt })
await fetchPage(`${base}/guard?id=final`, cfg)
const stillThere = cache.get(firstKey)
const expired = !!stillThere && Date.now() - stillThere.at >= 31_000
record('P2 过期条目不回收', expired, `人为过期条目在新写入后仍存活=${expired}(修前预期 true=无清扫)`)

// P4 语义守卫: 每个目标各自取到自己的 token(缓存键按解析后 URL 分键)
const distinctOk = tokenHits.size === N + 1
record('P4 逐目标独立token', distinctOk, `/tk 被命中 ${tokenHits.size} 次, 预期 ${N + 1}(每目标 1 次)`)

const bugProven = results.filter((r) => r.name.startsWith('P1') || r.name.startsWith('P2')).every((r) => r.pass)
const semanticsOk = results.filter((r) => r.name.startsWith('P3') || r.name.startsWith('P4')).every((r) => r.pass)
console.log(`\n===== probe-rr-c3-token-cache: bug证实=${bugProven ? '是' : '否'} 语义守卫=${semanticsOk ? '完好' : '破坏'} =====`)
server.stop(true)
process.exit(bugProven && semanticsOk ? 0 : 1)

export {}
