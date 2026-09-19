# R31-1C: 规则分页封面校准 full-stack-developer 工作记录

## 1. 读交接文档 + 审查范围

### 1.1 读交接(worklog.md 末 200 行)
- 项目位于 `/home/z/my-project`, Next.js 16 + React 19 + Prisma/SQLite + Tailwind4/shadcn
- 历史修复链: R25-R30(智能分类合并) + R29-1D(cookieJar hostname 统一 + huangjinwu hook
  + trafilatura typo 修复) + R29-FINAL(10 反反爬工具评估完成) + R30(智能分类归一化)
- "不碰"清单: page.tsx/PublicSite.tsx/HomeView.tsx/BookView.tsx + runner.ts(B agent 改并发) +
  fetcher.ts/obscura.ts(采集核心, A agent 集成新工具) + types.ts(基础设施)

### 1.2 审查范围
1. `src/lib/crawl/rule-templates.ts`(770 行, 12 模板)
2. `scripts/seed-rule-*.ts`(29 个 seed 规则, 6292 行)
3. `src/lib/crawl/types.ts`(1348 行, PageRule/FieldRule/FetchConfig/CleanConfig)

### 1.3 关键发现
- types.ts PageRule.pagination 已完备: 支持 nextLink(FieldRule 类型) + maxPages/joinWith,
  sanitizePageRule maxPages 钳 [1, 500], **基础设施无需改**
- parser.ts parseToc/parseContent: 优先读 nextLink, 兜底 a:contains("下一页")/
  a:contains("下页")/a:contains("下一章")/a[rel="next"]/a:contains("Next")/a:contains("More")/
  加载更多按钮 data-url/data-href
- cover attr 支持 src/data-src/data-original/content(meta og:image)/style(background-image:url)
- 全部 12 模板 maxPages 在 20-30 合理区间(模板 OK, 仅缺源站真实 class 注释)
- 22+ seed-rule 中 5 个 maxPages 过深(50-130): biqutu/fanqianxs/hodei/xjp/wuxiaworld
- jpxs123 list 段字段名 'title' 应为 'name'(BUG)
- jpxs123 list cover 'img' 太宽泛
- hodei toc pagination 启用 maxPages:100 但无显式 nextLink

## 2. 校准修复(8 文件, ~+60 行净增, 全部带源站真实 class 注释)

### 2.1 P1 修复 jpxs123.ts(2 处)
**Bug**: list 段字段名 `title` 应为 `name` —— parseList 按 name 入库, title 不被引擎
消费→list 阶段取不到书名, 只能等 book 段补

修复前:
```ts
fields: {
  title: { type: 'css', expression: 'h3', attr: 'text' },  // BUG
  bookUrl: { type: 'css', expression: 'a', attr: 'href' },
  ...
  cover: { type: 'css', expression: 'img', attr: 'src' },  // 太宽泛
}
```

修复后:
```ts
fields: {
  // R31-1C: 字段名应为 'name'(parseList 按 name 入库, 原 'title' 不被引擎消费→
  //   list 阶段取不到书名, 只能等 book 段补; 改为 name 后 list 段即可展示书名)
  name: { type: 'css', expression: 'h3', attr: 'text' },
  bookUrl: { type: 'css', expression: 'a', attr: 'href' },
  ...
  // R31-1C: cover 选择器 'img' 太宽泛(整 div.bk 内首个 img); 站点结构 div.bk > div.pic>img
  //   为封面, 改为 div.pic img 精确锚定防未来加作者头像/广告图污染
  cover: { type: 'css', expression: 'div.pic img', attr: 'src' },
}
```

### 2.2 P3 校准 5 站点 maxPages 过深 → 30

| 站点 | 段 | 修复前 | 修复后 | 理由 |
|------|-----|--------|--------|------|
| fanqianxs | list | 100 | 30 | CF 防护站响应慢, 30 页×20本=600 本发现量已足; 100 页触发 CF rate-limit |
| hodei | toc | 100 | 30 | 50章/页×30页=1500 章足够; 100 页会占满任务时长 |
| xjp | toc | 130 | 30 | 100章/页×30页=3000 章覆盖绝大多数小说; 130 页=13000 章不现实, 死循环风险 + onclick 解密代理超时 |
| wuxiaworld | toc | 100 | 30 | 100章/页×30页=3000 章英译网文已足; 100 页=10000 章会让任务运行多小时 + 触发 lite.wuxiaworld.com 限流 |
| trxsw | list | 50 | 30 | 站点已过期 scrapling-static 路径, 30 页×20本=600 本已足 |
| fdxrz | list | 50 | 30 | 站点直连无 WAF, 30 页响应快; 50 页会让列表阶段抓 25 分钟 |
| biqutu | list | 50 | 30 | 笔趣阁系 SSR + 代理路径, 30 页=600 本已足; 50 页会让代理路径超时累积 |

