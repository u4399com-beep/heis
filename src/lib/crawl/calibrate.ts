// ============================================================
// calibrate — 采集规则极限速率/并发校准引擎 (zz-a)
//
// 目标: 对给定采集规则, 在指定档位(lenient/standard/strict)的模拟源站上,
// 实测出"不被封禁又最大化获取数据"的极限并发与极限速率(最小安全间隔),
// 并产出可直接落库的 recommended 参数(hostGateLimit/threadMin/threadMax/
// intervalMin/intervalMax), 供 Task.fetchConfig/线程间隔随机范围采用。
//
// 设计约束(与 hostgate 解耦):
//  - 本引擎【不依赖】hostgate/fetcher/runner —— 自持纯 fetch+setTimeout
//    并发原语与节奏控制, 探测流量自成一体, 不占用/不污染采集主链路的闸门账本。
//  - 探测流量伪装为浏览器指纹(UA 池逐请求轮换 + Accept 头组), 与生产引擎
//    uaMode=rotate 的行为一致, 避免触发源站 UA 单化/机器人指纹拦截。
//
// 探测协议(三阶段):
//  阶段1 探并发: 批间隔固定 1500ms(充分安全), 并发沿 1→2→3→4→6→8→10 逐档,
//    每档对 /chapter/{1}/{1..10} 混合 URL 发 12 请求(并发×重复轮, 末轮补余),
//    判定 pass = (429+403)/requests ≤ 0.1; 首档(并发=1)失败或遭遇 410 永久
//    封禁信号 → 提前终止; 命中失败后升档无意义(限流单调性: 并发更高只会更差)
//    → 首个失败档即封顶。档间强制冷却: 突发窗(2s)隔离 2.5s + 60s 窗口排空 8s;
//    遇 429/403 后改等 Retry-After(上限 90s)。
//  阶段2 探速率: 并发固定=阶段1最优值, 间隔沿 2000→1500→1000→700→500→300→150ms
//    逐档, 每档 12 请求(批间 sleep 该间隔), 同款判定+冷却; 取通过的最小间隔。
//    全档皆败 → 保守外推 2000×1.3=2600ms。
//  阶段3 验证: 以 recommended 参数(threadMax=maxConcurrency 钳 1~8,
//    intervalMin/Max=minInterval~×2.5 取整, hostGateLimit=threadMax)对完整四段
//    链路 /list/1→/book/1→/toc/1→/chapter/1/{1..17} 共 20 请求按真实采集节奏
//    (threadMax 并发批, 批间随机 intervalMin~intervalMax)复跑, 零 429/403 才算
//    ok; 有封禁信号 → 回退一档(并发-1 且间隔×1.3)再验一次, 仍败则 ok=false
//    输出保守值。
//
// 关于签名中的 cfg 参数: 当前探测以 siteBase+profile 驱动标准四段链路, 与规则
// 自身的页面结构无关(校准的是"源站耐受度"而非"规则解析力"); cfg 保留在签名中
// 为未来预留 —— 按规则页面结构差异(list 分页数/toc 卷结构/内容翻页)定制探测
// URL 池与链路长度。当前实现仅读取 cfg.fetch.hostGateLimit 用于对比说明。
// ============================================================
import type { RuleConfig } from './types'

export type CalibrateProfile = 'lenient' | 'standard' | 'strict'

export interface CalibrateOptions {
  /** 模拟/真实源站基址, 如 http://127.0.0.1:3040 */
  siteBase: string
  /** 源站限流档位(与 ratelimit-site.ts 三档对应) */
  profile: CalibrateProfile
  /** 单请求超时 ms, 默认 10000 */
  timeoutMs?: number
  /** 开始前重置模拟源站(zz-a2): 对 siteBase 发一次 POST /reset 清空限流计数/封禁状态,
   *  保证每轮校准从干净状态开始可重复(上一轮的 429 计数会推进封禁升级链污染本轮)。
   *  安全性: 仅当 siteBase 为回环地址时由调用方(API 路由)置 true, 真实站点永不发送 */
  resetBefore?: boolean
  /** 实时轨迹回调(每探测档结束回调一次) */
  onProgress?: (t: CalibrationTrace) => void
  /** 外部取消检查点(每档/每批/每次冷却切片) */
  shouldAbort?: () => boolean
}

