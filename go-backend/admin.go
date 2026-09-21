// R39-1C — admin 后台 wiring: API 路由 + 页面路由 + DBClient 适配器
// 与 R38-1C 采集引擎 (go-backend/crawl/*) 接驳, 与 src/app/api/admin/* TS 路由逻辑同口径.
//
// 主要内容:
//   1. adminDB — 实现 crawl.DBClient 接口 (Task/Book/Chapter 持久化)
//   2. 采集 API: POST/GET /api/admin/tasks, POST /api/admin/tasks/:id/control,
//      GET /api/admin/tasks/:id/snapshot, GET/POST /api/admin/rules,
//      GET/PUT /api/admin/rules/:id, GET /api/admin/books, GET /api/admin/health
//   3. admin 页面: /admin (dashboard), /admin/tasks, /admin/books, /admin/rules, /admin/sites
package main

import (
        "context"
        "crypto/rand"
        "database/sql"
        "encoding/hex"
        "encoding/json"
        "fmt"
        "log"
        "net/http"
        "net/url"
        "strconv"
        "strings"
        "time"

        "heis-backend/crawl"
)

// ---------- ID 生成 (cuid-like, 与 Prisma cuid 不冲突) ----------

// generateID 生成类 cuid 长度 (24 字符), 前缀 g 表示 Go 端生成, 防与 Prisma cuid (前缀 cl) 冲突.
func generateID() string {
        var buf [12]byte
        _, _ = rand.Read(buf[:])
        return "g" + strconv.FormatInt(time.Now().Unix(), 36) + hex.EncodeToString(buf[:])
}

// ---------- adminDB 实现 crawl.DBClient ----------

// adminDB 包装 *sql.DB 实现 crawl.DBClient 接口.
//  与 Prisma schema (Task/Book/Chapter/Rule/TaskLog) 字段对齐.
type adminDB struct {
        db *sql.DB
}

func newAdminDB() *adminDB { return &adminDB{db: db} }

// UpdateTaskStatus — 更新任务状态 (status: pending/running/paused/stopped/done/error).
func (a *adminDB) UpdateTaskStatus(taskID, status string) error {
        _, err := a.db.Exec(`UPDATE Task SET status=?, updatedAt=datetime('now') WHERE id=?`, status, taskID)
        return err
}

// UpdateTaskProgress — 序列化 progress + stats 写入 Task 表.
func (a *adminDB) UpdateTaskProgress(taskID string, progress crawl.TaskProgress, stats crawl.TaskStats) error {
        pbytes, _ := json.Marshal(progress)
        sbytes, _ := json.Marshal(stats)
        _, err := a.db.Exec(`UPDATE Task SET progress=?, stats=?, updatedAt=datetime('now') WHERE id=?`,
                string(pbytes), string(sbytes), taskID)
        return err
}

// InsertTaskLog — 写 TaskLog 表.
func (a *adminDB) InsertTaskLog(taskID string, level crawl.LogLevel, message string) error {
        _, err := a.db.Exec(
                `INSERT INTO TaskLog (id, taskId, level, message, createdAt) VALUES (?,?,?,?,datetime('now'))`,
                generateID(), taskID, string(level), message,
        )
        return err
}

// FindBookBySourceURL — 通过 sourceUrl 查 Book (用于增量更新判断).
func (a *adminDB) FindBookBySourceURL(sourceURL string) (crawl.Book, error) {
        var b crawl.Book
        var updatedAt string
        err := a.db.QueryRow(
                `SELECT id,name,author,intro,cover,status,wordCount,latestChapter,COALESCE(categoryId,''),sourceUrl,updatedAt FROM Book WHERE sourceUrl=? AND sourceUrl!='' LIMIT 1`,
                sourceURL,
        ).Scan(&b.ID, &b.Name, &b.Author, &b.Intro, &b.Cover, &b.Status, &b.WordCount,
                &b.LatestChapter, &b.CategoryID, &b.SourceURL, &updatedAt)
        if err != nil {
                return b, err
        }
        b.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
        return b, nil
}

// UpsertBook — 按 sourceUrl 查存在则更新, 不存在则新建. 返回带 ID 的 Book.
func (a *adminDB) UpsertBook(b crawl.Book) (crawl.Book, error) {
        // 查存在
        var existingID string
        if b.SourceURL != "" {
                _ = a.db.QueryRow(`SELECT id FROM Book WHERE sourceUrl=? LIMIT 1`, b.SourceURL).Scan(&existingID)
        }
        if existingID != "" {
                b.ID = existingID
                _, err := a.db.Exec(
                        `UPDATE Book SET name=?,author=?,intro=?,cover=?,status=?,wordCount=?,latestChapter=?,categoryId=?,sourceUrl=?,updatedAt=datetime('now') WHERE id=?`,
                        b.Name, b.Author, b.Intro, b.Cover, b.Status, b.WordCount, b.LatestChapter,
                        nullIfEmpty(b.CategoryID), b.SourceURL, b.ID,
                )
                return b, err
        }
        // 新建
        b.ID = generateID()
        _, err := a.db.Exec(
                `INSERT INTO Book (id,name,author,intro,cover,status,wordCount,latestChapter,categoryId,sourceUrl,storageMode,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,'db',datetime('now'),datetime('now'))`,
                b.ID, b.Name, b.Author, b.Intro, b.Cover, b.Status, b.WordCount, b.LatestChapter,
                nullIfEmpty(b.CategoryID), b.SourceURL,
        )
        return b, err
}

// UpdateBookStatus — 更新书籍状态.
func (a *adminDB) UpdateBookStatus(bookID, status string) error {
        _, err := a.db.Exec(`UPDATE Book SET status=?, updatedAt=datetime('now') WHERE id=?`, status, bookID)
        return err
}

// UpdateBookWordCount — 更新书籍字数.
func (a *adminDB) UpdateBookWordCount(bookID string, wordCount int64) error {
        _, err := a.db.Exec(`UPDATE Book SET wordCount=?, updatedAt=datetime('now') WHERE id=?`, wordCount, bookID)
        return err
}

// UpdateBookLatestChapter — 更新书籍末章.
func (a *adminDB) UpdateBookLatestChapter(bookID, latestChapter string) error {
        _, err := a.db.Exec(`UPDATE Book SET latestChapter=?, updatedAt=datetime('now') WHERE id=?`, latestChapter, bookID)
        return err
}

// UpdateBookCover — 更新书籍封面.
func (a *adminDB) UpdateBookCover(bookID, coverPath string) error {
        _, err := a.db.Exec(`UPDATE Book SET cover=?, updatedAt=datetime('now') WHERE id=?`, coverPath, bookID)
        return err
}

// FindChapterByURL — 通过 bookId + url 查 Chapter (去重用).
func (a *adminDB) FindChapterByURL(bookID, sourceURL string) (crawl.Chapter, error) {
        var c crawl.Chapter
        var updatedAt string
        err := a.db.QueryRow(
                `SELECT id,bookId,title,COALESCE(content,''),idx,COALESCE(volume,''),COALESCE(url,''),fetched,updatedAt FROM Chapter WHERE bookId=? AND url=? AND url!='' LIMIT 1`,
                bookID, sourceURL,
        ).Scan(&c.ID, &c.BookID, &c.Title, &c.Content, &c.Idx, &c.Volume, &c.SourceURL, &c.Fetched, &updatedAt)
        if err != nil {
                return c, err
        }
        c.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
        return c, nil
}

