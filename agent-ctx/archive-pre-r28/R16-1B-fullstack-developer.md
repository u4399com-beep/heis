# R16-1B 工作记录 — fullstack-developer (子代理)

> Task ID: **R16-1B**
> 任务: 4 站点 clone-themes 真正 1:1 克隆 + 18 种 SEO TDK 预设 + 章节SEO TDK 随机刷新按钮

## 阶段成果

### 部分 1 — 4 站点 clone-themes 真正 1:1 克隆 (16 文件, ~1700 行 LoC)

#### ggd66 (格格党, static/simple 模板)
- **源站数据**: `public/clone-css/ggd66.css` + `agent-ctx/probe-html2/probe-ggd66.html`
- **实测颜色**: body bg #f9f9f9 / .header bg #1abc9c (50px 高) / .footer bg #56ccb5 / a #00886d / h2 border-bottom #ccc / .container 90%/max 1200px
- **DOM 结构**:
  - `.header` (.header-left logo + .header-right 阅读/登录/注册 + .header-nav 4 项: 首 页/书 库/全本/搜索)
  - `.container` 第一行 .content: #fengtui .content-left 73% 6 卡 (热门小说推荐, 每卡 .image 120x150 + dl dt 作者+书名 + dd 简介 4 行截断) + #fengyou .content-right 25% (search 表单 + 阅读排行榜 14 li)
  - 第二行 .content: #zuixin .content-right 25% 30 li 最新小说 + #gengxin .content-left 73% 30 li 最近更新 (s1[类别]/s2[书名]/s3[最新章]/s4[作者]/s5[时间])
  - .content.tuijian 友链 + .footer
- **文件**: HomeClone.tsx (230 行) + BookInfo.tsx (120 行) + CategoryList.tsx (95 行) + ReadChrome.tsx (75 行)

