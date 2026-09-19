# R31-1B 并发采集架构改造

**Agent**: full-stack-developer  
**Task ID**: R31-1B  
**完成时间**: 2026-09-19

## 任务概述

用户要求将 runner.ts 的串行采集(`for (let bi=0; bi<bookQueue.length; bi++)` + `await this.crawlOneBook(...)`)改造为**并发采集架构**:
- 阶段 1: 并发采集书籍简介页 + 目录页(拿到书名/作者/简介/封面 + 全部章节标题)
- 阶段 2: 并发采集章节内容页(基于阶段 1 的章节列表)

## 修改文件

1. `src/lib/crawl/types.ts` (+15 行)
2. `src/lib/crawl/runner.ts` (+346 行,2291 → 2637 行)

## 改动详情

### 1. types.ts — 新增 concurrency 字段

```ts
// FetchConfig 接口 line 299-308
concurrency?: number  // 任务级采集并发度上限, 默认 3, 钳 [1, 10]
// 与 hostGateLimit 的区别: hostGateLimit 是单 host 在飞上限(全局闸门),
// concurrency 是单任务内并发作业数(任务级调度上限)
```

`sanitizeFetchConfig` line 975-979 钳制 `[1, 10]`。

### 2. runner.ts — Semaphore 类 (line 215-238)

手写异步信号量(不引入 p-limit 依赖):
- `acquire()`: 队列 FIFO 等待
- `release()`: 唤醒队首 waiter
- acquire/release 必须成对(try/finally 包裹)

### 3. runner.ts — 新增类型 (line 256-297)

- `BookMetaStatus`: 'ok-meta' | 'ok' | 'blocked' | 'empty-toc' | 'stopped' | 'error'
- `BookMetaContext`: bookId/bookName/bookUrl/tocItems/detectedStatus/parsedWordCount/idMap/fetchCfg/contentFetchCfg
- `BookMetaResult`: status + bookUrl + queue?(ChapterTask[]) + bookCtx?
- `ChapterTask`: bookCtx(共享引用) + chId? + title + url + volume + idx

### 4. runner.ts — crawlOneBook 拆分 (原 935 行 → 三方法)

#### crawlBookMeta (line 1464-1840, 阶段 1)
- **职责**: 书籍页 fetch → parseBook → 违禁词 → 智能分类 → 智能完结初判 → 封面 →
  建库 → 目录页 fetch → 智能完结终判 → 增量检查 → 跨源去重 → 章节重排 5 阶段(A/B/C/D/E)
- **返回**: `Promise<BookMetaResult>` 含 queue(ChapterTask[]) + bookCtx(BookMetaContext)
- **早返回**: 'blocked'(书籍页被拦) / 'empty-toc'(目录空) / 'ok'(违禁词/增量/跨源跳过) /
  'stopped'(任务停止/换代)

#### crawlChapterContent (line 2137-2274, 阶段 2 单章)
- **职责**: gateFetch 章节页 → parseContent → cleanContentHtml(含 trafilatura 兜底) →
  saveChapterTxt/db → chapter.update/create
- **返回**: `Promise<{ok:true} | {ok:false, kind:'no-url'|'timeout'|'abort'|'hostgate'|'other', message?}>`
- **R31-1B 增强**: BudgetExceeded/isCircuitBreak 立即 throw 上抛(原 catch 落到 "other"
  分支需 20 次硬敲才熔断, 改为直接上抛立即终止任务)

#### finalizeBook (line 2284-2385, 阶段 3 收尾)
- **职责**: book.aggregate(wordCount 聚合) → book.update(wordCount/latestChapter,
  含 R7-17 fallback) → fetchSuggestKeywords → 状态分流(completedBookUrls/ongoingBookUrls) →
  booksDone++ → failedBookUrls.delete → saveProgress

### 5. runner.ts — executeTask 三阶段重构 (line 919-1294)

#### 阶段 1: 并发书籍 meta (line 919-1102)
- `bookConcurrency = Math.max(1, Math.min(10, Number(cfg.fetchOverride.concurrency ?? cfg.rule.fetch.concurrency) || 3))`
- `bookSem = new Semaphore(bookConcurrency)`
- `while (bookIdx < bookQueue.length)` 批次循环:
  - pause/stop/epoch 检查点 + 在线调参(live DB 读)
  - `batchSize = Math.min(bookConcurrency, remaining)`
  - `Promise.all(batch.map(async (bookUrl) => { acquire → completedBookUrls 跳过 →
    loadConfig → crawlBookMeta → 错误分类处理 → release }))`
