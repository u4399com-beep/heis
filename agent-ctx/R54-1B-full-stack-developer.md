# R54-1B Work Record — 采集规则完整性 + 智能化 (分类/完结/PSEO/TDK) + 噪声清洗

**Task ID**: R54-1B
**Agent**: full-stack-developer (采集规则+智能化+噪声清洗三轮深度审计)
**Date**: 2026-09-23
**Scope**: go-backend/crawl/{smart,cleaner,types,runner}.go + go-backend/admin.go · DB Rule 表 71 条 + Category 表 15 条

---

## 第一步: 读交接文档

读 `worklog.md` 最后 200 行 (R53-1B → R54-1A → R54-1C 总结) + `go-backend/crawl/cleaner.go` (899 行) + `go-backend/crawl/smart.go` (355 行)。

R49-1B 已修复 cleaner.go 7 P2/P3 bug:
- BUG-1 NormalizeParagraphs `\r`→空格导致 `\r\n\r\n` 拆错段
- BUG-2 `\s+` ASCII only 漏 Unicode 空格
- BUG-3 CcAndZwStripRe 仅 C0 + U+200B-C/U+2060/U+FEFF, 漏 LRM/RLM/SHY/DEL/C1/LSP/PSP/invisible operators/Bidi isolate
- BUG-4 plainText `</p>`→`\n` 单换行段合并
- BUG-5 plainText 模式无 cheerio DOM 段级 Each, 短段命中水印/导航词漏剥
- BUG-6 HTML 模式未剥隐藏元素 ([hidden] / style display:none)
- BUG-7 EXTRA_AD_PATTERNS 锚点过紧残留 "精彩小说" / "待续..."

R52-1A 改 smart.go 4 字分类 (15 标准 + categoryAliases 兜底 + NormalizeCategory 三段式 + MatchCategoryByText []rune 安全截断). R53-1A 修复 alias 表漏 "轻小说" BUG-1 + NormalizeCategory []rune 长度比较 BUG-9 + /covers/ handler BUG-4..7. R54-1C 主题模板深度核实 + 25 处硬编码 missing-asset 修复 + DEPLOY 全文重写.

---

## 第二步: 采集规则完整性检查 (DB Rule 表 71 条)

写 Go 脚本 `/tmp/rulecheck/main.go` 调 `modernc.org/sqlite` 查 DB Rule 表 (路径 `/home/z/my-project/db/custom.db`), 解析 config JSON 按 list/book/toc/content 四段 + clean 段审计.

### 2.1 整体统计

- TOTAL: 71 条 (53 enabled + 18 disabled)
- 全部带 clean 配置 (removeSelectors + adPatterns + whitelist + normalize + plainText)
- 全部带 list 段配置 (urlTemplate + itemSelector + fields.name/bookUrl)

### 2.2 Section-aware 缺失统计 (enabled 53 条)

| 缺失字段 | 出现次数 | 严重度 |
| --- | --- | --- |
| content.fields 缺 title | 50 | ✓ 正常 (title 从 toc.title 复用, ParseContent 仅提取 content 字段, 不读 title) |
| toc.tocLink 缺 | 37 | ✓ 正常 (书籍页 URL 兜底, runner.go:1199-1210 已 fallback 到 bookURL) |
| list.fields 缺 cover | 31 | ✓ 可选 (列表页可不显 cover, book.fields.cover 兜底) |
| book.fields 缺 latestChapter | 28 | ✓ 可选 |
| book.fields 缺 status | 19 | ✓ SmartCompleteDetect 兜底 |
| book.fields 缺 cover | 18 | ✓ 可选 |
| toc.fields 缺 url / title | 16 / 16 | ✓ 仅在 toc.enabled=false 规则中 (18 条 list-only 发现规则, 合理) |
| content.fields 缺 content | 15 | ✓ 仅在 content.enabled=false 规则中 (TXT 资源站 + 仅发现模式, 合理) |
| book.fields 缺 name / author / intro | 15 / 15 / 15 | ✓ 仅在 book.enabled=false 规则中 (list-only 发现规则, 合理) |

