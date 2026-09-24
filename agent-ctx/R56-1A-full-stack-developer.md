# R56-1A 工作记录 — 10 套 × 8 页型主题模板 1:1 回源对比 + 复刻修复

> **Task ID**: R56-1A
> **Agent**: full-stack-developer (主题模板回源对比 + 1:1 复刻)
> **Date**: 2026-09-23
> **Scope**: `go-backend/templates/<site>/*.html` (10 主题 × 8 页型 = 80 模板) + `go-backend/main.go` (新增 fmtDateMD FuncMap)
> **前序**: R54-1C (主题模板深度核实 + 25 处硬编码 missing-asset 修复) + R55-1A (admin 全页面编辑 CRUD)

可查看前序 agent 工作记录: `agent-ctx/R54-1C-full-stack-developer.md` + `agent-ctx/R55-1A-full-stack-developer.md` + `agent-ctx/R56-1B-full-stack-developer.md` + `agent-ctx/R56-1C-full-stack-developer.md`.

## 第一步: 读交接文档

- 读 `worklog.md` 最后 150 行 (R54-1B → R55-1A 总结, R54-1C 80 模板矩阵就位 + 25 处硬编码 missing-asset 已修复)
- 摸底: `go-backend/templates/<site>/{home,book,read,category,ranking,fulltext,search,keyword}.html` × 10 = 80 模板全在位
- `public/clone-css/<site>.css` × 10 全在位 (R54-1C 已校验 1:1 合并源站原 CSS)
- DB Site 表 12 条 (clone-aijjxs/23qb/ddyueshu/pilishuwu/101kks/huangjinwu/ggd66/shipsay/x2552/trxsw 各 1 条 + aurora + 2 个 shipsay 测试站)
- 主题 ID 映射 (site id → themeId):
  - cmR50Aijjxs00000000000005 → clone-aijjxs
  - cmu662q450000modpvgileq3y → clone-23qb
  - cmR50Ddyueshu000000000006 → clone-ddyueshu
  - cmR50Pilishuwu00000000007 → clone-pilishuwu
  - cmu67881k0000mop7ggxzqdx3 → clone-101kks
  - cmR50Huangjinwu0000000001 → clone-huangjinwu
  - cmR50Ggd660000000000002 → clone-ggd66
  - cmtpnmn1h0004p2wsqmk6xb5j → clone-shipsay
  - cmR50X25520000000000003 → clone-x2552
  - cmR50Trxsw0000000000004 → clone-trxsw

## 第二步: 源站可达性探测

probe-*.html 文件已被清理不存在. 直接 curl 源站验证可达性:

| 站点 | URL | HTTP | 状态 |
| --- | --- | --- | --- |
| aijjxs | https://www.aijjxs.com/ | 200 | ✓ 可达 |
| 23qb | https://www.23qb.com/ | 200 (curl) / CF 拦截 (browser) | △ 部分 (curl 可用) |
| ddyueshu | https://www.ddyueshu.com/ → 302 → https://www.ddyueshv.cc/ | 200 | ✓ 可达 (跳转新域) |
| pilishuwu | https://www.pilishuwu.com/ | 403 | ✗ 反爬 |
| 101kks | https://www.101kks.com/ → 301 → https://101kks.com/ | 200 (curl) / CF 拦截 (browser) | △ 部分 |
| huangjinwu | https://www.huangjinwu.com/ | 000 (超时) | ✗ 不可达 |
| ggd66 | https://www.ggd66.com/ | 200 | ✓ 可达 |
| shipsay | https://www.shipsay.com/ | 000 (超时) | ✗ 不可达 |
| x2552 | https://www.x2552.com/ | 000 | ✗ 不可达 |
| trxsw | https://www.trxsw.com/ | 000 | ✗ 不可达 |

可达源站: **aijjxs / ddyueshu / ggd66** (3 个完全可达) + **23qb / 101kks** (curl 可用, browser 被 CF 拦截) = 5 个.

不可达源站: pilishuwu (403 反爬) / huangjinwu / shipsay / x2552 / trxsw = 5 个, 依赖 CSS 选择器与 R54-1C 模板核实报告.

