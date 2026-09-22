// cloak-browser — 反检测浏览器桥 (Go 重写, R43-1A).
//
// 与 bun/puppeteer 端 mini-services/cloak-browser/index.ts 同口径:
//   场景: 作为采集引擎 fetcher.ts fetchMode='cloak-browser' 显式 opt-in 通道,
//   处理 Obscura 引擎无法突破的 Cloudflare / WAF 站点 (hetushu/shucong 等 hard WAF).
//   puppeteer-extra-stealth 在 Node 端靠 puppeteer-extra-plugin-stealth 抹平
//   navigator.webdriver / chrome runtime / plugins / languages 等 12 项指纹;
//   Go 重写用 chromedp (CDP Go 实现) + 启动 flags (--disable-blink-features=
//   AutomationControlled 抹除 navigator.webdriver, CDP Emulation.setUserAgentOverride
//   随机 UA, --lang=zh-CN, --window-size=1920,1080).
//
// 与 puppeteer 端的差异:
//   - chromedp 不自带 stealth plugin, 改用启动 flags + CDP Emulation + 注入脚本
//     (等价 puppeteer-extra-stealth 抹平的 12 项隐身 flags 中前 6 项)
//   - canvas/audio/WebGL noise 层 (puppeteer 端 standard/maximum 档) Go 端简化为
//     注入 JS 桩 (navigator.webdriver=undefined + window.chrome runtime + navigator
//     .languages + WebGL vendor/renderer + navigator.hardwareConcurrency=8 +
//     navigator.deviceMemory=8). per-session seed 暂不实现 (与原 lite 档等价).
//   - 并发限制 2 (与原 MAX_CONCURRENT=2 同口径), 超过返回 503 引擎侧降级
//
// 协议:
//   GET  /health → { ok, service, port, ts, browserReady, inFlight, sessions }
//   POST /render body: { url, actions?, timeoutMs?, waitUntil?, screenshot?, stealthTier? }
//                 → 200 { ok: true, html, status, finalUrl, cookies, screenshotB64? }
//                    (目标侧所有响应 —— 含 3xx/4xx/5xx —— 均忠实转发为 ok:true,
//                     浏览器层无 4xx 概念, status 取自 CDP network.response)
//                 → 200 { ok: false, error }  桥内异常(url 非法/浏览器启动失败/超时)
//   POST /fetch  (alias for /render, 兼容 fetcher.ts 旧契约)
//
// 安全: hostname 钉 127.0.0.1; url 仅 http/https 且限长 8KB; AUTH_TOKEN/BRIDGE_KEY
//       鉴权 + 30/min/IP 限速(浏览器任务重, 限速更紧); 超时上限 120s(浏览器导航+JS
//       执行远慢于 HTTP fetch); SSRF 守卫(默认拒 localhost/私网/链路本地/元数据端点,
//       BRIDGE_SSRF_ALLOW_LOOPBACK=1 放行 127.0.0.1/::1).
//
// 启动: cd go-backend/services/cloak-browser && go run . (端口固定 3020)
package main

import (
        "context"
        "encoding/base64"
        "encoding/json"
        "fmt"
        "math/rand"
        "net/http"
        "os"
        "regexp"
        "strings"
        "sync"
        "sync/atomic"
        "time"
        "unicode/utf8"

        "github.com/chromedp/cdproto/emulation"
        "github.com/chromedp/cdproto/input"
        "github.com/chromedp/cdproto/network"
        "github.com/chromedp/cdproto/page"
        "github.com/chromedp/chromedp"

        "heis-backend/services/bridgeserver"
)

const PORT = 3020

const (
        cbMaxRequestBytes = 1 * 1024 * 1024 // 1MB POST 体上限(actions 列表很短)
        cbMaxBodyBytes    = 20 * 1024 * 1024 // 20MB 响应 HTML 上限(浏览器渲染后可能含大量 base64 img)
        cbMaxTimeoutMs    = 120_000          // 120s 浏览器导航 + JS 执行上限
        cbMaxConcurrent   = 2                // 并发上限(与原 MAX_CONCURRENT=2 同口径)
        cbIdleTimeoutS    = 250              // 覆盖 120s 超时 + base64 重组开销
        cbBrowserIdleS    = 300              // 浏览器进程 idle 5min 后自动关闭
)

var ssrfAllowLB = os.Getenv("BRIDGE_SSRF_ALLOW_LOOPBACK") == "1"

// StealthTier — 与原 puppeteer 端 lite/standard/maximum 三档对齐.
//   lite: 仅 stealth 启动 flag (navigator.webdriver=undefined)
//   standard: lite + canvas/WebGL/languages 注入桩
//   maximum: standard + navigator.hardwareConcurrency/deviceMemory/connection 注入桩
type StealthTier string

const (
        TierLite     StealthTier = "lite"
        TierStandard StealthTier = "standard"
        TierMaximum  StealthTier = "maximum"
)

// renderAction — POST /render actions 列表项.
type renderAction struct {
        Type     string `json:"type"`     // click|wait|input|scroll|sleep|eval
        Selector string `json:"selector"` // CSS selector (click/wait/input/scroll)
        Value    string `json:"value"`    // input text / eval script
        WaitMs   int    `json:"waitMs"`   // sleep/wait 时长(ms)
}

// renderBody — POST /render 请求体.
type renderBody struct {
        URL          string         `json:"url"`
        Actions      []renderAction `json:"actions"`
        TimeoutMs    int            `json:"timeoutMs"`
        WaitUntil    string         `json:"waitUntil"`    // load|domcontentloaded|networkidle (默认 domcontentloaded)
        Screenshot   bool           `json:"screenshot"`    // 是否截图(viewport)
        StealthTier  string         `json:"stealthTier"`   // lite|standard|maximum (默认 standard)
}