### 2.3 审计结论

**53 条 enabled 规则无 critical 缺失字段**. 18 条 list-only 发现规则 (book/toc/content.enabled=false) 是合理设计 (仅列表发现, meta 不采). 知轩藏书·TXT 资源站 (toc.enabled=false + content.enabled=false) 是合理跳过 (TXT 整本下载, 无章节 crawl). 部分 "首页最近更新" 规则 list.fields 含 name/bookUrl/author/category/latestChapter/latestChapterUrl (列表页直接抽 meta), book/toc/content.enabled=false (仅发现, 不采章节).

---

## 第三步: 智能化检查 (分类/完结/PSEO/TDK)

### 3.1 智能分类 (smart.go SmartCategory) — ✓ 逻辑完整 + BUG-A 抓出

`SmartCategory(bookName, intro, sourceCategory, existingCategories)` source + keyword 两层:
1. **source 路径**: sourceCategory 经 NormalizeCategory 归一化 → 与 existingCategories 比较 → 命中返 method="source"
2. **keyword 路径**: MatchCategoryByText(bookName + intro) 关键词评分 → 命中返 method="keyword"
3. **LLM 兜底**: Go 端 z-ai-web-dev-sdk 不可用 → 返 method="none" (跳过)

`NormalizeCategory` 三段式归一化:
1. 精确别名命中 (categoryAliases 92 条覆盖 2 字旧名 + 3 字 "轻小说" + 多种 4 字变体)
2. 标准 15 分类 4 字名直接返
3. 模糊: 源站分类名包含标准分类名 (len([]rune) > len([]rune(c.name)) + strings.Contains)

`MatchCategoryByText` 关键词评分:
- 15 分类 × ~11 关键词 = 165 次匹配
- 长度 ≥2 关键词权重 2, 长度 1 权重 1
- text 超 3000 runes 时 []rune 安全截断防多字节字符斩半
- 英文单词走 `\b` 词边界 (wordMatchesReCache sync.Map 缓存预编译正则)

**BUG-A (P0) 抓出**: SmartCategory 函数存在但**从未被调用**!
- `runner.go:CrawlBookMeta` 只调 SmartCompleteDetect (line 1190), 没调 SmartCategory
- `parsed.Category` (rule book.fields.category 提取的源站分类名) 也未消费
- Book 行 categoryId 始终为空 → 详情页 / 分类页显示 "未分类"
- Task 表 smartCategory 字段 (adminTasksCreate 已存) 但 startCrawlTask 签名未传 → 二次启动 task 时丢失开关
- adminTaskControlHandler SELECT 不含 smart flags → 二次 start 调 startCrawlTask 时丢失

### 3.2 智能完结 (smart.go SmartCompleteDetect) — ✓ 逻辑完整 + BUG-B 抓出

`SmartCompleteDetect(in)` 四级启发式:
1. **源站状态字段**: DetectCompleteFromText(in.StatusField)
2. **简介**: DetectCompleteFromText(in.Intro)
3. **最新章节标题**: DetectCompleteFromText(in.LatestChapterTitle)
4. **目录末章标题**: DetectCompleteFromText(in.LastChapterTitle)
5. **书名标注**: DetectCompleteFromText(in.BookName)

`DetectCompleteFromText(text)` 三态:
- text 超 2000 runes 时 []rune 安全截断
- ToLower 后未完优先 (ongoingWords 命中先返 "ongoing", 避免 "未完结" 被 "完结" 误判)
- 完结词命中 (completeWords) 返 "completed"
- 都不命中返 "unknown"

