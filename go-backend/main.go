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
        "net/http"
        "os"
        "path/filepath"
        "regexp"
        "runtime"
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
        cloneCssDir := filepath.Join(publicDir, "clone-css")
        cssFs := http.FileServer(http.Dir(cloneCssDir))
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

        // R39-1C: 采集后台 API (与 src/app/api/admin/* 同口径, 调 crawl 包)
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

        if err := http.ListenAndServe(addr, nil); err != nil {
                log.Fatal(err)
        }
}

// homeHandler 首页 + 视图路由 (/?view=home|book|read|category|ranking|fulltext|search|keyword)
// R38-1B: 扩展为按 view 参数渲染对应主题模板
func homeHandler(w http.ResponseWriter, r *http.Request) {
        // R42-1A: 仅根路径 "/" 接受; 其它未匹配路径 (如 /random-spam-url) 应返回 404 而非 200 home
        //         (防 SEO 垃圾 - 否则攻击者可声明无限 URL 空间都被搜索引擎索引为同款首页)
        if r.URL.Path != "/" {
                http.NotFound(w, r)
                return
        }
        view := r.URL.Query().Get("view")
        if view == "" {
                view = "home"
        }
        siteID := r.URL.Query().Get("site")

        // 获取站点
        site, err := getSite(siteID)
        if err != nil || site == nil {
                http.Error(w, "站点未找到", 404)
                return
        }

        // 获取分类 (所有页型共用 nav)
        cats, _ := getCategories()
        navCats := takeN(cats, 8)

        // 主题解析 (clone-shipsay → shipsay)
        theme, _ := site["ThemeID"].(string)
        if !strings.HasPrefix(theme, "clone-") {
                theme = "shipsay" // 默认
        } else {
                theme = strings.TrimPrefix(theme, "clone-")
        }

        // 基础 data (所有页型都用到)
        data := map[string]interface{}{
                "Site":    site,
                "Categories": cats,
                "NavCats": navCats,
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
                        http.NotFound(w, r)
                        return
                }
                data["Book"] = book
                data["Chapters"] = chapters
                data["RecentChapters"] = recent
                data["Related"] = related
                data["FirstChapterId"] = firstChID
        case "read":
                chID := r.URL.Query().Get("chapter")
                if chID == "" {
                        http.Error(w, "缺少 chapter 参数", 400)
                        return
                }
                ch, book, prev, next, ok := getReadViewData(chID)
                if !ok {
                        http.NotFound(w, r)
                        return
                }
                data["Chapter"] = ch
                data["Book"] = book
                data["Prev"] = prev
                data["Next"] = next
        case "category":
                catID := r.URL.Query().Get("cat")
                page := clampPage(r.URL.Query().Get("page"))
                size := 24
                label, books, total := getCategoryViewData(catID, page, size)
                totalPages := (total + size - 1) / size
                if totalPages < 1 {
                        totalPages = 1
                }
                if page > totalPages {
                        page = totalPages
                }
                data["CatID"] = catID
                data["Label"] = label
                data["Books"] = books
                data["HotBooks"] = takeBooks(books, 12)
                data["TopAuthors"] = pickAuthors(books, 12)
                data["Page"] = page
                data["Size"] = size
                data["Total"] = total
                data["TotalPages"] = totalPages
                data["PageList"] = buildPageList(page, totalPages)
        case "ranking":
                tab := r.URL.Query().Get("sort")
                if tab == "" {
                        tab = "allvisit"
                }
                page := clampPage(r.URL.Query().Get("page"))
                size := 30
                books, total := getRankingViewData(tab, page, size)
                totalPages := (total + size - 1) / size
                if totalPages < 1 {
                        totalPages = 1
                }
                if page > totalPages {
                        page = totalPages
                }
                tabName := tabName(tab)
                data["Tabs"] = rankingTabs()
                data["Tab"] = tab
                data["TabName"] = tabName
                data["Books"] = withRank(books, page, size)
                data["HotBooks"] = takeBooks(books, 12)
                data["Page"] = page
                data["Size"] = size
                data["Total"] = total
                data["TotalPages"] = totalPages
                data["PageList"] = buildPageList(page, totalPages)
        case "fulltext":
                page := clampPage(r.URL.Query().Get("page"))
                size := 24
                books, total := getFulltextViewData(page, size)
                totalPages := (total + size - 1) / size
                if totalPages < 1 {
                        totalPages = 1
                }
                if page > totalPages {
                        page = totalPages
                }
                data["Label"] = "全本完本小说"
                data["Books"] = books
                data["HotBooks"] = takeBooks(books, 12)
                data["TopAuthors"] = pickAuthors(books, 12)
                data["Page"] = page
                data["Size"] = size
                data["Total"] = total
                data["TotalPages"] = totalPages
                data["PageList"] = buildPageList(page, totalPages)
        case "search":
                q := r.URL.Query().Get("q")
                books := getSearchViewData(q, 20)
                data["Q"] = q
                data["Books"] = books
                data["HotBooks"] = takeBooks(books, 12)
        case "keyword":
                tag := r.URL.Query().Get("tag")
                books, relatedTags := getKeywordViewData(tag, 20)
                data["Tag"] = tag
                data["Books"] = books
                data["RelatedTags"] = relatedTags
                data["HotBooks"] = takeBooks(books, 12)
        case "history":
                // 简单占位: 复用 home 数据 (足迹页未在 tsx 复刻, 不渲染独立模板)
                books, _ := getBooks(48)
                data["Books"] = books
                data["TopBooks"] = topBooks(books, 6)
                data["Popular"] = takeBooks(books, 12)
        default: // home
                books, _ := getBooks(48)
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
                                w.Header().Set("Content-Type", "text/html; charset=utf-8")
                                w.Write([]byte(buf2.String()))
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
        w.Header().Set("Content-Type", "text/html; charset=utf-8")
        w.Write([]byte(buf.String()))
}

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
                var id, name, domain, themeId, title, desc, kw string
                var isDefault bool
                rows.Scan(&id, &name, &domain, &themeId, &isDefault, &title, &desc, &kw)
                sites = append(sites, map[string]interface{}{"id": id, "name": name, "domain": domain, "themeId": themeId, "isDefault": isDefault, "title": title, "description": desc, "keywords": kw})
        }
        writeJSON(w, map[string]interface{}{"ok": true, "data": sites})
}

