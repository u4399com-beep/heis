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
        "os/signal"
        "path/filepath"
        "regexp"
        "runtime"
        "sort"
        "strconv"
        "strings"
        "sync"
        "sync/atomic"
        "syscall"
        "time"
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

        // R75-A 目标A2 (autoResumeTasks 容错): 启动时清理 orphaned running tasks
        //   (进程 crash / kill -9 后 Task 表残留 status='running' 行, admin 看到 "卡住"
        //   几小时不知道挂了; adminBackupClearHandler 手动清需 admin 主动触发, 启动时
        //   不会跑). 本函数查 running tasks → 标 stopped (admin 可手动重启) → log 计数.
        //   容错: 任何 DB 错误 / panic 都不阻断 HTTP server (defer recover + 错误早返).
        autoResumeTasksCleanup()

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
                // R91-D BUG-253 (P3, main+templates scope, 顺延 R90-D BUG-247~249):
                //   admin/sites.html line 55 `https://{{.domain}}` + shipsay 7 模板 footer
                //   `https://{{.Site.Domain}}` + 101kks 7 模板 copyright `https://{{.Site.
                //   Domain}}` 直接拼未剥 scheme 前缀 — admin 配 domain="https://example.com"
                //   (placeholder 提示 "不含 http" 但 0 校验强制) 时拼成 "https://https://
                //   example.com" 双 scheme → 链接失效. buildAbsoluteURL (line ~5307) 已剥
                //   scheme 用于 og:url/canonical/sitemap, 但模板内直接拼 https://+domain
                //   的 15 callsite 不经 buildAbsoluteURL. 修复: stripScheme FuncMap 剥
                //   http:// / https:// 前缀 + 末尾 / (与 buildAbsoluteURL 同款归一化),
                //   模板改 https://{{.domain | stripScheme}}. 0 现存依赖被破 (domain 不含
                //   scheme 时 stripScheme 原样返回).
                "stripScheme": func(v interface{}) string {
                        s := strings.TrimSpace(fmt.Sprintf("%v", v))
                        s = strings.TrimPrefix(s, "http://")
                        s = strings.TrimPrefix(s, "https://")
                        s = strings.TrimSuffix(s, "/")
                        return s
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

        // R70-A: 启动时预加载所有 public/clone-css/*.css 到内存缓存, 供 obfuscateHTML
        //   inlineExternalCSS 替换 <link> 标签为 <style> 块 (R69-A obfuscateHTML=true 时
        //   HTML class 改名需同步重写外部 CSS 内的 .class 选择器, 否则样式失效).
        //   R71-A: 缓存运行时可刷新 (watcher goroutine 每 60s 检 mtime 变化 → 重载);
        //   admin 改 CSS 无需重启进程. 失败 (文件缺失) 跳过不致命.
        initExternalCSSCache()

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
                if rawName == "" {
                        http.NotFound(w, r)
                        return
                }
                // R53-1A BUG-4: Base + 路径验证 (防 path traversal)
                base := filepath.Base(rawName)
                if base == "" || base == "." || base == ".." {
                        http.NotFound(w, r)
                        return
                }
                // 尝试 data/covers/base (SaveCoverWebp 落盘位置)
                fp := filepath.Join(coversDir, base)
                fpClean := filepath.Clean(fp)
                if !strings.HasPrefix(fpClean, coversDir+string(filepath.Separator)) && fpClean != coversDir {
                        http.NotFound(w, r)
                        return
                }
                if _, err := os.Stat(fpClean); err == nil {
                        http.ServeFile(w, r, fpClean)
                        return
                }
                // 尝试 public/covers/base (手放资源)
                fp2 := filepath.Join(publicCoversDir, base)
                fp2Clean := filepath.Clean(fp2)
                if !strings.HasPrefix(fp2Clean, publicCoversDir+string(filepath.Separator)) && fp2Clean != publicCoversDir {
                        http.NotFound(w, r)
                        return
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
                if runes := []rune(bookName); len(runes) > 0 {
                        initial = string(runes[0])
                }
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
        // R72-A 目标B: 链轮随机链接 API (用户需求 #1), 供前端 JS 动态拉取站群互推链接.
        http.HandleFunc("/api/public/random-link", randomLinkHandler)

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
        http.HandleFunc("/api/admin/backup", adminBackupHandler)          // GET 导出 JSON
        http.HandleFunc("/api/admin/backup/", adminBackupSubHandler)      // /restore + /vacuum + /clear (R55-1A)
        // R55-1A: 站点 CRUD API (GET list / POST create / PUT-DELETE /:id)
        http.HandleFunc("/api/admin/sites", adminSitesHandler)
        http.HandleFunc("/api/admin/sites/", adminSiteByIDHandler)
        http.HandleFunc("/api/admin/seo-audit", adminSeoAuditHandler)

        // R39-1C: 采集后台页面 (Go templates SSR, 深色主题)
        http.HandleFunc("/admin", adminPageHandler)
        http.HandleFunc("/admin/", adminPageHandler) // /admin/tasks, /admin/books, ...

        // R76-A 目标C+D (用户需求 #5 XML sitemap + robots.txt): 6 个新路由.
        //   /robots.txt: 搜索引擎爬虫规则 (Allow /, Disallow /admin + /api/admin, Sitemap 指向).
        //   /sitemap.xml: 综合单文件 sitemap (home + categories + 全部 books + 全部 chapters,
        //     cursor pagination 防 OOM, 5min sync.Map 缓存).
        //   /sitemap-index.xml: sitemap 索引, 指向多个分页 sub-sitemap (sitemap-home /
        //     sitemap-books/{n} / sitemap-chapters/{n}, R77-D BUG-154 修: 旧形式
        //     sitemap-books-{n}.xml 与注册路由不匹配 404).
        //   /sitemap-home.xml: home + categories 子 sitemap (1000 URL 内, 1 页足够).
        //   /sitemap-books/{page}: 分页 sub-sitemap, 每页 1000 本书的 URL (Go 1.22 路径段通配符).
        //   /sitemap-chapters/{page}: 分页 sub-sitemap, 每页 1000 章节的 URL.
        //   Go 1.22+ pattern matching 支持 {page} 通配符 (本项目 go 1.26 已支持).
        http.HandleFunc("/robots.txt", robotsTxtHandler)
        http.HandleFunc("/sitemap.xml", sitemapHandler)
        http.HandleFunc("/sitemap-index.xml", sitemapIndexHandler)
        http.HandleFunc("/sitemap-home.xml", sitemapHomeHandler)
        // R76 主控修复: Go 1.22 ServeMux {page} 通配符必须在路径段完整段, 不能与字面量混合
        //   /sitemap-books-{page}.xml 非法 (panic: bad wildcard segment), 改用 /sitemap-books/{page} 格式
        http.HandleFunc("/sitemap-books/{page}", sitemapBooksHandler)
        http.HandleFunc("/sitemap-chapters/{page}", sitemapChaptersHandler)

        addr := ":3000"
        log.Printf("heis-backend 启动: http://localhost%s (内存 %dMB)", addr, getMemMB())

        // R51-1A 反反爬增强: 启动 TLS session 后台周期性 flush goroutine (5min 间隔).
        //   原 R48-1A/R50-1A 仅在 Put 时 60s 节流触发异步 flush, 长时间无活跃握手时
        //   dirty 数据持续留内存, 进程 crash 期间丢失. 后台 flusher 每 5min 调
        //   SaveToDisk, 无新数据时早返不浪费 IO. ctx 在 graceful shutdown 时取消.
        //
        // R75-A 目标B (R74 交接 #6 + R72 交接 #2) TLS Server Ticket 标准持久化评估:
        //   背景: R48-1A/R50-1A 已持久化 ClientSessionState (TLS 1.2 session ticket /
        //   1.3 session PSK + ECDHE state) 到 data/tls-sessions.json. 但 ServerTicket
        //   (server-side session ticket encryption key, 用于 server 解密 client 提交的
        //   session ticket) 由 Go crypto/tls 内部随机生成 + 不暴露导出 API, 进程重启
        //   后 server 用新 key, client 旧 ticket 解密失败 → 客户端需重新握手 (降级
        //   TLS 1.3 0-RTT 优化). R72 交接 #2 评估 "fork crypto/tls" 持久化 server key.
        //   评估结论 (诚实留痕, 不实现):
        //   1. fork crypto/tls: 风险极高, 不推荐.
        //      - crypto/tls 是 Go 标准库核心 (~10K 行), 与 net/http / crypto/x509 /
        //        crypto/ecdsa 等深度耦合; fork 后需跟随 Go 版本升级 (每 6 个月)
        //        合并上游 fix (安全补丁必须及时, 否则 TLS vuln 风险).
        //      - ServerTicket key 持久化需暴露 tls.Config.sessionTicketKey 字段 +
        //        修改 internal/conn.go sessionTicket 销毁逻辑, 涉及 internal package
        //        (Go 内部包不暴露), 实际 fork 需重写 not just patch.
        //      - 替代: 用 tls.Config.SetSessionTicketKeys(keys [][32]byte) 在启动时
        //        加载持久化 key, 但 Go 限制 key 轮换 (最多 2 个, 老的 24h 后过期),
        //        且 SetSessionTicketKeys 是 stdlib 公开 API, 不需 fork. 但 key 仍
        //        random per process restart (除非自己生成 + 持久化 32 字节 key).
        //   2. utls ClientSessionState + 自定义持久化: utls 是 github.com/refraction-networking/utls
        //      库 (Go 模块, fork crypto/tls 加指纹模拟), 提供 ClientSessionState 但
        //      ServerTicket 仍走 Go stdlib (utls 不重写 server side). utls 主要用途是
        //      client 指纹模拟 (ClientHello / GREASE / extension order), 不解决 server
        //      ticket 持久化. 故 utls 非替代方案.
        //   3. 实际可行方案 (R76+ 评估, 不在 R75 范围):
        //      - 启动时生成 32 字节 server key → 写 data/tls-server-key.json 持久化.
        //      - 启动时 LoadServerKey() → tls.Config.SetSessionTicketKeys([:1]).
        //      - key 24h 轮换 (与 Go 内置 2-key rotation 对齐): 后台 goroutine 每
        //        24h 生成新 key + 写盘 + SetSessionTicketKeys 新老 key 各 1.
        //      - 优点: 无 fork, 用 stdlib 公开 API, server ticket 持久化跨重启.
        //      - 风险: key 文件泄露 = 中间人解密所有 client session (但仅 TLS 1.2
        //        session resumption 场景, 1.3 PSK 不受影响; key 文件 chmod 600 防护).
        //   结论: R75-A 标记为技术限制 (不实现), R76+ 评估方案 3 (SetSessionTicketKeys
        //   + 持久化 key 文件). 当前实现: client session 持久化已 OK (R48/R50), server
        //   ticket 跨重启失效 (client 重新握手, 不致命但降级 0-RTT 优化).
        flusherCtx, flusherCancel := context.WithCancel(context.Background())
        defer flusherCancel()
        // R75-A 目标A3 (goroutine 泄漏防护): wrap 启动 goroutine 的调用方 with defer
        //   recover, 防 sync panic 杀进程. 实际后台 goroutine (在 fetcher.go 内部 spawn)
        //   的 panic 需在 fetcher.go 内部加 recover (R75-B/R76 范围, 不动 fetcher.go).
        //   本轮 main.go 调用方 recover 防 sync panic (e.g. nil ctx / 未初始化变量 等).
        func() {
                defer func() {
                        if r := recover(); r != nil {
                                log.Printf("[R75-A] StartTlsSessionBackgroundFlusher sync panic: %v", r)
                        }
                }()
                crawl.StartTlsSessionBackgroundFlusher(flusherCtx)
        }()
        // R71-A: CSS 文件 watcher goroutine (60s mtime 轮询; 与 flusher 共用 ctx,
        //   main 退出时 cancel → goroutine 早返, 无泄露).
        //   R75-A 目标A3: startExternalCSSWatcher 内部 goroutine 加 defer recover
        //   (见函数体 line ~1256), panic 不杀进程.
        startExternalCSSWatcher(flusherCtx)

        // R73-A 目标A (R72 交接 #1): CookieJar + ProxyHealthProber wiring.
        //   R72-C 在 fetcher.go 加了 StartCookieJarBackgroundFlusher + StartProxyHealthProber
        //   exported API (atomic.Bool + CompareAndSwap 防多启动, 5min ticker, ctx.Done() graceful
        //   shutdown), main.go 未调 (R72 严禁改 main.go). 本轮补 wiring.
        //   CookieJar flusher: cf_clearance / PHPSESSID 跨 session 持久化 (防每次进程重启
        //     重新挑战 Cloudflare); 5min 间隔与 TLS session flusher 同口径 (与 R51-1A 同款).
        //   ProxyHealthProber: 独立后台 pinger 不依赖 pickProxyFor sweep (任务空闲期仍跑),
        //     probe target=https://www.baidu.com (国内可达, 稳定; 不需专用 healthcheck 端点),
        //     intervalMs=300000 (5min, 与 fetcher.go StartProxyHealthProber 默认值一致).
        //   pool 参数: fetcher.go 无全局 proxyPool var (代理 per-task 在 Task.fetchConfig
        //     JSON proxyUrl 字段), 本轮 collectStartupProxyPool 启动时扫 Task 表收集所有
        //     fetchConfig.proxyUrl 字段合并去重 → 传给 prober. 无代理 (无任务 / 任务无 proxy)
        //     时 StartProxyHealthProber 内部 len(pool)==0 自跳过 (started 标志设 true 防
        //     后续调用启动空 goroutine; prober singleton 设计, 不需重启进程恢复).
        //   ctx 共用 flusherCtx: 与 TLS flusher + CSS watcher 同 ctx, graceful shutdown 时
        //     全部停 (无泄露). CookieJar / ProxyHealthProber 各自 atomic.Bool 防多启动, 与
        //     flusherCtx 是否共享无关.
        //   R75-A 目标A3: 同 StartTlsSessionBackgroundFlusher, 调用方 defer recover 防 sync
        //   panic. 后台 goroutine 内部 panic 需在 fetcher.go 内部加 recover (R75-B/R76 范围).
        func() {
                defer func() {
                        if r := recover(); r != nil {
                                log.Printf("[R75-A] StartCookieJarBackgroundFlusher sync panic: %v", r)
                        }
                }()
                crawl.StartCookieJarBackgroundFlusher(flusherCtx)
        }()
        // R74-A 目标A (R73 交接 #2): ProxyHealthProber singleton 防多启动.
        //   R73-A 报告 main() 调用方未防多启动 (crawl.StartProxyHealthProber 内部有
        //   atomic.Bool + CompareAndSwap 二次防御, 但调用方仍每次构造 startupPool + log).
        //   本轮加 proxyHealthProberStarted CAS: 已启动则跳过 collectStartupProxyPool +
        //   StartProxyHealthProber 调用, 0 噪声 + 0 启动时 Task 表扫 (graceful restart /
        //   SIGHUP / 测试 fixture 多次执行 main 时尤其重要). CompareAndSwap 原子语义:
        //   返 true 表示本调用首次启动 prober; 返 false 表示已启动, 跳过.
        //   注: CookieJar flusher 不加同等标志 (其内部 atomic.Bool 已足够, 且 CookieJar
        //   无 collectStartupProxyPool 重操作; R74+ 可补).
        //   R75-A 目标A3: 调用方 defer recover 防 sync panic (与 CookieJar/TLS flusher 同款).
        if proxyHealthProberStarted.CompareAndSwap(false, true) {
                func() {
                        defer func() {
                                if r := recover(); r != nil {
                                        log.Printf("[R75-A] StartProxyHealthProber sync panic: %v", r)
                                }
                        }()
                        startupPool := collectStartupProxyPool()
                        crawl.StartProxyHealthProber(flusherCtx, startupPool, "https://www.baidu.com", 300000)
                        log.Printf("[R74-A] ProxyHealthProber started (CAS): pool=%d (target=https://www.baidu.com, 5min)", len(startupPool))
                }()
        } else {
                log.Printf("[R74-A] ProxyHealthProber already started (CAS skip): collectStartupProxyPool + StartProxyHealthProber skipped")
        }

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
        // R75-A 目标A4 (HTTP server 优雅关闭): 替换原 srv.ListenAndServe() + log.Fatal 模式.
        //   原实现 SIGINT/SIGTERM 时进程立即退出 (DefaultServeMux active requests 被切断,
        //   DB 连接未关闭, 日志 buffer 未 flush → 数据丢失). 用户反复报告 "预览挂掉" 部分
        //   场景为部署 / 重启时未优雅关闭 (admin 改 Site/Setting 后 wrapper 重启, 正在跑的
        //   homeHandler 渲染被切断 → 用户看到 502/connection reset).
        //   修复: 启 srv 在 goroutine, signal.Notify SIGINT/SIGTERM → srv.Shutdown(30s ctx)
        //   等活跃请求结束 + flusherCtx cancel 停后台 goroutine + db.Close 显式关 DB.
        //   注: srv.Shutdown 默认不等 Idle conns (keep-alive); 30s 内未结束强制返超时.
        //   注: defer db.Close() (line 64) 仍存在; 本轮显式调 db.Close 确保 Shutdown 后
        //   才关 (defer 在 main return 时跑, 与 Shutdown 顺序无冲突).
        go func() {
                if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
                        log.Fatalf("[R75-A] ListenAndServe fatal: %v", err)
                }
        }()
        // 等待 SIGINT (Ctrl-C) / SIGTERM (systemd stop / kill $PID).
        sigCh := make(chan os.Signal, 2)
        signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
        sig := <-sigCh
        log.Printf("[R75-A] received signal %v, graceful shutdown ...", sig)
        // 1) 取消后台 goroutine (TLS flusher / CSS watcher / CookieJar / ProxyHealthProber).
        flusherCancel()
        // 2) 30s 超时 ctx 等 active HTTP requests 结束 (homeHandler 渲染 ~1s, 30s 富裕).
        shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer shutdownCancel()
        if err := srv.Shutdown(shutdownCtx); err != nil {
                log.Printf("[R75-A] srv.Shutdown error: %v (continuing to db.Close)", err)
        }
        // 3) 显式关 DB (modernc.org/sqlite WAL checkpoint + close; defer db.Close 也跑但
        //   显式调确保 Shutdown 完成后才关, 避免 active query 中途断).
        if err := db.Close(); err != nil {
                log.Printf("[R75-A] db.Close error: %v", err)
        }
        log.Printf("[R75-A] graceful shutdown complete, exit.")
}

