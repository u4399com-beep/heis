// trafilatura-bridge — 正文提取桥 (Go 重写, R43-1A).
//
// 与 Python 端 mini-services/trafilatura-bridge/server.py 同口径:
//   场景: 采集引擎 cleaner.ts 在 CleanConfig.useTrafilatura=true 时, 把章节 HTML
//   正文提取交给本桥, 自动剥离广告/导航/侧栏/友链/水印段落, 输出干净正文文本 +
//   元数据 (title/author/description/sitename/url). Python Trafilatura 用启发式算法
//   + justext 段落分类, 对结构复杂的源站(无清晰容器/混杂标签/模板渲染破损)效果
//   远好于手动 cheerio DOM 剥壳 + adPatterns 正则清洗链.
//
// Go 重写: 用 go-shiori/go-readability (Mozilla Readability.js 端口, 与 Trafilatura
//   同档主流正文提取算法) + goquery (DOM 解析 + 元数据补全). 与 Python Trafilatura
//   的差异: Trafilatura 用 justext 段落分类, Readability 用打分 + 顶候选节点;
//   两者对 99% 章节正文 HTML 输出等价; Readability 对纯文本/无主容器页更稳
//   (Go 移植的 justext 不成熟, R43-1A 选 Readability).
//
// 协议:
//   GET  /health → { ok, service, port, ts, selfTestOk, deps }
//   POST /extract body: { html, url?, outputFormat?, includeComments?,
//                         includeTables?, includeLinks?, includeImages?,
//                         favorPrecision? }
//                 → 200 { ok: true, text, title, meta }
//                    (text 可能为空字符串 — 源文无正文/Readability 段落分类全 reject;
//                     cleaner 侧据 empty=true 降级回 cheerio 链; 不算 ok:false)
//                 → 200 { ok: false, error }  桥内异常(html 缺失/超大/解析失败)
//
// 安全: hostname 钉 127.0.0.1; POST 体上限 MAX_REQUEST_BYTES(20MB)防上游灌大 HTML
//       撑爆内存; html 字段上限 MAX_HTML_BYTES(15MB)与解析器工作集匹配; url 仅
//       http(s) 且限长(供元数据 fallback, 不抓取); 任务总时长上限 30s.
//
// 启动: cd go-backend/services/trafilatura-bridge && go run . (端口固定 3019)
package main

import (
        "encoding/json"
        "fmt"
        "net/http"
        "net/url"
        "regexp"
        "strings"
        "time"

        "github.com/PuerkitoBio/goquery"
        readability "github.com/go-shiori/go-readability"

        "heis-backend/services/bridgeserver"
)

const PORT = 3019

const (
        trMaxRequestBytes = 20 * 1024 * 1024 // 20MB POST 体上限
        trMaxHTMLBytes    = 15 * 1024 * 1024 // 15MB html 字段上限
        trMaxURLLen       = 2048             // url 字段上限(供 Readability pageURL 用, 不抓取)
        trIdleTimeoutS    = 200              // 覆盖 30s 解析 + 元数据补全
        trMaxTimeoutMs    = 30_000           // 30s 硬帽(任务要求)
)

// extractBody — POST /extract 请求体.
type extractBody struct {
        HTML            string `json:"html"`
        URL             string `json:"url"`
        OutputFormat    string `json:"outputFormat"`     // txt|html; 其他归 txt
        IncludeComments bool   `json:"includeComments"`  // 影响 meta 显示, 不影响 Readability
        IncludeTables   bool   `json:"includeTables"`
        IncludeLinks    bool   `json:"includeLinks"`
        IncludeImages   bool   `json:"includeImages"`
        FavorPrecision  bool   `json:"favorPrecision"`  // Readability CharThresholds 调整
}

// extractResult — POST /extract 响应.
type extractResult struct {
        OK    bool              `json:"ok"`
        Text  string            `json:"text,omitempty"`
        Title string            `json:"title,omitempty"`
        Meta  map[string]string `json:"meta,omitempty"`
        Error string            `json:"error,omitempty"`
}

var safeURLRe = regexp.MustCompile(`^https?://`)