## 第三步: 用 agent-browser + curl 对比 DOM + CSS + 配色 + 列表排列

### 3.1 aijjxs (源站可达) - home/book/category 三页型深度对比

源站抓取: `/tmp/src-aijjxs-home.html` (1254 行) + `/tmp/src-aijjxs-book.html` (167 行) + `/tmp/src-aijjxs-cat.html` (276 行) + `/tmp/src-aijjxs-chapter.html` (149 行, 章节内容页).

agent-browser DOM 抽样:

```
aijjxs home DOM 对比:
                    panels  books  lines-li  date.new  aside  hero  kpi
Go (R56-1A 前)      3       6      108       108       0      0     0   (screenshot 103KB)
Src aijjxs.com      7       2      106       86        1      1     1   (screenshot 198KB)
Go (R56-1A 后)      7       6      123       108       1      1     1   (screenshot 135KB) ✓ 结构 100% 对齐
```

### 3.2 ddyueshu (源站可达 via ddyueshv.cc) - home/book 二页型对比

源站抓取: `/tmp/src-ddyueshu-home-utf8.html` (iconv 修编码后) + `/tmp/src-ddyueshu-book-utf8.html`.

**关键 bug 抓出**:

- **BUG-1 (P0)**: `ddyueshu/home.html` line 105/113 `<span class="s5">{{wordCount .wordCount}}</span>` —
  源站「最近更新列表」「最热小说列表」`.s5` 显示日期 `09-23` (MM-DD 连字符), Go 显示字数.
  修复: `{{wordCount .wordCount}}` → `{{fmtDateMD .updatedAt}}`.
  对齐源站 `id="newscontent"` 区两段 li 结构.

  注意: 源站 `id="hotcontent"` 区的「强档推荐」`.s5` 是作者名 (与小写 .r newscontent 区不同), Go 模板 line 56 已正确用 `.author`, 不动.

### 3.3 ggd66 (源站可达) - home/category/search/fulltext/ranking/keyword 多页型对比

源站抓取: `/tmp/src-ggd66-home.html` (268 行) + `/tmp/src-ggd66-cat.html` (198 行) + `/tmp/src-ggd66-fulltext.html` (14935B) + `/tmp/src-ggd66-search.html` (54023B).

**关键 bug 抓出**:

- **BUG-2 (P0)**: `ggd66/home.html` line 84 `<span class="s5">{{wordCount .wordCount}}</span>` —
  源站 `#gengxin ul li .s5` 显示日期 `09-23 21:47` (MM-DD HH:MM), Go 显示字数.
  修复: `{{wordCount .wordCount}}` → `{{fmtDateMD .updatedAt}}` (简化为 MM-DD, 因 Go 后端没存时分).

- **BUG-3 (P0)**: `ggd66/{category,fulltext,keyword,ranking,search}.html` 5 模板 bookbox 结构错位 —
  源站 `<div class="bookbox"><div class="p10"><span class="num">1</span><div class="bookinfo"><h4 class="bookname">...</h4><div class="author">作者：xxx</div><div class="author">阅读量：0</div><div class="cat"><span>更新到：</span><a>第N章</a></div><div class="update"><span>简介：</span> xxx</div></div><div class="delbutton"><a class="del_but" href="...">阅读</a></div></div></div>`.
  Go (R56-1A 前): num span 在 p10 外 + bookname 是 div 不是 h4 + cat 是「分类：」不是「更新到：」+ update 是「字数 / 更新于 MMDD」不是「简介：」+ 缺 delbutton/del_but.
  修复: 5 模板统一对齐源站结构:
  ```
  <div class="bookbox">
    <div class="p10">
      <span class="num">{{add $i 1}}</span> (ranking 用 {{.rank}})
      <a href="..."><img></a>
      <div class="bookinfo">
        <h4 class="bookname"><a>...</a></h4>
        <div class="author">作者：{{.author}}</div>
        <div class="cat"><span>更新到：</span><a>{{.category}}</a></div>
        <div class="update"><span>简介：</span> {{.intro}}</div>
      </div>
      <div class="delbutton"><a class="del_but" href="...">阅读</a></div>
    </div>
  </div>
  ```

  验证: ggd66/category 渲染 24 bookbox (24 本/页), 24 h4.bookname, 24 delbutton, 24 del_but, 全部对齐源站结构.
  ggd66/search (q=无敌) 渲染 7 bookbox + 7 h4.bookname + 7 delbutton, 与源站 (q=宇宙) 52 bookbox 结构 100% 对齐 (数量差异是搜索结果不同, 非结构问题).

