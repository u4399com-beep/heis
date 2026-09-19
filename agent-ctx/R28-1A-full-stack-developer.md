# R28-1A — 清理精简 + clone-themes 重复提取

## 任务概述
- **Task ID**: R28-1A
- **Agent**: full-stack-developer (清理精简 + clone-themes 重复提取)
- **范围**: src/components/public/clone-themes/* + scripts/* (不碰 crawl 核心 / page.tsx / themes.ts / prisma)
- **目标**: R27-1C 留下的脚本审查 + clone-themes 重复代码提取 + dead code 扫描 + 复杂函数精简 + 过时注释清理

## 工作记录

### 1. 审查 R27-1C 留下脚本 (v1 + v2 Python refactor)
- v1 脚本 (165 行): regex 匹配 goCat+goHome+goSearch 整块, 替换为 cloneNavHandlers destructure; v2 脚本 (168 行): 更灵活匹配允许中间夹杂其他 handler
- 评估: v1 有 bug (`if "name" in dir()` 无意义); 两脚本要求 goSearch 必须存在, 不适用 ddyueshu BookInfo/CategoryList 等只有 goHome 的 6 个文件
- **决策**: 删除两个 Python 脚本 (已部分应用, 剩余 8 个文件改用手写 Python r28-1a-gohome.py 处理)

### 2. 删除过时一次性脚本 (5 个)
- `scripts/_r27-1c-refactor-clone-themes.py` (R27-1C one-shot, 已应用)
- `scripts/_r27-1c-refactor-clone-themes-v2.py` (R27-1C one-shot v2, 已应用)
- `scripts/batch-update-clones.mjs` (R24 one-shot 加 initialCategories prop, 已应用)
- `scripts/gen-clone-themes-r19.cjs` (R19 generator 1465 行, 重跑会 clobber R27-1C 重构)
- `scripts/test-themes-9.ts` (R10 验证脚本, 断言 THEMES.length=9 但当前=10, 失效)

### 3. clone-themes 重复代码提取 (核心工作, 净减 690 行)

#### 3a. 替换 cats fetch 块为 useCloneCategories (47 文件)
- 模式: `useState<Cat[]> + useEffect + fetch('/api/public/categories?limit=60')` (15-20 行/文件)
- 替换: `const cats = useCloneCategories(initialCategories[, DEFAULT_NAV])` (1 行)
- 净减: ~47 × 16 = ~750 行
- 兼容: useCloneCategories 内部已含 SSR initialCategories 优先 + cats 为空时 fetch + DEFAULT_NAV 兜底逻辑 (行为与原一致)
- 实现: `.tmp/r28-1a-refactor.py` (regex 双 pattern, 区分带/不带 DEFAULT_NAV)
- 文件清单 (10 套主题 × 主要 4-5 文件):
  - aijjxs × 8 (BookInfo/CategoryList/FulltextView/HomeClone/KeywordView/RankingView/ReadChrome/SearchView)
  - ggd66 × 8, pilishuwu × 7, trxsw × 7, shipsay × 7, x2552 × 7, huangjinwu × 2 (仅 CategoryList/FulltextView)
  - ddyueshu × 1 (HomeClone, 无 DEFAULT_NAV 走 no-fallback pattern)
  - 23qb/HomeClone + 101kks/HomeClone 已有 useCloneCategories (SKIP)

#### 3b. 替换单 goHome handler 为 cloneNavHandlers (6 文件)
- 模式: `const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }` (无 goSearch/goCat)
- 替换: `const { goHome } = cloneNavHandlers(navigate, 'searchkey')` (单参数 destructure)
- 文件: ddyueshu/{BookInfo,CategoryList,FulltextView,KeywordView,RankingView} + 101kks/ReadChrome
- 实现: `.tmp/r28-1a-gohome.py`

#### 3c. ddyueshu/HomeClone 完整重构
- 删除: `interface Cat` (不再使用, 因 cats 来自 useCloneCategories)
- 替换: 本地 `goCat = (e, catId) => {...}` 为 cloneNavHandlers destructure `goCat`
- 删除: stale `R24: SSR 首载...` + `R24: cats 为空时才 fetch...` 注释 (已被 R28-1A 注释替代)

#### 3d. shipsay/HomeClone 同款清理
- 删除: `interface Cat` (不再使用)
- 删除: stale R25 SSR/fetch 注释

### 4. 过时注释清理 (11 文件)
- 模式: `// R24: SSR 首载...` + `// R24: cats 为空时才 fetch...` (紧跟在已被替换的 useEffect 后)
- 替换: 已有 `// R28-1A: 复用 useCloneCategories (...)` 注释自解释, R24 注释冗余
- 文件: aijjxs/ggd66/pilishuwu/trxsw/x2552/HomeClone + shipsay/{BookInfo,CategoryList,FulltextView,KeywordView,RankingView,SearchView}

### 5. 双空行合并 (27 文件)
- 重构删除 useEffect 块后留双空行, 不影响逻辑但不美观
- 实现: `.tmp/r28-1a-collapse-blanks.py` (regex `\n\n\n+` → `\n\n`)

## 跳过的工作 (低 ROI / 高风险)

### 跳过: pagination 替换 clonePageItems (27 文件未做)
- 现状: 9 套主题 (除 23qb) 各自实现 `start = Math.max(1, page - N) + end = Math.min(totalPages, start + M)`
- 调研: clonePageItems 是对称窗口 (from = page - half, to = from + window - 1), 但各主题实际为非对称:
  - 101kks: page-2..page+9 (11 页, 当前页第 3)
  - aijjxs/shipsay: page-5..page+9 (10 页, 当前页第 6)
  - trxsw/pilishuwu/ggd66/huangjinwu/x2552: page-4..page+9 (10 页, 当前页第 5)
  - ggd66: page-4..page+8 (9 页, 当前页第 5)
- 决策: 跳过 — clonePageItems 改造会引入对称窗口, 改变源站分页 UX (当前页位置漂移)
- 替代方案: clonePageItems 加 before/after 参数支持非对称 (留给后续 R29 处理, 当前不优先)

### 跳过: header/footer/search-form 跨主题提取
- 现状: 各主题 header/footer 用源站真实 class 名 (.header_logo/.header_search/.foot/.footer 等), DOM 结构差异大
- 决策: 跳过 — 提取共享 header 会破坏 1:1 克隆 (各主题源站 DOM 不同, 共享组件会引入无意义 wrapper 或破坏 class 名)

## 验证

### 代码质量
- `bun run lint` → **0 errors / 0 warnings** ✓
- `bunx tsc --noEmit` (排除 examples/skills/.next) → **0 errors** ✓

### 净减代码
- 53 个 clone-themes 文件 modified
- 插入 174 行, 删除 864 行 → **净减 690 行** (~21% 减少)
- 删除 5 个过时 scripts (~1700 行)
- 总计净减 ~2400 行

### 功能零回归
- useCloneCategories 行为与原 useState+useEffect 一致: SSR initialCategories 优先 → cats 为空时 fetch → DEFAULT_NAV 兜底 (针对有 DEFAULT_NAV 的主题) / 不兜底 (针对 ddyueshu 无 DEFAULT_NAV)
- cloneNavHandlers 行为与原 local goHome/goSearch/goCat 一致 (单参数 destructure)
- 各主题 DEFAULT_NAV 硬编码兜底全保留 (per-theme 真实分类, 不动)
- 各主题 navCats 切片逻辑全保留 (per-theme 分类数量差异)
- 主题 CSS class 名全保留 (1:1 克隆 DOM 不动)

## 不碰的文件 (零回归约束)
- src/lib/crawl/{fetcher,obscura,runner}.ts (采集核心, 其他 agent 工作)
- src/components/public/{BookView,read-layouts/shared}.tsx (R28-1B 工作)
- src/app/api/public/feedback/route.ts (R28-1C 工作)
- page.tsx / PublicSite.tsx / HomeView.tsx / themes.ts / prisma/schema.prisma (主控已改 / 不动)

## 修改文件清单
- 53 个 src/components/public/clone-themes/*/*.tsx (主要修改)
- 5 个 scripts/ 删除 (R10/R19/R24/R27-1C 一次性脚本)

## 后续建议 (留给 R29)
1. clonePageItems 加非对称窗口支持 (before/after 参数) 后, 27 个 pagination 文件可继续提取
2. 各主题 HOT_KEYWORDS/TOPIC_LIST 占位文案可以提取到 themes.ts 配置 (各主题源站真实热搜词)
3. DEFAULT_NAV 16 个分类硬编码也可以考虑提取 (但与 fetch 失败兜底强耦合, 优先级低)
