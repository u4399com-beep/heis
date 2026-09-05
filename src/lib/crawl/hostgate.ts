// ============================================================
// hostGate — 同站并发+速率 双维闸门 (反反爬核心组件, 按worklog y轮规格重建, zz-b 增速率维度)
//
// 设计语义:
//  1. 每 host 一个槽位账本: { inFlight, limit, baseLimit, penaltyUntil, failStreak, successStreak,
//     waiters, minGapMs, lastAdmitAt, rateLimitedUntil, gapTimer, penaltyTimer }
//  2. 计账式释放: release 只做 inFlight-- 且触发一次无偏向的容量复查(pump),
//     不把槽位"递给"任何特定等待者; 等待者按 FIFO 队头次序自行复查
//     "limit - inFlight > 0" 并自计入账(inFlight++ 在准入路径执行) ——
//     新请求必须排在既存等待者之后(队空+有余量才走快速通道), 杜绝唤醒式
//     设计的 barge 插队问题(历史 x-a遗留③)
//  3. 降额: 同 host 连续失败(抓取抛错/返回挑战页)≥3 次 → limit-1(最低1),
//     60s 冷却(penaltyUntil)内不再降; 连续成功≥10 次 → limit+1(不超过配置基准 baseLimit)。
//     降额不动在飞请求(存量自然回落), 新请求按回落后的实际余量准入
//  4. 内存态不跨进程重启(重启即解除降额); globalThis 单例防 dev 热重载
//     复用旧实例(cleaner __novelT2S_v2 同款做法), 多任务并行时同 host
//     共享同一闸门
//  5. 速率节流(zz-b): 同 host 相邻准入最小间隔 minGapMs(跟随最近一次 acquire 传入值,
//     缺省 0=不限速, 完全兼容既有调用方)。并发与速率双维独立生效: limit 管"同时在飞",
//     minGapMs 管"准入节奏"。准入判定 = 并发余量 + 节流到点(Date.now()-lastAdmitAt ≥
//     minGapMs); 未到点时队首卡住整个 pump(不得跳过队首放行后面的人, FIFO 无 barge
//     语义不变), 由单一定时器(gapTimer, 重复先 clear 再设)到点唤醒 pump。
//     每次准入成功(快速通道与 pump 路径同口径)更新 lastAdmitAt=Date.now();
//     release/report 触发的 pump 同样过节流判定(释放后也不得背靠背放行)
//  6. 限流冷却(zz-b): reportHostRateLimited(源站 429 感知)把 rateLimitedUntil 推后至
//     now + cooldown —— Retry-After 缺省/非法/过小(<1s)兜底 30s, 显式合法值如实采纳
//     (≥1s 噪声底, 上限钳 120s; 任务书公式与其验证条款矛盾, 取验证口径, 见函数内注);
//     冷却期内 pump 不放行(整队停手), 到点由单一定时器(penaltyTimer)唤醒; 冷却结束时
//     清零 failStreak(给站点恢复机会)。与降额冷却 penaltyUntil 语义严格区分:
//     penaltyUntil = 降额【操作】的节流窗 —— 冷却的是"再降一档"这个动作(期间照常准入);
//     rateLimitedUntil = 源站限流【准入】的停手窗 —— 冷却的是所有请求准入(期间一个不放)
// ============================================================

/** 同 host 在飞上限默认值(章节抓取场景) */
export const HOST_GATE_DEFAULT_LIMIT = 3
export const HOST_GATE_MIN_LIMIT = 1
export const HOST_GATE_MAX_LIMIT = 10
/** 槽满等待超时上限 */
export const HOST_GATE_WAIT_TIMEOUT_MS = 30_000
/** 连续失败≥N 次触发降额 */
const DERATE_FAIL_STREAK = 3
/** 降额冷却: 距上次降额 60s 内不再降 */
const DERATE_COOLDOWN_MS = 60_000
/** 连续成功≥N 次回升一档 */
const RECOVER_SUCCESS_STREAK = 10
/** 限流冷却缺省时长(zz-b): Retry-After 缺省/过小时兜底 30s */
export const HOST_GATE_RATE_LIMIT_DEFAULT_MS = 30_000
/** 限流冷却上限钳制(zz-b): 服务端给出离谱大值时最多停手 120s */
export const HOST_GATE_RATE_LIMIT_MAX_MS = 120_000

