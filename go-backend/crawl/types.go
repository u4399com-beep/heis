// Package crawl — 采集引擎 Go 重写 (R38-1C)
//
// 对应 TS 端 src/lib/crawl/* 的核心模块: fetcher / parser / cleaner / runner /
// smart / storage / hostgate / types. 保留 8 级降级链 + CookieJar + 并发架构
// (Semaphore + 三阶段) + cleaner trafilatura 桥等核心逻辑, 用 Go 标准库 +
// goquery (CSS 选择器) + golang.org/x/net/html 实现.
//
// 模块文件:
//   types.go    — 共享配置/规则/结果类型 + 默认值 + 深消毒白名单
//   hostgate.go — 同 host 并发 + 速率 双维闸门 (反反爬核心组件)
//   fetcher.go  — HTTP 采集 + 8 级降级链 + UA 池 + CookieJar
//   parser.go  — HTML/JSON 解析 + CSS 选择器 + 翻页 + URL 绝对化
//   cleaner.go  — 正文清洗 + 段落规整 + 零宽字符剥离 + trafilatura 桥
//   smart.go    — 智能分类 (CATEGORY_ALIASES + normalizeCategory) + 完结判断
//   storage.go  — 章节 TXT / 封面 webp / 路径穿越防御 + 原子写入
//   runner.go   — 任务调度 + Semaphore + 三阶段并发采集 + BudgetExceeded
package crawl

import (
        "encoding/json"
        "fmt"
        "net/url"
        "strings"
)

// FieldRuleType 描述字段提取方式 (CSS/XPath/Regex/JSON/Const).
type FieldRuleType string

const (
        FieldCSS    FieldRuleType = "css"
        FieldXPath  FieldRuleType = "xpath"
        FieldRegex  FieldRuleType = "regex"
        FieldJSON   FieldRuleType = "json"
        FieldConst  FieldRuleType = "const"
)

// FieldRule — 字段提取规则. 与 TS 端 src/lib/crawl/types.ts FieldRule 字段对齐.
type FieldRule struct {
        Type              FieldRuleType `json:"type"`
        Expression        string        `json:"expression"`
        Attr             string        `json:"attr,omitempty"`
        Flags            string        `json:"flags,omitempty"`
        StripTags        bool          `json:"stripTags,omitempty"`
        ReplaceFrom      string        `json:"replaceFrom,omitempty"`
        ReplaceTo        string        `json:"replaceTo,omitempty"`
        Index            *int          `json:"index,omitempty"`
        Decode           string        `json:"decode,omitempty"` // base64-json / base64 / url-decode / html-decode
        DefaultValue     string        `json:"defaultValue,omitempty"`
        Required         bool          `json:"required,omitempty"`
        ExtractMultiple  bool          `json:"extractMultiple,omitempty"`
        MultipleSeparator string       `json:"multipleSeparator,omitempty"`
}

// PageFields — 列表项提取的字段集 (有序 map 用 []struct 实现, 保序).
type PageFields = map[string]FieldRule

// PageRule — 页面级规则 (列表页/书籍页/目录页/内容页).
type PageRule struct {
        Enabled       bool          `json:"enabled"`
        URLTemplate   string        `json:"urlTemplate,omitempty"`
        ItemSelector  *FieldRule    `json:"itemSelector,omitempty"`
        Fields        PageFields    `json:"fields"`
        TocLink       *FieldRule    `json:"tocLink,omitempty"`
        Pagination    *Pagination   `json:"pagination,omitempty"`
}

// Pagination — 详情/内容页翻页规则.
type Pagination struct {
        Enabled  bool       `json:"enabled"`
        NextLink *FieldRule `json:"nextLink,omitempty"`
        MaxPages int        `json:"maxPages"`
        JoinWith string     `json:"joinWith,omitempty"`
}

