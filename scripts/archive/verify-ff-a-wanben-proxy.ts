// ============================================================
// ff-a/A1 — wanbenshenzhan.com(完本神站) 四段实测(公共代理出口)
// 前置: probe-ff-a-wanben-proxy.ts 第2轮发现公共代理 http://103.150.152.27:83
//   可绕过 GoEdge IP 拒绝(首页 200 双栈复验: bun fetch + curl -x, 标题"完本神站"),
//   列表页 200 结构与规则选择器吻合(td.book-name>a href="/数字id/")。
// 过线标准: list≥10本 / book 全字段 name+author+intro / toc≥50章 / content 清洗后≥2000字符
// 披露: ①proxyUrl 仅注入测试 fetch 配置, 不落规则本体(公共代理易逝, 落库必腐)
//       ②toc 段测试把 pagination.maxPages 20→2(90s 测试护栏 × 慢代理 ~8s/页, 全 20 页必超时;
//         选择器/翻页链仍被 2 页链路验证)
// 运行: bun scripts/verify-ff-a-wanben-proxy.ts
// ============================================================
export {}

const BASE = 'http://localhost:3000'
const RULE_ID = 'cmthf0hne08gbnktx1wnobuo5' // 完本神站 (wanbenshenzhan.com) — 实查确认
const PROXY = 'http://103.150.152.27:83'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Envelope { ok: boolean; message?: string; data?: any }

async function api<T = Envelope>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return (await res.json()) as T
}

async function loadRule(): Promise<Record<string, any>> {
  const r = await api<{ ok: boolean; data?: any }>(`/api/admin/rules/${RULE_ID}`)
  if (!r.ok || !r.data) throw new Error('规则加载失败')
  return JSON.parse(r.data.config)
}

async function testSection(section: string, url: string, ruleSection: unknown, fetchCfg: Record<string, any>): Promise<Record<string, any> | null> {
  const res = await api<Envelope>('/api/admin/rules/test', {
    method: 'POST',
    body: JSON.stringify({ section, url, rule: ruleSection, fetch: fetchCfg, clean: CLEAN }),
  })
  if (!res.ok) {
    console.log(`  [${section}] ❌ ${res.message}`)
    return null
  }
  const d = res.data as Record<string, any>
  if (section === 'list') console.log(`  [list] ✅ engine=${d.engine} count=${d.count} ${d.ms}ms`)
  else if (section === 'book') console.log(`  [book] ✅ engine=${d.engine} ${d.ms}ms fields=${JSON.stringify(d.fields)}`)
  else if (section === 'toc') console.log(`  [toc] ✅ engine=${d.engine} count=${d.count} pages=${d.pages} ${d.ms}ms`)
  else console.log(`  [content] ✅ engine=${d.engine} pages=${d.pages} raw=${d.rawLength} clean=${d.cleanedLength} ${d.ms}ms`)
  return d
}

// 规则自带 clean 配置(【完本神站】广告段剥除等)
let CLEAN: Record<string, any>

async function main() {
  const cfg = await loadRule()
  CLEAN = cfg.clean
  // 仅测试面注入代理, 不落规则本体(披露①)
  const fetchCfg = { ...cfg.fetch, proxyUrl: PROXY }
  console.log(`== wanben 四段实测(公共代理 ${PROXY}) ==`)

  let allPass = true

  // 1) list — 书库最近更新页1
  const listUrl = 'https://www.wanbenshenzhan.com/all/0_lastupdate_0_0_1.html'
  const list = await testSection('list', listUrl, cfg.list, fetchCfg)
  if (!list || (list.count as number) < 10) allPass = false
  await sleep(1200)

  // 2) book — 取 list 首本
  const first = list?.sample?.[0]
  const bookUrl: string | undefined = first?.bookUrl || first?.url
  console.log(`  (list 首样本 → bookUrl=${bookUrl})`)
  if (!bookUrl) {
    console.log('  [book] ❌ 无法取得书籍 URL, 后续段终止')
    process.exit(2)
  }
  const book = await testSection('book', bookUrl, cfg.book, fetchCfg)
  if (!book?.fields?.name || !book?.fields?.author || !book?.fields?.intro) allPass = false
  await sleep(1200)

  // 3) toc — 书籍页内嵌目录, maxPages 20→2(披露②)
  const tocRule = {
    ...cfg.toc,
    pagination: { ...(cfg.toc?.pagination || {}), maxPages: 2 },
  }
  const toc = await testSection('toc', bookUrl, tocRule, fetchCfg)
  if (!toc || (toc.count as number) < 50) allPass = false
  await sleep(1200)

  // 4) content — 从 toc 样本取第 2~4 章逐章试(首选章可能为短楔子), 任一 ≥2000 即过线
  const chapters: { title: string; url: string }[] = (toc?.sample || []).slice(1, 4)
  if (!chapters.length) {
    console.log('  [content] ❌ toc 样本无章节 URL')
    allPass = false
  } else {
    let best = 0
    for (const ch of chapters) {
      const r = await testSection('content', ch.url, cfg.content, fetchCfg)
      if (r) best = Math.max(best, r.cleanedLength as number)
      if (best >= 2000) break
      await sleep(1200)
    }
    console.log(`  [content] 最好清洗长度=${best}(过线≥2000)`)
    if (best < 2000) allPass = false
  }

  console.log(allPass ? '✅ wanben 四段全过线(公共代理出口) — "未实测"标记可摘' : '❌ 存在未过线段落')
  if (!allPass) process.exit(2)
}

main().catch((e) => { console.error('verify ERROR', e); process.exit(1) })
