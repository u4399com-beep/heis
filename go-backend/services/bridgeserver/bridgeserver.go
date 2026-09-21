// Package bridgeserver — Go mini-services 共享样板 (R40-1A 起, R43-1C 起 TS _shared/server.ts 删除后唯一来源).
//
// 能力清单:
//   - 所有服务绑定 127.0.0.1:<port>, 仅 API 路径暴露
//   - 鉴权(AUTH_TOKEN/BRIDGE_KEY 任一非空时启用, X-Auth-Token/X-Bridge-Key/Authorization: Bearer 三选一)
//   - 每 IP 限速(默认 60/min)
//   - 安全响应头(X-Content-Type-Options/X-Frame-Options/Referrer-Policy)
//   - 请求总时长 30s 硬帽(任务要求)
//   - /health 免鉴权免限速(健康探针不应被自身闸门拦)
//   - /metrics Prometheus 文本格式(走鉴权闸免限速)
//   - /info 版本+uptime+配置(走鉴权闸免限速)
//   - SIGTERM/SIGINT 优雅关闭(5s grace)
//   - SSRF 守卫(默认拒绝 localhost/私网/链路本地/元数据端点; allowLoopback 放行回环测试场景)
//
// 设计约束:
//   - Metrics 类仅 uptime/requests/errors/inFlight/avgMs 五项
//   - readBodyCapped 用 io.LimitReader(net/http 标准库自带等价能力)
//   - 不实现 fetchMiniServiceConfig(主应用配置拉取由各服务自行实现)
package bridgeserver

import (
        "context"
        "crypto/subtle"
        "encoding/json"
        "fmt"
        "io"
        "log"
        "math"
        "net"
        "net/http"
        "net/url"
        "os"
        "os/signal"
        "regexp"
        "strings"
        "sync"
        "sync/atomic"
        "syscall"
        "time"
)

// ---------- 常量 ----------
const (
        MaxBodyBytes      = 20 * 1024 * 1024 // 20MB 请求/响应体上限(与 fetch-relay/scrapling 同口径)
        MaxRequestBytes   = 10 * 1024 * 1024 // 10MB POST 体硬帽
        RequestTimeoutMs  = 30_000           // 任务硬要求 30s 上限
        RateWindowMs      = 60_000           // 限速窗口 60s
)

// ---------- Metrics ----------
// Metrics — 进程内简易指标收集器(requests_total / errors_total / in_flight / avg_response_ms / uptime_seconds)。
type Metrics struct {
        service       string
        requestsTotal atomic.Int64
        errorsTotal   atomic.Int64
        inFlight      atomic.Int64
        respSumMs     atomic.Int64
        respCount     atomic.Int64
        startedAtMs   atomic.Int64
}

func NewMetrics(service string) *Metrics {
        m := &Metrics{service: service}
        m.startedAtMs.Store(time.Now().UnixMilli())
        return m
}

func (m *Metrics) StartRequest() { m.inFlight.Add(1) }

// EndRequest — ok=false 时计入 errors_total。durationMs 自动 clamp 到 [0, 60s]。
func (m *Metrics) EndRequest(durationMs int64, ok bool) {
        m.inFlight.Add(-1)
        if m.inFlight.Load() < 0 {
                m.inFlight.Store(0)
        }
        m.requestsTotal.Add(1)
        if !ok {
                m.errorsTotal.Add(1)
        }
        d := durationMs
        if d < 0 {
                d = 0
        }
        if d > 60_000 {
                d = 60_000
        }
        m.respSumMs.Add(d)
        m.respCount.Add(1)
}

func (m *Metrics) Snapshot() map[string]int64 {
        req := m.requestsTotal.Load()
        errs := m.errorsTotal.Load()
        inFlight := m.inFlight.Load()
        sumMs := m.respSumMs.Load()
        cnt := m.respCount.Load()
        var avg int64
        if cnt > 0 {
                avg = sumMs / cnt
        }
        up := (time.Now().UnixMilli() - m.startedAtMs.Load()) / 1000
        return map[string]int64{
                "requests_total":  req,
                "errors_total":    errs,
                "in_flight":       inFlight,
                "avg_response_ms": avg,
                "uptime_seconds":  up,
        }
}

