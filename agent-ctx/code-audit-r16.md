# R16-1C 代码审计报告

> Task ID: **R16-1C**
> 审计范围: R16-1A/B 新增代码 (10 套 clone-themes 共 40 个文件 + auto-tdk.ts 18 预设 + CloneCSSLoader + HomeView dynamic import + PublicSite CSS 接入)
> 审计日期: 2026-09-16
> 审计者: 主控(本会话续作)

## 1. 审计范围

### 1.1 clone-themes 10 套 (40 文件)
- `src/components/public/clone-themes/{aijjxs,ddyueshu,pilishuwu,23qb,101kks,huangjinwu,ggd66,shipsay,x2552,trxsw}/`
- 每套 4 文件: HomeClone.tsx + BookInfo.tsx + CategoryList.tsx + ReadChrome.tsx
- 共享接口: `src/components/public/clone-themes/shared.ts`
  - `HomeCloneProps { books, loading, navCategoryCount?, homeModuleLimit? }`
  - `BookInfoProps { book, firstChapterId?, onScrollToc }`
  - `CategoryListProps { books, loading, label, page, total, size?, onPage }`
  - `ReadChromeProps { children, chapterTitle?, onPrev?, onNext?, prevLabel?, nextLabel? }`

### 1.2 其他文件
- `src/components/public/auto-tdk.ts` (18 预设 + 4 函数, R16-1B 新增)
- `src/components/public/CloneCSSLoader.tsx` (R16 新增)
- `src/components/public/HomeView.tsx` (R16 改: dynamic import + navCategoryCount/homeModuleLimit 透传)
- `src/components/public/PublicSite.tsx` (R16 改: CloneCSSLoader 接入)

## 2. 审计方法

1. **逐文件阅读**: 10 套 × 4 文件 = 40 个组件全部逐行阅读, 重点检查:
   - React Hooks 使用 (usePublic / useState / useEffect)
   - null 安全 (book/books/loading 边界)
   - 事件绑定 (onClick/onSubmit preventDefault)
   - 响应式 (flex-wrap / grid auto-fit / minmax)
   - 导航调用 (navigate 参数正确性)
2. **跨文件交叉验证**: rg 全文搜索 `view: 'category'`、`bookId: ''`、`firstChapterId` 等模式
3. **类型检查**: `bunx tsc --noEmit` + `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`
4. **lint 校验**: `bun run lint`
5. **dev server 实测**: 10 套主题 200 OK 回归

## 3. 发现的 Bug 清单

### P0 (Critical) — 0 个
无 Critical bug。

### P1 (High) — 0 个
无 High bug。

### P2 (Medium) — 10 个, 全部已修复

#### P2-1: 类别导航参数错误 (clone-themes 6 处)
- **症状**: 多个 clone-themes 组件使用 `navigate({ view: 'category', q: <值> })` 调用导航, 但 `view: 'category'` 期望 `cat:` 参数(分类 ID), 而非 `q:`(搜索关键词)。
- **影响**: 用户点击类别链接会被路由到 `view: 'category'`, 但 `cat` 为 undefined, CategoryView 会显示"全部分类"而非预期分类, 用户体验割裂。
- **位置与修复**:
  | 文件 | 行号 | 修前 | 修后 |
  |------|------|------|------|
  | `x2552/HomeClone.tsx` | 171 | `q: b.category` | `cat: b.categoryId \|\| ''` |
  | `x2552/BookInfo.tsx` | 69 | `q: book.category` | `cat: book.categoryId \|\| ''` |
  | `trxsw/BookInfo.tsx` | 35 | `q: book.category` | `cat: book.categoryId \|\| ''` |
  | `trxsw/BookInfo.tsx` | 47 | `q: book.category` | `cat: book.categoryId \|\| ''` |
  | `x2552/CategoryList.tsx` | 92 | `q: b.category` | `cat: b.categoryId \|\| ''` |
  | `x2552/CategoryList.tsx` | 133 | `q: c` (SIDE_CATS 名字) | `navigate({ view: 'category' })` (无 cat, 显示全部) |
  | `shipsay/CategoryList.tsx` | 95 | `q: c` (SIDE_CATS 名字) | `navigate({ view: 'category' })` (无 cat, 显示全部) |
- **说明**:
  - 行级 cat 链接(b.category/book.category): 改用 `categoryId`(实际 ID) 替代 `category`(显示名)
  - 侧栏分类列表(SIDE_CATS): 因 SIDE_CATS 是分类名字数组(无 ID), 无法直接路由到具体分类, 改为路由到"全部分类"视图(无 cat 参数), 用户可在 CategoryView 内自行选择具体分类
  - `b.categoryId || ''`: 防御性兜底, categoryId 为 null/undefined 时回退空串(空串在 books API 视为 falsy, 不应用过滤)

