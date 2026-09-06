export {}
// ============================================================
// Task gg-d 验证脚本③ — fetcher 新 relay 面 × token/回环豁免 交互边界(疑点2)
//
// 审计点:
//   A relayHop 超时语义: 客户端 controller 先超时(中继侧冗余 +3s 恒后到) → AbortError
//      原样上抛 → fetchHttp 打 isFetchTimeout 标记 → ee-d"源站超时"分类链完好
//   B 目标侧响应忠实上抛: 中继返回 403 时引擎如实抛 status=403+bodyHtml,
//      且物理请求恰 1 次(目标侧响应不双发, 仅中继层失败才落 curl)
//   C token 预取(prefetchToken) 回环豁免与 relay 的先后序: tokenUrl 指向 loopback
//      (bqg713 127.0.0.1:3010 形态)时, 即便 cfg.proxyUrl 已配置, 预取也必须直连成功
//      —— 决策序: fetchHttpWithCurlFallback 先 isLoopbackTarget → single(proxy='')
//      → relay 分支(proxy && !PROXY_FETCH_SUPPORTED)永不触达回环目标
//   D fetchBinary 评估(任务口径: 如实记录不强改): 封面资源链无 proxy/relay/mirror
//      接入(源码审计), 回环与常规资源可用; 代理强依赖站封面优雅降级 null
// 链路: fetchHttpForTest(transport='relay') → 中继(3011, 已在运) → 回环转发代理(3421)
//      → mock 源站(3420); token 面 mock(3422)。全回环不出网
// 运行: bun scripts/verify-gg-d-relay-token.ts
// ============================================================
declare const Bun: {
  serve(opts: { port: number; hostname: string; fetch(req: Request): Response | Promise<Response> }): { stop(stopActive?: boolean): void }
  listen<T>(opts: { hostname: string; port: number; socket: T }): { stop(stopActive?: boolean): void }
}
import { fetchHttpForTest, fetchPage, fetchBinary, isLoopbackTarget, pickProxyFor } from '../src/lib/crawl/fetcher'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ORIGIN_PORT = 3420
const PROXY_PORT = 3421
const TOKEN_PORT = 3422
const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`
const TSITE = `http://127.0.0.1:${TOKEN_PORT}`
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

function pad(n: number): string {
  return 'p'.repeat(n)
}

// ---------- mock 源站(经中继+代理访问) ----------
const originSrv = Bun.serve({
  port: ORIGIN_PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/hang') return new Promise<Response>(() => { /* 永不响应: 客户端超时场景 */ })
    if (u.pathname === '/forbidden') return new Response(`denied-marker-ggd ${pad(220)}`, { status: 403 })
    return new Response(`origin-ok ${pad(220)}`)
  },
})

// ---------- 回环转发代理(仅 http 绝对 URI, 供 RequestInit.proxy 消费; 与 verify-gg-relay 同款) ----------
interface ProxyLogEntry { url: string }
const proxyLog: ProxyLogEntry[] = []

function parseRequest(buf: Buffer): { method: string; url: string; headers: Record<string, string> } | null {
  const idx = buf.indexOf('\r\n\r\n')
  if (idx < 0) return null
  const head = buf.slice(0, idx).toString('utf8')
  const lines = head.split('\r\n')
  const [method, target] = lines[0].split(' ')
  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const c = line.indexOf(':')
    if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim()
  }
  return { method: method || 'GET', url: target || '', headers }
}

const proxySrv = Bun.listen({
  hostname: '127.0.0.1',
  port: PROXY_PORT,
  socket: {
    data(socket, data) {
      void (async () => {
        const req = parseRequest(Buffer.from(data))
        if (!req || !/^https?:\/\//i.test(req.url)) {
          socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
          return
        }
        proxyLog.push({ url: req.url })
        try {
          const res = await fetch(req.url, {
            method: req.method as 'GET',
            headers: req.headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(8000),
          })
          const body = new Uint8Array(await res.arrayBuffer())
          const hdrs: string[] = [`HTTP/1.1 ${res.status} ${res.statusText || 'OK'}`]
          res.headers.forEach((v, k) => {
            const kl = k.toLowerCase()
            if (kl === 'transfer-encoding' || kl === 'connection' || kl === 'keep-alive' || kl === 'content-length') return
            hdrs.push(`${k}: ${v}`)
          })
          hdrs.push(`Content-Length: ${body.byteLength}`, 'Connection: close')
          socket.write(hdrs.join('\r\n') + '\r\n\r\n')
          socket.write(body)
          socket.end()
        } catch {
          socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
        }
      })()
    },
  },
})