func (m *Metrics) ToPrometheus() string {
        snap := m.Snapshot()
        name := promName(m.service)
        var sb strings.Builder
        samples := []struct {
                metric, mtype, help string
        }{
                {"requests_total", "counter", "Total HTTP requests processed"},
                {"errors_total", "counter", "Total failed HTTP requests (4xx/5xx/timeout)"},
                {"in_flight", "gauge", "Current in-flight requests"},
                {"avg_response_ms", "gauge", "Average response time in milliseconds"},
                {"uptime_seconds", "gauge", "Process uptime in seconds"},
        }
        for _, s := range samples {
                fmt.Fprintf(&sb, "# HELP %s_%s %s\n", name, s.metric, s.help)
                fmt.Fprintf(&sb, "# TYPE %s_%s %s\n", name, s.metric, s.mtype)
                fmt.Fprintf(&sb, "%s_%s %d\n", name, s.metric, snap[s.metric])
        }
        return sb.String()
}

func promName(s string) string {
        out := make([]byte, 0, len(s))
        for _, c := range s {
                if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' {
                        out = append(out, byte(c))
                } else {
                        out = append(out, '_')
                }
        }
        return string(out)
}

// ---------- RateLimiter ----------
// RateLimiter — 每 IP 滑窗限速器(默认 60/min)。
type RateLimiter struct {
        mu        sync.Mutex
        maxPerWin int
        windowMs  int64
        entries   map[string]*rlEntry
        cleanupAt int64
}

type rlEntry struct {
        count   int
        resetAt int64
}

func NewRateLimiter(maxPerWin int) *RateLimiter {
        if maxPerWin <= 0 {
                maxPerWin = 60
        }
        return &RateLimiter{
                maxPerWin: maxPerWin,
                windowMs:  RateWindowMs,
                entries:  make(map[string]*rlEntry),
        }
}

// Allow — 返回 true=放行, false=超限。
func (r *RateLimiter) Allow(ip string) bool {
        r.mu.Lock()
        defer r.mu.Unlock()
        now := time.Now().UnixMilli()
        e := r.entries[ip]
        if e == nil || e.resetAt <= now {
                r.entries[ip] = &rlEntry{count: 1, resetAt: now + r.windowMs}
        } else {
                e.count++
                if e.count > r.maxPerWin {
                        return false
                }
        }
        if now > r.cleanupAt {
                r.cleanupAt = now + 5*60_000
                for k, v := range r.entries {
                        if v.resetAt <= now {
                                delete(r.entries, k)
                        }
                }
        }
        return true
}

// RetryAfter — 距窗口重置剩余秒数(供 Retry-After 头)。
func (r *RateLimiter) RetryAfter(ip string) int {
        r.mu.Lock()
        defer r.mu.Unlock()
        e := r.entries[ip]
        if e == nil {
                return 1
        }
        sec := int(math.Ceil(float64(e.resetAt-time.Now().UnixMilli()) / 1000.0))
        if sec < 1 {
                return 1
        }
        return sec
}

// ---------- 响应助手 ----------
// SecurityHeaders — 通用安全头集合(注入到所有响应)。
func SecurityHeaders(extra map[string]string) map[string]string {
        h := map[string]string{
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options":        "DENY",
                "Referrer-Policy":        "no-referrer",
        }
        for k, v := range extra {
                h[k] = v
        }
        return h
}

// WriteJSON — 写 JSON 响应(自带安全头 + Content-Length)。
func WriteJSON(w http.ResponseWriter, status int, data any) {
        body, err := json.Marshal(data)
        if err != nil {
                http.Error(w, `{"ok":false,"error":"json marshal failed"}`, http.StatusInternalServerError)
                return
        }
        h := SecurityHeaders(map[string]string{
                "Content-Type":  "application/json; charset=utf-8",
                "Content-Length": fmt.Sprintf("%d", len(body)),
        })
        for k, v := range h {
                w.Header().Set(k, v)
        }
        w.WriteHeader(status)
        w.Write(body)
}

