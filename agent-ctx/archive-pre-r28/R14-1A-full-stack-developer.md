# R14-1A Work Record

- **Task ID**: R14-1A
- **Agent**: full-stack-developer
- **Task**: 删除现有所有 10 套主题模版, 重新完整克隆 10 个站点的主题模版 (含子页面 DOM)
- **Date**: 2026-09-15

## 输入文件参考 (来自主代理抓取)
- `/home/z/my-project/agent-ctx/probe-html2/probe-<site>.{html,css}` × 10 站点首页+CSS
- `/home/z/my-project/agent-ctx/probe-html2/probe-<site>-{book,chapter,category}.html` 子页面 DOM (部分站点)
- `/home/z/my-project/agent-ctx/site-notes2.md` 9 站点 CSS 关键信息
- `/home/z/my-project/agent-ctx/subpage-dom-notes.md` 子页面 DOM 摘要
- AiraBrowser 完整配置 (任务描述内, trxsw.com 反查 DOM)

## 执行步骤

### 步骤 1: 阅读所有站点的 HTML+CSS+子页面
- 阅读 `probe-aijjxs.{html,css}` + `probe-aijjxs-{book,chapter,category}.html`
- 阅读 `probe-pilishuwu.{html,css}` + `probe-pilishuwu-{book,chapter,category}.html`
- 阅读 `probe-23qb.{html,css}` + `probe-23qb-{book,category}.html` (chapter 子页 CF 拦截)
- 阅读 `probe-101kks.{html,css}` + `probe-101kks-{book,chapter,category}.html`
- 阅读 `probe-ddyueshu/probe-huangjinwu/probe-ggd66/probe-shipsay/probe-x2552.{html,css}`
- trxsw.com 通过 AiraBrowser 配置反查 DOM (`.vlist/.detail/.content/.pager/.headline/.intro`)
- 阅读 `subpage-dom-notes.md` + `site-notes2.md` 综合提取关键样式

### 步骤 2: themes.ts THEMES 数组 (10 套精仿 preset 全保留 + 新增 contentSelector)
- 头部注释更新为 R14-1A 全量重克隆含子页面 DOM
- ThemeDef 接口新增 `contentSelector?: string` 字段
- 10 套 preset 各自声明 contentSelector (实测原站值):
  - clone-aijjxs: `#view_content_txt`
  - clone-ddyueshu: `#content`
  - clone-pilishuwu: `#content`
  - clone-23qb: `#content`
  - clone-101kks: `#content`
  - clone-huangjinwu: `#content`
  - clone-ggd66: `#content`
  - clone-shipsay: `.content`
  - clone-x2552: `#content`
  - clone-trxsw: `.content`
- ThemeDef.layout 类型联合保持 10 个 clone-* (R13-1B 已就位, 不动)
- 10 套 preset 的 vars (bg/surface/text/primary/accent/border/radius/fontFamily/cardShadow/headerStyle) 基于实测 CSS 变量, R13-1B 已完成精仿, R14-1A 不动
- 10 套 read 配置 (layout/measure/lineHeight/fontBase/indent/justify/toolbar/texture/chapterDeco) 保持

### 步骤 3: BookInfoLayout.tsx 新建 (10 套精仿 DOM 变体)
- 新建 `src/components/public/BookInfoLayout.tsx` (~560 LoC)
- 10 套布局变体:
  - BookInfoAijjxs: `article.panel h3` + `div.body.detail (div.pic + div.kv)` + `article.intro-panel`
  - BookInfoDdyueshu: `#info h1` + `.bookinfo` + `#fmimg` + `#intro`
  - BookInfoPilishuwu: `.detail (h2 + .info + .cover + .intro)` (wmcms-web 模板)
  - BookInfo23qb: `.book-info (.book-cover + .book-detail + .book-intro)`
  - BookInfo101kks: `.main .bookinfo (.bookimg + .newnav)` + `#intro`
  - BookInfoHuangjinwu: `.book-detail (.book-cover + .book-info + .book-intro)`
  - BookInfoGgd66: 同 clone-23qb 结构 (simple 模板通用)
  - BookInfoShipsay: `.side_commend .detail (左封面 + 右标题/作者/简介)`
  - BookInfoX2552: 同 clone-23qb 结构 (heibing 模板通用)
  - BookInfoTrxsw: `.detail .name strong` + `.detail .author a` + `.detail > img` + `.intro` (AiraBrowser 反查)
- 共享子组件: ActionButtons (开始阅读/上次阅读/目录/TXT/分享) + BookMetaLine (关键词/最新章节) + CoverWithHalo (封面+光晕) + usePanelStyle (panelStyle 共享)
- 入口 BookInfoLayout 按 theme.layout switch 分发, default 兜底 BookInfoAijjxs