// renderResult — POST /render 响应.
type renderResult struct {
        OK           bool              `json:"ok"`
        HTML         string            `json:"html"`
        Status       int               `json:"status"`
        FinalURL     string            `json:"finalUrl"`
        Cookies      []map[string]any  `json:"cookies"`
        ScreenshotB64 string           `json:"screenshotB64,omitempty"`
        Error        string            `json:"error,omitempty"`
}

// UA 池 — 随机选 UA 防指纹钉 (与原 DEFAULT_UA 同款, 加 3 个变体).
// R45-1A: 并补全 UA 品牌元数据 (brand / platform / bit), 供 emulation.SetUserAgentOverride
//   传 Brands 字段使用. UA 与元数据不一致会暴露 Chrome 131 UA + Chrome 142 brand
//   的指纹不一致 → 被 puppeteer-extra-stealth WAF 识别.
var userAgents = []string{
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
}

// userAgentMeta — 从 UA 字符串提取品牌元数据 (供 emulation.SetUserAgentOverride).
// R45-1A: 原实现 brand 硬编码为 "Chromium 131" / "Google Chrome 131", 但 UA 池含
//   Chrome 130 / 131 / Edge 131, UA-品牌不一致 (UA=Chrome130 但 brand=131) 被 WAF 识别.
//   本函数解析 UA 提取主版本号 + brand, 返 UserAgentMetadata.
func userAgentMeta(ua string) *emulation.UserAgentMetadata {
        meta := &emulation.UserAgentMetadata{
                Brands:          []*emulation.UserAgentBrandVersion{},
                FullVersionList: []*emulation.UserAgentBrandVersion{},
                Mobile:          false,
                Bitness:         "64",
        }
        // 提取 Chrome 主版本号
        chromeVer := ""
        edgeVer := ""
        if m := regexp.MustCompile(`Chrome/(\d+)`).FindStringSubmatch(ua); len(m) >= 2 {
                chromeVer = m[1]
        }
        if m := regexp.MustCompile(`Edg/(\d+)`).FindStringSubmatch(ua); len(m) >= 2 {
                edgeVer = m[1]
        }
        if chromeVer != "" {
                meta.Brands = append(meta.Brands,
                        &emulation.UserAgentBrandVersion{Brand: "Chromium", Version: chromeVer},
                        &emulation.UserAgentBrandVersion{Brand: "Google Chrome", Version: chromeVer},
                )
                meta.FullVersionList = append(meta.FullVersionList,
                        &emulation.UserAgentBrandVersion{Brand: "Chromium", Version: chromeVer + ".0.0.0"},
                        &emulation.UserAgentBrandVersion{Brand: "Google Chrome", Version: chromeVer + ".0.0.0"},
                )
                if edgeVer != "" {
                        meta.Brands = append(meta.Brands,
                                &emulation.UserAgentBrandVersion{Brand: "Microsoft Edge", Version: edgeVer},
                        )
                        meta.FullVersionList = append(meta.FullVersionList,
                                &emulation.UserAgentBrandVersion{Brand: "Microsoft Edge", Version: edgeVer + ".0.0.0"},
                        )
                }
        }
        // platform 从 UA 提取
        switch {
        case strings.Contains(ua, "Windows"):
                meta.Platform = "Windows"
                meta.PlatformVersion = "15.0.0"
                meta.Architecture = "x86"
        case strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X"):
                meta.Platform = "macOS"
                meta.PlatformVersion = "14.0.0"
                meta.Architecture = "arm"
        case strings.Contains(ua, "X11") || strings.Contains(ua, "Linux"):
                meta.Platform = "Linux"
                meta.PlatformVersion = "6.6.0"
                meta.Architecture = "x86"
        default:
                meta.Platform = "Windows"
                meta.PlatformVersion = "15.0.0"
                meta.Architecture = "x86"
        }
        return meta
}

// CF challenge 标志(与原 CF_CHALLENGE_MARKERS 同口径)
var cfChallengeRe = regexp.MustCompile(`(?i)challenge-platform|just a moment|cf-chl|cf_chl_|attention required|cf-turnstile|cf-browser-verification|checking your browser|正在進行安全驗證|正在驗證瀏覽器|正在验证浏览器|安全驗證`)

// 并发计数 + 全局 allocator
var (
        inFlight      int32
        allocCtx      context.Context
        allocCancel   context.CancelFunc
        allocMu       sync.Mutex
        allocInited   bool
)

// ensureAllocator — 懒构造全局 chromedp.NewExecAllocator(浏览器进程不立即启动,
//   chromedp 按需 fork 第一次 Run 时启动). 复用同一 allocator 避免每请求重新 fork.
func ensureAllocator() (context.Context, context.CancelFunc) {
        allocMu.Lock()
        defer allocMu.Unlock()
        if allocInited {
                return allocCtx, allocCancel
        }
        opts := append(chromedp.DefaultExecAllocatorOptions[:],
                chromedp.Flag("headless", "new"),                          // Chrome 132+ 推荐 headless=new
                chromedp.Flag("no-sandbox", true),                        // 沙箱关闭(容器 root 跑必备)
                chromedp.Flag("disable-setuid-sandbox", true),
                chromedp.Flag("disable-dev-shm-usage", true),             // 容器 /dev/shm 小兜底
                chromedp.Flag("disable-blink-features", "AutomationControlled"), // ★ 核心 stealth flag: 抹 navigator.webdriver
                chromedp.Flag("disable-features", "site-per-process,Translate,BlinkGenPropertyTrees,IsolateOrigins"),
                chromedp.Flag("disable-infobars", true),
                chromedp.Flag("disable-extensions", true),
                chromedp.Flag("disable-default-apps", true),
                chromedp.Flag("disable-popup-blocking", true),
                chromedp.Flag("disable-prompt-on-repost", true),
                chromedp.Flag("no-first-run", true),
                chromedp.Flag("no-default-browser-check", true),
                chromedp.Flag("disable-background-networking", true),
                chromedp.Flag("disable-client-side-phishing-detection", true),
                chromedp.Flag("disable-component-update", true),
                chromedp.Flag("disable-sync", true),
                chromedp.Flag("force-color-profile", "srgb"),
                chromedp.Flag("metrics-recording-only", true),
                chromedp.Flag("password-store", "basic"),
                chromedp.Flag("use-mock-keychain", true),
                chromedp.Flag("lang", "zh-CN"),
                chromedp.Flag("window-size", "1920,1080"),
                chromedp.Flag("user-agent", userAgents[rand.Intn(len(userAgents))]),
        )
        allocCtx, allocCancel = chromedp.NewExecAllocator(context.Background(), opts...)
        allocInited = true
        return allocCtx, allocCancel
}

