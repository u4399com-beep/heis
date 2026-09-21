# Task R39-1B: 4套×7页型 Go template (huangjinwu/ggd66/x2552/trxsw)

## 任务摘要
为 4 套主题 (huangjinwu, ggd66, x2552, trxsw) 各创建 7 个页型 (book, category, read, ranking, fulltext, search, keyword) 共 28 个 Go template 文件。

## 输入参考
- **shipsay 8 页型** (R38-1B 已完成): `go-backend/templates/shipsay/{book,category,read,ranking,fulltext,search,keyword,home}.html`
- **main.go** (929 行): 7 个视图查询函数 (`getBookViewData`/`getReadViewData`/`getCategoryViewData`/`getRankingViewData`/`getFulltextViewData`/`getSearchViewData`/`getKeywordViewData`) + FuncMap (`wordCount`/`statusLabel`/`fmtDate`/`fmtDateShort`/`add`/`sub`)
- **4 套主题 tsx** (28 个文件): `src/components/public/clone-themes/{huangjinwu,ggd66,x2552,trxsw}/*.tsx` 学习源站真实 DOM
- **4 套主题 home.html** (已存在, R38-1A 完成)

## 输出
- `go-backend/templates/huangjinwu/{book,category,read,ranking,fulltext,search,keyword}.html` — 7 文件
- `go-backend/templates/ggd66/{book,category,read,ranking,fulltext,search,keyword}.html` — 7 文件
- `go-backend/templates/x2552/{book,category,read,ranking,fulltext,search,keyword}.html` — 7 文件
- `go-backend/templates/trxsw/{book,category,read,ranking,fulltext,search,keyword}.html` — 7 文件

## 各主题风格保持

### huangjinwu (玻璃 header 现代风)
- header: `.header-group/.headers/.navbar/.user-dropdown/.sidebar-wrapper/.navbar-menu 7 项`
- 主体: `.main-content/.container/.breadcrumb/.detail-header/.detail-cover-wrapper/.detail-info/.detail-title/.detail-meta/.detail-actions/.btn-primary/.btn-secondary`
- 章节: `.detail-section/.detail-section-title/.chapter-list/.chapter-item`
- 列表: `.book-list/.book-list-item/.book-list-cover/.book-list-info/.book-list-title/.book-list-desc/.book-list-meta/.book-badges`
- 分页: `.pagination/.pagination-list/.page-link`

### ggd66 (复古 bookbox 网格风)
- header: `.header/.header-left/.header-right/.header-nav`
- 主体: `.breadcrumb/.content/.content-left/.content-right/.book/.bookcover/.bookinfo/.booktitle/.booktag/.red/.blue/.bookintro`
- 章节: `.chapterlist dl/dd`
- 列表: `.bookbox/.num/.p10/.bookinfo/.bookname/.author/.cat/.update`
- 阅读: `.read/h1/.booktag/#linkPrev/#linkIndex/#linkNext/.readmiddle/.readcontent/.kongwen`
- 分页: `.pages/strong/a/kbd`

### x2552 (GBK + JieQi CMS 标准布局)
- charset: `gbk`
- header: `.main.m_head/.h_logo/.h_body/.searchbox/.loginbox`
- 导航: `.main.m_menu 10 分类`
- 文章头: `#a_head/面包屑/小搜索 .so`
- 文章主体: `#a_main/dl#at/table/.grid/.even/.tips/.btnlinks/.read`
- 章节列表: `.main/.block/.blocktitle/.blockcontent/ul.update/li/ul1/ul2/more`
- 侧栏: `#right/.block/ul.ultop`
- 友链: `.main.links/ul.ulrow`
- 页脚: `.main.footer/.bdtop/.ftc`
- 分页: `.pagelink/.strong/a`
- 阅读: `.myset 字号控制/#contents 正文容器/#a_footer 上下章/.hottext 强调`

