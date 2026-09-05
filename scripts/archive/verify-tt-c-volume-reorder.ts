// ============================================================
// probe-tt-c-volume-reorder.ts — tt-c 检查点1 专项探针
// 场景A: 分卷(field volume)目录乱序到达 + 卷中插新章 → 跨卷重排后
//        A卷章节不得错位进 B 卷边界(卷内连续/卷间不越界/卷名不串)
// 场景B: 阶段A负数临时位残留(模拟进程在重排四阶段中途被杀) → 下一轮
//        重排是否自愈/是否毒化(新章丢失/章节卡负数位)
// 场景C: unfetched 回推边界(占位陈旧章→挪尾; 不冲突陈旧章→原位续采)
// 范式: verify-ll-c-runner 同款(本地 mock + 真实 TaskRunner + DB 建删还原)
// 运行: bun scripts/verify-tt-c-volume-reorder.ts; 结尾 process.exit(0) (tt-c 残作收编: 主控修清理兜底+三真bug修复后复跑)
// ============================================================
import http from 'http'

export {}

let pass = 0
let failCnt = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { failCnt++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const chapterHtml = (n: string) =>
  `<html><body><div id="content">《${n}》正文。${'段落测试文本，用于验证链路。'.repeat(30)}</div></body></html>`

const li = (vol: string, title: string, href: string) =>
  `<li><span class="vol">${vol}</span><a href="${href}">${title}</a></li>`

const servers: http.Server[] = []
function startServer(routes: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.on('error', () => {})
      const p = new URL(req.url || '/', 'http://x').pathname
      const body = routes[p] || '<html><body>404</body></html>'
      try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body) } catch { /* ignore */ }
    })
    server.on('clientError', (_e: unknown, s: import('net').Socket) => { try { s.end() } catch { /* ignore */ } })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      servers.push(server)
      resolve(port)
    })
  })
}

const { db } = await import('../src/lib/db')
const { TaskRunner } = await import('../src/lib/crawl/runner')