- 错误隔离: 单本失败返回 `{ status: 'error', bookUrl }` 不影响其他
- BudgetExceeded/isCircuitBreak throw e 上抛任务级

#### 阶段 2: 全局并发章节内容 (line 1117-1274)
- 收集所有 ok-meta 书的 queue → `globalQueue` (ChapterTask[])
- `if (globalQueue.length > 0 && !rt.stopped && !isStale())`:
  - `phase2Rule/phase2Task/phase2FetchOverride` 局部 const(TypeScript null narrowing)
  - `while (globalQueue.length > 0)` 批次循环:
    - `chapterConcurrency = Math.max(1, Math.min(10, ...))`
    - `batchSize = Math.min(threads, chapterConcurrency, remaining)`
    - `Promise.all(batch.map(async (q) => { crawlChapterContent → 结果分类处理 →
      stats.chaptersUpdated++/errors++/consecutiveErrs++ → bookDoneMap 累加 }))`
  - tt-c 连续错误熔断: `consecutiveErrs >= CIRCUIT_ERROR_LIMIT(20)` → throw isCircuitBreak
    (跨所有书累计, 原 per-book 语义改为 global)
  - feat-round-8 B1: `sleepGap(jitteredInterval(interval, jitterMs), rt, myEpoch)`

#### 阶段 3: 串行 finalizeBook (line 1275-1294)
- `for (const bc of okMetaBooks) { pause/stop/epoch → finalizeBook(bc, bookDone) }`
- 错误隔离: 单本 finalize 失败不影响其他

## R25-R29 修复保留(零回归)

| 修复 | 保留位置 | 说明 |
|---|---|---|
| TOCTOU(epoch 漂移) | executeTask line 730 + 各检查点 | myEpoch 同步绑定, isStale() 检查 |
| control 30s timer | rt.circuitTrippedAt + CIRCUIT_COOLDOWN_MS = 60_000 | 熔断后 60s 冷却 |
| cookieJar | fetcher.ts 不动 | R29-1D 5 处 hostname format 统一保留 |
| 8 级降级链 | fetcher.ts/obscura.ts 不动 | native→curl→fetch-relay→scrapling-*→Obscura→uc-bridge→moli-bridge |
| detectedStatus 分流 | finalizeBook line 2376-2385 | completed→completedBookUrls / ongoing/unknown→ongoingBookUrls |
| rt.ongoingBookUrls/completedBookUrls 管理 | crawlBookMeta + finalizeBook | 增量检查 + 跨源去重 + 终态分流 |
| BudgetExceeded 传播 | gateFetch → crawlBookMeta/crawlChapterContent catch throw → executeTask 外层 catch | 立即终止任务 + autoRefresh 重排 |

## R31-1B 增强

**BudgetExceeded/isCircuitBreak 立即上抛**:
- 原实现: crawlChapterContent catch 把 BudgetExceeded 落到 "other" 分支(仅计
  errors++ + consecutiveErrs++ + log), 需累计 20 次硬敲才触发 CIRCUIT_ERROR_LIMIT=20
  熔断, 浪费 20 次请求 + 20 条 error 日志
- 新实现: crawlChapterContent line 2173 `if (e?.name === 'BudgetExceeded' || e?.isCircuitBreak) throw e`
  立即上抛, 走 executeTask 阶段 2 闭包 throw → executeTask 外层 catch → error 终态

## 验证

- `bun run lint`: 0 errors / 0 warnings ✓
- `bunx tsc --noEmit`: 0 errors in src/lib/crawl/runner.ts + types.ts ✓
  (排除 examples/websocket + skills/image-edit + skills/stock-analysis-skill 预存在错误)

## 未修改(尊重约束)

- `src/components/public/*` (前端)
- `page.tsx/PublicSite.tsx` (主控已改)
- `obscura.ts/fetcher.ts` 的 8 级降级链 (保留)
- `prisma/schema.prisma`
- `package.json` (0 新依赖)
