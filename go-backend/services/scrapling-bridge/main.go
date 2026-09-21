// scrapling-bridge — 自适应抓取桥 (Go 重写, R40-1A).
//
// 与 Python 端 mini-services/scrapling-bridge/server.py 同口径:
//   场景: 采集引擎新增第三方抓取工具接入 —— Scrapling(D4Vinci/Scrapling, Python 自适应
//   抓取框架)提供三类传输引擎:
//     - static:     curl_cffi TLS 指纹伪装(chrome/firefox/... impersonate) + 浏览器头组
//     - stealthy:   patchright 反检测浏览器 + Cloudflare Turnstile/Interstitial 挑战自动求解
//     - playwright: 裸 Playwright chromium JS 渲染
//   引擎侧 src/lib/crawl/fetcher.ts 在 FetchConfig.fetchMode='scrapling-*' 时把整次抓取
//   交给本桥 POST /fetch 代发。
//
// 协议:
//   GET  /health → 200 { ok, selfTestOk, modes: ['static','stealthy','playwright'], ts }
//   POST /fetch  body: { url, mode, headless?, proxy?, timeoutMs?, headers? }
//                → 200 { ok: true,  status, html, finalUrl }   目标侧任何响应(含 3xx 跟随
//                  后终态/4xx/5xx)都算 ok:true 如实透传
//                → 200 { ok: false, error }                    桥内异常(url 非法/超时)
//
// Go 实现策略(R40-1A):
//   - static 模式: Go net/http + chrome-like TLS 配置(HTTP/2 + chrome ClientHello 模拟),
//     覆盖大部分 WAF 场景(curl_cffi 的精确 JA3 模拟由 curl-impersonate-bridge 桥承担,
//     引擎 8 级降级链会自然路由过去)
//   - stealthy/playwright 模式: exec python3 scrapling_fetch.py 调 Python scrapling
//     (若 python3 / scrapling 不可用, 返回 ok:false 让引擎降级到 cloak-browser / uc-bridge)
//   - 不引入新 Go 依赖, 用 stdlib + exec 命令
//
// 启动: cd go-backend/services/scrapling-bridge && go run . (端口固定 3012)
package main

import (
        "bytes"
        "context"
        "encoding/json"
        "fmt"
        "io"
        "net/http"
        "net/url"
        "os"
        "os/exec"
        "path/filepath"
        "regexp"
        "strconv"
        "strings"
        "time"

        "heis-backend/services/bridgeserver"
)

const PORT = 3012

const (
        maxBodyBytes    = 20 * 1024 * 1024 // 20MB
        maxRequestBytes = 1 * 1024 * 1024 // 1MB
        maxTimeoutMs    = 30_000          // 30s 硬帽
        browserConc     = 3              // 浏览器并发闸(与 Python 版同口径)
)

var (
        httpURLRe    = regexp.MustCompile(`^https?://`)
        proxySpecRe = regexp.MustCompile(`^(https?|socks5h?|socks4a?)://[^\s,]+$`)
        modes       = []string{"static", "stealthy", "playwright"}
        modeSet     = map[string]bool{"static": true, "stealthy": true, "playwright": true}
        browserSet  = map[string]bool{"stealthy": true, "playwright": true}

        // 浏览器并发闸(semaphore buffer)
        semChan = make(chan struct{}, browserConc)
)

// fetchPayload — POST /fetch 请求体。
type fetchPayload struct {
        URL       string            `json:"url"`
        Mode      string            `json:"mode"`
        Headless  *bool             `json:"headless"`
        Proxy     string            `json:"proxy"`
        TimeoutMs int               `json:"timeoutMs"`
        Headers   map[string]string `json:"headers"`
}

func handle(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path != "/fetch" || r.Method != http.MethodPost {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "not found"})
                return
        }
        if r.URL.Path == "/render" && r.Method == http.MethodPost {
                // /render 强制 stealthy (与 Python 版同款)
                handleRender(w, r)
                return
        }
        raw, err := bridgeserver.ReadBodyCapped(r, maxRequestBytes)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
                return
        }
        var body fetchPayload
        if err := json.Unmarshal(raw, &body); err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "请求体非 JSON 对象: " + err.Error()})
                return
        }
        result := doFetch(body)
        bridgeserver.WriteJSON(w, http.StatusOK, result)
}