// stealthScript — 注入到 page.addScriptToEvaluateOnNewDocument 的 JS, 抹平
//   puppeteer-extra-stealth 12 项 flags 中前 6 项 (navigator.webdriver / chrome
//   runtime / plugins / languages / WebGL vendor/renderer / permissions.query).
//   tier=lite 仅前 3 项; standard 加 WebGL/languages/permissions; maximum 加
//   hardwareConcurrency/deviceMemory/connection.
func stealthScript(tier StealthTier) string {
        base := `
(() => {
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true }); } catch(e) {}
  try { window.chrome = window.chrome || { runtime: {}, app: { isInstalled: false }, csi: () => {}, loadTimes: () => {} }; } catch(e) {}
  try {
    const fakePlugins = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ];
    Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins, configurable: true });
  } catch(e) {}
})();`
        if tier == TierLite {
                return base
        }
        standard := base + `
(() => {
  try {
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'], configurable: true });
    Object.defineProperty(navigator, 'language', { get: () => 'zh-CN', configurable: true });
  } catch(e) {}
  try {
    const orig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Google Inc. (Intel)';
      if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return orig.call(this, p);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const orig2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Google Inc. (Intel)';
        if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return orig2.call(this, p);
      };
    }
  } catch(e) {}
  try {
    const _orig = navigator.permissions.query;
    navigator.permissions.query = (params) => params && params.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : _orig.call(navigator.permissions, params);
  } catch(e) {}
})();`
        if tier == TierStandard {
                return standard
        }
        maximum := standard + `
(() => {
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true }); } catch(e) {}
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true }); } catch(e) {}
  try {
    Object.defineProperty(navigator, 'connection', {
      get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
      configurable: true,
    });
  } catch(e) {}
})();`
        return maximum
}

func handle(w http.ResponseWriter, r *http.Request) {
        // 兼容 /render (新) + /fetch (旧契约 alias)
        if r.Method != http.MethodPost ||
                (r.URL.Path != "/render" && r.URL.Path != "/fetch") {
                bridgeserver.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "not found"})
                return
        }
        // 并发上限(超出返回 503 引擎侧降级)
        if cur := atomic.AddInt32(&inFlight, 1); cur > cbMaxConcurrent {
                atomic.AddInt32(&inFlight, -1)
                bridgeserver.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{
                        "ok":    false,
                        "error": fmt.Sprintf("并发已满 (%d/%d)", cur-1, cbMaxConcurrent),
                        "code":  "CONCURRENCY_LIMIT",
                })
                return
        }
        defer atomic.AddInt32(&inFlight, -1)

        raw, err := bridgeserver.ReadBodyCapped(r, cbMaxRequestBytes)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, renderResult{OK: false, Error: err.Error()})
                return
        }
        var body renderBody
        if err := json.Unmarshal(raw, &body); err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, renderResult{OK: false, Error: "请求体非 JSON: " + bridgeserver.SanitizeError(err)})
                return
        }
        u := body.URL
        if !bridgeserver.HTTPURLRe.MatchString(u) || len(u) > 8192 {
                bridgeserver.WriteJSON(w, http.StatusOK, renderResult{OK: false, Error: "url 缺失或非 http/https"})
                return
        }
        // SSRF 守卫
        ok, reason := bridgeserver.AssertSafeSsrfTarget(u, ssrfAllowLB)
        if !ok {
                fmt.Printf("[cloak-browser] SSRF 拒绝 %s: %s\n", bridgeserver.SafeHostPath(u), reason)
                bridgeserver.WriteJSON(w, http.StatusOK, renderResult{OK: false, Error: "SSRF blocked: " + reason})
                return
        }
        // 超时(钳制 5s ~ 120s)
        timeoutMs := body.TimeoutMs
        if timeoutMs <= 0 {
                timeoutMs = 30_000
        }
        if timeoutMs < 5000 {
                timeoutMs = 5000
        }
        if timeoutMs > cbMaxTimeoutMs {
                timeoutMs = cbMaxTimeoutMs
        }
        // waitUntil
        waitUntil := strings.ToLower(body.WaitUntil)
        if waitUntil == "" {
                waitUntil = "domcontentloaded"
        }
        // stealth tier
        tier := TierStandard
        switch strings.ToLower(body.StealthTier) {
        case "lite":
                tier = TierLite
        case "maximum":
                tier = TierMaximum
        }

        started := time.Now()
        result, ferr := fetchPage(r.Context(), u, body.Actions, timeoutMs, waitUntil, body.Screenshot, tier)
        if ferr != nil {
                fmt.Printf("[cloak-browser] FAIL %s tier=%s (%dms): %s\n",
                        bridgeserver.SafeHostPath(u), tier, time.Since(started).Milliseconds(), bridgeserver.SanitizeError(ferr))
                bridgeserver.WriteJSON(w, http.StatusOK, renderResult{OK: false, Error: bridgeserver.SanitizeError(ferr)})
                return
        }
        if !result.OK {
                fmt.Printf("[cloak-browser] EMPTY %s tier=%s status=%d html=%dB (%dms)\n",
                        bridgeserver.SafeHostPath(u), tier, result.Status, len(result.HTML), time.Since(started).Milliseconds())
        } else {
                fmt.Printf("[cloak-browser] OK %s tier=%s status=%d html=%dB (%dms)\n",
                        bridgeserver.SafeHostPath(u), tier, result.Status, len(result.HTML), time.Since(started).Milliseconds())
        }
        bridgeserver.WriteJSON(w, http.StatusOK, result)
}

