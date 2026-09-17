# R19-1B 代码审计 + 接线报告

> 任务 ID: R19-1B  
> 代理: 子代理(clone-themes 接线 + 深度审计)  
> 日期: 2026-09-17

## 摘要

- **审计范围**: 8 视图 (HomeView/BookView/CategoryView/ReadView/RankingView/FulltextView/SearchView/KeywordView ~2.5k LoC) + 10 套 clone-themes (100 文件 ~12k LoC) + 3 crawl 模块 (fetcher.ts/runner.ts/cleaner.ts ~7.4k LoC) = ~22k LoC
- **修复数量**: P0=0 / P1=0 / P2=0 (历史 bug 已修) / 接线补全: 8 视图全部接 clone-themes lookup table
- **关键改动**: 8 视图全部从"内联 fallback / 重建窗口期通用兜底"切换到"clone-themes lookup table 分发", fallback 走 aijjxs (与 R15-1B 同口径)
- **验证**: tsc 0 errors / lint 0 errors / 10 套主题全部 200 OK / 无运行时错误

---

## 1. 部分 1: 视图接线

### 1.1 HomeView.tsx (185 行)

**改动**:
- 恢复 10 个 dynamic import (R15-1B 原实现):
  ```tsx
  const HomeCloneAijjxs = dynamic(() => import('./clone-themes/aijjxs').then((m) => m.HomeClone))
  // ... 10 套
  ```
- 恢复 `theme.layout === 'clone-XXX'` 分发分支 (10 条)
- 透传 `navCategoryCount={site.navCategoryCount} homeModuleLimit={site.homeModuleLimit}` (R16 站点配置项)
- 保留 `GenericBookGrid` 兜底组件 (未知 layout 时使用)
- 已知 clone-* layout 列表提取为 `CLONE_LAYOUTS` 常量 (避免重复字面量数组)

### 1.2 BookView.tsx (792 行)

**改动**:
- 顶部新增 10 个 import + lookup table:
  ```tsx
  import { BookInfo as BookInfoAijjxs } from './clone-themes/aijjxs'
  // ... 10 套
  const BookInfoComponent: Record<string, React.ComponentType<BookInfoProps>> = {
    'clone-aijjxs': BookInfoAijjxs, ...
  }
  ```
- lookup table 定义在 render 函数外部 (eslint-react/no-render-defined-component)
- 删除内联 fallback `BookInfoComponent` (旧 19 行 theme.vars 实现)
- render 函数内取 `BookInfoForLayout = BookInfoComponent[theme.layout] || BookInfoAijjxs` (fallback aijjxs)
- JSX 调用从 `<BookInfoComponent>` 改为 `<BookInfoForLayout>` (透传相同 props)

### 1.3 CategoryView.tsx (155 行)

**改动** (与 BookView 同款):
- 顶部新增 10 个 import + lookup table `CatListComponent`
- 删除内联 fallback `CatListComponent` (旧 25 行 theme.vars 实现, 含 IIFE 渲染)
- render 函数内取 `CatListForLayout = CatListComponent[theme.layout] || CatListAijjxs`
- JSX 调用从 IIFE `<CatListComponent>` 改为直接 `<CatListForLayout>`

### 1.4 ReadView.tsx (690 行)

**改动** (与 BookView 同款):
- 顶部新增 10 个 import + lookup table `ReadChromeComponent`
- 删除内联 fallback `ReadChromeComponent` (旧 14 行 theme.vars 实现)
- render 函数内取 `ReadChromeForLayout = ReadChromeComponent[theme.layout] || ReadChromeAijjxs`
- 4 处 JSX 调用 (immersive/paginated/pili/classic) 从 `<ReadChromeComponent>` 改为 `<ReadChromeForLayout>`

### 1.5 RankingView.tsx (126 行)

**改动**:
- 顶部新增 10 个 import + lookup table `CloneRankingViews` (替代空 `{}`)
- lookup table 类型从 `Record<string, React.ComponentType<any>>` 收紧到 `Record<string, React.ComponentType<RankingViewProps>>`
- render 内从 `CloneRankingViews[theme.layout]` (无 fallback) 改为 `CloneRankingViews[theme.layout] || CloneRankingViewAijjxs`
- 早期返回从 `if (CloneRankingView && !loading && data)` 改为 `if (!loading && data)` (fallback 保证 CloneRankingView 恒有值)

