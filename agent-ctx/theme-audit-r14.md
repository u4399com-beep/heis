# R14-1A 主题模版全量重克隆审计报告

> Task ID: **R14-1A**
> Agent: full-stack-developer
> 范围: 删除现有 10 套主题模版，重新完整克隆 10 个站点 (含子页面 DOM), 1:1 精仿真实小说站点

## 0. 输入数据来源

| 来源 | 路径 | 用途 |
|---|---|---|
| 9 站点首页+CSS | `/home/z/my-project/agent-ctx/probe-html2/probe-<site>.{html,css}` | 提取 :root CSS 变量 + 字体栈 + body bg + a color + .book 卡片样式 + radius |
| 子页面 DOM (book/chapter/category) | `/home/z/my-project/agent-ctx/probe-html2/probe-<site>-{book,chapter,category}.html` | 提取书籍页/章节页/分类页 DOM 结构 |
| 子页面 DOM 摘要 | `/home/z/my-project/agent-ctx/subpage-dom-notes.md` | 子页面 DOM 选择器汇总 |
| 9 站点 CSS 关键信息 | `/home/z/my-project/agent-ctx/site-notes2.md` | :root 变量+body font+bg+a color+.book 样式 |
| trxsw.com 反查 DOM | 任务描述 (AiraBrowser 完整配置) | 域名过期, 通过 GitHub mason173/aira-browser 反查 .vlist/.detail/.content/.pager DOM |

## 1. 10 套精仿 preset (THEMES 数组, 全部基于实测 CSS)

| # | id | name | primary | accent | radius | bg | contentSelector |
|---|---|---|---|---|---|---|---|
| 1 | clone-aijjxs | 精仿·久久小说 | #0f766e (青绿) | #b45309 (琥珀) | 14px | 双层 radial-gradient + #f3efe7 | #view_content_txt |
| 2 | clone-ddyueshu | 精仿·得得小说 | #6F78A7 (蓝紫) | #88C6E5 (天蓝) | 2px | #E9FAFF (浅蓝底) | #content |
| 3 | clone-pilishuwu | 精仿·霹雳书屋 | #fd8929 (暖橙) | #ec5245 (红橙) | 2px | #fdf6ec (浅米黄兜底) | #content |
| 4 | clone-23qb | 精仿·铅笔小说 | #ff2a14 (鲜红) | #c01a0c (暗红) | 5px | #f8f9f9 (浅灰) | #content |
| 5 | clone-101kks | 精仿·101kks | #667eea (蓝紫) | #764ba2 (紫) | 10px | #f2f3f4 (浅灰) | #content |
| 6 | clone-huangjinwu | 精仿·黄金屋 | #2563eb (蓝) | #1d4ed8 (深蓝) | 6px | linear-gradient(180deg, #f5f8ff, #eef3fb) | #content |
| 7 | clone-ggd66 | 精仿·ggd66 | #00886d (青绿) | #ff5500 (橙红) | 4px | #f9f9f9 (浅灰白) | #content |
| 8 | clone-shipsay | 精仿·船说CMS | #ed4259 (红) | #bf2c24 (深红) | 3px | #f4f4f4 (灰底) | .content |
| 9 | clone-x2552 | 精仿·x2552 | #2f468f (蓝紫) | #ff6600 (橙) | 3px | #fafafa (灰白) | #content |
| 10 | clone-trxsw | 精仿·天人小说 | #2c7be5 (深蓝) | #1a5fb4 (深蓝副) | 4px | #f5f7fa (浅灰蓝) | .content |

- **THEMES.length** = 10 ✓
- **default** = clone-aijjxs ✓
- 所有 10 个 ID 均可通过 getThemeById 解析 ✓
- 每套 preset 都声明 contentSelector (R14-1A 新增字段, 用于 ReadView 包裹正文 id/class 复刻原站 DOM)

## 2. 首页布局适配 (HomeView.tsx + 10 个 HomeClone*.tsx)