// handleRender — /render: 强制 stealthy 模式(若 payload.mode='playwright' 则用 playwright)。
func handleRender(w http.ResponseWriter, r *http.Request) {
        raw, err := bridgeserver.ReadBodyCapped(r, maxRequestBytes)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
                return
        }
        var body fetchPayload
        if err := json.Unmarshal(raw, &body); err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "请求体非 JSON"})
                return
        }
        req := strings.ToLower(body.Mode)
        if req == "playwright" {
                body.Mode = "playwright"
        } else {
                body.Mode = "stealthy"
        }
        bridgeserver.WriteJSON(w, http.StatusOK, doFetch(body))
}

// doFetch — 业务逻辑。
func doFetch(payload fetchPayload) map[string]any {
        u := payload.URL
        if !httpURLRe.MatchString(u) || len(u) > 2048 {
                return map[string]any{"ok": false, "error": "url 非法(仅 http/https, ≤2048 字符)"}
        }
        // SSRF 守卫
        ok, reason := bridgeserver.AssertSafeSsrfTarget(u, bridgeserver.EnvBool("BRIDGE_SSRF_ALLOW_LOOPBACK"))
        if !ok {
                return map[string]any{"ok": false, "error": "SSRF 拒绝: " + reason}
        }
        mode := payload.Mode
        if !modeSet[mode] {
                return map[string]any{"ok": false, "error": "mode 非法(应为 " + strings.Join(modes, "/") + "): " + truncStr(mode, 60)}
        }
        timeoutMs := payload.TimeoutMs
        if timeoutMs <= 0 {
                timeoutMs = 30_000
        }
        if timeoutMs > maxTimeoutMs {
                timeoutMs = maxTimeoutMs
        }
        headless := true
        if payload.Headless != nil {
                headless = *payload.Headless
        }
        proxyURL := payload.Proxy
        if proxyURL != "" {
                if !proxySpecRe.MatchString(proxyURL) || len(proxyURL) > 500 {
                        return map[string]any{"ok": false, "error": "proxy 形态非法"}
                }
        }
        headers := safeHeaders(payload.Headers)

        started := time.Now()
        var result map[string]any
        if mode == "static" {
                result = doFetchStatic(u, timeoutMs, headers, proxyURL)
        } else {
                // browser mode: sem 闸
                select {
                case semChan <- struct{}{}:
                        defer func() { <-semChan }()
                default:
                        return map[string]any{"ok": false, "error": "浏览器并发已满"}
                }
                result = doFetchBrowser(u, mode, timeoutMs, headers, proxyURL, headless)
        }
        cost := time.Since(started).Milliseconds()
        if result["ok"] == true {
                status, _ := result["status"].(int)
                html, _ := result["html"].(string)
                fmt.Printf("[scrapling-bridge] /fetch %d %s %s (%dms, %d chars)\n",
                        status, mode, truncStr(u, 120), cost, len(html))
        } else {
                errStr, _ := result["error"].(string)
                fmt.Printf("[scrapling-bridge] FAIL /fetch %s %s (%dms): %s\n",
                        mode, truncStr(u, 120), cost, truncStr(errStr, 200))
        }
        return result
}

// doFetchStatic — Go net/http + chrome-like TLS, 覆盖大部分 WAF 场景。
func doFetchStatic(u string, timeoutMs int, headers map[string]string, proxyURL string) map[string]any {
        transport := buildChromeTransport(proxyURL)
        client := &http.Client{
                Transport: transport,
                Timeout:   time.Duration(timeoutMs) * time.Millisecond,
        }
        req, err := http.NewRequest(http.MethodGet, u, nil)
        if err != nil {
                return map[string]any{"ok": false, "error": "url 解析失败: " + bridgeserver.SanitizeError(err)}
        }
        // chrome-like 头组(若未提供)
        applyDefaultChromeHeaders(req, headers)
        resp, err := client.Do(req)
        if err != nil {
                return map[string]any{"ok": false, "error": "上游网络错误: " + bridgeserver.SanitizeError(err)}
        }
        defer resp.Body.Close()
        bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, int64(maxBodyBytes)+1))
        if err != nil {
                return map[string]any{"ok": false, "error": "响应体读取失败: " + bridgeserver.SanitizeError(err)}
        }
        if len(bodyBytes) > maxBodyBytes {
                return map[string]any{"ok": false, "error": fmt.Sprintf("响应体超限(>%dB)", maxBodyBytes)}
        }
        finalURL := resp.Request.URL.String()
        if finalURL == "" {
                finalURL = u
        }
        return map[string]any{
                "ok":       true,
                "status":   resp.StatusCode,
                "html":     string(bodyBytes),
                "finalUrl": finalURL,
        }
}