### 1.6 FulltextView.tsx (102 行)

**改动** (与 RankingView 同款):
- 顶部新增 10 个 import + lookup table `CloneFulltextViews`
- render 内从 `CloneFulltextViews[theme.layout]` (无 fallback) 改为 `CloneFulltextViews[theme.layout] || CloneFulltextViewAijjxs`
- 早期返回从 `if (CloneFulltext && !loading && data)` 改为 `if (!loading && data)`

### 1.7 SearchView.tsx (342 行)

**改动**:
- 顶部新增 10 个 import + lookup table `CloneSearchViews`
- 删除 `import { ThemeBookList } from './BookCard'` (改为 clone-themes 渲染结果, 不再使用)
- 搜索结果区从 `<ThemeBookList>` 改为 `<CloneSearchView q={q} books={...} loading={...} />`
  - 通过 IIFE 取 `CloneSearchViews[theme.layout] || CloneSearchViewAijjxs`
- 保留顶部搜索框 + 热搜词 + 搜索历史 + 相关搜索词 + EmptyState 等 PSEO 模块不变

### 1.8 KeywordView.tsx (403 行)

**改动**:
- 顶部新增 10 个 import + lookup table `CloneKeywordViews`
- 主+次书籍区从原 PSEO 渲染分支 (loading skeleton / main book card / other books list) 改为条件分发:
  - clone-theme 命中: 渲染 `<CloneKeywordView tag={tag} books={cloneBooks} loading={effectiveLoading} />` (clone-theme 已自带 header + main + others 渲染)
  - 未知 layout: 保留原 PSEO 渲染分支 (Skeleton / main book card / others list)
- `cloneBooks` 构造: `main ? [main as BookItem, ...others补齐] : [...others补齐]`
  - data.otherBooks 是简略结构 `{ id, name, author }`, 用默认值补齐 BookItem 缺失字段 (intro/cover/status/wordCount/category)
- 保留顶部 header + 搜索框 + 相关词云 + 相关搜索等 PSEO 模块不变
- 关键决策: 主+次书籍区与 PSEO 装饰模块分离 — clone-theme 接管主内容区, PSEO 装饰模块 (search/related tags/related search) 持续运行

---

## 2. 部分 2: 噪声清洗审计

### 2.1 cleanContentHtml (cleaner.ts:155-457)

- **R11-1A 增强** (零宽字符剥离): ✓ 完整保留
  - plainText 分支出口: `text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D\uFEFF]/g, '')`
  - HTML 模式出口: `out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D\uFEFF]/g, '').trim()`
- **R11-1A step 1.55** (水印段落识别, 长度闸门 120 字): ✓ 完整保留
- **R17-1A step 5.5** (段首缩进规整 + 段间空行压缩): ✓ 完整保留
  - 段内 `<br>` → 单空格, 全角空格 U+3000 → 半角空格, 段首/段尾 trim
  - 段间空白压缩: `</p>\s*<p>` → `</p><p>`
- **R17-1A plainText 分支段落规整**: ✓ 完整保留
  - `split(/\n{2,}/)` 按双换行分段
  - 段内 `\r`/`\n`/`\u3000` 全部压为单空格, `\s+` 收敛
  - `.filter(Boolean).join('\n\n')` 重组

### 2.2 cleanIntro (cleaner.ts:592-642)

- **R11-1A 零宽字符剥离**: ✓ 完整保留 (`v.replace(/[\u200B-\u200D\uFEFF]/g, '')`)
- **R17-1A 段落规整增强**: ✓ 完整保留
  - `split(/\n{2,}/)` 按双换行分段
  - 段内 `\r`/`\n`/`\u3000` 全部压为单空格
  - `.filter(Boolean).join('\n')` 重组 (单换行, 与 cleanContentHtml `\n\n` 不同)
