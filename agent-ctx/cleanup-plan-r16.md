# R16-1C 代码清理计划

> Task ID: **R16-1C**
> 清理范围: 旧 layouts/HomeClone*.tsx + BookInfoLayout.tsx + Pagination.tsx + 未使用 import
> 清理日期: 2026-09-16
> 清理者: 主控(本会话续作)

## 1. 已执行清理

### 1.1 删除 10 个旧 layouts/HomeClone*.tsx 文件 (-N LoC)

经 `rg -n "layouts/HomeClone" src/` 验证全域 0 引用, 安全删除:

| 文件 | 状态 |
|------|------|
| `src/components/public/layouts/HomeCloneAijjxs.tsx` | 已删除 |
| `src/components/public/layouts/HomeCloneDdyueshu.tsx` | 已删除 |
| `src/components/public/layouts/HomeClonePilishuwu.tsx` | 已删除 |
| `src/components/public/layouts/HomeClone23qb.tsx` | 已删除 |
| `src/components/public/layouts/HomeClone101kks.tsx` | 已删除 |
| `src/components/public/layouts/HomeCloneHuangjinwu.tsx` | 已删除 |
| `src/components/public/layouts/HomeCloneGgd66.tsx` | 已删除 |
| `src/components/public/layouts/HomeCloneShipsay.tsx` | 已删除 |
| `src/components/public/layouts/HomeCloneX2552.tsx` | 已删除 |
| `src/components/public/layouts/HomeCloneTrxsw.tsx` | 已删除 |
| `src/components/public/layouts/` (空目录) | 已 rmdir |

**说明**: 这 10 个文件是 R10-1A/R11-1B/R12-1/R13-1B 时期的早期克隆实现, 已在 R14-1A 全量重克隆 + R16-1A/B clone-themes 1:1 克隆迁移后退役。HomeView.tsx 已 dynamic import 从 `./clone-themes/{theme}` 加载, 不再引用 layouts/。

### 1.2 未使用 import 清理

- `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` 验证: 0 errors
- `bun run lint` 验证: 0 errors / 0 warnings
- 删除 layouts/HomeClone*.tsx 后无遗留未使用 import(tsc 自动校验通过)

## 2. 未执行清理 (说明原因)

### 2.1 BookInfoLayout.tsx — 保留 (任务描述错误判定为"已被替代")

**任务描述**: "删除 `src/components/public/BookInfoLayout.tsx` (已被 clone-themes BookInfo 替代)"

**实际情况**: BookInfoLayout.tsx 仍被 `BookView.tsx` 主动使用:
- `src/components/public/BookView.tsx:20` — `import { BookInfoLayout } from './BookInfoLayout'`
- `src/components/public/BookView.tsx:645` — `<BookInfoLayout book={book} theme={theme} savedPos={savedPos} firstChapterId={chapters[0]?.id} onScrollToc={...} onGoCategory={...} />`

**功能差异**: clone-themes BookInfo 与 BookInfoLayout 功能不对等:

| 功能 | BookInfoLayout (R14-1A) | clone-themes BookInfo (R16-1A/B) |
|------|------------------------|----------------------------------|
| ActionButtons 立即阅读 | ✓ (savedPos 智能切换"继续阅读 N章") | ✓ (firstChapterId guard) |
| ActionButtons 加入书架 | ✓ (history addBook) | ✗ |
| ActionButtons TXT 下载 | ✓ (history addBook) | ✓ (静态 a href) |
| savedPos 阅读进度 | ✓ | ✗ |
| onGoCategory 分类导航 | ✓ (传 categoryId) | ✓ (部分组件已修复 cat: b.categoryId) |
| theme.vars 主题色 | ✓ (BookInfoMeta wrapperClassName 等) | ✗ (硬编码颜色) |
| CoverWithHalo 封面光晕 | ✓ | ✗ |
| usePanelStyle 面板风格 | ✓ | ✗ |
| 10 套 DOM 变体 | ✓ (BookInfoAijjxs/Ddyueshu/...) | ✓ (10 个独立文件) |

**结论**: clone-themes BookInfo 是简化版(只保留视觉 1:1 克隆 + 基础按钮), 不具备 BookInfoLayout 的 savedPos/onGoCategory/history/主题色适配等增强功能。直接替换会丢失这些能力, 属于功能回退, 不在"清理"范围。

**建议**: 后续可考虑 R17+ 任务:
1. 在 clone-themes BookInfo 接口扩展 `savedPos?` / `theme?` / `onGoCategory?` 参数
2. 各 clone-themes BookInfo 实现增强 ActionButtons + savedPos 显示
3. BookView.tsx 切换为按 theme.layout dynamic import clone-themes BookInfo
4. 删除 BookInfoLayout.tsx

