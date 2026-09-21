# Task R8-1B · full-stack-developer · 创建 4 个新首页布局 + 1 个细节组件库

## 交付物 (5 个新文件)

| 文件 | LoC | 描述 |
| --- | --- | --- |
| `src/components/public/layouts/HomeMosaic.tsx` | 214 | 马赛克拼贴布局 (12 列 dense grid + hero 大封面 + 2x2 小拼贴 + 横向滚动) |
| `src/components/public/layouts/HomeMasonry.tsx` | 200 | Pinterest 瀑布流 (CSS columns + 第 1/6/12 本特写 + sticky 站头) |
| `src/components/public/layouts/HomeShowcase.tsx` | 311 | 分屏侧边栏 (lg:sticky 280px + 主区本周强推/新书速递/完结佳作 + stacked bar 统计) |
| `src/components/public/layouts/HomeEditorial.tsx` | 277 | 编辑周刊 (ISSUE N° 刊头 + 本期导读双栏 + 3x3 编辑短评) |
| `src/components/public/layouts/HomeParts.tsx` | 328 | 可复用组件库 (HeroBanner / RankingList / CategoryStrip / ChapterTeaser / StarMark) |

**总计**: 1330 LoC

## 设计亮点

### HomeMosaic
- `cellSpan(index)`: 偶数 1x2 / 奇数 2x1 / 第 6 倍数 2x2 → 真正马赛克 dense flow
- `gridTemplateColumns: repeat(12,1fr)` + `gridAutoRows: '120px'` + `gridAutoFlow: 'dense'`
- hero 大封面 sm:col-span-2 row-span-2 + 渐变遮罩
- 底部横向滚动 w-24 卡片 (role list)

### HomeMasonry
- CSS columns 多列布局 (移动 2 / 桌面 3, 用媒体查询切 `.home-masonry-cols` 类)
- `breakInside: 'avoid'` + `display: 'inline-block'` + `width: '100%'`
- 第 1/6/12 本作"特写"加大封面 + 4 行简介
- 顶部 sticky 站头 `backdropFilter: 'blur(8px)'` + 半透明 bg

### HomeShowcase
- 左侧 lg:sticky top-20 self-start 280px 固定侧边栏
- 站点 logo (linear-gradient 圆角) + 分类列表 (button list) + 本站统计 (dl)
- 横向 stacked bar 展示连载/完结/未知比例 (primary + accent + textMuted 三色)
- 主区: 3 列卡片 + 5 行列表 (含最新章节) + 4 列完结网格

### HomeEditorial
- 顶部刊头 3px double 横线 + ISSUE N° tabular-nums italic
- 全程使用 titleFont 衬线字体
- 本期导读双栏 3fr:2fr (md:grid-cols-[3fr_2fr])
- 右侧 5 行目录大字号编号 (fontVariantNumeric tabular-nums + italic)
- 底部 3x3 编辑短评 (editorialReview 7 种伪文本轮换)
- 顶部刊头 3px double 横线 + 底部页脚横线 + uppercase tracking-widest

### HomeParts (可复用)
- **HeroBanner**: linear-gradient primary→accent + 辉光圆斑 (radial-gradient) + 背景 cover + CTA 按钮
- **RankingList**: 前 3 名 accent 渐变徽章 No.1/2/3 + 4-10 名等宽 tabular-nums + ChevronRight 悬浮显示
- **CategoryStrip**: 水平滑动分类 (role=tablist + aria-selected) + 右侧渐隐遮罩
- **ChapterTeaser**: 章节预览 (封面 48x64 + TrendingUp 最新章节 + Clock fmtDate)
- **StarMark**: 小星星装饰 (附赠)

## 质量门

- `bunx tsc --noEmit | grep -v "examples|skills"` → **0 errors** ✓
- `bun run lint` → **0 errors / 0 warnings** ✓
- dev.log 无新增运行时错误 ✓
- 全部 5 文件顶部 `'use client'`
- 全部使用 `usePublic()` 拿 `theme.vars` 配色 (无硬编码颜色, 除了 hero 卡片渐变遮罩使用通用 rgba(0,0,0,0.85))
- 全部含骨架屏 (用 `Sk`) + 空态 (if !books.length return null)
- 全部响应式 (移动单列 / sm 2-3 / md 3 / lg 4-6)
- 全部用 `bookNavProps(navigate, b.id)` 包装卡片 (键盘可达)
- 未修改任何约束文件

## 后续可复用

`HomeParts.tsx` 的 5 个组件可被后续布局 (或现有布局重设计) 复用:
- `import { HeroBanner, RankingList, CategoryStrip, ChapterTeaser, StarMark } from './HomeParts'`

后续代理如需新增第 5 个布局 (例如 hero+ranking 组合) 可直接拼装这 5 个零件。
