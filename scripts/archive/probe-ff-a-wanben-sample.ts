// ============================================================
// ff-a/A1 — wanben 样本抓取(活代理窗口内抢抓 真实书籍页/章节页 存档)
// 背景: 猎杀 v2 实测发现 list 段 20 本✓/toc 段 171 章×2页✓, 但 book 段 fields={}(选择器
//   疑似与真实页不符) + content 段未及验证(代理死亡)。本脚本 hunts 活代理后在窗口内
//   抢抓 2 本书页 + 2 章节页存 tmp/ff-a/, 供离线核对/修正规则 book·content 选择器。
// 运行: bun scripts/probe-ff-a-wanben-sample.ts
// ============================================================
export {}

import { mkdirSync, writeFileSync } from 'node:fs'

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const TARGET = 'https://www.wanbenshenzhan.com/'
const PROBE_SKIP = Number(process.env.PROBE_SKIP || 1200)
const PROBE_N = Number(process.env.PROBE_N || 8)
const HUNT_TIMEOUT_MS = 9_000
const GAP_MS = 1_000
const DEADLINE_MS = 4.5 * 60_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCES: { label: string; url: string }[] = [
  { label: 'proxyscrape', url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000' },
  { label: 'thespeedx', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },
  { label: 'monosans', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt' },
  { label: 'proxyspace', url: 'https://proxyspace.pro/http.txt' },
]

async function buildCandidates(): Promise<{ proxy: string; source: string }[]> {
  const out: { proxy: string; source: string }[] = []
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

async function probeHome(proxy: string): Promise<boolean> {
  try {
    const init: RequestInit & { proxy?: string } = {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(HUNT_TIMEOUT_MS),
    }
    init.proxy = proxy
    const res = await fetch(TARGET, init)
    await res.text()
    return res.status === 200
  } catch {
    return false
  }
}

async function grab(proxy: string, url: string, file: string): Promise<boolean> {
  try {
    const init: RequestInit & { proxy?: string } = {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    }
    init.proxy = proxy
    const res = await fetch(url, init)
    const body = await res.text()
    const ok = res.status === 200 && body.length > 5000
    console.log(`  [grab] ${url} → ${res.status} ${body.length}B ${ok ? '✅' : '⚠'} → tmp/ff-a/${file}`)
    if (res.status === 200) {
      writeFileSync(`tmp/ff-a/${file}`, body, 'utf8')
      return body.length > 5000
    }
    return false
  } catch (e) {
    console.log(`  [grab] ${url} → ERR ${e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80)}`)
    return false
  }
}

async function main() {
  mkdirSync('tmp/ff-a', { recursive: true })
  console.log(`== wanben 样本抢抓 (skip=${PROBE_SKIP} n=${PROBE_N}) ==`)
  const cands = await buildCandidates()
  const t0 = Date.now()
  for (const c of cands) {
    if (Date.now() - t0 > DEADLINE_MS) { console.log('⏰ 预算耗尽, 未找到活代理'); process.exit(2) }
    const alive = await probeHome(c.proxy)
    if (!alive) { console.log(`[✗] ${c.proxy} (${c.source})`); await sleep(GAP_MS); continue }
    console.log(`[🎉活] ${c.proxy} (${c.source}) → 窗口内抢抓样本`)
    // 已知真实形态: 书籍 /95406838/ · 章节 /95406838/480083952.html(本轮 curl 实证)
    const g1 = await grab(c.proxy, 'https://www.wanbenshenzhan.com/95406838/', 'wanben-book-95406838.html')
    await sleep(1200)
    const g2 = await grab(c.proxy, 'https://www.wanbenshenzhan.com/95406838/480083952.html', 'wanben-chapter-95406838-480083952.html')
    await sleep(1200)
    const g3 = await grab(c.proxy, 'https://www.wanbenshenzhan.com/95392549/', 'wanben-book-95392549.html')
    console.log(g1 && g2 && g3 ? '✅ 样本齐(2书+1章)' : `⚠ 部分样本(书1=${g1} 章=${g2} 书2=${g3}) — 活代理已记录: ${c.proxy}`)
    if (g1) { console.log(`USED_PROXY=${c.proxy}`); process.exit(0) }
    await sleep(GAP_MS)
  }
  console.log('本轮候选耗尽未抢到样本')
  process.exit(2)
}

main().catch((e) => { console.error('sample ERROR', e); process.exit(1) })
