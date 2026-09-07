// ============================================================
// Task bb-d 验证脚本3 — 通用 token 预取钩子(FetchConfig.tokenUrl/tokenPattern/tokenInjection)
// A: URL追加式  — json 路径提取(data.token) → 无占位符追加 ?token=
// B: {token}/%7Btoken%7D 占位符替换式
// C: 请求头注入式(tokenHeaderName 自定义头名)
// D: regex 提取('regex:' 前缀, 第一捕获组)
// E: {url} 外部转换代理形态(tokenUrl 按目标URL换算 token)
// F: 预取失败静默降级(tokenUrl 404 → 无 token 直连不硬断链路) + 30s 进程内缓存(预取端只打1次)
// G: 真网预取 — tokenUrl 指向真实站点(bqg713 /api/index, json 路径 hotlist.0.id)取真值注入本地守卫
// H: bqg713 四段现状回归记录(list/book/toc 200, content 明文参数 403 — AES-token 阻塞仍在)
// 运行: bun scripts/verify-bb-d-3.ts
// ============================================================
import http from 'http'
import { createHash } from 'crypto'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n== ${title} ==`)
  try { await fn() } catch (e: any) { fail++; console.log(`  ✗ 段落异常: ${e?.stack?.slice(0, 300) || e}`) }
}

// ---------------- mock: token 预取端 + token 守卫页 ----------------
const PORT = 3343
const BASE = `http://127.0.0.1:${PORT}`
const TOKEN = 'TKN-abc123DEF'
const hits = { tk: 0 }
const md5 = (s: string) => createHash('md5').update(s).digest('hex')

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', BASE)
  const reply = (code: number, body: string, ct = 'text/html; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': ct })
    res.end(body)
  }
  if (u.pathname === '/tk') {
    hits.tk++
    return reply(200, JSON.stringify({ code: 0, data: { token: TOKEN } }), 'application/json')
  }
  if (u.pathname === '/regex-tk') return reply(200, `<html><body><script>var csrf = "RGX-999-token";</script>ok</body></html>`)
  if (u.pathname === '/not-exist') return reply(404, 'not found')
  if (u.pathname === '/transform') {
    const target = u.searchParams.get('u') || ''
    return reply(200, JSON.stringify({ data: { token: md5(target).slice(0, 10) } }), 'application/json')
  }
  // 守卫页: token 查询参数校验(排除 token 自身重算原始 URL, 服务 {url} 转换代理场景)
  if (u.pathname === '/guard-rgx') {
    const t = u.searchParams.get('token') || ''
    if (t !== 'RGX-999-token') return reply(403, 'forbidden: bad regex token')
    return reply(200, `<html><body><div id="content">rgx-guard-ok ${'正文内容。'.repeat(60)}</div></body></html>`)
  }
  if (u.pathname === '/guard') {
    const t = u.searchParams.get('token') || ''
    if (t !== TOKEN) return reply(403, 'forbidden: bad token')
    return reply(200, `<html><body><div id="content">guard-ok ${'正文内容。'.repeat(60)}</div></body></html>`)
  }
  if (u.pathname === '/guard-md5') {
    const t = u.searchParams.get('token') || ''
    const params = new URLSearchParams(u.searchParams)
    params.delete('token')
    const original = `${u.pathname}${params.toString() ? '?' + params.toString() : ''}`
    if (t !== md5(`${BASE}${original}`).slice(0, 10)) return reply(403, 'forbidden: token mismatch')
    return reply(200, `<html><body><div id="content">md5-guard-ok ${'正文内容。'.repeat(60)}</div></body></html>`)
  }
  // 守卫页: 请求头校验
  if (u.pathname === '/guard-hdr') {
    if (req.headers['x-api-token'] !== TOKEN) return reply(403, 'forbidden: missing header')
    return reply(200, `<html><body><div id="content">hdr-guard-ok ${'正文内容。'.repeat(60)}</div></body></html>`)
  }
  // 真网守卫: 头 X-Token 必须等于 bqg713 hotlist[0].id 真值
  if (u.pathname === '/guard-real') {
    if (req.headers['x-token'] !== '2530') return reply(403, `forbidden: expect 2530 got ${req.headers['x-token']}`)
    return reply(200, `<html><body><div id="content">real-guard-ok ${'正文内容。'.repeat(60)}</div></body></html>`)
  }
  reply(200, 'index')
})
await new Promise<void>((r) => server.listen(PORT, () => r()))

const { fetchPage } = await import('../src/lib/crawl/fetcher')
const { sanitizeFetchConfig } = await import('../src/lib/crawl/types')

const HTTP = { engine: 'http' as const, timeout: 10000, retries: 0 }

await section('A: URL追加式 — json 路径提取 data.token → 追加 ?token=', async () => {
  const r = await fetchPage(`${BASE}/guard`, { ...HTTP, tokenUrl: `${BASE}/tk`, tokenPattern: 'data.token', tokenInjection: 'url' })
  ok('带 token 请求通过守卫页(200 非拦截)', !r.blocked && r.html.includes('guard-ok'), `len=${r.html.length}`)
  ok('预取端被打 1 次(30s 缓存生效)', hits.tk === 1, `hits=${hits.tk}`)
  // 30s 内第二次: 不再打预取端, 守卫仍通过
  const r2 = await fetchPage(`${BASE}/guard?x=1`, { ...HTTP, tokenUrl: `${BASE}/tk`, tokenPattern: 'data.token', tokenInjection: 'url' })
  ok('缓存命中: 预取端仍只被打 1 次', hits.tk === 1, `hits=${hits.tk}`)
  ok('第二次请求守卫通过(token 追加到含已有参数的URL)', !r2.blocked && r2.html.includes('guard-ok'))
})

