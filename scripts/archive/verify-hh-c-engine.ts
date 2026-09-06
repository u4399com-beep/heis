// ============================================================
// verify-hh-c-engine.ts — scrapling 桥(hh-c)引擎侧验证
// ============================================================
// 范围: src/lib/crawl/fetcher.ts + types.ts 的 scrapling-* 接入面(fetchMode 分流/
// sanitize 白名单/回环豁免/代理透传/降级契约), 与 verify-hh-c-bridge.ts(桥协议级)
// 互补。前置: 桥运行于 127.0.0.1:3012(bun run dev, mini-services/scrapling-bridge)。
// 断言面:
//   A 单元: scraplingModeOf 枚举判定矩阵('native'/缺省/非法值 → null)
//   B sanitize 往返: fetchMode 四枚举存活/非法丢弃 + scraplingBridgeUrl 形态校验
//     (非 http(s)/含 CR-LF/超长 → 整字段丢弃) + 缺省零行为(DEFAULT_FETCH_CONFIG 无 fetchMode)
//   C pickProxyFor: 目标回环 → ''(回环豁免, 桥调用不代理) / 非回环 → 代理值透传
//   D 引擎链: fetchPage × fetchMode='scrapling-static' 取回 mock 源站, html 逐字节一致,
//     mock 恰被请求 1 次(桥代发不双发)
//   E 非法 fetchMode 回退 native: fetchPage × 'scrapling-bogus' 仍取回内容(native 链)
//   F 'native' 显式值: fetchPage 正常(native 链零回归)
//   G 桥不可达降级不断链: kill 桥 → fetchPage('scrapling-static') 仍成功(native 降级)
//     → 重新拉起桥 → health 复活
//   H 真网一例(串行+1s 间隔): biquge.tw 首页 fetchMode='scrapling-static' 经 fetchPage
//     断言非拦+标题命中; stealthy 真网尝试(patchright 已装则跑, 目标侧结果如实留档,
//     失败计 skip 不阻塞)
// 运行: bun run scripts/verify-hh-c-engine.ts
// ============================================================
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net'
import { gzipSync } from 'node:zlib'
import { spawn as spawnDetached, spawnSync } from 'node:child_process'
import { fetchPage, scraplingModeOf, pickProxyFor } from '../src/lib/crawl/fetcher'
import { sanitizeFetchConfig, DEFAULT_FETCH_CONFIG } from '../src/lib/crawl/types'

const BRIDGE = process.env.SCRAPLING_BRIDGE_URL || 'http://127.0.0.1:3012'
const BRIDGE_DIR = '/home/z/my-project/mini-services/scrapling-bridge'
const BRIDGE_LOG = '/home/z/my-project/scrapling-bridge.log'
const MOCK_PORT = Number(process.env.HH_C_ENGINE_MOCK_PORT || 41381)

