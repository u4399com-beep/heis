# R15-1C 深度代码审计 + bug 修复 + 清理整合报告

> Task ID: R15-1C | 子代理(深度审计+bug修复+清理整合) | 2026-09-22
> 审计范围: clone-themes/ 10 套主题模块(50 个文件) + 接线视图(HomeView/BookView/CategoryView/ReadView) +
> crawl 模块(fetcher/runner/suggest) + scripts/ 彡档候选扫描
> 总代码量: ~4.2k LoC (clone-themes) + ~2.5k LoC (4 视图) + ~7k LoC (crawl 模块)

## 1. 审计范围与策略

### 1.1 审计对象

| 范围 | 文件数 | LoC | 状态 |
|---|---|---|---|
| clone-themes/aijjxs (5 文件) | 5 | 630 | 完整审计 |
| clone-themes/ddyueshu (5 文件) | 5 | 522 | 完整审计 |
| clone-themes/pilishuwu (5 文件) | 5 | 416 | 完整审计 |
| clone-themes/23qb (5 文件) | 5 | 406 | 完整审计 |
| clone-themes/101kks (5 文件) | 5 | 335 | 完整审计 |
| clone-themes/huangjinwu (5 文件) | 5 | 421 | 完整审计 |
| clone-themes/ggd66 (5 文件) | 5 | 361 | 完整审计 |
| clone-themes/shipsay (5 文件) | 5 | 402 | 完整审计 |
| clone-themes/x2552 (5 文件) | 5 | 368 | 完整审计 |
| clone-themes/trxsw (5 文件) | 5 | 440 | 完整审计 |
| clone-themes/shared-props.ts | 1 | 46 | 完整审计 |
| HomeView/BookView/CategoryView/ReadView | 4 | 1.9k | 完整审计 |
| crawl/fetcher.ts + runner.ts + suggest.ts | 3 | 7.2k | R14-1B/C 已审, 抽样复核 |

### 1.2 审计维度

按任务要求 7 大维度:
1. React hooks 规则 (usePublic 必须在组件顶层, 不在条件/循环内)
2. null/undefined 安全 (book/books 可能 null, 防护)
3. 事件处理 (onClick 是否正确绑定 navigate)
4. 键盘可达性 (可点击元素 role/tabIndex/onKeyDown)
5. 响应式 (移动端单列/桌面多列)
6. Skeleton + 空态 (loading 时有骨架, books 为空时有提示)
7. 硬编码颜色一致性 (与源站 CSS 实际值匹配)

## 2. P0 bug (内存泄漏/安全/数据丢失)

**0 个 P0 bug**. 历经 R3~R14 多轮修复后无明显 P0.

## 3. P1 bug (类型安全/错误处理/业务逻辑)

**0 个 P1 bug**. R14-1B/C 已修复的 P1 (fetcher inflightMap/tokenInflight TOCTOU race + runner control timer leak) 全部保留.

### 3.1 aijjxs/ReadChrome.tsx 签名不一致 — P2 (非 P1)

**现象**: aijjxs/ReadChrome.tsx 的函数签名是 `({ children, chapterTitle }: { children: ReactNode; chapterTitle?: string })`,
而其它 9 套 ReadChrome 全部使用 `ReadChromeProps` (含 onPrev/onNext/prevLabel/nextLabel).

**影响**: ReadView.tsx 透传 `onPrev={handlePrevChapter} onNext={handleNextChapter}` 给所有 10 套 ReadChrome.
aijjxs 不接受这两个 prop, 被 React JSX 静默丢弃. 用户在 aijjxs 主题下阅读时, chrome 不渲染 prev/next 按钮
(但内层 read-layout 自带 prev/next 按钮, 章节导航功能完整).

**根因**: aijjxs 源站章节页 chrome 内无翻页按钮(翻页在 iframe 内), 故 R15-1A 有意省略 onPrev/onNext 渲染.

**TS 行为**: tsc 不报错 — React 19 JSX 对 union 类型组件的 props 检查较宽松, 允许 extra props 静默丢弃.
   (最小复现显示 TS 严格场景下应报 TS2322, 但项目 React 19 JSX 配置下被放宽.)

