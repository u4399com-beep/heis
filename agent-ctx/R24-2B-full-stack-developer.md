# R24-2B — 23qb 主题 1:1 重写工作记录

## Task
重写 23qb 全套 8 页型为真正 1:1 克隆 www.23qb.net 铅笔小说

## 完成清单 (8 个文件, 位于 src/components/public/clone-themes/23qb/)
1. ✅ HomeClone.tsx (220 行) — 完整复刻源站首页
2. ✅ BookInfo.tsx (178 行) — 复刻源站书页 (.module-search-item + .novel-info 结构)
3. ✅ CategoryList.tsx (175 行) — 复刻源站分类页 (.module .module-items + #page)
4. ✅ ReadChrome.tsx (105 行) — 复刻源站阅读页 (.article + .article-content + .chepnav)
5. ✅ RankingView.tsx (218 行) — 复刻源站排行榜 (.module-tab + 大封面 + 排名列表)
6. ✅ FulltextView.tsx (158 行) — 复刻源站全本页 (.module .module-items + #page)
7. ✅ SearchView.tsx (173 行) — 复刻源站搜索页 (.search-stat + .module-search-item)
8. ✅ KeywordView.tsx (142 行) — 复刻源站关键词页 (.search-stat + .module .module-items)

## 关键决策
- 用源站真实 class 名 (从 probe-23qb.html + 23qb.css 提取), 让 CloneCSSLoader 加载的 23qb.css 自动生效
- 不用 inline style 换配色 — CSS 已加载会自动作用
- probe-23qb-book.html / probe-23qb-category.html 都被 Cloudflare 拦截, 改用 23qb.css 反向推导子页结构
- 复刻源站完整 DOM (header#header + main#main + footer#footer + #friendlink), 不简化成通用封面网格
- 每个文件含 header(简版 logo+搜索+nav) + main + footer 三段式, 与源站首页 DOM 层级一致
- 数据来源: HomeClone 内部 useEffect fetch /api/public/categories 拿分类列表用于 nav + list-item 区块标题
- 交互保留: bookNavProps(navigate, b.id) 跳书页; navigate({view:'category',cat}) 跳分类; navigate({view:'search',q}) 搜索

## 验证结果
- bun run lint: exit=0 (全项目 0 errors)
- bunx tsc --noEmit (排除 examples/skills): src/ 0 errors
- agent-browser 实地确认 23qb HomeClone 完整渲染源站 DOM:
  - header: link "23qb-test" (logo) + 首页/玄幻 分类导航 + searchbox + link "书库" + button 搜索
  - 主区: button "万相之王" × 2 (.module-item 大封面 + 标题) + heading "玄幻" (h5.item-title) + button "01万相之王" (.item .order + .keyword)
  - 友情链接: heading "友情链接：" (h2) + link "RSS" / "Google" / "Bing"
- 截图 /tmp/23qb-home.png (43KB, 1280x962) 视觉确认
- 测试站点: id=cmu662q450000modpvgileq3y (themeId=clone-23qb), 200 OK

## 接线状态
- HomeView: ✅ 主控已接线 (R24-1A)
- CategoryView/ReadView: ⚠️ lookup table 已定义但 dispatch 路径仍走 fallback (master 待接线)
- BookView/RankingView/FulltextView/SearchView/KeywordView: ⚠️ 未引入 clone-themes (master 待接线)

## 修改文件清单 (8 个, 全部在 src/components/public/clone-themes/23qb/)
- HomeClone.tsx / BookInfo.tsx / CategoryList.tsx / ReadChrome.tsx
- RankingView.tsx / FulltextView.tsx / SearchView.tsx / KeywordView.tsx

## 不修改的文件
- shipsay 主题 (主控已写 HomeClone) + 其他 8 套主题 (其他 agent 负责)
- HomeView.tsx/PublicSite.tsx/CloneCSSLoader.tsx/themes.ts/books route (主控已接线)
- BookView.tsx/CategoryView.tsx/ReadView.tsx/RankingView.tsx/FulltextView.tsx/SearchView.tsx/KeywordView.tsx (master 待后续接线)
- ctx.tsx/bits.tsx/seo.ts/BookCover.tsx/types.ts/shared.ts/helper
- prisma/schema.prisma
- 0 新依赖安装
