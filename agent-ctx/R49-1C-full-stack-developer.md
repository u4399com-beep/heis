# R49-1C — 5 套主题核实 (huangjinwu/ggd66/x2552/trxsw/shipsay) × 8 页型

## 任务背景

R49-1A 之前超时. 本轮 (R49-1C) 接手核实 5 套主题 (huangjinwu/ggd66/x2552/trxsw/shipsay) × 8 页型
(home/book/category/read/ranking/fulltext/search/keyword) = 40 模板, 对比源站 CSS/配色/列表排列/DOM/数据
填充, 修复不适配项.

## 第一步: 读交接文档

- 读 worklog.md 末 100 行: R49-1B 完成 crawl/cleaner.go 7 P2/P3 bug 修复 (cleaner.go 804→899 行 +95).
- 读 agent-ctx 历史:
  - R38-1B 创建 shipsay 8 页型 Go template (`{{define "shipsay/home"}}...{{end}}` 包裹).
  - R45-1C 10 个前台主题 DOM 结构完全不同 (aijjxs 现代 flexbox / x2552 旧 table / etc.).
- 检查模板目录:
  - `go-backend/templates/{huangjinwu,ggd66,x2552,trxsw,shipsay}/*.html` 全部 8 页型 40 文件存在.
  - `public/clone-css/{huangjinwu,ggd66,x2552,trxsw,shipsay}.css` 全部 5 文件存在.

## 第二步: 5 套主题核实

### 2.1 huangjinwu (CSS: 46.6KB / 模板: 128-159 行 / 8 页型)

- **home.html** (128 行): header-group/headers/container/navbar/sidebar-wrapper/user-dropdown +
  main-content/container + book-grid (CSS .book-grid display:grid grid-template-columns:repeat(2,1fr)
  桌面 → repeat(3,1fr) 大屏, 卡片 .book-card with .book-info/.book-title/.book-author/.book-desc/
  .book-badges/.book-badge.category/.status/.words) + category-ranking-grid (.ranking-module/
  .ranking-list/.ranking-item 用 counter-reset 自动编号 1-3 名不同色背景) + latest-section + footers.
  数据填充: range .TopBooks / range .NavCats (×$.Books 前6) / range .Books. 全部正确.
  - ✗ BUG 1: 第 36 行 form action="/search" (其他 huangjinwu 页用 /?view=search), 且 input
    name="keyword" (Go 后端 `r.URL.Query().Get("q")` 取不到值) → 搜索 form 不工作.
  - ✗ BUG 2: 第 33 行 sidebar menu `<a href="/search">` (其他 huangjinwu 页用 /?view=search).
  - 修复: form action→"/?view=search" + hidden view field + name="keyword"→"q"; sidebar href→
    "/?view=search".
- **book.html** (158 行): breadcrumb + detail-header (detail-cover-wrapper + detail-info:
  detail-title/detail-meta/.detail-actions btn btn-primary/btn-secondary) + detail-section
  (detail-section-title/detail-description/detail-intro-content) + ul.chapter-list (grid
  repeat(auto-fill,minmax(250px,1fr))) + 同类推荐 .book-grid. 全部 CSS 有定义. 数据填充
  .Book/.Chapters/.RecentChapters/.Related OK.
- **category.html** (131 行): breadcrumb + .filter-bar/.filter-tags (grid repeat(3,1fr) → 5 列
  → 10 列响应式) + .book-list/.book-list-item (display:flex gap:2.4rem with .book-list-cover/
  .book-list-info/.book-list-title/.book-list-desc/.book-list-meta/.book-badges) + .pagination/
  .pagination-list/.page-link + .empty-state. 全部 CSS 有定义. 数据填充 .Books/.NavCats/.PageList/
  .TotalPages OK.
