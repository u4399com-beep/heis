// cleaner.go — 内容清洗 + 段落规整 + 零宽字符剥离 + trafilatura 桥 (R38-1C).
//
// 核心功能:
//   - decodeEntitiesOnce (实体单遍解码防链式二次)
//   - removeAdLines (URL 保护 + 内置 EXTRA_AD_PATTERNS + ReDoS 防护)
//   - cleanContentHtml (plainText / HTML 双分支 + 控制字符剥离 + 零宽字符剥离 +
//     段落规整 + 首末段水印剥离)
//   - cleanTextField (纯文本字段清洗)
//   - cleanIntro (多行简介清洗)
//   - callTrafilaturaExtract (trafilatura 桥调用 + 60s 可用性缓存)
//
// 已知限制:
//   - OpenCC 繁简转换无 Go 原生绑定, T2SText/T2SHtml 当前为 stub (原样返回)
//     trafilatura 桥侧可承担繁简转换 (Python 端 OpenCC 词典加载)
//   - EXTRA_AD_PATTERNS 与 cfg.AdPatterns 合并去重
package crawl

import (
        "bytes"
        "context"
        "encoding/json"
        "fmt"
        "io"
        "net/http"
        "regexp"
        "strings"
        "sync"
        "time"
        "unicode/utf8"

        "github.com/PuerkitoBio/goquery"
)

// ---------- trafilatura 桥 (mini-services/trafilatura-bridge:3019) ----------

const (
        TrafilaturaBridgeURLDefault   = "http://127.0.0.1:3019"
        TrafilaturaProbeRetryMs       = 60000
        TrafilaturaRequestTimeoutMs   = 20000
        TrafilaturaMaxHTMLBytes       = 10 * 1024 * 1024
)

type trafilaturaState struct {
        mu        sync.Mutex
        available *bool // nil = 未探测
        checkedAt int64
}

var trafilaturaInst = &trafilaturaState{}

// R42-1B: 复用进程级 http.Client (取代每调用 new http.Client{Timeout: 1.5s}).
// 原实现 CheckTrafilaturaBridge 每次探测都 new 一个 http.Client, 高频探测下
// (每章节都查桥可用性) TCP 句柄 + TLS session 浪费. 改为进程级单例 (1.5s timeout).
// R43-1B: 同 trafilaturaCallClient, Transport = globalTransport 共享连接池.
var trafilaturaProbeClient = &http.Client{
        Timeout:   1500 * time.Millisecond,
        Transport: globalTransport,
}

// R42-1B: 桥调用复用进程级 transport (取代 http.DefaultClient, 与 fetcher globalHttp 同口径).
// R43-1B: 真正复用 globalTransport (R42-1B 注释声称同口径但 Transport 字段为 nil, 实际走
// http.DefaultTransport 独立连接池, 与 fetcher 不共享). 修复: Transport = globalTransport.
var trafilaturaCallClient = &http.Client{
        Timeout:   time.Duration(TrafilaturaRequestTimeoutMs) * time.Millisecond,
        Transport: globalTransport,
}

// CheckTrafilaturaBridge — 探测桥可用性 (/health), 60s 缓存.
func CheckTrafilaturaBridge(bridgeURL string) bool {
        if bridgeURL == "" {
                bridgeURL = TrafilaturaBridgeURLDefault
        }
        trafilaturaInst.mu.Lock()
        defer trafilaturaInst.mu.Unlock()
        now := time.Now().UnixMilli()
        if trafilaturaInst.available != nil {
                if *trafilaturaInst.available {
                        return true
                }
                // 60s 缓存内视为不可用
                if now-trafilaturaInst.checkedAt < TrafilaturaProbeRetryMs {
                        return false
                }
        }
        // 探测
        resp, err := trafilaturaProbeClient.Get(bridgeURL + "/health")
        if err != nil {
                f := false
                trafilaturaInst.available = &f
                trafilaturaInst.checkedAt = now
                return false
        }
        defer resp.Body.Close()
        if resp.StatusCode != 200 {
                f := false
                trafilaturaInst.available = &f
                trafilaturaInst.checkedAt = now
                return false
        }
        var data struct {
                Ok         bool `json:"ok"`
                SelfTestOk bool `json:"selfTestOk"`
        }
        body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
        _ = json.Unmarshal(body, &data)
        if !data.Ok || !data.SelfTestOk {
                f := false
                trafilaturaInst.available = &f
                trafilaturaInst.checkedAt = now
                return false
        }
        t := true
        trafilaturaInst.available = &t
        trafilaturaInst.checkedAt = now
        return true
}

// TrafilaturaExtractResult — 桥调用结果.
type TrafilaturaExtractResult struct {
        Ok    bool
        Text  string
        Error string
}

// CallTrafilaturaExtract — 调 trafilatura-bridge POST /extract 提取正文.
// html > 10MB 跳过; 桥不可达/异常/空文本 → {ok:false} (上层降级 cheerio 链).
func CallTrafilaturaExtract(ctx context.Context, html string, pruneXPath []string, bridgeURL string) TrafilaturaExtractResult {
        if html == "" {
                return TrafilaturaExtractResult{Ok: false, Error: "empty html"}
        }
        if len(html) > TrafilaturaMaxHTMLBytes {
                return TrafilaturaExtractResult{Ok: false, Error: "html 超过 10MB 上限"}
        }
        if bridgeURL == "" {
                bridgeURL = TrafilaturaBridgeURLDefault
        }
        // 自定义 bridgeURL (≠ 默认) 不走 60s 缓存
        isDefault := bridgeURL == TrafilaturaBridgeURLDefault
        if isDefault {
                if !CheckTrafilaturaBridge(bridgeURL) {
                        return TrafilaturaExtractResult{Ok: false, Error: "trafilatura-bridge 不可用 (60s 缓存内)"}
                }
        }
        ctx, cancel := context.WithTimeout(ctx, time.Duration(TrafilaturaRequestTimeoutMs)*time.Millisecond)
        defer cancel()

        reqPayload := map[string]any{
                "html": html,
        }
        if len(pruneXPath) > 0 {
                reqPayload["pruneXPath"] = pruneXPath
        }
        body, err := json.Marshal(reqPayload)
        if err != nil {
                return TrafilaturaExtractResult{Ok: false, Error: err.Error()}
        }
        req, err := http.NewRequestWithContext(ctx, "POST", bridgeURL+"/extract", bytes.NewReader(body))
        if err != nil {
                return TrafilaturaExtractResult{Ok: false, Error: err.Error()}
        }
        req.Header.Set("Content-Type", "application/json")
        // R42-1B: 用进程级 trafilaturaCallClient (取代 http.DefaultClient)
        resp, err := trafilaturaCallClient.Do(req)
        if err != nil {
                if isDefault {
                        trafilaturaInst.mu.Lock()
                        f := false
                        trafilaturaInst.available = &f
                        trafilaturaInst.checkedAt = time.Now().UnixMilli()
                        trafilaturaInst.mu.Unlock()
                }
                return TrafilaturaExtractResult{Ok: false, Error: "调用失败: " + err.Error()}
        }
        defer resp.Body.Close()
        if resp.StatusCode != 200 {
                if isDefault {
                        trafilaturaInst.mu.Lock()
                        f := false
                        trafilaturaInst.available = &f
                        trafilaturaInst.checkedAt = time.Now().UnixMilli()
                        trafilaturaInst.mu.Unlock()
                }
                return TrafilaturaExtractResult{Ok: false, Error: fmt.Sprintf("bridge HTTP %d", resp.StatusCode)}
        }
        var data struct {
                Ok    bool   `json:"ok"`
                Text  string `json:"text"`
                Error string `json:"error"`
        }
        respBody, err := io.ReadAll(io.LimitReader(resp.Body, TrafilaturaMaxHTMLBytes))
        if err != nil {
                return TrafilaturaExtractResult{Ok: false, Error: err.Error()}
        }
        if err := json.Unmarshal(respBody, &data); err != nil {
                return TrafilaturaExtractResult{Ok: false, Error: "JSON decode failed"}
        }
        if !data.Ok {
                return TrafilaturaExtractResult{Ok: false, Error: orStr(data.Error, "bridge returned ok:false")}
        }
        return TrafilaturaExtractResult{Ok: true, Text: data.Text}
}

