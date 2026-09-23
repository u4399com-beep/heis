# R47-1A — Go 采集引擎第七轮深度抓 bug + 反反爬进一步增强

## 任务
- Task ID: R47-1A
- Agent: full-stack-developer (Go 第七轮深度审查 + 反反爬增强)
- Scope: `go-backend/crawl/*` (8 模块, R46-1C 后 9031 行 → R47-1A 后 9400 行) +
  `services/cloak-browser` (R46-1C 689 → R47-1A 752)
- 目标: 找 R46-1B/C 修复后的边缘 case + 反反爬进一步增强

## 第一步: 读交接
- 读 worklog.md 末 250 行 (R44-R46 全部修复历史 71 bug + 17 反反爬)
- 读 agent-ctx/R46-1B-full-stack-developer.md (1 P1 + 3 P2 + 5 反反爬增强)
- 读 agent-ctx/R46-1C-full-stack-developer.md (清理精简 + 文档校对)

R46-1B 已落地:
- 1 P1 (runner 阶段 2 ThreadsMax=0 死循环兜底)
- 3 P2 (ClearUtlsChoice 仅 TLS handshake 失败清 / pickUtlsHello host=='' 返 pool[0] /
  brotli per-host miss 计数)
- 5 反反爬增强 (utls Hello 池 12→16 / TLS session cache LRU 256 / captcha 主备切换 /
  代理池主动 probe / brotli per-host 计数)

R46-1C 已落地:
- 删 captchaStat.lastCheckAt dead field
- .env.example / .gitignore / README.md / DEPLOY.md 重写为纯 Go 项目
- 38 文件清理 (Docker/docs/tests/tool-results 等)

## 第二步: 深度审查 + 抓 R46 修复后边缘 case (1 P1 + 5 P2)

### P1-1 fetcher.go probeProxy socks5 实现坏 (R46-1B 后边缘 case)
- **位置**: `crawl/fetcher.go` probeProxy L2325-2340
- **现象**: R46-1B 加 probeProxy 时 socks5 分支:
  ```go
  case "socks5", "socks5h":
      dialer := &net.Dialer{Timeout: 5 * time.Second}
      transport.DialContext = func(ctx, network, addr) (net.Conn, error) {
          return dialer.DialContext(ctx, network, p.Host)  // 拨 proxy 自己 TCP 端口
      }
      transport.Proxy = nil
  ```
  http.Client 期待连接到 `addr` (probeTarget host, 如 www.google.com:443), 但
  transport.DialContext 拨的是 `p.Host` (socks5 代理 TCP 端口). TCP 连接建立后
  http.Client 发 HTTP CONNECT / TLS handshake 到一个不识 HTTP 的 socks5 端口 → 失败.
- **影响**: 健康的 socks5 代理被误判死, probe 失败累计 → 5min cooldown → 代理被
  pickProxyFor 跳过 → 实际可用的 socks5 代理池全死. R46-1B 想增强代理池健康检查,
  实际把 socks5 全部判死, 反效果.
- **修复**: socks5/socks5h 也用 `transport.Proxy = http.ProxyURL(p)` (Go net/http
  原生支持 socks5 URL via ProxyURL, 内部走 socks5 协议握手把 addr 隧道转发到目标).
  不再 override DialContext.

### P2-1 fetcher.go HTTPError 缺 Unwrap 方法 (R46 后边缘 case)
- **位置**: `crawl/fetcher.go` HTTPError L1261 + isRetriableNetErr L1415
- **现象**: HTTPError 有 `Err error` 字段但无 `Unwrap()` 方法. 调用方传 `&HTTPError{Err: ctx.Err()}`
  时, `errors.Is(err, context.Canceled)` 返回 false (HTTPError 不被识别为 wrapping
  context.Canceled). isRetriableNetErr 走字符串匹配 + 默认 `return true` 兜底分支,
  ctx 已取消的错误被误判可重试 → 浪费 attempt 预算 + 让 fetchHttp 等满 backoff
  后才退出.
- **影响**: 任务 stop / pause / ctx cancel 时, fetchHttp 仍走 backoff + retry, 浪费
  1.5-8s 等待 + 后续 attempt 的 20s per-attempt timeout, 累计可达 60s+. R46 后
  无防御.
- **修复**: 加 `func (e *HTTPError) Unwrap() error { return e.Err }` 方法. 同时把
  isRetriableNetErr 的 `errors.Is(err, context.Canceled)` 检查移到字符串匹配之前
  (确保 ctx 取消错误立即 return false, 不进字符串匹配兜底).