- **R11-1A 末尾推广段 + 开头元数据剥离**: ✓ 完整保留
- **R11-1A cleanChapterTitle 卷标题剥离**: ✓ 完整保留

### 2.3 结论

cleaner.ts 已具备所有要求的 4 项增强:
1. ✓ 段落处理 (cleanContentHtml step 5.5 + cleanIntro 段间分割)
2. ✓ 空行处理 (split(/\n{2,}/) + filter(Boolean) + join)
3. ✓ 缩进处理 (U+3000 → 半角空格, 段首 trim)
4. ✓ 特殊字符剥离 (零宽字符 + 控制字符)

不重复添加 (R11-1A / R17-1A 增强完整保留).

---

## 3. 部分 3: 深度审计

### 3.1 fetcher.ts inflightMap TOCTOU (R14-1B 修复验证)

**位置**:
- `fetchPage` inflight (line 3873-3902)
- `tokenInflight` (line 3554-3586)

**修复**:
```ts
// 修前(有 bug): inflightMap.delete(dedupKey) // 无条件 delete
// 修后(R14-1B):
const cur = inflightMap.get(dedupKey)
if (cur === entry) inflightMap.delete(dedupKey)  // entry 引用对比
```

**审计**: ✓ 正确
- 两处 (fetchPage + tokenInflight) 均用 entry 引用对比, 避免误删后来 caller 的条目
- 注释完整: "修前: 无条件 delete(dedupKey), 若本条目已被后来 caller 覆盖... 此处 delete 会误删新 caller 的条目"
- entry 写入 inflightMap.set(dedupKey, entry) 在 finally 之前执行, 保证 cur === entry 判定有效

### 3.2 runner.ts control() 定时器泄漏 (R14-1B 修复验证)

**位置**: runner.ts:435-458

**修复**:
```ts
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
    if (raceTimer) clearTimeout(raceTimer)  // R14-1B fix
  }
})
```

**审计**: ✓ 正确
- `raceTimer` 用 `let` 声明 + 在 Promise 构造器内赋值, finally 内引用同一变量
- try/finally 保证快路径(controlInner 提前 settled)下 timer 立即释放
- 注释完整: "30s 超时定时器在 controlInner 快路径下从未被 clearTimeout"
- raceTimer 类型 `ReturnType<typeof setTimeout> | undefined` 正确 (NodeJS.Timeout / number 兼容)

### 3.3 AbortController clearTimeout (fetcher.ts 3 处)

**位置**:
- `fetchProxy` (line 2243 + 2278 finally)
- `fetchPageUncached` (line 2591 + 2799 finally)
- `fetchBinary` (line 4363 + 4441 finally)

**审计**: ✓ 全部正确, try/finally 模式, clearTimeout 在 finally 块内

### 3.4 controlChains Map 清理 (runner.ts:204/435/454/456)

**审计**: ✓ 正确
- `const tail = run.catch(() => {})` (避免 unhandled rejection)
- `this.controlChains.set(taskId, tail)`
- 异步清理: `void tail.then(() => { if (this.controlChains.get(taskId) === tail) this.controlChains.delete(taskId) })`
- 引用对比避免误删后续 chain

### 3.5 BookView/CategoryView/ReadView lookup table 位置

**审计**: ✓ 全部在 render 函数外部定义
- BookView.tsx: `const BookInfoComponent: Record<...> = {...}` 在 line 43 (render BookView 在 line 424)
- CategoryView.tsx: `const CatListComponent: Record<...> = {...}` 在 line 32 (render CategoryView 在 line 45)
- ReadView.tsx: `const ReadChromeComponent: Record<...> = {...}` 在 line 51 (render ReadView 在 line 84)
- 类型签名: `Record<string, React.ComponentType<{...}>>` (强类型, 非 any)
- 符合 eslint-react/no-render-defined-component 规则

### 3.6 RankingView/FulltextView/SearchView/KeywordView lookup table 位置

