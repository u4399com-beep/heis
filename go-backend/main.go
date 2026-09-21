// heis-backend — Go 后端 PoC (证明内存优势 vs next-server 2.2GB)
// 用 net/http 标准库 + modernc.org/sqlite (纯 Go, 无 cgo)
// 目标: 内存 10-20MB (vs next-server 2.2GB)
package main

import (
        "database/sql"
        "encoding/json"
        "fmt"
        "log"
        "net/http"
        "os"
        "path/filepath"
        "runtime"
        "strings"

        _ "modernc.org/sqlite"
)

var db *sql.DB

// Book 书籍列表项
type Book struct {
        ID           string `json:"id"`
        Name         string `json:"name"`
        Author       string `json:"author"`
        Intro        string `json:"intro"`
        Cover        string `json:"cover"`
        Status       string `json:"status"`
        WordCount    int64  `json:"wordCount"`
        LatestChapter string `json:"latestChapter"`
        Category     string `json:"category"`
        CategoryID   string `json:"categoryId"`
}

// Category 分类
type Category struct {
        ID   string `json:"id"`
        Name string `json:"name"`
}

func main() {
        // 找数据库文件
        dbPath := findDB()
        if dbPath == "" {
                log.Fatal("找不到数据库文件")
        }
        log.Printf("数据库: %s", dbPath)

        var err error
        db, err = sql.Open("sqlite", dbPath)
        if err != nil {
                log.Fatal(err)
        }
        defer db.Close()

        // 路由
        http.HandleFunc("/health", healthHandler)
        http.HandleFunc("/api/public/books", booksHandler)
        http.HandleFunc("/api/public/categories", categoriesHandler)
        http.HandleFunc("/api/public/sites", sitesHandler)

        // 静态文件 (clone-css)
        fs := http.FileServer(http.Dir(filepath.Join("..", "public")))
        http.Handle("/clone-css/", http.StripPrefix("/clone-css/", fs))

        addr := ":3001"
        log.Printf("heis-backend 启动: http://localhost%s", addr)
        log.Printf("内存占用: %d MB", getMemMB())
        if err := http.ListenAndServe(addr, nil); err != nil {
                log.Fatal(err)
        }
}

func findDB() string {
        // 优先 db/custom.db (.env DATABASE_URL), 其次 prisma/dev.db
        candidates := []string{"../db/custom.db", "../prisma/dev.db", "../dev.db"}
        for _, c := range candidates {
                if _, err := os.Stat(c); err == nil {
                        return c
                }
        }
        return ""
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
        writeJSON(w, map[string]interface{}{
                "ok":      true,
                "service": "heis-backend",
                "lang":    "go",
                "memMB":   getMemMB(),
        })
}

func booksHandler(w http.ResponseWriter, r *http.Request) {
        siteID := r.URL.Query().Get("site")
        _ = siteID // 暂不按站点过滤
        rows, err := db.Query(`
                SELECT b.id, b.name, b.author, b.intro, b.cover, b.status, b.wordCount, b.latestChapter,
                       COALESCE(c.name, '未分类') as categoryName, b.categoryId
                FROM Book b LEFT JOIN Category c ON b.categoryId = c.id
                ORDER BY b.updatedAt DESC LIMIT 48
        `)
        if err != nil {
                writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
                return
        }
        defer rows.Close()

        books := []Book{}
        for rows.Next() {
                var b Book
                var intro, cover, latestChapter, categoryID sql.NullString
                if err := rows.Scan(&b.ID, &b.Name, &b.Author, &intro, &cover, &b.Status, &b.WordCount, &latestChapter, &b.Category, &categoryID); err == nil {
                        b.Intro = truncate(intro.String, 120)
                        b.Cover = cover.String
                        b.LatestChapter = latestChapter.String
                        b.CategoryID = categoryID.String
                        books = append(books, b)
                }
        }
        writeJSON(w, map[string]interface{}{"ok": true, "data": map[string]interface{}{"books": books, "total": len(books)}})
}

func categoriesHandler(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query(`SELECT id, name FROM Category ORDER BY sortOrder ASC LIMIT 60`)
        if err != nil {
                writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
                return
        }
        defer rows.Close()

        cats := []Category{}
        for rows.Next() {
                var c Category
                if err := rows.Scan(&c.ID, &c.Name); err == nil {
                        cats = append(cats, c)
                }
        }
        writeJSON(w, map[string]interface{}{"ok": true, "data": map[string]interface{}{"items": cats}})
}

func sitesHandler(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query(`SELECT id, name, domain, themeId, isDefault FROM Site WHERE status = 1`)
        if err != nil {
                writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
                return
        }
        defer rows.Close()

        type Site struct {
                ID        string `json:"id"`
                Name      string `json:"name"`
                Domain    string `json:"domain"`
                ThemeID   string `json:"themeId"`
                IsDefault bool   `json:"isDefault"`
        }
        sites := []Site{}
        for rows.Next() {
                var s Site
                if err := rows.Scan(&s.ID, &s.Name, &s.Domain, &s.ThemeID, &s.IsDefault); err == nil {
                        sites = append(sites, s)
                }
        }
        writeJSON(w, map[string]interface{}{"ok": true, "data": sites})
}

func writeJSON(w http.ResponseWriter, v interface{}) {
        w.Header().Set("Content-Type", "application/json; charset=utf-8")
        w.Header().Set("Access-Control-Allow-Origin", "*")
        json.NewEncoder(w).Encode(v)
}

func truncate(s string, n int) string {
        if len(s) <= n {
                return s
        }
        return s[:n]
}

func getMemMB() uint64 {
        var m runtime.MemStats
        runtime.ReadMemStats(&m)
        return m.Sys / 1024 / 1024
}

func init() {
        // 设置 GOMAXPROCS
        runtime.GOMAXPROCS(runtime.NumCPU())
        // 日志带时间
        log.SetFlags(log.LstdFlags | log.Lshortfile)
        log.SetOutput(os.Stdout)
        _ = strings.TrimSpace // 避免 unused import
        _ = fmt.Sprintf
}
