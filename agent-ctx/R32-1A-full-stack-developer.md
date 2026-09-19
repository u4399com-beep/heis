# R32-1A 采集第六轮 + 并发边缘 case 深度审查

**Agent**: full-stack-developer
**Task ID**: R32-1A
**完成时间**: 2026-09-19

## 任务概述

R31-1B 引入并发采集架构(Semaphore + crawlBookMeta/crawlChapterContent/finalizeBook
三阶段)后, 做第六轮深度抓 bug, 重点找并发架构引入的边缘 case + 潜在问题.

审查范围: runner.ts 并发架构 + fetcher.ts 第六轮 + obscura.ts 第六轮 + cleaner.ts
第六轮 + types.ts concurrency 钳制.

## 1. 读交接

- worklog.md 末 200 行: R31-1B 并发架构改造(Semaphore 类 / crawlOneBook 拆三方法 /
  executeTask 三阶段) + R31-1D 第五轮修复(cookieJar 主罐键统一 hostname format +
  huangjinwu/HomeClone hook 重构)
- agent-ctx/R31-1B-full-stack-developer.md: 详细工作记录(7 章节)
- agent-ctx/R31-1D-full-stack-developer.md: 第五轮 8 模块审查 + P0×1 + P1×1 修复

## 2. 第六轮深度审查

### 2.1 runner.ts 并发架构边缘 case 审查(R31-1B 引入)

**Semaphore 类(line 215-243)**:
- acquire FIFO 队列 + release 唤醒队首 ✓ —— JS 单线程无竞态, 同步段
  `available--`/`waiters.push` 原子, 释放路径"许可权转交"(waiter resolve 不增
  available, waiter 续行已持虚拟许可)正确
- acquire/release try/finally 配对 ✓ —— 早返回(stopped/isStale)在 acquire 之前,
  不需 release; skip-completed/crawlBookMeta 在 try 内, finally 必 release
- **审查结论**: Semaphore 实现正确, 无竞态/死锁/许可泄漏

**阶段 1 Promise.all 批次循环(line 952-1107)**:
- 单本失败隔离 ✓ —— catch 块返回 `{ status: 'error', bookUrl }`, Promise.all 不
  reject, 其他书继续
- BudgetExceeded/isCircuitBreak 上抛 ✓ —— catch 块 `if (e?.name === 'BudgetExceeded'
  || e?.isCircuitBreak) throw e`, Promise.all reject → executeTask 外层 catch →
  error 终态
- 在线调参(live DB threadMin/Max/intervalMin/Max) ✓ —— 每批次读 DB, JS 单线程
  无竞态
- progress.tocTotal 全局累计 ✓ —— Promise.all resolve 后顺序 `+=` (line 1100),
  无并发写
- **审查结论**: 阶段 1 批次循环正确, 无竞态

**阶段 2 chapter queue 全局并发(line 1146-1280)**:
- 跨书章节归属 ✓ —— ChapterTask.bookCtx 共享引用, bookDoneMap 按 bookId 累加,
  JS 单线程 `get+set` 间无 await 原子
- consecutiveErrs 跨书累计 ✓ —— 同步 `++`/`= 0` 原子, microtask 序决定最终值
  但语义正确(连续失败熔断, 非全部失败)
- tt-c 熔断检查每批次末 ✓ —— `consecutiveErrs >= CIRCUIT_ERROR_LIMIT` throw
  isCircuitBreak, 跨批次累计正确
- **审查结论**: 阶段 2 全局并发正确

**finalizeBook 阶段 3 串行(line 1290-1305)**:
- 串行 for 循环 ✓ —— 不影响并发性能(收尾统计/下拉词/状态分流轻量, phase 2 已
  完成所有重 IO)
- 单本失败隔离 ✓ —— catch 块 `stats.errors++ + log`, 不影响其他书
- BudgetExceeded 上抛 ✓ —— 防御性 `if (e?.name === 'BudgetExceeded' ||
  e?.isCircuitBreak) throw e`
- **审查结论**: 阶段 3 串行正确

**progress 全局对象并发下原子性**:
- booksDone++ / contentDone++ / errors++ / chaptersUpdated++ ✓ —— JS 单线程
  `++` 原子, 无数据竞争
- saveProgress 并发调用(phase 1 crawlBookMeta 内 + phase 2 回调) —— lost-update
  可能(DB 快照稍旧, 影响重启 resume Sets 少量条目, 非正确性 bug, 不修)