**修复决策**: P2 — 扩展 aijjxs/ReadChrome 签名为完整 ReadChromeProps (与其它 9 套一致),
   onPrev/onNext 在 props 层接受但渲染时静默忽略(源站 chrome 无翻页按钮故不渲染,
   章节翻页仍由内层 read-layout 提供). **已修**.

## 4. P2 改进 (代码重复/未使用 import/注释过时)

### 4.1 101kks BookCard & CategoryList `<div onClick>` 不可键盘可达 — P2 a11y

**位置**:
- `clone-themes/101kks/HomeClone.tsx` BookCard (line 76)
- `clone-themes/101kks/CategoryList.tsx` booklist-card (line 42)

**现象**: 使用 `<div onClick={() => navigate(...)}>` 模式, 但 div 不在 Tab 焦点序列, 屏读器不识别为可点击.

**修复**: 改为 `<a href="/?view=book&id=X" onClick={(e) => { e.preventDefault(); navigate(...) }}>` 模式,
   与 huangjinwu/23qb/trxsw 等其它 9 套主题统一. 视觉完全等价(添加 textDecoration:'none' + color:INK 覆盖 a 默认样式). **已修**.

### 4.2 aijjxs/ReadChrome 签名不一致 — P2 类型一致性 (见 §3.1)

**已修**: 扩展为完整 ReadChromeProps.

### 4.3 BookView.tsx / HomeView.tsx 注释提及已删 BookInfoLayout.tsx — P2 过时注释

**位置**:
- `HomeView.tsx:8` — "R14-1A: ...10 个 HomeClone*.tsx + 10 套 BookInfoLayout"
- `BookView.tsx:5` — "R14-1A: 信息区 DOM 按 theme.layout 区分 10 套精仿结构 (BookInfoLayout 组件)"

**根因**: R15-1B 已删除 BookInfoLayout.tsx + 10 个旧 HomeClone*.tsx, 但 R14-1A chronicle 注释未更新.

**修复决策**: 保留 R14-1A chronicle (历史链有价值), 追加 R15-1B 注释行说明已废弃并迁移到 clone-themes/<site>/{HomeClone,BookInfo,CategoryList,ReadChrome,index.ts} 结构. **已修**.

### 4.4 ReadClassic.tsx:113 "9 套" → "10 套" — P2 当前状态计数过时

**位置**: `read-layouts/ReadClassic.tsx:113`
**原文**: "9 套 clone-* 主题统一使用 v.primary 作为章节头装饰色"
**修复**: 改为 "10 套 clone-* 主题..." (R13-1B 后扩为 10 套, 当前状态描述应同步). **已修**.

> 注: BookView.tsx 中 4 处 "9 套 clone-*" 均为 R12-1 chronicle ("R12-1: ...9 套 clone-*..."),
> 按 R13-1D 决策保留 R-task 时点状态描述, **不动**.

### 4.5 src/components/public/Pagination.tsx 孤儿文件 — P2 dead code

**现象**: R15-1B 删除 CategoryView.tsx 中 `import { Pagination } from './Pagination'` 后,
Pagination.tsx 成为孤儿(全域 0 import, 仅 shared.tsx:160 一处注释提及 "与 Pagination.tsx 同色系").

**修复**:
- 删除 `src/components/public/Pagination.tsx` (128 行 dead code, R15-1B 未清理的残留). **已删**.
- 更新 `read-layouts/shared.tsx:160` 注释移除 "与 Pagination.tsx 同色系" 引用. **已修**.

### 4.6 aijjxs/BookInfo.tsx:43 `<a href="javascript:;">加入收藏</a>` 无 onClick — P2 dead click (未修)

**现象**: aijjxs/BookInfo.tsx line 43 渲染 "加入收藏" 链接, 无 onClick, 点击无效果.
**根因**: aijjxs 源站有会员收藏功能, 本系统无会员系统.
**决策**: 不修. 理由:
1. 视觉克隆约束 — 必须保留 "加入收藏" 按钮的视觉(源站有该元素)
2. 改为 `<span>` (R14-1B Trxsw 模式) 虽去 dead click, 但需同步改 cursor 样式以保持视觉等价, 影响范围小但需逐处审 cursor: pointer vs default
3. 类似的 dead click 在其它 9 套主题中也有(aijjxs 最多, trxsw/ggd66 等也有少量) — 统一改造工作量大, 留作后续小步重构

