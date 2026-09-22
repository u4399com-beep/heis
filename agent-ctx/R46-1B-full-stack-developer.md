# R46-1B — Go 采集引擎第六轮深度抓 bug + 反反爬进一步增强

## 任务
- Task ID: R46-1B
- Agent: full-stack-developer (Go 第六轮深度审查 + 反反爬增强)
- Scope: `go-backend/crawl/*` (8 模块, R45-1C 后 8663 行 → R46-1B 后 9029 行) +
  `services/cloak-browser` + `services/scrapling-bridge` + `services/curl-impersonate-bridge`
  + `services/fetch-relay` + `services/bridgeserver`
- 目标: 找 R45-1A/C 修复后的边缘 case + 反反爬进一步增强

## 第一步: 读交接
- 读 worklog.md 末 250 行 (R44-R45 全部修复历史)
- 读 agent-ctx/R45-1A-full-stack-developer.md (5 P0 + 5 P1 + 5 反反爬增强)
- 读 agent-ctx/R45-1C-full-stack-developer.md (清理精简, staticcheck 11→0)

R45-1A 已落地:
- 5 P0 (decodeBody 不解 gzip/deflate / discoverBooks 绕过预算 / 2captcha 缺 UA + 无 per-attempt 超时 /
  cloak-browser HTML 字节截断 / cloak-browser UA-品牌不一致)
- 5 P1 (hostgate settleRateLimitExpiry 无条件还原 minGapMs / pickProxyFor 每次重 Parse /
  utls 4 Hello_Auto 实际同号 + ClearUtlsChoice no-op / batchMu 锁粒度过粗串行化 / stealth 注入错误静默)
- 5 反反爬增强 (utls Hello 池 4→12 / 2captcha 优化 / anti-captcha 备用 / 行为模拟 / 代理池缓存)
- 2 性能修复 (smart.go wordMatches 正则预编译 + scrapling-bridge Content-Encoding 解码)

R45-1C 已落地:
- 2 P0 regex \1 反向引用 panic (cleaner.go)
- 2 P0 dial ctx 不响应 (fetcher.go + curl-impersonate-bridge)
- 6 dead code 删除
- 重复逻辑整合 (bridgeserver +6 helper)
- staticcheck 11 → 0

## 第二步: 深度审查 + 抓 R45 修复后边缘 case (1 P1 + 3 P2 + 5 反反爬增强)

### P1-1 runner.go 阶段 2 章节并发 ThreadsMax=0 死循环 (R45 后边缘 case)
- **位置**: `crawl/runner.go` 阶段 2 goroutine L860
- **现象**: 
  ```go
  threads := cfg.ThreadsMax        // 0 if 未配置
  if cfg.ThreadsMin > 0 && cfg.ThreadsMax > cfg.ThreadsMin { ... }  // 不进入
  if threads > chapterConcurrency { ... }  // 0 > 1+ false, 不变
  batchSize := threads  // 0
  batch := globalQueue[:0]  // 空 slice
  globalQueue = globalQueue[0:]  // 不变
  ```
  → 死循环 (批次空但循环条件 len(globalQueue)>0 永真)
- **影响**: admin.go clampIntAdm 保证 threadMax >= 1, 但 ExecuteTaskConfig 是公开 API,
  未来扩展或 wiring 测试可能直接构造 ThreadsMax=0 + ThreadsMin=0 的 cfg → 死循环占满 CPU.
- **修复**: 在 ThreadsMax 读取后加 `if threads < 1 { threads = chapterConcurrency }` 兜底,
  即使外部传 0 也用 chapterConcurrency (bookConcurrency 兜底, 默认 3) 保证 batchSize >= 1.

### P2-1 fetcher.go ClearUtlsChoice 误清 utls choice (R45-1A 后边缘 case)
- **位置**: `crawl/fetcher.go` globalUtlsTransport DialTLSContext L890
- **现象**: 
  ```go
  rawConn, err := dialer.DialContext(ctx, network, addr)
  if err != nil {
      return nil, err  // ← 网络层错误, 不清 utls choice
  }
  // ...
  if err := uConn.HandshakeContext(ctx); err != nil {
      _ = rawConn.Close()
      ClearUtlsChoice(host)  // ← 仅 TLS handshake 失败才清
      return nil, err
  }
  ```
  R45-1A 原实现: dial 失败和 handshake 失败都无条件 ClearUtlsChoice. 但 dial 失败
  (connection refused / timeout) 与 TLS 指纹无关, 换号无意义, 反而浪费 attempts 偏移.
  连续 dial 失败 N 次 → attempts++ 累积到 len(pool), 归零, 下次重新哈希选号 → 与"失败
  累积偏移换号"的设计意图相反.
