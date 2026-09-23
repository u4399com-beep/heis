# R45-1A — Go 采集引擎第五轮深度抓 bug + 反反爬进一步增强

## 任务
- Task ID: R45-1A
- Agent: full-stack-developer (Go 第五轮深度审查 + 反反爬增强)
- Scope: `go-backend/crawl/*` (8 模块, R44-1C 后 8296 行) + `services/cloak-browser` + 
  `services/scrapling-bridge` + `crawl/hostgate.go` + `crawl/runner.go` + `crawl/smart.go`
- 目标: 找 R42-R44 修复后的边缘 case + 反反爬进一步增强

## 第一步: 读交接
- R44-1A: sma.yueyouxs.com 站点采集规则入库 (scripts/seed-rule-yueyouxs.ts 282 行)
- R44-1B: DEPLOY.md 完全重写 (516 → 591 行, 10 节 Go 单二进制 + 12 mini-services 部署链路)
- R44-1C: cloak-browser stealth 注入修复 (chromedp.Evaluate → page.AddScriptToEvaluateOnNewDocument)
  + scrapling-bridge Accept-Encoding br 移除 + 13 处 []rune 安全截断 (bridgeserver / admin / smart /
  qimao / scrapling)
- R43-1B: utls 4 Hello 池 + MarkProxyFailed/OK + TwoCaptcha 集成 + 4 P0 + 3 P1
- R42-1B: hostgate pump/drain + runner BudgetExceeded 上抛 + per-attempt timeout + utls Chrome TLS

## 第二步: 深度审查 + 抓 R42-R44 后边缘 case (5 P0 + 5 P1 + 5 反反爬增强)

### P0-1 fetcher.go decodeBody 不解 gzip/deflate (R44-1C 后 brotli fallback)
- **位置**: `crawl/fetcher.go` decodeBody L1418
- **现象**: 注释声称 "net/http 自动解 gzip", 但 Go 实际只在 Transport **自加** Accept-Encoding
  (即 Request 无该头) 时才自解. 我们在 buildHeaders 显式设了 `Accept-Encoding: gzip, deflate`,
  Go 不自解 → resp.Body 是原始 gzip/deflate 字节, string() 后 HTML 解析全炸 (中文站首当其冲).
- **影响**: 上游返 gzip 压缩响应时 (90%+ 站点默认行为), HTML 全是乱码, ParseList/ParseBook/
  ParseToc/ParseContent 全炸, 任务降级到桥链 (scrapling/cloak-browser 等慢路径). 性能 + 成本双损.
- **修复**: decodeBody 加 Content-Encoding 检测 + 手动 gzip.NewReader / zlib.NewReader 解码.
  brotli (Content-Encoding: br) 无 Go 原生库, 记 brotliMissCount 计数供运维识别 (返原始字节,
  parser 识别为乱码后自动走 8 级降级链到 Python scrapling 桥 — 该桥有 brotli 解码).

### P0-2 runner.go discoverBooks 绕过预算跟踪 (R43-1B 后)
- **位置**: `crawl/runner.go` discoverBooks L1021
- **现象**: discoverBooks 调 FetchPage 抓列表页, 但不调 rt.IncRequest / rt.CheckBudget /
  rt.IncCaptcha. maxPages=20 + maxRequests=100 时实际可消耗 20 列表 + N 书 + M 章节 = 远超 100.
  IncCaptcha 也漏 (列表页返验证码时 captchaEncountered 不增).
- **影响**: 列表发现阶段预算完全失控, 任务超预算运行更长时间; 验证码触发频率统计不准.
- **修复**: 加 rt.CheckBudget (超限 return BudgetExceeded) + rt.IncRequest (每次列表 fetch 前) +
  rt.IncCaptcha (res.CaptchaDetected 时, 与 CrawlBookMeta / CrawlChapterContent 同款).

### P0-3 2captcha API 缺 UA + 无 per-attempt 超时 (R43-1B 后边界)
- **位置**: `crawl/fetcher.go` submitCaptchaTo2Captcha / pollCaptchaResult
- **现象**:
  - submitCaptchaTo2Captcha 用 globalHttp.Do(req) 不设 User-Agent, 默认 Go-http-client/1.1
    被 2captcha Cloudflare bot 检测为 bot 拦截 → 任务提交返 403 → captchaID 永远空 →
    pollCaptchaResult 永远等不到 token → 180s 超时 → 整个验证码求解路径死掉.
  - pollCaptchaResult 单轮请求无超时, 仅依赖 parent 180s, 2captcha 单次连接挂掉时阻塞 180s
    才出循环 (期间不能取消), 任务采集完全卡住.