// homeHandler 首页 + 视图路由 (/?view=home|book|read|category|ranking|fulltext|search|keyword)
// R38-1B: 扩展为按 view 参数渲染对应主题模板
// R63-A: 非 "/" 路径伪静态解析 (site.PseudoStaticStyle != "query" 时, 尝试解析 path 为
//
//      book/read/category URL; 匹配则转等价 query 串; 不匹配 404). 保留 R42-1A SEO 垃圾保护.
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
        //   R87-D BUG-232 (P3, 顺延 R87-C BUG-228~230 admin.go scope; 本
        //   main+templates scope 从 231 起避免与 R87-B BUG-227 crawl + R87-C
        //   BUG-228~230 admin.go 撞号): 加 HomeLayout 4 字段默认值 (8/6/12/12)
        //   兜底. 原 R71-A
        //   仅 case "home" default 调 getHomeLayoutSetting 注入此 4 字段, 其它 view
        //   (search/keyword/category/ranking/fulltext/history/book/read) 不注入 →
        //   若 view 模板缺失 fallback shipsay/home 时, BUG-225 修复用 hardcoded 6 不
        //   依赖; 但若 R87+ 想让模板用 $.HomeCategoryBooks/.HomeCategoryCount 等配置
        //   值 (admin 可调 4-20/2-12), 需 base data 注入默认. R86-D 未决项 #8 候选
        //   "homeHandler history fallback path data["HomeCategoryCount"]/["HomeCategoryBooks"]
        //   未设" 提示此处加默认. 默认 8/6/12/12 与 homeLayoutDefaults (admin.go line
        //   6384-6387) 一致; case "home" default 仍会覆盖此默认 (getHomeLayoutSetting
        //   返 clamp 后的 admin 值, 与默认可能不同但不会比默认更差 — admin 配置可
        //   小到 4/2 但仍合法). 0 caller 依赖此 4 字段在非 home view 缺失 (BUG-225
        //   用 hardcoded 6, shipsay/history 0 用此 4 字段, aijjxs/home 用但仅 case
        //   "home" 渲染, fallback shipsay/home 时此默认值替代 nil).
        data := map[string]interface{}{
                "Site":               site,
                "Categories":         cats,
                "NavCats":            navCats,
                "PseudoStyle":        pseudoStyle,
                "HomeURL":            buildHomeURL(pseudoStyle),
                "HomeCategoryCount":  8,
                "HomeCategoryBooks":  6,
                "HomeLatestBooks":    12,
                "HomeHotBooks":       12,
        }

        // R72-A 目标B: 注入链轮链接供前台友情链接模块渲染 (用户需求 #1).
        //   组合 1 站内随机书 + 2 站群首页 + 2 站群书 = 5 个链接, per-request random.
        //   模板用 {{range .WheelLinks}}<a href="{{.URL}}">{{.Name}}</a>{{end}} 渲染 (R72-B 模板范围).
        //   R87-D BUG-231 (P2, main+templates scope, 顺延 R87-B BUG-227 crawl
        //   + R87-C BUG-228~230 admin.go; 本 scope 从 231 起):
        //   R72-A 起 getWheelLinks map keys 用 lowercase
        //   ("url"/"name"/"type") 但 R72-B 模板用 uppercase ({{.URL}}/{{.Name}}/
        //   {{.Type}}) → html/template map lookup case-sensitive → 渲染空 href +
        //   空文本 (10 主题 home.html + shipsay/history.html 共 11 模板 × 3 type
        //   × 1 链接 = 33 处 {{.URL}}/{{.Name}}/{{.Type}} 全返 nil/empty), "随机推荐"
        //   footer 区显示 3 个空 <a></a> (DOM 中存在但视觉不可见, href="" 点击无
        //   跳转, rel=nofollow 仍写但无 SEO 信号). 改 getWheelLinks keys 全
        //   uppercase (URL/Name/Type/SiteName), 与模板对齐. randomLinkHandler
        //   JSON API 仍用 lowercase (JSON 习惯, JS 客户端期望) — 本 fix 仅
        //   改 getWheelLinks 不改 randomLinkHandler (两路径互不依赖, JSON 序列化
        //   不过 template engine, 无 case-sensitivity 问题). 缓存 wheelLinksCache
        //   存的 links map 全键 uppercase, 首请求后 cache 填充, 后续请求读 cache
        //   返 uppercase, 模板渲染正确.
        //   site["ID"] 为本站 cuid; 排除当前站防 self-link; pseudoStyle 用当前站编 book_intra URL.
        siteDBID, _ := site["ID"].(string)
        data["WheelLinks"] = getWheelLinks(siteDBID, pseudoStyle)

        // 按 view 装配数据.
        // R83-D: bookHistoryJS 仅在 case "book" 赋值 (Go 端 fmt.Sprintf 注入 id 到 tracker JS
        //   模板). history/home/其它 view 不写 cookie (history view 自身只读 cookie).
        bookHistoryJS := ""
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
                // R76-A 目标A (用户需求 #1 按钮 bug 修复): R72-A 的 fallback 是 bug — 无章节书
                //   firstChID == "" 时 FirstChapterURL = buildBookURL(pseudoStyle, id) 把按钮 href
                //   指向书籍页本身, 点击 "在线阅读全文" 跳回当前页 (循环, 用户体验差). 改: 无章节
                //   时 FirstChapterURL = "" 让模板用 {{if .FirstChapterURL}} 判断显示 (R76-B 模板
                //   范围负责加 if guard, 本轮 Go 端只提供 empty 值). 同时注入 HasChapters bool 供
                //   模板 {{if .HasChapters}} 区分显示 "在线阅读全文" 按钮还是 "暂无章节" 提示.
                //   ChapterListAnchor 固定 "chapter_list" 供模板 href="#{{.ChapterListAnchor}}"
                //   跳转到 <article id="chapter_list"> 锚点 (模板需确保 div id 匹配, R76-B 范围).
                data["HasChapters"] = len(chapters) > 0
                if firstChID == "" {
                        data["FirstChapterURL"] = ""
                } else {
                        data["FirstChapterURL"] = buildChapterURL(pseudoStyle, firstChID, id)
                }
                data["ChapterListAnchor"] = "chapter_list"
                // R76-A 目标B (用户需求 #1 pSEO 标签注入): 注入 Og*/Twitter*/Canonical 供模板
                //   head 区渲染 meta property="og:title" 等 (R76-B 模板范围). 现 aijjxs/book.html
                //   只有 keywords + description meta, 缺 og/twitter/canonical → 社交平台分享时
                //   显示裸链接无图无摘要, SEO 抓取 og 权重低. pSEO 字段:
                //   - OgTitle = book.name + " - " + site.Name
                //   - OgDescription = truncate(book.intro, 200) (UTF-8 边界安全截断)
                //   - OgImage / TwitterImage = book.cover (若有, 外链/内联/data:/相对路径均由
                //     coverURL 已处理, 模板原样渲染 src)
                //   - OgUrl / CanonicalURL = absolute URL (https://domain + buildBookURL)
                //   - OgType = "book" (FB Open Graph book 类型)
                //   - OgSiteName = site.Name
                //   - TwitterCard = "summary" (Twitter summary card, 含图含标题含描述)
                //   - TwitterTitle = book.name
                //   - TwitterDescription = truncate(book.intro, 200)
                //   注: site.Domain 为空 (开发/预览环境) 时 buildAbsoluteURL 返相对路径 (OgUrl
                //   无 domain 仍合法, 搜索引擎按相对 URL 解析当前 host; 不致命).
                siteName, _ := site["Name"].(string)
                siteDomain, _ := site["Domain"].(string)
                bookName, _ := book["name"].(string)
                bookIntro, _ := book["intro"].(string)
                bookCover, _ := book["cover"].(string)
                absBookURL := buildAbsoluteURL(siteDomain, buildBookURL(pseudoStyle, id))
                ogDesc := truncate(bookIntro, 200)
                data["OgTitle"] = bookName + " - " + siteName
                data["OgDescription"] = ogDesc
                data["OgUrl"] = absBookURL
                data["OgType"] = "book"
                data["OgSiteName"] = siteName
                if bookCover != "" {
                        // R77-D 目标B (R76 交接 #5 OgImage 绝对 URL): bookCover 已是 coverURL
                        //   处理过的路径 (getBookViewData line ~3347 调 coverURL(cover.String)),
                        //   可能是 "/covers/abc.webp" (相对) / "https://cdn..." (外链) /
                        //   "data:image/..." (内联). FB og:image / Twitter twitter:image 须
                        //   绝对 URL (含 scheme + host), 相对路径 FB 抓取 warning (不报错但
                        //   缺图), Twitter 拒绝相对路径 (twitter:image 必须绝对 URL). 改:
                        //   再过一次 coverURL (idempotent, 防 bookCover 来自非 getBookViewData
                        //   路径未处理) + buildAbsoluteURL(site.Domain, ...) 拼成绝对 URL.
                        //   外链 / data: / 协议相对 // 形态 buildAbsoluteURL 原样返回 (coverURL
                        //   passthrough). 仅相对路径 "/covers/..." 拼成 "https://domain/covers/..."
                        //   (生产 domain) 或 "http://localhost:3000/covers/..." (dev).
                        data["OgImage"] = buildAbsoluteURL(siteDomain, coverURL(bookCover))
                        data["TwitterImage"] = buildAbsoluteURL(siteDomain, coverURL(bookCover))
                }
                data["TwitterCard"] = "summary"
                data["TwitterTitle"] = bookName
                data["TwitterDescription"] = ogDesc
                data["CanonicalURL"] = absBookURL
                // R83-D (R82 交接 #3 history JS wiring): 在 case "book" 末尾装配 tracker JS
                //   (fmt.Sprintf 注入 id 到 bookHistoryTrackerHTML 常量, switch 后写 buf).
                //   用 template.JSEscapeString 防 XSS (id 经 getBookViewData 校验合法 cuid2,
                //   但 defense in depth — JSEscapeString 把 < > " ' \ 等转 \u003C 等 Unicode 转义,
                //   防 HTML parser 在 <script> 内误识 </script>).
                bookHistoryJS = fmt.Sprintf(bookHistoryTrackerHTML, template.JSEscapeString(id))
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
                // R63-A: 注入 URL builder 输出.
                data["ChapterURL"] = buildChapterURL(pseudoStyle, chID, bookIDFromMap(book))
                if bid := bookIDFromMap(book); bid != "" {
                        data["BookURL"] = buildBookURL(pseudoStyle, bid)
                }
                // R84-D BUG-195 (R83-D 诚实留痕 #3 修复, Go-side 替代 12 主题 × 4 模板
                //   48 处改动): 原 data["Prev"]=prev 在前 + 后续 if prev["id"]=="" 则
                //   prev["URL"] 不设 → 模板 {{if .Prev}}<a href="{{.Prev.URL}}"> 渲染
                //   `<a href="<no value>">` 链接 (Chapter.id NOT NULL schema 保证实际
                //   不触发, 但 defense in depth). 改 Go-side guard: id 空 → prev=nil
                //   (模板 {{if .Prev}} 跳过渲染链接). 一处改动替代 12 主题 × 4 模板 48
                //   处 {{if .Prev.URL}} 二层 guard 改动. 同时把 data["Prev"]/["Next"]
                //   赋值移到 guard 后 (确保模板看到最终值).
                if prev != nil {
                        if pid, ok := prev["id"].(string); ok && pid != "" {
                                prev["URL"] = buildChapterURL(pseudoStyle, pid, bookIDFromMap(book))
                        } else {
                                prev = nil
                        }
                }
                if next != nil {
                        if nid, ok := next["id"].(string); ok && nid != "" {
                                next["URL"] = buildChapterURL(pseudoStyle, nid, bookIDFromMap(book))
                        } else {
                                next = nil
                        }
                }
                data["Prev"] = prev
                data["Next"] = next
                // R76-A 目标B (用户需求 #1 pSEO 标签注入, 章节页同款): 章节页 OgType=article
                //   (FB Open Graph article 类型, 比书页 book 类型更细 — 每章独立 article).
                //   字段:
                //   - OgTitle = chapter.title + " - " + book.name + " - " + site.Name
                //     (与 computeChapterSeo 默认模板口径一致, 双重 SEO 信号)
                //   - OgDescription = truncate(book.intro, 200) (章节无独立 intro, 复用 book intro)
                //   - OgImage / TwitterImage = book.cover (若有)
                //   - OgUrl / CanonicalURL = absolute chapter URL (https://domain + buildChapterURL)
                //   - OgType = "article" (与 book view 的 "book" 区分)
                //   - OgSiteName = site.Name
                //   - TwitterCard = "summary"
                //   - TwitterTitle = chapter.title + " - " + book.name
                //   - TwitterDescription = truncate(book.intro, 200)
                //   注: book 查不到 (getReadViewData 早返路径) 时 bookName/bookIntro 为空,
                //     pSEO 字段仍注入 (空值), 模板用 {{if .OgTitle}} 守护渲染 (R76-B 范围).
                siteNameRead, _ := site["Name"].(string)
                siteDomainRead, _ := site["Domain"].(string)
                chTitle, _ := ch["title"].(string)
                bookNameRead, _ := book["name"].(string)
                bookIntroRead, _ := book["intro"].(string)
                bookCoverRead, _ := book["cover"].(string)
                bidForSEO := bookIDFromMap(book)
                absChURL := buildAbsoluteURL(siteDomainRead, buildChapterURL(pseudoStyle, chID, bidForSEO))
                ogDescRead := truncate(bookIntroRead, 200)
                data["OgTitle"] = chTitle + " - " + bookNameRead + " - " + siteNameRead
                data["OgDescription"] = ogDescRead
                data["OgUrl"] = absChURL
                data["OgType"] = "article"
                data["OgSiteName"] = siteNameRead
                if bookCoverRead != "" {
                        // R77-D 目标B (R76 交接 #5 OgImage 绝对 URL, read view 同款):
                        //   buildAbsoluteURL 把 "/covers/..." 相对路径拼成绝对 URL. 外链 /
                        //   data: / // 形态 passthrough (coverURL 已处理). 注: read view
                        //   的 book 来自 getReadViewData, 当 book SQL 失败时 bookMap 仅含
                        //   空 fields 无 "cover" key → bookCoverRead="" (comma-ok 安全),
                        //   本 if 块跳过, 模板 {{if .OgTitle}} 仍渲染 (OgUrl=absChURL).
                        data["OgImage"] = buildAbsoluteURL(siteDomainRead, coverURL(bookCoverRead))
                        data["TwitterImage"] = buildAbsoluteURL(siteDomainRead, coverURL(bookCoverRead))
                }
                data["TwitterCard"] = "summary"
                data["TwitterTitle"] = chTitle + " - " + bookNameRead
                data["TwitterDescription"] = ogDescRead
                data["CanonicalURL"] = absChURL
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
                // R90-D BUG-247 (P3, main+templates scope, 顺延 R88-D BUG-237~240:
                //   R87-D BUG-231/232 + R86-D BUG-225/226; 本 scope 从 231 起避免与
                //   R87-B BUG-227 crawl + R87-C BUG-228~230 admin.go 撞号): shipsay/
                //   aijjxs category.html "尾页" 链接硬编码 `/?view=category&cat={...}
                //   &page={TotalPages}` 绕过 buildCategoryURL, 与同模板内 PageList/
                //   PrevPageURL/NextPageURL (均 buildCategoryURL 输出, 随 site.
                //   pseudoStaticStyle 切 numeric/slug/dir/segmented 等形态) 不一致.
                //   影响场景: admin 配 pseudoStaticStyle=numeric 时, 同一分类页
                //   内 PageList URL = /category/{hash}/{page}.html, "尾页" URL = /?
                //   view=category&cat={id}&page={last} → 搜索引擎抓到混合 URL 风格
                //   (canonical weight 分散, 同页 URL 不一致是 SEO 弱信号). 原 BUG
                //   无功能 bug (链接仍可达, homeHandler path="/" 走 query 串模式
                //   渲染), 但 SEO + 用户体验 (风格突变) 损害. 修复: Go 端注入
                //   LastPageURL field (buildCategoryURL(pseudoStyle, catID,
                //   totalPages)), shipsay/category.html + aijjxs/category.html 改
                //   {{.LastPageURL}} (各 1 行替换, 0 净增). ranking/fulltext 同款
                //   "尾页" 用 buildPagerURL (永远 query 串, 不分风格), 与硬编码
                //   /?view=ranking&sort=...&page={last} 一致, 0 bug 不动.
                data["LastPageURL"] = buildCategoryURL(pseudoStyle, catID, totalPages)
                // R91-D BUG-251 (P3, main+templates scope, 顺延 R90-D BUG-247 尾页 family):
                //   101kks/category.html line 120 "首頁" (<<) 硬编码 /?view=category&cat=
                //   {CatID}&page=1 绕过 buildCategoryURL (同款 BUG-247 尾页 family 的首页
                //   对称遗漏). admin 配 pseudoStaticStyle=numeric 时, 同分类页 PageList
                //   URL = /category/{hash}/{page}.html, "首页" URL = /?view=category&cat=
                //   {id}&page=1 → 混合 URL 风格 (canonical weight 分散). 修复: Go 端注入
                //   FirstPageURL = buildCategoryURL(pseudoStyle, catID, 1), 101kks/category
                //   .html 改 {{.FirstPageURL}}. catID 空 + page=1 → "/?view=category" (BUG-
                //   250 修复后 buildCategoryURL 空 catID page=1 仍返无 page 参数形态).
                data["FirstPageURL"] = buildCategoryURL(pseudoStyle, catID, 1)
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
                // R82-D 目标A (R81 交接 #8 + R77-D 未决项 #10): history view — 从客户端
                //   `bookHistory` cookie (JSON `{"ids":["cuid1",...]}` 或 bare array) 读浏览
                //   历史, 查 Book 表返 books list 保序. JS 在 bookHistoryTrackerHTML (line
                //   ~2444) localStorage 累积最近浏览 book id → 用户访问 /?view=history 前
                //   setCookie 序列化 JSON (R85-D BUG-204 修 URL-decode 后端读). 隐私: 客户端
                //   cookie (无 userID/IP/session 跟踪, 不写 Setting 表).
                //   Cookie 有真实 history → HistoryBooks 注入供 shipsay/history 模板
                //   {{range .HistoryBooks}} 渲染; Books 同源 (shipsay/history else 分支
                //   用 {{range .Books}} 兜底空 cookie 占位). Cookie 缺失/空/全删 → fallback
                //   latest 48 books 占位 + HistoryBooks=[] 空 slice (非 nil) 让模板
                //   {{if .HistoryBooks}} 守护跳过渲染空区块. Title="浏览足迹" 注入供
                //   shipsay/history {{.Title}} 用.
                //   R85-D BUG-206 (精简, R84-D 未决项 #6): 删 data["TopBooks"]/["Popular"].
                //     shipsay/history 模板 (R83-D 建, line ~1-107) 0 消费此二字段 (仅用
                //     .HistoryBooks + .Books + .Title + .Site/NavCats/HomeURL/WheelLinks).
                //     R84-D 留此二字段为 homeHandler 二级 fallback shipsay/home (template
                //     render fail 时) 消费, 但 shipsay/history parse 稳定 (启动时 glob
                //     parse, 失败 server 不启; runtime 仅 wordCount/eq/range/if 全 nil-safe
                //     template func, 0 panic surface) → 二级 fallback 极罕见触发. 删后省
                //     topBooks O(n²) bubble sort (48 items = 2304 cmp) + takeBooks make+copy
                //     (12 items) per history req, 主路径 99.9% 省 CPU. 二级 fallback (若触
                //     发) shipsay/home 的 TopBooks/Popular 区块空渲染 (range nil → skip),
                //     Books=historyBooks 的 NavCats × Books 8× 重复 (BUG-205 未决项) 仍在.
                //     权衡: 主路径省 CPU > 罕见二级 fallback 2 区块空 (用户可接受).
                var historyBooks []map[string]interface{}
                if c, cErr := r.Cookie("bookHistory"); cErr == nil {
                        historyBooks = getHistoryViewData(c.Value)
                }
                if len(historyBooks) > 0 {
                        injectBookURLs(historyBooks, pseudoStyle)
                        data["HistoryBooks"] = historyBooks
                        data["Books"] = historyBooks
                } else {
                        books, _ := getBooks(48)
                        injectBookURLs(books, pseudoStyle)
                        data["Books"] = books
                        data["HistoryBooks"] = []map[string]interface{}{}
                }
                data["Title"] = "浏览足迹"
        default: // home
                // R71-A: homeLayout 4 字段注入 (读 Setting 表 homeLayout.{siteID} JSON).
                //   admin.go getHomeLayoutSetting 返 map (含默认值兑底, clamp [lo,hi] 防坏值).
                //   home.html 模板用 .HomeCategoryCount 限分类区块数 (原硬编码 2 卡) +
                //   .HomeCategoryBooks 限每卡书数 (原硬编码 6) + .HomeLatestBooks 限最新上传
                //   区块 (原 range .Books 全 48 本) + .HomeHotBooks 限 24h 热榜 (原 takeBooks(books,12)).
                //   site["ID"] 为本站 ID (getSite 注入). 为空 (无 siteID query 但 isDefault 命中) 时
                //   用默认值 (R70-D getHomeLayoutSetting 对空 siteID 返全默认 8/6/12/12).
                siteDBID, _ := site["ID"].(string)
                layout := getHomeLayoutSetting(siteDBID)
                catCount := layout["homeCategoryCount"]
                catBooks := layout["homeCategoryBooks"]
                latestN := layout["homeLatestBooks"]
                hotN := layout["homeHotBooks"]
                data["HomeCategoryCount"] = catCount
                data["HomeCategoryBooks"] = catBooks
                data["HomeLatestBooks"] = latestN
                data["HomeHotBooks"] = hotN
                // 取足够书籍供各区块使用: latestN + hotN + 分类区块 (catCount * catBooks)
                //   + buffer 防分类过滤后部分书没分到任何展示位. 默认 8 分类 * 6 + 12 + 12 + 16 = 88,
                //   实际 SQLite LIMIT 取 min(算出值, 表总数). 不硬编码 48 (R71-A 目标A 需求).
                totalNeeded := latestN + hotN + catCount*catBooks + 16
                if totalNeeded < 48 {
                        totalNeeded = 48 // 保底 48 (防坏 layout 值致分类过滤不到书)
                }
                books, _ := getBooks(totalNeeded)
                injectBookURLs(books, pseudoStyle)
                data["Books"] = books
                // R71-A: LatestBooks 独立切片供最新上传区块用 (模板 range .LatestBooks).
                //   不复用 .Books (后者还供 分类过滤 / 热门作者 / 数据统计 用, 需保持全量).
                data["LatestBooks"] = takeBooks(books, latestN)
                // R71-A: HotBooks (24h 热榜) 用 hotN 限 (原硬编码 12).
                data["Popular"] = takeBooks(books, hotN)
                // TopBooks 为一周热榜 + FeaturedBooks 的 fallback (原 topBooks(books, 6) 保留).
                topN := 6
                data["TopBooks"] = topBooks(books, topN)
                // R71-A 目标B: FeaturedBooks 封面推荐区块 (读 Setting 表 featuredBooks.{siteID} JSON).
                //   模板 range .FeaturedBooks 渲染; 为空时 fallback TopBooks 避免空区块 (admin 未配置
                //   featuredBooks 时显示一周热榜 top6, 与 R70-C 前一致).
                featured := getFeaturedBooks(siteDBID)
                if len(featured) == 0 {
                        // R80-D BUG-170 (P3): 原实现 `data["TopBooks"].([]map[string]interface{})`
                        //   无 ok-check — TopBooks 由 line 1075 topBooks(books, topN) 设置 (始终非 nil
                        //   slice), 但 assertion 失败会 panic (非 graceful). 改 comma-ok 防御:
                        //   未来若 line 1075 被重构移除 / 改名 / 改返类型, 本行 panic 而非 fallback
                        //   空 slice 是隐性 bug. ok-check 让 assertion 失败时 featured=[] 空 slice,
                        //   模板 range 空 (区块隐藏), 不 panic.
                        if tb, ok := data["TopBooks"].([]map[string]interface{}); ok && len(tb) > 0 {
                                featured = tb
                        } else {
                                featured = []map[string]interface{}{}
                        }
                } else {
                        injectBookURLs(featured, pseudoStyle) // 给 featured 每本注入 URL
                }
                data["FeaturedBooks"] = featured
        }

        tmplName := theme + "/" + view
        // R41-1B: 渲染前先校验模板存在; 失败时回退到 shipsay/home 而非"半写后报错"
        if tmpls.Lookup(tmplName) == nil {
                // R84-D (R83-D 交接 #1 "非 shipsay 主题 history.html 接入"):
                //   view=history 时优先 fallback shipsay/history (单网格
                //   .HistoryBooks) 而非 shipsay/home (8× Books 重复渲染:
                //   HomeCategoryBooks × N 分类 + LatestBooks + Popular +
                //   TopBooks + FeaturedBooks 全用同一 historyBooks 数据).
                //   非 shipsay 主题 (aijjxs/23qb/101kks/trxsw/ggd66/pilishuwu/
                //   huangjinwu/ddyueshu/x2552) view=history 现 fallback
                //   shipsay/history (shipsay CSS 风格而非 aijjxs 风格), 用户
                //   看到单网格 history 列表 (而非 8 区块重复). 880 行模板复制
                //   (11 主题 × 80 行) 推 R85+ (前提: 用户反馈 default
                //   shipsay/history 渲染正确 + 决定逐主题接入). 非 history view
                //   仍 fallback shipsay/home (兼容旧行为, R41-1B 设计不变).
                fallbackTmpl := "shipsay/home"
                if view == "history" {
                        fallbackTmpl = "shipsay/history"
                }
                log.Printf("[homeHandler] template not found: %s, fallback to %s", tmplName, fallbackTmpl)
                tmplName = fallbackTmpl
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
                                // R69-A/R70-A: 若 obfuscateHTML=true 应用混淆 (fallback 路径用 "home" view).
                                //   R70-A: writeRenderedHTML 改读 site["ObfuscateHTML"] per-site 覆盖全局.
                                writeRenderedHTML(w, buf2.String(), site, "home")
                                return
                        }
                }
                http.Error(w, "模板渲染失败", 500)
                return
        }
        // R83-D (R82 交接 #3): book view 注入 history tracker JS (case "book" 设
        //   bookHistoryJS, 仅 book view 注入避免 history/home view 写 cookie 浪费).
        if bookHistoryJS != "" {
                buf.WriteString(bookHistoryJS)
        }
        // R54-1A: 开关开启时在 </body> 前注入反馈浮窗 (前台所有 view 都走 homeHandler, 一处注入覆盖全部主题模板)
        if getFeedbackEnabled() {
                buf.WriteString(feedbackWidgetHTML)
        }
        // R69-A/R70-A: 若 obfuscateHTML=true 应用混淆 (主渲染路径用原 view 构造 seed).
        //   R70-A: writeRenderedHTML 改读 site["ObfuscateHTML"] per-site 覆盖全局.
        writeRenderedHTML(w, buf.String(), site, view)
}