### 2.2 Pagination.tsx — 保留 (任务描述带"如已无引用"条件)

**任务描述**: "删除 `src/components/public/Pagination.tsx` (如已无引用)"

**实际情况**: Pagination.tsx 仍被 `CategoryView.tsx` 主动使用:
- `src/components/public/CategoryView.tsx:13` — `import { Pagination } from './Pagination'`
- `src/components/public/CategoryView.tsx:110` — `<Pagination page={data.page} total={data.total} size={data.size} onPage={...} center />`

**功能差异**: clone-themes CategoryList 自带分页 UI, 但 CategoryView 当前用 `ThemeBookList` + `<Pagination>` 组合, 未切换到 clone-themes CategoryList。

**结论**: Pagination 仍有 1 个活跃引用, 不满足"如已无引用"条件, 保留。

**建议**: 后续可考虑 R17+ 任务:
1. CategoryView.tsx 按 theme.layout dynamic import clone-themes CategoryList
2. 把 `ThemeBookList` + `<Pagination>` 替换为 clone-themes CategoryList (内部分页 UI)
3. 全域确认无其他 Pagination 引用后, 删除 Pagination.tsx

### 2.3 R13~R15 历史代码不回滚 (尊重约束)

按 R16-1C 任务约束 "R13~R15 的修改不回滚", 以下保留不动:
- R13-1A: KeywordView.tsx PSEO 落地页 + `/api/public/keyword?book=` 路由
- R13-1B: 10 套 clone-themes preset 恢复(含 trxsw)
- R13-1C: TocChapterButton unmount clearTimeout 修复
- R13-1D: dead export 删除 (normalizeChapterNumber/verifyFingerprintConsistency 等)
- R14-1A: BookInfoLayout.tsx + 10 套 BookInfo 变体 + contentSelector 字段
- R14-1B: fetcher.ts inflightMap/tokenInflight TOCTOU race fix + runner.ts control() timer fix
- R14-1C: BookCard.tsx 删 BookLine/BookPoster + fetcher.ts 删 hostDispatcherSnapshot + BookInfoLayout.tsx 提取 BookInfoMeta

## 3. 验证

### 3.1 删除前后对比
- 删除前文件数: layouts/ 10 个 HomeClone*.tsx + 1 个空目录
- 删除后: 0 个文件, 目录已 rmdir
- 全域 import 引用: `rg "layouts/HomeClone" src/` → 0 matches ✓

### 3.2 类型检查
- `bunx tsc --noEmit` (排除 examples/skills): **0 errors** ✓
- `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`: **0 errors** ✓

### 3.3 lint 检查
- `bun run lint`: **exit 0** (0 errors / 0 warnings) ✓

### 3.4 dev server 回归
- 10 套主题 dev server 全部 200 OK (clone-aijjxs/ddyueshu/pilishuwu/23qb/101kks/huangjinwu/ggd66/shipsay/x2552/trxsw)
- dev.log 无 error/warn

## 4. 清理总结

- **实际删除**: 10 个 layouts/HomeClone*.tsx 文件 + 1 个空目录
- **未删除**: BookInfoLayout.tsx (BookView 仍用, clone-themes BookInfo 功能不完整) + Pagination.tsx (CategoryView 仍用)
- **未使用 import**: 0 (tsc + lint 双重验证)
- **净改动**: -10 个 dead code 文件, 0 个新增, 0 个修改

## 5. 后续清理建议 (R17+ 候选)

| 候选 | 优先级 | 风险 | 说明 |
|------|--------|------|------|
| 扩展 clone-themes BookInfoProps 加 savedPos/theme/onGoCategory | 高 | 中 | 需重构 10 套 BookInfo 实现, 但能解锁 BookInfoLayout 删除 |
| BookView.tsx 切换为 clone-themes BookInfo dynamic import | 高 | 中 | 切换 + 删 BookInfoLayout 共需修改 12 个文件 |
| CategoryView.tsx 切换为 clone-themes CategoryList dynamic import | 中 | 低 | clone-themes CategoryList 已实现分页 UI |
| 删除 BookInfoLayout.tsx | 中 | 低 | 待 BookView 切换完成后执行 |
| 删除 Pagination.tsx | 低 | 低 | 待 CategoryView 切换完成后执行 |
| scripts/ 归档 6 个废弃脚本(R14-1C 列出) | 低 | 极低 | mock-novel-site + fix-aijjxs-bookurl + fix-aijjxs-toplist-toc + probe-all + fix-dd-b-stale-task + test-themes-9 |