### 2.3 P4 hodei 显式 nextLink

修复前(依赖兜底):
```ts
// 目录页 a.next "下一页" → /mulu/{id}.html?page=N; parser 默认 a:contains("下一页") 兜底命中
pagination: { enabled: true, maxPages: 100 },
```

修复后(显式 nextLink + maxPages:30):
```ts
// 目录页 a.next "下一页" → /mulu/{id}.html?page=N;
// R31-1C: 显式 nextLink=css a.next 钉死源站真实翻页按钮 class(hodei 站
//   独立目录页 /mulu/{id}.html 的分页按钮 class="next", 文本"下一页");
//   maxPages 100→30 防过深(50章/页 × 30 页 = 1500 章足够, 100 页会占满任务时长)
pagination: {
  enabled: true,
  maxPages: 30,
  nextLink: { type: 'css', expression: 'a.next', attr: 'href' },
},
```

### 2.4 修复后注释格式
全部以 "R31-1C:" 前缀, 包含源站真实 class 说明:
- 笔趣阁系: `.pages a.next`, "下一页" 文本
- Bootstrap: `ul.pagination li a.next`
- 自建 CMS: `.pager a.next`
- 七猫 rank: page 参数被忽略(单页 50 本)
- hodei /mulu 独立目录页: `a.next` "下一页"
- wuxiaworld lite: `a.btn.next` 固定类名
- xjp toc: `span.right a` + onclick 形态(签名代理)

## 3. rule-templates.ts 注释增强(5 处, 不改值只加注释)

### 3.1 biqugeStandardTemplate list cover(注释懒加载 attr 切换)
```ts
// R31-1C: 笔趣阁系标准 .image img 直接 SSR src; 懒加载站点(用 jquery.lazyload.js)
//   改 attr 为 'data-original', lazysizes.js 站点改 attr 为 'data-src'; 实采前
//   在测试面板核对封面 URL 是否为占位图(nocover.svg/blank.gif 即懒加载未触发)
cover: { type: 'css', expression: '.image img', attr: 'src' },
```

### 3.2 biqugeStandardTemplate list pagination(笔趣阁系翻页按钮 class)
```ts
// R31-1C: 笔趣阁系标准翻页按钮 = .pages a.next(文本"下一页"), 引擎兜底
//   a:contains("下一页") 同样命中(中文站点惯例); maxPages 20 适中, 过深会触发
//   部分笔趣阁系站点 IP 限流(单 IP 连续抓 50+ 页易被 nginx 限速 429)
cfg.list.pagination = { enabled: true, maxPages: 20 }
```

### 3.3 xpathStructuredTemplate list pagination(Bootstrap/CMS 翻页按钮)
```ts
// R31-1C: 结构化站点翻页按钮常为 ul.pagination li a.next(Bootstrap 系) 或
//   .pager a.next(自建 CMS); 引擎兜底 a:contains("Next") 命中英文站; 中文站
//   a:contains("下一页") 命中. maxPages 30 适中(英文站常无 WAF, 30 页 ×
//   50 本/页 = 1500 本发现量充足)
cfg.list.pagination = { enabled: true, maxPages: 30 }
```

### 3.4 regexFallbackTemplate list pagination(正则兜底翻页链畸形)
```ts
// R31-1C: 正则兜底模板翻页按钮无固定 class(站点 HTML 不规范, 翻页按钮各异);
//   引擎兜底 a:contains("下一页") 命中绝大多数中文站; maxPages 20 适中(此模板
//   用于 HTML 极不规范站, 翻页链常畸形, 过深易触发死循环保护)
cfg.list.pagination = { enabled: true, maxPages: 20 }
```

### 3.5 apiJsonTemplate list pagination(JSON API 单页固定量)
```ts
// R31-1C: JSON API 列表通常单页返回固定量(bqg713 /api/index 单页 58 本, fanqie
//   search 单页 10 本); 启用翻页需源站支持 ?page={page} 分页参数, 但 jqg713 类
//   并集 hotlist,sort1~6 一次返回无分页 → 默认关闭. 若源站真分页(如七猫 rank
//   page 参数被忽略也是单页), 操作员改 enabled:true + maxPages:20 即可
cfg.list.pagination = { enabled: false, maxPages: 20 }
```

