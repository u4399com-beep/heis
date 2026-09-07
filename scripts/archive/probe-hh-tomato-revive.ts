// 主控(hh轮): 番茄聚合 API 复活复验 — 四段经 rules/test 真网
// 背景: dd-d 复测 6 轮 502 → 本轮 curl root=200 api=400(复活) → 四段复验
// cc-c2 留档路径: content tab=小说 如 404 改 tab=3 重验
// jj-d: 补 export{} 模块化 —— 本文件与 probe-hh-a-taskdiag.ts 同为无 import 的全局脚本,
// 两者顶层 BASE/main 同名在 tsc 全局作用域碰撞(TS2451/TS2393), 模块化后互不相干(运行无感)
export {}
const BASE = 'http://localhost:3000'
const RULE_ID = 'cmtgi08kt0003qbu988jf36ch'
const KEY = encodeURIComponent('剑')

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
  const j = (await res.json()) as Env<any>
  return j
}

async function main(): Promise<void> {
  const cfg = await loadCfg()
  // ---- list ----
  const listUrl = `https://fq.taijiwang.top/api/search?key=${KEY}&tab_type=3&offset=0`
  const l = await test('list', listUrl, cfg, cfg.list)
  if (!l.ok) { console.log('list FAIL:', l.message); }
  else {
    const d = l.data || {}
    const items = d.items || d.sample || []
    console.log(`list ok count=${d.count} sample=${items.length}`)
    const first = items[0] || {}
    console.log('  first:', JSON.stringify({ name: first.name, author: first.author, bookUrl: (first.bookUrl || '').slice(0, 80) }))
    // ---- book: 用首项 bookUrl ----
    if (first.bookUrl) {
      const b = await test('book', first.bookUrl, cfg, cfg.book)
      if (!b.ok) console.log('book FAIL:', b.message)
      else console.log('book ok fields:', JSON.stringify(b.data).slice(0, 220))
      // ---- toc ----
      const t = await test('toc', first.bookUrl, cfg, cfg.toc)
      if (!t.ok) console.log('toc FAIL:', t.message)
      else {
        const td = t.data || {}
        const chs = td.chapters || td.sample || []
        console.log(`toc ok count=${td.count} pages=${td.pages}`)
        const c0 = chs[0] || {}
        console.log('  ch0:', JSON.stringify({ title: c0.title, url: (c0.url || '').slice(0, 90) }))
        // ---- content ----
        if (c0.url) {
          const c = await test('content', c0.url, cfg, cfg.content)
          if (!c.ok) console.log('content FAIL:', c.message)
          else {
            const cd = c.data || {}
            console.log(`content ok raw=${cd.rawLength ?? cd.raw ?? '?'} clean=${cd.cleanLength ?? cd.clean ?? '?'} head=${String(cd.cleanedText || cd.cleanedHtml || '').slice(0, 80).replace(/\n/g, ' ')}`)
          }
        }
      }
    }
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
