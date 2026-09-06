// ============================================================
// Task bb-d 验证脚本1 — parser 内翻页过闸(FetchConfig.pageFetch 注入)
// A: 6 并发 parseToc(多页目录, 翻页3跳) 注入过闸回调 → 服务端实测并发峰值 ≤ hostGateLimit(2)
//    且计账归零(inFlight/waiting 双 0)、目录 40 章 4 页完整合并
// B: 同场景不注入回调 → 直连 fetchPage 不过闸(峰值>2), 证明 rules/test 路由直连语义未变
// C: parseContent 翻页同样吃到注入回调(3页正文合并) + 不注入直连语义不变
// D: sanitize 白名单行为 — pageFetch 运行时注入项被 sanitize 丢弃(无 JSON 注入面),
//    token 钩子字段(tokenUrl/tokenPattern/tokenInjection/tokenHeaderName)进白名单
// 运行: bun scripts/verify-bb-d-1.ts
// ============================================================
import http from 'http'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n== ${title} ==`)
  try { await fn() } catch (e: any) { fail++; console.log(`  ✗ 段落异常: ${e?.message?.slice(0, 300)}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- mock: 多页目录站(同 host, 服务端实测并发) ----------------
const PORT = 3341
const BASE = `http://127.0.0.1:${PORT}`
const TOC_PAGES = 4 // 目录共4页, 每页10章
const stat = { cur: 0, peak: 0, total: 0 }

const server = http.createServer((req, res) => {
  stat.cur++
  stat.peak = Math.max(stat.peak, stat.cur)
  stat.total++
  const u = new URL(req.url || '/', BASE)
  setTimeout(() => {
    stat.cur--
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    if (u.pathname === '/toc') {
      const p = Number(u.searchParams.get('p') || '1')
      let html = `<html><head><title>目录第${p}页</title></head><body><ul id="toc">`
      for (let i = 1; i <= 10; i++) {
        const n = (p - 1) * 10 + i
        html += `<li class="ch"><a href="/c${n}">第${n}章 测试</a></li>`
      }
      if (p < TOC_PAGES) html += `<a id="next" href="/toc?p=${p + 1}">下一页</a>`
      html += '</ul></body></html>'
      res.end(html)
      return
    }
    if (u.pathname.startsWith('/content')) {
      const p = Number(u.searchParams.get('p') || '1')
      let html = `<html><head><title>正文第${p}页</title></head><body>`
      html += `<div id="content">${'本页正文段落内容。'.repeat(60)}(第${p}页尾标记)</div>`
      if (p < 3) html += `<a id="next" href="/content?p=${p + 1}">下一页</a>`
      html += '</body></html>'
      res.end(html)
      return
    }
    res.end('<html><body>index</body></html>')
  }, 60)
})
await new Promise<void>((r) => server.listen(PORT, () => r()))

const { parseToc, parseContent } = await import('../src/lib/crawl/parser')
const { acquireHostGate, releaseHostGate, hostGateSnapshot, hostGateReset } = await import('../src/lib/crawl/hostgate')
const { fetchPage } = await import('../src/lib/crawl/fetcher')
const { sanitizeFetchConfig } = await import('../src/lib/crawl/types')

/** 与 runner.gateFetch 同构的过闸回调(acquire → fetchPage → finally release) */
async function gatedPageFetch(url: string): Promise<{ html: string }> {
  const ticket = await acquireHostGate(url, { limit: 2 })
  try {
    const res = await fetchPage(url, { engine: 'http', timeout: 8000, retries: 0, hostGateLimit: 2 })
    return { html: res.html }
  } finally {
    releaseHostGate(ticket)
  }
}

const tocRule = {
  enabled: true,
  itemSelector: { type: 'css' as const, expression: 'li.ch' },
  fields: {
    title: { type: 'css' as const, expression: 'a', attr: 'text' },
    url: { type: 'css' as const, expression: 'a', attr: 'href' },
  },
  pagination: { enabled: true, maxPages: 10, nextLink: { type: 'css' as const, expression: '#next', attr: 'href' } },
}

await section('A: 6 并发 parseToc 翻页过闸 — 服务端峰值 ≤ limit(2) 且计账归零', async () => {
  hostGateReset()
  stat.peak = 0; stat.total = 0
  const firstHtml = await (await fetch(`${BASE}/toc?p=1`)).text()
  const results = await Promise.all(
    Array.from({ length: 6 }, () => parseToc(`${BASE}/toc?p=1`, firstHtml, tocRule as any, { pageFetch: gatedPageFetch } as any))
  )
  ok('6 个目录全部解析成功(4页×10章=40章/目录)', results.every((r) => r.items.length === 40), results.map((r) => r.items.length).join(','))
  ok('翻页页数=4', results.every((r) => r.pages === 4), results.map((r) => r.pages).join(','))
  ok('章节跨页连续无丢(首章第1章/末章第40章)', results[0].items[0].title.includes('第1章') && results[0].items[39].title.includes('第40章'))
  ok('服务端实测并发峰值 ≤ 2(hostGateLimit)', stat.peak <= 2, `peak=${stat.peak} total=${stat.total}`)
  ok('并发真实发生(峰值=2, 闸门未退化串行)', stat.peak === 2, `peak=${stat.peak}`)
  const snap = hostGateSnapshot(`${BASE}/toc?p=1`)
  ok('结束后计账归零(inFlight=0/waiting=0, 无槽位泄漏)', !!snap && snap.inFlight === 0 && snap.waiting === 0, JSON.stringify(snap))
})

