# R33-1A add/delete/save/resume 全链路系统审查

**Agent**: full-stack-developer (add/delete/save/resume 全链路审查)
**Task ID**: R33-1A
**完成时间**: 2026-09-19

## 任务概述

R32-1A 发现 R31-1B 并发重构遗漏了 failedBookUrls 的 add/delete/resume(4 个 P1)。
用户要求做系统审查(不只 failedBookUrls), 范围覆盖 runner.ts 5 个 resume Set +
globalQueue + saveProgress + resume 所有分支的 add/delete 配对 + save/resume
链路完整性.

## 1. 读交接

- worklog.md 末 200 行:
  - R31-1B 并发架构: Semaphore 类 + crawlBookMeta(阶段1) + crawlChapterContent
    (阶段2 单章) + finalizeBook(阶段3 收尾), executeTask 串行 for 循环 →
    三阶段并发架构
  - R32-1A 第六轮深度审查: 无 P0 bug; 4 P1 修复(① urls 模式 bookQueue
    去重 / ② failedBookUrls 瞬态错误 add / ③ skip-completed 路径 failedBookUrls
    .delete / ④ failedBookUrls 跨重启恢复); P2 已知不修(saveProgress 并发调用
    lost-update / trafilatura 60s 缓存首次失败 20s 超时 / obscura cookieProvider
    domain 收窄)
- agent-ctx/R32-1A-full-stack-developer.md: 详细工作记录(7 章节)

## 2. 审查范围(runner.ts 5 Set + globalQueue + saveProgress + resume)

依据 task spec 第三步, 对以下 8 类对象的 add/delete/save/resume 链路逐一
审查:

| # | 对象 | 类型 | 用途 |
|---|------|------|------|
| 1 | rt.discoveredBookUrls | Set<string> | 跳过列表页重复发现 |
| 2 | rt.completedBookUrls | Set<string> | 整体跳过完结书 |
| 3 | rt.ongoingBookUrls | Set<string> | 增量检查连载书 |
| 4 | rt.failedBookUrls | Set<string> | 瞬态失败重试列表 |
| 5 | rt.bookLastChapters | Map<string,string> | 末章 URL 增量检测 |
| 6 | globalQueue (局部) | ChapterTask[] | 阶段 2 全局章节队列 |
| 7 | saveProgress (方法) | - | 5 Set 落库到 task.progress |
| 8 | resume (executeTask 内) | - | 从 progress 重建 5 Set |

## 3. 逐分支审查

### 3.1 discoveredBookUrls(已发现书籍 URL 集合)

**add 调用点**: 1 处
- line 902 `addToResumeSet(rt.discoveredBookUrls, u)` —— 列表页发现新书时
  add(在 `for (const u of pageUrls)` 循环内, 满足"未发现过 OR DB无完整数据"
  条件时 add + push 进 bookQueue)

**delete 调用点**: 0 处
- grep `discoveredBookUrls.delete` → 0 命中

**has 调用点**: 2 处
- line 877 `rt.discoveredBookUrls.has(u)` —— filter 出 prevDiscovered(批量
  查 DB 前先看 Set 命中)
- line 892 `rt.discoveredBookUrls.has(u)` —— 循环内分支判断(已发现 → 查 DB
  有无章节; 未发现 → 走 add + push)

**save**: line 2446 `Array.from(rt.discoveredBookUrls).slice(0, MAX_RESUME_SET_SIZE)`
**resume**: line 766 `new Set(disc.filter((u) => typeof u === 'string' && u))`
**full 模式**: line 754 `new Set<string>()` + line 758 `progress.discoveredBookUrls = []`

**审查结论**: append-only 设计**INTENTIONAL**, 非 bug:
- TaskRuntime.discoveredBookUrls 注释(line 36-39)明确: "已在列表页发现过
  的书籍 URL 集合. 范围任务重启时, 已发现过的书籍不再加入 bookQueue(节省
  书籍页抓取/解析/数据库写入), 仅 list 页上新出现的书籍才进入采集队列"
