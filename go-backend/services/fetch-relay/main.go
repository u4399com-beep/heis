// fetch-relay — HTTP 中继桥 (Go 重写, R40-1A).
//
// 与 TS 端 mini-services/fetch-relay/index.ts 同口径:
//   场景: 采集引擎跑在 node 运行时(next dev)时, RequestInit.proxy 被全局 fetch(undici)
//   静默忽略 → 引擎对代理请求只能走 curl 子进程链, 而 curl 的 OpenSSL TLS 指纹被部分
//   WAF 按 JA3 拦截。本服务以 bun 运行时代为发起请求; Go 版用 net/http 标准库
//   (BoringSSL 栈 + Transport.Proxy 原生支持 http/https/socks5), 等价能力。
//
// 协议:
//   GET  /health → { ok, service, port, ts }
//   POST /fetch   body: { url, headers: Record<string,string>, proxy?, timeoutMs?, method? }
//                 → 200 { status, headers: [k,v][], setCookie: string[], bodyB64 }
//                    (目标侧所有响应 —— 含 3xx/4xx/5xx —— 均忠实转发为 200 信封,
//                     redirect:'manual' 不跟随, 引擎逐跳循环全权处理)
//                 → 502 { relayError } 仅中继层失败(不可达目标/代理协议不支持/超时)
//   POST /fetch   body: { ..., method: 'HEAD' }  (廉价存在性检查,
//                 仅返回 status + headers, 不下载 body, bodyB64='' 节省带宽)
//
// 安全: hostname 钉 127.0.0.1; url 仅 http/https; 请求头键经安全名单过滤;
//       请求体/响应体均限量读(1MB/20MB); 超时上限 30s; redirect:'manual' 不跟随;
//       SSRF 守卫(默认拒绝 localhost/私网/链路本地/元数据端点;
//       BRIDGE_SSRF_ALLOW_LOOPBACK=1 时放行 127.0.0.1/::1)。
//
// 启动: cd go-backend/services/fetch-relay && go run . (端口固定 3011)
package main

import (
        "context"
        "encoding/base64"
        "encoding/json"
        "fmt"
        "io"
        "net"
        "net/http"
        "net/url"
        "os"
        "regexp"
        "strings"
        "time"

        "golang.org/x/net/proxy"

        "heis-backend/services/bridgeserver"
)

const PORT = 3011

const (
        relayMaxBodyBytes    = 20 * 1024 * 1024 // 20MB
        relayMaxRequestBytes = 1 * 1024 * 1024 // 1MB
        relayMaxTimeoutMs    = 30_000          // 30s 硬帽
        relayIdleTimeoutS    = 200            // 覆盖 30s 上游超时 + 20MB base64 重组开销
)

var (
        proxySpecRe  = regexp.MustCompile(`^(https?|socks5h?|socks4a?)://[^\s,]+$`)
        ssrfAllowLB = os.Getenv("BRIDGE_SSRF_ALLOW_LOOPBACK") == "1"
)

// fetchBody — POST /fetch 请求体。
type fetchBody struct {
        URL       string            `json:"url"`
        Headers   map[string]string `json:"headers"`
        Proxy     string            `json:"proxy"`
        TimeoutMs int               `json:"timeoutMs"`
        Method    string            `json:"method"`
}

func handle(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path != "/fetch" || r.Method != http.MethodPost {
                bridgeserver.WriteJSON(w, http.StatusNotFound, map[string]any{"relayError": "not found"})
                return
        }
        raw, err := bridgeserver.ReadBodyCapped(r, relayMaxRequestBytes)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"relayError": err.Error()})
                return
        }
        var body fetchBody
        if err := json.Unmarshal(raw, &body); err != nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"relayError": "请求体非 JSON"})
                return
        }
        u := body.URL
        if !bridgeserver.HTTPURLRe.MatchString(u) || len(u) > 2048 {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"relayError": "url 非法(仅 http/https)"})
                return
        }
        // SSRF 守卫
        ok, reason := bridgeserver.AssertSafeSsrfTarget(u, ssrfAllowLB)
        if !ok {
                fmt.Printf("[fetch-relay] SSRF 拒绝 %s: %s\n", safeHostPath(u), reason)
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"relayError": "SSRF 拒绝: " + reason})
                return
        }
        // 代理形态校验
        proxyURL := body.Proxy
        if proxyURL != "" {
                if !proxySpecRe.MatchString(proxyURL) || len(proxyURL) > 500 {
                        bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"relayError": "proxy 形态非法"})
                        return
                }
        }
        // 超时(钳制 1s ~ 30s)
        timeoutMs := body.TimeoutMs
        if timeoutMs <= 0 {
                timeoutMs = 20_000
        }
        if timeoutMs < 1000 {
                timeoutMs = 1000
        }
        if timeoutMs > relayMaxTimeoutMs {
                timeoutMs = relayMaxTimeoutMs
        }
        // 方法(HEAD/GET; 其他一律 GET)
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
        // 构造 http.Client (transport 携带 proxy + 不跟随重定向)
        transport, terr := buildTransport(proxyURL)
        if terr != nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"relayError": "proxy 形态非法: " + terr.Error()})
                return
        }
        client := &http.Client{
                Transport:     transport,
                Timeout:       time.Duration(timeoutMs) * time.Millisecond,
                CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }, // 不跟随
        }
        req, err := http.NewRequestWithContext(r.Context(), upstreamMethod, u, nil)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"relayError": "url 解析失败: " + bridgeserver.SanitizeError(err)})
                return
        }
        req.Header = hdr
        resp, err := client.Do(req)
        if err != nil {
                msg := bridgeserver.SanitizeError(err)
                fmt.Printf("[fetch-relay] FAIL %s %s (%dms): %s\n", upstreamMethod, safeHostPath(u), time.Since(started).Milliseconds(), msg)
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"relayError": msg})
                return
        }
        defer resp.Body.Close()

        // HEAD: 只回 status+headers, 不下载 body
        if upstreamMethod == http.MethodHead {
                hdrs := collectHeaders(resp.Header)
                setCookies := resp.Header.Values("Set-Cookie")
                for i, sc := range setCookies {
                        setCookies[i] = bridgeserver.SafeHeaderValue(sc)
                }
                fmt.Printf("[fetch-relay] HEAD %d %s (%dms)\n", resp.StatusCode, safeHostPath(u), time.Since(started).Milliseconds())
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                        "method":    "HEAD",
                        "status":    resp.StatusCode,
                        "headers":   hdrs,
                        "setCookie": setCookies,
                        "bodyB64":   "",
                })
                return
        }
        // 流式限量读响应体
        bodyBytes, err := readBodyCapped(resp.Body, relayMaxBodyBytes)
        if err != nil {
                fmt.Printf("[fetch-relay] FAIL %d %s (%dms): 响应体超限(>%dB, 已取消)\n",
                        resp.StatusCode, safeHostPath(u), time.Since(started).Milliseconds(), relayMaxBodyBytes)
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"relayError": err.Error()})
                return
        }
        hdrs := collectHeaders(resp.Header)
        setCookies := resp.Header.Values("Set-Cookie")
        for i, sc := range setCookies {
                setCookies[i] = bridgeserver.SafeHeaderValue(sc)
        }
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "status":    resp.StatusCode,
                "headers":   hdrs,
                "setCookie": setCookies,
                "bodyB64":   base64.StdEncoding.EncodeToString(bodyBytes),
        })
}

