# R24-2A Work Record — aijjxs 主题 1:1 真克隆重写

## Task
Task ID: R24-2A
Agent: full-stack-developer (aijjxs 主题 1:1 重写)
Task: 重写 aijjxs 全套 8 页型为真正 1:1 克隆 aijjxs.com 真实 DOM

## Inputs Read
1. `worklog.md` 最后 200 行 — 了解 R24-1A 主控已完成的工作
   - shipsay/HomeClone 已重写为示范模板 (180 行 1:1 真克隆)
   - HomeView 接线: clone-* 主题完全接管首页, 不渲染通用 wrapper
   - books API P1 bug 修复 (offset wrap-around, dewew 单本站不再空)
   - shipsay/HomeClone categories 解析修复 (`d.data?.items || d.data?.categories || d.items || d.categories`)
   - dev server 需要 NODE_OPTIONS=--max-old-space-size=8192 (10 套 dynamic import)
2. `agent-ctx/probe-html2/probe-aijjxs.html` (61KB) — 首页真实 DOM
   - `.top-float` 顶部固定分类导航 (16 分类 + 登录/注册 + mobile-nav-panel)
   - `.wrap > header.top` (logo "站内搜索" + 搜索 form + search-history 今日热搜)
   - `.layout > section` 含 4 个 article.panel:
     * `.latest-upload` 最新上传 (ul.lines lines-books lines-books-2col, 16 项折叠)
     * `.panel` 封面推荐 (.grid2 .book 卡: img+badge+h4+meta+desc)
     * `.latest-upload` 小说分类 (.grid2 4 列: 女生/纯美/男生/悬疑, 每列 h4 + ul.lines lines-books)
     * `.panel` 专题书单 (.grid3 .desc × 3)
   - `.layout > aside` 含:
     * `.today-qd-users` 今日签到用户 (qd-user-list 5 头像)
     * `.panel.rank` 24小时热榜 (book_r + ul.lines)
     * `.panel.rank` 一周热榜 (book_r + ul.lines)
     * `.panel` 热门作者 (.body.tags)
   - `<section class="hero">` 数据统计 KPI
3. `agent-ctx/probe-html2/probe-aijjxs-book.html` (12KB) — 书籍详情页 `<body class="page-info">`
   - `.panel` h3《书名》 + body.detail (pic + img + kv p×6: 作者/分类/大小/进度/上传时间/下载方式)
   - `.panel.intro-panel` 内容简介 (h3 + body .desc)
   - `.panel` 下载与说明 (download-btn × 2 + .tips)
   - `.panel` 猜您喜欢 (.grid2 .book × 4)
   - aside: `.panel.rank` 热门X类小说下载 (book_r + ul.lines) + `.panel` 上下部翻页
4. `agent-ctx/probe-html2/probe-aijjxs-chapter.html` (8KB) — 章节阅读页(实际是作者页, 含 cenMain+catalog listbg)
   - top-float + wrap + top + main.layout > cenMain (.articleInfo h1 + .writerIntro + .catalog .listbg)
5. `agent-ctx/probe-html2/probe-aijjxs-category.html` (22KB) — 分类列表页
   - cenMain (.articleInfo h1 + .body.filters 3 rows [最新/人气/收藏/推荐][大小][时间]
     + .catalog .listbg × N [img+title+new/old+intro div+mainGreen meta]
     + .body .pager 分页)
   - aside (.panel.rank 热门X类下载 + .panel 热门作者 tags + .panel 相关分类 ul.lines)
6. `public/clone-css/aijjxs.css` (59KB) — 源站 CSS 由 CloneCSSLoader 自动加载
   - 关键选择器: .top-float/.wrap/.top/.layout/.panel/.body.grid2/.grid3/.lines lines-books
     /.book/.book_r/.rank/.no/.kv/.pic/.sfwj/.download-btn/.tips/.pager/.foot
     /.filters/.search/.search-history/.kpi/.hero/.desc/.tags/.today-qd-users
     /#logo/.qd-user-list/.listbg/.mainGreen/.articleInfo/.writerIntro
     /.cenMain/.catalog/.oldDate/.intro-panel
7. `src/components/public/clone-themes/shipsay/HomeClone.tsx` (主控示范模板)
   - 用源站真实 class 名 (header>.container.head / .navigation>nav / .container>.side_commend+aside / .container>.section.flex>.sortvisit)
   - 内部 useEffect fetch /api/public/categories
   - 数据拆分: 字数最多前 N → 大神小说; 前 12 → 热门小说; 按 categoryId 分组 → sortvisit 分类区块
   - 交互: bookNavProps(navigate, b.id) 跳书页; navigate({view:'category',cat}) 跳分类; navigate({view:'search',q}) 搜索

