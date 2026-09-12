// ============================================================
// 前台站群上下文 — 主题 / 站点 / 站内导航
// ============================================================
'use client'

import { createContext, useContext } from 'react'
import type { ThemeDef } from '@/lib/crawl/themes'
import type { PseudoStaticStyle } from '@/lib/pseudostatic'
import { buildViewUrl, parseViewPath } from '@/lib/pseudostatic'
import type { SiteInfo } from './types'

export type PublicView = 'home' | 'book' | 'read' | 'search' | 'keyword' | 'category' | 'history'

export interface ViewParams {
  view: PublicView
  bookId?: string
  chapterId?: string
  q?: string
  tag?: string
  cat?: string
  page?: number
  site?: string
}

export interface PublicCtxValue {
  site: SiteInfo
  sites: SiteInfo[]
  theme: ThemeDef
  embedMode: boolean
  /** 站内视图切换（onClick，不做整页跳转），自动同步查询串 */
  navigate: (p: ViewParams) => void
}

const PublicCtx = createContext<PublicCtxValue | null>(null)

export const PublicProvider = PublicCtx.Provider

export function usePublic(): PublicCtxValue {
  const v = useContext(PublicCtx)
  if (!v) throw new Error('PublicSite 上下文缺失')
  return v
}

/** 可选上下文（未挂 Provider 时返回 null，供加载外壳等场景兜底） */
export function usePublicOptional(): PublicCtxValue | null {
  return useContext(PublicCtx)
}

/**
 * 视图参数 → URL 路径
 * 根据站点伪静态风格构建 URL; site 参数始终走查询串
 */
export function viewToUrl(v: ViewParams, siteId: string, style: PseudoStaticStyle = 'query'): string {
  return buildViewUrl(v, style, siteId)
}

const VIEW_LIST: PublicView[] = ['home', 'book', 'read', 'search', 'keyword', 'category', 'history']

/**
 * 查询串/路径 → 视图参数
 * 优先解析查询串 ?view=xxx; 失败时按伪静态风格解析路径
 */
export function parseView(search: string, style: PseudoStaticStyle = 'query', pathname?: string): ViewParams {
  // 如果提供了 pathname, 尝试伪静态路径解析
  if (pathname) {
    const parsed = parseViewPath(pathname, search, style)
    // parseViewPath 始终返回有效结果(兜底 home), 直接用
    return parsed as ViewParams
  }
  // 仅查询串解析(旧路径, 兼容)
  const sp = new URLSearchParams(search)
  const raw = sp.get('view') || 'home'
  const view: PublicView = (VIEW_LIST as string[]).includes(raw) ? (raw as PublicView) : 'home'
  const pageN = Number(sp.get('page')) || 1
  return {
    view,
    bookId: sp.get('id') || undefined,
    chapterId: sp.get('chapter') || undefined,
    q: sp.get('q') || undefined,
    tag: sp.get('tag') || undefined,
    cat: sp.get('cat') || undefined,
    page: pageN > 0 ? pageN : 1,
    site: sp.get('site') || undefined,
  }
}
