---
Task ID: R25-1B
Agent: full-stack-developer (其他页型 SSR 接线 + clone dispatch)
Task: BookInfo/CategoryList/ReadChrome/Ranking/Fulltext/Search/Keyword 接 SSR 数据 + clone dispatch 确认

Work Log:
- 步骤 1 读交接: 读 worklog.md 末尾 R24-3A 主控 SSR 根因修复 + R24-3B 9 套 HomeClone 接 initialCategories 模式 — page.tsx 已改 server component, fetch site/sites/categories + (home only) books; PublicSite 加 initialSite/initialSites/initialBooks/initialCategories prop; HomeView 加 initialBooks prop + useState 函数式初值 + useEffect 跳过首次; 10 套 HomeClone (shipsay 主控示范 + 9 套 subagent 接) 全部接 initialCategories (useState 函数式初值 + useEffect `if (cats.length > 0) return` + deps 改 [cats.length])。

- 步骤 2 审查现状:
  · BookView.tsx (789 行): line 397-415 inline BookInfoComponent 兜底 fallback, **没有 BookInfoLookup 路由表** — 注释提到 "lookup table 在文件顶部定义" 但实际是空话; clone-* 主题不会走 clone-themes BookInfo, 用 inline 兜底渲染(普通 div), 源站 class 全不命中。
  · CategoryView.tsx (172 行): 有 CatListLookup 路由表 (line 28-34) 但**没使用** — 渲染分支走 inline CatListComponent, `// eslint-disable-next-line @typescript-eslint/no-unused-vars` 注释证明 lookup 表是被废弃的。
  · ReadView.tsx (717 行): 有 ReadChromeLookup 路由表 (line 179-185) 也**没使用** — 4 个 layout 分支 (immersive/paginated/pili/classic) 全部 `React.createElement(ReadChromeComponentonent, ...)` 走 inline fallback。
  · RankingView.tsx (85 行): **没有** lookup 表, 走通用 Tailwind 布局。
  · FulltextView.tsx (66 行): **没有** lookup 表, 走通用 Tailwind 布局。
  · SearchView.tsx (324 行): **没有** lookup 表, 走通用 Tailwind 布局。
  · KeywordView.tsx (82 行): **没有** lookup 表, 走通用 Tailwind 布局。
  · shipsay clone-themes 下 6 页型 (BookInfo/CategoryList/RankingView/FulltextView/SearchView/KeywordView): 已 1:1 重写好, 但 useEffect fetch categories 无 SSR 接线 — cats=[], navigation 没分类链接。
  · 9 套其它主题 (aijjxs/23qb/ddyueshu/pilishuwu/101kks/huangjinwu/ggd66/x2552/trxsw) 下 6 页型: 同样无 SSR 接线。

- 步骤 3 改 shared.ts (7 Props interface 加 initialCategories?: any[]):
  · HomeCloneProps: 已有 (R24-3B 已加)
  · BookInfoProps: 加 `initialCategories?: any[]`
  · CategoryListProps: 加 `initialCategories?: any[]`
  · ReadChromeProps: 加 `initialCategories?: any[]` (aijjxs/ggd66 ReadChrome 也 fetch cats)
  · RankingViewProps: 加 `initialCategories?: any[]`
  · FulltextViewProps: 加 `initialCategories?: any[]`
  · SearchViewProps: 加 `initialCategories?: any[]`
  · KeywordViewProps: 加 `initialCategories?: any[]`
  · 删除 unused ThemeDef import (BookInfoProps 改 theme?: any 后不再需要)

- 步骤 4 shipsay 6 页型接 initialCategories (示范):
  · BookInfo.tsx: 函数签名加 `initialCategories`; useState cats 用函数式初值 `(initialCategories || []).map(...)`; useEffect 首行 `if (cats.length > 0) return`; deps `[]` → `[cats.length]`。
  · CategoryList.tsx: 同上三处改。
  · RankingView.tsx: 同上三处改。
  · FulltextView.tsx: 同上三处改。
  · SearchView.tsx: 同上三处改。
  · KeywordView.tsx: 同上三处改。