- 已发现的 URL 永远"已知", 重复发现只浪费请求 → 增量模式保留 Set 让续采
  只处理新增/未采完的书籍
- full 模式启动时清空(line 754)实现重采语义; 非 full 模式从 progress 恢复
- addToResumeSet(line 2638-2649) FIFO 淘汰最旧 10% 防 OOM(Set.size > 50000
  时淘汰 5000), 内存上限与持久化上限对齐
- line 892-905 二级跳过逻辑: 已发现 → 查 DB → DB有书+章节=真跳过, DB无书=
  重新加入队列(书被删/采集中断), Set 条目保留(add 幂等, 重复 add 不重复入)

### 3.2 completedBookUrls(已完结书籍 URL 集合)

**add 调用点**: 3 处
- line 1876 `addToResumeSet(rt.completedBookUrls, bookUrl)` —— 增量跳过路径
  (末章未变) 且 detectedStatus==='completed'
- line 1921 `addToResumeSet(rt.completedBookUrls, bookUrl)` —— 跨源跳过路径
  且 detectedStatus==='completed'
- line 2414 `addToResumeSet(rt.completedBookUrls, bookUrl)` —— finalizeBook
  完成 且 detectedStatus==='completed'

**delete 调用点**: 0 处
- grep `completedBookUrls.delete` → 0 命中

**has 调用点**: 1 处
- line 1028 `rt.completedBookUrls.has(bookUrl)` —— skip-completed 整体跳过
  (配 DB 二级验证: existing && existing._count.chapters > 0 才真跳过)

**save**: line 2447 `Array.from(rt.completedBookUrls).slice(0, MAX_RESUME_SET_SIZE)`
**resume**: line 767 `new Set(comp.filter((u) => typeof u === 'string' && u))`
**full 模式**: line 755 `new Set<string>()` + line 759 `progress.completedBookUrls = []`

**审查结论**: append-only 设计**INTENTIONAL**, 非 bug:
- TaskRuntime.completedBookUrls 注释(line 41-47)明确: "已完整采集(章节全采完)
  的【已完结】书籍 URL 集合. 仅 status==='completed' 的书才会加入本集合 ——
  完结书不会再有新章节, 重启时整体跳过(不重抓书籍页/目录/正文)"
- 完结书的语义是"不会再有新章节", 一旦加入 completedBookUrls 即永远跳过
  (除非 DB 章节被删, 走 line 1037-1039 的二级验证 fall-through 重新采集)
- ongoing→completed 状态跃迁由 ongoingBookUrls.delete(line 1877/1922/2415)
  + bookLastChapters.delete(line 1878/1923/2416) 处理, completedBookUrls 自身
  只增不删; 反向跃迁(completed→ongoing, 作者写续章)极少见, 即使发生也只
  会导致该本书被"误跳过"(P2 边缘 case, 非 P1 阻塞性 bug)
- full 模式启动时清空(line 755)实现重采语义

### 3.3 ongoingBookUrls(连载中书籍 URL 集合)

**add 调用点**: 3 处
- line 1880 `addToResumeSet(rt.ongoingBookUrls, bookUrl)` —— 增量跳过路径
  且 detectedStatus!=='completed'(ongoing 或 unknown)
- line 1925 `addToResumeSet(rt.ongoingBookUrls, bookUrl)` —— 跨源跳过路径
  且 detectedStatus!=='completed'
- line 2419 `addToResumeSet(rt.ongoingBookUrls, bookUrl)` —— finalizeBook
  完成 且 detectedStatus!=='completed'

**delete 调用点**: 3 处(均与 add 同分支, 状态跃迁时调用)
- line 1877 `rt.ongoingBookUrls.delete(bookUrl)` —— 增量跳过路径 且
  detectedStatus==='completed'(从 ongoing 移到 completed)
- line 1922 `rt.ongoingBookUrls.delete(bookUrl)` —— 跨源跳过路径 且
  detectedStatus==='completed'
- line 2415 `rt.ongoingBookUrls.delete(bookUrl)` —— finalizeBook 且
  detectedStatus==='completed'

