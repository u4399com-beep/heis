# R32-1B: clone-themes 残留 + seed-rule 残留校准审计

## 1. 读交接文档

读 `worklog.md` 末 150 行 → R31 校准状态:

- **R31-1A**: 7 套主题(aijjxs/ddyueshu/pilishuwu/23qb/101kks/ggd66/x2552)1:1 校准 + shipsay HomeClone(+62 行,4 段缺口补)+ huangjinwu HomeClone(+1 行,navbar-menu-search 类)
- **R31-1B**: 并发架构改造(runner.ts crawlOneBook 935 行 → crawlBookMeta + crawlChapterContent + finalizeBook 三阶段 + executeTask 三阶段并发)
- **R31-1C**: 8 seed-rule 校准(jpxs123 list 字段 title→name + cover img→div.pic img / 5 站点 maxPages 100→30 / hodei 显式 nextLink=css a.next / rule-templates 5 处模板加源站真实 class 注释)
- **R31-1D**: huangjinwu/HomeClone 走 useCloneCategories hook + mapCatWithBangSuffix 映射

## 2. clone-themes 80 文件 useCloneCategories hook 残留检查

### 2.1 grep 矩阵
- `useState<Cat` → 0 命中(无内联 useState<Category> 残留)
- `fetch('/api/public/categories` → 仅 shared.ts 命中(hook 实现)
- `useCloneCategories` → 51/81 文件命中(其余 30 文件无 hook)

### 2.2 30 文件无 hook 的合理性分析
| 文件类别 | 原因 |
|---------|------|
| 101kks/23qb/ddyueshu/x2552 subpages(ReadChrome/BookInfo/CategoryList 等) | 源站无 categories sidebar, 仅顶部 nav → 无需 hook |
| huangjinwu subpages(BookInfo/SearchView/RankingView) | sidebar-wrapper 渲染固定 NAV_ITEMS(7 项 home/rank/list/tag/author/dzss/search), 无 categories dropdown |
| pilishuwu/ReadChrome | 章节阅读页无 sidebar |
| tools.tsx | 工具组件, 非 page-level |

**结论**: 30 文件无 hook 是合理设计, 非残留。

## 3. DOM 对源站 probe 子页对比

### 3.1 23qb probe
- `probe-23qb-book.html` + `probe-23qb-category.html` 双双被 CF 挑战页拦截
  (title="Just a moment...", 5KB CF challenge script)
- 已在 `23qb/BookInfo.tsx`/`CategoryList.tsx` 文件头注释"CF 拦截, 按源站 CSS class 结构复刻"
- 非本轮可修复

### 3.2 aijjxs probe
- `probe-aijjxs-book.html` class 名: top-float/top-float-inner/top-float-nav/wrap/top/top-1/
  layout/cenMain/articleInfo/panel/body/lines/foot/page-info/pic/badge/meta/kv/desc/
  download-btn/tips/sfwj 等
- `probe-aijjxs-chapter.html` class 名: top-float/top-float-nav/wrap/top/top-1/search/
  layout/cenMain/articleInfo/catalog/panel/body/lines/path/writerIntro/foot 等
- clone `aijjxs/BookInfo.tsx` + `ReadChrome.tsx` 复刻 class 全对齐 ✓
- 注: probe 含 `.path`(breadcrumb)/`.writerIntro` 等 class clone 未复刻, 非关键(可见性低)

### 3.3 pilishuwu probe 命名错位(源站本身命名规范)
- `probe-pilishuwu-book.html` 实为**分类页**(ret-search-*/ret-works-*/ret-side-wr/
  ret-main-wr/mod-page/mod_page_next/category-left-rank/custom-rank-list/rank-item 等)
- `probe-pilishuwu-category.html` 实为**书籍详情页**(works-intro-wr/works-intro-detail/
  works-intro-text/works-intro-opera/works-intro-tags/works-intro-active/
  works-intro-view/ui-btn-orange/works-vote/works-simi-wr/works-more-wr/
  mod-cover-list 等)
- clone 已正确引用对应 probe:
  - `pilishuwu/BookInfo.tsx` 文件头注释 `参考: probe-pilishuwu-category.html`
  - `pilishuwu/CategoryList.tsx` 文件头注释 `参考: probe-pilishuwu-book.html`
- 命名错位是源站本身命名规范, 非 clone 问题

### 3.4 probe-pilishuwu-chapter.html
- 实为首页(源站反爬把章节页跳回首页, 315KB index.html 含 in-banner-wr/in-girl-list-wr/
  in-monrank-list/mod-cover-list 等)
- 已在 `pilishuwu/ReadChrome.tsx` 文件头注释"实为首页抓取"
- clone 按 wmcms-web 章节模板 + pilishuwu.css 已有 class 构造(mod-top-wr/ui-wm/
  read-content-wr/bookname/bottem1/bottem2/linkBox/mod-footer-wr)
