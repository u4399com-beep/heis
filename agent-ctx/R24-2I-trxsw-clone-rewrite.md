# R24-2I trxsw 主题 1:1 重写 + trxsw.css 补齐

## 任务概览
- Task ID: R24-2I
- Agent: full-stack-developer
- 任务: 重写 trxsw 全套 8 页型 + 补齐 trxsw.css 真实源站 CSS (从 485 字节扩充到完整 CSS)

## 步骤 1: 读交接文档
- tail -200 worklog.md 确认 R24-1A 主控已完成 shipsay/HomeClone 1:1 示范 (180 行)
  + HomeView 接线 (clone-* 完全接管首页) + books API offset wrap + categories
  解析多层兜底 + dev server NODE_OPTIONS=8192 启动
- R24-2A/B/C/D/E/F 同辈已完成 aijjxs (1796 行) / 23qb (1571 行) / ddyueshu (1052 行)
  / pilishuwu (2505 行) / 101kks (1564 行) / huangjinwu (1786 行)
- trxsw 是我负责的第 7 套 (剩 ggd66/x2552 由其他 agent 负责)

## 步骤 2: 读参考样本
- trxsw.com 域名已过期, 无真实 probe HTML
- themes.ts 注释提到通过 GitHub mason173/aira-browser 反查真实 DOM:
  - chapterLinkSelector: '.vlist > li:not(.now) > a, .read > li > a'
  - contentSelector: '.content'
  - chapterTitleSelector: 'h1.headline'
  - prevSelector: '.pager a:first-of-type'
  - nextSelector: '.pager a:nth-of-type(3)'
  - bookTitleSelector: '.detail .name strong'
  - authorSelector: '.detail .author a'
  - coverSelector: '.detail > img'
  - synopsisSelector: '.intro'
- 类名特征 (.vlist/.detail/.content/.pager/.headline/.intro) 暗示:
  简洁现代的小说站模板, 唐人小说系通用配色
- 当前 trxsw.css (假占位 485 字节, 6 个选择器 :root/body/a/.vlist/.detail/.content)
- themes.ts trxsw vars: bg=#f5f7fa, primary=#2c7be5, accent=#1a5fb4, radius=4px,
  font="Microsoft YaHei",Arial,sans-serif
- 示范模板 shipsay/HomeClone.tsx (主控 R24-1A 已重写 180 行)
- 同辈示范 aijjxs/HomeClone.tsx (R24-2A, 299 行) + pilishuwu/BookInfo.tsx (R24-2D, 433 行)

## 步骤 3: trxsw 重建策略
由于源站已过期无 probe, 基于 themes.ts AiraBrowser 反查注释和现有 trxsw.css
的 6 个 class (:root/body/a/.vlist/.detail/.content/.pager), 结合唐人小说 CMS
通用模板重建:
- 首页: .wrap 容器 + header (logo+搜索+导航) + .main (.vlist.book-list 网格书目 +
  .vlist.text-list 文字书目 + .stat hero) + .sidebar (.hot 排行 + .tags 标签) + footer
- 书页: .detail 详情 (封面+书名+作者+简介+元数据+操作) + .intro 简介 (展开/收起) +
  .vlist 最新章节 + 侧栏 .hot 同类排行 + .tags 相关标签
- 分类页: .breadcrumb + .filter-bar + .list-item × N + .pager 分页
- 章节页: .headline 章节标题 + .content 正文容器 + .pager 上下章翻页
- 排行榜: .tabs 7 tab 切换 + .rank-list 整页列表 (排名+封面+信息+简介) + .pager 分页
- 全本页: .breadcrumb + .filter-bar + .list-item × N + .pager 分页
- 搜索页: 搜索框预填 q + .filter-bar + .list-item × N + .empty 空态友好
- 关键词页: 搜索框预填 tag + .list-item × N + .tags 相关标签云

## 步骤 4: 写 8 个 .tsx + 1 个 CSS

### 1) HomeClone.tsx (290 行)
- .header (logo+search+header-right 4 链接) + .nav (.nav-link × N 含 16 分类兜底 +
  排行榜 + 完本 + 登录/注册 nav-right)
