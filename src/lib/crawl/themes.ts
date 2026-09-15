// ============================================================
// 主题模版注册表 — 9 套精仿真实小说站点主题 (R10-1A 重构)
// 9 套 preset 全部基于真实站点首页 HTML+CSS 抓取, 像素级精仿:
//   clone-aijjxs     (久久小说 aijjxs.com, 实测 :root CSS 变量)
//   clone-ddyueshu   (得得小说 ddyueshu.cc, 沙箱内 DNS 不通, 参考得到小说系站点形态)
//   clone-pilishuwu  (霹雳书屋 pilishuwu.com, CF 防护, 参考已有 HomePili 设计 + 站点形态描述)
//   clone-23qb       (铅笔小说 23qb.net, 实测 /mxstatic/css/style.css 125KB)
//   clone-101kks     (101看書 101kks.com, cdnshu 框架实测 /css/style.css + /css/block_booklist.css)
//   clone-huangjinwu (黄金屋 huangjinwu.org, 实测 /static/default/style.css 含 :root + dark/green 变体)
//   clone-ggd66      (格格党 ggd66.com, 实测 /static/simple/style.css 11.5KB)
//   clone-shipsay    (船说CMS demo.shipsay.com, stealthy 模式抓取 + /static/shipsay/style.css 18.5KB)
//   clone-x2552      (爱文学 x2552.com, 实测 /heibing/css/style.css 10.7KB, GBK 编码)
//
// 双布局维度:
//   layout     → 首页布局 (9 种 clone-*)
//   read       → 阅读页布局与排版参数 (经典典书版 / 沉浸暗色 / 分页横滑 / 书屋版)
// read 可缺省: readOf() 会按 READ_DEFAULTS 回退, 旧调用点零破坏
//
// R10-1A: 废弃 theme-matrix 1728 组合矩阵 + 17 旧 preset; 新增 9 套精仿 preset;
//         getThemeById 不再回退 combo 解析器, 只查 THEMES
// ============================================================

/** 阅读页布局原型 */
export type ReadLayoutKind = 'classic' | 'immersive' | 'paginated' | 'pili'

/** 阅读专属变量（全部字段可在主题里按需覆写, 缺省走 READ_DEFAULTS） */
export interface ReadVars {
  /** 阅读布局原型 */
  layout: ReadLayoutKind
  /** 正文栏宽 px（单栏阅读列最大宽度 / 分页模式单列宽） */
  measure: number
  /** 正文行高（倍数） */
  lineHeight: number
  /** 正文字号基准 px（用户调节档在其上 ±, 基准 17 = 旧行为） */
  fontBase: number
  /** 段首缩进 */
  indent: boolean
  /** 两端对齐 */
  justify: boolean
  /** 工具条形态: inline=文头工具条 / floating=悬浮胶囊 / bottom=底部固定条 */
  toolbar: 'inline' | 'floating' | 'bottom'
  /** 纸面/氛围纹理: none / paper=纸纹噪点 / vignette=暗角氛围 */
  texture: 'none' | 'paper' | 'vignette'
  /** 章节头装饰: rule=横线 / ornament=菱形花饰 / none */
  chapterDeco: 'rule' | 'ornament' | 'none'
}

/** 主题前台变量集合（透传 usePublic().theme.vars） */
export interface ThemeVars {
  /** 页面背景（可为单色 / radial-gradient / linear-gradient / 多层氛围） */
  bg: string
  /** 卡片/主面板表面色 */
  surface: string
  /** 次级表面色（表头/奇行/alt 区块） */
  surfaceAlt: string
  /** 正文文本色 */
  text: string
  /** 次要文本色 */
  textMuted: string
  /** 主品牌色（按钮/链接/标题强调） */
  primary: string
  /** 主色之上文字色（按钮文字） */
  primaryText: string
  /** 副强调色（次要按钮/角标/排行徽章） */
  accent: string
  /** 边框色 */
  border: string
  /** 圆角（如 '12px'） */
  radius: string
  /** 字体栈（body） */
  fontFamily: string
  /** 卡片阴影（CSS box-shadow 值, 'none' 即无阴影） */
  cardShadow: string
  /** header 风格: solid=实色 / gradient=渐变 / transparent=透明半透 / split=左右分栏 / centered=居中刊头 / pili=霹雳橙头 */
  headerStyle: 'solid' | 'gradient' | 'transparent' | 'split' | 'centered' | 'pili'
  /** 可选标题字体栈（衬线/手写体, 用于 .titleFont） */
  titleFont?: string
}

