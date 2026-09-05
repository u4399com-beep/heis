// ============================================================
// ff-a/A1 — wanben 公共代理"猎杀+即时四段"联合脚本(v2)
// 教训(v1 实录): 免费公共代理死亡率极高 — 首个活代理 103.150.152.27:83 在发现后
//   ~3 分钟内死亡(首页 200 双栈复验成功 → 四段开跑时已 timeout), 代理与四段分离
//   执行必然输给代理寿命。故 v2 把"代理探测"与"rules/test 四段"合并为单脚本:
//   逐候选串行探测首页, 一旦 200 立即四段实测, 赢在代理死亡之前。
// 过线标准: list≥10本 / book 全字段 name+author+intro / toc≥50章 / content 清洗后≥2000字符
// 披露: proxyUrl 仅注入测试 fetch 不落规则本体; toc 段测试 maxPages 20→2(90s 护栏×慢代理)。
// 运行: bun scripts/probe-ff-a-wanben-hunt.ts   (PROBE_SKIP/PROBE_N 可调, 见 env)
// ============================================================
export {}

const BASE = 'http://localhost:3000'
const RULE_ID = 'cmthf0hne08gbnktx1wnobuo5'
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const TARGET = 'https://www.wanbenshenzhan.com/'
const LIST_URL = 'https://www.wanbenshenzhan.com/all/0_lastupdate_0_0_1.html'

const PROBE_SKIP = Number(process.env.PROBE_SKIP || 700)
const PROBE_N = Number(process.env.PROBE_N || 8)
const HUNT_TIMEOUT_MS = 9_000
const HUNT_GAP_MS = 1_000
const HUNT_DEADLINE_MS = 4.5 * 60_000 // 猎杀阶段预算(防单轮无限膨胀)
const MAX_FOURSECTION_ATTEMPTS = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCES: { label: string; url: string }[] = [
  { label: 'proxyscrape', url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000' },
  { label: 'thespeedx', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },
  { label: 'monosans', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt' },
  { label: 'proxyspace', url: 'https://proxyspace.pro/http.txt' },
  { label: 'clarketm', url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt' },
]

interface Candidate { proxy: string; source: string }

async function buildCandidates(): Promise<Candidate[]> {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA } })
      const text = await res.text()
      const ips = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(l))
      let taken = 0
      let scanned = 0
      for (const ip of ips) {
        if (taken >= PROBE_N) break
        if (scanned++ < PROBE_SKIP) continue
        if (seen.has(ip)) continue
        seen.add(ip)
        out.push({ proxy: `http://${ip}`, source: s.label })
        taken++
      }
      console.log(`[source] ${s.label}: 候选=${ips.length} 抽样+${taken}`)
    } catch (e) {
      console.log(`[source] ${s.label}: 拉取失败 ${e instanceof Error ? e.message : String(e)}`)
    }
    await sleep(900)
  }
  return out
}

type Verdict = 'BYPASS_OK' | 'WAF_REJECT' | 'PROXY_DEAD'
async function probeHome(proxy: string): Promise<{ verdict: Verdict; status: number; ms: number }> {
  const t0 = Date.now()
  try {
    const init: RequestInit & { proxy?: string } = {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(HUNT_TIMEOUT_MS),
    }
    init.proxy = proxy
    const res = await fetch(TARGET, init)
    await res.text()
    const ms = Date.now() - t0
    return { verdict: res.status === 200 ? 'BYPASS_OK' : 'WAF_REJECT', status: res.status, ms }
  } catch {
    return { verdict: 'PROXY_DEAD', status: 0, ms: Date.now() - t0 }
  }
}

interface Envelope { ok: boolean; message?: string; data?: any }
async function api<T = Envelope>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(95_000), // 服务端 90s 护栏 + 余量
  })
  return (await res.json()) as T
}

async function runSection(section: string, url: string, ruleSection: unknown, fetchCfg: Record<string, any>, clean: unknown): Promise<Record<string, any> | null> {
  const res = await api<Envelope>('/api/admin/rules/test', {
    method: 'POST',
    body: JSON.stringify({ section, url, rule: ruleSection, fetch: fetchCfg, clean }),
  })
  if (!res.ok) {
    console.log(`    [${section}] ❌ ${res.message}`)
    return null
  }
  const d = res.data as Record<string, any>
  if (section === 'list') console.log(`    [list] ✅ count=${d.count} ${d.ms}ms`)
  else if (section === 'book') console.log(`    [book] ✅ ${d.ms}ms fields=${JSON.stringify(d.fields).slice(0, 220)}`)
  else if (section === 'toc') console.log(`    [toc] ✅ count=${d.count} pages=${d.pages} ${d.ms}ms`)
  else console.log(`    [content] ✅ raw=${d.rawLength} clean=${d.cleanedLength} ${d.ms}ms`)
  return d
}

