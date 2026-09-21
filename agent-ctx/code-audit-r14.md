# 代码审计报告 R14-1B

> 审计任务: 整体代码逐行强力深度抓 bug 并全部修复
> 审计范围: 14 个 crawl 模块 + admin/public API 路由 + 前端 5 视图 + BookInfoLayout + read-layouts + HomeClone*.tsx
> 审计基线: R13-1C 已修复 1 P1 + 4 P2, R14-1A 新增 BookInfoLayout.tsx + contentSelector 字段
> 审计结论: 共发现 4 个 bug, 全部修复 (P0=0, P1=2, P2=2)

## R14-1A 新增代码审计

### BookInfoLayout.tsx (~560 LoC)

**审计项**:
- 10 套 BookInfo 变体 (Aijjxs/Ddyueshu/Pilishuwu/23qb/101kks/Huangjinwu/Ggd66/Shipsay/X2552/Trxsw) DOM 结构与原站 probe-html2 实测一致 ✓
- `usePanelStyle` hook 在每个变体函数顶层调用, 符合 react-hooks 规则 ✓
- `ActionButtons` props 透传正确 (book/savedPos/firstChapterId/onScrollToc), 未使用的 onContinueRead/onGoCategory 不引发 bug ✓
- 入口 `BookInfoLayout` switch 分发 10 套 + default 兜底 BookInfoAijjxs ✓
- `BookInfoGgd66` / `BookInfoX2552` 委托 `BookInfo23qb` (注释说明同 clone-23qb 结构), 非重复代码 ✓

**发现 bug**:
- **P2: BookInfoTrxsw `<a>` 无 href 无 onClick** (line 514)
  - `<a style={{ color: v.primary, cursor: 'pointer' }}>{book.author}</a>` 缺 `href` 与 `onClick`
  - `cursor:pointer` 提示可点, 实际点击无任何效果; a11y 缺陷 (`<a>` 无 href 不可 focus/键盘访问)
  - 其他 9 套变体 (Ddyueshu/Pilishuwu/23qb/...) 作者均用 `<span>` 静态文本语义, Trxsw 独用 `<a>` 不一致
  - **修复**: 改为 `<span style={{ color: v.primary }}>{book.author}</span>`, 与其他变体一致, 保留原站视觉 (v.primary 色)

### contentSelector 字段 (themes.ts + ReadView + shared.tsx + 4 read-layouts)

**审计项**:
- ThemeDef 接口新增 `contentSelector?: string` 字段 (themes.ts:120), 向后兼容 ✓
- 10 套 preset 全部声明 contentSelector:
  - clone-aijjxs: `#view_content_txt` (实测 probe-aijjxs-chapter.html)
  - clone-ddyueshu/clone-pilishuwu/clone-23qb/clone-101kks/clone-huangjinwu/clone-ggd66/clone-x2552: `#content`
  - clone-shipsay/clone-trxsw: `.content`
- `parseContentSelector(selector)` 工具函数 (shared.tsx:143) 正确处理:
  - `#xxx` → `{ id: 'xxx' }` ✓
  - `.xxx` → `{ className: 'xxx' }` ✓
  - undefined/'' → `{}` ✓
  - 复合选择器 (含空格/多段) → `{}` 降级 (注释明确说明) ✓
- ReadView 透传 `contentSelector: theme.contentSelector` 到 shared props (ReadView.tsx:500) ✓
- 4 个 read-layouts (ReadClassic/ReadPili/ReadImmersive/ReadPaginated) 在正文外层 div `{...parseContentSelector(contentSelector)}` spread ✓

**发现 bug**: 无

### BookView.tsx 重构 (R14-1A)

**审计项**:
- 删除内联信息区渲染 (panelStyle + coverW + section + h1 + div.kv + 内联 ActionButtons ~120 行) ✓
- 改用 `<BookInfoLayout />` 接力分发 (BookView.tsx:645) ✓
- 清理不再使用的 import (Bookmark/Download/fmtDate/ShareMenu/StatusBadge/ReadFirstButton/formatReadTimeShort) ✓
- 保留 R13-1A PSEOKeywordsSection + R13-1C TocChapterButton useEffect cleanup ✓
- 保留 RelatedBooks / BookStatsBar / TagCloud / 章节目录分页 / SEO TDK + JSON-LD ✓
- 无遗留的 `theme.id === 'xxx'` 分支 ✓

**发现 bug**: 无

## 已有代码审计

### P0 bug
无

### P1 bug (2 个, 全部修复)

#### P1-1: fetcher.ts inflightMap TOCTOU race (line ~3900)

**位置**: `src/lib/crawl/fetcher.ts` `fetchPage` 函数 inflight 去重块