await section('B: 占位符替换式 — {token} 与 %7Btoken%7D(const 模板存活形态)', async () => {
  const r = await fetchPage(`${BASE}/guard?token={token}`, { ...HTTP, tokenUrl: `${BASE}/tk`, tokenPattern: 'data.token', tokenInjection: 'url' })
  ok('{token} 占位符被替换并通过守卫', !r.blocked && r.html.includes('guard-ok'))
  const r2 = await fetchPage(`${BASE}/guard?token=%7Btoken%7D`, { ...HTTP, tokenUrl: `${BASE}/tk`, tokenPattern: 'data.token', tokenInjection: 'url' })
  ok('%7Btoken%7D 百分号编码占位符同样被替换(规则 const 模板可用此形态存活)', !r2.blocked && r2.html.includes('guard-ok'))
})

await section('C: 请求头注入式 — 自定义 tokenHeaderName', async () => {
  const r = await fetchPage(`${BASE}/guard-hdr`, { ...HTTP, tokenUrl: `${BASE}/tk`, tokenPattern: 'data.token', tokenInjection: 'header', tokenHeaderName: 'X-Api-Token' })
  ok('请求头注入通过守卫(自定义头名)', !r.blocked && r.html.includes('hdr-guard-ok'), `len=${r.html.length}`)
  // 缺省头名 X-Token 场景由 G 段真网守卫覆盖
})

await section('D: regex 提取 — regex: 前缀第一捕获组', async () => {
  const r = await fetchPage(`${BASE}/guard-rgx`, { ...HTTP, tokenUrl: `${BASE}/regex-tk`, tokenPattern: 'regex:var\\s+csrf\\s*=\\s*"([A-Za-z0-9-]+)"', tokenInjection: 'url' })
  ok('regex 提取 token(RGX-999-token)并替换 URL 占位符通过守卫', !r.blocked && r.html.includes('rgx-guard-ok'), `len=${r.html.length}`)
})

await section('E: {url} 外部转换代理形态 — tokenUrl 按目标URL换算 token', async () => {
  const r = await fetchPage(`${BASE}/guard-md5?t=1`, { ...HTTP, tokenUrl: `${BASE}/transform?u={url}`, tokenPattern: 'data.token', tokenInjection: 'url' })
  ok('转换代理按目标URL换算 token, 守卫校验通过', !r.blocked && r.html.includes('md5-guard-ok'), `len=${r.html.length}`)
})

await section('F: 预取失败静默降级 + 守卫缺失 token 的行为对照', async () => {
  // tokenUrl 404 → 预取失败 → 无 token 直连: 目标页(合法 JSON)照常返回, 链路不断
  // (注: 极短 JSON 会被 fetcher 的"极短内容判拦"启发式标 blocked, 合法 JSON 体本身即证明直连成功)
  const { parseJsonBody } = await import('../src/lib/crawl/parser')
  const r = await fetchPage(`${BASE}/tk`, { ...HTTP, tokenUrl: `${BASE}/not-exist`, tokenPattern: 'data.token', tokenInjection: 'url' })
  ok('预取端 404 时静默降级直连(目标页 JSON 照常返回, 链路不硬断)', parseJsonBody(r.html) !== undefined, `len=${r.html.length} blocked=${r.blocked}`)
  let threw = false
  try { await fetchPage(`${BASE}/guard`, { ...HTTP, tokenUrl: `${BASE}/not-exist`, tokenPattern: 'data.token' }) } catch { threw = true }
  ok('无 token 访问守卫页被 403 拒(对照: 钩子确实在注入)', threw, 'fetchPage 抛 HTTP 403')
})

await section('G: 真网预取 — tokenUrl 指向 bqg713 真实 API, 取真值注入本地守卫', async () => {
  const r = await fetchPage(`${BASE}/guard-real`, {
    ...HTTP,
    tokenUrl: 'https://www.bqg713.cc/api/index?sort=all',
    tokenPattern: 'hotlist.0.id',
    tokenInjection: 'header',
  })
  ok('真网 JSON 预取 hotlist.0.id=2530 注入 X-Token 头通过守卫', !r.blocked && r.html.includes('real-guard-ok'), `len=${r.html.length}`)
})

await section('H: bqg713 四段现状回归记录(真站)', async () => {
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' }
  const probe = async (url: string) => {
    try { const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) }); return { s: res.status, n: (await res.text()).length } }
    catch (e: any) { return { s: -1, n: 0 } }
  }
  const idx = await probe('https://www.bqg713.cc/api/index?sort=all')
  const book = await probe('https://www.bqg713.cc/api/book?id=2530')
  const bl = await probe('https://www.bqg713.cc/api/booklist?id=2530')
  const ch = await probe('https://www.bqg713.cc/api/chapter?id=2530&chapterid=1')
  ok('list 段 /api/index 200', idx.s === 200, `status=${idx.s} bytes=${idx.n}`)
  ok('book 段 /api/book 200', book.s === 200, `status=${book.s} bytes=${book.n}`)
  ok('toc 段 /api/booklist 200', bl.s === 200, `status=${bl.s} bytes=${bl.n}`)
  ok('content 段 /api/chapter 明文参数仍被 CF WAF 403(AES-token 阻塞现状复确认)', ch.s === 403, `status=${ch.s}`)
  console.log(`  [bqg713 现状] list=${idx.s}/book=${book.s}/toc=${bl.s}/content=${ch.s} — 三段可用一段阻塞与 aa-c 留档一致`)
})

server.close()
console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

export {}
