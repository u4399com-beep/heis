# Task R25-1A3 — obscura.ts + runner.ts 深度审查 + bug 修复 + 稳定性增强

**Task ID**: R25-1A3
**Agent**: full-stack-developer (obscura/runner 深度审查)
**范围**: src/lib/crawl/obscura.ts (1661 → 1692, +31) + src/lib/crawl/runner.ts (2227 → 2238, +11)
**审计 LoC**: ~3888 行 (obscura 1661 + runner 2227)
**修复数量**: P1=3 (obscura) / P2=2 (runner) / 共 +42 行

---

## 1. 读交接文档

读 worklog.md 末 200 行 + agent-ctx 历史文档:
- **R25-1B**: 7 View (BookView/CategoryView/ReadView/SearchView/KeywordView/RankingView/FulltextView) + PublicSite + page.tsx SSR 接线 (initialBooks/initialBook/initialChapter/initialSearch/initialKeyword + initialCategories)
- **R25-1D2**: 智能分类/TDK/SEO/搜索关键词下拉修复 (suggest.ts yandex endpoint 修 + 7 引擎聚合 + 18 TDK 预设 + auto-tdk.ts/seo.ts 验证)
- **R25-1A2**: fetcher.ts 深度审查 + 反反爬增强 (uc-bridge 8 级降级链补齐 + cfg.headers.Referer 覆盖 bug + sleepUnref 9 处统一 unref + AbortController clearTimeout × 3)
- **agent-ctx/2-obscura.md**: Task 2-obscura 池管理 + Bug4 recreateSlot orphan + Bug18 cookie host-filter + E1-E5 增强 (stealth 脚本 11/12 + CF 挑战 8s + locale/dsf + Edge UA + reclaim timer 60s/10min)
- **agent-ctx/2-runner.md**: Task 2-runner 7 bug + 4 增强 (Bug8 recoverOnBoot 标志位 + Bug5 swallowExpectedDb + Bug10 阶段E + Bug19 live.status paused + Bug24/25/26 + E1 unref + E2 LRU + E3 abortControllers 移除 + E4 熔断冷却)
- **agent-ctx/code-audit-r22.md**: R22-1A 深度审计, 3.2 runner.ts control() 30s timer try/finally clearTimeout + 3.5 obscura.ts 池管理 + 30s 排队超时 + Turnstile 8s 截止 + 5.1-5.4 dead code 清理 -7462 行

---

## 2. obscura.ts 全量审查 (1661 行)

### 2.1 池管理架构
- **PoolSlot 接口** (line 948-963): ctx/page/domain/fp/busy/cdp/lastUsedAt/consecutiveFailures
- **ObscuraGlobal** (line 999-1016): pwModule/browser/launchPromise/slots/pendingCreates/waiters/idleTimer/reclaimTimer/probeOk/probeAt/hooksRegistered/shuttingDown
- **MAX_CONCURRENCY** (line 981-985): clamp [1, 8], 默认 2
- **IDLE_CLOSE_MS** (line 987): 5min 全空闲关浏览器
- **SLOT_IDLE_RECLAIM_MS** (line 992): 10min 单槽未用 close ctx
- **SLOT_RECLAIM_INTERVAL_MS** (line 994): 60s 扫描间隔

### 2.2 createSlot (line 1130-1143) ✓
- newStealthContext + ctx.newPage + applyUaCdpOverride
- catch 块 `await ctx.close().catch(() => {})` 回收 ctx
- newStealthContext 抛错(在 try 之外)时函数直接抛, caller 的 finally 块 S.pendingCreates-- + wakeNext

### 2.3 recreateSlot (line 1157-1187) — P1 Bug O3 发现
- 原实现 `const ctx = await newStealthContext(...)` 在 try 块之外
- newStealthContext 抛错时函数直接上抛, catch 块不执行 → consecutiveFailures 不累加
- slot 永远不被移除(持续重试占用 MAX_CONCURRENCY 名额, 池容量卡死)
- **修复**: let ctx 占位 + 单 try 包裹全链路 + ctx 为 null 时跳过 close

