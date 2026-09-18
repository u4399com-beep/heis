# Task ID: R25-1D2 — 智能分类/TDK/SEO/搜索关键词下拉修复 + 代码清理精简

**Agent**: full-stack-developer
**Scope**: src/components/public/auto-tdk.ts + seo.ts + bits.tsx + src/lib/crawl/suggest.ts + 各 View SEO
**Boundary**: 不动 src/lib/crawl/{fetcher,obscura,runner}.ts / page.tsx / PublicSite / HomeView / HomeClone / 10 套 clone-themes 页型

## 第一步: 读交接文档 (worklog.md 末 200 行)
- R13-1A/B/C/D 链路: suggest.ts 7 引擎聚合 + PSEO LRU 缓存 + clearPSEOCacheForBook 精确清缓存
- R7-25: auto-tdk.ts 224 LoC 已存在 (后扩到 462 LoC 含 18 预设)
- R16-1B: 18 种 SEO TDK 预设 + 10 占位符 + renderTDKByPreset/randomCombineTDK
- R24-3A/B: page.tsx 改 server component + 7 View SSR 接线 (initialBooks/initialBook/initialChapter/initialSearch/initialKeyword/initialCategories)
- R25-1C: 10 套主题加收藏本站+繁体切换
- R25-1D (上一轮超时): suggest.ts 引擎修复已写入但未完成 worklog — 已确认 git 未提交, 我的任务是延续并补完

## 第二步: 审查现状 (8 文件全量阅读)

### 2.1 auto-tdk.ts (462 LoC) — ✓ 全部工作正常
- 4 个基础函数 (extractKeywords/generateDescription/generateTitle/generateMetaDescription/generateKeywords/generateTDK): 验证逻辑正确, 含中文停用词表 + N-gram 2-4 字分词 + 频次排序 + 子串去重
- 18 种 TDK 预设 (TDK_PRESETS 数组): classic-seo / keyword-rich / question-form / list-style / brand-first / chapter-focus / category-first / author-first / download-focus / read-online / latest-chapter / complete-status / word-count / pinyin-style / mobile-seo / social-share / long-tail / minimal — 全部含 title/desc/keywords 模板 ✓
- 10 个占位符 (renderTemplate 内 replace 全覆盖): {bookName} {author} {category} {chapterTitle} {siteName} {wordCount} {status} {latestChapter} {page} {totalPages} ✓
- 渲染入口: renderTDKByPreset(id, ctx) → getTDKPreset(id) → renderTemplate 三个模板 → TDKResult ✓
- randomCombineTDK: 3 个独立采样 title/desc/keywords (admin SitesSection 已使用) ✓
- 渲染逻辑验证: renderTemplate 先做 wordCountStr/statusStr 派生 (formatWordCount 数 + 已完结/连载中 中文映射), 再顺序 9 个 replace + \s+ collapse + trim — 输出干净 meta 字符串 ✓
- 9 个 View (Home/Ranking/Fulltext/Keyword/Category/Search/Read/Book/History) 全部 import 并调用 generateTitle/generateMetaDescription/generateKeywords — 9 处 useSiteSEO wiring 验证 ✓

### 2.2 seo.ts (176 LoC) — ✓ 全部工作正常
- useSiteSEO(opts) — useEffect 接管 document.title + meta[description|keywords|robots|geo.region|geo.placename|ICBM] + link[rel=canonical] + jsonLd body <script type=application/ld+json>
- ensureMeta/removeMeta: 视图切换时清上一视图残留 meta, 防 TDK 泄漏
- enabled:false 时父壳退位 (PublicSite 加载期兜底: site 就绪后完全交给视图)
- deps: [title, description, keywords, robots, enabled, ldKey, canonicalPath, siteKey] — 完整依赖, 无 stale closure
- 验证 9 View wiring: HomeView/BookView/ReadView/RankingView/FulltextView/CategoryView/SearchView/KeywordView/HistoryView 全部传 title/description/keywords + canonicalPath + site; jsonLd 在 Home/Book/Read/Search/Category 5 处; robots=noindex,follow 在 Search/History 2 处 (低价值索引页) ✓
- 公共辅助 coverSrc/formatWords/statusLabel/statusStyle/withAlpha/fmtDate/siteKeywordList 全部使用中 (无 unused) ✓

