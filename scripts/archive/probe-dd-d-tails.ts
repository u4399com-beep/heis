// ============================================================
// dd-d 收尾双探针:
// ① yybsw.com 既有规则健康复测(list 段, 经 dev server /api/admin/rules/test 真引擎, 1 站点请求)
// ② 番茄聚合 API fq.taijiwang.top 复测(cc-c2 口径: 根//api/search?tab_type=3//api/detail,
//    https+http 两形态, ≤6 请求串行) — 仍 502 则维持"API 端不可达未实测"口径
// 运行: bun scripts/probe-dd-d-tails.ts
// ============================================================
export {}

const BASE = 'http://localhost:3000'

interface TestResp {
  ok: boolean
  message?: string
  data?: { engine?: string; count?: number; rawLength?: number; cleanedLength?: number; fields?: Record<string, string>; sample?: unknown[] }
}

async function main() {
  console.log('===== ① yybsw 既有规则 list 段复测 =====')
  const lr = await fetch(`${BASE}/api/admin/rules?take=100`).then((r) => r.json())
  const rules = (Array.isArray(lr?.data) ? lr.data : lr?.data?.rules || []) as { id: string; name: string; config: string }[]
  const yy = rules.find((r) => r.id === 'cmtfxxztk0a3dowqgbh4lhgdg' || r.name.includes('夜伴'))
  if (!yy) {
    console.log('FAIL: 库内未找到夜伴书屋规则')
    process.exit(1)
  }
  const cfg = JSON.parse(yy.config) as { list: unknown; fetch: unknown; clean?: unknown }
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: 'list', url: 'https://www.yybsw.com/list/dushi.html', rule: cfg.list, fetch: cfg.fetch, clean: cfg.clean, limit: 10 }),
  })
  const j = (await res.json()) as TestResp
  console.log(`list 段: HTTP ${res.status} ok=${j.ok} engine=${j.data?.engine} count=${j.data?.count} ${j.ok ? '' : 'msg=' + (j.message || '')}`)
  const first = (j.data?.sample as { title?: string }[] | undefined)?.[0]
  if (first) console.log(`首项: ${JSON.stringify(first).slice(0, 160)}`)

  await new Promise((r) => setTimeout(r, 1500))

  console.log('===== ② 番茄聚合 API fq.taijiwang.top 复测(6 请求串行) =====')
  try {
    const { promises: dns } = await import('node:dns')
    console.log('DNS fq.taijiwang.top:', await dns.resolve4('fq.taijiwang.top').then((a) => a.join('/')).catch(() => 'NXDOMAIN'))
  } catch { /* ignore */ }

  const targets: Array<[string, string]> = [
    ['https-root', 'https://fq.taijiwang.top/'],
    ['https-search-tab3', 'https://fq.taijiwang.top/api/search?tab_type=3'],
    ['https-detail', 'https://fq.taijiwang.top/api/detail'],
    ['http-root(manual)', 'http://fq.taijiwang.top/'],
    ['http-search-tab3', 'http://fq.taijiwang.top/api/search?tab_type=3'],
    ['https-search-notab', 'https://fq.taijiwang.top/api/search'],
  ]
  for (const [label, url] of targets) {
    const t = Date.now()
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' } })
      const buf = new Uint8Array(await r.arrayBuffer())
      const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 400))
      console.log(`[${label}] ${r.status} ${buf.length}B ${Date.now() - t}ms loc=${r.headers.get('location') || '-'} body=${JSON.stringify(head.replace(/\s+/g, ' ').slice(0, 140))}`)
    } catch (e) {
      console.log(`[${label}] ERROR ${Date.now() - t}ms — ${e instanceof Error ? e.message : e}`)
    }
    await new Promise((r2) => setTimeout(r2, 1200))
  }
}

await main()
process.exit(0)
