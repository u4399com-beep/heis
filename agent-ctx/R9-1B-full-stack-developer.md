# Task ID: R9-1B — 12 套全新设计风格主题追加

## 任务概要

在 THEMES 数组追加 12 套完全不同风格+配色+布局的预设主题, 与 5 套精仿 (clone-aijjxs/clone-101kks/clone-pilishuwu/clone-biquge/clone-23qb) + 8 老布局 (grid/list/shelf/magazine/minimal/theater/pili/biquge) 均不雷同。

## 修改文件

- `/home/z/my-project/src/lib/crawl/themes.ts` (仅此 1 个文件)
  - 在 THEMES 数组末尾追加 12 个 preset (~360 LoC)
  - 未动: 5 套精仿 / ThemeDef 类型 / ReadVars / READ_DEFAULTS / getTheme / getThemeById / theme-matrix.ts

## 12 套主题详情

### 暗色 7 套

| # | ID | 名称 | 布局 | primary | accent | 字体 | 圆角 | 阴影风格 |
|---|---|---|---|---|---|---|---|---|
| 1 | aurora-glass | 极光玻璃 | shelf | #a855f7 (紫) | #22d3ee (青绿) | sans | 20px | 辉光 |
| 2 | cyber-neon | 赛博霓虹 | grid | #ff0080 (霓虹粉) | #00ff9d (霓虹绿) | mono | 0px | 辉光 |
| 5 | deep-ocean | 深海潜行 | theater | #ff6b35 (珊瑚橙) | #facc15 (阳光黄) | sans | 0px | 普通 |
| 6 | midnight-gold | 午夜黄金 | editorial | #d4af37 (金) | #b8860b (深金) | serif | 2px | 辉光 |
| 8 | crimson-theater | 朱砂剧场 | magazine | #8b0000 (朱红) | #e6c468 (浅金) | serif | 2px | 辉光 |
| 11 | forest-cabin | 森林木屋 | shelf | #5a3a1a (木棕) | #7a8450 (苔藓绿) | serif | 0px | 普通 |
| 12 | neon-magenta | 霓虹品红 | masonry | #ec4899 (品红) | #10b981 (青绿) | sans | 16px | 辉光 |

### 亮色 5 套

| # | ID | 名称 | 布局 | primary | accent | 字体 | 圆角 | 阴影风格 |
|---|---|---|---|---|---|---|---|---|
| 3 | rice-paper | 宣纸水墨 | magazine | #c1272d (朱砂红) | #2a2a2a (墨黑) | serif | 4px | 轻量 |
| 4 | sakura-mist | 樱花薄雾 | minimal | #9d174d (深紫红) | #f472b6 (浅粉) | sans | 8px | 极轻 |
| 7 | bamboo-zen | 竹简禅意 | list | #5a7a3a (竹青) | #2a3a1a (墨绿) | handwritten | 2px | 轻量 |
| 9 | arctic-ice | 北极冰原 | minimal | #075985 (深海蓝) | #7dd3fc (冰晶) | sans | 0px | 极轻 |
| 10 | sunset-glow | 落日余晖 | grid | #be185d (紫红) | #fb923c (浅橙) | sans | 16px | 轻量 |

## 设计原则落实

### 配色规则
- 12 个 primary 色全部不同 ✓ (验证脚本 Set.size = 12)
- 12 个 accent 色全部不同 ✓ (验证脚本 Set.size = 12)
- 0 撞色 with 5 套精仿 preset ✓
- 暗色 bg: `linear-gradient(160deg, ...)` 3 段渐变 ✓
- 亮色 bg: `radial-gradient(...)` 氛围层 + 基色 ✓ (sunset-glow 用 linear-gradient 表达 sunset 方向感, 例外)
- 暗色 surface: `rgba(255,255,255,0.06)` / surfaceAlt: `rgba(255,255,255,0.1)` ✓
- 亮色 surface: 纯白 / 暖白, surfaceAlt: 浅色派生 ✓

### 字体栈
- sans (6 套): aurora-glass / cyber-neon (mono) / sakura-mist / deep-ocean / arctic-ice / sunset-glow / neon-magenta — wait cyber-neon is mono, so sans = aurora-glass + sakura-mist + deep-ocean + arctic-ice + sunset-glow + neon-magenta = 6 ✓
- serif (4 套): rice-paper / midnight-gold / crimson-theater / forest-cabin ✓
- handwritten (1 套): bamboo-zen (Ma Shan Zheng) ✓
- mono (1 套): cyber-neon (JetBrains Mono) ✓

### 阴影规则
- 暗色辉光主题 (5 套): aurora-glass / cyber-neon / midnight-gold / crimson-theater / neon-magenta → `0 8px 32px rgba(<primary RGB>,0.35)` ✓
- 暗色普通主题 (2 套): deep-ocean / forest-cabin → `0 6px 18px rgba(0,0,0,0.5)` ✓
- 亮色主题: `0 2px 8px rgba(0,0,0,0.06)` ✓
- 极简主题 (2 套): sakura-mist / arctic-ice → `0 1px 2px rgba(0,0,0,0.04)` ✓

### read 配置规则
- shelf/theater/editorial/magazine → classic, measure 700-720 ✓
- minimal → immersive, measure 740, toolbar floating ✓
- grid/masonry/list → classic, measure 720-740, justify true ✓
- 暗色 → texture vignette + chapterDeco none ✓
- 亮色纸张 (rice-paper/bamboo-zen) → texture paper + chapterDeco ornament ✓
- 亮色极简 (sakura-mist/arctic-ice) → texture none + chapterDeco rule ✓

## 验证结果

### 1. tsc
```
cd /home/z/my-project && bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | tail -10
```
→ 0 errors ✓

### 2. lint
```
cd /home/z/my-project && bun run lint 2>&1 | tail -5
```
→ 0 errors / 0 warnings ✓

### 3. 验证脚本 (临时 /home/z/my-project/scripts/test-themes-12.ts, 已清理)
- THEMES.length = 17 ✓
- 12 新主题全部 getThemeById 解析成功 ✓
- 12 个 unique primary colors ✓
- 12 个 unique accent colors ✓ (bonus)
- 0 clashes with 5 clone presets ✓
- layout 分布: { shelf: 2, grid: 2, magazine: 2, minimal: 2, theater: 1, editorial: 1, list: 1, masonry: 1 } ✓
- dark 7 / light 5 ✓

### 4. dev.log
无新增运行时错误 (仅残留 GET /api/admin/tasks/... 请求日志, 与本任务无关) ✓

## 完成确认

- THEMES 总数: 17 (5 精仿 + 12 新设计) ✓
- 12 套主题布局覆盖: shelf×2 / grid×2 / magazine×2 / minimal×2 / theater×1 / editorial×1 / list×1 / masonry×1 ✓
- 12 套主题字体覆盖: sans×6 / serif×4 / handwritten×1 / mono×1 ✓
- 12 个 primary 色全部不同 ✓
- 0 撞色 with 5 精仿 preset ✓
- tsc + lint 通过 ✓
- 文件变更: src/lib/crawl/themes.ts (+~360 LoC)
