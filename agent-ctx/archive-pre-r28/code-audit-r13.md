# 代码审计报告 R13-1C

> 审计范围: src/lib/crawl/* (14 文件, 15381 LoC) + src/app/api/admin/* + src/app/api/public/* + src/components/public/* (BookView/ReadView/HomeView/CategoryView/KeywordView + data.ts/types.ts)
> 审计重点: 内存泄漏 / 资源泄漏 / 竞态条件 / 类型安全 / 安全漏洞 (SSRF/路径穿越/SQL 注入/XSS) / 业务逻辑 bug / 错误处理
> 审计方法: 逐文件逐行阅读 + 模式匹配 (setTimeout/setInterval/fetch/Map/`as any`/catch 块) 交叉验证
> 审计约束: 只修复真实 bug, 不做风格重构; 每个修复必有注释说明; 不引入新 npm 包; 不改 types.ts 字段名; 不回滚 R13-1A/R13-1B 的修改

## 审计基线
- 修改前: tsc 0 errors (排除 examples/skills) / lint 0 errors / 0 warnings
- 修改后: tsc 0 errors (排除 examples/skills) / lint 0 errors / 0 warnings ✓

## P0 bug 修复

**未发现 P0 级 bug** — 历经多轮 (R3~R12) 修复后, fetcher/obscura/hostgate/runner 已无明显内存泄漏、SQL 注入、路径穿越、SSRF 漏洞、竞态条件导致数据丢失等问题:
- SSRF 守卫 `assertSafeTarget` 实现完整 (含 IPv4/IPv6/IPv4-mapped/CNAT/私网/云元数据/链路本地全部黑名单 + DNS 全地址解析)
- 路径穿越 `safeJoin` 含 `path.sep` 边界检查, `readChapterTxt/readCover/download` 三处独立兜底
- SQL 注入: 全部走 Prisma 参数化, 无 raw query 注入面; `likeSafe` 清洗 LIKE 通配符
- 内存泄漏: setTimeout/setInterval 均有 `unref()` + finally 块 clearTimeout; per-host 池/captchaCooldown/ssrfDnsCache/tokenCache/inflightMap/responseCache 全部有 FIFO + 上限保护
- 竞态: `serializeStatusWrite` per-task 串行化链; `inflightMap` in-flight 去重; `tokenInflight` TTL 过期防 N×打爆

## P1 bug 修复

### 1. suggest.ts:343-350 — PSEO LRU 缓存空数组死锁 24h
- **文件:行**: `src/lib/crawl/suggest.ts:343-350` (`fetchSuggestKeywordsForBook`)
- **描述**: 7 引擎瞬时全败(网络抖动/DNS 暂时故障)时 `scored=[]`, `cacheWrite(pseoCache, cacheKey, result)` 缓存空数组. 后续调用 `cacheRead` 返回空数组 (`if (cached) return cached` 因 `[]` 是 truthy 而短路), 24h TTL 内所有 PSEO 落地页"无相关搜索词". 一本被瞬时故障影响的书, 整整 24h 内 PSEO 区块空白, 用户体验严重劣化.
- **修复方式**: 仅在 `result.length > 0` 时 `cacheWrite`. 瞬时失败下次调用重新走 7 引擎聚合; 永久性空结果(书名异常/引擎全部不可达)每次也只多花一次 7 引擎并发请求(失败兜底本地模板, 语义无变化).
- **风险**: 零回归 — 缓存命中行为完全不变; 仅未命中的瞬时失败场景行为优化.

## P2 改进

### 2. suggest.ts:227-235 — 新增 `clearPSEOCacheForBook` 精确清缓存
- **文件:行**: `src/lib/crawl/suggest.ts:227-235` (新增导出函数)
- **描述**: 原 `clearPSEOCache()` 清空整个 LRU 缓存. admin/books/[id]/pseo POST 的 `force=true` 用它清缓存, 但应当只清当前书的缓存条目. 一本书的 force 重抓会让其他书的缓存也立即失效, 下次访问都需重新跑 7 引擎聚合, 增加搜索引擎侧压力与首屏延迟.
- **修复方式**: 新增 `clearPSEOCacheForBook(bookName, author, limit, category)`, 按 cacheKey 精确删除单条目. cacheKey 构造口径与 `fetchSuggestKeywordsForBook` 完全一致.
- **风险**: 零回归 — `clearPSEOCache()` 保留供测试用; 新函数仅 admin/books/[id]/pseo 调用.

### 3. admin/books/[id]/pseo/route.ts:64-70 — 用 `clearPSEOCacheForBook` 替代 `clearPSEOCache`
- **文件:行**: `src/app/api/admin/books/[id]/pseo/route.ts:64-70`
- **描述**: 同上, `force=true` 时调用 `clearPSEOCache()` 清整个缓存, 影响其他书的 PSEO 落地页.
- **修复方式**: 改用 `clearPSEOCacheForBook(book.name, book.author, limit, book.category?.name || '')`.
- **风险**: 零回归 — 行为收紧(只清当前书), 不影响其他书的缓存.

### 4. KeywordView.tsx:60-79 — `fetchRelatedKeywords` 链加 `.catch()` 防御 unhandled rejection
- **文件:行**: `src/components/public/KeywordView.tsx:60-79`
- **描述**: 原 `fetchRelatedKeywords(tag).then(...)` 无 `.catch()`. `fetchRelatedKeywords` 内部已 try/catch 返回 `[]`, 理论上永不 reject, 但网络栈异常(连接重置/超时在 try 外的 await)极端路径下仍可能 reject, 成为 unhandled rejection, 在 Node 控制台产生噪音与潜在告警.
- **修复方式**: 链上加 `.catch(() => setRelatedSearch([]))`, 兜底返回空数组.
- **风险**: 零回归 — `fetchRelatedKeywords` 永不 reject, `.catch` 仅在极端异常路径兜底.

### 5. BookView.tsx:88-96 — TocChapterButton hover 定时器 useEffect cleanup
- **文件:行**: `src/components/public/BookView.tsx:88-96`
- **描述**: `TocChapterButton` 组件 `onEnter` 设 300ms hover 定时器调 `fetchChapter` + `setPreview`. `onLeave` 清理定时器, 但若组件在 hover 期间 unmount(用户点击导航/父组件重渲染切换目录页)时 `onMouseLeave` 不触达, 定时器继续 pending, 300ms 后 fire 调 `setPreview` 在已卸载组件上 setState. React 18+ 不再 warn, 但仍是内存/计时器泄漏(尤其目录长列表多次悬停切换时累积).
- **修复方式**: 加 `useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current) }, [])` 在 unmount 时兜底清理.
- **风险**: 零回归 — 仅新增 cleanup, 不改变 hover 行为.

## 未修复(说明原因)

### N1. runner.ts:348 — `pruneRuntimesIfNeeded` 操作符优先级歧义
- **文件:行**: `src/lib/crawl/runner.ts:348`
- **描述**: `if (!rt.running && (!rt.circuitTrippedAt || (now - rt.circuitTrippedAt) >= CIRCUIT_COOLDOWN_MS) || isPausedStale)` 因 `&&` 优先于 `||`, 实际语义是 `(!rt.running && (...)) || isPausedStale`. 由于 `isPausedStale = rt.paused && !rt.running && ...` 内部已含 `!rt.running` 守卫, 实际行为正确(活跃任务永不被驱逐). 但代码可读性歧义, 读者可能误以为是 `!rt.running && (... || isPausedStale)`.
- **不修复原因**: 仅是代码可读性问题, 实际行为正确. 加括号属风格重构, 不在"只修真实 bug"范围内.

### N2. fetcher.ts:1146 — `applyThinkTime` setTimeout 无 unref
- **文件:行**: `src/lib/crawl/fetcher.ts:1146`
- **描述**: `setTimeout(r, delay)` 无 `.unref()`. CLI 测试脚本中如果调 `fetchPage` 但不 await 完整 Promise, 定时器会阻止进程退出. 长跑服务进程中无影响(定时器到期即 GC).
- **不修复原因**: 主调用路径 `await applyThinkTime(cfg)` 会等待 Promise resolve, 进程能正常退出. 仅在不规范用法(不 await)下暴露, 属误用面而非真实 bug.

### N3. suggest.ts cacheRead 返回共享引用
- **文件:行**: `src/lib/crawl/suggest.ts:199-200`
- **描述**: `cacheRead` 直接返回 `entry.value` (缓存数组引用). 若调用方 mutate 数组(`.push()/.sort()/.splice()`), 缓存被污染. 当前所有调用方(`fetchSuggestKeywordsForBook`/`generatePSEOKeywords`/`generatePSEOKeywordsAsync`)都不 mutate 返回值, 全部直接传给 `ok()`/`withCache()` 经 JSON 序列化(序列化不 mutate 原数组). 客户端拿到的是反序列化的新对象, 不影响服务端缓存.
- **不修复原因**: 当前无 mutate 路径, 加 `.slice()` 浅拷贝属防御性编程, 但开销(虽小)与收益(防未来误用)trade-off 不明显, 不在"只修真实 bug"范围. 若未来有调用方需 mutate, 应在调用方 clone 而非 cache 层.

### N4. obscura.ts applyThinkTime / fetchHttp / curl 子进程 — 大量 setTimeout 无 unref
- **文件:行**: `src/lib/crawl/fetcher.ts:2763`, `3053` 等
- **描述**: fetchHttp 的 `timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)` 无 unref, 但在 finally 块 clearTimeout, 主流程能正常退出. CLI 测试脚本中可能短暂阻塞. 
- **不修复原因**: finally 块已 clearTimeout, 主流程无泄漏. CLI 测试脚本中 await 会等 Promise resolve, 不阻塞.

### N5. hostgate.ts acquireHostGate — Waiter.timer / gapTimer / penaltyTimer 均已 unref
- **文件:行**: `src/lib/crawl/hostgate.ts:388`, `276`, `289`
- **描述**: 三个定时器均有 `.unref?.()` 调用, 已正确处理.
- **不修复原因**: 已正确实现, 无需修改.

### N6. runner.ts 范围续采 R7-29 已实现 DB 双重校验
- **文件:行**: `src/lib/crawl/runner.ts:722-734`, `802-823`
- **描述**: R7-29 已实现 `discoveredBookUrls`/`completedBookUrls` 在内存 Set 命中后, 再查 DB 确认书确实存在且有章节(避免用户删除后 progress 仍记录导致跳过). 实现正确, 无 bug.
- **不修复原因**: 已正确实现.

### N7. runner.ts bannedWords R7-26 已实现
- **文件:行**: `src/lib/crawl/runner.ts:1116-1130`
- **描述**: R7-26 已实现违禁词检查书名/简介/作者, mask 模式只过滤不跳过, 跳过模式 return 'ok'. 实现正确, 无 bug.
- **不修复原因**: 已正确实现.

### N8. fetcher.ts 5 级降级链已完整
- **文件:行**: `src/lib/crawl/fetcher.ts` (整体)
- **描述**: 5 级降级链已完整实现:
  1. native fetch (Bun/node, 含 keep-alive 池)
  2. curl 子进程 (OpenSSL TLS 指纹, 跨平台)
  3. fetch-relay 中继桥 (Bun 运行时 TLS 指纹, node+proxy 场景)
  4. scrapling-bridge (curl_cffi/stealthy/playwright 三模式)
  5. obscura (--stealth 浏览器) + 裸 Playwright 降级
- 每级失败均有降级路径, 不双发, 错误对象保留 status/bodyHtml/retryAfterMs 等.
- **不修复原因**: 已正确实现, 无 bug.

### N9. fetcher.ts SSRF 守卫完整
- **文件:行**: `src/lib/crawl/fetcher.ts:2110-2138`
- **描述**: `assertSafeTarget` 实现完整: 协议白名单 / localhost 豁免 / IP 字面量直接判范围 (含 IPv4-mapped IPv6) / 域名 DNS 全地址解析逐个判黑名单 / 60s DNS 缓存 + 2000 上限 FIFO. 已知限制 DNS rebinding TOCTOU 已记录.
- **不修复原因**: 已正确实现.

### N10. obscura.ts Playwright browser/context/page 资源清理
- **文件:行**: `src/lib/crawl/obscura.ts` (整体)
- **描述**: 槽位页面池设计完整:
  - `createSlot` newPage 失败时 `ctx.close()` 防泄漏
  - `recreateSlot` newPage 失败时 `ctx.close()` 防泄漏, 连续 3 次失败移除槽位
  - `withObscuraPage` finally 块释放 busy 标志 + 唤醒等待者
  - `shutdownObscura` 清 idleTimer + reclaimTimer + 所有 slots ctx.close + browser.close
  - 进程退出钩子注册(SIGINT/SIGTERM/exit)
  - 心跳回收定时器(60s 扫, 10min 未用 close ctx 释放资源)
- **不修复原因**: 已正确实现, 无资源泄漏.

### N11. hostgate.ts 并发槽位释放
- **文件:行**: `src/lib/crawl/hostgate.ts` (整体)
- **描述**: 计账式释放设计完整:
  - `releaseHostGate` 仅 `inFlight--` + `pump` 复查, 不"递给"特定等待者(防 barge)
  - FIFO 等待队列 + 30s 超时 + unref
  - 节流到点 (gapTimer) + 限流冷却 (penaltyTimer) 单一定时器, 重复先 clear 再设
  - LRU/容量治理: HOSTS_CAP=1000 + SWEEP_EVERY=100 + evictOneIdleHost
  - hostGateReset 显式 reject 所有 waiter + 清 timer
- **不修复原因**: 已正确实现.

### N12. runner.ts 任务进度原子写入
- **文件:行**: `src/lib/crawl/runner.ts:216-231` (`serializeStatusWrite`)
- **描述**: per-task 状态写串行化链 (`dbStatusChains`) 防并发 control 的 SQLite 写序乱序. `next` propagate 错误给 await 调用方, `tail` catch 吞错保链不断. settle 后自删 Map 项防无界增长.
- **不修复原因**: 已正确实现.

### N13. parser.ts 翻页陷阱 R-P
- **文件:行**: `src/lib/crawl/parser.ts` (parseToc/parseContent 翻页注入)
- **描述**: `FetchConfig.pageFetch` 回调注入让 parser 翻页也走 gateFetch (hostgate 闸门 + minGapMs 节流), runner.ts line 1290-1297 注入. 翻页请求与章节抓取同享账本, 无 SSRF/限流漏洞.
- **不修复原因**: 已正确实现.

### N14. SEO 模板 R10-1C
- **文件:行**: `src/components/public/BookView.tsx` (seo 渲染) + `src/components/public/ReadView.tsx:71-82` (`renderSeoTemplate`)
- **描述**: `data.seo.auto=false` 时走 `chapterSeoTitleTemplate/DescTemplate/KeywordsTemplate` 模板占位符替换; `auto=true` 走 `generateTDK` 自动模式. BookView 与 ReadView 同口径.
- **不修复原因**: 已正确实现.

## 修改文件清单

1. `src/lib/crawl/suggest.ts` — P1 fix (line 343-350: 仅缓存非空结果) + P2 fix (line 227-235: 新增 `clearPSEOCacheForBook`)
2. `src/app/api/admin/books/[id]/pseo/route.ts` — P2 fix (line 64-70: 用 `clearPSEOCacheForBook` 替代 `clearPSEOCache`)
3. `src/components/public/KeywordView.tsx` — P2 fix (line 60-79: `fetchRelatedKeywords` 链加 `.catch`)
4. `src/components/public/BookView.tsx` — P2 fix (line 88-96: TocChapterButton useEffect cleanup)

## 验证

```
$ bunx tsc --noEmit (排除 examples/skills)
0 errors ✓

$ bun run lint
$ eslint .
0 errors / 0 warnings ✓
```

## 修复数量统计

- **P0**: 0 个 (无新发现 P0 级 bug; 历经多轮修复后代码已无明显 P0 漏洞)
- **P1**: 1 个 (suggest.ts PSEO 缓存空数组死锁)
- **P2**: 4 个 (suggest.ts clearPSEOCacheForBook + pseo/route.ts 精确清缓存 + KeywordView.tsx catch + BookView.tsx useEffect cleanup)
- **未修复**: 14 个 (代码可读性/已正确实现/防御性编程不在"只修真实 bug"范围)