## Files Rewritten (8 files, 1796 lines total)
1. `src/components/public/clone-themes/aijjxs/HomeClone.tsx` (299 行)
2. `src/components/public/clone-themes/aijjxs/BookInfo.tsx` (240 行)
3. `src/components/public/clone-themes/aijjxs/CategoryList.tsx` (246 行)
4. `src/components/public/clone-themes/aijjxs/ReadChrome.tsx` (154 行)
5. `src/components/public/clone-themes/aijjxs/RankingView.tsx` (208 行)
6. `src/components/public/clone-themes/aijjxs/FulltextView.tsx` (223 行)
7. `src/components/public/clone-themes/aijjxs/SearchView.tsx` (205 行)
8. `src/components/public/clone-themes/aijjxs/KeywordView.tsx` (221 行)

## Source DOM Class Names Faithfully Reproduced
- `.top-float / .top-float-inner / .top-float-nav / .top-float-auth` (顶部固定导航条)
- `.wrap / .top / .top-1 / .logo / .top-links / .search / .search-history`
- `.layout / section / aside`
- `.panel / .latest-upload / .latest-upload-expand / .panel.rank / .panel.intro-panel`
- `.body / .gird2 / .grid2 / .grid3` (注意源站 latest-upload 用 .gird2 拼写错误, 我已 1:1 复刻)
- `.lines / .lines-books / .lines-books-2col / .line-main / .cat / .author / .date / .new / .old / .oldDate`
- `.book / .book_r / .badge / .meta / .desc / .kv / .pic / .sfwj / .copy-btn / .download-btn / .tips`
- `.rank / .no / .lines`
- `.tags / .qd-user-list / .today-qd-users`
- `.hero / .kpi / .item / .num / .txt`
- `.cenMain / .articleInfo / .writerIntro / .catalog / .listbg / .img / .title / .mainGreen / .classname`
- `.filters / .row / .on`
- `.pager / .foot`
- `.topic-link` (专题书单链接)

## Interactions Wired
- `bookNavProps(navigate, b.id)` — 所有书目链接 (keyboard-accessible)
- `navigate({view:'book', bookId})` — 跳书页 (默认走 bookNavProps)
- `navigate({view:'category', cat})` — 顶部 nav 分类链接 + "更多>>" + 相关分类
- `navigate({view:'search', q})` — 搜索表单 + 热门作者点击 + 今日热搜词
- `navigate({view:'home')` — logo 返回首页
- `navigate({view:'ranking')` — 相关分类"小说下载排行"
- `navigate({view:'fulltext')` — 相关分类"全本小说下载"
- `navigate({view:'keyword', tag})` — 相关标签
- `onScrollToc() / onContinueRead() / onGoCategory(cat)` — BookInfo props 回调
- `onPrev() / onNext()` — ReadChrome 章节翻页
- `onTabChange(tab) / onPage(p)` — RankingView 分类切换 + 分页
- `onPage(p)` — CategoryList / FulltextView / RankingView 分页

## Data Sources
- `/api/public/categories?limit=60` (categories 拉取 + 多层兜底解析: `d.data?.items || d.data?.categories || d.items || d.categories || []`)
- `props.books: BookItem[]` (HomeView 传入; CategoryList/Fulltext/Search/Keyword/Ranking 由父视图传入)
- `props.book: BookDetail` (BookInfo 传入)
- BookInfo 内部还拉 `/api/public/books?cat=<book.categoryId>&size=8` 取猜您喜欢/热门同类小说下载

## Constraints Honored
- 不修改 shipsay/* (主控已写好)
- 不修改其他 8 套主题 (23qb/ddyueshu/pilishuwu/101kks/huangjinwu/ggd66/x2552/trxsw)
- 不修改 HomeView/PublicSite/CloneCSSLoader/themes.ts/books route
- 不修改 BookView/CategoryView/ReadView/RankingView/FulltextView/SearchView/KeywordView 父视图
  (R19-1B worklog 声称的"lookup table"对这 4 个视图实际未落地, 但我 8 个 clone-theme 文件均按 props 接口
   正确导出, 未来主控可按 shipsay HomeClone 接线模式扩展)
- 全部用源站真实 class 名 (CloneCSSLoader 加载的 aijjxs.css 自动生效), 不再用 inline style 换配色
- 保留通用 helper: bookNavProps(navigate, id) / formatWords(n) / statusLabel(s) / BookCover / usePublic

## Verification
- `bun run lint`: 0 errors / 0 warnings (exit 0) ✓
- `bunx tsc --noEmit`: src/ 0 errors (仅 examples/skills 预存在错误) ✓
- `bunx eslint src/components/public/clone-themes/aijjxs/`: exit 0 ✓
- 8 文件总 1796 行 (从原来 8 × 32 行 = 256 行扩展到 1796 行, 7x 增长)