// WriteText — 写文本响应(自带安全头, 供 /token 等)。
func WriteText(w http.ResponseWriter, status int, contentType, data string) {
        if contentType == "" {
                contentType = "text/plain; charset=utf-8"
        }
        body := []byte(data)
        h := SecurityHeaders(map[string]string{
                "Content-Type":  contentType,
                "Content-Length": fmt.Sprintf("%d", len(body)),
        })
        for k, v := range h {
                w.Header().Set(k, v)
        }
        w.WriteHeader(status)
        w.Write(body)
}

// WritePrometheus — 写 Prometheus 文本格式响应(自带安全头)。
func WritePrometheus(w http.ResponseWriter, data string) {
        body := []byte(data)
        h := SecurityHeaders(map[string]string{
                "Content-Type":  "text/plain; version=0.0.4; charset=utf-8",
                "Content-Length": fmt.Sprintf("%d", len(body)),
        })
        for k, v := range h {
                w.Header().Set(k, v)
        }
        w.WriteHeader(http.StatusOK)
        w.Write(body)
}

// ---------- 鉴权 ----------
// ConstantTimeEqual — 字符串常量时间比较(防计时旁路)。
func ConstantTimeEqual(a, b string) bool {
        return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// ExtractAuthToken — 提取请求中的鉴权令牌(三选一: X-Auth-Token / X-Bridge-Key / Authorization: Bearer)。
func ExtractAuthToken(r *http.Request) string {
        if a := r.Header.Get("X-Auth-Token"); a != "" {
                return a
        }
        if b := r.Header.Get("X-Bridge-Key"); b != "" {
                return b
        }
        authz := r.Header.Get("Authorization")
        if strings.HasPrefix(strings.ToLower(authz), "bearer ") {
                return strings.TrimSpace(authz[7:])
        }
        return ""
}

// AuthToken — AUTH_TOKEN 优先, BRIDGE_KEY 别名; 均为空则不鉴权(dev 模式)。
func AuthToken() string {
        t := os.Getenv("AUTH_TOKEN")
        if t != "" {
                return t
        }
        return os.Getenv("BRIDGE_KEY")
}

func AuthEnabled() bool { return AuthToken() != "" }

// CheckAuth — AUTH_TOKEN 非空时校验令牌(常量时间比较); 否则放行。
func CheckAuth(r *http.Request) bool {
        tok := AuthToken()
        if tok == "" {
                return true
        }
        got := ExtractAuthToken(r)
        if got == "" {
                return false
        }
        return ConstantTimeEqual(got, tok)
}

// ---------- 头安全 ----------
var headerKeyRe = regexp.MustCompile(`^[!#$%&'*+\-.^_` + "`" + `|~0-9A-Za-z]+$`)

// SafeHeaderKey — 请求头键白名单(RFC 7230 token 简化版), 不合法返回空。
func SafeHeaderKey(k string) string {
        if k == "" || len(k) > 128 {
                return ""
        }
        if !headerKeyRe.MatchString(k) {
                return ""
        }
        return k
}

// SafeHeaderValue — 请求头值: 剥 CR/LF/NUL, 截 8192 字节。
func SafeHeaderValue(v string) string {
        v = strings.ReplaceAll(v, "\r", " ")
        v = strings.ReplaceAll(v, "\n", " ")
        v = strings.ReplaceAll(v, "\x00", " ")
        if len(v) > 8192 {
                return v[:8192]
        }
        return v
}

// ---------- SSRF 守卫 ----------
// AssertSafeSsrfTarget — 拒绝 localhost/私网/链路本地/元数据端点; allowLoopback 放行 127.0.0.1/::1。
//
// 不做 DNS 解析(纯 hostname/IP 字面量判); 域名 → IP 的 SSRF 重定向绑定由调用方
// (fetch-relay redirect:'manual' 不跟随 / 引擎侧 hostGate)把关 —— 双重防线。
func AssertSafeSsrfTarget(rawURL string, allowLoopback bool) (bool, string) {
        u, err := url.Parse(rawURL)
        if err != nil {
                return false, "URL 解析失败"
        }
        if u.Scheme != "http" && u.Scheme != "https" {
                return false, "非 http/https 协议: " + u.Scheme
        }
        h := strings.ToLower(u.Hostname())
        if h == "" {
                return false, "URL 缺少 hostname"
        }
        // localhost / *.localhost
        if h == "localhost" || strings.HasSuffix(h, ".localhost") {
                if allowLoopback {
                        return true, ""
                }
                return false, "localhost 域名 (" + h + ")"
        }
        // IPv4 字面量
        if ipv4Re.MatchString(h) {
                parts := strings.Split(h, ".")
                var nums [4]int
                for i := 0; i < 4; i++ {
                        n := 0
                        for _, c := range parts[i] {
                                n = n*10 + int(c-'0')
                        }
                        nums[i] = n
                }
                a, b := nums[0], nums[1]
                if a == 127 {
                        if allowLoopback {
                                return true, ""
                        }
                        return false, fmt.Sprintf("回环地址 %s", h)
                }
                if a == 0 {
                        return false, fmt.Sprintf("未指定地址 %s", h)
                }
                if a == 10 {
                        return false, fmt.Sprintf("私网 10/8 %s", h)
                }
                if a == 192 && b == 168 {
                        return false, fmt.Sprintf("私网 192.168/16 %s", h)
                }
                if a == 172 && b >= 16 && b <= 31 {
                        return false, fmt.Sprintf("私网 172.16/12 %s", h)
                }
                if a == 169 && b == 254 {
                        return false, fmt.Sprintf("链路本地/元数据端点 169.254/16 %s", h)
                }
                if a == 100 && b >= 64 && b <= 127 {
                        return false, fmt.Sprintf("CGNAT 100.64/10 %s", h)
                }
                return true, ""
        }
        // IPv6 字面量(含 ::1 回环 / fe80::/10 链路本地 / fc00::/7 ULA / ::ffff:x.x.x.x v4-mapped)
        if strings.Contains(h, ":") {
                if h == "::1" || h == "::" {
                        if allowLoopback {
                                return true, ""
                        }
                        return false, "IPv6 回环 " + h
                }
                if ipv6LinkLocalRe.MatchString(h) {
                        return false, "IPv6 链路本地 " + h
                }
                if ipv6ULARe.MatchString(h) {
                        return false, "IPv6 唯一本地 " + h
                }
                // v4-mapped ::ffff:a.b.c.d → 剥出 IPv4 再判
                if m := ipv4MappedRe.FindStringSubmatch(h); m != nil {
                        return AssertSafeSsrfTarget("http://"+m[1]+"/", allowLoopback)
                }
                return true, ""
        }
        // 普通域名
        return true, ""
}

var (
        ipv4Re          = regexp.MustCompile(`^\d{1,3}(\.\d{1,3}){3}$`)
        ipv6LinkLocalRe = regexp.MustCompile(`^fe[89ab][0-9a-f]:`)
        ipv6ULARe       = regexp.MustCompile(`^f[cd][0-9a-f]{2}:`)
        ipv4MappedRe    = regexp.MustCompile(`^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$`)
)

// ---------- 错误脱敏 ----------
// SanitizeError — 错误 → 安全字符串: 剥文件路径/堆栈, 限长 200。
func SanitizeError(e error) string {
        if e == nil {
                return ""
        }
        s := e.Error()
        s = pathRe.ReplaceAllString(s, "<path>")
        s = stackRe.ReplaceAllString(s, "<stack>")
        if len(s) > 200 {
                s = s[:200]
        }
        return s
}

var (
        pathRe  = regexp.MustCompile(`(?:/[A-Za-z0-9._-]+){2,}`)
        stackRe = regexp.MustCompile(`(?m)^[\t ]*at .*$`)
)

// ---------- POST 体限量读 ----------
// ReadBodyCapped — 限量读 body(超限返回 size + error)。
func ReadBodyCapped(r *http.Request, cap int) ([]byte, error) {
        if r.Body == nil {
                return nil, nil
        }
        lr := io.LimitReader(r.Body, int64(cap)+1)
        data, err := io.ReadAll(lr)
        if err != nil {
                return data, err
        }
        if len(data) > cap {
                return data, fmt.Errorf("请求体超限(>%dB)", cap)
        }
        return data, nil
}

// ---------- Server ----------
// BridgeServerOptions — 创建 BridgeServer 的选项。
type BridgeServerOptions struct {
        Name              string
        Port              int
        Version           string
        SelfTest          func() bool
        HealthCheck       func() (map[string]any, error)
        IdleTimeoutS      int // 默认 120
        RequestTimeoutMs  int // 默认 30_000, 上限 30_000
        RateLimitPerMin   int // 默认 60; 0=禁用
        EnableSsrfCheck   bool
        ExtraInfo         func() (map[string]any, error)
        Handler           http.HandlerFunc
}

// BridgeServer — 11 个 mini-service 共用的 HTTP 服务器样板。
type BridgeServer struct {
        opts       BridgeServerOptions
        metrics    *Metrics
        limiter    *RateLimiter
        httpServer *http.Server
}

// New — 构造 BridgeServer(不启动)。
func New(opts BridgeServerOptions) *BridgeServer {
        if opts.IdleTimeoutS <= 0 {
                opts.IdleTimeoutS = 120
        }
        if opts.RequestTimeoutMs <= 0 || opts.RequestTimeoutMs > RequestTimeoutMs {
                opts.RequestTimeoutMs = RequestTimeoutMs
        }
        if opts.RateLimitPerMin == 0 {
                opts.RateLimitPerMin = 60
        }
        if opts.Version == "" {
                opts.Version = "1.0.0"
        }
        bs := &BridgeServer{
                opts:    opts,
                metrics: NewMetrics(opts.Name),
                limiter: NewRateLimiter(opts.RateLimitPerMin),
        }
        mux := http.NewServeMux()
        mux.HandleFunc("/", bs.mainHandler)
        // R42-1A: 补 ReadTimeout / WriteTimeout (DoS 防御). 之前只 ReadHeaderTimeout=10s
        //         防住 slowloris header 攻击, 但 body read 和 response write 无超时 →
        //         客户端可慢速 POST 1B/s 拖死 conn/goroutine. ReadTimeout 钳整读阶段 (header+body)
        //         上限 35s (略宽于 30s ctx timeout 让 ctx 先触发兜底). WriteTimeout 钳整写阶段上限 35s.
        bs.httpServer = &http.Server{
                Addr:              fmt.Sprintf("127.0.0.1:%d", opts.Port),
                Handler:           mux,
                ReadHeaderTimeout: 10 * time.Second,
                ReadTimeout:       35 * time.Second,
                WriteTimeout:      35 * time.Second,
                IdleTimeout:       time.Duration(opts.IdleTimeoutS) * time.Second,
        }
        return bs
}

// mainHandler — 统一入口: /health /metrics /info 路径走特殊处理, 其余走业务 handler。
func (bs *BridgeServer) mainHandler(w http.ResponseWriter, r *http.Request) {
        path := r.URL.Path
        // /health: 免鉴权/免限速
        if path == "/health" {
                bs.healthHandler(w, r)
                return
        }
        // /metrics /info: 走鉴权闸免限速
        if path == "/metrics" {
                if !CheckAuth(r) {
                        WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "missing or invalid auth token", "code": "AUTH_REQUIRED"})
                        return
                }
                WritePrometheus(w, bs.metrics.ToPrometheus())
                return
        }
        if path == "/info" {
                if !CheckAuth(r) {
                        WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "missing or invalid auth token", "code": "AUTH_REQUIRED"})
                        return
                }
                bs.infoHandler(w, r)
                return
        }
        // 主路径: 鉴权
        if !CheckAuth(r) {
                WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "missing or invalid auth token", "code": "AUTH_REQUIRED"})
                return
        }
        // 限速(按 client IP)
        ip := clientIP(r)
        if bs.opts.RateLimitPerMin > 0 && !bs.limiter.Allow(ip) {
                retry := bs.limiter.RetryAfter(ip)
                w.Header().Set("Retry-After", fmt.Sprintf("%d", retry))
                WriteJSON(w, http.StatusTooManyRequests, map[string]any{
                        "ok":    false,
                        "error": fmt.Sprintf("rate limit exceeded (%d/min)", bs.opts.RateLimitPerMin),
                        "code":  "RATE_LIMITED",
                })
                return
        }
        // 30s 超时硬帽: 通过 request context deadline 实现
        // (handler 内若发起上游请求, 应感知 ctx.Done 自然中止; net/http 已内置 ctx 传播)
        ctx, cancel := context.WithTimeout(r.Context(), time.Duration(bs.opts.RequestTimeoutMs)*time.Millisecond)
        defer cancel()
        r = r.WithContext(ctx)

        // 指标包装 + status 跟踪(4xx/5xx 计入 errors_total)
        ww := &statusTrackingWriter{ResponseWriter: w}
        started := time.Now()
        bs.metrics.StartRequest()
        ok := true
        defer func() {
                if rcv := recover(); rcv != nil {
                        ok = false
                        // R42-1A: 不直接 fmt %v 透传 rcv (panic 值可能含 stack / 内部路径 / 业务密钥等敏感信息)
                        //         日志写完整 panic (供运维 debug), 客户端仅见通用 "internal error"
                        log.Printf("[%s] panic recovered: %v", bs.opts.Name, rcv)
                        WriteJSON(ww, http.StatusInternalServerError, map[string]any{
                                "ok":    false,
                                "error": "internal error",
                                "code":  "INTERNAL",
                        })
                }
                if ww.status >= 400 {
                        ok = false
                }
                bs.metrics.EndRequest(time.Since(started).Milliseconds(), ok)
        }()
        bs.opts.Handler(ww, r)
}