// ---------- token 面 mock(3422): 预取端点 + 校验型目标 ----------
/** token 派生: 由目标 URL(不含 token 参数)确定性派生 */
function deriveToken(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) h = ((h * 31 + url.charCodeAt(i)) >>> 0)
  return ('T' + h.toString(16)).padEnd(13, '0').slice(0, 16)
}
let tokenHits = 0
let targetHits = 0
let targetLastToken = ''
const tokenSrv = Bun.serve({
  port: TOKEN_PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/token') {
      tokenHits++
      const target = u.searchParams.get('url') || ''
      return new Response(`TOKEN:${deriveToken(target)} ${pad(220)}`)
    }
    if (u.pathname === '/data') {
      targetHits++
      // 剥离 token 参数后重建"裸 URL"校验(与引擎先取 token 再注 URL 的次序对应)
      const bare = new URL(req.url)
      targetLastToken = bare.searchParams.get('token') || ''
      bare.searchParams.delete('token')
      const expect = deriveToken(bare.toString())
      if (targetLastToken && targetLastToken === expect) {
        return new Response(JSON.stringify({ ok: true, page: bare.searchParams.get('p') }) + pad(200), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('token invalid', { status: 403 })
    }
    if (u.pathname === '/cover.png') return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), { headers: { 'Content-Type': 'image/png' } })
    return new Response('not found', { status: 404 })
  },
})
await new Promise((r) => setTimeout(r, 300))

