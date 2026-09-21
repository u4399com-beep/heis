# 10 套克隆主题模板适配审计 (R11-1B)

> 审计时间: 2026-09-15
> 审计范围: 10 套精仿主题 (clone-aijjxs / clone-ddyueshu / clone-pilishuwu / clone-23qb / clone-101kks / clone-huangjinwu / clone-ggd66 / clone-shipsay / clone-x2552 / clone-trxsw)
> 审计人: full-stack-developer (R11-1B)
> 审计文件: `src/components/public/HomeView.tsx` + `src/components/public/CategoryView.tsx` + `src/components/public/BookView.tsx` + `src/components/public/ReadView.tsx` + `src/components/public/layouts/HomeClone*.tsx` + `src/components/public/BookCard.tsx` + `src/components/public/read-layouts/*.tsx`

---

## 1. 首页适配（HomeView → HomeClone*.tsx）

`HomeView.tsx` (line 17-28) 通过 `dynamic()` 懒加载 10 个布局组件，并在 (line 169-179) 通过 `theme.layout === 'clone-xxx'` 分发。兜底白名单已扩为 10 个 layout key (line 181)。

| # | 主题 ID | 布局组件 | 接线状态 | 文件行数 | theme.vars 引用数 |
|---|---------|----------|----------|----------|-------------------|
| 1 | clone-aijjxs | HomeCloneAijjxs.tsx | ✓ 已接线 | 303 | 10+ |
| 2 | clone-ddyueshu | HomeCloneDdyueshu.tsx | ✓ 已接线 | 502 | 16+ |
| 3 | clone-pilishuwu | HomeClonePilishuwu.tsx | ✓ 已接线 | - | 10+ |
| 4 | clone-23qb | HomeClone23qb.tsx | ✓ 已接线 | 309 | 36 |
| 5 | clone-101kks | HomeClone101kks.tsx | ✓ 已接线 | - | 39 |
| 6 | clone-huangjinwu | HomeCloneHuangjinwu.tsx | ✓ 已接线 | - | 54 |
| 7 | clone-ggd66 | HomeCloneGgd66.tsx | ✓ 已接线 | - | 44 |
| 8 | clone-shipsay | HomeCloneShipsay.tsx | ✓ 已接线 | 688 | 18+ |
| 9 | clone-x2552 | HomeCloneX2552.tsx | ✓ 已接线 | 369 | 10+ |
| 10 | **clone-trxsw** | **HomeCloneTrxsw.tsx** | ✓ **R11-1B 新增** | 513 | 56 |

**结论**: 10 套全部接线，无缺失。新增的 clone-trxsw 已正确接入 `HomeView.tsx` 第 27 行 (dynamic import) + 第 179 行 (分发分支) + 第 181 行 (兜底白名单)。

---

## 2. 分类页适配（CategoryView → ThemeBookList）

**关键发现**: `CategoryView.tsx` (line 14, 108) 调用 `ThemeBookList` 通用组件渲染分类书籍列表。

```tsx
// CategoryView.tsx line 14
import { ThemeBookList } from './BookCard'
// line 108
<ThemeBookList books={data?.books || []} loading={loading} />
```

`ThemeBookList` (BookCard.tsx line 125-138) 内部统一使用 `BookCard` 通用卡片组件，`BookCard` 内部 (line 14-50) 完整消费 `theme.vars`（surface / border / radius / cardShadow / text / textMuted / primary / accent）。

**结论**: 所有 10 套主题共用 `ThemeBookList`，无需按主题适配。`ThemeBookList` 正确消费 `theme.vars`，分类页适配齐全 ✓。

---

## 3. 书页适配（BookView）

`BookView.tsx` 主要使用 `theme.vars` 渲染所有元素。检查结果：

