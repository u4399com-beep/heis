// ============================================================
// Task aa-d 验证脚本 — 引擎增强重放 + 英文状态词
// A1: fetchHttp 多跳重定向逐跳 Set-Cookie 归属/转发/跳数上限/跨scheme策略
// A2: 200+CF壳拦截(http blocked / auto 切 browser) + 403+SetCookie 挑战重试链路
// B : smartCompleteDetect 英文状态词(大小写不敏感)
// C1: cleaner removeAdLines URL 保护例外
// C2: parseList 空 url 书籍项跳过(parseBook(['cover']) 不受影响)
// 末尾: 真站 www.biquge.tw 首页实测
// 运行: bun scripts/verify-aa-d.ts
// ============================================================
import http from 'http'
import https from 'https'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n== ${title} ==`)
  try { await fn() } catch (e: any) { fail++; console.log(`  ✗ 段落异常: ${e?.message?.slice(0, 200)}`) }
}

// ---------------- 本地多跳测试服务 ----------------
// 域模拟: localhost(P1) 与 127.0.0.1(P1) 视为两个不同 host, 验证 Cookie 域键归属
const hits: { url: string; cookie: string }[] = []
const P1 = 3321
const P2 = 3322
const base1 = `http://localhost:${P1}`
const base1b = `http://127.0.0.1:${P1}`
const base2 = `http://127.0.0.1:${P2}`

function makeServer() {
  return http.createServer((req, res) => {
    const host = req.headers.host || ''
    hits.push({ url: host + (req.url || '/'), cookie: req.headers.cookie || '' })
    const p = (req.url || '/').split('?')[0]
    if (host.startsWith('localhost')) {
      if (p === '/chain') { res.writeHead(302, { Location: '/mid', 'Set-Cookie': ['hopA=a1; Path=/'] }); return res.end('hopA') }
      if (p === '/mid') { res.writeHead(301, { Location: `${base1b}/mid2`, 'Set-Cookie': ['hopB=b1; Path=/'] }); return res.end('hopB') }
    }
    // 同一服务双 host: localhost 与 127.0.0.1 视为两个"域"(Cookie 罐按 origin 分键)
    if (p === '/mid2') { res.writeHead(302, { Location: '/final2', 'Set-Cookie': ['hopC=c1; Path=/'] }); return res.end('hopC') }
    if (p === '/final2') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<html><head><title>final</title></head><body>FINAL-BODY cookie=' + (req.headers.cookie || '') + '</body></html>')
    }
      if (p === '/loop') { res.writeHead(302, { Location: '/loop' }); return res.end('loop') }
      if (p === '/shell') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end('<html><head><title>Just a moment...</title></head><body>cf-chl challenge attention required</body></html>')
      }
      if (p === '/gate') {
        // 首访 403+Set-Cookie, 带 cookie 复访 200(guichuideng 挑战重试链路)
        if ((req.headers.cookie || '').includes('pass=t')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          return res.end('<html><head><title>正文页</title></head><body><div id="c">' + '正文'.repeat(200) + '</div></body></html>')
        }
        res.writeHead(403, { 'Set-Cookie': ['pass=t; Path=/'] })
        return res.end('denied')
      }
    if (p === '/down-target') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end('SHOULD-NOT-REACH')
    }
    res.writeHead(404); res.end('nf')
  })
}

const srv1 = makeServer()
const srv2 = makeServer()
await new Promise<void>((r) => srv1.listen(P1, () => r()))
await new Promise<void>((r) => srv2.listen(P2, () => r()))

const { fetchPage, cookieJar, UA_POOL } = await import('../src/lib/crawl/fetcher')
const { smartCompleteDetect } = await import('../src/lib/crawl/smart')
const { cleanContentHtml, cleanIntro } = await import('../src/lib/crawl/cleaner')
const { parseList, parseBook } = await import('../src/lib/crawl/parser')