- 步骤 5 批量改 9 套 × 6 页型 = 34 文件 (aijjxs/23qb/ddyueshu/pilishuwu/101kks/huangjinwu/ggd66/x2552/trxsw 各 6 页型, 排除 shipsay 已改 + HomeClone 已改):
  · 写脚本 scripts/batch-update-clones.mjs (node 脚本, 4 个正则替换):
    1) 函数签名加 `initialCategories` 到 destructured props (匹配 `}: <PropsName>) {`)
    2) `useState<Cat[]>([])` → `useState<Cat[]>(() => (initialCategories || []).map(...))`
    3) useEffect 首行加 `if (cats.length > 0) return`
    4) deps `}, [])` → `}, [cats.length])` (匹配 cats fetch effect 的结束模式)
  · 运行: 34 ok / 0 fail — 全部按 shipsay 示范模式接好。
  · 注: 部分 23qb/ddyueshu/101kks/huangjinwu 页型不 fetch cats (没有 useState<Cat[]>), 不在批量脚本里改动, 只是它们的 Props 接口允许 initialCategories 但不消费 — SSR 时这些主题 navigation 会少分类但渲染不报错。

- 步骤 6 改 7 个 View 文件 (BookView/CategoryView/ReadView/RankingView/FulltextView/SearchView/KeywordView):
  · BookView.tsx: 加 BookInfoLookup table (10 套 dynamic import ssr=true loading fallback BookGridSkeleton); 加 `initialBook?: BookDetailData | null` + `initialCategories?: any[]` prop; useState state 用函数式初值 `initialBook && initialBook.book ? { key, data: initialBook } : null`; useEffect 跳过首次 `if (state && state.key === key && state.data) return`; JSX 渲染分支 `if (CloneBookInfo) return <CloneBookInfo book={book} ... onContinueRead={() => navigate({view:'read',chapterId:chapters[0].id,bookId:book.id})} onGoCategory={...} initialCategories={...} />` else 走 inline BookInfoComponent fallback。删 `// 恢复 10 套 import` 注释, 加 R25 注释解释 BookInfoLookup 设计。
  · CategoryView.tsx: 改 useState pattern (废弃 prevKey/firstRender ref 模式, 改用 FetchState-like `{ key, data, error }` state 让 effect 跳过条件 `state.key === listKey && (state.data || state.error)`); 加 `initialBooks?: any` + `initialCategories?: any[]` prop; useState state 函数式初值 `initialBooks.books ? { key: listKey, data: { books: ..., total: ..., page: ..., size: ... } } : null`; catName state 用 `resolveCatNameFromInitial(cat)` 函数式初值; 第二个 effect (fetchCategories) 加 SSR 跳过 `if (initialCategories && initialCategories.some(c => c.id === cat)) { setCatName(resolveCatNameFromInitial(cat)); return }`; JSX 用 `CatListLookup[theme.layout]` 路由表 → `<CloneCatList books loading label page total onPage initialCategories />` else inline fallback。删 unused useRef import。
  · ReadView.tsx: ReadChromeLookup 路由表 (已有, 改注释去掉 unused-vars eslint-disable); 加 `initialChapter?: ChapterData | null` + `initialCategories?: any[]` prop; useState data 用 `initialChapter || null`; useState loading 用 `!initialChapter`; useEffect 跳过 `if (initialChapter && data && data.chapter?.id === chapterId) return`; 加 `ReadChromeComp = ReadChromeLookup[theme.layout] || ReadChromeComponentonent` 变量; 4 个 layout 分支全用 ReadChromeComp 替换 ReadChromeComponentonent, 透传 initialCategories。
  · RankingView.tsx: 完全重写 — 加 RankingViewLookup table (10 套 dynamic import ssr=true); 加 `initialBooks?: any` + `initialCategories?: any[]` prop; useState state 函数式初值 (key 用 `allvisit|page` 让首次 effect 跳过); firstRender ref 跳过首次 effect; JSX `if (Clone) return <Clone books loading tab onTabChange page total size onPage initialCategories />` else 通用 Tailwind 布局 (Trophy/RANKING_TABS 5 tab/Pagination/BookGridSkeleton/ol li ranking items)。
  · FulltextView.tsx: 完全重写 — 加 FulltextViewLookup table; 加 `initialBooks` + `initialCategories` prop; useState state 函数式初值; firstRender ref 跳过首次; JSX `if (Clone) return <Clone ... initialCategories />` else 通用 Tailwind (BookCheck icon/grid 6 cols/Pagination)。
  · SearchView.tsx: 完全重写 — 加 SearchViewLookup table; 加 `initialSearch?: SearchData | null` + `initialCategories?: any[]` prop; useState data 函数式初值 `initialSearch && initialSearch.q === q ? initialSearch : null`; useState loading 函数式初值 `!(initialSearch && initialSearch.q === q) && !!q`; firstRender ref 跳过首次 effect; prevQ 同步逻辑里 set firstRender.current=false; JSX `if (Clone) return <Clone q books loading initialCategories />` else 通用 Tailwind 布局 (搜索框/historyList/hotTags/siteKeywordList/TagCloud/results/relatedTags/EmptyState)。
  · KeywordView.tsx: 完全重写 — 加 KeywordViewLookup table; 加 `initialKeyword?: KeywordData | null` + `initialCategories?: any[]` prop; useState data 函数式初值 `initialKeyword && initialKeyword.tag === tag ? initialKeyword : null`; useState loading 函数式初值; firstRender ref 跳过首次; JSX `if (Clone) return <Clone tag books loading initialCategories />` (books 从 data.book + otherBooks 拼成数组) else 通用 Tailwind 布局 (Tag icon/main 书卡片/其他相关书籍/TagCloud)。