// fetchPage — 浏览器渲染主流程: navigate → (CF challenge 等待) → actions → screenshot → cookies
func fetchPage(parent context.Context, targetURL string, actions []renderAction, timeoutMs int, waitUntil string, wantScreenshot bool, tier StealthTier) (*renderResult, error) {
        allocCtx, _ := ensureAllocator()
        // 每请求独立 ctx (任务级超时), allocator 复用全局
        ctx, cancel := context.WithTimeout(allocCtx, time.Duration(timeoutMs)*time.Millisecond)
        defer cancel()

        browserCtx, cancelBrowser := chromedp.NewContext(ctx)
        defer cancelBrowser()

        // 随机 UA + 隐身脚本注入 (Page.addScriptToEvaluateOnNewDocument)
        // R44-1C 修复: 原实现 chromedp.Evaluate(fmt.Sprintf(`(%s)()`, script), nil) 有两 bug:
        //   1) (script)() 包裹多 IIFE 段为单一表达式调用 = JS 语法错 (语句以 ; 分隔不能入 ()).
        //      stealthScript 返回多个 (() => {...})(); 块, 包在 (...) 后调用 () 是 SyntaxError.
        //   2) chromedp.Evaluate 只在当前文档 (about:blank) 执行, 导航后上下文销毁, 
        //      真实页面未注入 stealth JS. 注释声称 "在每个新文档前执行" 但 API 用错.
        // 修复: 改用 page.AddScriptToEvaluateOnNewDocument (CDP Page 域) — 脚本在每个新文档
        //   加载前自动执行, 跨导航持久. 直接传 script 原文 (无包裹), 多 IIFE 语句被 V8 视为
        //   程序顶层语句序列, 合法执行.
        ua := userAgents[rand.Intn(len(userAgents))]
        // R45-1A: stealth 注入错误不静默 (原 _ = chromedp.Run 让注入失败不可见, 仅靠
        //   flags 兜底, WAF 站点会顺剩被识别). 失败时记日志供运维 debug.
        if err := chromedp.Run(browserCtx,
                network.Enable(),
                emulation.SetUserAgentOverride(ua).WithUserAgentMetadata(userAgentMeta(ua)),
                // stealth 脚本注入到 Page.addScriptToEvaluateOnNewDocument (每个新文档前执行, 跨导航持久)
                chromedp.ActionFunc(func(ctx context.Context) error {
                        _, err := page.AddScriptToEvaluateOnNewDocument(stealthScript(tier)).Do(ctx)
                        return err
                }),
        ); err != nil {
                fmt.Printf("[cloak-browser] stealth injection failed (continuing with flags only): %s\n", bridgeserver.SanitizeError(err))
        }

        // 导航 + actions + 抓 HTML + screenshot
        var htmlStr string
        var screenshotBuf []byte
        runActions := []chromedp.Action{
                chromedp.Navigate(targetURL),
                chromedp.WaitReady(`body`, chromedp.ByQuery),
        }
        // R45-1A: 行为模拟 (人类象同鼠标/滚动/停顿). chromedp flags + stealth 桩注入后,
        //   反爬 WAF 仍会看鼠标轨迹/滚动节奏/点击间隔. 加随机鼠标移动 + 滚动 + 停顿,
        //   让流量看上去更像真实用户 (任务要求 3: 行为模拟 chromedp 鼠标/滚动/点击).
        //   放在 WaitReady 之后, 用户定义 actions 之前, 不干扰用户 actions.
        runActions = append(runActions, simulateHumanBehaviorActions()...)
        // actions 执行
        for _, a := range actions {
                switch strings.ToLower(a.Type) {
                case "click":
                        if a.Selector != "" {
                                runActions = append(runActions, chromedp.Click(a.Selector, chromedp.ByQuery))
                        }
                case "wait":
                        if a.Selector != "" {
                                runActions = append(runActions, chromedp.WaitVisible(a.Selector, chromedp.ByQuery))
                        }
                case "input":
                        if a.Selector != "" && a.Value != "" {
                                runActions = append(runActions, chromedp.SendKeys(a.Selector, a.Value, chromedp.ByQuery))
                        }
                case "scroll":
                        if a.Selector != "" {
                                runActions = append(runActions, chromedp.ScrollIntoView(a.Selector, chromedp.ByQuery))
                        } else {
                                runActions = append(runActions, chromedp.Evaluate(`window.scrollTo(0, document.body.scrollHeight)`, nil))
                        }
                case "sleep":
                        d := time.Duration(a.WaitMs) * time.Millisecond
                        if d <= 0 {
                                d = 1 * time.Second
                        }
                        runActions = append(runActions, chromedp.Sleep(d))
                case "eval":
                        if a.Value != "" {
                                runActions = append(runActions, chromedp.Evaluate(a.Value, nil))
                        }
                }
        }
        // 抓全 HTML (document.documentElement.outerHTML)
        runActions = append(runActions, chromedp.Evaluate(`document.documentElement.outerHTML`, &htmlStr))
        // 截图
        if wantScreenshot {
                runActions = append(runActions, chromedp.CaptureScreenshot(&screenshotBuf))
        }
        // status 取自 RunResponse 的 network.Response — chromedp.Run 不返回 response, 这里
        // 单独跑一次 RunResponse 取状态 (避免多次 navigate; RunResponse 内部即 navigate).
        resp, navErr := chromedp.RunResponse(browserCtx, runActions...)
        if navErr != nil {
                // 浏览器导航失败: 尝试取已有 HTML (页面可能半渲染)
                _ = chromedp.Run(browserCtx, chromedp.Evaluate(`document.documentElement.outerHTML`, &htmlStr))
                return &renderResult{
                        OK:       len(htmlStr) > 100,
                        HTML:     htmlStr,
                        Status:   0,
                        FinalURL: targetURL,
                        Cookies:  []map[string]any{},
                        Error:    bridgeserver.SanitizeError(navErr),
                }, nil
        }
        var status int64
        if resp != nil {
                status = int64(resp.Status)
        }

        // CF challenge 检测: 若 HTML 命中 challenge 标志, 等 30s 自动放行
        if cfChallengeRe.MatchString(htmlStr) {
                fmt.Printf("[cloak-browser] CF challenge detected, waiting up to 30s for clearance\n")
                cleared := waitCfChallenge(browserCtx, 30*time.Second)
                if cleared {
                        _ = chromedp.Run(browserCtx, chromedp.Evaluate(`document.documentElement.outerHTML`, &htmlStr))
                        if resp != nil {
                                status = 200 // challenge 放行后状态归 200
                        }
                }
        }

        // cookies 抓取 (page.cookies 等价)
        cookies := []map[string]any{}
        cookieParams, _ := network.GetCookies().Do(browserCtx)
        for _, c := range cookieParams {
                cookies = append(cookies, map[string]any{
                        "name":    c.Name,
                        "value":   c.Value,
                        "domain":  c.Domain,
                        "path":    c.Path,
                        "secure":  c.Secure,
                        "expires": c.Expires,
                })
        }

        // final URL (重定向后)
        var finalURL string
        _ = chromedp.Run(browserCtx, chromedp.Evaluate(`location.href`, &finalURL))
        if finalURL == "" {
                finalURL = targetURL
        }

        // 响应体上限校验
        // R45-1A 修复: 原 htmlStr[:cbMaxBodyBytes] 按字节切片, 中文/emoji (3-4 byte/rune)
        //   在边界处会斩半留下非法 UTF-8 (孤立 continuation byte), 下游 JSON 序列化 /
        //   parser 解析会乱码. 改用 utf8ValidTruncate 找安全 rune 边界 (回退到上一个
        //   rune 起始 byte, 保证切片是合法 UTF-8).
        if len(htmlStr) > cbMaxBodyBytes {
                htmlStr = utf8ValidTruncate(htmlStr, cbMaxBodyBytes)
        }

        result := &renderResult{
                OK:       len(htmlStr) > 100,
                HTML:     htmlStr,
                Status:   int(status),
                FinalURL: finalURL,
                Cookies:  cookies,
        }
        if wantScreenshot && len(screenshotBuf) > 0 {
                result.ScreenshotB64 = base64.StdEncoding.EncodeToString(screenshotBuf)
        }
        return result, nil
}