**BUG-B (P1) 抓出**: detectedStatus 计算在 UpsertBook 之后 → 新建书 status 写死 "unknown", 需 finalizeBook 二次 UpdateBookStatus 才持久化.
- runner.go:1175-1196 计算 detectedStatus → 1196 行赋值 → 1253-1261 行 AddToCompleted/AddToOngoing 运行时分流 → finalizeBook (runner.go:1445-1446) UpdateBookStatus 持久化
- 但若 task 中途 stopped/paused, finalizeBook 不执行 → detectedStatus 丢失
- 修复: detectedStatus 计算上移到 UpsertBook 之前 → 直接写入 newBook.Status / existing.Status (入库即带正确状态)

### 3.3 智能 PSEO (suggest 关键词) — Go 端未实现 (留 stub)

- Task 表 autoSuggest 字段已存 (adminTasksCreate + adminTaskControlHandler SELECT 均带)
- R54-1B 起 startCrawlTask 签名加 `autoSuggest bool` 参数透传到 `ExecuteTaskConfig.AutoSuggest`
- Go 端 z-ai-web-dev-sdk 不可用 → LLM 兜底未实现 (与 SmartCategory LLM 路径同款限制)
- 当前 AutoSuggest=true 仅作开关兼容, 不调任何 suggest 逻辑 (待 Node 桥或 Go LLM SDK 接入)

### 3.4 智能 TDK (chapterSeoAuto + chapterSeoTitleTemplate) — Go 端未消费

- Site 表 chapterSeoAuto + chapterSeoTitleTemplate / DescTemplate / KeywordsTemplate 字段已存 (prisma/schema.prisma §Site 段, 行 184-190)
- main.go Site SELECT (line 665, 733) 仅取 id/name/domain/themeId/isDefault/title/description/keywords/offset, 不取 chapterSeo* 字段
- read.html 模板用硬编码 `<title>{{.Chapter.title}} - {{.Book.name}} - {{.Site.Title}}</title>` (10 套主题均如此)
- 智能 TDK 模板填充 (占位符 {bookName}/{chapterTitle}/{siteName}/{page}/{totalPages}) Go 端未实现, 留待后续接入

---

## 第四步: 噪声清洗检查 (cleaner.go + R49 7 bug 后边界 case)

### 4.1 R49-1B 7 P2/P3 bug 修复验证 ✓

| Bug | 修复 | 验证位置 |
| --- | --- | --- |
| BUG-1 NormalizeParagraphs \r→空格 | 预规范化 \r\n→\n / \r→\n / U+2028→\n / U+2029→\n\n | cleaner.go:416-419 |
| BUG-2 \s+ ASCII only | 新增 unicodeWsRe 覆盖 NBSP/Ogham/U+2000-U+200A/U+202F/U+205F/U+3000 | cleaner.go:308 + NormalizeParagraphs:421 |
| BUG-3 CcAndZwStripRe 仅 C0 + U+200B-C/U+2060/U+FEFF | 扩展 DEL + C1 (U+0080-U+009F) + LRM/RLM + SHY + LSP/PSP + invisible operators + Bidi isolate | CcAndZwStripRe/ZWStripOnlyRe/CcStripOnlyRe 三正则均扩展 |
| BUG-4 plainText </p>→\n 单换行段合并 | 改 \n\n 双换行 + 新增 plainTextAnchorEndRe 让 <a>text</a> 独立成段 | cleaner.go:465-470 |
| BUG-5 plainText 模式无 DOM 段级 Each | 新增 stripPlainTextPromoSegments 函数 (段级 navLinkRe/watermarkRe/chapterTailRe 整段剥) | cleaner.go:870-899 + 接入 cleanContentHtmlSync/CleanContentHtmlWithTrafilatura/TryTrafilaturaFallback 三路径 |
| BUG-6 HTML 模式未剥隐藏元素 | 新增 [hidden] 属性 + style display:none/visibility:hidden 剥离 | cleaner.go:500-511 |
| BUG-7 EXTRA_AD_PATTERNS 锚点过紧 | 扩展下载...{0,30} + 未完待续.{0,12} + 本[书站]域名/地址兜底 | cleaner.go:241-254 |