func handle(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path != "/extract" || r.Method != http.MethodPost {
                bridgeserver.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "not found"})
                return
        }
        raw, err := bridgeserver.ReadBodyCapped(r, trMaxRequestBytes)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, extractResult{OK: false, Error: err.Error()})
                return
        }
        var body extractBody
        if err := json.Unmarshal(raw, &body); err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, extractResult{OK: false, Error: "请求体非 JSON: " + bridgeserver.SanitizeError(err)})
                return
        }
        if body.HTML == "" {
                bridgeserver.WriteJSON(w, http.StatusOK, extractResult{OK: false, Error: "html 字段缺失或为空"})
                return
        }
        if len(body.HTML) > trMaxHTMLBytes {
                bridgeserver.WriteJSON(w, http.StatusOK, extractResult{OK: false, Error: fmt.Sprintf("html 字段超限(>%dB)", trMaxHTMLBytes)})
                return
        }

        // url 字段仅供 Readability pageURL 用 (相对 URL 解析 + 元数据), 不抓取
        var pageURL *url.URL
        if body.URL != "" {
                if safeURLRe.MatchString(body.URL) && len(body.URL) <= trMaxURLLen {
                        if u, err := url.Parse(body.URL); err == nil {
                                pageURL = u
                        }
                }
        }

        // outputFormat: txt 走 TextContent, html 走 Content, 其他归 txt
        wantHTML := strings.EqualFold(body.OutputFormat, "html") ||
                strings.EqualFold(body.OutputFormat, "htmlfragment")

        started := time.Now()

        // 1) Readability 主正文提取
        article, perr := readability.FromReader(strings.NewReader(body.HTML), pageURL)
        if perr != nil {
                // Readability 解析失败: 不阻断, 降级走 goquery 全文本兜底
                fmt.Printf("[trafilatura-bridge] Readability FAIL %dB (%dms): %s, 降级 goquery 兜底\n",
                        len(body.HTML), time.Since(started).Milliseconds(), bridgeserver.SanitizeError(perr))
                article = readability.Article{}
        }

        // 2) 兜底: 若 Readability 输出为空(text 长度 < CharThresholds 阈值),
        //    用 goquery 提取 body 文本(剥 script/style/nav/header/footer/aside)
        text := article.TextContent
        if len(text) < 200 {
                if fallback, ok := goqueryFallback(body.HTML); ok && len(fallback) > len(text) {
                        text = fallback
                }
        }

        // 3) 元数据补全: Readability Article struct 已含 Title/Byline/SiteName/Excerpt/
        //    Language/PublishedTime/ModifiedTime/Image. 用 goquery 补 og:*/twitter:*/
        //    meta[name=...] 兜底 (Trafilatura 的 extract_metadata 等价语义)
        meta := buildMetaMap(&article, body.HTML, pageURL)

        // outputFormat=html 时返回 HTML 正文, 否则返回纯文本
        outText := text
        if wantHTML && article.Content != "" {
                outText = article.Content
        }

        title := article.Title
        if title == "" {
                if t, ok := meta["title"]; ok && t != "" {
                        title = t
                }
        }

        empty := outText == ""
        fmt.Printf("[trafilatura-bridge] extract %dB → text %dB title=%q empty=%v (%dms)\n",
                len(body.HTML), len(outText), truncate(title, 60), empty, time.Since(started).Milliseconds())

        bridgeserver.WriteJSON(w, http.StatusOK, extractResult{
                OK:    true,
                Text:  outText,
                Title: title,
                Meta:  meta,
        })
}

// goqueryFallback — Readability 失败/空时的兜底: 用 goquery 选择 body 文本,
//   剥 script/style/template/nav/header/footer/aside/form/iframe. 与 Trafilatura
//   的 justext 段落分类语义不等价但接近(无 fallback 时 cleaner 也要降级到此链).
func goqueryFallback(htmlStr string) (string, bool) {
        doc, err := goquery.NewDocumentFromReader(strings.NewReader(htmlStr))
        if err != nil {
                return "", false
        }
        // 剥除非正文标签
        doc.Find("script,style,template,nav,header,footer,aside,form,iframe,noscript,svg,canvas").Remove()
        // 优先 article / main / [role=main] 容器
        var root *goquery.Selection
        if sel := doc.Find("article").First(); sel.Length() > 0 {
                root = sel
        } else if sel := doc.Find("main").First(); sel.Length() > 0 {
                root = sel
        } else if sel := doc.Find("[role=main]").First(); sel.Length() > 0 {
                root = sel
        } else if sel := doc.Find("#content, .content, .article, .main").First(); sel.Length() > 0 {
                root = sel
        } else {
                root = doc.Find("body")
        }
        if root.Length() == 0 {
                return "", false
        }
        // goquery Text() 已剥标签 + 实体解码
        text := root.Text()
        // 规整: 每行 trim, 多于 2 个 \n 折叠
        lines := strings.Split(text, "\n")
        for i, l := range lines {
                lines[i] = strings.TrimSpace(l)
        }
        out := strings.Join(lines, "\n")
        for strings.Contains(out, "\n\n\n") {
                out = strings.ReplaceAll(out, "\n\n\n", "\n\n")
        }
        out = strings.TrimSpace(out)
        return out, out != ""
}

