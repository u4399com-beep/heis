# R15-1C 代码清理整合优化计划

> Task ID: R15-1C | 子代理(深度审计+bug修复+清理整合) | 2026-09-22
> 范围: clone-themes/ 10 套主题模块(50 文件) + 接线视图(HomeView/BookView/CategoryView/ReadView) +
> read-layouts/ 4 文件 + crawl/ 3 模块(fetcher/runner/suggest 抽样) + scripts/ 49 ts

## 1. R15-1A/B 新增代码审计

### 1.1 clone-themes/ 目录结构 (R15-1A 创建, R15-1B 接线)

```
src/components/public/clone-themes/
├── shared-props.ts                  # 4 个 props 类型 (BookInfoProps/CategoryListProps/HomeCloneProps/ReadChromeProps)
├── aijjxs/                          # 5 文件
│   ├── HomeClone.tsx (~343 LoC)
│   ├── BookInfo.tsx (~102 LoC)
│   ├── CategoryList.tsx (~93 LoC)
│   ├── ReadChrome.tsx (~67 LoC → R15-1C 扩展到 ~75)
│   └── index.ts (4 行 re-exports)
├── ddyueshu/  (5 文件, ~522 LoC 总)
├── pilishuwu/ (5 文件, ~416 LoC 总)
├── 23qb/      (5 文件, ~406 LoC 总)
├── 101kks/    (5 文件, ~335 LoC 总)
├── huangjinwu/ (5 文件, ~421 LoC 总)
├── ggd66/     (5 文件, ~361 LoC 总)
├── shipsay/   (5 文件, ~402 LoC 总)
├── x2552/     (5 文件, ~368 LoC 总)
└── trxsw/     (5 文件, ~440 LoC 总)
```

**总计**: 51 文件, ~4.2k LoC.

**审计结果**: 全部活文件, 4 个 props 类型全部被引用, 10 套 index.ts 全部被 HomeView/BookView/CategoryView/ReadView 引用.
   无 dead clone-themes 文件.

### 1.2 接线视图 (R15-1B 重构)

| 视图 | R15-1B 改动 | 状态 |
|---|---|---|
| `HomeView.tsx` | 10 个 dynamic import 从 `./layouts/HomeClone*.tsx` 改为 `./clone-themes/<site>`; 10 个分发分支保留 | ✓ 全部活 |
| `BookView.tsx` | 删除 `import { BookInfoLayout }`; 改为 lookup table 选择 clone-themes/<site>/BookInfo (10 项 + 兜底 BookInfoAijjxs) | ✓ 全部活 |
| `CategoryView.tsx` | 删除 `import { ThemeBookList } from './BookCard'` + `import { Pagination } from './Pagination'`; 改为 lookup table 选择 clone-themes/<site>/CategoryList (10 项 + 兜底 CatListAijjxs) | ✓ 全部活 |
| `ReadView.tsx` | 新增 10 个 ReadChrome import; 新增 lookup table 选择 ReadChromeComponent; 新增 handlePrevChapter/handleNextChapter 通过 readerActionsRef 透传 | ✓ 全部活 |

## 2. R15-1B 残留: Pagination.tsx 孤儿 (R15-1C 已删)

| 文件 | R15-1B 改动 | R15-1C 处理 |
|---|---|---|
| `src/components/public/Pagination.tsx` (128 LoC) | R15-1B 删除 CategoryView 中 `import { Pagination } from './Pagination'`, 但未删 Pagination.tsx 本身 → 孤儿(全域 0 import, 仅 shared.tsx:160 一处注释提及) | ✗ R15-1C 已删 (-128 行 dead code) |

**清理说明**: 
- 全域 `rg "from ['\"](\.\.?/)+Pagination['\"]" src/` 0 命中
- 全域 `rg "<Pagination\b" src/` 0 命中
- 删除后 tsc + lint 通过, 无回归

## 3. R15-1C 修复落地清单

