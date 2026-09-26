// heis-backend — Go 完整后端 (方案 B: Go templates 前端)
// 路由 + 模板渲染 + 静态服务 + DB
package main

import (
        "context"
        "database/sql"
        "encoding/json"
        "fmt"
        "html/template"
        "log"
        "math/big"
        "net/http"
        "net/url"
        "os"
        "path/filepath"
        "regexp"
        "runtime"
        "sort"
        "strconv"
        "time"
        "strings"
        "unicode/utf8"

        "heis-backend/crawl"

        _ "modernc.org/sqlite"
)

var (
        db       *sql.DB
        tmpls    *template.Template
        basePath string
)

func init() {
        bp, _ := os.Getwd()
        // 找项目根 (go-backend 的上级)
        if _, err := os.Stat(filepath.Join(bp, "go-backend")); err == nil {
                basePath = bp
        } else if strings.HasSuffix(bp, "go-backend") {
                basePath = filepath.Dir(bp)
        } else {
                basePath = bp
        }
}

func main() {
        dbPath := filepath.Join(basePath, "db/custom.db")
        if _, err := os.Stat(dbPath); err != nil {
                dbPath = filepath.Join(basePath, "prisma/dev.db")
        }
        log.Printf("数据库: %s", dbPath)

        var err error
        db, err = sql.Open("sqlite", dbPath)
        if err != nil {
                log.Fatal(err)
        }
        defer db.Close()
        // R57-1A 反预览挂掉增强: SQLite 单写 + 多读并发模型.
        //   modernc.org/sqlite 默认 MaxOpenConns 无上限, 多写连接 + delete journal 模式
        //   会触发 "database is locked" 错误 (admin 写 Task/Book + 公开 GET 同时跑时常见).
        //   WAL 模式让读不阻塞写 + 写不阻塞读 (仅写-写互斥); busy_timeout 5s 兜底重试.
        //   MaxOpenConns=1 让 Go 端串行化写 (避免现代 SQLite 内部锁竞争), 读仍走 WAL.
        db.SetMaxOpenConns(1)
        if _, perr := db.Exec(`PRAGMA journal_mode=WAL;`); perr != nil {
                log.Printf("[db] PRAGMA journal_mode=WAL 失败 (继续用默认 delete 模式): %v", perr)
        }
        if _, perr := db.Exec(`PRAGMA busy_timeout=5000;`); perr != nil {
                log.Printf("[db] PRAGMA busy_timeout=5000 失败: %v", perr)
        }
        if _, perr := db.Exec(`PRAGMA synchronous=NORMAL;`); perr != nil {
                log.Printf("[db] PRAGMA synchronous=NORMAL 失败: %v", perr)
        }

        // 解析模板 + FuncMap (templates/*.html + templates/*/*.html 递归)
        tmpls = template.New("").Funcs(template.FuncMap{
                "wordCount": func(n interface{}) string {
                        var i int64
                        switch v := n.(type) {
                        case int64:
                                i = v
                        case int:
                                i = int64(v)
                        case float64:
                                i = int64(v)
                        }
                        if i >= 10000 {
                                return fmt.Sprintf("%d 万字", i/10000)
                        }
                        return fmt.Sprintf("%d 字", i)
                },
                // R38-1B: 状态码 → 中文标签 (ongoing/unknown/"" → 连载, completed → 完结)
                "statusLabel": func(s interface{}) string {
                        v := fmt.Sprintf("%v", s)
                        if v == "completed" {
                                return "完结"
                        }
                        return "连载"
                },
                // R38-1B: ISO/SQLite datetime 字符串 → YYYY-MM-DD
                // R53-1B: 先经 formatUpdatedAt 归一化 (Unix ms 时间戳 / SQLite TEXT / ISO 串
                //   均转成 "2006-01-02 15:04"), 再切前 10 字; 修复 Prisma @updatedAt 存 Unix ms
                //   时 fmtDate 直接 s[:10] 取出时间戳片段的 bug.
                "fmtDate": func(s interface{}) string {
                        d := formatUpdatedAt(fmt.Sprintf("%v", s))
                        if len(d) >= 10 {
                                return d[:10]
                        }
                        return d
                },
                // R38-1B: ISO/SQLite datetime 字符串 → MMDD (无分隔, 排行榜日期用)
                // R53-1B: 同 fmtDate, 先 formatUpdatedAt 归一化, 再切 [5:7]+[8:10].
                "fmtDateShort": func(s interface{}) string {
                        d := formatUpdatedAt(fmt.Sprintf("%v", s))
                        if len(d) >= 10 {
                                return d[5:7] + d[8:10]
                        }
                        return d
                },
                // R56-1A: ISO/SQLite datetime 字符串 → MM-DD (带连字符, 源站 aijjxs/ddyueshu/ggd66 等列表日期用)
                // 同 fmtDateShort 先 formatUpdatedAt 归一化, 再切 [5:7]+"-"+[8:10].
                "fmtDateMD": func(s interface{}) string {
                        d := formatUpdatedAt(fmt.Sprintf("%v", s))
                        if len(d) >= 10 {
                                return d[5:7] + "-" + d[8:10]
                        }
                        return d
                },
                // R38-1B: 整数加减 (模板不支持原生算术, 用于分页上下页)
                "add": func(a, b interface{}) int {
                        return toInt(a) + toInt(b)
                },
                "sub": func(a, b interface{}) int {
                        return toInt(a) - toInt(b)
                },
                // R40-1B: 反馈类型/状态 标签 + pill 颜色
                "fbTypeLabel": func(t interface{}) string {
                        switch fmt.Sprintf("%v", t) {
                        case "bug":
                                return "Bug"
                        case "suggestion":
                                return "建议"
                        case "praise":
                                return "表扬"
                        case "other":
                                return "其他"
                        }
                        return fmt.Sprintf("%v", t)
                },
                "fbTypePill": func(t interface{}) string {
                        switch fmt.Sprintf("%v", t) {
                        case "bug":
                                return "error"
                        case "suggestion":
                                return "ongoing"
                        case "praise":
                                return "completed"
                        }
                        return "unknown"
                },
                "fbStatusLabel": func(s interface{}) string {
                        switch fmt.Sprintf("%v", s) {
                        case "new":
                                return "新"
                        case "read":
                                return "已读"
                        case "resolved":
                                return "已解决"
                        case "ignored":
                                return "已忽略"
                        }
                        return fmt.Sprintf("%v", s)
                },
                "fbStatusPill": func(s interface{}) string {
                        switch fmt.Sprintf("%v", s) {
                        case "new":
                                return "running"
                        case "read":
                                return "ongoing"
                        case "resolved":
                                return "completed"
                        case "ignored":
                                return "stopped"
                        }
                        return "unknown"
                },
                // R40-1B: SEO 评分颜色 (绿/黄/红)
                "scoreColor": func(s interface{}) string {
                        n, _ := strconv.Atoi(fmt.Sprintf("%v", s))
                        switch {
                        case n >= 80:
                                return "var(--accent)"
                        case n >= 60:
                                return "var(--warn)"
                        case n > 0:
                                return "var(--err)"
                        }
                        return "var(--dim)"
                },
                // R40-1B: SEO 严重度颜色
                "severityColor": func(s interface{}) string {
                        switch fmt.Sprintf("%v", s) {
                        case "error":
                                return "var(--err)"
                        case "warning":
                                return "var(--warn)"
                        case "info":
                                return "var(--info)"
                        }
                        return "var(--dim)"
                },
                // R40-1B: SEO 严重度中文标签
                "severityLabel": func(s interface{}) string {
                        switch fmt.Sprintf("%v", s) {
                        case "error":
                                return "错误"
                        case "warning":
                                return "警告"
                        case "info":
                                return "提示"
                        }
                        return fmt.Sprintf("%v", s)
                },
                // R40-1B: 下载任务状态标签 (pending/running/done/error)
                "jobStatusLabel": func(s interface{}) string {
                        switch fmt.Sprintf("%v", s) {
                        case "pending":
                                return "待生成"
                        case "running":
                                return "生成中"
                        case "done":
                                return "已完成"
                        case "error":
                                return "失败"
                        }
                        return fmt.Sprintf("%v", s)
                },
                // R55-1A: row → JSON-in-HTML-attribute (data-site='{{toJSON .}}').
                //   返回 template.HTMLAttr 让 html/template 不再二次转义 (& < > 已被 json.Marshal
                //   转为 \u00xx 安全序列), 单引号属性包住 JSON 双引号串即可.
                "toJSON": func(v interface{}) template.HTMLAttr {
                        b, err := json.Marshal(v)
                        if err != nil {
                                return template.HTMLAttr("{}")
                        }
                        return template.HTMLAttr(b)
                },
        })
        // 收集所有 template 文件 (templates/*.html + templates/*/*.html)
        tmplFiles := []string{}
        for _, pattern := range []string{
                filepath.Join(basePath, "go-backend/templates/*.html"),
                filepath.Join(basePath, "go-backend/templates/*/*.html"),
                filepath.Join(basePath, "go-backend/templates/*/*/*.html"),
        } {
                if matches, _ := filepath.Glob(pattern); matches != nil {
                        tmplFiles = append(tmplFiles, matches...)
                }
        }
        if len(tmplFiles) > 0 {
                tmpls, err = tmpls.ParseFiles(tmplFiles...)
                if err != nil {
                        log.Printf("模板解析警告: %v", err)
                }
                log.Printf("已加载 %d 个模板", len(tmplFiles))
        } else {
                log.Printf("警告: 未找到模板文件")
        }

        // R54-1A: 启动时灌入已知 setting 默认值 (feedbackEnabled=true 等, INSERT OR IGNORE 不覆盖已存在)
        seedDefaultSettings()

        // 静态文件 (clone-css + public) — R51 修复: StripPrefix 剥离了 clone-css/ 但文件在 public/clone-css/ 下
        // 改为 FileServer 指向 public/clone-css/ + StripPrefix, 这样 /clone-css/shipsay.css → shipsay.css → 在 clone-css/ 找到
        publicDir := filepath.Join(basePath, "public")
        cloneCSSDir := filepath.Join(publicDir, "clone-css")
        cssFs := http.FileServer(http.Dir(cloneCSSDir))
        http.Handle("/clone-css/", http.StripPrefix("/clone-css/", cssFs))
        // 其他 public/ 静态文件 (icon.svg 等) — 不剥前缀, 直接服务
        http.Handle("/icon.svg", http.FileServer(http.Dir(publicDir)))
        http.Handle("/manifest.json", http.FileServer(http.Dir(publicDir)))
        http.Handle("/favicon.ico", http.FileServer(http.Dir(publicDir)))

        // R52: 封面图服务 /covers/ — 文件存在返回图片, 不存在返回 SVG 占位(书名首字+渐变色块)
        //   R53-1A 修复 BUG-4 (path traversal): 原 filepath.Join(coversDir, name) 在
        //     name="../etc/passwd.webp" 时 join 成 "data/covers/../etc/passwd.webp" →
        //     filepath.Clean 解析为 "data/etc/passwd.webp" (coversDir 之外). net/http
        //     会清理 URL 的 ".." 段, 但恶意 URL 编码 %2e%2e%2f 经某些 proxy 可能
        //     不被 net/http 清理 (取决于 Caddy/nginx 转发行为). 修复: 用
        //     filepath.Base(name) 取 basename 剥所有目录组件 (类似 ReadCover 安全路径
        //     模式), 再 join + 验证 Clean 后仍在 coversDir 内. 双保险: Base + HasPrefix.
        //   R53-1A 修复 BUG-5 (SVG initial 未 XML escape): 原 fmt.Fprintf "%s" 直接拼
        //     initial 到 SVG <text> 内, 若书名首字是 < / > / & / " / ' (源站抓取
        //     异常时 HTML 标签字符可能渗入书名), SVG 输出会破图 (浏览器无法解析
        //     XML) 或注入恶意 <script> (虽然 SVG <script> 不执行 JS 在 <img> 上下
        //     文, 但在直接访问 /covers/ URL 的浏览器上下文可执行 — XSS 风险).
        //     修复: 用 template.HTMLEscapeString 转义 5 个 XML 特殊字符 (< > & " ').
        //   R53-1A 修复 BUG-6 (LIKE 模式过松): 原 LIKE "%"+name 把 name 当 LIKE
        //     pattern, 若 name 含 % 或 _ (SQL LIKE 通配符) 会误匹配. 同时 LIKE
        //     "%foo.webp" 会匹配 "covers/foo.webp" + "other_foo.webp" + "xfoo.webp"
        //     等所有以 foo.webp 结尾的 cover, 取第一个 → 可能取到错书名. 修复:
        //     改用 cover = ? exact match, param = "covers/"+base (与 SaveCoverWebp
        //     存储路径 "covers/{name}.webp" 一致). 失败 (无 DB 行) 用默认 "书" 占位.
        //   R53-1A 修复 BUG-7 (Scan 错误忽略): 原 db.QueryRow(...).Scan(&bookName)
        //     不检查 err, 若 SQL 错误 (DB 损坏 / 表缺失) bookName="" → initial="书"
        //     兜底. 但 err != sql.ErrNoRows 时是真实错误, 应记日志供操作员排查.
        coversDir := filepath.Join(basePath, "data/covers")
        publicCoversDir := filepath.Join(publicDir, "covers")
        http.HandleFunc("/covers/", func(w http.ResponseWriter, r *http.Request) {
                rawName := strings.TrimPrefix(r.URL.Path, "/covers/")
                if rawName == "" { http.NotFound(w, r); return }
                // R53-1A BUG-4: Base + 路径验证 (防 path traversal)
                base := filepath.Base(rawName)
                if base == "" || base == "." || base == ".." {
                        http.NotFound(w, r); return
                }
                // 尝试 data/covers/base (SaveCoverWebp 落盘位置)
                fp := filepath.Join(coversDir, base)
                fpClean := filepath.Clean(fp)
                if !strings.HasPrefix(fpClean, coversDir+string(filepath.Separator)) && fpClean != coversDir {
                        http.NotFound(w, r); return
                }
                if _, err := os.Stat(fpClean); err == nil {
                        http.ServeFile(w, r, fpClean)
                        return
                }
                // 尝试 public/covers/base (手放资源)
                fp2 := filepath.Join(publicCoversDir, base)
                fp2Clean := filepath.Clean(fp2)
                if !strings.HasPrefix(fp2Clean, publicCoversDir+string(filepath.Separator)) && fp2Clean != publicCoversDir {
                        http.NotFound(w, r); return
                }
                if _, err := os.Stat(fp2Clean); err == nil {
                        http.ServeFile(w, r, fp2Clean)
                        return
                }
                // 占位图: SVG 渐变色块 + 书名首字
                w.Header().Set("Content-Type", "image/svg+xml")
                w.Header().Set("Cache-Control", "public, max-age=3600")
                // R53-1A BUG-6: exact match 替代 LIKE, 防 % 通配符误匹配
                var bookName string
                coverField := "covers/" + base
                err := db.QueryRow(`SELECT name FROM Book WHERE cover = ? LIMIT 1`, coverField).Scan(&bookName)
                // R53-1A BUG-7: Scan 错误记日志 (ErrNoRows 静默 — 兜底 "书" 是预期行为)
                if err != nil && err != sql.ErrNoRows {
                        log.Printf("[covers] 查询书名失败 cover=%s err=%v", coverField, err)
                }
                initial := "书"
                if runes := []rune(bookName); len(runes) > 0 { initial = string(runes[0]) }
                // R53-1A BUG-5: SVG <text> 内 initial 必须 XML escape
                //   template.HTMLEscapeString 转义 < > & " ' (5 个 XML 特殊字符)
                //   bookName 首字可能是这些字符的边缘 case (源站抓取异常 / HTML 标签渗入).
                escaped := template.HTMLEscapeString(initial)
                fmt.Fprintf(w, `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#667eea"/><stop offset="1" stop-color="#764ba2"/></linearGradient></defs><rect width="120" height="160" fill="url(#g)" rx="4"/><text x="60" y="85" font-size="48" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="sans-serif">%s</text></svg>`, escaped)
        })

        // 前台页面 (Go templates SSR)
        http.HandleFunc("/", homeHandler) // 首页 + 路由分发

        // API 路由
        http.HandleFunc("/health", healthHandler)
        http.HandleFunc("/api/public/books", booksHandler)
        http.HandleFunc("/api/public/categories", categoriesHandler)
        http.HandleFunc("/api/public/sites", sitesHandler)
        http.HandleFunc("/api/public/book", bookDetailHandler)
        http.HandleFunc("/api/public/chapter", chapterHandler)

        // R54-1A: 公共反馈提交 (前台浮窗按钮的 POST 目标, 受 Setting.feedbackEnabled 开关控制)
        http.HandleFunc("/api/feedback", publicFeedbackSubmitHandler)

        // R39-1C: 采集后台 API (调 crawl 包)
        http.HandleFunc("/api/admin/health", adminHealthHandler)
        http.HandleFunc("/api/admin/tasks", adminTasksHandler)
        http.HandleFunc("/api/admin/tasks/", adminTaskSubHandler) // /:id/control + /:id/snapshot + DELETE /:id (R55-1A)
        http.HandleFunc("/api/admin/rules", adminRulesHandler)
        http.HandleFunc("/api/admin/rules/", adminRuleByIDHandler) // /:id (GET/PUT/DELETE - R55-1A)
        http.HandleFunc("/api/admin/books", adminBooksAPIHandler)  // GET list + POST create (R55-1A)
        http.HandleFunc("/api/admin/books/", adminBookByIDHandler) // /:id (PUT/DELETE - R55-1A)

        // R40-1B: admin 后台扩展 API (categories/links/themes/downloads/settings/feedback/backup/seo-audit)
        http.HandleFunc("/api/admin/categories", adminCategoriesHandler)
        http.HandleFunc("/api/admin/categories/", adminCategoryByIDHandler) // /:id (PUT/DELETE)
        http.HandleFunc("/api/admin/links", adminLinksHandler)
        http.HandleFunc("/api/admin/links/", adminLinkByIDHandler) // /:id (PUT/DELETE) — path 风格, 兼容 body.id
        http.HandleFunc("/api/admin/themes", adminThemesHandler)
        http.HandleFunc("/api/admin/downloads", adminDownloadsHandler)
        http.HandleFunc("/api/admin/downloads/", adminDownloadsSubHandler) // /:id/file GET + DELETE /:id (R55-1A 重构: 原 adminDownloadFileHandler)
        http.HandleFunc("/api/admin/settings", adminSettingsHandler)
        http.HandleFunc("/api/admin/settings/", adminSettingsDeleteHandler) // DELETE /:key (R55-1A)
        http.HandleFunc("/api/admin/feedback", adminFeedbackHandler)
        http.HandleFunc("/api/admin/feedback/", adminFeedbackByIDHandler) // /:id (GET/PATCH/DELETE)
        http.HandleFunc("/api/admin/backup", adminBackupHandler)           // GET 导出 JSON
        http.HandleFunc("/api/admin/backup/", adminBackupSubHandler)      // /restore + /vacuum + /clear (R55-1A)
        // R55-1A: 站点 CRUD API (GET list / POST create / PUT-DELETE /:id)
        http.HandleFunc("/api/admin/sites", adminSitesHandler)
        http.HandleFunc("/api/admin/sites/", adminSiteByIDHandler)
        http.HandleFunc("/api/admin/seo-audit", adminSeoAuditHandler)

        // R39-1C: 采集后台页面 (Go templates SSR, 深色主题)
        http.HandleFunc("/admin", adminPageHandler)
        http.HandleFunc("/admin/", adminPageHandler) // /admin/tasks, /admin/books, ...

        addr := ":3000"
        log.Printf("heis-backend 启动: http://localhost%s (内存 %dMB)", addr, getMemMB())

        // R51-1A 反反爬增强: 启动 TLS session 后台周期性 flush goroutine (5min 间隔).
        //   原 R48-1A/R50-1A 仅在 Put 时 60s 节流触发异步 flush, 长时间无活跃握手时
        //   dirty 数据持续留内存, 进程 crash 期间丢失. 后台 flusher 每 5min 调
        //   SaveToDisk, 无新数据时早返不浪费 IO. ctx 在 graceful shutdown 时取消.
        flusherCtx, flusherCancel := context.WithCancel(context.Background())
        defer flusherCancel()
        crawl.StartTlsSessionBackgroundFlusher(flusherCtx)

        // R57-1A 反预览挂掉增强: http.Server 加 ReadHeader/Read/Write/Idle 超时.
        //   原 http.ListenAndServe 用默认 Server (无超时), 慢客户端 (含恶意 slowloris)
        //   可无限占连接 → FD 耗尽 → 新请求 502 → 预览挂掉. Go net/http 默认超时 0=无限.
        //   设: ReadHeader 10s (慢 TLS 握手容忍) / Read 30s / Write 60s (大首页+模板渲染) /
        //       Idle 120s (keep-alive 复用). 静态文件 (/clone-css/*.css 等) 不走超时分支.
        srv := &http.Server{
                Addr:              addr,
                Handler:           nil,
                ReadHeaderTimeout: 10 * time.Second,
                ReadTimeout:       30 * time.Second,
                WriteTimeout:      60 * time.Second,
                IdleTimeout:       120 * time.Second,
        }
        if err := srv.ListenAndServe(); err != nil {
                log.Fatal(err)
        }
}

