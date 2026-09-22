// curl-impersonate-bridge — TLS 指纹模拟 HTTP 桥 (Go 重写, R43-1A).
//
// 与 Python 端 mini-services/curl-impersonate-bridge/server.py 同口径:
//   场景: 引擎 fetcher.ts 在原生 net/http 被 Cloudflare / Akamai / DataDome 等
//   WAF 按 TLS ClientHello JA3/JA4 hash 拦截时(即便 UA + Client Hints + Sec-Fetch-*
//   头组自洽, TLS 握手阶段就被 403), 调本桥以 utls 模拟 Chrome/Firefox/Safari 的
//   真实 TLS 指纹 (GREASE 扩展 + Chrome cipher suite 顺序 + X25519Kyber768Draft00
//   curve) 绕过. R42-1B 已在 fetcher.go 内联 utls fallback 链; 本桥作为可选 opt-in
//   通道, 供 fetchMode='curl-impersonate' 显式调用.
//
// 实现: 用 utls.UClient 替代 crypto/tls.Client 做 DialTLS. utls HelloChrome_Auto /
//   HelloFirefox_Auto / HelloSafari_Auto 三档对应 Python curl_cffi impersonate 参数.
//   HTTP/2 因 ALPN 协商差异默认关闭 (chrome 站点大多 HTTP/1.1). http.Transport
//   连接池正常复用 utls 连接.
//
// 协议:
//   GET  /health → { ok, service, port, ts, utlsVersion, impersonates }
//   POST /fetch   body: { url, headers?: map, proxy?, timeoutMs?, impersonate? }
//                 → 200 { ok:true, status, headers:[[k,v]], setCookie:[], bodyB64 }
//                    (目标侧所有响应 —— 含 3xx 跟随后终态 / 4xx / 5xx —— 均忠实转发为
//                     ok:true 信封, 仅传输层语义; 引擎侧不再对目标双发请求)
//                 → 200 { ok:false, error }  桥内异常(url 非法 / 网络层失败 / 超时 /
//                   代理协议不支持 / SSRF 拒绝), 引擎侧据此降级下一级
//
// 安全: hostname 钉 127.0.0.1; url 仅 http/https 且限长 8KB; 请求头键经 RFC 7230 token
//       白名单过滤、值剥 CR/LF/NUL(与引擎 safeHeaderKey/safeSingleLine 同向); 响应体上限
//       20MB(base64 膨胀 ~33%, 实际目标响应 ≤15MB); 超时上限 30s; AUTH_TOKEN/BRIDGE_KEY
//       鉴权 + 60/min/IP 限速 + 安全响应头; SSRF 守卫(默认拒 localhost/私网/链路本地/
//       元数据端点, BRIDGE_SSRF_ALLOW_LOOPBACK=1 放行 127.0.0.1/::1 供回环测试).
//
// 启动: cd go-backend/services/curl-impersonate-bridge && go run . (端口固定 3018)
package main

import (
        "context"
        "crypto/tls"
        "encoding/base64"
        "encoding/json"
        "fmt"
        "net"
        "net/http"
        "net/url"
        "os"
        "strings"
        "time"

        utls "github.com/refraction-networking/utls"
        "golang.org/x/net/proxy"

        "heis-backend/services/bridgeserver"
)

const PORT = 3018

const (
        impMaxBodyBytes    = 20 * 1024 * 1024 // 20MB 目标响应体上限(与 fetch-relay 同口径)
        impMaxRequestBytes = 1 * 1024 * 1024 // 1MB POST 体上限
        impMaxTimeoutMs    = 30_000           // 30s 硬帽(任务要求)
        impIdleTimeoutS    = 200              // 覆盖 30s 上游超时 + 20MB base64 重组开销
)

var ssrfAllowLB = os.Getenv("BRIDGE_SSRF_ALLOW_LOOPBACK") == "1"