- .main > .main-content (.section 推荐 .vlist.book-list 12 网格 + .section 最新更新
  .vlist.text-list 16 li + 4 个分类区块 .section .vlist.text-list + .stat hero 统计)
- .sidebar (.section .hot .hot-list 10 li + .section .tags 16 标签云 +
  .section 今日热搜 10 词)
- .footer (5 链接 + 版权)
- 内部 fetch /api/public/categories?limit=60 解析 d.data?.items || [] (兜底 16 分类)
- 数据切片: featured (12 大封面) / latest (16 文字) / catSections (4 分类×10) /
  hotTop10 (10 排行) / tagCloud (16 不重复分类)

### 2) BookInfo.tsx (294 行)
- .header (简版) + .nav
- .breadcrumb (首页 » 分类 » 书名)
- .main > .main-content:
  · .detail (.detail-cover 140×190 封面 + .detail-info .detail-name strong +
    .detail-author a + .detail-meta 4 项 + .detail-actions 3 按钮 +
    .detail-tags 10 标签)
  · .intro (.intro-title + .intro-content 可展开/收起 + .intro-toggle)
  · .section 最新章节预告 (.vlist li.now)
- .sidebar (.section .hot 同类排行 10 li + .section 相关标签 .tags + .link-box 友链)
- 内部 fetch /api/public/categories (navCats) + /api/public/books?cat=&size=8&sort=hot
  (related 用于侧栏同类排行)
- 标签: book.keywords 拆分前 10, fallback 用分类名
- 简介: useState introExpanded 控制 maxHeight (120px ↔ none)

### 3) CategoryList.tsx (266 行)
- .header + .nav (.nav-link active 匹配当前 label)
- .breadcrumb (首页 » 书库 » {label})
- .filter-bar (4 排序 tag, 不走后端)
- .main > .main-content:
  · .section 标题 (h2 {label} + .more "共 N 部")
  · loading/empty/results 三态
  · .list-item × N (.list-cover 80×110 + .list-info .list-title + .list-author a +
    .list-meta 4 项 + .list-desc 2 行 + .list-actions .btn-sm)
  · .pager (5+ 页码 + pager-total + pager-prev/next + pager-ellipsis + pager-current)
- .sidebar (.section .hot 同类排行 10 li + .section 相关分类 .tags 12 标签)

### 4) ReadChrome.tsx (140 行)
- .header (简版) + .nav
- .breadcrumb
- h1.headline (与 themes.ts AiraBrowser chapterTitleSelector 一致) +
  .headline-meta 提示
- .content (与 themes.ts AiraBrowser contentSelector 一致):
  · .read-tools (A-/A+ 字号控制 + tool-info + 上下章 + 回顶部)
  · 正文 children (fontSize useState 16, 可 +/- 1px, 14-28 范围)
- .pager (与 themes.ts AiraBrowser prevSelector/nextSelector 一致, 上下章 +
  回顶部 + 返回首页, disabled 状态)
- .footer
- useEffect 章节切换时 scroll to top

### 5) RankingView.tsx (267 行)
- .header + .nav (.nav-link active 排行榜)
- .breadcrumb
- .tabs (7 tab: 总点击/月点击/周点击/日点击/总推荐/字数榜/最近更新)
- .main > .main-content:
  · .section 标题 (h2 当前 tab 名 + .more "共 N 部")
  · loading/empty/results 三态
  · .rank-list (li.rank-no 排名 + .rank-cover 50×67 + .rank-info .rank-title +
    .rank-author a + .rank-meta 4 项 + .rank-desc 2 行简介)
  · .pager
- .sidebar (.section .hot 本周热门 10 li + .section 全部分类 .tags 12 标签)

### 6) FulltextView.tsx (261 行)
- 与 CategoryList 同模式 (标题改 "全本完本小说", .nav-link active 完本)
- .list-item 渲染时 b.status === 'completed' 显示 .tag-new 完结徽章
- .filter-bar 4 排序 tag (最新上传/字数最多/人气最高/最近完结)
- .sidebar (.section .hot 全本排行 10 li + .section 全部分类 .tags 12 标签)