**has 调用点**: 1 处
- line 1578 `rt.ongoingBookUrls.has(bookUrl)` —— isOngoingRecheck 标记(配
  bookLastChapters.get 实现增量检查)

**save**: line 2449 `Array.from(rt.ongoingBookUrls).slice(0, MAX_RESUME_SET_SIZE)`
**resume**: line 770 `new Set(ongoing.filter((u) => typeof u === 'string' && u))`
**full 模式**: line 756 `new Set<string>()` + line 760 `progress.ongoingBookUrls = []`

**审查结论**: add/delete/save/resume 完全配对, **零回归**:
- 状态分流对称: detectedStatus==='completed' → add completed + delete ongoing
  + delete bookLastChapters; 否则 → add ongoing + set bookLastChapters
- 3 处 add 配 3 处 delete(均在同分支, 状态跃迁时调用), 无 add-without-delete
  (内存泄漏) 也无 delete-without-add (重试失效)
- 配 bookLastChapters.set/delete 同步更新(line 1881/1927/2421 set,
  line 1878/1923/2416 delete), 无悬挂条目

### 3.4 failedBookUrls(瞬态失败书籍 URL 集合, R32-1A 已修, 复核)

**add 调用点**: 3 处(R32-1A 修复②)
- line 1091 `addToResumeSet(rt.failedBookUrls, bookUrl)` —— phase 1 catch 块
  isFetchTimeout 分支
- line 1099 `addToResumeSet(rt.failedBookUrls, bookUrl)` —— phase 1 catch 块
  HostGateTimeout 分支
- line 1104 `addToResumeSet(rt.failedBookUrls, bookUrl)` —— phase 1 catch 块
  other(普通抓取异常)分支
- AbortError 分支(line 1093)不 add(非瞬态, 停止/换代无重试意义)✓

**delete 调用点**: 4 处
- line 1053 `rt.failedBookUrls.delete(bookUrl)` —— skip-completed 路径
  (R32-1A 修复③, 原设计遗漏)
- line 1883 `rt.failedBookUrls.delete(bookUrl)` —— 增量跳过路径 ok 返回前
- line 1929 `rt.failedBookUrls.delete(bookUrl)` —— 跨源跳过路径 ok 返回前
- line 2423 `rt.failedBookUrls.delete(bookUrl)` —— finalizeBook 完成前

**save**: line 2451 `Array.from(rt.failedBookUrls).slice(0, MAX_RESUME_SET_SIZE)`
**resume**: line 787 `new Set(failed.filter((u) => typeof u === 'string' && u))`
  (R32-1A 修复④, 原设计遗漏)
**full 模式**: 不重置(line 753-761 注释 "failedBookUrls 跨轮保留", 与本轮
  恢复逻辑正交)—— INTENTIONAL: failedBookUrls 是诊断可见性 + retry-failed
  模式的数据源, full 模式应保留历史失败列表

**审查结论**: R32-1A 修复完整, 复核确认 add/delete/save/resume 链路零
回归:
- 3 处 add 配 4 处 delete(skip-completed 多一处 delete 是因为 R32-1A 把
  skip-completed 从 crawlOneBook 拆出到 batch callback 时遗漏的 delete)
- 所有 'ok' 返回路径(skip-completed / incremental / cross-source /
  finalizeBook) 都调 delete, 保持 failedBookUrls 干净
- AbortError 不 add(停止/换代非瞬态)✓
- 'blocked'(书籍页被验证码/JS 挑战拦截, line 1538-1541)与 'empty-toc'
  (目录为空 line 1844-1846) 早期返回路径**不调 delete**:
  - blocked: 拦截可能持续, 不应释放 failedBookUrls 让 retry-failed 立即重试
    浪费请求; INTENTIONAL 不删除
  - empty-toc: 书页抓到但 TOC 为空, 既非成功也非瞬态网络错误, 留在
    failedBookUrls 待 parser 修复后重试; INTENTIONAL 不删除
  - 这两个路径不影响 R32-1A 的修复完整性, 是设计取舍(P2 边缘 case)