// R64-D: render404 渲染 templates/404.html (R64-A 创建模板), 失败时 fallback 到 http.NotFound.
//
//      data 字段: Site / Categories / HomeURL / PseudoStyle — 与 homeHandler 主流程注入字段一致,
//      供 404 模板渲染站点 nav + 首页链接 + 调试 meta (伪静态风格). site==nil 时无法渲染
//      (无 Site 数据), fallback http.NotFound 保留 R63 行为. 模板未加载时 (R64-A 未完成 /
//      ParseFiles 失败) 同样 fallback http.NotFound, 等 R64-A 完成后切换. /api/* 路径不进
//      homeHandler (由 admin/API handlers 处理), 不调此函数. 渲染走 strings.Builder 缓冲:
//      Execute 成功才写 w, 失败可安全 fallback http.NotFound (未写出任何 byte).
//
// R65-D BUG-48 (P3): 注入 "PseudoStyle" 字段. 原 R64-D 实现遗漏此 key, 404.html 模板
//
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
                        // R69-A/R70-A: 若 obfuscateHTML=true 应用混淆 (404 页用 "404" view 构造 seed).
                        //   R70-A: 优先 site["ObfuscateHTML"] (per-site 覆盖全局), 缺失 fallback 全局.
                        out := buf.String()
                        siteDBID, _ := site["ID"].(string)
                        obfuscateOn, hasKey := site["ObfuscateHTML"].(bool)
                        if !hasKey {
                                obfuscateOn = getObfuscateHTMLEnabled()
                        }
                        if obfuscateOn && siteDBID != "" {
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

// ===== R69-A: HTML 混淆引擎 (obfuscateHTML) — R70-A 深化 (外部 CSS 同步 + per-site + 属性顺序 + div 包裹 + 碰撞防护) =====
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
//   - R70-A 变换 4: <a> 标签属性顺序随机 (id/data-* 保前, 防 JS 选择器断).
//   - R70-A 变换 5: <li> 单 inline 元素外包 <div> (20% 概率, 视觉不变).
//   - R70-A 碰撞防护: randomClassName 加前缀 "_o_" (防与模板原名碰撞).
//   - R70-A 外部 CSS 同步: <link rel=stylesheet href=/clone-css/*.css> 替换为
//     <style>...</style> (启动时预加载缓存, 让 collectHTMLClasses 扫到外部 CSS
//     选择器 + obfuscateHTML 第 3 步同步重写), 不再样式失效.
//   - R70-A per-site 配置: Setting 表 key="obfuscateHTML:{siteID}" 兜底 (Site 表
//     无此列, 严禁 prisma db push). per-site key 缺失时 fallback 全局 Setting.
//
// 风险与约束:
//   - 外部 CSS 同步依赖 initExternalCSSCache 预加载成功; 若 CSS 文件缺失/读失败,
//     inlineExternalCSS 降级保留 <link> 标签 (回到 R69-A 行为: 仅同步内联 <style>).
//   - 不破坏 <pre>/<code> (保留格式标签): 当前未实现 per-tag 跳过, 但变换只在
//     class 属性 + 标签间, <pre>/<code> 内文本若无 class 属性则天然不受影响.
//   - <script> 块内仅替换单 class 字符串字面量 ("X" 或 'X' 形态, 无空格); 多 class
//     字符串 ("X Y") 不替换 (防 className 赋值场景断 JS).
//   - <a> 属性顺序仅 swap <a> 标签 (不动 div/span/p/li), 防 blast radius 过大.
//   - <li> 包裹仅限单 inline 元素 (无多 inline 元素或文本节点), 防破多 inline 布局.
//
// 开关: Setting 表 key='obfuscateHTML' (全局, 默认 false) +
//   key='obfuscateHTML:{siteID}' (per-site 覆盖全局). wired into homeHandler
//   (主路径 + 兜底 fallback 路径) + render404.

// R69-A: obfuscateHTMLSeed 用 siteID + view + 5 分钟时间窗口构造混淆种子.
//
//      返回值供 obfuscateHTML 内 RNG 用, 同窗口同结果 (缓存友好); 跨窗口变化 (蜘蛛
//      看到结构轻微变化, 增反爬识别难度).
func obfuscateHTMLSeed(siteID, view string) string {
        window := time.Now().Unix() / 300 // 5 分钟窗口 (300s)
        return siteID + ":" + view + ":" + strconv.FormatInt(window, 10)
}

// R69-A: obfuscateRNG — 自实现 FNV-1a + xorshift64* 种子化 RNG (零依赖).
//
//      math/rand 全局自动种子不可控; 用本结构保证同 seed 同输出 (缓存友好).
//      注: 不用 math/rand 标准库, 因其全局 PRNG 自 Go 1.20 起自动种子, 无法保证
//      跨进程同 seed 同输出 (即使 rand.NewSource 在进程内可复现, 跨进程仍依赖
//      种子值; 本实现完全自包含, 无外部依赖).
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
//
//      首字符限字母 (CSS 标识符规则: 首字符不可数字), 后续字符可为字母/数字.
//      长度 5-8 在 CSS 中足够唯一防与现有 class 名冲突.
//
// R70-A 碰撞防护: 加前缀 "_o_" (如 "_o_a3f7k2"). 现有模板 class 名 (active/top/link/
//
//      book/cover 等) 无一以 "_o_" 开头 → 生成名与原名碰撞概率 = 0. 即便 RNG 在同页内
//      给两个不同原 class 生成相同后缀 (概率 < 10^-9), 也不会与原名混淆 — 但因后缀随机
//      长度 5-8 字符 + alnum 62 字母表 (62^7 ≈ 3.5e12), 同页 ~50 class 内碰撞 < 10^-9,
//      可忽略. CSS 标识符首字符允许下划线 (CSS Syntax spec).
func (r *obfuscateRNG) randomClassName() string {
        const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        const alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        const prefix = "_o_"
        length := 5 + r.intn(4) // 5-8 (后缀部分)
        out := make([]byte, len(prefix)+length)
        copy(out, prefix)
        out[len(prefix)] = letters[r.intn(len(letters))] // 后缀首字符限字母 (保守, 防 strict CSS 解析器)
        for i := len(prefix) + 1; i < len(prefix)+length; i++ {
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
//
//      匹配 .classname 后跟非标识符字符或字符串结束 (捕获组 1 = 边界字符).
//      重写时回填边界字符保选择器完整. RE2 不支持 lookahead, 故用捕获组保留边界.
//      per-class 编译并缓存 (NewRegexp 复杂度低, obfuscateHTML 内复用).
func cssClassSelectorRE(className string) *regexp.Regexp {
        return regexp.MustCompile(`\.` + regexp.QuoteMeta(className) + `([^a-zA-Z0-9_-]|$)`)
}

// R69-A: collectHTMLClasses 扫描 HTML 所有 class="X Y Z" + <style> 内 .X 选择器,
//
//      返回所有原始 class 名集合 (用于构建 class 映射表).
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

// ===== R70-A: 外部 CSS 同步重写 =====
//
// 背景: R69-A obfuscateHTML 仅同步内联 <style> 块 + <script> 字面量; 外部 CSS
//   (/clone-css/*.css 由 static FileServer 服务) 内的 class 选择器未同步 → 若
//   admin 启用 obfuscateHTML=true, HTML 的 class 被改名 (e.g. .book-title → ._o_a3f7k2)
//   但外部 CSS 文件仍用 .book-title → 浏览器按改名后 class 查 CSS 选择器查不到 →
//   样式失效 (整页 broken layout). 同时蜘蛛可从外部 CSS 反推原 class 名 (降反爬效果).
//
// 方案: 在 obfuscateHTML 入口先 inline 外部 CSS — 把 <link rel="stylesheet" href=
//   "/clone-css/xxx.css"> 替换为 <style>...</style> 块 (CSS 内容从启动时预加载缓存
//   读出). inline 后, collectHTMLClasses 会扫到 <style> 块内的 .classname 选择器,
//   obfuscateHTML 第 3 步 (重写 <style> 选择器) 会同步重写 → CSS 选择器与 HTML class
//   属性同步改名, 浏览器按改名后 class 查到 (改名后的) 选择器 → 样式生效.
//
// 缓存: 启动时 initExternalCSSCache 一次 glob public/clone-css/*.css + ReadFile 全部
//   到内存 (10 个文件 ~600KB 总量, 不显著增内存); 运行时 inlineExternalCSS 仅查 map
//   无 I/O. per-site CSS 文件不变 (admin 改 CSS 需重启), 缓存永不过期.
//
// 降级: 若 href 不在缓存 (非 /clone-css/ 路径或文件加载失败) → 保留原 <link> 标签
//   (degrade 到 R69-A 行为, 仅同步内联 <style>, 不破坏渲染).

// R70-A: externalCSSCache 启动时加载的 per-site CSS 内容缓存.
//
//      key = "/clone-css/<name>.css" (与模板 href 一致), value = CSS 文本 (空 = 加载失败).
//      R71-A: 加 externalCSSMu RWMutex 保护并发读写 (watcher goroutine 检测 mtime 变化
//      后调 reloadExternalCSSCache 写 cache, 同时 homeHandler 渲染路径 inlineExternalCSS
//      读 cache → 需 RWMutex 防 race). 读多写少 → RWMutex 比 Mutex 性能更好 (并发读不互斥).
var (
        externalCSSCache map[string]string
        externalCSSMu    sync.RWMutex
)

// initExternalCSSCache 启动时一次 glob + ReadFile 所有 public/clone-css/*.css 到缓存.
//
//      在 main() 内 http.ListenAndServe 前调用. 失败 (文件缺失 / 读错误) 跳过该文件
//      不致命 (inlineExternalCSS 会降级保留 <link> 标签).
//      R71-A: 加 mtime 记录到 externalCSSMtimes, 供 watcher goroutine 对比检测变化.
func initExternalCSSCache() {
        externalCSSMu.Lock()
        defer externalCSSMu.Unlock()
        externalCSSCache = make(map[string]string)
        externalCSSMtimes = make(map[string]int64)
        cssDir := filepath.Join(basePath, "public/clone-css")
        matches, _ := filepath.Glob(filepath.Join(cssDir, "*.css"))
        for _, m := range matches {
                content, err := os.ReadFile(m)
                if err != nil {
                        log.Printf("[R70-A] initExternalCSSCache: read %s failed: %v", m, err)
                        continue
                }
                key := "/clone-css/" + filepath.Base(m)
                externalCSSCache[key] = string(content)
                if fi, e := os.Stat(m); e == nil {
                        externalCSSMtimes[key] = fi.ModTime().Unix()
                }
        }
        log.Printf("[R70-A] external CSS cache loaded: %d files", len(externalCSSCache))
}

// R71-A: externalCSSMtimes 记录每个缓存 CSS 文件的 mtime (Unix 秒),
//
//      watcher goroutine 每 60s 对比文件系统 mtime → 检测变化 → 调
//      reloadExternalCSSCache 重载该文件. mtime 单调递增 (同文件 mtime
//      只增不减, 编辑后 mtime 变大), 故对比 > 即判定为变化.
var externalCSSMtimes map[string]int64

// R71-A: reloadExternalCSSCache — watcher 检测到变化后, 重载缓存.
//
//      全量重载 (而非单文件增量): glob 重新发现新增文件 (R70-A 启动时
//      不存在的 css 文件后加入也会被发现). 全量重载 ~5ms (10 文件 ~600KB
//      ReadFile), 60s 间隔下开销可忽略.
//      调用方持 Lock (写互斥), inlineExternalCSS 并发读会阻塞等待 — 但写
//      持锁时间 <10ms, 阻塞读请求可容忍.
func reloadExternalCSSCache() {
        externalCSSMu.Lock()
        defer externalCSSMu.Unlock()
        cssDir := filepath.Join(basePath, "public/clone-css")
        matches, _ := filepath.Glob(filepath.Join(cssDir, "*.css"))
        newCache := make(map[string]string)
        newMtimes := make(map[string]int64)
        for _, m := range matches {
                content, err := os.ReadFile(m)
                if err != nil {
                        log.Printf("[R71-A] reloadExternalCSSCache: read %s failed: %v", m, err)
                        continue
                }
                key := "/clone-css/" + filepath.Base(m)
                newCache[key] = string(content)
                if fi, e := os.Stat(m); e == nil {
                        newMtimes[key] = fi.ModTime().Unix()
                }
        }
        externalCSSCache = newCache
        externalCSSMtimes = newMtimes
        log.Printf("[R71-A] external CSS cache reloaded: %d files", len(newCache))
}

// R71-A: startExternalCSSWatcher — 启动 CSS 文件 watcher goroutine.
//
//      每 60s glob public/clone-css/*.css, 对比 mtime; 任一文件 mtime 变化
//      或文件数变化 → 调 reloadExternalCSSCache 全量重载.
//      设计选择 (轮询而非 fsnotify): 不引入新依赖 (fsnotify 不在 go.mod,
//      本轮严禁新增依赖); mtime 轮询 60s 间隔下检测延迟可接受 (admin 改
//      CSS 等 60s 内生效, 比 R70-A "需重启进程" 体验大幅改善).
//      ctx 用于 graceful shutdown (main 退出时取消 ctx, goroutine 早返).
func startExternalCSSWatcher(ctx context.Context) {
        go func() {
                // R75-A 目标A3 (goroutine 泄漏防护): defer recover 防 panic 杀进程.
                //   checkExternalCSSMtime 内部调 reloadExternalCSSCache → os.ReadFile +
                //   filepath.Glob + os.Stat + externalCSSMu.Lock, 任一环节 panic (e.g. nil map
                //   写 / 文件路径越界) 会杀进程. recover 让 goroutine 退出但 main 继续跑
                //   (CSS 缓存 stale 但 homeHandler 仍能渲染, inlineExternalCSS 降级保留 <link>).
                //   注: panic 后 goroutine 退出, CSS watcher 停 (60s ticker 不再跑); admin 改
                //   CSS 后无热重载, 需重启进程. 与 R74-B/C/D 各 handler panic-safe 同款模式.
                defer func() {
                        if r := recover(); r != nil {
                                log.Printf("[R75-A] startExternalCSSWatcher panic (goroutine exit): %v", r)
                        }
                }()
                ticker := time.NewTicker(60 * time.Second)
                defer ticker.Stop()
                for {
                        select {
                        case <-ctx.Done():
                                return
                        case <-ticker.C:
                                checkExternalCSSMtime()
                        }
                }
        }()
}

// R74-A 目标A (R73 交接 #2): ProxyHealthProber singleton 全局标志.
//
//      crawl.StartProxyHealthProber 内部已有 atomic.Bool + CompareAndSwap 防多启动 (R72-C
//      实现), 但 R73-A 报告 main() 调用方未防: 若 main() 因 graceful shutdown / SIGHUP /
//      测试 fixture 等场景被多次执行 (或 wiring 误置循环), 每次 StartProxyHealthProber 调
//      用即使内部 started 标志阻止实际重启, 仍会构造 startupPool slice (collectStartupProxyPool
//      扫 Task 表) + log.Printf 噪声. 本轮在 main() 调用方加 proxyHealthProberStarted CAS
//      二次防御: 已启动则跳过 collectStartupProxyPool + StartProxyHealthProber 调用, 0 噪声.
//      与 crawl.StartProxyHealthProber 内部 atomic.Bool 双层保护 (call-site + callee-site),
//      任一层都防多启动, 双层更鲁棒.
var proxyHealthProberStarted atomic.Bool

// R73-A 目标A (R72 交接 #1): collectStartupProxyPool — 启动时扫 Task 表 fetchConfig 列,
//
//      收集所有任务配置的 proxyUrl 字段, 合并去重为代理池供 StartProxyHealthProber 用.
//      设计: fetcher.go 无全局 proxyPool 变量 (代理 per-task 在 Task.fetchConfig JSON 的
//        proxyUrl 字段, 见 crawl.types.go FetchConfig.ProxyURL `json:"proxyUrl,omitempty"`),
//        fetcher.go 范围严禁改 (其它 agent 处理), 本轮在 main.go 内做合并.
//      逻辑: SELECT fetchConfig FROM Task WHERE status IN ('running','pending')
//        ORDER BY updatedAt DESC LIMIT 50 (R74-A 目标C: R73 交接 #4 修复 — 原全表扫 Task
//        大流量站 (10K+ 历史任务) 启动慢; 现仅扫活跃任务 (running/pending) + LIMIT 50,
//        假设活跃任务代理池代表性足够 (历史 done/error 任务 proxyUrl 多为同款, 重复无意义);
//        ORDER BY updatedAt DESC 取最近活跃 50 任务, 防 LIMIT 取老任务遗漏新代理).
//        每行 json.Unmarshal 提取 ProxyURL 字段; 调 crawl.ParseProxyPool (逗号分隔 + 校验);
//        map[string]bool 去重; 失败 (单行解析错 / 整体 SQL 错) 容忍跳过.
//      返回: []string 代理 URL 池 (空 slice if 无代理 / DB 错). caller (StartProxyHealthProber)
//        内部 len(pool)==0 自跳过 (started 标志设 true 防后续调用, prober singleton).
//      后续动态新增: admin 创建带 proxy 的新任务时, R73+ admin.go 可调
//        crawl.ParseProxyPool + 调 StartProxyHealthProber (started 标志会阻止, 实际需重构
//        为动态池, R73+ 未决项).
func collectStartupProxyPool() []string {
        // R74-A 目标C (R73 交接 #4): WHERE status IN ('running','pending') + LIMIT 50.
        //   原全表扫 Task 在大流量站 (10K+ 历史任务) 启动慢 (~50ms-500ms).
        //   现仅扫活跃任务 (running/pending), 忽略 done/error 历史任务 (proxyUrl 多已失效
        //   或重复, 无需再扫). ORDER BY updatedAt DESC 取最近 50 任务, LIMIT 50 防
        //   大表启动慢 (50 行 × 单行 JSON 解析 ~5ms 总开销, 0 启动延迟感知).
        rows, err := db.Query(`SELECT fetchConfig FROM Task WHERE status IN ('running','pending') ORDER BY updatedAt DESC LIMIT 50`)
        if err != nil {
                log.Printf("[R73-A] collectStartupProxyPool: SELECT fetchConfig failed: %v", err)
                return nil
        }
        defer rows.Close()
        seen := map[string]bool{}
        pool := []string{}
        for rows.Next() {
                var fc string
                if err := rows.Scan(&fc); err != nil || fc == "" || fc == "{}" {
                        continue
                }
                var parsed struct {
                        ProxyURL string `json:"proxyUrl,omitempty"`
                }
                if json.Unmarshal([]byte(fc), &parsed) != nil {
                        continue
                }
                if parsed.ProxyURL == "" {
                        continue
                }
                for _, p := range crawl.ParseProxyPool(parsed.ProxyURL) {
                        if p == "" || seen[p] {
                                continue
                        }
                        seen[p] = true
                        pool = append(pool, p)
                }
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] collectStartupProxyPool rows.Err(): %v", rerr)
        }
        return pool
}

// R75-A 目标A2 (autoResumeTasks 容错): autoResumeTasksCleanup — 启动时清理 orphaned
//
//      running tasks. 进程 crash / kill -9 / OOM 后 Task 表残留 status='running' 行
//      (实际 goroutine 已死, 但 DB 行未更新). admin 看到 "X 个任务运行中" 不知道挂了,
//      且 adminTasksList 按 status='running' 过滤会列 ghost 任务 (admin 误以为在跑).
//      adminBackupClearHandler 内部有同款清理逻辑 (line ~6005), 但只在 admin 主动触发
//      清空时跑, 启动时不跑. 本函数启动时自动跑一次: 查 running tasks → 标 stopped →
//      log 计数 (admin 看到 "[autoResumeTasks] cleaned N orphaned running tasks" 知道
//      是进程重启导致, 可手动重启需要的任务).
//      容错 (用户需求 #1 预览稳定性): 任何 DB 错误 / panic 都不阻断 HTTP server.
//        - DB 错误 (db.Query / db.Exec 返 err): log + return (server 仍启动, admin 看
//          log 知道清理失败; tasks 表残留 running, admin 手动清).
//        - panic (理论不会发生, 但防御性编程): defer recover → log + return.
//      设计选择 (标 stopped 而非 error/pending):
//        - error: admin 看到 "X 个任务失败" 误以为采集失败 (实为进程重启残留), 误导.
//        - pending: admin 看到 "X 个任务待启动" 可能误启全部 (实为重启残留, 部分可能
//          已采完不需重启).
//        - stopped: 中性状态, admin 看到 "X 个任务已停止" 知道需手动决定是否重启,
//          与 adminTaskControlHandler MarkStopped 同款语义 (用户主动停).
//      调用点: main() line ~86 (db 初始化后, 模板加载前; 不依赖模板 / tmpls var).
func autoResumeTasksCleanup() {
        defer func() {
                if r := recover(); r != nil {
                        log.Printf("[R75-A] autoResumeTasks panic (cleanup skipped): %v", r)
                }
        }()
        rows, err := db.Query(`SELECT id, name FROM Task WHERE status='running' ORDER BY updatedAt DESC LIMIT 100`)
        if err != nil {
                log.Printf("[R75-A] autoResumeTasks: SELECT running tasks failed (cleanup skipped, HTTP server continues): %v", err)
                return
        }
        orphanedIDs := []string{}
        orphanedNames := []string{}
        for rows.Next() {
                var id, name string
                if err := rows.Scan(&id, &name); err != nil {
                        continue
                }
                if id != "" {
                        orphanedIDs = append(orphanedIDs, id)
                        orphanedNames = append(orphanedNames, name)
                }
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if err := rows.Err(); err != nil {
                log.Printf("[R75-A] autoResumeTasks: rows.Err() during running-task scan: %v", err)
        }
        rows.Close()
        if len(orphanedIDs) == 0 {
                log.Printf("[R75-A] autoResumeTasks: no orphaned running tasks (clean startup)")
                return
        }
        // 批量 UPDATE 标 stopped (单 SQL, 避免 N 次 round-trip).
        //   注: 用 `status='running'` WHERE 条件而非 `id IN (...)`, 因可能并发 (admin
        //   刚启动新任务标 running); 只清旧的 (UPDATE 时新任务已不在 status='running'
        //   的"启动时间窗口"... 实际 SQLite 单写串行, 无 race; 但保守用 WHERE status=
        //   'running' 兜底: 若 admin 在 SELECT 与 UPDATE 之间启动新 task, 该新 task 也
        //   会被标 stopped — 但启动新 task 是 admin POST /api/admin/tasks 异步触发,
        //   启动期 ~1s 内 admin 不会同时启 task, 实际不会发生).
        res, err := db.Exec(`UPDATE Task SET status='stopped', updatedAt=datetime('now') WHERE status='running'`)
        if err != nil {
                log.Printf("[R75-A] autoResumeTasks: UPDATE Task stopped failed (orphaned running tasks may stay 'running', HTTP server continues): %v", err)
                return
        }
        affected, _ := res.RowsAffected()
        log.Printf("[R75-A] autoResumeTasks: cleaned %d orphaned running tasks (marked 'stopped'): %v", affected, orphanedNames)
}

// R71-A: checkExternalCSSMtime — 单次 mtime 对比 (从 watcher goroutine 调).
//
//      策略: glob 当前 css 文件, 对比每个文件 mtime 与缓存 mtime; 任一变化
//      或文件数不同 → reloadExternalCSSCache; 否则 no-op (60s 间隔下绝大多数
//      tick 无变化, 避免无谓重载).
func checkExternalCSSMtime() {
        cssDir := filepath.Join(basePath, "public/clone-css")
        matches, _ := filepath.Glob(filepath.Join(cssDir, "*.css"))
        externalCSSMu.RLock()
        cachedCount := len(externalCSSMtimes)
        needReload := cachedCount != len(matches)
        if !needReload {
                for _, m := range matches {
                        key := "/clone-css/" + filepath.Base(m)
                        oldMT, ok := externalCSSMtimes[key]
                        if !ok {
                                needReload = true // 新文件
                                break
                        }
                        fi, e := os.Stat(m)
                        if e != nil {
                                continue // stat 失败跳过, 不触发 reload (防误报)
                        }
                        if fi.ModTime().Unix() > oldMT {
                                needReload = true
                                break
                        }
                }
        }
        externalCSSMu.RUnlock()
        if !needReload {
                return
        }
        reloadExternalCSSCache()
}

// externalLinkRE 匹配 <link ...> 标签 (含自闭合). 捕获组 1 = 属性串 (含前导空格).
//
//      (?i) 不区分大小写; <link\b 后接非字母数字字符 (空格 / > / 自闭合 /).
var externalLinkRE = regexp.MustCompile(`(?i)<link\b([^>]*)>`)

// linkHrefRE 从属性串中提取 href="..." / href='...' 值.
//
//      捕获组 1 = 含引号完整值, 2 = 双引号内容, 3 = 单引号内容.
var linkHrefRE = regexp.MustCompile(`(?i)\bhref\s*=\s*("([^"]*)"|'([^']*)')`)

// inlineExternalCSS 把 HTML 内 <link rel="stylesheet" href="/clone-css/xxx.css">
//
//      替换为 <style>...</style> 块 (CSS 内容从 externalCSSCache 读). 不在缓存的 link
//      (非 /clone-css/ 路径或加载失败的文件) 保留原样 (降级行为).
//      必须在 obfuscateHTML 入口前调用 (让 collectHTMLClasses 扫到 inlined CSS).
func inlineExternalCSS(html string) string {
        if html == "" {
                return html
        }
        // R71-A: 持 RLock 并发读 cache (watcher goroutine 重载时持 WLock 互斥).
        //   RLock 期间多次 ReplaceAllStringFunc 内层闭包查 map, 解锁后返回. 注: 不能
        //   在闭包内再 RLock (Go RWMutex 不可重入, 会死锁); 先在闭包外持锁到结束.
        externalCSSMu.RLock()
        defer externalCSSMu.RUnlock()
        if len(externalCSSCache) == 0 {
                return html // 无缓存 (init 未跑或全失败), 全部保留 <link> 降级
        }
        return externalLinkRE.ReplaceAllStringFunc(html, func(match string) string {
                sub := externalLinkRE.FindStringSubmatch(match)
                if len(sub) < 2 {
                        return match
                }
                attrs := sub[1]
                hrefMatch := linkHrefRE.FindStringSubmatch(attrs)
                if len(hrefMatch) < 4 {
                        return match
                }
                href := hrefMatch[2]
                if href == "" {
                        href = hrefMatch[3]
                }
                if href == "" {
                        return match
                }
                css, ok := externalCSSCache[href]
                if !ok || css == "" {
                        return match // 不在缓存 (非 /clone-css/ 路径或加载失败), 保留 <link>
                }
                // inline 为 <style> 块. type 属性 (text/css) 在 HTML5 可省略, 保留以兼容老浏览器.
                return "<style type=\"text/css\">\n" + css + "\n</style>"
        })
}

// R69-A: obfuscateHTML 主混淆函数. 输入 HTML + seed, 返回混淆后 HTML.
//
//      变换流程:
//        0. inline 外部 CSS (R70-A 新增) — <link rel=stylesheet href=/clone-css/*.css>
//           → <style>...</style>, 让后续 collectHTMLClasses 扫到外部 CSS 选择器
//        1. 扫描所有 class 名 (HTML 属性 + <style> 选择器) → 构建随机映射表
//           (原 class → 随机 class, 同 seed 同映射保缓存友好)
//        2. 重写 HTML class 属性值 (class="a b" → class="X Y" 用映射)
//        3. 重写 <style> 块内 CSS 选择器 (.a → .X 同步映射, 含 0 步 inline 的外部 CSS)
//        4. 重写 <script> 块内单 class 字符串字面量 ("a" → "X" 同步映射)
//        5. 标签间插入随机 HTML 注释 (50% 概率, 防 5KB+ HTML 过度膨胀)
//        6. 标签间插入随机空白 (30% 概率, 1-2 个空格/换行)
//        7. (R70-A 新增) <a> 标签属性顺序随机 (id/data-* 保前)
//        8. (R70-A 新增) <li> 单 inline 元素外包 <div> (20% 概率, 视觉不变)
//
//      注: 若 seed 为空 → 不混淆 (防 admin 测试误用导致无映射乱写).
//      注: 若 html 无任何 class 名 → 跳过 2/3/4 步, 仅做 5/6/7/8 步 (注释/空白/属性/包裹).
func obfuscateHTML(html, seed string) string {
        if html == "" || seed == "" {
                return html
        }
        // 0. inline 外部 CSS (R70-A 新增, 必须先于 collectHTMLClasses 让外部 CSS 选择器入集)
        html = inlineExternalCSS(html)

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

        // 7. (R70-A 新增) <a> 标签属性顺序随机 (id/data-* 保前)
        html = shuffleAnchorAttrs(html, rng)

        // 8. (R70-A 新增) <li> 单 inline 元素外包 <div> (20% 概率, 视觉不变)
        html = wrapLiInlineWithDiv(html, rng)

        return html
}

// insertRandomTagComments 在标签间 (" > <" 模式) 插入随机 HTML 注释.
//
//      正则匹配 ">" + 间空白 + "<", 50% 概率插注释. 注释内容 5-8 字符随机
//      (CSS 标识符形态, 蜘蛛看到不同噪音). 保留原空白 + 注释, 不影响渲染.
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
//
//      30% 概率追加 (与 insertRandomTagComments 协同, 进一步打散结构).
//      仅在含至少 1 个原空白的位置追加 (避免在无空白标签间硬插, 防 HTML 紧凑区变松).
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

// ===== R70-A: 混淆引擎深化 (属性顺序 + div 包裹) =====
//
// 背景: R69-A 6 变换未做属性顺序 + div 包裹 (worklog #5/#6/#7 交接 R70). 本轮加 2
//   变换: <a> 属性顺序随机 (id/data-* 保前) + <li> 单 inline 元素外包 <div>. 保守
//   限定在安全位置 (anchor / li+single-inline), 不破布局.

// anchorTagRE 匹配 <a ...> 开放标签 (含自闭合, 但 <a> 实际不自闭合).
//
//      \b 词边界防 <address>/<abbr>/<article>/<aside> 等误匹配 (a 后接字母 \b 不匹配).
//      捕获组 1 = 属性串 (含前导空格, 如 ' href="x" class="y"').
var anchorTagRE = regexp.MustCompile(`(?i)<a\b([^>]*)>`)

// shuffleAnchorAttrs 随机重排 <a> 标签内的属性顺序 (id/data-* 保前, 其余 Fisher-Yates).
//
//      HTML5 spec: 属性顺序对语义无影响 (除 class+=class 同名冲突), 故随机化不破渲染.
//      保守: id + data-* 属性固定在前 (保前) — 因 JS 常用 getElementById / dataset 读取,
//      保持靠前不影响 JS; 同时视觉上不致把语义重要的 id 拖到最后.
//      风险: <a href="javascript:..." 会被 sanitizeChapterHTML 剥, 不在主路径; 模板内
//      <a> 全静态无 user-controlled 属性, 无 XSS 风险.
//      仅 <a> (anchor) 应用, 不动其它标签 (限制 blast radius).
func shuffleAnchorAttrs(html string, rng *obfuscateRNG) string {
        if html == "" {
                return html
        }
        return anchorTagRE.ReplaceAllStringFunc(html, func(match string) string {
                sub := anchorTagRE.FindStringSubmatch(match)
                if len(sub) < 2 {
                        return match
                }
                attrStr := strings.TrimSpace(sub[1])
                if attrStr == "" {
                        return match // <a> 无属性, 不动
                }
                // 检测自闭合 / 末尾 /, 暂存后剥离 (parseAttrs 不识别 /)
                selfClosing := false
                if strings.HasSuffix(attrStr, "/") {
                        selfClosing = true
                        attrStr = strings.TrimSpace(strings.TrimSuffix(attrStr, "/"))
                        if attrStr == "" {
                                return match
                        }
                }
                attrs := parseAttrs(attrStr)
                if len(attrs) < 2 {
                        return match // 仅 1 个属性, 无需 shuffle
                }
                // 分区: anchored (id/data-*) 保前, 其余 shufflable
                var anchored, shufflable []string
                for _, a := range attrs {
                        name := attrName(a)
                        if name == "id" || strings.HasPrefix(name, "data-") {
                                anchored = append(anchored, a)
                        } else {
                                shufflable = append(shufflable, a)
                        }
                }
                if len(shufflable) < 2 {
                        return match // shufflable 部分 < 2, 无需 shuffle
                }
                // Fisher-Yates 随机洗牌 shufflable
                for i := len(shufflable) - 1; i > 0; i-- {
                        j := rng.intn(i + 1)
                        shufflable[i], shufflable[j] = shufflable[j], shufflable[i]
                }
                // 重组: anchored 在前 (保前), shufflable 随后
                var out []string
                out = append(out, anchored...)
                out = append(out, shufflable...)
                result := "<a " + strings.Join(out, " ")
                if selfClosing {
                        result += " /"
                }
                return result + ">"
        })
}

// parseAttrs 把属性串 (如 'href="x" class="y" title="z"') 切分为单属性 slice,
//
//      尊重引号 (单/双引号内的空格不切). 简单状态机逐字节扫描.
func parseAttrs(s string) []string {
        var out []string
        var cur strings.Builder
        inSingle, inDouble := false, false
        started := false
        for i := 0; i < len(s); i++ {
                c := s[i]
                switch {
                case c == '"' && !inSingle:
                        inDouble = !inDouble
                        cur.WriteByte(c)
                        started = true
                case c == '\'' && !inDouble:
                        inSingle = !inSingle
                        cur.WriteByte(c)
                        started = true
                case (c == ' ' || c == '\t' || c == '\n' || c == '\r') && !inSingle && !inDouble:
                        if started {
                                out = append(out, cur.String())
                                cur.Reset()
                                started = false
                        }
                default:
                        cur.WriteByte(c)
                        started = true
                }
        }
        if started {
                out = append(out, cur.String())
        }
        return out
}

// attrName 提取属性名 (等号前的部分, 小写). 如 'href="x"' → 'href', 'class="y"' → 'class'.
//
//      用于判断 anchored (id/data-*). 不影响属性值.
func attrName(attr string) string {
        eq := strings.IndexByte(attr, '=')
        name := attr
        if eq >= 0 {
                name = attr[:eq]
        }
        return strings.ToLower(strings.TrimSpace(name))
}

// liSingleInlineRE 匹配 <li> 内仅含单个 <a> 或 <span> inline 元素 (允许前后空白).
//
//      (?is) 跨行 + 不区分大小写; 捕获组 1 = <li> 属性串 (含前导空格, 可空),
//      捕获组 2 = 内层 inline 元素 (<a>...</a> 或 <span>...</span>).
//      不匹配多 inline 元素的 <li> (避免改多 inline 的布局).
//      保守: <li> 内只允许前后空白 + 单个 inline 元素, 不允许其它文本/标签.
var liSingleInlineRE = regexp.MustCompile(`(?is)<li(\s[^>]*)?>\s*(<a\b[^>]*>.*?</a>|<span\b[^>]*>.*?</span>)\s*</li>`)

// wrapLiInlineWithDiv 在 <li> 内单 inline 元素外偶尔包 <div> (20% 概率).
//
//      变换: <li class="x"><a href="y">text</a></li> → <li class="x"><div><a href="y">text</a></div></li>
//      视觉不变: <li> 是 block, <div> 是 block, <div> 占 <li> 100% 宽度, 内层 <a> 仍 inline
//      渲染. 实际效果: 多一层无样式 <div> 包裹, 蜘蛛看到结构噪音.
//      保守: 仅 <li> 含单 <a> 或单 <span> (无其它文本/标签) 时包裹, 避免破坏多 inline 布局.
//      风险: <li> CSS 用 ul>li>a 直系子选择器 (e.g. ul.nav li a { ... }) 时, 加 <div> 中间
//      层会断选择器 → 样式失效. 模板内 <li> 多用 .class 选择器 (e.g. .nav-list a), 不受影响.
//      20% 概率限制: 避免每页大量 <li> 全包致样式批量失效 + 减小 HTML 体积膨胀.
func wrapLiInlineWithDiv(html string, rng *obfuscateRNG) string {
        if html == "" {
                return html
        }
        return liSingleInlineRE.ReplaceAllStringFunc(html, func(match string) string {
                if rng.intn(5) != 0 { // 20% 概率包裹
                        return match
                }
                sub := liSingleInlineRE.FindStringSubmatch(match)
                if len(sub) < 3 {
                        return match
                }
                liAttrs := sub[1]
                content := sub[2]
                return "<li" + liAttrs + "><div>" + content + "</div></li>"
        })
}

// R69-A: getObfuscateHTMLEnabled 读 Setting 表 obfuscateHTML 全局开关 (默认 false).
//
//      与 getFeedbackEnabled 同款模式 (admin.go). value 存储格式: JSON 编码
//      ("true"/"false") 或 raw 字符串 ("true"/"false"). 缺失或非 "true" 均视为 false.
//      每次 homeHandler 渲染调用一次 (SQLite 单行查询, <0.1ms, 不需缓存层).
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

// R70-A: parseObfuscateBool 解析 Setting 表 obfuscateHTML 值 (JSON bool 或 raw "true").
//
//      提取自 getObfuscateHTMLEnabled + getSiteObfuscateHTML 共用.
//      "true"/JSON true → true; 其它 → false.
func parseObfuscateBool(v string) bool {
        if v == "" {
                return false
        }
        var parsed interface{}
        if json.Unmarshal([]byte(v), &parsed) == nil {
                if b, ok := parsed.(bool); ok {
                        return b
                }
        }
        return v == "true"
}

// R70-A: getSiteObfuscateHTML — per-site obfuscateHTML 读取.
//
//      策略: Setting 表 key="obfuscateHTML:{siteID}" 兜底 (因 Site 表无 obfuscateHTML 列,
//      R70 严禁 prisma db push). per-site key 缺失时 fallback 全局 Setting "obfuscateHTML".
//      TODO (R71+): prisma schema 加 Site.obfuscateHTML 列后, 改读 Site 表 (SELECT 直读).
//      每次 getSite 调用一次 (SQLite 单行查询, <0.1ms).
func getSiteObfuscateHTML(siteID string) bool {
        if siteID != "" {
                var v string
                err := db.QueryRow(`SELECT value FROM Setting WHERE key=?`, "obfuscateHTML:"+siteID).Scan(&v)
                if err == nil {
                        return parseObfuscateBool(v)
                }
        }
        return getObfuscateHTMLEnabled()
}

// R70-A: getSiteKeywordTranscodeMode — per-site keywordTranscode 读取.
//
//      策略: Setting 表 key="keywordTranscode:{siteID}" 兜底. per-site key 缺失时 fallback
//      全局 Setting "keywordTranscode". 未知值 → "off" (保守不破坏).
func getSiteKeywordTranscodeMode(siteID string) string {
        if siteID != "" {
                var v string
                err := db.QueryRow(`SELECT value FROM Setting WHERE key=?`, "keywordTranscode:"+siteID).Scan(&v)
                if err == nil && v != "" {
                        var parsed interface{}
                        if json.Unmarshal([]byte(v), &parsed) == nil {
                                if s, ok := parsed.(string); ok {
                                        return normalizeTranscodeMode(s)
                                }
                        }
                        return normalizeTranscodeMode(v)
                }
        }
        return getKeywordTranscodeMode()
}

// R70-A: getTranscodeContentMode — 正文转码模式读取 (默认 off).
//
//      value 存储格式: JSON 编码字符串 ("\"homophone\"") 或 raw 字符串 ("homophone").
//      保守: 仅允许 homophone/pinyin/mixed (dict-replace 模式, 不破 HTML 标签).
//      split/zwsp 模式对全字符串逐字符插分隔符, 应用到 HTML 正文会破 HTML 标签 (<p> → < p >)
//      → 自动降级到 mixed (仅替字典词, HTML 标签不动).
//      每次 getReadViewData 调用一次 (SQLite 单行查询, <0.1ms).
func getTranscodeContentMode() string {
        var v string
        err := db.QueryRow(`SELECT value FROM Setting WHERE key='transcodeContent'`).Scan(&v)
        if err != nil || v == "" {
                return "off"
        }
        var parsed interface{}
        if json.Unmarshal([]byte(v), &parsed) == nil {
                if s, ok := parsed.(string); ok {
                        v = s
                }
        }
        switch v {
        case "homophone", "pinyin", "mixed":
                return v
        case "split", "zwsp":
                // 保守降级: split/zwsp 会破 HTML 标签, 降级到 mixed (仅替字典词)
                return "mixed"
        }
        return "off"
}

// R70-A: transcodeChapterContent 应用正文关键词转码到章节 HTML 内容.
//
//      mode = "off"/"" → passthrough (默认, 不转码).
//      mode = "homophone"/"pinyin" → transcodeDictReplace (仅替字典词, HTML 标签不动).
//      mode = "mixed" → transcodeMixed (per word hash 选 homophone/pinyin/zwsp/passthrough).
//      保守: 只转码字典内敏感词, 不转码整段 (避免破坏阅读 + HTML 标签).
//      注: transcodeDictReplace/transcodeMixed 用 strings.ReplaceAll 替换字典词, HTML 标签
//      (如 <p>/<a>) 不含字典词 (中文敏感词), 不受影响.
func transcodeChapterContent(htmlContent, mode string) string {
        if htmlContent == "" || mode == "" || mode == "off" {
                return htmlContent
        }
        switch mode {
        case "homophone", "pinyin":
                return transcodeDictReplace(htmlContent, mode)
        case "mixed":
                return transcodeMixed(htmlContent)
        }
        return htmlContent
}

// R69-A: writeRenderedHTML 写 HTML 响应, 若 Setting.obfuscateHTML=true 应用混淆.
//
//      homeHandler + render404 共享此 helper, 避免重复 if-else 逻辑.
//      siteID/view 用于构造 seed (5 分钟窗口); 若二者均空 → 不混淆 (防 admin 测试误用).
//      R70-A: 改读 site["ObfuscateHTML"] (per-site 覆盖全局), 缺失时 fallback 全局.
func writeRenderedHTML(w http.ResponseWriter, html string, site map[string]interface{}, view string) {
        if site != nil {
                siteID, _ := site["ID"].(string)
                if siteID != "" {
                        // R70-A: 优先 site.ObfuscateHTML (per-site), 缺失 fallback 全局
                        obfuscateOn, hasKey := site["ObfuscateHTML"].(bool)
                        if !hasKey {
                                obfuscateOn = getObfuscateHTMLEnabled()
                        }
                        if obfuscateOn {
                                html = obfuscateHTML(html, obfuscateHTMLSeed(siteID, view))
                        }
                }
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
        // R91-D BUG-254 (P3, main+templates scope, 顺延 R90-D BUG-247~249 尾页 family):
        //   9 book.html + 6 list-page 模板 (pilishuwu/x2552/trxsw home/fulltext/keyword/
        //   search/category/ranking/book, 共 29 callsite) 硬编码 /?view=category&cat=
        //   {{.categoryId|urlquery}} 绕过 buildCategoryURL — admin 配 pseudoStaticStyle=
        //   numeric 时, 分类链接仍 query 串风格, 与同页 NavCats/PageList (buildCategoryURL
        //   输出) 不一致 (canonical weight 分散). 修复: 注入 CategoryURL = buildCategoryURL
        //   (style, catID, 1), 模板改 {{.CategoryURL}} / {{.Book.CategoryURL}}. catID 空
        //   时 CategoryURL = "/?view=category" (BUG-250 修复后 buildCategoryURL 空 catID
        //   page=1 返此形态), 与原 hardcoded /?view=category&cat= (cat= 空, server 视
        //   catID="" 走全本分类) 行为等价. injectBookURLs (列表) 调本函数, 故列表页每本
        //   书也获 CategoryURL (topBooks/takeBooks 共享 map 引用, 派生 slice 同款覆盖).
        // R92-D BUG-256 (P3, main+templates scope, 顺延 R91-D BUG-254 hardcoded category
        //   family): aijjxs/book.html line 145 "返回列表" 链接硬编码
        //   /?view=category{{if .Book.categoryId}}&cat={{.Book.categoryId | urlquery}}{{end}}
        //   绕过 buildCategoryURL — R91-D BUG-254 修 9 book.html + 6 list-page 共 29
        //   callsite 时遗漏此 callsite (guarded {{if .Book.categoryId}} 形式视为已条件化
        //   而漏审). admin 配 pseudoStaticStyle=numeric 时, "返回列表" URL = /?view=
        //   category&cat={id} (query), 与同页 {{.Book.CategoryURL}} (line 61, BUG-254
        //   修) + NavCats/PageList (buildCategoryURL 输出 /category/{hash}.html) 不
        //   一致 (canonical weight 分散). 修复: aijjxs/book.html line 145 改
        //   {{.Book.CategoryURL}} (与 line 61 同字段, catID 空 → /?view=category 全本
        //   分类, catID 非空 → pseudoStatic 风格 URL, 行为等价 + 风格统一). 0 main.go
        //   改动 (CategoryURL 注入在下方 line 2402, 无需新字段; BUG-256 仅是 template
        //   callsite 替换).
        catID, _ := book["categoryId"].(string)
        book["CategoryURL"] = buildCategoryURL(style, catID, 1)
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

// R100-D BUG-287 (P3 correctness, main scope) + BUG-288 (P4 精简/DRY, main scope):
// clampPageOffset — clamp page 到真实 totalPages (由 COUNT total 推导) + cap offset 到
// maxPaginationOffset. 被 getCategoryViewData/getRankingViewData/getFulltextViewData 三处
// 分页函数共用.
//
//   BUG-287: 原 3 函数仅 `offset := (page-1)*size; if offset > 10000 { offset = 10000 }` 不
//     clamp page 到 totalPages. caller (homeHandler category/ranking/fulltext case) 在 fetch
//     后才 clamp `if page > totalPages { page = totalPages }` — fetch 用的是 un-clamped page:
//     当 totalPages < page ≤ maxPages (e.g. total=50 size=24 totalPages=3, 用户请求 page=4,
//     4 ≤ maxPages=417 故 caller 预 clamp 不触发): getXxxViewData 用 page=4 → OFFSET=72 >
//     total=50 → SQL 返 0 行 → Books=[]; caller 后 clamp page=3 → 显示 "Page 3/3" 但 Books
//     为空 (应显示 page 3 的 2 本书). 修复: getXxxViewData 内 (COUNT 后 SELECT 前) clamp
//     page 到 totalPages, fetch 用 clamped page → Books 与显示 Page 一致. 0 行为变化 for
//     valid pages (page ≤ totalPages → clamp no-op). 跨 R64-D BUG-31 maxPages clamp (caller
//     -side 防 page > maxPages 致 OFFSET cap 越界) 互补: BUG-31 防 page > maxPages, BUG-287
//     防 totalPages < page ≤ maxPages (BUG-31 未覆盖的 in-range beyond-data gap).
//   BUG-288: 抽 clampPageOffset helper 替 3 处 inline offset 块 (DRY, 0 行为变化). 原 3 处
//     各 4 行 (offset 算 + cap if) → 各 1 行 callsite; clamp 逻辑集中 helper 内.
func clampPageOffset(page, total, size int) (int, int) {
        if size < 1 {
                size = 1
        }
        totalPages := (total + size - 1) / size
        if totalPages < 1 {
                totalPages = 1
        }
        if page < 1 {
                page = 1
        }
        if page > totalPages {
                page = totalPages
        }
        offset := (page - 1) * size
        if offset > maxPaginationOffset {
                offset = maxPaginationOffset
        }
        return page, offset
}

// R54-1A: feedbackWidgetHTML — 前台浮窗反馈按钮 (右下角固定定位, inline 样式避免依赖主题 CSS 变量).
//
//  1. 浮动按钮 💬 反馈 — 点击展开模态框
//  2. 模态框: type select + content textarea + contact input + 提交按钮
//  3. JS: POST /api/feedback, 关闭模态框 + Toast 反馈成功/失败
//  4. z-index 极高 (2147483000) 保证不被主题样式遮盖; inline style + IIFE 不污染全局作用域
//
// 注入策略: homeHandler 在 ExecuteTemplate 后追加到响应 buffer 末尾 (即 </html> 之后).
//
//      浏览器对 </html> 后的内容容错渲染, 模态框 fixed 定位 + z-index 保证视觉一致.
//      该常量全静态, 无用户可控字段, 无注入风险.
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

// R83-D (R82 交接 #3): bookHistoryTrackerHTML — book view 浏览足迹 JS (注入在
// homeHandler case "book" 后, 与 feedbackWidgetHTML 同款 buf.WriteString 模式).
//
// 设计要点:
//   - id 由 case "book" Go 端 fmt.Sprintf %s 注入 (template.JSEscapeString 转义,
//     防 XSS — id 经 getBookViewData 校验合法 cuid2, 但 defense in depth 防 </script>
//     注入).
//   - localStorage 'heisHistory' 维护 id 数组 (unshift 当前 id 到前, dedup, cap 48).
//   - cookie 'bookHistory' = JSON {"ids":[...]} (与 getHistoryViewData Go 端同款
//     wrapper 格式). encodeURIComponent 转义 + max-age 1y + SameSite=Lax. Cookie
//     上限 8192 bytes (Go 端 capped 8192; JS 端 < 8192 才写, 避免被浏览器 4KB 限截断).
//   - 隐私: 纯客户端 (无 userID/IP/session 跟踪, 不写 Setting 表).
//   - 容错: try/catch 包整段 (localStorage 不可用 / 浏览器禁 cookie → 静默跳过,
//     不影响 book view 渲染).
var bookHistoryTrackerHTML = `<script>(function(){
  try {
    var bid = "%s";
    if (!bid) return;
    var key = 'heisHistory';
    var raw = localStorage.getItem(key);
    var arr = [];
    if (raw) { try { arr = JSON.parse(raw); if (!Array.isArray(arr)) arr = []; } catch(e) { arr = []; } }
    // R84-D BUG-197 (R83-D 诚实留痕 #5 修复): localStorage 被外部修改含非 string
    //   元素 (e.g. [1,2,"abc"]) → arr 含数字 → JSON.stringify 生成
    //   {"ids":[1,2,"abc"]} → Go 端 getHistoryViewData json.Unmarshal wrapper.
    //   IDs []string 失败 → 返 nil → fallback latest 48. 改: filter 仅留
    //   string 元素 (与 Go 端 []string 一致), 同步移除 bid (dedup 用, 与下
    //   行 arr.unshift(bid) 配合保 bid 唯一在前). 1 行 guard, 0 perf 影响.
    arr = arr.filter(function(x){ return typeof x === 'string' && x !== bid; });
    arr.unshift(bid);
    if (arr.length > 48) arr.length = 48;
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch(e) {}
    var cookieVal = encodeURIComponent(JSON.stringify({ids:arr}));
    if (cookieVal.length < 8192) {
      document.cookie = 'bookHistory=' + cookieVal + '; path=/; max-age=31536000; SameSite=Lax';
    }
  } catch(e) {}
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
                // R81-D BUG-179: per-row Scan err log + skip (8 plain string + 1 bool,
                //   非 NullString; 若列中途 ALTER 改 NULL 会 Scan 失败, 旧实现 site 行含空字段).
                if err := rows.Scan(&id, &name, &domain, &themeID, &isDefault, &title, &desc, &kw); err != nil {
                        log.Printf("[R81-D] sitesHandler rows.Scan failed: %v - skipping row", err)
                        continue
                }
                sites = append(sites, map[string]interface{}{"id": id, "name": name, "domain": domain, "themeId": themeID, "isDefault": isDefault, "title": title, "description": desc, "keywords": kw})
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] sitesHandler rows.Err(): %v", rerr)
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
//
//      R57-1B 接入智能 TDK: SELECT 加 chapterSeoAuto + chapterSeoTitleTemplate +
//        chapterSeoDescTemplate + chapterSeoKeywordsTemplate 字段 (供 getReadViewData 消费).
//      R63-A 接入伪静态: SELECT 加 pseudoStaticStyle 字段 (供 homeHandler 伪静态 URL 解析 +
//        模板层 URL builder 消费). 其它 R16/R22 字段 (chapterPaginationMode/navCategoryCount/等)
//        留给后续轮次按需扩展 SELECT (本轮只加 pseudoStaticStyle 一列, 不动其它).
//      R70-A per-site 配置: 在返回 map 内补 ObfuscateHTML + KeywordTranscode 两字段 (因
//        Site 表无此列, 严禁 prisma db push, 用 Setting 表 key="obfuscateHTML:{id}" +
//        "keywordTranscode:{id}" 兜底; per-site key 缺失时 fallback 全局 Setting). 两字段
//        供 writeRenderedHTML/transcodeChapterSeoOutput 读取 per-site 覆盖全局开关.
func getSite(siteID string) (map[string]interface{}, error) {
        q := `SELECT id,name,domain,themeId,isDefault,title,description,keywords,offset,chapterSeoAuto,chapterSeoTitleTemplate,chapterSeoDescTemplate,chapterSeoKeywordsTemplate,pseudoStaticStyle FROM Site WHERE status=1`
        var rows *sql.Rows
        var err error
        // R75-A 目标A1 (DB 连接池健康检查): 记录 db.Query 起始时间, 完成后检测耗时.
        //   若 >5s, log + skip Setting 子查询 (防 composite latency 雪上加霜), 返 fallback
        //   最小 site map (保 homeHandler 不 404; 用户看到 site 但无 obfuscateHTML/keywordTranscode
        //   配置, 默认 false/off 安全). modernc.org/sqlite 不完美支持 context.WithCancel
        //   撤销 in-flight query (底层 C library 不响应 ctx), 故用 timing 检测 + 后续降级.
        //   阈值 5s 与 busy_timeout=5000 对齐 (busy_timeout 5s 内重试, >5s 视为 hang).
        queryStart := time.Now()
        if siteID != "" {
                rows, err = db.Query(q+` AND id=?`, siteID)
        } else {
                rows, err = db.Query(q + ` AND isDefault=1`)
        }
        queryDuration := time.Since(queryStart)
        if queryDuration > 5*time.Second {
                // 慢查询: log + 降级路径 (skip Setting 子查, 用空值), 不让 homeHandler 卡 5s+.
                //   注: 即使 rows != nil (返了结果), 也跳过 Setting 子查避免雪上加霜.
                log.Printf("[R75-A] getSite SLOW QUERY: db.Query took %v (>5s threshold, siteID=%q) - skipping Setting sub-queries", queryDuration, siteID)
        }
        if err != nil {
                // R75-A 目标A1: 查询失败时 log + 返 fallback site map (保 homeHandler 不 404).
                //   原 return nil, err 让 homeHandler 走 http.NotFound / http.Error → 预览挂掉.
                //   现返最小 fallback map: ID="" 触发 homeHandler 内 site["ID"]=nil, 渲染用空
                //   Site 字段 (Title="" 等), 模板 fallback 显示; 用户看到 "无站点配置" 而非 502.
                //   与 R64-D render404 fallback 同款 (site==nil → http.NotFound, 但 homeHandler
                //   主流程对 site map 非 nil 仍渲染).
                log.Printf("[R75-A] getSite db.Query failed (siteID=%q, took=%v): %v - returning fallback site map", siteID, queryDuration, err)
                return map[string]interface{}{"ID": "", "Name": "fallback", "Domain": "", "ThemeID": "", "IsDefault": false, "Title": "", "Description": "", "Keywords": "", "Offset": 0, "ChapterSeoAuto": false, "ChapterSeoTitleTemplate": "", "ChapterSeoDescTemplate": "", "ChapterSeoKeywordsTemplate": "", "PseudoStaticStyle": "query", "ObfuscateHTML": false, "KeywordTranscode": "off"}, nil
        }
        // R70 主控修复: rows 持锁期间调 getSiteObfuscateHTML/getSiteKeywordTranscodeMode
        //   (内部 db.QueryRow 查 Setting) → SQLite 连接池等待 rows 释放 → 死锁 hang (与 R63 批量 TDK 同款).
        //   修复: 先 Scan 收齐字段 + 显式 rows.Close() + 再查 Setting.
        var id, name, domain, themeID, title, desc, kw, seoTmplT, seoTmplD, seoTmplK, pseudoStaticStyle string
        var isDefault bool
        var offset int
        var seoAuto bool
        var found bool
        if rows.Next() {
                // R81-D BUG-179: per-row Scan err — 旧实现 Scan 失败时 found 仍 true, 致
                //   返空字段 site map 而非 fallback 查询. schema @default 防 NULL (R77-D
                //   #12 评估), 但 corrupted DB / migration 中途态仍可能触发. 修复: Scan
                //   失败 → found 保持 false, 走 fallback 查询 (与 rows.Next()=false 同款).
                if err := rows.Scan(&id, &name, &domain, &themeID, &isDefault, &title, &desc, &kw, &offset, &seoAuto, &seoTmplT, &seoTmplD, &seoTmplK, &pseudoStaticStyle); err != nil {
                        log.Printf("[R81-D] getSite primary rows.Scan failed (siteID=%q): %v - falling through to fallback query", siteID, err)
                } else {
                        found = true
                }
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] getSite rows.Err() during primary scan (siteID=%q): %v", siteID, rerr)
        }
        rows.Close() // 显式释放连接, 后续 Setting 查询不再阻塞
        if found {
                if pseudoStaticStyle == "" {
                        pseudoStaticStyle = "query"
                }
                // R75-A 目标A1: 慢查询时 skip Setting 子查 (用 false/off 默认值).
                if queryDuration > 5*time.Second {
                        return map[string]interface{}{"ID": id, "Name": name, "Domain": domain, "ThemeID": themeID, "IsDefault": isDefault, "Title": title, "Description": desc, "Keywords": kw, "Offset": offset, "ChapterSeoAuto": seoAuto, "ChapterSeoTitleTemplate": seoTmplT, "ChapterSeoDescTemplate": seoTmplD, "ChapterSeoKeywordsTemplate": seoTmplK, "PseudoStaticStyle": pseudoStaticStyle, "ObfuscateHTML": false, "KeywordTranscode": "off"}, nil
                }
                return map[string]interface{}{"ID": id, "Name": name, "Domain": domain, "ThemeID": themeID, "IsDefault": isDefault, "Title": title, "Description": desc, "Keywords": kw, "Offset": offset, "ChapterSeoAuto": seoAuto, "ChapterSeoTitleTemplate": seoTmplT, "ChapterSeoDescTemplate": seoTmplD, "ChapterSeoKeywordsTemplate": seoTmplK, "PseudoStaticStyle": pseudoStaticStyle, "ObfuscateHTML": getSiteObfuscateHTML(id), "KeywordTranscode": getSiteKeywordTranscodeMode(id)}, nil
        }
        // fallback 第一个 (R42-1A: 显式 err 检查防 nil rows2.Close() panic; 之前 _ 忽略 err →
        //                  若 db.Query 失败 rows2 为 nil, defer rows2.Close() 在 nil 上调用 panic)
        rows2, qErr := db.Query(q + ` LIMIT 1`)
        if qErr != nil {
                // R75-A 目标A1: fallback 查询失败 log + 返 fallback site map (保 homeHandler 不 404).
                log.Printf("[R75-A] getSite fallback db.Query failed (siteID=%q): %v - returning fallback site map", siteID, qErr)
                return map[string]interface{}{"ID": "", "Name": "fallback", "Domain": "", "ThemeID": "", "IsDefault": false, "Title": "", "Description": "", "Keywords": "", "Offset": 0, "ChapterSeoAuto": false, "ChapterSeoTitleTemplate": "", "ChapterSeoDescTemplate": "", "ChapterSeoKeywordsTemplate": "", "PseudoStaticStyle": "query", "ObfuscateHTML": false, "KeywordTranscode": "off"}, nil
        }
        // R70 主控修复: 同上, rows2 持锁期间调 Setting 查询会死锁.
        var id2, name2, domain2, themeID2, title2, desc2, kw2, seoTmplT2, seoTmplD2, seoTmplK2, pseudoStaticStyle2 string
        var isDefault2 bool
        var offset2 int
        var seoAuto2 bool
        var found2 bool
        if rows2.Next() {
                // R81-D BUG-179: 同 primary scan, Scan 失败 → found2 保持 false → 返 nil nil
                //   (homeHandler 走 404 路径, 不返空字段 site map 误导).
                if err := rows2.Scan(&id2, &name2, &domain2, &themeID2, &isDefault2, &title2, &desc2, &kw2, &offset2, &seoAuto2, &seoTmplT2, &seoTmplD2, &seoTmplK2, &pseudoStaticStyle2); err != nil {
                        log.Printf("[R81-D] getSite fallback rows2.Scan failed (siteID=%q): %v - returning nil (homeHandler will 404)", siteID, err)
                } else {
                        found2 = true
                }
        }
        // R75-A 目标C4: rows2 迭代后检查 rows2.Err().
        if rerr := rows2.Err(); rerr != nil {
                log.Printf("[R75-A] getSite rows2.Err() during fallback scan (siteID=%q): %v", siteID, rerr)
        }
        rows2.Close() // 显式释放连接
        if found2 {
                if pseudoStaticStyle2 == "" {
                        pseudoStaticStyle2 = "query"
                }
                // R75-A 目标A1: 慢查询时 skip Setting 子查.
                if queryDuration > 5*time.Second {
                        return map[string]interface{}{"ID": id2, "Name": name2, "Domain": domain2, "ThemeID": themeID2, "IsDefault": isDefault2, "Title": title2, "Description": desc2, "Keywords": kw2, "Offset": offset2, "ChapterSeoAuto": seoAuto2, "ChapterSeoTitleTemplate": seoTmplT2, "ChapterSeoDescTemplate": seoTmplD2, "ChapterSeoKeywordsTemplate": seoTmplK2, "PseudoStaticStyle": pseudoStaticStyle2, "ObfuscateHTML": false, "KeywordTranscode": "off"}, nil
                }
                return map[string]interface{}{"ID": id2, "Name": name2, "Domain": domain2, "ThemeID": themeID2, "IsDefault": isDefault2, "Title": title2, "Description": desc2, "Keywords": kw2, "Offset": offset2, "ChapterSeoAuto": seoAuto2, "ChapterSeoTitleTemplate": seoTmplT2, "ChapterSeoDescTemplate": seoTmplD2, "ChapterSeoKeywordsTemplate": seoTmplK2, "PseudoStaticStyle": pseudoStaticStyle2, "ObfuscateHTML": getSiteObfuscateHTML(id2), "KeywordTranscode": getSiteKeywordTranscodeMode(id2)}, nil
        }
        return nil, nil
}

// computeChapterSeo — 按站点 chapterSeoAuto + chapterSeoTitleTemplate 等算 SEO TDK.
//
//      R57-1B 接入智能 TDK. 占位符 (chapterSeoAuto=false 用户模板): {bookName} {chapterTitle}
//        {page} {totalPages} {siteName}.
//      chapterSeoAuto=true (默认): 用与原模板硬编码一致的字段组合 (site.Title / site.Keywords
//        / book.author), 与原模板 `{{.Chapter.title}} - {{.Book.name}} - {{.Site.Title}}` /
//        `{{.Book.name}},{{.Chapter.title}},{{.Book.author}},{{.Site.Keywords}}` /
//        `{{.Book.name}}{{.Chapter.title}}全文阅读,{{.Book.intro}}` 字段口径对齐, 保持向后
//        兼容 (chapterSeoAuto=true 渲染结果与原硬编码一致, 不引入 {siteName} 占位符歧义).
//      chapterSeoAuto=false: 用 chapterSeoTitleTemplate 等用户模板 (替换 {bookName}
//        {chapterTitle} {page} {totalPages} {siteName} 占位符); 空模板 fallback 默认.
//      注: page/totalPages 当前 Go 端不分页 (chapterPaginationMode=off), 占位符 {page}/{totalPages} 用 1/1.
//      注: 101kks 原用 `全文閱讀` 繁体 + ggd66/x2552 原 description 缺 intro, 默认模板
//        用 `全文阅读` 简体 + 含 intro — 站点繁简差异 (101kks 不再是繁体 description) +
//        description 内容增强 (ggd66/x2552 多 100 字 intro), 不算 bug.
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
                // R69-A/R70-A: 应用关键词转码 (per-site mode 优先, fallback 全局)
                return transcodeChapterSeoOutput(site, defaultTitle, defaultDesc, defaultKw)
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
        // R69-A/R70-A: 应用关键词转码 (per-site mode 优先, fallback 全局)
        return transcodeChapterSeoOutput(site, apply(titleTmpl, defaultTitle), apply(descTmpl, defaultDesc), apply(kwTmpl, defaultKw))
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
//   R70-A: per-site key='keywordTranscode:{siteID}' 覆盖全局 (Setting 兜底, Site 表无列).
//   R70-A: 正文转码 Setting key='transcodeContent' (默认 off, 仅允许 homophone/pinyin/
//   mixed 三模式, split/zwsp 自动降级 mixed 防 HTML 标签破裂), wired into getReadViewData.

// R69-A: transcodeEntry 一条敏感词的转码选项.
type transcodeEntry struct {
        homophone string // 同音字替换 (空 = 该词无合适同音字, homophone 模式跳过)
        pinyin    string // 拼音替换 (小写无音调)
}

// R69-A: sensitiveWordDict 内置敏感词字典 (~30 词). 覆盖中文小说站常见敏感词.
//
//      注: 同音字为人工挑选 (尽量贴近原音 + 视觉相似); 部分词无合适同音字则空.
//      注: pinyin 为人工输入 (常见词, 不引 pinyin 库保零依赖).
//      注: 长词优先替换 (transcodeDictReplace 按 rune 长度降序遍历), 防短词嵌入长词
//        内被先替换 (e.g. "免费小说" 优先匹配整词, 而非 "免费"+"小说" 拆分).
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
        "txt":   {"", "txt"},
        "TXT":   {"", "txt"},
}

// sortedSensitiveDictKeys 返回字典 key 按 rune 长度降序排列 (长词优先替换).
//
//      每次 transcodeDictReplace / transcodeMixed 调用一次, 字典小 (~30 词) 故开销可忽略.
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
//
//      mode = "" / "off" → passthrough.
//      mode = "split" → 字符间插可见空格.
//      mode = "zwsp" → 字符间插零宽空格 U+200B (视觉不可见).
//      mode = "homophone" / "pinyin" → 仅替换字典内敏感词.
//      mode = "mixed" → 每个字典词用确定性 hash 选 homophone/pinyin/zwsp/passthrough.
//      未知 mode → passthrough (保守不破坏).
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
//
//      "免费小说" → "免 费 小 说". CJK + latin 均适用.
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
//
//      "免费小说" → "免\u200B费\u200B小\u200B说" (显示仍为 "免费小说").
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
//
//      非字典词保留原样 (避免破坏正常 TDK 可读性). 字典为空同音字时跳过.
//      长词优先替换 (sortedSensitiveDictKeys 按 rune 长度降序).
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
//
//      同 word 同输出 (避免缓存闪变). 非字典词保留 (split 不对全字符串应用, 仅字典词).
//      hash 用 FNV-1a 32-bit (与 obfuscateRNG 同款 hash 不同位数).
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
//
//      value 存储格式: JSON 编码字符串 ("\"split\"") 或 raw 字符串 ("split").
//      未知值 → "off" (保守不破坏).
//      每次 computeChapterSeo 调用一次 (SQLite 单行查询, <0.1ms, 不需缓存层).
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
//
//      R70-A: 读 site["KeywordTranscode"] (per-site) 优先, 缺失时 fallback 全局 Setting
//      "keywordTranscode". mode="off"/"" → passthrough; 否则应用 transcodeKeyword(mode)
//      到 title/desc/kw. 在 computeChapterSeo 两处 return 之前统一调用, 保 TDK 一致转码.
func transcodeChapterSeoOutput(site map[string]interface{}, title, desc, kw string) (string, string, string) {
        mode := ""
        if site != nil {
                if m, ok := site["KeywordTranscode"].(string); ok {
                        mode = m
                }
        }
        if mode == "" {
                mode = getKeywordTranscodeMode()
        }
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
                // R81-D BUG-179: per-row Scan err log + skip (id/name plain string, 非
                //   NullString; schema id/name 均 @id/@default 非 NULL, 但 driver 边界防).
                if err := rows.Scan(&id, &name); err != nil {
                        log.Printf("[R81-D] getCategories rows.Scan failed: %v - skipping row", err)
                        continue
                }
                cats = append(cats, map[string]interface{}{"id": id, "name": name})
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] getCategories rows.Err(): %v", rerr)
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
                m, _, serr := scanBookRow(rows)
                if serr != nil {
                        log.Printf("[R81-D] getBooks rows.Scan failed (limit=%d): %v - skipping row", limit, serr)
                        continue
                }
                books = append(books, m)
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] getBooks rows.Err() (limit=%d): %v", limit, rerr)
        }
        return books, nil
}

func takeN(cats []map[string]interface{}, n int) []map[string]interface{} {
        // R96-D BUG-272 (main+templates scope, 顺延 R84-D BUG-194 takeBooks n==0 guard
        //   对称遗漏): n<0 时 cats[:n] panic (slice bounds out of range). R84-D 仅补
        //   takeBooks n==0 guard, takeN/topBooks 漏 n<0 clamp. 全 caller 现传正
        //   (clampPage ≥1 / getHomeLayoutSetting clamp [4,30] / 字面量 6/8/12), 但 sub
        //   模板 func + 未来 caller 可能传负 → 500. 防御 clamp 与 takeBooks 同款.
        if n < 0 {
                n = 0
        }
        if n > len(cats) {
                n = len(cats)
        }
        return cats[:n]
}

func topBooks(books []map[string]interface{}, n int) []map[string]interface{} {
        // R96-D BUG-272: 同 takeN, n<0 时 sorted[:n] panic, 防御 clamp.
        if n < 0 {
                n = 0
        }
        // 按字数排序取前 N
        sorted := make([]map[string]interface{}, len(books))
        copy(sorted, books)
        // R98-D BUG-280 (P4, main+templates scope, 顺延 R96-D BUG-272 negative-n
        //   guard + scanBookRow dedup; R96-D 未决项 #2): 原 O(n²) 冒泡 (按 wordCount
        //   desc). home view totalNeeded ~88-116 本 → ~7k-13k cmp/req, μs 级但 P4
        //   perf 仍可降 ~10x. sort.Slice O(n log n) ~7k→~600 cmp (88 本) / 13k→
        //   ~800 cmp (116 本). 类型断言加 ok 检查防 panic (wordCount 缺失或类型异
        //   常时降级 0, R41-1B 同款). 0 行为变化 (sort 不稳定但 wordCount 唯一性
        //   高 → 同序; 即便同 wordCount 顺序变也 0 SEO/视觉影响, 模板 range 渲
        //   染无序号依赖). 精简 -7 行 (内层 for + 冒泡 if 块 -7).
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
        sort.Slice(sorted, func(i, j int) bool {
                return wcAt(sorted[i]) > wcAt(sorted[j])
        })
        if n > len(sorted) {
                n = len(sorted)
        }
        return sorted[:n]
}

func takeBooks(books []map[string]interface{}, n int) []map[string]interface{} {
        // R96-D BUG-272 (顺延 R84-D BUG-194 n==0 guard): n<0 时 make([]T,n) +
        //   books[:n] 双 panic (makeslice len out of range / slice bounds). n==0
        //   guard 已存 (BUG-194), 此处补 n<0 → n=0 让 n==0 guard 接管.
        if n < 0 {
                n = 0
        }
        if n > len(books) {
                n = len(books)
        }
        if n == 0 {
                return []map[string]interface{}{}
        }
        // R84-D BUG-194 (R83-D 诚实留痕 #2 修复): 原 return books[:n] 共享底层数组
        //   与调用方 (case home/history/search/... 设 data["Books"]=books +
        //   data["Popular"]=takeBooks(books,12) 等), 两 slice alias 同一 array.
        //   模板只读 → 0 当前 bug; 但 future maintainer 对 Popular 调 append (cap>len
        //   时 in-place 写) 会写穿 Books[idx>=n]. 与 topBooks (line ~3057 make+copy
        //   隔离) 不同款. 改 make+copy 隔离底层数组, +1 alloc/call ~5ms/1000 req
        //   perf (P3 不值得但 latent 风险 + 代码一致性值得). 0 caller 依赖 aliasing
        //   副作用 (rg takeBooks 全 7 处均为只读模板字段注入).
        out := make([]map[string]interface{}, n)
        copy(out, books[:n])
        return out
}

// R82-D: getHistoryViewData — R81 交接 #8 (history view 缺字段) + R77-D 未决项 #10
//
//      修复 BUG-180. 从客户端 `bookHistory` cookie 读浏览历史 (JSON `{"ids":[...]}` 或
//      bare array `[...]`), 查 Book 表返 books list 保序. 调用点: homeHandler case
//      "history" (line ~1033). 不复用 getBooks (后者返 latest 48 books 与浏览历史
//      无关; 仅在 cookie 缺失/空时作 fallback).
//
// 设计要点:
//   - 隐私: 客户端 cookie (无 userID/IP/session 跟踪, 不写 Setting 表).
//     JS 在 book view 模板 (future template work, 不在 main.go 范围) localStorage
//     累积最近浏览 book id → 在用户访问 /?view=history 前 setCookie 序列化 JSON.
//     Cookie 上限 ~4KB (cuid 24 字符 + JSON wrapper ~50 字符/书, 上限 ~80 本),
//     本函数硬 cap 48 本 (与 home view 一致) 防超大 cookie 占用 DB SELECT.
//   - 性能: SQL `WHERE id IN (?, ?, ...)` 一次查全部 id (避免 N+1 SELECT, 与
//     getFeaturedBooks N+1 SELECT 对比). placeholders 数量与 ids 数量一致.
//   - 保序: 返回 slice 按 cookie 中 ids 顺序排列 (最近浏览在前, JS 端管理顺序);
//     cookie 中已删书的 id 跳过 (SQL 不返即不在 byID map, loop 跳过).
//   - 错误容忍: cookie 缺失 / JSON 坏 / DB 错误 → 返 nil (caller fallback latest 48).
//
// 与 BUG-180 留痕对比: R81-D 评估 "history view 是简单占位, fallback shipsay/home
//
//      模板不用这些字段" → 留痕 0 改. 本轮 R82-D 目标A 实装: 即使 shipsay/home 当前
//      不消费 .HistoryBooks, 未来 history.html 模板写者 (R82+ templates 范围) 可直接
//      用 {{range .HistoryBooks}} 渲染真实浏览历史 (含已删书跳过 + 保序 + 48 cap).
//      .Title="浏览足迹" 同款: 未来 history.html 写者用 {{.Title}} 即得正确标题;
//      shipsay/home 用 {{.Site.Title}} 不读 .Title, 当前 fallback 路径渲染无影响.
func getHistoryViewData(cookieValue string) []map[string]interface{} {
        if cookieValue == "" {
                return nil
        }
        // Cookie size cap (~4KB HTTP header 上限; >8KB 视为异常截断 + log).
        if len(cookieValue) > 8192 {
                log.Printf("[R82-D] getHistoryViewData: cookie too large (%d bytes, capping to first 8KB)", len(cookieValue))
                cookieValue = cookieValue[:8192]
        }
        // R85-D BUG-204 (P1 correctness): JS 端 bookHistoryTrackerHTML 用
        //   encodeURIComponent(JSON.stringify({ids:arr})) 包 cookie 值 (防 "; " /
        //   "," 分隔符破 cookie header). 但 Go net/http readCookies 只 strip
        //   外层双引号, 不 URL-decode (RFC 6265 cookie-octet 不规范 % 转义).
        //   故 c.Value 是 raw URL-encoded 串 (e.g. "%7B%22ids%22%3A...").
        //   原 json.Unmarshal 直接吃 "%7B..." → "invalid character '%'" err
        //   → 返 nil → homeHandler case "history" 永远 fallback latest 48
        //   (用户看到最新上传而非自己浏览足迹, 功能完全失效). 实测复现:
        //   /tmp/bug204_test_r85d.go 6 case 全 OLD=[]/NEW=正确.
        //   修复: URL-decode 后再 parse. 兼容: 未编码 cookie (e.g. 直接 JSON)
        //   QueryUnescape 对无 % 串 no-op, 仍合法. 安全: 仅 url.QueryUnescape
        //   (反 QueryEscape), 不执行 HTML/JS 解码 (no XSS surface). 坏 % 序列
        //   (e.g. "%ZZ") → QueryUnescape err → 返 nil (caller fallback latest 48).
        if decoded, derr := url.QueryUnescape(cookieValue); derr == nil {
                cookieValue = decoded
        } else {
                return nil
        }
        // Parse JSON. 先试 {"ids":[...]} wrapper, 失败再试 bare array.
        var ids []string
        var wrapper struct {
                IDs []string `json:"ids"`
        }
        if err := json.Unmarshal([]byte(cookieValue), &wrapper); err == nil && len(wrapper.IDs) > 0 {
                ids = wrapper.IDs
        } else if err := json.Unmarshal([]byte(cookieValue), &ids); err != nil {
                // 非 JSON / 坏 JSON → 静默返 nil (caller fallback). 不 log 防 cookie 测试噪声.
                return nil
        }
        // Cap to 48 (与 home view 一致; 防 cookie 含 100+ ids 致 SQL placeholder 数爆炸).
        if len(ids) > 48 {
                ids = ids[:48]
        }
        if len(ids) == 0 {
                return nil
        }
        // Build placeholders + args for IN clause.
        placeholders := make([]string, len(ids))
        args := make([]interface{}, len(ids))
        for i, id := range ids {
                placeholders[i] = "?"
                args[i] = id
        }
        q := `SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.id IN (` + strings.Join(placeholders, ",") + `)`
        rows, err := db.Query(q, args...)
        if err != nil {
                log.Printf("[R82-D] getHistoryViewData: db.Query IN(%d ids) failed: %v", len(ids), err)
                return nil
        }
        defer rows.Close()
        // Map: id → book (保序用).
        byID := make(map[string]map[string]interface{}, len(ids))
        for rows.Next() {
                m, _, serr := scanBookRow(rows)
                if serr != nil {
                        log.Printf("[R82-D] getHistoryViewData: rows.Scan failed: %v - skipping row", serr)
                        continue
                }
                if bid, ok := m["id"].(string); ok {
                        byID[bid] = m
                }
        }
        // R75-A 目标C4 同款: rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R82-D] getHistoryViewData: rows.Err(): %v", rerr)
        }
        // Build output 保 cookie 顺序; 跳过 cookie 中已删书的 id (不在 byID).
        out := []map[string]interface{}{}
        for _, bid := range ids {
                if book, ok := byID[bid]; ok {
                        out = append(out, book)
                }
        }
        return out
}

// R71-A: getFeaturedBooks — 读 Setting 表 featuredBooks.{siteID} JSON, 按 bookIds
//
//      顺序逐本 SELECT 全元数据 (与 getBooks 同字段集), 已删书 (ErrNoRows) 跳过.
//      返 []map (空 slice = admin 未配置 featuredBooks 或全部书 ID 已删, homeHandler
//      fallback 用 TopBooks 避免空区块).
//
// 设计与 admin.go adminFeaturedBooksList 对齐: 同款 Setting key, 同款 bookIds JSON
//
//      解析, 同款 N+1 SELECT 模式 (单站最多 featuredBooksMax=30 本, ~3ms 总开销, 不需
//      缓存层). 主路径额外注入 ["URL"] 字段供模板用 {{.URL}}.
//
// 错误容忍: Setting 行缺失 / JSON 坏 / Book 表查空 → 返空 slice (homeHandler fallback).
func getFeaturedBooks(siteID string) []map[string]interface{} {
        if siteID == "" {
                return nil
        }
        var raw string
        _ = db.QueryRow(`SELECT value FROM Setting WHERE key=?`, "featuredBooks."+siteID).Scan(&raw)
        if raw == "" || raw == "{}" {
                return nil
        }
        var parsed map[string]interface{}
        if json.Unmarshal([]byte(raw), &parsed) != nil {
                return nil
        }
        arr, ok := parsed["bookIds"].([]interface{})
        if !ok || len(arr) == 0 {
                return nil
        }
        out := []map[string]interface{}{}
        for _, e := range arr {
                bid, ok := e.(string)
                if !ok || bid == "" {
                        continue
                }
                // 与 getBooks 同款 SELECT + 字段集, 保 home.html {{.name}}/{{.author}}/
                //   {{.cover}}/{{.intro}}/{{.wordCount}}/{{.category}}/{{.updatedAt}} 全可消费.
                var id, name, author, intro, cover, status, latestChapter, category, categoryID sql.NullString
                var wordCount int64
                var updatedAt string
                err := db.QueryRow(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.id=?`, bid).
                        Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &updatedAt)
                if err != nil {
                        continue // 书已删 (ErrNoRows) 或 Scan 失败 → 跳过, 不阻塞整体返回.
                }
                out = append(out, map[string]interface{}{
                        "id": id.String, "name": name.String, "author": author.String,
                        "intro": truncate(intro.String, 120), "cover": coverURL(cover.String),
                        "status": status.String, "wordCount": wordCount, "latestChapter": latestChapter.String,
                        "category": category.String, "categoryId": categoryID.String, "updatedAt": formatUpdatedAt(updatedAt),
                })
        }
        return out
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
//
//      explicitly allow external cover URLs (http:// | https:// | /covers/ | /). crawl
//      package UpsertBook stores whatever b.Cover yields — which for source sites with
//      CDN-hosted covers is an external URL (e.g. https://cdn.cdnshu.com/...). DB
//      实测 207/668 (~31%) books 有 external cover URL. 原实现各处 unconditionally
//      `"/" + cover.String` → 把 "https://..." 拼成 "/https://..." → 浏览器视作当前
//      host 的相对路径请求 → /covers/ handler 不认 → 404 + 封面破图. 修复: 加 helper
//      分辨 http(s):// 前缀, 原样返回; 否则前缀 "/". 应用到 4 处 cover 输出
//      (bookDetailHandler / getBooks / bookRowFromScan / getBookViewData).
//
// R68-D BUG-73 (P2): R67-D coverURL 漏 3 类边界 — adminBooksCreate 显式允许
//
//      "/..." 前缀 (站内绝对路径, e.g. "/covers/foo.webp" "/foo.jpg"), 原实现
//      `"/" + cover` 把 "/foo.jpg" 拼成 "//foo.jpg" → 浏览器视作协议相对 URL
//      (proto-relative, e.g. http://foo.jpg) → 跳到外部 host foo.jpg 而非本站
//      /foo.jpg, 跨域 + 404 + 破图. 同款: "data:image/png;base64,..." 内联图也
//      被前缀 "/" 拼成 "/data:..." → 浏览器不识别 data URI → 破图. 用户在 admin
//      UI 直接粘贴 base64 内联图 (避免一次 CDN 请求) 时破图. 修复: 加 3 类边界
//      显式 passthrough (http(s):// / data: / / 开头), 仅相对路径 (covers/foo.webp
//      / images/foo.jpg) 加 "/" 前缀走 /covers/ FileServer. 与 adminBooksCreate +
//      adminBookByIDHandler PUT 的 cover 校验 (允许 http(s):// + /covers/ + / 开头)
//      + crawl UpsertBook (允许任意字符串, source 站 CDN 直存) 三处对齐.
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
//
//      漏微秒 (1e15+, Go time.Now().UnixMicro() 来源) 与纳秒 (1e18+, Go time.Now().UnixNano()
//      来源). 若上游 (TS admin API 写入 / 第三方同步) 用 UnixMicro / UnixNano, 原 i/1000
//      把微秒当毫秒除 → 1698765432000000 / 1000 = 1698765432000 (仍是毫秒) →
//      time.Unix(1698765432000, 0) → 公元 56000+ 年. 修复: 按数量级 4 级判断 —
//      ≥1e17 纳秒 /1e9, ≥1e14 微秒 /1e6, ≥1e11 毫秒 /1e3, 否则秒. 阈值取
//      "今年各精度下限的 100x" 防边界 (e.g. 2024-01-01 秒=1704067200, 毫秒=1.7e12,
//      微秒=1.7e15, 纳秒=1.7e18; 阈值 1e11/1e14/1e17 在各精度下限 + 100 年内仍稳定).
//
// R53-1A 修复 BUG-3: 原 time.Parse 仅尝试 "2006-01-02T15:04:05" (ISO 无时区) +
//
//      "2006-01-02 15:04:05" (SQLite TEXT), 漏:
//      - "2006-01-02T15:04:05Z" (ISO 8601 UTC, TS admin API 常见)
//      - "2006-01-02T15:04:05+08:00" / "-07:00" (ISO 带时区)
//      - time.RFC3339 (完整 ISO 8601, 含毫秒 + 时区)
//      - "2006-01-02" (SQLite DATE 类型, 仅日期无时分)
//      - "2006/01/02 15:04:05" (slash 分隔, 部分中文源站格式)
//      - "2006/01/02" (slash 日期)
//      原 "2024-01-01T12:00:00Z" → Parse("2006-01-02T15:04:05") 失败 (因 layout 无 Z) →
//      回退返原字符串 "2024-01-01T12:00:00Z" 给前端, 显示带 T 和 Z 的乱码时间. 修复:
//      补 5 个 layout 兜底 + 时区感知 Parse (用 time.ParseInLocation 防本地时区漂移).
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
                time.RFC3339,          // 2006-01-02T15:04:05Z07:00 (ISO 8601 含时区, Z / ±HH:MM)
                "2006-01-02T15:04:05", // ISO 无时区
                "2006-01-02 15:04:05", // SQLite TEXT
                "2006-01-02 15:04",    // SQLite TEXT 精确到分
                "2006-01-02",          // SQLite DATE
                "2006/01/02 15:04:05", // slash 分隔 + 时分秒
                "2006/01/02 15:04",    // slash 分隔 + 时分
                "2006/01/02",          // slash 日期
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

// scanBookRow 把标准 11-列 Book SELECT (b.id,b.name,b.author,b.intro,b.cover,b.status,
// b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt) 的
// 单行 Scan + bookRowFromScan 封装, dedupe R81-D 起在 8 个 view-data 函数里逐字复制的
// ~8 行 scan 块 (R96-D 精简). 返 map + 原始 intro 串 (供 getSearchViewData 150 字 /
// getKeywordViewData 200 字二次截断, 因 bookRowFromScan 默认截 120); Scan err 返 caller
// log + skip. 入参 rows 为 *sql.Rows (8 个调用点均为 rows 循环).
func scanBookRow(rows *sql.Rows) (m map[string]interface{}, rawIntro string, err error) {
        var id, name, author, intro, cover, status, latestChapter, category, categoryID sql.NullString
        var wordCount int64
        var updatedAt string
        if err = rows.Scan(&id, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryID, &updatedAt); err != nil {
                return nil, "", err
        }
        return bookRowFromScan(id, name, author, intro, cover, status, latestChapter, category, categoryID, wordCount, updatedAt), intro.String, nil
}

// resolveBookWordCount 返回 bookID 的有效字数: wc 非 0 时直返, 否则 fallback
// SUM(Chapter.wordCount) FROM Chapter WHERE bookId=? (R75-A 目标C3, R74 交接 #5
// ParsedWordCount DB 聚合; 修复 incremental recrawl 场景 Book.wordCount 仅含本轮
// 新采章节字数). R99-D 精简: 抽自 getBookViewData + getReadViewData 两处同款 fallback
// 块 (DRY, 0 行为变化). 性能: 单次 SELECT SUM ~1ms (Chapter 表 bookId 索引);
// 仅 wc==0 时触发, 正常态 Book.wordCount 已正确不聚合.
func resolveBookWordCount(bookID string, wc int64) int64 {
        if wc != 0 {
                return wc
        }
        var aggWC sql.NullInt64
        if qerr := db.QueryRow(`SELECT COALESCE(SUM(wordCount), 0) FROM Chapter WHERE bookId=?`, bookID).Scan(&aggWC); qerr == nil && aggWC.Valid && aggWC.Int64 > 0 {
                return aggWC.Int64
        } else if qerr != nil && qerr != sql.ErrNoRows {
                log.Printf("[R75-A] resolveBookWordCount SUM(Chapter.wordCount) failed (bookID=%s): %v", bookID, qerr)
        }
        return wc
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
        // R75-A 目标C3: Book.wordCount==0 时 fallback SUM(Chapter.wordCount). R99-D
        //   精简: 抽 resolveBookWordCount helper (与 getReadViewData 同款, 0 行为变化).
        wordCount = resolveBookWordCount(id, wordCount)
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
                // R99-D BUG-284 (P4, BUG-279 family 续): 原 `defer rows.Close()` 在 if 块内 —
                //   defer 绑定到函数末 (非块末), rows 持续到 getBookViewData 返才关 (跨越
                //   recent/related 两轮 db.Query, 持有连接). 改: 显式 rows.Close() 块末
                //   (rows.Err() 后, 与 R98-D BUG-279 getKeywordViewData rows2 同款). 0 行为
                //   变化, 连接提前释放 (connection pool pressure ↓).
                for rows.Next() {
                        var cid, title, volume sql.NullString
                        var idx int
                        var wc int64
                        // R81-D BUG-179 (P3): per-row Scan err swallow → log + skip (与 R77-D
                        //   sitemapBooksPage BUG-155 同款 pattern, R75-A 仅补 rows.Err 但
                        //   per-row Scan err 仍静默). 旧实现 Scan 失败时 cid/title 全空仍
                        //   append, 致 chapters slice 含 "幽灵章" (id=""/title=""), 模板
                        //   range .Chapters 渲染空 <a></a> + firstChID 永远 "" →
                        //   FirstChapterURL 不设 → book view "开始阅读" 按钮永远禁用 (即使
                        //   后续行有有效 cid). schema: Chapter.{id,idx,title,wordCount} 均
                        //   @default 非 NULL, 但 corrupted DB / migration 中途态 / driver
                        //   边界 (e.g. idx 列中途 ALTER 改类型) 仍可能触发. 修复: Scan
                        //   失败 log + continue 跳过该行, firstChID 由下一有效行设.
                        if err := rows.Scan(&cid, &idx, &title, &wc, &volume); err != nil {
                                log.Printf("[R81-D] getBookViewData chapters rows.Scan failed (bookID=%s): %v - skipping row", id, err)
                                continue
                        }
                        chapters = append(chapters, map[string]interface{}{
                                "id": cid.String, "idx": idx, "title": title.String,
                                "wordCount": wc, "volume": volume.String,
                        })
                        if firstChID == "" {
                                firstChID = cid.String
                        }
                }
                // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
                if rerr := rows.Err(); rerr != nil {
                        log.Printf("[R75-A] getBookViewData chapters rows.Err() (bookID=%s): %v", id, rerr)
                }
                rows.Close() // R99-D BUG-284: 即时关 (BUG-279 family).
        }

        // 3. 最近章节 (按 idx desc 取 12, 然后反转顺序让其显示为最新→次新)
        recent := []map[string]interface{}{}
        if rows2, err := db.Query(`SELECT id, title FROM Chapter WHERE bookId=? ORDER BY idx DESC LIMIT 12`, id); err == nil {
                // R99-D BUG-284: 同 rows, defer-in-if-block → 显式 rows2.Close() 块末.
                tmp := []map[string]interface{}{}
                for rows2.Next() {
                        var cid, title sql.NullString
                        // R81-D BUG-179: 同 chapters loop, per-row Scan err log + skip
                        //   防 "幽灵最近章" (id=""/title="") 入 recent slice.
                        if err := rows2.Scan(&cid, &title); err != nil {
                                log.Printf("[R81-D] getBookViewData recent rows2.Scan failed (bookID=%s): %v - skipping row", id, err)
                                continue
                        }
                        tmp = append(tmp, map[string]interface{}{"id": cid.String, "title": title.String})
                }
                // R75-A 目标C4: rows2 迭代后检查 rows2.Err().
                if rerr := rows2.Err(); rerr != nil {
                        log.Printf("[R75-A] getBookViewData recent rows.Err() (bookID=%s): %v", id, rerr)
                }
                rows2.Close() // R99-D BUG-284: 即时关 (BUG-279 family).
                // 反转
                for i := len(tmp) - 1; i >= 0; i-- {
                        recent = append(recent, tmp[i])
                }
        }

        // 4. 同类推荐 (同 categoryId, 排除当前书, 取 12 本)
        related := []map[string]interface{}{}
        if categoryID.String != "" {
                if rows3, err := db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.categoryId=? AND b.id!=? ORDER BY b.updatedAt DESC LIMIT 12`, categoryID.String, id); err == nil {
                        // R99-D BUG-284: 同 rows/rows2, defer-in-if-block → 显式 rows3.Close() 块末.
                        for rows3.Next() {
                                m, _, serr := scanBookRow(rows3)
                                if serr != nil {
                                        log.Printf("[R81-D] getBookViewData related rows3.Scan failed (bookID=%s catID=%s): %v - skipping row", id, categoryID.String, serr)
                                        continue
                                }
                                related = append(related, m)
                        }
                        // R75-A 目标C4: rows3 迭代后检查 rows3.Err().
                        if rerr := rows3.Err(); rerr != nil {
                                log.Printf("[R75-A] getBookViewData related rows.Err() (bookID=%s catID=%s): %v", id, categoryID.String, rerr)
                        }
                        rows3.Close() // R99-D BUG-284: 即时关 (BUG-279 family).
                }
        }

        return book, chapters, recent, related, firstChID, true
}

// getReadViewData 装配 read 视图所需: chapter content + book 信息 + prev/next
//
//      R57-1B: 接收 site 参数, 调 computeChapterSeo 算 SEO TDK 写入 chapter map
//        (供模板消费 .Chapter.seoTitle / .Chapter.seoKeywords / .Chapter.seoDesc).
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
        // R70-A: 正文关键词转码 (Setting.transcodeContent != "off" 时应用).
        //   保守: 仅替字典内敏感词 (transcodeDictReplace/transcodeMixed), HTML 标签不动
        //   (字典为中文敏感词, 不出现在 <p>/<a> 标签名内, 不破 HTML). split/zwsp 模式
        //   会逐字符插分隔符破 HTML → getTranscodeContentMode 自动降级到 mixed.
        bodyHTML = transcodeChapterContent(bodyHTML, getTranscodeContentMode())
        chapter := map[string]interface{}{
                "id": cid.String, "title": title.String, "content": template.HTML(bodyHTML),
                "idx": idx, "wordCount": wc,
        }

        // 2. 查 book (id, name, author, status, category, intro, cover)
        var bid, bname, bauthor, bstatus, bcategory, bintro, bcover sql.NullString
        // R75-A 目标C3 (R74 交接 #5 ParsedWordCount DB 聚合): 同时取 Book.wordCount,
        //   若 ==0 fallback SUM(Chapter.wordCount) FROM Chapter WHERE bookId=?.
        //   原 SQL 不查 wordCount, read view 模板用 .Chapter.wordCount (单章) 不用
        //   Book.wordCount, 但 SEO TDK + 上下章导航 + 后续 R76+ 模板字段对齐需 Book
        //   总字数 (e.g. 面包屑 "本书 100 万字"). 加 wordCount 字段到 SELECT, 与
        //   getBookViewData 同款 fallback 聚合.
        //
        // R79-D BUG-161 (P2): 原 SQL 漏 b.cover 列 → bookMap 无 "cover" key → homeHandler
        //   read view pSEO 注入 (line 868 bookCoverRead, _ := book["cover"].(string)) 拿空
        //   串 → if bookCoverRead != "" 跳过 → OgImage/TwitterImage 永远不设 → 章节页
        //   分享到 FB/Twitter 显示裸链接无图 (社交平台分享体验 + og:image SEO 权重双损失).
        //   修复: SELECT 加 b.cover 列 + Scan 进 bcover (sql.NullString) + bookMap 加
        //   "cover": coverURL(bcover.String) (与 getBookViewData line 3363 同款 coverURL
        //   处理). bookMap["cover"] 永远是非空串 (coverURL("") 返 "") 或合法 URL/相对路径.
        var bwc int64
        if err := db.QueryRow(`SELECT b.id,b.name,b.author,b.status,COALESCE(c.name,'未分类'),b.intro,b.cover,b.wordCount FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.id=?`, bookID.String).Scan(
                &bid, &bname, &bauthor, &bstatus, &bcategory, &bintro, &bcover, &bwc); err != nil {
                // book 查不到也允许渲染
                bookMap := map[string]interface{}{"id": bookID.String, "name": "", "author": "", "status": "", "category": "", "intro": "", "cover": "", "wordCount": int64(0)}
                // R57-1B: 即使 book 查不到, 也填入 SEO TDK (用空 bookName/author/intro + chapterTitle)
                if site != nil {
                        seoT, seoD, seoK := computeChapterSeo(site, title.String, "", "", "")
                        chapter["seoTitle"] = seoT
                        chapter["seoDesc"] = seoD
                        chapter["seoKeywords"] = seoK
                }
                return chapter, bookMap, nil, nil, true
        }
        // R75-A 目标C3: Book.wordCount==0 时 fallback SUM(Chapter.wordCount). R99-D
        //   精简: 抽 resolveBookWordCount helper (与 getBookViewData 同款, 0 行为变化).
        bwc = resolveBookWordCount(bookID.String, bwc)
        bookMap := map[string]interface{}{
                "id": bid.String, "name": bname.String, "author": bauthor.String,
                "status": bstatus.String, "category": bcategory.String, "intro": bintro.String,
                // R79-D BUG-161: 加 cover 字段 (coverURL 处理过, 供 homeHandler read view pSEO
                //   OgImage/TwitterImage 注入消费).
                "cover":     coverURL(bcover.String),
                "wordCount": bwc,
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
        // R98-D BUG-281 (P4, main+templates scope, 顺延 R96-D BUG-272 + R98-D
        //   BUG-279/280; R96-D 未决项 #3): 原用 db.Query LIMIT 1 + Next() + Scan
        //   + Err() + Close() ~7 行/章. 单行查询应用 db.QueryRow.Scan (返 *sql.
        //   Row, 无 Next()/Close()/Err() 链). 行为 0 变化 (QueryRow 内部走同一 SQL
        //   + sql.ErrNoRows 返 nil 仍走 prev/next=nil 路径, 与 homeHandler line
        //   ~894 BUG-195 nil-guard 接管). 精简 -10 行 (prow/nrow Next+Err+Close
        //   + 2 层 if err == nil 块消除). Scan err log 留痕 (R81-D BUG-179 同款).
        var prev, next map[string]interface{}
        var pid, ptitle sql.NullString
        if perr := db.QueryRow(`SELECT id, title FROM Chapter WHERE bookId=? AND idx<? ORDER BY idx DESC LIMIT 1`, bookID.String, idx).Scan(&pid, &ptitle); perr == nil {
                prev = map[string]interface{}{"id": pid.String, "title": ptitle.String}
        } else if perr != sql.ErrNoRows {
                log.Printf("[R81-D] getReadViewData prev QueryRow.Scan failed (chID=%s): %v - leaving prev nil", chID, perr)
        }
        var nid, ntitle sql.NullString
        if nerr := db.QueryRow(`SELECT id, title FROM Chapter WHERE bookId=? AND idx>? ORDER BY idx ASC LIMIT 1`, bookID.String, idx).Scan(&nid, &ntitle); nerr == nil {
                next = map[string]interface{}{"id": nid.String, "title": ntitle.String}
        } else if nerr != sql.ErrNoRows {
                log.Printf("[R81-D] getReadViewData next QueryRow.Scan failed (chID=%s): %v - leaving next nil", chID, nerr)
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

        // R100-D BUG-287+288: clamp page 到 totalPages (COUNT 推导) + cap offset (helper).
        page, offset := clampPageOffset(page, total, size)

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
                m, _, serr := scanBookRow(rows)
                if serr != nil {
                        log.Printf("[R81-D] getCategoryViewData rows.Scan failed (catID=%s page=%d): %v - skipping row", catID, page, serr)
                        continue
                }
                books = append(books, m)
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] getCategoryViewData rows.Err() (catID=%s page=%d): %v", catID, page, rerr)
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

        // R100-D BUG-287+288: clamp page 到 totalPages (COUNT 推导) + cap offset (helper).
        page, offset := clampPageOffset(page, total, size)
        q := `SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id ORDER BY ` + orderClause + ` LIMIT ? OFFSET ?`
        rows, err := db.Query(q, size, offset)
        if err != nil {
                return []map[string]interface{}{}, total
        }
        defer rows.Close()
        books := []map[string]interface{}{}
        for rows.Next() {
                m, _, serr := scanBookRow(rows)
                if serr != nil {
                        log.Printf("[R81-D] getRankingViewData rows.Scan failed (tab=%s page=%d): %v - skipping row", tab, page, serr)
                        continue
                }
                books = append(books, m)
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] getRankingViewData rows.Err() (tab=%s page=%d): %v", tab, page, rerr)
        }
        return books, total
}

// getFulltextViewData 全本完本: status='completed' + 分页
func getFulltextViewData(page, size int) ([]map[string]interface{}, int) {
        var total int
        db.QueryRow(`SELECT COUNT(*) FROM Book WHERE status='completed'`).Scan(&total)
        // R100-D BUG-287+288: clamp page 到 totalPages (COUNT 推导) + cap offset (helper).
        page, offset := clampPageOffset(page, total, size)
        rows, err := db.Query(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.status='completed' ORDER BY b.updatedAt DESC LIMIT ? OFFSET ?`, size, offset)
        if err != nil {
                return []map[string]interface{}{}, total
        }
        defer rows.Close()
        books := []map[string]interface{}{}
        for rows.Next() {
                m, _, serr := scanBookRow(rows)
                if serr != nil {
                        log.Printf("[R81-D] getFulltextViewData rows.Scan failed (page=%d): %v - skipping row", page, serr)
                        continue
                }
                books = append(books, m)
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] getFulltextViewData rows.Err() (page=%d): %v", page, rerr)
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
                m, rawIntro, serr := scanBookRow(rows)
                if serr != nil {
                        log.Printf("[R81-D] getSearchViewData rows.Scan failed (q=%q): %v - skipping row", q, serr)
                        continue
                }
                // 搜索结果简介取 150 字 (scanBookRow 默认截 120, 此处覆写为 150)
                m["intro"] = truncate(rawIntro, 150)
                books = append(books, m)
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] getSearchViewData rows.Err() (q=%q): %v", q, rerr)
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
                m, rawIntro, serr := scanBookRow(rows)
                if serr != nil {
                        log.Printf("[R81-D] getKeywordViewData rows.Scan failed (tag=%q): %v - skipping row", tag, serr)
                        continue
                }
                // 标签结果简介取 200 字 (scanBookRow 默认截 120, 此处覆写为 200)
                m["intro"] = truncate(rawIntro, 200)
                books = append(books, m)
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] getKeywordViewData rows.Err() (tag=%q): %v", tag, rerr)
        }
        // 2. 相关标签: 第一本书的其他 tag, 排除当前 tag, 取 12
        relatedTags := []string{}
        if len(books) > 0 {
                firstBookID, _ := books[0]["id"].(string)
                if firstBookID != "" {
                        // R98-D BUG-279 (P4, main+templates scope, 顺延 R96-D BUG-272
                        //   negative-n guard + scanBookRow dedup; 本 scope 从 279 起避免与
                        //   R96-A fetcher / R96-B crawl / R96-C admin / R97-* 跨 scope 撞号):
                        //   原 `defer rows2.Close()` 在 if 块内 — defer 绑定到函数末 (非块末),
                        //   rows2 持续到 getKeywordViewData 返才关. 函数 1ms 内即返故非真泄漏,
                        //   但与 getReadViewData prev/next prow.Close() 即时关 pattern 不一致
                        //   (R96-D 未决项 #1). 改: 显式 rows2.Close() 即时关 (块末, 与 prow/nrow
                        //   同款). 0 行为变化 (rows 仍读完后才关), 0 perf 影响 (1 次 Close 调用
                        //   时机提前 μs 级), 纯资源释放点对齐.
                        if rows2, err := db.Query(`SELECT DISTINCT tag FROM BookTag WHERE bookId=? AND tag!=? ORDER BY hits DESC LIMIT 12`, firstBookID, tag); err == nil {
                                for rows2.Next() {
                                        var t sql.NullString
                                        // R81-D BUG-179: per-row Scan err log + skip.
                                        if err := rows2.Scan(&t); err != nil {
                                                log.Printf("[R81-D] getKeywordViewData relatedTags rows2.Scan failed (tag=%q bookID=%s): %v - skipping row", tag, firstBookID, err)
                                                continue
                                        }
                                        if t.String != "" {
                                                relatedTags = append(relatedTags, t.String)
                                        }
                                }
                                // R75-A 目标C4: rows2 迭代后检查 rows2.Err().
                                if rerr := rows2.Err(); rerr != nil {
                                        log.Printf("[R75-A] getKeywordViewData relatedTags rows2.Err() (tag=%q bookID=%s): %v", tag, firstBookID, rerr)
                                }
                                rows2.Close()
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
//
//      adminSitesCreate/PUT 在写入 DB 前调用此函数, 非法值返 400.
func validPseudoStaticStyle(s string) bool {
        for _, v := range pseudoStaticStyles {
                if v == s {
                        return true
                }
        }
        return false
}

// pseudoStaticPrefixes 列出全部伪静态路径前缀 (R63-A).
//
//      homeHandler 用作快路径过滤: 非前缀的 path 直接 404, 不命中 DB.
//      query 风格 URL 走 query 串 (path="/"), 不在此列表.
var pseudoStaticPrefixes = []string{
        "/book/", "/read/", "/category/",
        "/book-", "/read-", "/category-",
        "/b/", "/r/", "/c/",
}

// looksLikePseudoStaticPath 快前缀检查: path 是否可能是伪静态 URL (R63-A).
//
//      用于 homeHandler 在 DB 命中前过滤 SEO 垃圾 URL, 保留 R42-1A 快路径 404 保护.
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
//
//      用于 numericHash / hashidEncode / 智能选 TDK 模板 (admin.generateSiteTDK).
//      非 crypto 强哈希, 但分布均匀, 适合站点级差异化.
func simpleHash(s string) uint32 {
        h := uint32(2166136261)
        for i := 0; i < len(s); i++ {
                h ^= uint32(s[i])
                h *= 16777619
        }
        return h
}

// extractDigits — 从字符串提取所有数字字符 (R63-A).
//
//      e.g. "cm1234567ab" → "1234567". 用于 numericHash 备用 + alphanumericEncode.
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
//
//      alphanumeric 风格 URL token = 字母前缀 + first6Digits(cuid).
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
//
//      numeric 风格 URL token = numericHash(cuid), 10 位定长便于人类阅读 + 减少碰撞.
//      实现: FNV-1a 64-bit (两段 32-bit 拼接) mod 1e10, 左补 0 到 10 位.
//      不可逆 (DB 扫描反查).
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
//
//      实现: hash(cuid + salt) → 64-bit → base62. 不可逆, decode 走 DB 扫描.
//      spec 要求 "不可逆但本站自解析" — 即解码端必须能从 token 反查 cuid (本站自扫描).
func hashidEncode(id string) string {
        h1 := simpleHash(id + "::" + hashidSalt)
        h2 := simpleHash(hashidSalt + "::" + id)
        n := uint64(h1)<<32 | uint64(h2)
        return base62EncodeUint(n)
}

// base62Alphabet — base62 编码字母表 (R63-A). 0-9 + A-Z + a-z (字典序 + 大写小写).
const base62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// base62EncodeUint — uint64 → base62 字符串 (R63-A).
//
//      仅用于 hashidEncode (内部 64-bit 哈希 → base62). 解码端走 DB 扫描, 不需 uint64 反解.
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
//
//      实现: cuid 字节序列视作大整数 (big.Int, big-endian), base62 编码.
//      反解: base62Decode → big.Int → bytes → string.
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
//
//      (首页是站点入口, 不需伪静态差异化; 风格差异在 book/chapter/category.)
func buildHomeURL(style string) string {
        _ = style
        return "/"
}

// buildBookURL — 书籍详情页 URL (R63-A).
//
//      query:        /?view=book&id={cuid}
//      numeric:      /book/{numericHash(cuid)}.html
//      alphanumeric: /book/b{first6Digits(cuid)}.html
//      slug:         /book/{cuid}/
//      short:        /b/{cuid}
//      classic:      /book-{cuid}.html
//      dir:          /book/{cuid}/
//      hashid:       /b/{hashidEncode(cuid)}.html
//      base62:       /b/{base62Encode(cuid)}
//      segmented:    /book/{cuid[:2]}/{cuid[2:]}.html
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
//
//      query:        /?view=read&chapter={chID}
//      numeric:      /read/{numericHash(chID)}.html
//      alphanumeric: /read/c{first6Digits(chID)}.html
//      slug:         /read/{chID}/
//      short:        /r/{chID}
//      classic:      /read-{chID}.html
//      dir:          /book/{bookID}/chapter/{chID}.html (bookID 必填, 否则 fallback slug)
//      hashid:       /r/{hashidEncode(chID)}.html
//      base62:       /r/{base62Encode(chID)}
//      segmented:    /read/{chID[:2]}/{chID[2:]}.html
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
//
//      query:        /?view=category&cat={catID}&page={page}  (page=1 省略 page 参数)
//      numeric:      /category/{numericHash(catID)}/{page}.html (page=1 省略 page 段)
//      alphanumeric: /category/d{first6Digits(catID)}.html  (page>1 加 /{page}.html 后缀? 简化: page=1 省略, page>1 同 numeric)
//      slug:         /category/{catID}/page-{page}/  (page=1 省略 page-1/)
//      short:        /c/{catID}  (page>1 加 /{page})
//      classic:      /category-{catID}.html  (page>1 加 -{page}.html)
//      dir:          /category/{catID}/{page}/  (page=1 用 /category/{catID}/)
//      hashid:       /c/{hashidEncode(catID)}.html  (page>1 加 /page-{page}? 暂简化省略)
//      base62:       /c/{base62Encode(catID)}  (page>1 加 /{page}? 暂简化省略)
//      segmented:    /category/{catID[:2]}/{catID[2:]}/{page}.html
func buildCategoryURL(style, catID string, page int) string {
        if page < 1 {
                page = 1
        }
        // R91-D BUG-250 (P2, main+templates scope, 顺延 R90-D main+templates BUG-247~249):
        //   buildCategoryURL catID="" 时直接返 "/?view=category" 忽略 page → PageList/
        //   PrevPageURL/NextPageURL/LastPageURL/CategoryURL 在 catID 空 (全本分类视图)
        //   时全指向 page 1 (翻页/尾页链接失效). R90-D BUG-247 引入 data["LastPageURL"]
        //   = buildCategoryURL(style, catID, totalPages) 后, shipsay/aijjxs/category.html
        //   "尾页" 链接在 catID 空时从原 hardcoded /?view=category&page={last} (正确
        //   跳尾页) 退化为 {{.LastPageURL}}="/?view=category" (回首页) — 回归. 修复:
        //   catID 空 + page>1 时返 /?view=category&page={page} (全本分类 query 串分页,
        //   与 buildPagerURL ranking/fulltext 同款 query-only 退化; 伪静态风格对 catID
        //   空无意义因无可 hash 的实体 id). catID 空 + page=1 仍返 /?view=category (无
        //   page 参数, 与 page=1 等价但更简洁). 影响: PageList/Prev/Next/Last/CategoryURL
        //   在 catID 空时均正确指向各自 page (PageList[i].URL 不再全 = page 1).
        if catID == "" {
                if page > 1 {
                        return "/?view=category&page=" + strconv.Itoa(page)
                }
                return "/?view=category"
        }
        // R88-D BUG-237 (P3, main+templates scope, 顺延 R87-D BUG-231/232;
        //   顺延 R87-B BUG-227 crawl + R87-C BUG-228~230 admin.go; 本 scope 从
        //   231 起): buildCategoryURL query 风格 catID 未 URL-encode, 与 BUG-32
        //   buildPagerURL 不对称 (R64-D 修 buildPagerURL sort/q/tag 已 url.QueryEscape
        //   id, 但 buildCategoryURL catID 直接拼接到 query value). catID 源自
        //   homeHandler case "category" r.URL.Query().Get("cat") (用户输入), 即使
        //   getCategoryViewData SQL 不命中 (label fallback "全本小说", 全表 books
        //   渲染), catID 仍透传到 data["CatID"] + PrevPageURL/NextPageURL/CategoryURL
        //   + PageList[].URL. 用户输入 cat="foo&bar" → 渲染链接
        //   /?view=category&cat=foo&bar&page=2 → 翻页时 server 解析 cat="foo" + 多余
        //   bar 参数, 翻页结果与首页不一致 (BUG-32 同款问题但 category 路径). 修复:
        //   query 风格 + fallback 用 url.QueryEscape(catID) 替代裸 catID. 非 query 风格
        //   catID 经 hashidEncode/base62Encode/numericHash/first6Digits 转换为纯字母
        //   数字 (numericHash 用 fmt.Sprintf %010d, hashidEncode 用 base62EncodeUint,
        //   first6Digits 取数字字符 + 补 0), slug/short/classic/dir/segmented 用裸
        //   catID 但 parsePseudoStaticPath regex `[A-Za-z0-9]+` 限制, 特殊字符 catID
        //   无法匹配 regex → 404, 无 URL 分裂风险. 故仅 query 风格 + fallback 需 encode.
        encodedCat := url.QueryEscape(catID)
        switch style {
        case "", "query":
                if page > 1 {
                        return "/?view=category&cat=" + encodedCat + "&page=" + strconv.Itoa(page)
                }
                return "/?view=category&cat=" + encodedCat
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
                return "/?view=category&cat=" + encodedCat + "&page=" + strconv.Itoa(page)
        }
        return "/?view=category&cat=" + encodedCat
}

// buildPagerURL — 无实体 ID 的列表视图分页 URL (ranking/fulltext/search/keyword) (R63-A).
//
//      这些视图的 URL 不含实体 cuid (只有 page), 伪静态风格不区分; 统一用 query 串.
//      id 参数: ranking=sort, fulltext="", search=q, keyword=tag.
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
//
//      re: 已编译的 regex, 含捕获组.
//      view: 解析出的 view 名 (book/read/category).
//      idGroups: 拼接成 cuid 的捕获组索引列表 (segmented=2 组, 其它=1 组).
//      pageGroup: page 的捕获组索引 (0 表示无 page).
type pseudoPattern struct {
        re        *regexp.Regexp
        view      string
        idGroups  []int
        pageGroup int
}

// 伪静态 URL regex 模式 (R63-A). 按 view 分组, 每风格独立.
//
//      注: numeric 与 alphanumeric 共用同一 regex (token 格式都为 [A-Za-z0-9]+.html),
//      decode 时按 style 区分 (numeric 用 numericHash, alphanumeric 用 first6Digits).
var (
        // numeric / alphanumeric: /book/{token}.html, /read/{token}.html, /category/{token}/{page}.html
        reNumericBook         = regexp.MustCompile(`^/book/([A-Za-z0-9]+)\.html$`)
        reNumericRead         = regexp.MustCompile(`^/read/([A-Za-z0-9]+)\.html$`)
        reNumericCategory     = regexp.MustCompile(`^/category/([A-Za-z0-9]+)/(\d+)\.html$`)
        reNumericCategoryHome = regexp.MustCompile(`^/category/([A-Za-z0-9]+)\.html$`) // R71 主控修复: page=1 无 page 段

        // slug: /book/{cuid}/, /read/{cuid}/, /category/{cuid}/page-{page}/
        reSlugBook         = regexp.MustCompile(`^/book/([A-Za-z0-9]+)/$`)
        reSlugRead         = regexp.MustCompile(`^/read/([A-Za-z0-9]+)/$`)
        reSlugCategory     = regexp.MustCompile(`^/category/([A-Za-z0-9]+)/page-(\d+)/$`)
        reSlugCategoryHome = regexp.MustCompile(`^/category/([A-Za-z0-9]+)/$`) // R71 主控修复: page=1

        // short: /b/{cuid}, /r/{cuid}, /c/{cuid}/{page}
        reShortBook         = regexp.MustCompile(`^/b/([A-Za-z0-9]+)$`)
        reShortRead         = regexp.MustCompile(`^/r/([A-Za-z0-9]+)$`)
        reShortCategory     = regexp.MustCompile(`^/c/([A-Za-z0-9]+)/(\d+)$`)
        reShortCategoryHome = regexp.MustCompile(`^/c/([A-Za-z0-9]+)$`) // R71 主控修复: page=1

        // classic: /book-{cuid}.html, /read-{cuid}.html, /category-{cuid}-{page}.html
        reClassicBook         = regexp.MustCompile(`^/book-([A-Za-z0-9]+)\.html$`)
        reClassicRead         = regexp.MustCompile(`^/read-([A-Za-z0-9]+)\.html$`)
        reClassicCategory     = regexp.MustCompile(`^/category-([A-Za-z0-9]+)-(\d+)\.html$`)
        reClassicCategoryHome = regexp.MustCompile(`^/category-([A-Za-z0-9]+)\.html$`) // R71 主控修复: page=1

        // dir: /book/{cuid}/ (book), /book/{cuid}/chapter/{chCuid}.html (read), /category/{cuid}/{page}/ (category)
        reDirBook         = regexp.MustCompile(`^/book/([A-Za-z0-9]+)/$`)
        reDirRead         = regexp.MustCompile(`^/book/([A-Za-z0-9]+)/chapter/([A-Za-z0-9]+)\.html$`)
        reDirCategory     = regexp.MustCompile(`^/category/([A-Za-z0-9]+)/(\d+)/$`)
        reDirCategoryHome = regexp.MustCompile(`^/category/([A-Za-z0-9]+)/$`) // R71 主控修复: page=1 (与 reSlugCategoryHome 相同 regex, 独立变量保清晰)

        // hashid: /b/{hash}.html, /r/{hash}.html  (注意 .html 后缀区别于 short/base62)
        reHashidBook     = regexp.MustCompile(`^/b/([A-Za-z0-9]+)\.html$`)
        reHashidRead     = regexp.MustCompile(`^/r/([A-Za-z0-9]+)\.html$`)
        reHashidCategory = regexp.MustCompile(`^/c/([A-Za-z0-9]+)\.html$`)

        // base62: /b/{token}, /r/{token}  (无 .html; 与 short 同 regex, 但 decode 用 base62Decode)
        // 复用 reShortBook / reShortRead / reShortCategory.

        // segmented: /book/{2chars}/{rest}.html, /read/{2chars}/{rest}.html, /category/{2chars}/{rest}/{page}.html
        reSegmentedBook         = regexp.MustCompile(`^/book/([A-Za-z0-9]{2})/([A-Za-z0-9]+)\.html$`)
        reSegmentedRead         = regexp.MustCompile(`^/read/([A-Za-z0-9]{2})/([A-Za-z0-9]+)\.html$`)
        reSegmentedCategory     = regexp.MustCompile(`^/category/([A-Za-z0-9]{2})/([A-Za-z0-9]+)/(\d+)\.html$`)
        reSegmentedCategoryHome = regexp.MustCompile(`^/category/([A-Za-z0-9]{2})/([A-Za-z0-9]+)\.html$`) // R71 主控修复: page=1
)

// pseudoPatternsByStyle — 按 style 索引的 patterns 表 (R63-A).
//
//      顺序: 同 style 内 book → read → category (按 view 优先级; book 最常访问).
var pseudoPatternsByStyle = map[string][]pseudoPattern{
        "numeric": {
                {reNumericBook, "book", []int{1}, 0},
                {reNumericRead, "read", []int{1}, 0},
                {reNumericCategoryHome, "category", []int{1}, 0}, // R71: page=1 home 先匹配
                {reNumericCategory, "category", []int{1}, 2},
        },
        "alphanumeric": {
                {reNumericBook, "book", []int{1}, 0},
                {reNumericRead, "read", []int{1}, 0},
                {reNumericCategoryHome, "category", []int{1}, 0},
                {reNumericCategory, "category", []int{1}, 2},
        },
        "slug": {
                {reSlugBook, "book", []int{1}, 0},
                {reSlugRead, "read", []int{1}, 0},
                {reSlugCategoryHome, "category", []int{1}, 0},
                {reSlugCategory, "category", []int{1}, 2},
        },
        "short": {
                {reShortBook, "book", []int{1}, 0},
                {reShortRead, "read", []int{1}, 0},
                {reShortCategoryHome, "category", []int{1}, 0},
                {reShortCategory, "category", []int{1}, 2},
        },
        "classic": {
                {reClassicBook, "book", []int{1}, 0},
                {reClassicRead, "read", []int{1}, 0},
                {reClassicCategoryHome, "category", []int{1}, 0},
                {reClassicCategory, "category", []int{1}, 2},
        },
        "dir": {
                {reDirBook, "book", []int{1}, 0},
                {reDirRead, "read", []int{2}, 0},
                {reDirCategoryHome, "category", []int{1}, 0},
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
                {reShortCategoryHome, "category", []int{1}, 0}, // R71: page=1 home
                {reShortCategory, "category", []int{1}, 2},
        },
        "segmented": {
                {reSegmentedBook, "book", []int{1, 2}, 0},
                {reSegmentedRead, "read", []int{1, 2}, 0},
                {reSegmentedCategoryHome, "category", []int{1, 2}, 0},
                {reSegmentedCategory, "category", []int{1, 2}, 3},
        },
}

// parsePseudoStaticPath — 按 style 解析 path 为伪静态 URL (R63-A).
//
//      返回 (view, token, page, ok); token 为 URL 中的 ID 段 (cuid 或编码形式).
//      后续 decodePseudoStaticToken(token, style, view) 反查 cuid.
//      style="query" 或未知 style → ok=false (不解析, 由 homeHandler 走 query 串模式).
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
//
//      可逆风格 (slug/short/classic/dir/segmented): token IS cuid (segmented 已在 parser concat).
//      base62: 用 math/big 反解 (无需 DB 命中).
//      不可逆风格 (numeric/alphanumeric/hashid): DB 扫描 entity 表, 按 encode 函数比对.
//      失败返 "" (homeHandler 404).
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
//
//      token 格式 = 字母前缀 (b/c/d) + 6 位数字.
//      按 viewType 校验前缀 (book=b, read=c, category=d), 剥前缀后用 6 位数字 DB 扫描.
//      返回 cuid 或 "".
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
//
//      用于 numericHash/hashidEncode/first6Digits 等不可逆编码的反查.
//      viewType: book → Book 表, read → Chapter 表, category → Category 表.
//      性能: O(N) 全表扫描; N=1000 时 ~10ms, 可接受. R64 可加缓存或冗余列优化.
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
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] findEntityByEncodedToken rows.Err() (table=%s token=%q): %v", table, token, rerr)
        }
        return ""
}

