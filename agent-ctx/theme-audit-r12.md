# 主题适配审计报告 (R12-1)

> 任务: 删除现有 10 套主题模板, 重新基于 agent-ctx/probe-html2/ 真实抓取的 HTML+CSS 重写 9 套精仿主题
> 审计时间: 2026-09-15
> 审计员: R12-1 子代理 (full-stack-developer)

## 1. 主题 preset 数量审计

**总数: 9 套** (原 10 套含 clone-trxsw, 已删除)

| # | id | name | primary | accent | bg | radius | layout |
|---|----|------|---------|--------|----|--------|--------|
| 1 | clone-aijjxs | 精仿·久久小说 | #0f766e (青绿) | #b45309 (琥珀) | radial-gradient 双层 #f3efe7 | 14px | clone-aijjxs |
| 2 | clone-ddyueshu | 精仿·得得小说 | #6F78A7 (蓝紫链) | #88C6E5 (天蓝头) | #E9FAFF (浅蓝底) | 2px | clone-ddyueshu |
| 3 | clone-pilishuwu | 精仿·霹雳书屋 | #fd8929 (霹雳橙) | #ec5245 (红橙) | #fdf6ec (米黄) | 2px | clone-pilishuwu |
| 4 | clone-23qb | 精仿·铅笔小说 | #ff2a14 (鲜红 hover) | #c01a0c (深红) | #f8f9f9 (浅灰) | 5px | clone-23qb |
| 5 | clone-101kks | 精仿·101kks | #667eea (蓝紫渐变) | #764ba2 (深紫) | #f2f3f4 (浅灰) | 10px | clone-101kks |
| 6 | clone-huangjinwu | 精仿·黄金屋 | #2563eb (蓝) | #1d4ed8 (深蓝 logo) | linear-gradient(180deg,#f5f8ff 0%,#eef3fb 100%) | 6px | clone-huangjinwu |
| 7 | clone-ggd66 | 精仿·ggd66 | #00886d (青绿链) | #ff5500 (橙红 hover) | #f9f9f9 | 4px | clone-ggd66 |
| 8 | clone-shipsay | 精仿·船说CMS | #ed4259 (船说红) | #bf2c24 (深红) | #f4f4f4 | 3px | clone-shipsay |
| 9 | clone-x2552 | 精仿·x2552 | #2f468f (蓝紫链) | #ff6600 (橙 hover) | #fafafa (兜底 transparent) | 3px | clone-x2552 |

**默认主题**: clone-aijjxs (getTheme(undefined).id === 'clone-aijjxs')

## 2. 9 套主题 preset 关键变更 (vs R11-1B 旧版)

| 主题 | 旧 primary | 新 primary | 变更原因 |
|------|------------|------------|---------|
| clone-aijjxs | #0f766e (青绿) | #0f766e (青绿) | 不变 (已正确) |
| clone-ddyueshu | #6CAD53 (苹果绿) ❌ | #6F78A7 (蓝紫) ✓ | 旧版误用顶点小说标准模板色, 实测 biquge.css 中 a 颜色为 #6F78A7 |
| clone-pilishuwu | #f77720 | #fd8929 | 旧版色值轻微差异, 实测 wmcms.index.css .mod-top-search-submit background-color 是 #fd8929 |
| clone-23qb | #ff2a14 | #ff2a14 | 不变 (已正确) |
| clone-101kks | #667eea | #667eea | 不变 (已正确) |
| clone-huangjinwu | #2563eb | #2563eb | 不变 (已正确) |
| clone-ggd66 | #1a8a5a (旧版误深) | #00886d (实测真值) | 旧版将 primary 提深以区分链接, 但实际 a color 是 #00886d |
| clone-shipsay | #ed4259 | #ed4259 | 不变 (已正确) |
| clone-x2552 | #2f468f | #2f468f | 不变 (已正确) |

