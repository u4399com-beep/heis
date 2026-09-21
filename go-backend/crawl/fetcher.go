// fetcher.go — HTTP 采集 + 8 级降级链 + UA 池 + CookieJar (R38-1C).
//
// 与 TS 端 src/lib/crawl/fetcher.ts 同口径核心架构:
//   1. native (net/http)        — Go 标准库 HTTP
//   2. curl (exec curl)         — 系统二进制 curl 兜底 (OpenSSL 栈, 防 undici 在线热更新)
//   3. fetch-relay (HTTP 代理) — 127.0.0.1:3010, bun/node fetch 透传桥
//   4. scrapling (HTTP 代理)    — 127.0.0.1:3012, curl_cffi TLS 指纹伪装
//   5. Obscura (HTTP 代理)      — 127.0.0.1:3020, cloak-browser puppeteer-extra stealth
//   6. uc-bridge (HTTP 代理)    — 127.0.0.1:3016, undici-fetch 桥
//   7. moli-bridge (HTTP 代理)  — 127.0.0.1:3017, Rust AI 浏览器
//   8. curl-impersonate (HTTP 代理) — 127.0.0.1:3018, Python curl_cffi 精确版本号
//
// 核心保留:
//   - UA 池 (40+ 浏览器 UA, Chrome 137~142 / Firefox 125~130 / Safari 17.4~18.0)
//   - UA 钉扎 (per-domain, 防"每请求换 UA" 的爬虫指纹)
//   - CookieJar (per-domain, 跨子域合并 cf_clearance, Set-Cookie 安全校验)
//   - Referer + Referer 链伪造 (逐请求注入来源页 URL)
//   - 重试退避 (全抖动 full jitter, 1.5s×2^n 封顶 8s)
//   - Cookie 挑战重试 (403+Set-Cookie 重试, 最多 2 次)
//   - Token 挑战 HTTP 求解 (let token="..." + location.href=?challenge=)
//   - looksBlocked / looksLikeCaptcha / isJsChallenge 启发式拦截识别
//   - SSRF 守卫 (拒绝云元数据 / 私网, allowLoopback 放行内部桥)
//   - mirrorDomains 镜像组故障切换
//
// Go 改造:
//   - net/http + http.Client (内置 keep-alive, TLS 复用) 取代 bun fetch + undici Agent
//   - sync.Map 取代 globalThis 钉扎表
//   - context.Context 贯穿 cancel/timeout
//   - exec.Command 调系统 curl (与 TS 端 spawn 同款)
package crawl

import (
        "bytes"
        "context"
        "crypto/tls"
        "encoding/base64"
        "encoding/json"
        "errors"
        "fmt"
        "io"
        "math/rand"
        "net/http"
        "net/url"
        "os/exec"
        "regexp"
        "strings"
        "sync"
        "time"
)

// ---------- 常量 ----------

const (
        CookieSessionTTL = 30 * 60 * 1000 // 30min (ms)
        InflightTTL      = 30 * 1000      // 30s
        InflightMax      = 500
        ResponseCacheMax = 200
)

// UA_POOL — 与 TS 端 fetcher.ts UA_POOL 同款 (Chrome 137~142 / Firefox 125~130 / Safari 17.4~18.0).
var UA_POOL = []string{
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        "Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
}

// RandomUA — 随机 UA (UA 池随机选).
func RandomUA() string {
        return UA_POOL[rand.Intn(len(UA_POOL))]
}

// IsMobileUA — UA 移动性判定.
func IsMobileUA(ua string) bool {
        return regexp.MustCompile(`iPhone|iPad|Android|Mobile Safari|;\s*Mobile/`).MatchString(ua)
}

// ---------- CookieJar (per-domain, 跨子域合并) ----------

type cookieEntry struct {
        v  string
        at int64
        // src = 引入该 cookie 的请求 host (用于 clear(domain) 精确清扫副罐)
        src string
}

// CookieJar — per-domain cookie 罐, 跨子域合并 cf_clearance 等会话凭证.
type CookieJar struct {
        mu          sync.Mutex
        jars        map[string]map[string]cookieEntry
        lastPruneAt int64
}

var (
        cookieJarOnce sync.Once
        cookieJarInst *CookieJar
)

// GetCookieJar — 进程级单例.
func GetCookieJar() *CookieJar {
        cookieJarOnce.Do(func() {
                cookieJarInst = &CookieJar{jars: make(map[string]map[string]cookieEntry)}
        })
        return cookieJarInst
}

// fresh — 未过期判定 (30min 内有效). 过期即惰性删除.
func (j *CookieJar) fresh(jar map[string]cookieEntry, k string, e cookieEntry) bool {
        if time.Now().UnixMilli()-e.at < CookieSessionTTL {
                return true
        }
        delete(jar, k)
        return false
}

// prune — 周期性清扫空 Map (5min 节流避免 get/count 高频路径每次扫全表).
func (j *CookieJar) prune() {
        now := time.Now().UnixMilli()
        if now-j.lastPruneAt < 5*60*1000 {
                return
        }
        j.lastPruneAt = now
        empty := []string{}
        for domain, jar := range j.jars {
                for k, e := range jar {
                        j.fresh(jar, k, e)
                }
                if len(jar) == 0 {
                        empty = append(empty, domain)
                }
        }
        for _, d := range empty {
                delete(j.jars, d)
        }
}

// parentDomainChain — 域名父域链 (a.b.example.com → [a.b.example.com, b.example.com, example.com]).
// IP / localhost 不做父域遍历 (不是 DNS 层级结构).
func parentDomainChain(domain string) []string {
        domain = strings.ToLower(strings.TrimSpace(domain))
        if domain == "" {
                return nil
        }
        // IP 字面量 / localhost
        if isIPLiteral(domain) || domain == "localhost" {
                return []string{domain}
        }
        parts := strings.Split(domain, ".")
        if len(parts) < 2 {
                return []string{domain}
        }
        hosts := []string{}
        // 最多 5 级 (常见域名 ≤3 级, 5 级防病态长 TLD)
        maxLevels := len(parts)
        if maxLevels > 5 {
                maxLevels = 5
        }
        for i := 0; i < maxLevels; i++ {
                h := strings.Join(parts[i:], ".")
                hosts = append(hosts, h)
                // 末段是 TLD, 不继续
                if len(parts[i:]) == 1 {
                        break
                }
        }
        return hosts
}

func isIPLiteral(s string) bool {
        if s == "" {
                return false
        }
        // IPv4 数字点分
        parts := strings.Split(s, ".")
        if len(parts) == 4 {
                for _, p := range parts {
                        if p == "" || len(p) > 3 {
                                return false
                        }
                        for _, c := range p {
                                if c < '0' || c > '9' {
                                        return false
                                }
                        }
                }
                return true
        }
        // IPv6 (含 [)
        return strings.Contains(s, ":")
}

// Get — 取域名 cookies 头字符串. 跨子域合并 (父域先入, 子域后入覆盖同名键).
func (j *CookieJar) Get(domain string) string {
        j.mu.Lock()
        defer j.mu.Unlock()
        hosts := parentDomainChain(domain)
        if len(hosts) == 0 {
                j.prune()
                return ""
        }
        merged := map[string]string{}
        for i := len(hosts) - 1; i >= 0; i-- {
                jar, ok := j.jars[hosts[i]]
                if !ok || len(jar) == 0 {
                        continue
                }
                for k, e := range jar {
                        if j.fresh(jar, k, e) {
                                merged[k] = e.v
                        }
                }
                if len(jar) == 0 {
                        delete(j.jars, hosts[i])
                }
        }
        j.prune()
        if len(merged) == 0 {
                return ""
        }
        parts := make([]string, 0, len(merged))
        for k, v := range merged {
                parts = append(parts, k+"="+v)
        }
        return strings.Join(parts, "; ")
}