// homeHandler 首页 + 视图路由 (/?view=home|book|read|category|ranking|fulltext|search|keyword)
// R38-1B: 扩展为按 view 参数渲染对应主题模板
// R63-A: 非 "/" 路径伪静态解析 (site.PseudoStaticStyle != "query" 时, 尝试解析 path 为
//   book/read/category URL; 匹配则转等价 query 串; 不匹配 404). 保留 R42-1A SEO 垃圾保护.
func homeHandler(w http.ResponseWriter, r *http.Request) {
        // R42-1A: 仅根路径 "/" 接受; 其它未匹配路径 (如 /random-spam-url) 应返回 404 而非 200 home
        //         (防 SEO 垃圾 - 否则攻击者可声明无限 URL 空间都被搜索引擎索引为同款首页)
        // R64-D: 非 "/" 路径 + 非保留前缀 (/api/ 由 admin handlers 处理) + 非伪静态前缀 → 渲染 404.html
        //         替代 http.NotFound (site 已加载, 可渲染站点风格 404 页). /api/* 仍走 http.NotFound
        //         (保留 JSON API 错误响应约定, 不渲染 404.html).
        view := r.URL.Query().Get("view")
        if view == "" {
                view = "home"
        }
        siteID := r.URL.Query().Get("site")

        // R64-D: 提前加载 site, 用于 404.html 渲染 (即使路径不匹配伪静态前缀, 也需要 site data)
        site, err := getSite(siteID)
        if err != nil || site == nil {
                // 兜底: 无 site → http.Error (避免 404.html 渲染依赖 nil site)
                if r.URL.Path == "/" {
                        http.Error(w, "站点未找到", 404)
                        return
                }
                // 非根路径 + 无 site → http.NotFound (保留 R63 行为, 不渲染 404.html)
                http.NotFound(w, r)
                return
        }

        // R63-A: 伪静态路径解析 (非 query 风格).
        //   site.PseudoStaticStyle != "query" 时, 试 parsePseudoStaticPath(path, style).
        //   匹配则 decode token → cuid, 注入等价 query 串 (view/id/page) 并继续走 view 分发.
        //   不匹配或 decode 失败 → 渲染 404.html (site 已加载; R64-D 替换原 http.NotFound).
        pseudoStyle, _ := site["PseudoStaticStyle"].(string)
        if pseudoStyle == "" {
                pseudoStyle = "query"
        }
        if r.URL.Path != "/" {
                // /api/* 路径不渲染 404.html (保留 JSON 错误约定, 由 admin/API handlers 处理)
                if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
                        http.NotFound(w, r)
                        return
                }
                // 非伪静态前缀 + 非保留 → 渲染 404.html (site 已加载)
                if !looksLikePseudoStaticPath(r.URL.Path) {
                        render404(w, r, site)
                        return
                }
                // 伪静态前缀: 试 parse + decode
                parsed := false
                if pseudoStyle != "query" {
                        if pView, pToken, pPage, ok := parsePseudoStaticPath(r.URL.Path, pseudoStyle); ok {
                                cuid := decodePseudoStaticToken(pToken, pseudoStyle, pView)
                                if cuid != "" {
                                        q := r.URL.Query()
                                        q.Set("view", pView)
                                        switch pView {
                                        case "book":
                                                q.Set("id", cuid)
                                        case "read":
                                                q.Set("chapter", cuid)
                                        case "category":
                                                q.Set("cat", cuid)
                                        }
                                        if pPage > 1 {
                                                q.Set("page", strconv.Itoa(pPage))
                                        }
                                        r.URL.RawQuery = q.Encode()
                                        view = pView
                                        parsed = true
                                }
                        }
                }
                if !parsed {
                        render404(w, r, site)
                        return
                }
        }

        // 获取分类 (所有页型共用 nav)
        cats, _ := getCategories()
        navCats := takeN(cats, 8)
        // R64-D: 注入分类 URL 到 cats + navCats (共享底层数组, 单次遍历覆盖两者)
        injectCategoryURLs(cats, pseudoStyle)

        // 主题解析 (clone-shipsay → shipsay)
        theme, _ := site["ThemeID"].(string)
        if !strings.HasPrefix(theme, "clone-") {
                theme = "shipsay" // 默认
        } else {
                theme = strings.TrimPrefix(theme, "clone-")
        }

        // 基础 data (所有页型都用到)
        //   R63-A: data["PseudoStyle"] 供模板层使用 (R63-B 将接入模板); data["HomeURL"] 提供
        //   首页 URL builder 输出 (各风格一致为 "/").
        data := map[string]interface{}{
                "Site":         site,
                "Categories":   cats,
                "NavCats":       navCats,
                "PseudoStyle":   pseudoStyle,
                "HomeURL":       buildHomeURL(pseudoStyle),
        }

        // 按 view 装配数据
        switch view {
        case "book":
                id := r.URL.Query().Get("id")
                if id == "" {
                        http.Error(w, "缺少 id 参数", 400)
                        return
                }
                book, chapters, recent, related, firstChID, ok := getBookViewData(id)
                if !ok {
                        render404(w, r, site)
                        return
                }
                // R64-D: 注入 per-book/chapter URLs (R63-A 已注入单页级 BookURL/FirstChapterURL)
                injectBookURL(book, pseudoStyle)
                injectChapterURLs(chapters, pseudoStyle, id)
                injectChapterURLs(recent, pseudoStyle, id)
                injectBookURLs(related, pseudoStyle)
                data["Book"] = book
                data["Chapters"] = chapters
                data["RecentChapters"] = recent
                data["Related"] = related
                data["FirstChapterId"] = firstChID
                // R63-A: 注入 URL builder 输出供模板消费 (本轮 Go 端就绪, 模板层 R63-B 接入).
                data["BookURL"] = buildBookURL(pseudoStyle, id)
                if firstChID != "" {
                        data["FirstChapterURL"] = buildChapterURL(pseudoStyle, firstChID, id)
                }
        case "read":
                chID := r.URL.Query().Get("chapter")
                if chID == "" {
                        http.Error(w, "缺少 chapter 参数", 400)
                        return
                }
                ch, book, prev, next, ok := getReadViewData(chID, site)
                if !ok {
                        render404(w, r, site)
                        return
                }
                // R64-D: 注入 per-book URL (R63-A 已注入 prev/next chapter URL + 单页级 ChapterURL/BookURL)
                injectBookURL(book, pseudoStyle)
                data["Chapter"] = ch
                data["Book"] = book
                data["Prev"] = prev
                data["Next"] = next
                // R63-A: 注入 URL builder 输出.
                data["ChapterURL"] = buildChapterURL(pseudoStyle, chID, bookIDFromMap(book))
                if bid := bookIDFromMap(book); bid != "" {
                        data["BookURL"] = buildBookURL(pseudoStyle, bid)
                }
                if prev != nil {
                        if pid, ok := prev["id"].(string); ok && pid != "" {
                                prev["URL"] = buildChapterURL(pseudoStyle, pid, bookIDFromMap(book))
                        }
                }
                if next != nil {
                        if nid, ok := next["id"].(string); ok && nid != "" {
                                next["URL"] = buildChapterURL(pseudoStyle, nid, bookIDFromMap(book))
                        }
                }
        case "category":
                catID := r.URL.Query().Get("cat")
                page := clampPage(r.URL.Query().Get("page"))
                size := 24
                // R64-D BUG-31: clamp page to maxPages BEFORE getCategoryViewData (防 OFFSET cap 错位).
                //   getCategoryViewData 内部 cap OFFSET to 10000; 若 page > maxPages, OFFSET 被截到 10000
                //   但 page 变量保持用户输入 → 显示页号与数据不一致. 先 clamp page 再查询, 数据与页号一致.
                maxPages := maxPaginationOffset/size + 1
                if page > maxPages {
                        page = maxPages
                }
                label, books, total := getCategoryViewData(catID, page, size)
                totalPages := (total + size - 1) / size
                if totalPages < 1 {
                        totalPages = 1
                }
                if totalPages > maxPages {
                        totalPages = maxPages
                }
                if page > totalPages {
                        page = totalPages
                }
                // R64-D: 注入 per-book URLs
                injectBookURLs(books, pseudoStyle)
                data["CatID"] = catID
                data["Label"] = label
                data["Books"] = books
                data["HotBooks"] = takeBooks(books, 12)
                data["TopAuthors"] = pickAuthors(books, 12)
                data["Page"] = page
                data["Size"] = size
                data["Total"] = total
                data["TotalPages"] = totalPages
                data["PageList"] = pageListWithURLs(buildPageList(page, totalPages), func(p int) string {
                        return buildCategoryURL(pseudoStyle, catID, p)
                })
                // R63-A: 注入分页 URL builder 输出.
                data["CategoryURL"] = buildCategoryURL(pseudoStyle, catID, page)
                if page > 1 {
                        data["PrevPageURL"] = buildCategoryURL(pseudoStyle, catID, page-1)
                }
                if page < totalPages {
                        data["NextPageURL"] = buildCategoryURL(pseudoStyle, catID, page+1)
                }
        case "ranking":
                tab := r.URL.Query().Get("sort")
                if tab == "" {
                        tab = "allvisit"
                }
                page := clampPage(r.URL.Query().Get("page"))
                size := 30
                maxPages := maxPaginationOffset/size + 1
                if page > maxPages {
                        page = maxPages
                }
                books, total := getRankingViewData(tab, page, size)
                totalPages := (total + size - 1) / size
                if totalPages < 1 {
                        totalPages = 1
                }
                if totalPages > maxPages {
                        totalPages = maxPages
                }
                if page > totalPages {
                        page = totalPages
                }
                tabName := tabName(tab)
                // R64-D: 注入 per-book URLs (withRank 会 mutate books 加 rank 字段, 与 URL 字段互不冲突)
                injectBookURLs(books, pseudoStyle)
                data["Tabs"] = rankingTabs()
                data["Tab"] = tab
                data["TabName"] = tabName
                data["Books"] = withRank(books, page, size)
                data["HotBooks"] = takeBooks(books, 12)
                data["Page"] = page
                data["Size"] = size
                data["Total"] = total
                data["TotalPages"] = totalPages
                data["PageList"] = pageListWithURLs(buildPageList(page, totalPages), func(p int) string {
                        return buildPagerURL(pseudoStyle, "ranking", tab, p)
                })
                // R63-A: ranking/fulltext/search/keyword 等无实体 ID 的视图, 伪静态 URL 用
                //   buildPagerURL 退化返回 query 串 (避免过度设计; 主 SEO 价值在 book/chapter/category).
                data["PagerURL"] = buildPagerURL(pseudoStyle, "ranking", tab, page)
                if page > 1 {
                        data["PrevPageURL"] = buildPagerURL(pseudoStyle, "ranking", tab, page-1)
                }
                if page < totalPages {
                        data["NextPageURL"] = buildPagerURL(pseudoStyle, "ranking", tab, page+1)
                }
        case "fulltext":
                page := clampPage(r.URL.Query().Get("page"))
                size := 24
                maxPages := maxPaginationOffset/size + 1
                if page > maxPages {
                        page = maxPages
                }
                books, total := getFulltextViewData(page, size)
                totalPages := (total + size - 1) / size
                if totalPages < 1 {
                        totalPages = 1
                }
                if totalPages > maxPages {
                        totalPages = maxPages
                }
                if page > totalPages {
                        page = totalPages
                }
                injectBookURLs(books, pseudoStyle)
                data["Label"] = "全本完本小说"
                data["Books"] = books
                data["HotBooks"] = takeBooks(books, 12)
                data["TopAuthors"] = pickAuthors(books, 12)
                data["Page"] = page
                data["Size"] = size
                data["Total"] = total
                data["TotalPages"] = totalPages
                data["PageList"] = pageListWithURLs(buildPageList(page, totalPages), func(p int) string {
                        return buildPagerURL(pseudoStyle, "fulltext", "", p)
                })
                data["PagerURL"] = buildPagerURL(pseudoStyle, "fulltext", "", page)
                if page > 1 {
                        data["PrevPageURL"] = buildPagerURL(pseudoStyle, "fulltext", "", page-1)
                }
                if page < totalPages {
                        data["NextPageURL"] = buildPagerURL(pseudoStyle, "fulltext", "", page+1)
                }
        case "search":
                q := r.URL.Query().Get("q")
                books := getSearchViewData(q, 20)
                injectBookURLs(books, pseudoStyle)
                data["Q"] = q
                data["Books"] = books
                data["HotBooks"] = takeBooks(books, 12)
        case "keyword":
                tag := r.URL.Query().Get("tag")
                books, relatedTags := getKeywordViewData(tag, 20)
                injectBookURLs(books, pseudoStyle)
                data["Tag"] = tag
                data["Books"] = books
                data["RelatedTags"] = relatedTags
                data["HotBooks"] = takeBooks(books, 12)
        case "history":
                // 简单占位: 复用 home 数据 (足迹页未独立渲染模板)
                books, _ := getBooks(48)
                injectBookURLs(books, pseudoStyle)
                data["Books"] = books
                data["TopBooks"] = topBooks(books, 6)
                data["Popular"] = takeBooks(books, 12)
        default: // home
                books, _ := getBooks(48)
                injectBookURLs(books, pseudoStyle)
                data["Books"] = books
                data["TopBooks"] = topBooks(books, 6)
                data["Popular"] = takeBooks(books, 12)
        }

        tmplName := theme + "/" + view
        // R41-1B: 渲染前先校验模板存在; 失败时回退到 shipsay/home 而非"半写后报错"
        if tmpls.Lookup(tmplName) == nil {
                log.Printf("[homeHandler] template not found: %s, fallback to shipsay/home", tmplName)
                tmplName = "shipsay/home"
        }
        // 用 bytes.Buffer 先渲染, 失败时还能控制响应
        var buf strings.Builder
        if err := tmpls.ExecuteTemplate(&buf, tmplName, data); err != nil {
                log.Printf("[homeHandler] template render failed (tmpl=%s): %v", tmplName, err)
                // 回退 shipsay/home (兜底)
                if tmplName != "shipsay/home" {
                        var buf2 strings.Builder
                        if err2 := tmpls.ExecuteTemplate(&buf2, "shipsay/home", data); err2 == nil {
                                // R54-1A: 注入反馈浮窗 (开关在 Setting.feedbackEnabled)
                                if getFeedbackEnabled() {
                                        buf2.WriteString(feedbackWidgetHTML)
                                }
                                // R69-A: 若 Setting.obfuscateHTML=true 应用混淆 (fallback 路径用 "home" view)
                                siteDBID, _ := site["ID"].(string)
                                writeRenderedHTML(w, buf2.String(), siteDBID, "home")
                                return
                        }
                }
                http.Error(w, "模板渲染失败", 500)
                return
        }
        // R54-1A: 开关开启时在 </body> 前注入反馈浮窗 (前台所有 view 都走 homeHandler, 一处注入覆盖全部主题模板)
        if getFeedbackEnabled() {
                buf.WriteString(feedbackWidgetHTML)
        }
        // R69-A: 若 Setting.obfuscateHTML=true 应用混淆 (主渲染路径用原 view 构造 seed)
        siteDBID, _ := site["ID"].(string)
        writeRenderedHTML(w, buf.String(), siteDBID, view)
}

