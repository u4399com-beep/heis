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
        "io"
        "log"
        "net/http"
        "net/url"
        "regexp"
        "sort"
        "strconv"
        "strings"
        "sync"
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
        // R44-1C 修复: 原实现 s[:max] 按字节切片, 中文 (3-byte UTF-8) 在边界处会切出孤立
        //   continuation byte (admin 字段如 name/description/adminNote 大量中文输入).
        //   改用 []rune 安全截断 (与 main.go truncate 同款).
        if max > 0 && len([]rune(s)) > max {
                s = string([]rune(s)[:max])
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
//      /admin/categories  → categories  (R40-1B)
//      /admin/links       → links       (R40-1B)
//      /admin/themes      → themes      (R40-1B)
//      /admin/downloads   → downloads   (R40-1B)
//      /admin/settings    → settings    (R40-1B)
//      /admin/feedback    → feedback    (R40-1B)
//      /admin/backup      → backup      (R40-1B)
//      /admin/seo-audit   → seo-audit   (R40-1B)
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
        case "categories":
                renderAdminPage(w, "admin/categories", "categories", "分类管理", r)
        case "links":
                renderAdminPage(w, "admin/links", "links", "友链链轮", r)
        case "themes":
                renderAdminPage(w, "admin/themes", "themes", "主题模板", r)
        case "downloads":
                renderAdminPage(w, "admin/downloads", "downloads", "下载任务", r)
        case "settings":
                renderAdminPage(w, "admin/settings", "settings", "系统设置", r)
        case "feedback":
                renderAdminPage(w, "admin/feedback", "feedback", "用户反馈", r)
        case "backup":
                renderAdminPage(w, "admin/backup", "backup", "数据备份", r)
        case "seo-audit":
                renderAdminPage(w, "admin/seo-audit", "seo-audit", "SEO审计", r)
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
        case "admin/categories":
                fillCategoriesPageData(data)
        case "admin/links":
                fillLinksPageData(data)
        case "admin/themes":
                fillThemesPageData(data)
        case "admin/downloads":
                fillDownloadsPageData(data)
        case "admin/settings":
                fillSettingsPageData(data)
        case "admin/feedback":
                fillFeedbackPageData(data, r)
        case "admin/backup":
                fillBackupPageData(data)
        case "admin/seo-audit":
                fillSeoAuditPageData(data, r)
        }
        if err := tmpls.ExecuteTemplate(w, tmplName, data); err != nil {
                // R41-1B: 不暴露内部模板错误细节给客户端 (防信息泄漏)
                log.Printf("[renderAdminPage] template %s render failed: %v", tmplName, err)
                http.Error(w, "模板渲染失败", 500)
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

// ==================== R40-1B 新增: 分类/友链/主题/下载/设置/反馈/备份/SEO审计 ====================

// ---------- 主题静态注册表 (与 src/lib/crawl/themes.ts THEMES 同口径) ----------

// adminTheme 简化的主题描述, 用于 admin 主题管理页面 + API 返回.
// 与 TS THEMES 字段对齐: id/name/desc/layout/dark/contentSelector/read.{layout,fontBase}.
type adminTheme struct {
        ID           string
        Name         string
        Desc         string
        Layout       string
        Dark         bool
        ContentSel   string
        ReadLayout   string
        ReadFontBase int
        PreviewBg    string
        PreviewText  string
}

// adminThemes 10 套精仿主题 (与 src/lib/crawl/themes.ts THEMES 数组同口径).
// 字段顺序与 TS 一致, 供 /api/admin/themes 与 /admin/themes SSR 直接消费.
var adminThemes = []adminTheme{
        {ID: "clone-aijjxs", Name: "精仿·久久小说", Desc: "像素级精仿·久久小说 aijjxs.com: 实测 :root CSS 变量·双层 radial-gradient 奶油底+白卡+青绿+琥珀+14px圆角", Layout: "clone-aijjxs", Dark: false, ContentSel: "#view_content_txt", ReadLayout: "classic", ReadFontBase: 17, PreviewBg: "#f3efe7", PreviewText: "#115e59"},
        {ID: "clone-ddyueshu", Name: "精仿·得得小说", Desc: "像素级精仿·得得小说 ddyueshu.cc: GBK 编码·宋体 12px·浅蓝底 #E9FAFF·天蓝头 #88C6E5·蓝紫链 #6F78A7·2px 直角", Layout: "clone-ddyueshu", Dark: false, ContentSel: "#content", ReadLayout: "classic", ReadFontBase: 16, PreviewBg: "#E9FAFF", PreviewText: "#6F78A7"},
        {ID: "clone-pilishuwu", Name: "精仿·霹雳书屋", Desc: "像素级精仿·霹雳书屋 pilishuwu.com: wmcms-web 模板·暖橙 #fd8929 / 红橙 hover #ec5245·复古 2px 直角·橙头搜索按钮", Layout: "clone-pilishuwu", Dark: false, ContentSel: "#content", ReadLayout: "classic", ReadFontBase: 17, PreviewBg: "#fff5e6", PreviewText: "#d71704"},
        {ID: "clone-23qb", Name: "精仿·铅笔小说", Desc: "像素级精仿·铅笔小说 23qb.net: 实测 CSS 浅灰底 #f8f9f9·鲜红 hover #ff2a14·5:7 封面卡·5px 圆角", Layout: "clone-23qb", Dark: false, ContentSel: "#content", ReadLayout: "classic", ReadFontBase: 17, PreviewBg: "#f8f9f9", PreviewText: "#ff2a14"},
        {ID: "clone-101kks", Name: "精仿·101kks", Desc: "像素级精仿·101看書 101kks.com: 繁体·米黄头 #fff2df·蓝紫渐变封面块·白卡+10px 圆角·14px 字号", Layout: "clone-101kks", Dark: false, ContentSel: "#content", ReadLayout: "classic", ReadFontBase: 17, PreviewBg: "#f2f3f4", PreviewText: "#2f468f"},
        {ID: "clone-huangjinwu", Name: "精仿·黄金屋", Desc: "像素级精仿·黄金屋 huangjinwu.org: 实测 :root 23 CSS 变量·玻璃 backdrop-blur header+蓝色主调+6px 圆角+渐变底", Layout: "clone-huangjinwu", Dark: false, ContentSel: "#content", ReadLayout: "classic", ReadFontBase: 17, PreviewBg: "linear-gradient(180deg,#f5f8ff 0%,#eef3fb 100%)", PreviewText: "#1e40af"},
        {ID: "clone-ggd66", Name: "精仿·ggd66", Desc: "像素级精仿·格格党 ggd66.com: 实测 CSS 薄荷绿头 #56ccb5·青绿链 #00886d·橙红 hover #f50·4px 圆角·复古卡片", Layout: "clone-ggd66", Dark: false, ContentSel: "#content", ReadLayout: "classic", ReadFontBase: 16, PreviewBg: "#f9f9f9", PreviewText: "#00886d"},
        {ID: "clone-shipsay", Name: "精仿·船说CMS", Desc: "像素级精仿·船说CMS demo.shipsay.com: 红色主色 #ed4259·深灰头 #3e3d43·灰底 #f4f4f4·3px 圆角·hover 红边框", Layout: "clone-shipsay", Dark: false, ContentSel: ".content", ReadLayout: "classic", ReadFontBase: 14, PreviewBg: "#f4f4f4", PreviewText: "#ed4259"},
        {ID: "clone-x2552", Name: "精仿·x2552", Desc: "像素级精仿·吾爱文学 x2552.com: GBK 编码·960px 老框架·蓝紫链 #2f468f·橙 hover #ff6600·3px 圆角", Layout: "clone-x2552", Dark: false, ContentSel: "#content", ReadLayout: "classic", ReadFontBase: 16, PreviewBg: "#fafafa", PreviewText: "#2f468f"},
        {ID: "clone-trxsw", Name: "精仿·天人小说", Desc: "像素级精仿·天人小说 trxsw.com: 唐人小说路由·.vlist 章节列表+.detail 详情+.content 正文+.pager 翻页·简洁现代深蓝主色", Layout: "clone-trxsw", Dark: false, ContentSel: ".content", ReadLayout: "classic", ReadFontBase: 16, PreviewBg: "#f0f4f8", PreviewText: "#1e3a5f"},
}

// ---------- 分类管理 API ----------

// adminCategoriesHandler — GET 列分类 / POST 新建分类.
//   GET  /api/admin/categories       → 列分类 (含 bookCount)
//   POST /api/admin/categories       → 新建分类 (name + sortOrder)
func adminCategoriesHandler(w http.ResponseWriter, r *http.Request) {
        switch r.Method {
        case http.MethodGet:
                adminCategoriesList(w, r)
        case http.MethodPost:
                adminCategoriesCreate(w, r)
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// adminCategoryByIDHandler — PUT / DELETE /api/admin/categories/:id.
func adminCategoryByIDHandler(w http.ResponseWriter, r *http.Request) {
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/categories/"), "/")
        if len(parts) < 1 || parts[0] == "" {
                writeJSONErr(w, "缺少分类 id", 400)
                return
        }
        id := parts[0]
        switch r.Method {
        case http.MethodPut:
                body := readJSONBody(r)
                sets := []string{}
                args := []interface{}{}
                if v, ok := body["name"]; ok && v != nil {
                        name := strField(body, "name", 50)
                        if name == "" {
                                writeJSONErr(w, "分类名不能为空", 400)
                                return
                        }
                        sets = append(sets, "name=?")
                        args = append(args, name)
                }
                if v, ok := body["sortOrder"]; ok && v != nil {
                        sets = append(sets, "sortOrder=?")
                        args = append(args, clampIntAdm(intField(body, "sortOrder", 0, 0, 1000000), 0, 1000000))
                }
                if len(sets) == 0 {
                        writeJSONErr(w, "无可更新字段", 400)
                        return
                }
                args = append(args, id)
                _, err := db.Exec(`UPDATE Category SET `+strings.Join(sets, ",")+` WHERE id=?`, args...)
                if err != nil {
                        if strings.Contains(err.Error(), "UNIQUE") {
                                writeJSONErr(w, "分类名已存在, 请换一个名称", 400)
                                return
                        }
                        writeJSONErr(w, "更新失败: "+err.Error(), 500)
                        return
                }
                writeJSONOK(w, map[string]interface{}{"id": id, "updated": true})
        case http.MethodDelete:
                var count int
                _ = db.QueryRow(`SELECT COUNT(*) FROM Book WHERE categoryId=?`, id).Scan(&count)
                if count > 0 {
                        writeJSONErr(w, fmt.Sprintf("该分类下有 %d 本书, 请先移除", count), 400)
                        return
                }
                _, err := db.Exec(`DELETE FROM Category WHERE id=?`, id)
                if err != nil {
                        writeJSONErr(w, "删除失败: "+err.Error(), 500)
                        return
                }
                writeJSONOK(w, map[string]interface{}{"id": id, "deleted": true})
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

func adminCategoriesList(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query(`SELECT id, name, sortOrder, createdAt FROM Category ORDER BY sortOrder ASC LIMIT 500`)
        if err != nil {
                writeJSONErr(w, "查询失败: "+err.Error(), 500)
                return
        }
        defer rows.Close()
        out := []map[string]interface{}{}
        for rows.Next() {
                var id, name, createdAt string
                var sortOrder int
                _ = rows.Scan(&id, &name, &sortOrder, &createdAt)
                var bookCount int
                _ = db.QueryRow(`SELECT COUNT(*) FROM Book WHERE categoryId=?`, id).Scan(&bookCount)
                out = append(out, map[string]interface{}{
                        "id": id, "name": name, "sortOrder": sortOrder,
                        "bookCount": bookCount, "createdAt": createdAt,
                })
        }
        writeJSONOK(w, out)
}

func adminCategoriesCreate(w http.ResponseWriter, r *http.Request) {
        body := readJSONBody(r)
        name := strField(body, "name", 50)
        if name == "" {
                writeJSONErr(w, "分类名必填", 400)
                return
        }
        var maxSort sql.NullInt64
        _ = db.QueryRow(`SELECT MAX(sortOrder) FROM Category`).Scan(&maxSort)
        sortOrder := int(maxSort.Int64) + 1
        if v, ok := body["sortOrder"]; ok && v != nil {
                sortOrder = clampIntAdm(intField(body, "sortOrder", sortOrder, 0, 1000000), 0, 1000000)
        }
        id := generateID()
        _, err := db.Exec(`INSERT INTO Category (id, name, sortOrder, createdAt) VALUES (?,?,?,datetime('now'))`, id, name, sortOrder)
        if err != nil {
                if strings.Contains(err.Error(), "UNIQUE") {
                        // 同名 → upsert 语义, 返回已有行
                        var existID string
                        _ = db.QueryRow(`SELECT id FROM Category WHERE name=?`, name).Scan(&existID)
                        writeJSONOK(w, map[string]interface{}{"id": existID, "name": name, "upserted": true})
                        return
                }
                writeJSONErr(w, "创建失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{"id": id, "name": name, "sortOrder": sortOrder})
}

// ---------- 友链管理 API ----------

// adminLinksHandler — GET 列 / POST 新建 / PUT 改 (body.id) / DELETE (?id).
//   与 TS 路由同口径: 单一 endpoint 处理 4 种方法, id 走 body 或 query.
func adminLinksHandler(w http.ResponseWriter, r *http.Request) {
        switch r.Method {
        case http.MethodGet:
                adminLinksList(w, r)
        case http.MethodPost:
                adminLinksCreate(w, r)
        case http.MethodPut:
                body := readJSONBody(r)
                updateLinkFromBody(w, body)
        case http.MethodDelete:
                id := strings.TrimSpace(r.URL.Query().Get("id"))
                if id == "" {
                        writeJSONErr(w, "缺少 id", 400)
                        return
                }
                deleteLinkByID(w, id)
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// adminLinkByIDHandler — PUT / DELETE /api/admin/links/:id (Go-friendly 路径参数).
func adminLinkByIDHandler(w http.ResponseWriter, r *http.Request) {
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/links/"), "/")
        if len(parts) < 1 || parts[0] == "" {
                writeJSONErr(w, "缺少友链 id", 400)
                return
        }
        id := parts[0]
        switch r.Method {
        case http.MethodPut:
                body := readJSONBody(r)
                body["id"] = id
                updateLinkFromBody(w, body)
        case http.MethodDelete:
                deleteLinkByID(w, id)
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

func adminLinksList(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query(`SELECT id, name, url, logo, sortOrder, enabled, createdAt, updatedAt FROM FriendLink ORDER BY sortOrder ASC, createdAt ASC LIMIT 500`)
        if err != nil {
                writeJSONErr(w, "查询失败: "+err.Error(), 500)
                return
        }
        defer rows.Close()
        out := []map[string]interface{}{}
        for rows.Next() {
                var id, name, urlV, logo, createdAt, updatedAt string
                var sortOrder int
                var enabled bool
                _ = rows.Scan(&id, &name, &urlV, &logo, &sortOrder, &enabled, &createdAt, &updatedAt)
                out = append(out, map[string]interface{}{
                        "id": id, "name": name, "url": urlV, "logo": logo,
                        "sortOrder": sortOrder, "enabled": enabled,
                        "createdAt": createdAt, "updatedAt": updatedAt,
                })
        }
        writeJSONOK(w, out)
}

// normalizeLinkURL 与 TS normalizeLinkUrl 同语义: 无 scheme:// 自动补 https:// 后校验 http(s).
func normalizeLinkURL(raw string) string {
        s := strings.TrimSpace(raw)
        if s == "" {
                return ""
        }
        candidate := s
        if !linkSchemePrefixRE.MatchString(s) {
                candidate = "https://" + s
        }
        return httpURL(candidate)
}

// normalizeLinkLogo 与 TS normalizeLogo 同语义: 空 | / 站内 | http(s) 外链 | // 开头拒.
func normalizeLinkLogo(raw string) (string, string) {
        s := strings.TrimSpace(raw)
        if s == "" {
                return "", ""
        }
        if strings.HasPrefix(s, "//") {
                return "", "logo 不支持 // 开头的协议相对地址"
        }
        if strings.HasPrefix(s, "/") {
                return s, ""
        }
        // R42-1A: strings.HasPrefix 替代 inline regexp.MustCompile, 等价 http(s):// 前缀校验
        if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
                if v := httpURL(s); v != "" {
                        return v, ""
                }
                return "", "logo 地址非法(仅支持 http/https)"
        }
        return "", "logo 仅支持 http(s) 外链或站内 / 开头路径"
}

func adminLinksCreate(w http.ResponseWriter, r *http.Request) {
        body := readJSONBody(r)
        name := strField(body, "name", 60)
        if name == "" {
                writeJSONErr(w, "名称必填(1~60字)", 400)
                return
        }
        linkURL := normalizeLinkURL(strField(body, "url", 2000))
        if linkURL == "" {
                writeJSONErr(w, "链接地址非法(仅支持 http/https)", 400)
                return
        }
        logo := strField(body, "logo", 2000)
        logo, logoErr := normalizeLinkLogo(logo)
        if logoErr != "" {
                writeJSONErr(w, logoErr, 400)
                return
        }
        sortOrder := clampIntAdm(intField(body, "sortOrder", 0, 0, 99999), 0, 99999)
        enabled := boolField(body, "enabled", true)
        id := generateID()
        _, err := db.Exec(`INSERT INTO FriendLink (id, name, url, logo, sortOrder, enabled, createdAt, updatedAt) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))`,
                id, name, linkURL, logo, sortOrder, enabled)
        if err != nil {
                writeJSONErr(w, "创建失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{
                "id": id, "name": name, "url": linkURL, "logo": logo,
                "sortOrder": sortOrder, "enabled": enabled,
        })
}

func updateLinkFromBody(w http.ResponseWriter, body map[string]interface{}) {
        id := strField(body, "id", 64)
        if id == "" {
                writeJSONErr(w, "缺少 id", 400)
                return
        }
        var exist string
        _ = db.QueryRow(`SELECT id FROM FriendLink WHERE id=?`, id).Scan(&exist)
        if exist == "" {
                writeJSONErr(w, "友链不存在", 404)
                return
        }
        sets := []string{}
        args := []interface{}{}
        if v, ok := body["name"]; ok && v != nil {
                name := strField(body, "name", 60)
                if name == "" {
                        writeJSONErr(w, "名称不能为空(1~60字)", 400)
                        return
                }
                sets = append(sets, "name=?")
                args = append(args, name)
        }
        if v, ok := body["url"]; ok && v != nil {
                u := normalizeLinkURL(strField(body, "url", 2000))
                if u == "" {
                        writeJSONErr(w, "链接地址非法(仅支持 http/https)", 400)
                        return
                }
                sets = append(sets, "url=?")
                args = append(args, u)
        }
        if v, ok := body["logo"]; ok && v != nil {
                logo := strField(body, "logo", 2000)
                logo, err := normalizeLinkLogo(logo)
                if err != "" {
                        writeJSONErr(w, err, 400)
                        return
                }
                sets = append(sets, "logo=?")
                args = append(args, logo)
        }
        if v, ok := body["sortOrder"]; ok && v != nil {
                sets = append(sets, "sortOrder=?")
                args = append(args, clampIntAdm(intField(body, "sortOrder", 0, 0, 99999), 0, 99999))
        }
        if v, ok := body["enabled"]; ok && v != nil {
                sets = append(sets, "enabled=?")
                args = append(args, boolField(body, "enabled", true))
        }
        if len(sets) == 0 {
                writeJSONErr(w, "无可更新字段", 400)
                return
        }
        sets = append(sets, "updatedAt=datetime('now')")
        args = append(args, id)
        _, err := db.Exec(`UPDATE FriendLink SET `+strings.Join(sets, ",")+` WHERE id=?`, args...)
        if err != nil {
                writeJSONErr(w, "更新失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{"id": id, "updated": true})
}

func deleteLinkByID(w http.ResponseWriter, id string) {
        _, err := db.Exec(`DELETE FROM FriendLink WHERE id=?`, id)
        if err != nil {
                writeJSONErr(w, "删除失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{"id": id, "deleted": true})
}

// ---------- 主题 API ----------

func adminThemesHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        // 计算每主题站点数
        rows, err := db.Query(`SELECT themeId, COUNT(*) FROM Site GROUP BY themeId`)
        counts := map[string]int{}
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var themeID string
                        var n int
                        _ = rows.Scan(&themeID, &n)
                        counts[themeID] = n
                }
        }
        out := []map[string]interface{}{}
        for _, t := range adminThemes {
                m := map[string]interface{}{
                        "id":             t.ID,
                        "name":           t.Name,
                        "desc":           t.Desc,
                        "layout":         t.Layout,
                        "dark":           t.Dark,
                        "contentSelector": t.ContentSel,
                        "read": map[string]interface{}{
                                "layout":   t.ReadLayout,
                                "fontBase": t.ReadFontBase,
                        },
                        "siteCount": counts[t.ID],
                }
                out = append(out, m)
        }
        writeJSONOK(w, out)
}

// ---------- 下载任务 API ----------

const maxConcurrentDownloadJobs = 3

// R41-1B: downloadFiles 内存兜底 — 容量上限 + TTL 过期 (防内存泄漏)
const (
        downloadFilesMaxEntries = 50              // 最多缓存 50 个 TXT (单 TXT 可达数十 MB)
        downloadFilesTTLSeconds = 60 * 60 * 2    // 2h 后过期 (用户有充足时间取)
)

type downloadFileEntry struct {
        content  string
        createdAt time.Time
}

var (
        downloadInFlight   int
        downloadInFlightMu sync.Mutex
        downloadFiles      = map[string]downloadFileEntry{}
        downloadFilesMu    sync.Mutex
)

func adminDownloadsHandler(w http.ResponseWriter, r *http.Request) {
        switch r.Method {
        case http.MethodGet:
                adminDownloadsList(w, r)
        case http.MethodPost:
                adminDownloadsCreate(w, r)
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

func adminDownloadsList(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query(`SELECT d.id, d.bookId, COALESCE(b.name,'(已删)'), COALESCE(b.author,''), d.options, d.status, COALESCE(d.filePath,''), COALESCE(d.error,''), d.size, d.createdAt FROM DownloadJob d LEFT JOIN Book b ON d.bookId=b.id ORDER BY d.createdAt DESC LIMIT 500`)
        if err != nil {
                writeJSONErr(w, "查询失败: "+err.Error(), 500)
                return
        }
        defer rows.Close()
        out := []map[string]interface{}{}
        for rows.Next() {
                var id, bookID, bookName, bookAuthor, options, status, filePath, errMsg, createdAt string
                var size int
                _ = rows.Scan(&id, &bookID, &bookName, &bookAuthor, &options, &status, &filePath, &errMsg, &size, &createdAt)
                out = append(out, map[string]interface{}{
                        "id": id, "bookId": bookID, "bookName": bookName, "bookAuthor": bookAuthor,
                        "options": options, "status": status, "filePath": filePath,
                        "error": errMsg, "size": size, "createdAt": createdAt,
                })
        }
        writeJSONOK(w, out)
}

func adminDownloadsCreate(w http.ResponseWriter, r *http.Request) {
        body := readJSONBody(r)
        bookID := strField(body, "bookId", 64)
        if bookID == "" {
                writeJSONErr(w, "请选择书籍", 400)
                return
        }
        var bookName string
        var chapterCount int
        err := db.QueryRow(`SELECT name, (SELECT COUNT(*) FROM Chapter WHERE bookId=?) FROM Book WHERE id=?`, bookID, bookID).Scan(&bookName, &chapterCount)
        if err != nil {
                writeJSONErr(w, "书籍不存在", 404)
                return
        }
        if chapterCount == 0 {
                writeJSONErr(w, "该书暂无章节, 无法生成下载", 400)
                return
        }
        // 清扫陈旧在途任务 (>1h 无终态 → 标记 error)
        _, _ = db.Exec(`UPDATE DownloadJob SET status='error', error='生成中断(陈旧任务清扫)' WHERE status IN ('pending','running') AND createdAt < datetime('now','-1 hour')`)

        // 并发占位检查
        var dbActive int
        _ = db.QueryRow(`SELECT COUNT(*) FROM DownloadJob WHERE status IN ('pending','running')`).Scan(&dbActive)
        downloadInFlightMu.Lock()
        inFlightNow := downloadInFlight
        if dbActive >= maxConcurrentDownloadJobs || inFlightNow >= maxConcurrentDownloadJobs {
                downloadInFlightMu.Unlock()
                writeJSONErr(w, fmt.Sprintf("已有 %d 个下载任务进行中, 请稍后再试", maxConcurrentDownloadJobs), 429)
                return
        }
        downloadInFlight++
        downloadInFlightMu.Unlock()

        options := map[string]interface{}{}
        if v, ok := body["siteInfo"]; ok && v != nil {
                options["siteInfo"] = boolField(body, "siteInfo", false)
        }
        if v, ok := body["siteName"]; ok && v != nil {
                options["siteName"] = strField(body, "siteName", 100)
        }
        if v, ok := body["siteUrl"]; ok && v != nil {
                u := httpURL(strField(body, "siteUrl", 2000))
                if strField(body, "siteUrl", 2000) != "" && u == "" {
                        downloadInFlightMu.Lock()
                        downloadInFlight--
                        downloadInFlightMu.Unlock()
                        writeJSONErr(w, "站点URL格式非法(需 http/https)", 400)
                        return
                }
                options["siteUrl"] = u
        }
        if v, ok := body["insertAds"]; ok && v != nil {
                options["insertAds"] = boolField(body, "insertAds", false)
        }
        if v, ok := body["ads"]; ok && v != nil {
                if arr, ok2 := v.([]interface{}); ok2 {
                        ads := []string{}
                        for _, a := range arr {
                                if s, isStr := a.(string); isStr {
                                        s = strings.TrimSpace(s)
                                        // R44-1C 修复: 原 s[:200] 按字节切片, 中文 ad 文本可能斩半.
                                        if len([]rune(s)) > 200 {
                                                s = string([]rune(s)[:200])
                                        }
                                        if s != "" {
                                                ads = append(ads, s)
                                        }
                                        if len(ads) >= 20 {
                                                break
                                        }
                                }
                        }
                        options["ads"] = ads
                }
        }
        if v, ok := body["adInterval"]; ok && v != nil {
                options["adInterval"] = clampIntAdm(intField(body, "adInterval", 10, 1, 1000), 1, 1000)
        }
        if v, ok := body["obfuscate"]; ok && v != nil {
                options["obfuscate"] = boolField(body, "obfuscate", false)
        }
        if v, ok := body["obfuscateMode"]; ok && v != nil {
                mode := strField(body, "obfuscateMode", 20)
                valid := map[string]bool{"zero-width": true, "homoglyph": true, "punctuation": true, "mixed": true}
                if !valid[mode] {
                        downloadInFlightMu.Lock()
                        downloadInFlight--
                        downloadInFlightMu.Unlock()
                        writeJSONErr(w, "无效的混淆模式", 400)
                        return
                }
                options["obfuscateMode"] = mode
        }
        if v, ok := body["obfuscateDensity"]; ok && v != nil {
                n := 0.0
                if f, ok2 := v.(float64); ok2 {
                        n = f
                }
                if n < 0 {
                        n = 0
                }
                if n > 1 {
                        n = 1
                }
                options["obfuscateDensity"] = n
        }
        if v, ok := body["headerTemplate"]; ok && v != nil {
                options["headerTemplate"] = strField(body, "headerTemplate", 5000)
        }
        if v, ok := body["footerTemplate"]; ok && v != nil {
                options["footerTemplate"] = strField(body, "footerTemplate", 5000)
        }
        optionsJSON, _ := json.Marshal(options)
        jobID := generateID()
        _, err = db.Exec(`INSERT INTO DownloadJob (id, bookId, options, status, size, createdAt) VALUES (?,?,?,'pending',0,datetime('now'))`,
                jobID, bookID, string(optionsJSON))
        if err != nil {
                downloadInFlightMu.Lock()
                downloadInFlight--
                downloadInFlightMu.Unlock()
                writeJSONErr(w, "创建失败: "+err.Error(), 500)
                return
        }

        // 异步生成 TXT (Go 端简化版: 章节序号+标题+正文 拼接, 不混淆)
        go func(jid, bid, bname string) {
                defer func() {
                        downloadInFlightMu.Lock()
                        downloadInFlight--
                        downloadInFlightMu.Unlock()
                }()
                _, _ = db.Exec(`UPDATE DownloadJob SET status='running' WHERE id=?`, jid)
                type chRow struct {
                        idx     int
                        title   string
                        volume  string
                        content string
                }
                chapters := []chRow{}
                crows, err := db.Query(`SELECT idx, title, COALESCE(volume,''), COALESCE(content,'') FROM Chapter WHERE bookId=? ORDER BY idx ASC`, bid)
                if err != nil {
                        _, _ = db.Exec(`UPDATE DownloadJob SET status='error', error=? WHERE id=?`, "查询章节失败: "+err.Error(), jid)
                        return
                }
                for crows.Next() {
                        var c chRow
                        _ = crows.Scan(&c.idx, &c.title, &c.volume, &c.content)
                        chapters = append(chapters, c)
                }
                crows.Close()
                var sb strings.Builder
                sb.WriteString(bname + "\n\n")
                for _, c := range chapters {
                        if c.volume != "" {
                                sb.WriteString(c.volume + "\n")
                        }
                        sb.WriteString(fmt.Sprintf("第%d章 %s\n\n", c.idx, c.title))
                        sb.WriteString(c.content + "\n\n")
                }
                txt := sb.String()
                downloadFilesMu.Lock()
                // R41-1B: 容量上限 + TTL 过期检查 (防内存泄漏)
                now := time.Now()
                // 先清扫过期条目
                for k, v := range downloadFiles {
                        if now.Sub(v.createdAt) > downloadFilesTTLSeconds*time.Second {
                                delete(downloadFiles, k)
                        }
                }
                // 若仍超容, 删最早的
                for len(downloadFiles) >= downloadFilesMaxEntries {
                        var oldestKey string
                        var oldestT time.Time
                        for k, v := range downloadFiles {
                                if oldestKey == "" || v.createdAt.Before(oldestT) {
                                        oldestKey = k
                                        oldestT = v.createdAt
                                }
                        }
                        delete(downloadFiles, oldestKey)
                }
                downloadFiles[jid] = downloadFileEntry{content: txt, createdAt: now}
                downloadFilesMu.Unlock()
                _, _ = db.Exec(`UPDATE DownloadJob SET status='done', filePath=?, size=? WHERE id=?`, "memory:"+jid, len(txt), jid)
        }(jobID, bookID, bookName)

        writeJSONOK(w, map[string]interface{}{
                "id": jobID, "bookId": bookID, "bookName": bookName,
                "status": "pending",
        })
}

// adminDownloadFileHandler — GET /api/admin/downloads/:id/file 返回 TXT 文件下载.
func adminDownloadFileHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/downloads/"), "/")
        if len(parts) < 2 || parts[1] != "file" {
                writeJSONErr(w, "路径格式错误", 404)
                return
        }
        jobID := parts[0]
        var status, bookName string
        err := db.QueryRow(`SELECT d.status, COALESCE(b.name,'book') FROM DownloadJob d LEFT JOIN Book b ON d.bookId=b.id WHERE d.id=?`, jobID).Scan(&status, &bookName)
        if err != nil {
                writeJSONErr(w, "任务不存在", 404)
                return
        }
        if status != "done" {
                writeJSONErr(w, "任务尚未完成", 400)
                return
        }
        downloadFilesMu.Lock()
        entry, ok := downloadFiles[jobID]
        // R41-1B: TTL 过期校验
        if ok && time.Since(entry.createdAt) > downloadFilesTTLSeconds*time.Second {
                delete(downloadFiles, jobID)
                ok = false
        }
        downloadFilesMu.Unlock()
        if !ok {
                writeJSONErr(w, "文件已过期, 请重新生成", 410)
                return
        }
        txt := entry.content
        w.Header().Set("Content-Type", "text/plain; charset=utf-8")
        w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.txt"`, url.QueryEscape(bookName)))
        w.Header().Set("Content-Length", strconv.Itoa(len(txt)))
        w.Write([]byte(txt))
}

// ---------- 系统设置 API ----------

var settingKeyRE = regexp.MustCompile(`^[A-Za-z0-9_.\-]{1,64}$`)

// R42-1A: 包级预编译正则 (替代 inline regexp.MustCompile, 防 per-request 重复编译开销 + 防
//         每次 PATCH 反馈都重新编译正则导致的高频路径 GC 压力)
var (
        // linkSchemePrefixRE — URL scheme 前缀校验 (与 normalizeLinkURL 同款)
        linkSchemePrefixRE = regexp.MustCompile(`^[a-z][a-z0-9+.-]*://`)
        // tagStripRE — 剥离 HTML 标签 (与 adminFeedbackByIDHandler PATCH adminNote 同款, 防存储型 XSS)
        tagStripRE = regexp.MustCompile(`<[^>]+>`)
)

const settingValueMax = 100000

func adminSettingsHandler(w http.ResponseWriter, r *http.Request) {
        switch r.Method {
        case http.MethodGet:
                adminSettingsList(w, r)
        case http.MethodPut:
                adminSettingsUpdate(w, r)
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

func adminSettingsList(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query(`SELECT key, value FROM Setting LIMIT 200`)
        if err != nil {
                writeJSONErr(w, "查询失败: "+err.Error(), 500)
                return
        }
        defer rows.Close()
        out := map[string]interface{}{}
        for rows.Next() {
                var key, value string
                _ = rows.Scan(&key, &value)
                var v interface{}
                if err := json.Unmarshal([]byte(value), &v); err != nil {
                        v = value
                }
                out[key] = v
        }
        writeJSONOK(w, out)
}

func adminSettingsUpdate(w http.ResponseWriter, r *http.Request) {
        body := readJSONBody(r)
        if len(body) == 0 {
                writeJSONErr(w, "没有需要保存的设置项", 400)
                return
        }
        if len(body) > 100 {
                writeJSONErr(w, "单次最多保存 100 个设置项", 400)
                return
        }
        type kv struct{ key, value string }
        pairs := make([]kv, 0, len(body))
        for k, v := range body {
                if !settingKeyRE.MatchString(k) {
                        writeJSONErr(w, "非法的设置项 key: "+k, 400)
                        return
                }
                b, err := json.Marshal(v)
                if err != nil {
                        writeJSONErr(w, "设置项 "+k+" 不可序列化", 400)
                        return
                }
                if len(b) > settingValueMax {
                        writeJSONErr(w, "设置项 "+k+" 过大(上限100KB)", 400)
                        return
                }
                pairs = append(pairs, kv{key: k, value: string(b)})
        }
        // R42-1A: 单事务包裹所有 keys (失败回滚防半保存状态). 之前逐 key Exec 失败留下"前 N 个已保存"的半提交脏状态.
        tx, txErr := db.BeginTx(r.Context(), nil)
        if txErr != nil {
                writeJSONErr(w, "开启事务失败: "+txErr.Error(), 500)
                return
        }
        committed := false
        defer func() {
                if !committed {
                        _ = tx.Rollback()
                }
        }()
        for _, p := range pairs {
                if _, err := tx.Exec(`INSERT INTO Setting (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, p.key, p.value); err != nil {
                        writeJSONErr(w, "保存 "+p.key+" 失败: "+err.Error(), 500)
                        return
                }
        }
        if err := tx.Commit(); err != nil {
                writeJSONErr(w, "提交事务失败: "+err.Error(), 500)
                return
        }
        committed = true
        adminSettingsList(w, r)
}

// ---------- 反馈管理 API ----------

func adminFeedbackHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        q := likeSafe(r.URL.Query().Get("q"))
        status := strings.TrimSpace(r.URL.Query().Get("status"))
        typ := strings.TrimSpace(r.URL.Query().Get("type"))
        page := clampIntAdm(toIntDefault(r.URL.Query().Get("page"), 1), 1, 10000)
        size := clampIntAdm(toIntDefault(r.URL.Query().Get("size"), 20), 5, 100)
        validStatus := map[string]bool{"new": true, "read": true, "resolved": true, "ignored": true}
        validType := map[string]bool{"bug": true, "suggestion": true, "praise": true, "other": true}

        where := []string{"1=1"}
        args := []interface{}{}
        if status != "" && validStatus[status] {
                where = append(where, "status=?")
                args = append(args, status)
        }
        if typ != "" && validType[typ] {
                where = append(where, "type=?")
                args = append(args, typ)
        }
        if q != "" {
                where = append(where, "content LIKE ? ESCAPE '\\'")
                args = append(args, "%"+q+"%")
        }
        whereSQL := strings.Join(where, " AND ")
        var total int
        _ = db.QueryRow("SELECT COUNT(*) FROM Feedback WHERE "+whereSQL, args...).Scan(&total)
        totalPages := (total + size - 1) / size
        if totalPages < 1 {
                totalPages = 1
        }
        if page > totalPages {
                page = totalPages
        }
        offset := (page - 1) * size
        listArgs := append(args, size, offset)
        rows, err := db.Query(`SELECT id, type, COALESCE(contact,''), content, COALESCE(url,''), COALESCE(siteId,''), status, COALESCE(ip,''), COALESCE(adminNote,''), createdAt, updatedAt FROM Feedback WHERE `+whereSQL+` ORDER BY createdAt DESC LIMIT ? OFFSET ?`, listArgs...)
        rowsList := []map[string]interface{}{}
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, typV, contact, content, urlV, siteID, statusV, ip, adminNote, createdAt, updatedAt string
                        _ = rows.Scan(&id, &typV, &contact, &content, &urlV, &siteID, &statusV, &ip, &adminNote, &createdAt, &updatedAt)
                        rowsList = append(rowsList, map[string]interface{}{
                                "id": id, "type": typV, "contact": contact, "content": content,
                                "url": urlV, "siteId": siteID, "status": statusV, "ip": ip,
                                "adminNote": adminNote, "createdAt": createdAt, "updatedAt": updatedAt,
                        })
                }
        }
        var allCount, newCount, resolvedCount int
        _ = db.QueryRow(`SELECT COUNT(*) FROM Feedback`).Scan(&allCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Feedback WHERE status='new'`).Scan(&newCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Feedback WHERE status='resolved'`).Scan(&resolvedCount)
        writeJSONOK(w, map[string]interface{}{
                "rows": rowsList, "total": total, "page": page, "size": size,
                "pages": totalPages,
                "stats": map[string]interface{}{"total": allCount, "new": newCount, "resolved": resolvedCount},
        })
}

func adminFeedbackByIDHandler(w http.ResponseWriter, r *http.Request) {
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/feedback/"), "/")
        if len(parts) < 1 || parts[0] == "" {
                writeJSONErr(w, "缺少反馈 id", 400)
                return
        }
        id := parts[0]
        switch r.Method {
        case http.MethodGet:
                var idV, typ, contact, content, urlV, siteID, status, ip, ua, adminNote, createdAt, updatedAt string
                err := db.QueryRow(`SELECT id, type, COALESCE(contact,''), content, COALESCE(url,''), COALESCE(siteId,''), status, COALESCE(ip,''), COALESCE(userAgent,''), COALESCE(adminNote,''), createdAt, updatedAt FROM Feedback WHERE id=?`, id).
                        Scan(&idV, &typ, &contact, &content, &urlV, &siteID, &status, &ip, &ua, &adminNote, &createdAt, &updatedAt)
                if err != nil {
                        writeJSONErr(w, "反馈不存在", 404)
                        return
                }
                writeJSONOK(w, map[string]interface{}{
                        "id": idV, "type": typ, "contact": contact, "content": content,
                        "url": urlV, "siteId": siteID, "status": status, "ip": ip,
                        "userAgent": ua, "adminNote": adminNote,
                        "createdAt": createdAt, "updatedAt": updatedAt,
                })
        case http.MethodPatch:
                // 检查存在性
                var exist string
                _ = db.QueryRow(`SELECT id FROM Feedback WHERE id=?`, id).Scan(&exist)
                if exist == "" {
                        writeJSONErr(w, "反馈不存在", 404)
                        return
                }
                body := readJSONBody(r)
                sets := []string{}
                args := []interface{}{}
                if v, ok := body["status"]; ok && v != nil {
                        s := strField(body, "status", 20)
                        valid := map[string]bool{"new": true, "read": true, "resolved": true, "ignored": true}
                        if !valid[s] {
                                writeJSONErr(w, "状态值不合法", 400)
                                return
                        }
                        sets = append(sets, "status=?")
                        args = append(args, s)
                }
                if v, ok := body["adminNote"]; ok && v != nil {
                        note := strField(body, "adminNote", 1000)
                        note = tagStripRE.ReplaceAllString(note, "")
                        // R44-1C 修复: 原 note[:1000] 按字节切片, 中文 (3-byte UTF-8) 在边界处
                        //   会切出孤立 continuation byte. strField 已按 rune 截断到 ≤1000, 但 tagStripRE
                        //   剥标签后 byte 长度仍可能 >1000 (因中文字符 3 byte/rune, 350 runes = 1050 bytes).
                        //   改用 []rune 防多字节字符斩半.
                        if len([]rune(note)) > 1000 {
                                note = string([]rune(note)[:1000])
                        }
                        note = strings.TrimSpace(note)
                        if note == "" {
                                sets = append(sets, "adminNote=NULL")
                        } else {
                                sets = append(sets, "adminNote=?")
                                args = append(args, note)
                        }
                }
                if len(sets) == 0 {
                        writeJSONErr(w, "没有可更新字段", 400)
                        return
                }
                sets = append(sets, "updatedAt=datetime('now')")
                args = append(args, id)
                _, err := db.Exec(`UPDATE Feedback SET `+strings.Join(sets, ",")+` WHERE id=?`, args...)
                if err != nil {
                        writeJSONErr(w, "更新失败: "+err.Error(), 500)
                        return
                }
                writeJSONOK(w, map[string]interface{}{"id": id, "updated": true})
        case http.MethodDelete:
                var exist string
                _ = db.QueryRow(`SELECT id FROM Feedback WHERE id=?`, id).Scan(&exist)
                if exist == "" {
                        writeJSONErr(w, "反馈不存在", 404)
                        return
                }
                _, err := db.Exec(`DELETE FROM Feedback WHERE id=?`, id)
                if err != nil {
                        writeJSONErr(w, "删除失败: "+err.Error(), 500)
                        return
                }
                writeJSONOK(w, map[string]interface{}{"id": id, "deleted": true})
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// ---------- 数据备份 API ----------

const backupBigBooksThreshold = 200

func adminBackupHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        exportedAt := time.Now().UTC().Format(time.RFC3339)
        var bookCount, chapterCount int
        _ = db.QueryRow(`SELECT COUNT(*) FROM Book`).Scan(&bookCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Chapter`).Scan(&chapterCount)
        bigBooks := bookCount > backupBigBooksThreshold

        // settings
        type kv struct{ key, value string }
        settings := []kv{}
        if rows, err := db.Query(`SELECT key, value FROM Setting LIMIT 500`); err == nil {
                for rows.Next() {
                        var k, v string
                        _ = rows.Scan(&k, &v)
                        settings = append(settings, kv{k, v})
                }
                rows.Close()
        }
        // categories
        categories := []map[string]interface{}{}
        if rows, err := db.Query(`SELECT id, name, sortOrder, createdAt FROM Category LIMIT 500`); err == nil {
                for rows.Next() {
                        var id, name, createdAt string
                        var so int
                        _ = rows.Scan(&id, &name, &so, &createdAt)
                        categories = append(categories, map[string]interface{}{"id": id, "name": name, "sortOrder": so, "createdAt": createdAt})
                }
                rows.Close()
        }
        // sites
        sites := []map[string]interface{}{}
        if rows, err := db.Query(`SELECT id, name, domain, themeId, COALESCE(title,''), COALESCE(description,''), COALESCE(keywords,''), COALESCE(icbm,''), COALESCE(geoRegion,''), COALESCE(geoPlacename,''), offset, isDefault, status, inLinkWheel, createdAt, updatedAt FROM Site LIMIT 500`); err == nil {
                for rows.Next() {
                        var id, name, domain, themeID, title, desc, kw, icbm, geoR, geoP string
                        var offset int
                        var isDefault, status, inLinkWheel bool
                        var createdAt, updatedAt string
                        _ = rows.Scan(&id, &name, &domain, &themeID, &title, &desc, &kw, &icbm, &geoR, &geoP, &offset, &isDefault, &status, &inLinkWheel, &createdAt, &updatedAt)
                        sites = append(sites, map[string]interface{}{
                                "id": id, "name": name, "domain": domain, "themeId": themeID,
                                "title": title, "description": desc, "keywords": kw,
                                "icbm": icbm, "geoRegion": geoR, "geoPlacename": geoP, "offset": offset,
                                "isDefault": isDefault, "status": status, "inLinkWheel": inLinkWheel,
                                "createdAt": createdAt, "updatedAt": updatedAt,
                        })
                }
                rows.Close()
        }
        // friendLinks
        friendLinks := []map[string]interface{}{}
        if rows, err := db.Query(`SELECT id, name, url, logo, sortOrder, enabled, createdAt, updatedAt FROM FriendLink LIMIT 500`); err == nil {
                for rows.Next() {
                        var id, name, urlV, logo, createdAt, updatedAt string
                        var so int
                        var en bool
                        _ = rows.Scan(&id, &name, &urlV, &logo, &so, &en, &createdAt, &updatedAt)
                        friendLinks = append(friendLinks, map[string]interface{}{
                                "id": id, "name": name, "url": urlV, "logo": logo,
                                "sortOrder": so, "enabled": en, "createdAt": createdAt, "updatedAt": updatedAt,
                        })
                }
                rows.Close()
        }
        // rules
        rules := []map[string]interface{}{}
        if rows, err := db.Query(`SELECT id, name, COALESCE(description,''), config, enabled, createdAt, updatedAt FROM Rule LIMIT 500`); err == nil {
                for rows.Next() {
                        var id, name, desc, cfg, createdAt, updatedAt string
                        var en bool
                        _ = rows.Scan(&id, &name, &desc, &cfg, &en, &createdAt, &updatedAt)
                        rules = append(rules, map[string]interface{}{
                                "id": id, "name": name, "description": desc, "config": cfg,
                                "enabled": en, "createdAt": createdAt, "updatedAt": updatedAt,
                        })
                }
                rows.Close()
        }
        // tasks
        tasks := []map[string]interface{}{}
        if rows, err := db.Query(`SELECT id, name, ruleId, mode, bookUrl, listUrl, listStart, listEnd, bookStart, bookEnd, recrawlMode, storageMode, fetchConfig, threadMin, threadMax, intervalMin, intervalMax, smartCategory, smartComplete, autoSuggest, autoRefresh, refreshIntervalMin, status, progress, stats, createdAt, updatedAt FROM Task LIMIT 5000`); err == nil {
                for rows.Next() {
                        var t struct {
                                id, name, ruleID, mode, bookURL, listURL, recrawlMode, storageMode, fetchConfig string
                                listStart, listEnd, bookStart, bookEnd, threadMin, threadMax, intervalMin, intervalMax, refreshIntervalMin int
                                smartCategory, smartComplete, autoSuggest, autoRefresh bool
                                status, progress, stats, createdAt, updatedAt string
                        }
                        _ = rows.Scan(&t.id, &t.name, &t.ruleID, &t.mode, &t.bookURL, &t.listURL, &t.listStart, &t.listEnd, &t.bookStart, &t.bookEnd, &t.recrawlMode, &t.storageMode, &t.fetchConfig, &t.threadMin, &t.threadMax, &t.intervalMin, &t.intervalMax, &t.smartCategory, &t.smartComplete, &t.autoSuggest, &t.autoRefresh, &t.refreshIntervalMin, &t.status, &t.progress, &t.stats, &t.createdAt, &t.updatedAt)
                        tasks = append(tasks, map[string]interface{}{
                                "id": t.id, "name": t.name, "ruleId": t.ruleID, "mode": t.mode,
                                "bookUrl": t.bookURL, "listUrl": t.listURL, "listStart": t.listStart, "listEnd": t.listEnd,
                                "bookStart": t.bookStart, "bookEnd": t.bookEnd, "recrawlMode": t.recrawlMode, "storageMode": t.storageMode,
                                "fetchConfig": t.fetchConfig, "threadMin": t.threadMin, "threadMax": t.threadMax,
                                "intervalMin": t.intervalMin, "intervalMax": t.intervalMax,
                                "smartCategory": t.smartCategory, "smartComplete": t.smartComplete,
                                "autoSuggest": t.autoSuggest, "autoRefresh": t.autoRefresh,
                                "refreshIntervalMin": t.refreshIntervalMin,
                                "status": t.status, "progress": t.progress, "stats": t.stats,
                                "createdAt": t.createdAt, "updatedAt": t.updatedAt,
                        })
                }
                rows.Close()
        }
        // downloadJobs
        downloadJobs := []map[string]interface{}{}
        if rows, err := db.Query(`SELECT id, bookId, options, status, COALESCE(filePath,''), COALESCE(error,''), size, createdAt FROM DownloadJob LIMIT 5000`); err == nil {
                for rows.Next() {
                        var id, bookID, options, status, filePath, errMsg, createdAt string
                        var size int
                        _ = rows.Scan(&id, &bookID, &options, &status, &filePath, &errMsg, &size, &createdAt)
                        downloadJobs = append(downloadJobs, map[string]interface{}{
                                "id": id, "bookId": bookID, "options": options, "status": status,
                                "filePath": filePath, "error": errMsg, "size": size, "createdAt": createdAt,
                        })
                }
                rows.Close()
        }
        // books (+chapters if !bigBooks)
        books := []map[string]interface{}{}
        bookQuery := `SELECT id, name, author, COALESCE(categoryId,''), intro, cover, status, keywords, latestChapter, wordCount, sourceUrl, COALESCE(sourceRuleId,''), storageMode, COALESCE(collectedAt,''), createdAt, updatedAt FROM Book`
        if rows, err := db.Query(bookQuery); err == nil {
                for rows.Next() {
                        var b struct {
                                id, name, author, catID, intro, cover, status, kw, latest string
                                wc int
                                srcURL, srcRule, storageMode, collectedAt, createdAt, updatedAt string
                        }
                        _ = rows.Scan(&b.id, &b.name, &b.author, &b.catID, &b.intro, &b.cover, &b.status, &b.kw, &b.latest, &b.wc, &b.srcURL, &b.srcRule, &b.storageMode, &b.collectedAt, &b.createdAt, &b.updatedAt)
                        bookItem := map[string]interface{}{
                                "id": b.id, "name": b.name, "author": b.author, "categoryId": b.catID,
                                "intro": b.intro, "cover": b.cover, "status": b.status, "keywords": b.kw,
                                "latestChapter": b.latest, "wordCount": b.wc, "sourceUrl": b.srcURL,
                                "sourceRuleId": b.srcRule, "storageMode": b.storageMode, "collectedAt": b.collectedAt,
                                "createdAt": b.createdAt, "updatedAt": b.updatedAt,
                        }
                        if !bigBooks {
                                chapters := []map[string]interface{}{}
                                if crows, err := db.Query(`SELECT id, bookId, idx, title, COALESCE(volume,''), COALESCE(url,''), COALESCE(content,''), storage, COALESCE(filePath,''), wordCount, fetched, createdAt, updatedAt FROM Chapter WHERE bookId=? ORDER BY idx ASC`, b.id); err == nil {
                                        for crows.Next() {
                                                var c struct {
                                                        id, bookID, title, volume, urlV, content, storage, filePath, createdAt, updatedAt string
                                                        idx, wc int
                                                        fetched bool
                                                }
                                                _ = crows.Scan(&c.id, &c.bookID, &c.idx, &c.title, &c.volume, &c.urlV, &c.content, &c.storage, &c.filePath, &c.wc, &c.fetched, &c.createdAt, &c.updatedAt)
                                                chapters = append(chapters, map[string]interface{}{
                                                        "id": c.id, "bookId": c.bookID, "idx": c.idx, "title": c.title,
                                                        "volume": c.volume, "url": c.urlV, "content": c.content, "storage": c.storage,
                                                        "filePath": c.filePath, "wordCount": c.wc, "fetched": c.fetched,
                                                        "createdAt": c.createdAt, "updatedAt": c.updatedAt,
                                                })
                                        }
                                        crows.Close()
                                }
                                tags := []map[string]interface{}{}
                                if trows, err := db.Query(`SELECT id, bookId, tag, source, hits FROM BookTag WHERE bookId=?`, b.id); err == nil {
                                        for trows.Next() {
                                                var t struct {
                                                        id, bookID, tag, source string
                                                        hits int
                                                }
                                                _ = trows.Scan(&t.id, &t.bookID, &t.tag, &t.source, &t.hits)
                                                tags = append(tags, map[string]interface{}{
                                                        "id": t.id, "bookId": t.bookID, "tag": t.tag, "source": t.source, "hits": t.hits,
                                                })
                                        }
                                        trows.Close()
                                }
                                bookItem["chapters"] = chapters
                                bookItem["tags"] = tags
                        } else {
                                bookItem["chapters"] = []interface{}{}
                                bookItem["tags"] = []interface{}{}
                        }
                        books = append(books, bookItem)
                }
                rows.Close()
        }
        // settings export (raw key-value)
        settingsExport := make([]map[string]interface{}, 0, len(settings))
        for _, kv := range settings {
                settingsExport = append(settingsExport, map[string]interface{}{"key": kv.key, "value": kv.value})
        }
        var warnings []string
        if bigBooks {
                warnings = []string{fmt.Sprintf("书籍数量超过 %d, 仅导出书籍元数据(不含章节正文)", backupBigBooksThreshold)}
        } else {
                warnings = []string{}
        }
        payload := map[string]interface{}{
                "version":    1,
                "exportedAt": exportedAt,
                "counts": map[string]int{
                        "settings": len(settings), "categories": len(categories), "sites": len(sites),
                        "friendLinks": len(friendLinks), "rules": len(rules), "books": bookCount,
                        "chapters": chapterCount, "tasks": len(tasks), "downloadJobs": len(downloadJobs),
                },
                "warnings": warnings,
                "data": map[string]interface{}{
                        "settings":     settingsExport,
                        "categories":  categories,
                        "sites":        sites,
                        "friendLinks":  friendLinks,
                        "rules":        rules,
                        "books":        books,
                        "tasks":        tasks,
                        "downloadJobs": downloadJobs,
                },
        }
        // 写入 lastBackupAt
        _, _ = db.Exec(`INSERT INTO Setting (key, value) VALUES ('lastBackupAt', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, `"`+exportedAt+`"`)

        filename := "heis-backup-" + time.Now().Format("20060102-1504") + ".json"
        w.Header().Set("Content-Type", "application/json; charset=utf-8")
        w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
        w.Header().Set("Cache-Control", "no-store")
        enc := json.NewEncoder(w)
        enc.SetEscapeHTML(false)
        _ = enc.Encode(payload)
}

// adminBackupSubHandler — 分发 /api/admin/backup/restore 与 /api/admin/backup/vacuum.
func adminBackupSubHandler(w http.ResponseWriter, r *http.Request) {
        path := strings.TrimPrefix(r.URL.Path, "/api/admin/backup/")
        switch {
        case path == "restore":
                adminBackupRestoreHandler(w, r)
        case path == "vacuum":
                adminBackupVacuumHandler(w, r)
        default:
                writeJSONErr(w, "not found", 404)
        }
}

func adminBackupRestoreHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        dryRun := strings.TrimSpace(r.URL.Query().Get("dryRun")) == "1"
        body, err := io.ReadAll(io.LimitReader(r.Body, 50*1024*1024))
        if err != nil {
                writeJSONErr(w, "读取 body 失败: "+err.Error(), 400)
                return
        }
        var payload struct {
                Version    int            `json:"version"`
                ExportedAt string         `json:"exportedAt"`
                Counts      map[string]int `json:"counts"`
                Warnings    []string       `json:"warnings"`
                Data        struct {
                        Settings []struct {
                                Key   string `json:"key"`
                                Value string `json:"value"`
                        } `json:"settings"`
                        Categories []struct {
                                ID        string `json:"id"`
                                Name      string `json:"name"`
                                SortOrder int    `json:"sortOrder"`
                                CreatedAt string `json:"createdAt"`
                        } `json:"categories"`
                        Sites []struct {
                                ID, Name, Domain, ThemeID, Title, Description, Keywords, Icbm, GeoRegion, GeoPlacename, CreatedAt, UpdatedAt string
                                Offset int  `json:"offset"`
                                IsDefault, Status, InLinkWheel bool
                        } `json:"sites"`
                        FriendLinks []struct {
                                ID, Name, URL, Logo, CreatedAt, UpdatedAt string
                                SortOrder int  `json:"sortOrder"`
                                Enabled   bool `json:"enabled"`
                        } `json:"friendLinks"`
                        Rules []struct {
                                ID, Name, Description, Config, CreatedAt, UpdatedAt string
                                Enabled bool `json:"enabled"`
                        } `json:"rules"`
                        Books []struct {
                                ID, Name, Author, CategoryID, Intro, Cover, Status, Keywords, LatestChapter, SourceURL, SourceRule, StorageMode, CollectedAt, CreatedAt, UpdatedAt string
                                WordCount int `json:"wordCount"`
                                Chapters  []struct {
                                        ID, BookID, Title, Volume, URL, Content, Storage, FilePath, CreatedAt, UpdatedAt string
                                        Idx, WordCount int
                                        Fetched bool `json:"fetched"`
                                } `json:"chapters"`
                                Tags []struct {
                                        ID, BookID, Tag, Source string
                                        Hits int `json:"hits"`
                                } `json:"tags"`
                        } `json:"books"`
                        Tasks []struct {
                                ID, Name, RuleID, Mode, BookURL, ListURL, RecrawlMode, StorageMode, FetchConfig, Status, Progress, Stats, CreatedAt, UpdatedAt string
                                ListStart, ListEnd, BookStart, BookEnd, ThreadMin, ThreadMax, IntervalMin, IntervalMax, RefreshIntervalMin int
                                SmartCategory, SmartComplete, AutoSuggest, AutoRefresh bool
                        } `json:"tasks"`
                        DownloadJobs []struct {
                                ID, BookID, Options, Status, FilePath, Error, CreatedAt string
                                Size int `json:"size"`
                        } `json:"downloadJobs"`
                } `json:"data"`
        }
        if err := json.Unmarshal(body, &payload); err != nil {
                writeJSONErr(w, "JSON 解析失败: "+err.Error(), 400)
                return
        }
        if dryRun {
                writeJSONOK(w, map[string]interface{}{
                        "dryRun":     true,
                        "version":    payload.Version,
                        "exportedAt": payload.ExportedAt,
                        "counts":     payload.Counts,
                        "warnings":   payload.Warnings,
                        "imported":   0,
                })
                return
        }
        // 真正导入 (按 ID upsert, ON CONFLICT DO UPDATE)
        // R41-1B: 单事务包裹 — 失败回滚防半导入状态; P0 修复 4 处 SQL 占位符数与列数/实参不匹配
        tx, txErr := db.BeginTx(r.Context(), nil)
        if txErr != nil {
                writeJSONErr(w, "开启事务失败: "+txErr.Error(), 500)
                return
        }
        committed := false
        defer func() {
                if !committed {
                        _ = tx.Rollback()
                }
        }()
        imported := 0
        for _, s := range payload.Data.Settings {
                if _, err := tx.Exec(`INSERT INTO Setting (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, s.Key, s.Value); err != nil {
                        writeJSONErr(w, fmt.Sprintf("Setting %s 导入失败: %s", s.Key, err.Error()), 500)
                        return
                }
                imported++
        }
        for _, c := range payload.Data.Categories {
                if _, err := tx.Exec(`INSERT INTO Category (id, name, sortOrder, createdAt) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, sortOrder=excluded.sortOrder`,
                        c.ID, c.Name, c.SortOrder, nullIfEmpty(c.CreatedAt)); err != nil {
                        writeJSONErr(w, fmt.Sprintf("Category %s 导入失败: %s", c.ID, err.Error()), 500)
                        return
                }
                imported++
        }
        for _, s := range payload.Data.Sites {
                // R42-1A: 16 cols + 16 ? + 16 args (R41-1B 把 createdAt/updatedAt 当字面字符串 "datetime('now')" 作 arg 传入 →
                //         SQLite 会把字面串入库而非当前时间, 且若以 SQL 函数调用必须出现在 VALUES 子句而非 args 列表。
                //         改用 nullIfEmpty(s.CreatedAt/UpdatedAt) 保留备份原时间戳, 与其它表统一.)
                if _, err := tx.Exec(`INSERT INTO Site (id, name, domain, themeId, title, description, keywords, icbm, geoRegion, geoPlacename, offset, isDefault, status, inLinkWheel, createdAt, updatedAt)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(id) DO UPDATE SET name=excluded.name, domain=excluded.domain, themeId=excluded.themeId, title=excluded.title, description=excluded.description, keywords=excluded.keywords, icbm=excluded.icbm, geoRegion=excluded.geoRegion, geoPlacename=excluded.geoPlacename, offset=excluded.offset, isDefault=excluded.isDefault, status=excluded.status, inLinkWheel=excluded.inLinkWheel`,
                        s.ID, s.Name, s.Domain, s.ThemeID, s.Title, s.Description, s.Keywords, s.Icbm, s.GeoRegion, s.GeoPlacename, s.Offset, s.IsDefault, s.Status, s.InLinkWheel, nullIfEmpty(s.CreatedAt), nullIfEmpty(s.UpdatedAt)); err != nil {
                        writeJSONErr(w, fmt.Sprintf("Site %s 导入失败: %s", s.ID, err.Error()), 500)
                        return
                }
                imported++
        }
        for _, l := range payload.Data.FriendLinks {
                // R41-1B: 8 cols, 8 ?, 8 args (修复前 7 ? 给 8 args 的 SQL 错配)
                if _, err := tx.Exec(`INSERT INTO FriendLink (id, name, url, logo, sortOrder, enabled, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, logo=excluded.logo, sortOrder=excluded.sortOrder, enabled=excluded.enabled`,
                        l.ID, l.Name, l.URL, l.Logo, l.SortOrder, l.Enabled, nullIfEmpty(l.CreatedAt), nullIfEmpty(l.UpdatedAt)); err != nil {
                        writeJSONErr(w, fmt.Sprintf("FriendLink %s 导入失败: %s", l.ID, err.Error()), 500)
                        return
                }
                imported++
        }
        for _, r := range payload.Data.Rules {
                if _, err := tx.Exec(`INSERT INTO Rule (id, name, description, config, enabled, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, config=excluded.config, enabled=excluded.enabled`,
                        r.ID, r.Name, r.Description, r.Config, r.Enabled, nullIfEmpty(r.CreatedAt), nullIfEmpty(r.UpdatedAt)); err != nil {
                        writeJSONErr(w, fmt.Sprintf("Rule %s 导入失败: %s", r.ID, err.Error()), 500)
                        return
                }
                imported++
        }
        for _, b := range payload.Data.Books {
                // R42-1A: 16 cols + 16 ? + 16 args (R41-1B 注释声称 16 ? 但实际写入 14 ?; 已修正)
                if _, err := tx.Exec(`INSERT INTO Book (id, name, author, categoryId, intro, cover, status, keywords, latestChapter, wordCount, sourceUrl, sourceRuleId, storageMode, collectedAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, author=excluded.author, categoryId=excluded.categoryId, intro=excluded.intro, cover=excluded.cover, status=excluded.status, keywords=excluded.keywords, latestChapter=excluded.latestChapter, wordCount=excluded.wordCount, sourceUrl=excluded.sourceUrl, sourceRuleId=excluded.sourceRuleId, storageMode=excluded.storageMode`,
                        b.ID, b.Name, b.Author, nullIfEmpty(b.CategoryID), b.Intro, b.Cover, b.Status, b.Keywords, b.LatestChapter, b.WordCount, b.SourceURL, nullIfEmpty(b.SourceRule), b.StorageMode, nullIfEmpty(b.CollectedAt), nullIfEmpty(b.CreatedAt), nullIfEmpty(b.UpdatedAt)); err != nil {
                        writeJSONErr(w, fmt.Sprintf("Book %s 导入失败: %s", b.ID, err.Error()), 500)
                        return
                }
                imported++
                for _, c := range b.Chapters {
                        // R42-1A: 13 cols + 13 ? + 13 args (R41-1B 把 SQL 写成 15 ?, 实际 args 13 → 备份恢复必报 "bind parameter count mismatch")
                        if _, err := tx.Exec(`INSERT INTO Chapter (id, bookId, idx, title, volume, url, content, storage, filePath, wordCount, fetched, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bookId, idx) DO UPDATE SET title=excluded.title, volume=excluded.volume, url=excluded.url, content=excluded.content, storage=excluded.storage, filePath=excluded.filePath, wordCount=excluded.wordCount, fetched=excluded.fetched`,
                                c.ID, c.BookID, c.Idx, c.Title, c.Volume, c.URL, c.Content, c.Storage, nullIfEmpty(c.FilePath), c.WordCount, c.Fetched, nullIfEmpty(c.CreatedAt), nullIfEmpty(c.UpdatedAt)); err != nil {
                                writeJSONErr(w, fmt.Sprintf("Chapter %s 导入失败: %s", c.ID, err.Error()), 500)
                                return
                        }
                        imported++
                }
                for _, t := range b.Tags {
                        if _, err := tx.Exec(`INSERT INTO BookTag (id, bookId, tag, source, hits) VALUES (?,?,?,?,?) ON CONFLICT(bookId, tag) DO UPDATE SET source=excluded.source, hits=excluded.hits`,
                                t.ID, t.BookID, t.Tag, t.Source, t.Hits); err != nil {
                                writeJSONErr(w, fmt.Sprintf("BookTag %s 导入失败: %s", t.ID, err.Error()), 500)
                                return
                        }
                        imported++
                }
        }
        for _, t := range payload.Data.Tasks {
                // R42-1A: 27 cols + 27 ? + 27 args (R41-1B 把 SQL 写成 31 ?, 实际 args 27 → 备份恢复必报 "bind parameter count mismatch")
                if _, err := tx.Exec(`INSERT INTO Task (id, name, ruleId, mode, bookUrl, listUrl, listStart, listEnd, bookStart, bookEnd, recrawlMode, storageMode, fetchConfig, threadMin, threadMax, intervalMin, intervalMax, smartCategory, smartComplete, autoSuggest, autoRefresh, refreshIntervalMin, status, progress, stats, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, ruleId=excluded.ruleId, status=excluded.status, progress=excluded.progress, stats=excluded.stats`,
                        t.ID, t.Name, t.RuleID, t.Mode, t.BookURL, t.ListURL, t.ListStart, t.ListEnd, t.BookStart, t.BookEnd, t.RecrawlMode, t.StorageMode, t.FetchConfig, t.ThreadMin, t.ThreadMax, t.IntervalMin, t.IntervalMax, t.SmartCategory, t.SmartComplete, t.AutoSuggest, t.AutoRefresh, t.RefreshIntervalMin, t.Status, t.Progress, t.Stats, nullIfEmpty(t.CreatedAt), nullIfEmpty(t.UpdatedAt)); err != nil {
                        writeJSONErr(w, fmt.Sprintf("Task %s 导入失败: %s", t.ID, err.Error()), 500)
                        return
                }
                imported++
        }
        for _, d := range payload.Data.DownloadJobs {
                // R41-1B: 8 cols, 8 ?, 8 args (修复前 7 ? 给 8 args 的 SQL 错配)
                if _, err := tx.Exec(`INSERT INTO DownloadJob (id, bookId, options, status, filePath, error, size, createdAt) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET bookId=excluded.bookId, options=excluded.options, status=excluded.status, filePath=excluded.filePath, error=excluded.error, size=excluded.size`,
                        d.ID, d.BookID, d.Options, d.Status, nullIfEmpty(d.FilePath), nullIfEmpty(d.Error), d.Size, nullIfEmpty(d.CreatedAt)); err != nil {
                        writeJSONErr(w, fmt.Sprintf("DownloadJob %s 导入失败: %s", d.ID, err.Error()), 500)
                        return
                }
                imported++
        }
        if err := tx.Commit(); err != nil {
                writeJSONErr(w, "提交事务失败: "+err.Error(), 500)
                return
        }
        committed = true
        writeJSONOK(w, map[string]interface{}{
                "imported":   imported,
                "version":    payload.Version,
                "exportedAt": payload.ExportedAt,
        })
}

func adminBackupVacuumHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        if _, err := db.Exec(`VACUUM`); err != nil {
                writeJSONErr(w, "VACUUM 失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{"ok": true})
}

// ---------- SEO 审计 API ----------

var seoPrivateHostRE = regexp.MustCompile(`^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.6[4-9]\.|100\.[7-9]\d\.|100\.1[01]\d\.|100\.12[0-7]\.|0\.)`)
var seoDomainRE = regexp.MustCompile(`^(localhost(:\d{1,5})?|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?)$`)

type seoIssue struct {
        Severity string
        Category string
        Message  string
        Fix      string
}

func validIcbm(s string) bool {
        if s == "" {
                return false
        }
        parts := strings.Split(s, ",")
        if len(parts) != 2 {
                return false
        }
        var lat, lng float64
        if _, err := fmt.Sscanf(strings.TrimSpace(parts[0]), "%f", &lat); err != nil {
                return false
        }
        if _, err := fmt.Sscanf(strings.TrimSpace(parts[1]), "%f", &lng); err != nil {
                return false
        }
        return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// auditSite 对单站点执行 SEO 检查, 返回 {siteId,siteName,domain,score,issues,passed}.
// 与 src/app/api/admin/seo-audit/route.ts auditSite 同口径.
func auditSite(siteID, name, domain, themeID, title, description, keywords, icbm, geoRegion, geoPlacename string, offset, totalBooks, linkWheelCount int, themeIDs map[string]bool) map[string]interface{} {
        issues := []seoIssue{}
        passed := []string{}
        // TDK
        t := strings.TrimSpace(title)
        if t == "" {
                issues = append(issues, seoIssue{"error", "tdk", "缺失站点标题 (title)", "在站点设置中填写 title (建议 5-30 字)"})
        } else if lenRune(t) < 5 || lenRune(t) > 30 {
                issues = append(issues, seoIssue{"warning", "tdk", fmt.Sprintf("标题长度 %d 字, 建议 5-30 字", lenRune(t)), "调整 title 长度以利于搜索结果展示"})
        } else {
                passed = append(passed, "标题长度合规 (5-30 字)")
        }
        d := strings.TrimSpace(description)
        if d == "" {
                issues = append(issues, seoIssue{"error", "tdk", "缺失页面描述 (description)", "在站点设置中填写 description (建议 20-200 字)"})
        } else if lenRune(d) < 20 || lenRune(d) > 200 {
                issues = append(issues, seoIssue{"warning", "tdk", fmt.Sprintf("描述长度 %d 字, 建议 20-200 字", lenRune(d)), "调整 description 长度以提升搜索点击率"})
        } else {
                passed = append(passed, "描述长度合规 (20-200 字)")
        }
        kw := strings.TrimSpace(keywords)
        if kw == "" {
                issues = append(issues, seoIssue{"warning", "tdk", "缺失关键词 (keywords)", "在站点设置中填写 keywords (逗号分隔 3-10 个核心词)"})
        } else {
                passed = append(passed, "已设置关键词")
        }
        // Domain
        dom := strings.ToLower(strings.TrimSpace(domain))
        if dom == "" {
                issues = append(issues, seoIssue{"error", "domain", "缺失域名", "在站点设置中填写域名"})
        } else if !seoDomainRE.MatchString(dom) {
                issues = append(issues, seoIssue{"error", "domain", "域名格式非法", "使用形如 www.example.com 或 localhost:3000 的合法域名"})
        } else if dom == "localhost" || strings.HasPrefix(dom, "localhost:") || seoPrivateHostRE.MatchString(dom) {
                issues = append(issues, seoIssue{"warning", "domain", "域名为 localhost 或私网地址, 不利于线上 SEO", "切换到正式域名后再做 SEO 推广"})
        } else if !strings.Contains(dom, ".") {
                issues = append(issues, seoIssue{"warning", "domain", "域名未包含顶级域", "使用形如 example.com 的完整域名"})
        } else {
                passed = append(passed, "域名格式合法")
        }
        // Content
        if totalBooks == 0 {
                issues = append(issues, seoIssue{"warning", "content", "该站点未关联任何书籍", "为该站点添加采集任务或调整 offset 关联书籍"})
        } else if totalBooks < 5 {
                issues = append(issues, seoIssue{"info", "content", fmt.Sprintf("仅 %d 本书, 内容量较少", totalBooks), "增加采集以丰富内容, 一般建议 ≥ 50 本"})
        } else {
                passed = append(passed, fmt.Sprintf("内容规模合适 (%d 本)", totalBooks))
        }
        // Links
        if linkWheelCount == 0 {
                issues = append(issues, seoIssue{"warning", "links", "无友链参与链轮 (inLinkWheel)", "在友链管理中至少启用一条 inLinkWheel 链接"})
        } else {
                passed = append(passed, fmt.Sprintf("链轮友链 %d 条", linkWheelCount))
        }
        // Theme
        if !themeIDs[themeID] {
                issues = append(issues, seoIssue{"error", "theme", fmt.Sprintf("主题 %s 不存在", themeID), "在站点设置中选择已注册的主题"})
        } else {
                passed = append(passed, fmt.Sprintf("主题已注册 (%s)", themeID))
        }
        // GEO
        if !validIcbm(icbm) {
                issues = append(issues, seoIssue{"warning", "geo", "ICBM 坐标格式不合法 (期望 \"lat,lng\")", "填写形如 \"35.86166,104.195397\" 的经纬度"})
        } else {
                passed = append(passed, "ICBM 坐标合法")
        }
        if geoRegion == "" {
                issues = append(issues, seoIssue{"info", "geo", "未设置 geoRegion", "设置 ISO 国家码, 如 CN / US / JP"})
        } else {
                passed = append(passed, "geoRegion = " + geoRegion)
        }
        if geoPlacename == "" {
                issues = append(issues, seoIssue{"info", "geo", "未设置 geoPlacename", "设置地区名称, 如 \"中国\" / \"北京\""})
        } else {
                passed = append(passed, "geoPlacename = " + geoPlacename)
        }
        // Sitemap
        if dom != "" && seoDomainRE.MatchString(dom) && !seoPrivateHostRE.MatchString(dom) && dom != "localhost" && !strings.HasPrefix(dom, "localhost:") {
                passed = append(passed, "sitemap 可生成")
        } else {
                issues = append(issues, seoIssue{"warning", "sitemap", "域名不合法或为私网, sitemap 将无法生成", "修正域名后 sitemap 路由自动可用"})
        }
        // Offset
        if offset > 1000000 {
                issues = append(issues, seoIssue{"warning", "offset", fmt.Sprintf("offset 过大 (%d), 可能破坏分页", offset), "将 offset 控制在 100 万以内"})
        } else if offset < 0 {
                issues = append(issues, seoIssue{"error", "offset", fmt.Sprintf("offset 为负数 (%d)", offset), "offset 必须 ≥ 0"})
        } else {
                passed = append(passed, fmt.Sprintf("offset 合理 (%d)", offset))
        }
        // Score
        score := 100
        for _, it := range issues {
                switch it.Severity {
                case "error":
                        score -= 10
                case "warning":
                        score -= 3
                case "info":
                        score -= 1
                }
        }
        if score < 0 {
                score = 0
        }
        issuesOut := make([]map[string]interface{}, 0, len(issues))
        for _, it := range issues {
                issuesOut = append(issuesOut, map[string]interface{}{
                        "severity": it.Severity, "category": it.Category,
                        "message": it.Message, "fix": it.Fix,
                })
        }
        return map[string]interface{}{
                "siteId": siteID, "siteName": name, "domain": domain,
                "score": score, "issues": issuesOut, "passed": passed,
        }
}

// lenRune 返回 rune 数 (UTF-8 字符数, 与 TS .length 同语义).
func lenRune(s string) int { return len([]rune(s)) }

func adminSeoAuditHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        siteFilter := strings.TrimSpace(r.URL.Query().Get("site"))
        rows, err := db.Query(`SELECT id, name, domain, themeId, COALESCE(title,''), COALESCE(description,''), COALESCE(keywords,''), COALESCE(icbm,''), COALESCE(geoRegion,''), COALESCE(geoPlacename,''), offset FROM Site LIMIT 500`)
        sites := []map[string]string{}
        if err == nil {
                for rows.Next() {
                        var id, name, domain, themeID, title, desc, kw, icbm, geoR, geoP string
                        var offset int
                        _ = rows.Scan(&id, &name, &domain, &themeID, &title, &desc, &kw, &icbm, &geoR, &geoP, &offset)
                        sites = append(sites, map[string]string{
                                "id": id, "name": name, "domain": domain, "themeId": themeID,
                                "title": title, "description": desc, "keywords": kw,
                                "icbm": icbm, "geoRegion": geoR, "geoPlacename": geoP,
                                "offset": strconv.Itoa(offset),
                        })
                }
                rows.Close()
        }
        themeIDs := map[string]bool{}
        for _, t := range adminThemes {
                themeIDs[t.ID] = true
        }
        var linkWheelCount int
        _ = db.QueryRow(`SELECT COUNT(*) FROM FriendLink WHERE enabled=1 AND url LIKE '%http%'`).Scan(&linkWheelCount)
        var totalBooks int
        _ = db.QueryRow(`SELECT COUNT(*) FROM Book`).Scan(&totalBooks)

        reports := []map[string]interface{}{}
        for _, s := range sites {
                if siteFilter != "" && s["id"] != siteFilter {
                        continue
                }
                offset, _ := strconv.Atoi(s["offset"])
                r := auditSite(s["id"], s["name"], s["domain"], s["themeId"], s["title"], s["description"], s["keywords"], s["icbm"], s["geoRegion"], s["geoPlacename"], offset, totalBooks, linkWheelCount, themeIDs)
                reports = append(reports, r)
        }
        sortAuditReports(reports)
        totalIssues, totalErrors, scoreSum := 0, 0, 0
        for _, r := range reports {
                if issues, ok := r["issues"].([]map[string]interface{}); ok {
                        totalIssues += len(issues)
                        for _, it := range issues {
                                if it["severity"] == "error" {
                                        totalErrors++
                                }
                        }
                }
                if s, ok := r["score"].(int); ok {
                        scoreSum += s
                }
        }
        avgScore := 0
        if len(reports) > 0 {
                avgScore = scoreSum / len(reports)
        }
        writeJSONOK(w, map[string]interface{}{
                "sites": reports,
                "summary": map[string]interface{}{
                        "totalSites": len(reports), "avgScore": avgScore,
                        "totalIssues": totalIssues, "totalErrors": totalErrors,
                },
        })
}

// sortAuditReports 排序: error 多的在前, 同错按 score 升序.
func sortAuditReports(reports []map[string]interface{}) {
        sort.SliceStable(reports, func(i, j int) bool {
                ei, ej := 0, 0
                if ii, ok := reports[i]["issues"].([]map[string]interface{}); ok {
                        for _, x := range ii {
                                if x["severity"] == "error" {
                                        ei++
                                }
                        }
                }
                if ij, ok := reports[j]["issues"].([]map[string]interface{}); ok {
                        for _, x := range ij {
                                if x["severity"] == "error" {
                                        ej++
                                }
                        }
                }
                if ei != ej {
                        return ei > ej
                }
                si, _ := reports[i]["score"].(int)
                sj, _ := reports[j]["score"].(int)
                return si < sj
        })
}

// ---------- R40-1B 页面数据装配 ----------

func fillCategoriesPageData(data map[string]interface{}) {
        rows, err := db.Query(`SELECT id, name, sortOrder, createdAt FROM Category ORDER BY sortOrder ASC LIMIT 500`)
        cats := []map[string]interface{}{}
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, name, createdAt string
                        var sortOrder int
                        _ = rows.Scan(&id, &name, &sortOrder, &createdAt)
                        var bookCount int
                        _ = db.QueryRow(`SELECT COUNT(*) FROM Book WHERE categoryId=?`, id).Scan(&bookCount)
                        cats = append(cats, map[string]interface{}{
                                "id": id, "name": name, "sortOrder": sortOrder,
                                "bookCount": bookCount, "createdAt": createdAt,
                        })
                }
        }
        data["Categories"] = cats
        data["Total"] = len(cats)
}

func fillLinksPageData(data map[string]interface{}) {
        rows, err := db.Query(`SELECT id, name, url, logo, sortOrder, enabled, createdAt, updatedAt FROM FriendLink ORDER BY sortOrder ASC, createdAt ASC LIMIT 500`)
        links := []map[string]interface{}{}
        total, enabledCount := 0, 0
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, name, urlV, logo, createdAt, updatedAt string
                        var sortOrder int
                        var enabled bool
                        _ = rows.Scan(&id, &name, &urlV, &logo, &sortOrder, &enabled, &createdAt, &updatedAt)
                        links = append(links, map[string]interface{}{
                                "id": id, "name": name, "url": urlV, "logo": logo,
                                "sortOrder": sortOrder, "enabled": enabled, "updatedAt": updatedAt,
                        })
                        total++
                        if enabled {
                                enabledCount++
                        }
                }
        }
        data["Links"] = links
        data["Total"] = total
        data["EnabledCount"] = enabledCount
        data["DisabledCount"] = total - enabledCount
        // 链轮配置 (Setting.linkwheel)
        var wheelCfgJSON string
        _ = db.QueryRow(`SELECT value FROM Setting WHERE key='linkwheel'`).Scan(&wheelCfgJSON)
        wheel := map[string]interface{}{"enabled": true, "mode": "home", "count": 6}
        if wheelCfgJSON != "" {
                var raw map[string]interface{}
                if json.Unmarshal([]byte(wheelCfgJSON), &raw) == nil {
                        if v, ok := raw["enabled"]; ok {
                                wheel["enabled"] = v != false
                        }
                        if v, ok := raw["mode"].(string); ok && (v == "home" || v == "book" || v == "mixed") {
                                wheel["mode"] = v
                        }
                        if v, ok := raw["count"].(float64); ok {
                                n := int(v)
                                if n < 1 {
                                        n = 1
                                }
                                if n > 30 {
                                        n = 30
                                }
                                wheel["count"] = n
                        }
                }
        }
        data["Wheel"] = wheel
        var wheelSiteCount int
        _ = db.QueryRow(`SELECT COUNT(*) FROM Site WHERE inLinkWheel=1 AND status=1`).Scan(&wheelSiteCount)
        data["WheelSiteCount"] = wheelSiteCount
}

func fillThemesPageData(data map[string]interface{}) {
        rows, err := db.Query(`SELECT themeId, COUNT(*) FROM Site GROUP BY themeId`)
        counts := map[string]int{}
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var themeID string
                        var n int
                        _ = rows.Scan(&themeID, &n)
                        counts[themeID] = n
                }
        }
        themes := []map[string]interface{}{}
        totalSites := 0
        for _, t := range adminThemes {
                siteCount := counts[t.ID]
                totalSites += siteCount
                themes = append(themes, map[string]interface{}{
                        "id": t.ID, "name": t.Name, "desc": t.Desc, "layout": t.Layout,
                        "dark": t.Dark, "readLayout": t.ReadLayout, "readFontBase": t.ReadFontBase,
                        "previewBg": t.PreviewBg, "previewText": t.PreviewText,
                        "siteCount": siteCount,
                })
        }
        data["Themes"] = themes
        data["SiteTotal"] = totalSites
        stats := []map[string]interface{}{}
        for _, t := range adminThemes {
                stats = append(stats, map[string]interface{}{
                        "themeId": t.ID, "count": counts[t.ID],
                })
        }
        data["ThemeStats"] = stats
}

func fillDownloadsPageData(data map[string]interface{}) {
        rows, err := db.Query(`SELECT d.id, d.bookId, COALESCE(b.name,'(已删)'), COALESCE(b.author,''), d.options, d.status, COALESCE(d.filePath,''), COALESCE(d.error,''), d.size, d.createdAt FROM DownloadJob d LEFT JOIN Book b ON d.bookId=b.id ORDER BY d.createdAt DESC LIMIT 500`)
        dls := []map[string]interface{}{}
        total, pending, done, errCount := 0, 0, 0, 0
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, bookID, bookName, bookAuthor, options, status, filePath, errMsg, createdAt string
                        var size int
                        _ = rows.Scan(&id, &bookID, &bookName, &bookAuthor, &options, &status, &filePath, &errMsg, &size, &createdAt)
                        dls = append(dls, map[string]interface{}{
                                "id": id, "bookId": bookID, "bookName": bookName, "bookAuthor": bookAuthor,
                                "status": status, "size": size, "error": errMsg, "createdAt": createdAt,
                        })
                        total++
                        switch status {
                        case "pending", "running":
                                pending++
                        case "done":
                                done++
                        case "error":
                                errCount++
                        }
                }
        }
        data["Downloads"] = dls
        data["Total"] = total
        data["Pending"] = pending
        data["Done"] = done
        data["Error"] = errCount
}

func fillSettingsPageData(data map[string]interface{}) {
        rows, err := db.Query(`SELECT key, value FROM Setting ORDER BY key ASC LIMIT 200`)
        settings := []map[string]interface{}{}
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var key, value string
                        _ = rows.Scan(&key, &value)
                        isJSON := false
                        v := value
                        if len(value) > 0 && (value[0] == '{' || value[0] == '[' || value == "true" || value == "false" || value == "null") {
                                isJSON = true
                                var parsed interface{}
                                if json.Unmarshal([]byte(value), &parsed) == nil {
                                        b, _ := json.MarshalIndent(parsed, "", "  ")
                                        v = string(b)
                                }
                        }
                        settings = append(settings, map[string]interface{}{
                                "key": key, "value": v, "rawValue": v, "isJson": isJSON,
                                "updatedAt": "-",
                        })
                }
        }
        data["Settings"] = settings
        data["Total"] = len(settings)
}

func fillFeedbackPageData(data map[string]interface{}, r *http.Request) {
        q := likeSafe(r.URL.Query().Get("q"))
        status := strings.TrimSpace(r.URL.Query().Get("status"))
        typ := strings.TrimSpace(r.URL.Query().Get("type"))
        page := clampIntAdm(toIntDefault(r.URL.Query().Get("page"), 1), 1, 10000)
        size := 20
        data["FilterQ"] = r.URL.Query().Get("q")
        data["FilterStatus"] = status
        data["FilterType"] = typ
        validStatus := map[string]bool{"new": true, "read": true, "resolved": true, "ignored": true}
        validType := map[string]bool{"bug": true, "suggestion": true, "praise": true, "other": true}
        where := []string{"1=1"}
        args := []interface{}{}
        if status != "" && validStatus[status] {
                where = append(where, "status=?")
                args = append(args, status)
        }
        if typ != "" && validType[typ] {
                where = append(where, "type=?")
                args = append(args, typ)
        }
        if q != "" {
                where = append(where, "content LIKE ? ESCAPE '\\'")
                args = append(args, "%"+q+"%")
        }
        whereSQL := strings.Join(where, " AND ")
        var total int
        _ = db.QueryRow("SELECT COUNT(*) FROM Feedback WHERE "+whereSQL, args...).Scan(&total)
        totalPages := (total + size - 1) / size
        if totalPages < 1 {
                totalPages = 1
        }
        if page > totalPages {
                page = totalPages
        }
        offset := (page - 1) * size
        listArgs := append(args, size, offset)
        rows, err := db.Query(`SELECT id, type, COALESCE(contact,''), content, COALESCE(url,''), COALESCE(siteId,''), status, COALESCE(ip,''), COALESCE(adminNote,''), createdAt FROM Feedback WHERE `+whereSQL+` ORDER BY createdAt DESC LIMIT ? OFFSET ?`, listArgs...)
        rowsList := []map[string]interface{}{}
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, typV, contact, content, urlV, siteID, statusV, ip, adminNote, createdAt string
                        _ = rows.Scan(&id, &typV, &contact, &content, &urlV, &siteID, &statusV, &ip, &adminNote, &createdAt)
                        rowsList = append(rowsList, map[string]interface{}{
                                "id": id, "type": typV, "contact": contact, "content": content,
                                "url": urlV, "status": statusV, "ip": ip,
                                "adminNote": adminNote, "createdAt": createdAt,
                        })
                }
        }
        data["Rows"] = rowsList
        data["Total"] = total
        data["Page"] = page
        data["TotalPages"] = totalPages
        data["PageList"] = buildPageList(page, totalPages)
        var allCount, newCount, resolvedCount int
        _ = db.QueryRow(`SELECT COUNT(*) FROM Feedback`).Scan(&allCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Feedback WHERE status='new'`).Scan(&newCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Feedback WHERE status='resolved'`).Scan(&resolvedCount)
        data["Stats"] = map[string]interface{}{"total": allCount, "new": newCount, "resolved": resolvedCount}
}

func fillBackupPageData(data map[string]interface{}) {
        var bookCount, chapterCount, siteCount, catCount, ruleCount, settingCount, linkCount, taskCount, dlCount int
        _ = db.QueryRow(`SELECT COUNT(*) FROM Book`).Scan(&bookCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Chapter`).Scan(&chapterCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Site`).Scan(&siteCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Category`).Scan(&catCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Rule`).Scan(&ruleCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Setting`).Scan(&settingCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM FriendLink`).Scan(&linkCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Task`).Scan(&taskCount)
        _ = db.QueryRow(`SELECT COUNT(*) FROM DownloadJob`).Scan(&dlCount)
        counts := []map[string]interface{}{
                {"label": "书籍", "count": bookCount},
                {"label": "章节", "count": chapterCount},
                {"label": "站点", "count": siteCount},
                {"label": "分类", "count": catCount},
                {"label": "规则", "count": ruleCount},
                {"label": "设置", "count": settingCount},
                {"label": "友链", "count": linkCount},
                {"label": "任务", "count": taskCount},
                {"label": "下载", "count": dlCount},
        }
        data["Counts"] = counts
        var lastBackupAt string
        _ = db.QueryRow(`SELECT value FROM Setting WHERE key='lastBackupAt'`).Scan(&lastBackupAt)
        if lastBackupAt == "" {
                lastBackupAt = "从未备份"
        } else {
                var s string
                if json.Unmarshal([]byte(lastBackupAt), &s) == nil {
                        lastBackupAt = s
                }
        }
        data["LastBackupAt"] = lastBackupAt
}

func fillSeoAuditPageData(data map[string]interface{}, r *http.Request) {
        siteFilter := strings.TrimSpace(r.URL.Query().Get("site"))
        data["FilterSite"] = siteFilter
        rows, err := db.Query(`SELECT id, name, domain, themeId, COALESCE(title,''), COALESCE(description,''), COALESCE(keywords,''), COALESCE(icbm,''), COALESCE(geoRegion,''), COALESCE(geoPlacename,''), offset FROM Site ORDER BY isDefault DESC, name ASC LIMIT 500`)
        sites := []map[string]string{}
        siteOptions := []map[string]interface{}{}
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, name, domain, themeID, title, desc, kw, icbm, geoR, geoP string
                        var offset int
                        _ = rows.Scan(&id, &name, &domain, &themeID, &title, &desc, &kw, &icbm, &geoR, &geoP, &offset)
                        sites = append(sites, map[string]string{
                                "id": id, "name": name, "domain": domain, "themeId": themeID,
                                "title": title, "description": desc, "keywords": kw,
                                "icbm": icbm, "geoRegion": geoR, "geoPlacename": geoP,
                                "offset": strconv.Itoa(offset),
                        })
                        siteOptions = append(siteOptions, map[string]interface{}{"id": id, "name": name})
                }
        }
        data["SiteOptions"] = siteOptions
        themeIDs := map[string]bool{}
        for _, t := range adminThemes {
                themeIDs[t.ID] = true
        }
        var linkWheelCount int
        _ = db.QueryRow(`SELECT COUNT(*) FROM FriendLink WHERE enabled=1 AND url LIKE '%http%'`).Scan(&linkWheelCount)
        var totalBooks int
        _ = db.QueryRow(`SELECT COUNT(*) FROM Book`).Scan(&totalBooks)
        reports := []map[string]interface{}{}
        for _, s := range sites {
                if siteFilter != "" && s["id"] != siteFilter {
                        continue
                }
                offset, _ := strconv.Atoi(s["offset"])
                reports = append(reports, auditSite(s["id"], s["name"], s["domain"], s["themeId"], s["title"], s["description"], s["keywords"], s["icbm"], s["geoRegion"], s["geoPlacename"], offset, totalBooks, linkWheelCount, themeIDs))
        }
        sortAuditReports(reports)
        data["Reports"] = reports
        totalIssues, totalErrors, scoreSum := 0, 0, 0
        for _, r := range reports {
                if issues, ok := r["issues"].([]map[string]interface{}); ok {
                        totalIssues += len(issues)
                        for _, it := range issues {
                                if it["severity"] == "error" {
                                        totalErrors++
                                }
                        }
                }
                if s, ok := r["score"].(int); ok {
                        scoreSum += s
                }
        }
        avgScore := 0
        if len(reports) > 0 {
                avgScore = scoreSum / len(reports)
        }
        data["Summary"] = map[string]interface{}{
                "totalSites": len(reports), "avgScore": avgScore,
                "totalIssues": totalIssues, "totalErrors": totalErrors,
        }
}