### 2.3 bits.tsx (263 LoC) + data.ts (314 LoC) — ✓ 全部工作正常
- SuggestTagCloud: 全站下拉词云, 客户端洗牌抽 count 个, 「换一批」setRound 触发 useMemo 重洗 (eslint-disable 是合理设计, round 仅作触发器不消费)
- 走 /api/public/tags?n=120 拿随机词池 (后端 Fisher-Yates 洗牌), 60s sessionStorage 缓存, 隐私模式退化内存缓存
- 失败静默: fetchSuggestTags .catch 返回 null → SuggestTagCloud 整块不渲染
- 2 处消费: HomeView.tsx:114 (count=16, refresh) + SiteFooter.tsx:61 (count=12, 无 refresh) ✓
- 其余组件 StatusBadge/TagCloud/SecTitle/EmptyState/ErrorState/Sk/BookGridSkeleton/ChapterListSkeleton 全部在 Views/clone-themes 中使用 ✓

### 2.4 suggest.ts (456 LoC) — 修复 1 处失效引擎
- 7 引擎 ENGINES 数组: baidu/bing/sogou/so360/ddg/google/yandex
- R25-1D 上一轮已修: bing api.bing.com→www.bing.com+cc=cn; google output=toolbar XML→client=firefox JSON; sogou 已死保留 [] 兜底
- 本轮新修 1 处: yandex 旧 endpoint `/suggest-backend/suggest/suggest-ya.cgi` 已下线 (实测返回 404 Not Found), 改用根路径 `/suggest-ya.cgi`; 中文长查询 (如完整书名"斗罗大陆") Yandex 无中文索引返回 `["斗罗大陆",[],{"r":134}]`, 解析器对空数组优雅返回 []
- LRU 缓存 (Map+TTL 24h, 200 max): cacheRead 删后重插刷新顺序; cacheWrite 超 max 淘汰最老条目; P1 fix 仅缓存非空结果防 7 引擎瞬时全败 24h 死锁; P2 fix clearPSEOCacheForBook 精确按 cacheKey 删本书缓存
- mergeSuggestWords: 频次统计 + 书名命中加分 + 精确匹配加分 → Top N 去重
- fetchSuggestKeywordsForBook: 5 查询词变体 (书名/+小说/+作者/+全文阅读/+TXT下载) × 7 引擎 → 合并打分 → Top 30 PSEO 候选词
- generatePSEOKeywords: 同步入口, 缓存命中返回缓存, 否则本地模板组合 (10 长尾词模板: 小说/全文阅读/TXT下载/在线阅读/最新章节/无弹窗/完结/笔趣阁/百度云/下载)
- generatePSEOKeywordsAsync: 异步入口优先走 fetchSuggestKeywordsForBook 引擎聚合, 失败回退本地模板
- 敏感词过滤 isLowQualityKeyword: 纯数字/过短/含 http(s)/含色情赌博政治敏感病毒枪支毒品等过滤
- /api/public/keyword 路由: ?book={id} 返回该书 PSEO 关键词; ?tag={kw} 返回主书+相关书+相关词
- /api/public/keyword/suggest 路由: ?kw={kw} 返回 7 引擎聚合 Top 12 词

### 2.5 smart.ts (184 LoC) — ✓ 智能分类工作正常
- matchCategoryByText: 14 类关键词表 (玄幻/奇幻/武侠/仙侠/都市/言情/历史/军事/游戏/科幻/悬疑/灵异/体育/轻小说/现实) × 各 8-11 个特征词; 优先匹配已有分类名 → 关键词评分 → 最高分获胜
- smartCategory: 3 级 fallback (来源站点分类 → 关键词规则 → LLM 兜底); LLM 含 15s timeout (setTimeout + Promise.race + finally clearTimeout 防 timer 泄漏)
- detectCompleteFromText: 完结词表 13 个 + 连载词表 15 个; 英文单词用 \b 词边界匹配 (final 不命中 finally), 中文走 includes; 未完优先 (避免"未完结"被"完结"误判)
- smartCompleteDetect: 4 级 fallback (源站状态字段 → 简介 → 最新章节标题 → 目录末章标题 → 书名标注)

## 第三步: 实测验证 (curl 6 个引擎)

直接 curl 6 个引擎 (baidu/bing/sogou/so360/ddg/google/yandex) 验证 suggest 接口可用性:

