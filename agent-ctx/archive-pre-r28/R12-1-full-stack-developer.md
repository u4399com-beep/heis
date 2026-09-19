# R12-1 Agent Work Record

**Task ID**: R12-1
**Agent**: full-stack-developer
**Task**: 删除现有所有主题模板，重新基于 agent-ctx/probe-html2/ 真实抓取的 HTML+CSS 克隆 9 个站点的主题模板

## Work Log

### 步骤 1: 阅读 9 个站点的 HTML+CSS

读取 /home/z/my-project/agent-ctx/probe-html2/ 下 9 个 probe-{site}.{html,css} 文件, 提取每个站点的真实 CSS 变量、DOM 结构、字体栈、配色、圆角等关键信息。

site-notes2.md 已提供主代理提取的关键信息, 我进一步用 grep 提取每个站点的具体 CSS 规则 (body/.header/.nav/.book-card/.footer/radius 等)。

### 步骤 2: 重写 themes.ts THEMES 数组

**完全废弃旧 10 套 preset** (包括 clone-trxsw), 重建为只含 9 套精仿 preset:

| # | id | name | primary | accent | bg | radius |
|---|----|------|---------|--------|----|--------|
| 1 | clone-aijjxs | 精仿·久久小说 | #0f766e (青绿) | #b45309 (琥珀) | radial-gradient 双层 #f3efe7 | 14px |
| 2 | clone-ddyueshu | 精仿·得得小说 | #6F78A7 (蓝紫链) | #88C6E5 (天蓝头) | #E9FAFF (浅蓝底) | 2px |
| 3 | clone-pilishuwu | 精仿·霹雳书屋 | #fd8929 (霹雳橙) | #ec5245 (红橙) | #fdf6ec (米黄) | 2px |
| 4 | clone-23qb | 精仿·铅笔小说 | #ff2a14 (鲜红 hover) | #c01a0c (深红) | #f8f9f9 (浅灰) | 5px |
| 5 | clone-101kks | 精仿·101kks | #667eea (蓝紫渐变) | #764ba2 (深紫) | #f2f3f4 (浅灰) | 10px |
| 6 | clone-huangjinwu | 精仿·黄金屋 | #2563eb (蓝) | #1d4ed8 (深蓝) | linear-gradient(180deg,#f5f8ff,#eef3fb) | 6px |
| 7 | clone-ggd66 | 精仿·ggd66 | #00886d (青绿链) | #ff5500 (橙红 hover) | #f9f9f9 | 4px |
| 8 | clone-shipsay | 精仿·船说CMS | #ed4259 (船说红) | #bf2c24 (深红) | #f4f4f4 | 3px |
| 9 | clone-x2552 | 精仿·x2552 | #2f468f (蓝紫链) | #ff6600 (橙 hover) | #fafafa (兜底 transparent) | 3px |

**关键变更** (vs R11-1B 旧版):
- clone-ddyueshu: primary #6CAD53 → #6F78A7 (旧版误用顶点小说标准苹果绿, 实测 biquge.css 中 a 颜色为 #6F78A7)
- clone-pilishuwu: primary #f77720 → #fd8929 (实测 wmcms.index.css 真值), radius 6px → 2px (wmcms-web 模板 DNA)
- clone-23qb: radius 10px → 5px (实测 .module-item-cover border-radius 5px)
- clone-ggd66: primary #1a8a5a → #00886d (实测真值, 旧版误深)
- clone-shipsay: radius 0px → 3px (实测 .side_commend li 等 3px 圆角)
- clone-x2552: radius 0px → 3px (实测 .ultop li 等 3px 圆角)
- clone-trxsw: **完全删除** (用户未指定 trxsw 站点)

### 步骤 3: 删除 HomeCloneTrxsw.tsx + 更新 9 个 HomeClone*.tsx

- `rm src/components/public/layouts/HomeCloneTrxsw.tsx` (513 LoC)
- 9 个 HomeClone*.tsx 文件保留 (已使用 usePublic() + theme.vars, 自动应用新颜色)
- 更新 9 个文件的头部注释引用真实抓取的 probe-html2 文件 (probe-{site}.{html,css})
- 修正旧版错误的颜色描述 (如 ddyueshu 的 "顶点小说标准苹果绿" → "蓝紫链 #6F78A7 / 天蓝头 #88C6E5")

### 步骤 4: 修改 ThemeDef.layout 类型联合

- 移除 'clone-trxsw' 类型成员
- layout 类型联合改为只含 9 个 clone-* (clone-aijjxs/ddyueshu/pilishuwu/23qb/101kks/huangjinwu/ggd66/shipsay/x2552)

### 步骤 5: 修改 HomeView.tsx

- 删除 HomeCloneTrxsw dynamic import (line 28-29)
- 删除 theme.layout === 'clone-trxsw' 分发分支 (line 180)
- 从兜底白名单中移除 'clone-trxsw' (line 182)
- 更新文件头注释: "分发 10 种 clone-* 布局" → "分发 9 种 clone-* 布局"

### 步骤 6: 清理 BookView/KeywordView/ReadClassic 中的旧主题分支

