// xjp-proxy — xinjianpan.com 正文双层合并 + var c 解密外置转换代理 (Go 重写, R40-1A).
//
// 与 TS 端 mini-services/xjp-proxy/index.ts 同口径:
//   - biquge2023 仿站, 列表/书页/目录三段直连零反爬, 正文层"双层":
//     章节页 #chaptercontent SSR 前半 + <div id="morecontent"> 占位,
//     后半正文加密在页内内嵌 var c(base64 大串) 中。
//   - ★解密算法(ss-b2 对真实样本离线复现 100% 还原):
//       s      = atob(c)                            // c 为章节页 var c 原文
//       n      = parseInt(s.substring(8, 11), 10)   // 3 位数字(100..999)校验
//       payload= s.substring(11 + n, s.length - n)  // 掐头(11+n)去尾(n)
//       payload= payload.replace(/-/g,'PHA+').replace(/_/g,'8L3A+')
//       part2  = utf8(atob(payload))                // <p>分段 HTML
//   - 章节分页: 部分长章节跨多页, 页脚"下一页"链接指向 _{N}.html 续页; 自动迭代合并.
//
// 接口:
//   GET /health                → {ok,service,port,selfTestOk,selfTestDetail,upstreamReachable,upstream,ts}
//   GET /info                  → {service,version,uptime,config,...}
//   GET /metrics               → Prometheus 文本
//   GET /content?u={章节URL}   → {ok,len,content,pages,pagesTruncated?}
//
// 启动: cd go-backend/services/xjp-proxy && go run . (端口固定 3015)
package main

import (
        "encoding/base64"
        "encoding/json"
        "fmt"
        "io"
        "net/http"
        "net/url"
        "os"
        "regexp"
        "strconv"
        "strings"
        "sync"
        "time"

        "heis-backend/services/bridgeserver"
)

const PORT = 3015

const (
        upstream          = "https://www.xinjianpan.com"
        upstreamTimeoutMs = 15000
        ua                = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        idleTimeoutS      = 120
)

var (
        maxPagesEnv = func() int {
                v := os.Getenv("XJP_MAX_PAGES")
                if v == "" {
                        return 10
                }
                n, err := strconv.Atoi(v)
                if err != nil || n < 1 {
                        return 10
                }
                if n > 50 {
                        n = 50
                }
                return n
        }()
)

// ---------- var c 解密 ----------
// safeDecryptC — 与 ss-b2 离线复现产物等价: 解密失败返回 ''。
func safeDecryptC(c string) string {
        s, err := base64.StdEncoding.DecodeString(c)
        if err != nil || len(s) < 32 {
                return ""
        }
        // 注意: TS 版用 latin1 decode, Go base64.StdEncoding 返回的字节与 latin1 直接对应(0~255)
        // s[8:11] 取 3 个 ASCII 字节作为 n 的 3 位数字字符
        if len(s) < 11 {
                return ""
        }
        nBytes := s[8:11]
        n, err := strconv.Atoi(string(nBytes))
        if err != nil || n < 100 || n > 999 {
                return ""
        }
        head := 11 + n
        tail := len(s) - n
        if tail <= head {
                return ""
        }
        payloadStr := string(s[head:tail])
        // 标记膨胀: '-' → 'PHA+', '_' → '8L3A+'
        payloadStr = strings.ReplaceAll(payloadStr, "-", "PHA+")
        payloadStr = strings.ReplaceAll(payloadStr, "_", "8L3A+")
        buf, err := base64.StdEncoding.DecodeString(payloadStr)
        if err != nil || len(buf) == 0 {
                return ""
        }
        return string(buf)
}