// UpsertChapter — 按 bookId + url 查存在则更新, 不存在则新建.
func (a *adminDB) UpsertChapter(c crawl.Chapter) (crawl.Chapter, error) {
        // 查存在
        var existingID string
        if c.SourceURL != "" {
                _ = a.db.QueryRow(`SELECT id FROM Chapter WHERE bookId=? AND url=? LIMIT 1`, c.BookID, c.SourceURL).Scan(&existingID)
        }
        if existingID != "" {
                c.ID = existingID
                _, err := a.db.Exec(
                        `UPDATE Chapter SET title=?,content=?,idx=?,volume=?,fetched=?,updatedAt=datetime('now') WHERE id=?`,
                        c.Title, c.Content, c.Idx, c.Volume, c.Fetched, c.ID,
                )
                return c, err
        }
        // 新建
        c.ID = generateID()
        _, err := a.db.Exec(
                `INSERT INTO Chapter (id,bookId,idx,title,volume,url,content,storage,wordCount,fetched,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,'db',0,?,datetime('now'),datetime('now'))`,
                c.ID, c.BookID, c.Idx, c.Title, c.Volume, c.SourceURL, c.Content, c.Fetched,
        )
        return c, err
}

// MarkChapterFetched — 标记章节已采集.
func (a *adminDB) MarkChapterFetched(chapterID string, fetched bool) error {
        _, err := a.db.Exec(`UPDATE Chapter SET fetched=?, updatedAt=datetime('now') WHERE id=?`, fetched, chapterID)
        return err
}

func nullIfEmpty(s string) interface{} {
        if s == "" {
                return nil
        }
        return s
}

// ---------- HTTP 工具 ----------

// writeJSONErr 写错误 JSON.
func writeJSONErr(w http.ResponseWriter, msg string, code int) {
        w.WriteHeader(code)
        writeJSON(w, map[string]interface{}{"ok": false, "error": msg})
}

// writeJSONOK 写成功 JSON.
func writeJSONOK(w http.ResponseWriter, data interface{}) {
        writeJSON(w, map[string]interface{}{"ok": true, "data": data})
}

// readJSONBody 读 request body 为 map.
func readJSONBody(r *http.Request) map[string]interface{} {
        out := map[string]interface{}{}
        if r.Body == nil {
                return out
        }
        defer r.Body.Close()
        _ = json.NewDecoder(r.Body).Decode(&out)
        return out
}

// strField 从 map 取 string (支持 string/number/bool 转字符串).
func strField(m map[string]interface{}, key string, max int) string {
        v, ok := m[key]
        if !ok || v == nil {
                return ""
        }
        var s string
        switch x := v.(type) {
        case string:
                s = x
        case float64:
                s = strconv.FormatFloat(x, 'f', -1, 64)
        case bool:
                if x {
                        s = "true"
                } else {
                        s = "false"
                }
        default:
                s = fmt.Sprintf("%v", v)
        }
        s = strings.TrimSpace(s)
        if max > 0 && len(s) > max {
                s = s[:max]
        }
        return s
}

// intField 从 map 取 int (钳制范围).
func intField(m map[string]interface{}, key string, def, lo, hi int) int {
        v, ok := m[key]
        if !ok || v == nil {
                return def
        }
        var n int
        switch x := v.(type) {
        case float64:
                n = int(x)
        case string:
                fmt.Sscanf(x, "%d", &n)
        }
        if n < lo {
                n = lo
        }
        if hi > 0 && n > hi {
                n = hi
        }
        return n
}

// boolField 从 map 取 bool (默认 false; 显式 false 返回 false; 显式 true 返回 true).
func boolField(m map[string]interface{}, key string, def bool) bool {
        v, ok := m[key]
        if !ok || v == nil {
                return def
        }
        switch x := v.(type) {
        case bool:
                return x
        case string:
                return x == "true"
        }
        return def
}

// httpURL — 校验 http(s) URL; 非空但非法返回空串.
func httpURL(v string) string {
        v = strings.TrimSpace(v)
        if v == "" {
                return ""
        }
        u, err := url.Parse(v)
        if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
                return ""
        }
        return v
}

// clampInt 钳制 int 范围.
func clampIntAdm(v, lo, hi int) int {
        if v < lo {
                return lo
        }
        if v > hi {
                return hi
        }
        return v
}