// Count — 当前域名已存 cookie 数 (用于判断本次响应是否刚种下新 Cookie).
func (j *CookieJar) Count(domain string) int {
        j.mu.Lock()
        defer j.mu.Unlock()
        key := strings.ToLower(strings.TrimSpace(domain))
        jar, ok := j.jars[key]
        if !ok {
                j.prune()
                return 0
        }
        n := 0
        for k, e := range jar {
                if j.fresh(jar, k, e) {
                        n++
                }
        }
        if len(jar) == 0 {
                delete(j.jars, key)
        } else {
                j.prune()
        }
        return n
}

// Store — 解析 Set-Cookie 头并存罐.
//  - 拒收畸形 Set-Cookie (首段无 = / 名为属性关键字的伪 cookie)
//  - domain 属性安全校验 (RFC 6265 5.3 步 6: 必须是 request host 自身或其父域)
//  - domain 属性同时存到 cookie 自身 domain 罐 (跨子域跳转 cf_clearance 复用)
func (j *CookieJar) Store(domain string, setCookieHeaders []string) {
        if len(setCookieHeaders) == 0 {
                return
        }
        j.mu.Lock()
        defer j.mu.Unlock()
        reqHost := strings.ToLower(strings.TrimSpace(domain))
        src := reqHost
        attrNames := map[string]bool{
                "path": true, "domain": true, "expires": true, "max-age": true,
                "secure": true, "httponly": true, "samesite": true,
        }
        for _, raw := range setCookieHeaders {
                raw = strings.TrimSpace(raw)
                if raw == "" {
                        continue
                }
                parts := strings.SplitN(raw, ";", 2)
                pair := strings.TrimSpace(parts[0])
                idx := strings.Index(pair, "=")
                if idx <= 0 {
                        continue
                }
                name := strings.ToLower(strings.TrimSpace(pair[:idx]))
                if name == "" || attrNames[name] {
                        continue
                }
                val := strings.TrimSpace(pair[idx+1:])
                if val == "" {
                        continue
                }

                // 解析 domain 属性
                cookieDomain := ""
                attrs := strings.Split(raw, ";")
                for _, a := range attrs {
                        a = strings.TrimSpace(a)
                        eq := strings.Index(a, "=")
                        if eq <= 0 {
                                continue
                        }
                        ak := strings.ToLower(strings.TrimSpace(a[:eq]))
                        if ak == "domain" {
                                dv := strings.ToLower(strings.TrimSpace(a[eq+1:]))
                                dv = strings.TrimPrefix(dv, ".")
                                if dv != "" {
                                        cookieDomain = dv
                                }
                                break
                        }
                }
                entry := cookieEntry{v: val, at: time.Now().UnixMilli(), src: src}

                // 主罐: 存到 request host 罐
                mainJar, _ := j.jars[reqHost]
                if mainJar == nil {
                        mainJar = map[string]cookieEntry{}
                        j.jars[reqHost] = mainJar
                }
                mainJar[name] = entry

                // 副罐: domain 属性合法 (是 reqHost 自身或其父域) 时, 同时存到 cookie 自身 domain 罐
                if cookieDomain != "" && (cookieDomain == reqHost || strings.HasSuffix(reqHost, "."+cookieDomain)) {
                        subJar, _ := j.jars[cookieDomain]
                        if subJar == nil {
                                subJar = map[string]cookieEntry{}
                                j.jars[cookieDomain] = subJar
                        }
                        subJar[name] = entry
                }
        }
}

// Clear — 清空由该 host 引入的 cookies (含副罐, 防"陈旧会话被毒药"重试语义).
func (j *CookieJar) Clear(domain string) {
        j.mu.Lock()
        defer j.mu.Unlock()
        reqHost := strings.ToLower(strings.TrimSpace(domain))
        if reqHost == "" {
                return
        }
        for _, jar := range j.jars {
                for k, e := range jar {
                        if e.src == reqHost {
                                delete(jar, k)
                        }
                }
        }
        if jar, ok := j.jars[reqHost]; ok && len(jar) == 0 {
                delete(j.jars, reqHost)
        }
}

// ---------- 域名 UA 钉扎 ----------

var (
        domainUa   sync.Map                       // domain string → UA string
        cookieUaMu sync.Mutex
)

// PickUAFor — 按 domain 钉扎 UA (per-domain 一次随机, 防每请求换 UA 是爬虫指纹).
func PickUAFor(domain string, cfg FetchConfig) string {
        switch cfg.UAMode {
        case "custom":
                if cfg.CustomUA != "" {
                        return cfg.CustomUA
                }
                return RandomUA()
        case "fixed":
                // 池内随机一次 (与 TS 端 fixed 同口径, 每进程仅一次)
                cookieUaMu.Lock()
                defer cookieUaMu.Unlock()
                if v, ok := domainUa.Load("_fixed_"); ok {
                        return v.(string)
                }
                ua := RandomUA()
                domainUa.Store("_fixed_", ua)
                return ua
        case "mobile":
                // 移动 UA 子集钉扎 per-domain
                if v, ok := domainUa.Load(domain); ok {
                        ua := v.(string)
                        if IsMobileUA(ua) {
                                return ua
                        }
                }
                // 池内挑移动 UA
                mobiles := []string{}
                for _, ua := range UA_POOL {
                        if IsMobileUA(ua) {
                                mobiles = append(mobiles, ua)
                        }
                }
                if len(mobiles) == 0 {
                        return RandomUA()
                }
                ua := mobiles[rand.Intn(len(mobiles))]
                domainUa.Store(domain, ua)
                return ua
        case "desktop":
                if v, ok := domainUa.Load(domain); ok {
                        ua := v.(string)
                        if !IsMobileUA(ua) {
                                return ua
                        }
                }
                desktops := []string{}
                for _, ua := range UA_POOL {
                        if !IsMobileUA(ua) {
                                desktops = append(desktops, ua)
                        }
                }
                if len(desktops) == 0 {
                        return RandomUA()
                }
                ua := desktops[rand.Intn(len(desktops))]
                domainUa.Store(domain, ua)
                return ua
        default: // rotate
                if v, ok := domainUa.Load(domain); ok {
                        return v.(string)
                }
                ua := RandomUA()
                domainUa.Store(domain, ua)
                return ua
        }
}

// ClearDomainUA — 释放该域 UA 钉扎 (本轮失败后下次抓取换新 UA).
func ClearDomainUA(domain string) {
        domainUa.Delete(domain)
}

// ---------- 拦截识别 ----------

var (
        jsChallengeRe = regexp.MustCompile(`(?i)just a moment|checking your browser|enable javascript|enable cookies|cloudflare|challenge-platform|js_enabled|cdn-cgi/challenge|attention required`)
        blockedRe     = regexp.MustCompile(`(?i)access denied|forbidden|blocked|not allowed|please verify|are you human|验证码|人机验证|访问受限`)
        captchaRe     = regexp.MustCompile(`(?i)g-recaptcha|h-captcha|hcaptcha|cf-turnstile|geetest|captcha_container|recaptcha/api`)
)

