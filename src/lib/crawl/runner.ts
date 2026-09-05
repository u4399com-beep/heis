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
  abortControllers?: Set<AbortController>
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

function emptyProgress(): TaskProgress {
  return { phase: 'idle', discovered: 0, booksDone: 0, booksTotal: 0, tocTotal: 0, contentDone: 0, contentTotal: 0 }
}
function emptyStats(): TaskStats {
  return { booksCreated: 0, booksUpdated: 0, chaptersCreated: 0, chaptersUpdated: 0, coversSaved: 0, errors: 0, suggestWords: 0 }
}

/** tt-c: 任务级连续错误熔断阈值 —— 连续 N 个真实章节失败(超时/抓取异常)即中止本书并上抛,
 *  任务转 error 终态(autoRefresh 自动重试自愈)。20 的量级: 正常抖动(单章偶败)远够不着,
 *  站点改版/被全量拦截时 2~3 个批次内即熔断, 不再硬敲 */
const CIRCUIT_ERROR_LIMIT = 20

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

  static get instance(): TaskRunner {
    if (!globalForRunner.__novelTaskRunner) {
      globalForRunner.__novelTaskRunner = new TaskRunner()
    }
    return globalForRunner.__novelTaskRunner
  }

  /** autoRefresh 开启且任务处于终态时, delayMin 分钟后自动重新采集(jj-e 实时更新) */
  scheduleAutoRefresh(taskId: string, delayMin: number, taskName = '') {
    this.cancelAutoRefresh(taskId)
    const ms = Math.max(0, Math.round(delayMin * 60_000))
    const timer = setTimeout(async () => {
      this.refreshTimers.delete(taskId)
      // 触发时复核: 任务仍存在/autoRefresh 仍开/未在运行/仍处终态(期间被 stop/pause 则放弃)
      try {
        const t = await db.task.findUnique({ where: { id: taskId } })
        if (!t || !t.autoRefresh || this.isRunning(taskId) || !['done', 'error', 'stopped'].includes(t.status)) return
        await this.log(taskId, 'info', `⟳ 自动刷新触发, 重新开始采集「${t.name}」`)
        const res = await this.control(taskId, 'start')
        if (!res.ok) await this.log(taskId, 'warn', `⟳ 自动刷新启动失败: ${res.message}`)
      } catch { /* 任务已删除等 */ }
    }, ms)
    // bun/node 的 timeout 在进程内不阻止退出(无 unref 场景需求), 但避免持旧引用: Map 记录便于清除
    this.refreshTimers.set(taskId, timer)
    if (taskName) {
      const label = delayMin >= 1 ? `${Math.round(delayMin)} 分钟` : `${Math.round(ms / 1000)} 秒`
      this.log(taskId, 'info', `⟳ 已排定自动刷新: ${label}后重新采集「${taskName}」`).catch(() => {})
    }
  }

  /** 清除自动刷新定时器(stop/delete/手动关闭时) */
  cancelAutoRefresh(taskId: string) {
    const timer = this.refreshTimers.get(taskId)
    if (timer) {
      clearTimeout(timer)
      this.refreshTimers.delete(taskId)
    }
  }

  isRunning(taskId: string): boolean {
    return this.runtimes.get(taskId)?.running || false
  }

  /** 恢复启动时标记: 之前running的任务标记为paused
   *  修复: 原实现被 stats 接口懒触发, 会把【本进程内刚合法启动】的任务也误判为重启孤儿强制暂停;
   *  现在每进程生命周期只执行一次, 且只回收 updatedAt 早于单例创建时刻的孤儿任务 */
  async recoverOnBoot() {
    try {
      const g = globalForRunner as unknown as { __novelRecoveredAt?: number }
      if (g.__novelRecoveredAt) return // 本进程已执行过(防 HMR 重触发误伤)
      g.__novelRecoveredAt = Date.now()
      const stale = await db.task.findMany({
        where: { status: 'running', updatedAt: { lt: new Date(this.createdAt - 10_000) } },
      })
      for (const t of stale) {
        await db.task.update({ where: { id: t.id }, data: { status: 'paused' } })
        await this.log(t.id, 'warn', '服务重启, 任务自动转入暂停状态, 可点击继续恢复采集')
      }
      // jj-e: 重启后恢复 autoRefresh 任务的定时刷新(进程内 timer 随进程消失; 终态任务重新排定)
      const autoTasks = await db.task.findMany({
        where: { autoRefresh: true, status: { in: ['done', 'error', 'stopped'] } },
        select: { id: true, name: true, refreshIntervalMin: true },
      })
      for (const t of autoTasks) {
        this.scheduleAutoRefresh(t.id, t.refreshIntervalMin)
        await this.log(t.id, 'info', `⟳ 服务已重启, 自动刷新已恢复排定(${t.refreshIntervalMin} 分钟后重新采集)`).catch(() => {})
      }
    } catch { /* 表不存在等 */ }
  }

  async log(taskId: string, level: 'info' | 'success' | 'warn' | 'error', message: string) {
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
    const prev = this.controlChains.get(taskId) ?? Promise.resolve()
    const run = prev.then(() => this.controlInner(taskId, action))
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
    const rt = this.runtimes.get(taskId) || { paused: false, stopped: false, running: false, epoch: 0 }

    switch (action) {
      case 'start': {
        if (rt.running) {
          if (rt.paused) {
            rt.paused = false
            await db.task.update({ where: { id: taskId }, data: { status: 'running' } })
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
        this.runtimes.set(taskId, rt)
        await db.task.update({ where: { id: taskId }, data: { status: 'running' } })
        await this.log(taskId, 'success', `▶ 任务启动 [${task.name}] 模式:${task.mode === 'single' ? '单本' : '范围'} 重采:${task.recrawlMode === 'full' ? '完全覆盖' : '增量更新'} 存储:${task.storageMode === 'db' ? '数据库' : 'TXT文件'} 线程:${task.threadMin}~${task.threadMax} 间隔:${task.intervalMin}~${task.intervalMax}ms`)
        // 异步执行, 不阻塞API
        this.executeTask(taskId).catch(async (e) => {
          await this.log(taskId, 'error', `任务异常终止: ${e?.message || e}`)
          await db.task.update({ where: { id: taskId }, data: { status: 'error' } }).catch(() => {})
        })
        return { ok: true, message: '已启动' }
      }
      case 'pause': {
        if (!rt.running) return { ok: false, message: '任务未在运行' }
        rt.paused = true
        await db.task.update({ where: { id: taskId }, data: { status: 'paused' } })
        await this.log(taskId, 'warn', '⏸ 任务已暂停')
        return { ok: true, message: '已暂停' }
      }
      case 'stop': {
        rt.stopped = true
        rt.paused = false
        rt.running = false
        this.runtimes.set(taskId, rt)
        // jj-e: 手动停止视为用户明确意图, 同时取消已排定的自动刷新
        this.cancelAutoRefresh(taskId)
        await db.task.update({ where: { id: taskId }, data: { status: 'stopped' } })
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
    try {
      await ensureDirs()
      cfg = await this.loadConfig(taskId)
      if (!cfg) return
      const progress: TaskProgress = { ...emptyProgress(), ...safeJson(cfg.task.progress) }
      const stats: TaskStats = { ...emptyStats(), ...safeJson(cfg.task.stats) }
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
      } else {
        progress.phase = 'discovery'
        progress.phaseNote = '正在解析列表页…'
        await this.saveProgress(taskId, progress, stats)
        const listRule = cfg.rule.list
        const urls: string[] = []
        for (let p = cfg.task.listStart; p <= cfg.task.listEnd; p++) {
          if (rt.stopped || isStale()) break
          while (rt.paused && !rt.stopped && !isStale()) await sleep(600)
          if (rt.stopped || isStale()) break
          // {page}=页号原值; {offset:N}=第p页的列表偏移量(p-1)*N(cc-c: 番茄聚合API
          // searchUrl 用 offset=(page-1)*10 分页, {page} 无法表达算术偏移)
          const url = (listRule.urlTemplate || '')
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
            urls.push(...pageUrls)
            for (const it of parsed.items) {
              const u = it.fields.url || it.fields.bookUrl
              if (!u || listFields.has(u)) continue
              if (it.fields.name || it.fields.author || it.fields.intro || it.fields.category) {
                listFields.set(u, { name: it.fields.name, author: it.fields.author, intro: it.fields.intro, category: it.fields.category })
              }
            }
            progress.discovered = urls.length
            await this.saveProgress(taskId, progress, stats)
            await this.log(taskId, 'success', `列表页 P${p} 发现 ${pageUrls.length} 本书籍 (累计${urls.length})`)
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

        // 每本书重新读配置(支持在线调整)
        cfg = await this.loadConfig(taskId)
        if (!cfg) break
        const rule = cfg.rule

        try {
          progress.currentBook = bookUrl
          progress.phaseNote = `采集书籍 (${bi + 1}/${bookQueue.length})`
          await this.saveProgress(taskId, progress, stats)

          const bookResult = await this.crawlOneBook(
            taskId, bookUrl, rule, cfg.fetchOverride, cfg.task, rt, myEpoch, progress, stats, cfg.threads, cfg.interval, listFields.get(bookUrl)
          )
          if (bookResult === 'paused-return') {
            // 暂停由外层循环处理
          } else if (bookResult === 'blocked' || bookResult === 'empty-toc') {
            // 跳过的书也计入已完成, 防 booksDone/booksTotal 进度条永远到不了头
            progress.booksDone++
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
          await db.task.update({ where: { id: taskId }, data: { status: 'done' } }).catch((e: any) => {
            // zz-d: 收尾途中任务被删除的 P2025 不再炸成"任务崩溃"(与 dd-b saveProgress
            // 同窗口同口径); 其余真 DB 故障继续上抛走崩溃路径落 error 终态
            if (e?.code !== 'P2025') throw e
          })
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
        await db.task.update({ where: { id: taskId }, data: { status: 'error' } }).catch(() => {})
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
    // mm-b: 浏览器类桥模式(stealthy/playwright)自动钳制 hostGateLimit 至桥内信号量 3 ——
    // 桥内排队不提速只白占槽位; static/native 原值透传(详见 fetcher.effectiveHostGateLimit)
    const ticket = await acquireHostGate(url, { limit: effectiveHostGateLimit(cfg), minGapMs: opts?.minGapMs })
    try {
      const res = await fetchPage(url, cfg)
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
    const bookName = cleanTextField(parsed.name, 120) || cleanTextField(listFields?.name, 120)
      || new URL(bookUrl).pathname.slice(1, 30) || '未知书名'
    const intro = cleanIntro(parsed.intro) || cleanIntro(listFields?.intro || '')
    const author = cleanTextField(parsed.author, 60) || cleanTextField(listFields?.author, 60) || '佚名'

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
      const cat = await db.category.upsert({
        where: { name: categoryName },
        create: { name: categoryName },
        update: {},
      })
      categoryId = cat.id
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
    const existing = await db.book.findFirst({ where: { OR: [{ sourceUrl: bookUrl }, { name: bookName, author }] } })
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
            } catch (firstErr) {
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

    // ---------- 5. 章节入库(增量/全量) + 正文多线程采集 ----------
    const isFull = taskCfg.recrawlMode === 'full'
    const existChapters = await db.chapter.findMany({
      where: { bookId },
      select: { id: true, url: true, title: true, fetched: true, idx: true, volume: true },
    })
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
    for (let mi = 0; mi < moves.length; mi++) {
      await db.chapter.update({ where: { id: moves[mi].id }, data: { idx: tempBase + mi } }).catch(() => {})
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
    for (const c of existChapters) {
      if (movedIds.has(c.id)) continue
      // tt-c 增强: 负 idx 残留章(历史重排中途被杀遗留)也是非法位(章序必须 ≥1), 一并治愈摎尾,
      // 防止永久卡在负数位(前台排序置顶/导出错位)
      if (newTargetIdx.has(c.idx) || c.idx < 0) {
        tailIdx += 1
        tailMoves.set(c.id, tailIdx)
        await db.chapter.update({ where: { id: c.id }, data: { idx: tailIdx } }).catch(() => {})
      }
    }
    // 阶段C: 新章按最终 idx 建行; 单章建行失败只计错误, 不再拖垮整本书
    const idMap = new Map<string, string>()
    for (const q of creates) {
      try {
        const created = await db.chapter.create({
          data: { bookId, idx: q.idx, title: q.title, url: q.url, volume: q.volume, storage: taskCfg.storageMode, fetched: false },
        })
        idMap.set(q.url, created.id)
        stats.chaptersCreated++
      } catch (e: any) {
        stats.errors++
        await this.log(taskId, 'error', `章节记录创建失败 ${q.title}: ${e?.message?.slice(0, 80)}`)
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
    for (const mv of moves) {
      await db.chapter.update({ where: { id: mv.id }, data: { idx: mv.to } }).catch(() => {})
    }
    // kk-a: 分卷名回填(只补空缺, 不覆盖已有值; 批量逐条, 失败不影响采集)
    for (const vb of volumeBackfill) {
      await db.chapter.update({ where: { id: vb.id }, data: { volume: vb.volume } }).catch(() => {})
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
      try {
        const live = await db.task.findUnique({
          where: { id: taskId },
          select: { threadMin: true, threadMax: true, intervalMin: true, intervalMax: true, status: true },
        })
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
          threads = randInt(clampMin(live.threadMin, live.threadMax), live.threadMax)
          interval = randInt(clampMin(live.intervalMin, live.intervalMax), live.intervalMax)
        }
      } catch { /* 读取失败沿用书首快照 */ }
      const batch = queue.splice(0, threads)
      progress.lastThread = threads
      progress.lastInterval = interval
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
            const pageRes = await this.gateFetch(taskId, q.url, fetchCfg, { minGapMs: interval })
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
        await this.log(taskId, 'error', `🔴 熔断中止: 连续 ${consecutiveErrs} 章采集失败(上游站点异常/被反爬拦截), 停止继续请求以保护站点与出口 IP; autoRefresh 任务将按计划自动重试`)
        await this.saveProgress(taskId, progress, stats)
        const cbErr = new Error(`连续 ${consecutiveErrs} 章采集失败, 触发连续错误熔断(阈值 ${CIRCUIT_ERROR_LIMIT})`)
        ;(cbErr as any).isCircuitBreak = true
        throw cbErr
      }
      await sleepGap(interval, rt, myEpoch)
    }
    // 收尾保存: 原先仅靠 done===contentTotal 触发, contentTotal 因队列追加/失败章偏低时进度会停在旧值
    // jj-d: epoch 漂移(被新一轮 start 取代)时跳过 —— 进度权归新循环, 旧循环的过期对象不得回滚其刚写进度
    if (rt.epoch === myEpoch) await this.saveProgress(taskId, progress, stats)

    // 更新书籍统计(停止/漂移同样执行: wordCount/latestChapter 反映已采实况, 对恢复采集有益)
    const agg = await db.chapter.aggregate({ where: { bookId, fetched: true }, _sum: { wordCount: true }, _count: true })
    await db.book.update({
      where: { id: bookId },
      data: {
        wordCount: agg._sum.wordCount || 0,
        latestChapter: tocItems[tocItems.length - 1]?.title?.slice(0, 100) || '',
      },
    }).catch(() => {})

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
          await db.bookTag.upsert({
            where: { bookId_tag: { bookId, tag: w } },
            create: { bookId, tag: w, source: 'suggest' },
            update: {},
          }).then(() => { added++ }).catch(() => {})
        }
        stats.suggestWords += added
        const okEngines = sug.filter((s) => s.ok).map((s) => s.engine).join(',')
        await this.log(taskId, 'success', `下拉关键词: ${added}个 (${okEngines || '引擎均不可达, 稍后可手动刷新'})`)
      } catch (e: any) {
        await this.log(taskId, 'warn', `下拉关键词失败: ${e?.message?.slice(0, 80)}`)
      }
    }

    progress.booksDone++
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