#### shipsay (船说CMS, static/shipsay 模板)
- **源站数据**: `public/clone-css/shipsay.css` + `agent-ctx/probe-html2/probe-shipsay.html`
- **实测颜色**: max-width 960px / a #1a1a1a / a:hover #ed4259 / .gray #666 / .head bg #fff / .navigation bg #3e3d43 / .lastupdate .odd 表格 / .l_btn bg #bf2c24 / .read_nav bg #FBF6EC 60px 高 / .text_title padding 40px 64px
- **DOM 结构**:
  - `header > .container.head` (#logo 1.5em span + p 域名 #bf2c24 / form .search_input + #search_btn bg #bf2c24 / .header_right 4 图标 首页/书库/完本/足迹)
  - `.navigation > nav.container` 9 项 (首页 + 8 分类: 玄幻/武侠/都市/历史/科幻/游戏/女生/其他)
  - 第 1 个 `.container`: `.side_commend .side_commend_width` 700px (大神小说 ul.flex 6 li .img_span 100x133 + .w100 h2/p.indent/.li_bottom) + `aside` 250px (热门小说 ul.popular.odd 12 li)
  - 第 2 个 `.container`: `.section.flex` 6 个 `.sortvisit` 分类区块 (每区块 1 主图 + 12 列表 li)
  - 第 3 个 `.container`: `.lastupdate` 700px 30 li 最新章节 (4 段: 类别/书名/最新章/作者+时间) + `aside` 250px 30 li 最新小说
  - 第 4 个 `.container`: `.section.link` 友情链接 (2 链接) + `#footer` bg #3e3d43
- **BookInfo**: 用 `.novel_info_main` (BookCover 120x160 float:left + .novel_info_title h1 24px + p span 标签 + meta + .l_btn/.l_btn_0 行动按钮) + `.intro` + `.ulcard .act` 章节入口
- **ReadChrome**: 用 `main.container` (max-width 900px) + `.text_title` (h1.style_h1 24px + .text_info span) + `#article` 18px 行高 1.8em + `.read_nav` 60px (目录/上一章/下一章 三段等宽)
- **文件**: HomeClone.tsx (290 行) + BookInfo.tsx (130 行) + CategoryList.tsx (110 行) + ReadChrome.tsx (75 行)

#### x2552 (吾爱文学网, heibing 模板)
- **源站数据**: `public/clone-css/x2552.css` + `agent-ctx/probe-html2/probe-x2552.html`
- **实测颜色**: 960px wide / body font 12px/120% / a #2f468f / a:hover #ff6600 / .m_menu 蓝渐变 (#4a78c4→#2f468f) 40px 高 / .bdtop bg #D9EDFF border #33CCFF / .blocktitle bg #2f468f 文字 #fff 40px / .pagelink bg #F2F2F2 strong #ff6600 / .update .ul1 250px .ul2 340px
- **DOM 结构**:
  - `.main.m_head` 60px: .h_logo 180px (logo 24px) + .h_body 780px (5 顶部链接 简体/繁体/设为首页/联系我们/加入收藏 + form .searchbox dt 260px input + dd .so_book/.so_author + .loginbox 欢迎您,[登录]或[注册])
  - `.main.m_menu` 40px: ul li 12 项 (吾爱首页/玄幻魔法/武侠修真/都市言情/历史军事/侦探推理/网游动漫/科幻小说/恐怖灵异/文学名著/其他/全本) + .m_bc 书架 absolute
  - 公告条 (1px solid #E4E4E4 color red)
  - `.main.board` 263px: .bdtop 2px + .bdsub + dl#s_dl dt (排行榜标题) + abbr bdo#s_dd 6 dd 轮播 (每 dd: a BookCover 120x150 + br + a 书名)
  - `.main`: #centeri 760px (block 吾爱小说网最近更新 30 li .ul1/.ul2 + li.more 更多) + #right 190px (2 block 吾爱总推荐榜 15 + 吾爱最新小说 20, 每 li: p 推荐/日期 + a 书名)
  - `.main.links` 友链 (3 链接) + `.main.footer` (.bdtop + .ftc 吾爱文学网无弹窗 + Copyright)
- **BookInfo**: 用 `#a_main` dt (封面 120x160 + h1 22px + meta p + .btnlinks .read #FF6600 立即阅读) + `#contents` padding 25 行高 26 简介
- **CategoryList**: 用 `table.grid` 表格 (类别/书名+最新章/作者/更新) + `.pagelink` 分页 (bg #F2F2F2 strong #ff6600 当前页) + #right 分类侧栏 11 项
- **ReadChrome**: 用 h1 章节名 (20px 居中 行高 65px) + `#contents` padding 25 行高 26 + `.pagelink` (上一页/目录/下一页)
- **文件**: HomeClone.tsx (295 行) + BookInfo.tsx (145 行) + CategoryList.tsx (145 行) + ReadChrome.tsx (90 行)

#### trxsw (同人小说网, 域名已过期, 反查 DOM)
- **源站数据**: `public/clone-css/trxsw.css` (CSS 变量风格, 现代简洁)
- **CSS 变量**: --bg #f5f7fa / --surface #fff / --text #333 / --muted #888 / --primary #2c7be5 / --primary-dark #1a5fb4 / --border #e0e6ed / --radius 4px
- **DOM 反查 (AiraBrowser)**: `.headline` 区块标题 + `.vlist` 列表 (li > a) + `.detail` flex (封面 img + .name/.author/.intro/.stats) + `.intro` 简介 + `.content` 正文 max-width 800px + `.pager` 翻页 a
- **DOM 结构**:
  - `header` (.container: logo 22px + nav 8 项 + form 搜索 240px)
  - `.container` 第一段: `.headline` 热门推荐 (h2 + 4px 高 #2c7be5 左边条) + grid auto-fill minmax(160px,1fr) 6 卡 (BookCover 3:4 + 书名 14/600 + 作者 12/888 + 类别 badge #e8f1ff + 字数)
  - `.container` 第二段: `.headline` 最新更新 (grid 1fr 280px) + `.vlist` 16 li (类别 badge + 书名 + 最新章 + 日期) + aside 排行榜 10 li (前 3 名带编号 badge 渐变)
  - `footer` (logo + 关于/地图/声明 链接 + Copyright)
- **BookInfo**: 用 `.detail` flex (BookCover 120x160 + .name 22px + .author a + meta 行 + 行动按钮 立即阅读/章节目录/TXT 下载) + `.intro` .headline 内容简介 + 章节目录入口
- **CategoryList**: 用 `.headline` (标签+总数) + `.vlist` li (类别 badge + 书名 + 章节 + 作者 + 日期) + `.pager` 分页 (上一页/当前页/共X页/下一页)
- **ReadChrome**: 用 `.content` max-width 800px (面包屑 + h1 22px 居中 + #content 16px 行高 2 + .pager 翻页)
- **文件**: HomeClone.tsx (195 行) + BookInfo.tsx (125 行) + CategoryList.tsx (110 行) + ReadChrome.tsx (85 行)

### 部分 2 — auto-tdk.ts 新增 18 种 SEO TDK 预设 (~240 行)

#### 新增类型
- `TDKPresetId` (18 值联合类型): classic-seo / keyword-rich / question-form / list-style / brand-first / chapter-focus / category-first / author-first / download-focus / read-online / latest-chapter / complete-status / word-count / pinyin-style / mobile-seo / social-share / long-tail / minimal
- `TDKPreset` 接口: { id, name, titleTemplate, descTemplate, keywordsTemplate }
- `TDKRenderContext` 接口 (10 字段): bookName / author / category / chapterTitle / siteName / wordCount / status / latestChapter / page / totalPages

#### 18 预设模板 (每个 3 个模板: title/desc/keywords)
1. **classic-seo**: `{bookName} {chapterTitle} - {siteName}` (经典 SEO)
2. **keyword-rich**: 关键词堆砌 (bookName/author/category/chapterTitle 在线阅读 + 长尾关键词)
3. **question-form**: 疑问式 (`怎么样?好看吗?`)
4. **list-style**: `Top{page}/{totalPages} |` 列表式进度
5. **brand-first**: `{siteName} -` 品牌优先
6. **chapter-focus**: `{chapterTitle} - 《{bookName}》by {author}` 章节聚焦
7. **category-first**: `{category}小说 -` 分类优先
8. **author-first**: `{author}作品 -` 作者优先
9. **download-focus**: `TXT下载` 下载导向
10. **read-online**: `在线阅读` 在线阅读导向
11. **latest-chapter**: `最新章节` 最新章节导向
12. **complete-status**: `{bookName} {status}` 完结状态导向
13. **word-count**: `({wordCount})` 字数导向
14. **pinyin-style**: 拼音风格 (作者+分类小说大全)
15. **mobile-seo**: 移动 SEO (短标题 `{chapterTitle} - {bookName} {siteName}`)
16. **social-share**: `📖 {bookName} | {chapterTitle} | {siteName}` 社交分享
17. **long-tail**: 长尾词 (bookName/author/category/chapterTitle/status/wordCount/latestChapter 全堆)
18. **minimal**: 极简 `{bookName} {chapterTitle}`

#### 4 个工具函数
- `getTDKPreset(id)`: 按 ID 取预设, 不存在时 fallback 到 classic-seo
- `getRandomTDKPreset()`: 随机选 1 个预设 (Math.random)
- `renderTDKByPreset(presetId, ctx)`: 按预设渲染 TDK → TDKResult
- `randomCombineTDK()`: 从 18 预设独立采样 title/desc/keywords 各 1 次 (3 个独立采样, 可互不相同), 返回 { presetId, titleTemplate, descTemplate, keywordsTemplate, sourcePresets: { title, desc, keywords } }

#### 内部函数
- `renderTemplate(tpl, ctx)`: 替换 10 个占位符 + 自动转 status 为 已完结/连载中 + formatWordCount 字数格式化 (1234567 → 123万字)

#### 模板字数格式优化 (5 处)
- 模板里用 `共{wordCount}` 替代 `{wordCount}字` 避免 formatWordCount 已带 "字" 造成的 "字字" 重复
- 影响预设: keyword-rich / category-first / author-first / download-focus / complete-status / social-share / long-tail
- smoke 测试: 18 预设全部渲染正确, 0 处 "字字" 重复 ✓

### 部分 3 — SitesSection.tsx 章节SEO TDK 卡片新增"随机刷新"按钮 (~25 行)

#### 修改
- 新增 import: `Sparkles` (lucide-react) + `randomCombineTDK` (`@/components/public/auto-tdk`)
- 新增 `randomRefreshSeoTDK()` 方法: 调用 `randomCombineTDK()` 取组合 → `setForm` 关闭 `chapterSeoAuto` + 填入 3 个模板 (slice 500) + `toast.success` 显示来源 preset ID (title←X / desc←Y / keywords←Z)
- 在章节 SEO TDK 卡片头部右侧 (与"自动生成" Switch 同行) 新增 Button:
  - variant="outline" size="sm" h-7
  - className: border-emerald-700/60 bg-emerald-950/40 px-2 text-[11px] text-emerald-200 hover:bg-emerald-900/60
  - icon: `<Sparkles className="h-3 w-3" />`
  - 文本: "随机刷新"
  - title 提示: "从 18 种 SEO 预设中随机组合 title/desc/keywords 模板并填入下方输入框"
- 同步扩展标题模板 Label 占位符提示: 从 5 个 (`{bookName} {chapterTitle} {page} {totalPages} {siteName}`) 扩展到 10 个 (新增 `{author} {category} {wordCount} {status} {latestChapter}`)

## 验证

### TypeScript 严格检查
- `bunx tsc --noEmit` (排除 examples/skills): **0 errors** ✓
- `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` (排除 examples/skills): **0 errors** ✓
  - 首次发现 shipsay/BookInfo.tsx BookCover unused import (用 `<img>` 标签替代) → 已改用 `<BookCover>` ✓

### ESLint
- `bun run lint`: **exit 0** (0 errors / 0 warnings) ✓

### dev server 主题预览
- 4 套新主题全部 200 OK: clone-ggd66 / clone-shipsay / clone-x2552 / clone-trxsw ✓
- 10 套主题全量回归 200 OK: clone-aijjxs / clone-ddyueshu / clone-pilishuwu / clone-23qb / clone-101kks / clone-huangjinwu + 上述 4 新 ✓
- dev.log 无 error/warn

### auto-tdk smoke 测试 (bunx tsx -e)
```js
TDK_PRESETS.length = 18 ✓
ids = classic-seo,keyword-rich,question-form,list-style,brand-first,chapter-focus,category-first,author-first,download-focus,read-online,latest-chapter,complete-status,word-count,pinyin-style,mobile-seo,social-share,long-tail,minimal ✓
missing = NONE ✓
getTDKPreset("classic-seo") = "{bookName} {chapterTitle} - {siteName}" ✓
getTDKPreset("nonexistent") falls back to = classic-seo ✓
getRandomTDK = keyword-rich | {bookName} {author} {category} {chapterTitle} 在线阅读 - {siteName} ✓
renderTDKByPreset('keyword-rich', {bookName: '万相之王', author: '天蚕土豆', category: '玄幻', chapterTitle: '第1章', siteName: '测试站', wordCount: 1234567, status: 'ongoing', latestChapter: '第100章', page: 1, totalPages: 5}):
  T: 万相之王 天蚕土豆 玄幻 第1章 在线阅读 - 测试站 ✓
  D: 万相之王由天蚕土豆创作, 属于玄幻小说, 当前章节第1章。共123万字, 连载中, 提供万相之王全文免费阅读, 找万相之王最新章节就到测试站。 ✓
  K: 万相之王, 天蚕土豆, 玄幻, 第1章, 万相之王最新章节, 万相之王在线阅读, 万相之王txt下载, 万相之王全文, 测试站 ✓
randomCombineTDK() = { presetId, titleTemplate, descTemplate, keywordsTemplate, sourcePresets: {title, desc, keywords} } ✓
```
- 18 预设 0 处 "字字" 重复 ✓

## 修改文件清单 (16+2=18 文件)

### 16 个 clone-themes 组件 (4 站点 × 4 文件)
1. `src/components/public/clone-themes/ggd66/HomeClone.tsx` (25 行占位 → 230 行 1:1 克隆)
2. `src/components/public/clone-themes/ggd66/BookInfo.tsx` (12 行占位 → 120 行 1:1 克隆)
3. `src/components/public/clone-themes/ggd66/CategoryList.tsx` (29 行占位 → 95 行 1:1 克隆)
4. `src/components/public/clone-themes/ggd66/ReadChrome.tsx` (18 行占位 → 75 行 1:1 克隆)
5. `src/components/public/clone-themes/shipsay/HomeClone.tsx` (25 行占位 → 290 行 1:1 克隆)
6. `src/components/public/clone-themes/shipsay/BookInfo.tsx` (12 行占位 → 130 行 1:1 克隆)
7. `src/components/public/clone-themes/shipsay/CategoryList.tsx` (29 行占位 → 110 行 1:1 克隆)
8. `src/components/public/clone-themes/shipsay/ReadChrome.tsx` (18 行占位 → 75 行 1:1 克隆)
9. `src/components/public/clone-themes/x2552/HomeClone.tsx` (25 行占位 → 295 行 1:1 克隆)
10. `src/components/public/clone-themes/x2552/BookInfo.tsx` (12 行占位 → 145 行 1:1 克隆)
11. `src/components/public/clone-themes/x2552/CategoryList.tsx` (29 行占位 → 145 行 1:1 克隆)
12. `src/components/public/clone-themes/x2552/ReadChrome.tsx` (18 行占位 → 90 行 1:1 克隆)
13. `src/components/public/clone-themes/trxsw/HomeClone.tsx` (25 行占位 → 195 行 1:1 克隆)
14. `src/components/public/clone-themes/trxsw/BookInfo.tsx` (12 行占位 → 125 行 1:1 克隆)
15. `src/components/public/clone-themes/trxsw/CategoryList.tsx` (29 行占位 → 110 行 1:1 克隆)
16. `src/components/public/clone-themes/trxsw/ReadChrome.tsx` (18 行占位 → 85 行 1:1 克隆)

### 2 个其他文件
17. `src/components/public/auto-tdk.ts` (225 行 → 462 行, +237 行: 18 预设 + 4 函数 + 3 类型)
18. `src/components/admin/SitesSection.tsx` (767 行 → 794 行, +27 行: import + randomRefreshSeoTDK 方法 + 随机刷新 Button + 占位符提示扩展 5→10)

## 不修改的内容 (尊重约束)
- 不动 R14 已落地的 10 套主题 preset (`themes.ts`)
- 不动 R16-1A 已完成的 6 站点 (aijjxs/ddyueshu/pilishuwu/23qb/101kks/huangjinwu) 1:1 克隆
- 不动 `BookInfoLayout.tsx` (10 套 BookInfo 变体分发)
- 不动 `HomeView.tsx` dynamic() 导入链
- 不动 `PublicSite.tsx` (theme 预览覆盖逻辑)
- 不动 `BookCover` / `bits` / `ctx` / `shared.ts` 接口
- 不动 R9-0 已落地的章节 SEO TDK 卡片结构 (只新增 1 个按钮, 不重构)
- 仅替换 4 套 clone-themes 的占位实现为真正 1:1 克隆 + 扩展 auto-tdk.ts (新增 18 预设, 不改原有函数签名)