### 3.5 bookLastChapters(书籍末章 URL 映射)

**set(add)调用点**: 3 处(均配 ongoingBookUrls.add 在同分支)
- line 1881 `addToBookLastChapters(rt.bookLastChapters, bookUrl, currentLastChapterUrl)`
  —— 增量跳过路径, ongoing/unknown 状态, currentLastChapterUrl 非空时
- line 1927 `addToBookLastChapters(rt.bookLastChapters, bookUrl, lastUrl)`
  —— 跨源跳过路径, ongoing/unknown 状态
- line 2421 `addToBookLastChapters(rt.bookLastChapters, bookUrl, lastChapUrl)`
  —— finalizeBook, ongoing/unknown 状态

**delete 调用点**: 3 处(均配 ongoingBookUrls.delete 在同分支, completed
状态跃迁时)
- line 1878 `rt.bookLastChapters.delete(bookUrl)` —— 增量跳过路径,
  detectedStatus==='completed'
- line 1923 `rt.bookLastChapters.delete(bookUrl)` —— 跨源跳过路径
- line 2416 `rt.bookLastChapters.delete(bookUrl)` —— finalizeBook

**get 调用点**: 1 处
- line 1579 `rt.bookLastChapters.get(bookUrl)` —— 读 storedLastChapterUrl
  (仅 isOngoingRecheck=true 时读, 配 has 检查避免孤儿)

**save**: line 2454-2461 Map → Object(JSON 序列化友好); 即时淘汰最旧 10%
  (addToBookLastChapters line 2655-2666)防 OOM, 迭代取全部 ≤50000 条即最新
  添加的连载书末章 URL
**resume**: line 774-777 Object → Map
**full 模式**: line 757 `new Map<string, string>()` + line 761
  `progress.bookLastChapters = {}`

**审查结论**: set/delete/save/resume 完全配对, **零回归**:
- 3 处 set 配 3 处 delete(均在同分支, 状态跃迁时调用), 与 ongoingBookUrls
  完全对称
- addToBookLastChapters FIFO 淘汰最旧 10% 防 OOM, 保留最新添加的(最新连载
  书的末章 URL)
- isOngoingRecheck 防孤儿: `storedLastChapterUrl = isOngoingRecheck ?
  rt.bookLastChapters.get(bookUrl) : undefined` —— bookLastChapters 有条目
  但 ongoingBookUrls 没有时(独立淘汰导致的暂时不一致), get 返回 undefined
  → 不触发增量检查, 走全量重采 + existUrlMap 去重既有章

### 3.6 globalQueue(阶段 2 全局章节队列, 局部变量)

**push 调用点**: 1 处
- line 1152 `globalQueue.push(...r.queue)` —— 阶段 1 末, 收集所有
  status='ok-meta' 且 queue.length > 0 的书的 ChapterTask 数组

**shift(splice)调用点**: 1 处
- line 1230 `const batch = globalQueue.splice(0, batchSize)` —— 阶段 2
  每批次切出 batchSize 条 ChapterTask 处理

**filter**: 0 处

**length 检查**: 4 处(line 1151, 1160, 1186, 1229, 1234)

**save/resume**: 不持久化(INTENTIONAL):
- globalQueue 是 executeTask 局部变量, 跨任务重启不恢复
- 设计如此: 重启时从 bookQueue(由 list 页或 fetchOverride.urls 重建)重新
  触发 crawlBookMeta → 重新构建 globalQueue; resume Sets(completed/ongoing/
  discovered/failed/bookLastChapters)负责"已处理"标记, globalQueue 负责
  "本运行期待处理"
- 中断后未采完的章节: chapter.fetched=false 留在 DB, 下次增量时
  existUrlMap 跳过已采章 + 把未采章重新入 queue(line 2083-2092 unfetched
  既有项填充)

**审查结论**: 局部变量生命周期与 executeTask 函数同步, 无需持久化, **零
回归**:
- push 单点 + splice 单点配对, while (globalQueue.length > 0) 循环消费完
  全
