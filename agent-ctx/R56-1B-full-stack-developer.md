# R56-1B Work Record — 采集规则 + 智能化 + 噪声清洗三轮深度审计 (BUG-E + BUG-F 抓修)

**Task ID**: R56-1B
**Agent**: full-stack-developer (智能化 + 采集规则 + 噪声清洗 三轮深度审计)
**Date**: 2026-09-23
**Scope**: go-backend/crawl/{runner,cleaner,smart,types}.go + go-backend/admin.go · DB Rule 表 71 条 (53 enabled) + Category 15 + Book 100 (种子)

---

## 第一步: 读交接文档

读 `worklog.md` 最后 200 行 (R54-1B → R55-1A 总结) + `go-backend/crawl/smart.go` (355 行) + `go-backend/crawl/cleaner.go` (914 行).

R54-1B 已修:
- **BUG-A (P0)**: SmartCategory 从未被调用 → runner.go CrawlBookMeta 加 `if cfg.SmartCategory { catResult := SmartCategory(...) }` + ExecuteTaskConfig.SmartCategory 开关 + DBClient.ListCategoryNames/FindCategoryIDByName 双方法
- **BUG-B (P1)**: detectedStatus 计算在 UpsertBook 之后 → 上移到 UpsertBook 之前 + newBook.Status/existing.Status 直接写
- **BUG-C (P2)**: DefaultCleanConfig.AdPatterns `[（(]?完?本[网站站][）)]?` 量词全可选 → 误删 "本站..." → 改 `[（(]完?本[网站站][）)]` 要求括号包围
- **BUG-D (P2)**: EXTRA_AD_PATTERNS 漏 8 条 "本站..." 法律免责 → 加 8 条全局兜底 (本站所收录作品 / 本站所有小说...转载 / 本站内容来源于网络 / 本站作品收集整理自网络 / 本站小说由程序自动索引 / 本站只为...阅读平台 / 请收藏本站...手机版 / 本站最新网址)

R55-1A 后台全页面编辑功能补全, 12 admin 页面 CRUD 完备度审计 + 补齐 8 个页面缺失 create/edit/delete (tasks/books/rules/sites/themes/downloads/settings/backup/seo-audit).

---

## 第二步: 智能化检查 (smart.go)

### 2.1 SmartCategory ✓ (R54-1B BUG-A 修复已落地)

`SmartCategory(bookName, intro, sourceCategory, existingCategories)` source + keyword 两层:
1. source 路径: sourceCategory 经 NormalizeCategory 归一化 → 与 existingCategories 比较 → 命中返 method="source"
2. keyword 路径: MatchCategoryByText(bookName + intro) 关键词评分 → 命中返 method="keyword"
3. LLM 兜底: Go 端 z-ai-web-dev-sdk 不可用 → 返 method="none" (跳过)

代码位置: `runner.go:1221-1231` `if cfg.SmartCategory { ... catResult := SmartCategory(...) ... }`. ✓ 实际有调用, 不再是死代码.

### 2.2 SmartCompleteDetect ✓ (R54-1B BUG-B 修复已落地)

`SmartCompleteDetect(in SmartCompleteDetectInput)` 四级启发式: 源站状态字段 → 简介 → 最新章节标题 → 目录末章标题 → 书名标注.

代码位置: `runner.go:1198-1211` `detectedStatus` 计算在 UpsertBook 之前 (line 1255 / 1275 写入 newBook.Status / existing.Status). ✓ 入库即带正确状态, 不再依赖 finalizeBook 二次 UpdateBookStatus.

### 2.3 智能 PSEO (suggest) — Go 端未实现 (留 stub)

- Task 表 autoSuggest 字段已存 (adminTasksCreate + adminTaskControlHandler SELECT 均带)
- startCrawlTask 签名已加 `autoSuggest bool` 参数透传到 `ExecuteTaskConfig.AutoSuggest`
- Go 端 z-ai-web-dev-sdk 不可用 → LLM 兜底未实现, AutoSuggest=true 仅作开关兼容

### 2.4 智能 TDK (chapterSeoAuto + chapterSeoTitleTemplate) — Go 端未消费 (留待后续接入)