- 非本轮可修复

## 4. CSS 选择器命中检查

### 4.1 命中率矩阵(rg className vs public/clone-css/<site>.css 选择器)
| 站点 | 总 class | 命中 | 缺失 | 主要缺失类型 |
|------|---------|------|------|-------------|
| ggd66 | 50 | 49 | 1 | logo(源站 .headbox 内 inline 用) |
| ddyueshu | 32 | 30 | 2 | template literal 类 |
| huangjinwu | 119 | 110 | 9 | hot-section/sort-section/update-section/chapter-list--all/ebook-more-ebooks/navbar-link/icon-language/copyright(源站 inline `<style>` 区块 class, probe.css 未含规则, clone 用 Tailwind 兜底样式) |
| x2552 | 43 | 42 | 1 | poptext(信息性 class) |
| shipsay | 64 | 44 | 20 | fa-*/icon-*(Font Awesome 外部 iconfont, 由 fa.css 加载) |
| aijjxs | 68 | 66 | 2 | gird2/oldDate(信息性 class) |
| pilishuwu | 247 | 75 | 172 | bx-viewport/bx-wrapper(jQuery 轮播插件类) + bg-org/in-content(子页专用 class) |
| 101kks | 123 | 112 | 11 | clear/col-xinindex/copyright/icon-mark/icon-set/main/ranktit/tabsnav(Bootstrap utility + iconfont) |
| 23qb | 94 | 81 | 13 | ac_wd/fixed-logo/grid-box/grid-items/hidden-xs/icon-language/icon-list/icon-mark(同上 Bootstrap + iconfont) |
| trxsw | 113 | 111 | 2 | h-full/w-full(Tailwind utility, 全局加载) |

### 4.2 结论
- 主要"缺失"类为:
  1. **外部 iconfont** (fa-*/icon-*): 由各站 CDN 加载的 Font Awesome CSS, 非 clone-css 文件维护范围
  2. **Bootstrap utility** (clear/col-*/hidden-xs): 由 Bootstrap CDN 加载
  3. **Tailwind utility** (h-full/w-full): 由全局 Tailwind 加载
  4. **jQuery 插件** (bx-viewport/bx-wrapper): bxSlider 轮播插件注入
  5. **源站 inline `<style>` 区块** (huangjinwu hot-section 等): probe.css 未含规则(源站
     在 head 用 `<style>` 内联, probe 抓取未保留); clone 用 Tailwind 兜底, 非阻塞
- 各主题核心 layout class(.header/.container/.main/.footer/.book/.panel/.block 等)全命中
- **视觉无回归**: 主题主结构样式由 clone-css 文件覆盖, 缺失 class 多为辅助样式

## 5. seed-rule 残留校准(21 个未触文件)

### 5.1 maxPages 全 ≤ 30
分布:
- 66 个 maxPages=1(单页)
- 5 个 maxPages=5(80ge toc / deqixs list / xjp list / shudugu toc / yybsw list 防御性)
- 4 个 maxPages=10(iidcr content / shudugu content / yybsw content / 80ge content 等)
- 5 个 maxPages=20(pilishuwu list / yybsw toc / wanben toc / 等)
- 7 个 maxPages=30(xjp toc / wuxiaworld toc / trxsw list / fdxrz list / fanqianxs list /
  biqutu list / hodei toc, R31-1C 已校准)

### 5.2 字段名校准(P1 修复)
- **bqg713.ts line 75**: `title: { type: 'json', expression: 'title' }`(list 段)
  → **改为 `name:`** (R32-1B 修复, R31-1C 漏改残留)
  - 理由: parseList 按 name 入库, runner line 892 `it.fields.name` 消费 name 非 title;
    list 段取不到书名 → 等 book 段补全 → list 段发现阶段无书名展示
  - 与 R31-1C 修 jpxs123.ts 同款 bug 一致处理(5 行 R32-1B 注释含同款说明)

### 5.3 cover 选择器宽泛度(3 处 bare `img`, 工作正确, 非阻塞)
| 文件 | 行号 | 选择器 | 评估 |
|------|------|--------|------|
| shudugu.ts | 90 | `img` | itemSelector=div.item 容器内, 取首个 img 即封面, 工作正确; book 段用 `div.item img` 更精确(同口径) |
| pilishuwu.ts | 44 | `img` | itemSelector=.book-item/.li/.item 容器内, 取首个 img 即封面, 推断结构(CF 防护站未实测), 工作正确 |
| ingml.ts | 65 | `img` | itemSelector=a.card-hover 容器内, Tailwind 卡片结构首个 img 即封面(object-cover), 工作正确 |