**rt.ongoingBookUrls/completedBookUrls Set 并发下线程安全**:
- Set.add / Set.delete / Map.set / Map.delete ✓ —— JS 单线程原子
- addToResumeSet FIFO 淘汰 ✓ —— 同步段, 无竞态

### 2.2 fetcher.ts 第六轮(curl-impersonate + cookieJar + 8 级降级链)

**curl-impersonate 接入后的降级链完整性**:
- 8 级降级链 ✓ —— native → curl → curl-impersonate-bridge → fetch-relay →
  scrapling-static → scrapling-stealthy → Obscura → uc-bridge → moli-bridge
- fetchHttpWithCurlSingle 两路径(proxy/no-proxy)curl-impersonate 兜底 ✓ ——
  impErr.status > 0 透传(保留 bodyHtml), status=0 重抛 curlErr(零回归)
- cookieJar 回写 ✓ —— fetchViaCurlImpersonateFallback line 3697
  `cookieJar.store(originHost(url), result.setCookies)`

**cookieJar 键统一(R31-1D 修复后)边界**:
- store/seed/count/clear/restore 5 处主罐键 hostname format ✓ —— 与 get 的
  parentDomainChain 返回格式一致, host-only cookie 命中
- 副罐条件 `effectiveCookieDomain !== mainKey` ✓ —— 同域不建副罐, 节省内存
- restore 兼容旧 origin format 持久化文件 ✓ —— `hostOf(e.d) || e.d`

**8 级降级链错误传播**:
- 桥不可达/桥内异常 → null/throw, 走原错误路径 ✓
- 目标侧 HTTP 响应(4xx/5xx) → 透传 status/bodyHtml ✓
- **审查结论**: fetcher 8 级降级链核心保留, 无回归

### 2.3 obscura.ts 第六轮(cookie 回写 + 池管理 + 内存泄漏)

**cookie 回写后的池管理边界**:
- restoreCookiesToContext(line 1092-1104) ✓ —— slot 重建/新建后同步 cookieJar
  凭证, 失败静默降级
- parseCookieHeaderToPlaywright domain=`.${hostname}` ✓ —— Playwright 子域共享
  语义; 跨子域跳转(www→api)需重建 slot(不同 origin), restoreCookiesToContext
  重新调, 设计如此
- ctx.cookies() 全量回传(line 1715) ✓ —— Bug18 修复保留, cf_clearance 零丢失

**长时间运行内存泄漏**:
- S.slots 上限 MAX_CONCURRENCY(默认 2) ✓ —— createSlot push, recreateSlot
  失败 3 次 splice, shutdownObscura splice 全部
- scheduleReclaim 心跳回收(line 1296-1326) ✓ —— 60s 扫, 10min 未用 close ctx
  (slot 保留, 下次重建); busy=true 锁定防并发抢空槽
- consecutiveFailures 计数 ✓ —— 3 次移除 slot 缩减池容量
- **审查结论**: obscura 池管理无内存泄漏

### 2.4 cleaner.ts 第六轮(trafilatura + 三层降级链 + 60s 缓存)

**trafilatura 接入后的三层降级链**:
- ① useTrafilatura=true 先模式: cleanContentHtmlAsync 调桥, 失败降级 cheerio ✓
- ② trafilaturaFallback=true 兜底模式: runner 调 tryTrafilaturaExtract, 结果
  >2x cleaner 才采纳 ✓
- ③ cleanContentHtml 同步 cheerio 链(零回归基础) ✓

**60s 缓存边界**:
- checkTrafilaturaBridge(line 45-72) ✓ —— available=true 永久缓存(下次 /extract
  失败时转 false + 60s 缓存), available=false 60s 缓存
- 桥首次失败后 20s 超时(TRAFILATURA_REQUEST_TIMEOUT_MS) —— 可接受降级时延
- HTML 大小上限 10MB ✓ —— `Buffer.byteLength > TRAFILATURA_MAX_HTML_BYTES` 跳过

**pruneXPath 透传 + 落空文本降级 cheerio** ✓ —— cleanContentHtmlAsync line 1002
`segments.length === 0` 降级回 cleanContentHtml

**R26-1A U+2060 控制字符剥离** ✓ —— 与 downloader.ts ZW_CHARS 同口径

### 2.5 types.ts concurrency 字段钳制(R31-1B 新增)