// ============================================================
await section('A1: fetchHttp 多跳重定向逐跳 Set-Cookie(3跳/跨host/相对Location)', async () => {
  hits.length = 0
  const r = await fetchPage(`${base1}/chain`, { engine: 'http', timeout: 8000, retries: 0, autoCookie: true })
  ok('最终响应 200 body 到达', r.html.includes('FINAL-BODY'), `engine=${r.engine}`)
  ok('跳数正确(3跳+最终页=4次命中)', hits.length === 4, `hits=${JSON.stringify(hits.map((h) => h.url))}`)
  const c1 = cookieJar.get(base1)
  const c3 = cookieJar.get(base1b)
  ok('第1/2跳 Cookie 归属 localhost 域键(hopA/hopB)', c1.includes('hopA=a1') && c1.includes('hopB=b1'), c1)
  ok('第3跳 Cookie 归属 127.0.0.1:3321 域键(hopC, 随响应域不随目标域)', c3.includes('hopC=c1'), c3)
  ok('最终页请求带上了同域前跳种下的 Cookie(hopC)', hits[3]?.cookie.includes('hopC=c1'), hits[3]?.cookie)
  ok('跨 host 跳未串味(localhost 域键不含 hopC)', !c1.includes('hopC'), c1)
  ok('相对 Location(/mid、/final2)已按当前跳解析', hits.some((h) => h.url.includes('/mid')) && hits.some((h) => h.url.includes('/final2')))
})

await section('A1: 重定向环 20 跳上限', async () => {
  let msg = ''
  try { await fetchPage(`${base1}/loop`, { engine: 'http', timeout: 8000, retries: 0 }) } catch (e: any) { msg = String(e?.message || e) }
  // 注: fetchHttp 自循环超限抛错后, 双传输封装会再落 curl 兜底一次(curl max-redirs=5 也拦截),
  // 最终抛 curl 的错误 —— 与旧 redirect:'follow' 的 undici 超限→落 curl 行为同构, 仅断言最终有错
  ok('重定向环最终被拦截(20跳上限/curl兜底皆拦)', msg.includes('跳上限') || /redirection|max.*redirect/i.test(msg), msg.slice(0, 90))
})

// https 自签证书环境(跨 scheme 升级/降级用): openssl 生成临时证书
let httpsUsable = false
let HTTPS_PORT = 3323
try {
  const dir = mkdtempSync(join(tmpdir(), 'aa-d-cert-'))
  const key = join(dir, 'k.pem')
  const crt = join(dir, 'c.pem')
  execSync(`openssl req -x509 -newkey rsa:2048 -keyout ${key} -out ${crt} -days 1 -nodes -subj "/CN=127.0.0.1" 2>/dev/null`)
  const { readFileSync } = await import('node:fs')
  const tls = { key: readFileSync(key), cert: readFileSync(crt) }
  const srvH = https.createServer(tls, (req: any, res: any) => {
    const p = (req.url || '/').split('?')[0]
    hits.push({ url: 'https' + (req.url || '/'), cookie: req.headers.cookie || '' })
    if (p === '/up') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('HTTPS-UP-BODY') }
    if (p === '/down') { res.writeHead(302, { Location: `http://127.0.0.1:${P2}/down-target` }); return res.end('down-hop') }
    res.writeHead(404); res.end()
  })
  await new Promise<void>((r) => srvH.listen(HTTPS_PORT, () => r()))
  httpsUsable = true
  ;(globalThis as any).__srvH = srvH
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
} catch (e: any) {
  console.log(`  (跳过 https 跨scheme用例: ${String(e?.message).slice(0, 80)})`)
}

if (httpsUsable) {
  await section('A1: 跨 scheme — https→http 降级拒绝', async () => {
    let msg = ''
    try { await fetchPage(`https://127.0.0.1:${HTTPS_PORT}/down`, { engine: 'http', timeout: 8000, retries: 0 }) } catch (e: any) { msg = String(e?.message || e) }
    ok('降级重定向被拒绝', msg.includes('跨 scheme 被拒绝'), msg.slice(0, 100))
    ok('降级目标未被请求', !hits.some((h) => h.url.includes('/down-target')))
  })
  await section('A1: 跨 scheme — http→https 升级放行', async () => {
    // 用 P2(http) 起 302 → https 127.0.0.1:/up
    const srvU = http.createServer((req, res) => {
      res.writeHead(302, { Location: `https://127.0.0.1:${HTTPS_PORT}/up` })
      res.end('up-hop')
    })
    await new Promise<void>((r) => srvU.listen(3324, () => r()))
    const rU = await fetchPage('http://127.0.0.1:3324/up2', { engine: 'http', timeout: 8000, retries: 0 })
    ok('http→https 升级链路可达最终页', rU.html.includes('HTTPS-UP-BODY'), rU.html.slice(0, 40))
    srvU.close()
  })
}