- Site 表 chapterSeoAuto + chapterSeoTitleTemplate / DescTemplate / KeywordsTemplate 字段已存 (prisma/schema.prisma §Site 行 184-190)
- main.go Site SELECT (line 680, 748) 仅取 id/name/domain/themeId/isDefault/title/description/keywords/offset, 不取 chapterSeo* 字段
- read.html 模板硬编码 `<title>{{.Chapter.title}} - {{.Book.name}} - {{.Site.Title}}</title>` (10 套主题均如此)
- 智能 TDK 模板填充 (占位符 {bookName}/{chapterTitle}/{siteName}/{page}/{totalPages}) Go 端未实现, 留待后续接入 (不在本轮 scope)

---

## 第三步: 采集规则检查 (DB Rule 表 53 enabled)

写 Go 脚本 `/home/z/my-project/tmp-r56/probe.go` 调 `modernc.org/sqlite` 查 DB Rule 表 (路径 `/home/z/my-project/db/custom.db` 22MB 实际数据), 解析 config JSON 按 list/book/toc/content 四段 + clean 段审计.

### 3.1 整体统计

- TOTAL: 71 条 (53 enabled + 18 disabled)
- 全部带 clean 配置 (removeSelectors + adPatterns + whitelist + normalize + plainText)
- 全部带 list 段配置 (urlTemplate + itemSelector + fields.name/bookUrl)
- 各 enabled 规则 fetch.engine 分布: http 25 / auto 17 / browser 5 / scrapling-static 1 / 其他 5
- clean.plainText=true 规则: 1 (七猫官方 API, JSON API 站)

### 3.2 list.fields 字段名分布 (50+ 条规则用 bookUrl, 不是 url)

| 字段名 | 规则数 |
| --- | --- |
| `bookUrl` | 50+ (主流, e.g. 101kks / 久久小说 / 飘天文学 / 铅笔小说 / 黄金屋 / 西红柿 / 霹雳书屋 / 速读谷 / 夜伴书屋 / 努努书坊 / 二三阅读 / 零点看书 / ttkan / 77读书 / UU读书 等) |
| `url` | 仅少数示例规则 + 通用小说站示例 |

**关键发现 → 触发 BUG-E 抓修 (见第五步)**

### 3.3 toc.tocLink 缺失 (37 条)

正常. 部分规则书籍页 == 目录页 (tocLink 缺省 = 书籍页本身), runner.go:1296-1306 已 fallback 到 bookURL.

### 3.4 18 条 list-only 发现规则

`book/toc/content.enabled=false` 是合理设计 (仅列表发现, meta 不采). 多数是 "首页最近更新" 类规则 (list.fields 含 name/bookUrl/author/category/latestChapter 等 meta, book/toc/content.enabled=false).

### 3.5 知轩藏书 TXT 资源站

toc.enabled=false + content.enabled=false, 是合理跳过 (TXT 整本下载, 无章节 crawl).

---

## 第四步: 噪声清洗检查 (cleaner.go + R49 7 bug + R54 BUG-C/D 后边界)

### 4.1 R49-1B 7 P2/P3 bug 修复验证 ✓

| Bug | 修复 | 代码位置 |
| --- | --- | --- |
| BUG-1 NormalizeParagraphs \r→空格 | 预规范化 \r\n→\n / \r→\n / U+2028→\n / U+2029→\n\n | cleaner.go:430-434 |
| BUG-2 \s+ ASCII only | 新增 unicodeWsRe 覆盖 NBSP/Ogham/U+2000-U+200A/U+202F/U+205F/U+3000 | cleaner.go:323 + NormalizeParagraphs:436 |
| BUG-3 CcAndZwStripRe 仅 C0 + U+200B-C/U+2060/U+FEFF | 扩展 DEL + C1 (U+0080-U+009F) + LRM/RLM + SHY + LSP/PSP + invisible operators + Bidi isolate | CcAndZwStripRe/ZWStripOnlyRe/CcStripOnlyRe 三正则均扩展 |
| BUG-4 plainText </p>→\n 单换行段合并 | 改 \n\n 双换行 + 新增 plainTextAnchorEndRe 让 <a>text</a> 独立成段 | cleaner.go:482-485 |
| BUG-5 plainText 模式无 DOM 段级 Each | 新增 stripPlainTextPromoSegments 函数 | cleaner.go:885-914 + 接入 cleanContentHtmlSync/CleanContentHtmlWithTrafilatura/TryTrafilaturaFallback 三路径 |
| BUG-6 HTML 模式未剥隐藏元素 | [hidden] 属性 + style display:none/visibility:hidden 剥离 | cleaner.go:515-526 |
| BUG-7 EXTRA_AD_PATTERNS 锚点过紧 | 扩展下载...{0,30} + 未完待续.{0,12} + 本[书站]域名/地址兜底 | cleaner.go:246-257 |