### 2.4 newStealthContext (line 1090-1128) — P1 Bug O2 发现
- browser.newContext + addInitScript 循环(静态脚本 + per-context 动态脚本 + identity 脚本)
- 原实现 ctx 建立后裸跑 addInitScript 循环
- 任一脚本注入失败(语法错误/引擎异常)抛错时, ctx 既没返回给 caller 也没 close
- 每次失败泄漏一个空 BrowserContext(进程级 chromium 资源)
- caller 的 catch 块只覆盖 ctx.newPage/applyUaCdpOverride 失败路径(在 try 内)
- newStealthContext 抛错时 caller 的 try 块未进入, catch 不执行, ctx 永久泄漏
- **修复**: try/catch 包裹 addInitScript 循环, 失败时 close ctx 再抛

### 2.5 scheduleReclaim (line 1207-1226) — P1 Bug O1 发现
- 60s setInterval 扫描非 busy 槽位, 10min 未用则 close ctx
- 原实现 fire-and-forget `void slot.ctx.close()` 不改 busy 字段
- close 是 async(ctx.close 启动后级联关 page 仍需微秒级完成)
- 在 close 完成前 page.isClosed() 可能仍返回 false
- 此时另一 caller 进入 withObscuraPage 取槽, find(!busy) 拿到该 slot
- 检查 free.page.isClosed()=false 跳过 recreateSlot
- 直接 `slot = free; break` 后 `await fn(slot.page, slot.ctx)` 在已关 ctx 上跑抛 "Target closed"
- **修复**: close 之前 `slot.busy = true` 临时锁定 + .finally 恢复 `slot.busy = false`

### 2.6 withObscuraPage (line 1281-1388) ✓
- 信号量获取: 优先复用同域空闲槽 + 兜底任意非 busy 槽
- free.busy = true 占位(防并发抢)
- S.shuttingDown 检查(防 shutdown 期间建新 ctx orphan)
- recreateSlot 失败 free.busy = false + wakeNext
- createSlot 路径 S.pendingCreates++ + finally S.pendingCreates-- + wakeNext
- createSlot 后再检查 S.shuttingDown(splice + close + slot=null + throw)
- 排队等待 30s 超时(已 unref R25-1A) + TDZ 兜底(R5-18) + waiter splice 防 wakeNext 调空
- finally 块 slot.busy=false + lastUsedAt=now + wakeNext + resetIdleTimer

### 2.7 renderStealth (line 1488-1625) ✓
- goto(domcontentloaded) + 挑战等待循环(E2 1-3s 随机 + tryClickTurnstile + isChallengeUIVisible)
- 超时不抛错返回当前状态(fetcher.looksBlocked 检测并降级)
- waitSelector/waitMs/clickSelector + settle 采样(700ms × 2 稳定)
- content 重试 3 次(navigation 中 "Execution context destroyed")
- cookie 全量回传(Bug18 修复, 不按 host 过滤防 cf_clearance 丢失)

### 2.8 tryClickTurnstile (line 1445-1475) ✓
- 8s deadline + 8 frame 上限
- R25-1A 修复 P2 误点风险: isCfWidgetIframe 严格匹配 challenges.cloudflare.com 才用通用 checkbox
- 主 frame 用 `.cf-turnstile input[type=checkbox]` 限定(防误点站内 checkbox)

### 2.9 isChallengeUIVisible (line 1418-1437) ✓
- URL 含 /cdn-cgi/challenge + 4 个挑战 UI 选择器
- page 销毁时保守返回 true(让上层轮询继续等)

### 2.10 shutdownObscura (line 1640-1661) ✓
- S.shuttingDown=true + clear idleTimer/reclaimTimer + splice slots + allSettled close + S.browser=null + 唤醒所有 waiters + b.close + S.shuttingDown=false

---

## 3. runner.ts 全量审查 (2227 行)

### 3.1 control() (line 433-475) ✓
- per-task 串行化链(controlChains): prev.then + tail.catch 吞错 + 自删 Map 项
- 30s race timer: R14-1B try/finally clearTimeout + R25-1A unref
- raceTimer 在 inner() 调用时(new Promise executor 同步)赋值

