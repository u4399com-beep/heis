// ============================================================
// ff-a/A2 — bqg713 端到端健康核查: rules/test 四段实测(走 3010 转换代理)
// 过线标准: list≥10本 / book 全字段 name+author+intro / toc≥50章 /
//           content 清洗后≥2000字符(标题+txt 双字段回来即证明 AES token 解密链路通)
// 前置: mini-services/bqg713-proxy 存活(3010 /health selfTestOk=true 已另行核验)
// 运行: bun scripts/verify-ff-a-bqg713.ts
// ============================================================
export {}

const BASE = 'http://localhost:3000'
const RULE_NAME = '笔趣阁bqg713(www.bqg713.cc)·纯JSON API站采集'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Envelope { ok: boolean; message?: string; data?: any }
interface RuleRow { id: string; name: string; config: string }

async function api<T = Envelope>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return (await res.json()) as T
}

async function loadRule(): Promise<{ id: string; cfg: Record<string, any> }> {
  const r = await api<{ ok: boolean; data?: RuleRow[] }>('/api/admin/rules')
  const arr = Array.isArray(r.data) ? r.data : []
  const row = arr.find((x: RuleRow) => x.name === RULE_NAME)
  if (!row) throw new Error(`库内规则未找到: ${RULE_NAME}`)
  return { id: row.id, cfg: JSON.parse(row.config) }
}

async function testSection(section: string, url: string, ruleSection: unknown, cfg: Record<string, any>): Promise<Record<string, any> | null> {
  const res = await api<Envelope>('/api/admin/rules/test', {
    method: 'POST',
    body: JSON.stringify({
      section, url, rule: ruleSection,
      // 显式带规则 fetch 配置: tokenUrl/tokenPattern/tokenInjection/mirrorDomains 全在其中,
      // 缺省会丢 token 预取钩子 → apibi.cc 纯明文参数 403(ee-b 首遍假绿同源教训)
      fetch: cfg.fetch,
      clean: cfg.clean,
    }),
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

async function main() {
  const { id, cfg } = await loadRule()
  console.log(`== bqg713 四段健康核查 (rule id=${id}) ==`)
  console.log(`  fetch.tokenUrl=${cfg.fetch?.tokenUrl}`)
  console.log(`  fetch.mirrorDomains=${cfg.fetch?.mirrorDomains}`)

  let allPass = true

  // 1) list 段 — 并集路径 hotlist,sort1~6
  const list = await testSection('list', 'https://www.bqg713.cc/api/index?sort=all', cfg.list, cfg)
  if (!list || (list.count as number) < 10) allPass = false
  await sleep(1000)

  // 2) book 段 — 从 list 样本取第一个书 id
  const first = list?.sample?.[0]
  const bookId = first?.id ?? first?.fields?.id
  console.log(`  (list 首样本 → bookId=${bookId})`)
  if (!bookId) {
    console.log('  [book] ❌ 无法从 list 样本取得书 id, 后续段终止')
    process.exit(2)
  }
  const book = await testSection('book', `https://www.bqg713.cc/api/book?id=${bookId}`, cfg.book, cfg)
  if (!book?.fields?.name || !book?.fields?.author || !book?.fields?.intro) allPass = false
  await sleep(1000)

  // 3) toc 段 — tocLink const 模板 {q.id} 展开(book URL 为入口)
  const toc = await testSection('toc', `https://www.bqg713.cc/api/book?id=${bookId}`, cfg.toc, cfg)
  if (!toc || (toc.count as number) < 50) allPass = false
  await sleep(1000)

  // 4) content 段 — 真实 API 域 apibi.cc, 引擎 tokenUrl 预取 → 3010 签发 AES token → 注入 URL
  const content = await testSection(
    'content',
    `https://apibi.cc/api/chapter?id=${bookId}&chapterid=1`,
    cfg.content,
    cfg,
  )
  // 标题+正文双字段回来 & 清洗后≥2000 才算解密链路真通
  const contentOk = !!content && (content.cleanedLength as number) >= 2000
  if (!contentOk) allPass = false

  console.log(allPass ? '✅ bqg713 四段全过线(转换代理链路健康)' : '❌ 存在未过线段落')
  if (!allPass) process.exit(2)
}

main().catch((e) => { console.error('verify ERROR', e); process.exit(1) })