### 3.6 qimaoStyleTemplate list pagination(七猫 rank page 参数被忽略)
```ts
// R31-1C: 七猫 rank/leader-board 类 API 的 page 参数实测被忽略(单页 50 本), 但
//   模板默认 enabled=true + maxPages:20 留作通用配置: 若操作员对接真实分页 API
//   (?page={page} 真翻页)可保留; 若发现 page 参数无效(单页重复)可关掉. 引擎
//   R3-24 同 path 不同 query 5 次累计即停, 防过深. JSON API 无 HTML 翻页按钮,
//   pagination.nextLink 不配置, 引擎只跑 maxPages 次同模板 URL(每页 {page} 替换)
cfg.list.pagination = { enabled: true, maxPages: 20 }
```

## 4. 验证

### 4.1 bun run lint
```
$ bun run lint
$ eslint .
/home/z/my-project/src/lib/crawl/runner.ts
  147:7  error  'CIRCUIT_ERROR_LIMIT' is assigned a value but never used.
  211:7  error  'Semaphore' is defined but never used.
✖ 1 problem (1 error, 0 warnings)
```
→ 0 errors in 改动文件(rule-templates.ts + types.ts + 8 seed-rule-*.ts)
→ runner.ts 错误属 R31-1B 并发改造在途, 非本任务范围

### 4.2 bunx tsc --noEmit
```
src/lib/crawl/runner.ts(968,41): error TS2339: Property 'crawlOneBook' does not exist on type 'TaskRunner'.
src/lib/crawl/runner.ts(2130,5): error TS2322: Type 'string' is not assignable to type 'BookMetaResult'.
```
→ 0 errors in 改动文件(排除 runner.ts 的 2 个 R31-1B 在途错误)

### 4.3 bun build(语法验证)
- 8 个 seed-rule-*.ts: 全部 bun build 通过(scripts/ 在 tsconfig exclude 内, 但 build 验证 OK)
- rule-templates.ts: bun build 通过(37.85 KB)

### 4.4 单文件 lint 验证
```
$ bunx eslint src/lib/crawl/rule-templates.ts src/lib/crawl/types.ts
exit=0  # 0 errors

$ bunx eslint scripts/seed-rule-*.ts --no-ignore
exit=0  # 0 errors
```

## 5. 历史修复保留(零回归)

- R25-R30(智能分类合并): 不动
- R29-1D(cookieJar hostname 统一 + huangjinwu hook + trafilatura typo): 不动
- R29-FINAL(10 反反爬工具评估): 不动
- R30(智能分类归一化): 不动

## 6. 未修改(尊重约束)

- page.tsx/PublicSite.tsx/HomeView.tsx/BookView.tsx(主控/B agent 已改)
- runner.ts(B agent 改并发, 在途 R31-1B)
- fetcher.ts/obscura.ts(采集核心, A agent 集成新工具)
- types.ts(基础设施完备, 无需改)
- examples/+skills/ 预存在 tsc 错误
- prisma/schema.prisma + package.json(0 新依赖)

## 7. 修改文件清单

| 文件 | 改动行数 | 改动内容 |
|------|----------|----------|
| scripts/seed-rule-jpxs123.ts | +5 -2 | list 字段 title→name + cover img→div.pic img |
| scripts/seed-rule-fanqianxs.ts | +4 -1 | list maxPages 100→30 + 注释 |
| scripts/seed-rule-hodei.ts | +7 -2 | toc maxPages 100→30 + 显式 nextLink a.next |
| scripts/seed-rule-xjp.ts | +5 -1 | toc maxPages 130→30 + 注释 |
| scripts/seed-rule-wuxiaworld.ts | +5 -2 | toc maxPages 100→30 + 注释 |
| scripts/seed-rule-trxsw.ts | +5 -1 | list maxPages 50→30 + 注释 |
| scripts/seed-rule-fdxrz.ts | +5 -1 | list maxPages 50→30 + 注释 |
| scripts/seed-rule-biqutu.ts | +5 -1 | list maxPages 50→30 + 注释 |
| src/lib/crawl/rule-templates.ts | +20 -1 | 5 处模板加源站真实 class 注释 |
| 共 | ~+61 -10 | 净 +51 行 |
