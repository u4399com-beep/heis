# R43-1B — Go 采集引擎第三轮深度抓 bug + 反反爬进一步增强

## 任务
- Task ID: R43-1B
- Agent: full-stack-developer (Go 采集引擎第三轮深度审查 + 反反爬)
- Scope: `go-backend/crawl/*` (8 模块, R42-1B 后 7908 行)
- 目标: 找 R42-1B 修复后的边缘 case + 反反爬进一步增强

## 第一步: 读交接 (worklog.md 末 250 行)
- R42-1B 修复 3 P0 (hostgate pump lastAdmitAt / Acquire drain / runner BudgetExceeded
  上抛) + 4 P1 (per-attempt timeout / curl Referer 一致性 / pickProxyFor sweep /
  truncate rune-based) + 2 perf (trafilatura clients 单例) + 3 反反爬 (utls Chrome
  TLS 指纹 / Turnstile 8s 截止 / Cookie 跨 session 持久化).
- R42-1A 修复 10 大类 (admin INSERT SQL 占位符 × 4 / homeHandler catch-all /
  getSearchViewData LIKE 未 escape / getSite rows2 nil defer panic / truncate
  UTF-8 / bridgeserver ReadTimeout/WriteTimeout / panic recover 日志 /
  fetch-relay SSRF / xjp+deqixs healthCheck goroutine recover / inline regexp
  预编译 × 3).
- R43-1A: 3 个 mini-services Go 重写 (curl-impersonate-bridge utls + trafilatura-bridge
  go-readability + cloak-browser chromedp), 共 1361 行.

## 第二步: 8 模块深度审查 (7908 行)
- fetcher.go (2439) — 8 级降级链 + UA 池 + CookieJar + utls + SSRF + R42-1B 全部增强
- parser.go (1608) — HTML/JSON + goquery
- cleaner.go (717) — trafilatura 桥 + 零宽字符 + R42-1B clients 单例
- runner.go (1370) — Semaphore + 三阶段并发 + BudgetExceeded + R42-1B 上抛
- smart.go (291) — normalizeCategory (无 R42-1B 后边缘)
- storage.go (363) — 路径穿越 + 原子写入 (无 R42-1B 后边缘)
- types.go (706) — 类型 + 默认值
- hostgate.go (414) — 同 host 并发 + 速率闸门 + R42-1B drain

## 第三步: 抓 R42-1B 后边缘 case (4 P0 + 3 P1)

### P0-1 ReportRateLimited 死代码 — 429 冷却从未触发
- **位置**: `hostgate.go` L391 `ReportRateLimited` 函数; `runner.go` CrawlChapterContent
  / CrawlBookMeta err 路径
- **现象**: hostgate.go 定义了 `ReportRateLimited(host, retryAfterMs)` 函数, 设置
  `st.rateLimitedUntil = now + retryAfterMs` 让 pump 在冷却期内不放行. 但 runner.go
  在 FetchPage 返回 `*HTTPError{StatusCode: 429, RetryAfterMs: X}` 时只调
  `ReportFailure` (failStreak++), 不调 `ReportRateLimited` → `rateLimitedUntil`
  永远是 0, pump 不进入冷却期, 同 host 后续请求继续被打, 反爬 429 持续触发
- **影响**: 429 反爬触发后任务继续请求同 host, 反爬服务持续命中, IP 可能被拉黑
- **修复**: CrawlChapterContent + CrawlBookMeta (书籍页 + 目录页) 在 err 路径加
  `if he, ok := err.(*HTTPError); ok && (he.StatusCode == 429 || he.StatusCode == 503)
   && he.RetryAfterMs > 0 { hostGate.ReportRateLimited(host, he.RetryAfterMs) }`

### P0-2 proxyInst.failedUntil 死字段 — 代理健康跟踪完全失效
- **位置**: `fetcher.go` pickProxyFor L1950
- **现象**: `pickProxyFor` 用 `if proxyInst.failedUntil[p] > now { continue }` 跳过
  冷却内代理, 但 `failedUntil` map 从未被写入 (全代码搜索 zero writer).
  结果: 即使代理连续失败, `pickProxyFor` 仍会选中它, 代理池健康跟踪完全失效
- **影响**: 失败代理被反复选中, 整个代理池健康度无法维护, 反爬服务持续命中
  失败代理 IP
- **修复**:
  - 新增 `MarkProxyFailed(proxyURL, cooldownMs)` / `MarkProxyOK(proxyURL)` 函数
  - `fetchHttpWithCurlFallback` 在网络层错误 + 有代理时调 `MarkProxyFailed(proxy, 30000)`
  - 成功路径调 `MarkProxyOK(proxy)` 清除冷却

