// ============================================================
// 主题模版注册表 — 9 套完全不同风格的前台主题
// 样式 / 颜色 / 布局 / 阅读版式 全部差异化, 均适配 TDK / SEO / GEO
//
// 双布局维度:
//   layout     → 首页布局 (grid/list/shelf/magazine/minimal/theater/pili)
//   read       → 阅读页布局与排版参数 (经典典书版 / 沉浸暗色 / 分页横滑 / 书屋版)
// read 可缺省: readOf() 会按 READ_DEFAULTS 回退, 旧调用点零破坏
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
  /** 首页布局风格 */
  layout: 'grid' | 'list' | 'shelf' | 'magazine' | 'minimal' | 'theater' | 'pili'
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
  {
    id: 'aurora',
    name: '星夜幻紫',
    desc: '深色玻璃拟态·横向书架·渐变光效·悬浮沉浸阅读',
    layout: 'shelf',
    dark: true,
    read: {
      layout: 'immersive', measure: 720, lineHeight: 2.05, fontBase: 18,
      indent: false, justify: false, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none',
    },
    vars: {
      bg: 'linear-gradient(160deg, #0f0a1e 0%, #1a1033 50%, #120b24 100%)',
      surface: 'rgba(255,255,255,0.06)',
      surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#ede9fe',
      textMuted: '#a78bda',
      primary: '#a855f7',
      primaryText: '#ffffff',
      accent: '#22d3ee',
      border: 'rgba(168,85,247,0.25)',
      radius: '18px',
      fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif',
      cardShadow: '0 8px 32px rgba(168,85,247,0.25)',
      headerStyle: 'gradient',
    },
    preview: ['#1a1033', '#a855f7', '#22d3ee'],
  },
  {
    id: 'paper',
    name: '纸墨书香',
    desc: '复古宣纸质感·衬线字体·典雅书卷气·典书版阅读',
    layout: 'list',
    dark: false,
    read: {
      layout: 'classic', measure: 680, lineHeight: 2, fontBase: 18,
      indent: true, justify: true, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament',
    },
    vars: {
      bg: '#f5efe0',
      surface: '#fdf9ee',
      surfaceAlt: '#f0e8d2',
      text: '#3d2f1e',
      textMuted: '#8a7355',
      primary: '#8b3a2f',
      primaryText: '#fdf9ee',
      accent: '#b8860b',
      border: '#d9c9a3',
      radius: '4px',
      fontFamily: 'Georgia,"Noto Serif SC","Songti SC",serif',
      cardShadow: '0 2px 8px rgba(61,47,30,0.12)',
      headerStyle: 'centered',
      titleFont: '"Noto Serif SC","Songti SC",serif',
    },
    preview: ['#f5efe0', '#8b3a2f', '#b8860b'],
  },
  {
    id: 'mango',
    name: '活力橙夏',
    desc: '明亮暖色·大圆角卡片·网格瀑布流·分页横滑阅读',
    layout: 'grid',
    dark: false,
    read: {
      layout: 'paginated', measure: 480, lineHeight: 1.85, fontBase: 17,
      indent: false, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      bg: '#fff8f0',
      surface: '#ffffff',
      surfaceAlt: '#fff1e0',
      text: '#43301c',
      textMuted: '#a08468',
      primary: '#f97316',
      primaryText: '#ffffff',
      accent: '#16a34a',
      border: '#ffe0c2',
      radius: '22px',
      fontFamily: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
      cardShadow: '0 10px 24px rgba(249,115,22,0.14)',
      headerStyle: 'solid',
    },
    preview: ['#fff8f0', '#f97316', '#16a34a'],
  },
  {
    id: 'bamboo',
    name: '青竹听雨',
    desc: '极简留白·细线分隔·纵向目录式排版·轻典书阅读',
    layout: 'minimal',
    dark: false,
    read: {
      layout: 'classic', measure: 640, lineHeight: 1.95, fontBase: 17,
      indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      bg: '#fafdf7',
      surface: '#ffffff',
      surfaceAlt: '#eef5ea',
      text: '#26382b',
      textMuted: '#7d9482',
      primary: '#16a34a',
      primaryText: '#ffffff',
      accent: '#0d9488',
      border: '#d7e6d5',
      radius: '10px',
      fontFamily: '"Source Han Sans SC","PingFang SC",sans-serif',
      cardShadow: 'none',
      headerStyle: 'split',
    },
    preview: ['#fafdf7', '#16a34a', '#0d9488'],
  },
  {
    id: 'rose',
    name: '玫瑰剧场',
    desc: '暗黑红金·杂志双栏·戏剧化排版·对开分页阅读',
    layout: 'magazine',
    dark: true,
    read: {
      layout: 'paginated', measure: 560, lineHeight: 1.95, fontBase: 18,
      indent: true, justify: true, toolbar: 'bottom', texture: 'vignette', chapterDeco: 'ornament',
    },
    vars: {
      bg: '#160b0e',
      surface: '#241016',
      surfaceAlt: '#33161e',
      text: '#f5e6e8',
      textMuted: '#c497a0',
      primary: '#e11d48',
      primaryText: '#ffffff',
      accent: '#d4a853',
      border: 'rgba(225,29,72,0.35)',
      radius: '8px',
      fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif',
      cardShadow: '0 12px 40px rgba(225,29,72,0.3)',
      headerStyle: 'transparent',
      titleFont: '"Noto Serif SC",serif',
    },
    preview: ['#160b0e', '#e11d48', '#d4a853'],
  },
  {
    id: 'ocean',
    name: '深海影院',
    desc: '冷色沉浸·全宽横幅·影视海报式封面·宽幅沉浸阅读',
    layout: 'theater',
    dark: true,
    read: {
      layout: 'immersive', measure: 780, lineHeight: 2, fontBase: 18,
      indent: false, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'none',
    },
    vars: {
      bg: '#0a1628',
      surface: '#122238',
      surfaceAlt: '#1a3250',
      text: '#e2ecf5',
      textMuted: '#7fa3c0',
      primary: '#38bdf8',
      primaryText: '#082032',
      accent: '#fbbf24',
      border: 'rgba(56,189,248,0.25)',
      radius: '14px',
      fontFamily: '"HarmonyOS Sans SC","PingFang SC",sans-serif',
      cardShadow: '0 8px 28px rgba(2,12,27,0.6)',
      headerStyle: 'transparent',
    },
    preview: ['#0a1628', '#38bdf8', '#fbbf24'],
  },
  {
    id: 'scrolls',
    name: '旧卷典藏',
    desc: '仿经典书站·面包屑典书版·大字疏行旧纸面·绿色题注',
    layout: 'grid',
    dark: false,
    read: {
      layout: 'classic', measure: 760, lineHeight: 2.05, fontBase: 19,
      indent: true, justify: true, toolbar: 'inline', texture: 'paper', chapterDeco: 'rule',
    },
    vars: {
      bg: '#efe7d3',
      surface: '#faf6ea',
      surfaceAlt: '#e7dcc2',
      text: '#43351f',
      textMuted: '#8a7757',
      primary: '#3e6b3a',
      primaryText: '#f7f3e4',
      accent: '#a06a2c',
      border: '#d6c69e',
      radius: '4px',
      fontFamily: 'Georgia,"Noto Serif SC","Songti SC",serif',
      cardShadow: '0 2px 10px rgba(67,53,31,0.14)',
      headerStyle: 'solid',
      titleFont: '"Noto Serif SC","Songti SC",serif',
    },
    preview: ['#efe7d3', '#3e6b3a', '#a06a2c'],
  },
  {
    id: 'nocturne',
    name: '夜航读者',
    desc: '暗夜全幅沉浸阅读器·大字高行距·悬浮工具条·琥珀灯色',
    layout: 'minimal',
    dark: true,
    read: {
      layout: 'immersive', measure: 740, lineHeight: 2.15, fontBase: 19,
      indent: false, justify: false, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none',
    },
    vars: {
      bg: '#101317',
      surface: '#171c22',
      surfaceAlt: '#1e252d',
      text: '#ece7db',
      textMuted: '#98a1ab',
      primary: '#f0a63a',
      primaryText: '#221604',
      accent: '#2dd4bf',
      border: 'rgba(240,166,58,0.22)',
      radius: '12px',
      fontFamily: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
      cardShadow: '0 10px 30px rgba(0,0,0,0.5)',
      headerStyle: 'transparent',
    },
    preview: ['#101317', '#f0a63a', '#2dd4bf'],
  },
  {
    id: 'pili',
    name: '霹雳书屋',
    desc: '仿霹雳书屋·白底暖橙复古书城·奶油分类条·橙色大按钮·书屋版阅读',
    layout: 'pili',
    dark: false,
    read: {
      layout: 'pili', measure: 680, lineHeight: 1.9, fontBase: 18,
      indent: true, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule',
    },
    vars: {
      bg: '#f0efee',
      surface: '#ffffff',
      surfaceAlt: '#f7f3ec',
      text: '#333333',
      textMuted: '#999999',
      primary: '#fd8929',
      primaryText: '#ffffff',
      accent: '#d71704',
      border: '#e6ddd0',
      radius: '3px',
      fontFamily: '"Microsoft YaHei","PingFang SC","HarmonyOS Sans SC",sans-serif',
      cardShadow: '0 1px 4px rgba(125,54,15,0.08)',
      headerStyle: 'pili',
    },
    preview: ['#ffffff', '#fd8929', '#d71704'],
  },
]

export function getTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) || THEMES[0]
}