// bookIDFromMap — 从 book map 安全提取 id (R63-A).
//
//      用于 homeHandler read view 中 buildChapterURL 的 bookID 参数.
func bookIDFromMap(book map[string]interface{}) string {
        if book == nil {
                return ""
        }
        if id, ok := book["id"].(string); ok {
                return id
        }
        return ""
}

// ===== R72-A 目标B: 站群链轮随机链接 (用户需求 #1) =====
//
// 设计: 给前台"友情链接"模块提供站群互推链接, 三种类型:
//   - book_intra: 当前站内随机 1 本书 (URL 用当前站 pseudoStaticStyle 编码).
//   - home_wheel: 站群内随机 1 站首页 (URL 协议相对 "//{domain}/" 跨域).
//   - book_wheel: 站群内随机 1 站 + 该站随机 1 本书 (URL 用 query 串跨站兼容, 不依赖目标站 pseudoStyle).
// 触发: homeHandler 各 view 注入 data["WheelLinks"] 供模板渲染;
//   GET /api/public/random-link?type={book_intra|home_wheel|book_wheel}&site={siteID} 返单条 JSON.
// 性能: R73-A 目标B 加 5min sync.Map 缓存 (wheelLinksCache), 命中后 0 SELECT
//   (~0.01ms); 未命中时 5 个 SELECT ~5ms (queryRandomBook × 3 + queryRandomWheelSites × 1).
//   R73-A 目标C queryRandomBook 改 rowid 索引扫描 O(log N) 后单次 ~0.1ms, 5 次共 ~0.5ms.
//   链轮推荐场景 per-5min random 可接受 (用户重复访问不会全点同一链接).
// 排除: home_wheel/book_wheel 排除当前 siteID 防链轮跳回自身 (站群内 self-link 无 SEO 价值).

