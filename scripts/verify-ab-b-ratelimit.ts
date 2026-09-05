// ============================================================
// verify-ab-b-ratelimit — 采集反反爬增强回归断言 (ab 轮: Retry-After 精确感知 + 速率节流全覆盖)
//
// 覆盖面:
//  A 段(静态) fetcher.ts — Retry-After 头抢救链: parseRetryAfterHeaderMs 解析器(整数秒/
//             HTTP 日期/垃圾三形态) + fetchHttp 三处抛错挂载 + curl 轮解析挂载 + auto 合成错误透传
//  B 段(静态) runner.ts — gateFetch 抛错路径透传 e.retryAfterMs / 全部 gateFetch 调用点
//             minGapMs 覆盖(括号配平逐点扫描, 关闭 zz-b "不传=0 瞬时解除节流"缺口) /
//             封面/下拉词外部站不传的设计注释
//  C 段(静态) hostgate.ts — reportHostRateLimited 签名(retryAfterMs 可选)与噪声底/上限钳制
//  D 段(动态) fetcher 层 — 本地 mock 源站(全回环): 429+Retry-After:2 → 抛错对象
//             .retryAfterMs===2000(status/bodyHtml 行为零变化) / 无头不挂字段 / HTTP 日期形态
//  E 段(动态) hostgate 层 — 透传链: reportHostRateLimited(url,2000) → acquire 实测≈2s 放行 /
//             缺省无头 → 30s 兜底且冷却期 acquire 被拦(HostGateTimeout) / 解析输出直喂
//             (钳 120s / 过小 30s 兜底) / 重复 429 不回拨 / 缺省 minGapMs=0 零回归
//
// 用法: bun scripts/verify-ab-b-ratelimit.ts (全回环不出网, 结束自清理)
// ============================================================
import http from 'http'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { fetchPage, parseRetryAfterHeaderMs } from '../src/lib/crawl/fetcher'
import { acquireHostGate, releaseHostGate, reportHostRateLimited, hostGateSnapshot, hostGateReset } from '../src/lib/crawl/hostgate'

