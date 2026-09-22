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
        "compress/gzip"
        "compress/zlib"
        "context"
        "crypto/tls"
        "encoding/base64"
        "encoding/json"
        "errors"
        "fmt"
        "io"
        "math/rand"
        "net"
        "net/http"
        "net/url"
        "os"
        "os/exec"
        "regexp"
        "strings"
        "sync"
        "sync/atomic"
        "time"
        "unicode/utf8"

        "golang.org/x/text/encoding/htmlindex"
        "golang.org/x/text/transform"

        utls "github.com/refraction-networking/utls"
)

// ---------- 常量 ----------

const (
        CookieSessionTTL = 30 * 60 * 1000 // 30min (ms)
        InflightTTL      = 30 * 1000      // 30s
        InflightMax      = 500
        ResponseCacheMax = 200
)

// UA_POOL — 与 TS 端 fetcher.ts UA_POOL 同款 (Chrome 137~142 / Firefox 125~130 / Safari 17.4~18.0).
// R41-1A: 扩充到 24 个 (新增 Chrome 143 / Firefox 129-131 / Safari 18.1-18.2 / Edge 142 / Chrome on macOS ARM / Linux Firefox).
var UA_POOL = []string{
        // Chrome 137-143 desktop
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        // Edge 137-142 (Chromium engine)
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
        // Firefox 125-131 desktop
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
        "Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
        // Safari 17.4-18.2 desktop
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
        // Mobile UAs
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 15; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
}

// RandomUA — 随机 UA (UA 池随机选).
func RandomUA() string {
        return UA_POOL[rand.Intn(len(UA_POOL))]
}

// mobileUARe — 移动 UA 识别正则 (R41-1A: 提为包级, 避免 IsMobileUA 每次重新编译).
var mobileUARe = regexp.MustCompile(`iPhone|iPad|Android|Mobile Safari|;\s*Mobile/`)

// IsMobileUA — UA 移动性判定.
func IsMobileUA(ua string) bool {
        return mobileUARe.MatchString(ua)
}

// IsFirefoxUA — UA Firefox 浏览器判定 (Sec-Ch-Ua 头族差异).
func IsFirefoxUA(ua string) bool {
        return strings.Contains(ua, "Gecko/") && strings.Contains(ua, "Firefox/")
}

// IsSafariUA — UA Safari 浏览器判定 (非 Chrome, 非 Firefox, 含 Version/ + Safari/).
func IsSafariUA(ua string) bool {
        if !strings.Contains(ua, "Safari/") {
                return false
        }
        if strings.Contains(ua, "Chrome/") || strings.Contains(ua, "Chromium/") {
                return false
        }
        return strings.Contains(ua, "Version/")
}

// chromeVerRe — 提取 Chrome 主版本号 (Sec-Ch-Ua 头需精确品牌+版本).
var chromeVerRe = regexp.MustCompile(`Chrome/(\d+)`)

// extractChromeVer — 从 UA 提取 Chrome 主版本号, 失败返回 0.
func extractChromeVer(ua string) int {
        m := chromeVerRe.FindStringSubmatch(ua)
        if len(m) < 2 {
                return 0
        }
        var n int
        fmt.Sscanf(m[1], "%d", &n)
        return n
}

// intToStrOr — 整数转字符串, 0 时返回 fallback.
func intToStrOr(n int, fallback string) string {
        if n <= 0 {
                return fallback
        }
        return fmt.Sprintf("%d", n)
}

// ---------- CookieJar (per-domain, 跨子域合并) ----------

type cookieEntry struct {
        v  string
        at int64
        // src = 引入该 cookie 的请求 host (用于 clear(domain) 精确清扫副罐)
        src string
}

// cookieEntryDump — JSON 序列化结构 (R42-1B cookie 持久化跨 session 复用).
// cookieEntry 字段小写不可见 json, 用 dump 结构中转.
type cookieEntryDump struct {
        V   string `json:"v"`
        At  int64  `json:"at"`
        Src string `json:"src,omitempty"`
}

