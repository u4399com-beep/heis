---
Task ID: fix-r5
Agent: Fix 22 round-5 bugs (Critical 2 + High 8 + Medium 9 + Low 3)

# Work Record

## Scope
修复 deep audit round 5 (task audit-r5) 在 worklog.md 列出的 22 个新发现 bug。
- Critical (2): R5-1 runner.ts existChapters 10k cap 数据丢失; R5-2 sitemap cache 无界 OOM
- High (8): R5-3 hostgate minGapMs 不衰减; R5-4 feedback route 无 body 大小限制; R5-5 admin routes 无 body 大小限制; R5-6 obscura cookie 跨子域不回流; R5-7 control route DB 状态时序; R5-8 downloads inFlightGenerations HMR 泄漏; R5-9/R5-10 chapter reorder 阶段无 stop 检查
- Medium (9): R5-11 calibrate onProgress 泄漏; R5-12 proxy.ts bucket 驱逐 DoS 注释; R5-13 mirrorGroupFor SSRF allowLoopback; R5-14 stageVerify 死循环; R5-15 header denylist 不全; R5-16 cleaner 截断 script; R5-17 feedback adminNote XSS; R5-18 TDZ; R5-22 CSP unsafe-inline
- Low (3): R5-19 DNS rebinding 文档化为已知限制; R5-20 category P2002 retry 上限 3 次; R5-21 fsync 跳过(任务描述明示 Low + Node fs.sync 不便)

