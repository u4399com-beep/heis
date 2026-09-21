# Task R24-2J — shipsay 剩余 7 页型补齐 (1:1 克隆 demo.shipsay.com)

## 任务概览
- **Task ID**: R24-2J
- **Agent**: full-stack-developer
- **目标**: 补齐 shipsay 主题剩余 7 页型 (BookInfo / CategoryList / ReadChrome / RankingView / FulltextView / SearchView / KeywordView) 为 1:1 精仿 demo.shipsay.com, 风格与主控 R24-1A 重写的 HomeClone 保持一致
- **范围**: 仅 `src/components/public/clone-themes/shipsay/` 下 7 个 .tsx 文件
- **不修改**: HomeClone.tsx (主控已重写), 其他 9 套主题, HomeView/PublicSite/CloneCSSLoader/themes.ts/books route, bits/seo/ctx/BookCover/types/shared/helper, shipsay.css

## 步骤 1: 读交接文档
读 `worklog.md` 最后 500 行, 确认:
- R24-1A 主控 shipsay/HomeClone 示范 (180 行真实 1:1 克隆), 复刻 header>.container.head + .navigation>nav + .container>.side_commend+aside + .container>.section.flex>.sortvisit
- R24-2D pilishuwu BookInfo/ReadChrome 完整子页 probe 参考 (2505 行), 但 shipsay 无子页 probe, 需从首页 DOM + shipsay.css 推断
- R24-2A aijjxs CategoryList/RankingView 写法 (用源站真实 class + 内部 fetch /api/public/categories + /api/public/books)
- 9 个 agent 已完成其他 9 套主题全套 8 页型 (aijjxs/23qb/ddyueshu/pilishuwu/101kks/huangjinwu/ggd66/x2552/trxsw)
- shipsay 只有 HomeClone 是 1:1 重写, 其余 7 页型还是 32 行通用模板 (旧 C={primary:'#ed4259',accent:'#bf2c24',...} 配色 inline style)

## 步骤 2: 读参考样本

