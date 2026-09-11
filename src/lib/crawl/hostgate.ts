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
  /** R4-14: 最近一次 acquire 传入的 minGapMs 原值(用于检测"新 caller / 新 epoch"——
   *  不同于已记录值即视为新 caller 接管, 重置 st.minGapMs 为新值, 不再做 MAX 合并,
   *  防止旧 caller 留下的 60000ms 永久毒杀新 caller 的 500ms 节奏) */
  minGapMsLastValue: number
  /** R5-3: 进入限流冷却(rateLimitedUntil 被推后)前的 minGapMs 快照, 冷却到期后回滚用 */
  minGapMsBeforeCooldown: number
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
      minGapMsLastValue: 0,
      minGapMsBeforeCooldown: 0,
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

// ---------- LRU/容量治理(audit C-zz) ----------
// gates Map 历史上无界增长: 长 scrape 任务跨数千 host 后 Map 永不回收, 内存缓慢爬升。
// 治理:
//  1. 软上限 HOSTS_CAP=1000: 新 host 入账前若超限, 先 evictIdleHosts() 把空闲 host 清出
//  2. 周期性 sweep: 每 SWEEP_EVERY 次调用 acquireHostGate 时跑一遍 idle host 清理(惰性,
//     不引独立 setInterval, 与 cookieJar.prune 同款"摊销到调用路径"做法)
//  3. 仅驱逐 idle host(inFlight=0 && waiters=空 && penaltyUntil<now && rateLimitedUntil<now),
//     在飞/排队/冷却中的 host 永不驱逐(防止丢失未结算状态导致死锁)
const HOSTS_CAP = 1000
const SWEEP_EVERY = 100
// 计数器(globalThis 防 HMR 复用, 防热重载每轮模块重求值都重置)
const gSweep = globalThis as unknown as { __novelHostGateSweepN_v1?: number }

function isHostIdle(st: HostState, now: number): boolean {
  return st.inFlight === 0 &&
    st.waiters.length === 0 &&
    st.penaltyUntil < now &&
    st.rateLimitedUntil < now
}

/** 驱逐空闲 host: 清掉挂起定时器后从 Map 删键。Map 迭代顺序 = 插入顺序(ES2015+),
 *  命中第一个 idle host 即删, 摊销成本 O(1)。返回是否仍超限(供循环判断) */
function evictOneIdleHost(): boolean {
  const map = gates()
  const now = Date.now()
  for (const [host, st] of map) {
    if (isHostIdle(st, now)) {
      if (st.gapTimer) { clearTimeout(st.gapTimer); st.gapTimer = null }
      if (st.penaltyTimer) { clearTimeout(st.penaltyTimer); st.penaltyTimer = null }
      map.delete(host)
      return map.size > HOSTS_CAP
    }
  }
  return false
}

/** 周期性 sweep(惰性): 跑一遍所有 idle host 清理, 上限 SWEEP_MAX 防病态大 Map 单次过久 */
function sweepIdleHosts(): void {
  const map = gates()
  const now = Date.now()
  let removed = 0
  const SWEEP_MAX = 200
  for (const [host, st] of map) {
    if (removed >= SWEEP_MAX) break
    if (isHostIdle(st, now)) {
      if (st.gapTimer) { clearTimeout(st.gapTimer); st.gapTimer = null }
      if (st.penaltyTimer) { clearTimeout(st.penaltyTimer); st.penaltyTimer = null }
      map.delete(host)
      removed++
    }
  }
}

/** acquire 内调用: 计数 + 周期 sweep + 超限驱逐 */
function maybeSweepAndEvict(): void {
  if (gSweep.__novelHostGateSweepN_v1 === undefined) gSweep.__novelHostGateSweepN_v1 = 0
  gSweep.__novelHostGateSweepN_v1++
  if (gSweep.__novelHostGateSweepN_v1 % SWEEP_EVERY === 0) {
    sweepIdleHosts()
  }
  while (gates().size > HOSTS_CAP) {
    if (!evictOneIdleHost()) break // 全部非空闲, 不再强制驱逐(保护在飞状态)
  }
}

