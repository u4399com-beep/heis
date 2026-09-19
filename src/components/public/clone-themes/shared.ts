// ============================================================
// clone-themes 共享类型 + 共享工具 — 提取自 10 套主题重复逻辑
// R27-1C 清理: 把 50+ clone-* 文件重复的 nav handlers / 分页区间 / 分类拉取
//              收敛到本文件, 各主题 tsx 仅保留 DOM 结构差异
// ============================================================
import { useEffect, useState } from 'react'
import type { BookItem, BookDetail } from '../types'
import type { ReactNode } from 'react'
import type { ViewParams } from '../ctx'

// ============================================================
// 主题 Props 类型 (各 clone-* 组件统一签名, 走 PublicSite 透传 initialCategories)
// ============================================================
export interface HomeCloneProps { books: BookItem[]; loading?: boolean; navCategoryCount?: number; homeModuleLimit?: number; initialCategories?: any[] }
export interface BookInfoProps { book: BookDetail; theme?: any; savedPos?: any; firstChapterId?: string; onScrollToc: () => void; onContinueRead?: () => void; onGoCategory?: (id: string) => void; initialCategories?: any[] }
export interface CategoryListProps { books: BookItem[]; loading?: boolean; label: string; page: number; total: number; size?: number; onPage: (p: number) => void; initialCategories?: any[] }
export interface ReadChromeProps { children: ReactNode; chapterTitle?: string; onPrev?: () => void; onNext?: () => void; initialCategories?: any[] }
export interface RankingViewProps { books: BookItem[]; loading: boolean; tab: string; onTabChange: (t: string) => void; page: number; total: number; size: number; onPage: (p: number) => void; initialCategories?: any[] }
export interface FulltextViewProps { books: BookItem[]; loading: boolean; page: number; total: number; size: number; onPage: (p: number) => void; initialCategories?: any[] }
export interface SearchViewProps { q: string; books: BookItem[]; loading: boolean; initialCategories?: any[] }
export interface KeywordViewProps { tag: string; books: BookItem[]; loading: boolean; initialCategories?: any[] }

// ============================================================
// 共享 Nav Handlers — 9 套 clone-* 主题 goHome/goSearch/goCat 同款逻辑
// 调用方: const { goHome, goSearch, goCat } = cloneNavHandlers(navigate, 'searchkey')
// searchInputName: 各主题源站表单 input[name] 实测值 (23qb/x2552 'searchkey',
//                  huangjinwu/ggd66/shipsay/101kks 'keyword', aijjxs 'keyboard',
//                  trxsw/pilishuwu/ddyueshu 各异), 不传则用 'searchkey' 兜底
// ============================================================
export interface CloneNavHandlers {
  goHome: (e: React.MouseEvent) => void
  goSearch: (e: React.FormEvent<HTMLFormElement>) => void
  goCat: (e: React.MouseEvent, catId?: string) => void
}

export function cloneNavHandlers(
  navigate: (p: ViewParams) => void,
  searchInputName = 'searchkey',
): CloneNavHandlers {
  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem(searchInputName) as HTMLInputElement | null)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  return { goHome, goSearch, goCat }
}

// ============================================================
// 共享分页区间 — 23qb/aijjxs 等多套主题的"当前页 ± window/2"窗口算法
// 返回: { totalPages, pageItems } 供 JSX 直接渲染 #page 块
// ============================================================
export interface ClonePagination {
  totalPages: number
  pageItems: number[]
}

export function clonePageItems(page: number, total: number, size: number, window = 5): ClonePagination {
  const totalPages = Math.max(1, Math.ceil(total / size))
  const half = Math.max(1, Math.floor(window / 2))
  const from = Math.max(1, page - half)
  const to = Math.min(totalPages, from + window - 1)
  const pageItems: number[] = []
  for (let i = from; i <= to; i++) pageItems.push(i)
  return { totalPages, pageItems }
}

// ============================================================
// 共享分类拉取 Hook — 50+ clone-* 文件重复的 fetch /api/public/categories
// 参数:
//   initialCategories: SSR 首载 server-side 拉取的分类 (避免 SSR 时 cats=[] → 导航无分类)
//   fallback: 拉取失败兜底 (各主题硬编码 DEFAULT_NAV)
//   limit: 拉取上限 (默认 60, 与各主题原 fetch 同口径)
// 行为:
//   - SSR initialCategories 非空 → 用其初始化, 跳过 fetch (避免覆盖)
//   - cats 为空时客户端 fetch, AbortController 兜底防 race
//   - API 响应兼容 {data:{items}} / {data:{categories}} / {items} / {categories} 多形态
// ============================================================
export interface CloneCategory { id: string; name: string }

function mapCat(c: any): CloneCategory {
  return { id: c.id || c.slug || c.name, name: c.name || c.title || String(c) }
}

export function useCloneCategories(
  initialCategories?: any[],
  fallback: CloneCategory[] = [],
  limit = 60,
): CloneCategory[] {
  const [cats, setCats] = useState<CloneCategory[]>(() =>
    (initialCategories || []).map(mapCat),
  )
  useEffect(() => {
    if (cats.length > 0) return
    let aborted = false
    fetch(`/api/public/categories?limit=${limit}`)
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        const mapped = arr.map(mapCat)
        if (mapped.length) setCats(mapped)
        else if (fallback.length) setCats(fallback)
      })
      .catch(() => { if (!aborted && fallback.length) setCats(fallback) })
    return () => { aborted = true }
  }, [cats.length, fallback, limit])
  return cats
}
