// uc-bridge — undetected-chromedriver 桥 (Go 重写, R40-1A).
//
// 与 Python 端 mini-services/uc-bridge/server.py 同口径:
//   场景: 采集引擎 5 级 CF Turnstile 反反爬策略链(agent-JJ)的 L2/L3 级 ——
//     L2 = undetected-chromedriver(UC) 直接 launch; UC patches Chromium 规避
//          CDP 检测、navigator.webdriver、CDP Runtime.enable 探针等自动化指纹。
//     L3 = xvfb-run + UC; 当本进程未在 X server 下运行(DISPLAY 未设)时, 用虚拟帧缓冲。
//
// Go 实现策略(R40-1A):
//   - 用 chromedp(Go Chrome DevTools Protocol 库)替代 UC, launch headless chromium
//   - chromedp 已规避大部分 CDP 自动化指纹(类似 UC)
//   - L3 xvfb 模式: 若 DISPLAY 未设, 由启动脚本包装 xvfb-run, 服务自检报告 xvfb 状态
//   - 不依赖 Python undetected-chromedriver, 完全 Go 原生
//
// 协议:
//   GET  /health → 200 { ok, selfTestOk, chromePath, xvfbAvailable, ts }
//   POST /fetch  body: { url, cookies?, timeout?, xvfb? }
//                → 200 { ok: true,  status, html, cookies, finalUrl }
//                → 200 { ok: false, error }  桥内异常
//   POST /solve-turnstile  body: { url, xvfb? }
//                → 200 { ok: true, solved, cookies, html }
//                → 200 { ok: false, error }
//
// 启动: cd go-backend/services/uc-bridge && go run . (端口固定 3016)
package main

import (
        "context"
        "encoding/json"
        "fmt"
        "net/http"
        "net/url"
        "os"
        "os/exec"
        "regexp"
        "strings"
        "time"

        "github.com/chromedp/cdproto/cdp"
        "github.com/chromedp/cdproto/network"
        "github.com/chromedp/chromedp"

        "heis-backend/services/bridgeserver"
)

const PORT = 3016

const (
        maxBodyBytes       = 20 * 1024 * 1024
        maxRequestBytes    = 1 * 1024 * 1024
        maxTimeoutMs       = 30_000
        browserConcurrency = 2
)

var (
        httpURLRe  = regexp.MustCompile(`^https?://`)
        browserSem = make(chan struct{}, browserConcurrency)
)

// ---------- fetchPayload ----------
type fetchPayload struct {
        URL     string `json:"url"`
        Cookies string `json:"cookies"`
        Timeout int    `json:"timeout"`
        XVFB    string `json:"xvfb"`
}

// ---------- Chrome 探测 ----------
func findChromePath() string {
        if p := os.Getenv("UC_CHROME_PATH"); p != "" {
                if _, err := os.Stat(p); err == nil {
                        return p
                }
        }
        candidates := []string{
                "google-chrome",
                "google-chrome-stable",
                "chromium",
                "chromium-browser",
                "/opt/google/chrome/chrome",
                "/usr/bin/google-chrome",
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
        }
        for _, c := range candidates {
                if p, err := exec.LookPath(c); err == nil {
                        return p
                }
        }
        // Playwright Chromium 缓存
        pwCache := os.Getenv("PLAYWRIGHT_BROWSERS_PATH")
        if pwCache == "" {
                pwCache = os.Getenv("HOME") + "/.cache/ms-playwright"
        }
        if fi, err := os.Stat(pwCache); err == nil && fi.IsDir() {
                entries, _ := os.ReadDir(pwCache)
                for i := len(entries) - 1; i >= 0; i-- {
                        if !strings.HasPrefix(entries[i].Name(), "chromium-") {
                                continue
                        }
                        for _, sub := range []string{"chrome-linux/chrome", "chrome-linux64/chrome"} {
                                cand := pwCache + "/" + entries[i].Name() + "/" + sub
                                if _, err := os.Stat(cand); err == nil {
                                        return cand
                                }
                        }
                }
        }
        return ""
}

