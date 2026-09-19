# R33-1B 采集第七轮深度抓 bug

**Agent**: full-stack-developer
**Task ID**: R33-1B
**完成时间**: 2026-09-19

## 任务概述

R25-R32 六轮深度审查后, 做第七轮深度抓 bug, 重点找 R31-1B 并发架构 + R32-1A
failedBookUrls 修复后的边缘 case + curl-impersonate + trafilatura 接入后的潜在问题.

审查范围: fetcher.ts 第七轮 + obscura.ts 第七轮 + cleaner.ts 第七轮 +
types.ts 第七轮 + sorter.ts 第七轮 + storage.ts 第七轮 + hostgate.ts 第七轮 +
downloader.ts 第七轮 + calibrate.ts 第七轮 + fetcher-curl-impersonate.ts 第七轮.

## 1. 读交接

- worklog.md 末 200 行: R32-1A 第六轮深度审查 + P1×4 修复(urls 去重 +
  failedBookUrls add/delete/resume), R32-1B clone-themes + seed-rule 校准
- agent-ctx/R32-1A-full-stack-developer.md: 详细工作记录(7 章节)
- R31-1B 并发架构改造(Semaphore + crawlBookMeta/crawlChapterContent/finalizeBook
  三阶段), R31-1D cookieJar 5 处主罐键统一 hostname format

## 2. 第七轮深度审查 8 模块

### 2.1 fetcher.ts 第七轮(8 级降级链 + cookieJar + curl-impersonate)

**8 级降级链完整性**:
- native(bun/node fetch, BoringSSL/undici) → curl(系统 curl 或 curl-impersonate-
  {profile} 二进制) → curl-impersonate-bridge(curl_cffi 模拟 Chrome/Firefox/
  Safari TLS ClientHello + HTTP/2 SETTINGS 帧 + 头组顺序) → fetch-relay(bun,
  BoringSSL) → scrapling-static(curl_cffi) → scrapling-stealthy(patchright) →
  Obscura → uc-bridge(undetected-chromedriver) → moli-bridge(Rust AI 浏览器)
- fetchHttpWithCurlSingle 两路径(proxy/no-proxy)curl-impersonate 兜底 ✓ ——
  impErr.status > 0 透传(保留 bodyHtml), status=0 重抛 curlErr(零回归)

**cookieJar 键统一(R31-1D 修复后)边界**:
- store/seed/count/clear/restore 5 处主罐键 hostname format ✓ —— 与 get 的
  parentDomainChain 返回格式一致, host-only cookie 命中
- 副罐条件 `effectiveCookieDomain !== mainKey` ✓ —— 同域不建副罐, 节省内存
- restore 兼容旧 origin format 持久化文件 ✓ —— `hostOf(e.d) || e.d`

**curl-impersonate 桥响应处理**:
- 成功路径(status<400): setCookies 写回 cookieJar ✓
- **P1 bug ①**: 4xx/5xx 路径 setCookies 丢弃(详见修复①)

### 2.2 obscura.ts 第七轮(cookie 回写 + 池管理 + 内存泄漏)

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

**Turnstile 8s 截止**:
- tryClickTurnstile(line 1550-1580) ✓ —— 整体 8s deadline + 单 frame click
  Math.min(1500, remaining), 8 frame 最坏 8s 不超 challengeWaitMs 40s

### 2.3 cleaner.ts 第七轮(trafilatura + 三层降级链 + 60s 缓存)

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

**P1 bug ②**: callTrafilaturaExtract 不接受 bridgeUrl 参数(详见修复②)

### 2.4 types.ts 第七轮(concurrency 钳制 + trafilaturaBridgeUrl 配置)

- FetchConfig.concurrency?: number(line 308) ✓ —— 缺省 3, 钳 [1, 10]
- sanitizeFetchConfig(line 978-979) ✓ —— `safeNum(r.concurrency, 1, 10)`,
  字符串数字/"abc"/0/100 全钳制
- DEFAULT_FETCH_CONFIG 无 concurrency 字段 ✓ —— runner 用 `Number(undefined ??
  undefined) || 3` 兜底 3
- 与 hostGateLimit 正交 ✓ —— hostGateLimit=单 host 在飞上限(全局闸门),
  concurrency=单任务内并发作业数(任务级调度上限)
- trafilaturaBridgeUrl 配置 ✓ —— types.ts line 264, 文档注明
  "useTrafilatura=true 或 trafilaturaFallback=true 时生效"