export interface CalibrationTrace {
  stage: 'concurrency' | 'rate' | 'verify'
  /** 该档参数: 并发档=并发数 / 速率档=批间隔ms / 验证档=threadMax */
  param: number
  requests: number
  hit429: number
  hit403: number
  other: number
  pass: boolean
  note?: string
}

export interface CalibrationResult {
  ok: boolean
  /** 极限并发(阶段1实测最优值; 验证回退后为验证通过的保守值) */
  maxConcurrency: number
  /** 极限速率: 最小安全批间隔 ms(阶段2实测; 全败时为保守外推值) */
  minIntervalMs: number
  /** 判定阈值说明 */
  safeThresholdNote: string
  /** 可直接落库的建议参数 */
  recommended: {
    hostGateLimit: number
    threadMin: number
    threadMax: number
    intervalMin: number
    intervalMax: number
  }
  trace: CalibrationTrace[]
  /** 中文结论 */
  message: string
  durationMs: number
  finishedAt: string
}

// ---------- 探测协议常量 ----------
const CONCURRENCY_LADDER = [1, 2, 3, 4, 6, 8, 10] // 阶段1 并发梯
const INTERVAL_LADDER = [2000, 1500, 1000, 700, 500, 300, 150] // 阶段2 间隔梯(ms)
const PROBES_PER_LEVEL = 12 // 每档探测请求数
const STAGE1_BATCH_GAP_MS = 1500 // 阶段1 批间隔(充分安全)
const LEVEL_GAP_MS = 2500 // 档间突发窗(2s)隔离期
const LEVEL_COOLDOWN_MS = 8000 // 档间 60s 窗口排空期
const STAGE_DRAIN_MS = 25_000 // 阶段间窗口排空期
const COOLDOWN_MAX_MS = 90_000 // 单次冷却上限(防病态 Retry-After 死等)
const PASS_FAIL_RATIO = 0.1 // 探测档通过阈值: (429+403)/requests ≤ 0.1
const VERIFY_REQUESTS = 20 // 阶段3 验证请求数
const HOST_GATE_CLAMP_MAX = 8 // hostGateLimit 钳制上限(hostgate 上限 10, 保守 8)

/** 探测 UA 池(真实浏览器指纹, 逐请求轮换 — 对齐生产 uaMode=rotate 行为) */
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
]

/** 外部取消信号(shouldAbort 命中时抛出, 路由层按 name 识别转"已取消") */
export class CalibrateAbort extends Error {
  constructor() {
    super('校准已取消')
    this.name = 'CalibrateAbort'
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 可取消 sleep: 按 200ms 切片检查 shouldAbort, 快速响应取消 */
async function sleepAbortable(ms: number, shouldAbort?: () => boolean): Promise<void> {
  let left = ms
  while (left > 0) {
    if (shouldAbort?.()) throw new CalibrateAbort()
    const slice = Math.min(200, left)
    await sleep(slice)
    left -= slice
  }
}

interface ProbeReply {
  /** HTTP 状态码; 0=网络错误/超时 */
  status: number
  /** Retry-After 头解析(→ms), 无则 0 */
  retryAfterMs: number
}

/** 单次探测请求: 浏览器指纹头 + 超时控制 + Retry-After 解析 */
async function probeFetch(url: string, timeoutMs: number): Promise<ProbeReply> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA_POOL[Math.floor(Math.random() * UA_POOL.length)],
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'manual',
      signal: ctl.signal,
    })
    // 小页面直接读干, 释放连接
    await res.text().catch(() => '')
    const ra = parseFloat(res.headers.get('retry-after') || '')
    return { status: res.status, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0 }
  } catch {
    return { status: 0, retryAfterMs: 0 }
  } finally {
    clearTimeout(timer)
  }
}

interface LevelOutcome {
  trace: CalibrationTrace
  /** 遭遇 410(Gone 永久封禁信号) */
  banEscalated: boolean
  /** 本档内见过的最大 Retry-After(冷却依据) */
  maxRetryAfterMs: number
}

/**
 * 单档探测: 把 targets 按 batchSize 切批并发执行(末批补余, 总量恒为
 * PROBES_PER_LEVEL), 批间 sleep gapMs; 统计 429/403/其他并判定 pass
 */