// statusTrackingWriter — 包装 http.ResponseWriter 以捕获 status code(供 errors_total 统计)。
type statusTrackingWriter struct {
        http.ResponseWriter
        status int
        wrote  bool
}

func (t *statusTrackingWriter) WriteHeader(code int) {
        if t.wrote {
                return
        }
        t.wrote = true
        t.status = code
        t.ResponseWriter.WriteHeader(code)
}

func (t *statusTrackingWriter) Write(b []byte) (int, error) {
        if !t.wrote {
                t.wrote = true
                t.status = http.StatusOK
        }
        return t.ResponseWriter.Write(b)
}

// healthHandler — /health: {ok, service, port, selfTestOk, ts, upstreamProbe?}
func (bs *BridgeServer) healthHandler(w http.ResponseWriter, r *http.Request) {
        payload := map[string]any{
                "ok":      true,
                "service": bs.opts.Name,
                "port":    bs.opts.Port,
                "ts":      time.Now().Format(time.RFC3339),
        }
        if bs.opts.SelfTest != nil {
                var ok bool
                func() {
                        defer func() {
                                if rcv := recover(); rcv != nil {
                                        ok = false
                                }
                        }()
                        ok = bs.opts.SelfTest()
                }()
                payload["selfTestOk"] = ok
        }
        if bs.opts.HealthCheck != nil {
                probe, err := bs.opts.HealthCheck()
                if err != nil {
                        payload["upstreamProbe"] = map[string]any{"ok": false, "error": SanitizeError(err)}
                } else if probe != nil {
                        payload["upstreamProbe"] = probe
                }
        }
        WriteJSON(w, http.StatusOK, payload)
}

