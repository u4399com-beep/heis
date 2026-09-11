// ============================================================
// 多线程采集任务运行器 (进程内单例)
// - 随机线程数范围 / 随机间隔范围 (每批次动态抽取)
// - 立即执行 / 暂停 / 停止 / 在线调节线程与间隔
// - 完全覆盖重采集 & 只增量更新
// - 单本 & 范围(列表页起止) 采集
// - 存储模式: 数据库 | TXT文件
// ============================================================
import { db } from '@/lib/db'
import { type RuleConfig, type TocItem, type FetchConfig, parseRuleConfig, sanitizeFetchConfig } from './types'
import { fetchPage, fetchBinary, checkBrowser, type FetchResult, effectiveHostGateLimit } from './fetcher'
import { acquireHostGate, releaseHostGate, reportHostSuccess, reportHostFailure, reportHostRateLimited, hostGateSnapshot, hostGateKeyOf } from './hostgate'
import { parseList, parseBook, parseToc, parseContent, parseJsonBody, absolutize } from './parser'
import { cleanContentHtml, cleanIntro, cleanChapterTitle, cleanTextField } from './cleaner'
import { reorderToc } from './sorter'
import { saveChapterTxt, saveCoverWebp, deleteBookTxt, ensureDirs } from './storage'
import { smartCategory, smartCompleteDetect } from './smart'
import { fetchSuggestKeywords, mergeSuggestWords } from './suggest'

type ControlAction = 'start' | 'pause' | 'stop'

interface TaskRuntime {
  paused: boolean
  stopped: boolean
  running: boolean
  /** 运行代数: 每次全新 start 自增; 旧一轮循环检测到漂移即自行退出 */
  epoch: number
  /** E4: 连续错误熔断触发时间戳; control('start') 在 60s 冷却期内拒绝重启,
   *  防止操作员在故障源上反复硬敲(熔断→重启→再熔断)。epoch 漂移/正常完成时不清零,
   *  作为该 task 的最近一次熔断记忆(冷却过后允许重启) */
  circuitTrippedAt?: number
  /** R3-10: runtime 最后活跃时间戳(每次 start/pause/controlInner 路径更新) —— LRU 驱逐
   *  时优先淘汰 paused 且 1h 未活跃的条目, 避免长期挂起但已不可恢复的任务占住 Map 槽位 */
  lastActiveAt: number
  /** feat-contentproxy-resume(范围任务续采): 已在列表页发现过的书籍 URL 集合。
   *  范围任务重启时, 已发现过的书籍不再加入 bookQueue(节省书籍页抓取/解析/数据库写入),
   *  仅 list 页上新出现的书籍才进入采集队列; 任务进度 progress.discoveredBookUrls 持久化,
   *  本进程内存 Set 由 progress 装载。recrawlMode==='full' 任务启动时清空(重采语义) */
  discoveredBookUrls: Set<string>
  /** feat-contentproxy-resume(范围任务续采): 已完整采集(章节全采完)的【已完结】书籍 URL 集合。
   *  仅 status==='completed' 的书才会加入本集合 —— 完结书不会再有新章节, 重启时整体跳过
   *  (不重抓书籍页/目录/正文)。recrawlMode==='full' 任务启动时清空(重采语义)。
   *  feat-combo-theme-incremental: 区分 completed/ongoing ——
   *  原实现把所有 'ok' 返回的书都加进 completedBookUrls, 但【连载中】书籍重启后仍需
   *  检查新章节, 不应整体跳过。现在只把 detectedStatus==='completed' 的书加入本集合,
   *  连载书改入 ongoingBookUrls + bookLastChapters */
  completedBookUrls: Set<string>
  /** feat-combo-theme-incremental(连载书籍增量): status==='ongoing' 的书籍 URL 集合。
   *  重启时这些书籍【不整体跳过】, 而是抓取书籍页 + 目录, 对比末章 URL 与 stored 末章:
   *  相同 → 跳过(无新章节); 不同 → 增量采新章节(existUrlMap 自动去重已采过的)。
   *  recrawlMode==='full' 任务启动时清空。本集合只增不删 */
  ongoingBookUrls: Set<string>
  /** feat-combo-theme-incremental(连载书籍增量): bookUrl → 末章 URL(上次采集到的最后一章 URL)。
   *  重启时与当前目录末章 URL 对比: 相同 → 跳过; 不同 → 增量采新章节。
   *  recrawlMode==='full' 任务启动时清空 */
  bookLastChapters: Map<string, string>
  /** agent-B-runner(失败书籍追踪): 瞬态错误(超时/HostGate/抓取异常)的书籍 URL 集合。
   *  用于"仅重试失败"模式(未来)和可见性。crawlOneBook 返回 'ok' 时从中移除;
   *  抛瞬态错误时加入。'full' 模式启动时清空。内存上限 MAX_RESUME_SET_SIZE */
  failedBookUrls: Set<string>
  /** agent-B-runner(任务快照): 最近 N 条日志(ring buffer), 供 snapshot 端点读取。
   *  log() 方法同时写 DB + 推入本 buffer; 保存进 progress.recentLogs 供 API 读取 */
  recentLogs: { level: string; message: string; ts: number }[]
  /** agent-B-runner(请求预算+快照): 本轮 HTTP 请求数(每次 gateFetch +1), 用于快照 + 预算上限 */
  requestCount: number
  /** agent-B-runner(快照): 本轮累计抓取字节数(响应体长度), 用于快照 */
  bytesFetched: number
  /** agent-B-runner(快照+ETA): 本轮开始时间戳(ms), 用于 ETA 计算 */
  runStartedAt: number
  /** agent-B-runner(快照): 当前正在抓取的 URL(每次 gateFetch 入口设置), 用于快照 */
  currentUrl: string
  /** agent-B-runner(请求预算): 单任务 HTTP 请求预算上限(从 task.fetchConfig.maxRequests 读取)。
   *  0=不限; >0 时 requestCount 超过则中止任务(防失控)。在 executeTask 入口加载 */
  maxRequests: number
  /** agent-K-crawl-phase2(验证码计数): 本任务累计命中验证码次数(hCaptcha/Turnstile/reCAPTCHA/GeeTest)。
   *  fetcher 在 FetchResult.captchaDetected=true 时返回, gateFetch 检测后 rt.captchaEncountered++;
   *  供 snapshot 端点暴露给 UI + 与 fetcher.getCaptchaEncounteredCount() 进程级计数对照 */
  captchaEncountered: number
}

interface TaskProgress {
  phase: 'idle' | 'discovery' | 'book' | 'toc' | 'content' | 'done'
  phaseNote?: string
  discovered: number
  booksDone: number
  booksTotal: number
  tocTotal: number
  contentDone: number
  contentTotal: number
  currentBook?: string
  lastThread?: number
  lastInterval?: number
  engineStats?: Record<string, number>
  /** feat-contentproxy-resume(范围任务续采): 已发现的书籍 URL 列表(持久化进 task.progress)。
   *  范围任务重启时由本字段重建 rt.discoveredBookUrls Set, 用于跳过已发现书籍免再入 bookQueue。
   *  cap 50000 条防 DB 膨胀(50000×~60B URL≈3MB JSON, SQLite TEXT 上限 1GB, 实际无虞但保守钳) */
  discoveredBookUrls?: string[]
  /** feat-contentproxy-resume(范围任务续采): 已完整采集的【已完结】书籍 URL 列表(持久化进 task.progress)。
   *  范围任务重启时由本字段重建 rt.completedBookUrls Set, 用于跳过整体重采(节省书籍页/目录/正文
   *  全链路抓取)。crawlOneBook 在 detectedStatus==='completed' 时追加到 rt.completedBookUrls,
   *  saveProgress 同步落库。cap 50000 条。
   *  feat-combo-theme-incremental: 仅完结书加入本字段, 连载书改入 ongoingBookUrls */
  completedBookUrls?: string[]
  /** feat-combo-theme-incremental(连载书籍增量): status==='ongoing' 的书籍 URL 列表(持久化)。
   *  重启时由本字段重建 rt.ongoingBookUrls Set, 用于增量检查新章节(不整体跳过)。
   *  cap 50000 条 */
  ongoingBookUrls?: string[]
  /** feat-combo-theme-incremental(连载书籍增量): bookUrl → 末章 URL(持久化)。
   *  重启时与当前目录末章 URL 对比, 相同则跳过(无新章节), 不同则增量采新章节。
   *  cap 50000 条 */
  bookLastChapters?: Record<string, string>
  /** agent-B-runner(失败书籍追踪): 瞬态错误书籍 URL 列表(持久化)。
   *  crawlOneBook 'ok' 时从 Set 移除, 抛瞬态错误时加入; cap 50000 条 */
  failedBookUrls?: string[]
  /** agent-B-runner(任务快照): 本轮 HTTP 请求数(gateFetch 累计), 用于进度面板 */
  requestCount?: number
  /** agent-B-runner(任务快照): 本轮累计抓取字节数, 用于进度面板 */
  bytesFetched?: number
  /** agent-B-runner(任务快照+ETA): 本轮开始时间戳(ms), UI 据此 + requestCount 算 ETA */
  runStartedAt?: number
  /** agent-B-runner(任务快照): 当前正在抓取的 URL, UI 实时展示 */
  currentUrl?: string
  /** agent-B-runner(内存快照): bookQueue 剩余书籍数, UI 展示内存占用 */
  memBooksInQueue?: number
  /** agent-B-runner(内存快照): 当前书章节队列剩余数 */
  memChaptersInQueue?: number
  /** agent-B-runner(内存快照): resume Sets 总大小(discovered+completed+ongoing+failed+bookLastChapters) */
  memResumeSetsSize?: number
  /** agent-B-runner(任务快照): 最近 N 条日志(ring buffer), UI 实时展示无需轮询 logs API */
  recentLogs?: { level: string; message: string; ts: number }[]
}

interface TaskStats {
  booksCreated: number
  booksUpdated: number
  chaptersCreated: number
  chaptersUpdated: number
  coversSaved: number
  errors: number
  suggestWords: number
}

/** tt-c: 任务级连续错误熔断阈值 —— 连续 N 个真实章节失败(超时/抓取异常)即中止本书并上抛,
 *  任务转 error 终态(autoRefresh 自动重试自愈)。20 的量级: 正常抖动(单章偶败)远够不着,
 *  站点改版/被全量拦截时 2~3 个批次内即熔断, 不再硬敲 */
const CIRCUIT_ERROR_LIMIT = 20

/** E4: 熔断后冷却窗口 —— 60s 内拒绝 control('start') 重启, 防止操作员反复硬敲故障源 */
const CIRCUIT_COOLDOWN_MS = 60_000

/** agent-B-runner: 内存中 discoveredBookUrls / completedBookUrls / ongoingBookUrls / failedBookUrls
 *  Sets 的大小上限。超过时按 FIFO 淘汰最旧 10% 防无界增长(站群百万级 URL 场景下防 OOM)。
 *  修前仅在 saveProgress 落库时 slice(0, 50000), 内存 Set 仍可涨至数百万 → 长任务 OOM 风险。
 *  现在每次 add 时即时检查上限, 内存与持久化口径一致 */
const MAX_RESUME_SET_SIZE = 50_000

/** agent-B-runner: 任务快照中保留的最近日志行数(内存 ring buffer), 供 snapshot 端点读取 */
const MAX_RECENT_LOGS = 10

/** agent-B-runner: bookLastChapters Map 超过此上限时淘汰最旧条目(保留最近添加的, 即最新连载书)。
 *  修前 saveProgress 仅 slice 前 50000 条(最早添加的), 最新添加的连载书末章 URL 被丢 →
 *  重启时增量检查失效(末章对比找不到 stored 值) → 整本重采。现在在 add 时即时淘汰最旧 */
const MAX_BOOK_LAST_CHAPTERS = 50_000

/** zz-b: 429 限流特征(blocked 壳页体内容, 大小写不敏感)——命中走限流冷却(reportHostRateLimited)
 *  而非连败降额链; 403/验证码等其余特征维持既有降额链不变 */
const RATE_LIMIT_HINT_RE = /429|rate[ _-]?limit|too many requests/i

// ---------- 全局单例 ----------
const globalForRunner = globalThis as unknown as { __novelTaskRunner?: TaskRunner }

export class TaskRunner {
  /** 单例创建时刻(新进程首次访问时的时间戳): recoverOnBoot 只回收早于它的孤儿任务 */
  readonly createdAt = Date.now()
  private runtimes = new Map<string, TaskRuntime>()
  /** 自动刷新定时器: 任务终态后按 refreshIntervalMin 重启; stop/delete 时清除 */
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** rr-c2: control 每 task 串行化链(键=taskId, 值=队尾 promise; 尾 settles 后自删防无界增长) */
  private controlChains = new Map<string, Promise<unknown>>()
  /** R4-8: control() 30s timeout race 修复 —— per-task 状态写串行化链。
   *  原问题: controlInner 卡在 SQLite busy 等待时, Promise.race 30s 超时让 run reject,
   *  但底层 controlInner 继续执行; 后续 control('stop') 入队执行, 其 db.task.update(status='stopped')
   *  与卡住的 db.task.update(status='running') 同时在 SQLite 队列中, 提交顺序不确定, 旧写晚提交
   *  会覆盖新写(status 显示 running 但实际任务已停)。修法: per-task 把所有 db.task.update(status:...)
   *  串行化, 旧写必先完成、新写后发, last-write-wins 保证新 control 的状态写总胜出 */
  private dbStatusChains = new Map<string, Promise<unknown>>()

  /** R4-8: per-task status 串行写 —— 把 db.task.update(status:...) 串到 prev 链尾,
   *  保证旧 controlInner(可能已 Promise.race 超时)的写必先完成、新 controlInner 的写后发,
   *  提交序与调用序一致。失败(如 P2025 任务已删)透传给调用方。 */
  private async serializeStatusWrite(taskId: string, status: string): Promise<void> {
    const prev = this.dbStatusChains.get(taskId) ?? Promise.resolve()
    const next = prev.then(
      () => db.task.update({ where: { id: taskId }, data: { status } }).catch((e: any) => {
        if (e?.code === 'P2025') return // 任务已删, 写无处可去, 视作正常终态
        throw e
      }),
    )
    // tail 不抛错防链断: 调用方通过 await next 收到错误; 链尾只负责串行化顺序
    const tail = next.catch(() => {})
    this.dbStatusChains.set(taskId, tail)
    void tail.then(() => {
      if (this.dbStatusChains.get(taskId) === tail) this.dbStatusChains.delete(taskId)
    })
    await next
  }

  static get instance(): TaskRunner {
    if (!globalForRunner.__novelTaskRunner) {
      globalForRunner.__novelTaskRunner = new TaskRunner()
    }
    return globalForRunner.__novelTaskRunner
  }

  /** autoRefresh 开启且任务处于终态时, delayMin 分钟后自动重新采集(jj-e 实时更新) */
  scheduleAutoRefresh(taskId: string, delayMin: number, taskName = '') {
    this.cancelAutoRefresh(taskId)
    // R3-35: 钳制 delayMin 到 [5, 1440] 分钟 —— 防误配 0(立即无限触发循环)或 >1440(>1天
    // 极少刷新)。原实现 Math.max(0, ...) 仅下限 0, 配置 0.01 → 600ms 循环触发, 高频打 hostGate
    // + DB 反复 update → 自伤站点。下限 5 分钟与正常采集批次间隔同量级, 上限 1 天防止定时器
    // 在长生命周期内永久驻留。autoRefresh 自愈语义不变(站点改版场景 5 分钟足够冷启动一次)
    const clampedMin = Math.max(5, Math.min(1440, Math.round(delayMin)))
    const ms = Math.max(0, Math.round(clampedMin * 60_000))
    const timer = setTimeout(async () => {
      this.refreshTimers.delete(taskId)
      // 触发时复核: 任务仍存在/autoRefresh 仍开/未在运行/仍处终态(期间被 stop/pause 则放弃)
      // R3-14: 同 recoverOnBoot, 'stopped' 不参与自动刷新(用户手动停止的明确意图, 不应
      // 被定时器拉回)。仅 done(自然完成)/error(异常终止) 触发自愈重采
      try {
        const t = await db.task.findUnique({ where: { id: taskId } })
        if (!t || !t.autoRefresh || this.isRunning(taskId) || !['done', 'error'].includes(t.status)) return
        await this.log(taskId, 'info', `⟳ 自动刷新触发, 重新开始采集「${t.name}」`)
        const res = await this.control(taskId, 'start')
        if (!res.ok) await this.log(taskId, 'warn', `⟳ 自动刷新启动失败: ${res.message}`)
      } catch { /* 任务已删除等 */ }
    }, ms)
    // E1: unref 长延时定时器 —— autoRefresh 常为数十分钟到小时的延时, 不 unref 会阻止进程
    // 正常退出(Next.js dev 关闭/部署发 SIGTERM 时进程需等定时器到期才能退, 或强杀睡丢定时器)。
    // bun/node 的 timer.unref 语义: 事件循环空转时本定时器不计入活跃引用, 不阻止退出;
    // 触发时进程仍存活则照常 fire(scheduleAutoRefresh 仍在运行中被调用即如此)。Map 记录便于显式 cancel
    if (typeof timer.unref === 'function') timer.unref()
    this.refreshTimers.set(taskId, timer)
    if (taskName) {
      const label = clampedMin >= 1 ? `${clampedMin} 分钟` : `${Math.round(ms / 1000)} 秒`
      this.log(taskId, 'info', `⟳ 已排定自动刷新: ${label}后重新采集「${taskName}」`).catch(() => {})
    }
  }