interface Waiter {
  timer: ReturnType<typeof setTimeout> | null
  resolve: (ticket: HostGateTicket) => void
  reject: (e: Error) => void
  settled: boolean
}

export interface HostGateTicket {
  /** 准入的 host 键(URL host 小写, 含非默认端口) */
  host: string
}

/** 降额事件(reportHostFailure 命中降额时返回, 供 runner 写 taskLog) */
export interface HostGateDerateEvent {
  host: string
  /** 触发本次降额时的连续失败次数 */
  failStreak: number
  oldLimit: number
  newLimit: number
}

interface HostState {
  /** host 键(账本主键, 准入票据回执用) */
  host: string
  /** 当前在飞(已准入未释放)请求数 */
  inFlight: number
  /** 当前生效并发上限(降额/回升动态调整) */
  limit: number
  /** 配置基准(最近一次 acquire 传入的钳制值), 回升天花板 */
  baseLimit: number
  /** 连续失败计数(成功清零) */
  failStreak: number
  /** 连续成功计数(失败清零) */
  successStreak: number
  /** 降额冷却截止时刻(ms): 该时刻前不再降额(注意: 只冷却"再降额"动作, 不阻准入) */
  penaltyUntil: number
  /** FIFO 等待队列(防 barge: 新请求不得越过队头) */
  waiters: Waiter[]
  /** 同 host 相邻准入最小间隔 ms(zz-b, 跟随最近一次 acquire 传入值, 缺省 0=不限速) */
  minGapMs: number
  /** 上次准入时刻 ms(zz-b, 初始 0=首请求免等); 准入判定: Date.now()-lastAdmitAt ≥ minGapMs */
  lastAdmitAt: number
  /** 限流冷却截止时刻 ms(zz-b, 429 感知): 该时刻前 pump 不放行任何请求(初始 0=无冷却) */
  rateLimitedUntil: number
  /** 节流到点唤醒定时器(单一定时器, 重复先 clear 再设; unref 不阻进程退出) */
  gapTimer: ReturnType<typeof setTimeout> | null
  /** 限流冷却到点唤醒定时器(单一定时器, 同款) */
  penaltyTimer: ReturnType<typeof setTimeout> | null
}

// ---------- globalThis 单例(防 dev 热重载多实例各记一套账) ----------
const globalForGate = globalThis as unknown as { __novelHostGate_v1?: Map<string, HostState> }

function gates(): Map<string, HostState> {
  if (!globalForGate.__novelHostGate_v1) globalForGate.__novelHostGate_v1 = new Map()
  return globalForGate.__novelHostGate_v1
}

function clampLimit(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : HOST_GATE_DEFAULT_LIMIT
  return Math.min(HOST_GATE_MAX_LIMIT, Math.max(HOST_GATE_MIN_LIMIT, n))
}

function stateOf(host: string, baseLimit: number): HostState {
  const map = gates()
  let st = map.get(host)
  if (!st) {
    st = {
      host,
      inFlight: 0,
      limit: baseLimit,
      baseLimit,
      failStreak: 0,
      successStreak: 0,
      penaltyUntil: 0,
      waiters: [],
      minGapMs: 0,
      lastAdmitAt: 0,
      rateLimitedUntil: 0,
      gapTimer: null,
      penaltyTimer: null,
    }
    map.set(host, st)
  }
  return st
}

/** host 键: URL host 小写(含非默认端口, 同主机不同端口视为不同站, 与 Cookie 罐分键口径一致) */
export function hostGateKeyOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/** 限流冷却到期结算(惰性, 统一在 pump/acquire 入口跑): 清零连败(给站点恢复机会)并清空标记 */
function settleRateLimitExpiry(st: HostState): void {
  if (st.rateLimitedUntil > 0 && Date.now() >= st.rateLimitedUntil) {
    st.rateLimitedUntil = 0
    st.failStreak = 0
  }
}

