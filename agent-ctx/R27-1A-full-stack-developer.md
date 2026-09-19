# Task ID: R27-1A — 分卷设置 + 章节目录分栏显示调整

## 背景
用户要求加入分卷设置,采集数据可能存在分卷;乱序重排时充分考虑分卷存在,源站有分卷名一并采集;适当调整章节目录分栏显示。

## 第一步: 读交接文档
- 已读 `/home/z/my-project/worklog.md` 最后 150 行
- R26-1A 完成了 8 个 crawl 模块全量审查 + 3 个 P1 bug 修复 + 4 处 P2 增强
- Chapter.volume 字段早已存在(prisma/schema.prisma:71, kk-a 番茄规则提取)
- cleaner.ts 已剥离章节标题"第N卷 卷名"前缀(保留给 volume 字段单独存)
- downloader.ts 在卷变化处插入卷标题行『══════ 卷名 ══════』(kk-d 分卷结构)
- parser.ts 已支持 toc.fields.volume 提取(const 型字段补提 ll-c)
- sorter.ts 已实现 reorderWithVolumes 分卷感知重排(kk-a + qq-e2 修复)

## 第二步: 现状审查

### 2.1 采集解析 volume 完整性
- **parser.ts (1484 行)**:
  - HTML 模式 (line 1206-1248): `volumeRule = fields.volume`, 调 extractField 提取, line 1248 push 时附 `volume: vol || undefined` ✓
  - JSON 模式 (line 1142-1148): 两阶段提取 — phase-1 跳过 const 型字段, 后置补提 const 型 volume 字段(同 title/url 机制) ✓
  - 已支持 required 校验(line 1158, 1243) ✓
- **rule-templates.ts (592 行)**:
  - 8 个模板中只有 `fanqie-style` 用 `chapterListWithVolume.*` 递归展平, 但 toc.fields 配置无 volume 字段 — 卷名静默丢失(原种子脚本注释明确写"卷名不表达(留档)")
  - 其余 7 个模板无分卷源站结构, 不需要 volume 字段
- **scripts/seed-rule-fanqie.ts**: 注释 line 22-24 说明 `chapterListWithVolume` 是数组的数组(卷→章), `*` 递归展平成章节平面, 卷名不表达

### 2.2 乱序重排考虑分卷
- **sorter.ts (381 行)** reorderToc 逻辑审查:
  - line 230-232: 检测 hasFieldVolume(章节带 volume 字段) 或 hasAnchor(标题含卷锚点) → 走 reorderWithVolumes
  - reorderWithVolumes (line 283-360) 完整实现:
    * 字段定卷(item.volume)聚合: 同名卷聚合(byKey Map)
    * 标题锚点定卷(纯"第N卷 卷名"标题)开新卷
    * 卷间排序: 有号卷按卷号升序, 无号卷按 firstIdx 首现序(qq-e2 修复尾部番外归位)
    * 卷内排序: 锚点条目排卷首, 其余按 sortByChapterNo 算法
  - **R26 审查结论: 分卷感知重排完整, 无 P0/P1 bug, 不需要修复**

### 2.3 章节目录分栏显示
- **BookView.tsx line 631-665** 已有 volGroups 分组:
  - hasVolumes 检测(任一章带 volume) → 构建 volGroups(连续相同 volume 一组)
  - 卷头: thin line + 卷名 + "N 章" 字数
  - 卷内: 走 renderChapterList 3 列 grid(grid-cols-1 sm:grid-cols-2 lg:grid-cols-3)
  - **可优化点**:
    1. 卷头视觉权重太低(只有一根细线 + 一行字), 多卷场景视觉层次混乱
    2. 多卷场景(>5 卷)没有快速跳转, 用户得手动滚
    3. 卷头与卷内章节 grid 同级 flex, 视觉分组不够强
    4. 缺少卷头 chip 风格(源站 aijjxs/23qb 等都用明显的卷头样式)

### 2.4 10 套 clone-themes BookInfo
- 全部 10 个 BookInfo.tsx 验证(aijjxs/ddyueshu/pilishuwu/23qb/101kks/huangjinwu/ggd66/shipsay/x2552/trxsw):
  - 都是**书籍详情面板**(封面/书名/作者/简介/相关推荐/猜您喜欢)
  - 不渲染章节目录(目录由 BookView 父级 renderToc 统一渲染)
  - 内含 "查看完整目录"/"查看完整章节目录" 按钮 → onScrollToc 滚动到父级 TOC 区
  - **结论**: 10 套 BookInfo 无需添加分卷显示, 分卷统一在 BookView renderToc 渲染

## 第三步: 任务实施

### 3.1 采集解析 volume 完善(rule-templates.ts)
- 给 `fanqie-style` 模板添加 `volume` 字段配置(占位 const 模板)
- 在 notes 中说明 volume 提取模式:
  - 章节列表带 volume 字段(HTML 站): `volume: { type: 'css', expression: '.vol-name' }` 或 xpath/regex
  - API 全卷同名(const): `volume: { type: 'const', expression: '{q.volume}' }` 或类似
  - 卷名+章列表对象(API): 需 map-collect 或自定义结构
- 当前 chapterListWithVolume.* 递归展平后, 卷名上下文丢失; 真实 API 恢复后用户按实际响应结构配置 volume 字段

### 3.2 乱序重排(sorter.ts) — 零修改保留
- 经 R26-1A 审查 reorderWithVolumes 完整无 bug
- 本次仅添加 R27-1A 注释说明分卷感知策略已覆盖所有重排场景

### 3.3 BookView.tsx renderToc 优化
- 卷头视觉增强: 卷名独立区块 + 左侧色块 + 章数徽章
- 多卷场景(≥3 卷)卷索引条: 显示卷数 + 卷头跳转锚点
- 响应式 grid 保留(移动 1 列 / sm 2 列 / lg 3 列)
- 卷头与卷内 grid 视觉隔离更明显
- 空卷组(正文)前置, 显式标"正文"

### 3.4 10 套 clone-themes BookInfo — 零修改
- 验证: 全部 10 套 BookInfo 不渲染章节目录, 统一在 BookView renderToc 渲染
- 分卷显示通过 BookView 的 volGroups 分组对所有主题生效(包括 clone-* 与默认主题)

## 第四步: 验证
1. `cd /home/z/my-project && bun run lint` — 0 errors / 0 warnings
2. `cd /home/z/my-project && bunx tsc --noEmit` — 0 errors in 改动文件
3. dev server log 全部 200 OK
