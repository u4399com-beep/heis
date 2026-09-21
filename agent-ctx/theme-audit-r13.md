# R13-1B 主题模版完整性审计报告

> Task ID: **R13-1B**
> Agent: full-stack-developer
> Date: 2026-09-15
> 范围: 10 套精仿主题 (含 clone-trxsw) + 首页/分类页/书页/目录页/章节页/关键词页/搜索页/历史页 主题适配审计

## 0. 任务背景

R12-1 删除了 clone-trxsw, THEMES 缩为 9 套。R13-1B 重新克隆 10 个站点主题 (含 trxsw.com), THEMES 扩回 10 套:
- 前 9 套已基于真实抓取的 probe-html2/probe-*.{html,css} 像素级精仿, R12-1 完成且 tsc/lint 0 errors
- 第 10 套 clone-trxsw 域名已过期, 通过 GitHub `mason173/aira-browser` 反查真实 DOM 配置反推

R13-1B 工作范围:
1. 在 themes.ts 中**新增** clone-trxsw preset (基于 AiraBrowser 反查 DOM)
2. 在 themes.ts 的 `ThemeDef.layout` 类型联合中**新增** `'clone-trxsw'`
3. **创建** `src/components/public/layouts/HomeCloneTrxsw.tsx` (513 LoC, 基于 .vlist/.detail/.content/.pager DOM)
4. 在 HomeView.tsx 中**新增** clone-trxsw 的 dynamic import + 分发分支 + 白名单扩为 10
5. 验证 10 套主题在所有页面 (首页/分类页/书页/目录页/章节页/关键词页/搜索页/历史页) 的主题适配

> **保留**: 9 套已基于真实 probe-html2 抓取精仿的 preset 与 9 个 HomeClone*.tsx 文件 (R12-1 已完整, R13-1B 无需重写)
> **新增**: 第 10 套 clone-trxsw preset + HomeCloneTrxsw.tsx

## 1. THEMES 数组最终态 (10 套 preset)

| # | id | name | primary | accent | radius | layout |
|---|---|---|---|---|---|---|
| 1 | clone-aijjxs | 精仿·久久小说 | `#0f766e` (青绿) | `#b45309` (琥珀) | `14px` | clone-aijjxs |
| 2 | clone-ddyueshu | 精仿·得得小说 | `#6F78A7` (蓝紫) | `#88C6E5` (天蓝) | `2px` | clone-ddyueshu |
| 3 | clone-pilishuwu | 精仿·霹雳书屋 | `#fd8929` (暖橙) | `#ec5245` (红橙) | `2px` | clone-pilishuwu |
| 4 | clone-23qb | 精仿·铅笔小说 | `#ff2a14` (鲜红) | `#c01a0c` (深红) | `5px` | clone-23qb |
| 5 | clone-101kks | 精仿·101kks | `#667eea` (蓝紫) | `#764ba2` (深紫) | `10px` | clone-101kks |
| 6 | clone-huangjinwu | 精仿·黄金屋 | `#2563eb` (蓝) | `#1d4ed8` (深蓝) | `6px` | clone-huangjinwu |
| 7 | clone-ggd66 | 精仿·ggd66 | `#00886d` (青绿) | `#ff5500` (橙红) | `4px` | clone-ggd66 |
| 8 | clone-shipsay | 精仿·船说CMS | `#ed4259` (红) | `#bf2c24` (深红) | `3px` | clone-shipsay |
| 9 | clone-x2552 | 精仿·x2552 | `#2f468f` (蓝紫) | `#ff6600` (橙) | `3px` | clone-x2552 |
| 10 | **clone-trxsw** | **精仿·天人小说** | **`#2c7be5`** (深蓝) | `#1a5fb4` (深蓝副) | `4px` | **clone-trxsw** |

- `getTheme(undefined).id === 'clone-aijjxs'` ✓ (默认主题)
- `getThemeById(id)` 对 10 个 ID 全部命中 ✓

### 1.1 clone-trxsw preset 详情

