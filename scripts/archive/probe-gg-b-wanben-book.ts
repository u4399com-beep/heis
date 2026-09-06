// ============================================================
// gg-b/A — wanben 竞速猎杀 v3(gg-b 增强版, 复用 ff-a v2 竞速语义)
// 缺口: wanben 规则 book 段唯一未实测(ff-a 首跑 fields={} 疑云 + 代理死亡未复测)。
// v3 关键改动: 拿到活代理后【优先抢 book 页原始 HTML 存 tmp/gg-b/】(样本=甄别
//   fields={} 疑云的关键证据), 再走 rules/test 四段(样本在手后, 四段是佐证不是前提)。
// 窗口序列(全程串行+间隔≥800ms, 单活代理内完成):
//   S1 直抓已知书籍页 /95406838/ 原始 HTML(样本①, 不依赖任何前置测试)
//   S2 rules/test list → 取 sample[0].bookUrl
//   S3 直抓 sample[0] 书页原始 HTML(样本②, 与 S1 交叉印证)
//   S4 rules/test book(同 bookUrl) → fields 与样本②直接对账(fields={} 甄别)
//   S5 rules/test toc(maxPages 2, 慢代理护栏口径) → 章节样本
//   S6 rules/test content(toc 样本章) → raw/clean
// 过线标准(沿 ff-a): list≥10 / book 全字段 name+author+intro / toc≥50 / content clean≥2000
// 披露: proxyUrl 仅注入测试 fetch 不落规则本体(公共代理易逝落库必腐, ff-a 裁定沿用)。
// 多轮: 每轮 PROBE_SKIP 错位采样 + tmp/gg-b/tried.txt 记忆已试代理(跨轮去重)。
// 运行: ROUND=1 PROBE_SKIP=700 bun scripts/probe-gg-b-wanben-book.ts
// ============================================================
export {}

declare const Bun: { write(path: string, data: Uint8Array | string): Promise<number> }

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const RULE_ID = 'cmthf0hne08gbnktx1wnobuo5'
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const TARGET = 'https://www.wanbenshenzhan.com/'
const LIST_URL = 'https://www.wanbenshenzhan.com/all/0_lastupdate_0_0_1.html'
const KNOWN_BOOK = 'https://www.wanbenshenzhan.com/95406838/' // ff-a 轮 curl 实证形态书籍页
const OUT_DIR = 'tmp/gg-b'

const ROUND = Number(process.env.ROUND || 1)
const PROBE_SKIP = Number(process.env.PROBE_SKIP || 700)
const PROBE_N = Number(process.env.PROBE_N || 10)
const HUNT_TIMEOUT_MS = 9_000
const HUNT_GAP_MS = 1_000
const HUNT_DEADLINE_MS = Number(process.env.HUNT_DEADLINE_MIN || 4.5) * 60_000
const WINDOW_GAP_MS = 900

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (s: string) => console.log(`[r${ROUND}] ${s}`)

const SOURCES: { label: string; url: string }[] = [
  { label: 'proxyscrape', url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000' },
  { label: 'thespeedx', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },
  { label: 'monosans', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt' },
  { label: 'proxyspace', url: 'https://proxyspace.pro/http.txt' },
  { label: 'clarketm', url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt' },
]

// 跨轮已试代理记忆(死亡/被拒都不重试, 换窗口采样)
function loadTried(): Set<string> {
  const p = `${OUT_DIR}/tried.txt`
  if (!existsSync(p)) return new Set()
  return new Set(readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
}
function rememberTried(proxy: string, verdict: string) {
  appendFileSync(`${OUT_DIR}/tried.txt`, `${proxy} ${verdict}\n`)
}

interface Candidate { proxy: string; source: string }

async function buildCandidates(): Promise<Candidate[]> {
  const tried = loadTried()
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
        const full = `http://${ip}`
        if (seen.has(full) || tried.has(full)) continue
        seen.add(full)
        out.push({ proxy: full, source: s.label })
        taken++
      }
      log(`[source] ${s.label}: 候选=${ips.length} 新抽样+${taken}`)
    } catch (e) {
      log(`[source] ${s.label}: 拉取失败 ${e instanceof Error ? e.message : String(e)}`)
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
    return { verdict: res.status === 200 ? 'BYPASS_OK' : 'WAF_REJECT', status: res.status, ms: Date.now() - t0 }
  } catch {
    return { verdict: 'PROXY_DEAD', status: 0, ms: Date.now() - t0 }
  }
}

/** 活代理窗口内直抓原始 HTML(样本抢抓; 200 且 >5000B 才落盘) */
async function grabRaw(proxy: string, url: string, file: string): Promise<{ ok: boolean; status: number; bytes: number }> {
  try {
    const init: RequestInit & { proxy?: string } = {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    }
    init.proxy = proxy
    const res = await fetch(url, init)
    const body = await res.text()
    const big = body.length > 5000
    if (res.status === 200 && big) {
      writeFileSync(`${OUT_DIR}/${file}`, body, 'utf8')
      log(`[grab] ${url} → 200 ${body.length}B ✅ → ${OUT_DIR}/${file}`)
      return { ok: true, status: 200, bytes: body.length }
    }
    log(`[grab] ${url} → ${res.status} ${body.length}B ⚠(未落盘)`)
    return { ok: false, status: res.status, bytes: body.length }
  } catch (e) {
    log(`[grab] ${url} → ERR ${e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80)}`)
    return { ok: false, status: 0, bytes: 0 }
  }
}

interface Envelope { ok: boolean; message?: string; data?: any }
async function api<T = Envelope>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(95_000),
  })
  return (await res.json()) as T
}

