// dd-c 四段验证: 从库内规则取 config, 经 /api/admin/rules/test 跑两遍, 断言门槛 + 数字对比
// 用法: bun run scripts/verify-dd-c-foursection.ts
// 门槛: list≥10 本 / book 含 name+author+intro / toc≥50 章 / content 清洗后≥2000 字符

const BASE = 'http://localhost:3000'

const TARGETS = [
  { name: '大奉打更人 (dafengdagengren.com)', tag: 'dafeng' },
  { name: '大微小说网 (daweixs.com)', tag: 'daweixs' },
]

interface TestResp {
  ok: boolean
  message?: string
  data?: Record<string, unknown>
}

async function getRule(name: string): Promise<Record<string, any> | null> {
  const res = await fetch(`${BASE}/api/admin/rules?take=100`)
  const json = (await res.json()) as { ok: boolean; data?: { id: string; name: string; config: string }[] }
  const arr = Array.isArray(json.data) ? json.data : []
  const hit = arr.find((r) => r.name === name)
  if (!hit) return null
  return { id: hit.id, ...(JSON.parse(hit.config) as Record<string, any>) }
}

async function testSection(section: string, url: string, cfg: Record<string, any>): Promise<Record<string, any> | null> {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, url, rule: cfg[section], fetch: cfg.fetch, clean: cfg.clean }),
  })
  const json = (await res.json()) as TestResp
  const ms = Date.now() - t0
  if (!json.ok) {
    console.log(`  [${section}] ❌ ${json.message} (${ms}ms)`)
    return null
  }
  const d = json.data as Record<string, any>
  if (section === 'list') console.log(`  [list] ✅ engine=${d.engine} count=${d.count} ${ms}ms`)
  else if (section === 'book') console.log(`  [book] ✅ engine=${d.engine} ${ms}ms fields=${JSON.stringify(d.fields).slice(0, 180)}`)
  else if (section === 'toc') console.log(`  [toc] ✅ engine=${d.engine} count=${d.count} pages=${d.pages} ${ms}ms`)
  else console.log(`  [content] ✅ engine=${d.engine} raw=${d.rawLength} clean=${d.cleanedLength} ${ms}ms`)
  return d
}

async function runSuite(cfg: Record<string, any>, tag: string): Promise<boolean> {
  const listUrl = cfg.list.urlTemplate as string
  const bookUrl = tag === 'dafeng' ? 'https://www.dafengdagengren.com/0_2/' : 'https://www.daweixs.com/0_4/'
  const contentUrl = tag === 'dafeng' ? 'https://www.dafengdagengren.com/0_2/23409004.html' : 'https://www.daweixs.com/0_4/1386.html'
  let pass = true

  const list = await testSection('list', listUrl, cfg)
  if (!list || (list.count as number) < 10) pass = false

  const book = await testSection('book', bookUrl, cfg)
  const f = (book?.fields ?? {}) as Record<string, string>
  if (!book || !f.name || !f.author || !f.intro) { pass = false; console.log('  !! book 字段缺失(需 name+author+intro)') }

  const toc = await testSection('toc', bookUrl, cfg)
  if (!toc || (toc.count as number) < 50) { pass = false; console.log('  !! toc<50') }

  const content = await testSection('content', contentUrl, cfg)
  if (!content || (content.cleanedLength as number) < 2000) { pass = false; console.log('  !! content<2000') }

  return pass
}

async function main() {
  let allPass = true
  for (const t of TARGETS) {
    const cfg = await getRule(t.name)
    if (!cfg) {
      console.log(`== ${t.tag}: ❌ 库内未找到规则 "${t.name}"`)
      allPass = false
      continue
    }
    console.log(`== ${t.tag} (${cfg.id}) ==`)
    for (const round of [1, 2]) {
      console.log(` R${round}:`)
      const ok = await runSuite(cfg, t.tag)
      if (!ok) allPass = false
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  console.log(allPass ? '✅ 两站×2遍 四段全部过线' : '❌ 存在未过线段落')
  if (!allPass) process.exit(2)
}

main()

export {}
