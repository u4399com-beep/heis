// ============================================================
// 组合式主题矩阵 — 8 配色 × 8 风格 × 8 布局 = 512 组合
//
// 不预生成全部 512 个 ThemeDef 对象(内存/序列化代价低, 但仍按需合成以保持纯净):
//   getThemeById(themeId)      — 单一组合合成完整 ThemeDef
//   sliceCombos(from, to)      — 惰性切片 [from, to) 的 ThemeListItem[]
//
// 主题 ID 格式: `{colorId}-{styleId}-{layoutId}` (e.g. "violet-glass-biquge-home")
// 与 themes.ts 中的 12 个手写 preset 共存: getThemeById 先查 preset, 未命中再走合成
//
// 配色(8): violet / emerald / rose / amber / cyan / indigo / slate / crimson
//   - 每个配色含 light + dark 双重调色板, 由 Style.dark 决定取用
// 风格(8): minimal / glass / classic / modern / neon / paper / magazine / biquge
//   - glass 与 neon 标记 dark=true, 强制使用配色 dark 调色板
// 布局(8): biquge-home / grid-home / list-home / shelf-home /
//          classic-read / immersive-read / paginated-read / pili-read
// ============================================================
import type { ThemeDef, ThemeReadConfig, ReadVars } from './themes'

// ---------- 公共类型 ----------
export type HeaderStyleKind = 'solid' | 'gradient' | 'transparent' | 'split' | 'centered' | 'pili'
export type ShadowKind = 'none' | 'sm' | 'md' | 'lg' | 'glow' | 'depth'
export type TextureKind = 'none' | 'paper' | 'vignette'
export type ChapterDecoKind = 'rule' | 'ornament' | 'none'
export type HomeLayoutKind = ThemeDef['layout']
export type ReadLayoutKind = ReadVars['layout']

/** 配色调色板(单亮或单暗版本, 由 ColorScheme.light / .dark 持有) */
export interface SchemePalette {
  bg: string
  surface: string
  surfaceAlt: string
  text: string
  textMuted: string
  primary: string
  primaryText: string
  accent: string
  border: string
}

export interface ColorScheme {
  id: string
  name: string
  /** 亮色调色板 (Style.dark=false 时使用) */
  light: SchemePalette
  /** 暗色调色板 (Style.dark=true 时使用, 与 light 互补) */
  dark: SchemePalette
  /** 预览三色: [light-bg, primary, accent] */
  preview: [string, string, string]
}

export interface StyleDef {
  id: string
  name: string
  desc: string
  headerStyle: HeaderStyleKind
  cardShadow: ShadowKind
  radius: number
  fontFamily: 'sans' | 'serif' | 'mono' | 'handwritten'
  texture: TextureKind
  chapterDeco: ChapterDecoKind
  /** 强制使用配色的 dark 调色板 (glass/neon=true) */
  dark: boolean
}

export interface LayoutDef {
  id: string
  name: string
  homeLayout: HomeLayoutKind
  readLayout: ReadLayoutKind
  readVars: ThemeReadConfig
}

// 字体族映射(避免每个 Style 重复长串)
export const FONT_FAMILIES: Record<StyleDef['fontFamily'], string> = {
  sans: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
  serif: 'Georgia,"Noto Serif SC","Songti SC",serif',
  mono: '"JetBrains Mono","Courier New",monospace',
  handwritten: '"Ma Shan Zheng","Caveat","Noto Serif SC",cursive',
}

// 卡片阴影映射(由配色 primary 派生, 透传给 generateTheme 在合成期生成实际值)
function shadowOf(kind: ShadowKind, primary: string, dark: boolean): string {
  switch (kind) {
    case 'none': return 'none'
    case 'sm': return dark ? `0 2px 6px rgba(0,0,0,0.4)` : `0 2px 6px rgba(0,0,0,0.08)`
    case 'md': return dark ? `0 6px 18px rgba(0,0,0,0.5)` : `0 6px 18px rgba(0,0,0,0.12)`
    case 'lg': return dark ? `0 12px 36px rgba(0,0,0,0.6)` : `0 12px 36px rgba(0,0,0,0.16)`
    case 'glow': {
      const m = /^#([0-9a-f]{6})$/i.exec(primary.trim())
      if (m) {
        const n = parseInt(m[1], 16)
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
        return `0 8px 32px rgba(${r},${g},${b},0.35)`
      }
      return `0 8px 32px ${primary}`
    }
    case 'depth': return dark
      ? `0 20px 60px rgba(0,0,0,0.7), 0 8px 16px rgba(0,0,0,0.5)`
      : `0 20px 60px rgba(0,0,0,0.18), 0 8px 16px rgba(0,0,0,0.08)`
  }
}