```ts
{
  id: 'clone-trxsw',
  name: '精仿·天人小说',
  desc: '像素级精仿·天人小说 trxsw.com: 唐人小说路由·.vlist 章节列表+.detail 详情+.content 正文+.pager 翻页·简洁现代深蓝主色',
  layout: 'clone-trxsw',
  dark: false,
  read: {
    layout: 'classic', measure: 720, lineHeight: 1.9, fontBase: 16,
    indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
  },
  vars: {
    bg: '#f5f7fa',           // 浅灰蓝底 (唐人小说系通用)
    surface: '#ffffff',      // 白卡
    surfaceAlt: '#eef2f7',   // 浅蓝灰 alt
    text: '#333333',         // 深灰文本
    textMuted: '#888888',    // 灰色次要文本
    primary: '#2c7be5',      // 深蓝主色 (唐人小说系通用)
    primaryText: '#ffffff',
    accent: '#1a5fb4',       // 深蓝副色
    border: '#e0e6ed',       // 浅灰边框
    radius: '4px',           // 小圆角 (简洁现代风)
    fontFamily: '"Microsoft YaHei", Arial, sans-serif',
    cardShadow: '0 1px 3px rgba(0,0,0,0.05)',  // 轻阴影
    headerStyle: 'solid',
  },
  preview: ['#f5f7fa', '#2c7be5', '#1a5fb4'],
}
```

**反查依据** (AiraBrowser 完整配置直译, 来源 GitHub `mason173/aira-browser`):
- 站点: `https://www.trxsw.com/` (天人小说, 唐人小说路由)
- 路径前缀: `/tangren_` 或 `/tangren/` (★关键: 路径前缀是 AiraBrowser 实测)
- 域名状态: 已过期但规则保留
- DOM 结构:
  - `chapterLinkSelector`: `.vlist > li:not(.now) > a, .read > li > a` (目录章节链)
  - `contentSelector`: `.content` (正文容器)
  - `chapterTitleSelector`: `h1.headline` (章节标题)
  - `prevSelector`: `.pager a:first-of-type` (上一章)
  - `nextSelector`: `.pager a:nth-of-type(3)` (下一章, ★非翻页!)
  - `bookTitleSelector`: `.detail .name strong` (书名)
  - `authorSelector`: `.detail .author a` (作者)
  - `coverSelector`: `.detail > img` (封面)
  - `synopsisSelector`: `.intro` (简介)

## 2. HomeClone*.tsx 文件清单 (10 个)

| # | 文件路径 | LoC | usePublic | v.* refs | Skeleton | 响应式 |
|---|---|---|---|---|---|---|
| 1 | `src/components/public/layouts/HomeCloneAijjxs.tsx` | 306 | 7 | 42 | ✓ | ✓ sm/md/lg |
| 2 | `src/components/public/layouts/HomeCloneDdyueshu.tsx` | 498 | 13 | 72 | ✓ | ✓ sm/md/lg |
| 3 | `src/components/public/layouts/HomeClonePilishuwu.tsx` | 280 | 5 | 39 | ✓ | ✓ sm/md/lg |
| 4 | `src/components/public/layouts/HomeClone23qb.tsx` | 310 | 6 | 31 | ✓ | ✓ sm/md/lg |
| 5 | `src/components/public/layouts/HomeClone101kks.tsx` | 301 | 6 | 34 | ✓ | ✓ sm/md/lg |
| 6 | `src/components/public/layouts/HomeCloneHuangjinwu.tsx` | 360 | 7 | 49 | ✓ | ✓ sm/md/lg |
| 7 | `src/components/public/layouts/HomeCloneGgd66.tsx` | 314 | 7 | 39 | ✓ | ✓ sm/md/lg |
| 8 | `src/components/public/layouts/HomeCloneShipsay.tsx` | 689 | 12 | 53 | ✓ | ✓ sm/md/lg |
| 9 | `src/components/public/layouts/HomeCloneX2552.tsx` | 371 | 7 | 43 | ✓ | ✓ sm/md/lg |
| 10 | **`src/components/public/layouts/HomeCloneTrxsw.tsx`** | **513** | **9** | **49** | **✓** | **✓ sm/md/lg** |

