// ============================================================
// ff-a/A1 — wanbenshenzhan.com(完本神站) 公共代理池复验探针
// 背景(ee-a 终态): GoEdge WAF 对沙箱双出口 IP(直连 8.212.10.159 / Chromium 47.57.232.232)
//   边缘级 403(连 CAPTCHA 都不下发)。解封路径 = 真实代理(FetchConfig.proxyUrl)。
// 本探针: ①多源拉免费公共代理列表 → ②抽样候选 → ③串行(≥1s 间隔)逐个对
//   https://www.wanbenshenzhan.com/ 发请求(bun fetch RequestInit.proxy, 移动 UA) →
//   ④分类: 200=绕过成功 / 403·307=代理活但 GoEdge 仍拒 / 超时·连不上=代理死。
// 如实记录, 不硬造。若发现可用代理 → 后续 rules/test 四段带 proxyUrl 实测(verify 脚本)。
// 运行: bun scripts/probe-ff-a-wanben-proxy.ts
// ============================================================
export {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const TARGET = 'https://www.wanbenshenzhan.com/'
const CANDIDATES_PER_SOURCE = Number(process.env.PROBE_N || 4) // 每源抽样数(默认 4, 5 源共 20)
const SKIP_EACH = Number(process.env.PROBE_SKIP || 0) // 每源跳过前 N 条(第2轮跨池采样用)
const PROBE_TIMEOUT_MS = 12_000
const GAP_MS = 1100

const SOURCES: { label: string; url: string }[] = [
  { label: 'proxyscrape', url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000' },
  { label: 'thespeedx', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },
  { label: 'monosans', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt' },
  { label: 'proxyspace', url: 'https://proxyspace.pro/http.txt' },
  { label: 'clarketm', url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt' },
]

interface Candidate { proxy: string; source: string }

async function downloadSources(): Promise<Candidate[]> {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA } })
      const text = await res.text()
      const ips = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(l))
      console.log(`[source] ${s.label}: http=${res.status} 候选=${ips.length}`)
      let taken = 0
      let scanned = 0
      for (const ip of ips) {
        if (taken >= CANDIDATES_PER_SOURCE) break
        if (scanned++ < SKIP_EACH) continue
        if (seen.has(ip)) continue
        seen.add(ip)
        out.push({ proxy: `http://${ip}`, source: s.label })
        taken++
      }
    } catch (e) {
      console.log(`[source] ${s.label}: 拉取失败 ${e instanceof Error ? e.message : String(e)}`)
    }
    await sleep(900)
  }
  return out
}

type Verdict = 'BYPASS_OK' | 'WAF_REJECT' | 'PROXY_DEAD'

async function probeViaProxy(proxy: string): Promise<{ verdict: Verdict; status: number; ms: number; note: string }> {
  const t0 = Date.now()
  try {
    const init: RequestInit & { proxy?: string } = {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    }
    init.proxy = proxy
    const res = await fetch(TARGET, init)
    const body = (await res.text()).slice(0, 200)
    const ms = Date.now() - t0
    if (res.status === 200) return { verdict: 'BYPASS_OK', status: 200, ms, note: body.replace(/\s+/g, ' ') }
    if (res.status === 403 || res.status === 307 || res.status === 412 || res.status === 429 || res.status === 503) {
      return { verdict: 'WAF_REJECT', status: res.status, ms, note: body.replace(/\s+/g, ' ').slice(0, 120) }
    }
    return { verdict: 'WAF_REJECT', status: res.status, ms, note: body.replace(/\s+/g, ' ').slice(0, 120) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const ms = Date.now() - t0
    return { verdict: 'PROXY_DEAD', status: 0, ms, note: msg.slice(0, 120) }
  }
}

async function main() {
  console.log('== A1 wanben 公共代理池复验 ==')
  const cands = await downloadSources()
  console.log(`\n候选总数=${cands.length}, 串行探测(间隔≥${GAP_MS}ms, 超时${PROBE_TIMEOUT_MS / 1000}s)...\n`)

  const results: { c: Candidate; r: Awaited<ReturnType<typeof probeViaProxy>> }[] = []
  for (const c of cands) {
    const r = await probeViaProxy(c.proxy)
    results.push({ c, r })
    const tag = r.verdict === 'BYPASS_OK' ? '🎉绕过' : r.verdict === 'WAF_REJECT' ? '⚠ WAF拒' : '✗代理死'
    console.log(`[${tag}] ${c.proxy} (${c.source}) status=${r.status} ${r.ms}ms ${r.note.slice(0, 90)}`)
    await sleep(GAP_MS)
  }

  const ok = results.filter((x) => x.r.verdict === 'BYPASS_OK')
  const rejected = results.filter((x) => x.r.verdict === 'WAF_REJECT')
  const dead = results.filter((x) => x.r.verdict === 'PROXY_DEAD')
  console.log(`\n== 汇总: 候选=${results.length} 绕过成功=${ok.length} 代理活但WAF拒=${rejected.length} 代理死=${dead.length}`)

  if (ok.length) {
    console.log('\n可用代理(下一步 rules/test 四段带 proxyUrl 实测):')
    for (const x of ok) console.log(`  ${x.c.proxy} (${x.c.source}, ${x.r.ms}ms)`)
  } else {
    console.log('\n结论: 公共代理池候选全部不可用或仍被 GoEdge 按 IP 拒绝 —— 诚实留档, 规则维持"未实测"标记')
  }
}

await main()
process.exit(0)
