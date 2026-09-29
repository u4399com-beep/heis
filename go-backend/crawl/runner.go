// runner.go — 任务调度 + Semaphore + 三阶段并发采集 (R38-1C).
//
// 核心架构:
//   - Semaphore (R31-1B): 并发上限控制 (acquire/release 配对 try/finally)
//   - BudgetExceeded: 单任务 HTTP 请求总预算上限, 超出终止任务
//   - TaskRuntime: 内存级任务运行时 (epoch / paused / stopped / 集合 / 统计)
//   - executeTask: 三阶段采集
//     阶段1: 并发 crawlBookMeta (书籍详情页 + 目录页, semaphore 限 N=concurrency)
//     阶段2: 全局并发 crawlChapterContent (章节正文页, channel 限 N)
//     阶段3: 串行 finalizeBook (单本书收尾统计 + 下拉词 + 状态分流)
//   - 错误隔离: 单本/单章失败不影响其他
//   - epoch 漂移: stop→start 换代时旧循环只吞异常, 进度权归新循环
//   - cookieJar 持久化 + bridgeUrl 透传
//   - failedBookUrls 三路径对称 (add/delete/resume)
//   - 段落保真: 章节正文 \n\n 分段
//
// Go 改造 (优于 TS):
//   - Semaphore 用 buffered channel 取代 promise 队列 (更高效, 无锁)
//   - goroutine + channel 取代 Promise.all (天然并发, 更省内存)
//   - context.Context 贯穿取消 (stop/pause/换代), 与 hostGate 同源
//   - sync.Map / sync.Mutex 取代 globalThis 单例
package crawl

import (
        "context"
        "database/sql"
        "errors"
        "fmt"
        "math/rand"
        "sort"
        "strings"
        "sync"
        "sync/atomic"
        "time"
        "unicode/utf8"

        "github.com/PuerkitoBio/goquery"
)

// ---------- BudgetExceeded ----------

// BudgetExceeded — 单任务 HTTP 请求总预算上限超出错误.
//
//      gateFetch 每次入口检查 requestCount > maxRequests 即抛此错终止任务.
type BudgetExceeded struct {
        TaskID string
        Count  int
        Max    int
}

func (e *BudgetExceeded) Error() string {
        return fmt.Sprintf("BudgetExceeded: task %s requestCount %d > maxRequests %d", e.TaskID, e.Count, e.Max)
}

// IsBudgetExceeded — 错误是否是 BudgetExceeded.
func IsBudgetExceeded(err error) bool {
        var be *BudgetExceeded
        return errors.As(err, &be)
}

// CircuitBreak — 连续错误熔断错误.
type CircuitBreak struct {
        Reason      string
        Consecutive int
        Limit       int
}

func (e *CircuitBreak) Error() string {
        return fmt.Sprintf("CircuitBreak: %s (连续 %d 章, 阈值 %d)", e.Reason, e.Consecutive, e.Limit)
}

// IsCircuitBreak — 错误是否是熔断.
func IsCircuitBreak(err error) bool {
        var cb *CircuitBreak
        return errors.As(err, &cb)
}

const (
        // 连续错误熔断阈值
        CircuitErrorLimit = 10
        // 熔断冷却时长
        CircuitCooldownMs = 60000
)

// ---------- Semaphore (R31-1B) ----------

// Semaphore — 并发上限控制 (Go chan 实现, 比 TS promise 队列更高效无锁).
//
//      acquire/release 必须成对调用 (defer release), 否则泄漏许可 (并发降为 0 死锁).
type Semaphore struct {
        ch chan struct{}
}

// NewSemaphore — 创建并发上限 N 的 semaphore (N 钳 [1, 10]).
func NewSemaphore(limit int) *Semaphore {
        if limit < 1 {
                limit = 1
        }
        if limit > 10 {
                limit = 10
        }
        return &Semaphore{ch: make(chan struct{}, limit)}
}

// Acquire — 获取一个许可. ctx 取消时返回 ctx.Err().
func (s *Semaphore) Acquire(ctx context.Context) error {
        select {
        case s.ch <- struct{}{}:
                return nil
        case <-ctx.Done():
                return ctx.Err()
        }
}

// Release — 释放一个许可.
func (s *Semaphore) Release() {
        <-s.ch
}

// ---------- TaskRuntime (内存级任务运行时) ----------

// TaskStats — 任务累计统计.
type TaskStats struct {
        BooksCreated    int
        BooksUpdated    int
        ChaptersCreated int
        ChaptersUpdated int
        CoversSaved     int
        SuggestWords    int
        Errors          int
}

// TaskProgress — 任务进度 (写 DB 持久化).
type TaskProgress struct {
        Phase              string // list | book | content | done
        PhaseNote          string
        BooksDone          int
        BooksTotal         int
        TocTotal           int
        ContentDone        int
        ContentTotal       int
        MemBooksInQueue    int
        MemChaptersInQueue int
        CurrentBook        string
        LastThread         int
        LastInterval       int
}

// LogLevel — 日志级别.
type LogLevel string

const (
        LogInfo    LogLevel = "info"
        LogWarn    LogLevel = "warn"
        LogError   LogLevel = "error"
        LogSuccess LogLevel = "success"
)

// LogEntry — 日志条目.
type LogEntry struct {
        Level   LogLevel
        Message string
        TS      int64
}

// TaskRuntime — 单任务运行时 (epoch + 集合 + 统计).
type TaskRuntime struct {
        TaskID string

        // 控制
        mu           sync.Mutex
        running      bool
        paused       bool
        stopped      bool
        epoch        int64
        createdAt    int64
        lastActiveAt int64

        // 统计 (atomic)
        requestCount       int64
        bytesFetched       int64
        runStartedAt       int64
        currentURL         string
        maxRequests        int
        captchaEncountered int64
        // R103-A BUG-299 (P2): per-task 反爬拦截累计 (mirror captchaEncountered family).
        //   与 captchaEncountered 同口径 atomic.AddInt64, 7 Blocked callsite 累计:
        //   discoverBooks + CrawlBookMeta (book/toc/pageFetcher/cover) +
        //   CrawlChapterContent (chapter/pageFetcher). 让 Snapshot.BlockedEncountered
        //   分离 "反爬拦截频率" vs "captcha 频率" (R42-1B 后两计数器并存, 互补).
        blockedEncountered int64

        // 集合 (路径状态分流)
        discoveredBookUrls map[string]bool
        completedBookUrls  map[string]bool
        ongoingBookUrls    map[string]bool
        failedBookUrls     map[string]bool
        // R73-C BUG-108 (P3): 删除 bookLastChapters map[string]string 字段 (cascade
        //   deadcode — SetBookLastChapter/GetBookLastChapter 0 callers, 字段仅 Snapshot
        //   计数用, 永远 0). 与 R72-C BUG-95 IDMap 同款 cascade 清理.

        // R74-C BUG-112 (P3): 删除 circuitTrippedAt int64 字段 (dead state —
        //   Snapshot 不读, 0 callers, 与 R73-C BUG-108 bookLastChapters 同款
        //   cascade deadcode 清理. 原 line 1338 rt.mu.Lock + 写 circuitTrippedAt 已删).

        // 日志
        recentLogs []LogEntry
        logsMu     sync.Mutex
}

// NewTaskRuntime — 创建任务运行时.
func NewTaskRuntime(taskID string) *TaskRuntime {
        return &TaskRuntime{
                TaskID:             taskID,
                createdAt:          time.Now().UnixMilli(),
                runStartedAt:       time.Now().UnixMilli(),
                discoveredBookUrls: map[string]bool{},
                completedBookUrls:  map[string]bool{},
                ongoingBookUrls:    map[string]bool{},
                failedBookUrls:     map[string]bool{},
                // R73-C BUG-108: 删 bookLastChapters init (字段已删).
        }
}

// IsRunning — 任务是否在运行.
func (rt *TaskRuntime) IsRunning() bool {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        return rt.running
}

// IsPaused — 任务是否暂停.
func (rt *TaskRuntime) IsPaused() bool {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        return rt.paused
}

// IsStopped — 任务是否停止.
func (rt *TaskRuntime) IsStopped() bool {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        return rt.stopped
}

// CurrentEpoch — 当前 epoch (换代检测用).
func (rt *TaskRuntime) CurrentEpoch() int64 {
        return atomic.LoadInt64(&rt.epoch)
}

// IsStale — epoch 是否漂移 (被新一轮 start 取代).
//
//      myEpoch = 调用方捕获的 epoch, 与 rt.epoch 对比.
func (rt *TaskRuntime) IsStale(myEpoch int64) bool {
        return rt.CurrentEpoch() != myEpoch
}

// MarkRunning — 标记任务开始运行 (epoch++, 复位 stopped/paused).
//
//      R67-C BUG-61 (P3) 修复: 原实现 rt.epoch++ 是普通 int64 写 (在 rt.mu 锁内),
//        与 CurrentEpoch()/IsStale() 的 atomic.LoadInt64 读 (无锁) 无 happens-before
//        关系 → Go memory model 视为 data race (32-bit ARM 平台 int64 写是两条 32-bit
//        指令, 中间被 atomic.Load 读到撕裂值; x86 因 8 字节对齐硬件保证无撕裂, 仍
//        是 latent race). 修复: 改用 atomic.AddInt64(&rt.epoch, 1) (原子写), 与读路径
//        同口径. mu.Lock 仍保留 (保护 running/paused/stopped/runStartedAt 多字段
//        一致性), epoch 字段单独用 atomic.
func (rt *TaskRuntime) MarkRunning() int64 {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        newEpoch := atomic.AddInt64(&rt.epoch, 1)
        rt.running = true
        rt.paused = false
        rt.stopped = false
        rt.runStartedAt = time.Now().UnixMilli()
        rt.lastActiveAt = rt.runStartedAt
        return newEpoch
}

// MarkStopped — 标记任务停止.
func (rt *TaskRuntime) MarkStopped() {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        rt.stopped = true
        rt.running = false
}

// MarkPaused — 标记任务暂停.
func (rt *TaskRuntime) MarkPaused() {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        rt.paused = true
        rt.lastActiveAt = time.Now().UnixMilli()
}

// MarkResumed — 标记任务恢复.
func (rt *TaskRuntime) MarkResumed() {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        rt.paused = false
        rt.lastActiveAt = time.Now().UnixMilli()
}

// IncRequest — 累计请求计数 (gateFetch 入口调用).
func (rt *TaskRuntime) IncRequest() int64 {
        return atomic.AddInt64(&rt.requestCount, 1)
}

// IncCaptcha — 累计验证码触发次数.
// CrawlChapterContent / CrawlBookMeta 在 FetchResult.CaptchaDetected=true 时调用.
func (rt *TaskRuntime) IncCaptcha() int64 {
        return atomic.AddInt64(&rt.captchaEncountered, 1)
}

// IncBlocked — 累计反爬拦截次数 (R103-A BUG-299, mirror IncCaptcha family).
// discoverBooks / CrawlBookMeta (book/toc/pageFetcher/cover) / CrawlChapterContent
// (chapter/pageFetcher) 在 res.Blocked=true (looksBlocked 命中) 时调用. 与
// IncCaptcha 互补: captcha 是软拦截 (widget 检测, 可 2captcha 求解), Blocked 是
// 硬拦截 (Cloudflare challenge / 403/412/429 / 源站 looksBlocked). admin 任务监控
// Snapshot.BlockedEncountered 让操作员区分 "反爬触发频率" vs "captcha 频率" — 持续
// 高 BlockedEncountered + 0 CaptchaEncountered = 源站硬封禁 (需 IP 轮换 / UA 调整);
// 高 CaptchaEncountered = 源站 captcha 拦截 (可配 2captcha API key 求解). 与
// R101-A BUG-290 ErrListDiscoveryBlocked sentinel (list 首页 Blocked) + BUG-291/292
// pageFetcher Blocked propagation + BUG-294/295 FetchTestSampleBook Blocked mapping
// family 同款 "Blocked 语义收口" 续 — counter 层补 7 callsite, 让 admin 看到
// per-task 反爬拦截总量 (sentinel + kind + status mapping 是 per-event 语义, counter
// 是 per-task 累计, 互补).
func (rt *TaskRuntime) IncBlocked() int64 {
        return atomic.AddInt64(&rt.blockedEncountered, 1)
}

// SetMaxRequests — 设置请求预算上限.
// R41-1A: 修复原实现用 atomic.StoreInt64(&rt.epoch, rt.epoch) 做 "memory barrier" 的错误
//
//      (epoch 自存自不构成 barrier). 改为用 rt.mu 锁保护写入, 与读路径 (Snapshot) 同款锁.
func (rt *TaskRuntime) SetMaxRequests(max int) {
        rt.mu.Lock()
        rt.maxRequests = max
        rt.mu.Unlock()
}

// CheckBudget — 检查请求预算 (gateFetch 入口调用, 超出返回 BudgetExceeded).
func (rt *TaskRuntime) CheckBudget() error {
        if rt.maxRequests <= 0 {
                return nil
        }
        cnt := atomic.LoadInt64(&rt.requestCount)
        if cnt > int64(rt.maxRequests) {
                return &BudgetExceeded{TaskID: rt.TaskID, Count: int(cnt), Max: rt.maxRequests}
        }
        return nil
}

// IncBytes — 累计字节.
func (rt *TaskRuntime) IncBytes(n int64) {
        atomic.AddInt64(&rt.bytesFetched, n)
}

// SetCurrentURL — 设置当前抓取 URL (供快照).
func (rt *TaskRuntime) SetCurrentURL(u string) {
        rt.mu.Lock()
        rt.currentURL = u
        rt.lastActiveAt = time.Now().UnixMilli()
        rt.mu.Unlock()
}

// CurrentURL — 当前抓取 URL.
func (rt *TaskRuntime) CurrentURL() string {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        return rt.currentURL
}

// AddToFailed — 瞬态错误入 failedBookUrls (R32-1A).
func (rt *TaskRuntime) AddToFailed(url string) {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        if len(rt.failedBookUrls) < 10000 {
                rt.failedBookUrls[url] = true
        }
}

// RemoveFromFailed — ok 路径从中删除 (保持集合干净).
func (rt *TaskRuntime) RemoveFromFailed(url string) {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        delete(rt.failedBookUrls, url)
}

// AddToCompleted — 完结书整体跳过.
func (rt *TaskRuntime) AddToCompleted(url string) {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        if len(rt.completedBookUrls) < 10000 {
                rt.completedBookUrls[url] = true
        }
}

// AddToOngoing — 连载中书 (增量检查).
func (rt *TaskRuntime) AddToOngoing(url string) {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        if len(rt.ongoingBookUrls) < 10000 {
                rt.ongoingBookUrls[url] = true
        }
}

// AddToDiscovered — 已发现 (防重复采).
func (rt *TaskRuntime) AddToDiscovered(url string) {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        if len(rt.discoveredBookUrls) < 50000 {
                rt.discoveredBookUrls[url] = true
        }
}

// R73-C BUG-108 (P3): 删除 IsDiscovered (0 callers, deadcode). discoveredBookUrls
//   字段仍由 AddToDiscovered 写入 + Snapshot 计数, 保留. 未来需 dedup 查询时
//   重新加 1 行 wrapper 即可 (与 R67-C SafeStr/ClampInt 删除同口径).

// IsCompleted — 是否已完结.
func (rt *TaskRuntime) IsCompleted(url string) bool {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        return rt.completedBookUrls[url]
}

// R73-C BUG-108 (P3): 删除 SetBookLastChapter + GetBookLastChapter (0 callers,
//   deadcode) + bookLastChapters 字段 (cascade). 原为 "未来 wiring 增量检查" 预留
//   (line 1804 注释 "实际由 wiring 提供"), 但从未接入. 与 R72-C BUG-95 IDMap 同款
//   cascade deadcode 清理. 未来需增量检查时重新加 4 行 (字段 + Set + Get + init).

// Snapshot — 任务实时快照 (供 admin UI 实时显示).
type TaskSnapshot struct {
        Running             bool
        Paused              bool
        RequestCount        int64
        BytesFetched        int64
        RunStartedAt        int64
        CurrentURL          string
        MaxRequests         int
        MemResumeSetsSize   int
        RecentLogs          []LogEntry
        FailedBookUrlsCount int
        CaptchaEncountered  int64
        // R103-A BUG-299: per-task 反爬拦截累计 (mirror CaptchaEncountered, 7
        //   Blocked callsite 累计. 详见 TaskRuntime.blockedEncountered 注释).
        BlockedEncountered int64
}

// Snapshot — 返回任务实时快照 (供 admin UI 实时显示).
func (rt *TaskRuntime) Snapshot() *TaskSnapshot {
        // R65-C BUG-40 (P1) 修复: recentLogs 写在 rt.logsMu 下 (Log 函数), 读也必须在
        //   rt.logsMu 下. 原实现 Snapshot 在 rt.mu 下读 recentLogs, 与 Log 的 rt.logsMu
        //   写不同锁 → 数据竞争 (Go runtime -race 报 fatal: concurrent map read and
        //   map write / slice append during read). 修复: 先在 logsMu 下拷贝 recentLogs,
        //   再在 mu 下读其它字段. 两把锁顺序获取 (logsMu 先, mu 后), 无嵌套, 无死锁.
        rt.logsMu.Lock()
        logsCopy := append([]LogEntry(nil), rt.recentLogs...)
        rt.logsMu.Unlock()

        rt.mu.Lock()
        defer rt.mu.Unlock()
        return &TaskSnapshot{
                Running:             rt.running,
                Paused:              rt.paused,
                RequestCount:        atomic.LoadInt64(&rt.requestCount),
                BytesFetched:        atomic.LoadInt64(&rt.bytesFetched),
                RunStartedAt:        rt.runStartedAt,
                CurrentURL:          rt.currentURL,
                MaxRequests:         rt.maxRequests,
                MemResumeSetsSize:   len(rt.discoveredBookUrls) + len(rt.completedBookUrls) + len(rt.ongoingBookUrls) + len(rt.failedBookUrls),
                RecentLogs:          logsCopy,
                FailedBookUrlsCount: len(rt.failedBookUrls),
                CaptchaEncountered:  atomic.LoadInt64(&rt.captchaEncountered),
                BlockedEncountered:  atomic.LoadInt64(&rt.blockedEncountered),
        }
}

// Log — 记录任务日志 (供 admin UI 查询).
func (rt *TaskRuntime) Log(level LogLevel, message string) {
        rt.logsMu.Lock()
        defer rt.logsMu.Unlock()
        rt.recentLogs = append(rt.recentLogs, LogEntry{Level: level, Message: message, TS: time.Now().UnixMilli()})
        // 上限 100 条 (防无界增长)
        if len(rt.recentLogs) > 100 {
                rt.recentLogs = rt.recentLogs[len(rt.recentLogs)-100:]
        }
}

// ---------- hostHealthTracker (R65-C: 接 R64-B AdjustConcurrency / AdjustMinGap) ----------
//
//  hostHealthTracker — 进程级 per-host 健康 (成功率 + 延迟) 滑动统计.
//   caller: runner.go CrawlBookMeta / CrawlChapterContent 在 fetch 后调
//   recordLatency / recordSuccess / recordFailure; phase 2 主循环每 N=10 章调
//   adjustAll → hostgate.AdjustConcurrency (60s cooldown 内 hostgate 自抖动跳过).
//   价值: 健康 host 提并发 (3 → 10 章/批), 不健康 host 降并发 (避免雪崩);
//         快响应 host 缩 minGap (加速), 慢响应 host 扩 minGap (避免拖垮源站).
//   注: 与 hostgate 内部 failStreak/successStreak 机制互补 (streak 是被动反应,
//       AdjustConcurrency 是主动调整; 两者协同, hostgate AdjustConcurrency 60s
//       cooldown 防抖动, 这里无脑调也无副作用).

type hostHealthTracker struct {
        mu         sync.Mutex
        success    map[string]int
        fail       map[string]int
        latencySum map[string]int64
        latencyCnt map[string]int
        // R81-B 反反爬第 105 项 (R80 交接 #8): host 最后活动时间 (UnixMilli). 用于 7d sweep
        //   删除长跑进程不再访问的 host (防内存无界增长). 与 fetcher.go hostFrameOptionsMap
        //   / hostContentTypeOptionsMap / hostOriginIsolationMap 同款 TTL 7d pattern.
        lastSeen   map[string]int64
        sweepCount int64 // R81-B 第 105 项: record 调用计数, 每 1000 次触发一次 sweep
}

var (
        healthTrackerOnce sync.Once
        healthTrackerInst *hostHealthTracker
)

// getHealthTracker — 进程级单例 (多任务共享, hostgate 同款全局聚合).
func getHealthTracker() *hostHealthTracker {
        healthTrackerOnce.Do(func() {
                healthTrackerInst = &hostHealthTracker{
                        success:    map[string]int{},
                        fail:       map[string]int{},
                        latencySum: map[string]int64{},
                        latencyCnt: map[string]int{},
                        lastSeen:   map[string]int64{}, // R81-B 第 105 项
                }
        })
        return healthTrackerInst
}

// HostHealthSweepTTLms — per-host 健康统计条目 7 天 TTL (R81-B 第 105 项).
//
//      与 fetcher.go HostFrameOptionsSweepTTLms / HostContentTypeOptionsSweepTTLms
//      同口径 (7d). lastSeen 超过本 TTL 的 host 在 sweep 时从所有 4 map 删除.
const HostHealthSweepTTLms = 7 * 24 * 60 * 60 * 1000

