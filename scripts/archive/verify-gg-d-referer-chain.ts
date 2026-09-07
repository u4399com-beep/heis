export {}
// ============================================================
// Task gg-d 验证脚本① — ff-b② Referer 链在 runner 章节抓取路径的接线缺口
//
// 疑点(疑点3: runner 任务生命周期 × 新能力):
//   ff-b② 存档裁定(worklog ff-b): "runner.ts fetchCfg 构造处注入 refererUrl=bookUrl
//   —— 一处注入覆盖 tocLink 页/目录翻页(pageFetchGated)/章节请求全链路"。
//   但 runner.ts 章节批采集(gateFetch(taskId, q.url, buildFetch(rule, fetchOverride)))
//   用的是【不带 refererUrl】的 buildFetch 原面, 只有 toc 侧(tocFetchCfg/contentFetchCfg/
//   pageFetchGated)经 fetchCfg 注入 —— 即 refererChain:true 时:
//     toc 请求 Referer=bookUrl ✓ ; 章节(数量最多的请求面)Referer=站点 origin ✗
//   buildHeaders 回退分支(cfg.referer!==false → Referer=origin)接管, 链路语义断裂。
//
// 断言:
//   A1 书籍页 Referer=站点 origin(链锚前无来源, 基线)
//   A2 tocLink 目录页 Referer=bookUrl(ff-b② 注入路径, 修前后均应过)
//   A3 【核心】全部章节页 Referer=bookUrl(修前=origin, 必失败; 修后过)
// 注: 目录给足 6 章(≥5)避开 runner "目录<5 章疑似 AJAX → 浏览器重取书籍页"韧性分支,
//   保证请求面确定性(book×1 + toc×1 + 章节×6)
// 运行: bun scripts/verify-gg-d-referer-chain.ts (真实 TaskRunner + 真实 DB, 全回环, 结束清理)
// ============================================================
declare const Bun: {
  serve(opts: { port: number; hostname: string; fetch(req: Request): Response | Promise<Response> }): { stop(stopActive?: boolean): void }
}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- mock: 书籍页/目录页/3 章节页, 逐请求记录 Referer ----------------
const PORT = 3440
const BASE = `http://127.0.0.1:${PORT}`
const BOOK_URL = `${BASE}/book`
/** pathname → 该路径收到的全部 Referer 值(按到达序) */
const refererLog = new Map<string, string[]>()

function pad(n: number): string {
  return 'p'.repeat(n)
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    const u = new URL(req.url)
    const ref = req.headers.get('referer') || ''
    const arr = refererLog.get(u.pathname) || []
    arr.push(ref)
    refererLog.set(u.pathname, arr)
    const reply = (html: string) => new Response(html + pad(200), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    if (u.pathname === '/book') {
      return reply(`<html><head><title>Referer链验证书</title></head><body>
        <h1 id="name">Referer链验证书</h1><div id="author">gg-d测试作者</div>
        <div id="intro">用于验证 refererChain 在章节抓取路径接线的测试书。</div>
        <a id="toclink" href="/toc">章节目录</a></body></html>`)
    }
    if (u.pathname === '/toc') {
      const lis = Array.from({ length: 6 }, (_, i) => `<li><a href="/c${i + 1}">第${i + 1}章 Referer链测试</a></li>`).join('')
      return reply(`<html><head><title>目录页</title></head><body><ul id="toc">${lis}</ul></body></html>`)
    }
    const m = u.pathname.match(/^\/c(\d)$/)
    if (m) {
      return reply(`<html><head><title>第${m[1]}章</title></head><body>
        <div id="content">第${m[1]}章正文内容。${'链路验证占位文本。'.repeat(30)}</div></body></html>`)
    }
    return new Response('not found', { status: 404 })
  },
})
await new Promise((r) => setTimeout(r, 200))

// ---------------- 真实 TaskRunner + 真实 DB ----------------
const { db } = await import('../src/lib/db')
const { TaskRunner } = await import('../src/lib/crawl/runner')

const RULE_NAME = `ggd-referer链验证-${Date.now()}`
const ruleConfig = {
  list: { enabled: true, urlTemplate: '', fields: {} },
  book: {
    enabled: true,
    fields: {
      name: { type: 'css', expression: '#name', attr: 'text' },
      author: { type: 'css', expression: '#author', attr: 'text' },
      intro: { type: 'css', expression: '#intro', attr: 'html' },
      cover: { type: 'css', expression: '#nonexistent-cover', attr: 'src' },
    },
    tocLink: { type: 'css', expression: '#toclink', attr: 'href' },
  },
  toc: {
    enabled: true,
    itemSelector: { type: 'css', expression: 'ul#toc > li' },
    fields: {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: { content: { type: 'css', expression: '#content', attr: 'html' } },
    pagination: { enabled: false, maxPages: 1 },
  },
  // ff-b② 开关: refererChain=true → 目录/章节请求应携带 refererUrl=bookUrl
  fetch: { engine: 'http', uaMode: 'rotate', timeout: 5000, retries: 0, hostGateLimit: 3, autoCookie: true, refererChain: true },
  clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: true },
}