// likeSafe — LIKE 查询安全转义 (防注入, 用 ESCAPE).
func likeSafe(s string) string {
        s = strings.TrimSpace(s)
        if s == "" {
                return ""
        }
        // 转义 % _ \
        s = strings.ReplaceAll(s, `\`, `\\`)
        s = strings.ReplaceAll(s, "%", `\%`)
        s = strings.ReplaceAll(s, "_", `\_`)
        return s
}

// ---------- 采集 API handlers ----------

// adminTaskSubHandler — 分发 /api/admin/tasks/{id}/control 与 /api/admin/tasks/{id}/snapshot.
//
//      path 结尾为 /control → adminTaskControlHandler
//      path 结尾为 /snapshot → adminTaskSnapshotHandler
//      否则返回 404.
func adminTaskSubHandler(w http.ResponseWriter, r *http.Request) {
        path := strings.TrimPrefix(r.URL.Path, "/api/admin/tasks/")
        // path 形如: {id}/control 或 {id}/snapshot
        if strings.HasSuffix(path, "/control") {
                adminTaskControlHandler(w, r)
                return
        }
        if strings.HasSuffix(path, "/snapshot") {
                adminTaskSnapshotHandler(w, r)
                return
        }
        writeJSONErr(w, "not found", 404)
}

// adminHealthHandler — /api/admin/health 健康检查.
func adminHealthHandler(w http.ResponseWriter, r *http.Request) {
        writeJSONOK(w, map[string]interface{}{
                "ok":    true,
                "lang":  "go",
                "memMB": getMemMB(),
                "time":  time.Now().Format(time.RFC3339),
        })
}

// adminTasksHandler — GET 列任务 / POST 创建任务并启动.
//
//      GET  /api/admin/tasks?status=running  → 列任务 (按 status 过滤)
//      POST /api/admin/tasks                  → 创建任务 + 异步调 crawl.ExecuteTask
func adminTasksHandler(w http.ResponseWriter, r *http.Request) {
        switch r.Method {
        case http.MethodGet:
                adminTasksList(w, r)
        case http.MethodPost:
                adminTasksCreate(w, r)
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// adminTasksList — GET 列任务.
func adminTasksList(w http.ResponseWriter, r *http.Request) {
        status := strings.TrimSpace(r.URL.Query().Get("status"))
        // 状态白名单
        validStatuses := map[string]bool{"pending": true, "running": true, "paused": true, "stopped": true, "done": true, "error": true}
        var rows *sql.Rows
        var err error
        if status != "" && validStatuses[status] {
                rows, err = db.Query(
                        `SELECT t.id,t.name,t.ruleId,t.mode,t.bookUrl,t.listUrl,t.listStart,t.listEnd,
                                t.bookStart,t.bookEnd,t.recrawlMode,t.storageMode,t.threadMin,t.threadMax,
                                t.intervalMin,t.intervalMax,t.smartCategory,t.smartComplete,t.autoSuggest,
                                t.autoRefresh,t.refreshIntervalMin,t.status,t.progress,t.stats,t.updatedAt,
                                COALESCE(r.name,'(规则已删)')
                           FROM Task t LEFT JOIN Rule r ON t.ruleId=r.id
                          WHERE t.status=?
                          ORDER BY t.updatedAt DESC LIMIT 500`, status)
        } else {
                rows, err = db.Query(
                        `SELECT t.id,t.name,t.ruleId,t.mode,t.bookUrl,t.listUrl,t.listStart,t.listEnd,
                                t.bookStart,t.bookEnd,t.recrawlMode,t.storageMode,t.threadMin,t.threadMax,
                                t.intervalMin,t.intervalMax,t.smartCategory,t.smartComplete,t.autoSuggest,
                                t.autoRefresh,t.refreshIntervalMin,t.status,t.progress,t.stats,t.updatedAt,
                                COALESCE(r.name,'(规则已删)')
                           FROM Task t LEFT JOIN Rule r ON t.ruleId=r.id
                          ORDER BY t.updatedAt DESC LIMIT 500`)
        }
        if err != nil {
                writeJSONErr(w, "查询失败: "+err.Error(), 500)
                return
        }
        defer rows.Close()
        out := []map[string]interface{}{}
        for rows.Next() {
                var id, name, ruleID, mode, bookURL, listURL, recrawlMode, storageMode, status, progress, stats, updatedAt, ruleName string
                var listStart, listEnd, bookStart, bookEnd, threadMin, threadMax, intervalMin, intervalMax, refreshIntervalMin int
                var smartCategory, smartComplete, autoSuggest, autoRefresh bool
                _ = rows.Scan(&id, &name, &ruleID, &mode, &bookURL, &listURL, &listStart, &listEnd,
                        &bookStart, &bookEnd, &recrawlMode, &storageMode, &threadMin, &threadMax,
                        &intervalMin, &intervalMax, &smartCategory, &smartComplete, &autoSuggest,
                        &autoRefresh, &refreshIntervalMin, &status, &progress, &stats, &updatedAt, &ruleName)
                // 解析 progress/stats 为对象 (失败则原样字符串)
                var progObj, statsObj interface{}
                if err := json.Unmarshal([]byte(progress), &progObj); err != nil {
                        progObj = map[string]interface{}{}
                }
                if err := json.Unmarshal([]byte(stats), &statsObj); err != nil {
                        statsObj = map[string]interface{}{}
                }
                out = append(out, map[string]interface{}{
                        "id": id, "name": name, "ruleId": ruleID, "ruleName": ruleName,
                        "mode": mode, "bookUrl": bookURL, "listUrl": listURL,
                        "listStart": listStart, "listEnd": listEnd,
                        "bookStart": bookStart, "bookEnd": bookEnd,
                        "recrawlMode": recrawlMode, "storageMode": storageMode,
                        "threadMin": threadMin, "threadMax": threadMax,
                        "intervalMin": intervalMin, "intervalMax": intervalMax,
                        "smartCategory": smartCategory, "smartComplete": smartComplete,
                        "autoSuggest": autoSuggest, "autoRefresh": autoRefresh,
                        "refreshIntervalMin": refreshIntervalMin,
                        "status": status, "progress": progObj, "stats": statsObj,
                        "updatedAt": updatedAt,
                })
        }
        writeJSONOK(w, out)
}

// adminTasksCreate — POST 创建任务 + 启动.
//
//      与 src/app/api/admin/tasks POST 同口径: 校验 ruleId + normalizeTaskData + validateTaskPair
//      创建 DB 行后异步调 crawl.ExecuteTask
func adminTasksCreate(w http.ResponseWriter, r *http.Request) {
        body := readJSONBody(r)
        ruleID := strField(body, "ruleId", 64)
        if ruleID == "" {
                writeJSONErr(w, "请选择采集规则", 400)
                return
        }
        // 取规则
        var ruleName, ruleConfig string
        var ruleEnabled bool
        err := db.QueryRow(`SELECT name, config, enabled FROM Rule WHERE id=?`, ruleID).
                Scan(&ruleName, &ruleConfig, &ruleEnabled)
        if err != nil {
                writeJSONErr(w, "规则不存在", 404)
                return
        }

        name := strField(body, "name", 100)
        if name == "" {
                writeJSONErr(w, "任务名称必填", 400)
                return
        }
        // mode
        mode := "range"
        if m := strField(body, "mode", 10); m == "single" || m == "urls" {
                mode = m
        }
        bookURL := httpURL(strField(body, "bookUrl", 2000))
        listURL := httpURL(strField(body, "listUrl", 2000))
        if mode == "single" && bookURL == "" {
                writeJSONErr(w, "单本模式必须填写书籍页URL", 400)
                return
        }
        if mode == "range" && listURL == "" {
                writeJSONErr(w, "范围模式必须填写列表页URL(含{page})", 400)
                return
        }
        // 范围钳制
        listStart := clampIntAdm(intField(body, "listStart", 1, 1, 100000), 1, 100000)
        listEnd := clampIntAdm(intField(body, "listEnd", 1, 1, 100000), 1, 100000)
        if listEnd < listStart {
                listStart, listEnd = listEnd, listStart
        }
        bookStart := clampIntAdm(intField(body, "bookStart", 0, 0, 100000), 0, 100000)
        bookEnd := clampIntAdm(intField(body, "bookEnd", 0, 0, 100000), 0, 100000)
        if bookStart > 0 && bookEnd > 0 && bookEnd < bookStart {
                bookStart, bookEnd = bookEnd, bookStart
        }
        recrawlMode := "incremental"
        if strField(body, "recrawlMode", 20) == "full" {
                recrawlMode = "full"
        }
        storageMode := "db"
        if strField(body, "storageMode", 10) == "txt" {
                storageMode = "txt"
        }
        threadMin := clampIntAdm(intField(body, "threadMin", 1, 1, 32), 1, 32)
        threadMax := clampIntAdm(intField(body, "threadMax", 3, 1, 32), 1, 32)
        if threadMax < threadMin {
                threadMax = threadMin
        }
        intervalMin := clampIntAdm(intField(body, "intervalMin", 500, 0, 600000), 0, 600000)
        intervalMax := clampIntAdm(intField(body, "intervalMax", 2000, 0, 600000), 0, 600000)
        if intervalMax < intervalMin {
                intervalMax = intervalMin
        }
        // fetchConfig
        fetchConfigStr := "{}"
        if v, ok := body["fetchConfig"]; ok && v != nil {
                if s, isStr := v.(string); isStr {
                        if len(s) > 50000 {
                                writeJSONErr(w, "反反爬配置过大", 400)
                                return
                        }
                        fetchConfigStr = s
                } else {
                        b, _ := json.Marshal(v)
                        if len(b) > 50000 {
                                writeJSONErr(w, "反反爬配置过大", 400)
                                return
                        }
                        fetchConfigStr = string(b)
                }
        }
        // 开关
        smartCategory := boolField(body, "smartCategory", true)
        smartComplete := boolField(body, "smartComplete", true)
        autoSuggest := boolField(body, "autoSuggest", true)
        autoRefresh := boolField(body, "autoRefresh", false)
        refreshIntervalMin := clampIntAdm(intField(body, "refreshIntervalMin", 30, 5, 1440), 5, 1440)

        taskID := generateID()
        _, err = db.Exec(
                `INSERT INTO Task
                   (id,name,ruleId,mode,bookUrl,listUrl,listStart,listEnd,bookStart,bookEnd,
                    recrawlMode,storageMode,fetchConfig,threadMin,threadMax,intervalMin,intervalMax,
                    smartCategory,smartComplete,autoSuggest,autoRefresh,refreshIntervalMin,
                    status,progress,stats,createdAt,updatedAt)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','{}','{}',datetime('now'),datetime('now'))`,
                taskID, name, ruleID, mode, bookURL, listURL, listStart, listEnd, bookStart, bookEnd,
                recrawlMode, storageMode, fetchConfigStr, threadMin, threadMax, intervalMin, intervalMax,
                smartCategory, smartComplete, autoSuggest, autoRefresh, refreshIntervalMin,
        )
        if err != nil {
                writeJSONErr(w, "创建任务失败: "+err.Error(), 500)
                return
        }

        // 异步启动采集
        go startCrawlTask(taskID, ruleID, ruleConfig, mode, bookURL, listURL, fetchConfigStr,
                threadMin, threadMax, intervalMin, intervalMax, recrawlMode)

        writeJSONOK(w, map[string]interface{}{
                "id": taskID, "name": name, "ruleId": ruleID, "ruleName": ruleName,
                "status": "running",
        })
}

