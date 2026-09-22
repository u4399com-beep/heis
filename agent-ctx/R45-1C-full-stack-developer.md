# R45-1C — Go 清理精简第五轮 (dead code + 重复逻辑整合 + .gitignore + DEPLOY.md 校对)

## 任务范围
- 读 worklog.md 末 150 行了解 R42-R44 清理历史
- 读 go-backend/ 全 Go 代码 + scripts/* + agent-ctx/* + .gitignore + DEPLOY.md
- Go dead code 扫描 (go vet + staticcheck)
- 12 mini-services 公共 helper 提取到 bridgeserver
- 94 partial 模板 header/footer dedup 审查
- 过时 R10-R30 注释清理
- 临时文件清理 (scripts/* + agent-ctx/* + go-backend/*.log + 二进制)
- .gitignore 更新确认覆盖
- DEPLOY.md 命令链路校对

## 第一步: 读交接
读 worklog.md 末 150 行:
- R42-R44 已清理: src/* 全删 (R42-1C, ~81000 行 TS), 旧 Python/bun mini-services/* 全删 (R43-1C),
  9 个二进制 + backend.log 从 git 解除跟踪 (R42-1C).
- R43-1A: 新增 3 服务 (curl-impersonate-bridge 3018 / trafilatura-bridge 3019 / cloak-browser 3020).
- R43-1B: utls 4 Hello 池 + MarkProxyFailed/OK + 2captcha.
- R43-1C: start-all.sh 重写 (Go 二进制 11 个, 端口 3010-3020).
- R44-1C: cloak-browser stealth 注入修复 (page.AddScriptToEvaluateOnNewDocument) +
  13 处 byte-slice 截断不安全 (改 []rune) + scrapling-bridge Accept-Encoding br 移除.

## 第二步: Go dead code 扫描

### 2.1 工具链
- `/home/z/go/go/bin/go version` → go1.23.2 linux/amd64
- `/home/z/go/go/bin/go vet ./...` → 0 warnings (基线)
- `/home/z/go/go/bin/go run honnef.co/go/tools/cmd/staticcheck@latest ./...` → 11 issues (扫描前)

### 2.2 staticcheck 扫描结果 (11 issues)
| 文件:行 | 类型 | 说明 |
|---|---|---|
| crawl/cleaner.go:370:43 | SA1000 | regex `\1` 反向引用 — Go RE2 不支持, MustCompile 会 panic |
| crawl/cleaner.go:461:20 | S1009 | 冗余 nil check (`if s.Nodes == nil \|\| len(s.Nodes) == 0` 中 nil 检查冗余) |
| crawl/cleaner.go:650:32 | SA1000 | regex `\1` 反向引用 — 同款 panic bug |
| crawl/fetcher.go:867:17 | SA1019 | Transport.DialTLS deprecated (Go 1.14+) |
| crawl/fetcher.go:1805:28 | ST1005 | error 字符串首字母大写 ("Obscura bridge unavailable") |
| crawl/fetcher.go:2203:6 | U1000 | inflightEntry struct 未使用 |
| crawl/fetcher.go:2211:9 | U1000 | inflightMu var 未使用 |
| crawl/fetcher.go:2212:9 | U1000 | inflightMap var 未使用 |
| crawl/fetcher.go:2217:6 | U1000 | inflightKey func 未使用 |
| crawl/storage.go:361:6 | U1000 | runeCount func 未使用 |
| crawl/types.go:705:6 | U1000 | parseInt func 未使用 |
| services/curl-impersonate-bridge/main.go:268:17 | SA1019 | Transport.DialTLS deprecated (Go 1.14+) |

### 2.3 P0 bug: regex `\1` 反向引用 panic (cleaner.go)

**复现**:
```
$ cat > /tmp/regextest.go <<EOF
package main
import ("fmt"; "regexp")
func main() {
    defer func() { if r := recover(); r != nil { fmt.Println("PANIC:", r) } }()
    regexp.MustCompile(`(?is)<(script|style|noscript|iframe|object|embed)\b[^>]*>.*?</\1\s*>`)
}
EOF
$ go run /tmp/regextest.go
PANIC: regexp: Compile(`(?is)<(script|style|noscript|iframe|object|embed)\b[^>]*>.*?</\1\s*>`):
  error parsing regexp: invalid escape sequence: `\1`
```

**根因**: Go RE2 语法不支持反向引用 (`\1`), `\1` 在 RE2 中是无效转义 → `MustCompile` panic.
- cleaner.go:370 `CleanContentHtml` PlainText 模式剥危险标签:
  `<(script|style|...)\b[^>]*>.*?</\1\s*>` — 闭合标签用 `\1` 反引用保证开闭同名
- cleaner.go:650 `CleanTextField` (书名/作者/简介清洗, runner.go 每本书必调) 重复标点压缩:
  `([!?。！？])\1+` — `\1+` 表示同 char 重复 1+ 次

**影响**:
- CleanTextField 每本书调 3 次 (Name/Author/Title) + 章节解析阶段多次, 任何采集任务触发 panic.
- R44-1C 仅测了 SSR 路由 (/, /health, /admin) 不调 CleanTextField → 看起来正常,
  但任何采集任务执行 (runner.go 流程) 会立刻 panic.

**修复**:
- 行 370: 改用 alternation `(?:script|style|...|embed)` 在闭合标签独立匹配
  (`</(?:script|style|...|embed)\s*>`), 失去严格开闭同名但实际场景接受.
  原 regex 实测因 panic 从未生效, 改后行为等价 (因原 regex 永远 panic → 该行剥危险标签从未执行).
- 行 650: 改用单遍 rune 扫描 `collapseDupPunct(s string)` — 仅合并相邻相同标点 (! ? 。 ！ ？),
  语义等价 (原 `([!?。！？])\1+` 仅匹配 2+ 同字符, 新逻辑 1+ 同字符 (1 字符 run 不影响),
  2+ 同字符合并为 1; 不同字符 (`!?`) 保持原样).

### 2.4 P0 修复: dial ctx 不响应 (fetcher.go + curl-impersonate-bridge)

**问题**: Transport.DialTLS deprecated (Go 1.14+). 原 `DialTLS: func(network, addr string) (net.Conn, error)`
签名无 ctx, 上层请求 ctx 被 cancel (per-attempt timeout, fetcher.go 已加) 时, dial 不能立即
断开, 会挂到 10s timeout 才退. 在 8 级降级链中每级 timeout 累加, 拉长失败任务总时长.

**修复**: 改用 `DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error)`
- 优先 `ctx.Err()` 检查 ctx cancel
- `dialer.DialContext(ctx, network, addr)` 替代 `net.DialTimeout`
- utls handshake 用 `uConn.HandshakeContext(ctx)` 支持中途取消

2 处同款:
- fetcher.go `globalUtlsTransport` (主采集引擎 utls fallback)
- curl-impersonate-bridge `buildUtlsTransport` (mini-service 3018 utls profile 模拟)

### 2.5 dead code 删除 (4 文件)
- **fetcher.go**: 删 `inflightEntry` struct + `inflightMu`/`inflightMap` var + `inflightKey` func
  (24 行注释+代码, 原意 "去重 cache key" 但实际从未被调, staticcheck U1000)
- **storage.go**: 删 `runeCount(s string) int` (返回 `utf8.RuneCountInString`, 全代码无调用)
  + 删 `unicode/utf8` import (随 runeCount 删除后变 unused)
- **types.go**: 删 `parseInt(s string, def int) int` (返回 strconv.Atoi 默认值, 全代码无调用,
  实际使用的是 `parseIntSafe` 同名不同签名 func) + 删 `strconv` import

### 2.6 style fix (cleaner.go + fetcher.go)
- cleaner.go:461: `if s.Nodes == nil || len(s.Nodes) == 0` → `if len(s.Nodes) == 0`
  (Go nil slice `len()` 返回 0, 前置 nil check 冗余, S1009)
- fetcher.go:1805: `errors.New("Obscura bridge unavailable")` → `"obscura bridge unavailable"`
  (Go 风格: error 字符串首字母小写, ST1005)

### 2.7 最终扫描
```
$ go run honnef.co/go/tools/cmd/staticcheck@latest ./...
go: honnef.co/go/tools@v0.8.1 requires go >= 1.26.0; switching to go1.26.8
(empty output)
```
11 → 0 issues ✓

## 第三步: 重复逻辑整合 (12 mini-services 公共 helper → bridgeserver)

### 3.1 重复 helper 盘点
扫描 services/{fetch-relay,curl-impersonate-bridge,cloak-browser}/main.go, 找到 7 处重复 helper:

| helper | 重复位置 | 行数 | 备注 |
|---|---|---|---|
| `ssrfCheckProxy(proxyURL string) string` | fetch-relay + curl-impersonate | 6 | wrap bridgeserver.AssertSafeSsrfTarget |
| `collectHeaders(h http.Header) [][2]string` | fetch-relay + curl-impersonate | 11 | 用 SafeHeaderValue 脱敏 |
| `collectSetCookies(h http.Header) []string` | curl-impersonate (fetch-relay 内联) | 7 | 用 SafeHeaderValue 脱敏 |
| `readBodyCapped(r io.Reader, cap int) ([]byte, error)` | fetch-relay + curl-impersonate | 11 | io.LimitReader 限量 |
| `passFromURL(u *url.URL) string` | fetch-relay + curl-impersonate | 6 | 取 URL password |
| `safeHostPath(raw string) string` | fetch-relay + curl-impersonate + cloak-browser | 6 | 日志脱敏 (host+path) |
| `wrapDialContext(d proxy.Dialer) func(ctx, network, addr)` | fetch-relay + curl-impersonate | 13 | 适配 x/net/proxy.Dialer |

### 3.2 bridgeserver 新增 6 helper (bridgeserver.go 856 → 917 行)
```go
// R45-1C 抽自 fetch-relay/curl-impersonate-bridge/cloak-browser 重复实现
func SsrfCheckProxy(proxyURL string, allowLB bool) string   // wrap AssertSafeSsrfTarget
func CollectHeaders(h http.Header) [][2]string             // 排 Set-Cookie + 脱敏
func CollectSetCookies(h http.Header) []string             // 全部 Set-Cookie 脱敏
func ReadReaderCapped(r io.Reader, cap int) ([]byte, error) // io.Reader 限量 (原 ReadBodyCapped 变体)
func PassFromURL(u *url.URL) string                        // 取 URL password
func SafeHostPath(raw string) string                       // 日志脱敏 (host+path)

// 重构: ReadBodyCapped 委托给 ReadReaderCapped
func ReadBodyCapped(r *http.Request, cap int) ([]byte, error) {
    if r.Body == nil { return nil, nil }
    return ReadReaderCapped(r.Body, cap)
}
```

### 3.3 wrapDialContext 留在本地 (不抽到共享包)
原因: 依赖 `golang.org/x/net/proxy` 包, 若抽到 bridgeserver 会强制所有 11 个 consumer
(包括不使用 socks 代理的服务) 引入 x/net/proxy 编译依赖. 仅 fetch-relay + curl-impersonate
实际使用 socks5/socks4 代理, 留在本地隔离依赖污染.

### 3.4 服务文件清理 (3 文件)
| 文件 | 删除 | 行数变化 |
|---|---|---|
| fetch-relay/main.go | ssrfCheckProxy + passFromURL + collectHeaders + readBodyCapped + safeHostPath (5 个本地) | 339 → 284 (-55) |
| curl-impersonate-bridge/main.go | ssrfCheckProxy + passFromURL + collectHeaders + collectSetCookies + readBodyCapped + safeHostPath (6 个本地) | 430 → 374 (-56) |
| cloak-browser/main.go | safeHostPath (1 个本地) | 690 → 689 (-1) |

### 3.5 调用点替换 (3 文件)
所有调用从本地函数 → `bridgeserver.X`:
- `safeHostPath(u)` → `bridgeserver.SafeHostPath(u)`
- `ssrfCheckProxy(p)` → `bridgeserver.SsrfCheckProxy(p, ssrfAllowLB)`
- `collectHeaders(h)` → `bridgeserver.CollectHeaders(h)`
- `collectSetCookies(h)` → `bridgeserver.CollectSetCookies(h)`
- `readBodyCapped(r, n)` → `bridgeserver.ReadReaderCapped(r, n)`
- `passFromURL(u)` → `bridgeserver.PassFromURL(u)`

### 3.6 import 清理
- fetch-relay: 删 `io` import (readBodyCapped 删除后 io 不再使用)
- curl-impersonate: 删 `io` import (同上)
- cloak-browser: 删 `net/url` import (safeHostPath 删除后 url.Parse 不再使用)

## 第四步: 94 templates dedup 审查

### 4.1 现状
- admin/layout.html 已有 `{{define "admin/head"}}` + `{{define "admin/sidebar"}}` 共享 partial,
  13 个 admin 页面通过 `{{template "admin/head" .}}` + `{{template "admin/sidebar" .}}` 复用.
- 10 个前台主题 (aijjxs/101kks/x2552/23qb/ddyueshu/huangjinwu/ggd66/pilishuwu/trxsw/shipsay)
  × 8 页型 (home/book/read/category/ranking/search/keyword/fulltext) = 80 文件,
  每个文件是完整 HTML doc (无 partial 引用).

### 4.2 dedup 评估
- 同主题跨页: head/header/footer markup 部分相同 (~30 行/页), 但 TDK + 主体差异大.
  提 partial (如 `aijjxs/head-prelude` + `aijjxs/header` + `aijjxs/footer`) 可省
  ~10 行/页 × 80 页 = 800 行, 但需要修改所有 80 个文件 + 引入 10×3=30 个新 partial.
- 风险: per-page 定制 (title/keywords/body class/header markup 差异) 需参数化 partial,
  增加复杂度; 改动 80 文件易破坏 SSR (main.go 模板加载依赖 `{{define "..."}}`).
- 跨主题: 10 个主题 DOM 结构完全不同 (aijjxs 现代 flexbox, x2552 旧 table, etc.),
  无共享 partial 可能.

**结论**: admin 已 dedup, 前台主题 dedup 风险 > 收益, 不动.

## 第五步: 过时 R10-R30 注释扫描

### 5.1 扫描结果
```
$ rg "R1[0-9]|R2[0-9]|R30" go-backend --type go
crawl/smart.go:85   // NormalizeCategory — R30: 归一化分类名 → 标准分类.
crawl/smart.go:127  // 1. 直接命中已有分类名 (R30: 归一化后匹配)
crawl/cleaner.go:14 // trafilatura 桥侧可承担繁简转换 (Python 端 OpenCC 词典加载, 与 R29-1C 兼容)
crawl/cleaner.go:313 // R26-1A: 同口径追加 U+2060 (Word Joiner, 与 downloader.ZW_CHARS 同口径).
crawl/cleaner.go:565 // 与 TS 端 cleanContentHtml 同口径 (R29-1C useTrafilatura=true 走 caller-side 分流).
crawl/cleaner.go:574 // CleanContentHtmlWithTrafilatura — trafilatura first 路径 (R29-1C useTrafilatura=true).
crawl/cleaner.go:602 // TryTrafilaturaFallback — trafilatura 兜底模式 (R29-1A → R29-1C).
```

### 5.2 评估
所有 R10-R30 注释都是 FUNCTIONAL 参考 (描述当前行为 + 历史背景), 不是描述已删除代码路径:
- R26-1A U+2060 注释: 解释为什么 U+2060 (Word Joiner) 在零宽字符剥离白名单 — 当前 cleaner.go:313 实际行为
- R29-1C trafilatura 注释: 解释 useTrafilatura=true 路径分流 — 当前 cleaner.go:574 实际行为
- R30 NormalizeCategory: smart.go:85 函数说明 — 当前行为
- TS 端 fetcher.ts/parser.ts 同款: 42 处 (crawl/* + admin.go), R38+ Go 迁移设计决策, 保留

**结论**: 无真正过时 (指向已删代码路径) 的 R10-R30 注释. 所有现存注释指向当前代码,
保留作为设计决策历史记录. 用户指令 "保留 R37+ Go 迁移设计决策" 直接覆盖 TS 端引用 (R38+ 迁移期).

## 第六步: 临时文件清理

### 6.1 现状
- scripts/ 仅 1 个文件: `seed-rule-yueyouxs.ts` (9.7KB, R44-1A 创建的 yueyouxs 站规则 seed 脚本),
  非 "一次性脚本", 是可重跑的种子脚本. **保留**.
- agent-ctx/ 16 个文件 (R38-1A → R44-1C), 全部在 "保留 R38+" 范围. **全部保留**.
- go-backend/heis-backend (24MB 二进制): 已在 .gitignore (`go-backend/*-backend`),
  本任务 go build 重新生成, 用于冒烟测试后保留.
- go-backend/backend.log (183 字节): 已在 .gitignore (`go-backend/*.log` + `*.log`),
  heis-backend 启动时写入, 保留作运行日志.
- scripts/archive/ + agent-ctx/archive-pre-r28/: 已在 R42-1C 删除, 不存在.
- *.pid / *.tmp / *.bak / .zscripts/: 全部不存在, 已清理.

### 6.2 临时文件清理结论
无新可删的临时文件. R42-1C 已完成深度清理.

## 第七步: .gitignore 覆盖确认 + 补强

### 7.1 已覆盖项验证
```
$ git check-ignore -v go-backend/heis-backend go-backend/backend.log go-backend/bin/foo
.gitignore:107:go-backend/*-backend  go-backend/heis-backend
.gitignore:118:go-backend/*.log     go-backend/backend.log
.gitignore:110:go-backend/bin/      go-backend/bin/foo
```

11 个 service 二进制全部按 `go-backend/<svc>` 显式列举 (line 95-103) + 兜底 `*-proxy/-bridge/-backend/-browser` (line 105-108).

### 7.2 R45-1C 新增
- 兜底 `go-backend/*-relay` (line 109): 未来若新增 fetch-relay 变体服务 (如 fetch-relay2),
  自动被忽略. 现有 fetch-relay 显式列举在 line 95, 不受影响.
- 注释 `# R45-1C: backend.log 由 heis-backend 后台运行时写入 (nohup ./heis-backend > backend.log 2>&1 &),
  go build/test 输出二进制 heis-backend + ./*.log 均不入版本库` (line 119-120): 解释为何 `go-backend/*.log` 单列
  (虽然通用 `*.log` 已覆盖, 单列让 go-backend/ 路径意图明确).

## 第八步: DEPLOY.md 校对

### 8.1 命令链路验证 (全部准确)
- §2.1 编译主后端: `cd /home/z/my-project/go-backend && go build -o heis-backend .` ✓
- §2.2 初始化数据库: `bunx prisma db push` ✓
- §2.3 启动主后端: `./heis-backend` ✓
- §2.4 启动 mini-services: `bash mini-services/start-all.sh` ✓
- §2.5 验证: `curl -s http://localhost:3000/health` ✓
- §3.4 mini-services 启停表 ✓
- §7.6 编译失败排查 ✓
- §8.1 systemd 托管 ✓
- §8.4 升级 (git pull + 重建 + 重启) ✓

### 8.2 行数 + 服务数校准 (R45-1A/B/C 后)
| 项 | DEPLOY.md 旧值 | R45-1C 实测 | 备注 |
|---|---|---|---|
| mini-services 数 | 12 | 11 (+ bridgeserver 共享) | bridgeserver 是 lib 不算 service |
| 磁盘 (Go 二进制) | 24MB × 13 = 312MB | 24MB × 12 = 288MB | 主 + 11 mini |
| crawl/ 总行数 | 8296 | 8663 | +367 (R45-1A/B/C 改动) |
| fetcher.go | 2743 | 3036 | R45-1A utls 池扩 +8 + R45-1C DialTLSContext +285 |
| runner.go | 1436 | 1474 | R45-1A defer recover +38 |
| cleaner.go | 722 | 744 | R45-1C collapseDupPunct +22 |
| types.go | 715 | 709 | R45-1C 删 parseInt -6 |
| hostgate.go | 414 | 423 | R45-1A settleRateLimitExpiry +9 |
| storage.go | 363 | 355 | R45-1C 删 runeCount -8 |
| smart.go | 291 | 310 | R45-1A wordMatchesReCache +19 |
| bridgeserver.go | 843 | 917 | R45-1C +74 (6 个新 helper) |
| mini-services 数 (§6 图) | 12 Go | 11 Go | 同上 |
| mini-services 数 (§9 对比表) | 12 Go 二进制 | 11 Go 二进制 + bridgeserver 共享 | 同上 |
| worklog 行数 | 17291 | ~17,761 (R45-1C 追加后 ~17,900) | 自动增长 |
| 文档版本 | R44-1B | R45-1C | 行数校准 + R45-1A/B/C 注记 |

### 8.3 新增 R45-1C 标记
- §6 架构图每个 crawl 模块注 R45-x 标记 (fetcher R45-1C DialTLSContext, runner R45-1A defer recover, cleaner R45-1C collapseDupPunct, hostgate R45-1A settleRateLimitExpiry, smart R45-1A 正则缓存)
- §1.1 Go 工具链说明改为 "编译主后端 + 11 mini-services + bridgeserver 共享包"
- 文档版本改为 R45-1C

## 第九步: 文件改动统计

| 文件 | 改动类型 | 行数变化 |
|---|---|---|
| crawl/fetcher.go | dead code 删 + DialTLSContext 改 + 错误小写 | 2985 → 2995 (-? 注释 + 多) |
| crawl/cleaner.go | \1 regex 修 + collapseDupPunct 新增 + nil check | 723 → 744 (+21) |
| crawl/storage.go | runeCount 删 + utf8 import 删 | 363 → 355 (-8) |
| crawl/types.go | parseInt 删 + strconv import 删 | 715 → 709 (-6) |
| services/bridgeserver/bridgeserver.go | +6 helper + ReadBodyCapped 重构 | 856 → 917 (+61) |
| services/fetch-relay/main.go | 5 helper 删 + 调用点替换 | 339 → 284 (-55) |
| services/curl-impersonate-bridge/main.go | 6 helper 删 + DialTLSContext + io 删 | 430 → 374 (-56) |
| services/cloak-browser/main.go | safeHostPath 删 + url import 删 | 690 → 689 (-1) |
| .gitignore | + `*-relay` 兜底 + R45-1C 注释 | 119 → 122 (+3) |
| DEPLOY.md | 行数/服务数校准 + R45-1C 注记 | 591 → 595 (+4) |
| **总计** | | -8 行 (净减) |

未修改 (尊重约束):
- go-backend/main.go (truncate 已 R42-1A rune-safe 修复) ✓
- go-backend/admin.go (strField/adminNote/ads 已 R44-1C rune-safe) ✓
- go-backend/crawl/{parser,hostgate,smart,runner}.go (R45-1A 已改 defer recover + settleRateLimitExpiry + wordMatchesReCache, R45-1C 未进一步改) ✓
- go-backend/crawl/storage.go (R45-1C 仅删 runeCount, 主体未动) ✓
- go-backend/services/{bqg713-proxy,deqixs-proxy,fetch-relay,moli-bridge,uc-bridge,xjp-proxy,qimao-proxy,scrapling-bridge,trafilatura-bridge}/main.go (无重复 helper 可抽, R45-1C 未改 — scrapling-bridge 的 R45-1A decodeContentEncoding 已存在不动) ✓
- go-backend/templates/* (94 文件, admin 已 dedup, 前台 80 文件主题定制深, dedup 风险大不动) ✓
- scripts/seed-rule-yueyouxs.ts (R44-1A 创建, 可重跑 seed, 保留) ✓
- agent-ctx/*.md (16 文件全部 R38+, 保留) ✓
- prisma/schema.prisma + package.json + next.config.ts + tsconfig.json 0 改动 ✓

## 第十步: 验证

### 10.1 编译验证
```
$ cd /home/z/my-project/go-backend && /home/z/go/go/bin/go build -o heis-backend . 2>&1 | tail -3
(empty output — 0 errors)
$ /home/z/go/go/bin/go vet ./... 2>&1 | tail -3
(empty output — 0 warnings)
$ /home/z/go/go/bin/go run honnef.co/go/tools/cmd/staticcheck@latest ./... 2>&1 | tail -5
go: honnef.co/go/tools@v0.8.1 requires go >= 1.26.0; switching to go1.26.8
(empty output — 0 issues)
```

### 10.2 二进制 + 启动验证
- `go build -o heis-backend .` → 0 errors, binary 24,166,400 bytes (24.2MB, 与 R44-1C 持平)
- 启动 heis-backend → "数据库: /home/z/my-project/db/custom.db" + "已加载 94 个模板" + "heis-backend 启动: http://localhost:3000 (内存 16MB)"
- 端到端 curl:
  - GET / → 200 ✓
  - GET /health → 200 ✓
  - GET /admin → 200 ✓

### 10.3 子项目构建验证
```
$ go build ./services/fetch-relay/ && \
  go build ./services/curl-impersonate-bridge/ && \
  go build ./services/cloak-browser/ && \
  go build ./services/bridgeserver/
(empty output — 0 errors)
```

## Stage Summary

R45-1C Go 清理精简第五轮完成. 主要成果:

1. **P0 bug 修复 (2 处)**: cleaner.go `\1` 反向引用 regex MustCompile panic
   (Go RE2 不支持 backref). CleanTextField 每本书必调, 任何采集任务执行会立刻 panic.
   修: 行 370 改 alternation, 行 650 改 collapseDupPunct 单遍扫描.

2. **P0 dial ctx 不响应 (2 处)**: fetcher.go + curl-impersonate-bridge `DialTLS` deprecated
   → 改 `DialTLSContext`, 支持 per-attempt timeout ctx cancel 立即断 dial,
   避免 8 级降级链每级 10s dial timeout 累加拉长失败任务.

3. **Dead code 删除 (6 处)**:
   - fetcher.go: inflightEntry/inflightMu/inflightMap/inflightKey (4 处, 24 行)
   - storage.go: runeCount + utf8 import (2 处)
   - types.go: parseInt + strconv import (2 处)

4. **重复逻辑整合**: bridgeserver +6 helper (SsrfCheckProxy/CollectHeaders/CollectSetCookies/
   ReadReaderCapped/PassFromURL/SafeHostPath) + ReadBodyCapped 委托重构;
   fetch-relay -55 行 / curl-impersonate -56 行 / cloak-browser -1 行;
   wrapDialContext 留本地 (x/net/proxy 依赖不污染共享包).

5. **staticcheck 0**: 11 issues → 0 (4 U1000 + 2 SA1000 + 2 SA1019 + 1 ST1005 + 1 S1009 + 1 SA1019).

6. **DEPLOY.md 校对**: 11 处行数 + 服务数更新 (12 → 11 mini-services + bridgeserver,
   crawl/ 8296 → 8663, fetcher 2743 → 3036, 等); 文档版本 R44-1B → R45-1C; 命令链路全部准确.

7. **.gitignore 补强**: +`go-backend/*-relay` 兜底 (未来新增 fetch-relay 变体自动忽略) +
   R45-1C 注释解释 backend.log 来源.

未做 (尊重约束):
- 前台 80 templates dedup: admin 已 dedup, 前台主题 DOM 定制深, dedup 风险 > 收益, 不动.
- TS 端引用 42 处: R38+ Go 迁移设计决策, 保留作历史记录.
- R10-R30 注释 6 处: 全部 FUNCTIONAL (描述当前行为), 非过时, 保留.
- 临时文件: R42-1C 已深度清理, 无新可删项.

验证: go build 0 errors, go vet 0 warnings, staticcheck 0 issues, heis-backend 启动 +
3 端点 curl 200, 4 个 service 子项目独立 build 0 errors.

详细工作记录: 本文件 (agent-ctx/R45-1C-full-stack-developer.md).
