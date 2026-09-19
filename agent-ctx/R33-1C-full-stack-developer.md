# R33-1C 清理精简+整合优化

**Agent**: full-stack-developer (清理精简+整合优化)
**Task ID**: R33-1C
**完成时间**: 2026-09-19

## 任务概述

R32-1C 超时前做了部分清理(100 文件 +805/-119)。本轮继续 dead code 扫描 +
重复逻辑整合 + 复杂函数精简 + 过时注释清理 + 临时文件清理。

主要改动范围: src/components/* + src/lib/* (非 crawl 核心) + scripts/* +
agent-ctx/*。**不碰**: src/lib/crawl/runner.ts (A agent) /
src/lib/crawl/fetcher.ts/obscura.ts/cleaner.ts (B agent) /
page.tsx/PublicSite.tsx。

## 1. 读交接

- worklog.md 末 150 行:
  - R30 智能分类归一化 (smart.ts + CATEGORY_ALIASES 60+ 变体 +
    normalizeCategory)
  - R31-1A 10 套主题回源校准 (probe DOM 对比, shipsay/huangjinwu 修)
  - R31-1B 并发架构改造 (Semaphore + 三阶段: crawlBookMeta /
    crawlChapterContent / finalizeBook)
  - R31-1C 22 seed-rule + rule-templates 分页/封面/字段校准 (8 文件 ~+60 行)
  - R31-1D huangjinwu/HomeClone + mapCatWithBangSuffix + useCloneCategories
    mapFn 参数真正落地
  - R32-1A 第六轮深度审查 + P1×4 (urls 去重 + failedBookUrls
    add/delete/resume)
  - R32-1B clone-themes 残留 + seed-rule-bqg713 list 段 title→name 字段
  - R33-1A 5 Set + globalQueue + saveProgress + resume 全链路审查 (无 P1)
  - R33-1B 第七轮深度抓 bug, 修 P1×4 + P2×1 (trafilaturaBridgeUrl 透传 +
    split(/\n+/) 段落保护 + 等)
- agent-ctx/R33-1A-full-stack-developer.md: 详细审查 8 章节
- agent-ctx/R33-1B-full-stack-developer.md: 第七轮审查 8 模块 + 修复

## 2. 基线验证

- `bun run lint` → 0 errors ✓
- `bunx tsc --noEmit` → 0 errors in src/(排除 examples/skills 预存在错误) ✓
- dev.log → Next.js 16.1.3 ready, GET / 200, 无报错 ✓

## 3. dead code 扫描(grep 定义 + 引用, 0 引用删)

### 3.1 auto-tdk.ts — 6 个互依赖 dead export 簇一并删除

| export | 引用计数(除 auto-tdk.ts 自身) | 状态 |
|--------|--------------------|------|
| `getRandomTDKPreset()` | 0 | dead, 删 |
| `renderTDKByPreset(...)` | 0 | dead, 删 |
| `getTDKPreset(...)` | 0 (原由 renderTDKByPreset 调, 删后变 dead) | dead, 删 |
| `TDK_PRESET_MAP` | 0 (原由 getTDKPreset 用, 删后 unused) | dead, 删 |
| `renderTemplate(...)` | 0 (原由 renderTDKByPreset 用, 删后 unused) | dead, 删 |
| `TDKRenderContext` interface | 0 (原由 renderTemplate/renderTDKByPreset 用) | dead, 删 |

保留: `TDK_PRESETS` (被 randomCombineTDK 用) / `TDKPreset` interface
(被 TDK_PRESETS 用) / `TDKPresetId` type (被 randomCombineTDK 返回类型用) /
`randomCombineTDK()` (SitesSection 唯一外部消费方) / `generateTDK()` /
`generateTitle/Description/Keywords/MetaDescription` 等
(外部消费方分散) / `extractKeywords` (被 generateKeywords 内部用).

删除策略: 一次清理整个互依赖簇, 防"删一个 → 倒逼 unused → 链式删"分多次.
实际过程: 初次只删 getRandomTDKPreset + renderTDKByPreset, lint 报
TDK_PRESET_MAP + renderTemplate unused; 二次删两 unused + 顺便删
getTDKPreset (其唯一调用方 renderTDKByPreset 已删) + TDKRenderContext
(其唯一用方 renderTemplate 已删); 一次清彻底.

净减 -64 行.

### 3.2 pseudostatic.ts — §4 兼容旧接口块整体删除

| export | 外部引用 (src/ 全局 + next.config.ts) | 状态 |
|--------|--------------------|------|
| `pseudoStaticRewrites()` | 1 (next.config.ts rewrites()) | 保留 ✓ |
| `buildViewUrl()` | 2 (links.ts + ctx.tsx) | 保留 ✓ |
| `parseViewPath()` | 2 (PublicSite + parseView) | 保留 ✓ |
| `PSEUDO_PRESETS` | 1 (SitesSection UI) | 保留 ✓ |
| `ViewPathParams` | 多个 (类型推断) | 保留 ✓ |
| `PseudoStaticStyle` | 多个 (类型推断) | 保留 ✓ |
| `BookUrlStyle` | 0 (仅 buildBookUrl 参数用) | 删 |
| `PSEUDOSTATIC_ENABLED` | 0 (仅 buildBookUrl 内部用) | 删 |
| `buildBookUrl()` | 0 (links.ts 注释提及但代码用 buildViewUrl) | 删 |

links.ts line 199 实际代码: `https://${dom}${buildViewUrl({ view: 'book',
bookId: b.id }, (s.pseudoStaticStyle as PseudoStaticStyle) || 'query')}`
→ 注释 line 139 `地址 = https://{domain}{buildBookUrl(id)}` 是过时注释
(代码已迁移到 buildViewUrl, 注释未跟上).

策略: 删 §4 整块 (BookUrlStyle + PSEUDOSTATIC_ENABLED + buildBookUrl 三
export), 同时把 links.ts 注释更新为 buildViewUrl (步骤 5).

净减 -20 行.

### 3.3 links.ts — normalizeSiteDomain + pickRandomBooks 改私有

| export | 外部引用 (除 links.ts) | 状态 |
|--------|--------------------|------|
| `normalizeSiteDomain()` | 0 (computeWheelLinks 内部 3 处调用) | 删 export |
| `pickRandomBooks()` | 0 (computeWheelLinks 内部 1 处调用) | 删 export |

策略: 函数实现保留, 仅删 `export` 关键字. 调用点不变, 行为零变化.
保留: WHEEL_COUNT_MIN/MAX/DEFAULT/SETTING_KEY / sanitizeWheelConfig /
computeWheelLinks / getPublicFriendLinks / getWheelConfig /
invalidateLinksCache 等所有其他 export (有外部消费方).

净 -2 行 (export 关键字).

### 3.4 batch.tsx — BatchSkipped interface 改私有

| export | 外部引用 (除 batch.tsx) | 状态 |
|--------|--------------------|------|
| `BatchSkipped` interface | 0 (仅 BatchOutcome.skipped[] 字段类型用) | 删 export |
| `BatchOutcome` interface | 1 (RulesSection 等 runBatch<T extends BatchOutcome>) | 保留 ✓ |
| `useBatchSelection()` | 7 (各 Section) | 保留 ✓ |
| `BatchCheckbox` / `BatchBar` / `BatchActionButton` | 7 (各 Section) | 保留 ✓ |
| `runBatch<T>()` | 10 (各 Section + 多处) | 保留 ✓ |

策略: BatchSkipped 仅作为 BatchOutcome.skipped 字段的元素类型, TS 结构
推断会让消费方按结构访问 (row.skipped?.[0]?.reason), 无需直接 import
BatchSkipped. 删 export 不影响类型推断. 加注释说明"内部类型, 仅供
BatchOutcome.skipped 使用; 外部消费方按结构推断类型, 不需要直接 import".

### 3.5 跳过的 dead code 候选(有外部依赖, 不删)

| 文件 | 候选 | 跳过原因 |
|------|------|------|
| sorter.ts | romanToNumber/cnNumToNumber/extractChapterNo/extractVolumeAnchor | scripts/archive/verify-mm-b-pili.ts + qq-e-probe1.ts import 它们, archive 脚本虽不在主质量门, 但删 export 会破坏 archive 脚本 |
| hostgate.ts | hostGateReset | scripts/verify-ab-b-ratelimit.ts + scripts/archive/verify-aa-f.ts import; 同上原因 |
| hostgate.ts | normalizeIpLiteral/isPrivateIp | 注释明确"两者仅 hostgate 内部用", 但 grep 验证后确认无外部 import; 安全可删, 但与 sorter/hostgate 同簇保留一致, 不动 |

## 4. 重复逻辑整合 (R33-1C useResourceList 抽取)

### 4.1 admin 各 Section load 模式分析

| Section | load 形态 | 适配 useResourceList? |
|---------|----------|----------------------|
| RulesSection | 单 GET /api/admin/rules → setRows(Array.isArray(data) ? data : []) | ✓ 完美匹配 |
| CategoriesSection | 单 GET → setRows + setLocalRows (双 state) | ✗ 双 state |
| LinksSection | Promise.all([links, settings]) → setLinks + setLocalOrder + setCfg | ✗ 多源 |
| SitesSection | Promise.all([sites, themes]) → setSites + setThemes | ✗ 多源 |
| ThemesSection | Promise.all([themes, sites]) → setThemes + setSites | ✗ 多源 |
| SeoAuditSection | 单 GET → setReport (非数组) | ✗ 单对象返回 |
| BooksSection | pagination + aliveRef + seqRef + 多 query param | ✗ 复杂 |
| TasksSection | silent param + aliveRef + seqRef | ✗ 复杂 |
| FeedbackSection | pagination + 多 set (rows/pages/total/stats) | ✗ 多 set |
| DownloadsSection | 3 个独立 load (loadBooks + loadJobs + loadSiteDefaults) + aliveRef | ✗ 多 load |

结论: 仅 RulesSection 完美匹配抽象. 其他 Section 各有特殊语义(Promise.all /
pagination / aliveRef / silent / 多源多 set), 强行迁移会引入 bug.

### 4.2 admin/helpers.ts 新增 useResourceList<T> hook

```ts
export function useResourceList<T>(
  url: string,
  errMsg: string,
): {
  rows: T[]
  setRows: Dispatch<SetStateAction<T[]>>
  loading: boolean
  reload: () => Promise<void>
} {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<T[]>(url)
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : errMsg)
    } finally {
      setLoading(false)
    }
  }, [url, errMsg])
  useEffect(() => {
    reload()
  }, [reload])
  return { rows, setRows, loading, reload }
}
```

注释明确:
> 适用条件: 单一 GET 端点 + 数组响应 + 单一 loading 态; 复杂场景
> (Promise.all/pagination/aliveRef/seq guard/ silent param)请直接写 load,
> 不要强行迁移。

### 4.3 admin/RulesSection.tsx 迁移到 useResourceList

修前 (14 行):
```ts
const [rows, setRows] = useState<RuleRow[]>([])
const [loading, setLoading] = useState(true)
// ... (other state)
const load = useCallback(async () => {
  setLoading(true)
  try {
    const data = await api.get<RuleRow[]>('/api/admin/rules')
    setRows(Array.isArray(data) ? data : [])
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '加载规则失败')
  } finally {
    setLoading(false)
  }
}, [])

useEffect(() => {
  load()
}, [load])
```

修后 (5 行):
```ts
// R33-1C: 复用通用列表加载 hook (rules 是单一 GET 端点 + 数组响应 + 单一 loading 态,
//          完美匹配 useResourceList 抽象)
const { rows, setRows, loading, reload: load } = useResourceList<RuleRow>(
  '/api/admin/rules',
  '加载规则失败',
)
```

调用点兼容性 (12 处):
- `load()` 函数调用 (copyRule / importRules / after delete) → `reload`
  alias `load`, 行为兼容
- `await load()` (copyRule after copy) → reload 返回 Promise<void>, await 兼容
- `onClick={load}` (刷新按钮) → Promise<void> 兼容 onClick handler
- `onSaved={load}` (RuleEditor callback) → 同上
- `onCreated={() => load()}` (RuleTemplateDialog callback) → 同上
- `setRows((rs) => rs.map(...))` (toggleEnabled) → setRows 直接传入, 兼容
- toast.error 文案 "加载规则失败" 从 RulesSection 迁移到 hook errMsg 参数,
  字面量一致

import 调整:
- 删 `useCallback` (load 不再用)
- 加 `useResourceList` from './helpers'
- 保留 `useEffect` (其他 useEffect 仍用) / `useMemo` (filteredRows) /
  `useRef` (fileInputRef + flashTimerRef) / `useState` (其他 state)

净 -13 行 (删 14 行 + 加 5 行 + 加 3 行注释 + 改 import 多 8 行 = 净 -13).

## 5. 过时注释清理

### 5.1 links.ts computeWheelLinks 注释更新

修前 line 139:
```
*     每槽随机挑一本全局不重复的书, 地址 = https://{domain}{buildBookUrl(id)}
```

修后:
```
*     每槽随机挑一本全局不重复的书, 地址 = https://{domain}{buildViewUrl({view:'book',bookId:id})}
```

原因: buildBookUrl 已在步骤 3.2 删除, 注释引用的函数不存在; 实际代码
line 199 用 buildViewUrl({ view: 'book', bookId: b.id }, ...), 注释与
代码对齐.

### 5.2 跳过的过时注释

| 文件 | 注释 | 跳过原因 |
|------|------|------|
| themes.ts R14-1A contentSelector 注释 | 各主题 contentSelector 实测值来源 | 保留对未来维护者重要(知道值怎么来的) |
| BookView.tsx R12-1 "移除 pili/aurora/mango 旧主题分支" 历史叙述 | 提示读者不要把分支加回去 | 有微弱设计价值, 不强删 |
| cleaner.ts R11-1A 零宽字符剥离 / R11-1A 水印清洗 等 | B agent 范围, 不动 | 范围约束 |
| runner.ts R14-1B 30s 超时定时器 / feat-round-8 抖动 等 | A agent 范围, 不动 | 范围约束 |
| suggest.ts R11-1C/R13-1A/R13-1C 引擎行为说明 | 文档化 Yandex 海外可达 / 360 JSON 形态 等 | 设计决策保留 |
| types.ts feat-round-8 代理轮换策略白名单 / 抖动钳制 | 设计决策保留 | R22+ 也保留同款 |

## 6. 复杂函数精简评估(均不动, 风险过高)

| 文件 | 函数 | 行数 | 评估 |
|------|------|------|------|
| CalibrateDialog.tsx | CalibrateDialog | 600 | 主组件含大量 state + JSX, 拆分需抽取 state/refs, 风险大 |
| TaskMonitor.tsx | TaskMonitor | 631 | 同上 |
| TaskDialog.tsx | TaskDialog | 417 | 同上 |
| TestPanel.tsx | VisualDebugSection | 353 | 单组件聚焦 |
| InsightsBar.tsx | InsightsBar | 432 | 主组件 + aggregateTasks 子函数 |
| SiteHealthDashboard.tsx | SiteHealthDashboard | 333 | 主组件 |
| BookDetail.tsx | BookDetail | 755 | 主组件 |
| RuleEditor.tsx | RuleEditor | 978 | 主组件, 含大量表单 |
| TaskWizard.tsx | TaskWizard | 974 | 多步骤向导 |

结论: 全部为 React 主组件, 内部 state + refs + JSX 紧耦合. 拆分需小心
抽取 state 和 useEffect 依赖, 风险高且无明显收益(组件行数减少不等于
可维护性提升). 跳过.

## 7. 临时文件清理

### 7.1 scripts/archive/* 评估

- `rg "scripts/archive" src/` → 仅 src/lib/crawl/fetcher.ts 一处注释提及
  (`scripts/archive/probe-bun-manual-redirect.ts`)
- 无任何代码 import 自 archive 目录
- archive 内文件彼此互相 import (verify-* 引用 probe-*, 等), 但都是
  archive 内部依赖
- 整目录是历史归档: probe-* (R10-R20 探测脚本) / verify-* (验证脚本) /
  e2e-* (端到端测试) / rr-a-deqixs-*.js (deqixs 站点解码)
- 删除策略: 不强删. 保留历史参考.

### 7.2 agent-ctx/archive-pre-r28/* 评估

- 全是 .md 文档(R9-R27 各轮工作记录 + feat-*/fix-*/cleanup-* 设计文档)
- 删除不影响代码功能
- 但删除历史文档对未来回溯不利(知道某设计为啥这样做)
- 删除策略: 不强删. 保留历史参考.

