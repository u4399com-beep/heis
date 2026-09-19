# R24-2C Agent Work Record — ddyueshu 主题 1:1 重写

Agent: full-stack-developer (ddyueshu 主题 1:1 重写)
Task ID: R24-2C
Date: 2026-09-17

## 任务概述
重写 ddyueshu 主题全套 8 个 .tsx 文件 (位于 `src/components/public/clone-themes/ddyueshu/`),
从 32 行通用模板 (只换配色) 升级为真正 1:1 克隆 www.ddyueshu.cc 源站真实 DOM 结构.
全部使用源站真实 class 名, 让 CloneCSSLoader 加载的 `public/clone-css/ddyueshu.css` (源 biquge.css, 278 行) 真正生效.

## 参考资料
- 源站首页 DOM: `agent-ctx/probe-html2/probe-ddyueshu.html` (GBK 编码源站, 抓取后 mojibake 但 DOM class/层级清晰)
- 源站 CSS: `public/clone-css/ddyueshu.css` (278 行, 由 CloneCSSLoader 自动加载到 ddyueshu 主题站)
- 示范模板: `src/components/public/clone-themes/shipsay/HomeClone.tsx` (主控 R24-1A 已重写的 1:1 版本)
- 共享 props 接口: `src/components/public/clone-themes/shared.ts` (HomeCloneProps/BookInfoProps/...)
- 复用 helper: `usePublic` / `bookNavProps` / `formatWords` / `BookCover` (避免重复造轮子)

## 源站真实 DOM 提取 (probe-ddyueshu.html)
```
<div id="wrapper">
  <div class="header">
    <div class="header_logo"><a href="https://www.ddyueshu.cc">得得小说</a></div>
    <script>bqg_panel();</script>  <!-- 用户面板 JS 注入 -->
  </div>
  <div class="nav">
    <ul>
      <li><a href="/">首页</a></li>
      <li><a href="/modules/article/bookcase.php">我的书架</a></li>
      <li><a href="/xuanhuanxiaoshuo/">玄幻小说</a></li>
      <li><a href="/xiuzhenxiaoshuo/">修真小说</a></li>
      <li><a href="/dushixiaoshuo/">都市小说</a></li>
      <li><a href="/chuanyuexiaoshuo/">穿越小说</a></li>
      <li><a href="/wangyouxiaoshuo/">网游小说</a></li>
      <li><a href="/kehuanxiaoshuo/">科幻小说</a></li>
      <li><a href="/paihangbang/">排行榜</a></li>
      <li><a href="/xiaoshuodaquan/">全本小说</a></li>
    </ul>
  </div>
  <div id="main">
    <div id="content">
      <div id="main">  <!-- 双层 main 嵌套 -->
        <div id="hotcontent">
          <div class="l">  <!-- 695px 左栏: 4 个 .item 横排 -->
            <div class="item">
              <div class="image"><a href="..."><img src="..." width="120" height="150" /></a></div>
              <dl><dt><span>类别</span><a href="...">书名</a></dt><dd>简介</dd></dl>
              <div class="clear"></div>
            </div>
            ...
          </div>
          <div class="r">  <!-- 265px 右栏: 排行榜热书 -->
            <h2>排行榜热书</h2>
            <ul>
              <li><span class="s1">[类别]</span><span class="s2"><a>书名</a></span><span class="s5">作者</span></li>
              ...
            </ul>
          </div>
          <div class="clear"></div>
        </div>
        <div class="novelslist">  <!-- 分类区块行 1: 3 个 .content 横排 (315px each) -->
          <div class="content">
            <h2>玄幻小说</h2>
            <div class="top"><div class="image"><img width="67" height="82" /></div><dl><dt>...</dt><dd>简介</dd></dl><div class="clear"></div></div>
            <ul>
              <li><a href="...">书名</a>/作者</li>
              ... (11 个文字列表)
            </ul>
          </div>
          ... (3 个 .content 列)
        </div>
        <div class="novelslist">...</div>  <!-- 分类区块行 2 -->
        <div id="newscontent">
          <div class="l">  <!-- 最新更新列表 695px -->
            <h2>最新入库小说列表</h2>
            <ul>
              <li><span class="s1">[类别]</span><span class="s2"><a>书名</a></span><span class="s3"><a>最新章节</a></span><span class="s4">作者</span><span class="s5">日期</span></li>
              ... (30 个)
            </ul>
          </div>
          <div class="r">  <!-- 热门推荐 265px -->
            <h2>热门小说推荐</h2>
            <ul>
              <li><span class="s1">[类别]</span><span class="s2"><a>书名</a></span><span class="s5">日期</span></li>
              ... (15 个)
            </ul>
          </div>
          <div class="clear"></div>
        </div>
      </div>
    </div>
  </div>
  <div id="firendlink">友情链接: ...</div>
  <div class="dahengfu">...广告位 JS...</div>
  <div class="footer">
    <div class="footer_link"></div>
    <div class="footer_cont">...底部 JS...</div>
  </div>
</div>
```

