# R38-1B shipsay 8页型 Go template

## 1. 读交接

- `go-backend/templates/shipsay/home.html` (106 行): Go template 写法 — `{{define "shipsay/home"}}...{{end}}` 包裹, `{{range .NavCats}}<a href="/?view=category&cat={{.id}}">{{.name}}</a>{{end}}`, `{{if .cover}}<img src="{{.cover}}">{{end}}`. 站点 Site map 用大写键 (`.Site.Title/.Site.Name/.Site.Domain`), 书 book map 用小写键 (`.id/.name/.cover/.author/.status/.wordCount/.latestChapter/.category/.categoryId/.updatedAt`).
- `go-backend/main.go` (345 行): homeHandler 接管 `/`, 已有 FuncMap 仅 wordCount, 路由 `/api/public/*` 9 个, getSite/getCategories/getBooks/takeN/topBooks/takeBooks/truncate/getMemMB helpers.
- `src/components/public/clone-themes/shipsay/*.tsx` (7 个组件): 各页型 DOM 结构 + 源站真实 class 名 (`.novel_info_main/.chapter_list/.sortvisit/.store/.store_left/#store_right/.side_commend/.flex/.img_span/.w100/.li_bottom/.pages/.ulcard/.lastupdate/.searchresult/.searchresult_p/.read_nav/.text/.fontsize/#article/.text_title/.style_h1/.text_info/.fullflag/.store_title/.section.link/#footer`).
- `src/app/page.tsx` (487 行): Next.js 端 view 路由 + 数据装配参考 (book: book+chapters+tags+recent; read: chapter+book+prev+next+pagination; category: books+total+page+size; ranking: books by sort; fulltext: status=completed; search: LIKE q; keyword: BookTag JOIN Book).
- `prisma/schema.prisma` 字段确认 (Book: id/name/author/intro/cover/status/wordCount/latestChapter/keywords/categoryId/updatedAt; Chapter: id/bookId/idx/title/content/wordCount/storage/filePath; BookTag: bookId/tag/source/hits).

## 2. 创建 7 个 shipsay 页型 template

### book.html ({{define "shipsay/book"}})
- 复用 home 同款 header/nav
- `.novel_info_main`: img 120x160 float:left + `.novel_info_title` (h1 + p span 作者/类别/状态/字数/更新 + i 最新章节 + div `l_btn`/`l_btn_0` 开始阅读/查看目录) + `.indent` p 简介
- `.chapter_list #chapter_list`: p.title 最新章节 + ul li RecentChapters + 查看完整章节目录
- `{{if .Chapters}}` 第二个 `.chapter_list`: 完整章节目录 ul li (按 idx asc 排序, 取前 200 防超大书)
- `{{if .Related}}` `.section.flex .sortvisit` 同类推荐
- `.section.link` 友情链接 + `#footer` footer.container

### category.html ({{define "shipsay/category"}})
- `.store > .store_left .side_commend_width` (p.title `{{.Label}}` + ul.flex li 含 `.img_span` img 100x133 + span 类别/状态 + `.w100` h2 + p.indent + `.li_bottom` a 作者 + div em.orange 字数 + em.blue 日期) + `{{if gt .TotalPages 1}}.pages` 分页 (上一页/页码/下一页/尾页)
- `#store_right`: 全部分类 + 热门小说 + 热门作者

