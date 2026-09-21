// deqixs-proxy — deqixs.cc 正文三参数动态签名外置转换代理 (Go 重写, R40-1A).
//
// 与 TS 端 mini-services/deqixs-proxy/index.ts 同口径:
//   - deqixs.cc 杰奇系: 列表/书页/目录三段直连可用, 正文层双墙:
//     ①章节页 div#chapter-content SSR 为空, 20KB 内联渲染脚本按 24 行/页懒加载
//     ②真实内容 = /scripts/chapter.js.php?aid&cid&referrer → 三参数
//       (chapterToken 32hex + timestamp 13位ms + nonce 8hex) →
//       /modules/article/ajax2.php?aid&cid&token&timestamp&nonce → GBK JSON
//       {status:1, data.content: 全文HTML(<br/>分段)}
//   - ★ajax2 三重校验:
//       1) 缺 X-Requested-With / Referer 头        → {"status":0,"message":"仅支持网页端访问"}
//       2) Referer 头 ≠ 签发时的 referrer 参数值    → {"status":0,"message":"Token验证失败"}
//       3) timestamp 限时(旧时间戳)                → {"status":0,"message":"请求已过期"}
//   - GBK 解码: Go x/text/encoding/simplifiedchinese.GBK
//
// 接口:
//   GET /health                → {ok,service,port,selfTestOk,upstreamReachable,upstream,ts}
//   GET /content?u={章节URL}   → {ok,aid,cid,len,content}  (content=UTF-8 纯文本 \n 分段)
//
// 启动: cd go-backend/services/deqixs-proxy && go run . (端口固定 3014)
package main

import (
        "encoding/json"
        "fmt"
        "io"
        "net/http"
        "net/url"
        "regexp"
        "strings"
        "sync"
        "time"

        "golang.org/x/text/encoding/simplifiedchinese"

        "heis-backend/services/bridgeserver"
)

const PORT = 3014

const (
        upstream          = "https://www.deqixs.cc"
        upstreamTimeoutMs = 15000
        ua                = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        // 自检/可达性探针用固定章节(书126第一章, 11KB 正文)
        probeAID = "126"
        probeCID = "81417"
)

// GBK 解码器(x/text 标准库, 不依赖 iconv-lite)
var gbk = simplifiedchinese.GBK

// ---------- 启动自检 ----------
// selfTest — 5 项离线确定性自检。
func selfTest() bool {
        fails := []string{}
        // ① GBK 解码: "中文" 的 GBK 字节
        dec, _ := gbk.NewDecoder().Bytes([]byte{0xd6, 0xd0, 0xce, 0xc4})
        if string(dec) != "中文" {
                fails = append(fails, "GBK解码")
        }
        // ② chapter.js.php 三参数提取
        jsBody := "var chapterToken = '975a047fddd2c1f188e0d1ef6beaae9d';\nvar timestamp = 1788519451000;\nvar nonce = '91fdf006';\nvar tokenUrl = '';\n"
        token := tokenRe.FindStringSubmatch(jsBody)
        ts := timestampRe.FindStringSubmatch(jsBody)
        nonce := nonceRe.FindStringSubmatch(jsBody)
        if len(token) < 2 || token[1] != "975a047fddd2c1f188e0d1ef6beaae9d" ||
                len(ts) < 2 || ts[1] != "1788519451000" ||
                len(nonce) < 2 || nonce[1] != "91fdf006" {
                fails = append(fails, "三参数提取")
        }
        // ③ GBK 编码的 JSON 响应解析
        // {"status":1,"data":{"content":"你好<br/>世界"}} 的 GBK 字节
        canned := []byte{
                0x7b, 0x22, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x22, 0x3a, 0x31, 0x2c, 0x22, 0x64, 0x61, 0x74, 0x61, 0x22, 0x3a, 0x7b,
                0x22, 0x63, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x22, 0x3a, 0x22, 0xc4, 0xe3, 0xba, 0xc3, 0x3c, 0x62, 0x72, 0x2f, 0x3e,
                0xca, 0xc0, 0xbd, 0xe7, 0x22, 0x7d, 0x7d,
        }
        dec2, _ := gbk.NewDecoder().Bytes(canned)
        var j struct {
                Status int `json:"status"`
                Data   struct {
                        Content string `json:"content"`
                } `json:"data"`
        }
        if err := json.Unmarshal(dec2, &j); err != nil || j.Status != 1 || j.Data.Content != "你好<br/>世界" {
                fails = append(fails, "GBK-JSON解析")
        }
        // ④ HTML→文本(含 &amp; 最后解码)
        conv := bridgeserver.HTMLToText("你好<br />  世界<b>x</b><br/><br/><br/> tail&nbsp;end")
        if conv != "你好\n世界x\n\ntail end" {
                fails = append(fails, "HTML→文本("+conv+")")
        }
        dd := bridgeserver.HTMLToText("a&amp;lt;b&amp;gt;c")
        if dd != "a&lt;b&gt;c" {
                fails = append(fails, "HTML→文本双解码("+dd+")")
        }
        // ⑤ 章节 URL 解析
        aid, cid, ok := parseChapterURL("https://www.deqixs.cc/books/126/81417.html")
        if !ok || aid != "126" || cid != "81417" {
                fails = append(fails, "章节URL解析")
        }
        if len(fails) > 0 {
                fmt.Printf("[deqixs-proxy] self-test FAIL: %s\n", strings.Join(fails, "+"))
                return false
        }
        return true
}