## 重写的 8 个文件清单

### 1. HomeClone.tsx (165 行)
1:1 复刻 ddyueshu.cc 首页结构:
- `#wrapper` 根容器
- `.header > .header_logo + .header_search + .userpanel` (源站 logo+搜索+用户面板)
- `.nav > ul > li` (10 个导航项, 含 categories API 动态拉取的分类)
- `#main > #content > #main` 双层嵌套
- `#hotcontent`: `.l` 大神小说 (4 个 .item 大封面+简介) + `.r` 排行榜热书 (8 个文字列表) + `.clear`
- 2 个 `.novelslist`: 每行 3 个 `.content` 分类区块 (1 大封面+简介 + 11 文字列表)
- `#newscontent`: `.l` 最新更新 (30 个 5 列列表 s1/s2/s3/s4/s5) + `.r` 热门推荐 (15 个 3 列列表) + `.clear`
- `#firendlink` 友情链接
- `.dahengfu` 横幅占位
- `.footer > .footer_link + .footer_cont`
- 数据: 内部 `useEffect fetch('/api/public/categories?limit=60')` 拿分类用于 nav + 分类区块标题
- 数据拆分: `topBooks` 字数前 4 → 大神小说; `rank` 前 8 → 排行榜; `navCats` 前 8 分类 → `.novelslist`; `news` 前 30 → 最新更新; `hot` 前 15 → 热门推荐
- 交互: `bookNavProps(navigate, b.id)` 跳书页; `navigate({view:'category',cat})` 跳分类; `navigate({view:'search',q})` 搜索; `navigate({view:'ranking'/'fulltext'/'history'})` 各功能跳转

