# Task ID: R57-1B
# Agent: full-stack-developer (采集规则 + 智能化 + 噪声清洗 + TDK 接入 四轮深度审计)
# Work Log

## 范围

接续 R56-1B/1C/1A 全套修复, R57-1B 在 R56 全套修复基础上做四轮深度审计:
1. 采集规则 DB Rule 53 enabled 深度检查
2. 智能化 (SmartCategory + SmartCompleteDetect + PSEO + TDK + NormalizeCategory)
3. 噪声清洗 (R49 7 bug + R54 BUG-C/D + R56 BUG-F 修复回归 + 抓 BUG-G/H)
4. 智能 TDK 接入 (Site chapterSeo* 字段消费 — R56-1B 留待, R57-1B 实施)

## 第一步: 读交接文档

- 读 worklog.md 最后 200 行 (R56-1B/1C/1A + R55-1A 全部记录)
- 读 go-backend/crawl/smart.go (355 行) + cleaner.go (920 行) + runner.go (1576 行) + types.go (744 行)

## 第二步: 采集规则深度审计 (DB Rule 53 enabled)

写 Go 探针 r57probe/main.go 查 DB Rule 表 (db/custom.db 421KB, Site 12 / Category 15 /
Rule 71 / Book 0 / Chapter 0 / Task 0).

### 整体统计
- 71 条 Rule (53 enabled + 18 disabled)
- 全部带 clean 配置 (removeSelectors + adPatterns + whitelist + normalize + plainText)
- fetch.engine 分布: auto 28 / http 22 / browser 3
- clean.plainText=true: 4 条 (主流是 0 — R56-1B 记 1 条, 实测 4 条, 因 R56-1B 之后规则配置微调)
- 自定义 adPatterns: 27 条规则 (合计 204 模式)

### 四段配置完整性 (enabled 53)
- list.enabled+cfg: 53/53 (100%)
- book.enabled+fields: 38/53 (14 list-only 发现规则 + 1 知轩 TXT 站)
- toc.enabled+fields: 37/53
- content.enabled+fields: 38/53
- list-only 发现规则 14 条 (合理设计: 仅列表发现, meta 不采, 多是 "首页最近更新" 类)
- list.urlTemplate 53/53 全有
- list.pagination 启用 8 条
- toc.tocLink 16 条 (其余 fallback bookURL — runner.go:1296-1306)
- toc.pagination 启用 10 条
- content.pagination 启用 4 条

### BUG-E 修复后验证 ✓
- list.fields['url'] 出现 0 条
- list.fields['bookUrl'] 出现 53 条 (100% 主流规则用 bookUrl 字段名)
- runner.go:1120 已硬编码 urlFields=['url','bookUrl'] (R56-1B BUG-E 修复有效)
- runner.go:1125-1128 item.Fields["url"] fallback item.Fields["bookUrl"]

### cover 选择器 + 占位符
- cover 缺失 18/53 (list-only 规则 + 知轩 TXT 站 + 主流规则未提 cover — normal)
- cover 用 CSS 选择器 31 条
- cover attr 分布: src 20 + content 11 (content 多为 SVG/base64 占位等)

### adPatterns 与 DefaultCleanConfig.AdPatterns 冗余统计
- 总冗余匹配数: 46 (跨规则累计, 27 条规则中有冗余)
- 说明: 用户配置冗余不影响功能 (RemoveAdLines 自动合并去重 + EXTRA_AD_PATTERNS 后跑), 可选清理但非 bug

## 第三步: 智能化深度审计

### [1] SmartCategory (R54-1B BUG-A 修复后已落地) ✓
- runner.go:1221 `catResult := SmartCategory(parsed.Name, parsed.Intro, parsed.Category, existingCats)` 实际调用
- DBClient.ListCategoryNames/FindCategoryIDByName 双方法落地 (admin.go adminDB 实现)
- 探针 5/5 PASS: source=玄幻→玄幻奇幻/source + source=轻小说→轻小说类/source (R53-1A BUG-1 修复有效) +
  keyword=都市→都市生活/keyword + 4字直接→玄幻奇幻/source + 无特征→空/none