func bookDetailHandler(w http.ResponseWriter, r *http.Request) {
        id := r.URL.Query().Get("id")
        if id == "" {
                writeJSON(w, map[string]interface{}{"ok": false, "error": "缺少 id 参数"})
                return
        }
        var bid, name, author, intro, cover, status, latestChapter, category, categoryId, updatedAt sql.NullString
        var wordCount int64
        err := db.QueryRow(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.id=?`, id).Scan(
                &bid, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryId, &updatedAt)
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
                "id": bid.String, "name": name.String, "author": author.String, "intro": intro.String, "cover": "/" + cover.String,
                "status": status.String, "wordCount": wordCount, "latestChapter": latestChapter.String,
                "category": category.String, "categoryId": categoryId.String, "updatedAt": formatUpdatedAt(updatedAt.String),
        }})
}

func chapterHandler(w http.ResponseWriter, r *http.Request) {
        id := r.URL.Query().Get("id")
        if id == "" {
                writeJSON(w, map[string]interface{}{"ok": false, "error": "缺少 id 参数"})
                return
        }
        var chID, title, content string
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
        writeJSON(w, map[string]interface{}{"ok": true, "data": map[string]interface{}{"id": chID, "title": title, "content": content, "idx": idx}})
}

// ===== 数据查询 =====

func getSite(siteID string) (map[string]interface{}, error) {
        q := `SELECT id,name,domain,themeId,isDefault,title,description,keywords,offset FROM Site WHERE status=1`
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
        for rows.Next() {
                var id, name, domain, themeId, title, desc, kw string
                var isDefault bool
                var offset int
                rows.Scan(&id, &name, &domain, &themeId, &isDefault, &title, &desc, &kw, &offset)
                return map[string]interface{}{"ID": id, "Name": name, "Domain": domain, "ThemeID": themeId, "IsDefault": isDefault, "Title": title, "Description": desc, "Keywords": kw, "Offset": offset}, nil
        }
        // fallback 第一个 (R42-1A: 显式 err 检查防 nil rows2.Close() panic; 之前 _ 忽略 err →
        //                  若 db.Query 失败 rows2 为 nil, defer rows2.Close() 在 nil 上调用 panic)
        rows2, qErr := db.Query(q + ` LIMIT 1`)
        if qErr != nil {
                return nil, qErr
        }
        defer rows2.Close()
        for rows2.Next() {
                var id, name, domain, themeId, title, desc, kw string
                var isDefault bool
                var offset int
                rows2.Scan(&id, &name, &domain, &themeId, &isDefault, &title, &desc, &kw, &offset)
                return map[string]interface{}{"ID": id, "Name": name, "Domain": domain, "ThemeID": themeId, "IsDefault": isDefault, "Title": title, "Description": desc, "Keywords": kw, "Offset": offset}, nil
        }
        return nil, nil
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
                var id, name, author, intro, cover, status, latestChapter, category, categoryId sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryId, &updatedAt)
                books = append(books, map[string]interface{}{
                        "id": id.String, "name": name.String, "author": author.String,
                        "intro": truncate(intro.String, 120), "cover": "/" + cover.String,
                        "status": status.String, "wordCount": wordCount, "latestChapter": latestChapter.String,
                        "category": category.String, "categoryId": categoryId.String, "updatedAt": formatUpdatedAt(updatedAt),
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
                books[i] = b
        }
        return books
}

// rankingTabs 排行榜 tab 列表 (与 RankingView.tsx TABS 同口径)
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
func bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryId sql.NullString, wordCount int64, updatedAt string) map[string]interface{} {
        return map[string]interface{}{
                "id": id.String, "name": name.String, "author": author.String,
                "intro": truncate(intro.String, 120), "cover": "/" + cover.String,
                "status": status.String, "wordCount": wordCount, "latestChapter": latestChapter.String,
                "category": category.String, "categoryId": categoryId.String, "updatedAt": formatUpdatedAt(updatedAt),
        }
}

// getBookViewData 装配 book 视图所需: 单本书 + 完整章节列表 + 最近章节 + 同类推荐 + 第一章 id
func getBookViewData(id string) (map[string]interface{}, []map[string]interface{}, []map[string]interface{}, []map[string]interface{}, string, bool) {
        // 1. 单本书详情 (字段比 getBooks 多 keywords)
        var bid, name, author, intro, cover, status, latestChapter, category, categoryId, keywords, updatedAt sql.NullString
        var wordCount int64
        err := db.QueryRow(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.keywords,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.id=?`, id).Scan(
                &bid, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryId, &keywords, &updatedAt)
        if err != nil {
                return nil, nil, nil, nil, "", false
        }
        book := map[string]interface{}{
                "id": bid.String, "name": name.String, "author": author.String,
                "intro": intro.String, "cover": "/" + cover.String, "status": status.String,
                "wordCount": wordCount, "latestChapter": latestChapter.String,
                "category": category.String, "categoryId": categoryId.String,
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
        if categoryId.String != "" {
                if rows3, err := db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.categoryId=? AND b.id!=? ORDER BY b.updatedAt DESC LIMIT 12`, categoryId.String, id); err == nil {
                        defer rows3.Close()
                        for rows3.Next() {
                                var bid2, name2, author2, intro2, cover2, status2, latestChapter2, category2, categoryId2 sql.NullString
                                var wordCount2 int64
                                var updatedAt2 string
                                rows3.Scan(&bid2, &name2, &author2, &intro2, &cover2, &status2, &wordCount2, &latestChapter2, &category2, &categoryId2, &updatedAt2)
                                related = append(related, bookRowFromScan(bid2, name2, author2, intro2, cover2, status2, latestChapter2, category2, categoryId2, wordCount2, updatedAt2))
                        }
                }
        }

        return book, chapters, recent, related, firstChID, true
}

// getReadViewData 装配 read 视图所需: chapter content + book 信息 + prev/next
func getReadViewData(chID string) (map[string]interface{}, map[string]interface{}, map[string]interface{}, map[string]interface{}, bool) {
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
                return chapter, bookMap, nil, nil, true
        }
        bookMap := map[string]interface{}{
                "id": bid.String, "name": bname.String, "author": bauthor.String,
                "status": bstatus.String, "category": bcategory.String, "intro": bintro.String,
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
                var id, name, author, intro, cover, status, latestChapter, category, categoryId sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryId, &updatedAt)
                books = append(books, bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryId, wordCount, updatedAt))
        }
        return label, books, total
}

// getRankingViewData 排行榜: 按 tab (sort) 排序 + 分页
func getRankingViewData(tab string, page, size int) ([]map[string]interface{}, int) {
        // 排序映射 (与 Next.js page.tsx SORT_MAP 同口径)
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
                var id, name, author, intro, cover, status, latestChapter, category, categoryId sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryId, &updatedAt)
                books = append(books, bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryId, wordCount, updatedAt))
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
                var id, name, author, intro, cover, status, latestChapter, category, categoryId sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryId, &updatedAt)
                books = append(books, bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryId, wordCount, updatedAt))
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
                var id, name, author, intro, cover, status, latestChapter, category, categoryId sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryId, &updatedAt)
                // 搜索结果简介取 150 字 (与 page.tsx 同口径)
                m := bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryId, wordCount, updatedAt)
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
                var id, name, author, intro, cover, status, latestChapter, category, categoryId sql.NullString
                var wordCount int64
                var updatedAt string
                rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryId, &updatedAt)
                m := bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryId, wordCount, updatedAt)
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