### 3.1 P2 修复 (5 项已应用)

| # | 文件 | 改动 | 类型 |
|---|---|---|---|
| 1 | `clone-themes/aijjxs/ReadChrome.tsx` | 签名从 `{ children, chapterTitle }` 扩展为 `ReadChromeProps`, 与其它 9 套一致; onPrev/onNext 静默忽略(源站 chrome 无翻页按钮) | P2 类型一致 |
| 2 | `clone-themes/101kks/HomeClone.tsx` BookCard | `<div onClick>` → `<a href onClick={preventDefault}>` (键盘可达 + 屏读器识别为链接) | P2 a11y |
| 3 | `clone-themes/101kks/CategoryList.tsx` booklist-card | 同上 | P2 a11y |
| 4 | `BookView.tsx:5-7` | 追加 R15-1B 注释行, 说明 BookInfoLayout 已废弃迁移至 clone-themes/<site>/BookInfo | P2 过时注释 |
| 5 | `HomeView.tsx:8-9` | 追加 R15-1B 注释行, 说明 10 套 clone-themes/<site>/{HomeClone,BookInfo,CategoryList,ReadChrome,index.ts} 结构 | P2 过时注释 |

### 3.2 dead code 删除 (1 项)

| # | 文件 | 改动 | LoC |
|---|---|---|---|
| 1 | `src/components/public/Pagination.tsx` | 全文件删除 (R15-1B 未清理的孤儿) | -128 行 |

### 3.3 注释更新 (2 项)

| # | 文件 | 改动 |
|---|---|---|
| 1 | `read-layouts/ReadClassic.tsx:113` | "9 套 clone-* 主题" → "10 套 clone-* 主题" (R13-1B 后扩为 10 套, 当前状态描述同步) |
| 2 | `read-layouts/shared.tsx:160` | 移除 "与 Pagination.tsx 同色系" 引用 (Pagination.tsx 已删) + 追加 R15-1C 说明 |

## 4. 未修不动的 P2 (5 项, 已说明原因)

| # | 位置 | 现象 | 不修原因 |
|---|---|---|---|
| 1 | `clone-themes/aijjxs/BookInfo.tsx:43` | "加入收藏" `<a href="javascript:;">` 无 onClick (dead click) | 视觉克隆约束 + 类似 dead click 在其它 9 套也有, 统一改造工作量大, 留作后续小步重构 |
| 2 | 9 套 CategoryList 筛选 chip 无 onClick (decorative) | "全部/玄幻/武侠/..." chip 不可点 | 改造需 CategoryView 加 onFilter callback + 跨 10 套组件接口变更, 属 feature 添加非 bug 修复 |
| 3 | `CategoryView.tsx:118-142` 双重 loading 指示器 | CategoryList 内部 "加载中..." + 外层 Sk Skeleton 同时显示 | 删除任一 loading 指示器会改视觉, 违反"视觉完全等价"约束 |
| 4 | 9 套 ReadChrome 的 NAV_ITEMS 等装饰性导航无 onClick | "首页"以外 nav 项无 onClick, 静默忽略 | 源站导航是子页面链接(/txt/chuanyue/ 等), 本系统无对应路由, 视觉克隆保留 |
| 5 | 9 套 ReadChrome `<a href="javascript:;">` 翻页按钮模式 | 用 javascript: 伪 URL 而非 button | 源站翻页按钮用 `<a href="javascript:;" onclick>` 模式, 视觉/行为克隆保留 |

## 5. 重复逻辑审计 (clone-themes 共享组件候选)

### 5.1 BookInfo ActionButtons 行 (~30 行 × 10 套 = ~300 行重复)

**重复模式**: 10 套 BookInfo 均有类似的 action button 行:
```tsx
<ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
{savedPos?.chapterId && (
  <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', ... })} style={{ ... }}>
    继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
  </button>
)}
<button type="button" onClick={onScrollToc} style={{ ... }}>目录</button>
<a href={`/api/public/download?book=${book.id}`} style={{ ... }}>TXT 下载</a>
<ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
```

