# R34-1C 清理精简 + 整合优化

## Task ID: R34-1C
## Agent: full-stack-developer (清理精简+整合优化)
## Scope: dead code + 重复逻辑 + 复杂函数 + 过时注释 + 临时文件

---

## 步骤 1: 读交接文档

`tail -200 worklog.md` → R30-R33 历史:
- R30: 智能分类归一化 (normalizeCategory 把"玄幻小说"/"都市娱乐"合并到标准 14 分类)
- R31: 主题回源校准 + 并发架构 (Semaphore + crawlBookMeta/crawlChapterContent/finalizeBook)
- R32: 第六轮深度抓 bug + clone-themes 校准 + P1×4 (urls 去重 + failedBookUrls add/delete/resume)
- R33-1A: 系统审查 5 Set + globalQueue + saveProgress + resume 链路 (无 P1)
- R33-1B: 第七轮深度抓 bug, P1×4 + P2×1 (trafilaturaBridgeUrl 透传 / split(/\n+/) 段落保护等)
- R33-1C: 上轮清理 -100 行 (auto-tdk 6 dead export + pseudostatic §4 兼容旧接口 + useResourceList hook 抽取)

---

## 步骤 2: 基线验证

- `bun run lint` → 0 errors / 0 warnings ✓ (初查时 ESLint 输出空, 后续 R34-1A 修改 HomeView.tsx 时出现 react-hooks/static-components error, A agent 已修)
- `bunx tsc --noEmit` → 0 errors in src/ (排除 examples/skills 预存在错误) ✓
- `dev.log` → Next.js 16.1.3 ready, GET / 200, 无报错 ✓

---

## 步骤 3: dead code 扫描 (grep 定义 + 引用, 0 引用删)

### 3.1 tools.tsx (clone-themes) — 6 个 dead export + 内部化 2 个 export

```
src/components/public/clone-themes/tools.tsx
```

仅 `addFavoriteSite` + `useTraditionalChinese` 被 10 套 clone-* 主题 HomeClone 引用。
其余 export 全部 0 外部引用:

| Export | 类型 | 内部引用 | 外部引用 | 处置 |
|--------|------|----------|----------|------|
| `favoriteClick` | export const | 1 (FavoriteLink) | 0 | 删 |
| `FavoriteLink` | export function | 0 | 0 | 删 |
| `TcToggleLink` | export function | 0 | 0 | 删 |
| `useTcControls` | export function | 0 | 0 | 删 |
| `export { s2t, t2s }` | re-export | 0 (s2t 内部 convertTextTc 用, t2s 仅 re-export 用) | 0 | 删 |
| `applyTraditionalToBody` | export function | 1 (ensureTcObserver) | 0 | 改私有 |
| `restoreSimplifiedFromBody` | export function | 1 (stopTcObserverAndRestore) | 0 | 改私有 |
| `addFavoriteSite` | export function | 1 (favoriteClick 内部 + 10 主题直接调用) | 10 主题 ✓ | 保留 |
| `useTraditionalChinese` | export function | 3 (TcToggleLink/useTcControls 内部 + 10 主题直接调用) | 10 主题 ✓ | 保留 |

清理后:
- 删除 `favoriteClick` / `FavoriteLink` / `TcToggleLink` / `useTcControls` 4 个 dead 函数 + 1 个 dead re-export
- `applyTraditionalToBody` / `restoreSimplifiedFromBody` 去 export 关键字 (代码语义不变)
- 删除 `import { s2t, t2s }` 中的 `t2s` (内部仅 s2t 用于 convertTextTc)
- 净减 ~66 行

### 3.2 logger.ts — 删除 3 个 dead class method / function

```
src/lib/logger.ts
```