// sweepStaleHostsLocked — 删除 lastSeen 超过 7d 的 host 条目 (R81-B 第 105 项).
//
//      必须在 h.mu 持有期间调 (caller 已 Lock). sweep 把 success/fail/latencySum/
//      latencyCnt/lastSeen 5 map 同步删 (与 record* 5 字段更新对称, 防 map 不一致
//      导致 computeHealth 读到部分 host 数据). 注: 删除长跑进程 7d 未访问 host
//      会丢失其累计计数, 但该 host 7d 内无访问 → 健康度无意义 (0.5 默认值), 重新
//      访问时从 0 累计也合理 (冷启 host). 长跑 admin ~71 host × 5 map = 355 entry,
//      无内存压力, 但 R82+ 长跑到上千 host 时本 sweep 防无界增长.
func (h *hostHealthTracker) sweepStaleHostsLocked() {
        now := time.Now().UnixMilli()
        for host, seen := range h.lastSeen {
                if now-seen > HostHealthSweepTTLms {
                        delete(h.success, host)
                        delete(h.fail, host)
                        delete(h.latencySum, host)
                        delete(h.latencyCnt, host)
                        delete(h.lastSeen, host)
                }
        }
}

// recordSuccess — per-host 成功计数 +1 (caller: fetch 成功路径).
func (h *hostHealthTracker) recordSuccess(host string) {
        if host == "" {
                return
        }
        h.mu.Lock()
        h.success[host]++
        // R81-B 第 105 项: 更新 lastSeen + 惰性 sweep (每 1000 次 record 触发).
        now := time.Now().UnixMilli()
        h.lastSeen[host] = now
        h.sweepCount++
        if h.sweepCount%1000 == 0 {
                h.sweepStaleHostsLocked()
        }
        h.mu.Unlock()
}

// recordFailure — per-host 失败计数 +1 (caller: fetch 失败/拦截/超时路径).
func (h *hostHealthTracker) recordFailure(host string) {
        if host == "" {
                return
        }
        h.mu.Lock()
        h.fail[host]++
        now := time.Now().UnixMilli()
        h.lastSeen[host] = now
        h.sweepCount++
        if h.sweepCount%1000 == 0 {
                h.sweepStaleHostsLocked()
        }
        h.mu.Unlock()
}

// recordLatency — per-host 延迟累计 (caller: fetch 后用 time.Since 测得的 HTTP
//
//      round-trip 毫秒数, 不含 cleaner/parser 时间). latencyMs < 0 视为无效, 忽略.
func (h *hostHealthTracker) recordLatency(host string, latencyMs int64) {
        if host == "" || latencyMs < 0 {
                return
        }
        h.mu.Lock()
        h.latencySum[host] += latencyMs
        h.latencyCnt[host]++
        now := time.Now().UnixMilli()
        h.lastSeen[host] = now
        h.sweepCount++
        if h.sweepCount%1000 == 0 {
                h.sweepStaleHostsLocked()
        }
        h.mu.Unlock()
}

// computeHealth — 计算 host 健康度 (0.0 ~ 1.0).
//
//      公式 (与 R64-B B1 注释一致): health = successRate * 0.6 + (1 - avgLatencyMs/5000) * 0.4
//      无数据时返 0.5 (中性, 不触发 AdjustConcurrency 调整, health ∈ [0.3, 0.8] 不动).
func (h *hostHealthTracker) computeHealth(host string) float64 {
        h.mu.Lock()
        defer h.mu.Unlock()
        s := h.success[host]
        f := h.fail[host]
        total := s + f
        if total == 0 {
                return 0.5
        }
        successRate := float64(s) / float64(total)
        var latencyFactor float64
        if cnt := h.latencyCnt[host]; cnt > 0 {
                avgMs := float64(h.latencySum[host]) / float64(cnt)
                latencyFactor = 1.0 - avgMs/5000.0
                if latencyFactor < 0 {
                        latencyFactor = 0
                }
                if latencyFactor > 1 {
                        latencyFactor = 1
                }
        } else {
                latencyFactor = 0.5
        }
        return successRate*0.6 + latencyFactor*0.4
}

// adjustAll — 对所有累计 host 调 hostgate.AdjustConcurrency (B1).
//
//      60s cooldown 内 hostgate 自跳过, 这里无脑调也无副作用.
//      caller: runner.go phase 2 主循环每 N=10 章调一次.
//
// R82-B BUG-179 (P3) 修复 (R81 交接 #2): 原实现迭代 success+fail map 收集 host,
//
//      但 lastSeen 由 recordSuccess / recordFailure / recordLatency 三路更新
//      (line 543/559/578). 若某 host 仅被 recordLatency 调 (e.g. 调用方早期只
//      测延迟未调 recordSuccess/recordFailure), 该 host 在 latencySum/latencyCnt/
//      lastSeen 三 map 中但不在 success/fail, adjustAll 漏调 → AdjustConcurrency
//      不基于该 host 健康度调整并发, hostgate 走中性 0.5 默认值. 实际 recordLatency
//      在 caller (line 1638/1856/2067) 紧邻 recordSuccess/recordFailure 调, 故
//      bug 潜伏. 但本修复提升健壮性 + 与 lastSeen sweep (line 521) 同口径迭代.
//      改为迭代 lastSeen map: 它涵盖所有曾经"被观测过"的 host (record* 三路都会
//      写 lastSeen), 保证 adjustAll 全覆盖. seen dedupe 不再需要 (lastSeen 是
//      单 map, host key 唯一).
func (h *hostHealthTracker) adjustAll() {
        h.mu.Lock()
        // R82-B BUG-179: 迭代 lastSeen (全 host 覆盖) 替代 success+fail 双 map 迭代.
        //   lastSeen 在 record* 三路均写, 是 host 集合的单一真源.
        hosts := make([]string, 0, len(h.lastSeen))
        for host := range h.lastSeen {
                hosts = append(hosts, host)
        }
        h.mu.Unlock()
        hg := GetHostGate()
        for _, host := range hosts {
                hg.AdjustConcurrency(host, h.computeHealth(host))
        }
}

// ---------- BookProgressReader (R65-C: 接 R64-B SmartResumeSort) ----------
//
//  BookProgressReader — 可选接口, 由 cfg.DB (admin.go wiring) 实现.
//   runner.go ExecuteTask 在 phase 1 之前 type-assertion 检查; 实现时调
//   ListBookProgress 拿 per-book 进度快照 → 转 SmartResumeItem → 调
//   SmartResumeSort → 重排 bookQueue (nearDone 优先 → started → fresh).
//   未实现时 (admin.go 尚未 wiring) type-assertion 失败, 走原顺序 (无影响).
//   接口而非字段: admin.go 无需改即可编译过 (type-assertion 失败兜底).

// ResumeItem — runner-internal 续采 item (URL-based, 不依赖 BookID 映射).
//
//      admin.go wiring 从 DB 查 Book.sourceURL + COUNT(Chapter) 构造, 注入接口.
type ResumeItem struct {
        BookURL       string
        ChaptersDone  int
        ChaptersTotal int
        LastFetchAt   int64 // UnixMilli, 0=从未采过
}

// BookProgressReader — 可选 DB 扩展接口 (runner 用 type-assertion 检测).
type BookProgressReader interface {
        // ListBookProgress — 返回 task 内 per-book 进度快照 (URL + done/total/lastAt).
        //   未实现 / 无数据时返 nil, nil (runner 走原顺序).
        ListBookProgress(taskID string) ([]ResumeItem, error)
}

// applyResumeSort — 用 SmartResumeSort 重排 bookQueue (nearDone → started → fresh).
//
//      items: per-book 进度快照 (URL-based). bookQueue: 待采 URL 列表.
//      算法:
//        1. items → SmartResumeItem (URL 作 BookID, SmartResumeSort 仅按 ChaptersDone/
//           ChaptersTotal/LastFetchAt 排序, 不读 BookID)
//        2. SmartResumeSort 返 sorted (nearDone → started → fresh)
//        3. bookQueue 按 sorted 顺序重排: 命中 sorted 的 URL 按 sorted 优先级排;
//           未命中 (fresh 新发现) 的 URL 排末尾, 保持原顺序 (稳定)
//      保守: items 为空 / bookQueue ≤ 1 → 不动 (返原 bookQueue).
func applyResumeSort(bookQueue []string, items []ResumeItem) []string {
        if len(items) == 0 || len(bookQueue) <= 1 {
                return bookQueue
        }
        // 1. 转 SmartResumeItem
        smartItems := make([]SmartResumeItem, len(items))
        for i, it := range items {
                smartItems[i] = SmartResumeItem{
                        BookID:        it.BookURL, // URL 作 ID (SmartResumeSort 不读语义)
                        ChaptersDone:  it.ChaptersDone,
                        ChaptersTotal: it.ChaptersTotal,
                        LastFetchAt:   it.LastFetchAt,
                }
        }
        // 2. SmartResumeSort (smart.go)
        sorted := SmartResumeSort(smartItems)
        // 3. URL → priority index
        prio := make(map[string]int, len(sorted))
        for i, si := range sorted {
                prio[si.BookID] = i
        }
        // 4. bookQueue 按 priority 排序 (未命中排末尾, 稳定)
        type qitem struct {
                url  string
                prio int
                ord  int
        }
        unknownPrio := len(sorted) // 未命中排所有已知之后
        qitems := make([]qitem, len(bookQueue))
        for i, u := range bookQueue {
                p, ok := prio[u]
                if !ok {
                        p = unknownPrio
                }
                qitems[i] = qitem{url: u, prio: p, ord: i}
        }
        sort.SliceStable(qitems, func(i, j int) bool {
                if qitems[i].prio != qitems[j].prio {
                        return qitems[i].prio < qitems[j].prio
                }
                return qitems[i].ord < qitems[j].ord
        })
        out := make([]string, len(bookQueue))
        for i, q := range qitems {
                out[i] = q.url
        }
        return out
}

// ---------- DB 接口 (供 wiring) ----------

// DBClient — DB 操作接口 (供 main.go wiring 注入).
//
//      crawl 包不直接依赖 Prisma / sqlite; 由调用方实现该接口.
type DBClient interface {
        // Task 操作
        UpdateTaskStatus(taskID, status string) error
        UpdateTaskProgress(taskID string, progress TaskProgress, stats TaskStats) error
        InsertTaskLog(taskID string, level LogLevel, message string) error
        // Book 操作
        FindBookBySourceURL(sourceURL string) (Book, error)
        UpsertBook(b Book) (Book, error)
        UpdateBookStatus(bookID, status string) error
        UpdateBookWordCount(bookID string, wordCount int64) error
        UpdateBookLatestChapter(bookID, latestChapter string) error
        UpdateBookCover(bookID, coverPath string) error
        // Chapter 操作
        FindChapterByURL(bookID, sourceURL string) (Chapter, error)
        UpsertChapter(c Chapter) (Chapter, error)
        MarkChapterFetched(chapterID string, fetched bool) error
        // R54-1B 智能分类辅助 — SmartCategory existingCategories 入参 + 命中后查 ID 写 Book.categoryId
        ListCategoryNames() []string
        FindCategoryIDByName(name string) string
}

// Book — 书籍 DB 实体 (简化口径, 与 Prisma Book 同款字段).
type Book struct {
        ID            string
        Name          string
        Author        string
        Intro         string
        Cover         string
        Status        string
        WordCount     int64
        LatestChapter string
        CategoryID    string
        SourceURL     string
        SiteID        string
        UpdatedAt     time.Time
}

// Chapter — 章节 DB 实体.
type Chapter struct {
        ID        string
        BookID    string
        Title     string
        Content   string
        Idx       int
        Volume    string
        SourceURL string
        Fetched   bool
        UpdatedAt time.Time
}

// ---------- TaskRunner ----------

// TaskRunner — 任务调度器 (进程级单例, 管理 runtimes map).
type TaskRunner struct {
        mu       sync.Mutex
        runtimes map[string]*TaskRuntime
}

var (
        taskRunnerOnce sync.Once
        taskRunnerInst *TaskRunner
)

// GetTaskRunner — 进程级单例.
func GetTaskRunner() *TaskRunner {
        taskRunnerOnce.Do(func() {
                taskRunnerInst = &TaskRunner{runtimes: map[string]*TaskRuntime{}}
        })
        return taskRunnerInst
}

// GetRuntime — 获取任务运行时 (无则 nil).
func (tr *TaskRunner) GetRuntime(taskID string) *TaskRuntime {
        tr.mu.Lock()
        defer tr.mu.Unlock()
        return tr.runtimes[taskID]
}

// Snapshot — 返回任务快照 (无运行时返回 nil).
func (tr *TaskRunner) Snapshot(taskID string) *TaskSnapshot {
        rt := tr.GetRuntime(taskID)
        if rt == nil {
                return nil
        }
        return rt.Snapshot()
}

// ---------- 执行入口 ----------

// ExecuteTaskConfig — 任务执行配置 (由调用方从 DB 加载).
type ExecuteTaskConfig struct {
        TaskID      string
        Rule        RuleConfig
        Override    FetchConfig
        URLTemplate string
        ThreadsMin  int
        ThreadsMax  int
        IntervalMin int
        IntervalMax int
        MaxRequests int
        RecrawlMode string // full | incremental
        DB          DBClient
        Logger      func(taskID string, level LogLevel, msg string)
        // R54-1B 智能化三开关 (与 Task 表 smartCategory/smartComplete/autoSuggest 同口径).
        //   SmartCategory=true → CrawlBookMeta 调 SmartCategory 算 categoryId 写入 Book 行
        //     (source + keyword 两层; LLM 兜底 Go 端未实现, method="none" 时跳过)
        //   SmartComplete=true → CrawlBookMeta 调 SmartCompleteDetect 算 status 写入 Book 行
        //     (源站状态 → 简介 → 末章标题 → 书名标注 四级启发式)
        //   AutoSuggest=true → PSEO 关键词自动生成 (Go 端未实现 LLM 路径, 仅留开关兼容)
        SmartCategory bool
        SmartComplete bool
        AutoSuggest   bool
        // R70-B 目标B (用户需求 #6 分卷): runner 不直接读 Site 表 (main.go 范围),
        //   main.go 加载 Setting 表 volumeGrouping:{siteID} (默认 true) 后通过本字段
        //   传给 runner. runner 仅做透传 (Phase 2 ChapterTask.Volume 已存, Phase 3
        //   FinalizeBook latestChapter 取 TocItems 末项; 实际分卷 UI 渲染在 main.go
        //   getBookViewData 范围, 不在本轮 4 文件). false=禁分卷 (整列显示), true=分卷.
        VolumeGrouping bool
}

// BookMetaResult — 阶段 1 (书籍 meta 采集) 的返回值.
type BookMetaStatus string

const (
        BookMetaStatusOKMeta   BookMetaStatus = "ok-meta"
        BookMetaStatusOK       BookMetaStatus = "ok"
        BookMetaStatusBlocked  BookMetaStatus = "blocked"
        BookMetaStatusEmptyToc BookMetaStatus = "empty-toc"
        BookMetaStatusStopped  BookMetaStatus = "stopped"
        BookMetaStatusError    BookMetaStatus = "error"
)

// BookMetaResult — 阶段 1 结果.
//
//      R67-C BUG-60 (P3) 修复: 新增 IsNewBook + CoverSaved 字段供 ExecuteTask 主循环
//        累计 stats.BooksCreated/BooksUpdated/CoversSaved (原实现 stats 三字段始终为 0,
//        任务完成日志 "新书0 更新0 | 封面0" 失真, 操作员无法判断本轮是否真有新书入库).
type BookMetaResult struct {
        Status     BookMetaStatus
        BookURL    string
        BookCtx    *BookMetaContext
        IsNewBook  bool // R67-C BUG-60: true=新建书, false=已存在书 (供 stats.BooksCreated/Updated 累计)
        CoverSaved bool // R67-C BUG-60: 封面是否成功落盘 (供 stats.CoversSaved 累计)
}

// BookMetaContext — 阶段 2 章节采集所需的书本上下文.
//
// R72-C BUG-95 (P3) 修复 (R71 交接 #1): 删除 IDMap map[string]string 字段 (cascade
//
//      deadcode). 原 R47-1A 实现创建 idMap 在 CrawlBookMeta 填所有 toc.URL → "" (暂为
//      空, 声称 "阶段 2 落库后填充"), 但 phase 2 CrawlChapterContent 从不写回 idMap
//      (ch.ID 优先用 q.ChID, 不存在时直接走 UpsertChapter 不查 IDMap), phase 2 落库后
//      也不更新 IDMap[toc.URL] = created.ID. 故 IDMap[url] 永远是 "" → 查 IDMap 分支
//      `id, ok := q.BookCtx.IDMap[q.URL]; ok && id != ""` 的 `&& id != ""` 条件恒 false,
//      IDMap 查询永远不命中 (lookup miss). IDMap 是纯 deadcode, 删除字段 + 相关 4 处
//      (init + 赋值 + lookup). (注: 不补 "phase 2 落库后写回 IDMap" 是因为 ch.ID 来源
//      q.ChID 已覆盖 admin retry-failed 场景, IDMap 多此一举.)
type BookMetaContext struct {
        BookID          string
        BookName        string
        BookURL         string
        TocItems        []TocItem
        DetectedStatus  string // completed | ongoing | unknown
        ParsedWordCount int64
        FetchCfg        FetchConfig
}

// ChapterTask — 阶段 2 单章任务.
type ChapterTask struct {
        BookCtx *BookMetaContext
        ChID    string
        Title   string
        URL     string
        Volume  string
        Idx     int
}