### P0-3 captchaEncountered 死字段 — admin 任务监控永远显示 0
- **位置**: `runner.go` TaskRuntime.captchaEncountered int64
- **现象**: TaskRuntime.captchaEncountered 字段存在, `Snapshot()` 读取并返给
  admin.go adminTaskSnapshotHandler, 但全代码搜索 zero writer — 没有任何代码路径
  `atomic.AddInt64(&rt.captchaEncountered, 1)`. 结果: 即使任务命中验证码 100 次,
  admin 任务监控 captchaEncountered 永远显示 0, 操作员无法察觉反爬触发频率
- **影响**: 操作员无法监控反爬触发情况, 无法及时调整 UA / 代理 / jitter 等参数
- **修复**:
  - 新增 `rt.IncCaptcha()` 方法: `atomic.AddInt64(&rt.captchaEncountered, 1)`
  - `CrawlChapterContent` + `CrawlBookMeta` (书籍页 + 目录页) 在
    `FetchResult.CaptchaDetected=true` 时调 `rt.IncCaptcha()`

### P0-4 discoverBooks 无条件 break — 多页列表发现完全失效
- **位置**: `runner.go` L1042-1060 discoverBooks for 循环
- **现象**:
  ```go
  for p := 1; p <= maxPages; p++ {
      ...
      if p < maxPages {
          // 翻页 (简化: 调用 ParseToc 的翻页逻辑)
          break
      }
  }
  ```
  该 `break` 在 `maxPages > 1` 时第一个 page 就无条件退出循环, `maxPages > 1`
  完全失效, 多页列表发现只能抓首页 (该 bug 自 R38-1C 重写以来一直存在)
- **影响**: 配置 `pagination.maxPages = 20` 实际只抓首页, 列表发现量大打折扣
- **修复**:
  - 删除无条件 `break`
  - 改为本页无新发现 (`newCount == 0`) 才 `break` (避免无效翻页)
  - 列表页 fetch 失败 (err) 也 `break` (避免无效页继续浪费预算)
  - 新增 `rt.IsStopped/IsStale` 检查 (与 ParseToc 同款)

