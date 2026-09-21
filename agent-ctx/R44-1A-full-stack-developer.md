# R44-1A 工作记录 — full-stack-developer (探索sma规则+创建采集规则)

## 任务摘要
- Task ID: R44-1A
- 上游交接: R43-1A (3 个 Go mini-services curl-impersonate/trafilatura/cloak-browser) +
  R43-1B (utls Hello 指纹池 + MarkProxyFailed/OK + TwoCaptcha) + R43-1C (清理 scripts/
  65 文件全删 + src/ 350 文件删 + agent-ctx pre-R38 删 + .gitignore + next.config.ts 修
  pseudostatic import) + R44-1B (DEPLOY.md 完全重写 516→591 行 Go 单二进制部署链路).
- 范围: 探索 sma.yueyouxs.com (神马小说/阅友系 SPA) 采集规则 + 创建
  scripts/seed-rule-yueyouxs.ts 入库 (4 段 list/book/toc/content + fetch + clean).
- 不碰: go-backend/* (Go 代码, 含 crawl/parser.go+runner.go 只读探查不修改) + 其他
  seed-rule-*.ts (R43-1C 已全删) + docker/autofill-rules.json + prisma/schema.prisma +
  package.json + next.config.ts.

## 详细工作日志

### 1. 交接读 + 工具链确认

- 读 agent-ctx/R43-1A-full-stack-developer.md: 3 个 Go mini-services 重写 (curl-
  impersonate-bridge 3018 / trafilatura-bridge 3019 / cloak-browser 3020), utls 替代
  curl_cffi + go-readability 替代 Trafilatura + chromedp 替代 puppeteer-extra-stealth.
  自检 8/11 true (moli/cloak/trafilatura false 是预期, 不影响 /health 200).
- 读 agent-ctx/R43-1C-full-stack-developer.md: scripts/ 65 文件全删 (34 个 seed-rule-*.ts
  + 5 verify-*-docker + 8 qq-rules + verify-zz/kk/ll/ss + test-themes + fix-aijjxs +
  ratelimit-site + mock-novel-site + probe-all + batch-update-clones + export-autofill-rules
  + seed.ts + seed-rules-v2 + seed-rules-import-all + seed-batch2-latest + seed-rule-homepage-
  latest-batch1). agent-ctx 4.3MB→148KB (102 文件删至 10). next.config.ts 删 broken import
  ./src/lib/pseudostatic (R42-1C 删 src/ 时遗留). mini-services/ 仅保留 start/stop/status
  .sh + .gitkeep.
- 读 worklog.md tail (R44-1B): DEPLOY.md 516→591 行完全重写, Go 单二进制 + 12 mini-services
  (heis-backend :3000 + 3010-3020), 10 节覆盖环境/快速开始/配置/采集规则/预览/架构/故障排查/
  生产部署/迁移/参考.
- 确认 scripts/ 目录已被 R43-1C 清空 (LS 返回 No such file or directory), 需 mkdir 重建.
  src/lib/db.ts 已删, 种子脚本需自带 `new PrismaClient()` 实例化 (不走共享 lib).

### 2. Prisma schema + autofill-rules 参考

- 读 prisma/schema.prisma (259 行, 11 模型): Rule.config String @default("{}") 存 JSON
  字符串, name 无 @unique 约束 (R43-1C 清理后), 故 upsert 靠 findFirst({name})+update/
  create 而非 db.rule.upsert({where:{name}}). Task 模型 ruleId 外键 + progress/stats
  JSON 快照 + autoRefresh 闭环.
- 读 docker/autofill-rules.json (1671 行, 8 站点) 取 4 类参考:
  - deqixs (HTML css 模板): list div.bookbox / book h1.booktitle / content 走代理. css
    expression+attr+replaceFrom/replaceTo+stripTags 用法确认.
  - fanqie (JSON 模板): itemSelector data.search_tabs[tab_type=3].data.book_data / fields
    type=json expression=book_name / const tocLink {q.book_id} 占位符.
  - bqg713 (const tocLink): toc.url const https://apibi.cc/api/chapter?id={q.id}&chapterid=
    {index} 引用 book 段 id + toc 段 index.
  - pili (css content): content.content css div.read-content attr=html 正文提取模式.
- 读 docker/autofill.mjs (239 行): AUTO_FILL=1 才执行, AUTO_FILL_RULES 逗号分隔站点 key
  默认 fanqie,qimao,deqixs,80ge,jhssd,ttkan,bqg713. 本任务直接 DB upsert 不走 autofill
  引导脚本 (避免改 autofill-rules.json + AUTO_FILL_RULES 默认列表).

### 3. 引擎 parser 行为只读探查 (go-backend/crawl/* 只读不碰)

- parser.go:395-419 cssExtract: sel.First() 取首个匹配 → CSS 提取只返首个元素. 多匹配
  场景需用更宽容器选择器 (如 div.book 整块) + clean 剥离, 或用 type=regex 锁定.
- parser.go:438-455 regexExtractFirst: re.FindStringSubmatch → attr=1 取捕获组 1. 用于
  book.author/category 锁 v-words span (作者：X / 分类：X).
- parser.go:1177 `if uf=="url"||uf=="bookUrl"` → list 段 url 和 bookUrl 两字段名都被
  识别为书 URL. 本规则用 bookUrl 命名 (与 deqixs/fanqie 一致).
- runner.go:1023-1069 discoverBooks: urlTemplate 含 {page} 占位符, strings.ReplaceAll
  展开 1..maxPages. newCount==0 则 break (R43-1B 修的无条件 break bug 已避开). 本规则
  list.urlTemplate 用 {page} 占位符 + maxPages=20.

### 4. 第一步站点探索 (curl SSR HTML, agent-browser open 超时改 curl)

agent-browser open 'https://sma.yueyouxs.com/b/24240.html' --timeout 80000 超时 (SPA
zepto.js 渲染慢 + 4GB 无 swap 环境). 改用 curl + Android wv UA 直接拿 SSR HTML, 站点
SSR 完整无需 JS 渲染.

#### 4.1 首页 GET / (71KB)
- div.v-list-item flex d="{0xc0016df800 男频 都市人生 叶晨八岁那年...}" onclick="newWebView
  ('/b/23070.html', '', '')". d 属性格式 {0x{hash} {男频/女频} {分类} {简介}}.
- 子元素: .v-cover>img.v-cover-img[src] / .v-info>.v-content>.v-title(书名)+.v-intro
  (简介). 3 段 v-words span (作者/分类/字数) 在书页不在首页.
- 横滑卡 .h-list-item onclick="newWebView('/b/{id}.html')". 顶部 banner .g_slider li
  onclick newWebView.

#### 4.2 列表 API GET /api/book/classify?site_id=&classify_id=1100&page=2 (含 Referer 头)
- 返回 {code:0, data:{count:7074, list:[...]}}. list[] 每项: id(内部)/wapBookId(URL
  用)/bookName/authorName/bookPic(全 URL)/intro/classify/classifySecond/classifyName/
  classifySecondName/fullFlag(1=完结/0=连载)/chapterCount/latestChapterName/
  latestChapterId/extendstr(最新章名<:>最新章ID<:>分类路径)/state/createTime/updateTime.
- wapBookId 是 URL 用的书 ID (不是 id 字段, id 是内部 ID). 全 URL https://sma.yueyouxs.com
  /b/{wapBookId}.html.

#### 4.3 书页 GET /b/24240.html (41KB, 无上神帝 6518 章)
- p.face-info-title(书名 无上神帝) / 3×div.v-words flex data-js=limit>span(作者：蜗牛狂奔 /
  分类：玄幻奇幻 / 字数：1640.98 万字) / div.content-label>span(连载中) / img.face-cover-img
  [src=https://cdn.p.yueyouxs.com/wap/24240/...] / #intro.content-intro(简介) /
  .sumchapter>span(共 6518 章)+a[href=/c/24240.html](查看目录) / #idNewIds.chapter>
  .chapter-entrance(第6518章净魂甘露) / .piracy-btn-wrap>a[href=/r/24240/24241.html](开始阅读)
  / ul.catalog_ls.introcatalog>li>a[href=/r/24240/24241.html]>span.type(免费)+章名 (前 3 章预览).

#### 4.4 目录页 GET /c/24240.html (1.15MB)
- ul.catalog_ls>li>a[href=/r/24240/{chapterId}.html]>span.type(免费)+章名. 全量 6518 章
  单页 SSR (grep -c '<a href="/r/24240/' = 6518). 顶部下拉 option value=N(N×50+1 - (N+1)×50
  章) 是 JS 跳页锚点 (无新 HTTP 请求, 同页滚动). 无服务端分页.

#### 4.5 章节页 GET /r/24240/24241.html (27KB, 第一章 万年之后)
- div.virtual_body>div.book>5×div.section(首个无 .none 类可见, 余 4 个 .none 隐藏, JS
  onclick=prevORnext('next') 内联切换显隐, 同 URL 全 5 页 SSR).
- 每 section: h2(第一章 万年之后(1/5) ... (5/5)) + div.con>p(正文段落) + 末尾 .con 含
  <p>（本章未完，请翻页）</p> 或 <p>（本章完）</p> 分页标记.
- div.book 还含: .wanzheng-dl(下载按钮) / #advert_up+advert_down1+advert_down2(广告位) /
  .bookfunbtn(上一章/下一页/返回目录/下载 nav) / .foot-img-down(底部下载图) /
  .xcyjgnLfeL+.dJoicqeaQqOgbgC(浮窗广告 random class 名).
- .r-header(back/menu) + nav.nav(精选/女频/男频/分类/搜索) 在 .book 外.

#### 4.6 分类选择页 GET /l/f/0.html (4.4KB) + 分类书列页 GET /l/f/1100/1.html (9.8KB)
- /l/f/0.html: tab-item(男频 11/女频 21/短篇 41) + ca-item gotoPage('/l/f/{catCode}/1.html')
  分类入口.
- /l/f/1100/1.html: 6 个 v-list-item 静态 SSR + JS AJAX url:'/api/book/classify?site_id=
  &classify_id=1100' + '&page=' + page 加载更多页. 确认 list 走 JSON API 最干净 (不
  走 HTML 分页, HTML 仅首 6 本).

### 5. 第二步规则创建 (scripts/seed-rule-yueyouxs.ts, 282 行)

#### 5.1 list 段 (JSON API)
- urlTemplate: https://sma.yueyouxs.com/api/book/classify?site_id=&classify_id=1100&page=
  {page} (classify_id=1100=都市人生男频, 可改 1101 玄幻/1102 武侠/1103 都市异能/1104 历史
  军事/1105 网游/1107 科幻/1108 灵异).
- itemSelector: {type:json, expression:data.list}.
- fields: name=bookName / author=authorName / intro=intro / category=classifySecondName /
  cover=bookPic / latestChapter=latestChapterName / bookUrl=wapBookId replaceFrom ^(\d+)$
  replaceTo https://sma.yueyouxs.com/b/$1.html (全 URL 避免相对路径解析歧义).
- pagination: {enabled:true, maxPages:20}.

#### 5.2 book 段 (SSR HTML, CSS + regex 混合)
- name: css p.face-info-title.
- author: regex 作者：([^<\n]+) attr=1 (锁定 v-words span, 绕开 CSS first-match 只取首段
  .v-words span 的限制).
- category: regex 分类：([^<\n]+) attr=1 (同上).
- status: css div.content-label (连载中/已完结).
- cover: css img.face-cover-img attr=src.
- intro: css #intro stripTags=true (含 height:104px 截断样式, stripTags 取全文本).
- latestChapter: css #idNewIds .chapter-entrance (第6518章净魂甘露).
- bookId: css div.sumchapter a attr=href replaceFrom ^/c/(\d+)\.html$ replaceTo $1 (供 toc
  tocLink 占位符 {q.bookId} 用).

#### 5.3 toc 段 (HTML 独立目录页)
- tocLink: const https://sma.yueyouxs.com/c/{q.bookId}.html (占位符取 book 段 bookId).
- itemSelector: css ul.catalog_ls li.
- title: css a replaceFrom ^(免费|付费|VIP|收费)\s* replaceTo "" (剥 span.type 前缀).
- url: css a attr=href (/r/24240/24241.html 相对路径, 引擎按 baseURL 解析为全 URL).
- pagination: disabled (全量单页 SSR 1.15MB/6518 章).

#### 5.4 content 段 (HTML 章节页)
- title: css div.section h2 replaceFrom \s*\(\d+/\d+\)\s* replaceTo "" (剥 (N/M) 分页后缀,
  首个 section h2 = 章名).
- content: css div.book attr=html (整块含 5 section+nav+广告, 由 clean 剥离非正文元素).
- pagination: disabled (5 sub-section 同 URL 内 SSR, JS 内联切换显隐).

#### 5.5 fetch 段
- engine: http (SSR 完整无 JS 渲染依赖, 不需 fetch-relay/scrapling/cloak/uc-bridge).
- uaMode: rotate (UA 池轮换, 引擎内置 23 桌面+3 移动 UA).
- autoCookie: true (Set-Cookie 自动回传, 应对站点 cookie 校验).
- referer: true (Referer 头自动补全, 应对热链保护).
- timeout: 20000ms / retries: 2 / waitMs: 500 / hostGateLimit: 3 (并发上限 3, HostGate
  双并发+限速器防 429).

#### 5.6 clean 段
- removeSelectors: script/style/iframe/ins/noscript (基础) + .r-header/.nav (章节页头
  nav) + .xcyjgnLfeL/.dJoicqeaQqOgbgC (浮窗广告 random class) + .wanzheng-dl/
  .bookfunbtn/.foot-img-down (下载按钮+翻页 nav+底部图) + #advert_up/#advert_down1/
  #advert_down2 (3 个广告位) + .tips (点击中间区域呼出菜单提示) + h2 (5 个 section 的分页
  标题 章名(N/M), 已在 content.title 单独提取).
- adPatterns: （本章未完，请翻页） / （本章完） / 页面篇幅有限.*?下载安装客户端.*?算我输！
  / (www\.)?[a-z0-9-]+\.(com|net|cc|org|info|top|xyz|vip|site)(/\S*)? (URL 域名) /
  一秒记住.*?免费读 / 请记住本书.*?域名.
- whitelist: p/br/b/strong/em/i/u (6 个基础标签, h2 等不在白名单被剥但文本保留).
- normalize: true (空白折叠) / plainText: true (输出纯文本, 非 HTML).

### 6. 第三步入库 + 验证

- bun run db:push: schema 已同步 (R43-1C 后无改动), prisma client 重新生成到
  node_modules/@prisma/client (v6.19.2, 163ms).
- bun run scripts/seed-rule-yueyouxs.ts:
  - findFirst({name:"神马小说 (sma.yueyouxs.com)"}) → 无 → db.rule.create() → id=
    cmubw50750000keyuwg0y9nb3.
  - self-check: 回读 db.rule.findFirst → enabled=true, config JSON.parse OK, stages=[list,
    book,toc,content,fetch,clean] 全在.
  - 诊断输出: list.urlTemplate + book.fields 7 项 + toc.tocLink + content.content css
    div.book attr=html 全部确认.
- bun -e 回读 DB 二次确认: rule.name + config 6 段 keys + list.fields 7 项 +
  toc.itemSelector + content.fields.content 全部正确入库.
- bun run lint: 0 errors (eslint . 默认不扫 scripts/, 但脚本本身 bun 解析无报错无 TS
  类型错误).

## 文件改动统计

| 文件 | 操作 | 行数 |
|---|---|---|
| scripts/seed-rule-yueyouxs.ts | 新建 | 282 (60 行探索注释 + RULE_CONFIG 4 段 + RULE_DESCRIPTION 8 行 + main() upsert+self-check+6 行诊断 + 错误处理/断连) |
| db/custom.db | 新增 1 条 Rule | id=cmubw50750000keyuwg0y9nb3, name="神马小说 (sma.yueyouxs.com)", config JSON 6 段, enabled=true |

## 未修改 (尊重约束)

- go-backend/* (Go 代码, 含 crawl/parser.go L395-455 cssExtract/regexExtractFirst 只读探查
  + runner.go L1023-1069 discoverBooks {page} 占位符 只读探查, 均不修改) ✓
- 其他 seed-rule-*.ts (R43-1C 已全删 34 个, 无可改) ✓
- docker/autofill-rules.json (1671 行, 不在本任务追加, 站点 key 走 DB 直接 upsert 不走
  autofill 引导脚本, 避免改 AUTO_FILL_RULES 默认列表) ✓
- prisma/schema.prisma + package.json + next.config.ts 0 改动 ✓
- src/* (已删, R42-1C) ✓
- mini-services/*.sh (R43-1C 已重写, 仅引用不改) ✓

## 验证

- 站点探索: 5 个页面 curl SSR HTML 全实测 (/ 71KB + /b/24240 41KB + /c/24240 1.15MB 全量
  6518 章 + /r/24240/24241 27KB 5-sub-section + /l/f/1100/1 9.8KB + /api/book/classify
  JSON 7074 本). agent-browser open 超时 (SPA zepto.js 渲染慢 + 4GB 无 swap), 改 curl
  Android wv UA 直接拿 SSR HTML, 站点 SSR 完整无需 JS 渲染.
- 规则入库: bun run scripts/seed-rule-yueyouxs.ts → DB Rule 表新增 1 条, self-check+回读
  二次确认 6 段 config 全在.
- 引擎兼容性: parser.go cssExtract sel.First() → 本规则 content 用 div.book 整块 (单匹配
  避开 first-match 限制); regexExtractFirst attr=1 → book.author/category 用 regex 锁 v-words
  span; runner.go {page} 占位符 → list.urlTemplate 用 {page}; ParseList url/bookUrl 双字段
  名识别 → 本规则用 bookUrl 命名. 全部兼容引擎既有行为.
- lint: bun run lint 0 errors.

## 后续注意事项

1. **classify_id 可改**: list.urlTemplate 默认 classify_id=1100 (都市人生男频). 改 1101
   玄幻/1102 武侠/1103 都市异能/1104 历史军事/1105 网游/1107 科幻/1108 灵异 即换分类.
2. **章节页 5 sub-section**: 同 URL /r/{bookId}/{chapterId}.html 内含 5 个 div.section (同
   章分页, JS 内联切换显隐). content 段取 div.book 整块 HTML + clean.removeSelectors 剥
   nav/广告/h2, plainText 输出全 5 页正文. adPatterns 剥 3 类分页标记 (本章未完/本章完/
   下载提示).
3. **toc 全量单页**: 目录页 /c/{bookId}.html 全量 6518 章单页 SSR (1.15MB), 无服务端分页.
   顶部下拉 option 是 JS 跳页锚点 (无新 HTTP 请求). pagination disabled.
4. **book.author/category regex**: 因 CSS first-match 限制 (parser.go cssExtract sel.First
   ()), 三段 .v-words span (作者/分类/字数) 用 CSS 只能取首段. 故 author/category 用 type=
   regex 锁定关键字段 (作者：([^\n<]+) / 分类：([^\n<]+)). 如未来引擎支持 :contains() 或
   xpath, 可改回 CSS.
5. **list bookUrl 全 URL**: bookUrl replaceTo 用 https://sma.yueyouxs.com/b/$1.html 全 URL
   (非相对路径 /b/$1.html), 避免相对路径解析歧义. toc.url 用相对路径 /r/24240/24241.html
   (引擎按 baseURL 解析为全 URL, 与 deqixs 一致).
6. **fetch engine=http**: 站点 SSR 完整无 JS 渲染依赖, 不需 fetch-relay/scrapling/cloak/
   uc-bridge. 如未来站点改 SPA 强依赖 JS 渲染, 改 engine=cloak 或 scrapling.
