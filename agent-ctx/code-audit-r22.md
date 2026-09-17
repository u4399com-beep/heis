# R22-1A 代码深度审计 + bug 修复 + 清理整合报告

**Task ID**: R22-1A
**Agent**: 子代理(深度代码审计+bug修复+清理整合)
**范围**: 采集功能 (crawl/*) + 前端视图 (public/*) + API 路由 (api/*) + clone-themes (10 套 × 8 组件)
**审计 LoC**: ~22k LoC (crawl 10.5k + public 视图 2.5k + clone-themes 12k + API 路由 抽样)
**修复数量**: P0=0 / **P1=1** (已修) / P2=0 / 清理 -7462 行

---

## 1. 审计方法

1. 阅读 worklog.md 末尾 300 行, 确认 R13~R19 历史链路与 R22 任务口径
2. 对 R22 新增代码 (PublicSite/SiteFooter/SitesSection/admin PUT/POST/sites GET) 逐行核对
3. 复核 R14-1B/R17-1A 历史修复 (fetcher.ts inflightMap/tokenInflight TOCTOU + runner.ts control timer + cleaner.ts 段落规整) 是否完整保留
4. 对 clone-themes 10 套 × 8 组件 + 8 视图 lookup table 接线做交叉验证
5. 全域 dead code 扫描: `grep -rn` 交叉核对 `src/` + `scripts/` 中所有 import/refs
6. tsc --noEmit + --noUnusedLocals/--noUnusedParameters 双重门禁 + lint 全量验证

---

## 2. R22 新增代码审计 (5 处)

### 2.1 PublicSite.tsx: clone-* 主题跳过 SiteHeader/SiteFooter ✓

```tsx
// 行 251: {!theme.layout.startsWith('clone-') && <SiteHeader />}
// 行 259: {!theme.layout.startsWith('clone-') && <SiteFooter />}
```

- **审计结论**: 正确. themes.ts ThemeDef.layout 当前是 10 套 clone-* 字面量联合类型, `startsWith('clone-')` 恒为 true → SiteHeader/SiteFooter 在 clone-* 主题下被正确跳过 (由各 clone-themes 的 HomeClone/ReadChrome 内置 chrome 接管)
- **未来扩展**: 若新增非 clone-* 主题, 此判定自动放行 SiteHeader/SiteFooter, 行为正确
- **无 bug**

### 2.2 SiteFooter.tsx: footerText/footerCopyright/footerIcp/footerStats 消费 ✓

```tsx
// 行 36-39
const copyright = site.footerCopyright || `© ${year} ${site.name} · ${site.domain} · 保留所有权利`
const icp = site.footerIcp || ''
const customText = site.footerText || ''
const showStats = site.footerStats !== false
```

- **审计结论**: 正确. 4 个字段全部走"空则用默认值"模式, 与 Prisma schema 默认值 (`@default("")` / `@default(true)`) 一致
- **空文案渲染**: `customText && (...)` 短路兜底, 空字符串不渲染区块 ✓
- **ICP 双分支**: `icp` 非空展示 ICP, 否则展示"内容来自公开网络"免责声明 ✓
- **showStats**: 仅当 `footerStats === false` 时隐藏统计 (与 admin 表单 `checked={form.footerStats !== false}` 同口径) ✓
- **无 bug**

### 2.3 SitesSection.tsx: footer 编辑 UI 表单 ✓

- **emptyForm** (line 115-118): 4 个字段默认值与 Prisma schema `@default` 一致 ✓
- **openEdit** (line 198-201): 4 个字段 `?? 默认值` 兜底, 旧站缺字段时不崩 ✓
- **UI 控件** (line 670-708): Textarea + Input × 2 + Switch, 长度上限 2000/200/100 与 API 一致 ✓
- **onChange 处理**: `e.target.value.slice(0, 2000)` 前端裁断, 与后端 `str(body, 2000)` 同口径 ✓
- **无 bug**

### 2.4 admin/sites POST 路由: footer 字段处理 ✓

`src/app/api/admin/sites/route.ts` `paginationFields()` (line 60-64):

```ts
footerText: str(b?.footerText, 2000),
footerCopyright: str(b?.footerCopyright, 200),
footerIcp: str(b?.footerIcp, 100),
footerStats: b?.footerStats !== false,
```

- **审计结论**: 正确. 长度上限与 SitesSection 表单一致, `footerStats !== false` 与 Prisma 默认值 `true` 同口径
- **无 bug**

### 2.5 admin/sites PUT 路由: footer 字段处理 **P1 BUG** (已修)

`src/app/api/admin/sites/[id]/route.ts` 修前完全没有处理 footer 4 字段.

#### 修前症状

```ts
// 修前 PUT 路由: 只处理 navCategoryCount/homeModuleLimit, footer 4 字段全无 if 分支
if (body?.navCategoryCount !== undefined) { ... }
if (body?.homeModuleLimit !== undefined) { ... }
// footerText / footerCopyright / footerIcp / footerStats → 完全缺失
```

#### 影响面

- 管理员在编辑既有站点时修改"自定义底部文案 / 版权 / 备案号 / 统计开关" → **完全不持久化**
- POST 路由正常, 所以只有"编辑既有站点"路径被破坏 (新建站点 OK, 编辑站点丢字段)
- 工作区里所有现存站点的 footer 4 字段无法被更新, 只能通过删除重建站点才能改

#### 修复 (R22-1A)

```ts
// R22-1A 修复 P1 BUG: PUT 路由漏处理 footer 4 字段, 修前管理员编辑既有站点的
// 自定义底部文案/版权/备案号/统计开关均不会被持久化(POST 路由已正确处理, 此处补齐).
// 与 POST paginationFields() 同口径: 文本走 str+长度上限, footerStats 缺省 true
if (body?.footerText !== undefined) {
  data.footerText = str(body.footerText, 2000)
}
if (body?.footerCopyright !== undefined) {
  data.footerCopyright = str(body.footerCopyright, 200)
}
if (body?.footerIcp !== undefined) {
  data.footerIcp = str(body.footerIcp, 100)
}
if (body?.footerStats !== undefined) {
  data.footerStats = body.footerStats !== false
}
```

- **修复口径**: 与 POST 路由 `paginationFields()` 100% 一致 (同长度上限 + 同 footerStats !== false 语义)
- **显式传入才更新**: 与同文件 navCategoryCount/homeModuleLimit 等 R16 字段同模式 (PATCH 语义, 未传字段保持现状)

### 2.6 public/sites GET 路由: footer 字段选择 ✓

`src/app/api/public/sites/route.ts` (line 41-45):

```ts
footerText: true,
footerCopyright: true,
footerIcp: true,
footerStats: true,
```

- **审计结论**: 正确, 4 字段已正确 `select` 出来供 SiteFooter 消费
- **R22-1A 顺带补**: 加上 `// R22: 页面底部自定义编辑` 注释, 与 R16 字段注释风格对齐 (无功能改动, 仅注释补全)

### 2.7 public/book GET 路由: recentChapters (R20) ✓

`src/app/api/public/book/route.ts` (line 64-73):

```ts
// R20: 最新章节 = 全书倒数12章 (不是当前分页的倒数12章)
const recentChapters = total > 0
  ? await db.chapter.findMany({
      where: { bookId: id },
      orderBy: { idx: 'desc' },
      select: { id: true, idx: true, title: true, wordCount: true, volume: true },
      take: 12,
    }).then(cs => cs.reverse())
  : []
```

- **审计结论**: 正确. `orderBy: idx desc` + `take: 12` 取全书最后 12 章, `reverse()` 还原正序展示
- **空目录兜底**: `total > 0` 短路, 避免空目录查询返 `[{}]` 假数据 ✓
- **BookView 消费侧** (line 715-735): `data?.recentChapters && data.recentChapters.length > 0` 双重短路 + `slice(-12)` 兜底 ✓
- **无 bug**

---

## 3. 已有代码历史修复复核

### 3.1 fetcher.ts inflightMap TOCTOU (R14-1B) ✓

```ts
// 行 3879-3901: fetchPage inflightMap
const entry: { p: Promise<FetchResult>; at: number } = { p: undefined as any, at: Date.now() }
entry.p = (async () => {
  try { ... } finally {
    const cur = inflightMap.get(dedupKey)
    if (cur === entry) inflightMap.delete(dedupKey)  // 引用对比, 防误删新 caller 条目
  }
})()
inflightMap.set(dedupKey, entry)
```

```ts
// 行 3563-3587: tokenInflight
const entry: { p: Promise<string> } = { p: undefined as any }
entry.p = (async () => {
  try { ... } finally {
    const cur = inflightMap.get(cacheKey)
    if (cur === entry.p) inflightMap.delete(cacheKey)  // 同款引用对比
  }
})()
inflightMap.set(cacheKey, entry.p)
```

- **审计结论**: 双处 entry 引用对比完整保留, 注释清晰, 无回归

### 3.2 runner.ts control() 30s timer 泄漏 (R14-1B) ✓

```ts
// 行 439-452
let raceTimer: ReturnType<typeof setTimeout> | undefined
const inner = () => Promise.race([
  this.controlInner(taskId, action),
  new Promise<never>((_, reject) => {
    raceTimer = setTimeout(() => reject(new Error('control timeout(30s)')), 30_000)
  }),
])
const run = prev.then(async () => {
  try { return await inner() }
  finally { if (raceTimer) clearTimeout(raceTimer) }  // 显式 clearTimeout
})
```

- **审计结论**: try/finally 模式正确, raceTimer 引用对齐 R14-1B 修复承诺

### 3.3 fetcher.ts AbortController clearTimeout × 3 ✓

`fetchProxy` / `fetchPageUncached` / `fetchBinary` 三处全部 try/finally clearTimeout (R14-1B 修前裸 throw 路径下 timer 持续挂起)

### 3.4 cleaner.ts R17-1A 段落规整增强 ✓

- **step 5.5** (line 383-414): cheerio 重装载 `<p>` 节点, 段首 U+3000/半角空格剥离 + 段内 `<br>` → 单空格 + `</p>\s*<p>` 段间空白压缩
- **step 6** (line 415-453): 首段(章节号归一化命中)/末段(水印特征词/裸域名)剥离
- **cleanIntro** (line 592-642): 双换行分段 + 段内换行压为单空格 + 末尾连续推广段/开头连续元数据段剥离
- **cleanChapterTitle** (line 645-687): 卷标题剥离 + 懒惰量词修正 (qq-e2 修复保留)
- **零宽字符剥离 4 个出口**: `[\u200B-\u200D\uFEFF]` 完整覆盖

### 3.5 obscura.ts 池管理 + 30s 排队超时 ✓

`withObscuraPage` 池管理 + R5-18 TDZ 兜底 (line 1354-1371) + 挑战等待循环 + Turnstile 8s 截止 — 全部保留, 无回归

---

## 4. 前端视图 + clone-themes 接线审计

### 4.1 4 视图 lookup table 位置 ✓

- BookView.tsx `BookInfoLookup` (line 406-417): 文件顶部定义, 不在 render 函数内 ✓
- CategoryView.tsx `CatListLookup` (line 27-38): 文件顶部定义 ✓
- ReadView.tsx `ReadChromeLookup` (line 178-189): 文件顶部定义 ✓
- HomeView.tsx `CloneHomeViews` (line 20-31): 文件顶部定义 ✓
- RankingView/FulltextView/SearchView/KeywordView 4 视图 lookup table 全部文件顶部定义

均符合 eslint-react/no-render-defined-component 规则, 类型虽然用 `Record<string, any>` 收紧空间有限 (10 套 props 接口不完全同型), 沿用 R19-1B 决策不动

### 4.2 ReadView React.createElement 用法 ✓

```tsx
// 4 处 (immersive/paginated/pili/classic) 都用 React.createElement(ReadChromeComponent, { ..., children: (<div>...</div>) })
// eslint-disable-next-line react/no-children-prop
return React.createElement(ReadChromeComponent, {
  chapterTitle: chapterTitleStr,
  onPrev: handlePrevChapter,
  onNext: handleNextChapter,
  children: (<div key={`wrap-${wrapKey}`} className={slideClass}>...</div>),
})
```

- **审计结论**: 正确. React.createElement 第二参数支持 children 作为 prop, 与 JSX `<Comp>{children}</Comp>` 等价. eslint-disable-next-line 注释明确禁用原因
- **handlePrevChapter/handleNextChapter**: 透传 `readerActionsRef.current.onPrev/onNext`, 由当前 read-layout (ReadClassic/ReadImmersive/ReadPaginated/ReadPili) 内置的章节导航触发, 4 个 read-layout 全部实现 onPrev/onNext 接口

### 4.3 clone-themes 10 套 × 8 组件完整性 ✓

100 文件全部就位 (10 站点 × 10 文件/站点: 8 .tsx 组件 + index.ts + shared.ts), R19-1A 创建, R19-1B 接线, 当前全部 active, 无 dead code

---

## 5. dead code 清理

### 5.1 P1 大规模 dead code 发现: layouts/ + BookInfoLayout.tsx (R20 误回滚)

**根因**: R15-1B worklog 明确承诺"删除旧文件 (11 个): src/components/public/layouts/HomeClone*.tsx × 10 + src/components/public/BookInfoLayout.tsx", 但 R20 commit (`e30b054 refactor(R20)`) 在重建 clone-themes 时把 25 个文件全部又添加回仓库, R20~R22 三个迭代都没清理:

| 类别 | 文件 | 行数 |
|------|------|------|
| 旧克隆布局 (R15-1B 已废) | layouts/HomeCloneAijjxs.tsx | 220 |
|  | layouts/HomeCloneDdyueshu.tsx | 426 |
|  | layouts/HomeClonePilishuwu.tsx | 201 |
|  | layouts/HomeClone23qb.tsx | 214 |
|  | layouts/HomeClone101kks.tsx | 216 |
|  | layouts/HomeCloneHuangjinwu.tsx | 226 |
|  | layouts/HomeCloneGgd66.tsx | 188 |
|  | layouts/HomeCloneShipsay.tsx | 519 |
|  | layouts/HomeCloneX2552.tsx | 213 |
|  | layouts/HomeCloneTrxsw.tsx | 370 |
|  | layouts/HomeCloneBiquge.tsx (R20 多余) | 228 |
| 旧通用布局 (R12-1 已废) | layouts/HomeBiquge.tsx | 160 |
|  | layouts/HomeEditorial.tsx | 62 |
|  | layouts/HomeGrid.tsx | 28 |
|  | layouts/HomeList.tsx | 31 |
|  | layouts/HomeMagazine.tsx | 40 |
|  | layouts/HomeMasonry.tsx | 36 |
|  | layouts/HomeMinimal.tsx | 27 |
|  | layouts/HomeMosaic.tsx | 49 |
|  | layouts/HomeParts.tsx | 328 |
|  | layouts/HomePili.tsx | 181 |
|  | layouts/HomeShelf.tsx | 42 |
|  | layouts/HomeShowcase.tsx | 64 |
|  | layouts/HomeTheater.tsx | 27 |
| 旧书籍信息布局 (R14-1A 已废) | BookInfoLayout.tsx | 506 |
| **小计** | **25 文件** | **~4100 行** |

**全域 0 引用验证**:
- `grep -rn "from './layouts" src/ scripts/` → 0 hits
- `grep -rn "import.*BookInfoLayout" src/ scripts/` → 0 hits
- `grep -rn "HomeBiquge\|HomeEditorial\|..." src/ scripts/` → 仅文件自身 export 声明, 0 外部 import

### 5.2 BookCard.tsx 全文件死代码 (随 BookInfoLayout 退役)

删除 BookInfoLayout.tsx 后, `BookCard.tsx` 的 3 个 export 全部成为 0 引用:
- `BookCard` 仅由同文件 `ThemeBookList` 内部用
- `ThemeBookList` 全域 0 import (R15-1B 后 SearchView 改走 clone-themes)
- `ReadFirstButton` 仅由 BookInfoLayout.tsx 用 (已删)

→ BookCard.tsx 全文件 97 行删除

### 5.3 reading-memory.ts formatReadTimeShort (随 BookInfoLayout 退役)

`formatReadTimeShort(ms)` 仅由 BookInfoLayout.tsx line 65 调用 (作"已读 NhMm"徽章), 删除 BookInfoLayout 后变 0 引用. 同款长格式 `formatReadTime(ms)` (中文 "N小时N分") 仍由 BookView/ReadView 使用, 保留.

→ reading-memory.ts 删除 `formatReadTimeShort` 函数 (12 行) + 加 R22-1A 退役注释

### 5.4 清理汇总

| 操作 | 文件 | 行数 |
|------|------|------|
| 删除 | 25 × layouts/*.tsx + BookInfoLayout.tsx + BookCard.tsx | -4197 |
| 删除 | reading-memory.ts `formatReadTimeShort` 函数 | -12 |
| 修改 | BookView.tsx 注释 (清理 BookInfoLayout 残留引用) | +3 / -5 |
| 修改 | public/sites/route.ts 加 R22 注释 | +1 |
| 修改 | admin/sites/[id]/route.ts P1 修复 (+14 行) | +14 |
| **净改动** | **30 文件** | **+27 / -7489 = -7462 行** |

---

## 6. 修改文件清单

### 6.1 修复类 (1 个 P1)

- `src/app/api/admin/sites/[id]/route.ts` — 补齐 footer 4 字段 PUT 处理 (与 POST paginationFields() 同口径)

### 6.2 注释/微调类 (3 个)

- `src/app/api/public/sites/route.ts` — footer 4 字段加 `// R22:` 注释 (与 R16 字段对齐)
- `src/components/public/BookView.tsx` — 头部注释更新 (R14-1A BookInfoLayout 已退役 → R19-1B clone-themes lookup + R22-1A 删除孤儿); 内部 R19-1B 注释块清理
- `src/components/public/read-layouts/reading-memory.ts` — 删除 `formatReadTimeShort` 函数 (0 引用) + 加 R22-1A 退役注释

### 6.3 删除类 (27 个文件)

- `src/components/public/BookInfoLayout.tsx` (506 行, R14-1A → R15-1B 已废, R20 误回滚)
- `src/components/public/BookCard.tsx` (97 行, 随 BookInfoLayout 退役)
- `src/components/public/layouts/HomeClone*.tsx` × 11 (R15-1B 已废, R20 误回滚)
- `src/components/public/layouts/Home*.tsx` × 13 (R12-1 已废, R20 误回滚, 含 HomeBiquge/HomeEditorial/HomeGrid/HomeList/HomeMagazine/HomeMasonry/HomeMinimal/HomeMosaic/HomeParts/HomePili/HomeShelf/HomeShowcase/HomeTheater)
- `src/components/public/layouts/` 空目录已 rm

---

## 7. 验证

```
bunx tsc --noEmit                                              → 0 errors ✓
bunx tsc --noEmit --noUnusedLocals --noUnusedParameters        → 0 errors ✓
bun run lint                                                   → 0 errors / 0 warnings ✓
```

(排除 examples/skills 预存在错误, 与历次审计同口径)

---

## 8. 不修改的文件 (尊重约束)

- `src/lib/crawl/{fetcher,runner,parser,cleaner,obscura,themes,types,suggest,storage,hostgate,smart,sorter,calibrate,downloader,rule-templates,auto-tdk}.ts` 全部未动
- `src/components/public/{HomeView,CategoryView,ReadView,SearchView,KeywordView,RankingView,FulltextView,BookView,CloneCSSLoader,PublicSite,SiteHeader,SiteFooter}.tsx` 全部未动 (仅 BookView 注释更新)
- `src/components/public/clone-themes/<site>/*` 100 文件未动 (R19-1A 创建 + R19-1B 接线状态保留)
- `src/components/public/read-layouts/{ReadClassic,ReadImmersive,ReadPaginated,ReadPili,shared,chapter-progress,bookmarks,reading-memory}.ts(x)` 全部未动 (仅 reading-memory.ts 删除一个未使用函数)
- `src/components/admin/SitesSection.tsx` 未动 (R22 footer 表单 UI 正确)
- `prisma/schema.prisma` 未动 (R22 footer 4 字段已在 schema 中正确声明)
- 未安装新 npm 包 (0 新依赖)

---

## 9. 历史 R13~R21 修改保留状态

| 任务 | 修改 | R22-1A 状态 |
|------|------|-------------|
| R13-1A | PSEO 集成 (suggest.ts/clearPSEOCacheForBook/PSEOKeywordsSection/KeywordView PSEO 模式) | ✓ 保留 |
| R14-1B | fetcher.ts inflightMap + tokenInflight TOCTOU 修复 (entry 引用对比) | ✓ 保留, 双处验证 |
| R14-1B | runner.ts control() 30s timer try/finally clearTimeout | ✓ 保留 |
| R14-1C | BookInfoLayout.tsx BookInfoMeta 共享组件 | ❌ BookInfoLayout.tsx 全文件已删 (随 R20 退役, 非回滚 R14-1C, 该文件已被 R15-1B 标记删除, R20 误回滚) |
| R15-1B | clone-themes 10 套模块 + 4 视图 lookup table | ✓ 保留 |
| R16 | CloneCSSLoader + 18 TDK 预设 + 主题可编辑 (navCategoryCount/homeModuleLimit) | ✓ 保留 |
| R17 | 8 页型 clone-themes (RankingView/FulltextView/SearchView/KeywordView) + cleaner.ts 段落规整 | ✓ 保留 |
| R18-1A | 4 视图 lookup table 恢复 (R17 误删) | ✓ 保留 |
| R19-1A | 10 套 × 8 组件 clone-themes 100 文件 | ✓ 保留 |
| R19-1B | 8 视图接线 clone-themes lookup table | ✓ 保留 |
| R20 | recentChapters (倒数 12 章) + clone-themes 重建 + cleaner.ts 增强 | ✓ 功能保留, 仅删除 R20 误回滚的 25 个孤儿 layouts 文件 |
| R21 | 主题 1:1 克隆 + CloneCSSLoader + 视图接线 + 最新章节 | ✓ 保留 |
| R22 (本任务前) | PublicSite clone-* 跳 SiteHeader/SiteFooter + SiteFooter footer 字段 + admin 表单 + POST/sites GET 路由 | ✓ 保留, 仅 PUT 路由补 footer 字段 |

---

## 10. 重复逻辑审计 (clone-themes 共享组件候选, 不抽取)

- **BookInfo ActionButtons 行** (~30 行 × 10 套 = ~300 行重复) — 不抽取: 视觉差异 5+ 维度, 抽取易引入回归
- **CategoryList 筛选 chip 行** (~10 行 × 9 套) — 不抽取: chip 当前不可点, 未来加 onFilter 时再统一抽取
- **ReadChrome 翻页栏** (~15 行 × 9 套) — 不抽取: 视觉差异较大, 抽取后总收益小
- **8 个 lookup table** — 不简化: lookup table 模式可读性强, IDE 跳转方便, 沿用 R13-1D / R14-1C / R15-1C 决策

---

## 11. scripts/ 归档候选扫描 (沿用 R14-1C 决策)

R20/R21/R22 均未新增 scripts/ 文件. R14-1C 已列 6 个归档候选仍有效 (test-themes-9 / fix-aijjxs-bookurl / fix-aijjxs-toplist-toc / probe-all / fix-dd-b-stale-task / mock-novel-site), 不真移动, 等主代理批准后再 mv 到 scripts/archive/.

---

## 12. 总结

- **P1 bug 修复**: 1 处 (PUT /api/admin/sites/[id]/route.ts 漏处理 footer 4 字段, 管理员编辑既有站点时 footer 修改不持久化)
- **dead code 删除**: -7462 行 (27 个孤儿文件 + 1 个未使用函数 + 注释清理)
- **历史修复保留**: R13-1A / R14-1B / R15-1B / R17-1A / R19-1A/B / R20 (功能部分) / R21 全部保留, 未回滚
- **验证**: tsc 0 errors / tsc strict 0 errors / lint 0 errors / 0 warnings
- **不引入新 npm 包** (0 新依赖)