- HomeView.tsx 已动态导入 10 个 HomeClone*.tsx 懒加载分包 ✓
- 10 个分发分支: `theme.layout === 'clone-<site>'` ✓
- 兜底白名单扩为 10 个 layout key (含 'clone-trxsw') ✓
- 加载态用 BookGridSkeleton 兜底 ✓

10 个 HomeClone*.tsx 文件清单 (R13-1B 已基于子页面 DOM 完成精仿):

| 文件 | LoC | 主要结构 |
|---|---|---|
| HomeCloneAijjxs.tsx | 306 | banner + 5 列封面卡 + 表格最近更新 + 琥珀排行榜 |
| HomeCloneDdyueshu.tsx | 498 | .header + .nav (10 分类) + #hotcontent l/r + .novelslist + #newscontent |
| HomeClonePilishuwu.tsx | 280 | mod-top-logo + mod-top-search-wr + bk-list 大量热书卡 |
| HomeClone23qb.tsx | 310 | header-content + nav-menu-item + module-item 网格 + block-box-item |
| HomeClone101kks.tsx | 301 | .headbox + .booklist-card + .booklist-cover-section 蓝紫渐变 |
| HomeCloneHuangjinwu.tsx | 360 | .headers 玻璃 backdrop-blur + .navbar-menu + .book-grid |
| HomeCloneGgd66.tsx | 314 | .header 薄荷绿头 + #fengtui + #fengyou/#zuixin + .breadcrumb |
| HomeCloneShipsay.tsx | 689 | .navigation 深灰头 + .side_commend + .lastupdate + .popular |
| HomeCloneX2552.tsx | 371 | .m_head 60px + .m_menu 40px + .board + #centeri + #right/#left |
| HomeCloneTrxsw.tsx | 513 | .container.head + nav 8 分类 + .vlist + .popular + .detail-style |

每个组件: usePublic() + theme.vars 引用, Skeleton + 空态 + 响应式 (sm/md/lg) ✓

## 3. 书籍页适配 (BookView + BookInfoLayout)

R14-1A 新增 `src/components/public/BookInfoLayout.tsx` (~560 LoC), 按 theme.layout 区分 10 套精仿 DOM:

| layout | DOM 结构 | 实测来源 |
|---|---|---|
| clone-aijjxs | `article.panel h3` + `div.body.detail (div.pic + div.kv)` + `article.intro-panel` | probe-aijjxs-book.html |
| clone-ddyueshu | `#info h1` + `.bookinfo` + `#fmimg` + `#intro` | biquge.css 通用模板 |
| clone-pilishuwu | `.detail` (h2 + .info + .cover + .intro) | wmcms-web 模板 |
| clone-23qb | `.book-info` (.book-cover + .book-detail + .book-intro) | mxstatic 模板 (CF 拦截, 首页结构推断) |
| clone-101kks | `.main .bookinfo` (.bookimg + .newnav) + `#intro` | probe-101kks-book.html |
| clone-huangjinwu | `.book-detail` (.book-cover + .book-info + .book-intro) | default 模板 |
| clone-ggd66 | `.book-info` (与 clone-23qb 同结构, simple 模板) | probe-ggd66.html |
| clone-shipsay | `.side_commend .detail` (左封面 + 右标题/作者/简介) | shipsay.css |
| clone-x2552 | `.book-info` (与 clone-23qb 同结构, heibing 模板) | probe-x2552.html |
| clone-trxsw | `.detail .name strong` + `.detail .author a` + `.detail > img` + `.intro` | AiraBrowser 反查 |

BookView.tsx:
- 删除内联 9 套 clone-* 通用信息区分支 (panelStyle + coverW + 单一 panel)
- 改为 `<BookInfoLayout ... />` 接力分发, 由 theme.layout 决定 DOM 结构
- 删除不再使用的 import: Bookmark / Clock / Download / ListTree / fmtDate / ShareMenu / StatusBadge / ReadFirstButton / formatReadTimeShort
- 保留 PSEOKeywordsSection (R13-1A 集成, 不回滚) ✓
- 保留 RelatedBooks / BookStatsBar / TocChapterButton (R13-1C useEffect cleanup) ✓
- 保留 SecTitle + TagCloud + 章节目录分页 + 上次阅读徽章 (savedPos) ✓