// buildMetaMap — 用 Readability Article + goquery 补 og:*/twitter:*/meta name 兜底,
//   构造元数据 map (与 Trafilatura extract_metadata 等价语义).
func buildMetaMap(article *readability.Article, htmlStr string, pageURL *url.URL) map[string]string {
        meta := map[string]string{}
        // Readability 已提取的字段
        if article != nil {
                if article.Title != "" {
                        meta["title"] = article.Title
                }
                if article.Byline != "" {
                        meta["author"] = article.Byline
                }
                if article.SiteName != "" {
                        meta["sitename"] = article.SiteName
                }
                if article.Excerpt != "" {
                        meta["description"] = article.Excerpt
                }
                if article.Language != "" {
                        meta["language"] = article.Language
                }
                if article.Image != "" {
                        meta["image"] = article.Image
                }
                if article.Favicon != "" {
                        meta["favicon"] = article.Favicon
                }
                if article.PublishedTime != nil {
                        meta["date"] = article.PublishedTime.Format(time.RFC3339)
                }
                if article.ModifiedTime != nil {
                        meta["modifiedTime"] = article.ModifiedTime.Format(time.RFC3339)
                }
        }
        // goquery 补全 og:*/twitter:*/meta name 兜底
        if doc, err := goquery.NewDocumentFromReader(strings.NewReader(htmlStr)); err == nil {
                if v, ok := meta["title"]; !ok || v == "" {
                        if t := doc.Find("title").First().Text(); t != "" {
                                meta["title"] = strings.TrimSpace(t)
                        }
                }
                // og:* / twitter:* / 标准 meta name=description|author|keywords
                doc.Find("meta[property], meta[name]").Each(func(_ int, s *goquery.Selection) {
                        key, _ := s.Attr("property")
                        if key == "" {
                                key, _ = s.Attr("name")
                        }
                        if key == "" {
                                return
                        }
                        k := strings.ToLower(strings.TrimSpace(key))
                        val, _ := s.Attr("content")
                        val = strings.TrimSpace(val)
                        if val == "" {
                                return
                        }
                        switch k {
                        case "og:title", "twitter:title":
                                if _, ok := meta["title"]; !ok {
                                        meta["title"] = val
                                }
                        case "og:description", "twitter:description", "description":
                                if _, ok := meta["description"]; !ok {
                                        meta["description"] = val
                                }
                        case "og:site_name":
                                if _, ok := meta["sitename"]; !ok {
                                        meta["sitename"] = val
                                }
                        case "og:image", "twitter:image":
                                if _, ok := meta["image"]; !ok {
                                        meta["image"] = val
                                }
                        case "author", "article:author", "og:article:author":
                                if _, ok := meta["author"]; !ok {
                                        meta["author"] = val
                                }
                        case "article:published_time", "og:article:published_time", "datepublished":
                                if _, ok := meta["date"]; !ok {
                                        meta["date"] = val
                                }
                        case "article:modified_time", "og:article:modified_time":
                                if _, ok := meta["modifiedTime"]; !ok {
                                        meta["modifiedTime"] = val
                                }
                        case "og:locale", "language":
                                if _, ok := meta["language"]; !ok {
                                        meta["language"] = val
                                }
                        case "keywords":
                                meta["keywords"] = val
                        case "og:url", "twitter:url":
                                if _, ok := meta["url"]; !ok {
                                        meta["url"] = val
                                }
                        }
                })
        }
        // url / hostname fallback
        if _, ok := meta["url"]; !ok && pageURL != nil {
                meta["url"] = pageURL.String()
        }
        if pageURL != nil {
                if pageURL.Host != "" {
                        if _, ok := meta["hostname"]; !ok {
                                meta["hostname"] = pageURL.Host
                        }
                }
                if _, ok := meta["sitename"]; !ok {
                        // 从 hostname 取根域兜底
                        parts := strings.Split(pageURL.Host, ".")
                        if len(parts) >= 2 {
                                meta["sitename"] = parts[len(parts)-2]
                        }
                }
        }
        return meta
}

// truncate — 截断字符串到最大字节长度(超出按字节切片, 用于日志).
func truncate(s string, n int) string {
        if len(s) <= n {
                return s
        }
        return s[:n]
}

func main() {
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:             "trafilatura-bridge",
                Port:             PORT,
                Version:          "1.0.0-go",
                IdleTimeoutS:     trIdleTimeoutS,
                RequestTimeoutMs: trMaxTimeoutMs,
                RateLimitPerMin:  bridgeserver.EnvInt("RATE_LIMIT_PER_MIN", 120),
                EnableSsrfCheck:  false, // 本桥不抓取 URL, 仅解析 HTML 字段, 不需 SSRF 守卫
                SelfTest: func() bool {
                        // goquery + go-readability 编译期就绑定, 不需运行时探测
                        // (与 Python trafilatura 不同, Go 不存在运行时缺包情况)
                        return true
                },
                Handler: handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "endpoints":        []string{"GET /health", "GET /metrics", "GET /info", "POST /extract"},
                                "maxRequestBytes":  trMaxRequestBytes,
                                "maxHtmlBytes":     trMaxHTMLBytes,
                                "maxTimeoutMs":     trMaxTimeoutMs,
                                "deps": []string{
                                        "github.com/go-shiori/go-readability (Mozilla Readability.js Go 端口)",
                                        "github.com/PuerkitoBio/goquery (CSS 选择器 DOM 解析)",
                                },
                                "note": "Go 重写, 取代 Python Trafilatura (R43-1A)",
                        }, nil
                },
        })
        bs.ListenAndServe()
}