// FetchConfig — 反反爬抓取配置 (与 TS 端 FetchConfig 字段对齐, 仅保留核心).
type FetchConfig struct {
        Engine                 string            `json:"engine"`              // auto | http | browser
        UAMode                 string            `json:"uaMode"`              // rotate | fixed | custom | mobile | desktop
        CustomUA               string            `json:"customUa,omitempty"`
        Headers                map[string]string `json:"headers,omitempty"`
        Cookies                string            `json:"cookies,omitempty"`
        AutoCookie             bool              `json:"autoCookie"`
        Referer                bool              `json:"referer"`
        RefererChain           bool              `json:"refererChain,omitempty"`
        RefererURL             string            `json:"refererUrl,omitempty"`
        Timeout                int               `json:"timeout"`             // ms
        Retries                int               `json:"retries"`
        WaitSelector           string            `json:"waitSelector,omitempty"`
        WaitMs                 int               `json:"waitMs,omitempty"`
        ClickSelector          string            `json:"clickSelector,omitempty"`
        BrowserFallbackStatus  []int             `json:"browserFallbackStatus,omitempty"`
        HostGateLimit          int               `json:"hostGateLimit,omitempty"`
        TokenURL               string            `json:"tokenUrl,omitempty"`
        TokenPattern           string            `json:"tokenPattern,omitempty"`
        TokenInjection         string            `json:"tokenInjection,omitempty"` // url | header
        TokenHeaderName        string            `json:"tokenHeaderName,omitempty"`
        ContentProxyURL        string            `json:"contentProxyUrl,omitempty"`
        ProxyURL               string            `json:"proxyUrl,omitempty"`
        MirrorDomains          string            `json:"mirrorDomains,omitempty"`
        ProxyRotationStrategy  string            `json:"proxyRotationStrategy,omitempty"`
        JitterMs               int               `json:"jitterMs,omitempty"`
        FetchMode              string            `json:"fetchMode,omitempty"` // native | scrapling-* | moli | cloak-browser
        MoliEval               string            `json:"moliEval,omitempty"`
        MoliHeaders            map[string]string `json:"moliHeaders,omitempty"`
        ScraplingBridgeURL     string            `json:"scraplingBridgeUrl,omitempty"`
        TrafilaturaBridgeURL   string            `json:"trafilaturaBridgeUrl,omitempty"`
        MaxRequests            int               `json:"maxRequests,omitempty"`
        URLs                   []string          `json:"urls,omitempty"`
        TLSProfile             string            `json:"tlsProfile,omitempty"`
        H2Fingerprint          string            `json:"h2Fingerprint,omitempty"`
        HeaderOrderProfile     string            `json:"headerOrderProfile,omitempty"`
        ThinkTimeMs            int               `json:"thinkTimeMs,omitempty"`
        PerHostConcurrency     int               `json:"perHostConcurrency,omitempty"`
        Concurrency            int               `json:"concurrency,omitempty"` // R31-1B 任务级并发度
        GlobalRateLimitPerMin  int               `json:"globalRateLimitPerMin,omitempty"`
        CaptchaCooldownMs      int               `json:"captchaCooldownMs,omitempty"`
        ProxyHealthCheck       bool              `json:"proxyHealthCheck,omitempty"`
        // R46-1B 反反爬增强: 代理池主动 probe 目标 URL (ProxyHealthCheck=true 启用).
        //   默认 https://www.google.com (全球可达 + 5xx 概率低). 用户可改自定义 endpoint
        //   (如 https://www.cloudflare.com 或自建 ping endpoint).
        ProxyProbeURL          string            `json:"proxyProbeUrl,omitempty"`
        ProxyCascadePauseMs   int               `json:"proxyCascadePauseMs,omitempty"`
        FingerprintRotation    int               `json:"fingerprintRotationInterval,omitempty"`
        AdaptiveRateLimit      bool              `json:"adaptiveRateLimit,omitempty"`
        KeepAlivePool          bool              `json:"keepAlivePool,omitempty"`
        H2Pool                 bool              `json:"h2Pool,omitempty"`
        RequestPriority        string            `json:"requestPriority,omitempty"`
        RateLimitAware         bool              `json:"rateLimitAware,omitempty"`
        SmartBackoff           bool              `json:"smartBackoff,omitempty"`
        CookiePersistPath      string            `json:"cookiePersistPath,omitempty"`
        FingerprintJitter      bool              `json:"fingerprintJitter,omitempty"`
        ResponseCacheTtlMs     int               `json:"responseCacheTtlMs,omitempty"`
        CurlImpersonateProfile string            `json:"curlImpersonateProfile,omitempty"`
        CloakBrowserURL        string            `json:"cloakBrowserUrl,omitempty"`
        CloakTier              string            `json:"cloakTier,omitempty"`
        // R43-1B 反反爬增强: 2captcha 验证码服务 API key.
        // 配置后, fetchPageOnce 命中 h-captcha / reCAPTCHA / Turnstile 时, 调 2captcha
        // API 提交任务, 等待人工/AI 解出 token, 注入到页面重新抓取. 无配置则走原
        // Obscura 桥 (puppeteer 自动点击) 路径.
        TwoCaptchaAPIKey       string            `json:"twoCaptchaApiKey,omitempty"`
        // R45-1A 反反爬增强: anti-captcha 验证码服务 API key (2captcha 备用).
        // 2captcha 服务不可用 / 返错 / 未配置时自动 fallback. 两个服务各试一次,
        // 单服务 180s 超时 (caller 控制). 价格 $1.5-3/1000 次, 与 2captcha 相当.
        AntiCaptchaAPIKey     string            `json:"antiCaptchaApiKey,omitempty"`
}