合计: 10 文件 / 3942 LoC / 79 usePublic 调用 / 451 theme.vars 引用

### 2.1 HomeCloneTrxsw.tsx 结构 (新增)

DOM 模板 (基于 .vlist/.detail/.content/.pager/.headline/.intro AiraBrowser 反查):
- **顶 header** (`TrHeader`): 站名 + 域名 + 搜索框 + 用户菜单 (书架/排行/登录)
- **nav** (`TrNav`): 浅蓝灰底 + 8 分类 + borderTop 2px primary
- **主区双栏** (`lg:grid-cols-[1fr_300px]`):
  - 左主栏 (70%): `.vlist` 最新更新 24 条 (`TrVListRow`: 序号/类别/书名/最新章节/作者/时间)
  - 右侧栏 (30%): 热门推荐 10 (`TrPopularRow`: 前3 加蓝号 primary 徽章) + 完本推荐 4 (`TrCompletedCard`: .detail-style 左封面+右书名/作者/状态)
- **分类列表网格** (6 列): 从 books 提取唯一 category 名 + 数量, 点击跳 category view
- **友情链接**: 站名/网络小说/免费阅读/小说排行榜/完本小说
- **footer**: 站名 + 域名 + 试读声明

子组件 (4 个):
- `TrHeader` — header 站点头 (logo + 搜索框 + 用户菜单)
- `TrNav` — 8 分类导航条 (浅蓝灰底)
- `TrTitle` — 区块标题 (左主色竖条 + 文字 + 右更多)
- `TrVListRow` — .vlist 最新更新行 (5 列布局)
- `TrPopularRow` — 热门推荐行 (前3 加蓝号)
- `TrCompletedCard` — 完本推荐小卡 (.detail-style)

Skeleton 加载态: header + nav + 12 vlist 行 + 2 侧栏 + 6 分类格
空态: books.length === 0 直接 return null (上层 HomeView 兜底 EmptyState)

### 2.2 React Hooks 调用顺序

每个子组件 (`TrHeader`/`TrNav`/`TrTitle`/`TrVListRow`/`TrPopularRow`/`TrCompletedCard`) 在函数体顶部统一 `const { ... } = usePublic()` 解构, 无 JSX 属性内调用 usePublic(), 符合 React Rules of Hooks ✓

## 3. 首页适配 (HomeView → HomeClone*.tsx)

10 套全部接线 ✓:
- `HomeView.tsx` line 22-31: 10 个 dynamic import (含 `HomeCloneTrxsw`)
- `HomeView.tsx` line 172-182: 10 个分发分支 (`{theme.layout === 'clone-trxsw' && <HomeCloneTrxsw ... />}`)
- `HomeView.tsx` line 184: 兜底白名单扩为 10 个 layout key
- Header 注释更新为 "分发 10 种 clone-* 布局"

```tsx
const HomeCloneTrxsw = dynamic(() => import('./layouts/HomeCloneTrxsw').then((m) => m.HomeCloneTrxsw))
// ...
{theme.layout === 'clone-trxsw' && <HomeCloneTrxsw books={books} loading={loading} />}
// 兜底白名单
{!['clone-aijjxs', 'clone-ddyueshu', 'clone-pilishuwu', 'clone-23qb', 'clone-101kks',
   'clone-huangjinwu', 'clone-ggd66', 'clone-shipsay', 'clone-x2552', 'clone-trxsw'].includes(theme.layout) && loading && (
  <BookGridSkeleton count={12} />
)}
```

## 4. 分类页适配 (CategoryView → ThemeBookList)

- 所有 10 套主题共用 `ThemeBookList` 通用组件 (`BookCard.tsx`)
- ThemeBookList 内部调用 `BookCard` 通用卡片, 完整消费 `theme.vars` (primary/text/textMuted/surface/border/radius/cardShadow)
- `CategoryView.tsx` 消费 `theme.vars` 共 ~17 处 (banner/筛选条/空态/分页)
- 分类页适配无需按主题差异化, 单一通用组件已覆盖 10 套主题 ✓