// ============================================================
// 1. 8 配色方案 — 每个含 light + dark 双调色板
// ============================================================
export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: 'violet', name: '紫罗兰',
    light: {
      bg: '#faf7ff', surface: '#ffffff', surfaceAlt: '#f1e8ff',
      text: '#2e1a47', textMuted: '#7c6da3',
      primary: '#7c3aed', primaryText: '#ffffff',
      accent: '#06b6d4', border: '#e2d5ff',
    },
    dark: {
      bg: 'linear-gradient(160deg, #0f0a1e 0%, #1a1033 50%, #120b24 100%)',
      surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#ede9fe', textMuted: '#a78bda',
      primary: '#a855f7', primaryText: '#ffffff',
      accent: '#22d3ee', border: 'rgba(168,85,247,0.25)',
    },
    preview: ['#faf7ff', '#7c3aed', '#06b6d4'],
  },
  {
    id: 'emerald', name: '翡翠',
    light: {
      bg: '#f0fdf4', surface: '#ffffff', surfaceAlt: '#dcfce7',
      text: '#0a2e1a', textMuted: '#5a8b6f',
      primary: '#059669', primaryText: '#ffffff',
      accent: '#a855f7', border: '#bff0d2',
    },
    dark: {
      bg: 'linear-gradient(160deg, #061a0d 0%, #0a2a1a 50%, #06180c 100%)',
      surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#d0f5e0', textMuted: '#5a9a78',
      primary: '#34d399', primaryText: '#042e1a',
      accent: '#c084fc', border: 'rgba(16,185,129,0.25)',
    },
    preview: ['#f0fdf4', '#059669', '#a855f7'],
  },
  {
    id: 'rose', name: '玫瑰',
    light: {
      bg: '#fff1f4', surface: '#ffffff', surfaceAlt: '#ffe4e6',
      text: '#3b0a1a', textMuted: '#a35573',
      primary: '#e11d48', primaryText: '#ffffff',
      accent: '#f59e0b', border: '#fbcad3',
    },
    dark: {
      bg: 'linear-gradient(160deg, #160b0e 0%, #241016 50%, #14090c 100%)',
      surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#f5e6e8', textMuted: '#c497a0',
      primary: '#fb7185', primaryText: '#3b0a1a',
      accent: '#fbbf24', border: 'rgba(251,113,133,0.3)',
    },
    preview: ['#fff1f4', '#e11d48', '#f59e0b'],
  },
  {
    id: 'amber', name: '琥珀',
    light: {
      bg: '#fffbf0', surface: '#ffffff', surfaceAlt: '#fef3c7',
      text: '#3c2606', textMuted: '#a07033',
      primary: '#d97706', primaryText: '#ffffff',
      accent: '#0f766e', border: '#fbdfae',
    },
    dark: {
      bg: 'linear-gradient(160deg, #1a0e05 0%, #2a180a 50%, #181005 100%)',
      surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#f5d8a0', textMuted: '#a07033',
      primary: '#f59e0b', primaryText: '#2e1805',
      accent: '#14b8a6', border: 'rgba(245,158,11,0.25)',
    },
    preview: ['#fffbf0', '#d97706', '#0f766e'],
  },
  {
    id: 'cyan', name: '青碧',
    light: {
      bg: '#f0fdfa', surface: '#ffffff', surfaceAlt: '#ccfbf1',
      text: '#0a3b3b', textMuted: '#5a8b8b',
      primary: '#0891b2', primaryText: '#ffffff',
      accent: '#f43f5e', border: '#bff0e6',
    },
    dark: {
      bg: 'linear-gradient(160deg, #051a1a 0%, #0a2a2a 50%, #061818 100%)',
      surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#d6f5f0', textMuted: '#5da3a3',
      primary: '#2dd4bf', primaryText: '#042e2a',
      accent: '#fb7185', border: 'rgba(45,212,191,0.25)',
    },
    preview: ['#f0fdfa', '#0891b2', '#f43f5e'],
  },
  {
    id: 'indigo', name: '靛青',
    light: {
      bg: '#f6f7fe', surface: '#ffffff', surfaceAlt: '#e7e9fb',
      text: '#1e1b4b', textMuted: '#6b6fb0',
      primary: '#4f46e5', primaryText: '#ffffff',
      accent: '#f59e0b', border: '#d8d5f7',
    },
    dark: {
      bg: 'linear-gradient(160deg, #0b0f1e 0%, #161b35 50%, #0e1124 100%)',
      surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#e0e2fb', textMuted: '#8b8fb0',
      primary: '#6366f1', primaryText: '#ffffff',
      accent: '#fbbf24', border: 'rgba(99,102,241,0.25)',
    },
    preview: ['#f6f7fe', '#4f46e5', '#f59e0b'],
  },
  {
    id: 'slate', name: '石板',
    light: {
      bg: '#f8fafc', surface: '#ffffff', surfaceAlt: '#e2e8f0',
      text: '#1e293b', textMuted: '#64748b',
      primary: '#475569', primaryText: '#ffffff',
      accent: '#0ea5e9', border: '#cbd5e1',
    },
    dark: {
      bg: 'linear-gradient(160deg, #0b1118 0%, #161e29 50%, #0a1018 100%)',
      surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#e2e8f0', textMuted: '#7d8aa0',
      primary: '#94a3b8', primaryText: '#0f172a',
      accent: '#38bdf8', border: 'rgba(148,163,184,0.25)',
    },
    preview: ['#f8fafc', '#475569', '#0ea5e9'],
  },
  {
    id: 'crimson', name: '朱砂',
    light: {
      bg: '#fef2f2', surface: '#ffffff', surfaceAlt: '#fee2e2',
      text: '#3b0d0d', textMuted: '#a35454',
      primary: '#dc2626', primaryText: '#ffffff',
      accent: '#fbbf24', border: '#fcc6c6',
    },
    dark: {
      bg: 'linear-gradient(160deg, #1a0606 0%, #2a0d0d 50%, #180808 100%)',
      surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)',
      text: '#f5c8c8', textMuted: '#a35454',
      primary: '#ef4444', primaryText: '#3b0d0d',
      accent: '#fbbf24', border: 'rgba(239,68,68,0.25)',
    },
    preview: ['#fef2f2', '#dc2626', '#fbbf24'],
  },
]