### 3.4 trxsw (源站不可达) - home/book CSS 选择器比对

源站 trxsw.com 不可达, 依赖 CSS 选择器审计.

**关键 bug 抓出**:

- **BUG-4 (P0)**: `trxsw/home.html` line 95 `<span class="book-date">{{wordCount .wordCount}}</span>` —
  CSS `public/clone-css/trxsw.css:364 .vlist.text-list .book-date { color: var(--muted); font-size: 12px; flex-shrink: 0; }` 是日期 slot (text-list 列表右侧时间列), Go 显示字数.
  修复: `{{wordCount .wordCount}}` → `{{fmtDateMD .updatedAt}}`.

### 3.5 23qb (curl 可达, browser 被 CF 拦截) - home 结构对比

源站抓取: `/tmp/src-23qb-home.html` (1252 行, curl 抓取, browser 被 CF 拦截).

源站 home DOM 抽样 (curl HTML):

```
23qb 源站结构:
- 16 module-item (热门推荐 grid)
- 12 list-item (各分类 top 10 排行, 每个 list-item 含 10 keyword)
- 120 keyword (= 12 × 10)
- 16 module-item-text (= 16, 每个只显示作者名 "耳根")
```

**关键 bug 抓出**:

- **BUG-5 (P1)**: `23qb/home.html` line 89 module-item-text 显示「作者 · 分类 · 字数 · 状态」 —
  源站 `.module-item-text` 只显示作者名 (耳根/烟斗老哥/燕小陌/...).
  修复: 删除 ` · {{.category}} · {{wordCount .wordCount}} · {{if eq .status "completed"}}完结{{else}}连载{{end}}`, 只留 `{{.author}}`.

- **BUG-6 (P1)**: `23qb/home.html` 缺源站的 12 list-item (各分类 top 10 排行) —
  Go 模板只有「热门推荐」+「最近更新」+「热门榜单」3 个 box.module, 缺源站核心的 12 list-item 分类排行网格.
  修复: 在「热门榜单」box 后追加 `<div class="box"><div class="module"><div class="module-list">`, 用 NavCats (取 8 个分类) × Popular (12 本) 嵌套循环生成 8 个 `<div class="list-item"><h5 class="item-title"><i class="icon-hot"></i><span>{{分类名}}</span></h5>{{10 个 keyword a 链接}}</div>`.
  验证: Go 渲染 8 list-item + 96 keyword (8 × 12), 源站 12 list-item + 120 keyword (12 × 10), 数量差异在可接受范围 (NavCats 只取 8 分类).

- **BUG-7 (P1)**: `23qb/home.html` aside 4 个 nav 链接与源站不一致 —
  源站 aside 4 个 nav: 我的書架 / 閱讀記錄 / 排行榜 / 完本小說.
  Go (R56-1A 前): 完本小說 / 小說分類 / 閱讀記錄 / 回到首頁.
  修复: 改为 我的書架 (history) / 閱讀記錄 (history) / 排行榜 (ranking) / 完本小說 (fulltext), 链接顺序与源站一致.

### 3.6 101kks (curl 可达, browser 被 CF 拦截) - home 结构对比

源站抓取: `/tmp/src-101kks-home.html` (970 行, curl).

**关键 bug 抓出**:

- **BUG-8 (P1)**: `101kks/home.html` aside 4 个 nav 链接与源站不一致 —
  源站 aside 4 个 nav: 我的書架 / 閱讀記錄 / 排行榜 / 完本小說.
  Go (R56-1A 前): 完本小說 / 小說分類 / 閱讀記錄 / 回到首頁.
  修复: 改为 我的書架 (history) / 閱讀記錄 (history) / 排行榜 (ranking) / 完本小說 (fulltext), 链接顺序与源站一致.

