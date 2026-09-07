// ============================================================
// Task dd-a2 验证脚本② — 真站回归(证明代理池引擎改动零回归)
// 经 dev server /api/admin/rules/test(POST, server 侧引擎), 传已展开 URL
// (规避 {page} 占位符被 new URL() 编码成 %7Bpage%7D 的历史坑, cc-b 教训)
// 站点与基线(与代理池改动前既有口径一致):
//   1) biquge.tw 四段: list 21本 / toc 1869章 / content raw≈3681 (cc-c2 基线)
//   2) shudugu list(10本) + content(数千字) (cc-b 基线)
//   3) dafengdagengren list(~299本)
// 运行: bun scripts/regress-dd-a2-sites.ts (需 dev server 3000 存活; 全程串行+同host间隔)
// ============================================================
export {}

const BASE = 'http://localhost:3000'
let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface TestResp {
  ok: boolean
  message?: string
  data?: {
    engine?: string
    count?: number
    pages?: number
    ms?: number
    rawLength?: number
    cleanedLength?: number
    fields?: Record<string, string>
    sample?: Record<string, string>[]
    cleanedText?: string
  }
}

async function testSection(section: string, url: string, rule: unknown, fetchCfg: unknown, clean?: unknown, limit = 30): Promise<NonNullable<TestResp['data']>> {
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, url, rule, fetch: fetchCfg, clean, limit }),
  })
  const j = (await res.json()) as TestResp
  console.log(`  [${section}] HTTP ${res.status} ${j.data?.ms ?? '?'}ms: ${JSON.stringify(j.data ?? j.message).slice(0, 160)}`)
  if (!res.ok || !j.ok || !j.data) throw new Error(`${section} 段测试失败: ${j.message || res.status}`)
  return j.data
}

interface RuleRow { id: string; name: string; config: string }
async function loadRule(idOrName: string): Promise<{ config: ReturnType<typeof JSON.parse> } & RuleRow> {
  const lr = await fetch(`${BASE}/api/admin/rules?take=100`).then((r) => r.json()) as { ok: boolean; data?: unknown }
  const rules: RuleRow[] = Array.isArray(lr.data) ? lr.data as RuleRow[] : ((lr.data as { rules?: RuleRow[] })?.rules || [])
  // dd-c: 规则改版重入库后 id 会变, 支持 name 兜底查找(id 优先)
  const r = rules.find((x) => x.id === idOrName) ?? rules.find((x) => x.name.includes(idOrName))
  if (!r) throw new Error(`规则缺失 id=${idOrName}`)
  return { ...r, config: JSON.parse(r.config) }
}

async function main() {
  // ---------- 1) biquge.tw 四段 ----------
  console.log(`\n== 1) biquge.tw 四段(基线 list 21本 / toc 1869章 / content raw≈3681, 基准书=异界龙神 /book/9002.html) ==`)
  const bq = await loadRule('cmtfsu6gk00k1owhdxfdjslmy')
  const list = await testSection('list', 'https://www.biquge.tw/sort/1.html', bq.config.list, bq.config.fetch, undefined, 40)
  ok('1a biquge list 同量级(基线21, ≥12 过线)', (list.count ?? 0) >= 12, `实际 ${list.count} 本`)
  const bookUrl = 'https://www.biquge.tw/book/9002.html' // 基线书异界龙神(cc-c2 同书, 列表页样本书会变动不作基准)
  ok('1b list 样本含 bookUrl 且为绝对地址', /^https?:\/\//.test((list.sample || [])[0]?.bookUrl || ''), `样本0: ${(list.sample || [])[0]?.name} → ${(list.sample || [])[0]?.bookUrl}`)
  await sleep(900)
  const book = await testSection('book', bookUrl, bq.config.book, bq.config.fetch)
  ok('1c biquge book 段书名+作者非空', !!book.fields?.name && !!book.fields?.author, `${book.fields?.name}·${book.fields?.author}`)
  await sleep(900)
  const toc = await testSection('toc', bookUrl, bq.config.toc, bq.config.fetch, undefined, 200)
  ok('1d biquge toc 同量级(基线1869, ≥1200 过线)', (toc.count ?? 0) >= 1200, `实际 ${toc.count} 章`)
  const firstCh = (toc.sample || [])[0]?.url || ''
  ok('1e toc 样本含章节 URL', /^https?:\/\//.test(firstCh), firstCh)
  await sleep(900)
  const content = await testSection('content', firstCh, bq.config.content, bq.config.fetch, bq.config.clean)
  ok('1f biquge content raw 同量级(基线≈3681, ≥2000 过线)', (content.rawLength ?? 0) >= 2000, `raw=${content.rawLength} clean=${content.cleanedLength}`)
  ok('1g content 清洗后无截断异常(clean ≥ 1000)', (content.cleanedLength ?? 0) >= 1000, `clean=${content.cleanedLength}`)

  // ---------- 2) shudugu list + content ----------
  console.log(`\n== 2) shudugu.org list(基线10本) + content(基线数千字) ==`)
  const sdg = await loadRule('cmtgjm5gn04hmqbu96c6j06u5')
  const sList = await testSection('list', 'https://www.shudugu.org/xuanhuan/1.html', sdg.config.list, sdg.config.fetch, undefined, 30)
  ok('2a shudugu list 同量级(基线10, ≥5 过线)', (sList.count ?? 0) >= 5, `实际 ${sList.count} 本`)
  const sBook = (sList.sample || [])[0]?.bookUrl || ''
  ok('2b shudugu list 样本 bookUrl 绝对地址', /^https?:\/\//.test(sBook), sBook)
  await sleep(900)
  const sToc = await testSection('toc', sBook, sdg.config.toc, sdg.config.fetch, undefined, 10)
  const sCh = (sToc.sample || [])[0]?.url || ''
  ok('2c shudugu toc 嗅探出章节(采到章节URL)', /^https?:\/\//.test(sCh), `${sToc.count ?? '?'} 章, 首章 ${sCh}`)
  await sleep(900)
  const sContent = await testSection('content', sCh, sdg.config.content, sdg.config.fetch, sdg.config.clean)
  ok('2d shudugu content raw 数千字级(≥2000 过线)', (sContent.rawLength ?? 0) >= 2000, `raw=${sContent.rawLength} clean=${sContent.cleanedLength}`)

  // ---------- 3) dafengdagengren list ----------
  console.log(`\n== 3) dafengdagengren.com list(dd-c 改版后: 分类页 30本/页, ≥10 过线) ==`)
  const df = await loadRule('dafeng')
  const dList = await testSection('list', 'https://www.dafengdagengren.com/xuanhuanxiaoshuo/', df.config.list, df.config.fetch, undefined, 400)
  ok('3a dafeng list(dd-c 新基线 ≥10 过线)', (dList.count ?? 0) >= 10, `实际 ${dList.count} 本`)

  console.log(`\n========================================`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error('regress 脚本异常:', (e as Error)?.message || e)
  process.exit(1)
})
