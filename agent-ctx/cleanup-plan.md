# R13-1D 代码清理整合优化计划

> Task ID: R13-1D | 主控(本会话续作) | 2026-09-15

## 1. 目录审计 (确认全部活文件)

### 1.1 HomeClone*.tsx (10 个, 全部接入 HomeView.tsx dynamic import)

| 文件 | HomeView 分发 | 状态 |
|---|---|---|
| HomeCloneAijjxs.tsx | clone-aijjxs | ✓ 活 |
| HomeCloneDdyueshu.tsx | clone-ddyueshu | ✓ 活 |
| HomeClonePilishuwu.tsx | clone-pilishuwu | ✓ 活 |
| HomeClone23qb.tsx | clone-23qb | ✓ 活 |
| HomeClone101kks.tsx | clone-101kks | ✓ 活 |
| HomeCloneHuangjinwu.tsx | clone-huangjinwu | ✓ 活 |
| HomeCloneGgd66.tsx | clone-ggd66 | ✓ 活 |
| HomeCloneShipsay.tsx | clone-shipsay | ✓ 活 |
| HomeCloneX2552.tsx | clone-x2552 | ✓ 活 |
| HomeCloneTrxsw.tsx | clone-trxsw | ✓ 活 (R13-1B 恢复) |

### 1.2 ReadClassic/ReadImmersive/ReadPaginated/ReadPili (4 个, 全部接入 ReadView.tsx)

ReadView.tsx 行 597-639 按 readOf(theme).layout 分发至 4 个 read-layouts 子组件, 全部活。

### 1.3 Admin 组件 (29 个, 全部接入 AdminApp.tsx 直接或间接)

AdminApp.tsx 顶层 import 13 个 Section 组件 + LoginGate (在 page.tsx 用)。
其余 14 个组件 (BookDetail/CalibrateDialog/ConfirmDialog/DebugHtmlViewer/FieldRuleEditor/HealthCard/RuleEditor/RuleTemplateDialog/StepIndicator/TaskDialog/TaskLogViewer/TaskMonitor/TaskWizard/TestPanel + batch.tsx/dashboardCards.ts/helpers.ts) 通过子组件级联引用, 全部活。

### 1.4 API 路由 (admin 39 + public 13 + auth 3 + _lib 2 = 57 个文件, 全部活)