await section('B: 同场景不注入回调 — 直连 fetchPage 不过闸(test 路由直连语义保持)', async () => {
  hostGateReset()
  stat.peak = 0; stat.total = 0
  const firstHtml = await (await fetch(`${BASE}/toc?p=1`)).text()
  const results = await Promise.all(
    Array.from({ length: 6 }, () => parseToc(`${BASE}/toc?p=1`, firstHtml, tocRule as any, { engine: 'http', timeout: 8000, retries: 0 } as any))
  )
  ok('6 个目录全部解析成功(功能不受影响)', results.every((r) => r.items.length === 40), results.map((r) => r.items.length).join(','))
  ok('服务端峰值 > 2(未过闸, 并发不被 hostGate 压制)', stat.peak > 2, `peak=${stat.peak}`)
  ok('默认路径无 hostGate 账本产生', hostGateSnapshot(`${BASE}/toc?p=1`) === null)
})

await section('C: parseContent 翻页 — 注入回调过闸合并 + 直连语义', async () => {
  hostGateReset()
  stat.peak = 0; stat.total = 0
  const contentRule = {
    enabled: true,
    fields: { content: { type: 'css' as const, expression: '#content' } },
    pagination: { enabled: true, maxPages: 10, joinWith: '<br/>', nextLink: { type: 'css' as const, expression: '#next', attr: 'href' } },
  }
  const firstHtml = await (await fetch(`${BASE}/content?p=1`)).text()
  // 注入: 3 个并发 parseContent, 翻页2跳/个, 峰值≤2
  const gated = await Promise.all(
    Array.from({ length: 3 }, () => parseContent(`${BASE}/content?p=1`, firstHtml, contentRule as any, { pageFetch: gatedPageFetch } as any))
  )
  ok('注入路径: 3 个正文全部 3 页合并完成', gated.every((r) => r.pages === 3 && r.content.includes('(第3页尾标记)')), gated.map((r) => `pages=${r.pages}`).join(','))
  ok('注入路径: 服务端峰值 ≤ 2', stat.peak <= 2, `peak=${stat.peak}`)
  const snapG = hostGateSnapshot(`${BASE}/content?p=1`)
  ok('注入路径: 计账归零', !!snapG && snapG.inFlight === 0 && snapG.waiting === 0, JSON.stringify(snapG))
  // 直连: 不注入 → 不过闸, 峰值>2
  hostGateReset()
  stat.peak = 0; stat.total = 0
  const direct = await Promise.all(
    Array.from({ length: 3 }, () => parseContent(`${BASE}/content?p=1`, firstHtml, contentRule as any, { engine: 'http', timeout: 8000, retries: 0 } as any))
  )
  ok('直连路径: 3 个正文全部 3 页合并完成(功能不受影响)', direct.every((r) => r.pages === 3), direct.map((r) => `pages=${r.pages}`).join(','))
  ok('直连路径: 峰值 > 2(不过闸语义保持)', stat.peak > 2, `peak=${stat.peak}`)
  ok('直连路径: 无账本产生', hostGateSnapshot(`${BASE}/content?p=1`) === null)
})

await section('D: sanitize 白名单行为 — pageFetch 丢弃 / token 钩子字段透传', async () => {
  const fn = async () => ({ html: '' })
  const s = sanitizeFetchConfig({
    pageFetch: fn,
    tokenUrl: 'https://x.example/api/tk',
    tokenPattern: 'data.token',
    tokenInjection: 'header',
    tokenHeaderName: 'X-Api-Token',
  } as any)
  ok('pageFetch 被 sanitize 丢弃(运行时注入项不进白名单, 无 JSON 注入面)', s.pageFetch === undefined)
  ok('tokenUrl 进白名单', s.tokenUrl === 'https://x.example/api/tk')
  ok('tokenPattern 进白名单', s.tokenPattern === 'data.token')
  ok('tokenInjection 枚举白名单(header)', s.tokenInjection === 'header')
  ok('tokenHeaderName 进白名单', s.tokenHeaderName === 'X-Api-Token')
  ok('tokenInjection 非法值丢弃', sanitizeFetchConfig({ tokenInjection: 'cookie' } as any).tokenInjection === undefined)
  ok('tokenUrl 非字符串丢弃', sanitizeFetchConfig({ tokenUrl: 123 } as any).tokenUrl === undefined)
  // 运行时注入路径(模拟 runner buildFetch 后挂回调): 函数保留可传到 parser
  const runtime = { ...sanitizeFetchConfig({ tokenUrl: 'x' }), pageFetch: fn } as any
  ok('运行时挂载 pageFetch 后函数保留(类型为 function)', typeof runtime.pageFetch === 'function')
})

server.close()
console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

export {}