// CleanConfig — 内容清洗配置.
type CleanConfig struct {
        RemoveSelectors         []string `json:"removeSelectors"`
        AdPatterns              []string `json:"adPatterns"`
        Whitelist               []string `json:"whitelist"`
        Normalize              bool     `json:"normalize"`
        PlainText              bool     `json:"plainText"`
        BannedWords             []string `json:"bannedWords,omitempty"`
        BannedAction            string   `json:"bannedAction,omitempty"` // skip | mask
        UseTrafilatura          bool     `json:"useTrafilatura,omitempty"`
        TrafilaturaPruneXPath   []string `json:"trafilaturaPruneXPath,omitempty"`
        TrafilaturaFallback     bool     `json:"trafilaturaFallback,omitempty"`
}

// RuleConfig — 完整规则配置.
type RuleConfig struct {
        List    PageRule    `json:"list"`
        Book    PageRule    `json:"book"`
        Toc     PageRule    `json:"toc"`
        Content PageRule    `json:"content"`
        Fetch   FetchConfig `json:"fetch"`
        Clean   CleanConfig `json:"clean"`
}

// TocItem — 目录项 (单章节).
type TocItem struct {
        Title  string `json:"title"`
        URL    string `json:"url"`
        Volume string `json:"volume,omitempty"`
}

// ParsedBook — 书籍解析结果 (字段全可选).
type ParsedBook struct {
        Name          string `json:"name,omitempty"`
        Author        string `json:"author,omitempty"`
        Category      string `json:"category,omitempty"`
        Keywords      string `json:"keywords,omitempty"`
        Intro         string `json:"intro,omitempty"`
        Cover         string `json:"cover,omitempty"`
        LatestChapter string `json:"latestChapter,omitempty"`
        Status        string `json:"status,omitempty"`
        WordCount     string `json:"wordCount,omitempty"`
}

// ParsedContent — 章节内容解析结果.
type ParsedContent struct {
        Content string `json:"content"`
        Pages   int    `json:"pages"`
}

// DefaultFetchConfig — 与 TS 端 DEFAULT_FETCH_CONFIG 同口径.
var DefaultFetchConfig = FetchConfig{
        Engine:                "auto",
        UAMode:                "rotate",
        AutoCookie:            true,
        Referer:               true,
        Timeout:              20000,
        Retries:               2,
        WaitMs:                800,
        BrowserFallbackStatus: []int{403, 412, 429, 503},
        HostGateLimit:         3,
}