### read.html ({{define "shipsay/read"}})
- `main.container.read_bg .text_title` (h1.style_h1 + `.text_info` span 来源/欢迎)
- `.text .fontsize` (3 个 button A 字号档 + span 字号提示, onclick 调整 #article fontSize) + `#article` (内容用 `template.HTML` 不转义, `\n\n` 段落已自动包 `<p>` 并转义 `<>&`)
- `.read_nav` a x3 (上一章 / 目录 / 下一章, `{{if .Prev}}`/`{{if .Next}}` 守卫, 已是首/末章时显示禁用)

### ranking.html ({{define "shipsay/ranking"}})
- `.section .ulcard` 7 tabs (总点击/月点击/周点击/日点击/总推荐/字数/最近更新, `{{if eq .id $.Tab}}class="act"{{end}}`)
- `.lastupdate` (p.title `{{.TabName}}` + ul.odd li 含 span bookmark 排名 + a 书名 + a.gray 最新章节 + span 作者+日期) + `{{if gt .TotalPages 1}}.pages`
- `aside` 热门小说 ul.popular.odd

### fulltext.html ({{define "shipsay/fulltext"}})
- 同 category 结构, 加 `.img_span span.fullflag` "完本" 图标 + p.title 全本完本小说 + `.pages` 分页

### search.html ({{define "shipsay/search"}})
- input searchkey `value={{.Q}}` 预填搜索词
- `.section` (p.title 搜索 + `{{range .Books}}.searchresult`: h3 书名 + p 作者/类别/字数 + p.searchresult_p 简介 + div a.gray 最新章节) + `aside` 热门小说
- 空结果时 `.msgdiv` 未找到 + 返回首页

### keyword.html ({{define "shipsay/keyword"}})
- input searchkey `value={{.Tag}}` 预填标签
- `.section` (p.title 标签 + `{{if .RelatedTags}}.ulcard` li 相关标签 + `{{range .Books}}.searchresult`) + `aside` 热门小说

## 3. 扩展 main.go

### FuncMap (新增 5 个)
- `statusLabel`: status → 中文 (completed → 完结, 其他 → 连载)
- `fmtDate`: ISO/SQLite datetime 字符串 → YYYY-MM-DD (取前 10 字符)
- `fmtDateShort`: ISO/SQLite datetime → MMDD 4 字符无分隔 (排行榜日期用)
- `add`/`sub`: 整数加减 (模板不支持原生算术, 用于分页上下页), 接收 interface{} 通过 toInt 转换

### homeHandler 改造
- switch view (book/read/category/ranking/fulltext/search/keyword/history/home) 8 分支, 按需装配 data
- theme+view 拼模板名 `tmplName = theme + "/" + view`, 失败 fallback `shipsay/home`
- Site/Categories/NavCats 三个基础数据所有页型共用

### 视图数据查询 (新增 9 个)
- `getBookViewData(id)`: book map + chapters (前 200 章) + recent (idx desc 12 章反转) + related (同 categoryId 排除当前书, 12 本) + firstChID
- `getReadViewData(chID)`: chapter (含 content, `\n\n` 自动包 `<p>` 并 HTML 转义 `<>&`, 用 `template.HTML` 不转义) + book + prev/next (基于 idx 查前/后一章)
- `getCategoryViewData(catID, page, size)`: label (分类名或全本小说) + books + total, WHERE categoryId=? 过滤 + LIMIT/OFFSET, offset 钳 ≤ 10000
- `getRankingViewData(tab, page, size)`: books + total, ORDER BY updatedAt DESC (size → wordCount DESC), 与 Next.js page.tsx SORT_MAP 同口径
- `getFulltextViewData(page, size)`: books + total, WHERE status='completed'
- `getSearchViewData(q, limit)`: books, LIKE %q% 匹配 name/author/intro/keywords, ORDER BY wordCount DESC
- `getKeywordViewData(tag, limit)`: books (BookTag JOIN Book 按 hits desc) + relatedTags (第一本书的其他 tag, 12 个)

### 工具函数 (新增 7 个)
- `toInt`: interface{} → int (支持 int/int64/float64/字符串数字)
- `clampPage`: page 参数解析, 默认 1, 最小 1
- `buildPageList`: 当前页前后各 5 个, 最多 11 个页码列表
- `pickAuthors`: 去重作者前 n 个
- `withRank`: 给 books 列表每项加 rank 字段 (基于 page/size 计算全局序号)
- `rankingTabs`/`tabName`: 排行榜 7 tab 静态列表 + id → 中文
- `bookRowFromScan`: SQL 字段拼成 book map, 字段名与 getBooks 一致

## 4. 编译 + 渲染测试

- `cd go-backend && go build -o heis-backend .` → 0 errors, 二进制 18.26 MB
- `go vet ./...` → 0 warnings
- 重启 heis-backend (kill 旧 PID + setsid 启动), 监听 :3001, 加载 17 个模板 (shipsay 8 + 其他主题 9 个 home)
- curl 全 8 视图测试:

| 视图 | URL | HTTP | size | 关键 markers |
|---|---|---|---|---|
| home | / | 200 | 6717 | side_commend/popular/sortvisit/大神小说/热门小说 (12 处) |
| category | /?view=category | 200 | 4243 | store_left/store_right/store_title/全部分类/热门小说/热门作者 |
| category p2 | /?view=category&page=2 | 200 | 3493 | TotalPages=1 时 .pages 不渲染 (预期) |
| book | /?view=book&id=cmu2j25pz0040prts6i51wfjo | 200 | 34148 | .novel_info_main (img 120x160 + h1 + p span x5 + i 最新章节 + l_btn/l_btn_0) + .chapter_list (RecentChapters 12 li + Chapters 200 li) + .sortvisit 同类推荐 |
| read | /?view=read&chapter=cmu3axksv001zthtrx268g7dg | 200 | 20092 | .text_title h1.style_h1 + .text_info span + .fontsize 3 按钮 + #article `<p>` 原样输出 + .read_nav (上一章=已是首章 / 目录 / 下一章) |
| ranking | /?view=ranking | 200 | 3824 | .ulcard 7 tabs (allvisit active) + .lastupdate ul.odd li + bookmark 排名 |
| ranking size | /?view=ranking&sort=size | 200 | 3815 | "字数榜" tab active, ORDER BY wordCount DESC |
| fulltext | /?view=fulltext | 200 | 3511 | .store_left .side_commend_width 全本完本小说 + .fullflag 完本图标 |
| search 万相 | /?view=search&q=万相 | 200 | 3247 | .searchresult h3 万相之王 + p 作者/类别/字数 + p.searchresult_p + div a.gray 最新章节 |
| search 无结果 | /?view=search&q=a | 200 | — | .msgdiv 未找到 + 返回首页 |
| keyword 万相之王 | /?view=keyword&tag=万相之王 | 200 | 5029 | p.title 标签 + .ulcard li 相关标签 (万相之王 最新章节 无弹窗 / 万相之王 漫画 小说 等) + .searchresult |

- `bun run lint` → 0 errors (Go 后端不参与, Next.js 项目侧无回归)
- dev.log → Next.js 16 dev server 200 in 28ms, 无报错

## 5. 修复 (1 处 bug)

### read.html chapter content HTML 转义 bug
- **现象**: 初次渲染 `{{.Chapter.content}}` 被 Go html/template 自动转义为 `&lt;p&gt;...&lt;/p&gt;`, 前端看到的是字面字符串而非段落标签
- **修复**: `getReadViewData` 返回时把 content 包成 `template.HTML(bodyHTML)`, 触发 Go 模板不转义直传
- **验证**: 重启后 `#article` 输出 `<p>大夏国，天蜀郡。</p><p>...</p>` 真实段落, `/clone-css/shipsay.css` 的 `#article>p { text-indent:2em; line-height:1.8em }` 生效

## 6. 修改文件清单

10 个文件 (7 个新建 + 1 个修改 + 0 个 prisma):
- `go-backend/templates/shipsay/book.html` (新建, ~115 行)
- `go-backend/templates/shipsay/category.html` (新建, ~115 行)
- `go-backend/templates/shipsay/read.html` (新建, ~75 行)
- `go-backend/templates/shipsay/ranking.html` (新建, ~95 行)
- `go-backend/templates/shipsay/fulltext.html` (新建, ~115 行)
- `go-backend/templates/shipsay/search.html` (新建, ~85 行)
- `go-backend/templates/shipsay/keyword.html` (新建, ~95 行)
- `go-backend/main.go` (修改, +500 行: 5 FuncMap + 8 view 分支 + 9 查询 + 7 工具)

## 7. 未修改 (尊重约束)

- `go-backend/templates/shipsay/home.html` (已完成, 不动) ✓
- `go-backend/templates/<其他主题>/*` (A agent 负责, 不动) ✓
- `src/*` (旧代码, 不动) ✓
- `prisma/schema.prisma` + `package.json` (0 新依赖) ✓
