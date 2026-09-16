# R14-1C 代码清理整合优化计划

> Task ID: R14-1C | 主控(本会话续作) | 2026-09-15
> 范围: scripts/ 49 个 ts + src/components/public/layouts/ 10 个 HomeClone*.tsx + read-layouts/ 4 个
> Read*.tsx + BookInfoLayout.tsx 10 套 BookInfo 变体 + src/lib/crawl/ 12 模块 + admin/public API
> 57 个路由 + mini-services/ 7 个服务 + src/components/admin/ 29 个组件

## 1. 目录审计 (全部活文件, 无新增废弃)

### 1.1 HomeClone*.tsx (10 个, 全部接入 HomeView.tsx dynamic import — R13-1D 已确认)

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
| HomeCloneTrxsw.tsx | clone-trxsw | ✓ 活 |

**重复逻辑审计**: 10 个 HomeClone*.tsx 结构高度差异化 (每套精仿原站 header/nav/cards/sections DOM),
CloneSkeleton/QbSecTitle/GgdSecTitle/... 等子组件均为各站特有, 无可抽取的共同逻辑 (与 BookInfoLayout
不同, 后者 7 套 DOM 共享作者/分类/状态 meta 行)。

### 1.2 ReadClassic/ReadImmersive/ReadPaginated/ReadPili (4 个, 全部接入 ReadView.tsx — R13-1D 已确认)

ReadView.tsx 按 readOf(theme).layout 分发至 4 个 read-layouts 子组件, 全部活。

### 1.3 Admin 组件 (29 个, 全部接入 AdminApp.tsx 直接或间接 — R13-1D 已确认)

AdminApp.tsx 顶层 import 13 个 Section 组件。其余 14 个组件 (BookDetail/CalibrateDialog/ConfirmDialog/
DebugHtmlViewer/FieldRuleEditor/HealthCard/RuleEditor/RuleTemplateDialog/StepIndicator/TaskDialog/
TaskLogViewer/TaskMonitor/TaskWizard/TestPanel + batch.tsx/dashboardCards.ts/helpers.ts) 通过子组件级联
引用, 全部活。

### 1.4 API 路由 (admin 39 + public 13 + auth 3 + _lib 2 = 57 个文件, 全部活 — R13-1D 已确认)