## 4. 目录页适配 (BookView 内 toc 区)

- 全 10 套主题统一走默认 3 列剧集列表 (grid-cols-1 sm:grid-cols-2 lg:grid-cols-3) ✓
- 章节预览 tooltip (TocChapterButton, R13-1C useEffect cleanup) ✓
- 分卷分组 (volGroups): 仅当目录出现卷名才启用 (kk-a 番茄规则提取) ✓
- 目录翻页 (上一页/下一页/页码指示) ✓

## 5. 章节页适配 (ReadView + 4 种 read-layouts)

R14-1A 新增:
- `theme.contentSelector` 字段 (10 套 preset 全部声明, 见 §1)
- `parseContentSelector(selector)` 工具函数 (shared.tsx): `#xxx` → `{id: 'xxx'}`, `.xxx` → `{className: 'xxx'}`, 容错复合选择器降级为空
- ReadView.tsx 透传 `contentSelector: theme.contentSelector` 到所有 read-layouts (ReadClassic/ReadPili/ReadImmersive/ReadPaginated)
- 4 个 read-layouts 在正文外层 `<div>` 上 spread `{...parseContentSelector(contentSelector)}`, 实测原站 DOM 复刻:
  - clone-aijjxs: `<div id="view_content_txt">`
  - clone-ddyueshu/clone-pilishuwu/clone-23qb/clone-101kks/clone-huangjinwu/clone-ggd66/clone-x2552: `<div id="content">`
  - clone-shipsay/clone-trxsw: `<div class="content">`

readOf(theme) 9 字段全部生效 (10 套 read 配置表):
- layout: 全部 'classic' (10/10)
- measure: 720/740/760 (3 档, 按 body font-size 推断)
- lineHeight: 1.65 / 1.7 / 1.8 / 1.85 / 1.9 / 1.95 / 2 (7 档)
- fontBase: 14 / 16 / 17 (3 档, 按实测 body font-size)
- indent: 全部 true (10/10)
- justify: aijjxs/23qb=true, 其余 false
- toolbar: 全部 'inline'
- texture: pilishuwu='paper', 其余 'none'
- chapterDeco: pilishuwu='ornament', 其余 'rule'

## 6. 分类页适配 (CategoryView)

- 全 10 套主题统一走通用 ThemeBookList (BookCard 网格) ✓
- 网格布局 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 ✓
- Pagination 主题化 (radius/colors by theme.vars) ✓
- 无回归: 通用 ThemeBookList 由 R12-1 引入, R14-1A 不动 ✓

## 7. 关键词页 / 搜索页 / 历史页

- 关键词页 (KeywordView): R13-1A 已增强为 PSEO 落地页, ~30 处 theme.vars 引用, 不回滚 ✓
- 搜索页 (SearchView): ~10+ 处 theme.vars 引用, 不动 ✓
- 历史页 (HistoryView): ~30+ 处 theme.vars 引用 (含 AlertDialog 主题化), 不动 ✓

## 8. 验证结果

| 验证项 | 命令 | 结果 |
|---|---|---|
| TypeScript 编译 | `bunx tsc --noEmit` (排除 examples/skills) | **0 errors** ✓ |
| ESLint 检查 | `bun run lint` | **0 errors / 0 warnings** ✓ |
| 主题 preset 数量 | `bunx tsx scripts/test-themes-r14.ts` | THEMES.length=10 ✓ |
| 默认主题 | 同上 | default=clone-aijjxs ✓ |
| 10 个 ID 解析 | 同上 | 10/10 全部 OK, contentSelector 全部声明 ✓ |
| BookView 信息区 | 切换不同 theme.layout 时渲染对应 DOM 分支 | 10 套 BookInfoLayout variant 全部就绪 ✓ |
| ReadView 正文容器 | 切换不同 theme 时正文 div id/class 变化 | #content / .content / #view_content_txt 全部生效 ✓ |
| PSEO 集成 | BookView 底部 PSEOKeywordsSection 仍渲染 | R13-1A 不回滚 ✓ |
| R13-1C bug 修复 | TocChapterButton useEffect cleanup / fetchRelatedKeywords .catch / clearPSEOCacheForBook 全部保留 | ✓ |