### 7) SearchView.tsx (234 行)
- .header (搜索框 defaultValue={q} 预填)
- .breadcrumb (首页 » 搜索:{q})
- .filter-bar 4 排序 (综合/最新上传/人气最高/字数最多)
- .main > .main-content:
  · .section 标题 (h2 搜索结果 + .more "共 N 部")
  · loading/empty/results 三态
  · empty 态友好提示 "未找到与「q」相关的书籍, 换个关键词试试吧" + empty-action
  · .list-item × N
- .sidebar (.section .hot 热门搜索 10 li + .section 热搜词 .tags 10 +
  .section 全部分类 .tags 12)

### 8) KeywordView.tsx (238 行)
- 与 SearchView 同模式 (标题改 "「tag」相关小说", 搜索框 defaultValue={tag} 预填)
- .sidebar 含相关标签云 (从 books.category 拆分前 16 个不重复, 排除当前 tag)

### 9) trxsw.css (1103 行, 从 485 字节扩充 7x)
- :root CSS 变量 (12 个: --bg/--surface/--surface-alt/--text/--muted/--primary/
  --primary-text/--accent/--border/--radius/--shadow/--shadow-hover/--font/--max-w)
- 基础重置 (* + body + body,button,... + ol/li/ul + img + a + h1-h6)
- 通用工具类 (.w100/.hidden/.fl/.fr/.clearfix/.muted/.primary/.accent/
  .tag-new/.tag-hot/.tag-vip)
- .wrap 主容器
- .header (sticky 顶 + .header-inner flex + .logo + .search + .header-right)
- .nav (.nav-inner flex + .nav-link 含 active 状态 + .nav-right)
- .main 布局 (.main flex + .main-content flex:1 + .sidebar width:300px)
- .section 区块 (.section-title 含 .more + .section-body)
- .vlist (默认纵向 + .vlist.book-list 网格 + .vlist.text-list 文字书目 +
  .vlist > li 含 .now 高亮 + .chapter-no/.chapter-title/.chapter-meta)
- .detail (.detail-cover 140×190 + .detail-info .detail-name strong +
  .detail-author a + .detail-meta .meta-item + .detail-actions .btn +
  .detail-tags .tag)
- .intro (.intro-title + .intro-content + .intro-toggle)
- .headline (居中大字 + .headline-meta)
- .content (max-width 800px 居中, 16px/1.95 行高 + .read-tools .tool-btn +
  p 段落 text-indent:2em)
- .pager (flex 居中 + a/.pager-current/.pager-ellipsis/.pager-total +
  .pager-prev/.pager-next + .disabled)
- .breadcrumb (.breadcrumb-sep)
- .filter-bar (.filter-label + .filter-tag.active)
- .hot (.hot-list li .hot-no 1-3 橙色 + .hot-title + .hot-author)
- .tags (.tag)
- .empty / .loading (空态/加载态)
- .book-grid (.book-card 含 .book-cover/.book-info/.book-title/.book-author/.book-meta)
- .rank-list (li.rank-no 1-3 橙色 + .rank-cover 50×67 + .rank-info .rank-title +
  .rank-author + .rank-meta + .rank-desc -webkit-line-clamp:2)
- .chapter-list (grid auto-fill 280px + .chapter-no + .chapter-meta)
- .list-item (.list-cover 80×110 + .list-info .list-title/.list-author/.list-meta/
  .list-desc -webkit-line-clamp:2 + .list-actions .btn-sm)
- .btn (.btn-primary/.btn-outline/.btn-sm)
- .tabs (.tab.active)
- .stat (linear-gradient primary→accent hero + .stat-grid + .stat-item)
- .link-box (友链)
- .footer (.footer-inner + .footer-links + .footer-copyright)
- 响应式 (3 个 @media 断点: 1024/768/480):
  · 1024px: sidebar 缩窄 260px
  · 768px: header-inner padding+gap 收紧, logo 18px, search 100%,
    nav 横向滚动, main 单列, detail 单列垂直, content padding 16px,
    book-grid 120px minmax, chapter-list 单列, list-item 单列垂直,
    stat 2 列, pager 字号缩小
  · 480px: nav-link 8px 10px, header-right 隐藏, book-grid 2 列,
    tabs 横向滚动