// ============================================================
// 2. 8 风格 (glass/neon 标记 dark=true 强制暗色)
// ============================================================
export const STYLES: StyleDef[] = [
  { id: 'minimal', name: '极简', desc: '白底极简·细线分隔·sans 字体', headerStyle: 'solid', cardShadow: 'none', radius: 4, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule', dark: false },
  { id: 'glass', name: '玻璃拟态', desc: '半透磨砂卡片·辉光阴影·大圆角·暗色基底', headerStyle: 'gradient', cardShadow: 'glow', radius: 16, fontFamily: 'sans', texture: 'none', chapterDeco: 'none', dark: true },
  { id: 'classic', name: '书卷典雅', desc: '居中标题·小圆角·纸纹横线·衬线', headerStyle: 'centered', cardShadow: 'sm', radius: 4, fontFamily: 'serif', texture: 'paper', chapterDeco: 'rule', dark: false },
  { id: 'modern', name: '现代卡片', desc: '中圆角·中等阴影·横线分隔', headerStyle: 'solid', cardShadow: 'md', radius: 12, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule', dark: false },
  { id: 'neon', name: '暗夜霓虹', desc: '霓虹渐变·辉光晕染·无装饰·暗色基底', headerStyle: 'gradient', cardShadow: 'glow', radius: 12, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none', dark: true },
  { id: 'paper', name: '纸面纹理', desc: '宣纸纹理·衬线字体·菱形花饰', headerStyle: 'solid', cardShadow: 'sm', radius: 4, fontFamily: 'serif', texture: 'paper', chapterDeco: 'ornament', dark: false },
  { id: 'magazine', name: '杂志风', desc: '分栏标题·中阴影·菱形花饰·衬线', headerStyle: 'split', cardShadow: 'md', radius: 8, fontFamily: 'serif', texture: 'none', chapterDeco: 'ornament', dark: false },
  { id: 'biquge', name: '笔趣阁', desc: '简单表格·直角卡片·白底绿链', headerStyle: 'solid', cardShadow: 'none', radius: 2, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule', dark: false },
]

// ============================================================
// 3. 8 布局 (4 home-focused + 4 read-focused)
// ============================================================
export const LAYOUTS: LayoutDef[] = [
  { id: 'biquge-home', name: '笔趣阁首页', homeLayout: 'biquge', readLayout: 'classic', readVars: { layout: 'classic', measure: 680, lineHeight: 1.9, fontBase: 17, indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule' } },
  { id: 'grid-home', name: '网格首页', homeLayout: 'grid', readLayout: 'classic', readVars: { layout: 'classic', measure: 680, lineHeight: 2, fontBase: 17, indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule' } },
  { id: 'list-home', name: '列表首页', homeLayout: 'list', readLayout: 'classic', readVars: { layout: 'classic', measure: 700, lineHeight: 2, fontBase: 18, indent: true, justify: true, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament' } },
  { id: 'shelf-home', name: '书架首页', homeLayout: 'shelf', readLayout: 'classic', readVars: { layout: 'classic', measure: 720, lineHeight: 2, fontBase: 18, indent: true, justify: true, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament' } },
  { id: 'classic-read', name: '经典阅读', homeLayout: 'grid', readLayout: 'classic', readVars: { layout: 'classic', measure: 720, lineHeight: 2, fontBase: 18, indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule' } },
  { id: 'immersive-read', name: '沉浸阅读', homeLayout: 'minimal', readLayout: 'immersive', readVars: { layout: 'immersive', measure: 740, lineHeight: 2.1, fontBase: 18, indent: false, justify: false, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none' } },
  { id: 'paginated-read', name: '分页阅读', homeLayout: 'grid', readLayout: 'paginated', readVars: { layout: 'paginated', measure: 480, lineHeight: 1.85, fontBase: 17, indent: false, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'pili-read', name: '霹雳阅读', homeLayout: 'pili', readLayout: 'pili', readVars: { layout: 'pili', measure: 680, lineHeight: 1.9, fontBase: 18, indent: true, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
]

// 索引: 用 ID 快速查找
const COLOR_BY_ID = new Map(COLOR_SCHEMES.map((c) => [c.id, c]))
const STYLE_BY_ID = new Map(STYLES.map((s) => [s.id, s]))
const LAYOUT_BY_ID = new Map(LAYOUTS.map((l) => [l.id, l]))

export const COLOR_COUNT = COLOR_SCHEMES.length
export const STYLE_COUNT = STYLES.length
export const LAYOUT_COUNT = LAYOUTS.length
export const TOTAL_COMBOS = COLOR_COUNT * STYLE_COUNT * LAYOUT_COUNT

// ============================================================
// 4. 合成函数: colorId + styleId + layoutId → ThemeDef
// ============================================================
export function generateTheme(colorSchemeId: string, styleId: string, layoutId: string): ThemeDef | undefined {
  const c = COLOR_BY_ID.get(colorSchemeId)
  const s = STYLE_BY_ID.get(styleId)
  const l = LAYOUT_BY_ID.get(layoutId)
  if (!c || !s || !l) return undefined

  // 由 style.dark 决定取 light 还是 dark 调色板
  const palette: SchemePalette = s.dark ? c.dark : c.light
  const id = `${c.id}-${s.id}-${l.id}`
  const name = `${c.name}·${s.name}·${l.name}`
  const desc = `${s.desc} · ${s.dark ? '暗色' : '亮色'} · ${l.name}`

  // read: 布局自带 readVars, 但 texture/chapterDeco 由 style 覆盖(保留视觉一致性)
  const read: ThemeReadConfig = {
    ...l.readVars,
    texture: s.texture,
    chapterDeco: s.chapterDeco,
  }

  return {
    id,
    name,
    desc,
    layout: l.homeLayout,
    dark: s.dark,
    read,
    vars: {
      bg: palette.bg,
      surface: palette.surface,
      surfaceAlt: palette.surfaceAlt,
      text: palette.text,
      textMuted: palette.textMuted,
      primary: palette.primary,
      primaryText: palette.primaryText,
      accent: palette.accent,
      border: palette.border,
      radius: `${s.radius}px`,
      fontFamily: FONT_FAMILIES[s.fontFamily],
      cardShadow: shadowOf(s.cardShadow, palette.primary, s.dark),
      headerStyle: s.headerStyle,
      titleFont: s.fontFamily === 'serif' ? '"Noto Serif SC","Songti SC",serif' : undefined,
    },
    preview: c.preview,
  }
}

/** 解析主题 ID → (colorId, styleId, layoutId)
 *  ID 形如 `violet-glass-biquge-home` —— colorId/styleId 不含 `-`,
 *  layoutId 可含一个 `-` (如 `biquge-home` / `classic-read`)。
 *  通过对预定义 ID 列表 endsWith 匹配消歧。 */
export function parseThemeId(themeId: string): { colorId: string; styleId: string; layoutId: string } | undefined {
  if (!themeId || typeof themeId !== 'string') return undefined
  // 优先精确匹配预定义 layout (8 个, ID 唯一)
  for (const l of LAYOUTS) {
    if (themeId.endsWith(`-${l.id}`)) {
      const rest = themeId.slice(0, themeId.length - l.id.length - 1) // 去掉 `-${l.id}`
      // 再匹配 style (8 个, ID 唯一)
      for (const s of STYLES) {
        if (rest.endsWith(`-${s.id}`)) {
          const colorId = rest.slice(0, rest.length - s.id.length - 1)
          if (COLOR_BY_ID.has(colorId)) {
            return { colorId, styleId: s.id, layoutId: l.id }
          }
        }
      }
    }
  }
  return undefined
}

/** 单一解析: 主题 ID → 完整 ThemeDef */
export function getThemeById(themeId: string): ThemeDef | undefined {
  if (!themeId) return undefined
  const parsed = parseThemeId(themeId)
  if (!parsed) return undefined
  return generateTheme(parsed.colorId, parsed.styleId, parsed.layoutId)
}

// ============================================================
// 5. 轻量描述符 (admin 列表 API 用)
// ============================================================
export interface ThemeListItem {
  id: string
  name: string
  desc: string
  layout: HomeLayoutKind
  dark: boolean
  read?: { layout: ReadLayoutKind }
  preview: [string, string, string]
}

/** 组合主题切片生成器(惰性, 仅生成本页所需项, 不构建全量 512 数组)
 *  combos 全局序: colorIdx * STYLE_COUNT * LAYOUT_COUNT + styleIdx * LAYOUT_COUNT + layoutIdx
 *  返回 [from, to) 区间内的 ThemeListItem[] */
export function sliceCombos(from: number, to: number): ThemeListItem[] {
  const out: ThemeListItem[] = []
  const total = TOTAL_COMBOS
  const lo = Math.max(0, from)
  const hi = Math.min(total, to)
  if (lo >= hi) return out
  for (let i = lo; i < hi; i++) {
    const cIdx = Math.floor(i / (STYLE_COUNT * LAYOUT_COUNT))
    const rem = i - cIdx * STYLE_COUNT * LAYOUT_COUNT
    const sIdx = Math.floor(rem / LAYOUT_COUNT)
    const lIdx = rem - sIdx * LAYOUT_COUNT
    const c = COLOR_SCHEMES[cIdx]
    const s = STYLES[sIdx]
    const l = LAYOUTS[lIdx]
    if (!c || !s || !l) continue
    out.push({
      id: `${c.id}-${s.id}-${l.id}`,
      name: `${c.name}·${s.name}·${l.name}`,
      desc: `${s.desc} · ${s.dark ? '暗色' : '亮色'} · ${l.name}`,
      layout: l.homeLayout,
      dark: s.dark,
      read: { layout: l.readLayout },
      preview: c.preview,
    })
  }
  return out
}