// ExecuteTask — 三阶段采集主入口.
//
//      阶段 1: 并发 crawlBookMeta (semaphore 限 N=concurrency)
//      阶段 2: 全局并发 crawlChapterContent (channel 限 N)
//      阶段 3: 串行 finalizeBook (单本书收尾统计 + 状态分流)
//
//      错误隔离: 单本/单章失败不影响其他; BudgetExceeded / CircuitBreak 上抛任务级
//
// R72-C BUG-97 (P2) 修复 (R71 交接 #3): ExecuteTask 主循环无 defer recover. caller
//
//      (admin.go startCrawlTask) 已有 BUG-87 R70-D 加的 defer recover 兜底, 但 ExecuteTask
//      主循环 + phase 1/2 goroutine 边界偶发 panic (e.g. cfg.DB InsertTaskLog 在 defer
//      recover 之外被调 / progress 字段类型断言失败 / 罕见 nil 指针) 时, panic 跨 goroutine
//      传播到 caller 后 caller recover 也只能 "日志记 + 不杀进程", 任务状态会停在 "running"
//      状态 (admin UI 看到任务永远 running 不结束). 本修复在 rt 注册到 tr.runtimes 之后加
//      defer recover: panic 时用闭包捕获的 rt 直接调 MarkStopped + log + 返 err, 与 phase
//      1/2 goroutine 的 defer recover 同款 defense in depth. (注: 用 named return (retErr)
//      让 defer 能在 panic 时设 ret, 正常路径不影响. recover 注册在 cleanup 之前 — LIFO
//      顺序: cleanup 先触发 → 删 tr.runtimes; recover 后触发 → 闭包捕获 rt 直接 MarkStopped
//      + log + 设 retErr (rt 仍可访问, Go 闭包按引用捕获). 若 panic 发生在 NewTaskRuntime /
//      SetMaxRequests / MarkRunning (rt 注册前, defer 注册前) — caller (admin.go
//      startCrawlTask) 已有 R70-D BUG-87 兜底, 不在本修复范围.)
func ExecuteTask(ctx context.Context, cfg ExecuteTaskConfig) (retErr error) {
        rt := NewTaskRuntime(cfg.TaskID)
        // R41-1A: maxRequests 写入移到 MarkRunning / registration 之前 (happens-before 关系
        // 保证 admin Snapshot 看到非零值). 原代码在 tr.runtimes[cfg.TaskID] = rt 之后写,
        // 无 memory barrier, admin 读到零值.
        // R65-C: 改用 SetMaxRequests (mu.Lock 保护) 替代直接字段写, 与 Snapshot 读路径
        //   (同 mu) 锁口径一致, 消除 maxRequests 写读竞态 + 接通 deadcode (SetMaxRequests
        //   原 R41-1A 后未调用, deadcode 标记为 unreachable).
        rt.SetMaxRequests(cfg.MaxRequests)
        myEpoch := rt.MarkRunning()

        // 注册 runtime (供 admin UI 查询)
        tr := GetTaskRunner()
        tr.mu.Lock()
        tr.runtimes[cfg.TaskID] = rt
        tr.mu.Unlock()
        // R72-C BUG-97 (P2): defer recover — ExecuteTask 主循环 panic 兜底.
        //   注册在 cleanup defer 之前 (LIFO: cleanup 先触发 → 删 tr.runtimes → recover
        //   后触发 → 闭包捕获 rt 直接 MarkStopped + log + 设 retErr, 不依赖 tr.runtimes
        //   查询). caller (admin.go startCrawlTask) 已有 R70-D BUG-87 兜底, 本兜底是
        //   defense in depth.
        //   注: 即使 cleanup 已删 tr.runtimes[cfg.TaskID]=rt, 闭包仍持有 rt 指针 (Go
        //   闭包按引用捕获), rt.MarkStopped 直接调 rt.mu.Lock() 标 stopped=true, 与
        //   tr.runtimes 是否含 rt 无关.
        defer func() {
                if r := recover(); r != nil {
                        // 标记 runtime 为 stopped (防 admin Snapshot 看到 running 状态)
                        rt.MarkStopped()
                        // 写一条 error 日志 (best-effort, 不再嵌套 panic)
                        func() {
                                defer func() { _ = recover() }() // 二次兜底: cfg.DB InsertTaskLog panic 时不再传播
                                if cfg.DB != nil {
                                        _ = cfg.DB.InsertTaskLog(cfg.TaskID, LogError, fmt.Sprintf("🔴 ExecuteTask panic: %v", r))
                                }
                        }()
                        retErr = fmt.Errorf("ExecuteTask panic: %v", r)
                }
        }()
        defer func() {
                tr.mu.Lock()
                if cur, ok := tr.runtimes[cfg.TaskID]; ok && cur == rt {
                        // 仅当当前 runtime 仍是本次实例时才删 (防换代竞态)
                        delete(tr.runtimes, cfg.TaskID)
                }
                tr.mu.Unlock()
        }()

        // ---------- 阶段 0: 列表发现 (bookQueue) ----------
        bookQueue := []string{}
        if len(cfg.Override.URLs) > 0 {
                // retry-failed 模式: 直接使用 URLs 作为 bookQueue
                bookQueue = append([]string(nil), cfg.Override.URLs...)
        } else if cfg.Rule.List.URLTemplate != "" {
                // 列表页发现
                urls, err := discoverBooks(ctx, cfg, rt, myEpoch)
                if err != nil {
                        return err
                }
                bookQueue = urls
        }

        // R65-C: 接 R64-B SmartResumeSort (B5) — 断点续采优先级排序.
        //   cfg.DB 若实现 BookProgressReader (admin.go wiring 可选), runner 调
        //   ListBookProgress 拿 per-book 进度快照 → applyResumeSort 重排 bookQueue
        //   (nearDone 优先 → started → fresh), 提升任务完成率可视化.
        //   admin.go 未实现接口时 type-assertion 失败, 走原顺序 (无影响, 编译过).
        if cfg.DB != nil {
                if pr, ok := cfg.DB.(BookProgressReader); ok {
                        if items, err := pr.ListBookProgress(cfg.TaskID); err == nil && len(items) > 0 {
                                before := bookQueue
                                bookQueue = applyResumeSort(bookQueue, items)
                                if len(bookQueue) > 0 && len(before) > 0 && bookQueue[0] != before[0] {
                                        rt.Log(LogInfo, fmt.Sprintf("续采排序: %d 本重排 (nearDone → started → fresh)", len(items)))
                                }
                        }
                }
        }

        progress := TaskProgress{
                Phase:       "book",
                BooksTotal:  len(bookQueue),
                CurrentBook: fmt.Sprintf("%d 本待采", len(bookQueue)),
                PhaseNote:   fmt.Sprintf("阶段1: 并发采集书籍 meta (待采=%d 本)", len(bookQueue)),
        }
        stats := TaskStats{}

        logf := func(level LogLevel, format string, args ...any) {
                msg := fmt.Sprintf(format, args...)
                rt.Log(level, msg)
                if cfg.Logger != nil {
                        cfg.Logger(cfg.TaskID, level, msg)
                }
                if cfg.DB != nil {
                        _ = cfg.DB.InsertTaskLog(cfg.TaskID, level, msg)
                }
        }
        saveProgress := func() {
                if cfg.DB != nil {
                        _ = cfg.DB.UpdateTaskProgress(cfg.TaskID, progress, stats)
                }
        }

        logf(LogInfo, "任务开始: %s, 待采 %d 本, 并发度 %d", cfg.TaskID, len(bookQueue), cfg.Override.Concurrency)
        saveProgress()

        // ---------- 阶段 1: 并发 crawlBookMeta ----------
        bookConcurrency := cfg.Override.Concurrency
        if bookConcurrency <= 0 {
                bookConcurrency = cfg.Rule.Fetch.Concurrency
        }
        if bookConcurrency <= 0 {
                bookConcurrency = 3
        }
        if bookConcurrency > 10 {
                bookConcurrency = 10
        }
        bookSem := NewSemaphore(bookConcurrency)
        progress.Phase = "book"
        progress.PhaseNote = fmt.Sprintf("阶段1: 并发采集书籍 meta (并发度 %d, %d 本)", bookConcurrency, len(bookQueue))
        saveProgress()

        bookMetaResults := []BookMetaResult{}
        bookIdx := 0
        for bookIdx < len(bookQueue) {
                if rt.IsStopped() || rt.IsStale(myEpoch) {
                        break
                }
                // pause 检查 (轮询 600ms)
                for rt.IsPaused() && !rt.IsStopped() && !rt.IsStale(myEpoch) {
                        time.Sleep(600 * time.Millisecond)
                }
                if rt.IsStopped() || rt.IsStale(myEpoch) {
                        break
                }

                batchSize := bookConcurrency
                if batchSize > len(bookQueue)-bookIdx {
                        batchSize = len(bookQueue) - bookIdx
                }
                batch := bookQueue[bookIdx : bookIdx+batchSize]
                bookIdx += batchSize

                progress.MemBooksInQueue = len(bookQueue) - bookIdx
                if len(batch) == 1 {
                        progress.CurrentBook = batch[0]
                } else {
                        progress.CurrentBook = fmt.Sprintf("%d本并发", len(batch))
                }
                progress.PhaseNote = fmt.Sprintf("阶段1: 并发书籍 meta (%d/%d)", bookIdx, len(bookQueue))
                saveProgress()

                // 并发处理本批次的书 —— semaphore 兜底
                var wg sync.WaitGroup
                // R41-1A: bookBatchMu 保护 stats.Errors++ (跨 goroutine 写)
                var bookBatchMu sync.Mutex
                results := make([]BookMetaResult, len(batch))
                for i, bookURL := range batch {
                        if rt.IsStopped() || rt.IsStale(myEpoch) {
                                results[i] = BookMetaResult{Status: BookMetaStatusStopped, BookURL: bookURL}
                                continue
                        }
                        wg.Add(1)
                        go func(idx int, url string) {
                                defer wg.Done()
                                // R65-C BUG-41 (P1) 修复: phase 1 goroutine 加 defer recover
                                //   (与 phase 2 章节采集 goroutine 同款, R45-1A 已加 phase 2
                                //   recover, phase 1 漏加). CrawlBookMeta 内部 goquery /
                                //   ParseBook / ParseToc 偶发 panic (nil 指针, parser bug) 时,
                                //   无 recover 会让 panic 跨 goroutine 边界传播 → Go runtime
                                //   杀死整个进程 (相邻 goroutine + 主循环 + admin HTTP 服务全挂).
                                //   修复: defer recover 内置 stats.Errors++ / AddToFailed /
                                //   logf / results[idx] = error, 与 phase 2 同口径.
                                defer func() {
                                        if r := recover(); r != nil {
                                                // R76-C BUG-150 (P2 panic-dead-lock fix, phase 1):
                                                //   原 bookBatchMu.Lock() + 显式 Unlock 在 panic 发生于
                                                //   err 路径的 bookBatchMu 临界区 (line 1101-1110 IIFE)
                                                //   内时, IIFE 的 defer Unlock 释放锁后再传播到本 recover,
                                                //   本 recover 可正常 Lock + defer Unlock 不死锁. 与
                                                //   phase 2 BUG-149 IIFE 模式同口径.
                                                func() {
                                                        bookBatchMu.Lock()
                                                        defer bookBatchMu.Unlock()
                                                        stats.Errors++
                                                }()
                                                rt.AddToFailed(url)
                                                logf(LogError, "🔴 书籍采集 goroutine panic: %v", r)
                                                results[idx] = BookMetaResult{Status: BookMetaStatusError, BookURL: url}
                                        }
                                }()
                                if err := bookSem.Acquire(ctx); err != nil {
                                        results[idx] = BookMetaResult{Status: BookMetaStatusStopped, BookURL: url}
                                        return
                                }
                                defer bookSem.Release()

                                // completed book 整体跳过
                                if rt.IsCompleted(url) {
                                        // TODO: DB 验证 chapters > 0
                                        rt.RemoveFromFailed(url)
                                        logf(LogInfo, "跳过已完结: %s", url)
                                        results[idx] = BookMetaResult{Status: BookMetaStatusOK, BookURL: url}
                                        return
                                }

                                res, err := CrawlBookMeta(ctx, cfg, rt, myEpoch, url)
                                if err != nil {
                                        if rt.IsStale(myEpoch) {
                                                results[idx] = BookMetaResult{Status: BookMetaStatusStopped, BookURL: url}
                                                return
                                        }
                                        if IsBudgetExceeded(err) || IsCircuitBreak(err) {
                                                // 上抛任务级 (无法在 goroutine 内 panic, 用 mark + log)
                                                logf(LogError, "任务级错误: %v", err)
                                                rt.MarkStopped()
                                                results[idx] = BookMetaResult{Status: BookMetaStatusStopped, BookURL: url}
                                                return
                                        }
                                        // R41-1A: 加锁保护 stats.Errors++ (跨 goroutine)
                                        // R76-C BUG-150 (P2 panic-dead-lock fix, phase 1 同款): IIFE + defer
                                        //   Unlock. 若 panic 发生在 stats.Errors++ 内 (理论上 int++
                                        //   不应 panic, 但 defense-in-depth), defer Unlock 释放锁
                                        //   再传播到外层 recover, 不死锁.
                                        func() {
                                                bookBatchMu.Lock()
                                                defer bookBatchMu.Unlock()
                                                stats.Errors++
                                        }()
                                        rt.AddToFailed(url)
                                        logf(LogError, "书籍采集失败 %s: %v", url, err)
                                        results[idx] = BookMetaResult{Status: BookMetaStatusError, BookURL: url}
                                        return
                                }
                                results[idx] = *res
                        }(i, bookURL)
                }
                wg.Wait()

                // 处理本批次结果
                // R67-C BUG-60 (P3) 修复: 累计 stats.BooksCreated/BooksUpdated/CoversSaved
                //   (原实现三字段始终 0, 任务完成日志 "新书0 更新0 | 封面0" 失真).
                //   数据来自 BookMetaResult.IsNewBook + CoverSaved (CrawlBookMeta 设置).
                // R75-C BUG-130 (P3) 修复: BookMetaStatusOK (completed 跳过, line 1069-1075
                //   IsCompleted 路径) 漏计 progress.BooksDone. 原实现只计 Blocked/EmptyToc/
                //   Error 三种终态, OKMeta 在 phase 3 FinalizeBook line 2128 计, OK (completed
                //   skip) 不在 phase 2/3 流程内 → 永不计 BooksDone. admin UI 看到 "5/10 books
                //   done" 但实际 5 处理 + 5 跳过 = 10 本已完成, 进度显示失真. 修复: OK 也计入
                //   BooksDone (与 Blocked/EmptyToc/Error 同款 "phase 1 终态" 语义).
                for _, r := range results {
                        if r.Status == BookMetaStatusBlocked || r.Status == BookMetaStatusEmptyToc || r.Status == BookMetaStatusError || r.Status == BookMetaStatusOK {
                                progress.BooksDone++
                        }
                        if r.Status == BookMetaStatusOKMeta {
                                if r.IsNewBook {
                                        stats.BooksCreated++
                                } else {
                                        stats.BooksUpdated++
                                }
                                if r.CoverSaved {
                                        stats.CoversSaved++
                                }
                        }
                        bookMetaResults = append(bookMetaResults, r)
                        if r.Status == BookMetaStatusOKMeta && r.BookCtx != nil {
                                progress.TocTotal += len(r.BookCtx.TocItems)
                        }
                }
                saveProgress()
                // 批次间 sleepGap (节流)
                if bookIdx < len(bookQueue) && !rt.IsStopped() && !rt.IsStale(myEpoch) {
                        interval := cfg.IntervalMin
                        if cfg.IntervalMax > cfg.IntervalMin {
                                interval = cfg.IntervalMin + rand.Intn(cfg.IntervalMax-cfg.IntervalMin+1)
                        }
                        // R100-A BUG-288 (P3) 修复 (negative interval defensive clamp
                        //   family, 与 R98-A BUG-280 parseRetryAfterMs 负值同款
                        //   defensive clamp family): ExecuteTaskConfig 公开字段
                        //   ThreadsMin/Max + IntervalMin/Max 由 admin wiring 配置, admin
                        //   默认 clamp 为非负, 但 ExecuteTaskConfig 也可由测试 / 其他
                        //   wiring 路径构造 (R46-1B line 1283 已有 ThreadsMax<1 兜底,
                        //   说明已防御非 admin 路径). 若 IntervalMin 被外部传负值 (e.g.
                        //   -5) + IntervalMax > IntervalMin (e.g. 0) → rand.Intn(0-(-5)+1)
                        //   = rand.Intn(6) = [0,5] → interval = -5+[0,5] = [-5,0] →
                        //   time.Duration(-1..0) * time.Millisecond = -1ms..0ms →
                        //   time.After(负值) 立即返 → 批次间无节流 → 同 host 持续命中
                        //   (与 R98-A BUG-280 同款 立即重试无退避 family). 防御: 钳
                        //   interval 非负 (负值视为 0 = 无 sleep, 与 admin 未配 Interval
                        //   默认 0 同口径). 0 生产触发 (admin clamp 已保证非负), 仅
                        //   defensive 兜底. 与 site 2 (phase 2 line ~1460) 同款 fix.
                        if interval < 0 {
                                interval = 0
                        }
                        select {
                        case <-time.After(time.Duration(interval) * time.Millisecond):
                        case <-ctx.Done():
                                return ctx.Err()
                        }
                }
        }

        logf(LogInfo, "阶段1完成: %d 本处理", len(bookMetaResults))

        // ---------- 阶段 2: 全局并发采集章节内容 ----------
        globalQueue := []*ChapterTask{}
        okMetaBooks := []*BookMetaContext{}
        for _, r := range bookMetaResults {
                if r.Status == BookMetaStatusOKMeta && r.BookCtx != nil {
                        // 为每个 toc item 创建 ChapterTask
                        // R67-C BUG-55 (P2) 修复: 原实现未设置 Idx, 所有 ChapterTask.Idx=0
                        //   → CrawlChapterContent 把 ch.Idx=q.Idx=0 写入 DB → SQL
                        //   "ORDER BY idx ASC" (main.go:1526/1551/1654/1662 + admin.go:2906/3542)
                        //   退化为插入顺序/rowid, 章节顺序错乱 (用户翻书跳章). 修复: 用
                        //   toc 循环索引 i+1 (1-based, 与 admin.go 章节列表显示口径一致) 作
                        //   Idx, 同本书内 Idx 单调递增保序.
                        for i, toc := range r.BookCtx.TocItems {
                                globalQueue = append(globalQueue, &ChapterTask{
                                        BookCtx: r.BookCtx,
                                        Title:   toc.Title,
                                        URL:     toc.URL,
                                        Volume:  toc.Volume,
                                        Idx:     i + 1,
                                })
                        }
                        okMetaBooks = append(okMetaBooks, r.BookCtx)
                }
        }
        // R68-C 目标B: bookDoneMap 已删 (FinalizeBook 签名精简后无消费者, cascade deadcode).
        //   原 bookDoneMap 用于占位 "未来 wiring 增量统计", 但 stats.ChaptersCreated/Updated
        //   在 phase 2 goroutine 内累计 (与 bookDoneMap 路径无关), 故 bookDoneMap 全程 0 外部消费.

        if len(globalQueue) > 0 && !rt.IsStopped() && !rt.IsStale(myEpoch) {
                progress.Phase = "content"
                progress.ContentDone = 0
                progress.ContentTotal = len(globalQueue)
                progress.MemChaptersInQueue = len(globalQueue)
                progress.CurrentBook = fmt.Sprintf("%d 本书并发", len(okMetaBooks))
                progress.PhaseNote = fmt.Sprintf("阶段2: 并发采集章节内容 (%d 章待采)", len(globalQueue))
                saveProgress()
                logf(LogInfo, "阶段2开始: 全局章节队列 %d 章, 跨 %d 本书", len(globalQueue), len(okMetaBooks))

                consecutiveErrs := 0
                done := 0
                chapterConcurrency := bookConcurrency
                chapterSem := NewSemaphore(chapterConcurrency)
                // R41-1A: 引入 batchMu 保护章节 goroutine 内共享变量写
                // (stats.Errors / stats.ChaptersUpdated / consecutiveErrs / done /
                //  progress.ContentDone 都是跨 goroutine 共享; R68-C 删 bookDoneMap)
                var batchMu sync.Mutex
                // R42-1B: budgetExceeded 标志 (CrawlChapterContent 返回的 "other" 含 BudgetExceeded
                // 时, 由 goroutine 写此标志, 主循环 wg.Wait() 后检查并上抛任务级)
                var budgetExceeded atomic.Bool

                for len(globalQueue) > 0 {
                        if rt.IsStopped() || rt.IsStale(myEpoch) {
                                break
                        }
                        for rt.IsPaused() && !rt.IsStopped() && !rt.IsStale(myEpoch) {
                                time.Sleep(600 * time.Millisecond)
                        }
                        if rt.IsStopped() || rt.IsStale(myEpoch) {
                                break
                        }

                        threads := cfg.ThreadsMax
                        // R46-1B 防御式: ThreadsMax == 0 (ExecuteTaskConfig 公开 API 可被外部
                        // 直接构造, admin.go clamp 保证 threadMax>=1, 但 wiring 测试或其它路径
                        // 可能传 0) 时 threads=0 → batchSize=0 → batch=globalQueue[:0] 空 →
                        // globalQueue=globalQueue[0:] 不变 → 死循环. 兜底用 chapterConcurrency.
                        if threads < 1 {
                                threads = chapterConcurrency
                        }
                        if cfg.ThreadsMin > 0 && cfg.ThreadsMax > cfg.ThreadsMin {
                                threads = cfg.ThreadsMin + rand.Intn(cfg.ThreadsMax-cfg.ThreadsMin+1)
                        }
                        if threads > chapterConcurrency {
                                threads = chapterConcurrency
                        }
                        batchSize := threads
                        if batchSize > len(globalQueue) {
                                batchSize = len(globalQueue)
                        }
                        batch := globalQueue[:batchSize]
                        globalQueue = globalQueue[batchSize:]
                        progress.LastThread = threads
                        progress.MemChaptersInQueue = len(globalQueue) + len(batch)
                        logf(LogInfo, "⚙ 阶段2批次: %d 线程 × %d 章 (剩余 %d)", threads, len(batch), len(globalQueue))

                        var wg sync.WaitGroup
                        for _, q := range batch {
                                wg.Add(1)
                                go func(q *ChapterTask) {
                                        defer wg.Done()
                                        // R45-1A: defer recover 保证 logf/cfg.Logger/DB panic 不会
                                        // 让 goroutine 静默崩溃 (导致 wg.Wait 永久阻塞).
                                        defer func() {
                                                if r := recover(); r != nil {
                                                        batchMu.Lock()
                                                        stats.Errors++
                                                        consecutiveErrs++
                                                        batchMu.Unlock()
                                                        logf(LogError, "🔴 章节采集 goroutine panic: %v", r)
                                                }
                                        }()
                                        if err := chapterSem.Acquire(ctx); err != nil {
                                                return
                                        }
                                        defer chapterSem.Release()

                                        ok, kind, msg, _ := CrawlChapterContent(ctx, cfg, rt, myEpoch, q)
                                        // R45-1A: 缩小 batchMu 临界区 (R43-1B defer 修复 panic 但 logf
                                        // 内 cfg.DB.InsertTaskLog 走 DB I/O, 全 goroutine 串行化降低并发).
                                        // 改为: 锁内仅写共享变量 + 准备 logMsg, 锁外执行 logf (DB 写).
                                        // panic 安全由外层 defer recover 保证.
                                        //
                                        // R76-C BUG-149 (P2 panic-dead-lock fix): 原 batchMu.Lock() +
                                        //   显式 batchMu.Unlock() (line 1324) 在 panic 发生在临界区
                                        //   内时 (e.g. fmt.Sprintf 异常 / 罕见 nil 指针), Unlock 不执行,
                                        //   batchMu 永久持有; 外层 defer recover 尝试 batchMu.Lock()
                                        //   会死锁 (Go mutex 不重入) → wg.Wait() 永久阻塞 → 任务级
                                        //   hang. 修复: 改 IIFE + defer batchMu.Unlock() — panic 时
                                        //   defer 释放锁再传播到外层 recover, 无死锁风险. 临界区
                                        //   仍只覆盖共享变量写 + logMsg 准备 (锁外 logf DB I/O 不变).
                                        var logLevel LogLevel
                                        var logMsg string
                                        var shouldLog bool
                                        func() {
                                                batchMu.Lock()
                                                defer batchMu.Unlock()
                                                if ok {
                                                        // R73-C BUG-103 (P2) 修复: 原 stats.ChaptersUpdated 无条件 ++, 漏
                                                        //   stats.ChaptersCreated. phase 2 goroutine 调 cfg.DB.UpsertChapter(ch)
                                                        //   时, 若 q.ChID == "" (normal 模式: ChapterTask 由 line 1176-1184 字面量
                                                        //   构造, 不填 ChID) → ch.ID == "" → UpsertChapter INSERT 新行 (新章); 若
                                                        //   q.ChID != "" (admin retry-failed 模式: caller 传已存在 Chapter.ID
                                                        //   重试) → ch.ID = q.ChID → UpsertChapter UPDATE 已有行 (更新). 原
                                                        //   实现把新章算作 Updated, 任务完成日志 "新章节0 更新N" 失真, 操作员
                                                        //   无法判断本轮是真新建还是仅更新. 修复: q.ChID == "" → Created++,
                                                        //   否则 Updated++. 限制: 不查 DB 验证实际 INSERT vs UPDATE (避免每
                                                        //   章 +1 DB roundtrip), 依赖 q.ChID 语义 (与 CrawlChapterContent
                                                        //   line 1992 `if q.ChID != "" { ch.ID = q.ChID }` 同口径).
                                                        if q.ChID == "" {
                                                                stats.ChaptersCreated++
                                                        } else {
                                                                stats.ChaptersUpdated++
                                                        }
                                                        consecutiveErrs = 0
                                                        done++
                                                        progress.ContentDone = done
                                                        // R68-C 目标B: 删 bookDoneMap[q.BookCtx.BookID]++ (FinalizeBook 不再读 bookDone)
                                                } else {
                                                        switch kind {
                                                        case "no-url":
                                                                stats.Errors++
                                                                logLevel = LogWarn
                                                                // R83-A BUG-191 (P3): BUG-177 (R80-B) 加 nil q 防御返 msg="ChapterTask nil",
                                                                //   但 caller truncate(q.Title, 60) 在 q==nil 时 panic. 修复: msg 非空用 msg.
                                                                if msg != "" {
                                                                        logMsg = fmt.Sprintf("章节无有效链接, 跳过: %s", msg)
                                                                } else {
                                                                        logMsg = fmt.Sprintf("章节无有效链接, 跳过: %s", truncate(q.Title, 60))
                                                                }
                                                                shouldLog = true
                                                                done++
                                                                progress.ContentDone = done
                                                        case "timeout":
                                                                stats.Errors++
                                                                consecutiveErrs++
                                                                logLevel = LogError
                                                                logMsg = msg
                                                                shouldLog = true
                                                        case "abort":
                                                                // 停止/换代造成的中止不计失败
                                                        case "hostgate":
                                                                logLevel = LogWarn
                                                                logMsg = msg
                                                                shouldLog = true
                                                                // R83-A BUG-192 (P3): 原实现 hostgate case 无 done++ → 章节被 hostGate 拒后
                                                                //   从 globalQueue 删除但不计入 done/errors → progress 不一致. 与 no-url 同口径.
                                                                done++
                                                                progress.ContentDone = done
                                                        case "other":
                                                                // R42-1B: 检测 BudgetExceeded 并上抛任务级
                                                                // (CrawlChapterContent 内部 CheckBudget 失败时返回 "other" + BudgetExceeded msg)
                                                                if strings.Contains(msg, "BudgetExceeded") {
                                                                        budgetExceeded.Store(true)
                                                                        logLevel = LogError
                                                                        logMsg = fmt.Sprintf("🔴 预算超限: %s", msg)
                                                                        shouldLog = true
                                                                } else {
                                                                        stats.Errors++
                                                                        consecutiveErrs++
                                                                        logLevel = LogError
                                                                        logMsg = msg
                                                                        shouldLog = true
                                                                }
                                                        case "blocked":
                                                                // R102-A BUG-295: 章节首页 Blocked (CrawlChapterContent
                                                                //   line ~2294 返 kind="blocked"). 与 "other" 同口径 stats.Errors++ +
                                                                //   consecutiveErrs++ + LogError, 不走 BudgetExceeded 检查 (Blocked 非
                                                                //   budget 信号). 与 "no-url"/"timeout" 同款 stats 路径.
                                                                stats.Errors++
                                                                consecutiveErrs++
                                                                logLevel = LogError
                                                                logMsg = msg
                                                                shouldLog = true
                                                        }
                                                }
                                        }()
                                        if shouldLog {
                                                logf(logLevel, "%s", logMsg)
                                        }
                                }(q)
                        }
                        wg.Wait()

                        // R42-1B: 预算超限上抛任务级 (CrawlChapterContent 内部 CheckBudget
                        // 失败时, goroutine 在 "other" case 设置 budgetExceeded 标志, 此处
                        // wg.Wait() happens-after, 安全读取)
                        if budgetExceeded.Load() {
                                logf(LogError, "🔴 预算超限中止: 已超出最大请求数 %d", cfg.MaxRequests)
                                saveProgress()
                                return &BudgetExceeded{TaskID: cfg.TaskID, Count: int(atomic.LoadInt64(&rt.requestCount)), Max: cfg.MaxRequests}
                        }

                        // 连续错误熔断检查 (每批次末, 主循环读 consecutiveErrs 无锁 OK:
                        // 因为 wg.Wait() happens-before 这里, 所有 goroutine 写都已发布)
                        // R74-C BUG-112 (P3): 删除 rt.mu.Lock + rt.circuitTrippedAt = ... 写
                        //   (dead state — circuitTrippedAt 字段已删, Snapshot 不读; wg.Wait
                        //   已建立 happens-before, 无需额外 memory barrier).
                        if consecutiveErrs >= CircuitErrorLimit {
                                logf(LogError, "🔴 熔断中止: 连续 %d 章采集失败, 停止继续请求", consecutiveErrs)
                                saveProgress()
                                return &CircuitBreak{Reason: "连续错误熔断", Consecutive: consecutiveErrs, Limit: CircuitErrorLimit}
                        }

                        // R65-C: 接 R64-B AdjustConcurrency (B1) — 每 10 章调一次 adjustAll.
                        //   done 是 phase 2 累计已采章数 (goroutine 在 batchMu 下 ++,
                        //   wg.Wait() happens-after 这里, 安全读). 每 10 章对所有累计 host
                        //   调一次 hostgate.AdjustConcurrency (60s cooldown 内 hostgate
                        //   自抖动跳过, 无副作用). health 公式 (R64-B B1):
                        //     successRate * 0.6 + (1 - avgLatencyMs/5000) * 0.4
                        //   健康 > 0.8 → baseLimit+1, 不健康 < 0.3 → baseLimit-1.
                        if done > 0 && done%10 == 0 {
                                getHealthTracker().adjustAll()
                        }

                        // 批次间 sleepGap (节流 + jitterMs 抖动)
                        interval := cfg.IntervalMin
                        if cfg.IntervalMax > cfg.IntervalMin {
                                interval = cfg.IntervalMin + rand.Intn(cfg.IntervalMax-cfg.IntervalMin+1)
                        }
                        jitter := cfg.Override.JitterMs
                        if jitter > 0 {
                                interval += rand.Intn(jitter)
                        }
                        // R100-A BUG-288 续 (site 2/2, phase 2 sleepGap):
                        //   详见 phase 1 line ~1211 rationale. 同款 negative interval
                        //   defensive clamp (IntervalMin 负值 + jitter 后仍可能负 → 钳
                        //   非负防 time.After(负值) 立即返 + 持续命中).
                        if interval < 0 {
                                interval = 0
                        }
                        select {
                        case <-time.After(time.Duration(interval) * time.Millisecond):
                        case <-ctx.Done():
                                return ctx.Err()
                        }
                }

                // 阶段 2 收尾保存
                if !rt.IsStale(myEpoch) {
                        saveProgress()
                }
                logf(LogInfo, "阶段2完成: %d/%d 章正文已采集 (%d 更新)", done, progress.ContentTotal, stats.ChaptersUpdated)

                // ---------- 阶段 3: 串行 finalizeBook ----------
                for _, bc := range okMetaBooks {
                        if rt.IsStopped() || rt.IsStale(myEpoch) {
                                break
                        }
                        for rt.IsPaused() && !rt.IsStopped() && !rt.IsStale(myEpoch) {
                                time.Sleep(600 * time.Millisecond)
                        }
                        if rt.IsStopped() || rt.IsStale(myEpoch) {
                                break
                        }
                        // R68-C 目标B: FinalizeBook 签名精简 (删 ctx/myEpoch/bookDone/stats 4 参),
                        //   删 bookDone := bookDoneMap[bc.BookID] (无消费者, cascade deadcode).
                        if err := FinalizeBook(cfg, rt, bc, &progress); err != nil {
                                if IsBudgetExceeded(err) || IsCircuitBreak(err) {
                                        return err
                                }
                                stats.Errors++
                                logf(LogError, "书籍收尾失败 %s: %v", bc.BookURL, err)
                        }
                }
        }

        // ---------- 结束 ----------
        if rt.IsStale(myEpoch) {
                // 已被新一轮 start 取代, 不写终态
                return nil
        }
        if rt.IsStopped() {
                progress.PhaseNote = "已停止"
                saveProgress()
                return nil
        }
        progress.Phase = "done"
        progress.PhaseNote = "任务完成"
        // R103-A BUG-299: completion log 加 "拦截%d" 分离 BlockedEncountered
        //   (per-task 反爬拦截累计) vs "错误%d" (stats.Errors 含 transient err).
        //   操作员看到 "拦截5 | 错误2" 可判断 5 次反爬拦 (硬封禁信号) + 2 次瞬态
        //   错 (网络/解析), 与 Snapshot.BlockedEncountered admin UI 字段同口径.
        // R104-A BUG-306: 补 "验证码%d" (CaptchaEncountered). R103-A BUG-299 加 "拦截%d"
        //   但未补 captcha — 与 Snapshot.CaptchaEncountered admin UI 字段不对称
        //   (Snapshot 有 blocked + captcha 两字段, log 仅 blocked). 操作员看 log
        //   "拦截5 | 错误2" 无法判断 captcha 频率. 修复: 补 "验证码%d" 在 "拦截%d" 后
        //   (高 captcha = 软拦截, 可配 2captcha; 高 blocked = 硬封禁). 与 R103-A
        //   BUG-299 completion log breakdown 同口径闭环.
        logf(LogSuccess, "✅ 任务完成: 新书%d 更新%d | 新章节%d 更新%d | 封面%d | 拦截%d | 验证码%d | 错误%d",
                stats.BooksCreated, stats.BooksUpdated, stats.ChaptersCreated, stats.ChaptersUpdated, stats.CoversSaved, atomic.LoadInt64(&rt.blockedEncountered), atomic.LoadInt64(&rt.captchaEncountered), stats.Errors)
        if !rt.IsPaused() && !rt.IsStopped() && !rt.IsStale(myEpoch) {
                if cfg.DB != nil {
                        _ = cfg.DB.UpdateTaskStatus(cfg.TaskID, "done")
                }
        }
        saveProgress()
        return nil
}

