// ============================================================
// 前台 SEO / GEO / TDK 工具 + 展示辅助函数
// ============================================================
'use client'

import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { ThemeDef } from '@/lib/crawl/themes'
import type { SiteInfo } from './types'

export interface SeoOptions {
  /** 页面标题；不传则跳过 document.title（由子视图负责，避免父子互相覆盖） */
  title?: string
  description?: string
  keywords?: string
  jsonLd?: Record<string, unknown>[]
  canonicalPath?: string
  site?: SiteInfo | null
  /** robots 指令，默认 index,follow；搜索/关键词等结果页应传 noindex,follow */
  robots?: string
  /** false 时完全不接管 head（用于父壳退位给子视图，防止父子互覆盖 TDK/robots） */
  enabled?: boolean
}

const SEO_MARK = 'data-seo-public'

function ensureMeta(key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', key)
    el.setAttribute(SEO_MARK, '1')
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/** 移除同名 meta（视图切换时清掉上一页残留的 TDK，避免旧内容泄漏到新视图） */
function removeMeta(key: string) {
  document.head.querySelectorAll<HTMLMetaElement>(`meta[name="${key}"]`).forEach((el) => el.remove())
}

/**
 * 统一注入 TDK / GEO / canonical / JSON-LD：
 * - document.title
 * - meta[name=description|keywords|geo.region|geo.placename|ICBM]
 * - link[rel=canonical]
 * - jsonLd 每项一个 <script type="application/ld+json">（挂 body，带 data-seo 标记，卸载时清理）
 */
export function useSiteSEO(opts: SeoOptions) {
  const { title, description, keywords, jsonLd, canonicalPath, site, robots, enabled } = opts
  const ldKey = jsonLd ? JSON.stringify(jsonLd) : ''
  const siteKey = site ? `${site.id}|${site.geoRegion}|${site.geoPlacename}|${site.icbm}` : ''

  useEffect(() => {
    // 父壳在子视图就绪后退位，避免站点级 TDK/robots 覆盖视图级设置
    if (enabled === false) return
    if (title) document.title = title
    // TDK：未提供时移除残留 meta，防止上一视图的描述/关键词泄漏到当前视图
    if (description) ensureMeta('description', description)
    else removeMeta('description')
    if (keywords) ensureMeta('keywords', keywords)
    else removeMeta('keywords')
    ensureMeta('robots', robots || 'index,follow')
    if (siteKey) {
      const [, geoRegion, geoPlacename, icbm] = siteKey.split('|')
      if (geoRegion) ensureMeta('geo.region', geoRegion)
      if (geoPlacename) ensureMeta('geo.placename', geoPlacename)
      if (icbm) ensureMeta('ICBM', icbm)
    }
    if (canonicalPath) {
      let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'canonical'
        link.setAttribute(SEO_MARK, '1')
        document.head.appendChild(link)
      }
      link.href = window.location.origin + canonicalPath
    } else {
      // 无 canonical 的视图（加载中/错误态）移除上一页残留，避免指向错误地址
      document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.remove()
    }
    const scripts: HTMLScriptElement[] = []
    if (ldKey) {
      try {
        const arr = JSON.parse(ldKey) as Record<string, unknown>[]
        for (const obj of arr) {
          const s = document.createElement('script')
          s.type = 'application/ld+json'
          s.setAttribute(SEO_MARK, '1')
          s.text = JSON.stringify(obj)
          document.body.appendChild(s)
          scripts.push(s)
        }
      } catch {
        // JSON-LD 序列化失败时忽略
      }
    }
    return () => {
      scripts.forEach((s) => s.remove())
    }
  }, [title, description, keywords, robots, enabled, ldKey, canonicalPath, siteKey])
}

/** 封面 URL 处理：空 → null(渐变占位)；covers/xxx → /api/public/cover?file=xxx；http 开头 → 原样 */
export function coverSrc(cover?: string | null): string | null {
  if (!cover) return null
  const c = cover.trim()
  if (!c) return null
  if (/^https?:\/\//i.test(c)) return c
  if (c.startsWith('covers/')) return '/api/public/cover?file=' + encodeURIComponent(c.replace(/^covers\//, ''))
  if (c.startsWith('/')) return c
  return null
}

/** 字数格式化：万为单位 */
export function formatWords(n?: number | null): string {
  if (!n || n <= 0) return '0 字'
  if (n >= 100000000) return (n / 100000000).toFixed(2).replace(/\.?0+$/, '') + ' 亿字'
  if (n >= 10000) {
    const w = n / 10000
    return (w >= 100 ? Math.round(w) : Number(w.toFixed(1))) + ' 万字'
  }
  return n + ' 字'
}

/** 完结状态文案 */
export function statusLabel(s?: string | null): string {
  if (s === 'completed') return '已完结'
  if (s === 'ongoing') return '连载中'
  return '状态未知'
}

/** 完结状态徽章配色（基于主题 vars，不引入主题外色系） */
export function statusStyle(theme: ThemeDef, s?: string | null): CSSProperties {
  const v = theme.vars
  if (s === 'completed') {
    return { background: withAlpha(v.accent, theme.dark ? 0.18 : 0.14), color: v.accent, border: `1px solid ${withAlpha(v.accent, 0.45)}` }
  }
  if (s === 'ongoing') {
    return { background: withAlpha(v.primary, theme.dark ? 0.22 : 0.12), color: v.primary, border: `1px solid ${withAlpha(v.primary, 0.45)}` }
  }
  return { background: withAlpha(v.textMuted, 0.14), color: v.textMuted, border: `1px solid ${withAlpha(v.textMuted, 0.4)}` }
}

/** 十六进制色 → rgba；非 #rrggbb 原样返回 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

/** 日期格式化 YYYY-MM-DD */
export function fmtDate(d?: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  const p = (x: number) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

/** 站点关键词拆分为标签数组 */
export function siteKeywordList(site?: SiteInfo | null): string[] {
  if (!site?.keywords) return []
  return site.keywords
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 16)
}
