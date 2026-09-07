// ============================================================
// ii-b — wanbenshenzhan.com (GoEdge JA3 指纹+IP 信誉复合门) Scrapling 桥实战攻坚
// 背景(worklog gg/ff 轮裁定, 不推翻): 四段选择器全对(66KB 样本离线全字段命中), 败因在
//   fetch 层 —— node 运行时+代理直入 curl 链, curl 的 OpenSSL TLS 指纹被 GoEdge 按 JA3
//   拦截(同代理同 URL bun 200/curl 403 实录); 沙箱双出口 IP 又被 IP 信誉门边缘拒绝。
// 本轮新组合拳(hh-c Scrapling 桥首次实战):
//   Phase A(PHASE=a): scrapling-static 直连 —— 桥内 curl_cffi impersonate=chrome 完整模拟
//     Chrome TLS 握手, 若 GoEdge 只按 JA3 拦 curl 的 OpenSSL 指纹, 直连即可过(无需代理)。
//     四段探针 403/200 全留档 tmp/ii-b/; 200 → rules/test 四段×2 遍一致性判定。
//   Phase B(PHASE=b): 活代理 + scrapling-static + proxyUrl —— 沿 probe-gg-b-wanben-book.ts
//     猎杀思路, 但探活/窗口全走"桥内 curl_cffi 经代理+Chrome 指纹"双伪装(上轮"活代理+curl
//     指纹被拦"与"好指纹+没活代理"两个半解的合体)。bun 直抓仅作初筛(快), 过者经桥确认。
// 过线标准(沿 ff-a/gg-b): rules/test list≥10 / book name+author+intro 全字段 / toc≥50 /
//   content clean≥2000, 2 遍一致。
// 纪律: 同 host 并发≤3(全程串行), 站点请求间隔≥1s, 猎杀每轮预算 HUNT_DEADLINE_MIN(默认7)。
// 披露: proxyUrl 仅注入测试 fetch 不落规则本体(公共代理易逝, ff-a 裁定沿用)。
// 运行: PHASE=a bun scripts/probe-ii-b-wanben.ts
//       PHASE=b ROUND=1 PROBE_SKIP=0 bun scripts/probe-ii-b-wanben.ts
// ============================================================
export {}

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const BRIDGE = 'http://127.0.0.1:3012'
const RULE_ID = 'cmthf0hne08gbnktx1wnobuo5'
const OUT_DIR = 'tmp/ii-b'
const TARGET = 'https://www.wanbenshenzhan.com/'
const LIST_URL = 'https://www.wanbenshenzhan.com/all/0_lastupdate_0_0_{page}.html'
const KNOWN_BOOK = 'https://www.wanbenshenzhan.com/95406838/' // ff-a 轮实证形态书籍页
const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

const PHASE = (process.env.PHASE || 'a').toLowerCase()
const ROUND = Number(process.env.ROUND || 1)
const PROBE_SKIP = Number(process.env.PROBE_SKIP || 0)
const PROBE_N = Number(process.env.PROBE_N || 12)
const HUNT_DEADLINE_MS = Number(process.env.HUNT_DEADLINE_MIN || 7) * 60_000
// FOCUS_PROXY=http://ip:port: 跳过猎杀直接对指定代理开窗口序列(进程被杀后的窗口续跑路径)
const FOCUS_PROXY = (process.env.FOCUS_PROXY || '').trim()
const GAP_MS = 1_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (s: string) => console.log(`[ii-b/${PHASE}${PHASE === 'b' ? 'r' + ROUND : ''}] ${s}`)

const CHALLENGE_RE = /just a moment|请稍候|安全验证|challenge-platform|cf-chl|turnstile|访问验证|captCha/i

function saveSample(name: string, text: string): string {
  const capped = text.length > 400_000 ? text.slice(0, 400_000) : text
  writeFileSync(`${OUT_DIR}/${name}`, capped, 'utf8')
  return `${OUT_DIR}/${name}`
}

// ---------- 桥调用(curl_cffi 静态指纹伪装) ----------
interface BridgeResult { ok: boolean; status: number; html: string; finalUrl: string; error: string; ms: number }
async function bridgeFetch(
  url: string,
  opts: { mode?: string; proxy?: string; timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<BridgeResult> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${BRIDGE}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        mode: opts.mode || 'static',
        headless: true,
        proxy: opts.proxy || undefined,
        timeoutMs: opts.timeoutMs ?? 30_000,
        headers: opts.headers || undefined,
      }),
      signal: AbortSignal.timeout((opts.timeoutMs ?? 30_000) + 20_000),
    })
    const payload = (await res.json()) as { ok?: boolean; status?: number; html?: string; finalUrl?: string; error?: string }
    return {
      ok: !!payload?.ok,
      status: payload?.status ?? 0,
      html: payload?.html || '',
      finalUrl: payload?.finalUrl || url,
      error: payload?.error || '',
      ms: Date.now() - t0,
    }
  } catch (e) {
    return { ok: false, status: 0, html: '', finalUrl: url, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }
  }
}