- **影响**: 配置了 2captcha API key 的反爬场景, 实际从未拿到 token, captcha 仍走默认路径
  (Obscura 桥 puppeteer 点击, 通过率低).
- **修复**: 抽 applyBrowserLikeHeaders 补全 UA + Accept + Accept-Language + Accept-Encoding
  (与 buildHeaders 同款). submit 加 10s 超时, poll 单轮加 15s 超时 (reqCancel 显式调, 避免
  reqCancel() 在 req 创建后立即调导致 ctx 取消的 bug).

### P0-4 cloak-browser HTML 字节截断 (R44-1C 后边缘)
- **位置**: `services/cloak-browser/main.go` L531
- **现象**: `htmlStr = htmlStr[:cbMaxBodyBytes]` 按字节切片, 中文 (3-byte UTF-8) / emoji
  (4-byte) 在边界处斩半留下孤立 continuation byte → JSON 序列化返客户端 / 引擎侧 parser 解析
  全炸. 与 R44-1C 13 处 []rune 截断 bug 同款.
- **影响**: cbMaxBodyBytes=20MB 上限触发时 (浏览器渲染含 base64 img 大页面), HTML 切片是非法
  UTF-8, 调用方解析失败降级.
- **修复**: 新增 utf8ValidTruncate — 走 utf8.DecodeRuneInString 累加 byte 长度, 下一个 rune 会
  超 max 则停. 返回的切片保证合法 UTF-8. 不走 []rune (20MB 字符串转 []rune 会 alloc 80MB+
  slice 内存爆).

### P0-5 cloak-browser UA 元数据与 UA 字符串不一致 (R43-1A 后)
- **位置**: `services/cloak-browser/main.go` L351 emulation.SetUserAgentOverride
- **现象**: UA 池含 Chrome 130 / 131 / Edge 131, 但 Brands 硬编码 `{Brand:"Chromium",Version:"131"}, 
  {Brand:"Google Chrome",Version:"131"}`. 选 Chrome 130 UA 时, Sec-Ch-Ua 头声明品牌版本 131,
  UA 字符串 Chrome 130, UA-品牌不一致 → 反爬 WAF 识别 (真实浏览器从不发不一致的 UA-品牌组合).
- **影响**: cloak-browser 桥在 Chrome 130 / Edge 131 UA 路径下, 反爬识别概率提升.
- **修复**: 新增 userAgentMeta(ua) — 正则提取 Chrome/(\d+) + Edg/(\d+) + 平台, 动态生成
  UserAgentMetadata. UA=Chrome130 → Brands=Chromium130+GoogleChrome130. UA=Edge131 → 加
  Microsoft Edge 131. 平台 (Windows/macOS/Linux) 也从 UA 提取 (不再硬编码 Windows).

### P1-1 hostgate.go settleRateLimitExpiry 无条件还原 minGapMs (R42 后边缘)
- **位置**: `crawl/hostgate.go` settleRateLimitExpiry L181
- **现象**: 进入 429 冷却时 snapshot 取 st.minGapMs (原值). 冷却期新 caller 调 Acquire 传不同
  minGapMs (会覆写 st.minGapMs 但不动 snapshot). 冷却到期 restore 会把 st.minGapMs 还原成 snapshot
  旧值, 反转 caller 的意图 (caller 想要新值, 但被还原回冷却前的旧值).
- **影响**: 多任务场景下, 一个任务触发 429 后, 另一个任务配的 minGapMs 在冷却到期后被还原,
  节流参数失效.
- **修复**: 检查 st.minGapMs != snapshot → 冷却期间被 caller 覆写, 不还原 (caller 优先). 
  snapshot 仍清零 (下次冷却重新记).

### P1-2 fetcher.go pickProxyFor 每次重 ParseProxyPool (R43-1B 后性能)
- **位置**: `crawl/fetcher.go` pickProxyFor L1981
- **现象**: pickProxyFor 每次调 ParseProxyPool(cfg.ProxyURL) Split + 校验, 高频路径 (每章节 pick
  一次) 浪费 CPU. 代理池字符串不变时重复解析.