func xvfbAvailable() bool {
        if os.Getenv("DISPLAY") != "" {
                return true
        }
        _, err := exec.LookPath("xvfb-run")
        return err == nil
}

func shouldUseXvfb(param *string) bool {
        if param != nil {
                return *param == "1"
        }
        return os.Getenv("DISPLAY") == ""
}

func selfTest() bool { return findChromePath() != "" }

// ---------- 业务逻辑 ----------
func doFetch(payload fetchPayload, query url.Values) map[string]any {
        u := payload.URL
        if !httpURLRe.MatchString(u) || len(u) > 2048 {
                return map[string]any{"ok": false, "error": "url 非法(仅 http/https, ≤2048 字符)"}
        }
        ok, reason := bridgeserver.AssertSafeSsrfTarget(u, bridgeserver.EnvBool("BRIDGE_SSRF_ALLOW_LOOPBACK"))
        if !ok {
                return map[string]any{"ok": false, "error": "SSRF 拒绝: " + reason}
        }
        timeoutMs := payload.Timeout
        if timeoutMs <= 0 {
                timeoutMs = 20_000
        }
        if timeoutMs > maxTimeoutMs {
                timeoutMs = maxTimeoutMs
        }
        xvfbParam := (*string)(nil)
        if v := query.Get("xvfb"); v != "" || query.Has("xvfb") {
                v2 := v
                xvfbParam = &v2
        }
        useXvfb := shouldUseXvfb(xvfbParam)
        if useXvfb && !xvfbAvailable() {
                return map[string]any{"ok": false, "error": "xvfb-run 不可用(L3 需安装 xvfb 或设置 DISPLAY)"}
        }
        select {
        case browserSem <- struct{}{}:
                defer func() { <-browserSem }()
        default:
                return map[string]any{"ok": false, "error": "浏览器并发已满"}
        }

        ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
        defer cancel()
        allocCtx, allocCancel := newAllocContext(ctx, useXvfb)
        defer allocCancel()
        taskCtx, taskCancel := chromedp.NewContext(allocCtx)
        defer taskCancel()

        cookies := parseCookies(payload.Cookies)
        html := ""
        finalURL := u
        var cookieStrings []string

        err := chromedp.Run(taskCtx,
                network.Enable(),
                // 注入 cookies
                chromedp.ActionFunc(func(ctx context.Context) error {
                        parsed, _ := url.Parse(u)
                        domain := parsed.Hostname()
                        exp := cdp.TimeSinceEpoch(time.Now().Add(1 * time.Hour))
                        for _, c := range cookies {
                                _ = network.SetCookie(c.Name, c.Value).WithDomain(domain).WithExpires(&exp).Do(ctx)
                        }
                        return nil
                }),
                chromedp.Navigate(u),
                chromedp.WaitReady("body", chromedp.ByQuery),
                chromedp.OuterHTML("html", &html, chromedp.ByQuery),
                chromedp.Location(&finalURL),
                chromedp.ActionFunc(func(ctx context.Context) error {
                        cs, err := network.GetCookies().Do(ctx)
                        if err != nil {
                                return nil
                        }
                        for _, c := range cs {
                                cookieStrings = append(cookieStrings, fmt.Sprintf("%s=%s", c.Name, c.Value))
                        }
                        return nil
                }),
        )
        if err != nil {
                if ctx.Err() == context.DeadlineExceeded {
                        return map[string]any{"ok": false, "error": fmt.Sprintf("chromedp 超时(>%dms)", timeoutMs)}
                }
                return map[string]any{"ok": false, "error": "chromedp 失败: " + bridgeserver.SanitizeError(err)}
        }
        if len(html) > maxBodyBytes {
                return map[string]any{"ok": false, "error": fmt.Sprintf("响应体超限(%dB)", len(html))}
        }
        return map[string]any{
                "ok":       true,
                "status":   200,
                "html":     html,
                "cookies":  cookieStrings,
                "finalUrl": finalURL,
                "xvfbUsed": useXvfb,
        }
}

