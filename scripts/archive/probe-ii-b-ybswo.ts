// ============================================================
// ii-b — ybswo.com (CF Managed Challenge + Turnstile 不物化) Path C 攻坚
// 背景(worklog dd-d 裁定, 不推翻): http 引擎 403 挑战页(无 Set-Cookie 可拿)/引擎 browser
//   真 Chromium 挑战循环(Turnstile iframe 从未物化, 78s+3 次点击无靶)/家族域名全归一。
//   遗留续作路径: (a)真实出口 IP(b)Turnstile 交互解盾 —— 本轮走第三条: hh-c Scrapling 桥
//   stealthy 模式(patchright 反检测浏览器 + solve_cloudflare 挑战自动求解)。
// 计划: ≤5 次尝试(串行+2s 间隔, 每次 timeoutMs=90s), 求解成功判定=返回 HTML 含站点特征
//   ("夜伴书屋"/书名/书列表)而非 Just a moment 挑战页。成功且 CREATE_RULE=1 → 按 yybsw
//   规则形态建 ybswo 规则(fetchMode='scrapling-stealthy') + rules/test 四段验证。
//   失败 → 证据矩阵如实留档(挑战页特征/耗时/patchright 行为), 不硬凑不建规则。
// 运行: bun scripts/probe-ii-b-ybswo.ts  (CREATE_RULE=1 允许成功后建规则)
// ============================================================
export {}

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const BRIDGE = 'http://127.0.0.1:3012'
const OUT_DIR = 'tmp/ii-b'
const HOME = 'https://www.ybswo.com/'
const BOOK = 'https://www.ybswo.com/book/27714/' // dd-d 侦察同款书(死遁的亡夫们都回来了)
const YYBSW_RULE_ID = 'cmtfxxztk0a3dowqgbh4lhgdg'
const ATTEMPT_TIMEOUT_MS = 90_000
const GAP_MS = 2_000
const MAX_ATTEMPTS = 5

const CREATE_RULE = process.env.CREATE_RULE === '1'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (s: string) => console.log(`[ii-b/ybswo] ${s}`)

function saveSample(name: string, text: string): string {
  const capped = text.length > 400_000 ? text.slice(0, 400_000) : text
  writeFileSync(`${OUT_DIR}/${name}`, capped, 'utf8')
  return `${OUT_DIR}/${name}`
}

interface BridgeResult { ok: boolean; status: number; html: string; finalUrl: string; error: string; ms: number }
async function bridgeFetch(url: string, mode: string, timeoutMs: number): Promise<BridgeResult> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${BRIDGE}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode, headless: true, timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 20_000),
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

const REAL_RE = /夜伴书屋|死遁的亡夫|media-title|book-name/
const CHALLENGE_RE = /just a moment|请稍候|安全验证|challenge-platform|cf-chl|turnstile|启用.{0,4}javascript/i