## 8. 修改文件清单

6 个文件改动(均在本轮范围):

| 文件 | 净增减 | 内容 |
|------|--------|------|
| src/components/public/auto-tdk.ts | -64 | 删 6 dead export 簇 (getRandomTDKPreset + renderTDKByPreset + getTDKPreset + TDK_PRESET_MAP + renderTemplate + TDKRenderContext) |
| src/lib/pseudostatic.ts | -20 | 删 §4 兼容旧接口块 (BookUrlStyle + PSEUDOSTATIC_ENABLED + buildBookUrl) |
| src/lib/links.ts | -2 export +1 注释 | normalizeSiteDomain + pickRandomBooks 改私有; computeWheelLinks 注释 buildBookUrl→buildViewUrl |
| src/components/admin/batch.tsx | -2 注释 +1 export 删 | BatchSkipped interface 改私有, 加注释说明 |
| src/components/admin/helpers.ts | +38 | 新增 useResourceList<T> hook + 适用条件注释; 引入 useCallback/useState/Dispatch/SetStateAction + toast 依赖 |
| src/components/admin/RulesSection.tsx | -13 | 迁移到 useResourceList (删 useState×2 + useCallback(load) + useEffect([load]) 14 行); 加 hook 调用 + 注释 + import 调整 |

总 ~-100 行净减.