async function probeLevel(
  stage: CalibrationTrace['stage'],
  param: number,
  targets: string[],
  batchSize: number,
  gapMs: number,
  opts: CalibrateOptions,
  noteExtra?: string
): Promise<LevelOutcome> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  // 目标序列: 混合 URL 池循环取样, 恒 PROBES_PER_LEVEL 条
  const seq: string[] = []
  for (let i = 0; i < PROBES_PER_LEVEL; i++) seq.push(targets[i % targets.length])

  let hit429 = 0
  let hit403 = 0
  let other = 0
  let banEscalated = false
  let maxRetryAfterMs = 0

  const rounds = Math.ceil(seq.length / batchSize)
  for (let r = 0; r < rounds; r++) {
    if (opts.shouldAbort?.()) throw new CalibrateAbort()
    const batch = seq.slice(r * batchSize, (r + 1) * batchSize)
    const replies = await Promise.all(batch.map((u) => probeFetch(u, timeoutMs)))
    for (const rp of replies) {
      if (rp.retryAfterMs > maxRetryAfterMs) maxRetryAfterMs = rp.retryAfterMs
      if (rp.status === 429) hit429++
      else if (rp.status === 403) hit403++
      else if (rp.status === 410) {
        other++
        banEscalated = true
      } else if (rp.status === 0 || rp.status >= 400) other++ // 网络错误/5xx/其他异常
      // 2xx/3xx 正常响应
    }
    if (r < rounds - 1) await sleepAbortable(gapMs, opts.shouldAbort)
  }

  const requests = seq.length
  // ab-c: 其他异常(网络错误/超时 status=0/5xx/路径 404)也计入失败判定 —— 原实现只看 429+403,
  // 源站宕机/全部超时时本档照样判「通过」, 极限梯会被顶到最大值(直到阶段3验证才发现 other>0,
  // 中间档位结论已虚高); 与阶段3验证「零异常才算过」口径对齐。模拟源站正常响应 other=0, 零行为变化。
  const pass = !banEscalated && (hit429 + hit403 + other) / requests <= PASS_FAIL_RATIO
  const notes: string[] = []
  if (hit429) notes.push(`429×${hit429}`)
  if (hit403) notes.push(`403×${hit403}`)
  if (other) notes.push(`其他异常×${other}`)
  if (banEscalated) notes.push('遭遇410永久封禁信号')
  if (noteExtra) notes.push(noteExtra)

  const trace: CalibrationTrace = {
    stage,
    param,
    requests,
    hit429,
    hit403,
    other,
    pass,
    note: notes.length ? notes.join(', ') : '全通过',
  }
  opts.onProgress?.(trace)
  return { trace, banEscalated, maxRetryAfterMs }
}

/** 失败档后的强制冷却: Retry-After 优先(上限 90s), 否则固定 8s */
async function cooldownAfterFail(out: LevelOutcome, shouldAbort?: () => boolean): Promise<void> {
  const ms = Math.min(COOLDOWN_MAX_MS, Math.max(out.maxRetryAfterMs, LEVEL_COOLDOWN_MS))
  await sleepAbortable(ms, shouldAbort)
}

interface StageOutcome {
  /** 阶段1: 通过的最高并发档(0=无通过档) / 阶段2: 通过的最小间隔(0=无通过档) */
  best: number
  traces: CalibrationTrace[]
  firstFail: boolean // 首档即失败
  banEscalated: boolean // 任何档遭遇 410
  /** 末个失败档的 Retry-After(阶段间排空依据) */
  lastFailRetryAfterMs: number
  /** 阶段2: 全档皆败时的保守外推间隔(0=无需外推) */
  fallbackInterval: number
}

/**
 * 首档韧性重试判定(zz-a2): 首档失败但疑似【临时封禁残余】(403 占多数且带 Retry-After)
 * 而非源站真实拦截——典型场景: 上一轮校准的失败把 IP 封了 60s, 新一轮校准开局撞上封禁期,
 * 全 403 会被误判为"源站防护极严"过早定论。命中特征时冷却到 Retry-After 后重探一次。
 */
function looksLikeBanResidue(out: LevelOutcome): boolean {
  const { trace, maxRetryAfterMs } = out
  return trace.hit403 > 0 && trace.hit429 === 0 && trace.hit403 / trace.requests > 0.5 && maxRetryAfterMs > 0
}