// infoHandler — /info: {service, version, uptimeSeconds, config, metrics, endpoints, ...extra}
func (bs *BridgeServer) infoHandler(w http.ResponseWriter, r *http.Request) {
        snap := bs.metrics.Snapshot()
        info := map[string]any{
                "service":       bs.opts.Name,
                "version":       bs.opts.Version,
                "uptimeSeconds": snap["uptime_seconds"],
                "go":            "1.23",
                "config": map[string]any{
                        "authEnabled":       AuthEnabled(),
                        "rateLimitPerMin":   bs.opts.RateLimitPerMin,
                        "requestTimeoutMs":  bs.opts.RequestTimeoutMs,
                        "ssrfCheckEnabled":   bs.opts.EnableSsrfCheck,
                        "maxPostBodyBytes":   MaxRequestBytes,
                        "hostname":           "127.0.0.1",
                },
                "metrics":   snap,
                "endpoints": []string{"/health", "/metrics", "/info"},
        }
        if bs.opts.ExtraInfo != nil {
                extra, err := bs.opts.ExtraInfo()
                if err != nil {
                        info["extraInfoError"] = SanitizeError(err)
                } else {
                        for k, v := range extra {
                                if _, exists := info[k]; !exists {
                                        info[k] = v
                                }
                        }
                }
        }
        WriteJSON(w, http.StatusOK, info)
}