- **影响**: 网络层错误频繁时 (代理池质量差), utls choice 实际不轮换 (attempts 累积但被
  归零), 反爬识别概率提升. 长跑进程 attempts map 内存累积 (无界, 因 dial 失败也累加).
- **修复**: 仅 TLS handshake 失败调 ClearUtlsChoice; dial 失败 (网络层) 不调, 保留
  attempts 不浪费偏移.

### P2-2 fetcher.go pickUtlsHello host=="" 返 HelloChrome_Auto (R45-1A 后边缘 case)
- **位置**: `crawl/fetcher.go` pickUtlsHello L833
- **现象**: 
  ```go
  if host == "" {
      return utls.HelloChrome_Auto  // ← 不在 utlsHelloPool 中
  }
  ```
  R45-1A 后 utlsHelloPool 是 12 个具体版本, 不含 _Auto. host=="" 返 _Auto 与 pool
  元素 JA3 不一致 (反爬识别 "host=='' 路径为 _Auto 固定别名"). 同时 _Auto 不响应
  attempts 偏移 (因 ClearUtlsChoice 在 host=="" 时早返回, 不累加 attempts).
- **影响**: host=="" 路径 (理论上 fetcher.go 总是传 host=URL.Host, 但极端 case 如
  rawURL 不带 host) 与 host!="" 路径行为不一致, 反爬可识别.
- **修复**: 改返 `utlsHelloPool[0]` (HelloChrome_102), 与 pool 元素 JA3 一致 + 即使
  ClearUtlsChoice 在 host=="" 不调, attempts 也不浪费 (但行为已统一).

### P2-3 fetcher.go brotli miss 无 per-host 计数 (R45-1A 后边缘 case)
- **位置**: `crawl/fetcher.go` decodeBody L1474
- **现象**: R45-1A 加了全局 brotliMissCount 计数, 但不分 host. 运维不知哪些 host 全
  返 br (需走桥 scrapling/cloak-browser 含 brotli 解码), 只能看到总计数.
- **影响**: 运维无法针对性配置 (高频 miss 的 host 应在 fetchMode 配置层强制走 scrapling
  / cloak-browser 含 brotli 解码的桥).
- **修复**: 加 `brotliMissHostCount sync.Map[host] -> *atomic.Int64` + `recordBrotliMiss(host)`
  在 case "br" 分支调用. lazy sweep 每 1000 次 brotli miss 触发一次清零计数条目, 防长跑
  进程内存无界. 导出 `BrotliMissHostSnapshot() map[string]int64` 供 admin / metrics 查询.

### 反反爬增强 (5 大类, 任务要求 1-5)

#### Enh-1 utls Hello 池继续扩充 (12 → 16, 含 PSK / PQ / Edge)
- **位置**: `crawl/fetcher.go` utlsHelloPool L802
- R45-1A: 12 个 (Chrome 102/106_Shuffle/120/131/133 + Firefox 99/102/105/120 + Safari 16.0 +
  iOS 13/14). R46-1B: 扩充到 16 个, 加 Chrome 112_PSK_Shuf (PSK + shuffled extensions) /
  115_PQ (post-quantum hybrid X25519MLKEM768) / 120_PQ (Chrome 120 PQ) + Edge 85.
  JA3/JA4 指纹各异 (PSK 携带 pre_shared_key extension / PQ 携带 key_share extension 含
  MLKEM768 pubkey / Shuffle 扩展顺序均不同), 反爬无法靠 TLS 指纹单一性识别.
- 注意: 初版用了 HelloChrome_115 / 124 / 127 / IOS_15 / Safari_17 这些 utls v1.8.2
  不存在的常量, 编译期会报 undeclared. 用 `go doc github.com/refraction-networking/utls`
  + 直接 grep /home/z/go/pkg/mod/.../u_common.go 确认实际可用常量 (HelloChrome_115_PQ /
  HelloChrome_112_PSK_Shuf / HelloChrome_120_PQ / HelloEdge_85 真实存在).

#### Enh-2 TLS Session resumption (session ticket 缓存)
- **位置**: `crawl/fetcher.go` globalUtlsTransport L877
- 真实浏览器都会缓存 TLS session, 跨连接复用降低 RTT. utls 无 ClientSessionCache
  时每次都 full handshake, 反爬可识别 "无 session ticket 缓存" 为爬虫指纹.
- 加 `utlsSessionCache := utls.NewLRUClientSessionCache(256)` (LRU 上限 256 sessions,
  防长跑进程内存无界), 注入 `utls.Config.ClientSessionCache: utlsSessionCache`.
- 跨连接复用 session ticket (Chrome 行为同款), TLS handshake 加速 + 反爬识别降低.

#### Enh-3 验证码服务优化 (2captcha + anti-captcha 成功率统计 + 自动主备切换)
- **位置**: `crawl/fetcher.go` trySolveCaptchaWith2Captcha L2671
- R45-1A: 2captcha 优先 + anti-captcha 备用 (各试一次). R46-1B: 加成功率统计 +
  自动主备切换.