**问题**:
```typescript
// 修前代码
const p = (async () => {
  try { ... }
  finally {
    inflightMap.delete(dedupKey)  // ← 无条件 delete
  }
})()
inflightMap.set(dedupKey, { p, at: Date.now() })
```

**触发场景**:
1. T0: caller A 创建 entry pA, 写入 `inflightMap.set(dedupKey, { p: pA, at: T0 })`
2. T0+30s: caller B 检查 `existing && Date.now() - existing.at < INFLIGHT_TTL_MS` —— 30s 已过, 条件 false, 走到下方覆盖路径
3. T0+30s: caller B 创建 pB, `inflightMap.set(dedupKey, { p: pB, at: T0+30s })` 覆盖 pA 的 entry
4. T0+35s: pA 的 promise resolve/reject, finally 块跑 `inflightMap.delete(dedupKey)` —— 删的是 pB 的 entry!
5. T0+40s: caller C 检查 `existing` —— null (已被错误删除), 创建 pC, 重复发起请求

**影响**:
- 去重失效, 后续 caller 重复发起相同请求, 增加对端负载 (反爬侧触发 429 风险升高)
- inflightTrim 的 FIFO 淘汰也会触发同款 race (淘汰旧条目后新 caller 写入, 旧条目 finally 误删新条目)

**修复**:
```typescript
// R14-1B fix: 用 entry 对象包装 promise, 让 finally 块能引用 entry 自身
// (而非直接引用 p, p 在 IIFE 完成赋值前不可引用, TDZ 限制)
const entry: { p: Promise<FetchResult>; at: number } = { p: undefined as any, at: Date.now() }
entry.p = (async () => {
  try { ... }
  finally {
    // 仅当 Map 中当前条目仍是本次 entry 时才删除
    const cur = inflightMap.get(dedupKey)
    if (cur === entry) inflightMap.delete(dedupKey)
  }
})()
inflightMap.set(dedupKey, entry)
return entry.p
```

#### P1-2: fetcher.ts tokenInflight TOCTOU race (line ~3580)

**位置**: `src/lib/crawl/fetcher.ts` `prefetchToken` 函数 token in-flight 去重块

**问题**: 与 P1-1 同款 race condition:
```typescript
// 修前代码
const p = (async () => {
  try { ... }
  finally {
    inflightMap.delete(cacheKey)  // ← 无条件 delete
  }
})()
inflightMap.set(cacheKey, p)
```

**触发场景**:
1. caller A 启动 prefetchToken, 创建 pA 写入 Map
2. tokenInflight() FIFO 淘汰 (m.size > TOKEN_INFLIGHT_MAX=256) 触发, pA 被淘汰
3. caller A 的 promise 仍在执行中 (慢网络)
4. caller B 来, 看到 `existing` 为 null (被淘汰), 创建 pB 写入 Map
5. caller A 的 promise finally 跑 `inflightMap.delete(cacheKey)` —— 删的是 pB 的 entry
6. caller C 来, 看到 null, 创建 pC —— 重复发起 token 预取请求

**影响**: token 端点 (127.0.0.1:301x 转换代理) 收到 N 倍负载, 慢网络场景下 pA 持续挂起时 race 频繁触发

**修复**: 与 P1-1 同款 entry 引用对比模式 (详见代码 line 3580-3604)

### P2 bug (2 个, 全部修复)

#### P2-1: runner.ts control() 30s 超时定时器泄漏 (line ~435)

**位置**: `src/lib/crawl/runner.ts` `control` 函数 `Promise.race` 块

**问题**:
```typescript
// 修前代码
const inner = () => Promise.race([
  this.controlInner(taskId, action),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('control timeout(30s)')), 30_000),
  ),
])
```

`Promise.race` 内的 `setTimeout` 创建后:
- 若 `controlInner` 在 30s 内完成 (典型场景, controlInner 通常 < 1s), `Promise.race` 已 settled, 但 timer 仍挂在事件循环上 30s
- timer 的回调 `reject` 在已 settled 的 promise 上是 no-op (无副作用), 但 timer 本身持有内存与事件循环条目
- 频繁 control 调用 (admin UI 反复 stop/start) 时累积 N 个挂起 timer (最多 30s × N)

**影响**:
- 30s 内 N 次 control 调用累积 N 个挂起 timer, 内存与事件循环条目增长
- timer 未 unref, 阻止进程退出 (dev/CLI 场景)

**修复**:
```typescript
// R14-1B fix: try/finally 显式 clearTimeout
let raceTimer: ReturnType<typeof setTimeout> | undefined
const inner = () => Promise.race([
  this.controlInner(taskId, action),
  new Promise<never>((_, reject) => {
    raceTimer = setTimeout(() => reject(new Error('control timeout(30s)')), 30_000)
  }),
])
const run = prev.then(async () => {
  try {
    return await inner()
  } finally {
    if (raceTimer) clearTimeout(raceTimer)  // 快路径下立即释放
  }
})
```