// DefaultCleanConfig — 与 TS 端 DEFAULT_CLEAN_CONFIG 同口径.
var DefaultCleanConfig = CleanConfig{
        RemoveSelectors: []string{"script", "style", "iframe", "ins", "noscript", ".adsbygoogle", ".ad", "#ad"},
        AdPatterns: []string{
                `(www\.)?[a-z0-9-]+\.(com|net|cc|org|info|top|xyz|vip|site)(/\S*)?`,
                `本章未完.*?点击下一页继续阅读`,
                `请记住本书.*?域名`,
                `最新章节请到.*?查看`,
                `[（(]?完?本[网站站][）)]?`,
                `一秒记住.*?免费读`,
        },
        Whitelist:      []string{"p", "br", "b", "strong", "em", "i", "u", "h1", "h2", "h3", "h4", "h5", "h6"},
        Normalize:      true,
        PlainText:      false,
        UseTrafilatura: false,
        TrafilaturaFallback: false,
}

// DefaultRuleConfig — 默认规则配置 (与 TS 端 defaultRuleConfig 同口径).
func DefaultRuleConfig() RuleConfig {
        return RuleConfig{
                List: PageRule{Enabled: true, URLTemplate: "", Fields: PageFields{}, ItemSelector: nil},
                Book: PageRule{Enabled: true, Fields: PageFields{}},
                Toc: PageRule{
                        Enabled:    true,
                        Fields:     PageFields{},
                        Pagination: &Pagination{Enabled: false, MaxPages: 20, JoinWith: ""},
                },
                Content: PageRule{
                        Enabled:    true,
                        Fields:     PageFields{},
                        Pagination: &Pagination{Enabled: false, MaxPages: 10, JoinWith: "<br/>"},
                },
                Fetch: DefaultFetchConfig,
                Clean: cloneCleanConfig(DefaultCleanConfig),
        }
}

// ParseRuleConfig — 解析规则 JSON 字符串, 深消毒白名单重建 (与 TS 端 parseRuleConfig 同口径).
// 防脏数据: JSON 根不是 map[string]any 时直接回退默认配置.
func ParseRuleConfig(raw string) RuleConfig {
        base := DefaultRuleConfig()
        if raw == "" {
                return base
        }
        var cfg map[string]any
        if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
                return base
        }
        // 深消毒: 各段逐字段白名单重建
        if v, ok := cfg["fetch"].(map[string]any); ok {
                base.Fetch = sanitizeFetchConfig(v)
        }
        if v, ok := cfg["clean"].(map[string]any); ok {
                base.Clean = sanitizeCleanConfig(v)
        }
        if v, ok := cfg["list"].(map[string]any); ok {
                base.List = sanitizePageRule(v, true)
        }
        if v, ok := cfg["book"].(map[string]any); ok {
                base.Book = sanitizePageRule(v, false)
        }
        if v, ok := cfg["toc"].(map[string]any); ok {
                base.Toc = sanitizePageRule(v, true)
        }
        if v, ok := cfg["content"].(map[string]any); ok {
                base.Content = sanitizePageRule(v, true)
        }
        return base
}