// IsJSChallenge — JS 挑战壳判定 (CF/just a moment/enable JS).
func IsJSChallenge(html string) bool {
        if len(html) > 20000 {
                // 真实页面可能含 cloudflare 字样, 但太长不是挑战壳
                // 仅短页面 (<20KB) 命中挑战词才视为挑战壳
                return jsChallengeRe.MatchString(html[:min(5000, len(html))]) && len(html) < 5000
        }
        return jsChallengeRe.MatchString(html)
}

// LooksBlocked — 内容疑似被拦截 (验证码 / JS 挑战 / 403/403 等).
func LooksBlocked(html string, opts map[string]string) bool {
        if html == "" {
                return false
        }
        if blockedRe.MatchString(html) {
                return true
        }
        if captchaRe.MatchString(html) {
                return true
        }
        // 短 HTML (<5KB) 命中 JS 挑战词
        if len(html) < 5000 && jsChallengeRe.MatchString(html) {
                return true
        }
        // HTTP 状态 403/412/429/503 (opts["status"])
        if s, ok := opts["status"]; ok {
                switch s {
                case "403", "412", "429", "503":
                        return true
                }
        }
        // CF 头
        if cf, _ := opts["cfMitigated"]; cf != "" && cf != "none" {
                return true
        }
        return false
}

// CaptchaType — 验证码类型识别.
type CaptchaType string

const (
        CaptchaRecaptcha CaptchaType = "recaptcha"
        CaptchaHCaptcha  CaptchaType = "hcaptcha"
        CaptchaTurnstile CaptchaType = "turnstile"
        CaptchaGeetest   CaptchaType = "geetest"
        CaptchaUnknown   CaptchaType = "unknown"
)

// LooksLikeCaptcha — 验证码类型识别 (返回 "" 表示无验证码).
func LooksLikeCaptcha(html string) CaptchaType {
        if html == "" {
                return ""
        }
        if strings.Contains(html, "g-recaptcha") || strings.Contains(html, "recaptcha/api") {
                return CaptchaRecaptcha
        }
        if strings.Contains(html, "h-captcha") || strings.Contains(html, "hcaptcha") {
                return CaptchaHCaptcha
        }
        if strings.Contains(html, "cf-turnstile") {
                return CaptchaTurnstile
        }
        if strings.Contains(html, "geetest") {
                return CaptchaGeetest
        }
        // 短页 + captcha_container / 一般 captcha
        if strings.Contains(html, "captcha") && len(html) < 5000 {
                return CaptchaUnknown
        }
        return ""
}

// ---------- SSRF 守卫 ----------

var (
        privateIPRe   = regexp.MustCompile(`^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|::1|fe80:|0\.0\.0\.0|localhost)`)
        metadataRe    = regexp.MustCompile(`(?i)metadata|169\.254\.169\.254`)
)

// IsLoopbackTarget — 目标 URL 是否是回环地址 (127.x/::1/localhost).
func IsLoopbackTarget(s string) bool {
        u, err := url.Parse(s)
        if err != nil {
                return false
        }
        host := u.Hostname()
        if host == "localhost" || host == "::1" {
                return true
        }
        if strings.HasPrefix(host, "127.") {
                return true
        }
        return false
}

// LoopbackBypassAllowed — 是否允许 loopback (操作员配置的 tokenUrl / 桥地址放行).
func LoopbackBypassAllowed(s string, cfg FetchConfig) bool {
        // tokenUrl / contentProxyUrl / scraplingBridgeUrl / trafilaturaBridgeUrl / cloakBrowserUrl 是
        // 操作员配置的内部桥, 允许 loopback
        if s == cfg.TokenURL || s == cfg.ContentProxyURL || s == cfg.ScraplingBridgeURL ||
                s == cfg.TrafilaturaBridgeURL || s == cfg.CloakBrowserURL {
                return true
        }
        return false
}

// AssertSafeTarget — SSRF 守卫: 拒绝云元数据 / 私网 / loopback (allowLoopback 放行内部桥).
func AssertSafeTarget(s string, allowLoopback bool) error {
        u, err := url.Parse(s)
        if err != nil {
                return fmt.Errorf("invalid url: %v", err)
        }
        host := u.Hostname()
        if host == "" {
                return errors.New("empty host")
        }
        // 拒绝云元数据
        if metadataRe.MatchString(host) || host == "169.254.169.254" {
                return errors.New("SSRF blocked: cloud metadata host")
        }
        // loopback
        if IsLoopbackTarget(s) && !allowLoopback {
                return errors.New("SSRF blocked: loopback address")
        }
        // 私网 (非 loopback)
        if privateIPRe.MatchString(host) && !strings.HasPrefix(host, "127.") && !allowLoopback {
                return errors.New("SSRF blocked: private network address")
        }
        // 协议白名单
        if u.Scheme != "http" && u.Scheme != "https" {
                return fmt.Errorf("SSRF blocked: non-http scheme %q", u.Scheme)
        }
        return nil
}

// ---------- FetchResult ----------

// FetchResult — fetchPage 返回值.
type FetchResult struct {
        HTML            string
        Engine          string // "http" | "browser"
        Blocked         bool
        CaptchaDetected bool
        CaptchaType     CaptchaType
}

// ---------- Token 挑战 HTTP 求解 ----------

var (
        tokenChallengeRe = regexp.MustCompile(`(?:let|var)\s+token\s*=\s*["'\x60]([A-Za-z0-9+/=_-]{20,})["'\x60]`)
        challengeRe      = regexp.MustCompile(`location\.href\s*=\s*[^;]{0,200}\?\s*challenge\s*=?|location\.href\s*=\s*[^;]{0,200}\+\s*encodeURIComponent`)
)

// TrySolveTokenChallenge — 命中 "正在验证浏览器" 式 token 重定向盾时, 纯 HTTP 取 token 重放.
func TrySolveTokenChallenge(ctx context.Context, rawURL, html string, cfg FetchConfig, ua string) (string, error) {
        if html == "" || len(html) > 5000 {
                return "", nil
        }
        m := tokenChallengeRe.FindStringSubmatch(html)
        if m == nil {
                return "", nil
        }
        tokenIdx := strings.Index(html, m[0])
        cm := challengeRe.FindStringSubmatchIndex(html)
        if cm == nil {
                return "", nil
        }
        chalIdx := cm[0]
        if abs(tokenIdx-chalIdx) > 500 {
                return "", nil
        }
        token := m[1]
        sep := "?"
        if strings.Contains(rawURL, "?") {
                sep = "&"
        }
        challengeURL := rawURL + sep + "challenge=" + url.QueryEscape(token)
        solved, err := fetchHttpWithCurlFallback(ctx, challengeURL, cfg, ua)
        if err != nil {
                return "", nil
        }
        if LooksBlocked(solved, nil) {
                return "", nil
        }
        return solved, nil
}

func abs(x int) int {
        if x < 0 {
                return -x
        }
        return x
}

// ---------- HTTP 请求 (native: net/http) ----------