// ============================================================
await section('A2: 空壳页拦截 — 200+CF壳(http引擎 blocked / auto引擎切browser)', async () => {
  const r1 = await fetchPage(`${base1}/shell`, { engine: 'http', timeout: 8000, retries: 0 })
  ok('http 引擎: 返回 blocked=true', r1.engine === 'http' && r1.blocked === true, `engine=${r1.engine} blocked=${r1.blocked}`)
  const r2 = await fetchPage(`${base1}/shell`, { engine: 'auto', timeout: 15000, retries: 0 })
  ok('auto 引擎: 判定失败切 browser(不再把壳当内容)', r2.engine === 'browser' && r2.blocked === true, `engine=${r2.engine} blocked=${r2.blocked}`)
})

await section('A2: 403+Set-Cookie 挑战重试链路(autoCookie 回归)', async () => {
  hits.length = 0
  const r = await fetchPage(`${base1}/gate`, { engine: 'auto', timeout: 15000, retries: 0 })
  ok('带新 Cookie 重发后拿到 200 正文', r.html.includes('正文页') && r.blocked === false, `blocked=${r.blocked}`)
  ok('命中次数=2(首访403+复访200, 未升级浏览器)', hits.length === 2, `hits=${hits.length}`)
})

// ============================================================
await section('B: 英文状态词(大小写不敏感)', async () => {
  const d = (s: string) => smartCompleteDetect({ statusField: s }).status
  ok('"Ongoing" → ongoing', d('Ongoing') === 'ongoing')
  ok('"ONGOING" → ongoing', d('ONGOING') === 'ongoing')
  ok('"On Going" → ongoing', d('On Going') === 'ongoing')
  ok('"Serializing" → ongoing', d('Serializing') === 'ongoing')
  ok('"Updating" → ongoing', d('Updating') === 'ongoing')
  ok('"连载中" → ongoing', d('连载中') === 'ongoing')
  ok('"Completed" → completed', d('Completed') === 'completed')
  ok('"Complete" → completed', d('Complete') === 'completed')
  ok('"Finished" → completed', d('Finished') === 'completed')
  ok('"完本" → completed', d('完本') === 'completed')
  ok('"完结" → completed', d('完结') === 'completed')
  ok('"Hiatus"(系统无暂停态) → ongoing', d('Hiatus') === 'ongoing')
  ok('"Paused"(系统无暂停态) → ongoing', d('Paused') === 'ongoing')
  ok('"Unfinished" 不被 finished 子串误判 → ongoing', d('Unfinished') === 'ongoing')
  ok('"Incomplete" 不被 complete 子串误判 → ongoing', d('Incomplete') === 'ongoing')
  ok('"热门小说" 无词命中 → unknown', d('热门小说') === 'unknown')
  ok('中文完结词优先级: "未完结" → ongoing', d('未完结') === 'ongoing')
})

// ============================================================
await section('C1: cleaner URL 保护例外', async () => {
  const cfg = { adPatterns: ['(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?'] }
  const h1 = cleanContentHtml('<p>访问https://example.com/book看正文</p>', cfg)
  ok('正文句子保留完整 URL(HTML模式)', h1.includes('https://example.com/book看正文'), h1.slice(0, 120))
  const h2 = cleanContentHtml('<p>纯文本串: https://example.net/x1 (含括号)</p>', cfg)
  ok('括号上下文 URL 保留', h2.includes('https://example.net/x1'), h2.slice(0, 120))
  const h3 = cleanContentHtml('<p>推广 www.spam-ads.com 点击即读</p>', cfg)
  ok('裸域名广告照常剥除(不放宽原清洗力)', !h3.includes('spam-ads.com'), h3.slice(0, 120))
  const h4 = cleanContentHtml('<p><a href="https://example.com/book">正文入口</a></p>', { ...cfg, whitelist: ['p', 'a', 'br'] })
  ok('<a href> 属性不被啃坏', h4.includes('href="https://example.com/book"'), h4.slice(0, 160))
  const h5 = cleanContentHtml('<p>本章未完 https://t.io/a 点击下一页继续阅读</p>', { ...cfg, adPatterns: [...cfg.adPatterns, '本章未完.*?点击下一页继续阅读'] })
  ok('广告句整体剥除时跨占位符匹配不残留控制字符', !h5.includes('\u0000'), JSON.stringify(h5.slice(0, 80)))
  const t1 = cleanIntro('访问https://example.com/book看正文 更多 www.x-sponsor.net 推荐')
  ok('cleanIntro: scheme URL 保留+裸域名剥除并存', t1.includes('https://example.com/book看正文') && !t1.includes('x-sponsor.net'), t1)
})

