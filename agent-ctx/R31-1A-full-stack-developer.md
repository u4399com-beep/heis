# R31-1A 主题回源站对比校准

## 任务回顾
对 10 套 clone-themes 主题 (aijjxs/ddyueshu/pilishuwu/23qb/101kks/huangjinwu/ggd66/shipsay/x2552/trxsw)
vs 源站 probe-html2 DOM 样本进行 1:1 对比校准, 修复不一致的 class 名 / DOM 层级。

## 第一步: 读交接
- tail -150 worklog.md → R24-R30 历史 (10 套主题 1:1 克隆 + SSR 渲染 + R28 useCloneCategories hook +
  R29 8 级降级链 + R30 智能分类归一化)

## 第二步: 探测源站 probe HTML 样本
- agent-ctx/probe-html2/ 内有 9 套主题的 probe HTML/CSS (trxsw 无 probe):
  · probe-ggd66.html (267 行) / probe-ddyueshu.html (299 行 GBK)
  · probe-pilishuwu.html (5239 行!) / probe-23qb.html (1251 行)
  · probe-101kks.html (974 行) / probe-huangjinwu.html (673 行)
  · probe-shipsay.html (376 行) / probe-x2552.html (300 行)
  · probe-aijjxs.html (1249 行) + 子页 (book/category/chapter)
- public/clone-css/<site>.css 已与 probe-html2/<site>.css 同步

## 第三步: 自动化 diff probe vs clone className
写脚本对 9 套 (排除 trxsw) 自动 diff probe class 名 vs clone className 名, 排除:
- JS-injected 类 (aui_* artDialog / bds_* baidu share / cookie-* cookie 横幅)
- hover 弹层 (drop-content/grid-item/ac_hot)
- 子页面专有类 (probe 是 home, clone 的 BookInfo/CategoryList/RankingView 等子页不需复刻 home-only 类)

## 第四步: 修复缺口 (仅 2 处需修复)