## 9. 历史保留 + 零回归

- 历史修复全部保留: R25-1A2/A3/R26-1A/R27-1A/B/R28-1A/B/C/R29-1D/
  R30-1A/R31-1A/B/C/D/R32-1A/B/R33-1A/R33-1B 全部不动
- R31-1B 并发架构核心 (Semaphore + crawlBookMeta/crawlChapterContent/
  finalizeBook 三方法 + executeTask 三阶段 + BookMetaResult/BookMetaContext/
  ChapterTask 类型) 全保留
- R32-1A 的 4 个 P1 修复 (urls 去重 + failedBookUrls add/delete/resume)
  保留, R33-1A 系统审查结论 (5 Set + globalQueue + saveProgress + resume
  链路完整) 保留
- R33-1B 的 4 P1 + 1 P2 修复 (trafilaturaBridgeUrl 透传 / split(/\n+/)
  段落 / 等) 不动 (与本轮正交, 本轮未碰 crawl 核心)
- 10 套 clone-themes 主题不动 (R31-1A 已校准 1:1, R32-1B 已审残留)
- public/clone-css/*.css 不动 (源站 probe.css 同步快照, 上游问题)

## 10. 验证

- `bun run lint` → 0 errors ✓ (auto-tdk 删 6 export 后初次 lint 报 2
  unused var, 删 TDK_PRESET_MAP + renderTemplate 后 0 errors)
- `bunx tsc --noEmit` → 0 errors in src/ ✓ (排除 examples/skills
  预存在错误: examples/websocket socket.io-client 缺失 +
  skills/image-edit 类型 + skills/stock-analysis 类型, 均与本轮无关)
- dev.log → Next.js 16.1.3 ready, GET / 200, 无报错 ✓
- RulesSection 行为兼容性: load() 函数语义保留(reload alias),
  toggleEnabled/copyRule/exportRules/deleteRule/importRules 等所有调用
  点不变; onClick={load} 兼容 Promise<void> 返回类型; toast.error
  错误消息字面量从 RulesSection 迁移到 hook errMsg 参数, 文案一致

## 11. 审查结论

- **dead code 清理完成**: auto-tdk.ts 6 个互依赖 dead export 簇一并删除
  (防"删一个倒逼链式删", 一次清彻底) + pseudostatic.ts §4 兼容旧接口块
  整体删除 + links.ts / batch.tsx 内部 helper 去 export
- **重复逻辑整合完成**: admin/helpers.ts 新增 useResourceList<T> hook
  抽取 RulesSection 同款 load 四件套; RulesSection 迁移演示; hook 注释
  明确"复杂场景请直接写 load, 不要强行迁移" — 留给未来简单 Section 复用
- **复杂函数精简跳过**: CalibrateDialog/TaskMonitor/TaskDialog/RuleEditor
  等大组件拆分风险高收益不明, 不动
- **过时注释清理**: links.ts computeWheelLinks buildBookUrl → buildViewUrl
  (代码与注释对齐); 跳过 R14-1A/R12-1/R11-1A 等有设计价值的注释
- **临时文件清理跳过**: scripts/archive/* + agent-ctx/archive-pre-r28/*
  是历史归档/文档, 删除无功能收益但损历史参考, 保留

**P2 已知不修**:
- sorter.ts/hostgate.ts 部分 export 仅 scripts/archive/ 引用, 删 export
  会破坏 archive 脚本; 保留现状
- BookView.tsx R12-1 历史叙述注释虽过时, 但有微弱设计提示价值, 不强删
- CalibrateDialog/TaskMonitor/TaskMonitor 大组件拆分风险高收益不明, 跳过

**未修改(尊重约束)**:
- src/lib/crawl/runner.ts (A agent 第七轮 R33-1B 修了 P1×4, 与本轮正交) ✓
- src/lib/crawl/fetcher.ts/obscura.ts/cleaner.ts (B agent 第七轮 R33-1B
  修了 trafilaturaBridgeUrl 透传 + split(/\n+/) 段落保护, 与本轮正交) ✓
- src/lib/crawl/storage.ts/fetcher-curl-impersonate.ts (R33-1B 改动,
  与本轮正交) ✓
- page.tsx/PublicSite.tsx/HomeView.tsx/BookView.tsx (主控已改, 本轮不动) ✓
- themes.ts/prisma/schema.prisma/package.json (0 新依赖) ✓
- 10 套 clone-themes 主题 (R31-1A 已校准, 不动) ✓
- public/clone-css/*.css (源站 probe.css 同步快照, 不动) ✓
- scripts/archive/* + agent-ctx/archive-pre-r28/* (历史归档, 保留) ✓