// startCrawlTask — 异步启动 crawl.ExecuteTask (goroutine).
//
//      构建 crawl.ExecuteTaskConfig + 调 crawl.ExecuteTask (R38-1C 三阶段采集主入口).
//      错误隔离: 单任务失败不影响其他; 终态写回 DB.
func startCrawlTask(taskID, ruleID, ruleConfig, mode, bookURL, listURL, fetchConfigStr string,
        threadMin, threadMax, intervalMin, intervalMax int, recrawlMode string) {

        // 更新状态为 running
        _, _ = db.Exec(`UPDATE Task SET status='running', updatedAt=datetime('now') WHERE id=?`, taskID)

        // 1. 解析规则 (RuleConfig)
        rule := crawl.ParseRuleConfig(ruleConfig)

        // 2. 解析 fetchConfig 覆盖 (ParseRuleConfig 未导出 sanitizeFetchConfig, 这里用 json.Unmarshal 直接解码)
        override := crawl.DefaultFetchConfig
        if fetchConfigStr != "" && fetchConfigStr != "{}" {
                _ = json.Unmarshal([]byte(fetchConfigStr), &override)
        }

        // 3. 按模式处理 URLs
        switch mode {
        case "single":
                override.URLs = []string{bookURL}
        case "urls":
                // URLs 已在 override (fetchConfig.urls)
        case "range":
                // 列表页 URL 模板覆盖到 Rule.List.URLTemplate
                rule.List.URLTemplate = listURL
        }

        // 4. 并发度从 task 取 (max 优先, 否则 threadMin+threadMax/2)
        if override.Concurrency == 0 {
                concurrency := threadMax
                if concurrency < 1 {
                        concurrency = threadMin
                }
                if concurrency < 1 {
                        concurrency = 1
                }
                if concurrency > 10 {
                        concurrency = 10
                }
                override.Concurrency = concurrency
        }

        // 5. 构建 cfg
        adb := newAdminDB()
        cfg := crawl.ExecuteTaskConfig{
                TaskID:      taskID,
                Rule:        rule,
                Override:    override,
                URLTemplate: listURL,
                ThreadsMin:  threadMin,
                ThreadsMax:  threadMax,
                IntervalMin: intervalMin,
                IntervalMax: intervalMax,
                MaxRequests: override.MaxRequests,
                RecrawlMode: recrawlMode,
                DB:          adb,
                Logger: func(tid string, level crawl.LogLevel, msg string) {
                        log.Printf("[task:%s][%s] %s", tid, level, msg)
                },
        }

        // 6. 执行 (三阶段并发采集)
        ctx, cancel := context.WithCancel(context.Background())
        defer cancel()
        err := crawl.ExecuteTask(ctx, cfg)
        if err != nil {
                log.Printf("[task:%s] 采集失败: %v", taskID, err)
                _, _ = db.Exec(`UPDATE Task SET status='error', updatedAt=datetime('now') WHERE id=?`, taskID)
                return
        }
        // 终态由 ExecuteTask 内部已写 'done' (或 'stopped' 由 control 写); 这里兜底
        var curStatus string
        _ = db.QueryRow(`SELECT status FROM Task WHERE id=?`, taskID).Scan(&curStatus)
        if curStatus == "running" {
                _, _ = db.Exec(`UPDATE Task SET status='done', updatedAt=datetime('now') WHERE id=?`, taskID)
        }
}

// adminTaskControlHandler — POST /api/admin/tasks/:id/control (start/pause/stop).
//
//      与 src/app/api/admin/tasks/[id]/control POST 同口径.
//      start: 若 runtime 不存在 → 启动新任务 (调 startCrawlTask); 若存在且未运行 → MarkResumed.
//      pause: MarkPaused.
//      stop:  MarkStopped.
func adminTaskControlHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        // 提取 :id 与 action
        // path: /api/admin/tasks/{id}/control
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/tasks/"), "/")
        if len(parts) < 2 || parts[0] == "" || parts[1] != "control" {
                writeJSONErr(w, "路径格式错误", 404)
                return
        }
        taskID := parts[0]
        if taskID == "" {
                writeJSONErr(w, "缺少任务 id", 400)
                return
        }
        body := readJSONBody(r)
        action := strField(body, "action", 10)
        if action != "start" && action != "pause" && action != "stop" {
                writeJSONErr(w, "无效操作 (start/pause/stop)", 400)
                return
        }

        // 查任务
        var (
                name, ruleID, mode, bookURL, listURL, fetchConfigStr, recrawlMode, status string
                ruleConfig                                                                string
                threadMin, threadMax, intervalMin, intervalMax                            int
        )
        err := db.QueryRow(
                `SELECT t.name,t.ruleId,t.mode,t.bookUrl,t.listUrl,t.fetchConfig,t.recrawlMode,
                        t.threadMin,t.threadMax,t.intervalMin,t.intervalMax,t.status,
                        COALESCE(r.config,'{}')
                   FROM Task t LEFT JOIN Rule r ON t.ruleId=r.id
                  WHERE t.id=?`, taskID,
        ).Scan(&name, &ruleID, &mode, &bookURL, &listURL, &fetchConfigStr, &recrawlMode,
                &threadMin, &threadMax, &intervalMin, &intervalMax, &status, &ruleConfig)
        if err != nil {
                writeJSONErr(w, "任务不存在", 404)
                return
        }

        tr := crawl.GetTaskRunner()
        rt := tr.GetRuntime(taskID)

        switch action {
        case "start":
                // runtime 已存在且在运行 → 拒绝
                if rt != nil && rt.IsRunning() && !rt.IsPaused() && !rt.IsStopped() {
                        writeJSONErr(w, "任务已在运行中", 400)
                        return
                }
                // runtime 不存在 (首次 start 或已被回收) → 启动新 goroutine
                if rt == nil || rt.IsStopped() {
                        // 从 stopped/done/error 状态重新启动
                        _, _ = db.Exec(`UPDATE Task SET status='running', updatedAt=datetime('now') WHERE id=?`, taskID)
                        go startCrawlTask(taskID, ruleID, ruleConfig, mode, bookURL, listURL, fetchConfigStr,
                                threadMin, threadMax, intervalMin, intervalMax, recrawlMode)
                        writeJSONOK(w, map[string]interface{}{"action": "start", "taskId": taskID})
                        return
                }
                // 暂停状态 → MarkResumed
                if rt.IsPaused() {
                        rt.MarkResumed()
                        _, _ = db.Exec(`UPDATE Task SET status='running', updatedAt=datetime('now') WHERE id=?`, taskID)
                        writeJSONOK(w, map[string]interface{}{"action": "start", "taskId": taskID})
                        return
                }
                writeJSONErr(w, "任务状态异常, 无法启动", 400)

        case "pause":
                if rt == nil {
                        writeJSONErr(w, "任务未运行, 无法暂停", 400)
                        return
                }
                if !rt.IsRunning() {
                        writeJSONErr(w, "任务未运行, 无法暂停", 400)
                        return
                }
                rt.MarkPaused()
                _, _ = db.Exec(`UPDATE Task SET status='paused', updatedAt=datetime('now') WHERE id=?`, taskID)
                writeJSONOK(w, map[string]interface{}{"action": "pause", "taskId": taskID})

        case "stop":
                if rt == nil {
                        // 幂等: 已停止
                        _, _ = db.Exec(`UPDATE Task SET status='stopped', updatedAt=datetime('now') WHERE id=?`, taskID)
                        writeJSONOK(w, map[string]interface{}{"action": "stop", "taskId": taskID})
                        return
                }
                rt.MarkStopped()
                _, _ = db.Exec(`UPDATE Task SET status='stopped', updatedAt=datetime('now') WHERE id=?`, taskID)
                writeJSONOK(w, map[string]interface{}{"action": "stop", "taskId": taskID})
        }
}

