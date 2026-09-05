export {}
// ============================================================
// gg 中继桥回环端到端验证(全回环不出网)
// 链路: fetchHttpForTest(transport='relay') → 中继(127.0.0.1:3011, bun 运行时)
//       → RequestInit.proxy → 回环转发代理(3991) → mock 源站(3992)
// 断言:
//   A1 302 重定逐跳: /start 302+Set-Cookie → /final(引擎逐跳循环经中继保持)
//   A2 hop1 Set-Cookie 被引擎 cookieJar 捕获且 hop2 请求携带(proxy 转发层可见)
//   A3 指纹头组穿透: UA/sec-ch-ua-mobile 到达源站
//   A4 响应体经 base64 往返后 decodeBuffer 语义完好(最终正文可得)
//   A5 中继层失败分类: 中继不在 → RelayTransportError 语义(见 verify-gg-relay-down.ts)
// 运行: 先确保 mini-services/fetch-relay 已启动(bun run dev), 然后
//   bun scripts/verify-gg-relay.ts
// ============================================================
declare const Bun: {
  serve(opts: { port: number; hostname: string; fetch(req: Request): Response | Promise<Response> }): { stop(stopActive?: boolean): void }
  listen<T>(opts: { hostname: string; port: number; socket: T }): void
}
import { fetchHttpForTest } from '../src/lib/crawl/fetcher'

const ORIGIN_PORT = 3992
const PROXY_PORT = 3991
const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`
const MARKER = 'relay-e2e-ok-marker'
const COOKIE_VAL = 'sid=relaytest123'

interface ProxyLogEntry { url: string; cookie: string; ua: string }
const proxyLog: ProxyLogEntry[] = []

function pad(n: number): string {
  return 'p'.repeat(n)
}

// ---------- mock 源站 ----------
Bun.serve({
  port: ORIGIN_PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/start') {
      return new Response('redirecting', {
        status: 302,
        headers: { Location: '/final', 'Set-Cookie': `${COOKIE_VAL}; Path=/` },
      })
    }
    if (u.pathname === '/final') {
      const body = JSON.stringify({
        marker: MARKER,
        cookie: req.headers.get('cookie') || '',
        ua: req.headers.get('user-agent') || '',
        mobileHint: req.headers.get('sec-ch-ua-mobile') || '',
      })
      // padding: 避开引擎"极短内容判拦"启发式(ff-b 教训)
      return new Response(body + pad(300), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  },
})

// ---------- 回环转发代理(仅 http:// 绝对 URI 形态, 供 RequestInit.proxy 消费) ----------
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

Bun.listen({
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
        proxyLog.push({
          url: req.url,
          cookie: req.headers['cookie'] || '',
          ua: req.headers['user-agent'] || '',
        })
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

// ---------- 引擎链路 ----------
async function main() {
  await new Promise((r) => setTimeout(r, 300)) // 服务就绪窗口
  const cfg = { autoCookie: true } // FetchConfig 最小面: 逐跳 Cookie 收集开启
  const ua = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  const text = await fetchHttpForTest(`${ORIGIN}/start`, cfg as never, ua, `http://127.0.0.1:${PROXY_PORT}`, 'relay')

  const assertions: { name: string; pass: boolean; detail: string }[] = []
  const push = (name: string, pass: boolean, detail: string) => assertions.push({ name, pass, detail })

  // A1 代理观测到两跳
  push('A1 逐跳重定向(代理观测 2 请求)', proxyLog.length === 2, `proxyLog=${JSON.stringify(proxyLog.map((p) => p.url))}`)
  // A2 cookie 穿透: hop2 携带 hop1 种下的会话 Cookie
  const finalEntry = proxyLog.find((p) => p.url.endsWith('/final'))
  push('A2 Cookie 逐跳穿透(hop2 带 sid)', !!finalEntry && finalEntry.cookie.includes(COOKIE_VAL), `cookie=${finalEntry?.cookie}`)
  // A3 指纹头组穿透: UA + sec-ch-ua-mobile 到达源站(经中继重组不丢头)
  const originSeen = text.includes(MARKER) ? JSON.parse(text.slice(0, text.lastIndexOf('}') + 1)) : null
  push('A4 最终正文可得(base64 往返)', !!originSeen, `text-len=${text.length}`)
  if (originSeen) {
    push('A3a UA 穿透', originSeen.ua === ua, `ua=${originSeen.ua.slice(0, 60)}`)
    push('A3b 指纹头穿透(sec-ch-ua-mobile ?1)', originSeen.mobileHint === '?1', `hint=${originSeen.mobileHint}`)
    push('A3c 源站见会话 Cookie', String(originSeen.cookie).includes(COOKIE_VAL), `cookie=${originSeen.cookie}`)
  }

  let failed = 0
  for (const a of assertions) {
    console.log(`${a.pass ? '✅' : '❌'} ${a.name} — ${a.detail}`)
    if (!a.pass) failed++
  }
  console.log(failed === 0 ? '\nALL PASS — 中继桥回环端到端全绿' : `\n${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('E2E 异常:', e instanceof Error ? e.message : e)
  process.exit(1)
})
