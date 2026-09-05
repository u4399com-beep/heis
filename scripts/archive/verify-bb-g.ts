// ============================================================
// Task bb-g 验证脚本 — crawl 域二遍审查修复项验证
// A fetcher.prefetchToken 缓存键: {url} 转换代理形态按"解析后URL"分键
//   (修前: 同 host 30s 内共享 token → 第二章拿到第一章的 token → 403)
// B fetcher 头注入 token 值控制字符清洗(修前: CRLF token → fetch 抛错/curl 值被空格化 → 403)
// D parser.parseContent 翻页 <base href> 感知(修前: 相对"下一页"按文档URL解析 → 404 断链)
// E fetcher URL追加式注入在 #fragment 之前(修前: token 落入 fragment 服务端不可见 → 403)
// (ReDoS 闸门曾列入候选: 实测 Bun/JSC 正则引擎有回溯预算上限, 灾难性模式单次 exec 封顶
//  ~3s 不可挂死, 不构成可验证缺陷 → 记录在案, 不修)
// 运行: bun scripts/verify-bb-g.ts (本地 mock 服务, 无外网依赖)
// ============================================================
import { createHash } from 'node:crypto'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const pad = (n: number) => '<html><title>t</title><body>' + 'x'.repeat(n) + '</body></html>'

const results: { name: string; pass: boolean; note: string }[] = []
function record(name: string, pass: boolean, note: string) {
  results.push({ name, pass, note })
  console.log(`${pass ? '✅' : '❌'} [${name}] ${note}`)
}

// Bun 全局不经类型系统(项目 tsc 基线未装 @types/bun), 最小类型面取 serve/port
const BunRT = (globalThis as unknown as { Bun: { serve: (o: { port: number; fetch: (req: Request) => Response }) => { port: number; stop: (f: boolean) => void } } }).Bun
const server = BunRT.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url)
    const p = u.pathname
    if (p === '/tok') return Response.json({ token: md5(u.searchParams.get('u') || '') }) // {url} 代理形态: token=f(目标URL)
    if (p === '/c1' || p === '/c2') {
      const expect = md5(`http://127.0.0.1:${server.port}${p}`)
      if (u.searchParams.get('token') !== expect) return new Response('no', { status: 403 })
      return new Response(pad(300))
    }
    if (p === '/tok2') return Response.json({ t: 'good\r\ntoken' })
    if (p === '/hdr') {
      if (req.headers.get('x-token') !== 'goodtoken') return new Response('no', { status: 403 })
      return new Response(pad(300))
    }
    if (p === '/redos') return new Response('a'.repeat(30) + 'x')
    if (p === '/plain') return new Response(pad(300))
    if (p === '/tok3') return Response.json({ token: 'T0K' })
    if (p === '/frag') {
      if (u.searchParams.get('token') !== 'T0K') return new Response('no', { status: 403 })
      return new Response(pad(300))
    }
    if (p === '/book/1.html') {
      const html = `<html><head><base href="http://127.0.0.1:${server.port}/real/"></head><body>` +
        `<div id="c">PART1</div><a href="2.html">下一页</a>${pad(200)}</body></html>`
      return new Response(html)
    }
    if (p === '/real/2.html') {
      return new Response(`<html><body><div id="c">PART2</div>${pad(200)}</body></html>`)
    }
    return new Response('no', { status: 404 })
  },
})
const base = `http://127.0.0.1:${server.port}`
console.log(`mock server: ${base}`)

const { fetchPage } = await import('../src/lib/crawl/fetcher')
const { parseContent } = await import('../src/lib/crawl/parser')

// ---------- A: {url} 代理形态缓存键 ----------
try {
  const cfg = { engine: 'http' as const, tokenUrl: `${base}/tok?u={url}`, tokenPattern: 'token', tokenInjection: 'url' as const }
  let a1 = ''
  let a2 = ''
  try { a1 = (await fetchPage(`${base}/c1`, cfg)).html } catch (e: any) { a1 = `ERR:${e?.message?.slice(0, 60)}` }
  try { a2 = (await fetchPage(`${base}/c2`, cfg)).html } catch (e: any) { a2 = `ERR:${e?.message?.slice(0, 60)}` }
  const pass = a1.includes('x'.repeat(100)) && a2.includes('x'.repeat(100))
  record('A 代理token缓存键', pass, `c1=${a1.slice(0, 12)}... c2=${a2.slice(0, 12)}... (两章须各自拿到 f(url) 正确 token)`)
} catch (e: any) { record('A 代理token缓存键', false, `异常: ${e?.message?.slice(0, 80)}`) }

// ---------- B: 头注入 token 值控制字符清洗 ----------
try {
  const cfg = { engine: 'http' as const, tokenUrl: `${base}/tok2`, tokenPattern: 't', tokenInjection: 'header' as const, tokenHeaderName: 'X-Token' }
  let html = ''
  try { html = (await fetchPage(`${base}/hdr`, cfg)).html } catch (e: any) { html = `ERR:${e?.message?.slice(0, 60)}` }
  const pass = html.includes('x'.repeat(100))
  record('B 头注入值清洗', pass, `guard 要求 X-Token==='goodtoken'(CRLF 剥除后), 实得: ${html.slice(0, 24)}`)
} catch (e: any) { record('B 头注入值清洗', false, `异常: ${e?.message?.slice(0, 80)}`) }

// ---------- E: URL追加式注入 #fragment 感知 ----------
try {
  const cfg = { engine: 'http' as const, tokenUrl: `${base}/tok3`, tokenPattern: 'token', tokenInjection: 'url' as const }
  let html = ''
  try { html = (await fetchPage(`${base}/frag?a=1#sec`, cfg)).html } catch (e: any) { html = `ERR:${e?.message?.slice(0, 60)}` }
  const pass = html.includes('x'.repeat(100))
  record('E fragment前追加token', pass, `实得: ${html.slice(0, 24)}`)
} catch (e: any) { record('E fragment前追加token', false, `异常: ${e?.message?.slice(0, 80)}`) }

// ---------- D: parseContent 翻页 <base href> 感知 ----------
try {
  const rule: any = {
    fields: { content: { type: 'css', expression: '#c', attr: 'html' } },
    pagination: { enabled: true, maxPages: 5, joinWith: '<br/>' },
  }
  const html1 = `<html><head><base href="${base}/real/"></head><body><div id="c">PART1</div><a href="2.html">下一页</a></body></html>`
  const res = await parseContent(`${base}/book/1.html`, html1, rule, undefined)
  const pass = res.pages === 2 && res.content.includes('PART1') && res.content.includes('PART2')
  record('D 翻页base href', pass, `pages=${res.pages} content=${JSON.stringify(res.content.slice(0, 60))} (须2页含PART1+PART2)`)
} catch (e: any) { record('D 翻页base href', false, `异常: ${e?.message?.slice(0, 80)}`) }

// ---------- 收尾 ----------
server.stop(true)
const fail = results.filter((r) => !r.pass)
console.log(`\n===== 汇总: ${results.length - fail.length}/${results.length} 通过 =====`)
if (fail.length) { for (const f of fail) console.log(`  ❌ ${f.name}`); process.exit(2) }