### 4.2 R54-1B BUG-C/D 修复验证 ✓

Go 探针 `/home/z/my-project/tmp-r56/probe.go` 跑 11 项端到端测试 (SmartCategory source/keyword/4字直接/无特征 + SmartCompleteDetect 已完结/连载中/未完优先/intro/latestChapter/全空 + CleanContentHtml HTML 双水印/EXTRA_AD_PATTERNS 兜底/plainText 段级剥离 + BUG-C 量词回归 + 带括号水印剥离):

```
1. SmartCategory(source=玄幻): cat=玄幻奇幻 method=source ✓
2. SmartCategory(无source, intro 都市): cat=都市生活 method=keyword ✓
3. SmartCompleteDetect(status=已完结): status=completed reason=源站状态: 已完结 ✓
4. SmartCompleteDetect(status=未完结): status=ongoing (未完优先) ✓
5. CleanContentHtml HTML 双水印: 两条免责水印全剥, 无残留段片 ✓
6. CleanContentHtml plainText: 段级剥离免责段, 正文段保留 ✓
7. EXTRA_AD_PATTERNS 本站作品收集整理自网络: 兜底剥离 ✓
8. SmartCategory(source=轻小说): cat=轻小说类 method=source (R53-1A BUG-1 修复有效) ✓
9. NormalizeCategory 边界: 玄幻→玄幻奇幻 / 玄幻奇幻→玄幻奇幻 / 玄幻魔法小说→玄幻魔法小说(无别名命中) / 东方玄幻→玄幻奇幻(别名) / abc玄幻奇幻→玄幻奇幻(模糊) / 玄幻奇幻abc→玄幻奇幻(模糊) ✓
10. BUG-C 量词修复: RemoveAdLines("本站...") 保留 (不再误伤) ✓
11. 带括号水印 (完本站) 被剥 ✓
```

11/11 全 PASS.

---

## 第五步: 抓 BUG-E (P0) + BUG-F (P2)

### 5.1 BUG-E (P0) — discoverBooks 硬编码 urlFields=['url'] 与规则 'bookUrl' 不匹配

**Go 探针 `/home/z/my-project/tmp-r56/probe2.go` 复现**:
- 模拟规则 list.fields = `{name, bookUrl}` (50+ 条 enabled 规则实际配置)
- HTML 含 2 个 `<li class="book-item"><a class="book-link" href="/book/123.html">剑来</a></li>` 结构
- 跑 `ParseList(html, baseURL, pageRule, []string{"url"})` (runner.go:1108 当前硬编码)

```
=== BUG-E 重现: urlFields=['url'] (runner.go:1108 当前硬编码) ===
  Items 数: 0 (期望 2, 因规则用 'bookUrl' 而非 'url')
  ✗ BUG-E 确认: 规则用 'bookUrl' 字段名 → runner.go:1108 ParseList(urlFields=['url']) → listRes.Items 全 continue → 0 本书被采!
```

**根因分析**:
- `parser.go:1108` (runner.go) `ParseList(res.HTML, url, cfg.Rule.List, []string{"url"})` — urlFields 硬编码为 `["url"]`
- ParseList 内部 `hasURLField(urlFields)` (parser.go:1175) 检查 urlFields 含 'url' 或 'bookUrl' → 满足, 返 true
- ParseList 内部 `hasAnyURLField(urlFields, rec)` (parser.go:1184) 循环 `for _, uf := range urlFields { if rec[uf] != "" {...} }` — urlFields=['url'] 时只检查 rec['url'], 规则填 rec['bookUrl'] → rec['url'] 不存在 → 返 false
- 所以 `if hasURLField && !hasAnyURLField { continue }` → continue 跳过整条 item
- **结果: listRes.Items 全空 → discoverBooks 收 0 本书 → 任务"完成"但 0 本采集**