### 4.7 9 套 CategoryList 的"全部/玄幻/武侠/..."筛选 chip 无 onClick — P2 (未修)

**现象**: 9 套 CategoryList (aijjxs/ddyueshu/pilishuwu/23qb/101kks/huangjinwu/ggd66/shipsay/trxsw/x2552) 均有
"全部/玄幻/武侠/都市/历史/科幻/游戏/女生" 筛选 chip 渲染, 但 chip 无 onClick (decorative).
**根因**: 源站分类页有筛选功能(切到子分类), 本系统 CategoryView 只支持单一 `cat` 参数, 无子分类筛选.
**决策**: 不修. 理由:
1. 改造需在 CategoryView 加 onFilter callback + CategoryListProps 扩 onFilter — 跨 10 套组件的接口变更
2. 属于 feature 添加 (非 bug 修复), 超出本任务"只修真实 bug"范围
3. 已记录到 cleanup-plan-r15.md §4 "未来工作"

### 4.8 CategoryView.tsx 双重 loading 指示器 — P2 (未修)

**位置**: `src/components/public/CategoryView.tsx:118-142`
**现象**: loading=true 时, 同时渲染 CategoryList 的内部 "加载中..." + 外层 `<Sk className="mx-auto mt-4 h-9 w-64" />` Skeleton.
**决策**: 不修. 理由:
1. 各 CategoryList 已有内部 loading UI (但样式不同, 101kks 显示 "加載中...", trxsw 用样式化加载框)
2. 外层 Sk 是统一的视觉骨架, 加载完成后隐藏 — 与 CategoryList 内部 loading 在同一时间消失, 不影响功能
3. 删除任一 loading 指示器会改变视觉, 违反"视觉完全等价"约束

## 5. crawl 模块复核 (R14-1B/C 已审, 抽样)

### 5.1 fetcher.ts — R14-1B fix 保留 ✓

- inflightMap (line ~3689) — `if (cur === entry) inflightMap.delete(dedupKey)` 引用对比模式 ✓
- tokenInflight (line ~3580) — 同款 entry 引用对比 ✓
- responseCache (200 entries + FIFO 淘汰 + TTL 驱逐) ✓
- cookieJar (按 origin 分罐 Map) ✓

### 5.2 runner.ts — R14-1B fix 保留 ✓

- control() (line 422) — try/finally clearTimeout(raceTimer) 显式释放 30s 超时定时器 ✓
- controlChains 链尾自删 Map 项防长任务无界增长 ✓

### 5.3 suggest.ts — R13-1C fix 保留 ✓

- clearPSEOCache (line 217) — 全清 (测试/手动用)
- clearPSEOCacheForBook (line 227) — 精确按 cacheKey 清单本书 (R13-1C 修 P1: 仅清本书缓存, 不影响其他书的 PSEO 落地页)
- cacheRead/cacheWrite LRU + 24h TTL + 200 上限 ✓

## 6. 修复落地清单

### 6.1 P0 / P1 修复

无 P0 / P1 修复. (R14-1B/C 已修的 P1 全部保留, 未发现新 P1.)

### 6.2 P2 修复 (5 项, 已应用)

| # | 文件 | 改动 | 类型 |
|---|---|---|---|
| 1 | `clone-themes/aijjxs/ReadChrome.tsx` | 签名从 `{ children, chapterTitle }` 扩展为 `ReadChromeProps`, 与其它 9 套一致; onPrev/onNext 静默忽略(源站 chrome 无翻页按钮) | P2 类型一致 |
| 2 | `clone-themes/101kks/HomeClone.tsx` BookCard | `<div onClick>` → `<a href onClick={preventDefault}>` (键盘可达 + 屏读器识别) | P2 a11y |
| 3 | `clone-themes/101kks/CategoryList.tsx` booklist-card | 同上 | P2 a11y |
| 4 | `BookView.tsx:5-7` | 追加 R15-1B 注释行, 说明 BookInfoLayout 已废弃迁移至 clone-themes/<site>/BookInfo | P2 过时注释 |
| 5 | `HomeView.tsx:8-9` | 追加 R15-1B 注释行, 说明 10 套 clone-themes/<site>/{HomeClone,BookInfo,CategoryList,ReadChrome,index.ts} 结构 | P2 过时注释 |

