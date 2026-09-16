// ============================================================
// clone-themes/shared-props — 10 套主题共享的组件 props 类型
// ============================================================

import type { BookDetail, BookItem } from '../types'
import type { ReactNode } from 'react'
import type { ThemeDef } from '@/lib/crawl/themes'

/** BookInfo 入参 (每套主题 BookInfo 复用同一组操作 + book 数据) */
export interface BookInfoProps {
  book: BookDetail
  theme?: ThemeDef
  savedPos?: { chapterId?: string; title?: string; readTimeMs?: number } | null
  firstChapterId?: string
  onScrollToc: () => void
  onContinueRead?: () => void
  onGoCategory?: (categoryId: string) => void
}

/** CategoryList 入参 */
export interface CategoryListProps {
  books: BookItem[]
  loading?: boolean
  label: string
  page: number
  total: number
  size?: number
  onPage: (p: number) => void
}

/** HomeClone 入参 */
export interface HomeCloneProps {
  books: BookItem[]
  loading?: boolean
}

/** ReadChrome 入参 */
export interface ReadChromeProps {
  children: ReactNode
  chapterTitle?: string
  /** 上一章/下一章按钮 (可选, 由外层注入) */
  onPrev?: () => void
  onNext?: () => void
  prevLabel?: string
  nextLabel?: string
}
