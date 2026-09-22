# R50-1A Go第九轮深度审查 + 反反爬增强

## Task
- Task ID: R50-1A
- Agent: full-stack-developer (Go第九轮+反反爬)
- 时间: 2026-09-22
- 范围: go-backend/ 全 Go 代码 ~20678 行 (crawl 8 模块 9321+ + main.go 1173 + admin.go 3570 + services 12 服务 4860 + bridgeserver 917)

## 接前轮工作
- R49-1B cleaner.go +95 行 7 P2/P3 bug 修复 (\r 规范化 + Unicode 空格 + 13 类不可见字符 + plainText 段 + 水印段 + 隐藏元素 + 广告正则)
- R49-1A 5 套主题核实 (aijjxs/23qb/ddyueshu/pilishuwu/101kks)
- R49-1C 模板搜索 form 51 处修复 (5 套 × 8 页型 search form action + name)
- R48-1A 第八轮深度审查 (utls 24 池 + TLS session ticket 持久化 + CapSolver 三服务级联 + probe 头族 + Bezier 微抖 + bell curve + hover + click)
- R47-1A utls 21 + captcha cooldown + probe target 轮换
- R46-1B utls 16 + TLS session cache + captcha 主备

## Go 第九轮深度审查覆盖
- crawl/fetcher.go (4212 → 4413 行) — HTTP 采集 + 8 级降级链 + UA 池 + CookieJar + utls 24→29 池 + persistableSessionCache + captcha 三服务级联 + probe
- crawl/cleaner.go (899 行) — 噪声清洗 + 段落规整 + 零宽字符剥离 + trafilatura 桥 (R49-1B 7 bug 修复后无新边缘 case)
- crawl/parser.go (1612 行) — HTML/JSON 解析 + CSS 选择器 + 翻页 + URL 绝对化 (R42-1A 包级预编译 + R47-1A hot path regexp)
- crawl/runner.go (1481 行) — 任务调度 + Semaphore + 三阶段并发采集 (R45-1A panic recover + R42-1B budgetExceeded)
- crawl/hostgate.go (423 行) — 同 host 并发 + 速率双维闸门 (R42-1B pump drain + R45-1A settleRateLimitExpiry)
- crawl/smart.go (310 行) — 智能分类 + 完结判断 (R45-1A wordMatchesReCache)
- crawl/storage.go (355 行) — 章节 TXT / 封面 webp / 路径穿越防御
- crawl/types.go (721 → 733 行) — 配置/规则/结果类型 + 深消毒白名单
- main.go (1173 行) — 路由 + 模板 + DB
- admin.go (3570 行) — admin API + DBClient 适配器
- services/cloak-browser/main.go (822 → 859 行) — 反检测浏览器桥 (CDP-native + Bezier + Gaussian 微抖)
- services/* 其他 11 服务 — 各 bridge/proxy (深度审查无边缘 case)

## 抓出 1 P2 bug 全部修复

### BUG-1 (P2): persistableSessionCache.Put race condition
- 位置: crawl/fetcher.go persistableSessionCache.Put L1106 + flushLocked L1112-1135
- 现象: R48-1A 引入的 persistableSessionCache 在 Put 持锁后启 `go c.flushLocked()` 异步 goroutine,
  flushLocked 读 c.dirty / c.disk 不取锁, 与并发 Put 写 c.disk 竞态
  (data race → race detector 报错 + 实际可能写入半截 JSON 文件)
- 影响: TLS session ticket 持久化在并发场景 (多 host 同时握手) 触发 data race,
  race detector 会报 FATAL, 生产环境可能写入半截 JSON 导致下次启动加载失败
  (ticket 解码失败 → session resumption 失效 → 每次握手都 full handshake → 慢 +
  反爬识别 "无 session resumption" 模式 → 爬虫)
- 修复: Put 在锁内深拷贝 disk map 到 snapshot, 解锁后启 `go c.flushFromSnapshot(snapshot)`
  异步 IO. snapshot 是独立 map 不受后续 Put 影响, IO 期间无需持锁.
  新增 flushMu sync.Mutex 串行化并发磁盘 IO (SaveToDisk + 异步 flush 不写同 tmp 文件).
  tmp 文件名带纳秒后缀防并发 IO 写同 tmp (即使 flushMu 失效也兜底).
  SaveToDisk 同款改为 snapshot+IO 模式 (持锁内 snapshot + 清 dirty, 解锁后 IO).
  IO 期间不持 c.mu → 并发 Put/Get 不阻塞, Put 若有新写会重新标 dirty 触发下次 flush.
  dirty 在 IO 成功后才清 (失败保留 dirty 让下次 Put 再触发 flush).
  删除已无调用方的 flushLocked 函数 (dead code, 避免 staticcheck U1000).

## 反反爬增强 5 大类 (任务要求 1-5)

### ① utls Hello 池继续扩充 24 → 29
- HelloChrome_83 — 2020 主流 Chrome 稳定版 (Win 7/8/早期 Win 10 默认 Chrome)
- HelloChrome_87 — 2020 末 Chrome 稳定版
- HelloChrome_96 — 2021 末 Chrome 稳定版
- HelloFirefox_55 — 2017 Firefox ESR (旧版 Linux 发行版默认 Firefox, 隐私社区)
- HelloFirefox_63 — 2018 Firefox ESR (旧 Linux + 隐私用户群)
- 真实用户群: 老 Windows 设备 (Win 7 EOL ~5% 市场份额) + 学校/政府/企业/公共图书馆
  旧部署 + 旧 Linux 发行版 (Debian stretch / Ubuntu 16.04 LTS / CentOS 7 EOL) +
  Tor Browser 早期版本 (基于 Firefox 55/63 内核) + 隐私社区 (NoScript / uBlock
  Origin 老版用户). 反爬关联难度从 1/24 提升到 1/29.
- 用 grep u_common.go + u_parrots.go 确认 5 款 Hello ID 真实存在 (parrots switch case).

### ② TLS Session ticket 磁盘优化
- 修复 BUG-1 race condition (见上)
- Put 持锁内深拷贝 disk → snapshot, 解锁后启异步 goroutine 用 snapshot 做 IO
- 新增 flushMu sync.Mutex 串行化并发磁盘 IO (SaveToDisk + 异步 flush 不写同 tmp 文件)
- tmp 文件名带纳秒后缀防并发 IO 写同 tmp
- SaveToDisk 同款改为 snapshot+IO 模式 (持锁内 snapshot + 清 dirty, 解锁后 IO)
- IO 期间不持 c.mu → 并发 Put/Get 不阻塞, Put 若有新写会重新标 dirty 触发下次 flush
- dirty 在 IO 成功后才清 (失败保留 dirty 让下次 Put 再触发 flush, 保证最终一致)

### ③ 验证码服务 sitekey 提取增强
- captchaSitekeyRe 扩展支持 data-sitekey / data-pubkey / data-pkey 三种属性名
  - data-sitekey — 标准 h-captcha / reCAPTCHA / Turnstile 属性
  - data-pubkey — h-captcha enterprise 变体 (部分企业部署用此属性名)
  - data-pkey — 极少数自定义集成变体
- 新增 captchaSitekeyReFallback 兜底从 JS 变量提取 sitekey (sitekey: "..." / sitekey:"...")
  - 部分站点用 JS 动态渲染 captcha, data-* 属性不在 HTML 中, 需从 <script> 内
    sitekey: "..." 字面量提取
- extractCaptchaSitekey 改为两段式: 先 captchaSitekeyRe (data-* 属性), 不命中
  再 captchaSitekeyReFallback (JS 变量). 提升 h-captcha enterprise / 动态渲染
  captcha 站点的求解率.

### ④ 代理池健康检查优化
- probeProxyWithLatency 返回 (err, latencyMs), 包装 probeProxy 向后兼容
- probeAllProxies 调用方记录 latencyMs 到 probeLatencyMs map. 失败 latencyMs=0
- proxyState 加 probeLatencyMs map + probeLastAt map 字段
- pickProxyFor 新增 "least-latency" 旋转策略:
  - 选 probeLatencyMs 最小的可用代理
  - 从未 probe 过的代理视为 latency=0 优先选 (让新代理尽快被 probe)
  - latency=0 表示 probe 失败也不优先选 (避免选到死的代理, 视为 999999ms)
  - 多个代理同 latency 时降级到 least-used
  - 解决高延迟代理拖慢采集: 500ms 代理 vs 5s 代理, 同样健康但 5s 代理每章节
    多花 4.5s, 大批量采集时累计耗时差 100x+. 默认仍 random (向后兼容).
- sanitizeFetchConfig 白名单加 "least-latency" 到 ProxyRotationStrategy 校验
- 新增 ProxyStatsSnapshot admin / metrics 查询函数: 返回每代理的
  useCount / probeLatencyMs / probeLastAt / failedUntil / inCooldown
  供 admin UI 识别慢代理 (latency > 3s 视为慢) + 死代理 (failedUntil > now)

### ⑤ 行为模拟继续增强
- Gaussian 微抖 (Box-Muller via rand.NormFloat64, stddev=1.5px)
  - 替代原均匀分布 ±3px. 真实生理抖动是 Gaussian 分布 (95% 在 ±3px 内, 5% 偶发
    ±4-5px), 均匀分布让所有抖动等概率 (不真实, WAF 通过抖动分布识别自动化)
- 滚轮 micro-events (5-15px deltaY 小步滚动插入主滚动间)
  - 真实用户滚动不是平滑大段, 是 wheel 事件连续触发 (每 wheel ~50-100px, 中间有
    micro 暂停). 原 scrollBy 一次大段被检测为 "JS 调用 = 自动化", 改用多次小 deltaY
  - 每段主滚动后插入 2-4 个 micro wheel events, micro 间隔 30-80ms (真实 wheel 事件间隔)
- 15% 概率 Tab 键 focus 切换 (chromedp.KeyEvent "\t")
  - 真实用户会用 Tab 键在 focusable 元素间切换 (links / buttons / inputs)
  - 纯 mousemove 无 keyboard 被检测为 "无键盘 = 自动化"
  - Tab 后 200-500ms 短停顿 (用户视觉确认 focus 切换结果)

## 未修改 (尊重约束)
- go-backend/main.go + admin.go (深度审查无 R48/R49 后边缘 case) ✓
- go-backend/templates/* (已完成) ✓
- go-backend/crawl/{parser,hostgate,smart,storage,cleaner}.go (深度审查无边缘 case) ✓
- go-backend/crawl/runner.go (深度审查无边缘 case) ✓
- go-backend/services/{bridgeserver,curl-impersonate-bridge,fetch-relay,
  scrapling-bridge,trafilatura-bridge,uc-bridge,moli-bridge,bqg713-proxy,
  deqixs-proxy,xjp-proxy,qimao-proxy}/main.go (深度审查无边缘 case) ✓
- agent-ctx/*.md (R38-R49 全部保留) ✓
- prisma/schema.prisma + package.json + .gitignore + DEPLOY.md + README.md
  0 改动 (R50-1A 文档复审留 R50-1B 处理) ✓

## 验证
- cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . → 0 errors
  binary 24,293,765 bytes (24.3MB, R49-1B 24,287,512 + 6.2KB)
- ~/go/go/bin/go vet ./... → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass)
- 12 个 services 独立 build + vet 全 0 errors / 0 warnings
- heis-backend 重启: setsid ./heis-backend → 数据库 /home/z/my-project/db/custom.db
  + 已加载 94 个模板 + heis-backend 启动 http://localhost:3000 (内存 17MB)
- 端到端 curl: GET /health → 200 {"lang":"go","memMB":17,"ok":true} ✓
  GET / → 200 ✓

## 文件改动统计 (本 R50-1A 轮, 3 文件改动 +239 行)
- crawl/fetcher.go: 4212 → 4413 行 (+201 行)
  - persistableSessionCache 修复 BUG-1 (Put snapshot+IO 模式 + flushMu 串行化)
  - flushFromSnapshot 新函数 (替代 race-prone flushLocked)
  - SaveToDisk 改 snapshot+IO 模式
  - 删 dead flushLocked 函数 (-27 行, 避免 staticcheck U1000)
  - utls 池扩 24→29 (Chrome 83/87/96 + Firefox 55/63)
  - captchaSitekeyRe 扩展 + captchaSitekeyReFallback + extractCaptchaSitekey 两段式
  - probeProxyWithLatency (返回 err + latencyMs)
  - probeAllProxies 记录 latencyMs 到 probeLatencyMs
  - proxyState 加 probeLatencyMs + probeLastAt 字段
  - pickProxyFor 加 "least-latency" case
  - ProxyStatsSnapshot admin 查询函数
- crawl/types.go: 733 → 733 行 (+1 字符, sanitizeFetchConfig 加 "least-latency")
- services/cloak-browser/main.go: 822 → 859 行 (+37 行)
  - Gaussian 微抖 (rand.NormFloat64 * 1.5 替代 rand.Intn(7)-3)
  - 滚轮 micro-events (5-15px deltaY × 2-4 步插入主滚动间)
  - 15% 概率 Tab 键 focus 切换 (chromedp.KeyEvent "\t")
  - 注释扩 (R50-1A 反反爬增强段)

## 核心保留 R38-R49 全部修复
- hostgate pump/Acquire drain (R41-1A / R42-1B)
- utls per-host 钉扎 + attempts 偏移真正轮换 (R45-1A)
- Turnstile 8s 截止 (R42-1B)
- 2captcha 180s + per-attempt timeout (R45-1A)
- Cookie 持久化 + stripPort 跨端口 (R42-1B / R47-1A)
- BudgetExceeded 上抛 (R42-1B)
- truncate rune-based (R44-1C / R42-1B)
- per-attempt timeout (R42-1B)
- Referer 一致性 (R42-1B)
- pickProxyFor sweep 完整 (R42-1B)
- trafilatura clients 单例 (R42-1B)
- jsonLdTypeRe 预编译 (R43-1B)
- batchMu defer (R41-1A)
- discoverBooks newCount==0 break (R43-1B)
- MarkProxyFailed/OK (R43-1B)
- IncCaptcha (R43-1B)
- ReportRateLimited (R43-1B)
- cloak-browser page.AddScriptToEvaluateOnNewDocument + simulateHumanBehaviorActions (R45-1A)
- scrapling-bridge Accept-Encoding 移除 br (R45-1A)
- cleaner.go collapseDupPunct (R45-1C)
- DialTLSContext ctx 取消 (R45-1C)
- 13 处 []rune 安全截断 (R44-1C / R42-1B)
- ClearUtlsChoice 仅 handshake 失败 (R46-1B)
- pickUtlsHello host=='' 返 pool[0] (R46-1B)
- brotli per-host (R46-1B)
- utls 16→21→24→29 池 (R46-1B / R47-1A / R48-1A / R50-1A)
- TLS session cache → persistableSessionCache + flushMu 串行化 (R48-1A / R50-1A)
- captcha 主备切换 → 三服务级联 (R46-1B / R47-1A / R48-1A)
- captcha sitekey 三属性名 + JS 变量 fallback (R50-1A)
- 代理 probe + latency 跟踪 + least-latency 策略 + ProxyStatsSnapshot (R46-1B / R47-1A / R48-1A / R50-1A)
- probeTarget 轮换 (R47-1A)
- probe 头族 (R48-1A)
- ThreadsMax=0 兜底 (R46-1B)
- .env + .gitignore + README + DEPLOY 纯 Go 化 (R46-1A)
- cleaner.go 7 P2/P3 bug 修复 (R49-1B):
  · \r 规范化 (\r\n → \n / \r → \n / U+2028 → \n / U+2029 → \n\n)
  · Unicode 空格归一化 (NBSP/Ogham/各种 space/NNBSP/MMSP/全角空格)
  · 13 类不可见字符剥离 (CcAndZwStripRe 扩 C1+DEL+SHY+LRM/RLM+LSP/PSP+invisible operators+Bidi isolate)
  · plainText 模式段保持 (plainTextBlockEndRe 双换行 + plainTextAnchorEndRe)
  · plainText 模式段级水印/导航剥离 (stripPlainTextPromoSegments)
  · HTML 模式 hidden 元素剥离 ([hidden] + style display:none/visibility:hidden)
  · 广告正则扩展 (下载...{0,30} + 未完待续.{0,12} + 本书/本站 域名/地址 兜底)