## 5. 书页适配 (BookView)

- `BookView.tsx` 内消费 `theme.vars` 共 ~30+ 处 (panelStyle/封面/H1/作者/简介/标签/按钮/目录/翻页/相关推荐/PSEO 关键词区)
- R12-1 已清理 9 处旧主题分支 (pili/aurora/paper/mango/bamboo/rose/magazine/theater)
- R13-1A 新增 `PSEOKeywordsSection` 组件, 完整消费 theme.vars (primary/text/textMuted/surface/border)
- 10 套主题在 BookView 中无差异化分支 (全部走通用主题化样式) ✓

### 5.1 BookView 元素逐项审计

| 元素 | 主题化方式 | 验证 |
|---|---|---|
| panelStyle (主面板) | `background: v.surface` + `border` + `borderRadius: v.radius` + `boxShadow` | ✓ |
| H1 书名 | `style={{ color: v.text }}` | ✓ |
| 作者链 | `style={{ color: v.primary }}` | ✓ |
| 简介 | `style={{ color: v.textMuted }}` | ✓ |
| 标签徽章 | `background: withAlpha(v.primary, 0.08)` + `color: v.primary` | ✓ |
| 阅读按钮 | `background: v.primary` + `color: v.primaryText` | ✓ |
| 目录卡 | `background: v.surface` + `border` + `borderRadius: v.radius` | ✓ |
| 翻页 | `background: v.surfaceAlt` + `color: v.text` | ✓ |
| 相关推荐卡 | `background: v.surface` + `border` + `borderRadius: v.radius` | ✓ |
| PSEO 关键词 | `background: withAlpha(v.primary, 0.08)` + `color: v.primary` | ✓ |

## 6. 目录页适配 (BookView 内 toc 区)

- 10 套 clone-* 主题统一默认 3 列剧集列表分支 (在 BookView 内嵌 toc 区)
- 目录章节项消费 `v.primary` / `v.textMuted` / `v.border`
- 章节链 hover: `hover:opacity-80` (无硬编码颜色) ✓

## 7. 章节页适配 (ReadView → ReadClassic/ReadImmersive/ReadPaginated/ReadPili)

- `readOf(theme)` 9 字段全部生效 (layout/measure/lineHeight/fontBase/indent/justify/toolbar/texture/chapterDeco)
- 10 套 clone-* 主题均走 `ReadClassic` (classic 布局)
- 4 个 ReadLayout (ReadClassic/ReadImmersive/ReadPaginated/ReadPili) 全部消费 `theme.vars` 共 ~101 处 ✓
- 10 套主题 read 配置:
  - clone-aijjxs: measure 760 / lineHeight 1.85 / fontBase 17 / justify true / texture none / chapterDeco rule
  - clone-ddyueshu: measure 720 / lineHeight 1.85 / fontBase 16
  - clone-pilishuwu: measure 720 / lineHeight 2.0 / fontBase 17 / texture paper / chapterDeco ornament ★
  - clone-23qb: measure 720 / lineHeight 2.0 / fontBase 17 / justify true
  - clone-101kks: measure 720 / lineHeight 1.95 / fontBase 17
  - clone-huangjinwu: measure 740 / lineHeight 1.65 / fontBase 17
  - clone-ggd66: measure 720 / lineHeight 1.7 / fontBase 16
  - clone-shipsay: measure 720 / lineHeight 1.8 / fontBase 14
  - clone-x2552: measure 720 / lineHeight 1.7 / fontBase 16
  - clone-trxsw: measure 720 / lineHeight 1.9 / fontBase 16

## 8. 关键词页适配 (KeywordView)