/**
 * 容量复查(计账式准入核心): 从 FIFO 队头起, 让等待者自行复查
 * "limit - inFlight > 0" 并自计入账。降额(limit 变小)时在飞不中断,
 * 队头反复复查直到存量回落到余量>0 才放行 —— 即"存量自然回落"。
 * zz-b 增量: 队头复查条件加"节流到点 + 非限流冷却期"两道闸 ——
 * 队首未到点时整个 pump 停止(不得跳过队首放行后面的人, FIFO 无 barge 不变),
 * 由 gapTimer/penaltyTimer 单一定时器到点唤醒重查
 */
function pump(st: HostState) {
  settleRateLimitExpiry(st) // 冷却到期: 先结算(清零连败)再放行
  if (st.waiters.length === 0) return
  // 限流冷却期内整队不放行, 安排到点唤醒(单一定时器)
  if (Date.now() < st.rateLimitedUntil) {
    armPenaltyTimer(st)
    return
  }
  while (st.waiters.length > 0) {
    if (st.limit - st.inFlight <= 0) return // 并发余量不足: 等 release 触发下一次复查
    if (Date.now() - st.lastAdmitAt < st.minGapMs) break // 节流未到点: 卡住整个队列(无 barge)
    const w = st.waiters.shift()!
    if (w.settled) continue
    w.settled = true
    if (w.timer) { clearTimeout(w.timer); w.timer = null }
    st.inFlight++ // 准入计账(非 release 派发)
    st.lastAdmitAt = Date.now() // zz-b: 每次准入刷新节奏锚点
    w.resolve({ host: st.host })
  }
  // 队列仍有等待者且余量尚在 → 因节流暂停, 安排到点唤醒
  if (st.waiters.length > 0 && st.limit - st.inFlight > 0) armGapTimer(st)
}

/** 节流到点唤醒定时器(单一定时器, 重复先 clear 再设; unref 同等待者超时 timer) */
function armGapTimer(st: HostState) {
  if (st.gapTimer) { clearTimeout(st.gapTimer); st.gapTimer = null }
  const wait = st.lastAdmitAt + st.minGapMs - Date.now()
  if (wait <= 0) return // 已到点(pump 判定路径理论不可达, 保险不设负延时)
  const t = setTimeout(() => {
    st.gapTimer = null
    pump(st)
  }, wait)
  ;(t as unknown as { unref?: () => void }).unref?.()
  st.gapTimer = t
}

/** 限流冷却到点唤醒定时器(单一定时器, 同款) */
function armPenaltyTimer(st: HostState) {
  if (st.penaltyTimer) { clearTimeout(st.penaltyTimer); st.penaltyTimer = null }
  const wait = st.rateLimitedUntil - Date.now()
  if (wait <= 0) return
  const t = setTimeout(() => {
    st.penaltyTimer = null
    pump(st)
  }, wait)
  ;(t as unknown as { unref?: () => void }).unref?.()
  st.penaltyTimer = t
}

/**
 * 过闸获取槽位: 有余量 + 无排队者 + 非限流冷却期 + 节流到点 → 立即准入;
 * 否则入 FIFO 队尾, 由 release/报告/定时器路径触发的 pump 复查准入。
 * 等待超过 timeoutMs 抛错(调用方按章节失败处理, 章节保持未采集状态供增量重试)。
 * zz-b: minGapMs 缺省 0(既有调用方零感知); 传入值跟随最近一次 acquire
 * (语义同 baseLimit 配置跟随, 在线调参立即生效)
 */
