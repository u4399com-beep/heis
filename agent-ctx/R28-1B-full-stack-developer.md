# R28-1B: 章节目录分栏优化

**Task ID**: R28-1B
**Agent**: full-stack-developer (章节目录分栏优化)
**前置**: R27-1A 已优化 BookView 分卷渲染(卷头卡片化 + 卷索引条), 本轮继续完善

---

## 一、读交接文档 + 现状审查

### 1.1 R27-1A 现状(worklog.md 最后 100 行)
- Chapter.volume 字段已存在(prisma/schema.prisma)
- cleaner.ts 已剥离卷名前缀; downloader.ts 卷变化处插入卷标题行
- parser.ts toc.fields.volume 提取(HTML/JSON 双模式)
- sorter.ts reorderWithVolumes 分卷感知重排(零回归确认)
- rule-templates.ts fanqie-style + biquge-standard 已预置 volume 字段
- BookView renderToc(line 591-700): volGroups 分组逻辑 + 卷头卡片化(左 3px 主色块 +
  半透明背景 padding + 章数徽章) + 多卷(≥3)卷索引条(顶部 chip 平铺 + 横向滚动 +
  scrollIntoView 锚定) + section 语义 + scroll-mt-6

### 1.2 现状审查(4 个文件)

- **BookView.tsx renderToc (line 591-700)**: R27-1A 卷头卡片化已就位; 可优化点:
  1) 长列表(>50 章)无滚动容器, 页面拉很长
  2) 卷头在长列表滚动时不能常驻(sticky)
  3) 用户从 ReadView 跳回 BookView 时不能自动定位到上次阅读章节
  4) 章节按钮无 min-h-[44px] 触摸目标
  5) 章节按钮无显式 aria-label, 屏幕阅读器只朗读 EP 编号 + 标题

- **read-layouts/shared.tsx TocDrawer (line 944-1363)**: 已有分卷分组(kk-a);
  可优化点:
  1) 卷头无折叠/展开按钮 — 万章多卷书展开太长
  2) 用户进入抽屉时无自动滚动到当前章节 — 大目录里找不到上次读到哪里
  3) 滚动容器无自定义细滚动条
  4) 当前章节所在卷若被折叠, 用户需手动展开才能看到高亮

- **10 套 clone-themes BookInfo.tsx**: 全部确认是详情面板(封面/书名/作者/简介/
  相关推荐/猜您喜欢), 不渲染章节目录; 目录由 BookView 父级 renderToc 统一渲染;
  全部含"查看完整目录"/"查看完整章节目录"按钮 → onScrollToc 滚到父级 TOC 区。
  结论: 10 套 BookInfo 无需单独修改, 分卷显示通过 BookView renderToc 对所有
  clone-* 主题 + 默认主题统一生效(R27-1A 已确认, R28-1B 沿用)。

- **read-layouts (ReadClassic/Immersive/Pili/Paginated)**: 全部使用 shared.tsx 的
  TocDrawer 组件, variant 区分 classic/immersive 暗色面板。结论: 我的 TocDrawer
  改动自动对 4 种阅读布局生效。

---

## 二、实施修改(3 个文件, 共 +170 行)

### 2.1 src/app/globals.css (282 → 305, +23)
- 新增 `.toc-scroll-thin` 自定义滚动条 CSS 类:
  - `scrollbar-width: thin` + `scrollbar-color` (Firefox)
  - `::-webkit-scrollbar` width 8px (Chrome/Safari)
  - thumb `rgba(128,128,128,0.35)` + 4px border-radius + padding-box 裁剪
  - thumb:hover 加深到 0.55
  - track 透明
- 与已有 `.reader-scroll-fine`(6px) 区分: 8px 略宽 + hover 加深, 适配 TOC 长列表

### 2.2 src/components/public/BookView.tsx (856 → 897, +41)
- **新增自动滚动 effect (line 500-512)**: 数据加载完成 + currentChapterId 命中时,
  通过 `requestAnimationFrame` 等 DOM 渲染完成, 用
  `tocRef.current?.querySelector('button[aria-current="true"]')` 查找当前章节按钮,
  调 `scrollIntoView({ block: 'nearest' })`(已在视口内不滚动, 避免抢用户焦点)
- **renderToc renderChapterList 优化**:
  - 列间距 `gap-x-8` → `gap-x-6`(原 8 偏挤)
  - 章节按钮加 `min-h-[44px]` 触摸目标(iOS HIG)
  - 显式 `ariaLabel` prop, 屏幕阅读器朗读 "阅读 <章节> (当前章节)" 状态
- **renderToc 长列表滚动容器 (line 670-674)**: chapters.length > 50 时启用
  `max-h-[640px] overflow-y-auto overscroll-contain pr-1 toc-scroll-thin`
- **卷头 sticky 化**: 滚动容器内卷头加 `sticky top-0 z-10` + `backdrop-blur(6px)`
  让卷名在长列表滚动时常驻可见; 背景透明度 0.06→0.08(配合 blur 提升可读性)
- **卷索引条 chip**: 加 `inline-flex min-h-[36px]` + items-center, 触摸目标合规;
  去掉 `ml-1` 改 `gap-1`(父 inline-flex 已设 gap-1, 重复 ml-1 导致视觉偏挤)