// R64-D: render404 渲染 templates/404.html (R64-A 创建模板), 失败时 fallback 到 http.NotFound.
//
//      data 字段: Site / Categories / HomeURL / PseudoStyle — 与 homeHandler 主流程注入字段一致,
//      供 404 模板渲染站点 nav + 首页链接 + 调试 meta (伪静态风格). site==nil 时无法渲染
//      (无 Site 数据), fallback http.NotFound 保留 R63 行为. 模板未加载时 (R64-A 未完成 /
//      ParseFiles 失败) 同样 fallback http.NotFound, 等 R64-A 完成后切换. /api/* 路径不进
//      homeHandler (由 admin/API handlers 处理), 不调此函数. 渲染走 strings.Builder 缓冲:
//      Execute 成功才写 w, 失败可安全 fallback http.NotFound (未写出任何 byte).
// R65-D BUG-48 (P3): 注入 "PseudoStyle" 字段. 原 R64-D 实现遗漏此 key, 404.html 模板
//      meta 行 {{if .PseudoStyle}} · 伪静态风格: {{.PseudoStyle}}{{end}} 因 key 缺失 →
//      nil 返 false → meta 行被静默跳过, 失去调试信息 (虽不破渲染). 修复: 与 homeHandler
//      主流程 data["PseudoStyle"] 对齐, 注入 pseudoStyle (default "query" 兜底).
//      同时移除 data["Title"] — 404.html 模板 <title> 用 {{.Site.Title}} 而非 {{.Title}},
//      原 R64-D 注入的 "Title" 是死字段从未被模板消费.
func render404(w http.ResponseWriter, r *http.Request, site map[string]interface{}) {
        if site == nil {
                http.NotFound(w, r)
                return
        }
        cats, _ := getCategories()
        pseudoStyle, _ := site["PseudoStaticStyle"].(string)
        if pseudoStyle == "" {
                pseudoStyle = "query"
        }
        data := map[string]interface{}{
                "Site":        site,
                "Categories":  cats,
                "HomeURL":     buildHomeURL(pseudoStyle),
                "PseudoStyle": pseudoStyle,
        }
        // R64 主控修复: 404.html 用 {{define "404"}} 块名, Lookup("404") 不是 "404.html"
        // (与 homeHandler 用 theme+"/"+view 块名约定一致, 如 "shipsay/home").
        if t := tmpls.Lookup("404"); t != nil {
                var buf strings.Builder
                if err := t.Execute(&buf, data); err == nil {
                        // R69-A: 若 Setting.obfuscateHTML=true 应用混淆 (404 页用 "404" view 构造 seed)
                        out := buf.String()
                        siteDBID, _ := site["ID"].(string)
                        if getObfuscateHTMLEnabled() && siteDBID != "" {
                                out = obfuscateHTML(out, obfuscateHTMLSeed(siteDBID, "404"))
                        }
                        w.Header().Set("Content-Type", "text/html; charset=utf-8")
                        w.WriteHeader(http.StatusNotFound)
                        w.Write([]byte(out))
                        return
                } else {
                        // Execute 失败 → log + fallback http.NotFound (未写出任何 byte, 可安全 fallback)
                        log.Printf("[homeHandler] 404 template render failed: %v", err)
                }
        }
        http.NotFound(w, r)
}

// ===== R69-A: HTML 混淆引擎 (obfuscateHTML) =====
//
// 背景: 模板渲染输出固定 HTML 结构 (固定 class 名 / 标签嵌套 / 属性顺序), 搜索引擎
//   爬虫看到所有页面结构相同 → 易被判重复内容 (duplicate content). 加 HTML 混淆器
//   在 homeHandler ExecuteTemplate 后对输出 HTML 做变换, 让每页 (per-seed) 输出结构
//   不同但视觉一致.
//
// 设计:
//   - obfuscateHTML(html, seed) 纯函数, seed 用 siteID + view + 5 分钟时间窗口
//     (同窗口同结果保缓存友好, 5 分钟外变化 → 蜘蛛看到结构轻微变化增反爬识别难度).
//   - 变换 1: class 名随机化 (HTML 所有 class="X" → class="RANDOM" + <style> 块内
//     .X 选择器同步 + <script> 块内 'X' 单 class 字符串字面量同步).
//   - 变换 2: 标签间插入随机 HTML 注释 (<!-- a3f7 -->) — 蜘蛛看到不同噪音.
//   - 变换 3: 标签间插入随机空白 (空格/换行, 不影响渲染).
//   - 保守跳过: 属性顺序变化 (低价值 + 风险高), div 包裹 (易破布局).
//
// 风险与约束:
//   - 外部 CSS (/clone-css/*.css 由 static handler 服务) 用原 class 名选择器; 若
//     admin 启用本功能, 渲染 HTML 的 class 被改名但 CSS 文件未改 → 样式失效. 保守
//     默认 false; admin 应仅在 inline <style> 模板站点或接受样式失效场景启用.
//     R70 主控可考虑拦截 /clone-css/*.css 请求 + 按 site class map 重写 CSS 文件
//     (per-site 稳定 map, 非 per-page 变化 map, 否则 CSS 缓存失效).
//   - 不破坏 <pre>/<code> (保留格式标签): 当前未实现 per-tag 跳过, 但变换只在
//     class 属性 + 标签间, <pre>/<code> 内文本若无 class 属性则天然不受影响.
//   - <script> 块内仅替换单 class 字符串字面量 ("X" 或 'X' 形态, 无空格); 多 class
//     字符串 ("X Y") 不替换 (防 className 赋值场景断 JS).
//
// 开关: Setting 表 key='obfuscateHTML' value='true'/'false' (默认 false).
//   wired into homeHandler (主路径 + 兜底 fallback 路径) + render404.

// R69-A: obfuscateHTMLSeed 用 siteID + view + 5 分钟时间窗口构造混淆种子.
//   返回值供 obfuscateHTML 内 RNG 用, 同窗口同结果 (缓存友好); 跨窗口变化 (蜘蛛
//   看到结构轻微变化, 增反爬识别难度).
func obfuscateHTMLSeed(siteID, view string) string {
        window := time.Now().Unix() / 300 // 5 分钟窗口 (300s)
        return siteID + ":" + view + ":" + strconv.FormatInt(window, 10)
}

// R69-A: obfuscateRNG — 自实现 FNV-1a + xorshift64* 种子化 RNG (零依赖).
//   math/rand 全局自动种子不可控; 用本结构保证同 seed 同输出 (缓存友好).
//   注: 不用 math/rand 标准库, 因其全局 PRNG 自 Go 1.20 起自动种子, 无法保证
//   跨进程同 seed 同输出 (即使 rand.NewSource 在进程内可复现, 跨进程仍依赖
//   种子值; 本实现完全自包含, 无外部依赖).
type obfuscateRNG struct {
        state uint64
}

// newObfuscateRNG 用 FNV-1a 64-bit hash 把字符串 seed 哈希成 uint64 状态.
func newObfuscateRNG(seed string) *obfuscateRNG {
        h := uint64(14695981039346656037) // FNV-1a 64-bit offset basis (标准值)
        for i := 0; i < len(seed); i++ {
                h ^= uint64(seed[i])
                h *= 1099511628211 // FNV-1a 64-bit prime
        }
        if h == 0 {
                h = 0xdeadbeefcafebabe // 防 0 状态 (xorshift 0 退化)
        }
        return &obfuscateRNG{state: h}
}

// next 返回下一个 64-bit 伪随机数 (xorshift64* Vigna 2014).
func (r *obfuscateRNG) next() uint64 {
        r.state ^= r.state >> 12
        r.state ^= r.state << 25
        r.state ^= r.state >> 27
        return r.state * 0x2545F4914F6CDD1D
}

// int63 返回非负 int64 (Go math/rand 兼容形态).
func (r *obfuscateRNG) int63() int64 {
        return int64(r.next() >> 1)
}

// intn 返回 [0, n) 范围伪随机数. n<=0 返 0.
func (r *obfuscateRNG) intn(n int) int {
        if n <= 0 {
                return 0
        }
        return int(r.int63() % int64(n))
}

// randomClassName 生成 5-8 字符 CSS 标识符 (首字符为字母, 后续字母数字).
//   首字符限字母 (CSS 标识符规则: 首字符不可数字), 后续字符可为字母/数字.
//   长度 5-8 在 CSS 中足够唯一防与现有 class 名冲突.
func (r *obfuscateRNG) randomClassName() string {
        const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        const alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        length := 5 + r.intn(4) // 5-8
        out := make([]byte, length)
        out[0] = letters[r.intn(len(letters))]
        for i := 1; i < length; i++ {
                out[i] = alnum[r.intn(len(alnum))]
        }
        return string(out)
}

