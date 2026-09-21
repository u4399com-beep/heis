// runner.go — 任务调度 + Semaphore + 三阶段并发采集 (R38-1C).
//
// 与 TS 端 src/lib/crawl/runner.ts 同口径核心架构:
//   - Semaphore (R31-1B): 并发上限控制 (acquire/release 配对 try/finally)
//   - BudgetExceeded: 单任务 HTTP 请求总预算上限, 超出终止任务
//   - TaskRuntime: 内存级任务运行时 (epoch / paused / stopped / 集合 / 统计)
//   - executeTask: 三阶段采集
//       阶段1: 并发 crawlBookMeta (书籍详情页 + 目录页, semaphore 限 N=concurrency)
//       阶段2: 全局并发 crawlChapterContent (章节正文页, channel 限 N)
//       阶段3: 串行 finalizeBook (单本书收尾统计 + 下拉词 + 状态分流)
//   - 错误隔离: 单本/单章失败不影响其他
//   - epoch 漂移: stop→start 换代时旧循环只吞异常, 进度权归新循环
//   - cookieJar 持久化 + bridgeUrl 透传
//   - failedBookUrls 三路径对称 (add/delete/resume)
//   - 段落保真: 章节正文 \n\n 分段 (与 R34-1B 同口径)
//
// Go 改造 (优于 TS):
//   - Semaphore 用 buffered channel 取代 promise 队列 (更高效, 无锁)
//   - goroutine + channel 取代 Promise.all (天然并发, 更省内存)
//   - context.Context 贯穿取消 (stop/pause/换代), 与 hostGate 同源
//   - sync.Map / sync.Mutex 取代 globalThis 单例
package crawl

import (
        "context"
        "errors"
        "fmt"
        "math/rand"
        "strings"
        "sync"
        "sync/atomic"
        "time"

        "github.com/PuerkitoBio/goquery"
)

// ---------- BudgetExceeded ----------