// ---------- 章节页抽取 ----------
var (
        chapterContentOpenMarker = []byte(`id="chaptercontent">`)
        divOpenRe                = regexp.MustCompile(`<div\b|</div>`)
        moreContentRe            = regexp.MustCompile(`<div[^>]*id="morecontent"[^>]*>[\s\S]*?</div>`)
        varCRe                   = regexp.MustCompile(`var c="([^"]+)"`)
        chapterPathRe            = regexp.MustCompile(`^/txt/[A-Za-z0-9]+/[A-Za-z0-9]+(?:_\d+)?\.html$`)
        nextPageHrefRe           = regexp.MustCompile(`<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:下一页|下页|下壹頁|下一頁)\s*</a>`)
        nextPageClassRe          = regexp.MustCompile(`<a[^>]+class=["'][^"']*(?:nextpage|page-next|next-page|nexturl)[^"']*["'][^>]*href=["']([^"']+)["']`)
        // R41-1C: 跨页合并后用 — 折叠 3+ 换行为 2 个(原 multiNLRe 同款, htmlToText 已收口到 bridgeserver)
        multi3PlusRe             = regexp.MustCompile(`\n{3,}`)
)

type extractResult struct {
        OK    bool
        Inner string
}

// extractChapterInner — 从章节页 HTML 提取 #chaptercontent div 内层(div 平衡扫描)。
func extractChapterInner(html string) extractResult {
        idx := strings.Index(html, string(chapterContentOpenMarker))
        if idx < 0 {
                return extractResult{OK: false}
        }
        i := idx + len(chapterContentOpenMarker)
        depth := 1
        // 使用 regex 找所有 <div 或 </div>, 从位置 i 开始
        htmlFromI := html[i:]
        matches := divOpenRe.FindAllStringIndex(htmlFromI, -1)
        for _, m := range matches {
                tag := htmlFromI[m[0]:m[1]]
                if strings.HasPrefix(tag, "<div") {
                        depth++
                } else {
                        depth--
                }
                if depth == 0 {
                        inner := htmlFromI[:m[0]]
                        stripped := moreContentRe.ReplaceAllString(inner, "")
                        return extractResult{OK: true, Inner: stripped}
                }
        }
        return extractResult{OK: false}
}

// htmlToText — HTML 片段 → 纯文本(同 deqixs-proxy, &amp; 最后解码)。
// ---------- 启动自检 ----------
func selfTest() bool {
        fails := []string{}
        // ① 合成 c 回环: 明文以 '<p>' 开头 → 其 base64 首 4 字符恒为 'PHA+' → 编码侧替换为 '-'
        plain := "<p>你好，世界。</p><p>第二章内容验证段落。</p>"
        b64 := base64.StdEncoding.EncodeToString([]byte(plain))
        if !strings.HasPrefix(b64, "PHA+") {
                fails = append(fails, "合成样本构造(首组非 PHA+)")
        }
        payloadMarked := strings.Replace(b64, "PHA+", "-", 1)
        // 包裹形态: 8 任意字符 + 3 位数字 n + n 个任意字符 + payload + n 个任意字符
        n := 442
        sb := strings.Builder{}
        sb.WriteString("aaaaaaaa")
        sb.WriteString(strconv.Itoa(n))
        for i := 0; i < n; i++ {
                sb.WriteByte('b')
        }
        sb.WriteString(payloadMarked)
        for i := 0; i < n; i++ {
                sb.WriteByte('c')
        }
        s := sb.String()
        c := base64.StdEncoding.EncodeToString([]byte(s))
        round := safeDecryptC(c)
        if round != plain {
                fails = append(fails, "合成c回环("+bridgeserver.TruncStr(round, 30)+")")
        }
        // ② 边界校验: n 越界(099)应拒绝
        badSB := strings.Builder{}
        badSB.WriteString("aaaaaaaa099")
        for i := 0; i < 99; i++ {
                badSB.WriteByte('b')
        }
        badSB.WriteString(payloadMarked)
        for i := 0; i < 99; i++ {
                badSB.WriteByte('c')
        }
        bad := base64.StdEncoding.EncodeToString([]byte(badSB.String()))
        if safeDecryptC(bad) != "" {
                fails = append(fails, "n<100 未拒绝")
        }
        // ③ HTML→文本
        conv := bridgeserver.HTMLToText("<p>你好</p><p>　世界&nbsp;x</p><p></p><p>尾段</p>")
        if !strings.HasPrefix(conv, "你好\n世界 x\n") {
                fails = append(fails, "HTML→文本("+conv+")")
        }
        // ④ 章节页抽取
        fakePage := `<div class="content chaptercontent-84c1078c" id="chaptercontent"><p>前半A</p><div id="morecontent"><p>更多内容加载中...</p></div><p>转载尾巴</p></div>`
        got := extractChapterInner(fakePage)
        if !got.OK || got.Inner != "<p>前半A</p><p>转载尾巴</p>" {
                fails = append(fails, "章节抽取("+got.Inner+")")
        }
        return len(fails) == 0
}