// sanitizeFetchConfig — 白名单重建 fetch 配置, 钳制字段范围.
func sanitizeFetchConfig(m map[string]any) FetchConfig {
        out := DefaultFetchConfig
        if v, ok := m["engine"].(string); ok && (v == "auto" || v == "http" || v == "browser") {
                out.Engine = v
        }
        if v, ok := m["uaMode"].(string); ok {
                switch v {
                case "rotate", "fixed", "custom", "mobile", "desktop":
                        out.UAMode = v
                }
        }
        if v, ok := m["customUa"].(string); ok {
                out.CustomUA = safeStr(v, 500)
        }
        if v, ok := m["headers"].(map[string]any); ok {
                h := map[string]string{}
                for k, val := range v {
                        if vs, vok := val.(string); vok {
                                h[safeStr(k, 100)] = safeStr(vs, 2000)
                        }
                }
                out.Headers = h
        }
        if v, ok := m["cookies"].(string); ok {
                out.Cookies = safeStr(v, 4000)
        }
        if v, ok := m["autoCookie"].(bool); ok {
                out.AutoCookie = v
        }
        if v, ok := m["referer"].(bool); ok {
                out.Referer = v
        }
        if v, ok := m["refererChain"].(bool); ok {
                out.RefererChain = v
        }
        if v, ok := m["timeout"].(float64); ok {
                out.Timeout = clampInt(int(v), 1000, 120000)
        }
        if v, ok := m["retries"].(float64); ok {
                out.Retries = clampInt(int(v), 0, 10)
        }
        if v, ok := m["waitMs"].(float64); ok {
                out.WaitMs = clampInt(int(v), 0, 60000)
        }
        if v, ok := m["browserFallbackStatus"].([]any); ok {
                sts := []int{}
                for _, s := range v {
                        if n, ok := s.(float64); ok {
                                sts = append(sts, clampInt(int(n), 100, 599))
                        }
                }
                if len(sts) > 0 {
                        out.BrowserFallbackStatus = sts
                }
        }
        if v, ok := m["hostGateLimit"].(float64); ok {
                out.HostGateLimit = clampInt(int(v), 1, 10)
        }
        if v, ok := m["tokenUrl"].(string); ok {
                out.TokenURL = safeStr(v, 1000)
        }
        if v, ok := m["tokenPattern"].(string); ok {
                out.TokenPattern = safeStr(v, 1000)
        }
        if v, ok := m["tokenInjection"].(string); ok && (v == "url" || v == "header") {
                out.TokenInjection = v
        }
        if v, ok := m["tokenHeaderName"].(string); ok {
                out.TokenHeaderName = safeStr(v, 100)
        }
        if v, ok := m["contentProxyUrl"].(string); ok {
                out.ContentProxyURL = safeStr(v, 1000)
        }
        if v, ok := m["proxyUrl"].(string); ok {
                out.ProxyURL = safeStr(v, 4000)
        }
        if v, ok := m["mirrorDomains"].(string); ok {
                out.MirrorDomains = safeStr(v, 1000)
        }
        if v, ok := m["fetchMode"].(string); ok {
                out.FetchMode = safeStr(v, 100)
        }
        if v, ok := m["scraplingBridgeUrl"].(string); ok {
                out.ScraplingBridgeURL = safeStr(v, 1000)
        }
        if v, ok := m["trafilaturaBridgeUrl"].(string); ok {
                out.TrafilaturaBridgeURL = safeStr(v, 300)
        }
        if v, ok := m["maxRequests"].(float64); ok {
                out.MaxRequests = clampInt(int(v), 100, 1000000)
        }
        if v, ok := m["concurrency"].(float64); ok {
                out.Concurrency = clampInt(int(v), 1, 10)
        }
        if v, ok := m["jitterMs"].(float64); ok {
                out.JitterMs = clampInt(int(v), 0, 60000)
        }
        if v, ok := m["globalRateLimitPerMin"].(float64); ok {
                out.GlobalRateLimitPerMin = clampInt(int(v), 0, 100000)
        }
        if v, ok := m["captchaCooldownMs"].(float64); ok {
                out.CaptchaCooldownMs = clampInt(int(v), 60000, 3600000)
        }
        if v, ok := m["cookiePersistPath"].(string); ok {
                out.CookiePersistPath = safeStr(v, 1000)
        }
        if v, ok := m["rateLimitAware"].(bool); ok {
                out.RateLimitAware = v
        }
        if v, ok := m["smartBackoff"].(bool); ok {
                out.SmartBackoff = v
        }
        if v, ok := m["adaptiveRateLimit"].(bool); ok {
                out.AdaptiveRateLimit = v
        }
        if v, ok := m["keepAlivePool"].(bool); ok {
                out.KeepAlivePool = v
        }
        if v, ok := m["h2Pool"].(bool); ok {
                out.H2Pool = v
        }
        if v, ok := m["fingerprintJitter"].(bool); ok {
                out.FingerprintJitter = v
        }
        if v, ok := m["responseCacheTtlMs"].(float64); ok {
                out.ResponseCacheTtlMs = clampInt(int(v), 5000, 300000)
        }
        if v, ok := m["curlImpersonateProfile"].(string); ok && (v == "chrome" || v == "firefox" || v == "safari") {
                out.CurlImpersonateProfile = v
        }
        if v, ok := m["cloakBrowserUrl"].(string); ok {
                out.CloakBrowserURL = safeStr(v, 1000)
        }
        if v, ok := m["cloakTier"].(string); ok && (v == "lite" || v == "standard" || v == "maximum") {
                out.CloakTier = v
        }
        if v, ok := m["thinkTimeMs"].(float64); ok {
                out.ThinkTimeMs = clampInt(int(v), 0, 60000)
        }
        if v, ok := m["perHostConcurrency"].(float64); ok {
                out.PerHostConcurrency = clampInt(int(v), 1, 10)
        }
        if v, ok := m["tlsProfile"].(string); ok {
                out.TLSProfile = safeStr(v, 50)
        }
        if v, ok := m["h2Fingerprint"].(string); ok {
                out.H2Fingerprint = safeStr(v, 50)
        }
        if v, ok := m["headerOrderProfile"].(string); ok {
                out.HeaderOrderProfile = safeStr(v, 50)
        }
        if v, ok := m["requestPriority"].(string); ok {
                out.RequestPriority = safeStr(v, 20)
        }
        if v, ok := m["proxyRotationStrategy"].(string); ok && (v == "round-robin" || v == "random" || v == "least-used") {
                out.ProxyRotationStrategy = v
        }
        if v, ok := m["urls"].([]any); ok {
                urls := []string{}
                for _, u := range v {
                        if us, ok := u.(string); ok && len(us) > 0 && len(us) <= 2048 {
                                if _, err := url.Parse(us); err == nil {
                                        urls = append(urls, us)
                                }
                        }
                }
                if len(urls) > 0 {
                        if len(urls) > 1000 {
                                urls = urls[:1000]
                        }
                        out.URLs = urls
                }
        }
        if v, ok := m["proxyHealthCheck"].(bool); ok {
                out.ProxyHealthCheck = v
        }
        // R46-1B: ProxyProbeURL 白名单 (http(s) + 长度 ≤ 2048 + URL parse 校验)
        if v, ok := m["proxyProbeUrl"].(string); ok && v != "" {
                if len(v) <= 2048 {
                        if u, err := url.Parse(v); err == nil && (u.Scheme == "http" || u.Scheme == "https") {
                                out.ProxyProbeURL = v
                        }
                }
        }
        if v, ok := m["proxyCascadePauseMs"].(float64); ok {
                out.ProxyCascadePauseMs = clampInt(int(v), 10000, 300000)
        }
        if v, ok := m["fingerprintRotationInterval"].(float64); ok {
                out.FingerprintRotation = clampInt(int(v), 10, 1000)
        }
        if v, ok := m["moliEval"].(string); ok {
                out.MoliEval = safeStr(v, 1000)
        }
        if v, ok := m["moliHeaders"].(map[string]any); ok {
                h := map[string]string{}
                for k, val := range v {
                        if vs, vok := val.(string); vok {
                                h[safeStr(k, 100)] = safeStr(vs, 2000)
                        }
                }
                out.MoliHeaders = h
        }
        // R43-1B: 2captcha API key (低权限敏感字段, 长度上限 64 防 token 注入)
        if v, ok := m["twoCaptchaApiKey"].(string); ok {
                out.TwoCaptchaAPIKey = safeStr(v, 64)
        }
        // R45-1A: anti-captcha API key (同 2captcha, 长度上限 64)
        if v, ok := m["antiCaptchaApiKey"].(string); ok {
                out.AntiCaptchaAPIKey = safeStr(v, 64)
        }
        return out
}

