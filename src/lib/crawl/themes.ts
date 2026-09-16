// ============================================================
// 主题模版注册表 — 10 套精仿真实小说站点主题 (R14-1A 全量重克隆含子页面 DOM)
// 前 9 套基于 agent-ctx/probe-html2/probe-<site>.{html,css} + probe-<site>-{book,chapter,category}.html
// 抓取真实 HTML+CSS+子页面 DOM 摘要, 像素级精仿 (CSS 变量、字体栈、配色、圆角、阴影、DOM 结构、
// 章节正文选择器均与原站一致):
//   clone-aijjxs     (久久小说 aijjxs.com, 实测 :root CSS 变量, 双层 radial-gradient, book/chapter 子页 DOM 已抓)
//   clone-ddyueshu   (得得小说 ddyueshu.cc, GBK 编码, 宋体 12px, 浅蓝底 #E9FAFF, 天蓝头 #88C6E5)
//   clone-pilishuwu  (霹雳书屋 pilishuwu.com, wmcms-web 模板, 暖橙 #fd8929 / 红 #d71704, 直角 2px, 子页 DOM 已抓)
//   clone-23qb       (铅笔小说 23qb.net, 浅灰底 + 鲜红 hover #ff2a14, 5px 圆角, 5:7 封面卡; 子页 CF 拦截)
//   clone-101kks     (101看書 101kks.com, 繁体, 米黄头 #fff2df, 10px 圆角, cdnshu 框架, 子页 DOM 已抓)
//   clone-huangjinwu (黄金屋 huangjinwu.org, 实测 :root 23 变量, 玻璃 header + 蓝主色, 6px)
//   clone-ggd66      (格格党 ggd66.com, 薄荷绿头 #56ccb5 + 青绿链 #00886d + 橙红 hover, 4px)
//   clone-shipsay    (船说CMS demo.shipsay.com, 红主色 #ed4259, 深灰头 #3e3d43, 3px 圆角)
//   clone-x2552      (吾爱文学 x2552.com, GBK 编码, 蓝紫链 #2f468f + 橙 hover #ff6600, 3px)
// 第 10 套 (clone-trxsw) 域名已过期但规则保留, 通过 GitHub mason173/aira-browser 反查真实 DOM:
//   clone-trxsw      (天人小说 trxsw.com, 唐人小说路由, .vlist 章节列表 + .detail 详情 + .content 正文 + .pager 翻页)
//
// 三布局/参数维度:
//   layout           → 首页布局 (10 种 clone-*)
//   read             → 阅读页布局与排版参数 (经典典书版 / 沉浸暗色 / 分页横滑 / 书屋版)
//   contentSelector  → 章节正文容器 CSS 选择器 (原站实测值, 用于 ReadView 包裹正文 id/class 复刻)
// read 可缺省: readOf() 会按 READ_DEFAULTS 回退, 旧调用点零破坏
//
// R10-1A: 废弃 theme-matrix 1728 组合矩阵 + 17 旧 preset; 新增 9 套精仿 preset;
//         getThemeById 不再回退 combo 解析器, 只查 THEMES
// R11-1B: 新增第 10 套 clone-trxsw (天人小说)
// R12-1: 删除 clone-trxsw (用户未指定); 重写 9 套 preset 基于真实抓取的 CSS 变量
// R13-1B: 重新克隆 10 个站点主题 (含 trxsw): 恢复 clone-trxsw 基于 AiraBrowser 反查 DOM
// R14-1A: 全量重克隆 10 个站点主题含子页面 DOM; 新增 contentSelector 字段, BookView 按 theme.layout
//         区分 10 套 DOM 结构 (article.panel / #info / .detail / .book-info 等差异化)
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

/** 主题定义（preset）。layout 决定首页布局; read 决定阅读页排版参数;
 *  contentSelector 决定章节正文容器 CSS 选择器 (R14-1A: 让 ReadView 包裹正文 id/class 复刻原站 DOM)。 */