// ---------- discoverBooks (列表发现) ----------

// ErrListDiscoveryBlocked — R101-A BUG-290 (P2) 修复: discoverBooks 首页被反爬
// 拦截 (looksBlocked=true) 时返回的 sentinel error. 与 ErrSourceUnreachable
// (R80-B) 同款 sentinel 模式, 让 caller (ExecuteTask / FetchTestSampleBook)
// 可 errors.Is 判断后 mark task "failed" 而非静默 "done with 0 books".
type ErrListDiscoveryBlocked struct {
        URL string
}

func (e *ErrListDiscoveryBlocked) Error() string {
        return "list discovery blocked: " + e.URL
}

func discoverBooks(ctx context.Context, cfg ExecuteTaskConfig, rt *TaskRuntime, myEpoch int64) ([]string, error) {
        // 简化: 单页列表 (翻页由 cfg.Rule.List.Pagination 控制)
        // 拼列表 URL 模板 (支持 {page} 占位符)
        urlTemplate := cfg.Rule.List.URLTemplate
        if urlTemplate == "" {
                return nil, errors.New("list.urlTemplate 未配置")
        }
        maxPages := 1
        if cfg.Rule.List.Pagination != nil && cfg.Rule.List.Pagination.Enabled {
                maxPages = cfg.Rule.List.Pagination.MaxPages
                if maxPages <= 0 {
                        maxPages = 20
                }
        }
        discovered := []string{}
        seen := map[string]bool{}
        // R101-A BUG-290 (P2): 首页 Blocked 跟踪. 原实现首页被反爬拦截 (looksBlocked)
        //   时 break → 返 (empty, nil) → ExecuteTask 走空 bookQueue → 阶段 1/2/3
        //   全跳过 → 任务标记 "done" (success) 但 0 本采集. 操作员看到"成功"绿
        //   灯却 0 数据, 无法区分"反爬拦"vs"列表真空". 修复: 首页 Blocked + 0 本
        //   发现时返 ErrListDiscoveryBlocked sentinel, 让 caller (ExecuteTask /
        //   ExecuteTaskWithRetry) errors.Is 判定后 mark task "failed" (经重试或
        //   直接失败, 不再静默 "done"). 与 ErrSourceUnreachable (R80-B) 同款
        //   sentinel 模式. 非首页 Blocked (p>=2) 仍 break 返部分结果 (与原行为
        //   一致, 多页发现部分成功是合法的).
        firstPageBlocked := false
        for p := 1; p <= maxPages; p++ {
                if rt.IsStopped() || rt.IsStale(myEpoch) {
                        break
                }
                // R45-1A 修复: 原实现 discoverBooks 不调 rt.CheckBudget / IncRequest, 列表页
                // 抓取绕过预算跟踪, maxPages=20 + maxRequests=100 时实际可消耗 20 列表 +
                // N 书 + M 章节 = M+N+20 远超 100. 加预算检查 + 请求计数, 超限 break.
                if err := rt.CheckBudget(); err != nil {
                        return discovered, err
                }
                rt.IncRequest()
                url := strings.ReplaceAll(urlTemplate, "{page}", fmt.Sprintf("%d", p))
                // R85-A BUG-206 (P3) 修复: discoverBooks fetch 429/503+RetryAfter 漏调
                //   hostGate.ReportRateLimited (CrawlBookMeta line 1637-1640 与
                //   CrawlChapterContent line 2076-2078 都调, discoverBooks 原仅 break).
                //   R85-A BUG-207 (P3) 同款: Blocked 路径漏调 ReportFailure + recordFailure
                //   (CrawlBookMeta line 1661-1663 同款). 补 err + Blocked 双路径对称.
                listHost := HostGateKeyOf(url)
                // R86-A BUG-219 (P3) 修复: 成功路径补 recordLatency + AdjustMinGap +
                //   recordSuccess + ReportSuccess (与 CrawlBookMeta line 1666-1683 同款).
                //   R85-A BUG-207 补了 err + Blocked 路径的 recordFailure/ReportFailure,
                //   但成功路径仍不报告 → hostGate failStreak 在间歇 list 失败时只增不减,
                //   derate 误触发 → 列表发现并发被压低; healthTracker successRate 低估 →
                //   AdjustConcurrency 降并发. timing + 4 调用对称补齐 (latency/Adjust 放
                //   Blocked 检查前 — HTTP 响应延迟有效无论是否 Blocked; success/Report 放
                //   Blocked 检查后 — 仅真实成功才计 success, 与 CrawlBookMeta 同款).
                listFetchStart := time.Now()
                res, err := FetchPage(ctx, url, cfg.Override)
                listLatencyMs := time.Since(listFetchStart).Milliseconds()
                if err != nil {
                        var he *HTTPError
                        if errors.As(err, &he) && (he.StatusCode == 429 || he.StatusCode == 503) && he.RetryAfterMs > 0 {
                                GetHostGate().ReportRateLimited(listHost, he.RetryAfterMs)
                        }
                        // R85-A BUG-207: err 路径也计 per-host 失败 (与 CrawlBookMeta 同款,
                        //   仅 Blocked 才 ReportFailure).
                        getHealthTracker().recordFailure(listHost)
                        break
                }
                // R86-A BUG-219: HTTP 响应延迟有效 (无论是否 Blocked), 记 latency + AdjustMinGap.
                getHealthTracker().recordLatency(listHost, listLatencyMs)
                GetHostGate().AdjustMinGap(listHost, listLatencyMs)
                if res.CaptchaDetected {
                        rt.IncCaptcha()
                }
                if res.Blocked {
                        // R85-A BUG-207: Blocked 路径调 ReportFailure + recordFailure
                        //   (与 CrawlBookMeta line 1661-1663 同款, 让 derate 触发).
                        GetHostGate().ReportFailure(listHost)
                        getHealthTracker().recordFailure(listHost)
                        // R103-A BUG-299: per-task 反爬拦截累计 (mirror IncCaptcha,
                        //   详见 TaskRuntime.blockedEncountered 注释; p==1 + p>=2 都计).
                        rt.IncBlocked()
                        // R101-A BUG-290: 首页 Blocked 跟踪 (详见 line ~1578 rationale).
                        if p == 1 {
                                firstPageBlocked = true
                        }
                        break
                }
                // R86-A BUG-219: 成功 (200 + 非 Blocked) 补 recordSuccess + ReportSuccess
                //   (与 CrawlBookMeta line 1681-1683 同款, 重置 failStreak + success 计数).
                getHealthTracker().recordSuccess(listHost)
                GetHostGate().ReportSuccess(listHost)
                // R56-1B 修复 BUG-E (P0): 原 ParseList 硬编码 urlFields=['url'],
                //   但 DB 53 条 enabled 规则中 50+ 条 list.fields 用 'bookUrl' 字段名
                //   (e.g. 101kks / 久久小说 / 飘天文学 / 铅笔小说 / 黄金屋 / 西红柿 /
                //    霹雳书屋 / 速读谷 / 夜伴书屋 / 努努书坊 / 二三阅读 / 零点看书 /
                //    ttkan / 77读书 / UU读书 等). ParseList 内 hasURLField 检查
                //   urlFields 含 'url' 或 'bookUrl', 但 hasAnyURLField 检查 rec[uf]
                //   for uf in urlFields — urlFields=['url'] 时只检查 rec['url'], 规则
                //   填 rec['bookUrl'] → hasAnyURLField 返 false → item 被 continue 跳过
                //   → listRes.Items 全空 → discoverBooks 收 0 本书 → 任务"完成"但 0 本采集.
                //   修复: urlFields 同时含 ['url', 'bookUrl'] (Absolutize 两个字段 +
                //    hasAnyURLField 同时检查两个字段). ParseList 兼容旧 url 字段名 + 新
                //    bookUrl 字段名, 都做 Absolutize + 入列.
                listRes := ParseList(res.HTML, url, cfg.Rule.List, []string{"url", "bookUrl"})
                newCount := 0
                for _, item := range listRes.Items {
                        // R56-1B 修复 BUG-E: item.Fields["url"] 优先, 缺则 fallback 到
                        //   item.Fields["bookUrl"] (兼容 50+ 规则用 bookUrl 字段名).
                        u := item.Fields["url"]
                        if u == "" {
                                u = item.Fields["bookUrl"]
                        }
                        if u == "" || seen[u] {
                                continue
                        }
                        seen[u] = true
                        discovered = append(discovered, u)
                        rt.AddToDiscovered(u)
                        newCount++
                }
                // R43-1B 修复: 删除原 `if p < maxPages { break }` 的无条件 break
                // (R38-1C 重写以来一直存在, maxPages > 1 时第一页就 break, 多页
                // 列表发现完全失效). 改为: 本页无新发现 → break (避免无效翻页).
                if newCount == 0 {
                        break
                }
        }
        // R101-A BUG-290: 首页 Blocked + 0 本发现 → 返 sentinel error (详见 line
        //   ~1578 rationale). 非首页 Blocked (p>=2) 仍返部分 discovered (合法多页
        //   部分成功). 0 本 + 非首页 Blocked (e.g. 首页 err 路径 line ~1615 break
        //   但非 Blocked) 仍返 (empty, nil) — ExecuteTask line ~991 把 0 本当
        //   "成功完成 0 本", 与原行为一致 (首页 err 非 Blocked 是网络层瞬时错误,
        //   ExecuteTaskWithRetry 会重试; 持续 err 会被 caller 当 transient retry).
        if firstPageBlocked && len(discovered) == 0 {
                return nil, &ErrListDiscoveryBlocked{URL: urlTemplate}
        }
        return discovered, nil
}

// ---------- CrawlBookMeta (阶段 1) ----------