// ListenAndServe — 启动 HTTP 服务器 + 注册 SIGTERM/SIGINT 优雅关闭。
func (bs *BridgeServer) ListenAndServe() {
        authMode := "NO_AUTH(dev)"
        if AuthEnabled() {
                if os.Getenv("AUTH_TOKEN") != "" {
                        authMode = "AUTH(AUTH_TOKEN)"
                } else {
                        authMode = "AUTH(BRIDGE_KEY)"
                }
        }
        fmt.Printf("[%s] listening on http://127.0.0.1:%d (/health /metrics /info + %s + ratelimit:%d/min + timeout:%dms + sec-headers)\n",
                bs.opts.Name, bs.opts.Port, authMode, bs.opts.RateLimitPerMin, bs.opts.RequestTimeoutMs)

        // SIGTERM/SIGINT 优雅关闭
        sigCh := make(chan os.Signal, 1)
        signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
        go func() {
                sig := <-sigCh
                fmt.Printf("[%s] %s received, shutting down gracefully (5s grace)\n", bs.opts.Name, sig)
                ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
                defer cancel()
                if err := bs.httpServer.Shutdown(ctx); err != nil {
                        fmt.Fprintf(os.Stderr, "[%s] graceful shutdown failed: %v, force exit\n", bs.opts.Name, err)
                        os.Exit(1)
                }
                os.Exit(0)
        }()

        if err := bs.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
                fmt.Fprintf(os.Stderr, "[%s] server error: %v\n", bs.opts.Name, err)
                os.Exit(1)
        }
}