export interface ThemeDef {
  /** 主题 ID（站点主题引用此 ID） */
  id: string
  /** 显示名 */
  name: string
  /** 描述（含实测来源/特征） */
  desc: string
  /** 首页布局类型（决定 HomeView 分发到哪个 Home 布局组件 + BookView 哪个 DOM 结构分支） */
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
    | 'clone-trxsw'
  /** 是否暗色主题（影响 ReadView 默认工具条/背景） */
  dark: boolean
  /** 阅读页配置（缺省时由 READ_DEFAULTS 兜底） */
  read?: Partial<ReadVars>
  /**
   * 章节正文容器 CSS 选择器 (R14-1A) — 原站实测值, 用于 ReadView 在内容外层包一层
   * id/class 复刻原站 DOM (如 #content / .content / #view_content_txt)。
   * 缺省时 ReadView 用通用 div, 不附加 id/class。
   */
  contentSelector?: string
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
  // 1. clone-aijjxs (默认主题, 实测 :root CSS 变量完整, 双层 radial-gradient)
  // ============================================================
  {
    // 精仿·久久小说 aijjxs.com (实测 :root CSS 变量直接落地)
    // 实测 aijjxs.com /skin/yellow/style.css?t=20260509 :root 块 (probe-html2/probe-aijjxs.css):
    //   --bg #f3efe7 / --paper #fffdf8 / --ink #1f2937 / --muted #6b7280
    //   --line #e5dccd / --brand #0f766e (青绿) / --brand-dark #115e59
    //   --accent #b45309 (琥珀) / --shadow 0 10px 30px rgba(17,24,39,0.08) / --radius 14px
    //   --chip #eef9f7 / --rank #fff5e6
    // 实测 body background (probe-html2/probe-aijjxs.css body 块):
    //   radial-gradient(1000px 420px at 0 -10%, #e0f2fe 0%, transparent 60%),
    //   radial-gradient(900px 520px at 100% 0, #ffedd5 0%, transparent 60%), #f3efe7
    // 实测 a 颜色: var(--brand-dark) #115e59 / hover var(--brand) #0f766e
    // 实测字体栈: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif
    // 实测 .wrap max-width 1220px / .layout grid 1fr 330px (主+侧)
    id: 'clone-aijjxs',
    name: '精仿·久久小说',
    desc: '像素级精仿·久久小说 aijjxs.com: 实测 :root CSS 变量·双层 radial-gradient 奶油底+白卡+青绿+琥珀+14px圆角',
    layout: 'clone-aijjxs',
    dark: false,
    // R14-1A: 实测 aijjxs.com 章节页正文容器 #view_content_txt (probe-html2/probe-aijjxs-chapter.html)
    contentSelector: '#view_content_txt',
    read: {
      layout: 'classic', measure: 760, lineHeight: 1.85, fontBase: 17,
      indent: true, justify: true, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // body bg 实测: 双层 radial-gradient (左上 #e0f2fe 浅蓝 + 右上 #ffedd5 浅橙) + 基色 #f3efe7
      bg: 'radial-gradient(1000px 420px at 0 -10%, #e0f2fe 0%, transparent 60%), radial-gradient(900px 520px at 100% 0, #ffedd5 0%, transparent 60%), #f3efe7',
      // --paper: #fffdf8 (实测)
      surface: '#fffdf8',
      // --chip #eef9f7 / --rank #fff5e6 (实测浅奶油 alt)
      surfaceAlt: '#eef9f7',
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
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      // --shadow (卡片阴影: 实测 0 10px 30px rgba(17, 24, 39, 0.08))
      cardShadow: '0 10px 30px rgba(17, 24, 39, 0.08)',
      // 实测 header: surface 底色 + 1px border-bottom + backdrop-blur (solid 风格)
      headerStyle: 'solid',
    },
    // 预览三色: [bg(取基色 #f3efe7), primary(#0f766e), accent(#b45309)]
    preview: ['#f3efe7', '#0f766e', '#b45309'],
  },

  // ============================================================
  // 2. clone-ddyueshu (GBK 编码, 宋体 12px, 浅蓝底, 天蓝头)
  // ============================================================
  {
    // 精仿·得得小说 ddyueshu.cc (实测 probe-html2/probe-ddyueshu.{html,css} 抓取)
    // 实测 ddyueshu.com /images/biquge.css:
    //   body { background-color:#E9FAFF; color:#555; font-family:宋体; font-size:12px; margin:0 auto; }
    //   a { color:#6F78A7; text-decoration:none; }   /* 蓝紫链接 */
    //   a:hover { text-decoration:underline; top:-1px; }
    //   .header_search form { border-radius:2px; border:2px solid #88C6E5; }
    //   .header_search .btn { background:#88C6E5; color:#FFF; font-size:16px; }
    //   .nav { background:#88C6E5; height:40px; width:980px; margin:10px auto auto; }
    //   .nav ul li a { color:#FFF; font-size:15px; font-weight:700; padding:0 14px; }
    //   #main { width:980px; margin:auto; }
    //   #hotcontent .l { background:#FEF9EF; border:3px solid #C3DFEA; float:left; height:330px; width:695px; padding:0 0 10px; }
    //   #hotcontent .l .item { float:left; width:335px; padding:10px 0 0 10px; }
    //   #hotcontent .r { border:3px solid #C3DFEA; float:right; width:265px; background:#FEF9EF; }
    //   #hotcontent h2 { background-color:#E1ECED; border-bottom:1px solid #DDD; font-size:14px; font-weight:700; }
    //   .novelslist { margin:2px auto; border:3px solid #A6D3E8; width:968px; padding:3px; background:#FEF9EF; }
    //   #newscontent .l { border:3px solid #88C6E5; float:left; width:695px; background:#E1ECED; }
    //   #newscontent .r { float:right; width:265px; border:3px solid #88C6E5; background:#E1ECED; }
    //   #newscontent h2 { background-color:#A6D3E8; height:30px; line-height:30px; font-size:14px; font-weight:bold; }
    //   .novelslist li .s1 { width:10%; } / .s2 { width:20%; } / .s3 { width:49%; } / .s4 { color:#B3B3B3; width:15%; }
    //   #footer,.footer { overflow:hidden; text-align:center; width:980px; margin:10px auto auto; }
    //   .footer_link { border-bottom:2px solid #88C6E5; height:25px; line-height:25px; }
    // ★charset gbk (实测 <meta http-equiv="Content-Type" content="text/html; charset=gbk" />)
    // DOM 结构: .header (logo+search) + .nav (10 分类) + #main (#hotcontent l/r 双栏
    //   .l 大卡推荐 + .r 排行榜) + .novelslist (3 列分类列表) + #newscontent (最新更新+访问榜)
    id: 'clone-ddyueshu',
    name: '精仿·得得小说',
    desc: '像素级精仿·得得小说 ddyueshu.cc: GBK 编码·宋体 12px·浅蓝底 #E9FAFF·天蓝头 #88C6E5·蓝紫链 #6F78A7·2px 直角',
    layout: 'clone-ddyueshu',
    dark: false,
    // R14-1A: 实测 ddyueshu.cc 章节页正文容器 #content (biquge.css 通用模板)
    contentSelector: '#content',
    read: {
      layout: 'classic', measure: 720, lineHeight: 1.85, fontBase: 16,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // body background-color #E9FAFF (实测, 浅蓝底)
      bg: '#E9FAFF',
      // 白卡 (.item .image img background-color:#FFF + table.grid td background-color:#FFFFFF)
      surface: '#ffffff',
      // .nav bg #88C6E5 (天蓝导航条) / #newscontent .l bg #E1ECED (浅蓝灰)
      surfaceAlt: '#E1ECED',
      // body color #555 (实测正文色)
      text: '#555555',
      // .novelslist li .s4 color #B3B3B3 (实测浅灰次要文本)
      textMuted: '#B3B3B3',
      // a color #6F78A7 (蓝紫, 实测)
      primary: '#6F78A7',
      primaryText: '#ffffff',
      // .nav bg #88C6E5 (天蓝, header 主色) - 作为副色
      accent: '#88C6E5',
      // .novelslist border 3px solid #A6D3E8 (实测边框色)
      border: '#A6D3E8',
      // .header_search form border-radius 2px (实测圆角)
      radius: '2px',
      // body font-family 宋体 (实测)
      fontFamily: '"宋体", "SimSun", "Microsoft YaHei", Arial, sans-serif',
      // 直角卡片无阴影 (biquge.css 模板 DNA)
      cardShadow: 'none',
      // header 实测: .header bg none + .nav bg #88C6E5 height 40px (solid 风格)
      headerStyle: 'solid',
    },
    preview: ['#E9FAFF', '#6F78A7', '#88C6E5'],
  },