| 元素 | 渲染方式 | 主题化状态 |
|------|----------|------------|
| 书籍信息面板 (`panelStyle`) | `v.surface` + `v.border` + `v.radius` + `v.cardShadow` | ✓ |
| 书名 H1 | `v.text` + `v.titleFont` | ✓ |
| 作者/分类/状态 | `v.textMuted` + `v.primary` + `v.accent` | ✓ |
| 简介 | `v.text` | ✓ |
| 关键词标签 | `v.accent` + `v.primary` | ✓ |
| 最新章节提示 | `v.primary` | ✓ |
| 开始阅读/TXT下载按钮 | `v.primary` + `v.primaryText` + `v.accent` + `v.surfaceAlt` | ✓ |
| 上次阅读徽章 | `v.primary` + `withAlpha(v.primary, ...)` | ✓ |
| 章节目录标题 | `v.primary` + `v.text` | ✓ |
| 章节目录列表（默认） | `v.primary` + `v.text` + `v.textMuted` + `withAlpha(v.border, ...)` | ✓ |
| 阅读统计条 | `withAlpha(v.primary, ...)` + `v.text` + `v.textMuted` | ✓ |
| 相关推荐卡 | `v.surface` + `v.border` + `v.radius` + `v.text` + `v.textMuted` + `v.primary` | ✓ |
| 章节目录翻页按钮 | `v.surfaceAlt` + `v.border` + `v.text` + `v.radius` | ✓ |
| 分隔线 | `withAlpha(v.border, 0.45)` | ✓ |

### 主题差异化处理

BookView 通过 `theme.id ===` 分支对 **legacy 主题** (pili / aurora / paper / mango / bamboo / rose / magazine / theater) 做差异化目录和信息区渲染。对于 **clone-*** 主题统一走默认渲染分支 (line 790-894) + 默认目录列表 (line 601-625)。

**结论**: BookView 无硬编码颜色，所有元素均消费 `theme.vars`。clone-* 主题统一走通用渲染分支，符合设计意图 ✓。

### 已知限制（非 bug）

1. `theme.id === 'pili'` / `'aurora'` / `'mango'` / `'paper'` / `'bamboo'` / `'rose'` / `'magazine'` / `'theater'` 分支保留给 legacy 主题。这些主题 id 不在 10 套 clone-* 列表内，对当前审计无影响。
2. `coverW` (line 672) 仅对 `magazine` / `theater` 调整封面尺寸，clone-* 主题统一 `w-32 sm:w-40`。

---

## 4. 目录页适配（BookView 内 toc）

BookView 内 `renderToc()` (line 460) 通过 `theme.id ===` 分支按主题差异化渲染目录列表：

- `theme.id === 'pili'`: 三列章节网格 (橙色 hover)
- `theme.id === 'aurora'`: 玻璃格子 3 列 (accent 编号)
- `theme.id === 'paper'`: 3 列衬线虚线引导
- `theme.id === 'mango'`: 大圆角胶囊格子 3 列
- `theme.id === 'bamboo'`: 三栏细线极简
- `theme.id === 'rose'`: 剧目单 3 列 (金色编号)
- **默认** (含所有 clone-*): 3 列剧集列表 (`EP01` 编号 + 字数)

`clone-trxsw` 与其他 9 套 clone-* 一致走默认目录分支，正确消费 `theme.vars`。

### 分卷分组（kk-a）

`renderToc()` (line 628-661) 还支持分卷分组渲染：仅当目录数据出现卷名 (`chapter.volume` 非空) 才启用，否则走扁平列表。所有 10 套 clone-* 主题统一使用此行为。

**结论**: 目录页对 clone-* 主题统一走默认 3 列剧集列表分支，全部消费 `theme.vars`，无硬编码颜色 ✓。

---

## 5. 章节页适配（ReadView）

`ReadView.tsx` (line 477) 调用 `readOf(theme)` 获取主题 read 配置，并 (line 478-515) 透传给各 read-layout 子组件。

### read 配置分发

```ts
// ReadView.tsx line 477
const layout = readOf(theme).layout
// line 597 / 608 / 619 / 630: 分发到 ReadImmersive / ReadPaginated / ReadPili / ReadClassic
```

### 10 套 clone-* 主题的 read 配置

| # | 主题 ID | read.layout | measure | lineHeight | fontBase | indent | justify | toolbar | texture | chapterDeco |
|---|---------|-------------|---------|------------|----------|--------|---------|---------|---------|-------------|
| 1 | clone-aijjxs | classic | 760 | 1.85 | 17 | true | true | inline | none | rule |
| 2 | clone-ddyueshu | classic | 720 | 1.8 | 16 | true | false | inline | none | rule |
| 3 | clone-pilishuwu | pili | 720 | 1.8 | 16 | true | false | inline | none | rule |
| 4 | clone-23qb | classic | 720 | 1.85 | 16 | true | false | inline | none | rule |
| 5 | clone-101kks | classic | 720 | 1.85 | 16 | true | false | inline | none | rule |
| 6 | clone-huangjinwu | classic | 760 | 1.85 | 17 | true | true | inline | none | rule |
| 7 | clone-ggd66 | classic | 720 | 1.8 | 16 | true | false | inline | none | rule |
| 8 | clone-shipsay | classic | 720 | 1.8 | 14 | true | false | inline | none | rule |
| 9 | clone-x2552 | classic | 720 | 1.7 | 16 | true | false | inline | none | rule |
| 10 | **clone-trxsw** | classic | 720 | 1.9 | 16 | true | false | inline | none | rule |