// ---------- 工具 ----------
func clientIP(r *http.Request) string {
        host, _, err := net.SplitHostPort(r.RemoteAddr)
        if err != nil {
                return r.RemoteAddr
        }
        return host
}

// EnvInt — 读环境变量整数(默认 fallback)。
func EnvInt(name string, fallback int) int {
        v := os.Getenv(name)
        if v == "" {
                return fallback
        }
        n := 0
        for _, c := range v {
                if c < '0' || c > '9' {
                        return fallback
                }
                n = n*10 + int(c-'0')
        }
        return n
}

// EnvBool — 读环境变量布尔(== "1" 为 true)。
func EnvBool(name string) bool { return os.Getenv(name) == "1" }

// QueryEscape — 简单 url query 编码(避免依赖 net/url 的 QueryEscape 对 ' ' 的 + 处理).
func QueryEscape(s string) string { return url.QueryEscape(s) }

// ---------- 文本工具 (R41-1C: 从 7 个 services 收口, 消除 28+ 处重复定义) ----------

// HTTPURLRe — URL 形态校验正则 (仅 http/https, 用于 SSRF 守卫前置形态校验).
// 4 个 services (fetch-relay/uc-bridge/scrapling-bridge/moli-bridge) 此前各自定义同款.
var HTTPURLRe = regexp.MustCompile(`^https?://`)