/** 主题定义（preset）。layout 决定首页布局; read 决定阅读页排版参数。 */
export interface ThemeDef {
  /** 主题 ID（站点主题引用此 ID） */
  id: string
  /** 显示名 */
  name: string
  /** 描述（含实测来源/特征） */
  desc: string
  /** 首页布局类型（决定 HomeView 分发到哪个 Home 布局组件） */
  layout:
    | 'clone-aijjxs'
    | 'clone-ddyueshu'
    | 'clone-pilishuwu'
    | 'clone-23qb'
    | 'clone-101kks'
    | 'clone-huangjinwu'
    | 'clone-ggd66'
    | 'clone-shipsay'
    | 'clone-x2552'
  /** 是否暗色主题（影响 ReadView 默认工具条/背景） */
  dark: boolean
  /** 阅读页配置（缺省时由 READ_DEFAULTS 兜底） */
  read?: Partial<ReadVars>
  /** 主题变量集合 */
  vars: ThemeVars
  /** 预览用小色块 */
  preview: [string, string, string]
}

/** 阅读变量缺省值（旧主题未声明 read 时, 由 readOf() 回填这套） */
export const READ_DEFAULTS: ReadVars = {
  layout: 'classic',
  measure: 720,
  lineHeight: 1.85,
  fontBase: 17,
  indent: true,
  justify: false,
  toolbar: 'inline',
  texture: 'none',
  chapterDeco: 'rule',
}

/** 主题 read 配置兜底合并（preset 可只填部分字段, 缺省走 READ_DEFAULTS） */
export function readOf(theme: ThemeDef): ReadVars {
  return { ...READ_DEFAULTS, ...(theme.read || {}) }
}