## Constraint Compliance
- 可改文件白名单内: src/lib/crawl/*, src/app/api/**, src/lib/{auth,api,links,logger}.ts, src/proxy.ts, src/components/**, Caddyfile
- 未触碰: prisma/*, mini-services/*, Docker, next.config.ts, eslint.config.mjs, tsconfig.json

## Fixes Detail

### R5-1 (Critical) — src/lib/crawl/runner.ts
existChapters.take:10000 让 >10000 章书的尾部章在 incremental 模式被判为新章 → @@unique([bookId,idx]) P2002 → catch 吞 → chId 缺失 → 阶段D 回填连锁失败 → 熔断任务卡 error。
修法: 命中 10000 上限时查 db.chapter.count({where:{bookId}}); ≤50000 全量加载(内存可控 10MB); >50000 维持 10k 采样并 log warn。

### R5-2 (Critical) — src/app/api/public/sitemap/route.ts
sitemapCache Map 无界, 攻击者轮换 ?site=<random> × ?page=N × ?index=Y → 无限 key × 750KB/entry → OOM。
修法: 添加 MAX_SITEMAP_CACHE_ENTRIES=50 + setSitemapCache() 包装函数(已存在 key 先 delete 再 set, 满载时 FIFO 淘汰最早条目); 50 × 750KB ≈ 37MB 内存上限。

### R5-3 (High) — src/lib/crawl/hostgate.ts
reportHostRateLimited 推后 rateLimitedUntil 后, acquire 路径会把 minGapMs 抬到 cooldownImpliedGap(如 30s); 冷却到期 settleRateLimitExpiry 清零 rateLimitedUntil + failStreak 但不回滚 minGapMs, 同 caller(同 minGapMs 值)走 else 分支 max(30000, 500)=30000 → 一次 429 永久毒杀节奏。
修法: HostState 增 minGapMsBeforeCooldown 字段; reportHostRateLimited 首次进入冷却时(此前未在冷却)快照 minGapMs; settleRateLimitExpiry 冷却到期时回滚 minGapMs = minGapMsBeforeCooldown。

### R5-4 (High) — src/app/api/public/feedback/route.ts
readBody 无 body 大小限制, 500MB body 单请求即可 OOM(公共路由 120 req/min × 500MB = 60GB/min)。
修法: FEEDBACK_MAX_BODY_BYTES=100*1024(100KB), 调用 readBody(req, FEEDBACK_MAX_BODY_BYTES); 反馈字段已知上限合计 ≈ 4KB, 100KB 富余。

### R5-5 (High) — src/lib/api.ts + src/app/api/_lib/http.ts
原 readBody 无 Content-Length 检查, 所有 admin 路由(chapters PUT / rules PUT / sites POST 等)先 await req.json() 全量入内存才查 body.content.length 上限。
修法: readBody 增 maxBytes=5_000_000 默认参数; Content-Length 超限抛 BodyTooLargeError; withGuard catch 后返回 413(友好友好信封)。restore 路由单独传 RESTORE_MAX_BODY_BYTES=200MB。

### R5-6 (High) — src/lib/crawl/fetcher.ts (CookieJar.store)
原 store() 仅按调用方传入的 request host(originHost(url))存罐; CF clearance 带 `domain=.example.com` 时, fetcher 直连 api.example.com → cookieJar.get('api.example.com') 返回空 → cf_clearance 不发 → 过盾失败 → 重新渲染(慢 10-100x)。
修法: store() 解析每条 Set-Cookie 的 domain 属性; 若存在则把该 cookie 也存到 cookie 自身 domain(去前导点 .example.com → example.com)对应的副罐; 无 domain= 的(host-only)仅存 request host 罐。

### R5-7 (High) — src/app/api/admin/tasks/[id]/control/route.ts
原顺序: updateMany → TaskRunner.control(); 若 control 因熔断冷却返回 {ok:false}, DB 已置 pending 但 runtime 没启动 → 任务永久卡 pending。
修法: 调换顺序 — 先 TaskRunner.control(); 失败直接 return fail(DB 不变); 成功后再 updateMany 置 pending。

### R5-8 (High) — src/app/api/admin/downloads/route.ts
原 `let inFlightGenerations = 0` 是模块级变量, dev HMR 每轮模块重求值重置为 0; 进行中下载作业占位 ++ 未释放时, 新模块版本读到 0 → 新请求占位 1 → 与旧占位叠加突破 MAX_CONCURRENT_DOWNLOAD_JOBS=3 上限。
修法: 挂 globalThis.__heisDownloadInFlight 单例; inFlightGenerations 改为 {get/incr/decr/setMax} 对象包装(HMR 复用同一引用, 计数跨模块版本持久化)。

### R5-9/R5-10 (High) — src/lib/crawl/runner.ts
万章+大部头书的阶段A/B/C/D/E 是顺序 db.chapter.update/create 循环, 每条 5-10ms, 全程可达分钟级; 用户点"停止"信号需在每个阶段入口尽快生效, 避免无响应窗口。
修法: 在阶段A/B/C/D/E 入口各加 `if (rt.stopped || rt.epoch !== myEpoch) { log + return 'stopped' }` 检查。

### R5-11 (Medium) — src/lib/crawl/calibrate.ts
onProgress 回调可在 job aborted/timeout 后仍触发(sleepAbortable 抛 CalibrateAbort 前本档已探完)。
修法: probeLevel + stageVerify 在调用 onProgress 前再查 shouldAbort, aborted 后不再回调。

### R5-12 (Medium) — src/proxy.ts
bucket 驱逐 DoS 已由 R3-30 clientIp 优先 req.ip 实质性消除(攻击者无法伪造 TCP 套接字 IP)。仅添加注释记录残留风险 + FIFO 淘汰保留作防御纵深。

### R5-13 (Medium) — src/lib/crawl/fetcher.ts (fetchPage 镜像循环)
原硬编码 `assertSafeTarget(hostUrl, { allowLoopback: false })` 把 URL 自身的 loopback token 代理(如 127.0.0.1:3010)在 i=0 首次迭代(=URL 自身 host)时拒掉 → 该镜像被跳过 → 章节抓取静默失败。
修法: 改用 `loopbackBypassAllowed(hostUrl, cfg)` 与外层 SSRF 守卫同口径(配置豁免则放行)。

### R5-14 (Medium) — src/lib/crawl/calibrate.ts (stageVerify)
原 `while (done < VERIFY_REQUESTS)` 在 chainUrls.length < VERIFY_REQUESTS 时(done+=0 永不前进)会死循环; 当前 chainUrls.length=20 === VERIFY_REQUESTS=20 安全, 但未来调整会立刻爆。
修法: 入循环前加 `if (done >= chainUrls.length) break`; 加 stageStart + STAGE_VERIFY_DEADLINE_MS=120_000 总体截止时间。

### R5-15 (Medium) — src/lib/crawl/types.ts (HEADER_KEY_DENYLIST)
R4-22 denylist 缺 via / x-forwarded-* / x-real-ip / forwarded / x-original-url / x-rewrite-url / x-cluster-client-ip; Caddyfile 已写这些头, 引擎再发同名头会与代理头冲突或绕过上游 IP 鉴权。
修法: HEADER_KEY_DENYLIST 追加 9 个代理识别头。

### R5-16 (Medium) — src/lib/crawl/cleaner.ts (plainText)
R4-20 正则 `<(script|style|...)\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>` 要求闭标签; 截断 HTML(malformed/响应被中途切断)无闭标签的 `<script>alert(1)` 内容会漏进纯文本。
修法: 第三正则 `<(script|style|noscript|iframe|object|embed)\\b[^>]*>[\\s\\S]*$`(贪婪到串尾)兜底截断未闭合段。

### R5-17 (Medium) — src/app/api/admin/feedback/[id]/route.ts + FeedbackSection.tsx
adminNote 字段经 str() 仅截断长度, 不剥 HTML; 若被备份导出/邮件回执等下游 HTML 出口渲染会触发存储型 XSS。
修法: PATCH 路由 adminNote 先 str() 再 replace(/<[^>]+>/g, '') 再 slice。FeedbackSection.tsx 已核实为 React 默认纯文本渲染({detail.content} / Textarea value), 无 dangerouslySetInnerHTML。

### R5-18 (Medium) — src/lib/crawl/obscura.ts (withObscuraPage waiter)
原 `new Promise((resolve, reject) => { const t = setTimeout(() => { S.waiters.indexOf(resolver)... }, 30_000); const resolver = () => {...}; S.waiters.push(resolver) })`; setTimeout 回调引用 resolver, 而 const resolver 在 setTimeout 之后声明; TDZ 风险(30s 延时下安全, 但若未来改 0ms 或同步 fire 会抛 ReferenceError)。
修法: 先 `let resolver: (() => void) | null = null`, Promise 内 `const r: () => void = () => {...}; resolver = r; S.waiters.push(r)`; setTimeout 回调用 if(resolver) 守护 indexOf 调用。

### R5-19 (Low) — src/lib/crawl/fetcher.ts (assertSafeTarget 注释)
DNS rebinding TOCTOU: SSRF 守卫 DNS 解析校验 IP, 但 fetch(url) 仍以 hostname 发起连接, 攻击者控制 DNS 即可在守卫通过后重绑到内网 IP。彻底修复需 fetch 自定义 lookup 注入(当前不支持), 文档化为已知限制。

### R5-20 (Low) — src/lib/crawl/runner.ts (category.upsert)
R4-9 单次 50ms 重试在另一任务事务 >50ms commit 时仍读 null, categoryId=null 导致书丢失分类关联。
修法: 改为 3 次指数退避循环(50/100/200ms 累计 350ms 覆盖典型 SQLite busy 锁); 3 次仍失败记 warn 但不抛错(categoryId=null 仍可继续)。

### R5-21 (Low) — 跳过
任务描述明示 "Node fs doesn't have sync on FileHandle easily — skip this as Low priority"。无代码变更。

### R5-22 (Medium) — src/proxy.ts (CSP)
原 CSP 硬编码 `script-src 'self' 'unsafe-inline' 'unsafe-eval'`; 生产环境无需 'unsafe-eval'(Next dev 用于 HMR)。
修法: 检测 `process.env.NODE_ENV === 'production'`; 生产 CSP 去掉 'unsafe-eval', dev 保留两个 unsafe 让 HMR 正常工作。

## Verification
- `bun run lint` → 0 errors / 0 warnings (exit 0)
- `bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | wc -l` → 0
- dev server `/` → 200
- /api/public/feedback POST 正常体 → 200 + 入库 ID
- /api/public/feedback POST 200KB 体 → 413 "请求体过大(超过 0.1MB 上限)"
- /api/admin/stats 未鉴权 → 401

## Files Modified
- src/lib/api.ts (readBody + maxBytes + BodyTooLargeError)
- src/app/api/_lib/http.ts (withGuard catch BodyTooLargeError → 413)
- src/app/api/public/feedback/route.ts (FEEDBACK_MAX_BODY_BYTES=100KB)
- src/app/api/admin/backup/restore/route.ts (传 RESTORE_MAX_BODY_BYTES=200MB)
- src/app/api/admin/feedback/[id]/route.ts (adminNote 剥 HTML)
- src/app/api/admin/tasks/[id]/control/route.ts (control 顺序调换)
- src/app/api/admin/downloads/route.ts (inFlightGenerations → globalThis 单例)
- src/app/api/public/sitemap/route.ts (setSitemapCache FIFO + cap 50)
- src/lib/crawl/runner.ts (R5-1 existChapters + R5-9/R5-10 阶段 stop 检查 + R5-20 category 重试 3 次)
- src/lib/crawl/hostgate.ts (R5-3 minGapMsBeforeCooldown 快照 + 回滚)
- src/lib/crawl/calibrate.ts (R5-11 onProgress aborted 检查 + R5-14 stageVerify 120s 截止 + done>=length break)
- src/lib/crawl/fetcher.ts (R5-6 CookieJar.store 解析 domain 属性 + R5-13 mirrorSsrf allowLoopback + R5-19 DNS rebinding 注释)
- src/lib/crawl/cleaner.ts (R5-16 截断 script 正则)
- src/lib/crawl/types.ts (R5-15 HEADER_KEY_DENYLIST 追加 9 头)
- src/lib/crawl/obscura.ts (R5-18 TDZ resolver 先 let 再赋值)
- src/proxy.ts (R5-12 bucket 驱逐注释 + R5-22 CSP 按 NODE_ENV 分级)

## No Dead Code / Imports Left
- 所有新增 const/function 均有引用
- 未引入新依赖
- 中文注释解释每个 R5-x bug 来源 + 修法, 与既有 worklog 风格一致
