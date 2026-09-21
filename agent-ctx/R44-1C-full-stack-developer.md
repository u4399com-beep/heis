# R44-1C — Go 第四轮深度抓 bug + 清理精简

## 任务范围
- 读 worklog.md 末 250 行了解 R41-R43 修复历史
- 读 go-backend/ 全 Go 代码 ~17000 行
- 抓 R43 修复后的边缘 case + 清理精简
- 主要改 go-backend/* (不动 scripts/seed-rule-yueyouxs.ts + DEPLOY.md)

## 审查范围
| 模块 | 行数 | 重点 |
|---|---|---|
| crawl/fetcher.go | 2743 | utls Hello 池 / MarkProxyFailed/OK / 2captcha / fetchPageOnce 8 级降级 |
| crawl/runner.go | 1437 | IncCaptcha / ReportRateLimited / discoverBooks / batchMu defer |
| crawl/parser.go | 1612 | jsonLdTypeRe 预编译 / ParseList/ParseToc/ParseContent |
| crawl/cleaner.go | 722 | trafilaturaCallClient Transport / cleanContentHtml |
| crawl/smart.go | 291 | MatchCategoryByText / DetectCompleteFromText |
| crawl/types.go | 715 | sanitizeFetchConfig / TwoCaptchaAPIKey 白名单 |
| crawl/hostgate.go | 414 | pump / Acquire drain / ReportRateLimited |
| crawl/storage.go | 363 | SaveChapterTxt / SaveCoverWebp 路径穿越防御 |
| main.go | 1173 | 路由 + 模板 + DB (truncate 已 rune-safe) |
| admin.go | 3562 | admin API + 页面装配 (strField byte-slice 不安全) |
| services/* 11 服务 | 5146 | (cloak-browser/main.go stealth 注入 bug; scrapling-bridge Accept br bug) |
| services/bridgeserver | 843 | TruncStr/SafeHeaderValue/SanitizeError byte-slice 不安全 |

## P0 反反爬 bug 修复 (1 处)
### cloak-browser stealth 脚本注入完全失效 (services/cloak-browser/main.go)
**原代码**:
```go
_ = chromedp.Run(browserCtx,
    network.Enable(),
    emulation.SetUserAgentOverride(ua).WithUserAgentMetadata(...),
    chromedp.ActionFunc(func(ctx context.Context) error {
        return chromedp.Evaluate(fmt.Sprintf(`(%s)()`, stealthScript(tier)), nil).Do(ctx)
    }),
)
```

**两 bug 叠加**:
1. `(%s)()` 包裹多 IIFE 段 = JS 语法错
   - `stealthScript(tier)` 返回多个 `(() => {...})(); (() => {...})();` 段
   - 包在 `(...)` 后调用 `()` — JS 括号内只接受单表达式, 多语句以 `;` 分隔不合法
   - V8 报 SyntaxError, 整个脚本不执行
2. `chromedp.Evaluate` 在当前文档 (about:blank) 执行, 导航后上下文销毁
   - 注释声称 "在每个新文档前执行" 但 API 用错 — `chromedp.Evaluate` 是 `Runtime.evaluate` CDP, 只跑一次
   - 真实页面 (导航后) 未注入 stealth JS, 仅靠 chromedp flags (disable-blink-features=AutomationControlled) 兜底
   - puppeteer-extra-stealth 12 项抹平中前 6 项 (navigator.webdriver / chrome runtime / plugins / languages / WebGL / permissions) 全部失效

**修复**:
```go
import "github.com/chromedp/cdproto/page"

_ = chromedp.Run(browserCtx,
    network.Enable(),
    emulation.SetUserAgentOverride(ua).WithUserAgentMetadata(...),
    chromedp.ActionFunc(func(ctx context.Context) error {
        _, err := page.AddScriptToEvaluateOnNewDocument(stealthScript(tier)).Do(ctx)
        return err
    }),
)
```
- 用 `page.AddScriptToEvaluateOnNewDocument` (CDP Page 域) — 脚本在每个新文档加载前自动执行, 跨导航持久
- 直接传 `stealthScript(tier)` 原文 (无 `()()` 包裹), 多 IIFE 语句被 V8 视为程序顶层语句序列, 合法执行
- 顺带清理: 移除 dead import `github.com/chromedp/cdproto/cdp` + 末尾 `var _ = cdp.Node{}` suppress

## P1 反反爬 bug 修复 (1 处)
### scrapling-bridge Accept-Encoding 含 br (services/scrapling-bridge/main.go)
**原代码**:
```go
if req.Header.Get("Accept-Encoding") == "" {
    req.Header.Set("Accept-Encoding", "gzip, deflate, br")
}
```
**Bug**: Go net/http 自动解 gzip/deflate 但不解 brotli. 服务器返 br 时 body 是原始 brotli 字节,
`doFetchStatic` 返回的 html 字段是压缩字节, 引擎侧 parseList/parseBook 解析全炸. R41-1A 已在
fetcher.go buildHeaders 修复 (仅 gzip/deflate), 此处漏改.

**修复**: `req.Header.Set("Accept-Encoding", "gzip, deflate")` (与 fetcher.go 一致)

## P1 byte-slice 截断不安全 (13 处)
全部 `s[:n]` 按字节切片, 中文 (3-byte UTF-8) 在边界处会切出孤立 continuation byte (10xxxxxx),
导致 (a) 日志输出乱码 (b) utf8.Valid 校验失败 (c) 代理对/多字节字符斩半 (d) strings.Contains 误命中.

全部改用 `[]rune` 安全截断:
1. `bridgeserver.go TruncStr` (7 services 共用): `s[:n]` → `string([]rune(s)[:n])`
2. `bridgeserver.go SafeHeaderValue` (HTTP 头值): `v[:8192]` → `string([]rune(v)[:8192])`
3. `bridgeserver.go SanitizeError` (错误脱敏): `s[:200]` → `string([]rune(s)[:200])`
4. `admin.go strField` (admin 字段 name/description/adminNote): `s[:max]` → `string([]rune(s)[:max])`
5. `admin.go adminNote PATCH` (tagStrip 后再截断): `note[:1000]` → `string([]rune(note)[:1000])`
   - 原实现 strField 已 rune 截到 ≤1000, 但 tagStripRE 剥标签后 byte 长度仍可能 >1000 (中文 3 byte/rune,
     350 runes = 1050 bytes), 触发再截断 byte 切片
6. `admin.go ads 数组项` (下载广告文案): `s[:200]` → `string([]rune(s)[:200])`
7. `crawl/smart.go MatchCategoryByText`: `text[:3000]` → `string([]rune(text)[:3000])`
8. `crawl/smart.go DetectCompleteFromText`: `text[:2000]` → `string([]rune(text)[:2000])`
9. `crawl/smart.go SmartCompleteDetect StatusField Reason`: `s[:30]` → `string([]rune(s)[:30])`
10. `services/qimao-proxy handleSearch wd`: `wd[:60]` → `string([]rune(wd)[:60])`
11. `services/qimao-proxy handleRank rankType`: `rankType[:40]` → `string([]rune(rankType)[:40])`
12. `services/scrapling-bridge doFetchBrowser errMsg`: `errMsg[:200]` → `string([]rune(errMsg)[:200])`

## 清理 (1 处)
- `services/cloak-browser/main.go`: 移除 dead import `github.com/chromedp/cdproto/cdp` + 末尾 `var _ = cdp.Node{}`

## 文件改动统计
| 文件 | 原 | 新 | 改动 |
|---|---|---|---|
| services/cloak-browser/main.go | 570 | 577 | stealth 注入修复 + cdp dead import 清理 |
| services/scrapling-bridge/main.go | 432 | 435 | Accept-Encoding br→gzip/deflate + errMsg rune-safe |
| services/bridgeserver/bridgeserver.go | 843 | 856 | TruncStr/SafeHeaderValue/SanitizeError rune-safe |
| services/qimao-proxy/main.go | 800 | 802 | wd/rankType rune-safe |
| admin.go | 3562 | 3570 | strField/adminNote/ads rune-safe |
| crawl/smart.go | 291 | 300 | 3 处 rune-safe |

## 未修改 (尊重约束)
- go-backend/main.go (truncate 已 R42-1A rune-safe 修复, 无需改) ✓
- go-backend/crawl/{fetcher,parser,cleaner,hostgate,storage,types,runner}.go (深度审查无
  R43 后边缘 case, fetcher.go truncate []rune 安全, runner.go truncate []rune 安全) ✓
- services/{bqg713-proxy,deqixs-proxy,fetch-relay,moli-bridge,uc-bridge,xjp-proxy,
  curl-impersonate-bridge,trafilatura-bridge}/main.go (深度审查无 byte-截断 bug) ✓
- scripts/seed-rule-yueyouxs.ts (A agent 创建, 不碰) ✓
- DEPLOY.md (B agent 创建, 不碰) ✓
- prisma/schema.prisma + package.json 0 改动 ✓

## 验证
- go build -o heis-backend . → 0 errors, binary 24,167,974 bytes (24.2MB, 与 R43-1B 24,168,286 持平)
- go vet ./... → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass)
- go vet ./services/cloak-browser/ → 0 warnings (验证 cdp import 移除后无 unused 报警)
- heis-backend 启动: 94 模板加载, http://localhost:3000 (内存 17MB)
- 端到端 curl 测试: GET / → 200 ✓, GET /health → 200 ✓, GET /admin → 200 ✓

## Stage Summary
Go 采集引擎第四轮深度审查 ~17000 行, 抓 1 P0 反反爬 bug (cloak-browser stealth 注入完全失效:
(script)() 包裹多 IIFE 段 = JS 语法错 + chromedp.Evaluate 在 about:blank 上下文执行导航后销毁,
真实页面无 stealth JS, 改用 page.AddScriptToEvaluateOnNewDocument 跨导航持久注入) + 1 P1 反反爬
(scrapling-bridge Accept-Encoding 含 br, Go net/http 不解 brotli, 服务器返 br 时 HTML 全炸, 移除
br 与 fetcher.go 一致) + 13 处 byte-slice 截断不安全 (中文 UTF-8 多字节字符斩半, 改 []rune 安全
截断, 覆盖 bridgeserver TruncStr/SafeHeaderValue/SanitizeError + admin.go strField/adminNote/ads
+ crawl/smart.go MatchCategoryByText/DetectCompleteFromText/SmartCompleteDetect + qimao-proxy
wd/rankType + scrapling-bridge errMsg). 顺带清理 cloak-browser dead import (cdp 包 + var _ suppress).
编译 0 errors, vet 0 warnings, binary 24.2MB. 核心保留 R41-R43 全部修复.