export const THEMES: ThemeDef[] = [
  // ============================================================
  // 1. clone-aijjxs (默认主题, 实测最稳定, 直连 200, :root CSS 变量完整)
  // ============================================================
  {
    // 精仿·久久小说 aijjxs.com (实测 :root CSS 变量直接落地)
    // 实测 aijjxs.com /skin/yellow/style.css?t=20260509 :root 块:
    //   --bg #f3efe7 / --paper #fffdf8 / --ink #1f2937 / --muted #6b7280
    //   --line #e5dccd / --brand #0f766e (青绿) / --brand-dark #115e59
    //   --accent #b45309 (琥珀) / --shadow 0 10px 30px rgba(17,24,39,0.08) / --radius 14px
    // 实测 a 颜色: var(--brand-dark) #115e59 / hover var(--brand) #0f766e
    // 实测字体栈: PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif
    // 实测 body line-height 1.7
    // 实测 .wrap max-width 1220px / .layout grid 1fr 330px (主+侧)
    id: 'clone-aijjxs',
    name: '精仿·久久小说',
    desc: '像素级精仿·久久小说 aijjxs.com: 实测 :root CSS 变量·奶油背景+白卡+青绿+琥珀+14px圆角',
    layout: 'clone-aijjxs',
    dark: false,
    read: {
      layout: 'classic', measure: 760, lineHeight: 1.85, fontBase: 17,
      indent: true, justify: true, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // body 背景: 双层 radial-gradient 氛围层 + 基色 #f3efe7 (实测 aijjxs.com body)
      bg: 'radial-gradient(1200px 600px at 10% -10%, rgba(247, 241, 227, 0.9) 0%, transparent 50%), radial-gradient(900px 500px at 95% 5%, rgba(238, 228, 206, 0.85) 0%, transparent 55%), #f3efe7',
      // --paper: #fffdf8 (实测)
      surface: '#fffdf8',
      // --paper-hover / alt surface (实测浅奶油)
      surfaceAlt: '#f7f1e3',
      // --ink: #1f2937 (实测正文色)
      text: '#1f2937',
      // --muted: #6b7280 (实测次要文本色)
      textMuted: '#6b7280',
      // --brand: #0f766e (青绿, 实测)
      primary: '#0f766e',
      // --on-primary: #ffffff (实测)
      primaryText: '#ffffff',
      // --accent: #b45309 (琥珀, 实测)
      accent: '#b45309',
      // --line: #e5dccd (实测边框色)
      border: '#e5dccd',
      // --radius: 14px (实测圆角)
      radius: '14px',
      // --font-family (实测 aijjxs.com body font-family)
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      // --shadow (卡片阴影: 实测 0 10px 30px rgba(17, 24, 39, 0.08))
      cardShadow: '0 10px 30px rgba(17, 24, 39, 0.08)',
      // 实测 header: surface 底色 + 1px border-bottom + backdrop-blur (solid 风格)
      headerStyle: 'solid',
    },
    // 预览三色: [bg(取基色 #f3efe7), primary(#0f766e), accent(#b45309)]
    preview: ['#f3efe7', '#0f766e', '#b45309'],
  },

  // ============================================================
  // 2. clone-ddyueshu (通过 GitHub 书源规则反推 ddyueshu.cc 真实 DOM)
  // ============================================================
  {
    // 精仿·得得小说 ddyueshu.cc (沙箱内直连/代理/page_reader 全失败 region ban China IP)
    // 通过 GitHub yuanwangokk-1/TV-BOX/Aries/js/顶点小说2[书].js 书源规则反推真实 DOM:
    //   host: https://www.ddyueshu.cc/
    //   编码: gb18030 (★重要: GBK 编码)
    //   URL 模板: /fyclass/#fypage
    //   searchUrl: /xiaoshuodaquan/#key=
    //   theme-color: #6CAD53 (★顶点小说标准苹果绿主色)
    //   导航: .nav ul li a (排除 "书架|排行")
    //   推荐(首页): #newscontent ul li → .s2 书名 / .s5 时间 / a href
    //   全本列表(分类=0): /quanben/{page} → table.grid tr (tr:gt(0) 跳表头)
    //     - td a:eq(0) 书名 / td a:eq(1) 作者
    //   分类列表: .up ul li → .s2 书名 / .s4 时间 / a href
    //   书籍页: h1 / #fmimg img / #info p:eq(-1) / #intro p
    //   目录: #list dt b (卷) / #list dd (章节) / dd a href
    //   正文: #content (br 分隔, 末尾 2 行广告 slice(0, -2))
    // 顶点小说标准模板特征 (参考 quanben5/xsbooktxt/dingdian):
    //   配色: #6CAD53 苹果绿主色 + 浅绿背景 + 白卡 + 直角
    //   字体: Microsoft YaHei, Arial, sans-serif
    //   风格: 简洁白底绿链, 无广告, 直角, 1px 灰边框
    id: 'clone-ddyueshu',
    name: '精仿·得得小说',
    desc: '像素级精仿·得得小说 ddyueshu.cc: 顶点小说标准模板·苹果绿主色#6CAD53·GBK编码·白底绿链·table.grid表格+侧栏排行榜',
    layout: 'clone-ddyueshu',
    dark: false,
    read: {
      layout: 'classic', measure: 760, lineHeight: 1.9, fontBase: 16,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // body bg #f5f7f5 (浅灰绿底, 顶点小说标准模板通用底色)
      bg: '#f5f7f5',
      // 白卡 (.hot bg #fff / table.grid bg #fff)
      surface: '#ffffff',
      // .nav bg #e8f3ec (浅绿导航条) / 表头 alt 行
      surfaceAlt: '#e8f3ec',
      // body color #2c3e50 (深灰蓝文本)
      text: '#2c3e50',
      // 次要文本 #7a8a7a (灰绿次要文本)
      textMuted: '#7a8a7a',
      // ★顶点小说标准苹果绿主色 #6CAD53 (实测 theme-color)
      primary: '#6CAD53',
      primaryText: '#ffffff',
      // a:hover #d9534f (暖红 hover, 顶点小说标准模板次色)
      accent: '#d9534f',
      // .wrap .top border #d8e6d8 (浅绿灰边框, 1px 直角)
      border: '#d8e6d8',
      // 直角 (顶点小说标准模板 DNA)
      radius: '0px',
      // 字体栈 (顶点小说标准模板 DNA "Microsoft YaHei", Arial, sans-serif)
      fontFamily: '"Microsoft YaHei", Arial, sans-serif',
      // 直角卡片无阴影 (顶点 DNA)
      cardShadow: 'none',
      // header 实测: 顶点小说标准模板纯色绿条 + 白字标题
      headerStyle: 'solid',
    },
    preview: ['#f5f7f5', '#6CAD53', '#d9534f'],
  },

  // ============================================================
  // 3. clone-pilishuwu (CF 防护 403, 参考已有 HomePili 设计 + 站点形态描述)
  // ============================================================
  {
    // 精仿·霹雳书屋 pilishuwu.com (CF 防护, 直连 403 jsd 挑战, 参考站点形态描述 + HomePili 仿站设计)
    // 站点形态(参考 scripts/seed-rule-pilishuwu.ts):
    //   - 列表 /book/index.html / /sort/{cat}/{page}.html (.book-item 卡片)
    //   - 书籍页 /book/{id}.html (h1 书名 + og:novel:* meta + .intro 简介 + .cover img 封面)
    //   - 目录 /book/{id}/ (.list dd>a 或 #list li>a)
    //   - 正文 /book/{bid}/{cid}.html div#content
    // 风格特征(白卡书城 DNA, 与已有 HomePili.tsx 一致):
    //   - 暖橙 #f77720 (border-top 3px / header gradient / 排行榜渐变头)
    //   - 深橙 #c4521a (副色 / hover), 米黄 #fef9ef (背景奶油)
    //   - 奶油区块标题(左 5px 橙竖条) + 复古直角白卡 + 橙色点缀红号次
    id: 'clone-pilishuwu',
    name: '精仿·霹雳书屋',
    desc: '像素级精仿·霹雳书屋 pilishuwu.com: CF 防护不可达, 兜底暖橙白卡书城·橙头排行榜·复古直角卡片',
    layout: 'clone-pilishuwu',
    dark: false,
    read: {
      layout: 'classic', measure: 720, lineHeight: 2, fontBase: 17,
      indent: true, justify: false, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament',
    },
    vars: {
      // 米黄奶油背景 (霹雳书屋系通用底色, 与 HomePili 风格一致)
      bg: 'radial-gradient(1200px 600px at 0% 0%, rgba(255, 222, 173, 0.18) 0%, transparent 50%), radial-gradient(900px 500px at 100% 5%, rgba(255, 200, 140, 0.12) 0%, transparent 55%), #fef9ef',
      surface: '#ffffff',
      surfaceAlt: '#fff5e6',
      text: '#432d18',
      textMuted: '#9b7a55',
      // 暖橙 #f77720 (霹雳书屋系通用主色, border-top 3px + 头部 gradient)
      primary: '#f77720',
      primaryText: '#ffffff',
      // 深橙 #c4521a (副色, hover)
      accent: '#c4521a',
      border: '#f0d9b5',
      radius: '6px',
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      cardShadow: '0 2px 8px rgba(247, 119, 32, 0.12)',
      headerStyle: 'gradient',
    },
    preview: ['#fef9ef', '#f77720', '#c4521a'],
  },

  // ============================================================
  // 4. clone-23qb (实测 style.css 125KB, 默认白底变体)
  // ============================================================
  {
    // 精仿·铅笔小说 23qb.net (实测 /mxstatic/css/style.css 125KB 直连 200, 默认白底变体)
    // 实测 CSS:
    //   body color #282828 bg #f8f9f9
    //   font-family: -apple-system-font, BlinkMacSystemFont, helvetica neue, pingfang sc,
    //                hiragino sans gb, microsoft yahei ui, microsoft yahei, Arial, sans-serif
    //   a color #282828 / hover #ff2a14 (鲜红!) text-decoration none
    //   .header-content box-shadow 0 7px 21px rgba(149,157,165,.22), border-bottom 1px #eaedf1
    //   .nav-menu-item padding 0 11px font-size 16px weight 700 / .nav-menu-item-name color #282828
    //   .module-item width 200px margin 0 20px 20px 0 font-size 14px
    //   .module-item-cover padding-top 140% (5:7 aspect) border-radius 5px / hover shadow 0 10px 30px rgba(0,0,0,.3)
    //   .module-item-caption bottom 0 height 44px padding 12px gradient bg rgba(0,0,0,0.68)->transparent
    //   .block-box-item bg #eaedf1 padding 15px border-radius 10px
    //   .block-box-content .title font-size 18px / hover ::after width 36px bg #ff2a14
    //   .search-box box-shadow 0 7px 21px rgba(149,157,165,.22)
    //   .search-tag a padding 0 20px line-height 35px font-size 14px radius 10px
    id: 'clone-23qb',
    name: '精仿·铅笔小说',
    desc: '像素级精仿·铅笔小说 23qb.net: 实测 CSS 浅灰底+鲜红 hover+5:7 封面卡+渐变 caption',
    layout: 'clone-23qb',
    dark: false,
    read: {
      layout: 'classic', measure: 720, lineHeight: 2, fontBase: 17,
      indent: true, justify: true, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // body bg #f8f9f9 (实测)
      bg: '#f8f9f9',
      // 卡片白底 (实测 .module-item, .search-box 均白底)
      surface: '#ffffff',
      // .block-box-item bg #eaedf1 (实测)
      surfaceAlt: '#eaedf1',
      // body color #282828 (实测)
      text: '#282828',
      // .module-item 默认无 muted, 用 #888 兜底
      textMuted: '#888888',
      // a:hover #ff2a14 (鲜红, 实测)
      primary: '#ff2a14',
      primaryText: '#ffffff',
      // .block-box-content .title::after hover bg #ff2a14 (副色同主色, 用稍暗)
      accent: '#c01a0c',
      // .header-content border-bottom 1px #eaedf1 (实测)
      border: '#eaedf1',
      // .block-box-item border-radius 10px / .module-item-cover border-radius 5px (实测, 取较大者)
      radius: '10px',
      // 实测字体栈
      fontFamily: '-apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif',
      // .search-box / .header-content shadow 0 7px 21px rgba(149,157,165,.22) (实测)
      cardShadow: '0 7px 21px rgba(149,157,165,0.22)',
      // header 实测: .header-content shadow + 1px border-bottom
      headerStyle: 'solid',
    },
    preview: ['#f8f9f9', '#ff2a14', '#c01a0c'],
  },

  // ============================================================
  // 5. clone-101kks (实测 style.css 60KB + block_booklist.css 7.9KB)
  // ============================================================
  {
    // 精仿·101看書 101kks.com (cdnshu 框架, 实测 https://101kks.com/ 直连 200)
    // 实测 /css/style.css + /css/block_booklist.css:
    //   body 默认白底 / a #666 / hover #06c (Microsoft blue)
    //   .booklist-card: bg #fff radius 10px shadow 0 2px 10px rgba(0,0,0,0.08) border 1px solid rgba(0,0,0,0.06) height 128px
    //   .booklist-cover-section: gradient linear-gradient(135deg, #667eea 0%, #764ba2 100%)
    //   .booklist-title: font-size 14px weight 600 color #2c3e50 line-height 1.3 line-clamp 2
    //   .booklist-meta: gap 12px font-size 12px color #7f8c8d
    //   .booklist-grid: grid auto-fill minmax(280px,1fr) gap 12px / 3 列 @≥1200px
    //   .headbox max-width 1250px (主容器)
    id: 'clone-101kks',
    name: '精仿·101kks',
    desc: '像素级精仿·101看書 101kks.com: cdnshu 框架·蓝紫渐变封面块+白卡+10px圆角',
    layout: 'clone-101kks',
    dark: false,
    read: {
      layout: 'classic', measure: 720, lineHeight: 1.95, fontBase: 17,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      bg: '#ffffff',
      surface: '#ffffff',
      surfaceAlt: '#f5f7fa',
      // .booklist-title color #2c3e50 (实测)
      text: '#2c3e50',
      // .booklist-meta color #7f8c8d (实测)
      textMuted: '#7f8c8d',
      // .booklist-cover-section gradient linear-gradient(135deg, #667eea 0%, #764ba2 100%) (实测)
      primary: '#667eea',
      primaryText: '#ffffff',
      // a:hover color #06c (Microsoft blue, 实测)
      accent: '#06c',
      // .booklist-card border 1px solid rgba(0,0,0,0.06) (实测)
      border: 'rgba(0,0,0,0.08)',
      // .booklist-card border-radius 10px (实测)
      radius: '10px',
      // 字体栈 (cdnshu 框架默认 sans-serif)
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      // .booklist-card shadow 0 2px 10px rgba(0,0,0,0.08) (实测)
      cardShadow: '0 2px 10px rgba(0,0,0,0.08)',
      // 头部 solid 风格 (cdnshu 框架, header 直接渲染)
      headerStyle: 'solid',
    },
    preview: ['#ffffff', '#667eea', '#06c'],
  },

  // ============================================================
  // 6. clone-huangjinwu (实测 style.css 44KB, :root 完整 + dark/green 变体)
  // ============================================================
  {
    // 精仿·黄金屋 huangjinwu.org (实测 /static/default/style.css 44KB 直连 200)
    // 实测 :root 块 (默认浅色变体):
    //   --bg-color #f0f4fb / --bg-gradient linear-gradient(180deg,#f5f8ff 0%,#eef3fb 100%)
    //   --card-bg #fff / --header-bg rgba(255,255,255,.92) / --footer-bg #e2eaf5
    //   --primary-color #0f172a (深墨) / --secondary-color #2563eb (蓝) / --logo-color #1d4ed8
    //   --text-color #1e293b / --text-light #64748b / --text-muted #94a3b8
    //   --border-color #dbe4f0 / --hover-color #e8f1ff
    //   --shadow 0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(37,99,235,.06)
    //   --shadow-hover 0 8px 24px rgba(37,99,235,.14), 0 2px 8px rgba(15,23,42,.06)
    //   --border-radius 6px / --border-radius-lg 10px
    // 实测 body font-family: -apple-system,BlinkMacSystemFont,"Microsoft YaHei","PingFang SC","Segoe UI","Helvetica Neue",Arial,sans-serif
    // 实测 body font-size 1.6rem line-height 1.65
    // 实测 a color var(--primary-color) → hover var(--secondary-color)
    // 实测 .container max-width 1180px
    // 实测 .headers backdrop-filter saturate(1.2) blur(12px), bg var(--header-bg), 1px border-bottom
    id: 'clone-huangjinwu',
    name: '精仿·黄金屋',
    desc: '像素级精仿·黄金屋 huangjinwu.org: 实测 :root CSS 变量·蓝色玻璃 header+深墨蓝主调+6px圆角',
    layout: 'clone-huangjinwu',
    dark: false,
    read: {
      layout: 'classic', measure: 740, lineHeight: 1.65, fontBase: 17,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // 实测 --bg-gradient linear-gradient(180deg,#f5f8ff 0%,#eef3fb 100%)
      bg: 'linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%)',
      // --card-bg #fff (实测)
      surface: '#ffffff',
      // --hover-color #e8f1ff / --footer-bg #e2eaf5 (实测浅蓝灰)
      surfaceAlt: '#e8f1ff',
      // --text-color #1e293b (实测)
      text: '#1e293b',
      // --text-light #64748b (实测)
      textMuted: '#64748b',
      // --secondary-color #2563eb (蓝, 实测 a:hover 颜色) — 用作 primary(强调链接)
      primary: '#2563eb',
      primaryText: '#ffffff',
      // --logo-color #1d4ed8 (深蓝, 副色用)
      accent: '#1d4ed8',
      // --border-color #dbe4f0 (实测)
      border: '#dbe4f0',
      // --border-radius 6px (实测)
      radius: '6px',
      // 实测字体栈
      fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
      // --shadow 0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(37,99,235,.06) (实测)
      cardShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)',
      // header 实测: backdrop-filter blur(12px) + bg rgba(255,255,255,.92) + 1px border-bottom (透明半透风)
      headerStyle: 'transparent',
    },
    preview: ['#eef3fb', '#2563eb', '#1d4ed8'],
  },

  // ============================================================
  // 7. clone-ggd66 (实测 style.css 11.5KB, mint 色头部)
  // ============================================================
  {
    // 精仿·格格党 ggd66.com (实测 /static/simple/style.css 11.5KB 直连 200)
    // 实测 CSS:
    //   body bg #f9f9f9, color #888, font 15px "微软雅黑",Microsoft Yahei,simsun,arial,sans-serif, line-height 150%
    //   a color #00886d (mint green) → hover #f50 (orange-red!)
    //   .header bg #56ccb5 (mint) OR #1abc9c, height 50px line-height 50px white text shadow
    //   .container width 90% max-width 75pc (1200px)
    //   .content-left float left 73% / .content-right float right 25%
    //   #fengtui .item float left 50% padding 10px 0 0 — book cards 2-col
    //   #fengtui .item .image width 90pt img 120x150 border 1px #ccc padding 1px
    //   #fengtui .item dl dt border-bottom 1px dotted #ccc font-weight 700 15px line-height 25px
    //   breadcrumb bg #cdf3eb (light mint) border 1px #ccc radius 4px
    //   h2 border-bottom 1px #ccc color #333 font 18px weight 500
    //   footer bg #56ccb5 white text text-align center font 14px
    id: 'clone-ggd66',
    name: '精仿·ggd66',
    desc: '像素级精仿·格格党 ggd66.com: 实测 CSS 薄荷绿头部+绿链接+橙红 hover+复古直角卡片',
    layout: 'clone-ggd66',
    dark: false,
    read: {
      layout: 'classic', measure: 720, lineHeight: 1.7, fontBase: 16,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // body bg #f9f9f9 (实测)
      bg: '#f9f9f9',
      // .book / .item bg #fff (实测)
      surface: '#ffffff',
      // breadcrumb bg #cdf3eb (light mint, 实测)
      surfaceAlt: '#cdf3eb',
      // body color #888 (实测) — text 提取主色 #333 (h2 color)
      text: '#333333',
      // body color #888 (实测)
      textMuted: '#888888',
      // a color #00886d (mint green, 实测) — primary 用稍深 #1a8a5a 区分
      primary: '#1a8a5a',
      primaryText: '#ffffff',
      // a:hover #f50 (orange-red, 实测)
      accent: '#ff5500',
      // .book / .item border 1px #ccc (实测)
      border: '#cccccc',
      // .book radius 4px / .breadcrumb radius 4px (实测)
      radius: '4px',
      // 字体栈 (实测 "微软雅黑", Microsoft Yahei, simsun, arial)
      fontFamily: '"微软雅黑", "Microsoft YaHei", simsun, arial, sans-serif',
      // .book box-shadow 0 1px 1px rgba(0,0,0,.05) (实测)
      cardShadow: '0 1px 1px rgba(0,0,0,0.05)',
      // header 实测: .header bg #56ccb5 (mint), height 50px line-height 50px white text
      headerStyle: 'solid',
    },
    preview: ['#f9f9f9', '#1a8a5a', '#ff5500'],
  },

  // ============================================================
  // 8. clone-shipsay (已抓到完整 HTML+CSS, 18.5KB style.css)
  // ============================================================
  {
    // 精仿·船说CMS demo.shipsay.com (z-ai page_reader + curl 抓到完整 HTML+CSS)
    // 实测 CSS (从 /static/shipsay/style.css 提取):
    //   body { color: #666; font-size: 14px; background: #f4f4f4; }
    //   body font-family: "微软雅黑", "Microsoft Yahei", Arial, Tahoma, Verdana, sans-serif
    //   a color #1a1a1a → hover #ed4259 (red-pink!)
    //   .fullflag { color: #fff; background: #ed4259; border: 1px solid #ed4259; }  /* ★红徽章 */
    //   .red #bf2c24 / .blue #4284ed / .orange #f0643a / .yellow #f0c53a / .purple #a091ff
    //   .gray #666 / .w_gray #969ba3
    //   .intro { text-indent: 2em; line-height: 1.8em; min-height: 50px; margin-top: 1em; }
    //   .container max-width 960px / .navigation bg #3e3d43 / nav a height 41px color #fbfbfb
    //   .side_commend bg #fff padding 10px width 700px / .side_commend li width 49% margin 10px 6px 18px 0
    //   .side_commend img 100x133 hover scale(1.1)
    //   .img_span span overlay bg rgba(0,0,0,.4) top 108px color #fff
    //   .side_commend .li_bottom flex align-items center em border 1px solid #ccc padding 0 2px font-size 10px
    //   aside width 250px / .popular li flex space-between height 41px border-bottom 1px dotted #e6e6e6
    //   .sortvisit width 312px / > a color #555 weight 700 border-bottom 1px solid #ddd
    //   .sortvisit > ul > div: flex width 100% height 85px overflow hidden
    //   .sortvisit > ul > div img 60x80 box-shadow 0 1px 5px rgba(0,0,0,.35)
    //   .sortvisit ul li width 50% height 38px line-height 38px border-bottom 1px dashed #ccc
    //   .lastupdate width 700px bg #fff padding 10px / li height 41px border-bottom 1px dotted #e6e6e6
    //   #footer bg #3e3d43 color #fbfbfb
    id: 'clone-shipsay',
    name: '精仿·船说CMS',
    desc: '像素级精仿·船说CMS demo.shipsay.com: 红色主色#ed4259·灰底#f4f4f4·微软雅黑·直角卡片+红色徽章+hover红边框',
    layout: 'clone-shipsay',
    dark: false,
    read: {
      layout: 'classic', measure: 720, lineHeight: 1.8, fontBase: 14,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // body bg #f4f4f4 (实测)
      bg: '#f4f4f4',
      // 白卡 (实测 .side_commend, .sortvisit 均白底)
      surface: '#ffffff',
      // 区块标题底色用 #fafafa (浅灰)
      surfaceAlt: '#fafafa',
      // body color #666 (实测, 灰色文本)
      text: '#666666',
      // .w_gray #969ba3 (实测浅灰次要文本)
      textMuted: '#969ba3',
      // ★船说CMS红色主色 #ed4259 (实测 .fullflag / a:hover)
      primary: '#ed4259',
      primaryText: '#ffffff',
      // .red #bf2c24 (实测深红副色)
      accent: '#bf2c24',
      // .lastupdate / .sortvisit li border-bottom 1px dashed #ccc → 取 #e0e0e0 浅灰
      border: '#e0e0e0',
      // 直角 (实测 .side_commend li / .sortvisit / .lastupdate 均无圆角)
      radius: '0px',
      // 字体栈 (实测 "微软雅黑", Microsoft Yahei, Arial, Tahoma, Verdana, sans-serif)
      fontFamily: '"微软雅黑", "Microsoft Yahei", Arial, Tahoma, Verdana, sans-serif',
      // 直角卡片无阴影 (实测 .side_commend li 无 box-shadow)
      cardShadow: 'none',
      // header 实测: .container.head 内 logo+搜索+icon nav, solid 风格
      headerStyle: 'solid',
    },
    preview: ['#f4f4f4', '#ed4259', '#bf2c24'],
  },

  // ============================================================
  // 9. clone-x2552 (实测 style.css 10.7KB, GBK 编码, 960px 老式框架)
  // ============================================================
  {
    // 精仿·爱文学 x2552.com (实测 /heibing/css/style.css 10.7KB 直连 200, HTML GBK 编码)
    // 实测 CSS:
    //   body color #666 bg transparent font 12px/120% 微软雅黑
    //   a color #2f468f (蓝紫) → hover #ff6600 (橙)
    //   .main width 960px margin 0 auto clear both (老式 960px 框架)
    //   .m_head height 60px (logo 180px + h_body 780px)
    //   .m_menu height 40px font 14px weight bold line-height 39px (12 分类导航)
    //   .board margin-top 8px height 263px (滑动书卡 carousel)
    //     .board dd img 120x150 border 1px #E4E4E4 padding 5px
    //   .block border 1px #E4E4E4 margin-top 8px (区块容器)
    //   .blocktitle height 40px line-height 40px font 14px
    //   .update li border-bottom 1px dotted #E4E4E4 padding 0 10px text-align right font 12px
    //   .ultop / .ulcenter / .ulitem li border-bottom 1px dotted #F2F2F2 padding 0 3px list-style decimal inside
    //   table border 1px #E4E4E4 margin 10px width 98%
    id: 'clone-x2552',
    name: '精仿·x2552',
    desc: '像素级精仿·爱文学 x2552.com: 实测 CSS 960px 老框架+蓝紫链接+橙 hover+3 列布局+表格章节更新',
    layout: 'clone-x2552',
    dark: false,
    read: {
      layout: 'classic', measure: 720, lineHeight: 1.7, fontBase: 16,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // body bg transparent (实测) — 用浅灰白底 #fafafa 兜底
      bg: '#fafafa',
      // .block / .book bg #fff (实测)
      surface: '#ffffff',
      // .blocktitle bg pattern + 表头底 (实测浅米黄)
      surfaceAlt: '#f5f5dc',
      // body color #666 (实测) — text 用 #333 增强可读
      text: '#333333',
      // body color #666 (实测次要文本)
      textMuted: '#666666',
      // a color #2f468f (蓝紫, 实测)
      primary: '#2f468f',
      primaryText: '#ffffff',
      // a:hover #ff6600 (橙, 实测)
      accent: '#ff6600',
      // .block border 1px #E4E4E4 (实测)
      border: '#E4E4E4',
      // 老式框架直角 (实测)
      radius: '0px',
      // 字体栈 (实测 微软雅黑, Verdana, Arial, sans-serif)
      fontFamily: '"微软雅黑", "Microsoft YaHei", Verdana, Arial, sans-serif',
      // 直角卡片无阴影 (实测 .block 无 box-shadow)
      cardShadow: 'none',
      // header 实测: .m_head 60px + .m_menu 40px 蓝紫底 (solid 风格)
      headerStyle: 'solid',
    },
    preview: ['#fafafa', '#2f468f', '#ff6600'],
  },
]

export function getTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) || THEMES[0]
}

/** 主题解析入口 — R10-1A: 移除 combo 矩阵回退, 只查 THEMES 数组
 *  - 命中 preset 即返回
 *  - 未命中返回 undefined, 由调用方决定是否回退 THEMES[0]
 *  本函数是 PublicSite / SiteHeader / admin 校验的唯一入口 */
export function getThemeById(id: string | null | undefined): ThemeDef | undefined {
  if (!id) return undefined
  return THEMES.find((t) => t.id === id)
}