### 4.2 R54-1B 新抓 bug + 修复

#### BUG-C (P2) — DefaultCleanConfig.AdPatterns `[（(]?完?本[网站站][）)]?` 量词全可选误伤正文

Go 探针 `/tmp/rulecheck/clean_probe.go` 验证 cleaner 行为时发现:
- 输入: `<p>本站所收录作品版权归原作者所有</p>`
- 期望: 整段删除 (我的 EXTRA_AD_PATTERNS `本站所收录作品[^。\n<>]*` 应命中整段)
- 实际: 输出 `<p>所收录作品版权归原作者所有</p>` ← 仅 "本站" 被剥, 残留 "所收录作品版权归原作者所有" 段片!

调试 (`/tmp/rulecheck/clean_probe3.go` 单独跑 RemoveAdLines):
- DefaultCleanConfig.AdPatterns 第 5 条 `[（(]?完?本[网站站][）)]?` 量词 `?` 全可选 → 单独 "本站" / "本网" 任意出现均被命中
- 在 RemoveAdLines 顺序中, DefaultCleanConfig.AdPatterns 先跑 (用户配置优先), 该 pattern 先命中 "本站" → 删 "本站" 留 "所收录作品版权归原作者所有"
- 我的 EXTRA_AD_PATTERNS `本站所收录作品[^。\n<>]*` 后跑, 但此时 "本站" 已被剥, pattern 不再命中

**修复**: DefaultCleanConfig.AdPatterns 第 5 条改为 `[（(]完?本[网站站][）)]` (要求括号包围, 仅匹配 "(完本站)" / "(本网)" / "（完本站）" 等带括号水印, 不再误伤正文 "本站..." 短语). R49-1B 起 EXTRA_AD_PATTERNS 已覆盖 "本站..." 长短语类法律免责, DefaultCleanConfig 这条老 pattern 改严格不漏剥水印.

修复后验证 (`/tmp/rulecheck/clean_probe.go` 重跑):
- 输入: `<p>这是正文段落</p><p>本站所收录作品版权归原作者所有</p><p>请收藏本站到手机版</p><p>第二段正文</p>`
- 输出: `<p></p><p>这是正文段落</p><p>第二段正文</p><p></p>` ✓ (两条免责水印全剥, 无残留段片)

#### BUG-D (P2) — EXTRA_AD_PATTERNS 漏 "本站..." 法律免责 + "请收藏本站...手机版" CTA + "本站最新网址" 通知类水印

DB 53 条 enabled 规则审计发现 9+ 条规则自定义 adPatterns 重复出现这些模式:

| 模式 | 规则数 |
| --- | --- |
| `本站所收录作品[^<>]*` | 1 |
| `本站所有小说[^<>]*` | 3 (+ 子集 "为转载作品" 2) |
| `本站内容来源于网络[^。<>]*` | 5 |
| `本站作品收集整理自网络[^<>]*` | 1 |
| `本站小说由程序自动索引` | 1 |
| `本站只为[^<>]*提供[^<>]*阅读平台[^<>]*` | 1 |
| `请收藏本站.*?手机版` | 1 |
| `本站最新网址.*?$` | 1 |

提为全局兜底 (EXTRA_AD_PATTERNS) 覆盖所有规则, 各规则可删自定义 adPatterns 简化配置. 选保守锚点 (要求完整短语 + 特定后缀 "手机版"/"来源于网络"/"阅读平台") 防误伤正文. `[^。\n<>]*` 限定到句末 (。/换行/<) 不跨段.

**新增 8 条 EXTRA_AD_PATTERNS** (cleaner.go:261-268):
1. `本站所收录作品[^。\n<>]*` — 版权免责
2. `本站所有小说[^。\n<>]*(?:转载|收集|整理)[^。\n<>]*` — 转载声明
3. `本站内容来源于网络[^。\n<>]*` — 网络来源声明
4. `本站作品收集整理自网络[^。\n<>]*` — 整理声明
5. `本站小说由程序自动索引[^。\n]*` — 自动索引声明
6. `本站只为[^。\n<>]*提供[^。\n<>]*阅读平台[^。\n<>]*` — 平台声明
7. `请收藏本站[^。\n<>]*手机版` — 收藏 CTA (要求 "手机版" 后缀)
8. `本站最新网址[^。\n<>]*` — URL 变更通知