// R69-A: 预编译正则 (包级, 防 per-request 重复编译开销).
var (
        // classAttrRE 匹配 class="..." 或 class='...' 属性 (单/双引号).
        //   捕获组 1 = 含引号完整值 (含引号), 2 = 双引号内容, 3 = 单引号内容.
        classAttrRE = regexp.MustCompile(`(?i)\bclass\s*=\s*("([^"]*)"|'([^']*)')`)
        // styleBlockRE 匹配 <style ...>...</style> 块 (含属性 + 内容). (?is) 跨行 + 不区分大小写.
        //   捕获组 1 = <style> 属性 (含前导空格, 如 ' type="text/css"'), 2 = 块内容.
        styleBlockRE = regexp.MustCompile(`(?is)<style\b([^>]*)>(.*?)</style>`)
        // scriptBlockRE 匹配 <script ...>...</script> 块. 同上形态.
        //   捕获组 1 = <script> 属性, 2 = 块内容.
        scriptBlockRE = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script>`)
        // tagBoundaryRE 匹配 ">" + 间空白 + "<" (标签间位置, 用于插注释/空白).
        //   捕获组 1 = 间空白.
        tagBoundaryRE = regexp.MustCompile(`>(\s*)<`)
        // tagBoundaryWsRE 仅匹配含至少 1 个空白字符的标签间位置.
        //   捕获组 1 = 间空白.
        tagBoundaryWsRE = regexp.MustCompile(`>(\s+)<`)
        // cssClassInStyleRE 在 CSS 文本中匹配 .classname 选择器.
        //   捕获组 1 = classname, 2 = 边界字符 (非标识符或行尾).
        cssClassInStyleRE = regexp.MustCompile(`\.([a-zA-Z_][a-zA-Z0-9_-]*)([^a-zA-Z0-9_-]|$)`)
)

// cssClassSelectorRE 为单个 class 名编译选择器匹配正则.
//   匹配 .classname 后跟非标识符字符或字符串结束 (捕获组 1 = 边界字符).
//   重写时回填边界字符保选择器完整. RE2 不支持 lookahead, 故用捕获组保留边界.
//   per-class 编译并缓存 (NewRegexp 复杂度低, obfuscateHTML 内复用).
func cssClassSelectorRE(className string) *regexp.Regexp {
        return regexp.MustCompile(`\.` + regexp.QuoteMeta(className) + `([^a-zA-Z0-9_-]|$)`)
}

// R69-A: collectHTMLClasses 扫描 HTML 所有 class="X Y Z" + <style> 内 .X 选择器,
//   返回所有原始 class 名集合 (用于构建 class 映射表).
func collectHTMLClasses(html string) map[string]bool {
        set := map[string]bool{}
        // 1. HTML class 属性值
        for _, m := range classAttrRE.FindAllStringSubmatch(html, -1) {
                val := m[2] // 双引号内容
                if val == "" {
                        val = m[3] // 单引号内容
                }
                for _, c := range strings.Fields(val) {
                        if c != "" {
                                set[c] = true
                        }
                }
        }
        // 2. <style> 块内 .classname 选择器 (inline style 属性不在 <style> 块内, 不受影响)
        for _, blk := range styleBlockRE.FindAllStringSubmatch(html, -1) {
                cssText := blk[2]
                for _, c := range cssClassInStyleRE.FindAllStringSubmatch(cssText, -1) {
                        if c[1] != "" {
                                set[c[1]] = true
                        }
                }
        }
        return set
}

// R69-A: obfuscateHTML 主混淆函数. 输入 HTML + seed, 返回混淆后 HTML.
//
//   变换流程:
//     1. 扫描所有 class 名 (HTML 属性 + <style> 选择器) → 构建随机映射表
//        (原 class → 随机 class, 同 seed 同映射保缓存友好)
//     2. 重写 HTML class 属性值 (class="a b" → class="X Y" 用映射)
//     3. 重写 <style> 块内 CSS 选择器 (.a → .X 同步映射)
//     4. 重写 <script> 块内单 class 字符串字面量 ("a" → "X" 同步映射)
//     5. 标签间插入随机 HTML 注释 (50% 概率, 防 5KB+ HTML 过度膨胀)
//     6. 标签间插入随机空白 (30% 概率, 1-2 个空格/换行)
//
//   注: 若 seed 为空 → 不混淆 (防 admin 测试误用导致无映射乱写).
//   注: 若 html 无任何 class 名 → 跳过 2/3/4 步, 仅做 5/6 步 (注释/空白注入).
func obfuscateHTML(html, seed string) string {
        if html == "" || seed == "" {
                return html
        }
        rng := newObfuscateRNG(seed)

        // 1. 构建 class 映射表 (原 class → 随机 class, 按 class 名字典序迭代保确定性)
        //   注: Go map 迭代顺序不确定, 同 seed 不同 run 会给同 class 不同随机名 →
        //   RNG 状态演进不一致 → 后续 insertRandomTagComments/jitterTagWhitespace 输出不一致
        //   → 缓存失效. 排序后同 seed 同映射 + 同 RNG 演进 → 输出完全确定性.
        classSet := collectHTMLClasses(html)
        sortedClasses := make([]string, 0, len(classSet))
        for c := range classSet {
                sortedClasses = append(sortedClasses, c)
        }
        sort.Strings(sortedClasses)
        classMap := make(map[string]string, len(sortedClasses))
        for _, orig := range sortedClasses {
                classMap[orig] = rng.randomClassName()
        }

        // 2. 重写 HTML class 属性值 (class="a b c" → class="X Y Z" 用 map)
        if len(classMap) > 0 {
                html = classAttrRE.ReplaceAllStringFunc(html, func(match string) string {
                        sub := classAttrRE.FindStringSubmatch(match)
                        if len(sub) < 4 {
                                return match
                        }
                        // sub[2] = 双引号内容, sub[3] = 单引号内容
                        quote := byte('"')
                        val := sub[2]
                        if val == "" {
                                val = sub[3]
                                quote = '\''
                        }
                        classes := strings.Fields(val)
                        renamed := make([]string, len(classes))
                        for i, c := range classes {
                                if r, ok := classMap[c]; ok && r != "" {
                                        renamed[i] = r
                                } else {
                                        renamed[i] = c // 未知 class 保留原样 (防误改)
                                }
                        }
                        return "class=" + string(quote) + strings.Join(renamed, " ") + string(quote)
                })
        }

        // 3. 重写 <style> 块内 CSS 选择器 (.classname → .random, 同步映射)
        if len(classMap) > 0 {
                html = styleBlockRE.ReplaceAllStringFunc(html, func(match string) string {
                        sub := styleBlockRE.FindStringSubmatch(match)
                        if len(sub) < 3 {
                                return match
                        }
                        // sub[1] = <style> 属性, sub[2] = 块内容
                        cssText := sub[2]
                        for orig, rand := range classMap {
                                if orig == "" || rand == "" {
                                        continue
                                }
                                re := cssClassSelectorRE(orig)
                                cssText = re.ReplaceAllString(cssText, "."+rand+"${1}")
                        }
                        return "<style" + sub[1] + ">" + cssText + "</style>"
                })
        }

        // 4. 重写 <script> 块内单 class 字符串字面量 (querySelector(".X") 等)
        if len(classMap) > 0 {
                html = scriptBlockRE.ReplaceAllStringFunc(html, func(match string) string {
                        sub := scriptBlockRE.FindStringSubmatch(match)
                        if len(sub) < 3 {
                                return match
                        }
                        jsText := sub[2]
                        for orig, rand := range classMap {
                                if orig == "" || rand == "" {
                                        continue
                                }
                                // 4a. Bare class string literal: "X" or 'X' (e.g. getElementsByClassName("X"))
                                bareDoubleRE := regexp.MustCompile(`"` + regexp.QuoteMeta(orig) + `"`)
                                jsText = bareDoubleRE.ReplaceAllString(jsText, `"`+rand+`"`)
                                bareSingleRE := regexp.MustCompile(`'` + regexp.QuoteMeta(orig) + `'`)
                                jsText = bareSingleRE.ReplaceAllString(jsText, `'`+rand+`'`)
                                // 4b. CSS selector string literal: ".X" or '.X' (e.g. querySelector(".X"))
                                //     多 class/compound selector ("body.X" / ".X.Y") 不替换 (防断 JS)
                                selDoubleRE := regexp.MustCompile(`"\.` + regexp.QuoteMeta(orig) + `"`)
                                jsText = selDoubleRE.ReplaceAllString(jsText, `".`+rand+`"`)
                                selSingleRE := regexp.MustCompile(`'\.` + regexp.QuoteMeta(orig) + `'`)
                                jsText = selSingleRE.ReplaceAllString(jsText, `'.`+rand+`'`)
                        }
                        return "<script" + sub[1] + ">" + jsText + "</script>"
                })
        }

        // 5. 标签间插入随机 HTML 注释 (50% 概率)
        html = insertRandomTagComments(html, rng)

        // 6. 标签间插入随机空白 (30% 概率, 1-2 字符)
        html = jitterTagWhitespace(html, rng)

        return html
}

// insertRandomTagComments 在标签间 (" > <" 模式) 插入随机 HTML 注释.
//   正则匹配 ">" + 间空白 + "<", 50% 概率插注释. 注释内容 5-8 字符随机
//   (CSS 标识符形态, 蜘蛛看到不同噪音). 保留原空白 + 注释, 不影响渲染.
func insertRandomTagComments(html string, rng *obfuscateRNG) string {
        return tagBoundaryRE.ReplaceAllStringFunc(html, func(match string) string {
                sub := tagBoundaryRE.FindStringSubmatch(match)
                ws := ""
                if len(sub) >= 2 {
                        ws = sub[1]
                }
                // 50% 概率插注释 (防 5KB+ HTML 过度膨胀 + 100% 概率致爬虫识别 "恒定注释密度" 指纹)
                if rng.intn(2) == 0 {
                        comment := "<!--" + rng.randomClassName() + "-->"
                        return ">" + ws + comment + "<"
                }
                return match
        })
}

// jitterTagWhitespace 在标签间追加 0-2 个随机空白字符 (空格/换行).
//   30% 概率追加 (与 insertRandomTagComments 协同, 进一步打散结构).
//   仅在含至少 1 个原空白的位置追加 (避免在无空白标签间硬插, 防 HTML 紧凑区变松).
func jitterTagWhitespace(html string, rng *obfuscateRNG) string {
        return tagBoundaryWsRE.ReplaceAllStringFunc(html, func(match string) string {
                sub := tagBoundaryWsRE.FindStringSubmatch(match)
                if len(sub) < 2 {
                        return match
                }
                ws := sub[1]
                if rng.intn(10) < 3 { // 30% 概率追加
                        n := 1 + rng.intn(2) // 1-2 个
                        extra := make([]byte, 0, n)
                        for i := 0; i < n; i++ {
                                if rng.intn(2) == 0 {
                                        extra = append(extra, ' ')
                                } else {
                                        extra = append(extra, '\n')
                                }
                        }
                        return ">" + ws + string(extra) + "<"
                }
                return match
        })
}

// R69-A: getObfuscateHTMLEnabled 读 Setting 表 obfuscateHTML 全局开关 (默认 false).
//   与 getFeedbackEnabled 同款模式 (admin.go). value 存储格式: JSON 编码
//   ("true"/"false") 或 raw 字符串 ("true"/"false"). 缺失或非 "true" 均视为 false.
//   每次 homeHandler 渲染调用一次 (SQLite 单行查询, <0.1ms, 不需缓存层).
func getObfuscateHTMLEnabled() bool {
        var v string
        err := db.QueryRow(`SELECT value FROM Setting WHERE key='obfuscateHTML'`).Scan(&v)
        if err != nil || v == "" {
                return false
        }
        // 优先解析 JSON (admin settings 存 JSON 编码)
        var parsed interface{}
        if json.Unmarshal([]byte(v), &parsed) == nil {
                if b, ok := parsed.(bool); ok {
                        return b
                }
        }
        return v == "true"
}

// R69-A: writeRenderedHTML 写 HTML 响应, 若 Setting.obfuscateHTML=true 应用混淆.
//   homeHandler + render404 共享此 helper, 避免重复 if-else 逻辑.
//   siteID/view 用于构造 seed (5 分钟窗口); 若二者均空 → 不混淆 (防 admin 测试误用).
func writeRenderedHTML(w http.ResponseWriter, html, siteID, view string) {
        if getObfuscateHTMLEnabled() && siteID != "" {
                html = obfuscateHTML(html, obfuscateHTMLSeed(siteID, view))
        }
        w.Header().Set("Content-Type", "text/html; charset=utf-8")
        w.Write([]byte(html))
}

// R64-D: per-book/chapter/category URL 注入 helpers.
//
//      设计: 在 homeHandler 各 view 装配 data 时, 给 books/chapters slice 每项 map 加 ["URL"] 字段,
//      供模板用 {{.URL}} 占位符替代硬编码 /?view=book&id={{.id}}. pseudoStyle 来自 getSite (R63-A),
//      保留 query 串模式兼容 (buildBookURL 等 builder 在 style="query" 时返回 /?view=book&id=... 形态).
//      injectBookURL 注入单本书 map; injectBookURLs 注入 slice; injectChapterURLs 注入章节 slice;
//      injectCategoryURLs 注入分类 slice (cats + navCats 共享底层数组, 单次遍历覆盖两者).

// injectBookURL 给单本书 map 注入 ["URL"] = buildBookURL(style, bookID).
func injectBookURL(book map[string]interface{}, style string) {
        if book == nil {
                return
        }
        if id, ok := book["id"].(string); ok && id != "" {
                book["URL"] = buildBookURL(style, id)
        }
}

// injectBookURLs 给 books slice 每项注入 ["URL"] = buildBookURL(style, bookID).
func injectBookURLs(books []map[string]interface{}, style string) {
        for _, b := range books {
                injectBookURL(b, style)
        }
}

// injectChapterURLs 给 chapters slice 每项注入 ["URL"] = buildChapterURL(style, chID, bookID).
//
//      bookID 是宿主书的 ID (用于 dir 风格 /book/{bookID}/chapter/{chID}.html); 章节列表中每项都属同一本书.
func injectChapterURLs(chapters []map[string]interface{}, style, bookID string) {
        for _, c := range chapters {
                if c == nil {
                        continue
                }
                if id, ok := c["id"].(string); ok && id != "" {
                        c["URL"] = buildChapterURL(style, id, bookID)
                }
        }
}

// injectCategoryURLs 给分类 slice 每项注入 ["URL"] = buildCategoryURL(style, catID, 1) (首页).
func injectCategoryURLs(cats []map[string]interface{}, style string) {
        for _, c := range cats {
                if c == nil {
                        continue
                }
                if id, ok := c["id"].(string); ok && id != "" {
                        c["URL"] = buildCategoryURL(style, id, 1)
                }
        }
}

// pageListWithURLs 把 buildPageList 返回的 []int 转 []map[string]interface{}{page, URL}.
//
//      urlBuilder 是 per-view 闭包 (category 用 buildCategoryURL, ranking/fulltext 用 buildPagerURL).
//      让分页列表每项既有页号又有 URL, 供模板用 {{range .PageList}}<a href="{{.URL}}">{{.page}}</a>{{end}}.
func pageListWithURLs(pages []int, urlBuilder func(int) string) []map[string]interface{} {
        out := make([]map[string]interface{}, 0, len(pages))
        for _, p := range pages {
                out = append(out, map[string]interface{}{
                        "page": p,
                        "URL":  urlBuilder(p),
                })
        }
        return out
}

// R64-D BUG-31: maxPaginationOffset 是 getCategoryViewData/getRankingViewData/getFulltextViewData 内部
//
//      OFFSET 的硬上限 (10000). 超出后 SQL 返回 offset=10000 处的数据, 与用户请求的页号不匹配 → 显示
//      "page 500 of 500" 但数据是 page 417 的. homeHandler 用此常量算 maxPages = maxOffset/size + 1,
//      cap totalPages 防止用户跳过 cap 页 (page > maxPages 时 totalPages=maxPages, page clamp 到 maxPages).
const maxPaginationOffset = 10000

// R54-1A: feedbackWidgetHTML — 前台浮窗反馈按钮 (右下角固定定位, inline 样式避免依赖主题 CSS 变量).
//
//   1. 浮动按钮 💬 反馈 — 点击展开模态框
//   2. 模态框: type select + content textarea + contact input + 提交按钮
//   3. JS: POST /api/feedback, 关闭模态框 + Toast 反馈成功/失败
//   4. z-index 极高 (2147483000) 保证不被主题样式遮盖; inline style + IIFE 不污染全局作用域
//
// 注入策略: homeHandler 在 ExecuteTemplate 后追加到响应 buffer 末尾 (即 </html> 之后).
//   浏览器对 </html> 后的内容容错渲染, 模态框 fixed 定位 + z-index 保证视觉一致.
//   该常量全静态, 无用户可控字段, 无注入风险.
var feedbackWidgetHTML = `
<div id="heis-fb-root" style="position:fixed;bottom:18px;right:18px;z-index:2147483000;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;">
  <button id="heis-fb-btn" type="button" onclick="document.getElementById('heis-fb-modal').style.display='block'" style="background:#1f6feb;color:#fff;border:0;border-radius:28px;padding:10px 18px;box-shadow:0 4px 12px rgba(0,0,0,.18);cursor:pointer;font-size:14px;font-weight:600;letter-spacing:.5px;">💬 反馈</button>
  <div id="heis-fb-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);" onclick="if(event.target===this)this.style.display='none'">
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;color:#222;border-radius:10px;padding:20px;width:92%;max-width:440px;box-shadow:0 12px 32px rgba(0,0,0,.22);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h3 style="margin:0;font-size:16px;font-weight:700;">用户反馈</h3>
        <button type="button" onclick="document.getElementById('heis-fb-modal').style.display='none'" style="background:transparent;border:0;font-size:18px;color:#666;cursor:pointer;line-height:1;">✕</button>
      </div>
      <form id="heis-fb-form" onsubmit="return heisFbSubmit(event)">
        <label style="display:block;font-size:12px;color:#555;margin-bottom:4px;">类型 <span style="color:#c00;">*</span></label>
        <select id="heis-fb-type" name="type" required style="width:100%;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;margin-bottom:10px;">
          <option value="bug">Bug 报告</option>
          <option value="suggestion">建议</option>
          <option value="praise">表扬</option>
          <option value="other">其它</option>
        </select>
        <label style="display:block;font-size:12px;color:#555;margin-bottom:4px;">内容 <span style="color:#c00;">*</span> <span style="color:#999;">(最多 2000 字)</span></label>
        <textarea id="heis-fb-content" name="content" required maxlength="2000" rows="5" placeholder="请描述您遇到的问题或建议..." style="width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;resize:vertical;min-height:90px;margin-bottom:10px;box-sizing:border-box;"></textarea>
        <label style="display:block;font-size:12px;color:#555;margin-bottom:4px;">联系方式 <span style="color:#999;">(选填, 邮箱/QQ)</span></label>
        <input id="heis-fb-contact" name="contact" type="text" maxlength="100" placeholder="选填" style="width:100%;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;margin-bottom:12px;box-sizing:border-box;">
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" onclick="document.getElementById('heis-fb-modal').style.display='none'" style="padding:7px 16px;border:1px solid #ccc;background:#f5f5f5;color:#333;border-radius:6px;cursor:pointer;font-size:13px;">取消</button>
          <button type="submit" id="heis-fb-submit" style="padding:7px 18px;background:#1f6feb;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">提交</button>
        </div>
      </form>
    </div>
  </div>
  <div id="heis-fb-toast" style="display:none;position:fixed;bottom:80px;right:18px;left:18px;max-width:380px;margin-left:auto;background:#0a7d3a;color:#fff;padding:10px 14px;border-radius:6px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.2);"></div>
</div>
<script>(function(){
  window.heisFbSubmit=function(e){
    e.preventDefault();
    var btn=document.getElementById('heis-fb-submit');
    if(btn){btn.disabled=true;btn.textContent='提交中...';}
    var type=document.getElementById('heis-fb-type').value;
    var content=document.getElementById('heis-fb-content').value.trim();
    var contact=document.getElementById('heis-fb-contact').value.trim();
    if(!content){heisFbToast('请填写反馈内容',false);if(btn){btn.disabled=false;btn.textContent='提交';}return false;}
    var body={type:type,content:content,contact:contact,url:location.href};
    fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json();})
      .then(function(j){
        if(j&&j.ok){heisFbToast('感谢反馈! 已提交',true);document.getElementById('heis-fb-modal').style.display='none';document.getElementById('heis-fb-content').value='';document.getElementById('heis-fb-contact').value='';}
        else{heisFbToast('提交失败: '+(j&&j.error||''),false);}
      })
      .catch(function(err){heisFbToast('网络错误: '+err.message,false);})
      .finally(function(){if(btn){btn.disabled=false;btn.textContent='提交';}});
    return false;
  };
  window.heisFbToast=function(msg,ok){
    var t=document.getElementById('heis-fb-toast');if(!t)return;
    t.textContent=msg;t.style.background=ok?'#0a7d3a':'#c0392b';t.style.display='block';
    clearTimeout(window.__heisFbToastT);window.__heisFbToastT=setTimeout(function(){t.style.display='none';},2800);
  };
})();
</script>
`

func healthHandler(w http.ResponseWriter, r *http.Request) {
        writeJSON(w, map[string]interface{}{"ok": true, "lang": "go", "memMB": getMemMB()})
}

func booksHandler(w http.ResponseWriter, r *http.Request) {
        books, _ := getBooks(48)
        writeJSON(w, map[string]interface{}{"ok": true, "data": map[string]interface{}{"books": books, "total": len(books)}})
}

func categoriesHandler(w http.ResponseWriter, r *http.Request) {
        cats, _ := getCategories()
        writeJSON(w, map[string]interface{}{"ok": true, "data": map[string]interface{}{"items": cats}})
}

func sitesHandler(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query(`SELECT id, name, domain, themeId, isDefault, title, description, keywords FROM Site WHERE status = 1`)
        if err != nil {
                writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
                return
        }
        defer rows.Close()
        sites := []map[string]interface{}{}
        for rows.Next() {
                var id, name, domain, themeID, title, desc, kw string
                var isDefault bool
                rows.Scan(&id, &name, &domain, &themeID, &isDefault, &title, &desc, &kw)
                sites = append(sites, map[string]interface{}{"id": id, "name": name, "domain": domain, "themeId": themeID, "isDefault": isDefault, "title": title, "description": desc, "keywords": kw})
        }
        writeJSON(w, map[string]interface{}{"ok": true, "data": sites})
}

func bookDetailHandler(w http.ResponseWriter, r *http.Request) {
        id := r.URL.Query().Get("id")
        if id == "" {
                writeJSON(w, map[string]interface{}{"ok": false, "error": "缺少 id 参数"})
                return
        }
        var bid, name, author, intro, cover, status, latestChapter, category, categoryID, updatedAt sql.NullString
        var wordCount int64
        err := db.QueryRow(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.id=?`, id).Scan(
                &bid, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &updatedAt)
        if err != nil {
                // R41-1B: 区分 not found vs DB 错误, 不暴露内部细节
                if err == sql.ErrNoRows {
                        writeJSON(w, map[string]interface{}{"ok": false, "error": "book not found"})
                        return
                }
                log.Printf("[bookDetailHandler] DB error for id=%s: %v", id, err)
                writeJSON(w, map[string]interface{}{"ok": false, "error": "查询失败"})
                return
        }
        writeJSON(w, map[string]interface{}{"ok": true, "data": map[string]interface{}{
                "id": bid.String, "name": name.String, "author": author.String, "intro": intro.String, "cover": coverURL(cover.String),
                "status": status.String, "wordCount": wordCount, "latestChapter": latestChapter.String,
                "category": category.String, "categoryId": categoryID.String, "updatedAt": formatUpdatedAt(updatedAt.String),
        }})
}

func chapterHandler(w http.ResponseWriter, r *http.Request) {
        id := r.URL.Query().Get("id")
        if id == "" {
                writeJSON(w, map[string]interface{}{"ok": false, "error": "缺少 id 参数"})
                return
        }
        // R65-D BUG-50 (P1): content 是 nullable 列 (Chapter schema: `content String?`),
        //   txt-mode 章节正常态 content=NULL (storage='txt', filePath 指向磁盘文件).
        //   原实现 Scan 进 plain string — NULL 时 Scan 返
        //   "sql: Scan error on column index 2: converting NULL to string is unsupported"
        //   → chapterHandler 把"txt-mode 章节"误判为 500 错误返 "查询失败",
        //   /api/public/chapter?id=txt-mode-chapter 永远 500, 前台 read view 切到 txt
        //   章节时无法拿 JSON 走章节内容. 修复: content 用 sql.NullString, title/id/idx
        //   仍 plain (schema 均非 null). 与 getReadViewData 同款 NullString 处理.
        var chID, title string
        var content sql.NullString
        var idx int
        err := db.QueryRow(`SELECT id, title, content, idx FROM Chapter WHERE id=?`, id).Scan(&chID, &title, &content, &idx)
        if err != nil {
                // R41-1B: 区分 not found vs DB 错误, 不暴露内部细节
                if err == sql.ErrNoRows {
                        writeJSON(w, map[string]interface{}{"ok": false, "error": "chapter not found"})
                        return
                }
                log.Printf("[chapterHandler] DB error for id=%s: %v", id, err)
                writeJSON(w, map[string]interface{}{"ok": false, "error": "查询失败"})
                return
        }
        writeJSON(w, map[string]interface{}{"ok": true, "data": map[string]interface{}{"id": chID, "title": title, "content": content.String, "idx": idx}})
}

// ===== 数据查询 =====

// getSite — 取 Site 行 (status=1). 默认 (siteID=="") 取 isDefault=1, 否则按 ID.
//  R57-1B 接入智能 TDK: SELECT 加 chapterSeoAuto + chapterSeoTitleTemplate +
//    chapterSeoDescTemplate + chapterSeoKeywordsTemplate 字段 (供 getReadViewData 消费).
//  R63-A 接入伪静态: SELECT 加 pseudoStaticStyle 字段 (供 homeHandler 伪静态 URL 解析 +
//    模板层 URL builder 消费). 其它 R16/R22 字段 (chapterPaginationMode/navCategoryCount/等)
//    留给后续轮次按需扩展 SELECT (本轮只加 pseudoStaticStyle 一列, 不动其它).
func getSite(siteID string) (map[string]interface{}, error) {
        q := `SELECT id,name,domain,themeId,isDefault,title,description,keywords,offset,chapterSeoAuto,chapterSeoTitleTemplate,chapterSeoDescTemplate,chapterSeoKeywordsTemplate,pseudoStaticStyle FROM Site WHERE status=1`
        var rows *sql.Rows
        var err error
        if siteID != "" {
                rows, err = db.Query(q+` AND id=?`, siteID)
        } else {
                rows, err = db.Query(q + ` AND isDefault=1`)
        }
        if err != nil {
                return nil, err
        }
        defer rows.Close()
        // R67-D: 改 for→if (rows.Scan + return 在首轮迭代执行后必返, staticcheck SA4004
        //   标识 "loop unconditionally terminated". SQL 上 AND id=? 主键过滤 / AND
        //   isDefault=1 至多 1 行 (isDefault 应唯一, DB 不强约束但实际唯一); 取首行即返.)
        if rows.Next() {
                var id, name, domain, themeID, title, desc, kw, seoTmplT, seoTmplD, seoTmplK, pseudoStaticStyle string
                var isDefault bool
                var offset int
                var seoAuto bool
                rows.Scan(&id, &name, &domain, &themeID, &isDefault, &title, &desc, &kw, &offset, &seoAuto, &seoTmplT, &seoTmplD, &seoTmplK, &pseudoStaticStyle)
                if pseudoStaticStyle == "" {
                        pseudoStaticStyle = "query"
                }
                return map[string]interface{}{"ID": id, "Name": name, "Domain": domain, "ThemeID": themeID, "IsDefault": isDefault, "Title": title, "Description": desc, "Keywords": kw, "Offset": offset, "ChapterSeoAuto": seoAuto, "ChapterSeoTitleTemplate": seoTmplT, "ChapterSeoDescTemplate": seoTmplD, "ChapterSeoKeywordsTemplate": seoTmplK, "PseudoStaticStyle": pseudoStaticStyle}, nil
        }
        // fallback 第一个 (R42-1A: 显式 err 检查防 nil rows2.Close() panic; 之前 _ 忽略 err →
        //                  若 db.Query 失败 rows2 为 nil, defer rows2.Close() 在 nil 上调用 panic)
        rows2, qErr := db.Query(q + ` LIMIT 1`)
        if qErr != nil {
                return nil, qErr
        }
        defer rows2.Close()
        // R67-D: 改 for→if (同上; LIMIT 1 保证至多 1 行, staticcheck SA4004 标识.)
        if rows2.Next() {
                var id, name, domain, themeID, title, desc, kw, seoTmplT, seoTmplD, seoTmplK, pseudoStaticStyle string
                var isDefault bool
                var offset int
                var seoAuto bool
                rows2.Scan(&id, &name, &domain, &themeID, &isDefault, &title, &desc, &kw, &offset, &seoAuto, &seoTmplT, &seoTmplD, &seoTmplK, &pseudoStaticStyle)
                if pseudoStaticStyle == "" {
                        pseudoStaticStyle = "query"
                }
                return map[string]interface{}{"ID": id, "Name": name, "Domain": domain, "ThemeID": themeID, "IsDefault": isDefault, "Title": title, "Description": desc, "Keywords": kw, "Offset": offset, "ChapterSeoAuto": seoAuto, "ChapterSeoTitleTemplate": seoTmplT, "ChapterSeoDescTemplate": seoTmplD, "ChapterSeoKeywordsTemplate": seoTmplK, "PseudoStaticStyle": pseudoStaticStyle}, nil
        }
        return nil, nil
}