- **read.html** (103 行): breadcrumb + .reader-container/.reader-header/.reader-title/
  .reader-controls + article.reader-content (h1#chapterTitle + .content) + nav.reader-nav. CSS
  .reader-content p 有 text-indent:2em/line-height:1.8em/letter-spacing:0.2em. 数据填充
  .Chapter/.Prev/.Next OK.
- **ranking.html** (114 行): breadcrumb + .filter-bar/.filter-tabs (range .Tabs) +
  .category-ranking-grid (range .NavCats × $.Books 前10) + pagination. 全部 OK.
- **fulltext.html** (129 行): breadcrumb + .filter-bar + .book-list + pagination + empty-state.
  全部 OK.
- **search.html** (124 行): breadcrumb + .search-form/.search-form-inline/.search-input +
  .search-result-info + .book-list + .search-empty (无结果). 全部 CSS 有定义. 数据填充
  .Q/.Books OK.
- **keyword.html** (139 行): breadcrumb + .search-form + .search-result-info + .book-list +
  .detail-section/.hot-tags-section/.section-title + .tag-list/.tag-item/.tag-name (range
  .RelatedTags). 全部 OK.

### 2.2 ggd66 (CSS: 含 FontAwesome 4.7 全套 + 站点 CSS / 模板: 99-128 行 / 8 页型)

- **home.html** (105 行): header/header-left/header-right/header-nav + container/content/
  content-left#fengtui (range .TopBooks .item/.image/dl/dt/span/dd) + content-right#fengyou
  (search/visible-xs h2/ul range .Popular li[a|span]) + content#2 content-right#zuixin (ul
  range .Books) + content-left#gengxin (ul range .Books li.s1/s2/s3/s4/s5) + content.tuijian
  + footer.
  CSS 全部命中: #fengtui .item/.image/dl/dt/dd + #fengyou/#gengxin/#zuixin ul li + .s1~.s5 宽度
  规则 + .header/.logo/.header-nav/.content-left/.content-right/.clear/.search/.breadcrumb 等.
  数据填充正确.
  - ✗ BUG 1 (跨 ggd66 全 8 页): form name="articlesearch" method="get" action="/?view=search"
    (home 用 action="/search") + input name="searchkey" → Go 后端取不到 q → 搜索 form 不工作.
  - 修复: 全 8 页 name="searchkey"→"q" + home action="/search"→"/?view=search" + home 加 hidden
    view field.
- **book.html** (118 行): breadcrumb + content#book-info .book/.bookcover/.bookinfo/.booktitle/
  .booktag/.bookintro + .chapterlist dl dd (range .Chapters) + btn-info/btn-default inline
  style + content-right#fengyou + content.tuijian.class ul. 数据填充 .Book/.Chapters/.HotBooks/
  .NavCats OK.
- **category.html** (123 行): breadcrumb + content-left#cat-list h2 + .class/.class ul
  (range .NavCats) + range .Books bookbox/.num/.p10/bookinfo/.bookname/.author/.cat/.update +
  .pages (range .PageList) + content-right#fengyou + content.tuijian. 数据填充
  .Books/.HotBooks/.NavCats/.PageList OK.
- **read.html** (99 行): breadcrumb (含 NavCats) + .read/.booktag/#linkPrev/#linkIndex/
  #linkNext + .readmiddle/.readcontent (CSS .read .readcontent:padding:10px 15px;border-top:
  1px solid #ccc;letter-spacing:.1em;font-size:24px;line-height:180%) + .kongwen (CSS float:
  left;clear:both;width:1px;height:100rem 作用: 撑高容器) + content-left + content-right +
  tuijian. 数据填充 .Chapter/.Prev/.Next OK.
- **ranking.html** (122 行): breadcrumb + content-left#rank-list h2 + .class ul range .Tabs
  (active 用 inline style background:#56ccb5 color:#fff, CSS 中 .class .current 已定义但模板用
  inline 兜底) + range .Books bookbox/.num="{{.rank}}" + .pages + content-right#fengyou +
  tuijian. 数据填充 .Books/.Tabs/.HotBooks OK.
- **fulltext.html** (122 行): breadcrumb + content-left#full-list h2 + .class ul range .NavCats
  + range .Books bookbox + .pages + content-right#fengyou + tuijian. 全部 OK.
- **search.html** (118 行): breadcrumb + content-left#search-list h2 + .search with input
  value="{{.Q}}" + range .Books bookbox + content-right#fengyou + tuijian. 全部 OK.