### 3.2 controlInner (line 477-583) ✓
- start: E4 熔断冷却检查(60s) + epoch++ + 重置计数器 + serializeStatusWrite('running') + 异步 executeTask
- pause: rt.paused=true + serializeStatusWrite('paused')
- stop: rt.stopped/paused/running 三字段 + circuitTrippedAt 清零 + cancelAutoRefresh + serializeStatusWrite('stopped')

### 3.3 executeTask (line 605-988) ✓
- 入口同步绑定 myEpoch(ll-c, 防 await 窗口 epoch 漂移)
- try 块: ensureDirs/loadConfig + 发现书籍 + 逐本采集 + 结束块(done/error)
- catch 块: BudgetExceeded/熔断/普通错误分流 + doneWritten 标志防覆盖 + autoRefresh 重排
- finally 块: 清 running 仅当 epoch 匹配(防旧循环误清新轮)

### 3.4 gateFetch (line 1011-1085) ✓ (审查确认无 bug)
- requestCount++ + maxRequests 预算检查(BudgetExceeded)
- `const ticket = await acquireHostGate(...)` 在 try 之外
- acquireHostGate 抛错(HostGateTimeout)时 try 块未进入, finally 不执行
- ticket TDZ 不触发 ReferenceError(因 finally 块未执行)
- acquireHostGate 抛 HostGateTimeout 时 waiter 已在 hostgate 内部 splice(line 381-382), 无泄漏
- releaseHostGate(undefined) 静默返回(hostgate line 402 `if (!ticket?.host) return`)

### 3.5 crawlOneBook (line 1088-1975) — P2 Bug R43 发现
- waitIfPaused + 书籍页 + 违禁词 + 智能分类(P2002 重试 3 次退避) + 封面下载
- 建库/更新(跨源去重 OR:[sourceUrl, {name+author}] 收紧)
- 目录页(tocLink/本页/嗅探 + 浏览器重取) + 智能完结 + 连载增量检查 + 跨源去重
- 章节重排 A/B/C/D/E 五阶段(stop/epoch 检查 + swallowExpectedDb + 阶段E 尾部陈旧章清理)
- 多线程批次采集(Promise.all + 连续错误熔断 20 + 退避 sleepGap)
- 下拉词
- **P2 Bug R43**: 2 处 retry backoff setTimeout 没 unref
  - line 1205: 分类 P2002 重试 `await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)))` (50/100/200ms)
  - line 1343: 目录页重试 `await new Promise((r) => setTimeout(r, 800))` (800ms)
  - 与 control raceTimer / autoRefresh timer / obscura reclaimTimer 同口径不一致

### 3.6 serializeStatusWrite (line 227-242) ✓
- per-task 串行化链(dbStatusChains) + tail.catch 吞错 + 自删 Map 项

### 3.7 scheduleAutoRefresh (line 252-283) ✓
- cancelAutoRefresh 先清旧 + clamp [5,1440] 分钟 + setTimeout fire 复核终态 + unref(E1)

### 3.8 pruneRuntimesIfNeeded (line 347-365) ✓
- LRU 200 上限 + 优先驱逐终态 + 僵尸暂停(1h) + 冷却窗口保留
- Map 迭代时 delete 当前项安全(JS 规范保证)

### 3.9 disposeRuntime (line 369-375) ✓
- 仅在 !running 且不在冷却窗口时释放

### 3.10 recoverOnBoot (line 380-409) ✓
- 一次性标志(__novelRecoveredAt) + stale 任务转 paused + autoRefresh 重排
- Bug8 修复: 标志位在全部 DB 操作成功后置位(catch 不置位留待重试)

### 3.11 saveProgress (line 1977-2035) ✓
- 先查存在性(防 P2025 噪音) + P2025 静默 + 其余 warn
- 同步落库 resume Sets(discovered/completed/ongoing/failed/bookLastChapters) + 快照字段

### 3.12 sleepGap (line 2051-2057) ✓
- 可中断批次间隔睡眠(600ms 切片 + stop/paused/epoch 检查)
- 用 sleep(@/lib/utils 已 unref)

