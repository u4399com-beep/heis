/**
 * verify-mm-a.ts — mm-a 第11轮 API 域 + 管理 UI 域生产就绪深审 · 断言脚本
 * 覆盖:
 *   A. 主题注册表 API ↔ themes.ts 契约一致性(pili 新主题全字段 + 全主题枚举面)
 *   B. 新字段 autoRefresh/refreshIntervalMin 全出口一致性(列表/详情/stats)+ 生产任务只读观测
 *   C. 探针任务: POST/PUT 白名单+钳制上下界+1 / 联动校验 / batch 语义(建后必删, 净 DB=0)
 *   D. rules(+test): regex 门 / fetchMode·scraplingBridgeUrl 白名单出口 / 本地 mock 源站端到端
 *   E. books/sites/links/categories/settings/stats/downloads/chapters 信封与边界
 *   F. 管理 UI(playwright): 10 Section 逐页 0 pageerror/0 console error + RuleEditor 对话框
 *      max-width(断言 1100px) + ThemesSection pili 卡 + TaskMonitor 轮询语义(≥2 周期, 只读)
 *      + TaskDialog 新字段回填(打开即关, 零写入)
 * 纪律: 两个生产任务(番茄/霹雳, 动态发现)全程只读; 探针数据建后必删(finally 兜底);
 *       UI 全程写类请求拦截计数=0; 结束 browser close + process.exit(0/1)
 * 运行: bun scripts/verify-mm-a.ts
 */
export {}
import { chromium, type Page, type Browser, type Route } from 'playwright'

// 本脚本只用 Bun.serve 的最小切面(与 verify-gg-relay 同款局部 declare, 不引 bun-types)
declare const Bun: {
  serve(options: { port: number; fetch: (req: Request) => Response | Promise<Response> }): {
    port: number
    stop(closeActiveConnections?: boolean): void
  }
}

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:3000'