// sanitizeCleanConfig — 白名单重建 clean 配置.
func sanitizeCleanConfig(m map[string]any) CleanConfig {
        out := cloneCleanConfig(DefaultCleanConfig)
        if v, ok := m["removeSelectors"].([]any); ok {
                out.RemoveSelectors = safeStrArr(v, 30, 200)
        }
        if v, ok := m["adPatterns"].([]any); ok {
                out.AdPatterns = safeStrArr(v, 30, 300)
        }
        if v, ok := m["whitelist"].([]any); ok {
                out.Whitelist = safeStrArr(v, 50, 50)
        }
        if v, ok := m["normalize"].(bool); ok {
                out.Normalize = v
        }
        if v, ok := m["plainText"].(bool); ok {
                out.PlainText = v
        }
        if v, ok := m["bannedWords"].([]any); ok {
                out.BannedWords = safeStrArr(v, 100, 100)
        }
        if v, ok := m["bannedAction"].(string); ok && (v == "skip" || v == "mask") {
                out.BannedAction = v
        }
        if v, ok := m["useTrafilatura"].(bool); ok {
                out.UseTrafilatura = v
        }
        if v, ok := m["trafilaturaPruneXPath"].([]any); ok {
                out.TrafilaturaPruneXPath = safeStrArr(v, 30, 200)
        }
        if v, ok := m["trafilaturaFallback"].(bool); ok {
                out.TrafilaturaFallback = v
        }
        return out
}