**差异点** (跨 10 套):
- 边框色: BRAND / LINK / PRIMARY / LOGO / HOVER 等 (10 个不同值)
- 强调色 (TXT 下载): ACCENT / LINK / PRIMARY / HOVER 等
- 文本: "开始阅读" (简体) / "開始閱讀" (101kks 繁体) / "目录" / "目錄" (101kks)
- 圆角: RADIUS (4-14px 不等)

**决策**: **不抽取**. 理由:
1. 抽取需 5+ 个 style props + 2 个 label props (简繁) + RADIUS prop = 复杂 props 接口
2. 抽取后净收益: -300 行重复 + ~80 行共享组件 = -220 行, 但每个 BookInfo 仍需 ~15 行配置调用
3. 视觉差异大于 R14-1C 的 BookInfoMeta (后者仅 4 维度), 抽取易引入回归
4. R14-1A 的 BookInfoLayout.tsx 已删, 重新引入共享组件与 R15-1A/B 拆分方向相反

### 5.2 CategoryList 筛选 chip 行 (~10 行 × 9 套 = ~90 行重复)

**重复模式**: 9 套 CategoryList 均有:
```tsx
{['全部', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生'].map((n, i) => (
  <a key={n} href="javascript:;" style={{ ... background: i === 0 ? PRIMARY : '#fff', ... }}>{n}</a>
))}
```

**差异点**:
- PRIMARY 色 (10 个不同值)
- 圆角 (RADIUS / '999px' for pill 等)
- 简繁 ("全部" vs "全部" / 部分繁体)

**决策**: **不抽取**. 理由:
1. chip 当前不可点 (decorative, 见 §4.2 不修原因)
2. 抽取需 PRIMARY/RADIUS/简繁 3 个 props + 数组传递, 净收益小
3. 未来若加 onFilter 功能 (跨 9 套的接口变更), 再统一抽取更合适

### 5.3 ReadChrome 翻页栏 (~15 行 × 9 套 = ~135 行重复)

**重复模式**: 9 套 ReadChrome 均有 (aijjxs 除外, 源站无翻页按钮):
```tsx
{onPrev && <a href="javascript:;" onClick={onPrev} style={{ ... }}>{prevLabel}</a>}
<a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ ... }}>返回首页</a>
{onNext && <a href="javascript:;" onClick={onNext} style={{ ... }}>{nextLabel}</a>}
```

**差异点**:
- PRIMARY/LINK 色 (10 个不同值)
- 圆角 + 字号 + margin
- "返回首页" / "返回首頁" (101kks 繁体)

**决策**: **不抽取**. 理由:
1. 视觉差异较大 (10 套 PRIMARY 色各异)
2. 9 套 ReadChrome 总 LoC 仅 ~570 (平均 ~63 行/文件), 抽取后总收益小
3. R14-1A 已删 BookInfoLayout 中转层, 重新引入共享 ReadChromeNav 与方向相反

### 5.4 lookup table 简化 (4 个视图, 每个 10 项)

**当前模式** (BookView.tsx line 638-649):
```tsx
const BookInfoComponent = {
  'clone-aijjxs': BookInfoAijjxs,
  'clone-ddyueshu': BookInfoDdyueshu,
  ... // 10 项
  'clone-trxsw': BookInfoTrxsw,
}[theme.layout] || BookInfoAijjxs
```

**简化候选 1**: 用 theme.layout 直接构造 key 路径 (无 lookup)
```tsx
const BookInfoComponent = THEME_BOOKINFO_MAP[theme.layout] ?? BookInfoAijjxs
```
- 优点: 提取 map 到常量, 视图文件 -10 行
- 缺点: 需新增 THEME_BOOKINFO_MAP / THEME_CATEGORY_LIST_MAP / THEME_READ_CHROME_MAP 常量文件, 实际净收益小

