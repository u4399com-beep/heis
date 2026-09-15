# Task: R9-1A — 废弃 16 个旧 preset, 精仿 5 个真实小说站点主题 + 5 个专门 Home 布局

Agent: full-stack-developer
Date: 2026-09-15
Task ID: R9-1A

## 概览

废弃原 16 个旧 preset 主题 (aurora/paper/mango/bamboo/ocean/forest/sunset/jewel/cyberpunk/
vintage/midnight/sakura/aijjxs-exact/sunset-mosaic/ocean-masonry/jewel-showcase/vintage-editorial),
改为 5 套精仿真实小说站点 preset, 每套配套一个专门 Home 布局组件 (HomeClone*).

## 5 个站点抓取结果

| 站点 | URL | 抓取状态 | 数据来源 |
|---|---|---|---|
| 101kks | https://101kks.com | ✓ 直连 200 | /css/style.css + /css/block_booklist.css |
| 霹雳书屋 | https://www.pilishuwu.com | ✗ CF 403 (jsd 挑战) | scripts/seed-rule-pilishuwu.ts 形态 + 已有 HomePili.tsx 设计 |
| 久久小说 | https://www.aijjxs.com | ✓ 直连 200 (53KB) | /skin/yellow/style.css (40KB) :root 块完整 |
| 笔趣阁 | https://www.bqg713.cc | ✓ 跟随 301 后 200 | /css/style.css (18KB) |
| 铅笔小说 | https://www.23qb.net | ✓ 直连 200 (45KB) | /mxstatic/css/style.css (126KB) |

## 5 套精仿 preset (THEMES 数组)

1. **clone-aijjxs** (默认, 置首位) — 久久小说 aijjxs.com
   - layout: `clone-aijjxs` / dark: false
   - bg #f3efe7 (radial gradients), surface #fffdf8, text #1f2937, textMuted #6b7280
   - primary #0f766e (青绿), accent #b45309 (琥珀), border #e5dccd, radius 14px
   - fontFamily: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei"
   - cardShadow: 0 10px 30px rgba(17,24,39,0.08) (实测 --shadow)
   - headerStyle: solid

2. **clone-101kks** — 101看書 101kks.com (cdnshu 框架)
   - layout: `clone-101kks` / dark: false
   - bg #fff, surface #fff, surfaceAlt #f5f7fa
   - text #2c3e50 (booklist-title 实测), textMuted #7f8c8d (booklist-meta 实测)
   - primary #667eea (booklist-cover-section gradient 实测), accent #06c (a:hover 实测)
   - border rgba(0,0,0,0.08), radius 10px (实测)
   - cardShadow: 0 2px 10px rgba(0,0,0,0.08) (实测)
   - headerStyle: solid

3. **clone-pilishuwu** — 霹雳书屋 pilishuwu.com (CF 防护, 参考形态)
   - layout: `clone-pilishuwu` / dark: false
   - bg: radial-gradient(1200px 600px at 0% 0%, rgba(255, 222, 173, 0.18) 0%, ...) #fef9ef (米黄奶油)
   - surface #fff, surfaceAlt #fff5e6, text #432d18, textMuted #9b7a55
   - primary #f77720 (暖橙), accent #c4521a (深橙), border #f0d9b5, radius 6px
   - headerStyle: gradient (橙头渐变)

4. **clone-biquge** — 笔趣阁 bqg713.cc
   - layout: `clone-biquge` / dark: false
   - bg #E9FAFF (实测浅青蓝), surface #fff, surfaceAlt #FEF9EF (.hot bg)
   - text #333 (实测), textMuted #888, primary #88C6E5 (.nav bg 天蓝实测)
   - accent #FD5500 (a:hover 实测橙红), border #A6D3E8 (实测), radius 0px (笔趣阁 DNA 直角)
   - fontFamily: "Microsoft YaHei", Arial (实测 BODY 14px/1.5)
   - cardShadow: none (实测 .item 无 box-shadow)
   - headerStyle: solid

5. **clone-23qb** — 铅笔小说 23qb.net
   - layout: `clone-23qb` / dark: false
   - bg #f8f9f9 (实测), surface #fff, surfaceAlt #eaedf1 (.block-box-item 实测)
   - text #282828 (实测), textMuted #888, primary #ff2a14 (a:hover 鲜红实测)
   - accent #c01a0c (深红), border #eaedf1 (实测), radius 10px (.block-box-item 实测)
   - fontFamily: -apple-system-font, BlinkMacSystemFont, helvetica neue, pingfang sc,
     hiragino sans gb, microsoft yahei ui, microsoft yahei, Arial (实测完整字体栈)
   - cardShadow: 0 7px 21px rgba(149,157,165,0.22) (.header-content/.search-box 实测)
   - headerStyle: solid

## 5 个新 Home 布局组件