| Export | 类型 | 内部引用 | 外部引用 | 处置 |
|--------|------|----------|----------|------|
| `setLevel(level)` | class method | 0 | 0 | 删 |
| `getLevel()` | class method | 0 | 0 | 删 |
| `child(bindings)` standalone export | function | 0 | 0 | 删 |
| `withReqId` class method | class method | 1 (this.child({reqId})) | 0 | 保留 (class method) |
| `withReqId` standalone export | function | 0 | 1 (proxy.ts) ✓ | 保留 |
| `logger` (root singleton) | const | 内部 | 多文件 ✓ | 保留 |
| `Logger` class | class | 内部 | 多文件 ✓ | 保留 |
| `LogLevel` enum | enum | 内部 | 0 (类型扩展用) | 保留 (enum 作为公开 API 一部分) |

清理后:
- 删除 `setLevel` / `getLevel` class methods (8 行)
- 删除 standalone `export function child(bindings)` (4 行)
- 头部 docstring 更新 (移除"setLogLevel 可运行时调整"过时表述)
- 净减 ~10 行

### 3.3 suggest.ts (crawl) — 删除 2 个 dead export

```
src/lib/crawl/suggest.ts
```

| Export | 外部引用 | 处置 |
|--------|----------|------|
| `fetchSuggestKeywords` | ✓ (runner.ts + 3 routes) | 保留 |
| `mergeSuggestWords` | ✓ (runner.ts + 2 routes) | 保留 |
| `fetchSuggestKeywordsForBook` | ✓ (api/public/keyword/route.ts) | 保留 |
| `clearPSEOCache` | 0 (仅历史注释提及; 实际 force 重抓走 clearPSEOCacheForBook) | 删 |
| `clearPSEOCacheForBook` | ✓ (pseo/route.ts 动态 import) | 保留 |
| `generatePSEOKeywords` (sync) | 0 (pseo/route.ts 自带 generateLocalPSEOTemplate 同款逻辑独立无缓存) | 删 |
| `generatePSEOKeywordsAsync` | ✓ (pseo/route.ts) | 保留 |
| `PSEOKeyword` interface | ✓ | 保留 |
| `SuggestResult` interface | ✓ | 保留 |

清理后:
- 删除 `clearPSEOCache` 函数 (4 行) + 加注释说明删除原因 (避免未来重新加回)
- 删除 `generatePSEOKeywords` 同步版本 (~50 行) + 加注释说明 pseo/route.ts 自带本地模板兜底
- 净减 ~55 行

### 3.4 batch.ts (api/_lib) — 内部化 2 个 export 常量

```
src/app/api/_lib/batch.ts
```

| Export | 内部引用 | 外部引用 | 处置 |
|--------|----------|----------|------|
| `BATCH_MAX_IDS` | 1 (parseBatchBody) | 0 | 改私有 (去 export) |
| `BATCH_ID_MAX_LEN` | 1 (parseBatchBody) | 0 | 改私有 (去 export) |
| `parseBatchBody` | 内部 | ✓ 7 个 batch route | 保留 |
| `payloadString` | 内部 | ✓ (books/sites batch) | 保留 |
| `skipItem` | 内部 | ✓ 7 个 batch route | 保留 |
| `BatchSkippedItem` type | 内部 | ✓ 7 个 batch route | 保留 |
| `BatchParseOk/Fail/Result` types | 内部 | 部分 batch route | 保留 |

代码语义不变, 仅暴露面收窄.

### 3.5 data.ts (public) — 删除 1 个 dead export

```
src/components/public/data.ts
```

| Export | 外部引用 | 处置 |
|--------|----------|------|
| `fetchRelatedKeywords` | 0 (历史 R13-1A 引入, 后被 fetchKeyword.related + TagCloud 渲染替代) | 删 |
| `fetchBookPSEOKeywords` | ✓ (BookView.tsx) | 保留 |
| `fetchBook/fetchChapter/fetchSearch/fetchKeyword/fetchBooks/fetchSites/fetchCategories` | ✓ | 保留 |
| `fetchFooterLinks/fetchSuggestTags/fetchShowcaseCategories` | ✓ | 保留 |

净减 ~10 行.

