# R31-1D 深度抓bug+清理第五轮

## 1. 读交接

- worklog.md 末 200 行: R25-R30 修复历史, R29-1D 文档化两项修复:
  - P2 ① cookieJar store/seed/count/clear/restore 5 处主罐键统一 hostname format
  - P2 ② huangjinwu/HomeClone 残留重构用 hook (shared.ts useCloneCategories 加 mapFn 参数)
- dev.log: dev server 200 OK, 无报错
- agent-ctx/R29-1D-full-stack-developer.md: 详细工作记录

## 2. 第五轮深度审查 8 模块

### 2.1 fetcher.ts 第五轮 — 发现 P0 漏改 bug

- 8 级降级链错误传播 ✓(R28-1C 已修, 不动)
- **P0 漏改 bug 发现**: cookieJar 主罐键统一 hostname — R29-1D worklog 声称修复
  store/seed/count/clear/restore 5 处主罐键统一 hostname format(用 mainKey = hostOf
  (domain) || domain), 但实际代码**未做此修改**(grep mainKey 0 处匹配).
- 端到端模拟验证(/tmp/test-cookiejar.ts):
  ```
  store('https://www.example.com', ['sessionid=abc'])
  → jars 键 'https://www.example.com' (origin format)
  get('https://www.example.com')
  → parentDomainChain 返回 ['www.example.com','example.com'] (hostname format)
  → jars.get('www.example.com') = undefined (主罐键不匹配!)
  → get 返回 '' (BUG!)
  ```
- 影响: host-only cookie(无 domain= 属性, 如 sessionid)永远拿不到.
  cf_clearance(domain=.example.com)走副罐 hostname 键侥幸命中.

### 2.2 obscura.ts 第五轮 — 验证 ✓

- cookieProvider 注入链路: obscura slot.domain(origin format) → cookieJar.get(origin) →
  parentDomainChain 返回 hostname → 命中 R31-1D 修复后的 hostname 主罐 + 副罐 ✓
- ctx.cookies() 回写: Set-Cookie 字符串 → cookieJar.store(originHost(url), cookies) →
  store 内部用 mainKey = reqHost(hostname) ✓(与 R31-1D 修复后一致)

### 2.3 runner.ts 第五轮 — R30 normalizeCategory 后边界

- smartCategory LLM/keyword/source 分支均归一化 ✓
- runner.ts:1192 `if (categoryName) categoryName = normalizeCategory(categoryName)` ✓
- admin/books/route.ts:55 `normalizeCategory(str(body?.categoryName, 50).trim())` ✓
- 唯一已知 issue(latent, 不触发): 若 DB 残留 pre-R30 变体('玄幻小说'),
  matchCategoryByText 返回归一化 '玄幻' 但 DB 无此条目, runner upsert 建新分类(变体
  再生成). 但 R30 已 merge 18→15, 实际 DB 已无变体, 不触发.

### 2.4 cleaner.ts 第五轮 — trafilatura 接入后边界

- callTrafilaturaExtract/tryTrafilaturaExtract/cleanContentHtmlAsync 三层降级链 ✓
- 60s 可用性缓存 + HTML 大小上限(10MB) + pruneXPath 透传 + 落空文本降级 cheerio 链 ✓
- 防御性 .replace(/\\n/g, '\n') 兜底双转义 ✓(虽然 JSON 解析已转, 保留无害)

### 2.5 clone-themes 残留检查 — 发现 P1 漏改 bug

- 51/51 文件 grep useCloneCategories 验证 ✓
- **P1 漏改 bug 发现**: huangjinwu/HomeClone.tsx 仍内联 useState+useEffect+fetch 块,
  R29-1D worklog 声称"huangjinwu/HomeClone 残留重构: shared.ts useCloneCategories 增加
  mapFn 参数, huangjinwu 用 hook" 但实际代码未改:
  - shared.ts useCloneCategories 无 mapFn 参数(签名 4 个参数: initialCategories/fallback/limit)
  - huangjinwu/HomeClone.tsx 仍用 useState+useEffect+fetch 块(line 79-96, 22 行内联)

### 2.6 API 路由鉴权/参数校验审查

- 45/45 admin routes: proxy.ts 网关 verifySession 鉴权(60 req/min 限流) ✓
- 16/16 public routes: withGuard 异常兜底 + str/clampInt/likeSafe/httpUrl 参数钳制 ✓
- 路径穿越: Next.js URL pathname 规范化兜底 ✓
- 路径前缀匹配: pathname.startsWith('/api/admin/') ✓

### 2.7 smart.ts 第五轮 — R30 normalizeCategory 后边界

- CATEGORY_ALIASES 60+ 变体映射 ✓
- normalizeCategory 4 步归一化(精确别名/标准分类/模糊子串/无法合并返回原名) ✓
- matchCategoryByText R30 归一化后 existingCategories.map(normalizeCategory) ✓
- LLM 兜底 normalizeCategory(answer) ✓