- batchSize = min(threads, chapterConcurrency, globalQueue.length)
  (line 1229)钳制批次大小, 防 OOM
- 跨书归属正确(R32-1A 审查结论): ChapterTask.bookCtx 共享引用,
  bookDoneMap 按 bookId 累加, JS 单线程 get+set 间无 await 原子
- consecutiveErrs 跨书累计正确(同上)

### 3.7 saveProgress(5 Set 落库)

**调用点**: 16 处(详见审查报告)
- line 830, 835: urls 模式/discovery 阶段初始化
- line 914: 列表页解析后(同步 discoveredBookUrls)
- line 941: book 阶段开始前
- line 959: phase 1 开始
- line 1010: phase 1 每批次
- line 1134: phase 1 每批次末
- line 1173: phase 2 开始
- line 1279: phase 2 每 10 章或末章
- line 1296: 熔断
- line 1306: phase 2 末
- line 1344: stopped 路径
- line 1372: done 路径
- line 1885, 1931: 增量/跨源跳过(配 Set 更新)
- line 2134: crawlBookMeta 末
- line 2424: finalizeBook 末

**落库内容**(line 2446-2472): 5 Set 全部 + 任务快照字段
- progress.discoveredBookUrls = Array.from(rt.discoveredBookUrls).slice(0, 50000)
- progress.completedBookUrls = Array.from(rt.completedBookUrls).slice(0, 50000)
- progress.ongoingBookUrls = Array.from(rt.ongoingBookUrls).slice(0, 50000)
- progress.failedBookUrls = Array.from(rt.failedBookUrls).slice(0, 50000)
- progress.bookLastChapters = Map → Object(迭代 ≤50000 条, 即最新添加的)
- progress.requestCount / bytesFetched / runStartedAt / currentUrl /
  recentLogs / memBooksInQueue / memChaptersInQueue / memResumeSetsSize
  (任务快照字段, 供 API 端点读取)

**审查结论**: 5 Set 全部落库, **零回归**:
- 每次 Set 修改后立刻 saveProgress(详 line 914/1885/1931/2424), 防内存与
  DB 状态分裂
- slice(0, MAX_RESUME_SET_SIZE) 是冗余兜底(Set 已由 addToResumeSet 即时
  淘汰, size ≤ 50001 短暂窗口)
- 任务快照字段(requestCount 等)是可见性字段, 不参与 resume(在 control
  ('start') 重置 line 653-656); INTENTIONAL 不恢复
- P2 已知不修(R32-1A 已记): saveProgress 并发调用 lost-update(影响
  resume Sets 少量条目, 非正确性 bug, 修需 per-task mutex 串行化减慢
  phase 1, 不值得)

### 3.8 resume(executeTask 内, 从 progress 重建 5 Set)

**resume 调用点**: line 746-796
- line 753-761: full 模式 → 清空 4 Set(discovered/completed/ongoing/
  bookLastChapters) + progress 同步空数组(完整重采语义)
- line 762-787: 非 full 模式 → 从 progress 重建 5 Set:
  - line 766: rt.discoveredBookUrls = new Set(disc.filter(string&非空))
  - line 767: rt.completedBookUrls = new Set(comp.filter(string&非空))
  - line 770: rt.ongoingBookUrls = new Set(ongoing.filter(string&非空))
  - line 774-777: rt.bookLastChapters = new Map + for-loop set(k,v)
  - line 787: rt.failedBookUrls = new Set(failed.filter(string&非空))
    (R32-1A 修复④)

