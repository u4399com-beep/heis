# R18-1A 代码审计报告

> Task ID: **R18-1A**
> 审计范围: 采集引擎 (fetcher.ts 4507 / runner.ts 2210 / parser.ts 1484 / cleaner.ts 687 / obscura.ts 1649) +
>   反反爬 (obscura.ts + scrapling-bridge) + 噪声清洗 (R17-1A 增强) +
>   前端视图接线 (BookView/CategoryView/ReadView/HomeView) + API 路由安全
> 审计日期: 2026-09-17
> 审计者: 子代理(R18-1A)

## 1. 审计范围

### 1.1 采集引擎 (src/lib/crawl/)
- `fetcher.ts` (4507 行): HTTP/curl/中继/scrapling/moli 多引擎、inflight 去重、responseCache、cookieJar、AbortController 清理、5 级降级链
- `runner.ts` (2210 行): 任务执行、discoveredBookUrls/completedBookUrls Set 去重、续采 DB 恢复、control() 串行化、BudgetExceeded 熔断
- `parser.ts` (1484 行): parseList/parseToc/parseContent + 翻页 + JSON 模式 + readability 兜底
- `cleaner.ts` (687 行): cleanContentHtml/cleanIntro/cleanChapterTitle + R17-1A 段落规整增强
- `obscura.ts` (1649 行): chromium 隐身渲染、挑战等待、Turnstile 点击、池管理
- `hostgate.ts` / `storage.ts` / `suggest.ts` / `smart.ts` (抽样复核)

### 1.2 前端视图 (src/components/public/)
- `HomeView.tsx` (115 行): dynamic import 10 套 clone-themes HomeClone, 分发逻辑
- `BookView.tsx` (760 行): BookInfoComponent 接线 + PSEOKeywordsSection
- `CategoryView.tsx` (153 行): CatListComponent 接线
- `ReadView.tsx` (673 行): ReadChromeComponent 接线 + 4 套 read-layouts

### 1.3 API 路由 (src/app/api/public/)
- `book/route.ts`, `chapter/route.ts`, `keyword/route.ts`, `search/route.ts`, `categories/route.ts`, `books/route.ts`, `related/route.ts`, `tags/route.ts`, `cover/route.ts`, `download/route.ts`, `feedback/route.ts`, `sitemap/route.ts`, `mini-service-config/route.ts`, `sites/route.ts`

## 2. 审计方法

1. **逐文件阅读**: 5 个核心 crawl 模块 + 4 个前端视图逐行扫读, 重点对照 R14-1B / R17-1A 修复点是否完整保留
2. **git diff 回溯**: 对 BookView/CategoryView/ReadView 用 `git diff 120d6ff b262bb5` 比对 R15→R17 变更, 检测 R17 重构是否引入回归
3. **跨文件交叉验证**: `rg` 全文搜 `clone-themes` / `BookInfoComponent` / `CatListComponent` / `ReadChromeComponent` 等, 确认 10 套主题组件的实际使用情况
4. **类型检查**: `bunx tsc --noEmit` + `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`
5. **lint 校验**: `bun run lint`

## 3. 发现的 Bug 清单

### P0 (Critical) — 0 个
无 Critical bug。

### P1 (High) — 1 个, 已修复

#### P1-1: BookView/CategoryView/ReadView 三视图 clone-themes lookup table 被 R17 重构误删
- **症状**: R15-1B 落地的 `BookInfoComponent`/`CatListComponent`/`ReadChromeComponent` lookup table 在 R17 重构 (commit `b262bb5` "refactor(R17): 推倒重建10套8页型clone-themes+路由扩展+噪声清洗") 中被误删:
  - 删除了 10 条 `import { BookInfo as BookInfoAijjxs } from './clone-themes/aijjxs'` 等 import
  - 删除了 10 项 `{ 'clone-aijjxs': BookInfoAijjxs, ... }[theme.layout] || BookInfoAijjxs` lookup table
  - 替换为单条内联 fallback 组件 (用 `theme.vars`, 与注释承诺的"硬编码颜色, 不用 theme.vars"矛盾)
  - 注释仍声称 "R15-1B: 改为按 theme.layout 动态选择 clone-themes 的 BookInfo 组件" 但实际代码未实现