// ImpersonateProfile — 把请求 impersonate 字段映射到 utls ClientHelloID.
//   chrome*  → HelloChrome_Auto  (Chrome 最新指纹 + GREASE + X25519Kyber768Draft00)
//   firefox* → HelloFirefox_Auto (Firefox 最新指纹)
//   safari*  → HelloSafari_Auto  (Safari 最新指纹)
//   edge     → HelloChrome_Auto  (Edge 与 Chrome 同 TLS 栈)
//   空/未知  → HelloChrome_Auto  (Chrome 占 ~70% 市场份额, 默认档)
func ImpersonateProfile(name string) utls.ClientHelloID {
        switch {
        case name == "":
                return utls.HelloChrome_Auto
        case strings.HasPrefix(strings.ToLower(name), "chrome"):
                return utls.HelloChrome_Auto
        case strings.HasPrefix(strings.ToLower(name), "firefox"):
                return utls.HelloFirefox_Auto
        case strings.HasPrefix(strings.ToLower(name), "safari"):
                return utls.HelloSafari_Auto
        case strings.HasPrefix(strings.ToLower(name), "edge"):
                return utls.HelloChrome_Auto // Edge 与 Chrome 同 BoringSSL 栈
        case strings.HasPrefix(strings.ToLower(name), "ios"):
                return utls.HelloIOS_Auto
        case strings.HasPrefix(strings.ToLower(name), "random"):
                return utls.HelloRandomized
        default:
                return utls.HelloChrome_Auto
        }
}

// impersonates — /health 与 /info 暴露给运维的可识别 profile 列表(供引擎侧
// checkCurlImpersonateBridge 决定是否走该级降级). 注意: utls 不要求客户端传精确版本号,
// HelloChrome_Auto 内部解析为最新 Chrome 指纹(与 curl_cffi 的 chrome120 同语义).
var impersonates = []string{
        "chrome", "chrome_auto", "chrome_latest",
        "firefox", "firefox_auto", "firefox_latest",
        "safari", "safari_auto", "safari_latest",
        "edge", "edge_auto",
        "ios", "ios_auto",
        "random",
}

// fetchBody — POST /fetch 请求体.
type fetchBody struct {
        URL          string            `json:"url"`
        Headers      map[string]string `json:"headers"`
        Proxy        string            `json:"proxy"`
        TimeoutMs    int               `json:"timeoutMs"`
        Impersonate  string            `json:"impersonate"`
        Method       string            `json:"method"`
}

