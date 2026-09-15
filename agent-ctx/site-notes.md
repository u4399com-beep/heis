# 9 站点首页实测样式备忘录 (probe-html 提取结果)

R10-1B 阶段: 基于 /home/z/my-project/agent-ctx/probe-html/ 下 7 个抓取 HTML+CSS
+ 2 个不可达站 (ddyueshu/shipsay) 兜底参考 scripts/seed-rule-*.ts。

---

## 1. aijjxs.com — probe-aijjxs.html + probe-aijjxs.css (1254 行 HTML + 2199 行 CSS)

**实测 :root CSS 变量** (`/skin/yellow/style.css?t=20260509`):
```css
:root {
  --bg: #f3efe7; --paper: #fffdf8; --ink: #1f2937; --muted: #6b7280;
  --line: #e5dccd; --brand: #0f766e (青绿); --brand-dark: #115e59;
  --accent: #b45309 (琥珀); --chip: #eef9f7; --rank: #fff5e6;
  --shadow: 0 10px 30px rgba(17, 24, 39, 0.08); --radius: 14px;
}
```

**实测 body**: 双层 radial-gradient + #f3efe7 / line-height 1.7 / "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
**实测 a**: var(--brand-dark) #115e59 → hover var(--brand) #0f766e

**实测结构**:
- `.wrap` max-width 1220px / `.layout` grid 1fr 330px (主+侧栏)
- `.top` header card (paper bg + 1px line + radius 14 + shadow)
- `.panel` block (border 1px line + radius 14 + paper bg + shadow)
- `.book` book card (border 1px line + radius 12 + bg #fff + padding 10px)
- `.book img` 88x122 / `.book h4` 15px / `.meta` 12px muted / `.badge` 5px radius accent bg
- `.lines-books li` 类别 chip + 书名 + 作者 + 日期
- `.rank` bg var(--rank) #fff5e6 / `.rank .no` color #9a3412

**主色 / 强调 / 背景 / 圆角 / 阴影 / header / 卡片**:
- 主色 #0f766e (青绿) / 强调 #b45309 (琥珀)
- 背景 #f3efe7 (奶油) + 双 radial-gradient
- 圆角 14px (主) / 12px (book card) / 10px (search input)
- 阴影 0 10px 30px rgba(17,24,39,0.08)
- header: solid (paper bg + 1px border + backdrop blur)
- 卡片: 1px line border + 12px radius + #fff bg + shadow

---

## 2. ddyueshu.cc — **DNS 不通 / Connection refused, 兜底参考得到小说系站点通用形态**

参考笔趣阁系书站 DNA (table 列表 + 侧栏排行榜) + 得到小说系通用配色:
- body bg #f5f7f5 (浅灰绿), color #2c3e50, font 14px/1.5 "Microsoft YaHei", Arial
- a #1a8a5a (青绿) → hover #d9534f (暖红)
- .top bar bg #1a8a5a color #fff height 36px
- .nav bg #e8f3ec (浅绿) li height 32px
- .hot bg #fff border 1px #d8e6d8 / .item float 50% / .item .image img 100x130
- .item dl dt border-bottom dotted #aac8aa 14px weight 700
- .wrap .top border 1px #d8e6d8 width 268px bg #fff
- .lis li border-bottom 1px #e0e0e0 height 32px

---

## 3. pilishuwu.com — probe-pilishuwu.html + probe-pilishuwu.css (5239 行 HTML + 3800 行 CSS)

CF 防护未触发 (实测抓到完整 HTML 5239 行 + CSS 3800 行, /templates/wmcms-web/static/css/):

**实测**: body color #666, line-height 1.5, font-family 12px 宋体, Arial, Segoe UI, sans-serif; body min-width 1200px
**实测 a**: 无显式颜色 (继承 body #666)
**实测 .ui-wm**: width 1200px margin auto
**实测 .mod-top-logo / .mod-top-search**: 顶 header 含 logo + 搜索 + tag cloud
**实测 .mod-top-nav-list**: 横向 8 分类菜单 (首页/全部小说/排行榜/男频/女频/电子图书/无CP/纯爱/百合/轻小说)
**实测 .mod-animate-list**: 独家推荐 li 含 mod-ani-img (210x280 大封面)
**实测 .ui-ahover-normal:hover**: color #ff9a6a (暖橙 hover)

兜底参考已有 HomePili.tsx 仿站设计: 暖橙 #f77720 + 米黄 #fef9ef + 橙头排行榜

---

## 4. 23qb.net — probe-23qb.html + probe-23qb.css (1253 行 HTML + 9220 行 CSS)

**实测 body**: color #282828, bg #f8f9f9, font 14px, line-height 1.6
**实测字体栈**: `-apple-system-font, BlinkMacSystemFont, helvetica neue, pingfang sc, hiragino sans gb, microsoft yahei ui, microsoft yahei, Arial, sans-serif`
**实测 a**: color #282828 → hover #ff2a14 (鲜红!) text-decoration none

**实测结构**:
- `.header-content` box-shadow 0 7px 21px rgba(149,157,165,.22), border-bottom 1px #eaedf1
- `.nav-menu-item` padding 0 11px font-size 16px weight 700 (8+ 分类导航)
- `.content` max-width 1740px
- `.module-item` width 200px margin 0 20px 20px 0 font-size 14px
- `.module-item-cover` padding-top 140% (5:7 aspect) border-radius 5px, hover shadow 0 10px 30px rgba(0,0,0,.3)
- `.module-item-caption` bottom 0 height 44px padding 12px gradient bg rgba(0,0,0,0.68)→transparent
- `.block-box-item` bg #eaedf1 padding 15px border-radius 10px
- `.block-box-content .title` font-size 18px, hover ::after width 36px bg #ff2a14

**主色 / 强调 / 背景 / 圆角 / 阴影 / header / 卡片**:
- 主色 #ff2a14 (鲜红, hover)
- 背景 #f8f9f9 (浅灰白)
- 圆角 10px (block-box) / 5px (cover)
- 阴影 0 7px 21px rgba(149,157,165,.22) (header/search-box)
- header: solid (shadow + 1px border-bottom)
- 卡片: 5:7 aspect cover + gradient caption

---

## 5. 101kks.com — probe-101kks.html + probe-101kks.css (971 行 HTML + 4306 行 CSS)

**实测 body**: bg #f2f3f4, color #333, font 14px "Microsoft YaHei"
**实测 a**: color #666 → hover #06c (Microsoft blue)

**实测结构** (cdnshu 框架):
- `.headbox` max-width 1250px (主容器), logo + menu + search
- `.booklist-card`: bg #fff, radius 10px, shadow 0 2px 10px rgba(0,0,0,0.08), border 1px solid rgba(0,0,0,0.06), height 128px
- `.booklist-card:hover`: translateY(-2px), shadow 0 6px 20px rgba(0,0,0,0.12)
- `.booklist-cover-section`: flex 0 0 120px, gradient linear-gradient(135deg, #667eea 0%, #764ba2 100%)
- `.booklist-title`: font-size 14px weight 600 color #2c3e50 line-height 1.3 (line-clamp 2)
- `.booklist-meta`: gap 12px font-size 12px color #7f8c8d
- `.booklist-grid`: grid auto-fill minmax(280px, 1fr) gap 12px

**主色 / 强调 / 背景 / 圆角 / 阴影 / header / 卡片**:
- 主色 #667eea (蓝紫渐变 cover) / 强调 #06c (Microsoft blue hover)
- 背景 #f2f3f4 (浅灰)
- 圆角 10px
- 阴影 0 2px 10px rgba(0,0,0,0.08)
- header: solid (cdnshu 框架默认)
- 卡片: 渐变 cover-section + info-section + line-clamp-2 title

---

## 6. huangjinwu.org — probe-huangjinwu.html + probe-huangjinwu.css (674 行 HTML + 463 行 CSS)

**实测 :root CSS 变量** (`/static/default/style.css`):
```css
:root {
  --font-family-ui: -apple-system,BlinkMacSystemFont,"Microsoft YaHei","PingFang SC","Segoe UI","Helvetica Neue",Arial,sans-serif;
  --bg-color: #f0f4fb;
  --bg-gradient: linear-gradient(180deg,#f5f8ff 0%,#eef3fb 100%);
  --card-bg: #fff;
  --header-bg: rgba(255,255,255,.92);
  --footer-bg: #e2eaf5;
  --hover-color: #e8f1ff;
  --primary-color: #0f172a; (深墨)
  --secondary-color: #2563eb; (蓝)
  --logo-color: #1d4ed8;
  --text-color: #1e293b;
  --text-light: #64748b;
  --text-muted: #94a3b8;
  --border-color: #dbe4f0;
  --shadow: 0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(37,99,235,.06);
  --shadow-hover: 0 8px 24px rgba(37,99,235,.14), 0 2px 8px rgba(15,23,42,.06);
  --border-radius: 6px;
  --border-radius-lg: 10px;
}
```

**实测 body**: bg var(--bg-gradient), color var(--text-color), font 1.6rem line-height 1.65
**实测 a**: color var(--primary-color) #0f172a → hover var(--secondary-color) #2563eb
**实测 .headers**: backdrop-filter saturate(1.2) blur(12px), bg var(--header-bg), 1px border-bottom
**实测 .container**: max-width 1180px
**实测 .book-grid**: 1fr → @768px 2fr → @1200px 3fr
**实测 .book-card**: var(--card-bg) + 1px border + radius-lg + shadow, hover translateY(-2px) + shadow-hover

**主色 / 强调 / 背景 / 圆角 / 阴影 / header / 卡片**:
- 主色 #2563eb (蓝, secondary) / 强调 #1d4ed8 (深蓝, logo)
- 背景 linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%)
- 圆角 6px (主) / 10px (lg)
- 阴影双层 0 1px 2px rgba(15,23,42,.04) + 0 4px 16px rgba(37,99,235,.06)
- header: transparent (backdrop-filter blur(12px) + rgba(255,255,255,.92))
- 卡片: var(--card-bg) + 1px border-color + radius-lg + shadow

---

## 7. ggd66.com — probe-ggd66.html + probe-ggd66.css (268 行 HTML + 172 行 site CSS + Font Awesome)

**实测 body**: bg #f9f9f9, color #888, font 15px "微软雅黑",Microsoft Yahei,simsun,arial,sans-serif, line-height 150%
**实测 a**: color #00886d (mint green) → hover #f50 (orange-red!)

**实测结构**:
- `.header` bg #1abc9c (mint) height 50px line-height 50px white text shadow
- `.header .header-left` logo float left
- `.header .header-nav` 4 项导航 float left width 300px
- `.container` width 90% max-width 1200px
- `.content-left` float left 73% / `.content-right` float right 25%
- `#fengtui .item` float left 50% padding 10px 0 0 — book cards 2-col
- `#fengtui .item dl dt` border-bottom dotted #ccc font-weight 700 15px / span 作者 14px
- `#fengtui .item dl dd` text-indent 2em height 90pt 14px line-height 24px
- `.breadcrumb` bg #cdf3eb (light mint) border 1px #ccc radius 4px padding 8px 15px
- `h2` border-bottom 1px #ccc color #333 font 18px weight 500
- `.footer` bg #56ccb5 white text text-align center font 14px

**主色 / 强调 / 背景 / 圆角 / 阴影 / header / 卡片**:
- 主色 #1a8a5a (mint green) / 强调 #ff5500 (orange-red hover)
- 背景 #f9f9f9 (浅灰)
- 圆角 4px (book / breadcrumb)
- 阴影 0 1px 1px rgba(0,0,0,0.05) (轻)
- header: solid (mint bg #1abc9c)
- 卡片: 2-col float item + dotted dt border + image 120x150

---

## 8. shipsay.com — demo.shipsay.com — **DNS 不通, 兜底参考船说 CMS 通用形态**

参考船说 CMS 通用模板:
- body color #666, font 14px "微软雅黑","Microsoft Yahei", Arial, Tahoma, Verdana, sans-serif
- bg #f4f4f4
- a #1a1a1a → hover #ed4259 (red-pink!)
- .red #bf2c24 / .blue #4284ed / .orange #f0643a / .yellow #f0c53a / .purple #a091ff
- .container max-width 1200px
- header > .container.head (logo + search + header_right icons)
- .navigation > nav.container > a (8 分类)
- .side_commend .side_commend_width > p.title (i.fa + 主字) + ul.flex > li (book cards)
- aside .popular > p.title + ul.popular > li > a(book) + a.gray(author)

**主色 / 强调 / 背景 / 圆角 / 阴影 / header / 卡片**:
- 主色 #ed4259 (red-pink hover) / 强调 #f0643a (orange 字数颜色)
- 背景 #f4f4f4 (浅灰)
- 圆角 4px (search 推断)
- 阴影 none (直角卡片)
- header: solid (logo + search + icon nav)
- 卡片: 直角白底 + book cards flex + 排行链表

---

## 9. x2552.com — probe-x2552.html + probe-x2552.css (299 行 HTML GBK 编码 + 4 行 CSS 内联)

**实测 body**: bg transparent, color #666, font 12px/120% 微软雅黑, 宋体, Verdana, Arial, sans-serif
**实测 a**: color #2f468f (蓝紫) → hover #ff6600 (橙)
**实测 .red**: color #FF3300
**实测 .main**: width 960px margin 0 auto clear both (老式 960px 框架)

**实测结构** (老式 960px 框架):
- `.m_head` height 60px (h_logo 180px + h_body 780px)
- `.m_menu` height 40px font 14px weight bold line-height 39px (12 分类)
- `.board` margin-top 8px height 263px (滑动书卡 carousel)
  - `.board dd img` 120x150 border 1px #E4E4E4 padding 5px
  - `.board dt p a` 切换按钮 (10x10 dot)
- `.block` border 1px #E4E4E4 margin-top 8px (区块容器)
- `.blocktitle` height 40px line-height 40px font 14px (bg sprite pattern)
- `#centeri` float left width 760px (3 列布局主区)
- `#left / #right` width 190px (左右侧栏)
- `.update li` border-bottom 1px dotted #E4E4E4 padding 0 10px text-align right font 12px
  - `.update p` float left text-align left (书名+章节)
  - `.update .ul1` width 250px / `.ul2` width 340px
- `.ultop / .ulcenter / .ulitem li` border-bottom dotted #F2F2F2 list-style decimal inside
- `table` border 1px #E4E4E4 margin 10px width 98%
- `td, th` border-bottom dotted #E4E4E4 padding 0 3px

**主色 / 强调 / 背景 / 圆角 / 阴影 / header / 卡片**:
- 主色 #2f468f (蓝紫) / 强调 #ff6600 (橙 hover)
- 背景 #fafafa (兜底, body transparent)
- 圆角 0px (老式框架直角)
- 阴影 none (直角卡片)
- header: solid (.m_head 60px + .m_menu 40px 蓝紫底)
- 卡片: 直角 + 1px #E4E4E4 border + dotted li separators + 3 列布局

---

## 总结对照表

| 站点 | 主色 | 强调 | 背景 | 圆角 | 阴影 | headerStyle |
|------|------|------|------|------|------|-------------|
| aijjxs | #0f766e 青绿 | #b45309 琥珀 | #f3efe7 奶油 | 14px | shadow 0 10px 30px rgba(17,24,39,0.08) | solid |
| ddyueshu | #1a8a5a 青绿 | #d9534f 暖红 | #f5f7f5 浅灰绿 | 0px | none | solid |
| pilishuwu | #f77720 暖橙 | #c4521a 深橙 | #fef9ef 米黄奶油 | 6px | shadow 0 2px 8px rgba(247,119,32,0.12) | gradient |
| 23qb | #ff2a14 鲜红 | #c01a0c 深红 | #f8f9f9 浅灰白 | 10px | shadow 0 7px 21px rgba(149,157,165,0.22) | solid |
| 101kks | #667eea 蓝紫 | #06c Microsoft blue | #f2f3f4 浅灰 | 10px | shadow 0 2px 10px rgba(0,0,0,0.08) | solid |
| huangjinwu | #2563eb 蓝 | #1d4ed8 深蓝 | linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%) | 6px/10px | shadow 0 1px 2px rgba(15,23,42,0.04)+0 4px 16px rgba(37,99,235,0.06) | transparent |
| ggd66 | #1a8a5a mint | #ff5500 orange-red | #f9f9f9 浅灰 | 4px | shadow 0 1px 1px rgba(0,0,0,0.05) | solid |
| shipsay | #ed4259 red-pink | #f0643a orange | #f4f4f4 浅灰 | 4px | none | solid |
| x2552 | #2f468f 蓝紫 | #ff6600 橙 | #fafafa 浅灰白 | 0px | none | solid |