**审计**: ✓ 全部在 render 函数外部定义
- RankingView.tsx: `const CloneRankingViews: Record<...> = {...}` 在 line 34 (render RankingView 在 line 56)
- FulltextView.tsx: `const CloneFulltextViews: Record<...> = {...}` 在 line 33 (render FulltextView 在 line 46)
- SearchView.tsx: `const CloneSearchViews: Record<...> = {...}` 在 line 32 (render SearchView 在 line 45)
- KeywordView.tsx: `const CloneKeywordViews: Record<...> = {...}` 在 line 38 (render KeywordView 在 line 51)
- 类型签名全部收紧到具体 props 接口 (`React.ComponentType<RankingViewProps>` 等), 非 any

### 3.7 clone-themes 10 套 × 8 组件 Skeleton + 空态审计

**审计结果** (10 套 × 8 组件 = 80 文件):

| 组件 | Skeleton (BookGridSkeleton) | 空态 (EmptyState / 暂无) | 备注 |
|------|------|------|------|
| HomeClone | 10/10 ✓ | 10/10 ✓ | loading → BookGridSkeleton, !books → EmptyState |
| BookInfo | 0/10 ⚠ | 10/10 ✓ | 单本书展示, 不需要 Skeleton (父 BookView 已用 Sk 占位) |
| CategoryList | 10/10 ✓ | 10/10 ✓ | loading → BookGridSkeleton, !books → EmptyState |
| ReadChrome | 0/10 ⚠ | 0/10 ⚠ | chrome 外壳, 无独立 loading/empty 语义 (父 ReadView 已用 ErrorState) |
| RankingView | 10/10 ✓ | 10/10 ✓ | loading → BookGridSkeleton, !books → EmptyState |
| FulltextView | 10/10 ✓ | 10/10 ✓ | loading → BookGridSkeleton, !books → EmptyState |
| SearchView | 10/10 ✓ | 10/10 ✓ | loading → BookGridSkeleton, !books → EmptyState |
| KeywordView | 10/10 ✓ | 10/10 ✓ | loading → BookGridSkeleton, !books → EmptyState |

**结论**:
- 6 个组件 (HomeClone/CategoryList/RankingView/FulltextView/SearchView/KeywordView) 全套 ✓ 有 Skeleton + 空态
- BookInfo (10 套): 无 Skeleton, 但父 BookView 在 loading 状态用 `<Sk>` 占位 (line 668-680), 数据到达后才渲染 BookInfo, 不存在 BookInfo 内部 loading 状态. 空态: 当 book null 时 BookView 不渲染 BookInfo (走 loading 分支). ✓ 设计合理, 不补 Skeleton
- ReadChrome (10 套): 无 Skeleton/EmptyState, 但父 ReadView 在 error/no chapterId 时用 `<ErrorState>` 占位 (line 476-477), 数据到达后才渲染 ReadChrome 包裹 children. ✓ 设计合理, 不补 Skeleton

**未发现 bug**, 6 个组件设计模式一致, BookInfo/ReadChrome 是单元素/chrome 外壳, Skeleton 由父组件负责.

### 3.8 文件计数审计

- clone-themes/ 总文件数: 100 (10 站点 × 10 文件 = 80 .tsx + 20 .ts)
- 8 组件 × 10 站点 = 80 .tsx ✓
- index.ts × 10 站点 = 10 .ts ✓
- shared.ts × 10 站点 = 10 .ts ✓

---

## 4. 验证

### 4.1 TypeScript 编译

```bash
$ bunx tsc --noEmit
# 仅 examples/skills 预存在错误 (与本次改动无关), src/ 0 errors ✓

$ bunx tsc --noEmit --noUnusedLocals --noUnusedParameters
# src/ 0 errors ✓ (10 套 import 全部使用, 无未使用变量)
```

### 4.2 ESLint

```bash
$ bun run lint
$ eslint .
# exit 0, 0 errors / 0 warnings ✓
```

### 4.3 运行时冒烟测试 (10 主题 × home 视图)

```bash
$ for theme in clone-aijjxs clone-ddyueshu clone-pilishuwu clone-23qb clone-101kks \
              clone-huangjinwu clone-ggd66 clone-shipsay clone-x2552 clone-trxsw; do
    curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/?view=home&theme=$theme"
done
# 10 个主题全部 200 OK ✓
```