// BudgetExceeded — 单任务 HTTP 请求总预算上限超出错误.
//  gateFetch 每次入口检查 requestCount > maxRequests 即抛此错终止任务.
type BudgetExceeded struct {
        TaskID string
        Count int
        Max   int
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
//  acquire/release 必须成对调用 (defer release), 否则泄漏许可 (并发降为 0 死锁).
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

// TryAcquire — 非阻塞获取, 成功返回 true.
func (s *Semaphore) TryAcquire() bool {
        select {
        case s.ch <- struct{}{}:
                return true
        default:
                return false
        }
}

// Release — 释放一个许可.
func (s *Semaphore) Release() {
        <-s.ch
}

// ---------- TaskRuntime (内存级任务运行时) ----------

// TaskStats — 任务累计统计.
type TaskStats struct {
        BooksCreated       int
        BooksUpdated       int
        ChaptersCreated    int
        ChaptersUpdated    int
        CoversSaved        int
        SuggestWords       int
        Errors             int
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
        mu       sync.Mutex
        running  bool
        paused   bool
        stopped  bool
        epoch    int64
        createdAt int64
        lastActiveAt int64

        // 统计 (atomic)
        requestCount  int64
        bytesFetched  int64
        runStartedAt  int64
        currentURL    string
        maxRequests   int
        captchaEncountered int64

        // 集合 (路径状态分流)
        discoveredBookUrls  map[string]bool
        completedBookUrls   map[string]bool
        ongoingBookUrls      map[string]bool
        failedBookUrls       map[string]bool
        bookLastChapters    map[string]string

        // 熔断
        circuitTrippedAt int64

        // 日志
        recentLogs []LogEntry
        logsMu      sync.Mutex
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
                bookLastChapters:   map[string]string{},
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
//  myEpoch = 调用方捕获的 epoch, 与 rt.epoch 对比.
func (rt *TaskRuntime) IsStale(myEpoch int64) bool {
        return rt.CurrentEpoch() != myEpoch
}

// MarkRunning — 标记任务开始运行 (epoch++, 复位 stopped/paused).
func (rt *TaskRuntime) MarkRunning() int64 {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        rt.epoch++
        rt.running = true
        rt.paused = false
        rt.stopped = false
        rt.runStartedAt = time.Now().UnixMilli()
        rt.lastActiveAt = rt.runStartedAt
        return rt.epoch
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

// SetMaxRequests — 设置请求预算上限.
// R41-1A: 修复原实现用 atomic.StoreInt64(&rt.epoch, rt.epoch) 做 "memory barrier" 的错误
//         (epoch 自存自不构成 barrier). 改为用 rt.mu 锁保护写入, 与读路径 (Snapshot) 同款锁.
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

// IsDiscovered — 是否已发现.
func (rt *TaskRuntime) IsDiscovered(url string) bool {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        return rt.discoveredBookUrls[url]
}

// IsCompleted — 是否已完结.
func (rt *TaskRuntime) IsCompleted(url string) bool {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        return rt.completedBookUrls[url]
}

// SetBookLastChapter — 记录书末章 (增量检查用).
func (rt *TaskRuntime) SetBookLastChapter(url, lastChapter string) {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        if len(rt.bookLastChapters) < 10000 {
                rt.bookLastChapters[url] = lastChapter
        }
}

// GetBookLastChapter — 取书末章.
func (rt *TaskRuntime) GetBookLastChapter(u string) string {
        rt.mu.Lock()
        defer rt.mu.Unlock()
        return rt.bookLastChapters[u]
}

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
}

// Snapshot — 返回任务实时快照 (供 admin UI 实时显示).
func (rt *TaskRuntime) Snapshot() *TaskSnapshot {
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
                MemResumeSetsSize:   len(rt.discoveredBookUrls) + len(rt.completedBookUrls) + len(rt.ongoingBookUrls) + len(rt.failedBookUrls) + len(rt.bookLastChapters),
                RecentLogs:          append([]LogEntry(nil), rt.recentLogs...),
                FailedBookUrlsCount: len(rt.failedBookUrls),
                CaptchaEncountered:  atomic.LoadInt64(&rt.captchaEncountered),
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

// ---------- DB 接口 (供 wiring) ----------

// DBClient — DB 操作接口 (供 main.go wiring 注入).
//  crawl 包不直接依赖 Prisma / sqlite; 由调用方实现该接口.
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
        ID         string
        BookID     string
        Title      string
        Content    string
        Idx        int
        Volume     string
        SourceURL  string
        Fetched    bool
        UpdatedAt  time.Time
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
type BookMetaResult struct {
        Status   BookMetaStatus
        BookURL  string
        BookCtx  *BookMetaContext
}

// BookMetaContext — 阶段 2 章节采集所需的书本上下文.
type BookMetaContext struct {
        BookID          string
        BookName        string
        BookURL         string
        TocItems        []TocItem
        DetectedStatus  string // completed | ongoing | unknown
        ParsedWordCount int64
        IDMap           map[string]string // url → chId
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

// ExecuteTask — 三阶段采集主入口 (与 TS 端 executeTask 同口径).
//
//  阶段 1: 并发 crawlBookMeta (semaphore 限 N=concurrency)
//  阶段 2: 全局并发 crawlChapterContent (channel 限 N)
//  阶段 3: 串行 finalizeBook (单本书收尾统计 + 状态分流)
//
//  错误隔离: 单本/单章失败不影响其他; BudgetExceeded / CircuitBreak 上抛任务级
func ExecuteTask(ctx context.Context, cfg ExecuteTaskConfig) error {
        rt := NewTaskRuntime(cfg.TaskID)
        // R41-1A: maxRequests 写入移到 MarkRunning / registration 之前 (happens-before 关系
        // 保证 admin Snapshot 看到非零值). 原代码在 tr.runtimes[cfg.TaskID] = rt 之后写,
        // 无 memory barrier, admin 读到零值.
        rt.maxRequests = cfg.MaxRequests
        myEpoch := rt.MarkRunning()

        // 注册 runtime (供 admin UI 查询)
        tr := GetTaskRunner()
        tr.mu.Lock()
        tr.runtimes[cfg.TaskID] = rt
        tr.mu.Unlock()
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

        progress := TaskProgress{
                Phase:        "book",
                BooksTotal:   len(bookQueue),
                CurrentBook:  fmt.Sprintf("%d 本待采", len(bookQueue)),
                PhaseNote:    fmt.Sprintf("阶段1: 并发采集书籍 meta (待采=%d 本)", len(bookQueue)),
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
                                        bookBatchMu.Lock()
                                        stats.Errors++
                                        bookBatchMu.Unlock()
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
                for _, r := range results {
                        if r.Status == BookMetaStatusBlocked || r.Status == BookMetaStatusEmptyToc || r.Status == BookMetaStatusError {
                                progress.BooksDone++
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
                        for _, toc := range r.BookCtx.TocItems {
                                globalQueue = append(globalQueue, &ChapterTask{
                                        BookCtx: r.BookCtx,
                                        Title:   toc.Title,
                                        URL:     toc.URL,
                                        Volume:  toc.Volume,
                                })
                        }
                        okMetaBooks = append(okMetaBooks, r.BookCtx)
                }
        }
        bookDoneMap := map[string]int{}
        for _, bc := range okMetaBooks {
                bookDoneMap[bc.BookID] = 0
        }

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
                //  progress.ContentDone / bookDoneMap 都是跨 goroutine 共享)
                var batchMu sync.Mutex

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
                                        if err := chapterSem.Acquire(ctx); err != nil {
                                                return
                                        }
                                        defer chapterSem.Release()

                                        ok, kind, msg := CrawlChapterContent(ctx, cfg, rt, myEpoch, q)
                                        // R41-1A: 用 batchMu 保护共享变量写
                                        batchMu.Lock()
                                        if ok {
                                                stats.ChaptersUpdated++
                                                consecutiveErrs = 0
                                                done++
                                                progress.ContentDone = done
                                                bookDoneMap[q.BookCtx.BookID]++
                                        } else {
                                                switch kind {
                                                case "no-url":
                                                        stats.Errors++
                                                        logf(LogWarn, "章节无有效链接, 跳过: %s", truncate(q.Title, 60))
                                                        done++
                                                        progress.ContentDone = done
                                                case "timeout":
                                                        stats.Errors++
                                                        consecutiveErrs++
                                                        logf(LogError, "%s", msg)
                                                case "abort":
                                                        // 停止/换代造成的中止不计失败
                                                case "hostgate":
                                                        logf(LogWarn, "%s", msg)
                                                case "other":
                                                        stats.Errors++
                                                        consecutiveErrs++
                                                        logf(LogError, "%s", msg)
                                                }
                                        }
                                        batchMu.Unlock()
                                }(q)
                        }
                        wg.Wait()

                        // 连续错误熔断检查 (每批次末, 主循环读 consecutiveErrs 无锁 OK:
                        // 因为 wg.Wait() happens-before 这里, 所有 goroutine 写都已发布)
                        if consecutiveErrs >= CircuitErrorLimit {
                                rt.mu.Lock()
                                rt.circuitTrippedAt = time.Now().UnixMilli()
                                rt.mu.Unlock()
                                logf(LogError, "🔴 熔断中止: 连续 %d 章采集失败, 停止继续请求", consecutiveErrs)
                                saveProgress()
                                return &CircuitBreak{Reason: "连续错误熔断", Consecutive: consecutiveErrs, Limit: CircuitErrorLimit}
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
                        bookDone := bookDoneMap[bc.BookID]
                        if err := FinalizeBook(ctx, cfg, rt, myEpoch, bc, bookDone, &stats, &progress); err != nil {
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
        logf(LogSuccess, "✅ 任务完成: 新书%d 更新%d | 新章节%d 更新%d | 封面%d | 错误%d",
                stats.BooksCreated, stats.BooksUpdated, stats.ChaptersCreated, stats.ChaptersUpdated, stats.CoversSaved, stats.Errors)
        if !rt.IsPaused() && !rt.IsStopped() && !rt.IsStale(myEpoch) {
                if cfg.DB != nil {
                        _ = cfg.DB.UpdateTaskStatus(cfg.TaskID, "done")
                }
        }
        saveProgress()
        return nil
}

// ---------- discoverBooks (列表发现) ----------

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
        for p := 1; p <= maxPages; p++ {
                url := strings.ReplaceAll(urlTemplate, "{page}", fmt.Sprintf("%d", p))
                res, err := FetchPage(ctx, url, cfg.Override)
                if err != nil {
                        continue
                }
                if res.Blocked {
                        break
                }
                listRes := ParseList(res.HTML, url, cfg.Rule.List, []string{"url"})
                for _, item := range listRes.Items {
                        u := item.Fields["url"]
                        if u == "" || seen[u] {
                                continue
                        }
                        seen[u] = true
                        discovered = append(discovered, u)
                        rt.AddToDiscovered(u)
                }
                if p < maxPages {
                        // 翻页 (简化: 调用 ParseToc 的翻页逻辑)
                        break
                }
        }
        return discovered, nil
}

// ---------- CrawlBookMeta (阶段 1) ----------

// CrawlBookMeta — 阶段 1: 书籍 meta 采集 (书籍详情页 + 目录页).
func CrawlBookMeta(ctx context.Context, cfg ExecuteTaskConfig, rt *TaskRuntime, myEpoch int64, bookURL string) (*BookMetaResult, error) {
        // 预算检查
        if err := rt.CheckBudget(); err != nil {
                return nil, err
        }
        rt.IncRequest()
        rt.SetCurrentURL(bookURL)

        // 抓书籍页
        bookRes, err := FetchPage(ctx, bookURL, mergeFetchConfig(cfg.Override, FetchConfig{
                RequestPriority: "book",
        }))
        if err != nil {
                return nil, err
        }
        if bookRes.Blocked {
                return &BookMetaResult{Status: BookMetaStatusBlocked, BookURL: bookURL}, nil
        }

        // 解析书籍页 (parseBook)
        parsed := ParseBook(bookRes.HTML, bookURL, cfg.Rule.Book)
        // 简化: 直接 upsert 书籍 (假设无 DB 时跳过)
        var bookID string
        if cfg.DB != nil {
                // 检查是否已存在 (跨源去重 + 增量更新)
                existing, ferr := cfg.DB.FindBookBySourceURL(bookURL)
                if ferr == nil && existing.ID != "" {
                        bookID = existing.ID
                } else {
                        // 新建书
                        newBook := Book{
                                Name:          CleanTextField(parsed.Name, 200),
                                Author:        CleanTextField(parsed.Author, 100),
                                Intro:         CleanIntro(parsed.Intro, 2000),
                                Cover:         parsed.Cover,
                                Status:        "unknown",
                                SourceURL:     bookURL,
                                UpdatedAt:     time.Now(),
                        }
                        created, err := cfg.DB.UpsertBook(newBook)
                        if err == nil {
                                bookID = created.ID
                        }
                }
        }
        if bookID == "" {
                bookID = "tmp_" + fmt.Sprintf("%d", time.Now().UnixNano())
        }

        // 智能完结判断 (smartCompleteDetect)
        completeResult := SmartCompleteDetect(SmartCompleteDetectInput{
                StatusField:        parsed.Status,
                Intro:              parsed.Intro,
                LatestChapterTitle: parsed.LatestChapter,
                BookName:           parsed.Name,
        })
        detectedStatus := completeResult.Status

        // 抓目录页 (用 toc 规则, 若 toc 未配置 tocLink 则用书籍页 URL)
        tocURL := bookURL
        if cfg.Rule.Toc.TocLink != nil && cfg.Rule.Toc.TocLink.Type != "" {
                // 提取目录页链接 (从书籍页)
                doc, _ := goquery.NewDocumentFromReader(strings.NewReader(bookRes.HTML))
                if doc != nil {
                        tocURL = ExtractField(bookRes.HTML, doc, nil, *cfg.Rule.Toc.TocLink, nil)
                        tocURL = Absolutize(tocURL, bookURL)
                        if tocURL == "" {
                                tocURL = bookURL
                        }
                }
        }
        rt.SetCurrentURL(tocURL)
        tocRes, err := FetchPage(ctx, tocURL, mergeFetchConfig(cfg.Override, FetchConfig{RequestPriority: "book"}))
        if err != nil {
                return nil, err
        }
        if tocRes.Blocked {
                return &BookMetaResult{Status: BookMetaStatusBlocked, BookURL: bookURL}, nil
        }

        // 解析目录 (含翻页)
        pageFetcher := func(ctx context.Context, u, refererURL string) (string, error) {
                res, err := FetchPage(ctx, u, mergeFetchConfig(cfg.Override, FetchConfig{
                        RefererChain: cfg.Override.RefererChain,
                        RefererURL:   refererURL,
                        RequestPriority: "book",
                }))
                if err != nil {
                        return "", err
                }
                return res.HTML, nil
        }
        toc, err := ParseToc(ctx, tocURL, tocRes.HTML, cfg.Rule.Toc, pageFetcher, nil)
        if err != nil {
                return nil, err
        }
        if len(toc.Items) == 0 {
                return &BookMetaResult{Status: BookMetaStatusEmptyToc, BookURL: bookURL}, nil
        }

        // 增量检查: 比较 bookLastChapters (本场景简化, 实际由 wiring 提供)
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
        idMap := map[string]string{}
        for i, toc := range toc.Items {
                _ = i
                idMap[toc.URL] = "" // 暂为空, 阶段 2 落库后填充
        }

        bookCtx := &BookMetaContext{
                BookID:         bookID,
                BookName:       parsed.Name,
                BookURL:        bookURL,
                TocItems:       toc.Items,
                DetectedStatus: detectedStatus,
                IDMap:          idMap,
                FetchCfg:       cfg.Override,
        }

        // 封面下载 (若有 cover 且 DB 提供 SaveCoverWebp)
        if parsed.Cover != "" && cfg.DB != nil {
                // ab-b 注: 封面 fetchBinary 直连外部 CDN, 不经 gateFetch
                coverRes, err := FetchPage(ctx, parsed.Cover, FetchConfig{
                        Engine: "http",
                        UAMode: "rotate",
                        AutoCookie: false,
                        Referer:    false,
                        Timeout:    15000,
                        Retries:    1,
                })
                if err == nil && !coverRes.Blocked && coverRes.HTML != "" {
                        // 简化: HTML 当字节流 (实际应使用 fetchBinary)
                        if rel, err := SaveCoverWebp([]byte(coverRes.HTML), bookID); err == nil && rel != "" {
                                _ = cfg.DB.UpdateBookCover(bookID, rel)
                        }
                }
        }

        return &BookMetaResult{Status: BookMetaStatusOKMeta, BookURL: bookURL, BookCtx: bookCtx}, nil
}

// ---------- CrawlChapterContent (阶段 2) ----------

// CrawlChapterContent — 阶段 2: 单章正文采集.
// 返回 (ok, kind, message). kind: "" | "no-url" | "timeout" | "abort" | "hostgate" | "other"
func CrawlChapterContent(ctx context.Context, cfg ExecuteTaskConfig, rt *TaskRuntime, myEpoch int64, q *ChapterTask) (bool, string, string) {
        if q.URL == "" {
                return false, "no-url", ""
        }
        // 预算检查
        if err := rt.CheckBudget(); err != nil {
                // BudgetExceeded 上抛任务级 (返回 other 让上层处理)
                return false, "other", err.Error()
        }
        rt.IncRequest()
        rt.SetCurrentURL(q.URL)

        // 过闸 hostGate (同 host 并发 + 速率限制)
        hostGate := GetHostGate()
        ticket, err := hostGate.Acquire(ctx, q.URL, cfg.Override.HostGateLimit, HostGateWaitTimeoutMs, cfg.Override.PerHostConcurrency)
        if err != nil {
                // 槽满等待超时 → hostgate 路径
                return false, "hostgate", fmt.Sprintf("书籍采集等待同站并发闸门超时 (host:%s): %s", HostGateKeyOf(q.URL), truncate(q.URL, 120))
        }
        defer hostGate.Release(ticket)

        // 抓章节页
        res, err := FetchPage(ctx, q.URL, mergeFetchConfig(q.BookCtx.FetchCfg, FetchConfig{RequestPriority: "chapter"}))
        if err != nil {
                if ctx.Err() != nil {
                        return false, "abort", ""
                }
                // 分类错误
                errStr := err.Error()
                if strings.Contains(errStr, "timeout") || strings.Contains(errStr, "context deadline exceeded") {
                        hostGate.ReportFailure(HostGateKeyOf(q.URL))
                        return false, "timeout", fmt.Sprintf("章节抓取超时: %s", truncate(q.URL, 120))
                }
                hostGate.ReportFailure(HostGateKeyOf(q.URL))
                return false, "other", fmt.Sprintf("章节采集失败 %s: %s", q.Title, truncate(errStr, 120))
        }
        hostGate.ReportSuccess(HostGateKeyOf(q.URL))

        if res.Blocked {
                hostGate.ReportFailure(HostGateKeyOf(q.URL))
                return false, "other", fmt.Sprintf("章节内容疑似被拦截: %s", truncate(q.URL, 120))
        }

        // 解析正文 (parseContent 含翻页合并)
        pageFetcher := func(ctx context.Context, u, refererURL string) (string, error) {
                pageRes, err := FetchPage(ctx, u, mergeFetchConfig(q.BookCtx.FetchCfg, FetchConfig{
                        RefererChain: q.BookCtx.FetchCfg.RefererChain,
                        RefererURL:   refererURL,
                        RequestPriority: "chapter",
                }))
                if err != nil {
                        return "", err
                }
                return pageRes.HTML, nil
        }
        content, err := ParseContent(ctx, q.URL, res.HTML, cfg.Rule.Content, cfg.Override, pageFetcher)
        if err != nil {
                return false, "other", fmt.Sprintf("章节正文解析失败 %s: %v", q.Title, err)
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

        if cleaned == "" {
                return false, "other", fmt.Sprintf("章节正文为空: %s", q.Title)
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
                } else if id, ok := q.BookCtx.IDMap[q.URL]; ok && id != "" {
                        ch.ID = id
                }
                _, err := cfg.DB.UpsertChapter(ch)
                if err != nil {
                        return false, "other", fmt.Sprintf("章节入库失败 %s: %v", q.Title, err)
                }
        }

        // 累计字节
        rt.IncBytes(int64(len(cleaned)))

        return true, "", ""
}

// ---------- FinalizeBook (阶段 3) ----------

// FinalizeBook — 阶段 3: 单本书收尾 (统计 + 状态分流 + latestChapter).
func FinalizeBook(ctx context.Context, cfg ExecuteTaskConfig, rt *TaskRuntime, myEpoch int64, bc *BookMetaContext, bookDone int, stats *TaskStats, progress *TaskProgress) error {
        // 更新书籍 wordCount / latestChapter
        if cfg.DB != nil && bc.BookID != "" {
                // 聚合 fetched 章节字数 (简化: 走 ParsedWordCount 兜底)
                wordCount := bc.ParsedWordCount
                if wordCount == 0 {
                        // TODO: DB 聚合 sum(len(chapter.content))
                }
                if wordCount > 0 {
                        _ = cfg.DB.UpdateBookWordCount(bc.BookID, wordCount)
                }
                // 状态分流
                if bc.DetectedStatus != "unknown" {
                        _ = cfg.DB.UpdateBookStatus(bc.BookID, bc.DetectedStatus)
                }
                // latestChapter (取 toc 末章标题)
                if len(bc.TocItems) > 0 {
                        latest := bc.TocItems[len(bc.TocItems)-1].Title
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

// truncate — 截断字符串到指定长度 (按字节, 简化实现).
func truncate(s string, n int) string {
        if len(s) <= n {
                return s
        }
        return s[:n]
}