### 2. BookInfo.tsx (139 行)
1:1 复刻 ddyueshu.cc 书籍详情页 (无 probe, 从 ddyueshu.css 推断):
- `.content_read > .box_con` 主容器 (源站 980px width + 976px box border)
- `.con_top` 顶部面包屑栏 (源站 line-height 40px bg #E1ECED border-bottom 1px #88C6E5)
- `#maininfo` 右侧主信息 (源站 800px float right)
  - `#fmimg` 封面图 + `span.a`/`span.b` 状态徽章 (源站 126x150 + .a=完本/.b=连载)
  - `#info` 书名+作者+分类+字数+状态 (源站 h1 28px 700 + p 350px float left 25px line-height)
  - `#intro` 简介 (源站 96% width line-height 150% border-top dashed 1px #88C6E5 padding 10px font 13px)
  - `#list dl/dt/dd` 章节目录入口 (源站 33% width 浮动)
- `#sidebar` 左侧栏 (源站 140px float left 推荐位)
- `.bottem1` 底部导航 (源站 clear both text-align center width 900px)
- 交互: `bookNavProps(navigate, book.id)` 跳书页; `onScrollToc` 滚动到章节列表; `onGoCategory` 跳分类

### 3. CategoryList.tsx (124 行)
1:1 复刻 ddyueshu.cc 分类列表页 (从 .novelslist 模式推断):
- `#main > .novelslist` (源站 border 3px #A6D3E8 padding 3px bg #FEF9EF width 968px)
- `.novelslist h2` (源站 bg #F6F8FE border-bottom 1px #DDD height 30px line-height 30px)
- 混合列表: 每本书 1 个 67x82 封面 (源站 .novelslist .content .image img 尺寸) + 书名+作者+字数
- `.novellist li` 20% width float left (源站 width 20% display inline-block)
- 分页: `.bottem1` 内嵌 上一页/下一页 + 第 X 页/共 Y 页 (源站 .bottem1 a color #085308 font 14px)
- `#firendlink` 友情链接

### 4. ReadChrome.tsx (94 行)
1:1 复刻 ddyueshu.cc 章节阅读页外壳 (从 ddyueshu.css 推断):
- `.content_read > .box_con` (源站 980px width overflow hidden + 976px box border)
- `.con_top` 顶部栏 (源站 line-height 40px bg #E1ECED border-bottom 1px #88C6E5)
  - 左侧 "正文卷" + 右侧 `#page_set` 阅读设置 (源站 #page_set float right)
- `.bookname > h1` 章节标题 (源站 border-bottom 1px dashed #88C6E5 line-height 30px padding-top 10px + h1 25px/35px 居中)
- `#content` 正文区 (源站 font 19pt letter-spacing 0.2em line-height 150% padding-top 15px width 85% margin auto)
- `.bottem1` 上一章/下一章 (源站 clear both text-align center width 900px margin 5px)
- `.bottem2` 底部第二导航 (源站 border-top 1px dashed #88C6E5 clear both text-align center padding 15px)
- 交互: `onPrev`/`onNext` 调用父组件切换章节, 含 Enter/Space 键盘可达

### 5. RankingView.tsx (147 行)
1:1 复刻 ddyueshu.cc 排行榜页 (/paihangbang/, 从 .novelslist 列表模式推断):
- `#main > .novelslist` (源站 border 3px #A6D3E8 padding 3px bg #FEF9EF)
- `.novelslist h2` 标题 "小说排行榜"
- Tab 切换组 (4 个: 总点击榜/总推荐榜/字数榜/最近更新)
- `.novelslist ul li` 5 列布局 (源站 .s1 width 10%/.s2 width 20%/.s3 width 49%/.s4 width 15%/.s5 float right)
  - .s1 排名 (前 3 加 #085308 高亮) / .s2 书名 / .s3 最新章节 / .s4 作者 / .s5 字数
- `.bottem1` 分页 (上一页/下一页 + 第 X 页/共 Y 页)
- `#firendlink` 友情链接

### 6. FulltextView.tsx (135 行)
1:1 复刻 ddyueshu.cc 全本小说页 (/xiaoshuodaquan/, 从 .novellist + .novelslist 模式推断):
- `#main > .novellist` (源站 margin 10px auto width 968px padding 3px)
- `.novellist h2` 标题 "全本完本小说"
- `.novellist ul li` 20% width float left (源站 width 20% display inline-block)
  - 书名 + 作者/字数 (源站 .novellist li a:link color #6F78A7 + a:visited color red)
- 第二区: `.novelslist > .content` 精选完本推荐 (5 个大封面+简介, 源站 .top + .image + dl/dt/dd 模式)
- `.bottem1` 分页
- `#firendlink` 友情链接

### 7. SearchView.tsx (118 行)
1:1 复刻 ddyueshu.cc 搜索结果页 (从 #newscontent .l 列表模式推断):
- `#main > #newscontent` (源站 margin auto)
- `#newscontent .l` 左栏 (源站 border 3px #88C6E5 float left width 695px bg #E1ECED)
  - `h2` 标题 "搜索 X 的小说" (源站 bg #A6D3E8 height 30px)
  - 搜索 form (input + button, 源站 .header_search 风格)
  - `ul li` 5 列列表 (.s1 类别 / .s2 书名 / .s3 最新章节 / .s4 作者 / .s5 字数, 源站 width 75/165/300/90/float right)
- `#newscontent .r` 右栏 (源站 border 3px #88C6E5 float right width 265px bg #E1ECED)
  - `h2` "相关小说推荐" + `ul li` 3 列列表 (.s1/.s2/.s5, 源站 width 40/text/float right)
- `.clear` + `#firendlink`

### 8. KeywordView.tsx (130 行)
1:1 复刻 ddyueshu.cc 标签关键词页 (从 .novelslist .content 模式推断):
- `#main > .novelslist` (源站 border 3px #A6D3E8 padding 3px bg #FEF9EF width 968px)
- `h2` 标题 `"X" 相关小说`
- 3 列 `.content` 横排 (源站 border-right dotted 1px #A6D3E8 padding 0 3px float left width 315px)
  - 每个 `.content h2` 子标题 + `.top` 第 1 本大封面+简介 (源站 .image 71px + dl 219px)
  - 其余 `ul li` 48% width float left 文字列表 (源站 width 155px height 20px)
- `#firendlink` 相关关键词

## 关键设计决策
1. **CSS 全部由源站真实 class 名驱动**: 不再使用 inline style 换配色 (旧 32 行模板的做法).
   每个 div 都用源站 class (.header/.header_logo/.nav/#hotcontent/.l/.r/.item/.image/dl/dt/dd/.novelslist/.content/#newscontent/#firendlink/.footer/.content_read/.box_con/.con_top/.bookname/#content/.bottem1/.bottem2/.novellist 等),
   CloneCSSLoader 自动加载的 ddyueshu.css 选择器全部命中, 颜色/边框/布局自动生效.
2. **保留必要的 inline style 用于布局参数**: 如 width/height (BookCover 封面尺寸), display/display:inline-block (避免 Tailwind reset 干扰源站 float),
   这些不是配色, 而是源站 CSS 已隐含的浮动宽度/高度, 部分需要显式 inline 补强以匹配源站渲染.
3. **交互保留**: 所有书名锚点都用 `bookNavProps(navigate, bookId)` (含 role=button/tabIndex/onClick/onKeyDown Enter/Space);
   分类跳转用 `navigate({view:'category',cat})`; 搜索 form 用 `navigate({view:'search',q})`;
   排行榜/全本/历史分别跳 `view:'ranking'/'fulltext'/'history'`.
4. **数据来源**:
   - HomeClone: `useEffect fetch('/api/public/categories?limit=60')` 拿分类用于 nav + 分类区块标题, 解析 `d.data?.items || []`
   - 其他 7 文件: 全部用 props 传入的 books/book (由父级 BookView/CategoryView/ReadView 等已 fetch)
5. **共享 props 类型**: 全部从 `../shared` import (HomeCloneProps/BookInfoProps/CategoryListProps/ReadChromeProps/RankingViewProps/FulltextViewProps/SearchViewProps/KeywordViewProps), 不自定义类型.
6. **'use client' 首行**: 所有 8 文件首行 `'use client'`, 因为用了 useState/useEffect/onClick 等客户端能力.

## 验证结果
- `bun run lint`: **0 errors / 0 warnings** (ddyueshu 8 文件全通过; 23qb/HomeClone 和 aijjxs/BookInfo 的 lint 错误属其他 agent 任务, 不在本次范围)
- `bunx tsc --noEmit`: **0 errors** (排除 examples/ 和 skills/ 预存在错误, src/ 全通过)
- dev server log: 200 OK on `/?view=home&site=cmtpnmn1h0004p2wsqmk6xb5j`, clone-css/shipsay.css 加载 OK, /api/public/books 和 /api/public/categories 都 200 OK

## 不修改的文件 (尊重约束)
- shipsay 主题文件 (主控 R24-1A 已写好 HomeClone, 其他 shipsay 子页型尚未重写不属本任务)
- 其他 8 套主题 (aijjxs/23qb/pilishuwu/101kks/huangjinwu/ggd66/x2552/trxsw, 其他 agent 负责)
- HomeView.tsx/PublicSite.tsx/CloneCSSLoader.tsx (主控已接线)
- themes.ts (主题定义已正确)
- books route (主控已修 offset wrap)
- bits.tsx/seo.ts/ctx.tsx/BookCover.tsx/types.ts (helper 全部复用, 未动)

## Stage Summary
- 完成 8 个文件重写: HomeClone (165 行) + BookInfo (139 行) + CategoryList (124 行) + ReadChrome (94 行) + RankingView (147 行) + FulltextView (135 行) + SearchView (118 行) + KeywordView (130 行) = 1052 行 (旧 8 文件总 205 行)
- 复刻源站关键 class: #wrapper/.header/.header_logo/.header_search/.userpanel/.nav/#main/#content/#hotcontent/.l/.r/.item/.image/dl/dt/dd/.clear/.novelslist/.content/.top/#newscontent/#firendlink/.dahengfu/.footer (首页) + .content_read/.box_con/.con_top/#sidebar/#maininfo/#fmimg/#info/#intro/#list/.bottem1 (详情/阅读) + .novellist (全本) 共 30+ 真实 class
- lint/tsc 验证: 0 errors