### 2.5 sorter.ts 第七轮(reorderWithVolumes 分卷感知)

- reorderToc 三步: 去重 + 分卷上下文检测 + 重排 ✓
- reorderWithVolumes 分卷感知: 字段定卷 + 锚点开新卷 + 卷间排序(有号升序+
  无号归位) + 卷内 sortByChapterNo ✓
- extractChapterNo 多模式: 第X章/第X卷/Chapter X/罗马数字/中文数字 ✓
- extractVolumeAnchor 卷锚点识别: 第X卷/卷X/Volume X ✓
- **审查结论**: sorter 无 P0/P1 bug

### 2.6 storage.ts 第七轮(bookId 路径穿越 + 原子写入)

- saveChapterTxt bookId 清洗(R26-1A P1 已修) ✓ —— replace [\\/\x00\s.]+ → _
  + trim 首尾 _
- saveChapterTxt 原子写入(R26-1A P1 已修) ✓ —— .tmp + rename, PID+random 防
  并发同章节互踩
- downloadTxtTarget 清洗 ✓ —— 控制字符 + 截断 + 按码点 slice
- openDownloadTxtWriter 流式写入 ✓ —— gg-a 改造, 万章书不再内存拼接
- **P1 bug ④**: deleteBookTxt 未做 bookId 清洗(详见修复④)
- **P2 bug ⑤**: readCover startsWith 检查过弱(详见修复⑤)

### 2.7 hostgate.ts 第七轮(计账式闸门 + LRU 治理)

- 计账式闸门 ✓ —— release 只 inFlight-- + pump 复查, 不派发特定等待者
- FIFO 无 barge ✓ —— 新请求排在队尾, 不越过队头
- 降额/回升 ✓ —— 3 连败降一档(60s 冷却), 10 连胜回一档
- 速率节流(zz-b) ✓ —— minGapMs 跟随最近一次 acquire, gapTimer 唤醒
- 限流冷却(zz-b) ✓ —— rateLimitedUntil 推后, penaltyTimer 唤醒, R5-3 快照
  回滚 minGapMs
- LRU 治理 ✓ —— HOSTS_CAP=1000 + sweepIdleHosts 周期清理
- hostGateReset ✓ —— R4-15 清 waiter.timer + reject, 防 fire 后调到已结束 awaiter
- **审查结论**: hostgate 无 P0/P1 bug

### 2.8 downloader.ts 第七轮(流式写入 + 卫生语义)

- generateBookTxt 流式写入 ✓ —— openDownloadTxtWriter 逐段 append, 万章书不撑爆
- 中途失败 abort() ✓ —— 删除半成品, 与原"失败即无文件"语义一致
- finish() 失败也 abort() ✓ —— R26-1A P1 修复保留, 防 fs.stat 抛错后半成品留盘
- adInterval=0 显式关广告 ✓ —— Bug 20 修复保留, 不回退默认 10
- 卷头判重 lastEmittedVolume ✓ —— qq-e 修复, 空卷名不重置基准
- ZW_CHARS 含 U+2060 ✓ —— R26-1A 与 cleaner 同口径
- **审查结论**: downloader 无 P0/P1 bug

### 2.9 calibrate.ts 第七轮(三阶段探测 + 韧性重试)

- 三阶段探测 ✓ —— 并发梯(1→10) + 间隔梯(2000→150ms) + 验证档
- SSRF 守卫 ✓ —— R4-16 引擎侧也校验 siteBase, 拒绝云元数据 + 私网
- 韧性重试(zz-a2) ✓ —— 首档撞临时封禁期冷却后重探一次
- 死循环防护 ✓ —— R5-14 stageVerify 120s 截止 + chainUrls 取尽 break
- probeFetch 响应体 cancel() ✓ —— R26-1A P2 增强, 释放连接不占内存
- 3xx 视为失败 ✓ —— Bug 17 修复, probeFetch redirect:'manual', 3xx 必为源站
  主动跳转
- ab-c: 其他异常(网络错误/超时 status=0/5xx/路径 404)也计入失败判定 ✓
- **审查结论**: calibrate 无 P0/P1 bug

### 2.10 fetcher-curl-impersonate.ts 第七轮(桥客户端)