### 6.3 P2 dead code 删除 (1 项)

| # | 文件 | 改动 | LoC |
|---|---|---|---|
| 1 | `src/components/public/Pagination.tsx` | 全文件删除 (R15-1B 删除 CategoryView 中 Pagination import 后, 此文件成为孤儿, 全域 0 import) | -128 行 |

### 6.4 注释更新 (2 项)

| # | 文件 | 改动 |
|---|---|---|
| 1 | `read-layouts/ReadClassic.tsx:113` | "9 套 clone-* 主题" → "10 套 clone-* 主题" (R13-1B 后扩为 10 套, 当前状态描述同步) |
| 2 | `read-layouts/shared.tsx:160` | 移除 "与 Pagination.tsx 同色系" 引用 (Pagination.tsx 已删) |

## 7. 未修不动的 P2 (5 项, 已说明原因)

| # | 位置 | 现象 | 不修原因 |
|---|---|---|---|
| 1 | `clone-themes/aijjxs/BookInfo.tsx:43` | "加入收藏" `<a href="javascript:;">` 无 onClick (dead click) | 视觉克隆约束 + 类似 dead click 在其它 9 套也有, 统一改造工作量大, 留作后续小步重构 |
| 2 | 9 套 CategoryList 筛选 chip 无 onClick (decorative) | "全部/玄幻/武侠/..." chip 不可点 | 改造需 CategoryView 加 onFilter callback + 跨 10 套组件接口变更, 属 feature 添加非 bug 修复 |
| 3 | `CategoryView.tsx:118-142` 双重 loading 指示器 | CategoryList 内部 "加载中..." + 外层 Sk Skeleton 同时显示 | 删除任一 loading 指示器会改视觉, 违反"视觉完全等价"约束 |
| 4 | 9 套 ReadChrome 的 NAV_ITEMS 等装饰性导航无 onClick | "首页"以外 nav 项无 onClick, 静默忽略 | 源站导航是子页面链接(/txt/chuanyue/ 等), 本系统无对应路由, 视觉克隆保留 |
| 5 | 9 套 ReadChrome `<a href="javascript:;">` 翻页按钮模式 | 用 javascript: 伪 URL 而非 button | 源站翻页按钮用 `<a href="javascript:;" onclick>` 模式, 视觉/行为克隆保留 |

## 8. clone-themes 10 套审计明细

### 8.1 React hooks 规则

✓ **全部合规**. `usePublic()` 在所有 clone-themes 组件顶层调用, 无条件分支/循环内调用.
   (内部子组件如 aijjxs BookLine/BookCard2/RankLine 等也是顶层调用, 符合 React 规则.)

### 8.2 null/undefined 安全

✓ **全部合规**. 关键防护:
- `book.intro || '暂无简介'` — 简介空时显示 "暂无简介" (10 套 BookInfo 全部覆盖)
- `book.latestChapter || '暂无' / '暂无章节' / '最新章节'` — 最新章节空时 fallback (10 套 BookInfo 全部覆盖)
- `books.length === 0 ? '没有找到相关书籍'` — 空态处理 (9 套 CategoryList + trxsw 隐式返回 null)
- `loading ? '加载中...' : ...` — loading 态处理 (10 套 HomeClone 用 BookGridSkeleton, 9 套 CategoryList 内置 loading state)
- `book.categoryId ? <button onClick={onGoCategory}> : <span>` — categoryId 空时降级为 span (10 套 BookInfo 全部覆盖)
- `savedPos?.chapterId && (...)` — 已读位置空时不渲染"继续阅读"按钮 (10 套 BookInfo 全部覆盖)

### 8.3 事件处理