// TruncStr — 截断字符串到最大长度(超出按字节切片, 用于日志/错误脱敏).
// 7 个 services 此前各自定义同款实现 (bqg713/deqixs/fetch-relay/moli/qimao/scrapling/uc/xjp).
func TruncStr(s string, n int) string {
        if len(s) <= n {
                return s
        }
        return s[:n]
}

// BoolStr — bool → "PASS"/"FAIL" (服务自检日志统一格式).
// 7 个 services 此前各自定义同款实现.
func BoolStr(b bool) string {
        if b {
                return "PASS"
        }
        return "FAIL"
}

// IfStr — 三元表达式等价物 (Go 无内置三元, 用于 fmt.Sprintf 拼条件分支).
// 2 个 services (deqixs/xjp) 此前各自定义同款实现.
func IfStr(cond bool, t, f string) string {
        if cond {
                return t
        }
        return f
}

// IfEmpty — 空串兜底(s=="" 则返回 fallback, 否则原样返回 s).
// R42-1C: 从 moli-bridge 收口 (此前 moli-bridge 有本地 ifEmpty 副本, 2 处调用).
// 与 IfStr(s == "", fallback, s) 等价但语义更直白(空串兜底是高频模式, 值得命名).
func IfEmpty(s, fallback string) string {
        if s == "" {
                return fallback
        }
        return s
}

// ---------- HTML→纯文本 (R41-1C: 从 deqixs-proxy + xjp-proxy 收口) ----------
//
// 与 deqixs-proxy / xjp-proxy 原各自的 htmlToText 完全等价:
//   - <br/> → \n, </p>|</div> → \n
//   - 剥所有标签
//   - &nbsp; → 空格, &lt;/&gt;/&quot;/&#39;/&apos; → 对应字符, &amp; 最后解码
//     (防 '&amp;lt;' 被二次解码成 '<' 导致 stored XSS)
//   - 行首尾 trim, 多于 2 个 \n 折叠为 2 个

var (
        brRe         = regexp.MustCompile(`(?i)<br\s*/?>`)
        closePTDivRe = regexp.MustCompile(`(?i)</(?:p|div)>`)
        tagRe        = regexp.MustCompile(`<[^>]+>`)
        nbspRe       = regexp.MustCompile(`(?i)&nbsp;`)
        ltRe         = regexp.MustCompile(`(?i)&lt;`)
        gtRe         = regexp.MustCompile(`(?i)&gt;`)
        quotRe       = regexp.MustCompile(`(?i)&quot;`)
        aposRe       = regexp.MustCompile(`(?i)&#39;|&apos;`)
        ampRe        = regexp.MustCompile(`(?i)&amp;`)
        multiNLRe    = regexp.MustCompile(`\n{3,}`)
)

// HTMLToText — HTML 片段 → 纯文本 (用于章节正文清洗后输出, 不渲染 HTML).
func HTMLToText(html string) string {
        t := brRe.ReplaceAllString(html, "\n")
        t = closePTDivRe.ReplaceAllString(t, "\n")
        t = tagRe.ReplaceAllString(t, "")
        t = nbspRe.ReplaceAllString(t, " ")
        t = ltRe.ReplaceAllString(t, "<")
        t = gtRe.ReplaceAllString(t, ">")
        t = quotRe.ReplaceAllString(t, "\"")
        t = aposRe.ReplaceAllString(t, "'")
        t = ampRe.ReplaceAllString(t, "&")
        lines := strings.Split(t, "\n")
        for i, l := range lines {
                lines[i] = strings.TrimSpace(l)
        }
        out := strings.Join(lines, "\n")
        out = multiNLRe.ReplaceAllString(out, "\n\n")
        return strings.TrimSpace(out)
}