- checkCurlImpersonateBridge ✓ —— 60s 缓存 + 5min 永久失败窗口(curl_cffi 未装)
- 流式读 + 计数 ✓ —— 与 relayHop 同口径, 防 OOM
- 桥响应形态校验 ✓ —— ok:true/ok:false/非 200 三路径
- bodyB64 解码 ✓ —— Buffer.from base64, charset 由 curl_cffi 自动协商
- WAF 头透传 ✓ —— server/cf-ray/cf-mitigated/retry-after
- **P1 bug ①**: 4xx/5xx setCookies 丢弃(详见修复①)

## 3. 特别关注项验证

### 3.1 R31-1B 并发架构后的采集流程

- crawlBookMeta(阶段1): Promise.all 批次并发 + 单本失败隔离 ✓
- crawlChapterContent(阶段2): 全局 chapter queue + 跨书归属 + consecutiveErrs
  跨书累计 + tt-c 熔断 ✓
- finalizeBook(阶段3): 串行 + 单本失败隔离 + BudgetExceeded 上抛 ✓
- Semaphore acquire/release 配对 ✓ —— JS 单线程无竞态
- **审查结论**: 并发架构在 JS 单线程模型下无竞态/死锁/数据竞争

### 3.2 R32-1A failedBookUrls 修复后的边界

- add 路径(catch 块 line 1091/1099/1104): isFetchTimeout/HostGateTimeout/other
  三类瞬态错误调 addToResumeSet ✓
- delete 路径(line 1053/1843/1889/2383): skip-completed + crawlBookMeta
  incremental/cross-source 跳过 + finalizeBook ok-meta 完成 四路径全对称 ✓
- resume 路径(line 786-787): failedBookUrls 跨重启恢复 ✓
- AbortError 不 add ✓ —— 非瞬态错误, 重试无意义
- full 模式不重置 failedBookUrls ✓ —— 跨轮保留语义
- **审查结论**: failedBookUrls 三路径全对称, 无遗漏

### 3.3 R30 normalizeCategory 后的分类

- 精确别名命中(CATEGORY_ALIASES) ✓ —— 玄幻小说/都市娱乐/历史军事 等变体合并
- 标准 14 分类直接返回 ✓
- 模糊: 源站分类名包含标准分类名 → 合并 ✓ —— "玄幻魔法" includes "玄幻" → "玄幻"
- 无法合并 → 返回原名(让 LLM/关键词兜底) ✓
- LLM 返回也归一化 ✓ —— 避免返回"玄幻小说"创建重复
- matchCategoryByText 用归一化后分类 ✓ —— 避免"玄幻"+"玄幻小说"都命中
- **审查结论**: 分类归一化正确, 无 P0/P1 bug

## 4. 修复(P1×4 + P2×1, 共 ~+90 行)

### P1 修复① curl-impersonate 4xx/5xx Set-Cookie 透传

- 文件: src/lib/crawl/fetcher-curl-impersonate.ts(+18 行)
  + src/lib/crawl/fetcher.ts(+18 行)
- 修前: fetchViaCurlImpersonate 在 status>=400 时抛 CurlImpersonateError 但
  直接丢弃 setCookies(桥返回的 cf_clearance 等挑战凭证). 上层 Cookie 挑战
  重试链路拿到 403 但 cookieJar 没有挑战凭证 → 重试仍 403(curl-impersonate
  桥拿到的挑战信号等同虚设). 与 fetchViaCurl 在 rounds 循环中 per-round
  store 不一致(fetchViaCurl 在 status>=400 检查前已 store 所有 round 的
  setCookies).
- 修后:
  - CurlImpersonateError 新增 `setCookies?: string[]` 字段
  - fetchViaCurlImpersonate throw 前赋值 `err.setCookies = setCookies`
  - fetchViaCurlImpersonateFallback 用 try/catch 包裹 fetchViaCurlImpersonate
  - 若 `e instanceof CurlImpersonateError && e.setCookies?.length` 先
    `cookieJar.store(originHost(url), e.setCookies)` 再 rethrow
  - 桥不可达/桥内异常(status=0, 无 setCookies)无 cookie 可写, 直接 rethrow
    (零回归)

### P1 修复② cleanContentHtmlAsync 接受 bridgeUrl 参数

- 文件: src/lib/crawl/cleaner.ts(+40 行) + src/lib/crawl/runner.ts(+2 行)
- 修前: cleanContentHtmlAsync(useTrafilatura=true 路径)调 callTrafilaturaExtract
  不传 bridgeUrl, 只走模块级 TRAFILATURA_BRIDGE_URL(env / 默认 3019). 操作员
  配置的 rule.fetch.trafilaturaBridgeUrl 在 useTrafilatura=true 路径下被静默
  忽略. types.ts 文档注明该字段"useTrafilatura=true 或 trafilaturaFallback=true
  时生效", 但实际只在兜底路径(tryTrafilaturaExtract)生效. 两条路径行为不对齐.