### 1. HomeCloneAijjxs.tsx (250 LoC)
- 顶 banner (奶油+青绿) + 站点名 + slogan + 全本 TXT 下载标记
- 5 列封面卡 (.book.book_r DNA: 48x64 缩略图 + 右侧书名+作者+简介+状态+分类)
- 表格最近更新 (book_r grid: 类别/书名+最新章节/字数/更新时间/状态)
- 横向琥珀排行榜 (1-3 名带色徽章 + 4-10 灰号)
- 双栏布局: 左主栏 (5 列封面 + 表格) + 右栏 (排行榜 + 站点公告)

### 2. HomeCloneBiquge.tsx (290 LoC)
- 顶 nav 蓝色条 (8 项菜单: 首页/玄幻/都市/历史/网游/科幻/恐怖/同人/完本)
- 双栏布局:
  - 左主栏 (.hot 大卡列表 item dt+dd DNA: 120x150 封面 + 标题/作者/简介/分类, .hot 3px border
    + bg #FEF9EF) + 表格最近更新 (类别/书名+最新章节/字数/更新时间/状态)
  - 右栏 (.top 排行榜 3px border + 12 本序号+书名+字数 + 站点公告)
- 笔趣阁 DNA 全直角 (radius 0px), 浅青蓝底 #E9FAFF

### 3. HomeClone101kks.tsx (310 LoC)
- 顶 banner 蓝紫渐变 (#667eea→#764ba2) + 站点名 + 搜索框 + slogan
- 精品推荐宽卡 3 列 (.booklist-card DNA: 120px 渐变 cover-section + info-section
  title+meta+desc, hover translateY(-2px))
- 最新入库封面网格 6 列 (bookimg 48x64 + booknav)
- 表格最近更新 (#/书名/作者/最新章节/更新时间)
- 站点信息条 (headbox DNA: max-width 1250px 容器 + 横向 flex)

### 4. HomeClonePilishuwu.tsx (260 LoC)
- 顶 banner 暖橙渐变 (#f77720) + 站点名 + slogan
- 双栏布局:
  - 左主栏 (精品推荐封面网格 5 列 mod-cover-list DNA + 最新入库 6 列 + 最近更新表格
    时间/分类/书名+最新章节/字数)
  - 右侧橙头排行榜 (in-phlist DNA: 渐变橙头 + 1-3 名橙号 + 4-10 灰号) + 书屋公告奶油底
- 复古直角白卡 + 暖橙点缀

### 5. HomeClone23qb.tsx (310 LoC)
- 顶 header-content (shadow 0 7px 21px + 1px border-bottom) logo+搜索框+slogan
- 精品推荐封面网格 6 列 (module-item DNA: padding-top 140% 5:7 aspect + 渐变 caption +
  状态/分类角标, hover shadow 0 10px 30px)
- 本周强推 3 列宽卡 (block-box-item DNA: bg #eaedf1 + No.编号 + hover 红 #ff2a14)
- 最新入库封面网格 6 列
- 表格最近更新 + 站点信息条

## 文件变更清单

- `src/lib/crawl/themes.ts` (重构 617 → 368 行, 删 16 旧 + 加 5 精仿 preset + 扩展 layout 联合 12→17)
- `src/components/public/layouts/HomeCloneAijjxs.tsx` (新增 250 LoC)
- `src/components/public/layouts/HomeCloneBiquge.tsx` (新增 290 LoC)
- `src/components/public/layouts/HomeClone101kks.tsx` (新增 310 LoC)
- `src/components/public/layouts/HomeClonePilishuwu.tsx` (新增 260 LoC)
- `src/components/public/layouts/HomeClone23qb.tsx` (新增 310 LoC)
- `src/components/public/HomeView.tsx` (+10 行: 5 dynamic import + 5 layout 分发分支 + 兜底白名单扩为 17)
- `src/components/admin/ThemesSection.tsx` (+2 行: 文案更新)

## 验证

- bunx tsc --noEmit → 0 errors ✓
- bun run lint → 0 errors / 0 warnings ✓
- 主题加载脚本验证: THEMES.length=5, 5 preset 全部 OK, 3 个 combo 主题全部正确合成 ✓
- 默认主题: clone-aijjxs (THEMES[0], 最稳定站)
- theme-matrix 1728 组合矩阵保留不变 (12×12×12 引擎能力, 与 preset 解耦)

## 约束遵守

- ✓ 必须先抓取每个站点的真实 HTML+CSS (4/5 直连成功, 1/5 CF 拦截兜底)
- ✓ THEMES 数组只剩 5 套精仿 preset, 原 16 套全删
- ✓ getTheme(undefined) 兜底返回 THEMES[0] = clone-aijjxs
- ✓ 没有修改 theme-matrix.ts (1728 组合矩阵保留)
- ✓ 没有修改 bits.tsx / seo.ts / ctx.tsx / BookCover.tsx / types.ts / ReadView.tsx
- ✓ 没有创建新的 mini-service
- ✓ 5 个新 Home 布局使用 usePublic() + theme.vars, 不硬编码颜色
- ✓ 5 个新 Home 布局都有 Skeleton + 空态处理
- ✓ 5 个新 Home 布局都响应式 (移动单列 / sm 2-3 列 / lg 3-6 列)