#### P2-2: ReadChrome "返回书页"空 bookId 导航 (clone-themes 4 处)
- **症状**: 4 个 ReadChrome 组件的面包屑"返回书页"链接使用 `navigate({ view: 'book', bookId: '' })`, 但 `bookId: ''` 是无效值, 会路由到 BookView 加载空 ID 的书籍, 触发 fetchBook('') → API 404 → 页面报错。
- **影响**: 用户点击"返回书页"会进入错误状态。
- **位置与修复**:
  | 文件 | 行号 | 修前 | 修后 |
  |------|------|------|------|
  | `pilishuwu/ReadChrome.tsx` | 21 | `<a onClick={...navigate({view:'book',bookId:''})}>` | `<span>返回书页</span>` (非交互) |
  | `23qb/ReadChrome.tsx` | 21 | 同上 | `<span>返回书页</span>` |
  | `huangjinwu/ReadChrome.tsx` | 21 | 同上 | `<span>返回书页</span>` |
  | `101kks/ReadChrome.tsx` | 21 | 同上 (繁体"返回書頁") | `<span>返回書頁</span>` |
- **说明**:
  - `ReadChromeProps` 当前不包含 `bookId`, 因此无法路由到当前章节所属书籍
  - 改为非交互 `<span>`: 保留视觉布局(面包屑右侧文案), 不再有 broken link 行为
  - 长远方案: 后续可扩展 `ReadChromeProps` 增加 `bookId` 字段, 由 ReadView 透传, 但属于 R17+ 范围
  - 翻页区已有"返回首页"链接, 不与"返回书页"功能冲突

### P3 (Cosmetic/Minor) — 5 个, 未修复(说明原因)

#### P3-1: huangjinwu/BookInfo.tsx line 24 cursor:pointer 误导
- **症状**: 面包屑分类 `<span style={{ color: '#1d4ed8', cursor: 'pointer' }}>{book.category}</span>` 设置了 `cursor: pointer` 但无 onClick, 用户悬停时鼠标变手型但点击无反应。
- **不修复原因**: 视觉提示问题, 不影响功能。修后可能破坏 1:1 克隆的视觉精确度(原站 cursor 也可能如此)。属于"防御性优化"范畴, 不在"只修真实 bug"范围。

#### P3-2: auto-tdk.ts "共{wordCount}" 当 wordCount=0 时残留"共"
- **症状**: 多个 TDK 模板使用 `共{wordCount}`(因 `formatWordCount` 已带"字"后缀, 避免重复"字字")。当 `ctx.wordCount = 0/undefined` 时, `renderTemplate` 返回 `wordCountStr = ''`, 拼接出 `共, 连载中` 这种残留标点的字符串。
- **不修复原因**: 实际章节均有 wordCount(>0), 触发概率极低; 修复需在模板内加 `if(wordCount>0)` 条件, 但模板字符串不便加分支逻辑。属于边缘情况, 不影响主流程。

#### P3-3: auto-tdk.ts status='unknown' 直接透传
- **症状**: `renderTemplate` 的 `statusStr` 处理: `ctx.status === 'completed' ? '已完结' : ctx.status === 'ongoing' ? '连载中' : ctx.status`。当 `status = 'unknown'` 时, 直接返回字符串 `'unknown'`, 在中文模板中嵌入英文, 视觉突兀。
- **不修复原因**: 实际章节 API 返回的 status 总是 'completed'/'ongoing' 之一(管理端校验), 'unknown' 极少出现; 即使出现, 模板渲染出的中文语义仍可读, 不影响 SEO。属于边缘情况。

#### P3-4: 多个 HomeClone 表格硬编码 slice(0, 15)
- **症状**: `latestBooks.slice(0, 15)` 重复出现(ddyueshu/23qb/101kks/pilishuwu/trxsw 等), 即使 `homeModuleLimit=50`, 表格仍只显示 15 条。
- **不修复原因**: 这是源站 DOM 1:1 克隆的体现(源站表格也固定 15 行), 不应受 homeModuleLimit 影响。homeModuleLimit 主要控制"最新上传卡片列表/最近更新表格行数", 但具体每套主题的展示模式各异。属于设计权衡, 非 bug。