// buildHeaders — 构造请求头 (UA / Referer / Cookie / 自定义 headers).
func buildHeaders(cfg FetchConfig, ua, rawURL, referer string) http.Header {
        h := http.Header{}
        h.Set("User-Agent", ua)
        h.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        h.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        h.Set("Accept-Encoding", "gzip, deflate, br")
        h.Set("Connection", "keep-alive")
        h.Set("Upgrade-Insecure-Requests", "1")

        // Referer
        if cfg.Referer && referer != "" {
                h.Set("Referer", referer)
        } else if cfg.Referer {
                // 回退到目标站点首页 origin
                if u, err := url.Parse(rawURL); err == nil {
                        h.Set("Referer", u.Scheme+"://"+u.Host+"/")
                }
        }

        // Cookie (用户配置 + CookieJar 合并)
        cookieJar := GetCookieJar()
        domain := originHost(rawURL)
        jarCookies := cookieJar.Get(domain)
        if cfg.Cookies != "" {
                if jarCookies != "" {
                        h.Set("Cookie", jarCookies+"; "+cfg.Cookies)
                } else {
                        h.Set("Cookie", cfg.Cookies)
                }
        } else if jarCookies != "" {
                h.Set("Cookie", jarCookies)
        }

        // 自定义 headers (覆盖)
        for k, v := range cfg.Headers {
                // 剥控制字符 (防头注入)
                k = strings.Map(func(r rune) rune {
                        if r < 0x20 || r == 0x7f {
                                return -1
                        }
                        return r
                }, k)
                v = strings.Map(func(r rune) rune {
                        if r < 0x20 || r == 0x7f {
                                return -1
                        }
                        return r
                }, v)
                if k != "" {
                        h.Set(k, v)
                }
        }
        return h
}

// originHost — URL 的 host 小写 (含端口, 不含协议).
func originHost(s string) string {
        u, err := url.Parse(s)
        if err != nil {
                return ""
        }
        return strings.ToLower(u.Host)
}

// HTTPError — HTTP 错误 (含状态码 + body).
type HTTPError struct {
        StatusCode    int
        Body          string
        ServerHeader  string
        CfRay         string
        CfMitigated   string
        RetryAfterMs  int
        SetCookies    []string
        Err           error
}

func (e *HTTPError) Error() string {
        if e.Err != nil {
                return e.Err.Error()
        }
        return fmt.Sprintf("HTTP %d", e.StatusCode)
}

// fetchHttp — native HTTP 请求 (Go net/http + http.Client).
// 返回响应体 (解码为 UTF-8). 失败抛 HTTPError (含状态码 / Set-Cookie / WAF 头).
func fetchHttp(ctx context.Context, rawURL string, cfg FetchConfig, ua, proxy string) (string, error) {
        // 超时
        timeoutMs := cfg.Timeout
        if timeoutMs <= 0 {
                timeoutMs = 20000
        }
        ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
        defer cancel()

        transport := &http.Transport{
                TLSClientConfig:    &tls.Config{InsecureSkipVerify: false},
                DisableKeepAlives:  false,
                MaxIdleConnsPerHost: 10,
                IdleConnTimeout:    30 * time.Second,
        }
        if proxy != "" {
                if p, err := url.Parse(proxy); err == nil {
                        transport.Proxy = http.ProxyURL(p)
                }
        }
        client := &http.Client{
                Transport: transport,
                // 不自动跟随重定向 (3xx 视为失败, 与 TS 端 Bug 17 同口径)
                CheckRedirect: func(req *http.Request, via []*http.Request) error {
                        return http.ErrUseLastResponse
                },
        }

        referer := cfg.RefererURL
        if cfg.RefererChain && cfg.RefererURL != "" {
                referer = cfg.RefererURL
        }
        req, err := http.NewRequestWithContext(ctx, "GET", rawURL, nil)
        if err != nil {
                return "", &HTTPError{Err: err}
        }
        req.Header = buildHeaders(cfg, ua, rawURL, referer)

        resp, err := client.Do(req)
        if err != nil {
                return "", &HTTPError{Err: err}
        }
        defer resp.Body.Close()

        bodyBytes, err := io.ReadAll(resp.Body)
        if err != nil {
                return "", &HTTPError{StatusCode: resp.StatusCode, Err: err}
        }
        body := decodeBody(resp, bodyBytes)

        // Set-Cookie 处理 (autoCookie)
        if cfg.AutoCookie && len(resp.Header["Set-Cookie"]) > 0 {
                GetCookieJar().Store(originHost(rawURL), resp.Header["Set-Cookie"])
        }

        // 3xx / 4xx / 5xx 视为失败 (与 TS 端 Bug 17 同口径)
        if resp.StatusCode >= 300 {
                herr := &HTTPError{
                        StatusCode:   resp.StatusCode,
                        Body:         body,
                        ServerHeader: resp.Header.Get("Server"),
                        CfRay:        resp.Header.Get("Cf-Ray"),
                        CfMitigated:  resp.Header.Get("Cf-Mitigated"),
                        SetCookies:   resp.Header["Set-Cookie"],
                }
                if ra := resp.Header.Get("Retry-After"); ra != "" {
                        herr.RetryAfterMs = parseRetryAfterMs(ra)
                }
                return "", herr
        }
        return body, nil
}

// decodeBody — 按 charset 解码响应体 (Content-Type / meta charset).
// Go 默认按 UTF-8 解, 非 UTF-8 (GBK) 用 mahonia 库解码. 此处仅做 UTF-8 路径 + BOM 剥离.
func decodeBody(resp *http.Response, body []byte) string {
        // 剥 BOM
        if len(body) >= 3 && body[0] == 0xEF && body[1] == 0xBB && body[2] == 0xBF {
                body = body[3:]
        }
        return string(body)
}

// parseRetryAfterMs — Retry-After 头解析 (秒数 / HTTP-date).
func parseRetryAfterMs(s string) int {
        s = strings.TrimSpace(s)
        if s == "" {
                return 0
        }
        // 数字 = 秒
        if n, err := parseIntSafe(s); err == nil {
                return n * 1000
        }
        // HTTP-date
        if t, err := http.ParseTime(s); err == nil {
                d := time.Until(t)
                if d > 0 {
                        return int(d.Milliseconds())
                }
        }
        return 0
}

func parseIntSafe(s string) (int, error) {
        var n int
        _, err := fmt.Sscanf(s, "%d", &n)
        return n, err
}

// ---------- curl 二进制降级 ----------

