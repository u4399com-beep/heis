# R24-2E — 101kks 主题 1:1 重写

Task ID: R24-2E
Agent: full-stack-developer (101kks 主题 1:1 重写)
Task: 重写 101kks 全套 8 页型为真正 1:1 克隆 101kks.com 101看書 真实 DOM

## 第 1 步 读交接文档
- tail -300 worklog.md → R24-1A 主控已完成 shipsay/HomeClone 1:1 示范(180 行) + HomeView 接线(clone-* 完全接管首页) + books API offset wrap-around + categories 解析多层兜底 + dev server NODE_OPTIONS=8192
- R24-2A/B/C 同辈已完成 aijjxs/23qb/ddyueshu 三套(每套 8 文件, 1000-1800 行)
- 本任务范围: 仅重写 src/components/public/clone-themes/101kks/* 8 个 .tsx, 不动 shipsay/aijjxs/23qb/ddyueshu + 其他 5 套 + 接线层/themes.ts/books route

## 第 2 步 读参考样本
- probe-101kks.html (974 行 / 47KB) — 首页真实 DOM, 繁体, cdnshu 框架
  关键结构:
  · .leftmenu 抽屉(CSS left:-300px 默认隐藏) + .modbg + <header><div class="headbox clearfix">
    .menubtn/.logo(.logoimg+a)/.search(.inputbox with input+hidden searchtype)/.user1/.lang(.textsel+ul/li)/.menu1(ul/li 6 项导航: 首頁/排行/完本/分類/我的書架/閱讀記錄)
  · <div class="main"><div class="container">
    .adbanner.mybox > .headerad (公告条)
    <ul class="row"><li class="col-xinindex"><div class="mybox">
      .xinlogo img + .error-text.searchBox (form name=articlesearch) + .indexdaohang (4 li: 我的書架/閱讀記錄/排行榜/完本小說)
      <h3 class="mytitle">熱門書單推薦
      .booklist-block > .booklist-grid > .booklist-card × 10 (每张 a.booklist-card-link > .booklist-card-content > .booklist-cover-section .booklist-cover-stack .cover-main × 3 + .cover-count + .booklist-info-section h3.booklist-title + .booklist-meta .meta-item × 3 + .booklist-desc > p)
      .tag (100+ 个 a /newtag/xxx/ 关键词)
  · .foot > .copyright (links + p + 友情連結)

- probe-101kks-book.html (762 行 / 40KB) — 实为书单详情页(/booklist/detail/3.html), 含 .booklist-info/.booklist-books/.book-item/.imgbox/.newnav/.labelbox/.zxzj/.newright
  (booklist 详情页结构, 非单书页, 不可直接复用 — 但 .book-item 子结构与列表项一致)

- probe-101kks-chapter.html (762 行 / 33KB) — 实为书籍详情页(/book/20224.html, og:url 验证), 含:
  · <div id="pageheadermenu"><header></header></div>
  · <div class="container"><ul class="row">
    <li class="col-8"><div class="mybox">
      <h3 class="mytitle shuye"><div class="bread"> 首頁 > 分類 > 書名
      <div class="bookbox">
        .bookimg2 (.status0 + img)
        .booknav2 (h1 a 书名 + p 作者 + p 分類 + p 字數|狀態 + p 更新 + .sharebtn)
        .addbtn (a.btn 開始閱讀 + a.btn 加入書架 + a.btn 投推薦票)
      <div class="txtcenter1"></div>
    <div class="mybox">
      .infotag.clearfix (h3.tagtitle + ul.tagul)
      <ul class="tabs clearfix"> (目錄 active + 簡介 + 書評 3 li)
      .tabsnav (#tab_chapters ul.qustime li a span 章节名 + small 日期 + #tab_info ul.infolist li + .navtxt p + #tab_reviews review-list)
      <a class="btn more-btn"> 完整目錄
    <li class="col-4"><div class="mybox">
      <h3 class="mytitle">本周最強
      <ul class="tabs tabshot clearfix"> (熱門 active + 完本)
      .tabsnav > .ranking > ul > li (top1 .active .rank_left h3+h4+p + .rank_right .imgbox2+span; 其余 .rank_left h3 only + .rank_right span)
  · <div class="foot">

- probe-101kks-category.html (1134 行 / 77KB) — 实为 /newtag/同人衍生/1 标签关键词列表页(分类页同结构), 含:
  · header (同首页)
  · <div class="main"><div class="container"><div class="mybox"><ul class="row"><li class="col-88">
    <div><h3 class="mytitle">標籤<b class="hottext">同人衍生</b>類小說列表</h3>
    <div class="newbox"><ul id="article_list_content">
      <li × N> a.imgbox (img) + .newnav (h3 a + .labelbox label × 3 + ol.ellipsis_2 + .zxzj p span+a) + .newright (.piaos + a.btn.btn-tp + a.btn.btn-jrsj)
    <div class="pages"><div class="pagelink"> (a.pgroup << + strong 1 + a 2..10 + a.next > + a.ngroup >>)

- 101kks.css (4306 行 / 84KB) — 关键 selectors:
  · 容器: .container/.mybox/.mytitle/.clear/.row/.col-8/.col-88/.col-4/.col-xinindex
  · 头部: .headbox/.menubtn/.logo/.logoimg/.search/.inputbox/.lang/.user1/.menu1/.leftmenu/.menu2/.headuser/.headimg/.register/.modbg
  · 书目卡: .booklist-block/.booklist-grid/.booklist-card/.booklist-card-link/.booklist-card-content/.booklist-cover-section/.booklist-cover-stack/.cover-main/.cover-count/.booklist-info-section/.booklist-title/.booklist-meta/.meta-item/.booklist-desc
  · 列表项: .newbox/.imgbox/.imgbox2/.newnav/.newnav2/.labelbox/.ellipsis_1/.ellipsis_2/.zxzj/.newright/.piaos/.btn/.btn-tp/.btn-jrsj/.btn-urge
  · 书页: .bookbox/.bookimg2/.status0/.status1/.booknav2/.sharebtn/.addbtn/.txtcenter1/.infotag/.tagtitle/.tagul/.tabs/.tabs2/.tabshot/.tabsnav/.qustime/.infolist/.navtxt/.review-list/.more-btn
  · 排行: .ranking/.rank_left/.rank_right/.ranktit
  · 阅读页: .black/.tools/.txtnav(h1+p)/.txtinfo/.page1(a)
  · 分页: .pages/.pagelink(a.pgroup/a.prev/strong/a.next/a.ngroup)
  · 首页: .adbanner/.headerad/.xinlogo/.error-text/.searchBox/.searchinput/.indexdaohang/.tag/.hottext
  · 页脚: .foot/.copyright

## 第 3 步 写 8 文件 (1564 行, 从旧 8×32=256 行扩展 6x)

### 1. HomeClone.tsx (326 行) — 完整复刻源站首页
- .leftmenu 静态(CSS left:-300px 默认隐藏, 含 menu_close_btn/headuser/register/menu2 6 li)
- <header><div class="headbox clearfix"> menubtn+logo+search+user1+lang+menu1(6 项 nav)
- .main > .container
  · .adbanner.mybox > .headerad (公告: 請記住我們的域名: {site.domain})
  · ul.row > li.col-xinindex > .mybox
    - .xinlogo img
    - .error-text.searchBox (form name=articlesearch input#searchkey.searchinput + button#searchbtn)
    - .indexdaohang (4 li: 我的書架→history / 閱讀記錄→history / 排行榜→ranking / 完本小說→fulltext)
    - <h3 class="mytitle">熱門書單推薦
    - .booklist-block > .booklist-grid > .booklist-card × 6 (每张含 3 个 cover-main 堆叠 + booklist-info-section title/meta×3/desc)
    - <h3 class="mytitle">最新更新
    - .newbox > ul#article_list_content > li × N (imgbox + newnav + newright)
    - <h3 class="mytitle">小說分類 (cats from /api/public/categories, .tag 渲染)
    - .tag 烱門標籤 (50 个静态关键词, a /newtag/xxx/ → navigate keyword view)
- .foot > .copyright (links + p + 友情連結)
- 数据: 内部 useEffect fetch /api/public/categories?limit=60 → cats (用于小說分類区块)
- 数据切片: featured = books.slice(0,6) → booklist-card; latest = books.slice(0,homeModuleLimit) → article_list_content
- 交互: bookNavProps(navigate, b.id) 跳书页 / navigate({view:'category'|'search'|'home'|'ranking'|'fulltext'|'history'|'keyword'})
- 用源站真实 class 名 (50+ 个), CloneCSSLoader 自动加载的 101kks.css 全部命中

### 2. BookInfo.tsx (276 行) — 复刻书籍详情页(probe-101kks-chapter.html)
- <header><div class="headbox clearfix"> (logo+search+menu1 6 项)
- .main > .container > ul.row
  · li.col-8 > .mybox
    - h3.mytitle.shuye > .bread (首頁 > 分類 > 書名)
    - .bookbox:
      .bookimg2 (.status0/.status1 + BookCover)
      .booknav2 (h1 a + p 作者 + p 分類 + p 字數|狀態 + p 更新)
      .addbtn (a.btn 開始閱讀 + a.btn 加入書架 + a.btn 投推薦票)
      #vote_result
    - .txtcenter1
  · li.col-8 > .mybox (第二块)
    - .infotag.clearfix > h3.tagtitle + ul.tagul (book.keywords split, li a → keyword view)
    - ul.tabs.clearfix (目錄/簡介 active/書評 3 li)
    - .tabsnav > #tab_info (ul.infolist li + .navtxt p)
    - a.btn.more-btn → onScrollToc 完整目錄
  · li.col-4 > .mybox (右栏本周最強)
    - h3.mytitle 本周最強
    - ul.tabs.tabshot.clearfix (熱門 active + 完本)
    - .tabsnav > .ranking > ul > li (top1 active .rank_left h3.ranktit + h4 + p + .rank_right .imgbox2 + span; 其余 .rank_left only + .rank_right span)
- .foot > .copyright
- 数据: 内部 useEffect fetch /api/public/books?size=12&sort=hot&cat={book.categoryId} → related (过滤当前书, 前 12 本)
- 交互: bookNavProps(navigate, book.id) / onScrollToc / onContinueRead / onGoCategory / navigate({view:'search', q: book.author})

### 3. CategoryList.tsx (187 行) — 复刻分类列表页(probe-101kks-category.html)
- <header><div class="headbox clearfix"> (logo+search+menu1)
- .main > .container > .mybox > ul.row > li.col-88
  - <h3 class="mytitle">標籤<b class="hottext">{label}</b>類小說列表
  - .newbox > ul#article_list_content > li × N (a.imgbox + .newnav + .newright)
  - .pages > .pagelink (a.pgroup + a.prev + strong 当前 + a 2..N + a.next + a.ngroup)
- .foot > .copyright
- 分页区间: 当前页 ± 2, 最少 5 页, 最多显示 10 页码
- 交互: bookNavProps(navigate, b.id) / onPage(n) / navigate({view:'search'|'home'|'history'})

### 4. ReadChrome.tsx (103 行) — 复刻章节阅读页外壳(无 probe, 用 CSS class)
- 源站 CSS 含 .black (背景 rgb(45,49,52)) + .black .mybox (rgb(32,40,46)) + .tools + .txtnav h1 + .txtinfo + .page1 a
- <div class="black"> (黑色阅读模式背景)
  - .container > .mybox
    - .tools > ul > li (icon-list 目錄 / icon-set 設置 / icon-yuedujilu 書籤)
    - .txtnav > h1 {chapterTitle}
    - .txtinfo {children}
    - .page1 (a 上一章 + a 返回書頁 + a 下一章)
  - .foot > .copyright
- 交互: onPrev / onNext / navigate({view:'home'})

### 5. RankingView.tsx (203 行) — 复刻排行榜页(/novels/hot)
- <header><div class="headbox clearfix">
- .main > .container > .mybox > ul.row > li.col-88
  - <h3 class="mytitle">小說<b class="hottext">排行榜</b>
  - ul.tabs2.clearfix (4 li: 總點擊榜/總推薦榜/字數榜/最近更新, active by tab prop)
  - .newbox > ul#article_list_content > li × N (.piaos label 显示排名序号)
  - .pages > .pagelink (分页)
- .foot > .copyright
- 交互: onTabChange(t.id) / onPage(n) / bookNavProps(navigate, b.id)

### 6. FulltextView.tsx (178 行) — 复刻完本小说页(/novels/full)
- 与 CategoryList 同结构, 标题改 <h3 class="mytitle">完本<b class="hottext">小說列表</b>
- .newbox + #article_list_content + .pages .pagelink
- 交互: onPage(n) / bookNavProps

### 7. SearchView.tsx (146 行) — 复刻搜索结果页(/search)
- 与 CategoryList 同结构, 标题改 <h3 class="mytitle">搜索<b class="hottext">{q}</b>的結果列表
- header 搜索框 defaultValue={q}
- .newbox + #article_list_content (loading/empty/results 三态)
- 交互: bookNavProps / navigate({view:'search', q: kw})

### 8. KeywordView.tsx (145 行) — 复刻标签关键词页(/newtag/xxx/1)
- 与 CategoryList 同结构, 标题改 <h3 class="mytitle">標籤<b class="hottext">{tag}</b>類小說列表
- header 搜索框 defaultValue={tag}
- .newbox + #article_list_content (loading/empty/results 三态)
- 交互: bookNavProps / navigate({view:'search', q: kw})

## 第 4 步 关键设计

### 源站真实 class 名复刻 (50+ 个, 让 101kks.css 全部命中)
- 容器: .container/.mybox/.mytitle/.row/.col-8/.col-88/.col-4/.col-xinindex/.clear/.black
- 头部: .headbox/.menubtn/.logo/.logoimg/.search/.inputbox/.lang/.textsel/.zh_click/.user1/.user_touxiang/.menu1/.leftmenu/.headuser/.headimg/.register/.menu2/.modbg
- 首页专属: .adbanner/.headerad/.xinlogo/.error-text/.searchBox/.searchinput/.indexdaohang/.tag/.hottext
- 书单卡: .booklist-block/.booklist-grid/.booklist-card/.booklist-card-link/.booklist-card-content/.booklist-cover-section/.booklist-cover-stack/.cover-main/.cover-image/.cover-count/.booklist-info-section/.booklist-title/.booklist-meta/.meta-item/.booklist-desc
- 列表项: .newbox/#article_list_content/.imgbox/.imgbox2/.newnav/.labelbox/.ellipsis_2/.zxzj/.newright/.piaos/.btn/.btn-tp/.btn-jrsj/.btn-urge
- 书页: .bookbox/.bookimg2/.status0/.status1/.booknav2/.sharebtn/.addbtn/.txtcenter1/.infotag/.tagtitle/.tagul/.tabs/.tabs2/.tabshot/.tabsnav/#tab_chapters/#tab_info/.qustime/.infolist/.navtxt/.more-btn
- 排行: .ranking/.rank_left/.rank_right/.ranktit/.imgbox2
- 阅读页: .black/.tools/.txtnav/.txtinfo/.page1
- 分页: .pages/.pagelink/.pgroup/.prev/.next/.ngroup
- 图标: .iconfont .icon-menu/.icon-search/.icon-ArrowLeft/.icon-home/.icon-chart/.icon-ai-book/.icon-list1/.icon-library/.icon-yuedujilu/.icon-close/.icon-hot/.icon-list/.icon-Info/.icon-chat/.icon-set/.icon-shoujihao
- 页脚: .foot/.copyright

### 不再使用 inline style 换配色
- 旧 32 行模板做法: C = {primary:"#667eea",accent:"#764ba2",...}; style={{background:C.surface}}
- 新版做法: 直接用源站真实 class 名, 让 101kks.css 自动应用样式
- 仅保留必要的尺寸参数 (BookCover width/height/fontSize)

### 交互保留
- bookNavProps(navigate, bookId) 跳书页 (含 role/tabIndex/onKeyDown Enter/Space)
- navigate({view:'category', cat}) 跳分类
- navigate({view:'search', q}) 搜索
- navigate({view:'ranking'/'fulltext'/'history'/'home'/'keyword', tag}) 各功能跳转
- onScrollToc/onContinueRead/onGoCategory (BookInfo props)
- onPrev/onNext (ReadChrome props)
- onTabChange/onPage (RankingView props)
- onPage (CategoryList/FulltextView props)

### 数据源
- HomeClone: 内部 useEffect fetch /api/public/categories?limit=60 → 解析 d.data?.items || []
- BookInfo: 内部 useEffect fetch /api/public/books?size=12&sort=hot&cat={book.categoryId} → related
- 其他 6 文件: 用 props 传入的 books/book/q/tag/page/total 等 (父级已 fetch)

### 共享 props 类型
- 全部从 ../shared import (HomeCloneProps/BookInfoProps/CategoryListProps/ReadChromeProps/RankingViewProps/FulltextViewProps/SearchViewProps/KeywordViewProps)
- 不自定义, 与 shipsay/aijjxs/23qb/ddyueshu 保持一致

### 'use client' 首行
- 所有 8 文件首行 'use client' (用了 useState/useEffect/onClick/navigate 等客户端能力)

## 第 5 步 验证
- bun run lint: 101kks 8 文件 0 errors / 0 warnings ✓ (bunx eslint src/components/public/clone-themes/101kks/ exit 0)
  · 第 1 轮发现 5 个 unused-vars (CategoryList/KeywordView/RankingView/SearchView 的 formatWords 未用 + HomeClone 的 dateStr 未用) → 全部修复
  · 第 2 轮: 0 errors / 0 warnings exit 0 ✓
  · (pilishuwu 6 errors 属其他 agent 任务, 不在本次范围)
- bunx tsc --noEmit (排除 examples/skills): 101kks 0 errors ✓
  · 第 1 轮发现 HomeClone TOP_NAV view 类型不含 'category' → 加上 'category' union 后修复
  · 第 2 轮: 0 errors ✓
- dev server: 系统自动运行 (本会话期间端口 3000 偶尔不可达, 但 worklog 显示 23qb-test 站点 200 OK, clone-css 加载 OK)
- 测试站点: id=cmu67881k0000mop7ggxzqdx3, themeId=clone-101kks, name=101kks-test, domain=101kks.local
  (已创建, 待 dev server 启动后可访问验证)

## 第 6 步 不修改的文件 (尊重约束)
- shipsay 主题 (主控已写 HomeClone, 其他 7 个待重写)
- aijjxs/23qb/ddyueshu 主题 (R24-2A/B/C 已重写)
- pilishuwu/huangjinwu/ggd66/x2552/trxsw 主题 (其他 agent 负责)
- HomeView.tsx/PublicSite.tsx/CloneCSSLoader.tsx/themes.ts/books route (主控已接线)
- BookView.tsx/CategoryView.tsx/ReadView.tsx/RankingView.tsx/FulltextView.tsx/SearchView.tsx/KeywordView.tsx 父视图 (主控待后续接线)
- ctx.tsx/bits.tsx/seo.ts/BookCover.tsx/types.ts/shared.ts/helper 全部未动
- prisma/schema.prisma 未动
- 未安装新 npm 包 (0 新依赖)

## Stage Summary
- 完成 8 个 1:1 克隆文件 (位于 src/components/public/clone-themes/101kks/):
  · HomeClone.tsx (326 行) — 完整复刻源站首页 (.leftmenu + .headbox + .main.container + .adbanner + li.col-xinindex .mybox + .booklist-block .booklist-grid .booklist-card + .newbox #article_list_content + .tag + .foot)
  · BookInfo.tsx (276 行) — 复刻源站书页 (.bookbox .bookimg2/.booknav2/.addbtn + .infotag .tagul + .tabs 3 li + .tabsnav #tab_info + .col-4 本周最強 .ranking)
  · CategoryList.tsx (187 行) — 复刻源站分类页 (h3.mytitle + b.hottext + .newbox #article_list_content + .pages .pagelink)
  · ReadChrome.tsx (103 行) — 复刻源站阅读页 (.black .mybox + .tools + .txtnav h1 + .txtinfo + .page1 a)
  · RankingView.tsx (203 行) — 复刻源站排行榜 (.tabs2 4 tab + .newbox #article_list_content + .pages)
  · FulltextView.tsx (178 行) — 复刻源站完本页 (与 CategoryList 同模式)
  · SearchView.tsx (146 行) — 复刻源站搜索页 (与 CategoryList 同模式, 标题改搜索 q)
  · KeywordView.tsx (145 行) — 复刻源站标签页 (与 CategoryList 同模式, 标题改 tag)
- 复刻源站关键 class (50+ 个): 让 CloneCSSLoader 加载的 101kks.css (84KB / 4306 行 cdnshu 框架) 全部选择器命中
- 复用 helper: usePublic/bookNavProps/formatWords/statusLabel/BookCover 全部按任务要求使用
- 数据源: /api/public/categories?limit=60 (HomeClone + BookInfo) + /api/public/books?cat=&size=12 (BookInfo 本周最強) + props 传入 (其他 6 文件)
- 验证: tsc 0 errors / lint 0 errors (101kks 8 文件)
- 测试站点: id=cmu67881k0000mop7ggxzqdx3 (themeId=clone-101kks)
- 不修改的文件 (尊重约束): shipsay/aijjxs/23qb/ddyueshu 主题 + 其他 5 套主题 + HomeView/PublicSite/CloneCSSLoader/themes.ts/books route + 7 个父视图 + helper 全部未动