export function acquireHostGate(
  url: string,
  opts?: { limit?: number; timeoutMs?: number; minGapMs?: number }
): Promise<HostGateTicket> {
  const host = hostGateKeyOf(url)
  const baseLimit = clampLimit(opts?.limit)
  const timeoutMs = Math.max(1000, opts?.timeoutMs ?? HOST_GATE_WAIT_TIMEOUT_MS)
  const minGapMs = opts?.minGapMs != null && Number.isFinite(opts.minGapMs) ? Math.max(0, Math.round(opts.minGapMs)) : 0

  // 无效 URL(空 host): 不设闸直接放行, 语义与"无 host 可限"一致
  if (!host) return Promise.resolve({ host: '' })

  const st = stateOf(host, baseLimit)
  // 配置基准跟随最近一次配置(在线调参生效); 配置收紧立即压低生效上限,
  // 已准入请求不中断(存量自然回落)
  st.baseLimit = baseLimit
  if (st.limit > st.baseLimit) st.limit = st.baseLimit
  // zz-b: 速率基准同样跟随最近一次传入(缺省 0 不覆盖不了节流——传 0 即显式取消节流)
  st.minGapMs = minGapMs
  settleRateLimitExpiry(st)

  const now = Date.now()
  // 快速通道: 队列为空(不越过任何等待者) + 有余量 + 非限流冷却期 + 节流到点
  if (
    st.waiters.length === 0 &&
    st.limit - st.inFlight > 0 &&
    now >= st.rateLimitedUntil &&
    now - st.lastAdmitAt >= st.minGapMs
  ) {
    st.inFlight++
    st.lastAdmitAt = Date.now()
    return Promise.resolve({ host })
  }

  return new Promise<HostGateTicket>((resolve, reject) => {
    const w: Waiter = {
      timer: null,
      resolve,
      reject,
      settled: false,
    }
    w.timer = setTimeout(() => {
      if (w.settled) return
      w.settled = true
      const i = st.waiters.indexOf(w)
      if (i >= 0) st.waiters.splice(i, 1)
      const e = new Error(`同站并发闸门等待超时(${Math.round(timeoutMs / 1000)}s): ${host} limit=${st.limit} inFlight=${st.inFlight} waiting=${st.waiters.length}`)
      e.name = 'HostGateTimeout'
      w.reject(e)
    }, timeoutMs)
    // 测试脚本/一次性进程不因挂起计时器拖住退出
    ;(w.timer as unknown as { unref?: () => void }).unref?.()
    st.waiters.push(w)
    pump(st) // 排队瞬间可能已有余量(与 release 竞态), 入队后立即复查(节流/冷却判定同款)
  })
}

/**
 * 释放槽位(计账式): 只做 inFlight-- , 不把槽位派发给特定等待者;
 * 随后触发一次无偏向容量复查, 由队头等待者自查余量自准入。
 * zz-b: 复查同样过节流/限流冷却判定 —— 释放后若节流未到点, 队首继续等
 * gapTimer 唤醒, 不得借释放之机背靠背放行。
 * 必须 try/finally 成对调用, AbortError 中止路径同样要释放防槽位泄漏
 */
export function releaseHostGate(ticket: HostGateTicket): void {
  if (!ticket?.host) return
  const st = gates().get(ticket.host)
  if (!st) return
  if (st.inFlight > 0) st.inFlight--
  pump(st)
}

/** 同 host 连续成功≥10 次 → limit+1(不超过配置基准); 任一失败清零成功链 */
export function reportHostSuccess(url: string): void {
  const st = gates().get(hostGateKeyOf(url))
  if (!st) return
  st.failStreak = 0
  st.successStreak++
  if (st.successStreak >= RECOVER_SUCCESS_STREAK && st.limit < st.baseLimit) {
    st.limit = Math.min(st.baseLimit, st.limit + 1)
    st.successStreak = 0
    pump(st) // 上限回升, 排队者可准入(仍过节流判定)
  }
}

/**
 * 同 host 连续失败(抓取抛错/返回挑战页)计账: ≥3 次降一档(最低1),
 * 60s 冷却内不重复降(冷却后再次凑满 3 连败才继续降)。
 * 命中实际降额时返回事件(供 runner 写 taskLog 观测), 否则返回 null
 */
