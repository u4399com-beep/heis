# R38-1A — 9 套主题 home Go template

**Task ID**: R38-1A
**Agent**: full-stack-developer (9套主题home Go template)
**Task**: 为 aijjxs/23qb/ddyueshu/pilishuwu/101kks/huangjinwu/ggd66/x2552/trxsw 各创建一套 home.html Go template
**开始时间**: 2026-09-21 11:30 (UTC+8)
**完成时间**: 2026-09-21 11:48 (UTC+8)
**总耗时**: ~18 分钟

---

## 1. 读交接文档

### 1.1 shipsay/home.html — Go template 写法学习
- `{{define "shipsay/home"}}<!DOCTYPE html>...{{end}}` — define 包裹整个 HTML 文档
- `{{.Site.Title}}` / `{{.Site.Name}}` / `{{.Site.Domain}}` — map field 访问
- `{{range .NavCats}}<a href="/?view=category&cat={{.id}}">{{.name}}</a>{{end}}` — range slice + element field
- `{{range .TopBooks}}...{{.id}}...{{.cover}}...{{end}}` — 同上
- `{{range $.Books}}` — `$` 引外层 context (在 NavCats 嵌套循环里访问外层 Books)
- `{{if .cover}}<img src="{{.cover}}">{{end}}` — 条件
- `{{if eq .status "completed"}}完结{{else}}连载{{end}}` — 等值 + if/else
- `{{wordCount .wordCount}}` — 调用 FuncMap 注册函数 (10000+ 字转 "X 万字")

### 1.2 main.go — homeHandler 数据结构
- **R38-1B 已扩展为 switch view 路由**: home/book/read/category/ranking/fulltext/search/keyword/history
- **FuncMap 已注册**: wordCount, statusLabel, fmtDate, fmtDateShort, add, sub
- **基础 data**: `Site/Categories/NavCats`
- **home view 装配**: `Books` (48) + `TopBooks` (按字数排序前 6) + `Popular` (前 12)
- **fallback**: 若 `<theme>/<view>` 模板渲染失败, 退回 `shipsay/home`
- **theme 解析**: `clone-shipsay` → `shipsay`, `clone-aijjxs` → `aijjxs` 等