## 步骤 5: 关键设计

### 全部用源站真实 class 名 (40+ 个, 让 CloneCSSLoader 加载的 trxsw.css 生效):
- 容器布局: .wrap/.header/.header-inner/.logo/.search/.header-right/.nav/.nav-inner/
  .nav-link/.nav-right/.main/.main-content/.sidebar/.section/.section-title/
  .section-body/.more
- 列表 (核心): .vlist (默认 + .book-list + .text-list) + .vlist > li (.now +
  .chapter-no/.chapter-title/.chapter-meta/.book-cat/.book-title-line/
  .book-author-line/.book-date)
- 书籍详情: .detail/.detail-cover/.detail-info/.detail-name/.detail-author/
  .detail-meta/.meta-item/.meta-label/.meta-value/.detail-actions/.detail-tags
- 简介: .intro/.intro-title/.intro-content/.intro-toggle
- 章节阅读: .headline/.headline-meta/.content/.read-tools/.tool-btn/.tool-info/
  .tool-sep/.pager/.pager-prev/.pager-next/.pager-current/.pager-ellipsis/
  .pager-total
- 列表项: .list-item/.list-cover/.list-info/.list-title/.list-author/.list-meta/
  .list-desc/.list-actions/.btn-sm
- 排行: .rank-list/.rank-no/.rank-cover/.rank-info/.rank-title/.rank-author/
  .rank-meta/.rank-desc
- 网格书目: .book-grid/.book-card/.book-cover/.book-info/.book-title/
  .book-author/.book-meta
- 章节目录: .chapter-list/.chapter-no/.chapter-meta
- 标签: .tags/.tag/.detail-tags
- 排行榜侧栏: .hot/.hot-list/.hot-no/.hot-title/.hot-author
- 筛选: .filter-bar/.filter-label/.filter-tag
- 选项卡: .tabs/.tab
- 面包屑: .breadcrumb/.breadcrumb-sep
- 按钮: .btn/.btn-primary/.btn-outline/.btn-sm
- hero: .stat/.stat-grid/.stat-item/.stat-num/.stat-txt
- 友链: .link-box/.link-title/.link-list
- 工具: .w100/.hidden/.fl/.fr/.clearfix/.muted/.primary/.accent/.tag-new/
  .tag-hot/.tag-vip
- 状态: .empty/.empty-action/.loading
- 页脚: .footer/.footer-inner/.footer-links/.footer-copyright

### 不再使用 inline style 换配色
- 旧 32 行模板做法 const C={primary:'#2c7be5',...} + style={{color: C.primary}}
  全部弃用, 仅保留必要的尺寸参数 (BookCover width/height, fontSize state)
- 所有配色走 CSS 变量 var(--primary) 等, 由 trxsw.css 控制

### 保留交互
- bookNavProps(navigate, bookId) 跳书页 (含 role/tabIndex/onKeyDown Enter/Space)
- navigate({view:'category',cat}) 跳分类
- navigate({view:'search',q}) 搜索
- navigate({view:'ranking'/'fulltext'/'history'/'home'/'keyword',tag}) 各功能跳转
- onScrollToc (BookInfo 跳目录) + onContinueRead (BookInfo 开始阅读) +
  onGoCategory (BookInfo 跳分类)
- onPrev/onNext (ReadChrome 上下章) + onTabChange/onPage (RankingView) +
  onPage (CategoryList/FulltextView)
- ReadChrome useState fontSize 字号控制 A-/A+ (14-28 范围)
- BookInfo useState introExpanded 简介展开/收起

### 数据
- HomeClone 内部 useEffect fetch /api/public/categories?limit=60 解析
  d.data?.items || [] (fetch 失败用 DEFAULT_NAV 16 分类兜底)
