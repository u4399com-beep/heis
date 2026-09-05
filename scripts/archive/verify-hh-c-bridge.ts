// ============================================================
// verify-hh-c-bridge.ts — scrapling 桥(hh-c)桥级验证
// ============================================================
// 范围: mini-services/scrapling-bridge(127.0.0.1:3012)桥协议本身的正确性,
// 不经引擎链路。前置: 桥已由 `cd mini-services/scrapling-bridge && bun run dev` 拉起。
// 断言面:
//   ① /health: ok/selfTestOk/versions(scrapling+python)/modes 三模式齐全
//   ② /fetch static × 回环 mock 源站(node:http echo): status/html 与源站逐字节一致
//     (含 gzip 编码 + 中文正文 —— curl_cffi 自动解压/解码正确性)
//   ③ /fetch static × 重定向: 跟随后终态 status/finalUrl 命中
//   ④ /fetch stealthy × 回环 mock(patchright 浏览器真实渲染)
//   ⑤ /fetch 非法 mode → ok:false(引擎侧据此降级的契约面)
//   ⑥ /fetch 目标不可达 → ok:false + error 留档(桥内异常不炸进程)
// 运行: bun run scripts/verify-hh-c-bridge.ts
// ============================================================
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net'
import { gzipSync } from 'node:zlib'

const BRIDGE = process.env.SCRAPLING_BRIDGE_URL || 'http://127.0.0.1:3012'
const MOCK_PORT = Number(process.env.HH_C_MOCK_PORT || 41371)

let pass = 0
let fail = 0
const failures: string[] = []
function ok(cond: boolean, name: string, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 回环 mock 源站: gzip 编码 + 中文正文 + 长度 padding(>1200 避引擎判拦启发式)。
 *  兼容性坑(实测留档): 桥内 curl_cffi 的 chrome 仿体对 http:// 目标会发 h2c 升级
 *  (Upgrade: h2c + Connection: Upgrade, HTTP2-Settings)。v1 用 node:http mock 挂
 *  'upgrade' 事件应答 —— 实测 curl_cffi 侧仍收 "Empty reply"(node http server 的
 *  upgrade 路径 socket 分离行为与其不兼容), 改用 node:net 裸 TCP mock: 收齐
 *  \r\n\r\n 后按请求行直接以 HTTP/1.1 应答(对 Upgrade 请求回普通响应, RFC 7230
 *  允许服务器忽略 Upgrade)—— 桥 static/stealthy/playwright 三模式实测全通。
 *  真实源站(nginx/apache/CDN)不存在此问题, 桥内 Fetcher 无需改动。 */
function startMock(): Promise<{ server: TcpServer; base: string; pageHtml: string; hits: number }> {
  const state = { hits: 0 }
  const pageHtml =
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<title>hh-c 桥级验证源站</title></head><body><main>` +
    `<h1>残阳如血，照大旗——scrapling 桥测试正文。</h1>` +
    `<p>风吹草低见牛羊，塞外秋风萧瑟，一队商旅缓缓行过戈壁，驼铃声声入夜。</p>` +
    `<p>${'桥级验证填充内容。'.repeat(60)}</p>` +
    `</main></body></html>`
  const respondTo = (raw: string, sock: Socket) => {
    const firstLine = raw.split('\r\n')[0] || ''
    const pathname = (firstLine.split(' ')[1] || '/').split('?')[0]
    state.hits++
    const html = pathname === '/final'
      ? pageHtml.replace('hh-c 桥级验证源站', 'hh-c 重定向终态页')
      : pageHtml
    if (pathname === '/redirect') {
      sock.end(Buffer.from(`HTTP/1.1 302 Found\r\nLocation: /final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`))
      return
    }
    const gz = gzipSync(Buffer.from(html, 'utf8'))
    sock.end(Buffer.concat([
      Buffer.from(
        `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n` +
        `Content-Encoding: gzip\r\nContent-Length: ${gz.length}\r\nConnection: close\r\n\r\n`,
      ),
      gz,
    ]))
  }
  const server = createTcpServer((sock) => {
    let buf = Buffer.alloc(0)
    sock.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      const s = buf.toString('utf8')
      const idx = s.indexOf('\r\n\r\n')
      if (idx >= 0) {
        respondTo(s.slice(0, idx), sock)
        buf = Buffer.alloc(0)
      }
    })
    sock.on('error', () => { /* 客户端侧断连(浏览器 favicon 等)忽略 */ })
  })
  return new Promise((resolve) => {
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${MOCK_PORT}`, pageHtml, get hits() { return state.hits } }))
  })
}