**BookView.tsx (清理 9 处)**:
- TocSkeleton 函数: 简化为通用 ChapterListSkeleton, void themeId 占位
- renderChapterList 内 6 个旧主题分支 (pili/aurora/paper/mango/bamboo/rose) 全删
- coverW 三元简化为 'w-32 sm:w-40'
- 信息区 theme.id === 'pili' 霹雳详情头分支全删 (98 行)
- 封面 theme.id === 'rose' 双层边框包装移除
- 标签云 theme.id !== 'pili' 条件移除
- 目录头 theme.id === 'pili' 橙色 tab 头分支全删
- import statusLabel 移除 (lint 提示未使用)

**KeywordView.tsx (清理 1 处)**:
- h1 渐变文字 theme.id === 'aurora' 分支移除, 9 套 clone-* 统一用 v.text 单色

**ReadClassic.tsx (清理 1 处)**:
- decoColor 三元 theme.id === 'paper' || 'scrolls' 简化为通用 v.primary

### 步骤 7: 检查所有页面的主题适配

详见 `/home/z/my-project/agent-ctx/theme-audit-r12.md`:
- 首页: 9/9 接线 ✓
- 分类页: 通用 ThemeBookList ✓
- 书页: BookView 全元素主题化 ✓ (清理后无旧主题分支)
- 目录页: clone-* 统一默认 3 列剧集列表分支 ✓
- 章节页: readOf(theme) 9 字段全部生效 ✓
- 关键词页: aurora 渐变分支已清理 ✓
- 搜索页/历史页: 全部消费 theme.vars ✓

### 附加: 后台管理 fallback 更新

发现 admin 区域 3 处 'aurora' fallback 需同步更新:
- src/components/admin/SitesSection.tsx:83 (emptyForm.themeId) → 'clone-aijjxs'
- src/app/api/admin/sites/route.ts:32 (validTheme 兜底) → 'clone-aijjxs'
- src/app/api/admin/backup/restore/route.ts:187,203 (themeId 兜底) → 'clone-aijjxs' (replace_all)

## Stage Summary

- 删除文件: HomeCloneTrxsw.tsx (513 LoC) + themes.ts 中 clone-trxsw preset + 9 处 BookView 旧主题分支 + 1 处 KeywordView aurora 分支 + 1 处 ReadClassic paper/scrolls 分支
- 新建文件: /home/z/my-project/agent-ctx/theme-audit-r12.md (审计报告)
- 重写 themes.ts: 9 套精仿 preset, 全部基于 probe-html2/probe-*.{html,css} 真实抓取的 CSS 变量
- 更新 HomeClone*.tsx 头部注释: 9 个文件全部引用真实抓取的 probe-html2 文件
- 更新 admin fallbacks: 3 处 'aurora' → 'clone-aijjxs'

## 验证

- `bunx tsc --noEmit` (排除 examples/skills): **0 errors** ✓
- `bun run lint`: **0 errors / 0 warnings** ✓
- `bunx tsx /tmp/test-themes-r12.ts`: THEMES.length = **9**, default = clone-aijjxs, 9 个 ID 全部 OK ✓
- `ls HomeCloneTrxsw.tsx`: "No such file or directory" ✓
- 9 个 HomeClone*.tsx 文件全部存在 ✓

## 9 个新文件路径

- /home/z/my-project/src/components/public/layouts/HomeCloneAijjxs.tsx (304 LoC)
- /home/z/my-project/src/components/public/layouts/HomeCloneDdyueshu.tsx (503 LoC)
- /home/z/my-project/src/components/public/layouts/HomeClonePilishuwu.tsx (278 LoC)
- /home/z/my-project/src/components/public/layouts/HomeClone23qb.tsx (310 LoC)
- /home/z/my-project/src/components/public/layouts/HomeClone101kks.tsx (300 LoC)
- /home/z/my-project/src/components/public/layouts/HomeCloneHuangjinwu.tsx (357 LoC)
- /home/z/my-project/src/components/public/layouts/HomeCloneGgd66.tsx (314 LoC)
- /home/z/my-project/src/components/public/layouts/HomeCloneShipsay.tsx (689 LoC)
- /home/z/my-project/src/components/public/layouts/HomeCloneX2552.tsx (370 LoC)

## 删除的文件列表

- /home/z/my-project/src/components/public/layouts/HomeCloneTrxsw.tsx (彻底删除)
- themes.ts: clone-trxsw preset (第 10 套, 60 行)
- themes.ts: layout 类型联合 'clone-trxsw' 成员
- HomeView.tsx: HomeCloneTrxsw dynamic import + 分发分支 + 白名单条目
- BookView.tsx: 9 处旧主题分支 (pili/aurora/paper/mango/bamboo/rose/magazine/theater)
- BookView.tsx: statusLabel 未使用 import
- KeywordView.tsx: 1 处 aurora 渐变文字分支
- ReadClassic.tsx: 1 处 paper/scrolls decoColor 三元
- SitesSection.tsx + sites/route.ts + backup/restore/route.ts: 3 处 'aurora' fallback → 'clone-aijjxs'

## 主题审计报告路径

- /home/z/my-project/agent-ctx/theme-audit-r12.md (10 章节, 含 preset 数量/变更/删除/清理/验证)