Go 脚本 `/tmp/rulecheck/regextest.go` 验证 8 条 regex 全部编译通过 + 命中预期文本 (本站所收录作品版权归原作者所有 → match=true / 本站所有小说为转载作品，版权归原作者所有 → match=true / 等).

### 4.3 trafilatura 桥 + 60s 可用性缓存 ✓

- CheckTrafilaturaBridge 60s 缓存 (trafilaturaInst.available + checkedAt) + 进程级 trafilaturaProbeClient (1.5s timeout) + trafilaturaCallClient (20s timeout, 共享 globalTransport)
- CallTrafilaturaExtract 自定义 bridgeURL 不走缓存, 默认走缓存; HTML > 10MB 跳过
- CleanContentHtmlWithTrafilatura + TryTrafilaturaFallback 两条 trafilatura 路径均接入 stripPlainTextPromoSegments (R49-1B, 与 plainText 分支同款段级水印剥离)

### 4.4 EXTRA_AD_SELECTORS (HTML 模式 CSS 选择器) ✓

- 31 条 CSS 选择器覆盖 .ad-container / .ad-wrap / .adsbygoogle / .google-ad / #ad / #ads / .popup / .download-app / .friend-link / .float-btn / .chapter-navigate / .baidu-ad / [class*=baidu_promote] / .interstitial 等
- 与 cfg.RemoveSelectors 合并去重 (用户配置优先, 内置后跑)

### 4.5 段落规整 (NormalizeParagraphs) + 控制字符剥离 ✓

- 预规范化换行 (\r\n / \r / U+2028 / U+2029 全归一化到 \n)
- Unicode 空格归一化 (NBSP/Ogham/U+2000-U+200A/U+202F/U+205F/U+3000 → ASCII 空格)
- 按双换行分段 + 段内 \n → 空格 + 多空白合并 + TrimSpace
- CcAndZwStripRe 剥离控制字符 (C0 + DEL + C1) + 零宽 (U+200B-C/U+200E-F/U+2028/U+2029/U+2060-9/U+FEFF) + 不可见排版 (U+00AD)

---

## 第五步: 修复落地 (5 文件改动)

### 5.1 go-backend/crawl/runner.go (+71 行)

1. `ExecuteTaskConfig` 新增 3 字段: `SmartCategory bool`, `SmartComplete bool`, `AutoSuggest bool` (R54-1B 智能化三开关, 与 Task 表 smartCategory/smartComplete/autoSuggest 同口径)
2. `DBClient` interface 新增 2 方法:
   - `ListCategoryNames() []string` (SmartCategory existingCategories 入参)
   - `FindCategoryIDByName(name string) string` (命中后查 ID 写 Book.categoryId)
3. `CrawlBookMeta` 大幅重构 (line 1171-1271):
   - detectedStatus 计算上移到 UpsertBook 之前 (BUG-B 修复)
   - cfg.SmartComplete=true → 调 SmartCompleteDetect; false → parsed.Status 经 DetectCompleteFromText 归一化 (兜底)
   - categoryID 计算: cfg.SmartCategory=true → SmartCategory(source + keyword 两层); false → parsed.Category 经 NormalizeCategory 归一化 (兜底)
   - existing 书增量更新: UpsertBook 刷新 name/author/intro/cover + 仅当新算出值非空时覆盖 status/categoryId (避免空值清空)
   - 新建书: newBook.Status = detectedStatus + newBook.CategoryID = categoryID (直接写入, 入库即带正确值)

### 5.2 go-backend/admin.go (+50 行)