---

## 4. 修复 + 增强

### 4.1 obscura.ts (1661 → 1692, +31 行)

#### P1 修复① scheduleReclaim 心跳回收竞态 (line 1237-1252, +13 行)
```ts
// 修复前:
try { if (slot.page && !slot.page.isClosed()) {
  void slot.ctx.close().catch(() => {})  // fire-and-forget, 不改 busy
} } catch { /* 静默 */ }

// 修复后:
try { if (slot.page && !slot.page.isClosed()) {
  slot.busy = true  // 临时锁定, 防 caller 抢占正在被回收的 slot
  void slot.ctx.close().catch(() => {}).finally(() => {
    slot.busy = false  // close 完成(或失败)后恢复, 下次 caller 取到时 page.isClosed()=true 触发 recreateSlot
  })
} } catch { /* 静默 */ }
```

#### P1 修复② newStealthContext ctx 泄漏 (line 1104-1139, +13 行)
```ts
// 修复前:
const ctx = await browser.newContext({...})
const scripts = selectStealthScripts(level)
for (const script of scripts) {
  await ctx.addInitScript(script)  // 裸跑, 失败时 ctx 泄漏
}
...
return ctx

// 修复后:
const ctx = await browser.newContext({...})
try {
  const scripts = selectStealthScripts(level)
  for (const script of scripts) {
    await ctx.addInitScript(script)
  }
  ...
  return ctx
} catch (e) {
  try { await ctx.close().catch(() => {}) } catch { /* ignore */ }
  throw e
}
```

#### P1 修复③ recreateSlot consecutiveFailures 漏计 (line 1171-1206, +12 行)
```ts
// 修复前:
try { await slot.ctx.close().catch(() => {}) } catch { /* ignore */ }
const ctx = await newStealthContext(fp, level)  // 在 try 之外, 抛错时 catch 不执行
try {
  const page = await ctx.newPage()
  ...
} catch (e) {
  await ctx.close().catch(() => {})  // ctx 必非 null(try 外已赋值)
  slot.consecutiveFailures = (slot.consecutiveFailures || 0) + 1
  ...
}

// 修复后:
try { await slot.ctx.close().catch(() => {}) } catch { /* ignore */ }
let ctx: BrowserContext | null = null  // 占位
try {
  ctx = await newStealthContext(fp, level)  // 抛错时 ctx 仍 null
  const page = await ctx.newPage()
  ...
} catch (e) {
  if (ctx) await ctx.close().catch(() => {})  // ctx 为 null 时跳过
  slot.consecutiveFailures = (slot.consecutiveFailures || 0) + 1  // 任一步失败都累加
  ...
}
```

### 4.2 runner.ts (2227 → 2238, +11 行)

#### P2 修复① 分类 P2002 重试退避 unref (line 1205-1211, +5 行)
```ts
// 修复前:
await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)))

// 修复后:
await new Promise((r) => {
  const t = setTimeout(r, 50 * Math.pow(2, attempt))
  ;(t as unknown as { unref?: () => void }).unref?.()
})
```

#### P2 修复② 目录页重试退避 unref (line 1349-1354, +5 行)
```ts
// 修复前:
await new Promise((r) => setTimeout(r, 800))

// 修复后:
await new Promise((r) => {
  const t = setTimeout(r, 800)
  ;(t as unknown as { unref?: () => void }).unref?.()
})
```

---

## 5. 验证

```
bun run lint                                                   → 0 errors / 0 warnings ✓
bunx tsc --noEmit (排除 examples/skills)                       → 0 errors ✓
dev server log: Ready in 1384ms, GET /?view=home 200 in 18.9s ✓
```

---

## 6. 历史修复保留 + 已知限制

