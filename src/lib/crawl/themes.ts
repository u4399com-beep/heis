// ============================================================
// 主题模版注册表 — 5 套精仿真实小说站点主题 (R9-1A 重构)
// 5 套 preset 全部基于真实站点首页 HTML+CSS 抓取, 像素级精仿:
//   clone-aijjxs   (久久小说 aijjxs.com, 实测 :root CSS 变量)
//   clone-101kks   (101看書 101kks.com, cdnshu 框架实测)
//   clone-pilishuwu(霹雳书屋 pilishuwu.com, CF 防护, 参考形态描述)
//   clone-biquge   (笔趣阁 bqg713.cc, 实测 style.css)
//   clone-23qb     (铅笔小说 23qb.net, 实测 style.css)
//
// 双布局维度:
//   layout     → 首页布局 (12 原始 + 5 clone-* = 17 种)
//   read       → 阅读页布局与排版参数 (经典典书版 / 沉浸暗色 / 分页横滑 / 书屋版)
// read 可缺省: readOf() 会按 READ_DEFAULTS 回退, 旧调用点零破坏
//
// feat-combo-theme-incremental: 在 THEMES(preset) 之外引入组合主题矩阵
// (12 配色 × 12 风格 × 12 布局 = 1728 组合)。theme-matrix 仅依赖本模块的
// 类型(type-only import, 编译期擦除无运行时循环依赖); 本模块在 getThemeById
// 中静态引入组合解析器, preset 命中优先, 未命中回退组合, 全未命中返回 THEMES[0]。
// ============================================================
import { getThemeById as resolveComboTheme } from './theme-matrix'

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

/** 阅读缺省值（theme.read 缺字段/整体缺省时回退, 保证向后兼容） */
export const READ_DEFAULTS: ReadVars = {
  layout: 'classic',
  measure: 680,
  lineHeight: 2,
  fontBase: 17,
  indent: true,
  justify: false,
  toolbar: 'inline',
  texture: 'none',
  chapterDeco: 'rule',
}

/** 主题里允许只写部分阅读字段 */
export type ThemeReadConfig = Partial<ReadVars>

/** 取主题的完整阅读配置（缺省回退） */
export function readOf(theme?: { read?: ThemeReadConfig } | null): ReadVars {
  return { ...READ_DEFAULTS, ...(theme?.read || {}) }
}

/** 中文标签（后台预览/调试用） */
export const READ_LAYOUT_LABEL: Record<ReadLayoutKind, string> = {
  classic: '典书版',
  immersive: '沉浸暗夜',
  paginated: '分页横滑',
  pili: '书屋版',
}

export interface ThemeDef {
  id: string
  name: string
  desc: string
  /** 首页布局风格 — 12 原始 + 5 clone-* = 17 种 (R9-1A 新增 5 clone-*) */
  layout: 'grid' | 'list' | 'shelf' | 'magazine' | 'minimal' | 'theater' | 'pili' | 'biquge' | 'mosaic' | 'masonry' | 'showcase' | 'editorial' | 'clone-101kks' | 'clone-pilishuwu' | 'clone-aijjxs' | 'clone-biquge' | 'clone-23qb'
  dark: boolean
  /** 阅读页布局与排版（缺省走 readOf 回退值） */
  read?: ThemeReadConfig
  /** CSS 变量集 */
  vars: {
    bg: string
    surface: string
    surfaceAlt: string
    text: string
    textMuted: string
    primary: string
    primaryText: string
    accent: string
    border: string
    radius: string
    fontFamily: string
    cardShadow: string
    headerStyle: 'solid' | 'gradient' | 'transparent' | 'split' | 'centered' | 'pili'
    titleFont?: string
  }
  /** 预览用小色块 */
  preview: [string, string, string]
}

