import type { BookItem, BookDetail } from '../types'
import type { ReactNode } from 'react'
export interface HomeCloneProps { books: BookItem[]; loading?: boolean; navCategoryCount?: number; homeModuleLimit?: number; initialCategories?: any[] }
export interface BookInfoProps { book: BookDetail; theme?: any; savedPos?: any; firstChapterId?: string; onScrollToc: () => void; onContinueRead?: () => void; onGoCategory?: (id: string) => void; initialCategories?: any[] }
export interface CategoryListProps { books: BookItem[]; loading?: boolean; label: string; page: number; total: number; size?: number; onPage: (p: number) => void; initialCategories?: any[] }
export interface ReadChromeProps { children: ReactNode; chapterTitle?: string; onPrev?: () => void; onNext?: () => void; initialCategories?: any[] }
export interface RankingViewProps { books: BookItem[]; loading: boolean; tab: string; onTabChange: (t: string) => void; page: number; total: number; size: number; onPage: (p: number) => void; initialCategories?: any[] }
export interface FulltextViewProps { books: BookItem[]; loading: boolean; page: number; total: number; size: number; onPage: (p: number) => void; initialCategories?: any[] }
export interface SearchViewProps { q: string; books: BookItem[]; loading: boolean; initialCategories?: any[] }
export interface KeywordViewProps { tag: string; books: BookItem[]; loading: boolean; initialCategories?: any[] }