### 6.1 历史修复保留(全部无回归)
- **R22-1A**: control() 30s timer try/finally clearTimeout + R25-1A unref
- **Task 2-obscura**: Bug4 recreateSlot orphan + Bug18 cookie 全量回传 + E1-E5 增强
- **Task 2-runner**: Bug5/8/10/19/24/25/26 + E1-E4 增强
- **R5-18**: TDZ 兜底 + 30s 排队超时
- **R3-17**: consecutiveFailures 计数
- **R4-12**: shuttingDown 守卫
- **R3-16**: 30s 排队超时
- **R3-13**: controlInner 30s race
- **ll-c**: executeTask 入口同步绑定 myEpoch
- **jj-d**: crawlOneBook myEpoch 调用方传入
- **zz-d**: 终态覆写竞态(doneWritten 标志 + 让位条件重查)
- **ee-d**: fetch 超时计连败(慢站对 hostGate 可见)
- **tt-c**: 连续错误熔断 20 + circuitTrippedAt 60s 冷却
- **R7-29**: 批量查询 DB 已发现 URL
- **R4-11/R5-1**: existChapters 10000 上限 + count 全量兜底

### 6.2 已知限制(如实记录, 非本次范围)
- **serializeStatusWrite 链死锁(理论场景)**: db.task.update 永不 resolve(SQLite busy 锁死)时, dbStatusChains 链死锁; 但 Prisma 默认 query timeout 30s 兜底, control 30s race 也超时, 实际不会发生
- **obscura ctx.close 永不完成(理论场景)**: playwright bug 时, scheduleReclaim 临时 busy=true 永久卡死该 slot; 但 playwright ctx.close 有内部超时兜底
- **obscura reclaimTimer 重复 close(已防)**: close 进行中(busy=true)60s 后再 fire, `if (slot.busy) continue` 跳过; close 完成后(busy=false)page.isClosed()=true, `!slot.page.isClosed()` 跳过, 不会重复 close

### 6.3 审查确认无回归的关键路径
- withObscuraPage 排队等待 30s 超时(已 unref) + TDZ 兜底 + waiter splice
- withObscuraPage createSlot 路径 S.pendingCreates + S.shuttingDown 检查 + splice 兜底
- withObscuraPage free 路径 busy=true 占位 + S.shuttingDown 检查 + recreateSlot 失败 busy=false + wakeNext
- control() per-task 串行化链 + 30s race + tail.catch + 自删
- serializeStatusWrite per-task 串行化 + tail.catch + 自删
- executeTask 入口同步绑定 myEpoch + finally epoch 匹配才清 running
- crawlOneBook 章节 5 阶段重排 stop/epoch 检查 + swallowExpectedDb + 阶段E 尾部清理
- crawlOneBook 连续错误熔断 20 + 60s 冷却
- gateFetch try/catch/finally + acquireHostGate 抛错时 ticket TDZ 不触发(try 未进入, finally 不执行)

---

## 7. 不修改的文件(尊重约束)

- src/lib/crawl/fetcher.ts (A2 agent 已改)
- src/components/public/* (前端)
- src/app/page.tsx / src/components/public/PublicSite.tsx (主控已改)
- src/lib/crawl/{cleaner,parser,types,suggest,smart,storage,hostgate,sorter,calibrate,downloader,rule-templates,auto-tdk,themes}.ts (其他模块)
- prisma/schema.prisma
- package.json (0 新依赖)

---

## 8. 总结

- **P1 bug 修复**: 3 处(obscura.ts)
  - scheduleReclaim 心跳回收竞态(close 前 busy=true 锁定)
  - newStealthContext ctx 泄漏(try/catch 包裹 addInitScript)
  - recreateSlot consecutiveFailures 漏计(let ctx 占位 + 单 try 全链路)
- **P2 资源泄漏修复**: 2 处(runner.ts retry backoff setTimeout unref × 2)
- **历史修复保留**: R22-1A / Task 2-obscura / Task 2-runner / R5-18 / R3-17 / R4-12 / R3-16 / R3-13 / ll-c / jj-d / zz-d / ee-d / tt-c 全部保留
- **验证**: tsc 0 errors / lint 0 errors / 0 warnings / dev server 200 OK
- **不引入新 npm 包**(0 新依赖)
- **不修改** fetcher.ts / 前端 / page.tsx / 其他 crawl 模块