### P2-2 fetcher.go probeProxy bot UA "proxy-probe/1.0" (R46-1B 后边缘 case)
- **位置**: `crawl/fetcher.go` probeProxy L2352
- **现象**: R46-1B 用 `"Mozilla/5.0 (compatible; proxy-probe/1.0)"` 作 probe UA,
  这是 bot UA (compatible;.../1.0 是开源爬虫库标准 bot 标识). probe endpoint
  (如 Google / Cloudflare) 的 bot detection 直接返 403 / challenge 页面 →
  probe 把健康代理误判死 (实际代理可达, 只是 probe endpoint 拒绝).
- **影响**: 健康代理被误判死, cooldown 5min → 代理池死锁.
- **修复**: 用 `UA_POOL[rand.Intn(len(UA_POOL))]` 真实浏览器 UA + Accept + Accept-Language
  与 buildHeaders 同款, probe 请求与正常爬虫请求同款, 不触发 endpoint 的 bot 检测.

### P2-3 runner.go idMap dead code `_ = i` (R38-1C 以来一直存在)
- **位置**: `crawl/runner.go` CrawlBookMeta L1266-1270
- **现象**:
  ```go
  for i, toc := range toc.Items {
      _ = i  // dead code
      idMap[toc.URL] = ""
  }
  ```
- **影响**: 无功能影响, 仅 staticcheck U1000 dead code 警告 (R46-1C staticcheck 0,
  但本处可能未被 staticcheck 抓到因 `_ = i` 视为显式忽略). 删除让代码更清晰.
- **修复**: 改 `for _, toc := range toc.Items { idMap[toc.URL] = "" }`.

### P2-4 cleaner.go 内联 regexp.MustCompile 每次调用都重编译 (~20 处)
- **位置**: `crawl/cleaner.go` NormalizeParagraphs / cleanContentHtmlSync /
  CleanTextField / CleanIntro / stripTrailingPromo / stripLeadingMetadata
- **现象**: 多处 `regexp.MustCompile(...)` 在函数体内, 每次调用都重编译:
  - NormalizeParagraphs 内: `twoNewlineRe` / `wsRe`
  - cleanContentHtmlSync plainText 分支: 6 个 regexp (scriptStyle + br + blockEnd + tagStrip)
  - cleanContentHtmlSync HTML 分支: 6 个 watermarkRe + navRe + 4 个 normBr/EmptyP/POpen/PClose + hasPOrBr + pBoundary + 3 个 chapterHead/Tail
  - CleanTextField: 4 个 (tagStrip + 2 ws + watermark)
  - CleanIntro: 3 个 (br + blockEnd + tagStrip)
  - stripTrailingPromo: 1 个 (promoRe)
  - stripLeadingMetadata: 1 个 (metaRe)
- **影响**: 每章节正文 + 简介都跑这些函数, 长跑进程 (1000+ 章节) GC 压力大.
  R45-1C 已对 smart.go wordMatches 同款优化, 但 cleaner.go 漏改.
- **修复**: 全部提到包级预编译 (R45-1C pattern):
  - twoNewlineRe / wsCollapseRe (NormalizeParagraphs)
  - plainTextScriptStyleRe / plainTextScriptStyleSelfRe / plainTextScriptStyleTailRe /
    plainTextBrRe / plainTextBlockEndRe / plainTextTagStripRe
  - navLinkRe / watermarkDomainRe / watermarkPromoRe1..5
  - indentBrRe / indentWsRe / chapterHeadCNRe / chapterHeadENRe / chapterTailRe
  - normBrDoubleRe / normEmptyPRe / normPOpenRe / normPCloseRe / hasPOrBrRe / pBoundaryRe
  - cleanTextFieldTagStripRe / cleanTextFieldWsRe / cleanTextFieldWs2Re /
    cleanTextFieldWatermarkRe
  - cleanIntroBrRe / cleanIntroBlockEndRe / cleanIntroTagStripRe
  - promoTrailRe / metaLeadingRe

### P2-5 fetcher.go CookieJar 不剥端口, 跨子域 cookie 合并失败
- **位置**: `crawl/fetcher.go` parentDomainChain + CookieJar.{Get,Store,Clear,Count}
- **现象**: originHost 返 `u.Host` 含端口 (非默认端口如 example.com:8080).
  parentDomainChain("example.com:8080") 拆 "." → `["example", "com:8080"]`,
  视 "com:8080" 为 TLD, 父域链只有 `["example.com:8080"]`, 跨子域 cookie 合并失效.
  CookieJar.Store 时 cookieDomain 属性不带端口 (RFC 6265), 与 reqHost="example.com:8080"
  不匹配 → 副罐不写, cf_clearance 跨子域跳转丢失.