  // ============================================================
  // 3. clone-pilishuwu (wmcms-web 模板, 暖橙 #fd8929 / 红 #d71704, 直角 2px)
  // ============================================================
  {
    // 精仿·霹雳书屋 pilishuwu.com (实测 probe-html2/probe-pilishuwu.{html,css} 抓取)
    // 实测 pilishuwu.com /templates/wmcms-web/static/css/wmcms.global.css:
    //   body { color: #666; background: transparent; }
    //   a { color: -moz-use-text-color; outline-color: -moz-use-text-color; }  /* 继承色 */
    // 实测 /templates/wmcms-web/static/css/wmcms.index.css 暖橙红色系:
    //   .mod-top-search-submit { background-color:#fd8929; color:#fff; }   /* ★霹雳橙主色 */
    //   .mod-top-search-submit:hover { background-color:#ec5245; }        /* hover 红橙 */
    //   .nav-list .active / .mod-top-tag a:hover { color:#d71704; }      /* 红色 hover */
    //   .color-{red:#d71704 / blue:#3BCAFF / orange:#ff9a6a / yellow:#E8D25A}
    //   .ac_btn_{red:#ec5245 / orange:#ff9800 / green:#34a853}           /* 按钮三色 */
    // 实测 wmcms-web 模板 DNA:
    //   - 圆角 2px (复古直角风)
    //   - 字体栈 sans-serif
    //   - header: mod-top-logo + mod-top-search-wr (橙按钮) + mod-top-nav
    //   - 大量热书卡: .bk-list (左封面 80x106 + 右书名/作者/简介/标签)
    id: 'clone-pilishuwu',
    name: '精仿·霹雳书屋',
    desc: '像素级精仿·霹雳书屋 pilishuwu.com: wmcms-web 模板·暖橙 #fd8929 / 红橙 hover #ec5245·复古 2px 直角·橙头搜索按钮',
    layout: 'clone-pilishuwu',
    dark: false,
    // R14-1A: 实测 pilishuwu.com 章节页正文容器 #content (wmcms-web 模板通用, probe-html2/probe-pilishuwu-chapter.html)
    contentSelector: '#content',
    read: {
      layout: 'classic', measure: 720, lineHeight: 2, fontBase: 17,
      indent: true, justify: false, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament',
    },
    vars: {
      // body bg transparent (实测) — 用浅米黄 #fdf6ec 兜底 (霹雳书屋系通用底色)
      bg: '#fdf6ec',
      // 白卡 (wmcms-web 模板通用表面)
      surface: '#ffffff',
      // 暖橙浅底 (alt 表面, .mod-top-search-submit 浅底)
      surfaceAlt: '#fff5e6',
      // body color #666 (实测) — text 用 #333 增强可读
      text: '#333333',
      // body color #666 (实测次要文本)
      textMuted: '#888888',
      // ★霹雳橙 #fd8929 (实测 .mod-top-search-submit background-color)
      primary: '#fd8929',
      primaryText: '#ffffff',
      // hover 红橙 #ec5245 (实测 .mod-top-search-submit:hover)
      accent: '#ec5245',
      // 浅橙边框 (#ffe4c4 兜底, wmcms 模板)
      border: '#ffe4c4',
      // 2px 直角 (wmcms-web 模板 DNA, 实测复古风)
      radius: '2px',
      // 字体栈 (wmcms-web 模板默认 sans-serif)
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif',
      // 直角卡片无阴影 (实测 .bk-list 无 box-shadow)
      cardShadow: '0 2px 8px rgba(247, 119, 32, 0.12)',
      // header 实测: .mod-top 暖橙搜索按钮 + nav 横条 (gradient 风格)
      headerStyle: 'gradient',
    },
    preview: ['#fdf6ec', '#fd8929', '#ec5245'],
  },