  /** 清除自动刷新定时器(stop/delete/手动关闭时); E2: 同时尝试释放已终态 runtime 条目 */
  cancelAutoRefresh(taskId: string) {
    const timer = this.refreshTimers.get(taskId)
    if (timer) {
      clearTimeout(timer)
      this.refreshTimers.delete(taskId)
    }
    // E2: 任务删除/停止路径走到这里时 runtime 多为终态, 顺手释放(活跃任务保留 epoch/cooldown)
    this.disposeRuntime(taskId)
  }

  isRunning(taskId: string): boolean {
    return this.runtimes.get(taskId)?.running || false
  }

  /** agent-H-features: 任务实时快照 —— 返回内存 TaskRuntime 当前值(requestCount/bytesFetched/
   *  currentUrl/recentLogs/failedBookUrls 等)供 admin UI 实时显示。无运行时(任务未启动/
   *  已终态释放)时返回 null, 调用方回退到 DB progress JSON。
   *  - paused 状态仍保留 runtime(pruneRuntimesIfNeeded 仅驱逐终态/僵尸暂停), 返回最新值
   *  - running/paused 时返回内存值; 否则返回 null
   *  - 不读 DB(progress 可能落后内存 5~10s); 调用方按需自行 merge DB 数据
   *  - memBooksInQueue/memChaptersInQueue 不返回(bookQueue 是局部变量), 调用方从 DB progress 读 */
  snapshot(taskId: string): {
    running: boolean
    paused: boolean
    requestCount: number
    bytesFetched: number
    runStartedAt: number
    currentUrl: string
    maxRequests: number
    memResumeSetsSize: number
    recentLogs: { level: string; message: string; ts: number }[]
    failedBookUrlsCount: number
    /** agent-K-crawl-phase2: 本任务累计验证码命中次数(供 UI 实时显示 + 报警阈值) */
    captchaEncountered: number
  } | null {
    const rt = this.runtimes.get(taskId)
    if (!rt) return null
    return {
      running: rt.running,
      paused: rt.paused,
      requestCount: rt.requestCount,
      bytesFetched: rt.bytesFetched,
      runStartedAt: rt.runStartedAt,
      currentUrl: rt.currentUrl,
      maxRequests: rt.maxRequests,
      memResumeSetsSize:
        rt.discoveredBookUrls.size + rt.completedBookUrls.size +
        rt.ongoingBookUrls.size + rt.failedBookUrls.size + rt.bookLastChapters.size,
      recentLogs: rt.recentLogs.slice(-MAX_RECENT_LOGS),
      failedBookUrlsCount: rt.failedBookUrls.size,
      captchaEncountered: rt.captchaEncountered,
    }
  }

  /** E2: LRU 驱逐 —— runtimes Map 上限 200 条。超出时按插入序找最旧的【已终态】条目
   *  (running===false: 含 done/error/stopped) 驱逐; 活跃任务(running===true, 含 paused)
   *  永不驱逐(保留 epoch/cooldown/暂停态)。全部活跃时跳过(不阻塞插入)。
   *  R3-10: 原实现每次仅驱逐一条, 站群场景下大量任务终态时仍可能逐步涨至 200+ 触发持续
   *  分配开销。改为最多驱逐 50 条(或 10% cap), 一次性把当前批次终态条目都释放掉。
   *  另: paused 态条目若 lastActiveAt > 1h 未活跃(操作员忘记 resume/已不可恢复), 视为
   *  "僵尸暂停" 一并驱逐; lastActiveAt 缺失(老条目兼容)用 0 兜底立即驱逐 */
  private pruneRuntimesIfNeeded() {
    if (this.runtimes.size < 200) return
    const now = Date.now()
    const PAUSED_STALE_MS = 60 * 60 * 1000 // 1h
    let evicted = 0
    const MAX_EVICT = Math.max(50, Math.floor(this.runtimes.size * 0.1))
    for (const [k, rt] of this.runtimes) {
      if (evicted >= MAX_EVICT) break
      const last = rt.lastActiveAt || 0
      const isPausedStale = rt.paused && !rt.running && (now - last) > PAUSED_STALE_MS
      // 优先驱逐无熔断冷却记忆的终态条目; 冷却中的终态条目也优先保畬(60s 窗口短, 不碍 LRU)
      // R3-10: paused 态 + 1h 未活跃也驱逐(僵尸暂停, 操作员不会再来 resume)
      if (!rt.running && (!rt.circuitTrippedAt || (now - rt.circuitTrippedAt) >= CIRCUIT_COOLDOWN_MS) || isPausedStale) {
        this.runtimes.delete(k)
        evicted++
      }
    }
    // 全部活跃: 不驱逐(不强杀在跑任务), 待下次终态后自然驱逐
  }

  /** E2: 显式释放 runtime 条目 —— DELETE 路径(经 cancelAutoRefresh)与 stop 路径走到这里。
   *  仅在 task 已终态(running===false)且不在熔断冷却窗口内时释放; 活跃任务/冷却窗口保留。 */
  private disposeRuntime(taskId: string) {
    const rt = this.runtimes.get(taskId)
    if (!rt) return
    if (rt.running) return // 活跃任务(epoch/暂停态在用), 不释放
    if (rt.circuitTrippedAt && Date.now() - rt.circuitTrippedAt < CIRCUIT_COOLDOWN_MS) return // 冷却窗口内, 保畬记忆
    this.runtimes.delete(taskId)
  }

  /** 恢复启动时标记: 之前running的任务标记为paused
   *  修复: 原实现被 stats 接口懒触发, 会把【本进程内刚合法启动】的任务也误判为重启孤儿强制暂停;
   *  现在每进程生命周期只执行一次, 且只回收 updatedAt 早于单例创建时刻的孤儿任务 */
  async recoverOnBoot() {
    const g = globalForRunner as unknown as { __novelRecoveredAt?: number }
    if (g.__novelRecoveredAt) return // 本进程已执行过(防 HMR 重触发误伤)
    try {
      const stale = await db.task.findMany({
        where: { status: 'running', updatedAt: { lt: new Date(this.createdAt - 10_000) } },
      })
      for (const t of stale) {
        await db.task.update({ where: { id: t.id }, data: { status: 'paused' } })
        await this.log(t.id, 'warn', '服务重启, 任务自动转入暂停状态, 可点击继续恢复采集')
      }
      // jj-e: 重启后恢复 autoRefresh 任务的定时刷新(进程内 timer 随进程消失; 终态任务重新排定)
      // R3-14: 排除 'stopped' —— 用户手动 stop 是明确意图(不希望任务再跑), 不应被
      // recoverOnBoot 自动重排定触发。原实现把 stopped 与 done/error 一视同仁地恢复
      // autoRefresh, 用户操作"停止任务"后只要 autoRefresh=true, 进程一重启就会立即被
      // 排定时器拉回来跑, 与用户意图相反。done/error 是自然终态/异常终态, 自愈行为合理
      const autoTasks = await db.task.findMany({
        where: { autoRefresh: true, status: { in: ['done', 'error'] } },
        select: { id: true, name: true, refreshIntervalMin: true },
      })
      for (const t of autoTasks) {
        this.scheduleAutoRefresh(t.id, t.refreshIntervalMin)
        await this.log(t.id, 'info', `⟳ 服务已重启, 自动刷新已恢复排定(${t.refreshIntervalMin} 分钟后重新采集)`).catch(() => {})
      }
      // Bug 8 修复: 成功标志必须在所有 DB 操作成功后才置位 —— 修前在进入 try 时即置位,
      // 若 findMany/update 抛错(表未建/磁盘故障), 标志已设为已恢复, 后续调用永远跳过(不重试)。
      // 现仅在全部成功后置位; catch 中不置位(留下次服务器重启或 API 调用重试)
      g.__novelRecoveredAt = Date.now()
    } catch { /* 表不存在等: 不置位标志, 留待下次重试 */ }
  }

  async log(taskId: string, level: 'info' | 'success' | 'warn' | 'error', message: string) {
    // agent-B-runner: 同时推入 recentLogs ring buffer(供 snapshot 端点, 无需轮询 logs API)
    const rt = this.runtimes.get(taskId)
    if (rt) pushRecentLog(rt.recentLogs, level, message)
    try {
      await db.taskLog.create({ data: { taskId, level, message: message.slice(0, 1500) } })
      // 限制日志量: 保留最近3000条
      const count = await db.taskLog.count({ where: { taskId } })
      if (count > 3000) {
        const oldest = await db.taskLog.findMany({
          where: { taskId },
          orderBy: { id: 'asc' },
          take: count - 3000,
          select: { id: true },
        })
        if (oldest.length) {
          await db.taskLog.deleteMany({ where: { id: { in: oldest.map((o) => o.id) } } })
        }
      }
    } catch { /* ignore */ }
  }