**为什么 R54-1B 漏审**: R54-1B worklog 声明 "12 admin 端点 curl 全 200 + Go 探针 4 项端到端验证通过" — 但 4 项测试都是单函数调用 (SmartCategory / SmartCompleteDetect / CleanContentHtml 双水印 / plainText 段级剥离), 没真跑 discoverBooks 路径, 也没注意到 list.fields 字段名差异. 真跑采集会全部 0 本.

**为什么 R55-1A clear 后 0 章节**: R55-1A 调 `/api/admin/backup/clear {confirm:true}` 清空采集产物 (Book 100 是手动种子保留, Chapter/Task/TaskLog 全清). 但即使重新跑采集, 由于 BUG-E, 仍然收不到书.

**为什么 DB 里 100 本种子数据 categoryId 全有值**: R54-1B BUG-A 修复后, SmartCategory 已被 CrawlBookMeta 调用. 但 BUG-E 在更上游 (discoverBooks 收不到书 → CrawlBookMeta 根本不会被调 → SmartCategory 也根本不会被真触发). DB 里 100 本种子数据的 categoryId 是手动建的, 不是采集算出来的.

### 5.2 BUG-E 修复方案 A: urlFields 同时含 ['url', 'bookUrl']

`runner.go:1108-1118` 重写:
```go
// R56-1B 修复 BUG-E (P0): 原 ParseList 硬编码 urlFields=['url'],
//   但 DB 53 条 enabled 规则中 50+ 条 list.fields 用 'bookUrl' 字段名
//   (e.g. 101kks / 久久小说 / 飘天文学 / 铅笔小说 / 黄金屋 / 西红柿 /
//    霹雳书屋 / 速读谷 / 夜伴书屋 / 努努书坊 / 二三阅读 / 零点看书 /
//    ttkan / 77读书 / UU读书 等). ParseList 内 hasURLField 检查
//   urlFields 含 'url' 或 'bookUrl', 但 hasAnyURLField 检查 rec[uf]
//   for uf in urlFields — urlFields=['url'] 时只检查 rec['url'], 规则
//   填 rec['bookUrl'] → hasAnyURLField 返 false → item 被 continue 跳过
//   → listRes.Items 全空 → discoverBooks 收 0 本书 → 任务"完成"但 0 本采集.
//   修复: urlFields 同时含 ['url', 'bookUrl'] (Absolutize 两个字段 +
//    hasAnyURLField 同时检查两个字段). ParseList 兼容旧 url 字段名 + 新
//    bookUrl 字段名, 都做 Absolutize + 入列.
listRes := ParseList(res.HTML, url, cfg.Rule.List, []string{"url", "bookUrl"})
newCount := 0
for _, item := range listRes.Items {
    // R56-1B 修复 BUG-E: item.Fields["url"] 优先, 缺则 fallback 到
    //   item.Fields["bookUrl"] (兼容 50+ 规则用 bookUrl 字段名).
    u := item.Fields["url"]
    if u == "" {
        u = item.Fields["bookUrl"]
    }
    if u == "" || seen[u] {
        continue
    }
    seen[u] = true
    discovered = append(discovered, u)
    rt.AddToDiscovered(u)
    newCount++
}
```

**Go 探针 `/home/z/my-project/tmp-r56/probe5.go` 验证修复** (3 个场景):
```
=== BUG-E 修复后: urlFields=['url', 'bookUrl'] ===
  Items 数: 2 (期望 2)
  Items[0]: name="剑来" url="" bookUrl="http://example.com/book/123.html"
    discoverBooks 取 u = "http://example.com/book/123.html"
  ✓ PASS: BUG-E 修复, 规则用 bookUrl 字段名也能正常解析 + 取到 url

=== 回归: 旧规则用 'url' 字段名 ===
  Items 数: 2 (期望 2)
  ✓ PASS: 回归旧 url 字段名仍可工作

=== 混合: 'url' + 'bookUrl' 都有 ===
  Items 数: 2 (期望 2)
  ✓ PASS: 混合规则两个字段都工作
```

3/3 PASS — 修复有效, 无回归.