### [2] SmartCompleteDetect (R54-1B BUG-B 修复后已落地) ✓
- runner.go:1198 detectedStatus 计算上移到 UpsertBook 之前
- newBook.Status (line 1275) + existing.Status (line 1255) 直接写入, 入库即带正确状态
- 探针 6/6 PASS: 已完结/completed + 连载中/ongoing + 未完优先/ongoing (intro 含 已完结+未完 → ongoing) +
  intro 完结词/completed + latestChapter 完结/completed + 全空/unknown

### [3] PSEO (autoSuggest) — Go 端留 stub
- Task 表 autoSuggest 字段已存 + startCrawlTask 透传
- Go 端 z-ai-web-dev-sdk 不可用 (Node SDK), R57-1B 不接入 LLM, AutoSuggest=true 仅开关兼容

### [4] 智能 TDK (chapterSeoAuto + chapterSeoTitleTemplate) — R57-1B 已接入 (见第四步)

### [5] NormalizeCategory 4 字分类 (R52-1A 改 4 字 + R53-1A BUG-9 []rune 修复) ✓
- 探针 31 case 全 PASS:
  · 15 标准 4 字名 (玄幻奇幻/奇幻魔幻/...) 全直接返回
  · 15 标准 2 字名 (玄幻/奇幻/...) 经 categoryAliases 兜底转 4 字
  · 15 别名变体 (玄幻小说/西方奇幻/...) 经 categoryAliases 命中
  · 3 模糊包含 (玄幻奇幻精选/都市生活类/轻小说类集) 经第 3 步 Contains 命中
  · 2 无法合并 (未知分类/杂谈) 经第 4 步返原名
  · 1 混合名 (玄幻奇幻abc) 经 R53-1A BUG-9 []rune 长度比较修复验证 ✓

## 第四步: 智能化 TDK 接入 (R56-1B 留待 → R57-1B 实施)

R56-1B 标记 "智能 TDK 字段已就位但未消费 (Site SELECT 不取 chapterSeo* 字段 + 模板硬编码 title, 留待
后续接入)". R57-1B 实施:

### main.go getSite SELECT 加 4 字段 (line 756-799)
- 原 SELECT 9 字段: id,name,domain,themeId,isDefault,title,description,keywords,offset
- 改 SELECT 13 字段: 加 chapterSeoAuto + chapterSeoTitleTemplate + chapterSeoDescTemplate +
  chapterSeoKeywordsTemplate
- site map 增加 4 字段: ChapterSeoAuto + ChapterSeoTitleTemplate + ChapterSeoDescTemplate +
  ChapterSeoKeywordsTemplate

### main.go 新增 computeChapterSeo 函数 (line 801-857)
- 签名: func computeChapterSeo(site, chapterTitle, bookName, bookAuthor, bookIntro) (seoTitle, seoDesc, seoKw)
- chapterSeoAuto=true (默认): 用与原模板硬编码一致的字段 (site.Title / site.Keywords / book.author),
  与原模板 `{{.Chapter.title}} - {{.Book.name}} - {{.Site.Title}}` /
  `{{.Book.name}},{{.Chapter.title}},{{.Book.author}},{{.Site.Keywords}}` /
  `{{.Book.name}}{{.Chapter.title}}全文阅读,{{.Book.intro}}` 字段口径对齐, 保持向后兼容
- chapterSeoAuto=false 且至少一个模板非空: 用用户 chapterSeoTitleTemplate 等模板, 替换占位符
  {bookName} {chapterTitle} {page} {totalPages} {siteName} (page/totalPages 当前 Go 端不分页用 1/1)
- 模板空 fallback 默认 (与 chapterSeoAuto=true 一致)
- intro 截断到 100 字符 (desc 默认模板拼 intro, 防超长; 用户 desc 模板用户自负)