export function reportHostFailure(url: string): HostGateDerateEvent | null {
  const st = gates().get(hostGateKeyOf(url))
  if (!st) return null
  st.successStreak = 0
  st.failStreak++
  const now = Date.now()
  if (st.failStreak >= DERATE_FAIL_STREAK && now >= st.penaltyUntil) {
    st.penaltyUntil = now + DERATE_COOLDOWN_MS
    st.failStreak = 0
    const oldLimit = st.limit
    if (st.limit > HOST_GATE_MIN_LIMIT) {
      st.limit = st.limit - 1
      return { host: hostGateKeyOf(url), failStreak: DERATE_FAIL_STREAK, oldLimit, newLimit: st.limit }
    }
    // 已在最低档: 冷照样生效, 但无可观测变化不产生事件
  }
  return null
}

/**
 * 源站限流(429)感知记账(zz-b): 把 rateLimitedUntil 推后至
 * now + max(retryAfterMs ?? 30s, 30s)(Retry-After 缺省/过小兜底 30s, 钳上限 120s)。
 * 冷却期内 pump 不放行任何请求(到点 penaltyTimer 唤醒); 冷却到期时清零 failStreak
 * (连败账让位给"站点恢复"假设, 403 降额链不受影响——两条冷却语义独立)。
 * 返回本次是否实际推后了冷却期(true=调用方应写观测日志; 重复 429 只在推后时报)
 */
export function reportHostRateLimited(url: string, retryAfterMs?: number): boolean {
  const st = gates().get(hostGateKeyOf(url))
  if (!st) return false
  // 冷却时长: 缺省/非法值/过小(<1s, 解析噪声) → 30s 兜底; 显式合法值如实采纳(≥1s 噪声底,
  // Retry-After 感知本意=尊重服务端给值) —— 任务书公式 max(retryAfterMs??30s, 30s) 与其验证
  // 条款"retryAfterMs=2000 → acquire 等待≈2s"互相矛盾, 以验证条款为准取后者口径; 上限钳 120s
  const ra = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) ? Math.round(retryAfterMs) : 0
  const cooldown = ra >= 1000 ? Math.min(HOST_GATE_RATE_LIMIT_MAX_MS, ra) : HOST_GATE_RATE_LIMIT_DEFAULT_MS
  const until = Date.now() + cooldown
  if (until <= st.rateLimitedUntil) return false // 已有更晚的冷却期在效, 不回拨不重复报
  st.rateLimitedUntil = until
  pump(st) // 立即复查: 若有等待者则安排 penaltyTimer 到点唤醒(pump 内冷却判定会拦住放行)
  return true
}

/** 观测快照(验证脚本/调试用): 目标 host 当前账本 */
export function hostGateSnapshot(url: string): {
  host: string
  inFlight: number
  limit: number
  baseLimit: number
  failStreak: number
  successStreak: number
  waiting: number
  /** 限流冷却截止时刻 ms(zz-b; 0=无冷却) */
  rateLimitedUntil: number
  /** 当前生效同 host 准入最小间隔 ms(zz-b; 0=不限速) */
  minGapMs: number
  /** 上次准入时刻 ms(zz-b; 0=尚无准入) */
  lastAdmitAt: number
} | null {
  const host = hostGateKeyOf(url)
  const st = gates().get(host)
  if (!st) return null
  return {
    host,
    inFlight: st.inFlight,
    limit: st.limit,
    baseLimit: st.baseLimit,
    failStreak: st.failStreak,
    successStreak: st.successStreak,
    waiting: st.waiters.length,
    rateLimitedUntil: st.rateLimitedUntil,
    minGapMs: st.minGapMs,
    lastAdmitAt: st.lastAdmitAt,
  }
}

/** 清空全部闸门状态(验证脚本隔离用; 生产代码勿调): 连同挂起唤醒定时器一并清除 */
export function hostGateReset(): void {
  for (const st of gates().values()) {
    if (st.gapTimer) { clearTimeout(st.gapTimer); st.gapTimer = null }
    if (st.penaltyTimer) { clearTimeout(st.penaltyTimer); st.penaltyTimer = null }
  }
  gates().clear()
}