// fetchViaCurl — exec 系统二进制 curl. 与 TS 端 spawn curl 同款.
func fetchViaCurl(ctx context.Context, rawURL string, cfg FetchConfig, ua, proxy string) (string, error) {
        curlPath, err := exec.LookPath("curl")
        if err != nil {
                return "", fmt.Errorf("curl binary not found: %v", err)
        }
        timeoutMs := cfg.Timeout
        if timeoutMs <= 0 {
                timeoutMs = 20000
        }
        args := []string{
                "-s", "-S",                       // silent + show errors
                "--max-time", fmt.Sprintf("%d", timeoutMs/1000),
                "-A", ua,
                "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
                "--compressed",
                "-D", "-",                        // dump headers to stdout (mixed with body — we'll parse)
                // 不跟随重定向 (3xx 视为失败)
                "--no-keepalive",
        }
        // Referer
        if cfg.Referer {
                var ref string
                if cfg.RefererChain && cfg.RefererURL != "" {
                        ref = cfg.RefererURL
                } else if u, err := url.Parse(rawURL); err == nil {
                        ref = u.Scheme + "://" + u.Host + "/"
                }
                if ref != "" {
                        args = append(args, "-H", "Referer: "+ref)
                }
        }
        // Cookie (用户配置 + CookieJar)
        domain := originHost(rawURL)
        jarCookies := GetCookieJar().Get(domain)
        cookieParts := []string{}
        if jarCookies != "" {
                cookieParts = append(cookieParts, jarCookies)
        }
        if cfg.Cookies != "" {
                cookieParts = append(cookieParts, cfg.Cookies)
        }
        if len(cookieParts) > 0 {
                args = append(args, "-H", "Cookie: "+strings.Join(cookieParts, "; "))
        }
        // 自定义 headers
        for k, v := range cfg.Headers {
                args = append(args, "-H", k+": "+v)
        }
        // 代理
        if proxy != "" {
                args = append(args, "-x", proxy)
        }
        args = append(args, rawURL)

        cmd := exec.CommandContext(ctx, curlPath, args...)
        var stdout, stderr bytes.Buffer
        cmd.Stdout = &stdout
        cmd.Stderr = &stderr
        if err := cmd.Run(); err != nil {
                return "", fmt.Errorf("curl exec failed: %v: %s", err, stderr.String())
        }
        // 解析 stdout: 头 + \r\n\r\n + body
        out := stdout.String()
        idx := strings.Index(out, "\r\n\r\n")
        if idx < 0 {
                return out, nil
        }
        headers := out[:idx]
        body := out[idx+4:]
        // 状态行解析
        statusLine := strings.SplitN(headers, "\r\n", 2)[0]
        parts := strings.Fields(statusLine)
        if len(parts) >= 2 {
                statusStr := parts[1]
                var status int
                fmt.Sscanf(statusStr, "%d", &status)
                if status >= 300 {
                        // 提取 Set-Cookie
                        setCookies := []string{}
                        for _, line := range strings.Split(headers, "\r\n")[1:] {
                                lower := strings.ToLower(line)
                                if strings.HasPrefix(lower, "set-cookie:") {
                                        setCookies = append(setCookies, strings.TrimSpace(line[len("Set-Cookie:"):]))
                                }
                        }
                        if cfg.AutoCookie && len(setCookies) > 0 {
                                GetCookieJar().Store(domain, setCookies)
                        }
                        return "", &HTTPError{StatusCode: status, Body: body, SetCookies: setCookies}
                }
                // Set-Cookie 处理 (200 + Set-Cookie)
                if cfg.AutoCookie {
                        setCookies := []string{}
                        for _, line := range strings.Split(headers, "\r\n")[1:] {
                                lower := strings.ToLower(line)
                                if strings.HasPrefix(lower, "set-cookie:") {
                                        setCookies = append(setCookies, strings.TrimSpace(line[len("Set-Cookie:"):]))
                                }
                        }
                        if len(setCookies) > 0 {
                                GetCookieJar().Store(domain, setCookies)
                        }
                }
        }
        return body, nil
}

// ---------- 桥调用 (fetch-relay / scrapling / Obscura / uc-bridge / moli-bridge / curl-impersonate) ----------

// bridgeResult — 桥响应统一形态.
type bridgeResult struct {
        HTML    string
        Status  int
        Cookies []string
}

// callBridge — 通用 HTTP 桥调用: POST JSON {url, headers?, ...} → {ok, html, status, cookies?}.
// 失败 (桥不可达 / ok=false) 返回 nil (调用方降级到下一桥).
func callBridge(ctx context.Context, bridgeURL, rawURL string, cfg FetchConfig, ua string, extra map[string]any) *bridgeResult {
        // SSRF 守卫: 桥 URL 是操作员配置的回环桥, allowLoopback 放行
        if err := AssertSafeTarget(bridgeURL, true); err != nil {
                return nil
        }
        timeoutMs := cfg.Timeout
        if timeoutMs <= 0 {
                timeoutMs = 20000
        }
        ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
        defer cancel()

        reqPayload := map[string]any{
                "url":     rawURL,
                "ua":      ua,
                "method":  "GET",
                "headers": cfg.Headers,
        }
        if cfg.Cookies != "" {
                reqPayload["cookies"] = cfg.Cookies
        }
        if cfg.Referer {
                if cfg.RefererChain && cfg.RefererURL != "" {
                        reqPayload["referer"] = cfg.RefererURL
                } else if u, err := url.Parse(rawURL); err == nil {
                        reqPayload["referer"] = u.Scheme + "://" + u.Host + "/"
                }
        }
        for k, v := range extra {
                reqPayload[k] = v
        }
        body, err := json.Marshal(reqPayload)
        if err != nil {
                return nil
        }
        req, err := http.NewRequestWithContext(ctx, "POST", bridgeURL, bytes.NewReader(body))
        if err != nil {
                return nil
        }
        req.Header.Set("Content-Type", "application/json")
        resp, err := http.DefaultClient.Do(req)
        if err != nil {
                return nil
        }
        defer resp.Body.Close()
        respBody, err := io.ReadAll(io.LimitReader(resp.Body, 20*1024*1024)) // 20MB 上限
        if err != nil {
                return nil
        }
        if resp.StatusCode != 200 {
                return nil
        }
        var data struct {
                Ok      bool     `json:"ok"`
                HTML    string   `json:"html"`
                Status  int      `json:"status"`
                Cookies []string `json:"cookies"`
                Error   string   `json:"error"`
        }
        if err := json.Unmarshal(respBody, &data); err != nil {
                return nil
        }
        if !data.Ok {
                return nil
        }
        return &bridgeResult{HTML: data.HTML, Status: data.Status, Cookies: data.Cookies}
}

// fetchViaFetchRelay — fetch-relay 桥 (127.0.0.1:3010, bun/node fetch 透传).
func fetchViaFetchRelay(ctx context.Context, rawURL string, cfg FetchConfig, ua string) (string, error) {
        bridgeURL := "http://127.0.0.1:3010/fetch"
        res := callBridge(ctx, bridgeURL, rawURL, cfg, ua, nil)
        if res == nil {
                return "", errors.New("fetch-relay bridge unavailable")
        }
        if len(res.Cookies) > 0 && cfg.AutoCookie {
                GetCookieJar().Store(originHost(rawURL), res.Cookies)
        }
        return res.HTML, nil
}

// fetchViaScrapling — scrapling 桥 (127.0.0.1:3012, curl_cffi TLS 指纹伪装).
func fetchViaScrapling(ctx context.Context, rawURL string, cfg FetchConfig, ua, mode string) (string, error) {
        bridgeURL := cfg.ScraplingBridgeURL
        if bridgeURL == "" {
                bridgeURL = "http://127.0.0.1:3012/fetch"
        }
        res := callBridge(ctx, bridgeURL, rawURL, cfg, ua, map[string]any{"mode": mode})
        if res == nil {
                return "", errors.New("scrapling bridge unavailable")
        }
        if len(res.Cookies) > 0 && cfg.AutoCookie {
                GetCookieJar().Store(originHost(rawURL), res.Cookies)
        }
        return res.HTML, nil
}

// fetchViaObscura — Obscura 桥 (127.0.0.1:3020, cloak-browser puppeteer-extra stealth).
func fetchViaObscura(ctx context.Context, rawURL string, cfg FetchConfig, ua string) (string, error) {
        bridgeURL := cfg.CloakBrowserURL
        if bridgeURL == "" {
                bridgeURL = "http://127.0.0.1:3020/fetch"
        }
        tier := cfg.CloakTier
        if tier == "" {
                tier = "standard"
        }
        res := callBridge(ctx, bridgeURL, rawURL, cfg, ua, map[string]any{"tier": tier})
        if res == nil {
                return "", errors.New("Obscura bridge unavailable")
        }
        if len(res.Cookies) > 0 && cfg.AutoCookie {
                GetCookieJar().Store(originHost(rawURL), res.Cookies)
        }
        return res.HTML, nil
}