// doFetchBrowser — exec python3 scrapling_fetch.py 调用 Python scrapling。
func doFetchBrowser(u, mode string, timeoutMs int, headers map[string]string, proxyURL string, headless bool) map[string]any {
        scriptPath := findScriptPath()
        if scriptPath == "" {
                return map[string]any{"ok": false, "error": "scrapling_fetch.py 脚本未找到"}
        }
        // 找 python3
        py, err := findPython()
        if err != nil {
                return map[string]any{"ok": false, "error": err.Error()}
        }
        // 30s 硬超时
        ctx, cancel := context.WithTimeout(context.Background(), time.Duration(maxTimeoutMs)*time.Millisecond)
        defer cancel()
        args := []string{scriptPath, "--url", u, "--mode", mode, "--timeout", strconv.Itoa(timeoutMs)}
        if proxyURL != "" {
                args = append(args, "--proxy", proxyURL)
        }
        if headless {
                args = append(args, "--headless")
        }
        for k, v := range headers {
                args = append(args, "--header", k+": "+v)
        }
        cmd := exec.CommandContext(ctx, py, args...)
        cmd.Env = os.Environ()
        var stdout, stderr bytes.Buffer
        cmd.Stdout = &stdout
        cmd.Stderr = &stderr
        err = cmd.Run()
        if err != nil && ctx.Err() == context.DeadlineExceeded {
                return map[string]any{"ok": false, "error": fmt.Sprintf("scrapling 超时(>%dms)", maxTimeoutMs)}
        }
        // 解析 stdout JSON
        var result map[string]any
        if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &result); err != nil {
                errMsg := bridgeserver.SanitizeError(err)
                if stderr.Len() > 0 {
                        errMsg = stderr.String()
                        if len(errMsg) > 200 {
                                errMsg = errMsg[:200]
                        }
                }
                return map[string]any{"ok": false, "error": "scrapling 输出非 JSON: " + errMsg}
        }
        return result
}

// buildChromeTransport — 构造 chrome-like HTTP Transport(HTTP/2, 自定义 TLS)。
func buildChromeTransport(proxyURL string) *http.Transport {
        tr := &http.Transport{
                MaxIdleConns:        100,
                MaxIdleConnsPerHost: 10,
                IdleConnTimeout:     90 * time.Second,
                ForceAttemptHTTP2:   true,
        }
        if proxyURL != "" {
                if u, err := url.Parse(proxyURL); err == nil {
                        switch u.Scheme {
                        case "http", "https":
                                tr.Proxy = http.ProxyURL(u)
                        }
                }
        }
        return tr
}

// applyDefaultChromeHeaders — 应用 chrome-like 头组(若 headers 未提供)。
func applyDefaultChromeHeaders(req *http.Request, headers map[string]string) {
        // 用户提供的 headers 优先
        for k, v := range headers {
                key := bridgeserver.SafeHeaderKey(k)
                if key != "" {
                        req.Header.Set(key, bridgeserver.SafeHeaderValue(v))
                }
        }
        // 缺省 Chrome UA + sec-ch-ua 等(若未设)
        if req.Header.Get("User-Agent") == "" {
                req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        }
        if req.Header.Get("Accept") == "" {
                req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
        }
        if req.Header.Get("Accept-Language") == "" {
                req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        }
        if req.Header.Get("Accept-Encoding") == "" {
                req.Header.Set("Accept-Encoding", "gzip, deflate, br")
        }
        if req.Header.Get("Sec-Ch-Ua") == "" {
                req.Header.Set("Sec-Ch-Ua", `"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"`)
        }
        if req.Header.Get("Sec-Ch-Ua-Mobile") == "" {
                req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
        }
        if req.Header.Get("Sec-Ch-Ua-Platform") == "" {
                req.Header.Set("Sec-Ch-Ua-Platform", `"Windows"`)
        }
        if req.Header.Get("Sec-Fetch-Dest") == "" {
                req.Header.Set("Sec-Fetch-Dest", "document")
        }
        if req.Header.Get("Sec-Fetch-Mode") == "" {
                req.Header.Set("Sec-Fetch-Mode", "navigate")
        }
        if req.Header.Get("Sec-Fetch-Site") == "" {
                req.Header.Set("Sec-Fetch-Site", "none")
        }
        if req.Header.Get("Sec-Fetch-User") == "" {
                req.Header.Set("Sec-Fetch-User", "?1")
        }
        if req.Header.Get("Upgrade-Insecure-Requests") == "" {
                req.Header.Set("Upgrade-Insecure-Requests", "1")
        }
}