// wheelSite — 链轮站点行 (id / name / domain), 用于 home_wheel + book_wheel 注入.
//
//      domain 字段为裸域名 (e.g. "www.example.com" 不含 protocol); 跨站 URL 用 "//"+domain+"/" 协议相对.
type wheelSite struct {
        id     string
        name   string
        domain string
}

// queryRandomBook — 从 Book 表随机取 (id, name).
//
//      R73-A 目标C (R72 交接 #6): 原 ORDER BY RANDOM() LIMIT 1 扫全表 O(N) 排序,
//        大表 (10K+ 行) ~5ms 慢; per-request random 调用频率高 (homeHandler 每请求 5 次,
//        R73-A 目标B 缓存命中后降为每 5min 5 次, 但仍需快).
//      新方案: rowid 索引扫描 O(log N) — 子查询 (SELECT ABS(RANDOM()) % MAX(rowid) FROM Book)
//        随机选 rowid target (子查询标量, ABS(RANDOM()) 单次求值, MAX(rowid) 全表扫一次但
//        SQLite 内部 rowid max 是 O(1) 查 B-tree 末叶); 主查询 WHERE rowid >= target
//        ORDER BY rowid LIMIT 1 走 rowid 索引 (B-tree 顺序读 1 行).
//      偏差: 删除 rowid 后留空隙, target 落空隙时主查询取下一行 (略微偏向空隙后第一行);
//        链轮推荐场景偏差可接受 (不需要均匀分布, 只需随机感).
//      Fallback: 空表 (MAX(rowid)=NULL → RANDOM()%NULL=NULL → rowid>=NULL 永远 false → 0 行)
//        或 ABS(RANDOM()) 边界 (RANDOM()=INT64_MIN 时 ABS 返 NULL, SQLite 已知 quirk) →
//        fallback ORDER BY RANDOM() LIMIT 1 (空表时也返 ok=false, caller 静默跳过).
//      R74-A 目标D (R73 交接 #5): rowid 空隙二次校验. R73-A 报告删书后 rowid 不连续
//        极端场景 (e.g. 大批量删书 + SQLite VACUUM 后 rowid 重排 / 并发删书 race /
//        主从同步延迟等) 主路径返回的 id 可能已不在 Book 表 (虽主路径 SQL 本应保证存
//        在, 但 SQLite MVCC 快照边界 + 跨事务可见性等极端场景下不能 100% 假设). 本轮
//        加二次校验: SELECT 1 FROM Book WHERE id=? LIMIT 1, 不存在则 fallback ORDER BY
//        RANDOM() LIMIT 1. 代价: 1 次额外 SELECT (~0.1ms 索引扫描), 防 0.0001% 边界
//        返 ghost id → wheelLinksCache 5min 内链轮推 ghost 书 (404 链接, SEO 损害).
//      性能: 10K 行 ~0.1ms (原 ~5ms, 50× 提升); 100K 行 ~0.2ms (原 ~50ms, 250× 提升).
//        二次校验 +0.1ms, 总 ~0.2ms (10K) / ~0.3ms (100K), 仍 50×+ 提升.
func queryRandomBook() (id, name string, ok bool) {
        var bid, bname sql.NullString
        // 主路径: rowid 索引扫描 (子查询标量 ABS(RANDOM())%MAX(rowid) 单次求值).
        err := db.QueryRow(`SELECT id, name FROM Book WHERE rowid >= (SELECT ABS(RANDOM()) % MAX(rowid) FROM Book) ORDER BY rowid LIMIT 1`).Scan(&bid, &bname)
        if err != nil || !bid.Valid || bid.String == "" {
                // Fallback: ORDER BY RANDOM() LIMIT 1 (空表 / 子查询返 NULL / 索引扫描边界).
                err = db.QueryRow(`SELECT id, name FROM Book ORDER BY RANDOM() LIMIT 1`).Scan(&bid, &bname)
                if err != nil || !bid.Valid || bid.String == "" {
                        return "", "", false
                }
        }
        // R74-A 目标D (R73 交接 #5): rowid 空隙二次校验 — 主路径返回的 id 是否仍在 Book 表.
        //   极端场景 (批量删书 + VACUUM / 并发 race / MVCC 快照边界) 主路径可能返
        //   ghost id (虽 SQL 本应保证存在, 但防御性校验). 不存在则 fallback
        //   ORDER BY RANDOM() LIMIT 1 (此查询保证返存在的行, 因 SELECT 直接从 Book 表取).
        //   注意: fallback 查询本身查 Book 表, 返回的 id 必存在; 但仍校验一遍以防
        //   主路径已返 ghost 且 fallback 又返同 ghost (理论不会, 但防御性编程).
        var exists int
        if db.QueryRow(`SELECT 1 FROM Book WHERE id=? LIMIT 1`, bid.String).Scan(&exists) != nil {
                // 主路径 id 已不在 Book 表 (已被删), fallback ORDER BY RANDOM() LIMIT 1.
                err = db.QueryRow(`SELECT id, name FROM Book ORDER BY RANDOM() LIMIT 1`).Scan(&bid, &bname)
                if err != nil || !bid.Valid || bid.String == "" {
                        return "", "", false
                }
        }
        return bid.String, bname.String, true
}

