// clone-themes/shared.ts — 10 套主题共享的类型和工具
import type { BookItem } from '../types'

export interface HomeCloneProps {
  books: BookItem[]
  loading?: boolean
  /** 导航栏展示几个分类 (R16: 主题可编辑) */
  navCategoryCount?: number
  /** 首页每个模块显示多少数据 (R16: 主题可编辑) */
  homeModuleLimit?: number
}

export interface BookInfoProps {
  book: import('../types').BookDetail
  theme?: import('@/lib/crawl/themes').ThemeDef
  savedPos?: { chapterId?: string; title?: string; readTimeMs?: number } | null
  firstChapterId?: string
  onScrollToc: () => void
  onContinueRead?: () => void
  onGoCategory?: (categoryId: string) => void
}

export interface CategoryListProps {
  books: BookItem[]
  loading?: boolean
  label: string
  page: number
  total: number
  size?: number
  onPage: (p: number) => void
}

export interface ReadChromeProps {
  children: import('react').ReactNode
  chapterTitle?: string
  onPrev?: () => void
  onNext?: () => void
  prevLabel?: string
  nextLabel?: string
}
