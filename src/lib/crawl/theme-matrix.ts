// ============================================================
// 组合式主题矩阵 — 50 配色 × 42 风格 × 24 布局 = 50400 组合
//
// 不预生成全部 50400 个 ThemeDef 对象(内存/序列化代价高), 而是按需合成:
//   getThemeById(themeId)      — 单一组合合成完整 ThemeDef
//   getThemeList()             — 全部 50400 组合的轻量描述符(id/name/desc/preview)
//   getThemesPage(page, size)  — 分页
//
// 主题 ID 格式: `{colorId}-{styleId}-{layoutId}` (e.g. "violet-glasswa-grid-cl")
// 与 themes.ts 中的 10 个手写 preset 共存: getThemeById 先查 preset, 未命中再走合成
// ============================================================
import type { ThemeDef, ThemeReadConfig, ReadVars } from './themes'

// ---------- 公共类型 ----------
export type HeaderStyleKind = 'solid' | 'gradient' | 'transparent' | 'split' | 'centered' | 'pili'
export type ShadowKind = 'none' | 'sm' | 'md' | 'lg' | 'glow' | 'depth'
export type TextureKind = 'none' | 'paper' | 'vignette'
export type ChapterDecoKind = 'rule' | 'ornament' | 'none'
export type HomeLayoutKind = ThemeDef['layout']
export type ReadLayoutKind = ReadVars['layout']

export interface ColorScheme {
  id: string
  name: string
  dark: boolean
  bg: string
  surface: string
  surfaceAlt: string
  text: string
  textMuted: string
  primary: string
  primaryText: string
  accent: string
  border: string
  /** 预览三色: [bg, primary, accent] */
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
      // primary 色辉光
      const m = /^#([0-9a-f]{6})$/i.exec(primary.trim())
      if (m) {
        const n = parseInt(m[1], 16)
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
        return `0 8px 32px rgba(${r},${g},${b},0.35)`
      }
      return `0 8px 32px ${primary}`
    }
    case 'depth': return dark ? `0 20px 60px rgba(0,0,0,0.7), 0 8px 16px rgba(0,0,0,0.5)` : `0 20px 60px rgba(0,0,0,0.18), 0 8px 16px rgba(0,0,0,0.08)`
  }
}