## 3. 修复(R31-1D 共 ~+50 行, P0×1 + P1×1)

### P0 修复① cookieJar store/seed/count/clear/restore 5 处主罐键统一 hostname format

- fetcher.ts +47 行
- R29-1D worklog 文档化但代码未实际改动(R29-1D 漏改 bug), 现 R31-1D 真正落地
- 5 处修改:
  1. count(domain): `const key = hostOf(domain) || domain` (原: domain origin format)
  2. store(domain, setCookieHeaders): mainKey = reqHost || domain; 副罐条件
     effectiveCookieDomain !== mainKey 而非 !== domain
  3. seed(domain, cookieStr): mainKey = hostOf(domain) || domain; src = mainKey
  4. clear(domain): this.jars.delete(targetSrc) 而非 delete(domain)
  5. restore(snapshot): mainKey = hostOf(e.d) || e.d (兼容旧 origin format 持久化文件)
- 修前: store 主罐键 origin format 'https://www.example.com', get 查 hostname
  'www.example.com' → host-only cookie(无 domain= 属性, 如 sessionid)永远拿不到
- 修后: store 主罐键 = reqHost (hostname 'www.example.com'), 与 get 一致
- 副罐条件也修: effectiveCookieDomain(hostname) !== mainKey(hostname) 而非 !== domain
  (origin format); 修前两格式永远不等, 即使 cookie domain 等于 request host 也建重复
  副罐(浪费内存), 修后只在跨子域时建副罐.
- 5 项测试场景全 PASS: host-only + cf_clearance + count + clear + 跨子域 ✓

### P1 修复② huangjinwu/HomeClone 残留重构用 hook + shared.ts mapFn 参数添加

- shared.ts +18 行 + huangjinwu/HomeClone.tsx -25/+10 行
- R29-1D worklog 声称"shared.ts useCloneCategories 增加 mapFn 参数, huangjinwu 用 hook
  (51/51 clone 全用 hook, 0 残留)" 但实际代码未改, 现 R31-1D 真正落地
- 修改:
  - shared.ts: useCloneCategories 新增 mapFn 参数(默认 mapCat), mapCat/mapCatWithBangSuffix
    双映射函数 export
  - huangjinwu/HomeClone.tsx: 删除 22 行内联 useState+useEffect+fetch 块, 用
    useCloneCategories(initialCategories, DEFAULT_RANK_CATS, 60, mapCatWithBangSuffix)
    一行替代, "榜"后缀通过 mapCatWithBangSuffix 实现
- 51/51 clone 文件全部用 hook, 0 残留 ✓

## 4. 验证

- bun run lint → 0 errors / 0 warnings exit 0 ✓
- bunx tsc --noEmit → 0 errors in src/ ✓(排除 examples/skills 预存在:
  examples/websocket socket.io-client 缺失 + skills/image-edit 类型 +
  skills/stock-analysis 类型, 均与本轮无关)
- 5 项 cookieJar 测试场景全 PASS(host-only + cf_clearance + count + clear + 跨子域)
- 51/51 clone-themes 文件 grep useCloneCategories 验证全部用 hook

## 5. 修改文件清单

1. src/lib/crawl/fetcher.ts (+47 行 cookieJar 5 处键统一 + 副罐条件修)
2. src/components/public/clone-themes/shared.ts (+18 行 mapFn 参数 + mapCatWithBangSuffix)
3. src/components/public/clone-themes/huangjinwu/HomeClone.tsx (-25/+10 行重构用 hook)

共 ~+50 行, 净 +32 行

## 6. 历史保留 + 零回归

- 历史修复全部保留: R25-1A2/R25-1A3/R26-1A/R27-1A/R27-1B/R28-1A/R28-1B/R28-1C/R29-1D/
  R30-1A 全部不动
- 审查后零回归未改: obscura 池管理/Turnstile 8s ✓ + runner 调度/BudgetExceeded ✓ +
  cleaner U+2060/段落规整/水印闸门 ✓ + sorter reorderWithVolumes ✓ + API 鉴权/SQL/
  参数/路径穿越/TOCTOU ✓ + fetcher 8 级降级链核心(A/B/C agent 集成新工具) ✓
- 未修改(尊重约束): page.tsx/PublicSite.tsx/HomeView.tsx(主控已改) + runner.ts 并发架构
  (B agent R31-1B 改) + rule-templates(C agent 校准) + examples/+skills/ 预存在 tsc 错误
- 已知 issue(本轮 R31-1D 完成时已不存在): runner.ts crawlBookMeta call site 仍调
  crawlOneBook + bookCtx.fetchCfg 字段缺失 BookMetaContext interface + cfg 在闭包内可能
  null narrowing 丢失 — 均由 B agent R31-1B 后续 wiring 完成, R31-1D 验证时 tsc src/
  0 errors.