**简化候选 2**: 工厂函数 `getBookInfoFor(theme.layout)`
- 优点: 单点维护
- 缺点: 增加间接层, 调试更难

**决策**: **不简化**. 理由:
1. lookup table 模式可读性强, IDE 跳转方便
2. 4 个 lookup table 总计 ~40 行, 不构成性能或维护负担
3. R13-1D / R14-1C 已审视同款 lookup, 沿用决策

## 6. scripts/ 归档候选 (R14-1C 列表已覆盖, R15-1C 无新增)

R15-1A/B 未新增 scripts/ 文件. R14-1C 已列出的 6 个归档候选仍有效:

| 文件 | 大小 | 理由 | R14-1C 状态 |
|---|---|---|---|
| `scripts/test-themes-9.ts` | 14 行 | 断言 THEMES.length=9 (R13-1B 后 =10, 断言失效) | R13-1D 已列 |
| `scripts/fix-aijjxs-bookurl.ts` | 41 行 | 一次性 DB 修复, 已应用 | R13-1D 已列 |
| `scripts/fix-aijjxs-toplist-toc.ts` | 145 行 | 一次性 DB 修复, 已应用 | R13-1D 已列 |
| `scripts/probe-all.ts` | 119 行 | 一次性探针, 数据已落 agent-ctx/probe-html2/ | R13-1D 已列 |
| `scripts/fix-dd-b-stale-task.ts` | 88 行 | 一次性 DB 修复 (清理 stale running 任务), 已应用 | R14-1C 新增 |
| `scripts/mock-novel-site.ts` | 78 行 | mock 站 (端口 3030), 全域 0 spawn 引用 | R14-1C 新增 (低优先) |

**R15-1C 决策**: 沿用 R14-1C 决策, 不真移动, 等主代理批准后再 mv 到 scripts/archive/.

## 7. 未使用 export 候选 (R14-1C 已审视, R15-1C 复核无新发现)

### 7.1 clone-themes/ 内部 export (R15-1C 新审)

| 文件 | export | 引用方 | 决策 |
|---|---|---|---|
| `clone-themes/<site>/index.ts` × 10 | HomeClone/BookInfo/CategoryList/ReadChrome | HomeView/BookView/CategoryView/ReadView 各 1 引用 | ✓ 全部活 |
| `clone-themes/shared-props.ts` | BookInfoProps/CategoryListProps/HomeCloneProps/ReadChromeProps | 50 个组件文件全部引用 | ✓ 全部活 |

无 dead export.

### 7.2 R13-1D / R14-1C 已决定保留的 de-export 候选 (不动)

沿用 R14-1C §4.3 决策:
- `parser.ts` extractMetaTags/extractJsonLd/extractTable
- `sorter.ts` romanToNumber
- `obscura.ts` isMobileUaLocal
- `storage.ts` DownloadTxtWriter (interface)
- `smart.ts` matchCategoryByText
- `hostgate.ts` 6 常量 + normalizeIpLiteral + isPrivateIp
- `fetcher.ts` detectHttp3AltSvc / SCRAPLING_BROWSER_CONCURRENCY / isProxyCascadePaused / COOKIE_CONSENT_SELECTORS / acceptCookieConsent / clearSessionPersonality / closeAllHostDispatchers / isHostInCaptchaCooldown
- `auto-tdk.ts` extractKeywords / generateDescription / TDKResult

## 8. 未使用 import (R15-1C 复核)

```
$ bunx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1 | grep -v "examples\|skills"
(empty)
```

src/ 全域 0 警告. (R15-1C 编辑的 5 个文件均通过 tsc 严格检查)

## 9. 过时注释清单 (R15-1C)

### 9.1 R15-1C 已修 (见 §3.3)