func handle(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path != "/fetch" || r.Method != http.MethodPost {
                bridgeserver.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "not found"})
                return
        }
        raw, err := bridgeserver.ReadBodyCapped(r, impMaxRequestBytes)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
                return
        }
        var body fetchBody
        if err := json.Unmarshal(raw, &body); err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "请求体非 JSON: " + bridgeserver.SanitizeError(err)})
                return
        }
        u := body.URL
        if !bridgeserver.HTTPURLRe.MatchString(u) || len(u) > 8192 {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "url 缺失或非 http/https"})
                return
        }
        // SSRF 守卫
        ok, reason := bridgeserver.AssertSafeSsrfTarget(u, ssrfAllowLB)
        if !ok {
                fmt.Printf("[curl-impersonate-bridge] SSRF 拒绝 %s: %s\n", bridgeserver.SafeHostPath(u), reason)
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "SSRF blocked: " + reason})
                return
        }
        // 代理形态校验
        proxyURL := body.Proxy
        if proxyURL != "" {
                if len(proxyURL) > 500 {
                        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "proxy 形态非法(超长)"})
                        return
                }
                if pErr := bridgeserver.SsrfCheckProxy(proxyURL, ssrfAllowLB); pErr != "" {
                        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": pErr})
                        return
                }
        }
        // 超时(钳制 2s ~ 30s)
        timeoutMs := body.TimeoutMs
        if timeoutMs <= 0 {
                timeoutMs = 20_000
        }
        if timeoutMs < 2000 {
                timeoutMs = 2000
        }
        if timeoutMs > impMaxTimeoutMs {
                timeoutMs = impMaxTimeoutMs
        }
        // 方法(GET/HEAD; 其他一律 GET — 与 fetch-relay 同口径, 引擎调用本桥只为
        // GET 章节正文/列表 HTML, 不发 POST)
        rawMethod := strings.ToUpper(body.Method)
        upstreamMethod := http.MethodGet
        if rawMethod == http.MethodHead {
                upstreamMethod = http.MethodHead
        }

        // 组装请求头(经安全名单过滤)
        hdr := http.Header{}
        for k, v := range body.Headers {
                key := bridgeserver.SafeHeaderKey(k)
                if key == "" {
                        continue
                }
                hdr.Set(key, bridgeserver.SafeHeaderValue(v))
        }

        started := time.Now()
        // 构造 utls transport + proxy
        profile := ImpersonateProfile(body.Impersonate)
        transport, terr := buildUtlsTransport(proxyURL, profile)
        if terr != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "transport 构造失败: " + terr.Error()})
                return
        }
        client := &http.Client{
                Transport:     transport,
                Timeout:       time.Duration(timeoutMs) * time.Millisecond,
                CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }, // 不跟随(引擎侧处理)
        }
        req, err := http.NewRequestWithContext(r.Context(), upstreamMethod, u, nil)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "url 解析失败: " + bridgeserver.SanitizeError(err)})
                return
        }
        req.Header = hdr
        resp, err := client.Do(req)
        if err != nil {
                msg := bridgeserver.SanitizeError(err)
                fmt.Printf("[curl-impersonate-bridge] FAIL %s %s profile=%s (%dms): %s\n",
                        upstreamMethod, bridgeserver.SafeHostPath(u), profile.Client, time.Since(started).Milliseconds(), msg)
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": msg})
                return
        }
        defer resp.Body.Close()

        // HEAD: 只回 status+headers, 不下载 body
        if upstreamMethod == http.MethodHead {
                hdrs := bridgeserver.CollectHeaders(resp.Header)
                setCookies := bridgeserver.CollectSetCookies(resp.Header)
                fmt.Printf("[curl-impersonate-bridge] HEAD %d %s profile=%s (%dms)\n",
                        resp.StatusCode, bridgeserver.SafeHostPath(u), profile.Client, time.Since(started).Milliseconds())
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                        "ok":        true,
                        "method":    "HEAD",
                        "status":    resp.StatusCode,
                        "headers":   hdrs,
                        "setCookie": setCookies,
                        "bodyB64":   "",
                        "finalUrl":  u,
                })
                return
        }
        // 流式限量读响应体
        bodyBytes, err := bridgeserver.ReadReaderCapped(resp.Body, impMaxBodyBytes)
        if err != nil {
                fmt.Printf("[curl-impersonate-bridge] FAIL %d %s profile=%s (%dms): 响应体超限(>%dB, 已中止)\n",
                        resp.StatusCode, bridgeserver.SafeHostPath(u), profile.Client, time.Since(started).Milliseconds(), impMaxBodyBytes)
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
                return
        }
        hdrs := bridgeserver.CollectHeaders(resp.Header)
        setCookies := bridgeserver.CollectSetCookies(resp.Header)
        fmt.Printf("[curl-impersonate-bridge] %d %s profile=%s (%dms, %dB)\n",
                resp.StatusCode, bridgeserver.SafeHostPath(u), profile.Client, time.Since(started).Milliseconds(), len(bodyBytes))
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":        true,
                "status":    resp.StatusCode,
                "headers":   hdrs,
                "setCookie": setCookies,
                "bodyB64":   base64.StdEncoding.EncodeToString(bodyBytes),
                "finalUrl":  u,
        })
}

// ssrfCheckProxy / passFromURL / collectHeaders / collectSetCookies / readBodyCapped /
// safeHostPath 已于 R45-1C 全部抽到 bridgeserver (SsrfCheckProxy / PassFromURL /
// CollectHeaders / CollectSetCookies / ReadReaderCapped / SafeHostPath);
// wrapDialContext 因依赖 x/net/proxy 留在本地, 不污染共享包.