// waitCfChallenge — 等 CF challenge 自动放行, 最长 maxMs, 期间每 2s 取 HTML 检查
//   challenge 标志消失. 与原 puppeteer waitCfChallenge 同口径 (Turnstile checkbox
//   点击不实现 — chromedp 跨 frame 点击 Turnstile checkbox 极易卡, Go 端简化为等待).
func waitCfChallenge(ctx context.Context, max time.Duration) bool {
        start := time.Now()
        ticker := time.NewTicker(2 * time.Second)
        defer ticker.Stop()
        for time.Since(start) < max {
                select {
                case <-ctx.Done():
                        return false
                case <-ticker.C:
                        var htmlStr string
                        if err := chromedp.Run(ctx, chromedp.Evaluate(`document.documentElement.outerHTML`, &htmlStr)); err != nil {
                                continue
                        }
                        if !cfChallengeRe.MatchString(htmlStr) {
                                return true
                        }
                }
        }
        return false
}

// safeHostPath — 已于 R45-1C 抽到 bridgeserver.SafeHostPath.

// utf8ValidTruncate — 截断字符串到 max 字节, 回退到最近的 UTF-8 rune 边界.
// R45-1A: 防 cbMaxBodyBytes 字节切片斩半中文 (3-byte UTF-8) / emoji (4-byte).
// 走 rune 解码, 累加 byte 长度, 下一个 rune 会超 max 则停. 返回的切片合法 UTF-8.
func utf8ValidTruncate(s string, max int) string {
        if max <= 0 {
                return ""
        }
        if len(s) <= max {
                return s
        }
        end := 0
        for end < len(s) {
                _, size := utf8.DecodeRuneInString(s[end:])
                if end+size > max {
                        break
                }
                end += size
        }
        return s[:end]
}