### 2.1 主控 shipsay/HomeClone 示范 (180 行)
位于 `src/components/public/clone-themes/shipsay/HomeClone.tsx`, 必读以保持风格一致:
- 头部 header>.container.head: `#logo` (span 站名 + p 域名) + `form name="t_frmsearch"` (#searchkey.search_input + #search_btn 含 `fa-search fa-lg`) + `.header_right` (4 个 a 含 fa-home/fa-book/fa-coffee/fa-history 图标)
- 导航 .navigation>nav.container: `<a>首页</a>` + 8 个分类 a + `<div id="user_panel" />`
- 数据来源: 内部 `useEffect fetch /api/public/categories?limit=60` (多兜底解析: d.data?.items || d.data?.categories || d.items || d.categories || []), 失败用 DEFAULT_NAV 8 个分类兜底 (1玄幻/2武侠/3都市/4历史/5科幻/6游戏/7女生/8其他)
- 交互: `bookNavProps(navigate, b.id)` (键盘可达书籍卡片), `navigate({view:'category',cat})` 跳分类, `navigate({view:'search',q})` 搜索, `navigate({view:'home'})` 回首页

### 2.2 源站 CSS (18KB)
位于 `public/clone-css/shipsay.css` (1138 行, CloneCSSLoader 自动加载), 提取子页可复用 class:
- **header**: `.head` (justify-between padding 16px 5px) / `#logo` (span 1.5em #3e3d43 + p #bf2c24) / `.search_input` (text-indent 10px border-radius 3px 0 0 3px) / `#search_btn` (#bf2c24 bg #fbfbfb color) / `.header_right` (display flex, #home 隐藏)
- **nav**: `.navigation` bg #3e3d43, `nav a` color #fbfbfb padding 0 20px height 41px, `nav a:hover` border-top 2px #ed4259 + bg #252428, `#user_panel` margin-left auto
- **section**: `.section` width 100% padding 10px bg #fff, `.section_style` bg #FBF6EC
- **home 区块**: `.side_commend/.aside` (margin-top 10px padding 10px bg #fff), `aside` width 250px, `.side_commend_width` 700px, `.flex` display flex flex-flow wrap, `.side_commend li` width 49% li 卡片, `.li_bottom` flex nowrap, `em.orange` #f0643a + `em.blue` #4284ed
- **lastupdate (4 列行)**: `.lastupdate` width 700px bg #fff, `.lastupdate li` display flex height 41px line-height 41px border-bottom dotted, `.lastupdate li *:nth-child(1-4)` 比例 9%/25%/41%/25% (类别/书名/最新章节/作者+日期)
- **popular**: `.popular li` flex justify-between height 41px border-bottom dotted
- **img_span**: position relative margin-right 15px, `.img_span a` 100x133 overflow hidden, `.img_span span` 100x25 rgba(0,0,0,.4) bg, `span.fullflag` bg rgba(191,44,36,.75)
- **sortvisit**: width 312px, `.sortvisit>a` color #555 font-weight 700, `.sortvisit>ul` flex padding 10px, `.sortvisit>ul>div` flex width 100% height 85px (1 大封面 + p 简介), `.sortvisit ul li` width 50% height 38px border-bottom dashed
- **chapter_list**: `.chapter_list a` display block padding-left 5px font-size 1.1em, `.chapter_list ul` flex wrap, `.chapter_list ul li` width 33% line-height 50px height 50px border-bottom dotted
- **title**: `.title` display flex align-items center font-weight 700 color #555 font-size 1.1em padding-bottom 8px border-bottom 1px #ddd
- **novel_info (书页)**: `.novel_info_main` padding 10px 5px 0 line-height 1.5em, `.novel_info_main img` 120x160 margin 8px 20px 10px 0 box-shadow 3px 4px 10px #999 float left, `.novel_info_title` line-height 38px, `.novel_info_title h1` 24px bold #555, `.novel_info_title p span` padding 0 10px border 1px #ccc border-radius 3px (元数据 chip), `.novel_info_title > i` white-space nowrap, `.novel_info_title > div > a` margin-right 15px font-size 1.1em, `.novel_info_main .indent>p` text-indent 2em line-height 2em
- **l_btn**: `.l_btn` width 108px padding-left 15px line-height 35px border-radius 3px bg #bf2c24 color #fbfbfb, `.l_btn_0` 白底红字, `:hover` bg #ed4259
- **ulcard (tab 条)**: `.ulcard` margin-top 30px border-bottom 1px #eee, `.ulcard li` padding 0 20px height 40px font-size 18px, `.act` border-bottom 2px solid #ed4259 (active 态)
- **read_bg/reader**: `.read_bg` bg #e7e1d4, `main[class='container']` max-width 900px, `.text_title` padding 40px 64px 10px, `.style_h1` 24px bold #555, `.text_info span` gray 14px, `.text` position relative, `.fontsize` display flex margin-bottom 20px, `.fontsize button` 3 sizes (30/33/36 px), `:hover` bg #ed4259, `#article` padding 0 64px 20px font-size 18px color #262626 min-height 200px, `#article>p` text-indent 2em line-height 1.8em
- **read_nav (翻页)**: `.read_nav` height 60px box-shadow 0 0 10px rgba bg #FBF6EC flex line-height 60px, `.read_nav a` text-align center width 33.33% font-size 18px, `.read_nav a:nth-child(2)` width 34% border-left+right 1px #ddd
- **pages (分页)**: `.pages` width 100% padding 10px 0 text-align center, `#pagestats` display none, `.pages a, strong, kbd input` inline-block margin 2px padding 0 2px min-width 35px border 1px #e6e6e6 border-radius 3px height 35px line-height 35px, `:hover, strong` bg #bf2c24 color #fff
- **store (书库)**: `.store` display flex max-width 960px, `.store_left` width 760px, `#store_right` width 190px, `.store_left>.side_commend` margin 0, `#store_right a` display table, `.onselect` bg #bf2c24, `#store_right>*` border 1px #e6e6e6, `#store_right>ul,div` bg #fff margin-bottom 10px, `.store_title` border-bottom 1px #e6e6e6 line-height 41px font-size 1.2em text-align center, `#store_right li` line-height 50px text-align center font-size 1.2em border-bottom 1px #eee
- **searchresult**: `.searchresult` padding-top 4px width 100%!, `.searchresult h3, p` overflow hidden height 20px, `.searchresult h3` font-size 1.2em, `.searchresult .searchresult_p` height 46px line-height 24px overflow hidden margin 10px 0 (简介), `.searchresult div` margin-top 10px
- **footer**: `footer` color #fbfbfb padding 15px 0 flex column align center font-size 12px, `footer a` color #fbfbfb, `#footer, .navigation` bg #3e3d43

### 2.3 源站首页 DOM (37KB)
位于 `agent-ctx/probe-html2/probe-shipsay.html`, 提取真实 DOM 结构:
- header 真实结构 (line 26-41): `<header><div class="container head"><a id="logo" href="/"><span>船说CMS</span><p>demo.shipsay.com</p></a><script>search();</script><form name="t_frmsearch" method="post" action="/search/" target="_blank" onsubmit="return chkval()"><input id="searchkey" name="searchkey" class="search_input" placeholder="猫腻"><input type="hidden" name="searchtype" value="all"><button type="submit" id="search_btn" title="搜索"><i class="fa fa-search fa-lg"></i></button></form><div class="header_right"><a id="home" href="/"><i class="fa fa-home fa-lg"></i><br>首页</a><a href="/sort/"><i class="fa fa-book fa-lg"></i><br>书库</a><a href="/quanben/sort/"><i class="fa fa-coffee fa-lg"></i><br>完本</a><a href="/history.html"><i class="fa fa-history fa-lg"></i><br>足迹</a></div></div></header>`
- navigation 真实结构 (line 42-57): `<div class="navigation"><nav class="container"><a href="/">首页</a><a href="/sort/1/1/">玄幻</a>...<a href="/sort/8/1/">其他</a><div id="user_panel"></div></nav></div>`
- 大神小说 .side_commend.side_commend_width (line 60-63): `<div class="side_commend side_commend_width"><p class="title"><i class="fa fa-thumbs-o-up fa-lg">&nbsp;</i>大神小说</p><ul class="flex">` × 6 li 含 `.img_span` (a>img 120x160 + span "科幻 / 连载") + `.w100` (a>h2 书名 + p.indent 简介 + .li_bottom (a>i 作者 + div>em.orange 字数 + em.blue 日期))
- 热门小说 aside (line 65-78): `<aside><p class="title"><i class="fa fa-fire fa-lg">&nbsp;</i>热门小说</p><ul class="popular odd">` × 12 li 含 a 书名 + a.gray 作者
- 分类区块 .section.flex .sortvisit (line 81-): `<div class="section flex"><div class="sortvisit"><a href="/sort/1/1/">玄幻魔法</a><ul><div><a><img lazy 60x80></a><p><a>书名</a><i>/作者</i><br>&nbsp;&nbsp;&nbsp;&nbsp;简介</p></div><li><a>书名</a><i>/ 作者</i></li> × 12</ul></div>` × 6 cats
- 最新章节 .lastupdate (line 200-): `<div class="lastupdate"><p class="title"><i class="fa fa-clock-o fa-lg">&nbsp;</i>最新章节</p><ul class="odd"><li><span>「类别」</span><a>书名</a><a class="gray" href="/read/..">章节</a><span><a class="gray" href="/author/..">作者</a>&nbsp;&nbsp;日期</span></li>` × 36
- 最新入库 aside (line 230-): `<aside><p class="title"><i class="fa fa-pencil fa-lg">&nbsp;</i>最新小说</p><ul class="popular odd">` × 30 li
- 友链 (line 285-): `<div class="container"><div class="section link"><p class="title"><i class="fa fa-link">&nbsp;</i>友情链接</p><a href="https://www.shipsay.com">船说CMS</a> × 2</div></div>`
- footer (line 290-): `<div id="footer"><footer class="container"><p><i class="fa fa-flag"></i>&nbsp;<a href="/">船说CMS</a>&nbsp;书友最值得收藏的网络小说阅读网</p><p><a class="zh_click">简体版</a> · <a class="zh_click">繁體版</a></p></footer></div>`

### 2.4 同辈示范
- `pilishuwu/BookInfo.tsx` (433 行, R24-2D): 内部 fetch /api/public/books?cat=&size=8&sort=latest 拉同分类前 8 本作"看过本书的人还看过"侧栏推荐榜, 排除当前书
- `pilishuwu/ReadChrome.tsx` (228 行, R24-2D): useEffect chapterTitle 切换 scroll to top + useState fontSize 字号控制 + onPrev/onNext props
- `aijjxs/CategoryList.tsx` (247 行, R24-2A): .catalog listbg × N + .pager 分页 (上一页/页码/下一页/尾页) + aside .panel.rank 侧栏
- `aijjxs/RankingView.tsx` (209 行, R24-2A): inline TABS 切换 + .panel.rank 排名列表 + .pager 分页
- `aijjxs/FulltextView.tsx` (224 行, R24-2A): 与 RankingView 同模式, 标题改全本完本小说

注: shipsay 没有子页 probe (book/chapter/category), 从首页 DOM + shipsay.css 推断子页结构 (与 x2552 同样从首页+CSS 反推)

## 步骤 3: 重写 7 文件
全部位于 `src/components/public/clone-themes/shipsay/`, 总 1313 行 (从旧 7 文件总 ~179 行扩展 7x+):

### 3.1 BookInfo.tsx (217 行)
复刻源站书页 (.novel_info_main + .chapter_list + .sortvisit 同类推荐 + .section.link + #footer):
- header>.container.head (logo+搜索+header_right 4 图标)
- .navigation>nav (8 分类 a + #user_panel)
- .container>.section .novel_info_main: BookCover (120x160 float left box-shadow) + .novel_info_title (h1 书名 + p 含 5 span chip 元数据 [作者/类别/状态/字数/更新] + i 最新章节链接 + div .l_btn 开始阅读 + .l_btn_0 查看目录) + .indent>p 简介
- .container>.section .chapter_list: p.title (fa-list) + ul li × 2 (最新章节 a + 查看完整章节目录 a)
- .container>.section.flex .sortvisit: 同类推荐 (12 本, 第 1 本带 60x80 封面+简介, 2-12 文字 li) — 数据来源内部 fetch /api/public/books?cat=&size=13&sort=latest 排除当前书
- .container>.section.link 友链 + #footer>footer
- 交互: bookNavProps + onContinueRead + onScrollToc + onGoCategory + navigate({view:'search',q:author})

### 3.2 CategoryList.tsx (208 行)
复刻源站分类页 (.store .store_left .side_commend .flex + #store_right + .pages):
- header + navigation (8 分类)
- .container>.store: .store_left>.side_commend.side_commend_width (p.title fa-book + ul.flex li × N 含 .img_span a BookCover 100x133 + span 类别/状态 + .w100 a h2 书名 + p.indent 简介 + .li_bottom a 作者 + div em.orange 字数 + em.blue 日期) + .pages 分页 (上一页/页码/下一页/尾页 + #pagestats)
- #store_right (3 块): ul store_title 全部分类 + ul store_title 热门小说 (前 12 本) + div store_title 热门作者 (前 12 不重复)
- .section.link 友链 + #footer>footer
- 交互: bookNavProps + navigate({view:'category',cat}) + navigate({view:'search',q:author}) + onPage(p)

### 3.3 ReadChrome.tsx (137 行)
复刻源站阅读页 (main.container .text_title .style_h1 + .text .fontsize + #article + .read_nav):
- header + navigation (8 分类)
- main.container.read_bg:
  - .text_title (padding 40px 64px 10px) 内含 h1.style_h1 章节标题 + .text_info span 来源/欢迎词
  - .text: .fontsize (3 button A/A/A+ + span 字号显示) + #article children (padding 0 64px 20px, fontSize state 16/19/22)
  - .read_nav (3 列: 上一章/目录/下一章, 每列 33.33% width, 中列加 border-left/right 1px #ddd) — 目录列触发 goTop
- .section.link 友链 + #footer>footer
- 交互: useState sizeIdx + useEffect chapterTitle 切换 scroll to top + onPrev/onNext props

### 3.4 RankingView.tsx (203 行)
复刻源站排行榜页 (.section .ulcard tabs + .lastupdate 4 列行 + .pages):
- header + navigation (8 分类)
- .container>.section:
  - .ulcard (7 tab: 总点击榜/月点击榜/周点击榜/日点击榜/总推荐榜/字数榜/最近更新, 当前 tab li.act 高亮 border-bottom 2px #ed4259)
  - .lastupdate (p.title fa-trophy 当前 tab 名 + ul.odd li × N 含 span 排名 + a 书名 + a.gray 最新章节 + span 作者+日期 — 4 列比例 9%/25%/41%/25%)
  - .pages 分页
- .container>aside 热门小说 (popular 12 本) — 复用 home aside 风格
- .section.link 友链 + #footer>footer
- 交互: onTabChange(t) + onPage(p) + bookNavProps + navigate({view:'search',q:author})

### 3.5 FulltextView.tsx (206 行)
复刻源站全本页 (.store .store_left .side_commend .flex 完本卡片 + #store_right + .pages):
- header + navigation (8 分类)
- .container>.store: .store_left>.side_commend.side_commend_width (p.title fa-coffee 全本完本小说 + ul.flex li × N 含 .img_span a BookCover 100x133 + span.fullflag 红底白字"完本" + .w100 a h2 书名 + p.indent 简介 + .li_bottom a 作者 + div em.orange 字数 + em.blue 日期) + .pages 分页
- #store_right (3 块): ul store_title 全部分类 + ul store_title 热门完本 (前 12 本) + div store_title 热门作者 (前 12 不重复)
- .section.link 友链 + #footer>footer
- 交互: bookNavProps + onPage(p) + navigate({view:'search',q:author})

### 3.6 SearchView.tsx (159 行)
复刻源站搜索页 (header 搜索框 defaultValue=q 预填 + .section .searchresult × N):
- header (搜索框 defaultValue={q} 预填, 提交触发 navigate({view:'search',q:qv})) + navigation (8 分类)
- .container>.section:
  - p.title fa-search "搜索：q"
  - 加载中/空态友好 (msgdiv 含"未找到与 q 相关的书籍"+ .l_btn 返回首页) / .searchresult × N (h3 a 书名 + p 作者/类别/字数 + p.searchresult_p 简介 + div a.gray 最新章节)
- .container>aside 热门小说 (popular 12 本)
- .section.link 友链 + #footer>footer
- 交互: bookNavProps + goSearch(form submit) + navigate({view:'search',q:author})

### 3.7 KeywordView.tsx (183 行)
复刻源站标签页 (header 搜索框 defaultValue=tag 预填 + .section .ulcard 相关标签 + .searchresult × N):
- header (搜索框 defaultValue={tag} 预填) + navigation (8 分类)
- .container>.section:
  - p.title fa-tags "标签：tag"
  - .ulcard (相关标签 12 个, 从 books.category+keywords 拆分去重前 12 个, 排除当前 tag, 点击 navigate({view:'keyword',tag:t}))
  - 加载中/空态友好 (msgdiv) / .searchresult × N (h3 书名 + p 作者/类别/字数 + p.searchresult_p 简介 + div a.gray 最新章节)
- .container>aside 热门小说 (popular 12 本)
- .section.link 友链 + #footer>footer
- 交互: bookNavProps + goSearch + goKeyword(t) + navigate({view:'search',q:author})

## 步骤 4: 关键设计

### 4.1 全部用 shipsay 真实 class 名 (40+ 个)
让 CloneCSSLoader 加载的 shipsay.css 全部选择器命中, 不再使用 inline style 换配色 (旧 32 行模板做法 `C={primary:'#ed4259',accent:'#bf2c24',...}` 全部废弃); 仅保留必要的尺寸参数:
- **header 类**: `header`, `.container.head`, `#logo`, `#logo span`, `#logo p`, `form name="t_frmsearch"`, `#searchkey.search_input`, `#search_btn`, `.header_right`, `.header_right a`, `.header_right #home`
- **nav 类**: `.navigation`, `nav.container`, `nav a`, `#user_panel`
- **section 类**: `.container`, `.section`, `.section.flex`, `.section.link`
- **首页区块类**: `.side_commend`, `.side_commend_width`, `aside`, `.flex`, `.side_commend li`, `.li_bottom`, `.li_bottom > div`, `em.orange`, `em.blue`, `.side_commend h2`, `.side_commend img`
- **lastupdate 类**: `.lastupdate`, `.lastupdate li`, `.lastupdate li *:nth-child(1-4)`, `.odd`, `.gray`
- **popular 类**: `.popular li`, `.popular li *:first-child`, `.popular li *:last-child`
- **img_span 类**: `.img_span`, `.img_span a`, `.img_span span`, `span.fullflag`
- **sortvisit 类**: `.sortvisit`, `.sortvisit > a`, `.sortvisit ul`, `.sortvisit > ul p > a`, `.sortvisit > ul > div`, `.sortvisit > ul > div img`, `.sortvisit > ul > div p`, `.sortvisit ul li`, `.sortvisit ul i`
- **title 类**: `.title`, `p.title`
- **novel_info 类**: `.novel_info_main`, `.novel_info_main img`, `.novel_info_title`, `.novel_info_title p`, `.novel_info_title h1`, `.novel_info_title p span`, `.novel_info_title > i`, `.novel_info_title > div > a`, `.novel_info_main .indent > p`, `.indent`
- **chapter_list 类**: `.chapter_list`, `.chapter_list a`, `.chapter_list ul`, `.chapter_list ul li`
- **l_btn 类**: `.l_btn`, `.l_btn_0`
- **ulcard 类**: `.ulcard`, `.ulcard li`, `.ulcard span`, `.act`
- **reader 类**: `.read_bg`, `main[class='container']`, `.text_title`, `.style_h1`, `.text_info`, `.text_info span`, `.text`, `.fontsize`, `.fontsize button`, `#article`, `#article > p`, `.read_nav`, `.read_nav a`, `.read_nav a:nth-child(2)`
- **pages 类**: `.pages`, `#pagestats`, `.pages a`, `.pages strong`, `kbd input`, `.pages a:hover`, `.pages strong`
- **store 类**: `.store`, `.store_left`, `#store_right`, `.store_left > .side_commend`, `.store_title`, `#store_right li`, `#store_right > div`
- **searchresult 类**: `.searchresult`, `.searchresult h3`, `.searchresult p`, `.searchresult .searchresult_p`, `.searchresult div`
- **footer 类**: `#footer`, `footer.container`, `footer a`
- **link 类**: `.section.link`, `.link > a`
- **msgdiv 类**: `.msgdiv` (空态友好容器)

### 4.2 数据来源
- **categories**: 所有 7 文件均 `useEffect fetch /api/public/categories?limit=60`, 多兜底解析 `d.data?.items || d.data?.categories || d.items || d.categories || []`, 失败用 DEFAULT_NAV 8 个分类兜底 (1玄幻/2武侠/3都市/4历史/5科幻/6游戏/7女生/8其他, 与源站 nav 顺序一致)
- **BookInfo 同类推荐**: 内部 `fetch /api/public/books?cat=&size=13&sort=latest` 拉同分类前 13 本作"同类推荐"sortvisit (排除当前书, 取前 12 本, 第 1 本带 60x80 大封面)
- **CategoryList**: `books` prop + `page/total/size/onPage` 分页 props + `label` 标题 prop
- **RankingView**: `books` + `tab/onTabChange` + `page/total/size/onPage` props
- **FulltextView**: `books` + `page/total/size/onPage` props
- **SearchView**: `q` + `books` + `loading` props (无分页, 单页全部结果)
- **KeywordView**: `tag` + `books` + `loading` props (无分页)
- **ReadChrome**: `children` + `chapterTitle` + `onPrev/onNext` props

### 4.3 保留交互
- `bookNavProps(navigate, b.id)` 跳书页 (含 role/tabIndex/onKeyDown Enter/Space)
- `navigate({view:'category',cat})` 跳分类 (含 cat=undefined 表示全部)
- `navigate({view:'search',q})` 搜索 (用于作者跳转)
- `navigate({view:'keyword',tag})` 跳关键词 (KeywordView 相关标签点击)
- `navigate({view:'home'|'fulltext'|'history'})` 各功能跳转
- BookInfo 用 onContinueRead/onScrollToc/onGoCategory props
- ReadChrome 用 onPrev/onNext props + useState sizeIdx 字号控制 + useEffect chapterTitle 切换 scroll to top
- RankingView 用 onTabChange/onPage props
- CategoryList/FulltextView 用 onPage props
- SearchView/KeywordView 用 form onSubmit goSearch (搜索框 defaultValue 预填)

### 4.4 'use client' 首行
所有 7 文件首行 `'use client'` (用了 useState/useEffect/onClick/navigate 等客户端能力)

### 4.5 shipsay 风格一致性
- header 完全复刻 HomeClone (相同 .container.head + .navigation>nav + 4 图标 header_right)
- footer 完全复刻 HomeClone (#footer>footer.container, 含 fa-flag icon + 站名 a + footerText p)
- 友链 .container>.section.link 复刻 HomeClone (p.title fa-link + a × 2 站名链接)
- 配色完全交给 shipsay.css (red #ed4259 / dark #3e3d43 / accent #bf2c24 / orange #f0643a / blue #4284ed / gray #666 / bg #f4f4f4 / surface #fff / radius 3px)
- 8 个 DEFAULT_NAV 分类 (与源站 nav 顺序一致: 玄幻/武侠/都市/历史/科幻/游戏/女生/其他, id 1-8 与源站 URL /sort/{id}/1/ 一致)

## 步骤 5: 验证

### 5.1 bun run lint
```
$ eslint .
=== EXIT 0 ===
```
0 errors / 0 warnings ✓

### 5.2 bunx tsc --noEmit
排除 examples (websocket frontend/server 找不到 socket.io-client/socket.io) + skills (image-edit images 字段错误 + stock-analysis 类型错误) 的预存在错误后, src/ 0 errors ✓
```
$ bunx tsc --noEmit 2>&1 | grep -v -E "examples|skills"
(no output — 全部错误都在 examples/skills 范围)
```

### 5.3 dev server log
- ✓ Compiled in 1139ms / 418ms / 328ms / 294ms / 351ms / 355ms / 546ms / 399ms / 398ms / 320ms / 288ms / 333ms / 349ms / 391ms / 627ms / 295ms / 215ms / 310ms / 216ms / 259ms / 540ms / 761ms / 755ms / 633ms / 1224ms
- /api/public/books 200 OK, /api/public/categories 200 OK, /api/public/book 200 OK, /api/public/chapter 200 OK, /api/public/sites 200 OK, /api/public/related 200 OK, /api/public/keyword 200 OK
- clone-css 加载 OK (/clone-css/23qb.css 等)
- 无 shipsay 相关编译错误

## 不修改的文件 (尊重约束)
- shipsay/HomeClone.tsx (主控 R24-1A 已重写好) — 未动
- 其他 9 套主题 (aijjxs/23qb/ddyueshu/pilishuwu/101kks/huangjinwu/ggd66/x2552/trxsw 全部 1:1 重写好) — 未动
- HomeView.tsx / PublicSite.tsx / CloneCSSLoader.tsx / themes.ts / books route (主控已接线) — 未动
- bits.tsx / seo.ts / ctx.tsx / BookCover.tsx / types.ts / shared.ts / helper — 未动
- prisma/schema.prisma — 未动
- shipsay.css (1138 行, 已完整) — 未动
- 其他 9 个 CSS 文件 — 未动
- 未安装新 npm 包 (0 新依赖)

## 总览
- 完成 7 个 1:1 克隆文件 (位于 `src/components/public/clone-themes/shipsay/`):
  - BookInfo.tsx (217 行) — 复刻源站书页 (.novel_info_main + .chapter_list + .sortvisit 同类推荐 + .section.link + #footer)
  - CategoryList.tsx (208 行) — 复刻源站分类页 (.store .store_left .side_commend .flex + #store_right + .pages + #footer)
  - ReadChrome.tsx (137 行) — 复刻源站阅读页 (main.container.read_bg + .text_title .style_h1 + .text .fontsize + #article + .read_nav + #footer)
  - RankingView.tsx (203 行) — 复刻源站排行榜页 (.section .ulcard tabs × 7 + .lastupdate 4 列行 + .pages + aside + #footer)
  - FulltextView.tsx (206 行) — 复刻源站全本页 (.store .store_left .side_commend .flex 完本卡片 span.fullflag + #store_right + .pages + #footer)
  - SearchView.tsx (159 行) — 复刻源站搜索页 (header 搜索框 defaultValue=q 预填 + .section .searchresult × N + 空态 msgdiv + aside + #footer)
  - KeywordView.tsx (183 行) — 复刻源站标签页 (header 搜索框 defaultValue=tag 预填 + .section .ulcard 相关标签 + .searchresult × N + aside + #footer)
  - 总 1313 行 (旧 7 文件总 ~179 行, 净增 ~1134 行, 7x+ 扩展)
- 复刻源站关键 class (40+ 个, 让 CloneCSSLoader 加载的 shipsay.css 全部选择器命中)
- 复用 helper: usePublic (site/navigate) + bookNavProps (键盘可达书籍卡片) + formatWords (万字格式) + statusLabel (连载中/已完结) + BookCover (智能封面) + useState/useEffect (categories fetch + 字号控制 + 章节切换自动滚顶) 全部按任务要求使用
- 验证: bun run lint 0 errors ✓ / bunx tsc --noEmit src/ 0 errors ✓ (排除 examples/skills 预存在错误) / dev server log 编译成功 + API 200 OK
