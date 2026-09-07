// ============================================================
// Task dd-b 验证脚本 — 镜像域名自动故障切换(mirrorDomains) mock 实证
// Bun.serve 双服务利用 "127.0.0.1 与 localhost 是不同 host 字符串" 构造镜像组:
//   localhost:PORT_DEAD   = 死端口(不绑服务, 连接拒绝)模拟主域挂
//   127.0.0.1:PORT_ALIVE  = 活服务(绑 0.0.0.0, IPv4 确定可达)返回内容
// 断言组:
//   ① 主域失败 → 镜像域接管成功(内容正确)
//   ② mirrorDomains 为空 → 零行为变化(失败照旧抛, 活服务零请求)
//   ③ 全组死 → 错误语义与既有单 host 契约一致(Error/无 status/连接拒绝形态)
//   ④ token 钩子组合: tokenUrl={url} 占位符按重写后 URL 重签(逐镜像各取各 token)
//   ⑤ sanitize 往返: 钳长/逐条域名校验/去重/上限10/全非法丢弃
//   ⑥ 经 dev server /api/admin/rules/test(list 段)往返 mirrorDomains 存活
//      (dd-e 重建路由单源复用 types.ts sanitizeFetchConfig 的白名单实证) + 纯函数单测
// 运行: bun scripts/verify-dd-b-mirror.ts (⑥段需 dev server 3000 存活)
// 修前失败/修后通过原则: ①④⑥ 在无镜像能力的引擎上必然失败(主域死=整体失败)
// ============================================================
export {}

// 根 tsconfig 不含 @types/bun(cc-d2 裁定: Bun 全局声明仅 mini-services 独立编译可用),
// 本脚本用 Bun.serve 起本地 mock 服务, 提供最小类型面(运行时由 bun 提供真实实现)
declare const Bun: {
  serve(options: { port: number; hostname: string; fetch: (req: Request) => Response | Promise<Response> }): {
    port: number
    stop(closeActiveConnections?: boolean): void
  }
}

import { fetchPage, mirrorGroupFor, rewriteMirrorHost, isMirrorSwitchableError } from '../src/lib/crawl/fetcher'
import { sanitizeFetchConfig } from '../src/lib/crawl/types'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- 端口分配: 死端口(确认连接拒绝) + 活端口(Bun.serve 绑定成功) ----------
async function findDeadPort(): Promise<number> {
  for (let i = 0; i < 30; i++) {
    const p = 41300 + Math.floor(Math.random() * 600)
    try {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 800)
      await fetch(`http://127.0.0.1:${p}/probe`, { signal: ac.signal })
      clearTimeout(t)
    } catch (e: any) {
      if (e?.name === 'AbortError') continue // 挂起(被占用?)换下一个
      return p // 连接拒绝 = 死端口
    }
  }
  throw new Error('找不到死端口')
}
function serve(port: number, handler: (req: Request, url: URL) => Response | Promise<Response>) {
  return Bun.serve({ port, hostname: '0.0.0.0', fetch: (req) => handler(req, new URL(req.url)) })
}

// ---------- mock 内容(>200 字符避免"极短内容判拦", 无挑战特征词) ----------
function page(tag: string, extra = ''): string {
  return `<html><head><title>Mock Mirror ${tag}</title></head><body><div id="main">MIRROR-CONTENT-${tag} ${extra}${' lorem-ipsum-mock-padding '.repeat(24)}</div></body></html>`
}

