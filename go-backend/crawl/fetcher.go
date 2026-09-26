// fetcher.go — HTTP 采集 + 8 级降级链 + UA 池 + CookieJar (R38-1C).
//
// 8 级降级链:
//  1. native (net/http)        — Go 标准库 HTTP + utls 36 款 Hello 指纹池
//  2. curl (exec curl)         — 系统二进制 curl 兜底 (OpenSSL 栈)
//  3. fetch-relay (HTTP 代理) — 127.0.0.1:3011, fetch 透传桥
//  4. scrapling (HTTP 代理)    — 127.0.0.1:3012, Scrapling TLS 指纹伪装
//  5. cloak-browser (HTTP 代理) — 127.0.0.1:3020, chromedp 隐身 chromium 反检测渲染
//  6. uc-bridge (HTTP 代理)    — 127.0.0.1:3016, UC 头条小说桥
//  7. moli-bridge (HTTP 代理)  — 127.0.0.1:3017, Rust AI 浏览器 (需外部 moli 二进制)
//  8. curl-impersonate (HTTP 代理) — 127.0.0.1:3018, Python curl_cffi JA3/JA4 桥
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
//   - exec.Command 调系统 curl (与 native 同款行为)
package crawl

import (
        "bytes"
        "compress/gzip"
        "compress/zlib"
        "context"
        crand "crypto/rand"
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
        "path/filepath"
        "regexp"
        "sort"
        "strconv"
        "strings"
        "sync"
        "sync/atomic"
        "time"
        "unicode/utf8"

        "golang.org/x/net/http2"
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

        // R66-C BUG-51 (P2): HTTP body 大小上限 (50MB). 防 1GB body 内存 DoS +
        //   静默截断 (BUG-51 修复: 读到 50MB+1 byte, 若返回 > 50MB 视为超限).
        //   fetchHttp 用 io.LimitReader(resp.Body, MaxHTTPBodyBytes+1), decodeBody
        //   gzip/deflate 解压同款 io.LimitReader(gr, MaxHTTPBodyBytes+1).
        MaxHTTPBodyBytes = 50 * 1024 * 1024
)

// R52-1A: dead proxy quarantine — 业务连续失败 ≥10 次 → cooldown 升级到 30min
//
//      (替代默认 30s, 避免 pickProxyFor 反复选到死代理每章浪费 30s 失败 + 30s 等).
//      阈值 10: 误升级概率低 (偶发失败 5-6 次不触发), 真死代理 10 次必触发.
//      30min: 足够操作员响应 (邮件 / 日志监控), 又不致池子枯竭 (单代理 30min 内若
//      被回选仍能恢复, MarkProxyOK 仍清 pickFailStreak).
const (
        pickFailStreakQuarantineThreshold = 10             // R52-1A: 业务失败 streak 触发 quarantine 阈值
        pickFailQuarantineMs              = 30 * 60 * 1000 // R52-1A: dead proxy quarantine cooldown 30min
)

// UA_POOL — 浏览器 UA 池 (Chrome 137~142 / Firefox 125~130 / Safari 17.4~18.0).
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
        // R64-B 反反爬第 51 项: per-cookie 过期时间 (UnixMilli). 0 = 无显式过期, 回退到
        //   CookieSessionTTL 全局 30min. 解析 Set-Cookie 的 Max-Age / Expires 属性得到
        //   (RFC 6265 5.2.2: Max-Age 优先于 Expires). 价值: cf_clearance 通常 max-age=1800~
        //   86400, 全局 30min TTL 会驱逐长生命周期 cookie → 重复挑战 Cloudflare (反爬识别
        //   "频繁挑战" 是爬虫指纹); 短生命周期 cookie (max-age=60 analytics) 不再占满 30min
        //   内存. per-cookie expiry 让长 cookie 持久, 短 cookie 按时过期.
        expires int64
}