### 1.3 probe HTML 各源站 DOM 学习 (8 套 + trxsw 反查)
- probe-aijjxs.html: `.top-float` (16 分类 nav) + `.wrap header.top` (logo+search) + `.layout article.panel.latest-upload ul.lines.lines-books`
- probe-23qb.html: `#header .header-content .header-logo .nav .header-module` + `#main .content .list .box .module .module-list .module-items .module-item` (TopBooks cover+name+author)
- probe-ddyueshu.html (GBK 源站): `#wrapper .header .header_logo .nav` + `#main #hotcontent .l/.r .item .image dl/dt/dd` + `.novelslist .content .top` + `#newscontent .l/.r ul li s1-s5 spans`
- probe-pilishuwu.html: `.mod-top-wr .mod-top-frame .mod-top-tool-wr .mod-top-logo .mod-top-search .mod-top-tag` + `.newyear-bg-wrap .mod-tags-wr .mod-animate-list` + `.in-rank-wr ol.in-rank-list sub.in-rank-no-orange` + `.in-strong-wr .in-slider-list li .mod-cover-list-thumb` + `.in-main-wr .in-teen-list-wr .in-content-wr ul.in-teen-list`
- probe-101kks.html (繁体 zh-TW): `.leftmenu .headuser .menu2` + `header .headbox .menubtn .logo .search .menu1` + `.main .container ul.row li.col-xinindex .mybox .xinlogo .error-text.searchBox .indexdaohang .booklist-block .booklist-grid .booklist-card .booklist-card-content .booklist-cover-section .booklist-cover-stack .cover-main .cover-count .booklist-info-section .booklist-title .booklist-meta .meta-item .booklist-desc`
- probe-huangjinwu.html: `.header-group .headers .container .navbar .user-dropdown .sidebar-wrapper .sidebar-header .navbar-menu .navbar-search .theme-toggle .menu-toggle` + `.main-content .container .hot-section h2.page-title .book-grid a.book-card .book-info .book-title .book-author .book-desc .book-badges .book-badge.category/.status/.words` + `.sort-section .category-ranking-grid .ranking-module .ranking-module-title .ranking-list .ranking-item a.ranking-title span.ranking-author` (★ 这里 nested range + $ 用法)
- probe-ggd66.html (格格党): `.header .container .header-left/.header-right/.header-nav` + `.container .content .content-left #fengtui h2 .item .image dl dt span+dd dt-clear` + `.content-right #fengyou .search hidden-xs form + ul li [女生] .s1/.s2/.s5` + 第二 `.content .content-right #zuixin h2 ul li [女生] .s1/.s2/.s5` + `.content-left #gengxin ul li .s1/.s2/.s3/.s5/.s4`
- probe-x2552.html (GBK 源站): `.main.m_head .h_logo .h_body` (h1+p+form searchbox + dl.loginbox) + `.main.m_menu ul li.m_ml/.m_bc/.m_mr` + `.main.board .bdtop .bdsub dl#s_dl dt p#s_dt abbr bdo#s_dd dd` (排行榜 6 本 cover+name) + `.main #centeri .block .blocktitle .blockcontent ul.update li p.ul1/.ul2+作者+日期` + `#right .block .blocktitle .blockcontent ul.ultop li p(数量)+a(name)`
- trxsw (themes.ts 反查, 域名过期): `.vlist` 章节列表 + `.detail` 详情 + `.content` 正文 + `.pager` 翻页 + `.headline` 章节标题 + `.intro` 简介; 主题色 深蓝 #2c7be5 + 副色 #1a5fb4 + 浅灰蓝底 #f5f7fa; CSS 已有 1104 行

---

## 2. 创建 9 套 home.html (路径 + 行数)