  async control(taskId: string, action: ControlAction): Promise<{ ok: boolean; message: string }> {
    // rr-c2 修复(control 状态写乱序): 并发 control(stop/start) 的 db.task.update 状态写
    // 不保证按调用序提交(SQLite 连接池多连接/busy 重试非FIFO), 探针 probe-rr-c2-control-race
    // 20 轮实锤 3 轮 update('stopped') 晚于 update('running') 提交 → 新一轮循环批次头
    // live.status==='stopped' DB 守卫自杀, 任务卡 stopped(verify-ll-c-runner Part4 的
    // 21/4 即此根因)。修法: 每 task 临界区串行化 —— 入队时机=调用时刻(同步, 先于任何
    // await), stop 的整段 body(含状态写+日志)完成后 start#2 才开始, 状态写调用序=提交序;
    // 与 ll-c epoch 双循环窗口修复互补(那边修内存 epoch 绑定, 这边修 DB 状态写序)。
    // 单次 control 失败不阻断后续(链上吞错); 尾 settles 自删 Map 项防长任务无界增长。
    // R3-13: controlInner 包裹 30s 超时 —— 原 controlInner 持有 db.task.update/日志写入
    // 与(在 start 路径)异步 executeTask 调度, 单次卡死(如 SQLite busy 锁等待)会让后续所有
    // control 串行卡在 prev.then 后, 任务永远停不下来也启不动。Promise.race 上限 30s,
    // 超时则当前 control reject, 链尾 catch 吞错后释放 → 下次 control 可正常入队执行
    const prev = this.controlChains.get(taskId) ?? Promise.resolve()
    const inner = () => Promise.race([
      this.controlInner(taskId, action),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('control timeout(30s)')), 30_000),
      ),
    ])
    const run = prev.then(() => inner())
    const tail = run.catch(() => {})
    this.controlChains.set(taskId, tail)
    void tail.then(() => {
      if (this.controlChains.get(taskId) === tail) this.controlChains.delete(taskId)
    })
    return run
  }

  private async controlInner(taskId: string, action: ControlAction): Promise<{ ok: boolean; message: string }> {
    const task = await db.task.findUnique({ where: { id: taskId } })
    if (!task) return { ok: false, message: '任务不存在' }
    const rt: TaskRuntime = this.runtimes.get(taskId) || {
      paused: false,
      stopped: false,
      running: false,
      epoch: 0,
      lastActiveAt: Date.now(),
      discoveredBookUrls: new Set<string>(),
      completedBookUrls: new Set<string>(),
      ongoingBookUrls: new Set<string>(),
      bookLastChapters: new Map<string, string>(),
      failedBookUrls: new Set<string>(),
      recentLogs: [],
      requestCount: 0,
      bytesFetched: 0,
      runStartedAt: 0,
      currentUrl: '',
      maxRequests: 0,
      captchaEncountered: 0,
    }
    // R3-10: 每次进入 controlInner 都更新 lastActiveAt, 供 pruneRuntimesIfNeeded 判定
    // "僵尸暂停"(paused + 1h 未活跃); 无 operation 直接 update 触发顺序避免 await 间隙
    rt.lastActiveAt = Date.now()

    switch (action) {
      case 'start': {
        // E4: 熔断冷却检查 —— 连续错误熔断后 60s 内拒绝重启(防操作员在故障源上硬胡重启
        // 立即再熔断); 冷却过后放行, autoRefresh 路径(复核终态后调 control('start'))同样适用
        if (rt.circuitTrippedAt && Date.now() - rt.circuitTrippedAt < CIRCUIT_COOLDOWN_MS) {
          const wait = Math.ceil((CIRCUIT_COOLDOWN_MS - (Date.now() - rt.circuitTrippedAt)) / 1000)
          return { ok: false, message: `熔断冷却中，请 ${wait}s 后再试` }
        }
        if (rt.running) {
          if (rt.paused) {
            rt.paused = false
            await this.serializeStatusWrite(taskId, 'running')
            await this.log(taskId, 'success', '▶ 任务已恢复运行')
            return { ok: true, message: '已恢复' }
          }
          return { ok: false, message: '任务已在运行中' }
        }
        // 新启动(修复: stop→立刻 start 时, 旧一轮循环可能还卡在 fetch/sleep 里未退出,
        // 必须自增 epoch 让它自行终止, 否则新旧两个循环会并发采集同一任务)
        rt.epoch = (rt.epoch || 0) + 1
        rt.running = true
        rt.paused = false
        rt.stopped = false
        // E4: 新一轮 start 重置熔断记忆 —— 上一轮已结束(可能熔断/可能正常完成), 新轮从头计连续错误;
        // 若新轮再次熔断会重新打 circuitTrippedAt。冷却检查只在 start 入口做(本函数顶部),
        // 换代后旧循环不会再次走 start 路径, 重置不破坏冷却语义
        rt.circuitTrippedAt = undefined
        this.runtimes.set(taskId, rt)
        // E2: LRU 上限保护 —— runtimes Map 长期累积终态任务条目无上限增长(任务历史从执行, 后续不再运行),
        // 插入新条目后检查是否超 200, 超过则驱逐最旧的已终态条目(running===false 的 epoch/cooldown)
        this.pruneRuntimesIfNeeded()
        await this.serializeStatusWrite(taskId, 'running')
        await this.log(taskId, 'success', `▶ 任务启动 [${task.name}] 模式:${task.mode === 'single' ? '单本' : '范围'} 重采:${task.recrawlMode === 'full' ? '完全覆盖' : '增量更新'} 存储:${task.storageMode === 'db' ? '数据库' : 'TXT文件'} 线程:${task.threadMin}~${task.threadMax} 间隔:${task.intervalMin}~${task.intervalMax}ms`)
        // 异步执行, 不阻塞API
        this.executeTask(taskId).catch(async (e) => {
          await this.log(taskId, 'error', `任务异常终止: ${e?.message || e}`)
          // agent-B-runner: error 状态写走 serializeStatusWrite 与 control 同链(防竞态覆盖)
          await this.serializeStatusWrite(taskId, 'error').catch(() => {})
        })
        return { ok: true, message: '已启动' }
      }
      case 'pause': {
        if (!rt.running) return { ok: false, message: '任务未在运行' }
        rt.paused = true
        await this.serializeStatusWrite(taskId, 'paused')
        await this.log(taskId, 'warn', '⏸ 任务已暂停')
        return { ok: true, message: '已暂停' }
      }
      case 'stop': {
        rt.stopped = true
        rt.paused = false
        rt.running = false
        // R3-11: 显式重置熔断冷却记忆 —— 用户手动 stop 是明确意图, 与熔断不同(后者是
        // 上游故障触发的被动中止), 不应让用户在 60s 内无法 restart。原实现保留记忆
        // 导致 stop 后立即 restart 会被 E4 冷却检查拦截("熔断冷却中"提示), 与"我手动
        // 停下, 想立刻再启"的用户预期不符
        rt.circuitTrippedAt = undefined
        this.runtimes.set(taskId, rt)
        // jj-e: 手动停止视为用户明确意图, 同时取消已排定的自动刷新
        this.cancelAutoRefresh(taskId)
        await this.serializeStatusWrite(taskId, 'stopped')
        await this.log(taskId, 'warn', '⏹ 任务已停止(自动刷新已取消)')
        return { ok: true, message: '已停止' }
      }
    }
  }

  /** 每批次从DB读取最新任务配置(支持在线调节线程/间隔/模式) */
  private async loadConfig(taskId: string) {
    const task = await db.task.findUnique({ where: { id: taskId }, include: { rule: true } })
    if (!task) return null
    return {
      task,
      rule: parseRuleConfig(task.rule.config),
      fetchOverride: parseFetchOverride(task.fetchConfig),
      threads: () => randInt(clampMin(task.threadMin, task.threadMax), task.threadMax),
      interval: () => randInt(clampMin(task.intervalMin, task.intervalMax), task.intervalMax),
    }
  }

  // ================== 主执行流 ==================
  private async executeTask(taskId: string) {
    // ll-c 修复(epoch 取消窗口): rt/myEpoch 绑定必须【同步在函数入口】完成 —— 原先在
    // await ensureDirs() + await loadConfig() 两个真实异步点(fs.mkdir×3/db 查询, 毫秒级)
    // 【之后】才读 rt.epoch, 此窗口内 stop→start#2(epoch++)会让旧循环绑定【新一轮】epoch,
    // isStale() 永假 → 新旧双循环并发采集同一任务(重复请求压力/建行冲突/进度互踩)。
    // control('start') 同步段先 runtimes.set 再调本函数, 入口 rt 必在; 与 jj-d
    // crawlOneBook 传入绑定同思路, 从根上关闭最后一个绑定窗口
    const rt = this.runtimes.get(taskId)
    if (!rt) return // control('start') 必先 set, 纯防御
    const myEpoch = rt.epoch
    // 本轮已作废判断: 新一轮 start 会自增 epoch, 旧循环在所有检查点看到漂移即退出
    const isStale = () => rt.epoch !== myEpoch
    // zz-d 修复(running 标志泄漏): ensureDirs/loadConfig 与 `!cfg` 提前返回原先都在下方
    // try 之外 —— 二者抛错(磁盘/DB 故障)或任务恰在启动窗口被删(loadConfig 返回 null)
    // 时 finally 不执行, rt.running 永久卡 true: 活任务后续 start 恒被"任务已在运行中"
    // 拒绝(只能手动 stop 解锁)。移入 try 由 finally 统一收尾(epoch 判定不变, 仅清本代
    // 标志); 抛错改走本函数自有 catch 落 error 终态, 终态语义与原 control('start') 外层
    // catch 一致(且经 isStale 门控, 不误伤换代后的新循环)
    let cfg: Awaited<ReturnType<TaskRunner['loadConfig']>> = null
    // Bug 25: done 写入标志 —— 修前 done 状态写成功后, 后续 saveProgress/autoRefresh 排定
    // 抛错会落到下方 catch 重写 status:'error', 把已完成任务降级为崩溃态(进度未丢但终态语义错乱,
    // autoRefresh 不再重排)。设标志: done 落库成功后置 true, catch 中仅 !doneWritten 时写 error
    let doneWritten = false
    try {
      await ensureDirs()
      cfg = await this.loadConfig(taskId)
      if (!cfg) return
      const progress: TaskProgress = coerceProgress(cfg.task.progress)
      const stats: TaskStats = coerceStats(cfg.task.stats)
      // feat-contentproxy-resume(范围任务续采): 从 progress 重建内存 Set; rt 是 control('start')
      // 创建的 TaskRuntime, 初始为空 Set(冷启动场景)。已运行过的任务从 DB progress 装载已发现/
      // 已采集 URL 列表 → Set, 让范围任务重启时按 Set 跳过已处理的书籍(免再抓书籍页/目录/正文)。
      // recrawlMode==='full' 任务启动时清空两 Set(完全覆盖重采语义: 用户明确要重采全部书籍);
      // 增量模式保留 Set 让续采只处理新增/未采完的书籍
      if (cfg.task.recrawlMode === 'full') {
        rt.discoveredBookUrls = new Set<string>()
        rt.completedBookUrls = new Set<string>()
        rt.ongoingBookUrls = new Set<string>()
        rt.bookLastChapters = new Map<string, string>()
        progress.discoveredBookUrls = []
        progress.completedBookUrls = []
        progress.ongoingBookUrls = []
        progress.bookLastChapters = {}
      } else {
        // 从 progress 恢复(数组 → Set); 数组非法/缺失时 Set 留空(冷启动零回归)
        const disc = Array.isArray(progress.discoveredBookUrls) ? progress.discoveredBookUrls : []
        const comp = Array.isArray(progress.completedBookUrls) ? progress.completedBookUrls : []
        rt.discoveredBookUrls = new Set(disc.filter((u) => typeof u === 'string' && u))
        rt.completedBookUrls = new Set(comp.filter((u) => typeof u === 'string' && u))
        // feat-combo-theme-incremental: 连载增量恢复 —— ongoingBookUrls + bookLastChapters
        const ongoing = Array.isArray(progress.ongoingBookUrls) ? progress.ongoingBookUrls : []
        rt.ongoingBookUrls = new Set(ongoing.filter((u) => typeof u === 'string' && u))
        const lastChapObj = (progress.bookLastChapters && typeof progress.bookLastChapters === 'object')
          ? progress.bookLastChapters as Record<string, string>
          : {}
        rt.bookLastChapters = new Map<string, string>()
        for (const [k, v] of Object.entries(lastChapObj)) {
          if (typeof k === 'string' && k && typeof v === 'string' && v) rt.bookLastChapters.set(k, v)
        }
        const totalResume = rt.discoveredBookUrls.size + rt.completedBookUrls.size + rt.ongoingBookUrls.size
        if (totalResume > 0) {
          await this.log(
            taskId,
            'info',
            `范围续采恢复: 已发现 ${rt.discoveredBookUrls.size} 本 / 已完结 ${rt.completedBookUrls.size} 本 / 连载中 ${rt.ongoingBookUrls.size} 本(从 task.progress 装载; 完结书整体跳过, 连载书增量检查新章节, 新书全量采)`,
          ).catch(() => {})
        }
      }
      // agent-H-features(请求预算): rt.maxRequests 从 fetchOverride.maxRequests 读取
      // (规则侧 cfg.rule.fetch.maxRequests 兜底); 0/未设=不限。control('start') 时 rt.maxRequests
      // 默认 0, 此处合并 task.fetchConfig 后填上, gateFetch 即可据此检查预算
      rt.maxRequests = Number(cfg.fetchOverride.maxRequests ?? cfg.rule.fetch.maxRequests) || 0
      // agent-H-features(任务快照+ETA): runStartedAt 在新一轮 start 重置(control('start')
      // 已新建 TaskRuntime 但 runStartedAt=0), snapshot 端点据此算 ETA
      rt.runStartedAt = Date.now()
      // ---------- 发现书籍URL ----------
      let bookQueue: string[] = []
      // ll-c2: 列表页已提取的书籍字段随行保存(key=absolutized bookUrl) — 部分源站 detail
      // 端点不稳定(番茄聚合API 2026-09-02 实测 data.data 空对象), detail 字段全空时不至于
      // 落到 URL 片段书名(修前入库《api/detail》); single 模式无列表字段, 兜底链零回归
      const listFields = new Map<string, { name?: string; author?: string; intro?: string; category?: string }>()
      if (cfg.task.mode === 'single') {
        bookQueue = [cfg.task.bookUrl]
        progress.discovered = 1
        await this.log(taskId, 'info', `单本模式: ${cfg.task.bookUrl}`)
      } else if (cfg.task.mode === 'urls') {
        // agent-H-features(retry-failed 模式): mode='urls' 时 fetchOverride.urls 直接作为
        // bookQueue, 跳过 list 发现阶段; 进度立刻进入 book 处理阶段
        const urlsList = (cfg.fetchOverride.urls && Array.isArray(cfg.fetchOverride.urls) ? cfg.fetchOverride.urls : [])
          .filter((u) => typeof u === 'string' && u)
        bookQueue = urlsList.slice()
        progress.discovered = bookQueue.length
        progress.phase = 'book'
        progress.phaseNote = `重试 ${bookQueue.length} 本失败书籍…`
        await this.saveProgress(taskId, progress, stats)
        await this.log(taskId, 'info', `重试失败模式: 共 ${bookQueue.length} 本待采集`)
      } else {
        progress.phase = 'discovery'
        progress.phaseNote = '正在解析列表页…'
        await this.saveProgress(taskId, progress, stats)
        const listRule = cfg.rule.list
        // R7-13 修复: 范围模式优先使用任务级 listUrl(用户在创建/编辑任务时填的具体列表页URL,
        // 已把分类/筛选参数固定下来, 仅留 {page} 让 runner 替换); 只有当任务未填 listUrl 时
        // 才回退到规则模板 rule.list.urlTemplate(含 {cat} 等占位符需默认值)。修前无视
        // task.listUrl 直接用 rule.urlTemplate → 用户填的 pilishuwu/0/list/0_0_..._{page}.html
        // 被完全忽略, 实际采集 pilishuwu.com/{cat}/list/{page}.html(占位符 {cat} 字面量保留)
        // R7-14: 残留 {cat} 占位符(任务级 listUrl 已含具体分类; 用 rule 模板且未提供 cat 时
        // 默认替换为 '0'(常见全分类索引页), 避免请求字面量 {cat}.html 404
        const urlTemplate = (cfg.task.listUrl && cfg.task.listUrl.trim()) || listRule.urlTemplate || ''
        const hasTaskListUrl = !!(cfg.task.listUrl && cfg.task.listUrl.trim())
        const urls: string[] = []
        for (let p = cfg.task.listStart; p <= cfg.task.listEnd; p++) {
          if (rt.stopped || isStale()) break
          while (rt.paused && !rt.stopped && !isStale()) await sleep(600)
          if (rt.stopped || isStale()) break
          // {page}=页号原值; {offset:N}=第p页的列表偏移量(p-1)*N(cc-c: 番茄聚合API
          // searchUrl 用 offset=(page-1)*10 分页, {page} 无法表达算术偏移)
          // {cat}=分类占位符(任务级listUrl已含具体分类无需替换; 用rule模板时默认'0')
          const url = urlTemplate
            .replace(/\{cat\}/g, hasTaskListUrl ? '' : '0')
            .replace(/\{offset:(\d+)\}/g, (_, n: string) => String((p - 1) * Math.max(1, parseInt(n, 10) || 1)))
            .replace('{page}', String(p))
          if (!url) continue
          try {
            // zz-b: 当页间隔取值同时作为同 host 准入最小间隔(逐页重新随机, 取值时机在请求前);
            // 列表页之间的既有 sleepGap(cfg.interval()) 保持每页独立随机, 节奏语义不变
            const pageGapMs = cfg.interval()
            const res = await this.gateFetch(taskId, url, buildFetch(cfg.rule, cfg.fetchOverride), { minGapMs: pageGapMs })
            await this.log(taskId, 'info', `列表页 P${p}: ${url} (引擎:${res.engine})`)
            // 修复: 真实站点规则(101kks/uukanshu/23qb/ixdzs8/5165)的列表书籍链接字段均命名
            // bookUrl 而非 url —— 原 ['url'] 单字段取法使列表页整库采集模式对全部真实规则
            // 静默失效(发现 0 本书)。双字段都做 absolutize, 取值时 url 优先 bookUrl 兜底
            const parsed = parseList(res.html, url, listRule, ['url', 'bookUrl'])
            const pageUrls = parsed.items.map((i) => i.fields.url || i.fields.bookUrl).filter(Boolean)
            // feat-contentproxy-resume(范围任务续采): 已发现过的书籍 URL 不再加入 bookQueue
            // (节省后续书籍页/目录/正文抓取; 已采集过的书籍会被 completedBookUrls 跳过整本)
            // 本地 Set 用于本轮内去重(同一 URL 在多页/同页重复出现只入队一次); 跨任务重启时
            // 由 progress.discoveredBookUrls 装载, 范围任务续采只处理新增/未采完书籍
            let newlyDiscovered = 0
            let alreadyDiscovered = 0
            for (const u of pageUrls) {
              if (rt.discoveredBookUrls.has(u)) {
                alreadyDiscovered++
                continue
              }
              rt.discoveredBookUrls.add(u)
              urls.push(u)
              newlyDiscovered++
            }
            for (const it of parsed.items) {
              const u = it.fields.url || it.fields.bookUrl
              if (!u || listFields.has(u)) continue
              if (it.fields.name || it.fields.author || it.fields.intro || it.fields.category) {
                listFields.set(u, { name: it.fields.name, author: it.fields.author, intro: it.fields.intro, category: it.fields.category })
              }
            }
            progress.discovered = urls.length
            await this.saveProgress(taskId, progress, stats)
            // 跳过日志用单条汇总, 避免万级 URL 逐条刷日志(每条 taskLog 落 SQLite + 上限 1500 字符裁切)
            const skipHint = alreadyDiscovered > 0 ? ` 跳过已发现 ${alreadyDiscovered} 本` : ''
            await this.log(taskId, 'success', `列表页 P${p} 发现 ${pageUrls.length} 本书籍 (新增 ${newlyDiscovered} 本${skipHint}, 累计待采${urls.length})`)
          } catch (e: any) {
            stats.errors++
            await this.log(taskId, 'error', `列表页 P${p} 抓取失败: ${e?.message}`)
          }
          await sleepGap(cfg.interval(), rt, myEpoch)
        }
        // 书籍序号范围
        let sliced = urls
        if (cfg.task.bookStart > 0 || cfg.task.bookEnd > 0) {
          const s = Math.max(0, cfg.task.bookStart - 1)
          const e = cfg.task.bookEnd > 0 ? cfg.task.bookEnd : urls.length
          sliced = urls.slice(s, e)
        }
        bookQueue = Array.from(new Set(sliced))
        await this.log(taskId, 'success', `范围发现完成: 共 ${bookQueue.length} 本书待采集`)
      }

      progress.booksTotal = bookQueue.length
      // jj-d: 书籍完成计数按轮归零 —— 修前跨轮累计(上一轮已完成的书计入本轮起点,
      // 重复运行的任务 booksDone 只增不减), TaskMonitor 计数标签会出现"书籍 2/1"
      // (Dashboard 进度条有钳制掩盖, 计数标签仍露馅); 每轮都从 bookQueue[0] 重跑, 归零才是真语义
      progress.booksDone = 0
      progress.phase = 'book'
      await this.saveProgress(taskId, progress, stats)

      // ---------- 逐本采集 ----------
      for (let bi = 0; bi < bookQueue.length; bi++) {
        const bookUrl = bookQueue[bi]
        if (rt.stopped || isStale()) break
        while (rt.paused && !rt.stopped && !isStale()) await sleep(600)
        if (rt.stopped || isStale()) break

        // feat-contentproxy-resume + feat-combo-theme-incremental: 已完结书籍整体跳过
        // —— 仅 status==='completed' 的书才会进 rt.completedBookUrls(完结书不会再有新章节);
        // 连载中(status==='ongoing')的书在 rt.ongoingBookUrls 中, 不整体跳过, 走 crawlOneBook
        // 的增量检查逻辑(抓目录→对比末章→无新章跳过/有新章增量采)。recrawlMode==='full' 启动时
        // 两 Set 已被清空, 此分支不触发(完全覆盖重采语义保留)
        if (rt.completedBookUrls.has(bookUrl)) {
          progress.booksDone++
          progress.currentBook = bookUrl
          progress.phaseNote = `跳过已完结 (${bi + 1}/${bookQueue.length})`
          await this.log(taskId, 'info', `跳过已完结: ${bookUrl}`)
          await this.saveProgress(taskId, progress, stats)
          continue
        }

        // 每本书重新读配置(支持在线调整)
        cfg = await this.loadConfig(taskId)
        if (!cfg) break
        const rule = cfg.rule

        try {
          progress.currentBook = bookUrl
          progress.phaseNote = `采集书籍 (${bi + 1}/${bookQueue.length})`
          // agent-B-runner(内存快照): 剩余书籍数 = 总数 - 已处理(含当前)
          progress.memBooksInQueue = Math.max(0, bookQueue.length - bi)
          await this.saveProgress(taskId, progress, stats)

          const bookResult = await this.crawlOneBook(
            taskId, bookUrl, rule, cfg.fetchOverride, cfg.task, rt, myEpoch, progress, stats, cfg.threads, cfg.interval, listFields.get(bookUrl)
          )
          // Bug 26: 删除 'paused-return' 死分支 —— grep crawlOneBook 全路径返回值仅
          // 'stopped'/'blocked'/'empty-toc'/'ok', 从不返回 'paused-return'(暂停由外层循环
          // waitIfPaused/sleepGap 检查点接管, 本书直接 return 'stopped' 或继续走正文批次)
          if (bookResult === 'blocked' || bookResult === 'empty-toc') {
            // 跳过的书也计入已完成, 防 booksDone/booksTotal 进度条永远到不了头
            progress.booksDone++
          }
          // feat-combo-theme-incremental: 状态分流由 crawlOneBook 内部完成 ——
          // detectedStatus==='completed' 时 crawlOneBook 已将 bookUrl 加入 rt.completedBookUrls;
          // detectedStatus==='ongoing'/'unknown' 时加入 rt.ongoingBookUrls + 记录末章 URL。
          // 'blocked'/'empty-toc'/'stopped' 不入任何集合(下次重试可恢复)。本处仅触发
          // saveProgress 把 Set/Map 落库, 不再硬塞 completedBookUrls(避免连载书被误判完结整体跳过)
          if (bookResult === 'ok') {
            await this.saveProgress(taskId, progress, stats)
          }
        } catch (e: any) {
          if (isStale()) {
            // jj-d: 本轮已被新一轮 start 取代(epoch 漂移) —— 进度/计数权归新循环, 旧循环
            // 在此只吞异常; 修前旧循环在途抓取抛错仍 saveProgress, 新一轮刚写入的进度被旧对象回滚
          } else if (e?.isCircuitBreak) {
            // tt-c: 熔断错误上抛到任务级 —— 多书任务同样立即终止(同站其余书籍必然同样失败,
            // 逐书硬敲无意义), 由外层 catch 统一转 error 终态 + autoRefresh 重排自愈
            throw e
          } else if (e?.isFetchTimeout) {
            // ee-d: 书籍页级 fetch 超时 —— 计失败+可见日志(与列表页路径口径一致),
            // 书籍保持未完成态, 稍后增量重试可恢复
            stats.errors++
            await this.log(taskId, 'error', `书籍抓取超时(源站在 timeout 内未响应, 书籍保持未完成): ${bookUrl.slice(0, 120)}`)
            await this.saveProgress(taskId, progress, stats)
          } else if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') {
            // 修复(x-a): stop/换代(abortAll)造成的在途中止不再计入失败 —— 原先点一次停止
            // 批量刷"书籍采集失败:抓取已中止(signal)"错误日志+errors 虚高; 中止语义由
            // 任务状态机接管, 章节保持 fetched=false 语义不变, 下次增量照常优先重采
            await this.saveProgress(taskId, progress, stats)
          } else if (e?.name === 'HostGateTimeout') {
            // bb-d: 同站闸门槽满等待超时(hostGate 限流保护, 非源站故障) — 与中止同口径
            // 不计 errors, 书籍保持未完成态, 稍后增量重试可恢复
            await this.log(taskId, 'warn', `书籍采集等待同站并发闸门超时(host:${hostGateKeyOf(bookUrl) || '未知'}, 该站在飞已达上限): ${bookUrl}; 书籍保持未完成, 稍后增量重试可恢复`)
            await this.saveProgress(taskId, progress, stats)
          } else {
            stats.errors++
            await this.log(taskId, 'error', `书籍采集失败 ${bookUrl}: ${e?.message}`)
            await this.saveProgress(taskId, progress, stats)
          }
        }
        await sleepGap(cfg.interval(), rt, myEpoch)
      }

      // ---------- 结束 ----------
      if (isStale()) {
        // ee-d ⑤: 本轮已被新一轮 start 取代(epoch 漂移) —— 任务终态权(完成日志/状态/进度)
        // 全归新循环; 修前 rt.stopped 已被新一轮重置为 false, 旧循环在此误写"任务完成"+done
        // (运行中任务被旧循环误标完成的实证见 verify-ee-d-epoch.ts)
      } else if (rt.stopped) {
        progress.phaseNote = '已停止'
        await this.saveProgress(taskId, progress, stats)
      } else {
        progress.phase = 'done'
        progress.phaseNote = '任务完成'
        await this.log(taskId, 'success', `✅ 任务完成: 新书${stats.booksCreated} 更新${stats.booksUpdated} | 新章节${stats.chaptersCreated} 更新${stats.chaptersUpdated} | 封面${stats.coversSaved} | 下拉词${stats.suggestWords} | 错误${stats.errors}`)
        // zz-d 修复(终态覆写竞态): 完成日志与 done 状态写之间存在 await(saveProgress/log),
        // 期间用户 stop(写 status stopped+cancelAutoRefresh)或新一轮 start(epoch++)落地的
        // 话, 原实现仍无条件写 done 并按旧配置重排 autoRefresh —— 用户的"停止"被完成态
        // 覆盖 + 已取消的定时刷新复活。落笔前重查三个让位条件(与上方分支判定同口径)
        if (!rt.paused && !rt.stopped && !isStale()) {
          // agent-B-runner(关键 bug): done 状态写改走 serializeStatusWrite 而非直 db.task.update。
          //  修前直 db.task.update 绕过 per-task 串行化链 → 并发 control('stop') 的
          //  serializeStatusWrite('stopped') 写序不保证 → SQLite 多连接非 FIFO 提交,
          //  'stopped' 晚于 'done' 提交时把已完成任务降级为 stopped(或反之 done 覆盖 stopped)。
          //  走 serializeStatusWrite 与 control('stop') 同链, 旧写必先完成、新写后发, 提交序=调用序
          await this.serializeStatusWrite(taskId, 'done').catch((e: any) => {
            // zz-d: 收尾途中任务被删除的 P2025 不再炸成"任务崩溃"(与 dd-b saveProgress
            // 同窗口同口径); 其余真 DB 故障继续上抛走崩溃路径落 error 终态
            if (e?.code !== 'P2025') throw e
          })
          // Bug 25: done 落库成功 → 置标志, 下方 catch 不再覆盖为 error(后续 saveProgress/
          // autoRefresh 排定抛错仅是收尾噪声, 不应降级已完成任务的终态)
          doneWritten = true
          // jj-e: autoRefresh 开启 → 排定下一次自动采集(实时更新)
          if (cfg?.task.autoRefresh) {
            this.scheduleAutoRefresh(taskId, cfg.task.refreshIntervalMin, cfg.task.name)
          }
        }
        await this.saveProgress(taskId, progress, stats)
      }
    } catch (e: any) {
      // ee-d ⑤: 旧循环崩溃同样不得误标新一轮运行中的任务(与结束块同权)
      if (!isStale()) {
        await this.log(taskId, 'error', `任务崩溃: ${e?.message || e}`)
        // Bug 25: done 已落库则不再覆盖为 error —— 修前 done 写成功后 saveProgress/autoRefresh
        // 排定抛错会落到本 catch 重写 error, 把已完成任务降级为崩溃态; 保留 done 终态语义,
        // 仅未完成时落 error(autoRefresh 仍按原逻辑在下面排定)
        if (!doneWritten) {
          // agent-B-runner: error 状态写同样走 serializeStatusWrite 与 done 路径同口径
          await this.serializeStatusWrite(taskId, 'error').catch(() => {})
        }
        // jj-e: autoRefresh 任务崩溃同样自动重试(实时更新的鲁棒性; 触发时会复核终态)
        try {
          if (cfg?.task.autoRefresh) this.scheduleAutoRefresh(taskId, cfg.task.refreshIntervalMin, cfg.task.name)
        } catch { /* cfg 可能未加载 */ }
      }
    } finally {
      const r = this.runtimes.get(taskId)
      // 仅当仍是本轮运行时才清 running: 停止后立刻重启的场景下, 旧循环收尾不能抹掉新一轮的 running 标志
      if (r && r.epoch === myEpoch) r.running = false
    }
  }

  // ================== hostGate 同站闸门抓取 ==================
  /**
   * 过闸抓取: fetchPage 前对目标 host 执行 acquireHostGate(槽满等待, 上限30s),
   * 结束后 releaseHostGate —— try/finally 成对, 任务中止(AbortError)路径同样释放不泄漏槽位。
   * 抓取抛错/返回挑战页(且非合法 JSON 体, 与 bqg713 纯API站放行口径一致)计为该 host
   * 连续失败, 喂给降额机制; 命中降额时写 taskLog 观测日志。
   * 多任务并行时同 host 共享同一闸门(globalThis 单例账本)。
   * zz-b: 增 opts.minGapMs 透传 —— 同 host 相邻准入最小间隔(速率维), 与并发 limit
   * 双维独立生效; ab-b 收口: 指向采集目标站本身的全部调用点(列表/书籍/目录/翻页/章节批次)
   * 统一传当次随机 interval(逐次取值, 在线调参立即生效), 不再有"未传=0 瞬时解除节流"的缺口。
   * 429 感知: 响应体(blocked 壳页)含 429/rate limit/Too Many Requests 特征, 或抛错带
   * status===429(HTTP/auto 引擎以错误形态上抛 4xx)时, 走 reportHostRateLimited 限流冷却,
   * 不喂连败降额链; 403/验证码等其余特征维持降额链不变。冷却生效写 taskLog info 观测日志。
   * ab-b: 抛错路径透传 e.retryAfterMs —— fetcher 已在 HTTP 抛错对象上保留 Retry-After 头
   * 毫秒值(整数秒/HTTP 日期双形态解析), 服务端给多少歇多久; 头缺失/非法(以及返回路径的
   * blocked 壳页——体内容无头信息可抢救)仍 undefined → 30s 兜底。上限钳 120s 在 hostgate 侧。
   * 注(设计如此): 封面(fetchBinary 直连封面 CDN)与下拉词(fetchSuggestKeywords 外部搜索引擎)
   * 不指向采集目标站本身, 不经本闸门、无 minGapMs 语义。
   * 注: parser 内部翻页(toc/content pagination)经 FetchConfig.pageFetch 注入本函数
   * (bb-d), 翻页请求与章节抓取同享同一闸门账本; 仅 rules/test 测试路由保持直连。
   */
  private async gateFetch(taskId: string, url: string, cfg: Partial<FetchConfig>, opts?: { minGapMs?: number }): Promise<FetchResult> {
    // agent-B-runner(请求预算+快照): 每次 gateFetch 入口先记账 —— requestCount++,
    //  currentUrl 设当前 URL(供 snapshot 端点)。若 rt.maxRequests > 0 且 requestCount
    //  超限则抛 BudgetExceeded 错误, 由上层 catch 转任务终态(防失控脚本式采集烧站点/IP)
    const rt = this.runtimes.get(taskId)
    if (rt) {
      rt.requestCount++
      rt.currentUrl = url
      if (rt.maxRequests > 0 && rt.requestCount > rt.maxRequests) {
        // 预算耗尽: 不再 fetchPage, 抛特殊错误中止任务(走 executeTask catch → error 终态)
        const err = new Error(`HTTP 请求预算耗尽(maxRequests=${rt.maxRequests}, 已发 ${rt.requestCount - 1} 次); 任务自动停止防失控`)
        err.name = 'BudgetExceeded'
        throw err
      }
    }
    // mm-b: 浏览器类桥模式(stealthy/playwright)自动钳制 hostGateLimit 至桥内信号量 3 ——
    // 桥内排队不提速只白占槽位; static/native 原值透传(详见 fetcher.effectiveHostGateLimit)
    const ticket = await acquireHostGate(url, { limit: effectiveHostGateLimit(cfg), minGapMs: opts?.minGapMs })
    try {
      const res = await fetchPage(url, cfg)
      // agent-B-runner(快照): 累计抓取字节数(响应体长度, 供 snapshot 展示带宽)
      if (rt) rt.bytesFetched += res?.html?.length || 0
      // agent-K-crawl-phase2(验证码计数): fetcher 检测到验证码时返回 captchaDetected=true;
      // 此处 ++ 让 snapshot 暴露给 UI(验证码命中报警阈值)
      if (rt && res?.captchaDetected) {
        rt.captchaEncountered++
        await this.log(taskId, 'warn', `验证码命中 ${res.captchaType ?? 'unknown'}: ${url.slice(0, 160)} (host 进入冷却期)`)
      }
      if (res.blocked && parseJsonBody(res.html) === undefined) {
        // zz-b: 429 特征壳页 → 限流冷却而非连败降额(降额链只对 403/验证码等真拦截特征);
        // ab-b: 壳页路径无响应头可抢救, 维持缺省 → 30s 兜底(精确 Retry-After 走下方抛错路径)
        if (RATE_LIMIT_HINT_RE.test(res.html)) {
          if (reportHostRateLimited(url)) {
            const s = hostGateSnapshot(url)
            const secs = s ? Math.max(1, Math.round((s.rateLimitedUntil - Date.now()) / 1000)) : 30
            await this.log(taskId, 'info', `同站限流冷却 ${secs}s (${hostGateKeyOf(url)})，恢复后自动续采`)
          }
        } else {
          const ev = reportHostFailure(url)
          if (ev) await this.log(taskId, 'info', `同站连续失败${ev.failStreak}次, 并发上限降至${ev.newLimit} (${ev.host})`)
        }
      } else {
        reportHostSuccess(url)
      }
      return res
    } catch (e: any) {
      // ee-d: fetch 超时(isFetchTimeout 标记)虽名为 AbortError 但属源站行为(慢站)——必须嗂连败,
      // 否则慢站对 hostGate 降额链完全不可见(修前实证: 6 章节超时降额触发 0 次);
      // 停止/换代在途中止(无标记 AbortError)保持 x-a 豁免不计连续失败
      if (e?.isFetchTimeout || (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR')) {
        // zz-b: HTTP 429 以抛错形态抵达(fetchHttp/curl/auto 升级链均保留 err.status)——
        // 同样走限流冷却而非降额链, 防止限流站点被误降并发后照旧硬敲。
        // ab-b: 透传 fetcher 抛错对象抢救出的 Retry-After 毫秒值(无值/非法 → undefined → 30s 兜底)
        if (e?.status === 429) {
          if (reportHostRateLimited(url, e?.retryAfterMs)) {
            const s = hostGateSnapshot(url)
            const secs = s ? Math.max(1, Math.round((s.rateLimitedUntil - Date.now()) / 1000)) : 30
            await this.log(taskId, 'info', `同站限流冷却 ${secs}s (${hostGateKeyOf(url)})，恢复后自动续采`)
          }
        } else {
          const ev = reportHostFailure(url)
          if (ev) await this.log(taskId, 'info', `同站连续失败${ev.failStreak}次, 并发上限降至${ev.newLimit} (${ev.host})`)
        }
      }
      throw e
    } finally {
      releaseHostGate(ticket)
    }
  }

  // ================== 单本书采集 ==================
  private async crawlOneBook(
    taskId: string,
    bookUrl: string,
    rule: RuleConfig,
    fetchOverride: Partial<FetchConfig>,
    taskCfg: { id: string; ruleId: string; recrawlMode: string; storageMode: string; smartCategory: boolean; smartComplete: boolean; autoSuggest: boolean },
    rt: TaskRuntime,
    myEpoch: number,
    progress: TaskProgress,
    stats: TaskStats,
    nextThreads: () => number,
    nextInterval: () => number,
    listFields?: { name?: string; author?: string; intro?: string; category?: string }
  ): Promise<string> {
    // jj-d: myEpoch 改由调用方(executeTask)传入 —— 修前在此重新捕获 rt.epoch, stop→start
    // 恰落在 executeTask 捕获点与本函数调用点之间的 await 窗口(loadConfig/saveProgress,
    // 数毫秒)时, 旧循环会绑定【新一轮】epoch 而永不检出漂移, 双循环并发采集同一任务,
    // 且旧循环结束块 isStale()=false 可误写 done 终态; 传入绑定从根上关闭该窗口
    const waitIfPaused = async () => {
      // epoch 漂移: 本轮已被新一轮 start 取代, 立即退出暂停等待(防旧循环复活)
      while (rt.paused && !rt.stopped && rt.epoch === myEpoch) await sleep(600)
    }

    // ---------- 1. 书籍信息页 ----------
    await waitIfPaused()
    if (rt.stopped || rt.epoch !== myEpoch) return 'stopped'
    // ab-b: 书籍页同为采集目标站请求, 同款传当次随机 interval 作同 host 准入最小间隔
    // (逐次重新取值, 在线调参语义与章节批次/列表页一致; 关闭 zz-b 遗留"不传=0 瞬时解除节流"缺口)
    const bookRes = await this.gateFetch(taskId, bookUrl, { ...buildFetch(rule, fetchOverride) }, { minGapMs: nextInterval() })
    // 纯JSON API站适配: fetcher 的"极短内容判拦"是 HTML 挑战壳启发式, 会把百来字节的
    // 书籍API JSON(bqg713 /api/book ≈150字符)误判为 blocked —— 响应体是合法JSON时
    // 必然是API数据而非挑战页(挑战页永远是HTML), JSON有效即放行
    const bookBlocked = bookRes.blocked && parseJsonBody(bookRes.html) === undefined
    // 被拦(验证码/挑战壳)的 HTML 解析出来全是垃圾, 直接跳过本书(计入错误, 下次重试), 避免入库脏书
    if (bookBlocked) {
      stats.errors++
      await this.log(taskId, 'error', `书籍页疑似被拦截(验证码/JS挑战), 跳过本书: ${bookUrl}`)
      return 'blocked'
    }
    await this.log(taskId, 'info', `书籍页: ${bookUrl} (引擎:${bookRes.engine}, ${bookRes.html.length}字节)`)
    const parsed = parseBook(bookRes.html, bookUrl, rule.book)
    // ll-c2: 字段兑底链 detail解析 → 列表页字段(detail端点空数据时不丢书名) → URL片段 → 未知
    // agent-B-runner: new URL(bookUrl) 可能抛(畸形 URL/协议缺失), 包裹 try/catch 兜底空串
    //  修前抛错会沿 crawlOneBook → executeTask book-level catch → 本书计 error, 而非落到
    //  || '未知书名' 兜底分支(短路求值在 throw 时已跳出)
    const urlPathName = (() => { try { return new URL(bookUrl).pathname.slice(1, 30) } catch { return '' } })()
    const bookName = cleanTextField(parsed.name, 120) || cleanTextField(listFields?.name, 120)
      || urlPathName || '未知书名'
    const intro = cleanIntro(parsed.intro) || cleanIntro(listFields?.intro || '')
    const author = cleanTextField(parsed.author, 60) || cleanTextField(listFields?.author, 60) || '佚名'

    // feat-combo-theme-incremental(连载增量): 标记本次是否为连载书的增量检查
    // —— rt.ongoingBookUrls 中的书重启后不整体跳过, 抓目录后与 rt.bookLastChapters 中
    // 存储的末章 URL 对比: 相同 → 跳过新章采集; 不同 → 增量采新章(existUrlMap 自动去重已采过的)
    const isOngoingRecheck = rt.ongoingBookUrls.has(bookUrl)
    const storedLastChapterUrl = isOngoingRecheck ? rt.bookLastChapters.get(bookUrl) : undefined

    // 智能分类
    let categoryName: string | null = cleanTextField(parsed.category, 30) || cleanTextField(listFields?.category, 30) || null
    if (taskCfg.smartCategory) {
      const sm = await smartCategory(bookName, intro, categoryName || undefined)
      if (sm.category) {
        categoryName = sm.category
        await this.log(taskId, 'info', `智能分类[${sm.method}]: ${bookName} → ${sm.category}`)
      }
    }
    let categoryId: string | null = null
    if (categoryName) {
      // R4-9: category.upsert 在并行任务创建同名分类时 @@unique(name) 冲突 P2002;
      //  旧行为未捕获 → crawlOneBook 抛错 → 本书被跳过计为 error。改为 try/catch,
      //  P2002 时 re-findByName 拿到由另一个并行任务创建的分类 ID(其事务已 commit)
      // R5-20: 把单次重试扩为最多 3 次带退避循环 —— 极罕见情况下另一任务的事务 >50ms 才
      //  commit, 单次 50ms 重试仍读到 null, categoryId=null 导致书丢失分类关联; 3 次指数
      //  退避(50/100/200ms)累计等待 350ms 覆盖典型 SQLite busy 锁, 仍失败则记 warn 但不抛错。
      const CATEGORY_P2002_MAX_ATTEMPTS = 3
      for (let attempt = 0; attempt < CATEGORY_P2002_MAX_ATTEMPTS; attempt++) {
        try {
          const cat = await db.category.upsert({
            where: { name: categoryName },
            create: { name: categoryName },
            update: {},
          })
          categoryId = cat.id
          break
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e
          // P2002: 并行任务同时创建同名分类, re-findUnique 拿对方 ID
          const existing = await db.category.findUnique({
            where: { name: categoryName },
            select: { id: true },
          })
          if (existing) {
            categoryId = existing.id
            break
          }
          // 另一事务未提交, findUnique 读不到; 退避后再试(最后一次仍读不到则放弃, categoryId=null)
          if (attempt < CATEGORY_P2002_MAX_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)))
          } else {
            await this.log(taskId, 'warn', `分类「${categoryName}」3 次重试后仍未就绪, 本书暂不关联分类`).catch(() => {})
          }
        }
      }
    }

    // 智能完结(先存unknown, 目录采完后最终判定)
    let detectedStatus: 'completed' | 'ongoing' | 'unknown' = 'unknown'
    if (taskCfg.smartComplete) {
      const det = smartCompleteDetect({ statusField: parsed.status, intro, bookName, latestChapterTitle: parsed.latestChapter })
      detectedStatus = det.status
      await this.log(taskId, 'info', `智能完结初判: ${det.status}(${det.reason})`)
    }

    // ---------- 2. 封面下载 → webp ----------
    // ab-b 注(设计如此): 封面 fetchBinary 直连外部 CDN(封面常不在目标站域), 不经 gateFetch
    // 同站闸门、不传 minGapMs —— 与列表/书籍/目录/章节的"目标站"口径刻意区分
    let coverPath = ''
    if (parsed.cover) {
      try {
        const bin = await fetchBinary(parsed.cover, { ...buildFetch(rule, fetchOverride), engine: 'http' })
        if (bin) {
          const saved = await saveCoverWebp(bin.buf, `book_${Date.now()}_${Math.floor(Math.random() * 9999)}`)
          if (saved) {
            coverPath = saved
            stats.coversSaved++
            await this.log(taskId, 'success', `封面已转存webp: ${saved}`)
          }
        }
      } catch (e: any) {
        await this.log(taskId, 'warn', `封面下载失败: ${e?.message?.slice(0, 80)}`)
      }
    }

    // ---------- 3. 建库/更新书籍 ----------
    // agent-B-runner(关键 bug): 跨源去重匹配条件收紧 —— 修前 OR:[sourceUrl, {name+author}]
    //  在 bookName='未知书名' && author='佚名' 兜底默认值时, 会把所有"书名/作者解析失败"的书
    //  互相匹配为同书 → 一个任务把另一任务的"未知书名"书覆盖(章节串库/数据丢失)。
    //  修法: 仅在 bookName 非'未知书名' 且 author 非'佚名' 时, name+author 才参与 OR 匹配;
    //  否则只按 sourceUrl 匹配(零回归: 同 URL 仍是同书, 不依赖书名/作者)
    const isDefaultName = bookName === '未知书名'
    const isDefaultAuthor = author === '佚名'
    const matchWhere = isDefaultName || isDefaultAuthor
      ? { sourceUrl: bookUrl }
      : { OR: [{ sourceUrl: bookUrl }, { name: bookName, author }] }
    const existing = await db.book.findFirst({ where: matchWhere })
    let bookId: string
    const bookData = {
      name: bookName,
      author,
      categoryId,
      intro,
      status: detectedStatus,
      sourceUrl: bookUrl,
      sourceRuleId: taskCfg.ruleId,
      storageMode: taskCfg.storageMode,
      collectedAt: new Date(),
    }
    if (existing) {
      if (taskCfg.recrawlMode === 'full') {
        // 完全覆盖: 删除旧章节(及txt文件), 重置封面
        await db.chapter.deleteMany({ where: { bookId: existing.id } })
        if (existing.storageMode === 'txt') await deleteBookTxt(existing.id)
        await db.book.update({ where: { id: existing.id }, data: { ...bookData, cover: coverPath, wordCount: 0, latestChapter: '' } })
        await this.log(taskId, 'warn', `完全覆盖重采集: 清除《${existing.name}》旧数据`)
      } else {
        const upd: any = { ...bookData }
        if (coverPath) upd.cover = coverPath
        if (detectedStatus !== 'unknown') {
          upd.status = detectedStatus
        } else {
          // zz-d 修复(完结状态静默回退): bookData 展开已携带 status: detectedStatus
          // ('unknown'), 原条件只在"检测成功"时覆写, 检测无结论时 unknown 照样落库 ——
          // 增量刷新把既有 completed/ongoing 书籍状态重置为 unknown(smartComplete 关闭时
          // 每次增量必现; 开启时初判+终判均无结论的书同样中招)。无结论时不写 status 字段,
          // 保留库中原值(完全覆盖路径不动: 全量重建本就重置一切, 且目录采完后终判仍可回填)
          delete upd.status
        }
        await db.book.update({ where: { id: existing.id }, data: upd })
      }
      stats.booksUpdated++
      bookId = existing.id
      await this.log(taskId, 'info', `更新书籍: 《${bookName}》(${bookUrl})`)
    } else {
      const nb = await db.book.create({ data: { ...bookData, cover: coverPath } })
      stats.booksCreated++
      bookId = nb.id
      await this.log(taskId, 'success', `新建书籍: 《${bookName}》`)
    }

    // ---------- 4. 目录页(预留分页 + 乱序重排 + 去重) ----------
    await waitIfPaused()
    if (rt.stopped || rt.epoch !== myEpoch) return 'stopped'
    const fetchCfgBase = buildFetch(rule, fetchOverride)
    // ff-b②: Referer 链伪造(规则 fetch.refererChain=true 时生效) —— 目录/章节请求携带
    // 书籍页 URL 作 Referer(真实"上一级页面"同链路语义, 很多站校验 Referer 同域/同链路);
    // 未启用时不注入字段, 行为与原先完全一致(零回归)
    const fetchCfg: Partial<FetchConfig> = fetchCfgBase.refererChain
      ? { ...fetchCfgBase, refererUrl: bookUrl }
      : fetchCfgBase

    // 翻页请求过闸注入(bb-d): parseToc/parseContent 内部翻页"下一页"抓取原直连 fetchPage
    // (aa-f 已知边界), 现经 FetchConfig.pageFetch 回调接入同款 acquire/release 闸门语义,
    // 与章节抓取/多任务并行同 host 共享同一账本; rules/test 测试路由不注入保持直连语义。
    // ll-c: Referer 链翻页 —— parser 翻页第2页起回传上一页 URL, 启用 refererChain 时
    // Referer 从"恒书籍页"升级为"翻页链逐页回溯"(真实浏览器翻页导航语义, 第1页仍书籍页);
    // 未启用链时 prevUrl 被忽略(fetchCfg 无 refererUrl), 行为零变化
    // ab-b: 翻页请求同为采集目标站请求, 同款传当次随机 interval 作 minGapMs(逐次取值)
    const pageFetchGated = (u: string, prevUrl?: string) =>
      this.gateFetch(
        taskId, u,
        fetchCfgBase.refererChain && prevUrl ? { ...fetchCfg, refererUrl: prevUrl } : fetchCfg,
        { minGapMs: nextInterval() }
      )
    const tocFetchCfg: Partial<FetchConfig> = { ...fetchCfg, pageFetch: pageFetchGated }
    const contentFetchCfg: Partial<FetchConfig> = { ...fetchCfg, pageFetch: pageFetchGated }

    /** 解析目录页HTML: tocLink规则 → 书籍页本身 → 目录链接自动嗅探兜底 */
    const extractToc = async (html: string, baseUrl: string): Promise<{ items: TocItem[]; pages: number }> => {
      // 1) 规则显式配置了 tocLink: 从书籍页提取目录页地址
      if (rule.toc.tocLink?.expression) {
        try {
          // const 模板 tocLink 需要 {q.*}/{字段} 占位符取值表(如 bqg713: /api/booklist?id={q.id})
          const { extractField, urlVars } = await import('./parser')
          const ch = await import('cheerio')
          const $ = ch.load(html)
          const link = extractField(html, $, null, null, rule.toc.tocLink, { vars: urlVars(baseUrl) })
          const abs = absolutize(link, baseUrl)
          if (abs && /^https?:\/\//.test(abs) && abs !== baseUrl) {
            // 瞬态韧性: 目录页抓取失败(限流/瞬时 403)退避后重试一次
            let page: Awaited<ReturnType<typeof fetchPage>>
            try {
              page = await this.gateFetch(taskId, abs, fetchCfg, { minGapMs: nextInterval() }) // ab-b
            } catch (_firstErr) {
              await new Promise((r) => setTimeout(r, 800))
              // 二次仍失败则向上抛, 走书籍页回退; ab-b: 重试同样逐次取随机 interval 作 minGapMs
              page = await this.gateFetch(taskId, abs, fetchCfg, { minGapMs: nextInterval() })
            }
            await this.log(taskId, 'info', `目录页(tocLink): ${abs} (${page.html.length}字节)`)
            const r1 = await parseToc(abs, page.html, rule.toc, tocFetchCfg)
            if (r1.items.length) return r1
          }
        } catch (e: any) {
          await this.log(taskId, 'warn', `tocLink 解析失败: ${e?.message?.slice(0, 80)}`)
        }
      }
      // 2) 书籍页即目录页
      const r2 = await parseToc(baseUrl, html, rule.toc, tocFetchCfg, async (page, found) => {
        if (page % 5 === 0) await this.log(taskId, 'info', `目录解析中… 第${page}页 已发现${found}章`)
      })
      if (r2.items.length) return r2
      // 3) 兜底: 自动嗅探"目录"链接
      try {
        const ch = await import('cheerio')
        const $ = ch.load(html)
        let guess = ''
        $('a').each((_, el) => {
          if (guess) return
          const t = ($(el).text() || '').trim()
          if (/^(查看目录|章节目录|最新章节列表|章节列表|点击查看目录|全文目录|目录)$/.test(t)) {
            guess = $(el).attr('href') || ''
          }
        })
        const abs = absolutize(guess, baseUrl)
        if (abs && /^https?:\/\//.test(abs) && abs !== baseUrl) {
          const page = await this.gateFetch(taskId, abs, fetchCfg, { minGapMs: nextInterval() }) // ab-b
          await this.log(taskId, 'info', `目录链接自动嗅探: ${abs}`)
          return await parseToc(abs, page.html, rule.toc, tocFetchCfg)
        }
      } catch (e: any) {
        await this.log(taskId, 'warn', `目录嗅探失败: ${e?.message?.slice(0, 80)}`)
      }
      return r2
    }

    const tocRes = await extractToc(bookRes.html, bookUrl)
    let tocItems = reorderToc(tocRes.items)
    await this.log(taskId, 'success', `目录解析完成: ${tocItems.length} 章(含翻页${tocRes.pages}页, 乱序重排+去重后)`)

    // 检查点: extractToc 内含多次 fetchPage(tocLink/翻页, 可达数十秒), 暂停/停止/新轮启动要及时生效
    await waitIfPaused()
    if (rt.stopped || rt.epoch !== myEpoch) return 'stopped'

    // 反反爬增强: HTTP 引擎拿到的书籍页对 AJAX 目录站(ixdzs/101kks 系)只含部分章节甚至为空,
    // 且页面本身不触发拦截特征 → auto 链路不会自动切浏览器; browser 引擎规则也可能因瞬时
    // 限流拿到"渲染成功但 AJAX 目录未注入"的页面。目录为空/异常少时强制重取书籍页再走一遍
    // tocLink→本页→嗅探 流程(只重试一次, 防慢站拖垮任务)
    const httpTocCount = tocItems.length
    if (httpTocCount < 5 && (await checkBrowser())) {
      await this.log(taskId, 'warn', `目录仅${httpTocCount}章(疑似AJAX异步加载/瞬时拦截), 浏览器渲染重取书籍页…`)
      try {
        // ab-b: 浏览器重取书籍页同款传当次随机 interval 作 minGapMs(语义同书籍页首取)
        const bPage = await this.gateFetch(taskId, bookUrl, { ...fetchCfg, engine: 'browser', waitMs: Math.max(fetchCfg.waitMs || 0, 2500) }, { minGapMs: nextInterval() })
        const bToc = await extractToc(bPage.html, bookUrl)
        if (bToc.items.length > httpTocCount) {
          tocItems = reorderToc(bToc.items)
          await this.log(taskId, 'success', `浏览器渲染目录解析完成: ${tocItems.length} 章(此前仅${httpTocCount}章)`)
        }
      } catch (e: any) {
        await this.log(taskId, 'warn', `浏览器目录重取失败: ${e?.message?.slice(0, 100)}`)
      }
    }
    // 检查点: 浏览器重取同为长操作(渲染+稳定采样可达 40s+), 采纳结果/入库前再查一次
    await waitIfPaused()
    if (rt.stopped || rt.epoch !== myEpoch) return 'stopped'

    if (tocItems.length === 0) {
      await this.log(taskId, 'error', `《${bookName}》目录为空, 跳过正文采集`)
      return 'empty-toc'
    }

    // 最终完结判定(目录末章)
    if (taskCfg.smartComplete && detectedStatus === 'unknown') {
      const det = smartCompleteDetect({ lastChapterTitle: tocItems[tocItems.length - 1]?.title, latestChapterTitle: parsed.latestChapter, bookName })
      if (det.status !== 'unknown') {
        detectedStatus = det.status
        await db.book.update({ where: { id: bookId }, data: { status: detectedStatus } })
        await this.log(taskId, 'info', `智能完结终判: ${det.status}(${det.reason})`)
      }
    }

    // ---------- feat-combo-theme-incremental: 连载增量检查 ----------
    // rt.ongoingBookUrls 中的书: 与 rt.bookLastChapters 中存储的末章 URL 对比
    //  - 相同 → 无新章节, 跳过正文采集(仍计入 booksDone, 加入 ongoingBookUrls 维持记忆)
    //  - 不同 → 增量采新章(下方 existUrlMap 自动跳过已采过的)
    // 注: 完结书(rt.completedBookUrls)在外层循环已整体跳过, 不会走到这里
    if (isOngoingRecheck && storedLastChapterUrl) {
      const currentLastChapterUrl = tocItems[tocItems.length - 1]?.url || ''
      if (currentLastChapterUrl && currentLastChapterUrl === storedLastChapterUrl) {
        // 末章 URL 相同 → 视为无新章节
        await this.log(
          taskId,
          'info',
          `增量检查连载: 《${bookName}》(末章未变, 跳过新章采集; 上次末章: ${storedLastChapterUrl.slice(0, 80)})`,
        ).catch(() => {})
        // 状态分流: 完结→completedBookUrls; 连载中/unknown→ongoingBookUrls + 更新末章 URL
        // agent-B-runner: 用 addToResumeSet/addToBookLastChapters 即时检查内存上限; 成功 → 移出 failedBookUrls
        if (detectedStatus === 'completed') {
          addToResumeSet(rt.completedBookUrls, bookUrl)
          rt.ongoingBookUrls.delete(bookUrl)
          rt.bookLastChapters.delete(bookUrl)
        } else {
          addToResumeSet(rt.ongoingBookUrls, bookUrl)
          if (currentLastChapterUrl) addToBookLastChapters(rt.bookLastChapters, bookUrl, currentLastChapterUrl)
        }
        rt.failedBookUrls.delete(bookUrl)
        progress.booksDone++
        await this.saveProgress(taskId, progress, stats)
        return 'ok'
      }
      // 末章 URL 不同 → 有新章节, 继续走下方增量采集(existUrlMap 自动跳过已采过的)
      if (currentLastChapterUrl) {
        await this.log(
          taskId,
          'info',
          `增量检查连载: 《${bookName}》(上次末章: ${storedLastChapterUrl.slice(0, 80)}, 当前末章: ${currentLastChapterUrl.slice(0, 80)})`,
        ).catch(() => {})
      }
    }

    // ---------- feat-combo-theme-incremental: 跨源去重 ----------
    // existing(同 URL 或 同 name+author) 来自不同 rule(sourceRuleId !== taskCfg.ruleId):
    //  - 比较 chapter 数: 本源新 TOC <= 既有章数 → 跳过(已有更完整数据)
    //  - 本源新 TOC > 既有章数 → 增量合并新章(下方 existUrlMap 自动只采新章)
    // 注: 既有 db.book.findFirst 在第 3 步已取, 这里复用; existing 不存在时本块跳过
    if (existing && existing.sourceRuleId && existing.sourceRuleId !== taskCfg.ruleId) {
      let existingChapCount = 0
      try {
        existingChapCount = await db.chapter.count({ where: { bookId: existing.id } })
      } catch {
        // count 失败兜底: 视为 0, 走下方比较链(若本源有章节则会增量合并)
        existingChapCount = 0
      }
      if (tocItems.length <= existingChapCount) {
        // 其他源已有更完整或同等数据 → 跳过本书采集(不写章节, 不更新统计)
        await this.log(
          taskId,
          'info',
          `跨源去重: 《${bookName}》已存在于其他源(其他源 ${existingChapCount} 章 / 本源 ${tocItems.length} 章), 跳过`,
        ).catch(() => {})
        // 状态分流: 完结→completedBookUrls; 连载中/unknown→ongoingBookUrls + 记录末章 URL
        // agent-B-runner: 用 addToResumeSet/addToBookLastChapters 即时检查内存上限; 成功 → 移出 failedBookUrls
        if (detectedStatus === 'completed') {
          addToResumeSet(rt.completedBookUrls, bookUrl)
          rt.ongoingBookUrls.delete(bookUrl)
          rt.bookLastChapters.delete(bookUrl)
        } else {
          addToResumeSet(rt.ongoingBookUrls, bookUrl)
          const lastUrl = tocItems[tocItems.length - 1]?.url
          if (lastUrl) addToBookLastChapters(rt.bookLastChapters, bookUrl, lastUrl)
        }
        rt.failedBookUrls.delete(bookUrl)
        progress.booksDone++
        await this.saveProgress(taskId, progress, stats)
        return 'ok'
      }
      // 本源章数更多 → 增量合并新章, 继续走下方章节入库流程(existUrlMap 跳过既有章)
      await this.log(
        taskId,
        'info',
        `跨源合并: 《${bookName}》其他源 ${existingChapCount} 章 < 本源 ${tocItems.length} 章, 增量合并新章节`,
      ).catch(() => {})
    }

    // ---------- 5. 章节入库(增量/全量) + 正文多线程采集 ----------
    const isFull = taskCfg.recrawlMode === 'full'
    // R4-11: existChapters 限定 10000 行内存上限 —— 10000+ 章节的大部头书原先 findMany 全量加载
    //  每行 ~200B = ~2MB / 书, 并行多任务会乘以倍数。select 已最小化(id/url/title/idx/volume/fetched
    //  各字段后续重排/去重/未采回填都需用到, 不能再裁), 仅用 take 10000 限定内存: 超过 10000 章的
    //  书尾部章节视为"新"(并入 queue, 增量重采语义保持, 多采几次内容, 但内存有界)。
    //
    // R5-1: 但 R4-11 的"10k 之后视为新章"对"已存在但 idx>10000 的章节"反而是灾难 ——
    //  @@unique([bookId,idx]) 让阶段C 的 db.chapter.create 必抛 P2002, catch 吞掉后该章
    //  永远拿不到 chId, 阶段D 回填连锁失败, 连续 20 个 P2002 还会触发熔断使任务卡 error。
    //  修法: 命中 10000 上限时查 count; <=50000 直接全量加载(50000×~200B≈10MB 安全);
    //  >50000 维持 10k 采样并 log 警告(极端大部头防 OOM, 接受潜在重复抓取为可接受代价)
    let existChapters = await db.chapter.findMany({
      where: { bookId },
      select: { id: true, url: true, title: true, fetched: true, idx: true, volume: true },
      take: 10_000,
      orderBy: { idx: 'asc' },
    })
    if (existChapters.length === 10_000) {
      const total = await db.chapter.count({ where: { bookId } })
      if (total > 50_000) {
        await this.log(
          taskId,
          'warn',
          `《${bookName}》章节 ${total} 条 >50000 上限, 仅用前 10000 条做去重基准, 尾部章节可能被重复抓取(为防 OOM 接受此代价)`,
        )
      } else {
        // 全量加载(<=50000, 内存可控), 防尾部章被误判为新章触发 P2002 风暴 + 熔断
        existChapters = await db.chapter.findMany({
          where: { bookId },
          select: { id: true, url: true, title: true, fetched: true, idx: true, volume: true },
          orderBy: { idx: 'asc' },
        })
      }
    }
    const existUrlMap = new Map(existChapters.filter((c) => c.url).map((c) => [c.url, c]))
    const existTitleMap = new Map(existChapters.map((c) => [c.title, c]))

    // 修复(高危): 章节表有 @@unique([bookId, idx]) —— 源站中途插入新章时, 新章最终 idx 会与
    // 尚未移位的旧章冲突, 原 create 直接抛错导致整本书采集失败。改为三阶段重排:
    //   A) 冲突旧章挪到唯一负数临时位(不可能与正数目标位冲突)
    //   B) 被挤掉的陈旧章(已不在当前目录中)挪到尾部大序号位
    //   C) 新章按最终 idx 建行(此时正数位已无冲突)
    //   D) 旧章回填最终 idx(目标位一一对应, 无其他占用者)
    const queue: { chId?: string; title: string; url: string; volume: string; idx: number }[] = []
    const creates: { title: string; url: string; volume: string; idx: number }[] = []
    const moves: { id: string; to: number }[] = []
    const volumeBackfill: { id: string; volume: string }[] = []
    for (let i = 0; i < tocItems.length; i++) {
      const item = tocItems[i]
      const title = cleanChapterTitle(item.title, bookName)
      const url = item.url
      const volume = (item.volume || '').trim().slice(0, 120) // kk-a: 分卷名随章落库
      const old = url ? existUrlMap.get(url) : existTitleMap.get(title)
      if (isFull || !old) {
        // 全量: 全部重建 / 增量: 只采不存在的
        const q = { title, url, volume, idx: i + 1 }
        queue.push(q)
        if (url) creates.push(q)
      } else if (old.idx !== i + 1) {
        // 已存在但序号变了: 记录重排计划(阶段A/D 执行)
        moves.push({ id: old.id, to: i + 1 })
        // kk-a: 重排回填时顺带补分卷名(规则新增 volume 提取后, 旧章 volume 为空)
        if (volume && !old.volume) volumeBackfill.push({ id: old.id, volume })
      } else if (volume && !old.volume) {
        // kk-a: 位置不变的已存在章, 同样补空缺分卷名
        volumeBackfill.push({ id: old.id, volume })
      }
    }
    // 阶段A: 冲突旧章 → 负数临时位
    // tt-c 修复: 原固定分配 -(mi+1)(-1,-2,...) 假设负数位全部空闲 —— 但若上一轮重排中途被杀
    // (进程重启/部署), 阶段A→D 之间的临时负位会残留(P2002 撞车 → catch 吞掉 → 该章未挪动,
    // 后续阶段C建行/阶段D回填连锁失败 + 残留章永久卡负位)。改为动态基线: 临时位全部压到
    // 当前全书最小 idx 之下(含残留负位), 与任何存量行(含崩溃残留)严格无交。
    const minExistIdx = existChapters.reduce((mn, c) => Math.min(mn, c.idx), 0)
    const tempBase = minExistIdx - moves.length - 1
    // R5-9/R5-10: 各阶段开头检查 rt.stopped || rt.epoch !== myEpoch ——
    //  万章+大部头书的阶段A/B/D 是顺序 db.chapter.update 循环, 每条 5-10ms, 全程可达分钟级,
    //  用户点"停止"信号需在每个阶段入口尽快生效, 避免无响应窗口; 若已停止则记日志并直接 return。
    if (rt.stopped || rt.epoch !== myEpoch) {
      await this.log(taskId, 'info', '阶段A: 任务已停止, 中止章节重排').catch(() => {})
      return 'stopped'
    }
    for (let mi = 0; mi < moves.length; mi++) {
      // Bug 5: 阶段A .catch 改为 swallowExpectedDb —— 仅放行 P2025(记录已删)/P2002(瞬态撞位),
      // 真 DB 故障上抛中止重排(修前 .catch(()=>{}) 无差别吞, 连锁失败致序号永久错乱)
      await db.chapter.update({ where: { id: moves[mi].id }, data: { idx: tempBase + mi } }).catch(swallowExpectedDb)
    }
    // 阶段B: 与新行 idx 冲突、但已不在当前目录中的陈旧章 → 挪到尾部(保留可读顺序, 不参与正文采集)
    // 修复(x-a高危): 目标位保留集只含 creates 不含 moves —— 陈旧章(已从目录消失)恰好占住
    // 某个重排目标位时, 阶段D回填撞 @@unique([bookId,idx]) 且被 catch 吞掉, 该章永久卡在
    // -1 负数临时位(目录头挂负序号/章节丢失); 补 for(m of moves) newTargetIdx.add(m.to)
    // 让阶段B把占位陈旧章挪尾腾位
    const movedIds = new Set(moves.map((m) => m.id))
    const newTargetIdx = new Set(creates.map((c) => c.idx))
    for (const m of moves) newTargetIdx.add(m.to)
    const tailMoves = new Map<string, number>()
    let tailIdx = Math.max(tocItems.length, existChapters.reduce((mx, c) => Math.max(mx, c.idx), 0), 0)
    // R5-9/R5-10: 阶段B 入口 stop/epoch 检查(同阶段A)
    if (rt.stopped || rt.epoch !== myEpoch) {
      await this.log(taskId, 'info', '阶段B: 任务已停止, 中止章节重排').catch(() => {})
      return 'stopped'
    }
    for (const c of existChapters) {
      if (movedIds.has(c.id)) continue
      // tt-c 增强: 负 idx 残留章(历史重排中途被杀遗留)也是非法位(章序必须 ≥1), 一并治愈摎尾,
      // 防止永久卡在负数位(前台排序置顶/导出错位)
      if (newTargetIdx.has(c.idx) || c.idx < 0) {
        tailIdx += 1
        tailMoves.set(c.id, tailIdx)
        // Bug 5: 阶段B .catch 改为 swallowExpectedDb(同阶段A口径)
        await db.chapter.update({ where: { id: c.id }, data: { idx: tailIdx } }).catch(swallowExpectedDb)
      }
    }
    // 阶段C: 新章按最终 idx 建行; 单章建行失败只计错误, 不再拖垮整本书
    const idMap = new Map<string, string>()
    // R5-9/R5-10: 阶段C 入口 stop/epoch 检查(万章级 creates 循环可达分钟级)
    if (rt.stopped || rt.epoch !== myEpoch) {
      await this.log(taskId, 'info', '阶段C: 任务已停止, 中止章节重排').catch(() => {})
      return 'stopped'
    }
    for (const q of creates) {
      try {
        const created = await db.chapter.create({
          data: { bookId, idx: q.idx, title: q.title, url: q.url, volume: q.volume, storage: taskCfg.storageMode, fetched: false },
        })
        idMap.set(q.url, created.id)
        stats.chaptersCreated++
      } catch (e: any) {
        // Bug 5: 阶段C 记错后仅放行 P2025(书被删)/P2002(瞬态撞位), 真 DB 故障上抛——
        // 修前本 catch 无差别吞所有异常, 真 DB 故障(磁盘满/连接断)时本书重排静默错乱,
        // 后续阶段D回填撞空位连锁失败。真故障应让本书重排干净 abort(走书籍级 error)
        stats.errors++
        await this.log(taskId, 'error', `章节记录创建失败 ${q.title}: ${e?.message?.slice(0, 80)}`)
        if (e?.code !== 'P2025' && e?.code !== 'P2002') throw e
      }
    }
    // 已存在但未fetched的旧章节也进队列(挪过尾部位的用新序号, 保证txt文件名与DB一致)
    // jj-d: 被"重排"(阶段A/D)的未采章回填后 DB idx=mv.to, 队列仍用快照旧 idx → txt 模式
    // 文件名按旧 idx 落盘(如 00004_xxx.txt)与 DB 最终 idx(5)永久错位; 尾挪章本就取
    // tailMoves, 重排章同样取最终位
    if (!isFull) {
      const moveFinalIdx = new Map(moves.map((m) => [m.id, m.to]))
      const unfetched = existChapters.filter((c) => !c.fetched)
      for (const c of unfetched) {
        if (c.url && !idMap.has(c.url)) {
          queue.push({ chId: c.id, title: c.title, url: c.url, volume: c.volume || '', idx: tailMoves.get(c.id) ?? moveFinalIdx.get(c.id) ?? c.idx })
          idMap.set(c.url, c.id)
        }
      }
    }
    // 阶段D: 旧章回填最终 idx(序号映射一一对应, 目标位已无其他占用者, 可安全回填)
    // R5-9/R5-10: 阶段D 入口 stop/epoch 检查(同阶段A/B/C)
    if (rt.stopped || rt.epoch !== myEpoch) {
      await this.log(taskId, 'info', '阶段D: 任务已停止, 中止章节重排').catch(() => {})
      return 'stopped'
    }
    for (const mv of moves) {
      // Bug 5: 阶段D .catch 改为 swallowExpectedDb(同阶段A/B口径)
      await db.chapter.update({ where: { id: mv.id }, data: { idx: mv.to } }).catch(swallowExpectedDb)
    }
    // kk-a: 分卷名回填(只补空缺, 不覆盖已有值; 批量逐条, 失败不影响采集)
    for (const vb of volumeBackfill) {
      // Bug 5: 分卷回填 .catch 改为 swallowExpectedDb(同口径)
      await db.chapter.update({ where: { id: vb.id }, data: { volume: vb.volume } }).catch(swallowExpectedDb)
    }

    // 阶段E: 删除超出目录范围的纯尾部陈旧章 —— Bug 10 修复。修前阶段B 只挪走"占住新行
    // 目标位"的陈旧章, idx > tocItems.length 且 url 不在当前目录中的纯尾部陈旧章(无冲突、
    // 不占目标位)既不挪也不删, 永久残留库中(前台分页/导出拖尾脏章)。本阶段清理之。
    // guard: currentUrls 为空(目录项均无 url 的边角)时跳过(notIn:[] 会匹配全部, 误删有效章)
    // R5-9/R5-10: 阶段E 入口 stop/epoch 检查(避免停止后仍跑 deleteMany)
    if (rt.stopped || rt.epoch !== myEpoch) {
      await this.log(taskId, 'info', '阶段E: 任务已停止, 跳过尾部陈旧章清理').catch(() => {})
      return 'stopped'
    }
    const currentUrls = tocItems.map((it) => it.url).filter(Boolean)
    if (currentUrls.length > 0) {
      const staleTail = await db.chapter.deleteMany({
        where: { bookId, idx: { gt: tocItems.length }, url: { notIn: currentUrls } },
      })
      if (staleTail.count > 0) {
        await this.log(taskId, 'info', `阶段E: 清理 ${staleTail.count} 条目录外陈旧章(idx>${tocItems.length})`)
      }
    }

    progress.phase = 'content'
    progress.tocTotal = tocItems.length
    progress.contentDone = 0
    progress.contentTotal = queue.length
    progress.currentBook = bookName
    progress.phaseNote = `正文采集: ${bookName} (${queue.length}章待采)`
    await this.saveProgress(taskId, progress, stats)
    await this.log(taskId, 'info', `正文队列: ${queue.length}/${tocItems.length} 章需要采集 (${isFull ? '完全覆盖' : '增量更新'})`)

    // ---------- 多线程批次采集 ----------
    let done = 0
    // tt-c: 任务级连续错误熔断 —— 连续真实章节失败(源站超时/抓取异常, 不含无链接/HostGate限流/停止中止)
    // 达阈值即中止本书后续请求: 防止站点改版/被反爬拦截时引擎无休止硬敲(烧站点+烧出口IP),
    // 同时把任务推向 error 终态(autoRefresh 任务会按计划自动重试, 站点恢复后自愈)
    let consecutiveErrs = 0
    while (queue.length > 0) {
      if (rt.stopped || rt.epoch !== myEpoch) break
      while (rt.paused && !rt.stopped && rt.epoch === myEpoch) await sleep(600)
      if (rt.stopped || rt.epoch !== myEpoch) break

      // 在线调参即时生效: 每批次实时读任务行(原来用书首快照, 大部头中途调线程/间隔要等下一本书才生效)
      let threads = nextThreads()
      let interval = nextInterval()
      // Bug 19: DB 读取独立 try/catch —— 修前 findUnique 抛错时被外层 catch 吞, 顺带走到
      // queue.splice 处理一个批次(无法确认任务非暂停即推进采集, 与"暂停不处理批次"语义冲突)。
      // 现读取失败时安全默认 rt.paused=true(不确认非暂停就不处理), continue 跳过本次迭代;
      // 下次迭代重读成功则清除暂停标志恢复采集(60s 循环周期内自愈)
      let live
      try {
        live = await db.task.findUnique({
          where: { id: taskId },
          select: { threadMin: true, threadMax: true, intervalMin: true, intervalMax: true, status: true },
        })
      } catch {
        // DB 读取失败: 安全默认暂停, 跳过本批次(不确认非暂停就不推进采集)
        if (!rt.paused) {
          rt.paused = true
          await this.log(taskId, 'warn', '任务状态读取失败(DB 故障), 批次循环临时挂起(稍后自动重试)').catch(() => {})
        }
        continue
      }
      if (live) {
        // DB 状态守卫: 外部把任务改 paused/stopped(recoverOnBoot/管理操作)时, 内存循环同步停下,
        // 防止"内存运行中/DB已暂停"的僵尸状态各自为政
        if (live.status === 'stopped') { rt.stopped = true; rt.paused = false; break }
        if (live.status === 'paused') {
          if (!rt.paused) {
            rt.paused = true
            await this.log(taskId, 'warn', '检测到任务状态为暂停, 批次循环挂起(点击继续可恢复)')
          }
          continue
        }
        // Bug 19: DB 读取成功且非暂停/停止 —— 清除可能的 DB 故障临时挂起标志, 恢复采集
        // (修前不滑除, 一次 DB 故障永久挂起任务直到手动 resume)
        if (rt.paused) rt.paused = false
        threads = randInt(clampMin(live.threadMin, live.threadMax), live.threadMax)
        interval = randInt(clampMin(live.intervalMin, live.intervalMax), live.intervalMax)
      }
      const batch = queue.splice(0, threads)
      progress.lastThread = threads
      progress.lastInterval = interval
      // agent-B-runner(内存快照): 当前书剩余待采章节数(含本批)
      progress.memChaptersInQueue = queue.length + batch.length
      await this.log(taskId, 'info', `⚙ 线程批次: ${threads} 线程 × ${batch.length} 章`)

      await Promise.all(
        batch.map(async (q) => {
          try {
            // 无URL章节(纯标题项/javascript:链接被 absolutize 置空): 无法抓取,
            // 保持未采集状态即可 —— 原实现照样 fetchPage('') 每批报 "Obscura: 无效 URL" 噪音错误
            if (!q.url) {
              stats.errors++
              await this.log(taskId, 'warn', `章节无有效链接, 跳过: ${q.title.slice(0, 60)}`)
              done++
              progress.contentDone = done
              return
            }
            // ff-b② 接线补全(gg-d): 章节请求同样携带 refererUrl=bookUrl —— 原先用
            // buildFetch(rule, fetchOverride) 原面, refererChain:true 时章节(数量最大的
            // 请求面)Referer 回退站点 origin, "目录/章节请求全链路"存档口径只有目录生效
            // (修前实证 verify-gg-d-referer-chain A3b); fetchCfg 未启用链时 === 原面(零回归)
            // zz-b: 当批随机间隔既作批次间 sleepGap 又作同 host 准入最小间隔 —— 同批多章
            // 请求同一 host 时按 minGapMs 排队节奏出门(在线调参改 intervalMin/Max 立即生效:
            // 本批 interval 变量已被上方 live 读取覆盖), 不再背靠背轰出去
            //
            // feat-round-8: B1 — 请求抖动随机化(per-chapter ±20% 抖动 + 可选 jitterMs)
            // 每章独立计算 minGapMs: base * (0.8 + random*0.4) ∈ [80%, 120%] base;
            // 若 cfg.fetch.jitterMs > 0, 额外叠加 0~jitterMs 随机抖动。同批多章并行时
            // 每章节奏独立不规则, 击败简单 rate-pattern 检测(固定 interval 配置下也变化)。
            // 该抖动 IN ADDITION TO hostGate 的 minGapMs 闸门(hostGate 实际执行 jitteredMinGap)
            const jitteredMinGap = jitteredInterval(interval, fetchCfg.jitterMs)
            const pageRes = await this.gateFetch(taskId, q.url, fetchCfg, { minGapMs: jitteredMinGap })
            // 疑似被拦不入库: 保持 fetched=false, 下次增量自动重试; 合法JSON体是API数据非挑战页, 放行
            if (pageRes.blocked && parseJsonBody(pageRes.html) === undefined) throw new Error('章节页疑似被拦截(验证码/JS挑战)')
            const parsedC = await parseContent(q.url, pageRes.html, rule.content, contentFetchCfg)
            const cleaned = cleanContentHtml(parsedC.content, rule.clean)
            const plainLen = cleaned.replace(/<[^>]+>/g, '').length
            const chId0 = q.chId || idMap.get(q.url)
            let rel: string | null = null
            // oo-①修复(qq-c收编): 内容保存路径的 chapter.update 此前无 catch —— 章节行在
            // 任务运行中被并发删除(删书/清空章节/另一任务重采同书)时 Prisma 抛 P2025
            // "Invalid prisma.chapter.update() invocation: An operation failed because it
            // depends on one or more records..." 且整章记 error。重排段四处早已 .catch()
            // 防护, 唯独此处漏网。现改为: update 失败(P2025 行已删等)不抛, 落到下方 create
            // 兜底重建该章(内容不丢失); create 自身失败仍走外层 catch 计 error(真 DB 故障不吞)
            let chId: string | null | undefined = chId0
            if (taskCfg.storageMode === 'txt') {
              rel = await saveChapterTxt(bookId, q.idx, q.title, cleaned.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n'))
              if (chId) {
                const updated = await db.chapter.update({
                  where: { id: chId },
                  data: { content: null, filePath: rel, storage: 'txt', wordCount: plainLen, fetched: true },
                }).then(() => true).catch(() => false)
                if (!updated) chId = null
              }
            } else {
              if (chId) {
                const updated = await db.chapter.update({
                  where: { id: chId },
                  data: { content: cleaned, storage: 'db', wordCount: plainLen, fetched: true },
                }).then(() => true).catch(() => false)
                if (!updated) chId = null
              }
            }
            if (!chId) {
              // 兜底: 直接建(filePath 用已写盘的 rel, 原占位 '待补' 会让公开API读不到文件)
              // zz-d: 去掉 .catch(()=>{}) 吞错 —— create 失败(P2025 书被删/真 DB 故障)必须落
              // 外层计 error + 连败熔断推进, 修前虚记成功致该章内容静默丢失(与 oo-① 注释
              // "create 自身失败仍走外层 catch 计 error" 的声明对齐)
              await db.chapter.create({
                data: {
                  bookId, idx: q.idx, title: q.title, url: q.url, volume: q.volume,
                  content: taskCfg.storageMode === 'txt' ? null : cleaned,
                  filePath: rel,
                  storage: taskCfg.storageMode,
                  wordCount: plainLen, fetched: true,
                },
              })
            }
            stats.chaptersUpdated++
            consecutiveErrs = 0
            done++
            progress.contentDone = done
            if (done % 10 === 0 || done === progress.contentTotal) {
              await this.saveProgress(taskId, progress, stats)
            }
          } catch (e: any) {
            if (e?.isFetchTimeout) {
              // ee-d: 源站超时不再被 x-a 停止豁免分支静默吞掉(修前: 零日志/不计 errors/
              // 慢站对 hostGate 不可见) —— 计失败+可见日志(与列表页/浏览器链 TimeoutError 口径一致),
              // 章节保持 fetched=false, 增量重试照常优先; hostGate 连败已由 gateFetch 统一喂
              stats.errors++
              consecutiveErrs++
              await this.log(taskId, 'error', `章节失败(源站超时) ${q.title.slice(0, 60)}: ${q.url.slice(0, 120)}`)
            } else if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') {
              // 修复(x-a): 停止/换代造成的中止不计章节失败(防停止时批量刷错误+errors虚高)
              // 章节保持 fetched=false, 下次增量照常优先重采
            } else if (e?.name === 'HostGateTimeout') {
              // bb-d: 同站并发闸门槽满等待超时 — hostGate 限流保护(引擎侧)而非源站故障,
              // 不计 errors/不计源站连续失败; 章节保持 fetched=false, 稍后增量重试可恢复
              await this.log(taskId, 'warn', `章节 ${q.title.slice(0, 60)} 同站并发闸门等待超时(host:${hostGateKeyOf(q.url) || '未知'}, 该站并发已达上限), 章节保持未采集; 稍后增量重试可恢复`)
            } else {
              stats.errors++
              consecutiveErrs++
              await this.log(taskId, 'error', `章节失败 ${q.title}: ${e?.message?.slice(0, 100)}`)
            }
          }
        })
      )
      // tt-c: 连续错误熔断检查(每批次末) —— 达阈值即刻中止, 不再继续敲站点
      if (consecutiveErrs >= CIRCUIT_ERROR_LIMIT) {
        // E4: 记录熔断触发时间戳, control('start') 入口检查 60s 冷却窗口期内拒绝重启
        rt.circuitTrippedAt = Date.now()
        await this.log(taskId, 'error', `🔴 熔断中止: 连续 ${consecutiveErrs} 章采集失败(上游站点异常/被反爬拦截), 停止继续请求以保护站点与出口 IP; autoRefresh 任务将按计划自动重试; 60s 冷却期内手动重启将被拒绝`)
        await this.saveProgress(taskId, progress, stats)
        const cbErr = new Error(`连续 ${consecutiveErrs} 章采集失败, 触发连续错误熔断(阈值 ${CIRCUIT_ERROR_LIMIT})`)
        ;(cbErr as any).isCircuitBreak = true
        throw cbErr
      }
      // feat-round-8: B1 — 批次间 sleepGap 同款 ±20% 抖动(与 per-chapter 抖动同口径),
      // 防止"批次间固定间隔 + 章节间固定间隔"双固定模式被识别。fetchCfg.jitterMs 额外叠加。
      await sleepGap(jitteredInterval(interval, fetchCfg.jitterMs), rt, myEpoch)
    }
    // 收尾保存: 原先仅靠 done===contentTotal 触发, contentTotal 因队列追加/失败章偏低时进度会停在旧值
    // jj-d: epoch 漂移(被新一轮 start 取代)时跳过 —— 进度权归新循环, 旧循环的过期对象不得回滚其刚写进度
    if (rt.epoch === myEpoch) await this.saveProgress(taskId, progress, stats)

    // 更新书籍统计(停止/漂移同样执行: wordCount/latestChapter 反映已采实况, 对恢复采集有益)
    const agg = await db.chapter.aggregate({ where: { bookId, fetched: true }, _sum: { wordCount: true }, _count: true })
    // Bug 24: .catch 收口 —— 修前 .catch(()=>{}) 无差别吞错, 真 DB 故障(P2025 以外)
    // 静默丢统计(wordCount/latestChapter 静默不更新, 前台显示与实际不符)。现仅放行 P2025
    // (书被删), 其余打 warn 日志便于运维感知
    await db.book.update({
      where: { id: bookId },
      data: {
        wordCount: agg._sum.wordCount || 0,
        latestChapter: tocItems[tocItems.length - 1]?.title?.slice(0, 100) || '',
      },
    }).catch((e: any) => {
      if (e?.code !== 'P2025') console.warn('[runner] book stats update failed:', e?.message || e)
    })

    // jj-d: 停止/漂移后短路 —— "完成"日志/下拉词网络抓取/booksDone 计数属"本轮推进"语义:
    // 修前停止一册未采完的书仍会(1)误记"《书》完成"(2)发下拉词引擎网络请求(最长8s, 拖住
    // 停止收尾)(3)booksDone 虚增(书未采完)(4)旧进度回写; 漂移时同理且全部归新循环所有
    if (rt.stopped || rt.epoch !== myEpoch) return 'stopped'
    await this.log(taskId, 'success', `《${bookName}》完成: ${done}章正文已采集 (共${tocItems.length}章)`)

    // ---------- 6. 搜索引擎下拉关键词 ----------
    // ab-b 注(设计如此): 下拉词走外部搜索引擎(suggest.ts 直连), 不经 gateFetch、不传 minGapMs
    if (taskCfg.autoSuggest && bookName) {
      try {
        const sug = await fetchSuggestKeywords(bookName)
        const words = mergeSuggestWords(bookName, sug, 25)
        let added = 0
        for (const w of words) {
          // R4-10: bookTag.upsert 在并行任务对同书同 tag 操作时 @@unique([bookId, tag]) 冲突 P2002;
          //  旧 .then(added++).catch(()=>{}) 静默吞掉 P2002 → tag 漏写、added 虚低。改为:
          //  P2002 时 re-findByBookIdTag 拿到既有行, 计入 added(不丢统计口径)
          try {
            await db.bookTag.upsert({
              where: { bookId_tag: { bookId, tag: w } },
              create: { bookId, tag: w, source: 'suggest' },
              update: {},
            })
            added++
          } catch (e: any) {
            if (e?.code === 'P2002') {
              // 已由并行任务创建, 视作成功(本任务去重链无需重复入库)
              added++
            } else {
              // 其余错误(真 DB 故障) 静默跳过, 与旧行为兼容(不强断下拉词链)
            }
          }
        }
        stats.suggestWords += added
        const okEngines = sug.filter((s) => s.ok).map((s) => s.engine).join(',')
        await this.log(taskId, 'success', `下拉关键词: ${added}个 (${okEngines || '引擎均不可达, 稍后可手动刷新'})`)
      } catch (e: any) {
        await this.log(taskId, 'warn', `下拉关键词失败: ${e?.message?.slice(0, 80)}`)
      }
    }

    progress.booksDone++
    // feat-combo-theme-incremental: 状态分流 ——
    //  - detectedStatus==='completed' → 加入 rt.completedBookUrls(下次重启整体跳过)
    //  - detectedStatus==='ongoing'/'unknown' → 加入 rt.ongoingBookUrls + 记录末章 URL
    //    (下次重启走增量检查: 抓目录→对比末章→无新章跳过/有新章增量采)
    //  - 同时清理可能的"连载→完结"状态跃迁记忆(原在 ongoingBookUrls 中的书若终判完结,
    //    从 ongoingBookUrls + bookLastChapters 中移除, 改入 completedBookUrls)
    // agent-B-runner: 用 addToResumeSet/addToBookLastChapters 即时检查内存上限(防 OOM);
    //  成功采集 → 从 failedBookUrls 移除(若曾在上一轮失败)
    if (detectedStatus === 'completed') {
      addToResumeSet(rt.completedBookUrls, bookUrl)
      rt.ongoingBookUrls.delete(bookUrl)
      rt.bookLastChapters.delete(bookUrl)
    } else {
      // ongoing 或 unknown: 按 ongoing 处理(unknown 仍可能后续新增章节, 谨慎跟踪)
      addToResumeSet(rt.ongoingBookUrls, bookUrl)
      const lastChapUrl = tocItems[tocItems.length - 1]?.url
      if (lastChapUrl) addToBookLastChapters(rt.bookLastChapters, bookUrl, lastChapUrl)
    }
    rt.failedBookUrls.delete(bookUrl)
    await this.saveProgress(taskId, progress, stats)
    return 'ok'
  }

  private async saveProgress(taskId: string, progress: TaskProgress, stats: TaskStats) {
    // P2025 噪音修复(dd-b, bb-g 存档竞态): 任务被删除后 stop 收尾的 saveProgress 对已删行
    // update 抛 P2025 —— prisma log:['error'] 层在查询失败【瞬间】即打出 "prisma:error …P2025"
    // (P7 实测经 console.log 落 stdout→dev.log, verify 探针实证), catch 只能吞异常追不回日志。
    // 故采用先查存在性: 任务已删=进度无处可写, 属预期终态, 静默跳过(零 prisma error 输出);
    // 查得存在后才 update —— 正常路径仅多一次主键探测(SQLite 本地, 可忽略), 落库行为不变。
    // 查后删除的微秒级竞态窗口仍由 catch 兜底: P2025 静默(此时日志已打出, 有界罕见),
    // 其余异常降为自有 warn(不经 prisma error 层); 整体保持"saveProgress 永不抛"契约
    //
    // feat-contentproxy-resume: 同步把 rt.discoveredBookUrls / rt.completedBookUrls 落库 ——
    // 范围任务重启时由这两数组重建 Set 实现续采。cap 50000 条防 DB 膨胀(50000×~60B URL≈3MB);
    // 同 URL 在 Set 中只 1 次, 数组天然去重。task 进度字段为 JSON 字符串, 数组形态天然可序列化
    //
    // agent-B-runner: 内存 Sets 已由 addToResumeSet 即时检查上限(FIFO 淘汰最旧 10%), 此处
    //  Array.from(slice) 仅作持久化序列化(理论上 Set.size 已 ≤50000, slice 为冗余兜底)。
    //  另同步落库任务快照字段(requestCount/bytesFetched/runStartedAt/currentUrl/recentLogs/
    //  memBooksInQueue/memChaptersInQueue/memResumeSetsSize/failedBookUrls), 供 API 端点读取
    const rt = this.runtimes.get(taskId)
    if (rt) {
      progress.discoveredBookUrls = Array.from(rt.discoveredBookUrls).slice(0, MAX_RESUME_SET_SIZE)
      progress.completedBookUrls = Array.from(rt.completedBookUrls).slice(0, MAX_RESUME_SET_SIZE)
      // feat-combo-theme-incremental: 连载增量字段同步落库(ongoingBookUrls + bookLastChapters)
      progress.ongoingBookUrls = Array.from(rt.ongoingBookUrls).slice(0, MAX_RESUME_SET_SIZE)
      // agent-B-runner: failedBookUrls 同步落库(供"仅重试失败"模式与可见性)
      progress.failedBookUrls = Array.from(rt.failedBookUrls).slice(0, MAX_RESUME_SET_SIZE)
      // bookLastChapters Map → Object(JSON 序列化友好); Map 已由 addToBookLastChapters 即时
      // 淘汰最旧 10%, 此处迭代取全部(≤50000), 即最新添加的连载书末章 URL(非最早)
      const lastChapObj: Record<string, string> = {}
      let n = 0
      for (const [k, v] of rt.bookLastChapters) {
        if (n >= MAX_BOOK_LAST_CHAPTERS) break
        lastChapObj[k] = v
        n++
      }
      progress.bookLastChapters = lastChapObj
      // agent-B-runner(任务快照+内存预算): 同步运行时计数器到 progress(供 API 端点读取)
      progress.requestCount = rt.requestCount
      progress.bytesFetched = rt.bytesFetched
      progress.runStartedAt = rt.runStartedAt || undefined
      progress.currentUrl = rt.currentUrl || undefined
      progress.recentLogs = rt.recentLogs.slice(-MAX_RECENT_LOGS)
      // 内存快照: bookQueue 与章节队列长度不在 rt 中(局部变量), 此处由 progress 既有字段推算;
      // memResumeSetsSize = 5 个 resume 集合总大小, UI 据此判断内存压力
      progress.memResumeSetsSize =
        rt.discoveredBookUrls.size + rt.completedBookUrls.size +
        rt.ongoingBookUrls.size + rt.failedBookUrls.size + rt.bookLastChapters.size
    }
    try {
      const exists = await db.task.findUnique({ where: { id: taskId }, select: { id: true } })
      if (!exists) return
      await db.task.update({
        where: { id: taskId },
        data: { progress: JSON.stringify(progress), stats: JSON.stringify(stats) },
      })
    } catch (e: any) {
      if (e?.code === 'P2025') return
      console.warn(`[runner] saveProgress 落库失败(task:${taskId}): ${String(e?.message || e).slice(0, 140)}`)
    }
  }
}