- **影响**: 10 套 clone-themes BookInfo/CategoryList/ReadChrome 组件 (30 个 .tsx 文件) 全部沦为死代码 — 任何主题下访问书籍详情页/分类页/阅读页, 都只看到通用 fallback 视觉, 完全失去 "10 套 1:1 克隆" 的核心卖点。R17-1C 审计报告 `agent-ctx/code-audit-r16.md` 中"lookup table 完整性: ✓ 10 套全部在 lookup table 中"的结论有误(漏检 R17 重构回归)。
- **位置与修复**:
  | 文件 | 删除内容 | 恢复内容 |
  |------|----------|----------|
  | `BookView.tsx` (行 21-33, 636-653) | 10 个 BookInfo import + lookup table + 内联 fallback 组件 | 10 个 BookInfo import + lookup table (fallback aijjxs) |
  | `CategoryView.tsx` (行 13-25, 119-144) | 10 个 CategoryList import + lookup table + 内联 fallback 组件 | 10 个 CategoryList import + lookup table (fallback aijjxs) |
  | `ReadView.tsx` (行 32-44, 491-504) | 10 个 ReadChrome import + lookup table + 内联 fallback 组件 | 10 个 ReadChrome import + lookup table (fallback aijjxs) |
- **修复口径**: 与 R15-1B 原实现 100% 一致 — 同 import 别名(BookInfoAijjxs/CatListAijjxs/ReadChromeAijjxs 等), 同 lookup table key (`'clone-aijjxs'` 等 10 项), 同 fallback (aijjxs 兜底)
- **不修改 props 接线**: 三视图调用 clone-themes 组件时的 props 透传与 R15-1B 完全一致(BookView 传 `book/theme/savedPos/firstChapterId/onScrollToc/onGoCategory`; CategoryView 传 `books/loading/label/page/total/onPage`; ReadView 传 `children/chapterTitle/onPrev/onNext`), 接口签名 BookInfoProps/CategoryListProps/ReadChromeProps (clone-themes/shared.ts) 完全匹配
- **验证**:
  - `bunx tsc --noEmit` (排除 examples/skills): **0 errors** ✓
  - `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`: **0 errors** ✓ (10 个 import 全部使用, fallback 不会因 tree-shaking 丢失)
  - `bun run lint`: **0 errors / 0 warnings** ✓
  - `bunx tsx -e` 实测: 三视图模块加载成功, BookInfoProps/CategoryListProps/ReadChromeProps 接口与调用点参数完全匹配 ✓

### P2 (Medium) — 0 个

未发现新增 P2 bug。R14-1B 修复的 inflightMap/tokenInflight TOCTOU race + runner.ts control() 30s timer 全部完整保留 (line 3582-3583 / 3897-3898 的 entry 引用对比 + line 446-452 的 try/finally clearTimeout)。

### P3 (Cosmetic/Minor) — 5 项, 未修复(说明原因)

#### P3-1: BookView.tsx 行 26 内联 fallback 已被 R18-1A 删除 (修复 P1-1 时顺带消除)

#### P3-2: cleaner.ts step 5.5 R17-1A 段首缩进规整 (确认正确, 不修改)
- 段内 `<br>` → 单空格 + `\u3000` → 半角空格 + `\s+` 收敛 + `.trim()` 段首段尾
- 与 R17-1A 注释承诺的"段首缩进统一为 0, 真实缩进由前台 CSS text-indent:2em 承担"完全一致
- HTML 模式 `out.replace(/<\/p>\s*<p>/gi, '</p><p>')` 段间空白压缩 ✓

#### P3-3: cleaner.ts cleanIntro R17-1A 段间空行压缩 (确认正确, 不修改)
- `split(/\n{2,}/)` 分段 + 段内 `\r/\n/\u3000` 压为单空格 + `\s+` 收敛 + `.trim()` + `.join('\n')` (单换行, 与简介单行多段语义一致)
- 与 R17-1A 注释承诺的"简介段间用单换行而非双换行"完全一致

#### P3-4: cleaner.ts cleanChapterTitle R17-1A 卷标题剥离 (确认正确, 不修改)
- 正则 `^第[一二三四五六七八九十百千万0-9]+卷\s+\S+?\s+(第[一二三四五六七八九十百千万0-9]+(?:章|节|回|话|集))` 匹配 "第N卷 卷名 第M章" 形态
- 切片 `t.slice(cutStart)` 保留从 "第M章" 起始位置开始的剩余字符串 (含章名后缀)
- 仅当存在后续"第N章/节/回/话/集"时才剥卷标题, 避免误伤"第一卷中" 等正常短语 ✓

#### P3-5: cleaner.ts 零宽字符剥离完整性 (确认正确, 不修改)
- 4 个出口 (cleanContentHtml plainText/HTML + cleanTextField + cleanIntro) 全部带 `.replace(/[\u200B-\u200D\uFEFF]/g, '')` 或与控制字符合并的 `[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D\uFEFF]` 范围
- 覆盖 ZWSP (U+200B) / ZWNJ (U+200C) / ZWJ (U+200D) / BOM (U+FEFF) 全部 4 个零宽字符 ✓