// adminTaskSnapshotHandler — GET /api/admin/tasks/:id/snapshot 返回运行时快照.
func adminTaskSnapshotHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/tasks/"), "/")
        if len(parts) < 2 || parts[0] == "" || parts[1] != "snapshot" {
                writeJSONErr(w, "路径格式错误", 404)
                return
        }
        taskID := parts[0]
        tr := crawl.GetTaskRunner()
        snap := tr.Snapshot(taskID)
        if snap == nil {
                writeJSONErr(w, "无运行时快照 (任务可能未在运行)", 404)
                return
        }
        // 将 RecentLogs 序列化为可读 JSON
        logs := []map[string]interface{}{}
        for _, l := range snap.RecentLogs {
                logs = append(logs, map[string]interface{}{
                        "level":   string(l.Level),
                        "message": l.Message,
                        "ts":      l.TS,
                })
        }
        writeJSONOK(w, map[string]interface{}{
                "running":             snap.Running,
                "paused":              snap.Paused,
                "requestCount":         snap.RequestCount,
                "bytesFetched":         snap.BytesFetched,
                "runStartedAt":        snap.RunStartedAt,
                "currentURL":           snap.CurrentURL,
                "maxRequests":          snap.MaxRequests,
                "memResumeSetsSize":    snap.MemResumeSetsSize,
                "failedBookUrlsCount":  snap.FailedBookUrlsCount,
                "captchaEncountered":   snap.CaptchaEncountered,
                "recentLogs":           logs,
        })
}