// ---------- 工具 ----------
function randInt(min: number, max: number): number {
  min = Math.max(1, min || 1)
  max = Math.max(min, max || min)
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function clampMin(a: number, b: number): number {
  return Math.min(a || 1, b || 1)
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
/** jj-d: 可中断批次间隔睡眠 — 停止/暂停/换代不再睡满 interval(修前 stop/pause 要等
 *  intervalMax 全额到点才在下一检查点生效, 长间隔配置下响应时延线性于 interval)。
 *  happy path(无控制信号)仍睡满原时长, 采集节奏零变化; 每 600ms 切片探测一次,
 *  与暂停等待循环同粒度; 暂停提前返回后由循环头部的暂停等待接管 */
async function sleepGap(ms: number, rt: TaskRuntime, myEpoch: number): Promise<void> {
  const deadline = Date.now() + Math.max(0, ms)
  while (Date.now() < deadline) {
    if (rt.stopped || rt.paused || rt.epoch !== myEpoch) return
    await sleep(Math.min(600, deadline - Date.now()))
  }
}

/**
 * feat-round-8: B1 — 抖动间隔计算
 *  - 基础抖动: base * (0.8 + random*0.4) ∈ [80%, 120%] base (per-request ±20%)
 *  - 额外抖动: jitterMs > 0 时叠加 random * jitterMs (0~jitterMs)
 * 两者叠加后作为 hostGate 的 minGapMs(闸门实际执行等待), 让请求节奏不规则,
 * 击败简单 rate-pattern 检测。即使任务配置固定 interval(intervalMin==intervalMax),
 * 实际出门间隔仍会变化。jitterMs 缺省 undefined 时仅 ±20% 抖动(零回归, 老 task 行为微变)。
 */
function jitteredInterval(base: number, jitterMs?: number): number {
  const pct80to120 = base * (0.8 + Math.random() * 0.4)
  const extra = typeof jitterMs === 'number' && jitterMs > 0 ? Math.random() * jitterMs : 0
  return Math.max(0, Math.round(pct80to120 + extra))
}
function safeJson<T>(s: string | null | undefined): Partial<T> {
  try { return s ? JSON.parse(s) : {} } catch { return {} }
}

function parseFetchOverride(raw: string | null | undefined): Partial<FetchConfig> {
  try {
    // 深消毒: task.fetchConfig 是管理员可编辑的 JSON 字符串, 脏值(字符串 "3" 作 retries
    // 参与 "3"+1="31" 次拼接/超大 timeout/未知键)经白名单重建后不再进入 fetcher
    return raw ? sanitizeFetchConfig(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function buildFetch(rule: RuleConfig, override: Partial<FetchConfig>): Partial<FetchConfig> {
  return { ...rule.fetch, ...override }
}

/** Bug 5: 章节重排四阶段(阶段A/B/D + 分卷回填)的 .catch 收口 —— 修前 `.catch(() => {})`
 *  无差别吞掉所有 Prisma 异常, 真 DB 故障(连接断/磁盘满/约束违反非冲突类)被静默,
 *  重排中途连锁失败: 阶段A挪负位失败 → 阶段C建行撞 @@unique → 阶段D回填撞 @@unique,
 *  全部被吞, 书籍章节序号永久错乱且无任何日志/告警。
 *  仅放行预期错误:
 *    - P2025: 记录已不存在(任务/书籍/章节被并发删除)——重排的幂等语义, 正常
 *    - P2002: 唯一约束冲突(@@unique([bookId,idx]))——重排中转瞬态撞位, 正常
 *  其余(连接断/P2003 外键/P2014 无效关系/磁盘故障等)上抛, 中止本书重排走书籍级 error */
function swallowExpectedDb(e: any): void {
  if (e?.code === 'P2025' || e?.code === 'P2002') return // 预期: 记录已删/瞬态唯一冲突
  throw e // 真 DB 故障: 上抛中止本次重排(走 crawlOneBook catch → 书籍级 error)
}

// ---------- agent-B-runner: 工具函数 ----------

/** agent-B-runner: 安全转 number —— 脏 JSON(字符串/NaN/负数)统一兜底为 0。
 *  修前 `{...emptyProgress(), ...safeJson(cfg.task.progress)}` 直接展开脏值,
 *  `progress.discovered="abc"` 会使 `progress.discovered++` 变成 "abc1" 字符串拼接,
 *  后续进度条/统计全乱 */
function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** agent-B-runner: 安全加载 progress JSON —— 修前 `{...emptyProgress(), ...safeJson(...)}`
 *  直接展开脏值, 各字段类型不受控。本函数对每个字段强制类型转换: 数字 NaN→0,
 *  数组非数组→undefined, 对象非对象→undefined。后续 `progress.discovered++` 等运算安全 */
function coerceProgress(raw: string | null | undefined): TaskProgress {
  const p = safeJson<TaskProgress>(raw)
  const phases: TaskProgress['phase'][] = ['idle', 'discovery', 'book', 'toc', 'content', 'done']
  const phase = phases.includes(p.phase as TaskProgress['phase']) ? (p.phase as TaskProgress['phase']) : 'idle'
  const strField = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' && v ? v.slice(0, max) : undefined
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((u) => typeof u === 'string' && u).slice(0, MAX_RESUME_SET_SIZE) : undefined
  const objField = (v: unknown): Record<string, string> | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k === 'string' && k && typeof val === 'string' && val) out[k] = val
      if (Object.keys(out).length >= MAX_RESUME_SET_SIZE) break
    }
    return out
  }
  const recentLogs = Array.isArray(p.recentLogs)
    ? p.recentLogs
        .filter((l) => l && typeof l === 'object' && typeof (l as { message?: unknown }).message === 'string')
        .slice(-MAX_RECENT_LOGS)
    : undefined
  return {
    phase,
    phaseNote: strField(p.phaseNote, 200),
    discovered: toNum(p.discovered),
    booksDone: toNum(p.booksDone),
    booksTotal: toNum(p.booksTotal),
    tocTotal: toNum(p.tocTotal),
    contentDone: toNum(p.contentDone),
    contentTotal: toNum(p.contentTotal),
    currentBook: strField(p.currentBook, 500),
    lastThread: toNum(p.lastThread) || undefined,
    lastInterval: toNum(p.lastInterval) || undefined,
    engineStats: p.engineStats && typeof p.engineStats === 'object' && !Array.isArray(p.engineStats)
      ? p.engineStats as Record<string, number>
      : undefined,
    discoveredBookUrls: strArr(p.discoveredBookUrls),
    completedBookUrls: strArr(p.completedBookUrls),
    ongoingBookUrls: strArr(p.ongoingBookUrls),
    bookLastChapters: objField(p.bookLastChapters),
    failedBookUrls: strArr(p.failedBookUrls),
    requestCount: toNum(p.requestCount) || undefined,
    bytesFetched: toNum(p.bytesFetched) || undefined,
    runStartedAt: toNum(p.runStartedAt) || undefined,
    currentUrl: strField(p.currentUrl, 500),
    memBooksInQueue: toNum(p.memBooksInQueue) || undefined,
    memChaptersInQueue: toNum(p.memChaptersInQueue) || undefined,
    memResumeSetsSize: toNum(p.memResumeSetsSize) || undefined,
    recentLogs: recentLogs as TaskProgress['recentLogs'],
  }
}

function coerceStats(raw: string | null | undefined): TaskStats {
  const s = safeJson<TaskStats>(raw)
  return {
    booksCreated: toNum(s.booksCreated),
    booksUpdated: toNum(s.booksUpdated),
    chaptersCreated: toNum(s.chaptersCreated),
    chaptersUpdated: toNum(s.chaptersUpdated),
    coversSaved: toNum(s.coversSaved),
    errors: toNum(s.errors),
    suggestWords: toNum(s.suggestWords),
  }
}

/** agent-B-runner: 向 resume Set 添加元素, 超过 cap 时按 FIFO 淘汰最旧 10% (Set 保留插入序)。
 *  修前 discoveredBookUrls/completedBookUrls 等仅在 saveProgress 落库时 slice, 内存 Set
 *  在长任务中可涨至数百万 → OOM。现在每次 add 即时检查, 内存上限与持久化上限对齐 */
function addToResumeSet(set: Set<string>, value: string, cap = MAX_RESUME_SET_SIZE): void {
  if (!value || set.has(value)) return
  set.add(value)
  if (set.size > cap) {
    // 淘汰最旧 10% (Set 迭代序=插入序, FIFO)
    const evictCount = Math.max(1, Math.floor(cap * 0.1))
    let i = 0
    for (const k of set) {
      set.delete(k)
      if (++i >= evictCount) break
    }
  }
}

/** agent-B-runner: 向 bookLastChapters Map 添加 (key→value), 超过 cap 时淘汰最旧 10%。
 *  修前 saveProgress 仅 slice 前 50000 条(最早添加的), 最新添加的连载书末章 URL 被丢 →
 *  重启时增量检查失效。现在在 add 时即时淘汰, 保留最新连载书 */
function addToBookLastChapters(map: Map<string, string>, key: string, value: string, cap = MAX_BOOK_LAST_CHAPTERS): void {
  if (!key || !value) return
  map.set(key, value)
  if (map.size > cap) {
    const evictCount = Math.max(1, Math.floor(cap * 0.1))
    let i = 0
    for (const k of map.keys()) {
      map.delete(k)
      if (++i >= evictCount) break
    }
  }
}

/** agent-B-runner: 推入 recentLogs ring buffer (保留最近 N 条) */
function pushRecentLog(
  buf: { level: string; message: string; ts: number }[],
  level: string,
  message: string,
): void {
  buf.push({ level, message: message.slice(0, 200), ts: Date.now() })
  if (buf.length > MAX_RECENT_LOGS) buf.splice(0, buf.length - MAX_RECENT_LOGS)
}