// CrawlBookMeta — 阶段 1: 书籍 meta 采集 (书籍详情页 + 目录页).
//
// R43-1B 边缘 case 修复:
//   - HTTPError 429 / 503+RetryAfter → hostGate.ReportRateLimited (与 CrawlChapterContent 同款)
//   - FetchResult.CaptchaDetected → rt.IncCaptcha
//   - 拦截 (Blocked) 时也调 ReportFailure (R42-1B 后只在 err 路径调, res.Blocked
//     路径漏调 ReportFailure, hostgate failStreak 不增, derate 永远不触发)
func CrawlBookMeta(ctx context.Context, cfg ExecuteTaskConfig, rt *TaskRuntime, myEpoch int64, bookURL string) (*BookMetaResult, error) {
        // 预算检查
        if err := rt.CheckBudget(); err != nil {
                return nil, err
        }
        rt.IncRequest()
        rt.SetCurrentURL(bookURL)

        // 抓书籍页
        // R65-C: 接 R64-B AdjustMinGap (B3) + hostHealthTracker — 测 HTTP round-trip
        //   延迟 → hostgate.AdjustMinGap (30s cooldown 内 hostgate 自抖动跳过) +
        //   healthTracker.recordLatency / recordSuccess / recordFailure (per-host
        //   滑动统计, adjustAll 每 10 章调一次 AdjustConcurrency 用)
        fetchStart := time.Now()
        bookRes, err := FetchPage(ctx, bookURL, mergeFetchConfig(cfg.Override, FetchConfig{
                RequestPriority: "book",
        }))
        latencyMs := time.Since(fetchStart).Milliseconds()
        bookHost := HostGateKeyOf(bookURL)
        if err != nil {
                // R43-1B: 429 / 503+RetryAfter → ReportRateLimited (与 CrawlChapterContent 同款)
                // R74-C BUG-111 (P3): err.(*HTTPError) → errors.As 防 FetchPage 未来 wrap err
                //   (当前 FetchPage 直返 *HTTPError, errors.As 兼容; 若 R74+ 改 wrap, 不破).
                var he *HTTPError
                if errors.As(err, &he) && (he.StatusCode == 429 || he.StatusCode == 503) && he.RetryAfterMs > 0 {
                        GetHostGate().ReportRateLimited(bookHost, he.RetryAfterMs)
                }
                // R65-C: 失败路径记录 per-host 失败计数 (供 AdjustConcurrency 算 health)
                getHealthTracker().recordFailure(bookHost)
                return nil, err
        }
        // R67-C BUG-56 (P2) 修复: 原实现 recordSuccess + (后续) ReportSuccess 在
        //   Blocked 检查前调, Blocked 时 recordFailure + ReportFailure 也调,
        //   success+fail 双计数 → successRate 失真 (Blocked 视为 0.5 而非 0),
        //   AdjustConcurrency 不降并发, 同 host 持续被打. 修复: recordSuccess 移到
        //   Blocked 检查后 (与 ReportSuccess 同款, 仅 HTTP 200 + 非 Blocked 才算
        //   成功). recordLatency + AdjustMinGap 保留在 Blocked 检查前 (HTTP 响应
        //   延迟有效, 无论是否 Blocked).
        // R65-C: 延迟 + 调 AdjustMinGap (无论是否 Blocked, 都有 HTTP 响应, 延迟有效)
        getHealthTracker().recordLatency(bookHost, latencyMs)
        GetHostGate().AdjustMinGap(bookHost, latencyMs)
        if bookRes.CaptchaDetected {
                rt.IncCaptcha()
        }
        if bookRes.Blocked {
                // R43-1B: 拦截时也调 ReportFailure (R42-1B 后该路径漏调, hostgate
                // failStreak 不增, derate 永远不触发, 同 host 持续被打)
                GetHostGate().ReportFailure(bookHost)
                // R65-C: 拦截视为失败, 记 per-host 失败计数 (供 AdjustConcurrency 算 health)
                getHealthTracker().recordFailure(bookHost)
                // R103-A BUG-299: per-task 反爬拦截累计 (mirror IncCaptcha).
                rt.IncBlocked()
                return &BookMetaResult{Status: BookMetaStatusBlocked, BookURL: bookURL}, nil
        }
        // 成功 (HTTP 200 + 非 Blocked): 记 success + ReportSuccess
        getHealthTracker().recordSuccess(bookHost)
        // 成功: 记 per-host Referer (fetchPageOnce 内部已记, 这里不重复)
        GetHostGate().ReportSuccess(bookHost)

        // 解析书籍页 (parseBook)
        parsed := ParseBook(bookRes.HTML, bookURL, cfg.Rule.Book)

        // R54-1B 智能完结判断 (smartCompleteDetect) — 先算 status 再 upsert (status 入库).
        //   原 R38-1C 重写后此处算出 detectedStatus 仅用于运行时分流 (AddToCompleted/
        //   AddToOngoing), Book 行 status 字段始终写 "unknown" → finalizeBook 阶段才调
        //   UpdateBookStatus 持久化. 修复: 此处直接把 detectedStatus 写入 newBook.Status /
        //   existing.Status, 入库即带正确状态 (省 finalizeBook 二次 update).
        //   cfg.SmartComplete=false 时: 若源站 parsed.Status 非空 → 用 DetectCompleteFromText
        //   归一化 (e.g. "连载中" → "ongoing"); 否则 "unknown".
        detectedStatus := "unknown"
        if cfg.SmartComplete {
                completeResult := SmartCompleteDetect(SmartCompleteDetectInput{
                        StatusField:        parsed.Status,
                        Intro:              parsed.Intro,
                        LatestChapterTitle: parsed.LatestChapter,
                        BookName:           parsed.Name,
                })
                detectedStatus = completeResult.Status
        } else if parsed.Status != "" {
                // 未启用智能完结, 但源站 status 字段有值 → 直接归一化 (e.g. "已完结" → "completed")
                detectedStatus = DetectCompleteFromText(parsed.Status)
        }

        // R54-1B 智能分类 (smartCategory) — 先算 categoryID 再 upsert (categoryId 入库).
        //   原 R38-1C 重写后 SmartCategory 函数存在但从未被调用, Book 行 categoryId 始终为
        //   空; parsed.Category (rule book.fields.category 提取的源站分类名) 也未消费.
        //   修复: cfg.SmartCategory=true → 调 SmartCategory (source + keyword 两层),
        //   命中标准 4 字分类后查 DB 拿 categoryID 写入 newBook.CategoryID.
        //   cfg.SmartCategory=false → parsed.Category 经 NormalizeCategory 归一化后查 ID
        //   (e.g. 源站 "玄幻" → "玄幻奇幻" → DB ID), 命中则写入.
        categoryID := ""
        if cfg.DB != nil {
                if cfg.SmartCategory {
                        existingCats := cfg.DB.ListCategoryNames()
                        catResult := SmartCategory(parsed.Name, parsed.Intro, parsed.Category, existingCats)
                        if catResult.Category != "" {
                                categoryID = cfg.DB.FindCategoryIDByName(catResult.Category)
                        }
                } else if parsed.Category != "" {
                        // 未启用智能分类, 但源站分类有值 → 归一化后查 DB (兼容旧 2 字 / 4 字变体)
                        normalized := NormalizeCategory(parsed.Category)
                        if normalized != "" {
                                categoryID = cfg.DB.FindCategoryIDByName(normalized)
                        }
                }
        }

        // 简化: 直接 upsert 书籍 (假设无 DB 时跳过)
        var bookID string
        // R67-C BUG-60: 跟踪本次是新建还是更新 (供 stats 累计)
        isNewBook := false
        if cfg.DB != nil {
                // 检查是否已存在 (跨源去重 + 增量更新)
                existing, ferr := cfg.DB.FindBookBySourceURL(bookURL)
                // R74-C BUG-116 (P2) 修复 (R73 未决项 #11): ferr 非 sql.ErrNoRows 是 DB
                //   错误 (连接断/超时/锁等), 原无差别走 "新建" 路径 → 新建路径 newBook.WordCount=0
                //   + LatestChapter="" 经 UpsertBook 内部 sourceUrl SELECT (admin.go line 99)
                //   命中已存在行后 UPDATE 清空已有 wordCount/latestChapter (e.g. 10 万字 → 0,
                //   "第100章" → "", FinalizeBook 仅按本轮 ParsedWordCount 重算 → 字数严重
                //   欠计). 修复: DB 错误上抛让 caller (phase 1 goroutine) 走 err 路径
                //   (stats.Errors++ + AddToFailed), 不进新建路径. sql.ErrNoRows 仍走新建 (合法
                //   "not found"). errors.Is 兼容未来 admin.go wrap err (当前直返 sql.ErrNoRows).
                if ferr != nil && !errors.Is(ferr, sql.ErrNoRows) {
                        return nil, fmt.Errorf("FindBookBySourceURL DB 错误 %s: %w", bookURL, ferr)
                }
                if ferr == nil && existing.ID != "" {
                        bookID = existing.ID
                        isNewBook = false
                        // R54-1B 增量更新: 原代码此处仅 set bookID, 不刷新 meta 字段 (name/author/
                        //   intro/cover 不更新), 也不写 status/categoryId. 修复: 调 UpsertBook 刷新
                        //   meta 字段 + 仅当新算出 status != "unknown" 时覆盖 + 仅当新算出
                        //   categoryID != "" 时覆盖 (避免空值清空已有值).
                        // R68-C BUG-73 (P2) 修复: 原 Name/Author/Intro 无条件覆盖 (与 Cover 的条件覆盖
                        //   不一致). 源站模板变更 / parse 部分失败 (selector 不匹配 → parsed.Name="") →
                        //   existing.Name 被清空, DB Book.name 字段被擦成空串, 前台显示空白. 修复:
                        //   与 Cover 同款条件覆盖 (parsed 字段非空才覆盖, 空则保留 existing 值).
                        //   触发场景: 用户改 rule book.fields.name selector 后首次跑 → 旧 selector 已
                        //   失效, 新 selector 未生效 (e.g. 配置错误) → parsed.Name="" → 旧实现擦空
                        //   DB.name, 用户看到书名变空. 修复后保留旧 name, 等 selector 修好后下次
                        //   任务再覆盖.
                        if v := CleanTextField(parsed.Name, 200); v != "" {
                                existing.Name = v
                        }
                        if v := CleanTextField(parsed.Author, 100); v != "" {
                                existing.Author = v
                        }
                        if v := CleanIntro(parsed.Intro, 2000); v != "" {
                                existing.Intro = v
                        }
                        if parsed.Cover != "" {
                                existing.Cover = parsed.Cover
                        }
                        existing.SourceURL = bookURL
                        existing.UpdatedAt = time.Now()
                        if detectedStatus != "unknown" {
                                existing.Status = detectedStatus
                        } else if existing.Status == "" {
                                existing.Status = "unknown"
                        }
                        if categoryID != "" {
                                existing.CategoryID = categoryID
                        }
                        // 保留 existing.WordCount + existing.LatestChapter (UpsertBook UPDATE 直接用 b 字段,
                        //   不会清零, finalizeBook 阶段会重新 UpdateBookWordCount/UpdateBookLatestChapter)
                        // R74-C BUG-110 (P3) 修复: 原 err 静默吞 (与新建路径 BUG-74 R68-C
                        //   不一致). 书籍 meta 刷新失败 (DB 暂时故障 / 唯一约束冲突 等) 时,
                        //   existing.ID 仍有效 (line 1624 已设), 后续 toc + cover 采集可继续
                        //   (新书已存在, 只是 meta 残旧). log warn 让操作员察觉, 不 return err
                        //   中断整本书 (与新建路径不同 — 新建失败无 bookID 可继续, R68-C BUG-74
                        //   返 err 让 phase 1 走 AddToFailed 路径; existing 路径 bookID 已有, 中断
                        //   反损失更大).
                        if _, err := cfg.DB.UpsertBook(existing); err != nil {
                                rt.Log(LogWarn, fmt.Sprintf("书籍 meta 刷新失败 %s: %v", bookURL, err))
                        }
                } else {
                        // 新建书
                        isNewBook = true
                        newBook := Book{
                                Name:       CleanTextField(parsed.Name, 200),
                                Author:     CleanTextField(parsed.Author, 100),
                                Intro:      CleanIntro(parsed.Intro, 2000),
                                Cover:      parsed.Cover,
                                Status:     detectedStatus,
                                CategoryID: categoryID,
                                SourceURL:  bookURL,
                                UpdatedAt:  time.Now(),
                        }
                        // R68-C BUG-74 (P2) 修复: 原 created, err := UpsertBook(newBook); if err == nil { bookID = created.ID }
                        //   静默吞 err, bookID 留空 → 后续 line 1631 `if bookID == "" { bookID = "tmp_..." }`
                        //   fallback 生成 fake ID. 然后 CrawlBookMeta 继续 fetch toc + SaveCoverWebp(用 tmp_ ID)
                        //   + 构建 BookMetaContext{BookID: tmp_...}. phase 2 CrawlChapterContent 用 q.BookCtx.BookID="tmp_..."
                        //   调 UpsertChapter → DB 出现 bookId="tmp_..." 的 orphan 章节 (无对应 Book 行).
                        //   phase 3 FinalizeBook 用 bc.BookID="tmp_..." 调 UpdateBookWordCount/Status → UPDATE
                        //   影响行 0 (无匹配行), 静默失败. 章节入库失败也吞. 整本书"完成"但实际无 Book 行.
                        //   修复: UpsertBook(newBook) 失败时 return error 让 caller (phase 1 goroutine)
                        //   走 err 路径 (stats.Errors++ + AddToFailed + results[idx]=Error), phase 2 跳过该书.
                        //   task 重跑时 FindBookBySourceURL 仍返 "not found", 重试新建 (若 DB 错误已修).
                        created, err := cfg.DB.UpsertBook(newBook)
                        if err != nil {
                                return nil, fmt.Errorf("新建书 UpsertBook 失败 %s: %w", bookURL, err)
                        }
                        bookID = created.ID
                }
        }
        if bookID == "" {
                bookID = "tmp_" + fmt.Sprintf("%d", time.Now().UnixNano())
        }

        // (R54-1B: detectedStatus 计算已上移到 UpsertBook 之前, 不再此处重复算)

        // 抓目录页 (用 toc 规则, 若 toc 未配置 tocLink 则用书籍页 URL)
        tocURL := bookURL
        if cfg.Rule.Toc.TocLink != nil && cfg.Rule.Toc.TocLink.Type != "" {
                // 提取目录页链接 (从书籍页)
                doc, _ := goquery.NewDocumentFromReader(strings.NewReader(bookRes.HTML))
                if doc != nil {
                        // R95-A BUG-268 (P3) 修复 (R94-B 未决项 #3, crawl/parser.go scope
                        //   BUG-265 family 续): 原实现 `ExtractField(bookRes.HTML, doc,
                        //   nil, *cfg.Rule.Toc.TocLink, nil)` 末位 ctx 传 nil. ExtractField
                        //   FieldConst 分支 `if ctx != nil` 守卫 (parser.go line ~1125)
                        //   跳过 applyConstTemplate → `{q.bookId}` / `{bookId}` 等 const
                        //   模板占位符 0 替换 → 模板破损 (e.g. yueyouxs tocLink
                        //   `https://sma.yueyouxs.com/c/{q.bookId}.html` 返
                        //   "https://sma.yueyouxs.com/c/.html" 后 Absolutize 同款 URL,
                        //   后续 toc fetch 404). 3/4 callsite (ParseList/ParseToc/
                        //   ParseContent) 已传 ctx, 仅 runner.go tocLink 漏传. 修复:
                        //   传 &ExtractCtx{Vars: URLVars(bookURL)} 让 FieldConst 分支跑
                        //   applyConstTemplate (R94-B BUG-265 已修 {q.param} 前缀). 注:
                        //   仅 FieldConst 走 ctx.Vars; FieldCSS/FieldRegex/FieldJSON 不用
                        //   ctx.Vars (传 ctx 无害). URLVars 从 bookURL query 提取参数
                        //   (e.g. ?bookId=123 → vars["bookId"]="123"); 若 bookURL 无 query
                        //   则 vars 空 → {q.bookId} 仍返空 (与原行为相同, 0 回归); rule
                        //   若依赖 path 段需用 FieldCSS 提取 (不在本 fix 范围).
                        tocURL = ExtractField(bookRes.HTML, doc, nil, *cfg.Rule.Toc.TocLink,
                                &ExtractCtx{Vars: URLVars(bookURL)})
                        tocURL = Absolutize(tocURL, bookURL)
                        if tocURL == "" {
                                tocURL = bookURL
                        }
                }
        }
        rt.SetCurrentURL(tocURL)
        // R74-C BUG-113 (P3) + BUG-114 (P2) 修复 (R73 未决项 #9): tocURL fallback
        //   bookURL (TocLink 未配置或提取失败) 时原实现重复 FetchPage 同 URL, 浪费
        //   请求预算 + hostgate 计数 (书籍页路径 line 1528-1566 已记同 host). 修复:
        //   复用 bookRes 跳过 toc FetchPage + host 健康追踪. 同时 BUG-114: toc fetch
        //   原漏 rt.CheckBudget + rt.IncRequest, 预算未计 toc 请求 (admin 设 maxRequests
        //   =100 实际可消耗 200 = 100 book + 100 toc, 预算永不触发). 修复: 与 book fetch
        //   (line 1515-1519) 同款, 入口先 CheckBudget + IncRequest (仅 tocURL != bookURL
        //   路径, 复用路径不重复计 — 同 URL 已在 book fetch 计过).
        var tocRes *FetchResult
        if tocURL == bookURL {
                tocRes = bookRes
        } else {
                if err := rt.CheckBudget(); err != nil {
                        return nil, err
                }
                rt.IncRequest()
                // R65-C: 接 R64-B AdjustMinGap + healthTracker (与书籍页同款, 测 toc 页延迟)
                tocFetchStart := time.Now()
                var ferr error
                tocRes, ferr = FetchPage(ctx, tocURL, mergeFetchConfig(cfg.Override, FetchConfig{RequestPriority: "book"}))
                tocLatencyMs := time.Since(tocFetchStart).Milliseconds()
                tocHost := HostGateKeyOf(tocURL)
                if ferr != nil {
                        // R43-1B: 429 / 503+RetryAfter → ReportRateLimited (与书籍页同款)
                        // R74-C BUG-111 (P3): err.(*HTTPError) → errors.As (与书籍页路径同口径).
                        var he *HTTPError
                        if errors.As(ferr, &he) && (he.StatusCode == 429 || he.StatusCode == 503) && he.RetryAfterMs > 0 {
                                GetHostGate().ReportRateLimited(tocHost, he.RetryAfterMs)
                        }
                        // R65-C: 失败路径记录 per-host 失败计数
                        getHealthTracker().recordFailure(tocHost)
                        return nil, ferr
                }
                // R67-C BUG-56 (P2) 修复: 同 books 页路径, recordSuccess 移到 Blocked 检查后
                //   避免与 recordFailure 双计数. recordLatency + AdjustMinGap 保留在前.
                getHealthTracker().recordLatency(tocHost, tocLatencyMs)
                GetHostGate().AdjustMinGap(tocHost, tocLatencyMs)
                if tocRes.CaptchaDetected {
                        rt.IncCaptcha()
                }
                if tocRes.Blocked {
                        // R43-1B: 拦截时也调 ReportFailure (与书籍页同款)
                        GetHostGate().ReportFailure(tocHost)
                        // R65-C: 拦截视为失败
                        getHealthTracker().recordFailure(tocHost)
                        // R103-A BUG-299: per-task 反爬拦截累计 (mirror IncCaptcha).
                        rt.IncBlocked()
                        return &BookMetaResult{Status: BookMetaStatusBlocked, BookURL: bookURL}, nil
                }
                // 成功 (HTTP 200 + 非 Blocked): 记 success + ReportSuccess
                getHealthTracker().recordSuccess(tocHost)
                GetHostGate().ReportSuccess(tocHost)
        }

        // 解析目录 (含翻页)
        pageFetcher := func(ctx context.Context, u, refererURL string) (string, error) {
                // R84-A BUG-201 (P2) 修复: 翻页请求补 rt.CheckBudget + rt.IncRequest.
                //   原实现 pageFetcher 直调 FetchPage 无预算追踪, 多页 TOC (N 页) 消耗
                //   N HTTP 请求但预算只计 entry-level 1 次. admin maxRequests=100 + 10 本
                //   书各 5 页 TOC = 50 隐藏请求, 实际 100 book + 50 toc-page = 150, 预算
                //   永不触发. 修复: 翻页前 CheckBudget (超限返 err, ParseToc 收到 pageFetcher
                //   err 后 break 退出翻页循环, 返已采的部分 TOC — 与 entry-level CheckBudget
                //   同口径; BudgetExceeded 由 caller CrawlBookMeta 下次 entry 触发) +
                //   IncRequest (预算计数 +1, admin Snapshot.RequestCount 准确). 注: 仅计数
                //   pageFetcher 调用数 (不含 FetchPage 内部 native+utls+curl 三级降级的
                //   多次 HTTP 请求 — 后者属 fetcher 内部重试, 不在本层职责).
                if err := rt.CheckBudget(); err != nil {
                        return "", err
                }
                rt.IncRequest()
                // R87-A BUG-230 (P3) 修复 (R86-A BUG-219 discoverBooks 成功路径同款遗漏):
                //   pageFetcher 成功路径原仅 return res.HTML, 漏调 hostGate/health 4 调用
                //   (recordLatency + AdjustMinGap + recordSuccess + ReportSuccess), 与
                //   CrawlBookMeta 外层 book fetch (line ~1684-1700) + R86-A BUG-220 err
                //   路径不对称. 多页 TOC 第 2+ 页成功不计 → healthTracker successRate
                //   低估 → AdjustConcurrency 降并发; hostGate failStreak 在间歇页失败时
                //   只增不减 (err 页增, 成功页不重置) → derate 误触发. 补 timing + 4 调用
                //   (latency/Adjust 放 Blocked 检查前 — HTTP 响应延迟有效无论是否 Blocked;
                //   success/Report 放 Blocked 检查后 — 仅真实成功才计, 与外层同款).
                pageFetchStart := time.Now()
                res, err := FetchPage(ctx, u, mergeFetchConfig(cfg.Override, FetchConfig{
                        RefererChain:    cfg.Override.RefererChain,
                        RefererURL:      refererURL,
                        RequestPriority: "book",
                }))
                if err != nil {
                        // R86-A BUG-220 (P3) 修复 (R85-A BUG-207 discoverBooks 同款遗漏):
                        //   pageFetcher err 路径漏调 hostGate.ReportRateLimited (429/503+
                        //   RetryAfter) + recordFailure. 多页 TOC 第 2+ 页 429 不触发
                        //   hostGate derate → 后续 TOC/book/chapter 同 host 仍按原间隔发,
                        //   持续 429 频控 (Cloudflare 升级 IP 封禁). 与外层 toc fetch
                        //   (line ~1872-1881) + discoverBooks BUG-207 同款补 err 路径.
                        //   ctx 取消不计失败 (操作员主动停止); BudgetExceeded 在 line 1931
                        //   已先返, 不到此. 与 CrawlBookMeta 外层 err 同口径 (recordFailure
                        //   + ReportRateLimited, 不调 ReportFailure — 仅 Blocked 才 Report).
                        if ctx.Err() == nil {
                                pageHost := HostGateKeyOf(u)
                                var he *HTTPError
                                if errors.As(err, &he) && (he.StatusCode == 429 || he.StatusCode == 503) && he.RetryAfterMs > 0 {
                                        GetHostGate().ReportRateLimited(pageHost, he.RetryAfterMs)
                                }
                                getHealthTracker().recordFailure(pageHost)
                        }
                        return "", err
                }
                // R87-A BUG-230: 成功路径补 hostGate/health 报告 (与外层 book fetch 对称).
                pageHost := HostGateKeyOf(u)
                pageLatencyMs := time.Since(pageFetchStart).Milliseconds()
                getHealthTracker().recordLatency(pageHost, pageLatencyMs)
                GetHostGate().AdjustMinGap(pageHost, pageLatencyMs)
                // R91-A BUG-252 (P3) 修复 (R90-A 未决项 #6 候选 #5 续抓): 原实现
                //   pageFetcher 成功路径漏 rt.IncCaptcha — 多页 TOC 第 2+ 页命中 captcha
                //   时 rt.captchaEncountered 不增 (外层 FetchPage 4 处 IncCaptcha:
                //   discoverBooks/CrawlBookMeta book/CrawlBookMeta toc/CrawlChapterContent
                //   chapter; pageFetcher 2 处 0 调用). 后果: admin 任务监控 captchaEncountered
                //   低估 → 操作员无法察觉反爬触发频率 (与 R42-1B BUG-56/60 captcha family
                //   同款潜在不对称, 与 BUG-219/220/230 pageFetcher hostGate 漏调同款 family).
                //   修复: 与外层 4 callsite 同口径补 rt.IncCaptcha (pageRes.CaptchaDetected
                //   → 计数, 不返 err — pageFetcher 仍返 pageRes.HTML 让 ParseToc 解析,
                //   captcha 比 Blocked 软, 不中断翻页; Blocked propagation 由 R101-A
                //   BUG-291 改为返 err break 翻页, captcha 路径不动).
                if res.CaptchaDetected {
                        rt.IncCaptcha()
                }
                if res.Blocked {
                        // R101-A BUG-291 (P2) 修复 (R86-A 未决项 #4 续抓): 原实现
                        //   pageFetcher 多页 TOC 第 2+ 页 Blocked 时仍返 res.HTML
                        //   (looksBlocked interstitial 页), ParseToc line ~2042
                        //   nextPageHTML, err = pageFetcher(...) 收非空 HTML → err==nil
                        //   → 不 break → 继续解析 interstitial 页 → TOC 被反爬挑战页
                        //   文本污染 (e.g. "Just a moment... Checking your browser"
                        //   被当章节标题提取, 写入 Book TocItems). 修复: Blocked 时
                        //   返 error 让 ParseToc break 退出翻页循环 (返已采的部分 TOC,
                        //   与成功首页 + 部分 page 同款 partial result 语义). ParseToc
                        //   line ~2050 `if err != nil || nextPageHTML == "" { break }`
                        //   已正确处理 pageFetcher err (break). 与 BUG-292 (章节正文
                        //   pageFetcher) 同款 Blocked propagation family.
                        GetHostGate().ReportFailure(pageHost)
                        getHealthTracker().recordFailure(pageHost)
                        // R103-A BUG-299: per-task 反爬拦截累计 (mirror IncCaptcha;
                        //   多页 TOC 第 2+ 页 Blocked 也计, 与外层 book/toc 路径同口径).
                        rt.IncBlocked()
                        return "", fmt.Errorf("toc page %s blocked by anti-crawl", truncate(u, 120))
                }
                getHealthTracker().recordSuccess(pageHost)
                GetHostGate().ReportSuccess(pageHost)
                return res.HTML, nil
        }
        toc, err := ParseToc(ctx, tocURL, tocRes.HTML, cfg.Rule.Toc, pageFetcher, nil)
        if err != nil {
                return nil, err
        }
        if len(toc.Items) == 0 {
                return &BookMetaResult{Status: BookMetaStatusEmptyToc, BookURL: bookURL}, nil
        }
        // R70-B 目标C (用户需求 #6 乱序重排): 源站部分 TOC 按 "最新在前" 生成 (整表反转),
        //   直接落库会让用户翻书时第 1 章实为源站末章. NormalizeTocOrder 检测整表反转
        //   (dec 对占比 >= 80%) 并镜像还原. 即便源站顺序正常 (升序, ratio ~0%), 函数
        //   内部短路返原序 (无副作用), 安全默认调用. R70-B BUG-83 (P2) 修复: 原实现
        //   (R67 之前) FinalizeBook 取 TocItems[len-1] 作 latestChapter, 源站反转时末
        //   项是首章 (oldest), 写入 Book.latestChapter 错误 (用户看到 "最新章节: 第1章"
        //   但实际已完结到第N章). 修复: 在 ParseToc 后立即 NormalizeTocOrder 规整顺序,
        //   后续 FinalizeBook latestChapter + main.go getBookViewData 渲染都基于规整
        //   后的顺序. dedupAdjacentSameURL 顺便处理源站翻页边界重复提取的相邻同 URL 项.
        toc.Items = NormalizeTocOrder(toc.Items)
        if len(toc.Items) == 0 {
                // 防御式: NormalizeTocOrder 空数组返 nil, 此处兜底返 EmptyToc (不破坏
                //   下游 bc.TocItems == nil 检查).
                return &BookMetaResult{Status: BookMetaStatusEmptyToc, BookURL: bookURL}, nil
        }

        // R73-C BUG-108: 增量检查 bookLastChapters 已删 (字段+Set+Get 全 cascade deadcode).
        //   原 line 1804 注释 "增量检查: 比较 bookLastChapters (本场景简化, 实际由 wiring 提供)"
        //   暗示未来 wiring, 但 SetBookLastChapter 0 callers 从未接入. 删除后这里仅保留
        //   状态分流 (AddToCompleted / AddToOngoing) 供 Snapshot 计数.
        if detectedStatus == "completed" {
                rt.AddToCompleted(bookURL)
        }

        // 状态分流
        if detectedStatus == "ongoing" {
                rt.AddToOngoing(bookURL)
        }

        // ok 路径: 从 failedBookUrls 删除
        rt.RemoveFromFailed(bookURL)

        // 构建 BookMetaContext
        // R72-C BUG-95 (P3): 删除 idMap 创建 (cascade deadcode, IDMap 字段已删).
        //   原 idMap := map[string]string{} + for-range 填 "" 全程不读, alloc 浪费.
        bookCtx := &BookMetaContext{
                BookID:         bookID,
                BookName:       parsed.Name,
                BookURL:        bookURL,
                TocItems:       toc.Items,
                DetectedStatus: detectedStatus,
                FetchCfg:       cfg.Override,
        }

        // 封面下载 (若有 cover 且 DB 提供 SaveCoverWebp)
        // R67-C BUG-60: coverSaved 跟踪封面是否落盘成功 (供 stats.CoversSaved 累计)
        coverSaved := false
        if parsed.Cover != "" && cfg.DB != nil {
                // R75-C BUG-129 (P3) 修复 (R74-C 交接 #2): cover fetch 漏 rt.CheckBudget +
                //   rt.IncRequest. 原实现 cover FetchPage 直调无预算追踪 (与 R74-C BUG-114 修
                //   复的 toc fetch 同款问题, R74-C 修了 toc 漏 cover). admin 设 maxRequests=100
                //   + 50 本书各 1 cover = 50 隐藏请求, 实际消耗 100 book + 50 cover = 150, 预
                //   算永不触发. 修复: 入口加 CheckBudget (超限返 err 让 phase 1 goroutine 走
                //   AddToFailed 路径, 与 book fetch line 1518 同款) + IncRequest (预算计数 +1,
                //   admin Snapshot.RequestCount 准确反映实际请求量). 注: 不加 hostGate (R76-C
                //   交接 #5 评估: cover 多在 external CDN, 不同 host; 若同 host 则同 host 二次
                //   请求未受 hostGate 速率限制, 但加 hostGate 需 Acquire/Release wiring + cover
                //   fetch 失败时的回退路径, 设计复杂度高于收益, 保守不加, R77+ 若 cover fetch
                //   频繁触发源站频控再评估).
                if err := rt.CheckBudget(); err != nil {
                        return nil, err
                }
                rt.IncRequest()
                // R76-C BUG-115 彻底修复 (R75 交接 #2): 原 FetchPage + []byte(coverRes.HTML)
                //   路径在 fetcher UTF-8 解码时把二进制图像字节中无效 UTF-8 字节 (\xff JPEG /
                //   \x89 PNG 等) 替换为 U+FFFD, 写入 .webp 后字节已损坏, 浏览器 <img> 解码
                //   失败. R74-C BUG-115 加 HTML 错误页检测 (strings.HasPrefix(coverHTML, "<"))
                //   仅是部分缓解 (防 HTML 错误页写入 .webp), 二进制图像字节损坏未根治.
                //   R76-C 改用 FetchBinaryPage 返 raw bytes (无 UTF-8 解码, 保二进制完整) +
                //   looksBlockedBinary 检测 (首字节 < 字符 = HTML 错误页, 与 R74-C 同口径).
                // R105-A BUG-309 (P3) 修复 (深抓 cover fetch 反爬指纹 family): cover
                //   fetch FetchConfig 原硬编码 Referer: false → buildHeaders (line ~3296
                //   if cfg.Referer) 跳过 Referer 段 → 不发 Referer 头 + computeSecFetchSite
                //   (effectiveReferer="", line ~3057) 返 "none" → Sec-Fetch-Site: none.
                //   真实浏览器在书籍详情页加载 <img src=parsed.Cover> 时发 Referer =
                //   <书籍页 URL> (Referrer-Policy 默认 strict-origin-when-cross-origin:
                //   same-origin <img> 发完整 document URL; cross-site <img> 发 origin).
                //   Sec-Fetch-Site 真实值为 same-origin (cover 同域) / cross-site (cover
                //   外部 CDN), 绝非 "none" (none 仅用户输入 URL 顶层导航, <img> subresource
                //   永不 none). 反爬识别 "Sec-Fetch-Site: none + 无 Referer + image/* Accept"
                //   是爬虫指纹 (Chrome <img> 一定发 Referer + Sec-Fetch-Site same/cross,
                //   从不发 none). 后果: cover 同域站 (e.g. 源站 /uploads/cover/xxx.webp
                //   与 book 同 host) cover fetch 暴露非浏览器指纹 → Cloudflare/Bot
                //   Management 把 cover 请求识别为 bot → 后续同 host book/chapter fetch
                //   被关联降权 (cf-bm cookie 联动) → 采集成功率下降. 修复: Referer: true
                //   + RefererURL: bookURL (书籍页 URL, buildHeaders line ~3296 优先用
                //   cfg.RefererURL). computeSecFetchSite 据此算 same-origin / cross-site
                //   (与真实 Chrome <img> 行为一致). 注: cross-site cover 真实浏览器按
                //   strict-origin-when-cross-origin 仅发 origin (scheme://host), 我们发
                //   完整 bookURL — 略 overshare 但远优于不发 (反爬主检 "Referer 存在 +
                //   plausible", 完整 document URL 对 <img> 合理). 完整 Referrer-Policy
                //   downgrade 跨 budget (需 originHost(bookURL)==originHost(cover) 判
                //   + truncate), R106+ 评估.
                // R105-A BUG-310 (P3) 修复 (深抓 cover fetch cookie 对称 family, 与
                //   BUG-309 同 cover FetchConfig): cover fetch FetchConfig 原硬编码
                //   AutoCookie: false → fetchBinaryHttp line ~4536 `if cfg.AutoCookie`
                //   跳过 Store(coverHost, Set-Cookie). buildHeaders line ~3346 仍发
                //   jar cookies (GetWithReferer 不受 AutoCookie gate, cover 同域时发
                //   book fetch 累积的 session cookie), 但 cover 响应的 Set-Cookie
                //   (e.g. Cloudflare cf_clearance refresh / __cf_bm rotation / 源站
                //   session refresh) 被丢弃 → 下次 book/chapter 同 host fetch 用 stale
                //   cookie → cookie 过期后同 host 持续被拦 (与 R85-A BUG-206/207 hostGate
                //   cookie 链不对称 family, 反向: book fetch 存 cookie, cover fetch 丢).
                //   修复: AutoCookie: true (与 DefaultFetchConfig.AutoCookie + book fetch
                //   cfg.Override.AutoCookie 同口径). cover host 多为 external CDN, 存
                //   CDN cookie 到 jar (per-domain 不污染 book host cookie; 后续同 CDN
                //   cover fetch 复用, 降反爬关联识别). 与 BUG-309 同 FetchConfig 改.
                // R106-A BUG-314 (P3) 修复 (深抓 cover fetch posture 继承 family,
                //   与 BUG-309/310 同 cover FetchConfig 续): cover fetch FetchConfig
                //   仍硬编码 Timeout: 15000 / Retries: 1 / UAMode: "rotate" / 无
                //   ProxyURL / 无 JitterMs / 无 CustomUA, 不继承 cfg.Override 的
                //   anti-crawl posture. 后果: cover 同域站 (originHost(parsed.Cover)
                //   == originHost(bookURL), e.g. 源站 /uploads/cover/xxx.webp 与 book
                //   同 host) behind 反爬时, book fetch 用 proxy+jitter+customUA 过,
                //   cover fetch 不继承 → cover fetch 更易被拦 → cover 同 host 反爬
                //   触发后下次 book fetch 关联降权 (与 BUG-309 漏 Referer + BUG-310
                //   漏 AutoCookie 同款 "cover fetch posture 漏" family). 外部 CDN
                //   cover (originHost 不同) 多不需继承 (CDN 不反爬, 加 book proxy 反
                //   致 CDN 流量经代理变慢). 修复: coverSameHost := originHost(parsed.
                //   Cover) == originHost(bookURL) (与 R105-A BUG-309 同 originHost
                //   posture family). coverSameHost=true 时继承 cfg.Override 的 Timeout
                //   (>0) / Retries (>0) / UAMode (!="") / JitterMs (>0) / ProxyURL
                //   (!="") / CustomUA (!="") (与 mergeFetchConfig 同款 "非零/非空
                //   覆盖" gate, 防 0 值覆盖默认). false 时 (外部 CDN) 保留原硬编码值
                //   (与 R76-C design choice "保守不加 hostGate" 同款).
                coverSameHost := originHost(parsed.Cover) == originHost(bookURL)
                coverCfg := FetchConfig{
                        Engine:     "http",
                        UAMode:     "rotate",
                        AutoCookie: true,
                        Referer:    true,
                        RefererURL: bookURL,
                        Timeout:    15000,
                        Retries:    1,
                }
                if coverSameHost {
                        if cfg.Override.Timeout > 0 {
                                coverCfg.Timeout = cfg.Override.Timeout
                        }
                        if cfg.Override.Retries > 0 {
                                coverCfg.Retries = cfg.Override.Retries
                        }
                        if cfg.Override.UAMode != "" {
                                coverCfg.UAMode = cfg.Override.UAMode
                        }
                        if cfg.Override.JitterMs > 0 {
                                coverCfg.JitterMs = cfg.Override.JitterMs
                        }
                        if cfg.Override.ProxyURL != "" {
                                coverCfg.ProxyURL = cfg.Override.ProxyURL
                        }
                        if cfg.Override.CustomUA != "" {
                                coverCfg.CustomUA = cfg.Override.CustomUA
                        }
                }
                coverBin, err := FetchBinaryPage(ctx, parsed.Cover, coverCfg)
                if err == nil && !coverBin.Blocked && len(coverBin.Bytes) > 0 {
                        if rel, err := SaveCoverWebp(coverBin.Bytes, bookID); err == nil && rel != "" {
                                _ = cfg.DB.UpdateBookCover(bookID, rel)
                                coverSaved = true
                        }
                }
                // R103-A BUG-299: cover fetch 返 HTML 错误页 (looksBlockedBinary 命中
                //   首字节 <, e.g. Cloudflare challenge / 404 HTML 页当 cover URL)
                //   时 coverBin.Blocked=true, coverSaved=false (静默跳过). 与外层
                //   book/toc/pageFetcher 4 Blocked 路径同口径补 rt.IncBlocked()
                //   (mirror IncCaptcha; cover host 多为 external CDN, 与 bookHost
                //   不同, 不调 hostGate/health — 与 R76-C design choice line ~2159
                //   "保守不加 hostGate" 一致, 仅 counter 层补).
                if err == nil && coverBin.Blocked {
                        rt.IncBlocked()
                }
        }

        return &BookMetaResult{
                Status:     BookMetaStatusOKMeta,
                BookURL:    bookURL,
                BookCtx:    bookCtx,
                IsNewBook:  isNewBook,
                CoverSaved: coverSaved,
        }, nil
}