// computeChapterSeo — 按站点 chapterSeoAuto + chapterSeoTitleTemplate 等算 SEO TDK.
//  R57-1B 接入智能 TDK. 占位符 (chapterSeoAuto=false 用户模板): {bookName} {chapterTitle}
//    {page} {totalPages} {siteName}.
//  chapterSeoAuto=true (默认): 用与原模板硬编码一致的字段组合 (site.Title / site.Keywords
//    / book.author), 与原模板 `{{.Chapter.title}} - {{.Book.name}} - {{.Site.Title}}` /
//    `{{.Book.name}},{{.Chapter.title}},{{.Book.author}},{{.Site.Keywords}}` /
//    `{{.Book.name}}{{.Chapter.title}}全文阅读,{{.Book.intro}}` 字段口径对齐, 保持向后
//    兼容 (chapterSeoAuto=true 渲染结果与原硬编码一致, 不引入 {siteName} 占位符歧义).
//  chapterSeoAuto=false: 用 chapterSeoTitleTemplate 等用户模板 (替换 {bookName}
//    {chapterTitle} {page} {totalPages} {siteName} 占位符); 空模板 fallback 默认.
//  注: page/totalPages 当前 Go 端不分页 (chapterPaginationMode=off), 占位符 {page}/{totalPages} 用 1/1.
//  注: 101kks 原用 `全文閱讀` 繁体 + ggd66/x2552 原 description 缺 intro, 默认模板
//    用 `全文阅读` 简体 + 含 intro — 站点繁简差异 (101kks 不再是繁体 description) +
//    description 内容增强 (ggd66/x2552 多 100 字 intro), 不算 bug.
func computeChapterSeo(site map[string]interface{}, chapterTitle, bookName, bookAuthor, bookIntro string) (string, string, string) {
        siteTitle, _ := site["Title"].(string)
        siteName, _ := site["Name"].(string)
        siteKeywords, _ := site["Keywords"].(string)
        if siteName == "" {
                siteName = siteTitle
        }
        page := 1
        totalPages := 1
        seoAuto, _ := site["ChapterSeoAuto"].(bool)
        titleTmpl, _ := site["ChapterSeoTitleTemplate"].(string)
        descTmpl, _ := site["ChapterSeoDescTemplate"].(string)
        kwTmpl, _ := site["ChapterSeoKeywordsTemplate"].(string)
        // 截断 intro (desc 默认模板拼 intro, 防超长; 用户 desc 模板用户自负)
        intro := bookIntro
        if len([]rune(intro)) > 100 {
                intro = string([]rune(intro)[:100])
        }
        // chapterSeoAuto=true 或三个模板全空: 用默认 (与原模板硬编码一致)
        defaultTitle := chapterTitle + " - " + bookName + " - " + siteTitle
        defaultDesc := bookName + chapterTitle + "全文阅读," + intro
        defaultKw := bookName + "," + chapterTitle + "," + bookAuthor
        if siteKeywords != "" {
                defaultKw += "," + siteKeywords
        }
        if seoAuto || (titleTmpl == "" && descTmpl == "" && kwTmpl == "") {
                // R69-A: 应用关键词转码 (Setting.keywordTranscode != "off" 时)
                return transcodeChapterSeoOutput(defaultTitle, defaultDesc, defaultKw)
        }
        // chapterSeoAuto=false 且至少一个模板非空: 用用户模板 (占位符替换); 空模板 fallback 默认
        apply := func(tmpl, defaultVal string) string {
                if tmpl == "" {
                        return defaultVal
                }
                out := tmpl
                out = strings.ReplaceAll(out, "{bookName}", bookName)
                out = strings.ReplaceAll(out, "{chapterTitle}", chapterTitle)
                out = strings.ReplaceAll(out, "{page}", fmt.Sprintf("%d", page))
                out = strings.ReplaceAll(out, "{totalPages}", fmt.Sprintf("%d", totalPages))
                out = strings.ReplaceAll(out, "{siteName}", siteName)
                return out
        }
        // R69-A: 应用关键词转码 (Setting.keywordTranscode != "off" 时)
        return transcodeChapterSeoOutput(apply(titleTmpl, defaultTitle), apply(descTmpl, defaultDesc), apply(kwTmpl, defaultKw))
}

// ===== R69-A: 关键词转码 (transcodeKeyword) =====
//
// 背景: TDK (title/description/keywords) + 正文关键词明文显示, 搜索引擎易判敏感词
//   审核. 加关键词转码器在 computeChapterSeo 输出阶段对 TDK 关键词转码, 让搜索引擎
//   看到的关键词与人类阅读的略有差异, 降审核风险.
//
// 模式 (mode):
//   - "off"        — passthrough (默认)
//   - "split"     — 字符间插可见空格: "免费小说" → "免 费 小 说"
//   - "homophone"  — 同音字替换常见敏感词 (内置 ~30 词字典): "免费" → "免菲"
//   - "pinyin"     — 拼音替换常见敏感词: "免费" → "mianfei"
//   - "mixed"      — 随机混合 (split + homophone + pinyin per word 确定性 hash)
//   - "zwsp"      — 字符间插零宽空格 U+200B (视觉不可见, 蜘蛛分词被扰)
//
// 设计:
//   - transcodeKeyword(s, mode) 纯函数, 不读 DB.
//   - split/zwsp 对全字符串逐字符插分隔符 (覆盖所有字符, 非仅敏感词).
//   - homophone/pinyin/mixed 仅替换字典内的敏感词, 非敏感词保留原样 (避免破坏正常
//     TDK 可读性, admin 可控范围).
//   - mixed 模式 per word 确定性 hash 选模式 (同 word 同输出, 避免缓存闪变).
//   - 字典 ~30 词覆盖常见中文小说站敏感词 (免费/小说/完结/下载/全文/笔趣阁 等).
//
// 开关: Setting 表 key='keywordTranscode' value='off'/'split'/'homophone'/'pinyin'/
//   'mixed'/'zwsp' (默认 off). wired into computeChapterSeo 输出 (title/desc/keywords).
//   注: 仅 TDK 转码; 正文 (chapter content) 转码会破坏用户阅读, 本轮不做 (留 R70+).

// R69-A: transcodeEntry 一条敏感词的转码选项.
type transcodeEntry struct {
        homophone string // 同音字替换 (空 = 该词无合适同音字, homophone 模式跳过)
        pinyin    string // 拼音替换 (小写无音调)
}

// R69-A: sensitiveWordDict 内置敏感词字典 (~30 词). 覆盖中文小说站常见敏感词.
//   注: 同音字为人工挑选 (尽量贴近原音 + 视觉相似); 部分词无合适同音字则空.
//   注: pinyin 为人工输入 (常见词, 不引 pinyin 库保零依赖).
//   注: 长词优先替换 (transcodeDictReplace 按 rune 长度降序遍历), 防短词嵌入长词
//     内被先替换 (e.g. "免费小说" 优先匹配整词, 而非 "免费"+"小说" 拆分).
var sensitiveWordDict = map[string]transcodeEntry{
        "免费":    {"免菲", "mianfei"},
        "小说":    {"小孰", "xiaoshuo"},
        "完结":    {"完杰", "wanjie"},
        "下载":    {"下咱", "xiazai"},
        "全文":    {"全闻", "quanwen"},
        "阅读":    {"阅度", "yuedu"},
        "电子书":   {"电子孰", "dianzishu"},
        "漫画":    {"慢画", "manhua"},
        "破解":    {"破戒", "pojie"},
        "无删减":   {"无删减", "wushanjian"},
        "无广告":   {"无广哢", "wuguanggao"},
        "在线阅读":  {"在仙阅度", "zaixianyuedu"},
        "全文阅读":  {"全闻阅度", "quanwenyuedu"},
        "完整版":   {"完整阪", "wanzhengban"},
        "笔趣阁":   {"笔趣搁", "biquge"},
        "无弹窗":   {"无弹窗", "wudanchuang"},
        "藏经阁":   {"藏经搁", "cangjinge"},
        "笔趣":    {"笔趣", "biqu"},
        "金庸":    {"金墉", "jinyong"},
        "黄色":    {"簧色", "huangse"},
        "色情":    {"瑟情", "seqing"},
        "成人":    {"成仁", "chengren"},
        "福利":    {"福利", "fuli"},
        "资源":    {"资元", "ziyuan"},
        "破解版":   {"破戒阪", "pojieban"},
        "免费小说":  {"免菲小孰", "mianfeixiaoshuo"},
        "完整版小说": {"完整阪小孰", "wanzhengbanxiaoshuo"},
        "电子书下载": {"电子孰下咱", "dianzishuxiazai"},
        "最新章节":  {"最新章劫", "zuixinzhangjie"},
        "txt":    {"", "txt"},
        "TXT":    {"", "txt"},
}

// sortedSensitiveDictKeys 返回字典 key 按 rune 长度降序排列 (长词优先替换).
//   每次 transcodeDictReplace / transcodeMixed 调用一次, 字典小 (~30 词) 故开销可忽略.
func sortedSensitiveDictKeys() []string {
        keys := make([]string, 0, len(sensitiveWordDict))
        for k := range sensitiveWordDict {
                keys = append(keys, k)
        }
        // 简单 bubble sort by rune length desc (字典 < 50 词, O(n^2) 可接受)
        for i := 0; i < len(keys); i++ {
                for j := i + 1; j < len(keys); j++ {
                        if len([]rune(keys[j])) > len([]rune(keys[i])) {
                                keys[i], keys[j] = keys[j], keys[i]
                        }
                }
        }
        return keys
}

// R69-A: transcodeKeyword 对关键词字符串应用转码. 纯函数.
//   mode = "" / "off" → passthrough.
//   mode = "split" → 字符间插可见空格.
//   mode = "zwsp" → 字符间插零宽空格 U+200B (视觉不可见).
//   mode = "homophone" / "pinyin" → 仅替换字典内敏感词.
//   mode = "mixed" → 每个字典词用确定性 hash 选 homophone/pinyin/zwsp/passthrough.
//   未知 mode → passthrough (保守不破坏).
func transcodeKeyword(s, mode string) string {
        if s == "" {
                return s
        }
        switch mode {
        case "", "off":
                return s
        case "split":
                return transcodeSplitVisible(s)
        case "zwsp":
                return transcodeZWSP(s)
        case "homophone":
                return transcodeDictReplace(s, "homophone")
        case "pinyin":
                return transcodeDictReplace(s, "pinyin")
        case "mixed":
                return transcodeMixed(s)
        }
        return s // 未知 mode → passthrough
}

// transcodeSplitVisible 在每个字符间插可见空格 (U+0020).
//   "免费小说" → "免 费 小 说". CJK + latin 均适用.
func transcodeSplitVisible(s string) string {
        runes := []rune(s)
        if len(runes) <= 1 {
                return s
        }
        var b strings.Builder
        b.Grow(len(s) + len(runes))
        for i, r := range runes {
                if i > 0 {
                        b.WriteByte(' ')
                }
                b.WriteRune(r)
        }
        return b.String()
}

// transcodeZWSP 在每个字符间插零宽空格 (U+200B). 视觉不可见, 蜘蛛分词被扰.
//   "免费小说" → "免\u200B费\u200B小\u200B说" (显示仍为 "免费小说").
func transcodeZWSP(s string) string {
        runes := []rune(s)
        if len(runes) <= 1 {
                return s
        }
        var b strings.Builder
        b.Grow(len(s) + len(runes)*3) // U+200B 是 3 bytes UTF-8
        for i, r := range runes {
                if i > 0 {
                        b.WriteRune('\u200B')
                }
                b.WriteRune(r)
        }
        return b.String()
}

// transcodeDictReplace 用字典替换敏感词. subMode = "homophone" / "pinyin".
//   非字典词保留原样 (避免破坏正常 TDK 可读性). 字典为空同音字时跳过.
//   长词优先替换 (sortedSensitiveDictKeys 按 rune 长度降序).
func transcodeDictReplace(s, subMode string) string {
        out := s
        for _, k := range sortedSensitiveDictKeys() {
                entry := sensitiveWordDict[k]
                var repl string
                switch subMode {
                case "homophone":
                        if entry.homophone == "" {
                                continue // 无合适同音字, 跳过
                        }
                        repl = entry.homophone
                case "pinyin":
                        if entry.pinyin == "" {
                                continue
                        }
                        repl = entry.pinyin
                default:
                        continue
                }
                if repl != "" && repl != k {
                        out = strings.ReplaceAll(out, k, repl)
                }
        }
        return out
}

// transcodeMixed 对每个字典词用确定性 hash 选 homophone/pinyin/zwsp/passthrough.
//   同 word 同输出 (避免缓存闪变). 非字典词保留 (split 不对全字符串应用, 仅字典词).
//   hash 用 FNV-1a 32-bit (与 obfuscateRNG 同款 hash 不同位数).
func transcodeMixed(s string) string {
        out := s
        for _, k := range sortedSensitiveDictKeys() {
                entry := sensitiveWordDict[k]
                // 确定性 hash 选模式 (0-3)
                h := uint32(2166136261) // FNV-1a 32-bit offset basis
                for i := 0; i < len(k); i++ {
                        h ^= uint32(k[i])
                        h *= 16777619 // FNV-1a 32-bit prime
                }
                switch h % 4 {
                case 0:
                        if entry.homophone != "" && entry.homophone != k {
                                out = strings.ReplaceAll(out, k, entry.homophone)
                        }
                case 1:
                        if entry.pinyin != "" && entry.pinyin != k {
                                out = strings.ReplaceAll(out, k, entry.pinyin)
                        }
                case 2:
                        // split 该词 (字符间插零宽空格, 视觉不变)
                        split := transcodeZWSP(k)
                        if split != k {
                                out = strings.ReplaceAll(out, k, split)
                        }
                case 3:
                        // passthrough (保留原词)
                }
        }
        return out
}

// R69-A: getKeywordTranscodeMode 读 Setting 表 keywordTranscode 模式 (默认 off).
//   value 存储格式: JSON 编码字符串 ("\"split\"") 或 raw 字符串 ("split").
//   未知值 → "off" (保守不破坏).
//   每次 computeChapterSeo 调用一次 (SQLite 单行查询, <0.1ms, 不需缓存层).
func getKeywordTranscodeMode() string {
        var v string
        err := db.QueryRow(`SELECT value FROM Setting WHERE key='keywordTranscode'`).Scan(&v)
        if err != nil || v == "" {
                return "off"
        }
        // 优先解析 JSON (admin settings 存 JSON 编码字符串)
        var parsed interface{}
        if json.Unmarshal([]byte(v), &parsed) == nil {
                if s, ok := parsed.(string); ok {
                        return normalizeTranscodeMode(s)
                }
        }
        return normalizeTranscodeMode(v)
}

// normalizeTranscodeMode 校验 mode 值合法性, 非法 → "off".
func normalizeTranscodeMode(s string) string {
        switch s {
        case "off", "split", "homophone", "pinyin", "mixed", "zwsp":
                return s
        }
        return "off"
}

// transcodeChapterSeoOutput 应用关键词转码到 computeChapterSeo 输出 (title/desc/kw).
//   Setting 表 keywordTranscode != "off" 时应用, 否则 passthrough.
//   在 computeChapterSeo 两处 return 之前统一调用, 保证 TDK 一致转码.
func transcodeChapterSeoOutput(title, desc, kw string) (string, string, string) {
        mode := getKeywordTranscodeMode()
        if mode == "off" || mode == "" {
                return title, desc, kw
        }
        return transcodeKeyword(title, mode), transcodeKeyword(desc, mode), transcodeKeyword(kw, mode)
}

func getCategories() ([]map[string]interface{}, error) {
        rows, err := db.Query(`SELECT id,name FROM Category ORDER BY sortOrder ASC LIMIT 60`)
        if err != nil {
                return nil, err
        }
        defer rows.Close()
        cats := []map[string]interface{}{}
        for rows.Next() {
                var id, name string
                rows.Scan(&id, &name)
                cats = append(cats, map[string]interface{}{"id": id, "name": name})
        }
        return cats, nil
}