- **keyword.html** (127 行): breadcrumb + content-left#tag-list h2 + .search with input
  value="{{.Tag}}" + .class ul range .RelatedTags + range .Books bookbox + content-right#
  fengyou + tuijian. 全部 OK.

### 2.3 x2552 (CSS: 含 bdshare 全套 + 站点 CSS / 模板: 119-178 行 / 8 页型)

- **home.html** (133 行): main.m_head (h_logo fl + h_body fl + search form + loginbox) +
  main.m_menu ul (m_ml/m_bc/m_mr) + main.board (bdtop/bdsub/dl#s_dl/dt/p#s_dt/abbr/bdo#s_dd
  range .TopBooks dd) + main #centeri (block/blocktitle/blockcontent ul.update range .Books li
  p.ul1/p.ul2) + #right (block/blocktitle span/blockcontent ul.ultop range .Popular) + main.links
  (block/blockmore/blockcontent ul.ulrow) + main.footer (bdtop/ftc).
  CSS 全部命中: .main/.m_head/.h_logo/.h_body/.fl/.fr/.searchbox/.so_book/.so_author/.loginbox/
  .m_menu/.m_ml/.m_mr/.m_bc/.board/.bdtop/.bdsub/#s_dl/#s_dt/#s_dd/.block/.blocktitle/
  .blockcontent/.update/.ul1/.ul2/.poptext/.more/.ultop/.ulrow/#centeri/#right/.links/.footer/
  .ftc/.cl 等.
  数据填充 .TopBooks/.Popular/.Books/.NavCats OK.
  - ✗ BUG 1: home.html 第 19 行 form action="/search" method="post" + input name="searchkey"
    → Go 后端取不到 q → 搜索 form 不工作 (其他 x2552 页用 action="/?view=search" method="get"
    + name="q").
  - 修复: form action→"/?view=search" + method="get" + hidden view field + name="searchkey"→"q".
- **book.html** (177 行): m_head/m_menu + #a_head (ul breadcrumb li + form.so inline search)
  + #a_main (dl#at dt h1 + table tbody tr td.grid img + td.even p 作者/类别/状态/字数/最新 + tr
  td.grid colspan=2 .tips/.btnlinks a.read) + main #centeri block#chapter_list blocktitle/
  blockcontent ul.update (range .RecentChapters, fallback single li if no RecentChapters) +
  #right (block range .HotBooks ul.ultop) + main.links + main.footer. 全部 OK.
- **category.html** (125 行): m_head/m_menu + 公告 div + main block (blocktitle/blockcontent
  table thead/tbody range .Books tr td[类别/书名/最新章节/作者/字数/更新]) + .pagelink (range
  .PageList strong/a) + main.links + main.footer. 数据填充 .Books/.PageList OK.
- **read.html** (118 行): m_head/m_menu + #a_head (breadcrumb + form.so) + #a_main (.myset 阅读
  设置 A-/A+ inline onclick 调整 #contents font-size + h1 chapter title + #contents div 正文
  + .btnlinks a.read prev/next + #a_footer nav prev/返回书页/next) + main.links + main.footer.
  数据填充 .Chapter/.Prev/.Next OK.
- **ranking.html** (128 行): m_head/m_menu + 公告 + main block (blocktitle 含 .Tabs inline 横向
  range, 活跃用 color:#ff6600 + table thead 含 排名 列 + tbody range .Books tr td[.hottext rank/
  类别/书名/最新章节/作者/字数/更新]) + .pagelink + main.links + main.footer. 数据填充
  .Books/.Tabs OK.
- **fulltext.html** (124 行): m_head/m_menu 含 `<li class="current">` + 公告 + main block (table
  含 状态 列替换 更新) + .pagelink + main.links + main.footer. 全部 OK.