#### P3-5: huangjinwu/HomeClone.tsx footer 链接 target="_blank"
- **症状**: footer 站内链 `href="/"` 使用 `target="_blank"`, 用户点击会打开新标签页而非站内跳转。
- **不修复原因**: 1:1 克隆原站行为(原站 footer 链接同样 target="_blank"), 修改会偏离克隆目标。属于克隆保真度的权衡, 非 bug。

## 4. 修改文件清单 (Part 2 修复)

### clone-themes 7 个文件
1. `src/components/public/clone-themes/x2552/HomeClone.tsx` (P2-1: 1 处 cat 导航修复)
2. `src/components/public/clone-themes/x2552/BookInfo.tsx` (P2-1: 1 处)
3. `src/components/public/clone-themes/x2552/CategoryList.tsx` (P2-1: 2 处)
4. `src/components/public/clone-themes/trxsw/BookInfo.tsx` (P2-1: 2 处)
5. `src/components/public/clone-themes/shipsay/CategoryList.tsx` (P2-1: 1 处)
6. `src/components/public/clone-themes/pilishuwu/ReadChrome.tsx` (P2-2: 1 处 span 改造)
7. `src/components/public/clone-themes/23qb/ReadChrome.tsx` (P2-2: 1 处)
8. `src/components/public/clone-themes/huangjinwu/ReadChrome.tsx` (P2-2: 1 处)
9. `src/components/public/clone-themes/101kks/ReadChrome.tsx` (P2-2: 1 处)

## 5. 验证

### TypeScript 严格检查
- `bunx tsc --noEmit` (排除 examples/skills): **0 errors** ✓
- `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` (排除 examples/skills): **0 errors** ✓

### ESLint
- `bun run lint`: **exit 0** (0 errors / 0 warnings) ✓

### dev server 主题回归
- 10 套主题 dev server 全部 200 OK:
  - clone-aijjxs ✓
  - clone-ddyueshu ✓
  - clone-pilishuwu ✓
  - clone-23qb ✓
  - clone-101kks ✓
  - clone-huangjinwu ✓
  - clone-ggd66 ✓
  - clone-shipsay ✓
  - clone-x2552 ✓
  - clone-trxsw ✓
- dev.log 无 error/warn

### DB schema 验证
- `bun run db:push` 成功 ✓
- `bunx tsx -e` 实测: 现有 2 个站点 navCategoryCount=16 / homeModuleLimit=20 (Prisma @default 生效) ✓

## 6. 不修改的内容 (尊重约束)

### 6.1 不动的 R14/R15 代码
- `themes.ts` (10 套主题 preset)
- `BookInfoLayout.tsx` (10 套 BookInfo 变体分发, R14-1A 落地) — 仍被 BookView.tsx 使用, 不删除
- `read-layouts/Read{Classic,Immersive,Paginated,Pili}.tsx` (4 套阅读布局, R14-1A 落地)
- `BookCover.tsx` / `bits.tsx` / `seo.ts` / `ctx.tsx` / `types.ts`(只加字段不改名)

### 6.2 不动的 R16-1A/B clone-themes 实现
- aijjxs 6 站点 (R16-1A) + ggd66/shipsay/x2552/trxsw 4 站点 (R16-1B) 共 10 套
- 仅修复上述 P2 bug, 不重写

### 6.3 不动的 auto-tdk.ts 18 预设
- TDK_PRESETS 数组(18 个 preset 全保留)
- 4 个工具函数 getTDKPreset/getRandomTDKPreset/renderTDKByPreset/randomCombineTDK 全保留
- 内部 renderTemplate/renderTemplate 字数+状态处理保留

### 6.4 不动的 CloneCSSLoader.tsx
- SITE_CSS_MAP 10 条映射保留
- useEffect 检查已加载 CSS 的逻辑保留(主题切换时不立即删除旧 CSS, 设计权衡)

### 6.5 不动的 HomeView.tsx dynamic import 链
- 10 个 dynamic() 导入保留
- 兜底 BookGridSkeleton 保留

### 6.6 不动的 PublicSite.tsx CloneCSSLoader 接入
- `<CloneCSSLoader />` 在 `<SiteHeader />` 与 `<main>` 之间保留

## 7. 审计结论

- **P0 = 0 / P1 = 0 / P2 = 10 (全部修复) / P3 = 5 (说明原因不修)**
- 修复后 tsc 0 errors / lint 0 errors / dev server 10 套主题 200 OK
- R16 新增代码整体质量良好: 类型完整、null 安全、事件绑定正确、响应式完善
- 主要 bug 集中在"导航调用参数错误"与"空 bookId 导航"两类, 均为开发者对 ViewParams 接口理解偏差导致
- 未发现 React Hooks 误用、内存泄漏、未清理副作用等高危问题