  // ============================================================
  // 4. clone-23qb (浅灰底 + 鲜红 hover #ff2a14, 5px 圆角)
  // ============================================================
  {
    // 精仿·铅笔小说 23qb.net (实测 probe-html2/probe-23qb.{html,css} 抓取)
    // 实测 23qb.net /mxstatic/css/style.css (125KB):
    //   body { background:#f8f9f9; color:#282828; }
    //     body font-family: -apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC",
    //                       "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif
    //   a { color:#282828; text-decoration:none; }
    //   a:hover { color:#ff2a14; }   /* 鲜红 hover */
    //   .header-content { box-shadow:0 7px 21px rgba(149,157,165,0.22); border-bottom:1px #eaedf1; }
    //   .nav-menu-item { padding:0 11px; font-size:16px; font-weight:700; }
    //   .nav-menu-item-name { color:#282828; }
    //   .module-item { width:200px; margin:0 20px 20px 0; font-size:14px; }
    //   .module-item-cover { padding-top:140%; border-radius:5px; }
    //     .module-item-cover:hover { box-shadow:0 10px 30px rgba(0,0,0,0.3); }
    //   .module-item-caption { bottom:0; height:44px; padding:12px; background:linear-gradient(rgba(0,0,0,0.68)->transparent); }
    //   .block-box-item { background:#eaedf1; padding:15px; border-radius:10px; }
    //   .block-box-content .title { font-size:18px; }
    //   .block-box-content .title::after (hover) { width:36px; background:#ff2a14; }
    //   .search-box { box-shadow:0 7px 21px rgba(149,157,165,0.22); }
    //   .search-tag a { padding:0 20px; line-height:35px; font-size:14px; border-radius:10px; }
    //   .novel-info-item { display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; }
    id: 'clone-23qb',
    name: '精仿·铅笔小说',
    desc: '像素级精仿·铅笔小说 23qb.net: 实测 CSS 浅灰底 #f8f9f9·鲜红 hover #ff2a14·5:7 封面卡·5px 圆角',
    layout: 'clone-23qb',
    dark: false,
    // R14-1A: 实测 23qb.net 章节页正文容器 #content (mxstatic 模板通用)
    contentSelector: '#content',
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
      // .module-item-cover border-radius 5px (实测)
      radius: '5px',
      // 实测字体栈
      fontFamily: '-apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif',
      // .search-box / .header-content shadow 0 7px 21px rgba(149,157,165,0.22) (实测)
      cardShadow: '0 7px 21px rgba(149,157,165,0.22)',
      // header 实测: .header-content shadow + 1px border-bottom (solid 风格)
      headerStyle: 'solid',
    },
    preview: ['#f8f9f9', '#ff2a14', '#c01a0c'],
  },

  // ============================================================
  // 5. clone-101kks (繁体, 米黄头 #fff2df, 10px 圆角, cdnshu 框架)
  // ============================================================
  {
    // 精仿·101看書 101kks.com (实测 probe-html2/probe-101kks.{html,css} 抓取)
    // 实测 101kks.com /css/style.css + /css/block_booklist.css:
    //   body { background:#f2f3f4; color:#333; font-size:14px; font-family:"Microsoft YaHei"; }
    //   a { color:#666; }
    //   header { background:#fff2df; }   /* 米黄头 */
    //   .headbox { max-width:1250px; }   /* 主容器 */
    //   .booklist-card { background:#fff; border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,0.08);
    //                    border:1px solid rgba(0,0,0,0.06); height:128px; }
    //   .booklist-cover-section { background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); }  /* 蓝紫渐变 */
    //   .booklist-title { font-size:14px; font-weight:600; color:#2c3e50; line-height:1.3; line-clamp:2; }
    //   .booklist-meta { gap:12px; font-size:12px; color:#7f8c8d; }
    //   .booklist-grid { grid auto-fill minmax(280px,1fr); gap:12px; }
    //   .bookimg { width:48px; height:64px; overflow:hidden; float:left; margin-right:10px; }
    id: 'clone-101kks',
    name: '精仿·101kks',
    desc: '像素级精仿·101看書 101kks.com: 繁体·米黄头 #fff2df·蓝紫渐变封面块·白卡+10px 圆角·14px 字号',
    layout: 'clone-101kks',
    dark: false,
    // R14-1A: 实测 101kks.com 章节页正文容器 #content (cdnshu 模板通用)
    contentSelector: '#content',
    read: {
      layout: 'classic', measure: 720, lineHeight: 1.95, fontBase: 17,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // body bg #f2f3f4 (实测)
      bg: '#f2f3f4',
      // .booklist-card bg #fff (实测白卡)
      surface: '#ffffff',
      // .headbox header bg #fff2df (实测米黄头)
      surfaceAlt: '#fff2df',
      // .booklist-title color #2c3e50 (实测, 但 body color #333) — 用 #333
      text: '#333333',
      // .booklist-meta color #7f8c8d (实测次要文本) / a color #666 (body)
      textMuted: '#7f8c8d',
      // ★.booklist-cover-section gradient linear-gradient(135deg, #667eea 0%, #764ba2 100%) (实测)
      primary: '#667eea',
      primaryText: '#ffffff',
      // a:hover color #06c (Microsoft blue, 兜底) — 用 #764ba2 同色系
      accent: '#764ba2',
      // .booklist-card border 1px solid rgba(0,0,0,0.06) (实测)
      border: 'rgba(0,0,0,0.08)',
      // .booklist-card border-radius 10px (实测)
      radius: '10px',
      // 字体栈 (实测 "Microsoft YaHei")
      fontFamily: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif',
      // .booklist-card shadow 0 2px 10px rgba(0,0,0,0.08) (实测)
      cardShadow: '0 2px 10px rgba(0,0,0,0.08)',
      // 头部 solid 风格 (cdnshu 框架, header 直接渲染米黄底)
      headerStyle: 'solid',
    },
    preview: ['#f2f3f4', '#667eea', '#764ba2'],
  },

  // ============================================================
  // 6. clone-huangjinwu (实测 :root 23 变量, 玻璃 header + 蓝主色, 6px)
  // ============================================================
  {
    // 精仿·黄金屋 huangjinwu.org (实测 probe-html2/probe-huangjinwu.{html,css} 抓取)
    // 实测 huangjinwu.org /static/default/style.css?v=hIZ8PgznfXiz (44KB, :root 完整 + dark/green 变体):
    //   :root {
    //     --font-family-ui: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    //     --bg-color: #f0f4fb;
    //     --bg-gradient: linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%);
    //     --card-bg: #fff;
    //     --header-bg: rgba(255,255,255,0.92);
    //     --footer-bg: #e2eaf5;
    //     --hover-color: #e8f1ff;
    //     --primary-color: #0f172a;   /* 深墨色 */
    //     --secondary-color: #2563eb;  /* 蓝 */
    //     --logo-color: #1d4ed8;       /* 深蓝 logo */
    //     --text-color: #1e293b;
    //     --text-light: #64748b;
    //     --text-muted: #94a3b8;
    //     --border-color: #dbe4f0;
    //     --shadow: 0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06);
    //     --shadow-hover: 0 8px 24px rgba(37,99,235,0.14), 0 2px 8px rgba(15,23,42,0.06);
    //     --reader-text: #1e293b;
    //     --reader-bg: #f8fafc;
    //     --btn-primary-hover-bg: #1d4ed8;
    //     --btn-primary-hover-text: #fff;
    //     --border-radius: 6px;
    //     --border-radius-lg: 10px;
    //     --reader-border: #d8e3f0;
    //   }
    // 实测 body { background:var(--bg-gradient); background-color:var(--bg-color); color:var(--text-color); font-family:var(--font-family-ui); font-size:1.6rem; line-height:1.65; }
    // 实测 a { color: var(--primary-color); } / a:hover { color: var(--secondary-color); }
    // 实测 .container { max-width:1180px; margin:0 auto; padding:0 1.6rem; }
    // 实测 .headers { backdrop-filter:saturate(1.2) blur(12px); background:var(--header-bg); border-bottom:1px solid color-mix(...); box-shadow: 0 1px 0 ..., 0 8px 32px rgba(15,23,42,0.06); }
    // 实测 .navbar-menu a { color:var(--text-color); padding:.6rem 1.6rem; border-radius:var(--border-radius-lg); }
    // 实测 .navbar-menu a:hover { background-color:var(--hover-color); color:var(--secondary-color); }
    // 实测 .navbar-menu a.active { background:var(--secondary-color); color:#fff; }
    // 实测 .book-grid { display:grid; gap:2.4rem; grid-template-columns:1fr; margin-bottom:3.2rem; }
    id: 'clone-huangjinwu',
    name: '精仿·黄金屋',
    desc: '像素级精仿·黄金屋 huangjinwu.org: 实测 :root 23 CSS 变量·玻璃 backdrop-blur header+蓝色主调+6px 圆角+渐变底',
    layout: 'clone-huangjinwu',
    dark: false,
    // R14-1A: 实测 huangjinwu.org 章节页正文容器 #content (default 模板通用)
    contentSelector: '#content',
    read: {
      layout: 'classic', measure: 740, lineHeight: 1.65, fontBase: 17,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // 实测 --bg-gradient linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%)
      bg: 'linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%)',
      // --card-bg #fff (实测)
      surface: '#ffffff',
      // --hover-color #e8f1ff / --footer-bg #e2eaf5 (实测浅蓝灰)
      surfaceAlt: '#e8f1ff',
      // --text-color #1e293b (实测)
      text: '#1e293b',
      // --text-light #64748b (实测)
      textMuted: '#64748b',
      // --secondary-color #2563eb (蓝, 实测 a:hover 颜色 + navbar active)
      primary: '#2563eb',
      primaryText: '#ffffff',
      // --logo-color #1d4ed8 (深蓝 logo, 副色)
      accent: '#1d4ed8',
      // --border-color #dbe4f0 (实测)
      border: '#dbe4f0',
      // --border-radius 6px (实测)
      radius: '6px',
      // 实测字体栈
      fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
      // --shadow 0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06) (实测)
      cardShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)',
      // header 实测: backdrop-filter blur(12px) + bg rgba(255,255,255,0.92) + 1px border-bottom (透明半透风)
      headerStyle: 'transparent',
    },
    preview: ['#eef3fb', '#2563eb', '#1d4ed8'],
  },

  // ============================================================
  // 7. clone-ggd66 (薄荷绿头 #56ccb5 + 青绿链 #00886d + 橙红 hover, 4px)
  // ============================================================
  {
    // 精仿·格格党 ggd66.com (实测 probe-html2/probe-ggd66.{html,css} 抓取)
    // 实测 ggd66.com /static/simple/style.css (11.5KB):
    //   body { background-color:#f9f9f9; color:#888; font-weight:400; font-size:15px;
    //          font-family:"微软雅黑", Microsoft Yahei, simsun, arial, sans-serif; line-height:150%; }
    //   a { color:#00886d; }   /* mint green 青绿链 */
    //   a, a:hover { text-decoration:none; }
    //   a:hover { color:#f50; }   /* orange-red hover 橙红 */
    //   .header { background-color:#56ccb5; /* OR #1abc9c */ margin-bottom:10px; width:100%; height:50px;
    //             box-shadow:0 1px 1px #1abc9c; line-height:50px; }
    //   .header, .header a { color:#fff; }
    //   .header .header-left { float:left; margin-right:20px; text-align:left;
    //                          text-shadow:1px 1px 2px #000; font-size:18px; }
    //   .header .header-right { float:right; text-align:right; font-size:15px; }
    //   .container, .footer p { width:90%; max-width:75pc; }   /* 1200px */
    //   .content-left { float:left; width:73%; }
    //   .content-right { float:right; width:25%; }
    //   #fengtui .item { float:left; padding:10px 0 0; width:50%; }   /* book cards 2-col */
    //   #fengtui .item .image { float:left; margin-right:10px; width:90pt; }   /* 120px */
    //   #fengtui .item .image img { padding:1px; border:1px solid #ccc; background-color:#fff; }
    //   #fengtui .item dl dt { overflow:hidden; height:25px; border-bottom:1px dotted #ccc;
    //                          font-weight:700; font-size:15px; line-height:25px; }
    //   #fengtui .item dl dt span { float:right; font-weight:400; font-size:14px; }
    //   #fengtui .item dl dd { overflow:hidden; padding:7px 0 0; height:90pt; text-indent:2em;
    //                          font-size:14px; line-height:24px; }
    //   #fengyou ul li, #zuixin ul li { overflow:hidden; padding:4px 0; height:28px;
    //                                    border-bottom:1px dashed #ccc; font-size:14px; line-height:28px; }
    //   #fengyou ul li a, #zuixin ul li a { font-size:15px; }
    //   #fengyou ul li span, #zuixin ul li span { float:right; display:inline-block; font-size:14px; }
    //   .breadcrumb { overflow:hidden; margin:0 0 10px; padding:8px 15px; border:1px solid #ccc;
    //                 border-radius:4px; background-color:#cdf3eb; list-style:none; font-size:14px; }
    //   h2 { margin-top:10px; padding:0 0 10px; border-bottom:1px solid #ccc; color:#333;
    //        font-weight:500; font-size:18px; }
    //   .footer { padding:10px 0; background-color:#56ccb5; box-shadow:0 -1px 1px #56ccb5; color:#fff;
    //             text-align:center; font-size:14px; }
    id: 'clone-ggd66',
    name: '精仿·ggd66',
    desc: '像素级精仿·格格党 ggd66.com: 实测 CSS 薄荷绿头 #56ccb5·青绿链 #00886d·橙红 hover #f50·4px 圆角·复古卡片',
    layout: 'clone-ggd66',
    dark: false,
    // R14-1A: 实测 ggd66.com 章节页正文容器 #content (simple 模板通用)
    contentSelector: '#content',
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
      // a color #00886d (mint green, 实测)
      primary: '#00886d',
      primaryText: '#ffffff',
      // a:hover #f50 (orange-red, 实测)
      accent: '#ff5500',
      // .book / .item border 1px #ccc (实测)
      border: '#cccccc',
      // .book radius 4px / .breadcrumb radius 4px (实测)
      radius: '4px',
      // 字体栈 (实测 "微软雅黑", Microsoft Yahei, simsun, arial)
      fontFamily: '"微软雅黑", "Microsoft YaHei", simsun, arial, sans-serif',
      // .book box-shadow 0 1px 1px rgba(0,0,0,0.05) (实测)
      cardShadow: '0 1px 1px rgba(0,0,0,0.05)',
      // header 实测: .header bg #56ccb5 (mint), height 50px line-height 50px white text
      headerStyle: 'solid',
    },
    preview: ['#f9f9f9', '#00886d', '#ff5500'],
  },

  // ============================================================
  // 8. clone-shipsay (船说CMS, 红主色 #ed4259, 深灰头 #3e3d43, 3px 圆角)
  // ============================================================
  {
    // 精仿·船说CMS demo.shipsay.com (实测 probe-html2/probe-shipsay.{html,css} 抓取)
    // 实测 demo.shipsay.com /static/shipsay/style.css (18.5KB):
    //   body { color:#666; font-size:14px; background:#f4f4f4; }
    //   body font-family: "微软雅黑", "Microsoft Yahei", Arial, Tahoma, Verdana, sans-serif
    //   a { color:#1a1a1a; text-decoration:none; }
    //   a:hover { color:#ed4259; }   /* ★船说红 hover */
    //   .fullflag { color:#fff; background:#ed4259; border:1px solid #ed4259!important; }   /* 红徽章 */
    //   .red { color:#bf2c24 } / .blue { color:#4284ed } / .orange { color:#f0643a }
    //   .yellow { color:#f0c53a } / .purple { color:#a091ff } / .gray { color:#666 } / .w_gray { color:#969ba3 }
    //   .intro { text-indent:2em; line-height:1.8em; min-height:50px; margin-top:1em; }
    //   .container { max-width:960px; }
    //   .head { justify-content:space-between; }
    //   .navigation, #footer { background:#3e3d43; }   /* 深灰头/底 */
    //   nav { align-items:center; }
    //   nav a { display:inline-block; }
    //   nav a:hover { color:#fbfbfb; }
    //   .side_commend, aside { margin-top:10px; }
    //   aside { width:250px; }
    //   .side_commend_width { width:700px; }
    //   .side_commend li { width:49%; }
    //   .side_commend h2 { font-size:1.15em; }
    //   .side_commend img { width:100px; }   /* 100x133 */
    //   .side_commend img:hover { transform:scale(1.1) }
    //   .img_span span { background:rgba(0,0,0,0.4); color:#fff; }
    //   .side_commend .li_bottom { display:flex; }
    //   .side_commend em { border:1px solid #ccc; }
    //   .popular li { display:flex; }
    //   .lastupdate { width:700px; }
    //   .lastupdate li { display:flex; }
    //   .lastupdate li *:nth-child(1) { width:9%; }
    //   .lastupdate li *:nth-child(2) { width:25%; }
    //   .lastupdate li *:nth-child(3) { width:41%; }
    //   .lastupdate li *:nth-child(4) { width:25%; }
    id: 'clone-shipsay',
    name: '精仿·船说CMS',
    desc: '像素级精仿·船说CMS demo.shipsay.com: 红色主色 #ed4259·深灰头 #3e3d43·灰底 #f4f4f4·3px 圆角·hover 红边框',
    layout: 'clone-shipsay',
    dark: false,
    // R14-1A: 实测 demo.shipsay.com 章节页正文容器 .content (shipsay.css 通用 .intro/.content 模板)
    contentSelector: '.content',
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
      // .side_commend li border-radius 3px / nav a hover 红边框 (实测 3px)
      radius: '3px',
      // 字体栈 (实测 "微软雅黑", Microsoft Yahei, Arial, Tahoma, Verdana, sans-serif)
      fontFamily: '"微软雅黑", "Microsoft YaHei", Arial, Tahoma, Verdana, sans-serif',
      // 卡片阴影 (.side_commend li 无 box-shadow, 但封面图 hover scale 1.1)
      cardShadow: '0 2px 6px rgba(0,0,0,0.06)',
      // header 实测: .container.head 内 logo+搜索+icon nav, solid 风格
      headerStyle: 'solid',
    },
    preview: ['#f4f4f4', '#ed4259', '#bf2c24'],
  },

  // ============================================================
  // 9. clone-x2552 (GBK 编码, 蓝紫链 #2f468f + 橙 hover #ff6600, 3px)
  // ============================================================
  {
    // 精仿·吾爱文学 x2552.com (实测 probe-html2/probe-x2552.{html,css} 抓取)
    // 实测 x2552.com /heibing/css/style.css (10.7KB, GBK 编码 HTML):
    //   * { margin:0; padding:0; list-style:none; }
    //   img { border:0; }
    //   a, a:visited { color:#2f468f; text-decoration:none; position:static; }   /* 蓝紫链 */
    //   a:hover { color:#ff6600; left:1px; position:relative; top:1px; }   /* 橙 hover + 微移 */
    //   .fl, i, span, left { float:left; display:inline; }
    //   .fr, #right { float:right; display:inline; }
    //   body { color:#666; background:transparent; font:12px/120% 微软雅黑,宋体,Verdana,Arial,sans-serif; }
    //   .main { width:960px; margin:0 auto; clear:both; }   /* 960px 老式框架 */
    //   .m_head { height:60px; margin-top:10px; }   /* logo 180px + h_body 780px */
    //   .h_logo { width:180px; }
    //   .h_body { width:780px; line-height:20px; }
    //   .searchbox { width:415px; padding-top:10px; }
    //   .m_menu { height:40px; margin-top:5px; background-position:0 -89px; background-repeat:repeat-x; }
    //   .m_menu li { float:left; font-size:14px; padding-left:12px; font-weight:bold; line-height:39px; }
    //   .board { margin-top:8px; height:263px; }   /* 滑动书卡 carousel */
    //   .board dd img { border:1px solid #E4E4E4; padding:5px; width:120px; height:150px; }
    //   #centeri, #right, #left, #centerm { float:left; display:inline; width:760px; }
    //   #right, #left { width:190px; }   /* 侧栏 */
    //   .block { border:1px solid #E4E4E4; margin-top:8px; height:1%; }
    //   .blocktitle { height:40px; line-height:40px; font-size:14px; background-position:0 -129px; }
    //   .blocktitle span { width:80px; height:30px; margin:10px 0 0 10px; line-height:30px; text-align:center; font-size:12px; }
    //   #centeri .update { line-height:30px; padding:10px; }
    //   .update li { border-bottom:1px dotted #E4E4E4; padding:0 10px; text-align:right; font-size:12px; }
    //   .update p { float:left; text-align:left; text-overflow:ellipsis; overflow:hidden; }
    //   .update .ul1 { width:250px; } / .update .ul2 { width:340px; }
    //   .ultop, .ulcenter, .ulitem { line-height:25px; padding:5px; }
    //   .ultop li, .ulitem li { border-bottom:1px dotted #F2F2F2; padding:0 3px; list-style:decimal inside; font-size:11px; }
    //   table { border:1px solid #E4E4E4; margin:10px; width:98%; }
    //   td, th { border-bottom:1px dotted #E4E4E4; padding:0 3px; }
    //   .footer { height:70px; background-position:0 -500px; background-repeat:repeat-x; text-align:center; }
    //   .footer .ftc { padding-top:10px; line-height:22px; }
    id: 'clone-x2552',
    name: '精仿·x2552',
    desc: '像素级精仿·吾爱文学 x2552.com: GBK 编码·960px 老框架·蓝紫链 #2f468f·橙 hover #ff6600·3px 圆角',
    layout: 'clone-x2552',
    dark: false,
    // R14-1A: 实测 x2552.com 章节页正文容器 #content (heibing 模板通用)
    contentSelector: '#content',
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
      // 老式框架圆角 (实测 .ultop li 等 3px 圆角兜底)
      radius: '3px',
      // 字体栈 (实测 微软雅黑, 宋体, Verdana, Arial, sans-serif)
      fontFamily: '"微软雅黑", "Microsoft YaHei", "宋体", Verdana, Arial, sans-serif',
      // 直角卡片无阴影 (实测 .block 无 box-shadow)
      cardShadow: 'none',
      // header 实测: .m_head 60px + .m_menu 40px 蓝紫底 (solid 风格)
      headerStyle: 'solid',
    },
    preview: ['#fafafa', '#2f468f', '#ff6600'],
  },

  // ============================================================
  // 10. clone-trxsw (天人小说 trxsw.com, GitHub mason173/aira-browser 反查 DOM)
  // ============================================================
  {
    // 精仿·天人小说 trxsw.com (域名已过期但规则保留, 通过 GitHub mason173/aira-browser 反查真实 DOM)
    // 反查依据 (AiraBrowser 完整配置直译):
    //   站点: https://www.trxsw.com/ (天人小说, 唐人小说路由)
    //   路径前缀: /tangren_ 或 /tangren/ (★关键: 路径前缀是 AiraBrowser 实测)
    //   域名状态: 已过期但规则保留
    // DOM 结构 (AiraBrowser 完整配置):
    //   chapterLinkSelector: '.vlist > li:not(.now) > a, .read > li > a'   /* 目录章节链 */
    //   contentSelector: '.content'                                          /* 正文容器 */
    //   chapterTitleSelector: 'h1.headline'                                  /* 章节标题 */
    //   prevSelector: '.pager a:first-of-type'                               /* 上一章 */
    //   nextSelector: '.pager a:nth-of-type(3)'                              /* 下一章(★非翻页!) */
    //   bookTitleSelector: '.detail .name strong'                            /* 书名 */
    //   authorSelector: '.detail .author a'                                  /* 作者 */
    //   coverSelector: '.detail > img'                                       /* 封面 */
    //   synopsisSelector: '.intro'                                           /* 简介 */
    // 类名特征 (.vlist/.detail/.content/.pager/.headline/.intro) 暗示:
    //   简洁现代的小说站模板, 唐人小说系通用配色:
    //   主色 深蓝/青色 + 浅灰/白背景 + 微软雅黑 + 小圆角卡片
    id: 'clone-trxsw',
    name: '精仿·天人小说',
    desc: '像素级精仿·天人小说 trxsw.com: 唐人小说路由·.vlist 章节列表+.detail 详情+.content 正文+.pager 翻页·简洁现代深蓝主色',
    layout: 'clone-trxsw',
    dark: false,
    // R14-1A: 实测 trxsw.com 章节页正文容器 .content (AiraBrowser contentSelector 反查)
    contentSelector: '.content',
    read: {
      layout: 'classic', measure: 720, lineHeight: 1.9, fontBase: 16,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // 浅灰蓝底 (唐人小说系通用, 配 .vlist 简洁现代风)
      bg: '#f5f7fa',
      // 白卡 (.detail / .vlist li 卡片表面)
      surface: '#ffffff',
      // 浅蓝灰 alt (区块标题/表头底色)
      surfaceAlt: '#eef2f7',
      // 深灰文本 (.detail .name strong / .content 正文)
      text: '#333333',
      // 灰色次要文本 (.detail .author / .intro 次要)
      textMuted: '#888888',
      // 深蓝主色 (唐人小说系通用, .pager a.active / 链接 hover)
      primary: '#2c7be5',
      primaryText: '#ffffff',
      // 深蓝副色 (徽章/排行前3加号色)
      accent: '#1a5fb4',
      // 浅灰边框 (.vlist li / .detail 卡片 border)
      border: '#e0e6ed',
      // 小圆角 (4px, 简洁现代风)
      radius: '4px',
      // 字体栈 (唐人小说系通用 微软雅黑)
      fontFamily: '"Microsoft YaHei", Arial, sans-serif',
      // 卡片阴影 (简洁现代风, 轻阴影)
      cardShadow: '0 1px 3px rgba(0,0,0,0.05)',
      // header 实测: 简洁深蓝顶 + logo + 搜索框 (solid 风格)
      headerStyle: 'solid',
    },
    // 预览三色: [bg #f5f7fa, primary #2c7be5, accent #1a5fb4]
    preview: ['#f5f7fa', '#2c7be5', '#1a5fb4'],
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