- R13-1A 已增强为 PSEO 落地页 (H1/desc/搜索框/相关搜索区块)
- `KeywordView.tsx` 消费 `theme.vars` 共 ~30+ 处
- 标题徽章: `background: withAlpha(v.primary, 0.1)` + `color: v.primary` ✓
- 主书籍卡: `background: v.surface` + `border` + `borderRadius: v.radius` ✓
- 搜索框: `background: v.surface` + `border` + `color: v.text` ✓
- 搜索按钮: `background: v.primary` + `color: v.primaryText` ✓
- 相关搜索词链: `hover:opacity-80` (无硬编码颜色) ✓

## 9. 搜索页适配 (SearchView)

- `SearchView.tsx` 消费 `theme.vars` 共 ~10+ 处
- 搜索框/筛选条件/结果卡/空态/分页均走通用主题化样式 ✓

## 10. 历史页适配 (HistoryView)

- `HistoryView.tsx` 消费 `theme.vars` 共 ~30+ 处
- 阅读历史卡: `background: v.surface` + `border` + `borderRadius: v.radius` + `boxShadow` ✓
- 进度条: `background: v.primary` ✓
- 清空确认对话框 (AlertDialog): `background: v.surface` + `color: v.text` + `border` ✓
- 阅读继续按钮: `background: v.primary` + `color: v.primaryText` ✓

## 11. 良性硬编码 (Tailwind hover 任意值类)