// ---------- bun 直抓基线(对照: 本机原生 TLS 指纹, 历史裁定=IP 信誉门 403) ----------
async function directProbe(url: string): Promise<{ status: number; bytes: number; ms: number }> {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA_MOBILE, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    const body = await res.text()
    if (res.status === 200) saveSample(`wanben-a-direct-${url.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.html`, body)
    return { status: res.status, bytes: body.length, ms: Date.now() - t0 }
  } catch (e) {
    log(`[direct] ${url} ERR ${e instanceof Error ? e.message.slice(0, 60) : e}`)
    return { status: 0, bytes: 0, ms: Date.now() - t0 }
  }
}

// ---------- rules/test ----------
interface Envelope { ok: boolean; message?: string; data?: Record<string, unknown> }
async function rulesTest(section: string, url: string, rule: unknown, fetchCfg: Record<string, unknown>, clean: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE}/api/admin/rules/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, url, rule, fetch: fetchCfg, clean, limit: 20 }),
      signal: AbortSignal.timeout(95_000),
    })
    const env = (await res.json()) as Envelope
    if (!env.ok) {
      log(`  [${section}] ❌ ${String(env.message).slice(0, 160)}`)
      return null
    }
    return env.data || {}
  } catch (e) {
    log(`  [${section}] ❌ 客户端异常 ${e instanceof Error ? e.message.slice(0, 100) : e}`)
    return null
  }
}

// ---------- 四段窗口序列(全程串行+≥1s 间隔) ----------
interface FoursecResult {
  listCount: number
  bookFields: Record<string, string> | null
  bookHtmlSize: number
  bookUrl: string
  tocCount: number
  contentClean: number
  contentRaw: number
  pass: boolean
  detail: string
}