func doSolveTurnstile(payload fetchPayload, query url.Values) map[string]any {
        u := payload.URL
        if !httpURLRe.MatchString(u) || len(u) > 2048 {
                return map[string]any{"ok": false, "error": "url 非法(仅 http/https, ≤2048 字符)"}
        }
        ok, reason := bridgeserver.AssertSafeSsrfTarget(u, bridgeserver.EnvBool("BRIDGE_SSRF_ALLOW_LOOPBACK"))
        if !ok {
                return map[string]any{"ok": false, "error": "SSRF 拒绝: " + reason}
        }
        timeoutMs := payload.Timeout
        if timeoutMs <= 0 {
                timeoutMs = 25_000
        }
        if timeoutMs > maxTimeoutMs {
                timeoutMs = maxTimeoutMs
        }
        xvfbParam := (*string)(nil)
        if v := query.Get("xvfb"); v != "" || query.Has("xvfb") {
                v2 := v
                xvfbParam = &v2
        }
        useXvfb := shouldUseXvfb(xvfbParam)
        if useXvfb && !xvfbAvailable() {
                return map[string]any{"ok": false, "error": "xvfb-run 不可用(L3 需安装 xvfb)"}
        }
        select {
        case browserSem <- struct{}{}:
                defer func() { <-browserSem }()
        default:
                return map[string]any{"ok": false, "error": "浏览器并发已满"}
        }
        ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
        defer cancel()
        allocCtx, allocCancel := newAllocContext(ctx, useXvfb)
        defer allocCancel()
        taskCtx, taskCancel := chromedp.NewContext(allocCtx)
        defer taskCancel()

        html := ""
        solved := false
        var cookieStrings []string

        err := chromedp.Run(taskCtx,
                network.Enable(),
                chromedp.Navigate(u),
                chromedp.WaitReady("body", chromedp.ByQuery),
                // 等待 Turnstile 通过: 轮询 cf-turnstile-response input 是否有值, 或 Turnstile iframe 消失
                chromedp.ActionFunc(func(ctx context.Context) error {
                        deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
                        for time.Now().Before(deadline) {
                                var respVal string
                                _ = chromedp.Evaluate(`document.querySelector('input[name="cf-turnstile-response"]')?.value || ''`, &respVal).Do(ctx)
                                if respVal != "" {
                                        solved = true
                                        break
                                }
                                var hasTurnstile bool
                                _ = chromedp.Evaluate(`!!document.querySelector('iframe[src*="challenges.cloudflare.com"]')`, &hasTurnstile).Do(ctx)
                                if !hasTurnstile {
                                        solved = true
                                        break
                                }
                                time.Sleep(500 * time.Millisecond)
                        }
                        return nil
                }),
                chromedp.OuterHTML("html", &html, chromedp.ByQuery),
                chromedp.ActionFunc(func(ctx context.Context) error {
                        cs, err := network.GetCookies().Do(ctx)
                        if err != nil {
                                return nil
                        }
                        for _, c := range cs {
                                cookieStrings = append(cookieStrings, fmt.Sprintf("%s=%s", c.Name, c.Value))
                        }
                        return nil
                }),
        )
        if err != nil {
                if ctx.Err() == context.DeadlineExceeded {
                        return map[string]any{"ok": false, "error": fmt.Sprintf("Turnstile 求解超时(>%dms)", timeoutMs)}
                }
                return map[string]any{"ok": false, "error": "chromedp 失败: " + bridgeserver.SanitizeError(err)}
        }
        return map[string]any{
                "ok":      true,
                "solved":   solved,
                "cookies":  cookieStrings,
                "html":     html,
        }
}

