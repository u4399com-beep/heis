// clone-themes/shared.ts — 10 套主题共享的类型
import type { BookItem, BookDetail } from '../types'
import type { ReactNode } from 'react'
import type { ThemeDef } from '@/lib/crawl/themes'

export interface HomeCloneProps { books: BookItem[]; loading?: boolean; navCategoryCount?: number; homeModuleLimit?: number }
export interface BookInfoProps { book: BookDetail; theme?: ThemeDef; savedPos?: { chapterId?: string; title?: string; readTimeMs?: number } | null; firstChapterId?: string; onScrollToc: () => void; onContinueRead?: () => void; onGoCategory?: (id: string) => void }
export interface CategoryListProps { books: BookItem[]; loading?: boolean; label: string; page: number; total: number; size?: number; onPage: (p: number) => void }
export interface ReadChromeProps { children: ReactNode; chapterTitle?: string; onPrev?: () => void; onNext?: () => void }
export interface RankingViewProps { books: BookItem[]; loading: boolean; tab: string; onTabChange: (t: string) => void; page: number; total: number; size: number; onPage: (p: number) => void }
export interface FulltextViewProps { books: BookItem[]; loading: boolean; page: number; total: number; size: number; onPage: (p: number) => void }
export interface SearchViewProps { q: string; books: BookItem[]; loading: boolean }
export interface KeywordViewProps { tag: string; books: BookItem[]; loading: boolean }