export const THEMES: ThemeDef[] = [
  // ==================== R9-1A: 5 套精仿真实小说站点 preset ====================
  // 默认主题置首位 (getTheme(undefined) 兜底返回 THEMES[0]), clone-aijjxs 最稳定站
  {
    // 精仿·久久小说 aijjxs.com (实测 :root CSS 变量直接落地)
    // 实测 aijjxs.com /skin/yellow/style.css?t=20260509 :root 块:
    //   --bg #f3efe7 / --paper #fffdf8 / --ink #1f2937 / --muted #6b7280
    //   --line #e5dccd / --brand #0f766e (青绿) / --brand-dark #115e59
    //   --accent #b45309 (琥珀) / --shadow 0 10px 30px rgba(17,24,39,0.08) / --radius 14px
    // 实测 a 颜色: var(--brand-dark) #115e59 / hover var(--brand) #0f766e
    // 实测字体栈: PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif
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
    desc: '像素级精仿·霹雳书屋 pilishuwu.com: 暖橙白卡书城·橙头排行榜·复古直角卡片',
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
  {
    // 精仿·笔趣阁 bqg713.cc (实测 /css/style.css?v=1.2606 直连 200)
    // 实测 CSS:
    //   BODY bg #E9FAFF (浅青蓝), color #333, font 14px/1.5 "Microsoft YaHei", Arial
    //   a color #6F78A7 (淡紫) / hover #FD5500 (橙红)
    //   .header_top bg #E1ECED border-bottom 1px #A6D3E8 height 30px color #999
    //   .nav bg #88C6E5 (天蓝) li width 8% line-height 34px radius 20px color #fff
    //   .hot bg #FEF9EF border 3px solid #C3DFEA padding 10px 0 0 width 695px
    //   .item float 50% / .class .item 33.3%, height 156px
    //   .item .image img 120x150 bg #FFF border 1px solid #DDD padding 1px
    //   .item dl dt border-bottom 1px dotted #A6D3E8 font-size 14px weight 700
    //   .wrap .top border 3px solid #C3DFEA width 265px bg #FEF9EF
    //   .lis li border-bottom 1px #DDDDDD height 33px line-height 33px
    id: 'clone-biquge',
    name: '精仿·笔趣阁',
    desc: '像素级精仿·笔趣阁 bqg713.cc: 实测 CSS 浅青蓝底+淡紫链接+橙红 hover·天蓝导航·直角卡表格式',
    layout: 'clone-biquge',
    dark: false,
    read: {
      layout: 'classic', measure: 720, lineHeight: 1.95, fontBase: 16,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // BODY background #E9FAFF (实测)
      bg: '#E9FAFF',
      // .item .image img bg #FFF + .hot bg #FEF9EF
      surface: '#ffffff',
      // .hot bg #FEF9EF / .wrap .top bg #FEF9EF
      surfaceAlt: '#FEF9EF',
      // BODY color #333 (实测)
      text: '#333333',
      // .header_top color #999 + .item dl dd color #AAA
      textMuted: '#888888',
      // .nav bg #88C6E5 (天蓝, 实测)
      primary: '#88C6E5',
      // .header_wap color #fff (实测)
      primaryText: '#ffffff',
      // a:hover #FD5500 (橙红, 实测)
      accent: '#FD5500',
      // .item dl dt border-bottom dotted #A6D3E8 (实测边框色)
      border: '#A6D3E8',
      // 笔趣阁 DNA 直角 (实测 .hot .item .wrap .top 全直角)
      radius: '0px',
      // BODY font 14px/1.5 "Microsoft YaHei", Arial (实测)
      fontFamily: '"Microsoft YaHei", Arial, sans-serif',
      // 直角卡片无阴影 (实测 .item 无 box-shadow)
      cardShadow: 'none',
      // header 实测: .header_top 30px bg #E1ECED + .header 60px + .nav 34px
      headerStyle: 'solid',
    },
    preview: ['#E9FAFF', '#88C6E5', '#FD5500'],
  },
  {
    // 精仿·铅笔小说 23qb.net (实测 /mxstatic/css/style.css 直连 200)
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

  // ==================== R9-1B: 12 套全新设计风格 preset ====================
  // 每套配色+风格+布局完全不同, 与 5 套精仿 + 8 老布局(grid/list/shelf/magazine/
  // minimal/theater/pili/biquge)均不雷同。布局覆盖: shelf×2 / grid×2 / magazine×2 /
  // minimal×2 / theater×1 / editorial×1 / list×1 / masonry×1
  // 暗色 7 套 + 亮色 5 套 = 12 套; 字体: sans×6 / serif×4 / handwritten×1 / mono×1
  {
    // 1. 极光玻璃 (暗·shelf): 深紫蓝渐变+青绿 accent+紫 primary+玻璃拟态
    id: 'aurora-glass',
    name: '极光玻璃',
    desc: '深紫蓝渐变+青绿辉光+紫色主调·半透磨砂玻璃拟态·大圆角 20px·shelf 横向书架',
    layout: 'shelf',
    dark: true,
    read: {
      layout: 'classic', measure: 720, lineHeight: 2, fontBase: 18,
      indent: true, justify: false, toolbar: 'inline', texture: 'vignette', chapterDeco: 'none',
    },
    vars: {
      // 暗色 bg: linear-gradient 3 段深紫蓝渐变 (与 glass/neon 风格一致)
      bg: 'linear-gradient(160deg, #0f0a1e 0%, #1a1033 50%, #0f0a1e 100%)',
      surface: 'rgba(255,255,255,0.06)',
      surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#e5e7eb',
      textMuted: 'rgba(229,231,235,0.6)',
      // primary 紫色 (区别于 101kks 蓝紫 #667eea, 用更饱和粉紫)
      primary: '#a855f7',
      primaryText: '#ffffff',
      // accent 青绿 #22d3ee (per spec)
      accent: '#22d3ee',
      border: 'rgba(255,255,255,0.12)',
      // 大圆角 20px (玻璃拟态)
      radius: '20px',
      fontFamily: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
      // 暗色辉光: 0 8px 32px rgba(<primary RGB>,0.35)
      cardShadow: '0 8px 32px rgba(168,85,247,0.35)',
      headerStyle: 'gradient',
    },
    preview: ['#0f0a1e', '#a855f7', '#22d3ee'],
  },
  {
    // 2. 赛博霓虹 (暗·grid): 黑底+霓虹粉绿+故障字效+直角+扫描线
    id: 'cyber-neon',
    name: '赛博霓虹',
    desc: '黑底+霓虹粉绿双色对撞·故障字效·直角无圆角·扫描线纹理·grid 网格布局',
    layout: 'grid',
    dark: true,
    read: {
      layout: 'classic', measure: 740, lineHeight: 2, fontBase: 18,
      indent: true, justify: true, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none',
    },
    vars: {
      // 暗色 bg: 黑色 3 段渐变
      bg: 'linear-gradient(160deg, #050505 0%, #0d0d0d 50%, #050505 100%)',
      surface: 'rgba(255,255,255,0.06)',
      surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#e5e7eb',
      textMuted: 'rgba(229,231,235,0.6)',
      // primary 霓虹粉 #ff0080
      primary: '#ff0080',
      primaryText: '#ffffff',
      // accent 霓虹绿 #00ff9d
      accent: '#00ff9d',
      // border 霓虹粉光晕
      border: 'rgba(255,0,128,0.3)',
      // 直角 (故障风)
      radius: '0px',
      // mono 字体 (JetBrains Mono)
      fontFamily: '"JetBrains Mono","Courier New",monospace',
      // 暗色辉光: primary 粉色 glow
      cardShadow: '0 8px 32px rgba(255,0,128,0.35)',
      headerStyle: 'transparent',
    },
    preview: ['#050505', '#ff0080', '#00ff9d'],
  },
  {
    // 3. 宣纸水墨 (亮·magazine): 米黄宣纸+墨黑+朱砂红+衬线+纸纹+菱形花饰
    id: 'rice-paper',
    name: '宣纸水墨',
    desc: '米黄宣纸底+墨黑正文+朱砂红主调·衬线字体·纸纹纹理·菱形花饰·magazine 杂志布局',
    layout: 'magazine',
    dark: false,
    read: {
      layout: 'classic', measure: 700, lineHeight: 2.1, fontBase: 18,
      indent: true, justify: true, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament',
    },
    vars: {
      // 亮色 bg: radial-gradient 氛围层 + 基色 #faf6ed
      bg: 'radial-gradient(1000px 600px at 10% -10%, rgba(193,39,45,0.06) 0%, transparent 55%), radial-gradient(800px 500px at 95% 5%, rgba(120,100,50,0.08) 0%, transparent 60%), #faf6ed',
      surface: '#ffffff',
      surfaceAlt: '#f5f0e0',
      // text 墨黑 #1a1a1a (per spec)
      text: '#1a1a1a',
      textMuted: '#6b6b6b',
      // primary 朱砂红 #c1272d (per spec)
      primary: '#c1272d',
      primaryText: '#ffffff',
      // accent 墨黑 charcoal (墨色副调)
      accent: '#2a2a2a',
      border: '#e8dfc8',
      // 小圆角 4px (纸感)
      radius: '4px',
      // serif 字体 (Georgia + Noto Serif SC)
      fontFamily: 'Georgia,"Noto Serif SC","Songti SC",serif',
      // 亮色轻量阴影
      cardShadow: '0 2px 8px rgba(0,0,0,0.06)',
      // centered 杂志感
      headerStyle: 'centered',
      // 衬线 titleFont (强调标题)
      titleFont: 'Georgia,"Noto Serif SC","Songti SC",serif',
    },
    preview: ['#faf6ed', '#c1272d', '#2a2a2a'],
  },
  {
    // 4. 樱花薄雾 (亮·minimal): 樱粉+灰白+深紫红+大留白+细线+小圆角
    id: 'sakura-mist',
    name: '樱花薄雾',
    desc: '樱粉渐雾底+灰白卡+深紫红主调·大量留白·细线分隔·小圆角 8px·minimal 极简布局',
    layout: 'minimal',
    dark: false,
    read: {
      layout: 'immersive', measure: 740, lineHeight: 1.95, fontBase: 18,
      indent: false, justify: false, toolbar: 'floating', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // 亮色 bg: 樱粉 radial + 灰白基色
      bg: 'radial-gradient(900px 500px at 0% 0%, rgba(255,228,230,0.55) 0%, transparent 55%), radial-gradient(700px 400px at 100% 10%, rgba(255,240,245,0.5) 0%, transparent 60%), #fafafa',
      surface: '#ffffff',
      surfaceAlt: '#fef2f4',
      text: '#4a2c2f',
      textMuted: '#b08591',
      // primary 深紫红 #9d174d (per spec)
      primary: '#9d174d',
      primaryText: '#ffffff',
      // accent 浅粉 #f472b6
      accent: '#f472b6',
      border: '#fce7f3',
      // 小圆角 8px
      radius: '8px',
      fontFamily: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
      // 极简主题: 极轻阴影
      cardShadow: '0 1px 2px rgba(0,0,0,0.04)',
      // centered 极简
      headerStyle: 'centered',
    },
    preview: ['#fafafa', '#9d174d', '#f472b6'],
  },
  {
    // 5. 深海潜行 (暗·theater): 深海蓝+珊瑚橙+大字号 hero+无圆角+stacked
    id: 'deep-ocean',
    name: '深海潜行',
    desc: '深海蓝渐变底+珊瑚橙主调·大字号 hero·无圆角·stacked 排版·theater 沉浸布局',
    layout: 'theater',
    dark: true,
    read: {
      layout: 'classic', measure: 720, lineHeight: 2, fontBase: 18,
      indent: true, justify: false, toolbar: 'inline', texture: 'vignette', chapterDeco: 'none',
    },
    vars: {
      // 暗色 bg: 深海蓝 3 段渐变
      bg: 'linear-gradient(160deg, #022c43 0%, #011c2e 50%, #022c43 100%)',
      surface: 'rgba(255,255,255,0.06)',
      surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#e0f2fe',
      textMuted: 'rgba(224,242,254,0.6)',
      // primary 珊瑚橙 #ff6b35 (per spec)
      primary: '#ff6b35',
      primaryText: '#ffffff',
      // accent 阳光黄 #facc15 (深海透出的光)
      accent: '#facc15',
      border: 'rgba(255,255,255,0.12)',
      // 无圆角 (per spec)
      radius: '0px',
      fontFamily: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
      // 暗色普通阴影: 0 6px 18px rgba(0,0,0,0.5)
      cardShadow: '0 6px 18px rgba(0,0,0,0.5)',
      headerStyle: 'solid',
    },
    preview: ['#022c43', '#ff6b35', '#facc15'],
  },
  {
    // 6. 午夜黄金 (暗·editorial): 黑+金+米白+衬线+金箔纹理+菱形花饰
    id: 'midnight-gold',
    name: '午夜黄金',
    desc: '深黑底+金色主调+米白正文·衬线字体·金箔纹理·菱形花饰·editorial 周刊布局',
    layout: 'editorial',
    dark: true,
    read: {
      layout: 'classic', measure: 720, lineHeight: 2, fontBase: 18,
      indent: true, justify: true, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none',
    },
    vars: {
      // 暗色 bg: 黑色 3 段渐变
      bg: 'linear-gradient(160deg, #0a0a0a 0%, #1a1a1a 50%, #0a0a0a 100%)',
      surface: 'rgba(255,255,255,0.06)',
      surfaceAlt: 'rgba(255,255,255,0.1)',
      // text 米白 #f5f1e3 (per spec)
      text: '#f5f1e3',
      textMuted: 'rgba(245,241,227,0.6)',
      // primary 金色 #d4af37 (per spec)
      primary: '#d4af37',
      primaryText: '#0a0a0a',
      // accent 深金 #b8860b (dark goldenrod, 副色)
      accent: '#b8860b',
      // 金色光晕边框
      border: 'rgba(212,175,55,0.25)',
      // 小圆角 2px (editorial 风)
      radius: '2px',
      // serif 字体
      fontFamily: 'Georgia,"Noto Serif SC","Songti SC",serif',
      // 暗色辉光: primary 金色 glow
      cardShadow: '0 8px 32px rgba(212,175,55,0.35)',
      // split 编辑周刊感
      headerStyle: 'split',
      titleFont: 'Georgia,"Noto Serif SC","Songti SC",serif',
    },
    preview: ['#0a0a0a', '#d4af37', '#b8860b'],
  },
  {
    // 7. 竹简禅意 (亮·list): 竹青+米黄+墨黑+手写字体+纸纹+横线装饰
    id: 'bamboo-zen',
    name: '竹简禅意',
    desc: '竹青主调+米黄底+墨黑正文·手写字体(Ma Shan Zheng)·纸纹·横线装饰·list 列表布局',
    layout: 'list',
    dark: false,
    read: {
      layout: 'classic', measure: 720, lineHeight: 2.1, fontBase: 18,
      indent: true, justify: true, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament',
    },
    vars: {
      // 亮色 bg: 竹青 radial + 米黄基色 #f5f1e3
      bg: 'radial-gradient(900px 500px at 0% 0%, rgba(90,122,58,0.12) 0%, transparent 55%), radial-gradient(700px 400px at 100% 5%, rgba(245,241,227,0.6) 0%, transparent 60%), #f5f1e3',
      // 暖白卡 (复古纸感)
      surface: '#fefdf8',
      surfaceAlt: '#ede8d6',
      // text 墨黑 with green tint
      text: '#2a3a1a',
      textMuted: '#6b7a55',
      // primary 竹青 #5a7a3a (per spec)
      primary: '#5a7a3a',
      primaryText: '#ffffff',
      // accent 墨绿 #2a3a1a (深墨绿, 副调)
      accent: '#2a3a1a',
      border: '#d4d0b8',
      // 小圆角 2px (纸感直角偏)
      radius: '2px',
      // handwritten 字体 (Ma Shan Zheng)
      fontFamily: '"Ma Shan Zheng","Caveat","Noto Serif SC",cursive',
      // 亮色轻量阴影
      cardShadow: '0 2px 8px rgba(0,0,0,0.06)',
      headerStyle: 'split',
    },
    preview: ['#f5f1e3', '#5a7a3a', '#2a3a1a'],
  },
  {
    // 8. 朱砂剧场 (暗·magazine): 朱红+金+黑+戏剧化大标题+3px double 横线+衬线
    id: 'crimson-theater',
    name: '朱砂剧场',
    desc: '朱红主调+金色副调+黑色底·戏剧化大标题·3px double 横线·衬线字体·magazine 杂志布局',
    layout: 'magazine',
    dark: true,
    read: {
      layout: 'classic', measure: 700, lineHeight: 2, fontBase: 18,
      indent: true, justify: false, toolbar: 'inline', texture: 'vignette', chapterDeco: 'none',
    },
    vars: {
      // 暗色 bg: 黑红 3 段渐变 (戏剧化)
      bg: 'linear-gradient(160deg, #0a0a0a 0%, #2a0505 50%, #5a0000 100%)',
      surface: 'rgba(255,255,255,0.06)',
      surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#f5e6e0',
      textMuted: 'rgba(245,230,224,0.6)',
      // primary 朱红 #8b0000 (per spec)
      primary: '#8b0000',
      primaryText: '#ffffff',
      // accent 浅金 #e6c468 (区别于 midnight-gold primary #d4af37)
      accent: '#e6c468',
      border: 'rgba(229,230,224,0.12)',
      // 小圆角 2px (戏剧严肃感)
      radius: '2px',
      // serif 字体 (戏剧衬线)
      fontFamily: 'Georgia,"Noto Serif SC","Songti SC",serif',
      // 暗色辉光: primary 朱红 glow
      cardShadow: '0 8px 32px rgba(139,0,0,0.35)',
      // split 戏剧刊头
      headerStyle: 'split',
      titleFont: 'Georgia,"Noto Serif SC","Songti SC",serif',
    },
    preview: ['#5a0000', '#8b0000', '#e6c468'],
  },
  {
    // 9. 北极冰原 (亮·minimal): 冰蓝白+深海蓝+冰晶 accent+大留白+超细线+无圆角
    id: 'arctic-ice',
    name: '北极冰原',
    desc: '冰蓝白底+深海蓝主调+冰晶副调·大量负空间·超细线·无圆角·minimal 极简布局',
    layout: 'minimal',
    dark: false,
    read: {
      layout: 'immersive', measure: 740, lineHeight: 1.95, fontBase: 18,
      indent: false, justify: false, toolbar: 'floating', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // 亮色 bg: 冰蓝 radial + 冰白基色 #f0f9ff
      bg: 'radial-gradient(1000px 600px at 0% 0%, rgba(125,211,252,0.18) 0%, transparent 55%), radial-gradient(800px 500px at 100% 10%, rgba(186,230,253,0.22) 0%, transparent 60%), #f0f9ff',
      surface: '#ffffff',
      surfaceAlt: '#e0f2fe',
      // text 深海蓝 #075985 (per spec)
      text: '#075985',
      textMuted: '#475569',
      // primary 深海蓝 #075985 (per spec)
      primary: '#075985',
      primaryText: '#ffffff',
      // accent 冰晶 #7dd3fc (per spec)
      accent: '#7dd3fc',
      border: '#bae6fd',
      // 无圆角 (per spec)
      radius: '0px',
      fontFamily: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
      // 极简主题: 极轻阴影
      cardShadow: '0 1px 2px rgba(0,0,0,0.04)',
      headerStyle: 'transparent',
    },
    preview: ['#f0f9ff', '#075985', '#7dd3fc'],
  },
  {
    // 10. 落日余晖 (亮·grid): 橙粉渐变+紫红+暖色 hero+圆角 16px+中等阴影
    id: 'sunset-glow',
    name: '落日余晖',
    desc: '橙粉 3 段渐变底+紫红主调·暖色 hero·圆角 16px·中等阴影·grid 网格布局',
    layout: 'grid',
    dark: false,
    read: {
      layout: 'classic', measure: 720, lineHeight: 2, fontBase: 18,
      indent: true, justify: true, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      // 亮色 bg: 橙粉 3 段渐变 (sunset 方向感)
      bg: 'linear-gradient(160deg, #fef3c7 0%, #fed7aa 50%, #fdba74 100%)',
      surface: '#ffffff',
      surfaceAlt: '#fef3c7',
      text: '#451a03',
      textMuted: '#92400e',
      // primary 紫红 #be185d (per spec)
      primary: '#be185d',
      primaryText: '#ffffff',
      // accent 浅橙 #fb923c (sunset 高光)
      accent: '#fb923c',
      border: 'rgba(249,115,22,0.2)',
      // 中等圆角 16px (per spec)
      radius: '16px',
      fontFamily: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
      // 亮色轻量阴影
      cardShadow: '0 2px 8px rgba(0,0,0,0.06)',
      // gradient 暖色 hero 头
      headerStyle: 'gradient',
    },
    preview: ['#fdba74', '#be185d', '#fb923c'],
  },
  {
    // 11. 森林木屋 (暗·shelf): 深绿+木棕+米黄+复古纸纹+衬线+直角+stacked
    id: 'forest-cabin',
    name: '森林木屋',
    desc: '深绿底+木棕主调+米黄正文·复古纸纹·衬线字体·直角无圆角·shelf 书架布局',
    layout: 'shelf',
    dark: true,
    read: {
      layout: 'classic', measure: 720, lineHeight: 2, fontBase: 18,
      indent: true, justify: true, toolbar: 'inline', texture: 'vignette', chapterDeco: 'none',
    },
    vars: {
      // 暗色 bg: 深绿 3 段渐变
      bg: 'linear-gradient(160deg, #1a3a1a 0%, #0d2a0d 50%, #1a3a1a 100%)',
      surface: 'rgba(255,255,255,0.06)',
      surfaceAlt: 'rgba(255,255,255,0.1)',
      // text 米黄 #f5f1e3 (per spec)
      text: '#f5f1e3',
      textMuted: 'rgba(245,241,227,0.6)',
      // primary 木棕 #5a3a1a (per spec)
      primary: '#5a3a1a',
      primaryText: '#ffffff',
      // accent 苔藓绿 #7a8450 (sage moss)
      accent: '#7a8450',
      border: 'rgba(245,241,227,0.15)',
      // 直角 (per spec)
      radius: '0px',
      // serif 字体 (复古衬线)
      fontFamily: 'Georgia,"Noto Serif SC","Songti SC",serif',
      // 暗色普通阴影: 0 6px 18px rgba(0,0,0,0.5)
      cardShadow: '0 6px 18px rgba(0,0,0,0.5)',
      headerStyle: 'solid',
      titleFont: 'Georgia,"Noto Serif SC","Songti SC",serif',
    },
    preview: ['#1a3a1a', '#5a3a1a', '#7a8450'],
  },
  {
    // 12. 霓虹品红 (暗·masonry): 深紫+品红+青绿+玻璃拟态+大圆角 16px+辉光
    id: 'neon-magenta',
    name: '霓虹品红',
    desc: '深紫底+品红主调+青绿副调·玻璃拟态·大圆角 16px·辉光阴影·masonry 瀑布流布局',
    layout: 'masonry',
    dark: true,
    read: {
      layout: 'classic', measure: 740, lineHeight: 2, fontBase: 18,
      indent: true, justify: true, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none',
    },
    vars: {
      // 暗色 bg: 深紫品红 3 段渐变
      bg: 'linear-gradient(160deg, #1a0510 0%, #2d0a1f 50%, #1a0510 100%)',
      surface: 'rgba(255,255,255,0.06)',
      surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#f5e6f0',
      textMuted: 'rgba(245,230,240,0.6)',
      // primary 品红 #ec4899 (per spec)
      primary: '#ec4899',
      primaryText: '#ffffff',
      // accent 青绿 #10b981 (per spec)
      accent: '#10b981',
      border: 'rgba(236,72,153,0.25)',
      // 大圆角 16px (per spec)
      radius: '16px',
      fontFamily: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
      // 暗色辉光: primary 品红 glow
      cardShadow: '0 8px 32px rgba(236,72,153,0.35)',
      headerStyle: 'gradient',
    },
    preview: ['#1a0510', '#ec4899', '#10b981'],
  },
]

export function getTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) || THEMES[0]
}

/** feat-combo-theme-incremental: 组合主题解析入口
 *  - 先查 5 个手写精仿 preset( THEMES ) —— 命中即返回
 *  - 否则按 `{colorId}-{styleId}-{layoutId}` 解析组合主题(12×12×12=1728)
 *  - 全部未命中返回 undefined, 由调用方决定是否回退 THEMES[0]
 *  本函数是 PublicSite / SiteHeader / admin 校验的唯一入口, 引入组合主题零回归 */
export function getThemeById(id: string | null | undefined): ThemeDef | undefined {
  if (!id) return undefined
  const preset = THEMES.find((t) => t.id === id)
  if (preset) return preset
  const combo = resolveComboTheme(id)
  if (combo) return combo
  return undefined
}