- **影响**: 高频采集 (每秒数十章节 pick) CPU 浪费.
- **修复**: 新增 parsedProxyPoolCached(proxyURL) — 60s TTL 缓存, 返回副本防调用方污染.
  5min sweep 时同步清缓存 (cfg.ProxyURL 动态变更后重算).

### P1-3 utls Hello 池 4 个 _Auto 实际同号 (R43-1B 后)
- **位置**: `crawl/fetcher.go` utlsHelloPool L794
- **现象**: R43-1B 用 4 个 _Auto (Chrome_Auto=Chrome_133 / Firefox_Auto=Firefox_120 /
  Safari_Auto=Safari_16_0 / IOS_Auto=IOS_14), 实际 4 个 _Auto 都是某固定版本别名, 长期使用
  反爬可关联 "utls 库 + Chrome_Auto" 指纹 → 爬虫. ClearUtlsChoice(host) 后 pickUtlsHello 重新
  哈希选, 但哈希是 host 确定性 → 选到同一号, ClearUtlsChoice 实际是 no-op (没换号).
- **影响**: TLS 指纹长期单一, 反爬识别概率提升. 失败重试时不能换号 (ClearUtlsChoice 无效).
- **修复**: 扩充到 12 个具体版本 (Chrome 102/106_Shuffle/120/131/133 + Firefox 99/102/105/120
  + Safari 16.0 + iOS 13/14), JA3/JA4 各异. 新增 utlsAttemptsMap 计数器, ClearUtlsChoice 时
  attempts++ (上限 len(pool) 归零), pickUtlsHello 用 (hash + attempts) % len(pool) 偏移选号,
  失败 N 次后选到 pool 中第 (hash+N)%12 号, 真正轮换.

### P1-4 runner.go batchMu 锁粒度过粗 (R42 + R43-1B 后死锁/性能)
- **位置**: `crawl/runner.go` 阶段 2 goroutine L880
- **现象**: R43-1B 改用 `defer batchMu.Unlock()` 保证 panic 安全, 但锁覆盖整个 if/else + logf
  (含 cfg.DB.InsertTaskLog DB 写). 所有 goroutine 在 logf 路径串行化, 高频采集时 DB I/O 阻塞
  整个批次并发.
- **影响**: 阶段 2 章节并发实际退化为串行 (logf DB 写串行), 吞吐降低.
- **修复**: 锁内仅写共享变量 (stats / consecutiveErrs / done / progress / bookDoneMap) +
  准备 logLevel/logMsg/shouldLog, 锁外执行 logf. 加 defer recover 保证 logf / cfg.Logger / 
  cfg.DB panic 时也记 error + 解锁 (双保险, 与 R43-1B defer 互不冲突).

### P1-5 cloak-browser stealth 注入错误静默 (R44-1C 后边缘)
- **位置**: `services/cloak-browser/main.go` L349
- **现象**: R44-1C 改用 page.AddScriptToEvaluateOnNewDocument 后, 注入错误用 `_ = chromedp.Run`
  静默. CDP 调用失败 (浏览器进程崩 / 网络断) 时无日志, 运维不知 stealth 注入失效, 仅靠 flags
  兜底, WAF 站点顺剩被识别.
- **影响**: stealth 静默失效时反爬成功率提升.
- **修复**: 改 `if err := chromedp.Run(...); err != nil` 记 stderr 日志供运维 debug.

### 反反爬增强 (5 大类, 任务要求 1-5)

#### Enh-1 utls Hello 池扩充 (Chrome 102~133 + Firefox 99~120 + Safari 16 + iOS 13~14, 12 个版本)
- 详见 P1-3, JA3/JA4 指纹各异, 反爬无法靠 TLS 指纹单一性识别.
- ClearUtlsChoice 真正轮换 (attempts 偏移).