### 4.4 多视图冒烟测试 (clone-aijjxs 主题)

```bash
$ curl /?view=home&theme=clone-aijjxs       # 200 ✓
$ curl /?view=book&theme=clone-aijjxs       # 200 ✓
$ curl /?view=ranking&theme=clone-ddyueshu  # 200 ✓
$ curl /?view=fulltext&theme=clone-23qb     # 200 ✓
$ curl /?view=search&q=test&theme=clone-101kks  # 200 ✓
$ curl /?view=keyword&tag=test&theme=clone-huangjinwu  # 200 ✓
$ curl /?view=category&cat=1&theme=clone-ggd66  # 200 ✓
```

### 4.5 dev server log 检查

- ✓ 无 error / warning / fail 日志
- ✓ 10 个 clone-* 主题渲染耗时 26-47ms (正常区间)
- ✓ Compiled 成功 (无 TypeScript / ESLint 编译错误)

---

## 5. 修改文件清单 (R19-1B 净改动)

### 5.1 视图接线 (8 文件)

- `src/components/public/HomeView.tsx` (新增 10 dynamic import + CLONE_LAYOUTS + 分发分支 + navCategoryCount/homeModuleLimit 透传)
- `src/components/public/BookView.tsx` (顶部 lookup table, 删除内联 BookInfoComponent fallback)
- `src/components/public/CategoryView.tsx` (顶部 lookup table, 删除内联 CatListComponent fallback)
- `src/components/public/ReadView.tsx` (顶部 lookup table, 删除内联 ReadChromeComponent fallback)
- `src/components/public/RankingView.tsx` (lookup table 填充 10 套, 类型收紧, fallback aijjxs)
- `src/components/public/FulltextView.tsx` (lookup table 填充 10 套, 类型收紧, fallback aijjxs)
- `src/components/public/SearchView.tsx` (新增 lookup table, 替换 ThemeBookList 为 CloneSearchView)
- `src/components/public/KeywordView.tsx` (新增 lookup table, clone-theme 命中时主+次书籍区走 CloneKeywordView)

### 5.2 不修改的文件 (尊重约束)