### 3.6 api.ts (lib) — 删除 1 个 dead function

```
src/lib/api.ts
```

| Export | 外部引用 | 内部引用 | 处置 |
|--------|----------|----------|------|
| `num(v, def)` | 0 (TaskDialog/TaskWizard/CalibrateDialog 各自有 local num(v) 仅 Number.isFinite 兜底, 语义不同) | 0 | 删 |
| `ok/fail/readBody/BodyTooLargeError` | ✓ 多文件 | 内部 | 保留 |

净减 ~5 行 (函数体 + 注释).

### 3.7 pseudostatic.ts — 清理过时目录注释

```
src/lib/pseudostatic.ts
```

R33-1C 已删除 §4 兼容旧接口块 (buildBookUrl) 但文件头目录注释仍保留 `§4 兼容旧接口 .......................... buildBookUrl` 一行. 同步清理.

### 跳过项 (R33-1C 先例 + 评估)

- `parser.ts` 的 `extractMetaTags / extractJsonLd / jsonArrayAt / extractTable` — 仅 scripts/archive/verify-*.ts 历史脚本引用, 删 export 会破坏 archive 脚本
- `types.ts` 的 `validateRegexSafety / hasNestedQuantifier / RegexSafetyResult` — 仅 scripts/archive/verify-gg-a-regex.ts 等历史脚本引用
- `sorter.ts` 的 `romanToNumber / cnNumToNumber` — 内部 + archive 脚本, 保留
- `hostgate.ts` 的 `hostGateKeyOf / normalizeIpLiteral / isPrivateIp / hostGateReset` — 内部 + archive 脚本, 保留
- bits.tsx 全部 export (bookNavProps/StatusBadge/TagCloud/SuggestTagCloud/SecTitle/EmptyState/ErrorState/Sk/BookGridSkeleton/ChapterListSkeleton) — 全部 ✓
- dashboardCards.ts 全部 export — 全部 ✓
- helpers.ts (admin) 全部 export — 全部 ✓
- http.ts 全部 export (withGuard/errText/clampInt/str/likeSafe/httpUrl/isPlainObject/enumIn/safeJoin/withCache) — 全部 ✓
- search-history.ts 全部 export — 全部 ✓

---

## 步骤 4: 重复逻辑整合评估

### 4.1 clone-themes 10 套 footer/header 重复

跨主题 footer DOM 结构差异大 (23qb 用 `<footer id="footer" className="wrapper pd60"><p className="sitemap">...RSS/Google/Bing...`, trxsw 用 `<footer className="footer"><div className="footer-inner">...首页/书库/排行榜...`, 各主题源站 DOM 完全不同). 无法提取通用 footer 组件.

同主题内 8 个 view 文件 (HomeClone/BookInfo/CategoryList/FulltextView/KeywordView/RankingView/ReadChrome/SearchView) 的 footer 重复, 但 R27-1C 已抽 shared.ts 把 nav handlers + 分页 + 分类拉取三段共用逻辑收敛, 主题内 footer 的 DOM 重复属于"1:1 复刻源站 DOM"的不可避免代价 (各 view 独立维护符合 clone-themes 设计原则).

**结论**: 不强行提取, 维持现状.

### 4.2 admin 各 Section 重复 fetch 逻辑

R33-1C 已抽 `useResourceList<T>(url, errMsg)` hook, RulesSection 迁移完成. 其余 Section (CategoriesSection 双 state + 拖拽; LinksSection/SitesSection/ThemesSection Promise.all; BooksSection/TasksSection pagination + aliveRef + seq; FeedbackSection 多 set; DownloadsSection 3 独立 load) 均不符合"单一 GET + 数组响应 + 单 loading"抽象条件, R33-1C 已评估并跳过. 本轮维持 R33-1C 结论.

### 4.3 lib 各 helper 重复