// ---------- 繁简转换 (TODO: OpenCC 词典) ----------
// Go 端无 OpenCC 绑定, 当前为 stub (原样返回). trafilatura 桥侧 (Python 端) 已含
// 繁简转换能力 (lxml + OpenCC 词典加载), 调用桥可补足此能力.

// T2SText — 繁体→简体 (纯文本). Go stub 当前原样返回.
func T2SText(s string) string {
        return s
}

// T2SHtml — HTML 繁体→简体 (仅转标签外文本段). Go stub 当前原样返回.
func T2SHtml(html string) string {
        return html
}

// ---------- removeAdLines (URL 保护 + 内置 EXTRA_AD_PATTERNS) ----------

// EXTRA_AD_SELECTORS — 内置额外广告/导航/弹窗容器选择器 (与 cfg.RemoveSelectors 合并去重).
//  R66-C 通用清洗增强 (用户需求 #11): 审计 71 Rule clean 段后发现 object/embed/svg/meta/link/
//    base/form 0/71 覆盖, .recommend/.tuijian/.popup/.qrcode/.chapter-nav 等通用类名 0/71 覆盖.
//    本轮统一兜底覆盖所有源站共性广告/导航/弹窗容器 + 危险冗余标签.
var EXTRA_AD_SELECTORS = []string{
        // 危险冗余标签 (R66-C: 0/71 覆盖, 兜底剥壳). script/style/iframe/noscript 已在
        //   cleanContentHtmlSync HTML 分支 line 578 硬剥, 此处追加 object/embed/svg/meta/link/base/form.
        //   HTML 分支会 Find 这些 tag 删 (与 plainText 分支 plainTextScriptStyleRe 同款兜底).
        "object", "embed", "svg", "meta", "link", "base", "form",
        // 通用广告 class 黑名单
        ".ad-container", ".ad-wrap", ".ad-wrapper", ".adbox", ".ad-banner", ".advertisement",
        ".adsbygoogle", ".google-ad", ".ad-slot", ".ad-zone", ".ad-area",
        ".ad", ".ads",
        "#ad", "#ads", "#advertisement", "#banner_ad", "#popup", "#popup-ad",
        ".popup", ".modal-ad", ".modal-advertisement", ".interstitial", ".interstitial-ad", ".splash-ad",
        // 下载/扫码/关注类
        ".download-app", ".app-promo", ".qrcode", ".qr-code", ".scan-download",
        // 推荐/热门/相关 (R66-C: 0/71 覆盖, 兜底)
        ".recommend", ".tuijian", ".tj", ".hot", ".related", ".recommands",
        // 公告 (常含广告)
        ".notice",
        // 横幅/边栏/页脚/页头 (常含广告/友链)
        ".banner", ".top-banner", ".bottom-banner", ".sidebar",
        ".friend-link", ".friendlink", ".link-list", ".footer-link", ".nav-bottom",
        // 浮动元素 (常含广告/CTA)
        ".float-btn", ".float-banner", ".float-toolbar", ".back-to-top",
        // 章节导航/分页 (短链接容器, R49-1B 已用 navLinkRe 段级剥)
        ".chapter-navigate", ".chapter-nav", ".page-navigate",
        // 评论/社交分享 (常含广告)
        ".comment", ".social-share", ".share-btn",
        // 面包屑/工具栏 (非正文)
        ".breadcrumb", ".toolbar",
        // 百度推广
        ".baidu-ad", ".baidu-promo", "[class*=\"baidu_promote\"]",
}

// EXTRA_AD_PATTERNS — 内置额外广告正则文案 (与 cfg.AdPatterns 合并, 后于用户配置跑).
//  R49-1B: 扩展 "下载APP..." 残留尾词 + "未完待续" 残留 + 本书/本站 首发 兜底.
//  R54-1B: 扩展 "本站..." 法律免责声明 8 条 + "请收藏本站...手机版" CTA + "本站最新网址"
//    通知类水印 (审计 DB 53 条 enabled 规则后发现多条规则自定义 adPatterns 重复出现这些
//    模式, 提为全局兜底覆盖所有规则). 选保守模式 (要求完整短语或带特定后缀如 "手机版"
//    "来源于网络" 防误伤正文).
var EXTRA_AD_PATTERNS = []string{
        `本章未完.{0,8}点击下一页继续阅读`,
        `请记住本书.{0,12}域名`,
        `最新章节请到.{0,30}查看`,
        `一秒记住.{0,12}免费读`,
        `为您提供.{0,16}精彩小说`,
        `本[书站](?:首发|更新最快|最新章节).{0,30}《`,
        `下载(?:APP|客户端|手机版).{0,30}`,
        `扫码(?:关注|下载|领取).{0,20}`,
        `关注(?:微信公众号|公众号).{0,20}`,
        `加入书签.{0,15}继续阅读`,
        `为了方便下次阅读.{0,30}`,
        `推荐阅读.{0,20}本书`,
        `本章(?:未完|未完待续|继续阅读).{0,8}`,
        `第[一二三四五六七八九十百千万0-9]+(?:章|节|回|话|集).{0,4}(?:未完|继续|下一页)`,
        `未完待续.{0,12}`,
        `本[书站].{0,4}(?:域名|网址|地址)[：:].{0,50}`,
        `友情链接[:：].{0,200}`,
        `(?:www\.)?[a-z0-9-]+\.(?:com|net|cc|org|info|top|xyz|vip|site)(?:首发|更新|整理|出品)`,
        // R54-1B 新增: 本站法律免责声明 + 收藏本站 CTA + 站点 URL 变更通知.
        //   保守锚点: 要求完整短语或带特定后缀 ("手机版" / "来源于网络" / "阅读平台")
        //   防误伤正文. `[^。\n<>]*` 限定到句末 (。/换行/<) 不跨段.
        `本站所收录作品[^。\n<>]*`,
        `本站所有小说[^。\n<>]*(?:转载|收集|整理)[^。\n<>]*`,
        `本站内容来源于网络[^。\n<>]*`,
        `本站作品收集整理自网络[^。\n<>]*`,
        // R56-1B 修复 BUG-F: 原 `本站小说由程序自动索引[^。\n]*` 漏 `<>` 排除, HTML 模式
        //   下段间无换行/句号时 (`</p><p>`) 会跨段贪婪匹配到字符串末尾, 误删后续段落
        //   (e.g. `<p>段落1</p><p>本站小说由程序自动索引，如有侵权请联系我们</p><p>段落2</p>`
        //   → "本站小说...[^。\n]*" 一直匹配到末尾, 删掉 "段落2"). 改 `[^。\n<>]*` 与其他
        //   7 条同款 (停在 。/换行/< 之前, 不跨段). plainText 模式段间是 \n, 也安全.
        `本站小说由程序自动索引[^。\n<>]*`,
        `本站只为[^。\n<>]*提供[^。\n<>]*阅读平台[^。\n<>]*`,
        `请收藏本站[^。\n<>]*手机版`,
        `本站最新网址[^。\n<>]*`,
        // R66-C 通用清洗增强 (用户需求 #11): 审计 71 Rule clean 段后发现版权声明/搜索站点推广/
        //   笔趣阁系/69书吧 等共性水印 0/71 覆盖 (本书首发仅 2/71, 版权所有 0/71, 搜小说 0/71).
        //   本轮兜底覆盖所有源站共性法律声明 + 站名水印 + 回帖看章节等论坛广告.
        //   保守锚点: `[^。\n<>]*` 限定到句末/换行/< 不跨段 (与 R56-1B BUG-F 同款防御).
        `版权所有[^。\n<>]*`,
        `本书来源于[^。\n<>]*`,
        `本书由[^。<>\n]{0,20}(?:首发|出品|整理)[^。\n<>]*`,
        `本[书站]首发[^。\n<>]*`,
        `请到[^。\n<>]{0,30}(?:最新|新)域名[^。\n<>]*`,
        `本站地址[^。\n<>]{0,30}[：:][^。\n<>]*`,
        `笔趣阁[^。\n<>]*(?:首[发页]|更新最快|最新章节|手机版)[^。\n<>]*`,
        `69(?:书吧|shuba)[^。\n<>]*(?:首[发页]|更新|手机版)[^。\n<>]*`,
        `搜(?:小说|书)?网[^。\n<>]*(?:首[发页]|更新|手机版)[^。\n<>]*`,
        `回复[^。\n<>]{0,10}看[^。\n<>]*章节`,
        `请记住本站[^。\n<>]*网址`,
        `本[书站]永久地址[^。\n<>]*`,
        `感谢书友[^。\n<>]*支持`,
}