### 5.4 cover attr 检查(全对齐 0 错配)
- src 直 SSR: 大部分(biqugeStandard/qimao/zxcs/wanben/iidcr/yybsw/dafengdagengren/daweixs/
  piaotia/xjp/wuxiaworld/trxsw/bqg713 fanqie-shuyuan 等模板 + 多 seed-rule)
- data-src 懒加载: biqugetw.ts list(`div.cover img` attr `data-src`, jquery.lazyload.js 站点)
- data-original 懒加载: xjp.ts list(`a.cover img` attr `data-src`, lazysizes.js 形态)
- style 背景图: zxcs.ts list(`div.cover` attr `style`, replaceFrom `^.*url\(([^)]*)\).*$`
  → `$1` 提取 url)
- 备注: rule-templates.ts biquge-standard 模板已注释"懒加载站点改 attr 为 'data-original'/
  'data-src'; 实采前在测试面板核对封面 URL 是否为占位图"

### 5.5 字段名(name/author/intro/category)校准
- 全 21 seed-rule 字段名与 runner/parser 消费字段名对齐:
  - list 段: name / bookUrl / author / intro / cover / status / latestChapter /
    latestChapterUrl / updateTime / category / id / itemId / chapterId / cid
  - book 段: name / author / intro / cover / status / category / latestChapter /
    keywords / wordCount
  - toc 段: title / url
  - content 段: title / content

## 6. rule-templates.ts 默认值复核

### 6.1 12 模板 maxPages 全 ≤ 30
- biquge-standard: list=20, toc=20(disabled), content=10(disabled)
- biquge-gbk: list=20, toc=20(disabled), content=10(disabled)
- xpath-structured: list=30, toc=20(disabled), content=10(disabled)
- regex-fallback: list=20, toc=20(disabled), content=10(disabled)
- api-json: list=20(disabled), toc=20(disabled), content=10(disabled)
- js-render: list=1, toc=1, content=1
- fanqie-style: list=1(disabled), toc=1(disabled), content=1(disabled)
- qimao-style: list=20, toc=20(disabled), content=1(disabled)
- tls-impersonate/hard-waf-cloak/trafilatura-fallback/trafilatura-first: 沿用 biquge-standard

### 6.2 list 段 title 残留检查
- `rg "list:" 后 "title:"` → 0 命中(R31-1C 已清, 0 残留)
- book/toc/content 段 title 字段使用正确(toc 段章节标题 / content 段章节标题)

## 7. 验证

### 7.1 bun run lint
```
0 errors / 13 warnings (admin/components useCallback exhaustive-deps 预存在警告, 与本轮无关) ✓
```

### 7.2 bunx tsc --noEmit
```
0 errors in src/ (仅 examples/websocket + skills/image-edit +
  skills/stock-analysis-skill 预存在错误, 与本轮无关) ✓
```

### 7.3 单文件 lint + build 验证
- `bunx eslint scripts/seed-rule-bqg713.ts --no-ignore`: 0 errors ✓
- `bun build scripts/seed-rule-bqg713.ts`: 通过 ✓
- `bunx eslint src/components/public/clone-themes/ src/lib/crawl/rule-templates.ts`: 0 errors ✓

### 7.4 dev.log
- 0 error/exception/fail ✓

## 8. 修改文件清单

| 文件 | 改动行数 | 改动内容 |
|------|----------|----------|
| scripts/seed-rule-bqg713.ts | +5 -1 | list 段 title→name 字段(5 行 R32-1B 注释含 R31-1C 同款说明) |

## 9. 历史修复全部保留(零回归)

- R28 useCloneCategories hook(51/81 文件) ✓
- R29-1D huangjinwu hook + cookieJar hostname 统一 + trafilatura typo 修复 ✓
- R29-FINAL 10 反反爬工具评估 ✓
- R30 智能分类归一化 ✓
- R31-1A 7 套主题 1:1 校准 + shipsay/huangjinwu 修复 ✓
- R31-1B 并发架构改造(crawlBookMeta/crawlChapterContent/finalizeBook 三阶段) ✓
- R31-1C 8 seed-rule maxPages + 字段名校准 ✓
- R31-1D huangjinwu/HomeClone 走 hook + mapCatWithBangSuffix ✓

## 10. 未修改(尊重约束)

- src/lib/crawl/fetcher.ts/obscura.ts/runner.ts(采集核心, A agent)
- page.tsx/PublicSite.tsx/HomeView.tsx/BookView.tsx(主控已改)
- themes.ts/prisma/schema.prisma/package.json(0 新依赖)
- 10 套 clone-themes 主题(无 P0/P1 残留, 详见 §2-4 审计结论)
- public/clone-css/*.css(源站 probe.css 同步快照, 上游问题, 详见 §4.2 结论)
- 其余 20 个未触 seed-rule-*.ts(无 P0/P1 残留, 详见 §5 审计结论)