- `isPlainObject` 在 helpers.ts (admin) 和 http.ts (api) 各定义一份 — 两份语义略不同 (helpers 版排除 Array, http 版同样排除 Array 但用 `v !== null`), 跨域引用 (admin 客户端 / api 服务端) 不应互相 import, 维持各自定义.
- `shufflePick` (bits.tsx) / `shuffled` (links.ts) / Fisher-Yates 各主题内 — 用途不同 (前者客户端洗牌 suggest 词池, 后者服务端洗牌站点序), 不合并.

**结论**: 无新整合机会.

---

## 步骤 5: 复杂函数精简评估 (R33-1C 先例: 不动)

- `CalibrateDialog.tsx CalibrateDialog` 600 行 — 主组件含大量 state + JSX, 拆分需抽取 state + refs + JSX 块, 风险大且无明确收益
- `TaskMonitor.tsx TaskMonitor` 631 行 — 同上
- `TaskDialog.tsx TaskDialog` 417 行 — 同上
- `TestPanel.tsx VisualDebugSection` 353 行 — 单组件

拆分需引入新文件 + props 传递 + state lifting, 风险大且收益小 (各组件已单一职责, 行数高主要是 JSX 模板). **跳过**.

---

## 步骤 6: 过时注释清理

### 6.1 pseudostatic.ts §4 buildBookUrl 目录注释 (R33-1C 残留)

R33-1C 删除了 §4 兼容旧接口块 (buildBookUrl 函数), 但文件头目录注释 `// §4 兼容旧接口 .......................... buildBookUrl` 一行未同步清理. 本轮删除该行 + 加注释说明 "(R33-1C 已删 §4 兼容旧接口块 buildBookUrl, R34-1C 同步清理此处过时目录注释)".

### 6.2 跳过的过时注释 (保留, 均有设计价值)

- `BookView.tsx R12-1` 注释 (移除 pili/aurora/mango/paper/bamboo/rose 旧主题分支) — 提示读者不要把分支加回去, R33-1C 已评估保留
- `themes.ts R14-1A contentSelector` 注释 — 源站 probe 实测值来源标注, 保留
- `sites/route.ts R12-1` (兜底改为 clone-aijjxs) — 解释 fallback 选择 rationale
- `api/admin/themes/route.ts R10-1A/R13-1B` 头部 docstring — API 演进文档
- `data.ts R10-1C/R13-1A` — SEO 配置 + PSEO 来源标注

R10-R20 时期的注释大多属于"提示未来维护者某分支已被删/某 fallback 选择 rationale", 删除会损失设计语境. **不强删**.

---

## 步骤 7: 临时文件清理 (R33-1C 先例: 不删)

### 7.1 scripts/archive/*

`rg "scripts/archive" src/` → 仅 `fetcher.ts:2775` 注释提及 (无代码 import). 整目录是 R10-R25 历史归档的 verify-*/probe-*/e2e-* 脚本, R33-1C 已评估保留作历史参考. **维持现状**.

### 7.2 agent-ctx/archive-pre-r28/*

79 个 .md 文档共 972KB, R9-R27 时期工作记录. R33-1C 已评估"删除不影响代码功能但损历史参考". **维持现状**.

### 7.3 agent-ctx/probe-html/ + probe-html2/

源站真实 HTML+CSS 样本 (23qb/aijjxs/pilishuwu/huangjinwu/x2552/ggd66/shipsay/101kks/ddyueshu), 用于 1:1 复刻 clone-themes 时的 DOM 参考. **保留** (未来主题回源校准仍需).

---

## 步骤 8: 验证

### 8.1 bun run lint

```
$ eslint .
EXIT: 0
```

0 errors / 0 warnings ✓

(注: R34-1A agent 期间修改 HomeView.tsx 引入 react-hooks/static-components 错误, A agent 已自行修复 — 把 eslint-disable-next-line 注释移到 JSX 用法行 `<Clone ...>` 上方. 本轮不碰 HomeView.tsx, 尊重 A agent 边界.)

### 8.2 bunx tsc --noEmit

```
(command completed successfully with no output)
```