let pass = 0
let fail = 0
const fails: string[] = []

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) pass++
  else {
    fail++
    fails.push(name + (detail ? ` (${detail})` : ''))
    console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`)
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..') // 同 verify-ss-a-docker 口径(cwd 无关且 tsc 干净)
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const fetcherSrc = read('src/lib/crawl/fetcher.ts')
const runnerSrc = read('src/lib/crawl/runner.ts')
const hostgateSrc = read('src/lib/crawl/hostgate.ts')

// ---------- A 段: fetcher Retry-After 抢救链(静态) ----------
console.log('\n== A 段(静态): fetcher.ts Retry-After 抢救链 ==')
ok('A1 解析器导出在位(parseRetryAfterHeaderMs)', fetcherSrc.includes('export function parseRetryAfterHeaderMs'))
{
  const m = fetcherSrc.match(/export function parseRetryAfterHeaderMs[\s\S]{0,420}/)
  const body = m ? m[0] : ''
  ok('A2 解析器整数秒形态(^\\d+$ → sec*1000)', body.includes('/^\\d+$/') && body.includes('sec * 1000'))
  ok('A3 解析器 HTTP 日期兜底(Date.parse, 过期钳 0)', body.includes('Date.parse') && body.includes('Math.max(0, t - Date.now())'))
  ok('A4 解析器垃圾/空值 → undefined(不挂字段契约)', body.includes('return undefined'))
}
ok('A5 fetchHttp 三处抛错对象统一挂载 attachRetryAfterMs(err, res.headers)', (fetcherSrc.match(/attachRetryAfterMs\(err, res\.headers\)/g) || []).length === 3, `count=${(fetcherSrc.match(/attachRetryAfterMs\(err, res\.headers\)/g) || []).length}`)
ok('A6 429 主通道注释在位(!res.ok 抛错路径=头唯一抢救位)', fetcherSrc.includes('ab-b(429 主通道)'))
ok('A7 curl 轮解析 retry-after 头+错误对象挂载', fetcherSrc.includes("key === 'retry-after'") && fetcherSrc.includes('parseRetryAfterHeaderMs(retryAfter)') && fetcherSrc.includes('retryAfter: string'))
ok('A8 auto 合成错误透传 lastErr.retryAfterMs(两处)', (fetcherSrc.match(/typeof lastErr\.retryAfterMs === 'number'/g) || []).length === 2)

// ---------- B 段: runner 接线(静态) ----------
console.log('\n== B 段(静态): runner.ts gateFetch 透传与 minGapMs 全覆盖 ==')
ok('B1 gateFetch 抛错路径透传 reportHostRateLimited(url, e?.retryAfterMs)', runnerSrc.includes('reportHostRateLimited(url, e?.retryAfterMs)'))
ok('B2 壳页返回路径维持缺省(无头可抢救 → 30s 兜底)', runnerSrc.includes('if (reportHostRateLimited(url)) {'))

/** gateFetch 调用点逐一扫描: 括号配平截取完整实参段(防跨行漏检) */
function gateFetchSegments(src: string): string[] {
  const out: string[] = []
  const re = /this\.gateFetch\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length
    let depth = 1
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      i++
    }
    out.push(src.slice(m.index, i))
  }
  return out
}
const segs = gateFetchSegments(runnerSrc)
ok('B3 gateFetch 调用点共 8 处(列表/书籍/目录×3/翻页/浏览器重取/章节批次)', segs.length === 8, `found=${segs.length}`)
ok('B4【核心】全部调用点均传 minGapMs(零"不传=0"缺口)', segs.every((s) => s.includes('minGapMs')), segs.map((s, i) => `#${i}${s.includes('minGapMs') ? '✓' : '✗'}`).join(' '))
ok('B5 列表页逐页随机值在位(minGapMs: pageGapMs)', segs.some((s) => s.includes('minGapMs: pageGapMs')))
ok('B6 章节批次当批随机值在位(minGapMs: interval)', segs.some((s) => s.includes('minGapMs: interval')))
ok('B7 书籍/目录/翻页/浏览器重取 6 处逐次取值(minGapMs: nextInterval())', (runnerSrc.match(/minGapMs: nextInterval\(\)/g) || []).length === 6, `count=${(runnerSrc.match(/minGapMs: nextInterval\(\)/g) || []).length}`)
ok('B8 外部站不传设计注释在位(封面 fetchBinary/下拉词 suggest)', runnerSrc.includes('fetchBinary 直连封面 CDN') && runnerSrc.includes('fetchSuggestKeywords 外部搜索引擎'))
ok('B9 acquire 透传链未动(minGapMs: opts?.minGapMs)', runnerSrc.includes('minGapMs: opts?.minGapMs'))

// ---------- C 段: hostgate 签名与钳制(静态) ----------
console.log('\n== C 段(静态): hostgate.ts reportHostRateLimited 复用确认 ==')
ok('C1 签名已接受可选 retryAfterMs(无需改动直接复用)', /reportHostRateLimited\(url: string, retryAfterMs\?: number\)/.test(hostgateSrc))
ok('C2 噪声底(<1s→30s 兜底)与上限钳 120s 逻辑在位', hostgateSrc.includes('ra >= 1000') && hostgateSrc.includes('HOST_GATE_RATE_LIMIT_MAX_MS') && hostgateSrc.includes('HOST_GATE_RATE_LIMIT_DEFAULT_MS'))

// ---------- 动态段准备: 本地 mock 源站(全回环) ----------
const server = http.createServer((req, res) => {
  res.on('error', () => {})
  const u = new URL(req.url || '/', 'http://127.0.0.1')
  const body = (s: string) => s + 'p'.repeat(220) // 与归档断言同款垫长: 避开"极短内容判拦"支线
  if (u.pathname === '/ra2') {
    res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '2' })
    res.end(body('rate limited'))
    return
  }
  if (u.pathname === '/ranone') {
    res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(body('rate limited'))
    return
  }
  if (u.pathname === '/radate') {
    // HTTP 日期形态: 现在时刻 +3s(请求时点计算, 解析侧 Date.parse 兜底取"距现时刻"毫秒)
    res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': new Date(Date.now() + 3000).toUTCString() })
    res.end(body('rate limited'))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<html><head><title>正常页</title></head><body>' + body('ok') + '</body></html>')
})
server.listen(0, '127.0.0.1')
await new Promise<void>((r) => server.once('listening', () => r()))
const addr = server.address()
const PORT = typeof addr === 'object' && addr ? addr.port : 0
const BASE = `http://127.0.0.1:${PORT}`