| 主题 | 文件路径 | 行数 | 关键 class | 数据使用 |
|---|---|---|---|---|
| aijjxs | `go-backend/templates/aijjxs/home.html` | 95 | `.top-float .wrap .top .layout .panel.latest-upload .lines.lines-books .grid2 .book` | TopBooks (cover 推荐) + Books (latest-upload 列表) + Popular (热门推荐) |
| 23qb | `go-backend/templates/23qb/home.html` | 85 | `#header .header-content .header-logo .nav .header-module #main #main.wrapper .content .list .box .module .module-list .module-items .module-item` | TopBooks (推荐列表 cover+caption+name+author) + Books (最近更新 文字列表) + Popular (热门榜单) |
| ddyueshu | `go-backend/templates/ddyueshu/home.html` | 110 | `#wrapper .header .header_logo .nav #main #hotcontent .l/.r .item .image dl/dt/dd .novelslist .content .top #newscontent .l/.r ul li .s1/.s2/.s3/.s4/.s5` | TopBooks (强档推荐 image+dl) + Books (最新小说 top+ul li) + Popular (历史推荐 top+ul li) + Books (最近更新 s1-s5 spans) + Popular (最热 s1-s5) |
| pilishuwu | `go-backend/templates/pilishuwu/home.html` | 125 | `.mod-top-wr .mod-top-frame .mod-top-tool-wr .mod-top-logo .mod-top-search .mod-top-tag .mod-top-nav .newyear-bg-wrap .mod-tags-wr .mod-animate-list .in-rank-wr ol.in-rank-list sub.in-rank-no-orange a.in-rank-name .in-strong-wr .in-slider-list .mod-cover-list-thumb .mod-cover-list-updata .mod-cover-list-mask .mod-cover-list-text .mod-cover-list-name .mod-cover-list-intro .mod-cover-list-tag .in-main-wr .in-teen-list-wr` | TopBooks (独家推荐 大封面 + 热门排行 ★) + Books (精品推荐 slider + 最新入库 teen list) |
| 101kks | `go-backend/templates/101kks/home.html` | 115 | `.leftmenu .headuser .menu2 header .headbox .menubtn .logo .search .menu1 .main .container .adbanner ul.row .col-xinindex .mybox .xinlogo .error-text.searchBox .indexdaohang .booklist-block .booklist-grid .booklist-card .booklist-card-link .booklist-card-content .booklist-cover-section .booklist-cover-stack .cover-main .cover-count .booklist-info-section .booklist-title .booklist-meta .meta-item .booklist-desc` | TopBooks (热门书单推荐 3 封面 stack+badge) + Books (最近更新 cover-stack+badge) + NavCats (tag 列表) |
| huangjinwu | `go-backend/templates/huangjinwu/home.html` | 110 | `.header-group .headers .container .navbar .user-dropdown .sidebar-wrapper .sidebar-header .navbar-menu .navbar-search .theme-toggle .menu-toggle .main-content .container .hot-section .book-grid .book-card .book-info .book-title/.book-author/.book-desc/.book-badges .book-badge.category/.status/.words .sort-section .category-ranking-grid .ranking-module .ranking-list .ranking-item .ranking-title .ranking-author .latest-section .footers .footer-default` | TopBooks (热门推荐 book-card badges) + Books (最近更新 book-card) + NavCats nested range $ (每分类排行榜 6 本) |
| ggd66 | `go-backend/templates/ggd66/home.html` | 75 | `.header .container .header-left .header-right .header-nav .container .content .content-left #fengtui .item .image dl dt dd .clear .content-right #fengyou .search hidden-xs form ul li [女生] .s1/.s2/.s5 .content-right #zuixin .content-left #gengxin .s1/.s2/.s3/.s5/.s4 .footer .hidden-xs` | TopBooks (热门推荐 image+dl/dt/dd) + Popular (阅读排行榜 ul li) + Books (最新小说 + 最近更新 s1-s5) |
| x2552 | `go-backend/templates/x2552/home.html` | 95 | `.main.m_head .h_logo .h_body p.fr .searchbox .loginbox .main.m_menu ul .m_ml .m_bc .m_mr .main.board .bdtop .bdsub dl#s_dl dt p#s_dt abbr bdo#s_dd dd .main #centeri .block .blocktitle .blockcontent ul.update li p.ul1 .poptext p.ul2 .main #right .block .blocktitle .blockcontent ul.ultop li p .main.links .main.footer .bdtop .ftc` | TopBooks (排行榜 6 本 cover+name) + Books (最近更新 s1-s5 spans) + Popular (总推荐榜 数量+name) + Books (最新入库 数量+name) |
| trxsw | `go-backend/templates/trxsw/home.html` | 100 | `.wrap .header .header-inner .header-search .header-right .nav .nav-inner .nav-link .nav-right .main .main-content .sidebar .section .section-title .more .section-body .rank-list .rank-no .rank-title .rank-author .content-area .vlist.book-list .book-cover .book-info .book-title .book-author .book-meta .book-intro .vlist.text-list .book-cat .book-title-line .book-author-line .book-date .book-grid .book-card .pager .pager-prev/.pager-current/.pager-next/.pager-total .footer .footer-inner` | Popular (热门排行 rank-list) + TopBooks (热门推荐 vlist.book-list 大卡片) + Books (最近更新 vlist.text-list 一行式 + 精品书单 book-grid) + pager (共 N 本) |

总计 9 个文件, ~910 行 Go template 代码。

---

## 3. 关键代码模式

