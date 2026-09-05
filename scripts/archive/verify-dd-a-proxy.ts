// ============================================================
// Task dd-a 验证脚本 — 出口代理池(proxy rotation)引擎增强
// A 单代理链路: fetchPage(engine=http) 经 mock forward proxy 到达目标(Via 头实证)
// B 多代理分布: 2 条代理 ×24 请求 → 两条都被用到(均匀随机轮换, 且每请求恰好到达一次)
// C 全挂降级: 2 条死端口代理 → 降级直连仍成功 + warn 日志存在(轮换/降级全程不抛错)
// D 回环豁免: 目标 127.0.0.1/localhost/::1 时不走代理直连 + tokenUrl 回环豁免端到端
// E sanitize 往返: types.ts sanitizeFetchConfig 白名单(钳长/逐条校验/去重/上限)
//   + 经 dev server /api/admin/rules/test 路由白名单 proxyUrl 存活(单源 sanitizeFetchConfig)
// F curl 链: fetchViaCurl -x http 代理 + -x socks5(mini relay) 实测
// G browser 链: fetchPage(engine=browser) 跳过 Obscura → 裸 Playwright per-context
//   proxy(launch 占位 + context 覆盖)真实 chromium 走代理到达目标
// 支持矩阵实证(探针 probe1~4 + 本脚本, 如实不虚报):
//   bun fetch 仅 http/https; socks5 UnsupportedProxyProtocol → 自然落 curl 链(-x socks5 可用);
//   裸 Playwright per-context http/socks5 可用; Obscura 单例池不支持代理(占位 launch 会
//   让无代理 context 直连全断, ERR_PROXY_CONNECTION_FAILED 实测)
// 运行: bun scripts/verify-dd-a-proxy.ts (mock 全本地, E 段路由测试需 dev server 存活)
// ============================================================
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'

export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}

// ---------- warn 日志捕获(降级契约断言用) ----------
const warns: string[] = []
const origWarn = console.warn
console.warn = (...args: unknown[]) => {
  warns.push(args.map((a) => String(a)).join(' '))
  origWarn(...args)
}

// ---------- 非回环地址(代理测试目标 host, 回环豁免不触发) ----------
let lanIp = ''
for (const k of Object.keys(os.networkInterfaces())) {
  for (const n of os.networkInterfaces()[k] || []) {
    if (n.family === 'IPv4' && !n.internal) { lanIp = n.address; break }
  }
  if (lanIp) break
}
if (!lanIp) { console.log('未找到非回环 IPv4 地址, 无法测试代理路径'); process.exit(1) }

// ---------- mock 目标站(node:http, 0.0.0.0; 记录每请求 Via 头) ----------
const targetHits: { path: string; via: string | null }[] = []
const PAGE = (title: string, body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`
const listHtml = () =>
  PAGE('DDA Proxy Mock 书库', Array.from({ length: 12 }, (_, i) =>
    `<li class="item"><a class="name" href="/book/${i + 1}">代理验证书籍${i + 1}</a><span class="author">作者${i + 1}</span></li>`
  ).join('') + '<p>' + '正文占位'.repeat(200) + '</p>')

function startTarget(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      targetHits.push({ path: req.url || '', via: (req.headers['via'] as string) || null })
      if (req.url?.startsWith('/token')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ token: 'T0K123' }))
        return
      }
      if (req.url?.startsWith('/guarded')) {
        const u = new URL(req.url, `http://${lanIp}`)
        if (u.searchParams.get('token') !== 'T0K123') { res.writeHead(403); res.end('no token'); return }
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (req.url?.includes('-list')) res.end(listHtml())
      else res.end(PAGE('DDA Proxy Mock', `OK ${req.url} ` + '内容'.repeat(300)))
    })
    srv.listen(0, '0.0.0.0', () => {
      const port = (srv.address() as { port: number }).port
      resolve({ port, close: () => srv.close() })
    })
  })
}