var (
        reDoSNestedQuantifierAd = regexp.MustCompile(`[+*]\s*\)\s*[+*{]`)
        urlProtectRe            = regexp.MustCompile(`https?://[^\s"'<>]+`)
        urlPlaceholderRe        = regexp.MustCompile("\x00(\\d+)\x00")

        // R47-1A: 预编译 cleaner.go 内 hot path 用的 regexp (原每次调用 cleanContentHtmlSync
        //   / NormalizeParagraphs 都重编译, 高频路径 GC 压力大. R45-1C 已对 smart.go 同款优化).

        // NormalizeParagraphs 内层
        twoNewlineRe = regexp.MustCompile(`\n{2,}`)
        wsCollapseRe = regexp.MustCompile(`\s+`)

        // cleanContentHtmlSync plainText 分支
        plainTextScriptStyleRe = regexp.MustCompile(`(?is)<(?:script|style|noscript|iframe|object|embed)\b[^>]*>.*?</(?:script|style|noscript|iframe|object|embed)\s*>`)
        plainTextScriptStyleSelfRe = regexp.MustCompile(`(?is)<(?:script|style|noscript|iframe|object|embed)\b[^>]*/>`)
        plainTextScriptStyleTailRe = regexp.MustCompile(`(?is)<(?:script|style|noscript|iframe|object|embed)\b[^>]*>.*`)
        plainTextBrRe       = regexp.MustCompile(`(?i)<\s*br\s*/?\s*>`)
        plainTextBlockEndRe = regexp.MustCompile(`(?i)</(p|div|h[1-6]|li)>`)
        // R49-1B: </a> 段间分隔 (小说章节 <a> 多为独立导航链接, 非内联;
        //   让 <a>text</a> 独立成段, stripPlainTextPromoSegments 段级命中 navLinkRe 整段剥)
        plainTextAnchorEndRe = regexp.MustCompile(`(?i)</a>`)
        plainTextTagStripRe = regexp.MustCompile(`<[^>]+>`)

        // cleanContentHtmlSync HTML 分支 (在函数内联, 每章节重编译. R47-1A 提为包级)
        navLinkRe = regexp.MustCompile(`^(下一页|上一页|下页|上页|目录|首?页|尾?页|返回目录|继续阅读|点击阅读|分页阅读?|加入书签|推荐本书?|报错).{0,4}$`)
        watermarkDomainRe = regexp.MustCompile(`(?i)(www\.)?[a-z0-9-]+\.(com|net|cc|org|info|top|xyz|vip|site)`)
        watermarkPromoRe1 = regexp.MustCompile(`敬请(?:期待|关注)|扫码(?:关注|下载)|加入书签|关注微信公众号|为了方便下次阅读`)
        watermarkPromoRe2 = regexp.MustCompile(`本章(?:未完|未完待续|继续阅读)|点击下一(?:页|章)`)
        watermarkPromoRe3 = regexp.MustCompile(`本书首发于|请记住本书|最新章节请到|一秒记住`)
        watermarkPromoRe4 = regexp.MustCompile(`为您提供.*?精彩小说|本站(?:首发|更新最快)`)
        watermarkPromoRe5 = regexp.MustCompile(`下载(?:APP|客户端|手机版)`)

        // 5.5 段内 br 压单空格 + 全角空格 + 多空白合并 (在 Each 内层, 每段都重编译)
        indentBrRe    = regexp.MustCompile(`(?i)<\s*br\s*/?\s*>`)
        indentWsRe    = regexp.MustCompile(`\s+`)
        // 6. 首末段剥离的章节号 / Chapter N 识别
        // R57-1B 修复 BUG-G: chapterHeadCNRe 原用 `\b` (ASCII 词边界), 对中文无效.
        //   Go RE2 的 `\b` 是 ASCII word boundary ([A-Za-z0-9_] vs non-ASCII word char).
        //   "第一章 引子" 中 "章" (non-ASCII) 后接空格 (non-ASCII whitespace),
        //   `\b` 在两个 non-ASCII word char 之间不匹配 → chapterHeadCNRe 整体不命中 →
        //   首段章节号剥离功能失效 (R49-1B 起 latent, R47-1A 提为包级未发现).
        //   修复: 去掉 `\b` (因 `第N章` 结构本身够独特, 不需要边界保护; 后续可选
        //   lookahead 但无必要). 同步审计 chapterHeadENRe 无 `\b` (英文 Chapter N
        //   后接 \s+ 已隔离良好), 不动.
        chapterHeadCNRe = regexp.MustCompile(`^第[一二三四五六七八九十百千万0-9]+(?:章|节|回|话|集)`)
        chapterHeadENRe = regexp.MustCompile(`(?i)^Chapter\s+\d+`)
        chapterTailRe   = regexp.MustCompile(`本章(?:未完|未完待续|继续阅读)|点击下一(?:页|章)|敬请(?:期待|关注)|加入书签|为了方便下次阅读`)

        // 4. 规范化 (空段落合并 + <br><br> → </p><p>)
        normBrDoubleRe = regexp.MustCompile(`(?i)<\s*br\s*/?\s*>\s*<\s*br\s*/?\s*>`)
        normEmptyPRe   = regexp.MustCompile(`(?i)<p>(?:\s|&nbsp;|<br\s*/?\s*>)*</p>`)
        normPOpenRe    = regexp.MustCompile(`(?i)<p>\s+`)
        normPCloseRe   = regexp.MustCompile(`(?i)\s+</p>`)
        // 5. 无 p 标签的检测
        hasPOrBrRe     = regexp.MustCompile(`(?i)<(p|br)\b`)
        // 7. </p>\s*<p> 压缩
        pBoundaryRe   = regexp.MustCompile(`(?i)</p>\s*<p>`)

        // R49-1B: NormalizeParagraphs 用的 Unicode 空格归一化 (NBSP/Ogham/各种 space/NNBSP/MMSP/全角空格)
        //   原 \s+ 仅匹配 ASCII whitespace, 漏 U+00A0/U+1680/U+2000-U+200A/U+202F/U+205F/U+3000.
        unicodeWsRe = regexp.MustCompile(`[\x{00A0}\x{1680}\x{2000}-\x{200A}\x{202F}\x{205F}\x{3000}]`)

        // R47-1A: CleanTextField / CleanIntro / stripTrailingPromo / stripLeadingMetadata
        //   内联 regexp 提为包级 (原每书/每章节都重编译, hot path GC 压力大)
        cleanTextFieldTagStripRe = regexp.MustCompile(`<[^>]+>`)
        cleanTextFieldWsRe       = regexp.MustCompile(`[\r\n\t]+`)
        cleanTextFieldWs2Re     = regexp.MustCompile(`\s{2,}`)
        cleanTextFieldWatermarkRe = regexp.MustCompile(`^(?:本书首发于|转载请注明出处|本书来源于|本书首发自)[^，。；]*[，。；]?`)

        cleanIntroBrRe      = regexp.MustCompile(`(?i)<\s*br\s*/?\s*>`)
        cleanIntroBlockEndRe = regexp.MustCompile(`(?i)</(p|div)>`)
        cleanIntroTagStripRe = regexp.MustCompile(`<[^>]+>`)

        promoTrailRe = regexp.MustCompile(`本书首发于|请记住本书|最新章节请到|一秒记住|为您提供.*?精彩小说|本站(?:首发|更新最快)|下载(?:APP|客户端|手机版)`)
        metaLeadingRe = regexp.MustCompile(`(?m)^\s*(?:字数|状态|分类|类型|作者|更新时间|最后更新)[:：].{0,80}$`)

        // R65-C BUG-42 (P2) 修复: RemoveAdLines 原每调用对 27 个 EXTRA_AD_PATTERNS +
        //   N 个用户 patterns 逐个 regexp.Compile, hot path (每章节 2 次 RemoveAdLines:
        //   plainText 分支 + HTML 分支). 1000 章任务 = 54000 次 compile → CPU 浪费
        //   ~1-2s + GC 压力. 修复:
        //   1. extraAdPatternsCompiled — EXTRA_AD_PATTERNS 包级 init 预编译一次
        //   2. removeAdLinesUserCache — 用户 patterns 用 sync.Map 缓存 (key=pattern string,
        //      value=compiledPattern{re, ok}; 首次 compile 后复用, 任务级复用率高)
        extraAdPatternsCompiled = compileAdPatterns(EXTRA_AD_PATTERNS)
)