### trxsw (天人小说现代风)
- header: `.wrap/.header/.header-inner/.logo/.header-search/.header-right`
- 导航: `.nav/.nav-inner/.nav-link`
- 主体: `.breadcrumb/.breadcrumb-sep + .main/.main-content/.section/.section-title/h2/.more + .vlist/li.now`
- 详情: `.detail/.detail-cover/.detail-info/.detail-name/.detail-author/.detail-meta/.meta-item/.meta-label/.meta-value/.detail-actions/.btn-primary/.btn-outline`
- 简介: `.intro/.intro-title/.intro-content`
- 列表: `.list-item/.list-cover/.list-info/.list-title/.list-author/.list-meta/.list-desc/.list-actions/.btn-sm`
- 排行: `.tabs/.tab + .rank-list/.rank-no/.rank-cover/.rank-info/.rank-title/.rank-author/.rank-meta/.rank-desc`
- 分页: `.pager/.pager-prev/.pager-next/.pager-current/.pager-total/.pager-ellipsis`
- 侧栏: `.sidebar/.hot/.hot-list/.hot-no/.hot-title/.hot-author + .tags/.tag`
- 阅读: `h1.headline/.headline-meta + .content/.read-tools/.tool-btn`

## 关键技术细节
1. 每个文件用 `{{define "<site>/<page>"}}...{{end}}` 包裹, 路由器 main.go 的 `homeHandler` 按 `theme+"/"+view` 装配 (theme = site.ThemeID 去掉 "clone-" 前缀)
2. 全部用源站真实 class 名 (非自定义), 让 `/clone-css/<site>.css` 生效
3. 数据契约: 全部 4 套都用 `.Site/.Book/.Chapters/.RecentChapters/.Related/.FirstChapterId/.Chapter/.Prev/.Next/.CatID/.Label/.Books/.HotBooks/.Tabs/.Tab/.TabName/.Page/.PageList/.TotalPages/.Total/.Q/.Tag/.RelatedTags/.NavCats`
4. 链接统一: `/?view=book&id=`, `/?view=read&chapter=`, `/?view=category&cat=`, `/?view=ranking&sort=`, `/?view=fulltext&page=`, `/?view=search&q=`, `/?view=keyword&tag=`
5. 章节正文用 `.Chapter.content` (已是 template.HTML 类型, 由 main.go 的 `getReadViewData` 用 `template.HTML(bodyHTML)` 装配, 模板无需再转义)
6. 分页用 `{{range .PageList}}{{if eq . $.Page}}...{{end}}{{end}}` 高亮当前页 + `sub/add` 函数算上下页
7. x2552 排行/分类列表用 `.rank` 字段 (`main.go` 的 `withRank` 已注入全局序号)
8. huangjinwu `book.html` 用 `.Related` 渲染同类推荐网格
9. trxsw `book.html` 用 `.Related` 在侧栏渲染同类排行前 10 本
10. x2552 整体 charset = `gbk` (与源站一致)

## 编译确认
```bash
cd /home/z/my-project/go-backend && export PATH=$HOME/go/go/bin:$PATH && go build -o heis-backend . 2>&1 | tail -5
# EXIT=0 ✓ (binary 20210176 bytes, 包含全部 28 新模板 + 原 shipsay 8 + 5 个 home 共 41 个)
```

## 未修改的文件
- `go-backend/main.go` (R38-1B 已完成, 不碰)
- `go-backend/templates/shipsay/*` (R38-1B 已完成, 不碰)
- `go-backend/templates/{aijjxs,23qb,ddyueshu,pilishuwu,101kks}/*` (A agent 负责, 不碰)
- `src/*` (旧代码, 不碰)

## 已知预存在问题 (非本任务范围)
heis-backend 二进制运行时 `init()` 阶段在 `crawl/cleaner.go:297` panic:
`regexp: Compile(\`[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D\u2060\uFEFF]\`): error parsing regexp: invalid escape sequence: \u`

这是 R38-1C 引入的 `crawl` 包的预存在问题 (Go 1.25+ 不支持 `\u` escape 在 regexp 中), 与本任务的 28 个模板无关 — `go build` 阶段全部模板解析成功, 仅运行时 `crawl` 包 init() 失败。