// simulateHumanBehaviorActions — 生成行为模拟 chromedp actions (任务要求 3).
// R45-1A: 反爬 WAF (Cloudflare Bot Management / Akamai / DataDome) 会分析鼠标轨迹
//   / 滚动节奏 / 点击间隔, chromedp 默认无任何鼠标活动 → 立即被识别为自动化.
//   本函数生成 3 个 actions:
//   1. 随机滚动到页面中段 (模拟用户向下浏览)
//   2. 随机鼠标移动到 viewport 内随机点 (input.dispatchMouseEvent mouseMoved)
//   3. 短停顿 200-500ms (模拟用户阅读节奏)
//   每次随机, 避免轨迹完全一致被识别.
// R47-1A 反反爬增强 (任务要求 5: 行为模拟增强):
//   - 鼠标移动改用 CDP input.DispatchMouseEvent(MouseMoved, x, y) — 原 JS-level
//     MouseEvent('mousemove') 的 isTrusted=false, WAF (Cloudflare Bot Management
//     / Akamai Bot Detection) 检测 isTrusted=false 直接判 bot. CDP-native 事件
//     isTrusted=true, 与真实用户事件无差异.
//   - 多步鼠标轨迹 (Bezier 曲线插值 5-8 个中间点): 原 1 个 mouseMoved 太突兀,
//     真实用户鼠标移动是连续轨迹 (通过数百个 mousemove 事件). WAF 检测 "单次
//     mousemove 后立即 click" 是自动化特征. 改为 Bezier 曲线 5-8 个中间点 +
//     每点 50-150ms 延迟, 模拟真实轨迹.
//   - 多步滚动 (3 段滚动 + 间隔): 原 scrollTo 一次到位是机器人特征. 改为 3 段
//     scrollBy + 间隔 200-500ms, 模拟用户连续滚动.
//   - 随机停顿 (300-800ms 总, 分 2-3 段): 真实用户阅读节奏不固定, 模拟多段
//     阅读停顿.
// R48-1A 反反爬增强 (任务要求 5: 行为模拟增强):
//   - 每步 Bezier 点加 ±2-3px 微抖 (physiological tremor) — 真实用户鼠标有
//     1-3px 生理抖动, 完美平滑 Bezier 曲线被 WAF 检测为 "数学轨迹 = 自动化".
//     微抖让轨迹更接近真实用户.
//   - 段间延迟改 bell curve (start/end 慢, 中段快) — 真实用户鼠标移动是
//     "起步慢 → 加速 → 减速 → 停" 模式 (Fitts's law). 原 50-150ms 均匀分布
//     被检测为 "匀速 = 自动化". bell curve 让中段 30-80ms 快, 两端 80-150ms 慢.
//   - 轨迹起点 hover phase (200-400ms 短停顿) — 真实用户从静止到移动有 ~200ms
//     反应时间. 直接开始 Bezier 移动被检测为 "无反应时间 = 自动化".
//   - 30% 概率轨迹末 click (input.DispatchMouseEvent mousePressed/Released) —
//     真实用户常在 mousemove 后 click 目标. 纯 mousemove 无 click 被检测为
//     "无目标 = 自动化". click 后 100-300ms 短停顿 (用户阅读点击结果).
// R50-1A 反反爬增强 (任务要求 5: 行为模拟继续增强):
//   - Gaussian 微抖 (Box-Muller via rand.NormFloat64, stddev=1.5px) — 替代原
//     均匀分布 ±3px. 真实生理抖动是 Gaussian 分布 (95% 在 ±3px 内, 5% 偶发
//     ±4-5px), 均匀分布让所有抖动等概率 (不真实, WAF 通过抖动分布识别自动化).
//   - 滚轮 micro-events (5-15px deltaY 小步滚动插入主滚动间) — 真实用户滚动
//     不是平滑大段, 是 wheel 事件连续触发 (每 wheel ~50-100px, 中间有 micro
//     暂停). 原 scrollBy 一次大段被检测为 "JS 调用 = 自动化", 改用多次小 deltaY.
//   - 15% 概率 Tab 键 focus 切换 (chromedp.KeyEvent "\t") — 真实用户会用 Tab
//     键在 focusable 元素间切换. 纯 mousemove 无 keyboard 被检测为 "无键盘
//     = 自动化". Tab 后 200-500ms 短停顿 (用户视觉确认 focus 切换结果).
func simulateHumanBehaviorActions() []chromedp.Action {
        actions := []chromedp.Action{}
        // 1. 多步滚动 (3 段 scrollBy + 间隔, 模拟用户连续滚动)
        //   R50-1A: 每段主滚动后插入 2-4 个 micro wheel events (5-15px 小 deltaY),
        //   模拟真实用户 wheel 事件连续触发 (不是一次大段 JS 调用).
        scrollSegments := 2 + rand.Intn(2) // 2..3 段
        for i := 0; i < scrollSegments; i++ {
                // 每段滚动 viewport 的 15-35%
                scrollPct := 15 + rand.Intn(21) // 15..35
                scrollJS := fmt.Sprintf(
                        `window.scrollBy({top: Math.floor(window.innerHeight * %d / 100), behavior: 'smooth'});`,
                        scrollPct,
                )
                actions = append(actions, chromedp.Evaluate(scrollJS, nil))
                // 段间停顿 200-500ms
                segSleepMs := 200 + rand.Intn(301)
                actions = append(actions, chromedp.Sleep(time.Duration(segSleepMs)*time.Millisecond))
                // R50-1A: 插入 2-4 个 micro wheel events (5-15px 小 deltaY, 模拟真实
                //   wheel 事件连续触发). 原 scrollBy 一次大段被检测为 "JS 调用 =
                //   自动化". micro wheel events 让滚动节奏更接近真实用户.
                microSteps := 2 + rand.Intn(3) // 2..4 步
                for j := 0; j < microSteps; j++ {
                        microDelta := 5 + rand.Intn(11) // 5..15 px
                        microJS := fmt.Sprintf(`window.scrollBy(0, %d);`, microDelta)
                        actions = append(actions, chromedp.Evaluate(microJS, nil))
                        // micro 间隔 30-80ms (真实 wheel 事件间隔)
                        microSleepMs := 30 + rand.Intn(51)
                        actions = append(actions, chromedp.Sleep(time.Duration(microSleepMs)*time.Millisecond))
                }
        }
        // 2. 多步鼠标轨迹 (Bezier 曲线 5-8 个中间点, CDP input.DispatchMouseEvent)
        //   起点 + 终点 + 1 个控制点 (Quadratic Bezier) → 沿曲线插值
        startX := 100 + rand.Intn(800)  // 100..900
        startY := 100 + rand.Intn(500)  // 100..600
        endX := 100 + rand.Intn(800)
        endY := 100 + rand.Intn(500)
        // 控制点 (偏离直线 50-150px, 模拟鼠标微抖)
        ctrlOffsetX := 50 + rand.Intn(101)
        if rand.Intn(2) == 0 {
                ctrlOffsetX = -ctrlOffsetX
        }
        ctrlOffsetY := 50 + rand.Intn(101)
        if rand.Intn(2) == 0 {
                ctrlOffsetY = -ctrlOffsetY
        }
        midX := (startX + endX) / 2
        midY := (startY + endY) / 2
        ctrlX := midX + ctrlOffsetX
        ctrlY := midY + ctrlOffsetY
        // 限制在 viewport 内 (1920x1080)
        if ctrlX < 50 {
                ctrlX = 50
        }
        if ctrlX > 1870 {
                ctrlX = 1870
        }
        if ctrlY < 50 {
                ctrlY = 50
        }
        if ctrlY > 1030 {
                ctrlY = 1030
        }
        // R48-1A: 轨迹起点 hover phase (200-400ms 短停顿, 模拟用户反应时间)
        //   原实现直接开始 Bezier 移动, 被检测为 "无反应时间 = 自动化".
        //   加 hover phase 让 mousemove 起步更真实.
        hoverMs := 200 + rand.Intn(201)
        actions = append(actions, chromedp.Sleep(time.Duration(hoverMs)*time.Millisecond))
        // 先 mouseMoved 到起点 (起始位置), 再开始 Bezier 轨迹
        startXf := float64(startX)
        startYf := float64(startY)
        actions = append(actions, chromedp.ActionFunc(func(ctx context.Context) error {
                return input.DispatchMouseEvent(input.MouseMoved, startXf, startYf).Do(ctx)
        }))
        actions = append(actions, chromedp.Sleep(time.Duration(80+rand.Intn(80))*time.Millisecond))
        steps := 5 + rand.Intn(4) // 5..8 步
        // R48-1A: 30% 概率轨迹末 click (真实用户常 click 目标)
        willClick := rand.Intn(10) < 3
        for i := 1; i <= steps; i++ {
                t := float64(i) / float64(steps)
                // Quadratic Bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
                // R47-1A: 闭包捕获 xVal/yVal (Go 1.22+ 循环变量 per-iteration 安全)
                xVal := (1-t)*(1-t)*float64(startX) + 2*(1-t)*t*float64(ctrlX) + t*t*float64(endX)
                yVal := (1-t)*(1-t)*float64(startY) + 2*(1-t)*t*float64(ctrlY) + t*t*float64(endY)
                // R48-1A: 每步加 ±2-3px 微抖 (physiological tremor)
                //   真实用户鼠标有 1-3px 生理抖动, 完美平滑 Bezier 被检测为
                //   "数学轨迹 = 自动化". 微抖让轨迹更接近真实用户.
                // R50-1A: Gaussian 微抖替代均匀分布 (rand.NormFloat64, stddev=1.5).
                //   真实生理抖动是 Gaussian 分布 (95% 在 ±3px 内, 5% 偶发 ±4-5px),
                //   均匀分布让所有抖动等概率 (不真实, WAF 通过抖动分布识别自动化).
                //   Gaussian 让抖动分布更接近真实用户.
                jitterX := rand.NormFloat64() * 1.5 // mean=0, stddev=1.5px (95% 在 ±3px 内)
                jitterY := rand.NormFloat64() * 1.5
                xVal += jitterX
                yVal += jitterY
                // R48-1A: CDP-native input.DispatchMouseEvent(MouseMoved, x, y)
                //   isTrusted=true, 与真实用户事件无差异. 原 JS MouseEvent 的
                //   isTrusted=false 被 Cloudflare Bot Management 等 WAF 检测为 bot.
                actions = append(actions, chromedp.ActionFunc(func(ctx context.Context) error {
                        return input.DispatchMouseEvent(input.MouseMoved, xVal, yVal).Do(ctx)
                }))
                // R48-1A: 段间延迟改 bell curve (start/end 慢 80-150ms, 中段快 30-80ms)
                //   真实用户鼠标移动是 "起步慢 → 加速 → 减速 → 停" 模式 (Fitts's law).
                //   原 50-150ms 均匀分布被检测为 "匀速 = 自动化".
                //   bell curve: t∈(0,1), delay = base + 70 * (2t-1)^2 (start/end 慢, 中段快)
                //   base=30ms, max=30+70=100ms (中段) → 30+70=100ms (两端)
                //   实际值: t=0.5 → 30ms (中段快), t=0/1 → 100ms (两端慢)
                bellDelay := 30.0 + 70.0*(2*t-1)*(2*t-1)
                if bellDelay < 30 {
                        bellDelay = 30
                }
                if bellDelay > 150 {
                        bellDelay = 150
                }
                // 加 ±20ms 随机扰动避免完全确定性
                stepSleepMs := int(bellDelay) + rand.Intn(41) - 20
                if stepSleepMs < 20 {
                        stepSleepMs = 20
                }
                actions = append(actions, chromedp.Sleep(time.Duration(stepSleepMs)*time.Millisecond))
        }
        // R48-1A: 30% 概率轨迹末 click (mousePressed + mouseReleased)
        //   真实用户常在 mousemove 后 click 目标. 纯 mousemove 无 click 被检测为
        //   "无目标 = 自动化". click 间隔 50-150ms (press → release).
        if willClick {
                clickX := float64(endX)
                clickY := float64(endY)
                // mousePressed
                actions = append(actions, chromedp.ActionFunc(func(ctx context.Context) error {
                        return input.DispatchMouseEvent(input.MousePressed, clickX, clickY).
                                WithButton(input.Left).WithClickCount(1).Do(ctx)
                }))
                // press → release 间隔 50-150ms (真实用户 press-release 时间)
                actions = append(actions, chromedp.Sleep(time.Duration(50+rand.Intn(101))*time.Millisecond))
                // mouseReleased
                actions = append(actions, chromedp.ActionFunc(func(ctx context.Context) error {
                        return input.DispatchMouseEvent(input.MouseReleased, clickX, clickY).
                                WithButton(input.Left).WithClickCount(1).Do(ctx)
                }))
                // click 后阅读停顿 100-300ms
                actions = append(actions, chromedp.Sleep(time.Duration(100+rand.Intn(201))*time.Millisecond))
        }
        // 3. 随机停顿 300-800ms (模拟用户阅读节奏, 总停顿分散在 2 段)
        pauseSegments := 1 + rand.Intn(2) // 1..2 段
        for i := 0; i < pauseSegments; i++ {
                pauseMs := 150 + rand.Intn(301) // 150..450ms 每段
                actions = append(actions, chromedp.Sleep(time.Duration(pauseMs)*time.Millisecond))
        }
        // R50-1A: 15% 概率 Tab 键 focus 切换 (chromedp.KeyEvent "\t")
        //   真实用户会用 Tab 键在 focusable 元素间切换 (links / buttons / inputs).
        //   纯 mousemove 无 keyboard 被检测为 "无键盘 = 自动化". Tab 后 200-500ms
        //   短停顿 (用户视觉确认 focus 切换结果).
        if rand.Intn(100) < 15 { // 15% 概率
                actions = append(actions, chromedp.KeyEvent("\t"))
                tabSleepMs := 200 + rand.Intn(301) // 200..500ms
                actions = append(actions, chromedp.Sleep(time.Duration(tabSleepMs)*time.Millisecond))
        }
        return actions
}