### main.go getReadViewData 接收 site 参数 + 调 computeChapterSeo (line 1249-1316)
- 签名改: func getReadViewData(chID string, site map[string]interface{}) (...)
- homeHandler case "read" 传 site (line 468: getReadViewData(chID, site))
- chapter map 新增 seoTitle/seoDesc/seoKeywords 字段 (chapterSeoAuto=true 或模板空用默认; false 用用户模板)
- book 查不到也填入 SEO TDK (用空 bookName/author/intro + chapterTitle), 不阻塞渲染

### 10 个 read.html 模板 TDK 统一消费 .Chapter.seoTitle / .Chapter.seoKeywords / .Chapter.seoDesc
- 101kks/23qb/aijjxs/ddyueshu/ggd66/huangjinwu/pilishuwu/shipsay/trxsw/x2552 10 模板
- 原硬编码 `<title>{{.Chapter.title}} - {{.Book.name}} - {{.Site.Title}}</title>` 等 3 行 → 改为
  `<title>{{.Chapter.seoTitle}}</title>` +
  `<meta name="keywords" content="{{.Chapter.seoKeywords}}">` +
  `<meta name="description" content="{{.Chapter.seoDesc}}">`
- 默认 (chapterSeoAuto=true) 渲染结果与原硬编码一致 (向后兼容); chapterSeoAuto=false 时用户模板覆盖

### TDK 接入逻辑单元测试 (r57probe2/main.go) 5/5 PASS
1. chapterSeoAuto=true 模板空 → 默认 (与原模板硬编码等价)
2. chapterSeoAuto=false 模板非空 → 用户模板替换占位符
3. chapterSeoAuto=false 模板空 → fallback 默认
4. chapterSeoAuto=true 模板非空 → 默认 (用户模板被忽略, 因 seoAuto=true 优先级)
5. intro > 100 字符 → 截断到 100 字符 (防 desc 超长)

### TDK 接入说明
- 101kks 原用 `全文閱讀` 繁体 + ggd66/x2552 原 description 缺 intro, 默认模板用 `全文阅读` 简体 +
  含 intro — 站点繁简差异 (101kks 不再是繁体 description) + description 内容增强 (ggd66/x2552 多 100
  字 intro), 不算 bug, 是 TDK 统一化的副作用.
- page/totalPages 占位符当前 Go 端不分页 (chapterPaginationMode=off 默认), 用 1/1. 后续若实施
  chapterPaginationMode != off, 可在 computeChapterSeo 接入真实 page/totalPages.

## 第五步: 噪声清洗深度检查 + 抓 BUG-G/H

### R49 7 P2/P3 bug + R54 BUG-C/D + R56 BUG-F 修复回归 ✓
- 探针 7 项全 PASS: EXTRA_AD_PATTERNS 覆盖度 6/6 (本章未完/请记住本书域名/为您提供精彩小说/
  本站小说由程序自动索引 (BUG-F 修复)/本站 短词不误伤 (BUG-C 修复)/(完本站) 带括号被剥/
  阅读平台不跨段误删)
- CleanContentHtml 双分支 5/5 PASS: HTML 双水印剥离 / plainText 段级剥离 (R49-1B BUG-5) /
  HTML 隐藏元素剥离 (R49-1B BUG-6) / HTML 控制字符剥离 (R49-1B BUG-3) /
  首末段水印剥离 (R57-1B BUG-G+H 修复)
- NormalizeParagraphs 5/5 PASS: \r\n→\n / U+2029 PSP / NBSP→空格 / 双换行分段 / 段内多\n压单空格
- 控制字符剥离 6/6 PASS: U+200B/FEFF/00AD/007F DEL/0085 C1 NEL/009F C1 APC (R49-1B BUG-3 扩展覆盖)
- CleanTextField + CleanIntro 2/2 PASS

### 抓 BUG-G (P2): chapterHeadCNRe `\b` 对中文无效, 首段章节号剥离失效
**位置**: cleaner.go:312 `chapterHeadCNRe = regexp.MustCompile(`^第[一二三四五六七八九十百千万0-9]+(?:章|节|回|话|集)\b`)`