// compiledAdPattern — RemoveAdLines 用户 pattern 编译结果 (cache value).
//   ok=false 表示 pattern 无效 (compile 失败 / 超长 / ReDoS), 调用方跳过.
type compiledAdPattern struct {
        re *regexp.Regexp
        ok bool
}

// removeAdLinesUserCache — 用户 pattern → 编译结果缓存 (sync.Map, 任务级复用).
var removeAdLinesUserCache sync.Map

// compileAdPatterns — 批量编译 pattern 列表, 跳过空 / 超长 / ReDoS / compile 失败.
//   caller: init() 时编译 EXTRA_AD_PATTERNS; RemoveAdLines 时按需查缓存编译用户 patterns.
func compileAdPatterns(patterns []string) []*regexp.Regexp {
        out := make([]*regexp.Regexp, 0, len(patterns))
        for _, p := range patterns {
                if re := compileSingleAdPattern(p); re != nil {
                        out = append(out, re)
                }
        }
        return out
}

// compileSingleAdPattern — 单 pattern 编译 + ReDoS 闸门 + 长度闸门.
//   返 nil 表示跳过 (空 / 超长 / ReDoS / compile 失败).
func compileSingleAdPattern(p string) *regexp.Regexp {
        if p == "" || len(p) > 300 {
                return nil
        }
        if reDoSNestedQuantifierAd.MatchString(p) {
                return nil
        }
        re, err := regexp.Compile("(?i)" + p)
        if err != nil {
                return nil
        }
        return re
}

// compileUserAdPattern — 用户 pattern 编译 + 缓存 (sync.Map).
//   首次 compile 后复用; ok=false 也缓存 (避免重复 compile 失败 pattern).
func compileUserAdPattern(p string) (*regexp.Regexp, bool) {
        if v, ok := removeAdLinesUserCache.Load(p); ok {
                cp := v.(compiledAdPattern)
                return cp.re, cp.ok
        }
        re := compileSingleAdPattern(p)
        cp := compiledAdPattern{re: re, ok: re != nil}
        removeAdLinesUserCache.Store(p, cp)
        return cp.re, cp.ok
}

// RemoveAdLines — 广告正则清洗 + URL 保护.
//  1. 先把 https?://... 完整 URL 掩码成 \x00N\x00 占位符
//  2. 跑广告正则 (用户配置优先, 内置 EXTRA_AD_PATTERNS 后跑在剩余文本上)
//  3. 还原 URL 占位符, 清残留 \x00
// R65-C BUG-42 (P2) 修复: 原实现对每 pattern 调 regexp.Compile (?i + p), hot path
//   每章节 2 次 RemoveAdLines × 27+ patterns = 54+ compile / 章. 1000 章任务 =
//   54000+ compile, ~1-2s CPU 浪费 + GC 压力. 修复: ① EXTRA_AD_PATTERNS 包级 init
//   预编译 (extraAdPatternsCompiled); ② 用户 patterns 用 sync.Map 缓存
//   (removeAdLinesUserCache, 任务级复用率高, 首次 compile 后零开销).
func RemoveAdLines(text string, patterns []string) string {
        if text == "" {
                return ""
        }
        urls := []string{}
        out := urlProtectRe.ReplaceAllStringFunc(text, func(m string) string {
                urls = append(urls, m)
                return fmt.Sprintf("\x00%d\x00", len(urls)-1)
        })
        // 用户 patterns (缓存复用)
        for _, p := range patterns {
                if re, ok := compileUserAdPattern(p); ok && re != nil {
                        out = re.ReplaceAllString(out, "")
                }
        }
        // 内置 EXTRA_AD_PATTERNS (包级 init 预编译, 零 compile 开销)
        for _, re := range extraAdPatternsCompiled {
                out = re.ReplaceAllString(out, "")
        }
        // 还原 URL
        out = urlPlaceholderRe.ReplaceAllStringFunc(out, func(m string) string {
                sub := urlPlaceholderRe.FindStringSubmatch(m)
                if len(sub) < 2 {
                        return ""
                }
                var idx int
                fmt.Sscanf(sub[1], "%d", &idx)
                if idx >= 0 && idx < len(urls) {
                        return urls[idx]
                }
                return ""
        })
        // 清残留 \x00
        out = strings.ReplaceAll(out, "\x00", "")
        return out
}

// ---------- 控制字符 + 零宽字符剥离 ----------