#### P2-2: BookInfoLayout.tsx BookInfoTrxsw `<a>` 无 href (见 §R14-1A 审计)

### P2 改进 (未修复, 已说明原因)

1. **BookInfoLayout.tsx `onContinueRead` 死字段**: `BookInfoProps` 接口声明 `onContinueRead?: () => void` 但 BookView 调用方未传, BookInfoLayout 内部未消费 (ActionButtons 用 `navigate({ view: 'read', ...})` 直接跳转). 不影响功能, 仅接口冗余. 不修改以保持向后兼容 (未来若添加 continue-read 行为可复用)

2. **fetcher.ts `: any` 类型宽松**: ~30 处 `: any` 主要分布在 catch 块的 `e: any` / 错误对象 `err: any = new Error(...)`. 这些是 JS 错误对象的标准模式, TS strict 下需 any 取 `.message`/`.code`/`.status` 字段; 替换为 `unknown` 需逐处加类型守卫, 收益小且改动量大. 保持现状

3. **fetcher.ts 多处 `parseInt` 无显式 radix**: 全部用 `/^\d+$/` 或 `/^\d{1,3}$/` 前置正则校验, 保证输入纯数字, parseInt 行为确定. 无 NaN 风险

4. **`<a>` 标签 a11y 检查**: BookInfoLayout Trxsw 之外的 9 套变体无 `<a>` 滥用, 全部用 `<button>` 或 `<span>`. KeywordView/BookView 中 `<a href>` 均带合法 href + onClick (PSEO 关键词跳转). 无其他 a11y 缺陷

5. **obscura.ts context/page 资源清理**: 4 处 `await ctx.close().catch(() => {})` (recreateSlot 失败兜底/shutdownObscura 全槽释放/createSlot newPage 失败回收/心跳回收定时器闲置槽释放), 全部正确. shutdownObscura 显式 `S.shuttingDown=true` + `Promise.allSettled(slots.map(s => s.ctx.close()))` + `b.close()`. 无泄漏

6. **fetcher 5 级降级链触发条件**: native→curl(fetchHttp 抛错且非 AbortError)→fetch-relay(node 运行时 + 代理 + checkRelay 通过)→scrapling-static/stealthy/playwright(fetchMode=scrapling-*)→Obscura(auto 引擎升级)→uc-bridge→moli-bridge(cfg.fetchMode='moli'). 每级降级条件正确, cookie/UA/referer 经 buildHeaders 重新组装保持一致

7. **hostgate.ts 并发槽位释放**: 计账式 release (`st.inFlight--` + pump), FIFO 等待队列无 barge, settleRateLimitExpiry 冷却到期清零 failStreak + 回滚 minGapMs. 无竞态

8. **scrapling-bridge 3 模式**: static/stealthy/playwright 由 `scraplingModeOf(cfg.fetchMode)` 解析, 桥内按 mode 分发; fetchViaScraplingBridge 内 2 次重试 + 800ms 退避. 桥不可达降级 native 链一次. 设计正确

9. **Prisma raw query 参数化**: 全库仅 `db.$queryRaw\`SELECT 1\`` (admin/health 无参数), 无用户输入拼接. 无 SQL 注入

10. **dangerouslySetInnerHTML escape**: 5 处 (4 read-layouts + admin/RulesSection + admin/AdminApp + admin/BookDetail + chapter/route + chapters/[id]/route + feedback/[id]/route + cleaner). 公开路径 (read-layouts) 走 `sanitizeReaderHtml` 白名单 (剥 script/style/iframe/on* 事件/javascript:/vbscript:/data:text/html URL). chapter API 的 txt 文件读取走 `.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')` 转义. 无 XSS

11. **SSRF 守卫**: fetcher.ts `assertSafeTarget` + `assertSafeIp` + `resolveAllIps` + `ssrfDnsCache` (60s TTL, 2000 上限) 防御十进制/八进制/十六进制 IP 编码绕过. fetchBinary/fetchPage/scrapling-bridge 全部前置 SSRF 守卫. tokenUrl/contentProxyUrl 走 `allowLoopback:true` 放行回环但拒绝私网/云元数据. 无 SSRF 漏洞

12. **path.join/path.resolve 安全**: 全库无 path.join 拼接用户输入构造文件路径. saveCoverWebp/download 路径生成均用 `crypto.randomUUID()` + 内部固定目录