// sanitizePageRule — 白名单重建页面规则. withURLTemplate 控制 urlTemplate 是否采信
// (list 段允许, 其他段忽略).
func sanitizePageRule(m map[string]any, withURLTemplate bool) PageRule {
        out := PageRule{Enabled: true, Fields: PageFields{}}
        if v, ok := m["enabled"].(bool); ok {
                out.Enabled = v
        }
        if withURLTemplate {
                if v, ok := m["urlTemplate"].(string); ok {
                        out.URLTemplate = safeStr(v, 2000)
                }
        }
        if v, ok := m["itemSelector"].(map[string]any); ok {
                out.ItemSelector = sanitizeFieldRule(v)
        }
        if v, ok := m["tocLink"].(map[string]any); ok {
                out.TocLink = sanitizeFieldRule(v)
        }
        if v, ok := m["fields"].(map[string]any); ok {
                f := PageFields{}
                for name, rule := range v {
                        rs, rok := rule.(map[string]any)
                        if !rok {
                                continue
                        }
                        name = safeStr(name, 80)
                        if name == "" {
                                continue
                        }
                        fr := sanitizeFieldRule(rs)
                        if fr.Type == "" {
                                continue
                        }
                        f[name] = *fr
                }
                out.Fields = f
        }
        if v, ok := m["pagination"].(map[string]any); ok {
                p := &Pagination{Enabled: false, MaxPages: 20, JoinWith: ""}
                if e, ok := v["enabled"].(bool); ok {
                        p.Enabled = e
                }
                if mp, ok := v["maxPages"].(float64); ok {
                        p.MaxPages = clampInt(int(mp), 1, 100)
                }
                if jw, ok := v["joinWith"].(string); ok {
                        p.JoinWith = safeStr(jw, 100)
                }
                if nl, ok := v["nextLink"].(map[string]any); ok {
                        p.NextLink = sanitizeFieldRule(nl)
                }
                out.Pagination = p
        }
        return out
}