// CcAndZwStripRe — 控制字符 (除 \t \n \r) + 零宽字符 + 不可见排版字符 + 乱码替换符剥离正则.
//  R49-1B: 扩展覆盖范围 (原仅 C0 + U+200B-C/U+2060/U+FEFF). 新增:
//   - U+007F (DEL), U+0080-U+009F (C1 控制: NEL 等 Windows 风格源站杂符)
//   - U+00AD (Soft Hyphen — 段内连字符, 中文站罕见但偶发)
//   - U+200E (LRM), U+200F (RLM) — 左右方向标记 (中英混排站偶发)
//   - U+2028 (LSP), U+2029 (PSP) — Unicode 行/段分隔符
//   - U+2061-U+2064 (Invisible Math Operators: f / a / d / =)
//   - U+2066-U+2069 (Bidi Isolate Marks: LRI/RLI/FSI/PDI)
//   (U+00A0 NBSP / U+3000 全角空格等 Unicode 空格不在此剥, 由 NormalizeParagraphs
//    的 unicodeWsRe 归一化到 ASCII 空格.)
//  R66-C 通用清洗增强 (用户需求 #11): 加 U+FFFD (REPLACEMENT CHARACTER) 乱码替换符.
//    源站 GBK/UTF-8 编码混淆时, decoder 把无效字节替换为 U+FFFD, 表现为 "□" 豆腐块.
//    正文里残留 U+FFFD = 编码 bug 痕迹, 应剥离. (极少源站正文用 U+FFFD 作装饰符,
//    误伤概率极低; 与任务 #11 通用乱码清洗要求一致.)
//  R39-1C: Go RE2 不支持 \u 转义, 改用 \x{XXXX} 语法 (与 init 不再 panic).
var CcAndZwStripRe = regexp.MustCompile(`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x{0080}-\x{009F}\x{00AD}\x{200B}-\x{200F}\x{2028}\x{2029}\x{2060}-\x{2069}\x{FEFF}\x{FFFD}]`)

// ZWStripOnlyRe — 仅零宽字符 + 不可见排版字符 (用于纯文本字段, 不剥控制字符).
//  R49-1B: 同 CcAndZwStripRe 的零宽部分扩展 (新增 LRM/RLM/SHY/LSP/PSP/invisible operators/Bidi isolate).
//  R66-C 通用清洗增强 (用户需求 #11): 加 U+FFFD 乱码替换符 (与 CcAndZwStripRe 同款).
var ZWStripOnlyRe = regexp.MustCompile(`[\x{00AD}\x{200B}-\x{200F}\x{2028}\x{2029}\x{2060}-\x{2069}\x{FEFF}\x{FFFD}]`)

// CcStripOnlyRe — 仅控制字符 (C0 + DEL + C1; \t\n\r 不在剥离类内).
//  R49-1B: 扩展 C1 (U+0080-U+009F) + DEL (U+007F) 覆盖 (Windows 风格源站偶发 NEL 等).
var CcStripOnlyRe = regexp.MustCompile(`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x{0080}-\x{009F}]`)

// ---------- 段落规整 ----------

// NormalizeParagraphs — 段落规整: 空行压缩 + 缩进统一 + 段内多换行压单空格.
//  - 入参 s (任意换行形式: \r\n / \n / \r / U+2028 / U+2029)
//  - 出参按 \n\n 分段 (双换行段间分隔)
//  - 段内多换行压单空格; Unicode 空格 (NBSP/U+3000/U+2000-U+200A 等) → ASCII 空格; 多空白合并
// R47-1A: 内层 regexp (twoNewlineRe / wsCollapseRe / unicodeWsRe) 提为包级预编译,
//   避免每次调用都重编译 (NormalizeParagraphs 是 hot path, 每章节正文 + 简介都跑).
// R49-1B: 预规范化换行符 (\r\n → \n / \r → \n / U+2028 → \n / U+2029 → \n\n),
//   原 \r → 空格把 \r\n\r\n 拆成 "\n \n" (中间空格), 导致 \n{2,} 无法识别双换行段间分隔.
//   新增 unicodeWsRe 替换 Unicode 空格 (NBSP/U+1680/U+2000-U+200A/U+202F/U+205F/U+3000)
//   到 ASCII 空格, 原 \s+ 仅匹配 ASCII whitespace 漏掉这些 Unicode 空格.
func NormalizeParagraphs(s string, separator string) string {
        if s == "" {
                return ""
        }
        // R49-1B: 预规范化换行 — \r\n → \n, \r → \n (Mac 经典), U+2028 (LSP) → \n, U+2029 (PSP) → \n\n
        s = strings.ReplaceAll(s, "\r\n", "\n")
        s = strings.ReplaceAll(s, "\r", "\n")
        s = strings.ReplaceAll(s, "\u2028", "\n")
        s = strings.ReplaceAll(s, "\u2029", "\n\n")
        // R49-1B: Unicode 空格 → ASCII 空格 (\s+ 仅匹配 ASCII whitespace, 漏 NBSP 等)
        s = unicodeWsRe.ReplaceAllString(s, " ")
        // 按双换行 (>=2 个连续换行) 分段
        segs := twoNewlineRe.Split(s, -1)
        out := []string{}
        for _, seg := range segs {
                // 段内 \n → 空格 (单行段); 多空白合并
                seg = strings.ReplaceAll(seg, "\n", " ")
                seg = wsCollapseRe.ReplaceAllString(seg, " ")
                seg = strings.TrimSpace(seg)
                if seg != "" {
                        out = append(out, seg)
                }
        }
        return strings.Join(out, separator)
}

// ---------- cleanContentHtml (主入口) ----------

