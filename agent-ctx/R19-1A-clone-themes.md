# R19-1A — clone-themes 10 套主题模块重建

## 任务
在 `src/components/public/clone-themes/` 创建 10 套主题模块, 每套 8 个组件 + 1 个 index.ts + 1 个 shared.ts (共 100 文件).

## 10 个站点
1. aijjxs (久久小说) - 双层 radial-gradient + 青绿 #0f766e + 琥珀 #b45309 + 14px 圆角
2. ddyueshu (得得小说) - GBK 宋体 + 浅蓝底 #E9FAFF + 天蓝头 #88C6E5 + 蓝紫链 #6F78A7 + 2px 直角
3. pilishuwu (霹雳书屋) - wmcms-web + 暖橙 #fd8929 + 红橙 hover #ec5245 + 2px 直角
4. 23qb (铅笔小说) - 浅灰底 + 鲜红 hover #ff2a14 + 5px 圆角
5. 101kks (101看書) - 米黄头 #fff2df + 蓝紫渐变 #667eea + 10px 圆角
6. huangjinwu (黄金屋) - 玻璃 header + 蓝主色 #2563eb + 6px 圆角
7. ggd66 (格格党) - 薄荷绿头 #56ccb5 + 青绿链 #00886d + 橙红 hover #f50 + 4px
8. shipsay (船说CMS) - 红主色 #ed4259 + 深灰头 #3e3d43 + 3px 圆角
9. x2552 (吾爱文学) - GBK + 蓝紫链 #2f468f + 橙 hover #ff6600 + 3px
10. trxsw (天人小说) - 域名过期, AiraBrowser 反查 .vlist/.detail/.content/.pager + 深蓝 #2c7be5

## 每套 10 个文件
```
clone-themes/<site>/
  HomeClone.tsx       # 首页 (BookGridSkeleton + EmptyState + 网格)
  BookInfo.tsx        # 书籍详情 (封面 + kv 表 + 简介 + 操作按钮)
  CategoryList.tsx    # 分类列表 (网格 + 分页)
  ReadChrome.tsx      # 章节阅读外壳 (居中窄列 + 标题 + 正文 + 翻页栏)
  RankingView.tsx     # 排行榜 (tab 切换 + 前3加色徽章 + 分页)
  FulltextView.tsx    # 全本完本 (网格 + 分页)
  SearchView.tsx      # 搜索结果 (标题 + 结果网格 + 空态)
  KeywordView.tsx     # 关键词落地 (大标题 + 主书 + 次要书单)
  index.ts            # 8 个组件 + 8 个 props 类型导出
  shared.ts           # 8 个 props 接口定义
```

## 1:1 克隆标准 (全部满足)
1. ✓ 硬编码颜色 — 每套组件 const C = {bg/surface/text/primary/accent/border/radius/cardShadow/fontFamily/maxW}
   全部来自源站实测 CSS (themes.ts vars 提取的 #xxxxxx), 不用 theme.vars
2. ✓ 用 inline style — 全部 style={{}} 对象, 不依赖 Tailwind 类
3. ✓ 用 usePublic() — 每个组件顶层 const { navigate } = usePublic()
4. ✓ 用 BookCover 渲染封面 — import { BookCover } from '../../BookCover'
5. ✓ 有 Skeleton + 空态 — loading 走 BookGridSkeleton, 空数组走 EmptyState
6. ✓ 响应式 — 全部用 gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))'

## 生成方式
- 编写 scripts/gen-clone-themes-r19.cjs (Node.js 脚本, ~830 行)
- SITES 数组定义 10 套配色 (硬编码自 themes.ts vars)
- 每个组件函数 (genHomeClone/genBookInfo/...) 接受 site 参数, 模板化生成 .tsx 文件
- 一次 node 运行生成 100 文件, 总 LoC ~12000

## 验证
- bunx tsc --noEmit: 0 errors (排除 examples/skills 预存在错误)
- bunx tsc --noEmit --noUnusedLocals --noUnusedParameters: 0 errors (clone-themes 内)
- bun run lint: exit 0 (0 errors / 0 warnings)
- bunx tsx -e 模块加载冒烟测试: 10 套 × 8 组件 = 80 个 exports 全部 typeof === 'function'
- dev server curl / 返回 200 (clone-themes 模块编译成功)
- 文件计数: 100 个 (80 .tsx + 20 .ts), 与规划一致

## 修改文件清单 (R19-1A 净改动)
- 新增 src/components/public/clone-themes/aijjxs/{10 文件}
- 新增 src/components/public/clone-themes/ddyueshu/{10 文件}
- 新增 src/components/public/clone-themes/pilishuwu/{10 文件}
- 新增 src/components/public/clone-themes/23qb/{10 文件}
- 新增 src/components/public/clone-themes/101kks/{10 文件}
- 新增 src/components/public/clone-themes/huangjinwu/{10 文件}
- 新增 src/components/public/clone-themes/ggd66/{10 文件}
- 新增 src/components/public/clone-themes/shipsay/{10 文件}
- 新增 src/components/public/clone-themes/x2552/{10 文件}
- 新增 src/components/public/clone-themes/trxsw/{10 文件}
- 新增 scripts/gen-clone-themes-r19.cjs (生成器脚本, ~830 行)
- 净改动: +101 文件, +约 12800 行

## 不修改的文件 (尊重约束)
- 现有视图 (HomeView/BookView/CategoryView/ReadView/RankingView/FulltextView/SearchView/KeywordView) 未改
  → 当前仍走各自重建窗口期通用兜底 (theme.vars + 内联 fallback 组件)
  → R19 后续子代理可按 lookup table 模式接线到 clone-themes/<site>/{HomeClone,BookInfo,CategoryList,...}
- types.ts / cleaner.ts / suggest.ts / fetcher.ts / runner.ts / parser.ts / themes.ts 全部未动
- 未安装新 npm 包 (0 新依赖)

## 接线建议 (供 R19-1B+ 后续代理参考)
- HomeView.tsx: 10 个 dynamic import clone-themes/<site>, lookup table (fallback GenericBookGrid)
- BookView.tsx: lookup table, fallback 内联 BookInfoComponent
- CategoryView.tsx: lookup table, fallback 内联 CatListComponent
- ReadView.tsx: lookup table, fallback 内联 ReadChromeComponent
- RankingView.tsx/FulltextView.tsx: 当前 CloneRankingViews/CloneFulltextViews 空 Record, 直接填充
- SearchView.tsx/KeywordView.tsx: 当前未引用 clone-themes, 可加 lookup table