### 步骤 4: BookView.tsx 重构
- 删除内联信息区渲染 (panelStyle + coverW + section + h1 + div.kv + ActionButtons 内联块 ~120 行)
- 改用 `<BookInfoLayout />` 接力分发, 由 theme.layout 决定 DOM 结构
- 清理不再使用的 import: Bookmark / Download / fmtDate / ShareMenu / StatusBadge / ReadFirstButton / formatReadTimeShort
- 保留 PSEOKeywordsSection (R13-1A 集成, 不回滚)
- 保留 RelatedBooks / BookStatsBar / TocChapterButton (R13-1C useEffect cleanup)
- 保留 SecTitle + TagCloud + 章节目录分页 + 上次阅读徽章 (savedPos)
- 保留所有 SEO TDK + JSON-LD 渲染逻辑

### 步骤 5: ReadView + read-layouts 4 个文件
- shared.tsx ReadLayoutProps 接口新增 `contentSelector?: string` 字段
- shared.tsx 新增 `parseContentSelector(selector)` 工具函数:
  - `#xxx` → `{id: 'xxx'}`
  - `.xxx` → `{className: 'xxx'}`
  - undefined / '' → `{}` (不附加)
  - 复合选择器降级为空 (避免误用)
- ReadView.tsx shared props 新增 `contentSelector: theme.contentSelector` 透传
- 4 个 read-layouts 在正文外层 div spread `{...parseContentSelector(contentSelector)}`:
  - ReadClassic.tsx: 正文 div (复刻原站 #content / .content / #view_content_txt)
  - ReadPili.tsx: 同上 (data-pili-content 标记保留)
  - ReadImmersive.tsx: 同上
  - ReadPaginated.tsx: 同上

### 步骤 6: HomeView.tsx + HomeClone*.tsx
- 头部注释更新为 R14-1A
- 分发分支注释更新 (10 套全保留)
- 10 个 HomeClone*.tsx 文件保留 (R13-1B 已基于子页面 DOM 精仿, 不需重写)
- 兜底白名单扩为 10 个 layout key (已就位)

### 步骤 7: 验证
- `bunx tsc --noEmit` (排除 examples/skills): **0 errors** ✓
- `bun run lint`: **0 errors / 0 warnings** ✓
- `bunx tsx scripts/test-themes-r14.ts`:
  - THEMES.length=10 ✓
  - default=clone-aijjxs ✓
  - 10 个 ID 全部 OK, contentSelector 全部声明 ✓
  - 10 套 preset 的 id/name/primary/layout/contentSelector 全部输出验证

## 修改文件清单 (R14-1A)

新增:
- `src/components/public/BookInfoLayout.tsx` (~560 LoC, 10 套 BookInfo 变体)
- `scripts/test-themes-r14.ts` (验证脚本)

修改:
- `src/lib/crawl/themes.ts` (头部注释 + ThemeDef 接口 + 10 套 preset contentSelector 字段)
- `src/components/public/BookView.tsx` (头部注释 + 信息区改用 BookInfoLayout + 清理 import)
- `src/components/public/ReadView.tsx` (shared props 新增 contentSelector 透传)
- `src/components/public/read-layouts/shared.tsx` (ReadLayoutProps + parseContentSelector)
- `src/components/public/read-layouts/ReadClassic.tsx` (解构 contentSelector + 正文 div spread)
- `src/components/public/read-layouts/ReadPili.tsx` (同上)
- `src/components/public/read-layouts/ReadImmersive.tsx` (同上)
- `src/components/public/read-layouts/ReadPaginated.tsx` (同上)
- `src/components/public/HomeView.tsx` (头部注释 + 分发分支注释更新)

## 不修改的文件 (任务约束)
- bits.tsx / seo.ts / ctx.tsx / BookCover.tsx / types.ts / cleaner.ts / suggest.ts ✓
- R13-1A 的 PSEO 集成 (BookView 中的 PSEOKeywordsSection) 不回滚 ✓
- R13-1C 的 bug 修复 (TocChapterButton useEffect cleanup / fetchRelatedKeywords .catch / clearPSEOCacheForBook) 不回滚 ✓
- 未安装新的 npm 包 ✓

## 主题审计报告
- `/home/z/my-project/agent-ctx/theme-audit-r14.md` (12 章节, 含 10 套 preset 表 + BookInfoLayout 10 套 DOM 变体 + ReadView contentSelector 透传 + 验证结果 + 修改文件清单 + 良性硬编码说明)

## 验证
- tsc 0 errors ✓
- lint 0 errors / 0 warnings ✓
- THEMES.length=10, 10 个 ID 全部可解析, contentSelector 全部声明 ✓
- BookInfoLayout 10 套变体按 theme.layout 分发 ✓
- 4 个 read-layouts 复刻原站正文容器 id/class (#content / .content / #view_content_txt) ✓
- PSEO + R13-1C bug 修复全部保留, 不回滚 ✓