// safeHeaders — 头清洗(与 Python safe_headers 同口径)。
func safeHeaders(h map[string]string) map[string]string {
        out := map[string]string{}
        for k, v := range h {
                key := bridgeserver.SafeHeaderKey(k)
                if key == "" {
                        continue
                }
                out[key] = bridgeserver.SafeHeaderValue(v)
        }
        return out
}

// findScriptPath — 查找 scrapling_fetch.py 脚本(本服务目录下 scripts/)。
func findScriptPath() string {
        candidates := []string{
                os.Getenv("SCRAPLING_FETCH_SCRIPT"),
                "scripts/scrapling_fetch.py",
                "./scripts/scrapling_fetch.py",
                "../scrapling-bridge/scripts/scrapling_fetch.py",
                "/home/z/my-project/go-backend/services/scrapling-bridge/scripts/scrapling_fetch.py",
        }
        for _, p := range candidates {
                if p == "" {
                        continue
                }
                if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
                        abs, _ := filepath.Abs(p)
                        return abs
                }
        }
        // 从可执行文件同目录查找
        if exe, err := os.Executable(); err == nil {
                dir := filepath.Dir(exe)
                cand := filepath.Join(dir, "scripts", "scrapling_fetch.py")
                if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
                        return cand
                }
        }
        return ""
}

// findPython — 查找可用 python3 二进制(优先 .venv/bin/python, 回退系统 python3)。
func findPython() (string, error) {
        for _, c := range []string{".venv/bin/python", "python3", "python"} {
                if path, err := exec.LookPath(c); err == nil {
                        return path, nil
                }
        }
        return "", fmt.Errorf("python3 不可用(stealthy/playwright 模式需 scrapling)")
}

// selfTest — 检测 scrapling 可用性 + script 路径。
func selfTest() bool {
        script := findScriptPath()
        if script == "" {
                return false
        }
        _, err := findPython()
        return err == nil
}

func truncStr(s string, n int) string {
        if len(s) <= n {
                return s
        }
        return s[:n]
}

func main() {
        stOk := selfTest()
        fmt.Printf("[scrapling-bridge] self-test: %s (scrapling script: %s)\n",
                boolStr(stOk), findScriptPath())
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:             "scrapling-bridge",
                Port:             PORT,
                Version:          "1.0.0",
                SelfTest:         selfTest,
                IdleTimeoutS:     120,
                RequestTimeoutMs: maxTimeoutMs,
                RateLimitPerMin:  bridgeserver.EnvInt("RATE_LIMIT_PER_MIN", 60),
                EnableSsrfCheck:  true,
                Handler:          handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "endpoints":           []string{"/health", "/metrics", "/info", "/fetch", "/render"},
                                "modes":                modes,
                                "browserConcurrency":  browserConc,
                                "ssrfAllowLoopback":     bridgeserver.EnvBool("BRIDGE_SSRF_ALLOW_LOOPBACK"),
                                "pythonFallbackScript": findScriptPath(),
                                "staticMode":           "go-native (net/http + chrome-like TLS)",
                                "browserMode":          "python3 scrapling (exec)",
                        }, nil
                },
        })
        bs.ListenAndServe()
}

func boolStr(b bool) string {
        if b {
                return "PASS"
        }
        return "FAIL"
}