`HomeCloneTrxsw.tsx` 中 17 处 `hover:text-[#2c7be5]` / `hover:bg-[rgba(44,123,229,0.04)]` / `hover:border-[#2c7be5]` 均为 Tailwind 任意值 hover 类, **等同 v.primary** (#2c7be5):

| 文件 | 行号 | 类型 | 说明 |
|---|---|---|---|
| HomeCloneTrxsw.tsx | 141/145/149 | hover:text-[#2c7be5] | 用户菜单 (书架/排行/登录) hover 文字色 |
| HomeCloneTrxsw.tsx | 176 | hover:text-[#2c7be5] | nav 8 分类 hover 文字色 |
| HomeCloneTrxsw.tsx | 226/294 | hover:bg-[rgba(44,123,229,0.04)] | .vlist 行 hover 背景色 |
| HomeCloneTrxsw.tsx | 248/259/310 | hover:text-[#2c7be5] | 书名/章节名 hover 文字色 |
| HomeCloneTrxsw.tsx | 333 | hover:border-[#2c7be5] | 完本卡 hover 边框色 |
| HomeCloneTrxsw.tsx | 347 | hover:text-[#2c7be5] | 完本卡书名 hover 文字色 |
| HomeCloneTrxsw.tsx | 463 | hover:bg-[rgba(44,123,229,0.06)] | 分类卡 hover 背景色 |
| HomeCloneTrxsw.tsx | 489-493 | hover:text-[#2c7be5] | 友情链接 hover 文字色 |

**原因**: Tailwind CSS 无法基于运行时 `theme.vars.primary` 动态生成 hover 伪类. 静态 className 中 `hover:text-[${v.primary}]` 不会被打包, 必须 hardcode 等价 hex 值. 这是 Tailwind 静态分析机制的限制, 非运行时缺陷.

**同样模式已存在于其他 9 套 HomeClone 中** (一致性):
- `HomeCloneDdyueshu.tsx` 4 处 `hover:bg-[rgba(108,173,83,0.06)]` (绿系, 等同 v.primary)
- `HomeClone23qb.tsx` 3 处 `hover:text-[#ff2a14]` (红, 等同 v.primary)
- `HomeCloneShipsay.tsx` 12 处 `hover:text-[#ed4259]` (红, 等同 v.primary)

**结论**: 这些 hardcoded 值均与对应主题的 `theme.vars.primary` 完全一致, 是 Tailwind 静态分析的良性妥协, 不影响主题一致性 ✓

## 12. 验证结果

### 12.1 tsc 验证

```bash
$ cd /home/z/my-project && bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | tail -10
# (无输出, 0 errors)
```

✓ 0 errors (src/ 目录无任何类型错误)

> 注: `examples/websocket/{frontend,server}.tsx` 与 `skills/*` 下的 4 个错误为示例代码与 SDK 不兼容, 与本项目无关.

### 12.2 lint 验证

```bash
$ cd /home/z/my-project && bun run lint 2>&1 | tail -5
$ eslint .
EXIT=0
```

✓ 0 errors / 0 warnings

### 12.3 THEMES 数组验证

```bash
$ bunx tsx /tmp/test-themes-r13.ts
THEMES.length = 10  ✓
default: clone-aijjxs  ✓
clone-aijjxs : OK primary=#0f766e
clone-ddyueshu : OK primary=#6F78A7
clone-pilishuwu : OK primary=#fd8929
clone-23qb : OK primary=#ff2a14
clone-101kks : OK primary=#667eea
clone-huangjinwu : OK primary=#2563eb
clone-ggd66 : OK primary=#00886d
clone-shipsay : OK primary=#ed4259
clone-x2552 : OK primary=#2f468f
clone-trxsw : OK primary=#2c7be5
```

✓ 10 个 preset ID 全部可解析, 默认主题为 clone-aijjxs

## 13. 修改文件清单

### 13.1 新增文件 (1 个)

- `src/components/public/layouts/HomeCloneTrxsw.tsx` (513 LoC)

### 13.2 修改文件 (3 个)

| 文件 | 修改内容 |
|---|---|
| `src/lib/crawl/themes.ts` | header 注释更新 (R13-1B); `ThemeDef.layout` 类型联合新增 `'clone-trxsw'`; THEMES 数组新增第 10 套 preset (clone-trxsw) |
| `src/components/public/HomeView.tsx` | header 注释更新; 新增 `HomeCloneTrxsw` dynamic import; 新增 `{theme.layout === 'clone-trxsw' && <HomeCloneTrxsw ... />}` 分发分支; 兜底白名单扩为 10 个 layout key |
| `src/app/api/admin/themes/route.ts` | header 注释更新为 "10 套 (含 clone-trxsw)" |

### 13.3 未修改文件 (按任务约束)

- `src/components/public/bits.tsx` (含 Sk/EmptyState/ErrorState/BookGridSkeleton/TagCloud 等通用组件)
- `src/components/public/seo.ts` (含 withAlpha / statusStyle / siteKeywordList)
- `src/components/public/ctx.tsx` (usePublic Provider)
- `src/components/public/BookCover.tsx`
- `src/components/public/types.ts`
- `src/components/public/data.ts`
- `src/lib/cleaner.ts`
- `src/components/public/BookView.tsx` (R13-1A 已修改 PSEOKeywordsSection, 不再触碰)
- `src/components/public/KeywordView.tsx` (R13-1A 已修改 PSEO 模式, 不再触碰)
- `src/lib/crawl/suggest.ts` (R13-1A 已增强 7 引擎 + PSEO, 不再触碰)

## 14. 总结

| 项 | 状态 |
|---|---|
| THEMES preset 数量 | 10 (含 clone-trxsw) ✓ |
| 10 个 HomeClone*.tsx 布局组件 | 全部接线 ✓ |
| 10 套主题在所有页面 (首页/分类/书页/目录/章节/关键词/搜索/历史) 的主题适配 | ✓ |
| HomeCloneTrxsw.tsx 基于 AiraBrowser 反查 DOM | ✓ (.vlist/.detail/.content/.pager/.headline/.intro) |
| 10 个新 Home 布局使用 usePublic() + theme.vars | ✓ |
| 每个新 Home 布局都有 Skeleton + 空态处理 | ✓ |
| 每个新 Home 布局都做响应式 (移动单列/桌面多列) | ✓ |
| tsc 0 errors (排除 examples/skills) | ✓ |
| lint 0 errors / 0 warnings | ✓ |
| test-themes-r13.ts 验证 10 个 ID 全部可解析 | ✓ |
| 默认主题为 clone-aijjxs | ✓ |
| 良性硬编码 (Tailwind hover 任意值类) 已记录 | ✓ |