// cleanContentHtmlSync — 同步版清洗 (不含 trafilatura 桥调用).
//  cfg.plainText=true: 剥全部标签 + 控制字符剥离 + 零宽字符剥离 + 段落规整
//  cfg.plainText=false: HTML 模式 (白名单剥壳 + removeSelectors + 段落规整 + 首末段剥离)
func cleanContentHtmlSync(raw string, cfg CleanConfig) string {
        if raw == "" {
                return ""
        }
        // 字面 \n → 真实换行 (源站二次转义 JSON 体)
        html := strings.ReplaceAll(raw, "\\n", "\n")
        // 繁简转换 (Go stub)
        html = T2SHtml(html)

        if cfg.PlainText {
                // 纯文本模式: 剥全部标签
                text := html
                // 1. 先剥危险标签 (script/style/noscript/iframe/object/embed) 及其内部文本
                // RE2 不支持 \1 反向引用, 关闭标签用独立 alternation 匹配 (R45-1C 修原 panic bug)
                // R47-1A: 预编译为包级 plainTextScriptStyleRe / plainTextScriptStyleSelfRe /
                //   plainTextScriptStyleTailRe (原每次调用 cleanContentHtmlSync 都重编译,
                //   hot path GC 压力大).
                text = plainTextScriptStyleRe.ReplaceAllString(text, " ")
                text = plainTextScriptStyleSelfRe.ReplaceAllString(text, " ")
                // 截断/未闭合的 script|style|... 段 — 贪婪匹配到串尾
                text = plainTextScriptStyleTailRe.ReplaceAllString(text, " ")
                // 2. <br> → \n
                text = plainTextBrRe.ReplaceAllString(text, "\n")
                // 3. 块级闭合标签 → \n\n (R49-1B: 原 \n 单换行让 </p><p> 间段合并;
                //   改 \n\n 双换行让 NormalizeParagraphs \n{2,} 分段识别段间分隔)
                text = plainTextBlockEndRe.ReplaceAllString(text, "\n\n")
                // 3.5 </a> → \n\n (R49-1B: 让 <a>text</a> 独立成段,
                //   stripPlainTextPromoSegments 段级命中 navLinkRe 整段剥)
                text = plainTextAnchorEndRe.ReplaceAllString(text, "\n\n")
                // 4. 剥全部标签
                text = plainTextTagStripRe.ReplaceAllString(text, "")
                // 5. 实体单遍解码
                text = DecodeEntitiesOnce(text)
                // 6. 广告正则清洗
                text = RemoveAdLines(text, cfg.AdPatterns)
                // 7. 段落规整 (\n\n 分段)
                text = NormalizeParagraphs(text, "\n\n")
                // 7.5 段级水印/导航/推广段剥离 (R49-1B: 原 plainText 模式无 cheerio Each,
                //   短段命中水印/导航词漏剥. 调 stripPlainTextPromoSegments 同 HTML 模式口径)
                text = stripPlainTextPromoSegments(text)
                // 8. 控制字符 + 零宽字符剥离
                text = CcAndZwStripRe.ReplaceAllString(text, "")
                return text
        }

        // HTML 模式
        // 包 <div id="__clean_root"> 让 cheerio 规范化
        doc, err := goquery.NewDocumentFromReader(strings.NewReader(`<div id="__clean_root">` + html + `</div>`))
        if err != nil {
                return raw
        }
        root := doc.Find("#__clean_root")
        // 0. 硬移除脚本/样式类标签
        root.Find(`script, style, noscript, iframe, object, embed`).Remove()
        // 0.5 移除隐藏元素 (R49-1B: [hidden] 属性 + style 含 display:none / visibility:hidden).
        //   原 cleaner 仅剥 script/style, 源站常在正文容器内插 display:none 段投放 SEO 关键词
        //   或暗广告. goquery Find 支持 [hidden] 属性选择器; style 属性需 Each + 字符串匹配
        //   (Cascadia 的 [style*=...] 子串匹配大小写敏感 + 不处理空格变体, 故手动 ToLower + 去空格).
        root.Find(`[hidden]`).Remove()
        root.Find(`[style]`).Each(func(_ int, s *goquery.Selection) {
                if len(s.Nodes) == 0 {
                        return
                }
                style := strings.ToLower(s.AttrOr("style", ""))
                styleNoSpace := strings.ReplaceAll(style, " ", "")
                if strings.Contains(styleNoSpace, "display:none") ||
                        strings.Contains(styleNoSpace, "visibility:hidden") {
                        s.Remove()
                }
        })
        // 1. 移除指定选择器 (用户配置优先, 内置 EXTRA_AD_SELECTORS 后跑)
        mergedSelectors := []string{}
        mergedSelectors = append(mergedSelectors, cfg.RemoveSelectors...)
        for _, extra := range EXTRA_AD_SELECTORS {
                found := false
                for _, s := range mergedSelectors {
                        if s == extra {
                                found = true
                                break
                        }
                }
                if !found {
                        mergedSelectors = append(mergedSelectors, extra)
                }
        }
        for _, sel := range mergedSelectors {
                root.Find(sel).Remove()
        }
        // 1.5 移除分页/导航链接 (下一页/上一页/目录/继续阅读等短链接)
        // R47-1A: navRe 提为包级 navLinkRe (原每次 cleanContentHtmlSync 都重编译)
        root.Find("a").Each(func(_ int, s *goquery.Selection) {
                t := strings.TrimSpace(s.Text())
                if t != "" && navLinkRe.MatchString(t) {
                        s.Remove()
                }
        })
        // 1.55 水印段落识别 (短段 ≤120 字 + 命中水印特征词 → 整段删)
        // R47-1A: watermarkRe1..6 提为包级 watermarkDomainRe / watermarkPromoRe1..5
        //   (原每次 cleanContentHtmlSync 都重编译, hot path GC 压力大)
        root.Find("p").Each(func(_ int, s *goquery.Selection) {
                t := strings.TrimSpace(s.Text())
                if t == "" {
                        return
                }
                if utf8.RuneCountInString(t) > 120 {
                        return
                }
                if watermarkDomainRe.MatchString(t) || watermarkPromoRe1.MatchString(t) || watermarkPromoRe2.MatchString(t) ||
                        watermarkPromoRe3.MatchString(t) || watermarkPromoRe4.MatchString(t) || watermarkPromoRe5.MatchString(t) {
                        s.Remove()
                }
        })
        // 2. 白名单外的标签剥壳保文本
        whitelistSet := map[string]bool{}
        for _, t := range cfg.Whitelist {
                whitelistSet[strings.ToLower(t)] = true
        }
        root.Find("*").Each(func(_ int, s *goquery.Selection) {
                tag := goquery.NodeName(s)
                tag = strings.ToLower(tag)
                if tag != "" && !whitelistSet[tag] {
                        s.ReplaceWithSelection(s.Contents())
                }
        })
        // 2.5 白名单标签属性消毒 (a href / img src 必须 http(s); img alt 任意; 其余剥)
        root.Find("*").Each(func(_ int, s *goquery.Selection) {
                tag := strings.ToLower(goquery.NodeName(s))
                if len(s.Nodes) == 0 {
                        return
                }
                // 收集所有属性名, 非白名单的 RemoveAttr
                attrNames := []string{}
                for _, attr := range s.Nodes[0].Attr {
                        attrNames = append(attrNames, attr.Key)
                }
                for _, name := range attrNames {
                        val := s.AttrOr(name, "")
                        keep := false
                        if tag == "a" && name == "href" {
                                keep = matchedHTTP(val)
                        } else if tag == "img" && name == "src" {
                                keep = matchedHTTP(val)
                        } else if tag == "img" && name == "alt" {
                                keep = true
                        }
                        if !keep {
                                s.RemoveAttr(name)
                        }
                }
        })
        out, _ := root.Html()
        // 3. 广告正则清洗
        out = RemoveAdLines(out, cfg.AdPatterns)
        // 4. 规范化 (空段落合并 + <br><br> → </p><p>)
        // R47-1A: 内联 regexp 提为包级 normBrDoubleRe / normEmptyPRe / normPOpenRe /
        //   normPCloseRe / hasPOrBrRe / pBoundaryRe (原每次调用都重编译)
        if cfg.Normalize {
                out = "<p>" + out + "</p>"
                out = normBrDoubleRe.ReplaceAllString(out, "</p><p>")
                out = normEmptyPRe.ReplaceAllString(out, "")
                out = normPOpenRe.ReplaceAllString(out, "<p>")
                out = normPCloseRe.ReplaceAllString(out, "</p>")
        }
        // 5. 若无任何 p 标签, 按换行重建段落
        if !hasPOrBrRe.MatchString(out) {
                lines := strings.Split(out, "\n")
                var b strings.Builder
                for _, l := range lines {
                        l = strings.TrimSpace(l)
                        if l != "" {
                                b.WriteString("<p>")
                                b.WriteString(l)
                                b.WriteString("</p>")
                        }
                }
                out = b.String()
        }
        // 5.5 段首缩进规整 + 段内 <br> 压单空格
        if doc2, err := goquery.NewDocumentFromReader(strings.NewReader(`<div id="__indent_root">` + out + `</div>`)); err == nil {
                root2 := doc2.Find("#__indent_root")
                root2.Find("p").Each(func(_ int, s *goquery.Selection) {
                        h, _ := s.Html()
                        // R47-1A: indentBrRe / indentWsRe 提为包级 (原每段都重编译)
                        h = indentBrRe.ReplaceAllString(h, " ")
                        h = strings.ReplaceAll(h, "\u3000", " ")
                        h = indentWsRe.ReplaceAllString(h, " ")
                        h = strings.TrimSpace(h)
                        s.SetHtml(h)
                })
                out, _ = root2.Html()
        }
        out = pBoundaryRe.ReplaceAllString(out, "</p><p>")
        // 6. 首末段剥离 (短段 ≤80 字匹配章节号归一化形态 / 末段 ≤200 字命中水印特征词)
        if doc3, err := goquery.NewDocumentFromReader(strings.NewReader(`<div id="__strip_root">` + out + `</div>`)); err == nil {
                root3 := doc3.Find("#__strip_root")
                paras := root3.Find("p")
                // R57-1B 修复 BUG-H: 第 4 步 Normalize `out = "<p>" + out + "</p>"` 包裹
                //   (cleaner.go:619) 让嵌套 <p> 被 HTML5 parser 修复为首末空 <p></p>,
                //   paras.First() / paras.Last() 取到空段 → headText/tailText="" →
                //   chapterHeadCNRe / chapterTailRe 不命中 → 首末段剥离失效.
                //   原 R49-1B 起一直 latent (R49-1B 重点修 plainText 段级剥离, HTML
                //   分支首末段剥离逻辑未审). 修复: 用 Filter 跳过空段, 找首个/末个
                //   非空段做首/末段剥离. 与 plainText 分支 stripPlainTextPromoSegments
                //   同口径 (空段跳过).
                nonEmpty := paras.FilterFunction(func(_ int, s *goquery.Selection) bool {
                        return strings.TrimSpace(s.Text()) != ""
                })
                if nonEmpty.Length() > 0 {
                        first := nonEmpty.First()
                        headText := strings.TrimSpace(first.Text())
                        if utf8.RuneCountInString(headText) <= 80 {
                                // R47-1A: chapterHeadCNRe / chapterHeadENRe 提为包级 (原每次调用都重编译)
                                if chapterHeadCNRe.MatchString(headText) || chapterHeadENRe.MatchString(headText) {
                                        first.Remove()
                                }
                        }
                }
                paras2 := root3.Find("p")
                nonEmptyLast := paras2.FilterFunction(func(_ int, s *goquery.Selection) bool {
                        return strings.TrimSpace(s.Text()) != ""
                })
                if nonEmptyLast.Length() > 0 {
                        last := nonEmptyLast.Last()
                        tailText := strings.TrimSpace(last.Text())
                        if utf8.RuneCountInString(tailText) <= 200 {
                                // R47-1A: chapterTailRe 提为包级 (原每次调用都重编译)
                                if chapterTailRe.MatchString(tailText) || watermarkDomainRe.MatchString(tailText) || watermarkPromoRe3.MatchString(tailText) {
                                        last.Remove()
                                }
                        }
                }
                out, _ = root3.Html()
        }
        // 7. 控制字符 + 零宽字符剥离
        out = CcAndZwStripRe.ReplaceAllString(out, "")
        return strings.TrimSpace(out)
}