async function main() {
  const assertions: string[] = []
  void assertions

  // ============ A. relayHop 超时语义 ============
  console.log('\n== A. 客户端超时(controller 先于中继冗余) → AbortError + isFetchTimeout 分类标记 ==')
  {
    proxyLog.length = 0
    const t0 = Date.now()
    let err: any = null
    try {
      await fetchHttpForTest(`${ORIGIN}/hang`, { engine: 'http', timeout: 2000 } as never, UA, `http://127.0.0.1:${PROXY_PORT}`, 'relay')
    } catch (e) { err = e }
    const dt = Date.now() - t0
    ok('A1 按客户端 timeout 抛 AbortError(中继层不吞不转类)', err?.name === 'AbortError', `name=${err?.name} dt=${dt}ms`)
    ok('A2【核心】isFetchTimeout 标记在位(ee-d 源站超时分类链经 relay 完好)', err?.isFetchTimeout === true, `mark=${err?.isFetchTimeout}`)
    ok('A3 超时粒度 ≈ 客户端 timeout(2s 档, 非中继 5s 冗余档)', dt >= 1800 && dt < 4000, `dt=${dt}ms`)
  }

  // ============ B. 目标侧响应忠实上抛(不双发) ============
  console.log('\n== B. 中继返回目标侧 403: 引擎如实抛 status+bodyHtml, 物理请求恰 1 次 ==')
  {
    proxyLog.length = 0
    let err: any = null
    try {
      await fetchHttpForTest(`${ORIGIN}/forbidden`, { engine: 'http', timeout: 5000 } as never, UA, `http://127.0.0.1:${PROXY_PORT}`, 'relay')
    } catch (e) { err = e }
    ok('B1 403 如实上抛(status 保留)', err?.status === 403, `status=${err?.status} name=${err?.name}`)
    ok('B2 bodyHtml 保留(挑战识别原料不丢)', typeof err?.bodyHtml === 'string' && err.bodyHtml.includes('denied-marker-ggd'), `len=${err?.bodyHtml?.length}`)
    ok('B3【核心】物理请求恰 1 次(目标侧响应不触发 curl 双发)', proxyLog.length === 1, `proxyLog=${JSON.stringify(proxyLog.map((p) => p.url))}`)
  }

  // ============ C. token 预取回环豁免 × relay/proxy 先后序 ============
  console.log('\n== C. tokenUrl 指向 loopback + proxyUrl 已配置: 回环豁免先于代理/中继, 预取直连成功 ==')
  {
    // 静态面: 选路函数口径
    ok('C0a isLoopbackTarget 覆盖 localhost/127.0.0.0/8 段', isLoopbackTarget('http://localhost:3010/x') && isLoopbackTarget('http://127.0.0.1:3010/rewrite') && isLoopbackTarget('http://127.200.0.1/x'))
    ok('C0b 非回环目标 + 配代理 → pickProxyFor 命中代理', pickProxyFor('http://example.com/x', { proxyUrl: 'http://127.0.0.1:1' } as never) !== '')
    ok('C0c 回环目标 → pickProxyFor 恒直连(代理/中继都不触达)', pickProxyFor(`${TSITE}/data?p=1`, { proxyUrl: 'http://127.0.0.1:1' } as never) === '')
    // 端到端: proxyUrl 配置死端口代理(若被用于 token 预取或目标请求必失败), token 预取仍成功
    tokenHits = 0; targetHits = 0
    const cfg = {
      engine: 'http', timeout: 5000, retries: 0, autoCookie: false,
      proxyUrl: 'http://127.0.0.1:1',
      tokenUrl: `${TSITE}/token?url={url}`,
      tokenPattern: 'regex:TOKEN:([A-Za-z0-9]+)',
    }
    const res = await fetchPage(`${TSITE}/data?p=1`, cfg as never)
    ok('C1【核心】带死代理配置 + 回环 tokenUrl: 请求成功(token 注入正确)', !res.blocked && res.html.includes('"ok":true'), `len=${res.html.length}`)
    ok('C2 token 预取走回环直连(预取端点被命中恰 1 次)', tokenHits === 1, `tokenHits=${tokenHits}`)
    ok('C3 目标收到 token 且服务端校验通过(403 未发生)', targetHits === 1 && targetLastToken.length > 0, `targetHits=${targetHits} token=${targetLastToken.slice(0, 8)}…`)
    // 负控: 无 token 配置 → 目标 403(证明 C1 的成功确由 token 预取链带来)
    let err: any = null
    try { await fetchPage(`${TSITE}/data?p=2`, { engine: 'http', timeout: 5000, retries: 0, autoCookie: false, proxyUrl: 'http://127.0.0.1:1' } as never) } catch (e) { err = e }
    ok('C4 负控: 无 token 配置同一目标 403(token 确为放行必要条件)', err?.status === 403, `status=${err?.status}`)
  }

  // ============ D. fetchBinary 评估(如实记录, 不强改) ============
  console.log('\n== D. fetchBinary 资源链: 回环可用 / 无 proxy·relay·mirror 接入(源码审计存档) ==')
  {
    const bin = await fetchBinary(`${TSITE}/cover.png`, { engine: 'http', timeout: 4000 })
    ok('D1 fetchBinary 回环资源可用(二进制+contentType 完好)', !!bin && bin.buf.length === 8 && bin.contentType === 'image/png', `len=${bin?.buf.length} ct=${bin?.contentType}`)
    console.log('  ↳ 源码审计: fetchBinary=裸 fetch(redirect:follow)+buildHeaders(无指纹), 不经 pickProxyFor/relay/mirror')
    console.log('     → 代理强依赖站的封面下载直连失败 → 返回 null 优雅降级(runner 侧 warn 日志, 不影响正文采集)')
    console.log('     → 评估结论: 封面属非内容链路, 失败代价=无封面, 与 dd-b"fetchBinary 刻意不接镜像"同裁定制; 维持现状不改(如实记录)')
  }

  // 收尾: 关闭本脚本自建服务(中继 3011 为共享常驻服务, 不动)
  originSrv.stop(true)
  tokenSrv.stop(true)
  proxySrv.stop(true)
}

main()
  .then(() => {
    console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
    process.exit(fail ? 1 : 0)
  })
  .catch((e) => {
    console.error('脚本异常:', e?.stack?.slice(0, 400) || e)
    process.exit(1)
  })