/** fetchPage 预期抛错: 返回错误对象(成功则返回伪错误) */
async function fetchErr(url: string): Promise<any> {
  try {
    await fetchPage(url, { engine: 'http', timeout: 5000, retries: 0 })
    return new Error('预期抛错但请求成功')
  } catch (e) {
    return e
  }
}

// ---------- D 段: fetcher 抛错对象 Retry-After 抢救(动态) ----------
console.log('\n== D 段(动态): 429 抛错对象携带 retryAfterMs(本地 mock 源站) ==')
{
  const e = await fetchErr(`${BASE}/ra2`)
  ok('D1 429 如实上抛(err.status 行为零变化)', e?.status === 429, `status=${e?.status} msg=${String(e?.message).slice(0, 60)}`)
  ok('D2【核心】Retry-After: 2 → err.retryAfterMs===2000', e?.retryAfterMs === 2000, `retryAfterMs=${e?.retryAfterMs}`)
  ok('D3 bodyHtml 行为零变化(挑战识别链依赖字段仍在)', typeof e?.bodyHtml === 'string' && e.bodyHtml.includes('rate limited'))
}
{
  const e = await fetchErr(`${BASE}/ranone`)
  ok('D4 无 Retry-After 头 → 不挂字段(30s 兜底通道保持)', e?.status === 429 && !('retryAfterMs' in (e ?? {})))
}
{
  const e = await fetchErr(`${BASE}/radate`)
  const ms = e?.retryAfterMs
  ok('D5 HTTP 日期形态 → Date.parse 兜底≈3000ms', typeof ms === 'number' && ms >= 1500 && ms <= 3500, `retryAfterMs=${ms}`)
}
{
  ok('D6 解析器单测: 整数秒 2→2000 / 45→45000', parseRetryAfterHeaderMs('2') === 2000 && parseRetryAfterHeaderMs('45') === 45000)
  ok('D7 解析器单测: 0 → 0(如实解析, <1s 噪声底交 hostgate 兜底)', parseRetryAfterHeaderMs('0') === 0)
  ok('D8 解析器单测: 垃圾/空/缺省 → undefined', parseRetryAfterHeaderMs('not-a-date') === undefined && parseRetryAfterHeaderMs('') === undefined && parseRetryAfterHeaderMs(null) === undefined && parseRetryAfterHeaderMs(undefined) === undefined)
  const d = parseRetryAfterHeaderMs(new Date(Date.now() + 5000).toUTCString())
  ok('D9 解析器单测: 日期形态 +5s → ≈5000ms', typeof d === 'number' && d >= 3000 && d <= 7000, `ms=${d}`)
}