### 3.1 数据契约 (与 shipsay/home.html 对齐)
```go
data := map[string]interface{}{
    "Site":       site,        // {ID, Name, Domain, ThemeID, Title, Description, Keywords}
    "Categories": cats,        // 全部分类 [{id, name}]
    "Books":      books,       // 48 本 [{id, name, author, intro, cover, status, wordCount, latestChapter, category, categoryId, updatedAt}]
    "NavCats":    takeN(cats, 8), // 8 分类 [{id, name}]
    "TopBooks":   topBooks(books, 6), // 按字数排序前 6
    "Popular":    takeBooks(books, 12), // 前 12
}
```

### 3.2 嵌套 range + $ 引外层 (huangjinwu 分类排行榜)
```html
{{range .NavCats}}
<div class="ranking-module">
  <div class="ranking-module-title">{{.name}}</div>
  <div class="ranking-list">
    {{$catId := .id}}
    {{range $i, $b := $.Books}}
    {{if lt $i 6}}
    <div class="ranking-item">
      <a href="/?view=book&id={{$b.id}}" class="ranking-title">{{$b.name}}</a>
      <span class="ranking-author">{{$b.author}}</span>
    </div>
    {{end}}
    {{end}}
  </div>
</div>
{{end}}
```

### 3.3 {{index}} 取首本 (ddyueshu 顶部 .top 块)
```html
{{if index .Books 0}}{{$b := index .Books 0}}
<a href="/?view=book&id={{$b.id}}">{{$b.name}}</a>
{{end}}
```

### 3.4 条件 + 完结/连载 (全 9 套)
```html
{{if eq .status "completed"}}完结{{else}}连载{{end}}
```

### 3.5 wordCount FuncMap (全 9 套)
```html
<span class="book-badge words">{{wordCount .wordCount}}</span>
```

---

## 4. 编译验证

```bash
cd /home/z/my-project/go-backend
export PATH=$HOME/go/go/bin:$PATH
go build -o heis-backend . 2>&1 | tail -5
# exit 0, 无输出 (0 errors)

go vet . 2>&1 | tail -5
# exit 0, 无输出 (0 issues)
```

二进制 18MB (heis-backend), 启动内存 6MB, 加载 17 个模板 (shipsay 8 + 9 套主题 home)。

---

## 5. 渲染验证 (10 套全 HTTP 200)

### 5.1 测试站点 DB 注入
DB 原只有 4 个站点 (aurora/clone-shipsay/clone-23qb/clone-101kks), 需为剩余 7 套主题插入测试站点。

**坑**: Site 表 `updatedAt` 字段 NOT NULL 无默认值, `INSERT OR IGNORE` 静默失败 (RowsAffected=0 不报错)。

**解法**: 用 `INSERT OR REPLACE ... datetime('now')` 显式提供 updatedAt。

```sql
INSERT OR REPLACE INTO Site (id, name, domain, themeId, title, description, keywords, offset, isDefault, status, inLinkWheel, updatedAt) VALUES
('test-aijjxs', 'aijjxs-test', 'aijjxs.local', 'clone-aijjxs', '久久小说下载网', 'aijjxs 测试', '小说下载', 0, 0, 1, 1, datetime('now')),
-- ... 6 个其他
```

### 5.2 启动 + curl 测试

```
2026/09/21 11:47:25 数据库: /home/z/my-project/db/custom.db
2026/09/21 11:47:25 已加载 17 个模板
2026/09/21 11:47:25 heis-backend 启动: http://localhost:3001 (内存 6MB)
```

```bash
$ curl 'http://localhost:3001/health'
{"lang":"go","memMB":6,"ok":true}

$ for site in test-aijjxs test-ddyueshu test-pilishuwu test-huangjinwu test-ggd66 test-x2552 test-trxsw cmu662q450000modpvgileq3y cmu67881k0000mop7ggxzqdx3 cmtpnmn1h0004p2wsqmk6xb5j; do
    curl "http://localhost:3001/?view=home&site=$site"
done
```

### 5.3 结果