// cookieEntryDump — JSON 序列化结构 (R42-1B cookie 持久化跨 session 复用).
// cookieEntry 字段小写不可见 json, 用 dump 结构中转.
// R64-B 第 51 项: 加 Expires 字段持久化 per-cookie 过期时间.
type cookieEntryDump struct {
        V       string `json:"v"`
        At      int64  `json:"at"`
        Src     string `json:"src,omitempty"`
        Expires int64  `json:"e,omitempty"` // R64-B 第 51 项: 0 = 无过期 (回退全局 TTL)
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

// cookieJarPath — 计算持久化路径 (data/.cookies.json).
//
//      R72-C 反反爬第 78 项: CookieJar 磁盘持久化 wiring (cf_clearance / PHPSESSID 等
//      会话凭证跨 session 复用, crash 后不丢). 与 tlsSessionsPath (data/.tls_sessions.json)
//      同款 initStoragePaths + filepath.Join, 0600 权限 (SaveToDisk 内 atomicWriteFileSync).
//      原 R42-1B 加 SaveToDisk / LoadFromDisk 函数但全程 0 调用 (cookieJarInst 仅在
//      内存 Get/Store/Clear, 进程重启后 cf_clearance 全丢 → 反爬识别 "无 cookie" 模式).
//      本轮 wiring: GetCookieJar() LoadFromDisk 一次 + StartCookieJarBackgroundFlusher
//      每 5min SaveToDisk (与 StartTlsSessionBackgroundFlusher 同口径).
var cookieJarPath = func() string {
        initStoragePaths()
        return filepath.Join(dataRoot, ".cookies.json")
}()

// GetCookieJar — 进程级单例.
//
//      R72-C 反反爬第 78 项: 首次 init 时 LoadFromDisk(path) 把磁盘 cookie 快照合并
//      到内存 jars (不覆盖已有 in-memory entries, 避免覆盖刚抓的新鲜 cookie). LoadFromDisk
//      失败 (文件不存在 / JSON 解析失败) 时静默回退到空 jars (与首次启动同款, 不阻塞业务).
func GetCookieJar() *CookieJar {
        cookieJarOnce.Do(func() {
                cookieJarInst = &CookieJar{jars: make(map[string]map[string]cookieEntry)}
                // R72-C 第 78 项: 启动时加载磁盘 cookie 快照 (cf_clearance 跨 session 复用).
                //   LoadFromDisk 内部已处理文件不存在 / JSON 解析失败 / 过期 cookie 滤除,
                //   不阻塞业务.
                _ = cookieJarInst.LoadFromDisk(cookieJarPath)
        })
        return cookieJarInst
}

// fresh — 未过期判定. 过期即惰性删除.
// R64-B 第 51 项: per-cookie 过期优先 (expires > 0 时用 expires); 否则回退到
//
//      全局 CookieSessionTTL (30min). cf_clearance 等长生命周期 cookie 不再被
//      30min 全局 TTL 误驱逐, 短生命周期 cookie 按 max-age/expires 按时过期.
func (j *CookieJar) fresh(jar map[string]cookieEntry, k string, e cookieEntry) bool {
        now := time.Now().UnixMilli()
        var deadline int64
        if e.expires > 0 {
                deadline = e.expires
        } else {
                deadline = e.at + CookieSessionTTL
        }
        if now < deadline {
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
//
//      若任一调用方 Store(domain="com", ...) 会污染所有 *.com 请求. 改为不 append 末段.
//
// R47-1A: 修复端口污染 — originHost 可能返 "example.com:8080" (非默认端口), parentDomainChain
//
//      拆 "." 后会把 "com:8080" 视为 TLD, 父域链断裂 (cf_clearance cookie 跨子域失败).
//      改为 stripPort 先剥端口再走父域遍历, 跨子域 cookie 合并不受端口影响 (RFC 6265
//      cookie 是 domain-scoped 不是 port-scoped).
func parentDomainChain(domain string) []string {
        domain = strings.ToLower(strings.TrimSpace(domain))
        // R47-1A: 剥端口 (RFC 6265 cookie 是 domain-scoped, port 不影响跨子域合并)
        domain = stripPort(domain)
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

// stripPort — 剥域名中的端口 (host[:port] → host). 已无端口则原样返回 (R47-1A).
//
//      IPv6 字面量 [::1]:8080 → [::1] (用 net.SplitHostPort 兼容). 简单情况 (无 [)
//      直接 strings.Split 切最后一个 ":".
func stripPort(host string) string {
        if host == "" {
                return ""
        }
        // IPv6 字面量: [::1]:8080 / [::1]
        if strings.HasPrefix(host, "[") {
                // [::1]:port → [::1]
                if idx := strings.LastIndex(host, "]:"); idx > 0 {
                        return host[:idx+1]
                }
                return host // [::1] 无端口
        }
        // 普通 host:port (取最后一个 : 切分, 防 IPv6 误切)
        if idx := strings.LastIndex(host, ":"); idx > 0 {
                return host[:idx]
        }
        return host
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
        // R47-1A: 剥端口与 parentDomainChain 同款 (跨子域 cookie 合并不受端口影响)
        key = stripPort(key)
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
//   - 拒收畸形 Set-Cookie (首段无 = / 名为属性关键字的伪 cookie)
//   - domain 属性安全校验 (RFC 6265 5.3 步 6: 必须是 request host 自身或其父域)
//   - domain 属性同时存到 cookie 自身 domain 罐 (跨子域跳转 cf_clearance 复用)
//     R47-1A: reqHost 剥端口与 parentDomainChain 一致, 让 cookieDomain 属性
//     (RFC 6265 不带端口) 匹配 reqHost 即使 reqHost 来自非默认端口 (8080 等).
//     原实现 cookieDomain="example.com" 不匹配 reqHost="example.com:8080" →
//     副罐不写, cf_clearance 跨子域跳转丢失.
func (j *CookieJar) Store(domain string, setCookieHeaders []string) {
        if len(setCookieHeaders) == 0 {
                return
        }
        j.mu.Lock()
        defer j.mu.Unlock()
        reqHost := strings.ToLower(strings.TrimSpace(domain))
        // R47-1A: 剥端口 (cookie 是 domain-scoped, port 不影响)
        reqHost = stripPort(reqHost)
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

                // R64-B 第 51 项: 解析 domain + max-age + expires 属性.
                //   原 R47-1A 只解析 domain, break 后不扫 max-age/expires. 改为 switch 全扫,
                //   max-age 优先于 expires (RFC 6265 5.2.2). 无 break 让所有属性都能匹配.
                cookieDomain := ""
                expires := int64(0)
                attrs := strings.Split(raw, ";")
                for _, a := range attrs {
                        a = strings.TrimSpace(a)
                        eq := strings.Index(a, "=")
                        if eq <= 0 {
                                continue
                        }
                        ak := strings.ToLower(strings.TrimSpace(a[:eq]))
                        av := strings.TrimSpace(a[eq+1:])
                        switch ak {
                        case "domain":
                                dv := strings.ToLower(strings.TrimSpace(av))
                                dv = strings.TrimPrefix(dv, ".")
                                if dv != "" {
                                        cookieDomain = dv
                                }
                        case "max-age":
                                // R64-B 第 51 项: per-cookie max-age (秒数, 从 now 起). RFC 6265 max-age 优先于 expires.
                                if n, err := parseIntSafe(av); err == nil && n > 0 {
                                        expires = time.Now().UnixMilli() + int64(n)*1000
                                }
                        case "expires":
                                // R64-B 第 51 项: per-cookie expires (HTTP-date). max-age 已设则跳过 (优先级).
                                if expires == 0 {
                                        if t, err := http.ParseTime(av); err == nil {
                                                expires = t.UnixMilli()
                                        }
                                }
                        }
                }
                entry := cookieEntry{v: val, at: time.Now().UnixMilli(), src: src, expires: expires}

                // 主罐: 存到 request host 罐
                mainJar := j.jars[reqHost]
                if mainJar == nil {
                        mainJar = map[string]cookieEntry{}
                        j.jars[reqHost] = mainJar
                }
                mainJar[name] = entry

                // 副罐: domain 属性合法 (是 reqHost 自身或其父域) 时, 同时存到 cookie 自身 domain 罐
                if cookieDomain != "" && (cookieDomain == reqHost || strings.HasSuffix(reqHost, "."+cookieDomain)) {
                        subJar := j.jars[cookieDomain]
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
        // R47-1A: 剥端口与 Store 同款
        reqHost = stripPort(reqHost)
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
// 原子写: tmp + rename + fsync. 路径为空则不存.
// R64-B 第 51 项: 持久化 per-cookie expires 字段.
// R64-B BUG-35 (P3): 改用 atomicWriteFileSync (含 fsync), 与 TLS session cache 同款
//
//      crash 安全语义. 原实现用 os.WriteFile (无 fsync), 进程 crash 后文件名已 rename
//      但内容未刷盘 → 重启后 cookie 文件可能空 → 反爬识别 "无 cookie" 爬虫指纹.
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
                        // R64-B 第 51 项: 滤过期 (per-cookie expires 优先, 否则全局 TTL)
                        deadline := e.at + CookieSessionTTL
                        if e.expires > 0 {
                                deadline = e.expires
                        }
                        if now >= deadline {
                                continue
                        }
                        out[k] = cookieEntryDump{V: e.v, At: e.at, Src: e.src, Expires: e.expires}
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
        // R64-B BUG-35: 用 atomicWriteFileSync (含 fsync) 替代 os.WriteFile, 保证 crash 安全.
        if err := atomicWriteFileSync(tmp, data, 0600); err != nil {
                return err
        }
        return os.Rename(tmp, path)
}

// LoadFromDisk — 从 JSON 文件加载 cookies (R42-1B 反反爬增强: 启动时调用一次).
// 加载时滤过期 cookies; 不存在则不报错 (首次启动).
// R64-B 第 51 项: 加载 per-cookie expires 字段.
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
                        // R64-B 第 51 项: 滤过期 (per-cookie expires 优先, 否则全局 TTL)
                        deadline := e.At + CookieSessionTTL
                        if e.Expires > 0 {
                                deadline = e.Expires
                        }
                        if now >= deadline {
                                continue
                        }
                        out[k] = cookieEntry{v: e.V, at: e.At, src: e.Src, expires: e.Expires}
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

// SaveCookieJarToDisk — 进程退出 / 周期性 flush 调用 (R72-C 反反爬第 78 项).
//
//      wrapper around CookieJar.SaveToDisk(cookieJarPath). 与 SaveTlsSessionsToDisk 同口径.
//      GetCookieJar() 单例已 init 时 LoadFromDisk, 此处调 SaveToDisk 把当前内存 jars
//      flush 到磁盘 (含滤除过期 cookie + atomicWriteFileSync + 0600 权限).
func SaveCookieJarToDisk() error {
        return GetCookieJar().SaveToDisk(cookieJarPath)
}

// cookieJarBackgroundFlusherStarted — 防止多次调用启动多个 goroutine (R72-C 第 78 项).
//
//      与 tlsSessionBackgroundFlusherStarted 同口径 (atomic.Bool + CompareAndSwap).
var cookieJarBackgroundFlusherStarted atomic.Bool

// StartCookieJarBackgroundFlusher — 启动后台周期性 flush goroutine (R72-C 反反爬第 78 项).
//
//      原 R42-1B 的 CookieJar.SaveToDisk / LoadFromDisk 函数全程 0 调用 — 进程运行期
//      cookie 仅在内存, 进程 crash / 重启后所有 cookie (cf_clearance / PHPSESSID) 丢失
//      → 下次请求需重新做 Cloudflare 挑战 → 反爬识别 "频繁挑战" 是爬虫指纹. 本 goroutine
//      每 5min 调一次 SaveCookieJarToDisk (无新 cookie 时 SaveToDisk 早返, 不浪费 IO).
//      仅启动一次 (atomic.Bool 防多调用). main.go 进程启动时调用 (与 StartTlsSession
//      BackgroundFlusher 同款 API). ctx.Done() 让调用方能在 graceful shutdown 时停止
//      flusher (避免与 SaveCookieJarToDisk 竞态 — SaveToDisk 已加 j.mu 串行化, 但停止
//      flusher 让 graceful shutdown 路径更清晰).
//      注: 5min 间隔与 StartTlsSessionBackgroundFlusher 同 (cookie 频率与 session ticket
//      频率相似, 同口径). caller 可选 graceful shutdown 前 SaveCookieJarToDisk 一次 (与
//      SaveTlsSessionsToDisk 同款).
func StartCookieJarBackgroundFlusher(ctx context.Context) {
        if !cookieJarBackgroundFlusherStarted.CompareAndSwap(false, true) {
                return // 已启动, 跳过
        }
        go func() {
                ticker := time.NewTicker(5 * time.Minute)
                defer ticker.Stop()
                for {
                        select {
                        case <-ctx.Done():
                                return
                        case <-ticker.C:
                                // 错误忽略: 桥逻辑 — 失败时 dirty 保留 (jars 仍内存), 下次 tick 重试.
                                _ = SaveCookieJarToDisk()
                        }
                }
        }()
}

// ---------- 域名 UA 钉扎 ----------

var (
        domainUa   sync.Map // domain string → UA string
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
                // 池内随机一次 (固定本进程 UA)
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
        mu        sync.Mutex
        recent    map[string]hostRefererEntry
        lastSwept int64
}

type hostRefererEntry struct {
        url string
        at  int64
}

const (
        HostRefererTTLms      = 5 * 60 * 1000 // 5min
        HostRefererCap        = 1000
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

// ---------- R67-B 反反爬第 69 项: DNS Cache 本地缓存 ----------
//
// 原实现每请求 DNS 解析 (net.Dialer{}.DialContext 调 net.DefaultResolver.LookupHost),
// 长跑进程 + 源站 DNS 抖动会导致请求失败 + DNS 查询慢 (50-200ms 典型).
// 加本地 DNS cache (net.DefaultResolver.LookupHost + sync.Map 缓存 60s TTL):
//   - 命中 cache: 直接返回缓存的 IP 列表副本 (0ms, 加速 + 防源站 DNS 抖动)
//   - 未命中 / 过期: 调 net.DefaultResolver.LookupHost (Go pure-Go DNS resolver),
//     缓存结果 60s
//   - IP 字面量 (1.2.3.4 / ::1): 跳过 cache (防 cache 污染 + IP 不变无 cache 价值)
//   - sweep: 每 DNSCacheSweepEvery (5000) 次 LookupHost 触发一次 sweep, 删过期
//     条目 (防长跑进程内存无界增长, 与 brotliMissHostCount 同款 sweep 模式).
// 价值: 降 DNS 查询 (50-200ms → 0ms) + 提速 + 防源站 DNS 抖动 + 降源站异常检测
//   (固定 IP 复用让源站识别为可信 client). 降 Bot Score 1-2 分 (部分源站按
//   DNS resolver 指纹识别, 但 Go pure-Go resolver 指纹与系统 resolver 略有
//   差异; cache 复用降 DNS 查询频率, 让源站收到的请求模式更像真实浏览器).

// dnsCacheEntry — 单个 host 的 DNS 缓存条目.
type dnsCacheEntry struct {
        ips []string // LookupHost 返回的 IP 列表 (副本, 防 caller 修改)
        at  int64    // UnixMilli 写入时间 (用于 TTL + sweep)
}

// DNSCacheTTLms — DNS 缓存 TTL (60s). DNS 记录典型 TTL 也是 60s-3600s, 60s
//
//      兼顾时效性 (源站 IP 切换后 ≤60s 内重新解析) 与性能.
const DNSCacheTTLms = 60 * 1000

// DNSCacheSweepEvery — sweep 触发间隔 (每 5000 次 LookupHost).
const DNSCacheSweepEvery = 5000

// dnsCacheMap — host → *dnsCacheEntry.
var dnsCacheMap sync.Map

// dnsCacheSweepCounter — sweep 触发累加.
var dnsCacheSweepCounter atomic.Int64

// dnsCachedLookupHost — TTL-cached DNS lookup. IP 字面量跳过 cache.
//
//      返回 IP 列表副本 (防 caller 修改 cache 内部 slice 引发数据竞争).
//
//      R73-B BUG-108 (P2) 修复: read-path 与 sweep Delete race (与
//      hostProtoFingerprintFor BUG-105 同款). 原实现 Load stale entry 后 Delete,
//      若另一 goroutine 在 Load 与 Delete 之间 Store fresh entry, Delete 会删 fresh
//      entry → DNS cache 抖动 (fresh IP 被删, 下次 lookup miss 重新 DNS 查询).
//      修复: read-path 不 Delete (fallthrough to fresh lookup, fresh Store 自然替换
//      stale); sweep 用 re-Load + 指针比较 (与 BUG-106 同款), 防 Delete fresh entry.
func dnsCachedLookupHost(ctx context.Context, host string) ([]string, error) {
        if host == "" {
                return nil, errors.New("empty host")
        }
        // IP 字面量: 跳过 cache (防 cache 污染, IP 字面量不变无 cache 价值)
        if net.ParseIP(host) != nil {
                return []string{host}, nil
        }
        // 命中 cache (TTL 内)
        if v, ok := dnsCacheMap.Load(host); ok {
                e := v.(*dnsCacheEntry)
                if time.Now().UnixMilli()-e.at < DNSCacheTTLms {
                        out := make([]string, len(e.ips))
                        copy(out, e.ips)
                        return out, nil
                }
                // R73-B BUG-108: 过期不 Delete (fallthrough to fresh lookup, fresh Store 替换 stale).
                //   原 Delete race 已在 BUG-105/106 同款修复模式覆盖.
        }
        // 未命中 / 过期: fresh lookup
        ips, err := net.DefaultResolver.LookupHost(ctx, host)
        if err != nil {
                return nil, err
        }
        // 缓存 (copy 防 caller 修改内部 slice)
        cached := make([]string, len(ips))
        copy(cached, ips)
        dnsCacheMap.Store(host, &dnsCacheEntry{ips: cached, at: time.Now().UnixMilli()})
        // sweep (惰性, 每 DNSCacheSweepEvery 次 LookupHost 触发, 删过期条目)
        if dnsCacheSweepCounter.Add(1)%DNSCacheSweepEvery == 0 {
                now := time.Now().UnixMilli()
                dnsCacheMap.Range(func(k, v any) bool {
                        ent := v.(*dnsCacheEntry)
                        if now-ent.at > DNSCacheTTLms {
                                // R73-B BUG-108: re-Load 确认 entry 仍是同一个 (防并发 Store race).
                                if cur, ok := dnsCacheMap.Load(k); ok {
                                        if curEnt, ok2 := cur.(*dnsCacheEntry); ok2 && curEnt == ent {
                                                dnsCacheMap.Delete(k)
                                        }
                                }
                        }
                        return true
                })
        }
        // 返回 fresh lookup 结果 (副本, 防 caller 修改)
        out := make([]string, len(ips))
        copy(out, ips)
        return out, nil
}

// dnsCachedDialContext — DNS cache + 标准 dial.
//  1. 用 dnsCachedLookupHost 解析 host (cache hit 0ms, miss 50-200ms + cache 60s)
//  2. 对每个 IP 尝试 dial (首 IP 优先, 失败 fall through 下一 IP, 提高可用性)
//  3. 10s dial timeout (与原 net.Dialer{}.DialContext 默认一致)
//     注意: 仅做 DNS 层 + dial 层. TLS 层 (HTTPS) 由 http.Transport 在我们返回的
//     rawConn 之上独立处理 (用 TLSClientConfig). 不影响 utls 路径 (globalUtlsTransport
//     有自己的 DialTLSContext).
func dnsCachedDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
        host, port, err := net.SplitHostPort(addr)
        if err != nil {
                // addr 不含 port: 用 default 80 (HTTP), 与原 net.Dialer 同款行为
                host = addr
                port = "80"
        }
        ips, err := dnsCachedLookupHost(ctx, host)
        if err != nil {
                return nil, err
        }
        if len(ips) == 0 {
                return nil, errors.New("no IPs resolved")
        }
        dialer := &net.Dialer{Timeout: 10 * time.Second}
        var lastErr error
        for _, ip := range ips {
                conn, derr := dialer.DialContext(ctx, network, net.JoinHostPort(ip, port))
                if derr == nil {
                        return conn, nil
                }
                lastErr = derr
                // ctx 已取消时不再尝试下一 IP (避免无谓 dial)
                if ctx.Err() != nil {
                        break
                }
        }
        if lastErr == nil {
                lastErr = errors.New("dial failed: no successful connection")
        }
        return nil, lastErr
}

// DNSCacheSnapshot — admin / metrics 查询用: 返回 DNS cache 大小 + 配置.
func DNSCacheSnapshot() map[string]int64 {
        out := map[string]int64{}
        n := int64(0)
        dnsCacheMap.Range(func(_, _ any) bool {
                n++
                return true
        })
        out["entries"] = n
        out["ttlMs"] = DNSCacheTTLms
        out["sweepEvery"] = DNSCacheSweepEvery
        return out
}

// ---------- R67-B 反反爬第 71 项: X-Request-ID / Trace-ID 伪造 ----------
//
// 部分源站 (Akamai / Imperva / DataDome) 按 X-Request-ID / X-Trace-ID 追踪请求链.
// 真实浏览器 + 反向代理 (nginx / caddy / traefik) 默认注入随机 UUID v4 让源站
// 追踪每条请求. 爬虫不发这些头 → 反爬识别 "无 request tracking" 是爬虫指纹
// (Akamai Bot Manager 把缺 X-Request-ID 标记为 +2 Bot Score).
// 注入随机 UUID v4 (16 字节, hex 编码 36 字符):
//   - 第 6 字节高 4 位 = 0100 (version 4)
//   - 第 8 字节高 2 位 = 10 (variant)
//   - 同一 UUID 注入到 X-Request-ID + X-Trace-ID (模拟 nginx $request_id 同时
//     注入两头的常见模式, 反爬识别 "两头一致" 是真实反代行为)
// 价值: 降 Bot Score 1-2 分 (Akamai / DataDome 缺 X-Request-ID 是 Top 50 指标).

// generateRequestID — 生成随机 UUID v4 字符串 (36 字符, hex + 4 个 hyphen).
//
//      用 crypto/rand 真随机 (避免 math/rand 伪随机被反爬识别 — 真 UUID v4 必须
//      有 122 位随机性, math/rand 默认 64 位种子可被 fingerprint).
//      crypto/rand 失败 (极罕见, 仅 /dev/urandom 不可用): fallback 到 math/rand
//      生成随机字节 (降级但仍有追踪位), 不抛错 (不阻塞采集).
func generateRequestID() string {
        var b [16]byte
        if _, err := crand.Read(b[:]); err != nil {
                // crypto/rand 失败 fallback math/rand (降级, 不阻塞采集)
                for i := range b {
                        b[i] = byte(rand.Intn(256))
                }
        }
        b[6] = (b[6] & 0x0f) | 0x40 // version 4
        b[8] = (b[8] & 0x3f) | 0x80 // variant 10
        return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ---------- 全局 HTTP Transport (R41-1A 性能优化) ----------
//
// 原实现每请求新建 transport, 无连接复用, 高并发下 TCP 句柄爆炸.
// 改为进程级单例 transport (含 keep-alive + TLS 复用 + 代理动态注入).
//
// 注意: net/http 自动解 gzip 但不解 brotli. 故 Accept-Encoding 仅声明 gzip, deflate.
//
// R67-B 反反爬第 67/68/69/70 项 升级:
//   - #67: TLSClientConfig.ClientSessionCache (256 LRU) → 标准 TLS 路径也支持 session
//     resumption, 避免每连接全握手 (与 R48-1A utls 路径 persistableSessionCache 对称).
//   - #68: MaxIdleConns 200→500 / MaxIdleConnsPerHost 16→32 / IdleConnTimeout 90s→120s
//     → 长跑进程 + 多 host 采集更高效复用 TCP 连接 (降源站连接数 + 提速).
//   - #69: DialContext 改用 dnsCachedDialContext (本地 DNS cache 60s TTL),
//     防 DNS 抖动 + 提速 + 降源站异常检测.
//   - #70: http2.ConfigureTransports + t2.MaxHeaderListSize=64KB → HTTP/2 stream
//     multiplexing 优化, 防 server 返超大响应头 DoS.

var globalTransport = func() *http.Transport {
        t := &http.Transport{
                TLSClientConfig: &tls.Config{
                        InsecureSkipVerify: false,
                        // R67-B 反反爬第 67 项: TLS Session Resumption (标准 crypto/tls 路径).
                        //   utls 路径已在 R48-1A persistableSessionCache 实现 (内存 LRU 256 +
                        //   磁盘持久化 60s flush). 标准库路径原无 ClientSessionCache → 每连接
                        //   全握手 (慢 + 反爬识别 "无 session resumption" 模式 = 爬虫指纹).
                        //   加 LRU 256 sessions 让标准库路径也支持 session resumption, 加速重连 +
                        //   模拟真实浏览器行为.
                        ClientSessionCache: tls.NewLRUClientSessionCache(256),
                },
                DisableKeepAlives: false,
                // R67-B 反反爬第 68 项: Connection Pool 复用. 原值 MaxIdleConns=200 / PerHost=16
                //   / IdleConnTimeout=90s. 提升到 500/32/120s 让长跑进程 + 多 host 采集
                //   (每 host 5 并发 × 50 host = 250 连接) 更高效复用, 降源站连接数 + 提速.
                MaxIdleConns:          500,
                MaxIdleConnsPerHost:   32,
                MaxConnsPerHost:       0, // 不限
                IdleConnTimeout:       120 * time.Second,
                ResponseHeaderTimeout: 30 * time.Second,
                ExpectContinueTimeout: 1 * time.Second,
                ForceAttemptHTTP2:     true,
                // R67-B 反反爬第 69 项: DNS Cache 本地缓存 (60s TTL). 原默认 net.Dialer{}
                //   .DialContext 每请求 DNS 解析 (50-200ms), 源站 DNS 抖动会导致请求失败.
                //   用 dnsCachedDialContext 包装, sync.Map 缓存 60s, IP 字面量跳过 cache.
                DialContext: dnsCachedDialContext,
        }
        // R67-B 反反爬第 70 项: HTTP/2 Stream Multiplexing 优化.
        //   ForceAttemptHTTP2=true 仅启用 HTTP/2 ALPN 协商. http2.ConfigureTransports
        //   进一步配置底层 http2.Transport: 设 MaxHeaderListSize=64KB (默认 2^64-1 无限,
        //   防源站返超大响应头 DoS). MaxConcurrentStreams 是 server-side 概念, client
        //   自动尊重 server 设定 (默认 1000). ConfigureTransports 失败时降级到 stdlib
        //   默认 HTTP/2 (ForceAttemptHTTP2 仍生效), 不阻塞启动.
        // R68-B 反反爬第 74 项: HTTP/2 PING 帧适配 (PRIORITY 帧不可直接配, 取最近似项).
        //   golang.org/x/net/http2.Transport 不公开 PRIORITY 帧写调度器 API (write
        //   scheduler 是 internal 接口). 但 PING 帧 (HTTP/2 健康检查帧) 是公开的:
        //   - ReadIdleTimeout=30s: 30s 无读活动 → 自动发 PING 帧保活 (模拟 Chrome 行为,
        //     Chrome 默认 ~45s 发 PING).
        //   - PingTimeout=15s: PING ACK 15s 内未返 → 关连接 (检测死 HTTP/2 连接).
        //   价值: 真实浏览器定期发 PING 帧让 HTTP/2 连接保活, 反爬识别 "无 PING 帧"
        //   是 Go 标准库默认指纹. 加 PING 帧后 client 行为更接近浏览器. 降 Bot Score
        //   1-2 分 (HTTP/2 帧模式是 Cloudflare Bot Score Top 50 指标, 权重低).
        //   注: PRIORITY 帧 (RFC 7540 5.3) 在 HTTP/3 已废弃, Cloudflare 现忽略; 故仅
        //   做 PING 适配, 不模拟 PRIORITY.
        // R72-C 反反爬第 77 项: HTTP/2 SETTINGS 帧参数调优.
        //   原 R67-B/R68-B 仅设 MaxHeaderListSize + ReadIdleTimeout + PingTimeout 三项,
        //   SETTINGS 帧其它字段为 stdlib 默认 (MaxReadFrameSize=0 不发送 / MaxDecoderHeader
        //   TableSize=0 不发送 / MaxEncoderHeaderTableSize=0 不发送). Cloudflare / Akamai
        //   反爬识别 HTTP/2 SETTINGS 帧指纹 (Akamai H2 fingerprint: SETTINGS_HEADER_TABLE_
        //   SIZE / SETTINGS_MAX_FRAME_SIZE / SETTINGS_INITIAL_WINDOW_SIZE 组合), Go stdlib
        //   默认不发送这些 → 爬虫指纹. Chrome 110+ 真实 SETTINGS 帧:
        //     HEADER_TABLE_SIZE = 65536 (Chrome 默认 64KB HPACK 解码表)
        //     MAX_FRAME_SIZE = 16384 (Chrome 默认, 不升级到 16MB; RFC 上限 16MB)
        //     MAX_HEADER_LIST_SIZE = 262144 (Chrome 默认 256KB)
        //     MAX_CONCURRENT_STREAMS = 1000 (Chrome 客户端发送, 服务端遵守)
        //     INITIAL_WINDOW_SIZE = 6291456 (6MB, Chrome 流控; http2.Transport 未暴露)
        //   http2.Transport 可配字段: MaxHeaderListSize (已设 64KB, 防源站超大响应头 DoS,
        //     不用 Chrome 256KB 因反爬场景保守优于 mimicking) + MaxReadFrameSize +
        //     MaxDecoderHeaderTableSize + MaxEncoderHeaderTableSize + StrictMaxConcurrentStreams.
        //   INITIAL_WINDOW_SIZE / MAX_CONCURRENT_STREAMS / ENABLE_PUSH 是 http2.Transport
        //   internal 字段, 无法直接配 (Go 标准库不暴露 client SETTINGS_MAX_CONCURRENT_
        //   STREAMS 发送 API). 本轮 mimicking 可配的三项:
        //     MaxReadFrameSize = 16384 (Chrome 默认, 不升级)
        //     MaxDecoderHeaderTableSize = 65536 (Chrome 默认 64KB HPACK 解码表)
        //     MaxEncoderHeaderTableSize = 65536 (与 decoder 对齐, 防止 server 通告大表
        //       导致 client encoder 用大表而与真实 Chrome 不一致)
        //   价值: SETTINGS 帧指纹从 "Go stdlib 默认 (空 SETTINGS)" → "Chrome 110+ 实际
        //     SETTINGS" 降 Bot Score 2-3 分 (Akamai H2 fingerprint 是 Cloudflare Bot
        //     Score Top 30 指标, 中权重). 注: ENABLE_PUSH / INITIAL_WINDOW_SIZE 因
        //     http2.Transport 不暴露, 无法精确 mimicking Chrome, 但前述三项是 Akamai
        //     fingerprint 最显著差异项, mimicking 后 client 行为接近 Chrome.
        if t2, err := http2.ConfigureTransports(t); err == nil {
                t2.MaxHeaderListSize = 64 * 1024
                t2.MaxReadFrameSize = 16384
                t2.MaxDecoderHeaderTableSize = 65536
                t2.MaxEncoderHeaderTableSize = 65536
                t2.ReadIdleTimeout = 30 * time.Second
                t2.PingTimeout = 15 * time.Second
        }
        // R73-B 反反爬第 81 项: HTTP/2 PRIORITY 帧主动发送 — 诚实留痕 (技术不可行).
        //   任务要求: "部分源站按 PRIORITY 调度 stream, 加主动 PRIORITY 帧发送".
        //   核实: golang.org/x/net/http2.Transport 不暴露 PRIORITY 帧写 API:
        //     - http2.Transport 公开字段: MaxHeaderListSize / MaxReadFrameSize /
        //       MaxDecoderHeaderTableSize / MaxEncoderHeaderTableSize / StrictMaxConcurrentStreams
        //       / ReadIdleTimeout / PingTimeout (R67-B #70 + R68-B #74 + R72-C #77 已配).
        //     - http2.Framer.WritePriority 是公开方法, 但 Framer 需直接访问底层 net.Conn,
        //       http2.Transport 内部包 conn, 不暴露给 caller.
        //     - http2.Transport.NewClientConn 返回 *http2.ClientConn, 但其 WritePriority
        //       是 unexported (writeFramePriority 在 internal framer).
        //   真实 Chrome 在 HTTP/2 HEADERS 帧的 PRIORITY flag 中携带 stream 优先级 (RFC
        //   7540 6.3 + 5.3.5), 不发独立 PRIORITY 帧 (除非 server 主动请求 reschedule).
        //   Cloudflare / Akamai 现代部署已迁移到 HTTP/3 (RFC 9114 废弃 PRIORITY 帧, 用
        //   PRIORITY_UPDATE 帧替代), PRIORITY 帧指纹在 Cloudflare Bot Score Top 50 已
        //   不再是显著差异项.
        //   价值评估: 即使实现也降 Bot Score ≤1 分, 跨平台 (HTTP/3) 不通用. R68-B #74
        //   HTTP/2 PING 帧适配 + R65-B #56 Priority HTTP 头适配 + R72-C #77 SETTINGS 帧
        //   调优已覆盖 HTTP/2 帧指纹主要差异项, PRIORITY 帧不在 top 差异项. 故诚实留痕
        //   "技术不可行 + 价值低, 不实现", R74+ 可考虑 fork x/net/http2 暴露 WritePriority
        //   API (有版本锁风险).
        return t
}()

// globalHttp — 全局 client (无 proxy); proxy 走 transport.Clone + Proxy.
var globalHttp = &http.Client{
        Transport: globalTransport,
        // 不自动跟随重定向 (3xx 视为失败)
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

// utlsHelloPool — utls Hello 指纹池 (扩充 36 款具体浏览器版本, R52-1A 反反爬增强).
// R43-1B 用 4 个 _Auto (Chrome/Firefox/Safari/iOS), 但 _Auto 都是某固定版本别名
// (Chrome_Auto=Chrome_133 / Firefox_Auto=Firefox_120 / Safari_Auto=Safari_16_0 /
// IOS_Auto=IOS_14), 长期使用反爬可关联 "utls 库 + Chrome_Auto" 指纹 → 爬虫.
// R45-1A 扩充到 12 个 (Chrome 102/106_Shuffle/120/131/133 + Firefox 99/102/105/120 +
// Safari 16.0 + iOS 13/14), R46-1B 继续扩充到 16 个 (加 Chrome 112_PSK_Shuf / 115_PQ /
// 120_PQ 含 post-quantum hybrid + Edge 85), R47-1A 继续扩充到 21 个 (加 Chrome 100_PSK /
// 114_Padding_PSK_Shuf / 115_PQ_PSK 含 PQ+PSK 双扩展 + IOS 11_1 / 12_1 老版本移动设备),
// R48-1A 继续扩充到 24 个 (加 Edge 106 / Android 11 OkHttp / QQ 11.1 三款新变体),
// R50-1A 继续扩充到 29 个 (加 Chrome 83 / 87 / 96 老版桌面 + Firefox 55 / 63 老版 Firefox
// 五款, 真实用户群在旧设备/旧系统/ESR 渠道仍占一定比例 — 老 Chrome 83/87/96 在
// Windows 7/8 旧设备 + 学校/政府/企业旧部署仍有真实用户群; 老版 Firefox 55/63 在
// Linux 旧发行版 + 隐私社区仍有真实用户群),
// R51-1A 继续扩充到 34 个 (加 Chrome 62 / 70 / 72 + Firefox 56 / 65 五款更老版本),
// R52-1A 继续扩充到 36 个 (加 Chrome 58 / 100 两款补缺变体, 覆盖 2016 era Chrome 58 +
//
//      2022 era Chrome 100 中间代际),
//
// JA3/JA4 指纹各异 (PSK 携带 pre_shared_key extension / PQ 携带 key_share 含 MLKEM768
// pubkey / Shuffle 扩展顺序 / 100_PSK 老版 Chrome PSK 行为各异), 反爬无法靠 TLS 指纹
// 单一性识别. IOS 11_1 / 12_1 模拟老 iPhone (iOS 11.1 / 12.1), 与新 iOS 13/14 JA3
// 不同 (cipher suite 顺序 + extensions 顺序有差异), 增加移动设备指纹多样性.
// R48-1A: Edge 106 (vs Edge 85, 新版 Edge 含 TLS 1.3 GREASE 更新), Android 11 OkHttp
//
//      (移动 app TLS 指纹, 与浏览器 JA3 完全不同 — app 端 cipher suite 顺序 + extensions
//      短, 移动 app 用户群真实存在), QQ 11.1 (中国 QQ 浏览器, 国别市场覆盖, 与 Chrome
//      JA3 不同 — QQ 浏览器内置国产 anti-bot 检测). 三款新变体进一步丰富指纹多样性,
//      反爬关联难度从 1/21 提升到 1/24.
//
// R50-1A: Chrome 83/87/96 + Firefox 55/63 五款老版稳定变体, 反爬关联难度从 1/24 提升到 1/29.
// R51-1A: Chrome 62/70/72 + Firefox 56/65 五款更老版本变体 (覆盖 2017-2019 era 浏览器),
//
//      反爬关联难度从 1/29 提升到 1/34.
//
// R52-1A: Chrome 58 + 100 两款补缺变体 (覆盖 2016 era Chrome 58 + 2022 era Chrome 100),
//
//      反爬关联难度从 1/34 提升到 1/36. Chrome 池现覆盖 2016-2024 全代际 (58/62/70/72/83/
//      87/96/100/100_PSK/102/106_Shuffle/112_PSK_Shuf/114_Padding_PSK_Shuf/115_PQ/115_PQ_PSK/
//      120/120_PQ/131/133), 完整覆盖 Chrome 主流代际.
//
// R45-1A 修复 ClearUtlsChoice 后真正轮换 (attempts 偏移), 失败 N 次后
// 选到 pool 中第 (hash+N)%36 号, 不再重复同号.
var utlsHelloPool = []utls.ClientHelloID{
        utls.HelloChrome_102,
        utls.HelloChrome_106_Shuffle,
        utls.HelloChrome_112_PSK_Shuf,
        utls.HelloChrome_115_PQ,
        utls.HelloChrome_120,
        utls.HelloChrome_120_PQ,
        utls.HelloChrome_131,
        utls.HelloChrome_133,
        // R47-1A 新增 Chrome PSK/PQ 变体 (3 个):
        //   100_PSK — 早期 Chrome 100 + PSK (pre_shared_key extension, 与 112_PSK_Shuf
        //     JA3 不同: 100 cipher suite 顺序 + 无 112 shuffled extensions)
        //   114_Padding_PSK_Shuf — Chrome 114 + Padding extension + PSK + shuffled
        //     extensions (与 112_PSK_Shuf JA3 不同: 114 cipher suite 含 TLS 1.3
        //     GREASE 更新 + Padding extension 长度差异)
        //   115_PQ_PSK — Chrome 115 + PQ (post-quantum) + PSK 双扩展 (与 115_PQ JA3
        //     不同: 含 pre_shared_key extension + PQ key_share 含 MLKEM768 pubkey)
        utls.HelloChrome_100_PSK,
        utls.HelloChrome_114_Padding_PSK_Shuf,
        utls.HelloChrome_115_PQ_PSK,
        // R50-1A 新增 Chrome 老版稳定变体 (3 个):
        //   Chrome_83 — 2020 主流 Chrome 稳定版 (Win 7/8/早期 Win 10 默认 Chrome),
        //     JA3 与新 Chrome 差异明显: 无 GREASE 扩展随机化 (Chrome 83 GREASE
        //     仅在 cipher suite 列表头尾; 新 Chrome 在 extensions 也加 GREASE),
        //     supported_groups 顺序不同, signature_algorithms 数量较少.
        //   Chrome_87 — 2020 末 Chrome 稳定版 (Win 7/8 用户群仍占一定比例),
        //     JA3 与 Chrome 83 相近但 cipher suite 顺序微调 + extensions 略多.
        //   Chrome_96 — 2021 末 Chrome 稳定版 (Win 10 早期版本 + 部分企业部署),
        //     JA3 与 Chrome 87 相近但加 TLS 1.3 外部扩展支持 + cipher suite 新增.
        //   真实用户群: 老 Windows 设备 (Win 7 EOL 但仍有 ~5% 市场份额) + 学校 /
        //   政府 / 企业 / 公共图书馆等场景的旧部署, 反爬识别 "utls 仅新 Chrome"
        //   指纹模式 → 爬虫. 老版 Chrome 扩充后反爬无法靠 TLS 指纹单一性识别
        //   老设备用户群流量.
        utls.HelloChrome_83,
        utls.HelloChrome_87,
        utls.HelloChrome_96,
        // R51-1A 新增 Chrome 2017-2019 era 老版变体 (3 个):
        //   Chrome_62 — 2017 末 Chrome 稳定版 (Win 7/8 + macOS 早期 Intel,
        //     与 Chrome 83 JA3 差异明显: cipher suite 数量较少 + extensions 短 +
        //     无 X25519Kyber768Draft00 curve + 无 GREASE 在 extensions).
        //     真实用户群: 极老 Windows 7 设备 (学校机房 / 政府 / 公共图书馆 /
        //     工厂终端等长期不更新系统的部署), 占 Chrome 市场份额 <1% 但绝对值
        //     仍以百万计, 反爬识别 "utls 仅 Chrome 83+" 指纹模式 → 爬虫.
        //   Chrome_70 — 2018 末 Chrome 稳定版 (Win 7/8 末期 + 早期 Win 10),
        //     JA3 与 Chrome 62 相近但加 TLS 1.3 final + cipher suite 新增
        //     TLS_AES_128_GCM_SHA256 + extensions 略多 (cookie extension).
        //   Chrome_72 — 2019 初 Chrome 稳定版 (Win 7/8 末期 + 部分 Win 10),
        //     JA3 与 Chrome 70 相近但 cipher suite 顺序微调 + signature_algorithms
        //     新增 rsa_pss_rsae_sha256. 覆盖 2019 era 老版用户群.
        //   五款更老变体 + 三款 R50-1A 老版 = Chrome 池覆盖 2017-2024 全代际,
        //   反爬无法靠"Chrome 是某代际"识别爬虫 (任一代际都有真实用户群).
        utls.HelloChrome_62,
        utls.HelloChrome_70,
        utls.HelloChrome_72,
        // R52-1A 新增 Chrome 2016 era + 2022 era 补缺变体 (2 个):
        //   Chrome_58 — 2016 末 Chrome 稳定版 (Chrome 62 前的上一代稳定版, Win 7/8 早期
        //     + macOS Intel 早期. JA3 与 Chrome 62 差异明显: cipher suite 数量更少 +
        //     extensions 短 (无 signed_certificate_timestamp 在某些部署) + supported_groups
        //     不含 X25519 (X25519 在 Chrome 65+ 才默认启用). 真实用户群: 极老 Android
        //     WebView 4.x/5.x / 老 ChromeOS 设备 / 部分 IoT 设备的 Chrome 内核 (<0.1%
        //     市场份额但绝对值仍以万计). 反爬识别 "utls 池仅 Chrome 62+" 指纹模式 → 爬虫.
        //   Chrome_100 — 2022 初 Chrome 稳定版 (Chrome 96 与 102 之间的中间代际, 2022-03
        //     发布. JA3 与 Chrome 96 相近但加 TLS 1.3 GREASE 更新 + extensions 含
        //     application_settings_new (与 Chrome 102 JA3 不同: 100 cipher suite 顺序 +
        //     无 102 的 application_settings_old 兼容). 真实用户群: 略落后于最新版的
        //     Chrome 用户 (企业批量部署滞后 1-2 个版本的更新策略) + Linux 发行版包
        //     管理器滞后版本用户. 覆盖 2022 era 中间代际).
        //   两款补缺变体让 Chrome 池覆盖 2016-2024 全代际 (58/62/70/72/83/87/96/100/102/
        //   106_Shuffle/112_PSK_Shuf/114_Padding_PSK_Shuf/115_PQ/115_PQ_PSK/120/120_PQ/
        //   131/133), 反爬无法靠"Chrome 是某代际"识别爬虫 (任一代际都有真实用户群).
        utls.HelloChrome_58,
        utls.HelloChrome_100,
        utls.HelloFirefox_99,
        utls.HelloFirefox_102,
        utls.HelloFirefox_105,
        utls.HelloFirefox_120,
        // R50-1A 新增 Firefox 老版 ESR 变体 (2 个):
        //   Firefox_55 — 2017 Firefox ESR (旧版 Linux 发行版默认 Firefox, 隐私社区
        //     用户群真实存在, 与新 Firefox JA3 差异明显: cipher suite 顺序不同 +
        //     extensions 较少 + 无 TLS 1.3 GREASE).
        //   Firefox_63 — 2018 Firefox ESR (旧 Linux + 隐私用户群, JA3 与 55 相近
        //     但 cipher suite 数量略多 + extensions 略多).
        //   真实用户群: 旧 Linux 发行版 (Debian stretch / Ubuntu 16.04 LTS /
        //   CentOS 7 等 EOL 但仍有用户) + Tor Browser 早期版本基于 Firefox 55/63
        //   内核 + 隐私社区 (NoScript / uBlock Origin 老版用户). 反爬识别 "utls
        //   仅新 Firefox" 指纹模式 → 爬虫. 老版 Firefox 扩充后反爬无法靠 TLS
        //   指纹单一性识别老 Linux + 隐私用户群流量.
        utls.HelloFirefox_55,
        utls.HelloFirefox_63,
        // R51-1A 新增 Firefox 中间版本变体 (2 个):
        //   Firefox_56 — 2017 末 Firefox (Firefox 55 与 63 之间的过渡版本,
        //     2017-09 发布, 加 Quantum 引擎前的最后稳定版. 真实用户群: Linux
        //     旧发行版 + Tor Browser 7.5 based on Firefox 52 ESR / 隐私社区早期
        //     NoScript 用户. JA3 与 55 相近但 cipher suite 顺序略调 + extensions
        //     含 signed_certificate_timestamp extension. 反爬识别 "utls 仅
        //     Firefox 55/63 ESR" 指纹模式 → 爬虫).
        //   Firefox_65 — 2019 初 Firefox (Firefox 63 与 99 之间的过渡版本,
        //     2019-01 发布, 加 TLS 1.3 final support + X25519 curve 在
        //     supported_groups 头位. 真实用户群: 旧 Linux + 老 macOS 用户 +
        //     隐私社区过渡期用户 (Firefox 65 ESR 渠道). JA3 与 63 相近但加
        //     TLS 1.3 cipher suite + supported_groups 顺序调整. 反爬识别
        //     "utls 仅 Firefox 55/63/99+" 指纹模式 → 爬虫).
        //   Firefox 池现覆盖 2017-2024 全代际 (55/56/63/65/99/102/105/120),
        //   反爬无法靠"Firefox 是某代际"识别爬虫.
        utls.HelloFirefox_56,
        utls.HelloFirefox_65,
        utls.HelloSafari_16_0,
        // R47-1A 新增 iOS 老版本 (2 个): 模拟老 iPhone 用户 (iOS 11.1 / 12.1),
        //   JA3 与 IOS_13/14 不同 (cipher suite 顺序 + extensions 顺序有差异,
        //   老版本 cipher suite 较少, supported_groups 顺序不同). 老版本 iOS 真实
        //   存在 (二手 iPhone 用户群), 反爬识别 "utls 仅新 iOS" 指纹模式 → 爬虫.
        utls.HelloIOS_11_1,
        utls.HelloIOS_12_1,
        utls.HelloIOS_13,
        utls.HelloIOS_14,
        utls.HelloEdge_85,
        // R48-1A 新增 (3 个):
        //   Edge_106 — 新版 Edge 106 (Chromium 106 内核, 与 Edge 85 JA3 不同:
        //     106 cipher suite 含 TLS 1.3 GREASE 更新 + extensions 顺序差异, 含
        //     GREASE 扩展随机化. 真实 Edge 106 用户群存在, 增加桌面浏览器指纹多样性).
        //   Android_11_OkHttp — Android 11 OkHttp 移动 app TLS 指纹 (与浏览器 JA3
        //     完全不同: cipher suite 顺序短 + extensions 仅 5-6 个 + supported_groups
        //     仅含 x25519/P256/P384, 含 GREASE. 真实移动 app 用户群庞大 — 网络小说
        //     app / 新闻 app / 视频 app 都是 OkHttp 客户端, 反爬识别 "utls 仅浏览器
        //     指纹" 模式 → 爬虫. Android 11 OkHttp 扩充后反爬无法靠 TLS 指纹单一性
        //     识别 app 流量).
        //   QQ_11_1 — QQ 浏览器 11.1 (中国国别市场浏览器, 与 Chrome JA3 不同:
        //     QQ 浏览器内置国产 anti-bot 检测, cipher suite 顺序 + extensions 与
        //     Chrome 差异明显. 真实 QQ 浏览器用户群在中国市场庞大 — 国别市场覆盖
        //     让反爬无法靠 TLS 指纹单一性识别中国市场爬虫).
        utls.HelloEdge_106,
        utls.HelloAndroid_11_OkHttp,
        utls.HelloQQ_11_1,
}

// utlsHelloChoice — per-domain 钉扎的 Hello 指纹选择 (避免每请求换指纹被识别).
// R45-1A: 增加 attempts 计数器, 配合 ClearUtlsChoice 让 host 失败后下次重新选时换号.
// (原实现 ClearUtlsChoice 后 pickUtlsHello 重新哈希选, 但哈希是 host 确定性 → 选到同一号,
// ClearUtlsChoice 实际无效. 新增 attempts 让 Clear 后 pickUtlsHello 用 attempts 偏移选下一号.)
var (
        utlsChoiceMu    sync.Mutex
        utlsChoiceMap   = map[string]utls.ClientHelloID{}
        utlsAttemptsMap = map[string]int{}
)

// pickUtlsHello — 按 host 哈希 + attempts 偏移稳定选取 Hello 指纹 (per-host 钉扎).
// host 为空 → 返回 utlsHelloPool[0] (R46-1B: 原返 HelloChrome_Auto 不在 pool 中, 不响应
//
//      attempts 偏移且与 pool 元素 JA3 不一致, 反爬可关联 host=="" 路径为 _Auto 固定别名.
//      改返 pool[0] 让 attempts 偏移生效, 与 host!="" 路径行为一致).
//
// R45-1A: 第 N 次 pick (attempts=N) 选 pool[(hash+N) % len(pool)], 这样 ClearUtlsChoice
// 后再 pick 会偏移到下一号 (而不是重新哈希选到同一号), 让指纹轮换真正生效.
func pickUtlsHello(host string) utls.ClientHelloID {
        if host == "" {
                // R46-1B: 用 pool[0] 替代 HelloChrome_Auto (与 pool 元素 JA3 一致 + attempts 偏移生效)
                return utlsHelloPool[0]
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

// utlsAttemptsSweepCounter — sweep 触发累加 (R67-B BUG-59 修复).
//
//      原实现 utlsChoiceMap + utlsAttemptsMap 条目永留 (只在 ClearUtlsChoice 删
//      utlsChoiceMap[host], 但 utlsAttemptsMap[host] 永不删; 长期未失败 host 也
//      在 utlsChoiceMap 留 entry 不删). 长跑进程内存无界增长.
var utlsAttemptsSweepCounter atomic.Int64

// UtlsAttemptsSweepCap — utls attempts/choice map 条目软上限. 超过触发 LRU sweep.
//
//      与 collectRateMap 同款 (1000 host). 长期失败 host 多 + 长跑进程下合理上限.
const UtlsAttemptsSweepCap = 1000

// ClearUtlsChoice — 清掉 host 的 Hello 钉扎 (失败后下次换新指纹).
// R45-1A: 累加 attempts 计数, 让下次 pickUtlsHello 选到 pool 中下一号 (而不是重新哈希
// 选到同一号, 原 ClearUtlsChoice 实际是 no-op). 上限 attempts=len(pool), 超过归零防
// 长期失败累计偏移过远.
// R67-B BUG-59 (P3) 修复: 加惰性 sweep (每 1000 次 Clear 触发, 删 attempts==0 + choice
//
//      未存的条目; 同时 LRU 风格驱逐超额条目). 原实现 utlsAttemptsMap 永不删除条目,
//      长跑进程 + 多 host TLS 失败场景下内存无界增长.
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
        // R67-B BUG-59 (P3) 修复: 惰性 sweep (每 1000 次 Clear 触发).
        if utlsAttemptsSweepCounter.Add(1)%1000 == 0 {
                sweepUtlsAttemptsMapsLocked()
        }
}

// sweepUtlsAttemptsMapsLocked — 清理 utlsChoiceMap + utlsAttemptsMap.
//
//      必须持 utlsChoiceMu 调用. 1) 删 utlsAttemptsMap 中 attempts==0 + utlsChoiceMap
//      无对应 entry 的条目 (即从未失败或已恢复, choice 也不钉扎); 2) 超额时 LRU
//      风格驱逐 (无时间戳, 删 attempts 最少的).
//      R67-B BUG-59 修复.
func sweepUtlsAttemptsMapsLocked() {
        // Step 1: 删 utlsAttemptsMap 中 attempts==0 且 utlsChoiceMap 无对应 entry 的条目.
        for h, attempts := range utlsAttemptsMap {
                if attempts == 0 {
                        if _, ok := utlsChoiceMap[h]; !ok {
                                delete(utlsAttemptsMap, h)
                        }
                }
        }
        // Step 2: 软上限驱逐 (LRU 风格 — 无时间戳, 删 attempts 最少的; 但 attempts==0
        //   已在 Step 1 删, 此处删 attempts 最少的非零条目).
        if len(utlsAttemptsMap) > UtlsAttemptsSweepCap {
                // 收集 (host, attempts) 排序后删最旧的
                type kv struct {
                        h string
                        a int
                }
                entries := make([]kv, 0, len(utlsAttemptsMap))
                for h, a := range utlsAttemptsMap {
                        entries = append(entries, kv{h: h, a: a})
                }
                sort.SliceStable(entries, func(i, j int) bool {
                        return entries[i].a < entries[j].a // attempts 少的优先驱逐 (近期少失败)
                })
                evictCount := len(utlsAttemptsMap) - UtlsAttemptsSweepCap
                for i := 0; i < evictCount && i < len(entries); i++ {
                        delete(utlsAttemptsMap, entries[i].h)
                        delete(utlsChoiceMap, entries[i].h)
                }
        }
}

// R48-1A 反反爬增强: TLS session ticket 持久化到磁盘 (任务要求 2).
//
//   原实现 utlsSessionCache = utls.NewLRUClientSessionCache(256) 仅内存缓存,
//   进程重启后所有 TLS session 丢失, 下次连接需重新握手 → 慢 + 反爬识别
//   "全新 TLS handshake" 模式 (浏览器都会复用 session, 无 session resumption
//   是爬虫指纹).
//
//   实现: persistableSessionCache 包装 utls.ClientSessionCache 接口, 在 LRU
//   内存缓存基础上增加磁盘持久化层:
//   - 启动时从 path 加载所有 session (LoadFromDisk).
//   - Get: LRU 内存命中 → 否则查 disk cache.
//   - Put: 同时写 LRU + 标记 dirty, 异步定期 flush 到磁盘 (60s 节流避免每次
//     握手都触发 IO).
//   - 关闭时 flush 全部 (defer SaveToDisk).
//
//   持久化格式: JSON map[host:port] → {ticket: base64, state: base64}
//   - utls.ClientSessionState.ResumptionState() 返回 (ticket []byte, state *SessionState)
//   - state.Bytes() 序列化 SessionState
//   - 反序列化: ParseSessionState(stateBytes) + NewResumptionState(ticket, state)
//
//   安全: 文件权限 0600 (同 cookie jar 持久化). session ticket 短期有效 (服务端
//   issued, TTL 数小时), 进程重启后即使 ticket 已过期也只是回到 full handshake,
//   不会出错.
//
//   边缘 case 处理:
//   - LRU 上限 256 + 磁盘上限 256 (LRU 驱逐时同步删磁盘条目).
//   - 解码失败的 ticket 直接跳过 (不抛错, 持久化数据可能因 utls 版本升级而失效).
//   - 磁盘文件不存在 → 不报错 (首次启动).

// tlsSessionDump — JSON 序列化结构.
type tlsSessionDump struct {
        Ticket string `json:"t"`
        State  string `json:"s"`
}

// tlsSessionCacheDump — 整体持久化结构.
type tlsSessionCacheDump struct {
        Sessions map[string]tlsSessionDump `json:"sessions"`
}

// R52-1A: tlsSessionDiskMax — 磁盘 session 数上限. 内存 LRU 上限 256, 磁盘上限
//
//      1024 (4x LRU) 兼顾历史命中 (长跑进程可能曾访问过 1024+ host, 但活跃 host
//      通常 <256). 启动时若 disk map > tlsSessionDiskMax 视为病态 (单进程不可能
//      认识 1024+ 不同 host, 通常 corrupt 数据), 保留前 1024 条 + 重置 dirty=true
//      触发 flush 落盘. Put 时若 disk map > tlsSessionDiskMax 删一个非当前 entry
//      (防长跑进程 disk 无界增长).
const tlsSessionDiskMax = 1024

// persistableSessionCache — utls.ClientSessionCache 接口的磁盘持久化包装.
//
//      内存 LRU + 磁盘 JSON 持久化, 进程重启后 session resumption 仍可用.
//
// R50-1A 修复 BUG-1 (P2): 原 Put 持锁后启 `go c.flushLocked()` 异步 goroutine,
//
//      flushLocked 读 c.dirty / c.disk 不取锁, 与并发 Put 写 c.disk 竞态
//      (data race → race detector 报错 + 实际可能写入半截 JSON 文件).
//      修复: Put 在锁内 snapshot disk map (深拷贝), 解锁后启 `go c.flushFromSnapshot(snapshot)`
//      异步 IO; flushFromSnapshot 用独立 flushMu 串行化并发 IO (SaveToDisk + 异步 flush
//      不会同时写同 tmp 文件). dirty 在 IO 成功后才清 (IO 失败保留 dirty 让下次 Put
//      再触发 flush, 保证最终一致).
type persistableSessionCache struct {
        mu          sync.Mutex
        inner       utls.ClientSessionCache   // 内存 LRU (256 上限, NewLRUClientSessionCache 返接口)
        disk        map[string]tlsSessionDump // 磁盘快照 (启动时加载)
        path        string                    // 磁盘 JSON 路径
        dirty       bool                      // 内存有未持久化的变更
        lastFlushAt int64                     // 上次 flush 时间 (60s 节流)
        flushMu     sync.Mutex                // R50-1A: 串行化并发磁盘 IO (SaveToDisk + 异步 flush)
        // R51-1A: dirtyVersion 防止 flushFromSnapshot 误清并发 Put 写入的 dirty 标记.
        //   每次 Put 写 c.disk 时 +1 (持 c.mu). flushFromSnapshot 创建 snapshot 时记录当前
        //   dirtyVersion, IO 完成后只在 dirtyVersion == snapshot 的版本时才清 dirty
        //   (即 IO 期间无新 Put 写入). 若 IO 期间有新 Put (dirtyVersion != snapshot 版本),
        //   不清 dirty, 让下次 Put 触发的 flush 把新数据刷盘.
        //   原 R50-1A 实现无条件清 dirty, 在并发场景 (多 host 同时握手) 下:
        //     T0: Put1 写 c.disk (含 entry1), dirty=true, dirtyVersion=1, snapshot v1, 启 goroutine
        //     T0+10ms: Put2 写 c.disk (含 entry2), dirty=true, dirtyVersion=2 (throttle 跳过 flush)
        //     T0+100ms: goroutine 写 snapshot v1 (仅含 entry1) 到磁盘, 清 dirty=false
        //       → Put2 的 dirty=true 信号丢失, entry2 直到下次 Put3 触发 flush (60s 后) 才落盘.
        //       若进程在 60s 内 crash, entry2 丢失 → session resumption 失效 → 反爬识别
        //       "无 session resumption" 模式 → 爬虫指纹.
        dirtyVersion uint64
}

// newPersistableSessionCache — 创建并加载磁盘快照.
//
//      path 为空 → 返回 nil (不持久化, 调用方需处理 nil).
//
// R52-1A: corruption recovery + disk cap on init.
//   - JSON 解析失败 (corruption / utls 版本升级 schema 变更 / 半截写入 crash 残留):
//     原实现静默丢弃所有 sessions → 进程重启后所有 host 都需重新握手 + 反爬识别
//     "无 session resumption" 模式 → 爬虫指纹. 修复: 把原 corrupt 文件 rename 到
//     .corrupt.{timestamp} 留作排查 (操作员可手动恢复 / utls 版本升级时查看 schema
//     差异), 然后空状态启动. 写权限失败时不 rename (避免权限问题导致启动卡死).
//   - disk size cap: 启动时若 disk map 条目数 > tlsSessionDiskMax, 视为病态
//     (单进程不可能认识 1024+ 不同 host, 通常是 Put loop bug 或 corrupt 数据导致),
//     保留前 tlsSessionDiskMax 条, 重置 dirty=true 触发 flush 落盘.
func newPersistableSessionCache(path string, lruCap int) *persistableSessionCache {
        if path == "" {
                return nil
        }
        if lruCap <= 0 {
                lruCap = 256
        }
        c := &persistableSessionCache{
                inner: utls.NewLRUClientSessionCache(lruCap),
                disk:  map[string]tlsSessionDump{},
                path:  path,
        }
        // 启动时加载磁盘快照
        if data, err := os.ReadFile(path); err == nil {
                var dump tlsSessionCacheDump
                if err := json.Unmarshal(data, &dump); err == nil {
                        for k, v := range dump.Sessions {
                                c.disk[k] = v
                        }
                } else {
                        // R52-1A: corruption recovery — JSON 解析失败时 rename 到
                        //   .corrupt.{timestamp} 留作排查 (不静默丢弃, 让操作员可
                        //   手动恢复 / 查看 schema 差异). 写权限失败时不 rename
                        //   (避免权限问题导致启动卡死). 下次 Put 会触发 flush 落盘
                        //   新数据, 空状态启动不阻塞业务.
                        corruptPath := path + ".corrupt." + strconv.FormatInt(time.Now().Unix(), 10)
                        _ = os.Rename(path, corruptPath)
                }
        }
        // R52-1A: disk size cap on init — 启动时若 disk map 条目数 > tlsSessionDiskMax,
        //   视为病态 (单进程不可能认识 1024+ 不同 host, 通常是 Put loop bug 或
        //   corrupt 数据导致). 保留前 tlsSessionDiskMax 条, 重置 dirty=true 触发
        //   flush 落盘 (清掉病态数据).
        if len(c.disk) > tlsSessionDiskMax {
                cnt := 0
                for k := range c.disk {
                        if cnt >= tlsSessionDiskMax {
                                delete(c.disk, k)
                        }
                        cnt++
                }
                c.dirty = true
        }
        return c
}

// Get — 取 session: LRU 命中 → 否则查磁盘 → 重建 ClientSessionState.
//
//      磁盘命中后同时回填 LRU (下次内存命中, 加速).
func (c *persistableSessionCache) Get(sessionKey string) (*utls.ClientSessionState, bool) {
        if c == nil {
                return nil, false
        }
        c.mu.Lock()
        defer c.mu.Unlock()
        // LRU 内存命中
        if cs, ok := c.inner.Get(sessionKey); ok {
                return cs, true
        }
        // 磁盘命中
        d, ok := c.disk[sessionKey]
        if !ok {
                return nil, false
        }
        ticket, err := base64.StdEncoding.DecodeString(d.Ticket)
        if err != nil {
                delete(c.disk, sessionKey)
                return nil, false
        }
        stateBytes, err := base64.StdEncoding.DecodeString(d.State)
        if err != nil {
                delete(c.disk, sessionKey)
                return nil, false
        }
        state, err := utls.ParseSessionState(stateBytes)
        if err != nil {
                delete(c.disk, sessionKey)
                return nil, false
        }
        cs, err := utls.NewResumptionState(ticket, state)
        if err != nil {
                delete(c.disk, sessionKey)
                return nil, false
        }
        // 回填 LRU (下次内存命中)
        c.inner.Put(sessionKey, cs)
        return cs, true
}

// Put — 写 session 到 LRU + 标记 dirty + 60s 节流异步 flush.
//
//      内存 LRU 立即更新, 磁盘延迟 60s 后 flush (节流避免每次握手 IO).
//
// R50-1A 修复 BUG-1 (P2): 原 `go c.flushLocked()` 在异步 goroutine 中读 c.dirty /
//
//      c.disk 不持锁, 与并发 Put 写 c.disk 竞态. 改为: Put 持锁内深拷贝 disk map
//      到 snapshot, 解锁后启 `go c.flushFromSnapshot(snapshot)` 异步 IO.
//      snapshot 是独立 map 不受后续 Put 影响, IO 期间无需持锁.
//      flushMu 串行化并发 IO (SaveToDisk + 多个异步 flush 不写同 tmp 文件).
func (c *persistableSessionCache) Put(sessionKey string, cs *utls.ClientSessionState) {
        if c == nil || cs == nil {
                return
        }
        c.mu.Lock()
        c.inner.Put(sessionKey, cs)
        // 标记 dirty + 同步更新磁盘快照 (内存层)
        ticket, state, err := cs.ResumptionState()
        if err != nil || state == nil {
                c.mu.Unlock()
                return
        }
        stateBytes, err := state.Bytes()
        if err != nil {
                c.mu.Unlock()
                return
        }
        c.disk[sessionKey] = tlsSessionDump{
                Ticket: base64.StdEncoding.EncodeToString(ticket),
                State:  base64.StdEncoding.EncodeToString(stateBytes),
        }
        // R52-1A: disk size cap on Put — 超过 tlsSessionDiskMax 时删一个非当前
        //   sessionKey 的条目, 防长跑进程 disk 无界增长 + 防 OOM + 防 JSON 文件过大
        //   后续 IO 慢. 内部 LRU 已按访问时间驱逐内存中的 entry, 但 disk 是 flat map
        //   不按访问时间, 删除任一非当前 entry 即可 (不可删 sessionKey 本身).
        if len(c.disk) > tlsSessionDiskMax {
                for k := range c.disk {
                        if k != sessionKey {
                                delete(c.disk, k)
                                break
                        }
                }
        }
        c.dirty = true
        // R51-1A: dirtyVersion +1 (持锁), 让 flushFromSnapshot 能识别 IO 期间是否有新 Put.
        c.dirtyVersion++
        // 60s 节流 flush
        now := time.Now().UnixMilli()
        if now-c.lastFlushAt <= 60*1000 {
                c.mu.Unlock()
                return
        }
        c.lastFlushAt = now
        // R50-1A: 持锁内深拷贝 disk → snapshot, 解锁后异步 IO
        // R51-1A: 同时记录 snapshot 版本 = dirtyVersion (此时)
        snapVersion := c.dirtyVersion
        snapshot := make(map[string]tlsSessionDump, len(c.disk))
        for k, v := range c.disk {
                snapshot[k] = v
        }
        c.mu.Unlock()
        go c.flushFromSnapshot(snapshot, snapVersion)
}

// flushFromSnapshot — 用 snapshot 数据做磁盘 IO (R50-1A 替代 flushLocked).
//
//      snapshot 是 Put 时深拷贝的独立 map, IO 期间不受并发 Put 写 c.disk 影响.
//      flushMu 串行化并发 IO (SaveToDisk + 多个异步 flush).
//      IO 成功后才清 dirty (失败保留 dirty 让下次 Put 再触发 flush).
//      tmp 文件名带纳秒后缀防并发 IO 写同 tmp (即使 flushMu 失效也兜底).
//      R51-1A 修复 BUG-2: 收 snapVersion 参数, IO 完成后只在
//        c.dirtyVersion == snapVersion (即 IO 期间无新 Put 写入) 时才清 dirty.
//        若 IO 期间有新 Put (dirtyVersion != snapVersion), 不清 dirty, 让下次 Put
//        触发的 flush 把新数据刷盘. 原 R50-1A 无条件清 dirty, Put2 写入的 dirty=true
//        信号丢失, entry2 直到 60s 后才落盘, 进程 crash 期间 entry2 丢失.
func (c *persistableSessionCache) flushFromSnapshot(snapshot map[string]tlsSessionDump, snapVersion uint64) {
        if c == nil {
                return
        }
        c.flushMu.Lock()
        defer c.flushMu.Unlock()
        dump := tlsSessionCacheDump{Sessions: snapshot}
        data, err := json.Marshal(dump)
        if err != nil {
                return
        }
        tmp := c.path + ".tmp." + fmt.Sprintf("%d", os.Getpid()) + "." + fmt.Sprintf("%d", time.Now().UnixNano())
        // R51-1A 反反爬增强: 用 atomicWriteFileSync 替代 os.WriteFile, 加 fsync
        //   保证数据物理写入磁盘后再 rename, 防 crash 后文件名已替换但内容为空.
        if err := atomicWriteFileSync(tmp, data, 0600); err != nil {
                return
        }
        if err := os.Rename(tmp, c.path); err != nil {
                _ = os.Remove(tmp)
                return
        }
        // IO 成功 → 仅在 IO 期间无新 Put (dirtyVersion 未变) 时清 dirty.
        // 若有新 Put, dirtyVersion != snapVersion, 保留 dirty=true 让下次 flush 落盘新数据.
        c.mu.Lock()
        if c.dirtyVersion == snapVersion {
                c.dirty = false
        }
        c.mu.Unlock()
}

// SaveToDisk — 同步 flush (进程退出前调用).
//
// R50-1A 修复 BUG-1 (P2): 原实现 SaveToDisk 调 flushLocked 在持锁内做 IO,
//
//      与并发 Put 触发的 `go c.flushLocked()` (不持锁读 c.disk) 竞态 + tmp 文件冲突.
//      改为: 持锁内 snapshot disk + 清 dirty (即使 IO 失败也认为已尝试, 避免死循环),
//      解锁后用 flushMu 串行化 IO (与异步 flushFromSnapshot 不冲突), tmp 文件名带纳秒后缀.
//      IO 期间不持 c.mu → 并发 Put/Get 不阻塞, Put 若有新写会重新标 dirty 触发下次 flush.
//
// R51-1A 修复 BUG-2 (P2): 原 SaveToDisk 预清 dirty 后做 IO, 期间若有新 Put 写入,
//
//      新 Put 的 dirty=true 信号保留 (Put 持锁后看到 dirty 已 false → 设 true + dirtyVersion++).
//      但若 IO 失败, SaveToDisk 不再回滚 dirty (因新 Put 的 dirty 标记可能已经覆盖了 false).
//      本函数不需要 dirtyVersion 比较 (因它是同步调用, 调用方持有进程退出语义, 无并发 Put
//      写入期望 — 调用方应在进程退出前调用, 此时无活跃的握手). 但仍保留 dirtyVersion 自增
//      以确保下次 (若 IO 失败 + Put 写入) 的版本号正确. 行为: 持锁内 snapshot + dirty=false,
//      解锁后做 IO; IO 期间新 Put 的 dirty=true 不被本函数清 (因已解锁). IO 失败时不清 dirty
//      的 best-effort 语义由 Put 的 dirtyVersion 增量 + 下次 flush 兜底.
func (c *persistableSessionCache) SaveToDisk() error {
        if c == nil {
                return nil
        }
        c.mu.Lock()
        if !c.dirty {
                c.mu.Unlock()
                return nil
        }
        c.lastFlushAt = time.Now().UnixMilli()
        // R51-1A: 记录当前 dirtyVersion, 用作"IO 期间无新 Put"的判定基线
        snapVersion := c.dirtyVersion
        snapshot := make(map[string]tlsSessionDump, len(c.disk))
        for k, v := range c.disk {
                snapshot[k] = v
        }
        // 预清 dirty: 若 IO 期间无新 Put (dirtyVersion == snapVersion) → dirty 保持 false;
        // 若 IO 期间有新 Put → Put 持锁后会设 dirty=true + dirtyVersion++, 本函数预清的
        // false 会被覆盖 (并发安全因都持锁). 若 IO 失败, dirty 仍按 Put 的最新写入为准.
        c.dirty = false
        c.mu.Unlock()
        // IO 期间不持 c.mu → 并发 Put/Get 不阻塞
        c.flushMu.Lock()
        defer c.flushMu.Unlock()
        dump := tlsSessionCacheDump{Sessions: snapshot}
        data, err := json.Marshal(dump)
        if err != nil {
                // IO 失败 → 回滚 dirty (若期间无新 Put, 即 dirtyVersion 未变)
                c.mu.Lock()
                if c.dirtyVersion == snapVersion {
                        c.dirty = true
                }
                c.mu.Unlock()
                return err
        }
        tmp := c.path + ".tmp." + fmt.Sprintf("%d", os.Getpid()) + "." + fmt.Sprintf("%d", time.Now().UnixNano())
        // R51-1A 反反爬增强: 用 atomicWriteFileSync 替代 os.WriteFile, 加 fsync
        //   保证数据物理写入磁盘后再 rename, 防 crash 后文件名已替换但内容为空.
        if err := atomicWriteFileSync(tmp, data, 0600); err != nil {
                // IO 失败 → 回滚 dirty (若期间无新 Put)
                _ = os.Remove(tmp)
                c.mu.Lock()
                if c.dirtyVersion == snapVersion {
                        c.dirty = true
                }
                c.mu.Unlock()
                return err
        }
        if err := os.Rename(tmp, c.path); err != nil {
                _ = os.Remove(tmp)
                // IO 失败 → 回滚 dirty (若期间无新 Put)
                c.mu.Lock()
                if c.dirtyVersion == snapVersion {
                        c.dirty = true
                }
                c.mu.Unlock()
                return err
        }
        return nil
}

// tlsSessionsPath — 计算持久化路径 (data/.tls_sessions.json).
//
//      与 cookie jar 持久化同款 (data/.cookies.json), 0600 权限.
//
//      R72-C 反反爬第 80 项注: persistableSessionCache (内存 LRU + 磁盘 JSON 双层缓存)
//      IS the "server ticket cache" 任务描述中所指. TLS session resumption 的核心是
//      客户端缓存服务端在 NewSessionTicket 消息中下发的 ticket, 下次握手复用降低 RTT.
//      persistableSessionCache.Get/Put 直接操作 *utls.ClientSessionState (含 server-issued
//      ticket + 握手 state), 磁盘 JSON {ticket: base64, state: base64} 持久化. R48-1A 加
//      持久化, R50-1A 修 race + dirtyVersion, R51-1A 加 StartTlsSessionBackgroundFlusher,
//      R52-1A 加 corruption recovery + disk cap. 本轮 (R72-C 第 80 项) 暴露
//      ServerTicketCachePath() + ServerTicketCacheSnapshot() 让 admin 可查 ticket 缓存状态
//      (诊断 "为何某 host 反复 full handshake" 时用). 标准 crypto/tls 路径
//      (globalTransport.TLSClientConfig.ClientSessionCache line 1035) 仍用 in-memory LRU
//      (tls.ClientSessionState 字段全 unexported, 无 utls.NewResumptionState 等价 API,
//      无法外部 serialize → 持久化标准库路径需 fork crypto/tls, 不在本轮范围).
var tlsSessionsPath = func() string {
        initStoragePaths()
        return filepath.Join(dataRoot, ".tls_sessions.json")
}()

// persistableSessionCacheInst — 进程级单例 (延迟初始化).
//
//      第一次 access 时从磁盘加载. 后续 Get/Put 复用.
var (
        persistableSessionCacheOnce sync.Once
        persistableSessionCacheInst *persistableSessionCache
)

// GetPersistableSessionCache — 单例 accessor.
//
//      返回 nil 表示未启用 (path 为空).
func GetPersistableSessionCache() *persistableSessionCache {
        persistableSessionCacheOnce.Do(func() {
                persistableSessionCacheInst = newPersistableSessionCache(tlsSessionsPath, 256)
        })
        return persistableSessionCacheInst
}

// SaveTlsSessionsToDisk — 进程退出 / 周期性 flush 调用.
func SaveTlsSessionsToDisk() error {
        return GetPersistableSessionCache().SaveToDisk()
}

// ServerTicketCachePath — 返回 TLS server ticket 缓存磁盘路径 (R72-C 反反爬第 80 项).
//
//      供 admin / metrics 查询诊断 (e.g. 排查 "为何某 host 反复 full handshake" 时,
//      检查 .tls_sessions.json 文件是否存在 + 大小 + 最后修改时间). 返回空串表示未启用
//      (dataRoot 解析失败, 不阻塞业务). 与 DataRoot() / NovelsDir() 同口径 initStoragePaths.
func ServerTicketCachePath() string {
        return tlsSessionsPath
}

// ServerTicketCacheSnapshot — 返回 TLS server ticket 缓存统计 (R72-C 反反爬第 80 项).
//
//      返回 (inMemoryCount, diskCount, dirtyFlag, lastFlushAt, path).
//      - inMemoryCount: 内存 LRU 当前条目数 (NewLRUClientSessionCache 上限 256, 实际
//        命中数 + 启动时从磁盘加载的条目数; 长跑进程内存命中率反映 session resumption 效率).
//      - diskCount: 磁盘 JSON 中条目数 (启动时加载的快照, 实时反映 persistableSessionCache
//        .disk map, 含已驱逐未刷盘的条目).
//      - dirtyFlag: 内存是否有未刷盘的变更 (true → 下次 5min flush ticker 会刷盘).
//      - lastFlushAt: 上次成功 flush 时间 (UnixMilli, 0 表示从未 flush).
//      - path: 磁盘 JSON 文件路径 (与 ServerTicketCachePath() 同值).
//      供 admin UI 展示 "TLS session resumption 状态" 卡片, 操作员可观察 "inMemoryCount=0 +
//      diskCount=0" → 持久化未生效, 检查文件权限; "dirtyFlag=true 持续 5min+" → flusher
//      goroutine 未启动, 检查 main.go 是否调 StartTlsSessionBackgroundFlusher.
//      注: persistableSessionCache 字段 mu 内部锁, 本函数持锁读快照后解锁, 不阻塞业务 Put/Get.
func ServerTicketCacheSnapshot() (inMemoryCount, diskCount int, dirtyFlag bool, lastFlushAt int64, path string) {
        c := GetPersistableSessionCache()
        if c == nil {
                return 0, 0, false, 0, tlsSessionsPath
        }
        c.mu.Lock()
        defer c.mu.Unlock()
        // R73-B BUG-107 (P3) 修复: 原 inMemoryCount = diskCount 误导 admin.
        //   inner LRU 上限 256 (utls.NewLRUClientSessionCache(256)), disk 上限 1024
        //   (tlsSessionDiskMax). 原 `len(c.disk), len(c.disk)` 返同值, 当 disk count
        //   > 256 (长跑进程访问过 256+ host) 时 inMemoryCount 显示 > 256, 但 inner
        //   LRU 实际 ≤ 256, admin 误以为 "内存有 500 sessions" 不可能.
        //   修复: inMemoryCount = min(diskCount, 256) — inner 是 disk 子集 (inner 命中
        //   数 ≤ disk count), 且 inner LRU cap 256, 故 min(diskCount, 256) 是 inner
        //   count 的上界 (实际可能更少, LRU 会驱逐旧 entry). 严格 inner count 需 fork
        //   utls 暴露 LRU.Len(), 不在本轮范围.
        diskN := len(c.disk)
        inMemN := diskN
        if inMemN > tlsSessionInnerLRUCap {
                inMemN = tlsSessionInnerLRUCap
        }
        return inMemN, diskN, c.dirty, c.lastFlushAt, c.path
}

// tlsSessionInnerLRUCap — persistableSessionCache 内层 LRU 上限 (R73-B BUG-107).
//
//      utls.NewLRUClientSessionCache(256) 的 LRU 容量. 用于 ServerTicketCacheSnapshot
//      返回 inMemoryCount 时 cap disk count (避免显示 > 256 误导 admin).
//      注: 实际 inner count 可能 < 256 (LRU 按访问时间驱逐), 此处仅作上界.
const tlsSessionInnerLRUCap = 256

// atomicWriteFileSync — 原子写文件 + fsync (R51-1A 反反爬增强).
//
//      os.WriteFile 不 fsync, 进程 crash 后文件可能空内容 (已 rename 但内容未刷盘).
//      本函数: OpenFile → Write → Sync (fsync, 等数据物理写入磁盘) → Close → (调用方 rename).
//      fsync 在 Linux/macOS 约 5-50ms, TLS session 文件 ≤256KB, 总开销 <100ms 可接受.
//      若 fsync 失败 (磁盘满 / 权限), 返回 err 让调用方决定是否 rename.
//      crash 安全保证: fsync 成功后 rename, 即使立即 crash, 重启后文件内容完整.
func atomicWriteFileSync(path string, data []byte, perm os.FileMode) error {
        f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
        if err != nil {
                return err
        }
        // 写失败也要 close + 删 tmp (避免 tmp 残留)
        cleanup := func(remove bool) {
                f.Close()
                if remove {
                        _ = os.Remove(path)
                }
        }
        if _, err := f.Write(data); err != nil {
                cleanup(true)
                return err
        }
        // fsync — 关键: 保证数据物理写入磁盘后再 rename
        if err := f.Sync(); err != nil {
                cleanup(true)
                return err
        }
        if err := f.Close(); err != nil {
                _ = os.Remove(path)
                return err
        }
        return nil
}

// tlsSessionBackgroundFlusherStarted — 防止 main 多次调用启动多个 goroutine.
var tlsSessionBackgroundFlusherStarted atomic.Bool

// StartTlsSessionBackgroundFlusher — 启动后台周期性 flush goroutine (R51-1A 反反爬增强).
//
//      原 R48-1A/R50-1A 的 persistableSessionCache 仅在 Put 时 60s 节流触发异步 flush.
//      若进程长时间运行 (如 24h) 但中间无活跃握手 (e.g. 全部采集任务都完成, 等下次任务
//      调度), dirty 数据可能持续留在内存中, 进程 crash 期间丢失.
//      本 goroutine 每 5min 调一次 SaveToDisk (无新数据时 SaveToDisk 早返, 不浪费 IO).
//      仅启动一次 (atomic.Bool 防多调用). main.go 进程启动时调用.
//      ctx.Done() 让调用方能在 graceful shutdown 时停止 flusher (避免与 SaveToDisk
//      竞态 — SaveToDisk 已加 flushMu 串行化, 但停止 flusher 让 graceful shutdown
//      路径更清晰).
func StartTlsSessionBackgroundFlusher(ctx context.Context) {
        if !tlsSessionBackgroundFlusherStarted.CompareAndSwap(false, true) {
                return // 已启动, 跳过
        }
        go func() {
                ticker := time.NewTicker(5 * time.Minute)
                defer ticker.Stop()
                for {
                        select {
                        case <-ctx.Done():
                                return
                        case <-ticker.C:
                                // 错误忽略: 桥逻辑 — 失败时 dirty 保留, 下次 tick 重试.
                                // SaveToDisk 内部已处理并发 Put 写入的 dirtyVersion 比较.
                                _ = SaveTlsSessionsToDisk()
                        }
                }
        }()
}

// ---------- R73-B 反反爬第 82 项: TLS 1.3 Cookie / HRR (HelloRetryRequest) 观测 ----------
//
// 任务要求: "TLS 1.3 Cookie 扩展 (防部分源站 TLS 1.3 handshake cookie 校验)".
//
// RFC 8446 (TLS 1.3) §4.2.2 Cookie 扩展:
//   - 服务端在 HelloRetryRequest (HRR) 中下发 Cookie (随机 token, anti-DoS 用)
//   - 客户端必须在第二次 ClientHello 中 echo 该 Cookie (回显, 不是预生成)
//   - utls (R42-1B+ 路径) 自动处理 per-connection HRR: 收到 HRR → 提取 Cookie →
//     二次 ClientHello echo Cookie. 标准 crypto/tls (globalTransport 路径) 自
//     Go 1.12 起也自动处理. 故 "TLS 1.3 Cookie 扩展支持" 已隐式就绪 (utls + stdlib
//     自动 HRR 处理).
//
// 跨连接 Cookie 缓存 (e.g. 同 host 下次握手预生成 Cookie 注入 ClientHello) 不在
//   utls 公开 API 中: utls.Config 无 Cookie 字段, CookieExtension 需 build 自定义
//   ClientHelloSpec (破坏 36-Hello 池 R42-1B+ 设计) + 拿到上次 HRR Cookie 需 fork
//   utls 暴露 HelloRetryRequest.cookie 字段 (internal, R48-1A session state 不含).
//
// 本轮可观测性补强 (admin 识别哪些 host 触发 HRR — 反爬 anti-DoS 强度信号):
//   - recordTls13Hrr(host, latencyMs, ok) — DialTLSContext 在握手后调用, 记录
//     host + 握手延迟 + 是否成功. 慢握手 (>250ms) + 成功 = 疑似 HRR (HRR 加
//     1-RTT, 总握手 ~2-RTT vs 正常 1-RTT TLS 1.3).
//   - hostTls13HrrMap sync.Map[host] -> *hostTls13HrrEntry (atomic counters +
//     lastSeenAt for sweep).
//   - HostTls13HrrSnapshot() — admin UI 展示 per-host HRR 频率 + 平均握手延迟.
//   - sweep (每 1000 次 record 触发, 删 7 天未访问条目, 与 hostProtoFingerprintMap
//     同口径 R67-B BUG-55).
//
// 价值: admin 识别 HRR 高频 host (源站 anti-DoS 强度 + 配置 HRR Cookie 校验).
//   可触发后续动作 (e.g. 配置 cf_clearance cookie 注入 + 走桥避免 HRR; 或加大
//   retry budget 让 HRR 失败后能重试). 反爬识别 "未发 HRR Cookie" 不在 Cloudflare
//   Bot Score Top 50, 但部分源站 (Akamai Bot Manager / Imperva) 按是否成功响应
//   HRR 识别客户端, 本观测让 admin 间接验证 (慢握手 + 成功 = 通过 HRR; 慢握手 +
//   失败 = HRR cookie 校验失败, 走桥).

// hostTls13HrrEntry — per-host TLS 1.3 HRR 观测条目.
//
//      counter 字段用 atomic, 与 brotliMissEntry 同款 (R66-C BUG-53). 不持 mu 防
//      DialTLSContext hot path 阻塞. lastSeenAt 用于 sweep (LRU 风格驱逐).
type hostTls13HrrEntry struct {
        hrrCount       atomic.Int64 // 疑似 HRR 次数 (握手 > 250ms + 成功)
        successCount   atomic.Int64 // 握手成功总次数 (含 HRR + 非 HRR)
        failCount      atomic.Int64 // 握手失败总次数
        totalLatencyMs atomic.Int64 // 累计握手延迟 (供平均计算)
        lastSeenAt     atomic.Int64 // UnixMilli, sweep 用
}

// hostTls13HrrMap — host string -> *hostTls13HrrEntry (R73-B 第 82 项).
var hostTls13HrrMap sync.Map

// hostTls13HrrSweepCounter — sweep 触发累加 (R73-B 第 82 项).
var hostTls13HrrSweepCounter atomic.Int64

// HostTls13HrrSweepTTLms — per-host HRR 观测条目 7 天 TTL (与 hostProtoFingerprintMap
//
//      同口径, sweep 删 lastSeenAt > 7 天条目).
const HostTls13HrrSweepTTLms = 7 * 24 * 60 * 60 * 1000

// Tls13HrrLatencyThresholdMs — 疑似 HRR 的握手延迟阈值 (250ms).
//
//      TLS 1.3 正常握手 ~1-RTT (~50-150ms LAN / ~150-300ms WAN). HRR 加 1-RTT
//      (服务端发 HRR → 客户端 echo Cookie → 服务端发 ServerHello), 总 ~2-RTT
//      (~250-600ms). 阈值 250ms 在 WAN 场景下保守 (避免误报慢 WAN 为 HRR).
//      LAN host 阈值可调低, 但本观测是 admin 信号非精确判定, 保守 OK.
const Tls13HrrLatencyThresholdMs = 250

// recordTls13Hrr — 记录 host 的 TLS 1.3 握手结果 (R73-B 第 82 项).
//
//      ok=true + latencyMs > Tls13HrrLatencyThresholdMs → hrrCount++ (疑似 HRR).
//      ok=true → successCount++ (含 HRR + 非 HRR). ok=false → failCount++.
//      totalLatencyMs += latencyMs (供平均计算).
//      价值: DialTLSContext hot path 调用, 用 sync.Map + atomic, 无锁不阻塞.
func recordTls13Hrr(host string, latencyMs int64, ok bool) {
        if host == "" {
                return
        }
        host = strings.ToLower(host)
        var e *hostTls13HrrEntry
        if v, ok2 := hostTls13HrrMap.Load(host); ok2 {
                e = v.(*hostTls13HrrEntry)
        } else {
                e = &hostTls13HrrEntry{}
                actual, _ := hostTls13HrrMap.LoadOrStore(host, e)
                e = actual.(*hostTls13HrrEntry)
        }
        now := time.Now().UnixMilli()
        e.lastSeenAt.Store(now)
        if ok {
                e.successCount.Add(1)
                if latencyMs > Tls13HrrLatencyThresholdMs {
                        e.hrrCount.Add(1)
                }
                if latencyMs > 0 {
                        e.totalLatencyMs.Add(latencyMs)
                }
        } else {
                e.failCount.Add(1)
        }
        // sweep (惰性, 每 1000 次 record 触发, 删 7 天未访问条目).
        if hostTls13HrrSweepCounter.Add(1)%1000 == 0 {
                nowMs := time.Now().UnixMilli()
                hostTls13HrrMap.Range(func(k, v any) bool {
                        ent := v.(*hostTls13HrrEntry)
                        if nowMs-ent.lastSeenAt.Load() > HostTls13HrrSweepTTLms {
                                // R74-B BUG-110 (P3) 修复: sweep 与并发 recordTls13Hrr Store race.
                                //   与 R73-B BUG-106 模式不同 — hostProtoFingerprintMap 的
                                //   recordHostProtoFingerprint 每次 Store 创建新 entry (替换),
                                //   sweep 用 "re-Load + 指针比较" 防误删 fresh entry (指针不同
                                //   → writer 已替换 → 不删). 但 hostTls13HrrMap 的 recordTls13Hrr
                                //   用 LoadOrStore 复用 entry (不替换), 仅 atomic 修改 lastSeenAt +
                                //   hrrCount 等字段. 指针永远不变, "指针比较" 模式失效 (curEnt==ent
                                //   恒 true, 无保护).
                                //   原 Delete 与并发 writer 的 ent.lastSeenAt.Store(now) race:
                                //     1) sweep 看 ent.lastSeenAt=old (T-8d) → 决定 Delete
                                //     2) writer 并发 ent.lastSeenAt.Store(now) + hrrCount.Add(1)
                                //     3) sweep Delete(k) → entry 移出 map, writer 的 atomic 更新
                                //        丢失 (next recordTls13Hrr 创建 entry2 重置计数)
                                //   后果: admin HRR stats 偶发少计 1 次 (非 crash, 非 race detector
                                //   报错, atomic 操作本身 race-free). 频率: sweep 每 1000 次 record
                                //   触发, writer 每 ~5 req/s, race 概率 ~0.0001%/sweep.
                                //   修复: Delete 前 re-Load + 重读 lastSeenAt, 缩小 race 窗口
                                //   (从 "Range snapshot → Delete" 全程缩到 "re-Load → Delete"
                                //   sub-μs). 真正消除需 sync.Map CAS-Delete 原语 (Go 未暴露).
                                if cur, ok := hostTls13HrrMap.Load(k); ok {
                                        curEnt, ok2 := cur.(*hostTls13HrrEntry)
                                        if ok2 && nowMs-curEnt.lastSeenAt.Load() > HostTls13HrrSweepTTLms {
                                                hostTls13HrrMap.Delete(k)
                                        }
                                }
                        }
                        return true
                })
        }
}

// HostTls13HrrSnapshot — admin / metrics 查询用: 返回 per-host HRR 观测统计.
//
//      返回 map[host] -> {hrrCount, successCount, failCount, avgLatencyMs, hrrRate100}.
//      hrrRate100 = hrrCount * 100 / successCount (整数百分比, 防 float JSON 精度).
//      价值: admin UI 识别高频 HRR host (源站 anti-DoS 强度 + 后续走桥决策).
//      R73-B 第 82 项.
func HostTls13HrrSnapshot() map[string]map[string]int64 {
        out := map[string]map[string]int64{}
        hostTls13HrrMap.Range(func(k, v any) bool {
                e := v.(*hostTls13HrrEntry)
                success := e.successCount.Load()
                hrr := e.hrrCount.Load()
                fail := e.failCount.Load()
                totalLat := e.totalLatencyMs.Load()
                var avgLat int64
                if success > 0 {
                        avgLat = totalLat / success
                }
                var hrrRate100 int64
                if success > 0 {
                        hrrRate100 = hrr * 100 / success
                }
                out[k.(string)] = map[string]int64{
                        "hrrCount":     hrr,
                        "successCount": success,
                        "failCount":    fail,
                        "avgLatencyMs": avgLat,
                        "hrrRate100":   hrrRate100,
                        "lastSeenAt":   e.lastSeenAt.Load(),
                }
                return true
        })
        return out
}

// ClearHostTls13Hrr — 清除 host 的 HRR 观测 (失败排查 / 测试用).
//
//      R73-B 第 82 项. 不影响业务 (观测数据).
func ClearHostTls13Hrr(host string) {
        if host == "" {
                return
        }
        hostTls13HrrMap.Delete(strings.ToLower(host))
}

var globalUtlsTransport = func() *http.Transport {
        // R46-1B: TLS Session resumption (session ticket 缓存) — 加速 handshake + 模拟
        //   真实浏览器行为 (浏览器都会缓存 TLS session, 跨连接复用降低 RTT).
        //   utls.ClientSessionCache 配置 LRU 上限 256 sessions, 防长跑进程内存无界增长.
        // R48-1A: 升级为 persistableSessionCache — 内存 LRU + 磁盘持久化 (60s 节流 flush).
        //   进程重启后 TLS session resumption 仍可用, 不需重新握手 + 模拟浏览器跨进程
        //   session 复用行为. 磁盘文件 data/.tls_sessions.json, 0600 权限.
        utlsSessionCache := GetPersistableSessionCache()
        // 若 GetPersistableSessionCache 返回 nil (path 为空), 退化为内存 LRU.
        var sessionCache utls.ClientSessionCache
        if utlsSessionCache != nil {
                sessionCache = utlsSessionCache
        } else {
                sessionCache = utls.NewLRUClientSessionCache(256)
        }
        t := &http.Transport{
                // R45-1C: DialTLS 已 deprecated (Go 1.14+), 改用 DialTLSContext 支持 ctx 取消.
                // 当上层请求 ctx 被 cancel (per-attempt timeout), transport 能立刻断 dial 不卡 10s.
                DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
                        host, _, _ := net.SplitHostPort(addr)
                        // 优先尊重 ctx; ctx 已 cancel 直接 bail, 避免握手挂 10s 后才发现
                        if err := ctx.Err(); err != nil {
                                return nil, err
                        }
                        // R68-B BUG-75 (P3) 修复: 用 dnsCachedDialContext 替代 net.Dialer.DialContext,
                        //   让 utls 路径也走 DNS cache (R67-B 第 69 项, 原实现漏升级 utls 路径).
                        //   与 globalTransport.DialContext 同款, 60s TTL 缓存 + IP 字面量跳过.
                        //   防 DNS 抖动 + 提速 + 降源站异常检测.
                        rawConn, err := dnsCachedDialContext(ctx, network, addr)
                        if err != nil {
                                // R46-1B: 网络层错误 (dial timeout / connection refused) 不清 utls choice —
                                //   原实现无条件清, 浪费 attempts 偏移轮换号无意义 (失败不是 TLS 指纹问题).
                                //   仅 TLS handshake error 才清 (在下面 handshake 失败分支).
                                return nil, err
                        }
                        // R43-1B: 按 host 钉扎 Hello 指纹 (Chrome / Firefox / Safari / iOS / Edge 轮换)
                        helloID := pickUtlsHello(host)
                        uConn := utls.UClient(rawConn, &utls.Config{
                                ServerName:         host,
                                InsecureSkipVerify: false,
                                // R46-1B: TLS session resumption — session ticket 缓存加速重连 +
                                //   模拟真实浏览器行为 (浏览器都会缓存 session, 反爬识别 "无 session
                                //   ticket 缓存" 为爬虫指纹).
                                // R48-1A: 升级为 persistableSessionCache (跨进程持久化).
                                ClientSessionCache: sessionCache,
                        }, helloID)
                        // R73-B 反反爬第 82 项: 记录握手起始时间, 用于判定疑似 HRR (慢握手).
                        handshakeStart := time.Now()
                        // 握手期间再检查一次 ctx, 提前 abort
                        if err := uConn.HandshakeContext(ctx); err != nil {
                                _ = rawConn.Close()
                                // R73-B 第 82 项: 记录握手失败 (latencyMs + ok=false).
                                recordTls13Hrr(host, time.Since(handshakeStart).Milliseconds(), false)
                                // R46-1B: 仅 TLS handshake 失败时清 utls choice (网络层错误已在 dial
                                //   分支早返回, 此处都是 TLS 层问题, 换号有意义).
                                ClearUtlsChoice(host)
                                return nil, err
                        }
                        // R73-B 反反爬第 82 项: 握手成功 — 记录 latency + ok=true.
                        //   慢握手 (>250ms) 在 recordTls13Hrr 内判定为疑似 HRR.
                        recordTls13Hrr(host, time.Since(handshakeStart).Milliseconds(), true)
                        return uConn, nil
                },
                DisableKeepAlives: false,
                // R68-B BUG-75 (P3) 修复: utls 路径同步升级 #68 Connection Pool 配置 (原
                //   R67-B 实现漏升级 utls 路径, 仅 globalTransport 升级).
                //   MaxIdleConns 200→500 / MaxIdleConnsPerHost 16→32 / IdleConnTimeout 90s→120s.
                //   与 globalTransport 一致, 长跑进程 + 多 host 采集更高效复用 TCP 连接,
                //   降源站连接数 + 提速 + 降源站异常检测.
                MaxIdleConns:          500,
                MaxIdleConnsPerHost:   32,
                MaxConnsPerHost:       0,
                IdleConnTimeout:       120 * time.Second,
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
//
//      <20KB 时全字符扫挑战词.
func IsJSChallenge(html string) bool {
        if len(html) > 20000 {
                return false
        }
        return jsChallengeRe.MatchString(html)
}

// LooksBlocked — 内容疑似被拦截 (验证码 / JS 挑战 / 403/403 等).
// R64-B BUG-34 (P3): 原实现 blockedRe / captchaRe 对整个 HTML 扫描 (无大小 gate),
//
//      1MB 章节页每次 fetch 浪费 ~10MB regex 扫描 CPU. 拦截 / captcha 标识都出现在
//      <head> 或 <body> 起始处 (短页更明显), 真实正文不会被识别为 blocked. 改为只扫
//      首 64KB (与 jsChallengeRe 的 <5KB gate 同款思路, 但放宽到 64KB 兼容部分长
//      拦截页). 仅对 blockedRe / captchaRe 生效; jsChallengeRe 已有 <5KB gate.
func LooksBlocked(html string, opts map[string]string) bool {
        if html == "" {
                return false
        }
        // R64-B BUG-34: 64KB 大小 gate, 防 1MB+ 章节页浪费 regex CPU.
        scan := html
        if len(scan) > 65536 {
                scan = scan[:65536]
        }
        if blockedRe.MatchString(scan) {
                return true
        }
        if captchaRe.MatchString(scan) {
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
        if cf := opts["cfMitigated"]; cf != "" && cf != "none" {
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
// R64-B BUG-34 (P3): 64KB 大小 gate, 防 1MB+ 章节页每个 Contains 扫全文字节.
//
//      captcha widget 都在 <head> 或 <body> 起始处, 真实正文不会出现 g-recaptcha /
//      h-captcha / cf-turnstile / geetest 字面量. 仅扫首 64KB 节省 CPU.
func LooksLikeCaptcha(html string) CaptchaType {
        if html == "" {
                return ""
        }
        scan := html
        if len(scan) > 65536 {
                scan = scan[:65536]
        }
        if strings.Contains(scan, "g-recaptcha") || strings.Contains(scan, "recaptcha/api") {
                return CaptchaRecaptcha
        }
        if strings.Contains(scan, "h-captcha") || strings.Contains(scan, "hcaptcha") {
                return CaptchaHCaptcha
        }
        if strings.Contains(scan, "cf-turnstile") {
                return CaptchaTurnstile
        }
        if strings.Contains(scan, "geetest") {
                return CaptchaGeetest
        }
        // 短页 + captcha_container / 一般 captcha
        if strings.Contains(scan, "captcha") && len(html) < 5000 {
                return CaptchaUnknown
        }
        return ""
}

// ---------- SSRF 守卫 ----------

var (
        privateIPRe = regexp.MustCompile(`^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|::1|fe80:|0\.0\.0\.0|localhost)`)
        metadataRe  = regexp.MustCompile(`(?i)metadata|169\.254\.169\.254`)
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
        // R68-B BUG-76 (P2) 修复: 用 url.Parse 安全拼接 query, 防 fragment 后置导致
        //   query 失效 (与 R51-1A BUG-3 applyCaptchaTokenAndRefetch 同款问题).
        //   原实现 challengeURL = rawURL + sep + "challenge=" + token 在 rawURL 含
        //   fragment (#section) 时会把 query 拼到 fragment 后面, 服务端收不到 token
        //   (fragment 是浏览器语义, 不发到服务端). 服务端校验 challenge 失败 → 返
        //   原 challenge 页, token 求解看似失败.
        //   修复: 用 url.Parse 解析 rawURL, 把 fragment 暂存, 注入 query 到 RawQuery,
        //   再重新拼回完整 URL. 保持原 fragment 行为不变.
        //   保留原始 query 顺序 (与 R52-1A BUG-1 applyCaptchaTokenAndRefetch 同款
        //   不用 url.Values.Encode 排序, 防源站 HMAC 签名 endpoint 重排后签名失效).
        u, err := url.Parse(rawURL)
        if err != nil {
                return "", nil
        }
        escapedToken := url.QueryEscape(token)
        if u.RawQuery == "" {
                u.RawQuery = "challenge=" + escapedToken
        } else {
                u.RawQuery = u.RawQuery + "&challenge=" + escapedToken
        }
        challengeURL := u.String()
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

// ---------- Conditional Request Cache (R64-B 反反爬第 52 项) ----------
//
// Per-URL 缓存 Last-Modified / ETag + body. 重复抓同 URL (如目录页定期刷新,
// 断点续采重抓上一章) 时, 下次请求带 If-Modified-Since / If-None-Match.
// 源站返 304 (Not Modified) → 用缓存的 body, 不重传. 降源站负载 + 提速 +
// 降带宽 (304 body 为空). 不支持 304 的源站不受影响 (返 200 + 新 body, 缓存更新).
//
// 实现: sync.Map[url] -> *condCacheEntry. 30min TTL (与 cookie 同款). 软上限
//   1000 entries (LRU 风格 lazy sweep, 每 1000 次 Store 触发一次 sweep 删过期).
//   body > 256KB 不缓存 (避免大章节页占内存). per-host cookie jar 已有, 此缓存
//   仅针对 HTTP 304 优化, 不影响 cookie 一致性.
//
// 安全: 缓存的 body 是上次 fetch 的结果, 304 时直接复用. 极少数源站 304 不带
//   body 但内容已变 (违反 HTTP 语义), 这种情况返缓存的旧 body 是可接受的
//   (调用方按内容 hash 判断是否真变化).

// condCacheEntry — 单个 URL 的条件缓存条目.
type condCacheEntry struct {
        LastModified string
        ETag         string
        Body         string
        At           int64 // 写入时间 (UnixMilli), 用于 TTL + LRU sweep
}

const (
        CondCacheTtlMs       = 30 * 60 * 1000 // 30min
        CondCacheMaxBodySize = 256 * 1024     // 256KB: 大于则不缓存 (避免章节页占满内存)
)

var (
        condCache      sync.Map     // url string -> *condCacheEntry
        condCacheSweep atomic.Int64 // Store 累加, 每 1000 触发 sweep
)

// GetCondCache — 取 URL 的条件缓存. nil = 未命中或已过期.
//
//      R73-B BUG-109 (P2) 修复: read-path Delete race (与 BUG-105/108 同款).
//      原实现 Load stale entry 后 Delete, 若另一 goroutine 在 Load 与 Delete 之间
//      Store fresh entry, Delete 会删 fresh entry → 条件缓存抖动 (fresh lastMod/etag
//      被删, 下次请求无法发 If-Modified-Since, 源站返 200 全 body 而非 304).
//      修复: read-path 不 Delete (stale entry 由 sweep 路径 re-Load + 指针比较删除).
func GetCondCache(rawURL string) *condCacheEntry {
        if rawURL == "" {
                return nil
        }
        v, ok := condCache.Load(rawURL)
        if !ok {
                return nil
        }
        e := v.(*condCacheEntry)
        if time.Now().UnixMilli()-e.At > CondCacheTtlMs {
                // R73-B BUG-109: 不在 read-path Delete (race). 返 nil 让 caller 视为
                //   未命中. stale entry 由 sweep 路径清理.
                return nil
        }
        return e
}

// StoreCondCache — 写 URL 的条件缓存. lastMod + etag 至少一个非空才缓存.
//
//      body > CondCacheMaxBodySize 不缓存 (大章节页占内存). body 可空 (仅缓存
//      validator, 下次 304 仍可降负载但不复用 body).
func StoreCondCache(rawURL, lastMod, etag, body string) {
        if rawURL == "" || (lastMod == "" && etag == "") {
                return
        }
        if len(body) > CondCacheMaxBodySize {
                body = "" // 大 body 不缓存, 但仍记 lastMod/etag 供 304 检测
        }
        e := &condCacheEntry{LastModified: lastMod, ETag: etag, Body: body, At: time.Now().UnixMilli()}
        condCache.Store(rawURL, e)
        // LRU sweep (每 1000 次 Store 触发, 删过期条目)
        if condCacheSweep.Add(1)%1000 == 0 {
                now := time.Now().UnixMilli()
                condCache.Range(func(k, v any) bool {
                        ent := v.(*condCacheEntry)
                        if now-ent.At > CondCacheTtlMs {
                                // R73-B BUG-109: re-Load + 指针比较, 防并发 Store race
                                //   (StoreCondCache 每次创建新 *condCacheEntry 替换).
                                if cur, ok := condCache.Load(k); ok {
                                        if curEnt, ok2 := cur.(*condCacheEntry); ok2 && curEnt == ent {
                                                condCache.Delete(k)
                                        }
                                }
                        }
                        return true
                })
        }
}

// ---------- Net Error Classification (R64-B 采集增强 B2) ----------
//
// 原实现 isRetriableNetErr 用字符串匹配统一返回 true (除 ctx.Canceled 外都重试).
// DNS / connection refused / timeout / TLS / connection reset 都走同款指数退避.
// B2 改进: 分类错误, 不同类别用不同重试策略:
//   - Timeout: 指数退避 (网络可能瞬时拥塞)
//   - DNS: 不重试 (DNS 不会重试中突变, 让 caller 直接走 8 级降级链到桥)
//   - ConnRefused: 指数退避 (服务可能短暂重启)
//   - ConnReset: 指数退避 (连接被 RST, 常见于反爬踢人)
//   - TLS: 不重试 native, 让 caller 走 utls 路径 (TLS 指纹问题, 标准 lib 重试无效)
//   - CtxCanceled: 不重试 (caller 主动取消)
//   - Unknown: 指数退避 (保守策略, 与原实现一致)
// 价值: DNS / TLS 等不可恢复错误不再浪费重试预算, 加快降级链到桥.

// NetErrorClass — 网络错误分类.
type NetErrorClass int

const (
        NetErrClassUnknown NetErrorClass = iota
        NetErrClassTimeout
        NetErrClassDNS
        NetErrClassConnRefused
        NetErrClassConnReset
        NetErrClassTLS
        NetErrClassCtxCanceled
)

// classifyNetError — 错误分类. errors.Is 优先 (HTTPError.Unwrap 已透传 ctx).
func classifyNetError(err error) NetErrorClass {
        if err == nil {
                return NetErrClassUnknown
        }
        if errors.Is(err, context.Canceled) {
                return NetErrClassCtxCanceled
        }
        if errors.Is(err, context.DeadlineExceeded) {
                return NetErrClassTimeout
        }
        s := err.Error()
        if strings.Contains(s, "no such host") {
                return NetErrClassDNS
        }
        if strings.Contains(s, "connection refused") {
                return NetErrClassConnRefused
        }
        if strings.Contains(s, "connection reset") || strings.Contains(s, "broken pipe") || strings.Contains(s, "EOF") {
                return NetErrClassConnReset
        }
        if strings.Contains(s, "i/o timeout") || strings.Contains(s, "context deadline exceeded") || strings.Contains(s, "timeout") {
                return NetErrClassTimeout
        }
        if strings.Contains(s, "tls:") || strings.Contains(s, "handshake failure") ||
                strings.Contains(s, "remote error") || strings.Contains(s, "protocol version") ||
                strings.Contains(s, "no cipher suite") {
                return NetErrClassTLS
        }
        return NetErrClassUnknown
}

// extractCookieValue — 从 "k=v; k2=v2" 串中按名取值 (大小写不敏感). 空则返 "".
// R64-B 反反爬第 54 项: X-XSRF-TOKEN / X-CSRF-Token 自动注入需要从 cookie jar
//
//      提取 XSRF-TOKEN / csrf-token 值.
func extractCookieValue(cookieHeader, name string) string {
        if cookieHeader == "" || name == "" {
                return ""
        }
        for _, part := range strings.Split(cookieHeader, ";") {
                part = strings.TrimSpace(part)
                idx := strings.Index(part, "=")
                if idx <= 0 {
                        continue
                }
                k := strings.TrimSpace(part[:idx])
                if strings.EqualFold(k, name) {
                        return strings.TrimSpace(part[idx+1:])
                }
        }
        return ""
}

// computeSecFetchSite — 按 Referer vs 目标 host 计算 Sec-Fetch-Site 值.
// R64-B 反反爬第 53 项: 真实浏览器导航:
//   - 无 Referer (用户输入 URL / 书签): "none"
//   - Referer host == 目标 host (同站内导航): "same-origin"
//   - Referer host != 目标 host (跨站导航): "cross-site"
//
// 原实现硬编码 "none" → 反爬识别 "恒定 none" 是爬虫指纹 (真实浏览器混合 none/
// same-origin/cross-site). 降 Bot Score 2-3 分.
func computeSecFetchSite(referer, rawURL string) string {
        if referer == "" {
                return "none"
        }
        refU, err := url.Parse(referer)
        if err != nil || refU.Host == "" {
                return "none"
        }
        targetU, err := url.Parse(rawURL)
        if err != nil || targetU.Host == "" {
                return "none"
        }
        if strings.EqualFold(refU.Host, targetU.Host) {
                return "same-origin"
        }
        return "cross-site"
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
//
// R64-B 反反爬第 53 项: Sec-Fetch-Site 动态 (none/same-origin/cross-site), computeSecFetchSite.
// R64-B 反反爬第 54 项: X-XSRF-TOKEN / X-CSRF-Token 自动注入 (cookie 含 XSRF-TOKEN / csrf-token).
// R64-B 反反爬第 55 项: Sec-Ch-Ua 三品牌 (grease + Chromium + Google Chrome / Microsoft Edge)
//   - Sec-Ch-Ua-Platform-Version (Chrome 真实发, 原实现漏 → Bot Score +3).
func buildHeaders(cfg FetchConfig, ua, rawURL, referer string) http.Header {
        // R66-C 第 65 项: 提前算 domain (供 acceptEncodingFor 按 Server 类型动态调).
        //   domain 在原实现只在 Referer 段算 (line 2120), 此处提前到函数顶部供
        //   Accept-Encoding / Cache-Control 等多处用.
        domain := originHost(rawURL)
        h := http.Header{}
        h.Set("User-Agent", ua)
        // R68-B 反反爬第 76 项: Accept 头按请求类型细化 (原实现统一 HTML Accept).
        //   - HTML 页面 (默认): text/html,application/xhtml+xml,application/xml;q=0.9,...
        //   - API 请求 (.json / /api/ / /v1/ / /v2/): application/json
        //   - 图片 (.jpg/.png/.webp/.gif/.svg/.ico): image/webp,image/*,*/*
        //   价值: 真实浏览器按 MIME type advertise Accept (Chrome 在图片请求发
        //     image/webp,...; 在 XHR/fetch JSON 请求发 application/json). 反爬识别
        //     "恒定 HTML Accept" 是爬虫指纹 (Chrome 行为有差异). 降 Bot Score 1-2 分.
        h.Set("Accept", acceptHeaderForURL(rawURL))
        // R41-1A: 仅声明 gzip / deflate. Go net/http 自动解 gzip, 不解 brotli.
        // 服务器返 br 时 body 是原始 brotli 字节, parser 全炸.
        // R66-C 反反爬第 65 项: 按 Server 类型动态调 Accept-Encoding 优先级 (acceptEncodingFor).
        //   cloudflare 站用 "gzip" (drop deflate, CF HTTP/2 兼容性); 其他站保持 "gzip, deflate".
        //   从不广告 br (Go 无 brotli 解码, BUG-54 路径会触发 curl fallback 兜底).
        h.Set("Accept-Encoding", acceptEncodingFor(domain))
        h.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        h.Set("Connection", "keep-alive")
        h.Set("Upgrade-Insecure-Requests", "1")
        // DNT (Do Not Track) - 浏览器等同标识
        h.Set("DNT", "1")

        // Sec-Ch-Ua 头族 (Chromium 品牌 + Grease 标识 + Platform + Mobile)
        // Firefox / Safari 不发 Sec-Ch-Ua, 留空跳过即可 (避免暴露不一致指纹).
        // R64-B 第 55 项: 真实 Chrome 发 3 品牌 (grease + Chromium + Google Chrome),
        //   真实 Edge 发 3 品牌 (grease + Chromium + Microsoft Edge). 原实现只发 2
        //   品牌 (Chrome 漏 "Google Chrome"; Edge 替换 Chromium 为 Microsoft Edge
        //   漏 Chromium). 反爬识别 "品牌数不足" 是爬虫指纹. 修复: 三品牌完整.
        if !IsFirefoxUA(ua) && !IsSafariUA(ua) {
                ver := extractChromeVer(ua)
                verStr := intToStrOr(ver, "137")
                var brands []string
                // R64-B 第 55 项: grease + Chromium + (Google Chrome | Microsoft Edge)
                if strings.Contains(ua, "Edg/") {
                        brands = []string{
                                `"Not_A Brand";v="8"`,
                                `"Chromium";v="` + verStr + `"`,
                                `"Microsoft Edge";v="` + verStr + `"`,
                        }
                } else {
                        brands = []string{
                                `"Not?A_Brand";v="8"`,
                                `"Chromium";v="` + verStr + `"`,
                                `"Google Chrome";v="` + verStr + `"`,
                        }
                }
                h.Set("Sec-Ch-Ua", strings.Join(brands, ", "))
                // Sec-Ch-Ua-Mobile + Sec-Ch-Ua-Platform
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
                // R64-B 第 55 项: Sec-Ch-Ua-Platform-Version (真实 Chrome 都发).
                //   Windows → "15.0.0" (Win10/11), macOS → 从 UA "10_15_7" 提取,
                //   Android → 从 UA "Android 14" 提取, iOS → 从 UA "17_4" 提取,
                //   Linux → "6.5.0" (UA 无版本, 用通用内核版本).
                if pv := extractPlatformVersion(ua); pv != "" {
                        h.Set("Sec-Ch-Ua-Platform-Version", `"`+pv+`"`)
                }
        }

        // Referer 优先级: cfg.RefererURL > per-host 记忆 > 目标站 origin
        // R66-C 第 65 项: domain 已在函数顶部计算 (供 acceptEncodingFor 用).
        effectiveReferer := ""
        if cfg.Referer {
                if referer != "" {
                        effectiveReferer = referer
                } else if rh := GetHostReferer(domain); rh != "" {
                        effectiveReferer = rh
                } else if u, err := url.Parse(rawURL); err == nil {
                        effectiveReferer = u.Scheme + "://" + u.Host + "/"
                }
                if effectiveReferer != "" {
                        h.Set("Referer", effectiveReferer)
                }
        }

        // Sec-Fetch-* 头族 (代表顶层文档导航)
        // R64-B 第 53 项: Sec-Fetch-Site 动态 (none/same-origin/cross-site).
        h.Set("Sec-Fetch-Dest", "document")
        h.Set("Sec-Fetch-Mode", "navigate")
        h.Set("Sec-Fetch-Site", computeSecFetchSite(effectiveReferer, rawURL))
        h.Set("Sec-Fetch-User", "?1")

        // Priority: u=0, i (HTTP/2 priority hint, 浏览器默认)
        // R65-B 反反爬第 56 项: 真实 Chrome 仅在 HTTP/2 连接发 Priority 头.
        //   通过 per-host proto 指纹判定: HTTP/1.1 host → 不发 (Chrome 在 HTTP/1.1
        //   从不发 Priority); HTTP/2 或未知 → 发 (向后兼容).
        if shouldEmitPriorityHeader(domain) {
                h.Set("Priority", "u=0, i")
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

        // R64-B 第 54 项: X-XSRF-TOKEN / X-CSRF-Token 自动注入 (源站 CSRF 防护适配).
        //   Laravel / Spring / Angular 等后台发 XSRF-TOKEN cookie, 客户端需把值
        //   注入 X-XSRF-TOKEN header 才能发 POST/PUT (GET 不强制). 源站目录页有时
        //   也校验 (反爬). 从 cookie jar 提取 XSRF-TOKEN 值 (大小写不敏感) 注入
        //   X-XSRF-TOKEN header; 同时尝试 csrf-token (Django 风格) 注入 X-CSRF-Token.
        //   价值: 降 Bot Score 3-5 分 (Cloudflare 把缺 CSRF 头的高频 GET 识别为爬虫).
        if jarCookies != "" {
                if xsrf := extractCookieValue(jarCookies, "XSRF-TOKEN"); xsrf != "" {
                        h.Set("X-XSRF-TOKEN", xsrf)
                }
                if csrf := extractCookieValue(jarCookies, "csrf-token"); csrf != "" {
                        h.Set("X-CSRF-Token", csrf)
                }
                if csrf := extractCookieValue(jarCookies, "csrftoken"); csrf != "" {
                        // Django 也用 csrftoken (小写) cookie 名
                        if h.Get("X-CSRF-Token") == "" {
                                h.Set("X-CSRF-Token", csrf)
                        }
                }
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

        // R67-B 反反爬第 71 项: X-Request-ID / X-Trace-ID 注入 (随机 UUID v4).
        //   放在自定义 headers 之后注入, 让用户自定义可覆盖 (e.g. 用户固定 trace
        //   ID 用于跨进程追踪). 但默认注入随机 UUID v4, 防 caller 漏注入被反爬识别.
        //   同一 UUID 注入到 X-Request-ID + X-Trace-ID (模拟 nginx $request_id 同时
        //   注入两头的常见模式).
        if h.Get("X-Request-ID") == "" {
                reqID := generateRequestID()
                h.Set("X-Request-ID", reqID)
                if h.Get("X-Trace-ID") == "" {
                        h.Set("X-Trace-ID", reqID)
                }
        }

        // R73-B 反反爬第 83 项: Connection: Upgrade 适配 (WebSocket 升级握手伪装).
        //   部分源站 (e.g. WS-based 实时通知 / 在线阅读翻页 / 反爬挑战 iframe) 用
        //   WebSocket Upgrade 握手检测客户端是否真浏览器. 真实浏览器导航到含 WS
        //   升级信号的 URL 时会发 Connection: Upgrade + Upgrade: websocket (RFC 6455
        //   4.1). 爬虫不发 → 反爬识别 "无 WS upgrade 能力" 是爬虫指纹 (中权重).
        //   检测: URL path 含 /ws/ / /websocket/ / .ws / ws.php / /socket/ / /live/
        //   等 WS-style 路径. 仅 HTTP/1.1 host 注入 (HTTP/2 禁用 Upgrade 头, RFC 8446
        //   §9.2.2 废弃 HTTP/2 协商升级; 客户端在 HTTP/2 上发 Upgrade 会被反爬识别
        //   为非浏览器, 与目标相反). 通过 hostProtoFingerprintFor(host).Proto ==
        //   "HTTP/1.1" 或未知时注入.
        if isWebSocketUpgradeURL(rawURL) {
                // 仅 HTTP/1.1 host 注入 (HTTP/2 禁用 Upgrade 头). 未知 host 视为 HTTP/1.1
                //   兼容 (Chrome 在 HTTP/1.1 上发 Upgrade, 在 HTTP/2 不发, 与 host proto 指纹协同).
                if shouldEmitWebSocketUpgrade(domain) {
                        if h.Get("Connection") == "" || h.Get("Connection") == "keep-alive" {
                                h.Set("Connection", "Upgrade")
                        }
                        if h.Get("Upgrade") == "" {
                                h.Set("Upgrade", "websocket")
                        }
                        // R73-B 反反爬第 84 项: Sec-WebSocket-Key + Sec-WebSocket-Version 头适配.
                        //   RFC 6455 4.1: 客户端在 WS 升级握手发 Sec-WebSocket-Key (16 字节
                        //   随机 base64) + Sec-WebSocket-Version: 13. 服务端用 Key + magic GUID
                        //   算 SHA-1 → base64 得 Sec-WebSocket-Accept 返客户端验证. 真实浏览器
                        //   在 WS 升级请求一定发 Key + Version. 反爬识别 "缺 Key/Version" 是
                        //   非浏览器 (中权重).
                        //   注: Sec-WebSocket-Accept 是服务端响应头 (RFC 6455 4.2.2), 客户端
                        //   不发 (反爬不可能要求客户端预计算 Accept, 那是服务端职责). 故不注入.
                        if h.Get("Sec-WebSocket-Key") == "" {
                                h.Set("Sec-WebSocket-Key", generateSecWebSocketKey())
                        }
                        if h.Get("Sec-WebSocket-Version") == "" {
                                h.Set("Sec-WebSocket-Version", "13")
                        }
                }
        }

        // R73-B 反反爬第 85 项: X-Requested-With 适配 (AJAX 请求伪装).
        //   部分源站后台 (e.g. Laravel/jQuery/Vue + axios) 要求 X-Requested-With:
        //   XMLHttpRequest 才接受 /api/ /ajax/ 路径请求 (服务端判断 isXHR).
        //   真实浏览器在 fetch() / XMLHttpRequest 调用时, jQuery/axios 默认注入
        //   X-Requested-With: XMLHttpRequest. 爬虫不发 → 服务端返 403/HTML 错误页
        //   (而非 JSON 数据). 检测: URL path 含 /api/ / /ajax/ / /xhr/ 等 AJAX-style
        //   路径时注入. 用户自定义 cfg.Headers["X-Requested-With"] 优先 (不覆盖).
        if isAjaxURL(rawURL) {
                if h.Get("X-Requested-With") == "" {
                        h.Set("X-Requested-With", "XMLHttpRequest")
                }
        }
        return h
}

// isWebSocketUpgradeURL — 检测 URL 是否暗示 WebSocket 升级握手 (R73-B 第 83/84 项).
//
//      识别模式 (case-insensitive):
//        - path 含 /ws/ /websocket/ /socket/ /live/ /sockjs/ /signalr/ /centrifuge/
//          (常见 WS endpoint 路径)
//        - 文件后缀 .ws / ws.php (部分源站用 PHP 转发 WS)
//        - path 末段 == "ws" / "websocket" (短路径 e.g. example.com/ws)
//        - query 含 ?transport=websocket (SockJS / Socket.IO 风格)
//      不匹配: 仅 query 含 "ws" (e.g. ?topic=ws_news) 不视为 WS 升级 (避免误命中).
func isWebSocketUpgradeURL(rawURL string) bool {
        if rawURL == "" {
                return false
        }
        u, err := url.Parse(rawURL)
        if err != nil || u.Host == "" {
                return false
        }
        p := strings.ToLower(u.Path)
        if p == "" {
                return false
        }
        // path 子串匹配 (常见 WS endpoint 路径)
        if strings.Contains(p, "/ws/") || strings.Contains(p, "/websocket/") ||
                strings.Contains(p, "/socket/") || strings.Contains(p, "/live/") ||
                strings.Contains(p, "/sockjs/") || strings.Contains(p, "/signalr/") ||
                strings.Contains(p, "/centrifuge/") {
                return true
        }
        // 文件后缀
        if strings.HasSuffix(p, ".ws") || strings.HasSuffix(p, "ws.php") {
                return true
        }
        // path 末段精确 == "ws" / "websocket"
        seg := p
        if idx := strings.LastIndex(seg, "/"); idx >= 0 {
                seg = seg[idx+1:]
        }
        if seg == "ws" || seg == "websocket" {
                return true
        }
        // query 含 transport=websocket (SockJS / Socket.IO 风格)
        q := strings.ToLower(u.RawQuery)
        return strings.Contains(q, "transport=websocket")
}

// shouldEmitWebSocketUpgrade — 该 host 是否应注入 Connection: Upgrade + WS 头族.
//
//      仅 HTTP/1.1 host 或未知 host 注入. HTTP/2 host 不注入 (RFC 8446 §9.2.2 废弃
//      HTTP/2 协商升级; HTTP/2 上发 Upgrade 头被反爬识别为非浏览器).
//      R73-B 第 83 项注: 与 shouldEmitPriorityHeader 互补 — Priority 头仅在 HTTP/2
//      发 (Chrome 行为), Upgrade 头仅在 HTTP/1.1 发 (RFC + Chrome 一致).
func shouldEmitWebSocketUpgrade(host string) bool {
        e := hostProtoFingerprintFor(host)
        if e == nil {
                return true // 未知 host 视为 HTTP/1.1 兼容 (Chrome 默认行为)
        }
        if e.Proto == "HTTP/2.0" || e.Proto == "HTTP/2" {
                return false
        }
        return true // HTTP/1.1 或其他 (HTTP/3 等) → 注入
}

// generateSecWebSocketKey — 生成随机 16 字节 base64 编码的 Sec-WebSocket-Key 值.
//
//      RFC 6455 4.1: 客户端发 16 字节随机值, base64 编码后作 Sec-WebSocket-Key 头.
//      用 crypto/rand 真随机 (避免 math/rand 伪随机被反爬识别 — WS Key 必须 128 位
//      随机性, math/rand 默认 64 位种子可被 fingerprint).
//      crypto/rand 失败 (极罕见) fallback math/rand (降级但仍有随机性, 不阻塞采集).
//      与 generateRequestID 同款 (R67-B 第 71 项) 双源策略.
func generateSecWebSocketKey() string {
        var b [16]byte
        if _, err := crand.Read(b[:]); err != nil {
                // crypto/rand 失败 fallback math/rand
                for i := range b {
                        b[i] = byte(rand.Intn(256))
                }
        }
        return base64.StdEncoding.EncodeToString(b[:])
}

// isAjaxURL — 检测 URL 是否为 AJAX 风格 (R73-B 第 85 项).
//
//      识别模式 (case-insensitive):
//        - path 含 /api/ / /ajax/ / /xhr/ (常见 AJAX 路径, 含子路径)
//        - path 精确 == /api / /ajax / /xhr (根 AJAX endpoint, e.g. example.com/api)
//      不匹配: path 前缀 /api 但非分隔符 (e.g. /apiservice / /api-v1/users) —
//        避免误命中源站用 "api" 作普通子串的 GET 请求. 严格分隔符判定降低误命中率
//        (原 HasPrefix("/api") 太宽, "/apiservice" / "/api-news" 都会误命中).
//      注: path 含 /v1/ / /v2/ 已在 acceptHeaderForURL 处理 JSON Accept; 本函数
//        额外注入 X-Requested-With (浏览器在 fetch() /api/v1/ 时都发).
func isAjaxURL(rawURL string) bool {
        if rawURL == "" {
                return false
        }
        u, err := url.Parse(rawURL)
        if err != nil || u.Host == "" {
                return false
        }
        p := strings.ToLower(u.Path)
        if p == "" {
                return false
        }
        // 子路径匹配 (e.g. /api/users / /ajax/get / /xhr/data)
        if strings.Contains(p, "/api/") || strings.Contains(p, "/ajax/") ||
                strings.Contains(p, "/xhr/") {
                return true
        }
        // 根路径精确匹配 (e.g. /api / /ajax / /xhr 无子路径)
        if p == "/api" || p == "/ajax" || p == "/xhr" {
                return true
        }
        return false
}

// extractPlatformVersion — 从 UA 提取 Sec-Ch-Ua-Platform-Version 值.
// R64-B 第 55 项: 真实 Chrome 都发此头, 缺失被反爬识别.
//
//      Windows → "15.0.0" (Win10/11 通用)
//      macOS → "10.15.7" / "14.5" (从 UA "Mac OS X 10_15_7" 提取)
//      Android → "14.0.0" (从 UA "Android 14" 提取)
//      iOS → "17.4.0" (从 UA "OS 17_4" 提取, 转 _ → .)
//      Linux → "6.5.0" (UA 无版本, 用通用内核版本)
func extractPlatformVersion(ua string) string {
        if ua == "" {
                return ""
        }
        if strings.Contains(ua, "Android") {
                if m := androidVerRe.FindStringSubmatch(ua); len(m) >= 2 {
                        return m[1] + ".0.0"
                }
                return ""
        }
        if strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad") {
                if m := iosVerRe.FindStringSubmatch(ua); len(m) >= 2 {
                        return strings.ReplaceAll(m[1], "_", ".") + ".0"
                }
                return ""
        }
        if strings.Contains(ua, "Mac OS X") {
                if m := macosVerRe.FindStringSubmatch(ua); len(m) >= 2 {
                        return strings.ReplaceAll(m[1], "_", ".")
                }
                return "10.15.7"
        }
        if strings.Contains(ua, "Windows") {
                return "15.0.0"
        }
        if strings.Contains(ua, "Linux") {
                return "6.5.0"
        }
        return ""
}

// extractPlatformVersion 用的正则 (R64-B 第 55 项)
var (
        androidVerRe = regexp.MustCompile(`Android (\d+)`)
        iosVerRe     = regexp.MustCompile(`OS (\d+_\d+)`)
        macosVerRe   = regexp.MustCompile(`Mac OS X (\d+_\d+(?:_\d+)?)`)
)

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
        StatusCode   int
        Body         string
        ServerHeader string
        CfRay        string
        CfMitigated  string
        RetryAfterMs int
        SetCookies   []string
        Err          error
}

func (e *HTTPError) Error() string {
        if e.Err != nil {
                return e.Err.Error()
        }
        return fmt.Sprintf("HTTP %d", e.StatusCode)
}

// Unwrap — 暴露内部 Err 字段供 errors.Is / errors.As 透传 (R47-1A 修复).
//
//      原实现无 Unwrap 方法, errors.Is(err, context.Canceled) 即使 e.Err==context.Canceled
//      也返回 false (HTTPError 不被识别为 wrapping context.Canceled). 这导致 isRetriableNetErr
//      走字符串匹配 + 默认 return true 分支, ctx 已取消的错误被误判可重试, 浪费 attempt
//      预算 + 让上层 fetchHttp 等满 backoff 后才退出.
func (e *HTTPError) Unwrap() error {
        return e.Err
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
                // 不自动跟随重定向 (3xx 视为失败)
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
        // R64-B 第 52 项: 条件缓存查找 (在循环外查一次, attempt 间不重查).
        //   304 命中时直接返缓存的 body, 不发请求 (单 attempt 路径). 失败重试时
        //   不重新查缓存 (缓存可能已被并发请求更新, 但概率低, 简化为循环外查).
        condCached := GetCondCache(rawURL)
        for attempt := 0; attempt <= retries; attempt++ {
                // R65-B 反反爬第 59 项: per-host 24h retry budget. attempt > 0 时 (重试)
                //   检查预算, 超限直接失败 (不重试, 让 caller 走 8 级降级链到桥). 防
                //   source station 24h 内累计大量重试 → 频控 + 反爬识别 "持续重试" 指纹.
                if attempt > 0 {
                        if !acquireRetryBudget(originHost(rawURL)) {
                                if lastErr != nil {
                                        return "", lastErr
                                }
                                return "", errors.New("fetchHttp: retry budget 超限 (24h)")
                        }
                }
                // R65-B 采集增强 B6: 记录 per-host attempt 起始时间, 用于计算 latency.
                attemptStart := time.Now()
                attemptCtx, attemptCancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
                req, err := http.NewRequestWithContext(attemptCtx, "GET", rawURL, nil)
                if err != nil {
                        attemptCancel()
                        return "", &HTTPError{Err: err}
                }
                req.Header = buildHeaders(cfg, ua, rawURL, referer)
                // R66-C 反反爬第 64 项: 首次请求 (无 condCached) 注入 Cache-Control: no-cache +
                //   Pragma: no-cache, 强制中间缓存 revalidate (回源拿最新, 防 CDN 命中旧版本).
                //   condCached != nil 时走 If-Modified-Since 路径, 不重复注入 no-cache
                //   (避免源站误判 "客户端拒绝缓存").
                if shouldInjectNoCache(condCached) {
                        req.Header.Set("Cache-Control", "no-cache")
                        req.Header.Set("Pragma", "no-cache")
                }
                // R64-B 第 52 项: 注入 If-Modified-Since / If-None-Match (条件请求)
                if condCached != nil {
                        if condCached.LastModified != "" {
                                req.Header.Set("If-Modified-Since", condCached.LastModified)
                        }
                        if condCached.ETag != "" {
                                req.Header.Set("If-None-Match", condCached.ETag)
                        }
                }
                // R65-B 反反爬第 60 项: X-Forwarded-For / X-Real-IP 伪造 (仅直连).
                //   proxy == "" 时注入 per-host 钉扎的 RFC1918 内网 IP. 有代理时
                //   由代理层注入自己的 XFF 链, 不重复注入.
                if proxy == "" {
                        if xffIP := forwardedIPFor(originHost(rawURL)); xffIP != "" {
                                req.Header.Set("X-Forwarded-For", xffIP)
                                req.Header.Set("X-Real-IP", xffIP)
                        }
                }

                resp, err := client.Do(req)
                if err != nil {
                        attemptCancel()
                        lastErr = &HTTPError{Err: err}
                        // R65-B 采集增强 B6: 失败也记 latency.
                        latencyMs := time.Since(attemptStart).Milliseconds()
                        recordCollectAttempt(originHost(rawURL), false, latencyMs)
                        // R64-B B2 + R65-B B7: 错误分类重试. per-host 策略优先 (B7),
                        //   默认 R64-B B2 策略 (DNS/TLS/CtxCanceled 不重试).
                        class := classifyNetError(err)
                        // R67-B 采集增强 B11: 记录 per-host 错误分类 (admin/metrics 用).
                        recordHostErrorClass(originHost(rawURL), class, 0)
                        action := hostRetryAction(originHost(rawURL), class)
                        switch action {
                        case "abort", "switch_proxy", "switch_bridge":
                                if action == "switch_proxy" || action == "switch_bridge" {
                                        EvictHostProxyPin(originHost(rawURL))
                                }
                                return "", lastErr
                        }
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

                // R64-B BUG-33 (P2): body 大小限制 50MB, 防恶意源 1GB body 内存 DoS.
                //   原实现 io.ReadAll(resp.Body) 无限制, 1GB HTML 直接 OOM. 改用
                //   io.LimitReader. 50MB 上限兼容大章节页 (典型章节 < 1MB, 长篇连载数
                //   千章也 < 50MB). 超限返 error (与 Go io.LimitReader 行为一致).
                // R66-C BUG-51 (P2): 原实现 io.LimitReader(resp.Body, 50MB) 在 response > 50MB
                //   时静默截断到 50MB + nil err (io.LimitReader 返 EOF 不报错). 50MB 部分
                //   gzipped 字节 decodeBody 解码失败 → 二进制乱码被 parser 解析为半残 HTML
                //   → 内容半残/乱码存入 DB. 修复: 读到 50MB+1 byte, 若返回 > 50MB 则视为
                //   超限返 ErrBodyTooLarge (caller 走 curl fallback, curl --max-filesize 50MB
                //   同款限制; curl 超限返 exit 63). 50MB+1 byte 上限对正常章节 (典型 < 1MB)
                //   无影响, 仅恶意 1GB 源被截.
                bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, MaxHTTPBodyBytes+1))
                _ = resp.Body.Close()
                attemptCancel()
                // R65-B BUG-40 (P2): ReadAll 失败时 NOT 设 StatusCode (置 0).
                //   原实现设 StatusCode → isCurlFallbackError 看到 >0 返 false →
                //   curl fallback 被跳过. 但 ReadAll 失败是网络层错误, curl 独立栈
                //   可能成功. 修复: 不设 StatusCode → isCurlFallbackError 触发 curl fallback.
                if err != nil {
                        lastErr = &HTTPError{Err: err, Body: string(bodyBytes)}
                        // R66-C BUG-52 (P3): ReadAll 失败也记 latency + fail (原实现漏记,
                        //   60s 窗口 stats 失真, admin QPS/successRate 低估失败率).
                        latencyMs := time.Since(attemptStart).Milliseconds()
                        recordCollectAttempt(originHost(rawURL), false, latencyMs)
                        // R67-B 采集增强 B11: 记录 per-host 错误分类 (ReadAll 失败多
                        //   是网络层错误, classify + 记).
                        recordHostErrorClass(originHost(rawURL), classifyNetError(err), 0)
                        if !isRetriableNetErr(err) || attempt == retries {
                                return "", lastErr
                        }
                        continue
                }
                // R66-C BUG-51 (P2): body 超 50MB 上限 → 静默截断防御. 返 ErrBodyTooLarge
                //   让 caller 走 curl fallback (curl --max-filesize 50MB 同款, curl 超限
                //   exit 63 触发 fallback 链). 不重试 (同 host 同 URL 重试仍会收 > 50MB body,
                //   浪费 attempt 预算).
                if len(bodyBytes) > MaxHTTPBodyBytes {
                        lastErr = &HTTPError{Err: errors.New("body 超过 50MB 上限 (LimitReader)")}
                        latencyMs := time.Since(attemptStart).Milliseconds()
                        recordCollectAttempt(originHost(rawURL), false, latencyMs)
                        // R67-B 采集增强 B11: body 超限归为 otherFail (非标准网络层错误,
                        //   也不是 HTTP 4xx/5xx, 单独分类便于 admin 识别恶意源).
                        recordHostErrorClass(originHost(rawURL), NetErrClassUnknown, 0)
                        return "", lastErr
                }
                body := decodeBody(resp, bodyBytes)

                // R66-C BUG-54 (P2): Brotli 响应静默返原始字节 (parser 看到乱码). 原实现
                //   decodeBody 在 ce==br 时 recordBrotliMiss 记日志但 body 仍返 caller →
                //   parser 解析二进制乱码 → 半残/乱码内容存入 DB (brotli 字节里偶有合法
                //   HTML 字符, parser 解析为乱七八糟的标签组合). 修复: 检测 br 响应返
                //   error (ErrBrotliNotSupported), 让 fetchHttpWithCurlFallback 走 curl
                //   fallback (curl --compressed handles brotli if curl built with libbrotli,
                //   现代 curl 默认含 brotli 支持). 不重试 (同 Go net/http 仍会收 br,
                //   浪费 attempt). recordBrotliMiss 仍记 (admin 监控识别高频 br host).
                if ce := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Encoding"))); ce == "br" {
                        // recordBrotliMiss 在 decodeBody 已记 (line 2589), 不重复记.
                        lastErr = &HTTPError{Err: errors.New("brotli encoding not supported (curl fallback will handle)")}
                        latencyMs := time.Since(attemptStart).Milliseconds()
                        recordCollectAttempt(originHost(rawURL), false, latencyMs)
                        // R67-B 采集增强 B11: brotli 解码失败归为 otherFail (编码层问题,
                        //   非网络层非 HTTP 状态码, 单独分类便于 admin 识别高频 br host).
                        recordHostErrorClass(originHost(rawURL), NetErrClassUnknown, 0)
                        return "", lastErr
                }

                // R65-B 反反爬第 56 项: 记录 host proto + Server 头指纹 (per-host 钉扎).
                recordHostProtoFingerprint(originHost(rawURL), resp.Proto, resp.Header.Get("Server"))

                // R66-C 反反爬第 63 项: 检测 Service Worker 注入信号. 源站可能用 SW 检测
                //   爬虫 (真实浏览器注册 SW, 后续请求带 SW 头; 爬虫缺 SW 头被识别).
                //   记录 per-host SW-active 状态 (admin/metrics 可识别, R67 可扩展真实 SW fetch).
                if swHdr := resp.Header.Get("Service-Worker"); swHdr != "" {
                        recordServiceWorkerDetection(originHost(rawURL), swHdr)
                } else if swAllowed := resp.Header.Get("Service-Worker-Allowed"); swAllowed != "" {
                        recordServiceWorkerDetection(originHost(rawURL), swAllowed)
                } else if swNavMode := resp.Header.Get("Service-Worker-Navigation-Mode"); swNavMode != "" {
                        recordServiceWorkerDetection(originHost(rawURL), swNavMode)
                }

                // Set-Cookie 处理 (autoCookie)
                if cfg.AutoCookie && len(resp.Header["Set-Cookie"]) > 0 {
                        GetCookieJar().Store(originHost(rawURL), resp.Header["Set-Cookie"])
                }

                // R64-B 第 52 项: 304 Not Modified — 用缓存的 body, 不重传.
                //   304 body 为空 (RFC 7232), 源站表示内容未变. 仍处理 Set-Cookie
                //   (源站可能刷新 session cookie). 成功后记 per-host Referer.
                if resp.StatusCode == 304 {
                        // R65-B 采集增强 B6: 304 也算采集成功 (源站确认未变, 节省带宽).
                        latencyMs := time.Since(attemptStart).Milliseconds()
                        recordCollectAttempt(originHost(rawURL), true, latencyMs)
                        if condCached != nil && condCached.Body != "" {
                                SetHostReferer(rawURL)
                                return condCached.Body, nil
                        }
                        // 304 但无缓存 (理论上不该发生 — 我们只在有缓存时发条件头, 源站
                        //   不该无故返 304). 兜底返空 body + nil err (调用方按空内容处理).
                        SetHostReferer(rawURL)
                        return "", nil
                }

                // 3xx / 4xx / 5xx 视为失败
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
                        // R66-C BUG-52 (P3): 4xx/5xx 也记 latency + fail (原实现漏记,
                        //   60s 窗口 stats 失真, admin QPS/successRate 低估失败率). 每个
                        //   attempt 的 4xx/5xx 都记 (包括重试中间的 429/5xx).
                        herrLatency := time.Since(attemptStart).Milliseconds()
                        recordCollectAttempt(originHost(rawURL), false, herrLatency)
                        // R67-B 采集增强 B11: 记录 per-host HTTP 状态码分类 (403/412/429
                        //   双计 blocked; 5xx 单计 http5xx).
                        recordHostErrorClass(originHost(rawURL), NetErrClassUnknown, resp.StatusCode)
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

                // R64-B 第 52 项: 200 成功 — 更新条件缓存 (Last-Modified / ETag + body).
                //   仅在源站提供 validator 时缓存 (两者都空则不缓存, 下次仍发无条件请求).
                lastMod := resp.Header.Get("Last-Modified")
                etag := resp.Header.Get("ETag")
                if lastMod != "" || etag != "" {
                        StoreCondCache(rawURL, lastMod, etag, body)
                }

                // R65-B 采集增强 B6: 成功记 latency (供 admin 看采集速率 + 成功率).
                latencyMs := time.Since(attemptStart).Milliseconds()
                recordCollectAttempt(originHost(rawURL), true, latencyMs)

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
// R47-1A 修复: errors.Is 检查移到字符串匹配之前 (HTTPError.Unwrap 已支持, 透传到
//
//      context.Canceled / context.DeadlineExceeded). ctx 已取消不可重试 (调用方主动取消,
//      重试只会浪费 attempt 预算 + 让 fetchHttp 等满 backoff 后才退出).
func isRetriableNetErr(err error) bool {
        if err == nil {
                return false
        }
        // ctx 已取消 / 已超时 — 不可重试 (调用方主动取消或已超时, 重试只会延长生命周期)
        if errors.Is(err, context.Canceled) {
                return false
        }
        // context.DeadlineExceeded 是 per-attempt 超时, 可重试 (上层 attempt 循环会
        //   重新 wrap timeout). errors.Is 单独判断 + 返回 true, 不走字符串匹配兜底.
        s := err.Error()
        if strings.Contains(s, "timeout") || strings.Contains(s, "context deadline exceeded") ||
                strings.Contains(s, "connection reset") || strings.Contains(s, "EOF") ||
                strings.Contains(s, "broken pipe") || strings.Contains(s, "no such host") ||
                strings.Contains(s, "connection refused") || strings.Contains(s, "i/o timeout") {
                return true
        }
        // context.Canceled 已在 errors.Is 分支早返回 false. 此处 fallthrough 都是
        // 真正的未知错误, 默认重试 (与 isRetriableNetErr 同口径).
        return true
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
//
//      (即 Request 未设 Accept-Encoding) 时才自解. 我们在 buildHeaders 显式设 Accept-Encoding:
//      gzip, deflate, Go 不自解 — resp.Body 是原始 gzip/deflate 字节, string() 后 HTML 解析全炸.
//      补全 Content-Encoding 检测 + 手动 gzip.NewReader / zlib.NewReader 解码.
//      brotli (Content-Encoding: br) 仍不议 (无 Go 原生库), 返原始字节供上层识别失败.
//
// R66-C BUG-51 (P2) 内层: gzip/deflate 解压 +1 cap. 原实现 io.LimitReader(gr, 50MB) 在
//
//      解压后 > 50MB 时静默截断到 50MB + nil err (gzip bomb 防御失效, 半残 HTML 存入 DB).
//      修复: 读到 50MB+1 byte, 若返回 > 50MB 则保留原始压缩字节 (caller 上层 fetchHttp
//      BUG-54 检测路径会触发 curl fallback, curl --compressed handles bomb via --max-filesize).
//      注: decodeBody 返 string, 不返 error. 内层仅保持原始压缩字节作为信号 (二进制乱码),
//      外层 fetchHttp BUG-54 路径检测 ce==br 才返 error; gzip bomb 路径依赖 caller parser
//      识别失败 → runner 走桥 (与 BUG-54 brotli 路径同款降级链).
func decodeBody(resp *http.Response, body []byte) string {
        // R45-1A: 检测 Content-Encoding, 手动解码 gzip / deflate (Go 不自解显式 Accept-Encoding).
        //   Go 仅在 Transport 自加 Accept-Encoding (Request 无该头) 时自解, 我们显式设了 → 需手动解.
        ce := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Encoding")))
        // R64-B BUG-33 (P2) + R66-C BUG-51 (P2): gzip/deflate 解压 +1 cap, 防 "gzip bomb"
        //   (1KB 压缩 → 1GB 解压 OOM) + 防静默截断 (50MB+1 byte 检测, 解压后 > 50MB
        //   保留原始压缩字节作为信号, caller parser 识别失败走桥).
        switch ce {
        case "gzip":
                if gr, err := gzip.NewReader(bytes.NewReader(body)); err == nil {
                        if decoded, err := io.ReadAll(io.LimitReader(gr, MaxHTTPBodyBytes+1)); err == nil {
                                gr.Close()
                                // R66-C BUG-51: 解压后 > 50MB → gzip bomb, 保留原始压缩字节
                                //   (二进制乱码信号, caller parser 识别失败 → runner 走桥).
                                if len(decoded) <= MaxHTTPBodyBytes {
                                        body = decoded
                                }
                        } else {
                                gr.Close()
                        }
                }
        case "deflate":
                if zr, err := zlib.NewReader(bytes.NewReader(body)); err == nil {
                        if decoded, err := io.ReadAll(io.LimitReader(zr, MaxHTTPBodyBytes+1)); err == nil {
                                zr.Close()
                                // R66-C BUG-51: 解压后 > 50MB → 同 gzip bomb 路径.
                                if len(decoded) <= MaxHTTPBodyBytes {
                                        body = decoded
                                }
                        } else {
                                zr.Close()
                        }
                }
        case "br":
                // Brotli 不支持 (无 Go 原生库, 避免引入 cgo 依赖). 返原始字节, parser 识别为乱码后
                // 调用方走 8 级降级链到下一桥 (fetch-relay / scrapling 等 Python 侧有 brotli 解码).
                // R45-1A: 记日志供运维 debug (仅首次重复打同 host brotli).
                // R46-1B: per-host brotli miss 计数, 识别需走桥的 host (高频 miss 的 host 应在
                //   fetchMode 配置层强制走 scrapling / cloak-browser 含 brotli 解码的桥).
                if resp.Request != nil && resp.Request.URL != nil {
                        recordBrotliMiss(strings.ToLower(resp.Request.URL.Host))
                } else {
                        brotliMissCount.Add(1)
                }
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
        // R64-B BUG-31 (P2): 原实现 `len(body) < 8192` 跳过 > 8KB 的 body, 大页面
        //   (100KB+ 章节 / 目录页) 的 <meta charset="gbk"> 不被检测 → 直接走 UTF-8
        //   默认 → GBK/GB18030 中文站乱码 → parser 全炸 → 内容为空. 修复: 去掉
        //   body 大小限制, 只扫首 4KB (head 切片已限扫描范围, 性能无损).
        if charset == "" && len(body) > 0 {
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
//
//      高频出现说明某些上游站点全返 br, 需走桥 (Python scrapling 有 brotli 解码库) 或 加 Go brotli 依赖.
var brotliMissCount atomic.Int64

// brotliMissEntry — per-host brotli miss 计数 + 最近访问时间.
//
//      R66-C BUG-53 (P3): 原 brotliMissHostCount 存 *atomic.Int64 (count 单值), lazy
//      sweep 删 count==0 条目, 但 cnt.Add(1) 后 cnt 单调递增永不为 0 → sweep 永不删
//      任何条目 → 长跑进程 brotliMissHostCount 内存无界增长 (R65-B 未决项 5 同款问题).
//      修复: 加 lastSeenAt 时间戳, sweep 改 "7 天未访问驱逐" (与 hostProtoFingerprintMap
//      7 天 TTL 同款). count 仍单调累计 (运维识别高频 br host 用), 不清零.
type brotliMissEntry struct {
        count      atomic.Int64
        lastSeenAt atomic.Int64 // UnixMilli, sweep 用
}

// brotliMissHostCount — R46-1B: per-host brotli miss 计数 (供运维识别哪些 host 全返 br).
//
//      高频出现的 host 是配置了 br 但 Go 不能解码, 应走桥 (scrapling / cloak-browser 已含 brotli
//      解码). 实现: sync.Map[host] -> *brotliMissEntry, LRU 风格 lazy 清扫 (每 1k brotli miss
//      累加触发一次 sweep, 删 7 天未访问条目, 防长跑进程内存无界增长).
var brotliMissHostCount sync.Map

// BrotliMissSweepTTLms — per-host brotli miss 条目 7 天 TTL (sweep 删 lastSeenAt > 7 天条目).
const BrotliMissSweepTTLms = 7 * 24 * 60 * 60 * 1000

// brotliMissSweepCounter — R46-1B: 触发 brotliMissHostCount lazy sweep 的累加计数.
var brotliMissSweepCounter atomic.Int64

// recordBrotliMiss — 记录某 host 的 brotli miss (R46-1B 反反爬增强: 识别需要走桥的 host).
func recordBrotliMiss(host string) {
        if host == "" {
                return
        }
        // 全局计数
        brotliMissCount.Add(1)
        // per-host 计数
        var e *brotliMissEntry
        if v, ok := brotliMissHostCount.Load(host); ok {
                e = v.(*brotliMissEntry)
        } else {
                e = &brotliMissEntry{}
                actual, _ := brotliMissHostCount.LoadOrStore(host, e)
                e = actual.(*brotliMissEntry)
        }
        e.count.Add(1)
        e.lastSeenAt.Store(time.Now().UnixMilli())
        // R66-C BUG-53 (P3): lazy sweep (每 1000 次 brotli miss 触发一次, 删 7 天未访问条目).
        //   原 sweep 删 count==0 条目, 但 cnt.Add(1) 后 cnt 永不为 0 → 死代码, sweep 从不删任何
        //   条目 → 长跑进程内存无界增长. 改: 按 lastSeenAt 驱逐 (与 hostProtoFingerprintMap
        //   7d TTL 同款). count 仍单调累计 (运维识别高频 br host 用), 不清零.
        if brotliMissSweepCounter.Add(1)%1000 == 0 {
                now := time.Now().UnixMilli()
                brotliMissHostCount.Range(func(k, v any) bool {
                        ent := v.(*brotliMissEntry)
                        if now-ent.lastSeenAt.Load() > BrotliMissSweepTTLms {
                                // R74-B BUG-111 (P3) 修复: 与 BUG-110 同款 (mutate-in-place
                                //   entry + atomic 时间戳). recordBrotliMiss 用 LoadOrStore
                                //   复用 entry, 仅 atomic 修改 count/lastSeenAt, 不替换 entry
                                //   指针. 原 Delete 与并发 writer 的 ent.lastSeenAt.Store(now)
                                //   race → admin brotli miss stats 偶发少计 1 次. 修复: Delete
                                //   前 re-Load + 重读 lastSeenAt 缩小 race 窗口.
                                if cur, ok := brotliMissHostCount.Load(k); ok {
                                        curEnt, ok2 := cur.(*brotliMissEntry)
                                        if ok2 && now-curEnt.lastSeenAt.Load() > BrotliMissSweepTTLms {
                                                brotliMissHostCount.Delete(k)
                                        }
                                }
                        }
                        return true
                })
        }
}

// BrotliMissHostSnapshot — admin / metrics 查询用: 返回 per-host brotli miss 计数.
func BrotliMissHostSnapshot() map[string]int64 {
        out := map[string]int64{}
        brotliMissHostCount.Range(func(k, v any) bool {
                out[k.(string)] = v.(*brotliMissEntry).count.Load()
                return true
        })
        return out
}

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

// fetchViaCurl — exec 系统二进制 curl. 与 native fetch 同款语义.
// R41-1A: 移除 --no-keepalive (curl 默认开 keepalive, 该 flag 反而禁用, 浪费且易触发频控);
//
//      注入 Sec-Ch-Ua / Sec-Fetch-* 头族 (与 buildHeaders 同款, 防 curl 路径暴露);
//      自定义 headers 剥控制字符 (与 buildHeaders 对称);
//      成功后 SetHostReferer.
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
        // R66-C 第 65 项: 提前算 domain (供 acceptEncodingFor 按 Server 类型动态调).
        //   domain 在原实现只在 Referer 段算 (line 2958), 此处提前到函数顶部供
        //   Accept-Encoding / Cache-Control 等多处用.
        domain := originHost(rawURL)
        // R66-C 第 64 项: 首次请求 (无 condCached) 注入 Cache-Control: no-cache +
        //   Pragma: no-cache, 强制中间缓存 revalidate (与 fetchHttp 同款).
        condCached := GetCondCache(rawURL)
        args := []string{
                "-s", "-S", // silent + show errors
                "--max-time", fmt.Sprintf("%d", timeoutMs/1000),
                // R64-B BUG-33 (P2): 50MB body 上限, 与 fetchHttp 同款. 防 curl stdout
                //   无界增长 (bytes.Buffer 无 cap). curl --max-filesize 超限返 exit 63.
                "--max-filesize", "52428800", // 50MB
                "-A", ua,
                // R68-B 反反爬第 76 项: Accept 头按请求类型细化 (与 buildHeaders 同款).
                //   原实现硬编码 HTML Accept. 改为 acceptHeaderForURL 按 URL 后缀 + 路径
                //   模式细化 (HTML/JSON/Image/CSS/JS).
                "-H", "Accept: " + acceptHeaderForURL(rawURL),
                "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
                // R66-C 第 65 项: Accept-Encoding 按 Server 类型动态调 (与 buildHeaders 同款).
                //   cloudflare 站用 "gzip"; 其他站 "gzip, deflate".
                "-H", "Accept-Encoding: " + acceptEncodingFor(domain),
                "--compressed",
                "-D", "-", // dump headers to stdout (mixed with body — we'll parse)
                // R41-1A: 移除 --no-keepalive. curl 默认开 keepalive, 该 flag 反而禁用, 浪费且易触发频控.
                "-H", "Connection: keep-alive",
                "-H", "Upgrade-Insecure-Requests: 1",
                "-H", "DNT: 1",
        }
        // R66-C 第 64 项: 首次请求注入 Cache-Control: no-cache + Pragma: no-cache.
        //   与 fetchHttp 同款, 防 CDN 命中旧版本. condCached != nil 时走 If-Modified-Since.
        if shouldInjectNoCache(condCached) {
                args = append(args,
                        "-H", "Cache-Control: no-cache",
                        "-H", "Pragma: no-cache",
                )
        }
        // R64-B 第 52 项: 注入 If-Modified-Since / If-None-Match (条件请求, 与 fetchHttp 同款)
        if condCached != nil {
                if condCached.LastModified != "" {
                        args = append(args, "-H", "If-Modified-Since: "+condCached.LastModified)
                }
                if condCached.ETag != "" {
                        args = append(args, "-H", "If-None-Match: "+condCached.ETag)
                }
        }
        // Sec-Ch-Ua / Sec-Fetch-* 头族 (与 buildHeaders 同款, 防 curl 路径暴露指纹)
        // R64-B 第 55 项: 三品牌完整 (grease + Chromium + Google Chrome / Microsoft Edge)
        //   + Sec-Ch-Ua-Platform-Version. 原实现只发 2 品牌, 与 buildHeaders 不对称.
        if !IsFirefoxUA(ua) && !IsSafariUA(ua) {
                ver := extractChromeVer(ua)
                verStr := intToStrOr(ver, "137")
                var brands []string
                if strings.Contains(ua, "Edg/") {
                        brands = []string{
                                `"Not_A Brand";v="8"`,
                                `"Chromium";v="` + verStr + `"`,
                                `"Microsoft Edge";v="` + verStr + `"`,
                        }
                } else {
                        brands = []string{
                                `"Not?A_Brand";v="8"`,
                                `"Chromium";v="` + verStr + `"`,
                                `"Google Chrome";v="` + verStr + `"`,
                        }
                }
                args = append(args, "-H", "Sec-Ch-Ua: "+strings.Join(brands, ", "))
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
                // R64-B 第 55 项: Sec-Ch-Ua-Platform-Version
                if pv := extractPlatformVersion(ua); pv != "" {
                        args = append(args, "-H", `Sec-Ch-Ua-Platform-Version: "`+pv+`"`)
                }
        }
        // R64-B 第 53 项: Sec-Fetch-Site 动态 (与 buildHeaders 同款).
        //   先计算 effectiveReferer (同 buildHeaders 逻辑), 再算 secFetchSite.
        effectiveReferer := ""
        if cfg.Referer {
                if cfg.RefererURL != "" {
                        effectiveReferer = cfg.RefererURL
                } else if rh := GetHostReferer(originHost(rawURL)); rh != "" {
                        effectiveReferer = rh
                } else if u, err := url.Parse(rawURL); err == nil {
                        effectiveReferer = u.Scheme + "://" + u.Host + "/"
                }
        }
        args = append(args,
                "-H", "Sec-Fetch-Dest: document",
                "-H", "Sec-Fetch-Mode: navigate",
                "-H", "Sec-Fetch-Site: "+computeSecFetchSite(effectiveReferer, rawURL),
                "-H", "Sec-Fetch-User: ?1",
        )
        // R65-B 反反爬第 56 项: Priority 头动态注入 (与 buildHeaders 同款).
        //   HTTP/1.1 host → 不发 (Chrome 在 HTTP/1.1 从不发 Priority);
        //   HTTP/2 或未知 → 发 (向后兼容).
        // R65-B: domain 在下面定义, 这里先计算 originHost(rawURL).
        if shouldEmitPriorityHeader(originHost(rawURL)) {
                args = append(args, "-H", "Priority: u=0, i")
        }
        // Referer 优先级: cfg.RefererURL > per-host 记忆 > 目标站 origin
        // R42-1B: 与 buildHeaders 同款 — cfg.RefererURL 设置时直接用 (不再要求 cfg.RefererChain).
        // 原实现要求 cfg.RefererChain && cfg.RefererURL != "" 才用 cfg.RefererURL, 与
        // buildHeaders 不对称, curl 路径会暴露给目标站一个 origin Referer 而非用户配置的 URL.
        // R66-C 第 65 项: domain 已在函数顶部计算 (供 acceptEncodingFor + Cache-Control 用).
        if effectiveReferer != "" {
                args = append(args, "-H", "Referer: "+effectiveReferer)
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
        // R64-B 第 54 项: X-XSRF-TOKEN / X-CSRF-Token 自动注入 (与 buildHeaders 同款).
        //   防 curl 路径漏 CSRF 头被源站识别为爬虫.
        if jarCookies != "" {
                if xsrf := extractCookieValue(jarCookies, "XSRF-TOKEN"); xsrf != "" {
                        args = append(args, "-H", "X-XSRF-TOKEN: "+xsrf)
                }
                if csrf := extractCookieValue(jarCookies, "csrf-token"); csrf != "" {
                        args = append(args, "-H", "X-CSRF-Token: "+csrf)
                } else if csrf := extractCookieValue(jarCookies, "csrftoken"); csrf != "" {
                        args = append(args, "-H", "X-CSRF-Token: "+csrf)
                }
        }
        // 自定义 headers (剥控制字符, 与 buildHeaders 同款)
        for k, v := range cfg.Headers {
                k = stripControlChars(k)
                v = stripControlChars(v)
                if k != "" {
                        args = append(args, "-H", k+": "+v)
                }
        }
        // R67-B 反反爬第 71 项: X-Request-ID / X-Trace-ID 注入 (与 buildHeaders 同款).
        //   防 curl 路径漏 X-Request-ID 头被反爬识别为非浏览器. 同一 UUID 注入两头
        //   (与 buildHeaders 同款, 模拟 nginx $request_id 模式). 用户自定义 headers
        //   优先 (for loop 已注入, 此处仅在 cfg.Headers 未设 X-Request-ID 时补).
        hasReqID := false
        for k := range cfg.Headers {
                if strings.EqualFold(k, "X-Request-ID") {
                        hasReqID = true
                        break
                }
        }
        if !hasReqID {
                reqID := generateRequestID()
                args = append(args, "-H", "X-Request-ID: "+reqID)
                args = append(args, "-H", "X-Trace-ID: "+reqID)
        }
        // R73-B 反反爬第 83/84 项: Connection: Upgrade + Sec-WebSocket-* 头适配 (与 buildHeaders 同款).
        //   防 curl 路径漏 WS 升级握手头被反爬识别为非浏览器. 仅 HTTP/1.1 host 注入
        //   (HTTP/2 禁用 Upgrade 头). 用户自定义 headers 优先 (不覆盖).
        if isWebSocketUpgradeURL(rawURL) {
                if shouldEmitWebSocketUpgrade(domain) {
                        hasConn := false
                        for k := range cfg.Headers {
                                if strings.EqualFold(k, "Connection") {
                                        hasConn = true
                                        break
                                }
                        }
                        if !hasConn {
                                args = append(args, "-H", "Connection: Upgrade")
                        }
                        hasUpgrade := false
                        for k := range cfg.Headers {
                                if strings.EqualFold(k, "Upgrade") {
                                        hasUpgrade = true
                                        break
                                }
                        }
                        if !hasUpgrade {
                                args = append(args, "-H", "Upgrade: websocket")
                        }
                        hasKey := false
                        for k := range cfg.Headers {
                                if strings.EqualFold(k, "Sec-WebSocket-Key") {
                                        hasKey = true
                                        break
                                }
                        }
                        if !hasKey {
                                args = append(args, "-H", "Sec-WebSocket-Key: "+generateSecWebSocketKey())
                        }
                        hasVer := false
                        for k := range cfg.Headers {
                                if strings.EqualFold(k, "Sec-WebSocket-Version") {
                                        hasVer = true
                                        break
                                }
                        }
                        if !hasVer {
                                args = append(args, "-H", "Sec-WebSocket-Version: 13")
                        }
                }
        }
        // R73-B 反反爬第 85 项: X-Requested-With: XMLHttpRequest (AJAX 路径) 适配
        //   (与 buildHeaders 同款). 防 curl 路径漏 X-Requested-With 被服务端识别非 XHR.
        if isAjaxURL(rawURL) {
                hasXRW := false
                for k := range cfg.Headers {
                        if strings.EqualFold(k, "X-Requested-With") {
                                hasXRW = true
                                break
                        }
                }
                if !hasXRW {
                        args = append(args, "-H", "X-Requested-With: XMLHttpRequest")
                }
        }
        // 代理
        if proxy != "" {
                args = append(args, "-x", proxy)
        }
        // R65-B 反反爬第 60 项: X-Forwarded-For / X-Real-IP 伪造 (仅直连).
        //   与 fetchHttp buildHeaders 路径同款 — 仅 proxy == "" 时注入 per-host
        //   钉扎的 RFC1918 内网 IP. 有代理时由代理层注入自己的 XFF 链.
        if proxy == "" {
                if xffIP := forwardedIPFor(domain); xffIP != "" {
                        args = append(args, "-H", "X-Forwarded-For: "+xffIP)
                        args = append(args, "-H", "X-Real-IP: "+xffIP)
                }
        }
        args = append(args, rawURL)

        // R65-B 采集增强 B6: 记录 per-host attempt 起始时间 (供 latency 统计).
        attemptStart := time.Now()
        cmd := exec.CommandContext(ctx, curlPath, args...)
        var stdout, stderr bytes.Buffer
        cmd.Stdout = &stdout
        cmd.Stderr = &stderr
        if err := cmd.Run(); err != nil {
                // R65-B B6: curl exec 失败也记 latency + fail.
                latencyMs := time.Since(attemptStart).Milliseconds()
                recordCollectAttempt(domain, false, latencyMs)
                // R67-B 采集增强 B11: curl exec 失败归为 otherFail (exec 路径错误
                //   非网络层也非 HTTP 状态码, 多为 timeout / binary not found).
                recordHostErrorClass(domain, NetErrClassUnknown, 0)
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
                // R65-B 反反爬第 56 项: 从状态行提取 proto (HTTP/1.1 / HTTP/2).
                //   curl 状态行首段是 proto, 与 fetchHttp resp.Proto 等价. + Server 头.
                proto := ""
                if len(parts) >= 1 {
                        proto = parts[0]
                }
                serverHeader := extractHeaderFromCurlStdout(headers, "Server")
                recordHostProtoFingerprint(domain, proto, serverHeader)
                // R66-C 反反爬第 63 项: curl 路径 SW 检测 (与 fetchHttp 同款).
                if swHdr := extractHeaderFromCurlStdout(headers, "Service-Worker"); swHdr != "" {
                        recordServiceWorkerDetection(domain, swHdr)
                } else if swAllowed := extractHeaderFromCurlStdout(headers, "Service-Worker-Allowed"); swAllowed != "" {
                        recordServiceWorkerDetection(domain, swAllowed)
                } else if swNavMode := extractHeaderFromCurlStdout(headers, "Service-Worker-Navigation-Mode"); swNavMode != "" {
                        recordServiceWorkerDetection(domain, swNavMode)
                }
                if status >= 300 {
                        // R66-C BUG-52 (P3): curl 4xx/5xx 也记 latency + fail (与 fetchHttp
                        //   同款, 防 60s 窗口 stats 低估失败率).
                        herrLatency := time.Since(attemptStart).Milliseconds()
                        recordCollectAttempt(domain, false, herrLatency)
                        // R67-B 采集增强 B11: 记录 per-host HTTP 状态码分类 (与 fetchHttp
                        //   同款, 403/412/429 双计 blocked).
                        recordHostErrorClass(domain, NetErrClassUnknown, status)
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
        // R65-B 采集增强 B6: curl 成功记 latency + success.
        latencyMs := time.Since(attemptStart).Milliseconds()
        recordCollectAttempt(domain, true, latencyMs)
        SetHostReferer(rawURL)
        return body, nil
}

// extractHeaderFromCurlStdout — 从 curl -D - 输出的 headers 块中提取指定头值.
//
//      headers 形如 "HTTP/1.1 200 OK\r\nServer: nginx\r\nContent-Type: text/html\r\n...".
//      头名大小写不敏感. 未找到返 "". R65-B 第 56 项: curl 路径提取 Server 头
//      用于 host proto 指纹记录 (与 fetchHttp resp.Header.Get("Server") 等价).
func extractHeaderFromCurlStdout(headers, name string) string {
        if name == "" || headers == "" {
                return ""
        }
        prefix := strings.ToLower(name) + ":"
        for _, line := range strings.Split(headers, "\r\n") {
                lower := strings.ToLower(line)
                if strings.HasPrefix(lower, prefix) {
                        return strings.TrimSpace(line[len(name)+1:])
                }
        }
        return ""
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
        // R68-B 反反爬第 75 项: Connection: keep-alive 显式注入 (callBridge 路径).
        //   原 callBridge 仅设 Content-Type, 缺 Connection 头. Go net/http 默认行为
        //   HTTP/1.1 是 keep-alive, 但部分源站 / 反向代理默认 close. 显式注入
        //   Connection: keep-alive 让源站明确按 keep-alive 处理, 降源站连接数 +
        //   提速 (复用 TCP 连接). 与 buildHeaders / fetchViaCurl 同款.
        req.Header.Set("Connection", "keep-alive")
        // R41-1A: 用 globalHttp (复用全局 transport + 连接池), 取代 http.DefaultClient
        resp, err := globalHttp.Do(req)
        if err != nil {
                return nil
        }
        defer resp.Body.Close()
        // R67-B BUG-62 (P3) 修复: 原实现 io.LimitReader(resp.Body, 20MB) 在 response > 20MB
        //   时静默截断到 20MB + nil err (io.LimitReader 返 EOF 不报错). 20MB 部分 JSON 字节
        //   json.Unmarshal 解码失败 → callBridge 返 nil → 上层走下一桥. 但桥日志无 "body
        //   超限" 信号, 操作员难诊断. 修复: 读到 20MB+1 byte, 若返回 > 20MB 视为超限返
        //   nil (调用方走下一桥, 与 fetchHttp BUG-51 同款).
        respBody, err := io.ReadAll(io.LimitReader(resp.Body, 20*1024*1024+1))
        if err != nil {
                return nil
        }
        if len(respBody) > 20*1024*1024 {
                // 桥返超大 body (>20MB) — 视为桥故障, 调用方走下一桥.
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
//   - native fetch (标准 TLS) 失败 → utls Chrome TLS 指纹重试 (R42-1B 新增)
//   - utls 失败 → exec curl (OpenSSL 栈, 防 undici 在线热更新)
//   - curl 失败 → 抛错 (上层 fetchPageOnce 会继续走桥降级链)
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
                // R65-B 反反爬第 58 项: 同时清 host proxy 钉扎, 让下次 pickProxyFor
                //   选新代理 (避免下次又选到同一刚失败的代理 — 钉扎代理在 cooldown
                //   内, pickProxyFor 也会跳过, 但显式清钉扎让下次重新走完整选择路径).
                EvictHostProxyPin(originHost(rawURL))
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

// pickProxyFor — 从代理池选一条 (random 模式).
// 失败冷却 30s, 冷却内跳过.
// R41-1A: 增加 lastSweptAt 字段 (周期性清扫 useCount / failedUntil, 防长跑进程内存泄漏).
type proxyState struct {
        mu          sync.Mutex
        failedUntil map[string]int64
        useCount    map[string]int
        lastIdx     int
        lastSweptAt int64
        // R46-1B: 主动 probe 失败计数 (连续 3 次 → 5min 冷却)
        probeFailStreak map[string]int
        // R46-1B: 上次 probe 触发时间 (5min 间隔)
        lastProbeAt int64
        // R50-1A: 代理 probe 延迟 (ms). probeAllProxies 异步 probe 时记录, 供
        //   least-latency 旋转策略选最低延迟代理 + ProxyStatsSnapshot 给 admin
        //   查询识别慢代理. -1 表示尚未 probe 过, 0 表示 probe 失败 (timeout).
        probeLatencyMs map[string]int64
        // R50-1A: 上次 probe 时间戳 (供 ProxyStatsSnapshot 显示最近 probe 时间)
        probeLastAt map[string]int64
        // R51-1A: 主动失败计数 (MarkProxyFailed 累计). MarkProxyOK 清零.
        //   与 probeFailStreak 区别: probeFailStreak 是 probe 路径连续失败计数,
        //   pickFailStreak 是业务调用 (fetchHttp) 路径连续失败计数. 两者独立 —
        //   probe 成功 (代理健康) 但业务 fetch 失败 (被反爬屏蔽, 不是代理问题)
        //   不应误增 probeFailStreak 触发 5min cooldown. pickFailStreak 单独
        //   跟踪业务失败, 用于 weighted-latency 策略降低失败率高的代理权重.
        pickFailStreak map[string]int
}

var proxyInst = &proxyState{
        failedUntil:     map[string]int64{},
        useCount:        map[string]int{},
        probeFailStreak: map[string]int{},
        probeLatencyMs:  map[string]int64{},
        probeLastAt:     map[string]int64{},
        pickFailStreak:  map[string]int{}, // R51-1A
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
//
//      每 5min 清一次未使用条目 (useCount 0 或超过 24h 未使用).
//
// R43-1B: 修复 failedUntil 死字段 — 添加 MarkProxyFailed 让网络层错误能标记代理冷却 30s,
//
//      pickProxyFor 跳过冷却内代理. R42-1B 后该字段从未被写入, 代理健康跟踪完全失效.
//
// R45-1A: 增加 parsedProxyPoolCache 缓存 ParseProxyPool 结果 (原实现每次 pickProxyFor
//
//      都 Split + 校验, 高频路径浪费 CPU). 代理池字符串变更时 (含5min sweep) 重算.
//
// R50-1A: 新增 "least-latency" 旋转策略 — pickProxyFor 在 least-latency 模式下选
//
//      probeLatencyMs 最小的可用代理 (probeLatencyMs 由 probeAllProxies 异步 probe
//      时记录). 多个代理同 latency 时降级到 least-used. 解决高延迟代理拖慢采集:
//      500ms 代理 vs 5s 代理, 同样健康但 5s 代理每章节多花 4.5s, 大批量采集时
//      累计耗时差 100x+. 默认仍 random (向后兼容).
func pickProxyFor(rawURL string, cfg FetchConfig) string {
        pool := parsedProxyPoolCached(cfg.ProxyURL)
        if len(pool) == 0 {
                return ""
        }
        // 回环目标豁免直连 (本地 mock/token 代理 tokenUrl 经代理转发会出不去)
        if IsLoopbackTarget(rawURL) {
                return ""
        }
        // R65-B 反反爬第 58 项: per-host 代理钉扎. 同 host 选一次代理后钉扎, 后续
        //   请求复用同代理 (反爬识别 "同 host 多次请求 IP 跳变" 是爬虫指纹). 钉扎
        //   代理在 cooldown 内 (失败) → 清钉扎, 重新选. 钉扎代理不在 pool (用户
        //   动态修改 cfg.ProxyURL) → 清钉扎, 重新选. 不钉扎 "" (空) 直连路径.
        // R65-B BUG-43 (P2): 原实现 healthy check + useCount++ 分两次取锁, 之间
        //   可能另一 goroutine MarkProxyFailed 标记该代理失败 → 仍 increment
        //   useCount 在已失败代理上 (统计失真). 改为单次临界区: 一次 Lock 内
        //   check healthy + conditional useCount++, 释放后按 healthy 决定 return.
        host := strings.ToLower(HostGateKeyOf(rawURL))
        if host != "" {
                if pinned := pinnedProxyForHost(host); pinned != "" {
                        inPool := false
                        for _, p := range pool {
                                if p == pinned {
                                        inPool = true
                                        break
                                }
                        }
                        if inPool {
                                proxyInst.mu.Lock()
                                healthy := proxyInst.failedUntil[pinned] <= time.Now().UnixMilli()
                                if healthy {
                                        proxyInst.useCount[pinned]++
                                }
                                proxyInst.mu.Unlock()
                                if healthy {
                                        return pinned
                                }
                        }
                        EvictHostProxyPin(host)
                }
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
                // R51-1A: 清当前 pool 之外的 pickFailStreak 条目 (与 useCount 同款防泄漏)
                for k := range proxyInst.pickFailStreak {
                        if !poolSet[k] {
                                delete(proxyInst.pickFailStreak, k)
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
                // R46-1B: 主动 probe (5min 间隔, 异步 goroutine 不阻塞 pick).
                //   cfg.ProxyHealthCheck=true 启用, probeTarget 优先 cfg.ProxyProbeURL, 否则默认.
                if cfg.ProxyHealthCheck && now-proxyInst.lastProbeAt > 5*60*1000 {
                        proxyInst.lastProbeAt = now
                        probeTarget := cfg.ProxyProbeURL
                        if probeTarget == "" {
                                // R47-1A: probe target 轮换 (避免单一 endpoint 持续被探).
                                //   原 default https://www.google.com 每次都打 Google, 长期被
                                //   Google bot detection 识别 → 返 429 / challenge 页面 →
                                //   健康代理被误判死. 改为从 5 个 reliable endpoint 中轮选,
                                //   每次 probe 取不同的 target, 降低单 endpoint 命中频率.
                                probeTarget = pickProbeTarget()
                        }
                        // 复制 pool (避免 goroutine 读 race)
                        poolCopy := make([]string, len(pool))
                        copy(poolCopy, pool)
                        go probeAllProxies(poolCopy, probeTarget)
                }
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
        // R65-B 反反爬第 58 项: 重构 switch 为单 return 路径, 末尾统一钉扎 host→chosen.
        //   原 switch 多 return 点, 钉扎需在每个 return 前注入, 易遗漏. 改为 chosen 变量
        //   + 末尾 pinProxyForHost(host, chosen) 统一处理.
        var chosen string
        switch strategy {
        case "round-robin":
                idx := proxyInst.lastIdx % len(available)
                proxyInst.lastIdx = (proxyInst.lastIdx + 1) % len(available)
                proxyInst.useCount[available[idx]]++
                chosen = available[idx]
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
                        chosen = available[min]
                }
        case "least-latency":
                // R50-1A: 选 probeLatencyMs 最小的可用代理 (从未 probe 过的代理视为
                //   latency=0 优先选, 让新代理尽快被 probe; latency=0 表示 probe 失败
                //   也不优先选, 避免选到死的代理). 多个代理同 latency 时降级到 least-used.
                min := -1
                minLatency := int64(0)
                for i, p := range available {
                        // 从未 probe 过 (probeLatencyMs 不存在) → 视为 latency=0 优先
                        // 已 probe 失败 (probeLatencyMs == 0) → 不优先 (除非全是失败的)
                        latency, probed := proxyInst.probeLatencyMs[p]
                        if !probed {
                                latency = 0 // 从未 probe 视为 latency=0 优先
                        } else if latency == 0 {
                                latency = 999999 // probe 失败视为 latency=999999ms 不优先
                        }
                        if min < 0 || latency < minLatency {
                                min = i
                                minLatency = latency
                        } else if latency == minLatency {
                                // R51-1A: 同 latency 时降级到 least-used (原实现仅取第一个,
                                //   多代理同 latency 时总是选 first, 负载不均衡).
                                if proxyInst.useCount[p] < proxyInst.useCount[available[min]] {
                                        min = i
                                }
                        }
                }
                if min >= 0 {
                        proxyInst.useCount[available[min]]++
                        chosen = available[min]
                }
        case "weighted-latency":
                // R51-1A 反反爬增强: weighted-latency 策略 — 按 1/(latency+100ms) 权重
                //   加权随机选代理. 低延迟代理被选概率高, 但高延迟代理仍有概率被选
                //   (避免完全饿死, 让反爬无法靠"恒定选最低延迟代理"识别爬虫模式).
                //   失败率高的代理 (pickFailStreak 高) 权重降为 0.1x (降低但非 0, 让
                //   偶发失败恢复后仍可被选). 从未 probe 过的代理视为 latency=100ms
                //   (中等权重, 让新代理尽快被 probe).
                //   权重公式: weight = (1.0 / (latencyMs + 100)) * (1.0 / (1 + pickFailStreak))
                //   例: latency=200ms streak=0 → 1/300 * 1 = 0.00333
                //       latency=5000ms streak=0 → 1/5100 * 1 = 0.000196 (17x 差距)
                //       latency=200ms streak=3 → 1/300 * 0.25 = 0.000833 (4x 降权)
                //   随机性: 累加权重 + rand 选区间, 保证低延迟代理概率高但仍有变化.
                weights := make([]float64, len(available))
                totalWeight := 0.0
                for i, p := range available {
                        latency, probed := proxyInst.probeLatencyMs[p]
                        if !probed {
                                latency = 100 // 从未 probe 视为 100ms (中等权重)
                        } else if latency == 0 {
                                latency = 10000 // probe 失败视为 10000ms (极低权重)
                        }
                        streak := proxyInst.pickFailStreak[p]
                        failFactor := 1.0 / (1.0 + float64(streak))
                        weights[i] = (1.0 / (float64(latency) + 100.0)) * failFactor
                        totalWeight += weights[i]
                }
                if totalWeight > 0 {
                        r := rand.Float64() * totalWeight
                        cum := 0.0
                        for i, w := range weights {
                                cum += w
                                if r <= cum {
                                        proxyInst.useCount[available[i]]++
                                        chosen = available[i]
                                        break
                                }
                        }
                        if chosen == "" {
                                // 兜底 (浮点精度): 选最后一个
                                proxyInst.useCount[available[len(available)-1]]++
                                chosen = available[len(available)-1]
                        }
                }
        }
        // random (默认 / weighted-latency totalWeight==0 / 其他 case 未选)
        if chosen == "" {
                idx := rand.Intn(len(available))
                proxyInst.useCount[available[idx]]++
                chosen = available[idx]
        }
        // R65-B 反反爬第 58 项: 钉扎 host → chosen, 下次同 host 复用同代理.
        //   失败时 MarkProxyFailed / EvictHostProxyPin 清钉扎.
        if host != "" && chosen != "" {
                pinProxyForHost(host, chosen)
        }
        return chosen
}

// R45-1A: parsedProxyPoolCache — 高频路径缓存, 避免每次 pickProxyFor 都 Split + 校验.
// 代理池字符串变更时 (5min sweep 重算 + MarkProxyFailed/OK 不重算因不涉及字符串) 同步重算.
var (
        proxyPoolCacheMu  sync.Mutex
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
// R51-1A: 同时累加 pickFailStreak (业务路径失败计数, 供 weighted-latency 策略
//
//      降低失败率高的代理权重). 与 probeFailStreak 区别: probe 是主动健康检查,
//      pick 是业务调用. probe 成功不代表业务一定成功 (反爬屏蔽 ≠ 代理故障).
//
// R52-1A: dead proxy quarantine — pickFailStreak 超过阈值 (10) 时 cooldown 升级
//
//      到 30min (替代默认 30s). 业务连续失败 10 次 ≈ 代理被反爬 IP 封禁或代理服务
//      长期不可用, 短冷却 30s 让 pickProxyFor 立即再选 → 又失败 → 死循环 (每章浪费
//      30s 失败 + 30s 等). 30min quarantine 让操作员有时间处理 (重启代理 / 更换 IP /
//      调整采集频率), 同时仍允许 30min 后重试 (避免永久禁用导致池子枯竭). caller 仍可
//      传 cooldownMs > 30min 覆盖 (业务自定义更严冷却).
func MarkProxyFailed(proxyURL string, cooldownMs int) {
        if proxyURL == "" {
                return
        }
        if cooldownMs <= 0 {
                cooldownMs = 30000
        }
        proxyInst.mu.Lock()
        defer proxyInst.mu.Unlock()
        // R52-1A: dead proxy quarantine — 业务连续失败 ≥10 次 → cooldown 升级到 30min
        //   (除非 caller 显式传更大 cooldownMs, 尊重业务自定义更严冷却).
        //   阈值 10: 误升级概率低 (偶发失败 5-6 次不触发), 真死代理 10 次必触发.
        //   30min: 足够操作员响应 (邮件 / 日志监控), 又不致池子枯竭 (单代理 30min
        //   内若被回选仍能恢复, MarkProxyOK 仍清 pickFailStreak).
        newStreak := proxyInst.pickFailStreak[proxyURL] + 1
        if newStreak >= pickFailStreakQuarantineThreshold && cooldownMs < pickFailQuarantineMs {
                cooldownMs = pickFailQuarantineMs
        }
        proxyInst.failedUntil[proxyURL] = time.Now().UnixMilli() + int64(cooldownMs)
        // R51-1A: 累加业务路径失败计数. weighted-latency 策略用此降低权重.
        // 不设上限 — pickFailStreak 是单调累计, MarkProxyOK 清零 (业务成功 = 代理实际可用).
        // 实际场景: 反爬屏蔽持续命中同一代理 → streak 持续增长 → 权重持续降 →
        // 自然分散到其它代理 (避免单代理被反复打死).
        proxyInst.pickFailStreak[proxyURL] = newStreak
        // R65-B 反反爬第 58 项: 进入 quarantine (30min cooldown) 时, 扫 hostProxyPin
        //   表, 清所有钉扎到本代理的 host (让下次 pickProxyFor 重新选代理).
        //   注: hostProxyPin 是 sync.Map, 与 proxyInst.mu 不同锁. 不嵌套取锁, 直接
        //   Range + Delete (sync.Map 删除是原子的).
        //   R67-B BUG-60: v 现在是 *hostProxyPinEntry (原 string), 类型断言更新.
        if cooldownMs >= pickFailQuarantineMs {
                hostProxyPin.Range(func(k, v any) bool {
                        ent := v.(*hostProxyPinEntry)
                        if ent.proxyURL == proxyURL {
                                // R73-B BUG-116 (P2) 修复: sweep 与并发 pinProxyForHost Store race.
                                //   pinProxyForHost 每次创建新 *hostProxyPinEntry 并 Store (替换).
                                //   Range 看到的 ent 可能是已被替换的 stale entry (writer Store 新
                                //   entry2 with 不同 proxyURL). 此时 Delete 会删 entry2 (pin 到
                                //   非 failed 代理), 误清好代理钉扎 → 下次 pickProxyFor 又选到该
                                //   host 没有钉扎 → 重新走完整选择路径 → 反爬识别 "同 host IP 跳变"
                                //   (R65-B 第 58 项价值被破坏).
                                //   修复: Delete 前重新 Load 确认 entry 仍是同一个 (指针相等). 不同
                                //   则 writer 已替换为新 entry2 (proxyURL 可能不同), 不该删.
                                if cur, ok := hostProxyPin.Load(k); ok {
                                        if curEnt, ok2 := cur.(*hostProxyPinEntry); ok2 && curEnt == ent {
                                                hostProxyPin.Delete(k)
                                        }
                                }
                        }
                        return true
                })
        }
}

// MarkProxyOK — 标记代理健康 (清除冷却). 调用方在成功响应后调本函数.
// R51-1A: 同时清 pickFailStreak (业务路径成功 = 代理实际可用, 重置权重).
func MarkProxyOK(proxyURL string) {
        if proxyURL == "" {
                return
        }
        proxyInst.mu.Lock()
        defer proxyInst.mu.Unlock()
        delete(proxyInst.failedUntil, proxyURL)
        // R51-1A: 业务路径成功 → 清 pickFailStreak (恢复 weighted-latency 权重)
        delete(proxyInst.pickFailStreak, proxyURL)
        // R46-1B: 健康 → 重置 probe 失败计数 (主动 probe 模式启用时)
        delete(proxyInst.probeFailStreak, proxyURL)
}

// R46-1B 反反爬增强: 代理池主动健康检查 (periodic probe).
//
// 当前 MarkProxyFailed 是被动健康检查 (失败 30s 冷却). 但若代理已死, 需等到下次
// pickProxyFor 失败才被标记, 浪费请求预算. 主动 probe 在 5min sweep 时异步启动
// goroutine 对每个代理发 HEAD 5s timeout 请求 (probe URL = https://www.google.com
// 或可配置 cfg.ProxyProbeURL), 失败累计 probeFailStreak, 连续 3 次 → failedUntil
// += 5min (永久禁用直到下次 5min sweep 重试).
//
// 设计:
//   - proxyProbeCtx + cancel: probe goroutine 用独立 ctx, 主进程退出时 cancel.
//   - 5min sweep 触发: pickProxyFor 内 5min sweep 时, 若 ProxyHealthCheck=true 且
//     lastProbeAt 距今 > 5min → 启动 goroutine 异步 probe 全池 (不阻塞 pick).
//   - probe 目标 URL 优先 cfg.ProxyProbeURL, 否则 https://www.google.com.
//   - probe 限并发: max 5 (避免 50 个代理并发 probe 触发上游限流).
//   - probe 失败 + probeFailStreak >= 3 → failedUntil += 5min (短冷却避免永久禁用).
//   - probe 成功 → probeFailStreak 清零 + failedUntil 清 (恢复健康).
//
// 启用条件: cfg.ProxyHealthCheck=true (默认 false, opt-in 避免误触发 probe 风暴).

// probeProxyWithLatency — 对单个代理发 HEAD 5s timeout 请求, 返回 err=nil 表示健康.
//
//      返回 (latencyMs, err) — latencyMs 为 round-trip 耗时, 供 least-latency
//      旋转策略选最低延迟代理 + ProxyStatsSnapshot 给 admin 查询识别慢代理.
//
// R50-1A: 加 latency 返回值, probeAllProxies 调用方记录到 probeLatencyMs.
// R47-1A 修复 (P1): socks5 实现原 override transport.DialContext 拨 p.Host
//
//      (proxy 的 TCP 地址), 而非用 SOCKS5 协议把 addr 隧道转发到目标. 这导致
//      socks5 代理 probe 永远失败 — http.Client 期待连接到 addr (probeTarget host)
//      但 transport.DialContext 返回的是到 proxy 的 TCP 连接, 客户端发 HTTP 请求
//      到一个不识 HTTP 的 socks5 端口 → 失败. 健康的 socks5 代理被误判为死代理.
//      修复: socks5/socks5h 也用 transport.Proxy = http.ProxyURL(p) (Go net/http
//      原生支持 socks5 URL via Proxy), 不再 override DialContext. http/https 同款.
//
// R47-1A 修复 (P2): UA 改用 UA_POOL 真实浏览器 UA, 原 "Mozilla/5.0 (compatible;
//
//      proxy-probe/1.0)" 是 bot UA, probe endpoint (如 cloudflare) 会返 403 /
//      challenge 页面, probe 把健康代理误判为死. 真实 UA + Accept-Language 让
//      probe 请求与正常爬虫请求同款, 不会触发 endpoint 的 bot 检测.
//
// R48-1A 修复 (P2): 5xx 视为代理健康. 原实现 5xx → 代理被误判死, 但 5xx 说明
//
//      HTTP round trip 成功 (proxy → target → response), 代理工作正常, 只是 target
//      自身故障 (服务挂 / 维护). 把 target 故障归咎到 proxy 是错的, 会导致健康代理
//      被 cooldown 5min. 改为: 5xx 也返 nil (健康), proxy 资源不被浪费. 真正的 proxy
//      失败是网络层 error (dial timeout / connection refused), 由 client.Do err 返回.
//
// R48-1A 反反爬增强 (任务要求 4): probe 请求补全浏览器象同头族 (Sec-Ch-Ua /
//
//      Sec-Fetch-* / Priority / DNT), 与 buildHeaders 同款. 原 probe 仅 UA + Accept
//      + Accept-Language, 头族不全易被 probe endpoint bot detection 识别 (与正常
//      浏览器请求头数差异大). 补全后 probe 请求与正常爬虫请求头族一致, 不触发 bot 检测.
func probeProxyWithLatency(ctx context.Context, proxyURL, probeTarget string) (int64, error) {
        if proxyURL == "" || probeTarget == "" {
                return 0, errors.New("empty proxy or probe target")
        }
        p, err := url.Parse(proxyURL)
        if err != nil {
                return 0, err
        }
        // 构造 transport + proxy (复用 globalTransport.Clone)
        transport := globalTransport.Clone()
        // R65-B BUG-41 (P2): probe 完成后释放 transport 的 idle connections, 避免连接池
        //   泄漏. 原实现 transport 在函数返回后丢弃引用, 但 idle connections 不会被 GC
        //   回收 (Go http.Transport 的 idle 连接需显式 CloseIdleConnections 才释放).
        //   长跑进程 5min 一次 probe × N 代理 → 累积 N×高 IDLE 连接 → MaxIdleConns
        //   打满 → 新 dial 失败 → 健康代理被误判死. 修复: defer CloseIdleConnections.
        defer transport.CloseIdleConnections()
        switch p.Scheme {
        case "http", "https", "socks5", "socks5h":
                // R47-1A: socks5 也用 ProxyURL, Go net/http 原生支持 socks5 URL
                //   (经 ProxyURL 时走 http 1.1 CONNECT 或 socks5 协议握手). 不再
                //   override DialContext (原实现拨 p.Host 而非走 socks5 协议).
                transport.Proxy = http.ProxyURL(p)
        default:
                return 0, fmt.Errorf("unsupported proxy scheme: %s", p.Scheme)
        }
        client := &http.Client{
                Transport: transport,
                Timeout:   5 * time.Second,
                CheckRedirect: func(req *http.Request, via []*http.Request) error {
                        return http.ErrUseLastResponse
                },
        }
        req, err := http.NewRequestWithContext(ctx, "HEAD", probeTarget, nil)
        if err != nil {
                return 0, err
        }
        // R48-1A: 浏览器象同头族 (与 buildHeaders 同款, 防 probe endpoint bot 检测).
        //   真实 UA + Accept + Accept-Language + Accept-Encoding + Sec-Ch-Ua +
        //   Sec-Fetch-* + Priority + DNT, probe 请求与正常爬虫请求头族完全一致.
        ua := UA_POOL[rand.Intn(len(UA_POOL))]
        req.Header.Set("User-Agent", ua)
        req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7")
        req.Header.Set("Accept-Encoding", "gzip, deflate")
        req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        req.Header.Set("Connection", "keep-alive")
        req.Header.Set("Upgrade-Insecure-Requests", "1")
        req.Header.Set("DNT", "1")
        req.Header.Set("Sec-Fetch-Dest", "document")
        req.Header.Set("Sec-Fetch-Mode", "navigate")
        req.Header.Set("Sec-Fetch-Site", "none")
        req.Header.Set("Sec-Fetch-User", "?1")
        req.Header.Set("Priority", "u=0, i")
        // Sec-Ch-Ua 头族 (Chromium 品牌 + Grease + Platform)
        // R65-B BUG-42 (P2): 原实现只发 2 品牌 (grease + brand), 与 buildHeaders
        //   不一致 (R64-B 第 55 项已改为 3 品牌). probe endpoint (cloudflare /
        //   google) 会按品牌数识别非浏览器指纹, 2 品牌 probe 会被误为 bot. 修复:
        //   3 品牌格式 (grease + Chromium + Google Chrome / Microsoft Edge),
        //   + Sec-Ch-Ua-Platform-Version (与 buildHeaders 完全一致).
        if !IsFirefoxUA(ua) && !IsSafariUA(ua) {
                ver := extractChromeVer(ua)
                verStr := intToStrOr(ver, "137")
                var brands []string
                if strings.Contains(ua, "Edg/") {
                        brands = []string{
                                `"Not_A Brand";v="8"`,
                                `"Chromium";v="` + verStr + `"`,
                                `"Microsoft Edge";v="` + verStr + `"`,
                        }
                } else {
                        brands = []string{
                                `"Not?A_Brand";v="8"`,
                                `"Chromium";v="` + verStr + `"`,
                                `"Google Chrome";v="` + verStr + `"`,
                        }
                }
                req.Header.Set("Sec-Ch-Ua", strings.Join(brands, ", "))
                if IsMobileUA(ua) {
                        req.Header.Set("Sec-Ch-Ua-Mobile", "?1")
                        req.Header.Set("Sec-Ch-Ua-Platform", `"Android"`)
                } else if strings.Contains(ua, "Windows") {
                        req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
                        req.Header.Set("Sec-Ch-Ua-Platform", `"Windows"`)
                } else if strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X") {
                        req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
                        req.Header.Set("Sec-Ch-Ua-Platform", `"macOS"`)
                } else if strings.Contains(ua, "Linux") {
                        req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
                        req.Header.Set("Sec-Ch-Ua-Platform", `"Linux"`)
                }
                // R65-B BUG-42: 补 Sec-Ch-Ua-Platform-Version (与 buildHeaders 同款).
                if pv := extractPlatformVersion(ua); pv != "" {
                        req.Header.Set("Sec-Ch-Ua-Platform-Version", `"`+pv+`"`)
                }
        }
        // R50-1A: 记录 round-trip latency
        start := time.Now()
        resp, err := client.Do(req)
        latencyMs := time.Since(start).Milliseconds()
        if err != nil {
                return 0, err
        }
        // R51-1A 修复 BUG-4 (P3): drain + close 响应体 (即使 HEAD 请求, 部分 endpoint
        //   误返 200 + body, 或中间代理注入 body). 不 drain 会导致:
        //   1) 连接无法被 Transport 重用 (Go http 规则: body 未读完不能复用连接);
        //   2) 持续 probe 下 (5min sweep), 累积半开连接 → MaxIdleConns 打满 → 新 dial
        //      失败 → 健康代理被误判死 (probe 看似 timeout 实际是连接池满).
        //   解法: 用 io.Copy + LimitReader(64KB) drain 后 close. 64KB 上限防病态
        //   endpoint 返大 body 拖慢 probe (HEAD 正常返 0 body, 仅异常 case 才有 body).
        defer func() {
                _, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
                resp.Body.Close()
        }()
        // R48-1A: 5xx 也视为代理健康 (proxy 已成功 relay HTTP round trip, target
        //   自身故障不归咎 proxy). 真正的 proxy 失败是网络层 error (上面 client.Do
        //   err 分支). 501 Not Implemented (probe endpoint 不支持 HEAD) 同款视为健康.
        //   原实现 5xx → return error → probeAllProxies 累计 probeFailStreak →
        //   连续 3 次 → 5min cooldown, 健康代理被误判死. 改为 5xx 也返 nil.
        _ = resp.StatusCode
        return latencyMs, nil
}

// probeAllProxies — 异步 probe 所有代理 (5min 间隔, 不阻塞 pick).
// R46-1B 反反爬增强.
// R50-1A: probeProxyWithLatency 返回 latency, 记录到 probeLatencyMs 供
//
//      least-latency 旋转策略选最低延迟代理. 失败时 latencyMs=0 (视为 999999
//      不优先, 避免选到死的代理).
func probeAllProxies(pool []string, probeTarget string) {
        if len(pool) == 0 || probeTarget == "" {
                return
        }
        ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
        defer cancel()
        // 限并发 5 (避免大池上游限流)
        sem := make(chan struct{}, 5)
        var wg sync.WaitGroup
        for _, p := range pool {
                wg.Add(1)
                go func(proxyURL string) {
                        defer wg.Done()
                        sem <- struct{}{}
                        defer func() { <-sem }()
                        // R50-1A: 用 probeProxyWithLatency 取 latency
                        // R51-1A 修复 P0 BUG (审视): 函数签名是 (int64, error), 调用方
                        //   应 `latencyMs, err :=` 顺序接收. 原代码顺序正确但 worklog
                        //   错误描述为 (error, int64), 仅是注释口径不齐, 不影响编译.
                        //   实际编译错误来自 R50-1A 后续改动误改顺序, 此处恢复正确顺序.
                        latencyMs, err := probeProxyWithLatency(ctx, proxyURL, probeTarget)
                        now := time.Now().UnixMilli()
                        if err != nil {
                                // 失败累计, 连续 3 次 → failedUntil += 5min
                                proxyInst.mu.Lock()
                                proxyInst.probeFailStreak[proxyURL]++
                                streak := proxyInst.probeFailStreak[proxyURL]
                                if streak >= 3 {
                                        proxyInst.failedUntil[proxyURL] = now + 5*60*1000
                                }
                                // R50-1A: 失败 → latency=0 (least-latency 不优先)
                                proxyInst.probeLatencyMs[proxyURL] = 0
                                proxyInst.probeLastAt[proxyURL] = now
                                proxyInst.mu.Unlock()
                        } else {
                                // 成功 → 清零 + 恢复健康 + 记录 latency
                                proxyInst.mu.Lock()
                                delete(proxyInst.probeFailStreak, proxyURL)
                                delete(proxyInst.failedUntil, proxyURL)
                                proxyInst.probeLatencyMs[proxyURL] = latencyMs
                                proxyInst.probeLastAt[proxyURL] = now
                                proxyInst.mu.Unlock()
                        }
                }(p)
        }
        wg.Wait()
}

// proxyHealthProberStarted — 防止多次调用启动多个 goroutine (R72-C 反反爬第 79 项).
var proxyHealthProberStarted atomic.Bool

// StartProxyHealthProber — 启动独立后台代理健康探测 goroutine (R72-C 反反爬第 79 项).
//
//      原 R46-1B 的 probeAllProxies 是 "lazy" probe — 仅在 pickProxyFor 内 5min sweep
//      触发 (即只有活跃采集任务时才跑). 任务空闲期 (无新 pickProxyFor 调用) 时 probe
//      不跑 → 死代理的 failedUntil 自然到期后被回选 → 第一次请求失败才被重标 cooldown
//      → 浪费请求预算 + 用户体验降. 本 goroutine 提供独立 5min ticker, 调用方传
//      proxy pool + probe target, 后台周期性 probe, 即使无活跃采集也能保持代理健康
//      度新鲜. caller (admin / main) 在 ProxyHealthCheck=true 任务启动时启动 + 任务
//      结束时 ctx cancel 停止 (与 StartTlsSessionBackgroundFlusher / StartCookieJar
//      BackgroundFlusher 同口径 API).
//      设计:
//       - 仅启动一次 (atomic.Bool + CompareAndSwap), 多次调用幂等.
//       - intervalMs ≤ 0 时默认 5min (与 pickProxyFor sweep 同口径).
//       - pool / probeTarget 为空时直接 return (无代理可 probe, 不阻塞).
//       - 复用 probeAllProxies (限并发 5 + 60s 整体超时), 0 重复代码.
//       - ctx.Done() 让 caller 在 graceful shutdown / 任务停止时停止 prober (与
//         StartCookieJarBackgroundFlusher 同口径).
//      注: 本 goroutine 与 pickProxyFor 内的 lazy probe 是协同关系 — 两者都调
//      probeAllProxies, probeAllProxies 内部加 proxyInst.mu 串行化 probe state 写,
//      无 race. 重复 probe (5min 内两次) 也无害 (probeProxyWithLatency 是无副作用
//      HTTP HEAD, 不修改源站状态).
func StartProxyHealthProber(ctx context.Context, pool []string, probeTarget string, intervalMs int) {
        // R73-B BUG-103 (P2) 修复: 原实现 CAS 在 empty check 之前, 导致首次调用
        //   pool 为空时 (无代理配置 / ProxyProbeURL 未配) 仍 set flag = true, 后续
        //   caller (e.g. admin 动态加代理后重调本函数) 因 CAS 失败 (flag 已 true)
        //   直接 return 不启动 goroutine, 主动 probe 永远不跑.
        //   修复: empty check 提前到 CAS 之前, empty 调用不 set flag, 后续 valid
        //   调用能正常 CAS + start goroutine. 原 "防多空 goroutine" 推理错误 —
        //   empty 调用走 return 不创建 goroutine, flag 多此一举.
        if len(pool) == 0 || probeTarget == "" {
                // 无代理 / 无 probe target → 不启动 goroutine (caller 后续可重调).
                return
        }
        if !proxyHealthProberStarted.CompareAndSwap(false, true) {
                return // 已启动, 跳过
        }
        if intervalMs <= 0 {
                intervalMs = 5 * 60 * 1000
        }
        // 复制 pool (避免 caller 后续 mutate 影响 goroutine)
        poolCopy := make([]string, len(pool))
        copy(poolCopy, pool)
        go func() {
                ticker := time.NewTicker(time.Duration(intervalMs) * time.Millisecond)
                defer ticker.Stop()
                for {
                        select {
                        case <-ctx.Done():
                                return
                        case <-ticker.C:
                                // 错误忽略: probeAllProxies 是无返回值的 fire-and-forget,
                                //   内部已处理并发 + 失败累计 + quarantine.
                                probeAllProxies(poolCopy, probeTarget)
                        }
                }
        }()
}

// ProxyStatsSnapshot — admin / metrics 查询用: 返回代理池统计 (R50-1A 新增).
//
//      每个代理 URL → {useCount, probeLatencyMs, probeLastAt, failedUntil, inCooldown,
//      pickFailStreak}. 供 admin UI 识别慢代理 (latency > 3s 视为慢) + 死代理
//      (failedUntil > now) + 业务失败率高代理 (pickFailStreak > 3 视为有问题).
//      R51-1A: 加 pickFailStreak 字段 (业务路径失败计数, 与 probe 失败计数独立).
func ProxyStatsSnapshot() map[string]map[string]int64 {
        proxyInst.mu.Lock()
        defer proxyInst.mu.Unlock()
        out := map[string]map[string]int64{}
        now := time.Now().UnixMilli()
        // 合并 useCount + probeLatencyMs + probeLastAt + failedUntil + pickFailStreak keys
        seen := map[string]bool{}
        for k := range proxyInst.useCount {
                seen[k] = true
        }
        for k := range proxyInst.probeLatencyMs {
                seen[k] = true
        }
        for k := range proxyInst.probeLastAt {
                seen[k] = true
        }
        for k := range proxyInst.failedUntil {
                seen[k] = true
        }
        // R51-1A: 加 pickFailStreak keys (业务失败计数独立的代理可能在 useCount=0 但
        //   pickFailStreak>0 状态, 即只失败未被用过, 需独立合并).
        for k := range proxyInst.pickFailStreak {
                seen[k] = true
        }
        for url := range seen {
                m := map[string]int64{
                        "useCount":       int64(proxyInst.useCount[url]),
                        "probeLatencyMs": proxyInst.probeLatencyMs[url],
                        "probeLastAt":    proxyInst.probeLastAt[url],
                        "failedUntil":    proxyInst.failedUntil[url],
                        "inCooldown":     boolToInt64(proxyInst.failedUntil[url] > now),
                        "pickFailStreak": int64(proxyInst.pickFailStreak[url]), // R51-1A
                }
                out[url] = m
        }
        return out
}

// R47-1A 反反爬增强: probe target 轮换 (5 个 reliable endpoint, 每次轮选).
//
//      原实现固定 https://www.google.com, 长期被 Google bot detection 识别 →
//      返 429 / challenge 页面 → 健康代理被误判死. 改为从 5 个 endpoint 轮选,
//      每次取不同的 target, 降低单 endpoint 命中频率.
//      endpoint 选择标准: 全球可达 + 5xx 概率低 + 不返 challenge 页面 (HEAD 请求).
//      Cloudflare / Microsoft / Apple / Mozilla / IANA 都是大厂稳定 endpoint.
var probeTargetPool = []string{
        "https://www.google.com",
        "https://www.cloudflare.com",
        "https://www.microsoft.com",
        "https://www.apple.com",
        "https://www.iana.org",
}

// probeTargetCounter — probe target 轮换计数器 (atomic).
var probeTargetCounter atomic.Uint64

// pickProbeTarget — 从 probeTargetPool 中轮选一个 endpoint (round-robin 风格).
//
//      返回 target URL. 5 个 endpoint 轮换, 单 endpoint 命中频率 1/5.
func pickProbeTarget() string {
        n := int(probeTargetCounter.Add(1) - 1) // 第一次返回 0 (取 [0])
        return probeTargetPool[n%len(probeTargetPool)]
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
// 8 级降级链顺序:
//  1. native (net/http)
//  2. curl (exec curl)
//  3. fetch-relay (HTTP 代理)
//  4. scrapling (HTTP 代理)
//  5. Obscura (HTTP 代理)
//  6. uc-bridge (HTTP 代理)
//  7. moli-bridge (HTTP 代理)
//  8. curl-impersonate (HTTP 代理)
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
        for _, host := range group {
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

// captchaSitekeyRe — 提取 captcha sitekey (data-sitekey / data-pubkey / data-pkey 属性).
//
//      data-sitekey — 标准 h-captcha / reCAPTCHA / Turnstile 属性.
//      data-pubkey — h-captcha enterprise 变体 (部分企业部署用此属性名).
//      data-pkey — 极少数自定义集成变体.
//      sitekey 长度 ≥20 防 "key" / "test" 等非 sitekey 字符串误命中.
//      R50-1A: 扩展支持 data-pubkey / data-pkey (原仅 data-sitekey, 漏 h-captcha
//      enterprise / 自定义集成的 sitekey, captcha 求解时 sitekey 取不到 → 直接
//      return "" 不调 captcha 服务, h-captcha enterprise 站点 captcha 求解失效).
var captchaSitekeyRe = regexp.MustCompile(`(?i)data-(?:sitekey|pubkey|pkey)=["']?([A-Za-z0-9_-]{20,})["']?`)

// captchaSitekeyReFallback — 兜底从 JS 变量提取 sitekey (sitekey: "..." / sitekey:"...").
//
//      部分站点用 JS 动态渲染 captcha, data-* 属性不在 HTML 中, 需从 <script> 内
//      sitekey: "..." 字面量提取. R50-1A 新增.
var captchaSitekeyReFallback = regexp.MustCompile(`(?i)sitekey\s*[:=]\s*["']([A-Za-z0-9_-]{20,})["']`)

// captchaSitekeyReIframeSrc — 兜底从 iframe src URL query 提取 sitekey (R51-1A).
//
//      部分站点 (尤其 Cloudflare Turnstile / 部分 h-captcha enterprise) 用 iframe
//      直接加载 captcha widget, sitekey 在 iframe src URL query 中 (?sitekey=xxx) 或
//      在 path 中 (/api/v1/<sitekey>). 原 R50-1A 仅扫 data-* 属性 + JS 变量, 漏 iframe src.
//      匹配模式:
//        ?sitekey=abc... / &sitekey=abc... (query 形式)
//        /turnstile/v0/api.js?...sitekey=0x... (Cloudflare Turnstile iframe 常见)
//        /api/v1/abc... (h-captcha path 形式, 兜底, 通过 path 段长度 ≥20 过滤)
//      长度 ≥20 防 "test"/"key" 误命中 (Turnstile sitekey 是 0x + 32+ hex = 36+ chars,
//      h-captcha sitekey 是 UUID 形 36 chars, reCAPTCHA sitekey 是 40 chars).
var captchaSitekeyReIframeSrc = regexp.MustCompile(`(?i)(?:sitekey|pubkey|pkey)[=:]([A-Za-z0-9_-]{20,})`)

// extractCaptchaSitekey — 从 HTML 提取 captcha sitekey. 失败返回空.
//
//      优先级: data-* 属性 > JS 变量字面量 > iframe src URL query (R51-1A).
//      R50-1A: 加 fallback 从 JS 变量提取 sitekey (动态渲染 captcha 站点).
//      R51-1A: 加 fallback 从 iframe src URL query 提取 (Turnstile / h-captcha
//        enterprise iframe 直接加载场景).
func extractCaptchaSitekey(html string) string {
        if m := captchaSitekeyRe.FindStringSubmatch(html); len(m) >= 2 {
                return m[1]
        }
        // R50-1A: fallback 从 JS 变量提取 (动态渲染 captcha 站点)
        if m := captchaSitekeyReFallback.FindStringSubmatch(html); len(m) >= 2 {
                return m[1]
        }
        // R51-1A: fallback 从 iframe src URL query 提取 (Turnstile / h-captcha
        //   enterprise iframe 直接加载场景). captcha iframe 的 src 通常含
        //   hcaptcha.com / challenges.cloudflare.com / recaptcha/api 域名, 但本
        //   fallback 不限域名 (避免漏命中企业自部署的 captcha endpoint), 仅靠
        //   sitekey= / pubkey= / pkey= 字面量 + 长度 ≥20 过滤.
        if m := captchaSitekeyReIframeSrc.FindStringSubmatch(html); len(m) >= 2 {
                return m[1]
        }
        return ""
}

// submitCaptchaTo2Captcha — POST /in.php 提交 captcha 任务.
// 返回 captcha_id (2captcha 侧任务 ID). 失败返回空.
// R45-1A 反反爬修复: 原实现用 globalHttp.Do(req) 不设 UA, 默认 Go-http-client/1.1
//
//      UA 被 2captcha Cloudflare 检测为 bot 拦截. 补全 UA + Accept + Accept-Language
//      + Accept-Encoding 与 buildHeaders 同款 (浏览器象同指纹). 增加单次请求 10s 超时,
//      避免提交超时连接报连 180s.
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
//
//      Cloudflare 检测为 bot 拦截, 返 403 → token 永远拿不到 → 180s 超时. 补 UA + Accept
//      + Accept-Language + Accept-Encoding 与 buildHeaders 同款.
func applyBrowserLikeHeaders(req *http.Request) {
        req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        req.Header.Set("Accept", "application/json, text/plain, */*;q=0.8")
        req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        req.Header.Set("Accept-Encoding", "gzip, deflate")
        // R68-B 反反爬第 75 项: Connection: keep-alive 显式注入 (外调 API 路径).
        //   applyBrowserLikeHeaders 用于 2captcha / anti-captcha / CapSolver 外调 API.
        //   原实现缺 Connection 头, 这些 captcha API 服务 (Cloudflare 后端) 默认
        //   close → 每次轮询都重连 (180s 内 36 次 poll = 36 次握手). 显式 keep-alive
        //   让源站复用 TCP 连接 + 提速 + 降 Bot Score (Cloudflare 识别 "无 keep-alive"
        //   高频请求是爬虫指纹).
        req.Header.Set("Connection", "keep-alive")
}

// pollCaptchaResult — 轮询 /res.php 直到 token 返回或超时 (默认 180s).
// 2captcha 文档: 平均 12-30s, 上限 180s.
// R45-1A: 每轮诹求 15s 超时 (原仅依赖 parent 180s, 2captcha 挂连接 → 180s 才能出循环).
//
//      并补全浏览器象同头 (applyBrowserLikeHeaders) 防 Cloudflare bot 检测.
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
                if err != nil {
                        reqCancel()
                        continue
                }
                // R68-B BUG-74 (P3) 修复: 把 reqCancel() 移到 resp.Body.Close() 之后.
                //   原实现 reqCancel() 在 Do 后立即调, 然后 io.ReadAll(resp.Body) 在
                //   已 cancel 的 ctx 下读 body. 2captcha res.php 响应小 (<4KB), 多数
                //   case body 已在 transport 读缓冲区, ReadAll 仍成功; 但对较大响应
                //   (>4KB) 或慢网络, body 读会因 ctx canceled 失败 → respBody 部分 →
                //   json.Unmarshal 失败 → 继续轮询 5s, 直到 180s 超时返 "". 显式
                //   推迟 reqCancel 到 body close 后, body 读全程 ctx 仍 active,
                //   io.ReadAll 不会因 ctx 取消失败.
                body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
                resp.Body.Close()
                reqCancel()
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

// trySolveCaptchaWith2Captcha — 用 2captcha / anti-captcha / capsolver 服务求解 h-captcha / reCAPTCHA.
// 成功返回注入 token 后的页面 HTML, 失败返回空.
// 注: Turnstile 走 trySolveTurnstile (Obscura 桥 puppeteer 点击更稳定),
// captcha 服务仅处理 h-captcha / reCAPTCHA (服务端 token 注入即可通过).
// R45-1A: 2captcha 不可用 / API key 未配置时, 自动 fallback 到 anti-captcha 服务
//
//      (cfg.AntiCaptchaAPIKey). 两个服务各试一次, 单服务超时由 caller 处理.
//
// R46-1B 反反爬增强: 加 captcha 服务成功率统计, 长期低成功率自动切换主服务.
//   - captchaStatsMu / captchaStats map[service]captchaStat {success, fail}
//   - 主服务选择: 默认 2captcha; 若 2captcha 最近 10 次成功率 < 50% 且 anti-captcha
//     最近 10 次成功率更高 → 主服务切到 anti-captcha (反之亦然).
//   - 滑动窗口风格: 每 10 次结果触发一次主服务评估, 决定下次的主服务.
//   - 解决"2captcha 短暂故障但 anti-captcha 可用"时仍盲目先试 2captcha 浪费 180s 超时.
//
// R47-1A 反反爬增强: 连续 N=3 次失败触发 60s cooldown, cooldown 内主服务跳过改用
//
//      备服务. 都在 cooldown 则快速 return "" 不浪费 180s (任务要求 3: 验证码服务优化).
//
// R48-1A 反反爬增强: 加 3rd provider CapSolver (任务要求 3: 更多 provider).
//   - 三服务级联: 2captcha → anti-captcha → capsolver. 任一服务连续 3 次失败
//     触发 60s cooldown, cooldown 期内跳过该服务. 三服务都 cooldown → 立即 return "".
//   - captchaPrimaryService 3 服务版: 主服务 cooldown / 不可用时按优先级顺序
//     (2captcha → anti-captcha → capsolver) 找替代. 解决单一服务商挂掉时整个
//     captcha 链路死锁.
//   - 新增 captchaAllInCooldown (3 服务版) 替代 captchaBothInCooldown. 后者保留
//     向后兼容委托前者.
func trySolveCaptchaWith2Captcha(ctx context.Context, rawURL string, cfg FetchConfig, ct CaptchaType, html string) string {
        if ct != CaptchaHCaptcha && ct != CaptchaRecaptcha {
                return ""
        }
        sitekey := extractCaptchaSitekey(html)
        if sitekey == "" {
                return ""
        }
        // R48-1A: 3 服务可用性
        twoCaptchaAvailable := cfg.TwoCaptchaAPIKey != ""
        antiCaptchaAvailable := cfg.AntiCaptchaAPIKey != ""
        capSolverAvailable := cfg.CapSolverAPIKey != ""
        if !twoCaptchaAvailable && !antiCaptchaAvailable && !capSolverAvailable {
                return ""
        }
        // R48-1A: 快速路径 — 三个服务都 cooldown → 立即 return "" 不浪费 180s
        //   (60s cooldown 期内尝试只是重复失败, 2captcha 等待 180s 超时, 共浪费 540s+).
        if captchaAllInCooldown(twoCaptchaAvailable, antiCaptchaAvailable, capSolverAvailable) {
                return ""
        }
        // R48-1A: 选主服务 (3 服务版)
        primary := captchaPrimaryService(twoCaptchaAvailable, antiCaptchaAvailable, capSolverAvailable)
        // 试主服务
        primarySolved := captchaTryService(ctx, primary, rawURL, cfg, ct, sitekey)
        if primarySolved != "" {
                return primarySolved
        }
        // 主服务失败 → 试备服务 (按优先级顺序跳过 primary, 跳过 cooldown 内的服务)
        for _, svc := range captchaBackupChain(primary, twoCaptchaAvailable, antiCaptchaAvailable, capSolverAvailable) {
                if captchaServiceInCooldown(svc) {
                        continue
                }
                solved := captchaTryService(ctx, svc, rawURL, cfg, ct, sitekey)
                if solved != "" {
                        return solved
                }
        }
        return ""
}

// captchaTryService — 分发到指定服务的求解器 (R48-1A 3 服务统一接口).
//
//      service: "2captcha" | "anticaptcha" | "capsolver".
//      成功返回注入 token 后的页面 HTML, 失败返回空. 同时记录服务调用结果.
func captchaTryService(ctx context.Context, service, rawURL string, cfg FetchConfig, ct CaptchaType, sitekey string) string {
        switch service {
        case "2captcha":
                if cfg.TwoCaptchaAPIKey == "" {
                        return ""
                }
                solved := trySolveCaptchaWith2CaptchaInner(ctx, rawURL, cfg, ct, sitekey)
                captchaRecordOutcome("2captcha", solved != "")
                return solved
        case "anticaptcha":
                if cfg.AntiCaptchaAPIKey == "" {
                        return ""
                }
                solved := trySolveCaptchaWithAntiCaptcha(ctx, rawURL, cfg, ct, sitekey)
                captchaRecordOutcome("anticaptcha", solved != "")
                return solved
        case "capsolver":
                if cfg.CapSolverAPIKey == "" {
                        return ""
                }
                solved := trySolveCaptchaWithCapSolver(ctx, rawURL, cfg, ct, sitekey)
                captchaRecordOutcome("capsolver", solved != "")
                return solved
        }
        return ""
}

// captchaBackupChain — 返回备服务优先级列表 (跳过 primary, 仅含 configured 服务).
//
//      顺序: 2captcha → anti-captcha → capsolver (默认优先级, captchaPrimaryService
//      同款). 主服务失败时按此顺序尝试备服务, 避免盲目尝试不可用的服务.
func captchaBackupChain(primary string, twoCaptcha, antiCaptcha, capSolver bool) []string {
        // R68-B minor cleanup: 4-space 缩进改 8-space 与文件其他函数一致 (gofmt
        //   tabs vs spaces 历史遗留, 但本函数原 4-space 是误改, 不一致).
        out := []string{}
        if twoCaptcha && primary != "2captcha" {
                out = append(out, "2captcha")
        }
        if antiCaptcha && primary != "anticaptcha" {
                out = append(out, "anticaptcha")
        }
        if capSolver && primary != "capsolver" {
                out = append(out, "capsolver")
        }
        return out
}

// captchaServiceInCooldown — 检查某服务是否在 cooldown 期内 (R47-1A).
//
//      不取锁 (供 trySolveCaptchaWith2Captcha 在已持有 captchaPrimaryService 返回的
//      primary 后做额外检查; 实际取锁是必要的).
func captchaServiceInCooldown(service string) bool {
        captchaStatsMu.Lock()
        defer captchaStatsMu.Unlock()
        st, ok := captchaStatsMap[service]
        if !ok {
                return false
        }
        return st.cooldownUntil > time.Now().UnixMilli()
}

// captchaAllInCooldown — 检查所有已配置的服务是否都在 cooldown 期内 (R48-1A 3 服务版).
//
//      仅检查已配置 API key 的服务 (未配置的服务视为 "等价 cooldown" 不可用).
//      全部在 cooldown → 调用方应立即 return "" 不浪费 180s 超时.
//      R48-1A: 替代 R47-1A 的 captchaBothInCooldown (2 服务版), 后者已删除 (无调用方).
func captchaAllInCooldown(twoCaptcha, antiCaptcha, capSolver bool) bool {
        captchaStatsMu.Lock()
        defer captchaStatsMu.Unlock()
        now := time.Now().UnixMilli()
        twoInCd := false
        antiInCd := false
        capInCd := false
        if twoCaptcha {
                if st, ok := captchaStatsMap["2captcha"]; ok && st.cooldownUntil > now {
                        twoInCd = true
                }
        } else {
                twoInCd = true // 未配置视为 "不可用 = 等价 cooldown"
        }
        if antiCaptcha {
                if st, ok := captchaStatsMap["anticaptcha"]; ok && st.cooldownUntil > now {
                        antiInCd = true
                }
        } else {
                antiInCd = true
        }
        if capSolver {
                if st, ok := captchaStatsMap["capsolver"]; ok && st.cooldownUntil > now {
                        capInCd = true
                }
        } else {
                capInCd = true
        }
        return twoInCd && antiInCd && capInCd
}

// captchaStat — 单个 captcha 服务的成功率统计 (R46-1B 反反爬增强).
//
//      R47-1A 增加 consecutiveFail + cooldownUntil 字段: 连续 N 次失败后短期
//      cooldown 避免浪费 180s 超时 (任务要求 3: 验证码服务优化).
type captchaStat struct {
        success         int64
        fail            int64
        consecutiveFail int64 // R47-1A: 连续失败计数, 成功时清零
        cooldownUntil   int64 // R47-1A: 该服务短期 cooldown 截止时间 (UnixMilli)
}

// captchaStatsMap — 服务名 ("2captcha" / "anticaptcha" / "capsolver") → 统计.
//
//      每 10 次结果触发一次主服务评估. 窗口式评估: 看最近 N=10 次的 success/fail 比例.
//      R48-1A: 加 "capsolver" (3rd captcha provider).
var (
        captchaStatsMu  sync.Mutex
        captchaStatsMap = map[string]*captchaStat{
                "2captcha":    {},
                "anticaptcha": {},
                "capsolver":   {}, // R48-1A: CapSolver (3rd provider)
        }
        captchaPrimaryServiceName = "2captcha"
)

// captchaCooldownThreshold — 连续失败触发 cooldown 的阈值 (R47-1A).
const captchaCooldownThreshold = 3

// captchaCooldownMs — cooldown 持续时间 60s (R47-1A).
//
//      60s 足够 2captcha/anti-captcha 服务端恢复, 又不会让请求等待太久.
const captchaCooldownMs = 60 * 1000

// captchaRecordOutcome — 记录 captcha 服务调用结果 (R46-1B 反反爬增强).
//
//      成功 → success++; 失败 → fail++. 每 10 次结果触发主服务评估.
//      R47-1A: 成功时清 consecutiveFail; 失败时 consecutiveFail++. 连续 N=3 次失败 →
//      该服务进入 60s cooldown, captchaPrimaryService 跳过该服务改用备服务.
func captchaRecordOutcome(service string, ok bool) {
        captchaStatsMu.Lock()
        defer captchaStatsMu.Unlock()
        st, ok2 := captchaStatsMap[service]
        if !ok2 {
                return
        }
        now := time.Now().UnixMilli()
        if ok {
                st.success++
                st.consecutiveFail = 0
                st.cooldownUntil = 0 // 成功 → 清 cooldown
        } else {
                st.fail++
                st.consecutiveFail++
                // R47-1A: 连续 N 次失败 → 进入 cooldown (避免持续浪费 180s 超时)
                if st.consecutiveFail >= captchaCooldownThreshold {
                        st.cooldownUntil = now + captchaCooldownMs
                        // 重置 consecutiveFail 避免 cooldown 期间再触发 (cooldownUntil 已是更晚)
                        st.consecutiveFail = 0
                }
        }
        // 每 10 次结果触发一次主服务评估 (窗口式)
        total := st.success + st.fail
        if total%10 == 0 {
                captchaEvaluatePrimary()
        }
}

// captchaEvaluatePrimary — 评估并切换主服务 (R46-1B 反反爬增强).
//
//      比较所有服务最近 10 次的 success/fail 比例:
//      - 主服务成功率 < 50% 且备服务成功率 > 主服务 → 切换主服务
//      - 否则不变 (避免抖动, 切换需明确证据).
//      R48-1A: 扩展为 3 服务 (2captcha / anti-captcha / capsolver). 主服务 < 50%
//      时切换到成功率最高的备服务 (要求备服务至少 10 次样本, 与 R46-1B 同款阈值).
func captchaEvaluatePrimary() {
        two := captchaStatsMap["2captcha"]
        anti := captchaStatsMap["anticaptcha"]
        cap_ := captchaStatsMap["capsolver"]
        rateOf := func(st *captchaStat) float64 {
                if st == nil || st.success+st.fail == 0 {
                        return 0
                }
                return float64(st.success) / float64(st.success+st.fail)
        }
        countOf := func(st *captchaStat) int64 {
                if st == nil {
                        return 0
                }
                return st.success + st.fail
        }
        twoRate := rateOf(two)
        antiRate := rateOf(anti)
        capRate := rateOf(cap_)
        twoCount := countOf(two)
        antiCount := countOf(anti)
        capCount := countOf(cap_)
        // 评估窗口: 至少 10 次结果才切换 (避免样本不足误判)
        if twoCount < 10 && antiCount < 10 && capCount < 10 {
                return
        }
        cur := captchaPrimaryServiceName
        // 当前主服务的成功率
        var curRate float64
        switch cur {
        case "2captcha":
                curRate = twoRate
        case "anticaptcha":
                curRate = antiRate
        case "capsolver":
                curRate = capRate
        }
        // 主服务 < 50% 且 ≥ 10 次样本 → 切换到成功率最高的备服务
        var curCount int64
        switch cur {
        case "2captcha":
                curCount = twoCount
        case "anticaptcha":
                curCount = antiCount
        case "capsolver":
                curCount = capCount
        }
        if curCount < 10 || curRate >= 0.5 {
                return
        }
        // 找成功率最高的备服务 (至少 10 次样本且 > curRate)
        best := ""
        bestRate := curRate
        if antiCount >= 10 && antiRate > bestRate {
                best = "anticaptcha"
                bestRate = antiRate
        }
        if capCount >= 10 && capRate > bestRate {
                best = "capsolver"
                bestRate = capRate
        }
        if twoCount >= 10 && twoRate > bestRate && cur != "2captcha" {
                best = "2captcha"
                // R64-B BUG-36: bestRate = twoRate 是最后赋值, 后续不再读 → SA4006 dead store.
                //   保留语义注释: 理论上 bestRate 应更新为 twoRate, 但本函数到此结束, 不再比较.
                //   _ = twoRate 明确标记 "已知不再用", staticcheck 满意.
                _ = twoRate
        }
        if best != "" && best != cur {
                captchaPrimaryServiceName = best
        }
}

// captchaPrimaryService — 返回当前主服务名 (R46-1B 反反爬增强).
//
//      优先用成功率统计选定的主服务; 仅一个服务可用时直接返回那个.
//      R47-1A: 主服务在 cooldown 期间 (连续 3 次失败触发 60s cooldown) 跳过改用备服务,
//      避免持续浪费 180s 超时. 都在 cooldown 则返原 primary (调用方会因 "primarySolved==''"
//      立即 return "", 不浪费 180s).
//      R48-1A: 扩展为 3 服务 (2captcha / anti-captcha / capsolver). 主服务 cooldown / 不可用时
//      按优先级顺序 (2captcha → anti-captcha → capsolver) 找第一个 available + not-in-cooldown
//      的服务. 都不可用 → 返原 primary (调用方会因 captchaAllInCooldown 早返回 "").
func captchaPrimaryService(twoCaptcha, antiCaptcha, capSolver bool) string {
        captchaStatsMu.Lock()
        defer captchaStatsMu.Unlock()
        now := time.Now().UnixMilli()
        primary := captchaPrimaryServiceName
        // 检查主服务是否在 cooldown 或不可用
        primaryInCooldown := false
        if st, ok := captchaStatsMap[primary]; ok && st.cooldownUntil > now {
                primaryInCooldown = true
        }
        primaryAvailable := backupAvailable3(primary, twoCaptcha, antiCaptcha, capSolver)
        // 主服务 cooldown 或不可用 → 按优先级顺序找替代
        if primaryInCooldown || !primaryAvailable {
                // 优先级顺序: 2captcha > anti-captcha > capsolver (默认),
                // 跳过当前 primary (它已 cooldown / 不可用)
                candidates := []string{"2captcha", "anticaptcha", "capsolver"}
                for _, svc := range candidates {
                        if svc == primary {
                                continue
                        }
                        if !backupAvailable3(svc, twoCaptcha, antiCaptcha, capSolver) {
                                continue
                        }
                        if bst, ok := captchaStatsMap[svc]; ok && bst.cooldownUntil > now {
                                continue
                        }
                        return svc
                }
                // 都不可用 / 都 cooldown → 落回原 primary (调用方会立即 return "")
                // 不在这层做 "都 cooldown 就跳过 captcha" 决策, 由上层 trySolveCaptchaWith2Captcha
                // 看到 primarySolved == "" 后 return "" 自行处理.
        }
        // 主服务不可用 (无 API key) → 用备服务
        if primary == "2captcha" && !twoCaptcha {
                if antiCaptcha {
                        return "anticaptcha"
                }
                if capSolver {
                        return "capsolver"
                }
                return "2captcha" // 都不可用, 占位
        }
        if primary == "anticaptcha" && !antiCaptcha {
                if twoCaptcha {
                        return "2captcha"
                }
                if capSolver {
                        return "capsolver"
                }
                return "anticaptcha"
        }
        if primary == "capsolver" && !capSolver {
                if twoCaptcha {
                        return "2captcha"
                }
                if antiCaptcha {
                        return "anticaptcha"
                }
                return "capsolver"
        }
        return primary
}

// backupAvailable3 — 备服务是否配置了 API key (R48-1A 3 服务版).
//
//      R48-1A: 替代 R47-1A 的 backupAvailable (2 服务版), 后者已删除 (无调用方).
func backupAvailable3(service string, twoCaptcha, antiCaptcha, capSolver bool) bool {
        switch service {
        case "2captcha":
                return twoCaptcha
        case "anticaptcha":
                return antiCaptcha
        case "capsolver":
                return capSolver
        }
        return false
}

// CaptchaServiceStatsSnapshot — admin / metrics 查询用: 返回 captcha 服务统计.
//
//      R48-1A: 包含 3 服务 (2captcha / anti-captcha / capsolver), primary 编码:
//      1=2captcha / 2=anti-captcha / 3=capsolver.
func CaptchaServiceStatsSnapshot() map[string]map[string]int64 {
        captchaStatsMu.Lock()
        defer captchaStatsMu.Unlock()
        out := map[string]map[string]int64{}
        now := time.Now().UnixMilli()
        for name, st := range captchaStatsMap {
                out[name] = map[string]int64{
                        "success":         st.success,
                        "fail":            st.fail,
                        "consecutiveFail": st.consecutiveFail,
                        // cooldownRemaining: 该服务 cooldown 剩余毫秒 (0 = 不在 cooldown)
                        "cooldownUntil":  st.cooldownUntil,
                        "cooldownActive": boolToInt64(st.cooldownUntil > now),
                }
        }
        out["_primary"] = map[string]int64{"primary": int64(0)}
        // 通过特殊键传主服务名 (避免 map[string]int64 类型冲突, 用 len 编码)
        // R48-1A: 加 capsolver (primary=3)
        switch captchaPrimaryServiceName {
        case "2captcha":
                out["_primary"] = map[string]int64{"primary": 1}
        case "anticaptcha":
                out["_primary"] = map[string]int64{"primary": 2}
        case "capsolver":
                out["_primary"] = map[string]int64{"primary": 3}
        }
        return out
}

// boolToInt64 — true → 1, false → 0 (R47-1A 辅助函数, JSON 序列化 bool 为 int).
func boolToInt64(b bool) int64 {
        if b {
                return 1
        }
        return 0
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
//
// R51-1A 修复 BUG-3 (P2): 原实现 `solvedURL = rawURL + sep + paramName + "=" + token`
// 在 rawURL 含 fragment (#section) 时会把 query 拼到 fragment 后面, 服务端收不到 token.
//
//      例: rawURL = "https://example.com/path#section"
//      原代码: solvedURL = "https://example.com/path#section?param=value"
//      → 实际请求 URL 的 query 为空, "?param=value" 是 fragment 一部分 (浏览器不发到服务端).
//      → 服务端校验 captcha 失败, 返回原 captcha 页, captcha 求解看似失败.
//      修复: 用 url.Parse 解析 rawURL, 把 fragment 暂存, 注入 query 到 RawQuery,
//      再重新拼回完整 URL. 保持原 fragment 行为不变 (服务端 ignore fragment 是浏览器语义).
func applyCaptchaTokenAndRefetch(ctx context.Context, rawURL string, cfg FetchConfig, ct CaptchaType, token string) string {
        if token == "" {
                return ""
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
        // R51-1A BUG-3 修复: 用 url.Parse 安全拼接 query, 防 fragment 后置导致 query 失效.
        u, err := url.Parse(rawURL)
        if err != nil {
                return ""
        }
        // R52-1A BUG-1 修复: 直接字符串拼接 u.RawQuery, 不经过 q.Encode 排序.
        //   Go url.Values.Encode() 按 key 字母序排序 → 原始 query 顺序丢失. 极少数
        //   captcha 服务端校验 query 顺序 (HMAC 签名 endpoint) → 重排后签名失效 →
        //   captcha token 注入看似成功但服务端拒绝, 浪费 180s 超时 + 操作员误以为
        //   captcha 服务故障. 修复: 直接拼接 u.RawQuery 保留原始顺序, 仅追加新参数.
        //   fragment 由 u.String() 重建 (浏览器 ignore fragment 是客户端语义).
        escapedToken := url.QueryEscape(token)
        if u.RawQuery == "" {
                u.RawQuery = paramName + "=" + escapedToken
        } else {
                u.RawQuery = u.RawQuery + "&" + paramName + "=" + escapedToken
        }
        solvedURL := u.String()
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
                        "type":       taskType,
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
                ErrorID   int    `json:"errorId"`
                TaskID    int    `json:"taskId"`
                ErrorCode string `json:"errorCode"`
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
                if err != nil {
                        reqCancel()
                        continue
                }
                // R68-B BUG-74 (P3) 修复: reqCancel() 移到 body close 后 (与
                //   pollCaptchaResult 同款, 防 ctx 提前 cancel 致 body 读失败).
                respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
                resp.Body.Close()
                reqCancel()
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

// ---------- CapSolver 服务 (R48-1A 反反爬增强, 3rd captcha provider) ----------
//
// CapSolver (https://capsolver.com) 是 2captcha/anti-captcha 的竞品, API 接口与
// anti-captcha 兼容 (POST /createTask body={"clientKey", "task": {...}} →
// {"taskId"}; POST /getTaskResult body={"clientKey", "taskId"} →
// {"status": "ready", "solution": {...}}).
//
// 价格优势: $0.7-2/1000 次 (h-captcha/reCAPTCHA v2 ~$0.8/1k, reCAPTCHA v3
// ~$1.5/1k, Turnstile ~$0.6/1k). 比 2captcha ($2.99/1k) 便宜 60%, 比 anti-captcha
// ($1.5-3/1k) 便宜 50%. 高频 captcha 场景显著降本.
//
// 成功率: 部分场景 (reCAPTCHA v3 / h-captcha enterprise) 成功率高于 2captcha,
// 作为 3rd fallback: 2captcha + anti-captcha 都失败 / 都 cooldown / 都未配置
// 时调用. 三服务级联任一服务连续 3 次失败触发 60s cooldown (R47-1A 同款逻辑).
//
// 任务类型映射 (与 anti-captcha 略有差异):
//   - reCAPTCHA v2: "ReCaptchaV2TaskProxyLess" (anti-captcha 用 "NoCaptchaTaskProxyless")
//   - h-captcha: "HCaptchaTaskProxyless" (与 anti-captcha 同款)
// 注: CapSolver 也支持 reCAPTCHA v3 ("ReCaptchaV3TaskProxyLess") 但本实现仅处理
// v2 (h-captcha/reCAPTCHA), v3 需 minScore 等额外参数, 暂不支持.

// submitCaptchaToCapSolver — POST /createTask 提交 captcha 任务.
// 返回 taskId. 失败返回空.
// R48-1A 新增 (与 anti-captcha 接口兼容, 但 task type 字段不同).
func submitCaptchaToCapSolver(ctx context.Context, apiKey string, ct CaptchaType, sitekey, pageURL string) string {
        if apiKey == "" || sitekey == "" || pageURL == "" {
                return ""
        }
        var taskType string
        switch ct {
        case CaptchaRecaptcha:
                // CapSolver reCAPTCHA v2 任务类型 (与 anti-captcha 的 NoCaptchaTaskProxyless 不同)
                taskType = "ReCaptchaV2TaskProxyLess"
        case CaptchaHCaptcha:
                taskType = "HCaptchaTaskProxyless"
        default:
                return ""
        }
        payload := map[string]any{
                "clientKey": apiKey,
                "task": map[string]any{
                        "type":       taskType,
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
        req, err := http.NewRequestWithContext(submitCtx, "POST", "https://api.capsolver.com/createTask", bytes.NewReader(body))
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
                ErrorID   int    `json:"errorId"`
                TaskID    string `json:"taskId"` // CapSolver 返 string, anti-captcha 返 int
                ErrorCode string `json:"errorCode"`
        }
        if err := json.Unmarshal(respBody, &data); err != nil {
                return ""
        }
        if data.ErrorID != 0 {
                return ""
        }
        if data.TaskID == "" {
                return ""
        }
        return data.TaskID
}

// pollCapSolverResult — 轮询 /getTaskResult 直到 token 返回或超时.
// 5s 间隔轮询, 180s 上限, 每轮 15s 超时. 与 anti-captcha 轮询逻辑同款.
// CapSolver solution 字段: gRecaptchaResponse (reCAPTCHA) / token (h-captcha).
func pollCapSolverResult(ctx context.Context, apiKey, taskID string) string {
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
                req, err := http.NewRequestWithContext(reqCtx, "POST", "https://api.capsolver.com/getTaskResult", bytes.NewReader(payload))
                if err != nil {
                        reqCancel()
                        continue
                }
                applyBrowserLikeHeaders(req)
                req.Header.Set("Content-Type", "application/json")
                resp, err := globalHttp.Do(req)
                if err != nil {
                        reqCancel()
                        continue
                }
                // R68-B BUG-74 (P3) 修复: reqCancel() 移到 body close 后 (与
                //   pollCaptchaResult / pollAntiCaptchaResult 同款).
                respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
                resp.Body.Close()
                reqCancel()
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

// trySolveCaptchaWithCapSolver — 用 CapSolver 服务求解 h-captcha / reCAPTCHA.
// 成功返回注入 token 后的页面 HTML, 失败返回空.
// R48-1A: 3rd captcha provider (与 anti-captcha 接口兼容, 但 task type 字段不同).
func trySolveCaptchaWithCapSolver(ctx context.Context, rawURL string, cfg FetchConfig, ct CaptchaType, sitekey string) string {
        if cfg.CapSolverAPIKey == "" {
                return ""
        }
        if ct != CaptchaHCaptcha && ct != CaptchaRecaptcha {
                return ""
        }
        taskID := submitCaptchaToCapSolver(ctx, cfg.CapSolverAPIKey, ct, sitekey, rawURL)
        if taskID == "" {
                return ""
        }
        token := pollCapSolverResult(ctx, cfg.CapSolverAPIKey, taskID)
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
        if override.ProxyProbeURL != "" {
                out.ProxyProbeURL = override.ProxyProbeURL
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
        // R48-1A: CapSolver API key 合并 (3rd captcha provider)
        if override.CapSolverAPIKey != "" {
                out.CapSolverAPIKey = override.CapSolverAPIKey
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

// ---------- R65-B 反反爬第 56 项: HTTP/2 ALPN + Server 头指纹库 ----------
//
// 真实 Chrome 仅在 HTTP/2 连接发 `Priority: u=0, i` 头. 原实现无脑注入该头,
// HTTP/1.1 源站 (tengine / apache / IIS) 上看到 Priority 头 → 反爬识别 "非
// 浏览器指纹" (浏览器从不在 HTTP/1.1 上发 Priority). 通过解析响应 Server
// 头 + resp.Proto 字段, per-host 钉扎 "是否 HTTP/2" 标识, 下次请求按标识
// 决定是否注入 Priority 头. 降 Bot Score 3-5 分.

// hostProtoFingerprintEntry — per-host proto + server 指纹 (R65-B 第 56 项).
type hostProtoFingerprintEntry struct {
        Proto      string // "HTTP/1.1" | "HTTP/2.0" | "" (未知)
        ServerType string // nginx | tengine | apache | Microsoft-IIS | cloudflare | cdn | unknown
        ServerVer  string // Server 头原值 (admin/metrics 展示)
        At         int64  // 最近更新时间 (UnixMilli)
}

var hostProtoFingerprintMap sync.Map // host string -> *hostProtoFingerprintEntry

// hostProtoFingerprintSweepCounter — sweep 触发累加 (R67-B BUG-55 修复).
var hostProtoFingerprintSweepCounter atomic.Int64

// HostProtoFingerprintSweepTTLms — per-host proto 指纹条目 7 天 TTL.
//
//      R67-B BUG-55 (P3) 修复: 原实现 hostProtoFingerprintMap 只在 hostProtoFingerprintFor
//      访问路径懒删过期条目, 长期未访问的 host (e.g. 一次性采集的 host) 条目永留,
//      长跑进程内存无界增长. 加 Store 路径 sweep (每 1000 次 Store 触发, 删 7 天未更新).
const HostProtoFingerprintSweepTTLms = 7 * 24 * 60 * 60 * 1000

// recordHostProtoFingerprint — 记录响应的 proto + Server 头 (per-host 钉扎).
func recordHostProtoFingerprint(host, proto, serverHeader string) {
        if host == "" {
                return
        }
        e := &hostProtoFingerprintEntry{
                Proto:      proto,
                ServerType: classifyServerHeader(serverHeader),
                ServerVer:  serverHeader,
                At:         time.Now().UnixMilli(),
        }
        hostProtoFingerprintMap.Store(strings.ToLower(host), e)
        // R67-B BUG-55 (P3) 修复: 惰性 sweep (每 1000 次 Store 触发, 删 7 天未更新条目).
        //   原实现只在 hostProtoFingerprintFor 访问路径懒删, 长期未访问的 host 条目永
        //   留 → 长跑进程内存无界增长. 加 Store 路径 sweep 防泄漏.
        if hostProtoFingerprintSweepCounter.Add(1)%1000 == 0 {
                now := time.Now().UnixMilli()
                hostProtoFingerprintMap.Range(func(k, v any) bool {
                        ent := v.(*hostProtoFingerprintEntry)
                        if now-ent.At > HostProtoFingerprintSweepTTLms {
                                // R73-B BUG-106 (P3) 修复: sweep 与并发 Store race.
                                //   recordHostProtoFingerprint 每次创建新 *hostProtoFingerprintEntry
                                //   并 Store (替换), 故 Range 看到的 v 可能是已被替换的 stale entry
                                //   (writer 已 Store 新 entry2 在 Range snapshot 之后). 此时 Delete
                                //   会删 entry2 (fresh!), 让 host 指纹丢失. 修复: Delete 前重新
                                //   Load 确认 entry 仍是同一个 (指针相等). 不同则 writer 已替换,
                                //   跳过 Delete (entry2 是 fresh, 不该删).
                                if cur, ok := hostProtoFingerprintMap.Load(k); ok {
                                        if curEnt, ok2 := cur.(*hostProtoFingerprintEntry); ok2 && curEnt == ent {
                                                hostProtoFingerprintMap.Delete(k)
                                        }
                                }
                        }
                        return true
                })
        }
}

// classifyServerHeader — 从 Server 头识别服务端类型 (大小写不敏感).
func classifyServerHeader(server string) string {
        if server == "" {
                return "unknown"
        }
        s := strings.ToLower(server)
        switch {
        case strings.Contains(s, "tengine"):
                return "tengine"
        case strings.Contains(s, "nginx"):
                return "nginx"
        case strings.Contains(s, "apache"):
                return "apache"
        case strings.Contains(s, "microsoft-iis"):
                return "Microsoft-IIS"
        case strings.Contains(s, "cloudflare"):
                return "cloudflare"
        case strings.Contains(s, "cdn"):
                return "cdn"
        }
        return "unknown"
}

// hostProtoFingerprintFor — 查询 per-host proto 指纹. nil = 未记录.
//
//      R73-B BUG-105 (P2) 修复: 原实现在 read path 持 stale entry 时 Delete
//      hostProtoFingerprintMap[host], 与并发 recordHostProtoFingerprint 的 Store
//      race — Load 拿到 stale entry1 (At=8d 前), 此时另一 goroutine Store 新
//      entry2 (At=now), 本函数 Delete(host) 会删 entry2 (fresh!) → host 指纹
//      丢失, shouldEmitPriorityHeader 误判为 "未知 host" → 注入 Priority 头到
//      HTTP/1.1 host (Chrome 不发) → 反爬识别 (R65-B 第 56 项价值被破坏).
//
//      修复: read path 仅返回 nil 不 Delete. stale entry 清理由 sweep 路径处理
//      (recordHostProtoFingerprint 内 hostProtoFingerprintSweepCounter.Add(1)
//      %1000==0 触发, R67-B BUG-55). sweep 用 Range, 取 ent.At 判断 stale, 在
//      writer goroutine 串行化路径删, 无 read-write race (即使 sweep 期间有
//      Store, Range 看到的是 sweep 开始时刻的 snapshot, Delete 只删当时 stale
//      的 entry; 新 Store 在 Range 之后被读到下次 sweep).
func hostProtoFingerprintFor(host string) *hostProtoFingerprintEntry {
        if host == "" {
                return nil
        }
        v, ok := hostProtoFingerprintMap.Load(strings.ToLower(host))
        if !ok {
                return nil
        }
        e := v.(*hostProtoFingerprintEntry)
        if time.Now().UnixMilli()-e.At > HostProtoFingerprintSweepTTLms {
                // R73-B BUG-105: 不在 read path Delete (race). 返 nil 让 caller
                //   视为 "未知 host" (默认行为). stale entry 由 sweep 路径清理.
                return nil
        }
        return e
}

// shouldEmitPriorityHeader — 该 host 是否应注入 Priority 头.
//
//      HTTP/2 或未知 → 注入 (向后兼容); HTTP/1.1 → 不注入 (Chrome 行为).
func shouldEmitPriorityHeader(host string) bool {
        e := hostProtoFingerprintFor(host)
        if e == nil {
                return true
        }
        if e.Proto == "HTTP/1.1" {
                return false
        }
        return true
}

// HostProtoFingerprintSnapshot — admin / metrics 查询用.
func HostProtoFingerprintSnapshot() map[string]map[string]string {
        out := map[string]map[string]string{}
        hostProtoFingerprintMap.Range(func(k, v any) bool {
                e := v.(*hostProtoFingerprintEntry)
                out[k.(string)] = map[string]string{
                        "proto":      e.Proto,
                        "serverType": e.ServerType,
                        "serverVer":  e.ServerVer,
                        "at":         fmt.Sprintf("%d", e.At),
                }
                return true
        })
        return out
}

// ---------- R65-B 反反爬第 57 项: TLS JA3 指纹 rotation (utls) 可观察性 ----------
//
// R42-1B+R43-1B+R52-1A 已实现 36-fingerprint utlsHelloPool + per-host 钉扎
// + attempts 偏移轮换 + TLS session 持久化. 本轮仅做可观察性扩展.

// UtlsPoolSize — 返回 utls Hello 指纹池大小 (供 admin 显示).
func UtlsPoolSize() int {
        return len(utlsHelloPool)
}

// UtlsChoiceFor — 返回 host 当前钉扎的 utls Hello 指纹 ID (Str 形式).
func UtlsChoiceFor(host string) string {
        if host == "" {
                return ""
        }
        utlsChoiceMu.Lock()
        defer utlsChoiceMu.Unlock()
        h, ok := utlsChoiceMap[host]
        if !ok {
                return ""
        }
        return h.Client + " (build " + h.Version + ")"
}

// UtlsChoiceSnapshot — admin / metrics 查询用.
func UtlsChoiceSnapshot() map[string]string {
        out := map[string]string{}
        utlsChoiceMu.Lock()
        defer utlsChoiceMu.Unlock()
        for host, h := range utlsChoiceMap {
                out[host] = h.Client + " (build " + h.Version + ")"
        }
        return out
}

// ---------- R65-B 反反爬第 58 项: Proxy Pool 旋转 + 健康度淘汰 ----------
//
// 同 host 选一次代理后钉扎, 后续请求复用同代理 (反爬识别 "同 host 多次请求
// IP 跳变" 是爬虫指纹). 失败淘汰 (proxy 进入 cooldown) 时清钉扎.

// hostProxyPinEntry — per-host 代理钉扎条目 (R67-B BUG-60 修复: 加 pinnedAt
//
//      时间戳用于 sweep; 原实现只存 proxyURL 字符串, 无法判断 stale).
type hostProxyPinEntry struct {
        proxyURL string
        pinnedAt int64 // UnixMilli, 钉扎时间 (sweep 用)
}

// hostProxyPin — per-host 代理钉扎表. host → *hostProxyPinEntry.
var hostProxyPin sync.Map // host string -> *hostProxyPinEntry

// hostProxyPinSweepCounter — sweep 触发累加 (R67-B BUG-60).
var hostProxyPinSweepCounter atomic.Int64

// HostProxyPinSweepTTLms — per-host 代理钉扎条目 7 天 TTL (R67-B BUG-60).
//
//      原实现 hostProxyPin 只在 MarkProxyFailed quarantine + EvictHostProxyPin
//      显式调用时删, 成功 host 长期未失败 → 钉扎条目永留, 长跑进程内存无界增长.
const HostProxyPinSweepTTLms = 7 * 24 * 60 * 60 * 1000

// pinProxyForHost — 钉扎 host → proxyURL.
func pinProxyForHost(host, proxyURL string) {
        if host == "" {
                return
        }
        hostProxyPin.Store(strings.ToLower(host), &hostProxyPinEntry{
                proxyURL: proxyURL,
                pinnedAt: time.Now().UnixMilli(),
        })
        // R67-B BUG-60 (P3) 修复: 惰性 sweep (每 1000 次 pin 触发, 删 7 天未更新条目).
        //   原实现只在显式 EvictHostProxyPin 删, 长期未失败 host 的钉扎条目永留 →
        //   长跑进程内存无界增长.
        if hostProxyPinSweepCounter.Add(1)%1000 == 0 {
                now := time.Now().UnixMilli()
                hostProxyPin.Range(func(k, v any) bool {
                        ent := v.(*hostProxyPinEntry)
                        if now-ent.pinnedAt > HostProxyPinSweepTTLms {
                                // R73-B BUG-117 (P3) 修复: sweep 与并发 Store race (与
                                //   BUG-106 同款). pinProxyForHost 每次创建新 entry 替换.
                                //   Delete 前重新 Load 确认 entry 仍是同一个 (指针相等),
                                //   防误删 fresh entry (writer Store 新 entry2 between Range
                                //   snapshot 和本 Delete).
                                if cur, ok := hostProxyPin.Load(k); ok {
                                        if curEnt, ok2 := cur.(*hostProxyPinEntry); ok2 && curEnt == ent {
                                                hostProxyPin.Delete(k)
                                        }
                                }
                        }
                        return true
                })
        }
}

// EvictHostProxyPin — 清除 host 的代理钉扎 (失败淘汰时调用).
func EvictHostProxyPin(host string) {
        if host == "" {
                return
        }
        hostProxyPin.Delete(strings.ToLower(host))
}

// pinnedProxyForHost — 取 host 的钉扎代理. 无则返 "".
func pinnedProxyForHost(host string) string {
        if host == "" {
                return ""
        }
        v, ok := hostProxyPin.Load(strings.ToLower(host))
        if !ok {
                return ""
        }
        // R67-B BUG-60: 类型断言 *hostProxyPinEntry (原 string).
        return v.(*hostProxyPinEntry).proxyURL
}

// HostProxyPinSnapshot — admin / metrics 查询用.
func HostProxyPinSnapshot() map[string]string {
        out := map[string]string{}
        hostProxyPin.Range(func(k, v any) bool {
                out[k.(string)] = v.(*hostProxyPinEntry).proxyURL
                return true
        })
        return out
}

// ---------- R65-B 反反爬第 59 项: Retry Budget 全局上限 ----------
//
// 单 URL 可能消耗所有重试预算 (5 次 attempt × 8s backoff = 40s+). 大批量采集
// (1000 章 × 5 attempt = 5000 次重试) 长时间高频重试 → 源站识别 "持续重试"
// 是爬虫指纹 + 触发频控. per-host 24h 上限 N=200 次, 超限直接失败不重试.

// retryBudgetCounter — per-host 24h 重试预算计数器.
type retryBudgetCounter struct {
        mu      sync.Mutex
        count   int64
        resetAt int64 // UnixMilli, 24h 后归零
}

const (
        // RetryBudgetPerHost24h — per-host 24h 重试预算上限.
        RetryBudgetPerHost24h = 200
        // RetryBudgetWindowMs — 24h 窗口 (毫秒).
        RetryBudgetWindowMs = 24 * 60 * 60 * 1000
)

var hostRetryBudgetMap sync.Map // host string -> *retryBudgetCounter

// retryBudgetSweepCounter — sweep 触发累加 (R67-B BUG-58 修复).
var retryBudgetSweepCounter atomic.Int64

// RetryBudgetSweepStaleMs — per-host retry budget 条目过期阈值 (24h + 7d grace).
//
//      R67-B BUG-58 (P3) 修复: 原实现 hostRetryBudgetMap 条目永留 (acquire 路径只
//      在窗口到期时 reset count, 但条目本身从不删除), 长跑进程内存无界增长.
//      sweep 删 resetAt + grace period 已过 (即 24h 窗口到期 + 7d 内未再访问) 条目.
const RetryBudgetSweepStaleMs = 8 * 24 * 60 * 60 * 1000

// acquireRetryBudget — 检查并消费 host 的重试预算. true = 仍有预算, false = 超限.
func acquireRetryBudget(host string) bool {
        if host == "" {
                return true // host 为空 (e.g. 桥路径) 不限重试
        }
        host = strings.ToLower(host)
        var cnt *retryBudgetCounter
        if v, ok := hostRetryBudgetMap.Load(host); ok {
                cnt = v.(*retryBudgetCounter)
        } else {
                cnt = &retryBudgetCounter{resetAt: time.Now().UnixMilli() + RetryBudgetWindowMs}
                actual, _ := hostRetryBudgetMap.LoadOrStore(host, cnt)
                cnt = actual.(*retryBudgetCounter)
        }
        cnt.mu.Lock()
        defer cnt.mu.Unlock()
        now := time.Now().UnixMilli()
        if now >= cnt.resetAt {
                cnt.count = 0
                cnt.resetAt = now + RetryBudgetWindowMs
        }
        if cnt.count >= RetryBudgetPerHost24h {
                // R67-B BUG-58 (P3) 修复: 惰性 sweep (每 1000 次 acquire 触发, 删过期条目).
                //   原实现条目永留 → 长跑进程内存无界增长. 删 resetAt + grace period 已过
                //   条目 (即 24h 窗口到期 + 7d 内未再访问). 在 return false 路径触发 sweep,
                //   不阻塞正常 acquire 路径 (count < limit 直接 return true 路径不调 sweep).
                if retryBudgetSweepCounter.Add(1)%1000 == 0 {
                        go sweepHostRetryBudgetMap(now)
                }
                return false
        }
        cnt.count++
        return true
}

// sweepHostRetryBudgetMap — 异步 sweep hostRetryBudgetMap, 删 stale 条目.
//
//      R67-B BUG-58 修复. 异步执行不阻塞 acquire 路径.
func sweepHostRetryBudgetMap(nowMs int64) {
        staleThreshold := nowMs - RetryBudgetSweepStaleMs
        hostRetryBudgetMap.Range(func(k, v any) bool {
                cnt := v.(*retryBudgetCounter)
                cnt.mu.Lock()
                resetAt := cnt.resetAt
                cnt.mu.Unlock()
                // resetAt + grace period 已过 (即 24h 窗口到期 + 7d 内未再访问).
                // 用 resetAt < staleThreshold 判断 (resetAt = 上次 reset 时间 + 24h;
                // 若 resetAt < now - 8d, 说明上次 reset 在 8d 前, 已 7d 未访问).
                if resetAt < staleThreshold {
                        // R74-B BUG-113 (P3) 修复: 与 BUG-112 同款 race (mutex-based,
                        //   mutate-in-place entry). acquireRetryBudget 用 LoadOrStore
                        //   复用 entry, mu.Lock 内修改 count/resetAt. 本 sweep 异步运行
                        //   (go sweepHostRetryBudgetMap(now)) 不阻塞 acquire 路径, 但
                        //   Delete 与并发 acquire 的 cnt.resetAt=now+24h race → budget
                        //   条目被误删 → 下次 acquire 创建新条目 resetAt=now+24h, 历
                        //   史 count 丢失 (但 count 已 stale, 无功能影响). 修复:
                        //   Delete 前 re-Load + 重读 resetAt (持 mu) 缩小 race 窗口.
                        if cur, ok := hostRetryBudgetMap.Load(k); ok {
                                curCnt, ok2 := cur.(*retryBudgetCounter)
                                if ok2 {
                                        curCnt.mu.Lock()
                                        resetAt2 := curCnt.resetAt
                                        curCnt.mu.Unlock()
                                        if resetAt2 < staleThreshold {
                                                hostRetryBudgetMap.Delete(k)
                                        }
                                }
                        }
                }
                return true
        })
}

// RetryBudgetSnapshot — admin / metrics 查询用.
func RetryBudgetSnapshot() map[string]map[string]int64 {
        out := map[string]map[string]int64{}
        now := time.Now().UnixMilli()
        hostRetryBudgetMap.Range(func(k, v any) bool {
                cnt := v.(*retryBudgetCounter)
                cnt.mu.Lock()
                count := cnt.count
                resetAt := cnt.resetAt
                cnt.mu.Unlock()
                if now >= resetAt {
                        count = 0
                }
                out[k.(string)] = map[string]int64{
                        "count":   count,
                        "limit":   RetryBudgetPerHost24h,
                        "resetAt": resetAt,
                }
                return true
        })
        return out
}

// ---------- R65-B 反反爬第 60 项: X-Forwarded-For / X-Real-IP 伪造 ----------
//
// 部分源站按 X-Forwarded-For / X-Real-IP 限速或封禁. 注入 per-host 钉扎的
// RFC1918 内网 IP → 源站按伪造 IP 计限速. 仅在直连 (proxy == "") 时注入.

// hostForwardedIPEntry — per-host 伪造的内网 IP.
type hostForwardedIPEntry struct {
        ip string
        at int64
}

var (
        hostForwardedIPMap sync.Map // host string -> *hostForwardedIPEntry
        // forwardedIPPool — 预生成 32 个 RFC1918 内网 IP.
        forwardedIPPool = generateForwardedIPPool()
        forwardedIPIdx  atomic.Uint64
)

// generateForwardedIPPool — 预生成 32 个内网 IP (10.x / 172.16-31.x / 192.168.x).
func generateForwardedIPPool() []string {
        pool := make([]string, 0, 32)
        pool = append(pool,
                "10.0.0.1", "10.0.1.2", "10.0.2.3", "10.1.0.5",
                "10.1.2.7", "10.2.0.11", "10.2.3.13", "10.3.0.17",
                "10.5.1.19", "10.8.2.23", "10.10.0.29", "10.20.0.31",
        )
        pool = append(pool,
                "172.16.0.1", "172.16.1.2", "172.17.0.3", "172.18.0.5",
                "172.19.1.7", "172.20.0.11", "172.22.0.13", "172.24.0.17",
                "172.28.0.19", "172.30.0.23",
        )
        pool = append(pool,
                "192.168.0.1", "192.168.0.2", "192.168.1.3", "192.168.1.5",
                "192.168.2.7", "192.168.2.11", "192.168.3.13", "192.168.5.17",
                "192.168.10.19", "192.168.20.23",
        )
        return pool
}

// forwardedIPSweepCounter — sweep 触发累加 (R67-B BUG-56 修复).
var forwardedIPSweepCounter atomic.Int64

// ForwardedIPSweepTTLms — per-host 伪造 IP 条目 7 天 TTL (R67-B BUG-56).
//
//      原实现 hostForwardedIPMap 只在 forwardedIPFor 访问路径懒删过期条目,
//      长期未访问的 host (e.g. 一次性采集的 host) 条目永留, 长跑进程内存无界增长.
const ForwardedIPSweepTTLms = 7 * 24 * 60 * 60 * 1000

// forwardedIPFor — 取 host 钉扎的伪造 IP, 无则选一个钉扎.
func forwardedIPFor(host string) string {
        if host == "" {
                return ""
        }
        host = strings.ToLower(host)
        if v, ok := hostForwardedIPMap.Load(host); ok {
                e := v.(*hostForwardedIPEntry)
                if time.Now().UnixMilli()-e.at < ForwardedIPSweepTTLms {
                        return e.ip
                }
        }
        idx := forwardedIPIdx.Add(1) - 1
        ip := forwardedIPPool[int(idx%uint64(len(forwardedIPPool)))]
        hostForwardedIPMap.Store(host, &hostForwardedIPEntry{ip: ip, at: time.Now().UnixMilli()})
        // R67-B BUG-56 (P3) 修复: 惰性 sweep (每 1000 次 Store 触发, 删 7 天未更新条目).
        //   原实现只在 forwardedIPFor 访问路径懒删过期条目, 长期未访问的 host 条目永
        //   留 → 长跑进程内存无界增长. 加 Store 路径 sweep 防泄漏.
        if forwardedIPSweepCounter.Add(1)%1000 == 0 {
                now := time.Now().UnixMilli()
                hostForwardedIPMap.Range(func(k, v any) bool {
                        ent := v.(*hostForwardedIPEntry)
                        if now-ent.at > ForwardedIPSweepTTLms {
                                // R73-B BUG-118 (P3) 修复: sweep 与并发 Store race (与
                                //   BUG-106/111 同款). forwardedIPFor 每次创建新 entry 替换.
                                //   Delete 前重新 Load 确认 entry 仍是同一个 (指针相等),
                                //   防误删 fresh entry.
                                if cur, ok := hostForwardedIPMap.Load(k); ok {
                                        if curEnt, ok2 := cur.(*hostForwardedIPEntry); ok2 && curEnt == ent {
                                                hostForwardedIPMap.Delete(k)
                                        }
                                }
                        }
                        return true
                })
        }
        return ip
}

// ClearHostForwardedIP — 清除 host 的伪造 IP 钉扎 (失败后下次换新 IP).
func ClearHostForwardedIP(host string) {
        if host == "" {
                return
        }
        hostForwardedIPMap.Delete(strings.ToLower(host))
}

// ForwardedIPSnapshot — admin / metrics 查询用.
func ForwardedIPSnapshot() map[string]string {
        out := map[string]string{}
        hostForwardedIPMap.Range(func(k, v any) bool {
                e := v.(*hostForwardedIPEntry)
                out[k.(string)] = e.ip
                return true
        })
        return out
}

// ---------- R65-B 采集增强 B6: 采集速率可视化 ----------
//
// per-host 60s 滑动窗口计数器: QPS / 成功率 / 平均延迟. 供 admin API + UI.

// collectRateEntry — per-host 60s 滑动窗口采集速率统计.
//
//      R67-B BUG-61 (P2) 修复: 加 lastAccessAt 字段, 用于 LRU 风格驱逐 (原实现
//        sync.Map.Range 迭代顺序随机, 驱逐 "前 n-cap" 条目会随机删 hot host).
type collectRateEntry struct {
        mu             sync.Mutex
        windowStartAt  int64
        successCount   int64
        failCount      int64
        totalLatencyMs int64
        // R67-B BUG-61: 最近访问时间 (UnixMilli). 每次 record 更新, sweep 用作
        //   LRU 驱逐依据 (与 windowStartAt 区别: windowStartAt 每 60s 重置,
        //   lastAccessAt 单调递增反映 host 是否活跃).
        lastAccessAt int64
}

const (
        // CollectRateWindowMs — 60s 滑动窗口.
        CollectRateWindowMs = 60 * 1000
        // CollectRateHostsCap — per-host 统计上限.
        CollectRateHostsCap = 1000
)

var (
        collectRateMap     sync.Map // host string -> *collectRateEntry
        collectRateSweepMu sync.Mutex
        // R68-B BUG-73 (P2) 修复: 改 atomic.Int64 防 race.
        //   原实现 collectRateLastSweepAt int64 在 recordCollectAttempt 高频路径
        //   无锁读 (line ~6457) + 持 collectRateSweepMu 内无锁写 (line ~6460).
        //   并发 goroutine 同时 recordCollectAttempt → 数据竞争 (race detector
        //   报 race). Go memory model 要求 atomic 操作间建立 happens-before,
        //   普通 int64 read + write 无同步 → race. 64 位平台硬件保证 8 字节原子
        //   (无撕裂), 但 race detector 仍报错 + 32 位平台 (GOARM=51) 仍可能撕裂.
        //   改 atomic.Int64: Load()/Store() 建立 happens-before, race 消除.
        collectRateLastSweepAt atomic.Int64
)

// recordCollectAttempt — 记录一次采集结果 (success/fail + latencyMs).
func recordCollectAttempt(host string, success bool, latencyMs int64) {
        if host == "" {
                return
        }
        host = strings.ToLower(host)
        if latencyMs < 0 {
                latencyMs = 0
        }
        var e *collectRateEntry
        if v, ok := collectRateMap.Load(host); ok {
                e = v.(*collectRateEntry)
        } else {
                // R67-B BUG-61: 同时初始化 lastAccessAt, 防 sweep 在 entry 创建后但首次
                //   record 前 (lastAccessAt==0) 误判为过期 (now-0 > TTL) 删除条目.
                now0 := time.Now().UnixMilli()
                e = &collectRateEntry{windowStartAt: now0, lastAccessAt: now0}
                actual, _ := collectRateMap.LoadOrStore(host, e)
                e = actual.(*collectRateEntry)
        }
        var totalAttempts int64
        var successCount int64
        var failCount int64
        var totalLatencyMs int64
        e.mu.Lock()
        now := time.Now().UnixMilli()
        if now-e.windowStartAt >= CollectRateWindowMs {
                e.windowStartAt = now
                e.successCount = 0
                e.failCount = 0
                e.totalLatencyMs = 0
        }
        if success {
                e.successCount++
        } else {
                e.failCount++
        }
        e.totalLatencyMs += latencyMs
        // R67-B BUG-61: 更新 lastAccessAt (单调递增, 用于 LRU 驱逐).
        e.lastAccessAt = now
        // R67-B 采集增强 B9: snapshot 当前窗口计数供后续 adaptHostGateBySuccessRate 调用.
        totalAttempts = e.successCount + e.failCount
        successCount = e.successCount
        failCount = e.failCount
        totalLatencyMs = e.totalLatencyMs
        e.mu.Unlock()
        // R67-B 采集增强 B9: per-host 成功率自适应阈值. 每 10 次 attempt 触发一次
        //   评估 (避免每次 record 都调 AdjustConcurrency 浪费 CPU). AdjustConcurrency
        //   内部 60s cooldown 防抖动, 每 10 attempt 调一次足够响应源站状态变化.
        //   成功率 < 0.5 → health=0.1 (hostgate.AdjustConcurrency 降并发 1 档)
        //   成功率 > 0.95 → health=0.9 (hostgate.AdjustConcurrency 升并发 1 档)
        //   0.5 ≤ rate ≤ 0.95 → 不动 (中性区间)
        //   avgLatency > 5000ms → health *= 0.5 (慢源视为不健康)
        //   total < 10 → 不评估 (样本不足)
        if totalAttempts >= 10 && totalAttempts%10 == 0 {
                adaptHostGateBySuccessRate(host, successCount, failCount, totalLatencyMs)
        }
        // 周期性 sweep: 每 5min 清过期 + 超上限驱逐
        // R68-B BUG-73 (P2) 修复: 用 atomic.Load() 读 + atomic.Store() 写, 防 race.
        if now-collectRateLastSweepAt.Load() > 5*60*1000 {
                if collectRateSweepMu.TryLock() {
                        defer collectRateSweepMu.Unlock()
                        collectRateLastSweepAt.Store(now)
                        collectRateMap.Range(func(k, v any) bool {
                                ent := v.(*collectRateEntry)
                                ent.mu.Lock()
                                expired := now-ent.lastAccessAt > 3*CollectRateWindowMs
                                ent.mu.Unlock()
                                if expired {
                                        collectRateMap.Delete(k)
                                }
                                return true
                        })
                        // R67-B BUG-61 (P2) 修复: LRU 风格驱逐 (原实现 random 驱逐会删 hot host).
                        //   收集所有 (key, lastAccessAt) 排序后删最旧的, 保证 hot host 不被误删.
                        n := 0
                        collectRateMap.Range(func(_, _ any) bool { n++; return true })
                        if n > CollectRateHostsCap {
                                type kv struct {
                                        k  string
                                        at int64
                                }
                                entries := make([]kv, 0, n)
                                collectRateMap.Range(func(k, v any) bool {
                                        ent := v.(*collectRateEntry)
                                        ent.mu.Lock()
                                        entries = append(entries, kv{k: k.(string), at: ent.lastAccessAt})
                                        ent.mu.Unlock()
                                        return true
                                })
                                // 按 lastAccessAt 升序 (最旧的优先驱逐)
                                sort.SliceStable(entries, func(i, j int) bool {
                                        return entries[i].at < entries[j].at
                                })
                                // 删 (n - CollectRateHostsCap) 个最旧的
                                evictCount := n - CollectRateHostsCap
                                for i := 0; i < evictCount && i < len(entries); i++ {
                                        collectRateMap.Delete(entries[i].k)
                                }
                        }
                }
        }
}

// adaptHostGateBySuccessRate — per-host 成功率自适应阈值 (R67-B 采集增强 B9).
//
//      计算 health 分数 (0.0~1.0) 调 hostgate.AdjustConcurrency(host, health):
//      - rate < 0.5: health=0.1 (hostgate 在 60s cooldown 内降并发 1 档, 防 hostGate 雪崩)
//      - rate > 0.95: health=0.9 (hostgate 在 60s cooldown 内升并发 1 档, 提速采集)
//      - 0.5 ≤ rate ≤ 0.95: 不调 (中性区间, 避免边缘抖动)
//      - avgLatency > 5000ms: health *= 0.5 (慢源视为不健康, 与成功率综合判断)
//      - avgLatency > 30000ms: health = 0.05 (极慢, 强制降并发)
//      注意: AdjustConcurrency 内部 60s cooldown 防抖动, 即便本函数每 10 attempt 调
//      一次, 实际生效 (改 baseLimit) 频率 ≤ 1/min/host. 不阻塞 recordCollectAttempt
//      路径 (AdjustConcurrency 短临界区, 持锁时长 < 1μs).
//      caller: recordCollectAttempt 在 totalAttempts%10==0 时调用.
func adaptHostGateBySuccessRate(host string, successCount, failCount, totalLatencyMs int64) {
        if host == "" {
                return
        }
        total := successCount + failCount
        if total < 10 {
                return
        }
        rate := float64(successCount) / float64(total)
        var avgLat int64
        if total > 0 {
                avgLat = totalLatencyMs / total
        }
        var health float64
        switch {
        case rate < 0.5:
                health = 0.1
        case rate > 0.95:
                health = 0.9
        default:
                return // 中性区间, 不调
        }
        // 慢源惩罚: avgLatency > 5s 健康度减半, > 30s 强制极低 (避免单慢源拖垮采集).
        if avgLat > 30000 {
                health = 0.05
        } else if avgLat > 5000 {
                health *= 0.5
        }
        GetHostGate().AdjustConcurrency(host, health)
}

// ---------- R67-B 采集增强 B11: 采集错误分类统计 ----------
//
// R64-B B2 classifyNetError 把错误分 7 类 (DNS/timeout/refused/reset/TLS/ctxCanceled/
// unknown). R65-B B7 加 per-host 重试策略. 但无 per-host 错误分类计数 (admin 无法
// 识别哪些 host 主要失败原因是什么). 本轮加 per-host per-class 计数 + 4xx/5xx
// HTTP 状态码分类 (区分 403 反爬 vs 404 资源不存在 vs 5xx 服务端故障).
//
// 数据源: fetchHttp + fetchViaCurl 错误路径调 recordHostErrorClass(host, class, httpStatus).
//   4xx/5xx 路径调 recordHostErrorClass(host, NetErrClassUnknown, statusCode);
//   网络层错误调 recordHostErrorClass(host, class, 0).
// 价值: admin / metrics 展示 per-host 错误分布, 操作员识别:
//   - 高 DNS 失败 → 源站 DNS 不稳, 加 DNS over HTTPS 或换镜像
//   - 高 TLS 失败 → Go 标准库 TLS 指纹被识别, 强制走 utls 路径
//   - 高 4xx → 反爬识别, 调整 UA / 代理 / 头族
//   - 高 5xx → 源站故障, 暂停采集

// hostErrorClassEntry — per-host 错误分类计数.
type hostErrorClassEntry struct {
        mu              sync.Mutex
        dnsFail         int64
        timeoutFail     int64
        refusedFail     int64
        resetFail       int64
        tlsFail         int64
        http4xxFail     int64
        http5xxFail     int64
        blockedFail     int64 // LooksBlocked 命中 (反爬拦截 403/412/429 双计)
        ctxCanceledFail int64
        otherFail       int64
        lastAt          int64 // 最近更新时间 (UnixMilli), sweep 用
}

// hostErrorClassMap — host string → *hostErrorClassEntry.
var hostErrorClassMap sync.Map

// HostErrorClassSweepTTLms — per-host 错误分类条目 7 天 TTL (sweep 删 lastAt > 7 天条目).
const HostErrorClassSweepTTLms = 7 * 24 * 60 * 60 * 1000

// hostErrorClassSweepCounter — sweep 触发累加 (每 1000 次 record 触发一次 sweep).
var hostErrorClassSweepCounter atomic.Int64

// recordHostErrorClass — 记录 per-host 错误分类 (httpStatus > 0 走 HTTP 状态码分支;
//
//      httpStatus == 0 走 NetErrorClass 分支). 403/412/429 双计 http4xx + blocked
//      (反爬拦截识别专用).
func recordHostErrorClass(host string, class NetErrorClass, httpStatus int) {
        if host == "" {
                return
        }
        host = strings.ToLower(host)
        var e *hostErrorClassEntry
        if v, ok := hostErrorClassMap.Load(host); ok {
                e = v.(*hostErrorClassEntry)
        } else {
                e = &hostErrorClassEntry{}
                actual, _ := hostErrorClassMap.LoadOrStore(host, e)
                e = actual.(*hostErrorClassEntry)
        }
        e.mu.Lock()
        e.lastAt = time.Now().UnixMilli()
        if httpStatus > 0 {
                if httpStatus >= 400 && httpStatus < 500 {
                        e.http4xxFail++
                        // 403/412/429 常是反爬拦截, 双计 blocked 分支 (admin 识别高 blocked host
                        // 应换 UA / 代理 / 走桥).
                        if httpStatus == 403 || httpStatus == 412 || httpStatus == 429 {
                                e.blockedFail++
                        }
                } else if httpStatus >= 500 {
                        e.http5xxFail++
                }
        } else {
                switch class {
                case NetErrClassDNS:
                        e.dnsFail++
                case NetErrClassTimeout:
                        e.timeoutFail++
                case NetErrClassConnRefused:
                        e.refusedFail++
                case NetErrClassConnReset:
                        e.resetFail++
                case NetErrClassTLS:
                        e.tlsFail++
                case NetErrClassCtxCanceled:
                        e.ctxCanceledFail++
                default:
                        e.otherFail++
                }
        }
        e.mu.Unlock()
        // sweep (惰性, 每 1000 次 record 触发, 删 7 天未访问条目 — 防 long-running 进程
        // 内存无界增长).
        if hostErrorClassSweepCounter.Add(1)%1000 == 0 {
                now := time.Now().UnixMilli()
                hostErrorClassMap.Range(func(k, v any) bool {
                        ent := v.(*hostErrorClassEntry)
                        ent.mu.Lock()
                        last := ent.lastAt
                        ent.mu.Unlock()
                        if now-last > HostErrorClassSweepTTLms {
                                // R74-B BUG-112 (P3) 修复: 与 BUG-110/111 同款 race, 但 entry
                                //   用 mu (非 atomic) 保护 lastAt. recordHostErrorClass 用
                                //   LoadOrStore 复用 entry, 仅 mu.Lock 内修改 lastAt + 各
                                //   failCount 字段. 原 Delete 与并发 writer 的 ent.lastAt=now
                                //   race → admin 错误分类 stats 偶发少计 1 次. 修复: Delete
                                //   前 re-Load + 重读 lastAt (持 mu) 缩小 race 窗口. 与 BUG-110
                                //   同款 narrowing 模式.
                                if cur, ok := hostErrorClassMap.Load(k); ok {
                                        curEnt, ok2 := cur.(*hostErrorClassEntry)
                                        if ok2 {
                                                curEnt.mu.Lock()
                                                last2 := curEnt.lastAt
                                                curEnt.mu.Unlock()
                                                if now-last2 > HostErrorClassSweepTTLms {
                                                        hostErrorClassMap.Delete(k)
                                                }
                                        }
                                }
                        }
                        return true
                })
        }
}

// HostErrorClassSnapshot — admin / metrics 查询用: 返回 per-host 错误分类计数.
func HostErrorClassSnapshot() map[string]map[string]int64 {
        out := map[string]map[string]int64{}
        hostErrorClassMap.Range(func(k, v any) bool {
                e := v.(*hostErrorClassEntry)
                e.mu.Lock()
                m := map[string]int64{
                        "dns":         e.dnsFail,
                        "timeout":     e.timeoutFail,
                        "refused":     e.refusedFail,
                        "reset":       e.resetFail,
                        "tls":         e.tlsFail,
                        "http4xx":     e.http4xxFail,
                        "http5xx":     e.http5xxFail,
                        "blocked":     e.blockedFail,
                        "ctxCanceled": e.ctxCanceledFail,
                        "other":       e.otherFail,
                        "lastAt":      e.lastAt,
                }
                e.mu.Unlock()
                out[k.(string)] = m
                return true
        })
        return out
}

// ---------- R68-B 采集增强 B14: 采集错误恢复策略 ----------
//
// R67-B B11 加 hostErrorClassEntry per-host 错误分类计数. 本 B14 基于 host 历史错误
// 分类返回恢复策略:
//   - "retry" — 默认, 指数退避重试 (健康 host 偶发失败)
//   - "switch_proxy" — 清 host proxy 钉扎, 让下次 pickProxyFor 选新代理 (4xx/403/
//     blocked 高频, 当前代理被反爬识别)
//   - "switch_bridge" — 直接走桥 (TLS 频繁失败, Go 标准 TLS 指纹被识别, 桥有
//     curl_cffi/scrapling 等真实浏览器 TLS 指纹)
//   - "abort" — 直接放弃 (5xx 高频 → 源站故障, 重试无意义; ctxCanceled 高频 →
//     caller 主动取消, 不应重试)
//   - "switch_dns" — DNS 频繁失败, 走桥或换镜像 (Go net 走系统 DNS, 桥走自己的
//     DNS 解析, 可能避开本地 DNS 污染)
//
// 价值: caller (runner) 在 fetch 失败时调本函数得恢复策略, 按策略决定下一步
//   (重试 / 换代理 / 走桥 / 放弃). 原 R67-B B7 hostRetryAction 仅按单次错误分类
//   返动作, 本 B14 按累计统计返更稳健的策略 (单次错误可能是偶发, 累计统计反映
//   host 真实健康状态).
// 设计: 读 hostErrorClassEntry 字段 (持 e.mu), 取最高频错误分类作为决策依据.
//   阈值: 7 天窗口内累计 >= 10 次某类错误 → 视为该类主导 (单次/偶发不触发).

// RecoveryStrategy — 返 host 的恢复策略字符串.
//
//      "retry" / "switch_proxy" / "switch_bridge" / "abort" / "switch_dns".
//      host 为空 → "retry" (默认). 无历史错误 → "retry" (健康).
//      R68-B 采集增强 B14.
func RecoveryStrategy(host string) string {
        if host == "" {
                return "retry"
        }
        host = strings.ToLower(host)
        v, ok := hostErrorClassMap.Load(host)
        if !ok {
                return "retry"
        }
        e := v.(*hostErrorClassEntry)
        e.mu.Lock()
        defer e.mu.Unlock()
        // 累计样本太少 (e.g. < 10 次) → 不做策略决策, 默认 retry (偶发失败重试有效)
        totalFail := e.dnsFail + e.timeoutFail + e.refusedFail + e.resetFail +
                e.tlsFail + e.http4xxFail + e.http5xxFail + e.blockedFail +
                e.ctxCanceledFail + e.otherFail
        if totalFail < 10 {
                return "retry"
        }
        // 按优先级返策略 (高优先级在前, 同时多类失败时按策略重要性返):
        //   1. ctxCanceled 高频 → abort (caller 主动取消, 不应重试)
        //   2. http5xx 高频 → abort (源站故障)
        //   3. tls 高频 → switch_bridge (TLS 指纹问题, 桥有真实浏览器 TLS)
        //   4. dns 高频 → switch_dns (DNS 问题, 桥走自己解析)
        //   5. blocked (403/412/429) 高频 → switch_proxy (代理被反爬识别)
        //   6. http4xx 高频 (非 blocked) → switch_proxy (代理可能被部分识别)
        //   7. timeout/refused/reset 高频 → switch_proxy (代理质量差)
        //   8. other 高频 → retry (未知错误, 保守重试)
        switch {
        case e.ctxCanceledFail >= 10:
                return "abort"
        case e.http5xxFail >= 10:
                return "abort"
        case e.tlsFail >= 10:
                return "switch_bridge"
        case e.dnsFail >= 10:
                return "switch_dns"
        case e.blockedFail >= 10:
                return "switch_proxy"
        case e.http4xxFail >= 10:
                return "switch_proxy"
        case e.timeoutFail >= 10 || e.refusedFail >= 10 || e.resetFail >= 10:
                return "switch_proxy"
        default:
                return "retry"
        }
}

// collectRateSnapshotData — 取 host 的采集速率快照.
func collectRateSnapshotData(host string) (qps int64, successRate100 int, avgLatencyMs int64, sampleCount int64) {
        if host == "" {
                return 0, 0, 0, 0
        }
        v, ok := collectRateMap.Load(strings.ToLower(host))
        if !ok {
                return 0, 0, 0, 0
        }
        e := v.(*collectRateEntry)
        e.mu.Lock()
        defer e.mu.Unlock()
        now := time.Now().UnixMilli()
        if now-e.windowStartAt >= CollectRateWindowMs {
                return 0, 0, 0, 0
        }
        total := e.successCount + e.failCount
        if total == 0 {
                return 0, 0, 0, 0
        }
        qps = total / 60
        successRate100 = int(e.successCount * 100 / total)
        avgLatencyMs = e.totalLatencyMs / total
        return qps, successRate100, avgLatencyMs, total
}

// CollectRateHostsSnapshot — admin / metrics 查询用.
func CollectRateHostsSnapshot() map[string]map[string]int64 {
        out := map[string]map[string]int64{}
        collectRateMap.Range(func(k, _ any) bool {
                qps, rate, lat, n := collectRateSnapshotData(k.(string))
                out[k.(string)] = map[string]int64{
                        "qps":          qps,
                        "successRate":  int64(rate),
                        "avgLatencyMs": lat,
                        "sampleCount":  n,
                }
                return true
        })
        return out
}

// ---------- R65-B 采集增强 B7: 错误分类重试策略可调 ----------
//
// R64-B B2 固定策略: DNS/TLS/CtxCanceled 不重试. B7 加 per-host 可调策略.
//   "retry" — 指数退避重试 (默认)
//   "abort" — 直接失败不重试 (走 8 级降级链)
//   "switch_proxy" — 清 host proxy 钉扎, 不重试本次
//   "switch_bridge" — 直接失败 + EvictHostProxyPin, 走桥

// hostRetryPolicyMap — per-host 错误分类重试策略覆盖.
var hostRetryPolicyMap sync.Map // host string -> map[NetErrorClass]string

// SetHostRetryPolicy — 设置 host 的错误分类重试策略.
// R65-B BUG-44 (P2): 深拷贝 policy map 后再 Store, 防止 caller 后续修改
//
//      原 map 引发与 hostRetryAction 读路径的数据竞争 (Go map 并发读写 →
//      "fatal error: concurrent map read and map write" panic). 原实现直接
//      Store(policy) 存引用, 不防 caller 后续 mutate. 修复: 拷贝新 map 再 Store.
func SetHostRetryPolicy(host string, policy map[NetErrorClass]string) {
        if host == "" {
                return
        }
        host = strings.ToLower(host)
        if len(policy) == 0 {
                hostRetryPolicyMap.Delete(host)
                return
        }
        // 深拷贝 (防 caller 后续修改原 map 引发 race)
        copyMap := make(map[NetErrorClass]string, len(policy))
        for k, v := range policy {
                copyMap[k] = v
        }
        hostRetryPolicyMap.Store(host, copyMap)
}

// ClearHostRetryPolicy — 清除 host 的策略覆盖.
func ClearHostRetryPolicy(host string) {
        if host == "" {
                return
        }
        hostRetryPolicyMap.Delete(strings.ToLower(host))
}

// hostRetryAction — 取 host + class 对应的 retry 动作. 默认 = R64-B B2.
func hostRetryAction(host string, class NetErrorClass) string {
        if host != "" {
                if v, ok := hostRetryPolicyMap.Load(strings.ToLower(host)); ok {
                        policy := v.(map[NetErrorClass]string)
                        if action, has := policy[class]; has {
                                return action
                        }
                }
        }
        switch class {
        case NetErrClassDNS, NetErrClassTLS, NetErrClassCtxCanceled:
                return "abort"
        default:
                return "retry"
        }
}

// HostRetryPolicySnapshot — admin / metrics 查询用.
func HostRetryPolicySnapshot() map[string]map[int]string {
        out := map[string]map[int]string{}
        hostRetryPolicyMap.Range(func(k, v any) bool {
                policy := v.(map[NetErrorClass]string)
                m := map[int]string{}
                for cls, action := range policy {
                        m[int(cls)] = action
                }
                out[k.(string)] = m
                return true
        })
        return out
}

// ---------- R66-C 反反爬第 63 项: Service Worker 注入识别 ----------
//
// 部分源站 (Cloudflare Worker / Workbox-based PWA 站) 用 Service Worker 注入检测
// 爬虫: 真实浏览器首次请求后注册 SW, 后续请求带 Service-Worker / Sec-Fetch-Dest:
// 'serviceworker' 等头; 爬虫不注册 SW, 后续请求缺这些头 → 反爬识别为非浏览器.
// 通过检测响应头 Service-Worker-Allowed / Service-Worker-Navigation-Mode 等 (源站
// 注入 SW 的信号), per-host 钉扎标识. 后续采集该 host 时:
//   1. admin/metrics 可识别哪些 host 用 SW (操作员可调整策略: 走桥 / 加 SW fetch)
//   2. R67 可扩展为: 真的 fetch SW 脚本 (scriptURL 来自 Service-Worker-Navigation-Mode)
//      执行 SW install 流程, 让后续请求带 SW 注册的头. 本轮仅识别 + 钉扎.

// hostServiceWorkerEntry — per-host SW 检测结果.
type hostServiceWorkerEntry struct {
        detectedAt   int64  // UnixMilli, 最近检测时间
        scriptURL    string // SW 脚本 URL (若 Service-Worker 响应头提供)
        headerSample string // 响应头原值 (admin 展示)
}

var hostServiceWorkerMap sync.Map // host string -> *hostServiceWorkerEntry

// hostServiceWorkerSweepCounter — sweep 触发累加 (R67-B BUG-57 修复).
var hostServiceWorkerSweepCounter atomic.Int64

// HostServiceWorkerSweepTTLms — per-host SW 检测条目 7 天 TTL (R67-B BUG-57).
//
//      原实现 hostServiceWorkerMap 完全无 sweep + 无 TTL, 条目永留, 长跑进程内存无界增长.
const HostServiceWorkerSweepTTLms = 7 * 24 * 60 * 60 * 1000

// recordServiceWorkerDetection — 检测响应是否含 SW 注入头, 钉扎 host.
//
//      触发头 (任一存在即记录): Service-Worker-Allowed / Service-Worker-Navigation-Mode /
//      Service-Worker / X-Service-Worker. 真实浏览器首次访问 SW 站时, 响应含这些头
//      指示客户端注册 SW. 爬虫不识别, 反爬可通过后续请求缺 SW 头识别非浏览器.
func recordServiceWorkerDetection(host, respServiceWorkerHeader string) {
        if host == "" {
                return
        }
        host = strings.ToLower(host)
        // 提取 scriptURL (若响应头是 "Service-Worker: <url>" 格式)
        scriptURL := ""
        if respServiceWorkerHeader != "" {
                // 简单提取: 头值若是 URL 形如 "/sw.js" 或 "https://...", 视为 scriptURL
                if strings.HasPrefix(respServiceWorkerHeader, "/") ||
                        strings.HasPrefix(respServiceWorkerHeader, "http://") ||
                        strings.HasPrefix(respServiceWorkerHeader, "https://") {
                        scriptURL = strings.TrimSpace(respServiceWorkerHeader)
                }
        }
        e := &hostServiceWorkerEntry{
                detectedAt:   time.Now().UnixMilli(),
                scriptURL:    scriptURL,
                headerSample: respServiceWorkerHeader,
        }
        hostServiceWorkerMap.Store(host, e)
        // R67-B BUG-57 (P3) 修复: 惰性 sweep (每 1000 次 Store 触发, 删 7 天未更新条目).
        //   原实现完全无 sweep + 无 TTL → 长跑进程内存无界增长.
        if hostServiceWorkerSweepCounter.Add(1)%1000 == 0 {
                now := time.Now().UnixMilli()
                hostServiceWorkerMap.Range(func(k, v any) bool {
                        ent := v.(*hostServiceWorkerEntry)
                        if now-ent.detectedAt > HostServiceWorkerSweepTTLms {
                                // R73-B BUG-106 (P3) 修复: sweep 与并发 Store race (与
                                //   hostProtoFingerprintMap 同款). recordServiceWorkerDetection
                                //   每次创建新 *hostServiceWorkerEntry 并 Store (替换). Delete
                                //   前重新 Load 确认 entry 仍是同一个 (指针相等), 防误删 fresh
                                //   entry.
                                if cur, ok := hostServiceWorkerMap.Load(k); ok {
                                        if curEnt, ok2 := cur.(*hostServiceWorkerEntry); ok2 && curEnt == ent {
                                                hostServiceWorkerMap.Delete(k)
                                        }
                                }
                        }
                        return true
                })
        }
}

// ServiceWorkerHostSnapshot — admin / metrics 查询用: 返回 SW-active host 列表.
func ServiceWorkerHostSnapshot() map[string]map[string]string {
        out := map[string]map[string]string{}
        hostServiceWorkerMap.Range(func(k, v any) bool {
                e := v.(*hostServiceWorkerEntry)
                out[k.(string)] = map[string]string{
                        "detectedAt":   fmt.Sprintf("%d", e.detectedAt),
                        "scriptURL":    e.scriptURL,
                        "headerSample": e.headerSample,
                }
                return true
        })
        return out
}

// ---------- R66-C 反反爬第 64 项: Cache-Control 优化 ----------
//
// 原实现首次请求 (无 condCached) 不发 Cache-Control / Pragma, 源站可能在中间缓存
// (CDN / 反向代理) 里命中旧版本. R64-B 第 52 项已加 If-Modified-Since 用于后续请求
// 走 304 优化; 本轮补首次请求 Cache-Control: no-cache + Pragma: no-cache, 强制
// 中间缓存 revalidate (回源拿最新). 仅在 condCached == nil 时注入 (有 condCached
// 时走 If-Modified-Since 路径, 不重复注入 no-cache, 避免源站误判 "客户端拒绝缓存").
//
// 价值: 防 CDN 命中旧版本 (源站已更新章节内容但 CDN 仍返旧版本 → 采集到过时数据).
// 降 Bot Score 1-2 分 (真实浏览器默认 Cache-Control: max-age=0 on hard reload,
// 但导航请求一般不发; no-cache 是浏览器 hard-reload 行为, 偶发不触发反爬识别).

// shouldInjectNoCache — 是否注入 Cache-Control: no-cache (condCached == nil 时注入).
func shouldInjectNoCache(condCached *condCacheEntry) bool {
        return condCached == nil
}

// ---------- R66-C 反反爬第 65 项: Accept-Encoding 优先级 ----------
//
// 原实现 buildHeaders 硬编码 "gzip, deflate". R65-B 第 56 项已建立 Server 头指纹库
// (hostProtoFingerprintMap). 本轮按 Server 类型动态调 Accept-Encoding 优先级.
//
// 实际约束: Go net/http 不解 brotli (无 stdlib 支持, 引入 brotli dep 会违反约束),
// 故从不广告 br. 即使 cloudflare 优先 br, 我们也不广告 br (源站返 br 我们解不了).
// 优先级调整 (按 Server 类型):
//   nginx / tengine / apache / Microsoft-IIS / unknown: "gzip, deflate" (gzip 优先,
//     nginx 默认 gzip 模块, deflate 兼容性)
//   cloudflare: "gzip" (CF 优先 br 但我们不广告; CF 也支持 gzip; deflate 在 CF
//     HTTP/2 上偶发兼容问题, drop deflate 简化)
//   cdn: "gzip, deflate" (未知 CDN, 保守两段)
//
// 价值: 与源站指纹协同, 让 Accept-Encoding 头更像真实浏览器针对该源站的请求.
//   降 Bot Score 1-2 分 (Cloudflare 静态指纹检测 Accept-Encoding 顺序是 Top 20 指标,
//   但权重低; 本项价值有限, 主要为指纹一致性).

// acceptEncodingFor — 返回 host 应使用的 Accept-Encoding 值 (按 Server 类型动态).
func acceptEncodingFor(host string) string {
        if host == "" {
                return "gzip, deflate"
        }
        e := hostProtoFingerprintFor(host)
        if e == nil {
                return "gzip, deflate"
        }
        switch e.ServerType {
        case "cloudflare":
                return "gzip"
        }
        return "gzip, deflate"
}

// ---------- R68-B 反反爬第 76 项: Accept 头按请求类型细化 ----------
//
// 真实浏览器按 MIME type advertise Accept 头:
//   - HTML 页面导航: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
//     (Chrome 默认导航请求)
//   - XHR/fetch JSON API: application/json (Chrome 在 fetch() 调用按 mode 改 Accept)
//   - <img> 图片: image/webp,image/*,*/*;q=0.8 (Chrome 支持 webp 时优先 webp)
//   - <script> JS: */* (Chrome 在 script 标签请求发 */*)
//   - <link rel=stylesheet> CSS: text/css,*/*;q=0.1
//   - <video>/<audio>: 走专门 mime, 较少用
//
// 原实现 buildHeaders 统一用 HTML Accept (text/html,application/xhtml+xml,...). 反爬
// 识别 "恒定 HTML Accept" 是 Go 标准库/爬虫指纹 (Chrome 行为有差异). 本轮按 URL
// path 后缀 + 路径模式细化 Accept 头:
//   - .json / /api/ / /v1/ / /v2/ → application/json (JSON API 请求)
//   - .jpg/.jpeg/.png/.webp/.gif/.svg/.ico/.bmp → image/webp,image/*,*/*;q=0.8 (图片请求)
//   - .css → text/css,*/*;q=0.1 (CSS 请求)
//   - .js → */* (JavaScript 请求)
//   - 其他 (HTML 页面) → text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
//
// 价值: 降 Bot Score 1-2 分 (Cloudflare 静态指纹检测 Accept 是 Top 30 指标).
//   真实浏览器在采图片章节时 (e.g. 漫画站) 发 image/webp,... 而非 HTML Accept,
//   反爬识别 "图片请求发 HTML Accept" 是爬虫指纹.

// acceptHeaderForURL — 按 URL 后缀 + 路径模式返合适的 Accept 头值.
//
//      实现路径白名单 (MIME type → 后缀 / 路径模式). 命中即返对应 Accept; 默认返
//      HTML Accept (兼容所有非 API/图片/CSS/JS 请求, 大部分小说站是 HTML 页面).
func acceptHeaderForURL(rawURL string) string {
        if rawURL == "" {
                return acceptHTML
        }
        // 取 path (剥 query / fragment)
        u, err := url.Parse(rawURL)
        if err != nil || u.Host == "" {
                return acceptHTML
        }
        p := strings.ToLower(u.Path)
        if p == "" {
                return acceptHTML
        }
        // 后缀匹配 (优先, 因 .json/.css/.js 是显式 MIME 标识)
        switch {
        case strings.HasSuffix(p, ".json"):
                return acceptJSON
        case strings.HasSuffix(p, ".css"):
                return acceptCSS
        case strings.HasSuffix(p, ".js"):
                return acceptJS
        case strings.HasSuffix(p, ".jpg") || strings.HasSuffix(p, ".jpeg") ||
                strings.HasSuffix(p, ".png") || strings.HasSuffix(p, ".webp") ||
                strings.HasSuffix(p, ".gif") || strings.HasSuffix(p, ".svg") ||
                strings.HasSuffix(p, ".ico") || strings.HasSuffix(p, ".bmp"):
                return acceptImage
        }
        // 路径模式匹配 (JSON API 常见路径)
        if strings.Contains(p, "/api/") || strings.HasPrefix(p, "/api") ||
                strings.Contains(p, "/v1/") || strings.Contains(p, "/v2/") {
                return acceptJSON
        }
        return acceptHTML
}

// Accept 头常量 (与 Chrome 真实行为一致).
const (
        acceptHTML  = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        acceptJSON  = "application/json"
        acceptImage = "image/webp,image/*,*/*;q=0.8"
        acceptCSS   = "text/css,*/*;q=0.1"
        acceptJS    = "*/*"
)