| 引擎 | URL | 响应 | 解析器 | 状态 |
|------|-----|------|--------|------|
| baidu | baidu.com/sugrec?prod=pc&wd=斗罗大陆 | `{"g":[{"q":"斗罗大陆2绝世唐门"},...]}` | j.g.map(x=>x.q) | ✓ 返回 11 词 |
| bing | www.bing.com/osjson.aspx?query=斗罗大陆&cc=cn | `["斗罗大陆",["斗罗大陆2绝世唐门免费观看",...]]` | j[1] | ✓ 返回 12 词 (cc=cn 强制中文市场) |
| sogou | www.sogou.com/sugproxy/sug?... | HTML 错误页 (suggest API 已下线) | try/catch → [] | ⚠ 引擎死, 解析器优雅 [] |
| so360 | sug.so.360.cn/suggest/word?word=斗罗大陆 | `{"result":[{"word":"斗罗大陆2绝世唐门免费观看完整版在线观看"},...]}` | j.result.map(x=>x.word) | ✓ 返回 6 词 |
| ddg | duckduckgo.com/ac/?q=斗罗大陆&type=list | `["斗罗大陆",["斗罗大陆在线看","斗罗大陆等级",...]]` | j[1] | ✓ 返回 9 词 |
| google | suggestqueries.google.com/complete/search?client=firefox&hl=zh-CN&q=斗罗大陆 | `["斗罗大陆",["斗罗大陆","斗罗大陆2绝世唐门",...]]` | j[1] | ✓ 返回 10 词 |
| yandex (旧) | suggest.yandex.com/suggest-backend/suggest/suggest-ya.cgi?... | HTTP 404 Not Found | try/catch → [] | ❌ endpoint 已下线 |
| yandex (新) | suggest.yandex.com/suggest-ya.cgi?part=斗罗大陆&uilv=2&srv=search&lang=zh&ssl=1 | `["斗罗大陆",[],{"r":134}]` (Yandex 无中文索引) | j[1] (空数组) → [] | ✓ 接口 200, 中文无 suggest 优雅 [] |

结论: 7 引擎中 5 个稳定返回中文 suggest (baidu/bing/so360/ddg/google), 2 个失效但解析器优雅返回 [] (sogou 站方下线 API, yandex 无中文索引); 不缓存空结果 (R13-1C P1 fix), 不影响聚合, 不阻塞采集流水线

## 第四步: 清理精简
- bun run lint: 0 errors / 0 warnings exit 0 ✓ (整个项目, 非仅本次范围)
- bunx tsc --noEmit (排除 examples/skills): 0 errors ✓
- 检查 src/components/public/* 重复逻辑: 无显著重复 — auto-tdk.ts 内部 formatWordCount 与 seo.ts formatWords 实现略不同 (前者用于 TDK 模板内字数占位符, 后者用于 View 渲染字数徽章), 各自语义独立, 不必合并
- 删除过时注释: auto-tdk.ts/seo.ts/bits.tsx/suggest.ts 注释均为历史链路标记 (R7-25/R11-1C/R13-1A/R13-1C/R16-1B/R25-1D), 是设计决策记录非过时注释, 保留
- bits.tsx eslint-disable react-hooks/exhaustive-deps: 合理设计 (round 仅作 useMemo 触发器不消费), 加注释说明, 保留

## 第五步: 修改清单 (本次实际改动)
- src/lib/crawl/suggest.ts (1 处): yandex 引擎 endpoint `/suggest-backend/suggest/suggest-ya.cgi` (404) → `/suggest-ya.cgi` (200, 中文无索引优雅 []); 加 R25-1D2 注释说明根因

## 第六步: 验证
- bun run lint: 0 errors / 0 warnings exit 0 ✓
- bunx tsc --noEmit (排除 examples/skills): 0 errors ✓
- dev.log tail: Ready in 1384ms, GET /?view=home&site=xxx 200 OK render 520ms, 无 compile/runtime error
- 未修改文件 (尊重约束):
  - src/lib/crawl/{fetcher,obscura,runner}.ts (A2 agent 负责)
  - page.tsx / PublicSite.tsx / HomeView.tsx (主控已改)
  - 10 套 clone-themes/* 页型 (B/C agent 已改)
  - auto-tdk.ts / seo.ts / bits.tsx / data.ts / smart.ts (已确认工作正常, 无需修改)