| 文件 | 行号 | 内容 | 处理 |
|---|---|---|---|
| `BookView.tsx` | 5-7 | "R14-1A: ...10 套 BookInfoLayout" (BookInfoLayout 已删) | ✗ 追加 R15-1B 注释行 |
| `HomeView.tsx` | 8-9 | "R14-1A: ...10 套 BookInfoLayout" (BookInfoLayout 已删) | ✗ 追加 R15-1B 注释行 |
| `ReadClassic.tsx` | 113 | "9 套 clone-* 主题" (R13-1B 后扩为 10 套) | ✗ 改为 "10 套" |
| `read-layouts/shared.tsx` | 160 | "与 Pagination.tsx 同色系" (Pagination.tsx 已删) | ✗ 移除引用 + R15-1C 说明 |

### 9.2 R-task chronicle (保留, R13-1D / R14-1C 同款决策)

| 文件 | 行号 | 内容 | 决策 |
|---|---|---|---|
| `BookView.tsx` | 3-4 | "R12-1: 清理 pili/aurora/... 旧主题分支; clone-* 9 套主题统一走默认渲染分支" | ✓ 保留 (R12-1 时点 chronicle) |
| `BookView.tsx` | 567 | "R12-1: 移除 pili/aurora/paper/mango/bamboo/rose 旧主题分支; 9 套 clone-* 主题..." | ✓ 保留 |
| `BookView.tsx` | 635 | "R15-1B: ...不再用 BookInfoLayout 中转 (旧 9 套 clone-* 统一渲染分支已废弃)" | ✓ 保留 (R15-1B chronicle) |
| `BookView.tsx` | 685, 701 | "R12-1: ...9 套 clone-* 主题统一渲染/走 SecTitle" | ✓ 保留 |
| `BookCard.tsx` | 55 | "R10-1A: 9 套精仿主题均使用同样的通用卡片网格 (BookCard)" | ✓ 保留 (R10-1A chronicle) |
| `themes.ts` | 2-31 | R10-1A → R14-1A 历史链 | ✓ 保留 |

## 10. 性能热点审计 (R15-1C 无明显新问题)

| 热点 | 当前实现 | R15-1C 评估 |
|---|---|---|
| HomeView.tsx dynamic import | 10 个 HomeClone* 全部 dynamic() 懒加载 | ✓ 合理 |
| clone-themes BookInfo 内 `book.intro?.slice(0, 80)` | 10 套 BookInfo 各 1 次 slice (传给 ShareMenu) | ✓ 无性能问题 (单次 slice) |
| trxsw/HomeClone.tsx:194-197 catList.map 内 books.filter | O(n²) but n=48, ~480 ops, 可忽略 | ✓ 合理 |
| ReadView readerActionsRef.current.onPrev/onNext | 每次 render 写入最新闭包 (useEffect 无 deps) | ✓ 合理 (R14-1B 模式) |
| fetcher inflightMap / tokenInflight | R14-1B fix entry 引用对比 | ✓ 保留 |
| runner control() 30s timer | R14-1B fix try/finally clearTimeout | ✓ 保留 |
| suggest PSEO 缓存 | R13-1C fix 仅缓存非空结果 + clearPSEOCacheForBook | ✓ 保留 |

无过度优化空间.

## 11. 修改文件清单 (R15-1C 净改动)

| 文件 | 改动 | 行数变化 |
|---|---|---|
| `src/components/public/clone-themes/aijjxs/ReadChrome.tsx` | 签名扩展为 ReadChromeProps + 注释说明源站 chrome 无翻页按钮 | +12 行 (注释扩展, 主体不变) |
| `src/components/public/clone-themes/101kks/HomeClone.tsx` | BookCard `<div onClick>` → `<a href onClick>` | ±0 行 (替换, 注释 +2 行) |
| `src/components/public/clone-themes/101kks/CategoryList.tsx` | booklist-card 同上 | ±0 行 (替换, 注释 +1 行) |
| `src/components/public/BookView.tsx` | 追加 R15-1B 注释行 | +1 行 |
| `src/components/public/HomeView.tsx` | 追加 R15-1B 注释行 | +1 行 |
| `src/components/public/read-layouts/ReadClassic.tsx` | "9 套" → "10 套" | ±0 行 |
| `src/components/public/read-layouts/shared.tsx` | 移除 "与 Pagination.tsx 同色系" 注释 + R15-1C 说明 | +1 行 |
| `src/components/public/Pagination.tsx` | **全文件删除** (R15-1B 未清理的孤儿) | **-128 行** |
| **合计** | | **净 -113 行** |