### 各 read 字段在 ReadClassic 中的消费

| 字段 | 消费位置 | 验证 |
|------|----------|------|
| `layout` | ReadView.tsx:477 → 分发到 ReadClassic | ✓ |
| `measure` | ReadClassic.tsx:270 `maxWidth: read.measure` | ✓ |
| `lineHeight` | ReadClassic.tsx 通过 props 透传到 ChapterContent | ✓ |
| `fontBase` | shared.tsx:854 `actualFontPx(userPx, read) = userPx + (read.fontBase - 17)` | ✓ |
| `indent` | ReadClassic.tsx:275 `[&_p]:my-3 [&_p]:indent-8` | ✓ |
| `justify` | ReadClassic.tsx:277 `textAlign: 'justify'` | ✓ |
| `toolbar` | ReadClassic.tsx 内 inline 工具条（默认形态） | ✓ |
| `texture` | ReadClassic.tsx:220 `textureStyle(read.texture, ...)` | ✓ |
| `chapterDeco` | ReadClassic.tsx:255 / 285 `ChapterDeco kind={read.chapterDeco}` | ✓ |

**结论**: read 配置全部生效。新增 clone-trxsw 配置 `classic / 720 / 1.9 / 16 / indent / no-justify / inline / none / rule` 正确，行高 1.9 略宽于其他主题（唐人小说系舒适阅读体验） ✓。

---

## 6. 修复发现的问题

### 6.1 新增 clone-trxsw 主题 preset（R11-1B 任务 A）

**问题**: 原 THEMES 数组仅有 9 套 preset，缺少 clone-trxsw（天人小说）。
**修复**:
- `themes.ts` line 13: header 注释新增 clone-trxsw 描述
- `themes.ts` line 101: `layout` 类型联合新增 `'clone-trxsw'`
- `themes.ts` line 633-693: 新增第 10 个 preset (clone-trxsw)

### 6.2 新增 HomeCloneTrxsw.tsx 组件（R11-1B 任务 A）

**问题**: 缺少 clone-trxsw 的首页布局组件。
**修复**: 创建 `src/components/public/layouts/HomeCloneTrxsw.tsx` (513 行)，基于 AiraBrowser 反查的 .vlist / .detail / .content / .pager DOM 模板：
- 顶 header (.container.head DNA: logo + 搜索框 + 用户菜单)
- nav (浅蓝灰底 + 8 分类)
- 主区双栏: 左主栏 (70%) .vlist 最新更新 5 列 + 右侧栏 (30%) 热门推荐 + 完本推荐
- 分类列表网格 (6 列)
- 友情链接 + footer

### 6.3 HomeView.tsx 接线 clone-trxsw（R11-1B 任务 A）

**问题**: HomeView 缺少 clone-trxsw 的 dynamic import + 分发分支 + 白名单 key。
**修复**:
- `HomeView.tsx` line 27-28: 新增 `const HomeCloneTrxsw = dynamic(...)`
- `HomeView.tsx` line 179: 新增 `{theme.layout === 'clone-trxsw' && <HomeCloneTrxsw books={books} loading={loading} />}`
- `HomeView.tsx` line 181: 兜底白名单新增 `'clone-trxsw'`

### 6.4 lint 修复

**问题**: HomeCloneTrxsw.tsx 首次提交时引入未使用 import `formatWords`。
**修复**: 删除 `formatWords` 导入（lint 通过 ✓）。

### 6.5 React hooks 调用顺序修复

**问题**: HomeCloneTrxsw.tsx 初版在 `bookNavProps(usePublic().navigate, ...)` 内重复调用 hook，且 catList 渲染分支 `onClick` 回调内调用 `usePublic().navigate` (违反 rules of hooks)。
**修复**:
- `TrVListRow` / `TrPopularRow` / `TrCompletedCard`: 顶部统一 `const { navigate, theme } = usePublic()` 解构
- `HomeCloneTrxsw`: 顶部 `const { site, theme, navigate } = usePublic()`，catList `onClick` 闭包引用外层 `navigate`

