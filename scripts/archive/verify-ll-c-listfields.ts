// ============================================================
// verify-ll-c-listfields.ts — ll-c2 列表字段随行兜底断言
//   1. 静态源码断言: listFields Map 构建/传参/兜底链在位
//   2. mock e2e: detail 端点空数据(JSON 无 book_name)时, 书名从列表页字段兜底入库
//      (修前入库《api/detail》形态; 修后《列表书名》) + 建删还原零残留
// 运行: bun scripts/verify-ll-c-listfields.ts
// ============================================================
import http from 'http'
import { readFileSync } from 'fs'

export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

console.log('\n== 1. 静态源码断言 ==')
{
  const src = readFileSync('src/lib/crawl/runner.ts', 'utf8')
  ok('listFields Map 在 list 段构建', src.includes('const listFields = new Map<string, { name?: string; author?: string; intro?: string; category?: string }>()'))
  ok('parseList 后按 items 收集字段', src.includes('listFields.set(u, { name: it.fields.name'))
  ok('crawlOneBook 签名含可选 listFields', src.includes('listFields?: { name?: string; author?: string; intro?: string; category?: string }'))
  ok('调用点透传 listFields.get(bookUrl)', src.includes('cfg.interval, listFields.get(bookUrl)'))
  ok('书名兜底链 detail→list→URL→未知', /cleanTextField\(parsed\.name, 120\) \|\| cleanTextField\(listFields\?\.name, 120\)/.test(src))
  ok('author 兜底链 detail→list→佚名', /cleanTextField\(parsed\.author, 60\) \|\| cleanTextField\(listFields\?\.author, 60\) \|\| '佚名'/.test(src))
  ok('intro/category 同步兜底', /cleanIntro\(parsed\.intro\) \|\| cleanIntro\(listFields\?\.intro \|\| ''\)/.test(src) && /cleanTextField\(parsed\.category, 30\) \|\| cleanTextField\(listFields\?\.category, 30\)/.test(src))
}

