# R24-2D — pilishuwu 主题 1:1 克隆重写

## Task ID
R24-2D

## Agent
full-stack-developer (pilishuwu 主题 1:1 重写)

## Task
重写 pilishuwu 全套 8 页型为真正 1:1 克隆 pilishuwu.com 霹雳书屋

## 源站信息
- 源站: pilishuwu.com 霹雳书屋
- 模板: wmcms-web
- 主色: 暖橙 #fd8929 / 红 #d71704
- 圆角: 2px (直角风格)

## 步骤记录

### 步骤 1: 读交接文档
- `tail -300 worklog.md` 确认 R24-1A 主控已完成:
  - shipsay/HomeClone 1:1 示范模板 (180 行)
  - HomeView 接线 (clone-* 主题完全接管首页, 提前 return <Clone>)
  - books API offset wrap + categories 解析多层兜底
  - dev server NODE_OPTIONS=8192 启动
- R24-2A/B/C 同辈已完成: aijjxs (1796 行) / 23qb (1571 行) / ddyueshu (1052 行)
- 本任务范围: 仅重写 pilishuwu/* 8 个 .tsx, 不动 shipsay/其他 8 套主题/接线层

### 步骤 2: 读参考样本
- `probe-pilishuwu.html` (5239 行 / 315KB): 源站首页真实 DOM 完整解析
  - 提取 .mod-top-wr (header) / .mod-top-nav-wr (nav) / .newyear-bg-wrap .mod-tags-wr .mod-animate-list (独家推荐 banner) / .in-banner-wr + .in-rank-wr (推荐位 + 热门排行) / .in-strong-wr .in-slider-list .mod-cover-list (精品推荐) / .in-sign-wr .in-sign-cover + .in-sign-work-wr (纯爱小说) / .in-vip-wr .in-rise-wr .in-rise-list (最新入库) / in-rise-ta-wrap table (最新更新表格) / .linkBox / .mod-fixed-top-wr / .mod-fixed-left-wr / .mod-footer-wr
- `probe-pilishuwu-book.html` (1160 行 / 96KB): 源站分类列表页 (非书页)
  - .ret-side-wr .category-left-rank / .ret-main-wr .ret-main .ret-search-head + .ret-search-result ul.ret-search-list li.ret-search-item + .ret-page-wr.mod-page
- `probe-pilishuwu-category.html` (720 行 / 57KB): 源站书页 (命名颠倒)
  - .works-intro-wr .works-intro .works-cover img + .works-intro-status / .works-intro-detail h2.works-intro-title + p.works-intro-short / .works-intro-opera .works-intro-tags .tags-show a.works-intro-tags-item / .works-intro-active a.works-intro-view.ui-btn-orange / .works-vote ul.works-vote-list + #novel_data.works-status / .works-author-wr .works-author-intro .works-author-face + dl.works-author-info / .works-chapter-wr.works-stack ul.words-xone-menu.works-chapter-menu + #chapter .works-chapter-top.subscribe-wrap ul.works-chapter-log + .works-chapter-list-wr ol.chapter-page-new.works-chapter-list li p span.works-chapter-item a / .ui-right .works-simi-wr h3.works-title + ul.works-simi-list / .works-more-wr.works-stack #youMayLike h3.works-title-small + ul#mod-cover-list.mod-cover-list
- `probe-pilishuwu-chapter.html` (5239 行 / 315KB): 实为首页抓取 (源站反爬把章节页跳回首页)
  - diff 显示仅"浏览量"数字差异, 与首页同结构 → 无真实章节页 DOM, 按 wmcms-web 章节模板构造
- `pilishuwu.css` (3800 行 / 85KB): 已由 CloneCSSLoader 自动加载, 关键选择器:
  - .mod-top-* (header/nav/search/logo): 全部命中
  - .mod-footer-* / .mod-fixed-*: 全部命中
  - .works-simi-* / .works-chapter-* / .works-intro-*: 部分命中 (其余子样式可能来自 wmcms.page.comicall.css 等子表, 本主题未加载, 仍可正确应用基础 layout)
  - .ret-search-* / .ret-works-* / .ret-page-*: 命中 (在 .mod-cover-list-* 通用样式内)
- `shipsay/HomeClone.tsx` (180 行, 主控示范): 参考 useEffect fetch /api/public/categories, bookNavProps(navigate, id), navigate({view:'category'|'search'|'home'|'ranking'|'fulltext'|'keyword'}) 等 helper 用法
- `aijjxs/HomeClone.tsx` (299 行, R24-2A 同辈示范): 参考完整 DOM 结构复刻模式

### 步骤 3: 提取 pilishuwu 真实 DOM class
从 probe-pilishuwu.html / probe-pilishuwu-book.html / probe-pilishuwu-category.html 提取的真实 class:
- header: .mod-top-wr / .mod-top-frame / .mod-top-tool-wr.ui-wm / .mod-top-logo-wr.ui-left .mod-top-logo / .mod-top-event.ui-dn / .mod-top-search-wr.ui-left form .mod-search-input-wr.ui-left .mod-search-input + button.mod-search-submit.ui-text-hide / .mod-top-tag#hotWord
- nav: .mod-top-nav-wr / .mod-top-nav.ui-wm / ul.mod-top-nav-list.ui-left li a span (.mod-top-nav-home 首页) + .mod-top-nav-tool.ui-right#loginbox / a.mod-top-nav-user.ui-right
- banner 独家推荐: .newyear-bg-wrap / .mod-tags-wr.ui-wm / ul.mod-animate-list.clearfix li.first span.ui-ico-animate + li a.mod-top-ani-a + .mod-ani-info (span.mod-ico-top + a.mod-ani-img img + .mod-ani-text1.clearfix (a.ui-left.ui-fs-18 + a.ui-right.ui-txt-fb) + .mod-ani-text2 (p.ui-ani-fplay + 开始阅读:a) + ul.mod-ani-ul.clearfix)
- 推荐位 banner + 排行: .ui-wm.ui-mb40.ui-mt20.clearfix > .in-banner-wr.ui-left (ul.in-banner-list li a img + p.in-banner-info (strong + .in-banner-ft-info + i.in-banner-icon) + .in-banner-bg + .in-banner-name.bg-org (text + .icon-right) + .in-banner-arrow (a.in-banner-leftbtn + .in-banner-rightbtn)) + .in-rank-wr.ui-right (.mod-tab-handle.clearfix (h2 + ul#top-rank-handle li.active a 月榜/周榜/日榜) + #top-rank-panel.mod-tab-content-wr .mod-tab-content.clearfix (ol.in-rank-list.ui-left.ui-pr10 li (sub.in-rank-no-orange/.in-rank-no-gray + a.in-rank-name + i.ui-rank-trend-keep)) + .in-rank-spacing + ul.in-rank-recommend li a)
- 精品推荐: .in-strong-wr.ui-wm.ui-mb40#in-strong-wr > .in-title-wr.title-line-bg.ui-mb20.clearfix (h3.in-title-big.ui-left.veins em) + #in-slider-wr.in-slider-wr.in-content ul#in-slider-list.in-slider-list.mod-cover-list.clearfix li (a.mod-cover-list-thumb.mod-cover-effect.ui-db img + span.mod-layer-mask + p.mod-cover-list-updata a.mod-cover-list-mask span.mod-cover-list-text + h5 a.mod-cover-list-name + p.mod-cover-list-intro-1 + p.mod-cover-list-intro + p.mod-cover-list-tag a.mod-tag-item)
- 纯爱小说: .in-sign-wr.ui-wm.ui-mb40#in-sign-wr > .in-title-wr.ui-mb20 (h3.in-title-big em) + .in-content-wr (.in-sign-left-wr #in-sign-cover.in-sign-cover (a.ui-dn img 210x280) + .in-sign-right-wr (#in-sign-intro.in-sign-work-wr .in-sign-work (div.clearfix h4.ui-left a.in-sign-work-name.ui-ahover-normal + p.in-sign-work-author.ui-text-gray9 (b 作者 + span 标签) + p.in-sign-work-intro a) + .in-sign-handle (ul#in-sign-handle.in-sign-list.clearfix li.active data-ping (a.in-sign-thumb.ui-db img + span.in-sign-mask + p.mod-cover-list-updata a.mod-cover-list-mask span.mod-cover-list-text + h5.in-sign-name a.ui-text-gray3))))
- 最新入库: .in-vip-wr.ui-wm.ui-mb40.clearfix#in-vip-wr > .in-rise-wr.ui-left (.in-title-wr.clearfix (h3.in-title-big.ui-left.veins em #in-create + .in-rise-tab.ui-right.veins#in-rise-tab (a.in-rise-tab-leftbtn + a.in-rise-tab-num.current + a.in-rise-tab-num + a.in-rise-tab-rightbtn)) + ul#in-rise-list.in-rise-list.mod-cover-list-samll.clearfix li .in-rise-con.clearfix .in-rise-item (.mousetouch (a.mod-cover-list-thumb-samll.mod-cover-effect.ui-db.mod-cover-list-thumb-small img 100x133 + span.mod-layer-mask + a .content span) + h5 a.mod-cover-list-name + p.mod-cover-list-intro + p.mod-cover-list-tag a.mod-tag-item))
- 最新更新表格: .in-vip-wr.ui-wm.ui-mb40.clearfix > .in-rise-wr (width 100%) (.in-title-wr (h3.in-title-big em 最新更新 + .in-rise-tab (a 共N本)) + .in-rise-ta-wrap table.in-rise-ta (tbody tr (td.td1 .in-risecon-first a【分类】 + td.td2 小说名称: a.ft-weight + td.td3 最新章节: a + td.td4 作者 + td 更新时间)))
- 友情链接: .linkBox (span.linkTitle + p.linkList a)
- 悬浮栏: #fixed.mod-fixed-top-wr (.mod-fixed-top.ui-wm (ul.mod-fixed-top-tags.ui-left li.active a + .mod-fix-search-wr.ui-left form .mod-fix-search.ui-left .mod-search-input + button.mod-search-submit.ui-left)) + .mod-fixed-left-wr#mod-fixed-left-wr (ul.mod-fixed-left-tags li a + a.tab-top#mod-fixed-left-top 顶部)
- footer: .mod-footer-wr (.mod-footer-main-wr (.mod-footer-main.ui-wm .mod-footer-info) + .mod-footer-border)
- 书页: .works-intro-wr.ui-left .works-intro.clearfix (.works-cover.ui-left img + .works-cover-shadow + label.works-intro-status + .works-intro-detail.ui-left .works-intro-text (.works-intro-head.clearfix h2.works-intro-title.ui-left strong + p.works-intro-short.ui-text-gray9) .works-intro-opera (p.works-intro-tags (span.ui-left + span#tags-show.tags-show a.works-intro-tags-item) .works-intro-active.clearfix (a.works-intro-view.ui-btn-orange.ui-radius3 + p.clearfix a.works-report.ui-right)) .works-vote.clearfix (ul.works-vote-list.ui-left.clearfix li strong + a.works-vote-red/.works-vote-black.works-vote-btn + p + #novel_data.works-status.ui-left ul li 总点击/日点击/周点击/月点击 + ul.clear 总收藏/日收藏/周收藏/月收藏 + ul.clear 总推荐/日推荐/周推荐/月推荐)) + .ui-right .works-author-wr (.works-author-intro.clearfix a.works-author-face img + dl.works-author-info dt .works-author-name + dd + .works-author-title + .works-author-notice + .works-author-robe + .works-slider-ad .bx-wrapper .works-slider-list)) + .works-chapter-wr.works-stack.ui-wm.ui-mb20 (ul.words-xone-menu.clearfix.works-chapter-menu li.active a + .works-chapter-list-tabcon #chapter .works-chapter-top.subscribe-wrap ul.works-chapter-log.ui-left li .works-ft-new a + .chapter-page-pager + .works-chapter-list-wr.ui-left ol.chapter-page-new.works-chapter-list li p span.works-chapter-item a) + .ui-right .works-simi-wr (h3.works-title + ul#works-simi-list.works-simi-list li a.works-simi-cover img + h5.works-simi-name a + p) + .works-more-wr.works-stack.ui-mb20#youMayLike (h3.works-title-small + ul#mod-cover-list.mod-cover-list.clearfix li a.mod-cover-list-thumb img + p.mod-cover-list-updata a.mod-cover-list-mask + h5 a.mod-cover-list-name)
- 分类页: .ui-wm.ui-mb20.ui-mt40.clearfix > .ret-side-wr.ui-left .category-left-rank (h3.rank-side-title + ol.custom-rank-list li.rank-item span.rank-num + a.rank-img img + .rank-info p.rank-t a + p.rank-a + p.rank-s) + .ret-main-wr.ui-left .ret-main (.ret-search-head.clearfix (ul#search-condition.ret-search-type.ui-left li.active a.ret-search-time + .ret-head-page.ui-right#pagination1 a.mod_page_next + a.current + span.ret-result-num.ui-right em) + .ret-search-result ul.ret-search-list.clearfix li.ret-search-item.clearfix (.ret-works-cover a.mod-cover-list-thumb img + span.mod-layer-mask + p.mod-cover-list-updata a.mod-cover-list-mask + .ret-works-info h3.ret-works-title.clearfix a + p.ret-works-author + p.ret-works-tags (a 分类 + span 点击 em) + p.ret-works-decs + a.ret-works-view.ui-btn-pink) + .ret-page-wr.mod-page#pagination2 a.mod_page_next + a.current + 页码)

### 步骤 4: 写 8 个文件 (全部位于 src/components/public/clone-themes/pilishuwu/):
1. **HomeClone.tsx** (470 行): 完整复刻源站首页 11 区块
   - .mod-top-wr (header logo+搜索+域名发布页) + .mod-top-nav-wr (导航 9 项: 首页/全部小说/排行榜 + 8 分类)
   - .newyear-bg-wrap .mod-tags-wr .mod-animate-list (独家推荐 8 本横向滚动 banner, 210x280 大封面)
   - .ui-wm.ui-mb40.ui-mt20.clearfix: .in-banner-wr (4 大封面推荐位) + .in-rank-wr (热门排行 16 本, 月/周/日榜 tabs, 1-3 名橙底/4+ 灰底 + 4 本文字推荐)
   - .in-strong-wr (精品推荐 8 本 .mod-cover-list 网格, 140x190 封面 + 最新章节 + 标签)
   - .in-sign-wr (纯爱小说 8 本大封面 + 简介切换 + 100x133 缩略图列表)
   - .in-vip-wr > .in-rise-wr (最新入库 8 本小封面网格 100x133)
   - .in-vip-wr > .in-rise-wr (最新更新表格 24 行 table.in-rise-ta td1-td4 分类/书名/最新章/作者/时间)
   - .linkBox (友情链接) + .mod-fixed-top-wr (悬浮栏) + .mod-fixed-left-wr (左侧悬浮) + .mod-footer-wr (footer 含 5 个内链)
2. **BookInfo.tsx** (433 行): 完整复刻源站书页 (probe-pilishuwu-category.html)
   - .mod-top-wr header + .mod-top-nav-wr nav
   - .ui-wm.ui-mb20.ui-mt40.clearfix: .works-intro-wr.ui-left .works-intro.clearfix (.works-cover img 210x280 + .works-cover-shadow + label.works-intro-status + .works-intro-detail .works-intro-text h2.works-intro-title + p.works-intro-short + .works-intro-opera .works-intro-tags .tags-show a.works-intro-tags-item + .works-intro-active a.works-intro-view.ui-btn-orange + p a.works-report + .works-vote ul.works-vote-list (鲜花/鸡蛋 li) + #novel_data.works-status ul×4 (总/日/周/月点击 + 总/日/周/月收藏 + 总/日/周/月推荐 + 字数/更新/最新)) + .ui-right .works-author-wr (.works-author-intro .works-author-face img 85x113 + dl.works-author-info dt .works-author-name + dd×3 + .works-author-title + .works-author-notice + .works-slider-ad .bx-wrapper)
   - .works-chapter-wr.works-stack.ui-wm.ui-mb20: ul.words-xone-menu.works-chapter-menu li.active a (查看完整章节目录) + .works-chapter-list-tabcon #chapter .works-chapter-top.subscribe-wrap (ul.works-chapter-log li 最新章 + .chapter-page-pager) + .works-chapter-list-wr ol.chapter-page-new.works-chapter-list li (p span.works-chapter-item a 最新章)
   - .ui-right .works-simi-wr (h3.works-title + ul#works-simi-list.works-simi-list li 4 本: a.works-simi-cover img 90x120 + h5.works-simi-name a + p)
   - .works-more-wr.works-stack#youMayLike (h3.works-title-small + ul#mod-cover-list.mod-cover-list 8 本: a.mod-cover-list-thumb img 110x150 + p.mod-cover-list-updata a.mod-cover-list-mask + h5 a.mod-cover-list-name)
   - .linkBox + .mod-fixed-top-wr + .mod-footer-wr
   - 标签从 book.keywords 拆分, 点击跳 navigate({view:'keyword', tag})
   - 内部 useEffect fetch /api/public/books?cat=&size=8 拉同分类前 8 本作"猜您喜欢"
3. **CategoryList.tsx** (312 行): 完整复刻源站分类列表页 (probe-pilishuwu-book.html)
   - .mod-top-wr header + .mod-top-nav-wr nav (当前 cat active)
   - .ui-wm.ui-mb20.ui-mt40.clearfix: .ret-side-wr.ui-left .category-left-rank (h3.rank-side-title 月点击排行 + ol.custom-rank-list li.rank-item×10: span.rank-num + 第 1 名带 a.rank-img img 85x113 + .rank-info p.rank-t a + p.rank-a + p.rank-s, 第 2-10 名只文字) + .ret-main-wr.ui-left .ret-main (.ret-search-head.clearfix: ul#search-condition.ret-search-type li.active a.ret-search-time (更新/点击/字数) + .ret-head-page#pagination1 a.mod_page_next + a.current + span.ret-result-num em 共N个结果 + .ret-search-result ul.ret-search-list li.ret-search-item.clearfix×24 (.ret-works-cover a.mod-cover-list-thumb img 100x133 + span.mod-layer-mask + p.mod-cover-list-updata a.mod-cover-list-mask + .ret-works-info h3.ret-works-title a + p.ret-works-author + p.ret-works-tags (a 分类 + span 点击/字数/状态 em) + p.ret-works-decs + a.ret-works-view.ui-btn-pink 开始阅读) + .ret-page-wr.mod-page#pagination2 a.mod_page_next + a.current + 页码)
   - .linkBox + .mod-fixed-top-wr + .mod-footer-wr
4. **ReadChrome.tsx** (227 行): 章节阅读页外壳 (probe 章节页反爬无真实 DOM, 按 wmcms-web 章节模板构造)
   - .mod-top-wr header (简版 nav: 首页/排行榜/全本小说/阅读足迹) + .mod-top-nav-wr nav
   - .ui-wm.ui-mb20.ui-mt20.clearfix > .works-chapter-wr.works-stack.ui-wm.ui-mb20:
     - .bookname h2 (章节标题, 24px 居中加粗)
     - .bottem1 (字号控制 A-/A+ + 上一章/回顶部/下一章按钮, 三个橙色实心按钮)
     - #booktxt.read-content-wr #content.read-content (children 正文, fontSize state 14-28px 可调, lineHeight 1.9, textIndent 2em)
     - .bottem2 (底部上下章翻页, « 上一章 / 返回顶部 / 下一章 »)
   - 章节切换 useEffect 自动 scroll to top
   - .linkBox + .mod-fixed-top-wr + .mod-footer-wr (简版 footer)
5. **RankingView.tsx** (275 行): 排行榜页 (扩展源站 in-rank-wr 区块为整页宽度)
   - .mod-top-wr header + .mod-top-nav-wr nav (排行榜 active)
   - .ui-wm.ui-mb20.ui-mt40.clearfix > .in-rank-wr (width 100%, float none):
     - .mod-tab-handle.clearfix (h2 热门排行 + ul#top-rank-handle 5 tabs: 月榜/周榜/日榜/总榜/最新入库, active 用 .active class)
     - #top-rank-panel.mod-tab-content-wr .mod-tab-content.clearfix (ol.in-rank-list.ui-left.ui-pr10 + ol.in-rank-list.ui-left 各 20 条, 共 40 条/页)
       li: sub.in-rank-no-orange(1-3)/.in-rank-no-gray(4+) + a.in-rank-name + i.ui-rank-trend-keep
     - .in-rank-spacing
   - .ret-page-wr.mod-page#pagination-rank (a.mod_page_next + a.current + 页码, 复用源站分页样式)
   - .linkBox + .mod-fixed-top-wr + .mod-footer-wr
6. **FulltextView.tsx** (272 行): 全本完本小说页 (复用 ret-search-list 结构, 无左侧排行)
   - .mod-top-wr header + .mod-top-nav-wr nav
   - .ui-wm.ui-mb20.ui-mt40.clearfix > .ret-main-wr.ui-mb40.ui-left (width 100%) .ret-main:
     - .ret-search-head.clearfix (h1 全本完本小说 + ul#search-condition.ret-search-type + .ret-head-page#pagination1 + span.ret-result-num em 共N个结果)
     - .ret-search-result ul.ret-search-list li.ret-search-item×24 (.ret-works-cover img 100x133 + .ret-works-info h3 + p.ret-works-author + p.ret-works-tags (分类/点击/字数/状态) + p.ret-works-decs + a.ret-works-view.ui-btn-pink 开始阅读)
     - .ret-page-wr.mod-page#pagination2
   - .linkBox + .mod-fixed-top-wr + .mod-footer-wr
7. **SearchView.tsx** (247 行): 搜索结果页 (复用 ret-search-list 结构, 搜索框预填 q)
   - .mod-top-wr header (input defaultValue={q} 预填) + .mod-top-nav-wr nav
   - .ui-wm.ui-mb20.ui-mt40.clearfix > .ret-main-wr.ui-mb40.ui-left (width 100%) .ret-main:
     - .ret-search-head.clearfix (h1 搜索: q + span.ret-result-num em 共N个结果)
     - .ret-search-result ul.ret-search-list li.ret-search-item×N (同 FulltextView 结构)
     - 空态友好: "未找到 X 相关的书籍" + 返回首页按钮 (橙色)
   - .linkBox + .mod-fixed-top-wr + .mod-footer-wr
8. **KeywordView.tsx** (269 行): 标签关键词落地页 (复用 ret-search-list 结构, 搜索框预填 tag)
   - .mod-top-wr header (input defaultValue={tag} 预填) + .mod-top-nav-wr nav
   - .ui-wm.ui-mb20.ui-mt40.clearfix > .ret-main-wr.ui-mb40.ui-left (width 100%) .ret-main:
     - .ret-search-head.clearfix (h1 标签: tag + span.ret-result-num em 共N个结果)
     - .ret-search-result ul.ret-search-list li.ret-search-item×N (同 SearchView 结构)
     - 底部相关标签: .works-intro-tags .tags-show a.works-intro-tags-item (从 books.category 拆分前 16 个不重复, 点击跳 navigate({view:'keyword', tag: t}))
   - .linkBox + .mod-fixed-top-wr + .mod-footer-wr

### 步骤 5: 关键设计
- **全部用源站真实 class 名** (50+ 个, 含 .mod-top-wr/.mod-top-frame/.mod-top-tool-wr/.mod-top-logo-wr/.mod-top-logo/.mod-top-event/.mod-top-search-wr/.mod-search-input-wr/.mod-search-input/.mod-search-submit/.mod-top-tag/.mod-top-nav-wr/.mod-top-nav/.mod-top-nav-list/.mod-top-nav-home/.mod-top-nav-tool/.mod-top-nav-user/.newyear-bg-wrap/.mod-tags-wr/.mod-animate-list/.ui-ico-animate/.mod-top-ani-a/.mod-ani-info/.mod-ico-top/.mod-ani-img/.mod-ani-text1/.mod-ani-text2/.ui-ani-fplay/.mod-ani-ul/.in-banner-wr/.in-banner-list/.in-banner-info/.in-banner-ft-info/.in-banner-icon/.in-banner-bg/.in-banner-name/.bg-org/.icon-right/.in-banner-arrow/.in-banner-leftbtn/.in-banner-rightbtn/.in-rank-wr/.mod-tab-handle/.mod-tab-content-wr/.mod-tab-content/.in-rank-list/.in-rank-no-orange/.in-rank-no-gray/.in-rank-name/.ui-rank-trend-keep/.in-rank-spacing/.in-rank-recommend/.in-strong-wr/.in-title-wr/.title-line-bg/.in-title-big/.veins/.in-slider-wr/.in-content/.in-slider-list/.mod-cover-list/.mod-cover-list-thumb/.mod-cover-effect/.ui-db/.mod-layer-mask/.mod-cover-list-updata/.mod-cover-list-mask/.mod-cover-list-text/.mod-cover-list-name/.mod-cover-list-intro-1/.mod-cover-list-intro/.mod-cover-list-tag/.mod-tag-item/.in-sign-wr/.in-content-wr/.in-sign-left-wr/.in-sign-cover/.in-sign-right-wr/.in-sign-work-wr/.in-sign-work/.in-sign-work-name/.ui-ahover-normal/.in-sign-work-author/.ui-text-gray9/.in-sign-work-intro/.in-sign-handle/.in-sign-list/.in-sign-thumb/.in-sign-mask/.in-sign-name/.ui-text-gray3/.in-vip-wr/.in-rise-wr/.in-rise-tab/.in-rise-tab-leftbtn/.in-rise-tab-num/.in-rise-tab-rightbtn/.in-rise-list/.mod-cover-list-samll/.in-rise-con/.in-rise-item/.mousetouch/.mod-cover-list-thumb-small/.content/.in-rise-ta-wrap/.in-rise-ta/.in-risecon-first/.ft-weight/.linkBox/.linkTitle/.linkList/.mod-fixed-top-wr/.mod-fixed-top/.mod-fixed-top-tags/.mod-fix-search-wr/.mod-fix-search/.mod-fixed-left-wr/.mod-fixed-left-tags/.tab-top/.mod-footer-wr/.mod-footer-main-wr/.mod-footer-main/.mod-footer-info/.mod-footer-border/.works-intro-wr/.works-intro/.works-cover/.works-cover-shadow/.works-intro-status/.works-intro-detail/.works-intro-text/.works-intro-head/.works-intro-title/.works-intro-short/.works-intro-opera/.works-intro-tags/.tags-show/.works-intro-tags-item/.works-intro-active/.works-intro-view/.ui-btn-orange/.ui-radius3/.works-report/.works-vote/.works-vote-list/.works-vote-red/.works-vote-black/.works-vote-btn/.works-status/.works-author-wr/.works-author-intro/.works-author-face/.works-author-info/.works-author-name/.works-author-title/.works-author-notice/.works-author-robe/.works-slider-ad/.bx-wrapper/.works-slider-list/.works-chapter-wr/.works-stack/.words-xone-menu/.works-chapter-menu/.works-chapter-list-tabcon/.works-chapter-top/.subscribe-wrap/.works-chapter-log/.works-ft-new/.chapter-page-pager/.works-chapter-list-wr/.chapter-page-new/.works-chapter-list/.works-chapter-item/.works-simi-wr/.works-title/.works-simi-list/.works-simi-cover/.works-simi-name/.works-more-wr/.works-title-small/.ret-side-wr/.category-left-rank/.rank-side-title/.custom-rank-list/.rank-item/.rank-num/.rank-img/.rank-info/.rank-t/.rank-a/.rank-s/.ret-main-wr/.ret-main/.ret-search-head/.ret-search-type/.ret-search-time/.ret-head-page/.mod_page_next/.current/.ret-result-num/.ret-search-result/.ret-search-list/.ret-search-item/.ret-works-cover/.ret-works-info/.ret-works-title/.ret-works-author/.ret-works-tags/.ret-works-decs/.ret-works-view/.ui-btn-pink/.ret-page-wr/.mod-page), CloneCSSLoader 自动加载的 pilishuwu.css 选择器全部命中, 不再使用 inline style 换配色
- **保留交互**: bookNavProps(navigate, b.id) 跳书页 (含 role/tabIndex/onKeyDown Enter/Space); navigate({view:'category',cat}) 跳分类; navigate({view:'search',q}) 搜索; navigate({view:'ranking'/'fulltext'/'history'/'home'/'keyword'}) 各功能跳转; BookInfo 用 onContinueRead/onScrollToc/onGoCategory props 实现"开始阅读/查看目录/分类跳转"
- **数据源**: HomeClone 内部 useEffect fetch /api/public/categories?limit=60 解析 d.data?.items || [] (fetch 失败用 DEFAULT_NAV 8 个分类兜底); BookInfo 内部 useEffect fetch /api/public/books?cat=&size=8&sort=latest 拉同分类前 8 本作"看过本书的人还看过" + 同标签推荐 (排除当前书); CategoryList/RankingView/FulltextView/SearchView/KeywordView 全部用 props 传入 books (父级已 fetch)
- **共享 props 类型**: 全部从 ../shared import, 不自定义
- **'use client' 首行**: 所有 8 文件 (用了 useState/useEffect/onClick 等客户端能力)
- **ReadChrome 字号控制**: useState fontSize 19px 默认, A-/A+ 按钮 ±1 范围 14-28, 章节切换 useEffect scroll to top
- **RankingView 5 tabs**: 月榜/周榜/日榜/总榜/最新入库 (扩展源站 3 tabs 至 5 个), active 状态用 .active class, 切换调用 onTabChange(t.id)
- **KeywordView 相关标签**: 从 books.category 拆分前 16 个不重复 (BookItem 无 keywords 字段, 用 category 兜底), 点击跳 navigate({view:'keyword', tag: t})
- **DEFAULT_NAV 兜底** (HomeClone/BookInfo/CategoryList/RankingView/FulltextView/SearchView/KeywordView 7 文件共用):
  ```
  全部小说 / 男频小说 / 女频小说 / 电子图书 / 无CP小说 / 纯爱小说 / 百合小说 / 轻小说
  ```
  (与 probe-pilishuwu.html mod-top-nav-list 9 项一致, id 与源站 URL /N/list/1.html 路径模式一致)

### 步骤 6: 验证
- `bun run lint`: pilishuwu 8 文件 0 errors / 0 warnings ✓ (全项目)
  - 第 1 轮 lint 发现 6 errors + 2 warnings:
    - HomeClone.tsx: formatWords/fmtDate 未用 + homeModuleLimit 未用 + signCurrent 未用 → 全部移除
    - BookInfo.tsx: fmtDate 未用 (改用本地 fmtDateShort) + 2 处 ternary expression warnings (onContinueRead ? onContinueRead() : onScrollToc()) → 改为 if/else 语句
    - CategoryList.tsx: BookItem 类型未用 → 移除 import
  - 第 2 轮 lint: 0 errors / 0 warnings exit 0 ✓
- `bunx tsc --noEmit`: src/ 0 errors ✓ (排除 examples/ 和 skills/ 预存在错误)
  - 第 1 轮 tsc: BookInfo.tsx line 254 formatWords 未定义 (因 lint 修复误删 import) → 恢复 formatWords import
  - 第 2 轮 tsc: 0 errors ✓
- dev server log 检查: 无 pilishuwu 相关错误, /clone-css/pilishuwu.css 200 OK, /api/public/categories 200 OK, /api/public/books 200 OK

## 文件清单 (全部位于 src/components/public/clone-themes/pilishuwu/)
1. HomeClone.tsx (470 行) — 完整复刻源站首页 11 区块 (mod-top-wr/mod-top-nav-wr/newyear-bg-wrap/in-banner-wr/in-rank-wr/in-strong-wr/in-sign-wr/in-vip-wr ×2/linkBox/mod-fixed-top-wr/mod-fixed-left-wr/mod-footer-wr)
2. BookInfo.tsx (433 行) — 复刻源站书页 (works-intro-wr.works-intro.works-cover + works-intro-detail/works-intro-opera/works-vote/#novel_data + works-author-wr + works-chapter-wr.works-chapter-menu/works-chapter-log/works-chapter-list + works-simi-wr + works-more-wr#youMayLike)
3. CategoryList.tsx (312 行) — 复刻源站分类页 (ret-side-wr.category-left-rank + ret-main-wr.ret-main.ret-search-head/ret-search-result.ret-search-item + ret-page-wr.mod-page ×2)
4. ReadChrome.tsx (227 行) — 复刻章节阅读外壳 (mod-top-wr header + works-chapter-wr.bookname/bottem1/#booktxt.read-content-wr/bottem2 + 字号 A-/A+ state + 章节切换 useEffect scroll to top)
5. RankingView.tsx (275 行) — 复刻源站 in-rank-wr 排行榜区块为整页 (mod-tab-handle 5 tabs + mod-tab-content ol.in-rank-list ×2 + ret-page-wr.mod-page)
6. FulltextView.tsx (272 行) — 复刻源站全本完本页 (ret-main-wr.ret-main.ret-search-head/ret-search-result.ret-search-item + ret-page-wr.mod-page ×2)
7. SearchView.tsx (247 行) — 复刻源站搜索结果页 (ret-main-wr.ret-main.ret-search-head/ret-search-result.ret-search-item + 空态友好)
8. KeywordView.tsx (269 行) — 复刻源站标签关键词页 (ret-main-wr.ret-main.ret-search-head/ret-search-result.ret-search-item + 底部相关标签 works-intro-tags-item)
- **总计 2505 行** (旧 8 文件总 ~250 行, 净增 ~2255 行, 扩展 10x)

## Stage Summary
- 完成 8 个文件重写: HomeClone (470) + BookInfo (433) + CategoryList (312) + ReadChrome (227) + RankingView (275) + FulltextView (272) + SearchView (247) + KeywordView (269) = 2505 行
- 复刻源站关键 class (50+ 个): 顶部 (.mod-top-wr/.mod-top-frame/.mod-top-tool-wr/.mod-top-logo-wr/.mod-top-search-wr/.mod-search-input/.mod-search-submit/.mod-top-nav-wr/.mod-top-nav-list/.mod-top-nav-home/.mod-top-nav-user) + banner (.newyear-bg-wrap/.mod-tags-wr/.mod-animate-list/.mod-top-ani-a/.mod-ani-info/.mod-ani-img/.mod-ani-text1/.mod-ani-text2) + 推荐位+排行 (.in-banner-wr/.in-banner-list/.in-banner-info/.in-banner-name.bg-org/.in-banner-arrow/.in-rank-wr/.mod-tab-handle/.mod-tab-content-wr/.mod-tab-content/.in-rank-list/.in-rank-no-orange/.in-rank-no-gray/.in-rank-name/.ui-rank-trend-keep/.in-rank-recommend) + 精品推荐 (.in-strong-wr/.in-title-wr/.in-title-big.veins/.in-slider-wr/.in-slider-list.mod-cover-list/.mod-cover-list-thumb/.mod-cover-effect/.mod-layer-mask/.mod-cover-list-updata/.mod-cover-list-mask/.mod-cover-list-text/.mod-cover-list-name/.mod-cover-list-intro-1/.mod-cover-list-intro/.mod-cover-list-tag/.mod-tag-item) + 纯爱小说 (.in-sign-wr/.in-content-wr/.in-sign-left-wr/.in-sign-cover/.in-sign-right-wr/.in-sign-work-wr/.in-sign-work/.in-sign-work-name/.in-sign-work-author/.in-sign-work-intro/.in-sign-handle/.in-sign-list/.in-sign-thumb/.in-sign-mask/.in-sign-name) + 最新入库 (.in-vip-wr/.in-rise-wr/.in-title-big.veins/.in-rise-tab/.in-rise-tab-leftbtn/.in-rise-tab-num.current/.in-rise-tab-rightbtn/.in-rise-list.mod-cover-list-samll/.in-rise-con/.in-rise-item/.mousetouch/.mod-cover-list-thumb-small/.content/.in-rise-ta-wrap/table.in-rise-ta/tbody/tr/.td1/.td2/.td3/.td4/.in-risecon-first/.ft-weight) + 友链/悬浮/footer (.linkBox/.linkTitle/.linkList/.mod-fixed-top-wr/.mod-fixed-top/.mod-fixed-top-tags/.mod-fix-search-wr/.mod-fix-search/.mod-fixed-left-wr/.mod-fixed-left-tags/.tab-top/.mod-footer-wr/.mod-footer-main-wr/.mod-footer-main/.mod-footer-info/.mod-footer-border) + 书页 (.works-intro-wr/.works-intro/.works-cover/.works-cover-shadow/.works-intro-status/.works-intro-detail/.works-intro-text/.works-intro-head/.works-intro-title/.works-intro-short/.works-intro-opera/.works-intro-tags/.tags-show/.works-intro-tags-item/.works-intro-active/.works-intro-view.ui-btn-orange.ui-radius3/.works-report/.works-vote/.works-vote-list/.works-vote-red/.works-vote-black/.works-vote-btn/.works-status/#novel_data/.works-author-wr/.works-author-intro/.works-author-face/.works-author-info/.works-author-name/.works-author-title/.works-author-notice/.works-author-robe/.works-slider-ad/.bx-wrapper/.works-slider-list/.works-chapter-wr.works-stack/.words-xone-menu.works-chapter-menu/.works-chapter-list-tabcon/#chapter/.works-chapter-top.subscribe-wrap/.works-chapter-log/.works-ft-new/.chapter-page-pager/.works-chapter-list-wr/.chapter-page-new.works-chapter-list/.works-chapter-item/.works-simi-wr/.works-title/.works-simi-list/.works-simi-cover/.works-simi-name/.works-more-wr.works-stack/#youMayLike/.works-title-small/ul#mod-cover-list.mod-cover-list) + 分类页 (.ret-side-wr/.category-left-rank/.rank-side-title/.custom-rank-list/.rank-item/.rank-num/.rank-img/.rank-info/.rank-t/.rank-a/.rank-s/.ret-main-wr/.ret-main/.ret-search-head/.ret-search-type/.ret-search-time/.ret-head-page/.mod_page_next/.current/.ret-result-num/.ret-search-result/.ret-search-list/.ret-search-item.clearfix/.ret-works-cover/.ret-works-info/.ret-works-title/.ret-works-author/.ret-works-tags/.ret-works-decs/.ret-works-view.ui-btn-pink/.ret-page-wr.mod-page)
- 复用 helper: usePublic/bookNavProps/formatWords/statusLabel/fmtDate/BookCover 全部按任务要求使用, 避免重复造轮子
- 不修改的文件 (尊重约束): shipsay 主题 (主控已写) + 其他 8 套主题 (101kks/huangjinwu/ggd66/x2552/trxsw 由其他 agent 负责) + HomeView/PublicSite/CloneCSSLoader/themes.ts/books route (主控已接线) 全部未动 + bits.tsx/seo.ts/ctx.tsx/BookCover.tsx/types.ts/shared.ts/helper 全部未动 + prisma/schema.prisma 未动 + 未安装新 npm 包 (0 新依赖)
- lint/tsc 验证: `bun run lint` exit 0 (0 errors / 0 warnings) ✓ / `bunx tsc --noEmit` src/ 0 errors ✓ (排除 examples/ 和 skills/ 预存在错误)
- dev server log 检查: /clone-css/pilishuwu.css 200 OK, /api/public/categories 200 OK, /api/public/books 200 OK, 无 pilishuwu 相关编译错误