## 12. 验证步骤与结果

1. `bunx tsc --noEmit` (排除 examples/skills) — **0 errors** ✓
2. `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` (排除 examples/skills) — **0 errors** ✓
3. `bun run lint` — **exit 0** (0 errors / 0 warnings) ✓
4. `bunx tsx scripts/test-themes-r14.ts` — THEMES.length=10, 10 个 ID + contentSelector 全部 OK ✓
5. 追加 R15-1C 记录到 worklog.md ✓

## 13. 不修改的内容 (尊重约束)

- ❌ 不删除任何活代码 (仅删 Pagination.tsx 这 1 个孤儿文件)
- ❌ 不改变函数签名 (aijjxs ReadChrome 仅扩展 ReadChromeProps 不破坏向后兼容)
- ❌ 不修改业务逻辑 (a11y fix 视觉完全等价, 仅添加 keyboard 可达性)
- ❌ 不回滚 R13-1A/B/C/D + R14-1A/B/C 的修改 (suggest.ts PSEO/cache/fetcher.ts entry TOCTOU/runner.ts control timer/
  BookInfoLayout.tsx Trxsw <span> fix 全部保留; BookInfoLayout.tsx 本身已被 R15-1B 删除, 不复活)
- ❌ 不真删除 scripts/ 下任何文件 (仅记录到本计划)
- ❌ 不动 R13-1D / R14-1C 决定保留的 de-export 候选
- ❌ 不动 R13-1D / R14-1C 决定保留的 R-task chronicle 注释
- ❌ 不引入新 npm 包
- ❌ 不修改 types.ts 字段名

## 14. 未来工作 (建议, 不在本任务范围)

### 14.1 跨 10 套 clone-themes 的 dead click 统一改造

将 9 套 CategoryList 筛选 chip + 10 套 BookInfo 的"加入收藏"等 dead click 元素统一改为 `<span>` 或加 onClick.
- 估计工作量: ~80 行编辑 (10 套 × 8 处平均)
- 风险: 视觉克隆约束需逐处审 cursor 样式
- 优先级: 低 (功能性 dead click, 不影响核心交互)

### 14.2 CategoryList 筛选功能接入

为 9 套 CategoryList 的"全部/玄幻/武侠/..."筛选 chip 添加 onFilter callback:
- 跨 9 套组件接口变更 + CategoryView 加 onFilter handler + navigate({ view: 'category', cat: subCategoryId })
- 估计工作量: ~150 行编辑 (9 套组件 + CategoryView + 子分类映射)
- 优先级: 中 (UX 改进, 但需先有子分类数据)

### 14.3 跨 10 套 BookInfo 抽取 ActionButtons 共享组件

抽取 ReadFirstButton/继续阅读/目录/TXT下载/ShareMenu 的 action button 行:
- 估计工作量: ~80 行新组件 + 10 处替换
- 净收益: -300 行重复 + ~80 行新组件 = -220 行
- 优先级: 低 (R14-1C 已分析, 视觉差异大于 BookInfoMeta)

### 14.4 scripts/ 归档执行

将 R14-1C 列出的 6 个废弃脚本 mv 到 scripts/archive/:
- test-themes-9.ts / fix-aijjxs-bookurl.ts / fix-aijjxs-toplist-toc.ts / probe-all.ts / fix-dd-b-stale-task.ts / mock-novel-site.ts
- 估计工作量: ~5 分钟 (6 个 mv 命令)
- 优先级: 低 (等主代理批准)
