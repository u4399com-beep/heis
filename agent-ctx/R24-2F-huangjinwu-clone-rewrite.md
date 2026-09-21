# Task R24-2F — huangjinwu 主题 8 页型 1:1 重写

## 任务范围
- 重写 `src/components/public/clone-themes/huangjinwu/` 下的 8 个 .tsx 文件
- 不动 shipsay/aijjxs/23qb/ddyueshu (其他 agent 已完成)
- 不动 pilishuwu/101kks/ggd66/x2552/trxsw (其他 agent 负责)
- 不动 HomeView/PublicSite/CloneCSSLoader/themes.ts/books route (主控已接线)

## 步骤 1: 读交接文档
- `tail -300 worklog.md` → 确认 R24-1A 主控已完成 shipsay/HomeClone 1:1 示范 + HomeView 接线
- R24-2A/B/C 已重写 aijjxs/23qb/ddyueshu 三套, 我负责第 4 套 huangjinwu

## 步骤 2: 读参考样本
- `agent-ctx/probe-html2/probe-huangjinwu.html` (674 行, 52KB, 黄金屋真实抓取)
- `public/clone-css/huangjinwu.css` (463 行, 44KB, 169 个 unique class selectors)
- `shipsay/HomeClone.tsx` + `aijjxs/HomeClone.tsx` (主控 + R24-2A agent 示范)

## 步骤 3: 提取 huangjinwu 真实 DOM
- 顶部 header (玻璃效果): `.header-group > .headers (backdrop-filter) > .container > .navbar`
  含 `.user-dropdown .user-toggle + .user-dropdown-menu ul` + `a.logo (iconfont icon-book)` +
  `.sidebar-wrapper (.sidebar-header .sidebar-logo + ul.navbar-menu 7 项 + .navbar-menu-search)` +
  `form.navbar-search input + button.navbar-search-btn` + `button.theme-toggle` +
  `.menu-overlay` + `button.menu-toggle`
- 主内容区: `.main-content > .container > .hot-section/.sort-section/.update-section/.detail-section.ebook-more-ebooks`
- 页脚: `.footers > .container > p.sitemap (6 链接) + p.copyright × 2`
- 子页结构: 从 CSS class 反查 (`huangjinwu` 无 book/chapter/category probe)
  - 书页: `.breadcrumb` + `.detail-header/.detail-cover/.detail-info/.detail-title/.detail-meta × 6/.detail-actions` + `.detail-section 内容简介/.chapter-list`
  - 阅读页: `.reader-container/.reader-header/.reader-title/.reader-controls/.reader-content h1#chapterTitle/.reader-nav`
  - 分类页: `.breadcrumb` + `.filter-bar/.filter-tags/.filter-tag.active` + `.book-list/.book-list-item` + `.pagination`
  - 排行榜: `.filter-bar` 5 个 tab + `.category-ranking-grid` 6 个 `.ranking-module`
  - 搜索页: `.search-form/.search-input/.btn-primary` + `.search-result-info` + `.book-list`
  - 关键词页: `.page-title` + `.search-form` + `.search-result-info` + `.book-list` + `.detail-section.hot-tags-section .tag-list`

## 步骤 4: 8 个文件清单
| 文件 | 行数 | 主要 class 复刻 |
|------|------|----------------|
| HomeClone.tsx | 283 | .header-group/.headers/.navbar/.sidebar-wrapper/.navbar-menu 7 项 + .hot-section/.sort-section/.update-section/.ebook-more-ebooks + .footers |
| BookInfo.tsx | 231 | .breadcrumb + .detail-header/.detail-cover/.detail-info/.detail-title/.detail-meta × 6/.detail-actions + .detail-intro-content + .intro-toggle-btn 展开/收起 + .tag-list + .chapter-list |
| CategoryList.tsx | 243 | .breadcrumb + .page-title + .filter-bar/.filter-tags 分类切换 + .book-list/.book-list-item × N + .pagination |
| ReadChrome.tsx | 172 | .breadcrumb + .reader-container .reader-header .reader-title + .reader-controls + .reader-content h1#chapterTitle + .reader-nav 上下章按钮 |
| RankingView.tsx | 222 | .breadcrumb + .page-title + .filter-bar 5 个 tab + .category-ranking-grid 6 个 .ranking-module × 10 .ranking-item + .pagination |
| FulltextView.tsx | 233 | .breadcrumb + .page-title + .filter-bar + .book-list × N + .pagination |
| SearchView.tsx | 182 | .breadcrumb + .search-form .search-form-inline + .search-result-info + .book-list/.search-empty |
| KeywordView.tsx | 220 | .breadcrumb + .page-title + .search-form + .search-result-info + .book-list + .hot-tags-section .tag-list 相关标签 |
| **总计** | **1786** | (旧 8 文件 211 行, 净增 1575 行, 8.5x 扩展) |