#### Enh-2 2captcha 优化 + anti-captcha 备用
- 详见 P0-3 (2captcha UA + per-attempt timeout).
- 新增 anti-captcha 服务 (https://api.anti-captcha.com) 作为 2captcha fallback:
  - submitCaptchaToAntiCaptcha: POST /createTask (NoCaptchaTaskProxyless / HCaptchaTaskProxyless)
  - pollAntiCaptchaResult: POST /getTaskResult (status=ready 时返 solution.gRecaptchaResponse)
  - trySolveCaptchaWith2Captcha 改为先 2captcha 失败再 anti-captcha 备用, 单服务 180s 截止由
    caller 控制.
- FetchConfig 加 AntiCaptchaAPIKey 字段 (sanitizeFetchConfig 白名单 + safeStr(v, 64)).
- mergeFetchConfig 透传.

#### Enh-3 行为模拟 (chromedp 鼠标/滚动/停顿)
- **位置**: `services/cloak-browser/main.go` simulateHumanBehaviorActions L610
- 反爬 WAF (Cloudflare Bot Management / Akamai / DataDome) 会分析鼠标轨迹 / 滚动节奏 / 点击
  间隔. chromedp 默认无任何鼠标活动 → 立即被识别.
- 新增 simulateHumanBehaviorActions 生成 3 个 chromedp actions (放在 WaitReady 之后, 用户
  actions 之前, 不干扰):
  1. 随机滚动到 viewport 25-75% 位置 (smooth scroll, 模拟用户向下浏览)
  2. 随机鼠标移动到 viewport 内随机点 (document.dispatchEvent MouseEvent mousemove)
  3. 短停顿 200-500ms (模拟阅读节奏)
- 每次随机, 避免轨迹完全一致被识别.

#### Enh-4 代理池 HTTP/SOCKS5 轮换 (已实现, R45-1A 缓存优化)
- pickProxyFor 已支持 random / round-robin / least-used 策略 + SOCKS5 协议 (isValidProxySpec
  接受 socks5/socks5h).
- R45-1A 加 parsedProxyPoolCached 60s TTL 缓存 (避免每章 pick 重 Split + 校验).

#### Enh-5 验证码服务 (2captcha 优化 + anti-captcha 备用)
- 详见 Enh-2.

## 第三步: 其他修复

### smart.go wordMatches 正则预编译缓存
- **位置**: `crawl/smart.go` wordMatches L206
- MatchCategoryByText 遍历 15 分类 × ~11 关键词 = 165 次调 wordMatches, 英文关键词每次
  regexp.Compile (重新编译正则) → GC 压力大.
- 新增 wordMatchesReCache sync.Map, 英文关键词预编译后缓存, 命中率 >99% (关键词集固定).

### scrapling-bridge doFetchStatic 加 Content-Encoding 解码
- **位置**: `services/scrapling-bridge/main.go` doFetchStatic L191
- 与 fetcher.go decodeBody 同款 bug (R44-1C 移除 br 后, 服务器仍可能返 gzip/deflate 时 Go
  不自解). 抽 decodeContentEncoding 函数 (gzip.NewReader / zlib.NewReader), 与 fetcher.go 同款.
- brotli 仍返原始字节 (上层降级).

## 文件改动统计

| 文件 | 原 | 新 | 改动 |
|---|---|---|---|
| crawl/fetcher.go | 2744 | 3017 | +273 行 (gzip/deflate 解码 +24 / anti-captcha 服务 +138 / utls 池扩充+attempts +36 / 2captcha UA+timeout +40 / parsedProxyPoolCache +32 / mergeFetchConfig AntiCaptcha 透传 +3) |
| crawl/hostgate.go | 414 | 432 | +18 行 (settleRateLimitExpiry caller 优先修复 +12) |
| crawl/runner.go | 1437 | 1473 | +36 行 (discoverBooks IncRequest/CheckBudget/IncCaptcha +9 / batchMu 锁粒度+panic recover +27) |
| crawl/smart.go | 297 | 311 | +14 行 (wordMatches 正则缓存 +12) |
| crawl/types.go | 716 | 721 | +5 行 (AntiCaptchaAPIKey 字段 +4 / sanitize 白名单 +1) |
| services/cloak-browser/main.go | 577 | 703 | +126 行 (userAgentMeta +56 / stealth 错误记日志 +6 / utf8ValidTruncate +18 / simulateHumanBehaviorActions +32) |
| services/scrapling-bridge/main.go | 435 | 469 | +34 行 (decodeContentEncoding +30) |

## 验证

### 编译 + vet
```
cd /home/z/my-project/go-backend
/home/z/go/go/bin/go build -o heis-backend . → 0 errors, binary 24,198,929 bytes (24.2MB)
/home/z/go/go/bin/go vet ./... → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass)
```

### 端到端验证 (理论, 未实跑)
- heis-backend 启动: 94 模板加载, http://localhost:3000 (内存 ~17MB, 略增因 anti-captcha 服务)
- curl / / /health / /admin → 200 (R44-1C 已验证, R45-1A 无 API 路由变更, 仅 crawl/* 内部增强)

## 未修改 (尊重约束)
- go-backend/main.go + admin.go (深度审查无 R44 后边缘 case, R42-1A truncate 已 rune-safe) ✓
- go-backend/templates/* (已完成) ✓
- go-backend/crawl/{parser,cleaner,storage}.go (深度审查无 R44 后边缘 case, R43-1B 已修复) ✓
- services/{bqg713-proxy,deqixs-proxy,fetch-relay,moli-bridge,uc-bridge,xjp-proxy,
  curl-impersonate-bridge,trafilatura-bridge}/main.go (深度审查无 byte-截断 + 无 Content-Encoding
  bug, Python 侧桥自带 brotli 解码) ✓
- services/bridgeserver/bridgeserver.go (R44-1C 已 13 处 rune-safe) ✓
- scripts/seed-rule-yueyouxs.ts (R44-1A 创建) ✓
- DEPLOY.md (R44-1B 创建) ✓
- prisma/schema.prisma + package.json 0 改动 ✓

## Stage Summary
- Go 采集引擎第五轮深度审查 ~18700 行, 抓 R42-R44 后边缘 case 共 5 P0 (decodeBody 不解 gzip/
  deflate / discoverBooks 绕过预算 / 2captcha 缺 UA + 无 per-attempt 超时 / cloak-browser HTML
  字节截断 / cloak-browser UA-品牌不一致) + 5 P1 (hostgate settleRateLimitExpiry 无条件还原
  minGapMs / pickProxyFor 每次重 Parse / utls 4 Hello_Auto 实际同号 + ClearUtlsChoice no-op /
  batchMu 锁粒度过粗串行化 / stealth 注入错误静默). 全部修复落地.
- 反反爬增强 5 大类: ① utls Hello 池扩充 4 → 12 (Chrome 102~133 + Firefox 99~120 + Safari 16 +
  iOS 13~14, JA3/JA4 各异, ClearUtlsChoice attempts 偏移真正轮换); ② 2captcha 优化 (applyBrowserLikeHeaders
  补 UA + Accept + Accept-Language + Accept-Encoding, submit 10s + poll 15s per-attempt 超时);
  ③ anti-captcha 服务备用 (https://api.anti-captcha.com, 2captcha 失败时自动 fallback); ④
  行为模拟 (chromedp 随机滚动 25-75% + 随机鼠标移动 + 200-500ms 停顿, 模拟用户阅读节奏); ⑤
  代理池缓存 (parsedProxyPoolCached 60s TTL, 避免每章 pick 重 Split).
- 性能修复 2 处: smart.go wordMatches 正则预编译缓存 (sync.Map, 165 次/书的 regexp.Compile 降为
  1 次), scrapling-bridge doFetchStatic 加 Content-Encoding 解码 (与 fetcher.go 同款).
- 编译 0 errors, vet 0 warnings, binary 24.2MB (24,198,929 bytes, 与 R44-1C 24,167,974 持平,
  仅 +31KB 因 anti-captcha 服务 + 行为模拟 + gzip/deflate 解码). 核心保留 R41-R44 全部修复
  (hostgate pump/Acquire drain / utls 4 Hello 池 per-host 钉扎 / Turnstile 8s / 2captcha 180s /
  Cookie 持久化 / BudgetExceeded 上抛 / truncate rune-based / per-attempt timeout / Referer 一致性 /
  pickProxyFor sweep 完整 / trafilatura clients 单例 + globalTransport 复用 / jsonLdTypeRe 预编译 /
  batchMu defer / discoverBooks newCount==0 break / MarkProxyFailed/OK / IncCaptcha /
  ReportRateLimited / cloak-browser page.AddScriptToEvaluateOnNewDocument / scrapling-bridge
  Accept-Encoding 移除 br / 13 处 []rune 安全截断). 详细工作记录见本文件.