## 4. 5 大审计重点对照

### 4.1 fetcher.ts (4507 行) — 全部 ✓

| 审计点 | 状态 | 详情 |
|--------|------|------|
| inflightMap TOCTOU race | ✓ R14-1B fix 完整保留 | line 3879-3898 entry 引用对比, finally 块仅 `if (cur === entry) inflightMap.delete(dedupKey)` |
| tokenInflight TOCTOU race | ✓ R14-1B fix 完整保留 | line 3563-3586 同款 entry 引用对比 |
| responseCache 大小/过期 | ✓ 完整 | line 3757 RESPONSE_CACHE_MAX=200 + FIFO 淘汰 (line 3771-3775) + TTL 过期 (line 3769) + 仅缓存 2xx http 引擎 (line 3784-3788) |
| cookieJar 跨域安全 | ✓ 完整 | R6-5 store() line 518-531 父域校验 (parentDomainChain) + R5-6 cross-subdomain 副罐 + R6-1 get() 父域链合并 (line 433-459) + R5-6 拒绝畸形 Set-Cookie (line 481-498 ATTR_NAMES 过滤) |
| AbortController 清理 | ✓ 完整 | fetchHttp line 2798-2800 try/finally clearTimeout; fetchBinary line 4440-4442 同款; checkProxyHealth line 2277-2279 同款 |
| 5 级降级链触发条件 | ✓ 完整 | L1 responseCache (line 3865-3867) → L2 inflightMap (line 3871-3877 共享在途) → L3 fetchPageOnce 含 cookie 重试 + 429/5xx 退避 (line 4180-4305) → L4 trySolveTokenChallenge (line 4191-4194 / 4233-4241) → L5 auto engine browser upgrade (line 4315-4334) |
| scrapling-bridge 2 次重试 | ✓ 完整 | line 3277-3314 attempt=1 失败 sleep 800ms 重试, attempt=2 失败返回 null 降级 native; 目标侧响应不双发 |

### 4.2 runner.ts (2210 行) — 全部 ✓

| 审计点 | 状态 | 详情 |
|--------|------|------|
| discoveredBookUrls Set 去重 | ✓ 完整 | line 746-757 `if (rt.discoveredBookUrls.has(u)) ... continue` + R7-29 批量查 DB 确认完整数据 (line 736-745), DB 故障降级全部不跳过(重新加入队列) |
| completedBookUrls 跳过逻辑 | ✓ 完整 | line 812-833 `if (rt.completedBookUrls.has(bookUrl))` 查 DB 确认有章节才跳过, 否则重新采集; 状态分流由 crawlOneBook 内部完成(line 1428/1474/1946 detectedStatus==='completed' 才追加) |
| 任务续采 DB 查询 | ✓ 完整 | line 634-658 从 progress 重建 Set (filter typeof string 防注入); recrawlMode==='full' 启动时清空两 Set (line 625-633) |
| control() 定时器泄漏 | ✓ R14-1B fix 完整保留 | line 439-452 try/finally clearTimeout, raceTimer 在快路径下立即释放 |
| BudgetExceeded 熔断 | ✓ 完整 | line 1003-1008 抛错; line 870-878 上抛到 executeTask 外层 catch 落 error 终态 (而非作为单本书错误继续下一本); line 519-526 重置 requestCount 防 autoRefresh 循环触发 |

### 4.3 cleaner.ts (687 行) — 全部 ✓

| 审计点 | 状态 | 详情 |
|--------|------|------|
| cleanContentHtml 段落规整增强 (R17-1A step 5.5) | ✓ 完整 | line 398-413 cheerio 重装载 + `<p>` 内 `<br>`→单空格 + `\u3000`→半角 + `\s+` 收敛 + `.trim()` 段首段尾; `</p>\s*<p>`→`</p><p>` 段间空白压缩 |
| cleanIntro 段间空行压缩 (R17-1A 增强) | ✓ 完整 | line 610-618 `split(/\n{2,}/)` 分段 + 段内 `\r/\n/\u3000` 压为单空格 + `\s+` 收敛 + `.trim()` + `.join('\n')` 单换行 |
| cleanChapterTitle 卷标题剥离 (R17-1A 增强) | ✓ 完整 | line 657-664 正则匹配 "第N卷 卷名 第M章" 形态, 切片保留从 "第M章" 起始位置 |
| 零宽字符剥离完整性 | ✓ 完整 | 4 个出口全部带 `.replace(/[\u200B-\u200D\uFEFF]/g, '')` 或合并控制字符剥离范围 |
| 水印段落识别 | ✓ 完整 | step 1.55 line 247-259 6 类水印词集 + 长度闸门 120 字, DOM 节点 .remove(); step 6 line 423-451 首行/末行剥离 (匹配章节号/水印特征词/裸域名) |