0 errors in src/ ✓ (排除 examples/skills 预存在错误)

### 8.3 dev.log

```
▲ Next.js 16.1.3 (webpack)
- Local:         http://localhost:3000
- Network:       http://21.0.15.240:3000
- Environments: .env
✓ Starting...
✓ Ready in 1376ms
{"ts":"2026-09-19T17:32:18.708Z","level":"debug","msg":"incoming request","ctx":{"method":"GET","path":"/","ip":"::1"},"reqId":"eaa9a34f"}
```

Next.js 16.1.3 ready, GET / 200, 无报错 ✓

`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → `200` ✓
`curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/?view=search&q=test"` → `200` ✓

---

## Stage Summary

### 净减行数: ~-140 行 (全在 src/components/* + src/lib/* 非 crawl 核心)

### 修改文件 7 个:

1. **src/components/public/clone-themes/tools.tsx** (-66 行净减)
   - 删 `favoriteClick` (export const, 0 外部)
   - 删 `FavoriteLink` (export function, 0 外部)
   - 删 `TcToggleLink` (export function, 0 外部)
   - 删 `useTcControls` (export function, 0 外部)
   - 删 `export { s2t, t2s }` re-export (0 外部, s2t 内部 convertTextTc 用, t2s 完全没用)
   - `applyTraditionalToBody` / `restoreSimplifiedFromBody` 去 export 关键字 (内部使用)
   - `import { s2t, t2s }` → `import { s2t }` (t2s 内部不用了)
   - 加注释说明删除原因 + 保留 addFavoriteSite/useTraditionalChinese 的语义

2. **src/lib/logger.ts** (-10 行净减)
   - 删 `setLevel(level: LogLevel)` class method (0 调用)
   - 删 `getLevel(): LogLevel` class method (0 调用)
   - 删 standalone `export function child(bindings)` (0 外部调用)
   - 头部 docstring 更新: 移除 "setLogLevel 可运行时调整" 过时表述
   - 保留: `logger` 根单例 / `Logger` class / `LogLevel` enum / `withReqId` (class method + standalone export) / class method `child` (供 withReqId 内部 this.child({reqId}) 调用)

3. **src/lib/crawl/suggest.ts** (-55 行净减)
   - 删 `clearPSEOCache()` (0 外部, 实际 force 重抓走 clearPSEOCacheForBook)
   - 删 `generatePSEOKeywords()` 同步版本 (0 外部, pseo/route.ts 自带 generateLocalPSEOTemplate 同款本地模板兜底)
   - 加注释说明删除原因 (避免未来重新加回)
   - 保留: `fetchSuggestKeywords` / `mergeSuggestWords` / `fetchSuggestKeywordsForBook` / `clearPSEOCacheForBook` / `generatePSEOKeywordsAsync` / `PSEOKeyword` / `SuggestResult` 全部 ✓ 使用

4. **src/app/api/_lib/batch.ts** (+5 行注释, -2 行 export 关键字)
   - `BATCH_MAX_IDS` / `BATCH_ID_MAX_LEN` 去 export 关键字 (内部 parseBatchBody 消费)
   - 加注释说明 "0 外部引用, 仅 parseBatchBody 内部消费"
   - 代码语义不变, 仅暴露面收窄

5. **src/components/public/data.ts** (-10 行净减)
   - 删 `fetchRelatedKeywords(keyword)` (0 外部, 历史功能被 fetchKeyword.related + TagCloud 渲染替代)
   - 加注释说明删除原因
   - 保留: `fetchBookPSEOKeywords` 等 8 个 fetch* 函数全部 ✓ 使用

6. **src/lib/api.ts** (-5 行净减)
   - 删 `num(v: any, def: number): number` (0 外部 + 0 内部)
   - 加注释说明: TaskDialog/TaskWizard/CalibrateDialog 各自有 local num(v) 仅 Number.isFinite 兜底 (与本函数语义不同, 无 def 参数); 旧 admin 表单字段已迁移到 _lib/http clampInt + str 消毒
   - 保留: `ok` / `fail` / `readBody` / `BodyTooLargeError` 全部 ✓ 使用