---

## 7. 未修复的"良性"硬编码（保留原状）

以下硬编码颜色经过审计后判定为**良性**，保留原状不修改：

### 7.1 Tailwind 任意值 hover 类（10 套 clone-* 全部使用）

例如 `HomeCloneShipsay.tsx` 内 `hover:text-[#ed4259]`、`HomeCloneTrxsw.tsx` 内 `hover:text-[#2c7be5]`：
- **原因**: Tailwind 无法基于运行时 `v.primary` 生成动态 hover 类。必须在 className 中硬编码十六进制值，但该值在每套主题内**始终等于 `v.primary`**（主题切换时 layout 也切，对应组件内的硬编码值同步切）。
- **影响范围**: 仅 hover 视觉态。文本基色仍走 `style={{ color: v.text }}` 主题化。
- **结论**: 保留原状（10 套主题均如此），不影响主题切换正确性。

### 7.2 船说CMS 视觉 DNA 色（仅 clone-shipsay）

`HomeCloneShipsay.tsx` 内 `#3e3d43` (深灰 nav 底) / `#fbfbfb` (nav 文字) / `#252428` (active nav bg) / `#bf2c24` `.red` / `#4284ed` `.blue` / `#f0643a` `.orange`：
- **原因**: 这些是船说CMS 站点的视觉 DNA 色（站点 8 色徽章体系），theme.vars 没有"深灰底"/"红橙蓝绿黄紫"槽位。代码注释 (line 192) 已说明 `#3e3d43` 不映射到 vars 的原因。
- **影响范围**: 仅 clone-shipsay 主题内部。
- **结论**: 保留原状（站点特有视觉 DNA，无法用 vars 表达）。

### 7.3 通用白文字色 `#fff`

各 HomeClone*.tsx 内 `color: '#fff'` 出现在"深底白字"上下文中：
- **原因**: `#fff` 在所有主题中均等于 `v.primaryText`（深色 primary 上的白文字）。Tailwind 类 `text-white` 也是同一行为。
- **结论**: 保留原状（语义等同 `v.primaryText`）。

---

## 8. 验证结果

### 8.1 TypeScript 类型检查

```bash
$ cd /home/z/my-project && bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | tail -10
# (空输出 → 0 errors)
```

✓ tsc 通过，0 errors。

### 8.2 ESLint 检查

```bash
$ cd /home/z/my-project && bun run lint 2>&1 | tail -5
$ eslint .
# (空输出 → 0 errors / 0 warnings)
```

✓ lint 通过，0 errors / 0 warnings。

### 8.3 THEMES 数组验证

```bash
$ bunx tsx /tmp/test-themes-10.ts
THEMES.length = 10
  clone-aijjxs | 精仿·久久小说 | #0f766e
  clone-ddyueshu | 精仿·得得小说 | #6CAD53
  clone-pilishuwu | 精仿·霹雳书屋 | #f77720
  clone-23qb | 精仿·铅笔小说 | #ff2a14
  clone-101kks | 精仿·101kks | #667eea
  clone-huangjinwu | 精仿·黄金屋 | #2563eb
  clone-ggd66 | 精仿·ggd66 | #1a8a5a
  clone-shipsay | 精仿·船说CMS | #ed4259
  clone-x2552 | 精仿·x2552 | #2f468f
  clone-trxsw | 精仿·天人小说 | #2c7be5
trxsw: #2c7be5
```

✓ THEMES.length = 10
✓ clone-trxsw primary 色 = #2c7be5

---

## 9. 总结

- **首页适配**: 10 套全部接线 ✓
- **分类页适配**: 通用 ThemeBookList，正确消费 theme.vars ✓
- **书页适配**: BookView 无硬编码颜色，所有元素主题化 ✓
- **目录页适配**: clone-* 统一走默认 3 列剧集列表，正确消费 theme.vars ✓
- **章节页适配**: read 配置全部生效，新增 clone-trxsw 配置正确 ✓
- **tsc/lint**: 全部通过 ✓

新增 clone-trxsw 主题已完整接入站群前台 5 个页面（首页/分类页/书页/目录页/章节页），与现有 9 套 clone-* 主题保持一致的适配质量。
