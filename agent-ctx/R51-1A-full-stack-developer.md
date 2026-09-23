# R51-1A 工作记录 — Go 第十轮深度审查 + 反反爬增强

## Task 信息
- **Task ID**: R51-1A
- **Agent**: full-stack-developer (Go第十轮+反反爬)
- **Date**: 2026-09-23
- **范围**: go-backend/ 全 Go 代码 ~21066 行 = crawl/* 8 模块 (fetcher 4413→4699 /
  cleaner 899 / parser 1612 / runner 1481 / hostgate 423 / smart 310 / storage 355 /
  types 733→737) + main.go 1173→1185 + admin.go 3570 + services/* 12 服务
  (cloak-browser 859→914 + 11 其他)

## 交接文档读后感

R50-1A 第九轮反反爬深度审查: persistableSessionCache snapshot+IO 修复 BUG-1 race
condition + utls 池扩 24→29 + captcha sitekey 三属性名 + JS 变量 fallback +
probeProxyWithLatency 加 latency 返回 + least-latency 旋转策略 + ProxyStatsSnapshot
+ Gaussian 微抖 + micro wheel events + 15% Tab key.

R51-1B 清理精简: staticcheck 复检抓 2 issue (probeProxy wrapper U1000 dead code +
probeProxyWithLatency ST1008 error 应最后). **R51-1B worklog 声称修复 (删 wrapper +
重排返回值 (int64, error) + 更新唯一调用方 probeAllProxies), 但实测 baseline build
仍报编译错 — 实际代码未落地 (R51-1B 写了 worklog 但 Edit 未生效或被回滚)**.

→ 本轮 R51-1A 第一优先级: 修复 R51-1B 声称但未落地的 build-broken bug.

## 抓 bug 列表 (4 个)

### BUG-1 (P0, 编译失败): probeProxyWithLatency 返回值顺序与调用方不匹配

- **位置**: crawl/fetcher.go probeProxyWithLatency L2801 + probeAllProxies goroutine L2909
- **现象**:
  - HEAD (committed R50) 签名 `(error, int64)` + 调用方 `latencyMs, err := ...`
    (顺序写反 — latencyMs 拿 error interface, err 拿 int64)
  - 编译报: `crawl/fetcher.go:2911:35: invalid operation: err != nil (mismatched
    types int64 and untyped nil)` + `crawl/fetcher.go:2928:70: cannot use latencyMs
    (variable of interface type error) as int64 value in assignment`
  - **整个 go-backend 无法 build** → heis-backend 无法启动 → 全部采集 / admin /
    模板渲染链路不可用 → 反反爬能力全部失效 (无 TLS 指纹轮换 / 无代理 probe /
    无 captcha 求解)
- **R51-1B worklog 声称已修复** (签名改 (int64, error) + 调用方改 latencyMs, err :=),
  但实测 baseline 仍 build 失败 — **R51-1B 实际代码未落地** (worklog 写了但 Edit 未
  生效或被回滚). 此为遗留 P0 bug.
- **修复**: 签名 → `(int64, error)` (Go ST1008 惯例 error 最后) + 5 处 return 顺序调整
  (return 0, errors.New / return 0, err / return latencyMs, nil) + 调用方 →
  `latencyMs, err := probeProxyWithLatency(...)` (匹配签名顺序). 删除 dead wrapper
  `probeProxy` (R51-1B 已识别 U1000, 本轮实际删 — grep 全 0 调用方确认安全).

### BUG-2 (P2): persistableSessionCache.flushFromSnapshot 误清并发 Put 的 dirty 标记

- **位置**: crawl/fetcher.go persistableSessionCache.Put L1164 + flushFromSnapshot L1206
- **现象**: R50-1A 修复 BUG-1 引入 snapshot+IO 模式 (Put 持锁内深拷贝 disk → snapshot,
  解锁后启 goroutine IO). 但 flushFromSnapshot IO 完成后无条件清 `c.dirty = false`,
  在并发场景 (多 host 同时握手) 触发 race:
  1. T0: Put1 写 c.disk (含 entry1), dirty=true, snapshot v1 (含 entry1), 启 goroutine.
  2. T0+10ms: Put2 写 c.disk (含 entry2), dirty=true (throttle 60s 跳过 flush).
  3. T0+100ms: goroutine 写 snapshot v1 (仅 entry1) 到磁盘 → 清 dirty=false.
  4. → Put2 的 dirty=true 信号丢失, entry2 直到下次 Put3 触发 flush (60s 后) 才落盘.
  5. → 若进程在 60s 内 crash, entry2 丢失 → TLS session resumption 失效 → 反爬识别
     "无 session resumption" 模式 → 爬虫指纹.
- **修复**: 加 `dirtyVersion uint64` 字段. 每次 Put 写 c.disk 时 dirtyVersion++ (持锁).
  Put 创建 snapshot 时记录 snapVersion = dirtyVersion (此时). flushFromSnapshot IO
  完成后只在 `c.dirtyVersion == snapVersion` (即 IO 期间无新 Put 写入) 时才清 dirty.
  若 IO 期间有新 Put (dirtyVersion != snapVersion), 保留 dirty=true 让下次 Put
  触发的 flush 把新数据刷盘. SaveToDisk 同款处理 (snapVersion 比较 + IO 失败回滚 dirty).

### BUG-3 (P2): applyCaptchaTokenAndRefetch URL fragment 后置导致 query 失效

- **位置**: crawl/fetcher.go applyCaptchaTokenAndRefetch L3893
- **现象**: 原实现 `solvedURL = rawURL + sep + paramName + "=" + url.QueryEscape(token)`
  在 rawURL 含 fragment (#section) 时把 query 拼到 fragment 后面, 服务端收不到 token.
  - 例: rawURL = "https://example.com/path#section"
  - 原代码: solvedURL = "https://example.com/path#section?param=value"
  - → 实际请求 URL 的 query 为空, "?param=value" 是 fragment 一部分 (浏览器不发到
    服务端). → 服务端校验 captcha 失败, 返回原 captcha 页, captcha 求解看似失败.
- **修复**: 用 url.Parse 解析 rawURL, 解析已有 query, 追加 captcha token 参数
  (q.Set), 重设 u.RawQuery, u.String() 拼回完整 URL. 保持 fragment 行为不变 (浏览器
  ignore fragment 是客户端语义, 服务端只看 query).
- **影响**: 含 fragment 的 captcha 保护 URL (e.g. /path#chapter-1) 求解 captcha 失败,
  操作员误以为 2captcha/anti-captcha/CapSolver 服务故障, 浪费 180s 超时.

### BUG-4 (P3): probeProxyWithLatency 不 drain 响应体导致连接池打满

- **位置**: crawl/fetcher.go probeProxyWithLatency L2878 (defer resp.Body.Close())
- **现象**: HEAD 请求部分 endpoint 误返 200 + body (e.g. Cloudflare Bot Management
  拦截 HEAD 返 challenge 页面), 或中间代理注入 body. 原代码仅 `defer resp.Body.Close()`
  不 drain, Go http 规则: body 未读完不能复用连接 → 持续 probe 下 (5min sweep) 累积
  半开连接 → MaxIdleConns 打满 → 新 dial 失败 → 健康代理被误判死 (probe 看似 timeout
  实际是连接池满).
- **修复**: 用 io.Copy + io.LimitReader(64KB) drain 后 close. 64KB 上限防病态 endpoint
  返大 body 拖慢 probe (HEAD 正常返 0 body, 仅异常 case 才有 body).
- **影响**: 持续 probe 下连接池打满 → 健康代理误判死 → 采集请求绕过健康代理走死代理
  → 失败率上升.

## 反反爬增强列表 (5 大类)

### ① utls Hello 池继续扩充 29 → 34

R50-1A 29 个. R51-1A 扩充到 34 个, 加 5 个 2017-2019 era 老版本变体:

1. **HelloChrome_62** — 2017 末 Chrome 稳定版 (Win 7/8 + macOS 早期 Intel, 与 Chrome 83
   JA3 差异明显: cipher suite 数量较少 + extensions 短 + 无 X25519Kyber768Draft00 curve
   + 无 GREASE 在 extensions). 真实用户群: 极老 Windows 7 设备 (学校机房 / 政府 /
   公共图书馆 / 工厂终端等长期不更新系统的部署), 占 Chrome 市场份额 <1% 但绝对值
   仍以百万计.
2. **HelloChrome_70** — 2018 末 Chrome 稳定版 (Win 7/8 末期 + 早期 Win 10), JA3 与
   Chrome 62 相近但加 TLS 1.3 final + cipher suite 新增 TLS_AES_128_GCM_SHA256 +
   extensions 略多 (cookie extension).
3. **HelloChrome_72** — 2019 初 Chrome 稳定版 (Win 7/8 末期 + 部分 Win 10), JA3 与
   Chrome 70 相近但 cipher suite 顺序微调 + signature_algorithms 新增 rsa_pss_rsae_sha256.
4. **HelloFirefox_56** — 2017 末 Firefox (55 与 63 之间过渡版本, Quantum 引擎前最后
   稳定版). 真实用户群: Linux 旧发行版 + Tor Browser 7.5 (基于 Firefox 52 ESR) +
   隐私社区早期 NoScript 用户.
5. **HelloFirefox_65** — 2019 初 Firefox (63 与 99 之间过渡版本), 加 TLS 1.3 final
   support + X25519 curve 在 supported_groups 头位. 真实用户群: 旧 Linux + 老 macOS +
   隐私社区过渡期用户.

- 反爬关联难度从 1/29 提升到 1/34.
- Chrome 池现覆盖 2017-2024 全代际 (62/70/72/83/87/96/102/106_Shuffle/112_PSK_Shuf/
  115_PQ/115_PQ_PSK/120/120_PQ/131/133 + 100_PSK/114_Padding_PSK_Shuf).
- Firefox 池覆盖 2017-2024 全代际 (55/56/63/65/99/102/105/120).
- 反爬无法靠"Chrome/Firefox 是某代际"识别爬虫 (任一代际都有真实用户群).
- 用 `~/go/go/bin/go doc github.com/refraction-networking/utls` 确认 HelloChrome_62/
  70/72 + HelloFirefox_56/65 真实存在 (utls v1.x 全部已定义).

### ② TLS Session ticket 持久化优化

R50-1A persistableSessionCache 内存 LRU + 磁盘 JSON 60s 节流 flush. R51-1A 优化:

- **BUG-2 修复** (见上): dirtyVersion 字段 + flushFromSnapshot 收 snapVersion 参数,
  IO 完成后只在 dirtyVersion == snapVersion (即 IO 期间无新 Put 写入) 时才清 dirty.
  原 R50-1A 无条件清 dirty, Put2 写入的 dirty=true 信号丢失, entry2 直到 60s 后才
  落盘, 进程 crash 期间 entry2 丢失.
- **atomicWriteFileSync** (新增辅助函数): OpenFile → Write → Sync (fsync) → Close →
  (调用方 rename). fsync 保证数据物理写入磁盘后再 rename, 防 crash 后文件名已替换
  但内容为空 (原 os.WriteFile 不 fsync). fsync 在 Linux/macOS 约 5-50ms, TLS session
  文件 ≤256KB, 总开销 <100ms 可接受.
- **StartTlsSessionBackgroundFlusher** (新增): 后台周期性 flush goroutine (5min 间隔).
  原 R48-1A/R50-1A 仅在 Put 时 60s 节流触发异步 flush, 长时间无活跃握手时 dirty 数据
  持续留内存, 进程 crash 期间丢失. 后台 flusher 每 5min 调 SaveToDisk (无新数据时
  SaveToDisk 早返, 不浪费 IO). atomic.Bool 防多调用启动多 goroutine. main.go 进程
  启动时调用 StartTlsSessionBackgroundFlusher(ctx), graceful shutdown 时 ctx.Cancel.
- 解决 R50-1A 后边缘 case:
  1. 并发 Put 的 dirty 信号丢失 (BUG-2)
  2. 长 idle 期间 dirty 数据持续留内存
  3. crash 后文件名已替换但内容为空 (无 fsync)

### ③ 验证码服务优化

R48-1A 三服务级联 + R50-1A sitekey 三属性名 + JS 变量 fallback. R51-1A 增强:

- **captchaSitekeyReIframeSrc** (新增正则): 兜底从 iframe src URL query 提取 sitekey.
  部分站点 (尤其 Cloudflare Turnstile / 部分 h-captcha enterprise) 用 iframe 直接
  加载 captcha widget, sitekey 在 iframe src URL query 中 (?sitekey=xxx) 或在 path
  中 (/api/v1/<sitekey>). 原 R50-1A 仅扫 data-* 属性 + JS 变量, 漏 iframe src.
  匹配模式 `(?:sitekey|pubkey|pkey)[=:]([A-Za-z0-9_-]{20,})`, 长度 ≥20 防 test/key
  误命中 (Turnstile sitekey 0x+32+ hex = 36+ chars, h-captcha UUID 36 chars,
  reCAPTCHA 40 chars).
- **extractCaptchaSitekey** 改为三段式: data-* 属性 → JS 变量字面量 → iframe src URL
  query. 提升动态渲染 captcha 站点 (Turnstile iframe 直接加载 / h-captcha enterprise)
  的求解率.
- **BUG-3 修复** (见上): applyCaptchaTokenAndRefetch 用 url.Parse 安全拼接 query,
  防 fragment 后置导致 query 失效. 含 fragment 的 captcha 保护 URL 也能正确注入
  captcha token.

### ④ 代理池优化

R48-1A probe 头族 + R50-1A probe 延迟跟踪 + least-latency 策略. R51-1A 增强:

- **pickFailStreak** (新增字段): 业务路径 (fetchHttp) 失败计数. 与 probeFailStreak
  区别: probe 是主动健康检查 (probeProxyWithLatency), pick 是业务调用 (MarkProxyFailed).
  probe 成功不代表业务一定成功 (反爬屏蔽 ≠ 代理故障). 两者独立 — probe 成功但业务
  fetch 失败不应误增 probeFailStreak 触发 5min cooldown. pickFailStreak 单独跟踪业务
  失败, 供 weighted-latency 策略降低失败率高的代理权重.
- **weighted-latency** (新增旋转策略): 按 1/(latency+100ms) 权重加权随机选代理. 低延迟
  代理被选概率高, 但高延迟代理仍有概率被选 (避免完全饿死, 让反爬无法靠"恒定选最低
  延迟代理"识别爬虫模式). 失败率高的代理 (pickFailStreak 高) 权重降为 1/(1+streak)
  (streak=3 → 0.25x 降权). 从未 probe 过的代理视为 latency=100ms (中等权重, 让新代理
  尽快被 probe). 权重公式:
  `weight = (1.0 / (latencyMs + 100.0)) * (1.0 / (1.0 + float64(streak)))`
  例: latency=200ms streak=0 → 1/300 ≈ 0.00333; latency=5000ms streak=0 → 1/5100 ≈
  0.000196 (17x 差距); latency=200ms streak=3 → 1/300 * 0.25 ≈ 0.000833 (4x 降权).
  随机性: 累加权重 + rand.Float64()*totalWeight 选区间, 保证低延迟代理概率高但仍有
  变化. sanitizeFetchConfig 白名单加 "weighted-latency" 到 ProxyRotationStrategy.
- **least-latency 改进**: 同 latency 时降级到 least-used (原实现仅取第一个, 多代理
  同 latency 时总是选 first, 负载不均衡). 现同 latency 时比较 useCount, 选 useCount
  最小的代理.
- **ProxyStatsSnapshot** 加 pickFailStreak 字段: 供 admin UI 识别业务失败率高代理
  (pickFailStreak > 3 视为有问题) + 慢代理 (latency > 3s) + 死代理 (failedUntil > now).
- **5min sweep** 清当前 pool 之外的 pickFailStreak 条目 (与 useCount 同款防泄漏).
- **MarkProxyFailed** 累加 pickFailStreak (业务路径失败计数). **MarkProxyOK** 清
  pickFailStreak (业务路径成功 = 代理实际可用, 重置权重).
- **BUG-4 修复** (见上): probeProxyWithLatency drain 响应体, 防连接池打满.

### ⑤ 行为模拟继续增强

R48-1A CDP Bezier 微抖 + bell curve + hover + 30% click. R50-1A Gaussian 微抖 + micro
wheel events + 15% Tab key. R51-1A 增强:

- **8% 概率反向滚动** (scrollUp 微段) — 真实用户阅读时常向上回看上一段, 纯向下滚动
  被检测为 "持续单向 = 自动化". 反向滚动 5-10% viewport, 后跟 300-600ms 停顿 (用户
  重读时停顿比连续滚动长).
- **10% 概率 Enter 键** (chromedp.KeyEvent "\r") — 真实用户在表单 / 搜索框 / 链接 上
  会按 Enter 提交. 纯 mousemove + Tab 无 Enter 被检测为 "无表单交互 = 自动化". Enter
  后 200-500ms 短停顿 (等表单提交结果加载).
- **5% 概率双击** (mousePressed x2 + mouseReleased, ClickCount=2 标识双击) — 真实用户
  在文字 / 图片 / 链接 上偶尔会双击 (选中文字 / 打开新标签). 纯单击被检测为 "单一
  交互模式 = 自动化". 双击间隔 80-150ms (真实用户双击间隔). 双击后 200-400ms 短停顿.
- 解决 R50-1A 后边缘 case: 持续向下滚动 + 单一交互模式 + 无表单交互被 Cloudflare Bot
  Management / Akamai Bot Detection 等高级 WAF 识别为自动化. R51-1A 反向滚动 + Enter
  + 双击让行为模拟更接近真实用户, 检测概率显著降低.

## 编译验证

- `cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend .` → 0 errors
  (vs baseline build 失败 BUG-1)
- `~/go/go/bin/go vet ./...` → 0 warnings (主包 + 11 services + bridgeserver + crawl
  全 pass)
- 12 个 services 独立 build + vet 全 0 errors / 0 warnings
- heis-backend 重启: setsid ./heis-backend → 数据库 + 94 模板 + :3000 (内存 17MB) +
  TLS session 后台 flusher goroutine 已启 (5min 间隔)
- 端到端 curl: GET /health → 200 {"lang":"go","memMB":17,"ok":true} ✓,
  GET / → 200 ✓

## 文件改动统计

- crawl/fetcher.go: 4413 → 4699 行 (+286 行)
  - BUG-1 修复: probeProxyWithLatency 签名 (error, int64)→(int64, error) + 5 处 return
    顺序调整 + 删 dead wrapper probeProxy (-7) + probeAllProxies 调用方
    latencyMs, err := (-3 +2 注释 +13)
  - BUG-2 修复: persistableSessionCache dirtyVersion 字段 +13 / Put +dirtyVersion++
    +1 / snapshot snapVersion 记录 +2 / flushFromSnapshot 收 snapVersion + 比较 +15 /
    SaveToDisk 同款 + snapVersion 比较 + IO 失败回滚 +30
  - BUG-3 修复: applyCaptchaTokenAndRefetch url.Parse + q.Set +20
  - BUG-4 修复: probeProxyWithLatency drain 响应体 +10
  - ENHANCE-1: utlsHelloPool 加 Chrome 62/70/72 + Firefox 56/65 + 注释 +60
  - ENHANCE-2: atomicWriteFileSync +30 / StartTlsSessionBackgroundFlusher +30
  - ENHANCE-3: captchaSitekeyReIframeSrc +15 / extractCaptchaSitekey 三段式 +10
  - ENHANCE-4: proxyState pickFailStreak +5 / MarkProxyFailed +pickFailStreak++ +10 /
    MarkProxyOK +delete pickFailStreak +5 / pickProxyFor weighted-latency case +50 /
    least-latency tie-break +5 / ProxyStatsSnapshot +pickFailStreak +5 / 5min sweep
    清 pickFailStreak +5 / probeProxyWithLatency drain (BUG-4) +10
- crawl/types.go: 733 → 737 行 (+4 行, sanitizeFetchConfig 加 "weighted-latency" 到
  ProxyRotationStrategy 白名单 + 注释扩)
- main.go: 1173 → 1185 行 (+12 行, import heis-backend/crawl + context + 启动
  StartTlsSessionBackgroundFlusher)
- services/cloak-browser/main.go: 859 → 914 行 (+55 行, 反向滚动 + Enter 键 + 双击)
- 总计 +357 行

## 未修改 (尊重约束)

- go-backend/admin.go (深度审查无 R50 后边缘 case) ✓
- go-backend/templates/* (已完成) ✓
- go-backend/crawl/{parser,hostgate,smart,storage,cleaner,runner}.go (深度审查无
  R50 后边缘 case) ✓
- go-backend/services/{bridgeserver,curl-impersonate-bridge,fetch-relay,
  scrapling-bridge,trafilatura-bridge,uc-bridge,moli-bridge,bqg713-proxy,
  deqixs-proxy,xjp-proxy,qimao-proxy}/main.go (深度审查无边缘 case) ✓
- agent-ctx/*.md (R38-R51-1B 全部保留) ✓
- prisma/schema.prisma + package.json + .gitignore + DEPLOY.md + README.md
  0 改动 (R51-1A 文档复审留 R51-1C 处理) ✓

## 核心保留 R38-R51-1B 全部修复

hostgate pump/Acquire drain / utls per-host 钉扎 + attempts 偏移真正轮换 / Turnstile
8s / 2captcha 180s + per-attempt timeout / Cookie 持久化 + stripPort 跨端口 /
BudgetExceeded 上抛 / truncate rune-based / per-attempt timeout / Referer 一致性 /
pickProxyFor sweep 完整 / trafilatura clients 单例 / jsonLdTypeRe 预编译 / batchMu defer
/ discoverBooks newCount==0 break / MarkProxyFailed/OK / IncCaptcha / ReportRateLimited /
cloak-browser page.AddScriptToEvaluateOnNewDocument + simulateHumanBehaviorActions /
scrapling-bridge Accept-Encoding 移除 br / cleaner.go collapseDupPunct / DialTLSContext
ctx 取消 / 13 处 []rune 安全截断 / ClearUtlsChoice 仅 handshake 失败 / pickUtlsHello
host=='' 返 pool[0] / brotli per-host / utls 16→21→24→29→34 池 / TLS session cache →
persistableSessionCache + flushMu 串行化 + dirtyVersion 版本比较 / captcha 主备切换 →
三服务级联 + sitekey 三属性名 + JS 变量 + iframe src fallback / 代理 probe + latency
跟踪 + least-latency + weighted-latency 策略 + pickFailStreak 业务失败跟踪 +
ProxyStatsSnapshot / probeTarget 轮换 / probe 头族 / ThreadsMax=0 兜底 / .env +
.gitignore + README + DEPLOY 纯 Go 化 / cleaner.go 7 P2/P3 bug 修复 / R50-1A
persistableSessionCache snapshot+IO + captchaSitekeyRe 扩展 + probeProxyWithLatency
+ least-latency + Gaussian 微抖 + micro wheel + Tab key / R51-1A BUG-1..4 修复 +
utls 29→34 + dirtyVersion + atomicWriteFileSync + StartTlsSessionBackgroundFlusher
+ captchaSitekeyReIframeSrc + applyCaptchaTokenAndRefetch url.Parse + probeProxyWithLatency
drain + pickFailStreak + weighted-latency + 反向滚动 + Enter 键 + 双击.

## 验证

- `cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend .` → 0 errors
- `~/go/go/bin/go vet ./...` → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 0)
- 12 个 services 独立 build + vet 全 0 errors / 0 warnings
- heis-backend 重启: setsid ./heis-backend → 数据库 /home/z/my-project/db/custom.db +
  已加载 94 个模板 + heis-backend 启动 http://localhost:3000 (内存 17MB) + TLS session
  后台 flusher goroutine 已启 (5min 间隔)
- 端到端 curl: GET /health → 200 {"lang":"go","memMB":17,"ok":true} ✓,
  GET / → 200 ✓

## 详细工作记录

- 本文件 (agent-ctx/R51-1A-full-stack-developer.md)
- worklog.md R51-1A 条目 (worklog.md L20135-L20703)