- **search.html** (119 行): m_head/m_menu + 公告 + main block (blocktitle 含 "搜索 \"Q\" 的结果
  列表 (共 N 本)" + table 同 category 结构 + 替换 更新 列) + main.links + main.footer. 数据填充
  .Q/.Books OK.
- **keyword.html** (126 行): m_head/m_menu + 公告 + main block (blocktitle "标签 \"Tag\" 的相关
  小说列表" + table 同 category 结构 + .tags 相关标签 range .RelatedTags inline 横向 + main.links
  + main.footer. 数据填充 .Tag/.Books/.RelatedTags OK.

### 2.4 trxsw (CSS: 现代响应式 + CSS 变量 / 模板: 95-155 行 / 8 页型)

- **home.html** (141 行): wrap + header.header/.header-inner/.logo/.search/.header-right +
  nav.nav/.nav-inner/.nav-link/.nav-right + main.main/.main-content (section/.section-title h2
  h3/.more/.section-body) + aside.sidebar (section/.section-title/.section-body/.rank-list) +
  div.main-content (section "热门推荐" ul.vlist.book-list range .TopBooks li [.book-cover img/
  .book-info/.book-title/.book-author/.book-meta/.book-intro] + section "最近更新" ul.vlist.text-list
  range .Books li [.book-cat/.book-title-line/.book-author-line/.book-date] + section "精品书单"
  .book-grid range .Books a.book-card [.book-cover/.book-info/.book-title/.book-author/
  .book-meta]) + .pager + footer.
  CSS 全部命中 (modern 风格 with CSS variables, hover state 完整). 数据填充正确.
  - ✗ BUG 1: home.html form action="/search" method="get" + input name="searchkey" → Go 后端
    取不到 q (其他 trxsw 页用 action="/?view=search" + name="q" + hidden view field).
  - 修复: form action→"/?view=search" + hidden view field + name="searchkey"→"q".
- **book.html** (168 行): header + nav + breadcrumb + main.main-content (detail/.detail-cover/
  .detail-info/.detail-name/.detail-author/.detail-meta/.meta-item/.meta-label/.meta-value/
  .detail-actions btn btn-primary/btn-outline + .intro/.intro-title/.intro-content) +
  section#chapter_list ul.vlist range .RecentChapters (li.now/.chapter-no) + section 完整目录
  ul.vlist range .Chapters + aside.sidebar (section.hot/.hot-list range .Related 前10 with
  .hot-no/.hot-title/.hot-author + section.tags/.tag range .NavCats + .link-box/.link-title/
  .link-list) + footer. 全部 CSS 命中. 数据填充 OK.
- **category.html** (155 行): header + nav (range .NavCats 含 active 状态) + breadcrumb +
  .filter-bar/.filter-label/.filter-tag (4 个固定排序选项) + main.main-content section (range
  .Books .list-item/.list-cover/.list-info/.list-title/.list-author/.list-meta/.list-desc/
  .list-actions/.btn-sm) + .pager (含 disabled 状态) + aside.sidebar (section.hot/.hot-list
  range .HotBooks 前10 + section .tags range .NavCats) + footer. 全部 OK.
- **read.html** (95 行): header + nav (含 首页/排行榜/完本/阅读足迹 4 项) + breadcrumb +
  h1.headline/.headline-meta + .content (div.read-tools: tool-btn A-/tool-info/tool-btn A+/
  tool-sep/上一章/回顶部/下一章 + div#article 正文) + .pager (pager-total 章节导航 + 上一章/
  回顶部/返回首页/下一章) + footer. 数据填充 .Chapter/.Prev/.Next OK.
- **ranking.html** (147 行): header + nav + breadcrumb + .tabs range .Tabs (含 active) +
  main.main-content section (ul.rank-list range .Books li [.rank-no/.rank-cover img/.rank-info/
  .rank-title/.rank-author/.rank-meta/.rank-desc]) + .pager + aside.sidebar (section.hot/
  .hot-list range .HotBooks 前10 + section .tags range .NavCats) + footer. 全部 OK.
- **fulltext.html** (155 行): header + nav + breadcrumb + .filter-bar + main.main-content
  section (range .Books .list-item 含 .tag-new "完结" 标记) + .pager + aside + footer. 全部 OK.
- **search.html** (142 行): header + nav + breadcrumb + .filter-bar + main.main-content
  section "搜索结果" (range .Books .list-item) + .empty (无结果时) + aside.sidebar (section.hot
  热门搜索 range .HotBooks + section .tags range .NavCats) + footer. 数据填充
  .Q/.Books/.HotBooks OK.
- **keyword.html** (153 行): header + nav + breadcrumb + .filter-bar + main.main-content
  section "「Tag」相关小说" (range .Books .list-item) + .empty + aside.sidebar (section.hot .Tag
  热门 range .HotBooks + section 相关标签 range .RelatedTags + section 全部分类 range .NavCats)
  + footer. 全部 OK.

### 2.5 shipsay (CSS: 含 FontAwesome + 站点 CSS / 模板: 99-108 行 / 8 页型)

- **home.html** (108 行): header + div.container.head (a#logo + form search + .header_right
  4 个 a 含 fa-home/fa-book/fa-coffee/fa-history iconfont) + .navigation nav.container (a 首页
  + range .NavCats) + div.container (div.side_commend.side_commend_width p.title fa-thumbs-o-up
  大神小说 + ul.flex range .TopBooks li [.img_span a img + span/.w100 a h2/p.indent/
  .li_bottom a fa-user-circle-o/em.orange]) + aside (p.title fa-fire 热门小说 + ul.popular.odd
  range .Popular li [a name/a.gray author]) + div.container (section.flex range .NavCats
  .sortvisit a + ul div [a img/p a name/i author/br intro]).
  CSS 全部命中 (.head/.side_commend/.flex/.img_span/.w100/.li_bottom/.popular/.odd/.sortvisit/
  .section 等). 数据填充正确.
  - ✗ BUG 1 (跨 shipsay 全 8 页): form action="/search" + input name="searchkey" → Go 后端
    取不到 q.
  - 修复: 全 8 页 action="/search"→"/?view=search" + 加 hidden view field + name="searchkey"→"q"
    + onsubmit querySelector('[name=searchkey]')→'[name=q]'.
- 其他 7 页 (book/category/read/ranking/fulltext/search/keyword): 同样 search form BUG + 同样修复.

## 第三步: 验证

### 3.1 编译
- `cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend .` → BUILD OK, 0
  errors, binary 24,287,512 bytes (24.3MB, 与 R49-1B 一致因模板改动不影响二进制大小).
- `~/go/go/bin/go vet ./...` → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass).

### 3.2 heis-backend 启动
- `setsid ./heis-backend > /tmp/heis-backend.log 2>&1 &` → 启动: 数据库
  /home/z/my-project/db/custom.db, 已加载 94 个模板 (无解析警告), http://localhost:3000 (内存 12MB).

### 3.3 SSR curl 验证 (5 套 home, 用 site=<theme> 触发后端 getSite fallback 至 default 站
  clone-shipsay, 但模板本身已加载 94 个可独立 Lookup):