// ---------- CrawlChapterContent (阶段 2) ----------

// CrawlChapterContent — 阶段 2: 单章正文采集.
// 返回 (ok, kind, message, cleaned). kind: "" | "no-url" | "timeout" | "abort" |
//   "hostgate" | "blocked" | "other"
//   cleaned: 成功路径返清洗后正文 (供 caller 测试用 snippet, e.g. FetchTestSampleBook);
//   失败路径返 "". phase 2 生产 caller (line ~1327) 用 _ 丢弃.
//
// R98-A BUG-279 (P3) 修复 (R82-D BUG-185 诚实留痕续): 原签名 (bool, string, string)
//   成功路径已算 cleaned (line ~2293-2318, 含清洗 + 干扰句子插入) 但未返 caller
//   → FetchTestSampleBook (line ~2744) 用 "<已采>" 占位作 snippet, admin 试采页面
//   无法看到真实正文前 120 字. 修复: 扩 4th 返 cleaned 字符串 (ok=true 路径返 cleaned,
//   ok=false 路径返 "" 仅 1 行 line 2361 `return true, "", ""` → `return true, "", "", cleaned`).
//   12 处失败路径 return 加 `, ""` 第 4 参数 (无语义变化, caller 失败路径不读 cleaned).
//   与 R67-C BUG-60 (BookMetaResult 加 IsNewBook/CoverSaved 字段供 stats 累计) 同款 "加
//   返字段供 caller 用" precedent.
//
// R43-1B 反反爬增强 + 边缘 case 修复:
//   - HTTPError 429 / 503+RetryAfter → hostGate.ReportRateLimited (R42-1B 后该函数
//     是死代码, 429 冷却从未触发, 反爬服务持续命中后续请求)
//   - FetchResult.CaptchaDetected → rt.IncCaptcha (R42-1B 后 captchaEncountered 字段
//     是死字段, admin 任务监控永远显示 0)
func CrawlChapterContent(ctx context.Context, cfg ExecuteTaskConfig, rt *TaskRuntime, myEpoch int64, q *ChapterTask) (bool, string, string, string) {
        // R80-B BUG-177 (P3) 修复: defense-in-depth nil 检查.
        //   当前 caller (runner.go phase 2 goroutine line 1270) 总是非 nil 构造 ChapterTask
        //   (line 1177-1184 字面量, BookCtx 来自 r.BookCtx 已 nil 检查 line 1168 if r.BookCtx != nil),
        //   但公开 API 可能被外部 caller (admin retry-failed 测试 / 未来 R81+ wiring) 误传 nil q
        //   或 nil q.BookCtx. 原 line 1946 `q.URL` 在 q nil 时 panic; line 1972 `q.BookCtx.FetchCfg`
        //   在 q.BookCtx nil 时 panic. 防御: 入口加 nil 检查 + 返 "no-url" sentinel (caller
        //   按 "no-url" 处理 — 计 stats.Errors + log + 跳过该章, 不死 goroutine).
        if q == nil {
                return false, "no-url", "ChapterTask nil", ""
        }
        if q.URL == "" {
                return false, "no-url", "", ""
        }
        if q.BookCtx == nil {
                return false, "no-url", "ChapterTask.BookCtx nil", ""
        }
        // 预算检查
        if err := rt.CheckBudget(); err != nil {
                // BudgetExceeded 上抛任务级 (返回 other 让上层处理)
                return false, "other", err.Error(), ""
        }
        rt.IncRequest()
        rt.SetCurrentURL(q.URL)

        // 过闸 hostGate (同 host 并发 + 速率限制)
        hostGate := GetHostGate()
        ticket, err := hostGate.Acquire(ctx, q.URL, cfg.Override.HostGateLimit, HostGateWaitTimeoutMs, cfg.Override.PerHostConcurrency)
        if err != nil {
                // 槽满等待超时 → hostgate 路径
                return false, "hostgate", fmt.Sprintf("书籍采集等待同站并发闸门超时 (host:%s): %s", HostGateKeyOf(q.URL), truncate(q.URL, 120)), ""
        }
        defer hostGate.Release(ticket)

        // 抓章节页
        // R65-C: 接 R64-B AdjustMinGap (B3) + hostHealthTracker (与 CrawlBookMeta 同款,
        //   测 HTTP round-trip 延迟 → hostgate.AdjustMinGap + healthTracker 记 latency/
        //   success/failure. 延迟仅含 fetch HTTP 耗时, 不含 cleaner/parser/DB I/O.)
        chapterHost := HostGateKeyOf(q.URL)
        chapterFetchStart := time.Now()
        res, err := FetchPage(ctx, q.URL, mergeFetchConfig(q.BookCtx.FetchCfg, FetchConfig{RequestPriority: "chapter"}))
        chapterLatencyMs := time.Since(chapterFetchStart).Milliseconds()
        if err != nil {
                if ctx.Err() != nil {
                        // R65-C: ctx 取消不计失败 (操作员主动停止, 非 host 健康问题)
                        return false, "abort", "", ""
                }
                // R43-1B: HTTPError 429 / 503+RetryAfter → 调 ReportRateLimited (R42-1B 后
                // 该函数是死代码, 反爬 429 冷却从未触发). 其它网络层错误仍调 ReportFailure.
                // R74-C BUG-111 (P3): err.(*HTTPError) → errors.As (与书籍页/toc 页路径同口径).
                var he *HTTPError
                if errors.As(err, &he) && (he.StatusCode == 429 || he.StatusCode == 503) && he.RetryAfterMs > 0 {
                        hostGate.ReportRateLimited(chapterHost, he.RetryAfterMs)
                }
                // 分类错误
                errStr := err.Error()
                if strings.Contains(errStr, "timeout") || strings.Contains(errStr, "context deadline exceeded") {
                        hostGate.ReportFailure(chapterHost)
                        // R65-C: 超时计 per-host 失败 (health 降 → AdjustConcurrency 减并发)
                        getHealthTracker().recordFailure(chapterHost)
                        return false, "timeout", fmt.Sprintf("章节抓取超时: %s", truncate(q.URL, 120)), ""
                }
                hostGate.ReportFailure(chapterHost)
                // R65-C: 其它错误计 per-host 失败
                getHealthTracker().recordFailure(chapterHost)
                return false, "other", fmt.Sprintf("章节采集失败 %s: %s", q.Title, truncate(errStr, 120)), ""
        }
        // R67-C BUG-56 (P2) 修复: 同 CrawlBookMeta 路径, recordSuccess +
        //   ReportSuccess 移到 Blocked 检查后避免双计数. recordLatency + AdjustMinGap
        //   保留在前 (HTTP 响应延迟有效, 无论是否 Blocked).
        getHealthTracker().recordLatency(chapterHost, chapterLatencyMs)
        hostGate.AdjustMinGap(chapterHost, chapterLatencyMs)

        // R43-1B: 命中验证码 → 累计 captchaEncountered (R42-1B 后该字段是死字段,
        // admin 任务监控 captchaEncountered 永远显示 0, 操作员无法察觉反爬触发频率)
        if res.CaptchaDetected {
                rt.IncCaptcha()
        }

        if res.Blocked {
                hostGate.ReportFailure(chapterHost)
                // R65-C: 拦截视为失败, 计 per-host 失败
                getHealthTracker().recordFailure(chapterHost)
                // R103-A BUG-299: per-task 反爬拦截累计 (mirror IncCaptcha; 章节首页
                //   Blocked 也计, 与 list/book/toc/pageFetcher 路径同口径).
                rt.IncBlocked()
                // R102-A BUG-295 (P3) 修复 (R101-A BUG-290/291/292 Blocked family 续):
                //   原实现章节首页 Blocked 返 kind="other" + msg="章节内容疑似被拦截:
                //   <url>", 与书籍页 Blocked (CrawlBookMeta line ~1749 返 BookMeta
                //   StatusBlocked) 不对称 — FetchTestSampleBook line ~2820 把书籍页
                //   Blocked 映射为 Status="blocked", 但章节页 Blocked 走 kind="other"
                //   路径被 line ~2853 映射为 Status="failed" (语义错配: Blocked 应
                //   "blocked" 而非 "failed", 操作员试采看到 "failed" 误判为配置/网络
                //   错而非反爬拦). 修复: kind "other" → "blocked" (新增 kind 值, 与
                //   BUG-290 sentinel + BUG-291/292 pageFetcher Blocked propagation 同
                //   family). phase 2 switch (line ~1387) 加 "blocked" case (与 "other"
                //   同口径 stats.Errors++ + consecutiveErrs++ + LogError, 不走
                //   BudgetExceeded 检查 — Blocked 非 budget 信号). FetchTestSampleBook
                //   line ~2853 把 kind="blocked" 映射为 Status="blocked" (与书籍页
                //   Blocked 同口径). captcha 路径不动 (captcha 走 res.CaptchaDetected,
                //   非 res.Blocked 分支). 与 BUG-292 (pageFetcher 章节正文翻页 Blocked
                //   propagation) 互补: BUG-292 修章节正文翻页 page 2+ Blocked, 本
                //   BUG-295 修章节首页 Blocked kind 语义.
                return false, "blocked", fmt.Sprintf("章节内容疑似被拦截: %s", truncate(q.URL, 120)), ""
        }
        // 成功 (HTTP 200 + 非 Blocked): 记 success + ReportSuccess
        getHealthTracker().recordSuccess(chapterHost)
        hostGate.ReportSuccess(chapterHost)

        // 解析正文 (parseContent 含翻页合并)
        pageFetcher := func(ctx context.Context, u, refererURL string) (string, error) {
                // R84-A BUG-201 (P2) 修复: 章节正文翻页补 rt.CheckBudget + rt.IncRequest
                //   (与 CrawlBookMeta pageFetcher 同款). 多页章节 (N 页) 消耗 N HTTP 请求
                //   但 entry-level IncRequest 只 1 次. 修复后预算准确, BudgetExceeded 触发
                //   后 ParseContent 收到 pageFetcher err → break 退出翻页 (返已采的部分
                //   正文). 注: 部分 TOC/正文返空时 caller 走 "other" 错误路径, 不死 goroutine.
                if err := rt.CheckBudget(); err != nil {
                        return "", err
                }
                rt.IncRequest()
                // R87-A BUG-230 (P3) 修复 (与 CrawlBookMeta pageFetcher 同款): 章节正文
                //   翻页成功路径原仅 return pageRes.HTML, 漏调 hostGate/health 4 调用,
                //   与外层 chapter fetch (line ~2144-2161) + R86-A BUG-220 err 路径不对称.
                //   多页章节第 2+ 页成功不计 → healthTracker successRate 低估 → 降并发;
                //   hostGate failStreak 间歇页失败只增不减 → derate 误触发. 补 timing +
                //   4 调用 (hostGate 变量在 line ~2100 外层已声明, 此 closure 共享, 与
                //   err 路径同款用 hostGate 而非 GetHostGate()).
                pageFetchStart := time.Now()
                pageRes, err := FetchPage(ctx, u, mergeFetchConfig(q.BookCtx.FetchCfg, FetchConfig{
                        RefererChain:    q.BookCtx.FetchCfg.RefererChain,
                        RefererURL:      refererURL,
                        RequestPriority: "chapter",
                }))
                if err != nil {
                        // R86-A BUG-220 (P3) 修复 (R85-A BUG-207 discoverBooks 同款遗漏):
                        //   pageFetcher err 路径漏调 hostGate reporting. 多页章节第 2+ 页
                        //   429/timeout 不触发 hostGate derate → 后续章节同 host 仍按原
                        //   间隔发, 持续 429 频控. 与外层 chapter fetch (line ~2082-2106 同款
                        //   ReportFailure + recordFailure + ReportRateLimited) 对称补 err
                        //   路径 — 此处比 CrawlBookMeta pageFetcher 更严: chapter 外层 err
                        //   路径调 ReportFailure (line ~2097/2102), 故 pageFetcher 同口径
                        //   补 ReportFailure (transient timeout 也可触发 derate, 与外层一致).
                        //   ctx 取消不计失败 (操作员主动停止); BudgetExceeded 在 line 2170
                        //   已先返, 不到此. hostGate 变量在 line ~2102 (CrawlChapterContent
                        //   外层) 已声明, 此 closure 共享.
                        if ctx.Err() == nil {
                                pageHost := HostGateKeyOf(u)
                                var he *HTTPError
                                if errors.As(err, &he) && (he.StatusCode == 429 || he.StatusCode == 503) && he.RetryAfterMs > 0 {
                                        hostGate.ReportRateLimited(pageHost, he.RetryAfterMs)
                                }
                                hostGate.ReportFailure(pageHost)
                                getHealthTracker().recordFailure(pageHost)
                        }
                        return "", err
                }
                // R87-A BUG-230: 成功路径补 hostGate/health 报告 (与外层 chapter fetch 对称).
                pageHost := HostGateKeyOf(u)
                pageLatencyMs := time.Since(pageFetchStart).Milliseconds()
                getHealthTracker().recordLatency(pageHost, pageLatencyMs)
                hostGate.AdjustMinGap(pageHost, pageLatencyMs)
                // R91-A BUG-252 (P3): 章节正文 pageFetcher 同款补 rt.IncCaptcha
                //   (详见 CrawlBookMeta pageFetcher line ~1975 注释; 多页章节第 2+
                //   页命中 captcha 同款 admin stats 低估问题).
                if pageRes.CaptchaDetected {
                        rt.IncCaptcha()
                }
                if pageRes.Blocked {
                        // R101-A BUG-292 (P2) 修复 (R86-A 未决项 #4 续抓, 与 BUG-291
                        //   CrawlBookMeta pageFetcher 同款 Blocked propagation family):
                        //   原实现多页章节正文第 2+ 页 Blocked 时仍返 pageRes.HTML
                        //   (interstitial 页), ParseContent line ~2245 收非空 HTML →
                        //   err==nil → 不 break → 继续解析 interstitial 页 → 章节正文
                        //   被反爬挑战页文本污染 (e.g. "Just a moment... Checking your
                        //   browser" 被当正文段落提取, 落库 UpsertChapter 写入污染正文).
                        //   修复: Blocked 时返 error 让 ParseContent break 退出翻页循环
                        //   (返已采的部分正文, 与成功首页 + 部分 page 同款 partial result
                        //   语义 — partial 干净正文 > 完整污染正文). ParseContent line
                        //   ~2253 `if err != nil || nextPageHTML == "" { break }` 已正确
                        //   处理 pageFetcher err (break).
                        hostGate.ReportFailure(pageHost)
                        getHealthTracker().recordFailure(pageHost)
                        // R103-A BUG-299: per-task 反爬拦截累计 (mirror IncCaptcha;
                        //   多页章节正文第 2+ 页 Blocked 也计, 与 BUG-292 同口径).
                        rt.IncBlocked()
                        return "", fmt.Errorf("content page %s blocked by anti-crawl", truncate(u, 120))
                }
                getHealthTracker().recordSuccess(pageHost)
                hostGate.ReportSuccess(pageHost)
                return pageRes.HTML, nil
        }
        content, err := ParseContent(ctx, q.URL, res.HTML, cfg.Rule.Content, cfg.Override, pageFetcher)
        if err != nil {
                return false, "other", fmt.Sprintf("章节正文解析失败 %s: %v", q.Title, err), ""
        }

        // 清洗正文 (含 trafilatura 桥)
        cleaned := ""
        if cfg.Rule.Clean.UseTrafilatura {
                cleaned = CleanContentHtmlWithTrafilatura(ctx, content.Content, &cfg.Rule.Clean, cfg.Override.TrafilaturaBridgeURL)
        } else {
                cleaned = CleanContentHtml(content.Content, &cfg.Rule.Clean)
        }
        // trafilatura 兜底模式
        if cfg.Rule.Clean.TrafilaturaFallback {
                cleaned = TryTrafilaturaFallback(ctx, content.Content, cleaned, cfg.Rule.Clean, cfg.Override.TrafilaturaBridgeURL)
        }
        // R70-B 目标A (用户需求 #3 干扰接入): 在所有清洗链 (CleanContentHtml /
        //   CleanContentHtmlWithTrafilatura / TryTrafilaturaFallback) 完成后,
        //   落库前应用干扰句子插入. R69-B 加 InterfereConfig + applyInterference 私有
        //   helper + ApplyInterferenceToCleaned 公开 API (R82-C BUG-189 删 0-caller 13 轮
        //   未 wire 的 CleanContentHtmlWithInterference + InjectInterferenceSentences 2
        //   exported wrapper, cleaner.go). 接入: cfg.Rule.Clean.Interfere + Seed =
        //   bookID + ":" + chapterID (空时用 q.URL). Enabled=false 短路返原 cleaned.
        if cfg.Rule.Clean.Interfere.Enabled {
                chSeed := q.ChID
                if chSeed == "" {
                        chSeed = q.URL
                }
                interfereCfg := cfg.Rule.Clean.Interfere
                interfereCfg.Seed = q.BookCtx.BookID + ":" + chSeed
                cleaned = ApplyInterferenceToCleaned(cleaned, interfereCfg)
        }

        if cleaned == "" {
                return false, "other", fmt.Sprintf("章节正文为空: %s", q.Title), ""
        }

        // 落库 (UpsertChapter)
        if cfg.DB != nil {
                ch := Chapter{
                        BookID:    q.BookCtx.BookID,
                        Title:     CleanTextField(q.Title, 200),
                        Content:   cleaned,
                        Idx:       q.Idx,
                        Volume:    q.Volume,
                        SourceURL: q.URL,
                        Fetched:   true,
                        UpdatedAt: time.Now(),
                }
                if q.ChID != "" {
                        ch.ID = q.ChID
                }
                // R72-C BUG-95 (P3): 删除 IDMap lookup (cascade deadcode, IDMap 字段已删).
                //   原 `else if id, ok := q.BookCtx.IDMap[q.URL]; ok && id != "" { ch.ID = id }`
                //   分支恒不命中 (IDMap[url] 永远是 "", `&& id != ""` 永远 false), 删除.
                _, err := cfg.DB.UpsertChapter(ch)
                if err != nil {
                        return false, "other", fmt.Sprintf("章节入库失败 %s: %v", q.Title, err), ""
                }
        }

        // 累计字节
        rt.IncBytes(int64(len(cleaned)))

        // R68-C 目标C: 累计 ParsedWordCount (rune 数) — 供 phase 3 FinalizeBook 写 Book.WordCount
        //   (R67-C 未决项 3 报告 ParsedWordCount 从未设置 → Book.WordCount 恒 0).
        //   多 goroutine 并发写同一 BookCtx.ParsedWordCount (同书多章 phase 2 并发) → 用
        //   atomic.AddInt64 (与 MarkRunning/IncRequest/IncCaptcha 同口径, 无锁并发安全).
        //   phase 2 wg.Wait() 建立 happens-before → phase 3 FinalizeBook 可安全读 (atomic.LoadInt64).
        //   限制: incremental recrawl 场景下 ParsedWordCount 仅含本轮新采章节字数, 非 DB 全章
        //   节总和 (R67-C 建议的 DB 聚合路径 SUM(LENGTH(content)) FROM Chapter WHERE bookId=?
        //   需扩 DBClient 接口 + admin.go wiring, 范围外, 留 R69+).
        atomic.AddInt64(&q.BookCtx.ParsedWordCount, int64(utf8.RuneCountInString(cleaned)))

        return true, "", "", cleaned
}