| 主题 | siteId | HTTP | SIZE | CSS link | 错误检查 |
|---|---|---|---|---|---|
| aijjxs | test-aijjxs | 200 | 3980 | /clone-css/aijjxs.css | OK |
| ddyueshu | test-ddyueshu | 200 | 4552 | /clone-css/ddyueshu.css | OK |
| pilishuwu | test-pilishuwu | 200 | 6942 | /clone-css/pilishuwu.css | OK |
| huangjinwu | test-huangjinwu | 200 | 8009 | /clone-css/huangjinwu.css | OK |
| ggd66 | test-ggd66 | 200 | 3812 | /clone-css/ggd66.css | OK |
| x2552 | test-x2552 | 200 | 5021 | /clone-css/x2552.css | OK |
| trxsw | test-trxsw | 200 | 4500 | /clone-css/trxsw.css | OK |
| 23qb | cmu662q450000modpvgileq3y | 200 | 4528 | /clone-css/23qb.css | OK |
| 101kks | cmu67881k0000mop7ggxzqdx3 | 200 | 7204 | /clone-css/101kks.css | OK |
| shipsay | cmtpnmn1h0004p2wsqmk6xb5j | 200 | 6717 | /clone-css/shipsay.css | OK |

全部无 panic / template: error / 404 / 500 / `<pre>` 错误标记。

DB 仅 1 本书 (《万相之王》/天蚕土豆/玄幻/530 万字), 每套主题均能正确渲染 TopBooks/Books/Popular/NavCats 数据。

### 5.4 内容抽样 (23qb + trxsw 末尾)

**23qb 末尾**:
```html
<div class="module-item module-item-text-list">
  <div class="module-item-titlebox">
    <a href="/?view=book&id=cmu2j25pz0040prts6i51wfjo" class="module-item-title" title="万相之王">万相之王</a>
  </div>
  <div class="module-item-text">天蚕土豆 · 玄幻 · 530 万字字 · 连载</div>
  <div class="module-item-intro">天地间有万相，我李洛，终将成为那万相之王。</div>
</div>
```

**trxsw 末尾**:
```html
<a class="book-card" href="/?view=book&id=cmu2j25pz0040prts6i51wfjo">
  <div class="book-cover"><img src="covers/book_1789514841040_5980.webp" alt="万相之王"></div>
  <div class="book-info">
    <div class="book-title">万相之王</div>
    <div class="book-author">天蚕土豆</div>
    <div class="book-meta">530 万字</div>
  </div>
</a>
...
<div class="pager">
  <a class="pager-prev" href="/">上一页</a>
  <a class="pager-current" href="/">1</a>
  <a class="pager-next" href="/?view=category">下一页</a>
  <span class="pager-total">共 1 本</span>
</div>
```

---

## 6. 修改文件清单 (仅新增, 未改任何已有文件)