- 新增 `captchaStatsMap map[string]*captchaStat{success, fail, lastCheckAt}` +
  `captchaRecordOutcome(service, ok)` 每次结果记录 + 每 10 次结果触发主服务评估.
- 评估逻辑: 主服务最近 10 次成功率 < 50% 且备服务成功率 > 主服务 → 切换主服务.
  (避免抖动, 切换需明确证据 + 至少 10 次样本)
- 解决 R45-1A 后边缘 case: 2captcha 短暂故障但 anti-captcha 可用时仍盲目先试
  2captcha 浪费 180s 超时. R46-1B 自动切换主服务, 下次先试 anti-captcha.
- 导出 `CaptchaServiceStatsSnapshot() map[string]map[string]int64` 供 admin 查询.

#### Enh-4 代理池主动健康检查 (periodic probe)
- **位置**: `crawl/fetcher.go` pickProxyFor 5min sweep + probeProxy + probeAllProxies L2298
- R45-1A: 被动健康检查 (失败 30s 冷却). 但若代理已死, 需等到下次 pickProxyFor 失败
  才被标记, 浪费请求预算. R46-1B: 主动 probe 5min 间隔异步 goroutine 全池 HEAD 5s timeout.
- 设计:
  - `proxyState` 加 `probeFailStreak map[string]int` + `lastProbeAt int64`
  - pickProxyFor 5min sweep 内, 若 `cfg.ProxyHealthCheck=true` 且 `lastProbeAt` 距今
    > 5min → 启动 goroutine 异步 probe 全池 (不阻塞 pick, 复制 pool 防 race).
  - `probeTarget` 优先 `cfg.ProxyProbeURL`, 否则默认 `https://www.google.com`.
  - `probeProxy(ctx, proxyURL, probeTarget)`: 构造 transport + proxy (http(s) 用
    ProxyURL, socks5 用 net.Dialer+socks dialer), client.Timeout=5s, HEAD 请求,
    200/3xx/4xx → 健康 (代理可达), 5xx/网络层 error → 不健康.
  - 失败累计 `probeFailStreak[proxyURL]++`, 连续 3 次 → `failedUntil += 5min` (短冷却
    避免永久禁用, 下次 5min sweep 重试).
  - 成功 → 清零 + 恢复健康 (failedUntil 清).
  - probe 限并发 5 (避免大池上游限流).
- 启用条件: `cfg.ProxyHealthCheck=true` (默认 false, opt-in 避免误触发 probe 风暴).
- FetchConfig 加 `ProxyProbeURL string` 字段 + sanitize 白名单 (http(s) + 长度 ≤ 2048
  + URL parse 校验) + mergeFetchConfig 透传.

#### Enh-5 brotli per-host miss 计数 (识别需走桥的 host)
- 详见 P2-3. 加 recordBrotliMiss + BrotliMissHostSnapshot, 供运维针对性配置.

## 第三步: 其他修复

### fetcher.go `_ = i` dead code 删除
- 镜像组故障切换循环 L2501 原 `for i, host := range group { ... _ = i }` 中 i 仅在
  `_ = i` 占位, 改为 `for _, host := range group` 清理 dead code.

## 文件改动统计

| 文件 | 原 | 新 | 改动 |
|---|---|---|---|
| crawl/fetcher.go | 3036 | 3383 | +347 行 (utls Hello 池扩 12→16 +4 / pickUtlsHello host='' 改 +3 / TLS session cache +5 / ClearUtlsChoice 仅 handshake 失败 +6 / brotli per-host +49 / captcha 成功率统计+主备切换 +159 / proxy probe +118 / ProxyProbeURL 字段透传 +3 / dead code 删 -1) |
| crawl/runner.go | 1474 | 1481 | +7 行 (ThreadsMax=0 兜底 chapterConcurrency) |
| crawl/types.go | 709 | 721 | +12 行 (ProxyProbeURL 字段 +4 / sanitize 白名单 +8) |
| **总计** | | | +366 行 |