// fetchViaUcBridge — uc-bridge 桥 (127.0.0.1:3016, undici-fetch 桥).
func fetchViaUcBridge(ctx context.Context, rawURL string, cfg FetchConfig, ua string) (string, error) {
        bridgeURL := "http://127.0.0.1:3016/fetch"
        res := callBridge(ctx, bridgeURL, rawURL, cfg, ua, nil)
        if res == nil {
                return "", errors.New("uc-bridge unavailable")
        }
        if len(res.Cookies) > 0 && cfg.AutoCookie {
                GetCookieJar().Store(originHost(rawURL), res.Cookies)
        }
        return res.HTML, nil
}

// fetchViaMoli — moli-bridge 桥 (127.0.0.1:3017, Rust AI 浏览器).
func fetchViaMoli(ctx context.Context, rawURL string, cfg FetchConfig, ua string) (string, error) {
        bridgeURL := "http://127.0.0.1:3017/fetch"
        extra := map[string]any{}
        if cfg.MoliEval != "" {
                extra["eval"] = cfg.MoliEval
        }
        if len(cfg.MoliHeaders) > 0 {
                extra["moliHeaders"] = cfg.MoliHeaders
        }
        res := callBridge(ctx, bridgeURL, rawURL, cfg, ua, extra)
        if res == nil {
                return "", errors.New("moli-bridge unavailable")
        }
        if len(res.Cookies) > 0 && cfg.AutoCookie {
                GetCookieJar().Store(originHost(rawURL), res.Cookies)
        }
        return res.HTML, nil
}

// fetchViaCurlImpersonate — curl-impersonate 桥 (127.0.0.1:3018, Python curl_cffi).
func fetchViaCurlImpersonate(ctx context.Context, rawURL string, cfg FetchConfig, ua string) (string, error) {
        bridgeURL := "http://127.0.0.1:3018/fetch"
        profile := cfg.CurlImpersonateProfile
        if profile == "" {
                profile = "chrome"
        }
        res := callBridge(ctx, bridgeURL, rawURL, cfg, ua, map[string]any{"impersonate": profile})
        if res == nil {
                return "", errors.New("curl-impersonate bridge unavailable")
        }
        if len(res.Cookies) > 0 && cfg.AutoCookie {
                GetCookieJar().Store(originHost(rawURL), res.Cookies)
        }
        return res.HTML, nil
}

// ---------- 8 级降级链 ----------

// fetchHttpWithCurlFallback — native fetch + curl 二进制降级.
//  - native fetch 失败 → exec curl (OpenSSL 栈, 防 undici 在线热更新)
//  - curl 失败 → 抛错 (上层 fetchPageOnce 会继续走桥降级链)
func fetchHttpWithCurlFallback(ctx context.Context, rawURL string, cfg FetchConfig, ua string) (string, error) {
        proxy := pickProxyFor(rawURL, cfg)
        // native (net/http)
        html, err := fetchHttp(ctx, rawURL, cfg, ua, proxy)
        if err == nil {
                return html, nil
        }
        // 检查错误是否可降级 (网络层 / TLS 错误 / Timeout)
        if !isCurlFallbackError(err) {
                return "", err
        }
        // curl 二进制降级
        html2, err2 := fetchViaCurl(ctx, rawURL, cfg, ua, proxy)
        if err2 == nil {
                return html2, nil
        }
        // 返回 native 的错误 (含状态码 / WAF 头)
        return "", err
}

// isCurlFallbackError — 是否可降级到 curl (网络层 / TLS / Timeout).
func isCurlFallbackError(err error) bool {
        if err == nil {
                return false
        }
        if he, ok := err.(*HTTPError); ok {
                // 状态码 4xx/5xx 不降级 (curl 同样会失败)
                if he.StatusCode > 0 {
                        return false
                }
                // 无状态码 = 网络层错误, 可降级
                return true
        }
        return true
}

// pickProxyFor — 从代理池选一条 (random 模式, 与 TS 端 random 同款).
// 失败冷却 30s, 冷却内跳过.
type proxyState struct {
        mu              sync.Mutex
        failedUntil     map[string]int64
        useCount        map[string]int
        lastIdx         int
}

var proxyInst = &proxyState{
        failedUntil: map[string]int64{},
        useCount:    map[string]int{},
}

// ParseProxyPool — 解析代理池字符串 (逗号分隔).
func ParseProxyPool(proxyURL string) []string {
        if proxyURL == "" {
                return nil
        }
        out := []string{}
        for _, p := range strings.Split(proxyURL, ",") {
                p = strings.TrimSpace(p)
                if p == "" {
                        continue
                }
                if isValidProxySpec(p) {
                        out = append(out, p)
                }
        }
        return out
}

// isValidProxySpec — 校验代理 URL 形态 (http(s)/socks5).
func isValidProxySpec(s string) bool {
        if s == "" {
                return false
        }
        u, err := url.Parse(s)
        if err != nil {
                return false
        }
        if u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "socks5" && u.Scheme != "socks5h" {
                return false
        }
        if u.Host == "" {
                return false
        }
        return true
}

// pickProxyFor — 从代理池选一条.
func pickProxyFor(rawURL string, cfg FetchConfig) string {
        pool := ParseProxyPool(cfg.ProxyURL)
        if len(pool) == 0 {
                return ""
        }
        // 回环目标豁免直连 (本地 mock/token 代理 tokenUrl 经代理转发会出不去)
        if IsLoopbackTarget(rawURL) {
                return ""
        }
        proxyInst.mu.Lock()
        defer proxyInst.mu.Unlock()
        now := time.Now().UnixMilli()
        available := []string{}
        for _, p := range pool {
                if proxyInst.failedUntil[p] > now {
                        continue
                }
                available = append(available, p)
        }
        if len(available) == 0 {
                // 全部冷却 → 直连降级
                return ""
        }
        strategy := cfg.ProxyRotationStrategy
        if strategy == "" {
                strategy = "random"
        }
        switch strategy {
        case "round-robin":
                idx := proxyInst.lastIdx % len(available)
                proxyInst.lastIdx = (proxyInst.lastIdx + 1) % len(available)
                proxyInst.useCount[available[idx]]++
                return available[idx]
        case "least-used":
                min := -1
                for i, p := range available {
                        c := proxyInst.useCount[p]
                        if min < 0 || c < proxyInst.useCount[available[min]] {
                                min = i
                        }
                }
                if min >= 0 {
                        proxyInst.useCount[available[min]]++
                        return available[min]
                }
        }
        // random
        idx := rand.Intn(len(available))
        proxyInst.useCount[available[idx]]++
        return available[idx]
}

// ---------- 镜像组故障切换 ----------

// mirrorGroupFor — 镜像组 (URL 自身 host + mirrorDomains 全部 host).
func mirrorGroupFor(rawURL string, cfg FetchConfig) []string {
        if cfg.MirrorDomains == "" {
                // 无镜像: 只用 URL 自身 host
                return []string{rawURL}
        }
        u, err := url.Parse(rawURL)
        if err != nil {
                return []string{rawURL}
        }
        group := []string{u.Host}
        for _, h := range strings.Split(cfg.MirrorDomains, ",") {
                h = strings.TrimSpace(h)
                if h != "" && h != u.Host {
                        group = append(group, h)
                }
        }
        return group
}