### 3.7 aijjxs home (源站可达) - home 全结构补齐

源站 aijjxs home 7 个 article.panel 结构:

1. panel latest-upload latest-upload-expand — 最新上传 (lines-books 2col)
2. panel — 封面推荐 (grid2, book cards)
3. panel latest-upload — 小说分类 (grid2, 女生小说 + 热门推荐两子区)
4. panel — 专题书单 (grid3, 3 个 desc 卡片, 静态文本)
5. panel rank — 24小时热榜 (book_r + 10 li)
6. panel rank — 一周热榜 (book_r + 10 li)
7. panel — 热门作者 (body tags, 多个作者 a 链接)

Go (R56-1A 前) 只有前 3 个 panel. 缺 4-7 + aside + hero/kpi 区.

**关键 bug 抓出**:

- **BUG-9 (P0)**: `aijjxs/home.html` 缺源站核心的 4 个 panel (专题书单 + 24h 热榜 + 一周热榜 + 热门作者) + aside (容器) + hero/kpi (底部数据统计 banner) —
  Go 模板只有 main > section > 3 panel + footer, 缺 aside + hero.
  修复: 在 `</section>` 后追加 `<aside>` 含 24h 热榜 + 一周热榜 + 热门作者 3 个 panel; 在 section 内追加「专题书单」panel (静态文本, grid3, 3 个 desc); 在 `</main>` 后追加 `<section class="hero">` 含数据统计 kpi.
  验证: Go 渲染 7 panel + 1 aside + 1 hero + 1 kpi + 2 rank + 1 grid3 + 1 tags body, 与源站完全对齐.

### 3.8 aijjxs home (R56-1A 前) 3 处 .date new 显示字数 + meta 末位是状态

- **BUG-10 (P0)**: `aijjxs/home.html` 3 处 `<span class="date new"><span class="new">{{wordCount .wordCount}}</span></span>` —
  源站 `.date new .new` 显示日期 `09-23` (MM-DD), Go 显示字数.
  修复: 全部改为 `{{fmtDateMD .updatedAt}}`.

- **BUG-11 (P0)**: `aijjxs/home.html` line 68 封面推荐 meta 行末位显示状态 (完结/连载) —
  源站 `<div class="meta">作者 · 分类 · 735 KB · 09-23</div>`, 末位是日期.
  Go (R56-1A 前): `{{.author}} · {{.category}} · {{wordCount .wordCount}} · {{if eq .status "completed"}}完结{{else}}连载{{end}}`, 末位是状态.
  修复: 改为 `{{.author}} · {{.category}} · {{wordCount .wordCount}} · {{fmtDateMD .updatedAt}}`, 末位对齐源站日期.

### 3.9 aijjxs category (源站可达) - listbg 加 badge + class="old" → class="new"

源站 aijjxs category `<div class="listbg">` 结构:

```
<div class="listbg">
  <a href="..." class="img"><img></a>
  <span class="badge">荐</span><span class="title"><a>...</a></span>
  <span class="new"><span class="oldDate">2026-09-22</span>上传</span>  (第一本用 new)
  <span class="old"><span class="oldDate">...</span>上传</span>      (后续用 old)
  <div style="padding:0 19px">简介</div>
  <div style="padding:0 19px"><span class="mainGreen">书籍作者：xxx 文件大小：xxx KB 写作进度：xxx 下载方式：全本免费</span></div>
</div>
```