### 5.3 BUG-F (P2) — EXTRA_AD_PATTERNS `本站小说由程序自动索引[^。\n]*` 漏 `<>` 排除 → HTML 模式跨段贪婪匹配

**Go 探针 `/home/z/my-project/tmp-r56/probe_final.go` 第 4 项测试发现**:
- 输入: `<p>段落1</p><p>本站小说由程序自动索引，如有侵权请联系我们</p><p>段落2</p>`
- 期望: 输出含 "段落1" + "段落2", 不含 "本站小说由程序"
- 实际: 输出 `<p></p><p>段落1</p>` ← "段落2" 也被剥!

**根因分析**:
- HTML 模式下, RemoveAdLines 跑在 cheerio `root.Html()` 输出上, 字符串里段间是 `</p><p>`, 没有 \n
- EXTRA_AD_PATTERNS 第 5 条 `本站小说由程序自动索引[^。\n]*` 的 `[^。\n]*` 是非贪心, 但 HTML 字符串里没有 。 也没有 \n
- 所以 pattern 会一直匹配到字符串末尾, 把 "本站小说由程序自动索引，如有侵权请联系我们</p><p>段落2</p>" 全删, 留下 `<p>段落1</p>` (前面的) 和 `<p></p>` (后面的)
- 其他 7 条 R54-1B 新加的 patterns 都用 `[^。\n<>]*` (含 < > 排除), 唯独第 5 条漏了 `<>`

**修复**: `cleaner.go:270` 改 `本站小说由程序自动索引[^。\n]*` → `本站小说由程序自动索引[^。\n<>]*` (与其他 7 条同款, 停在 。/换行/< 之前, 不跨段).

**验证** (probe_final.go 第 4 项重跑):
```
✓ 本站小说由程序自动索引: out="<p></p><p>段落1</p><p>段落2</p><p></p>"
```
段落2 保留 ✓.

### 5.4 全部端到端测试 PASS (probe_final.go 17 项)

```
=== 1. BUG-E 修复确认 (规则用 'bookUrl' 字段名) ===
  ✓ PASS: discoverBooks 取 u = "http://example.com/book/123.html"

=== 2. 智能分类 SmartCategory (5 项) ===
  ✓ source=玄幻: cat=玄幻奇幻 method=source
  ✓ source=轻小说: cat=轻小说类 method=source
  ✓ keyword=都市: cat=都市生活 method=keyword
  ✓ source=玄幻奇幻 (4 字直接): cat=玄幻奇幻 method=source
  ✓ 无 source + 无 keyword: cat= method=none
  Pass: 5/5

=== 3. 智能完结 SmartCompleteDetect (6 项) ===
  ✓ status=已完结: status=completed
  ✓ status=连载中: status=ongoing
  ✓ status=未完结 (未完优先): status=ongoing
  ✓ intro 完结词: status=completed
  ✓ latestChapter 完结: status=completed
  ✓ 全空 → unknown: status=unknown
  Pass: 6/6

=== 4. 噪声清洗 CleanContentHtml (6 项) ===
  ✓ HTML 双水印剥离
  ✓ 本站作品收集整理自网络
  ✓ 本站内容来源于网络
  ✓ 本站小说由程序自动索引 (BUG-F 修复)
  ✓ 本章未完+点击下一页
  ✓ plainText 免责段剥离
  Pass: 6/6

=== 5. BUG-C 量词修复 (DefaultCleanConfig.AdPatterns) ===
  ✓ PASS: "本站所收" 保留 (不误伤正文)
  ✓ PASS: "(完本站)" 被剥

=== 6. DB Rule 表统计 ===
  Rule 总: 71, enabled: 53, disabled: 18
  Book: 100, Chapter: 0 (种子数据 + R55-1A clear 后空)

=== R56-1B 全部回归 PASS ===
```

17/17 全 PASS.

---

## 第六步: 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . 2>&1 | tail -5
# (no output, exit 0) → BUILD OK