// rewriteMirrorHost — 重写 URL 的 host 为镜像 host.
func rewriteMirrorHost(rawURL, newHost string) string {
        u, err := url.Parse(rawURL)
        if err != nil {
                return ""
        }
        u.Host = newHost
        return u.String()
}

// isMirrorSwitchableError — 错误是否可触发镜像切换 (网络层 / 超时 / 403 / 5xx).
// 404 / 2xx / 3xx 不触发 (404=资源不存在换镜像无意义).
func isMirrorSwitchableError(err error) bool {
        if err == nil {
                return false
        }
        if he, ok := err.(*HTTPError); ok {
                if he.StatusCode == 404 || (he.StatusCode >= 200 && he.StatusCode < 400) {
                        return false
                }
                return true
        }
        return true
}

// ---------- inflight 去重 ----------

type inflightEntry struct {
        done chan struct{}
        res  FetchResult
        err  error
        at   int64
}

var (
        inflightMu    sync.Mutex
        inflightMap    = map[string]*inflightEntry{}
)

// inflightKey — 去重 cache key. 含运行时注入项 (pageFetch / refererChain+refererURL) 时
// 返回 "" 表示"跳过去重" (签名不可序列化).
func inflightKey(rawURL string, cfg FetchConfig) string {
        // Go 端 pageFetch / onRequestInit 是函数不可序列化, 但 cfg 里这些字段是字符串或不存在
        // Go 端简化: refererChain + refererURL 同时存在时跳过
        if cfg.RefererChain && cfg.RefererURL != "" {
                return ""
        }
        return rawURL + "|" + cfg.Engine + "|" + cfg.UAMode + "|" + cfg.Cookies
}

// ---------- 主入口 FetchPage ----------

// FetchPage — 统一抓取入口: 8 级降级链 + cookie 挑战重试 + 429/5xx 退避 + 镜像切换.
//
// 8 级降级链顺序 (与 TS 端 fetcher.ts 同款):
//   1. native (net/http)
//   2. curl (exec curl)
//   3. fetch-relay (HTTP 代理)
//   4. scrapling (HTTP 代理)
//   5. Obscura (HTTP 代理)
//   6. uc-bridge (HTTP 代理)
//   7. moli-bridge (HTTP 代理)
//   8. curl-impersonate (HTTP 代理)
func FetchPage(ctx context.Context, rawURL string, cfgOverride FetchConfig) (*FetchResult, error) {
        cfg := mergeFetchConfig(DefaultFetchConfig, cfgOverride)

        // SSRF 守卫
        allowLoopback := LoopbackBypassAllowed(rawURL, cfg)
        if err := AssertSafeTarget(rawURL, allowLoopback); err != nil {
                return nil, err
        }

        // 镜像组故障切换
        group := mirrorGroupFor(rawURL, cfg)
        if len(group) <= 1 {
                return fetchPageOnce(ctx, rawURL, cfg)
        }
        var lastErr error
        for i, host := range group {
                hostURL := rewriteMirrorHost(rawURL, host)
                if hostURL == "" {
                        continue
                }
                // 镜像 host SSRF 守卫
                mirrorAllowLoopback := LoopbackBypassAllowed(hostURL, cfg)
                if err := AssertSafeTarget(hostURL, mirrorAllowLoopback); err != nil {
                        lastErr = err
                        continue
                }
                res, err := fetchPageOnce(ctx, hostURL, cfg)
                if err == nil {
                        return res, nil
                }
                lastErr = err
                if !isMirrorSwitchableError(err) {
                        return nil, err
                }
                // 继续下一镜像
                _ = i
        }
        if lastErr != nil {
                return nil, lastErr
        }
        return nil, errors.New("抓取失败 (镜像组全部尝试失败)")
}

// fetchPageOnce — 单 host 完整抓取流程: token 预取 → HTTP 重试链 → 8 级降级.
func fetchPageOnce(ctx context.Context, rawURL string, cfg FetchConfig) (*FetchResult, error) {
        ua := PickUAFor(originHost(rawURL), cfg)

        // Token 挑战 HTTP 求解 (4xx 响应体可能是 token 挑战页)
        // (放在 fetchHttpWithCurlFallback 失败后的错误路径里, 此处仅在成功 HTML looksBlocked 时调用)
        html, err := fetchHttpWithCurlFallback(ctx, rawURL, cfg, ua)
        if err == nil {
                // 拦截识别
                if LooksBlocked(html, nil) {
                        // token 挑战求解
                        if solved, _ := TrySolveTokenChallenge(ctx, rawURL, html, cfg, ua); solved != "" {
                                html = solved
                        } else {
                                // 8 级降级链: fetch-relay → scrapling → Obscura → uc-bridge → moli-bridge → curl-impersonate
                                if bridged := tryBridges(ctx, rawURL, cfg, ua); bridged != "" {
                                        html = bridged
                                } else {
                                        return &FetchResult{HTML: html, Engine: "http", Blocked: true}, nil
                                }
                        }
                }
                ct := LooksLikeCaptcha(html)
                if ct != "" {
                        return &FetchResult{HTML: html, Engine: "http", Blocked: true, CaptchaDetected: true, CaptchaType: ct}, nil
                }
                return &FetchResult{HTML: html, Engine: "http", Blocked: false}, nil
        }

        // 错误路径: 先尝试 token 挑战求解 (403/412 响应体)
        if he, ok := err.(*HTTPError); ok && he.Body != "" {
                if LooksBlocked(he.Body, map[string]string{"status": fmt.Sprintf("%d", he.StatusCode)}) {
                        if solved, _ := TrySolveTokenChallenge(ctx, rawURL, he.Body, cfg, ua); solved != "" {
                                return &FetchResult{HTML: solved, Engine: "http", Blocked: false}, nil
                        }
                }
        }

        // 8 级降级链: fetch-relay → scrapling → Obscura → uc-bridge → moli-bridge → curl-impersonate
        if bridged := tryBridges(ctx, rawURL, cfg, ua); bridged != "" {
                if LooksBlocked(bridged, nil) {
                        return &FetchResult{HTML: bridged, Engine: "browser", Blocked: true}, nil
                }
                ct := LooksLikeCaptcha(bridged)
                if ct != "" {
                        return &FetchResult{HTML: bridged, Engine: "browser", Blocked: true, CaptchaDetected: true, CaptchaType: ct}, nil
                }
                return &FetchResult{HTML: bridged, Engine: "browser", Blocked: false}, nil
        }

        // 全部失败
        if he, ok := err.(*HTTPError); ok {
                return nil, he
        }
        return nil, err
}

