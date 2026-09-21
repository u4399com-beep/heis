# R41-1A: Go 采集引擎深度抓 bug + 反反爬增强

## Task ID: R41-1A
## Agent: full-stack-developer (Go采集引擎深度抓bug+反反爬)
## Scope: go-backend/crawl/ 8 模块 (7064 行) 深度审查 + 反反爬增强

## 第一步: 读交接文档

读了 `/home/z/my-project/worklog.md` 末尾 200 行, 主要了解到:
- TS 端采集引擎历史: 8 级降级链 + 并发架构 + cookieJar + cleaner trafilatura + R25-R34 多轮修复
- R38-1C 完成 Go 重写 7063 行
- R39-1C admin DBClient 适配器
- R40-1B admin 后台 8 个新页面

## 第二步: Go 采集引擎深度审查 (8 模块 7063 行)

逐行审查 8 模块, 识别 bug 如下:

### P0 严重 bug (并发安全 + 资源泄漏)

**P0-1 hostgate.go pump 槽位泄漏**
- `pump()` 第 211 行 `st.inFlight++` 后, 第 213-218 行的 `select { case w.ch <- ...: default: continue }` 若命中 default (waiter 已超时), inFlight 已增但 Release 永不会被调用 → 槽位永久泄漏, 该 host 最终死锁.
- **修复**: default 分支回滚 `st.inFlight--`.

**P0-2 hostgate.go Acquire ctx2.Done() 与 pump 竞态泄漏**
- Acquire 等待时, pump 可能在 ctx2 即将 Done 的瞬间成功 send 到 w.ch (buffered chan 容量 1). 此时 Acquire 的 select 若选中 ctx2.Done() 分支, inFlight 已增但 Release 永不调用 → 槽位泄漏.
- **修复**: ctx2.Done() 分支非阻塞 drain w.ch; 若有值则视为成功 admit, 返回 ticket.

**P0-3 runner.go 章节 goroutine 数据竞态**
- 阶段 2 章节 goroutine (858-893 行) 写多个共享变量无锁:
  - `stats.ChaptersUpdated++` / `stats.Errors++` (跨阶段共享)
  - `consecutiveErrs = 0` / `consecutiveErrs++` (跨 goroutine)
  - `done++` / `progress.ContentDone = done` (跨 goroutine + 主循环读)
  - `bookDoneMap[q.BookCtx.BookID]++` (map 并发写 panic 风险)
- 阶段 1 书籍 goroutine (752 行) `stats.Errors++` 也竞态.
- **修复**: 引入 `batchMu sync.Mutex` 保护所有共享计数器 / map 写.

**P0-4 runner.go rt.maxRequests 写入竞态**
- `rt.maxRequests = cfg.MaxRequests` (624 行) 在 `tr.runtimes[taskID] = rt` (612 行) **之后**, 无同步, admin 调 Snapshot 时可能读到零值.
- `SetMaxRequests` 函数用 `atomic.StoreInt64(&rt.epoch, rt.epoch)` 做 "memory barrier" 是错的 (epoch 自存自, 不是 barrier).
- **修复**: maxRequests 写入移到 registration 之前 (tr.mu.Lock 之前的 publish 即 memory barrier).

**P0-5 fetcher.go brotli 不解压**
- `Accept-Encoding: gzip, deflate, br` — Go net/http 自动解 gzip 但**不解 brotli**. 服务器返回 br 时 body 是原始 brotli 字节, parser 全炸.
- **修复**: 改 `Accept-Encoding: gzip, deflate` (curl `--compressed` 自动解全栈).

**P0-6 fetcher.go curl --no-keepalive 浪费**
- `--no-keepalive` 禁用 TCP keep-alive, 每请求新建连接, 浪费 + 慢 + 易触发频控.
- **修复**: 移除该 flag (curl 默认开 keepalive).

**P0-7 fetcher.go parentDomainChain 包含 TLD**
- 函数生成 `[a.b.example.com, b.example.com, example.com, com]` 末尾含 TLD "com". 若任一调用方 Store(domain="com", ...) 会污染所有 *.com 请求.
- **修复**: 跳过末段 (TLD), 不入 hosts.