- 修后:
  - callTrafilaturaExtract 新增 `bridgeUrl?: string` 参数
  - 自定义 URL(与默认 TRAFILATURA_BRIDGE_URL 不同)时跳过 60s 缓存直接尝试
    /extract(与 tryTrafilaturaExtract 同款逻辑, 防缓存键混淆)
  - 默认 URL 复用 60s 缓存(零回归)
  - cleanContentHtmlAsync 新增 `bridgeUrl?: string` 参数, 透传给
    callTrafilaturaExtract
  - runner.ts 在 useTrafilatura=true 路径传 `rule.fetch.trafilaturaBridgeUrl`,
    与兜底路径行为对齐

### P1 修复③ runner trafilatura 兜底 split /\n+/ 而非 /\n{2,}/

- 文件: src/lib/crawl/runner.ts(+5 行注释, 1 行 split 改)
- 修前: trafilatura 兜底路径(fallback=true)用 `.split(/\n{2,}/)` 分段. 但
  trafilatura v2 txt 输出用单 \n 分段(cleaner.ts cleanContentHtmlAsync
  line 999 注释明确: "trafilatura v2 txt 输出用单 \n 分段(不是 \n\n),
  故 split 用 \n+"). 修前 /\n{2,}/ 只在双换行处分段, trafilatura 单 \n
  段落被并成一段 → 整章内容被压缩成单个 `<p>` 标签, 段落结构完全丢失.
- 修后: `.split(/\n+/)`, 与 cleanContentHtmlAsync 同款逻辑, 单/双换行都视为
  段间分隔

### P1 修复④ deleteBookTxt bookId 路径穿越防御

- 文件: src/lib/crawl/storage.ts(+9 行)
- 修前: deleteBookTxt 直接 `fs.rm(path.join(NOVELS_DIR, bookId),
  {recursive:true, force:true})` 不做 bookId 清洗. 传入 '../../etc' 等恶意
  ID 会递归删除 NOVELS_DIR 外的目录. API 路由层有 db.book.findUnique 守卫
  只允许真实 cuid 通过, 但防御性 Coding 在源头: saveChapterTxt 已做同款
  清洗, deleteBookTxt 应同步.
- 修后: 与 saveChapterTxt 同款 `String(bookId||'').replace(/[\\/\x00\s.]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'unknown_book'`

### P2 修复⑤ readCover startsWith 检查加固

- 文件: src/lib/crawl/storage.ts(+5 行)
- 修前: readCover 用 `full.startsWith(COVERS_DIR)` 检查, 存在同级目录前缀
  绕过: 若 COVERS_DIR 是 `/data/covers`, 则 `/data/covers-backup/secret.webp`
  也会通过 startsWith 检查(字符串前缀匹配). path.basename 已剥目录组件,
  但防御性 Coding 要求 startsWith 必须以 path.sep 结尾才算真正落在目录内.
- 修后: `full !== COVERS_DIR && !full.startsWith(COVERS_DIR + path.sep)` return null
  与 readChapterTxt line 76 同口径

## 5. 验证

- `bun run lint` → 0 errors / 0 warnings exit 0 ✓
- `bunx tsc --noEmit` → 0 errors in src/ ✓ (排除 examples/skills 预存在:
  examples/websocket socket.io-client 缺失 + skills/image-edit 类型 +
  skills/stock-analysis 类型, 均与本轮无关)
- dev.log → Next.js 16.1.3 ready, GET / 200, 无报错 ✓

## 6. 修改文件清单

1. src/lib/crawl/fetcher-curl-impersonate.ts (+18 行):
   - line 176-180: CurlImpersonateError 新增 setCookies?: string[] 字段
   - line 362-367: fetchViaCurlImpersonate throw 前赋值 err.setCookies
2. src/lib/crawl/fetcher.ts (+18 行):
   - line 3687-3713: fetchViaCurlImpersonateFallback try/catch 包裹 + 错误
     cookie 写回 cookieJar
3. src/lib/crawl/cleaner.ts (+40 行):
   - line 88-97: callTrafilaturaExtract 注释 + 新增 bridgeUrl?: string 参数
   - line 103-133: 自定义 URL 分支(跳过 60s 缓存直接尝试 /extract)
   - line 975-1001: cleanContentHtmlAsync 注释 + 新增 bridgeUrl?: string 参数
     + 透传给 callTrafilaturaExtract
4. src/lib/crawl/runner.ts (+12 行):
   - line 2217-2220: 注释 R33-1B 两条路径均透传 bridgeUrl
   - line 2223: cleanContentHtmlAsync 传 rule.fetch.trafilaturaBridgeUrl
   - line 2243-2247: 注释 R33-1B split 用 /\n+/
   - line 2249: trafilatura 兜底 split /\n+/ (原 /\n{2,}/)
5. src/lib/crawl/storage.ts (+14 行):
   - line 85-93: deleteBookTxt bookId 路径穿越防御(与 saveChapterTxt 同款)
   - line 138-143: readCover startsWith 加固(与 readChapterTxt 同口径)

## 7. 历史保留 + 零回归

- 历史修复全部保留: R25-1A2/R25-1A3/R26-1A/R27-1A/R27-1B/R28-1A/R28-1B/
  R28-1C/R29-1D/R30-1A/R31-1B/R31-1D/R32-1A 全部不动
- R31-1B 并发架构核心不动: Semaphore 类 + crawlBookMeta/crawlChapterContent/
  finalizeBook 三方法 + executeTask 三阶段 + BookMetaResult/BookMetaContext/
  ChapterTask 类型 全保留
- R32-1A failedBookUrls 修复核心不动: add(catch 块)/delete(skip-completed +
  crawlBookMeta ok 跳过 + finalizeBook ok-meta 完成)/resume(跨重启恢复)三路径
  全对称保留
- 审查后零回归未改: Semaphore acquire/release 配对 ✓ + 阶段 1 Promise.all 批次
  隔离 ✓ + 阶段 2 全局并发跨书归属 ✓ + 阶段 3 串行 finalizeBook ✓ +
  BudgetExceeded/isCircuitBreak 上抛 ✓ + 在线调参 live DB 读 ✓ + progress
  全局对象原子性 ✓ + rt.ongoingBookUrls/completedBookUrls Set 线程安全 ✓ +
  fetcher 8 级降级链核心 ✓ + obscura 池管理/心跳回收 ✓ + cleaner trafilatura
  三层降级 + 60s 缓存 ✓ + types.ts concurrency 钳制 ✓ + sorter 分卷感知 ✓ +
  hostgate 计账式闸门 + LRU 治理 ✓ + downloader 流式写入 + abort 卫生 ✓ +
  calibrate 三阶段探测 + SSRF 守卫 ✓
- 未修改(尊重约束): runner.ts 并发架构(A agent 审查 add/delete/save/resume) +
  src/components/public/*(前端) + page.tsx/PublicSite.tsx(主控已改) +
  rule-templates/seed-rules(C agent 校准) + prisma/schema.prisma +
  package.json(0 新依赖)

## 8. 审查结论

**无 P0 bug**: 第七轮深度审查 8 模块(fetcher/obscura/cleaner/types/sorter/
storage/hostgate/downloader/calibrate + fetcher-curl-impersonate)在 R25-R32
六轮修复后无 P0 问题. R31-1B 并发架构稳定, R32-1A failedBookUrls 三路径
对称, R30 normalizeCategory 分类归一化正确.

**P1 bug ×4**(均为边缘 case + 接入后未对齐):
- ① curl-impersonate 4xx/5xx Set-Cookie 丢弃(挑战 cookie 重试链路断链, 与
  fetchViaCurl per-round store 不对齐)
- ② cleanContentHtmlAsync 不接受 bridgeUrl(useTrafilatura 路径操作员配置
  被静默忽略, 与文档注明"useTrafilatura=true 时生效"不符, 与兜底路径
  tryTrafilaturaExtract 行为不对齐)
- ③ runner trafilatura 兜底路径 split /\n{2,}/ 错误(trafilatura v2 单 \n
  分段, 整章被压缩成单个 <p>, 段落结构丢失, 与 cleanContentHtmlAsync
  split /\n+/ 不对齐)
- ④ deleteBookTxt bookId 路径穿越(与 saveChapterTxt 不对齐, 防御性 Coding
  在源头)

**P2 bug ×1**:
- ⑤ readCover startsWith 检查过弱(sibling-prefix 绕过, path.basename 已
  兜底但防御性加固, 与 readChapterTxt 同口径)