let ruleId = ''
let taskId = ''
let bookId = ''

async function waitTaskDone(timeoutMs: number): Promise<string> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const t = await db.task.findUnique({ where: { id: taskId } })
    if (t && t.status !== 'running' && t.status !== 'pending') return t.status
    await sleep(500)
  }
  return 'timeout'
}

try {
  const rule = await db.rule.create({ data: { name: RULE_NAME, description: 'gg-d referer 链接线验证用', config: JSON.stringify(ruleConfig), enabled: true } })
  ruleId = rule.id
  const task = await db.task.create({
    data: {
      name: 'ggd-referer链验证任务',
      ruleId, mode: 'single', bookUrl: BOOK_URL,
      recrawlMode: 'incremental', storageMode: 'db',
      threadMin: 1, threadMax: 1, intervalMin: 50, intervalMax: 100,
      smartCategory: false, smartComplete: false, autoSuggest: false,
      status: 'pending',
    },
  })
  taskId = task.id

  console.log('\n== 场景: refererChain=true 单本 3 章, 观测 mock 端各路径实收 Referer ==')
  const start = await TaskRunner.instance.control(taskId, 'start')
  ok('任务启动成功', start.ok, start.message)
  const st = await waitTaskDone(60_000)
  ok('任务正常结束', st === 'done', `status=${st}`)

  const bk = await db.book.findFirst({ where: { sourceUrl: BOOK_URL } })
  bookId = bk?.id || ''
  const chs = bookId ? await db.chapter.findMany({ where: { bookId }, orderBy: { idx: 'asc' } }) : []
  ok('6 章全部采集入库', chs.length === 6 && chs.every((c) => c.fetched), chs.map((c) => `${c.title}:${c.fetched}`).join(','))

  const origin = BASE
  const refsOf = (p: string) => refererLog.get(p) || []
  // A1 书籍页: 无链锚(注入发生在目录之后), Referer=origin 回退
  const bookRefs = refsOf('/book')
  ok('A1 书籍页 Referer=站点 origin(基线)', bookRefs.length === 1 && bookRefs[0] === origin, `got=${JSON.stringify(bookRefs)}`)
  // A2 tocLink 目录页: fetchCfg 注入路径(修前后均应过)
  const tocRefs = refsOf('/toc')
  ok('A2 目录页(tocLink) Referer=bookUrl', tocRefs.length === 1 && tocRefs[0] === BOOK_URL, `got=${JSON.stringify(tocRefs)}`)
  // A3【核心】章节页: ff-b② 存档口径"章节请求全链路"应携带 bookUrl
  const chRefs = Array.from({ length: 6 }, (_, i) => refsOf(`/c${i + 1}`)).flat()
  ok('A3a 六章请求全部到达(每章恰 1 次)', chRefs.length === 6, `count=${chRefs.length}`)
  ok('A3b【核心】章节页 Referer=bookUrl(链路贯穿)', chRefs.length === 6 && chRefs.every((r) => r === BOOK_URL), `got=${JSON.stringify(chRefs)}`)
  if (chRefs.length === 6 && !chRefs.every((r) => r === BOOK_URL)) {
    console.log(`  ↳ 修前形态实证: 章节请求 Referer 回退站点 origin(${origin}), ff-b② "章节请求全链路"接线缺口`)
  }

  // 无多余请求(目录≥5 章未触发浏览器重取; 无重试/无翻页噪声)
  const total = Array.from(refererLog.values()).reduce((n, a) => n + a.length, 0)
  ok('请求面恰 8 次(book+toc+6章, 无重试/浏览器重取噪声)', total === 8, `total=${total}`)
} catch (e: any) {
  fail++
  console.log(`  ✗ 脚本异常: ${e?.stack?.slice(0, 500) || e}`)
} finally {
  try {
    if (taskId) await db.taskLog.deleteMany({ where: { taskId } })
    if (taskId) await db.task.delete({ where: { id: taskId } }).catch(() => {})
    if (bookId) await db.book.delete({ where: { id: bookId } }).catch(() => {})
    if (ruleId) await db.rule.delete({ where: { id: ruleId } }).catch(() => {})
    console.log('\n清理完成: 任务/日志/书籍/章节/规则已删除还原')
  } catch (e: any) {
    console.log('清理异常:', e?.message)
  }
  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
  process.exit(fail ? 1 : 0)
}