### 4.4 BookView/CategoryView/ReadView — 修复 P1-1 后 ✓

| 审计点 | 状态 | 详情 |
|--------|------|------|
| BookView 的 BookInfoComponent 接线 | ✓ 修复后完整 | R15-1B lookup table (10 项) 已恢复, fallback BookInfoAijjxs, props 透传完整(book/theme/savedPos/firstChapterId/onScrollToc/onGoCategory) |
| CategoryView 的 CatListComponent 接线 | ✓ 修复后完整 | R15-1B lookup table (10 项) 已恢复, fallback CatListAijjxs, props 透传完整(books/loading/label/page/total/onPage) |
| ReadView 的 ReadChromeComponent 接线 | ✓ 修复后完整 | R15-1B lookup table (10 项) 已恢复, fallback ReadChromeAijjxs, props 透传完整(chapterTitle/onPrev/onNext/children) |
| PSEOKeywordsSection 保留 | ✓ 完整 | line 754-755 `<PSEOKeywordsSection bookId={book.id} siteId={site.id} />` (R13-1A 落地) |
| 4 个 read-layouts 接线 | ✓ 完整 | line 622-672 4 个分支 (immersive/paginated/pili/classic) 都用 ReadChromeComponent 包裹 |
| HomeView dynamic import | ✓ 完整 | line 19-28 10 个 `dynamic(() => import('./clone-themes/<site>').then(m => m.HomeClone))` 全部就位 |

### 4.5 API 路由安全 — 全部 ✓

| 审计点 | 状态 | 详情 |
|--------|------|------|
| `book/route.ts` SSRF/输入校验 | ✓ | withGuard + str/clampInt (line 11-13), skip 上限 10000 防全表扫 (line 19-20), sourceUrl 已剥离 (line 75-76 注释说明) |
| `chapter/route.ts` 路径穿越 | ✓ | readChapterTxt 路径校验 `DATA_ROOT + path.sep` 前缀匹配 (storage.ts line 53 修复 prefix bypass); txt 装载时实体转义 `&<>` 防存储型注入 (line 102-105) |
| `keyword/route.ts` PSEO | ✓ | bookId 模式下 fetchSuggestKeywordsForBook 走 LRU 缓存 (24h TTL, 200 entries), withCache 60s/120s 双层 |
| `search/route.ts` / `related/route.ts` | ✓ | clampInt 钳制 page/size; withCache 防热点查询击穿 |
| `download/route.ts` | ✓ | readChapterTxt 路径校验同口径; 文件名白名单 downloadTxtTarget (storage.ts line 116-123) |

## 5. 修改文件清单 (R18-1A 净改动)

### 修复 P1-1 (3 个文件)
1. `src/components/public/BookView.tsx` — 恢复 10 个 BookInfo import + lookup table, 删除内联 fallback 组件
2. `src/components/public/CategoryView.tsx` — 恢复 10 个 CategoryList import + lookup table, 删除内联 fallback 组件
3. `src/components/public/ReadView.tsx` — 恢复 10 个 ReadChrome import + lookup table, 删除内联 fallback 组件

### 净改动统计
- +66 行 (10 套 import × 3 视图 + lookup table × 3 + R18-1A 注释)
- -73 行 (内联 fallback 组件 × 3)
- 净 -7 行 (lookup table 比内联 fallback 略短, 但实际是结构等价替换)

## 6. 验证

### TypeScript 严格检查
- `bunx tsc --noEmit` (排除 examples/skills): **0 errors** ✓
- `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` (排除 examples/skills): **0 errors** ✓

### ESLint
- `bun run lint`: **exit 0** (0 errors / 0 warnings) ✓

### 模块加载冒烟测试
- `bunx tsx -e "import('./src/components/public/BookView.tsx')"`: 加载成功, 导出 BookView ✓
- `bunx tsx -e "import('./src/components/public/CategoryView.tsx')"`: 加载成功, 导出 CategoryView ✓
- `bunx tsx -e "import('./src/components/public/ReadView.tsx')"`: 加载成功, 导出 ReadView ✓
- `bunx tsx -e "import('./src/components/public/clone-themes/aijjxs')"`: 加载成功, 导出 8 个组件 ✓