func getBooks(limit int) ([]map[string]interface{}, error) {
        rows, err := db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id ORDER BY b.updatedAt DESC LIMIT ?`, limit)
        if err != nil {
                return nil, err
        }
        defer rows.Close()
        books := []map[string]interface{}{}
        for rows.Next() {
                var id, name, author, intro, cover, status, latestChapter, category, categoryID sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &updatedAt)
                books = append(books, map[string]interface{}{
                        "id": id.String, "name": name.String, "author": author.String,
                        "intro": truncate(intro.String, 120), "cover": coverURL(cover.String),
                        "status": status.String, "wordCount": wordCount, "latestChapter": latestChapter.String,
                        "category": category.String, "categoryId": categoryID.String, "updatedAt": formatUpdatedAt(updatedAt),
                })
        }
        return books, nil
}

func takeN(cats []map[string]interface{}, n int) []map[string]interface{} {
        if n > len(cats) {
                n = len(cats)
        }
        return cats[:n]
}

func topBooks(books []map[string]interface{}, n int) []map[string]interface{} {
        // 按字数排序取前 N
        sorted := make([]map[string]interface{}, len(books))
        copy(sorted, books)
        // 简单冒泡 (按 wordCount desc)
        // R41-1B: 类型断言加 ok 检查防 panic (wordCount 缺失或类型异常时降级 0)
        wcAt := func(b map[string]interface{}) int64 {
                if v, ok := b["wordCount"]; ok {
                        switch x := v.(type) {
                        case int64:
                                return x
                        case int:
                                return int64(x)
                        case float64:
                                return int64(x)
                        }
                }
                return 0
        }
        for i := 0; i < len(sorted); i++ {
                for j := i + 1; j < len(sorted); j++ {
                        if wcAt(sorted[j]) > wcAt(sorted[i]) {
                                sorted[i], sorted[j] = sorted[j], sorted[i]
                        }
                }
        }
        if n > len(sorted) {
                n = len(sorted)
        }
        return sorted[:n]
}

func takeBooks(books []map[string]interface{}, n int) []map[string]interface{} {
        if n > len(books) {
                n = len(books)
        }
        return books[:n]
}

// ===== R41-1B: 章节正文安全消毒 (剥离危险标签/事件处理器/JS URL) =====

// 危险整段标签 — script/iframe/object/embed/svg/meta/link/style/base/form
// 注意: Go regexp (RE2) 不支持 \1 反向引用, 故按标签名一一展开.
var dangerousTagREs = func() []*regexp.Regexp {
        tags := []string{"script", "iframe", "object", "embed", "svg", "meta", "link", "style", "base", "form"}
        out := make([]*regexp.Regexp, 0, len(tags)*2)
        for _, t := range tags {
                // 含闭合: <tag ...> ... </tag>
                out = append(out, regexp.MustCompile("(?is)<\\s*"+t+"\\b[^>]*>.*?<\\s*/\\s*"+t+"\\s*>"))
                // 自闭合/未闭合: <tag ...>  (单独的, 不含闭合)
                out = append(out, regexp.MustCompile("(?is)<\\s*"+t+"\\b[^>]*/?>"))
        }
        return out
}()

// 事件处理器属性 onXxx=
var eventAttrRe = regexp.MustCompile(`(?i)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`)
// javascript: / data: URL (script src, a href, iframe src)
var jsURLOpenRe = regexp.MustCompile(`(?i)(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+|'data:[^']*'|"data:[^"]*"|data:[^\s>]+)`)

// sanitizeChapterHTML 剥离危险标签/事件处理器/JS URL — 防 stored XSS.
// R41-1B: 渲染 template.HTML 前必须先过此函数.
func sanitizeChapterHTML(s string) string {
        if s == "" {
                return ""
        }
        for _, re := range dangerousTagREs {
                s = re.ReplaceAllString(s, "")
        }
        s = eventAttrRe.ReplaceAllString(s, "")
        s = jsURLOpenRe.ReplaceAllString(s, "")
        return s
}

// ===== 工具 =====

// coverURL constructs the public-facing cover URL from the stored cover field.
//   - empty cover → "" (front-end shows SVG placeholder via /covers/ handler)
//   - external http(s) URL → returned as-is (browser loads directly from origin)
//   - "data:" inline base64 image → returned as-is (no network round-trip)
//   - "/..." absolute path on this host → returned as-is (don't double-slash)
//   - relative path (e.g. "covers/abc.webp" / "images/foo.jpg") → "/" + path
//     (handled by /covers/ FileServer or other static handlers)
//
// R67-D BUG-56 (P2): adminBooksCreate (admin.go line ~1467) + adminBookByIDHandler PUT
//   explicitly allow external cover URLs (http:// | https:// | /covers/ | /). crawl
//   package UpsertBook stores whatever b.Cover yields — which for source sites with
//   CDN-hosted covers is an external URL (e.g. https://cdn.cdnshu.com/...). DB
//   实测 207/668 (~31%) books 有 external cover URL. 原实现各处 unconditionally
//   `"/" + cover.String` → 把 "https://..." 拼成 "/https://..." → 浏览器视作当前
//   host 的相对路径请求 → /covers/ handler 不认 → 404 + 封面破图. 修复: 加 helper
//   分辨 http(s):// 前缀, 原样返回; 否则前缀 "/". 应用到 4 处 cover 输出
//   (bookDetailHandler / getBooks / bookRowFromScan / getBookViewData).
//
// R68-D BUG-73 (P2): R67-D coverURL 漏 3 类边界 — adminBooksCreate 显式允许
//   "/..." 前缀 (站内绝对路径, e.g. "/covers/foo.webp" "/foo.jpg"), 原实现
//   `"/" + cover` 把 "/foo.jpg" 拼成 "//foo.jpg" → 浏览器视作协议相对 URL
//   (proto-relative, e.g. http://foo.jpg) → 跳到外部 host foo.jpg 而非本站
//   /foo.jpg, 跨域 + 404 + 破图. 同款: "data:image/png;base64,..." 内联图也
//   被前缀 "/" 拼成 "/data:..." → 浏览器不识别 data URI → 破图. 用户在 admin
//   UI 直接粘贴 base64 内联图 (避免一次 CDN 请求) 时破图. 修复: 加 3 类边界
//   显式 passthrough (http(s):// / data: / / 开头), 仅相对路径 (covers/foo.webp
//   / images/foo.jpg) 加 "/" 前缀走 /covers/ FileServer. 与 adminBooksCreate +
//   adminBookByIDHandler PUT 的 cover 校验 (允许 http(s):// + /covers/ + / 开头)
//   + crawl UpsertBook (允许任意字符串, source 站 CDN 直存) 三处对齐.
func coverURL(cover string) string {
        if cover == "" {
                return ""
        }
        // 外链 URL: http(s):// 原样返回 (浏览器直连源站 CDN).
        if strings.HasPrefix(cover, "http://") || strings.HasPrefix(cover, "https://") {
                return cover
        }
        // 内联 base64 图: data:image/... 原样返回 (无网络请求, 浏览器直接解码).
        if strings.HasPrefix(cover, "data:") {
                return cover
        }
        // 站内绝对路径: "/covers/foo.webp" "/foo.jpg" 原样返回 (已是绝对路径,
        //   再加 "/" 前缀会拼成 "//foo.jpg" → 协议相对 URL 跨域).
        if strings.HasPrefix(cover, "/") {
                return cover
        }
        // 相对路径: "covers/abc.webp" "images/foo.jpg" → "/covers/abc.webp" 走 /covers/
        //   FileServer 或 /images/ 等其他静态 handler. 这是 SaveCoverWebp 落盘路径
        //   "covers/{name}.webp" 的默认形态 (R65-C BUG-44).
        return "/" + cover
}

func writeJSON(w http.ResponseWriter, v interface{}) {
        w.Header().Set("Content-Type", "application/json; charset=utf-8")
        w.Header().Set("Access-Control-Allow-Origin", "*")
        json.NewEncoder(w).Encode(v)
}

// truncate 按字节截断到 n, 但回退到最后一个完整 UTF-8 rune 边界 (防中文等
// 多字节字符被切半造成乱码 / 无效 UTF-8 输出 / 模板渲染 U+FFFD).
// R42-1A: 之前直接 s[:n] 在 3-byte 中文处会切出孤立 continuation byte.
// R52: updatedAt 格式化 — SQLite 可能存 Unix 时间戳(秒或毫秒), 转成 2006-01-02 15:04
// R53-1A 修复 BUG-2: 原 formatUpdatedAt 仅处理 "秒 + 毫秒 (>1e12)" 两级,
//   漏微秒 (1e15+, Go time.Now().UnixMicro() 来源) 与纳秒 (1e18+, Go time.Now().UnixNano()
//   来源). 若上游 (TS admin API 写入 / 第三方同步) 用 UnixMicro / UnixNano, 原 i/1000
//   把微秒当毫秒除 → 1698765432000000 / 1000 = 1698765432000 (仍是毫秒) →
//   time.Unix(1698765432000, 0) → 公元 56000+ 年. 修复: 按数量级 4 级判断 —
//   ≥1e17 纳秒 /1e9, ≥1e14 微秒 /1e6, ≥1e11 毫秒 /1e3, 否则秒. 阈值取
//   "今年各精度下限的 100x" 防边界 (e.g. 2024-01-01 秒=1704067200, 毫秒=1.7e12,
//   微秒=1.7e15, 纳秒=1.7e18; 阈值 1e11/1e14/1e17 在各精度下限 + 100 年内仍稳定).
// R53-1A 修复 BUG-3: 原 time.Parse 仅尝试 "2006-01-02T15:04:05" (ISO 无时区) +
//   "2006-01-02 15:04:05" (SQLite TEXT), 漏:
//   - "2006-01-02T15:04:05Z" (ISO 8601 UTC, TS admin API 常见)
//   - "2006-01-02T15:04:05+08:00" / "-07:00" (ISO 带时区)
//   - time.RFC3339 (完整 ISO 8601, 含毫秒 + 时区)
//   - "2006-01-02" (SQLite DATE 类型, 仅日期无时分)
//   - "2006/01/02 15:04:05" (slash 分隔, 部分中文源站格式)
//   - "2006/01/02" (slash 日期)
//   原 "2024-01-01T12:00:00Z" → Parse("2006-01-02T15:04:05") 失败 (因 layout 无 Z) →
//   回退返原字符串 "2024-01-01T12:00:00Z" 给前端, 显示带 T 和 Z 的乱码时间. 修复:
//   补 5 个 layout 兜底 + 时区感知 Parse (用 time.ParseInLocation 防本地时区漂移).
func formatUpdatedAt(s string) string {
        s = strings.TrimSpace(s)
        if s == "" {
                return ""
        }
        // 数值时间戳 — 4 级数量级判断 (R53-1A 修复 BUG-2)
        if i, err := strconv.ParseInt(s, 10, 64); err == nil {
                switch {
                case i >= 1000000000000000000: // ≥ 1e18 纳秒 (含未来 100 年)
                        i = i / 1000000000
                case i >= 1000000000000000: // ≥ 1e15 微秒
                        i = i / 1000000
                case i >= 1000000000000: // ≥ 1e12 毫秒
                        i = i / 1000
                }
                // 否则视为秒 (R52 原行为)
                // 时区用本地 (与 SQLite TEXT 行为一致, 数据库写入是本地时区).
                return time.Unix(i, 0).Format("2006-01-02 15:04")
        }
        // 文本时间 — 多 layout 尝试 (R53-1A 修复 BUG-3)
        //   时区: 用 time.Parse (local TZ) 而非 time.ParseInLocation. 若字符串含
        //   时区后缀 (Z / +08:00), Parse 会按字符串时区; 无时区后缀则按本地时区.
        //   与 SQLite TEXT 行为一致 (SQLite 不存时区, 读出按本地时区).
        layouts := []string{
                time.RFC3339,                 // 2006-01-02T15:04:05Z07:00 (ISO 8601 含时区, Z / ±HH:MM)
                "2006-01-02T15:04:05",        // ISO 无时区
                "2006-01-02 15:04:05",        // SQLite TEXT
                "2006-01-02 15:04",           // SQLite TEXT 精确到分
                "2006-01-02",                  // SQLite DATE
                "2006/01/02 15:04:05",        // slash 分隔 + 时分秒
                "2006/01/02 15:04",           // slash 分隔 + 时分
                "2006/01/02",                  // slash 日期
        }
        for _, layout := range layouts {
                if t, err := time.Parse(layout, s); err == nil {
                        return t.Format("2006-01-02 15:04")
                }
        }
        return s
}

func truncate(s string, n int) string {
        if n <= 0 {
                return ""
        }
        if len(s) <= n {
                return s
        }
        // 回退 end 到 rune 起点 (防切到 multi-byte rune 中间的 continuation byte).
        // s[end] 若是 continuation byte (10xxxxxx) 则继续向前找.
        end := n
        for end > 0 && !utf8.RuneStart(s[end]) {
                end--
        }
        // 此时 s[end] 是 rune 起点 (或 end==0). 但若 end 处的 rune 跨越 end+(1..4) 字节,
        // 切到 end 仍是该 rune 起点, 不会切半; 该 rune 整体被丢弃 (好).
        return s[:end]
}

func getMemMB() uint64 {
        var m runtime.MemStats
        runtime.ReadMemStats(&m)
        return m.Sys / 1024 / 1024
}

// ===== R38-1B: 视图相关查询 + 工具 =====

// toInt 把 interface{} 转 int (支持 int/int64/float64/字符串数字)
func toInt(v interface{}) int {
        switch x := v.(type) {
        case int:
                return x
        case int64:
                return int(x)
        case float64:
                return int(x)
        case string:
                var n int
                fmt.Sscanf(x, "%d", &n)
                return n
        }
        return 0
}

// clampPage 解析 page 参数, 默认 1, 最小 1
func clampPage(s string) int {
        n := toInt(s)
        if n < 1 {
                return 1
        }
        return n
}

// buildPageList 生成可点击页码列表 (当前页前后各 5 个, 最多 11 个)
func buildPageList(cur, total int) []int {
        if total < 1 {
                return []int{}
        }
        start := cur - 5
        if start < 1 {
                start = 1
        }
        end := start + 10
        if end > total {
                end = total
        }
        if end-start < 10 && start > 1 {
                start = end - 10
                if start < 1 {
                        start = 1
                }
        }
        out := []int{}
        for i := start; i <= end; i++ {
                out = append(out, i)
        }
        return out
}

// pickAuthors 从 books 提取去重作者前 n 个
func pickAuthors(books []map[string]interface{}, n int) []string {
        seen := map[string]bool{}
        out := []string{}
        for _, b := range books {
                a, _ := b["author"].(string)
                if a == "" || seen[a] {
                        continue
                }
                seen[a] = true
                out = append(out, a)
                if len(out) >= n {
                        break
                }
        }
        return out
}

// withRank 给 books 列表每项加 rank 字段 (基于 page/size 计算全局序号)
func withRank(books []map[string]interface{}, page, size int) []map[string]interface{} {
        base := (page - 1) * size
        for i, b := range books {
                b["rank"] = base + i + 1
                // R64-D BUG-35: removed redundant `books[i] = b` (b is a map reference;
                //   mutating b["rank"] already affects the underlying map shared with books[i]).
        }
        return books
}

// rankingTabs 排行榜 tab 列表 (按全本/连载/月点击/周点击/历史点击)
func rankingTabs() []map[string]string {
        return []map[string]string{
                {"id": "allvisit", "name": "总点击榜"},
                {"id": "monthvisit", "name": "月点击榜"},
                {"id": "weekvisit", "name": "周点击榜"},
                {"id": "dayvisit", "name": "日点击榜"},
                {"id": "allvote", "name": "总推荐榜"},
                {"id": "size", "name": "字数榜"},
                {"id": "lastupdate", "name": "最近更新"},
        }
}

// tabName 根据 tab id 取中文名
func tabName(tab string) string {
        for _, t := range rankingTabs() {
                if t["id"] == tab {
                        return t["name"]
                }
        }
        return "排行榜"
}

// bookRowFromScan 把 SQL scan 出来的字段拼成 books slice 元素 (与 getBooks 同款字段名)
func bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryID sql.NullString, wordCount int64, updatedAt string) map[string]interface{} {
        return map[string]interface{}{
                "id": id.String, "name": name.String, "author": author.String,
                "intro": truncate(intro.String, 120), "cover": coverURL(cover.String),
                "status": status.String, "wordCount": wordCount, "latestChapter": latestChapter.String,
                "category": category.String, "categoryId": categoryID.String, "updatedAt": formatUpdatedAt(updatedAt),
        }
}

// getBookViewData 装配 book 视图所需: 单本书 + 完整章节列表 + 最近章节 + 同类推荐 + 第一章 id
func getBookViewData(id string) (map[string]interface{}, []map[string]interface{}, []map[string]interface{}, []map[string]interface{}, string, bool) {
        // 1. 单本书详情 (字段比 getBooks 多 keywords)
        var bid, name, author, intro, cover, status, latestChapter, category, categoryID, keywords, updatedAt sql.NullString
        var wordCount int64
        err := db.QueryRow(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.keywords,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.id=?`, id).Scan(
                &bid, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &keywords, &updatedAt)
        if err != nil {
                return nil, nil, nil, nil, "", false
        }
        book := map[string]interface{}{
                "id": bid.String, "name": name.String, "author": author.String,
                "intro": intro.String, "cover": coverURL(cover.String), "status": status.String,
                "wordCount": wordCount, "latestChapter": latestChapter.String,
                "category": category.String, "categoryId": categoryID.String,
                "keywords": keywords.String, "updatedAt": formatUpdatedAt(updatedAt.String),
        }

        // 2. 完整章节列表 (按 idx asc, 取前 200 防止超大书)
        rows, err := db.Query(`SELECT id, idx, title, wordCount, volume FROM Chapter WHERE bookId=? ORDER BY idx ASC LIMIT 200`, id)
        if err != nil {
                rows = nil
        }
        chapters := []map[string]interface{}{}
        firstChID := ""
        if rows != nil {
                defer rows.Close()
                for rows.Next() {
                        var cid, title, volume sql.NullString
                        var idx int
                        var wc int64
                        rows.Scan(&cid, &idx, &title, &wc, &volume)
                        chapters = append(chapters, map[string]interface{}{
                                "id": cid.String, "idx": idx, "title": title.String,
                                "wordCount": wc, "volume": volume.String,
                        })
                        if firstChID == "" {
                                firstChID = cid.String
                        }
                }
        }

        // 3. 最近章节 (按 idx desc 取 12, 然后反转顺序让其显示为最新→次新)
        recent := []map[string]interface{}{}
        if rows2, err := db.Query(`SELECT id, title FROM Chapter WHERE bookId=? ORDER BY idx DESC LIMIT 12`, id); err == nil {
                defer rows2.Close()
                tmp := []map[string]interface{}{}
                for rows2.Next() {
                        var cid, title sql.NullString
                        rows2.Scan(&cid, &title)
                        tmp = append(tmp, map[string]interface{}{"id": cid.String, "title": title.String})
                }
                // 反转
                for i := len(tmp) - 1; i >= 0; i-- {
                        recent = append(recent, tmp[i])
                }
        }

        // 4. 同类推荐 (同 categoryId, 排除当前书, 取 12 本)
        related := []map[string]interface{}{}
        if categoryID.String != "" {
                if rows3, err := db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.categoryId=? AND b.id!=? ORDER BY b.updatedAt DESC LIMIT 12`, categoryID.String, id); err == nil {
                        defer rows3.Close()
                        for rows3.Next() {
                                var bid2, name2, author2, intro2, cover2, status2, latestChapter2, category2, categoryID2 sql.NullString
                                var wordCount2 int64
                                var updatedAt2 string
                                rows3.Scan(&bid2, &name2, &author2, &intro2, &cover2, &status2, &wordCount2, &latestChapter2, &category2, &categoryID2, &updatedAt2)
                                related = append(related, bookRowFromScan(bid2, name2, author2, intro2, cover2, status2, latestChapter2, category2, categoryID2, wordCount2, updatedAt2))
                        }
                }
        }

        return book, chapters, recent, related, firstChID, true
}