// goqueryAttr — placeholder removed (uses html.Attribute from x/net/html directly).

// matchedHTTP — val 是否以 http:// / https:// 开头.
func matchedHTTP(val string) bool {
        v := strings.ToLower(strings.TrimSpace(val))
        return strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://")
}

// CleanContentHtml — 清洗章节正文 HTML (同步, 不调 trafilatura 桥).
// 与 cleanContentHtml 同口径 (useTrafilatura=true 走 caller-side 分流).
func CleanContentHtml(raw string, cfgOverride *CleanConfig) string {
        cfg := DefaultCleanConfig
        if cfgOverride != nil {
                cfg = cloneCleanConfig(*cfgOverride)
        }
        return cleanContentHtmlSync(raw, cfg)
}

// CleanContentHtmlWithTrafilatura — trafilatura first 路径 (useTrafilatura=true).
// 调桥提取正文 → 喂入 plainText 段落规整链 (跳过 cheerio DOM 剥壳阶段).
// 桥不可达/异常/空文本 → 降级回 cheerio 链 (零回归).
func CleanContentHtmlWithTrafilatura(ctx context.Context, raw string, cfgOverride *CleanConfig, bridgeURL string) string {
        cfg := DefaultCleanConfig
        if cfgOverride != nil {
                cfg = cloneCleanConfig(*cfgOverride)
        }
        if raw == "" {
                return ""
        }
        // trafilatura first
        res := CallTrafilaturaExtract(ctx, raw, cfg.TrafilaturaPruneXPath, bridgeURL)
        if res.Ok && res.Text != "" {
                // 喂入 plainText 段落规整链 (与 cleanContentHtmlSync plainText 分支同款)
                text := strings.ReplaceAll(res.Text, "\\n", "\n")
                text = T2SText(text)
                text = RemoveAdLines(text, cfg.AdPatterns)
                text = NormalizeParagraphs(text, "\n\n")
                // R49-1B: 同 plainText 分支调 stripPlainTextPromoSegments 段级水印/导航剥离
                text = stripPlainTextPromoSegments(text)
                text = CcAndZwStripRe.ReplaceAllString(text, "")
                if text != "" {
                        return text
                }
        }
        // 降级回 cheerio 链
        return cleanContentHtmlSync(raw, cfg)
}

// TryTrafilaturaFallback — trafilatura 兜底模式.
// runner 在 sync cleanContentHtml 后, 若结果过短 (<200 字符) 且原 HTML 较长 (>2KB),
// 调本桥做规则无关兜底; 桥结果 >2x cleaner 结果才采纳 (防误判).
func TryTrafilaturaFallback(ctx context.Context, html, cleaned string, cfg CleanConfig, bridgeURL string) string {
        if len(html) <= 2000 || len([]rune(cleaned)) >= 200 {
                return cleaned
        }
        res := CallTrafilaturaExtract(ctx, html, cfg.TrafilaturaPruneXPath, bridgeURL)
        if !res.Ok || res.Text == "" {
                return cleaned
        }
        // 桥结果 >2x cleaner 结果才采纳
        if len([]rune(res.Text)) > 2*len([]rune(cleaned)) {
                text := strings.ReplaceAll(res.Text, "\\n", "\n")
                text = T2SText(text)
                text = RemoveAdLines(text, cfg.AdPatterns)
                text = NormalizeParagraphs(text, "\n\n")
                // R49-1B: 同 plainText 分支调 stripPlainTextPromoSegments 段级水印/导航剥离
                text = stripPlainTextPromoSegments(text)
                text = CcAndZwStripRe.ReplaceAllString(text, "")
                return text
        }
        return cleaned
}

// ---------- cleanTextField (纯文本字段清洗) ----------