/** 阶段1 探并发 */
async function stageConcurrency(opts: CalibrateOptions, targets: string[]): Promise<StageOutcome> {
  const traces: CalibrationTrace[] = []
  let best = 0
  let firstFail = false
  let banEscalated = false
  let lastFailRetryAfterMs = 0

  for (const c of CONCURRENCY_LADDER) {
    let out = await probeLevel('concurrency', c, targets, c, STAGE1_BATCH_GAP_MS, opts)
    // zz-a2 韧性: 首档撞临时封禁期 → 冷却后重探一次(仅首档, 每阶段至多一次)
    if (!out.trace.pass && c === CONCURRENCY_LADDER[0] && looksLikeBanResidue(out)) {
      await cooldownAfterFail(out, opts.shouldAbort)
      out = await probeLevel('concurrency', c, targets, c, STAGE1_BATCH_GAP_MS, opts, '临时封禁冷却后重探')
    }
    traces.push(out.trace)
    if (out.banEscalated) {
      banEscalated = true
      lastFailRetryAfterMs = out.maxRetryAfterMs
      break
    }
    if (out.trace.pass) {
      best = c
    } else {
      // 首档(并发=1)即失败 / 或后续档失败封顶 — 限流单调, 停止升档
      if (best === 0) firstFail = true
      lastFailRetryAfterMs = out.maxRetryAfterMs
      await cooldownAfterFail(out, opts.shouldAbort)
      break
    }
    // 档间冷却: 突发窗隔离 + 60s 窗口排空
    await sleepAbortable(LEVEL_GAP_MS + LEVEL_COOLDOWN_MS, opts.shouldAbort)
  }
  return { best, traces, firstFail, banEscalated, lastFailRetryAfterMs, fallbackInterval: 0 }
}

/** 阶段2 探速率(并发固定) */
async function stageRate(opts: CalibrateOptions, targets: string[], concurrency: number): Promise<StageOutcome> {
  const traces: CalibrationTrace[] = []
  let best = 0
  let firstFail = false
  let banEscalated = false
  let lastFailRetryAfterMs = 0
  let fallbackInterval = 0

  for (const gap of INTERVAL_LADDER) {
    let out = await probeLevel('rate', gap, targets, concurrency, gap, opts)
    // zz-a2 韧性: 首档撞临时封禁期 → 冷却后重探一次(仅首档, 每阶段至多一次)
    if (!out.trace.pass && gap === INTERVAL_LADDER[0] && looksLikeBanResidue(out)) {
      await cooldownAfterFail(out, opts.shouldAbort)
      out = await probeLevel('rate', gap, targets, concurrency, gap, opts, '临时封禁冷却后重探')
    }
    traces.push(out.trace)
    if (out.banEscalated) {
      banEscalated = true
      lastFailRetryAfterMs = out.maxRetryAfterMs
      break
    }
    if (out.trace.pass) {
      best = gap
    } else {
      if (best === 0) {
        firstFail = true
        // 全档皆败(含首档): 保守外推 首档间隔×1.3
        fallbackInterval = Math.round(INTERVAL_LADDER[0] * 1.3)
      }
      lastFailRetryAfterMs = out.maxRetryAfterMs
      await cooldownAfterFail(out, opts.shouldAbort)
      break
    }
    await sleepAbortable(LEVEL_GAP_MS + LEVEL_COOLDOWN_MS, opts.shouldAbort)
  }
  return { best, traces, firstFail, banEscalated, lastFailRetryAfterMs, fallbackInterval }
}

/**
 * 阶段3 验证: 以给定参数按真实采集节奏(并发批 + 批间随机间隔)跑完整四段链路,
 * 零 429/403/异常 才算 pass
 */