admin/* 由 src/components/admin/* 客户端调用。public/* 由 src/components/public/* 客户端调用。
无废弃 API 路由。

### 1.5 mini-services (7 个, 全部活 — R13-1D 已确认)

| 服务 | 端口 | 启动脚本 | 状态 |
|---|---|---|---|
| bqg713-proxy | 3010 | start-all.sh ✓ | ✓ 活 |
| fetch-relay | 3011 | start-all.sh ✓ | ✓ 活 |
| scrapling-bridge | 3012 | start-all.sh ✓ | ✓ 活 |
| qimao-proxy | 3013 | start-all.sh ✓ | ✓ 活 |
| deqixs-proxy | 3014 | start-all.sh ✓ | ✓ 活 |
| xjp-proxy | 3015 | start-all.sh ✓ | ✓ 活 |
| moli-bridge | 3017 | start-all.sh ✓ | ✓ 活 (status.sh 未列出, 已知不一致) |

**未修复的不一致** (R13-1D 已记录, 不在本任务范围):
- start-all.sh:30 引用 uc-bridge (端口 3016, 目录不存在) — 留作后续小修
- status.sh:18-25 未包含 moli-bridge — 留作后续小修

## 2. 已删除的 Dead Code (R14-1C 本任务执行)

### 2.1 src/components/public/BookCard.tsx — 删除未使用的 BookLine + BookPoster

| export | 行号(原) | 引用方 | 状态 |
|---|---|---|---|
| BookLine | 53-90 | 0 外部引用, 0 内部引用 | ✗ dead code, 已删 |
| BookPoster | 93-119 | 0 外部引用, 0 内部引用 | ✗ dead code, 已删 |

**清理说明**:
- 全域 `rg "BookLine|BookPoster" src/ scripts/ mini-services/ tests/` 仅命中定义行
- BookCard.tsx 行数 166 → 97 (-69 行, 含 imports 清理: 移除 Clock3)
- 头部注释更新: "主题化书籍卡片 / 行 / 海报 / 通用结果列表" → "主题化书籍卡片 / 通用结果列表"
- ThemeBookList / ReadFirstButton / BookCard 均保留 (R12-1 ThemeBookList 内部用 BookCard 渲染)

### 2.2 src/lib/crawl/fetcher.ts — 删除未使用的 hostDispatcherSnapshot

| export | 行号(原) | 引用方 | 状态 |
|---|---|---|---|
| hostDispatcherSnapshot | 1517-1524 | 0 外部引用, 0 内部引用 | ✗ dead code, 已删 |

**清理说明**:
- 注释声称"供 admin/snapshot 端点 + 测试脚本", 但 admin/snapshot 端点不存在, 测试脚本不调用
- 全域 `rg "hostDispatcherSnapshot" src/ scripts/` 仅命中定义行
- fetcher.ts 行数 4527 → 4507 (-20 行, 含 hostDispatcherSnapshot 8 行 + 2 处 R13-1D 残留注释块 12 行)

### 2.3 src/lib/crawl/fetcher.ts — 清理 R13-1D 残留注释 (描述已删功能)

| 残留注释 | 行号(原) | 内容 | 处理 |
|---|---|---|---|
| 注释块 | 1551-1557 | "agent-Z-crawl-phase6: 指纹一致性校验 + 智能引擎选择 (dead code, 全域 0 引用, 已删除) — verifyFingerprintConsistency / detectSiteType / recommendEngineForSite / SiteType 三个未消费 export 已删除 (R13-1D 清理)。" | ✗ 描述已删功能, 删除 |
| 单行注释 | 3826-3827 | "R13-1D 清理: responseCacheSnapshot / clearResponseCache 调试导出已删除 (全域 0 引用)" | ✗ 描述已删功能, 删除 |

**清理说明**: 任务约束 §"简化过时注释" 明确要求删除"描述已废弃功能的注释"。

## 3. 重复逻辑合并 (R14-1C 本任务执行)

### 3.1 src/components/public/BookInfoLayout.tsx — 提取 BookInfoMeta 共享组件

**重复模式** (R14-1A 已用 ActionButtons/BookMetaLine/CoverWithHalo/usePanelStyle 共享外壳, 但 7 套
DOM 变体的"作者/分类/状态/字数/更新时间"meta 行仍重复):

| 变体 | 行号(原) | wrapper class | 作者前缀 | 分类按钮形状 | 日期标签 |
|---|---|---|---|---|---|
| BookInfoAijjxs | (不参与, 用 .kv 块结构) | - | - | - | - |
| BookInfoDdyueshu | 217-232 | (无) | "作者：" | rounded px-2 py-0.5 | 更新于 |
| BookInfoPilishuwu | 263-278 | (无) | "作者：" | rounded-full px-2.5 py-0.5 | 更新于 |
| BookInfo23qb | 309-324 | (无) | "作者：" | rounded-full px-2.5 py-0.5 | 更新于 |
| BookInfo101kks | 355-370 | "labelbox" | "作者：" | rounded-full px-2.5 py-0.5 | 更新於 |
| BookInfoHuangjinwu | 401-416 | (无) | "作者：" | rounded-full px-2.5 py-0.5 | 更新于 |
| BookInfoGgd66 | (委托 BookInfo23qb, 不参与) | - | - | - | - |
| BookInfoShipsay | 455-470 | (无) | "作者：" | rounded-full px-2.5 py-0.5 | 更新于 |
| BookInfoX2552 | (委托 BookInfo23qb, 不参与) | - | - | - | - |
| BookInfoTrxsw | 513-531 | "author" | (无) | rounded-full px-2.5 py-0.5 | 更新于 |

**BookInfoMeta 接口** (新增, 行 117-157):

```tsx
function BookInfoMeta({
  book,
  onGoCategory,
  wrapperClassName = '',         // Trxsw 用 "author", 101kks 用 "labelbox"
  authorLabel = '作者：',         // Trxsw 无前缀传 ""
  categoryShape = 'rounded-full', // Ddyueshu 用 "rounded"
  dateLabel = '更新于',           // 101kks 用繁体 "更新於"
}: { ... }) { ... }
```

**调用点** (7 处替换):

| 变体 | 调用 |
|---|---|
| BookInfoDdyueshu | `<BookInfoMeta book={book} onGoCategory={onGoCategory} categoryShape="rounded" />` |
| BookInfoPilishuwu | `<BookInfoMeta book={book} onGoCategory={onGoCategory} />` |
| BookInfo23qb | `<BookInfoMeta book={book} onGoCategory={onGoCategory} />` |
| BookInfo101kks | `<BookInfoMeta book={book} onGoCategory={onGoCategory} wrapperClassName="labelbox" dateLabel="更新於" />` |
| BookInfoHuangjinwu | `<BookInfoMeta book={book} onGoCategory={onGoCategory} />` |
| BookInfoShipsay | `<BookInfoMeta book={book} onGoCategory={onGoCategory} />` |
| BookInfoTrxsw | `<BookInfoMeta book={book} onGoCategory={onGoCategory} wrapperClassName="author" authorLabel="" />` |

**收益**: BookInfoLayout.tsx 行数 562 → 506 (-56 行, 含 BookInfoMeta ~50 行新增 + 7 处 ~105 行替换 = -55 行净)
+ 视觉/DOM 完全等价 (各变体 wrapper/label/shape/dateLabel 参数化保留原站差异)。

### 3.2 R13-1D 已分析的重复逻辑 (本任务确认无需合并)

| 重复点 | R13-1D 结论 | R14-1C 复核 |
|---|---|---|
| keywords/route.ts vs pseo/route.ts suggest 调用 | 服务不同目的 (单关键词聚合 vs 5 查询词×7 引擎 PSEO 聚合), 无重复 | ✓ 仍无需合并 |
| pseo/route.ts 本地模板 vs suggest.ts generatePSEOKeywords | route 版无缓存无过滤 (兜底), suggest 版读缓存过滤低质量词 — 业务差异 | ✓ 仍无需合并 (合并会改兜底行为, 违反"不修改业务逻辑") |
| fetcher.ts vs downloader.ts fetchBinary | 完全不同职责 (HTTP 抓取 vs TXT 生成) | ✓ 仍无需合并 |

## 4. 未使用 export 候选清单 (src/lib/crawl/, 仅记录, 本任务不动)

### 4.1 R13-1D 已删的 dead export (确认无残留)

| 文件 | export | R13-1D 处理 | R14-1C 复核 |
|---|---|---|---|
| cleaner.ts | normalizeChapterNumber + cnNumToInt + CN_NUM_MAP | 已删 (-68 行) | ✓ 0 残留 |
| fetcher.ts | verifyFingerprintConsistency | 已删 | ✓ 0 残留 |
| fetcher.ts | detectSiteType + recommendEngineForSite + SiteType | 已删 | ✓ 0 残留 |
| fetcher.ts | responseCacheSnapshot + clearResponseCache | 已删 | ✓ 0 残留 |
| fetcher.ts | (R13-1D 残留注释块 1551-1557 + 3826-3827) | 未处理 | ✗ R14-1C 已删 (§2.3) |

### 4.2 R14-1C 新发现的 dead export (已删)

| 文件 | export | 引用方 | 处理 |
|---|---|---|---|
| fetcher.ts | hostDispatcherSnapshot | 0 外部 + 0 内部 | ✗ R14-1C 已删 (§2.2) |
| BookCard.tsx | BookLine | 0 外部 + 0 内部 | ✗ R14-1C 已删 (§2.1) |
| BookCard.tsx | BookPoster | 0 外部 + 0 内部 | ✗ R14-1C 已删 (§2.1) |

### 4.3 内部用但 export 多余 (de-export 候选, 不动 — R13-1D 同款决策)

| 文件 | export | 引用范围 | 决策 |
|---|---|---|---|
| parser.ts | extractMetaTags / extractJsonLd / extractTable | 仅 parser 内部 | 留作后续小步 de-export (R13-1D 同款决策) |
| sorter.ts | romanToNumber | 仅 sorter 内部 | 同上 |
| obscura.ts | isMobileUaLocal | 仅 obscura 内部 | 同上 |
| storage.ts | DownloadTxtWriter (interface) | 仅 storage 内部 | 同上 |
| smart.ts | matchCategoryByText | 仅 smart 内部 | 同上 |
| hostgate.ts | HOST_GATE_DEFAULT_LIMIT 等 6 个常量 + normalizeIpLiteral + isPrivateIp | 仅 hostgate 内部 | 同上 |
| fetcher.ts | clearPSEOCache | 0 实际调用 (仅注释提及) | 留作测试/手动刷新入口 |
| fetcher.ts | detectHttp3AltSvc / SCRAPLING_BROWSER_CONCURRENCY / isProxyCascadePaused / COOKIE_CONSENT_SELECTORS / acceptCookieConsent / clearSessionPersonality / closeAllHostDispatchers / isHostInCaptchaCooldown | 仅 fetcher 内部 | 同上 |
| auto-tdk.ts | extractKeywords / generateDescription / TDKResult | 仅 auto-tdk 内部 | 同上 |

> de-export 风险极低但收益小, R13-1D 已决定"留作后续小步重构", R14-1C 沿用此决策。

## 5. 过时注释清单

### 5.1 R13-1D 残留注释 (R14-1C 已删, 见 §2.3)

| 文件 | 行号(原) | 内容 | 处理 |
|---|---|---|---|
| fetcher.ts | 1551-1557 | 描述已删的 verifyFingerprintConsistency/detectSiteType/recommendEngineForSite/SiteType | ✗ 删 |
| fetcher.ts | 3826-3827 | 描述已删的 responseCacheSnapshot/clearResponseCache | ✗ 删 |

### 5.2 R14-1A/B 历史链 (保留, 有信息价值)

| 文件 | 行号 | 内容 | 决策 |
|---|---|---|---|
| themes.ts | 2-31 | R10-1A → R14-1A 历史链 (chronicle) | ✓ 保留 |
| HomeView.tsx | 1-9, 21-22, 173 | R10-1A → R14-1A 历史链 | ✓ 保留 |
| BookView.tsx | 1-7, 624-625 | R12-1 → R14-1A 历史链 | ✓ 保留 |
| BookInfoLayout.tsx | 1-15 | R14-1A 10 套 DOM 来源说明 | ✓ 保留 |
| ThemesSection.tsx | 4 | R13-1B 含 clone-trxsw | ✓ 保留 |
| admin/themes/route.ts | 4 | R13-1B THEMES 数组扩为 10 套 | ✓ 保留 |

### 5.3 R12-1 "9 套" 历史计数 (保留, 是 R12-1 时点状态描述)

| 文件 | 行号 | 内容 | 决策 |
|---|---|---|---|
| BookView.tsx | 3-4 | "R12-1: 清理 pili/aurora/... 旧主题分支; clone-* 9 套主题统一走默认渲染分支" | ✓ 保留 (R12-1 时点确为 9 套, R13-1B 后才扩为 10) |
| BookView.tsx | 662 | "R12-1: 标签云 (移除 theme.id !== 'pili' 条件, 9 套 clone-* 主题统一渲染)" | ✓ 保留 |
| BookView.tsx | 678 | "R12-1: 移除 pili 橙色 tab 头分支, 9 套 clone-* 主题统一走 SecTitle" | ✓ 保留 |
| BookCard.tsx | 55 | "R10-1A: 9 套精仿主题均使用同样的通用卡片网格 (BookCard)" | ✓ 保留 |

> 决策依据: R13-1D 已更新"当前状态计数" (ThemesSection/HomeView 等), 但保留 R-task 时点 chronicle。

## 6. 未使用 import (tsc --noUnusedLocals --noUnusedParameters)

```
$ bunx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1 | grep -v "examples\|skills"
(empty)
```

src/ 与 scripts/ 全域 0 警告 (R13-1D 已修复 parser.ts:715 TS6133, R14-1C 无新警告)。

## 7. 性能热点审计 (无明显新问题, R13-1D 已审计)

| 热点 | 当前实现 | 评估 |
|---|---|---|
| fetcher.ts inflightMap | entry 引用对比 + LRU 驱逐 (R14-1B fix TOCTOU race) | ✓ 合理 |
| fetcher.ts responseCache | 200 entries + TTL 驱逐 (R13-1D 已删调试 export) | ✓ 合理 |
| fetcher.ts tokenInflight | entry 引用对比 (R14-1B fix TOCTOU race) | ✓ 合理 |
| fetcher.ts cookieJar | 按 origin 分罐 Map (受域名数限制) | ✓ 合理 |
| hostgate.ts hostGateMap | SWEEP_MAX + SWEEP_EVERY 惰性清理 | ✓ 合理 |
| parser.ts cheerio.load | parseList/parseBook 各 1 次, parseToc/parseContent 按 scope 复用 $ | ✓ 无重复 load |
| HomeView.tsx dynamic import | 10 个 HomeClone* 全部 dynamic() 懒加载 | ✓ 合理 |
| public/books/route.ts 分页 | Promise.all([count, findMany]) + include category | ✓ 无 N+1 |
| runner.ts control() 30s timer | try/finally clearTimeout (R14-1B fix timer 泄漏) | ✓ 合理 |
| BookInfoLayout.tsx BookInfoMeta | 7 处共享 (R14-1C 合并) | ✓ 减少重复渲染节点 (无运行时差异) |

无过度优化空间。

## 8. 落地修改清单 (R14-1C 本任务执行)

### 8.1 删除 dead code (BookCard.tsx)

- 删除 `BookLine` 函数 (原 53-90, ~38 行)
- 删除 `BookPoster` 函数 (原 93-119, ~27 行)
- 删除 imports `Clock3` (BookLine 内部用)
- 删除 imports `fmtDate` (BookLine 内部用, BookCard 不用)
- 头部注释: "卡片 / 行 / 海报 / 通用结果列表" → "卡片 / 通用结果列表"
- 加 R14-1C 清理标记注释
- 合计 -69 行

### 8.2 删除 dead code (fetcher.ts)

- 删除 `hostDispatcherSnapshot` 函数 (原 1517-1524, ~8 行)
- 删除 §5.1 R13-1D 残留注释块 (原 1551-1557, ~7 行)
- 删除 §5.1 R13-1D 残留单行注释 (原 3826-3827, ~2 行)
- 合计 -17 行 (含周边空行调整)

### 8.3 合并重复逻辑 (BookInfoLayout.tsx)

- 新增 `BookInfoMeta` 共享组件 (~50 行)
- 7 处替换 (Ddyueshu/Pilishuwu/23qb/101kks/Huangjinwu/Shipsay/Trxsw) 内联 meta 行 → BookInfoMeta 调用
- Trxsw R14-1B fix 注释压缩保留 (3 行替代原 5 行)
- 合计 -56 行 (562 → 506)

### 8.4 修改文件清单 (R14-1C 净改动)

| 文件 | 改动 | 行数变化 |
|---|---|---|
| src/components/public/BookCard.tsx | 删 BookLine + BookPoster + 调整 imports | 166 → 97 (-69) |
| src/lib/crawl/fetcher.ts | 删 hostDispatcherSnapshot + 删 2 处 R13-1D 残留注释 | 4527 → 4507 (-20) |
| src/components/public/BookInfoLayout.tsx | 新增 BookInfoMeta + 7 处替换 | 562 → 506 (-56) |
| **合计** | | **-145 行** |

## 9. scripts/ 归档计划 (主代理审核后再执行, 本任务不真移动)

### 9.1 已知 dead 脚本 (R13-1D 已列 4 个, R14-1C 新增 2 个)

| 文件 | 大小 | 理由 | R13-1D / R14-1C |
|---|---|---|---|
| scripts/test-themes-9.ts | 14 行 | 断言 THEMES.length=9 (R13-1B 后 =10, 断言失效) | R13-1D 已列 |
| scripts/fix-aijjxs-bookurl.ts | 41 行 | 一次性 DB 修复 (修 toplist 规则 list.fields.bookUrl), 已应用 | R13-1D 已列 |
| scripts/fix-aijjxs-toplist-toc.ts | 145 行 | 一次性 DB 修复 (修 toplist 规则 toc 段 + 历史 task 脏 URL), 已应用 | R13-1D 已列 |
| scripts/probe-all.ts | 119 行 | 一次性探针 (抓 9 站 HTML/CSS 到 /home/z/probe/), 数据已落 agent-ctx/probe-html2/ | R13-1D 已列 |
| scripts/fix-dd-b-stale-task.ts | 88 行 | 一次性 DB 修复 (清理 stale running 任务 id cmtdrcpqt0004mv4zmnl8b3t9), 已应用 | R14-1C 新增 |
| scripts/mock-novel-site.ts | 78 行 | mock 小说站 (端口 3030), 全域 0 spawn 引用 (仅 archive/README 提及) | R14-1C 新增 (低优先, 可留作手动测试) |

> 不真移动, 等主代理批准后再 mv 到 scripts/archive/。

### 9.2 活跃脚本 (49 个 ts, 不归档)

#### 9.2.1 种子脚本 (33 个, 全部活跃)

| 类别 | 文件 | 用途 |
|---|---|---|
| 单站种子 (22) | seed-rule-aijjxs/biqugetw/bqg713/kanunu8/shudugu/yybsw/hodei/daweixs/zxcs/iidcr/dafengdagengren/wuxiaworld/piaotia/jpxs123/book4/80ge/deqixs/xjp/qimao/fanqie/wanben/ratelimit-demo/pilishuwu/trxsw/fanqianxs.ts | 27 条规则入库 (import-all 调用) |
| 批量种子 (5) | seed-rules-v2 / seed-rules-batch-v2 / seed-rules-import-all / seed-batch2-latest-rules / seed-rule-homepage-latest-batch1.ts | 批量入库 |
| 顶层入口 (1) | seed.ts | DB 初始化入口 |
| 导出工具 (1) | export-autofill-rules.ts | Docker autofill 规则清单生成 (依赖 4 个 seed-rule-*.ts) |

#### 9.2.2 验证脚本 (8 个, 全部活跃)

| 文件 | 用途 |
|---|---|
| verify-ab-b-ratelimit.ts | 反反爬 Retry-After/速率节流回归断言 (回环不出网) |
| verify-ab-c-apply.ts | calibrate/apply 路由实装 + 校准链路回归断言 (dev server 实测) |
| verify-all-rules-quick.ts | 全量规则列表段快速回归 (8s 超时) |
| verify-kk-b-docker.ts | Docker 交付物静态结构断言 (交付机无 docker) |
| verify-ll-a-docker.ts | Docker 全家桶静态断言矩阵 (无 docker 环境复跑) |
| verify-ss-a-docker.ts | Docker 全家桶+autofill 静态断言 (8 个段) |
| verify-zz-a-calibrate.ts | calibrate.ts 三阶段探测协议回归断言 (spawn ratelimit-site.ts) |
| verify-zz-all-rules.ts | 全量规则综合审计 (5 条随机深度测 + 清洗审计) |

#### 9.2.3 工具脚本 (3 个, 全部活跃)

| 文件 | 用途 |
|---|---|
| ratelimit-site.ts | 生产级限流模拟源站 (zz-a 校准系统配套, verify-zz-a-calibrate.ts spawn) |
| test-themes-r14.ts | R14-1A 主题验证 (10 套 preset + contentSelector) |

## 10. 验证步骤

1. `cd /home/z/my-project && bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | tail -10` — 期望 0 errors ✓
2. `cd /home/z/my-project && bunx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1 | grep -v "examples\|skills" | tail -10` — 期望 0 errors ✓
3. `cd /home/z/my-project && bun run lint 2>&1 | tail -5` — 期望 0 errors / 0 warnings ✓
4. `cd /home/z/my-project && bunx tsx scripts/test-themes-r14.ts` — 期望 THEMES.length=10, 10 个 ID 全部 OK ✓
5. 追加 R14-1C 记录到 worklog.md ✓

## 11. 不修改的内容 (尊重约束)

- ❌ 不删除任何活代码 (仅删 §2.1/§2.2 中的 dead code: BookLine/BookPoster/hostDispatcherSnapshot)
- ❌ 不改变函数签名 (向后兼容)
- ❌ 不修改业务逻辑 (BookInfoMeta 视觉/DOM 完全等价; 兜底分支/排序/清洗等行为完全不变)
- ❌ 不回滚 R13-1A/B/C/D + R14-1A/B 的修改 (suggest.ts PSEO/cache/pseo/route.ts clearPSEOCacheForBook/
  KeywordView.tsx .catch/BookView.tsx useEffect cleanup/fetcher.ts entry TOCTOU fix/runner.ts control timer/
  BookInfoLayout.tsx Trxsw <span> fix 全部保留)
- ❌ 不真删除 scripts/ 下任何文件 (仅记录到本计划)
- ❌ 不动 R13-1D 决定保留的 de-export 候选 (parser.ts/sorter.ts/obscura.ts/storage.ts/smart.ts/hostgate.ts 内部 export)
