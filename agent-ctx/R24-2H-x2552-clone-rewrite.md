# R24-2H — x2552 主题 1:1 重写工作记录

## Task
重写 x2552 全套 8 页型 (位于 `src/components/public/clone-themes/x2552/`) 为真正 1:1 克隆 x2552.com 吾爱文学网真实 DOM。

## 步骤 1: 读交接文档
- `tail -n 400 worklog.md` 确认 R24-1A 主控已完成 shipsay/HomeClone 1:1 示范 + HomeView 接线 (clone-* 完全接管首页) + books API offset wrap-around + categories 解析多层兜底 + dev server NODE_OPTIONS=8192 启动
- R24-2A/B/C/D/E/F 同辈已完成 aijjxs (299 行 HomeClone) / 23qb (8 文件含详细 class 清单) / ddyueshu (1052 行) / pilishuwu (2505 行 8 文件) / 101kks (1564 行) / huangjinwu (1786 行)
- 参考 R24-2A aijjxs (简洁清晰, 16 默认分类) + R24-2D pilishuwu (源站无 probe 时按模板构造)

## 步骤 2: 读参考样本
- `agent-ctx/probe-html2/probe-x2552.html` (27KB, GBK 编码源站真实抓取): 提取首页真实 DOM
  - 顶部: `.main.m_head` (`.h_logo.fl` img + `.h_body.fl` 第一行 p 简繁切换/设为首页/联系/收藏 + 第二行 `form#articlesearch` 含 input#searchtype hidden + `dl.fl.searchbox` dt(i+input searchkey) + dd(a.so_book + a.so_author) + `dl.fr.loginbox` dd 欢迎您登录注册) + `.cl` 清浮动
  - 导航: `.main.m_menu` `ul` (li.m_ml 占位 + li a 吾爱首页 + 10 个 li a 分类 [玄幻魔法/武侠修真/都市言情/历史军事/侦探推理/网游动漫/科幻小说/恐怖灵异/文学名著/其他] + li a 全本 + li.m_bc a 书架 + li.m_mr 占位)
  - 公告: 红框 div 1px solid #E4E4E4 color:red 960px line-height:25px 文案
  - 排行榜: `.main.board` (`.bdtop` + `.bdsub` `dl#s_dl` `dt` `p#s_dt` a.current 分页点 + 文字 "{站名}排行榜" + `abbr` `bdo#s_dd` 6 个 `dd` (a > img 120x150 + br + a 书名))
  - 中心: `.main` `#centeri` 760px 左 (`.block` ` .blocktitle` i + 文字 + `.blockcontent` `ul.update` li × 36 (`p.ul1` a[分类] + 《a.poptext[书名]》 + `p.ul2` a[章节] + p[作者] + 日期) + li.more a 更多) + `#right` 190px 右 (`.block` 总推荐榜 `ul.ultop` li × 15 (`p` 推荐数 + a 书名) + li 更多 + `.block` 最新小说 `ul.ultop` li × 15 (`p` 日期 + a 书名) + li 更多)
  - 友链: `.main.links` (`.block` ` .blocktitle` 友情链接 + `.blockmore` a 更多 + `.blockcontent` `ul.ulrow` li × N a)
  - 页脚: `.main.footer` (`.bdtop` i + span + `.ftc` 版权文案)
- `public/clone-css/x2552.css` (20KB): 由 CloneCSSLoader 自动加载, 关键 selectors 30+ 个 (.main/.m_head/.h_logo/.h_body/.searchbox/.searchbox dt/.searchbox dt i/.searchbox dt input/.searchbox dd/.so_book/.so_author/.loginbox/.m_menu/.m_menu li/.m_ml/.m_mr/.m_bc/.board/.bdtop/.bdsub/.board dl/.board dt/.board dt p/.current/.board bdo/.board dd/.board dd img/#centeri/#right/#left/.block/.blocktitle/.blocktitle span/.blocktitle i/.update/.update li/.update p/.ul1/.ul2/.ultop/.ulitem/.ulcenter li/.more/.links/.links .block/.links .blocktitle/.links .blockmore/.links .blockcontent/.ulrow/.footer/.footer .bdtop/.footer .ftc/.pagelink/.pagelink */.pagelink strong/.pagelink kbd/.pagelink em/.pagelink input/#a_head/#a_head ul/#a_head li/#a_head .so/#a_head .so input/#a_head .so a/#a_main/#a_main dt/#a_main #at/#a_main #at */#a_main #at td/#a_main #at th/.btnlinks/.btnlinks a/.btnlinks .read/.tags/.tips/.hottext/.myset/#contents/#a_footer/.jia/.mobile/table/td,th/.grid/.even/.odd)
- `shipsay/HomeClone.tsx` (180 行, 主控 R24-1A 示范) + `aijjxs/HomeClone.tsx` (299 行, R24-2A) + `pilishuwu/HomeClone.tsx` (470 行, R24-2D) 参考 helper 用法 (usePublic/bookNavProps/formatWords/BookCover) + 源站 probe 缺失时的模板构造思路
- 注: x2552 没有子页 probe, 从首页 DOM + JieQi CMS 标准模板推断子页结构

## 步骤 3: 提取 x2552 真实 DOM (从 probe HTML + CSS 反查 30+ class)
- 顶部: `.main.m_head` / `.h_logo.fl` / `.h_body.fl` / `dl.fl.searchbox` / `dt` `i` + `input searchkey` / `dd` `a.so_book` + `a.so_author` / `dl.fr.loginbox` `dd` 欢迎登录注册
- 导航: `.main.m_menu` `ul` `li.m_ml` + `li` a + `li.m_mr` + `li.m_bc` a (源站 10 分类 + 全本 + 书架)
- 排行榜 carousel: `.main.board` `.bdtop` + `.bdsub` `dl#s_dl` `dt` `p#s_dt` a.current (JS wamccshow 切换 6 张) + `abbr` `bdo#s_dd` `dd` a > img + br + a 书名
- 中心区: `.main` `#centeri` (760px) + `#right` (190px) 双栏 float 布局
- 列表: `.block` `.blocktitle` i + 文字 / `.blockcontent` `ul.update` li (`p.ul1`/`p.ul2`/p[作者]/日期) / `ul.ultop` li (p[数字]+a) / `li.more` 更多
- 友链: `.main.links` `.block` `.blocktitle`/`.blockmore`/`.blockcontent` `ul.ulrow` li × N
- 页脚: `.main.footer` `.bdtop` i+span + `.ftc` 版权 + `a` 网站地图
- 书页: JieQi 标准 `#a_head` (ul li 面包屑 + `.so` input + a 搜索) / `#a_main` `dl#at` `dt` h1 + `table` (td.grid 封面 + td.even 元信息 p×5 + .btnlinks 操作按钮 + .tips 简介)
- 阅读页: JieQi 标准 `#a_main` `.myset` (字号 A-/A+ + 阅读设置) + `h1` 章节标题 + `#contents` 正文 (padding:25px line-height:26px font-size:14px) + `.btnlinks` 上下章 + `#a_footer` 上下章 + 返回书页
- 分页: `.pagelink` (border 1px + 背景 #F2F2F2 + strong 当前页 #ff6600 橙色)
- 表格: `table` (border 1px solid #E4E4E4 margin 10px width 98%) + `td,th` (border-bottom 1px dotted #E4E4E4 padding 0 3px) + `#a_main #at` (margin 15px 0 0 18px width 920px line-height 25px border 0)
- 文字色: a #2f468f 蓝紫链 + a:hover #ff6600 橙 hover + `.hottext` 橙强调 + `.red` 红色公告

## 步骤 4: 重写 8 文件 (全部位于 `src/components/public/clone-themes/x2552/`, 总 2167 行, 从旧 8 文件总 ~205 行扩展 10x)
- `HomeClone.tsx` (297 行): 完整复刻源站首页 (.main.m_head + .main.m_menu + 公告红框 + .main.board 6 张大封面 carousel + .main #centeri ul.update 36 行 + #right 双 block ul.ultop 各 15 条 + .main.links ul.ulrow + .main.footer)
- `BookInfo.tsx` (394 行): 复刻源站书页 (.main.m_head + .main.m_menu 当前分类高亮 + #a_head 面包屑小搜索 + #a_main dl#at dt h1 + table tr td.grid 封面 + td.even 元信息 5 行 + .tags 标签 + .tips 简介 + .btnlinks 4 按钮 + .main .block 章节列表 ul.update + #right 双 block 推荐/最新榜 + .main.links + .main.footer)
- `CategoryList.tsx` (256 行): 复刻源站分类页 (.main.m_head + .main.m_menu 当前分类 current + 公告红框 + .main .block .blocktitle + .blockcontent table thead 类别/书名/最新章节/作者/字数/更新 + tbody tr × N + .pagelink 分页 + 友链页脚)
- `ReadChrome.tsx` (214 行): 复刻源站阅读页 (.main.m_head + .main.m_menu 简版分类 + #a_head 面包屑 + #a_main .myset 字号 A-/A+/回顶部/返回书页 + h1 章节标题 + #contents 正文 children + .btnlinks 上下章 + #a_footer 上下章 + 返回书页 + 友链页脚)
- `RankingView.tsx` (276 行): 复刻源站排行榜页 (.main.m_head + .main.m_menu + 公告红框 + .main .block .blocktitle + inline 4 tab 排序 (最近更新/总推荐/总点击/最新入库) + .blockcontent table thead 排名/类别/书名/最新章节/作者/字数/更新 + .pagelink 分页 + 友链页脚)
- `FulltextView.tsx` (253 行): 复刻源站全本页 (与 RankingView 同模式, 标题 "{站名}全本小说列表", .m_menu 全本 active, thead 类别/书名/最新章节/作者/字数/状态)
- `SearchView.tsx` (227 行): 复刻源站搜索页 (.main.m_head 搜索框 defaultValue={q} 预填 + .main .block .blocktitle "搜索 q 的结果列表" + table thead 类别/书名/最新章节/作者/字数/更新 + 空态友好 "未找到 X 相关的书籍")
- `KeywordView.tsx` (250 行): 复刻源站标签页 (与 SearchView 同模式, 标题 "标签 tag 的相关小说列表" + 底部 .tags 行相关标签 16 个从 books.category 拆分不重复)

## 步骤 5: 关键设计
- 全部用源站真实 class 名 (30+ 个, 让 CloneCSSLoader 加载的 x2552.css 全部选择器命中)
- 不再使用 inline style 换配色 (旧 32 行模板做法 C={primary:'#2f468f',...}); 仅保留必要的尺寸参数 (BookCover width/height, 站名 span fontSize/color 用于替代缺失的 logo 图片, 公告红框 border/color 与源站一致)
- 保留交互: bookNavProps(navigate, b.id) 跳书页 (含 role/tabIndex/onKeyDown Enter/Space); navigate({view:'category',cat}) 跳分类; navigate({view:'search',q}) 搜索; navigate({view:'ranking'|'fulltext'|'history'|'home'|'keyword',tag}) 各功能跳转; BookInfo 用 onContinueRead/onScrollToc/onGoCategory props; ReadChrome 用 onPrev/onNext props; RankingView 用 onTabChange/onPage props; CategoryList/FulltextView 用 onPage props
- 数据: HomeClone/BookInfo/CategoryList/RankingView/FulltextView/SearchView/KeywordView 内部 useEffect fetch /api/public/categories?limit=60 解析 d.data?.items || d.data?.categories || d.items || d.categories || [] (fetch 失败用 DEFAULT_NAV 10 个分类兜底, 与源站 m_menu 顺序一致: 玄幻魔法/武侠修真/都市言情/历史军事/侦探推理/网游动漫/科幻小说/恐怖灵异/文学名著/其他); BookInfo 内部 fetch /api/public/books?cat=&size=15&sort=hot 拉同分类前 15 本作"总推荐榜 + 最新小说"侧栏 (排除当前书); ReadChrome 用 children prop 包裹章节正文
- DEFAULT_NAV 10 个分类兜底: id 与源站 URL /list/{id}_1.html 路径模式一致 (1-10)
- 'use client' 首行: 所有 8 文件 (用了 useState/useEffect/onClick/navigate 等客户端能力)
- 排行榜 carousel 还原: 源站 JS wamccshow() 切换 6 张封面 + p#s_dt a.current 分页点, 这里静态只显示一页 (6 本) + rankPages 个分页点 a.current 第一页
- 公告红框还原: 960px width + 1px solid #E4E4E4 + color red + line-height 25px + margin 5px auto + 文案 1/2 (与 probe 一致)
- 表格列表: JieQi CMS 标准 table (类别/书名/最新章节/作者/字数/更新 6 列 + 排行榜页加 排名列 7 列), thead 默认色 (#E4EBF1 浅蓝灰背景)
- .pagelink 分页: 源站风格 (上一页/页码/下一页 + 第一页/最后页 + 当前页 strong 橙色)

## 步骤 6: 验证
- `bun run lint`: 第 1 轮 7 errors (CategoryList/KeywordView/RankingView/SearchView 的 statusLabel 未用 + FulltextView 的 fmtDateShort 未用 + HomeClone 的 formatWords 未用 + HomeClone 的 i 未用) → 全部修复 (移除未用 import, voteCount(b) 改为 voteCount(b, i) 使用 i 参数)
- 第 2 轮 lint: 0 errors / 0 warnings exit 0 ✓
- `bunx tsc --noEmit` (排除 examples/skills): 第 1 轮 BookInfo line 215 book.categoryId 类型 string | null 不能赋给 string | undefined → 改为 book.categoryId || undefined
- 第 2 轮 tsc: src/ 0 errors ✓
- dev server log: 多次 ✓ Compiled in XXXms, clone-css 加载 OK, /api/public/categories 200 OK, /api/public/books 200 OK, 无 x2552 相关编译错误

## 不修改的文件 (尊重约束)
- shipsay/aijjxs/23qb/ddyueshu/pilishuwu/101kks/huangjinwu 主题 (主控 + 其他 agent 已重写好, 全部未动)
- 其他 2 套主题 (ggd66/trxsw, 其他 agent 负责, 全部未动)
- HomeView.tsx/PublicSite.tsx/CloneCSSLoader.tsx/themes.ts/books route (主控已接线)
- bits.tsx/seo.ts/ctx.tsx/BookCover.tsx/types.ts/shared.ts/helper 全部未动
- prisma/schema.prisma 未动
- 未安装新 npm 包 (0 新依赖)