// cookieJarDump — CookieJar 序列化结构.
type cookieJarDump struct {
        Jars map[string]map[string]cookieEntryDump `json:"jars"`
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
// R41-1A: 修复 TLD 误入 hosts 的 bug — 原实现 append 在 break 之前, 把末段 "com" 也加入 hosts,
//          若任一调用方 Store(domain="com", ...) 会污染所有 *.com 请求. 改为不 append 末段.
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
                // 末段是 TLD, 不入 hosts (不参与 cookie 跨子域合并)
                if len(parts[i:]) == 1 {
                        break
                }
                h := strings.Join(parts[i:], ".")
                hosts = append(hosts, h)
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

// SaveToDisk — 持久化 cookies 到 JSON 文件 (R42-1B 反反爬增强: 跨 session 复用).
// cf_clearance / PHPSESSID 等会话凭证跨 session 复用, 避免每 session 重做挑战.
// 原子写: tmp + rename. 路径为空则不存.
func (j *CookieJar) SaveToDisk(path string) error {
        if path == "" {
                return nil
        }
        j.mu.Lock()
        defer j.mu.Unlock()
        dump := cookieJarDump{Jars: map[string]map[string]cookieEntryDump{}}
        now := time.Now().UnixMilli()
        for d, jar := range j.jars {
                out := map[string]cookieEntryDump{}
                for k, e := range jar {
                        // 滤过期 (写入时即清理)
                        if now-e.at >= CookieSessionTTL {
                                continue
                        }
                        out[k] = cookieEntryDump{V: e.v, At: e.at, Src: e.src}
                }
                if len(out) > 0 {
                        dump.Jars[d] = out
                }
        }
        data, err := json.Marshal(dump)
        if err != nil {
                return err
        }
        tmp := path + ".tmp." + fmt.Sprintf("%d", os.Getpid())
        if err := os.WriteFile(tmp, data, 0600); err != nil {
                return err
        }
        return os.Rename(tmp, path)
}

// LoadFromDisk — 从 JSON 文件加载 cookies (R42-1B 反反爬增强: 启动时调用一次).
// 加载时滤过期 cookies; 不存在则不报错 (首次启动).
func (j *CookieJar) LoadFromDisk(path string) error {
        if path == "" {
                return nil
        }
        j.mu.Lock()
        defer j.mu.Unlock()
        data, err := os.ReadFile(path)
        if err != nil {
                if os.IsNotExist(err) {
                        return nil
                }
                return err
        }
        var dump cookieJarDump
        if err := json.Unmarshal(data, &dump); err != nil {
                return err
        }
        now := time.Now().UnixMilli()
        loaded := map[string]map[string]cookieEntry{}
        for d, jar := range dump.Jars {
                out := map[string]cookieEntry{}
                for k, e := range jar {
                        // 滤过期
                        if now-e.At >= CookieSessionTTL {
                                continue
                        }
                        out[k] = cookieEntry{v: e.V, at: e.At, src: e.Src}
                }
                if len(out) > 0 {
                        loaded[d] = out
                }
        }
        // 合并: 不覆盖现有 in-memory entries (避免覆盖刚抓的新鲜 cookie)
        for d, jar := range loaded {
                existing, ok := j.jars[d]
                if !ok {
                        j.jars[d] = jar
                        continue
                }
                for k, e := range jar {
                        if _, has := existing[k]; !has {
                                existing[k] = e
                        }
                }
        }
        j.lastPruneAt = now
        return nil
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

// ---------- Per-host Referer 记忆 (反反爬增强 R41-1A) ----------
//
// 真实浏览器会以"上一页 URL"作为下个请求的 Referer (而非目标站 origin).
// 例: 用户从 a.com/list 翻到 a.com/book/1, 下个章节 a.com/chapter/1 的 Referer 应是 a.com/book/1.
// 缺失该记忆 → 反爬易识别为非浏览器 (Referer 恒为 origin / 用户配置).
// 实现: per-host 最近内部页 URL (LMFU, 5min TTL, 1000 host 软上限).

type hostRefererState struct {
        mu       sync.Mutex
        recent   map[string]hostRefererEntry
        lastSwept int64
}

type hostRefererEntry struct {
        url string
        at  int64
}

const (
        HostRefererTTLms    = 5 * 60 * 1000 // 5min
        HostRefererCap      = 1000
        HostRefererSweepEvery = 50
)

var hostRefererInst = &hostRefererState{recent: map[string]hostRefererEntry{}}

// SetHostReferer — 记录某 host 的最近内部页 URL (作为后续请求的 Referer).
// 仅接受 http(s) + 非回环 (避免本地桥 URL 污染).
func SetHostReferer(rawURL string) {
        u, err := url.Parse(rawURL)
        if err != nil || u.Host == "" {
                return
        }
        if u.Scheme != "http" && u.Scheme != "https" {
                return
        }
        if IsLoopbackTarget(rawURL) {
                return
        }
        host := strings.ToLower(u.Host)
        now := time.Now().UnixMilli()
        hostRefererInst.mu.Lock()
        defer hostRefererInst.mu.Unlock()
        // 周期性 sweep (惰性)
        if hostRefererInst.lastSwept == 0 || now-hostRefererInst.lastSwept > HostRefererSweepEvery*1000 {
                hostRefererInst.lastSwept = now
                for k, e := range hostRefererInst.recent {
                        if now-e.at > HostRefererTTLms {
                                delete(hostRefererInst.recent, k)
                        }
                }
        }
        // 软上限
        if len(hostRefererInst.recent) > HostRefererCap {
                // 驱逐一个最旧的
                oldestKey := ""
                oldestAt := int64(0)
                for k, e := range hostRefererInst.recent {
                        if oldestAt == 0 || e.at < oldestAt {
                                oldestAt = e.at
                                oldestKey = k
                        }
                }
                if oldestKey != "" {
                        delete(hostRefererInst.recent, oldestKey)
                }
        }
        hostRefererInst.recent[host] = hostRefererEntry{url: rawURL, at: now}
}

// GetHostReferer — 取某 host 的最近内部页 URL (作 Referer 用). 无则 "".
func GetHostReferer(host string) string {
        host = strings.ToLower(strings.TrimSpace(host))
        if host == "" {
                return ""
        }
        hostRefererInst.mu.Lock()
        defer hostRefererInst.mu.Unlock()
        e, ok := hostRefererInst.recent[host]
        if !ok {
                return ""
        }
        if time.Now().UnixMilli()-e.at > HostRefererTTLms {
                delete(hostRefererInst.recent, host)
                return ""
        }
        return e.url
}

// ClearHostReferer — 失败时清掉陈旧 referer, 下次换新.
func ClearHostReferer(host string) {
        host = strings.ToLower(strings.TrimSpace(host))
        if host == "" {
                return
        }
        hostRefererInst.mu.Lock()
        defer hostRefererInst.mu.Unlock()
        delete(hostRefererInst.recent, host)
}

// ---------- 随机延迟 (per-host jitter, R41-1A) ----------
//
// 反频控: 请求前 sleep 随机毫秒 (0 ~ JitterMs), 避免请求间隔恒定易被识别.
// 仅在 cfg.JitterMs > 0 时生效. 同 host 多请求也会自然节流 (hostGate 已有 minGapMs).

// jitterSleep — sleep 随机 [0, jitterMs) 毫秒. ctx 取消立即返回.
func jitterSleep(ctx context.Context, jitterMs int) {
        if jitterMs <= 0 {
                return
        }
        d := time.Duration(rand.Intn(jitterMs)) * time.Millisecond
        if d <= 0 {
                return
        }
        select {
        case <-time.After(d):
        case <-ctx.Done():
        }
}

// ---------- 全局 HTTP Transport (R41-1A 性能优化) ----------
//
// 原实现每请求新建 transport, 无连接复用, 高并发下 TCP 句柄爆炸.
// 改为进程级单例 transport (含 keep-alive + TLS 复用 + 代理动态注入).
//
// 注意: net/http 自动解 gzip 但不解 brotli. 故 Accept-Encoding 仅声明 gzip, deflate.

var globalTransport = func() *http.Transport {
        t := &http.Transport{
                TLSClientConfig:       &tls.Config{InsecureSkipVerify: false},
                DisableKeepAlives:     false,
                MaxIdleConns:          200,
                MaxIdleConnsPerHost:   16,
                MaxConnsPerHost:       0, // 不限
                IdleConnTimeout:       90 * time.Second,
                ResponseHeaderTimeout: 30 * time.Second,
                ExpectContinueTimeout: 1 * time.Second,
                ForceAttemptHTTP2:     true,
        }
        return t
}()

// globalHttp — 全局 client (无 proxy); proxy 走 transport.Clone + Proxy.
var globalHttp = &http.Client{
        Transport: globalTransport,
        // 不自动跟随重定向 (与 TS 端 Bug 17 同口径, 3xx 视为失败)
        CheckRedirect: func(req *http.Request, via []*http.Request) error {
                return http.ErrUseLastResponse
        },
}

// transportWithProxy — 给全局 transport 临时挂代理 (返回新实例, 不污染全局).
func transportWithProxy(proxy string) *http.Transport {
        if proxy == "" {
                return globalTransport
        }
        p, err := url.Parse(proxy)
        if err != nil {
                return globalTransport
        }
        // 克隆全局 transport 并设代理
        t2 := globalTransport.Clone()
        t2.Proxy = http.ProxyURL(p)
        return t2
}

// ---------- utls Chrome TLS 指纹 transport (R42-1B 反反爬增强) ----------
//
// Cloudflare / Akamai / DataDome 等反爬服务基于 TLS ClientHello 识别 Go 标准库
// 指纹 (crypto/tls 是固定扩展顺序 + 固定 cipher suite 列表, 与 Chrome 不一致),
// 直接拒绝服务. utls 模拟 Chrome 真实 TLS 指纹 (GREASE 扩展 + Chrome 扩展顺序 +
// X25519Kyber768Draft00 curve + Chrome cipher suite 顺序) 可绕过.
//
// 实现: 用 utls.UClient 替代 crypto/tls.Client 做 DialTLS. http.Transport 的连接池
// 仍正常复用 utls 连接. HTTP/2 因 ALPN 协商差异默认关闭 (chrome 站点大多 HTTP/1.1).
//
// R43-1B 反反爬增强: JA3/JA4 指纹轮换. 单一 HelloChrome_Auto 长期使用会被反爬
// 服务关联 (Chrome 指纹 + Go utls 库特征 = 爬虫). 增加 4 个 Hello 指纹池
// (Chrome / Firefox / Safari / iOS), 按 host 哈希稳定选取 (per-domain 钉扎, 与
// UA 钉扎同款), 反爬无法靠 TLS 指纹单一性识别.

// utlsHelloPool — utls Hello 指纹池 (扩充 12 款具体浏览器版本, R45-1A 反反爬增强).
// R43-1B 用 4 个 _Auto (Chrome/Firefox/Safari/iOS), 但 _Auto 都是某固定版本别名
// (Chrome_Auto=Chrome_133 / Firefox_Auto=Firefox_120 / Safari_Auto=Safari_16_0 /
// IOS_Auto=IOS_14), 长期使用反爬可关联 "utls 库 + Chrome_Auto" 指纹 → 爬虫.
// 扩充到 12 个具体版本号 (Chrome 102/106/120/131/133 + Firefox 99/105/120 +
// Safari 16.0 + iOS 13/14), JA3/JA4 指纹 (cipher suite 顺序 + 扩展顺序 + GREASE
// 模式) 各异. R45-1A 修复 ClearUtlsChoice 后真正轮换 (attempts 偏移), 失败 N 次后
// 选到 pool 中第 (hash+N)%12 号, 不再重复同号.
var utlsHelloPool = []utls.ClientHelloID{
        utls.HelloChrome_102,
        utls.HelloChrome_106_Shuffle,
        utls.HelloChrome_120,
        utls.HelloChrome_131,
        utls.HelloChrome_133,
        utls.HelloFirefox_99,
        utls.HelloFirefox_102,
        utls.HelloFirefox_105,
        utls.HelloFirefox_120,
        utls.HelloSafari_16_0,
        utls.HelloIOS_13,
        utls.HelloIOS_14,
}

// utlsHelloChoice — per-domain 钉扎的 Hello 指纹选择 (避免每请求换指纹被识别).
// R45-1A: 增加 attempts 计数器, 配合 ClearUtlsChoice 让 host 失败后下次重新选时换号.
// (原实现 ClearUtlsChoice 后 pickUtlsHello 重新哈希选, 但哈希是 host 确定性 → 选到同一号,
// ClearUtlsChoice 实际无效. 新增 attempts 让 Clear 后 pickUtlsHello 用 attempts 偏移选下一号.)
var (
        utlsChoiceMu  sync.Mutex
        utlsChoiceMap = map[string]utls.ClientHelloID{}
        utlsAttemptsMap = map[string]int{}
)

// pickUtlsHello — 按 host 哈希 + attempts 偏移稳定选取 Hello 指纹 (per-host 钉扎).
// host 为空 → 返回 HelloChrome_Auto (默认).
// R45-1A: 第 N 次 pick (attempts=N) 选 pool[(hash+N) % len(pool)], 这样 ClearUtlsChoice
// 后再 pick 会偏移到下一号 (而不是重新哈希选到同一号), 让指纹轮换真正生效.
func pickUtlsHello(host string) utls.ClientHelloID {
        if host == "" {
                return utls.HelloChrome_Auto
        }
        utlsChoiceMu.Lock()
        defer utlsChoiceMu.Unlock()
        if h, ok := utlsChoiceMap[host]; ok {
                return h
        }
        // 哈希 host 选 Hello (稳定, 不依赖 math/rand 避免全局锁)
        var h uint32
        for i := 0; i < len(host); i++ {
                h = h*31 + uint32(host[i])
        }
        attempt := utlsAttemptsMap[host] // 失败次数 (ClearUtlsChoice 累加)
        choice := utlsHelloPool[(h+uint32(attempt))%uint32(len(utlsHelloPool))]
        utlsChoiceMap[host] = choice
        return choice
}

// ClearUtlsChoice — 清掉 host 的 Hello 钉扎 (失败后下次换新指纹).
// R45-1A: 累加 attempts 计数, 让下次 pickUtlsHello 选到 pool 中下一号 (而不是重新哈希
// 选到同一号, 原 ClearUtlsChoice 实际是 no-op). 上限 attempts=len(pool), 超过归零防
// 长期失败累计偏移过远.
func ClearUtlsChoice(host string) {
        if host == "" {
                return
        }
        utlsChoiceMu.Lock()
        defer utlsChoiceMu.Unlock()
        delete(utlsChoiceMap, host)
        utlsAttemptsMap[host]++
        if utlsAttemptsMap[host] > len(utlsHelloPool) {
                utlsAttemptsMap[host] = 0
        }
}

var globalUtlsTransport = func() *http.Transport {
        t := &http.Transport{
                // R45-1C: DialTLS 已 deprecated (Go 1.14+), 改用 DialTLSContext 支持 ctx 取消.
                // 当上层请求 ctx 被 cancel (per-attempt timeout), transport 能立刻断 dial 不卡 10s.
                DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
                        host, _, _ := net.SplitHostPort(addr)
                        // 优先尊重 ctx; ctx 已 cancel 直接 bail, 避免握手挂 10s 后才发现
                        if err := ctx.Err(); err != nil {
                                return nil, err
                        }
                        dialer := &net.Dialer{Timeout: 10 * time.Second}
                        rawConn, err := dialer.DialContext(ctx, network, addr)
                        if err != nil {
                                return nil, err
                        }
                        // R43-1B: 按 host 钉扎 Hello 指纹 (Chrome / Firefox / Safari / iOS 轮换)
                        helloID := pickUtlsHello(host)
                        uConn := utls.UClient(rawConn, &utls.Config{
                                ServerName:         host,
                                InsecureSkipVerify: false,
                        }, helloID)
                        // 握手期间再检查一次 ctx, 提前 abort
                        if err := uConn.HandshakeContext(ctx); err != nil {
                                _ = rawConn.Close()
                                // 失败时清掉该 host 的钉扎, 下次换新指纹
                                ClearUtlsChoice(host)
                                return nil, err
                        }
                        return uConn, nil
                },
                DisableKeepAlives:     false,
                MaxIdleConns:          200,
                MaxIdleConnsPerHost:   16,
                MaxConnsPerHost:       0,
                IdleConnTimeout:       90 * time.Second,
                ResponseHeaderTimeout: 30 * time.Second,
                ExpectContinueTimeout: 1 * time.Second,
                ForceAttemptHTTP2:     false, // utls 不支持 Go 的 HTTP/2 ALPN 协商
        }
        return t
}()

// ---------- 拦截识别 ----------

var (
        jsChallengeRe = regexp.MustCompile(`(?i)just a moment|checking your browser|enable javascript|enable cookies|cloudflare|challenge-platform|js_enabled|cdn-cgi/challenge|attention required`)
        blockedRe     = regexp.MustCompile(`(?i)access denied|forbidden|blocked|not allowed|please verify|are you human|验证码|人机验证|访问受限`)
        captchaRe     = regexp.MustCompile(`(?i)g-recaptcha|h-captcha|hcaptcha|cf-turnstile|geetest|captcha_container|recaptcha/api`)
)

// IsJSChallenge — JS 挑战壳判定 (CF/just a moment/enable JS).
// R41-1A: 简化逻辑. 真实页面 >20KB 不会是挑战壳 (挑战壳都是几百字节的 stub), 直接返回 false.
//   <20KB 时全字符扫挑战词.
func IsJSChallenge(html string) bool {
        if len(html) > 20000 {
                return false
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
// R41-1A 反反爬增强:
//   - Accept-Encoding 改为 "gzip, deflate" (Go net/http 不解 brotli, 服务器返 br 会乱码)
//   - 新增 Sec-Ch-Ua 头族 (按 UA 品牌自动注入, Chrome / Edge / Firefox / Safari 各异)
//   - 新增 Sec-Fetch-* 头族 (Site=none 表示非同源非用户导航, Mode/Read/Dest=doc)
//   - 新增 Priority: u=0, i (HTTP/2 priority hint)
//   - Referer 优先级: cfg.RefererURL > hostRefererMap > 目标站 origin
//   - DNT: 1 (反追踪标识, 与浏览器等同)
func buildHeaders(cfg FetchConfig, ua, rawURL, referer string) http.Header {
        h := http.Header{}
        h.Set("User-Agent", ua)
        h.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7")
        // R41-1A: 仅声明 gzip / deflate. Go net/http 自动解 gzip, 不解 brotli.
        // 服务器返 br 时 body 是原始 brotli 字节, parser 全炸.
        h.Set("Accept-Encoding", "gzip, deflate")
        h.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        h.Set("Connection", "keep-alive")
        h.Set("Upgrade-Insecure-Requests", "1")
        // DNT (Do Not Track) - 浏览器等同标识
        h.Set("DNT", "1")

        // Sec-Ch-Ua 头族 (Chromium 品牌 + Grease 标识 + Platform + Mobile)
        // Firefox / Safari 不发 Sec-Ch-Ua, 留空跳过即可 (避免暴露不一致指纹).
        if !IsFirefoxUA(ua) && !IsSafariUA(ua) {
                ver := extractChromeVer(ua)
                brand := `"Chromium";v="` + intToStrOr(ver, "137") + `"`
                grease := `"Not?A_Brand";v="8"` // Chrome 用 "Not_A Brand" / "Not?A_Brand" / "Not"A?Brand"
                if strings.Contains(ua, "Edg/") {
                        brand = `"Microsoft Edge";v="` + intToStrOr(ver, "137") + `"`
                        grease = `"Not_A Brand";v="8"`
                }
                h.Set("Sec-Ch-Ua", grease+`, `+brand)
                if IsMobileUA(ua) {
                        h.Set("Sec-Ch-Ua-Mobile", "?1")
                        h.Set("Sec-Ch-Ua-Platform", `"Android"`)
                } else if strings.Contains(ua, "Windows") {
                        h.Set("Sec-Ch-Ua-Mobile", "?0")
                        h.Set("Sec-Ch-Ua-Platform", `"Windows"`)
                } else if strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X") {
                        h.Set("Sec-Ch-Ua-Mobile", "?0")
                        h.Set("Sec-Ch-Ua-Platform", `"macOS"`)
                } else if strings.Contains(ua, "Linux") {
                        h.Set("Sec-Ch-Ua-Mobile", "?0")
                        h.Set("Sec-Ch-Ua-Platform", `"Linux"`)
                }
        }

        // Sec-Fetch-* 头族 (代表顶层文档导航)
        h.Set("Sec-Fetch-Dest", "document")
        h.Set("Sec-Fetch-Mode", "navigate")
        h.Set("Sec-Fetch-Site", "none") // none = 用户输入 URL / 书签
        h.Set("Sec-Fetch-User", "?1")

        // Priority: u=0, i (HTTP/2 priority hint, 浏览器默认)
        h.Set("Priority", "u=0, i")

        // Referer 优先级: cfg.RefererURL > per-host 记忆 > 目标站 origin
        domain := originHost(rawURL)
        if cfg.Referer {
                if referer != "" {
                        h.Set("Referer", referer)
                } else if rh := GetHostReferer(domain); rh != "" {
                        h.Set("Referer", rh)
                } else if u, err := url.Parse(rawURL); err == nil {
                        h.Set("Referer", u.Scheme+"://"+u.Host+"/")
                }
        }

        // Cookie (用户配置 + CookieJar 合并)
        cookieJar := GetCookieJar()
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
//
// R41-1A 改造:
//   - 复用全局 transport (避免每请求新建 transport + 连接复用)
//   - 请求前 jitterSleep (反频控, 仅 cfg.JitterMs > 0 时)
//   - 重试退避 (full jitter exponential, cfg.Retries 次, 1.5s×2^n 封顶 8s)
//     仅对网络层 / 429 / 5xx 重试 (4xx 不重试, 因 curl 同样会失败)
//   - 成功后 SetHostReferer (供下次请求作 Referer)
//   - 失败时 ClearHostReferer (避免污染下次请求)
//   - decodeBody 识别 GBK / GB18030 (用 golang.org/x/text)
//
// R42-1B 改造:
//   - 新增 transport 参数 (nil = 用 transportWithProxy, 非 nil = 用指定 transport).
//     让 fetchHttp (标准) 与 fetchHttpViaUtls (Chrome TLS 指纹) 共用同一重试/退避逻辑.
func fetchHttp(ctx context.Context, rawURL string, cfg FetchConfig, ua, proxy string, transport *http.Transport) (string, error) {
        // 请求前 jitter (反频控)
        jitterSleep(ctx, cfg.JitterMs)

        // 超时 (per-attempt, R42-1B 修复)
        timeoutMs := cfg.Timeout
        if timeoutMs <= 0 {
                timeoutMs = 20000
        }

        // R42-1B: transport 注入 (utls 路径); nil 时用全局 transport + 代理克隆
        if transport == nil {
                transport = transportWithProxy(proxy)
        }
        client := &http.Client{
                Transport: transport,
                // 不自动跟随重定向 (3xx 视为失败, 与 TS 端 Bug 17 同口径)
                CheckRedirect: func(req *http.Request, via []*http.Request) error {
                        return http.ErrUseLastResponse
                },
        }

        referer := cfg.RefererURL
        // R42-1B: RefererChain 字段保留语义 (跨请求链式 referer), 但当前实现下
        // cfg.RefererURL 设置时即作为 referer 注入 (与 buildHeaders 同款).
        _ = cfg.RefererChain

        // 重试退避 (full jitter exponential)
        // R42-1B 修复: 每个 attempt 单独 timeout. 原实现 ctx 在循环外 wrap 一次,
        // attempt 1 用 19s 后 attempt 2 只剩 1s, 重试无效. 改为 per-attempt wrap.
        retries := cfg.Retries
        if retries < 0 {
                retries = 0
        }
        if retries > 5 {
                retries = 5
        }
        var lastErr error
        for attempt := 0; attempt <= retries; attempt++ {
                attemptCtx, attemptCancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
                req, err := http.NewRequestWithContext(attemptCtx, "GET", rawURL, nil)
                if err != nil {
                        attemptCancel()
                        return "", &HTTPError{Err: err}
                }
                req.Header = buildHeaders(cfg, ua, rawURL, referer)

                resp, err := client.Do(req)
                if err != nil {
                        attemptCancel()
                        lastErr = &HTTPError{Err: err}
                        // 仅网络层错误重试 (4xx/5xx 在下面分支处理)
                        if !isRetriableNetErr(err) || attempt == retries {
                                return "", lastErr
                        }
                        // 退避 (full jitter: 0 ~ base*2^attempt, 封顶 8s)
                        backoffMs := 1500 * (1 << uint(attempt)) // 1.5s, 3s, 6s
                        if backoffMs > 8000 {
                                backoffMs = 8000
                        }
                        jitter := rand.Intn(backoffMs + 1)
                        select {
                        case <-time.After(time.Duration(jitter) * time.Millisecond):
                        case <-ctx.Done():
                                return "", ctx.Err()
                        }
                        continue
                }

                bodyBytes, err := io.ReadAll(resp.Body)
                _ = resp.Body.Close()
                attemptCancel()
                if err != nil {
                        lastErr = &HTTPError{StatusCode: resp.StatusCode, Err: err}
                        if !isRetriableNetErr(err) || attempt == retries {
                                return "", lastErr
                        }
                        continue
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
                        // 429 / 503 / 502 / 504 可重试 (服务端临时不可用)
                        if isRetriableStatus(resp.StatusCode) && attempt < retries {
                                // 退避 (尊重 Retry-After, 否则 full jitter)
                                waitMs := herr.RetryAfterMs
                                if waitMs <= 0 {
                                        waitMs = 1500 * (1 << uint(attempt))
                                        if waitMs > 8000 {
                                                waitMs = 8000
                                        }
                                        waitMs = rand.Intn(waitMs + 1)
                                }
                                select {
                                case <-time.After(time.Duration(waitMs) * time.Millisecond):
                                case <-ctx.Done():
                                        return "", ctx.Err()
                                }
                                lastErr = herr
                                continue
                        }
                        return "", herr
                }

                // 成功: 记 per-host Referer (下次同站请求可作 Referer)
                SetHostReferer(rawURL)
                return body, nil
        }
        if lastErr != nil {
                return "", lastErr
        }
        return "", errors.New("fetchHttp: 重试耗尽")
}

// isRetriableNetErr — 网络层错误是否可重试 (超时 / 连接重置 / EOF / context).
func isRetriableNetErr(err error) bool {
        if err == nil {
                return false
        }
        s := err.Error()
        if strings.Contains(s, "timeout") || strings.Contains(s, "context deadline exceeded") ||
                strings.Contains(s, "connection reset") || strings.Contains(s, "EOF") ||
                strings.Contains(s, "broken pipe") || strings.Contains(s, "no such host") ||
                strings.Contains(s, "connection refused") || strings.Contains(s, "i/o timeout") {
                return true
        }
        // context 取消不可重试 (调用方主动取消)
        if errors.Is(err, context.Canceled) {
                return false
        }
        return true // 默认重试
}

// isRetriableStatus — HTTP 状态码是否可重试 (429 / 5xx 临时性失败).
func isRetriableStatus(code int) bool {
        switch code {
        case 429, 500, 502, 503, 504, 408:
                return true
        }
        return false
}

// decodeBody — 按 charset 解码响应体 (Content-Type / meta charset).
// R41-1A: 用 golang.org/x/text/encoding/htmlindex 按 charset 自动解码 (GBK / GB18030 / UTF-8 / latin1).
// Go 默认按 UTF-8 解, 中文站 GBK / GB2312 / GB18030 直接 string(body) 会乱码.
//
// R45-1A 修复 (P0): 原注释声称 "net/http 自动解 gzip" 实际上仅当 Transport 自加 Accept-Encoding
//   (即 Request 未设 Accept-Encoding) 时才自解. 我们在 buildHeaders 显式设 Accept-Encoding:
//   gzip, deflate, Go 不自解 — resp.Body 是原始 gzip/deflate 字节, string() 后 HTML 解析全炸.
//   补全 Content-Encoding 检测 + 手动 gzip.NewReader / zlib.NewReader 解码.
//   brotli (Content-Encoding: br) 仍不议 (无 Go 原生库), 返原始字节供上层识别失败.
func decodeBody(resp *http.Response, body []byte) string {
        // R45-1A: 检测 Content-Encoding, 手动解码 gzip / deflate (Go 不自解显式 Accept-Encoding).
        //   Go 仅在 Transport 自加 Accept-Encoding (Request 无该头) 时自解, 我们显式设了 → 需手动解.
        ce := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Encoding")))
        switch ce {
        case "gzip":
                if gr, err := gzip.NewReader(bytes.NewReader(body)); err == nil {
                        if decoded, err := io.ReadAll(gr); err == nil {
                                gr.Close()
                                body = decoded
                        } else {
                                gr.Close()
                        }
                }
        case "deflate":
                if zr, err := zlib.NewReader(bytes.NewReader(body)); err == nil {
                        if decoded, err := io.ReadAll(zr); err == nil {
                                zr.Close()
                                body = decoded
                        } else {
                                zr.Close()
                        }
                }
        case "br":
                // Brotli 不支持 (无 Go 原生库, 避免引入 cgo 依赖). 返原始字节, parser 识别为乱码后
                // 调用方走 8 级降级链到下一桥 (fetch-relay / scrapling 等 Python 侧有 brotli 解码).
                // R45-1A: 记日志供运维 debug (仅首次重复打同 host brotli).
                brotliMissCount.Add(1)
        }
        // 剥 BOM
        if len(body) >= 3 && body[0] == 0xEF && body[1] == 0xBB && body[2] == 0xBF {
                body = body[3:]
                return string(body) // UTF-8 BOM 后默认 UTF-8
        }
        // 1. 优先看 Content-Type: charset=...
        charset := ""
        ct := resp.Header.Get("Content-Type")
        if ct != "" {
                charset = extractCharset(ct)
        }
        // 2. 兜底看 HTML 头 <meta charset=...>
        if charset == "" && len(body) > 0 && len(body) < 8192 {
                // 只在头部 4KB 找 meta charset, 节省扫描
                head := body
                if len(head) > 4096 {
                        head = head[:4096]
                }
                if m := metaCharsetRe.FindSubmatch(head); m != nil {
                        charset = strings.ToLower(strings.TrimSpace(string(m[1])))
                }
        }
        // 3. UTF-8 默认 (Go 标准库解 UTF-8 是隐式的)
        if charset == "" || charset == "utf-8" || charset == "utf8" || charset == "us-ascii" || charset == "ascii" {
                return string(body)
        }
        // 4. 非 UTF-8 → 用 htmlindex 解码
        enc, err := htmlindex.Get(charset)
        if err != nil || enc == nil {
                // 未知 charset, 回退 UTF-8 (可能乱码, 但不会崩)
                return string(body)
        }
        decoded, _, err := transform.Bytes(enc.NewDecoder(), body)
        if err != nil {
                return string(body)
        }
        // 验证解码后是合法 UTF-8 (htmlindex 已保证)
        if !utf8.Valid(decoded) {
                return string(body)
        }
        return string(decoded)
}

// brotliMissCount — R45-1A: 记 brotli 响应未被解码的次数 (供 admin / metrics 查询).
//   高频出现说明某些上游站点全返 br, 需走桥 (Python scrapling 有 brotli 解码库) 或 加 Go brotli 依赖.
var brotliMissCount atomic.Int64

// metaCharsetRe — 提取 HTML <meta charset=...> 标签的 charset 值.
var metaCharsetRe = regexp.MustCompile(`(?i)<meta[^>]+charset=["']?([\w-]+)["']?`)

// extractCharset — 从 Content-Type 头提取 charset=... 值.
func extractCharset(ct string) string {
        idx := strings.Index(strings.ToLower(ct), "charset=")
        if idx < 0 {
                return ""
        }
        v := ct[idx+8:]
        // 截到 ; 或行尾
        if semi := strings.Index(v, ";"); semi >= 0 {
                v = v[:semi]
        }
        v = strings.TrimSpace(strings.Trim(v, `"' `))
        return strings.ToLower(v)
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

// stripControlChars — 剥控制字符 (防头注入). 与 buildHeaders 同款逻辑.
func stripControlChars(s string) string {
        return strings.Map(func(r rune) rune {
                if r < 0x20 || r == 0x7f {
                        return -1
                }
                return r
        }, s)
}

// fetchViaCurl — exec 系统二进制 curl. 与 TS 端 spawn curl 同款.
// R41-1A: 移除 --no-keepalive (curl 默认开 keepalive, 该 flag 反而禁用, 浪费且易触发频控);
//          注入 Sec-Ch-Ua / Sec-Fetch-* 头族 (与 buildHeaders 同款, 防 curl 路径暴露);
//          自定义 headers 剥控制字符 (与 buildHeaders 对称);
//          成功后 SetHostReferer.
func fetchViaCurl(ctx context.Context, rawURL string, cfg FetchConfig, ua, proxy string) (string, error) {
        curlPath, err := exec.LookPath("curl")
        if err != nil {
                return "", fmt.Errorf("curl binary not found: %v", err)
        }
        // 请求前 jitter (反频控, 与 fetchHttp 同款)
        jitterSleep(ctx, cfg.JitterMs)

        timeoutMs := cfg.Timeout
        if timeoutMs <= 0 {
                timeoutMs = 20000
        }
        args := []string{
                "-s", "-S", // silent + show errors
                "--max-time", fmt.Sprintf("%d", timeoutMs/1000),
                "-A", ua,
                "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
                "-H", "Accept-Encoding: gzip, deflate",
                "--compressed",
                "-D", "-", // dump headers to stdout (mixed with body — we'll parse)
                // R41-1A: 移除 --no-keepalive. curl 默认开 keepalive, 该 flag 反而禁用, 浪费且易触发频控.
                "-H", "Connection: keep-alive",
                "-H", "Upgrade-Insecure-Requests: 1",
                "-H", "DNT: 1",
        }
        // Sec-Ch-Ua / Sec-Fetch-* 头族 (与 buildHeaders 同款, 防 curl 路径暴露指纹)
        if !IsFirefoxUA(ua) && !IsSafariUA(ua) {
                ver := extractChromeVer(ua)
                brand := `"Chromium";v="` + intToStrOr(ver, "137") + `"`
                grease := `"Not?A_Brand";v="8"`
                if strings.Contains(ua, "Edg/") {
                        brand = `"Microsoft Edge";v="` + intToStrOr(ver, "137") + `"`
                        grease = `"Not_A Brand";v="8"`
                }
                args = append(args,
                        "-H", "Sec-Ch-Ua: "+grease+", "+brand,
                )
                if IsMobileUA(ua) {
                        args = append(args,
                                "-H", "Sec-Ch-Ua-Mobile: ?1",
                                "-H", `Sec-Ch-Ua-Platform: "Android"`,
                        )
                } else if strings.Contains(ua, "Windows") {
                        args = append(args,
                                "-H", "Sec-Ch-Ua-Mobile: ?0",
                                `-H`, `Sec-Ch-Ua-Platform: "Windows"`,
                        )
                } else if strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X") {
                        args = append(args,
                                "-H", "Sec-Ch-Ua-Mobile: ?0",
                                `-H`, `Sec-Ch-Ua-Platform: "macOS"`,
                        )
                } else if strings.Contains(ua, "Linux") {
                        args = append(args,
                                "-H", "Sec-Ch-Ua-Mobile: ?0",
                                `-H`, `Sec-Ch-Ua-Platform: "Linux"`,
                        )
                }
        }
        args = append(args,
                "-H", "Sec-Fetch-Dest: document",
                "-H", "Sec-Fetch-Mode: navigate",
                "-H", "Sec-Fetch-Site: none",
                "-H", "Sec-Fetch-User: ?1",
                "-H", "Priority: u=0, i",
        )
        // Referer 优先级: cfg.RefererURL > per-host 记忆 > 目标站 origin
        // R42-1B: 与 buildHeaders 同款 — cfg.RefererURL 设置时直接用 (不再要求 cfg.RefererChain).
        // 原实现要求 cfg.RefererChain && cfg.RefererURL != "" 才用 cfg.RefererURL, 与
        // buildHeaders 不对称, curl 路径会暴露给目标站一个 origin Referer 而非用户配置的 URL.
        domain := originHost(rawURL)
        if cfg.Referer {
                var ref string
                if cfg.RefererURL != "" {
                        ref = cfg.RefererURL
                } else if rh := GetHostReferer(domain); rh != "" {
                        ref = rh
                } else if u, err := url.Parse(rawURL); err == nil {
                        ref = u.Scheme + "://" + u.Host + "/"
                }
                if ref != "" {
                        args = append(args, "-H", "Referer: "+ref)
                }
        }
        // Cookie (用户配置 + CookieJar)
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
        // 自定义 headers (剥控制字符, 与 buildHeaders 同款)
        for k, v := range cfg.Headers {
                k = stripControlChars(k)
                v = stripControlChars(v)
                if k != "" {
                        args = append(args, "-H", k+": "+v)
                }
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
        // 成功: 记 per-host Referer (与 fetchHttp 同款)
        SetHostReferer(rawURL)
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
        // R41-1A: 用 globalHttp (复用全局 transport + 连接池), 取代 http.DefaultClient
        resp, err := globalHttp.Do(req)
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
                return "", errors.New("obscura bridge unavailable")
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

// fetchHttpWithCurlFallback — native fetch + utls fallback + curl 二进制降级.
//  - native fetch (标准 TLS) 失败 → utls Chrome TLS 指纹重试 (R42-1B 新增)
//  - utls 失败 → exec curl (OpenSSL 栈, 防 undici 在线热更新)
//  - curl 失败 → 抛错 (上层 fetchPageOnce 会继续走桥降级链)
//
// R42-1B 反反爬增强: 新增 utls 中间层. Cloudflare / Akamai / DataDome 等会基于
// TLS ClientHello 识别 Go 标准库指纹 (crypto/tls 是固定扩展顺序 + 固定 cipher
// suite 列表), 拒绝服务. utls 模拟 Chrome TLS 指纹 (GREASE + Chrome 扩展顺序 +
// X25519Kyber768Draft00 curve) 可绕过.
//
// R43-1B 反反爬增强: 网络层失败时调 MarkProxyFailed, 让代理池健康跟踪生效
// (R42-1B 后 proxyInst.failedUntil 是死字段, 本轮修复让 pickProxyFor 能跳过
// 失败代理). 成功路径调 MarkProxyOK 清除冷却.
func fetchHttpWithCurlFallback(ctx context.Context, rawURL string, cfg FetchConfig, ua string) (string, error) {
        proxy := pickProxyFor(rawURL, cfg)
        // native (net/http, 标准 TLS)
        html, err := fetchHttp(ctx, rawURL, cfg, ua, proxy, nil)
        if err == nil {
                MarkProxyOK(proxy)
                return html, nil
        }
        // 网络层错误 + 有代理 → 标记代理失败 (让 pickProxyFor 跳过该代理)
        if proxy != "" && isRetriableNetErr(err) {
                MarkProxyFailed(proxy, 30000)
        }
        // R42-1B: TLS 指纹错误 → utls Chrome 重试 (无代理, 直连)
        if isTLSFingerprintError(err) && proxy == "" {
                if htmlUtls, errUtls := fetchHttp(ctx, rawURL, cfg, ua, "", globalUtlsTransport); errUtls == nil {
                        return htmlUtls, nil
                }
        }
        // 检查错误是否可降级 (网络层 / TLS 错误 / Timeout)
        if !isCurlFallbackError(err) {
                return "", err
        }
        // curl 二进制降级
        html2, err2 := fetchViaCurl(ctx, rawURL, cfg, ua, proxy)
        if err2 == nil {
                MarkProxyOK(proxy)
                return html2, nil
        }
        // curl 也失败 + 有代理 → 标记代理失败
        if proxy != "" {
                MarkProxyFailed(proxy, 30000)
        }
        // 返回 native 的错误 (含状态码 / WAF 头)
        return "", err
}

// isTLSFingerprintError — 错误是否疑似 TLS 指纹识别 (Go 标准库 crypto/tls 指纹被识别).
// 关键词: "tls:" / "handshake failure" / "remote error" / "protocol version".
// 403/412 + 空 body 也可能是 TLS 指纹识别 (服务端拒绝而不返 body).
func isTLSFingerprintError(err error) bool {
        if err == nil {
                return false
        }
        s := err.Error()
        if strings.Contains(s, "tls:") || strings.Contains(s, "handshake failure") ||
                strings.Contains(s, "remote error") || strings.Contains(s, "protocol version") ||
                strings.Contains(s, "no cipher suite") {
                return true
        }
        if he, ok := err.(*HTTPError); ok {
                if (he.StatusCode == 403 || he.StatusCode == 412) && (he.Body == "" || len(he.Body) < 256) {
                        return true
                }
        }
        return false
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
// R41-1A: 增加 lastSweptAt 字段 (周期性清扫 useCount / failedUntil, 防长跑进程内存泄漏).
type proxyState struct {
        mu              sync.Mutex
        failedUntil     map[string]int64
        useCount        map[string]int
        lastIdx         int
        lastSweptAt     int64
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
// R41-1A: 增加 useCount 周期性清扫 (原实现 useCount map 只增不减, 长跑进程内存泄漏).
//         每 5min 清一次未使用条目 (useCount 0 或超过 24h 未使用).
// R43-1B: 修复 failedUntil 死字段 — 添加 MarkProxyFailed 让网络层错误能标记代理冷却 30s,
//         pickProxyFor 跳过冷却内代理. R42-1B 后该字段从未被写入, 代理健康跟踪完全失效.
// R45-1A: 增加 parsedProxyPoolCache 缓存 ParseProxyPool 结果 (原实现每次 pickProxyFor
//         都 Split + 校验, 高频路径浪费 CPU). 代理池字符串变更时 (含5min sweep) 重算.
func pickProxyFor(rawURL string, cfg FetchConfig) string {
        pool := parsedProxyPoolCached(cfg.ProxyURL)
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
        // R41-1A: 周期性清扫 useCount (惰性, 每 5min)
        if now-proxyInst.lastSweptAt > 5*60*1000 {
                proxyInst.lastSweptAt = now
                // 清当前 pool 之外的条目 (代理池可能动态变化)
                poolSet := map[string]bool{}
                for _, p := range pool {
                        poolSet[p] = true
                }
                for k := range proxyInst.useCount {
                        if !poolSet[k] {
                                delete(proxyInst.useCount, k)
                        }
                }
                // R42-1B: 清当前 pool 之外的失败冷却条目 (原实现只清过期的, 不清 pool 之外的,
                // 长跑进程代理池动态变化后会留下陈旧条目)
                for k := range proxyInst.failedUntil {
                        if !poolSet[k] {
                                delete(proxyInst.failedUntil, k)
                        }
                }
                // 清过期的失败冷却条目
                for k, t := range proxyInst.failedUntil {
                        if t < now {
                                delete(proxyInst.failedUntil, k)
                        }
                }
                // R45-1A: 同时清 parsedProxyPoolCache (下次 pick 重算, 同步动态变更)
                proxyPoolCacheMu.Lock()
                proxyPoolCacheKey = ""
                proxyPoolCache = nil
                proxyPoolCacheAt = 0
                proxyPoolCacheMu.Unlock()
        }
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

// R45-1A: parsedProxyPoolCache — 高频路径缓存, 避免每次 pickProxyFor 都 Split + 校验.
// 代理池字符串变更时 (5min sweep 重算 + MarkProxyFailed/OK 不重算因不涉及字符串) 同步重算.
var (
        proxyPoolCacheMu sync.Mutex
        proxyPoolCacheKey string
        proxyPoolCache    []string
        proxyPoolCacheAt  int64
)

// parsedProxyPoolCached — 带缓存的 ParseProxyPool. 60s TTL 防止 cfg.ProxyURL 动态变更
// 后长时不重算. 频率高 (每章节 pick 一次), 缓存命中率 >99%.
func parsedProxyPoolCached(proxyURL string) []string {
        proxyPoolCacheMu.Lock()
        defer proxyPoolCacheMu.Unlock()
        now := time.Now().UnixMilli()
        if proxyPoolCacheKey == proxyURL && proxyPoolCache != nil && now-proxyPoolCacheAt < 60*1000 {
                // 返回副本 (防调用方污染)
                out := make([]string, len(proxyPoolCache))
                copy(out, proxyPoolCache)
                return out
        }
        parsed := ParseProxyPool(proxyURL)
        proxyPoolCacheKey = proxyURL
        proxyPoolCache = parsed
        proxyPoolCacheAt = now
        if parsed == nil {
                return nil
        }
        out := make([]string, len(parsed))
        copy(out, parsed)
        return out
}

// MarkProxyFailed — 标记代理失败, 冷却 ms (R43-1B 反反爬增强).
// R42-1B 后 proxyInst.failedUntil 是死字段 (从未被写入), 代理健康跟踪完全失效.
// 调用方在 transport 层错误 (连接重置 / 超时 / 5xx) 时调本函数, 让 pickProxyFor
// 在冷却内跳过该代理. 默认冷却 30s; cooldownMs <= 0 用默认值.
func MarkProxyFailed(proxyURL string, cooldownMs int) {
        if proxyURL == "" {
                return
        }
        if cooldownMs <= 0 {
                cooldownMs = 30000
        }
        proxyInst.mu.Lock()
        defer proxyInst.mu.Unlock()
        proxyInst.failedUntil[proxyURL] = time.Now().UnixMilli() + int64(cooldownMs)
}

// MarkProxyOK — 标记代理健康 (清除冷却). 调用方在成功响应后调本函数.
func MarkProxyOK(proxyURL string) {
        if proxyURL == "" {
                return
        }
        proxyInst.mu.Lock()
        defer proxyInst.mu.Unlock()
        delete(proxyInst.failedUntil, proxyURL)
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
//
// R42-1B 反反爬增强: Turnstile 8s 截止. 当 LooksLikeCaptcha 返回 CaptchaTurnstile,
// 单独调 fetchViaObscura (cloak-browser puppeteer 可自动点击 Turnstile 通过), 给 8s
// 截止 (Turnstile 自动通过一般在 3-5s). 通过则继续走后续解析; 超时则返回 blocked
// (调用方按 hostGate.ReportFailure 处理).
//
// R43-1B 反反爬增强: 2captcha 服务求解 h-captcha / reCAPTCHA. 当 LooksLikeCaptcha
// 返回 CaptchaHCaptcha / CaptchaRecaptcha 且 cfg.TwoCaptchaAPIKey != "" 时, 调
// 2captcha API 提交任务, 等待 token (180s 截止), 注入到 URL query 重抓. 成功
// 返回 FetchResult{HTML: solvedHTML, Engine: "browser", Blocked: false, CaptchaDetected: false}.
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
                        // R43-1B: h-captcha / reCAPTCHA → 调 2captcha 服务 (配置 API key 时启用).
                        // 优先于 Turnstile 路径 (Turnstile 走 Obscura 桥 puppeteer 点击更稳定,
                        // 2captcha 仅处理 h-captcha / reCAPTCHA).
                        if ct == CaptchaHCaptcha || ct == CaptchaRecaptcha {
                                if solved := trySolveCaptchaWith2Captcha(ctx, rawURL, cfg, ct, html); solved != "" {
                                        return &FetchResult{HTML: solved, Engine: "browser", Blocked: false}, nil
                                }
                        }
                        // R42-1B: Turnstile 8s 截止 — 调 Obscura 桥让 puppeteer 点击通过
                        if ct == CaptchaTurnstile {
                                if solved := trySolveTurnstile(ctx, rawURL, cfg, ua); solved != "" {
                                        // 二次确认: 通过后不再是 captcha
                                        if LooksLikeCaptcha(solved) == "" {
                                                return &FetchResult{HTML: solved, Engine: "browser", Blocked: false}, nil
                                        }
                                }
                        }
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
                        // R43-1B: 错误路径也尝试 2captcha 求解 (h-captcha / reCAPTCHA 返 403)
                        if ct := LooksLikeCaptcha(he.Body); ct == CaptchaHCaptcha || ct == CaptchaRecaptcha {
                                if solved := trySolveCaptchaWith2Captcha(ctx, rawURL, cfg, ct, he.Body); solved != "" {
                                        return &FetchResult{HTML: solved, Engine: "browser", Blocked: false}, nil
                                }
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
                        // R43-1B: 桥路径也支持 2captcha (h-captcha / reCAPTCHA)
                        if ct == CaptchaHCaptcha || ct == CaptchaRecaptcha {
                                if solved := trySolveCaptchaWith2Captcha(ctx, rawURL, cfg, ct, bridged); solved != "" {
                                        return &FetchResult{HTML: solved, Engine: "browser", Blocked: false}, nil
                                }
                        }
                        // R42-1B: Turnstile 8s 截止 (桥路径也支持)
                        if ct == CaptchaTurnstile {
                                if solved := trySolveTurnstile(ctx, rawURL, cfg, ua); solved != "" {
                                        if LooksLikeCaptcha(solved) == "" {
                                                return &FetchResult{HTML: solved, Engine: "browser", Blocked: false}, nil
                                        }
                                }
                        }
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

// trySolveTurnstile — 用 Obscura 桥 (puppeteer-extra stealth) 尝试通过 Turnstile 验证.
// R42-1B 反反爬增强: 给 8s 截止 (Turnstile 自动通过一般 3-5s). 失败/超时返回空字符串.
// Obscura 桥通过 cloak-browser / 3020 端口 (与 fetchViaObscura 同款), 但加 tier=maximum
// 让 puppeteer 加载完整 stealth 栈 (含 Turnstile 自动点击插件).
func trySolveTurnstile(ctx context.Context, rawURL string, cfg FetchConfig, ua string) string {
        turnstileCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
        defer cancel()
        bridgeURL := cfg.CloakBrowserURL
        if bridgeURL == "" {
                bridgeURL = "http://127.0.0.1:3020/fetch"
        }
        // tier=maximum: puppeteer 加载完整 stealth 栈 + Turnstile 自动点击
        maxCfg := cfg
        maxCfg.CloakTier = "maximum"
        maxCfg.CloakBrowserURL = bridgeURL
        html, err := fetchViaObscura(turnstileCtx, rawURL, maxCfg, ua)
        if err != nil || html == "" {
                return ""
        }
        return html
}

// ---------- 2captcha 验证码服务 (R43-1B 反反爬增强) ----------
//
// 2captcha 是商业验证码求解服务 (https://2captcha.com). 提交 h-captcha /
// reCAPTCHA / Turnstile sitekey + URL, 服务返回 token (g-recaptcha-response /
// h-captcha-response / cf-turnstile-response). 调用方把 token 注入到页面
// (通常通过 URL query 或 cookie), 再次 fetch 即可通过.
//
// 流程:
//   1. extractCaptchaSitekey(html, ct) — 从 HTML 提取 sitekey (data-sitekey 属性)
//   2. submitCaptchaTo2Captcha(apiKey, ct, sitekey, pageURL) — POST /in.php,
//      返回 captcha_id
//   3. pollCaptchaResult(apiKey, captchaID) — GET /res.php, 轮询 5s 间隔直到
//      OK|<token> 或超时 (默认 180s)
//   4. applyCaptchaToken(rawURL, ct, token) — 把 token 注入到 URL query 重抓
//      (g-recaptcha-response / h-captcha-response / cf-turnstile-response)
//
// 成本: 2captcha h-captcha/reCAPTCHA $2.99/1000 次, Turnstile $1.99/1000 次.
// 配置 cfg.TwoCaptchaAPIKey 后启用, 不配置走原 Obscura 桥路径.

// captchaSitekeyRe — 提取 captcha sitekey (data-sitekey 属性).
var captchaSitekeyRe = regexp.MustCompile(`(?i)data-sitekey=["']?([A-Za-z0-9_-]{20,})["']?`)

// extractCaptchaSitekey — 从 HTML 提取 captcha sitekey. 失败返回空.
func extractCaptchaSitekey(html string) string {
        m := captchaSitekeyRe.FindStringSubmatch(html)
        if len(m) < 2 {
                return ""
        }
        return m[1]
}

// submitCaptchaTo2Captcha — POST /in.php 提交 captcha 任务.
// 返回 captcha_id (2captcha 侧任务 ID). 失败返回空.
// R45-1A 反反爬修复: 原实现用 globalHttp.Do(req) 不设 UA, 默认 Go-http-client/1.1
//   UA 被 2captcha Cloudflare 检测为 bot 拦截. 补全 UA + Accept + Accept-Language
//   + Accept-Encoding 与 buildHeaders 同款 (浏览器象同指纹). 增加单次请求 10s 超时, 
//   避免提交超时连接报连 180s.
func submitCaptchaTo2Captcha(ctx context.Context, apiKey string, ct CaptchaType, sitekey, pageURL string) string {
        if apiKey == "" || sitekey == "" || pageURL == "" {
                return ""
        }
        method := ""
        switch ct {
        case CaptchaRecaptcha:
                method = "userrecaptcha"
        case CaptchaHCaptcha:
                method = "hcaptcha"
        case CaptchaTurnstile:
                method = "turnstile"
        default:
                return ""
        }
        form := url.Values{}
        form.Set("key", apiKey)
        form.Set("method", method)
        form.Set("sitekey", sitekey)
        form.Set("pageurl", pageURL)
        form.Set("json", "1")
        // R45-1A: 每次尝试 10s 超时 (原 仅依赖 parent ctx 180s, 2captcha 挂连连接会报连 180s)
        submitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
        defer cancel()
        req, err := http.NewRequestWithContext(submitCtx, "POST", "https://2captcha.com/in.php", strings.NewReader(form.Encode()))
        if err != nil {
                return ""
        }
        req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
        applyBrowserLikeHeaders(req)
        // R45-1A: globalHttp (与 fetcher 同口径, 复用进程级 transport + 连接池)
        resp, err := globalHttp.Do(req)
        if err != nil {
                return ""
        }
        defer resp.Body.Close()
        body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
        var data struct {
                Status  int    `json:"status"`
                Request string `json:"request"`
        }
        if err := json.Unmarshal(body, &data); err != nil {
                return ""
        }
        if data.Status != 1 {
                return ""
        }
        return data.Request
}

// applyBrowserLikeHeaders — 为外调 API (2captcha / anti-captcha) 补全浏览器象同请求头.
// R45-1A: 原实现仅设 Content-Type, 默认 Go-http-client/1.1 UA 被 2captcha/anti-captcha
//   Cloudflare 检测为 bot 拦截, 返 403 → token 永远拿不到 → 180s 超时. 补 UA + Accept
//   + Accept-Language + Accept-Encoding 与 buildHeaders 同款.
func applyBrowserLikeHeaders(req *http.Request) {
        req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        req.Header.Set("Accept", "application/json, text/plain, */*;q=0.8")
        req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        req.Header.Set("Accept-Encoding", "gzip, deflate")
}

// pollCaptchaResult — 轮询 /res.php 直到 token 返回或超时 (默认 180s).
// 2captcha 文档: 平均 12-30s, 上限 180s.
// R45-1A: 每轮诹求 15s 超时 (原仅依赖 parent 180s, 2captcha 挂连接 → 180s 才能出循环).
//   并补全浏览器象同头 (applyBrowserLikeHeaders) 防 Cloudflare bot 检测.
func pollCaptchaResult(ctx context.Context, apiKey, captchaID string) string {
        if apiKey == "" || captchaID == "" {
                return ""
        }
        pollCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
        defer cancel()
        for {
                select {
                case <-pollCtx.Done():
                        return ""
                case <-time.After(5 * time.Second):
                }
                // R45-1A: 每轮 15s 超时, 避免挂连接报满 180s
                reqCtx, reqCancel := context.WithTimeout(pollCtx, 15*time.Second)
                q := url.Values{}
                q.Set("key", apiKey)
                q.Set("action", "get")
                q.Set("id", captchaID)
                q.Set("json", "1")
                req, err := http.NewRequestWithContext(reqCtx, "GET", "https://2captcha.com/res.php?"+q.Encode(), nil)
                if err != nil {
                        reqCancel()
                        continue
                }
                applyBrowserLikeHeaders(req)
                resp, err := globalHttp.Do(req)
                reqCancel()
                if err != nil {
                        continue
                }
                body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
                resp.Body.Close()
                var data struct {
                        Status  int    `json:"status"`
                        Request string `json:"request"`
                }
                if err := json.Unmarshal(body, &data); err != nil {
                        continue
                }
                if data.Status == 1 {
                        return data.Request
                }
                // CAPCHA_NOT_READY → 继续轮询
                if data.Request == "CAPCHA_NOT_READY" {
                        continue
                }
                // 其它错误 → 终止
                return ""
        }
}

// trySolveCaptchaWith2Captcha — 用 2captcha 服务求解 h-captcha / reCAPTCHA.
// 成功返回注入 token 后的页面 HTML, 失败返回空.
// 注: Turnstile 走 trySolveTurnstile (Obscura 桥 puppeteer 点击更稳定),
// 2captcha 仅处理 h-captcha / reCAPTCHA (服务端 token 注入即可通过).
// R45-1A: 2captcha 不可用 / API key 未配置时, 自动 fallback 到 anti-captcha 服务
//   (cfg.AntiCaptchaAPIKey). 两个服务各试一次, 单服务超时由 caller 处理.
func trySolveCaptchaWith2Captcha(ctx context.Context, rawURL string, cfg FetchConfig, ct CaptchaType, html string) string {
        if ct != CaptchaHCaptcha && ct != CaptchaRecaptcha {
                return ""
        }
        sitekey := extractCaptchaSitekey(html)
        if sitekey == "" {
                return ""
        }
        // 2captcha 优先 (R43-1B 已实现, R45-1A 补 UA + per-attempt timeout 修复)
        if cfg.TwoCaptchaAPIKey != "" {
                if solved := trySolveCaptchaWith2CaptchaInner(ctx, rawURL, cfg, ct, sitekey); solved != "" {
                        return solved
                }
        }
        // R45-1A: 2captcha 失败 → anti-captcha 备用
        if cfg.AntiCaptchaAPIKey != "" {
                if solved := trySolveCaptchaWithAntiCaptcha(ctx, rawURL, cfg, ct, sitekey); solved != "" {
                        return solved
                }
        }
        return ""
}

// trySolveCaptchaWith2CaptchaInner — 2captcha 实际请求逻辑 (R45-1A 拆出供 fallback 复用).
func trySolveCaptchaWith2CaptchaInner(ctx context.Context, rawURL string, cfg FetchConfig, ct CaptchaType, sitekey string) string {
        // 180s 截止 (2captcha 平均 12-30s)
        solveCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
        defer cancel()
        captchaID := submitCaptchaTo2Captcha(solveCtx, cfg.TwoCaptchaAPIKey, ct, sitekey, rawURL)
        if captchaID == "" {
                return ""
        }
        token := pollCaptchaResult(solveCtx, cfg.TwoCaptchaAPIKey, captchaID)
        if token == "" {
                return ""
        }
        return applyCaptchaTokenAndRefetch(ctx, rawURL, cfg, ct, token)
}

// applyCaptchaTokenAndRefetch — 把 captcha token 注入 URL query 重抓 (R45-1A 抽出供
// 2captcha / anti-captcha 复用). 二次确认 LooksLikeCaptcha(solved) == "" 才返非空.
func applyCaptchaTokenAndRefetch(ctx context.Context, rawURL string, cfg FetchConfig, ct CaptchaType, token string) string {
        if token == "" {
                return ""
        }
        // 注入 token 到 URL query, 重抓 (服务端校验通过后返正常页)
        sep := "&"
        if !strings.Contains(rawURL, "?") {
                sep = "?"
        }
        var paramName string
        switch ct {
        case CaptchaHCaptcha:
                paramName = "h-captcha-response"
        case CaptchaRecaptcha:
                paramName = "g-recaptcha-response"
        default:
                return ""
        }
        solvedURL := rawURL + sep + paramName + "=" + url.QueryEscape(token)
        solvedHTML, err := fetchHttpWithCurlFallback(ctx, solvedURL, cfg, PickUAFor(originHost(rawURL), cfg))
        if err != nil || solvedHTML == "" {
                return ""
        }
        // 二次确认: 通过后不再是 captcha
        if LooksLikeCaptcha(solvedHTML) == "" {
                return solvedHTML
        }
        return ""
}

// ---------- anti-captcha 服务 (R45-1A 反反爬增强) ----------
//
// anti-captcha (https://anti-captcha.com) 是 2captcha 的竞品, API 接口略有差异:
//   - 提交: POST /createTask body={"clientKey", "task": {...}}, 返 {"taskId"}
//   - 轮询: POST /getTaskResult body={"clientKey", "taskId"}, 返 {"status": "ready", "solution": {...}}
//
// 价格相当 ($1.5-3/1000 次), 但部分场景下成功率高于 2captcha. 作为 fallback 配置
// cfg.AntiCaptchaAPIKey 后启用, 2captcha 失败 (超时/返错/未配置) 时调用.

// submitCaptchaToAntiCaptcha — POST /createTask 提交 captcha 任务.
// 返回 taskId. 失败返回空.
func submitCaptchaToAntiCaptcha(ctx context.Context, apiKey string, ct CaptchaType, sitekey, pageURL string) string {
        if apiKey == "" || sitekey == "" || pageURL == "" {
                return ""
        }
        var taskType string
        switch ct {
        case CaptchaRecaptcha:
                taskType = "NoCaptchaTaskProxyless"
        case CaptchaHCaptcha:
                taskType = "HCaptchaTaskProxyless"
        default:
                return ""
        }
        payload := map[string]any{
                "clientKey": apiKey,
                "task": map[string]any{
                        "type":     taskType,
                        "websiteURL": pageURL,
                        "websiteKey": sitekey,
                },
        }
        body, err := json.Marshal(payload)
        if err != nil {
                return ""
        }
        submitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
        defer cancel()
        req, err := http.NewRequestWithContext(submitCtx, "POST", "https://api.anti-captcha.com/createTask", bytes.NewReader(body))
        if err != nil {
                return ""
        }
        applyBrowserLikeHeaders(req)
        req.Header.Set("Content-Type", "application/json")
        resp, err := globalHttp.Do(req)
        if err != nil {
                return ""
        }
        defer resp.Body.Close()
        respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
        var data struct {
                ErrorID          int    `json:"errorId"`
                TaskID           int    `json:"taskId"`
                ErrorCode       string `json:"errorCode"`
        }
        if err := json.Unmarshal(respBody, &data); err != nil {
                return ""
        }
        if data.ErrorID != 0 {
                return ""
        }
        if data.TaskID == 0 {
                return ""
        }
        return fmt.Sprintf("%d", data.TaskID)
}

// pollAntiCaptchaResult — 轮询 /getTaskResult 直到 token 返回或超时.
// 5s 间隔轮询, 180s 上限, 每轮 15s 超时.
func pollAntiCaptchaResult(ctx context.Context, apiKey, taskID string) string {
        if apiKey == "" || taskID == "" {
                return ""
        }
        pollCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
        defer cancel()
        for {
                select {
                case <-pollCtx.Done():
                        return ""
                case <-time.After(5 * time.Second):
                }
                reqCtx, reqCancel := context.WithTimeout(pollCtx, 15*time.Second)
                payload, _ := json.Marshal(map[string]any{
                        "clientKey": apiKey,
                        "taskId":    taskID,
                })
                req, err := http.NewRequestWithContext(reqCtx, "POST", "https://api.anti-captcha.com/getTaskResult", bytes.NewReader(payload))
                if err != nil {
                        reqCancel()
                        continue
                }
                applyBrowserLikeHeaders(req)
                req.Header.Set("Content-Type", "application/json")
                resp, err := globalHttp.Do(req)
                reqCancel()
                if err != nil {
                        continue
                }
                respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
                resp.Body.Close()
                var data struct {
                        ErrorID  int    `json:"errorId"`
                        Status   string `json:"status"`
                        Solution struct {
                                GRecaptchaResponse string `json:"gRecaptchaResponse"`
                                Token              string `json:"token"`
                        } `json:"solution"`
                }
                if err := json.Unmarshal(respBody, &data); err != nil {
                        continue
                }
                if data.ErrorID != 0 {
                        return ""
                }
                if data.Status == "ready" {
                        if data.Solution.GRecaptchaResponse != "" {
                                return data.Solution.GRecaptchaResponse
                        }
                        if data.Solution.Token != "" {
                                return data.Solution.Token
                        }
                }
                // processing → 继续轮询
        }
}

// trySolveCaptchaWithAntiCaptcha — 用 anti-captcha 服务求解 h-captcha / reCAPTCHA.
// 成功返回注入 token 后的页面 HTML, 失败返回空.
func trySolveCaptchaWithAntiCaptcha(ctx context.Context, rawURL string, cfg FetchConfig, ct CaptchaType, sitekey string) string {
        if cfg.AntiCaptchaAPIKey == "" {
                return ""
        }
        if ct != CaptchaHCaptcha && ct != CaptchaRecaptcha {
                return ""
        }
        taskID := submitCaptchaToAntiCaptcha(ctx, cfg.AntiCaptchaAPIKey, ct, sitekey, rawURL)
        if taskID == "" {
                return ""
        }
        token := pollAntiCaptchaResult(ctx, cfg.AntiCaptchaAPIKey, taskID)
        if token == "" {
                return ""
        }
        return applyCaptchaTokenAndRefetch(ctx, rawURL, cfg, ct, token)
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
        if override.TwoCaptchaAPIKey != "" {
                out.TwoCaptchaAPIKey = override.TwoCaptchaAPIKey
        }
        if override.AntiCaptchaAPIKey != "" {
                out.AntiCaptchaAPIKey = override.AntiCaptchaAPIKey
        }
        return out
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