### P1 正确性 bug

**P1-1 fetcher.go decodeBody 不识别 GBK**
- 许多中文小说站用 GBK, 当前直接 `string(body)` 会乱码.
- **修复**: 用 `golang.org/x/text/encoding/simplifiedchinese` (已在 go.mod) 按 Content-Type / meta charset 解码 GBK / GB18030.

**P1-2 fetcher.go 每请求新建 Transport 浪费**
- `fetchHttp` 每次创建 transport + client, 无连接复用, 高并发下 TCP 句柄爆炸.
- **修复**: 进程级单例 transport.

**P1-3 fetcher.go curl 自定义 headers 无控制字符剥离**
- `cfg.Headers` 注入 curl args 时不剥控制字符, 与 buildHeaders (net/http 路径) 不对称, 可能注入非法 header.
- **修复**: 用同款 strings.Map 剥离.

**P1-4 fetcher.go IsJSChallenge 逻辑混乱**
- `if len(html) > 20000` 分支恒返回 false (因 `&& len(html) < 5000` 永远不成立), 代码可读性差.
- **修复**: 简化为 `if len(html) > 20000 { return false }; return jsChallengeRe.MatchString(html)`.

**P1-5 fetcher.go proxyInst.useCount 无界增长**
- 代理 useCount map 只增不减, 长跑进程内存泄漏.
- **修复**: 周期性清扫 (每 5min 清未使用条目).

**P1-6 fetcher.go dead code inflightKey/inflightMap**
- 第 1330-1344 行声明但 fetchPageOnce 从未使用.
- **修复**: 保留 (供未来 inflight 去重), 不删 (删了破坏潜在 API).

### P1-2 反反爬增强 (新增)

**Enh-1 UA 池扩充**
- 当前 16 个 UA, 扩充到 24 个 (Chrome 137-142 / Firefox 125-130 / Safari 17.4-18.0 / Edge 137-141 / Android / iPhone / iPad / Linux).

**Enh-2 Sec-Ch-Ua 头族**
- 现代浏览器自动发 Sec-Ch-Ua / Sec-Ch-Ua-Mobile / Sec-Ch-Ua-Platform / Sec-Fetch-Site / Sec-Fetch-Mode / Sec-Fetch-Dest / Sec-Fetch-User.
- 当前缺失, 反爬易识别为非浏览器.
- **修复**: 按 UA 自动注入对应 Sec-Ch-Ua 头族.

**Enh-3 随机延迟 (per-host jitter)**
- 请求前 sleep `JitterMs` 随机毫秒, 避免频控. 已在 runner 批次间有 interval, 但单请求内无.
- **修复**: 在 fetchHttp 入口注入 `time.Sleep(rand(0, JitterMs))`.

**Enh-4 重试退避 (full jitter exponential)**
- 当前 fetchHttp 无重试, 429/5xx 直接失败. TS 端有 1.5s×2^n full jitter 封顶 8s.
- **修复**: fetchHttp 内部 retries 次, full jitter backoff.

**Enh-5 Per-host Referer 记忆**
- 当前 Referer 是 cfg.RefererURL 或目标站 origin. 真浏览器会记最近访问页 URL 作为下个请求的 Referer.
- **修复**: 全局 `hostRefererMap` (host → 最近内部页 URL), 自动注入.

**Enh-6 优先级头 (HTTP/2 priority)**
- 增 `Priority: u=0, i` 头 (HTTP/2 priority hint).

**Enh-7 Cookie 跨子域合并已有** (现状已 OK, 不动).

## 第三步: 反反爬增强实现

详见 fetcher.go patch.

## 第四步: 编译确认

- `cd go-backend && go build -o heis-backend . 2>&1 | tail -5` → 0 errors
- `go vet ./... 2>&1 | tail -5` → 0 warnings

## 第五步: worklog 追加

追加到 `/home/z/my-project/worklog.md`.