// ---------- 工具 ----------
type parseResult struct {
        OK       bool
        Norm     string
        PathOnly string
}

// parseChapterURL — 接受 /txt/{code}/{page}[_N].html 形态。
func parseChapterURL(u string) parseResult {
        parsed, err := url.Parse(u)
        if err != nil {
                return parseResult{}
        }
        if parsed.Hostname() != "www.xinjianpan.com" && parsed.Hostname() != "xinjianpan.com" {
                return parseResult{}
        }
        if !chapterPathRe.MatchString(parsed.Path) {
                return parseResult{}
        }
        return parseResult{OK: true, Norm: upstream + parsed.Path, PathOnly: parsed.Path}
}

// findNextPageUrl — 从章节页 HTML 提取"下一页"链接。
func findNextPageUrl(html, currentPagePath string) string {
        for _, re := range []*regexp.Regexp{nextPageHrefRe, nextPageClassRe} {
                m := re.FindStringSubmatch(html)
                if m == nil || m[1] == "" {
                        continue
                }
                href := m[1]
                if isInvalidHref(href) {
                        continue
                }
                // 相对 URL → 基于 upstream 解析为绝对
                abs, err := url.Parse(href)
                if err != nil {
                        continue
                }
                if !abs.IsAbs() {
                        abs = &url.URL{Scheme: "https", Host: "www.xinjianpan.com", Path: href}
                }
                if abs.Hostname() != "www.xinjianpan.com" && abs.Hostname() != "xinjianpan.com" {
                        continue
                }
                if !chapterPathRe.MatchString(abs.Path) {
                        continue
                }
                if abs.Path == currentPagePath {
                        continue
                }
                return abs.String()
        }
        return ""
}

func isInvalidHref(href string) bool {
        lower := strings.ToLower(href)
        if strings.HasPrefix(lower, "javascript:") || strings.HasPrefix(href, "#") || strings.HasPrefix(lower, "void") {
                return true
        }
        return false
}

// ---------- 上游请求 ----------
type getResResult struct {
        OK     bool
        Status int
        Buf    []byte
        Error  string
}

func getRes(targetURL string, headers map[string]string) getResResult {
        for attempt := 1; attempt <= 2; attempt++ {
                req, err := http.NewRequest(http.MethodGet, targetURL, nil)
                if err != nil {
                        return getResResult{OK: false, Status: -1, Error: err.Error()}
                }
                for k, v := range headers {
                        req.Header.Set(k, v)
                }
                client := &http.Client{Timeout: upstreamTimeoutMs * time.Millisecond}
                resp, err := client.Do(req)
                if err != nil {
                        if attempt == 2 {
                                return getResResult{OK: false, Status: -1, Error: bridgeserver.TruncStr(err.Error(), 120)}
                        }
                        time.Sleep(600 * time.Millisecond)
                        continue
                }
                buf, _ := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
                resp.Body.Close()
                return getResResult{OK: resp.StatusCode >= 200 && resp.StatusCode < 300, Status: resp.StatusCode, Buf: buf}
        }
        return getResResult{OK: false, Status: -1, Error: "unreachable"}
}

// chapterHeaders — 章节 URL 头组: UA+Referer+Accept+AL, 可选 Ywkey/Ywguid 凭证。
func chapterHeaders() map[string]string {
        base := map[string]string{
                "User-Agent":      ua,
                "Referer":         upstream + "/",
                "Accept":          "text/html,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9",
        }
        // R7-18: 从主应用拉取 Ywkey/Ywguid 凭证(60s 缓存, 失败兜底无凭证)
        cfg := fetchMiniServiceConfig()
        if xjp, ok := cfg["xjp"].(map[string]any); ok {
                if ywkey, ok := xjp["ywkey"].(string); ok && ywkey != "" {
                        base["Ywkey"] = ywkey
                }
                if ywguid, ok := xjp["ywguid"].(string); ok && ywguid != "" {
                        base["Ywguid"] = ywguid
                }
        }
        return base
}