let pass = 0
let failCnt = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { failCnt++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
async function req(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, init)
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  return { status: res.status, json, text }
}
const post = (p: string, b: unknown) => req(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
const put = (p: string, b: unknown) => req(p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
const del = (p: string) => req(p, { method: 'DELETE' })

/** 本地 mock 源站(rules/test 端到端用, 随机空闲端口) */
let MOCK = ''
function startMock(): ReturnType<typeof Bun['serve']> {
  const html = `<!doctype html><html><body><ul id="list">
<li class="item"><a class="name" href="/book/1.html">书名甲</a><span class="au">作者甲</span></li>
<li class="item"><a class="name" href="/book/2.html">书名乙</a><span class="au">作者乙</span></li>
<li class="item"><a class="name" href="/book/3.html">书名丙</a><span class="au">作者丙</span></li>
</ul></body></html>`
  return Bun.serve({
    port: 0,
    fetch: () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  })
}

async function main() {
  /* ================= Part 1: API 域 ================= */

  /* ---------- A. themes API ↔ themes.ts 契约(pili 新主题) ---------- */
  console.log('\n== A. themes 注册表契约一致性 ==')
  {
    const t1 = await req('/api/admin/themes')
    const themes = t1.json?.data
    ok('A1 themes GET 信封 ok + 数组', t1.json?.ok === true && Array.isArray(themes), `n=${themes?.length}`)
    ok('A2 共 9 套主题', themes?.length === 9, `n=${themes?.length}`)
    const ids: string[] = themes.map((x: any) => x.id)
    ok('A3 id 集合含 pili 且无重复', ids.includes('pili') && new Set(ids).size === ids.length, ids.join(','))
    const pili = themes.find((x: any) => x.id === 'pili')
    ok('A4 pili layout/read.layout/headerStyle 三维度一致', !!pili &&
      pili.layout === 'pili' && pili.read?.layout === 'pili' && pili.vars?.headerStyle === 'pili',
      JSON.stringify({ layout: pili?.layout, read: pili?.read?.layout, hs: pili?.vars?.headerStyle }))
    ok('A5 pili 主橙 #fd8929 + preview 三色 + 亮色', pili?.vars?.primary === '#fd8929' &&
      Array.isArray(pili.preview) && pili.preview.length === 3 && pili.dark === false,
      JSON.stringify(pili?.preview))
    ok('A6 pili 阅读参数(toolbar bottom/measure 680/fontBase 18)', pili?.read?.toolbar === 'bottom' &&
      pili?.read?.measure === 680 && pili?.read?.fontBase === 18, JSON.stringify(pili?.read))
    const LAYOUTS = ['grid', 'list', 'shelf', 'magazine', 'minimal', 'theater', 'pili']
    const READS = ['classic', 'immersive', 'paginated', 'pili']
    const HEADERS = ['solid', 'gradient', 'transparent', 'split', 'centered', 'pili']
    ok('A7 全主题 layout/read.layout/headerStyle 枚举面合法(新枚举已入注册表)',
      themes.every((x: any) => LAYOUTS.includes(x.layout) && READS.includes(x.read?.layout) && HEADERS.includes(x.vars?.headerStyle)),
      themes.filter((x: any) => !LAYOUTS.includes(x.layout) || !READS.includes(x.read?.layout)).map((x: any) => x.id).join(','))
  }

  /* ---------- B. autoRefresh 全出口一致性 + 生产任务只读观测 ---------- */
  console.log('\n== B. autoRefresh/refreshIntervalMin 全出口一致性(生产任务只读) ==')
  let TOMATO = ''
  let PILI_TASK = ''
  {
    const list0 = await req('/api/admin/tasks')
    const rows = list0.json?.data || []
    const tomato = rows.find((t: any) => /番茄/.test(t?.name || ''))
    const pili = rows.find((t: any) => /霹雳/.test(t?.name || ''))
    TOMATO = tomato?.id || ''
    PILI_TASK = pili?.id || ''
    ok('B0 动态发现两个生产任务(番茄/霹雳)', !!tomato && !!pili, `${TOMATO}/${PILI_TASK}`)
    ok('B1 出口·列表: 番茄 autoRefresh=true/15min', tomato?.autoRefresh === true && tomato?.refreshIntervalMin === 15,
      `${tomato?.autoRefresh}/${tomato?.refreshIntervalMin}`)
    ok('B2 出口·列表: 霹雳 autoRefresh=false', pili?.autoRefresh === false, `${pili?.autoRefresh}`)
    const det = await req(`/api/admin/tasks/${TOMATO}`)
    ok('B3 出口·详情: 与列表一致', det.json?.data?.autoRefresh === true && det.json?.data?.refreshIntervalMin === 15)
    const stats = await req('/api/admin/stats')
    const rt = (stats.json?.data?.recentTasks || []).find((t: any) => t.id === TOMATO)
    ok('B4 出口·stats.recentTasks: 字段在位', !!rt && rt.autoRefresh === true && rt.refreshIntervalMin === 15)
    ok('B5 生产任务状态健康(番茄 running / 霹雳终态)', tomato?.status === 'running' && ['done', 'error', 'stopped'].includes(pili?.status),
      `${tomato?.status}/${pili?.status}`)
  }

  /* ---------- C. 探针任务: 白名单/钳制/联动/batch(建后必删) ---------- */
  console.log('\n== C. 探针任务白名单与钳制(上下界+1) ==')
  const TOMATO_RULE = 'cmtgi08kt0003qbu988jf36ch'
  let probeId = ''
  try {
    const bad1 = await post('/api/admin/tasks', { ruleId: TOMATO_RULE, mode: 'single', bookUrl: 'https://x.example/b' })
    ok('C1 POST 缺名称 → 400', bad1.status === 400)
    const bad2 = await post('/api/admin/tasks', { name: 'x', ruleId: 'bogusmma', mode: 'single', bookUrl: 'https://x.example/b' })
    ok('C2 POST 规则不存在 → 404', bad2.status === 404)
    const bad3 = await post('/api/admin/tasks', { name: 'x', ruleId: TOMATO_RULE, mode: 'single', bookUrl: '' })
    ok('C3 single 模式缺 bookUrl → 400', bad3.status === 400)
    const bad4 = await post('/api/admin/tasks', { name: 'x', ruleId: TOMATO_RULE, mode: 'range', listUrl: '' })
    ok('C4 range 模式缺 listUrl → 400', bad4.status === 400)

    const r1 = await post('/api/admin/tasks', {
      name: 'mm-a探针-即删', ruleId: TOMATO_RULE, mode: 'range',
      listUrl: 'https://invalid.mmaprobe.example/list_{page}.html',
      listStart: 0, listEnd: 100001, bookStart: -3, bookEnd: 200000,
      threadMin: 999, threadMax: 0, intervalMin: 999999, intervalMax: -1,
      autoRefresh: 'yes', refreshIntervalMin: 3,
    })
    ok('C5 探针任务创建成功', r1.json?.ok === true, JSON.stringify(r1.json).slice(0, 120))
    probeId = r1.json?.data?.id || ''
    const d = r1.json?.data || {}
    ok('C6 listStart 0 → 钳 1(下界+1 外)', d.listStart === 1, `got=${d.listStart}`)
    ok('C7 listEnd 100001 → 钳 100000(上界+1 外)', d.listEnd === 100000, `got=${d.listEnd}`)
    ok('C8 bookStart -3 → 钳 0', d.bookStart === 0, `got=${d.bookStart}`)
    ok('C9 bookEnd 200000 → 钳 100000', d.bookEnd === 100000, `got=${d.bookEnd}`)
    ok('C10 threadMin 999 → 钳 32', d.threadMin === 32, `got=${d.threadMin}`)
    ok('C11 threadMax 0 → 钳 1(且 min≤max 提升到 32)', d.threadMax === 32, `got=${d.threadMax}`)
    ok('C12 intervalMin 999999 → 钳 600000', d.intervalMin === 600000, `got=${d.intervalMin}`)
    ok('C13 intervalMax -1 → 钳 0(且提升到 600000)', d.intervalMax === 600000, `got=${d.intervalMax}`)
    ok('C14 autoRefresh "yes" → 严格 false', d.autoRefresh === false, `got=${JSON.stringify(d.autoRefresh)}`)
    ok('C15 refreshIntervalMin 3 → 钳 5', d.refreshIntervalMin === 5, `got=${d.refreshIntervalMin}`)

    // PUT partial: intervalMin 抬升 → intervalMax 联动不低于 min(合并生效值)
    const p0 = await put(`/api/admin/tasks/${probeId}`, { intervalMin: 500, intervalMax: 1000 })
    ok('C16a PUT interval 500/1000 显式生效', p0.json?.data?.intervalMin === 500 && p0.json?.data?.intervalMax === 1000,
      `${p0.json?.data?.intervalMin}/${p0.json?.data?.intervalMax}`)
    const p1 = await put(`/api/admin/tasks/${probeId}`, { intervalMin: 5000 })
    ok('C16b PUT 仅抬 intervalMin 5000 → intervalMax 联动 5000(合并后 max<min 提升)', p1.json?.data?.intervalMin === 5000 && p1.json?.data?.intervalMax === 5000,
      `${p1.json?.data?.intervalMin}/${p1.json?.data?.intervalMax}`)
    // PUT 联动校验: range→single 但不带 bookUrl → 400
    const p2 = await put(`/api/admin/tasks/${probeId}`, { mode: 'single' })
    ok('C17 PUT mode=single 缺 bookUrl → 400', p2.status === 400, `status=${p2.status}`)
    // PUT 名称空 → 400
    const p3 = await put(`/api/admin/tasks/${probeId}`, { name: '   ' })
    ok('C18 PUT 空名称 → 400', p3.status === 400)
    // PUT status 不在白名单(状态机只走 control)
    const p4 = await put(`/api/admin/tasks/${probeId}`, { status: 'running' })
    ok('C19 PUT status 被白名单拒(仍 pending)', p4.json?.ok === true && p4.json?.data?.status === 'pending', `got=${p4.json?.data?.status}`)
    // PUT fetchConfig 过大 → 400
    const p5 = await put(`/api/admin/tasks/${probeId}`, { fetchConfig: 'x'.repeat(50_001) })
    ok('C20 PUT fetchConfig >50KB → 400', p5.status === 400, `status=${p5.status}`)
    // refreshIntervalMin 钳上界
    const p6 = await put(`/api/admin/tasks/${probeId}`, { refreshIntervalMin: 99999, autoRefresh: true })
    ok('C21 PUT interval 99999 → 1440 + autoRefresh true', p6.json?.data?.refreshIntervalMin === 1440 && p6.json?.data?.autoRefresh === true,
      `${p6.json?.data?.refreshIntervalMin}/${p6.json?.data?.autoRefresh}`)

    console.log('\n== C2. tasks/batch 语义 ==')
    const b1 = await post('/api/admin/tasks/batch', { action: 'nope', ids: ['x'] })
    ok('C22 batch 非法 action → 400', b1.status === 400)
    const b2 = await post('/api/admin/tasks/batch', { action: 'delete' })
    ok('C23 batch 缺 ids → 400', b2.status === 400)
    const b3 = await post('/api/admin/tasks/batch', { action: 'delete', ids: Array.from({ length: 501 }, (_, i) => `id${i}`) })
    ok('C24 batch >500 ids → 400', b3.status === 400, `status=${b3.status}`)
    const b4 = await post('/api/admin/tasks/batch', { action: 'delete', ids: ['bogusmma1', 'bogusmma2'] })
    ok('C25 batch delete bogus → affected=0 skipped=2', b4.json?.ok === true && b4.json?.data?.affected === 0 && b4.json?.data?.skipped?.length === 2)
    // batch stop 对未运行探针幂等(control stop 同步置 stopped, 不启动采集循环 — 确定性安全)
    const b5 = await post('/api/admin/tasks/batch', { action: 'stop', ids: [probeId] })
    ok('C26 batch stop 未运行探针 → affected=1(幂等)', b5.json?.data?.affected === 1, JSON.stringify(b5.json?.data).slice(0, 120))
    // batch delete 探针(已 stopped, 非运行中 → 可删)
    const b6 = await post('/api/admin/tasks/batch', { action: 'delete', ids: [probeId] })
    ok('C27 batch delete 探针 → affected=1', b6.json?.data?.affected === 1, JSON.stringify(b6.json?.data).slice(0, 120))
    probeId = '' // 已删, finally 兜底跳过
    const gone = await req(`/api/admin/tasks/${probeId || 'mm-a探针'}`)
    ok('C28 探针已不在(gone 404)', gone.status === 404 || gone.json?.ok === false, `status=${gone.status}`)
  } finally {
    if (probeId) {
      await post(`/api/admin/tasks/${probeId}/control`, { action: 'stop' }).catch(() => {})
      await new Promise((r) => setTimeout(r, 1000))
      const dd = await del(`/api/admin/tasks/${probeId}`)
      ok('C-finally 探针任务已删(净 DB 变更=0)', dd.json?.ok === true, `status=${dd.status}`)
    }
  }

  /* ---------- D. rules(+test): regex 门 / fetchMode 白名单 / mock 端到端 ---------- */
  console.log('\n== D. rules 与 rules/test(fetchMode 出口) ==')
  const mockServer = startMock()
  MOCK = `http://127.0.0.1:${mockServer.port}`
  let probeRule = ''
  try {
    // regex 门: 灾难嵌套量词 400
    const g1 = await post('/api/admin/rules', {
      name: 'mm-a探针规则-即删',
      config: { list: { enabled: true, fields: { f: { type: 'regex', expression: '(a+)+$', attr: 'text' } } } },
    })
    ok('D1 regex 门: 灾难嵌套量词 → 400 拒绝', g1.status === 400 && /拒绝保存/.test(g1.json?.message || ''), JSON.stringify(g1.json).slice(0, 140))
    // 非法正则(编译失败) 400
    const g2 = await post('/api/admin/rules', {
      name: 'mm-a探针规则-即删',
      config: { list: { enabled: true, fields: { f: { type: 'regex', expression: '([', attr: 'text' } } } },
    })
    ok('D2 regex 门: 非法正则 → 400', g2.status === 400)
    // 合法配置创建(带 fetchMode/scraplingBridgeUrl 白名单出口面)
    const g3 = await post('/api/admin/rules', {
      name: 'mm-a探针规则-即删',
      config: {
        list: { enabled: true, itemSelector: { type: 'css', expression: 'ul li.item', attr: 'html' }, fields: {
          name: { type: 'css', expression: 'a.name', attr: 'text' },
          url: { type: 'css', expression: 'a.name', attr: 'href' },
        } },
        fetch: { fetchMode: 'scrapling-static', scraplingBridgeUrl: 'http://127.0.0.1:3012' },
      },
    })
    ok('D3 探针规则创建成功', g3.json?.ok === true, JSON.stringify(g3.json).slice(0, 120))
    probeRule = g3.json?.data?.id || ''
    ok('D4 规则回读 config 含 fetchMode(存储原样)', String(g3.json?.data?.config || '').includes('scrapling-static'))

    // rules/test: 入参校验
    const t1 = await post('/api/admin/rules/test', { section: 'bogus', url: 'https://x.example', rule: {} })
    ok('D5 test 非法 section → 400', t1.status === 400)
    const t2 = await post('/api/admin/rules/test', { section: 'list', url: '', rule: {} })
    ok('D6 test 缺 URL → 400', t2.status === 400)
    const t3 = await post('/api/admin/rules/test', { section: 'list', url: 'ftp://x.example', rule: {} })
    ok('D7 test ftp URL → 400', t3.status === 400)
    const t4 = await post('/api/admin/rules/test', { section: 'list', url: `${MOCK}/list.html`, rule: 'notanobject' })
    ok('D8 test 规则非法 → 400', t4.status === 400)

    // rules/test 端到端(mock 源站): fetchMode=scrapling-static + 桥不可达 → 降级 native → 解析 3 项
    const t5 = await post('/api/admin/rules/test', {
      section: 'list', url: `${MOCK}/list.html`,
      rule: { enabled: true, itemSelector: { type: 'css', expression: 'ul li.item', attr: 'html' }, fields: {
        name: { type: 'css', expression: 'a.name', attr: 'text' },
        url: { type: 'css', expression: 'a.name', attr: 'href' },
      } },
      fetch: { fetchMode: 'scrapling-static', engine: 'http' },
      limit: 2,
    })
    ok('D9 test 端到端(fetchMode scrapling-* 桥不可达降级 native) → ok', t5.json?.ok === true, JSON.stringify(t5.json).slice(0, 160))
    ok('D10 解析 3 项 + sample 钳 limit=2', t5.json?.data?.count === 3 && t5.json?.data?.sample?.length === 2,
      `count=${t5.json?.data?.count} sample=${t5.json?.data?.sample?.length}`)
    ok('D11 样本字段 name/url 绝对化', t5.json?.data?.sample?.[0]?.name === '书名甲' &&
      /^http:\/\/127\.0\.0\.1:\d+\/book\/1\.html$/.test(t5.json?.data?.sample?.[0]?.url || ''),
      JSON.stringify(t5.json?.data?.sample?.[0]))

    // rules/test 端到端: book 段 + content 段(mock 单页)
    const t6 = await post('/api/admin/rules/test', {
      section: 'book', url: `${MOCK}/book/1.html`,
      rule: { enabled: true, fields: { name: { type: 'css', expression: 'a.name', attr: 'text' } } },
      fetch: { engine: 'http' },
    })
    ok('D12 test book 段 → fields.name', t6.json?.ok === true && t6.json?.data?.fields?.name === '书名甲', JSON.stringify(t6.json?.data?.fields))

    // PUT 探针规则: 改名 + fetchMode 非法值运行时面(存储原样, 消毒在解析层)
    const g4 = await put(`/api/admin/rules/${probeRule}`, { name: 'mm-a探针规则-即删2', enabled: false })
    ok('D13 PUT 规则改名/停用 ok', g4.json?.ok === true && g4.json?.data?.enabled === false)
    const g5 = await put(`/api/admin/rules/${probeRule}`, { config: 12345 })
    ok('D14 PUT config 类型非法 → 400', g5.status === 400)
    const g6 = await del(`/api/admin/rules/${probeRule}`)
    ok('D15 探针规则已删', g6.json?.ok === true)
    probeRule = ''
    const g7 = await req('/api/admin/rules/bogusmma')
    ok('D16 规则不存在 → 404', g7.status === 404)
    const g8 = await post('/api/admin/rules/batch', { action: 'delete', ids: ['bogusmma'] })
    ok('D17 rules/batch delete bogus → affected=0', g8.json?.data?.affected === 0)
    const g9 = await put('/api/admin/rules/bogusmma', { name: 'x' })
    ok('D18 PUT 规则不存在 → 404', g9.status === 404)
  } finally {
    if (probeRule) { await del(`/api/admin/rules/${probeRule}`).catch(() => {}) }
    mockServer.stop(true)
  }

  /* ---------- E. books/sites/links/categories/settings/downloads/chapters/stats ---------- */
  console.log('\n== E. 其余 admin 资源信封与边界 ==')
  let probeBook = ''
  let probeSite = ''
  let probeLink = ''
  let probeCat = ''
  try {
    // books
    const bk1 = await req('/api/admin/books?page=0&size=999')
    ok('E1 books page 0→1 / size 999→50', bk1.json?.data?.page === 1 && bk1.json?.data?.size === 50, `${bk1.json?.data?.page}/${bk1.json?.data?.size}`)
    const bk2 = await post('/api/admin/books', { name: '' })
    ok('E2 books POST 空名 → 400', bk2.status === 400)
    const bk3 = await post('/api/admin/books', { name: 'mm-a探针书-即删', status: 'bogus' })
    ok('E3 books POST 非法状态 → 白名单兜底 unknown', bk3.json?.ok === true && bk3.json?.data?.status === 'unknown', `got=${bk3.json?.data?.status}`)
    probeBook = bk3.json?.data?.id || ''
    const bk4 = await put(`/api/admin/books/${probeBook}`, { status: 'bogus' })
    ok('E4 books PUT 非法状态 → 400', bk4.status === 400)
    const bk5 = await put(`/api/admin/books/${probeBook}`, { sourceUrl: 'ftp://x.example' })
    ok('E5 books PUT ftp sourceUrl → 400', bk5.status === 400)
    const bk6 = await put(`/api/admin/books/${probeBook}`, { categoryId: 'bogusmma' })
    ok('E6 books PUT 分类不存在 → 404', bk6.status === 404)
    const bk7 = await req(`/api/admin/books/${probeBook}/toc`)
    ok('E7 books toc 信封 ok total=0', bk7.json?.ok === true && bk7.json?.data?.total === 0)
    const bk8 = await post('/api/admin/downloads', { bookId: probeBook })
    ok('E8 downloads POST 0 章书 → 400(校验先于并发占位)', bk8.status === 400, `status=${bk8.status} msg=${bk8.json?.message}`)
    const bk9 = await req('/api/admin/books/bogusmma')
    ok('E9 book 不存在 → 404', bk9.status === 404)
    const bk10 = await req('/api/admin/books/bogusmma/toc')
    ok('E10 toc 书不存在 → 404', bk10.status === 404)

    // chapters: 真实章节只读 + 超限写入 400(先于任何写)
    const anyBook = (await req('/api/admin/books?page=1&size=1')).json?.data?.books?.[0]
    const tocRow = anyBook ? (await req(`/api/admin/books/${anyBook.id}/toc?page=1&size=1`)).json?.data?.chapters?.[0] : null
    if (tocRow) {
      const ch1 = await req(`/api/admin/chapters/${tocRow.id}`)
      ok('E11 章节详情信封 ok(真实数据只读)', ch1.json?.ok === true && typeof ch1.json?.data?.title === 'string')
      const ch2 = await put(`/api/admin/chapters/${tocRow.id}`, { content: 'x'.repeat(500_001) })
      ok('E12 章节正文超限 → 400(未写入)', ch2.status === 400, `status=${ch2.status}`)
      const ch3 = await req('/api/admin/chapters/bogusmma')
      ok('E13 章节不存在 → 404', ch3.status === 404)
    } else {
      ok('E11 章节详情信封 ok(无章节数据, 跳过)', true)
    }
    const chb1 = await post('/api/admin/chapters/batch', { action: 'bogus', ids: ['x'] })
    ok('E14 chapters/batch 非法 action → 400', chb1.status === 400)
    const chb2 = await post('/api/admin/chapters/batch', { action: 'markUnfetched', ids: ['bogusmma'] })
    ok('E15 chapters/batch bogus id → affected=0 skipped=1', chb2.json?.data?.affected === 0 && chb2.json?.data?.skipped?.length === 1)

    // sites
    const st1 = await post('/api/admin/sites', { name: 'mm-a探针站-即删', domain: '非法 domain!', themeId: 'bogus' })
    ok('E16 sites POST 非法域名 → 400', st1.status === 400)
    const st2 = await post('/api/admin/sites', { name: 'mm-a探针站-即删', domain: 'mma-probe.example', themeId: 'bogus', offset: -5 })
    ok('E17 sites POST 非法主题兜底 aurora + 创建 ok', st2.json?.ok === true && st2.json?.data?.themeId === 'aurora', JSON.stringify(st2.json?.data?.themeId))
    probeSite = st2.json?.data?.id || ''
    const st3 = await put(`/api/admin/sites/${probeSite}`, { themeId: 'pili', offset: -5, status: false })
    ok('E18 sites PUT themeId=pili(注册表新主题被接受) + offset 钳 0', st3.json?.data?.themeId === 'pili' && st3.json?.data?.offset === 0,
      `${st3.json?.data?.themeId}/${st3.json?.data?.offset}`)
    const st4 = await put(`/api/admin/sites/${probeSite}`, { themeId: 'bogusmma' })
    ok('E19 sites PUT 未知主题 → 400', st4.status === 400)
    const st5 = await put(`/api/admin/sites/${probeSite}`, { domain: 'BAD_DOMAIN' })
    ok('E20 sites PUT 非法域名 → 400', st5.status === 400)
    const st6 = await post('/api/admin/sites/batch', { action: 'theme', ids: [probeSite], payload: { themeId: 'pili' } })
    ok('E21 sites/batch theme pili → affected=1', st6.json?.data?.affected === 1)
    const st7 = await post('/api/admin/sites/batch', { action: 'wheel', ids: [probeSite], payload: { inLinkWheel: false } })
    ok('E22 sites/batch wheel → affected=1', st7.json?.data?.affected === 1)

    // links
    const lk1 = await post('/api/admin/links', { name: 'mm-a探针链-即删', url: 'mma-link.example' })
    ok('E23 links POST 无 scheme 自动补 https', lk1.json?.ok === true && lk1.json?.data?.url === 'https://mma-link.example/', JSON.stringify(lk1.json?.data?.url))
    probeLink = lk1.json?.data?.id || ''
    const lk2 = await post('/api/admin/links', { name: 'x', url: 'https://a.example', logo: '//proto.example/x.png' })
    ok('E24 links POST // logo → 400', lk2.status === 400)
    const lk3 = await post('/api/admin/links/batch', { ids: [probeLink], action: 'disable' })
    ok('E25 links/batch disable → affected=1', lk3.json?.data?.affected === 1)
    const lk4 = await post('/api/admin/links/batch', { ids: [probeLink], action: 'enable' })
    ok('E26 links/batch enable → affected=1', lk4.json?.data?.affected === 1)
    const lk5 = await post('/api/admin/links/batch', { ids: [probeLink], action: 'nope' })
    ok('E27 links/batch 非法 action → 400', lk5.status === 400)

    // categories
    const ct1 = await post('/api/admin/categories', { name: 'mm-a探针分类-即删' })
    ok('E28 categories POST 创建 ok', ct1.json?.ok === true)
    probeCat = ct1.json?.data?.id || ''
    const ct2 = await post('/api/admin/categories', { name: 'mm-a探针分类-即删' })
    ok('E29 categories POST 同名 upsert 幂等(同一行)', ct2.json?.data?.id === probeCat)
    const ct3 = await post('/api/admin/categories/batch', { action: 'order', ids: [probeCat] })
    ok('E30 categories/batch order → affected=1', ct3.json?.data?.affected === 1)

    // settings(保存→写→还原, 净变更=0)
    const se0 = await req('/api/admin/settings')
    const origDownload = se0.json?.data?.download
    const se1 = await put('/api/admin/settings', { download: { siteName: 'mm-a临时', siteUrl: 'https://mma.example' } })
    ok('E31 settings PUT ok', se1.json?.ok === true)
    const se2 = await req('/api/admin/settings')
    ok('E32 settings 写后可读回', se2.json?.data?.download?.siteName === 'mm-a临时')
    await put('/api/admin/settings', { download: origDownload ?? null })
    const se3 = await req('/api/admin/settings')
    ok('E33 settings 还原(净变更=0)', JSON.stringify(se3.json?.data?.download) === JSON.stringify(origDownload ?? null),
      `${JSON.stringify(se3.json?.data?.download).slice(0, 80)}`)

    // stats / downloads / 404 兜底
    const stats2 = await req('/api/admin/stats')
    ok('E34 stats 信封键齐全', ['books', 'chapters', 'rules', 'tasks', 'sites', 'tags', 'downloads', 'totalWords', 'recentTasks', 'recentBooks', 'categories']
      .every((k) => k in (stats2.json?.data || {})))
    const dl1 = await post('/api/admin/downloads', { bookId: '' })
    ok('E35 downloads POST 缺 bookId → 400', dl1.status === 400)
    const dl2 = await post('/api/admin/downloads', { bookId: 'bogusmma' })
    ok('E36 downloads POST 书不存在 → 404', dl2.status === 404)
    const dl3 = await req('/api/admin/downloads/bogusmma')
    ok('E37 download 详情不存在 → 404', dl3.status === 404)
    const dlb1 = await post('/api/admin/downloads/batch', { action: 'retry', ids: ['bogusmma'] })
    ok('E38 downloads/batch retry bogus → skipped=1', dlb1.json?.data?.skipped?.length === 1)
  } finally {
    // 探针清理(全部删净 → 净 DB 变更=0)
    if (probeBook) { const r = await del(`/api/admin/books/${probeBook}`); ok('E-finally 探针书已删', r.json?.ok === true) }
    if (probeSite) { const r = await del(`/api/admin/sites/${probeSite}`); ok('E-finally 探针站已删', r.json?.ok === true) }
    if (probeLink) { const r = await del(`/api/admin/links?id=${probeLink}`); ok('E-finally 探针链已删', r.json?.ok === true) }
    if (probeCat) { const r = await del(`/api/admin/categories/${probeCat}`); ok('E-finally 探针分类已删', r.json?.ok === true) }
    const cats = await req('/api/admin/categories')
    const residual = (cats.json?.data || []).filter((c: any) => /mm-a探针/.test(c.name || ''))
    ok('E-finally 分类无残留(净 DB=0)', residual.length === 0, residual.map((c: any) => c.id).join(','))
  }

  /* ================= Part 2: 管理 UI 域(playwright) ================= */
  console.log('\n== F. 管理 UI 域(逐 Section 0 报错 + 深审点) ==')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const stat = { pe: 0, ce: 0, msgs: [] as string[], bad: [] as string[], writes: 0 }
    page.on('pageerror', (e) => { stat.pe++; stat.msgs.push(`pageerror: ${String(e).slice(0, 140)}`) })
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      if (m.text().startsWith('Failed to load resource')) return
      stat.ce++; stat.msgs.push(`console: ${m.text().slice(0, 140)}`)
    })
    page.on('response', (r) => { if (r.status() >= 400) stat.bad.push(`${r.status()} ${r.url()}`) })
    // 写安全网: 管理 API 非 GET 一律拦截计数(兜底防误触写库; 断言 0)
    void page.route((u) => u.pathname.startsWith('/api/admin/'), async (route: Route) => {
      if (route.request().method() !== 'GET') { stat.writes++; await route.abort() } else await route.fallback()
    })

    await page.goto(`${BASE}/?admin=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    // F1 仪表盘
    ok('F1 仪表盘 0 pageerror/0 console error', stat.pe === 0 && stat.ce === 0, stat.msgs.slice(0, 2).join(';'))

    // F2 规则 Section + RuleEditor 对话框宽度(深审点: max-w-in(…) 断链)
    await page.getByRole('button', { name: '采集规则' }).first().click()
    await page.waitForTimeout(1200)
    const editBtn = page.getByRole('button', { name: '编辑' }).first()
    await editBtn.click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForTimeout(600)
    const maxWidth = await dialog.evaluate((el) => getComputedStyle(el).maxWidth)
    ok('F2 RuleEditor 对话框 max-width=1100px(1440 视口, sm:min(1100,96vw))', maxWidth === '1100px', `got=${maxWidth}`)
    // F3 前先切到「反反爬设置」页签(forceMount 下非激活面板 display:none, 需先激活)并展开「高级选项」
    await dialog.getByRole('tab', { name: '反反爬设置' }).click()
    await page.waitForTimeout(400)
    await dialog.getByRole('button', { name: /高级选项/ }).click()
    await page.waitForTimeout(400)
    ok('F3 RuleEditor fetchMode 下拉在位(scrapling 三模式)', (await dialog.locator('#adv-fetchmode').count()) === 1)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    ok('F4 规则 Section 0 报错', stat.pe === 0 && stat.ce === 0, stat.msgs.slice(0, 2).join(';'))

    // F5 任务 Section + TaskMonitor(生产任务只读观测, 等 ≥2 个 2s 轮询周期)
    await page.getByRole('button', { name: '采集任务' }).first().click()
    await page.waitForTimeout(1200)
    const tomatoRow = page.locator('tr', { hasText: '番茄' }).first()
    ok('F5 任务列表含番茄行', (await tomatoRow.count()) === 1)
    // TaskDialog 新字段回填(打开→断言→取消, 零写入)
    await tomatoRow.getByTitle('编辑').click()
    const taskDialog = page.getByRole('dialog')
    await taskDialog.waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForTimeout(500)
    const taskMaxWidth = await taskDialog.evaluate((el) => getComputedStyle(el).maxWidth)
    ok('F6-a TaskDialog 对话框宽度 720px(sm:max-w-[min(720px,96vw)] 不被 sm:max-w-lg 压回)', taskMaxWidth === '720px', `got=${taskMaxWidth}`)
    const sw = taskDialog.locator('button[role="switch"][aria-label="自动刷新开关"]')
    const swChecked = await sw.first().getAttribute('aria-checked')
    const intervalVal = await taskDialog.locator('input[aria-label="自动刷新间隔分钟数"]').inputValue()
    ok('F6 TaskDialog 新字段回填(autoRefresh 勾选态 + 间隔 15)', swChecked === 'true' && intervalVal === '15', `${swChecked}/${intervalVal}`)
    await taskDialog.getByRole('button', { name: '取消' }).click()
    await page.waitForTimeout(400)
    // TaskMonitor
    await tomatoRow.getByTitle('监控').click()
    await page.waitForTimeout(5200) // ≥2 个 2s 轮询周期(历史误报教训)
    const bodyText = await page.locator('body').innerText()
    ok('F7 TaskMonitor 状态徽标「运行中」(2s 轮询语义)', /运行中/.test(bodyText))
    ok('F8 TaskMonitor 自动刷新徽标「每 15 分钟」', /自动刷新:\s*每\s*15\s*分钟/.test(bodyText), bodyText.match(/自动刷新[^\n]*/)?.[0]?.slice(0, 40))
    const logCount = Number(bodyText.match(/共 (\d+) 条/)?.[1] || '0')
    ok('F9 TaskMonitor 实时日志增量回填(条数>0)', logCount > 0, `logs=${logCount}`)
    ok('F10 TaskMonitor 进度卡在位', /运行进度/.test(bodyText) && /章节正文/.test(bodyText))
    await page.getByRole('button', { name: '返回列表' }).click()
    await page.waitForTimeout(600)

    // F11-F17 其余 Section 逐页 0 报错
    for (const [label, tag] of [['书籍管理', 'F11'], ['分类管理', 'F12'], ['站群系统', 'F13'], ['友链链轮', 'F14'], ['主题模板', 'F15'], ['TXT下载', 'F16'], ['系统设置', 'F17']] as const) {
      await page.getByRole('button', { name: label }).first().click()
      await page.waitForTimeout(1100)
      const t = await page.locator('body').innerText()
      ok(`${tag} ${label} 0 pageerror/0 console error`, stat.pe === 0 && stat.ce === 0, stat.msgs.slice(0, 2).join(';'))
      if (label === '主题模板') {
        ok(`${tag}-a pili 卡自动出现(霹雳书屋 + 书屋版徽标)`, /霹雳书屋/.test(t) && /书屋版/.test(t) && /共 9 套/.test(t))
      }
      if (label === 'TXT下载') {
        ok(`${tag}-a 下载区块渲染(生成任务表)`, /生成任务/.test(t))
      }
    }
    ok('F18 UI 写安全网: 管理 API 零写请求', stat.writes === 0, `writes=${stat.writes}`)
    ok('F19 UI 全程无 ≥400 响应(除封面数据态)', stat.bad.every((u) => u.includes('/api/public/cover')), stat.bad.slice(0, 2).join(';'))
  } finally {
    await browser.close()
  }

  console.log('\n==========')
  console.log(`PASS ${pass} / FAIL ${failCnt}`)
  if (failCnt) { console.log('FAILURES:'); for (const f of failures) console.log('  - ' + f); process.exit(1) }
  process.exit(0)
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(1) })