// adminRulesHandler — GET 列规则 / POST 创建规则.
func adminRulesHandler(w http.ResponseWriter, r *http.Request) {
        switch r.Method {
        case http.MethodGet:
                adminRulesList(w, r)
        case http.MethodPost:
                adminRulesCreate(w, r)
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// adminRulesList — GET 列规则.
func adminRulesList(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query(`SELECT id,name,description,config,enabled,createdAt,updatedAt FROM Rule ORDER BY updatedAt DESC LIMIT 500`)
        if err != nil {
                writeJSONErr(w, "查询失败: "+err.Error(), 500)
                return
        }
        defer rows.Close()
        out := []map[string]interface{}{}
        for rows.Next() {
                var id, name, config, updatedAt string
                var description sql.NullString
                var enabled bool
                var createdAt string
                _ = rows.Scan(&id, &name, &description, &config, &enabled, &createdAt, &updatedAt)
                // 统计每个规则的任务数
                var taskCount int
                _ = db.QueryRow(`SELECT COUNT(*) FROM Task WHERE ruleId=?`, id).Scan(&taskCount)
                out = append(out, map[string]interface{}{
                        "id":          id,
                        "name":        name,
                        "description": description.String,
                        "config":      config,
                        "enabled":     enabled,
                        "taskCount":   taskCount,
                        "createdAt":   createdAt,
                        "updatedAt":   updatedAt,
                })
        }
        writeJSONOK(w, out)
}

// adminRulesCreate — POST 创建规则.
func adminRulesCreate(w http.ResponseWriter, r *http.Request) {
        body := readJSONBody(r)
        name := strField(body, "name", 100)
        if name == "" {
                writeJSONErr(w, "规则名称必填", 400)
                return
        }
        description := strField(body, "description", 500)
        enabled := boolField(body, "enabled", true)

        // config 字段
        var configStr string
        if v, ok := body["config"]; ok && v != nil {
                switch x := v.(type) {
                case string:
                        if len(x) > 200000 {
                                writeJSONErr(w, "规则配置过大", 400)
                                return
                        }
                        configStr = x
                default:
                        b, _ := json.Marshal(x)
                        if len(b) > 200000 {
                                writeJSONErr(w, "规则配置过大", 400)
                                return
                        }
                        configStr = string(b)
                }
        } else {
                // 用默认配置
                def := crawl.DefaultRuleConfig()
                b, _ := json.Marshal(def)
                configStr = string(b)
        }

        ruleID := generateID()
        _, err := db.Exec(
                `INSERT INTO Rule (id,name,description,config,enabled,createdAt,updatedAt) VALUES (?,?,?,?,?,datetime('now'),datetime('now'))`,
                ruleID, name, description, configStr, enabled,
        )
        if err != nil {
                writeJSONErr(w, "创建失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{
                "id": ruleID, "name": name, "description": description,
                "config": configStr, "enabled": enabled,
        })
}

// adminRuleByIDHandler — GET / PUT /api/admin/rules/:id.
func adminRuleByIDHandler(w http.ResponseWriter, r *http.Request) {
        // /api/admin/rules/{id}
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/rules/"), "/")
        if len(parts) < 1 || parts[0] == "" {
                writeJSONErr(w, "缺少规则 id", 400)
                return
        }
        ruleID := parts[0]
        switch r.Method {
        case http.MethodGet:
                var id, name, config, createdAt, updatedAt string
                var description sql.NullString
                var enabled bool
                err := db.QueryRow(`SELECT id,name,description,config,enabled,createdAt,updatedAt FROM Rule WHERE id=?`, ruleID).
                        Scan(&id, &name, &description, &config, &enabled, &createdAt, &updatedAt)
                if err != nil {
                        writeJSONErr(w, "规则不存在", 404)
                        return
                }
                // config 尝试解析为对象, 失败则原样
                var cfgObj interface{}
                if err := json.Unmarshal([]byte(config), &cfgObj); err != nil {
                        cfgObj = config
                }
                writeJSONOK(w, map[string]interface{}{
                        "id": id, "name": name, "description": description.String,
                        "config": cfgObj, "enabled": enabled,
                        "createdAt": createdAt, "updatedAt": updatedAt,
                })

        case http.MethodPut:
                body := readJSONBody(r)
                // 按字段增量更新 (enabled / name / description / config)
                sets := []string{}
                args := []interface{}{}
                if v, ok := body["name"]; ok && v != nil {
                        s := strField(body, "name", 100)
                        if s == "" {
                                writeJSONErr(w, "规则名称不能为空", 400)
                                return
                        }
                        sets = append(sets, "name=?")
                        args = append(args, s)
                }
                if v, ok := body["description"]; ok && v != nil {
                        sets = append(sets, "description=?")
                        args = append(args, strField(body, "description", 500))
                }
                if v, ok := body["enabled"]; ok && v != nil {
                        sets = append(sets, "enabled=?")
                        args = append(args, boolField(body, "enabled", true))
                }
                if v, ok := body["config"]; ok && v != nil {
                        var configStr string
                        switch x := v.(type) {
                        case string:
                                if len(x) > 200000 {
                                        writeJSONErr(w, "规则配置过大", 400)
                                        return
                                }
                                configStr = x
                        default:
                                b, _ := json.Marshal(x)
                                if len(b) > 200000 {
                                        writeJSONErr(w, "规则配置过大", 400)
                                        return
                                }
                                configStr = string(b)
                        }
                        sets = append(sets, "config=?")
                        args = append(args, configStr)
                }
                if len(sets) == 0 {
                        writeJSONErr(w, "无可更新字段", 400)
                        return
                }
                sets = append(sets, "updatedAt=datetime('now')")
                args = append(args, ruleID)
                _, err := db.Exec(`UPDATE Rule SET `+strings.Join(sets, ",")+` WHERE id=?`, args...)
                if err != nil {
                        writeJSONErr(w, "更新失败: "+err.Error(), 500)
                        return
                }
                writeJSONOK(w, map[string]interface{}{"id": ruleID, "updated": true})

        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// adminBooksAPIHandler — GET /api/admin/books 列书籍 (带 q/categoryId/status 过滤 + 分页).
func adminBooksAPIHandler(w http.ResponseWriter, r *http.Request) {
        q := likeSafe(r.URL.Query().Get("q"))
        categoryID := strings.TrimSpace(r.URL.Query().Get("categoryId"))
        status := strings.TrimSpace(r.URL.Query().Get("status"))
        page := clampIntAdm(toIntDefault(r.URL.Query().Get("page"), 1), 1, 1000000)
        size := clampIntAdm(toIntDefault(r.URL.Query().Get("size"), 20), 1, 50)

        // 构造 WHERE
        where := []string{"1=1"}
        args := []interface{}{}
        if q != "" {
                where = append(where, "(b.name LIKE ? ESCAPE '\\' OR b.author LIKE ? ESCAPE '\\')")
                args = append(args, "%"+q+"%", "%"+q+"%")
        }
        if categoryID != "" {
                where = append(where, "b.categoryId=?")
                args = append(args, categoryID)
        }
        if status == "unknown" || status == "ongoing" || status == "completed" {
                where = append(where, "b.status=?")
                args = append(args, status)
        }
        whereSQL := strings.Join(where, " AND ")

        // count
        var total int
        _ = db.QueryRow("SELECT COUNT(*) FROM Book b WHERE "+whereSQL, args...).Scan(&total)

        offset := (page - 1) * size
        if offset > 10000 {
                offset = 10000
        }
        queryArgs := append(args, size, offset)
        rows, err := db.Query(
                `SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,
                        COALESCE(c.name,'未分类'),b.categoryId,b.sourceUrl,b.storageMode,
                        (SELECT COUNT(*) FROM Chapter ch WHERE ch.bookId=b.id) AS chapterCount,
                        b.updatedAt
                   FROM Book b LEFT JOIN Category c ON b.categoryId=c.id
                  WHERE `+whereSQL+`
                  ORDER BY b.updatedAt DESC LIMIT ? OFFSET ?`,
                queryArgs...,
        )
        if err != nil {
                writeJSONErr(w, "查询失败: "+err.Error(), 500)
                return
        }
        defer rows.Close()
        books := []map[string]interface{}{}
        for rows.Next() {
                var id, name, author, intro, cover, status, latestChapter, category, categoryID, sourceURL, storageMode, updatedAt string
                var wordCount int64
                var chapterCount int
                _ = rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter,
                        &category, &categoryID, &sourceURL, &storageMode, &chapterCount, &updatedAt)
                books = append(books, map[string]interface{}{
                        "id":            id,
                        "name":          name,
                        "author":        author,
                        "intro":         truncate(intro, 200),
                        "cover":         cover,
                        "status":        status,
                        "wordCount":     wordCount,
                        "latestChapter": latestChapter,
                        "category":      category,
                        "categoryId":    categoryID,
                        "sourceUrl":     sourceURL,
                        "storageMode":   storageMode,
                        "chapterCount":  chapterCount,
                        "updatedAt":     updatedAt,
                })
        }
        writeJSONOK(w, map[string]interface{}{
                "total": total, "page": page, "size": size, "books": books,
        })
}

// toIntDefault — 字符串数字转 int, 失败给默认值.
func toIntDefault(s string, def int) int {
        if s == "" {
                return def
        }
        n, err := strconv.Atoi(s)
        if err != nil {
                return def
        }
        return n
}

// ---------- admin 页面 handlers ----------

// adminPageHandler — /admin + /admin/* 页面路由分发.
//
//      /admin            → dashboard
//      /admin/tasks       → tasks
//      /admin/books       → books
//      /admin/rules       → rules
//      /admin/sites       → sites
func adminPageHandler(w http.ResponseWriter, r *http.Request) {
        // 提取 sub path
        path := strings.TrimPrefix(r.URL.Path, "/admin")
        path = strings.TrimPrefix(path, "/")
        switch path {
        case "", "dashboard":
                renderAdminPage(w, "admin/dashboard", "dashboard", "仪表盘", r)
        case "tasks":
                renderAdminPage(w, "admin/tasks", "tasks", "采集任务", r)
        case "books":
                renderAdminPage(w, "admin/books", "books", "书籍管理", r)
        case "rules":
                renderAdminPage(w, "admin/rules", "rules", "采集规则", r)
        case "sites":
                renderAdminPage(w, "admin/sites", "sites", "站点管理", r)
        default:
                http.NotFound(w, r)
        }
}

// renderAdminPage — 装配通用 data + 渲染对应模板.
func renderAdminPage(w http.ResponseWriter, tmplName, active, title string, r *http.Request) {
        data := map[string]interface{}{
                "Title":  title,
                "Active": active,
        }
        switch tmplName {
        case "admin/dashboard":
                fillDashboardData(data)
        case "admin/tasks":
                fillTasksPageData(data, r)
        case "admin/books":
                fillBooksPageData(data, r)
        case "admin/rules":
                fillRulesPageData(data)
        case "admin/sites":
                fillSitesPageData(data)
        }
        if err := tmpls.ExecuteTemplate(w, tmplName, data); err != nil {
                http.Error(w, "模板渲染失败: "+err.Error(), 500)
        }
}

// fillDashboardData — 装配仪表盘数据 (统计 + 最近任务 + 最近书籍).
func fillDashboardData(data map[string]interface{}) {
        // 1. 统计计数
        var booksTotal, booksCompleted, booksOngoing, chaptersTotal, chaptersDay int
        var tasksTotal, tasksRunning, sitesTotal, rulesTotal, rulesEnabled int
        _ = db.QueryRow(`SELECT COUNT(*) FROM Book`).Scan(&booksTotal)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Book WHERE status='completed'`).Scan(&booksCompleted)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Book WHERE status='ongoing'`).Scan(&booksOngoing)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Chapter`).Scan(&chaptersTotal)
        // 24h 新增章节 (sqlite datetime)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Chapter WHERE updatedAt >= datetime('now','-1 day')`).Scan(&chaptersDay)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Task`).Scan(&tasksTotal)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Task WHERE status='running'`).Scan(&tasksRunning)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Site WHERE status=1`).Scan(&sitesTotal)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Rule`).Scan(&rulesTotal)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Rule WHERE enabled=1`).Scan(&rulesEnabled)

        data["BooksTotal"] = booksTotal
        data["BooksCompleted"] = booksCompleted
        data["BooksOngoing"] = booksOngoing
        data["ChaptersTotal"] = chaptersTotal
        data["ChaptersDay"] = chaptersDay
        data["TasksTotal"] = tasksTotal
        data["TasksRunning"] = tasksRunning
        data["SitesTotal"] = sitesTotal
        data["RulesTotal"] = rulesTotal
        data["RulesEnabled"] = rulesEnabled

        // 2. 最近任务 8 条
        rows, _ := db.Query(
                `SELECT t.id,t.name,t.status,t.progress,t.stats,t.updatedAt,
                        COALESCE(r.name,'(规则已删)')
                   FROM Task t LEFT JOIN Rule r ON t.ruleId=r.id
                  ORDER BY t.updatedAt DESC LIMIT 8`)
        recentTasks := []map[string]interface{}{}
        if rows != nil {
                defer rows.Close()
                for rows.Next() {
                        var id, name, status, progress, stats, updatedAt, ruleName string
                        _ = rows.Scan(&id, &name, &status, &progress, &stats, &updatedAt, &ruleName)
                        // 解析 progress (字段名与 crawl.TaskProgress Go 字段对齐, json.Marshal 默认用首字母大写)
                        var progObj map[string]interface{}
                        _ = json.Unmarshal([]byte(progress), &progObj)
                        phase, _ := progObj["Phase"].(string)
                        booksDone := toIntFromInterface(progObj["BooksDone"])
                        booksTotal := toIntFromInterface(progObj["BooksTotal"])
                        contentDone := toIntFromInterface(progObj["ContentDone"])
                        contentTotal := toIntFromInterface(progObj["ContentTotal"])
                        phaseNote, _ := progObj["PhaseNote"].(string)

                        pct := 0
                        if booksTotal > 0 {
                                pct = booksDone * 100 / booksTotal
                        } else if contentTotal > 0 {
                                pct = contentDone * 100 / contentTotal
                        }
                        if phase == "done" {
                                pct = 100
                        }
                        progressNote := fmt.Sprintf("%s · %d/%d 本 · %d/%d 章",
                                phaseLabel(phase), booksDone, booksTotal, contentDone, contentTotal)
                        if phaseNote != "" {
                                progressNote = phaseNote
                        }
                        recentTasks = append(recentTasks, map[string]interface{}{
                                "id":             id,
                                "name":           name,
                                "ruleName":       ruleName,
                                "status":         status,
                                "statusLabel":    statusChinese(status),
                                "progressPct":    pct,
                                "progressNote":   progressNote,
                                "updatedAtShort": shortTime(updatedAt),
                        })
                }
        }
        data["RecentTasks"] = recentTasks

        // 3. 最近书籍 8 条
        rows2, _ := db.Query(
                `SELECT b.id,b.name,b.author,b.status,b.updatedAt
                   FROM Book b ORDER BY b.updatedAt DESC LIMIT 8`)
        recentBooks := []map[string]interface{}{}
        if rows2 != nil {
                defer rows2.Close()
                for rows2.Next() {
                        var id, name, author, status, updatedAt string
                        _ = rows2.Scan(&id, &name, &author, &status, &updatedAt)
                        recentBooks = append(recentBooks, map[string]interface{}{
                                "id":        id,
                                "name":      name,
                                "author":    author,
                                "status":    status,
                                "updatedAt": updatedAt,
                        })
                }
        }
        data["RecentBooks"] = recentBooks
}

// fillTasksPageData — 装配任务页数据.
func fillTasksPageData(data map[string]interface{}, r *http.Request) {
        status := strings.TrimSpace(r.URL.Query().Get("status"))
        validStatuses := map[string]bool{"pending": true, "running": true, "paused": true, "stopped": true, "done": true, "error": true}
        data["FilterStatus"] = status

        var rows *sql.Rows
        var err error
        if status != "" && validStatuses[status] {
                rows, err = db.Query(
                        `SELECT t.id,t.name,t.ruleId,t.mode,t.recrawlMode,t.status,t.progress,t.stats,t.updatedAt,
                                COALESCE(r.name,'(规则已删)')
                           FROM Task t LEFT JOIN Rule r ON t.ruleId=r.id
                          WHERE t.status=? ORDER BY t.updatedAt DESC LIMIT 200`, status)
        } else {
                rows, err = db.Query(
                        `SELECT t.id,t.name,t.ruleId,t.mode,t.recrawlMode,t.status,t.progress,t.stats,t.updatedAt,
                                COALESCE(r.name,'(规则已删)')
                           FROM Task t LEFT JOIN Rule r ON t.ruleId=r.id
                          ORDER BY t.updatedAt DESC LIMIT 200`)
        }
        tasks := []map[string]interface{}{}
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, name, ruleID, mode, recrawlMode, status, progress, stats, updatedAt, ruleName string
                        _ = rows.Scan(&id, &name, &ruleID, &mode, &recrawlMode, &status, &progress, &stats, &updatedAt, &ruleName)
                        var progObj map[string]interface{}
                        _ = json.Unmarshal([]byte(progress), &progObj)
                        var statsObj map[string]interface{}
                        _ = json.Unmarshal([]byte(stats), &statsObj)

                        phase, _ := progObj["Phase"].(string)
                        booksDone := toIntFromInterface(progObj["BooksDone"])
                        booksTotal := toIntFromInterface(progObj["BooksTotal"])
                        contentDone := toIntFromInterface(progObj["ContentDone"])
                        contentTotal := toIntFromInterface(progObj["ContentTotal"])
                        phaseNote, _ := progObj["PhaseNote"].(string)

                        pct := 0
                        if booksTotal > 0 {
                                pct = booksDone * 100 / booksTotal
                        } else if contentTotal > 0 {
                                pct = contentDone * 100 / contentTotal
                        }
                        if phase == "done" {
                                pct = 100
                        }
                        progressNote := fmt.Sprintf("%s · %d/%d 本 · %d/%d 章",
                                phaseLabel(phase), booksDone, booksTotal, contentDone, contentTotal)
                        if phaseNote != "" {
                                progressNote = phaseNote
                        }
                        tasks = append(tasks, map[string]interface{}{
                                "id":             id,
                                "name":           name,
                                "ruleName":       ruleName,
                                "mode":           mode,
                                "modeLabel":      modeChinese(mode),
                                "recrawlMode":   recrawlMode,
                                "status":         status,
                                "statusLabel":    statusChinese(status),
                                "progressPct":    pct,
                                "progressNote":   progressNote,
                                "statBooks":      toIntFromInterface(statsObj["BooksCreated"]) + toIntFromInterface(statsObj["BooksUpdated"]),
                                "statChapters":   toIntFromInterface(statsObj["ChaptersCreated"]) + toIntFromInterface(statsObj["ChaptersUpdated"]),
                                "statErrors":     toIntFromInterface(statsObj["Errors"]),
                                "updatedAtShort": shortTime(updatedAt),
                        })
                }
        }
        data["Tasks"] = tasks
        data["Total"] = len(tasks)

        // 规则列表 (供新建任务 modal)
        rulesRows, _ := db.Query(`SELECT id,name,enabled FROM Rule ORDER BY updatedAt DESC LIMIT 100`)
        rules := []map[string]interface{}{}
        if rulesRows != nil {
                defer rulesRows.Close()
                for rulesRows.Next() {
                        var id, name string
                        var enabled bool
                        _ = rulesRows.Scan(&id, &name, &enabled)
                        rules = append(rules, map[string]interface{}{
                                "id": id, "name": name, "enabled": enabled,
                        })
                }
        }
        data["Rules"] = rules
}

// fillBooksPageData — 装配书籍页数据 (带搜索 + 过滤 + 分页).
func fillBooksPageData(data map[string]interface{}, r *http.Request) {
        q := likeSafe(r.URL.Query().Get("q"))
        categoryID := strings.TrimSpace(r.URL.Query().Get("categoryId"))
        status := strings.TrimSpace(r.URL.Query().Get("status"))
        page := clampIntAdm(toIntDefault(r.URL.Query().Get("page"), 1), 1, 1000000)
        size := 20

        data["FilterQ"] = r.URL.Query().Get("q")
        data["FilterCategory"] = categoryID
        data["FilterStatus"] = status

        // 分类列表
        cats, _ := getCategories()
        data["Categories"] = cats

        // 构造 WHERE
        where := []string{"1=1"}
        args := []interface{}{}
        if q != "" {
                where = append(where, "(b.name LIKE ? ESCAPE '\\' OR b.author LIKE ? ESCAPE '\\')")
                args = append(args, "%"+q+"%", "%"+q+"%")
        }
        if categoryID != "" {
                where = append(where, "b.categoryId=?")
                args = append(args, categoryID)
        }
        if status == "unknown" || status == "ongoing" || status == "completed" {
                where = append(where, "b.status=?")
                args = append(args, status)
        }
        whereSQL := strings.Join(where, " AND ")

        // count
        var total int
        _ = db.QueryRow("SELECT COUNT(*) FROM Book b WHERE "+whereSQL, args...).Scan(&total)
        totalPages := (total + size - 1) / size
        if totalPages < 1 {
                totalPages = 1
        }
        if page > totalPages {
                page = totalPages
        }

        offset := (page - 1) * size
        if offset > 10000 {
                offset = 10000
        }
        queryArgs := append(args, size, offset)
        rows, err := db.Query(
                `SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,
                        COALESCE(c.name,'未分类'),b.categoryId,b.sourceUrl,b.storageMode,
                        (SELECT COUNT(*) FROM Chapter ch WHERE ch.bookId=b.id) AS chapterCount,
                        b.updatedAt
                   FROM Book b LEFT JOIN Category c ON b.categoryId=c.id
                  WHERE `+whereSQL+`
                  ORDER BY b.updatedAt DESC LIMIT ? OFFSET ?`,
                queryArgs...,
        )
        books := []map[string]interface{}{}
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, name, author, intro, cover, status, latestChapter, category, catID, sourceURL, storageMode, updatedAt string
                        var wordCount int64
                        var chapterCount int
                        _ = rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter,
                                &category, &catID, &sourceURL, &storageMode, &chapterCount, &updatedAt)
                        books = append(books, map[string]interface{}{
                                "id":            id,
                                "name":          name,
                                "author":        author,
                                "intro":         truncate(intro, 120),
                                "cover":         cover,
                                "status":        status,
                                "wordCount":     wordCount,
                                "category":      category,
                                "categoryId":    catID,
                                "storageMode":   storageMode,
                                "chapterCount":  chapterCount,
                                "updatedAt":     updatedAt,
                        })
                }
        }
        data["Books"] = books
        data["Total"] = total
        data["Page"] = page
        data["Size"] = size
        data["TotalPages"] = totalPages
        data["PageList"] = buildPageList(page, totalPages)
}

// fillRulesPageData — 装配规则页数据.
func fillRulesPageData(data map[string]interface{}) {
        rows, err := db.Query(`SELECT id,name,description,config,enabled,updatedAt FROM Rule ORDER BY updatedAt DESC LIMIT 200`)
        rules := []map[string]interface{}{}
        total, enabledCount, disabledCount := 0, 0, 0
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, name, config, updatedAt string
                        var description sql.NullString
                        var enabled bool
                        _ = rows.Scan(&id, &name, &description, &config, &enabled, &updatedAt)
                        var taskCount int
                        _ = db.QueryRow(`SELECT COUNT(*) FROM Task WHERE ruleId=?`, id).Scan(&taskCount)
                        rules = append(rules, map[string]interface{}{
                                "id":          id,
                                "name":        name,
                                "description": description.String,
                                "config":      config,
                                "enabled":     enabled,
                                "taskCount":   taskCount,
                                "updatedAt":   updatedAt,
                        })
                        total++
                        if enabled {
                                enabledCount++
                        } else {
                                disabledCount++
                        }
                }
        }
        data["Rules"] = rules
        data["Total"] = total
        data["EnabledCount"] = enabledCount
        data["DisabledCount"] = disabledCount
}

// fillSitesPageData — 装配站点页数据.
func fillSitesPageData(data map[string]interface{}) {
        rows, err := db.Query(
                `SELECT id,name,domain,themeId,isDefault,title,description,keywords,offset,status
                   FROM Site ORDER BY isDefault DESC, name ASC LIMIT 200`)
        sites := []map[string]interface{}{}
        total := 0
        defaultName := "-"
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, name, domain, themeID, title, desc, kw string
                        var isDefault, status bool
                        var offset int
                        _ = rows.Scan(&id, &name, &domain, &themeID, &isDefault, &title, &desc, &kw, &offset, &status)
                        sites = append(sites, map[string]interface{}{
                                "id":         id,
                                "name":       name,
                                "domain":     domain,
                                "themeId":    themeID,
                                "isDefault":  isDefault,
                                "title":      title,
                                "status":     status,
                                "offset":     offset,
                        })
                        total++
                        if isDefault {
                                defaultName = name
                        }
                }
        }
        data["Sites"] = sites
        data["Total"] = total
        data["DefaultSiteName"] = defaultName
}

// ---------- 辅助: 状态/模式 中文标签 ----------

func statusChinese(s string) string {
        switch s {
        case "pending":
                return "待运行"
        case "running":
                return "运行中"
        case "paused":
                return "已暂停"
        case "stopped":
                return "已停止"
        case "done":
                return "已完成"
        case "error":
                return "错误"
        }
        return s
}

func modeChinese(m string) string {
        switch m {
        case "single":
                return "单本"
        case "range":
                return "范围"
        case "urls":
                return "URL列表"
        }
        return m
}

func phaseLabel(p string) string {
        switch p {
        case "list":
                return "列表发现"
        case "book":
                return "书籍Meta"
        case "content":
                return "章节采集"
        case "done":
                return "已完成"
        }
        if p == "" {
                return "待运行"
        }
        return p
}

// toIntFromInterface — interface{} → int (支持 float64/int64/int/string).
func toIntFromInterface(v interface{}) int {
        switch x := v.(type) {
        case float64:
                return int(x)
        case int:
                return x
        case int64:
                return int(x)
        case string:
                n, _ := strconv.Atoi(x)
                return n
        }
        return 0
}

// shortTime — SQLite datetime 字符串 → 紧凑形式 "MM-DD HH:MM".
func shortTime(s string) string {
        if len(s) >= 16 {
                // "2024-09-21 11:30" → "09-21 11:30"
                return s[5:7] + "-" + s[8:10] + " " + s[11:16]
        }
        if len(s) >= 10 {
                return s[5:10]
        }
        return s
}
