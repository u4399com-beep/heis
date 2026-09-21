// heis-backend — Go 完整后端 (方案 B: Go templates 前端)
// 路由 + 模板渲染 + 静态服务 + DB
package main

import (
        "database/sql"
        "encoding/json"
        "fmt"
        "html/template"
        "log"
        "net/http"
        "os"
        "path/filepath"
        "runtime"
        "strings"

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

        // 静态文件 (clone-css + public)
        publicDir := filepath.Join(basePath, "public")
        fs := http.FileServer(http.Dir(publicDir))
        http.Handle("/clone-css/", http.StripPrefix("/clone-css/", fs))

        // 前台页面 (Go templates SSR)
        http.HandleFunc("/", homeHandler) // 首页 + 路由分发

        // API 路由
        http.HandleFunc("/health", healthHandler)
        http.HandleFunc("/api/public/books", booksHandler)
        http.HandleFunc("/api/public/categories", categoriesHandler)
        http.HandleFunc("/api/public/sites", sitesHandler)
        http.HandleFunc("/api/public/book", bookDetailHandler)
        http.HandleFunc("/api/public/chapter", chapterHandler)

        addr := ":3001"
        log.Printf("heis-backend 启动: http://localhost%s (内存 %dMB)", addr, getMemMB())
        if err := http.ListenAndServe(addr, nil); err != nil {
                log.Fatal(err)
        }
}

// homeHandler 首页 + 视图路由 (/?view=home|book|read|...)
func homeHandler(w http.ResponseWriter, r *http.Request) {
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

        // 获取分类
        cats, _ := getCategories()

        // 获取书籍 (home view)
        books, _ := getBooks(48)

        // 渲染对应主题的 home template
        theme, _ := site["ThemeID"].(string)
        if !strings.HasPrefix(theme, "clone-") {
                theme = "shipsay" // 默认
        } else {
                theme = strings.TrimPrefix(theme, "clone-")
        }

        tmplName := theme + "/home"
        data := map[string]interface{}{
                "Site":       site,
                "Categories": cats,
                "Books":      books,
                "NavCats":    takeN(cats, 8),
                "TopBooks":   topBooks(books, 6),
                "Popular":    takeBooks(books, 12),
        }

        if err := tmpls.ExecuteTemplate(w, tmplName, data); err != nil {
                // fallback 到 shipsay
                if err2 := tmpls.ExecuteTemplate(w, "shipsay/home", data); err2 != nil {
                        http.Error(w, "模板渲染失败: "+err.Error(), 500)
                }
        }
}

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
        var bid, name, author, intro, cover, status, latestChapter, category, categoryId, updatedAt string
        var wordCount int64
        err := db.QueryRow(`SELECT b.id,b.name,b.author,b.intro,b.cover,b.status,b.wordCount,b.latestChapter,COALESCE(c.name,'未分类'),b.categoryId,b.updatedAt FROM Book b LEFT JOIN Category c ON b.categoryId=c.id WHERE b.id=?`, id).Scan(
                &bid, &name, &author, &intro, &cover, &status, &wordCount, &latestChapter, &category, &categoryId, &updatedAt)
        if err != nil {
                writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
                return
        }
        writeJSON(w, map[string]interface{}{"ok": true, "data": map[string]interface{}{
                "id": bid, "name": name, "author": author, "intro": intro, "cover": cover,
                "status": status, "wordCount": wordCount, "latestChapter": latestChapter,
                "category": category, "categoryId": categoryId, "updatedAt": updatedAt,
        }})
}

func chapterHandler(w http.ResponseWriter, r *http.Request) {
        id := r.URL.Query().Get("id")
        var chID, title, content string
        var idx int
        err := db.QueryRow(`SELECT id, title, content, idx FROM Chapter WHERE id=?`, id).Scan(&chID, &title, &content, &idx)
        if err != nil {
                writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
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
        // fallback 第一个
        rows2, _ := db.Query(q + ` LIMIT 1`)
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
                        "intro": truncate(intro.String, 120), "cover": cover.String,
                        "status": status.String, "wordCount": wordCount, "latestChapter": latestChapter.String,
                        "category": category.String, "categoryId": categoryId.String, "updatedAt": updatedAt,
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
        for i := 0; i < len(sorted); i++ {
                for j := i + 1; j < len(sorted); j++ {
                        if sorted[j]["wordCount"].(int64) > sorted[i]["wordCount"].(int64) {
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

// ===== 工具 =====

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