未修改 (尊重约束):
- go-backend/main.go + admin.go (深度审查无 R45 后边缘 case) ✓
- go-backend/templates/* (已完成) ✓
- go-backend/crawl/{parser,cleaner,storage,hostgate,smart}.go (深度审查无边缘 case) ✓
- go-backend/services/{bridgeserver,cloak-browser,curl-impersonate-bridge,fetch-relay,
  scrapling-bridge,trafilatura-bridge,uc-bridge,moli-bridge,bqg713-proxy,deqixs-proxy,
  xjp-proxy,qimao-proxy}/main.go (深度审查无边缘 case) ✓
- scripts/seed-rule-yueyouxs.ts (R44-1A 创建, 保留) ✓
- agent-ctx/*.md (R38-R45 全部保留) ✓
- prisma/schema.prisma + package.json + .gitignore + DEPLOY.md 0 改动 ✓

## 验证

### 编译 + vet
```
$ cd /home/z/my-project/go-backend
$ /home/z/go/go/bin/go build -o heis-backend . → 0 errors
  binary 24,232,844 bytes (24.2MB, 与 R45-1C 24,166,400 持平, 仅 +66KB 因
  utls 池扩 + TLS session cache + brotli per-host + captcha stats + proxy probe)
$ /home/z/go/go/bin/go vet ./... → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass)
$ /home/z/go/go/bin/go build ./services/fetch-relay/ → 0 errors
$ /home/z/go/go/bin/go build ./services/curl-impersonate-bridge/ → 0 errors
$ /home/z/go/go/bin/go build ./services/cloak-browser/ → 0 errors
$ /home/z/go/bin/go build ./services/bridgeserver/ → 0 errors
$ /home/z/go/bin/go build ./services/scrapling-bridge/ → 0 errors
$ /home/z/go/bin/go build ./services/uc-bridge/ → 0 errors
$ /home/z/go/bin/go build ./services/moli-bridge/ → 0 errors
$ /home/z/go/bin/go build ./services/trafilatura-bridge/ → 0 errors
$ /home/z/go/bin/go build ./services/bqg713-proxy/ → 0 errors
$ /home/z/go/bin/go build ./services/deqixs-proxy/ → 0 errors
$ /home/z/go/bin/go build ./services/xjp-proxy/ → 0 errors
$ /home/z/go/bin/go build ./services/qimao-proxy/ → 0 errors
$ go vet_exit=0
```

### 启动 + 端到端验证
- heis-backend 启动: "数据库: /home/z/my-project/db/custom.db" + "已加载 94 个模板" +
  "heis-backend 启动: http://localhost:3000 (内存 12MB)"
- 端到端 curl:
  - GET / → 200 ✓
  - GET /health → 200 {"lang":"go","memMB":13,"ok":true} ✓
  - GET /admin → 200 ✓
  - GET /api/admin/health → 200 {"data":{"lang":"go","memMB":17,"ok":true,...},"ok":true} ✓

## Stage Summary
- Go 采集引擎第六轮深度审查 ~19500 行, 抓 R45 修复后边缘 case 共 1 P1 (runner 阶段 2
  ThreadsMax=0 死循环, 防御式兜底 chapterConcurrency) + 3 P2 (ClearUtlsChoice 误清 /
  pickUtlsHello host=='' 返 _Auto 不在 pool / brotli 无 per-host 计数). 全部修复落地.
- 反反爬增强 5 大类: ① utls Hello 池扩充 12 → 16 (加 Chrome 112_PSK_Shuf / 115_PQ /
  120_PQ + Edge 85, JA3/JA4 各异含 PSK/PQ/Shuffle/Edge 品牌); ② TLS Session resumption
  (ClientSessionCache LRU 256, 跨连接复用 session ticket 加速 handshake + 模拟真实浏览器
  行为); ③ 验证码服务优化 (2captcha + anti-captcha 成功率统计 + 自动主备切换, 主服务
  最近 10 次成功率 < 50% 且备服务更高时自动切换); ④ 代理池主动健康检查 (periodic probe
  5min 间隔异步 goroutine 全池 HEAD 5s timeout, 连续 3 次失败 → 5min 冷却, 启用条件
  cfg.ProxyHealthCheck=true opt-in); ⑤ brotli per-host miss 计数 (识别需走桥的 host,
  供运维针对性配置 fetchMode 强制走 scrapling/cloak-browser 含 brotli 解码的桥).
- 编译 0 errors, vet 0 warnings, binary 24.2MB (与 R45-1C 持平, 仅 +66KB). 12 个 services
  独立 build 全 0 errors. heis-backend 启动 + 4 端点 curl 200. 核心保留 R41-R45 全部
  修复 (hostgate pump/Acquire drain / utls per-host 钉扎 + attempts 偏移真正轮换 /
  Turnstile 8s / 2captcha 180s + per-attempt timeout / Cookie 持久化 / BudgetExceeded
  上抛 / truncate rune-based / per-attempt timeout / Referer 一致性 / pickProxyFor sweep
  完整 / trafilatura clients 单例 / jsonLdTypeRe 预编译 / batchMu defer / discoverBooks
  newCount==0 break / MarkProxyFailed/OK / IncCaptcha / ReportRateLimited / cloak-browser
  page.AddScriptToEvaluateOnNewDocument + simulateHumanBehaviorActions / scrapling-bridge
  Accept-Encoding 移除 br / cleaner.go collapseDupPunct / DialTLSContext ctx 取消 / 13 处
  []rune 安全截断). 详细工作记录: 本文件.