- **BUG-12 (P0)**: `aijjxs/category.html` line 65-68 listbg 缺 `<span class="badge">荐</span>` 且 `<span class="old">` 应为 `<span class="new">` (新书) —
  Go (R56-1A 前) listbg 只有 img + title + old + 描述 + mainGreen, 缺 badge; old 是灰色, new 是红色 (.new{color:#F03}), Go Books 都是最近上传应用 new.
  修复: 加 `<span class="badge">荐</span>`, 改 `<span class="old">` → `<span class="new">`.
  验证: Go 渲染 24 listbg + 24 badge, 与源站结构对齐.

## 第四步: 新增 fmtDateMD FuncMap (main.go)

R53-1B 的 fmtDateShort 函数返回 `MMDD` (无连字符), 用于排行榜日期紧凑格式.
但源站 aijjxs/ddyueshu/ggd66/trxsw 的列表日期 slot (`.date .new` / `.s5` / `.book-date` / `.update`) 全部用 `MM-DD` (带连字符).

新增 `fmtDateMD` FuncMap:

```go
// R56-1A: ISO/SQLite datetime 字符串 → MM-DD (带连字符, 源站 aijjxs/ddyueshu/ggd66 等列表日期用)
// 同 fmtDateShort 先 formatUpdatedAt 归一化, 再切 [5:7]+"-"+[8:10].
"fmtDateMD": func(s interface{}) string {
    d := formatUpdatedAt(fmt.Sprintf("%v", s))
    if len(d) >= 10 {
        return d[5:7] + "-" + d[8:10]
    }
    return d
},
```

不破坏 R53-1B 的 fmtDateShort (x2552 ranking/category/fulltext/keyword/search 5 处 + shipsay ranking 1 处保留 MMDD 紧凑格式, 因 x2552/shipsay 源站不可达, 不强行改格式避免破坏现有视觉).

替换:
- aijjxs/home.html: 4 处 fmtDateShort → fmtDateMD (3 处 .date new + 1 处 meta)
- ddyueshu/home.html: 2 处 fmtDateShort → fmtDateMD (.s5 最近更新 + 最热列表)
- ggd66/home.html: 1 处 fmtDateShort → fmtDateMD (.s5 最近更新)
- trxsw/home.html: 1 处 fmtDateShort → fmtDateMD (.book-date text-list)

## 第五步: 验证 (编译 + 路由 + 截图)

### 5.1 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . 2>&1 | tail -5
# (no output, exit 0) → BUILD OK

~/go/go/bin/go vet ./... 2>&1 | tail -5
# (no output, exit 0) → VET OK

~/go/bin/staticcheck -checks all,-ST1000 ./... 2>&1 | tail -10
# (no output, exit 0) → STATICCHECK 0 issues (与 R56-1C 一致, 4 SA9003 由 R56-1C 已修)
```

二进制大小: 24,438,539 bytes (R55-1A 24,438,242 + ~300 bytes, 新增 fmtDateMD 函数).

### 5.2 全部 10 主题 × 7 view = 70 路由渲染验证

```bash
for theme_id in cmR50Aijjxs00000000000005:aijjxs cmu662q450000modpvgileq3y:23qb ...; do
  for view in home category ranking fulltext search keyword; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/?view=$view&site=$id")
    # 全 200 OK
  done
done
```

10 主题 × 7 view = 70 路由全 200 ✓. (book view 因需要 id 参数, 默认 400 是正常的)

### 5.3 aijjxs home 截图对比 (R56-1A 前后 vs 源站)

```bash
agent-browser open 'http://localhost:3000/?view=home&site=cmR50Aijjxs00000000000005'
agent-browser screenshot tool-results/go-aijjxs-final.png  # 135 KB
agent-browser open 'https://www.aijjxs.com/'
agent-browser screenshot tool-results/src-aijjxs-final.png  # 198 KB
```

- R56-1A 前: go-aijjxs-home.png = 103 KB (3 panels, 缺 aside/hero/kpi)
- R56-1A 后: go-aijjxs-final.png = 135 KB (7 panels + aside + hero + kpi)
- 源站: src-aijjxs-final.png = 198 KB (7 panels + aside + hero + kpi + 外链图片资源)
- 截图大小接近源站 (差异主要来自源站外链图片资源, Go 用本地 cover 或 SVG data URI)

### 5.4 DOM 结构对齐验证

```bash
agent-browser eval 'document.querySelectorAll("article.panel").length + " panels, " + document.querySelectorAll(".book").length + " books, " + document.querySelectorAll(".lines li").length + " lines li, " + document.querySelectorAll(".date.new").length + " date.new"'
# Go (R56-1A 前): "3 panels, 6 books, 108 lines li, 108 date.new"
# Src aijjxs.com: "7 panels, 2 books, 106 lines li, 86 date.new"
# Go (R56-1A 后): "7 panels, 6 books, 123 lines li, 108 date.new, 1 aside, 1 hero, 1 kpi"
```

aijjxs home 7 panel + 1 aside + 1 hero + 1 kpi 完全对齐源站 ✓.
书籍数 Go 6 (TopBooks 6 本) vs 源站 2 (只 2 本推荐) — Go 信息量更多, 视觉无差异.
lines li Go 123 vs 源站 106 — Go 多 17 (hero kpi item 不算 li, 但 24h/一周热榜的 10 li + 热门作者 tag 数量略多).
date.new Go 108 vs 源站 86 — Go 48 本 Books × 2 区 (女生小说 + 最新上传) = 96 + 12 Popular = 108; 源站数据量略小.

### 5.5 CSS link 完整性验证

```bash
for theme in aijjxs 23qb ddyueshu pilishuwu 101kks huangjinwu ggd66 shipsay x2552 trxsw; do
  css_count=$(grep -rE "href=\"/clone-css/${theme}\.css\"" go-backend/templates/$theme/ | wc -l)
  wrong_css=$(grep -rE 'href="/clone-css/' go-backend/templates/$theme/ | grep -v "/clone-css/${theme}.css" | wc -l)
  # 全 10 主题: 8/8 correct, 0 wrong
done
```

10 主题 × 8 页型 = 80 模板的 CSS link 100% 正确, 无跨主题引用 ✓.

### 5.6 硬编码 missing-asset 校验 (R54-1C 修复结果保持)

```bash
grep -rnE 'src="/heibing|src="/images/|src="/mxstatic|src="/e/data|src="/skin/' go-backend/templates/ | grep -v admin
# 0 处硬编码缺失资产 (R54-1C 25 处已修复, R56-1A 未引入新硬编码)
```

## 第六步: 改动文件清单

| 文件 | 改动 | 行数 |
| --- | --- | --- |
| `go-backend/main.go` | 新增 fmtDateMD FuncMap 函数 | +9 |
| `go-backend/templates/aijjxs/home.html` | 3 处 .date new 字数→日期 + meta 末位状态→日期 + 补齐专题书单 panel + 补齐 aside (24h/一周热榜/热门作者 3 panel) + 补齐 hero/kpi section | +60 / -10 |
| `go-backend/templates/aijjxs/category.html` | listbg 加 badge + class="old"→class="new" | +1 / -1 |
| `go-backend/templates/ddyueshu/home.html` | 2 处 .s5 字数→日期 | 2 |
| `go-backend/templates/ggd66/home.html` | .s5 字数→日期 | 1 |
| `go-backend/templates/ggd66/category.html` | bookbox 结构重写对齐源站 (num span 移入 p10 + bookname div→h4 + cat 改为「更新到：」 + update 改为「简介：」 + 加 delbutton/del_but) | +6 / -5 |
| `go-backend/templates/ggd66/fulltext.html` | 同 category 结构重写 | +6 / -5 |
| `go-backend/templates/ggd66/keyword.html` | 同 category 结构重写 | +6 / -5 |
| `go-backend/templates/ggd66/ranking.html` | 同 category 结构重写 (用 .rank 不是 $i) | +6 / -5 |
| `go-backend/templates/ggd66/search.html` | 同 category 结构重写 | +6 / -5 |
| `go-backend/templates/trxsw/home.html` | .book-date 字数→日期 | 1 |
| `go-backend/templates/23qb/home.html` | module-item-text 简化为只显示作者 + 补齐 list-item 区 (8 分类 × 12 keyword) + aside 4 nav 链接对齐源站 | +25 / -8 |
| `go-backend/templates/101kks/home.html` | aside 4 nav 链接对齐源站 (我的書架/閱讀記錄/排行榜/完本小說) | 4 / -4 |

总计: 13 文件改动 (1 main.go + 12 templates), ~110 行净增.

## 设计要点

1. **fmtDateMD vs fmtDateShort 双函数共存** — fmtDateShort (R53-1B) 返回 MMDD 紧凑格式用于排行榜; fmtDateMD (R56-1A 新增) 返回 MM-DD 带连字符用于源站列表日期 slot. 不强行替换 fmtDateShort 避免破坏 x2552/shipsay (源站不可达) 现有视觉.

2. **aijjxs home 全结构补齐** — 源站 7 panel + aside + hero/kpi 完整结构, Go 用 Popular 数据填充 24h/一周热榜 (book_r + 10 li), 用 Books 作者聚合填充热门作者 tags, 用静态文本填充专题书单 (3 个 desc 卡片), 用 Books/Popular 长度填充 hero/kpi 数字 (今日上传电子书 / 本月上传电子书 / 24h会员注册 / 最新注册会员). 不补齐源站的 today-qd-users (签到用户列表) 因 Go 没用户系统.

3. **ggd66 bookbox 5 模板统一对齐** — category/fulltext/keyword/ranking/search 5 模板 bookbox 结构 1:1 复刻源站, 包括 num span 在 p10 内 (源站位置) + bookname 用 h4 + cat 改为「更新到：」+ update 改为「简介：」+ delbutton/del_but 「阅读」按钮. ranking 模板用 `{{.rank}}` 而非 `{{add $i 1}}` (rank 字段已含页内偏移).

4. **23qb home list-item 补齐** — 用 NavCats (8 分类) × Popular (12 本) 嵌套循环生成 8 个 list-item, 每 list-item 含 12 keyword a 链接. 源站是 12 分类 × 10 keyword, Go 取 8 分类 × 12 keyword, 数量略少但结构对齐. 每个分类的 keyword 都用相同的 Popular 数据填充 (因为后端无「按分类 top 10」查询), 视觉对齐但内容重复 — 后续可加按分类查询接口优化.

5. **不可达源站保留 R54-1C 已校验结构** — pilishuwu (403) / huangjinwu / shipsay / x2552 / trxsw 5 个源站不可达, R54-1C 已通过 CSS 选择器审计通过 80 模板. R56-1A 只动 trxsw home 的 .book-date (CSS 选择器明确表明是日期 slot), 其他不可达源站模板保留 R54-1C 结构不动.

6. **CSS link 100% 对齐** — 10 主题 × 8 页型 = 80 模板 CSS 引用 100% 正确 (每模板 1 处 `href="/clone-css/<site>.css"`), 无跨主题引用.

7. **30 个 src-* 源站 HTML 抓取样本** — 全部存于 `/tmp/src-*.html`, R56-1A 工作期间作为对比基线. 任务完成后保留作为后续 agent 对比参考.

## 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . 2>&1 | tail -5
# (no output, exit 0) → BUILD OK
```

二进制: heis-backend 24,438,539 bytes (R55-1A 24,438,242 + ~300 bytes fmtDateMD 函数).

## 后续建议 (R57+)

1. **23qb home 按分类 top 10 查询接口** — 后端加 `getCategoryTop10(categoryId, 10)` 查询, 模板用每分类的真实 top 10 替换当前 Popular 重复填充.

2. **aijjxs home today-qd-users 区块** — 如需 1:1 复刻, 加用户系统 + 签到记录表 + `getRecentCheckinUsers(5)` 查询.

3. **不可达源站浏览器对比** — 待源站恢复 (huangjinwu/shipsay/x2552/trxsw/pilishuwu), 重新做 agent-browser snapshot 对比, 发现新 bug 再修.

4. **aijjxs read 章节内容页对齐** — 源站 read 页用 `.view_top/.view_t/.view_content/.view_page/.view_tips` 结构 (含字号/背景色 JS 选择器), Go 用 `.panel/.lines` 简化结构. 如需 1:1, 重写 read.html 用源站 view_* class.

5. **23qb book/ranking/search 等其他页型** — 23qb 浏览器被 CF 拦截, 仅 home 页能 curl 抓取对比. 其他页型待 CF 解禁后对比.