**根因**:
- Go RE2 的 `\b` 是 ASCII word boundary (前后字符 [A-Za-z0-9_] vs non-ASCII word char)
- "第一章 引子" 中 "章" (non-ASCII) 后接空格 (non-ASCII whitespace), 两个都是 non-ASCII word char
- `\b` 在两个 non-ASCII word char 之间不匹配 → chapterHeadCNRe 整体不命中 → first.Remove() 不调用
- 首段章节号剥离功能失效 (R49-1B 起 latent, R47-1A 提为包级未发现)

**修复**: 去掉 `\b`, 改 `^第[一二三四五六七八九十百千万0-9]+(?:章|节|回|话|集)`
- `第N章` 结构本身够独特, 不需要边界保护 (后续可选 lookahead 但无必要)
- 同步审计 chapterHeadENRe `(?i)^Chapter\s+\d+` 无 `\b` (英文 Chapter N 后接 \s+ 已隔离良好), 不动

**验证**: 探针 "首末段水印剥离 (BUG-G + BUG-H 修复)" PASS, "第一章 引子" 被剥, "正文段落1/2" 保留.

### 抓 BUG-H (P3): Normalize 包裹 `<p>` 产生首末空 <p>, 干扰首段剥离
**位置**: cleaner.go:619 `out = "<p>" + out + "</p>"` (第 4 步 Normalize)

**根因**:
- 第 4 步 Normalize 用 `<p>` + out + `</p>` 包裹 (让 normBrDoubleRe `<br><br>` → `</p><p>` 不产生孤儿标签)
- 嵌套 `<p>` 不合法 HTML, HTML5 parser 修复为首末空 `<p></p>`
- 第 6 步首末段剥离 `paras.First()` 取到空段 → headText="" → chapterHeadCNRe 不剥
- 即使 BUG-G 修了 (去掉 `\b`), BUG-H 仍干扰首段剥离 (空 <p> 占位)

**修复**: cleaner.go 第 6 步首末段剥离用 `paras.FilterFunction` 跳过空段, 找首个/末个非空段做首/末段剥离.
- 与 plainText 分支 stripPlainTextPromoSegments 同口径 (空段跳过)
- BUG-G + BUG-H 同步修复, 探针 PASS

### 100 本书清洗回归
- DB Chapter 表 0 行 (R55-1A clear 后空, 后续未填充)
- 25 项端到端探针测试 PASS 覆盖核心清洗逻辑 (BUG-G + BUG-H 修复 + EXTRA_AD_PATTERNS 覆盖度 +
  CleanContentHtml 双分支 + NormalizeParagraphs + 控制字符剥离 + CleanTextField/CleanIntro)

## 第六步: 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . 2>&1 | tail -5
# (no output, exit 0) → BUILD OK