admin/* 全部由 src/components/admin/* 客户端调用或管理端拉取。
public/* 全部由 src/components/public/* 客户端调用, sitemap 由 next.config.ts/pseudostatic.ts 重写, mini-service-config 由 admin/settings 间接调用。
无废弃 API 路由。

### 1.5 mini-services (7 个, 全部活)

| 服务 | 端口 | PID 文件 | 健康检查 |
|---|---|---|---|
| bqg713-proxy | 3010 | .zscripts/bqg713-proxy.pid | ✓ 200 |
| fetch-relay | 3011 | .zscripts/fetch-relay.pid | ✓ 200 |
| scrapling-bridge | 3012 | .zscripts/scrapling-bridge.pid | ✓ 200 |
| qimao-proxy | 3013 | .zscripts/qimao-proxy.pid | ✓ 200 |
| deqixs-proxy | 3014 | .zscripts/deqixs-proxy.pid | ✓ 200 |
| xjp-proxy | 3015 | .zscripts/xjp-proxy.pid | ✓ 200 |
| moli-bridge | 3017 | .zscripts/moli-bridge.pid | ✓ 200 (实测健康) |

**注意**: start-all.sh 第 30 行引用 `uc-bridge` 目录不存在 (端口 3016 留空), status.sh 第 18-25 行未包含 moli-bridge。这是已存在的脚本不一致, 不影响活代码, 暂不动。

## 2. 未使用文件 (建议归档 scripts/archive/, 不真删)

| 文件 | 大小 | 理由 |
|---|---|---|
| scripts/test-themes-9.ts | 14 行 | 断言 `THEMES.length=9` + 9 个 ID (无 clone-trxsw)。R12-1 后 =9 成立, R13-1B 恢复 clone-trxsw 后 =10 → 断言失效, 不可再复跑 |
| scripts/fix-aijjxs-bookurl.ts | 41 行 | 一次性 DB 修复脚本 (修 toplist 规则 list.fields.bookUrl), 已应用到生产 DB, 不需再跑 |
| scripts/fix-aijjxs-toplist-toc.ts | 145 行 | 一次性 DB 修复脚本 (修 toplist 规则 toc 段 + 历史 task 脏 URL), 已应用, 不需再跑 |
| scripts/probe-all.ts | 119 行 | 一次性探针脚本 (抓 9 个站点 HTML/CSS 到 /home/z/probe/), 已抓取到 agent-ctx/probe-html2/, 不需再跑 |

> 不真删除, 主代理审核后再决定是否移动到 scripts/archive/。

## 3. 未使用 export 清单 (src/lib/crawl/)

### 3.1 真正死代码 (0 src + 0 active + 0 archive 引用, 可直接删除)

| 文件 | export | 行号 | 说明 |
|---|---|---|---|
| cleaner.ts | normalizeChapterNumber | 686-703 | R11-1A 新增"章节序号归一化供排序/去重", 但 sorter.ts 有更强大的 extractChapterNo/cnNumToNumber (支持万/亿), 此 export 从未被消费 |
| cleaner.ts | cnNumToInt (helper) | 662-684 | normalizeChapterNumber 的私有 helper, 随之删除 |
| cleaner.ts | CN_NUM_MAP (常量) | 657-660 | cnNumToInt 用, 随之删除 |
| fetcher.ts | verifyFingerprintConsistency | 1562-1641 | 81 行 UA↔Client Hints 一致性诊断函数, 全域 0 引用 |
| fetcher.ts | detectSiteType | 1650+ | 站点类型探测, "agent-Z-crawl-phase6 智能引擎选择"特性, 全域 0 引用 |
| fetcher.ts | recommendEngineForSite | 1704+ | 与 detectSiteType 配套, 全域 0 引用 |
| fetcher.ts | responseCacheSnapshot | 3970 | 调试用快照导出, 全域 0 引用 (inflightMap.snapshot 同款, 仅 archive 用) |
| fetcher.ts | clearResponseCache | 3979 | 调试用清缓存导出, 全域 0 引用 |

### 3.2 内部用但 export 多余 (de-export 即可, 不删函数, 风险最低)

| 文件 | export | 状态 |
|---|---|---|
| parser.ts | extractMetaTags | 仅 parser 内部用 (line 1072) |
| parser.ts | extractJsonLd | 仅 parser 内部用 (line 1073, 1335) |
| parser.ts | extractTable | 仅 parser 内部用 (line 297, 860) |
| sorter.ts | romanToNumber | 仅 sorter 内部用 (line 43, 130) |
| obscura.ts | isMobileUaLocal | 仅 obscura 内部用 (line 166, 244) |
| storage.ts | DownloadTxtWriter (interface) | 仅 storage 内部用 (line 140 return 类型) |
| smart.ts | matchCategoryByText | 仅 smart 内部用 (line 64) |
| hostgate.ts | HOST_GATE_DEFAULT_LIMIT / MIN_LIMIT / MAX_LIMIT / WAIT_TIMEOUT_MS / RATE_LIMIT_DEFAULT_MS / RATE_LIMIT_MAX_MS | 仅 hostgate 内部用 (常量定义) |
| hostgate.ts | normalizeIpLiteral | 仅 hostgate 内部用 (isPrivateIp 内部调) |
| hostgate.ts | isPrivateIp | 仅 hostgate 内部用 (注释声称 fetcher.ts assertSafeTarget 调用, 但实际未调用 - 注释过时) |

> de-export 风险极低, 但工作量较大且收益小, **本任务不动** (留作后续小步重构)

## 4. 重复逻辑分析

### 4.1 keywords/route.ts vs pseo/route.ts (无重复调用)

- keywords/route.ts 调用 `fetchSuggestKeywords(kw)` + `mergeSuggestWords(kw, results, limit)` → 单关键词 suggest 聚合
- pseo/route.ts 调用 `generatePSEOKeywordsAsync(name, author, category, limit)` → 内部对 5 个查询词跑 7 引擎聚合 (内部调 `fetchSuggestKeywordsForBook`)

**两者服务不同目的, 无重复 suggest 调用**。

### 4.2 pseo/route.ts 本地模板 vs suggest.ts generatePSEOKeywords (轻微重复)

`/api/admin/books/[id]/pseo/route.ts` 的 `generateLocalPSEOTemplate` 函数 (115-151) 与 `src/lib/crawl/suggest.ts` 的 `generatePSEOKeywords` 函数 (381-429) 在本地模板生成逻辑上重复, 但有差异:

- route 版: 不读缓存, 不过滤低质量词 (兜底立即返回)
- suggest 版: 读缓存, 过滤低质量词 (`isLowQualityKeyword`)

**重构会改变兜底行为** (兜底分支也会过滤低质量词), 违反"不能修改业务逻辑"约束, **本任务不动**, 仅记录。

### 4.3 fetcher.ts vs downloader.ts (无重复)

- fetcher.ts: HTTP 抓取 (`fetchPage`/`fetchBinary` + cookieJar/SSRF/proxy)
- downloader.ts: TXT 文件生成 (`generateBookTxt` + 混淆/广告/站点信息注入)

**完全不同职责, 无重复 `fetchBinary`**。

## 5. 过时注释清单

### 5.1 主题计数过时 (R12-1 删 trxsw 时改为 9, R13-1B 恢复后实际为 10)

| 文件 | 行号 | 当前 | 应改为 |
|---|---|---|---|
| src/components/admin/ThemesSection.tsx | 4 | "9 套精仿真实小说站点主题 (R10-1A 重构)" | "10 套精仿真实小说站点主题" |
| src/components/admin/ThemesSection.tsx | 113 | "9 套站点精仿主题; 默认站点: ..." | "10 套站点精仿主题; 默认站点: ..." |
| src/components/public/HomeView.tsx | 20 | "R10-1A: 9 个精仿真实小说站点首页布局, 懒加载分包" | "10 个精仿真实小说站点首页布局, 懒加载分包" |

### 5.2 hostgate.ts 误导性注释 (声称 fetcher 调用, 实际未调用)

| 文件 | 行号 | 当前注释 | 问题 |
|---|---|---|---|
| src/lib/crawl/hostgate.ts | 644-647 | "fetcher.ts assertSafeTarget 直接使用 resolveAllIps + isPrivateIp 组合防 SSRF, IP 字面量归一化在 assertSafeIp 内通过 normalizeIpLiteral 完成" | fetcher.ts assertSafeTarget 实际用 `assertSafeIp` (本地实现), **未调用 hostgate.isPrivateIp / normalizeIpLiteral**。注释过时, 误导 |

### 5.3 parser.ts 未使用参数 m (TS6133 警告)

| 文件 | 行号 | 问题 |
|---|---|---|
| src/lib/crawl/parser.ts | 715 | `(m, key: string)` 中 `m` 全匹配变量未使用 (TS6133 --noUnusedParameters 触发)。改 `(m, key)` → `(_m, key)` 或 `(_, key)` |

## 6. 未使用 import (tsc --noUnusedLocals)

`bunx tsc --noEmit --noUnusedLocals` 在 src/ 与 scripts/ 全域 0 警告 (排除 examples/skills)。
仅 `--noUnusedParameters` 触发 1 处: parser.ts:715 `m` 未使用 (见 §5.3)。

## 7. 性能热点审计 (无明显问题)

| 热点 | 当前实现 | 评估 |
|---|---|---|
| fetcher.ts inflightMap | Map<string, Promise> + INFLIGHT_MAX_ENTRIES=500 + LRU 驱逐 | ✓ 合理 (并发去重上限防内存膨胀) |
| fetcher.ts responseCache | Map<string, FetchResult> + RESPONSE_CACHE_MAX=200 + TTL 驱逐 | ✓ 合理 |
| fetcher.ts cookieJar | 按 origin 分罐 Map, 无上限 (受域名数限制) | ✓ 合理 (小说站域名数有限) |
| hostgate.ts hostGateMap | SWEEP_MAX + SWEEP_EVERY 惰性清理 | ✓ 合理 |
| parser.ts cheerio.load | parseList/parseBook 各 1 次, parseToc/parseContent 按 scope 复用 $ | ✓ 无重复 load |
| HomeView.tsx dynamic import | 10 个 HomeClone* 全部 dynamic() 懒加载 | ✓ 合理 (按 layout 实际命中加载) |
| public/books/route.ts 分页 | Promise.all([count, findMany]) + include category | ✓ 无 N+1 |

无过度优化空间。

## 8. 落地修改清单 (本任务执行)

### 8.1 删除真正死代码 (cleaner.ts)

- 删除 `normalizeChapterNumber` 函数 (cleaner.ts:686-703, ~18 行)
- 删除 `cnNumToInt` helper (cleaner.ts:662-684, ~23 行)
- 删除 `CN_NUM_MAP` 常量 (cleaner.ts:657-660, ~4 行)
- 删除 `normalizeChapterNumber` 文档注释 (cleaner.ts:638-656, ~19 行)
- 合计 ~64 行 dead code

### 8.2 删除真正死代码 (fetcher.ts)

- 删除 `verifyFingerprintConsistency` 函数 (fetcher.ts:1562-1641, ~80 行)
- 删除 `detectSiteType` 函数 + 配套注释 (fetcher.ts:1643-1703, ~60 行)
- 删除 `recommendEngineForSite` 函数 (fetcher.ts:1704-1762, ~60 行)
- 删除 `responseCacheSnapshot` 函数 (fetcher.ts:3970-3978, ~9 行)
- 删除 `clearResponseCache` 函数 (fetcher.ts:3979-3993, ~15 行)
- 删除配套 `SiteType` 类型 (fetcher.ts:1643)
- 合计 ~225 行 dead code

### 8.3 修复过时注释

- ThemesSection.tsx:4 / :113 → 9 套改为 10 套
- HomeView.tsx:20 → 9 个改为 10 个
- hostgate.ts:644-647 → 修正"fetcher.ts assertSafeTarget 直接使用 resolveAllIps + assertSafeIp" (移除 isPrivateIp/normalizeIpLiteral 误导)

### 8.4 修复 TS6133 (parser.ts)

- parser.ts:715 → `(m, key: string)` 改为 `(_, key: string)`

### 8.5 scripts/ 归档 (主代理审核后再执行, 本任务不真移动)

仅记录于本 cleanup-plan.md, 等主代理批准后再 mv 到 scripts/archive/:
- scripts/test-themes-9.ts → scripts/archive/test-themes-9.ts (断言失效)
- scripts/fix-aijjxs-bookurl.ts → scripts/archive/fix-aijjxs-bookurl.ts (一次性已应用)
- scripts/fix-aijjxs-toplist-toc.ts → scripts/archive/fix-aijjxs-toplist-toc.ts (一次性已应用)
- scripts/probe-all.ts → scripts/archive/probe-all.ts (一次性已抓取)

## 9. 验证步骤

1. `cd /home/z/my-project && bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | tail -10` — 期望 0 errors
2. `cd /home/z/my-project && bun run lint 2>&1 | tail -5` — 期望 0 errors / 0 warnings
3. 追加 R13-1D 记录到 worklog.md

## 10. 不修改的内容 (尊重约束)

- ❌ 不删除任何活代码 (仅删 §3.1 中的 dead code)
- ❌ 不改变函数签名 (向后兼容)
- ❌ 不修改业务逻辑 (兜底分支/排序/清洗等行为完全不变)
- ❌ 不回滚 R13-1A/B/C 子代理的修改 (suggest.ts PSEO/cache/pseo/route.ts clearPSEOCacheForBook/KeywordView.tsx .catch/BookView.tsx useEffect cleanup 全部保留)
- ❌ 不真删除 scripts/ 下任何文件 (仅记录到本计划)