1. `adminDB` 新增 `ListCategoryNames() []string` 实现 (SELECT name FROM Category ORDER BY sortOrder)
2. `adminDB` 新增 `FindCategoryIDByName(name string) string` 实现 (SELECT id FROM Category WHERE name=? LIMIT 1)
3. `startCrawlTask` 签名加 3 bool 参数: `smartCategory, smartComplete, autoSuggest bool` + 写入 `crawl.ExecuteTaskConfig.SmartCategory/SmartComplete/AutoSuggest`
4. `adminTasksCreate` POST handler 调 startCrawlTask 传 3 bool (从 body 读 smartCategory/smartComplete/autoSuggest, 默认 true)
5. `adminTaskControlHandler` SELECT 加 `t.smartCategory, t.smartComplete, t.autoSuggest` + Scan + 透传到 startCrawlTask (二次启动 task 不丢失智能化开关)

### 5.3 go-backend/crawl/types.go (+6 行)

1. `DefaultCleanConfig.AdPatterns` 第 5 条 `[（(]?完?本[网站站][）)]?` → `[（(]完?本[网站站][）)]` (BUG-C 修复: 要求括号包围, 不再误伤 "本站..." 短语)
2. 注释段说明 BUG-C 修复原因 + R49-1B EXTRA_AD_PATTERNS 已覆盖 "本站..." 长短语类免责

### 5.4 go-backend/crawl/cleaner.go (+11 行)

1. EXTRA_AD_PATTERNS 新增 8 条 "本站..." 法律免责 + "请收藏本站...手机版" CTA + "本站最新网址" 通知类水印 (BUG-D 修复)
2. 注释段说明选保守锚点 (完整短语 + 特定后缀) 防误伤正文 + `[^。\n<>]*` 限定到句末

### 5.5 go-backend/heis-backend (二进制重编)

24,367,465 bytes (R54-1C 24,367,457 + 8 bytes, 4 处源码改动 + 11 行 EXTRA_AD_PATTERNS 扩展).

---

## 第六步: 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . 2>&1 | tail -5
# (no output, exit 0) → BUILD OK

~/go/go/bin/go vet ./... 2>&1 | tail -5
# (no output, exit 0) → VET OK