// ============================================================
// 1. 50 配色方案 (25 light + 25 dark)
// ============================================================
export const COLOR_SCHEMES: ColorScheme[] = [
  // ---------- 亮色 25 ----------
  { id: 'violet', name: '紫罗兰', dark: false, bg: '#faf7ff', surface: '#ffffff', surfaceAlt: '#f1e8ff', text: '#2e1a47', textMuted: '#7c6da3', primary: '#7c3aed', primaryText: '#ffffff', accent: '#06b6d4', border: '#e2d5ff', preview: ['#faf7ff', '#7c3aed', '#06b6d4'] },
  { id: 'indigo', name: '靛青', dark: false, bg: '#f6f7fe', surface: '#ffffff', surfaceAlt: '#e7e9fb', text: '#1e1b4b', textMuted: '#6b6fb0', primary: '#4f46e5', primaryText: '#ffffff', accent: '#f59e0b', border: '#d8d5f7', preview: ['#f6f7fe', '#4f46e5', '#f59e0b'] },
  { id: 'blue', name: '海蓝', dark: false, bg: '#f4f8fc', surface: '#ffffff', surfaceAlt: '#e1edf7', text: '#0f2a47', textMuted: '#5a779a', primary: '#0284c7', primaryText: '#ffffff', accent: '#f97316', border: '#d2e3f1', preview: ['#f4f8fc', '#0284c7', '#f97316'] },
  { id: 'cyan', name: '青碧', dark: false, bg: '#f0fdfa', surface: '#ffffff', surfaceAlt: '#ccfbf1', text: '#0a3b3b', textMuted: '#5a8b8b', primary: '#0d9488', primaryText: '#ffffff', accent: '#f43f5e', border: '#bff0e6', preview: ['#f0fdfa', '#0d9488', '#f43f5e'] },
  { id: 'teal', name: '蓝绿', dark: false, bg: '#f2fafa', surface: '#ffffff', surfaceAlt: '#d2f0ee', text: '#0d2e2c', textMuted: '#557a78', primary: '#14b8a6', primaryText: '#ffffff', accent: '#fb923c', border: '#c6ebe8', preview: ['#f2fafa', '#14b8a6', '#fb923c'] },
  { id: 'emerald', name: '翡翠', dark: false, bg: '#f0fdf4', surface: '#ffffff', surfaceAlt: '#dcfce7', text: '#0a2e1a', textMuted: '#5a8b6f', primary: '#10b981', primaryText: '#ffffff', accent: '#a855f7', border: '#bff0d2', preview: ['#f0fdf4', '#10b981', '#a855f7'] },
  { id: 'green', name: '草绿', dark: false, bg: '#f4faf3', surface: '#ffffff', surfaceAlt: '#dcefd5', text: '#1a2e15', textMuted: '#5e8b54', primary: '#16a34a', primaryText: '#ffffff', accent: '#dc2626', border: '#cde8c0', preview: ['#f4faf3', '#16a34a', '#dc2626'] },
  { id: 'lime', name: '青柠', dark: false, bg: '#f7fee7', surface: '#ffffff', surfaceAlt: '#ecfccb', text: '#1a2a05', textMuted: '#6b7d3b', primary: '#65a30d', primaryText: '#ffffff', accent: '#db2777', border: '#d7f1a5', preview: ['#f7fee7', '#65a30d', '#db2777'] },
  { id: 'yellow', name: '麦黄', dark: false, bg: '#fefce8', surface: '#ffffff', surfaceAlt: '#fef9c3', text: '#3d2c0a', textMuted: '#9a7a3a', primary: '#ca8a04', primaryText: '#ffffff', accent: '#0ea5e9', border: '#fde9a4', preview: ['#fefce8', '#ca8a04', '#0ea5e9'] },
  { id: 'amber', name: '琥珀', dark: false, bg: '#fffbf0', surface: '#ffffff', surfaceAlt: '#fef3c7', text: '#3c2606', textMuted: '#a07033', primary: '#d97706', primaryText: '#ffffff', accent: '#0f766e', border: '#fbdfae', preview: ['#fffbf0', '#d97706', '#0f766e'] },
  { id: 'orange', name: '橙夏', dark: false, bg: '#fff7ed', surface: '#ffffff', surfaceAlt: '#ffedd5', text: '#3d1f06', textMuted: '#9a6633', primary: '#ea580c', primaryText: '#ffffff', accent: '#16a34a', border: '#fcdcb2', preview: ['#fff7ed', '#ea580c', '#16a34a'] },
  { id: 'red', name: '朱砂', dark: false, bg: '#fef2f2', surface: '#ffffff', surfaceAlt: '#fee2e2', text: '#3b0d0d', textMuted: '#a35454', primary: '#dc2626', primaryText: '#ffffff', accent: '#fbbf24', border: '#fcc6c6', preview: ['#fef2f2', '#dc2626', '#fbbf24'] },
  { id: 'rose', name: '玫瑰', dark: false, bg: '#fff1f4', surface: '#ffffff', surfaceAlt: '#ffe4e6', text: '#3b0a1a', textMuted: '#a35573', primary: '#e11d48', primaryText: '#ffffff', accent: '#f59e0b', border: '#fbcad3', preview: ['#fff1f4', '#e11d48', '#f59e0b'] },
  { id: 'pink', name: '樱花', dark: false, bg: '#fdf2f8', surface: '#ffffff', surfaceAlt: '#fce7f3', text: '#3b0a26', textMuted: '#a35a8a', primary: '#db2777', primaryText: '#ffffff', accent: '#10b981', border: '#f6c7dd', preview: ['#fdf2f8', '#db2777', '#10b981'] },
  { id: 'fuchsia', name: '紫红', dark: false, bg: '#fdf4ff', surface: '#ffffff', surfaceAlt: '#fae8ff', text: '#3b0a3b', textMuted: '#a35aa3', primary: '#c026d3', primaryText: '#ffffff', accent: '#10b981', border: '#f3c5f3', preview: ['#fdf4ff', '#c026d3', '#10b981'] },
  { id: 'purple', name: '紫晶', dark: false, bg: '#faf5ff', surface: '#ffffff', surfaceAlt: '#f3e8ff', text: '#2e0a3b', textMuted: '#7c5a8b', primary: '#9333ea', primaryText: '#ffffff', accent: '#facc15', border: '#e0c5f3', preview: ['#faf5ff', '#9333ea', '#facc15'] },
  // 双色 9 个 (亮)
  { id: 'vio-gold', name: '紫金', dark: false, bg: '#faf6ff', surface: '#ffffff', surfaceAlt: '#f3e8d2', text: '#2a1a47', textMuted: '#807060', primary: '#7c3aed', primaryText: '#ffffff', accent: '#d4a017', border: '#e4d5b5', preview: ['#faf6ff', '#7c3aed', '#d4a017'] },
  { id: 'rose-teal', name: '玫瑰青', dark: false, bg: '#fdf2f6', surface: '#ffffff', surfaceAlt: '#d2f0ee', text: '#3b0a26', textMuted: '#706b80', primary: '#e11d48', primaryText: '#ffffff', accent: '#14b8a6', border: '#e6c5d6', preview: ['#fdf2f6', '#e11d48', '#14b8a6'] },
  { id: 'blu-amber', name: '蓝琥珀', dark: false, bg: '#f1f6fc', surface: '#ffffff', surfaceAlt: '#f7e8c2', text: '#0f2a47', textMuted: '#5a6c80', primary: '#0284c7', primaryText: '#ffffff', accent: '#d97706', border: '#c8d8e8', preview: ['#f1f6fc', '#0284c7', '#d97706'] },
  { id: 'emr-orng', name: '翠橙', dark: false, bg: '#f0faf3', surface: '#ffffff', surfaceAlt: '#fce4cd', text: '#0a2e1a', textMuted: '#557a60', primary: '#10b981', primaryText: '#ffffff', accent: '#ea580c', border: '#bfe8c5', preview: ['#f0faf3', '#10b981', '#ea580c'] },
  { id: 'pnk-prp', name: '粉紫', dark: false, bg: '#fdf0fb', surface: '#ffffff', surfaceAlt: '#f0d8fa', text: '#3b0a2a', textMuted: '#a05a99', primary: '#ec4899', primaryText: '#ffffff', accent: '#9333ea', border: '#f3c5e8', preview: ['#fdf0fb', '#ec4899', '#9333ea'] },
  { id: 'cyn-mag', name: '青品', dark: false, bg: '#f0fdfb', surface: '#ffffff', surfaceAlt: '#fce0f5', text: '#0a3b35', textMuted: '#5a8b7c', primary: '#06b6d4', primaryText: '#ffffff', accent: '#d946ef', border: '#bdeee5', preview: ['#f0fdfb', '#06b6d4', '#d946ef'] },
  { id: 'amb-ros', name: '琥珀玫', dark: false, bg: '#fff7ec', surface: '#ffffff', surfaceAlt: '#ffe1e6', text: '#3c2606', textMuted: '#a07a5a', primary: '#d97706', primaryText: '#ffffff', accent: '#e11d48', border: '#f3d8b5', preview: ['#fff7ec', '#d97706', '#e11d48'] },
  { id: 'tel-crl', name: '青珊瑚', dark: false, bg: '#f0fafa', surface: '#ffffff', surfaceAlt: '#ffe0d8', text: '#0d2e2c', textMuted: '#5a807a', primary: '#14b8a6', primaryText: '#ffffff', accent: '#fb7185', border: '#c5e8e5', preview: ['#f0fafa', '#14b8a6', '#fb7185'] },
  { id: 'lim-vio', name: '柠紫', dark: false, bg: '#f7fdf0', surface: '#ffffff', surfaceAlt: '#ecd2f5', text: '#1a2a05', textMuted: '#6b7d5a', primary: '#84cc16', primaryText: '#ffffff', accent: '#9333ea', border: '#d8e8b5', preview: ['#f7fdf0', '#84cc16', '#9333ea'] },

  // ---------- 暗色 25 ----------
  { id: 'violet-d', name: '紫罗兰·夜', dark: true, bg: 'linear-gradient(160deg, #0f0a1e 0%, #1a1033 50%, #120b24 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#ede9fe', textMuted: '#a78bda', primary: '#a855f7', primaryText: '#ffffff', accent: '#22d3ee', border: 'rgba(168,85,247,0.25)', preview: ['#1a1033', '#a855f7', '#22d3ee'] },
  { id: 'indigo-d', name: '靛青·夜', dark: true, bg: 'linear-gradient(160deg, #0b0f1e 0%, #161b35 50%, #0e1124 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#e0e2fb', textMuted: '#8b8fb0', primary: '#6366f1', primaryText: '#ffffff', accent: '#fbbf24', border: 'rgba(99,102,241,0.25)', preview: ['#161b35', '#6366f1', '#fbbf24'] },
  { id: 'blue-d', name: '海蓝·夜', dark: true, bg: 'linear-gradient(160deg, #07121f 0%, #112238 50%, #0a1628 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#e2ecf5', textMuted: '#7fa3c0', primary: '#38bdf8', primaryText: '#082032', accent: '#fbbf24', border: 'rgba(56,189,248,0.25)', preview: ['#0a1628', '#38bdf8', '#fbbf24'] },
  { id: 'cyan-d', name: '青碧·夜', dark: true, bg: 'linear-gradient(160deg, #051a1a 0%, #0a2a2a 50%, #061818 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#d6f5f0', textMuted: '#5da3a3', primary: '#2dd4bf', primaryText: '#042e2a', accent: '#fb7185', border: 'rgba(45,212,191,0.25)', preview: ['#0a2a2a', '#2dd4bf', '#fb7185'] },
  { id: 'teal-d', name: '蓝绿·夜', dark: true, bg: 'linear-gradient(160deg, #061a1a 0%, #0d2a2a 50%, #081818 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#d0f0ee', textMuted: '#5a8b8b', primary: '#14b8a6', primaryText: '#042e2a', accent: '#fb923c', border: 'rgba(20,184,166,0.25)', preview: ['#0d2a2a', '#14b8a6', '#fb923c'] },
  { id: 'emerald-d', name: '翡翠·夜', dark: true, bg: 'linear-gradient(160deg, #061a0d 0%, #0a2a1a 50%, #06180c 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#d0f5e0', textMuted: '#5a9a78', primary: '#10b981', primaryText: '#042e1a', accent: '#c084fc', border: 'rgba(16,185,129,0.25)', preview: ['#0a2a1a', '#10b981', '#c084fc'] },
  { id: 'green-d', name: '草绿·夜', dark: true, bg: 'linear-gradient(160deg, #06180a 0%, #0d2a14 50%, #081a0c 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#d8f0d8', textMuted: '#6b8b54', primary: '#22c55e', primaryText: '#042e0a', accent: '#f87171', border: 'rgba(34,197,94,0.25)', preview: ['#0d2a14', '#22c55e', '#f87171'] },
  { id: 'lime-d', name: '青柠·夜', dark: true, bg: 'linear-gradient(160deg, #0a1a05 0%, #1a2a0a 50%, #0a1805 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#e0f0c2', textMuted: '#7d8b3b', primary: '#a3e635', primaryText: '#1a2a05', accent: '#f472b6', border: 'rgba(163,230,53,0.25)', preview: ['#1a2a0a', '#a3e635', '#f472b6'] },
  { id: 'yellow-d', name: '麦黄·夜', dark: true, bg: 'linear-gradient(160deg, #1a1605 0%, #2a260a 50%, #181405 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5e8a0', textMuted: '#9a7a3a', primary: '#facc15', primaryText: '#3d2c0a', accent: '#60a5fa', border: 'rgba(250,204,21,0.25)', preview: ['#2a260a', '#facc15', '#60a5fa'] },
  { id: 'amber-d', name: '琥珀·夜', dark: true, bg: 'linear-gradient(160deg, #1a0e05 0%, #2a180a 50%, #181005 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5d8a0', textMuted: '#a07033', primary: '#f59e0b', primaryText: '#2e1805', accent: '#14b8a6', border: 'rgba(245,158,11,0.25)', preview: ['#2a180a', '#f59e0b', '#14b8a6'] },
  { id: 'orange-d', name: '橙夏·夜', dark: true, bg: 'linear-gradient(160deg, #1a0d05 0%, #2a160a 50%, #180c05 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5c8a0', textMuted: '#a06633', primary: '#fb923c', primaryText: '#3d1f06', accent: '#34d399', border: 'rgba(251,146,60,0.25)', preview: ['#2a160a', '#fb923c', '#34d399'] },
  { id: 'red-d', name: '朱砂·夜', dark: true, bg: 'linear-gradient(160deg, #1a0606 0%, #2a0d0d 50%, #180808 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5c8c8', textMuted: '#a35454', primary: '#ef4444', primaryText: '#3b0d0d', accent: '#fbbf24', border: 'rgba(239,68,68,0.25)', preview: ['#2a0d0d', '#ef4444', '#fbbf24'] },
  { id: 'rose-d', name: '玫瑰·夜', dark: true, bg: 'linear-gradient(160deg, #160b0e 0%, #241016 50%, #14090c 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5e6e8', textMuted: '#c497a0', primary: '#fb7185', primaryText: '#3b0a1a', accent: '#fbbf24', border: 'rgba(251,113,133,0.3)', preview: ['#241016', '#fb7185', '#fbbf24'] },
  { id: 'pink-d', name: '樱花·夜', dark: true, bg: 'linear-gradient(160deg, #1a0a1a 0%, #2a0d24 50%, #180818 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5d8e8', textMuted: '#a35a8a', primary: '#f472b6', primaryText: '#3b0a26', accent: '#34d399', border: 'rgba(244,114,182,0.25)', preview: ['#2a0d24', '#f472b6', '#34d399'] },
  { id: 'fuchsia-d', name: '紫红·夜', dark: true, bg: 'linear-gradient(160deg, #1a0a1a 0%, #2a0d2a 50%, #18081a 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5d8f5', textMuted: '#a35aa3', primary: '#e879f9', primaryText: '#3b0a3b', accent: '#22d3ee', border: 'rgba(232,121,249,0.25)', preview: ['#2a0d2a', '#e879f9', '#22d3ee'] },
  { id: 'purple-d', name: '紫晶·夜', dark: true, bg: 'linear-gradient(160deg, #0a0518 0%, #1a0a2e 50%, #0c0620 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#e8d8f5', textMuted: '#a07adb', primary: '#c084fc', primaryText: '#2e0a3b', accent: '#facc15', border: 'rgba(192,132,252,0.25)', preview: ['#1a0a2e', '#c084fc', '#facc15'] },
  // 双色 9 个 (暗)
  { id: 'vio-gold-d', name: '紫金·夜', dark: true, bg: 'linear-gradient(160deg, #0f0a1e 0%, #1a1033 50%, #1a1408 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#ede9fe', textMuted: '#a89a7d', primary: '#a855f7', primaryText: '#ffffff', accent: '#fbbf24', border: 'rgba(168,85,247,0.25)', preview: ['#1a1033', '#a855f7', '#fbbf24'] },
  { id: 'rose-teal-d', name: '玫瑰青·夜', dark: true, bg: 'linear-gradient(160deg, #160b14 0%, #241016 50%, #0a2a26 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5e6e8', textMuted: '#c4909c', primary: '#fb7185', primaryText: '#ffffff', accent: '#2dd4bf', border: 'rgba(251,113,133,0.25)', preview: ['#241016', '#fb7185', '#2dd4bf'] },
  { id: 'blu-amber-d', name: '蓝琥珀·夜', dark: true, bg: 'linear-gradient(160deg, #07121f 0%, #112238 50%, #2a1c08 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#e2ecf5', textMuted: '#7f9aaa', primary: '#38bdf8', primaryText: '#082032', accent: '#f59e0b', border: 'rgba(56,189,248,0.25)', preview: ['#112238', '#38bdf8', '#f59e0b'] },
  { id: 'emr-orng-d', name: '翠橙·夜', dark: true, bg: 'linear-gradient(160deg, #061a0d 0%, #0a2a1a 50%, #2a160a 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#d0f5e0', textMuted: '#6a9a78', primary: '#34d399', primaryText: '#042e1a', accent: '#fb923c', border: 'rgba(52,211,153,0.25)', preview: ['#0a2a1a', '#34d399', '#fb923c'] },
  { id: 'pnk-prp-d', name: '粉紫·夜', dark: true, bg: 'linear-gradient(160deg, #1a0a16 0%, #2a0d24 50%, #1a0a2e 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5d8e8', textMuted: '#a36a99', primary: '#f472b6', primaryText: '#ffffff', accent: '#c084fc', border: 'rgba(244,114,182,0.25)', preview: ['#2a0d24', '#f472b6', '#c084fc'] },
  { id: 'cyn-mag-d', name: '青品·夜', dark: true, bg: 'linear-gradient(160deg, #06181a 0%, #0a2a26 50%, #2a0a26 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#d6f5f0', textMuted: '#5d9a8b', primary: '#22d3ee', primaryText: '#042e2a', accent: '#e879f9', border: 'rgba(34,211,238,0.25)', preview: ['#0a2a26', '#22d3ee', '#e879f9'] },
  { id: 'amb-ros-d', name: '琥珀玫·夜', dark: true, bg: 'linear-gradient(160deg, #1a0e05 0%, #2a180a 50%, #241016 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#f5d8a0', textMuted: '#a07a5a', primary: '#f59e0b', primaryText: '#2e1805', accent: '#fb7185', border: 'rgba(245,158,11,0.25)', preview: ['#2a180a', '#f59e0b', '#fb7185'] },
  { id: 'tel-crl-d', name: '青珊瑚·夜', dark: true, bg: 'linear-gradient(160deg, #06181a 0%, #0a2a2a 50%, #2a140d 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#d0f0ee', textMuted: '#5a8a87', primary: '#2dd4bf', primaryText: '#042e2a', accent: '#fb7185', border: 'rgba(45,212,191,0.25)', preview: ['#0a2a2a', '#2dd4bf', '#fb7185'] },
  { id: 'lim-vio-d', name: '柠紫·夜', dark: true, bg: 'linear-gradient(160deg, #0a1a05 0%, #1a2a0a 50%, #1a0a2e 100%)', surface: 'rgba(255,255,255,0.06)', surfaceAlt: 'rgba(255,255,255,0.1)', text: '#e0f0c2', textMuted: '#7d8b5a', primary: '#a3e635', primaryText: '#1a2a05', accent: '#c084fc', border: 'rgba(163,230,53,0.25)', preview: ['#1a2a0a', '#a3e635', '#c084fc'] },
]