// CleanTextField — 清洗纯文本字段 (书名/作者/简介等).
//  1. 剥 HTML 标签
//  2. 实体单遍解码
//  3. 控制字符剥离 (\t \n \r 保留, 供后续按行切段)
//  4. 零宽字符剥离
//  5. 繁简转换 (Go stub)
//  6. 站点水印清洗 + 重复标点压缩
//  7. maxLength 截断 (按码点截断防代理对斩半)
func CleanTextField(raw string, maxLength int) string {
        if raw == "" {
                return ""
        }
        // R47-1A: 内联 regexp 提为包级 (原每书/每章节都重编译)
        v := cleanTextFieldTagStripRe.ReplaceAllString(raw, "")
        v = DecodeEntitiesOnce(v)
        v = CcStripOnlyRe.ReplaceAllString(v, "")
        v = ZWStripOnlyRe.ReplaceAllString(v, "")
        v = T2SText(v)
        v = strings.ReplaceAll(v, "\\n", "\n")
        v = cleanTextFieldWsRe.ReplaceAllString(v, " ")
        v = cleanTextFieldWs2Re.ReplaceAllString(v, " ")
        // 站点水印清洗
        v = cleanTextFieldWatermarkRe.ReplaceAllString(v, "")
        v = strings.TrimSpace(v)
        // 重复标点压缩 (! ? 。 及其全角形式) — RE2 不支持 \1 反向引用,
        // 用单遍扫描压扁相邻相同标点 (R45-1C 修原 panic bug).
        v = collapseDupPunct(v)
        if maxLength > 0 && utf8.RuneCountInString(v) > maxLength {
                runes := []rune(v)
                v = string(runes[:maxLength])
        }
        return v
}

// CleanIntro — 清洗多行简介.
func CleanIntro(raw string, maxLength int) string {
        if raw == "" {
                return ""
        }
        if maxLength <= 0 {
                maxLength = 2000
        }
        // R47-1A: 内联 regexp 提为包级 (原每书简介都重编译)
        v := cleanIntroBrRe.ReplaceAllString(raw, "\n")
        v = cleanIntroBlockEndRe.ReplaceAllString(v, "\n")
        v = cleanIntroTagStripRe.ReplaceAllString(v, "")
        v = DecodeEntitiesOnce(v)
        v = CcStripOnlyRe.ReplaceAllString(v, "")
        v = ZWStripOnlyRe.ReplaceAllString(v, "")
        v = T2SText(v)
        v = RemoveAdLines(v, DefaultCleanConfig.AdPatterns)
        v = strings.ReplaceAll(v, "\\n", "\n")
        // 段落规整 (\n 单换行段间, 与正文双换行不同)
        v = NormalizeParagraphs(v, "\n")
        // 末尾推广段剥离 + 开头元数据剥离
        v = stripTrailingPromo(v)
        v = stripLeadingMetadata(v)
        // 按码点截断
        if utf8.RuneCountInString(v) > maxLength {
                runes := []rune(v)
                v = string(runes[:maxLength])
        }
        return v
}

// stripTrailingPromo — 从末尾向前扫, 连续命中推广词的段全删 (遇到非推广段即停).
func stripTrailingPromo(s string) string {
        lines := strings.Split(s, "\n")
        // R47-1A: promoRe 提为包级 promoTrailRe (原每简介都重编译)
        for i := len(lines) - 1; i >= 0; i-- {
                t := strings.TrimSpace(lines[i])
                if t == "" {
                        continue
                }
                if !promoTrailRe.MatchString(t) {
                        break
                }
                lines = append(lines[:i], lines[i+1:]...)
        }
        return strings.Join(lines, "\n")
}

// stripLeadingMetadata — 简介开头元数据剥离 (字数：xxx万字 / 状态：连载中 / 分类：玄幻 等).
// R65-C BUG-45 (P3) 修复: 原实现 for-loop 跑完所有非空行都命中 meta 模式时 fallthrough
//   到 `return s` (输入整段全是元数据 → 原样返回, 未剥离). 应返回 "" (全部 leading meta
//   已剥). 修复: fallthrough 改 `return ""` (与函数语义一致: 剥完所有 leading meta 后无
//   正文, 返空串让 caller 视为简介为空). 原 `return s` 让 DB Book.intro 列存入纯元数据
//   字串 (e.g. "字数：100\n状态：连载\n分类：玄幻"), 前台渲染简介区显示元数据而非简介.
func stripLeadingMetadata(s string) string {
        // R47-1A: metaRe 提为包级 metaLeadingRe (原每简介都重编译)
        lines := strings.Split(s, "\n")
        for i, l := range lines {
                t := strings.TrimSpace(l)
                if t == "" {
                        continue
                }
                if !metaLeadingRe.MatchString(t) {
                        if i == 0 {
                                return s
                        }
                        return strings.Join(lines[i:], "\n")
                }
        }
        // R65-C BUG-45: 所有非空行均命中 meta (整段为元数据) → 剥完返空串 (原返 s 未剥)
        return ""
}

// collapseDupPunct — 压扁相邻相同标点 (! ? 。 全角 ！？) 为单个出现.
// 原 regexp `([!?。！？])\1+` 用 \1 反向引用, 但 Go RE2 不支持 backref → MustCompile panic.
// 改用单遍 rune 扫描, 语义等价 (仅当连续相同才合并, 不同标点保持原序).
func collapseDupPunct(s string) string {
        var b strings.Builder
        b.Grow(len(s))
        prev := rune(0)
        for _, r := range s {
                if r == prev {
                        switch r {
                        case '!', '?', '。', '！', '？':
                                continue
                        }
                }
                b.WriteRune(r)
                prev = r
        }
        return b.String()
}

// stripPlainTextPromoSegments — plainText 模式段级水印/导航/广告段剥离.
//  plainText 分支无 cheerio DOM 段级 Each 能力, 改在 NormalizeParagraphs 输出
//  (\n\n 分段) 上做段级扫描: 短段 ≤120 字 + 命中水印/导航/章节尾推广词 → 整段删.
//  与 HTML 模式 watermarkDomainRe / watermarkPromoRe1..5 / navLinkRe / chapterTailRe 同口径.
//  R49-1B: 新增 (原 plainText 模式仅 RemoveAdLines 行级正则清洗, 段级水印/导航漏剥,
//   导致 plainText 站点 (JSON API / 纯文本响应) 残留 "下一页"/"目录"/"下载APP..."
//   等短段污染正文). 同步接入 CleanContentHtmlWithTrafilatura / TryTrafilaturaFallback
//   trafilatura 桥两条路径 (桥返回纯文本, 无 DOM, 与 plainText 分支同款问题).
func stripPlainTextPromoSegments(text string) string {
        if text == "" {
                return ""
        }
        segs := twoNewlineRe.Split(text, -1)
        out := make([]string, 0, len(segs))
        for _, seg := range segs {
                t := strings.TrimSpace(seg)
                if t == "" {
                        // 空段跳过 (NormalizeParagraphs 已过滤, 但安全起见再过滤)
                        continue
                }
                rl := utf8.RuneCountInString(t)
                if rl <= 120 {
                        // 短段: 检测水印/导航/章节尾推广特征词 (与 HTML 模式 p.Each 同口径)
                        if navLinkRe.MatchString(t) ||
                                watermarkDomainRe.MatchString(t) ||
                                watermarkPromoRe1.MatchString(t) ||
                                watermarkPromoRe2.MatchString(t) ||
                                watermarkPromoRe3.MatchString(t) ||
                                watermarkPromoRe4.MatchString(t) ||
                                watermarkPromoRe5.MatchString(t) ||
                                chapterTailRe.MatchString(t) {
                                continue // drop this segment
                        }
                }
                out = append(out, seg)
        }
        return strings.Join(out, "\n\n")
}