async function foursec(cfg: Record<string, any>, fetchMode: string, proxy: string, tag: string): Promise<FoursecResult> {
  const out: FoursecResult = {
    listCount: 0, bookFields: null, bookHtmlSize: 0, bookUrl: '',
    tocCount: 0, contentClean: 0, contentRaw: 0, pass: false, detail: '',
  }
  // proxyUrl 仅注入测试 fetch 不落规则本体(ff-a 裁定); engine 钉 http 防 bridge 失联时
  // native 链 auto 空烧浏览器; fetchMode='scrapling-static' 让引擎 fetchPageOnce 顶层分流交桥
  const fetchCfg: Record<string, unknown> = {
    ...cfg.fetch,
    engine: 'http',
    fetchMode,
    timeout: 25_000,
    ...(proxy ? { proxyUrl: proxy } : {}),
  }
  const t0 = Date.now()

  // S1 list
  const list = await rulesTest('list', LIST_URL, cfg.list, fetchCfg, cfg.clean)
  if (list) {
    const count = Number(list.count || 0)
    out.listCount = count
    const sample = (list.sample || []) as Record<string, string>[]
    log(`  [list] count=${count} html=${list.htmlSize}B ${list.ms}ms first=${sample[0]?.name || '∅'}`)
    const bu = sample.find((s) => s.bookUrl && /^https?:\/\//.test(s.bookUrl))?.bookUrl
    if (bu) out.bookUrl = bu
  }
  await sleep(GAP_MS)

  // S2 book(优先 list 首样本书页, 回退已知书页)
  const bookUrl = out.bookUrl || KNOWN_BOOK
  out.bookUrl = bookUrl
  const book = await rulesTest('book', bookUrl, cfg.book, fetchCfg, cfg.clean)
  if (book) {
    out.bookFields = (book.fields as Record<string, string>) || {}
    out.bookHtmlSize = Number(book.htmlSize || 0)
    log(`  [book] html=${book.htmlSize}B ${book.ms}ms fields=${JSON.stringify(out.bookFields).slice(0, 260)}`)
    if (out.bookFields && Object.keys(out.bookFields).length) {
      saveSample(`wanben-${tag}-book-fields.json`, JSON.stringify({ url: bookUrl, ...out.bookFields }, null, 2))
    }
  }
  await sleep(GAP_MS)

  // S3 toc(慢代理护栏: maxPages 2, ff-a/gg-b 口径; 过线标准 toc≥50)
  const tocRule = { ...cfg.toc, pagination: { ...(cfg.toc?.pagination || {}), maxPages: 2 } }
  const toc = await rulesTest('toc', bookUrl, tocRule, fetchCfg, cfg.clean)
  if (toc) {
    out.tocCount = Number(toc.count || 0)
    log(`  [toc] count=${out.tocCount} pages=${toc.pages} ${toc.ms}ms`)
  }
  await sleep(GAP_MS)

  // S4 content(toc 样本第 2 章起, 短楔子规避; 任一 clean≥2000 即记录)
  const chapters = ((toc?.sample || []) as { title: string; url: string }[]).slice(1, 3)
  for (const ch of chapters) {
    const r = await rulesTest('content', ch.url, cfg.content, fetchCfg, cfg.clean)
    if (r) {
      const cleanLen = Number(r.cleanedLength || 0)
      if (cleanLen > out.contentClean) {
        out.contentClean = cleanLen
        out.contentRaw = Number(r.rawLength || 0)
        saveSample(`wanben-${tag}-content-sample.txt`, String(r.cleanedText || ''))
      }
      log(`  [content] raw=${r.rawLength} clean=${r.cleanedLength} ${r.ms}ms (${ch.title?.slice(0, 24)})`)
    }
    if (out.contentClean >= 2000) break
    await sleep(GAP_MS)
  }

  const okList = out.listCount >= 10
  const okBook = !!out.bookFields?.name && !!out.bookFields?.author && !!out.bookFields?.intro
  const okToc = out.tocCount >= 50
  const okContent = out.contentClean >= 2000
  out.pass = okList && okBook && okToc && okContent
  out.detail = `list=${out.listCount}${okList ? '✓' : '✗'} book=[${Object.keys(out.bookFields || {}).join('|') || '∅'}]${okBook ? '✓' : '✗'} toc=${out.tocCount}${okToc ? '✓' : '✗'} content=${out.contentClean}${okContent ? '✓' : '✗'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`
  log(`  == 四段: ${out.detail}`)
  return out
}

// ---------- Phase A: scrapling-static 直连 ----------
async function phaseA(cfg: Record<string, any>): Promise<number> {
  log(`== Phase A: scrapling-static 直连探针(curl_cffi Chrome TLS 指纹, 无代理) ==`)
  const matrix: Record<string, unknown>[] = []

  // 基线: 本机原生指纹直抓(历史裁定=IP 信誉门 403, 本轮复核留档)
  for (const u of [TARGET, LIST_URL.replace('{page}', '1'), KNOWN_BOOK]) {
    const r = await directProbe(u)
    matrix.push({ transport: 'bun-direct', url: u, status: r.status, bytes: r.bytes, ms: r.ms })
    log(`[direct-bun] ${u} → ${r.status} ${r.bytes}B ${r.ms}ms`)
    await sleep(GAP_MS)
  }

  // 桥健康
  const health = await fetch(`${BRIDGE}/health`).then((r) => r.json()).catch(() => null)
  log(`[bridge] health=${JSON.stringify(health)}`)
  if (!health?.ok) { log('桥不可达, 终止'); return 1 }

  // 桥 static 直连探针: list + book(四段中两段锚点; toc/content 依赖章节 URL 由四段链内取)
  const probes: { label: string; url: string }[] = [
    { label: 'list', url: LIST_URL.replace('{page}', '1') },
    { label: 'book', url: KNOWN_BOOK },
  ]
  let listOk = false
  let bookOk = false
  for (const p of probes) {
    const r = await bridgeFetch(p.url, { mode: 'static', timeoutMs: 30_000 })
    const marker = p.label === 'list' ? /book-name|data-table|rank-item|完本/i.test(r.html) : /book-info|chapter-list|latest-chapter/i.test(r.html)
    if (p.label === 'list') listOk = r.ok && r.status === 200 && marker
    else bookOk = r.ok && r.status === 200 && marker
    if (r.html) saveSample(`wanben-a-bridge-${p.label}-${r.status}.html`, r.html)
    matrix.push({ transport: 'bridge-static', url: p.url, status: r.status, bytes: r.html.length, ms: r.ms, marker, error: r.error.slice(0, 120) })
    log(`[bridge-static] ${p.label} ${p.url} → ${r.status} ${r.html.length}B ${r.ms}ms marker=${marker}${r.error ? ' err=' + r.error.slice(0, 80) : ''}`)
    await sleep(GAP_MS)
  }
  writeFileSync(`${OUT_DIR}/wanben-a-matrix.json`, JSON.stringify({ phase: 'A', ts: new Date().toISOString(), matrix }, null, 2))

  if (!listOk || !bookOk) {
    log(`== Phase A 判定: 直连仍被拦(list200+marker=${listOk}, book200+marker=${bookOk}) — GoEdge 复合门含 IP 信誉分量, 转 Phase B(活代理+桥双伪装) ==`)
    return 2
  }

  // 过探针 → rules/test 四段×2 遍一致性
  const p1 = await foursec(cfg, 'scrapling-static', '', 'a-p1')
  await sleep(GAP_MS)
  const p2 = await foursec(cfg, 'scrapling-static', '', 'a-p2')
  const consistent = p1.pass && p2.pass
  writeFileSync(`${OUT_DIR}/wanben-a-foursec.json`, JSON.stringify({ phase: 'A', pass1: p1, pass2: p2, consistent }, null, 2))
  log(`== Phase A 终判: ${consistent ? '🏆 四段×2 遍一致过线(直连 scrapling-static 即破)' : p1.pass || p2.pass ? '⚠ 仅 1 遍过线(flabby)' : '❌ 四段未过线'} ==`)
  return consistent ? 0 : 3
}

// ---------- Phase B: 活代理 + 桥双伪装 ----------
interface Candidate { proxy: string; source: string }
const SOURCES: { label: string; url: string }[] = [
  { label: 'proxyscrape', url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000' },
  { label: 'thespeedx', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },
  { label: 'monosans', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt' },
  { label: 'proxyspace', url: 'https://proxyspace.pro/http.txt' },
  { label: 'clarketm', url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt' },
]

function loadTried(): Set<string> {
  const out = new Set<string>()
  for (const p of [`${OUT_DIR}/tried.txt`, 'tmp/gg-b/tried.txt']) {
    if (!existsSync(p)) continue
    for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const ip = l.trim().split(/\s+/)[0]
      if (ip) out.add(ip)
    }
  }
  return out
}
function rememberTried(proxy: string, verdict: string) {
  appendFileSync(`${OUT_DIR}/tried.txt`, `${proxy} ${verdict}\n`)
}

async function buildCandidates(): Promise<Candidate[]> {
  const tried = loadTried()
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA_MOBILE } })
      const text = await res.text()
      const ips = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(l))
      let taken = 0, scanned = 0
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
      log(`[source] ${s.label}: 拉取失败 ${e instanceof Error ? e.message.slice(0, 60) : e}`)
    }
    await sleep(900)
  }
  return out
}