// ---------- FinalizeBook (阶段 3) ----------

// FinalizeBook — 阶段 3: 单本书收尾 (统计 + 状态分流 + latestChapter).
//
// R68-C 目标B (R67 交接 #5) 签名精简: 删 4 个未用参数 (ctx / myEpoch / bookDone / stats).
//
//      原签名 FinalizeBook(ctx, cfg, rt, myEpoch, bc, bookDone, stats, progress) 中 ctx/myEpoch/
//      bookDone/stats 4 参数函数体从未引用 (仅 cfg + bc + rt + progress 被用). 调用点同步精简.
//      bookDone 在 R67-C 前用于占位 "未来 wiring 增量统计", 但 stats.ChaptersCreated/Updated
//      在 phase 2 goroutine 内累计 (与 bookDone 路径无关), 故 bookDone 全程 0 调用 → 删.
//      同步删 ExecuteTask 内 bookDoneMap (init/increment/read 全 0 外部消费, cascade deadcode).
func FinalizeBook(cfg ExecuteTaskConfig, rt *TaskRuntime, bc *BookMetaContext, progress *TaskProgress) error {
        // 更新书籍 wordCount / latestChapter
        if cfg.DB != nil && bc.BookID != "" {
                // R68-C 目标C: ParsedWordCount 在 CrawlChapterContent 内 atomic.AddInt64 累计
                //   (本轮 crawl 章节字数总和, rune 数). phase 2 wg.Wait() 建立 happens-before,
                //   此处 atomic.LoadInt64 安全读最新值. 限制: incremental recrawl 仅含本轮
                //   新采章节字数 (非 DB 全章节总和), 详见 CrawlChapterContent 注释.
                wordCount := atomic.LoadInt64(&bc.ParsedWordCount)
                if wordCount > 0 {
                        _ = cfg.DB.UpdateBookWordCount(bc.BookID, wordCount)
                }
                // 状态分流
                if bc.DetectedStatus != "unknown" {
                        _ = cfg.DB.UpdateBookStatus(bc.BookID, bc.DetectedStatus)
                }
                // latestChapter (取 toc 末章标题, 番外/楔子等特殊章节时 fallback 到最后一个有编号的章)
                //
                // R72-C BUG-96 (P3) 修复 (R71 交接 #2): 原实现无条件取 TocItems[len-1].Title 作
                //   latestChapter. 源站 TOC 末项是番外/楔子/序章/尾声/后记/前言/引子等特殊章节时
                //   (e.g. "番外: 主角的婚礼" / "楔子" / "后记"), 写入 Book.latestChapter 误导用户
                //   ("最新章节: 番外: 主角的婚礼" 实际正文最新是第N章正文). 修复: 末项通过
                //   extractChapterNumber 提取失败 (无编号 = 特殊章节) 时, 向前扫找最后一个有编号
                //   的章节作 latestChapter. 全部无编号 (e.g. 短篇/无标准章节编号的小说) 时回退
                //   原末项标题 (与原行为一致). 使用 sorter.go extractChapterNumber (同包可见).
                if len(bc.TocItems) > 0 {
                        latest := bc.TocItems[len(bc.TocItems)-1].Title
                        if _, ok := extractChapterNumber(latest); !ok {
                                // 末项无编号 (特殊章节), 向前扫找最后一个有编号的章
                                for i := len(bc.TocItems) - 2; i >= 0; i-- {
                                        if _, ok2 := extractChapterNumber(bc.TocItems[i].Title); ok2 {
                                                latest = bc.TocItems[i].Title
                                                break
                                        }
                                }
                                // 全部无编号 → 回退原末项 (与原行为一致, 不破坏短篇/特殊章节书)
                        }
                        _ = cfg.DB.UpdateBookLatestChapter(bc.BookID, latest)
                }
        }

        // ok 路径: 从 failedBookUrls 删除
        rt.RemoveFromFailed(bc.BookURL)

        // booksDone++
        progress.BooksDone++
        return nil
}

// ---------- 工具 ----------

// truncate — 截断字符串到指定长度 (按 rune, 防中文 UTF-8 多字节字符被斩半).
// R42-1B: 原实现按字节截断 s[:n], 对中文标题会留下非法 UTF-8 (代理对/多字节字符斩半),
//
//      导致 log 输出乱码 + 部分下游 utf8.Valid 校验失败. 改用 utf8.RuneCountInString +
//      []rune 安全截断.
func truncate(s string, n int) string {
        if n <= 0 {
                return ""
        }
        if len(s) <= n {
                return s
        }
        r := []rune(s)
        if len(r) <= n {
                return s
        }
        return string(r[:n])
}

// ---------- R79-B 目标 A: 任务重试逻辑 (失败 Rule 自动重试 + 指数退避) ----------
//
// 任务要求: "runner.go 加任务重试逻辑 (失败 Rule 自动重试 3 次 + 指数退避)".
//
// 71 Rule 中 partial/empty 的部分原因是瞬态失败 (网络抖动 / 429 限流 / 源站临时 5xx /
//   TLS 握手偶发 fail). 单次 ExecuteTask 失败后整任务停 → 用户重跑 / 跳过. 重试逻辑
//   让瞬态失败经指数退避后重试, 提升任务完成率.
//
// 重试策略:
//   - 终态错误 (BudgetExceeded / CircuitBreak / ctx cancel): 不重试, 直接返
//     (BudgetExceeded 是预算耗尽, 重试无意义; CircuitBreak 是源站熔断, 重试会
//     加重源站压力; ctx cancel 是 caller 主动取消).
//   - 瞬态错误 (网络层 / TLS / HTTP 5xx / 数据库暂时故障): 重试, 指数退避
//     baseBackoffMs * 2^attempt (1s → 2s → 4s), cap 30s 防单次重试等太久.
//   - maxRetries=3 (4 次总执行, 与任务要求一致). maxRetries=0 → 直接 ExecuteTask (无重试).
//   - baseBackoffMs=1000 (默认 1s, R80-B 目标A 调整 — 任务 spec "1s/2s/4s".
//     R79-B 原默认 2000ms 2s, R80-B 改为 1000ms 1s 与 task spec 完全匹配).
//
// 价值: 14 partial Rule 中, 瞬态失败经重试可成功完成 → partial → complete.
//   14 empty Rule 中, 源站持续不可达的重试仍失败 (源站可达性是 R80 人工验证范畴,
//   本函数仅增强瞬态失败容错).
//
// caller: admin.go startCrawlTask 在启动任务前调本函数 (替代直接 ExecuteTask),
//   或调 ExecuteTaskGuarded (R80-B 容错链路兜底, 内部调本函数):
//     err := crawl.ExecuteTaskWithRetry(ctx, cfg, 3, 1000)
//   admin.go 范围外, R79-B 仅提供 API, 不改 admin.go wiring. R80-B 加 ExecuteTaskGuarded
//   wrapper (同 runner.go 内, 范围内) 整合 ApplySmartRuleFallback + PrecheckSourceReachable
//   + 本函数, 供 admin.go 一次性调 ExecuteTaskGuarded 完成全容错链路.