// getReadViewData 装配 read 视图所需: chapter content + book 信息 + prev/next
//  R57-1B: 接收 site 参数, 调 computeChapterSeo 算 SEO TDK 写入 chapter map
//    (供模板消费 .Chapter.seoTitle / .Chapter.seoKeywords / .Chapter.seoDesc).
func getReadViewData(chID string, site map[string]interface{}) (map[string]interface{}, map[string]interface{}, map[string]interface{}, map[string]interface{}, bool) {
        // 1. 查 chapter (含 bookId, idx, title, content, wordCount)
        var cid, title, content, bookID, volume, storage, filePath sql.NullString
        var idx int
        var wc int64
        err := db.QueryRow(`SELECT id, title, content, idx, wordCount, bookId, volume, storage, filePath FROM Chapter WHERE id=?`, chID).Scan(
                &cid, &title, &content, &idx, &wc, &bookID, &volume, &storage, &filePath)
        if err != nil {
                return nil, nil, nil, nil, false
        }
        // 兼容 txt 模式: 直接从 DB 取 content; 若空且 storage=txt+filePath, 暂不读 txt 文件 (留给后续)
        bodyHTML := content.String
        // R41-1B: 安全加固 — 始终剥离危险标签/事件处理器后再渲染 template.HTML
        bodyHTML = sanitizeChapterHTML(bodyHTML)
        // 若 content 不含 <p> 标签但含 \n\n, 按 \n\n 切分加 <p> 包裹 (与公开 chapter API 一致)
        if bodyHTML != "" && !strings.Contains(bodyHTML, "<p>") && !strings.Contains(bodyHTML, "<p ") && strings.Contains(bodyHTML, "\n\n") {
                parts := strings.Split(bodyHTML, "\n\n")
                out := []string{}
                for _, p := range parts {
                        p = strings.TrimSpace(p)
                        if p == "" {
                                continue
                        }
                        // 转义 HTML
                        p = strings.ReplaceAll(p, "&", "&amp;")
                        p = strings.ReplaceAll(p, "<", "&lt;")
                        p = strings.ReplaceAll(p, ">", "&gt;")
                        out = append(out, "<p>"+p+"</p>")
                }
                bodyHTML = strings.Join(out, "")
        }
        chapter := map[string]interface{}{
                "id": cid.String, "title": title.String, "content": template.HTML(bodyHTML),
                "idx": idx, "wordCount": wc,
        }

        // 2. 查 book (id, name, author, status, category, intro)
        var bid, bname, bauthor, bstatus, bcategory, bintro sql.NullString
        if err := db.QueryRow(`SELECT b.id,b.name,b.author,b.status,COALESCE(c.name,'未分类'),b.intro FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.id=?`, bookID.String).Scan(
                &bid, &bname, &bauthor, &bstatus, &bcategory, &bintro); err != nil {
                // book 查不到也允许渲染
                bookMap := map[string]interface{}{"id": bookID.String, "name": "", "author": "", "status": "", "category": "", "intro": ""}
                // R57-1B: 即使 book 查不到, 也填入 SEO TDK (用空 bookName/author/intro + chapterTitle)
                if site != nil {
                        seoT, seoD, seoK := computeChapterSeo(site, title.String, "", "", "")
                        chapter["seoTitle"] = seoT
                        chapter["seoDesc"] = seoD
                        chapter["seoKeywords"] = seoK
                }
                return chapter, bookMap, nil, nil, true
        }
        bookMap := map[string]interface{}{
                "id": bid.String, "name": bname.String, "author": bauthor.String,
                "status": bstatus.String, "category": bcategory.String, "intro": bintro.String,
        }
        // R57-1B 接入智能 TDK: 调 computeChapterSeo 算 SEO TDK 写入 chapter map.
        //   chapterSeoAuto=true (默认): 用默认模板, 与原模板硬编码 `{{.Chapter.title}} - {{.Book.name}} - {{.Site.Title}}`
        //   等价 (与 chapterSeoTitleTemplate 空时 fallback 默认一致). chapterSeoAuto=false 且模板非空时
        //   用用户配置的模板 (替换 {bookName} {chapterTitle} {page} {totalPages} {siteName} 占位符).
        if site != nil {
                seoT, seoD, seoK := computeChapterSeo(site, title.String, bname.String, bauthor.String, bintro.String)
                chapter["seoTitle"] = seoT
                chapter["seoDesc"] = seoD
                chapter["seoKeywords"] = seoK
        }

        // 3. prev / next (基于 idx)
        var prev, next map[string]interface{}
        if prow, err := db.Query(`SELECT id, title FROM Chapter WHERE bookId=? AND idx<? ORDER BY idx DESC LIMIT 1`, bookID.String, idx); err == nil {
                if prow.Next() {
                        var pid, ptitle sql.NullString
                        prow.Scan(&pid, &ptitle)
                        prev = map[string]interface{}{"id": pid.String, "title": ptitle.String}
                }
                prow.Close()
        }
        if nrow, err := db.Query(`SELECT id, title FROM Chapter WHERE bookId=? AND idx>? ORDER BY idx ASC LIMIT 1`, bookID.String, idx); err == nil {
                if nrow.Next() {
                        var nid, ntitle sql.NullString
                        nrow.Scan(&nid, &ntitle)
                        next = map[string]interface{}{"id": nid.String, "title": ntitle.String}
                }
                nrow.Close()
        }

        return chapter, bookMap, prev, next, true
}

// getCategoryViewData 分类列表: 按 categoryId 过滤 + 分页
func getCategoryViewData(catID string, page, size int) (string, []map[string]interface{}, int) {
        label := "全本小说"
        // 若指定 catID, 取分类名做 label
        if catID != "" {
                var cname sql.NullString
                if err := db.QueryRow(`SELECT name FROM Category WHERE id=?`, catID).Scan(&cname); err == nil && cname.String != "" {
                        label = cname.String
                }
        }

        // 查 total
        var total int
        if catID != "" {
                db.QueryRow(`SELECT COUNT(*) FROM Book WHERE categoryId=?`, catID).Scan(&total)
        } else {
                db.QueryRow(`SELECT COUNT(*) FROM Book`).Scan(&total)
        }

        offset := (page - 1) * size
        if offset > 10000 {
                offset = 10000
        }

        var rows *sql.Rows
        var err error
        if catID != "" {
                rows, err = db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.categoryId=? ORDER BY b.updatedAt DESC LIMIT ? OFFSET ?`, catID, size, offset)
        } else {
                rows, err = db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id ORDER BY b.updatedAt DESC LIMIT ? OFFSET ?`, size, offset)
        }
        if err != nil {
                return label, []map[string]interface{}{}, total
        }
        defer rows.Close()
        books := []map[string]interface{}{}
        for rows.Next() {
                var id, name, author, intro, cover, status, latestChapter, category, categoryID sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &updatedAt)
                books = append(books, bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryID, wordCount, updatedAt))
        }
        return label, books, total
}

// getRankingViewData 排行榜: 按 tab (sort) 排序 + 分页
func getRankingViewData(tab string, page, size int) ([]map[string]interface{}, int) {
        // 排序映射 (updated/wordCount/clickCount/monthClickCount/weekClickCount↕)
        // size → wordCount DESC; 其他 → updatedAt DESC (无 visit/vote 列)
        orderClause := "b.updatedAt DESC"
        if tab == "size" {
                orderClause = "b.wordCount DESC"
        }
        var total int
        db.QueryRow(`SELECT COUNT(*) FROM Book`).Scan(&total)

        offset := (page - 1) * size
        if offset > 10000 {
                offset = 10000
        }
        q := `SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id ORDER BY ` + orderClause + ` LIMIT ? OFFSET ?`
        rows, err := db.Query(q, size, offset)
        if err != nil {
                return []map[string]interface{}{}, total
        }
        defer rows.Close()
        books := []map[string]interface{}{}
        for rows.Next() {
                var id, name, author, intro, cover, status, latestChapter, category, categoryID sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &updatedAt)
                books = append(books, bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryID, wordCount, updatedAt))
        }
        return books, total
}

// getFulltextViewData 全本完本: status='completed' + 分页
func getFulltextViewData(page, size int) ([]map[string]interface{}, int) {
        var total int
        db.QueryRow(`SELECT COUNT(*) FROM Book WHERE status='completed'`).Scan(&total)
        offset := (page - 1) * size
        if offset > 10000 {
                offset = 10000
        }
        rows, err := db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.status='completed' ORDER BY b.updatedAt DESC LIMIT ? OFFSET ?`, size, offset)
        if err != nil {
                return []map[string]interface{}{}, total
        }
        defer rows.Close()
        books := []map[string]interface{}{}
        for rows.Next() {
                var id, name, author, intro, cover, status, latestChapter, category, categoryID sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &updatedAt)
                books = append(books, bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryID, wordCount, updatedAt))
        }
        return books, total
}

// getSearchViewData 搜索: name/author/intro/keywords LIKE %q%
// R42-1A: 用 likeSafe 转义 q 中的 % _ \ 防 wildcard 滥用 (q="%" 时不能匹配所有书)
func getSearchViewData(q string, limit int) []map[string]interface{} {
        if q = strings.TrimSpace(q); q == "" {
                return []map[string]interface{}{}
        }
        like := "%" + likeSafe(q) + "%"
        rows, err := db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.name LIKE ? ESCAPE '\' OR b.author LIKE ? ESCAPE '\' OR b.intro LIKE ? ESCAPE '\' OR b.keywords LIKE ? ESCAPE '\' ORDER BY b.wordCount DESC LIMIT ?`, like, like, like, like, limit)
        if err != nil {
                return []map[string]interface{}{}
        }
        defer rows.Close()
        books := []map[string]interface{}{}
        for rows.Next() {
                var id, name, author, intro, cover, status, latestChapter, category, categoryID sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &updatedAt)
                // 搜索结果简介取 150 字
                m := bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryID, wordCount, updatedAt)
                m["intro"] = truncate(intro.String, 150)
                books = append(books, m)
        }
        return books
}