let pass = 0
let fail = 0
let skip = 0
const failures: string[] = []
function ok(cond: boolean, name: string, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
function skipped(name: string, detail = '') {
  skip++; console.log(`  ⏭️  SKIP ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 回环 mock 源站(node:net 裸 TCP, 与 verify-hh-c-bridge 同款):
 *  桥内 curl_cffi 仿体对 http:// 目标发 h2c 升级, node:http 的 upgrade 事件路径
 *  与其不兼容(curl 侧 Empty reply), 裸 TCP 按请求行应答三模式全通 —— 详证见桥级脚本头注 */
function startMock(): Promise<{ server: TcpServer; base: string; pageHtml: string; hits: () => number }> {
  const state = { hits: 0 }
  const pageHtml =
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<title>hh-c 引擎侧验证源站</title></head><body><main>` +
    `<h1>大漠孤烟直——引擎链 scrapling 分流测试正文。</h1>` +
    `<p>长河落日圆，萧关逢候骑，都护在燕然。塞外飞雪，驿站灯火明灭。</p>` +
    `<p>${'引擎链验证填充内容。'.repeat(60)}</p>` +
    `</main></body></html>`
  const server = createTcpServer((sock: Socket) => {
    let buf = Buffer.alloc(0)
    sock.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      const s = buf.toString('utf8')
      const idx = s.indexOf('\r\n\r\n')
      if (idx < 0) return
      buf = Buffer.alloc(0)
      state.hits++
      const firstLine = s.slice(0, idx).split('\r\n')[0] || ''
      const pathname = (firstLine.split(' ')[1] || '/').split('?')[0]
      if (pathname === '/redirect') {
        sock.end(Buffer.from(`HTTP/1.1 302 Found\r\nLocation: /final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`))
        return
      }
      const html = pathname === '/final' ? pageHtml.replace('引擎侧验证源站', '引擎侧重定向终态页') : pageHtml
      const gz = gzipSync(Buffer.from(html, 'utf8'))
      sock.end(Buffer.concat([
        Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Encoding: gzip\r\nContent-Length: ${gz.length}\r\nConnection: close\r\n\r\n`),
        gz,
      ]))
    })
    sock.on('error', () => { /* 客户端侧断连忽略 */ })
  })
  return new Promise((resolve) => {
    server.listen(MOCK_PORT, '127.0.0.1', () =>
      resolve({ server, base: `http://127.0.0.1:${MOCK_PORT}`, pageHtml, hits: () => state.hits }))
  })
}

async function bridgeAlive(): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(3000) })
    return r.ok && ((await r.json() as any)?.ok === true)
  } catch { return false }
}

async function killBridge() {
  spawnSync('pkill', ['-f', 'server.py'])
  for (let i = 0; i < 20; i++) {
    if (!(await bridgeAlive())) return true
    await sleep(300)
  }
  return !(await bridgeAlive())
}

function restartBridge() {
  spawnDetached('sh', ['-c', `cd ${BRIDGE_DIR} && nohup bun run dev >> ${BRIDGE_LOG} 2>&1 &`], {
    stdio: 'ignore', detached: true,
  }).unref()
}

async function main() {
  console.log(`[verify-hh-c-engine] bridge=${BRIDGE} mock=127.0.0.1:${MOCK_PORT}`)
  if (!(await bridgeAlive())) {
    console.log('[verify-hh-c-engine] 桥不在运行, 先拉起…')
    restartBridge()
    for (let i = 0; i < 40 && !(await bridgeAlive()); i++) await sleep(500)
  }

  const mock = await startMock()

  try {
    // ---------- A 单元: scraplingModeOf ----------
    console.log('\n— A scraplingModeOf 枚举判定 —')
    ok(scraplingModeOf('scrapling-static') === 'static', "scrapling-static → 'static'")
    ok(scraplingModeOf('scrapling-stealthy') === 'stealthy', "scrapling-stealthy → 'stealthy'")
    ok(scraplingModeOf('scrapling-playwright') === 'playwright', "scrapling-playwright → 'playwright'")
    ok(scraplingModeOf('native') === null, "'native' → null(native 链)")
    ok(scraplingModeOf(undefined) === null, '缺省 → null(native 链)')
    ok(scraplingModeOf(null) === null, 'null → null(native 链)')
    ok(scraplingModeOf('scrapling-bogus') === null, "'scrapling-bogus' → null(非法值回退)")
    ok(scraplingModeOf('scrapling-') === null, "'scrapling-' → null(空后缀回退)")

    // ---------- B sanitize 往返 ----------
    console.log('\n— B sanitizeFetchConfig 往返 —')
    const s1 = sanitizeFetchConfig({ fetchMode: 'scrapling-static', scraplingBridgeUrl: 'http://127.0.0.1:3012' })
    ok(s1.fetchMode === 'scrapling-static', '合法 fetchMode 往返无损')
    ok(s1.scraplingBridgeUrl === 'http://127.0.0.1:3012', '合法 scraplingBridgeUrl 往返无损')
    const s2 = sanitizeFetchConfig({ fetchMode: 'native' })
    ok(s2.fetchMode === 'native', "'native' 显式接受(语义=缺省)")
    const s3 = sanitizeFetchConfig({ fetchMode: 'scrapling-bogus' })
    ok(s3.fetchMode === undefined, "非法 fetchMode('scrapling-bogus') → undefined(回退 native)")
    const s4 = sanitizeFetchConfig({ fetchMode: 'curl_cffi' })
    ok(s4.fetchMode === undefined, '枚举外任意值 → undefined')
    const s5 = sanitizeFetchConfig({ scraplingBridgeUrl: 'ftp://x.example' })
    ok(s5.scraplingBridgeUrl === undefined, '非 http(s) bridgeUrl → 丢弃')
    const s6 = sanitizeFetchConfig({ scraplingBridgeUrl: 'http://127.0.0.1:3012\r\nX-Injected: 1' })
    ok(s6.scraplingBridgeUrl === undefined, 'CR/LF 注入 bridgeUrl → 整字段丢弃(单行化后仍需过 URL 形态门)')
    const s7 = sanitizeFetchConfig({ scraplingBridgeUrl: 'https://bridge.example:3012/path' })
    ok(s7.scraplingBridgeUrl === 'https://bridge.example:3012/path', 'https bridgeUrl 放行')
    ok(!('fetchMode' in DEFAULT_FETCH_CONFIG), 'DEFAULT_FETCH_CONFIG 无 fetchMode(缺省零行为变化)')

    // ---------- C pickProxyFor 回环豁免/透传 ----------
    console.log('\n— C pickProxyFor(代理透传给桥的前置) —')
    const proxyCfg: Partial<typeof DEFAULT_FETCH_CONFIG> = { ...DEFAULT_FETCH_CONFIG, proxyUrl: 'http://user:pass@203.0.113.9:8080' }
    ok(pickProxyFor(mock.base + '/page', proxyCfg as typeof DEFAULT_FETCH_CONFIG) === '', '目标回环 → 直连(桥调用不被代理, 回环豁免)')
    ok(pickProxyFor('https://www.example.com/page', proxyCfg as typeof DEFAULT_FETCH_CONFIG) === proxyCfg.proxyUrl, '非回环 → 代理值原样透传')
    ok(pickProxyFor('https://www.example.com/page', { ...DEFAULT_FETCH_CONFIG }) === '', '未配置代理 → 直连')

    // ---------- D 引擎链 scrapling-static ----------
    console.log('\n— D fetchPage × scrapling-static × mock —')
    const hitsBefore = mock.hits()
    const d1 = await fetchPage(`${mock.base}/page`, { fetchMode: 'scrapling-static' })
    ok(d1.html === mock.pageHtml, 'html 与源站逐字节一致(经引擎链+桥 curl_cffi)')
    ok(d1.engine === 'http', `engine === 'http'(实际 ${d1.engine})`)
    ok(d1.blocked === false, 'blocked === false')
    ok(mock.hits() === hitsBefore + 1, `mock 恰被请求 1 次(实际 ${mock.hits() - hitsBefore}, 桥代发不双发)`)
    const d2 = await fetchPage(`${mock.base}/redirect`, { fetchMode: 'scrapling-static' })
    ok(d2.html.includes('引擎侧重定向终态页'), '桥内重定向跟随: 终态正文取回')
    ok(mock.hits() >= hitsBefore + 3, '重定向场景 mock 两跳均命中桥转发')

    // ---------- E 非法 fetchMode 回退 native ----------
    console.log('\n— E 非法 fetchMode 回退 native —')
    const e1 = await fetchPage(`${mock.base}/page`, { fetchMode: 'scrapling-bogus' })
    ok(e1.html === mock.pageHtml, "fetchMode='scrapling-bogus' → native 链取回成功(不断链)")
    const e2 = await fetchPage(`${mock.base}/page`, { fetchMode: 'native' })
    ok(e2.html === mock.pageHtml, "fetchMode='native' 显式 → native 链正常")

    // ---------- F 缺省零回归 ----------
    console.log('\n— F 缺省(未配置 fetchMode) —')
    const f1 = await fetchPage(`${mock.base}/page`)
    ok(f1.html === mock.pageHtml, '未配置 fetchMode → native 链逐字节一致(缺省零回归)')
  } catch (e: any) {
    ok(false, 'A~F 主流程异常', String(e?.message || e).slice(0, 200))
  }

  // ---------- G 桥不可达降级不断链(kill → 验证 → 重新拉起) ----------
  console.log('\n— G 桥不可达 → native 降级不断链 —')
  const killed = await killBridge()
  ok(killed, '桥已停止(health 不可达)')
  let g1: Awaited<ReturnType<typeof fetchPage>> | null = null
  try {
    g1 = await fetchPage(`${mock.base}/page`, { fetchMode: 'scrapling-static' })
    ok(g1.html === mock.pageHtml, '桥宕机 → scrapling-static 自动降级 native, 内容取回(不断链)')
    ok(g1.engine === 'http' && g1.blocked === false, '降级结果 engine/blocked 正常')
  } catch (e: any) {
    ok(false, '桥宕机降级断链!', String(e?.message || e).slice(0, 160))
  }
  restartBridge()
  for (let i = 0; i < 60 && !(await bridgeAlive()); i++) await sleep(500)
  const revived = await bridgeAlive()
  ok(revived, '桥已重新拉起(health ok)')
  if (!revived) { restartBridge(); for (let i = 0; i < 60 && !(await bridgeAlive()); i++) await sleep(500) }

  mock.server.close()

  // ---------- H 真网一例(串行+1s 间隔) ----------
  console.log('\n— H 真网: biquge.tw 首页 × scrapling-static —')
  try {
    const h1 = await fetchPage('https://www.biquge.tw/', { fetchMode: 'scrapling-static', timeout: 30000 })
    const titleHit = /<title[^>]*>[^<]*笔趣阁/i.test(h1.html) || /笔趣阁|biquge/i.test(h1.html.slice(0, 4000))
    ok(!h1.blocked && h1.html.length > 5000, `真网 scrapling-static 取回 ${h1.html.length} chars, blocked=${h1.blocked}`)
    ok(titleHit, '真网标题命中(笔趣阁/biquge)')
  } catch (e: any) {
    ok(false, '真网 scrapling-static 失败', String(e?.message || e).slice(0, 160))
  }
  await sleep(1000)

  console.log('\n— H2 真网: biquge.tw × scrapling-stealthy(patchright, 信息面) —')
  if (!process.env.HH_C_SKIP_STEALTHY) {
    try {
      const h2 = await fetchPage('https://www.biquge.tw/', { fetchMode: 'scrapling-stealthy', timeout: 90000 })
      if (!h2.blocked && /笔趣阁|biquge/i.test(h2.html.slice(0, 4000))) {
        ok(true, `真网 stealthy 取回 ${h2.html.length} chars + 标题命中(patchright 实战)`)
      } else {
        skipped('真网 stealthy 未通过内容断言(目标侧结果如实留档, 不阻塞)', `blocked=${h2.blocked} len=${h2.html.length}`)
      }
    } catch (e: any) {
      skipped('真网 stealthy 异常(目标侧/环境因素如实留档, 桥级④已证能力面)', String(e?.message || e).slice(0, 120))
    }
  } else skipped('真网 stealthy', 'HH_C_SKIP_STEALTHY=1')

  console.log(`\n[verify-hh-c-engine] pass=${pass} fail=${fail} skip=${skip}`)
  if (fail > 0) {
    console.log('[verify-hh-c-engine] FAILED:', failures.join(' | '))
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('[verify-hh-c-engine] crash:', e)
  process.exit(1)
})