/** 限流冷却到期结算(惰性, 统一在 pump/acquire 入口跑): 清零连败(给站点恢复机会)并清空标记 */
function settleRateLimitExpiry(st: HostState): void {
  if (st.rateLimitedUntil > 0 && Date.now() >= st.rateLimitedUntil) {
    st.rateLimitedUntil = 0
    st.failStreak = 0
    // R5-3: 冷却到期时回滚 minGapMs 到冷却前快照 ——
    // reportHostRateLimited 触发后, acquire 路径会把 minGapMs 抬到 cooldownImpliedGap(如 30s);
    // 冷却到期若不回滚, 同 caller(同 minGapMs 值)继续走 else 分支 max(30000, 500)=30000,
    // 一次 429 永久毒杀该 caller 的节奏。回滚到 minGapMsBeforeCooldown(若已记录)
    if (st.minGapMsBeforeCooldown > 0) {
      st.minGapMs = st.minGapMsBeforeCooldown
      st.minGapMsBeforeCooldown = 0
    }
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
  // LRU/容量治理(audit C-zz): 摊销到每次 acquire —— 周期 sweep + 超限驱逐
  maybeSweepAndEvict()

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
  // zz-b Bug 6 修复 + R4-14: minGapMs 不再永久 MAX。
  //  旧行为 `st.minGapMs = Math.max(st.minGapMs, minGapMs)` —— caller A 设 60000ms 后,
  //  caller B 设 500ms 仍被卡在 60000ms(MAX 不会下降)。caller A 任务结束、host 由
  //  caller B 接管, 节奏却永不能恢复, 永久毒杀。
  //  修法: 记录 st.minGapMsLastValue, 新 caller 传入值与旧值不同时, 视为 caller 换代,
  //  重置 st.minGapMs 为新值(不 MAX, 替换)。同 caller(同 minGapMs 值)维持 MAX 合并
  //  以保留"限流冷却推后 minGapMs 防止冷却到期瞬间 admission storm"语义。
  //  限流冷却(rateLimitedUntil>now, 429 来自源站)生效时, minGapMs 不得低于冷却剩余时长
  //  —— 否则冷却到期瞬间, 节流早已放宽, 立即 admission storm 撞上原限流源站。
  //  (注: 本文件中 rateLimitedUntil 才是真正的"限流冷却"语义; penaltyUntil 是降额操作冷却,
  //  仅冷却"再降一档"动作, 不阻准入, 不在此判定内)
  const now0 = Date.now()
  const isNewCaller = st.minGapMsLastValue !== minGapMs
  if (isNewCaller) {
    st.minGapMsLastValue = minGapMs
    st.minGapMs = minGapMs
    // R6-2: caller 在限流冷却期间换代(旧 caller A 因 429 触发冷却, 新 caller B 启动) ——
    //  旧行为不更新 minGapMsBeforeCooldown 快照, 冷却到期时 settleRateLimitExpiry 把
    //  st.minGapMs 回滚到【旧 caller A 的 minGapMs 值】(如 500ms), 而【新 caller B】
    //  实际请求的 minGapMs 是 1000ms。结果新 caller 被以 500ms 节奏放行 → admission storm
    //  撞刚恢复的源站 → 立即再次 429。
    //  修法: caller 换代时同步把快照更新为新 caller 的 minGapMs 值, 冷却到期回滚到【新 caller】
    //  的实际请求值, 保持各 caller 节奏自洽。无冷却在效时本块不执行(快照保持为 0, 不影响)。
    if (st.rateLimitedUntil > now0 && st.minGapMsBeforeCooldown !== minGapMs) {
      st.minGapMsBeforeCooldown = minGapMs
    }
  }
  if (st.rateLimitedUntil > now0) {
    const cooldownImpliedGap = st.rateLimitedUntil - now0
    st.minGapMs = Math.max(st.minGapMs || 0, minGapMs, cooldownImpliedGap)
  } else if (isNewCaller) {
    // 已经在 if (isNewCaller) 分支赋值过 st.minGapMs = minGapMs; 不再重复
  } else {
    // 同 caller(同 minGapMs 值) 维持 MAX 合并语义(保留原 Bug 6 修复的 rate-limit 保护)
    st.minGapMs = Math.max(st.minGapMs || 0, minGapMs)
  }
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
  // R5-3: 首次进入冷却时(此前未在冷却)保存 minGapMs 快照, 供冷却到期回滚。
  // 重复推后冷却期(仍处于冷却中)不覆盖快照, 否则把被抬高后的 minGapMs 当作"原值"保存,
  // 回滚后将无法恢复到 caller 实际请求的 minGapMs。
  if (st.rateLimitedUntil <= Date.now()) {
    st.minGapMsBeforeCooldown = st.minGapMs
  }
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

/** 观测全局账本容量(audit C-zz): gates Map 当前总条目数 + 软上限, 供验证脚本/运维监控 */
export function hostGateStats(): { hosts: number; cap: number; sweepEvery: number } {
  return {
    hosts: gates().size,
    cap: HOSTS_CAP,
    sweepEvery: SWEEP_EVERY,
  }
}

/** 清空全部闸门状态(验证脚本隔离用; 生产代码勿调): 连同挂起唤醒定时器一并清除
 *  R4-15: 原 hostGateReset 只清 st.gapTimer/st.penaltyTimer, 不清 waiter.timer
 *  (per-waiter 30s 超时定时器)——waiters 数组在 map.clear() 后虽被 GC, 但已 setTimeout
 *  的 timer 仍持有对 waiter.reject 的闭包引用, 后续 fire 时调用 w.reject(Error) 把
 *  "HostGateTimeout" 抛给已结束的 awaiter(测试场景下成为 unhandled rejection)。
 *  现逐 host 显式 reject 所有 waiter 并清 timer, 让调用方立即收到 reset 信号 */
export function hostGateReset(): void {
  const resetErr = new Error('HostGate reset')
  resetErr.name = 'HostGateReset'
  for (const st of gates().values()) {
    if (st.gapTimer) { clearTimeout(st.gapTimer); st.gapTimer = null }
    if (st.penaltyTimer) { clearTimeout(st.penaltyTimer); st.penaltyTimer = null }
    // R4-15: 清空 waiter 30s 超时定时器并立即 reject, 防 fire 后调到已结束的 awaiter
    for (const w of st.waiters) {
      if (w.settled) continue
      w.settled = true
      if (w.timer) { clearTimeout(w.timer); w.timer = null }
      try { w.reject(resetErr) } catch { /* ignore */ }
    }
    st.waiters = []
  }
  gates().clear()
}

// ============================================================
// SSRF 辅助工具(R-E4 增量, 反反爬增强):
// 本模块不持有 SSRF 拒绝责任(fetcher.ts assertSafeTarget 是唯一准入闸门),
// 此处导出的纯函数供 fetcher.ts 未来增强 IP 字面量归一化时调用, 收口当前
// 已知 SSRF 绕过向量(十进制/八进制/十六进制 IP 编码、IPv4-mapped IPv6、
// 0.0.0.0 等)。当前为预置工具集, 无运行时调用方, 零回归。
// ============================================================

/**
 * 解析十进制/八进制/十六进制 IPv4 字面量 → 标准点分十进制。
 *  覆盖 SSRF 绕过向量:
 *   - 十进制整数: 2130706433 (= 127.0.0.1)
 *   - 八进制: 0177.0.0.1 / 017700000001 (单段八进制)
 *   - 十六进制: 0x7f.0.0.1 / 0x7f000001
 *   - 混合编码: 0x7f.0.0.1 (各段独立编码)
 *  返回标准 'a.b.c.d' 形态; 任一段非法/超 255 返回 null。
 *  非数字开头(域名形态)直接返回 null, 由调用方走 DNS 路径。
 */
export function normalizeIpLiteral(s: string): string | null {
  if (!s) return null
  const raw = s.trim().toLowerCase()
  // IPv6 (含 [::1] / [::ffff:1.2.3.4] 形态) → 不在 IPv4 归一化范围, 直接返回 null
  // (IPv6 范围判定在 assertSafeIp 已实现; 本函数只处理 IPv4 编码变体)
  if (raw.includes(':')) return null

  // 整段十进制整数(单一数字无点): 解析为 32 位整数再拆 4 段
  // 0 开头的纯数字串按八进制优先解析(0177 = 127, 017700000001 = 2130706433 = 127.0.0.1)
  // R-E4 修正: 早期版本把 Number('017700000001')=17700000001 当十进制判定超 0xFFFFFFFF 返回 null,
  // 丢了八进制形态的 SSRF 绕过检测。先按八进制解析, 失败再退回十进制
  if (/^\d+$/.test(raw) && !raw.includes('.')) {
    // 0 开头纯数字: 八进制优先(parseInt(radix=8) 在含 8/9 的串会失败, 失败则不是八进制)
    if (raw.length > 1 && raw[0] === '0' && /^[0-7]+$/.test(raw)) {
      const oct = parseInt(raw, 8)
      if (Number.isFinite(oct) && oct >= 0 && oct <= 0xFFFFFFFF) {
        return [(oct >>> 24) & 0xFF, (oct >>> 16) & 0xFF, (oct >>> 8) & 0xFF, oct & 0xFF].join('.')
      }
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || n > 0xFFFFFFFF) return null
    return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.')
  }

  // 单段 0x 十六进制(无点): 0x7f000001
  if (/^0x[0-9a-f]+$/.test(raw) && !raw.includes('.')) {
    const n = parseInt(raw, 16)
    if (!Number.isFinite(n) || n > 0xFFFFFFFF) return null
    return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.')
  }

  // 点分形态: 每段独立解析(允许混编: 0x7f.0.0.1 / 0177.0.0.1 / 127.0.0.1)
  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const p of parts) {
    if (!p) return null
    let n: number
    if (/^0x[0-9a-f]+$/.test(p)) n = parseInt(p, 16)
    else if (/^0[0-7]+$/.test(p) && p.length > 1) n = parseInt(p, 8)
    else if (/^\d+$/.test(p)) n = parseInt(p, 10)
    else if (/^[0-9a-f]+$/.test(p) && p.length <= 8) n = parseInt(p, 16) // 无前缀十六进制段(罕见, 但浏览器接受)
    else return null
    if (!Number.isFinite(n) || n < 0 || n > 255) return null
    bytes.push(n)
  }
  return bytes.join('.')
}

/**
 * IP 字面量安全判定(R-E4 同步版, 无 DNS 解析):
 *  - 先归一化(覆盖十进制/八进制/十六进制 IPv4 编码绕过)
 *  - 再判范围(私网/回环/链路本地/CGNAT/云元数据/0.0.0.0)
 *  - IPv6 解析(展开 16 字节, 含 v4-mapped 嵌入兜底)
 *  allowLoopback=true 时放行 127.0.0.0/8 / ::1 / localhost 等回环
 *  与 fetcher.ts assertSafeIp 同口径, 但接受非十进制编码 IP 输入
 */
export function isPrivateIp(ip: string, allowLoopback = false): boolean {
  if (!ip) return false
  const normalized = normalizeIpLiteral(ip)
  if (normalized) {
    // 命中 IPv4 黑名单(与 fetcher.ts assertSafeIp 同口径, 含 0.0.0.0/8)
    if (normalized === '169.254.169.254' || normalized === '169.254.169.253') return true
    if (/^169\.254\./.test(normalized)) return true // 链路本地
    if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(normalized)) return true // CGNAT
    if (/^10\./.test(normalized)) return true // 私网
    if (/^192\.168\./.test(normalized)) return true
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true
    if (/^0\./.test(normalized)) return true // 0.0.0.0/8 不可路由
    if (/^127\./.test(normalized)) return !allowLoopback
    return false
  }
  // IPv6 解析(简化版: 仅判定常见私网形态, 复杂展开与 fetcher.ts assertSafeIp 一致由调用方决策)
  const addr = ip.replace(/^\[|\]$/g, '').split('%')[0]
  if (!addr || !addr.includes(':')) return false
  // ::1 / ::ffff:127.0.0.1 等回环形态
  if (addr === '::1') return !allowLoopback
  if (/^::ffff:/.test(addr.toLowerCase())) {
    const v4 = addr.toLowerCase().replace(/^::ffff:/, '')
    return isPrivateIp(v4, allowLoopback)
  }
  if (/^fe[89ab][0-9a-f]:/i.test(addr)) return true // fe80::/10 链路本地
  if (/^f[cd][0-9a-f]{2}:/i.test(addr)) return true // fc00::/7 ULA
  return false
}