// buildUtlsTransport — 构造 utls TLS 指纹 transport, 支持 http/https/socks5/socks4 代理.
//
// 与 fetcher.go globalUtlsTransport 同口径, 但 profile 由调用方按 impersonate 参数指定,
// 不固定 Chrome. proxyStr 非空时: http/https 代理走 http.ProxyURL, socks5/socks4 走
// golang.org/x/net/proxy.DialContext (utls 在 DialTLS 之上, socks 代理先 dial TCP 再握手).
func buildUtlsTransport(proxyStr string, profile utls.ClientHelloID) (*http.Transport, error) {
        tr := &http.Transport{
                // R45-1C: DialTLS 已 deprecated (Go 1.14+), 改用 DialTLSContext 支持 ctx 取消.
                // 与 fetcher.go globalUtlsTransport 同口径, ctx.Done() 时立即断 dial.
                DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
                        host, _, _ := net.SplitHostPort(addr)
                        if err := ctx.Err(); err != nil {
                                return nil, err
                        }
                        dialer := &net.Dialer{Timeout: 10 * time.Second}
                        rawConn, err := dialer.DialContext(ctx, network, addr)
                        if err != nil {
                                return nil, err
                        }
                        // utls TLS 握手, 模拟 Chrome/Firefox/Safari 真实 ClientHello
                        // ServerName 设 host (SNI); InsecureSkipVerify=false (验证证书链)
                        uConn := utls.UClient(rawConn, &utls.Config{
                                ServerName:         host,
                                InsecureSkipVerify: false,
                        }, profile)
                        if err := uConn.HandshakeContext(ctx); err != nil {
                                _ = rawConn.Close()
                                return nil, err
                        }
                        return uConn, nil
                },
                DisableKeepAlives:     false,
                MaxIdleConns:          100,
                MaxIdleConnsPerHost:   10,
                MaxConnsPerHost:       0,
                IdleConnTimeout:       90 * time.Second,
                ResponseHeaderTimeout: 30 * time.Second,
                ExpectContinueTimeout: 1 * time.Second,
                ForceAttemptHTTP2:     false, // utls 不支持 Go 的 HTTP/2 ALPN 协商
                // 默认 TLS 配置仅用于 plain HTTP TLS DialTLS 之外的兜底场景, 这里走 DialTLS 全部走 utls
                TLSClientConfig: &tls.Config{InsecureSkipVerify: false},
        }
        if proxyStr == "" {
                return tr, nil
        }
        u, err := url.Parse(proxyStr)
        if err != nil {
                return nil, fmt.Errorf("proxy parse: %w", err)
        }
        switch u.Scheme {
        case "http", "https":
                tr.Proxy = http.ProxyURL(u)
        case "socks5", "socks5h":
                dialer, err := proxy.SOCKS5("tcp", u.Host, &proxy.Auth{
                        User:     u.User.Username(),
                        Password: bridgeserver.PassFromURL(u),
                }, proxy.Direct)
                if err != nil {
                        return nil, fmt.Errorf("socks5 dialer: %w", err)
                }
                tr.DialContext = wrapDialContext(dialer)
        case "socks4", "socks4a":
                dialer, err := proxy.SOCKS5("tcp", u.Host, nil, proxy.Direct)
                if err != nil {
                        return nil, fmt.Errorf("socks4 dialer: %w", err)
                }
                tr.DialContext = wrapDialContext(dialer)
        default:
                return nil, fmt.Errorf("unsupported proxy scheme: %s", u.Scheme)
        }
        return tr, nil
}

// wrapDialContext — 将 proxy.Dialer 适配为 DialContext 签名.
//   优先用 ContextDialer 实现; 否则 fallback 不响应 ctx 取消.
// R45-1C: 因依赖 x/net/proxy 留在本地, 不污染共享包.
func wrapDialContext(d proxy.Dialer) func(ctx context.Context, network, addr string) (net.Conn, error) {
        if cd, ok := d.(proxy.ContextDialer); ok {
                return cd.DialContext
        }
        return func(ctx context.Context, network, addr string) (net.Conn, error) {
                if ctx.Err() != nil {
                        return nil, ctx.Err()
                }
                return d.Dial(network, addr)
        }
}

// ssrfCheckProxy / passFromURL / collectHeaders / collectSetCookies / readBodyCapped /
// safeHostPath 已于 R45-1C 抽到 bridgeserver (SsrfCheckProxy / PassFromURL /
// CollectHeaders / CollectSetCookies / ReadReaderCapped / SafeHostPath).

func main() {
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:             "curl-impersonate-bridge",
                Port:             PORT,
                Version:          "1.0.0-go",
                IdleTimeoutS:     impIdleTimeoutS,
                RequestTimeoutMs: impMaxTimeoutMs,
                RateLimitPerMin:  bridgeserver.EnvInt("RATE_LIMIT_PER_MIN", 60),
                EnableSsrfCheck:  true,
                SelfTest: func() bool {
                        // utls 编译期就绑定, 不需运行时探测(与 curl_cffi 不同)
                        return true
                },
                Handler: handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "endpoints":         []string{"GET /health", "GET /metrics", "GET /info", "POST /fetch"},
                                "impersonates":      impersonates,
                                "maxBodyBytes":      impMaxBodyBytes,
                                "maxRequestBytes":   impMaxRequestBytes,
                                "maxTimeoutMs":      impMaxTimeoutMs,
                                "ssrfAllowLoopback":  ssrfAllowLB,
                                "tlsBackend":         "utls (refraction-networking/utls v1.8.2)",
                                "note":               "Go 重写, 取代 curl_cffi Python 绑定 (R43-1A)",
                        }, nil
                },
        })
        bs.ListenAndServe()
}