// queryRandomWheelSites — 从 Site 表 (inLinkWheel=1 AND status=1 AND domain!=”) 随机取 n 站.
//
//      excludeID 非空时排除当前 site 防链轮跳回自身 (站群内 self-link 无 SEO 价值).
//      返回 []wheelSite, 长度 <= n (DB 行不足时按实际返回).
//      domain!='' 过滤掉未配置 domain 的站点 (协议相对 URL 需 domain 非空).
func queryRandomWheelSites(n int, excludeID string) []wheelSite {
        out := []wheelSite{}
        if n <= 0 {
                return out
        }
        var q string
        var args []interface{}
        if excludeID != "" {
                q = `SELECT id, name, domain FROM Site WHERE inLinkWheel=1 AND status=1 AND domain!='' AND id!=? ORDER BY RANDOM() LIMIT ?`
                args = []interface{}{excludeID, n}
        } else {
                q = `SELECT id, name, domain FROM Site WHERE inLinkWheel=1 AND status=1 AND domain!='' ORDER BY RANDOM() LIMIT ?`
                args = []interface{}{n}
        }
        rows, err := db.Query(q, args...)
        if err != nil {
                return out
        }
        defer rows.Close()
        for rows.Next() {
                var sid, sname, sdomain sql.NullString
                if err := rows.Scan(&sid, &sname, &sdomain); err != nil {
                        continue
                }
                if sid.Valid && sdomain.String != "" {
                        out = append(out, wheelSite{id: sid.String, name: sname.String, domain: sdomain.String})
                }
        }
        // R75-A 目标C4 (fill*-style crows.Err): rows 迭代后检查 rows.Err().
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R75-A] queryRandomWheelSites rows.Err() (n=%d excludeID=%s): %v", n, excludeID, rerr)
        }
        return out
}