- `bits.tsx` / `seo.ts` / `ctx.tsx` / `BookCover.tsx` / `types.ts` / `cleaner.ts` / `suggest.ts` / `fetcher.ts` / `obscura.ts` / `runner.ts` / `parser.ts` / `themes.ts` 全部未动
- clone-themes/<site>/* 100 文件未动 (R19-1A 创建, R19-1B 仅接线引用)
- 未安装新 npm 包 (0 新依赖)

### 5.3 R13~R18 修改全部保留 (不回滚)

- R13-1A PSEO 集成 (suggest.ts/PSEOKeywordsSection) ✓
- R14-1B fetcher.ts entry 引用对比 + runner.ts control timer try/finally ✓
- R14-1A theme.contentSelector 透传 ✓
- R15-1A/B clone-themes 模块化结构 (50 → 100 文件) ✓
- R16-1A/B/C CloneCSSLoader + 18 TDK 预设 ✓
- R17-1A cleaner.ts 3 处增强 (cleanContentHtml step 5.5 / cleanIntro / cleanChapterTitle) ✓
- R17 重构 8 页型 clone-themes 模块 ✓
- R18-1A BookView/CategoryView/ReadView 三视图 clone-themes lookup table 回归 (R19-1B 替代: 全面接线) ✓

---

## 6. 设计决策与注意事项

### 6.1 lookup table vs switch 分发

- HomeView 用 switch 分发 (`theme.layout === 'clone-XXX' && <Comp />`) 保留 R15-1B 原实现
  - 原因: dynamic import 的组件类型推断复杂, switch 分发对 IDE 跳转/补全更友好
  - 10 条 `{theme.layout === 'clone-XXX' && <HomeCloneXXX .../>}` 简单直接
- 其他 7 视图用 lookup table (`Record<layout, ComponentType>`)
  - 原因: 直接 import (非 dynamic), 类型可静态推断, lookup table 更紧凑
  - fallback 模式 `Component[theme.layout] || ComponentAijjxs` 一致

### 6.2 fallback 走 aijjxs 的统一口径

- 与 R15-1B / R18-1A 同口径: 未知 layout 时 fallback 走 aijjxs (首个 clone 主题)
- 不走"通用 theme.vars 兜底" — 因为 R19-1A 已保证 10 套齐全, 不会出现"无 clone-themes" 状态
- HomeView 例外: 保留 `GenericBookGrid` 兜底 (theme.vars 通用网格) — 因 HomeView 是入口页, 兜底必须保证不白屏

### 6.3 KeywordView 主+次书籍区与 PSEO 装饰模块分离

- clone-theme 命中时: 主+次书籍区走 CloneKeywordView (clone-theme 自带 header + main + others)
- PSEO 装饰模块 (顶部搜索框 / 底部相关词云 / 底部相关搜索) 持续运行, 不被 clone-theme 替代
- 原因: PSEO 是 R13-1A 引入的 SEO 长尾词落地页核心特性, 不能因切 clone-theme 而丢失
- 副作用: clone-theme 命中时页面会出现两个 header (顶部 PSEO header + clone-theme 内部 header) — 接受此重复, 因 PSEO header 含 "{关键词} 相关小说推荐" 文案对 SEO 有价值

### 6.4 cloneBooks 类型补齐 (KeywordView)

- data.otherBooks 类型: `{ id: string; name: string; author: string }[]` (简略结构)
- clone-theme KeywordView 期望: `BookItem[]` (完整字段)
- 用默认值补齐: `{ ...b, intro: '', cover: '', status: 'unknown' as const, wordCount: 0, category: '' }`
- clone-theme 内部 others 渲染只用 id/name/author (查看 aijjxs/KeywordView.tsx line 130-165), 补齐字段不被实际渲染, 仅满足类型契约

---

## 7. 未来工作建议

### 7.1 clone-themes 共享组件抽取 (低优先级)

- BookInfo ActionButtons 行 (~30 行 × 10 套 = ~300 行重复)
- CategoryList 筛选 chip 行 (~10 行 × 9 套 = ~90 行重复)
- ReadChrome 翻页栏 (~15 行 × 9 套 = ~135 行重复)
- 评估: R15-1C 已审视同款, 视觉差异 5+ 维度, 抽取易引入回归 — 不抽取

### 7.2 scripts/ 归档候选 (低优先级)

- R14-1C 列出 6 个归档候选仍有效 (test-themes-9/fix-aijjxs-bookurl/fix-aijjxs-toplist-toc/probe-all/fix-dd-b-stale-task/mock-novel-site)
- R19-1A 新增 scripts/gen-clone-themes-r19.cjs (生成器脚本, 已完成生成任务)
- 不真移动, 等主代理批准后再 mv 到 scripts/archive/

### 7.3 KeywordView 双 header 优化 (低优先级)

- 当前 clone-theme 命中时, 顶部 PSEO header + clone-theme 内部 header 同时出现
- 优化方向: clone-theme 命中时跳过顶部 PSEO header (但其 SEO 文案价值需保留到 meta description)
- 评估: 收益小 (视觉冗余度降低) vs 风险中 (SEO 文案丢失), 不优先

---

## 8. 总结

- **接线完整性**: 8 视图全部接 clone-themes lookup table, 10 套主题全部可分发 ✓
- **历史 bug 修复**: fetcher.ts entry 引用对比 + runner.ts control timer try/finally + 3 处 AbortController clearTimeout 全部正确保留 ✓
- **clone-themes Skeleton/空态**: 6 列表组件全套 ✓, 2 单元素/chrome 外壳组件由父视图负责 ✓
- **类型安全**: 全部 lookup table 收紧到具体 props 接口 (`React.ComponentType<BookInfoProps>` 等), 非 any ✓
- **eslint 合规**: 全部 lookup table 在 render 函数外部定义 ✓
- **零回归**: tsc 0 errors / lint 0 errors / 10 主题运行时 200 OK / dev log 无错误 ✓