async function runSection(section: string, url: string, ruleSection: unknown, fetchCfg: Record<string, any>, clean: unknown): Promise<Record<string, any> | null> {
  try {
    const res = await api<Envelope>('/api/admin/rules/test', {
      method: 'POST',
      body: JSON.stringify({ section, url, rule: ruleSection, fetch: fetchCfg, clean }),
    })
    if (!res.ok) {
      log(`  [${section}] ❌ ${res.message}`)
      return null
    }
    const d = res.data as Record<string, any>
    if (section === 'list') log(`  [list] ✅ engine=${d.engine} count=${d.count} html=${d.htmlSize}B ${d.ms}ms`)
    else if (section === 'book') log(`  [book] ✅ engine=${d.engine} html=${d.htmlSize}B ${d.ms}ms fields=${JSON.stringify(d.fields).slice(0, 300)}`)
    else if (section === 'toc') log(`  [toc] ✅ engine=${d.engine} count=${d.count} pages=${d.pages} ${d.ms}ms`)
    else log(`  [content] ✅ engine=${d.engine} pages=${d.pages} raw=${d.rawLength} clean=${d.cleanedLength} ${d.ms}ms`)
    return d
  } catch (e) {
    log(`  [${section}] ❌ 客户端异常 ${e instanceof Error ? e.message.slice(0, 100) : e}`)
    return null
  }
}

interface WindowResult {
  proxy: string
  sample1Known: boolean
  sample2ListBook: boolean
  bookUrl: string
  listCount: number
  bookFields: Record<string, string> | null
  bookHtmlSize: number
  tocCount: number
  contentClean: number
  allPass: boolean
}

