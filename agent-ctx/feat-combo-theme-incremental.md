# Task: feat-combo-theme-incremental
## Agent: Combinatorial theme system + range incremental

### Scope
Two features shipped in the heis project (`/home/z/my-project`):
1. **Combinatorial Theme System** — 50 配色 × 42 风格 × 24 布局 = 50400 组合主题(惰性生成, 不预生成全量对象)
2. **Range Task Incremental Crawling** — 连载书籍增量采集: 完结书整体跳过, 连载书重启后增量检查新章, 跨源去重合并

### Files Created
- `src/lib/crawl/theme-matrix.ts` — 50 COLOR_SCHEMES (25 light + 25 dark, 含 9 双色组合) × 42 STYLES (各具 headerStyle/cardShadow/radius/fontFamily/texture/chapterDeco) × 24 LAYOUTS (7 home × 4 read 选 24 各不同 readVars)。导出 `generateTheme`, `getThemeById`, `parseThemeId`, `getThemeList`, `getThemesPage`, `TOTAL_COMBOS=50400`。

### Files Modified
- `src/lib/crawl/themes.ts`:
  - 顶部静态导入 `getThemeById as resolveComboTheme` from `./theme-matrix`(theme-matrix 仅 type-only 依赖 themes, 无运行时循环)
  - 新增 `getThemeById(id)`: 先查 9 个 preset, 未命中走组合解析, 全未命中回退 `THEMES[0]`
  - 保留原 `getTheme(id)` (preset only) 兼容 SiteHeader 等老调用点
- `src/components/public/PublicSite.tsx`:
  - `import { getTheme } → import { getThemeById as getTheme }` (重命名导入, 调用点零改动)
  - `?theme=violet-glasswa-grid-cl` 现经 getThemeById 解析组合主题
- `src/app/api/admin/themes/route.ts`:
  - 双模式 API:
    - 默认无 query → 返回 `THEMES` (9 个 preset 数组, 兼容 ThemesSection 卡片网格原契约)
    - `?page=N&size=M` → 返回 `{ page, size, total: 50409, totalPages, items: [presets + combos 分页] }`
  - `sliceCombos(from, to)` 惰性切片生成(仅计算本页所需项, 不构建全量 50400 数组)
- `src/lib/crawl/runner.ts`:
  - `TaskRuntime` 新增 `ongoingBookUrls: Set<string>`, `bookLastChapters: Map<string, string>`
  - `TaskProgress` 新增 `ongoingBookUrls?: string[]`, `bookLastChapters?: Record<string, string>` (持久化)
  - `controlInner` 初始化新字段; `executeTask` 从 progress 恢复 / full 模式清空
  - 书籍循环: 仅 `completedBookUrls` 整体跳过(原 `跳过已采集` → 改为 `跳过已完结`); 连载书不跳过, 走 crawlOneBook 增量检查
  - `crawlOneBook`:
    1. **状态分流**: 不再由外层硬塞 completedBookUrls; 由 crawlOneBook 内部按 detectedStatus 分流(completed → completedBookUrls; ongoing/unknown → ongoingBookUrls + bookLastChapters)
    2. **增量检查连载**(isOngoingRecheck): 抓目录后对比末章 URL 与 stored URL —— 相同 → 跳过新章采集; 不同 → 增量采新章(existUrlMap 自动跳过已采过的)
    3. **跨源去重**: existing.sourceRuleId !== taskCfg.ruleId 时, 比较 existing 章 count 与新 tocItems.length —— 新源 ≤ 既有 → 跳过(已有更完整数据); 新源 > 既有 → 增量合并新章
  - `saveProgress` 同步把 ongoingBookUrls + bookLastChapters(Map → Object) 落库, cap 50000
  - 日志消息:
    - "跳过已完结: {bookUrl}"
    - "增量检查连载: {bookName}(末章未变, 跳过新章采集; 上次末章: ...)"
    - "增量检查连载: {bookName}(上次末章: ..., 当前末章: ...)"
    - "跨源去重: {bookName} 已存在于其他源(其他源 N 章 / 本源 M 章), 跳过"
    - "跨源合并: {bookName} 其他源 N 章 < 本源 M 章, 增量合并新章节"

### Theme ID Format
`{colorId}-{styleId}-{layoutId}` — e.g. `violet-glasswa-grid-cl`

- 50 colorIds: `violet`/`indigo`/`blue`/.../`vio-gold`/`rose-teal`/... (亮色 25) + `violet-d`/`indigo-d`/.../`vio-gold-d`/... (暗色 25)
- 42 styleIds: `minimal`/`glasswa`/`paper`/`neon`/`classic`/`modern`/`magazine`/`waterfall`/`shelf`/`theater`/`pili`/`inkpaint`/`cyber`/`steampunk`/`japanese`/`nordic`/`mediterr`/`forest`/`desert`/`aurora`/`sakura`/`deepsea`/`lava`/`frost`/`jade`/`amber`/`amethyst`/`rosegarden`/`lavender`/`coffee`/`typewriter`/`futurist`/`handwritten`/`ancient`/`bambooslip`/`silk`/`slate`/`dawn`/`dusk`/`galaxy`/`waterink`/`treasure`
- 24 layoutIds: `grid-cl`/`list-im`/`shelf-pg`/`mag-pl`/`min-cl`/`th-im`/`pili-pl`/`grid-im`/`list-pg`/`shelf-cl`/`mag-im`/`min-pg`/`th-pl`/`grid-pg`/`list-pl`/`shelf-im`/`mag-cl`/`min-im`/`th-pg`/`pili-cl`/`grid-pl`/`list-cl`/`shelf-pl`/`mag-pg`

`parseThemeId` 用反向匹配(末段 layoutId → 倒数第二段 styleId → 其余 colorId), 通过预定义 ID set 消歧; 处理含 `-` 的 colorId (如 `vio-gold-d`)。

### Quality Gates
- `bun run lint`: 0 errors / 0 warnings ✓
- `bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | wc -l`: 0 ✓
- Dev server `/`: HTTP 200 ✓
- `/?theme=violet-glasswa-grid-cl`: HTTP 200 ✓ (combo 主题解析生效)
- `/api/admin/themes` (默认): HTTP 200, 返回 9 个 preset 数组(ThemesSection 原契约兼容)
- `/api/admin/themes?page=2&size=15`: HTTP 200, 返回 `{page:2, size:15, total:50409, totalPages:3361, items:[15 项]}`
- 50400 combos 全部 ID 唯一(50×42×24 = 50400, ID set 验证通过)

### Notes
- 没有修改 site 验证路由(sites/route.ts, sites/[id]/route.ts, sites/batch/route.ts, seo-audit/route.ts) — 它们仍用 `THEMES.some(t => t.id === id)` 校验, 仅接受 9 个 preset ID。combo 主题仅供 `?theme=` 预览使用, 无法设为默认站点主题(符合约束: 不能修改其他 API 路由)。
- 现有 `getTheme(id)` (preset only) 保留, SiteHeader 等老调用点零回归。
- TaskRuntime 在 full 重采模式下清空 ongoingBookUrls + bookLastChapters; 增量模式从 progress 恢复。
- 状态跃迁处理: 原在 ongoingBookUrls 中的书若终判完结, 自动从 ongoing + lastChapters 中移除, 改入 completedBookUrls。
