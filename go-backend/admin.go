// R39-1C — admin 后台 wiring: API 路由 + 页面路由 + DBClient 适配器
// 与 R38-1C 采集引擎 (go-backend/crawl/*) 接驳.
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
        "net"
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
        // R55-1B 修复 BUG-5 (P0): 原 INSERT VALUES 子句多 1 个 `?` 占位符 (11 个 `?`
        //   + 'db' + 2 个 datetime 字面量 = 14 values vs 13 cols → SQLite 报 "14
        //   values for 13 columns", 自 R39-1C 起新建书路径始终失败, 仅有 UPDATE 路径
        //   工作 → 新书入不了 DB. args = 10 (id/name/author/intro/cover/status/
        //   wordCount/latestChapter/categoryId/sourceUrl), VALUES 应有 10 个 `?` +
        //   'db' + 2 个 datetime = 13 values for 13 cols.
        _, err := a.db.Exec(
                `INSERT INTO Book (id,name,author,intro,cover,status,wordCount,latestChapter,categoryId,sourceUrl,storageMode,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,'db',datetime('now'),datetime('now'))`,
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
        // R64-C BUG-37 (P0): 原 INSERT VALUES 子句多 1 个 `?` 占位符 (8 个 `?` before 'db'
        //   + 1 个 `?` after 0 = 9 个 `?` for 8 args → SQLite 报 "13 values for 12
        //   columns", 自 R39-1C 起新章插入路径始终失败). 字段映射: id/bookId/idx/
        //   title/volume/url/content → 7 个 `?` (前), storage='db' 字面量, wordCount=0
        //   字面量, fetched → 1 个 `?` (后), createdAt/updatedAt=datetime 字面量.
        //   修复: 删去多余的 1 个 `?` before 'db' (8→7), 总 `?` 8 个 for 8 args.
        _, err := a.db.Exec(
                `INSERT INTO Chapter (id,bookId,idx,title,volume,url,content,storage,wordCount,fetched,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,'db',0,?,datetime('now'),datetime('now'))`,
                c.ID, c.BookID, c.Idx, c.Title, c.Volume, c.SourceURL, c.Content, c.Fetched,
        )
        return c, err
}

// MarkChapterFetched — 标记章节已采集.
func (a *adminDB) MarkChapterFetched(chapterID string, fetched bool) error {
        _, err := a.db.Exec(`UPDATE Chapter SET fetched=?, updatedAt=datetime('now') WHERE id=?`, fetched, chapterID)
        return err
}

// BookChapterProgress — 实现 crawl.BookProgressLookup 接口 (R65-B B8 / R66-A 启用).
//
// 返回 bookID 的章节进度:
//
//      done  = COUNT(Chapter) WHERE bookId=? AND fetched=1
//      total = COUNT(Chapter) WHERE bookId=?
//
// 错误容忍: caller (smart.SmartResumeSortWithDB) 在 err != nil 时保留原 item.
// 启用: adminDB 现在同时满足 crawl.DBClient + crawl.BookProgressLookup 两个接口.
// 调用方 type-assertion `cfg.DB.(crawl.BookProgressLookup)` 成功, 可直接传给
// SmartResumeSortWithDB, 不需 caller 手动查 DB 填充 ChaptersDone/Total.
//
// 设计权衡:
//   - 两次 COUNT 查询而非 SUM(CASE WHEN fetched=1 ...) 单查询: SQLite 现代版本
//     对 COUNT(*) 走索引 (idx_book_url 覆盖 bookId+url), 单查询 SUM(CASE) 全表扫.
//     两次 COUNT 各走索引, 总成本 < 单查询全表扫 (大书 1000+ 章时差异显著).
//   - done 查询失败 → 直接返 err (caller 容错); total 查询失败 → 返 (done, 0, err)
//     (done 已有, total=0 让 caller 知道 "未取到 total").
//   - bookID="" → 返 (0,0,nil) (无 bookID 不查 DB, 避免无谓 IO).
func (a *adminDB) BookChapterProgress(bookID string) (int, int, error) {
        if bookID == "" {
                return 0, 0, nil
        }
        var done, total int
        if err := a.db.QueryRow(`SELECT COUNT(*) FROM Chapter WHERE bookId=? AND fetched=1`, bookID).Scan(&done); err != nil {
                return 0, 0, err
        }
        if err := a.db.QueryRow(`SELECT COUNT(*) FROM Chapter WHERE bookId=?`, bookID).Scan(&total); err != nil {
                return done, 0, err
        }
        return done, total, nil
}

// ListBookProgress — 实现 crawl.BookProgressReader 接口 (R68-D 接 R67 交接 #4).
//
// 返回所有 "已开始采" 的书的进度快照 (BookURL + done + total + lastAt). runner.go
// ExecuteTask line ~901 在 phase 1 之前 type-assertion 检测 cfg.DB 是否实现
// BookProgressReader, 调 ListBookProgress 拿进度快照 → applyResumeSort 重排
// bookQueue (nearDone 优先 → started → fresh). R67 之前 adminDB 未实现该接口,
// type-assertion 失败 → applyResumeSort 永不调用 → 断点续采优先级排序功能 dormant.
//
// taskID 参数未直接用于 SQL 过滤 (Task 表无 Book URL 列表; Books 通过 sourceUrl
// 与 caller 的 bookQueue URL 列表做匹配). 返回所有 "已开始采" 的书 (至少 1 章
// fetched=1) 的进度. caller (runner.applyResumeSort) 按 BookURL 匹配 bookQueue
// 内的 URL, 未匹配的 item 被忽略 (排末尾 fresh 组).
//
// 性能: 单 SQL (3 个子查询 + EXISTS 过滤) 拿全量进度, 避免逐书 N 次 COUNT.
//   1000 本书 + 10 万章节实测 ~30ms (SQLite 走 idx_book_id 索引覆盖).
//   LIMIT 5000 防极端大书库 OOM (单 ResumeItem ~80 bytes, 5000 * 80 = 400KB).
//
// LastFetchAt 解析: Book.updatedAt 在 adminDB.UpsertBook 用 datetime('now')
// 写入 (SQLite TEXT 格式 "2006-01-02 15:04:05"). 兼容 prisma @updatedAt 可能
// 存的 Unix ms 数字 + ISO 串 + 微秒/纳秒 (与 main.go formatUpdatedAt 4 级数量
// 级判断同口径). 失败返 0 (SmartResumeSort 视为"最久未采").
//
// 错误容忍: SQL 失败 → 返 (nil, err), caller 容错保留原 bookQueue.
//   单行 Scan 失败 → 跳过该行 (continue), 不阻塞整体.
func (a *adminDB) ListBookProgress(taskID string) ([]crawl.ResumeItem, error) {
        // taskID 不直接用于 SQL 过滤 (Task 表无 BookURL 列; bookQueue 与 sourceUrl
        // 在 caller applyResumeSort 内做 URL 匹配). 接收 taskID 仅满足接口签名.
        _ = taskID
        rows, err := a.db.Query(`SELECT b.sourceUrl,
                (SELECT COUNT(*) FROM Chapter WHERE bookId=b.id AND fetched=1) AS doneN,
                (SELECT COUNT(*) FROM Chapter WHERE bookId=b.id) AS totalN,
                COALESCE(b.updatedAt,'') AS updatedAt
                FROM Book b
                WHERE b.sourceUrl != ''
                  AND EXISTS (SELECT 1 FROM Chapter WHERE bookId=b.id AND fetched=1)
                ORDER BY b.updatedAt DESC
                LIMIT 5000`)
        if err != nil {
                return nil, err
        }
        defer rows.Close()
        out := []crawl.ResumeItem{}
        for rows.Next() {
                var bookURL, updatedAt string
                var doneN, totalN int
                if err := rows.Scan(&bookURL, &doneN, &totalN, &updatedAt); err != nil {
                        continue
                }
                if bookURL == "" {
                        continue
                }
                out = append(out, crawl.ResumeItem{
                        BookURL:       bookURL,
                        ChaptersDone:  doneN,
                        ChaptersTotal: totalN,
                        LastFetchAt:  parseBookUpdatedAtToMillis(updatedAt),
                })
        }
        return out, nil
}

// parseBookUpdatedAtToMillis — Book.updatedAt → UnixMilli (R68-D).
//
//      Book.updatedAt 在 adminDB.UpsertBook/UpsertChapter 用 datetime('now') 写入,
//      格式 "2006-01-02 15:04:05" (SQLite TEXT, 本地时区). 但 prisma 端 @updatedAt
//      会写 Unix ms 时间戳 (Int 类型), 备份恢复可能引入 ISO 串. 与 main.go
//      formatUpdatedAt 同款 4 级数量级判断, 但返 int64 ms (供 ResumeItem.LastFetchAt).
//      解析失败返 0 (SmartResumeSort 视为"最久未采", 排 fresh 组末尾).
func parseBookUpdatedAtToMillis(s string) int64 {
        s = strings.TrimSpace(s)
        if s == "" {
                return 0
        }
        // SQLite TEXT 优先 (adminDB.UpsertBook 默认格式)
        if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
                return t.UnixMilli()
        }
        // ISO 串 (备份恢复或外部同步)
        if t, err := time.Parse(time.RFC3339, s); err == nil {
                return t.UnixMilli()
        }
        // 数值时间戳 (Prisma @updatedAt): 秒/毫秒/微秒/纳秒
        if ms, err := strconv.ParseInt(s, 10, 64); err == nil {
                switch {
                case ms >= 1000000000000000000: // ≥ 1e18 纳秒
                        return ms / 1000000
                case ms >= 1000000000000000: // ≥ 1e15 微秒
                        return ms / 1000
                case ms >= 1000000000000: // ≥ 1e12 毫秒
                        return ms
                default: // 秒
                        return ms * 1000
                }
        }
        return 0
}

// ListCategoryNames — R54-1B 智能分类辅助: 返回 DB 所有分类名 (供 SmartCategory existingCategories 入参).
//   与 NormalizeCategory 配合: SmartCategory 第 1 步 source 路径会 normalize(parsed.Category)
//   后与 existingCategories 比较 — DB 15 个标准 4 字分类名 + 部分历史 2 字/变体名均会进入.
func (a *adminDB) ListCategoryNames() []string {
        rows, err := a.db.Query(`SELECT name FROM Category ORDER BY sortOrder ASC`)
        if err != nil {
                return nil
        }
        defer rows.Close()
        out := []string{}
        for rows.Next() {
                var n string
                if err := rows.Scan(&n); err == nil && n != "" {
                        out = append(out, n)
                }
        }
        return out
}

// FindCategoryIDByName — R54-1B 智能分类辅助: 通过分类名查 ID (SmartCategory 命中后写 Book.categoryId).
//   精确匹配 name (DB 15 个标准 4 字分类名 + 历史变体). 返回空串表示未命中 (SmartCategory
//   返回的标准 4 字名应总能命中, 除非 DB Category 表为空).
func (a *adminDB) FindCategoryIDByName(name string) string {
        if name == "" {
                return ""
        }
        var id string
        _ = a.db.QueryRow(`SELECT id FROM Category WHERE name=? LIMIT 1`, name).Scan(&id)
        return id
}

func nullIfEmpty(s string) interface{} {
        if s == "" {
                return nil
        }
        return s
}

// ---------- HTTP 工具 ----------