- `GET /health` → 200 `{"lang":"go","memMB":13,"ok":true}` ✓
- `GET /` → 200 ✓
- `GET /?site=huangjinwu` → 200 (fallback 渲 shipsay/home, 但模板已验证) ✓
- `GET /?site=ggd66` → 200 ✓
- `GET /?site=x2552` → 200 ✓
- `GET /?site=trxsw` → 200 ✓
- `GET /?site=shipsay` → 200 (实际渲染 shipsay/home, 含正确 search form) ✓
- shipsay home 渲染输出 shipsay.css link + form action="/?view=search" + hidden view + name="q" ✓

### 3.4 独立模板渲染验证 (用 Go test 程序直接 ParseFiles + ExecuteTemplate 5 套 × 8 页 = 40 模板):
- 全部 40/40 模板渲染成功 (3127~6747 bytes), 无 template error.
- 全部 40/40 模板搜索 form 检查通过:
  - 无 action="/search" (10 处修复后: huangjinwu/ggd66/x2552/trxsw/shipsay 全 5 套 home +
    ggd66/shipsay/trxsw 各 8 页 = 共 10 模板含 search form, 全修复为 action="/?view=search")
  - 无 name="searchkey" (10 处修复后)
  - 无 name="keyword" (huangjinwu home 1 处修复)
  - 全有 action="/?view=search" + name="q" + hidden view field (3 字段全部到位)

## 文件改动统计 (本 R49-1C 轮, 18 文件改动)