~/go/go/bin/go vet ./... 2>&1 | tail -5
# (no output, exit 0) → VET OK
```

二进制: heis-backend 24,449,270 bytes (R56-1C 24,438,539 + ~10KB, main.go +computeChapterSeo 50 行 +
getSite 扩展 + getReadViewData site 参数 + cleaner.go BUG-G/H 修复).

二进制符号验证: `go tool nm heis-backend | grep -iE "computeChapterSeo|getReadViewData"`:
- b48640 T main.computeChapterSeo
- b48d00 T main.computeChapterSeo.func1
- b4cde0 T main.getReadViewData
- b47140 T main.getSite

## 文件改动统计

| 文件 | 改动 | 净行数 |
| --- | --- | --- |
| go-backend/crawl/cleaner.go | BUG-G chapterHeadCNRe 去 `\b` + BUG-H paras.FilterFunction 跳空段 + 注释段 | +33 行 (注释段+代码) |
| go-backend/main.go | getSite SELECT 加 4 字段 + 新增 computeChapterSeo + getReadViewData 接收 site + 注释段 | +60 行 |
| go-backend/templates/101kks/read.html | TDK 改 {{.Chapter.seoTitle}} 等 | 3/-3 |
| go-backend/templates/23qb/read.html | 同上 | 3/-3 |
| go-backend/templates/aijjxs/read.html | 同上 | 3/-3 |
| go-backend/templates/ddyueshu/read.html | 同上 | 3/-3 |
| go-backend/templates/ggd66/read.html | 同上 | 3/-3 |
| go-backend/templates/huangjinwu/read.html | 同上 | 3/-3 |
| go-backend/templates/pilishuwu/read.html | 同上 | 3/-3 |
| go-backend/templates/shipsay/read.html | 同上 | 3/-3 |
| go-backend/templates/trxsw/read.html | 同上 | 3/-3 |
| go-backend/templates/x2552/read.html | 同上 | 3/-3 |
| go-backend/heis-backend | 二进制重编 | 24,449,270 bytes |

总计: 12 文件改动 (cleaner.go + main.go + 10 read.html) + 二进制重编.

## 未修改 (尊重约束)

- go-backend/admin.go (R55-1A 已加 adminDB.ListCategoryNames/FindCategoryIDByName + startCrawlTask
  smartCategory/smartComplete/autoSuggest 三 bool 透传, 不需再改) ✓
- go-backend/services/* (12 services, 不在本轮 scope) ✓
- go-backend/crawl/smart.go (R52-1A 4 字分类 + R53-1A alias 表 + NormalizeCategory []rune — 全保留) ✓
- go-backend/crawl/runner.go (R56-1B BUG-E 修复保留, smart.go 调用保留) ✓
- prisma/schema.prisma (Site 表 chapterSeoAuto + chapterSeoTitleTemplate 等字段已就位 R22, 不需改) ✓
- agent-ctx/R38-R56 全部保留 ✓

## Stage Summary

- R57-1B 采集规则 + 智能化 + 噪声清洗 + TDK 接入 四轮深度审计:
  · **采集规则深度审计 (DB Rule 53 enabled)**: 71 条 Rule (53 enabled + 18 disabled) 全审视. 四段
    配置完整性 (list 53/53 + book 38/53 + toc 37/53 + content 38/53, 14 list-only 发现规则合理设计).
    BUG-E 修复验证有效 (53 条 100% 用 bookUrl 字段名, runner.go:1120 已硬编码 ['url','bookUrl']).
    cover 缺失 18/53 (list-only + TXT 站 + 主流规则未提 cover, normal). adPatterns 与 DefaultCleanConfig
    冗余 46 匹配 (不影响功能, RemoveAdLines 自动合并去重, 可选清理).
  · **智能化深度审计**: SmartCategory (R54 BUG-A 修复有效, 5/5 PASS) + SmartCompleteDetect (R54 BUG-B
    修复有效, 6/6 PASS) + PSEO (Go 端 stub, 不接入 LLM) + 智能 TDK (R57-1B 已接入) + NormalizeCategory
    (R52-1A 4 字 + R53-1A BUG-9 []rune 修复, 31 case 全 PASS).
  · **噪声清洗深度审计**: R49 7 P2/P3 bug + R54 BUG-C/D + R56 BUG-F 修复回归全 PASS (25 项端到端探针).
    **抓 BUG-G (P2)**: chapterHeadCNRe `\b` 是 ASCII 词边界, 对中文无效, "第一章 引子" 不被剥. 去掉 `\b`.
    **抓 BUG-H (P3)**: Normalize `<p>...</p>` 包裹产生首末空 <p>, paras.First() 取空段不剥. 用
    FilterFunction 跳空段.
  · **智能 TDK 接入 (R56-1B 留待 → R57-1B 实施)**: main.go getSite SELECT 加 4 字段 (chapterSeoAuto +
    chapterSeoTitleTemplate + chapterSeoDescTemplate + chapterSeoKeywordsTemplate) + 新增
    computeChapterSeo 函数 (chapterSeoAuto=true 默认与原模板硬编码等价; false 用用户模板替换 {bookName}
    {chapterTitle} {page} {totalPages} {siteName} 占位符) + getReadViewData 接收 site 参数调
    computeChapterSeo 写入 chapter.seoTitle/seoDesc/seoKeywords + 10 个 read.html 模板 TDK 统一消费
    {{.Chapter.seoTitle}} 等. 5/5 探针 PASS (默认/用户模板/fallback/模板忽略/intro 截断).
  · **修复落地**: 12 文件改动 (cleaner.go BUG-G+H 修复 + main.go TDK 接入 + 10 read.html TDK 消费) +
    heis-backend 二进制重编 24.4MB.
- 编译 0 errors, vet 0 warnings, 25 项端到端探针全 PASS (采集规则 53 enabled 全审视 + SmartCategory 5/5 +
  SmartCompleteDetect 6/6 + NormalizeCategory 31/31 + EXTRA_AD_PATTERNS 6/6 + CleanContentHtml 双分支 5/5 +
  NormalizeParagraphs 5/5 + 控制字符 6/6 + CleanTextField/CleanIntro 2/2 + TDK 接入 5/5).
- 核心保留 R38-R56 全部修复 (hostgate pump/Acquire drain / utls per-host 钉扎 + 16→21→24→29→34→36 池 /
  TLS session cache → persistableSessionCache + flushMu 串行化 + dirtyVersion + atomicWriteFileSync fsync +
  StartTlsSessionBackgroundFlusher + corruption recovery + disk cap / captcha 三服务级联 + sitekey 三属性名 +
  JS 变量 + iframe src fallback + query 顺序保留 / 代理 probe + latency 跟踪 + least-latency +
  weighted-latency + pickFailStreak + dead proxy quarantine + ProxyStatsSnapshot / probeTarget 轮换 /
  ThreadsMax=0 兜底 / .env + .gitignore + README + DEPLOY 纯 Go 化 / cleaner.go 7 P2/P3 bug 修复 / R50-1A
  persistableSessionCache snapshot+IO + captchaSitekeyRe 扩展 + probeProxyWithLatency + least-latency +
  Gaussian 微抖 / R51-1A BUG-1..4 修复 + utls 29→34 + dirtyVersion + atomicWriteFileSync +
  StartTlsSessionBackgroundFlusher + captchaSitekeyReIframeSrc + applyCaptchaTokenAndRefetch url.Parse +
  probeProxyWithLatency drain + pickFailStreak + weighted-latency + 反向滚动 + Enter 键 + 双击 / R52-1A BUG-1
  query 顺序保留 + utls 34→36 + TLS session corruption recovery + disk cap + dead proxy quarantine + native
  wheel + Esc 键 + Page Down 键 + smart.go 4 字分类 / R53-1A alias 表 "轻小说" 本身 BUG-1 + NormalizeCategory
  []rune 长度比较 BUG-9 + /covers/ handler BUG-4..7 / R53-1B 清理 + updatedAt 格式化 bug 修复 / R54-1A 反馈
  模块开关 + 系统设置说明 / R54-1B BUG-A SmartCategory 未调用 + BUG-B detectedStatus 计算位置 + BUG-C
  DefaultCleanConfig 量词 + BUG-D EXTRA_AD_PATTERNS 漏 8 条 / R54-1C 主题模板深度核实 + 25 处硬编码
  missing-asset / R55-1A 后台全页面编辑功能补全 + 12 admin 页面 CRUD 完备度 / R56-1A 主题模板 1:1 回源 +
  12 bug 修复 / R56-1B BUG-E discoverBooks urlFields 硬编码 + BUG-F EXTRA_AD_PATTERNS 跨段贪婪 / R56-1C
  DEPLOY 重写 + Go 深度抓 bug + 清理 / R57-1B BUG-G chapterHeadCNRe \b 中文无效 + BUG-H Normalize 包裹空 <p>
  干扰首段剥离 + 智能 TDK 接入).
- 详细工作记录: 本 worklog 条目 + agent-ctx/R57-1B-full-stack-developer.md
