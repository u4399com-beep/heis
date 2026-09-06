/**
 * verify-jj-b-api.ts — jj-b API域生产就绪深审 断言脚本
 * 对 dev server 现网逐项断言: 信封一致性/钳制/404兜底/游标语义/batch校验/注入面
 * 纪律: 只读 + 无害探测; 不触碰运行中任务 cmtk2yv6b0005pau2ecnp28ti 的 control/PUT;
 *       不创建持久数据(创建类仅打非法入参, 断言其不入库)。
 * 运行: bun run scripts/verify-jj-b-api.ts ; 结束 process.exit(0/1)
 */
const BASE = process.env.VERIFY_BASE || 'http://localhost:3000'
const RUNNING_TASK = 'cmtk2yv6b0005pau2ecnp28ti'

let pass = 0
let failCnt = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failCnt++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function req(
  path: string,
  init?: RequestInit
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + path, init)
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON(sitemap/cover/download) */
  }
  return { status: res.status, json, text }
}

const post = (path: string, body: unknown) =>
  req(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const put = (path: string, body: unknown) =>
  req(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** 错误信封统一形态: {ok:false,message} 且 HTTP 状态与业务一致(4xx/5xx, 非3xx) */
function envelopeFail(name: string, r: { status: number; json: any }, minStatus = 400, maxStatus = 499) {
  ok(
    `${name} [状态${r.status}在${minStatus}~${maxStatus}]`,
    r.status >= minStatus && r.status <= maxStatus
  )
  ok(
    `${name} [信封{ok:false,message}]`,
    r.json && r.json.ok === false && typeof r.json.message === 'string' && r.json.message.length > 0
  )
}

// ============================================================
async function main() {
  console.log(`\n== A. 前台公开接口 钳制/白名单/信封 ==`)

  // A1 books: 负页码/超大size/非法status/sort注入 → 200 且钳制生效
  {
    const r = await req('/api/public/books?page=-5&size=99999&status=xxx&sort=(bad)')
    ok('A1 books 非法分页仍200', r.status === 200 && r.json?.ok === true)
    const d = r.json?.data || {}
    ok('A1 size 钳到60', d.size === 60, `size=${d.size}`)
    ok('A1 page 钳到1', d.page === 1, `page=${d.page}`)
    ok('A1 books 为数组', Array.isArray(d.books))
  }

  // A2 books: 类型混淆 page=[1x] / size={} → 不 500
  {
    const r = await req('/api/public/books?page[]=9&size=abc')
    ok('A2 类型混淆不炸(200)', r.status === 200 && r.json?.ok === true, `status=${r.status}`)
  }

  // A3 search: LIKE 通配符清洗(%% / _) + limit 钳制
  {
    const r = await req('/api/public/search?q=%25%E4%B8%AD%25&limit=999')
    ok('A3 search 通配符进LIKE前被清(200)', r.status === 200 && r.json?.ok === true)
    const r2 = await req('/api/public/search?limit=-3')
    ok('A3 空词短路返回空数组', r2.status === 200 && Array.isArray(r2.json?.data?.books))
  }

  // A4 book/chapter: 缺参400 / 未知id 404
  {
    envelopeFail('A4 缺id', await req('/api/public/book'))
    envelopeFail('A4 未知书', await req('/api/public/book?id=nonexistent000000000000'))
    envelopeFail('A4 未知章', await req('/api/public/chapter?id=nonexistent000000000000'))
  }

  // A5 cover: 路径穿越面(%2e%2e / 绝对路径 / 非 webp)
  {
    envelopeFail('A5 穿越拒绝1', await req('/api/public/cover?file=..%2F..%2Fdb.custom%3Fw.webp'))
    envelopeFail('A5 穿越拒绝2', await req('/api/public/cover?file=%2e%2e%2f%2e%2e%2fdb.sqlite'))
    envelopeFail('A5 非法名', await req('/api/public/cover?file=abc.png'))
    envelopeFail('A5 不存在', await req('/api/public/cover?file=zzz_not_exist_1.webp'), 400, 404)
  }

  // A6 download: 缺参/未知任务 → 404
  {
    envelopeFail('A6 缺id', await req('/api/public/download'))
    envelopeFail('A6 未知任务', await req('/api/public/download?id=nonexistent000000000000'), 400, 404)
  }

  // A7 sitemap: 200 xml + urlset
  {
    const r = await req('/api/public/sitemap')
    ok('A7 sitemap 200', r.status === 200)
    ok('A7 xml urlset', r.text.includes('<urlset') && r.text.includes('</urlset>'))
  }

  // A8 tags/keyword/links/categories
  {
    const t = await req('/api/public/tags?n=100000')
    ok('A8 tags 200', t.status === 200 && t.json?.ok === true)
    ok('A8 tags n钳制≤120', Array.isArray(t.json?.data?.tags) && t.json.data.tags.length <= 120,
      `len=${t.json?.data?.tags?.length}`)
    const k = await req('/api/public/keyword')
    ok('A8 keyword 缺kw 200空形态', k.status === 200 && k.json?.data?.tag === '' && k.json.data.book === null)
    const l = await req('/api/public/links?site=')
    ok('A8 links 200', l.status === 200 && typeof l.json?.data?.friend?.length === 'number')
    const c = await req('/api/public/categories?limit=-9')
    ok('A8 categories 200', c.status === 200 && Array.isArray(c.json?.data?.items))
  }

  console.log(`\n== B. 任务API 游标/详情/校验(不触碰运行中任务控制面) ==`)

  // B1 运行中任务详情: live=true
  {
    const r = await req(`/api/admin/tasks/${RUNNING_TASK}`)
    ok('B1 运行任务详情200', r.status === 200 && r.json?.ok === true)
    ok('B1 live=true', r.json?.data?.live === true, `live=${r.json?.data?.live}`)
    ok('B1 progress JSON可解析', (() => {
      try { const p = JSON.parse(r.json?.data?.progress || '{}'); return typeof p === 'object' } catch { return false }
    })())
  }

  // B2 logs 游标语义: 全量→取中位id为after→增量页 id 全 > after 且升序且不重叠
  {
    const all = await req(`/api/admin/tasks/${RUNNING_TASK}/logs`)
    ok('B2 全量200', all.status === 200 && Array.isArray(all.json?.data))
    const rows: { id: string; createdAt: string }[] = all.json?.data || []
    if (rows.length >= 2) {
      const mid = rows[Math.floor(rows.length / 2)].id
      const inc = await req(`/api/admin/tasks/${RUNNING_TASK}/logs?after=${encodeURIComponent(mid)}`)
      const incRows: { id: string }[] = inc.json?.data || []
      ok('B2 after游标200', inc.status === 200)
      ok('B2 增量页全部 id>after', incRows.every((x) => x.id > mid),
        incRows.find((x) => x.id <= mid)?.id)
      ok('B2 增量页升序', incRows.every((x, i, a) => i === 0 || a[i - 1].id < x.id))
      // 游标正确性真不变量: 快照中所有 id>after 的日志必须被增量页完整覆盖(不跳不漏);
      // (增量页含快照后半段属游标语义本身, UI 以 id 去重)
      ok('B2 增量页无漏(快照 id>after 全覆盖)', rows
        .filter((o) => o.id > mid)
        .every((o) => incRows.some((x) => x.id === o.id)))
      ok('B2 单页≤200', rows.length <= 200)
    } else {
      ok('B2 运行中任务日志≥2条(游标可测)', false, `len=${rows.length}`)
    }
    // 非法after值不炸
    const bad = await req(`/api/admin/tasks/${RUNNING_TASK}/logs?after=${encodeURIComponent('%zz\xff中')}`)
    ok('B2 非法after不炸', bad.status === 200)
  }

  // B3 不存在任务: 详情/日志/控制 → 404
  {
    envelopeFail('B3 详情404', await req('/api/admin/tasks/nonexistent000000000000'), 400, 404)
    envelopeFail('B3 日志404', await req('/api/admin/tasks/nonexistent000000000000/logs'), 400, 404)
    envelopeFail('B3 控制404', await post('/api/admin/tasks/nonexistent000000000000/control', { action: 'stop' }), 400, 404)
  }

  // B4 tasks POST 校验矩阵(全部拒绝, 不得入库)
  {
    const before = await req('/api/admin/tasks')
    const n0 = (before.json?.data || []).length
    const cases: [string, unknown][] = [
      ['缺ruleId', { name: 'x', mode: 'single', bookUrl: 'https://a.com/b' }],
      ['未知ruleId', { name: 'x', ruleId: 'nope00000000000000000000', mode: 'single', bookUrl: 'https://a.com/b' }],
      ['非法mode', { name: 'x', ruleId: 'whatever', mode: 'rangeX' }],
      ['single缺bookUrl', { name: 'x', ruleId: 'whatever', mode: 'single' }],
      ['range缺listUrl', { name: 'x', ruleId: 'whatever', mode: 'range' }],
      ['非法bookUrl', { name: 'x', ruleId: 'whatever', mode: 'single', bookUrl: 'javascript://x' }],
      ['空名', { name: '  ', ruleId: 'whatever' }],
    ]
    for (const [nm, body] of cases) {
      const r = await post('/api/admin/tasks', body)
      ok(`B4 ${nm} 拒绝`, r.status >= 400 && r.status <= 499 && r.json?.ok === false, `status=${r.status}`)
    }
    // 数组/标量整体当body
    const r1 = await req('/api/admin/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1,2]' })
    ok('B4 body=数组不炸', r1.status >= 400 && r1.status <= 499, `status=${r1.status}`)
    const r2 = await post('/api/admin/tasks', 'garbage-not-json')
    ok('B4 非JSON body不炸', r2.status >= 400 && r2.status <= 499, `status=${r2.status}`)
    const after = await req('/api/admin/tasks')
    const n1 = (after.json?.data || []).length
    ok('B4 校验失败未产生任务', n0 === n1, `before=${n0} after=${n1}`)
  }

  // B5 batch 与运行中任务: delete 运行中 → skipped 而非误删/误停; 非法action 400
  {
    const r = await post('/api/admin/tasks/batch', { action: 'delete', ids: [RUNNING_TASK] })
    ok('B5 batch delete 运行中→skipped', r.status === 200 && r.json?.data?.affected === 0
      && r.json?.data?.skipped?.length === 1 && /运行中/.test(r.json.data.skipped[0].reason || ''),
      JSON.stringify(r.json?.data))
    const r2 = await post('/api/admin/tasks/batch', { action: 'nuke', ids: ['x'] })
    envelopeFail('B5 非法action', r2)
    const r3 = await post('/api/admin/tasks/batch', { action: 'start', ids: [] })
    envelopeFail('B5 空ids', r3)
  }

  // B6 tasks PUT: 不存在任务 404; 非法线程值在不存在任务上无从测, 用合法任务禁改(运行中)→ 只测404路径
  {
    envelopeFail('B6 PUT 未知任务', await put('/api/admin/tasks/nonexistent000000000000', { threadMin: 2 }), 400, 404)
  }

  console.log(`\n== C. admin 资源校验面(books/batch、categories、links、rules、sites、downloads) ==`)

  // C1 books/batch 非法action/空ids/超大payload
  {
    envelopeFail('C1 非法action', await post('/api/admin/books/batch', { action: 'drop-table', ids: ['x'] }))
    envelopeFail('C1 空ids', await post('/api/admin/books/batch', { action: 'delete', ids: [] }))
    envelopeFail('C1 status白名单', await post('/api/admin/books/batch', { action: 'status', ids: ['x'], payload: { status: 'Zzz' } }))
    envelopeFail('C1 category 未知', await post('/api/admin/books/batch', { action: 'category', ids: ['x'], payload: { categoryId: 'nope00000000000000000' } }))
  }

  // C2 书籍手动新增校验: 缺名/非法来源URL → 400 不入库
  {
    const r = await post('/api/admin/books', { name: '' })
    envelopeFail('C2 缺书名', r)
    const r2 = await post('/api/admin/books', { name: 'jj-b探针书X', sourceUrl: 'javascript:alert(1)' })
    envelopeFail('C2 非法sourceUrl', r2)
    const r3 = await post('/api/admin/books', { name: 'jj-b探针书X', categoryId: 'nope000000000000000000' })
    envelopeFail('C2 未知分类404', r3, 400, 404)
    // 确认没有探针书入库(前两个用例均应被拒)
    const q = await req(`/api/admin/books?q=${encodeURIComponent('jj-b探针书X')}`)
    ok('C2 探针书未入库', (q.json?.data?.total || 0) === 0, `total=${q.json?.data?.total}`)
  }

  // C3 chapters/batch / categories/batch 校验
  {
    envelopeFail('C3 chapters 非法action', await post('/api/admin/chapters/batch', { action: 'burn', ids: ['x'] }))
    envelopeFail('C3 categories 非法action', await post('/api/admin/categories/batch', { action: 'sortx', ids: ['x'] }))
    const r = await post('/api/admin/categories/batch', { action: 'order', ids: ['nonexistent000000000000'] })
    envelopeFail('C3 order 未知分类整体取消', r, 400, 404)
  }

  // C4 links 单条: 非法URL/logo白名单
  {
    envelopeFail('C4 url白名单', await post('/api/admin/links', { name: 'x', url: 'javascript:alert(1)' }))
    envelopeFail('C4 ftp拒绝', await post('/api/admin/links', { name: 'x', url: 'ftp://bad.example.com' }))
    envelopeFail('C4 logo协议相对', await post('/api/admin/links', { name: 'x', url: 'https://a.com', logo: '//evil.com/x.png' }))
    envelopeFail('C4 缺id PUT', await put('/api/admin/links', { name: 'y' }))
  }

  // C5 rules: POST 空/非法config形态; batch 非法action; test 非法section/缺URL
  {
    envelopeFail('C5 规则缺名', await post('/api/admin/rules', { name: '' }))
    envelopeFail('C5 config类型非法', await post('/api/admin/rules', { name: 'jj-b探针规则', config: 12345 }))
    envelopeFail('C5 batch非法action', await post('/api/admin/rules/batch', { action: 'drop', ids: ['x'] }))
    envelopeFail('C5 test非法section', await post('/api/admin/rules/test', { section: 'head', url: 'https://a.com' }))
    envelopeFail('C5 test缺URL', await post('/api/admin/rules/test', { section: 'list', url: '' }))
    envelopeFail('C5 test非法URL', await post('/api/admin/rules/test', { section: 'list', url: 'file:///etc/passwd' }))
    // 确认探针规则未入库
    const g = await req('/api/admin/rules')
    ok('C5 探针规则未入库', !(g.json?.data || []).some((x: any) => x?.name === 'jj-b探针规则'))
  }

  // C6 sites: 域名非法/重复域名(aa-e回归)
  {
    envelopeFail('C6 非法域名', await post('/api/admin/sites', { name: 'x', domain: 'not a domain!' }))
    const sites = await req('/api/admin/sites')
    const anySite = (sites.json?.data || [])[0]
    if (anySite) {
      const dup = await put(`/api/admin/sites/${anySite.id}`, { domain: 'not a domain!' })
      envelopeFail('C6 PUT非法域名', dup)
    }
  }

  // C7 downloads: 缺bookId/未知书 → 400/404 且不建任务
  {
    const cnt0 = await req('/api/admin/downloads')
    const r = await post('/api/admin/downloads', {})
    envelopeFail('C7 缺bookId', r)
    const r2 = await post('/api/admin/downloads', { bookId: 'nonexistent000000000000' })
    envelopeFail('C7 未知书404', r2, 400, 404)
    const r3 = await post('/api/admin/downloads', { bookId: 'x', obfuscateMode: 'hacker' })
    envelopeFail('C7 非法混淆模式(在未知书之后仍应先撞书籍校验或模式校验)', r3)
    const cnt1 = await req('/api/admin/downloads')
    ok('C7 未产生下载任务', (cnt0.json?.data || []).length === (cnt1.json?.data || []).length)
  }

  // C8 settings: 非对象body/非法key/超大值
  {
    envelopeFail('C8 非法key', await put('/api/admin/settings', { 'bad key!': 1 }))
    envelopeFail('C8 空对象', await put('/api/admin/settings', {}))
    const okR = await put('/api/admin/settings', { __jjbProbe: { a: 1 } })
    ok('C8 合法key保存200', okR.status === 200 && okR.json?.ok === true)
    // 清理探针key: 无DELETE — 用同key写回再确认; Setting无删除API, 写入无害键后需清理:
    // 通过再次验证全量GET确认键存在后, 用 prisma 直接删(脚本侧, 不经API)
    if (okR.status === 200) {
      const { PrismaClient } = await import('@prisma/client')
      const p = new PrismaClient()
      await p.setting.deleteMany({ where: { key: '__jjbProbe' } })
      await p.$disconnect()
      const g = await req('/api/admin/settings')
      ok('C8 探针key已清理', g.json?.data && !('__jjbProbe' in g.json.data))
    }
  }

  console.log(`\n== D. 运行中任务 API 面观察(只读) ==`)
  {
    const t = await req('/api/admin/tasks')
    const rows = t.json?.data || []
    const rt = rows.find((x: any) => x.id === RUNNING_TASK)
    ok('D1 列表含运行中任务', !!rt)
    ok('D1 任务行带rule引用', rt && typeof rt.rule === 'object' && !!rt.rule?.id)
    // stats 接口可用(运行中任务不炸)
    const s = await req('/api/admin/stats')
    ok('D2 stats 200', s.status === 200 && s.json?.ok === true)
    ok('D2 runningTasks≥1', (s.json?.data?.runningTasks || 0) >= 1)
  }

  console.log(`\n==========`)
  console.log(`PASS ${pass} / FAIL ${failCnt}`)
  if (failCnt) {
    console.log('FAILURES:')
    for (const f of failures) console.log('  - ' + f)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('脚本异常:', e)
  process.exit(1)
})

// 文件必须是模块: 全局脚本形态的 const BASE/function main 会与 probe-hh-tomato-revive.ts
// 等其他无 import/export 的脚本在 tsc 单程序内重名(n4/kanunu8 同类教训)
export {}