async function stageVerify(
  opts: CalibrateOptions,
  chainUrls: string[],
  threadMax: number,
  intervalMin: number,
  intervalMax: number
): Promise<LevelOutcome> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  let hit429 = 0
  let hit403 = 0
  let other = 0
  let banEscalated = false
  let maxRetryAfterMs = 0
  let done = 0

  while (done < VERIFY_REQUESTS) {
    if (opts.shouldAbort?.()) throw new CalibrateAbort()
    const batch = chainUrls.slice(done, done + threadMax)
    done += batch.length
    const replies = await Promise.all(batch.map((u) => probeFetch(u, timeoutMs)))
    for (const rp of replies) {
      if (rp.retryAfterMs > maxRetryAfterMs) maxRetryAfterMs = rp.retryAfterMs
      if (rp.status === 429) hit429++
      else if (rp.status === 403) hit403++
      else if (rp.status === 410) {
        other++
        banEscalated = true
      } else if (rp.status === 0 || rp.status >= 400) other++
    }
    if (done < VERIFY_REQUESTS) {
      const gap = intervalMin + Math.random() * Math.max(0, intervalMax - intervalMin)
      await sleepAbortable(gap, opts.shouldAbort)
    }
  }

  const pass = hit429 + hit403 + other === 0
  const trace: CalibrationTrace = {
    stage: 'verify',
    param: threadMax,
    requests: VERIFY_REQUESTS,
    hit429,
    hit403,
    other,
    pass,
    note: banEscalated
      ? '遭遇410永久封禁信号'
      : pass
        ? `验证通过: 并发${threadMax} / 间隔${intervalMin}~${intervalMax}ms`
        : `验证失败: 并发${threadMax} / 间隔${intervalMin}~${intervalMax}ms${hit429 ? `, 429×${hit429}` : ''}${hit403 ? `, 403×${hit403}` : ''}${other ? `, 异常×${other}` : ''}`,
  }
  opts.onProgress?.(trace)
  return { trace, banEscalated, maxRetryAfterMs }
}

const PROFILE_LABEL: Record<CalibrateProfile, string> = { lenient: '宽松档', standard: '标准档', strict: '严格档' }

/**
 * 校准主入口: 三阶段探测 → 极限并发/最小安全间隔 → 可落库 recommended
 * (cfg 当前仅用于读取规则既有 hostGateLimit 作对比说明, 见文件头注释)
 */