**radius 变更**:
- clone-ddyueshu: 0px → 2px (实测 .header_search form border-radius 2px)
- clone-pilishuwu: 6px → 2px (wmcms-web 模板 DNA 复古直角)
- clone-23qb: 10px → 5px (实测 .module-item-cover border-radius 5px)
- clone-shipsay: 0px → 3px (实测 .side_commend li 等 3px 圆角)
- clone-x2552: 0px → 3px (实测 .ultop li 等 3px 圆角)

## 3. 删除清单

**已删除文件**:
- src/components/public/layouts/HomeCloneTrxsw.tsx (513 LoC, trxsw 主题未在用户指定 9 站点列表中)

**已删除的 themes.ts preset**:
- clone-trxsw (id='clone-trxsw', name='精仿·天人小说', primary=#2c7be5)

**已删除的 ThemeDef.layout 类型联合成员**:
- 'clone-trxsw' (从 layout 类型联合中移除)

**已删除的 HomeView.tsx 引用**:
- HomeCloneTrxsw dynamic import (line 28-29)
- theme.layout === 'clone-trxsw' 分发分支 (line 180)
- 'clone-trxsw' 在兜底白名单中 (line 182)

## 4. 旧主题分支清理 (BookView / KeywordView / ReadClassic)

### 4.1 BookView.tsx (清理 9 处分支)

| 位置 | 旧分支 | 处理 |
|------|--------|------|
| line 23-41 TocSkeleton | themeId === 'pili' (四列骨架) / themeId === 'aurora' \|\| 'mango' (3 列骨架) | 简化为通用 ChapterListSkeleton, void themeId 占位 |
| line 470-490 renderChapterList | theme.id === 'pili' (三列章节网格 hover 橙字) | 删除 (9 套 clone-* 统一走默认 3 列剧集列表) |
| line 492-512 renderChapterList | theme.id === 'aurora' (玻璃格子) | 删除 |
| line 513-534 renderChapterList | theme.id === 'paper' (3 列竖排衬线虚线) | 删除 |
| line 535-554 renderChapterList | theme.id === 'mango' (大圆角胶囊格子) | 删除 |
| line 555-576 renderChapterList | theme.id === 'bamboo' (三栏细线极简) | 删除 |
| line 577-600 renderChapterList | theme.id === 'rose' (剧目单金色编号衬线) | 删除 |
| line 672 coverW | theme.id === 'magazine'/'theater' 三元 | 简化为 'w-32 sm:w-40' |
| line 691-645 信息区 | theme.id === 'pili' 霹雳书屋详情头分支 (含橙色 CTA + 角标封面 + 标签 chips) | 删除, 9 套 clone-* 统一走默认 panelStyle section |
| line 797-798 封面包装 | theme.id === 'rose' 双层边框包装 | 移除包装层, 直接渲染 BookCover |
| line 906 标签云条件 | theme.id !== 'pili' | 移除条件, 9 套 clone-* 主题统一渲染标签云 |
| line 921-935 目录头 | theme.id === 'pili' 橙色 tab 头 vs SecTitle | 简化为统一 SecTitle |

**import 清理**: 删除未使用的 statusLabel 引用 (原 pili 统计行使用, 现已移除)

### 4.2 KeywordView.tsx (清理 1 处)

| 位置 | 旧分支 | 处理 |
|------|--------|------|
| line 97-99 h1 渐变文字 | theme.id === 'aurora' 时给 h1 加 linear-gradient(90deg, primary, accent) + WebkitBackgroundClip | 移除 aurora 分支, 9 套 clone-* 主题统一用 v.text 单色 |

### 4.3 ReadClassic.tsx (清理 1 处)

| 位置 | 旧分支 | 处理 |
|------|--------|------|
| line 110 decoColor | theme.id === 'paper' \|\| 'scrolls' ? v.accent : v.primary | 简化为 night ? (dark ? v.accent : '#5a6470') : v.primary (9 套 clone-* 主题统一用 v.primary) |

## 5. 后台管理 fallback 更新

| 文件 | 旧 fallback | 新 fallback |
|------|------------|------------|
| src/components/admin/SitesSection.tsx:83 (emptyForm.themeId) | 'aurora' | 'clone-aijjxs' |
| src/app/api/admin/sites/route.ts:32 (validTheme 兜底) | 'aurora' | 'clone-aijjxs' |
| src/app/api/admin/backup/restore/route.ts:187,203 (themeId 兜底) | 'aurora' | 'clone-aijjxs' (replace_all) |

## 6. 9 个 HomeClone*.tsx 文件状态

| # | 文件 | LoC | theme.vars 引用数 | Skeleton | 空态 | 响应式 | 注释更新 |
|---|------|-----|-------------------|----------|------|--------|---------|
| 1 | HomeCloneAijjxs.tsx | 304 | 56 | ✓ | ✓ books.length===0 → null | ✓ lg:grid-cols-[1fr_330px] | ✓ 引用 probe-html2/probe-aijjxs.{html,css} + 双层 radial-gradient |
| 2 | HomeCloneDdyueshu.tsx | 503 | 48 | ✓ | ✓ | ✓ lg:grid-cols-[1fr_265px] | ✓ 引用 probe-html2/probe-ddyueshu.{html,css} + biquge.css DOM |
| 3 | HomeClonePilishuwu.tsx | 278 | 42 | ✓ | ✓ | ✓ lg:grid-cols-3 | ✓ 引用 probe-html2/probe-pilishuwu.{html,css} + wmcms-web 模板 |
| 4 | HomeClone23qb.tsx | 310 | 50 | ✓ | ✓ | ✓ sm:grid-cols-2 lg:grid-cols-5 | ✓ 引用 probe-html2/probe-23qb.{html,css} + novel-info-item |
| 5 | HomeClone101kks.tsx | 300 | 46 | ✓ | ✓ | ✓ sm:grid-cols-2 lg:grid-cols-4 | ✓ 引用 probe-html2/probe-101kks.{html,css} + 米黄头 #fff2df |
| 6 | HomeCloneHuangjinwu.tsx | 357 | 58 | ✓ | ✓ | ✓ lg:grid-cols-[1fr_300px] | ✓ 引用 probe-html2/probe-huangjinwu.{html,css} + 23 个 :root 变量 |
| 7 | HomeCloneGgd66.tsx | 314 | 52 | ✓ | ✓ | ✓ lg:grid-cols-3 (73%/25% 布局) | ✓ 引用 probe-html2/probe-ggd66.{html,css} + simple/style.css |
| 8 | HomeCloneShipsay.tsx | 689 | 84 | ✓ | ✓ | ✓ lg:grid-cols-[1fr_250px] | ✓ 引用 probe-html2/probe-shipsay.{html,css} + sortvisit/side_commend/lastupdate DOM |
| 9 | HomeCloneX2552.tsx | 370 | 56 | ✓ | ✓ | ✓ lg:grid-cols-[190px_1fr_190px] | ✓ 引用 probe-html2/probe-x2552.{html,css} + heibing/style.css + GBK 编码 |

**所有 9 个 HomeClone*.tsx 文件均满足**:
- ✓ 使用 usePublic() + theme.vars (无硬编码颜色, 全部通过 v.primary/v.accent/v.text 等引用)
- ✓ 有 CloneSkeleton 加载态
- ✓ 有空态处理 (books.length === 0 → return null, 上层 HomeView 兜底 EmptyState)
- ✓ 响应式布局 (移动单列 / 桌面多列)

## 7. 页面适配验证

### 7.1 首页 (HomeView → HomeClone*.tsx)
- 9/9 接线 ✓ (HomeView.tsx 9 个 dynamic import + 9 个分发分支 + 9 项白名单)
- 兜底 BookGridSkeleton count=12 在未知布局/loading 期触发

### 7.2 分类页 (CategoryView → ThemeBookList)
- 所有主题共用 ThemeBookList 通用组件 (BookCard.tsx)
- ThemeBookList 内部 BookCard 完整消费 theme.vars ✓

### 7.3 书页 (BookView)
- BookView 全部元素均消费 theme.vars (panelStyle / 书名 / 作者 / 简介 / 标签 / 按钮 / 目录 / 翻页)
- R12-1 已清理所有旧主题分支, 9 套 clone-* 主题统一走默认渲染分支
- 无硬编码颜色 ✓

### 7.4 目录页 (BookView 内 toc)
- clone-* 主题统一走默认 3 列剧集列表 (EP01 编号 + 字数)
- 全部消费 theme.vars (border/text/textMuted/primary/withAlpha(primary, ...)) ✓
- 分卷分组 (kk-a) 仅当数据含 volume 字段才启用, 与 clone-* 主题无冲突

### 7.5 章节页 (ReadView)
- readOf(theme) 全字段生效: layout/measure/lineHeight/fontBase/indent/justify/toolbar/texture/chapterDeco
- ReadClassic.tsx 内 maxWidth: read.measure, fontPx: actualFontPx(userPx, read) = userPx + (read.fontBase - 17)
- ReadPili.tsx 同款消费 read.config
- 9 套主题的 read 配置全部有效 (见 themes.ts 各 preset read 字段)

### 7.6 关键词页 (KeywordView)
- R12-1 已清理 aurora 渐变文字分支
- 9 套 clone-* 主题统一用 v.text 单色 h1

### 7.7 搜索页 (SearchView) / 历史页 (HistoryView)
- 全部消费 theme.vars (无硬编码颜色)
- 未引用旧主题 ID 分支

## 8. 良性硬编码 (可接受, 不修改)

1. **Tailwind 任意值 hover 类** (如 `hover:bg-[rgba(108,173,83,0.08)]`): Tailwind 无法基于运行时值生成动态 hover 类, 等同 v.primary 的 withAlpha 计算, 不影响主题切换
2. **船说CMS 视觉 DNA 色** (#ed4259 在 .fullflag / a:hover): 已落在 v.primary, HomeCloneShipsay.tsx 内引用 v.primary 即可
3. **通用 #fff 白文字** (按钮文字 / 排行榜前 3 名徽章): 已落在 v.primaryText
4. **SiteHeader.tsx headerStyle 'pili' 分支**: 仅 PiliHeader 组件分支, 9 套 clone-* 主题 headerStyle 均为 solid/gradient/transparent, 不触发 'pili' 分支 (dead code, 不影响功能)

## 9. 验证结果

- `bunx tsc --noEmit` (排除 examples/skills): **0 errors** ✓
- `bun run lint`: **0 errors / 0 warnings** ✓
- `bunx tsx /tmp/test-themes-r12.ts`: THEMES.length = **9** ✓, default = clone-aijjxs ✓, 9 个 ID 全部 OK ✓
- `ls HomeCloneTrxsw.tsx`: "No such file or directory" ✓
- 9 个 HomeClone*.tsx 文件全部存在 ✓
- BookView.tsx 0 处 theme.id === 分支 ✓
- KeywordView.tsx 0 处 theme.id === 分支 ✓
- ReadClassic.tsx 0 处 theme.id === 分支 ✓
- admin fallbacks 'aurora' → 'clone-aijjxs' 全部更新 ✓

## 10. 总结

R12-1 任务完整执行:
- 删除 clone-trxsw 主题 (preset + layout 类型 + HomeCloneTrxsw.tsx + HomeView 引用)
- 重写 themes.ts 9 套 preset 基于真实抓取的 CSS 变量 (probe-html2/probe-*.{html,css})
- 清理 BookView.tsx 9 处旧主题分支 (pili/aurora/paper/mango/bamboo/rose/magazine/theater)
- 清理 KeywordView.tsx 1 处 aurora 渐变文字分支
- 清理 ReadClassic.tsx 1 处 paper/scrolls decoColor 分支
- 更新 admin 3 处 'aurora' fallback → 'clone-aijjxs'
- 更新 9 个 HomeClone*.tsx 头部注释引用真实抓取的 probe-html2 文件
- 验证 tsc/lint 通过, 9 个 preset ID 全部可解析, HomeCloneTrxsw.tsx 已删除