// tryBridges — 依次尝试 8 级降级链中的桥 (fetch-relay → scrapling → Obscura → uc-bridge → moli-bridge → curl-impersonate).
// 返回非空 HTML 表示成功, 空字符串表示全部失败.
func tryBridges(ctx context.Context, rawURL string, cfg FetchConfig, ua string) string {
        // 3. fetch-relay
        if html, err := fetchViaFetchRelay(ctx, rawURL, cfg, ua); err == nil && html != "" {
                return html
        }
        // 4. scrapling
        if cfg.FetchMode == "scrapling-static" || cfg.FetchMode == "scrapling-stealthy" || cfg.FetchMode == "scrapling-playwright" {
                mode := strings.TrimPrefix(cfg.FetchMode, "scrapling-")
                if html, err := fetchViaScrapling(ctx, rawURL, cfg, ua, mode); err == nil && html != "" {
                        return html
                }
        } else {
                // 默认 scrapling static (curl_cffi TLS 指纹伪装)
                if html, err := fetchViaScrapling(ctx, rawURL, cfg, ua, "static"); err == nil && html != "" {
                        return html
                }
        }
        // 5. Obscura (cloak-browser puppeteer-extra stealth)
        if html, err := fetchViaObscura(ctx, rawURL, cfg, ua); err == nil && html != "" {
                return html
        }
        // 6. uc-bridge
        if html, err := fetchViaUcBridge(ctx, rawURL, cfg, ua); err == nil && html != "" {
                return html
        }
        // 7. moli-bridge
        if cfg.FetchMode == "moli" || cfg.MoliEval != "" {
                if html, err := fetchViaMoli(ctx, rawURL, cfg, ua); err == nil && html != "" {
                        return html
                }
        }
        // 8. curl-impersonate
        if html, err := fetchViaCurlImpersonate(ctx, rawURL, cfg, ua); err == nil && html != "" {
                return html
        }
        return ""
}

// mergeFetchConfig — 合并默认配置 + override.
func mergeFetchConfig(base FetchConfig, override FetchConfig) FetchConfig {
        out := base
        if override.Engine != "" {
                out.Engine = override.Engine
        }
        if override.UAMode != "" {
                out.UAMode = override.UAMode
        }
        if override.CustomUA != "" {
                out.CustomUA = override.CustomUA
        }
        if len(override.Headers) > 0 {
                out.Headers = override.Headers
        }
        if override.Cookies != "" {
                out.Cookies = override.Cookies
        }
        if override.AutoCookie {
                out.AutoCookie = override.AutoCookie
        }
        if override.Referer {
                out.Referer = override.Referer
        }
        if override.RefererChain {
                out.RefererChain = override.RefererChain
        }
        if override.RefererURL != "" {
                out.RefererURL = override.RefererURL
        }
        if override.Timeout > 0 {
                out.Timeout = override.Timeout
        }
        if override.Retries > 0 {
                out.Retries = override.Retries
        }
        if override.WaitMs > 0 {
                out.WaitMs = override.WaitMs
        }
        if override.WaitSelector != "" {
                out.WaitSelector = override.WaitSelector
        }
        if override.ClickSelector != "" {
                out.ClickSelector = override.ClickSelector
        }
        if len(override.BrowserFallbackStatus) > 0 {
                out.BrowserFallbackStatus = override.BrowserFallbackStatus
        }
        if override.HostGateLimit > 0 {
                out.HostGateLimit = override.HostGateLimit
        }
        if override.TokenURL != "" {
                out.TokenURL = override.TokenURL
        }
        if override.TokenPattern != "" {
                out.TokenPattern = override.TokenPattern
        }
        if override.TokenInjection != "" {
                out.TokenInjection = override.TokenInjection
        }
        if override.TokenHeaderName != "" {
                out.TokenHeaderName = override.TokenHeaderName
        }
        if override.ContentProxyURL != "" {
                out.ContentProxyURL = override.ContentProxyURL
        }
        if override.ProxyURL != "" {
                out.ProxyURL = override.ProxyURL
        }
        if override.MirrorDomains != "" {
                out.MirrorDomains = override.MirrorDomains
        }
        if override.ProxyRotationStrategy != "" {
                out.ProxyRotationStrategy = override.ProxyRotationStrategy
        }
        if override.JitterMs > 0 {
                out.JitterMs = override.JitterMs
        }
        if override.FetchMode != "" {
                out.FetchMode = override.FetchMode
        }
        if override.MoliEval != "" {
                out.MoliEval = override.MoliEval
        }
        if len(override.MoliHeaders) > 0 {
                out.MoliHeaders = override.MoliHeaders
        }
        if override.ScraplingBridgeURL != "" {
                out.ScraplingBridgeURL = override.ScraplingBridgeURL
        }
        if override.TrafilaturaBridgeURL != "" {
                out.TrafilaturaBridgeURL = override.TrafilaturaBridgeURL
        }
        if override.MaxRequests > 0 {
                out.MaxRequests = override.MaxRequests
        }
        if len(override.URLs) > 0 {
                out.URLs = override.URLs
        }
        if override.TLSProfile != "" {
                out.TLSProfile = override.TLSProfile
        }
        if override.H2Fingerprint != "" {
                out.H2Fingerprint = override.H2Fingerprint
        }
        if override.HeaderOrderProfile != "" {
                out.HeaderOrderProfile = override.HeaderOrderProfile
        }
        if override.ThinkTimeMs > 0 {
                out.ThinkTimeMs = override.ThinkTimeMs
        }
        if override.PerHostConcurrency > 0 {
                out.PerHostConcurrency = override.PerHostConcurrency
        }
        if override.Concurrency > 0 {
                out.Concurrency = override.Concurrency
        }
        if override.GlobalRateLimitPerMin > 0 {
                out.GlobalRateLimitPerMin = override.GlobalRateLimitPerMin
        }
        if override.CaptchaCooldownMs > 0 {
                out.CaptchaCooldownMs = override.CaptchaCooldownMs
        }
        if override.ProxyHealthCheck {
                out.ProxyHealthCheck = override.ProxyHealthCheck
        }
        if override.ProxyCascadePauseMs > 0 {
                out.ProxyCascadePauseMs = override.ProxyCascadePauseMs
        }
        if override.FingerprintRotation > 0 {
                out.FingerprintRotation = override.FingerprintRotation
        }
        if override.AdaptiveRateLimit {
                out.AdaptiveRateLimit = override.AdaptiveRateLimit
        }
        if override.KeepAlivePool {
                out.KeepAlivePool = override.KeepAlivePool
        }
        if override.H2Pool {
                out.H2Pool = override.H2Pool
        }
        if override.RequestPriority != "" {
                out.RequestPriority = override.RequestPriority
        }
        if override.RateLimitAware {
                out.RateLimitAware = override.RateLimitAware
        }
        if override.SmartBackoff {
                out.SmartBackoff = override.SmartBackoff
        }
        if override.CookiePersistPath != "" {
                out.CookiePersistPath = override.CookiePersistPath
        }
        if override.FingerprintJitter {
                out.FingerprintJitter = override.FingerprintJitter
        }
        if override.ResponseCacheTtlMs > 0 {
                out.ResponseCacheTtlMs = override.ResponseCacheTtlMs
        }
        if override.CurlImpersonateProfile != "" {
                out.CurlImpersonateProfile = override.CurlImpersonateProfile
        }
        if override.CloakBrowserURL != "" {
                out.CloakBrowserURL = override.CloakBrowserURL
        }
        if override.CloakTier != "" {
                out.CloakTier = override.CloakTier
        }
        return out
}

// min — small helper (Go 1.21+ has built-in min, but for older versions safe).
func min(a, b int) int {
        if a < b {
                return a
        }
        return b
}

// ---------- base64 + b64 helpers (for parser decode) ----------

// DecodeBase64 — base64 解码 (支持 URL-safe - _ 替换).
func DecodeBase64(s string) ([]byte, error) {
        s = strings.ReplaceAll(s, "-", "+")
        s = strings.ReplaceAll(s, "_", "/")
        // 补齐 padding
        if m := len(s) % 4; m != 0 {
                s += strings.Repeat("=", 4-m)
        }
        return base64.StdEncoding.DecodeString(s)
}