~/go/go/bin/go vet ./... 2>&1 | tail -5
# (no output, exit 0) → VET OK
```

二进制: heis-backend 24,438,322 bytes (R55-1A 24,438,242 + 80 bytes, runner.go +25 行注释 +7 行代码 + cleaner.go +5 行注释 +1 字符 fix).

start.sh auto-restart watchdog 在二进制重编后自动用新二进制重启 heis-backend (旧 inode 持有进程退出后启新进程, 加载新二进制). 4 端点 curl 全 200:
- GET /health → 200 {"lang":"go","memMB":17,"ok":true} ✓
- GET / → 200 (SSR HTML) ✓
- GET /admin → 200 (admin HTML) ✓
- GET /api/public/categories → 200 (15 标准 4 字分类全在 DB, ListCategoryNames 已可用) ✓

---

## 文件改动统计

- `go-backend/crawl/runner.go`: +32 行 (BUG-E 修复: urlFields=['url','bookUrl'] + u fallback 取 bookUrl + 注释)
- `go-backend/crawl/cleaner.go`: +6 行 (BUG-F 修复: `本站小说由程序自动索引[^。\n]*` → `[^。\n<>]*` + 注释)
- `go-backend/heis-backend`: 二进制重编 24,438,322 bytes (R55-1A 24,438,242 + 80 bytes)
- `agent-ctx/R56-1B-full-stack-developer.md`: 新增本条目

---

## 未修改 (尊重约束)

- `go-backend/main.go` (Site SELECT 不取 chapterSeo* 字段 + 模板硬编码 title — 智能 TDK 留待后续接入, 不在本轮 scope) ✓
- `go-backend/templates/*` (10 套 × 8 页型 = 80 模板 title 硬编码 `{{.Chapter.title}} - {{.Book.name}} - {{.Site.Title}}` — 留待智能 TDK 接入时改) ✓
- `prisma/schema.prisma` (Site 表 chapterSeoAuto + chapterSeoTitleTemplate 等字段已就位, 不需改) ✓
- `go-backend/services/*` (12 services, 不在本轮 scope) ✓
- `go-backend/admin.go` (R54-1B + R55-1A 已加 adminDB.ListCategoryNames/FindCategoryIDByName 双方法 + startCrawlTask smartCategory/smartComplete/autoSuggest 三 bool 透传, 不需再改) ✓
- `go-backend/crawl/smart.go` (R52-1A 4 字分类 + R53-1A alias 表 "轻小说" 本身 BUG-1 修复 + NormalizeCategory []rune 长度比较 BUG-9 修复 — 全部保留, 不需再改) ✓
- `go-backend/crawl/types.go` (R54-1B BUG-C 修复 DefaultCleanConfig.AdPatterns 量词 — 保留) ✓
- `agent-ctx/R38-R55` 全部保留 ✓

---

## Stage Summary

- **R56-1B 采集规则 + 智能化 + 噪声清洗三轮深度审计**:
  · **智能化 (分类/完结/PSEO/TDK)**: SmartCategory + SmartCompleteDetect 逻辑完整 (source + keyword 两层 + 4 级启发式 + []rune 安全截断). R54-1B BUG-A (SmartCategory 未调用) + BUG-B (detectedStatus 计算位置) 修复已落地确认 (runner.go:1198 detectedStatus 上移 + 1221 catResult := SmartCategory 实际调用). PSEO (autoSuggest) Go 端留 stub (z-ai-web-dev-sdk 不可用). 智能 TDK (chapterSeoAuto + chapterSeoTitleTemplate) Go 端未消费 (Site SELECT 不取 + 模板硬编码 title — 留待后续接入).
  · **采集规则**: DB 71 条 Rule (53 enabled + 18 disabled) 审计. 全部带 clean 配置 + list 段配置. 50+ 条 enabled 规则 list.fields 用 `bookUrl` 字段名 (非 `url`) — 触发 BUG-E 抓修. 18 条 list-only 发现规则 (book/toc/content.enabled=false) + 知轩藏书 TXT 站是合理设计. content.fields.title 缺失 (50 规则) 是 normal (title 从 toc.title 复用).
  · **噪声清洗**: R49-1B 7 P2/P3 bug 全部修复验证通过 (NormalizeParagraphs 预规范化换行 + Unicode 空格归一化 + CcAndZwStripRe 扩展 13 类不可见字符 + plainText </a>→\n\n + stripPlainTextPromoSegments + HTML hidden 元素剥离 + EXTRA_AD_PATTERNS 扩展). R54-1B BUG-C (DefaultCleanConfig 量词全可选误伤) + BUG-D (EXTRA_AD_PATTERNS 漏 8 条本站免责) 修复验证通过. **抓 BUG-F (P2)**: EXTRA_AD_PATTERNS `本站小说由程序自动索引[^。\n]*` 漏 `<>` 排除 → HTML 模式跨段贪婪匹配误删后续段落. 改 `[^。\n<>]*` 与其他 7 条同款.
  · **抓 BUG-E (P0)**: discoverBooks (runner.go:1108) `ParseList(res.HTML, url, cfg.Rule.List, []string{"url"})` 硬编码 urlFields=['url'], 但 DB 53 条 enabled 规则中 50+ 条 list.fields 用 `bookUrl` 字段名 → ParseList 内 `hasAnyURLField(['url'], rec)` 检查 rec['url'] 不存在 → 整条 item 被 continue 跳过 → listRes.Items 全空 → discoverBooks 收 0 本书 → 任务"完成"但 0 本采集! **修复**: urlFields=['url', 'bookUrl'] 同时识别两个字段名 + item.Fields["url"] fallback 到 item.Fields["bookUrl"]. 兼容 50+ 规则用 bookUrl + 旧规则用 url + 混合规则同时有都工作 (3/3 探针 PASS).
- **修复落地**: 2 文件改动 (runner.go +32 行 / cleaner.go +6 行 / heis-backend 重编 24.4MB).
- 编译 0 errors, vet 0 warnings, 4 端点 curl 全 200 (/health + / + /admin + /api/public/categories).
- Go 探针 17 项端到端测试全 PASS (BUG-E 修复确认 + SmartCategory 5/5 + SmartCompleteDetect 6/6 + CleanContentHtml 6/6 含 BUG-F 修复 + BUG-C 量词回归 + 带括号水印剥离 + DB Rule 统计).
- 核心保留 R38-R55 全部修复 (hostgate pump/Acquire drain / utls per-host 钉扎 + 16→21→24→29→34→36 池 / TLS session cache → persistableSessionCache + flushMu 串行化 + dirtyVersion + atomicWriteFileSync fsync + StartTlsSessionBackgroundFlusher + corruption recovery + disk cap / captcha 三服务级联 + sitekey 三属性名 + JS 变量 + iframe src fallback + query 顺序保留 / 代理 probe + latency 跟踪 + least-latency + weighted-latency + pickFailStreak + dead proxy quarantine + ProxyStatsSnapshot / probeTarget 轮换 / ThreadsMax=0 兜底 / .env + .gitignore + README + DEPLOY 纯 Go 化 / cleaner.go 7 P2/P3 bug 修复 / R50-1A persistableSessionCache snapshot+IO + captchaSitekeyRe 扩展 + probeProxyWithLatency + least-latency + Gaussian 微抖 / R51-1A BUG-1..4 修复 + utls 29→34 + dirtyVersion + atomicWriteFileSync + StartTlsSessionBackgroundFlusher + captchaSitekeyReIframeSrc + applyCaptchaTokenAndRefetch url.Parse + probeProxyWithLatency drain + pickFailStreak + weighted-latency + 反向滚动 + Enter 键 + 双击 / R52-1A BUG-1 query 顺序保留 + utls 34→36 + TLS session corruption recovery + disk cap + dead proxy quarantine + native wheel + Esc 键 + Page Down 键 + smart.go 4 字分类 / R53-1A alias 表 "轻小说" 本身 BUG-1 + NormalizeCategory []rune 长度比较 BUG-9 + /covers/ handler BUG-4..7 / R53-1B 清理 + updatedAt 格式化 bug 修复 / R54-1A 反馈模块开关 + 系统设置说明 / R54-1B BUG-A SmartCategory 未调用 + BUG-B detectedStatus 计算位置 + BUG-C DefaultCleanConfig 量词 + BUG-D EXTRA_AD_PATTERNS 漏 8 条 / R54-1C 主题模板深度核实 + 25 处硬编码 missing-asset / R55-1A 后台全页面编辑功能补全 + 12 admin 页面 CRUD 完备度 / R56-1B BUG-E discoverBooks urlFields 硬编码 + BUG-F EXTRA_AD_PATTERNS 跨段贪婪).
- 详细工作记录: 本 worklog 条目 + agent-ctx/R56-1B-full-stack-developer.md