export async function calibrateRule(cfg: RuleConfig, opts: CalibrateOptions): Promise<CalibrationResult> {
  const t0 = Date.now()
  const base = opts.siteBase.replace(/\/+$/, '')
  const profile = opts.profile
  const label = PROFILE_LABEL[profile] ?? profile

  // zz-a2: 重置模拟源站(仅回环地址, 调用方安全门)——上一轮残余的 429 计数/临时封禁
  // 会推进封禁升级链污染本轮探测; 失败静默忽略(真实站点该端点不存在, 404/405 无副作用)
  let actualProfileNote = ''
  if (opts.resetBefore) {
    await fetch(`${base}/reset`, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => {})
    // zz-a3: 档位一致性提醒 —— /reset 成功说明对端是模拟源站, 读 /stats.profile 与请求档位比对,
    // 不一致时在结果中提示(源站实际按它自己的档位限流, 请求档位仅是标签, 不提醒会误导结论)
    try {
      const st = await fetch(`${base}/stats`, { signal: AbortSignal.timeout(3000) })
      if (st.ok) {
        const sj: any = await st.json()
        const ap = typeof sj?.profile === 'string' ? sj.profile : ''
        if (ap && ap !== profile) actualProfileNote = `⚠ 模拟源站实际运行档位为「${ap}」, 与请求档位「${profile}」不一致, 结果按源站实际档位计; 请以对应档位重启 ratelimit-site 后重测`
      }
    } catch { /* 非模拟源站或观测失败, 无提醒 */ }
  }

  // 探测目标: 阶段1/2 用章节混合池(10 条循环取样); 阶段3 用完整四段链路 20 条
  const chapterUrls = Array.from({ length: 10 }, (_, i) => `${base}/chapter/1/${i + 1}`)
  const chainUrls = [`${base}/list/1`, `${base}/book/1`, `${base}/toc/1`, ...Array.from({ length: 17 }, (_, i) => `${base}/chapter/1/${i + 1}`)]

  const traces: CalibrationTrace[] = []
  const push = (out: LevelOutcome) => {
    traces.push(out.trace)
  }

  const thresholdNote =
    `判定阈值: 探测档 (429+403+其他异常)/12 ≤ ${PASS_FAIL_RATIO * 100}% 为通过, 验证档 ${VERIFY_REQUESTS} 请求零 429/403/异常; ` +
    `并发梯 ${CONCURRENCY_LADDER.join('→')}, 间隔梯 ${INTERVAL_LADDER.join('→')}ms; ` +
    `hostGateLimit 钳 1~${HOST_GATE_CLAMP_MAX}(hostgate 上限 10, 保守 8)` +
    (cfg?.fetch?.hostGateLimit ? `; 规则当前 hostGateLimit=${cfg.fetch.hostGateLimit}` : '')

  // ---------- 阶段1 探并发 ----------
  const s1 = await stageConcurrency(opts, chapterUrls)
  s1.traces.forEach((t) => traces.push(t))

  if (s1.firstFail || s1.banEscalated) {
    // 提前终止: 首档即被限流(源站防护极严)或遭遇永久封禁信号 → 最保守配置
    const reason = s1.banEscalated ? '遭遇 410 永久封禁信号' : '并发首档(1)即在充分安全节奏下被限流'
    return {
      ok: false,
      maxConcurrency: 1,
      minIntervalMs: INTERVAL_LADDER[0],
      safeThresholdNote: thresholdNote,
      recommended: { hostGateLimit: 1, threadMin: 1, threadMax: 1, intervalMin: INTERVAL_LADDER[0], intervalMax: Math.round(INTERVAL_LADDER[0] * 2.5) },
      trace: traces,
      message: `${label}源站下${reason}, 校准提前终止, 已输出最保守配置(并发 1 / 间隔 ${INTERVAL_LADDER[0]}ms)`,
      durationMs: Date.now() - t0,
      finishedAt: new Date().toISOString(),
    }
  }

  // ---------- 阶段间窗口排空 ----------
  await sleepAbortable(Math.min(COOLDOWN_MAX_MS, Math.max(STAGE_DRAIN_MS, s1.lastFailRetryAfterMs)), opts.shouldAbort)

  // ---------- 阶段2 探速率 ----------
  const s2 = await stageRate(opts, chapterUrls, s1.best)
  s2.traces.forEach((t) => traces.push(t))
  let maxConcurrency = s1.best
  let minIntervalMs = s2.best > 0 ? s2.best : s2.fallbackInterval || INTERVAL_LADDER[0]
  if (s2.best === 0) maxConcurrency = Math.max(1, maxConcurrency) // 全败时并发仍取阶段1实测值

  // ---------- 阶段间窗口排空 ----------
  await sleepAbortable(Math.min(COOLDOWN_MAX_MS, Math.max(STAGE_DRAIN_MS, s2.lastFailRetryAfterMs)), opts.shouldAbort)

  // ---------- 阶段3 验证 ----------
  let threadMax = Math.min(HOST_GATE_CLAMP_MAX, Math.max(1, maxConcurrency))
  let intervalMin = minIntervalMs
  let intervalMax = Math.round(minIntervalMs * 2.5)
  let ok = false
  let fallbackApplied = false

  const v1 = await stageVerify(opts, chainUrls, threadMax, intervalMin, intervalMax)
  push(v1)
  if (v1.trace.pass) {
    ok = true
  } else if (v1.banEscalated) {
    // 永久封禁信号: 不再重试, 直接保守定论
    ok = false
  } else {
    // 回退一档: 并发-1 且 间隔×1.3, 再验一次
    await cooldownAfterFail(v1, opts.shouldAbort)
    fallbackApplied = true
    threadMax = Math.max(1, threadMax - 1)
    intervalMin = Math.round(intervalMin * 1.3)
    intervalMax = Math.round(intervalMin * 2.5)
    const v2 = await stageVerify(opts, chainUrls, threadMax, intervalMin, intervalMax)
    push(v2)
    ok = v2.trace.pass
    // 回退验证后的数值即"已验证安全"的保守值, 同步回写结论字段
    maxConcurrency = Math.min(maxConcurrency, threadMax)
    minIntervalMs = intervalMin
  }

  const recommended = {
    hostGateLimit: threadMax, // = threadMax, 钳 1~8
    threadMin: Math.max(1, Math.floor(threadMax / 2)),
    threadMax,
    intervalMin,
    intervalMax,
  }

  const parts: string[] = [`${label}源站下安全极限: 并发 ${maxConcurrency} / 间隔 ${minIntervalMs}ms`]
  if (actualProfileNote) parts.push(actualProfileNote)
  if (fallbackApplied) parts.push(`验证未过已回退一档(并发-1/间隔×1.3)后${ok ? '复验通过' : '复验仍败, 输出保守值'}`)
  if (s2.best === 0) parts.push('速率档全败, 取保守外推间隔')
  if (!ok) parts.push('未达验证标准, 请勿直接采用')

  return {
    ok,
    maxConcurrency,
    minIntervalMs,
    safeThresholdNote: thresholdNote,
    recommended,
    trace: traces,
    message: parts.join('; '),
    durationMs: Date.now() - t0,
    finishedAt: new Date().toISOString(),
  }
}