- **影响**: 非默认端口站点 (localhost:8080 / example.com:8080 等) 的 cf_clearance /
  PHPSESSID 跨子域跳转丢失, 每子域都重做 challenge, 反爬识别概率提升.
  对默认端口站点 (https://example.com, u.Host 不含端口) 无影响.
- **修复**: 加 `stripPort(host string) string` helper (支持 IPv6 [::1]:8080 → [::1]),
  应用在 parentDomainChain + CookieJar.{Get, Store, Clear, Count}.

## 第三步: 反反爬增强 (4 大类, 任务要求 1-5)

### Enh-1 utls Hello 池继续扩充 (16 → 21, 含 PSK 双扩展 + 老版 iOS)
- **位置**: `crawl/fetcher.go` utlsHelloPool L808
- R46-1B 16 个. R47-1A 扩充到 21 个, 加 5 个:
  - **Chrome 100_PSK** — 早期 Chrome 100 + PSK (pre_shared_key extension), 与
    112_PSK_Shuf JA3 不同: 100 cipher suite 顺序 + 无 112 shuffled extensions
  - **Chrome 114_Padding_PSK_Shuf** — Chrome 114 + Padding extension + PSK +
    shuffled extensions, 与 112_PSK_Shuf JA3 不同: 114 cipher suite 含 TLS 1.3
    GREASE 更新 + Padding extension 长度差异
  - **Chrome 115_PQ_PSK** — Chrome 115 + PQ (post-quantum) + PSK 双扩展, 与
    115_PQ JA3 不同: 含 pre_shared_key extension + PQ key_share 含 MLKEM768 pubkey
  - **IOS 11_1** — 老版 iPhone (iOS 11.1), JA3 与 IOS_13/14 不同 (cipher suite
    顺序 + extensions 顺序有差异, 老版本 cipher suite 较少, supported_groups
    顺序不同). 老版本 iOS 真实存在 (二手 iPhone 用户群), 反爬识别 "utls 仅新
    iOS" 指纹模式 → 爬虫.
  - **IOS 12_1** — iOS 12.1 (同上, 增加移动设备指纹多样性)
- 21 个 Hello 指纹 JA3/JA4 各异 (Chrome / Firefox / Safari / iOS / Edge 五品牌 +
  PSK / PQ / Shuffle / Padding / 老版本 多变体), 反爬无法靠 TLS 指纹单一性识别.
- 注意: 用 `go doc github.com/refraction-networking/utls` + 直接 grep u_common.go
  确认实际可用常量 (HelloChrome_100_PSK / HelloChrome_114_Padding_PSK_Shuf /
  HelloChrome_115_PQ_PSK / HelloIOS_11_1 / HelloIOS_12_1 真实存在, 不存在的如
  HelloChrome_124 / HelloIOS_15_5 已剔除).

### Enh-2 验证码服务优化 (captcha 服务连续失败 cooldown, 任务要求 3)
- **位置**: `crawl/fetcher.go` captchaStat + trySolveCaptchaWith2Captcha +
  captchaPrimaryService + CaptchaServiceStatsSnapshot
- R46-1B 已加成功率统计 + 主备切换. R47-1A 加连续失败 cooldown:
  - captchaStat 加 `consecutiveFail int64` + `cooldownUntil int64` 字段
  - captchaRecordOutcome: 成功 → consecutiveFail=0 + cooldownUntil=0; 失败 →
    consecutiveFail++. 连续 N=3 次失败 → cooldownUntil = now + 60s + 重置
    consecutiveFail (避免 cooldown 期间再触发)
  - captchaPrimaryService: 主服务在 cooldown 内 → 切到备服务 (若备可用且不在
    cooldown). 都不可用/都 cooldown → 落回原 primary (调用方会立即 return "").
  - trySolveCaptchaWith2Captcha 加快速路径: 两个服务都在 cooldown → 立即 return ""
    不浪费 180s 超时. 主服务失败后试备服务前也检查 cooldown, cooldown 内跳过.
  - CaptchaServiceStatsSnapshot 增加 consecutiveFail / cooldownUntil /
    cooldownActive (bool→int64 编码) 字段供 admin 查询.
- 解决 R46-1B 后边缘 case: 2captcha 服务端连续故障 (限流/服务挂) 时, R46-1B
  仍盲目每次先试 2captcha (60s 内 3 次, 每次等满 180s = 540s 浪费). R47-1A
  连续 3 次失败后 60s cooldown, cooldown 内直接跳过该服务.

### Enh-3 代理池主动健康检查优化 (probe target 轮换, 任务要求 4)
- **位置**: `crawl/fetcher.go` probeTargetPool + pickProbeTarget + pickProxyFor
- R46-1B 默认 probe target = `https://www.google.com`. R47-1A 改为 5 个 reliable
  endpoint 轮选:
  - https://www.google.com
  - https://www.cloudflare.com
  - https://www.microsoft.com
  - https://www.apple.com
  - https://www.iana.org
- endpoint 选择标准: 全球可达 + 5xx 概率低 + 不返 challenge 页面 (HEAD 请求)
- probeTargetCounter atomic.Uint64 round-robin 选 target, 单 endpoint 命中频率 1/5
- 解决 R46-1B 后边缘 case: 长期固定打 Google → Google bot detection 识别 →
  返 429 / challenge 页面 → 健康代理被误判死. R47-1A 轮换后单 endpoint 命中
  频率 1/5, bot detection 触发概率降低 80%.

### Enh-4 行为模拟增强 (CDP-native + Bezier 轨迹 + 多步滚动, 任务要求 5)
- **位置**: `services/cloak-browser/main.go` simulateHumanBehaviorActions
- R45-1A 已加 simulateHumanBehaviorActions (单次 mousemove + 单次 scroll + 单次
  sleep). R47-1A 增强为:
  - **CDP-native mousemove** (替代 JS MouseEvent): JS `new MouseEvent('mousemove')`
    的 `isTrusted=false`, WAF (Cloudflare Bot Management / Akamai Bot Detection)
    检测 isTrusted=false 直接判 bot. 改用 `input.DispatchMouseEvent(input.MouseMoved, x, y).Do(ctx)`
    (CDP Input 域), 事件 isTrusted=true, 与真实用户事件无差异.
  - **多步鼠标轨迹** (Quadratic Bezier 曲线 5-8 个中间点):
    - 起点 + 终点 + 1 控制点 (偏离直线 50-150px, 模拟鼠标微抖)
    - 5-8 个中间点沿曲线插值
    - 每点 50-150ms 延迟 (鼠标移动间隔)
    - 控制点限制在 viewport 内 (1920x1080)
    - 原 1 个 mouseMoved 太突兀, 真实用户鼠标是连续轨迹 (数百个 mousemove 事件)
  - **多步滚动** (2-3 段 scrollBy + 间隔): 原 scrollTo 一次到位是机器人特征.
    改为 2-3 段 scrollBy (viewport 的 15-35% 每段) + 200-500ms 段间停顿,
    模拟用户连续滚动.
  - **多段停顿** (1-2 段 150-450ms): 真实用户阅读节奏不固定, 多段停顿比单段
    更像人类.
- 解决 R45-1A 后边缘 case: 单次 mousemove + isTrusted=false 被 Cloudflare
  Bot Management 识别. R47-1A CDP-native + Bezier 多步轨迹 + 多步滚动 + 多段停顿,
  完整模拟真实用户行为, 检测概率显著降低.

## 文件改动统计

| 文件 | 原 | 新 | 改动 |
|---|---|---|---|
| crawl/fetcher.go | 3384 | 3615 | +231 行 (utls Hello 池扩 16→21 +5 / HTTPError Unwrap +9 / isRetriableNetErr 重构 +15 / probeProxy socks5 修复 +6 / probeProxy UA 修复 +5 / probeTargetPool + pickProbeTarget +20 / captchaStat + consecutiveFail + cooldownUntil + cooldown 逻辑 +95 / CookieJar port strip +30 / stripPort helper +18) |
| crawl/cleaner.go | 744 | 804 | +60 行 (预编译 ~40 个 regexp +50 / NormalizeParagraphs 重构 +5 / cleanContentHtmlSync plainText 重构 +5) |
| crawl/runner.go | 1481 | 1481 | 0 行净 (仅删 `_ = i` dead code 改 `for _, toc := range`) |
| services/cloak-browser/main.go | 689 | 752 | +63 行 (input import +1 / simulateHumanBehaviorActions 全重写 +62) |
| **总计** | | | +354 行 |

未修改 (尊重约束):
- go-backend/main.go + admin.go (深度审查无 R46 后边缘 case) ✓
- go-backend/templates/* (已完成) ✓
- go-backend/crawl/{parser,hostgate,smart,storage,types}.go (深度审查无边缘 case) ✓
- go-backend/services/{bridgeserver,curl-impersonate-bridge,fetch-relay,
  scrapling-bridge,trafilatura-bridge,uc-bridge,moli-bridge,bqg713-proxy,
  deqixs-proxy,xjp-proxy,qimao-proxy}/main.go (深度审查无边缘 case) ✓
- agent-ctx/*.md (R38-R46 全部保留) ✓
- prisma/schema.prisma + package.json + .gitignore + DEPLOY.md 0 改动 ✓

## 验证

### 编译 + vet + staticcheck
```
$ cd /home/z/my-project/go-backend
$ /home/z/go/go/bin/go build -o heis-backend . → 0 errors
  binary 24,237,791 bytes (24.2MB, 与 R46-1C 24,232,844 持平, 仅 +4.9KB 因
  utls 池扩 16→21 +5 / captcha cooldown +95 / probe target rotation +20 /
  cloak-browser input import + Bezier 轨迹 +62 / cleaner 预编译 +50)
$ /home/z/go/go/bin/go vet ./... → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass)
$ PATH=$HOME/go/go/bin:$PATH ~/go/bin/staticcheck ./crawl/... → 0 issues
$ PATH=$HOME/go/go/bin:$PATH ~/go/bin/staticcheck . → 0 issues
$ PATH=$HOME/go/go/bin:$PATH ~/go/bin/staticcheck ./services/... → 0 issues
$ 12 个 services 独立 build 全 0 errors:
  fetch-relay / curl-impersonate-bridge / cloak-browser / bridgeserver / scrapling-bridge /
  uc-bridge / moli-bridge / trafilatura-bridge / bqg713-proxy / deqixs-proxy / xjp-proxy /
  qimao-proxy
```

### 启动 + 端到端验证
- heis-backend 启动: "数据库: /home/z/my-project/db/custom.db" + "已加载 94 个模板" +
  "heis-backend 启动: http://localhost:3000 (内存 13-17MB)"
- 端到端 curl:
  - GET / → 200 ✓
  - GET /health → 200 {"lang":"go","memMB":21,"ok":true} ✓
  - GET /admin → 200 ✓
  - GET /api/admin/health → 200 ✓

## Stage Summary
- Go 采集引擎第七轮深度审查 ~9400 行 (crawl 8 模块 + cloak-browser), 抓 R46
  修复后边缘 case 共 1 P1 (probeProxy socks5 DialContext override 拨 p.Host 而非
  走 SOCKS5 协议 → 健康代理被误判死) + 5 P2 (HTTPError 缺 Unwrap / probeProxy
  bot UA / runner idMap dead code / cleaner 20 处内联 regexp / CookieJar 不剥端口).
  全部修复落地.
- 反反爬增强 4 大类: ① utls Hello 池扩 16→21 (加 Chrome 100_PSK / 114_Padding_PSK_Shuf /
  115_PQ_PSK 含 PQ+PSK 双扩展 + IOS 11_1 / 12_1 老版本移动设备); ② 验证码服务连续
  失败 cooldown (N=3 次 → 60s cooldown, cooldown 内主服务跳过改用备服务, 都 cooldown
  快速 return "" 不浪费 180s); ③ 代理 probe target 轮换 (5 个 reliable endpoint
  round-robin, 单 endpoint 命中频率 1/5, 避免 Google bot detection 误判代理死);
  ④ 行为模拟增强 (CDP-native input.DispatchMouseEvent isTrusted=true + Quadratic
  Bezier 5-8 步轨迹 + 多步滚动 2-3 段 + 多段停顿 1-2 段).
- 编译 0 errors, vet 0 warnings, staticcheck 0 issues (crawl + main + services 全 0),
  binary 24.2MB (与 R46-1C 持平, +4.9KB). 12 个 services 独立 build 全 0 errors.
  heis-backend 启动 + 4 端点 curl 200. 核心保留 R41-R46 全部修复 (hostgate pump/
  Acquire drain / utls per-host 钉扎 + attempts 偏移真正轮换 / Turnstile 8s / 2captcha
  180s + per-attempt timeout / Cookie 持久化 / BudgetExceeded 上抛 / truncate rune-based /
  per-attempt timeout / Referer 一致性 / pickProxyFor sweep 完整 / trafilatura clients
  单例 / jsonLdTypeRe 预编译 / batchMu defer / discoverBooks newCount==0 break /
  MarkProxyFailed/OK / IncCaptcha / ReportRateLimited / cloak-browser
  page.AddScriptToEvaluateOnNewDocument + simulateHumanBehaviorActions / scrapling-bridge
  Accept-Encoding 移除 br / cleaner.go collapseDupPunct / DialTLSContext ctx 取消 / 13 处
  []rune 安全截断 / ClearUtlsChoice 仅 handshake 失败 / pickUtlsHello host=='' 返 pool[0] /
  brotli per-host / utls 16 池 / TLS session cache / captcha 主备切换 / 代理 probe).
  详细工作记录: 本文件.