- FetchConfig.concurrency?: number(line 308) ✓ —— 缺省 3, 钳 [1, 10]
- sanitizeFetchConfig(line 978-979) ✓ —— `safeNum(r.concurrency, 1, 10)`,
  字符串数字/"abc"/0/100 全钳制
- DEFAULT_FETCH_CONFIG 无 concurrency 字段 ✓ —— runner 用 `Number(undefined ??
  undefined) || 3` 兜底 3
- 与 hostGateLimit 正交 ✓ —— hostGateLimit=单 host 在飞上限(全局闸门),
  concurrency=单任务内并发作业数(任务级调度上限)

## 3. 修复(R32-1A 共 ~+40 行, P1×4)

### P1 修复① urls 模式 bookQueue 去重

- runner.ts line 809-816(+8 行)
- 修前: `bookQueue = urlsList.slice()` 保留重复 URL. 并发架构下同一 bookUrl 会被
  两个 crawlBookMeta 回调并发处理:
  (1)两次 fetch 同一书籍页(浪费请求 + 同 hostGate 槽位竞争)
  (2)db.book.findFirst/create 竞态(一成一 P2002 失败, 一本被计 error)
  (3)globalQueue 章节翻倍(同 bookId 的 queue push 两次, 阶段 2 重复抓同一批章节)
  (4)finalizeBook 调两次(progress.booksDone 虚高 + fetchSuggestKeywords 重复
     网络请求 + db.book.update 重复写)
- 修后: `bookQueue = Array.from(new Set(urlsList))` —— Set 保留插入序, 与 range
  模式 line 922 `Array.from(new Set(sliced))` 同口径, 零回归
- single 模式天然 1 本无需去重, range 模式已去重, 本处补齐 urls 模式

### P1 修复② failedBookUrls 瞬态错误 add(phase 1 catch 块)

- runner.ts line 1070-1098(+9 行)
- TaskRuntime.failedBookUrls 注释(line 58-61): "瞬态错误(超时/HostGate/抓取异常)
  的书籍 URL 集合, 用于'仅重试失败'模式(未来)和可见性. crawlOneBook 返回 'ok'
  时从中移除; 抛瞬态错误时加入"
- R31-1B 重构 crawlOneBook → crawlBookMeta 时漏了 add 调用: 只有 crawlBookMeta
  的 incremental/cross-source 跳过路径(line 1873/1919)与 finalizeBook(line 2413)
  的 delete, 没有 catch 块的 add. 修前 failedBookUrls 永远空集, "仅重试失败"
  模式无数据可用.
- 修后: catch 块 isFetchTimeout/HostGateTimeout/other 三类瞬态错误调
  `addToResumeSet(rt.failedBookUrls, bookUrl)`, AbortError(停止/换代)不 add
  (非瞬态, 重试无意义), 与 delete 路径对称保持集合干净

### P1 修复③ skip-completed 路径 failedBookUrls.delete

- runner.ts line 1035-1045(+8 行)
- 原设计: "crawlOneBook 返回 'ok' 时从中移除". R31-1B 把 skip-completed 从
  crawlOneBook 拆出到 batch callback, 但漏了 delete 调用:
  - incremental 跳过(crawlBookMeta line 1873)有 delete ✓
  - cross-source 跳过(crawlBookMeta line 1919)有 delete ✓
  - finalizeBook ok-meta 完成(line 2413)有 delete ✓
  - skip-completed(batch callback)漏 delete ✗
- 修前: 一本书曾瞬态失败进 failedBookUrls, 后续轮采成功进 completedBookUrls,
  skip-completed 跳过但 failedBookUrls 残留条目, "仅重试失败"模式会重复重试
  已完结书(浪费请求)
- 修后: 与其他 'ok' 返回路径同口径 `rt.failedBookUrls.delete(bookUrl)`

### P1 修复④ failedBookUrls 跨重启恢复

- runner.ts line 778-787(+10 行)
- 修前: saveProgress(line 2441) `progress.failedBookUrls = Array.from(rt.failedBookUrls)
  .slice(0, MAX_RESUME_SET_SIZE)` 落库, 但 resume 路径(line 762-796)只恢复
  discovered/completed/ongoing/bookLastChapters 四项, 漏掉 failedBookUrls.
  结果: 上一轮采集的瞬态失败书籍 URL 持久化了但下次启动 rt.failedBookUrls
  永远空集(初始化为 new Set() at line 602), "仅重试失败"模式拿不到失败列表
  数据. 配合 P1 修复②(add)后, 落库有数据但读不回, 形成"写而不读"的断链.
