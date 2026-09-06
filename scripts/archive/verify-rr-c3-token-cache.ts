// ============================================================
// verify-rr-c3-token-cache.ts — rr-c3 真bug#2 修复断言(token 缓存有界化) + 卫生项#3 回归
// 背景: fetcher.prefetchToken 进程内 token 缓存在 {url} 占位符形态(生产 bqg713 规则在用)
//   下按解析后 URL 逐章分键, TTL 仅惰性删"再命中"的过期键 → 长任务 Map 无界增长
//   (probe-rr-c3-token-cache 修前实证: 800 目标→800 条目, 过期条目永不回收)。
// 修复: TOKEN_CACHE_MAX=256 + 写入后 trim(先清扫过期, 仍超限按插入序删最旧)。
// 断言:
//   A 有界性: 600 个独立目标后缓存 ≤ 256 条
//   B 过期回收: 人为过期条目在 trim 触发后被清除
//   C 语义保真: 同目标 30s 内重复请求 token 端点恰 1 次(缓存命中)
//   D 语义保真: 逐目标 token 独立(每目标恰 1 次预取, {url} 按目标取值)
//   E 固定 tokenUrl 形态: 缓存恒 1 条, 重复请求不重复预取
//   F 卫生项#3 回归: 3xx(body 1MB)+Set-Cookie 手动重定向链语义不变(302 cancel body
//     不影响 per-hop Cookie 归属/最终内容/相对 Location)
// 运行: bun scripts/verify-rr-c3-token-cache.ts (本地 mock, 无外网依赖)
// ============================================================

const results: { name: string; pass: boolean; note: string }[] = []
function record(name: string, pass: boolean, note: string) {
  results.push({ name, pass, note })
  console.log(`${pass ? '✓' : '✗'} [${name}] ${note}`)
}

const BunRT = (globalThis as unknown as { Bun: { serve: (o: { port: number; fetch: (req: Request) => Response }) => { port: number; stop: (f: boolean) => void } } }).Bun

const tokenHits = new Map<string, number>()
const pad = (n: number) => 'x'.repeat(n)
const server = BunRT.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/tk') {
      const target = u.searchParams.get('u') || ''
      tokenHits.set('tk|' + target, (tokenHits.get('tk|' + target) || 0) + 1)
      return Response.json({ data: { token: 'tk-' + Buffer.from(target).toString('base64url').slice(0, 24) } })
    }
    if (u.pathname === '/tk-fixed') {
      tokenHits.set('tk-fixed|x', (tokenHits.get('tk-fixed|x') || 0) + 1)
      return Response.json({ data: { token: 'FIXED-TOKEN' } })
    }
    if (u.pathname === '/guard') return new Response(`<html><title>t</title><body>${pad(300)}</body></html>`)
    if (u.pathname === '/redir-big') {
      // 3xx + 1MB body: 修前 body 不消费由 GC 延迟回收; 修后 cancel 立即释放 — 语义必须不变
      return new Response(pad(1024 * 1024), {
        status: 302,
        headers: { Location: '/landing?next=rel', 'Set-Cookie': 'rrc3sid=abc123; Path=/' },
      })
    }
    if (u.pathname === '/landing') {
      if (u.searchParams.get('next') !== 'rel') return new Response('no', { status: 400 })
      return new Response(`<html><title>t</title><body>LANDING-${pad(280)}</body></html>`)
    }
    return new Response('no', { status: 404 })
  },
})
const base = `http://127.0.0.1:${server.port}`
console.log(`mock server: ${base}`)

const { fetchPage, cookieJar } = await import('../src/lib/crawl/fetcher')

// ---------- A/B: 有界化 + 过期回收 ----------
const g = globalThis as unknown as { __novelTokenPrefetch_v1?: Map<string, { token: string; at: number }> }
const cfgProxy = {
  engine: 'http' as const,
  tokenUrl: `${base}/tk?u={url}`,
  tokenPattern: 'data.token',
  tokenInjection: 'url' as const,
  timeout: 5000,
  retries: 0,
}
const N = 600
for (let i = 0; i < N; i++) {
  const res = await fetchPage(`${base}/guard?id=${i}`, cfgProxy)
  if (res.blocked) { record('前置: 抓取', false, `第${i}章 blocked`); process.exit(1) }
}
const cache = g.__novelTokenPrefetch_v1!
const TOKEN_CACHE_MAX = 256
record('A 缓存有界', cache.size <= TOKEN_CACHE_MAX, `${N} 个独立目标后缓存 ${cache.size} 条(上限 ${TOKEN_CACHE_MAX})`)