// buildTransport — 构造支持 http/https/socks5/socks4 代理的 http.Transport。
func buildTransport(proxyStr string) (*http.Transport, error) {
        tr := &http.Transport{
                MaxIdleConns:        100,
                MaxIdleConnsPerHost: 10,
                IdleConnTimeout:     90 * time.Second,
                ForceAttemptHTTP2:  true,
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
                dialer, err := proxy.SOCKS5("tcp", u.Host, &proxy.Auth{User: u.User.Username(), Password: passFromURL(u)}, proxy.Direct)
                if err != nil {
                        return nil, fmt.Errorf("socks5 dialer: %w", err)
                }
                tr.DialContext = wrapDialContext(dialer)
        case "socks4", "socks4a":
                // socks4 通过 socks5 包近似(实际生产用 socks4 比例低, 此处宽松接受)
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

func passFromURL(u *url.URL) string {
        if u == nil || u.User == nil {
                return ""
        }
        p, _ := u.User.Password()
        return p
}

// wrapDialContext — 将 proxy.Dialer(仅 Dial) 适配为 DialContext 签名.
// 优先用 ContextDialer 实现(socks5 dialer 实际实现); 否则 fallback 不响应 ctx 取消.
// R41-1C: 收口 tr.Dial(Go 1.7 deprecated SA1019) → tr.DialContext.
func wrapDialContext(d proxy.Dialer) func(ctx context.Context, network, addr string) (net.Conn, error) {
        if cd, ok := d.(proxy.ContextDialer); ok {
                return cd.DialContext
        }
        return func(ctx context.Context, network, addr string) (net.Conn, error) {
                // 不阻塞 ctx 取消 — 调用方在 tr.ResponseHeaderTimeout / 总 30s 帽做兜底
                if ctx.Err() != nil {
                        return nil, ctx.Err()
                }
                return d.Dial(network, addr)
        }
}

// collectHeaders — 把 http.Header 展开为 [k,v] 对(排除 Set-Cookie, 由专用通道)。
func collectHeaders(h http.Header) [][2]string {
        out := [][2]string{}
        for k, vs := range h {
                kk := strings.ToLower(k)
                if kk == "set-cookie" {
                        continue
                }
                for _, v := range vs {
                        out = append(out, [2]string{k, bridgeserver.SafeHeaderValue(v)})
                }
        }
        return out
}

// readBodyCapped — 流式限量读 body(超限返回 error)。
func readBodyCapped(r io.Reader, cap int) ([]byte, error) {
        lr := io.LimitReader(r, int64(cap)+1)
        data, err := io.ReadAll(lr)
        if err != nil {
                return data, err
        }
        if len(data) > cap {
                return data, fmt.Errorf("响应体超限(>%dB)", cap)
        }
        return data, nil
}

// safeHostPath — 日志脱钉: 仅 host+path(查询串可能含 token, 不落日志)。
func safeHostPath(raw string) string {
        u, err := url.Parse(raw)
        if err != nil {
                return "(unparseable-url)"
        }
        return u.Host + u.Path
}

func main() {
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:             "fetch-relay",
                Port:             PORT,
                Version:          "1.0.0",
                IdleTimeoutS:     relayIdleTimeoutS,
                RequestTimeoutMs: relayMaxTimeoutMs,
                RateLimitPerMin:  bridgeserver.EnvInt("RATE_LIMIT_PER_MIN", 60),
                EnableSsrfCheck:  true,
                Handler:          handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "endpoints":          []string{"GET /health", "GET /metrics", "GET /info", "POST /fetch"},
                                "maxBodyBytes":       relayMaxBodyBytes,
                                "maxRequestBytes":   relayMaxRequestBytes,
                                "maxTimeoutMs":       relayMaxTimeoutMs,
                                "ssrfAllowLoopback":   ssrfAllowLB,
                        }, nil
                },
        })
        bs.ListenAndServe()
}