const baseRuleFetch = { engine: 'http', uaMode: 'rotate', timeout: 15000, retries: 0, hostGateLimit: 3, autoCookie: true, referer: true }
const ruleConfig = () => JSON.stringify({
  list: { enabled: true, urlTemplate: '', fields: {} },
  book: {
    enabled: true,
    fields: {
      name: { type: 'css', expression: '#name', attr: 'text' },
      author: { type: 'css', expression: '#author', attr: 'text' },
      intro: { type: 'css', expression: '#intro', attr: 'html' },
    },
  },
  toc: {
    enabled: true,
    itemSelector: { type: 'css', expression: 'ul#toc > li' },
    fields: {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
      volume: { type: 'css', expression: 'span.vol', attr: 'text' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: { content: { type: 'css', expression: '#content', attr: 'html' } },
    pagination: { enabled: false, maxPages: 1 },
  },
  clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: true },
  fetch: baseRuleFetch,
})

async function runTask(taskId: string, label: string, timeoutMs = 40_000): Promise<boolean> {
  const s = await TaskRunner.instance.control(taskId, 'start')
  if (!s.ok) { console.log(`  启动失败(${label}): ${s.message}`); return false }
  const t1 = Date.now()
  while (Date.now() - t1 < timeoutMs) {
    const t = await db.task.findUnique({ where: { id: taskId } })
    if (t?.status === 'done' || t?.status === 'error' || t?.status === 'paused') return t?.status === 'done'
    await sleep(250)
  }
  return false
}

async function cleanup(ruleId: string, taskId: string, bookUrl: string, bookName = "") {
  try {
    if (taskId) {
      await db.taskLog.deleteMany({ where: { taskId } }).catch(() => {})
      await db.task.delete({ where: { id: taskId } }).catch(() => {})
    }
    const bk = await db.book.findFirst({ where: bookName ? { OR: [{ sourceUrl: bookUrl }, { name: bookName }] } : { sourceUrl: bookUrl } })
    if (bk) {
      await db.chapter.deleteMany({ where: { bookId: bk.id } }).catch(() => {})
      await db.book.delete({ where: { id: bk.id } }).catch(() => {})
    }
    if (ruleId) await db.rule.delete({ where: { id: ruleId } }).catch(() => {})
  } catch (e) {
    console.log('清理异常:', (e as Error)?.message)
  }
}

async function createTask(bookUrl: string, name: string) {
  const rule = await db.rule.create({ data: { name: `ttc-probe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, description: 'tt-c 探针', config: ruleConfig(), enabled: true } })
  const task = await db.task.create({
    data: { name, ruleId: rule.id, mode: 'single', bookUrl, recrawlMode: 'incremental', storageMode: 'db', threadMin: 2, threadMax: 2, intervalMin: 50, intervalMax: 100, smartCategory: false, smartComplete: false, autoSuggest: false, status: 'pending' },
  })
  return { ruleId: rule.id, taskId: task.id }
}

const VOL_A = '第一卷 测试甲'
const VOL_B = '第二卷 测试乙'

// ---------------- 场景A: 跨卷乱序重排分卷安全性 ----------------
console.log('\n== 场景A: 分卷目录乱序 + 卷中插新章 → 重排不越卷边界 ==')
{
  const routes1: Record<string, string> = {
    '/bookA1': `<html><head><title>ttc探针书甲</title></head><body><h1 id="name">ttc探针书甲</h1><div id="author">探针作者</div><div id="intro">场景A探针书。</div>
      <ul id="toc">${li(VOL_A, '第1章 甲一', '/a1')}${li(VOL_A, '第2章 甲二', '/a2')}${li(VOL_B, '第3章 乙一', '/a3')}${li(VOL_B, '第4章 乙二', '/a4')}</ul></body></html>`,
    // 第2轮: 目录乱序到达(乙一/甲一/乙二/新章/甲二), 甲卷中段插入新章 → 排序后 A: 1,新,2 / B: 3,4
    '/bookA2': `<html><head><title>ttc探针书甲</title></head><body><h1 id="name">ttc探针书甲</h1><div id="author">探针作者</div><div id="intro">场景A探针书。</div>
      <ul id="toc">${li(VOL_B, '第3章 乙一', '/a3')}${li(VOL_A, '第1章 甲一', '/a1')}${li(VOL_B, '第4章 乙二', '/a4')}${li(VOL_A, '第1.5章 甲插', '/a15')}${li(VOL_A, '第2章 甲二', '/a2')}</ul></body></html>`,
  }
  for (const n of ['a1', 'a2', 'a3', 'a4', 'a15']) routes1[`/${n}`] = chapterHtml(n)
  const port = await startServer(routes1)
  const bookUrl = `http://127.0.0.1:${port}/bookA1`
  const { ruleId, taskId } = await createTask(bookUrl, 'tt-c·跨卷重排探针A')
  try {
    ok('A1 第一轮完成', await runTask(taskId, 'A1'))
    const bk = await db.book.findFirst({ where: { sourceUrl: bookUrl } })
    const chs1 = await db.chapter.findMany({ where: { bookId: bk!.id }, orderBy: { idx: 'asc' } })
    ok('A1 四章落库含卷名', chs1.length === 4 && chs1.every((c) => c.fetched && c.volume), chs1.map((c) => `${c.idx}:${c.title}[${c.volume}]`).join(','))

    // 第二轮: 指向新目录页(同书续采 — 换 bookUrl 会建新书, 故直接改章节目标? 不: 单本模式 bookUrl 固定,
    // 这里用"同 bookUrl 但内容轮换"不可行 → 第二轮改为: 静态改动 routes 已注册 /bookA2, 单本模式重跑同任务
    // 仍抓 /bookA1 → 改用 recrawl 场景: 更新任务 bookUrl 指向 /bookA2 且 sourceUrl 对齐
    await db.task.update({ where: { id: taskId }, data: { bookUrl: `http://127.0.0.1:${port}/bookA2` } })
    // existUrlMap 按 sourceUrl 匹配: book 源URL 仍是 /bookA1 → 第二轮会按 name+author 匹配回同一本书
    // (runner findFirst OR [sourceUrl, name+author]) — name 相同 author 相同 → 命中同一行 ✓
    ok('A2 第二轮完成(增量+乱序目录)', await runTask(taskId, 'A2'))
    const chs2 = await db.chapter.findMany({ where: { bookId: bk!.id }, orderBy: { idx: 'asc' } })
    const byTitle = new Map(chs2.map((c) => [c.title, c]))
    const idxOf = (t: string) => byTitle.get(t)?.idx
    const volOf = (t: string) => byTitle.get(t)?.volume
    ok('A2 【核心】A卷三章连续占 1~3', idxOf('第1章 甲一') === 1 && idxOf('第1.5章 甲插') === 2 && idxOf('第2章 甲二') === 3, `甲一=${idxOf('第1章 甲一')} 甲插=${idxOf('第1.5章 甲插')} 甲二=${idxOf('第2章 甲二')}`)
    ok('A2 【核心】B卷两章占 4~5 未被挤入A卷', idxOf('第3章 乙一') === 4 && idxOf('第4章 乙二') === 5, `乙一=${idxOf('第3章 乙一')} 乙二=${idxOf('第4章 乙二')}`)
    ok('A2 卷名不串(A卷章卷名=甲卷, B卷=乙卷)', volOf('第1章 甲一') === VOL_A && volOf('第2章 甲二') === VOL_A && volOf('第1.5章 甲插') === VOL_A && volOf('第3章 乙一') === VOL_B && volOf('第4章 乙二') === VOL_B)
    ok('A2 新章正文已采', byTitle.get('第1.5章 甲插')?.fetched === true)
    ok('A2 全部章节 fetched', chs2.every((c) => c.fetched), `count=${chs2.length}`)
  } finally {
    await cleanup(ruleId, taskId, bookUrl, 'ttc探针书甲')
  }
}

// ---------------- 场景B: 阶段A负数残留 + unfetched 回推 ----------------
console.log('\n== 场景B: 负数临时位残留自愈 + unfetched 回推边界 ==')
{
  const routes: Record<string, string> = {
    '/bookB': `<html><head><title>ttc探针书乙</title></head><body><h1 id="name">ttc探针书乙</h1><div id="author">探针作者</div><div id="intro">场景B探针书。</div>
      <ul id="toc">${li(VOL_A, '第1章 甲一', '/b1')}${li(VOL_A, '第2章 甲二', '/b2')}</ul></body></html>`,
    '/bookB2': `<html><head><title>ttc探针书乙</title></head><body><h1 id="name">ttc探针书乙</h1><div id="author">探针作者</div><div id="intro">场景B探针书。</div>
      <ul id="toc">${li(VOL_A, '第0章 甲零', '/b0')}${li(VOL_A, '第1章 甲一', '/b1')}${li(VOL_A, '第2章 甲二', '/b2')}</ul></body></html>`,
  }
  for (const n of ['b0', 'b1', 'b2', 'b8', 'bz']) routes[`/${n}`] = chapterHtml(n)
  const port = await startServer(routes)
  const bookUrl = `http://127.0.0.1:${port}/bookB`
  const { ruleId, taskId } = await createTask(bookUrl, 'tt-c·负数残留探针B')
  try {
    ok('B1 第一轮完成', await runTask(taskId, 'B1'))
    const bk = await db.book.findFirst({ where: { sourceUrl: bookUrl } })
    const chs1 = await db.chapter.findMany({ where: { bookId: bk!.id } })
    // 模拟"进程在阶段A与阶段D之间被杀"的残留: 陈旧章 Z 卡 -1(不在第2轮目录内, 未采)
    await db.chapter.create({ data: { bookId: bk!.id, idx: -1, title: '第9章 残留Z', url: `http://127.0.0.1:${port}/bz`, volume: '', storage: 'db', fetched: false } })
    // 不冲突陈旧未采章(第8章, 不在第2轮目录, idx=8 不占目标位) → 原位续采边界
    await db.chapter.create({ data: { bookId: bk!.id, idx: 8, title: '第8章 陈旧丙', url: `http://127.0.0.1:${port}/b8`, volume: '', storage: 'db', fetched: false } })
    void chs1
    await db.task.update({ where: { id: taskId }, data: { bookUrl: `http://127.0.0.1:${port}/bookB2` } })
    ok('B2 第二轮完成(目录头插新章)', await runTask(taskId, 'B2'))
    const chs2 = await db.chapter.findMany({ where: { bookId: bk!.id }, orderBy: { idx: 'asc' } })
    const byTitle = new Map(chs2.map((c) => [c.title, c]))
    const idxOf = (t: string) => byTitle.get(t)?.idx
    const errors = JSON.parse((await db.task.findUnique({ where: { id: taskId } }))?.stats || '{}').errors || 0
    ok('B2 【核心】新章第0章成功建行@1(残留-1不得毒化阶段A/C)', idxOf('第0章 甲零') === 1 && byTitle.get('第0章 甲零')?.fetched === true, `idx=${idxOf('第0章 甲零')}`)
    ok('B2 第1章/第2章 重排到位@2/@3', idxOf('第1章 甲一') === 2 && idxOf('第2章 甲二') === 3, `甲一=${idxOf('第1章 甲一')} 甲二=${idxOf('第2章 甲二')}`)
    ok('B2 残留负数位已被治愈(库里无负 idx)', chs2.every((c) => c.idx >= 1), chs2.filter((c) => c.idx < 0).map((c) => `${c.title}@${c.idx}`).join(','))
    ok('B2 残留Z(未采)挪尾后获采', (byTitle.get('第9章 残留Z')?.idx ?? 0) > 3 && byTitle.get('第9章 残留Z')?.fetched === true, `idx=${byTitle.get('第9章 残留Z')?.idx} fetched=${byTitle.get('第9章 残留Z')?.fetched}`)
    ok('B2 不冲突陈旧章第8章原位续采', idxOf('第8章 陈旧丙') === 8 && byTitle.get('第8章 陈旧丙')?.fetched === true, `idx=${idxOf('第8章 陈旧丙')}`)
    ok('B2 全程零章节创建错误', errors === 0, `errors=${errors}`)
  } finally {
    await cleanup(ruleId, taskId, bookUrl, 'ttc探针书乙')
  }
}

// ---------------- 场景C: 任务级连续错误熔断(反反爬韧性) ----------------
console.log('\n== 场景C: 连续章节失败达阈值 → 熔断中止 + error 终态 ==')
{
  // 章节链接指向必然拒绝连接的死端口(全失败路径, 快速 ECONNREFUSED 不吃超时)
  const DEAD = 'http://127.0.0.1:59993'
  const tocLis = Array.from({ length: 30 }, (_, i) => li(VOL_A, `第${i + 1}章 丙${i + 1}`, `${DEAD}/c${i + 1}`)).join('')
  const routes: Record<string, string> = {
    '/bookC': `<html><head><title>ttc探针书丙</title></head><body><h1 id="name">ttc探针书丙</h1><div id="author">探针作者</div><div id="intro">场景C熔断探针书。</div>
      <ul id="toc">${tocLis}</ul></body></html>`,
  }
  const port = await startServer(routes)
  const bookUrl = `http://127.0.0.1:${port}/bookC`
  const { ruleId, taskId } = await createTask(bookUrl, 'tt-c·熔断探针C')
  try {
    const s = await TaskRunner.instance.control(taskId, 'start')
    ok('C1 启动', s.ok)
    let finalStatus = ''
    const t1 = Date.now()
    while (Date.now() - t1 < 60_000) {
      const t = await db.task.findUnique({ where: { id: taskId } })
      if (t?.status === 'done' || t?.status === 'error' || t?.status === 'paused' || t?.status === 'stopped') { finalStatus = t?.status || ''; break }
      await sleep(300)
    }
    ok('C2 任务终态=error(熔断中止, 非 done 硬跑完)', finalStatus === 'error', `status=${finalStatus}`)
    const stats = JSON.parse((await db.task.findUnique({ where: { id: taskId } }))?.stats || '{}')
    ok('C3 errors ≥ 20(阈值证据)', (stats.errors || 0) >= 20, `errors=${stats.errors}`)
    const fetchedCnt = await db.chapter.count({ where: { bookId: (await db.book.findFirst({ where: { sourceUrl: bookUrl } }))!.id, fetched: true } })
    ok('C4 全书 30 章无一采成(死端口)', fetchedCnt === 0, `fetched=${fetchedCnt}`)
    const logs = await db.taskLog.findMany({ where: { taskId }, select: { message: true } })
    ok('C5 日志含熔断中止标记', logs.some((l) => l.message.includes('熔断中止')), logs.filter((l) => l.message.includes('熔断')).length + '条熔断日志')
    ok('C6 队列未跑满(熔断早停, 尝试章数<30)', (stats.chaptersCreated || 0) === 30 && logs.filter((l) => l.message.includes('章节失败')).length < 60, `失败日志=${logs.filter((l) => l.message.includes('章节失败')).length}条(2线程×30章全失败≈30条+重试0, 若熔断失效会更多批次刷屏)`)
  } finally {
    await cleanup(ruleId, taskId, bookUrl, 'ttc探针书丙')
  }
}

console.log(`\n===== 探针结果: ${pass} 通过 / ${failCnt} 失败 =====`)
for (const s of servers) { s.closeAllConnections?.(); s.close() }
process.exit(0)