/** 初筛: bun 直连代理快探(死代理快速失败); BYPASS 者再经桥确认(curl_cffi+代理+Chrome 指纹) */
async function bunProbe(proxy: string): Promise<'BYPASS' | 'WAF_REJECT' | 'DEAD'> {
  try {
    const init: RequestInit & { proxy?: string } = {
      headers: { 'User-Agent': UA_MOBILE, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(9_000),
    }
    init.proxy = proxy
    const res = await fetch(TARGET, init)
    const body = await res.text()
    return res.status === 200 && body.length > 1000 && !CHALLENGE_RE.test(body) ? 'BYPASS' : 'WAF_REJECT'
  } catch {
    return 'DEAD'
  }
}

async function phaseB(cfg: Record<string, any>): Promise<number> {
  log(`== Phase B: 活代理猎杀 + scrapling-static+proxyUrl 组合(round=${ROUND} skip=${PROBE_SKIP} n=${PROBE_N} 预算${(HUNT_DEADLINE_MS / 60000).toFixed(0)}min) ==`)
  const health = await fetch(`${BRIDGE}/health`).then((r) => r.json()).catch(() => null)
  log(`[bridge] health=${JSON.stringify(health)}`)
  if (!health?.ok) { log('桥不可达, 终止'); return 1 }

  const cands = FOCUS_PROXY
    ? [{ proxy: FOCUS_PROXY, source: 'focus' }]
    : await buildCandidates()
  log(`候选=${cands.length}${FOCUS_PROXY ? '(FOCUS_PROXY 指定)' : `(跨轮记忆 ${loadTried().size} 条已排除)`}`)
  const t0 = Date.now()
  let dead = 0, rejected = 0, confirmed = 0
  let win: (FoursecResult & { proxy: string; pass2?: FoursecResult }) | null = null

  for (const c of cands) {
    if (win) break
    if (Date.now() - t0 > HUNT_DEADLINE_MS) { log('⏰ 猎杀预算耗尽'); break }

    // ① bun 初筛(快死识别); FOCUS_PROXY 时跳过初筛直接桥确认+窗口
    const v1 = FOCUS_PROXY ? 'BYPASS' : await bunProbe(c.proxy)
    if (v1 === 'DEAD') { dead++; rememberTried(c.proxy, 'dead'); log(`[✗死] ${c.proxy} (${c.source})`); await sleep(GAP_MS); continue }
    if (v1 === 'WAF_REJECT') { rejected++; rememberTried(c.proxy, 'bunReject'); log(`[⚠拒-bun] ${c.proxy} (${c.source})`); await sleep(GAP_MS); continue }
    log(`[bun200] ${c.proxy} → 桥确认(curl_cffi+代理)`)

    // ② 桥确认: curl_cffi 经代理 + Chrome TLS 指纹双伪装 —— 本轮新组合的关键验证点
    const v2 = await bridgeFetch(TARGET, { mode: 'static', proxy: c.proxy, timeoutMs: 15_000 })
    if (!v2.ok || v2.status !== 200 || v2.html.length < 1000 || CHALLENGE_RE.test(v2.html)) {
      rememberTried(c.proxy, `bun200_bridge${v2.status || v2.error.slice(0, 20)}`)
      log(`[⚠拒-桥] ${c.proxy} status=${v2.status} bytes=${v2.html.length} ${v2.error.slice(0, 60)} — 双传输分裂实录`)
      await sleep(GAP_MS)
      continue
    }
    confirmed++
    saveSample(`wanben-b-home-${c.proxy.replace(/[^0-9]/g, '_')}.html`, v2.html)
    log(`[🎉桥活] ${c.proxy} status=200 ${v2.html.length}B ${v2.ms}ms → 窗口序列启动`)

    // ③ 窗口序列: S1 原始书页样本抢抓 → S2/S3 四段×2 遍
    const g = await bridgeFetch(KNOWN_BOOK, { mode: 'static', proxy: c.proxy, timeoutMs: 30_000 })
    const sampleOk = g.ok && g.status === 200 && g.html.length > 5000
    if (sampleOk) saveSample('wanben-b-book-known.html', g.html)
    log(`  [S1样本] 已知书页 ${g.status} ${g.html.length}B ${sampleOk ? '✅落盘' : '⚠'}`)
    await sleep(GAP_MS)

    rememberTried(c.proxy, 'used')
    const p1 = await foursec(cfg, 'scrapling-static', c.proxy, `b-r${ROUND}-p1`)
    await sleep(GAP_MS)
    if (p1.pass) {
      const p2 = await foursec(cfg, 'scrapling-static', c.proxy, `b-r${ROUND}-p2`)
      win = { ...p1, proxy: c.proxy, pass2: p2 }
      writeFileSync(`${OUT_DIR}/wanben-b-window-r${ROUND}.json`, JSON.stringify({ round: ROUND, proxy: c.proxy, sampleOk, pass1: p1, pass2: p2, consistent: p2.pass }, null, 2))
      if (p2.pass) log(`🏆 胜出代理 ${c.proxy} — 四段×2 遍一致过线`)
      else log(`⚠ 第 2 遍未过线(flabby), 明细 ${OUT_DIR}/wanben-b-window-r${ROUND}.json`)
    } else {
      writeFileSync(`${OUT_DIR}/wanben-b-window-r${ROUND}.json`, JSON.stringify({ round: ROUND, proxy: c.proxy, sampleOk, pass1: p1, note: 'pass1 未过线' }, null, 2))
      log(`⚠ 窗口未过线(${p1.detail})`)
    }
    await sleep(GAP_MS)
  }

  log(`== 汇总: 候选=${cands.length} 死=${dead} bun拒=${rejected} 桥确认活=${confirmed} 胜出=${win ? win.proxy : '无'}`)
  return win?.pass2?.pass ? 0 : win ? 3 : 2
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const ruleRes = await fetch(`${BASE}/api/admin/rules/${RULE_ID}`).then((r) => r.json()) as Envelope & { data?: { config: string } }
  if (!ruleRes.ok || !ruleRes.data) throw new Error('规则加载失败')
  const cfg = JSON.parse(ruleRes.data.config) as Record<string, any>
  log(`规则加载 ok, fetch.engine=${cfg.fetch?.engine} uaMode=${cfg.fetch?.uaMode}`)

  if (PHASE === 'a') process.exit(await phaseA(cfg))
  if (PHASE === 'b') process.exit(await phaseB(cfg))
  log(`未知 PHASE=${PHASE}`)
  process.exit(1)
}

main().catch((e) => { console.error('probe ERROR', e); process.exit(1) })
