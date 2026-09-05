// ============================================================
// 前台站群上下文 — 主题 / 站点 / 站内导航
// ============================================================
'use client'

import { createContext, useContext } from 'react'
import type { ThemeDef } from '@/lib/crawl/themes'
import type { SiteInfo } from './types'

export type PublicView = 'home' | 'book' | 'read' | 'search' | 'keyword' | 'category'

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

/** 视图参数 → 查询串（/?view=book&id=xx&site=xx） */
export function viewToUrl(v: ViewParams, siteId: string): string {
  const sp = new URLSearchParams()
  sp.set('view', v.view)
  if (v.bookId) sp.set('id', v.bookId)
  if (v.chapterId) sp.set('chapter', v.chapterId)
  if (v.q) sp.set('q', v.q)
  if (v.tag) sp.set('tag', v.tag)
  if (v.cat) sp.set('cat', v.cat)
  if (v.page && v.page > 1) sp.set('page', String(v.page))
  if (siteId) sp.set('site', siteId)
  const qs = sp.toString()
  return qs ? `/?${qs}` : '/'
}

const VIEW_LIST: PublicView[] = ['home', 'book', 'read', 'search', 'keyword', 'category']

/** 查询串 → 视图参数 */
export function parseView(search: string): ViewParams {
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
