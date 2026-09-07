// qq-c: 经引擎 rules/test 复验番茄四段现状(list/book/toc) — content 症状在下一脚本细查
export {}
const BASE = 'http://localhost:3000'
const RULE_ID = 'cmtgi08kt0003qbu988jf36ch'
const UP = 'https://fq.taijiwang.top'

interface Env<T = any> { ok: boolean; data?: T; message?: string }

async function loadCfg(): Promise<Record<string, any>> {
  const r = await fetch(`${BASE}/api/admin/rules?take=100`).then((x) => x.json() as Promise<Env<any[]>>)
  const arr = Array.isArray(r?.data) ? r.data : []
  const rule = arr.find((x) => x.id === RULE_ID)
  if (!rule) throw new Error('rule not found')
  return typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config
}

async function test(section: string, url: string, cfg: Record<string, any>, ruleSection: unknown) {
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, url, rule: ruleSection, fetch: cfg.fetch, clean: cfg.clean }),
  })
  return (await res.json()) as Env<any>
}

async function main(): Promise<void> {
  const cfg = await loadCfg()
  // ---- list ----
  const listUrl = `${UP}/api/search?key=${encodeURIComponent('剑仙')}&tab_type=3&offset=0`
  const l = await test('list', listUrl, cfg, cfg.list)
  console.log('list ok=', l.ok, 'message=', l.message)
  if (!l.ok) { process.exit(1) }
  const items = l.data?.sample || []
  console.log(`list count=${l.data?.count} sample=${items.length}`)
  for (const it of items.slice(0, 5)) {
    console.log(`  ${it.name} / ${it.author} bookUrl=${it.bookUrl}`)
  }
  const pick = items.find((x: any) => x.name === '剑仙') || items[0]
  const bookUrl = pick.bookUrl.startsWith('http') ? pick.bookUrl : UP + pick.bookUrl
  console.log('pick bookUrl=', bookUrl)

  // ---- book ----
  const b = await test('book', bookUrl, cfg, cfg.book)
  console.log('book ok=', b.ok, JSON.stringify(b.data || b.message).slice(0, 300))

  // ---- toc ----
  const t = await test('toc', bookUrl, cfg, cfg.toc)
  console.log('toc ok=', t.ok, 'message=', t.message)
  if (t.ok) {
    const chs = t.data?.sample || []
    console.log(`toc count=${t.data?.count} pages=${t.data?.pages} first=${JSON.stringify(chs[0])} last=${JSON.stringify(chs[chs.length - 1])}`)
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