13. **fetcher.ts cookieJar 跨域泄漏**: fetchHttp/fetchViaCurl/fetchBinary 全部 `redirect:'manual'` 逐跳收集 Set-Cookie + 按该跳 URL 域归属, 跨域跳转不带原域 Cookie. R5-6 修复 + R6-5 domain 属性校验防跨域 cookie 注入

14. **空 catch 块**: 主要分布在资源回收 (`ctx.close().catch(() => {})`) 与隐私模式 localStorage (`catch { /* ignore */ }`), 均为防御性吞错. runner.saveProgress 的 P2025 (任务已删) 静默处理有注释说明

## 未修复 (说明原因)

| # | 项 | 原因 |
|---|---|---|
| 1 | BookInfoLayout.tsx `onContinueRead` 死字段 | 接口冗余, 不影响功能, 保持向后兼容 |
| 2 | fetcher.ts `: any` 类型 ~30 处 | JS Error 对象模式, strict 改动量大收益小 |
| 3 | fetcher.ts `parseInt` 无显式 radix (5 处) | 全部有前置 `/^\d+$/` 正则校验, 行为确定 |
| 4 | obscura.ts 1649 LoC 资源清理审计 | 全部正确 (详见 P2 改进 §5) |
| 5 | fetcher 5 级降级链审计 | 触发条件与 cookie/UA/referer 传递均正确 (详见 P2 改进 §6) |
| 6 | hostgate.ts 并发槽位释放 | 计账式 + FIFO 等待 + 冷却回滚, 无竞态 (详见 P2 改进 §7) |
| 7 | scrapling-bridge 3 模式 | 设计正确 (详见 P2 改进 §8) |
| 8 | Prisma raw query 参数化 | 仅 1 处 `SELECT 1` 无参数, 无注入 |
| 9 | dangerouslySetInnerHTML escape | 公开路径走 sanitizeReaderHtml 白名单, 无 XSS |
| 10 | SSRF 守卫 | 完整 (IP 编码绕过/loopback/云元数据/私网全覆盖) |
| 11 | path.join 安全 | 全库无用户输入拼路径 |
| 12 | cookieJar 跨域泄漏 | 逐跳归属 + domain 属性校验 |
| 13 | 空 catch 块 | 防御性吞错, 均有注释说明 |
| 14 | suggest.ts LRU 缓存空数组死锁 | R13-1C 已修 (P1 fix) |
| 15 | KeywordView fetchRelatedKeywords 无 .catch | R13-1C 已修 (P2 fix) |
| 16 | BookView TocChapterButton useEffect cleanup | R13-1C 已修 (P2 fix) |

## 修改文件清单

| 文件 | 改动 | 优先级 |
|---|---|---|
| `src/lib/crawl/fetcher.ts` | P1-1: inflightMap TOCTOU race fix (fetchPage inflight 去重); P1-2: tokenInflight TOCTOU race fix (prefetchToken in-flight 去重) | P1 |
| `src/lib/crawl/runner.ts` | P2-1: control() 30s 超时定时器泄漏修复 (try/finally clearTimeout) | P2 |
| `src/components/public/BookInfoLayout.tsx` | P2-2: BookInfoTrxsw `<a>` 无 href 改为 `<span>` (与其他 9 变体一致) | P2 |

## 验证

- `cd /home/z/my-project && bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | tail -10` —— 0 errors ✓
- `cd /home/z/my-project && bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` —— 0 errors ✓
- `cd /home/z/my-project && bun run lint 2>&1 | tail -5` —— exit 0 ✓
- `cd /home/z/my-project && bunx tsx scripts/test-themes-r14.ts` —— THEMES.length=10, 10 个 ID + contentSelector 全部 OK ✓

## 修复数量统计

| 类别 | 发现 | 修复 |
|---|---|---|
| R14-1A 新增代码 bug | 1 (BookInfoLayout `<a>`) | 1 |
| 已有代码 P0 | 0 | 0 |
| 已有代码 P1 | 2 (inflightMap race × 2) | 2 |
| 已有代码 P2 | 1 (control timer leak) | 1 |
| **合计** | **4** | **4** |

## 不修改的内容 (尊重约束)

1. 不删除任何活代码 (仅修真实 bug)
2. 不改变函数签名 (向后兼容)
3. 不修改业务逻辑 (5 级降级链/cookie/hostGate 行为完全不变)
4. 不回滚 R13-1A/B/C/D + R14-1A 子代理的修改 (PSEO/cache/pseo-route clearPSEOCacheForBook/KeywordView .catch/BookView useEffect cleanup/BookInfoLayout/contentSelector 全部保留)
5. 不修改 types.ts 字段名 (DB 兼容)
6. 不引入新 npm 包
7. 每个修复均有注释说明为什么这样改