// ============================================================
// 2. 42 风格
// ============================================================
export const STYLES: StyleDef[] = [
  { id: 'minimal', name: '极简白', desc: '白底极简·细线分隔·sans 字体', headerStyle: 'solid', cardShadow: 'none', radius: 4, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule' },
  { id: 'glasswa', name: '玻璃拟态', desc: '半透磨砂卡片·辉光阴影·大圆角', headerStyle: 'gradient', cardShadow: 'glow', radius: 16, fontFamily: 'sans', texture: 'none', chapterDeco: 'none' },
  { id: 'paper', name: '纸面纹理', desc: '宣纸纹理·衬线字体·菱形花饰', headerStyle: 'solid', cardShadow: 'sm', radius: 4, fontFamily: 'serif', texture: 'paper', chapterDeco: 'ornament' },
  { id: 'neon', name: '暗夜霓虹', desc: '霓虹渐变·辉光晕染·无装饰', headerStyle: 'gradient', cardShadow: 'glow', radius: 12, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none' },
  { id: 'classic', name: '书卷典雅', desc: '居中标题·小圆角·纸纹横线', headerStyle: 'centered', cardShadow: 'sm', radius: 4, fontFamily: 'serif', texture: 'paper', chapterDeco: 'rule' },
  { id: 'modern', name: '现代卡片', desc: '中圆角·中等阴影·横线分隔', headerStyle: 'solid', cardShadow: 'md', radius: 12, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule' },
  { id: 'magazine', name: '杂志风', desc: '分栏标题·中阴影·菱形花饰', headerStyle: 'split', cardShadow: 'md', radius: 8, fontFamily: 'serif', texture: 'none', chapterDeco: 'ornament' },
  { id: 'waterfall', name: '瀑布流', desc: '大圆角卡片·小阴影·横线', headerStyle: 'solid', cardShadow: 'sm', radius: 16, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule' },
  { id: 'shelf', name: '书架陈列', desc: '中圆角书架·中等阴影·无装饰', headerStyle: 'solid', cardShadow: 'md', radius: 8, fontFamily: 'sans', texture: 'none', chapterDeco: 'none' },
  { id: 'theater', name: '剧院暗色', desc: '透明头·深度阴影·暗角氛围', headerStyle: 'transparent', cardShadow: 'depth', radius: 8, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none' },
  { id: 'pili', name: '霹雳仿站', desc: '小圆角·暖橙头条·横线', headerStyle: 'pili', cardShadow: 'sm', radius: 3, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule' },
  { id: 'inkpaint', name: '山水墨韵', desc: '居中标题·无阴影·纸纹花饰', headerStyle: 'centered', cardShadow: 'none', radius: 4, fontFamily: 'serif', texture: 'paper', chapterDeco: 'ornament' },
  { id: 'cyber', name: '赛博朋克', desc: '渐变头·辉光阴影·暗角', headerStyle: 'gradient', cardShadow: 'glow', radius: 12, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none' },
  { id: 'steampunk', name: '蒸汽朋克', desc: '实心头·深度阴影·花饰', headerStyle: 'solid', cardShadow: 'depth', radius: 8, fontFamily: 'serif', texture: 'none', chapterDeco: 'ornament' },
  { id: 'japanese', name: '日式和风', desc: '居中标题·小阴影·纸纹花饰', headerStyle: 'centered', cardShadow: 'sm', radius: 8, fontFamily: 'serif', texture: 'paper', chapterDeco: 'ornament' },
  { id: 'nordic', name: '北欧极简', desc: '实心头·无阴影·无装饰', headerStyle: 'solid', cardShadow: 'none', radius: 8, fontFamily: 'sans', texture: 'none', chapterDeco: 'none' },
  { id: 'mediterr', name: '地中海蓝', desc: '透明头·中等阴影·横线', headerStyle: 'transparent', cardShadow: 'md', radius: 12, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule' },
  { id: 'forest', name: '森林秘境', desc: '实心头·中等阴影·无装饰', headerStyle: 'solid', cardShadow: 'md', radius: 12, fontFamily: 'sans', texture: 'none', chapterDeco: 'none' },
  { id: 'desert', name: '沙漠暖阳', desc: '实心头·小阴影·大圆角·横线', headerStyle: 'solid', cardShadow: 'sm', radius: 16, fontFamily: 'serif', texture: 'none', chapterDeco: 'rule' },
  { id: 'aurora', name: '极光夜空', desc: '渐变头·辉光阴影·大圆角·暗角', headerStyle: 'gradient', cardShadow: 'glow', radius: 16, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none' },
  { id: 'sakura', name: '樱花纷飞', desc: '实心头·小阴影·大圆角·纸纹花饰', headerStyle: 'solid', cardShadow: 'sm', radius: 16, fontFamily: 'sans', texture: 'paper', chapterDeco: 'ornament' },
  { id: 'deepsea', name: '深海幽蓝', desc: '透明头·深度阴影·大圆角·暗角', headerStyle: 'transparent', cardShadow: 'depth', radius: 12, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none' },
  { id: 'lava', name: '熔岩烈焰', desc: '渐变头·辉光阴影·暗角', headerStyle: 'gradient', cardShadow: 'glow', radius: 8, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none' },
  { id: 'frost', name: '冰霜白银', desc: '实心头·无阴影·大圆角·横线', headerStyle: 'solid', cardShadow: 'none', radius: 16, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule' },
  { id: 'jade', name: '翡翠碧绿', desc: '实心头·中等阴影·衬线·横线', headerStyle: 'solid', cardShadow: 'md', radius: 12, fontFamily: 'serif', texture: 'none', chapterDeco: 'rule' },
  { id: 'amber', name: '琥珀金棕', desc: '渐变头·中等阴影·衬线·花饰', headerStyle: 'gradient', cardShadow: 'md', radius: 12, fontFamily: 'serif', texture: 'none', chapterDeco: 'ornament' },
  { id: 'amethyst', name: '紫水晶梦', desc: '渐变头·辉光阴影·暗角', headerStyle: 'gradient', cardShadow: 'glow', radius: 12, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none' },
  { id: 'rosegarden', name: '玫瑰花园', desc: '实心头·中等阴影·小圆角·纸纹花饰', headerStyle: 'solid', cardShadow: 'md', radius: 8, fontFamily: 'serif', texture: 'paper', chapterDeco: 'ornament' },
  { id: 'lavender', name: '薰衣草田', desc: '渐变头·小阴影·大圆角·横线', headerStyle: 'gradient', cardShadow: 'sm', radius: 16, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule' },
  { id: 'coffee', name: '咖啡时光', desc: '实心头·深度阴影·衬线·纸纹横线', headerStyle: 'solid', cardShadow: 'depth', radius: 8, fontFamily: 'serif', texture: 'paper', chapterDeco: 'rule' },
  { id: 'typewriter', name: '复古打字机', desc: '实心头·无阴影·零圆角·等宽字体', headerStyle: 'solid', cardShadow: 'none', radius: 0, fontFamily: 'mono', texture: 'none', chapterDeco: 'none' },
  { id: 'futurist', name: '未来科技', desc: '透明头·辉光阴影·大圆角·无装饰', headerStyle: 'transparent', cardShadow: 'glow', radius: 16, fontFamily: 'sans', texture: 'none', chapterDeco: 'none' },
  { id: 'handwritten', name: '手写笔记', desc: '居中标题·无阴影·中圆角·手写体·纸纹花饰', headerStyle: 'centered', cardShadow: 'none', radius: 8, fontFamily: 'handwritten', texture: 'paper', chapterDeco: 'ornament' },
  { id: 'ancient', name: '古籍善本', desc: '居中标题·小阴影·小圆角·衬线·纸纹花饰', headerStyle: 'centered', cardShadow: 'sm', radius: 4, fontFamily: 'serif', texture: 'paper', chapterDeco: 'ornament' },
  { id: 'bambooslip', name: '竹简竹韵', desc: '实心头·无阴影·零圆角·衬线·纸纹横线', headerStyle: 'solid', cardShadow: 'none', radius: 0, fontFamily: 'serif', texture: 'paper', chapterDeco: 'rule' },
  { id: 'silk', name: '绢帛丝滑', desc: '渐变头·小阴影·大圆角·衬线·无装饰', headerStyle: 'gradient', cardShadow: 'sm', radius: 16, fontFamily: 'serif', texture: 'none', chapterDeco: 'none' },
  { id: 'slate', name: '石板青灰', desc: '实心头·深度阴影·中圆角·横线', headerStyle: 'solid', cardShadow: 'depth', radius: 8, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule' },
  { id: 'dawn', name: '晨曦微光', desc: '渐变头·小阴影·中圆角·横线', headerStyle: 'gradient', cardShadow: 'sm', radius: 12, fontFamily: 'sans', texture: 'none', chapterDeco: 'rule' },
  { id: 'dusk', name: '暮色苍茫', desc: '透明头·深度阴影·中圆角·暗角', headerStyle: 'transparent', cardShadow: 'depth', radius: 12, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none' },
  { id: 'galaxy', name: '星河璀璨', desc: '渐变头·辉光阴影·大圆角·暗角', headerStyle: 'gradient', cardShadow: 'glow', radius: 16, fontFamily: 'sans', texture: 'vignette', chapterDeco: 'none' },
  { id: 'waterink', name: '水墨丹青', desc: '居中标题·无阴影·衬线·纸纹花饰', headerStyle: 'centered', cardShadow: 'none', radius: 4, fontFamily: 'serif', texture: 'paper', chapterDeco: 'ornament' },
  { id: 'treasure', name: '古卷典藏', desc: '实心头·小阴影·小圆角·衬线·纸纹横线', headerStyle: 'solid', cardShadow: 'sm', radius: 4, fontFamily: 'serif', texture: 'paper', chapterDeco: 'rule' },
]

// ============================================================
// 3. 24 布局 (7 home × 4 read = 28 中选 24, 各自不同 readVars)
// ============================================================
export const LAYOUTS: LayoutDef[] = [
  { id: 'grid-cl', name: '网格·典书', homeLayout: 'grid', readLayout: 'classic', readVars: { layout: 'classic', measure: 680, lineHeight: 2, fontBase: 17, indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule' } },
  { id: 'list-im', name: '列表·沉浸', homeLayout: 'list', readLayout: 'immersive', readVars: { layout: 'immersive', measure: 740, lineHeight: 2.1, fontBase: 18, indent: false, justify: false, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none' } },
  { id: 'shelf-pg', name: '书架·分页', homeLayout: 'shelf', readLayout: 'paginated', readVars: { layout: 'paginated', measure: 480, lineHeight: 1.85, fontBase: 17, indent: false, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'mag-pl', name: '杂志·书屋', homeLayout: 'magazine', readLayout: 'pili', readVars: { layout: 'pili', measure: 680, lineHeight: 1.9, fontBase: 18, indent: true, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'min-cl', name: '极简·典书', homeLayout: 'minimal', readLayout: 'classic', readVars: { layout: 'classic', measure: 640, lineHeight: 1.95, fontBase: 17, indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule' } },
  { id: 'th-im', name: '剧院·沉浸', homeLayout: 'theater', readLayout: 'immersive', readVars: { layout: 'immersive', measure: 780, lineHeight: 2, fontBase: 18, indent: false, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'none' } },
  { id: 'pili-pl', name: '霹雳·书屋', homeLayout: 'pili', readLayout: 'pili', readVars: { layout: 'pili', measure: 680, lineHeight: 1.9, fontBase: 18, indent: true, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'grid-im', name: '网格·沉浸', homeLayout: 'grid', readLayout: 'immersive', readVars: { layout: 'immersive', measure: 720, lineHeight: 2.05, fontBase: 18, indent: false, justify: false, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none' } },
  { id: 'list-pg', name: '列表·分页', homeLayout: 'list', readLayout: 'paginated', readVars: { layout: 'paginated', measure: 500, lineHeight: 1.9, fontBase: 17, indent: false, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'shelf-cl', name: '书架·典书', homeLayout: 'shelf', readLayout: 'classic', readVars: { layout: 'classic', measure: 700, lineHeight: 2, fontBase: 18, indent: true, justify: true, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament' } },
  { id: 'mag-im', name: '杂志·沉浸', homeLayout: 'magazine', readLayout: 'immersive', readVars: { layout: 'immersive', measure: 760, lineHeight: 2.05, fontBase: 18, indent: true, justify: true, toolbar: 'floating', texture: 'vignette', chapterDeco: 'ornament' } },
  { id: 'min-pg', name: '极简·分页', homeLayout: 'minimal', readLayout: 'paginated', readVars: { layout: 'paginated', measure: 460, lineHeight: 1.85, fontBase: 16, indent: false, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'th-pl', name: '剧院·书屋', homeLayout: 'theater', readLayout: 'pili', readVars: { layout: 'pili', measure: 720, lineHeight: 1.95, fontBase: 18, indent: false, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'grid-pg', name: '网格·分页', homeLayout: 'grid', readLayout: 'paginated', readVars: { layout: 'paginated', measure: 480, lineHeight: 1.85, fontBase: 17, indent: false, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'list-pl', name: '列表·书屋', homeLayout: 'list', readLayout: 'pili', readVars: { layout: 'pili', measure: 680, lineHeight: 1.95, fontBase: 18, indent: true, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'shelf-im', name: '书架·沉浸', homeLayout: 'shelf', readLayout: 'immersive', readVars: { layout: 'immersive', measure: 740, lineHeight: 2.1, fontBase: 19, indent: false, justify: false, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none' } },
  { id: 'mag-cl', name: '杂志·典书', homeLayout: 'magazine', readLayout: 'classic', readVars: { layout: 'classic', measure: 720, lineHeight: 2.05, fontBase: 18, indent: true, justify: true, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament' } },
  { id: 'min-im', name: '极简·沉浸', homeLayout: 'minimal', readLayout: 'immersive', readVars: { layout: 'immersive', measure: 720, lineHeight: 2.15, fontBase: 19, indent: false, justify: false, toolbar: 'floating', texture: 'vignette', chapterDeco: 'none' } },
  { id: 'th-pg', name: '剧院·分页', homeLayout: 'theater', readLayout: 'paginated', readVars: { layout: 'paginated', measure: 520, lineHeight: 1.95, fontBase: 18, indent: true, justify: true, toolbar: 'bottom', texture: 'vignette', chapterDeco: 'ornament' } },
  { id: 'pili-cl', name: '霹雳·典书', homeLayout: 'pili', readLayout: 'classic', readVars: { layout: 'classic', measure: 680, lineHeight: 1.95, fontBase: 18, indent: true, justify: false, toolbar: 'inline', texture: 'none', chapterDeco: 'rule' } },
  { id: 'grid-pl', name: '网格·书屋', homeLayout: 'grid', readLayout: 'pili', readVars: { layout: 'pili', measure: 680, lineHeight: 1.9, fontBase: 18, indent: true, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'list-cl', name: '列表·典书', homeLayout: 'list', readLayout: 'classic', readVars: { layout: 'classic', measure: 680, lineHeight: 2, fontBase: 18, indent: true, justify: true, toolbar: 'inline', texture: 'paper', chapterDeco: 'ornament' } },
  { id: 'shelf-pl', name: '书架·书屋', homeLayout: 'shelf', readLayout: 'pili', readVars: { layout: 'pili', measure: 680, lineHeight: 1.95, fontBase: 18, indent: true, justify: false, toolbar: 'bottom', texture: 'none', chapterDeco: 'rule' } },
  { id: 'mag-pg', name: '杂志·分页', homeLayout: 'magazine', readLayout: 'paginated', readVars: { layout: 'paginated', measure: 560, lineHeight: 1.95, fontBase: 18, indent: true, justify: true, toolbar: 'bottom', texture: 'vignette', chapterDeco: 'ornament' } },
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
  const id = `${c.id}-${s.id}-${l.id}`
  // 名称: 配色名 + 风格名 + 布局名
  const name = `${c.name}·${s.name}·${l.name}`
  // 描述: 风格 desc + 配色 dark/light + 布局 read kind
  const desc = `${s.desc} · ${c.dark ? '暗色' : '亮色'} · ${l.name}`
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
    dark: c.dark,
    read,
    vars: {
      bg: c.bg,
      surface: c.surface,
      surfaceAlt: c.surfaceAlt,
      text: c.text,
      textMuted: c.textMuted,
      primary: c.primary,
      primaryText: c.primaryText,
      accent: c.accent,
      border: c.border,
      radius: `${s.radius}px`,
      fontFamily: FONT_FAMILIES[s.fontFamily],
      cardShadow: shadowOf(s.cardShadow, c.primary, c.dark),
      headerStyle: s.headerStyle,
      titleFont: s.fontFamily === 'serif' ? '"Noto Serif SC","Songti SC",serif' : undefined,
    },
    preview: c.preview,
  }
}

/** 解析主题 ID → (colorId, styleId, layoutId)
 *  ID 形如 `violet-glasswa-grid-cl` —— 但 colorId 自身可含 `-`(如 `vio-gold-d`),
 *  故按反向拆分: 末段为 layoutId(24 选 1), 倒数第二段为 styleId(42 选 1), 其余为 colorId。
 *  通过对预定义 ID 列表 set 匹配消歧。 */
export function parseThemeId(themeId: string): { colorId: string; styleId: string; layoutId: string } | undefined {
  if (!themeId || typeof themeId !== 'string') return undefined
  // 优先精确匹配预定义 layout/style/color id 组合
  // 先尝试匹配 layout (24 个, ID 唯一)
  for (const l of LAYOUTS) {
    if (themeId.endsWith(`-${l.id}`)) {
      const rest = themeId.slice(0, themeId.length - l.id.length - 1) // 去掉 `-${l.id}`
      // 再匹配 style (42 个, ID 唯一)
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

/** 全部 50400 组合的轻量描述符列表(惰性生成, 单次访问)
 *  注意: 全量生成约 50400 项 × ~200B = ~10MB 内存占用, 仅 admin 列表 API 单次构建后即丢;
 *  长期持有的 admin/themes 路由每次请求 lazy 重新构建, 不长期驻留 */
export function getThemeList(): ThemeListItem[] {
  const out: ThemeListItem[] = []
  for (const c of COLOR_SCHEMES) {
    for (const s of STYLES) {
      for (const l of LAYOUTS) {
        out.push({
          id: `${c.id}-${s.id}-${l.id}`,
          name: `${c.name}·${s.name}·${l.name}`,
          desc: `${s.desc} · ${c.dark ? '暗色' : '亮色'} · ${l.name}`,
          layout: l.homeLayout,
          dark: c.dark,
          read: { layout: l.readLayout },
          preview: c.preview,
        })
      }
    }
  }
  return out
}

/** 分页返回主题列表(1-based, 1..N) */
export function getThemesPage(page: number, size: number): {
  page: number
  size: number
  total: number
  totalPages: number
  items: ThemeListItem[]
} {
  const all = getThemeList()
  const total = all.length
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, size)))
  const p = Math.max(1, Math.min(totalPages, Math.floor(page) || 1))
  const sz = Math.max(1, Math.min(500, Math.floor(size) || 50))
  const start = (p - 1) * sz
  const items = all.slice(start, start + sz)
  return { page: p, size: sz, total, totalPages, items }
}