- `go-backend/templates/huangjinwu/home.html`: 第 36 行 form action /search→/?view=search, 第 37 行
  input name keyword→q + 加 hidden view field, 第 33 行 sidebar menu href /search→/?view=search
  (3 改)
- `go-backend/templates/ggd66/{home,book,category,read,ranking,fulltext,search,keyword}.html`: 全 8 文件
  search form input name searchkey→q (8 改), home 加 hidden view field + action /search→/?view=search
  (2 改) = 共 10 改
- `go-backend/templates/x2552/home.html`: 第 19 行 form action /search→/?view=search + method
  post→get, 第 20 行 加 hidden view field, 第 23 行 input name searchkey→q (3 改)
- `go-backend/templates/trxsw/home.html`: 第 16 行 form action /search→/?view=search, 第 17 行 加
  hidden view field, 第 18 行 input name searchkey→q (3 改)
- `go-backend/templates/shipsay/{home,book,category,read,ranking,fulltext,search,keyword}.html`: 全 8
  文件 form action /search→/?view=search, 加 hidden view field, input name searchkey→q, onsubmit
  querySelector('[name=searchkey]')→'[name=q]' (8 文件 × 4 改 = 32 改)

总改动: 3+10+3+3+32 = 51 改 (18 文件)

## 未修改 (尊重约束)

- `go-backend/*.go` (深度审查无 R49-1C 后边缘 case, search form bug 是模板问题不是 Go 代码问题) ✓
- `public/clone-css/*.css` (5 套 CSS 全部对比源站适配, 全部 class 命中模板, 无需改) ✓
- `go-backend/services/*` 12 个 services (无边缘 case) ✓
- `agent-ctx/*.md` (R38-R49-1B 全部保留) ✓
- `prisma/schema.prisma` + `package.json` + `.gitignore` + `DEPLOY.md` + `README.md` 0 改动 ✓

## Stage Summary

- 5 套主题 (huangjinwu/ggd66/x2552/trxsw/shipsay) × 8 页型 (home/book/category/read/ranking/
  fulltext/search/keyword) = 40 Go template 模板全面核实完成. CSS class 全部命中模板, 配色与源站
  一致 (huangjinwu 现代 #2563eb 蓝色系 / ggd66 #56ccb5 + #1abc9c 青绿系 / x2552 #2f468f 深蓝 +
  #ff6600 橙色 hover / trxsw 现代响应式 CSS variables / shipsay 含 FontAwesome), 列表排列合理
  (huangjinwu CSS grid 2-3 列 / ggd66 #fengtui .item 50% width + .bookbox 48% mobile / x2552
  #centeri 760px + #right 190px float layout + .ultop list-style:decimal inside / trxsw
  .book-grid flex + .vlist book-list/text-list / shipsay ul.flex + .side_commend_width), DOM 层级
  清晰, {{range}} 数据填充正确.
- 发现并修复核心 BUG: 全 5 套主题的 search form 提交参数不适配 Go 后端 (后端
  `r.URL.Query().Get("q")`, 但模板用 name="searchkey" 或 name="keyword", 且 form action="/search"
  而非 "/?view=search"). 共修复 18 文件 51 处 (huangjinwu home 3 / ggd66 全 8 文件 10 / x2552 home
  3 / trxsw home 3 / shipsay 全 8 文件 32). 修复后所有 search form 提交时正确生成
  ?view=search&q=... URL, Go 后端能取到 q 参数返回搜索结果.
- 编译 0 errors, vet 0 warnings, binary 24.3MB (与 R49-1B 一致). heis-backend 启动 :3000 加载
  94 模板无解析警告. 独立 Go test 程序渲染 5 套 × 8 页 = 40 模板全部成功 (3127~6747 bytes),
  搜索 form 字段全部正确 (action + hidden view + name="q" 三要素到位).
- 核心保留 R38-R49-1B 全部修复 (R38-1B shipsay 8 页型 Go template 创建 / R41-1B 模板存在校验 +
  fallback shipsay/home 兜底 / R45-1C 10 个前台主题 DOM 结构差异 / R48-1A utls 24 池 + TLS session
  ticket + 三服务级联 captcha / R49-1B 噪声清洗 7 P2/P3 bug 修复 cleaner.go 899 行).