// ---------- 工具 ----------
var (
        tokenRe     = regexp.MustCompile(`chapterToken\s*=\s*'([^']+)'`)
        timestampRe = regexp.MustCompile(`timestamp\s*=\s*(\d+)`)
        nonceRe     = regexp.MustCompile(`nonce\s*=\s*'([^']+)'`)
        chapterURLRe = regexp.MustCompile(`^/books/(\d+)/(\d+)\.html$`)
)

// parseChapterURL — 章节 URL → {aid, cid} (仅接受 deqixs.cc /books/{aid}/{cid}.html)。
func parseChapterURL(u string) (aid, cid string, ok bool) {
        parsed, err := url.Parse(u)
        if err != nil {
                return "", "", false
        }
        if parsed.Hostname() != "www.deqixs.cc" && parsed.Hostname() != "deqixs.cc" {
                return "", "", false
        }
        m := chapterURLRe.FindStringSubmatch(parsed.Path)
        if m == nil {
                return "", "", false
        }
        return m[1], m[2], true
}

// chapterHeaders — 章节页头组: UA+Referer+XRW 三件套(ajax2 网页端校验的最低要求)。
func chapterHeaders(chapterURL string) map[string]string {
        return map[string]string{
                "User-Agent":        ua,
                "Referer":           chapterURL,
                "X-Requested-With": "XMLHttpRequest",
                "Accept":            "*/*",
                "Accept-Language":   "zh-CN,zh;q=0.9",
        }
}

// ---------- 上游请求 ----------
type getResResult struct {
        OK     bool
        Status int
        Buf    []byte
        Error  string
}

// getRes — 带超时+瞬态重试1次的 GET(全态返回, 不抛)。
// 5xx/429 属瞬态同样重试, 4xx 确定性失败不重试。
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
                if (resp.StatusCode >= 500 || resp.StatusCode == 429) && attempt == 1 {
                        io.Copy(io.Discard, resp.Body)
                        resp.Body.Close()
                        time.Sleep(600 * time.Millisecond)
                        continue
                }
                buf, _ := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
                resp.Body.Close()
                return getResResult{OK: resp.StatusCode >= 200 && resp.StatusCode < 300, Status: resp.StatusCode, Buf: buf}
        }
        return getResResult{OK: false, Status: -1, Error: "unreachable"}
}

// ---------- 核心链路 ----------
type contentResult struct {
        OK      bool   `json:"ok"`
        AID     string `json:"aid,omitempty"`
        CID     string `json:"cid,omitempty"`
        Content string `json:"content,omitempty"`
        Error  string `json:"error,omitempty"`
}