// ---------------- mock: 列表页 name 正常, detail 空数据 ----------------
const server = http.createServer((req, res) => {
  const url = req.url || ''
  if (url.startsWith('/list')) {
    res.setHeader('content-type', 'application/json')
    // padding: fetcher 极短内容(<200字符)判拦会升级 browser 引擎, 真实番茄响应远超阈值,
    // mock 加长字段拟真避免误触发(mock 拟真度问题, 非引擎 bug)
    res.end(JSON.stringify({ data: { padding: '拟真填充字段。'.repeat(60), items: [{ book_name: '测试兜底书名', author: '测试作者', abstract: '简介来自列表页', category: '测试分类', book_id: '1001' }] } }))
  } else if (url.startsWith('/api/detail')) {
    // 上游空数据形态(实测番茄 2026-09-02): data.data 为空对象
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 0, data: { code: 0, data: {}, message: 'ok', pad: '拟真填充字段。'.repeat(40) }, elapsed_ms: 5, message: 'ok' }))
  } else if (url.startsWith('/api/book')) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: { data: { pad: '拟真填充字段。'.repeat(40), chapterListWithVolume: [[{ itemId: '1', title: '第1章 起点', volume_name: '第一卷' }, { itemId: '2', title: '第2章 试炼', volume_name: '第一卷' }]] } } }))
  } else if (url.startsWith('/api/content')) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: { pad: '拟真填充字段。'.repeat(40), content: '正文内容段落。'.repeat(50) } }))
  } else { res.statusCode = 404; res.end('nf') }
})

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  const { db } = await import('../src/lib/db')
  const { TaskRunner } = await import('../src/lib/crawl/runner')
  let ruleId = '', taskId = ''
  try {
    const cfg = {
      list: {
        enabled: true,
        urlTemplate: `${base}/list?page={page}`,
        itemSelector: { type: 'json', expression: 'data.items' },
        fields: {
          name: { type: 'json', expression: 'book_name' },
          author: { type: 'json', expression: 'author' },
          intro: { type: 'json', expression: 'abstract' },
          category: { type: 'json', expression: 'category' },
          bookUrl: { type: 'json', expression: 'book_id', replaceFrom: '^(\\d+)$', replaceTo: '/api/detail?book_id=$1' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      book: { enabled: true, fields: { name: { type: 'json', expression: 'data.data.book_name' }, author: { type: 'json', expression: 'data.data.author' } } },
      toc: { enabled: true, tocLink: { type: 'const', expression: '/api/book?book_id={q.book_id}' }, itemSelector: { type: 'json', expression: 'data.data.chapterListWithVolume.*' }, fields: { title: { type: 'json', expression: 'title' }, itemId: { type: 'json', expression: 'itemId' }, url: { type: 'const', expression: '/api/content?item_id={itemId}&bid={q.book_id}' }, volume: { type: 'json', expression: 'volume_name' } }, pagination: { enabled: false, maxPages: 1 } },
      content: { enabled: true, fields: { content: { type: 'json', expression: 'data.content' } } },
      fetch: {},
      clean: { removeAds: [] },
    }
    const rule = await db.rule.create({ data: { name: `llc-listfields-${Date.now()}`, description: 'll-c2 列表字段兜底', config: JSON.stringify(cfg), enabled: true } })
    ruleId = rule.id
    const task = await db.task.create({ data: { name: 'llc-listfields-task', ruleId, mode: 'range', listUrl: `${base}/list`, listStart: 1, listEnd: 1, recrawlMode: 'incremental', storageMode: 'db', threadMin: 2, threadMax: 2, intervalMin: 50, intervalMax: 80, smartCategory: false, smartComplete: false, autoSuggest: false, status: 'pending' } })
    taskId = task.id

    const res = await fetch(`${process.env.VERIFY_BASE || 'http://127.0.0.1:3000'}/api/admin/tasks/${taskId}/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start' }) })
    ok('任务 start 成功', res.ok)
    let final = ''
    for (let i = 0; i < 60; i++) { await sleep(1000); const t = await db.task.findUnique({ where: { id: taskId } }); final = t?.status || ''; if (['done', 'error', 'stopped'].includes(final)) break }
    ok('任务收敛终态', final === 'done', `status=${final}`)

    // ★ scoped to 本脚本 mock base: 生产番茄书 URL 同含 '/api/detail?book_id=', 无 scope 会误匹配生产书
    //   (2026-09-04 rr-c 事故: 无 scope 的 cleanup 曾整书误删生产《剑仙》1348章, 已由任务自愈重建)
    const bk = await db.book.findFirst({ where: { sourceUrl: { startsWith: base + '/api/detail?book_id=' } } })
    ok('书已入库', !!bk)
    ok('【核心】书名兜底自列表页(非 api/detail)', bk?.name === '测试兜底书名', `name=${bk?.name}`)
    ok('作者兜底自列表页', bk?.author === '测试作者', `author=${bk?.author}`)
    ok('简介兜底自列表页', (bk?.intro || '').includes('简介来自列表页'))
    const chs = bk ? await db.chapter.findMany({ where: { bookId: bk.id }, orderBy: { idx: 'asc' } }) : []
    ok('章节 2 章入库', chs.length === 2, `count=${chs.length}`)
    ok('分卷名随行(volume_name)', chs[0]?.volume === '第一卷', `volume=${chs[0]?.volume}`)
  } finally {
    try {
      // 排查辅助: cleanup 前打出任务日志(定位失败原因)
      if (taskId) {
        const ls = await db.taskLog.findMany({ where: { taskId }, orderBy: { id: 'asc' } })
        for (const l of ls) console.log(`  [日志][${l.level}] ${l.message.slice(0, 110)}`)
      }
      const bk = await db.book.findFirst({ where: { sourceUrl: { startsWith: base + '/api/detail?book_id=' } } })
      if (bk) { await db.chapter.deleteMany({ where: { bookId: bk.id } }); await db.book.delete({ where: { id: bk.id } }) }
      if (taskId) { await db.taskLog.deleteMany({ where: { taskId } }); await db.task.delete({ where: { id: taskId } }).catch(() => {}) }
      if (ruleId) await db.rule.delete({ where: { id: ruleId } }).catch(() => {})
    } catch {}
    server.close()
  }
  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`)
  process.exit(fail > 0 ? 1 : 0)
}
main()