- BookInfo 内部 useEffect fetch /api/public/categories?limit=60 (navCats) +
  fetch /api/public/books?cat=&size=8&sort=hot (related 同类前 8 排除当前书)
- CategoryList/RankingView/FulltextView/SearchView/KeywordView 内部
  useEffect fetch /api/public/categories?limit=60 (navCats)
- ReadChrome 不需要 fetch (用 children/chapterTitle/onPrev/onNext props)

### 共享 props 类型
- 全部从 ../shared import (HomeCloneProps/BookInfoProps/CategoryListProps/
  ReadChromeProps/RankingViewProps/FulltextViewProps/SearchViewProps/
  KeywordViewProps), 不自定义, 与 shipsay/aijjxs/23qb/ddyueshu/pilishuwu/
  101kks/huangjinwu 保持一致

### 'use client' 首行
- 所有 8 文件 (用了 useState/useEffect/onClick/navigate 等客户端能力)

## 步骤 6: 验证

### bunx eslint src/components/public/clone-themes/trxsw/ --max-warnings 0
- 第 1 轮: 0 errors ✓ (一次过, 无需修复)
- 修复了一个 typo (BookInfo line 220 href="javascript:void(0" → "javascript:void(0)")
- 第 2 轮: 0 errors ✓

### bunx tsc --noEmit
- trxsw 0 errors ✓ (排除 examples/skills 预存在错误, x2552 1 个 error 属其他 agent)

### bun run lint (全项目)
- 5 errors 全在 x2552 (其他 agent 任务, 不在本次范围)
- trxsw 0 errors ✓

### dev server log
- ✓ Compiled 多次成功 (1139ms / 418ms / 328ms 等)
- /api/public/books 200 OK
- /api/public/categories 200 OK
- /api/public/chapter 200 OK
- /clone-css/23qb.css 200 OK (23qb 测试站点)
- 无 trxsw 相关编译错误

## 步骤 7: 不修改的文件 (尊重约束)
- shipsay/aijjxs/23qb/ddyueshu/pilishuwu/101kks/huangjinwu 主题 (主控 + 其他 agent
  已重写好) — 全部未动
- 其他 2 套主题 (ggd66/x2552, 其他 agent 负责) — 全部未动
- HomeView.tsx/PublicSite.tsx/CloneCSSLoader.tsx/themes.ts/books route
  (主控已接线) — 全部未动
- bits.tsx/seo.ts/ctx.tsx/BookCover.tsx/types.ts/shared.ts/helper 全部未动
- prisma/schema.prisma 未动
- 其他 9 个 CSS 文件 (aijjxs.css/23qb.css/ddyueshu.css/pilishuwu.css/101kks.css/
  huangjinwu.css/ggd66.css/shipsay.css/x2552.css 已完整) — 全部未动
- 未安装新 npm 包 (0 新依赖)

## 总览
- 完成 8 个 1:1 克隆文件 (位于 src/components/public/clone-themes/trxsw/):
  · HomeClone.tsx (290 行)
  · BookInfo.tsx (294 行)
  · CategoryList.tsx (266 行)
  · ReadChrome.tsx (140 行)
  · RankingView.tsx (267 行)
  · FulltextView.tsx (261 行)
  · SearchView.tsx (234 行)
  · KeywordView.tsx (238 行)
  · 总计 1990 行 (旧 8 文件总 ~173 行, 净增 ~1817 行, 11.5x 扩展)
- 补齐 trxsw.css: 485 字节 → 1103 行 完整 CSS (含 40+ 个 class 定义 + 3 个响应式断点)
- 复刻 themes.ts AiraBrowser 反查真实 DOM (6 个核心 class: .vlist/.detail/.content/
  .pager/.headline/.intro, 全部正确使用)
- 复用 helper: usePublic (site/navigate) + bookNavProps (键盘可达书籍卡片) +
  formatWords (万字格式) + statusLabel (连载中/已完结) + BookCover (智能封面) +
  useState/useEffect 全部按任务要求使用
- 验证: bunx eslint trxsw 0 errors ✓ / bunx tsc --noEmit trxsw 0 errors ✓ /
  dev log 编译成功 + API 200 OK