// ---------- E 段: hostgate 限流冷却实测(动态) ----------
console.log('\n== E 段(动态): reportHostRateLimited → acquire 放行节奏实测 ==')
hostGateReset() // 隔离: 清空账本与挂起定时器(验证专用导出, 生产代码不调)
{
  const urlA = 'http://ab-b-ra2.test/ch1'
  const t1 = await acquireHostGate(urlA, { limit: 3 })
  releaseHostGate(t1) // 先建账本(reportHostRateLimited 对空账本无效)
  const pushed = reportHostRateLimited(urlA, 2000)
  ok('E1 建账后 reportHostRateLimited(url, 2000) 生效返回 true', pushed === true)
  const s1 = hostGateSnapshot(urlA)
  const delta = s1 ? s1.rateLimitedUntil - Date.now() : -1
  ok('E2 冷却截止≈now+2000ms', delta >= 1200 && delta <= 2000, `delta=${delta}`)
  const t0 = Date.now()
  const t2 = await acquireHostGate(urlA)
  const waited = Date.now() - t0
  releaseHostGate(t2)
  ok('E3【核心】冷却期内 acquire 实测等待≈2s 后放行', waited >= 1400 && waited <= 3600, `waited=${waited}ms`)
  const s2 = hostGateSnapshot(urlA)
  ok('E4 到点 settle: rateLimitedUntil 清零(放行通道恢复)', !!s2 && s2.rateLimitedUntil === 0, `snap=${JSON.stringify(s2)}`)
}
{
  const urlB = 'http://ab-b-noheader.test/ch1'
  const t1 = await acquireHostGate(urlB, { limit: 3 })
  releaseHostGate(t1)
  reportHostRateLimited(urlB) // 缺省无头(透传 undefined 的生产形态)
  const s1 = hostGateSnapshot(urlB)
  const delta = s1 ? s1.rateLimitedUntil - Date.now() : -1
  ok('E5【核心】缺省无头 → 30s 兜底不变(≈now+30000)', delta >= 28000 && delta <= 32000, `delta=${delta}`)
  let werr: any = null
  try { await acquireHostGate(urlB, { timeoutMs: 1200 }) } catch (e) { werr = e }
  ok('E6 冷却期内 acquire 被拦(1200ms 等待即 HostGateTimeout)', werr?.name === 'HostGateTimeout', `err=${werr?.name}`)
}
{
  const urlC = 'http://ab-b-cap300.test/ch1'
  const urlD = 'http://ab-b-zero.test/ch1'
  const t1 = await acquireHostGate(urlC, { limit: 3 }); releaseHostGate(t1)
  const t2 = await acquireHostGate(urlD, { limit: 3 }); releaseHostGate(t2)
  reportHostRateLimited(urlC, parseRetryAfterHeaderMs('300')) // 解析输出直喂(生产链: fetcher→runner→hostgate)
  const sc = hostGateSnapshot(urlC)
  const dc = sc ? sc.rateLimitedUntil - Date.now() : -1
  ok('E7 Retry-After:300(解析=300000) 直喂 → 钳 120s', dc >= 118000 && dc <= 120000, `delta=${dc}`)
  reportHostRateLimited(urlD, parseRetryAfterHeaderMs('0')) // 0 → hostgate 噪声底
  const sd = hostGateSnapshot(urlD)
  const dd = sd ? sd.rateLimitedUntil - Date.now() : -1
  ok('E8 Retry-After:0(解析=0, <1s) → 30s 兜底', dd >= 28000 && dd <= 32000, `delta=${dd}`)
}
{
  const urlE = 'http://ab-b-dup.test/ch1'
  const t1 = await acquireHostGate(urlE, { limit: 3 }); releaseHostGate(t1)
  const first = reportHostRateLimited(urlE, 5000)
  const second = reportHostRateLimited(urlE, 3000)
  const s = hostGateSnapshot(urlE)
  const delta = s ? s.rateLimitedUntil - Date.now() : -1
  ok('E9 重复 429 不回拨: 首报 true/次报 false/截止仍≈5s', first === true && second === false && delta >= 4000, `first=${first} second=${second} delta=${delta}`)
  const ghost = reportHostRateLimited('http://ab-b-never.test/x', 2000)
  ok('E10 空账本调用无效不建账', ghost === false && hostGateSnapshot('http://ab-b-never.test/x') === null)
}
{
  const urlF = 'http://ab-b-default.test/ch1'
  const t0 = Date.now()
  const t1 = await acquireHostGate(urlF)
  const t2 = await acquireHostGate(urlF)
  releaseHostGate(t1)
  releaseHostGate(t2)
  const s = hostGateSnapshot(urlF)
  ok('E11 缺省 minGapMs=0 零回归(背靠背双准入, 间隔不为所动)', Date.now() - t0 < 800 && !!s && s.minGapMs === 0, `elapsed=${Date.now() - t0} minGapMs=${s?.minGapMs}`)
}
hostGateReset()

server.close()
await sleep(50)

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
if (fails.length) {
  console.log('失败清单:')
  for (const f of fails) console.log(`  - ${f}`)
}
console.log('结论: Retry-After 头在 fetcher 抛错对象上抢救成功(整数秒/HTTP 日期双形态), gateFetch 抛错路径精确透传, 缺省仍 30s 兜底; 采集目标站全部 gateFetch 调用点 minGapMs 全覆盖, 封面/下拉词外部站按设计不传。')
process.exit(fail ? 1 : 0)