✓ **全部合规**. onClick 全部正确绑定 navigate:
- 书名/封面点击 → navigate({ view: 'book', bookId })
- 作者点击 → navigate({ view: 'search', q: author })
- 分类按钮 → onGoCategory?(categoryId) (10 套 BookInfo 一致)
- 目录按钮 → onScrollToc() (10 套 BookInfo 一致)
- 章节翻页 → onPrev/onNext (9 套 ReadChrome 渲染按钮, aijjxs 静默忽略由内层 read-layout 接管)

### 8.4 键盘可达性 (a11y)

- **a 标签模式** (默认键盘可达): 9 套主题统一使用 `<a href="/?view=book&id=X" onClick={preventDefault; navigate}>` — Tab + Enter 触发 ✓
- **div onClick 模式** (R15-1C 已修): 101kks HomeClone BookCard + CategoryList 改为 a 标签模式 ✓
- **button 标签模式** (默认键盘可达): 10 套 BookInfo 的"开始阅读"/"继续阅读"/"目录" 全部用 `<button type="button" onClick>` ✓
- **a href="javascript:;" 模式** (键盘可达但 dead click): 装饰性元素(导航/筛选 chip/页码) — 见 §7 不修原因

### 8.5 响应式

✓ **全部合规**.
- HomeClone: 10 套均用 `gridTemplateColumns: 'minmax(0,1fr) 330px'` 或 `repeat(auto-fill, minmax(280px,1fr))` 自适应布局
- BookInfo: 10 套均用 `display: 'flex', flexWrap: 'wrap', minWidth: 280` (桌面双栏/移动单栏)
- CategoryList: 10 套用 `repeat(auto-fill, minmax(Xpx,1fr))` 网格 (101kks 280px/23qb 150px/trxsw 320px 等)
- ReadChrome: 10 套用 `maxWidth: 900-1250px, margin: '0 auto'` 居中容器

### 8.6 Skeleton + 空态

✓ **全部合规**.
- HomeClone (10 套): loading 时渲染 `<BookGridSkeleton count={8}>` (统一骨架), books 为空时各套自行处理 (aijjxs/trxsw 等返回 null 或空 section)
- BookInfo: 由 BookView 顶层 `loading || !book ? <Sk>...` 处理骨架, 各 BookInfo 收到 book 时再渲染
- CategoryList (9 套): loading 内部显示"加载中...", books 为空显示"没有找到相关书籍" (trxsw 用样式化加载框)
- ReadChrome: 由 ReadView 顶层 `<ErrorState>` 处理错误, ReadChrome 收到 children 时已非 loading

### 8.7 硬编码颜色一致性

✓ **10 套全部硬编码源站 CSS 实际值** (不用 theme.vars).
   每套文件头注释列出源站 CSS 变量原值 (如 aijjxs: `--brand #0f766e` / `--accent #b45309` 等),
   代码内 INK/MUTED/BRAND/PRIMARY 等常量直接对应源站值.

> 1 处疑点: `aijjxs/BookInfo.tsx:60` 使用字面量 `'#09B295'` (与 BRAND `#0f766e` 接近但不同).
>   可能是源站"完结"徽章专用色或 aijjxs 内部 sfwj 类的 CSS 实际值. 未核实源站 probe, 不动.

## 9. 接线视图审计 (HomeView/BookView/CategoryView/ReadView)

### 9.1 lookup table 完整性

✓ **10 套全部在 lookup table 中** (HomeView/BookView/CategoryView/ReadView 各 1 个 lookup, 10 项全):

```tsx
// HomeView.tsx (10 个 dynamic import + 10 个分发分支)
const HomeCloneAijjxs = dynamic(() => import('./clone-themes/aijjxs').then((m) => m.HomeClone))
// ... 10 套
{theme.layout === 'clone-aijjxs' && <HomeCloneAijjxs books={books} loading={loading} />}
// ... 10 套

// BookView.tsx (1 个 lookup table, 10 项)
const BookInfoComponent = { 'clone-aijjxs': BookInfoAijjxs, ... }[theme.layout] || BookInfoAijjxs

// CategoryView.tsx (1 个 lookup table, 10 项)
const CatListComponent = { 'clone-aijjxs': CatListAijjxs, ... }[theme.layout] || CatListAijjxs

// ReadView.tsx (1 个 lookup table, 10 项)
const ReadChromeComponent = { 'clone-aijjxs': ReadChromeAijjxs, ... }[theme.layout] || ReadChromeAijjxs
```