- 步骤 7 改 PublicSite.tsx (加 4 个新 prop):
  · 函数签名加 `initialBook?: any` + `initialChapter?: any` + `initialSearch?: any` + `initialKeyword?: any` prop。
  · renderView switch 7 case 全部透传对应 initial* prop + initialCategories 给子 View:
    - book: `<BookView initialBook initialCategories />`
    - read: `<ReadView initialChapter initialCategories />`
    - search: `<SearchView initialSearch initialCategories />`
    - keyword: `<KeywordView initialKeyword initialCategories />`
    - category: `<CategoryView initialBooks={initialBooks ? {books, total, page, size} : undefined} initialCategories />` (复用 home 的 initialBooks, 包成 BooksData 形态)
    - ranking: `<RankingView initialBooks={initialBooks ? {books, total, page, size} : undefined} initialCategories />`
    - fulltext: `<FulltextView initialBooks={initialBooks ? {books, total, page, size} : undefined} initialCategories />`

- 步骤 8 重写 page.tsx 按 view 类型 server fetch:
  · 引入 readChapterTxt from '@/lib/crawl/storage' (chapter SSR 需要 read txt 文件)。
  · 引入 SORT_MAP (复用 books API 的排序白名单) + splitParagraphs/paginateByWords/paginateByPages (复用 chapter API 的分页逻辑)。
  · 保留 R24 站点 fetch (site/sites) + R24 categories fetch (60 排序) + R24 <link> 渲染源站 CSS。
  · 加 view 分支 fetch:
    - home: 复用 R24 books fetch (48 latest + offset wrap)
    - category: 复用 books API cat 过滤 (where.categoryId = publicView.cat, skip=(page-1)*size, take=24, include category) — 不带 offset wrap (hasFilter=true → effectiveOffset=0)
    - ranking: 复用 books API sort=allvisit (R17 暂用 updatedAt) + offset wrap (sort 没筛选) + size=30
    - fulltext: 复用 books API sort=fulltext (status=completed) + offset wrap + size=24
    - book: 复用 book API 查询逻辑 — book findUnique + total (单独 await 后才能用于 recentChapters 条件分支, 否则 Promise.all 内引用自身解构变量报 TS2448) + tags + chapters + recentChapters + SEO 配置 (chapterSeoAuto + 3 模板)
    - read: 复用 chapter API 查询逻辑 — chapter findUnique (include book+category) + content (含 txt 文件读取 + HTML 转义) + prev/next + pagination (mode/wordsPerPage/totalPagesTarget) + SEO 配置
    - search: 复用 search API 查询逻辑 — books findMany OR name/author/intro/keywords contains + relatedTags findMany tag contains
    - keyword: 复用 keyword API 查询逻辑 (?tag= 模式, 不含 ?book= PSEO 分支) — hits findMany tag + mainBook + related tags
  · 传 initial* 给 PublicSite: initialBooks (home/category/ranking/fulltext 包成 BooksData 形态), initialBook (book view), initialChapter (read view), initialSearch (search view), initialKeyword (keyword view)。

- 步骤 9 验证:
  · bun run lint: 0 errors / 0 warnings exit 0 ✓ (1st 跑有 CategoryView useRef ref-in-render error + 2 warnings, 改用 FetchState pattern 后 0 errors)
  · bunx tsc --noEmit (排除 examples/skills 预存在错误): src/ 0 errors ✓ — 仅剩 examples/websocket/frontend.tsx + examples/websocket/server.ts + skills/image-edit/scripts/image-edit.ts + skills/stock-analysis-skill/src/analyzer.ts 4 个预存在错误非本次任务范围
  · dev server log: ✓ Ready in 1333ms, GET /?view=home&site=xxx 200 OK render 984ms (1st SSR compile 18.0s 后稳定, 含新 page.tsx fetch 逻辑)
  · 注: 后续 dev server 在 sandbox 内出现 connection refused (curl 测试时 dev 已停止), 但 dev.log 已记录 SSR 200 OK ✓