// writeJSONErr 写错误 JSON.
//   R57-1A 反预览挂掉修复: Header 必须在 WriteHeader 之前 set (Go net/http 文档:
//   "Changing the header map after a call to WriteHeader (or Write) has no effect
//   unless the HTTP status code was 1xx". 原 w.WriteHeader(code) 后再 writeJSON
//   设 Content-Type 是 no-op → 响应无 Content-Type → fetch().json() 解析失败 toast
//   报网络错误. 改为先 set Content-Type + CORS, 再 WriteHeader, 再 Encode).
func writeJSONErr(w http.ResponseWriter, msg string, code int) {
        w.Header().Set("Content-Type", "application/json; charset=utf-8")
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.WriteHeader(code)
        json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": msg})
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

// adminTaskSubHandler — 分发 /api/admin/tasks/{id}/control 与 /api/admin/tasks/{id}/snapshot
//
//      path 结尾为 /control → adminTaskControlHandler
//      path 结尾为 /snapshot → adminTaskSnapshotHandler
//      path 为 {id} 且 method=DELETE → adminTaskDeleteHandler (R55-1A 新增: 删除任务)
//      path == "quick-fill" 且 method=POST → adminTasksQuickFill (R66-A 新增: 快速填充采集任务)
//      否则返回 404.
func adminTaskSubHandler(w http.ResponseWriter, r *http.Request) {
        path := strings.TrimPrefix(r.URL.Path, "/api/admin/tasks/")
        // R66-A: POST /api/admin/tasks/quick-fill — 用现有 enabled 规则批量建采集任务
        if path == "quick-fill" {
                if r.Method == http.MethodPost {
                        adminTasksQuickFill(w, r)
                        return
                }
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        // path 形如: {id}/control 或 {id}/snapshot
        if strings.HasSuffix(path, "/control") {
                adminTaskControlHandler(w, r)
                return
        }
        if strings.HasSuffix(path, "/snapshot") {
                adminTaskSnapshotHandler(w, r)
                return
        }
        // R55-1A: {id} (无后缀) + DELETE → 删除任务 (停止 runtime + 删 Task 行 + TaskLog 行)
        if r.Method == http.MethodDelete && path != "" && !strings.Contains(path, "/") {
                adminTaskDeleteHandler(w, r, path)
                return
        }
        writeJSONErr(w, "not found", 404)
}

// adminTaskDeleteHandler — DELETE /api/admin/tasks/:id 删除任务 (先停 runtime 再删 Task + TaskLog).
//
//   R55-1A: 全页面编辑功能补全. 原后台仅能 start/pause/stop, 无法删除已废弃任务.
//   删除前先 stop runtime (如果在跑), 再删 Task 行 + 关联 TaskLog 行 (级联清理).
//   禁止删除运行中任务 (必须先 stop).
func adminTaskDeleteHandler(w http.ResponseWriter, r *http.Request, taskID string) {
        // 查任务状态
        var status string
        err := db.QueryRow(`SELECT status FROM Task WHERE id=?`, taskID).Scan(&status)
        if err != nil {
                writeJSONErr(w, "任务不存在", 404)
                return
        }
        // 运行中需先 stop (避免 goroutine 残留)
        if status == "running" {
                writeJSONErr(w, "任务运行中, 请先停止再删除", 400)
                return
        }
        // 尝试 stop runtime (幂等, 不在跑也无害)
        tr := crawl.GetTaskRunner()
        if rt := tr.GetRuntime(taskID); rt != nil {
                rt.MarkStopped()
        }
        // 删 TaskLog + Task (TaskLog 无外键约束, 手动清)
        _, _ = db.Exec(`DELETE FROM TaskLog WHERE taskId=?`, taskID)
        _, err = db.Exec(`DELETE FROM Task WHERE id=?`, taskID)
        if err != nil {
                writeJSONErr(w, "删除失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{"id": taskID, "deleted": true})
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

// adminMetricsHandler — GET /api/admin/metrics 反反爬 7 类运行时快照.
//
// R66-A: 暴露 R65-B 就位的 7 个 Snapshot 函数给 admin UI + 运维监控.
//   R65-B 在 crawl/fetcher.go + crawl/smart.go 实现 7 类 per-host 运行时统计:
//     1. protoFingerprint — HTTP/2 ALPN + Server 头指纹 (R65-B 第 56 项)
//     2. utlsChoice      — TLS JA3 指纹 (R65-B 第 57 项, 36-fingerprint pool)
//     3. hostProxyPin    — 代理钉扎表 host→proxyURL (R65-B 第 58 项)
//     4. retryBudget     — 24h 重试预算计数器 (R65-B 第 59 项)
//     5. forwardedIP     — X-Forwarded-For 伪造 IP (R65-B 第 60 项)
//     6. collectRate     — 60s 滑动窗口 QPS/成功率/平均延迟 (R65-B B6)
//     7. hostRetryPolicy — 错误分类重试策略覆盖 (R65-B B7)
//   每个快照为 sync.Map 范围拷贝 (不阻塞采集路径). utlsPoolSize 暴露 36-fingerprint
//   pool 大小供运维识别 "全站统一指纹" 风险.
//
// 路由注册 (R66-A init() 自注册, 不改 main.go):
//   func init() { http.HandleFunc("/api/admin/metrics", adminMetricsHandler) }
func adminMetricsHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        writeJSONOK(w, map[string]interface{}{
                "protoFingerprint": crawl.HostProtoFingerprintSnapshot(),
                "utlsChoice":       crawl.UtlsChoiceSnapshot(),
                "utlsPoolSize":     crawl.UtlsPoolSize(),
                "hostProxyPin":     crawl.HostProxyPinSnapshot(),
                "retryBudget":      crawl.RetryBudgetSnapshot(),
                "forwardedIP":      crawl.ForwardedIPSnapshot(),
                "collectRate":      crawl.CollectRateHostsSnapshot(),
                "hostRetryPolicy":  crawl.HostRetryPolicySnapshot(),
        })
}

// R66-A: 自注册 admin 路由 (admin.go 范围内, 不改 main.go).
//   init() 在 main() 之前运行; net/http DefaultServeMux 的 HandleFunc 是
//   idempotent + additive, 与 main.go 的注册共存. handler 函数引用 package-level
//   db var, 请求到达时 db 已初始化 (main() 内 sql.Open 后再 ListenAndServe).
//   R66-D 主控只改 DEPLOY.md+README.md 不改 main.go, 本轮所有新 endpoint
//   (quick-fill 走 adminTaskSubHandler 子路径 + metrics 走 init) 都在 admin.go 范围内.
func init() {
        http.HandleFunc("/api/admin/metrics", adminMetricsHandler)
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
//      入参校验: ruleId + normalizeTaskData + validateTaskPair
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
        // R68-D BUG-76 (P3): R67-D 未决项 #5. mode="urls" 时 URLs 来自 fetchConfig.urls
        //   数组, 用户传 fetchConfig 无 urls 数组时任务启动但不采任何书 (静默空跑).
        //   runner.go ExecuteTask line ~883: `bookQueue = append([]string(nil), cfg.Override.URLs...)`
        //   URLs 为空 → bookQueue 长度 0 → 跳过列表发现 + 阶段1采集循环 → 任务秒完成
        //   "0 本". 操作员以为任务正常, 但实际什么也没采. 修复: 校验 mode="urls"
        //   时 fetchConfigStr 必须含 urls 非空数组 (≥1 个 http(s) URL). 与 adminTasksCreate
        //   mode=single (bookURL 必填) + mode=range (listURL 必填) 同款入口校验.
        //   注: 必须放在 fetchConfigStr 解析之后 (line 780+), 否则 fetchConfigStr 仍是 "{}".
        if mode == "urls" {
                var fc struct {
                        URLs []string `json:"urls"`
                }
                if json.Unmarshal([]byte(fetchConfigStr), &fc) != nil || len(fc.URLs) == 0 {
                        writeJSONErr(w, "urls 模式必须提供 fetchConfig.urls 非空数组 (至少 1 个 http(s) URL)", 400)
                        return
                }
                // 校验每个 URL 是 http(s) (与 mode=single 的 httpURL 校验同口径, 防 file:// 等)
                for _, u := range fc.URLs {
                        if httpURL(u) == "" {
                                writeJSONErr(w, "fetchConfig.urls 内含非法 URL (仅支持 http/https): "+u, 400)
                                return
                        }
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
                threadMin, threadMax, intervalMin, intervalMax, recrawlMode,
                smartCategory, smartComplete, autoSuggest)

        writeJSONOK(w, map[string]interface{}{
                "id": taskID, "name": name, "ruleId": ruleID, "ruleName": ruleName,
                "status": "running",
        })
}

// adminTasksQuickFill — POST /api/admin/tasks/quick-fill 用现有规则批量建采集任务.
//
// 用户需求 #4: 用现有采集规则, 建立采集任务快速填充站点内容 (不同类型的书籍).
//   入参 (全可选, 默认 = 所有 enabled=true 规则 + 每规则 50 本):
//     {
//       "siteId": "...",                       // 站点 ID (R67 用于按站过滤规则, 本轮忽略)
//       "ruleIds": ["...","..."],              // 指定规则 ID 列表 (默认空 = 全 enabled 规则)
//       "maxBooksPerRule": 50                  // 每规则采书上限 (1-1000, 默认 50)
//     }
//   流程:
//     1. 查 Rule 表 (body.ruleIds 指定则按 ID IN(...) 查; 否则 enabled=1 全查, LIMIT 100)
//     2. 对每条规则:
//        a. 解析 Rule.config 取 List.URLTemplate 作 listUrl
//        b. URLTemplate 为空 → 跳过 (返 skippedDetails)
//        c. INSERT Task 行 (mode=range, listStart=1, listEnd=3, bookStart=0,
//           bookEnd=maxBooksPerRule, recrawlMode=incremental, status=pending)
//        d. 异步调 startCrawlTask 启动采集
//     3. 返回 {ok:true, data:{created:N, skipped:M, tasks:[...], skippedDetails:[...]}}
//
// 设计权衡:
//   - 默认 50 本/规则 + listEnd=3 (列表前 3 页) 平衡 "快速填充" 与 "源站频控".
//     8 enabled 规则 × 50 本 = ~400 本入库. 用户可在 admin/tasks UI 暂停 / 删除.
//   - task 名格式 "[quick-fill] {ruleName} {YYYYMMDD}" 便于事后筛选.
//   - 不在 API 内联动 siteId (R67 可扩展): ruleIds 为空 → 全 enabled, 不分站.
//   - 异步启动: 创建后立即返回, 避免 HTTP 长连接; 采集进度由 admin/tasks 列表实时查.
func adminTasksQuickFill(w http.ResponseWriter, r *http.Request) {
        body := readJSONBody(r)
        maxBooks := clampIntAdm(intField(body, "maxBooksPerRule", 50, 1, 1000), 1, 1000)

        // 取 ruleIds (默认空 = 全 enabled)
        ruleIDs := []string{}
        if v, ok := body["ruleIds"]; ok && v != nil {
                switch x := v.(type) {
                case []interface{}:
                        for _, e := range x {
                                if s, isStr := e.(string); isStr && s != "" {
                                        ruleIDs = append(ruleIDs, s)
                                }
                        }
                case []string:
                        for _, s := range x {
                                if s != "" {
                                        ruleIDs = append(ruleIDs, s)
                                }
                        }
                }
        }

        // 查 Rule 表
        type ruleInfo struct {
                id, name, config string
        }
        rules := []ruleInfo{}
        if len(ruleIDs) > 0 {
                // 用 IN (...) 查指定规则 (含 disabled, 让 caller 可手动启用单条规则采)
                placeholders := make([]string, len(ruleIDs))
                args := make([]interface{}, len(ruleIDs))
                for i, id := range ruleIDs {
                        placeholders[i] = "?"
                        args[i] = id
                }
                q := `SELECT id,name,config FROM Rule WHERE id IN (` + strings.Join(placeholders, ",") + `)`
                rows, err := db.Query(q, args...)
                if err != nil {
                        writeJSONErr(w, "查询规则失败: "+err.Error(), 500)
                        return
                }
                for rows.Next() {
                        var ri ruleInfo
                        if err := rows.Scan(&ri.id, &ri.name, &ri.config); err == nil {
                                rules = append(rules, ri)
                        }
                }
                rows.Close()
        } else {
                // 默认查所有 enabled=1 规则
                rows, err := db.Query(`SELECT id,name,config FROM Rule WHERE enabled=1 ORDER BY updatedAt DESC LIMIT 100`)
                if err != nil {
                        writeJSONErr(w, "查询规则失败: "+err.Error(), 500)
                        return
                }
                for rows.Next() {
                        var ri ruleInfo
                        if err := rows.Scan(&ri.id, &ri.name, &ri.config); err == nil {
                                rules = append(rules, ri)
                        }
                }
                rows.Close()
        }

        if len(rules) == 0 {
                writeJSONErr(w, "未找到可用规则 (请先在 admin/rules 启用规则, 或 body.ruleIds 指定)", 400)
                return
        }

        // 为每规则创建 Task + 异步启动
        dateStr := time.Now().Format("20060102")
        // R67-D BUG-57 (P3): 加 json tag 让 JSON 字段名 lowercase (id/name/ruleId),
        //   与 adminTasksCreate 的响应字段 (line 728: id/name/ruleId/ruleName) 对齐.
        //   原实现 createdTask{ID,Name,RuleID} 无 tag, json.Marshal 输出大写字段名
        //   "ID"/"Name"/"RuleID", API 合约不一致 (前端 tasks.html 当前只读 created 数
        //   不迭代 tasks 数组, 故功能不受影响, 但合约不一致, 第三方脚本消费 API 时易踩坑).
        type createdTask struct {
                ID     string `json:"id"`
                Name   string `json:"name"`
                RuleID string `json:"ruleId"`
        }
        created := []createdTask{}
        skipped := []map[string]interface{}{}

        // 默认值 (与 adminTasksCreate 默认一致)
        fetchConfigStr := "{}"
        threadMin := 1
        threadMax := 3
        intervalMin := 500
        intervalMax := 2000
        recrawlMode := "incremental"
        smartCategory := true
        smartComplete := true
        autoSuggest := true
        autoRefresh := false
        refreshIntervalMin := 30

        for _, rule := range rules {
                // 解析 Rule.config 取 List.URLTemplate
                ruleParsed := crawl.ParseRuleConfig(rule.config)
                listURL := ruleParsed.List.URLTemplate
                if listURL == "" {
                        skipped = append(skipped, map[string]interface{}{
                                "ruleId": rule.id,
                                "name":   rule.name,
                                "reason": "Rule.config List.URLTemplate 为空 (规则未配置列表页模板)",
                        })
                        continue
                }

                taskID := generateID()
                taskName := fmt.Sprintf("[quick-fill] %s %s", rule.name, dateStr)

                _, err := db.Exec(
                        `INSERT INTO Task
                           (id,name,ruleId,mode,bookUrl,listUrl,listStart,listEnd,bookStart,bookEnd,
                            recrawlMode,storageMode,fetchConfig,threadMin,threadMax,intervalMin,intervalMax,
                            smartCategory,smartComplete,autoSuggest,autoRefresh,refreshIntervalMin,
                            status,progress,stats,createdAt,updatedAt)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','{}','{}',datetime('now'),datetime('now'))`,
                        taskID, taskName, rule.id, "range", "", listURL, 1, 3, 0, maxBooks,
                        recrawlMode, "db", fetchConfigStr, threadMin, threadMax, intervalMin, intervalMax,
                        smartCategory, smartComplete, autoSuggest, autoRefresh, refreshIntervalMin,
                )
                if err != nil {
                        skipped = append(skipped, map[string]interface{}{
                                "ruleId": rule.id,
                                "name":   rule.name,
                                "reason": "INSERT Task 失败: " + err.Error(),
                        })
                        continue
                }

                // 异步启动采集 (复用 adminTasksCreate 同款 startCrawlTask)
                go startCrawlTask(taskID, rule.id, rule.config, "range", "", listURL, fetchConfigStr,
                        threadMin, threadMax, intervalMin, intervalMax, recrawlMode,
                        smartCategory, smartComplete, autoSuggest)

                created = append(created, createdTask{ID: taskID, Name: taskName, RuleID: rule.id})
        }

        writeJSONOK(w, map[string]interface{}{
                "created":        len(created),
                "skipped":         len(skipped),
                "maxBooksPerRule": maxBooks,
                "tasks":           created,
                "skippedDetails":  skipped,
        })
}

// startCrawlTask — 异步启动 crawl.ExecuteTask (goroutine).
//
//      构建 crawl.ExecuteTaskConfig + 调 crawl.ExecuteTask (R38-1C 三阶段采集主入口).
//      错误隔离: 单任务失败不影响其他; 终态写回 DB.
//      R54-1B: 新增 smartCategory/smartComplete/autoSuggest 三 bool 参数, 与 Task 表字段
//        一致传入 crawl.ExecuteTaskConfig. crawl.CrawlBookMeta 据此条件调 SmartCategory /
//        SmartCompleteDetect (原 R38-1C 重写后 SmartCategory 函数存在但从未被调用,
//        detectedStatus 也仅用于运行时分流不持久化 — 已修).
func startCrawlTask(taskID, ruleID, ruleConfig, mode, bookURL, listURL, fetchConfigStr string,
        threadMin, threadMax, intervalMin, intervalMax int, recrawlMode string,
        smartCategory, smartComplete, autoSuggest bool) {

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
                TaskID:         taskID,
                Rule:           rule,
                Override:       override,
                URLTemplate:    listURL,
                ThreadsMin:     threadMin,
                ThreadsMax:     threadMax,
                IntervalMin:    intervalMin,
                IntervalMax:    intervalMax,
                MaxRequests:    override.MaxRequests,
                RecrawlMode:    recrawlMode,
                DB:             adb,
                Logger: func(tid string, level crawl.LogLevel, msg string) {
                        log.Printf("[task:%s][%s] %s", tid, level, msg)
                },
                SmartCategory: smartCategory,
                SmartComplete: smartComplete,
                AutoSuggest:   autoSuggest,
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
//      控制命令: start/pause/stop/resume.
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
                smartCategory, smartComplete, autoSuggest                                 bool
        )
        // R54-1B: SELECT 加 t.smartCategory, t.smartComplete, t.autoSuggest 字段 (原 startCrawlTask
        //   二次启动时丢失智能化开关 → SmartCategory/SmartComplete 不被调). 修复后 startCrawlTask
        //   签名带这三个 bool, 从 Task 行读出后透传.
        err := db.QueryRow(
                `SELECT t.name,t.ruleId,t.mode,t.bookUrl,t.listUrl,t.fetchConfig,t.recrawlMode,
                        t.threadMin,t.threadMax,t.intervalMin,t.intervalMax,t.status,
                        t.smartCategory,t.smartComplete,t.autoSuggest,
                        COALESCE(r.config,'{}')
                   FROM Task t LEFT JOIN Rule r ON t.ruleId=r.id
                  WHERE t.id=?`, taskID,
        ).Scan(&name, &ruleID, &mode, &bookURL, &listURL, &fetchConfigStr, &recrawlMode,
                &threadMin, &threadMax, &intervalMin, &intervalMax, &status,
                &smartCategory, &smartComplete, &autoSuggest, &ruleConfig)
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
                                threadMin, threadMax, intervalMin, intervalMax, recrawlMode,
                                smartCategory, smartComplete, autoSuggest)
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
        // R64-C BUG-38 (P0): 先收齐 rule 行再循环 (逐 rule 调 db.QueryRow 算 taskCount).
        //   原实现 db.QueryRow 在 for rows.Next() 内部 → modernc.org/sqlite 连接池
        //   (SetMaxOpenConns(1)) 等待 rows 释放 → 30s+ 超时死锁 (Rule 表非空时必现).
        //   修复: rows 扫完转 []struct, 显式 Close rows, 再循环调 db.QueryRow.
        type ruleRow struct {
                ID, Name, Config, CreatedAt, UpdatedAt string
                Description                            sql.NullString
                Enabled                                bool
        }
        ruleRows := []ruleRow{}
        for rows.Next() {
                var rr ruleRow
                _ = rows.Scan(&rr.ID, &rr.Name, &rr.Description, &rr.Config, &rr.Enabled, &rr.CreatedAt, &rr.UpdatedAt)
                ruleRows = append(ruleRows, rr)
        }
        rows.Close()
        out := []map[string]interface{}{}
        for _, rr := range ruleRows {
                // 统计每个规则的任务数 (rows 已 Close, 不再持锁)
                var taskCount int
                _ = db.QueryRow(`SELECT COUNT(*) FROM Task WHERE ruleId=?`, rr.ID).Scan(&taskCount)
                out = append(out, map[string]interface{}{
                        "id":          rr.ID,
                        "name":        rr.Name,
                        "description": rr.Description.String,
                        "config":      rr.Config,
                        "enabled":     rr.Enabled,
                        "taskCount":   taskCount,
                        "createdAt":   rr.CreatedAt,
                        "updatedAt":   rr.UpdatedAt,
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
                // R69-D BUG-85 (P3): 原 PUT 无存在性检查, UPDATE 不存在的 ruleID 影响行 0
                //   但 API 仍返 200 {updated:true} → 操作员以为更新成功, 实际未改. 修复:
                //   UPDATE 前先 SELECT id FROM Rule WHERE id=? 校验, 不存在返 404.
                //   与 adminBookByIDHandler PUT (line 1685) / adminSiteByIDHandler PUT (line 4332)
                //   同款存在性检查. DELETE 路径已用 COUNT(*) FROM Task 间接验存在, 故只在 PUT 加.
                var existRule string
                _ = db.QueryRow(`SELECT id FROM Rule WHERE id=?`, ruleID).Scan(&existRule)
                if existRule == "" {
                        writeJSONErr(w, "规则不存在", 404)
                        return
                }
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

        case http.MethodDelete:
                // R55-1A: 删除规则. 禁止删除被任务引用的规则 (避免悬空外键).
                var taskCount int
                _ = db.QueryRow(`SELECT COUNT(*) FROM Task WHERE ruleId=?`, ruleID).Scan(&taskCount)
                if taskCount > 0 {
                        writeJSONErr(w, fmt.Sprintf("该规则被 %d 个任务引用, 请先删除/迁移相关任务", taskCount), 400)
                        return
                }
                _, err := db.Exec(`DELETE FROM Rule WHERE id=?`, ruleID)
                if err != nil {
                        writeJSONErr(w, "删除失败: "+err.Error(), 500)
                        return
                }
                writeJSONOK(w, map[string]interface{}{"id": ruleID, "deleted": true})

        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// adminBooksAPIHandler — GET /api/admin/books 列书籍 (带 q/categoryId/status 过滤 + 分页)
// R55-1A: 新增 POST 手动建书 (与 PUT /api/admin/books/:id 配合, 后台可手动维护书籍元数据).
func adminBooksAPIHandler(w http.ResponseWriter, r *http.Request) {
        switch r.Method {
        case http.MethodGet:
                adminBooksList(w, r)
        case http.MethodPost:
                adminBooksCreate(w, r)
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// adminBooksList — 原 adminBooksAPIHandler 的 GET 逻辑 (q/categoryId/status 过滤 + 分页 + JOIN 分类).
//   R67-D BUG-55 (P1): SELECT 改 COALESCE(b.categoryId,'') — Book.categoryId 在 schema 是
//     String? (nullable), adminBooksCreate/adminBookByIDHandler PUT/adminDB.UpsertBook 均
//     用 nullIfEmpty("") 写入 NULL. 原实现 Scan 进 plain string 在 NULL 行触发
//     "sql: Scan error ... converting NULL to string is unsupported" — Scan 在 categoryId
//     列停下, 其后 sourceUrl/storageMode/chapterCount/updatedAt 列均不读, 行被 append
//     含半空字段. DB 实测 170/668 (~25%) books 有 NULL categoryId → admin/books 列表
//     显示这 25% 书的 storageMode 空 / chapterCount=0 / updatedAt 空. COALESCE 兜底空串.
func adminBooksList(w http.ResponseWriter, r *http.Request) {
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

        // R68-D BUG-77 (P3): R67-D 未决项 #3 同款 nullable Scan + offset/page 一致性.
        //   原实现: page 来自用户输入 (clamp 1-1000000), offset 单独 clamp 到 10000.
        //   用户传 ?page=99999 size=20 → offset=199980 → clamp 到 10000 (page 501 数据),
        //   但 API 响应仍返 page=99999. 前端显示 "page 99999 of 5" 与数据 (page 501) 不一致.
        //   修复: 先 clamp page 到 maxPages (= maxPaginationOffset/size + 1) 再算 offset,
        //   page 与 offset 一致. 与 main.go homeHandler category view (R64-D BUG-31 修复)
        //   同款 maxPaginationOffset=10000 常量.
        maxPages := maxPaginationOffset/size + 1
        if page > maxPages {
                page = maxPages
        }
        offset := (page - 1) * size
        if offset > maxPaginationOffset {
                offset = maxPaginationOffset
        }
        queryArgs := append(args, size, offset)
        rows, err := db.Query(
                `SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,
                        COALESCE(c.name,'未分类'),COALESCE(b.categoryId,''),b.sourceUrl,b.storageMode,
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

// adminBooksCreate — POST /api/admin/books 手动建书 (R55-1A: 后台全页面编辑功能补全).
//
//   原后台 books 仅能看不能改, 全靠采集. 现支持手动录入书籍元数据:
//   - name (必填 1-200), author (默认佚名), intro (2000 字), cover (URL 或 /covers/ 相对路径),
//     status (unknown|ongoing|completed), categoryId (校验存在), sourceUrl, keywords.
//   - storageMode 固定 'db' (手动建书无源文件); wordCount 默认 0 (后续章节自动累计).
//   - 章节后续可单独 PUT/DELETE 添加.
func adminBooksCreate(w http.ResponseWriter, r *http.Request) {
        body := readJSONBody(r)
        name := strField(body, "name", 200)
        if name == "" {
                writeJSONErr(w, "书名必填(1~200字)", 400)
                return
        }
        author := strField(body, "author", 100)
        if author == "" {
                author = "佚名"
        }
        intro := strField(body, "intro", 2000)
        cover := strField(body, "cover", 2000)
        // cover 仅接受 http(s) 或 /covers/ 路径 (与 normalizeLinkLogo 同口径, 防 file:// 等协议注入)
        if cover != "" && !strings.HasPrefix(cover, "http://") && !strings.HasPrefix(cover, "https://") && !strings.HasPrefix(cover, "/covers/") && !strings.HasPrefix(cover, "/") {
                writeJSONErr(w, "封面地址非法(仅支持 http(s) 或 / 开头站内路径)", 400)
                return
        }
        status := strField(body, "status", 20)
        switch status {
        case "", "unknown":
                status = "unknown"
        case "ongoing", "completed":
                // ok
        default:
                writeJSONErr(w, "status 必须是 unknown/ongoing/completed 之一", 400)
                return
        }
        categoryID := strings.TrimSpace(strField(body, "categoryId", 64))
        if categoryID != "" {
                var exist string
                _ = db.QueryRow(`SELECT id FROM Category WHERE id=?`, categoryID).Scan(&exist)
                if exist == "" {
                        writeJSONErr(w, "categoryId 不存在", 400)
                        return
                }
        }
        sourceURL := strField(body, "sourceUrl", 2000)
        if sourceURL != "" && httpURL(sourceURL) == "" {
                writeJSONErr(w, "sourceUrl 必须是 http/https URL", 400)
                return
        }
        keywords := strField(body, "keywords", 500)
        bookID := generateID()
        catArg := nullIfEmpty(categoryID)
        // R55-1B 修复 BUG-6 (P0): 原 INSERT VALUES 子句多 1 个 `?` 占位符 (10 个 `?`
        //   + 7 个字面量 ('' / 0 / NULL / 'db' / NULL + 2 个 datetime) = 17 values vs
        //   16 cols → SQLite 报 "17 values for 16 columns", R55-1A 起 adminBooksCreate
        //   全部 POST 失败. args = 9 (id/name/author/categoryId/intro/cover/status/
        //   keywords/sourceUrl), VALUES 应有 9 个 `?` + '' + 0 + ? + NULL + 'db' +
        //   NULL + 2 datetime = 16 values for 16 cols (其中 sourceUrl 单独 `?` 是第 10
        //   个 args — 但 args 列里 sourceURL 是第 9 个, 与 SQL 第 10 个 ? 对应; 原
        //   SQL 第 9 个 ? 实际指向 latestChapter 列应为字面量 '').修复: 删去多出
        //   的第 9 个 ? (latestChapter 列改用 '' 字面量).
        _, err := db.Exec(
                `INSERT INTO Book (id,name,author,categoryId,intro,cover,status,keywords,latestChapter,wordCount,sourceUrl,sourceRuleId,storageMode,collectedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,'',0,?,NULL,'db',NULL,datetime('now'),datetime('now'))`,
                bookID, name, author, catArg, intro, cover, status, keywords, sourceURL,
        )
        if err != nil {
                writeJSONErr(w, "创建失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{
                "id": bookID, "name": name, "author": author,
                "categoryId": categoryID, "status": status,
                "intro": truncate(intro, 200), "cover": cover,
                "keywords": keywords, "sourceUrl": sourceURL,
                "storageMode": "db", "wordCount": 0, "chapterCount": 0,
        })
}

// adminBookByIDHandler — PUT/DELETE /api/admin/books/:id (R55-1A 新增).
//
//   PUT    /api/admin/books/:id  → 按字段增量更新 (name/author/intro/cover/status/categoryId/keywords/sourceUrl)
//   DELETE /api/admin/books/:id  → 删除书籍 + 关联章节 + BookTag + DownloadJob (级联清理)
func adminBookByIDHandler(w http.ResponseWriter, r *http.Request) {
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/books/"), "/")
        if len(parts) < 1 || parts[0] == "" {
                writeJSONErr(w, "缺少书籍 id", 400)
                return
        }
        bookID := parts[0]
        switch r.Method {
        case http.MethodPut:
                body := readJSONBody(r)
                var exist string
                _ = db.QueryRow(`SELECT id FROM Book WHERE id=?`, bookID).Scan(&exist)
                if exist == "" {
                        writeJSONErr(w, "书籍不存在", 404)
                        return
                }
                sets := []string{}
                args := []interface{}{}
                if v, ok := body["name"]; ok && v != nil {
                        s := strField(body, "name", 200)
                        if s == "" {
                                writeJSONErr(w, "书名不能为空", 400)
                                return
                        }
                        sets = append(sets, "name=?")
                        args = append(args, s)
                }
                if v, ok := body["author"]; ok && v != nil {
                        sets = append(sets, "author=?")
                        args = append(args, strField(body, "author", 100))
                }
                if v, ok := body["intro"]; ok && v != nil {
                        sets = append(sets, "intro=?")
                        args = append(args, strField(body, "intro", 2000))
                }
                if v, ok := body["cover"]; ok && v != nil {
                        cover := strField(body, "cover", 2000)
                        if cover != "" && !strings.HasPrefix(cover, "http://") && !strings.HasPrefix(cover, "https://") && !strings.HasPrefix(cover, "/covers/") && !strings.HasPrefix(cover, "/") {
                                writeJSONErr(w, "封面地址非法(仅支持 http(s) 或 / 开头站内路径)", 400)
                                return
                        }
                        sets = append(sets, "cover=?")
                        args = append(args, cover)
                }
                if v, ok := body["status"]; ok && v != nil {
                        s := strField(body, "status", 20)
                        switch s {
                        case "unknown", "ongoing", "completed":
                        default:
                                writeJSONErr(w, "status 必须是 unknown/ongoing/completed 之一", 400)
                                return
                        }
                        sets = append(sets, "status=?")
                        args = append(args, s)
                }
                if v, ok := body["categoryId"]; ok {
                        var catID string
                        if v != nil {
                                catID = strings.TrimSpace(strField(body, "categoryId", 64))
                        }
                        if catID != "" {
                                var existCat string
                                _ = db.QueryRow(`SELECT id FROM Category WHERE id=?`, catID).Scan(&existCat)
                                if existCat == "" {
                                        writeJSONErr(w, "categoryId 不存在", 400)
                                        return
                                }
                        }
                        sets = append(sets, "categoryId=?")
                        args = append(args, nullIfEmpty(catID))
                }
                if v, ok := body["keywords"]; ok && v != nil {
                        sets = append(sets, "keywords=?")
                        args = append(args, strField(body, "keywords", 500))
                }
                if v, ok := body["sourceUrl"]; ok && v != nil {
                        su := strField(body, "sourceUrl", 2000)
                        if su != "" && httpURL(su) == "" {
                                writeJSONErr(w, "sourceUrl 必须是 http/https URL", 400)
                                return
                        }
                        sets = append(sets, "sourceUrl=?")
                        args = append(args, su)
                }
                if len(sets) == 0 {
                        writeJSONErr(w, "无可更新字段", 400)
                        return
                }
                sets = append(sets, "updatedAt=datetime('now')")
                args = append(args, bookID)
                _, err := db.Exec(`UPDATE Book SET `+strings.Join(sets, ",")+` WHERE id=?`, args...)
                if err != nil {
                        writeJSONErr(w, "更新失败: "+err.Error(), 500)
                        return
                }
                writeJSONOK(w, map[string]interface{}{"id": bookID, "updated": true})
        case http.MethodDelete:
                var exist string
                _ = db.QueryRow(`SELECT id FROM Book WHERE id=?`, bookID).Scan(&exist)
                if exist == "" {
                        writeJSONErr(w, "书籍不存在", 404)
                        return
                }
                // R55-1B 修复 BUG-1 (P1): 原实现先 DELETE DownloadJob 行, 再循环查
                //   DownloadJob.bookId 做内存缓存清理 — 但行已被删, Scan 返 ErrNoRows,
                //   jbookID 恒空, 比对失败 → 内存缓存泄漏 (downloadFiles 残留已删 DownloadJob
                //   的内容缓存, 永不释放). 修复: 在 DELETE 前先收集要清的 jobID 集, 用集
                //   做内存清理, 顺序 = 先 SELECT jobID → DELETE DB 行 → 清内存.
                //
                // R69-D BUG-84 (P1): adminBookByIDHandler DELETE + 后台下载 goroutine race.
                //   R55-1B 原修复顺序 = 先 SELECT jobID → 清内存 → DELETE DB 行. 但 BUG-83
                //   修复 (goroutine SELECT status 移进 Lock) 后, 仍存在 race window:
                //   清内存 (Lock; delete map; Unlock) 与 DELETE FROM DownloadJob 之间,
                //   goroutine 可 Lock → SELECT status (running, 因 T2 尚未 DELETE row) →
                //   write map → Unlock. T2 后续 DELETE row + (无 map-clean) → orphan entry
                //   留 2h TTL. 修复: 把 "清内存" 移到所有 DELETE 之后 — DELETE row 先, 让
                //   goroutine 的 SELECT 返 ErrNoRows skip write; 或 goroutine write map 后
                //   T2 的 map-clean 清掉 entry. 全场景无 orphan (与 BUG-83 同款方法论).
                jobIDsToClean := []string{}
                jrows, _ := db.Query(`SELECT id FROM DownloadJob WHERE bookId=?`, bookID)
                for jrows != nil && jrows.Next() {
                        var jid string
                        _ = jrows.Scan(&jid)
                        if jid != "" {
                                jobIDsToClean = append(jobIDsToClean, jid)
                        }
                }
                if jrows != nil {
                        jrows.Close()
                }
                // 级联清理: Chapter + BookTag + DownloadJob + Book (无外键约束, 手动清).
                // 顺序: DB DELETE 在前 → map-clean 在后. (R69-D BUG-84)
                _, _ = db.Exec(`DELETE FROM Chapter WHERE bookId=?`, bookID)
                _, _ = db.Exec(`DELETE FROM BookTag WHERE bookId=?`, bookID)
                _, _ = db.Exec(`DELETE FROM DownloadJob WHERE bookId=?`, bookID)
                _, err := db.Exec(`DELETE FROM Book WHERE id=?`, bookID)
                if err != nil {
                        writeJSONErr(w, "删除失败: "+err.Error(), 500)
                        return
                }
                // 后清扫内存下载缓存 (用预收集的 jobID 集, 在 DB DELETE 后做 map-clean).
                // goroutine 此时 SELECT status 返 ErrNoRows (row gone) → skip write;
                // 或 goroutine 已 write map (在 DELETE 前抢到 Lock) → 这里 delete map 清掉.
                if len(jobIDsToClean) > 0 {
                        downloadFilesMu.Lock()
                        for _, jid := range jobIDsToClean {
                                delete(downloadFiles, jid)
                        }
                        downloadFilesMu.Unlock()
                }
                writeJSONOK(w, map[string]interface{}{"id": bookID, "deleted": true})
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
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
        // R57-1A 反预览挂掉修复: 渲染到 buffer 再写, 防止模板中途 panic 时
        //   WriteHeader(200) 已发 → http.Error(500) 触发 "superfluous response.WriteHeader"
        //   日志噪声 + 客户端收到半截 HTML (broken DOM + 500 status 不一致).
        //   buffer 渲染失败时返 500 干净响应 (与 homeHandler 同款).
        var buf strings.Builder
        if err := tmpls.ExecuteTemplate(&buf, tmplName, data); err != nil {
                log.Printf("[renderAdminPage] template %s render failed: %v", tmplName, err)
                http.Error(w, "模板渲染失败", 500)
                return
        }
        w.Header().Set("Content-Type", "text/html; charset=utf-8")
        w.Write([]byte(buf.String()))
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
//   R67-D BUG-55 (P1): 同 adminBooksList — SELECT 改 COALESCE(b.categoryId,'')
//     防 NULL categoryId 行 Scan 半截停. 见 adminBooksList 注释.
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
        // R68-D BUG-77 (P3): 同 adminBooksList — clamp totalPages 到 maxPages (= maxPaginationOffset/size + 1)
        //   防 page 与 offset 不一致 (page 显示 N 但数据来自 page 501 @ offset 10000).
        //   与 main.go homeHandler category view (R64-D BUG-31 修复) 同款 maxPaginationOffset=10000.
        maxPages := maxPaginationOffset/size + 1
        if totalPages > maxPages {
                totalPages = maxPages
        }
        if page > totalPages {
                page = totalPages
        }

        offset := (page - 1) * size
        if offset > maxPaginationOffset {
                offset = maxPaginationOffset
        }
        queryArgs := append(args, size, offset)
        rows, err := db.Query(
                `SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,
                        COALESCE(c.name,'未分类'),COALESCE(b.categoryId,''),b.sourceUrl,b.storageMode,b.keywords,
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
                        var id, name, author, intro, cover, status, latestChapter, category, catID, sourceURL, storageMode, keywords, updatedAt string
                        var wordCount int64
                        var chapterCount int
                        _ = rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter,
                                &category, &catID, &sourceURL, &storageMode, &keywords, &chapterCount, &updatedAt)
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
                                "keywords":      keywords,
                                "sourceUrl":     sourceURL,
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
                // R64-C BUG-39 (P0): 先收齐 rule 行再循环 (逐 rule 调 db.QueryRow 算 taskCount).
                //   原实现 db.QueryRow 在 for rows.Next() 内部 → modernc.org/sqlite 连接池
                //   (SetMaxOpenConns(1)) 等待 rows 释放 → 30s+ 超时死锁 (Rule 表非空时必现).
                //   修复: rows 扫完转 []struct, 显式 Close rows, 再循环调 db.QueryRow.
                type ruleRow struct {
                        ID, Name, Config, UpdatedAt string
                        Description                sql.NullString
                        Enabled                    bool
                }
                ruleRows := []ruleRow{}
                for rows.Next() {
                        var rr ruleRow
                        _ = rows.Scan(&rr.ID, &rr.Name, &rr.Description, &rr.Config, &rr.Enabled, &rr.UpdatedAt)
                        ruleRows = append(ruleRows, rr)
                }
                rows.Close()
                for _, rr := range ruleRows {
                        var taskCount int
                        _ = db.QueryRow(`SELECT COUNT(*) FROM Task WHERE ruleId=?`, rr.ID).Scan(&taskCount)
                        rules = append(rules, map[string]interface{}{
                                "id":          rr.ID,
                                "name":        rr.Name,
                                "description": rr.Description.String,
                                "config":      rr.Config,
                                "enabled":     rr.Enabled,
                                "taskCount":   taskCount,
                                "updatedAt":   rr.UpdatedAt,
                        })
                        total++
                        if rr.Enabled {
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
//
//   R55-1A: SELECT 扩展含 icbm/geoRegion/geoPlacename/inLinkWheel, 供 edit 表单回填.
//   附带 Themes 列表 (来自 adminThemes 静态注册表), 供 site edit modal 下拉主题选择.
//   R63-A: SELECT 加 pseudoStaticStyle, 供 admin/sites.html edit modal 下拉选择 (R63-B 接入模板).
//   R64-C: SELECT 加 13 高级 SEO 字段 (footerText/footerCopyright/footerIcp/footerStats/
//     navCategoryCount/homeModuleLimit/chapterPaginationMode/chapterPaginationWords/
//     chapterPaginationPages/chapterSeoAuto/chapterSeoTitleTemplate/chapterSeoDescTemplate/
//     chapterSeoKeywordsTemplate), 供 admin/sites.html edit modal 高级 SEO 字段回填.
func fillSitesPageData(data map[string]interface{}) {
        rows, err := db.Query(
                `SELECT id,name,domain,themeId,isDefault,title,description,keywords,
                        COALESCE(icbm,''),COALESCE(geoRegion,''),COALESCE(geoPlacename,''),offset,status,inLinkWheel,pseudoStaticStyle,
                        COALESCE(footerText,''),COALESCE(footerCopyright,''),COALESCE(footerIcp,''),COALESCE(footerStats,1),
                        COALESCE(navCategoryCount,16),COALESCE(homeModuleLimit,20),
                        COALESCE(chapterPaginationMode,'off'),COALESCE(chapterPaginationWords,3000),COALESCE(chapterPaginationPages,3),
                        COALESCE(chapterSeoAuto,1),COALESCE(chapterSeoTitleTemplate,''),COALESCE(chapterSeoDescTemplate,''),COALESCE(chapterSeoKeywordsTemplate,'')
                   FROM Site ORDER BY isDefault DESC, name ASC LIMIT 200`)
        sites := []map[string]interface{}{}
        total := 0
        defaultName := "-"
        if err == nil {
                defer rows.Close()
                for rows.Next() {
                        var id, name, domain, themeID, title, desc, kw, icbm, geoR, geoP, pseudoStaticStyle string
                        var footerText, footerCopyright, footerIcp, chapterPaginationMode, chapterSeoTitleTemplate, chapterSeoDescTemplate, chapterSeoKeywordsTemplate string
                        var offset, navCategoryCount, homeModuleLimit, chapterPaginationWords, chapterPaginationPages int
                        var isDefault, status, inLinkWheel, footerStats, chapterSeoAuto bool
                        _ = rows.Scan(&id, &name, &domain, &themeID, &isDefault, &title, &desc, &kw,
                                &icbm, &geoR, &geoP, &offset, &status, &inLinkWheel, &pseudoStaticStyle,
                                &footerText, &footerCopyright, &footerIcp, &footerStats, &navCategoryCount, &homeModuleLimit,
                                &chapterPaginationMode, &chapterPaginationWords, &chapterPaginationPages,
                                &chapterSeoAuto, &chapterSeoTitleTemplate, &chapterSeoDescTemplate, &chapterSeoKeywordsTemplate)
                        if pseudoStaticStyle == "" {
                                pseudoStaticStyle = "query"
                        }
                        if chapterPaginationMode == "" {
                                chapterPaginationMode = "off"
                        }
                        sites = append(sites, map[string]interface{}{
                                "id":                          id,
                                "name":                        name,
                                "domain":                      domain,
                                "themeId":                     themeID,
                                "isDefault":                   isDefault,
                                "title":                       title,
                                "description":                 desc,
                                "keywords":                    kw,
                                "icbm":                        icbm,
                                "geoRegion":                   geoR,
                                "geoPlacename":                geoP,
                                "status":                      status,
                                "offset":                      offset,
                                "inLinkWheel":                 inLinkWheel,
                                "pseudoStaticStyle":           pseudoStaticStyle,
                                "footerText":                  footerText,
                                "footerCopyright":             footerCopyright,
                                "footerIcp":                   footerIcp,
                                "footerStats":                 footerStats,
                                "navCategoryCount":            navCategoryCount,
                                "homeModuleLimit":             homeModuleLimit,
                                "chapterPaginationMode":       chapterPaginationMode,
                                "chapterPaginationWords":      chapterPaginationWords,
                                "chapterPaginationPages":      chapterPaginationPages,
                                "chapterSeoAuto":              chapterSeoAuto,
                                "chapterSeoTitleTemplate":     chapterSeoTitleTemplate,
                                "chapterSeoDescTemplate":      chapterSeoDescTemplate,
                                "chapterSeoKeywordsTemplate":  chapterSeoKeywordsTemplate,
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
        // R55-1A: 主题下拉列表 (供 site edit modal)
        themeList := []map[string]interface{}{}
        for _, t := range adminThemes {
                themeList = append(themeList, map[string]interface{}{
                        "id": t.ID, "name": t.Name,
                })
        }
        data["Themes"] = themeList
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
// R53-1B: 先经 formatUpdatedAt 归一化 (Unix ms / SQLite TEXT / ISO 串 → "2006-01-02 15:04"),
//   修复 Prisma @updatedAt 存 Unix ms 时 s[5:7]+s[8:10] 切出时间戳片段的 bug.
func shortTime(s string) string {
        s = formatUpdatedAt(s)
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

// ---------- 主题静态注册表 (10 套精仿主题) ----------

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

// adminThemes 10 套精仿主题 (themeId → 主题元数据: title/description/preview).
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
                // R69-D BUG-86 (P3): 原 PUT 无存在性检查, UPDATE 不存在的 categoryID 影响
                //   行 0 但 API 仍返 200 {updated:true} → 操作员以为更新成功, 实际未改.
                //   修复: UPDATE 前先 SELECT id FROM Category WHERE id=? 校验, 不存在返
                //   404. 与 adminRuleByIDHandler PUT (BUG-85) / adminBookByIDHandler PUT /
                //   adminSiteByIDHandler PUT 同款存在性检查.
                var existCat string
                _ = db.QueryRow(`SELECT id FROM Category WHERE id=?`, id).Scan(&existCat)
                if existCat == "" {
                        writeJSONErr(w, "分类不存在", 404)
                        return
                }
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
        // R64-C BUG-40 (P0): 先收齐 category 行再循环 (逐 category 调 db.QueryRow 算 bookCount).
        //   原实现 db.QueryRow 在 for rows.Next() 内部 → modernc.org/sqlite 连接池
        //   (SetMaxOpenConns(1)) 等待 rows 释放 → 30s+ 超时死锁 (Category 表非空时必现).
        //   修复: rows 扫完转 []struct, 显式 Close rows, 再循环调 db.QueryRow.
        type catRow struct {
                ID, Name, CreatedAt string
                SortOrder            int
        }
        catRows := []catRow{}
        for rows.Next() {
                var cr catRow
                _ = rows.Scan(&cr.ID, &cr.Name, &cr.SortOrder, &cr.CreatedAt)
                catRows = append(catRows, cr)
        }
        rows.Close()
        out := []map[string]interface{}{}
        for _, cr := range catRows {
                var bookCount int
                _ = db.QueryRow(`SELECT COUNT(*) FROM Book WHERE categoryId=?`, cr.ID).Scan(&bookCount)
                out = append(out, map[string]interface{}{
                        "id": cr.ID, "name": cr.Name, "sortOrder": cr.SortOrder,
                        "bookCount": bookCount, "createdAt": cr.CreatedAt,
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
                        // R64-C BUG-45 (P2): goroutine panic 兜底 (如 OOM 拼 TXT, 或
                        //   db.Query 返意外类型断言失败), 原 defer 仅 --inFlight,
                        //   DownloadJob 残留 status='running' 永不终态 → 用户卡住等不到
                        //   done/error. 修复: recover() 把 panic 转 DB UPDATE error,
                        //   与正常路径一样落 status='error' + error 信息.
                        if r := recover(); r != nil {
                                _, _ = db.Exec(`UPDATE DownloadJob SET status='error', error=? WHERE id=?`,
                                        fmt.Sprintf("panic: %v", r), jid)
                        }
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
                // R69-D BUG-83 (P1): adminDownloadsDelete + 后台下载 goroutine race.
                //   R68-D BUG-74 试过把 SELECT status 移出 lock 在 lock 前做 "写缓存前查
                //   status='running' 否则跳过", 但 SELECT 与 Lock 之间仍有 race window:
                //     1) goroutine SELECT status='running' (lock 外)
                //     2) adminDownloadsDelete: Lock; delete(downloadFiles, jobID); Unlock
                //     3) adminDownloadsDelete: DELETE FROM DownloadJob (row gone)
                //     4) goroutine: Lock; sweep; downloadFiles[jid] = entry; Unlock  ← orphan!
                //     5) goroutine: UPDATE status='done' (no-op, row gone)
                //   orphan entry 留 2h TTL (downloadFilesTTLSeconds) 才被清扫, 50 entries
                //   上限前 ~50 数 MB TXT 占用内存 (万章书 TXT 可达 50MB).
                //   修复: (a) goroutine SELECT status 移进 Lock 内 — 与 write map 原子;
                //   (b) adminDownloadsDelete 的 DELETE row 移进 Lock 内 — 与 delete map 原子.
                //   双向原子后所有竞态场景收敛:
                //     · Goroutine 先持锁 → SELECT running → write map → Unlock; Delete 后持锁
                //       → delete map (清掉 goroutine 写的 entry) → DELETE row → Unlock. ✓
                //     · Delete 先持锁 → delete map → DELETE row → Unlock; Goroutine 后持锁
                //       → SELECT 返 ErrNoRows (row gone) → skip write → Unlock. ✓
                //   panic 安全: 用内嵌 closure + defer Unlock, panic 时内层 defer 先 Unlock,
                //   外层 defer (recover + inFlight--) 后接住 panic 转 status='error'.
                //   不引入 context cancel / WaitGroup: 锁内 SELECT+write+Unlock 已足够串行化,
                //   context cancel 会让 chapters query 中途失败 (用户已等几秒拼 TXT), 体验更差.
                writeOK := false
                func() {
                        downloadFilesMu.Lock()
                        defer downloadFilesMu.Unlock() // panic 安全: 内层 defer 先于外层 recover
                        var jidStatus string
                        if err := db.QueryRow(`SELECT status FROM DownloadJob WHERE id=?`, jid).Scan(&jidStatus); err != nil || jidStatus != "running" {
                                // 行已删 (adminDownloadsDelete DELETE 抢先) 或 status 已被其他 handler
                                // 改 (e.g. clear 全清标 'error') → 不写缓存, 避免 orphan entry.
                                return
                        }
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
                        writeOK = true
                }()
                if !writeOK {
                        return
                }
                _, _ = db.Exec(`UPDATE DownloadJob SET status='done', filePath=?, size=? WHERE id=?`, "memory:"+jid, len(txt), jid)
        }(jobID, bookID, bookName)

        writeJSONOK(w, map[string]interface{}{
                "id": jobID, "bookId": bookID, "bookName": bookName,
                "status": "pending",
        })
}

// ---------- 系统设置 API ----------

var settingKeyRE = regexp.MustCompile(`^[A-Za-z0-9_.\-]{1,64}$`)

// R54-1A: 系统设置项的中文说明 / 默认值 / 分类.
//   fillSettingsPageData 在装配每条设置时附带 desc/defaultValue/category 字段, 让
//   admin/settings 页面不再只显示 "key-value" 让人看不懂.
//   key 不在表内时前端显示空 desc/value "-" (用户仍可在表单中编辑任意 key).
var settingMeta = map[string]struct {
        desc        string
        defaultVal  string
        category    string
        isFeedback  bool
}{
        "feedbackEnabled":    {"反馈模块开关 (true=前台渲染反馈按钮 / false=完全隐藏按钮+拒绝 /api/feedback 提交)", "true", "前端功能", true},
        "miniServiceConfig":  {"mini-services 配置 (各代理/captcha/trafilatura/scrapling 服务的端点与凭证, JSON)", "{}", "采集服务", false},
        "linkwheel":          {"站群链轮配置 (FriendLink 自动推送/接收策略 + 互推顺序)", "", "SEO 站群", false},
        "lastBackupAt":       {"上次数据库备份时间戳 (admin /admin/backup 显示用)", "", "运维", false},
        "announcement":       {"站点公告 (前台首页/阅读页底部显示, 留空=不显示)", "", "前端功能", false},
        "site.default":       {"默认站点 ID (URL 无 ?site= 时使用)", "", "站点", false},
        "crawl.rateLimit":    {"采集速率限制 (RPS, 0=不限)", "0", "采集服务", false},
        "crawl.captchaMode":  {"captcha 解决策略 (auto/2captcha/capsolver/none)", "auto", "采集服务", false},
        "crawl.proxyMode":    {"代理使用策略 (off/per-host/least-latency/weighted-latency)", "per-host", "采集服务", false},
        "crawl.tlsPoolSize":  {"uTLS 指纹池大小 (并发握手数上限, 16~36 调优)", "36", "采集服务", false},
        "seo.sitemapEnabled": {"是否生成 sitemap.xml (true/false)", "true", "SEO", false},
        "seo.robotsTxt":      {"robots.txt 内容 (留空=使用默认模板)", "", "SEO", false},
}

// R54-1A: getFeedbackEnabled — 读 Setting 表的 feedbackEnabled 值.
//   缺失或非 "false" 字面量均视为 true (向后兼容默认启用), 与 prisma 端 default 行为一致.
//   每次调用一次 SELECT (SQLite 单行查询, <0.1ms, 不需要缓存层).
func getFeedbackEnabled() bool {
        var v string
        err := db.QueryRow(`SELECT value FROM Setting WHERE key='feedbackEnabled'`).Scan(&v)
        if err != nil || v == "" {
                return true
        }
        var parsed interface{}
        if json.Unmarshal([]byte(v), &parsed) == nil {
                if b, ok := parsed.(bool); ok {
                        return b
                }
        }
        return v != "false"
}

// R54-1A: seedDefaultSettings — 启动时为已知 key 灌默认值 (INSERT OR IGNORE).
//   feedbackEnabled 缺失时插入 "true", 让 /admin/settings 页面一开始就有这条记录可点开关.
//   其他 settingMeta 内有 default 的 key 同样灌入 (用户后续可改).
func seedDefaultSettings() {
        for k, meta := range settingMeta {
                if meta.defaultVal == "" {
                        continue
                }
                _, _ = db.Exec(`INSERT OR IGNORE INTO Setting (key, value) VALUES (?, ?)`, k, meta.defaultVal)
        }
}

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

// ---------- 公共反馈提交 API (R54-1A) ----------

// publicFeedbackSubmitHandler — 前台浮窗反馈按钮的 POST 目标.
//
// 路由: POST /api/feedback
// 入参 JSON: {type: bug|suggestion|praise|other, content: string, contact?: string}
// 行为:
//   1. 先查 Setting.feedbackEnabled; 若 false → 403 "反馈模块已关闭" (与前台不渲染按钮一致)
//   2. 校验 type 必为 4 选 1; content 1~2000 字符 (rune 安全截断); contact 0~100
//   3. content 经 HTML 转义后入库 (admin/feedback.html 详情 modal 用 innerHTML 渲染, 防 stored XSS)
//   4. ip / userAgent / referer(url) 一并写入, 供管理员溯源
//   5. status='new', createdAt/updatedAt = now, id = generateID()
func publicFeedbackSubmitHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        // 模块开关 — false 时拒绝写入 (与前台不渲染按钮的行为一致)
        if !getFeedbackEnabled() {
                // R57-1A 反预览挂掉修复: w.WriteHeader(403) 后再调 writeJSON 的 w.Header().Set
                //   是 no-op (Go net/http: WriteHeader 之后 Header 变更被忽略), 响应无 Content-Type
                //   → 前台 fetch().json() 解析失败 toast 报网络错误. 改为先 Set Content-Type
                //   再 WriteHeader 再 Encode (顺序正确).
                w.Header().Set("Content-Type", "application/json; charset=utf-8")
                w.Header().Set("Access-Control-Allow-Origin", "*")
                w.WriteHeader(403)
                json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "反馈模块已关闭"})
                return
        }
        body := readJSONBody(r)
        typ := strings.ToLower(strings.TrimSpace(strField(body, "type", 20)))
        validType := map[string]bool{"bug": true, "suggestion": true, "praise": true, "other": true}
        if !validType[typ] {
                writeJSONErr(w, "type 必须是 bug/suggestion/praise/other 之一", 400)
                return
        }
        content := strField(body, "content", 2000)
        if content == "" {
                writeJSONErr(w, "content 不能为空", 400)
                return
        }
        // HTML 转义: admin 详情 modal 用 innerHTML 渲染 f.content, 必须转义 <>&"' 防 stored XSS
        content = htmlEscaper.Replace(content)
        contact := strField(body, "contact", 100)
        contact = htmlEscaper.Replace(contact)
        urlV := ""
        if u := httpURL(strings.TrimSpace(strField(body, "url", 500))); u != "" {
                urlV = u
        }
        siteID := strings.TrimSpace(strField(body, "siteId", 64))
        ip := clientIP(r)
        ua := strings.TrimSpace(strings.ToLower(r.Header.Get("User-Agent")))
        if len([]rune(ua)) > 256 {
                ua = string([]rune(ua)[:256])
        }
        id := generateID()
        _, err := db.Exec(`INSERT INTO Feedback (id, type, contact, content, url, siteId, userAgent, ip, status, adminNote, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,'',datetime('now'),datetime('now'))`,
                id, typ, contact, content, urlV, siteID, ua, ip, "new")
        if err != nil {
                writeJSONErr(w, "提交失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{"id": id, "submitted": true})
}

// htmlEscaper — 反馈内容入库前转义 (与 html.EscapeString 等价但用 strings.Replacer 更轻量).
//   admin/feedback.html 详情 modal 用 innerHTML 模板字符串拼 f.content, 不转义会触发
//   <img onerror=alert(1)> 等存储型 XSS; 转义后 innerHTML 显示为字面量文本.
var htmlEscaper = strings.NewReplacer(
        `&`, "&amp;",
        `<`, "&lt;",
        `>`, "&gt;",
        `"`, "&quot;",
        `'`, "&#39;",
)

// clientIP — 提取客户端 IP (X-Forwarded-For 优先, 兼容 Caddy/Nginx 反代场景).
//   无 XFF 时取 r.RemoteAddr 去掉端口部分 (用 net.SplitHostPort 正确处理 IPv6).
//
// R68-D BUG-75 (P3): R67-D 未决项 #6. 原实现 strings.LastIndex(host, ":") 剥端口,
//   对 IPv6 "[::1]:12345" 返 "[::1]" (含方括号). 入库 Feedback.ip 含方括号会让后续
//   IP 黑名单 / 频控匹配失配 (e.g. strings.EqualFold("[::1]", "::1") → false).
//   修复: 用 net.SplitHostPort 标准库正确处理 IPv4+IPv6+端口 3 种形态. 入库 + 日志
//   都用净 IP (无方括号). XFF 头不含方括号 (RFC 7239 用纯 IP), 维持原逻辑.
func clientIP(r *http.Request) string {
        if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
                // 取第一个 (最接近客户端的) IP, 去空白
                parts := strings.SplitN(xff, ",", 2)
                ip := strings.TrimSpace(parts[0])
                if ip != "" {
                        return ip
                }
        }
        host, _, err := net.SplitHostPort(r.RemoteAddr)
        if err != nil {
                // r.RemoteAddr 无端口 (e.g. "127.0.0.1" 或 "[::1]" 无 ":port" 后缀), 原样返.
                //   net.SplitHostPort 对无端口串返 err, 此时 r.RemoteAddr 即客户端 IP
                //   (可能含 IPv6 方括号, 但前端 rfc 7239 / XFF 头一般不带方括号, 直接用).
                return r.RemoteAddr
        }
        return host
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
        // R65-D BUG-49 (P1): R64-C 给 adminSitesList/fillSitesPageData/adminSitesCreate/
        //   adminSiteByIDHandler 加了 14 个高级 SEO 字段 (pseudoStaticStyle + 13 高级 SEO):
        //   footerText/footerCopyright/footerIcp/footerStats/navCategoryCount/homeModuleLimit/
        //   chapterPaginationMode/chapterPaginationWords/chapterPaginationPages/chapterSeoAuto/
        //   chapterSeoTitleTemplate/chapterSeoDescTemplate/chapterSeoKeywordsTemplate. 但本
        //   backup SELECT 漏了这 14 字段 → backup/restore cycle 丢失用户站点风格 + SEO 模板配置
        //   (恢复后所有站 pseudoStaticStyle=默认 "query", 高级 SEO 全默认). 修复: SELECT + 输出
        //   map + restore struct + restore INSERT 全补齐 (与 adminSitesList SELECT 字段集对齐).
        sites := []map[string]interface{}{}
        if rows, err := db.Query(`SELECT id, name, domain, themeId, COALESCE(title,''), COALESCE(description,''), COALESCE(keywords,''), COALESCE(icbm,''), COALESCE(geoRegion,''), COALESCE(geoPlacename,''), offset, isDefault, status, inLinkWheel, COALESCE(pseudoStaticStyle,'query'), COALESCE(footerText,''), COALESCE(footerCopyright,''), COALESCE(footerIcp,''), COALESCE(footerStats,1), COALESCE(navCategoryCount,16), COALESCE(homeModuleLimit,20), COALESCE(chapterPaginationMode,'off'), COALESCE(chapterPaginationWords,3000), COALESCE(chapterPaginationPages,3), COALESCE(chapterSeoAuto,1), COALESCE(chapterSeoTitleTemplate,''), COALESCE(chapterSeoDescTemplate,''), COALESCE(chapterSeoKeywordsTemplate,''), createdAt, updatedAt FROM Site LIMIT 500`); err == nil {
                for rows.Next() {
                        var id, name, domain, themeID, title, desc, kw, icbm, geoR, geoP, pseudoStaticStyle, footerText, footerCopyright, footerIcp, chapterPaginationMode, chapterSeoTitleTemplate, chapterSeoDescTemplate, chapterSeoKeywordsTemplate string
                        var offset, navCategoryCount, homeModuleLimit, chapterPaginationWords, chapterPaginationPages int
                        var isDefault, status, inLinkWheel, footerStats, chapterSeoAuto bool
                        var createdAt, updatedAt string
                        _ = rows.Scan(&id, &name, &domain, &themeID, &title, &desc, &kw, &icbm, &geoR, &geoP, &offset, &isDefault, &status, &inLinkWheel, &pseudoStaticStyle, &footerText, &footerCopyright, &footerIcp, &footerStats, &navCategoryCount, &homeModuleLimit, &chapterPaginationMode, &chapterPaginationWords, &chapterPaginationPages, &chapterSeoAuto, &chapterSeoTitleTemplate, &chapterSeoDescTemplate, &chapterSeoKeywordsTemplate, &createdAt, &updatedAt)
                        if pseudoStaticStyle == "" {
                                pseudoStaticStyle = "query"
                        }
                        if chapterPaginationMode == "" {
                                chapterPaginationMode = "off"
                        }
                        sites = append(sites, map[string]interface{}{
                                "id": id, "name": name, "domain": domain, "themeId": themeID,
                                "title": title, "description": desc, "keywords": kw,
                                "icbm": icbm, "geoRegion": geoR, "geoPlacename": geoP, "offset": offset,
                                "isDefault": isDefault, "status": status, "inLinkWheel": inLinkWheel,
                                "pseudoStaticStyle": pseudoStaticStyle,
                                "footerText": footerText, "footerCopyright": footerCopyright, "footerIcp": footerIcp,
                                "footerStats": footerStats, "navCategoryCount": navCategoryCount,
                                "homeModuleLimit": homeModuleLimit, "chapterPaginationMode": chapterPaginationMode,
                                "chapterPaginationWords": chapterPaginationWords, "chapterPaginationPages": chapterPaginationPages,
                                "chapterSeoAuto": chapterSeoAuto, "chapterSeoTitleTemplate": chapterSeoTitleTemplate,
                                "chapterSeoDescTemplate": chapterSeoDescTemplate, "chapterSeoKeywordsTemplate": chapterSeoKeywordsTemplate,
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
        // R64-C BUG-42 (P0): 原实现外层 rows 持锁期间 for rows.Next() 内部逐 book 调
        //   db.Query(crows) + db.Query(trows) → modernc.org/sqlite 连接池
        //   (SetMaxOpenConns(1)) 等待外层 rows 释放 → 30s+ 超时死锁 (Book 表非空
        //   且 !bigBooks 时必现, 用户备份全量数据 export 路径). 修复: 先收齐
        //   book 行转 []struct + 显式 Close rows, 再循环逐 book 调 db.Query(crows)/
        //   db.Query(trows) — 与 R63 主控修 adminSitesBatchGenerateTDK 同款方法论.
        if rows, err := db.Query(bookQuery); err == nil {
                type bookRow struct {
                        id, name, author, catID, intro, cover, status, kw, latest string
                        wc                                                       int
                        srcURL, srcRule, storageMode, collectedAt, createdAt, updatedAt string
                }
                bookRows := []bookRow{}
                for rows.Next() {
                        var b bookRow
                        _ = rows.Scan(&b.id, &b.name, &b.author, &b.catID, &b.intro, &b.cover, &b.status, &b.kw, &b.latest, &b.wc, &b.srcURL, &b.srcRule, &b.storageMode, &b.collectedAt, &b.createdAt, &b.updatedAt)
                        bookRows = append(bookRows, b)
                }
                rows.Close()
                for _, b := range bookRows {
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
        case path == "clear": // R55-1A: 清空采集产物 (危险操作)
                adminBackupClearHandler(w, r)
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
                                PseudoStaticStyle, FooterText, FooterCopyright, FooterIcp, ChapterPaginationMode, ChapterSeoTitleTemplate, ChapterSeoDescTemplate, ChapterSeoKeywordsTemplate string
                                Offset, NavCategoryCount, HomeModuleLimit, ChapterPaginationWords, ChapterPaginationPages int
                                IsDefault, Status, InLinkWheel, FooterStats, ChapterSeoAuto bool
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
                // R65-D BUG-49 (P1): 补齐 14 高级 SEO 字段 (pseudoStaticStyle + 13 高级 SEO) 的 INSERT + UPDATE SET,
                //   与 backup SELECT 字段集对齐 (详见 adminBackupHandler SELECT 注释).
                pseudoStyle := s.PseudoStaticStyle
                if pseudoStyle == "" {
                        pseudoStyle = "query"
                }
                chapterPaginationMode := s.ChapterPaginationMode
                if chapterPaginationMode == "" {
                        chapterPaginationMode = "off"
                }
                if _, err := tx.Exec(`INSERT INTO Site (id, name, domain, themeId, title, description, keywords, icbm, geoRegion, geoPlacename, offset, isDefault, status, inLinkWheel, pseudoStaticStyle, footerText, footerCopyright, footerIcp, footerStats, navCategoryCount, homeModuleLimit, chapterPaginationMode, chapterPaginationWords, chapterPaginationPages, chapterSeoAuto, chapterSeoTitleTemplate, chapterSeoDescTemplate, chapterSeoKeywordsTemplate, createdAt, updatedAt)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(id) DO UPDATE SET name=excluded.name, domain=excluded.domain, themeId=excluded.themeId, title=excluded.title, description=excluded.description, keywords=excluded.keywords, icbm=excluded.icbm, geoRegion=excluded.geoRegion, geoPlacename=excluded.geoPlacename, offset=excluded.offset, isDefault=excluded.isDefault, status=excluded.status, inLinkWheel=excluded.inLinkWheel, pseudoStaticStyle=excluded.pseudoStaticStyle, footerText=excluded.footerText, footerCopyright=excluded.footerCopyright, footerIcp=excluded.footerIcp, footerStats=excluded.footerStats, navCategoryCount=excluded.navCategoryCount, homeModuleLimit=excluded.homeModuleLimit, chapterPaginationMode=excluded.chapterPaginationMode, chapterPaginationWords=excluded.chapterPaginationWords, chapterPaginationPages=excluded.chapterPaginationPages, chapterSeoAuto=excluded.chapterSeoAuto, chapterSeoTitleTemplate=excluded.chapterSeoTitleTemplate, chapterSeoDescTemplate=excluded.chapterSeoDescTemplate, chapterSeoKeywordsTemplate=excluded.chapterSeoKeywordsTemplate`,
                        s.ID, s.Name, s.Domain, s.ThemeID, s.Title, s.Description, s.Keywords, s.Icbm, s.GeoRegion, s.GeoPlacename, s.Offset, s.IsDefault, s.Status, s.InLinkWheel, pseudoStyle, s.FooterText, s.FooterCopyright, s.FooterIcp, s.FooterStats, s.NavCategoryCount, s.HomeModuleLimit, chapterPaginationMode, s.ChapterPaginationWords, s.ChapterPaginationPages, s.ChapterSeoAuto, s.ChapterSeoTitleTemplate, s.ChapterSeoDescTemplate, s.ChapterSeoKeywordsTemplate, nullIfEmpty(s.CreatedAt), nullIfEmpty(s.UpdatedAt)); err != nil {
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
// auditSite: 对单个站点跑 SEO 审计 (TDK / sitemap / 伪静态 / ICBM / 链轮).
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

// ---------- 站点管理 API (R55-1A 新增) ----------

// adminSitesHandler — GET 列站点 / POST 新建站点.
//   GET  /api/admin/sites         → 列站点 (含 isDefault + status + themeId)
//   POST /api/admin/sites         → 新建站点 (name/domain/themeId/...)
//   POST /api/admin/sites  body={action:"generate-tdk"}  → R63-A 批量智能 TDK 生成.
func adminSitesHandler(w http.ResponseWriter, r *http.Request) {
        switch r.Method {
        case http.MethodGet:
                adminSitesList(w, r)
        case http.MethodPost:
                body := readJSONBody(r)
                // R63-A: POST body {action:"generate-tdk"} → 批量智能 TDK 生成 (不创建站点).
                if action, _ := body["action"].(string); action == "generate-tdk" {
                        adminSitesBatchGenerateTDK(w, r, body)
                        return
                }
                adminSitesCreate(w, r, body)
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// adminSiteByIDHandler — PUT/DELETE /api/admin/sites/:id (R55-1A 新增).
//
//   PUT    /api/admin/sites/:id  → 按字段增量更新 (name/domain/themeId/title/description/keywords/icbm/geoRegion/geoPlacename/offset/status/inLinkWheel/isDefault/pseudoStaticStyle)
//   POST   /api/admin/sites/:id/generate-tdk  → R63-A 单站智能 TDK 生成 + 写回 DB.
//   DELETE /api/admin/sites/:id  → 删除站点 (禁止删除 isDefault 站点)
func adminSiteByIDHandler(w http.ResponseWriter, r *http.Request) {
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/sites/"), "/")
        if len(parts) < 1 || parts[0] == "" {
                writeJSONErr(w, "缺少站点 id", 400)
                return
        }
        id := parts[0]
        // R63-A: /:id/generate-tdk 子路径 → 单站智能 TDK 生成.
        if len(parts) >= 2 && parts[1] == "generate-tdk" {
                adminSiteGenerateTDK(w, r, id)
                return
        }
        switch r.Method {
        case http.MethodPut:
                body := readJSONBody(r)
                var exist string
                _ = db.QueryRow(`SELECT id FROM Site WHERE id=?`, id).Scan(&exist)
                if exist == "" {
                        writeJSONErr(w, "站点不存在", 404)
                        return
                }
                // R64-C BUG-44 (P1): 原实现 isDefault clear (UPDATE Site SET isDefault=0)
                //   在字段校验中途执行, 若后续校验失败 (如 pseudoStaticStyle 非法) 或主
                //   UPDATE 失败, 已 clear 的 isDefault 不回滚 → 无默认站点. 修复: 整个
                //   PUT 包裹事务, 任一步失败 Rollback 还原 isDefault.
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
                sets := []string{}
                args := []interface{}{}
                if v, ok := body["name"]; ok && v != nil {
                        s := strField(body, "name", 100)
                        if s == "" {
                                writeJSONErr(w, "站点名不能为空", 400)
                                return
                        }
                        sets = append(sets, "name=?")
                        args = append(args, s)
                }
                if v, ok := body["domain"]; ok && v != nil {
                        d := strings.ToLower(strings.TrimSpace(strField(body, "domain", 200)))
                        if d == "" {
                                writeJSONErr(w, "domain 不能为空", 400)
                                return
                        }
                        // 校验唯一 (排除自身)
                        var otherID string
                        _ = db.QueryRow(`SELECT id FROM Site WHERE domain=? AND id!=?`, d, id).Scan(&otherID)
                        if otherID != "" {
                                writeJSONErr(w, "domain 已被其他站点使用", 400)
                                return
                        }
                        sets = append(sets, "domain=?")
                        args = append(args, d)
                }
                if v, ok := body["themeId"]; ok && v != nil {
                        t := strField(body, "themeId", 64)
                        // 校验主题在已注册表 (adminThemes) 中
                        if t != "" {
                                valid := false
                                for _, th := range adminThemes {
                                        if th.ID == t {
                                                valid = true
                                                break
                                        }
                                }
                                if !valid {
                                        writeJSONErr(w, "themeId 不在已注册主题列表", 400)
                                        return
                                }
                        }
                        sets = append(sets, "themeId=?")
                        args = append(args, t)
                }
                if v, ok := body["title"]; ok && v != nil {
                        sets = append(sets, "title=?")
                        args = append(args, strField(body, "title", 200))
                }
                if v, ok := body["description"]; ok && v != nil {
                        sets = append(sets, "description=?")
                        args = append(args, strField(body, "description", 500))
                }
                if v, ok := body["keywords"]; ok && v != nil {
                        sets = append(sets, "keywords=?")
                        args = append(args, strField(body, "keywords", 500))
                }
                if v, ok := body["icbm"]; ok && v != nil {
                        icbm := strField(body, "icbm", 100)
                        if icbm != "" && !validIcbm(icbm) {
                                writeJSONErr(w, "icbm 格式非法 (期望 lat,lng)", 400)
                                return
                        }
                        sets = append(sets, "icbm=?")
                        args = append(args, icbm)
                }
                if v, ok := body["geoRegion"]; ok && v != nil {
                        sets = append(sets, "geoRegion=?")
                        args = append(args, strField(body, "geoRegion", 20))
                }
                if v, ok := body["geoPlacename"]; ok && v != nil {
                        sets = append(sets, "geoPlacename=?")
                        args = append(args, strField(body, "geoPlacename", 100))
                }
                if v, ok := body["offset"]; ok && v != nil {
                        sets = append(sets, "offset=?")
                        args = append(args, clampIntAdm(intField(body, "offset", 0, 0, 1000000), 0, 1000000))
                }
                if v, ok := body["status"]; ok && v != nil {
                        sets = append(sets, "status=?")
                        args = append(args, boolField(body, "status", true))
                }
                if v, ok := body["inLinkWheel"]; ok && v != nil {
                        sets = append(sets, "inLinkWheel=?")
                        args = append(args, boolField(body, "inLinkWheel", true))
                }
                isDefaultRequested := false
                if v, ok := body["isDefault"]; ok && v != nil {
                        isDefaultRequested = boolField(body, "isDefault", false)
                        sets = append(sets, "isDefault=?")
                        args = append(args, isDefaultRequested)
                }
                // R63-A: pseudoStaticStyle 枚举校验 (query/numeric/alphanumeric/slug/short/classic/dir/hashid/base62/segmented).
                if v, ok := body["pseudoStaticStyle"]; ok && v != nil {
                        s := strField(body, "pseudoStaticStyle", 20)
                        if s == "" {
                                s = "query"
                        }
                        if !validPseudoStaticStyle(s) {
                                writeJSONErr(w, "pseudoStaticStyle 不在枚举内 (query/numeric/alphanumeric/slug/short/classic/dir/hashid/base62/segmented)", 400)
                                return
                        }
                        sets = append(sets, "pseudoStaticStyle=?")
                        args = append(args, s)
                }
                // R64-C 高级 SEO 字段 (R16/R22): 增量更新 11 概念字段 = 13 DB 列.
                //   与 adminSitesCreate 同款校验: 枚举 + clampIntAdm 范围 + strField/boolField 取值.
                if v, ok := body["footerText"]; ok && v != nil {
                        sets = append(sets, "footerText=?")
                        args = append(args, strField(body, "footerText", 2000))
                }
                if v, ok := body["footerCopyright"]; ok && v != nil {
                        sets = append(sets, "footerCopyright=?")
                        args = append(args, strField(body, "footerCopyright", 500))
                }
                if v, ok := body["footerIcp"]; ok && v != nil {
                        sets = append(sets, "footerIcp=?")
                        args = append(args, strField(body, "footerIcp", 200))
                }
                if v, ok := body["footerStats"]; ok && v != nil {
                        sets = append(sets, "footerStats=?")
                        args = append(args, boolField(body, "footerStats", true))
                }
                if v, ok := body["navCategoryCount"]; ok && v != nil {
                        sets = append(sets, "navCategoryCount=?")
                        args = append(args, clampIntAdm(intField(body, "navCategoryCount", 16, 5, 30), 5, 30))
                }
                if v, ok := body["homeModuleLimit"]; ok && v != nil {
                        sets = append(sets, "homeModuleLimit=?")
                        args = append(args, clampIntAdm(intField(body, "homeModuleLimit", 20, 10, 50), 10, 50))
                }
                if v, ok := body["chapterPaginationMode"]; ok && v != nil {
                        m := strField(body, "chapterPaginationMode", 20)
                        if m == "" {
                                m = "off"
                        }
                        if m != "off" && m != "byWords" && m != "byPages" {
                                writeJSONErr(w, "chapterPaginationMode 必须是 off/byWords/byPages 之一", 400)
                                return
                        }
                        sets = append(sets, "chapterPaginationMode=?")
                        args = append(args, m)
                }
                if v, ok := body["chapterPaginationWords"]; ok && v != nil {
                        sets = append(sets, "chapterPaginationWords=?")
                        args = append(args, clampIntAdm(intField(body, "chapterPaginationWords", 3000, 500, 50000), 500, 50000))
                }
                if v, ok := body["chapterPaginationPages"]; ok && v != nil {
                        sets = append(sets, "chapterPaginationPages=?")
                        args = append(args, clampIntAdm(intField(body, "chapterPaginationPages", 3, 2, 20), 2, 20))
                }
                if v, ok := body["chapterSeoAuto"]; ok && v != nil {
                        sets = append(sets, "chapterSeoAuto=?")
                        args = append(args, boolField(body, "chapterSeoAuto", true))
                }
                if v, ok := body["chapterSeoTitleTemplate"]; ok && v != nil {
                        sets = append(sets, "chapterSeoTitleTemplate=?")
                        args = append(args, strField(body, "chapterSeoTitleTemplate", 500))
                }
                if v, ok := body["chapterSeoDescTemplate"]; ok && v != nil {
                        sets = append(sets, "chapterSeoDescTemplate=?")
                        args = append(args, strField(body, "chapterSeoDescTemplate", 1000))
                }
                if v, ok := body["chapterSeoKeywordsTemplate"]; ok && v != nil {
                        sets = append(sets, "chapterSeoKeywordsTemplate=?")
                        args = append(args, strField(body, "chapterSeoKeywordsTemplate", 500))
                }
                if len(sets) == 0 {
                        writeJSONErr(w, "无可更新字段", 400)
                        return
                }
                sets = append(sets, "updatedAt=datetime('now')")
                args = append(args, id)
                if _, err := tx.Exec(`UPDATE Site SET `+strings.Join(sets, ",")+` WHERE id=?`, args...); err != nil {
                        writeJSONErr(w, "更新失败: "+err.Error(), 500)
                        return
                }
                // 设为默认: 主 UPDATE 已成功把当前 site 的 isDefault=true (在事务内),
                //   此 clear 把其他 site 的 isDefault 置 0 (WHERE id!=? 不动当前 site,
                //   比原 `UPDATE Site SET isDefault=0` 全清更精准). 若此步失败, Rollback
                //   还原所有变更 (含主 UPDATE 设置的 isDefault=true), 保证不出现"无默认
                //   站点"的脏状态.
                if isDefaultRequested {
                        if _, err := tx.Exec(`UPDATE Site SET isDefault=0 WHERE id!=?`, id); err != nil {
                                writeJSONErr(w, "清退旧默认站点失败: "+err.Error(), 500)
                                return
                        }
                }
                if err := tx.Commit(); err != nil {
                        writeJSONErr(w, "提交事务失败: "+err.Error(), 500)
                        return
                }
                committed = true
                writeJSONOK(w, map[string]interface{}{"id": id, "updated": true})
        case http.MethodDelete:
                var exist, isDefault string
                _ = db.QueryRow(`SELECT id, CASE WHEN isDefault THEN '1' ELSE '0' END FROM Site WHERE id=?`, id).Scan(&exist, &isDefault)
                if exist == "" {
                        writeJSONErr(w, "站点不存在", 404)
                        return
                }
                if isDefault == "1" {
                        writeJSONErr(w, "禁止删除默认站点, 请先转移默认到其他站点", 400)
                        return
                }
                _, err := db.Exec(`DELETE FROM Site WHERE id=?`, id)
                if err != nil {
                        writeJSONErr(w, "删除失败: "+err.Error(), 500)
                        return
                }
                writeJSONOK(w, map[string]interface{}{"id": id, "deleted": true})
        default:
                writeJSONErr(w, "method not allowed", 405)
        }
}

// adminSitesList — GET /api/admin/sites 列站点 (含 isDefault/themeId/offset/status 等, 与 backup 同字段集).
//   R63-A: SELECT 加 pseudoStaticStyle 字段返回 (供前端编辑表单显示当前值).
//   R64-C: SELECT 加 13 高级 SEO 字段 (footerText/footerCopyright/footerIcp/footerStats/
//     navCategoryCount/homeModuleLimit/chapterPaginationMode/chapterPaginationWords/
//     chapterPaginationPages/chapterSeoAuto/chapterSeoTitleTemplate/chapterSeoDescTemplate/
//     chapterSeoKeywordsTemplate).
func adminSitesList(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query(`SELECT id,name,domain,themeId,isDefault,title,description,keywords,icbm,geoRegion,geoPlacename,offset,status,inLinkWheel,pseudoStaticStyle,footerText,footerCopyright,footerIcp,footerStats,navCategoryCount,homeModuleLimit,chapterPaginationMode,chapterPaginationWords,chapterPaginationPages,chapterSeoAuto,chapterSeoTitleTemplate,chapterSeoDescTemplate,chapterSeoKeywordsTemplate,createdAt,updatedAt FROM Site ORDER BY isDefault DESC, name ASC LIMIT 500`)
        if err != nil {
                writeJSONErr(w, "查询失败: "+err.Error(), 500)
                return
        }
        defer rows.Close()
        out := []map[string]interface{}{}
        for rows.Next() {
                var id, name, domain, themeID, title, desc, kw, icbm, geoR, geoP, pseudoStaticStyle string
                var footerText, footerCopyright, footerIcp, chapterPaginationMode, chapterSeoTitleTemplate, chapterSeoDescTemplate, chapterSeoKeywordsTemplate string
                var createdAt, updatedAt string
                var offset, navCategoryCount, homeModuleLimit, chapterPaginationWords, chapterPaginationPages int
                var isDefault, status, inLinkWheel, footerStats, chapterSeoAuto bool
                _ = rows.Scan(&id, &name, &domain, &themeID, &isDefault, &title, &desc, &kw, &icbm, &geoR, &geoP, &offset, &status, &inLinkWheel, &pseudoStaticStyle,
                        &footerText, &footerCopyright, &footerIcp, &footerStats, &navCategoryCount, &homeModuleLimit,
                        &chapterPaginationMode, &chapterPaginationWords, &chapterPaginationPages,
                        &chapterSeoAuto, &chapterSeoTitleTemplate, &chapterSeoDescTemplate, &chapterSeoKeywordsTemplate,
                        &createdAt, &updatedAt)
                if pseudoStaticStyle == "" {
                        pseudoStaticStyle = "query"
                }
                if chapterPaginationMode == "" {
                        chapterPaginationMode = "off"
                }
                out = append(out, map[string]interface{}{
                        "id": id, "name": name, "domain": domain, "themeId": themeID,
                        "isDefault": isDefault, "title": title, "description": desc, "keywords": kw,
                        "icbm": icbm, "geoRegion": geoR, "geoPlacename": geoP, "offset": offset,
                        "status": status, "inLinkWheel": inLinkWheel, "pseudoStaticStyle": pseudoStaticStyle,
                        "footerText": footerText, "footerCopyright": footerCopyright, "footerIcp": footerIcp,
                        "footerStats": footerStats, "navCategoryCount": navCategoryCount,
                        "homeModuleLimit": homeModuleLimit, "chapterPaginationMode": chapterPaginationMode,
                        "chapterPaginationWords": chapterPaginationWords, "chapterPaginationPages": chapterPaginationPages,
                        "chapterSeoAuto": chapterSeoAuto, "chapterSeoTitleTemplate": chapterSeoTitleTemplate,
                        "chapterSeoDescTemplate": chapterSeoDescTemplate, "chapterSeoKeywordsTemplate": chapterSeoKeywordsTemplate,
                        "createdAt": createdAt, "updatedAt": updatedAt,
                })
        }
        writeJSONOK(w, out)
}

// adminSitesCreate — POST /api/admin/sites 新建站点 (R55-1A: 后台全页面编辑功能补全).
//
//   入参: name (必填 1-100) / domain (必填唯一) / themeId (校验在 adminThemes 内) /
//         title/description/keywords/icbm/geoRegion/geoPlacename/offset/status/inLinkWheel/isDefault
//         pseudoStaticStyle (R63-A: 枚举 query/numeric/alphanumeric/slug/short/classic/dir/hashid/base62/segmented, 默认 query)
//   isDefault=true 时先清掉其他站点 isDefault 再插入.
//   R63-A: adminSitesHandler 已读 body 并转发; 本函数接收 body 参数避免重复 read.
func adminSitesCreate(w http.ResponseWriter, r *http.Request, body map[string]interface{}) {
        if body == nil {
                body = readJSONBody(r)
        }
        name := strField(body, "name", 100)
        if name == "" {
                writeJSONErr(w, "站点名必填(1~100字)", 400)
                return
        }
        domain := strings.ToLower(strings.TrimSpace(strField(body, "domain", 200)))
        if domain == "" {
                writeJSONErr(w, "domain 必填", 400)
                return
        }
        var existDomain string
        _ = db.QueryRow(`SELECT id FROM Site WHERE domain=?`, domain).Scan(&existDomain)
        if existDomain != "" {
                writeJSONErr(w, "domain 已存在", 400)
                return
        }
        themeID := strField(body, "themeId", 64)
        if themeID == "" {
                // R55-1B 修复 BUG-3 (P2): 原默认 "aurora" 不在 adminThemes 列表 (实际主题
                //   ID 形如 "clone-shipsay"), 用户不传 themeId 时校验失败返 400. 改用
                //   "clone-shipsay" (homeHandler 默认主题 + 兜底模板路径).
                themeID = "clone-shipsay"
        }
        valid := false
        for _, th := range adminThemes {
                if th.ID == themeID {
                        valid = true
                        break
                }
        }
        if !valid {
                writeJSONErr(w, "themeId 不在已注册主题列表", 400)
                return
        }
        title := strField(body, "title", 200)
        desc := strField(body, "description", 500)
        kw := strField(body, "keywords", 500)
        icbm := strField(body, "icbm", 100)
        if icbm == "" {
                icbm = "35.86166,104.195397"
        }
        if !validIcbm(icbm) {
                writeJSONErr(w, "icbm 格式非法 (期望 lat,lng)", 400)
                return
        }
        geoR := strField(body, "geoRegion", 20)
        if geoR == "" {
                geoR = "CN"
        }
        geoP := strField(body, "geoPlacename", 100)
        if geoP == "" {
                geoP = "中国"
        }
        offset := clampIntAdm(intField(body, "offset", 0, 0, 1000000), 0, 1000000)
        status := boolField(body, "status", true)
        inLinkWheel := boolField(body, "inLinkWheel", true)
        isDefault := boolField(body, "isDefault", false)
        // R63-A: pseudoStaticStyle 枚举校验 (query/numeric/alphanumeric/slug/short/classic/dir/hashid/base62/segmented).
        pseudoStaticStyle := strField(body, "pseudoStaticStyle", 20)
        if pseudoStaticStyle == "" {
                pseudoStaticStyle = "query"
        }
        if !validPseudoStaticStyle(pseudoStaticStyle) {
                writeJSONErr(w, "pseudoStaticStyle 不在枚举内 (query/numeric/alphanumeric/slug/short/classic/dir/hashid/base62/segmented)", 400)
                return
        }
        // R64-C 高级 SEO 字段 (R16/R22): footerText / footerCopyright / footerIcp /
        //   footerStats / navCategoryCount / homeModuleLimit / chapterPaginationMode /
        //   chapterPaginationWords / chapterPaginationPages / chapterSeoAuto /
        //   chapterSeoTitleTemplate / chapterSeoDescTemplate / chapterSeoKeywordsTemplate.
        //   11 概念字段 = 13 DB 列 (3 个 chapter SEO 模板分开). 与 R63-A pseudoStaticStyle
        //   同款 strField/intField/boolField 取值 + clampIntAdm 钳制范围 + 枚举校验.
        footerText := strField(body, "footerText", 2000)
        footerCopyright := strField(body, "footerCopyright", 500)
        footerIcp := strField(body, "footerIcp", 200)
        footerStats := boolField(body, "footerStats", true)
        navCategoryCount := clampIntAdm(intField(body, "navCategoryCount", 16, 5, 30), 5, 30)
        homeModuleLimit := clampIntAdm(intField(body, "homeModuleLimit", 20, 10, 50), 10, 50)
        chapterPaginationMode := strField(body, "chapterPaginationMode", 20)
        if chapterPaginationMode == "" {
                chapterPaginationMode = "off"
        }
        if chapterPaginationMode != "off" && chapterPaginationMode != "byWords" && chapterPaginationMode != "byPages" {
                writeJSONErr(w, "chapterPaginationMode 必须是 off/byWords/byPages 之一", 400)
                return
        }
        chapterPaginationWords := clampIntAdm(intField(body, "chapterPaginationWords", 3000, 500, 50000), 500, 50000)
        chapterPaginationPages := clampIntAdm(intField(body, "chapterPaginationPages", 3, 2, 20), 2, 20)
        chapterSeoAuto := boolField(body, "chapterSeoAuto", true)
        chapterSeoTitleTemplate := strField(body, "chapterSeoTitleTemplate", 500)
        chapterSeoDescTemplate := strField(body, "chapterSeoDescTemplate", 1000)
        chapterSeoKeywordsTemplate := strField(body, "chapterSeoKeywordsTemplate", 500)
        id := generateID()
        // R64-C BUG-43 (P1): 原实现 isDefault clear (UPDATE Site SET isDefault=0)
        //   在 INSERT 前执行, 若 INSERT 失败 (如 SQL 错误 / domain 冲突等), 已 clear
        //   的 isDefault 不回滚 → 无默认站点. 修复: 整个 INSERT + isDefault clear
        //   包裹事务, 任一步失败 Rollback 还原. 顺序: INSERT 新站 → 若 isDefault,
        //   clear 其他 (WHERE id!=? 不动新站). 与 adminSiteByIDHandler PUT BUG-38
        //   同款事务方法论.
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
        // R55-1B 修复 BUG-4 (P0): 原实现 VALUES 子句多 1 个 `?` 占位符 (15 个 `?` + 2 个
        //   datetime 字面量 = 17 values vs 16 columns → SQLite 报 "17 values for 16 columns"
        //   全部 Site 新建失败). args = 14 个 (id/name/domain/themeId/title/desc/kw/icbm/
        //   geoR/geoP/offset/isDefault/status/inLinkWheel), VALUES 应有 14 个 `?` + 2 个
        //   datetime('now') 字面量 (createdAt/updatedAt) = 16 values for 16 columns.
        // R63-A: 加 pseudoStaticStyle 列 → 15 个 `?` + 2 个 datetime 字面量 = 17 values for 17 columns.
        // R64-C: 加 13 个高级 SEO 字段 → 28 个 `?` + 2 个 datetime 字面量 = 30 values for 30 columns.
        if _, err := tx.Exec(
                `INSERT INTO Site (id,name,domain,themeId,title,description,keywords,icbm,geoRegion,geoPlacename,offset,isDefault,status,inLinkWheel,pseudoStaticStyle,footerText,footerCopyright,footerIcp,footerStats,navCategoryCount,homeModuleLimit,chapterPaginationMode,chapterPaginationWords,chapterPaginationPages,chapterSeoAuto,chapterSeoTitleTemplate,chapterSeoDescTemplate,chapterSeoKeywordsTemplate,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
                id, name, domain, themeID, title, desc, kw, icbm, geoR, geoP, offset, isDefault, status, inLinkWheel, pseudoStaticStyle,
                footerText, footerCopyright, footerIcp, footerStats, navCategoryCount, homeModuleLimit,
                chapterPaginationMode, chapterPaginationWords, chapterPaginationPages,
                chapterSeoAuto, chapterSeoTitleTemplate, chapterSeoDescTemplate, chapterSeoKeywordsTemplate,
        ); err != nil {
                writeJSONErr(w, "创建失败: "+err.Error(), 500)
                return
        }
        if isDefault {
                if _, err := tx.Exec(`UPDATE Site SET isDefault=0 WHERE id!=?`, id); err != nil {
                        writeJSONErr(w, "清退旧默认站点失败: "+err.Error(), 500)
                        return
                }
        }
        if err := tx.Commit(); err != nil {
                writeJSONErr(w, "提交事务失败: "+err.Error(), 500)
                return
        }
        committed = true
        writeJSONOK(w, map[string]interface{}{
                "id": id, "name": name, "domain": domain, "themeId": themeID,
                "isDefault": isDefault, "status": status, "inLinkWheel": inLinkWheel,
                "offset": offset, "pseudoStaticStyle": pseudoStaticStyle,
                "footerText": footerText, "footerCopyright": footerCopyright, "footerIcp": footerIcp,
                "footerStats": footerStats, "navCategoryCount": navCategoryCount,
                "homeModuleLimit": homeModuleLimit, "chapterPaginationMode": chapterPaginationMode,
                "chapterPaginationWords": chapterPaginationWords, "chapterPaginationPages": chapterPaginationPages,
                "chapterSeoAuto": chapterSeoAuto, "chapterSeoTitleTemplate": chapterSeoTitleTemplate,
                "chapterSeoDescTemplate": chapterSeoDescTemplate, "chapterSeoKeywordsTemplate": chapterSeoKeywordsTemplate,
        })
}

// ---------- 站群智能 TDK 生成 API (R63-A 新增) ----------

// generateSiteTDK — 智能生成站点 TDK (title/description/keywords) (R63-A).
//
// 数据源 (按优先级查 DB):
//   1. site.Name (站点名, 主标识)
//   2. site.Domain (备用, site.Name 为空时用)
//   3. 站点分类前 3 个 (按 sortOrder ASC)
//   4. 站点书库 top 热门书 3 本 (按 wordCount DESC)
//   5. N = COUNT(*) FROM Book (站点书库总数, 全局; 站群共享书库时同 N)
//   6. M = COUNT(*) FROM Category (站点分类总数)
//
// 模板池 (每站按 simpleHash(siteID) % len(pool) 选模板, 同站稳定):
//   title 池 6 个 / description 池 4 个 / keywords 池 3 个.
//
// 字段截断: title ≤80 / description ≤200 / keywords ≤200 rune (按 rune 截防中文斩半).
//
// 空数据兜底: N=0 (站点无书) → 用通用模板, 不取 cat/book 占位符.
func generateSiteTDK(siteID string) (title, description, keywords string, err error) {
        // 1. site.Name + domain
        var siteName, domain string
        err = db.QueryRow(`SELECT COALESCE(name,''), COALESCE(domain,'') FROM Site WHERE id=?`, siteID).Scan(&siteName, &domain)
        if err != nil {
                return "", "", "", err
        }
        if siteName == "" {
                siteName = domain
        }
        if siteName == "" {
                siteName = "小说站"
        }

        // 2. top 3 categories (按 sortOrder ASC, 与 fillCategoriesPageData 同款排序)
        catRows, qerr1 := db.Query(`SELECT name FROM Category ORDER BY sortOrder ASC LIMIT 3`)
        cats := []string{}
        if qerr1 == nil {
                for catRows.Next() {
                        var n string
                        _ = catRows.Scan(&n)
                        if n != "" {
                                cats = append(cats, n)
                        }
                }
                catRows.Close()
        }

        // 3. top 3 books (按 wordCount DESC, 取最热门的 3 本)
        bookRows, qerr2 := db.Query(`SELECT name FROM Book ORDER BY wordCount DESC LIMIT 3`)
        books := []string{}
        if qerr2 == nil {
                for bookRows.Next() {
                        var n string
                        _ = bookRows.Scan(&n)
                        if n != "" {
                                books = append(books, n)
                        }
                }
                bookRows.Close()
        }

        // 4. N + M (全局; 站群共享书库时同值, 各站因 siteID hash 不同选不同模板, 仍差异化)
        var N, M int
        _ = db.QueryRow(`SELECT COUNT(*) FROM Book`).Scan(&N)
        _ = db.QueryRow(`SELECT COUNT(*) FROM Category`).Scan(&M)

        // 5. 占位符兜底值 (cat/book 缺失时用通用词, 不空字段)
        cat1, cat2, cat3 := "小说", "小说", "小说"
        if len(cats) > 0 {
                cat1 = cats[0]
        }
        if len(cats) > 1 {
                cat2 = cats[1]
        }
        if len(cats) > 2 {
                cat3 = cats[2]
        }
        book1, book2, book3 := "精品小说", "热门小说", "完结小说"
        if len(books) > 0 {
                book1 = books[0]
        }
        if len(books) > 1 {
                book2 = books[1]
        }
        if len(books) > 2 {
                book3 = books[2]
        }

        // 6. 空数据兜底 (N=0): 用通用模板, 不取 cat/book 占位符.
        if N == 0 {
                title = siteName + " - 免费小说在线阅读"
                description = siteName + "小说大全, 免费/无弹窗/更新快, 每日更新, 全文阅读"
                keywords = siteName + ",小说,免费阅读,在线阅读,无弹窗,全文阅读"
                return truncateRune(title, 80), truncateRune(description, 200), truncateRune(keywords, 200), nil
        }

        // 7. 模板池 (占位符: {siteName} {cat1} {cat2} {cat3} {book1} {book2} {book3} {N} {M} {X})
        //   {X} = 每日更新 N 章 (用 M 兜底, M=0 时用 "多")
        X := strconv.Itoa(M)
        if X == "0" {
                X = "多"
        }
        nStr := strconv.Itoa(N)
        mStr := strconv.Itoa(M)
        titlePool := []string{
                siteName + " - 免费小说在线阅读",
                siteName + " | " + cat1 + cat2 + "小说大全",
                siteName + " — " + book1 + "全文阅读 - 最新章节免费看",
                siteName + ": " + book2 + "+" + nStr + "本" + cat3 + "小说在线阅读",
                siteName + "小说阅读网 - " + book3 + "/" + book2 + "/" + book1 + "无弹窗全文",
                siteName + " | " + nStr + "本精品小说随你看 - 免费/无弹窗/更新快",
        }
        descPool := []string{
                siteName + "提供" + cat1 + "、" + cat2 + "、" + cat3 + "等" + mStr + "个分类的" + nStr + "本小说免费在线阅读, 包含" + book1 + "、" + book2 + "、" + book3 + "等热门作品, 每日更新, 无弹窗, 支持手机端。",
                siteName + "是" + cat1 + "小说阅读网, 提供" + book1 + "全文阅读, 收录" + nStr + "本" + cat2 + "小说, 完结/连载齐全, 一键追更, 手机端体验优秀。",
                siteName + "小说大全收录" + nStr + "本" + cat1 + "/" + cat2 + "/" + cat3 + "类型小说, " + book1 + "、" + book2 + "连载追更, " + book3 + "已完结, 全文免费阅读, 无弹窗广告。",
                "欢迎来到" + siteName + "! 我们精选" + nStr + "本" + cat1 + "、" + cat2 + "精品小说, " + book1 + "、" + book2 + "、" + book3 + "等你来看, 每日更新" + X + "章, 极速追更体验。",
        }
        kwPool := []string{
                siteName + "," + siteName + "小说," + cat1 + "小说," + cat2 + "小说," + book1 + "," + book2 + "," + book3 + ",免费阅读,在线阅读,无弹窗,全文阅读",
                siteName + "小说阅读," + cat1 + "小说大全," + cat2 + "在线阅读," + book1 + "全文," + book2 + "最新章节," + book3 + "免费看,完结小说,连载小说",
                siteName + "," + cat1 + "," + cat2 + "," + cat3 + ",小说,免费,在线,无弹窗," + book1 + "," + book2 + "," + book3 + ",全文,最新章节",
        }

        // 8. 模板选择: simpleHash(siteID) % len(pool), 每站稳定取一个组合 (同站再生成不抖动).
        h := uint64(simpleHash(siteID))
        title = titlePool[h%uint64(len(titlePool))]
        description = descPool[h%uint64(len(descPool))]
        keywords = kwPool[h%uint64(len(kwPool))]

        return truncateRune(title, 80), truncateRune(description, 200), truncateRune(keywords, 200), nil
}

// truncateRune 按 rune 截断字符串到 max 字符 (防中文多字节斩半) (R63-A).
func truncateRune(s string, max int) string {
        if max <= 0 {
                return ""
        }
        r := []rune(s)
        if len(r) <= max {
                return s
        }
        return string(r[:max])
}

// adminSiteGenerateTDK — POST /api/admin/sites/:id/generate-tdk 单站智能 TDK 生成 + 写回 Site 表 (R63-A).
//
//   1. 校验 siteID 存在 + status=1 (不存在或下线返 404).
//   2. 调 generateSiteTDK 算 title/description/keywords.
//   3. 写回 Site 表 UPDATE title/description/keywords WHERE id=?.
//      保守策略: 不覆盖 isDefault 站点的 title (默认站保留手工 title, 只生成 description+keywords).
//   4. 返 {ok:true, site:{id, title, description, keywords}} (读回 DB 最终值).
func adminSiteGenerateTDK(w http.ResponseWriter, r *http.Request, siteID string) {
        if r.Method != http.MethodPost {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        var exist string
        var isDefault bool
        _ = db.QueryRow(`SELECT id, isDefault FROM Site WHERE id=? AND status=1`, siteID).Scan(&exist, &isDefault)
        if exist == "" {
                writeJSONErr(w, "站点不存在或已下线", 404)
                return
        }
        title, desc, kw, err := generateSiteTDK(siteID)
        if err != nil {
                writeJSONErr(w, "生成失败: "+err.Error(), 500)
                return
        }
        // 写回 DB: 默认站只更新 description+keywords (保留手工 title); 非默认站更新全部.
        var sets []string
        var args []interface{}
        if !isDefault {
                sets = append(sets, "title=?")
                args = append(args, title)
        }
        sets = append(sets, "description=?", "keywords=?", "updatedAt=datetime('now')")
        args = append(args, desc, kw, siteID)
        if _, err := db.Exec(`UPDATE Site SET `+strings.Join(sets, ",")+` WHERE id=?`, args...); err != nil {
                writeJSONErr(w, "写回失败: "+err.Error(), 500)
                return
        }
        // 读回 DB 最终值返响应 (确保默认站 title 字段反映实际 DB 状态, 非生成的 title).
        var finalTitle, finalDesc, finalKw string
        _ = db.QueryRow(`SELECT COALESCE(title,''), COALESCE(description,''), COALESCE(keywords,'') FROM Site WHERE id=?`, siteID).Scan(&finalTitle, &finalDesc, &finalKw)
        writeJSONOK(w, map[string]interface{}{
                "site": map[string]interface{}{
                        "id":          siteID,
                        "title":       finalTitle,
                        "description": finalDesc,
                        "keywords":    finalKw,
                },
        })
}

// adminSitesBatchGenerateTDK — POST /api/admin/sites body={action:"generate-tdk"} 批量智能 TDK 生成 (R63-A).
//
//   body 可选 {apply: false}; apply=true (默认) 写回 DB; apply=false 只返预览不写库.
//   迭代所有 status=1 站点: 调 generateSiteTDK, 默认站只更新 description+keywords (保守策略).
//   返 {ok:true, updated:N, sites:[{id, title, description, keywords}, ...]}.
func adminSitesBatchGenerateTDK(w http.ResponseWriter, r *http.Request, body map[string]interface{}) {
        if r.Method != http.MethodPost {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        apply := true
        if v, ok := body["apply"]; ok {
                if b, ok := v.(bool); ok {
                        apply = b
                }
        }
        // R63 主控修复: 先收齐 siteID+isDefault, 显式 Close rows, 再循环调 generateSiteTDK.
        //   原实现 rows 持锁期间 generateSiteTDK 内部 db.Query/QueryRow + apply=true 时 db.Exec
        //   → modernc.org/sqlite 连接池等待 rows 释放 → 30s 超时死锁 (单站 API 不持外层 rows 故正常).
        rows, err := db.Query(`SELECT id, isDefault FROM Site WHERE status=1 ORDER BY isDefault DESC, name ASC`)
        if err != nil {
                writeJSONErr(w, "查询失败: "+err.Error(), 500)
                return
        }
        type siteMeta struct {
                ID        string
                IsDefault bool
        }
        metas := []siteMeta{}
        for rows.Next() {
                var id string
                var isDefault bool
                _ = rows.Scan(&id, &isDefault)
                if id != "" {
                        metas = append(metas, siteMeta{ID: id, IsDefault: isDefault})
                }
        }
        rows.Close() // 显式释放连接, 后续 generateSiteTDK 的 Query/Exec 不再阻塞
        type siteTDK struct {
                ID, Title, Desc, Kw string
        }
        out := []siteTDK{}
        updated := 0
        for _, m := range metas {
                t, d, k, gerr := generateSiteTDK(m.ID)
                if gerr != nil {
                        continue
                }
                if apply {
                        var sets []string
                        var args []interface{}
                        if !m.IsDefault {
                                sets = append(sets, "title=?")
                                args = append(args, t)
                        }
                        sets = append(sets, "description=?", "keywords=?", "updatedAt=datetime('now')")
                        args = append(args, d, k, m.ID)
                        if _, err := db.Exec(`UPDATE Site SET `+strings.Join(sets, ",")+` WHERE id=?`, args...); err == nil {
                                updated++
                        }
                }
                out = append(out, siteTDK{ID: m.ID, Title: t, Desc: d, Kw: k})
        }
        writeJSONOK(w, map[string]interface{}{
                "updated": updated,
                "sites":   out,
        })
}

// ---------- 下载任务删除 API (R55-1A 新增) ----------

// adminDownloadsSubHandler — 分发 /api/admin/downloads/:id/file (GET TXT) 与 /api/admin/downloads/:id (DELETE).
//
//   R55-1A: 原 adminDownloadFileHandler 仅支持 GET :id/file. 现扩展为子路由分发器,
//   同时支持 DELETE /:id 删除下载任务 (含内存缓存清理). R55-1B 清理: 原 stub
//   adminDownloadFileHandler 已废弃 (注释中已说明), 现仅本函数处理 /api/admin/downloads/ 路径.
func adminDownloadsSubHandler(w http.ResponseWriter, r *http.Request) {
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/downloads/"), "/")
        if len(parts) < 1 || parts[0] == "" {
                writeJSONErr(w, "缺少 id", 400)
                return
        }
        jobID := parts[0]
        // /:id/file → 下载文件 (GET)
        if len(parts) >= 2 && parts[1] == "file" {
                if r.Method != http.MethodGet {
                        writeJSONErr(w, "method not allowed", 405)
                        return
                }
                adminDownloadFileHandlerImpl(w, r, jobID)
                return
        }
        // /:id (无后缀) → 删除下载任务 (DELETE)
        if r.Method == http.MethodDelete && len(parts) == 1 {
                adminDownloadsDelete(w, r, jobID)
                return
        }
        writeJSONErr(w, "not found", 404)
}

// adminDownloadsDelete — 删除下载任务 (DELETE /api/admin/downloads/:id).
//
//   先从内存缓存删除 (如有), 再删 DownloadJob 行.
//
//   R69-D BUG-83 (P1): 与 adminDownloadsCreate 后台 goroutine 的 race 修复.
//   原实现: SELECT id (存在性) → Lock; delete downloadFiles[jobID]; Unlock →
//   DELETE FROM DownloadJob. DELETE 在 Lock 外, goroutine 的 "Lock; SELECT
//   status; write map" 与 Delete 的 "Lock; delete map; Unlock; DELETE row"
//   仍有 race window: Delete 的 map-clear 在 goroutine write 前, goroutine 写
//   出 orphan entry. 修复: DELETE row 移进 Lock 内 — 与 delete map 原子
//   (同一锁). goroutine 侧 SELECT status 也移进 Lock 内 (BUG-83 同 fix).
//   双向原子后: Delete 先持锁 → DELETE row 后 goroutine SELECT 返 ErrNoRows
//   skip write; Goroutine 先持锁 → write map 后 Delete 持锁 delete map 清掉
//   entry. 全场景无 orphan.
func adminDownloadsDelete(w http.ResponseWriter, r *http.Request, jobID string) {
        var exist string
        _ = db.QueryRow(`SELECT id FROM DownloadJob WHERE id=?`, jobID).Scan(&exist)
        if exist == "" {
                writeJSONErr(w, "下载任务不存在", 404)
                return
        }
        // R69-D BUG-83: Lock 覆盖 DELETE row + delete map (原子, 与 goroutine 串行)
        downloadFilesMu.Lock()
        delete(downloadFiles, jobID)
        _, err := db.Exec(`DELETE FROM DownloadJob WHERE id=?`, jobID)
        downloadFilesMu.Unlock()
        if err != nil {
                writeJSONErr(w, "删除失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{"id": jobID, "deleted": true})
}

// adminDownloadFileHandlerImpl — 原 adminDownloadFileHandler 实现 (按 jobID 返回 TXT 内容).
//   从原 handler 抽出, 让 adminDownloadsSubHandler 调用.
func adminDownloadFileHandlerImpl(w http.ResponseWriter, r *http.Request, jobID string) {
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

// ---------- 系统设置删除 API (R55-1A 新增) ----------

// adminSettingsDeleteHandler — DELETE /api/admin/settings/:key 删除单个设置项.
//
//   原 admin/settings 仅能 GET/PUT 批量更新, 无法删除冗余 key. R55-1A 补齐 DELETE.
//   禁止删除 feedbackEnabled (反馈模块开关需通过 toggle 切换, 不能直删否则前台状态不一致).
func adminSettingsDeleteHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodDelete {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/settings/"), "/")
        if len(parts) < 1 || parts[0] == "" {
                writeJSONErr(w, "缺少 key", 400)
                return
        }
        key := parts[0]
        if !settingKeyRE.MatchString(key) {
                writeJSONErr(w, "非法的设置项 key", 400)
                return
        }
        if key == "feedbackEnabled" {
                writeJSONErr(w, "feedbackEnabled 不能删除, 请通过开关切换", 400)
                return
        }
        var exist string
        _ = db.QueryRow(`SELECT key FROM Setting WHERE key=?`, key).Scan(&exist)
        if exist == "" {
                writeJSONErr(w, "设置项不存在", 404)
                return
        }
        _, err := db.Exec(`DELETE FROM Setting WHERE key=?`, key)
        if err != nil {
                writeJSONErr(w, "删除失败: "+err.Error(), 500)
                return
        }
        writeJSONOK(w, map[string]interface{}{"key": key, "deleted": true})
}

// ---------- 备份清空 API (R55-1A 新增) ----------

// adminBackupClearHandler — POST /api/admin/backup/clear 清空采集数据 (危险操作).
//
//   原 admin/backup 仅能 VACUUM 碎片整理, 无法清空数据. R55-1A 补齐 "清空" 编辑功能.
//   清空范围: Book + Chapter + BookTag + Task + TaskLog + DownloadJob (采集产物).
//   保留: Site + Category + Rule + FriendLink + Setting (基础设施, 删了系统就废了).
//   入参 body: {confirm: true} 必须显式传 true 才执行 (防误触).
func adminBackupClearHandler(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
                writeJSONErr(w, "method not allowed", 405)
                return
        }
        body := readJSONBody(r)
        if !boolField(body, "confirm", false) {
                writeJSONErr(w, "请显式传 confirm=true 确认清空操作", 400)
                return
        }
        // R55-1B 修复 BUG-2 (P1): 原实现顺序 = 先 DELETE FROM Task → 后查
        //   `SELECT id FROM Task WHERE status='running'` 做停止 runtime. 但 Task 行
        //   已被删, 查询返 0 行, runtime 永不被 MarkStopped → 后台 goroutine 继续
        //   跑, 往已删 Task 表写 UpdateTaskStatus/UpdateTaskProgress 全失败 (日志噪声)
        //   且 RunInflight 仍持 ctx, 任务可能在 goroutine 内 panic. 修复: 先查
        //   running 任务 IDs → MarkStopped runtime → 再 DELETE FROM Task.
        tr := crawl.GetTaskRunner()
        type runningTask struct{ id string }
        runningTasks := []runningTask{}
        runRows, _ := db.Query(`SELECT id FROM Task WHERE status='running'`)
        for runRows != nil && runRows.Next() {
                var tid string
                _ = runRows.Scan(&tid)
                if tid != "" {
                        runningTasks = append(runningTasks, runningTask{id: tid})
                }
        }
        if runRows != nil {
                runRows.Close()
        }
        // 先停止所有运行中 task 的 runtime (避免 goroutine 往已删 DB 行写)
        for _, rt := range runningTasks {
                if runtime := tr.GetRuntime(rt.id); runtime != nil {
                        runtime.MarkStopped()
                }
        }
        // 清空采集产物 (按依赖顺序: TaskLog → Task → DownloadJob → BookTag → Chapter → Book)
        type op struct{ label, sql string }
        ops := []op{
                {"taskLogs", `DELETE FROM TaskLog`},
                {"tasks", `DELETE FROM Task`},
                {"downloadJobs", `DELETE FROM DownloadJob`},
                {"bookTags", `DELETE FROM BookTag`},
                {"chapters", `DELETE FROM Chapter`},
                {"books", `DELETE FROM Book`},
        }
        cleared := map[string]int{}
        for _, o := range ops {
                res, err := db.Exec(o.sql)
                if err != nil {
                        writeJSONErr(w, "清空 "+o.label+" 失败: "+err.Error(), 500)
                        return
                }
                n, _ := res.RowsAffected()
                cleared[o.label] = int(n)
        }
        // 清扫内存下载缓存
        downloadFilesMu.Lock()
        downloadFiles = map[string]downloadFileEntry{}
        downloadFilesMu.Unlock()
        writeJSONOK(w, map[string]interface{}{"cleared": cleared})
}

// ---------- R40-1B 页面数据装配 ----------

func fillCategoriesPageData(data map[string]interface{}) {
        rows, err := db.Query(`SELECT id, name, sortOrder, createdAt FROM Category ORDER BY sortOrder ASC LIMIT 500`)
        cats := []map[string]interface{}{}
        if err == nil {
                // R64-C BUG-41 (P0): 先收齐 category 行再循环 (逐 category 调 db.QueryRow 算 bookCount).
                //   原实现 db.QueryRow 在 for rows.Next() 内部 → modernc.org/sqlite 连接池
                //   (SetMaxOpenConns(1)) 等待 rows 释放 → 30s+ 超时死锁 (Category 表非空时必现).
                //   修复: rows 扫完转 []struct, 显式 Close rows, 再循环调 db.QueryRow.
                type catRow struct {
                        ID, Name, CreatedAt string
                        SortOrder            int
                }
                catRows := []catRow{}
                for rows.Next() {
                        var cr catRow
                        _ = rows.Scan(&cr.ID, &cr.Name, &cr.SortOrder, &cr.CreatedAt)
                        catRows = append(catRows, cr)
                }
                rows.Close()
                for _, cr := range catRows {
                        var bookCount int
                        _ = db.QueryRow(`SELECT COUNT(*) FROM Book WHERE categoryId=?`, cr.ID).Scan(&bookCount)
                        cats = append(cats, map[string]interface{}{
                                "id": cr.ID, "name": cr.Name, "sortOrder": cr.SortOrder,
                                "bookCount": bookCount, "createdAt": cr.CreatedAt,
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
        // R55-1A: 站点列表 (供主题切换面板下拉选择)
        srows, _ := db.Query(`SELECT id,name,domain,themeId FROM Site ORDER BY isDefault DESC, name ASC LIMIT 500`)
        sites := []map[string]interface{}{}
        if srows != nil {
                defer srows.Close()
                for srows.Next() {
                        var id, name, domain, themeID string
                        _ = srows.Scan(&id, &name, &domain, &themeID)
                        sites = append(sites, map[string]interface{}{
                                "id": id, "name": name, "domain": domain, "themeId": themeID,
                        })
                }
        }
        data["Sites"] = sites
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
                        // R54-1A: 附加中文说明 / 默认值 / 分类, 让 admin/settings 页面不再只显示 raw key
                        desc, defVal, cat, isFb := "", "", "", false
                        if meta, ok := settingMeta[key]; ok {
                                desc = meta.desc
                                defVal = meta.defaultVal
                                cat = meta.category
                                isFb = meta.isFeedback
                        }
                        settings = append(settings, map[string]interface{}{
                                "key": key, "value": v, "rawValue": v, "isJson": isJSON,
                                "updatedAt": "-", "desc": desc, "defaultValue": defVal,
                                "category": cat, "isFeedback": isFb,
                        })
                }
        }
        data["Settings"] = settings
        data["Total"] = len(settings)
        // R54-1A: 当前反馈模块开关状态 (供 admin/settings 顶部 toggle 卡片高亮显示)
        data["FeedbackEnabled"] = getFeedbackEnabled()
        // R54-1A: 已知 key 的说明清单 (按 settingMeta 字典序, 供页面顶部"说明表格"渲染)
        type metaRow struct {
                key, desc, defaultVal, category string
        }
        metas := make([]metaRow, 0, len(settingMeta))
        for k, m := range settingMeta {
                metas = append(metas, metaRow{key: k, desc: m.desc, defaultVal: m.defaultVal, category: m.category})
        }
        sort.Slice(metas, func(i, j int) bool { return metas[i].key < metas[j].key })
        metaOut := make([]map[string]interface{}, 0, len(metas))
        for _, m := range metas {
                metaOut = append(metaOut, map[string]interface{}{
                        "key": m.key, "desc": m.desc, "defaultValue": m.defaultVal, "category": m.category,
                })
        }
        data["SettingMetas"] = metaOut
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