func main() {
        // 进程启动时初始化 allocator (浏览器进程按需 fork, 此处仅注册 flags)
        ensureAllocator()
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:             "cloak-browser",
                Port:             PORT,
                Version:          "1.0.0-go",
                IdleTimeoutS:     cbIdleTimeoutS,
                RequestTimeoutMs: 30_000, // /health /metrics /info 走 30s 帽, /render /fetch 内部自管 timeoutMs
                RateLimitPerMin:  bridgeserver.EnvInt("RATE_LIMIT_PER_MIN", 30),
                EnableSsrfCheck:  true,
                SelfTest: func() bool {
                        // 检测 chrome 二进制是否在 PATH (allocator 会在第一次 Run 时启动浏览器)
                        // 若不在 PATH, 返回 false 让 /health 报告 selfTestOk=false 引擎侧跳过该级降级
                        // 不实际启动浏览器 (selfTest 只跑 chrome --version, 2s 内完成)
                        allocCtx, cancel := chromedp.NewContext(ensureAllocatorCtx())
                        defer cancel()
                        tctx, tcancel := context.WithTimeout(allocCtx, 5*time.Second)
                        defer tcancel()
                        var title string
                        err := chromedp.Run(tctx,
                                chromedp.Navigate("about:blank"),
                                chromedp.Title(&title),
                        )
                        return err == nil
                },
                Handler: handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "endpoints":         []string{"GET /health", "GET /metrics", "GET /info", "POST /render", "POST /fetch"},
                                "maxConcurrent":      cbMaxConcurrent,
                                "maxRequestBytes":   cbMaxRequestBytes,
                                "maxBodyBytes":       cbMaxBodyBytes,
                                "maxTimeoutMs":       cbMaxTimeoutMs,
                                "stealthTiers":       []string{"lite", "standard", "maximum"},
                                "waitUntil":          []string{"load", "domcontentloaded", "networkidle"},
                                "actionTypes":        []string{"click", "wait", "input", "scroll", "sleep", "eval"},
                                "ssrfAllowLoopback":   ssrfAllowLB,
                                "backend":            "chromedp (Chrome DevTools Protocol Go 实现)",
                                "stealthFlags": []string{
                                        "--disable-blink-features=AutomationControlled (navigator.webdriver=undefined)",
                                        "CDP network.SetUserAgentOverride + UA metadata (brand/platform/bit)",
                                        "--lang=zh-CN, --window-size=1920,1080",
                                        "stealth JS 注入: chrome runtime / plugins / languages / WebGL / permissions (standard+)",
                                        "stealth JS 注入: hardwareConcurrency / deviceMemory / connection (maximum)",
                                },
                                "note": "Go 重写, 取代 puppeteer-extra-stealth bun 栈 (R43-1A)",
                        }, nil
                },
        })
        bs.ListenAndServe()
}

// ensureAllocatorCtx — 取全局 allocator ctx (供 selfTest 创建 browser ctx).
func ensureAllocatorCtx() context.Context {
        ctx, _ := ensureAllocator()
        return ctx
}