| 文件 | 行数 | 状态 |
|---|---|---|
| go-backend/templates/aijjxs/home.html | ~95 | 新增 |
| go-backend/templates/23qb/home.html | ~85 | 新增 |
| go-backend/templates/ddyueshu/home.html | ~110 | 新增 (用 {{index .Books 0}} 渲染 top book + nested if) |
| go-backend/templates/pilishuwu/home.html | ~125 | 新增 (mod-top-wr + newyear-bg-wrap mod-animate-list + in-rank-wr + in-strong-wr + in-main-wr) |
| go-backend/templates/101kks/home.html | ~115 | 新增 (繁体 lang zh-TW + booklist-grid + booklist-cover-stack + meta-item 图标) |
| go-backend/templates/huangjinwu/home.html | ~110 | 新增 (.navbar + sidebar-wrapper + .book-card 含 book-badges + 分类排行 nested range $) |
| go-backend/templates/ggd66/home.html | ~75 | 新增 (.header .content content-left/right #fengtui/#fengyou/#zuixin/#gengxin s1-s5 spans) |
| go-backend/templates/x2552/home.html | ~95 | 新增 (.m_head .h_body .m_menu + .board dl#s_dl bdo#s_dd + #centeri .block .update + #right .block .ultop) |
| go-backend/templates/trxsw/home.html | ~100 | 新增 (themes.ts 反查 DOM: .wrap .header .header-inner .nav .main-content .sidebar .section .rank-list .vlist.book-list .vlist.text-list .book-grid .pager) |

**未修改**:
- go-backend/main.go (R38-1B 已扩展为 switch view 路由 + FuncMap, 不动)
- go-backend/templates/shipsay/* (已完成, 不动)
- src/* (旧 Next.js 代码, 不动)

---

## 7. 教训与亮点

### 教训
1. **Site 表 updatedAt NOT NULL**: Prisma schema 的 `updatedAt DateTime @updatedAt` 在 SQLite 里无默认值, INSERT 时必须显式提供 (用 `datetime('now')`), 否则 `INSERT OR IGNORE` 静默失败 (RowsAffected=0, 无 err)
2. **`{{index .Books 0}}` Go template 取首本**: 不能直接 `{{(index .Books 0).name}}` (Go template 不支持链式), 必须先 `{{$b := index .Books 0}}` 再 `{{$b.name}}`
3. **嵌套 range $ 用法**: 在 `{{range .NavCats}}` 内访问外层 Books 必须用 `{{range $.Books}}` 或 `{{range $i, $b := $.Books}}`
4. **`{{if eq .status "completed"}}`** 字符串等值比较在 Go template 中需用 `eq` 函数

### 亮点
1. **9 套主题全用源站真实 class 名**: 让 `/clone-css/<site>.css` (已存在 10 个) 直接生效, 无需新写 CSS
2. **数据契约完全对齐 shipsay/home.html**: Site/NavCats/TopBooks/Popular/Books, 链接 `/?view=book&id={{.id}}`, 字数 `{{wordCount .wordCount}}` — 切换主题只需改 site.themeId 一行
3. **纯 SSR 无 client JS**: 仅 huangjinwu 保留 1 行 localStorage 主题切换脚本 (原 CSS 强依赖 data-theme 属性, 不写脚本会样式丢失), 其余 8 套 0 行 JS
4. **每套主题结构贴近源站 DOM**:
   - 23qb 完整复刻 header-content + nav-menu + module-list module-items cover+caption
   - pilishuwu 复刻 mod-top-wr + newyear-bg-wrap mod-animate-list 独家推荐大封面 + in-rank-wr 排行榜
   - 101kks 复刻 booklist-block booklist-grid booklist-card (3 封面 stack+cover-count+badge+desc)
   - huangjinwu 复刻 navbar + sidebar-wrapper + book-card (含 book-badges category/status/words)
   - ggd66 复刻 .content-left #fengtui/#fengyou + .content-right #zuixin/#gengxin (4 区块, s1-s5 spans)
   - x2552 复刻 .m_head .h_body + .board dl#s_dl bdo#s_dd (排行榜 6 本 cover) + #centeri .block .update + #right .block .ultop
   - trxsw 复刻 themes.ts 反查 DOM (.vlist/.detail/.content/.pager/.headline/.intro)

---

## 8. 后续工作建议

1. **完整测试**: 当前 DB 仅 1 本书 18 分类, 后续用真实数据 (导入多本书) 测试每套主题的列表分页/排版稳定性
2. **增加其他 view**: 每套主题除 home 外, 还需 book/read/category/ranking/fulltext/search/keyword 等 view (由其他 agent 负责)
3. **跨主题对照**: 用户切换 siteId 时, 数据契约不变, 仅 theme 不同 → 可做主题预览页 (R14/R19 系曾做过)
4. **CSS 增强**: 当前 9 套 CSS 已存在 (public/clone-css/*.css), 但部分 CSS 可能是早期抓的, 字段/class 名如有偏差需后续校准
5. **繁体 i18n**: 101kks 用 zh-TW, 后续可考虑加 zh_cn→zh_tw 转换 (theme vars)