- 修后: resume 路径按与 discovered/completed/ongoing 同口径恢复:
  `const failed = Array.isArray(progress.failedBookUrls) ? progress.failedBookUrls : []`
  `rt.failedBookUrls = new Set(failed.filter((u) => typeof u === 'string' && u))`
- full 模式不重置 failedBookUrls(line 753-761 注释 "failedBookUrls 跨轮保留"),
  与本轮恢复逻辑正交(分别处理 full 重置 vs 增量恢复两个路径)

## 4. 验证

- `bun run lint` → 0 errors / 0 warnings exit 0 ✓
- `bunx tsc --noEmit` → 0 errors in src/ ✓ (排除 examples/skills 预存在:
  examples/websocket socket.io-client 缺失 + skills/image-edit 类型 +
  skills/stock-analysis 类型, 均与本轮无关)
- dev.log → Next.js 16.1.3 ready, GET / 200, 无报错 ✓

## 5. 修改文件清单

1. src/lib/crawl/runner.ts (+~35 行净增):
   - line 809-816: urls 模式 bookQueue 去重(P1 ①)
   - line 778-787: resume 路径 failedBookUrls 恢复(P1 ④)
   - line 1035-1045: skip-completed 路径 failedBookUrls.delete(P1 ③)
   - line 1070-1098: catch 块瞬态错误 failedBookUrls.add(P1 ②)

## 6. 历史保留 + 零回归

- 历史修复全部保留: R25-1A2/R25-1A3/R26-1A/R27-1A/R27-1B/R28-1A/R28-1B/R28-1C/
  R29-1D/R30-1A/R31-1B/R31-1D 全部不动
- R31-1B 并发架构核心不动: Semaphore 类 + crawlBookMeta/crawlChapterContent/
  finalizeBook 三方法 + executeTask 三阶段 + BookMetaResult/BookMetaContext/
  ChapterTask 类型 全保留
- 审查后零回归未改: Semaphore acquire/release 配对 ✓ + 阶段 1 Promise.all 批次
  隔离 ✓ + 阶段 2 全局并发跨书归属 ✓ + 阶段 3 串行 finalizeBook ✓ +
  BudgetExceeded/isCircuitBreak 上抛 ✓ + 在线调参 live DB 读 ✓ + progress
  全局对象原子性 ✓ + rt.ongoingBookUrls/completedBookUrls Set 线程安全 ✓ +
  fetcher 8 级降级链核心 ✓ + obscura 池管理/心跳回收 ✓ + cleaner trafilatura
  三层降级 + 60s 缓存 ✓ + types.ts concurrency 钳制 ✓
- 未修改(尊重约束): src/components/public/*(前端) + page.tsx/PublicSite.tsx
  (主控已改) + rule-templates/seed-rules(C agent 校准) + obscura.ts/fetcher.ts/
  cleaner.ts/types.ts(本轮无 P0/P1 bug, 不动) + prisma/schema.prisma +
  package.json(0 新依赖)

## 7. 审查结论

**无 P0 bug**: R31-1B 并发架构在 JS 单线程模型下无竞态/死锁/数据竞争.
Semaphore acquire/release 配对正确, Promise.all 批次循环错误隔离正确,
全局 chapter queue 跨书归属正确, finalizeBook 串行不影响性能,
BudgetExceeded/isCircuitBreak 上抛路径正确, 在线调参 live DB 读无竞态,
progress 全局对象 ++ 原子, rt Set/Map add/delete 原子.

**P1 bug ×4**(均为 R31-1B 重构遗漏 + 原设计未实现):
- ① urls 模式 bookQueue 去重缺失(并发架构下重复 URL 放大问题)
- ② failedBookUrls 瞬态错误 add 缺失(R31-1B 重构遗漏)
- ③ skip-completed 路径 failedBookUrls.delete 缺失(R31-1B 拆出遗漏)
- ④ failedBookUrls 跨重启恢复缺失(原设计 saveProgress 写但 resume 不读)

**P2 已知不修**:
- saveProgress 并发调用 lost-update(影响重启 resume Sets 少量条目, 非正确性
  bug, 修需 per-task mutex 串行化, 减慢 phase 1, 不值得)
- trafilatura 60s 缓存首次失败 20s 超时(可接受降级时延)
- obscura cookieProvider domain 收窄(跨子域跳转需重建 slot, 设计如此)