interface Attempt { n: number; mode: string; url: string; label: string; ok: boolean; status: number; bytes: number; ms: number; solved: boolean; challenge: boolean; error: string; sample: string }

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const health = await fetch(`${BRIDGE}/health`).then((r) => r.json()).catch(() => null)
  log(`bridge health=${JSON.stringify(health)}`)
  if (!health?.ok) { log('桥不可达, 终止'); process.exit(1) }

  // 尝试计划(自适应: home+book 双求解即提前收兵; 第 4 发 playwright 系裸 chromium 对照组)
  const plan: { mode: string; url: string; label: string }[] = [
    { mode: 'stealthy', url: HOME, label: 'home#1' },
    { mode: 'stealthy', url: BOOK, label: 'book#1' },
    { mode: 'stealthy', url: HOME, label: 'home#2' },
    { mode: 'playwright', url: HOME, label: 'home-对照' },
    { mode: 'stealthy', url: BOOK, label: 'book#2' },
  ]
  const attempts: Attempt[] = []
  let solvedHome = false
  let solvedBook = false

  for (const step of plan) {
    if (attempts.length >= MAX_ATTEMPTS) break
    const n = attempts.length + 1
    log(`== 尝试 ${n}/${MAX_ATTEMPTS}: ${step.mode} ${step.url} (${step.label}) ==`)
    const r = await bridgeFetch(step.url, step.mode, ATTEMPT_TIMEOUT_MS)
    const solved = r.ok && REAL_RE.test(r.html) && r.status === 200
    const challenge = CHALLENGE_RE.test(r.html) && !REAL_RE.test(r.html)
    const sampleName = `ybswo-attempt${n}-${step.label.replace(/[^a-z0-9]+/gi, '')}-${solved ? 'SOLVED' : challenge ? 'challenge' : r.status || 'err'}.html`
    const sample = r.html ? saveSample(sampleName, r.html) : ''
    attempts.push({ n, mode: step.mode, url: step.url, label: step.label, ok: r.ok, status: r.status, bytes: r.html.length, ms: r.ms, solved, challenge, error: r.error.slice(0, 200), sample })
    if (step.url === HOME && solved) solvedHome = true
    if (step.url === BOOK && solved) solvedBook = true
    log(`  → ok=${r.ok} status=${r.status} ${r.html.length}B ${r.ms}ms solved=${solved} challenge=${challenge}${r.error ? ' err=' + r.error.slice(0, 120) : ''}`)
    if (solvedHome && solvedBook) { log('🏆 home+book 双求解, 提前收兵'); break }
    await sleep(GAP_MS)
  }

  // 桥日志尾段(patchright 行为证据: 超时/求解轮次/浏览器启动)
  const blogPath = '/home/z/my-project/scrapling-bridge.log'
  if (existsSync(blogPath)) {
    try {
      const lines = readFileSync(blogPath, 'utf8').split(/\r?\n/).filter((l) => /ybswo/i.test(l))
      writeFileSync(`${OUT_DIR}/ybswo-bridgelog.txt`, lines.slice(-40).join('\n'), 'utf8')
    } catch { /* 日志读取失败不阻塞 */ }
  }

  const solved = solvedHome || solvedBook
  writeFileSync(`${OUT_DIR}/ybswo-matrix.json`, JSON.stringify({ ts: new Date().toISOString(), attempts, verdict: solved ? (solvedHome && solvedBook ? 'SOLVED-BOTH' : 'SOLVED-PARTIAL') : 'NOT-SOLVED' }, null, 2))
  log(`== 矩阵: ${attempts.map((a) => `#${a.n}${a.mode}/${a.label}:${a.solved ? 'SOLVED' : a.challenge ? 'challenge' : a.status || 'err'}`).join(' ')} ==`)

  if (!solved) {
    log('== 判定: patchright+solve_cloudflare 未让挑战物化/求解, 按纪律不建规则, 证据已留档 ==')
    process.exit(2)
  }
  if (!CREATE_RULE) {
    log('== 求解成功, CREATE_RULE=1 未设 — 仅留档不建规则 ==')
    process.exit(0)
  }

  // ---------- 成功 → 按 yybsw 形态建 ybswo 规则 ----------
  const yyRes = (await fetch(`${BASE}/api/admin/rules/${YYBSW_RULE_ID}`).then((r) => r.json())) as { ok: boolean; data?: { config: string } }
  if (!yyRes.ok || !yyRes.data) { log('yybsw 模板规则加载失败'); process.exit(1) }
  const ycfg = JSON.parse(yyRes.data.config) as Record<string, any>
  // 域名平移 + 修正 author 选择器(yybsw 存量表达式中 [ 缺失, 本规则写规范形态) + fetch 配置钉 stealthy
  const cfg = JSON.parse(JSON.stringify(ycfg))
  cfg.list.urlTemplate = String(cfg.list.urlTemplate || '').replace('www.yybsw.com', 'www.ybswo.com')
  if (cfg.book?.fields?.author?.expression) cfg.book.fields.author.expression = 'a[href*="/author/"]'
  cfg.fetch = { engine: 'http', fetchMode: 'scrapling-stealthy', timeout: 60_000, retries: 0, waitMs: 800, hostGateLimit: 3 }
  const description =
    '夜伴书屋站群新域(与 yybsw.com 同构, 规则按 yybsw 形态平移)。直连/HTTP 链 403 CF Managed Challenge(无 Set-Cookie), 裸 Playwright 挑战循环 Turnstile 不物化(dd-d 裁定)。' +
    'fetchMode=scrapling-stealthy: 引擎经 Scrapling 桥(127.0.0.1:3012)patchright 反检测浏览器+solve_cloudflare 自动求解, 实证路径见 worklog ii-b 轮与 tmp/ii-b/ 证据。'
  const createRes = (await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '夜伴书屋 (ybswo.com)', description: description.slice(0, 500), config: cfg }),
    signal: AbortSignal.timeout(30_000),
  }).then((r) => r.json())) as { ok: boolean; data?: { id: string }; message?: string }
  if (!createRes.ok || !createRes.data) { log(`规则创建失败: ${createRes.message}`); process.exit(1) }
  const newId = createRes.data.id
  log(`✅ 规则创建 id=${newId}`)

  // ---------- rules/test 四段验证(串行+2s; toc/content 翻页钳 1/2 页为 90s 测试护栏让路, 规则本体保持原值) ----------
  const fetchCfg = { ...cfg.fetch }
  const list = await rulesTest('list', cfg.list.urlTemplate, cfg.list, fetchCfg, cfg.clean)
  log(`[list] ${list ? `count=${list.count} html=${list.htmlSize}B ${list.ms}ms` : '❌'}`)
  await sleep(GAP_MS)
  const book = await rulesTest('book', BOOK, cfg.book, fetchCfg, cfg.clean)
  log(`[book] ${book ? `html=${book.htmlSize}B fields=${JSON.stringify(book.fields).slice(0, 200)}` : '❌'}`)
  await sleep(GAP_MS)
  const tocRule = { ...cfg.toc, pagination: { ...(cfg.toc?.pagination || {}), maxPages: 1 } }
  const toc = await rulesTest('toc', BOOK, tocRule, fetchCfg, cfg.clean)
  log(`[toc] ${toc ? `count=${toc.count} pages=${toc.pages} ${toc.ms}ms` : '❌'}`)
  await sleep(GAP_MS)
  let contentClean = 0
  const chapters = ((toc?.sample || []) as { title: string; url: string }[]).slice(0, 1)
  const contentRule = { ...cfg.content, pagination: { ...(cfg.content?.pagination || {}), maxPages: 2 } }
  for (const ch of chapters) {
    const r = await rulesTest('content', ch.url, contentRule, fetchCfg, cfg.clean)
    if (r) {
      contentClean = Number(r.cleanedLength || 0)
      saveSample('ybswo-content-sample.txt', String(r.cleanedText || ''))
      log(`[content] raw=${r.rawLength} clean=${r.cleanedLength} ${r.ms}ms`)
    } else log('[content] ❌')
  }
  writeFileSync(`${OUT_DIR}/ybswo-foursec.json`, JSON.stringify({ ruleId: newId, list: list?.count, bookFields: book?.fields, tocCount: toc?.count, contentClean }, null, 2))
  log(`== 四段验证: list=${list?.count ?? '✗'} book=${book ? Object.keys(book.fields || {}).length + '字段' : '✗'} toc=${toc?.count ?? '✗'} content=${contentClean || '✗'} ==`)
  process.exit(list && book && toc && contentClean >= 500 ? 0 : 3)
}

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
    if (!env.ok) { log(`  [${section}] ❌ ${String(env.message).slice(0, 160)}`); return null }
    return env.data || {}
  } catch (e) {
    log(`  [${section}] ❌ 客户端异常 ${e instanceof Error ? e.message.slice(0, 100) : e}`)
    return null
  }
}

main().catch((e) => { console.error('probe ERROR', e); process.exit(1) })