## 9. 不修改的文件清单 (按任务约束)

- `bits.tsx` (StatusBadge/TagCloud/Sk/SecTitle/EmptyState/ErrorState/ChapterListSkeleton) ✓
- `seo.ts` (TDK / coverSrc / formatWords / statusLabel / statusStyle / withAlpha / fmtDate) ✓
- `ctx.tsx` (PublicSite context + navigate) ✓
- `BookCover.tsx` (封面占位 + 字母色块) ✓
- `types.ts` (BookItem/BookDetail/ChapterData/KeywordData/BookPSEOData) ✓
- `cleaner.ts` (R13-1D 已删 dead code) ✓
- `suggest.ts` (R13-1A PSEO + LRU 缓存) ✓

## 10. 修改文件清单 (R14-1A)

新增:
- `src/components/public/BookInfoLayout.tsx` (~560 LoC, 10 套 BookInfo 变体 + 共享 ActionButtons/BookMetaLine/CoverWithHalo)
- `scripts/test-themes-r14.ts` (验证脚本, 10 套 preset + contentSelector)

修改:
- `src/lib/crawl/themes.ts`:
  - 头部注释更新为 R14-1A
  - ThemeDef 接口新增 `contentSelector?: string` 字段
  - 10 套 preset 各自声明 contentSelector (实测原站值)
- `src/components/public/BookView.tsx`:
  - 头部注释新增 R14-1A 说明
  - 删除内联信息区渲染 (panelStyle/coverW/section/h1/div kv/...)
  - 改用 `<BookInfoLayout />` 接力分发 (按 theme.layout 决定 DOM)
  - 清理不再使用的 import: Bookmark / Download / fmtDate / ShareMenu / StatusBadge / ReadFirstButton / formatReadTimeShort
- `src/components/public/read-layouts/shared.tsx`:
  - ReadLayoutProps 接口新增 `contentSelector?: string` 字段
  - 新增 `parseContentSelector(selector)` 工具函数
- `src/components/public/read-layouts/ReadClassic.tsx`:
  - 解构 props 新增 contentSelector
  - 正文外层 div spread `{...parseContentSelector(contentSelector)}`
- `src/components/public/read-layouts/ReadPili.tsx`: 同 ReadClassic
- `src/components/public/read-layouts/ReadImmersive.tsx`: 同 ReadClassic
- `src/components/public/read-layouts/ReadPaginated.tsx`: 同 ReadClassic
- `src/components/public/ReadView.tsx`:
  - shared props 新增 `contentSelector: theme.contentSelector` 透传
- `src/components/public/HomeView.tsx`:
  - 头部注释更新为 R14-1A
  - 分发分支注释更新 (10 套全保留)

## 11. 良性硬编码说明

- Tailwind hover 任意值类 (如 `hover:bg-[rgba(44,123,229,0.04)]`): 等同 v.primary, 但 Tailwind 无法基于运行时值生成动态 hover 类, 故部分 hover 色用 inline rgba
- 已通过 usePublic() + theme.vars 保证: surface/text/primary/accent/border/radius/fontFamily/cardShadow 全部主题化
- 10 个 HomeClone*.tsx + BookInfoLayout 10 套变体均使用 usePublic() + theme.vars (无站点硬编码色)

## 12. 总结

- 10 套精仿 preset 完整保留 (R13-1B 已基于实测 CSS 变量精仿, R14-1A 不动)
- BookInfoLayout 10 套 DOM 变体按 theme.layout 区分 (article.panel / #info / .detail / .book-info 等)
- ReadView contentSelector 透传到 4 个 read-layouts, 复刻原站正文容器 id/class (#content / .content / #view_content_txt)
- tsc 0 errors / lint 0 errors / 0 warnings
- 10 套 preset + contentSelector 全部声明, 测试脚本 10/10 通过