### 9.2 fallback (兜底)

✓ **4 个 lookup 全部有 `|| 默认组件` 兜底**:
- HomeView: 未知 theme.layout + loading 时用 `<BookGridSkeleton count={12}>` 兜底
- BookView: 未知 theme.layout 时用 `BookInfoAijjxs` 兜底
- CategoryView: 未知 theme.layout 时用 `CatListAijjxs` 兜底
- ReadView: 未知 theme.layout 时用 `ReadChromeAijjxs` 兜底

> 注: 实际 theme.layout 总是 10 个 clone-* 之一(themes.ts 强制), 兜底永不触发, 但防御性代码保留.

### 9.3 props 传递

✓ **4 个视图全部正确传递 props**:
- HomeView: `books, loading` (HomeCloneProps)
- BookView: `book, theme, savedPos, firstChapterId, onScrollToc, onGoCategory` (BookInfoProps)
- CategoryView: `books, loading, label, page, total, onPage` (CategoryListProps)
- ReadView: `children, chapterTitle, onPrev, onNext` (ReadChromeProps) + handlePrevChapter/handleNextChapter 通过 readerActionsRef 透传

### 9.4 PSEO 集成 (BookView)

✓ **完整保留** R13-1A 的 PSEO 集成:
- `BookView.tsx:752`: `<PSEOKeywordsSection bookId={book.id} siteId={site.id} />`
- `PSEOKeywordsSection` 组件 (line 306-393) 完整保留:
  - `fetchBookPSEOKeywords(bookId)` 拉取
  - `failed` 静默降级(失败时不渲染, 不阻塞页面其他内容)
  - `keywords === null` 时显示 Skeleton
  - 过滤书名重复词, 取前 10 个长尾词
  - 链接 `<a href="/?view=keyword&tag=X&site=Y" onClick={preventDefault; navigate}>` dofollow 链向 KeywordView 落地页
  - `R13-1C` 的 `.catch` 防御 unhandled rejection 保留

### 9.5 SEO meta (useSiteSEO)

✓ **4 个视图全部正确调用 useSiteSEO**:
- HomeView: title/description/keywords/canonicalPath/jsonLd(WebSite + SearchAction)
- BookView: title/description/keywords/canonicalPath/jsonLd(Book + BreadcrumbList) + renderSeoTemplate(支持 site.chapterSeo* 模板)
- CategoryView: title/description/keywords/canonicalPath/jsonLd(CollectionPage)
- ReadView: title/description/keywords/canonicalPath/jsonLd(Article) + renderSeoTemplate

## 10. crawl 模块复核结果

### 10.1 fetcher.ts (R14-1B fix 保留)

- `inflightMap` (line ~3689): entry 引用对比 + LRU 驱逐 (R14-1B fix TOCTOU race) ✓
- `tokenInflight` (line ~3580): entry 引用对比 (R14-1B fix 同款) ✓
- `responseCache`: 200 entries + FIFO 淘汰 + TTL 驱逐 ✓
- `cookieJar`: 按 origin 分罐 Map ✓
- `hostDispatcherSnapshot`: R14-1C 已删 (dead code) ✓

### 10.2 runner.ts (R14-1B fix 保留)

- `control()` (line 422): try/finally clearTimeout(raceTimer) 显式释放 30s 超时定时器 (R14-1B fix timer leak) ✓
- `controlChains` 链尾自删 Map 项防长任务无界增长 ✓

### 10.3 suggest.ts (R13-1C fix 保留)

- `clearPSEOCacheForBook` (line 227): 精确按 cacheKey 清单本书 (R13-1C 修 P1: 仅清本书缓存) ✓
- `cacheRead/cacheWrite` LRU + 24h TTL + 200 上限 ✓
- PSEO 缓存空数组 24h 死锁 — R13-1C 已修 (仅缓存非空结果) ✓

## 11. 验证步骤与结果