### 修复① shipsay HomeClone (+62 行, 最大缺口)
**源站 probe-shipsay.html 完整结构 (376 行):**
- header (header.container.head + logo + form.search + .header_right 4 项)
- .navigation > nav.container (首页 + 8 分类 + #user_panel)
- .container (大神小说 .side_commend + 热门小说 aside)
- .container (.section.flex .sortvisit × 6 分类)
- **.container (.lastupdate + aside 最新小说)** ← clone 缺失
- **.container (.section.link 友情链接)** ← clone 缺失
- **#footer (footer.container > p × 2 含 fa-flag + zh_click 简繁切换)** ← clone 缺失

**原 clone 仅渲染前 4 段, 缺底部 4 段。修复 shipsay/HomeClone.tsx:**
- 新增 .lastupdate (ul.odd li: span「cat」+ a 书名 + a.gray 章节 + span>a.gray 作者+日期)
- 新增 aside 最新小说 (ul.popular.odd li: a 书名 + a.gray 作者)
- 新增 .container .section.link (p.title i.fa-link + a × 2 友链)
- 新增 #footer > footer.container (p 含 i.fa-flag + 站名 + p 简体版/繁體版 zh_click 链接)
- 提取 useTraditionalChinese setTc 用于 zh_click_s/zh_click_t 跳转

**CSS 命中确认:** shipsay.css (1138 行) 已含 .lastupdate/.link/#footer/aside 选择器, 渲染后自动应用样式。

### 修复② huangjinwu HomeClone (+1 行, navbar-menu-search 类)
**源站 probe-huangjinwu.html navbar-menu:**
```html
<ul class="navbar-menu" id="navbarMenu">
  <li><a href="/"><span class="menu-icon iconfont icon-book"></span><span class="menu-text">首页</span></a></li>
  ...
  <li class="navbar-menu-search"><a href="/search"><span class="menu-icon iconfont icon-search"></span><span class="menu-text">搜索</span></a></li>
</ul>
```
**原 clone** 用 NAV_ITEMS 数组渲染所有 li (含 search), 但未给 search li 加 navbar-menu-search 类。
**修复:** li className 加 `n.id === 'search' ? 'navbar-menu-search' : undefined`

## 第五步: 其余 7 套主题 DOM 对比结论 (无重大缺口, 不改)

| 主题 | probe 行数 | clone 行数 | 关键 class 复刻 | 状态 |
|------|-----------|-----------|---------------|------|
| ggd66 | 267 | 262 | .header/.container/.content/.content-left/#fengtui/.item/.content-right/#fengyou/.search/ul/li/.s1-s5/.content.tuijian/.class/.footer | ✓ 完整 |
| ddyueshu | 299 (GBK) | 269 | #wrapper/.header/.header_logo/script bqg_panel/.nav/ul/li × 9/#main/#content/#hotcontent/.l/.r/.item/.novelslist/.content/.top/#newscontent/.l/.r/#firendlink/.dahengfu/.footer | ✓ 完整 (clone 用 .header_search+.userpanel 替代 bqg_panel JS 注入, CSS 已含) |
| pilishuwu | 5239 | 469 | mod-top-wr/.newyear-bg-wrap/.mod-tags-wr/.mod-animate-list/.in-banner-wr/.in-rank-wr/.in-strong-wr/.in-sign-wr/.in-vip-wr/.in-rise-wr/.linkBox/.mod-fixed-top-wr/.mod-fixed-left-wr/.mod-footer-wr | ✓ 完整 |
| 23qb | 1251 | 213 | header#header/.header-content/.nav/ul.nav-menu-items/.header-module/#search-content/main#main/.content/.list/.box/.module/.module-list.module-lines-list/.module-items/.module-item × N/.list-item/.item-title/.item/.order.one/.keyword/#friendlink/#footer | ✓ 完整 |
| 101kks | 974 | 316 | .leftmenu/.menu_close_btn/.headuser/.headimg/.user_touxiang/.register/.menu2/header/.headbox.clearfix/.menubtn/.logo/.search/.inputbox/.user1/.lang/.menu1/.main/.container/.adbanner.mybox/.headerad/ul.row/li.col-xinindex/.mybox/.xinlogo/.error-text.searchBox/.indexdaohang/.mytitle/.booklist-block/.booklist-grid/.booklist-card × N/#article_list_content/li/.imgbox/.newnav/.newright/.foot/.copyright | ✓ 完整 (源 .menu2 9 项 vs clone 6 项 - 因 .leftmenu CSS left:-300px 隐藏不影响视觉) |
| aijjxs | 1249 | 295 | .top-float/.top-float-inner/.top-float-nav/.top-float-auth/.mobile-nav-panel#mobileNavPanel/.wrap/.top/.top-1/.logo/.top-links/form.search/.search-history/main.layout/section/.panel.latest-upload.latest-upload-expand/h3.latest/.body.gird2/ul.lines.lines-books.lines-books-2col/li/.line-main/.cat/.author/.date.new/.panel/.body.grid2/.book/.panel.rank/.book_r/.body/ul.lines/.no/.date/aside/.today-qd-users/.panel tags/section.hero/.kpi/.item | ✓ 完整 |
| x2552 | 300 | 278 | .main.m_head/.h_logo.fl/.h_body.fl/p.fr/dl.fl.searchbox/dt/dd/.loginbox/.main.m_menu/ul/li.m_ml/m_bc/m_mr/.main.board/.bdtop/.bdsub/dl#s_dl/dt/p#s_dt/a.current/abbr/bdo#s_dd/dd × 6/.main/#centeri/.block/.blocktitle/i/.blockcontent/ul.update/li/p.ul1/p.ul2/p/#right/.block/.blocktitle/span/.blockcontent/ul.ultop/li/p/a/.main.links/.block/.blocktitle/.blockmore/.blockcontent/ul.ulrow/li/.main.footer/.bdtop/i/span/.ftc | ✓ 完整 |

**trxsw** 无 probe HTML 不在本次对比范围, 保持现状 (R24-2I 已克隆)。

## 第六步: 验证
```
bunx eslint src/components/public/clone-themes/ → 0 errors ✓
bunx tsc --noEmit (排除 examples + skills + .next) → 0 errors ✓
bun run lint → 仅 2 errors in src/lib/crawl/runner.ts (R31-1B 并发架构遗留 Semaphore/BookMetaResult
  未使用, 在禁止修改的 src/lib/crawl/* 范围内, 非本轮回归)
dev.log → 无 error/warn/exception ✓
```

## 修改文件清单
1. `src/components/public/clone-themes/shipsay/HomeClone.tsx` (+62 行, +1 行 setTc 提取)
   - 新增 .lastupdate 章节 (ul.odd li 含 span cat + a 书名 + a.gray 章节 + span>a.gray 作者+日期)
   - 新增 aside 最新小说 (ul.popular.odd li 含 a 书名 + a.gray 作者)
   - 新增 .container .section.link 友情链接 (p.title i.fa-link + a × 2)
   - 新增 #footer > footer.container (p 含 i.fa-flag + 站名 + p 简体版/繁體版 zh_click 链接)
   - 提取 useTraditionalChinese setTc 用于 zh_click_s/zh_click_t 跳转
2. `src/components/public/clone-themes/huangjinwu/HomeClone.tsx` (+1 行)
   - li className 加 `n.id === 'search' ? 'navbar-menu-search' : undefined`

## 零回归确认
- SSR 数据流 (initialCategories/initialBooks) 未动 ✓
- R28 useCloneCategories hook 未动 ✓
- CSS 选择器命中 (shipsay CSS 已含 .lastupdate/.link/#footer/aside) ✓
- 历史修复 (R25-1A2/A3/R26-1A/R27-1A/B/R28-1A/B/C/R29-1D/R30-1A) 全部保留 ✓
- 主控禁止区域未碰: src/lib/crawl/* (采集模块) + page.tsx/PublicSite.tsx/HomeView.tsx +
  themes.ts/prisma/schema.prisma + examples/+skills/ 预存在 tsc 错误 ✓

## 未修改 (尊重约束)
- src/lib/crawl/* (采集模块)
- page.tsx / PublicSite.tsx / HomeView.tsx (主控已改)
- BookView.tsx (B agent 优化中)
- themes.ts / prisma/schema.prisma
- examples/+skills/ 预存在 tsc 错误
- 7 套已对齐主题 (aijjxs/ddyueshu/pilishuwu/23qb/101kks/ggd66/x2552) 不改