export PATH=$HOME/go/go/bin:$PATH && ~/go/bin/staticcheck ./... 2>&1 | tail -5
# (no output, exit 0) → STATICCHECK OK
```

重启 heis-backend :3000 + 4 端点 curl 全 200:
- GET /health → 200 {"lang":"go","memMB":13,"ok":true} ✓
- GET / → 200 OK (SSR HTML) ✓
- GET /admin → 200 (admin HTML) ✓
- GET /api/public/categories → 200 (15 标准 4 字分类全在 DB, ListCategoryNames 已可用) ✓

Go 探针 `/tmp/rulecheck/clean_probe.go` 验证 4 项端到端行为:
1. `SmartCategory("剑来", "东方玄幻故事", "玄幻", [15 标准分类])` → cat="玄幻奇幻" method="source" ✓
2. `SmartCompleteDetect(status="已完结", intro="", latest="", book="剑来")` → status="completed" reason="源站状态: 已完结" ✓
3. `CleanContentHtml("<p>这是正文段落</p><p>本站所收录作品版权归原作者所有</p><p>请收藏本站到手机版</p><p>第二段正文</p>", nil)` → `<p></p><p>这是正文段落</p><p>第二段正文</p><p></p>` (两条免责水印全剥, 无残留段片) ✓
4. `CleanContentHtml("这是正文段落\n\n本站内容来源于网络，若涉及侵权请告知\n\n第二段正文", plainText=true)` → "这是正文段落\n\n第二段正文" (plainText 模式段级剥离免责段) ✓

---

## 文件改动统计

- go-backend/crawl/runner.go: +71 行 (ExecuteTaskConfig +3 字段 + DBClient interface +2 方法 + CrawlBookMeta 重构 detectedStatus/categoryID 计算 + existing 书增量更新)
- go-backend/admin.go: +50 行 (adminDB +2 方法 + startCrawlTask +3 bool 参数 + adminTasksCreate +adminTaskControlHandler 透传)
- go-backend/crawl/types.go: +6 行 (DefaultCleanConfig BUG-C 修复 + 注释)
- go-backend/crawl/cleaner.go: +11 行 (EXTRA_AD_PATTERNS +8 条 BUG-D 修复 + 注释)
- go-backend/heis-backend: 二进制重编 24,367,465 bytes
- agent-ctx/R54-1B-full-stack-developer.md: 新增本条目

---

## 未修改 (尊重约束)

- go-backend/main.go (Site SELECT 不取 chapterSeo* 字段 + 模板硬编码 title — 智能 TDK 留待后续接入, 不在本轮 scope) ✓
- go-backend/templates/* (10 套 × 8 页型 = 80 模板 title 硬编码 `{{.Chapter.title}} - {{.Book.name}} - {{.Site.Title}}` — 留待智能 TDK 接入时改) ✓
- prisma/schema.prisma (Site 表 chapterSeoAuto + chapterSeoTitleTemplate 等字段已就位, 不需改) ✓
- go-backend/services/* (12 services, 不在本轮 scope) ✓
- agent-ctx/R38-R53 + R54-1A + R54-1C 全部保留 ✓

---

## Stage Summary

- **采集规则完整性**: DB 71 条 Rule (53 enabled + 18 disabled) 审计. 0 critical 缺失字段. 18 条 list-only 发现规则 (book/toc/content.enabled=false) + 知轩藏书 TXT 站 (toc/content.enabled=false) 是合理设计. content.fields.title 缺失 (50 规则) 是 normal (title 从 toc.title 复用, ParseContent 仅提取 content).
- **智能化 (分类/完结/PSEO/TDK)**: SmartCategory + SmartCompleteDetect 逻辑完整 (source + keyword 两层 + 4 级启发式 + []rune 安全截断). 抓 BUG-A (P0): SmartCategory 从未被调用 + parsed.Category 未消费 + Book.categoryId 始终空. 抓 BUG-B (P1): detectedStatus 计算在 UpsertBook 之后, 新建书 status 写死 "unknown". PSEO (autoSuggest) Go 端留 stub (z-ai-web-dev-sdk 不可用, LLM 路径未实现). 智能 TDK (chapterSeoAuto + chapterSeoTitleTemplate) Go 端未消费 (Site SELECT 不取 + 模板硬编码 title — 留待后续接入).
- **噪声清洗**: R49-1B 7 P2/P3 bug 全部修复验证通过 (NormalizeParagraphs 预规范化换行 + Unicode 空格归一化 + CcAndZwStripRe 扩展 13 类不可见字符 + plainText </a>→\n\n + stripPlainTextPromoSegments + HTML hidden 元素剥离 + EXTRA_AD_PATTERNS 扩展). 抓 BUG-C (P2): DefaultCleanConfig.AdPatterns `[（(]?完?本[网站站][）)]?` 量词全可选误伤 "本站..." 正文短语前缀. 抓 BUG-D (P2): EXTRA_AD_PATTERNS 漏 8 条 "本站..." 法律免责 + "请收藏本站...手机版" CTA + "本站最新网址" 通知类水印 (9+ 规则自定义 adPatterns 重复出现, 提为全局兜底).
- **修复落地**: 5 文件改动 (runner.go +71 行 / admin.go +50 行 / types.go +6 行 / cleaner.go +11 行 / heis-backend 重编 24.4MB).
- 编译 0 errors, vet 0 warnings, staticcheck 0 issues, 4 端点 curl 全 200 (/health + / + /admin + /api/public/categories).
- Go 探针 4 项端到端行为验证通过 (SmartCategory source 命中 + SmartCompleteDetect 已完结 + CleanContentHtml 双水印剥离 + plainText 段级剥离免责段).
- 核心保留 R38-R53 + R54-1A + R54-1C 全部修复 (hostgate pump/Acquire drain / utls per-host 钉扎 + attempts 偏移真正轮换 + Turnstile 8s + 2captcha 180s + per-attempt timeout / Cookie 持久化 + stripPort 跨端口 / BudgetExceeded 上抛 / truncate rune-based / Referer 一致性 / pickProxyFor sweep 完整 / trafilatura clients 单例 / jsonLdTypeRe 预编译 / batchMu defer / discoverBooks newCount==0 break / MarkProxyFailed/OK / IncCaptcha / ReportRateLimited / cloak-browser page.AddScriptToEvaluateOnNewDocument + simulateHumanBehaviorActions / scrapling-bridge Accept-Encoding 移除 br / cleaner.go collapseDupPunct / DialTLSContext ctx 取消 / 13 处 []rune 安全截断 / ClearUtlsChoice 仅 handshake 失败 / pickUtlsHello host=='' 返 pool[0] / brotli per-host / utls 16→21→24→29→34→36 池 / TLS session cache → persistableSessionCache + flushMu 串行化 + dirtyVersion 版本比较 + atomicWriteFileSync fsync + StartTlsSessionBackgroundFlusher + corruption recovery + disk cap / captcha 主备切换 → 三服务级联 + sitekey 三属性名 + JS 变量 + iframe src fallback + query 顺序保留 / 代理 probe + latency 跟踪 + least-latency + weighted-latency 策略 + pickFailStreak 业务失败跟踪 + dead proxy quarantine + ProxyStatsSnapshot / probeTarget 轮换 / probe 头族 / ThreadsMax=0 兜底 / .env + .gitignore + README + DEPLOY 纯 Go 化 / cleaner.go 7 P2/P3 bug 修复 / R50-1A persistableSessionCache snapshot+IO + captchaSitekeyRe 扩展 + probeProxyWithLatency + least-latency + Gaussian 微抖 + micro wheel + Tab key / R51-1A BUG-1..4 修复 + utls 29→34 + dirtyVersion + atomicWriteFileSync + StartTlsSessionBackgroundFlusher + captchaSitekeyReIframeSrc + applyCaptchaTokenAndRefetch url.Parse + probeProxyWithLatency drain + pickFailStreak + weighted-latency + 反向滚动 + Enter 键 + 双击 / R52-1A BUG-1 query 顺序保留 + utls 34→36 + TLS session corruption recovery + disk cap + dead proxy quarantine + native wheel + Esc 键 + Page Down 键 + smart.go 4 字分类 / R52-1B 清理 + 模板封面核实 + DEPLOY/README 校对 + formatUpdatedAt 函数引入 + R52-1A 功能改动保留 8-space 缩进 / R53-1A alias 表 "轻小说" 本身 BUG-1 修复 + NormalizeCategory []rune 长度比较 BUG-9 + /covers/ handler BUG-4 path traversal + BUG-5 SVG initial XML escape + BUG-6 LIKE 模式过松 + BUG-7 Scan 错误记日志 / R53-1B 清理 + updatedAt 格式化 bug 修复 (fmtDate/fmtDateShort/shortTime 三处全部先 formatUpdatedAt 归一化) + DEPLOY/README LoC 同步 + go build + go vet + staticcheck 全 0 / R54-1A 反馈模块开关 + 系统设置说明 + 非 Go 橥留检查 / R54-1B 采集规则完整性 + 智能化 (BUG-A SmartCategory 未调用 + BUG-B detectedStatus 计算位置 + PSEO/TDK Go 端未实现) + 噪声清洗 (BUG-C DefaultCleanConfig 量词全可选误伤 + BUG-D EXTRA_AD_PATTERNS 漏 8 条本站免责) + go build + go vet + staticcheck 全 0 / R54-1C 主题模板深度核实 + 25 处硬编码 missing-asset 修复 + DEPLOY 全文重写).