// fetchContent — 章节 URL → 三参数 → GBK-JSON → 纯文本。
func fetchContent(chapterURL string) contentResult {
        aid, cid, ok := parseChapterURL(chapterURL)
        if !ok {
                return contentResult{OK: false, Error: fmt.Sprintf("u 必须为 deqixs 章节页 URL(/books/{aid}/{cid}.html), 收到: %s", bridgeserver.TruncStr(chapterURL, 120))}
        }
        headers := chapterHeaders(chapterURL)

        // ① 三参数签发: chapter.js.php(referrer 参数值=章节URL, 与后续 Referer 头严格一致)
        jsURL := fmt.Sprintf("%s/scripts/chapter.js.php?aid=%s&cid=%s&referrer=%s",
                upstream, aid, cid, url.QueryEscape(chapterURL))
        js1 := getRes(jsURL, headers)
        if !js1.OK {
                return contentResult{OK: false, AID: aid, CID: cid,
                        Error: fmt.Sprintf("chapter.js.php 上游失败(%d%s)", js1.Status, bridgeserver.IfStr(js1.Error != "", " "+js1.Error, ""))}
        }
        jsText := string(js1.Buf)
        token := firstGroup(tokenRe, jsText)
        timestamp := firstGroup(timestampRe, jsText)
        nonce := firstGroup(nonceRe, jsText)
        if token == "" || timestamp == "" || nonce == "" {
                return contentResult{OK: false, AID: aid, CID: cid,
                        Error: fmt.Sprintf("三参数提取失败(token=%s/ts=%s/nonce=%s), 响应头120B: %s",
                                bridgeserver.IfStr(token == "", "空", "OK"), bridgeserver.IfStr(timestamp == "", "空", "OK"), bridgeserver.IfStr(nonce == "", "空", "OK"),
                                bridgeserver.TruncStr(jsText, 120))}
        }

        // ② 正文: ajax2.php(GBK JSON), Referer 必须与①的 referrer 值一致(token 绑定校验)
        q := url.Values{}
        q.Set("aid", aid)
        q.Set("cid", cid)
        q.Set("token", token)
        q.Set("timestamp", timestamp)
        q.Set("nonce", nonce)
        aj := getRes(upstream+"/modules/article/ajax2.php?"+q.Encode(), headers)
        if !aj.OK {
                return contentResult{OK: false, AID: aid, CID: cid,
                        Error: fmt.Sprintf("ajax2.php 上游失败(%d%s)", aj.Status, bridgeserver.IfStr(aj.Error != "", " "+aj.Error, ""))}
        }
        // GBK → UTF-8 解码
        utf8Body, err := gbk.NewDecoder().Bytes(aj.Buf)
        if err != nil {
                return contentResult{OK: false, AID: aid, CID: cid, Error: "GBK 解码失败: " + err.Error()}
        }
        var j struct {
                Status  int    `json:"status"`
                Message string `json:"message"`
                Data    struct {
                        Content string `json:"content"`
                } `json:"data"`
        }
        if err := json.Unmarshal(utf8Body, &j); err != nil {
                return contentResult{OK: false, AID: aid, CID: cid,
                        Error: fmt.Sprintf("ajax2.php 响应非JSON(%dB): %s", len(utf8Body), bridgeserver.TruncStr(string(utf8Body), 80))}
        }
        if j.Status != 1 || j.Data.Content == "" {
                return contentResult{OK: false, AID: aid, CID: cid,
                        Error: fmt.Sprintf("ajax2.php 业务失败(status=%d, message=%s)", j.Status, j.Message)}
        }
        return contentResult{OK: true, AID: aid, CID: cid, Content: bridgeserver.HTMLToText(j.Data.Content)}
}

func firstGroup(re *regexp.Regexp, s string) string {
        m := re.FindStringSubmatch(s)
        if len(m) >= 2 {
                return m[1]
        }
        return ""
}

// ---------- 健康检查缓存 ----------
var (
        probeMu         sync.Mutex
        upstreamReach   bool
        upstreamStatus  int
        lastProbe       int64
        probeInProgress bool
)

func healthCheck() (map[string]any, error) {
        now := time.Now().UnixMilli()
        probeMu.Lock()
        if now-lastProbe > 60_000 && !probeInProgress {
                probeInProgress = true
                probeMu.Unlock()
                go func() {
                        // R42-1A: panic recover 防 probeInProgress 永卡 true (R41-1B 已加 snapshot 但漏 recover)
                        defer func() {
                                if rcv := recover(); rcv != nil {
                                        fmt.Printf("[deqixs-proxy] healthCheck goroutine panic: %v\n", rcv)
                                }
                                probeMu.Lock()
                                probeInProgress = false
                                probeMu.Unlock()
                        }()
                        r := getRes(fmt.Sprintf("%s/scripts/chapter.js.php?aid=%s&cid=%s", upstream, probeAID, probeCID),
                                map[string]string{"User-Agent": ua, "Referer": fmt.Sprintf("%s/books/%s/%s.html", upstream, probeAID, probeCID)})
                        body := ""
                        if r.OK {
                                body = string(r.Buf)
                        }
                        probeMu.Lock()
                        upstreamReach = r.OK && strings.Contains(body, "chapterToken")
                        upstreamStatus = r.Status
                        lastProbe = time.Now().UnixMilli()
                        probeMu.Unlock()
                }()
        } else {
                probeMu.Unlock()
        }
        // R41-1B: 复制 snapshot 后返回, 防止读时另一线程写入造成数据竞争
        probeMu.Lock()
        reachSnap := upstreamReach
        statusSnap := upstreamStatus
        probeMu.Unlock()
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
                        "error": "未知路径 " + p + "(可用: /health /content?u=)",
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
                "ok":      true,
                "aid":     res.AID,
                "cid":     res.CID,
                "len":     len(res.Content),
                "content": res.Content,
        })
}

func main() {
        stOk := selfTest()
        fmt.Printf("[deqixs-proxy] self-test: %s port=%d\n", bridgeserver.BoolStr(stOk), PORT)
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:            "deqixs-proxy",
                Port:            PORT,
                Version:         "1.0.0",
                SelfTest:        selfTest,
                HealthCheck:     healthCheck,
                IdleTimeoutS:    120,
                Handler:         handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "upstream":  upstream,
                                "endpoints": []string{"/health", "/info", "/metrics", "/content?u="},
                        }, nil
                },
        })
        bs.ListenAndServe()
}

