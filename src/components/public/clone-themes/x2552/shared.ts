// ============================================================
// clone-themes/<site>/shared.ts — 8 个组件的 props 接口定义
// R19-1A: 与 src/components/public/types.ts 的 BookItem/BookDetail 同源
// ============================================================
import type { BookItem, BookDetail } from '../../types'
import type { ReactNode } from 'react'
import type { ThemeDef } from '@/lib/crawl/themes'

export interface HomeCloneProps { books: BookItem[]; loading?: boolean; navCategoryCount?: number; homeModuleLimit?: number }
export interface BookInfoProps { book: BookDetail; theme?: ThemeDef; savedPos?: any; firstChapterId?: string; onScrollToc: () => void; onContinueRead?: () => void; onGoCategory?: (id: string) => void }
export interface CategoryListProps { books: BookItem[]; loading?: boolean; label: string; page: number; total: number; size?: number; onPage: (p: number) => void }
export interface ReadChromeProps { children: ReactNode; chapterTitle?: string; onPrev?: () => void; onNext?: () => void }
export interface RankingViewProps { books: BookItem[]; loading: boolean; tab: string; onTabChange: (t: string) => void; page: number; total: number; size: number; onPage: (p: number) => void }
export interface FulltextViewProps { books: BookItem[]; loading: boolean; page: number; total: number; size: number; onPage: (p: number) => void }
export interface SearchViewProps { q: string; books: BookItem[]; loading: boolean }
export interface KeywordViewProps { tag: string; books: BookItem[]; loading: boolean }