// ---------- 主应用配置拉取 ----------
var (
        mainAppURL   = os.Getenv("MAIN_APP_URL")
        mainAppURLMu sync.Once
)

func getMainAppURL() string {
        mainAppURLMu.Do(func() {
                if mainAppURL == "" {
                        mainAppURL = "http://127.0.0.1:3000"
                }
        })
        return mainAppURL
}

var (
        cfgMu       sync.Mutex
        cfgCached   map[string]any
        cfgCachedAt int64
)

const cfgCacheTTLms = 60_000

// fetchMiniServiceConfig — 60s in-memory 缓存 + 失败兜底空对象(不阻断请求)。
func fetchMiniServiceConfig() map[string]any {
        cfgMu.Lock()
        if cfgCached != nil && time.Now().UnixMilli()-cfgCachedAt < cfgCacheTTLms {
                out := cfgCached
                cfgMu.Unlock()
                return out
        }
        cfgMu.Unlock()
        // 网络拉取(5s 超时)
        client := &http.Client{Timeout: 5000 * time.Millisecond}
        req, err := http.NewRequest(http.MethodGet, getMainAppURL()+"/api/public/mini-service-config", nil)
        if err != nil {
                return lastCfg()
        }
        if key := os.Getenv("BRIDGE_KEY"); key != "" {
                req.Header.Set("X-Bridge-Key", key)
        }
        resp, err := client.Do(req)
        if err != nil {
                return lastCfg()
        }
        defer resp.Body.Close()
        if resp.StatusCode != 200 {
                return lastCfg()
        }
        body, _ := io.ReadAll(io.LimitReader(resp.Body, 1*1024*1024))
        var data struct {
                OK   bool            `json:"ok"`
                Data map[string]any `json:"data"`
        }
        if err := json.Unmarshal(body, &data); err != nil {
                return lastCfg()
        }
        cfg := data.Data
        if cfg == nil {
                cfg = map[string]any{}
        }
        cfgMu.Lock()
        cfgCached = cfg
        cfgCachedAt = time.Now().UnixMilli()
        cfgMu.Unlock()
        return cfg
}

func lastCfg() map[string]any {
        cfgMu.Lock()
        defer cfgMu.Unlock()
        if cfgCached != nil {
                return cfgCached
        }
        return map[string]any{}
}

// ---------- 核心链路 ----------
type contentResult struct {
        OK             bool
        Content        string
        Pages          int
        PagesTruncated bool
        Error          string
}

type onePageResult struct {
        OK      bool
        Content string
        NextURL string
        Error   string
}

func fetchOnePage(pageURL, pagePath string) onePageResult {
        res := getRes(pageURL, chapterHeaders())
        if !res.OK {
                return onePageResult{OK: false, Error: fmt.Sprintf("章节页上游失败(%d%s)", res.Status, bridgeserver.IfStr(res.Error != "", " "+res.Error, ""))}
        }
        html := string(res.Buf)
        // ① 前半: #chaptercontent 内层(已摘 morecontent 占位)
        got := extractChapterInner(html)
        if !got.OK {
                return onePageResult{OK: false, Error: "#chaptercontent 未找到(结构变更/风控页?)"}
        }
        // ② 后半: var c 解密
        m := varCRe.FindStringSubmatch(html)
        if m == nil || m[1] == "" {
                return onePageResult{OK: false, Error: "var c 未找到(结构变更?)"}
        }
        part2 := safeDecryptC(m[1])
        if part2 == "" {
                return onePageResult{OK: false, Error: "var c 解密失败(算法失配/样本异常)"}
        }
        // ③ 合并 → 纯文本
        content := bridgeserver.HTMLToText(got.Inner + part2)
        // ④ 探测下一页
        nextURL := findNextPageUrl(html, pagePath)
        return onePageResult{OK: true, Content: content, NextURL: nextURL}
}