// newAllocContext — 构造 chromedp AllocContext (含 chrome path + headless flags)。
func newAllocContext(parentCtx context.Context, useXvfb bool) (context.Context, context.CancelFunc) {
        chromePath := findChromePath()
        opts := []chromedp.ExecAllocatorOption{
                chromedp.NoFirstRun,
                chromedp.NoDefaultBrowserCheck,
                chromedp.Flag("disable-blink-features", "AutomationControlled"),
                chromedp.Flag("disable-features", "IsolateOrigins,site-per-process"),
                chromedp.Flag("no-sandbox", true),
                chromedp.Flag("disable-dev-shm-usage", true),
                chromedp.Flag("disable-gpu", true),
                chromedp.Flag("disable-popup-blocking", true),
                chromedp.Flag("disable-notifications", true),
                chromedp.Flag("disable-extensions", true),
                chromedp.Flag("disable-default-apps", true),
                chromedp.Flag("disable-component-update", true),
                chromedp.Flag("disable-translate", true),
                chromedp.Flag("password-store", "basic"),
                chromedp.Flag("use-mock-keychain", true),
        }
        if chromePath != "" {
                opts = append(opts, chromedp.ExecPath(chromePath))
        }
        _ = useXvfb // xvfb 包装由启动脚本处理
        return chromedp.NewExecAllocator(parentCtx, opts...)
}

// parseCookies — 把 "k=v; k=v" 形态的 cookie 字符串解析为 Name/Value 列表。
func parseCookies(s string) []struct{ Name, Value string } {
        out := []struct{ Name, Value string }{}
        if s == "" {
                return out
        }
        for _, pair := range strings.Split(s, ";") {
                pair = strings.TrimSpace(pair)
                if pair == "" {
                        continue
                }
                idx := strings.Index(pair, "=")
                if idx < 0 {
                        continue
                }
                name := strings.TrimSpace(pair[:idx])
                value := strings.TrimSpace(pair[idx+1:])
                if name == "" {
                        continue
                }
                out = append(out, struct{ Name, Value string }{name, value})
        }
        return out
}

// ---------- 路由 ----------
func handle(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "method not allowed"})
                return
        }
        path := r.URL.Path
        if path != "/fetch" && path != "/solve-turnstile" {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "not found"})
                return
        }
        raw, err := bridgeserver.ReadBodyCapped(r, maxRequestBytes)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
                return
        }
        var payload fetchPayload
        if err := json.Unmarshal(raw, &payload); err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "请求体非 JSON"})
                return
        }
        started := time.Now()
        query := r.URL.Query()
        var result map[string]any
        if path == "/fetch" {
                result = doFetch(payload, query)
        } else {
                result = doSolveTurnstile(payload, query)
        }
        cost := time.Since(started).Milliseconds()
        if result["ok"] == true {
                status, _ := result["status"].(int)
                html, _ := result["html"].(string)
                fmt.Printf("[uc-bridge] %s %d %s (%dms, %d chars)\n",
                        path, status, truncStr(payload.URL, 120), cost, len(html))
        } else {
                errStr, _ := result["error"].(string)
                fmt.Printf("[uc-bridge] FAIL %s %s (%dms): %s\n",
                        path, truncStr(payload.URL, 120), cost, truncStr(errStr, 200))
        }
        bridgeserver.WriteJSON(w, http.StatusOK, result)
}

func truncStr(s string, n int) string {
        if len(s) <= n {
                return s
        }
        return s[:n]
}

func main() {
        stOk := selfTest()
        fmt.Printf("[uc-bridge] self-test: %s (chrome: %s, xvfb: %v)\n",
                boolStr(stOk), findChromePath(), xvfbAvailable())
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:             "uc-bridge",
                Port:             PORT,
                Version:          "1.0.0",
                SelfTest:         selfTest,
                IdleTimeoutS:     120,
                RequestTimeoutMs: maxTimeoutMs,
                RateLimitPerMin:  bridgeserver.EnvInt("RATE_LIMIT_PER_MIN", 60),
                EnableSsrfCheck:   true,
                Handler:          handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "endpoints":          []string{"/health", "/metrics", "/info", "/fetch", "/solve-turnstile"},
                                "browserConcurrency":  browserConcurrency,
                                "chromePath":          findChromePath(),
                                "xvfbAvailable":       xvfbAvailable(),
                                "ssrfAllowLoopback":   bridgeserver.EnvBool("BRIDGE_SSRF_ALLOW_LOOPBACK"),
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