async function main() {
  // ---------- 纯函数单测(组解析/host 重写/可切换判定) ----------
  console.log('\n== ⓪ 纯函数单测(mirrorGroupFor/rewriteMirrorHost/isMirrorSwitchableError) ==')
  const g = mirrorGroupFor('http://APIBI.CC/api/chapter?id=1', { mirrorDomains: 'apibi.cc, apiqu.cc,apige.cc' })
  ok('⓪a 组=URL host+镜像条目(URL host 大小写归一)', JSON.stringify(g) === JSON.stringify(['apibi.cc', 'apiqu.cc', 'apige.cc']), JSON.stringify(g))
  const g2 = mirrorGroupFor('http://127.0.0.1:41111/x', { mirrorDomains: 'localhost:42222' })
  ok('⓪b 带:port 条目成组(127.0.0.1 与 localhost 为不同 host 串)', JSON.stringify(g2) === JSON.stringify(['127.0.0.1:41111', 'localhost:42222']), JSON.stringify(g2))
  ok('⓪c 未配置→空组(单 host 直通)', mirrorGroupFor('http://a.cc/x', {}).length === 0)
  ok('⓪d URL 不可解析→空组', mirrorGroupFor('notaurl', { mirrorDomains: 'a.cc' }).length === 0)
  const g3 = mirrorGroupFor('http://a.cc/x', { mirrorDomains: Array.from({ length: 12 }, (_, i) => `m${i}.cc`).join(',') })
  ok('⓪e 组大小上限(URL host+10 镜像)', g3.length === 11, `len=${g3.length}`)
  ok('⓪f host 重写保留 path/query/fragment', rewriteMirrorHost('https://apibi.cc/api/chapter?id=2530&chapterid=1#frag', 'apiqu.cc') === 'https://apiqu.cc/api/chapter?id=2530&chapterid=1#frag')
  ok('⓪g host 重写条目带端口连 port 一起换', rewriteMirrorHost('http://a.cc:8080/x?q=1', 'b.cc:9090') === 'http://b.cc:9090/x?q=1')
  ok('⓪h host 重写条目缺省端口保留原 port', rewriteMirrorHost('http://a.cc:8080/x', 'b.cc') === 'http://b.cc:8080/x')
  ok('⓪i 可切换: 403/5xx/无status(网络/超时) → true', isMirrorSwitchableError({ status: 403 }) && isMirrorSwitchableError({ status: 502 }) && isMirrorSwitchableError(new Error('ECONNREFUSED')) && isMirrorSwitchableError(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  ok('⓪j 不可切换: 404/3xx/其余4xx → false(404 换镜像无意义, 存档裁定)', !isMirrorSwitchableError({ status: 404 }) && !isMirrorSwitchableError({ status: 301 }) && !isMirrorSwitchableError({ status: 401 }) && !isMirrorSwitchableError({ status: 429 }))

  // ---------- 端口与服务 ----------
  const PORT_DEAD = await findDeadPort()
  const PORT_DEAD2 = await findDeadPort()
  const aliveHits: string[] = []
  const alive = serve(0, (req, url) => {
    aliveHits.push(url.pathname + (url.search || ''))
    if (url.pathname.startsWith('/chapter')) {
      // token 回显: 内容体携带收到的 token 查询参数(供 ④ 断言按镜像域重签)
      return new Response(page('TOKEN-ECHO', `token=${url.searchParams.get('token') ?? ''}`), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    return new Response(page('OK'), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })
  const PORT_ALIVE = alive.port

  // ---------- ⑤ sanitize 往返 ----------
  console.log('\n== ⑤ sanitizeFetchConfig 往返(钳长/逐条校验/去重/上限10/全非法丢弃) ==')
  const s1 = sanitizeFetchConfig({ mirrorDomains: 'ApiBi.cc, apibi.cc ,apiqu.cc, not a domain, http://evil.com, -bad, .foo, apige.cc' })
  ok('⑤a 逐条校验+大小写去重+非法丢弃', s1.mirrorDomains === 'apibi.cc,apiqu.cc,apige.cc', String(s1.mirrorDomains))
  const s2 = sanitizeFetchConfig({ mirrorDomains: Array.from({ length: 14 }, (_, i) => `d${i}.cc`).join(',') })
  ok('⑤b 上限 10 条', (s2.mirrorDomains || '').split(',').length === 10)
  const s3 = sanitizeFetchConfig({ mirrorDomains: 'http://x.com, not a domain, !!' })
  ok('⑤c 全非法整字段丢弃', s3.mirrorDomains === undefined, String(s3.mirrorDomains))
  const s4 = sanitizeFetchConfig({ mirrorDomains: 'localhost:3010' })
  ok('⑤d host:port 形态放行', s4.mirrorDomains === 'localhost:3010', String(s4.mirrorDomains))

  // ---------- ① 主域死 → 镜像接管 ----------
  console.log(`\n== ① 主域失败→镜像接管 (主=localhost:${PORT_DEAD} 死, 镜像=127.0.0.1:${PORT_ALIVE} 活) ==`)
  const r1 = await fetchPage(`http://localhost:${PORT_DEAD}/mirror-hello`, {
    engine: 'http', retries: 0, timeout: 5000,
    mirrorDomains: `127.0.0.1:${PORT_ALIVE}`,
  })
  ok('①a 镜像接管成功返回内容', r1.html.includes('MIRROR-CONTENT-OK'), `${r1.html.length}字节 engine=${r1.engine}`)
  ok('①b 内容正确且未被拦', r1.blocked === false && r1.html.includes('<title>Mock Mirror OK</title>'))
  const hits1 = aliveHits.length

  // ---------- ② mirrorDomains 为空 → 零行为变化 ----------
  console.log(`\n== ② 未配置镜像 → 零行为变化 (主=localhost:${PORT_DEAD} 死) ==`)
  let err2: any = null
  try {
    await fetchPage(`http://localhost:${PORT_DEAD}/no-mirror`, { engine: 'http', retries: 0, timeout: 5000 })
  } catch (e) { err2 = e }
  ok('②a 失败照旧抛出(Error)', err2 instanceof Error, String(err2?.message || err2).slice(0, 90))
  ok('②b 网络层错误语义(无 status, 连接拒绝形态)', (err2?.status ?? 0) === 0 && /connect|refused|ECONNREFUSED|send/i.test(String(err2?.message)), String(err2?.message || '').slice(0, 120))
  ok('②c 活服务零请求(无镜像尝试)', aliveHits.length === hits1, `aliveHits=${aliveHits.length}`)

  // ---------- ③ 全组死 → 错误语义与既有契约一致 ----------
  console.log(`\n== ③ 全组死 (主=localhost:${PORT_DEAD} + 镜像=127.0.0.1:${PORT_DEAD2} 均死) ==`)
  let err3: any = null
  try {
    await fetchPage(`http://localhost:${PORT_DEAD}/all-dead`, {
      engine: 'http', retries: 0, timeout: 5000,
      mirrorDomains: `127.0.0.1:${PORT_DEAD2}`,
    })
  } catch (e) { err3 = e }
  let errSingle: any = null
  try {
    await fetchPage(`http://127.0.0.1:${PORT_DEAD2}/single-host`, { engine: 'http', retries: 0, timeout: 5000 })
  } catch (e) { errSingle = e }
  ok('③a 全组死照旧抛出(Error)', err3 instanceof Error)
  ok('③b 错误语义与单 host 契约一致(同为无 status 连接拒绝形态)', (err3?.status ?? 0) === 0 && (errSingle?.status ?? 0) === 0 && /connect|refused|ECONNREFUSED|send/i.test(String(err3?.message)) && /connect|refused|ECONNREFUSED|send/i.test(String(errSingle?.message)), `${String(err3?.message || '').slice(0, 80)} | 单host: ${String(errSingle?.message || '').slice(0, 80)}`)
  ok('③c 活服务仍零请求(全死组未波及活服务)', aliveHits.length === hits1)

  // ---------- ④ token 钩子组合: 逐镜像各取各 token ----------
  console.log(`\n== ④ token 预取 {url} 占位符按镜像域重签 (token 服务 127.0.0.1:PORT_T) ==`)
  const tokenCalls: string[] = [] // 收到的 url 参数(解码后)
  const tokenSrv = serve(0, (_req, url) => {
    const target = decodeURIComponent(url.searchParams.get('url') || '')
    tokenCalls.push(target)
    const token = 'T' + Buffer.from(target).toString('base64url').slice(0, 18)
    return Response.json({ token })
  })
  const PORT_T = tokenSrv.port
  const targetUrl = `http://localhost:${PORT_DEAD}/chapter?id=77&chapterid=1`
  const r4 = await fetchPage(targetUrl, {
    engine: 'http', retries: 0, timeout: 5000,
    tokenUrl: `http://127.0.0.1:${PORT_T}/rewrite?url={url}`,
    tokenPattern: 'token',
    tokenInjection: 'url',
    mirrorDomains: `127.0.0.1:${PORT_ALIVE}`,
  })
  ok('④a 主域死→镜像接管取到内容', r4.html.includes('MIRROR-CONTENT-TOKEN-ECHO') && r4.blocked === false)
  ok('④b token 服务恰被调用 2 次(主域+镜像各一次)', tokenCalls.length === 2, JSON.stringify(tokenCalls.map((u) => u.slice(0, 60))))
  ok('④c 主域预取 {url}=localhost 主域 URL', tokenCalls[0]?.includes(`localhost:${PORT_DEAD}`), tokenCalls[0])
  ok('④d 镜像预取 {url}=重写后 127.0.0.1 镜像 URL', tokenCalls[1]?.includes(`127.0.0.1:${PORT_ALIVE}`), tokenCalls[1])
  const t1 = 'T' + Buffer.from(tokenCalls[0] || '').toString('base64url').slice(0, 18)
  const t2 = 'T' + Buffer.from(tokenCalls[1] || '').toString('base64url').slice(0, 18)
  ok('④e 两域 token 互不相同(按镜像域重签)', t1 !== t2, `${t1} vs ${t2}`)
  const m4 = r4.html.match(/token=([^ <]+)/)
  ok('④f 最终请求携带的是镜像域签发的 token', m4?.[1] === encodeURIComponent(t2), `body token=${m4?.[1]}`)
  tokenSrv.stop(true)

  // ---------- ⑥ dev server /api/admin/rules/test 往返 mirrorDomains(单源白名单实证) ----------
  console.log('\n== ⑥ 经 dev server /api/admin/rules/test 往返 mirrorDomains ==')
  const BASE = 'http://localhost:3000'
  const rule = { enabled: true, fields: { name: { type: 'css', expression: 'h1' } }, itemSelector: { type: 'css', expression: 'li' } }
  async function testList(withMirror: boolean) {
    return fetch(`${BASE}/api/admin/rules/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section: 'list',
        url: `http://localhost:${PORT_DEAD}/route-mirror`,
        rule,
        fetch: withMirror
          ? { engine: 'http', retries: 0, timeout: 5000, mirrorDomains: `127.0.0.1:${PORT_ALIVE}` }
          : { engine: 'http', retries: 0, timeout: 5000 },
        limit: 5,
      }),
    })
  }
  const res6a = await testList(true)
  const j6a = (await res6a.json()) as { ok: boolean; message?: string; data?: { engine?: string; count?: number } }
  ok('⑥a 测试路由 sanitize 白名单透传 mirrorDomains → 主域死镜像接管 200', res6a.status === 200 && j6a.ok === true, `HTTP ${res6a.status} engine=${j6a.data?.engine} count=${j6a.data?.count} ${j6a.message || ''}`)
  const res6b = await testList(false)
  const j6b = (await res6b.json()) as { ok: boolean; message?: string }
  ok('⑥b 对照组: 不带 mirrorDomains 同 URL → 502(镜像能力确由该字段驱动)', res6b.status === 502 && j6b.ok === false, `HTTP ${res6b.status} ${(j6b.message || '').slice(0, 80)}`)
  ok('⑥c 经路由的镜像请求确实到达活服务', aliveHits.some((h) => h.startsWith('/route-mirror')), JSON.stringify(aliveHits.slice(-3)))

  alive.stop(true)
  console.log(`\n========================================`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error('verify-dd-b-mirror 脚本异常:', (e as Error)?.message || e)
  process.exit(1)
})