func fetchContent(chapterURL string) contentResult {
        pc := parseChapterURL(chapterURL)
        if !pc.OK {
                return contentResult{OK: false, Error: fmt.Sprintf("u 必须为 xinjianpan 章节页 URL(/txt/{code}/{page}.html), 收到: %s", bridgeserver.TruncStr(chapterURL, 120))}
        }
        var allParts []string
        pages := 0
        pagesTruncated := false
        currentURL := pc.Norm
        currentPath := pc.PathOnly
        visited := map[string]bool{currentPath: true}

        for currentURL != "" && pages < maxPagesEnv {
                r := fetchOnePage(currentURL, currentPath)
                if !r.OK {
                        if pages == 0 {
                                return contentResult{OK: false, Error: r.Error}
                        }
                        pagesTruncated = true
                        break
                }
                allParts = append(allParts, r.Content)
                pages++
                if r.NextURL == "" {
                        break
                }
                // 解析下一页 path 并检查是否回环
                next, err := url.Parse(r.NextURL)
                if err != nil || next.Path == "" {
                        break
                }
                if visited[next.Path] {
                        break
                }
                visited[next.Path] = true
                currentURL = r.NextURL
                currentPath = next.Path
        }
        if pages >= maxPagesEnv && currentURL != "" {
                pagesTruncated = true
        }
        merged := strings.Join(allParts, "\n\n")
        merged = multi3PlusRe.ReplaceAllString(merged, "\n\n")
        merged = strings.TrimSpace(merged)
        return contentResult{OK: true, Content: merged, Pages: pages, PagesTruncated: pagesTruncated}
}

// ---------- 健康检查 ----------
var (
        probeMu2         sync.Mutex
        upstreamReach2    bool
        upstreamStatus2   int
        lastProbe2        int64
        probeInProgress2  bool
)

func healthCheck() (map[string]any, error) {
        now := time.Now().UnixMilli()
        probeMu2.Lock()
        if now-lastProbe2 > 60_000 && !probeInProgress2 {
                probeInProgress2 = true
                probeMu2.Unlock()
                go func() {
                        defer func() {
                                probeMu2.Lock()
                                probeInProgress2 = false
                                probeMu2.Unlock()
                        }()
                        r := getRes(upstream+"/", map[string]string{"User-Agent": ua})
                        body := ""
                        if r.OK {
                                body = string(r.Buf)
                        }
                        probeMu2.Lock()
                        upstreamReach2 = r.OK && strings.Contains(body, "新键盘小说网")
                        upstreamStatus2 = r.Status
                        lastProbe2 = time.Now().UnixMilli()
                        probeMu2.Unlock()
                }()
        } else {
                probeMu2.Unlock()
        }
        // R41-1B: 复制 snapshot 后返回, 防止读时另一线程写入造成数据竞争
        probeMu2.Lock()
        reachSnap := upstreamReach2
        statusSnap := upstreamStatus2
        probeMu2.Unlock()
        return map[string]any{
                "upstreamReachable": reachSnap,
                "upstream":          statusSnap,
        }, nil
}

// ---------- 路由 ----------
func handle(w http.ResponseWriter, r *http.Request) {
        u := r.URL
        p := u.Path
        if p != "/content" {
                bridgeserver.WriteJSON(w, http.StatusNotFound, map[string]any{
                        "ok":    false,
                        "error": "未知路径 " + p + "(可用: /health /info /metrics /content?u=)",
                })
                return
        }
        target := u.Query().Get("u")
        if target == "" {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "缺 u 参数(章节URL)"})
                return
        }
        res := fetchContent(target)
        if !res.OK {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, res)
                return
        }
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":             true,
                "len":            len(res.Content),
                "content":       res.Content,
                "pages":         res.Pages,
                "pagesTruncated": res.PagesTruncated,
        })
}

func main() {
        stOk := selfTest()
        fmt.Printf("[xjp-proxy] self-test: %s port=%d\n", bridgeserver.BoolStr(stOk), PORT)
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:            "xjp-proxy",
                Port:            PORT,
                Version:         "1.1.0",
                SelfTest:        selfTest,
                HealthCheck:     healthCheck,
                IdleTimeoutS:    idleTimeoutS,
                Handler:         handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "upstream":   upstream,
                                "maxPages":   maxPagesEnv,
                                "endpoints":  []string{"/health", "/info", "/metrics", "/content?u="},
                        }, nil
                },
        })
        bs.ListenAndServe()
}