async function fourSection(proxy: string, cfg: Record<string, any>): Promise<boolean> {
  console.log(`  --- 四段实测 via ${proxy} ---`)
  const fetchCfg = { ...cfg.fetch, proxyUrl: proxy }
  let allPass = true

  const list = await runSection('list', LIST_URL, cfg.list, fetchCfg, cfg.clean)
  if (!list || (list.count as number) < 10) return false
  await sleep(1200)

  const first = list?.sample?.[0]
  const bookUrl: string | undefined = first?.bookUrl || first?.url
  if (!bookUrl) { console.log('    (list 首样本无 bookUrl)'); return false }
  const book = await runSection('book', bookUrl, cfg.book, fetchCfg, cfg.clean)
  if (!book?.fields?.name || !book?.fields?.author || !book?.fields?.intro) allPass = false
  await sleep(1200)

  const tocRule = { ...cfg.toc, pagination: { ...(cfg.toc?.pagination || {}), maxPages: 2 } }
  const toc = await runSection('toc', bookUrl, tocRule, fetchCfg, cfg.clean)
  if (!toc || (toc.count as number) < 50) allPass = false
  await sleep(1200)

  const chapters: { title: string; url: string }[] = (toc?.sample || []).slice(1, 3)
  let best = 0
  for (const ch of chapters) {
    const r = await runSection('content', ch.url, cfg.content, fetchCfg, cfg.clean)
    if (r) best = Math.max(best, r.cleanedLength as number)
    if (best >= 2000) break
    await sleep(1200)
  }
  if (best < 2000) allPass = false
  console.log(`  === 结果: ${allPass ? '✅ 全过线' : `❌ 未过线(content最好=${best})`}`)
  return allPass
}

async function main() {
  console.log(`== A1 v2 猎杀+即时四段 (skip=${PROBE_SKIP} n=${PROBE_N}) ==`)
  const ruleRow = await api<{ ok: boolean; data?: { config: string } }>(`/api/admin/rules/${RULE_ID}`)
  if (!ruleRow.ok || !ruleRow.data) throw new Error('规则加载失败')
  const cfg = JSON.parse(ruleRow.data.config) as Record<string, any>
  const cands = await buildCandidates()
  console.log(`候选=${cands.length}, 猎杀阶段预算 ${(HUNT_DEADLINE_MS / 60000).toFixed(1)}min, 串行间隔 ${HUNT_GAP_MS}ms\n`)

  const t0 = Date.now()
  let liveFound = 0
  let fourTried = 0
  let win = false
  let rejected = 0
  let dead = 0

  for (const c of cands) {
    if (Date.now() - t0 > HUNT_DEADLINE_MS) { console.log('⏰ 猎杀阶段预算耗尽'); break }
    if (fourTried >= MAX_FOURSECTION_ATTEMPTS) break
    const r = await probeHome(c.proxy)
    if (r.verdict === 'PROXY_DEAD') { dead++; console.log(`[✗死] ${c.proxy} (${c.source}) ${r.ms}ms`) }
    else if (r.verdict === 'WAF_REJECT') { rejected++; console.log(`[⚠拒] ${c.proxy} (${c.source}) status=${r.status} ${r.ms}ms`) }
    else {
      liveFound++
      console.log(`[🎉活] ${c.proxy} (${c.source}) status=200 ${r.ms}ms → 立即四段`)
      fourTried++
      win = await fourSection(c.proxy, cfg)
      if (win) {
        console.log(`\n🏆 胜出代理: ${c.proxy} (${c.source}) — 四段全过线`)
        break
      }
      console.log('  (代理死于四段中途或未过线, 继续猎杀)')
      await sleep(1500)
      continue
    }
    await sleep(HUNT_GAP_MS)
  }

  console.log(`\n== 汇总: 扫描=${dead + rejected + liveFound} 代理死=${dead} WAF拒=${rejected} 活=${liveFound} 四段尝试=${fourTried} 全过线=${win ? 1 : 0}`)
  process.exit(win ? 0 : 2)
}

main().catch((e) => { console.error('hunt ERROR', e); process.exit(1) })