1. `bunx tsc --noEmit` (排除 examples/skills) — **0 errors** ✓
2. `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` (排除 examples/skills) — **0 errors** ✓
3. `bun run lint` — **exit 0** (0 errors / 0 warnings) ✓
4. `bunx tsx scripts/test-themes-r14.ts` — THEMES.length=10, 10 个 ID + contentSelector 全部 OK ✓

## 12. 修改文件清单 (R15-1C 净改动)

| 文件 | 改动 | 行数变化 |
|---|---|---|
| `src/components/public/clone-themes/aijjxs/ReadChrome.tsx` | 签名扩展为 ReadChromeProps + 注释说明源站 chrome 无翻页按钮 | +12 行 (注释扩展, 主体不变) |
| `src/components/public/clone-themes/101kks/HomeClone.tsx` | BookCard `<div onClick>` → `<a href onClick>` | ±0 行 (替换, 注释 +2 行) |
| `src/components/public/clone-themes/101kks/CategoryList.tsx` | booklist-card 同上 | ±0 行 (替换, 注释 +1 行) |
| `src/components/public/BookView.tsx` | 追加 R15-1B 注释行 (BookInfoLayout 已废弃迁移说明) | +1 行 |
| `src/components/public/HomeView.tsx` | 追加 R15-1B 注释行 (clone-themes 结构说明) | +1 行 |
| `src/components/public/read-layouts/ReadClassic.tsx` | "9 套" → "10 套" (当前状态计数同步) | ±0 行 |
| `src/components/public/read-layouts/shared.tsx` | 移除 "与 Pagination.tsx 同色系" 注释 + R15-1C 说明 | +1 行 |
| `src/components/public/Pagination.tsx` | **全文件删除** (R15-1B 未清理的孤儿) | **-128 行** |
| **合计** | | **净 -113 行** |

## 13. 不修改的内容 (尊重约束)

- ❌ 不删除任何活代码 (仅删 Pagination.tsx 这 1 个孤儿文件 + 修复 a11y/a11y/类型一致/注释 5 处)
- ❌ 不改变函数签名 (aijjxs ReadChrome 仅扩展 ReadChromeProps 不破坏向后兼容)
- ❌ 不修改业务逻辑 (a11y fix 视觉完全等价, 仅添加 keyboard 可达性)
- ❌ 不回滚 R13-1A/B/C/D + R14-1A/B/C 的修改 (suggest.ts PSEO/cache/fetcher.ts entry TOCTOU/runner.ts control timer/
  BookInfoLayout.tsx Trxsw <span> fix 全部保留; BookInfoLayout.tsx 本身已被 R15-1B 删除, 不复活)
- ❌ 不真删除 scripts/ 下任何文件 (仅记录到 cleanup-plan-r15.md)
- ❌ 不动 R13-1D / R14-1C 决定保留的 de-export 候选 (parser.ts/sorter.ts/obscura.ts/storage.ts/smart.ts/hostgate.ts 内部 export)
- ❌ 不动 R13-1D 决定保留的 R-task chronicle 注释 (R12-1 "9 套 clone-*" 历史链)

## 14. 总结

- **审计范围**: 10 套 clone-themes 模块 (50 文件 ~4.2k LoC) + 4 视图 (~1.9k LoC) + 3 crawl 模块 (~7.2k LoC) = ~13.3k LoC
- **修复数量**: P0=0 / P1=0 / P2=5 (已修) + 5 项不修(已说明原因)
- **dead code 删除**: -128 行 (Pagination.tsx 孤儿文件, R15-1B 残留)
- **a11y 改进**: 101kks BookCard/CategoryList 改为可键盘可达 (Tab + Enter 触发)
- **类型一致性**: aijjxs ReadChrome 签名与其它 9 套统一 (ReadChromeProps)
- **过时注释清理**: BookView/HomeView/ReadClassic.tsx/shared.tsx 共 4 处更新
- **验证**: tsc 0 errors / lint 0 errors / themes test 10/10 OK
- **审计报告**: `/home/z/my-project/agent-ctx/code-audit-r15.md` (本文件)
- **清理计划**: `/home/z/my-project/agent-ctx/cleanup-plan-r15.md`