async function windowSequence(proxy: string, cfg: Record<string, any>): Promise<WindowResult> {
  // engine 钉 http: r1~r3 实录 auto 链 browser 经慢代理恒 ERR_TIMED_OUT(~40s 空烧),
  // http(curl 链) 至少 toc 200 过线 —— 403 呈间歇性(疑 GoEdge 对代理 IP 限流/概率拦截),
  // 失败快返回+应用层重试比烧 browser 等待划算得多。仅注入测试 fetch, 不落规则本体。
  const fetchCfg = { ...cfg.fetch, proxyUrl: proxy, engine: 'http' }
  const out: WindowResult = {
    proxy, sample1Known: false, sample2ListBook: false, bookUrl: '',
    listCount: 0, bookFields: null, bookHtmlSize: 0, tocCount: 0, contentClean: 0, allPass: false,
  }
  const t0 = Date.now()

  // 应用层重试包装(r1~r3 实录 403 间歇性: 同代理同 URL bun 直抓 200 与 curl 链 403 交替,
  // r3 toc 曾在多个 403 后自然过线): 每段至多 3 试, 失败快返(engine=http 无 browser 空烧)后
  // 退避 4s 重试。串行纪律不变(重试间隔≥窗口间隔)。
  const attempt = async (section: string, url: string, rule: unknown): Promise<Record<string, any> | null> => {
    for (let i = 1; i <= 3; i++) {
      const r = await runSection(section, url, rule, fetchCfg, cfg.clean)
      if (r) return r
      if (i < 3) await sleep(4_000)
    }
    return null
  }

  // S1 【最高优先】已知书籍页原始样本(不依赖任何前置测试, 代理刚验活立即抢)
  const g1 = await grabRaw(proxy, KNOWN_BOOK, 'wanben-book-95406838.html')
  out.sample1Known = g1.ok
  await sleep(WINDOW_GAP_MS)

  // S2 list(rules/test, 代理注入测试 fetch)
  const list = await attempt('list', LIST_URL, cfg.list)
  if (list && (list.count as number) >= 10) out.listCount = list.count as number
  await sleep(WINDOW_GAP_MS)

  // S3 list 首样本书籍页原始样本(与 S1 交叉印证)
  const first = list?.sample?.[0]
  let bookUrl: string | undefined = first?.bookUrl || first?.url
  if (bookUrl) {
    const g2 = await grabRaw(proxy, bookUrl, 'wanben-book-list1.html')
    out.sample2ListBook = g2.ok
    await sleep(WINDOW_GAP_MS)
  } else {
    // list 未过线(该代理 IP 对 /all/ 路径被 GoEdge 拒/超时等)≠代理死: r1 实录
    // 首页+书页 200 而 /all/ 403。回退已知书页 URL 继续跑 book/toc —— 不浪费窗口
    log('  (list 未过线, 回退 KNOWN_BOOK 继续窗口序列)')
    bookUrl = KNOWN_BOOK
  }
  out.bookUrl = bookUrl || ''

  // S4 book 段四段测试(fields={} 与样本②直接对账)
  const book = await attempt('book', bookUrl, cfg.book)
  if (book) {
    out.bookFields = (book.fields as Record<string, string>) || {}
    out.bookHtmlSize = book.htmlSize as number
  }
  await sleep(WINDOW_GAP_MS)

  // S5 toc(慢代理 maxPages 20→2, ff-a 护栏口径)
  const tocRule = { ...cfg.toc, pagination: { ...(cfg.toc?.pagination || {}), maxPages: 2 } }
  const toc = await attempt('toc', bookUrl, tocRule)
  if (toc && (toc.count as number) >= 50) out.tocCount = toc.count as number
  await sleep(WINDOW_GAP_MS)

  // S6 content(toc 样本第 2 章起, 短楔子规避; 任一 clean≥2000 即记录)
  const chapters: { title: string; url: string }[] = (toc?.sample || []).slice(1, 3)
  for (const ch of chapters) {
    const r = await runSection('content', ch.url, cfg.content, fetchCfg, cfg.clean)
    if (r) out.contentClean = Math.max(out.contentClean, r.cleanedLength as number)
    if (out.contentClean >= 2000) break
    await sleep(WINDOW_GAP_MS)
  }

  out.allPass =
    out.listCount >= 10 &&
    !!out.bookFields?.name && !!out.bookFields?.author && !!out.bookFields?.intro &&
    out.tocCount >= 50 && out.contentClean >= 2000
  log(`-- 窗口序列完成 ${((Date.now() - t0) / 1000).toFixed(1)}s: 样本①=${out.sample1Known} 样本②=${out.sample2ListBook} list=${out.listCount} book字段=${Object.keys(out.bookFields || {}).join('|') || '∅'} toc=${out.tocCount} contentClean=${out.contentClean} 全过线=${out.allPass}`)
  return out
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  log(`== gg-b v3 竞速猎杀(round=${ROUND} skip=${PROBE_SKIP} n=${PROBE_N}) ==`)
  const ruleRow = await api<{ ok: boolean; data?: { config: string } }>(`/api/admin/rules/${RULE_ID}`)
  if (!ruleRow.ok || !ruleRow.data) throw new Error('规则加载失败')
  const cfg = JSON.parse(ruleRow.data.config) as Record<string, any>

  const cands = await buildCandidates()
  log(`候选=${cands.length}, 猎杀预算 ${(HUNT_DEADLINE_MS / 60000).toFixed(1)}min`)

  const t0 = Date.now()
  let dead = 0
  let rejected = 0
  let result: WindowResult | null = null

  for (const c of cands) {
    if (Date.now() - t0 > HUNT_DEADLINE_MS) { log('⏰ 猎杀预算耗尽'); break }
    if (result) break
    const r = await probeHome(c.proxy)
    if (r.verdict === 'PROXY_DEAD') { dead++; rememberTried(c.proxy, 'dead'); log(`[✗死] ${c.proxy} (${c.source}) ${r.ms}ms`) }
    else if (r.verdict === 'WAF_REJECT') { rejected++; rememberTried(c.proxy, `reject${r.status}`); log(`[⚠拒] ${c.proxy} (${c.source}) status=${r.status} ${r.ms}ms`) }
    else {
      log(`[🎉活] ${c.proxy} (${c.source}) status=200 ${r.ms}ms → 窗口序列启动(样本优先)`)
      rememberTried(c.proxy, 'used')
      result = await windowSequence(c.proxy, cfg)
      writeFileSync(`${OUT_DIR}/hunt-result-round${ROUND}.json`, JSON.stringify({ round: ROUND, source: c.source, ...result, proxy: c.proxy }, null, 2), 'utf8')
      if (result.allPass) log(`🏆 胜出代理 ${c.proxy} — 四段全过线`)
      else log(`⚠ 窗口完成但未全过线(样本/字段明细见 hunt-result-round${ROUND}.json)`)
    }
    await sleep(HUNT_GAP_MS)
  }

  log(`== 汇总: 扫描=${dead + rejected + (result ? 1 : 0)} 死=${dead} 拒=${rejected} 活=${result ? 1 : 0}`)
  process.exit(result ? (result.sample1Known || result.sample2ListBook ? 0 : 3) : 2)
}

main().catch((e) => { console.error('hunt ERROR', e); process.exit(1) })