**full 模式不重置 failedBookUrls**(line 753-761 注释 "failedBookUrls 跨轮
保留"): INTENTIONAL
- failedBookUrls 是诊断可见性 + retry-failed 模式(mode='urls' 从
  fetchOverride.urls 取, 但用户可参考 rt.failedBookUrls 列表手动构造
  urls)的数据源
- full 模式应保留历史失败列表(用户可能想看 full 重采后哪些书仍失败)

**审查结论**: 5 Set 全部恢复, R32-1A 修复完整, **零回归**:
- 类型校验: `Array.isArray(progress.X) ? progress.X : []` + filter
  `typeof u === 'string' && u` 防脏 JSON(line 766-770, 786-787)
- bookLastChapters 类型校验: `progress.bookLastChapters && typeof
  progress.bookLastChapters === 'object'` + for-loop set 时校验 typeof
  k==='string' && k && typeof v==='string' && v(line 771-777)
- resume 后日志 line 789-794: "范围续采恢复: 已发现 N 本 / 已完结 N 本 /
  连载中 N 本"—— failedBookUrls 不计入(诊断字段, 不在 UI 提示)

## 4. 边缘 case 审查(无 P1 bug 但记录决策)

### 4.1 'blocked' 路径(line 1538-1541)不调 failedBookUrls.delete

书籍页被验证码/JS 挑战拦截, stats.errors++ + log + return { status:
'blocked' }. 不调 failedBookUrls.delete.
- 决策理由: 拦截可能持续(验证码 cookie 未刷新), 释放 failedBookUrls 让
  retry-failed 立即重试会浪费请求; 留在 failedBookUrls 待用户解决反爬
  后重试更合适
- 风险评估: P2(边缘 case: 书曾在上一轮瞬态失败进 failedBookUrls, 本轮
  blocked 后 failedBookUrls 残留条目); 非 P1 阻塞性

### 4.2 'empty-toc' 路径(line 1844-1846)不调 failedBookUrls.delete

目录为空, log + return { status: 'empty-toc' }. 不调 failedBookUrls.delete.
- 决策理由: 既非成功也非瞬态网络错误, 留在 failedBookUrls 待 parser 修复
  或源站更新后重试更合适
- 风险评估: P2(同上边缘 case); 非 P1

### 4.3 completed→ongoing 反向跃迁

源站可能从 completed 改标 ongoing(作者写续章), 但代码不主动 delete
completedBookUrls. 后果: 该书被 skip-completed 误跳过(line 1028-1056),
但配 DB 二级验证(existing._count.chapters > 0)→ 用户若删 DB 章节,
fall-through 重新采集. 实际场景罕见, P2 不修.

### 4.4 saveProgress 并发 lost-update

R32-1A 已记录为 P2 不修(影响 resume Sets 少量条目, 非正确性 bug). 本轮
审查确认无新增风险.

### 4.5 addToResumeSet / addToBookLastChapters FIFO 淘汰边界

- addToResumeSet(line 2638-2649): size > cap 时淘汰最旧 10%(Set 保留插入
  序, FIFO); 内存上限与持久化上限对齐
- addToBookLastChapters(line 2655-2666): size > cap 时淘汰最旧 10%(Map
  保留插入序, FIFO); 保留最新添加的连载书末章 URL
- saveProgress slice(0, MAX_RESUME_SET_SIZE) 冗余兜底(Set.size 已 ≤ 50001
  短暂窗口)
- 独立淘汰可能导致 ongoingBookUrls 与 bookLastChapters 暂时不一致
  (一个淘汰了一个没); isOngoingRecheck(line 1578)的 `&& has` 检查避免
  孤儿条目误用, 走全量重采兜底

## 5. 修改文件清单

**0 个文件修改**(本轮系统审查结论: 无 P1 bug 可修)

R32-1A 的 4 个 P1 修复已完整覆盖 failedBookUrls 的 add/delete/save/resume
全链路; 其他 4 Set + globalQueue + saveProgress + resume 经系统审查确认
add/delete 配对完整、save/resume 链路无断点、append-only Set 是
INTENTIONAL 设计.

## 6. 历史保留 + 零回归

- 历史修复全部保留: R25-1A2/R25-1A3/R26-1A/R27-1A/R27-1B/R28-1A/R28-1B/
  R28-1C/R29-1D/R30-1A/R31-1B/R31-1D/R32-1A 全部不动
- R32-1A 的 4 个 P1 修复(① urls 模式 bookQueue 去重 / ② failedBookUrls
  瞬态错误 add / ③ skip-completed 路径 failedBookUrls.delete / ④
  failedBookUrls 跨重启恢复)全部保留, 本轮复核确认完整
- R31-1B 并发架构核心不动: Semaphore 类 + crawlBookMeta/crawlChapterContent/
  finalizeBook 三方法 + executeTask 三阶段 + BookMetaResult/BookMetaContext/
  ChapterTask 类型 全保留

## 7. 验证

- `bun run lint` → 0 errors / 0 warnings exit 0 ✓
- `bunx tsc --noEmit` → 0 errors in src/ ✓ (排除 examples/skills 预存在
  错误: examples/websocket socket.io-client 缺失 + skills/image-edit 类型 +
  skills/stock-analysis 类型, 均与本轮无关)
- dev.log → Next.js 16.1.3 ready, GET / 200, 无报错 ✓

## 8. 审查结论

**无 P0/P1 bug 可修**: 经系统审查 5 Set(discoveredBookUrls / completedBookUrls
/ ongoingBookUrls / failedBookUrls / bookLastChapters) + globalQueue +
saveProgress + resume 全部分支的 add/delete 配对 + save/resume 链路完整性,
R32-1A 的 4 个 P1 修复已完整覆盖 failedBookUrls 链路; 其他对象的 add/delete
配对完整、save/resume 链路无断点.

**关键发现**:
- **discoveredBookUrls 与 completedBookUrls 是 append-only 设计**(INTENTIONAL,
  非内存泄漏): discoveredBookUrls 标"已发现过"避免重复抓书籍页, completedBookUrls
  标"已完结"避免重复抓整本书; full 模式启动时清空实现重采语义; Set.add
  幂等 + addToResumeSet FIFO 淘汰防 OOM, 内存上限与持久化上限对齐
- **failedBookUrls R32-1A 修复完整**: 3 add(catch 块瞬态错误) 配 4 delete
  (skip-completed / incremental / cross-source / finalizeBook); save
  (line 2451) 配 resume (line 787); full 模式跨轮保留(INTENTIONAL, 诊断
  可见性 + retry-failed 数据源)
- **ongoingBookUrls 与 bookLastChapters 完全对称**: 3 add 配 3 delete
  (状态跃迁 ongoing→completed 时同步移除); 3 set 配 3 delete (bookLastChapters
  与 ongoingBookUrls 同步); isOngoingRecheck `&& has` 防孤儿条目误用
- **globalQueue 不持久化(INTENTIONAL)**: 局部变量, 重启从 bookQueue 重建,
  chapter.fetched=false 留 DB 待下次增量 existUrlMap 跳过已采章 + 重新入
  queue 未采章
- **saveProgress 5 Set 全部落库**: 每次 Set 修改后立刻 saveProgress 防内存
  与 DB 状态分裂; 任务快照字段(requestCount 等)是可见性字段不参与 resume
- **resume 5 Set 全部恢复**: 类型校验严密(Array.isArray + filter typeof
  string + 非空); R32-1A 修复 failedBookUrls 恢复

**P2 已知不修(边缘 case, 非阻塞性)**:
- 'blocked' / 'empty-toc' 路径不调 failedBookUrls.delete(INTENTIONAL,
  拦截/解析失败可能持续, 留在 failedBookUrls 待用户解决后重试)
- completed→ongoing 反向跃迁不主动 delete completedBookUrls(罕见, P2
  边缘 case, 配 DB 二级验证 fall-through 兜底)
- saveProgress 并发 lost-update(R32-1A 已记, 影响少量 resume 条目, 非
  正确性 bug)
- addToResumeSet / addToBookLastChapters 独立 FIFO 淘汰可能暂时不一致
  (跨 Set, isOngoingRecheck `&& has` 兜底)

**未修改(尊重约束)**:
- src/components/public/*(前端) ✓
- fetcher.ts/obscura.ts/cleaner.ts/types.ts(B agent 第七轮, 本轮无 P0/P1
  bug) ✓
- page.tsx/PublicSite.tsx(主控已改) ✓
- rule-templates/seed-rules(C agent 校准) ✓
- prisma/schema.prisma + package.json(0 新依赖) ✓