7. **src/lib/pseudostatic.ts** (0 行, 仅注释更新)
   - 删除文件头目录注释 `// §4 兼容旧接口 .......................... buildBookUrl`
   - 加注释说明 "(R33-1C 已删 §4 兼容旧接口块 buildBookUrl, R34-1C 同步清理此处过时目录注释)"

### 核心清理成果:

- **dead code**: tools.tsx 6 个互依赖 dead export 簇一并删除 (favoriteClick/FavoriteLink/TcToggleLink/useTcControls + applyTraditionalToBody/restoreSimplifiedFromBody 内部化 + s2t,t2s re-export 删除)
- **dead code**: logger.ts 3 个 dead method/function 删除 (setLevel/getLevel class methods + standalone child export)
- **dead code**: suggest.ts 2 个 dead export 删除 (clearPSEOCache + generatePSEOKeywords 同步版本)
- **dead code**: api.ts 1 个 dead function 删除 (num)
- **dead code**: data.ts 1 个 dead export 删除 (fetchRelatedKeywords)
- **暴露面收窄**: batch.ts 2 个内部常量去 export (BATCH_MAX_IDS/BATCH_ID_MAX_LEN)
- **过时注释**: pseudostatic.ts §4 buildBookUrl 目录注释同步清理 (R33-1C 残留)

### 未修改 (尊重约束):

- `src/lib/crawl/fetcher.ts` / `obscura.ts` / `runner.ts` (B agent 第七轮 R33-1B + R34-1B 改动) ✓
- `src/lib/crawl/storage.ts` / `fetcher-curl-impersonate.ts` / `cleaner.ts` (R33-1B 改动) ✓
- `src/components/public/HomeView.tsx` / `page.tsx` (A agent R34-1A 内存优化改动; 期间 R34-1A 引入 react-hooks/static-components 错误, A agent 自行修复 — 把 eslint-disable 注释移到 `<Clone ...>` JSX 用法行上方, 本轮不碰) ✓
- `src/components/public/BookView.tsx` / `PublicSite.tsx` (主控已改, BookView R12-1 注释虽是历史但提示设计取舍) ✓
- `themes.ts` R14-1A contentSelector 注释 (源站 probe 实测值来源标注) ✓
- `scripts/archive/*` + `agent-ctx/archive-pre-r28/*` (历史归档/文档, R33-1C 评估保留) ✓
- `prisma/schema.prisma` + `package.json` (0 新依赖) ✓
- `CalibrateDialog.tsx` / `TaskMonitor.tsx` / `TaskDialog.tsx` / `TestPanel.tsx` (超长组件, R33-1C 先例: 拆分风险大且无明确收益) ✓

### 历史修复全部保留 (零回归):

- R25-1A2/A3 / R26-1A / R27-1A/B / R28-1A/B/C / R29-1D / R30-1A / R31-1A/B/C/D / R32-1A/B / R33-1A/B/C 全部不动
- R33-1C 抽取的 `useResourceList<T>` hook + RulesSection 迁移保留
- R33-1B 4 P1 + 1 P2 修复 (trafilaturaBridgeUrl 透传 / split(/\n+/) 段落 / 等) 不动

### 验证:

- `bun run lint` 0 errors ✓
- `bunx tsc --noEmit` 0 errors in src/ ✓
- `dev.log` Next.js 16.1.3 ready, GET / 200, 无报错 ✓
- `curl http://localhost:3000/` → 200 ✓
- `curl http://localhost:3000/?view=search&q=test` → 200 ✓

### 详细工作记录:

agent-ctx/R34-1C-full-stack-developer.md (本文件, 含 8 章节: 读交接/基线验证/dead code 扫描/重复逻辑整合评估/复杂函数精简评估/过时注释清理/临时文件清理/验证)