// getKeywordViewData 标签关键词: 通过 BookTag 关联取书 + 相关标签
func getKeywordViewData(tag string, limit int) ([]map[string]interface{}, []string) {
        if tag == "" {
                return []map[string]interface{}{}, []string{}
        }
        // 1. 取有此 tag 的书 (按 hits desc)
        rows, err := db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM BookTag bt JOIN Book b ON bt.bookId=b.id LEFT JOIN Category c ON b.categoryId=c.id WHERE bt.tag=? ORDER BY bt.hits DESC LIMIT ?`, tag, limit)
        if err != nil {
                return []map[string]interface{}{}, []string{}
        }
        defer rows.Close()
        books := []map[string]interface{}{}
        for rows.Next() {
                var id, name, author, intro, cover, status, latestChapter, category, categoryID sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &updatedAt)
                m := bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryID, wordCount, updatedAt)
                m["intro"] = truncate(intro.String, 200)
                books = append(books, m)
        }
        // 2. 相关标签: 第一本书的其他 tag, 排除当前 tag, 取 12
        relatedTags := []string{}
        if len(books) > 0 {
                firstBookID, _ := books[0]["id"].(string)
                if firstBookID != "" {
                        if rows2, err := db.Query(`SELECT DISTINCT tag FROM BookTag WHERE bookId=? AND tag!=? ORDER BY hits DESC LIMIT 12`, firstBookID, tag); err == nil {
                                defer rows2.Close()
                                for rows2.Next() {
                                        var t sql.NullString
                                        rows2.Scan(&t)
                                        if t.String != "" {
                                                relatedTags = append(relatedTags, t.String)
                                        }
                                }
                        }
                }
        }
        return books, relatedTags
}

// ============================================================================
// R63-A: 伪静态 URL builder + parser (10 套风格)
//
// 风格清单 (向后兼容, query 为默认):
//   1. query       — 查询串 (默认): /?view=book&id={cuid} /?view=read&chapter={cuid} /?view=category&cat={cuid}&page=2
//   2. numeric     — 纯数字 .html: /book/{numericHash(cuid)}.html /read/{numericHash(cuid)}.html /category/{numericHash(cuid)}/{page}.html
//   3. alphanumeric — 字母+数字 (前缀+6位数字): /book/b{first6Digits(cuid)}.html /read/c{first6Digits(cuid)}.html
//   4. slug        — 尾斜杠: /book/{cuid}/ /read/{cuid}/ /category/{cuid}/page-{page}/
//   5. short       — 短路径单字符前缀: /b/{cuid} /r/{cuid} /c/{cuid}/{page}
//   6. classic     — 连字符.html: /book-{cuid}.html /read-{cuid}.html /category-{cuid}-{page}.html
//   7. dir         — 目录分层: /book/{cuid}/ /book/{cuid}/chapter/{chCuid}.html /category/{cuid}/{page}/
//   8. hashid      — 短哈希 (base62 + salt, 不可逆, 本站自解析 DB 扫描): /b/{hashidEncode(cuid)}.html /r/{hashidEncode(cuid)}.html
//   9. base62      — base62 编码 ID (可逆, cuid 字节 → big.Int → base62): /b/{base62Encode(cuid)} /r/{base62Encode(cuid)}
//  10. segmented   — ID 分段目录 (前2字符做目录): /book/{cuid[:2]}/{cuid[2:]}.html /read/{cuid[:2]}/{cuid[2:]}.html
//
// 设计要点:
//   - URL builder: pure function, 不依赖 DB; 输入 (style, id) 输出 URL string.
//   - parser: 按 site.PseudoStaticStyle 选 patterns; 匹配则返 (view, token, page).
//   - decode: 多数风格 token IS cuid (slug/short/classic/dir/segmented); hashid/numeric/alphanumeric
//     需 DB 扫描 (findEntityByEncodedToken); base62 用 math/big 反解 (无需 DB).
//   - 风格选择: per-site (Site.pseudoStaticStyle DB 字段); query 风格不走 parser (URL 全 query).
//   - homeHandler 调用顺序: 1) 快前缀检查 (looksLikePseudoStaticPath) → 2) getSite DB 命中 →
//     3) parsePseudoStaticPath(path, style) → 4) decodePseudoStaticToken → 5) 注入 query 串.
// ============================================================================

// pseudoStaticStyles 列出全部 10 套受支持的伪静态风格 (R63-A).
var pseudoStaticStyles = []string{
        "query", "numeric", "alphanumeric", "slug", "short",
        "classic", "dir", "hashid", "base62", "segmented",
}

// validPseudoStaticStyle 校验 s 是否为已知伪静态风格 (R63-A).
//   adminSitesCreate/PUT 在写入 DB 前调用此函数, 非法值返 400.
func validPseudoStaticStyle(s string) bool {
        for _, v := range pseudoStaticStyles {
                if v == s {
                        return true
                }
        }
        return false
}

// pseudoStaticPrefixes 列出全部伪静态路径前缀 (R63-A).
//   homeHandler 用作快路径过滤: 非前缀的 path 直接 404, 不命中 DB.
//   query 风格 URL 走 query 串 (path="/"), 不在此列表.
var pseudoStaticPrefixes = []string{
        "/book/", "/read/", "/category/",
        "/book-", "/read-", "/category-",
        "/b/", "/r/", "/c/",
}

// looksLikePseudoStaticPath 快前缀检查: path 是否可能是伪静态 URL (R63-A).
//   用于 homeHandler 在 DB 命中前过滤 SEO 垃圾 URL, 保留 R42-1A 快路径 404 保护.
func looksLikePseudoStaticPath(path string) bool {
        for _, p := range pseudoStaticPrefixes {
                if strings.HasPrefix(path, p) {
                        return true
                }
        }
        return false
}

// --- 编码助手 (cuid → URL token) ---

// simpleHash — FNV-1a 32-bit (R63-A).
//   用于 numericHash / hashidEncode / 智能选 TDK 模板 (admin.generateSiteTDK).
//   非 crypto 强哈希, 但分布均匀, 适合站点级差异化.
func simpleHash(s string) uint32 {
        h := uint32(2166136261)
        for i := 0; i < len(s); i++ {
                h ^= uint32(s[i])
                h *= 16777619
        }
        return h
}

// extractDigits — 从字符串提取所有数字字符 (R63-A).
//   e.g. "cm1234567ab" → "1234567". 用于 numericHash 备用 + alphanumericEncode.
func extractDigits(s string) string {
        out := make([]byte, 0, len(s))
        for i := 0; i < len(s); i++ {
                c := s[i]
                if c >= '0' && c <= '9' {
                        out = append(out, c)
                }
        }
        return string(out)
}

// first6Digits — 取 cuid 的前 6 位数字 (不足 6 位右侧补 0 到 6 位) (R63-A).
//   alphanumeric 风格 URL token = 字母前缀 + first6Digits(cuid).
func first6Digits(s string) string {
        d := extractDigits(s)
        if len(d) > 6 {
                d = d[:6]
        }
        for len(d) < 6 {
                d += "0"
        }
        return d
}

// numericHash — 10 位纯数字哈希 (R63-A).
//   numeric 风格 URL token = numericHash(cuid), 10 位定长便于人类阅读 + 减少碰撞.
//   实现: FNV-1a 64-bit (两段 32-bit 拼接) mod 1e10, 左补 0 到 10 位.
//   不可逆 (DB 扫描反查).
func numericHash(s string) string {
        h1 := simpleHash(s)
        h2 := simpleHash(s + "::numeric::salt::heis-backend::v1")
        combined := uint64(h1)<<32 | uint64(h2)
        n := combined % 10000000000 // 1e10, 10 digits
        return fmt.Sprintf("%010d", n)
}

// hashidSalt — hashid 风格的固定盐 (R63-A). 同盐 = 同 encode/decode 配对.
const hashidSalt = "heis-backend::pseudo-static::v1"

// hashidEncode — hashid 风格编码: cuid → 短哈希 (R63-A).
//   实现: hash(cuid + salt) → 64-bit → base62. 不可逆, decode 走 DB 扫描.
//   spec 要求 "不可逆但本站自解析" — 即解码端必须能从 token 反查 cuid (本站自扫描).
func hashidEncode(id string) string {
        h1 := simpleHash(id + "::" + hashidSalt)
        h2 := simpleHash(hashidSalt + "::" + id)
        n := uint64(h1)<<32 | uint64(h2)
        return base62EncodeUint(n)
}

// base62Alphabet — base62 编码字母表 (R63-A). 0-9 + A-Z + a-z (字典序 + 大写小写).
const base62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// base62EncodeUint — uint64 → base62 字符串 (R63-A).
//   仅用于 hashidEncode (内部 64-bit 哈希 → base62). 解码端走 DB 扫描, 不需 uint64 反解.
func base62EncodeUint(n uint64) string {
        if n == 0 {
                return "0"
        }
        out := make([]byte, 0, 11)
        for n > 0 {
                out = append([]byte{base62Alphabet[n%62]}, out...)
                n /= 62
        }
        return string(out)
}

// base62Encode — 字符串 (cuid) → base62 (可逆) (R63-A).
//   实现: cuid 字节序列视作大整数 (big.Int, big-endian), base62 编码.
//   反解: base62Decode → big.Int → bytes → string.
func base62Encode(s string) string {
        if s == "" {
                return ""
        }
        n := new(big.Int).SetBytes([]byte(s))
        return base62EncodeBigInt(n)
}

// base62Decode — base62 → 字符串 (可逆) (R63-A).
func base62Decode(s string) (string, bool) {
        if s == "" {
                return "", false
        }
        n, ok := base62DecodeBigInt(s)
        if !ok {
                return "", false
        }
        // 字节序列视作 big-endian, 还原为 string.
        // 注意: SetBytes/Bytes 不保留前导零字节, 因此 cuid 若以 \x00 开头会丢失.
        // 实际 cuid 由可见 ASCII 字符构成 ("cm" + base36), 不以 \x00 开头, 安全.
        return string(n.Bytes()), true
}

// base62EncodeBigInt — big.Int → base62 字符串 (R63-A).
func base62EncodeBigInt(n *big.Int) string {
        if n.Sign() == 0 {
                return "0"
        }
        base := big.NewInt(62)
        mod := new(big.Int)
        out := make([]byte, 0, 16)
        tmp := new(big.Int).Set(n)
        for tmp.Sign() > 0 {
                tmp.DivMod(tmp, base, mod)
                out = append([]byte{base62Alphabet[mod.Int64()]}, out...)
        }
        return string(out)
}

// base62DecodeBigInt — base62 字符串 → big.Int (R63-A). 失败返 (nil, false).
func base62DecodeBigInt(s string) (*big.Int, bool) {
        n := new(big.Int)
        base := big.NewInt(62)
        for i := 0; i < len(s); i++ {
                c := s[i]
                var v int64
                switch {
                case c >= '0' && c <= '9':
                        v = int64(c - '0')
                case c >= 'A' && c <= 'Z':
                        v = 10 + int64(c-'A')
                case c >= 'a' && c <= 'z':
                        v = 36 + int64(c-'a')
                default:
                        return nil, false
                }
                n.Mul(n, base)
                n.Add(n, big.NewInt(v))
        }
        return n, true
}

// --- URL builders (pure functions, no DB) ---

// buildHomeURL — 首页 URL (R63-A). 各风格一致为 "/".
//   (首页是站点入口, 不需伪静态差异化; 风格差异在 book/chapter/category.)
func buildHomeURL(style string) string {
        _ = style
        return "/"
}

// buildBookURL — 书籍详情页 URL (R63-A).
//   query:        /?view=book&id={cuid}
//   numeric:      /book/{numericHash(cuid)}.html
//   alphanumeric: /book/b{first6Digits(cuid)}.html
//   slug:         /book/{cuid}/
//   short:        /b/{cuid}
//   classic:      /book-{cuid}.html
//   dir:          /book/{cuid}/
//   hashid:       /b/{hashidEncode(cuid)}.html
//   base62:       /b/{base62Encode(cuid)}
//   segmented:    /book/{cuid[:2]}/{cuid[2:]}.html
func buildBookURL(style, bookID string) string {
        if bookID == "" {
                return "/"
        }
        switch style {
        case "", "query":
                return "/?view=book&id=" + bookID
        case "numeric":
                return "/book/" + numericHash(bookID) + ".html"
        case "alphanumeric":
                return "/book/b" + first6Digits(bookID) + ".html"
        case "slug":
                return "/book/" + bookID + "/"
        case "short":
                return "/b/" + bookID
        case "classic":
                return "/book-" + bookID + ".html"
        case "dir":
                return "/book/" + bookID + "/"
        case "hashid":
                return "/b/" + hashidEncode(bookID) + ".html"
        case "base62":
                return "/b/" + base62Encode(bookID)
        case "segmented":
                if len(bookID) < 2 {
                        // cuid 过短 (异常), fallback slug 风格.
                        return "/book/" + bookID + "/"
                }
                return "/book/" + bookID[:2] + "/" + bookID[2:] + ".html"
        }
        return "/?view=book&id=" + bookID
}

// buildChapterURL — 章节阅读页 URL (R63-A).
//   query:        /?view=read&chapter={chID}
//   numeric:      /read/{numericHash(chID)}.html
//   alphanumeric: /read/c{first6Digits(chID)}.html
//   slug:         /read/{chID}/
//   short:        /r/{chID}
//   classic:      /read-{chID}.html
//   dir:          /book/{bookID}/chapter/{chID}.html (bookID 必填, 否则 fallback slug)
//   hashid:       /r/{hashidEncode(chID)}.html
//   base62:       /r/{base62Encode(chID)}
//   segmented:    /read/{chID[:2]}/{chID[2:]}.html
func buildChapterURL(style, chID, bookID string) string {
        if chID == "" {
                return "/"
        }
        switch style {
        case "", "query":
                return "/?view=read&chapter=" + chID
        case "numeric":
                return "/read/" + numericHash(chID) + ".html"
        case "alphanumeric":
                return "/read/c" + first6Digits(chID) + ".html"
        case "slug":
                return "/read/" + chID + "/"
        case "short":
                return "/r/" + chID
        case "classic":
                return "/read-" + chID + ".html"
        case "dir":
                if bookID != "" {
                        return "/book/" + bookID + "/chapter/" + chID + ".html"
                }
                // fallback: bookID 未知时用 slug-style read URL (向后兼容).
                return "/read/" + chID + "/"
        case "hashid":
                return "/r/" + hashidEncode(chID) + ".html"
        case "base62":
                return "/r/" + base62Encode(chID)
        case "segmented":
                if len(chID) < 2 {
                        return "/read/" + chID + "/"
                }
                return "/read/" + chID[:2] + "/" + chID[2:] + ".html"
        }
        return "/?view=read&chapter=" + chID
}

// buildCategoryURL — 分类列表页 URL (R63-A).
//   query:        /?view=category&cat={catID}&page={page}  (page=1 省略 page 参数)
//   numeric:      /category/{numericHash(catID)}/{page}.html (page=1 省略 page 段)
//   alphanumeric: /category/d{first6Digits(catID)}.html  (page>1 加 /{page}.html 后缀? 简化: page=1 省略, page>1 同 numeric)
//   slug:         /category/{catID}/page-{page}/  (page=1 省略 page-1/)
//   short:        /c/{catID}  (page>1 加 /{page})
//   classic:      /category-{catID}.html  (page>1 加 -{page}.html)
//   dir:          /category/{catID}/{page}/  (page=1 用 /category/{catID}/)
//   hashid:       /c/{hashidEncode(catID)}.html  (page>1 加 /page-{page}? 暂简化省略)
//   base62:       /c/{base62Encode(catID)}  (page>1 加 /{page}? 暂简化省略)
//   segmented:    /category/{catID[:2]}/{catID[2:]}/{page}.html
func buildCategoryURL(style, catID string, page int) string {
        if catID == "" {
                return "/?view=category"
        }
        if page < 1 {
                page = 1
        }
        switch style {
        case "", "query":
                if page > 1 {
                        return "/?view=category&cat=" + catID + "&page=" + strconv.Itoa(page)
                }
                return "/?view=category&cat=" + catID
        case "numeric":
                base := "/category/" + numericHash(catID)
                if page > 1 {
                        return base + "/" + strconv.Itoa(page) + ".html"
                }
                return base + ".html"
        case "alphanumeric":
                base := "/category/d" + first6Digits(catID)
                if page > 1 {
                        return base + "/" + strconv.Itoa(page) + ".html"
                }
                return base + ".html"
        case "slug":
                base := "/category/" + catID + "/"
                if page > 1 {
                        return base + "page-" + strconv.Itoa(page) + "/"
                }
                return base
        case "short":
                base := "/c/" + catID
                if page > 1 {
                        return base + "/" + strconv.Itoa(page)
                }
                return base
        case "classic":
                base := "/category-" + catID
                if page > 1 {
                        return base + "-" + strconv.Itoa(page) + ".html"
                }
                return base + ".html"
        case "dir":
                base := "/category/" + catID + "/"
                if page > 1 {
                        return base + strconv.Itoa(page) + "/"
                }
                return base
        case "hashid":
                base := "/c/" + hashidEncode(catID) + ".html"
                if page > 1 {
                        // hashid 风格无标准 page 段约定, 用 query 串附加 page.
                        return base + "?page=" + strconv.Itoa(page)
                }
                return base
        case "base62":
                base := "/c/" + base62Encode(catID)
                if page > 1 {
                        return base + "/" + strconv.Itoa(page)
                }
                return base
        case "segmented":
                if len(catID) < 2 {
                        // cuid 过短 fallback slug.
                        base := "/category/" + catID + "/"
                        if page > 1 {
                                return base + "page-" + strconv.Itoa(page) + "/"
                        }
                        return base
                }
                a := catID[:2]
                b := catID[2:]
                base := "/category/" + a + "/" + b
                if page > 1 {
                        return base + "/" + strconv.Itoa(page) + ".html"
                }
                return base + ".html"
        }
        if page > 1 {
                return "/?view=category&cat=" + catID + "&page=" + strconv.Itoa(page)
        }
        return "/?view=category&cat=" + catID
}

// buildPagerURL — 无实体 ID 的列表视图分页 URL (ranking/fulltext/search/keyword) (R63-A).
//   这些视图的 URL 不含实体 cuid (只有 page), 伪静态风格不区分; 统一用 query 串.
//   id 参数: ranking=sort, fulltext="", search=q, keyword=tag.
func buildPagerURL(style, view, id string, page int) string {
        _ = style // 不分风格, 统一 query 串
        if page < 1 {
                page = 1
        }
        q := "?view=" + view
        if id != "" {
                // R64-D BUG-32: URL-encode id (sort/q/tag) 防 & ? = + 等特殊字符分裂 query 串.
                //   原代码直接拼接 `&sort=` + id, 若 id 含 & (e.g. 搜索词 "abc&def") →
                //   URL `?view=search&q=abc&def&page=2` 被 server 解析为 q="abc" + 多余 def 参数,
                //   翻页时丢失 &def 部分 → 搜索结果不一致.
                encoded := url.QueryEscape(id)
                switch view {
                case "ranking":
                        q += "&sort=" + encoded
                case "search":
                        q += "&q=" + encoded
                case "keyword":
                        q += "&tag=" + encoded
                }
        }
        if page > 1 {
                q += "&page=" + strconv.Itoa(page)
        }
        return "/" + q
}

// --- URL parser (path → view + token + page) ---

// pseudoPattern — 单条伪静态 URL 模式 (R63-A).
//   re: 已编译的 regex, 含捕获组.
//   view: 解析出的 view 名 (book/read/category).
//   idGroups: 拼接成 cuid 的捕获组索引列表 (segmented=2 组, 其它=1 组).
//   pageGroup: page 的捕获组索引 (0 表示无 page).
type pseudoPattern struct {
        re        *regexp.Regexp
        view      string
        idGroups  []int
        pageGroup int
}

// 伪静态 URL regex 模式 (R63-A). 按 view 分组, 每风格独立.
//   注: numeric 与 alphanumeric 共用同一 regex (token 格式都为 [A-Za-z0-9]+.html),
//   decode 时按 style 区分 (numeric 用 numericHash, alphanumeric 用 first6Digits).
var (
        // numeric / alphanumeric: /book/{token}.html, /read/{token}.html, /category/{token}/{page}.html
        reNumericBook       = regexp.MustCompile(`^/book/([A-Za-z0-9]+)\.html$`)
        reNumericRead       = regexp.MustCompile(`^/read/([A-Za-z0-9]+)\.html$`)
        reNumericCategory   = regexp.MustCompile(`^/category/([A-Za-z0-9]+)/(\d+)\.html$`)

        // slug: /book/{cuid}/, /read/{cuid}/, /category/{cuid}/page-{page}/
        reSlugBook          = regexp.MustCompile(`^/book/([A-Za-z0-9]+)/$`)
        reSlugRead          = regexp.MustCompile(`^/read/([A-Za-z0-9]+)/$`)
        reSlugCategory      = regexp.MustCompile(`^/category/([A-Za-z0-9]+)/page-(\d+)/$`)

        // short: /b/{cuid}, /r/{cuid}, /c/{cuid}/{page}
        reShortBook         = regexp.MustCompile(`^/b/([A-Za-z0-9]+)$`)
        reShortRead         = regexp.MustCompile(`^/r/([A-Za-z0-9]+)$`)
        reShortCategory     = regexp.MustCompile(`^/c/([A-Za-z0-9]+)/(\d+)$`)

        // classic: /book-{cuid}.html, /read-{cuid}.html, /category-{cuid}-{page}.html
        reClassicBook       = regexp.MustCompile(`^/book-([A-Za-z0-9]+)\.html$`)
        reClassicRead       = regexp.MustCompile(`^/read-([A-Za-z0-9]+)\.html$`)
        reClassicCategory   = regexp.MustCompile(`^/category-([A-Za-z0-9]+)-(\d+)\.html$`)

        // dir: /book/{cuid}/ (book), /book/{cuid}/chapter/{chCuid}.html (read), /category/{cuid}/{page}/ (category)
        reDirBook           = regexp.MustCompile(`^/book/([A-Za-z0-9]+)/$`)
        reDirRead           = regexp.MustCompile(`^/book/([A-Za-z0-9]+)/chapter/([A-Za-z0-9]+)\.html$`)
        reDirCategory       = regexp.MustCompile(`^/category/([A-Za-z0-9]+)/(\d+)/$`)

        // hashid: /b/{hash}.html, /r/{hash}.html  (注意 .html 后缀区别于 short/base62)
        reHashidBook        = regexp.MustCompile(`^/b/([A-Za-z0-9]+)\.html$`)
        reHashidRead        = regexp.MustCompile(`^/r/([A-Za-z0-9]+)\.html$`)
        reHashidCategory    = regexp.MustCompile(`^/c/([A-Za-z0-9]+)\.html$`)

        // base62: /b/{token}, /r/{token}  (无 .html; 与 short 同 regex, 但 decode 用 base62Decode)
        // 复用 reShortBook / reShortRead / reShortCategory.

        // segmented: /book/{2chars}/{rest}.html, /read/{2chars}/{rest}.html, /category/{2chars}/{rest}/{page}.html
        reSegmentedBook     = regexp.MustCompile(`^/book/([A-Za-z0-9]{2})/([A-Za-z0-9]+)\.html$`)
        reSegmentedRead     = regexp.MustCompile(`^/read/([A-Za-z0-9]{2})/([A-Za-z0-9]+)\.html$`)
        reSegmentedCategory = regexp.MustCompile(`^/category/([A-Za-z0-9]{2})/([A-Za-z0-9]+)/(\d+)\.html$`)
)

// pseudoPatternsByStyle — 按 style 索引的 patterns 表 (R63-A).
//   顺序: 同 style 内 book → read → category (按 view 优先级; book 最常访问).
var pseudoPatternsByStyle = map[string][]pseudoPattern{
        "numeric": {
                {reNumericBook, "book", []int{1}, 0},
                {reNumericRead, "read", []int{1}, 0},
                {reNumericCategory, "category", []int{1}, 2},
        },
        "alphanumeric": {
                {reNumericBook, "book", []int{1}, 0},
                {reNumericRead, "read", []int{1}, 0},
                {reNumericCategory, "category", []int{1}, 2},
        },
        "slug": {
                {reSlugBook, "book", []int{1}, 0},
                {reSlugRead, "read", []int{1}, 0},
                {reSlugCategory, "category", []int{1}, 2},
        },
        "short": {
                {reShortBook, "book", []int{1}, 0},
                {reShortRead, "read", []int{1}, 0},
                {reShortCategory, "category", []int{1}, 2},
        },
        "classic": {
                {reClassicBook, "book", []int{1}, 0},
                {reClassicRead, "read", []int{1}, 0},
                {reClassicCategory, "category", []int{1}, 2},
        },
        "dir": {
                {reDirBook, "book", []int{1}, 0},
                {reDirRead, "read", []int{2}, 0}, // dir-style read: chCuid is group 2
                {reDirCategory, "category", []int{1}, 2},
        },
        "hashid": {
                {reHashidBook, "book", []int{1}, 0},
                {reHashidRead, "read", []int{1}, 0},
                // hashid category 用 query 串 page, parser 不解析 (buildCategoryURL 已加 ?page=N)
                {reHashidCategory, "category", []int{1}, 0},
        },
        "base62": {
                {reShortBook, "book", []int{1}, 0},
                {reShortRead, "read", []int{1}, 0},
                {reShortCategory, "category", []int{1}, 2},
        },
        "segmented": {
                {reSegmentedBook, "book", []int{1, 2}, 0},
                {reSegmentedRead, "read", []int{1, 2}, 0},
                {reSegmentedCategory, "category", []int{1, 2}, 3},
        },
}

// parsePseudoStaticPath — 按 style 解析 path 为伪静态 URL (R63-A).
//   返回 (view, token, page, ok); token 为 URL 中的 ID 段 (cuid 或编码形式).
//   后续 decodePseudoStaticToken(token, style, view) 反查 cuid.
//   style="query" 或未知 style → ok=false (不解析, 由 homeHandler 走 query 串模式).
func parsePseudoStaticPath(path, style string) (view, token string, page int, ok bool) {
        patterns, exists := pseudoPatternsByStyle[style]
        if !exists {
                return "", "", 0, false
        }
        for _, p := range patterns {
                m := p.re.FindStringSubmatch(path)
                if m == nil {
                        continue
                }
                var sb strings.Builder
                for _, g := range p.idGroups {
                        if g < len(m) {
                                sb.WriteString(m[g])
                        }
                }
                pg := 1
                if p.pageGroup > 0 && p.pageGroup < len(m) {
                        if v, err := strconv.Atoi(m[p.pageGroup]); err == nil && v > 0 {
                                pg = v
                        }
                }
                return p.view, sb.String(), pg, true
        }
        return "", "", 0, false
}

// decodePseudoStaticToken — 反查 URL token → entity cuid (R63-A).
//   可逆风格 (slug/short/classic/dir/segmented): token IS cuid (segmented 已在 parser concat).
//   base62: 用 math/big 反解 (无需 DB 命中).
//   不可逆风格 (numeric/alphanumeric/hashid): DB 扫描 entity 表, 按 encode 函数比对.
//   失败返 "" (homeHandler 404).
func decodePseudoStaticToken(token, style, viewType string) string {
        switch style {
        case "numeric":
                return findEntityByEncodedToken(token, viewType, numericHash)
        case "alphanumeric":
                return decodeAlphanumericToken(token, viewType)
        case "hashid":
                return findEntityByEncodedToken(token, viewType, hashidEncode)
        case "base62":
                if cuid, ok := base62Decode(token); ok {
                        return cuid
                }
                return ""
        case "segmented":
                // parser 已 concat (idGroups={1,2}), token = 完整 cuid.
                return token
        case "slug", "short", "classic", "dir":
                // token IS cuid
                return token
        }
        return ""
}

// decodeAlphanumericToken — alphanumeric 风格 token 反查 cuid (R63-A).
//   token 格式 = 字母前缀 (b/c/d) + 6 位数字.
//   按 viewType 校验前缀 (book=b, read=c, category=d), 剥前缀后用 6 位数字 DB 扫描.
//   返回 cuid 或 "".
func decodeAlphanumericToken(token, viewType string) string {
        if len(token) < 2 {
                return ""
        }
        prefix := token[:1]
        digits := token[1:]
        var expectedPrefix string
        switch viewType {
        case "book":
                expectedPrefix = "b"
        case "read":
                expectedPrefix = "c"
        case "category":
                expectedPrefix = "d"
        default:
                return ""
        }
        if prefix != expectedPrefix {
                return ""
        }
        // DB 扫描: 对每个 entity id, first6Digits(id) == digits 则命中.
        return findEntityByEncodedToken(digits, viewType, first6Digits)
}

// findEntityByEncodedToken — DB 扫描 entity 表, 找 encodeFunc(id) == token 的 id (R63-A).
//   用于 numericHash/hashidEncode/first6Digits 等不可逆编码的反查.
//   viewType: book → Book 表, read → Chapter 表, category → Category 表.
//   性能: O(N) 全表扫描; N=1000 时 ~10ms, 可接受. R64 可加缓存或冗余列优化.
func findEntityByEncodedToken(token, viewType string, encodeFunc func(string) string) string {
        if token == "" || encodeFunc == nil {
                return ""
        }
        var table string
        switch viewType {
        case "book":
                table = "Book"
        case "read":
                table = "Chapter"
        case "category":
                table = "Category"
        default:
                return ""
        }
        rows, err := db.Query(`SELECT id FROM ` + table)
        if err != nil {
                return ""
        }
        defer rows.Close()
        for rows.Next() {
                var id string
                if err := rows.Scan(&id); err != nil {
                        continue
                }
                if encodeFunc(id) == token {
                        return id
                }
        }
        return ""
}

// bookIDFromMap — 从 book map 安全提取 id (R63-A).
//   用于 homeHandler read view 中 buildChapterURL 的 bookID 参数.
func bookIDFromMap(book map[string]interface{}) string {
        if book == nil {
                return ""
        }
        if id, ok := book["id"].(string); ok {
                return id
        }
        return ""
}