/**
 * DNS 重新绑定检测辅助(R-E4): 对 hostname 做多次 lookup, 验证返回 IP 集合稳定。
 *  TOCTOU 攻击场景: 守卫校验通过 → fetch 再发起 → DNS 被重绑 → fetch 实际连到内网。
 *  本工具做"快照一致性"检查(非彻底修复, 真正修复需 fetch 注入 lookup 选项, 见 fetcher.ts
 *  R5-19 已知限制), 供 fetcher.ts 未来在 fetch 前后调用比对 IP 集合。
 *  返回 { stable, ips, history }, stable=true 表示多次解析结果一致(攻击窗口未触发)
 */
export interface DnsStabilityResult {
  stable: boolean
  /** 首次解析的 IP 列表(若任一 IP 是私网, 调用方应判 SSRF 拒绝) */
  ips: string[]
  /** 各轮解析结果, 供审计 */
  history: string[][]
  /** 命中私网 IP 时给出原因(供 SSRF 拒绝日志) */
  privateHit?: { ip: string; reason: string }
}

export async function verifyDnsStability(
  hostname: string,
  opts?: { rounds?: number; intervalMs?: number; allowLoopback?: boolean }
): Promise<DnsStabilityResult> {
  const rounds = Math.min(5, Math.max(2, opts?.rounds ?? 3))
  const intervalMs = Math.min(1000, Math.max(0, opts?.intervalMs ?? 50))
  const allowLoopback = opts?.allowLoopback === true
  const history: string[][] = []
  let firstIps: string[] = []
  let privateHit: { ip: string; reason: string } | undefined
  try {
    const { promises: dnsPromises } = await import('node:dns')
    for (let i = 0; i < rounds; i++) {
      try {
        const results = await dnsPromises.lookup(hostname, { all: true, family: 0 })
        const ips = results.map((r) => r.address).sort()
        history.push(ips)
        if (i === 0) {
          firstIps = ips
          // 首轮检查: 任一 IP 命中私网即记 privateHit
          for (const ip of ips) {
            if (isPrivateIp(ip, allowLoopback)) {
              privateHit = { ip, reason: `hostname ${hostname} → ${ip} 命中私网/保留段` }
              break
            }
          }
        }
        // 后续轮次比对: IP 集合不同即视为不稳定(可能 DNS rebinding)
        if (i > 0 && JSON.stringify(ips) !== JSON.stringify(firstIps)) {
          return { stable: false, ips: firstIps, history, privateHit }
        }
      } catch {
        // 单轮解析失败: 视为不稳定(可能是攻击者故意触发 ENOTFOUND 让守卫误判)
        history.push([])
        return { stable: false, ips: firstIps, history, privateHit }
      }
      if (i < rounds - 1 && intervalMs > 0) {
        await new Promise((r) => setTimeout(r, intervalMs))
      }
    }
    return { stable: true, ips: firstIps, history, privateHit }
  } catch {
    return { stable: false, ips: [], history }
  }
}

/**
 * URL hostname 安全归一化(R-E4): 从 URL 提取 hostname, 若为非十进制 IP 编码
 * (十进制/八进制/十六进制) → 归一化为标准点分十进制; 域名原样返回。
 *  供 fetcher.ts 未来在 assertSafeTarget 入口预归一化, 收口 SSRF 绕过向量
 */
export function normalizeUrlHostname(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    // IPv6 字面量: 直接返回(由 isPrivateIp v6 分支处理)
    if (h.includes(':')) return h
    // 形如 '2130706433' / '0x7f000001' / '017700000001' 等单段 IP 编码
    if (/^[0-9a-f]+$/.test(h) && !h.includes('.') && h.length >= 2) {
      const normalized = normalizeIpLiteral(h)
      if (normalized) return normalized
    }
    // 形如 '0x7f.0.0.1' / '0177.0.0.1' 等点分编码
    if (h.includes('.') && /[^\d.]/.test(h)) {
      const normalized = normalizeIpLiteral(h)
      if (normalized) return normalized
    }
    return h
  } catch {
    return ''
  }
}