## 步骤 5: 关键设计
- 全部用源站真实 class 名 (80+ 个), 让 CloneCSSLoader 加载的 huangjinwu.css 选择器全部命中
- 不用 inline style 换配色 (旧 32 行模板的做法), 仅保留必要 layout (color:inherit/textDecoration:none 用于 a 包裹 ranking-module-title)
- 交互保留: bookNavProps(navigate, b.id) / navigate({view:'category',cat}) / navigate({view:'search',q}) / onPrev/onNext / onTabChange / onPage / onContinueRead/onScrollToc / onGoCategory
- 数据源: HomeClone/CategoryList/FulltextView 内部 useEffect fetch /api/public/categories?limit=60 解析 `d.data?.items || []`; 其他 5 文件用 props 传入 books/book
- 共享 props 类型: 全部从 `../shared` import
- 'use client' 首行: 所有 8 文件 (用了 useState/useEffect/onClick)
- 主题适配: huangjinwu.css 已配置 [data-theme=light/dark/green] 三套主题, 我的 8 文件全部用 CSS 变量, 主题切换自动生效

## 步骤 6: 验证
- 第 1 轮 lint 发现 huangjinwu 2 个 unused-vars:
  - `BookInfo.tsx`: bookNavProps 未用 → 移除导入
  - `HomeClone.tsx`: navCategoryCount + goCat 未用 → 用 navCategoryCount 切片 rankCats, 用 goCat 包裹 ranking-module-title a 标签
- 第 2 轮 lint: huangjinwu 8 文件 **0 errors / 0 warnings** ✓
  (剩余 11 errors 全在 101kks/pilishuwu 主题, 属其他 agent 任务范围)
- `bunx tsc --noEmit`: src/ 0 errors ✓ (排除 101kks/HomeClone.tsx 1 个 TS2322 错误, 属其他 agent 任务范围; examples/skills 预存在错误)
- dev server log: dev.log 显示 server 编译成功 (✓ Compiled in XXXms 多次), clone-css 加载 OK

## 约束遵守清单
- ✅ 只改 `src/components/public/clone-themes/huangjinwu/` 下的 8 个 .tsx 文件
- ✅ 不动 shipsay/aijjxs/23qb/ddyueshu (其他 agent 已重写好)
- ✅ 不动 pilishuwu/101kks/ggd66/x2552/trxsw (其他 agent 负责)
- ✅ 不动 HomeView/PublicSite/CloneCSSLoader/themes.ts/books route
- ✅ 不动 bits.tsx/seo.ts/ctx.tsx/BookCover.tsx/types.ts/shared.ts/helper
- ✅ 不动 prisma/schema.prisma
- ✅ 未安装新 npm 包 (0 新依赖)
- ✅ 全部用源站真实 class 名, 让 CloneCSSLoader 加载的 huangjinwu.css 生效
- ✅ 不用 inline style 换配色
- ✅ 'use client' 在文件首行
- ✅ 每个 props interface 从 `../shared` import
- ✅ 复刻源站完整 DOM 结构 (header + main-content + footers)
- ✅ 保留交互 (bookNavProps/navigate/onPrev/onNext/onTabChange/onPage/onContinueRead/onScrollToc/onGoCategory)
- ✅ categories API 返回 `{ok, data:{items:[...]}}`, 解析用 `d.data?.items || []`