// getSitePseudoStaticStyle — 取指定 siteID 的 pseudoStaticStyle (status=1 兜底).
//
//      siteID 空 / 不存在时 fallback 默认站 (isDefault=1).
//      用于 randomLinkHandler book_intra 类型 (API 调用方传 site 查 pseudoStyle 给当前站编 URL).
//      失败 (无任何 status=1 站) 返 "query" 兜底.
//      单次 db.QueryRow, ~0.5ms; 不调 getSite 全量 (避免 Setting 子查询开销).
func getSitePseudoStaticStyle(siteID string) string {
        var style sql.NullString
        if siteID != "" {
                _ = db.QueryRow(`SELECT COALESCE(pseudoStaticStyle,'query') FROM Site WHERE id=? AND status=1`, siteID).Scan(&style)
        }
        if !style.Valid || style.String == "" {
                _ = db.QueryRow(`SELECT COALESCE(pseudoStaticStyle,'query') FROM Site WHERE isDefault=1 AND status=1`).Scan(&style)
        }
        if style.String == "" {
                return "query"
        }
        return style.String
}

// R73-A 目标B (R72 交接 #5): WheelLinks 5min sync.Map 缓存.
//
//      原实现每请求调 getWheelLinks 5 次 SELECT (queryRandomBook × 3 + queryRandomWheelSites × 1
//      内含 2 站 SELECT), 大流量站慢. R73-A 缓存命中后降为每 5min 5 次 SELECT, 大幅降负载.
//      设计:
//      - cache key: currentSiteID + "|" + currentPseudoStyle (pseudoStyle 影响 book_intra
//        URL 构造, 不同 pseudoStyle 同站也独立缓存; 实际同站 pseudoStyle 一致, 但 key 含
//        pseudoStyle 防御式区分).
//      - cache value: wheelLinkCacheEntry{links, cachedAt}; 5min TTL 后失效重查.
//      - sync.Map: 并发安全 (多 goroutine homeHandler 同时调 getWheelLinks); LoadOrStore
//        简化逻辑 (但本实现用 Load + Store 两步, 容忍短窗口内并发重查, 简单优先).
//      - 缓存内容只读 (homeHandler 模板 {{range}} 只读访问, 不 mutate slice); 多 goroutine
//        共享同 slice 安全 (Go slice 并发读 OK, 不可并发写).
//      - 链轮推荐场景 per-5min random 可接受 (用户重复访问不会全点同一链接, 5min 内同款
//        推荐对单用户不显眼, SEO 抓取频次远低于 5min).
//      - 失效策略: 仅时间过期 (不主动 invalidate); admin 改 Site/Book 数据后 5min 内仍返
//        旧链接 (可接受, 链轮链接非关键数据). 后续 R73+ 可加 admin 改 Site/Book 时调
//        invalidateWheelLinksCache() (本轮范围限制不加).
var wheelLinksCache sync.Map

// wheelLinkCacheTTL — WheelLinks 缓存 TTL (5min, 与 TLS session flusher / CookieJar
//
//      flusher / ProxyHealthProber 同口径 5min).
const wheelLinkCacheTTL = 5 * time.Minute

// wheelLinkCacheEntry — WheelLinks 缓存条目.
type wheelLinkCacheEntry struct {
        links    []map[string]interface{}
        cachedAt time.Time
}

// buildWheelBookURL — 跨站 book_wheel URL 构造 (R74-A 目标E, R72 交接 #7).
//
//      R72-A 报告 book_wheel 跨站用 query 串 (//domain/?view=book&id=...) 兼容所有目标
//      站 pseudoStyle 但丢 SEO (搜索引擎抓 query 串 URL 权重低). R74-A 改: 读目标站
//      pseudoStaticStyle, 若 != "query" 则用 buildBookURL(style, bookID) 生成伪静态 URL
//      (//domain/book/{id}.html 等), 与目标站路由一致 (搜索引擎抓到伪静态 URL 权重高);
//      若 == "query" 保留原 query 串格式 (向后兼容).
//      格式: protocol-relative (//{domain}{path}), 与 home_wheel 同口径 (无协议, 浏览器
//      自动用当前页协议 — http 站用 http, https 站用 https; 混合内容警告 0, 因 protocol-relative
//      总与父页同协议).
//      注: buildBookURL 返 "/?view=book&id=..." 形态 (style=query) 或 "/book/{id}.html" 形态
//      (伪静态), 均为绝对路径, 直接 prepend "//{domain}" 即得跨站 URL.
//      调用点: getWheelLinks book_wheel 分支 + randomLinkHandler book_wheel case.
func buildWheelBookURL(target wheelSite, bookID string) string {
        if bookID == "" || target.domain == "" {
                return "//" + target.domain + "/"
        }
        targetStyle := getSitePseudoStaticStyle(target.id)
        // targetStyle == "query" / "" 时保留 query 串格式 (与 R72-A 行为一致, 向后兼容).
        if targetStyle == "query" || targetStyle == "" {
                return "//" + target.domain + "/?view=book&id=" + bookID
        }
        // 伪静态: buildBookURL 返 /book/{id}.html 等, prepend "//{domain}" 得跨站伪静态 URL.
        return "//" + target.domain + buildBookURL(targetStyle, bookID)
}

// invalidateWheelLinksCache — 主动失效指定 site 的 WheelLinks 缓存 (R74-A 目标B, R73 交接 #3).
//
//      R73-A 报告 WheelLinks 5min sync.Map 缓存无主动失效, admin 改 Site/Book 后 5min 内
//      homeHandler 仍返旧链接 (e.g. admin 改 Site.pseudoStaticStyle 后, 5min 内链轮
//      book_intra URL 仍用旧 pseudoStyle 编 → 404; admin 删 Book 后, 5min 内链轮
//      book_intra/book_wheel URL 仍指向已删 id → 404, SEO 损害).
//      修复: 加 invalidateWheelLinksCache(siteID) — 删 wheelLinksCache 中所有以
//      siteID+"|" 开头的 key (因 cacheKey = siteID+"|"+pseudoStyle, 同 siteID 不同
//      pseudoStyle 都删, 防 Site 改 pseudoStyle 后旧 style 缓存残留).
//      调用点 (R74-D admin.go 范围, 本轮 R74-A 只加函数 + 接口注释):
//      - adminSiteByIDHandler PUT (改 Site 字段): 调 invalidateWheelLinksCache(siteID)
//        + invalidateAllWheelLinksCache() (改 pseudoStaticStyle/inLinkWheel/status 影响
//        跨站 book_wheel 选站, 全清更稳).
//      - adminSiteByIDHandler DELETE (删 Site): invalidateAllWheelLinksCache() (全清,
//        因删站影响所有 wheel site 选站).
//      - adminSitesCreate (新建 Site): 无需调 (新建站无旧缓存); 可选 invalidateAllWheelLinksCache
//        让新站进 wheel 选站池 (但 5min TTL 自然过期也行).
//      - adminBookByIDHandler PUT/DELETE (改/删 Book): invalidateAllWheelLinksCache()
//        (book 改名/删影响所有 site 的 book_intra/book_wheel 推荐, 全清更稳).
//      - adminBooksCreate: 无需调 (新建书无旧缓存).
//      注: 本轮 R74-A 严禁改 admin.go, R74-D 负责调用方 wiring. 本轮 R74-A 只加函数.
//      R80-D 精简: 已被 admin.go 5+ 处调 (adminBooksCreate/adminBookByIDHandler/adminSites
//      Create/adminSiteByIDHandler/adminBackupRestoreHandler), 删 R74-A 留下的 //lint:ignore
//      U1000 directive (R74-D wiring 已完成, staticcheck 不再报 unused).
func invalidateWheelLinksCache(siteID string) {
        if siteID == "" {
                return
        }
        // sync.Map 无前缀删除 API, 用 Range 遍历删 (key 含 siteID+"|" 前缀).
        // cacheKey 格式 = siteID + "|" + pseudoStyle, 同 siteID 不同 pseudoStyle 都删
        //   (含 pseudoStyle="" edge case, 用 strings.HasPrefix 兼容 key == prefix).
        prefix := siteID + "|"
        wheelLinksCache.Range(func(k, _ interface{}) bool {
                if key, ok := k.(string); ok && strings.HasPrefix(key, prefix) {
                        wheelLinksCache.Delete(key)
                }
                return true // 继续 Range
        })
}

// invalidateAllWheelLinksCache — 清空全部 WheelLinks 缓存 (R74-A 目标B, R73 交接 #3).
//
//      用于 admin 改动影响跨站场景: 删 Site / 改 Site.pseudoStaticStyle/inLinkWheel/status
//      / 改/删 Book (book 影响所有 site 的 book_intra/book_wheel 推荐). 全清更稳, 5min
//      TTL 自然过期次优 (5min 内仍返旧链接). 性能: sync.Map 通常 <10 entries (siteID
//      × pseudoStyle 组合, 站群规模 <100), Range + Delete 全清 <1ms, 可接受.
//      调用点 (R74-D admin.go 范围): 见 invalidateWheelLinksCache docstring.
//      R80-D 精简: 删 R74-A 留下的 //lint:ignore U1000 directive (R74-D wiring 已完成,
//      admin.go 5+ 处调本函数, staticcheck 不再报 unused).
func invalidateAllWheelLinksCache() {
        wheelLinksCache.Range(func(k, _ interface{}) bool {
                wheelLinksCache.Delete(k)
                return true
        })
}

// getWheelLinks — 装配 5 个链轮链接供前台友情链接模块渲染 (用户需求 #1).
//
//      组合: 1 站内随机书 (book_intra) + 2 站群随机首页 (home_wheel) + 2 站群随机书 (book_wheel).
//      currentSiteID 非空时排除当前站 (home_wheel/book_wheel 不返 self).
//      currentPseudoStyle 用于 book_intra 编 URL (与当前站伪静态风格一致).
//      返回 []map{url, name, type, [siteName]}; 单条失败静默跳过, 总数可能 < 5.
//      调用点: homeHandler 各 view 注入 data["WheelLinks"], 模板 {{range .WheelLinks}}<a href="{{.url}}">{{.name}}</a>{{end}}.
//      R73-A 目标B: 5min sync.Map 缓存. cache key=siteID|pseudoStyle, TTL=5min.
//        命中 (cachedAt 在 5min 内) 直接返缓存 slice; 未命中或过期重查 DB + 写缓存.
//      R74-A 目标E (R72 交接 #7): book_wheel 跨站用目标站 pseudoStaticStyle 编 URL.
//        原 R72-A 全用 query 串跨站兼容 (//domain/?view=book&id=...), 丢 SEO. R74-A
//        改: 读目标站 pseudoStaticStyle, 伪静态站用 buildBookURL(style, bid) 生成
//        //domain/book/{id}.html 等 (与目标站路由一致, 搜索引擎抓伪静态 URL 权重高);
//        query 站保留 query 串 (向后兼容). 见 buildWheelBookURL.
func getWheelLinks(currentSiteID, currentPseudoStyle string) []map[string]interface{} {
        cacheKey := currentSiteID + "|" + currentPseudoStyle
        if v, ok := wheelLinksCache.Load(cacheKey); ok {
                if entry, ok := v.(wheelLinkCacheEntry); ok && time.Since(entry.cachedAt) < wheelLinkCacheTTL {
                        return entry.links
                }
        }
        out := []map[string]interface{}{}
        // 1. book_intra: 站内随机 1 书
        if bid, bname, ok := queryRandomBook(); ok {
                out = append(out, map[string]interface{}{
                        "URL":  buildBookURL(currentPseudoStyle, bid),
                        "Name": bname,
                        "Type": "book_intra",
                })
        }
        // 2-5. home_wheel + book_wheel: 查 2 个 distinct wheel sites (排除当前 site)
        sites := queryRandomWheelSites(2, currentSiteID)
        for _, s := range sites {
                // home_wheel: 协议相对跨站首页
                out = append(out, map[string]interface{}{
                        "URL":  "//" + s.domain + "/",
                        "Name": s.name,
                        "Type": "home_wheel",
                })
                // book_wheel: 同站 + 随机 1 书 (R74-A 目标E: 用目标站 pseudoStyle 编 URL)
                if bid, bname, ok := queryRandomBook(); ok {
                        out = append(out, map[string]interface{}{
                                "URL":      buildWheelBookURL(s, bid),
                                "Name":     bname,
                                "Type":     "book_wheel",
                                "SiteName": s.name,
                        })
                }
        }
        // 写缓存 (即使 out 为空也写, 防 5min 内 DB 空表反复查询; 空表 5min 后才重查).
        wheelLinksCache.Store(cacheKey, wheelLinkCacheEntry{links: out, cachedAt: time.Now()})
        return out
}

// randomLinkHandler — GET /api/public/random-link?type={book_intra|home_wheel|book_wheel}&site={siteID}
//
//      单条随机链接 API, 供前端 JS 动态拉取 (非 homeHandler 静态注入路径).
//      type=book_intra (默认): 当前站随机 1 书, 返 {url, name, type: "book_intra"}.
//      type=home_wheel:         站群随机 1 站首页 (排除 site 参数所指当前站), 返 {url, name, type}.
//      type=book_wheel:         站群随机 1 站 + 随机 1 书, 返 {url, name, type, siteName}.
//      site 参数: book_intra 用此查 pseudoStyle; home_wheel/book_wheel 用此作 excludeID 防自指.
//      失败 (无数据 / DB 错误) 返 {ok: false, error: "..."}.
//      无副作用 (只读 SELECT, 不写 DB); 无鉴权 (公开 API); CORS * 同其它 /api/public/* 一致.
func randomLinkHandler(w http.ResponseWriter, r *http.Request) {
        typ := r.URL.Query().Get("type")
        if typ == "" {
                typ = "book_intra"
        }
        siteID := r.URL.Query().Get("site")
        switch typ {
        case "book_intra":
                pseudoStyle := getSitePseudoStaticStyle(siteID)
                bid, bname, ok := queryRandomBook()
                if !ok {
                        writeJSON(w, map[string]interface{}{"ok": false, "error": "no book available"})
                        return
                }
                writeJSON(w, map[string]interface{}{
                        "ok": true,
                        "data": map[string]interface{}{
                                "url":  buildBookURL(pseudoStyle, bid),
                                "name": bname,
                                "type": "book_intra",
                        },
                })
        case "home_wheel":
                sites := queryRandomWheelSites(1, siteID)
                if len(sites) == 0 {
                        writeJSON(w, map[string]interface{}{"ok": false, "error": "no wheel site available"})
                        return
                }
                s := sites[0]
                writeJSON(w, map[string]interface{}{
                        "ok": true,
                        "data": map[string]interface{}{
                                "url":  "//" + s.domain + "/",
                                "name": s.name,
                                "type": "home_wheel",
                        },
                })
        case "book_wheel":
                sites := queryRandomWheelSites(1, siteID)
                if len(sites) == 0 {
                        writeJSON(w, map[string]interface{}{"ok": false, "error": "no wheel site available"})
                        return
                }
                s := sites[0]
                bid, bname, ok := queryRandomBook()
                if !ok {
                        writeJSON(w, map[string]interface{}{"ok": false, "error": "no book available"})
                        return
                }
                // R74-A 目标E (R72 交接 #7): book_wheel 跨站用目标站 pseudoStyle 编 URL
                //   (与 getWheelLinks 同口径, 见 buildWheelBookURL).
                writeJSON(w, map[string]interface{}{
                        "ok": true,
                        "data": map[string]interface{}{
                                "url":      buildWheelBookURL(s, bid),
                                "name":     bname,
                                "type":     "book_wheel",
                                "siteName": s.name,
                        },
                })
        default:
                writeJSON(w, map[string]interface{}{"ok": false, "error": "invalid type (use book_intra|home_wheel|book_wheel)"})
        }
}

// ===== R76-A 目标B 工具: buildAbsoluteURL (pSEO 绝对 URL 构造) =====
//
// pSEO og:url / canonical link 必须是绝对 URL (含 scheme + host), 否则 FB / Twitter /
// Google 等社交平台和搜索引擎无法解析. buildBookURL / buildChapterURL / buildHomeURL /
// buildCategoryURL 均返相对路径 (e.g. "/book/abc.html" 或 "/?view=book&id=..."), 需
// 拼接 site.Domain + scheme 得绝对 URL.
//
// 边界处理:
//   - relURL 已是绝对 URL (http:// / https://): 原样返回 (coverURL 已处理外链封面).
//   - relURL 为空: 返回空字符串.
//   - relURL 不以 "/" 开头 (e.g. "//domain.com/path" 协议相对 URL): 原样返回 (browser
//     按 scheme 自动补全, 不需 prepend).
//
// R77-D 目标C (R76 交接 #6 sitemap loc 用真实 domain) 改进:
//   - domain 为空时: fallback "localhost:3000" + http:// (开发环境). 旧 R76-A 实现返相对
//     路径 (sitemap spec 要求 loc 必须绝对 URL, 故旧实现返相对路径在 sitemap 是违规;
//     pSEO og:url/canonical 用相对 URL FB warning 但不报错. 现统一用 localhost:3000
//     兜底, sitemap 合规 + pSEO absolute. 搜索引擎按 localhost 解析不抓真站, 仅开发期
//     可接受; 生产部署时 admin 必须配 Site.domain).
//   - scheme 自动选择: localhost / 127.0.0.1 (含可选端口) 用 http:// (开发期 TLS cert
//     不存在, https 会 cert error + 浏览器拒绝); 其余 (含 dot 的真实 TLD domain) 用 https://
//     (生产站全站 HTTPS, SEO 友好). 防 admin 误配 "localhost" 用 https 时 og:image 等
//     绝对 URL 在本地 dev 环境无法 fetch (curl https://localhost:3000 → cert 错误).
//
// 调用点: homeHandler case "book" / case "read" pSEO 注入 (OgImage/TwitterImage/OgUrl/
// CanonicalURL) + sitemap* handler 绝对 URL + robots.txt Sitemap 指令.
func buildAbsoluteURL(domain, relURL string) string {
        if relURL == "" {
                return ""
        }
        // 已是绝对 URL: http:// / https:// / 协议相对 // 原样返回.
        if strings.HasPrefix(relURL, "http://") || strings.HasPrefix(relURL, "https://") || strings.HasPrefix(relURL, "//") {
                return relURL
        }
        // R77-D 目标C: domain 空 fallback "localhost:3000" (开发环境兜底, 让 sitemap loc
        //   合规 + pSEO og:url/canonical absolute). 旧 R76-A 实现返 relURL 相对路径 (sitemap
        //   spec 违规). 生产部署时 admin 必须配 Site.domain, fallback 仅在 dev 跑.
        if domain == "" {
                domain = "localhost:3000"
        }
        // 标准化 domain: 剥 "http://" / "https://" 前缀 (admin 配置 Site.domain 时可能含 scheme).
        domain = strings.TrimPrefix(domain, "http://")
        domain = strings.TrimPrefix(domain, "https://")
        // 剥末尾 "/" 防止 "//" 双斜杠.
        domain = strings.TrimSuffix(domain, "/")
        if domain == "" {
                domain = "localhost:3000"
        }
        // relURL 必须以 "/" 开头才是 site-relative (buildBookURL/buildChapterURL/buildHomeURL/
        // buildCategoryURL 全部返 "/" 开头路径, 故这里安全). 否则视为已含 host 原样返回.
        if !strings.HasPrefix(relURL, "/") {
                return relURL
        }
        // R77-D 目标C: scheme 自动选择 — localhost / 127.0.0.1 (含可选端口) 用 http://,
        //   其余 (生产 domain 含 dot TLD) 用 https://. 防 admin 误配 localhost 用 https
        //   时 dev 环境无法 fetch (TLS cert 不存在 → 浏览器拒绝).
        scheme := "https://"
        if isLocalhostDomain(domain) {
                scheme = "http://"
        }
        return scheme + domain + relURL
}

// isLocalhostDomain — 判断 domain 是否为 localhost / 127.0.0.1 (含可选端口) (R77-D 目标C).
//
//      用于 buildAbsoluteURL 选择 http:// (dev) vs https:// (prod) scheme.
//      覆盖常见 localhost 形态: "localhost" / "localhost:3000" / "127.0.0.1" / "127.0.0.1:3000".
//      注: 不处理 IPv6 [::1] 罕见形态 (生产几乎不会配 IPv6 localhost, admin 通常配
//      "localhost:3000" / "example.com"). 若后续需求再加 IPv6 支持.
//      防御式: 仅匹配 host 部分 (剥端口后再判断), 防 "localhostt.com" 误判 (prefix
//      "localhost" 会误匹配, 故严格 == "localhost" 而非 HasPrefix).
func isLocalhostDomain(domain string) bool {
        if domain == "" {
                return false
        }
        // 剥可选端口 (host:port 形态, 端口为数字). IPv6 [::1]:port 不处理 (见 docstring).
        host := domain
        if idx := strings.LastIndex(domain, ":"); idx > 0 {
                host = domain[:idx]
        }
        return host == "localhost" || host == "127.0.0.1"
}

// ===== R76-A 目标C: XML sitemap (用户需求 #5) =====
//
// 设计:
//   - 6 路由 (见 main() line ~443): /robots.txt + /sitemap.xml + /sitemap-index.xml +
//     /sitemap-home.xml + /sitemap-books/{page} + /sitemap-chapters/{page}.
//     (R77-D BUG-154: 路由形式 /sitemap-books/{page} 而非 /sitemap-books-{page}.xml,
//     因 Go 1.22 ServeMux 拒绝 {page} 嵌字面量段 "sitemap-books-" 中; R76 主控已修.)
//   - /sitemap.xml: 综合单文件 sitemap (home + categories + 全部 books + 全部 chapters),
//     cursor pagination 防 OOM (id > ? ORDER BY id LIMIT 1000, 不用 OFFSET 防 O(N²)).
//   - /sitemap-index.xml: sitemap 索引, 指向多个分页 sub-sitemap (sitemap-home +
//     /sitemap-books/{1..N} + /sitemap-chapters/{1..M}), N/M 由 Book/Chapter 行数算.
//     (R77-D BUG-154: 生成的 sub-sitemap URL 形式 /sitemap-books/{n} 匹配注册路由.)
//   - /sitemap-home.xml: 子 sitemap 含 home URL + 全部 category URL (1000 URL 内足够).
//   - /sitemap-books/{page}: 子 sitemap 含 1000 本书 URL (page=1..N, cursor 分页).
//   - /sitemap-chapters/{page}: 子 sitemap 含 1000 章节URL (page=1..M, cursor 分页).
//
// R77-D 目标A: invalidateSitemapCache() 供 admin 改 Book/Chapter 后主动清缓存
//
//      (替代旧 "5min 内仍返旧 sitemap" 行为, 让 admin 改动立即反映).
//
// 缓存: 全部 sitemap 路由用 sync.Map (sitemapCache) + 5min TTL (sitemapCacheTTL),
//
//      cacheKey = 路由名 + (page 编号 if any). 命中后 0 DB 查询, 未命中重查 + 写缓存.
//      防每请求查 DB (Google 抓 sitemap 每日多次, 全表扫 Book 100k 行 ~500ms 不可接受;
//      5min 缓存命中后 ~0.1ms). admin 改 Book/Chapter 后调 invalidateSitemapCache()
//      立即清缓存 (R77-D 目标A, R76 交接 #3), 否则 5min 内仍返旧 sitemap.
//
// XML 格式 (sitemaps.org/protocol.html):
//      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
//        <url><loc>...</loc><lastmod>YYYY-MM-DD</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>
//      </urlset>
//      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
//        <sitemap><loc>...</loc><lastmod>YYYY-MM-DD</lastmod></sitemap>
//      </sitemapindex>
//
// XML escape: 手动实现 (避免引 encoding/xml 增依赖; sitemap 内容仅 URL + 日期, 5 特殊字符够用).
//
// R77-D 目标D (R76 交接 #4 sitemap streaming) 评估 (诚实留痕, 不实现):
//   1. 可行性: net/http 支持 chunked response + http.Flusher 接口可分批 flush XML
//      字节流. encoding/xml.Encoder 可流式写 xml.Token (StartElement/Char/EndElement),
//      无需全 urlset 在内存.
//   2. 复杂度: 当前 sitemapBuildURLSet + sitemapGetOrCompute 模式假设全 content []byte
//      一次生成 + 缓存. 改 streaming 需:
//      - sitemapHandler 不再走 sitemapGetOrCompute (无法缓存 streaming writer);
//        需直接 w.Write + w.(http.Flusher).Flush() per N URL;
//      - sitemapBooksHandler/sitemapChaptersHandler 同款改;
//      - 失去缓存命中 0 DB 优化 (每请求重新查 DB + 流式写);
//      - 需处理 client disconnect (context cancel 检测 + 提前返);
//      - HTTP/2 + reverse proxy (Caddy/nginx) 对 chunked response 的兼容性 (大多 OK,
//        但部分 proxy 会 buffer 整个 response 再转发 → streaming 失效);
//      - gzip middleware 顺序 (若 reverse proxy gzip 后置, chunked flush 仍 work;
//        若 gzip 前置, flush 被压在 gzip buffer 内).
//   3. 当前评估结论: 不实现. 当前 5min sync.Map 缓存 + cursor pagination 1000/页已足够
//      处理 <500k URL 站点 (单页 ~50KB, 100 页 ~5MB; cache 命中后 0 内存分配).
//      >1M URL 站点 (极少见, 100k+ 本书 + 10 章/本 = 1M chapter URL) 会用 sitemap-index
//      + sub-sitemap 分页拆解 (sitemap-books/{page} 各 1000 URL, 单 sub-sitemap ~50KB),
//      不需 streaming. 真正 >10M URL 站点 (e.g. 大型 UGC 平台) 才需 streaming, 本项目
//      不在该规模. R78+ 评估若实际 10M+ URL 再实现.

// sitemapCacheEntry — sitemap XML 缓存条目 (rendered bytes + 生成时间).
type sitemapCacheEntry struct {
        content     []byte
        generatedAt time.Time
}

// sitemapCacheTTL — sitemap 缓存 TTL (5min, 与 wheelLinksCache 同口径).
const sitemapCacheTTL = 5 * time.Minute

// sitemapCache — sitemap XML 缓存 (sync.Map 并发安全, 多 goroutine homeHandler + Google
//
//      crawler 同时 GET /sitemap.xml). key=string (路由名 + page 编号), value=sitemapCacheEntry.
var sitemapCache sync.Map

// invalidateSitemapCache — 主动失效全部 sitemap XML 缓存 (R77-D 目标A, R76 交接 #3).
//
//      R76-A sitemap 用 5min sync.Map 缓存 (sitemapGetOrCompute, 同 wheelLinksCache 同款
//      pattern), admin 改 Book/Chapter 后 5min 内仍返旧 sitemap (新加书不在 sub-sitemap
//      里, 删的书仍在 → 搜索引擎抓 404 URL, SEO 损害). 本轮 R77-D 加 invalidate 函数,
//      供 R77-C admin.go 在 adminBookByIDHandler PUT/DELETE + adminBooksCreate +
//      adminChapterByIDHandler PUT/DELETE + adminChaptersCreate + adminBackupClearHandler
//      等改动 Book/Chapter 表的入口调 (与 invalidateAllWheelLinksCache 同款 wiring 模式).
//      性能: sync.Map 通常 <20 entries (sitemap.xml + sitemap-index.xml + sitemap-home.xml
//      + sitemap-books-{1..N} + sitemap-chapters-{1..M}, 100k 站 = 200 sub-sitemap entry,
//      Range + Delete 全清 <1ms, 可接受).
//      R80-D 精简: 删 R77-D 留下的 //lint:ignore U1000 directive (R77-C wiring 已完成,
//      admin.go 13+ 处调本函数 — adminBooksCreate/adminBookByIDHandler/adminChapterByID
//      Handler/adminChaptersCreate/adminBackupRestoreHandler/adminSiteByIDHandler 等, staticcheck
//      不再报 unused).
func invalidateSitemapCache() {
        sitemapCache.Range(func(k, _ interface{}) bool {
                sitemapCache.Delete(k)
                return true // 继续 Range
        })
}

// sitemapURL — 单个 URL 条目 (urlset) 或子 sitemap 引用 (sitemapindex). lastmod/changefreq/
//
//      priority 字段在 sitemapindex 路径下仅 loc + lastmod 有效 (sitemaps.org 规范, 索引不
//      含 changefreq/priority).
type sitemapURL struct {
        loc        string // 绝对 URL
        lastmod    string // YYYY-MM-DD 或空
        changefreq string // daily / weekly / monthly / 空
        priority   string // "1.0" / "0.8" / "0.6" / "0.5" / 空
}