// ---------- mock forward proxy(node:http 绝对URI转发, 打 Via 标记) ----------
function startProxy(tag: string): Promise<{ port: number; hits: string[]; close: () => void }> {
  return new Promise((resolve) => {
    const hits: string[] = []
    const srv = http.createServer((req, res) => {
      const abs = req.url || ''
      hits.push(abs)
      const headers = { ...req.headers } as Record<string, unknown>
      delete headers['host']
      fetch(abs, { headers: { ...headers, via: `1.1 ${tag}` } as Record<string, string> })
        .then(async (up) => {
          const buf = await up.arrayBuffer()
          const h = new Headers(up.headers)
          h.delete('content-encoding')
          h.delete('content-length')
          h.delete('transfer-encoding')
          res.writeHead(up.status, Object.fromEntries(h.entries()))
          res.end(Buffer.from(buf))
        })
        .catch((e: unknown) => { res.writeHead(502); res.end('proxy err ' + String((e as Error)?.message || e)) })
    })
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      resolve({ port, hits, close: () => srv.close() })
    })
  })
}

// ---------- mini socks5 relay(无认证, TCP relay) ----------
function startSocks5(): Promise<{ port: number; conns: string[]; close: () => void }> {
  return new Promise((resolve) => {
    const conns: string[] = []
    const srv = net.createServer((client) => {
      client.once('data', (greet: Buffer) => {
        client.write(Buffer.from([0x05, 0x00]))
        client.once('data', (req: Buffer) => {
          const atyp = req[3]
          let host = ''
          let off = 4
          if (atyp === 1) { host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`; off = 8 }
          else if (atyp === 3) { const l = req[4]; host = req.slice(5, 5 + l).toString(); off = 5 + l }
          else { client.end(); return }
          const port = req.readUInt16BE(off)
          conns.push(`${host}:${port}`)
          const up = net.connect(port, host, () => {
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
            client.pipe(up)
            up.pipe(client)
          })
          up.on('error', () => client.destroy())
        })
      })
      client.on('error', () => {})
    })
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      resolve({ port, conns, close: () => srv.close() })
    })
  })
}

/** 死端口: 占位拿号后立即释放(连接应被拒绝) */
function deadPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })
}

// ---------- 引擎模块(动态 import, 与既有 verify 脚本同风格) ----------
const { fetchPage, fetchViaCurl, parseProxyPool, isLoopbackTarget, pickProxyFor } = await import('../src/lib/crawl/fetcher')
const { sanitizeFetchConfig, DEFAULT_FETCH_CONFIG } = await import('../src/lib/crawl/types')

async function main() {
  const target = await startTarget()
  const proxyA = await startProxy('dda-proxy-a')
  const proxyB = await startProxy('dda-proxy-b')
  const s5 = await startSocks5()
  const dead1 = await deadPort()
  const dead2 = await deadPort()
  const T = `http://${lanIp}:${target.port}`
  const PA = `http://127.0.0.1:${proxyA.port}`
  const PB = `http://127.0.0.1:${proxyB.port}`
  const lastVia = (prefix: string): string | null | undefined => {
    const hits = targetHits.filter((h) => h.path.startsWith(prefix))
    return hits.length ? hits[hits.length - 1].via : undefined
  }

  console.log(`\n== A 单代理链路(engine=http, bun fetch RequestInit.proxy) ==`)
  {
    const res = await fetchPage(`${T}/a-list`, { engine: 'http', proxyUrl: PA, retries: 0, timeout: 15000 })
    ok('A1 请求成功且未被拦', !res.blocked && res.html.includes('代理验证书籍1'))
    ok('A2 目标端可见代理 Via 路径', lastVia('/a-list') === '1.1 dda-proxy-a', `via=${lastVia('/a-list')}`)
    ok('A3 代理端收到绝对URI转发', proxyA.hits.some((h) => h.includes(`http://${lanIp}:${target.port}/a-list`)), proxyA.hits[0] || '无')
  }

  console.log(`\n== B 多代理分布(2 条 ×24 请求均匀随机轮换) ==`)
  {
    const picks: string[] = []
    const twoProxyCfg = { ...DEFAULT_FETCH_CONFIG, engine: 'http' as const, proxyUrl: `${PA},${PB}` }
    for (let i = 0; i < 200; i++) picks.push(pickProxyFor(`${T}/x`, twoProxyCfg))
    ok('B1 pickProxyFor 两条代理均有命中(200次抽样)', picks.includes(PA) && picks.includes(PB), `A=${picks.filter((p) => p === PA).length}/B=${picks.filter((p) => p === PB).length}`)
    for (let i = 0; i < 24; i++) {
      await fetchPage(`${T}/b-list?i=${i}`, { engine: 'http', proxyUrl: `${PA},${PB}`, retries: 0, timeout: 15000 })
    }
    const bHits = targetHits.filter((h) => h.path.startsWith('/b-list'))
    const viaA = bHits.filter((h) => h.via === '1.1 dda-proxy-a').length
    const viaB = bHits.filter((h) => h.via === '1.1 dda-proxy-b').length
    ok('B2 24 请求全部到达目标', bHits.length === 24, `到达=${bHits.length}`)
    ok('B3 代理A被用到', viaA > 0, `A=${viaA}`)
    ok('B4 代理B被用到', viaB > 0, `B=${viaB}`)
    ok('B5 无双达(轮换首成功即止, 24=A+B)', viaA + viaB === 24, `${viaA}+${viaB}`)
  }

  console.log(`\n== C 全部代理失败 → 降级直连重试一次(warn 不抛错不中断) ==`)
  {
    warns.length = 0
    const res = await fetchPage(`${T}/c-list`, { engine: 'http', proxyUrl: `http://127.0.0.1:${dead1},http://127.0.0.1:${dead2}`, retries: 0, timeout: 8000 })
    ok('C1 死代理×2 后降级直连仍成功', !res.blocked && res.html.includes('代理验证书籍1'))
    ok('C2 目标端无 Via(直连到达)', lastVia('/c-list') === null, `via=${lastVia('/c-list')}`)
    ok('C3 每条死代理一条轮换 warn', warns.filter((w) => w.includes('代理请求失败, 轮换下一条')).length === 2, `${warns.filter((w) => w.includes('轮换下一条')).length}条`)
    ok('C4 降级直连 warn 存在', warns.some((w) => w.includes('降级直连重试')))
    ok('C5 死代理未打到目标, 直连恰好 1 次到达', targetHits.filter((h) => h.path.startsWith('/c-list')).length === 1)
  }

  console.log(`\n== D 回环豁免(目标 127.0.0.1/localhost/::1 直连, 代理不截胡) ==`)
  {
    ok('D1 isLoopbackTarget 判定矩阵', isLoopbackTarget('http://127.0.0.1:1/x') && isLoopbackTarget('http://localhost/x') && isLoopbackTarget('http://[::1]:2/x') && isLoopbackTarget('http://127.8.8.8/x') && isLoopbackTarget('http://a.localhost/x') && !isLoopbackTarget(`${T}/x`) && !isLoopbackTarget('http://x.com/x'))
    const res = await fetchPage(`http://127.0.0.1:${target.port}/d-list`, { engine: 'http', proxyUrl: PA, retries: 0, timeout: 15000 })
    ok('D2 回环目标直连成功', !res.blocked && res.html.includes('代理验证书籍1'))
    ok('D3 目标端无 Via(未经代理)', lastVia('/d-list') === null, `via=${lastVia('/d-list')}`)
    // token 预取钩子端到端: tokenUrl 在 127.0.0.1(bqg713-proxy 同型), 目标守卫页需 token;
    // 代理池为两条死代理 —— 若回环豁免失效, 预取走死代理必败 → 无 token → 403
    warns.length = 0
    const g = await fetchPage(`${T}/guarded?book=1`, {
      engine: 'http', retries: 0, timeout: 8000,
      proxyUrl: `http://127.0.0.1:${dead1},http://127.0.0.1:${dead2}`,
      tokenUrl: `http://127.0.0.1:${target.port}/token`,
      tokenPattern: 'token',
      tokenInjection: 'url',
    })
    ok('D4 token 预取(回环豁免)+守卫页经代理降级直连全链成功', !g.blocked && g.html.includes('OK /guarded'))
    ok('D5 回环预取未进代理轮换(仅主请求 2 条轮换 warn)', warns.filter((w) => w.includes('轮换下一条')).length === 2, `${warns.filter((w) => w.includes('轮换下一条')).length}条`)
  }

  console.log(`\n== E sanitize 白名单往返 ==`)
  {
    const s1 = sanitizeFetchConfig({ proxyUrl: ' http://u:p@h1:1 , http://h2:2 ,, junk, ftp://x:1, http://h3:3 ' })
    ok('E1 逐条校验+trim+去空: 合法存活/非法剔除', s1.proxyUrl === 'http://u:p@h1:1,http://h2:2,http://h3:3', s1.proxyUrl || 'undefined')
    const s2 = sanitizeFetchConfig({ proxyUrl: 'socks5://h:1080,socks5h://h2:1080,https://h3:443' })
    ok('E2 socks5(h)/https 形态放行', s2.proxyUrl === 'socks5://h:1080,socks5h://h2:1080,https://h3:443', s2.proxyUrl || 'undefined')
    ok('E3 全非法丢弃', sanitizeFetchConfig({ proxyUrl: 'abc,ftp://x:1' }).proxyUrl === undefined)
    ok('E4a 单条超长(>500)丢弃', sanitizeFetchConfig({ proxyUrl: `http://${'a'.repeat(600)}:1` }).proxyUrl === undefined)
    ok('E4b 接近限长(489字符)存活', sanitizeFetchConfig({ proxyUrl: `http://${'a'.repeat(480)}:1` }).proxyUrl === `http://${'a'.repeat(480)}:1`)
    const many = Array.from({ length: 15 }, (_, i) => `http://h${i}:1`).join(',')
    ok('E5 上限 10 条', parseProxyPool(sanitizeFetchConfig({ proxyUrl: many }).proxyUrl).length === 10)
    ok('E6 parseProxyPool 去重', parseProxyPool('http://a:1, http://a:1 ,,http://b:2').length === 2)
    const routeRes = await fetch('http://localhost:3000/api/admin/rules/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        section: 'list',
        url: `${T}/e-list`,
        rule: {
          enabled: true,
          itemSelector: { type: 'css', expression: 'li.item' },
          fields: { title: { type: 'css', expression: 'a.name' }, bookUrl: { type: 'css', expression: 'a.name', attr: 'href' } },
        },
        fetch: { engine: 'http', timeout: 15000, retries: 0, proxyUrl: PA },
      }),
    })
    const routeJson = await routeRes.json().catch(() => ({ ok: false }) as any)
    ok('E7 路由 sanitizeFetch 白名单 proxyUrl 存活(单源 sanitizeFetchConfig)', routeJson?.ok === true && (routeJson?.data?.count ?? 0) >= 10, JSON.stringify(routeJson).slice(0, 120))
    ok('E8 路由测试请求确实经代理到达', lastVia('/e-list') === '1.1 dda-proxy-a', `via=${lastVia('/e-list')}`)
  }

  console.log(`\n== F curl 链(-x http 代理 + -x socks5) ==`)
  {
    const cfg = { ...DEFAULT_FETCH_CONFIG, engine: 'http' as const, timeout: 15000, retries: 0 }
    const r1 = await fetchViaCurl(`${T}/f-list`, cfg, 'dd-a-curl-ua', PA)
    ok('F1 curl -x http 代理到达目标', r1.includes('代理验证书籍1'))
    ok('F2 目标端可见 curl 代理 Via', lastVia('/f-list') === '1.1 dda-proxy-a', `via=${lastVia('/f-list')}`)
    const r2 = await fetchViaCurl(`${T}/f2-list`, cfg, 'dd-a-curl-ua', `socks5://127.0.0.1:${s5.port}`)
    ok('F3 curl -x socks5 到达目标(bun fetch 不支持 socks5, curl 支持实测)', r2.includes('代理验证书籍1'))
    ok('F4 socks5 relay 确认转发发生', s5.conns.some((c) => c.includes(`${lanIp}:${target.port}`)), s5.conns[0] || '无')
  }

  console.log(`\n== G browser 链(跳过 Obscura → 裸 Playwright per-context proxy, 真 chromium) ==`)
  {
    const res = await fetchPage(`${T}/g-list`, { engine: 'browser', proxyUrl: PA, waitMs: 200, timeout: 40000, retries: 0 })
    ok('G1 browser 引擎经代理渲染成功', !res.blocked && res.engine === 'browser' && res.html.includes('代理验证书籍1'))
    ok('G2 目标端可见代理 Via(per-context 生效)', lastVia('/g-list') === '1.1 dda-proxy-a', `via=${lastVia('/g-list')}`)
  }

  // ---------- 收尾 ----------
  target.close()
  proxyA.close()
  proxyB.close()
  s5.close()
  console.warn = origWarn
  console.log(`\n========================================`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  console.log(`支持矩阵(实测): bun 运行时 fetch http/https ✓ socks5 ✗ | node 运行时(next dev 实测以 node 运行)undici 静默忽略 proxy ✗ → 代理尝试直走 curl 链 ✓ 全形态 | 裸 Playwright per-context ✓ | Obscura ✗(代理时自动改走裸路径)`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error('verify 脚本异常:', (e as Error)?.message || e)
  process.exit(1)
})