// ExecuteTaskWithRetry — 包装 ExecuteTask 加入重试逻辑 (R79-B 目标 A).
//
//      失败 (非 BudgetExceeded / 非 CircuitBreak / 非 ctx cancel) 自动重试 maxRetries 次,
//      指数退避: 第 1 次重试等 baseBackoffMs, 第 2 次 2×, 第 3 次 4× (cap 30s).
//      maxRetries=0 → 直接 ExecuteTask (无重试).
//      baseBackoffMs<=0 → 默认 1000ms (R80-B: 1s 基线, 与 task spec "1s/2s/4s" 一致;
//        R79-B 原默认 2000ms 2s, R80-B 调整为 1000ms 1s).
//      return: 最后一次 ExecuteTask 返的 err (成功时返 nil).
func ExecuteTaskWithRetry(ctx context.Context, cfg ExecuteTaskConfig, maxRetries int, baseBackoffMs int) error {
        if maxRetries < 0 {
                maxRetries = 0
        }
        if baseBackoffMs <= 0 {
                baseBackoffMs = 1000
        }
        var lastErr error
        for attempt := 0; attempt <= maxRetries; attempt++ {
                // 每轮重试前检查 ctx (caller 取消 / 超时 → 不重试)
                if err := ctx.Err(); err != nil {
                        if lastErr != nil {
                                return fmt.Errorf("ExecuteTaskWithRetry: %w (前次错误: %v)", err, lastErr)
                        }
                        return err
                }
                err := ExecuteTask(ctx, cfg)
                if err == nil {
                        return nil
                }
                lastErr = err
                // 终态错误: 不重试直接返
                //   BudgetExceeded: 单任务请求预算耗尽, 重试会再耗一次预算 (cfg.MaxRequests)
                //   CircuitBreak: 连续错误熔断, 重试会加重源站压力 + 触发 IP 封禁
                //   ctx.Canceled / ctx.DeadlineExceeded: caller 主动取消 / 已超时, 重试延长生命周期
                if IsBudgetExceeded(err) || IsCircuitBreak(err) {
                        return err
                }
                if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
                        return err
                }
                // 最后一次 attempt 失败: 不重试, 直接返
                if attempt == maxRetries {
                        return err
                }
                // 指数退避: baseBackoffMs * 2^attempt (2s → 4s → 8s → 16s, cap 30s)
                // R79-B BUG-164 (P3) 修复: shift count overflow 防御. Go spec: shift count >= bit
                //   size 返 0 (无 backoff 立即重试). maxRetries 3 时无影响 (shift 0/1/2/3 安全),
                //   但 maxRetries > 30 时 attempt=31+ 会触发 shift 0 → 立即重试无退避, 加重源站
                //   压力. 防御: 显式 clamp shift 在 30 (2^30 = 1B ms = ~12 天, 已远超 30s cap).
                // R99-A BUG-285 (P3) 修复 (R98-A 未决项 #3 续): `baseBackoffMs<<shift` 在
                //   32-bit 平台 int=32 时若 shift=30 + baseBackoffMs=1000 → 1e12 超过
                //   MaxInt32 (2.1e9) → 溢出返负值 → time.Duration(负值) * time.Millisecond
                //   仍负 → `backoff > 30s` 不触发 → time.After(负值) 立即返 → 无退避立即
                //   重试 (同 BUG-281/284 立即重试无退避 family). 64-bit Linux int=64 无
                //   问题 (1e12 < MaxInt64 9.2e18). 防御: int64(baseBackoffMs)<<shift 先
                //   提升到 int64 再移位 (32-bit 平台也安全), 并加 `backoff < 0` 兜底防御
                //   (若 baseBackoffMs 极大值使 int64 移位也溢出 → 负值 → 钳 30s cap).
                shift := uint(attempt)
                if shift > 30 {
                        shift = 30
                }
                backoff := time.Duration(int64(baseBackoffMs)<<shift) * time.Millisecond
                if backoff > 30*time.Second || backoff < 0 {
                        backoff = 30 * time.Second
                }
                // 等待期间监听 ctx 取消 (caller 可中断重试)
                select {
                case <-time.After(backoff):
                case <-ctx.Done():
                        return ctx.Err()
                }
        }
        return lastErr
}

// ---------- R80-B 目标 A: 容错链路兜底 (ApplySmartRuleFallback + PrecheckSourceReachable + ExecuteTaskWithRetry 整合) ----------
//
// 任务 spec: "runner.go 加任务重试逻辑 + fetcher.go 加源站可达性预检 + smart.go 加智能规则适配".
//   R79-B 已分别实现三个独立函数 (ApplySmartRuleFallback / PrecheckSourceReachable /
//   ExecuteTaskWithRetry) 但留 0 caller (R79-B 范围内, admin.go 范围外不可改 wiring).
//
// R80-B 在 runner.go 内加 ExecuteTaskGuarded wrapper, 把三个函数串成完整容错链路:
//   1. ApplySmartRuleFallback(&cfg.Rule) — Rule 字段缺失时填通用 fallback (List/Book/
//      Toc/Content 四段). 14 empty Rule 选择器错误可走 fallback 完成基础采集.
//   2. PrecheckSourceReachable(ctx, primaryURL, cfg.Override) — HEAD 请求测源站可达性
//      (5s 超时, GET fallback, SSRF 守卫). 不可达返 sentinel error, caller 跳过任务 + log warn.
//   3. ExecuteTaskWithRetry(ctx, cfg, 3, 1000) — 3 次重试 + 指数退避 1s/2s/4s (cap 30s),
//      终态错误 (BudgetExceeded/CircuitBreak/ctx cancel) 不重试. 瞬态错误重试提升完成率.
//
// primaryURL 选择:
//   - retry-failed 模式 (cfg.Override.URLs 非空): 取 URLs[0] (任务首 URL, 预检代表性最好).
//   - list 发现模式 (cfg.Rule.List.URLTemplate 非空): 取 URLTemplate 替换 {page} 占位为 1
//     (列表首页, 与 discoverBooks line 1485 同款占位替换).
//   - 两者都空 (理论不可达, ExecuteTask 内部会返 "no books to crawl" 错): 跳过预检直接调
//     ExecuteTaskWithRetry (预检无意义, 让 ExecuteTask 自身的错误返).
//
// 不可达返 ErrSourceUnreachable sentinel error, admin.go 可用 errors.Is 判断后跳过任务 +
// log warn (而非 retry 走 ExecuteTaskWithRetry 4 次浪费采集预算). 但 ExecuteTaskGuarded
// 不自己跳过任务 (返 err 让 caller 决策, admin.go 可选 "skip + log" 或 "ignore + retry").
//
// 价值: 14 empty Rule 中源站持续不可达 (DNS/TLS/5xx) 的快速跳过避免浪费 maxRequests
//   预算 + 采集时间. 14 partial Rule 中瞬态失败经重试可成功完成. ApplySmartRuleFallback
//   让选择器配置错误的 Rule 也能走通用 fallback 完成基础采集.
//
// 范围控制: 不改 admin.go (范围外). ExecuteTaskGuarded 是 runner.go 内的新 wrapper,
//   admin.go startCrawlTask 可选调 (替代直接 ExecuteTask, 加全容错链路). 当前 0 caller
//   (admin.go 范围外), R80-B 仅提供 API + lint:ignore U1000 防 staticcheck 报 unused.

// ErrSourceUnreachable — PrecheckSourceReachable 不可达时 ExecuteTaskGuarded 返的 sentinel.
//
//      admin.go 可用 errors.Is(err, crawl.ErrSourceUnreachable) 判断后跳过任务 + log warn
//      (而非 retry). 含原始 reason 字符串 (e.g. "HTTP 503 (源站 5xx, 不可达)").
type ErrSourceUnreachable struct {
        Reason string
}

func (e *ErrSourceUnreachable) Error() string {
        return "source unreachable: " + e.Reason
}

// pickPrecheckURL — 从 ExecuteTaskConfig 选预检主 URL (R80-B ExecuteTaskGuarded 内部用).
//
//      返 "" 表示无可预检 URL (走 ExecuteTaskWithRetry 不预检, 让 ExecuteTask 自身错误兜底).
//      retry-failed 模式 (cfg.Override.URLs 非空): URLs[0] (任务首 URL).
//      list 发现模式: cfg.Rule.List.URLTemplate 替换 {page} 占位为 "1" (列表首页).
//      注: 不剥 query (源站可达性预检用主 URL 即可, query 不影响 DNS/TLS/HTTP status).
func pickPrecheckURL(cfg ExecuteTaskConfig) string {
        if len(cfg.Override.URLs) > 0 {
                return cfg.Override.URLs[0]
        }
        if cfg.Rule.List.URLTemplate != "" {
                return strings.ReplaceAll(cfg.Rule.List.URLTemplate, "{page}", "1")
        }
        return ""
}

// ExecuteTaskGuarded — R80-B 容错链路兜底 (ApplySmartRuleFallback → PrecheckSourceReachable → ExecuteTaskWithRetry).
//
//      步骤:
//        1. ApplySmartRuleFallback(&cfg.Rule) — Rule 字段缺失时填通用 fallback (无副作用, 已配
//           字段不被覆盖). 14 empty Rule 选择器配置错误的可走 fallback 完成基础采集.
//        2. PrecheckSourceReachable(ctx, primaryURL, cfg.Override) — HEAD 请求测源站可达性
//           (5s 超时, GET fallback). 不可达返 *ErrSourceUnreachable, caller 跳过任务 + log warn.
//        3. ExecuteTaskWithRetry(ctx, cfg, 3, 1000) — 3 次重试 + 指数退避 1s/2s/4s (cap 30s),
//           终态错误 (BudgetExceeded/CircuitBreak/ctx cancel) 不重试.
//
//      primaryURL 由 pickPrecheckURL 选: retry-failed 模式取 URLs[0], list 发现模式取
//      URLTemplate {page}=1, 两者都空跳过预检 (返 "" 不预检).
//
//      价值: 14 empty Rule 源站不可达快速跳过避免浪费 maxRequests + 采集时间; 14 partial
//      Rule 瞬态失败经重试可成功完成; ApplySmartRuleFallback 让配置错误的 Rule 走 fallback.
//
//      caller (admin.go startCrawlTask 范围外, R81+ wiring):
//        err := crawl.ExecuteTaskGuarded(ctx, cfg)
//        if errors.Is(err, crawl.ErrSourceUnreachable) { skip task + log warn }
//
//lint:ignore U1000 R80-B 容错链路 wrapper (admin.go 范围外, 留作 R81+ admin wiring 点); 当前 0 caller 在 runner.go 内, 但 future admin.go startCrawlTask 调本函数替代直接 ExecuteTask
func ExecuteTaskGuarded(ctx context.Context, cfg ExecuteTaskConfig) error {
        // 1. 智能 fallback: Rule 字段缺失时填通用 fallback (smart.go, R79-B 目标 A).
        ApplySmartRuleFallback(&cfg.Rule)
        // 2. 源站可达性预检: HEAD 请求测源站 (fetcher.go, R79-B 目标 A).
        //      primaryURL 由 pickPrecheckURL 选 (retry-failed URLs[0] / list URLTemplate {page}=1).
        //      不可达返 *ErrSourceUnreachable sentinel error, 让 caller 决策 (跳过 vs retry).
        if primaryURL := pickPrecheckURL(cfg); primaryURL != "" {
                reachable, reason := PrecheckSourceReachable(ctx, primaryURL, cfg.Override)
                if !reachable {
                        return &ErrSourceUnreachable{Reason: reason}
                }
        }
        // 3. 任务执行 + 重试: 3 次重试 + 指数退避 1s/2s/4s (cap 30s, R80-B 调整).
        return ExecuteTaskWithRetry(ctx, cfg, 3, 1000)
}

// ---------- R82-B 目标 A: 71 Rule 试采 1 本书 (不写 DB) ----------

// FetchTestSample — 单 Rule 试采 1 本书结果 (R82-B 目标 A).
//
//      字段供 adminRulesAudit ?fetchTest=true 返回 JSON 给前端.
type FetchTestSample struct {
        Reachable         bool   `json:"reachable"`
        Reason            string `json:"reason,omitempty"`   // 不可达/错误原因
        BookURL           string `json:"bookUrl,omitempty"`  // 试采的书 URL (list 第 1 本)
        BookName          string `json:"bookName,omitempty"` // ParseBook 提取书名
        TocCount          int    `json:"tocCount"`           // TocItems 数量
        FirstChapterTitle string `json:"firstChapterTitle,omitempty"`
        FirstChapterURL   string `json:"firstChapterURL,omitempty"`
        ContentSnippet    string `json:"contentSnippet,omitempty"` // 首章正文前 120 字
        Status            string `json:"status"`                   // success | failed | empty-toc | blocked | unreachable
}

// FetchTestSampleBook — 对单 Rule 试采 1 本书 meta + 首章 content, 不写 DB.
//
//      R82-B 目标 A (R81 交接 #1): adminRulesAudit ?full=true&fetchTest=true 时, 对每
//      Rule 调本函数. R81-B 仅预检源站可达性 (PrecheckSourceReachable HEAD), 不试采.
//      本函数复用 ExecuteTaskGuarded 子函数链路:
//        1. ApplySmartRuleFallback(&rule) — 字段缺失填通用 fallback (与生产采集同口径).
//        2. pickPrecheckURL + PrecheckSourceReachable — 不可达返 Status="unreachable".
//        3. discoverBooks (DB=nil, 仅取 list 第 1 本) — 无书返 Status="failed", Reason="无书发现".
//        4. CrawlBookMeta (DB=nil, 不 UpsertBook) — 取 bookName + TocItems.
//        5. CrawlChapterContent (DB=nil, 不 UpsertChapter) — 取首章正文前 120 字.
//
//      关键: cfg.DB 全程 nil, CrawlBookMeta (line 1688/1708) 与 CrawlChapterContent
//      (line 2137) 均 `if cfg.DB != nil` 守卫, 不写 Book/Chapter 表. 临时 TaskRuntime
//      不注册 tr.runtimes (不进 admin UI), MarkRunning 单机内 epoch. 任务预算
//      SetMaxRequests(15) 容许 list + book + toc + 1 chapter 共 ~4 HTTP 请求.
//
//      返回 FetchTestSample{Status="success"} 表示整链路通畅 (list → book → toc →
//      content), admin 可信 Rule 采集可行. Status="failed" 表示某阶段断链, Reason
//      含具体阶段 (e.g. "discoverBooks: list.urlTemplate 未配置" / "CrawlBookMeta:
//      章节抓取超时"). Status="unreachable" 表示源站不可达 (Precheck 失败).
//      Status="empty-toc" 表示 book 解析成功但 toc 为空 (Rule.Toc 配置错误).
//      Status="blocked" 表示 book 页或 chapter 页被反爬拦截 (looksBlocked).
func FetchTestSampleBook(ctx context.Context, rule RuleConfig, override FetchConfig) FetchTestSample {
        // 1. 智能 fallback (与 ExecuteTaskGuarded 同款)
        ApplySmartRuleFallback(&rule)
        // 2. 源站可达性预检
        primaryURL := pickPrecheckURL(ExecuteTaskConfig{Rule: rule, Override: override})
        if primaryURL == "" {
                return FetchTestSample{Status: "failed", Reason: "无 List.URLTemplate 且无 Override.URLs, 跳过试采"}
        }
        reachable, reason := PrecheckSourceReachable(ctx, primaryURL, override)
        if !reachable {
                return FetchTestSample{Status: "unreachable", Reachable: false, Reason: reason}
        }
        // 3. 构建 cfg (DB=nil 关键, 避免写 Book/Chapter 表) + 临时 rt
        cfg := ExecuteTaskConfig{
                TaskID:      "audit-fetch-test", // 不注册全局 tr.runtimes, 仅本函数局部
                Rule:        rule,
                Override:    override,
                MaxRequests: 15,
                Logger: func(tid string, level LogLevel, msg string) {
                        // 静默 logger (试采噪声不入 admin 日志, 与 ExecuteTask 生产 Logger 分离)
                },
        }
        rt := NewTaskRuntime(cfg.TaskID)
        rt.SetMaxRequests(cfg.MaxRequests)
        myEpoch := rt.MarkRunning()
        // 4. discoverBooks — 取 list 第 1 本 URL (maxPages=1 已足够试采)
        urls, err := discoverBooks(ctx, cfg, rt, myEpoch)
        if err != nil {
                // R102-A BUG-294 (P3) 修复 (R101-A BUG-290 Blocked family 续):
                //   R101-A BUG-290 加 ErrListDiscoveryBlocked sentinel 让 caller 区分
                //   "list 首页 Blocked" vs "其它失败". 原实现 FetchTestSampleBook
                //   不区分, 一律 Status="failed". 与书籍页 Blocked (CrawlBookMeta
                //   line ~1749 返 BookMetaStatusBlocked → FetchTestSampleBook line
                //   ~2820 映射 Status="blocked") 不对称 — 操作员试采看到 list
                //   页 Blocked 显示 "failed" 误判为配置/网络错而非反爬拦. 修复:
                //   errors.Is(err, &ErrListDiscoveryBlocked{}) → Status="blocked"
                //   (与 BUG-295 章节页 Blocked → Status="blocked" 同款 family).
                if errors.Is(err, &ErrListDiscoveryBlocked{}) {
                        return FetchTestSample{Status: "blocked", Reachable: true,
                                Reason: "discoverBooks: " + truncate(err.Error(), 120)}
                }
                return FetchTestSample{Status: "failed", Reachable: true, Reason: "discoverBooks: " + truncate(err.Error(), 120)}
        }
        if len(urls) == 0 {
                return FetchTestSample{Status: "failed", Reachable: true, Reason: "discoverBooks: list 解析 0 本书 (Rule.List 配置错误或反爬拦)"}
        }
        firstURL := urls[0]
        // 5. CrawlBookMeta — 取 bookName + TocItems (DB=nil 不写库)
        meta, err := CrawlBookMeta(ctx, cfg, rt, myEpoch, firstURL)
        if err != nil {
                return FetchTestSample{Status: "failed", Reachable: true, BookURL: firstURL,
                        Reason: "CrawlBookMeta: " + truncate(err.Error(), 120)}
        }
        if meta == nil {
                return FetchTestSample{Status: "failed", Reachable: true, BookURL: firstURL,
                        Reason: "CrawlBookMeta: 返回 nil (理论不可达)"}
        }
        if meta.Status == BookMetaStatusBlocked {
                return FetchTestSample{Status: "blocked", Reachable: true, BookURL: firstURL,
                        Reason: "CrawlBookMeta: 书籍页被反爬拦 (looksBlocked=true)"}
        }
        if meta.BookCtx == nil || len(meta.BookCtx.TocItems) == 0 {
                // empty-toc: 书籍 meta 解析通但 TOC 空 (Rule.Toc 配置错误或源站 TOC 页异常)
                name := ""
                if meta.BookCtx != nil {
                        name = meta.BookCtx.BookName
                }
                return FetchTestSample{Status: "empty-toc", Reachable: true, BookURL: firstURL,
                        BookName: name, TocCount: 0,
                        Reason: "CrawlBookMeta: TOC 解析 0 章 (Rule.Toc 配置错误或 tocURL 不可达)"}
        }
        // 6. CrawlChapterContent — 取首章正文 (DB=nil 不写库)
        firstToc := meta.BookCtx.TocItems[0]
        q := &ChapterTask{
                BookCtx: meta.BookCtx,
                ChID:    "",
                Title:   firstToc.Title,
                URL:     firstToc.URL,
                Volume:  firstToc.Volume,
                Idx:     1,
        }
        // R98-A BUG-279 (P3) 修复 (R82-D BUG-185 诚实留痕续): CrawlChapterContent 现
        //   扩 4th 返 cleaned 字符串 (成功路径返清洗后正文). 原占位 "<已采>" 替为
        //   truncate(cleaned, 120), admin 试采页面可看真实正文前 120 字 (与 R79-B
        //   FetchTestSample.ContentSnippet 字段语义一致, 不再 placeholder). 与
        //   R67-C BUG-60 (BookMetaResult 加 IsNewBook/CoverSaved 供 stats) 同款 "扩
        //   返字段供 caller 用" precedent. cleaned 失败路径返 "" → snippet=truncate("",
        //   120)="" (truncate n<=0 返 "", n=120 对 "" 返 ""), admin 看到 empty snippet
        //   (ok=true 路径 cleaned 非空才有意义; ok=false 路径早返 line 2756, 不到此).
        ok, kind, msg, cleaned := CrawlChapterContent(ctx, cfg, rt, myEpoch, q)
        if !ok {
                // R102-A BUG-295 续 (与 BUG-294 同款 family): CrawlChapterContent
                //   line ~2294 章节首页 Blocked 返 kind="blocked". 映射 Status=
                //   "blocked" (与 BUG-294 list Blocked + 书籍页 Blocked 三路径
                //   同口径). 其它 kind (no-url/timeout/hostgate/other) 仍 Status=
                //   "failed".
                status := "failed"
                if kind == "blocked" {
                        status = "blocked"
                }
                return FetchTestSample{Status: status, Reachable: true, BookURL: firstURL,
                        BookName: meta.BookCtx.BookName, TocCount: len(meta.BookCtx.TocItems),
                        FirstChapterTitle: firstToc.Title, FirstChapterURL: firstToc.URL,
                        Reason: fmt.Sprintf("CrawlChapterContent: kind=%s msg=%s", kind, truncate(msg, 120))}
        }
        snippet := truncate(cleaned, 120)
        return FetchTestSample{
                Reachable:         true,
                BookURL:           firstURL,
                BookName:          meta.BookCtx.BookName,
                TocCount:          len(meta.BookCtx.TocItems),
                FirstChapterTitle: firstToc.Title,
                FirstChapterURL:   firstToc.URL,
                ContentSnippet:    snippet,
                Status:            "success",
                Reason:            "",
        }
}