// B: 人为过期 40 条(31s 前), 再触发 5 次新写入 → size 261 > 256 → trim 清扫过期条目
const expiredKeys: string[] = []
let cnt = 0
for (const [k] of cache) {
  if (cnt++ >= 40) break
  cache.set(k, { token: (cache.get(k) as { token: string }).token, at: Date.now() - 31_000 })
  expiredKeys.push(k)
}
for (let i = 0; i < 5; i++) await fetchPage(`${base}/guard?id=trim-${i}`, cfgProxy)
const allSwept = expiredKeys.every((k) => !cache.has(k))
record('B 过期条目回收', allSwept, `人为过期 ${expiredKeys.length} 条经 trim 后全部清除, 现存 ${cache.size} 条`)

// C: 同目标 30s 内重复 → 预取恰 1 次(用 B 未触碰的专属新目标, 避免人为过期干扰)
const cd1 = `${base}/guard?id=c-dedup`
await fetchPage(cd1, cfgProxy)
await fetchPage(cd1, cfgProxy)
const cHits = tokenHits.get('tk|' + cd1) || 0
record('C 缓存命中语义', cHits === 1, `同目标 3 次请求(首+N=2 次), /tk 对该目标命中 ${cHits} 次(应恰 1)`)

// D: 逐目标独立 — 每个独立目标恰预取 1 次(N=600 循环 + trim 5 + C 专属目标 1)
const tkKeys = Array.from(tokenHits.keys()).filter((k) => k.startsWith('tk|'))
const tkMulti = tkKeys.filter((k) => (tokenHits.get(k) || 0) !== 1)
record('D 逐目标独立token', tkKeys.length === N + 5 + 1 && tkMulti.length === 0, `tk| 预取键 ${tkKeys.length} 个(应 ${N + 6}), 多次预取的键 ${tkMulti.length} 个(应 0)`)

// E: 固定 tokenUrl 形态 — 缓存恒 1 条, 重复请求不重复预取
const cfgFixed = { engine: 'http' as const, tokenUrl: `${base}/tk-fixed`, tokenPattern: 'data.token', tokenInjection: 'url' as const, timeout: 5000, retries: 0 }
await fetchPage(`${base}/guard?a=1`, cfgFixed)
await fetchPage(`${base}/guard?a=2`, cfgFixed)
const fixedHits = tokenHits.get('tk-fixed|x') || 0
const fixedEntries = Array.from(cache.keys()).filter((k) => k.includes('/tk-fixed')).length
record('E 固定形态语义不变', fixedHits === 1 && fixedEntries === 1, `固定 tokenUrl 预取 ${fixedHits} 次(应 1), 缓存条目 ${fixedEntries} 条(应 1)`)

// F: 卫生项#3 回归 — 3xx(1MB body)+Set-Cookie 重定向链语义不变
cookieJar.clear(`${base}`) // 清本域罐, 从零验证 per-hop Cookie 归属
const f = await fetchPage(`${base}/redir-big`, { engine: 'http' as const, timeout: 8000, retries: 0 })
const fOk = !f.blocked && f.html.includes('LANDING-') && f.html.includes(pad(280))
const jarCookie = cookieJar.get(`${base}`).includes('rrc3sid=abc123')
record('F 3xx重定向链语义', fOk && jarCookie, `302(1MB body)+Set-Cookie → 相对 Location 跟随+内容正确=${fOk}, Cookie 归属落地=${jarCookie}`)

const failed = results.filter((r) => !r.pass)
console.log(`\n===== verify-rr-c3-token-cache: ${results.length - failed.length} pass / ${failed.length} fail =====`)
server.stop(true)
process.exit(failed.length ? 1 : 0)

export {}