- **响应式**: 桌面 3 列 + 平板 2 列 + 移动 1 列(原样保留)

### 2.3 src/components/public/read-layouts/shared.tsx (1364 → 1470, +106)
- **imports**: 加 `useMemo`(React) + `ChevronDown`(lucide-react)
- **新增 state (line 996-1013)**:
  - `collapsed: Set<string>`(默认空集合 = 全部展开), volKey=`vol-${gi}` 卷索引
  - `toggleVol` useCallback 包裹, 防止每次 render 新建函数引用
  - `scrolledForOpenRef` 标记本次抽屉 open 周期是否已自动滚动(防重入)
  - 抽屉关闭 / activeChapterId 切换时重置 ref
  - `scrollContainerRef` 挂在滚动容器 div 上, 供 querySelector 查找当前章节按钮
- **volGroups useMemo (line 1027-1037)**: 复用 entries 派生, 避免每次 render 新建
  数组导致 useEffect deps 失效; 仅当本页至少含一个 volume 字段才启用分组
- **自动展开当前章节所在卷 (line 1058-1082, render-time 检测模式)**:
  - 计算 `autoExpandTarget` = 当前章节所在卷 key
  - 与 `prevAutoExpand` 比较, 不一致则更新 + 调 `setCollapsed` 删除 volKey
  - **关键**: 用 render-time 模式而非 useEffect, 避免
    `react-hooks/set-state-in-effect` 告警(与上方 prevRefresh 同款)
  - 不依赖 collapsed, 防止用户手动折叠后立即被自动重展开
- **派生 activeVolKey + activeVolCollapsed (line 1084-1091)**:
  - `activeVolKey`: 当前章节所在卷 key(useMemo)
  - `activeVolCollapsed`: 当前章节所在卷是否被折叠(直接读 collapsed.has)
  - 用 boolean 派生而非直接依赖 collapsed Set, 避免 lint 误报 unnecessary
- **自动滚动 effect (line 1093-1109)**:
  - 触发条件: open=true + tab=toc + volGroups + activeChapterId + activeVolKey
    + activeVolCollapsed=false
  - raf 等 DOM 渲染完成 → querySelector button[aria-current="true"]
    → scrollIntoView({ block: 'nearest' })
  - scrolledForOpenRef.current=true 防重入(下次 open 才再次触发)
- **滚动容器 (line 1247)**: 加 `ref={scrollContainerRef}` + `toc-scroll-thin` 类
- **卷头折叠/展开渲染 (line 1300-1337)**:
  - 卷头改为 `role="button"` div + `tabIndex=0` + onClick + onKeyDown(Enter/Space)
    + aria-label/aria-expanded, 整行可点击 + 键盘可达
  - 卷头加 ChevronDown(展开)/ChevronRight(折叠)图标, 主色
  - 卷头加 `min-h-[44px] cursor-pointer focus-visible:ring-2 outline-none`
  - 折叠时只渲染卷头不渲染 entries(`{!isCollapsed && g.entries.map(renderEntry)}`)
- **零回归**: 单卷/无卷场景 volGroups=null → 走 `entries.map(renderEntry)` 平铺,
  与改前完全一致

---

## 三、验证

- **bun run lint**: 0 errors / 0 warnings exit 0 ✓
- **bunx tsc --noEmit**: 0 errors in 改动文件 ✓ (排除 .next/examples/skills 预存在)
- **dev server**: GET / 200 OK ✓ (Ready in 1286ms)
- **R27-1A 卷头卡片化 + 卷索引条**: 完全保留, 仅追加 sticky/backdrop-blur/scrollCls
- **R27-1A 单卷/无卷场景**: volGroups=null 仍走原 renderChapterList 分支(零回归)
- **历史修复保留**:
  · cleaner.ts 卷名前缀剥离 + U+2060 字符剥离
  · downloader.ts 卷变化处卷标题行 + lastEmittedVolume 判重
  · parser.ts toc.fields.volume 提取(HTML/JSON 双模式)
  · sorter.ts reorderWithVolumes(kk-a + qq-e2 装配式归位)
  · prisma Chapter.volume 字段已存在

---

## 四、修改文件清单

1. `src/app/globals.css` (282 → 305, +23) — 新增 .toc-scroll-thin CSS
2. `src/components/public/BookView.tsx` (856 → 897, +41) —
   auto-scroll effect + renderToc 长列表滚动容器 + sticky 卷头 + 章节按钮触摸目标
3. `src/components/public/read-layouts/shared.tsx` (1364 → 1470, +106) —
   TocDrawer 卷折叠/展开 + auto-expand + auto-scroll + toc-scroll-thin

总计 +170 行

---

## 五、未修改(尊重约束)

- src/lib/crawl/* (采集模块, 非本任务范围)
- page.tsx/PublicSite.tsx/HomeView.tsx (主控已改, 不动)
- fetcher.ts/obscura.ts/runner.ts (R25-R27 已审, 零回归)
- 10 套 clone-themes BookInfo.tsx (详情面板非目录, 分卷由 BookView 父级统一渲染)
- read-layouts/ReadClassic/Immersive/Pili/Paginated.tsx (使用 TocDrawer, 改动自动生效)
- prisma/schema.prisma (Chapter.volume 已有)
- package.json (0 新依赖)