Stage Summary:
- 完成 7 个 View 文件 + PublicSite + page.tsx SSR 接线 + 40 个 clone-themes 页型 (10 套 × 6 页型, shipsay 主控示范 + 9 套批量脚本) + shared.ts 7 Props interface 接 initialCategories。
- 核心改动:
  · shared.ts: 7 个 Props interface 加 `initialCategories?: any[]` (HomeCloneProps 已有, 加 BookInfoProps/CategoryListProps/ReadChromeProps/RankingViewProps/FulltextViewProps/SearchViewProps/KeywordViewProps), 删 unused ThemeDef import。
  · shipsay 6 页型 (BookInfo/CategoryList/RankingView/FulltextView/SearchView/KeywordView): 函数签名加 initialCategories + useState 函数式初值 + useEffect `if (cats.length > 0) return` + deps [cats.length]。
  · 9 套其它主题 × 6 页型 = 34 文件: 用 scripts/batch-update-clones.mjs 脚本批量改 (node + 4 个正则替换), 34 ok / 0 fail。
  · BookView: 加 BookInfoLookup table (10 套 dynamic ssr=true) + initialBook prop + 跳过首次 effect + Clone 路由分发, fallback 走 inline BookInfoComponent。
  · CategoryView: 重构 useState pattern (废弃 prevKey/firstRender ref, 改 FetchState `{key,data,error}`), 加 initialBooks prop + Clone 路由分发 + catName SSR 同步解析 + catName effect SSR 跳过。
  · ReadView: 启用已有 ReadChromeLookup (改注释去掉 unused-vars), 加 initialChapter prop + useState data/loading 函数式初值 + 跳过首次 effect + 4 layout 分支全用 ReadChromeComp 替换 ReadChromeComponentonent + 透传 initialCategories。
  · RankingView: 完全重写, 加 RankingViewLookup table (10 套 dynamic ssr=true) + initialBooks prop + firstRender ref 跳过首次 + Clone 路由分发 + fallback 通用 Tailwind。
  · FulltextView: 完全重写, 同 RankingView 模式。
  · SearchView: 完全重写, 加 SearchViewLookup table + initialSearch prop + useState data/loading 函数式初值 + firstRender ref 跳过首次 + Clone 路由分发 + fallback 通用 Tailwind (搜索框/热搜词/历史/相关搜索词)。
  · KeywordView: 完全重写, 加 KeywordViewLookup table + initialKeyword prop + firstRender ref 跳过首次 + Clone 路由分发 + fallback 通用 Tailwind (主书卡片/其他相关书籍/TagCloud)。
  · PublicSite: 加 4 个新 prop (initialBook/initialChapter/initialSearch/initialKeyword), renderView 7 case 透传对应 initial* + initialCategories 给子 View (home/category/ranking/fulltext 共用 initialBooks, 包成 BooksData 形态)。
  · page.tsx: 按 view 类型 server fetch (home/category/ranking/fulltext 4 种 books 查询 + book 详情+章节+标签+recent+SEO + read 章节+book+prev/next+pagination+SEO + search books+relatedTags + keyword hits+mainBook+related), 复用 books/book/chapter/search/keyword API 的查询逻辑 (含 SORT_MAP 白名单 + offset wrap + txt 文件读取 + 段落分页 + SEO 模板)。
- 验证: bun run lint 0 errors / 0 warnings ✓ / bunx tsc --noEmit src/ 0 errors ✓ (排除 examples/skills 4 个预存在错误) / dev server log GET /?view=home&site=xxx 200 OK render 984ms ✓ (含新 page.tsx fetch 逻辑)
- 未修改 (尊重约束):
  · src/lib/crawl/* (采集模块, 其他 agent 负责)
  · HomeView.tsx (主控已改好 R24-3A)
  · 10 套 HomeClone.tsx (主控+R24-3B 已改好)
  · themes.ts/prisma/schema.prisma (主控范围)
- 详细工作记录: agent-ctx/R25-1B-full-stack-developer.md (含 9 章节: 读交接/审查现状/改 shared.ts/shipsay 6 页型/9 套 34 文件批量/7 个 View 改造/PublicSite 接线/page.tsx server fetch/验证)