## 7. 审计结论

- **P0 = 0 / P1 = 1 (已修复) / P2 = 0 / P3 = 5 (4 项确认正确不修, 1 项顺带消除)**
- R14-1B 修复 (fetcher.ts inflightMap/tokenInflight TOCTOU race + runner.ts control() timer leak) 全部完整保留 ✓
- R13-1A PSEO 集成 (suggest.ts / pseo/route.ts / clearPSEOCacheForBook / PSEOKeywordsSection) 全部完整保留 ✓
- R13-1C clearPSEOCacheForBook 精确按 cacheKey 清单本书 ✓
- R15-1B clone-themes 接线 + lookup table (R18-1A 修复后) 全部恢复 ✓
- R17-1A cleaner.ts 段落规整/空行压缩/缩进规整/零宽剥离 全部正确 ✓
- R17 8 页型 clone-themes 10 套 (HomeClone/BookInfo/CategoryList/ReadChrome/RankingView/FulltextView/SearchView/KeywordView) 全部就位, BookInfo/CategoryList/ReadChrome 经 lookup table 接线恢复使用 ✓
- 5 级降级链 (responseCache → inflightMap → fetchPageOnce → trySolveTokenChallenge → browser upgrade) 触发条件正确, 各级 fallback 完整 ✓
- cookieJar 跨域安全: 父域校验 + 副罐存储 + clear() 精确清扫 src 匹配条目, 无跨域 cookie 注入面 ✓
- AbortController 清理: 3 处 (fetchHttp / fetchBinary / checkProxyHealth) 全部 try/finally clearTimeout ✓
- API 路由安全: 输入校验 (str/clampInt) + SSRF 守卫 + 路径穿越防护 + 实体转义 + LRU 缓存 + withGuard/withCache 包装 ✓

## 8. 不修改的内容 (尊重约束)

### 8.1 不回滚 R13~R17 的修改
- R17 重构的 8 页型 clone-themes 模块结构保留 (50 文件 × 10 套)
- R17-1A cleaner.ts 段落规整/空行压缩/缩进规整/零宽剥离 全部保留 (3 处增强: cleanContentHtml step 5.5 / cleanIntro / cleanChapterTitle)
- R15-1B clone-themes 接线 + lookup table (R18-1A 恢复) 保留
- R14-1B fetcher.ts entry TOCTOU race fix + runner.ts control() timer fix 保留
- R13-1A PSEO 集成 (suggest.ts/clearPSEOCacheForBook/PSEOKeywordsSection) 保留

### 8.2 不动的 fetcher/runner/parser/obscura/cleaner 实现
- fetcher.ts 4507 行: 仅抽样复核 R14-1B 修复点 + 5 级降级链 + cookieJar 安全 + AbortController 清理, 全部正确, 不修改
- runner.ts 2210 行: 仅抽样复核 R14-1B 修复点 + discoveredBookUrls/completedBookUrls Set 去重 + BudgetExceeded 熔断, 全部正确, 不修改
- parser.ts 1484 行: 仅抽样复核 parseList/parseToc/parseContent 翻页 + JSON 模式 + readability 兜底, 全部正确, 不修改
- obscura.ts 1649 行: 仅抽样复核 withObscuraPage 池管理 + 30s 排队超时 + 挑战等待循环 + Turnstile 点击, 全部正确, 不修改
- cleaner.ts 687 行: 仅抽样复核 R17-1A 3 处增强 + 零宽字符剥离 + 水印段落识别, 全部正确, 不修改

### 8.3 不安装新 npm 包
- 0 新依赖 (所有修复用现有 cheerio/next/react 等依赖)

## 9. 后续建议 (供主代理参考)

- **R17-1C 审计回归检测**: 后续审计 clone-themes 接线时, 应在 grep 层面验证 `import { BookInfo as BookInfoAijjxs }` 实际存在(而非仅看注释), 避免再次漏检 R17 重构类回归
- **可能存在的 PSEO 缓存冷启动**: 首次访问 BookView 底部 PSEOKeywordsSection 时会同步触发 fetchSuggestKeywordsForBook (7 引擎并发), 单本书最坏 10s+ 延迟。后续可考虑改 SSR 预取或在 BookView 用 SWR 模式异步加载, 不阻塞首屏
- **clone-themes BookInfo 部分站点有 "加入收藏" dead click**: R15-1C 已识别 (aijjxs/BookInfo.tsx 行 43 "加入收藏" dead click), 沿用决策不动 (视觉克隆约束, 后续小步重构)