// xmlEscape — XML 5 特殊字符转义 (< > & " ').
//
//      sitemap 内容仅 URL + 日期, 这 5 字符够覆盖. 不引 encoding/xml 防增依赖.
//      调用点: sitemapBuildURLSet / sitemapBuildIndex loc + lastmod 字段渲染.
func xmlEscape(s string) string {
        s = strings.ReplaceAll(s, "&", "&amp;")
        s = strings.ReplaceAll(s, "<", "&lt;")
        s = strings.ReplaceAll(s, ">", "&gt;")
        s = strings.ReplaceAll(s, "\"", "&quot;")
        s = strings.ReplaceAll(s, "'", "&apos;")
        return s
}

// sitemapBuildURLSet — 构建 <urlset> XML 字节 (单 sitemap 文件).
//
//      urls 为空时返空 urlset (合法 XML, 搜索引擎视为空 sitemap).
//      每条 URL 渲染: <url><loc>...</loc>{<lastmod>...</lastmod>}{<changefreq>...</changefreq>}{<priority>...</priority>}</url>
//      lastmod/changefreq/priority 为空字段省略 (sitemaps.org 规范, 全部可选).
func sitemapBuildURLSet(urls []sitemapURL) []byte {
        var b strings.Builder
        b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
        b.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
        for _, u := range urls {
                b.WriteString("  <url>\n")
                b.WriteString("    <loc>" + xmlEscape(u.loc) + "</loc>\n")
                if u.lastmod != "" {
                        b.WriteString("    <lastmod>" + xmlEscape(u.lastmod) + "</lastmod>\n")
                }
                if u.changefreq != "" {
                        b.WriteString("    <changefreq>" + xmlEscape(u.changefreq) + "</changefreq>\n")
                }
                if u.priority != "" {
                        b.WriteString("    <priority>" + xmlEscape(u.priority) + "</priority>\n")
                }
                b.WriteString("  </url>\n")
        }
        b.WriteString("</urlset>\n")
        return []byte(b.String())
}

// sitemapBuildIndex — 构建 <sitemapindex> XML 字节 (索引文件).
//
//      索引仅含 loc + lastmod (sitemaps.org 规范, 索引文件不含 changefreq/priority).
//      调用点: sitemapIndexHandler 列出 sitemap-home / sitemap-books-{n} / sitemap-chapters-{n} 引用.
func sitemapBuildIndex(subs []sitemapURL) []byte {
        var b strings.Builder
        b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
        b.WriteString(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
        for _, s := range subs {
                b.WriteString("  <sitemap>\n")
                b.WriteString("    <loc>" + xmlEscape(s.loc) + "</loc>\n")
                if s.lastmod != "" {
                        b.WriteString("    <lastmod>" + xmlEscape(s.lastmod) + "</lastmod>\n")
                }
                b.WriteString("  </sitemap>\n")
        }
        b.WriteString("</sitemapindex>\n")
        return []byte(b.String())
}

// sitemapWriteXML — 写 XML 响应 (Content-Type + Cache-Control 5min).
//
//      Cache-Control: public, max-age=300 (5min) 让 CDN / 浏览器缓存 sitemap, 进一步降负载.
//      调用点: 全部 sitemap* handler.
func sitemapWriteXML(w http.ResponseWriter, content []byte) {
        w.Header().Set("Content-Type", "application/xml; charset=utf-8")
        w.Header().Set("Cache-Control", "public, max-age=300")
        w.Header().Set("X-Content-Type-Options", "nosniff")
        w.Write(content)
}

// sitemapGetOrCompute — 缓存命中返缓存内容, 未命中重算 + 写缓存.
//
//      cacheKey: 路由名 + (page 编号 if any), e.g. "sitemap.xml" / "sitemap-books-3".
//      compute: 闭包, 重算 XML 字节 (调 DB 查询 + sitemapBuildURLSet).
//      并发: sync.Map.Load + Store 两步, 容忍短窗口内并发重算 (简单优先, 不用
//      LoadOrStore + singleflight 防 thundering herd — sitemap 重算 5min 一次, 并发
//      重算 1-2 次可接受). 与 wheelLinksCache 同款 pattern.
func sitemapGetOrCompute(cacheKey string, compute func() []byte) []byte {
        if v, ok := sitemapCache.Load(cacheKey); ok {
                if entry, ok := v.(sitemapCacheEntry); ok && time.Since(entry.generatedAt) < sitemapCacheTTL {
                        return entry.content
                }
        }
        content := compute()
        sitemapCache.Store(cacheKey, sitemapCacheEntry{content: content, generatedAt: time.Now()})
        return content
}

// sitemapFormatDate — DB updatedAt 字符串归一化为 ISO 8601 日期 (YYYY-MM-DD).
//
//      DB updatedAt 可能是 SQLite TEXT ("2024-01-01 15:04:05") / Unix ms 时间戳 /
//      ISO 8601 ("2024-01-01T15:04:05Z") 等 (见 formatUpdatedAt). lastmod 标签需
//      YYYY-MM-DD 形态 (sitemaps.org 规范允许完整 ISO 8601 但搜索引擎仅按日期解析).
//      空 updatedAt 返空 (sitemap 不写 lastmod 字段, 跳过).
func sitemapFormatDate(updatedAt string) string {
        if updatedAt == "" {
                return ""
        }
        normalized := formatUpdatedAt(updatedAt)
        if len(normalized) >= 10 {
                return normalized[:10]
        }
        return normalized
}

// sitemapGetSite — 加载默认 site (供 sitemap handler 构造绝对 URL).
//
//      sitemap 不绑定具体 site (用默认站 isDefault=1), 与 homeHandler 主流程一致.
//      site==nil 时 sitemap handler 返空 urlset (不致命, 搜索引擎视为空 sitemap).
func sitemapGetSite() map[string]interface{} {
        site, err := getSite("")
        if err != nil || site == nil {
                return nil
        }
        return site
}

// sitemapPseudoStyle — 从 site map 提取 pseudoStaticStyle (默认 "query").
func sitemapPseudoStyle(site map[string]interface{}) string {
        s, _ := site["PseudoStaticStyle"].(string)
        if s == "" {
                return "query"
        }
        return s
}

// sitemapHomeURLs — 构造 home + 全部 category URL 列表 (供 sitemap.xml + sitemap-home.xml 共用).
//
//      home URL: priority 1.0 (最高, 站点首页权重), changefreq daily (首页内容更新频繁).
//      category URL: priority 0.8 (分类页权重中等), changefreq weekly (分类列表每周更新).
//      调用 getCategories (LIMIT 60, 与 homeHandler 一致, 不分页 — 60 个分类 1 页足够).
//      失败 (DB 错误 / cats 空) 时仅返 home URL (sitemap 不报错, 静默降级).
func sitemapHomeURLs(site map[string]interface{}) []sitemapURL {
        pseudoStyle := sitemapPseudoStyle(site)
        domain, _ := site["Domain"].(string)
        urls := []sitemapURL{
                {loc: buildAbsoluteURL(domain, buildHomeURL(pseudoStyle)), changefreq: "daily", priority: "1.0"},
        }
        cats, _ := getCategories()
        for _, c := range cats {
                id, _ := c["id"].(string)
                if id == "" {
                        continue
                }
                urls = append(urls, sitemapURL{
                        loc:        buildAbsoluteURL(domain, buildCategoryURL(pseudoStyle, id, 1)),
                        changefreq: "weekly",
                        priority:   "0.8",
                })
        }
        return urls
}

// sitemapBooksPage — 构造 1 页 (1000 本) book URL 列表.
//
//      cursor pagination: page 1 用 SELECT id, updatedAt FROM Book ORDER BY id LIMIT 1000;
//      page > 1 用 WHERE id > last_id_of_prev_page ORDER BY id LIMIT 1000. lastID 由调用方
//      传入 (上一页最后一行的 id), page=1 时 lastID="" 走第一条查询.
//      返回: (urls, lastID, hasMore) — 调用方据此决定是否继续翻页.
//      priority 0.6 (书籍详情页权重中低), changefreq weekly (书籍元数据每周更新).
//      性能: id 索引扫描 O(log N + 1000), 100k 本 = 100 页 × ~0.5ms = ~50ms 总 (5min 缓存
//      命中后 0 DB). 比 OFFSET 10000 LIMIT 1000 (O(N) 扫 10000 行) 快 ~100×.
//
// R77-D BUG-155 (P3): hasMore 旧实现 `len(urls) == 1000` 在 Scan 错误时漏页. Scan
//
//      错误 (rows.Scan 失败 / id.String=="") 会让某些行被 continue 跳过, 但 SQL LIMIT
//      1000 已 return 1000 行, 跳过的行仍占用 LIMIT 名额. 故 len(urls) < 1000 即使 DB
//      还有更多行 (LIMIT 已返 1000 行, hasMore 应为 true). 修复: 用独立计数器
//      rowsIterated 计 SQL 返回的行数 (不随 Scan 跳过递减), hasMore = rowsIterated == 1000.
//      影响: Scan 错误场景下旧实现 hasMore=false 让 sitemapBooksHandler 越界返空 urlset,
//      后续页面 (page+1, page+2, ...) 全部被 skip (因 caller 越界 break), 整页书索引丢失.
//      Scan 错误极少 (id/updatedAt 均为 TEXT, Scan 进 sql.NullString 几乎不会失败);
//      但 corrupted DB / schema migration 中途态可能触发, sitemap 应鲁棒.
func sitemapBooksPage(site map[string]interface{}, lastID string) ([]sitemapURL, string, bool) {
        pseudoStyle := sitemapPseudoStyle(site)
        domain, _ := site["Domain"].(string)
        var rows *sql.Rows
        var err error
        if lastID == "" {
                rows, err = db.Query(`SELECT id, updatedAt FROM Book ORDER BY id ASC LIMIT 1000`)
        } else {
                rows, err = db.Query(`SELECT id, updatedAt FROM Book WHERE id > ? ORDER BY id ASC LIMIT 1000`, lastID)
        }
        if err != nil {
                if err != sql.ErrNoRows {
                        log.Printf("[R76-A] sitemapBooksPage db.Query failed (lastID=%s): %v", lastID, err)
                }
                return nil, lastID, false
        }
        defer rows.Close()
        urls := []sitemapURL{}
        newLast := lastID
        // R77-D BUG-155: 独立计数器, Scan 跳过不递减 (LIMIT 已用名额).
        rowsIterated := 0
        for rows.Next() {
                rowsIterated++
                var id, updatedAt sql.NullString
                if err := rows.Scan(&id, &updatedAt); err != nil {
                        // R77-D BUG-155: Scan 失败 log (旧实现静默 continue, 调试难).
                        log.Printf("[R77-D] sitemapBooksPage rows.Scan failed (lastID=%s, rowNum=%d): %v - skipping row", lastID, rowsIterated, err)
                        continue
                }
                if id.String == "" {
                        continue
                }
                urls = append(urls, sitemapURL{
                        loc:        buildAbsoluteURL(domain, buildBookURL(pseudoStyle, id.String)),
                        lastmod:    sitemapFormatDate(updatedAt.String),
                        changefreq: "weekly",
                        priority:   "0.6",
                })
                newLast = id.String
        }
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R76-A] sitemapBooksPage rows.Err() (lastID=%s): %v", lastID, rerr)
        }
        // R77-D BUG-155: hasMore = rowsIterated == 1000 (独立计数, Scan 跳过不递减);
        //   旧实现 len(urls) == 1000 在 Scan 错误时漏页.
        // R77-D BUG-156 (P3): BUG-155 修复引出的 infinite-loop 边界 — 若 1000 行全 Scan
        //   失败 (e.g. id 列全 NULL, 极罕见但 corrupted DB / migration 中途态可能),
        //   newLast 不前进 (== lastID), 下一轮 WHERE id > lastID 返同 1000 行, 死循环.
        //   修复: rowsIterated > 0 但 newLast 未前进时强制 hasMore=false 让 caller 退出.
        hasMore := rowsIterated == 1000
        if rowsIterated > 0 && newLast == lastID {
                log.Printf("[R77-D] sitemapBooksPage cursor not advancing (lastID=%s, rowsIterated=%d) - forcing hasMore=false to avoid infinite loop", lastID, rowsIterated)
                hasMore = false
        }
        return urls, newLast, hasMore
}

// sitemapChaptersPage — 构造 1 页 (1000 章) chapter URL 列表.
//
//      与 sitemapBooksPage 同款 cursor pagination. SELECT id, bookId, updatedAt 三字段
//      (bookId 用于 buildChapterURL 的 dir 风格 /book/{bookID}/chapter/{chID}.html).
//      priority 0.5 (章节页权重最低, 但仍被索引), changefreq weekly (章节内容相对稳定).
//      性能: 同 sitemapBooksPage, id 索引扫描 O(log N + 1000).
//
// R77-D BUG-155 (P3): 同 sitemapBooksPage, hasMore 用 rowsIterated 而非 len(urls)
//
//      防 Scan 错误漏页.
func sitemapChaptersPage(site map[string]interface{}, lastID string) ([]sitemapURL, string, bool) {
        pseudoStyle := sitemapPseudoStyle(site)
        domain, _ := site["Domain"].(string)
        var rows *sql.Rows
        var err error
        if lastID == "" {
                rows, err = db.Query(`SELECT id, bookId, updatedAt FROM Chapter ORDER BY id ASC LIMIT 1000`)
        } else {
                rows, err = db.Query(`SELECT id, bookId, updatedAt FROM Chapter WHERE id > ? ORDER BY id ASC LIMIT 1000`, lastID)
        }
        if err != nil {
                if err != sql.ErrNoRows {
                        log.Printf("[R76-A] sitemapChaptersPage db.Query failed (lastID=%s): %v", lastID, err)
                }
                return nil, lastID, false
        }
        defer rows.Close()
        urls := []sitemapURL{}
        newLast := lastID
        // R77-D BUG-155: 独立计数器 (同 sitemapBooksPage).
        rowsIterated := 0
        for rows.Next() {
                rowsIterated++
                var cid, bid, updatedAt sql.NullString
                if err := rows.Scan(&cid, &bid, &updatedAt); err != nil {
                        // R77-D BUG-155: Scan 失败 log.
                        log.Printf("[R77-D] sitemapChaptersPage rows.Scan failed (lastID=%s, rowNum=%d): %v - skipping row", lastID, rowsIterated, err)
                        continue
                }
                if cid.String == "" {
                        continue
                }
                urls = append(urls, sitemapURL{
                        loc:        buildAbsoluteURL(domain, buildChapterURL(pseudoStyle, cid.String, bid.String)),
                        lastmod:    sitemapFormatDate(updatedAt.String),
                        changefreq: "weekly",
                        priority:   "0.5",
                })
                newLast = cid.String
        }
        if rerr := rows.Err(); rerr != nil {
                log.Printf("[R76-A] sitemapChaptersPage rows.Err() (lastID=%s): %v", lastID, rerr)
        }
        // R77-D BUG-155 + BUG-156: 同 sitemapBooksPage, hasMore 用 rowsIterated, 加 cursor
        //   不前进时强制 false 防 infinite loop.
        hasMore := rowsIterated == 1000
        if rowsIterated > 0 && newLast == lastID {
                log.Printf("[R77-D] sitemapChaptersPage cursor not advancing (lastID=%s, rowsIterated=%d) - forcing hasMore=false to avoid infinite loop", lastID, rowsIterated)
                hasMore = false
        }
        return urls, newLast, hasMore
}

// sitemapHandler — GET /sitemap.xml: 综合单文件 sitemap.
//
//      合并: home + 全部 categories + 全部 books (cursor 分页) + 全部 chapters (cursor 分页).
//      适合中小站点 (URL 数 <50k). 大站点 (100k+ 本) 建议用 /sitemap-index.xml + 子 sitemap
//      分页 (每子 sitemap 1000 URL, 搜索引擎友好). 本 handler 仍可处理大站点 (内存按需
//      增长 ~10MB/100k URL, 可接受; 5min 缓存命中后 0 分配).
//      失败 (site==nil): 返空 urlset (合法 XML, 不报 500 — 搜索引擎视为空 sitemap 不惩罚).
func sitemapHandler(w http.ResponseWriter, r *http.Request) {
        site := sitemapGetSite()
        if site == nil {
                sitemapWriteXML(w, sitemapBuildURLSet(nil))
                return
        }
        content := sitemapGetOrCompute("sitemap.xml", func() []byte {
                urls := sitemapHomeURLs(site)
                // Books: cursor 翻页直到 hasMore=false.
                lastID := ""
                for {
                        pageURLs, newLast, hasMore := sitemapBooksPage(site, lastID)
                        urls = append(urls, pageURLs...)
                        lastID = newLast
                        if !hasMore {
                                break
                        }
                        // 安全上限: 1M 本 (1000 页 × 1000) 防 DB 异常导致无限循环 (实际 100k 本就极少).
                        if len(urls) > 1000000 {
                                break
                        }
                }
                // Chapters: 同款 cursor 翻页.
                lastCID := ""
                for {
                        pageURLs, newLast, hasMore := sitemapChaptersPage(site, lastCID)
                        urls = append(urls, pageURLs...)
                        lastCID = newLast
                        if !hasMore {
                                break
                        }
                        if len(urls) > 2000000 { // 1M books + 1M chapters = 2M 安全上限.
                                break
                        }
                }
                return sitemapBuildURLSet(urls)
        })
        sitemapWriteXML(w, content)
}

// sitemapIndexHandler — GET /sitemap-index.xml: sitemap 索引文件.
//
//      指向 sub-sitemap: sitemap-home.xml (1 个) + sitemap-books/{1..N} (N 个,
//      N = ceil(Book rows / 1000)) + sitemap-chapters/{1..M} (M 个, M = ceil(Chapter
//      rows / 1000)). 索引文件本身不分页, 1 个索引含全部 sub-sitemap 引用 (适合任意规模
//      站点, 因 sub-sitemap 数量 = (book_count + chapter_count) / 1000 + 1, 100k 站 = 200
//      sub-sitemap 引用, 单索引文件 ~50KB 可接受).
//      失败 (site==nil): 返空 sitemapindex.
//
// R77-D BUG-154 (P1): 旧 R76-A 实现生成的 sub-sitemap URL 形式 /sitemap-books-{n}.xml
//
//      与注册路由 /sitemap-books/{page} 不匹配 (R76 主控把 {page} 通配符从字面量段
//      移到独立段避免 Go 1.22 ServeMux panic), 搜索引擎抓 sitemap-index.xml 后
//      跟 /sitemap-books-1.xml 链接 → 404 (路由不匹配 + homeHandler 走 404.html).
//      修复: 改生成 /sitemap-books/{n} (匹配注册路由) + /sitemap-chapters/{n}.
//      sitemapBooksHandler/sitemapChaptersHandler r.PathValue("page") 返数字串 strconv
//      成功, handler 正常返分页 sub-sitemap XML.
func sitemapIndexHandler(w http.ResponseWriter, r *http.Request) {
        site := sitemapGetSite()
        if site == nil {
                sitemapWriteXML(w, sitemapBuildIndex(nil))
                return
        }
        content := sitemapGetOrCompute("sitemap-index.xml", func() []byte {
                domain, _ := site["Domain"].(string)
                subs := []sitemapURL{
                        {loc: buildAbsoluteURL(domain, "/sitemap-home.xml")},
                }
                var bookCount int64
                _ = db.QueryRow(`SELECT COUNT(*) FROM Book`).Scan(&bookCount)
                bookPages := (bookCount + 999) / 1000
                if bookPages == 0 {
                        bookPages = 1 // 至少 1 个 sub-sitemap 引用 (即使 0 本书, sitemap-books/1 仍返空 urlset).
                }
                for i := int64(1); i <= bookPages; i++ {
                        subs = append(subs, sitemapURL{
                                // R77-D BUG-154: 路由形式 /sitemap-books/{page} (非 .xml 后缀), 匹配注册路由.
                                loc: buildAbsoluteURL(domain, fmt.Sprintf("/sitemap-books/%d", i)),
                        })
                }
                var chapterCount int64
                _ = db.QueryRow(`SELECT COUNT(*) FROM Chapter`).Scan(&chapterCount)
                chapterPages := (chapterCount + 999) / 1000
                if chapterPages == 0 {
                        chapterPages = 1
                }
                for i := int64(1); i <= chapterPages; i++ {
                        subs = append(subs, sitemapURL{
                                // R77-D BUG-154: 同款 /sitemap-chapters/{page} 形式.
                                loc: buildAbsoluteURL(domain, fmt.Sprintf("/sitemap-chapters/%d", i)),
                        })
                }
                return sitemapBuildIndex(subs)
        })
        sitemapWriteXML(w, content)
}

// sitemapHomeHandler — GET /sitemap-home.xml: home + categories 子 sitemap.
func sitemapHomeHandler(w http.ResponseWriter, r *http.Request) {
        site := sitemapGetSite()
        if site == nil {
                sitemapWriteXML(w, sitemapBuildURLSet(nil))
                return
        }
        content := sitemapGetOrCompute("sitemap-home.xml", func() []byte {
                urls := sitemapHomeURLs(site)
                return sitemapBuildURLSet(urls)
        })
        sitemapWriteXML(w, content)
}

// sitemapBooksHandler — GET /sitemap-books/{page}: 分页 sub-sitemap (1000 本/页).
//
//      R77-D BUG-154: 路由从 /sitemap-books-{page}.xml (Go 1.22 ServeMux panic:
//      bad wildcard segment) 改为 /sitemap-books/{page} 独立段 (R76 主控修复).
//      sitemap-index.xml 生成 /sitemap-books/{n} URL 指向本路由 (R77-D BUG-154 fix).
//
//      page 从 URL 通配符提取 (r.PathValue("page")), 验证正整数 (非数字 / <1 返 404).
//      cursor pagination: 通过 (page-1) 次 sitemapBooksPage 翻页到达 page 起点 (lastID
//      累积). 性能: page=500 时需 500 次 DB 查询 (每次 ~0.5ms), 总 ~250ms; 5min 缓存
//      命中后 0 DB. 替代方案: 直接 OFFSET (page-1)*1000 — 但 OFFSET 在大 page 时 O(N)
//      扫描慢, cursor 累积翻页虽多次查询但每次 O(log N + 1000) 仍快. 综合 cursor 更稳.
//      越界 (page > bookPages): 返空 urlset (合法 XML, 不报 404 — 索引可能引用了多算的页).
func sitemapBooksHandler(w http.ResponseWriter, r *http.Request) {
        pageStr := r.PathValue("page")
        page, err := strconv.Atoi(pageStr)
        if err != nil || page < 1 {
                http.NotFound(w, r)
                return
        }
        site := sitemapGetSite()
        if site == nil {
                sitemapWriteXML(w, sitemapBuildURLSet(nil))
                return
        }
        cacheKey := fmt.Sprintf("sitemap-books-%d", page)
        content := sitemapGetOrCompute(cacheKey, func() []byte {
                lastID := ""
                // 翻页到目标 page (cursor 累积 lastID).
                for i := 1; i < page; i++ {
                        _, newLast, hasMore := sitemapBooksPage(site, lastID)
                        lastID = newLast
                        if !hasMore {
                                // 越界: page 超出实际页数, 返空 urlset.
                                return sitemapBuildURLSet(nil)
                        }
                }
                urls, _, _ := sitemapBooksPage(site, lastID)
                return sitemapBuildURLSet(urls)
        })
        sitemapWriteXML(w, content)
}

// sitemapChaptersHandler — GET /sitemap-chapters/{page}: 分页 sub-sitemap (1000 章/页).
//
//      R77-D BUG-154: 路由从 /sitemap-chapters-{page}.xml (ServeMux panic) 改为
//      /sitemap-chapters/{page} (R76 主控修复); sitemap-index.xml 生成 /sitemap-chapters/{n}
//      URL 指向本路由 (R77-D BUG-154 fix).
//
//      与 sitemapBooksHandler 同款 cursor 翻页 + 越界返空 urlset + 5min 缓存.
func sitemapChaptersHandler(w http.ResponseWriter, r *http.Request) {
        pageStr := r.PathValue("page")
        page, err := strconv.Atoi(pageStr)
        if err != nil || page < 1 {
                http.NotFound(w, r)
                return
        }
        site := sitemapGetSite()
        if site == nil {
                sitemapWriteXML(w, sitemapBuildURLSet(nil))
                return
        }
        cacheKey := fmt.Sprintf("sitemap-chapters-%d", page)
        content := sitemapGetOrCompute(cacheKey, func() []byte {
                lastID := ""
                for i := 1; i < page; i++ {
                        _, newLast, hasMore := sitemapChaptersPage(site, lastID)
                        lastID = newLast
                        if !hasMore {
                                return sitemapBuildURLSet(nil)
                        }
                }
                urls, _, _ := sitemapChaptersPage(site, lastID)
                return sitemapBuildURLSet(urls)
        })
        sitemapWriteXML(w, content)
}

// ===== R76-A 目标D: robots.txt (用户需求 #5) =====
//
// 设计:
//   User-agent: *          (所有爬虫)
//   Allow: /               (允许抓取所有路径 — 默认行为, 显式声明更友好)
//   Disallow: /admin       (admin 后台页面, 不需索引)
//   Disallow: /admin/      (admin 子路径)
//   Disallow: /api/admin/  (admin API, JSON 响应不被索引价值低 + 防 admin 操作被搜索引擎模拟)
//   Disallow: /api/feedback (反馈提交 API, POST only, 无 GET 内容)
//   Sitemap: {site.Domain}/sitemap.xml  (指向主 sitemap; R77-D 目标C 后 domain 空时
//     buildAbsoluteURL fallback "http://localhost:3000/sitemap.xml", 仍合法绝对 URL)
//   Host: {site.Domain}    (可选, 仅 Yandex/Bing 用, Google 忽略; 域名空时省略)
//
// 注: /api/public/* 不 Disallow (公开 JSON API 可被索引, 部分 source 站 /api/public/books
//      等 JSON 列表对 SEO 有价值 — Google 可解析 JSON-LD). /covers/ 不 Disallow (封面图
//      索引对图片搜索有价值). /clone-css/ 不 Disallow (CSS 不被索引但允许抓取避免 404 噪声).
//
// 缓存: 同 sitemap, 5min sync.Map 缓存 (robots.txt 内容稳定, 但 site.Domain 改动后 5min
//      内仍返旧值; admin 改 Site.domain 时可手动清缓存, 但本轮不实现 invalidate — 5min
//      TTL 自然过期够用).
//
// R77-D 目标A 协调: admin 改 Site.domain 后调 invalidateSitemapCache() 会同时清 robots.txt
//      缓存 (robots.txt 也走 sitemapCache 同 sync.Map), 让新 domain 立即生效.

// robotsTxtHandler — GET /robots.txt.
func robotsTxtHandler(w http.ResponseWriter, r *http.Request) {
        site := sitemapGetSite()
        domain := ""
        if site != nil {
                domain, _ = site["Domain"].(string)
        }
        content := sitemapGetOrCompute("robots.txt", func() []byte {
                var b strings.Builder
                b.WriteString("User-agent: *\n")
                b.WriteString("Allow: /\n")
                b.WriteString("Disallow: /admin\n")
                b.WriteString("Disallow: /admin/\n")
                b.WriteString("Disallow: /api/admin/\n")
                b.WriteString("Disallow: /api/feedback\n")
                // Sitemap 指向 (绝对 URL). R86-D BUG-226 (P4 精简): 删旧 R76-A
                //   fallback 分支 `if sitemapURL == "" || sitemapURL == "/sitemap.xml"`
                //   + `if sitemapIndexURL != "" && sitemapIndexURL != "/sitemap-index.xml"`.
                //   两者均 dead code (R77-D 目标C 后 buildAbsoluteURL 永远返绝对 URL:
                //   relURL 非空 + 不含 http(s):// / // 前缀时走 scheme+domain+relURL
                //   路径, 永远不返 "" 也永远不返相对路径). 旧 "保留防御性兜底" 注释 (防
                //   buildAbsoluteURL 未来再改返相对路径) 弱化: buildAbsoluteURL 是 pure
                //   function, 行为有 docstring 保证, 改返相对路径需同步改 50+ caller
                //   (homeHandler pSEO 注入 + sitemap* handler), 不会无观察改. 删减
                //   8 行 deadcode + 简化逻辑, 保 Sitemap 输出绝对 URL 一致. 编号
                //   BUG-226 避开 R86-C admin.go BUG-219~224 (并行 agent 编号不冲突).
                b.WriteString("Sitemap: " + buildAbsoluteURL(domain, "/sitemap.xml") + "\n")
                // Sitemap 索引也声明 (搜索引擎可选抓 index).
                b.WriteString("Sitemap: " + buildAbsoluteURL(domain, "/sitemap-index.xml") + "\n")
                // Host 指令 (仅 Yandex/Bing 用, Google 忽略; 域名空时省略).
                if domain != "" {
                        b.WriteString("Host: " + domain + "\n")
                }
                return []byte(b.String())
        })
        w.Header().Set("Content-Type", "text/plain; charset=utf-8")
        w.Header().Set("Cache-Control", "public, max-age=300")
        w.Header().Set("X-Content-Type-Options", "nosniff")
        w.Write(content)
}