// sanitizeFieldRule — 白名单重建字段规则.
func sanitizeFieldRule(m map[string]any) *FieldRule {
        fr := &FieldRule{}
        if v, ok := m["type"].(string); ok {
                switch FieldRuleType(v) {
                case FieldCSS, FieldXPath, FieldRegex, FieldJSON, FieldConst:
                        fr.Type = FieldRuleType(v)
                default:
                        return fr
                }
        } else {
                return fr
        }
        if v, ok := m["expression"].(string); ok {
                fr.Expression = safeStr(v, 2000)
        }
        if v, ok := m["attr"].(string); ok {
                fr.Attr = safeStr(v, 50)
        }
        if v, ok := m["flags"].(string); ok {
                fr.Flags = safeStr(v, 20)
        }
        if v, ok := m["stripTags"].(bool); ok {
                fr.StripTags = v
        }
        if v, ok := m["replaceFrom"].(string); ok {
                fr.ReplaceFrom = safeStr(v, 1000)
        }
        if v, ok := m["replaceTo"].(string); ok {
                fr.ReplaceTo = safeStr(v, 1000)
        }
        if v, ok := m["index"].(float64); ok {
                n := clampInt(int(v), 0, 999)
                fr.Index = &n
        }
        if v, ok := m["decode"].(string); ok {
                switch v {
                case "base64-json", "base64", "url-decode", "html-decode":
                        fr.Decode = v
                }
        }
        if v, ok := m["defaultValue"].(string); ok {
                fr.DefaultValue = safeStr(v, 2000)
        }
        if v, ok := m["required"].(bool); ok {
                fr.Required = v
        }
        if v, ok := m["extractMultiple"].(bool); ok {
                fr.ExtractMultiple = v
        }
        if v, ok := m["multipleSeparator"].(string); ok {
                fr.MultipleSeparator = safeStr(v, 20)
        }
        return fr
}

// ---------- 安全工具 (深消毒白名单) ----------

func safeStr(s string, max int) string {
        s = strings.TrimSpace(s)
        // 剥控制字符 (含 \r \n \t, 与 sanitize 同口径, 防头注入)
        b := make([]rune, 0, len(s))
        for _, r := range s {
                if r < 0x20 || r == 0x7f {
                        continue
                }
                b = append(b, r)
        }
        out := string(b)
        if max > 0 && len([]rune(out)) > max {
                out = string([]rune(out)[:max])
        }
        return out
}

func safeStrArr(arr []any, maxCount, maxLen int) []string {
        out := []string{}
        for _, v := range arr {
                if s, ok := v.(string); ok {
                        s = safeStr(s, maxLen)
                        if s != "" {
                                out = append(out, s)
                        }
                        if len(out) >= maxCount {
                                break
                        }
                }
        }
        return out
}

func clampInt(v, lo, hi int) int {
        if v < lo {
                return lo
        }
        if v > hi {
                return hi
        }
        return v
}

func cloneCleanConfig(c CleanConfig) CleanConfig {
        out := c
        if c.RemoveSelectors != nil {
                out.RemoveSelectors = append([]string(nil), c.RemoveSelectors...)
        }
        if c.AdPatterns != nil {
                out.AdPatterns = append([]string(nil), c.AdPatterns...)
        }
        if c.Whitelist != nil {
                out.Whitelist = append([]string(nil), c.Whitelist...)
        }
        if c.BannedWords != nil {
                out.BannedWords = append([]string(nil), c.BannedWords...)
        }
        if c.TrafilaturaPruneXPath != nil {
                out.TrafilaturaPruneXPath = append([]string(nil), c.TrafilaturaPruneXPath...)
        }
        return out
}

// SafeStr exposed for external callers (e.g. main API routes).
func SafeStr(s string, max int) string { return safeStr(s, max) }

// ClampInt exposed for external callers.
func ClampInt(v, lo, hi int) int { return clampInt(v, lo, hi) }

// String — Stringer impl for FieldRuleType used in logs.
func (t FieldRuleType) String() string { return string(t) }

// stringer for FetchConfig.Engine validation (used by fetcher.go).
func (c FetchConfig) String() string {
        return fmt.Sprintf("FetchConfig{engine=%s, ua=%s, timeout=%d, retries=%d, concurrency=%d}",
                c.Engine, c.UAMode, c.Timeout, c.Retries, c.Concurrency)
}