// ============================================================
await section('C2: parseList 空url书籍项跳过', async () => {
  const listRule = {
    enabled: true,
    itemSelector: { type: 'css' as const, expression: 'li.novel' },
    fields: {
      name: { type: 'css' as const, expression: 'h3', attr: 'text' },
      url: { type: 'css' as const, expression: 'a', attr: 'href' },
    },
  }
  const html = `<ul>
<li class="novel"><h3>有链接的书</h3><a href="/book/1">查看</a></li>
<li class="novel"><h3>无链接的垃圾项</h3><span>仅文字无锚点</span></li>
</ul>`
  const res = parseList(html, 'http://x.com/list', listRule)
  ok('有 url 的项保留', res.items.length === 1 && res.items[0].fields.url === 'http://x.com/book/1', JSON.stringify(res.items))
  // bookUrl 双字段语义(runner 用法): 只有 bookUrl 也算有效
  const res2 = parseList('<li class="novel"><h3>乙</h3><a class="bk" href="/b/2">go</a></li>', 'http://x.com/', {
    ...listRule, fields: { name: { type: 'css', expression: 'h3', attr: 'text' }, bookUrl: { type: 'css', expression: 'a.bk', attr: 'href' } },
  }, ['url', 'bookUrl'])
  ok('bookUrl 单字段非空也保留', res2.items.length === 1, JSON.stringify(res2.items))
  // parseBook 借道(['cover'])不受限: 无 cover 但 name 有值仍可出书
  const book = parseBook('<div class="i"><h1>书名甲</h1></div>', 'http://x.com/b1', {
    enabled: true, itemSelector: { type: 'css', expression: 'div.i' },
    fields: { name: { type: 'css', expression: 'h1', attr: 'text' }, cover: { type: 'css', expression: 'img', attr: 'src' } },
  })
  ok("parseBook(['cover']) 无封面不出空项回归", book.name === '书名甲', JSON.stringify(book))
})

// ============================================================
await section('C3: UA 池版本段', async () => {
  const chromeMajors = UA_POOL.map((u) => (u.match(/Chrome\/(\d+)\./) || [])[1]).filter(Boolean).map(Number)
  ok('全部 Chrome 条目 ≥137', chromeMajors.every((v) => v >= 137), `min=${Math.min(...chromeMajors)} max=${Math.max(...chromeMajors)} n=${chromeMajors.length}`)
  const edge = UA_POOL.filter((u) => /Edg\//.test(u)).map((u) => [(u.match(/Chrome\/(\d+)\./) || [])[1], (u.match(/Edg\/(\d+)\./) || [])[1]])
  ok('Edge 与 Chromium 主版本号一一配对', edge.length > 0 && edge.every(([c, e]) => c === e), JSON.stringify(edge))
})

// ============================================================
await section('真站实测: www.biquge.tw 首页', async () => {
  try {
    const t0 = Date.now()
    const r = await fetchPage('https://www.biquge.tw/', { engine: 'http', timeout: 15000, retries: 0 })
    ok('HTTP 引擎直连 200 非拦截', r.engine === 'http' && !r.blocked && r.html.length > 1000, `${r.html.length}B ${Date.now() - t0}ms blocked=${r.blocked}`)
  } catch (e: any) {
    // TLS 指纹封锁站点会落 curl, 再失败才报错 —— 如实记录
    ok('真站抓取(curl 兜底链路)', false, String(e?.message || e).slice(0, 120))
  }
})

srv1.close()
srv2.close()
;(globalThis as any).__srvH?.close?.()
console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

export {}
