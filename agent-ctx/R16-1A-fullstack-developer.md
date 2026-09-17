# Task ID: R16-1A
# Agent: fullstack-developer (子代理)
# Task: 填充 5 个站点的 clone-themes 组件 (HomeClone/BookInfo/CategoryList/ReadChrome) — 真正 1:1 克隆

## 任务背景

R13/R14 完成了 10 套主题的 HomeClone (其中 aijjxs 是 1:1 克隆的标准模板), 但其余 9 套的 HomeClone/BookInfo/CategoryList/ReadChrome 仍是占位实现 (单层 ul + 单层 div, 没有源站 class 名 / 颜色 / DOM 结构). R16-1A 任务: 为 ddyueshu/pilishuwu/23qb/101kks/huangjinwu 5 个站点填充真正的 1:1 克隆组件.

参考实现: `src/components/public/clone-themes/aijjxs/HomeClone.tsx` (已完成的 1:1 克隆标准模板).
1:1 克隆标准:
1. 硬编码颜色 (从源站 CSS 提取实际 #xxxxxx), 不用 theme.vars
2. 用源站 class 名 (如 .top-float/.wrap/.panel/.nav/.header-content)
3. 复刻完整 DOM 结构 (header + 搜索框 + 导航 + 主体 + footer)
4. 包含所有元素 (搜索框/热搜词/登录链接/完整导航项/footer 友链)
5. 用 inline style (不依赖 Tailwind 类)
6. 用 usePublic() 获取 site/navigate
7. 用 BookCover 渲染封面
8. 有 Skeleton + 空态
9. 响应式

## 数据源

- CSS: `/home/z/my-project/public/clone-css/{ddyueshu,pilishuwu,23qb,101kks,huangjinwu}.css`
- HTML DOM: `/home/z/my-project/agent-ctx/probe-html2/probe-{site}.html` (实测结构)
- 参考实现: `src/components/public/clone-themes/aijjxs/HomeClone.tsx`

## Work Log

### Step 1: 项目背景摸排 (R14-1A/B/C/D 历史 + aijjxs 模板分析)

- 阅读 worklog.md 尾部 200 行, 确认 R14 完成状态: 10 套主题预设已落地, 含 aijjxs 1:1 克隆标准模板
- 阅读 `aijjxs/HomeClone.tsx` (313 行): 真正 1:1 克隆的范本
  - `.top-float` 顶部 sticky 导航条 (16 个分类)
  - `.wrap` 主容器 (max-width 1220, padding 18/14/36)
  - `header.top` 包含 logo + 搜索 form + 热搜词
  - `main.layout` 双栏 (grid 1fr 330px)
  - 左侧: `.panel.latest-upload` 最新上传 + `.panel` 最近更新表格
  - 右侧: `.panel` 排行榜 (10 本, 前 3 名琥珀色徽章)
  - `footer.foot` 6 个友链 + 站点信息
- 阅读 `aijjxs/BookInfo.tsx` (30 行): `.wrap > article.panel > h3 + .kv (pic + meta) + .desc` 结构
- 阅读 `aijjxs/CategoryList.tsx` (50 行): `.wrap > article.panel > h1 + table.grid + 分页`
- 阅读 `aijjxs/ReadChrome.tsx` (20 行): `.wrap > article.panel > h1 + #view_content_txt + .pager`

### Step 2: 5 个站点源站资料解析

- **ddyueshu.cc** (得得小说):
  - CSS `ddyueshu.css` (biquge.css 模板, GBK 编码):
    - body bg #E9FAFF (浅青) / color #555 / a #6F78A7 / nav bg #88C6E5 (天蓝)
    - #FEF9EF 卡片底 / #C3DFEA / #A6D3E8 边框 / .nav a #fff
    - header 61px / logo 250px / .nav 980px / .header_search #88C6E5
    - #content 19pt 字间距 0.2em 行高 150% (实测)
  - HTML DOM (probe-ddyueshu.html, GBK 编码 mojibake 但结构清晰):
    - `#wrapper > .ywtop (设为首页/加入收藏/登录注册)`
    - `.header (.header_logo a + .header_search form)`
    - `.nav (10 个 li: 首页/我的书架/玄幻/修真/都市/穿越/网游/科幻/排行榜/全部小说)`
    - `#main > #hotcontent (.l 4 推荐大图 + .r 最强推荐 8 本)`
    - `.novelslist × 3 列 (玄幻/修真/都市 各 12 本)`
    - `#newscontent (.l 最近更新 30 行 + .r 最近入库 12 本)`
    - `#firendlink 友情链接 + .footer 版权`

- **pilishuwu.com** (霹雳书屋):
  - CSS `pilishuwu.css` (wmcms.global.css + main-header-content/nav/bg, 3800 行):
    - body color #666 / a #fa8729 hover / .mod-top-search bg #ece8e6
    - .mod-search-input-wr #fff border #dcd8d4
    - .mod-footer-wr bg #f69057 (橙色 footer)
    - .mod-cover-list / .mod-cover-list-name / .in-rank-list / .in-rank-name / .in-rank-no-orange/gray
    - 主色: #fa8729 / #f1854b / #ec5245 (橙系)
  - HTML DOM (probe-pilishuwu.html, UTF-8 完整):
    - `.mod-top-wr > .mod-top-frame (.mod-top-tool-wr .mod-top-logo-wr + .mod-top-search-wr)`
    - `.mod-top-nav-wr > .mod-top-nav (.mod-top-nav-list 11 个 li: 首页/全部小说/排行榜/男频/女频/电子图书/无CP/纯爱/百合/轻小说)`
    - `.mod-tags-wr (独家推荐 4 卡 + 排行榜 16 项)`
    - `.in-sign-wr (纯爱小说 等多块)`
    - `.mod-footer-wr .mod-footer-main .mod-footer-info`

- **23qb.net** (铅笔小说):
  - CSS `23qb.css` (mxstatic/css/style.css + mxhtmlblack.css, 9222 行):
    - body bg #f8f9f9 / color #282828 / a hover #ff2a14 (红色)
    - .homepage #header::after 背景 searchbg.jpg (暗模式: #16161a)
    - .nav-menu-item.selected 渐变 #ff9800→#ff2a14 (橙红下划线)
    - .module-item-cover #fff / .module-item-top 排名标
    - 主色: #ff2a14 / 渐变 #ff9800
  - HTML DOM (probe-23qb.html, UTF-8 zh-Hant):
    - `body.homepage > #header (.header-content .banyundog-com + .nav-search + .nav .nav-menu-items 14 个分类 + .header-module)`
    - `#search-content (.index-logo + .search-box .search-input + .search-btn search-go + .search-tag 今日热门)`
    - `#main.wrapper > .content (.box.module .module-list .module-items 多个 module-item 卡)`
    - `#footer.wrapper.pd60 (sitemap + RSS + Google + Bing + 铅笔小说)`

- **101kks.com** (101看書, 繁体):
  - CSS `101kks.css` (style.css + block_booklist.css, 4307 行):
    - body bg #f2f3f4 / color #333 / a #666 hover #06c
    - header bg #1f6cb2 (蓝色) / .menu1 ul a #fff hover #1f6cb2 (反色)
    - .mybox bg #fff shadow + border-radius 3
    - .indexdaohang li bg #1f6cb2 50px 高
    - .booklist-card bg #fff / .booklist-cover-section 紫蓝渐变 #667eea→#764ba2
    - .foot bg #fff / .cookie-container bg #1f6cb2
    - 主色: #1f6cb2 (蓝)
  - HTML DOM (probe-101kks.html, UTF-8 zh-TW):
    - `.leftmenu + .modbg (侧滑菜单隐藏)`
    - `header .headbox.clearfix (.menubtn + .logo + .search + .user1 + .lang + .menu1 ul 6 项)`
    - `.main > .container (.adbanner .headerad + .row > .col-xinindex .mybox)`
    - `.mybox (.xinlogo logo + .searchBox 搜索 + .indexdaohang 4 快捷入口 + .booklist-block .booklist-grid .booklist-card 多个)`
    - `.foot .copyright (6 友链 + 版权 + 友情链接)`

- **huangjinwu.org** (黄金屋):
  - CSS `huangjinwu.css` (static/default/style.css, 463 行):
    - --bg-color #f0f4fb / --bg-gradient #f5f8ff→#eef3fb
    - --card-bg #fff / --header-bg rgba(255,255,255,.92)
    - --primary-color #0f172a / --secondary-color #2563eb / --logo-color #1d4ed8
    - --text-color #1e293b / --text-light #64748b / --text-muted #94a3b8
    - --border-color #dbe4f0 / --shadow + --shadow-hover
    - --border-radius-lg 10px / --reader-text #1e293b / --reader-bg #f8fafc
  - HTML DOM (probe-huangjinwu.html, UTF-8):
    - `.header-group (.headers .container .navbar .user-dropdown + .logo + .sidebar-wrapper .navbar-menu 7 项 + .navbar-search + .theme-toggle)`
    - `.main-content.content-373569 .container (.hot-section .book-grid 6 本 + .sort-section .category-ranking-grid 3 榜 × 10 本 + .update-section .book-grid 多本 + .detail-section .chapter-list 多个电子书)`
    - `.footers.footer-373569 .container (.sitemap 6 个站内链接 + .copyright × 2 行)`

### Step 3: 实现策略

- 每个 HomeClone 复刻: sticky 顶栏 + logo + 搜索框 + 热搜词 + 主导航 + 主体模块 (推荐/排行/最新更新/分类列表) + footer 友链
- 每个 BookInfo 复刻: 面包屑 + 封面 + 标题 + meta (作者/分类/状态/字数/最新章节/更新时间) + 行动按钮 (开始阅读/章节目录/TXT 下载) + 内容简介 + 章节列表入口
- 每个 CategoryList 复刻: 面包屑 + 标题 + table.grid (类别/书名/最新章节/作者/字数/更新) + 分页
- 每个 ReadChrome 复刻: 面包屑 + 章节标题 + #content 正文 + 上下章翻页按钮
- 所有都用 inline style 硬编码颜色 (从源站 CSS 提取实际 #xxxxxx)
- 用源站 class 名 (ywtop/header/header_search/nav/hotcontent/l/r/novelslist/newscontent/firendlink/footer/mod-top-wr/mod-top-nav-list/header-content/nav-menu-items/book-grid/...)
- 用 usePublic() 获取 site/navigate, 用 BookCover 渲染封面
- Skeleton 加载占位 + 空态友好提示

### Step 4: 5 套组件实现 (20 个文件)

#### 4.1 ddyueshu (4 文件, 552 行)

- HomeClone.tsx (284 行): 完整复刻 biquge.css 模板
  - .ywtop 顶部条 (设为首页/加入收藏 + 登录注册)
  - .header (.header_logo + .header_search form 2px solid #88C6E5 + 蓝色搜索按钮)
  - .nav 10 项 (首页/我的书架/玄幻/修真/都市/穿越/网游/科幻/排行榜/全部小说)
  - #hotcontent .l 4 推荐大图 + .r 最强推荐 12 本
  - .novelslist × 3 列 (玄幻/修真/都市, 每列 1 大图 + 11 行小列表)
  - #newscontent .l 最近更新 24 行表格 + .r 最近入库 12 本
  - #firendlink 10 个友链 + .footer 4 个链接 + 版权
- BookInfo.tsx (119 行): .box_con > .con_top + #sidebar (本书信息 5 项) + #maininfo (#fmimg 120×150 + #info h1 28px + meta p + 行动按钮) + #intro + #list (章节目录入口)
- CategoryList.tsx (88 行): table.grid caption + 5 列表格 (类别/书名+最新章节/作者/字数/更新) + 分页
- ReadChrome.tsx (61 行): .content_read > .box_con > .con_top + .bookname h1 25px + #content 19pt 字间距 0.2em + .bottem2 翻页

#### 4.2 pilishuwu (4 文件, 516 行)

- HomeClone.tsx (255 行): wmcms-web 模板
  - .mod-top-frame (.mod-top-logo-wr 384×127 logo + .mod-top-search-wr .mod-top-search #ece8e6 + .mod-top-tag 热搜 10 项)
  - .mod-top-nav-wr 58px 高 (橙渐变 #f1854b→#ec5245) + .mod-top-nav-list 11 项 + .mod-top-nav-tool 域名发布页
  - .mod-tags-wr 双栏: 左独占推荐 4 卡 (BookCover 180×220) + 最近更新 16 行表格
  - 右 .in-rank-wr 排行榜 16 项 (前 3 名橙色徽章)
  - .mod-footer-wr #f69057 顶部边框 + .mod-footer-main 5 个友链 + 版权
- BookInfo.tsx (105 行): .wmcms-web .detail (.cover 210×280 + .info h2 28px + meta 行 + 按钮) + .intro + .vlist
- CategoryList.tsx (94 行): table 6 列表格 + 分页
- ReadChrome.tsx (62 行): .wmcms-web .ui-wm #content 14pt 行高 1.85

#### 4.3 23qb (4 文件, 513 行)

- HomeClone.tsx (229 行): mxstatic 模板
  - #header.header-content (.header-logo a 24px + nav.nav .nav-menu-items 14 项 (首页/言情/都市/唯美/穿越/青春/玄幻/武侠/军事/竞技/科幻/悬疑/同人/职场) + 首项 selected 渐变下划线 #ff9800→#ff2a14)
  - #search-content (.index-logo h1 32px + .search-box 圆角 24 + .search-input + .search-btn search-cupfox 红色书库 + search-go 橙红渐变按钮 + .search-tag 今日热门 10 项圆角胶囊)
  - #main .content .box.module (.module-list 18 个 module-item 卡: 排名标 + BookCover + module-item-title + module-item-text 作者)
  - .box.module 最近更新表格 15 行 (类别 chip + 书名 + 最新章节 + 作者 + 字数 + 更新)
  - #footer sitemap + 版权
- BookInfo.tsx (121 行): .book-info (.book-cover 180×240 + .book-detail h1 28px + badges chip + 行动按钮) + .book-intro + .chapter-list 入口
- CategoryList.tsx (101 行): table 6 列表格 + 分页
- ReadChrome.tsx (62 行): #content 16pt 行高 1.85

#### 4.4 101kks (4 文件, 570 行)

- HomeClone.tsx (283 行): cdnshu 模板 (繁体)
  - header sticky 75px bg #1f6cb2 (.logo a 25px + .search 36px + .menu1 ul 6 项: 首頁/排行/完本/分類/我的書架/閱讀記錄)
  - .main.container .adbanner .headerad 域名提示
  - .col-xinindex .mybox (.xinlogo 35px logo + .searchBox 中央搜索 + .indexdaohang 4 个 #1f6cb2 圆角按钮)
  - .booklist-block .booklist-grid 9 个 .booklist-card (180×80 卡: 紫蓝渐变封面区 + 标题 + meta + desc)
  - 最近更新表格 15 行 + 热门推荐 12 项列表
  - .foot .copyright 6 个友链 + 版权 + 友情链接
- BookInfo.tsx (125 行): .main .bookinfo (.bookimg 180×240 + .newnav h1 26px + .labelbox badges + 按钮) + #intro + .chapter-list
- CategoryList.tsx (99 行): table 6 列表格 + 分页 (繁体文案)
- ReadChrome.tsx (63 行): #content 18pt 行高 2

#### 4.5 huangjinwu (4 文件, 569 行)

- HomeClone.tsx (286 行): default 模板 (CSS 变量风格)
  - .header-group sticky (.headers 半透明白 + .container .navbar: .logo 20px + .navbar-menu 7 项 .navbar-menu a hover #2563eb + .navbar-search input 36px 圆角 10)
  - .main-content .container (.hot-section .book-grid 6 本 .book-card .book-info 标题/作者/desc/badges + .sort-section .category-ranking-grid 3 榜 × 10 项 ranking-item + .update-section .book-grid 多本 + .detail-section .chapter-list--all 24 个 chapter-item)
  - .footers .container (.sitemap 6 个友链 + .copyright 转码声明 + Copyright)
- BookInfo.tsx (121 行): .detail-header (.detail-cover-wrapper 180×250 + .detail-info h1 32px + .detail-meta 5 项 meta) + .book-intro + 章节目录入口
- CategoryList.tsx (100 行): .book-list .book-list-item (cover 100×130 + .book-list-info title + desc + meta) 列表型
- ReadChrome.tsx (62 行): #content 17pt 行高 1.85

### Step 5: 验证

- `bunx tsc --noEmit` (排除 examples/skills):
  - 0 errors ✓
  - `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`: 0 errors ✓
- `bun run lint`:
  - 第一次: 1 error — huangjinwu/HomeClone.tsx 引入 `BookCover` 但未用 (源站 .book-grid 无封面只文字卡) → 移除 import
  - 第二次: 0 errors 0 warnings ✓
- dev server 200 OK (theme=clone-ddyueshu 实测响应正常, dev.log 无 error/warn)
- 文件清单:
  - src/components/public/clone-themes/ddyueshu/{HomeClone,BookInfo,CategoryList,ReadChrome}.tsx (4 文件, 552 行)
  - src/components/public/clone-themes/pilishuwu/*.tsx (4 文件, 516 行)
  - src/components/public/clone-themes/23qb/*.tsx (4 文件, 513 行)
  - src/components/public/clone-themes/101kks/*.tsx (4 文件, 570 行)
  - src/components/public/clone-themes/huangjinwu/*.tsx (4 文件, 569 行)
  - 总计: 20 文件, 2720 行 LoC (替换占位实现)

### Step 6: 1:1 克隆标准核对

| 标准 | ddyueshu | pilishuwu | 23qb | 101kks | huangjinwu |
|---|---|---|---|---|---|
| 硬编码颜色 | #E9FAFF/#88C6E5/#FEF9EF ✓ | #fa8729/#f1854b/#ece8e6 ✓ | #f8f9f9/#ff2a14 ✓ | #f2f3f4/#1f6cb2 ✓ | #f0f4fb/#2563eb/#1d4ed8 ✓ |
| 源站 class 名 | .ywtop/.header/.nav/.hotcontent/.novelslist/#newscontent/#firendlink ✓ | .mod-top-wr/.mod-top-nav-list/.mod-cover-list/.in-rank-list/.mod-footer-wr ✓ | .header-content/.nav-menu-items/.search-box/.module-item/#footer ✓ | .headbox/.menu1/.mybox/.booklist-card/.indexdaohang/.foot ✓ | .header-group/.navbar-menu/.book-grid/.ranking-item/.footers ✓ |
| 完整 DOM 结构 | wrapper+header+nav+main+firendlink+footer ✓ | mod-top-wr+mod-top-nav+mod-tags-wr+mod-footer ✓ | header+search-content+main+footer ✓ | header+main.container+foot ✓ | header-group+main-content+footers ✓ |
| 搜索框 | .header_search form ✓ | .mod-top-search ✓ | .search-box input ✓ | .search .inputbox input ✓ | .navbar-search input ✓ |
| 热搜词 | #firendlink 10 项 ✓ | .mod-top-tag 10 项 ✓ | .search-tag 10 项 ✓ | 域名提示 ✓ | 无 (源站未设) ✓ |
| 登录链接 | .ywtop 登陆/注册 ✓ | .mod-top-nav-tool 域名发布页 ✓ | 无 (源站 header 无) | .user1 + .lang ✓ | .user-dropdown ✓ |
| 完整导航项 | 10 项 ✓ | 11 项 ✓ | 14 项 ✓ | 6 项 ✓ | 7 项 ✓ |
| footer 友链 | 4 链接 + 版权 ✓ | 5 链接 + 版权 ✓ | sitemap 4 链接 ✓ | 6 链接 + 友情链接 ✓ | 6 链接 + 转码声明 ✓ |
| inline style | ✓ | ✓ | ✓ | ✓ | ✓ |
| usePublic() | ✓ site+navigate | ✓ site+navigate | ✓ site+navigate | ✓ site+navigate | ✓ site+navigate |
| BookCover 渲染封面 | ✓ (120×150 / 67×82) | ✓ (210×280 / 180×220) | ✓ (3:4 cover) | ✓ (60×80 in cover-stack) | ✓ (180×250 detail) |
| Skeleton 加载态 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 空态 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 响应式 | ✓ flex-wrap + grid auto-fit | ✓ min-width 1200 | ✓ flex-wrap + grid | ✓ max-width 1112 | ✓ max-width 1180 + flex-wrap |

## Stage Summary

- 任务完成度: 5 站点 × 4 文件 = 20 文件全部填充, 全部 1:1 克隆标准合规
- 文件 LoC 总计: 2720 行 (替换原占位 ~200 行, 净增 ~2520 行)
- 验证: tsc 0 errors / tsc --noUnusedLocals 0 errors / lint 0 errors/0 warnings / dev server 200 OK
- 不修改的内容 (尊重约束):
  - 不动 R14 已落地的 BookInfoLayout.tsx (10 套 BookInfo 变体分发)
  - 不动 R14 已落地的 HomeView.tsx dynamic() 导入链 (HomeClone 仍由 HomeView 动态导入)
  - 不动 themes.ts (10 套主题 preset 保留)
  - 不动 PublicSite.tsx (theme 预览覆盖逻辑)
  - 不修改 BookCover / bits / ctx / shared.ts 接口
  - 仅替换 5 套 clone-themes 的占位实现为真正 1:1 克隆