### P1-1 cleaner trafilaturaCallClient 不复用 globalTransport
- **位置**: `cleaner.go` L59-63
- **现象**: R42-1B 注释声称 "桥调用复用进程级 transport (取代 http.DefaultClient,
  与 fetcher globalHttp 同口径)" 但实际 `trafilaturaCallClient = &http.Client{
  Timeout: 20s}` (Transport 字段为 nil), 走 `http.DefaultTransport` 独立连接池,
  与 fetcher globalHttp 不共享连接. 同款 `trafilaturaProbeClient` (1.5s timeout)
  也有此问题
- **影响**: trafilatura 桥调用独立连接池, 高频探测 (每章节查桥可用性) 浪费
  TCP 句柄 + TLS session
- **修复**: 两个 client 都加 `Transport: globalTransport`, 真正共享进程级连接池

### P1-2 parser ExtractJsonLd 内 regexp.MustCompile 每次 call 重编
- **位置**: `parser.go` L130
- **现象**: `regexp.MustCompile(\`(?i)Article|Book|CreativeWork|...\`)` 在
  `ExtractJsonLd` 循环内每次 call 都重新编译, 高频路径 GC 压力
- **影响**: 每本书籍详情页解析都重编正则, GC 压力 + CPU 浪费
- **修复**: 提为包级预编译 `var jsonLdTypeRe = regexp.MustCompile(...)`,
  ExtractJsonLd 内改用 `jsonLdTypeRe.MatchString(typeStr)`

### P1-3 runner batchMu.Unlock() 非 defer — panic 时永久锁死
- **位置**: `runner.go` L882-921 阶段 2 goroutine
- **现象**:
  ```go
  batchMu.Lock()
  ...
  logf(LogWarn, ...)  // logf 内调 cfg.Logger / cfg.DB.InsertTaskLog
  ...
  batchMu.Unlock()  // 非 defer, 末尾
  ```
  `logf` 内调 `cfg.Logger` / `cfg.DB.InsertTaskLog`, 若回调 panic,
  `batchMu.Unlock()` 永不执行, 后续批次 goroutine 全部死锁在 `batchMu.Lock()`
- **影响**: 单个 callback panic 让整个任务永久卡死, 无法恢复
- **修复**: 改为 `batchMu.Lock(); defer batchMu.Unlock()` (panic 安全)

## 第四步: 反反爬进一步增强 (2 大类)

### Enh-1 JA3/JA4 指纹轮换 (utls 多 HelloXxx)
- **背景**: R42-1B `globalUtlsTransport` 固定用 `utls.HelloChrome_Auto`, 单一
  Chrome TLS 指纹长期使用会被反爬服务关联 (Chrome 指纹 + Go utls 库特征 = 爬虫)
- **方案**: 增加 4 个 Hello 指纹池 (Chrome / Firefox / Safari / iOS), 按 host
  哈希稳定选取 (per-domain 钉扎, 与 UA 钉扎同款), 反爬无法靠 TLS 指纹单一性识别
- **实现**:
  - `utlsHelloPool = [HelloChrome_Auto, HelloFirefox_Auto, HelloSafari_Auto,
    HelloIOS_Auto]` 4 个 Hello 指纹池 (每个对应独立 JA3/JA4 指纹: cipher suite
    顺序 + 扩展顺序 + GREASE 模式各异)
  - `pickUtlsHello(host)`: 按 host 哈希稳定选取 (per-host 钉扎), 不依赖
    `math/rand` 避免全局锁
  - `ClearUtlsChoice(host)`: 失败时清掉该 host 的钉扎, 下次换新指纹
  - `globalUtlsTransport.DialTLS` 改用 `pickUtlsHello(host)` 替代固定
    `HelloChrome_Auto`; handshake 失败时调 `ClearUtlsChoice(host)` 让下次换新指纹

### Enh-2 2captcha API 集成 (验证码服务)
- **背景**: R42-1B Turnstile 8s 截止走 Obscura 桥 (puppeteer 自动点击), 但
  h-captcha / reCAPTCHA 的 puppeteer 点击通过率低 (checkbox 位置随机 + 行为
  分析). 2captcha 是商业验证码求解服务, 通过 API 提交 sitekey + pageURL,
  服务返回 token, 注入到 URL query 重抓即可通过
- **方案**: 新增 `cfg.TwoCaptchaAPIKey` 字段, 配置后启用 2captcha 服务求解
  h-captcha / reCAPTCHA. Turnstile 仍走 Obscura 桥 (puppeteer 点击更稳定,
  2captcha 仅处理 h-captcha / reCAPTCHA)
- **实现**:
  - `FetchConfig.TwoCaptchaAPIKey` 字段 (sanitizeFetchConfig 白名单 + safeStr(v, 64)
    防 token 注入)
  - `extractCaptchaSitekey(html)`: 从 HTML 提取 `data-sitekey` 属性 (20+ 字符)
  - `submitCaptchaTo2Captcha(ctx, apiKey, ct, sitekey, pageURL)`: POST
    `https://2captcha.com/in.php`, 提交任务返 `captcha_id`
  - `pollCaptchaResult(ctx, apiKey, captchaID)`: GET `/res.php`, 5s 间隔轮询
    直到 token 返回或 180s 超时 (2captcha 平均 12-30s), `CAPCHA_NOT_READY`
    继续轮询, 其它错误终止
  - `trySolveCaptchaWith2Captcha(ctx, rawURL, cfg, ct, html)`: 完整流程, 注入
    token 到 URL query (`h-captcha-response` / `g-recaptcha-response`) 重抓,
    二次确认 `LooksLikeCaptcha(solved) == ""` 才返回 HTML
  - `fetchPageOnce` 在 3 个 `LooksLikeCaptcha` 命中点 (http 路径 / 错误路径 /
    桥路径) 都加 2captcha 分支, h-captcha/reCAPTCHA 优先 2captcha, Turnstile
    仍走 `trySolveTurnstile`
- **成本**: 2captcha h-captcha/reCAPTCHA $2.99/1000 次, Turnstile $1.99/1000 次

## 第五步: 验证

### 编译 + vet
```
cd /home/z/my-project/go-backend
go build -o heis-backend . → 0 errors, binary 24,168,286 bytes (24.2MB, 与 R42-1B
  24.1MB 基本持平, 2captcha 仅用 globalHttp 复用 + utls Hello 池无新依赖)
go vet ./... → 0 warnings (crawl 包 + main 包 + services 包全 pass)
```

### 端到端测试
- 启动 heis-backend: 94 模板加载, http://localhost:3000 (内存 17MB)
- curl 测试:
  - `/` (home): HTTP 200 ✓
  - `/?view=category&cat=1`: HTTP 200 ✓
  - `/?view=search&q=test`: HTTP 200 ✓
  - `/admin`: HTTP 200 ✓
  - `/health`: HTTP 200 ✓

### 文件改动统计 (crawl/ 7908 → 8296, +388 行)
- fetcher.go: 2439 → 2743 (+304 行)
  - utls Hello 池轮换: +60 行 (utlsHelloPool + pickUtlsHello + ClearUtlsChoice +
    globalUtlsTransport.DialTLS 改用 pickUtlsHello)
  - MarkProxyFailed / MarkProxyOK: +25 行 (代理健康跟踪修复)
  - fetchHttpWithCurlFallback 网络层失败调 MarkProxyFailed + 成功调 MarkProxyOK: +10 行
  - 2captcha API 集成: +180 行 (captchaSitekeyRe + extractCaptchaSitekey +
    submitCaptchaTo2Captcha + pollCaptchaResult + trySolveCaptchaWith2Captcha)
  - fetchPageOnce 3 处 2captcha 分支: +25 行
  - mergeFetchConfig 加 TwoCaptchaAPIKey 透传: +3 行
- runner.go: 1370 → 1436 (+66 行)
  - IncCaptcha 方法: +6 行
  - CrawlChapterContent 429/503 ReportRateLimited + CaptchaDetected IncCaptcha: +12 行
  - CrawlBookMeta 3 处 (书籍页 + 目录页) ReportRateLimited + IncCaptcha +
    ReportFailure (Blocked 路径漏调) + ReportSuccess: +30 行
  - discoverBooks 修复无条件 break + 加 IsStopped/IsStale 检查 + newCount==0
    break: +12 行
  - 阶段 2 batchMu.Unlock() → defer batchMu.Unlock(): +3 行 (注释)
  - 函数注释 (R43-1B 修复说明): +3 行
- cleaner.go: 717 → 722 (+5 行)
  - trafilaturaProbeClient + trafilaturaCallClient 加 Transport: globalTransport: +5 行
- parser.go: 1608 → 1612 (+4 行)
  - jsonLdTypeRe 包级预编译 + ExtractJsonLd 改用预编译: +4 行
- types.go: 706 → 715 (+9 行)
  - FetchConfig 加 TwoCaptchaAPIKey 字段: +4 行
  - sanitizeFetchConfig 加 twoCaptchaApiKey 白名单: +5 行
- 其他模块 (hostgate / smart / storage) 0 改动 (深度审查无 R42-1B 后边缘 case)
- go.mod / go.sum 0 改动 (无新依赖, utls 已 R42-1B 引入)

### 未修改 (尊重约束)
- go-backend/main.go + admin.go (A agent) ✓
- go-backend/services/* (A agent scope) ✓
- go-backend/templates/* (已完成) ✓
- src/* (旧 TS, C agent) ✓
- prisma/schema.prisma + package.json 0 改动 ✓

## Stage Summary
- Go 采集引擎第三轮深度审查 8 模块 7908 行, 抓 R42-1B 后边缘 case 共 4 P0
  (ReportRateLimited 死代码 / proxyInst.failedUntil 死字段 / captchaEncountered
  死字段 / discoverBooks 无条件 break) + 3 P1 (cleaner trafilaturaCallClient
  不复用 globalTransport / parser ExtractJsonLd 内 regexp.MustCompile 每次 call
  重编 / runner batchMu.Unlock() 非 defer panic 不安全), 全部修复落地. 反反爬
  增强 2 大类 (JA3/JA4 指纹轮换: utls 4 Hello 池 per-host 钉扎, 反爬无法靠
  TLS 指纹单一性识别; 2captcha API 集成: h-captcha/reCAPTCHA 商业验证码服务
  求解, 180s 截止, token 注入 URL query 重抓). fetcher.go +304 行 (utls Hello
  池 +60 / MarkProxyFailed/OK +25 / fetchHttpWithCurlFallback 代理健康跟踪 +10 /
  2captcha API +180 / fetchPageOnce 3 处分支 +25 / mergeFetchConfig 透传 +3),
  runner.go +66 行 (IncCaptcha +6 / CrawlChapterContent 429 修复 +12 / CrawlBookMeta
  3 处修复 +30 / discoverBooks 修复 +12 / batchMu defer +3 / 注释 +3), cleaner.go
  +5 行 (trafilatura clients Transport 字段), parser.go +4 行 (jsonLdTypeRe 预编译),
  types.go +9 行 (TwoCaptchaAPIKey 字段 + 白名单). 编译 0 errors, vet 0 warnings,
  binary 24.2MB. 核心保留 R41-R42 全部修复 (hostgate pump/Acquire drain / utls
  Chrome TLS / Turnstile 8s / Cookie 持久化 / BudgetExceeded 上抛 / truncate
  rune-based / per-attempt timeout / Referer 一致性 / pickProxyFor sweep 完整 /
  trafilatura clients 单例). 详细工作记录见本文件.