async function bridgeFetch(body: Record<string, unknown>): Promise<{ http: number; payload: any }> {
  const res = await fetch(`${BRIDGE}/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  const payload = await res.json().catch(() => null)
  return { http: res.status, payload }
}

async function main() {
  console.log(`[verify-hh-c-bridge] bridge=${BRIDGE} mock=127.0.0.1:${MOCK_PORT}`)
  const mock = await startMock()

  try {
    // ① 健康端点
    console.log('\n— ① /health —')
    const hres = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(10_000) })
    const health = await hres.json().catch(() => null) as any
    ok(hres.ok && !!health, 'health 可达且 JSON')
    ok(health?.ok === true, 'health.ok === true')
    ok(health?.selfTestOk === true, 'health.selfTestOk === true(scrapling 三 Fetcher 可导入)')
    ok(typeof health?.versions?.scrapling === 'string' && health.versions.scrapling.length > 0, `versions.scrapling = ${health?.versions?.scrapling}`)
    ok(String(health?.versions?.python || '').startsWith('3.'), `versions.python = ${health?.versions?.python}`)
    ok(Array.isArray(health?.modes) && ['static', 'stealthy', 'playwright'].every((m) => health.modes.includes(m)), 'modes 三模式齐全')

    // ② static × mock 源站: status/html 与源站逐字节一致(含 gzip + 中文)
    console.log('\n— ② /fetch static 一致性 —')
    const hitsBefore = mock.hits
    const r2 = await bridgeFetch({ url: `${mock.base}/page`, mode: 'static', timeoutMs: 20_000 })
    ok(r2.http === 200 && !!r2.payload, 'static 请求 200 信封')
    ok(r2.payload?.ok === true, 'static payload.ok === true')
    ok(r2.payload?.status === 200, `static status === 200(实际 ${r2.payload?.status})`)
    ok(r2.payload?.html === mock.pageHtml, 'static html 与源站逐字节一致(gzip 解压+UTF-8 中文)')
    ok(r2.payload?.finalUrl === `${mock.base}/page`, `finalUrl === 请求 URL(实际 ${r2.payload?.finalUrl})`)
    ok(mock.hits === hitsBefore + 1, `mock 恰被请求 1 次(实际 ${mock.hits - hitsBefore} 次, 桥不双发)`)
    ok(r2.payload?.html?.includes('残阳如血，照大旗'), '中文正文命中')

    // ③ static × 重定向: 跟随后终态
    console.log('\n— ③ /fetch static 重定向 —')
    const r3 = await bridgeFetch({ url: `${mock.base}/redirect`, mode: 'static', timeoutMs: 20_000 })
    ok(r3.payload?.ok === true && r3.payload?.status === 200, '重定向跟随后 status === 200')
    ok(r3.payload?.finalUrl === `${mock.base}/final`, `finalUrl === 终态 URL(实际 ${r3.payload?.finalUrl})`)
    ok(String(r3.payload?.html || '').includes('重定向终态页'), '终态页正文命中')

    // ④ stealthy × mock(patchright 浏览器真实渲染)
    console.log('\n— ④ /fetch stealthy —')
    const r4 = await bridgeFetch({ url: `${mock.base}/page`, mode: 'stealthy', timeoutMs: 60_000 })
    ok(r4.payload?.ok === true, 'stealthy payload.ok === true(patchright 启动+渲染)')
    ok(r4.payload?.status === 200, `stealthy status === 200(实际 ${r4.payload?.status})`)
    ok(String(r4.payload?.html || '').includes('残阳如血，照大旗') && String(r4.payload?.html || '').includes('hh-c 桥级验证源站'), 'stealthy 渲染正文+标题命中(浏览器序列化 DOM, 不做逐字节断言)')
    ok(String(r4.payload?.html || '').length >= mock.pageHtml.length * 0.9, `stealthy 内容体量合理(${String(r4.payload?.html || '').length} vs ${mock.pageHtml.length} chars)`)
  } catch (e: any) {
    ok(false, '桥级主流程异常', String(e?.message || e).slice(0, 200))
  }

  // ⑤ 非法 mode → ok:false(降级契约面)
  console.log('\n— ⑤ /fetch 非法入参 —')
  const r5 = await bridgeFetch({ url: `${mock.base}/page`, mode: 'nonsense', timeoutMs: 10_000 })
  ok(r5.http === 200 && r5.payload?.ok === false && !!r5.payload?.error, `非法 mode → 200 {ok:false,error}(实际 ${JSON.stringify(r5.payload).slice(0, 120)})`)

  // ⑥ 目标不可达 → ok:false + 桥进程存活
  console.log('\n— ⑥ /fetch 目标不可达 —')
  const r6 = await bridgeFetch({ url: 'http://127.0.0.1:9/x', mode: 'static', timeoutMs: 8000 })
  ok(r6.payload?.ok === false && String(r6.payload?.error || '').length > 0, `目标不可达 → {ok:false,error}(实际 ${String(r6.payload?.error || '').slice(0, 100)})`)
  const h2 = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as any
  ok(h2?.ok === true, '异常后桥进程仍存活(health 复查 ok)')

  mock.server.close()
  console.log(`\n[verify-hh-c-bridge] pass=${pass} fail=${fail}`)
  if (fail > 0) {
    console.log('[verify-hh-c-bridge] FAILED:', failures.join(' | '))
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('[verify-hh-c-bridge] crash:', e)
  process.exit(1)
})
