// ============================================================
// R19-1A: 生成 10 套 clone-themes 模块 (10 文件 × 10 站点 = 100 文件)
// 每套含 8 个组件 + 1 index.ts + 1 shared.ts
// 颜色全部硬编码自 themes.ts (源站 CSS 实测值), 不依赖 theme.vars
// ============================================================
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', 'src', 'components', 'public', 'clone-themes')

// 10 站点配色 — 1:1 来自 src/lib/crawl/themes.ts 实测源站 CSS 值
const SITES = [
  {
    id: 'aijjxs',
    name: '久久小说',
    bg: 'radial-gradient(1000px 420px at 0 -10%, #e0f2fe 0%, transparent 60%), radial-gradient(900px 520px at 100% 0, #ffedd5 0%, transparent 60%), #f3efe7',
    surface: '#fffdf8',
    surfaceAlt: '#eef9f7',
    text: '#1f2937',
    textMuted: '#6b7280',
    primary: '#0f766e',
    primaryText: '#ffffff',
    accent: '#b45309',
    border: '#e5dccd',
    radius: '14px',
    cardShadow: '0 10px 30px rgba(17, 24, 39, 0.08)',
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    maxW: 1220,
  },
  {
    id: 'ddyueshu',
    name: '得得小说',
    bg: '#E9FAFF',
    surface: '#ffffff',
    surfaceAlt: '#E1ECED',
    text: '#555555',
    textMuted: '#B3B3B3',
    primary: '#6F78A7',
    primaryText: '#ffffff',
    accent: '#88C6E5',
    border: '#A6D3E8',
    radius: '2px',
    cardShadow: 'none',
    fontFamily: '"宋体", "SimSun", "Microsoft YaHei", Arial, sans-serif',
    maxW: 980,
  },
  {
    id: 'pilishuwu',
    name: '霹雳书屋',
    bg: '#fdf6ec',
    surface: '#ffffff',
    surfaceAlt: '#fff5e6',
    text: '#333333',
    textMuted: '#888888',
    primary: '#fd8929',
    primaryText: '#ffffff',
    accent: '#ec5245',
    border: '#ffe4c4',
    radius: '2px',
    cardShadow: '0 2px 8px rgba(247, 119, 32, 0.12)',
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif',
    maxW: 1200,
  },
  {
    id: '23qb',
    name: '铅笔小说',
    bg: '#f8f9f9',
    surface: '#ffffff',
    surfaceAlt: '#eaedf1',
    text: '#282828',
    textMuted: '#888888',
    primary: '#ff2a14',
    primaryText: '#ffffff',
    accent: '#c01a0c',
    border: '#eaedf1',
    radius: '5px',
    cardShadow: '0 7px 21px rgba(149,157,165,0.22)',
    fontFamily: '-apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif',
    maxW: 1200,
  },
  {
    id: '101kks',
    name: '101看書',
    bg: '#f2f3f4',
    surface: '#ffffff',
    surfaceAlt: '#fff2df',
    text: '#333333',
    textMuted: '#7f8c8d',
    primary: '#667eea',
    primaryText: '#ffffff',
    accent: '#764ba2',
    border: 'rgba(0,0,0,0.08)',
    radius: '10px',
    cardShadow: '0 2px 10px rgba(0,0,0,0.08)',
    fontFamily: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif',
    maxW: 1250,
  },
  {
    id: 'huangjinwu',
    name: '黄金屋',
    bg: 'linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%)',
    surface: '#ffffff',
    surfaceAlt: '#e8f1ff',
    text: '#1e293b',
    textMuted: '#64748b',
    primary: '#2563eb',
    primaryText: '#ffffff',
    accent: '#1d4ed8',
    border: '#dbe4f0',
    radius: '6px',
    cardShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    maxW: 1180,
  },
  {
    id: 'ggd66',
    name: '格格党',
    bg: '#f9f9f9',
    surface: '#ffffff',
    surfaceAlt: '#cdf3eb',
    text: '#333333',
    textMuted: '#888888',
    primary: '#00886d',
    primaryText: '#ffffff',
    accent: '#ff5500',
    border: '#cccccc',
    radius: '4px',
    cardShadow: '0 1px 1px rgba(0,0,0,0.05)',
    fontFamily: '"微软雅黑", "Microsoft YaHei", simsun, arial, sans-serif',
    maxW: 1200,
  },
  {
    id: 'shipsay',
    name: '船说CMS',
    bg: '#f4f4f4',
    surface: '#ffffff',
    surfaceAlt: '#fafafa',
    text: '#666666',
    textMuted: '#969ba3',
    primary: '#ed4259',
    primaryText: '#ffffff',
    accent: '#bf2c24',
    border: '#e0e0e0',
    radius: '3px',
    cardShadow: '0 2px 6px rgba(0,0,0,0.06)',
    fontFamily: '"微软雅黑", "Microsoft YaHei", Arial, Tahoma, Verdana, sans-serif',
    maxW: 960,
  },
  {
    id: 'x2552',
    name: '吾爱文学',
    bg: '#fafafa',
    surface: '#ffffff',
    surfaceAlt: '#f5f5dc',
    text: '#333333',
    textMuted: '#666666',
    primary: '#2f468f',
    primaryText: '#ffffff',
    accent: '#ff6600',
    border: '#E4E4E4',
    radius: '3px',
    cardShadow: 'none',
    fontFamily: '"微软雅黑", "Microsoft YaHei", "宋体", Verdana, Arial, sans-serif',
    maxW: 960,
  },
  {
    id: 'trxsw',
    name: '天人小说',
    bg: '#f5f7fa',
    surface: '#ffffff',
    surfaceAlt: '#eef2f7',
    text: '#333333',
    textMuted: '#888888',
    primary: '#2c7be5',
    primaryText: '#ffffff',
    accent: '#1a5fb4',
    border: '#e0e6ed',
    radius: '4px',
    cardShadow: '0 1px 3px rgba(0,0,0,0.05)',
    fontFamily: '"Microsoft YaHei", Arial, sans-serif',
    maxW: 1180,
  },
]

// shared.ts — 10 套完全相同 (props 接口定义)
const SHARED_TS = `// ============================================================
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
`

// 生成 index.ts
function genIndex(site) {
  return `// ============================================================
// clone-themes/${site.id} — ${site.name} 主题模块导出
// R19-1A: 8 个组件 (HomeClone / BookInfo / CategoryList / ReadChrome /
//          RankingView / FulltextView / SearchView / KeywordView)
// 颜色全部硬编码自源站实测 CSS (见 themes.ts vars)
// ============================================================
export { HomeClone } from './HomeClone'
export { BookInfo } from './BookInfo'
export { CategoryList } from './CategoryList'
export { ReadChrome } from './ReadChrome'
export { RankingView } from './RankingView'
export { FulltextView } from './FulltextView'
export { SearchView } from './SearchView'
export { KeywordView } from './KeywordView'
export type {
  HomeCloneProps,
  BookInfoProps,
  CategoryListProps,
  ReadChromeProps,
  RankingViewProps,
  FulltextViewProps,
  SearchViewProps,
  KeywordViewProps,
} from './shared'
`
}

// HomeClone.tsx
function genHomeClone(site) {
  const c = site
  return `// ============================================================
// clone-themes/${c.id}/HomeClone.tsx — ${c.name} 首页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 顶部 banner + 多模块书籍网格 (auto-fill minmax 响应式)
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { HomeCloneProps } from './shared'

const C = {
  bg: ${JSON.stringify(c.bg)},
  surface: ${JSON.stringify(c.surface)},
  surfaceAlt: ${JSON.stringify(c.surfaceAlt)},
  text: ${JSON.stringify(c.text)},
  textMuted: ${JSON.stringify(c.textMuted)},
  primary: ${JSON.stringify(c.primary)},
  primaryText: ${JSON.stringify(c.primaryText)},
  accent: ${JSON.stringify(c.accent)},
  border: ${JSON.stringify(c.border)},
  radius: ${JSON.stringify(c.radius)},
  cardShadow: ${JSON.stringify(c.cardShadow)},
  fontFamily: ${JSON.stringify(c.fontFamily)},
  maxW: ${c.maxW},
}

function BookCard({ b }: { b: HomeCloneProps['books'][number] }) {
  const { navigate } = usePublic()
  return (
    <a
      href={'/?view=book&id=' + b.id}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate({ view: 'book', bookId: b.id })
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: C.surface,
        border: '1px solid ' + C.border,
        borderRadius: C.radius,
        boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'transform 200ms ease',
      }}
      aria-label={'查看《' + b.name + '》详情'}
    >
      <div style={{ position: 'relative' }}>
        <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
        <span style={{ position: 'absolute', left: 6, top: 6 }}><StatusBadge status={b.status} small /></span>
        <span
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            borderRadius: 999,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 700,
            background: C.primary,
            color: C.primaryText,
          }}
        >
          {formatWords(b.wordCount)}
        </span>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
        <p style={{ fontSize: 12, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</p>
        <p style={{ fontSize: 11, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ marginRight: 4, padding: '0 4px', borderRadius: C.radius, background: C.surfaceAlt, color: C.primary }}>{b.category}</span>
          {b.latestChapter || '暂无章节'}
        </p>
      </div>
    </a>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps) {
  usePublic()
  if (loading) return <BookGridSkeleton count={12} />
  if (!books || !books.length) return <EmptyState text="暂无书籍" />
  return (
    <div
      style={{
        background: C.bg,
        fontFamily: C.fontFamily,
        color: C.text,
        minHeight: '100%',
        padding: 16,
      }}
    >
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <section style={{ marginBottom: 16 }}>
          <h2 style={{
            fontSize: 18,
            fontWeight: 700,
            color: C.text,
            margin: '0 0 12px',
            paddingBottom: 8,
            borderBottom: '2px solid ' + C.primary,
          }}>
            最新上架
          </h2>
        </section>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          {books.map((b) => (
            <BookCard key={b.id} b={b} />
          ))}
        </div>
      </div>
    </div>
  )
}
`
}

// BookInfo.tsx
function genBookInfo(site) {
  const c = site
  return `// ============================================================
// clone-themes/${c.id}/BookInfo.tsx — ${c.name} 书籍详情页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 封面 + 信息键值表 + 简介面板 + 操作按钮
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { BookInfoProps } from './shared'

const C = {
  bg: ${JSON.stringify(c.bg)},
  surface: ${JSON.stringify(c.surface)},
  surfaceAlt: ${JSON.stringify(c.surfaceAlt)},
  text: ${JSON.stringify(c.text)},
  textMuted: ${JSON.stringify(c.textMuted)},
  primary: ${JSON.stringify(c.primary)},
  primaryText: ${JSON.stringify(c.primaryText)},
  accent: ${JSON.stringify(c.accent)},
  border: ${JSON.stringify(c.border)},
  radius: ${JSON.stringify(c.radius)},
  cardShadow: ${JSON.stringify(c.cardShadow)},
  fontFamily: ${JSON.stringify(c.fontFamily)},
  maxW: ${c.maxW},
}

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onContinueRead, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  const wordText = formatWords(book.wordCount)
  const continueRead = () => {
    if (onContinueRead) return onContinueRead()
    if (savedPos && savedPos.chapterId) {
      navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId })
    } else if (firstChapterId) {
      navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId })
    } else {
      onScrollToc()
    }
  }
  return (
    <div
      style={{
        background: C.bg,
        fontFamily: C.fontFamily,
        color: C.text,
        padding: 16,
      }}
    >
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            gap: 20,
            background: C.surface,
            border: '1px solid ' + C.border,
            borderRadius: C.radius,
            boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
            padding: 20,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ width: 120, height: 160, flexShrink: 0, overflow: 'hidden', borderRadius: C.radius, border: '1px solid ' + C.border }}>
            <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 12px' }}>{book.name}</h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13, color: C.textMuted, marginBottom: 12 }}>
              <span>作者: <a
                href="#"
                onClick={(e) => { e.preventDefault() }}
                style={{ color: C.primary, textDecoration: 'none' }}
              >{book.author}</a></span>
              <span>分类: {book.categoryId ? (
                <a
                  href={'/?view=category&cat=' + encodeURIComponent(book.categoryId)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                    e.preventDefault()
                    const cid = book.categoryId
                    if (!cid) return
                    if (onGoCategory) onGoCategory(cid)
                    else navigate({ view: 'category', cat: cid })
                  }}
                  style={{ color: C.primary, textDecoration: 'none' }}
                >{book.category}</a>
              ) : book.category}</span>
              <span>字数: {wordText}</span>
              <StatusBadge status={book.status} />
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.8, color: C.textMuted, margin: '0 0 12px' }}>
              最新章节: {book.latestChapter || '暂无'}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={continueRead}
                style={{
                  padding: '8px 18px',
                  background: C.primary,
                  color: C.primaryText,
                  border: 'none',
                  borderRadius: C.radius,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 700,
                }}
                aria-label="开始阅读"
              >
                {savedPos && savedPos.chapterId ? '继续阅读' : '开始阅读'}
              </button>
              <button
                type="button"
                onClick={onScrollToc}
                style={{
                  padding: '8px 18px',
                  background: C.surfaceAlt,
                  color: C.text,
                  border: '1px solid ' + C.border,
                  borderRadius: C.radius,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
                aria-label="查看目录"
              >
                查看目录
              </button>
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 14,
            background: C.surface,
            border: '1px solid ' + C.border,
            borderRadius: C.radius,
            boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
            padding: 20,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid ' + C.border }}>
            内容简介
          </h2>
          <div style={{ fontSize: 14, lineHeight: 1.9, color: C.textMuted, whiteSpace: 'pre-wrap' }}>
            {book.intro || '暂无简介'}
          </div>
        </div>
      </div>
    </div>
  )
}
`
}

// CategoryList.tsx
function genCategoryList(site) {
  const c = site
  return `// ============================================================
// clone-themes/${c.id}/CategoryList.tsx — ${c.name} 分类列表页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 标题 + 网格列表 + 分页 (auto-fill minmax 响应式)
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from './shared'

const C = {
  bg: ${JSON.stringify(c.bg)},
  surface: ${JSON.stringify(c.surface)},
  surfaceAlt: ${JSON.stringify(c.surfaceAlt)},
  text: ${JSON.stringify(c.text)},
  textMuted: ${JSON.stringify(c.textMuted)},
  primary: ${JSON.stringify(c.primary)},
  primaryText: ${JSON.stringify(c.primaryText)},
  accent: ${JSON.stringify(c.accent)},
  border: ${JSON.stringify(c.border)},
  radius: ${JSON.stringify(c.radius)},
  cardShadow: ${JSON.stringify(c.cardShadow)},
  fontFamily: ${JSON.stringify(c.fontFamily)},
  maxW: ${c.maxW},
}

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  const totalPages = Math.ceil(total / size) || 1
  if (loading) {
    return (
      <div style={{ background: C.bg, fontFamily: C.fontFamily, padding: 16 }}>
        <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
          <BookGridSkeleton count={12} />
        </div>
      </div>
    )
  }
  if (!books || !books.length) {
    return (
      <div style={{ background: C.bg, fontFamily: C.fontFamily, padding: 16 }}>
        <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
          <EmptyState text="暂无书籍" />
        </div>
      </div>
    )
  }
  return (
    <div style={{ background: C.bg, fontFamily: C.fontFamily, color: C.text, padding: 16 }}>
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <h1 style={{
          fontSize: 20,
          fontWeight: 700,
          color: C.text,
          margin: '0 0 16px',
          paddingBottom: 8,
          borderBottom: '2px solid ' + C.primary,
        }}>
          {label}
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: C.textMuted }}>
            共 {total} 本 · 第 {page} / {totalPages} 页
          </span>
        </h1>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          {books.map((b) => (
            <a
              key={b.id}
              href={'/?view=book&id=' + b.id}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                navigate({ view: 'book', bookId: b.id })
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                background: C.surface,
                border: '1px solid ' + C.border,
                borderRadius: C.radius,
                boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
                overflow: 'hidden',
                textDecoration: 'none',
                color: 'inherit',
              }}
              aria-label={'查看《' + b.name + '》详情'}
            >
              <div style={{ position: 'relative' }}>
                <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                <span style={{ position: 'absolute', left: 6, top: 6 }}><StatusBadge status={b.status} small /></span>
              </div>
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
                <p style={{ fontSize: 12, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</p>
                <p style={{ fontSize: 11, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ marginRight: 4, padding: '0 4px', borderRadius: C.radius, background: C.surfaceAlt, color: C.primary }}>{b.category}</span>
                  {formatWords(b.wordCount)}
                </p>
              </div>
            </a>
          ))}
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24, alignItems: 'center' }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
              style={{
                padding: '6px 16px',
                border: '1px solid ' + C.border,
                borderRadius: C.radius,
                background: C.surface,
                color: C.text,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                opacity: page <= 1 ? 0.5 : 1,
                fontSize: 14,
              }}
              aria-label="上一页"
            >
              上一页
            </button>
            <span style={{ padding: '6px 12px', color: C.textMuted, fontSize: 14 }}>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPage(page + 1)}
              style={{
                padding: '6px 16px',
                border: '1px solid ' + C.border,
                borderRadius: C.radius,
                background: C.surface,
                color: C.text,
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                opacity: page >= totalPages ? 0.5 : 1,
                fontSize: 14,
              }}
              aria-label="下一页"
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
`
}

// ReadChrome.tsx
function genReadChrome(site) {
  const c = site
  return `// ============================================================
// clone-themes/${c.id}/ReadChrome.tsx — ${c.name} 章节阅读外壳 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 居中窄列 + 章节标题 + 正文容器 + 上/下一章翻页栏
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import type { ReadChromeProps } from './shared'

const C = {
  bg: ${JSON.stringify(c.bg)},
  surface: ${JSON.stringify(c.surface)},
  surfaceAlt: ${JSON.stringify(c.surfaceAlt)},
  text: ${JSON.stringify(c.text)},
  textMuted: ${JSON.stringify(c.textMuted)},
  primary: ${JSON.stringify(c.primary)},
  primaryText: ${JSON.stringify(c.primaryText)},
  accent: ${JSON.stringify(c.accent)},
  border: ${JSON.stringify(c.border)},
  radius: ${JSON.stringify(c.radius)},
  cardShadow: ${JSON.stringify(c.cardShadow)},
  fontFamily: ${JSON.stringify(c.fontFamily)},
  maxW: ${c.maxW},
}

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  usePublic()
  return (
    <div
      style={{
        background: C.bg,
        fontFamily: C.fontFamily,
        color: C.text,
        minHeight: '100%',
        padding: '24px 16px',
      }}
    >
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <article
          style={{
            background: C.surface,
            border: '1px solid ' + C.border,
            borderRadius: C.radius,
            boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
            padding: 24,
          }}
        >
          {chapterTitle && (
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: C.text,
                textAlign: 'center',
                margin: '0 0 24px',
                paddingBottom: 12,
                borderBottom: '1px solid ' + C.border,
              }}
            >
              {chapterTitle}
            </h1>
          )}
          <div
            className="chapter-content"
            style={{
              fontSize: 17,
              lineHeight: 1.9,
              color: C.text,
            }}
          >
            {children}
          </div>
          {(onPrev || onNext) && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 12,
                marginTop: 32,
                paddingTop: 16,
                borderTop: '1px solid ' + C.border,
              }}
            >
              {onPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  style={{
                    padding: '8px 22px',
                    border: '1px solid ' + C.border,
                    borderRadius: C.radius,
                    background: C.surfaceAlt,
                    color: C.text,
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                  aria-label="上一章"
                >
                  上一章
                </button>
              )}
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  style={{
                    padding: '8px 22px',
                    border: 'none',
                    borderRadius: C.radius,
                    background: C.primary,
                    color: C.primaryText,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                  aria-label="下一章"
                >
                  下一章
                </button>
              )}
            </div>
          )}
        </article>
      </div>
    </div>
  )
}
`
}

// RankingView.tsx
function genRankingView(site) {
  const c = site
  return `// ============================================================
// clone-themes/${c.id}/RankingView.tsx — ${c.name} 排行榜页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: tab 切换栏 + 排序列表 (前3加色徽章) + 分页
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { RankingViewProps } from './shared'

const C = {
  bg: ${JSON.stringify(c.bg)},
  surface: ${JSON.stringify(c.surface)},
  surfaceAlt: ${JSON.stringify(c.surfaceAlt)},
  text: ${JSON.stringify(c.text)},
  textMuted: ${JSON.stringify(c.textMuted)},
  primary: ${JSON.stringify(c.primary)},
  primaryText: ${JSON.stringify(c.primaryText)},
  accent: ${JSON.stringify(c.accent)},
  border: ${JSON.stringify(c.border)},
  radius: ${JSON.stringify(c.radius)},
  cardShadow: ${JSON.stringify(c.cardShadow)},
  fontFamily: ${JSON.stringify(c.fontFamily)},
  maxW: ${c.maxW},
}

const TABS = [
  { id: 'allvisit', name: '总点击' },
  { id: 'allvote', name: '总推荐' },
  { id: 'goodnum', name: '总收藏' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
  { id: 'postdate', name: '最新入库' },
]

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage }: RankingViewProps) {
  const { navigate } = usePublic()
  const totalPages = Math.ceil(total / size) || 1
  return (
    <div style={{ background: C.bg, fontFamily: C.fontFamily, color: C.text, padding: 16 }}>
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: C.text,
          margin: '0 0 16px',
          paddingBottom: 8,
          borderBottom: '2px solid ' + C.primary,
        }}>
          排行榜
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              style={{
                padding: '6px 14px',
                background: tab === t.id ? C.primary : C.surface,
                color: tab === t.id ? C.primaryText : C.text,
                border: '1px solid ' + (tab === t.id ? C.primary : C.border),
                borderRadius: C.radius,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
              aria-pressed={tab === t.id}
            >
              {t.name}
            </button>
          ))}
        </div>
        {loading ? (
          <BookGridSkeleton count={10} />
        ) : !books || !books.length ? (
          <EmptyState text="暂无排行数据" />
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {books.map((b, i) => (
              <li key={b.id}>
                <a
                  href={'/?view=book&id=' + b.id}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                    e.preventDefault()
                    navigate({ view: 'book', bookId: b.id })
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    background: C.surface,
                    border: '1px solid ' + C.border,
                    borderRadius: C.radius,
                    boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                  aria-label={'查看《' + b.name + '》详情'}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 700,
                      background: i < 3 ? C.accent : C.surfaceAlt,
                      color: i < 3 ? C.primaryText : C.textMuted,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ width: 40, flexShrink: 0, overflow: 'hidden', borderRadius: C.radius, border: '1px solid ' + C.border }}>
                    <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
                    <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.author} · {b.category} · {formatWords(b.wordCount)}
                    </p>
                  </div>
                  <StatusBadge status={b.status} small />
                </a>
              </li>
            ))}
          </ol>
        )}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24, alignItems: 'center' }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
              style={{
                padding: '6px 16px',
                border: '1px solid ' + C.border,
                borderRadius: C.radius,
                background: C.surface,
                color: C.text,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                opacity: page <= 1 ? 0.5 : 1,
                fontSize: 14,
              }}
              aria-label="上一页"
            >
              上一页
            </button>
            <span style={{ padding: '6px 12px', color: C.textMuted, fontSize: 14 }}>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPage(page + 1)}
              style={{
                padding: '6px 16px',
                border: '1px solid ' + C.border,
                borderRadius: C.radius,
                background: C.surface,
                color: C.text,
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                opacity: page >= totalPages ? 0.5 : 1,
                fontSize: 14,
              }}
              aria-label="下一页"
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
`
}

// FulltextView.tsx
function genFulltextView(site) {
  const c = site
  return `// ============================================================
// clone-themes/${c.id}/FulltextView.tsx — ${c.name} 全本完本页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 标题 + 完本网格 (auto-fill minmax 响应式) + 分页
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { FulltextViewProps } from './shared'

const C = {
  bg: ${JSON.stringify(c.bg)},
  surface: ${JSON.stringify(c.surface)},
  surfaceAlt: ${JSON.stringify(c.surfaceAlt)},
  text: ${JSON.stringify(c.text)},
  textMuted: ${JSON.stringify(c.textMuted)},
  primary: ${JSON.stringify(c.primary)},
  primaryText: ${JSON.stringify(c.primaryText)},
  accent: ${JSON.stringify(c.accent)},
  border: ${JSON.stringify(c.border)},
  radius: ${JSON.stringify(c.radius)},
  cardShadow: ${JSON.stringify(c.cardShadow)},
  fontFamily: ${JSON.stringify(c.fontFamily)},
  maxW: ${c.maxW},
}

export function FulltextView({ books, loading, page, total, size, onPage }: FulltextViewProps) {
  const { navigate } = usePublic()
  const totalPages = Math.ceil(total / size) || 1
  return (
    <div style={{ background: C.bg, fontFamily: C.fontFamily, color: C.text, padding: 16 }}>
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: C.text,
          margin: '0 0 16px',
          paddingBottom: 8,
          borderBottom: '2px solid ' + C.primary,
        }}>
          全本完本小说
        </h1>
        {loading ? (
          <BookGridSkeleton count={12} />
        ) : !books || !books.length ? (
          <EmptyState text="暂无全本小说" />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {books.map((b) => (
              <a
                key={b.id}
                href={'/?view=book&id=' + b.id}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault()
                  navigate({ view: 'book', bookId: b.id })
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: C.surface,
                  border: '1px solid ' + C.border,
                  borderRadius: C.radius,
                  boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
                  overflow: 'hidden',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
                aria-label={'查看《' + b.name + '》详情'}
              >
                <div style={{ position: 'relative' }}>
                  <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                  <span style={{ position: 'absolute', left: 6, top: 6 }}><StatusBadge status={b.status} small /></span>
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
                  <p style={{ fontSize: 12, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</p>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>
                    {formatWords(b.wordCount)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24, alignItems: 'center' }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
              style={{
                padding: '6px 16px',
                border: '1px solid ' + C.border,
                borderRadius: C.radius,
                background: C.surface,
                color: C.text,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                opacity: page <= 1 ? 0.5 : 1,
                fontSize: 14,
              }}
              aria-label="上一页"
            >
              上一页
            </button>
            <span style={{ padding: '6px 12px', color: C.textMuted, fontSize: 14 }}>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPage(page + 1)}
              style={{
                padding: '6px 16px',
                border: '1px solid ' + C.border,
                borderRadius: C.radius,
                background: C.surface,
                color: C.text,
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                opacity: page >= totalPages ? 0.5 : 1,
                fontSize: 14,
              }}
              aria-label="下一页"
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
`
}

// SearchView.tsx
function genSearchView(site) {
  const c = site
  return `// ============================================================
// clone-themes/${c.id}/SearchView.tsx — ${c.name} 搜索结果页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 查询关键字标题 + 结果网格 (auto-fill minmax 响应式) + 空态
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { SearchViewProps } from './shared'

const C = {
  bg: ${JSON.stringify(c.bg)},
  surface: ${JSON.stringify(c.surface)},
  surfaceAlt: ${JSON.stringify(c.surfaceAlt)},
  text: ${JSON.stringify(c.text)},
  textMuted: ${JSON.stringify(c.textMuted)},
  primary: ${JSON.stringify(c.primary)},
  primaryText: ${JSON.stringify(c.primaryText)},
  accent: ${JSON.stringify(c.accent)},
  border: ${JSON.stringify(c.border)},
  radius: ${JSON.stringify(c.radius)},
  cardShadow: ${JSON.stringify(c.cardShadow)},
  fontFamily: ${JSON.stringify(c.fontFamily)},
  maxW: ${c.maxW},
}

export function SearchView({ q, books, loading }: SearchViewProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ background: C.bg, fontFamily: C.fontFamily, color: C.text, padding: 16 }}>
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <h1 style={{
          fontSize: 20,
          fontWeight: 700,
          color: C.text,
          margin: '0 0 16px',
          paddingBottom: 8,
          borderBottom: '2px solid ' + C.primary,
        }}>
          “{q}” 的搜索结果
          {!loading && books && (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: C.textMuted }}>
              共 {books.length} 本
            </span>
          )}
        </h1>
        {loading ? (
          <BookGridSkeleton count={12} />
        ) : !books || !books.length ? (
          <EmptyState text={'没有找到与“' + q + '”相关的书籍'} hint="试试更换关键词或浏览全部分类" />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {books.map((b) => (
              <a
                key={b.id}
                href={'/?view=book&id=' + b.id}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault()
                  navigate({ view: 'book', bookId: b.id })
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: C.surface,
                  border: '1px solid ' + C.border,
                  borderRadius: C.radius,
                  boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
                  overflow: 'hidden',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
                aria-label={'查看《' + b.name + '》详情'}
              >
                <div style={{ position: 'relative' }}>
                  <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                  <span style={{ position: 'absolute', left: 6, top: 6 }}><StatusBadge status={b.status} small /></span>
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
                  <p style={{ fontSize: 12, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</p>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ marginRight: 4, padding: '0 4px', borderRadius: C.radius, background: C.surfaceAlt, color: C.primary }}>{b.category}</span>
                    {formatWords(b.wordCount)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
`
}

// KeywordView.tsx
function genKeywordView(site) {
  const c = site
  return `// ============================================================
// clone-themes/${c.id}/KeywordView.tsx — ${c.name} 关键词落地页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 大标题=tag + 主书籍卡 + 次要书单 (auto-fill minmax 响应式)
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { KeywordViewProps } from './shared'

const C = {
  bg: ${JSON.stringify(c.bg)},
  surface: ${JSON.stringify(c.surface)},
  surfaceAlt: ${JSON.stringify(c.surfaceAlt)},
  text: ${JSON.stringify(c.text)},
  textMuted: ${JSON.stringify(c.textMuted)},
  primary: ${JSON.stringify(c.primary)},
  primaryText: ${JSON.stringify(c.primaryText)},
  accent: ${JSON.stringify(c.accent)},
  border: ${JSON.stringify(c.border)},
  radius: ${JSON.stringify(c.radius)},
  cardShadow: ${JSON.stringify(c.cardShadow)},
  fontFamily: ${JSON.stringify(c.fontFamily)},
  maxW: ${c.maxW},
}

export function KeywordView({ tag, books, loading }: KeywordViewProps) {
  const { navigate } = usePublic()
  const main = books && books.length > 0 ? books[0] : null
  const others = books && books.length > 1 ? books.slice(1) : []
  return (
    <div style={{ background: C.bg, fontFamily: C.fontFamily, color: C.text, padding: 16 }}>
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{
            fontSize: 28,
            fontWeight: 800,
            color: C.text,
            margin: '0 0 8px',
          }}>
            “{tag}” 相关小说推荐
          </h1>
          <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>
            精选“{tag}”相关小说 · 在线阅读 + 全文免费阅读 + TXT 下载
          </p>
        </header>
        {loading ? (
          <BookGridSkeleton count={6} />
        ) : !books || !books.length ? (
          <EmptyState text={'暂无与“' + tag + '”直接匹配的书籍'} hint="试试浏览其他分类或搜索其他关键词" />
        ) : (
          <>
            {main && (
              <section
                style={{
                  background: C.surface,
                  border: '1px solid ' + C.border,
                  borderRadius: C.radius,
                  boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
                  padding: 20,
                  marginBottom: 24,
                }}
                aria-label="主关键词书籍"
              >
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ width: 144, flexShrink: 0, overflow: 'hidden', borderRadius: C.radius, border: '1px solid ' + C.border }}>
                    <BookCover name={main.name} cover={main.cover} className="aspect-[3/4] w-full" />
                  </div>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', color: C.accent }}>主关键词书籍</span>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: '4px 0 8px' }}>
                      <a
                        href={'/?view=book&id=' + main.id}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                          e.preventDefault()
                          navigate({ view: 'book', bookId: main.id })
                        }}
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        {main.name}
                      </a>
                    </h2>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13, color: C.textMuted, marginBottom: 8 }}>
                      <span>作者: {main.author}</span>
                      <span style={{ padding: '0 6px', borderRadius: C.radius, background: C.surfaceAlt, color: C.primary }}>{main.category}</span>
                      <StatusBadge status={main.status} />
                      <span>{formatWords(main.wordCount)}</span>
                    </div>
                    <p style={{ fontSize: 14, lineHeight: 1.8, color: C.text, margin: '0 0 12px' }}>
                      {main.intro || '暂无简介'}
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate({ view: 'book', bookId: main.id })}
                      style={{
                        padding: '8px 18px',
                        background: C.primary,
                        color: C.primaryText,
                        border: 'none',
                        borderRadius: C.radius,
                        cursor: 'pointer',
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                      aria-label={'查看《' + main.name + '》详情'}
                    >
                      查看书籍详情
                    </button>
                  </div>
                </div>
              </section>
            )}
            {others.length > 0 && (
              <section aria-label="其他相关书籍">
                <h2 style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  margin: '0 0 12px',
                  paddingBottom: 6,
                  borderBottom: '1px solid ' + C.border,
                }}>
                  其他相关书籍
                </h2>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {others.map((b, i) => (
                    <li key={b.id}>
                      <a
                        href={'/?view=book&id=' + b.id}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                          e.preventDefault()
                          navigate({ view: 'book', bookId: b.id })
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 0',
                          borderBottom: '1px solid ' + C.border,
                          textDecoration: 'none',
                          color: C.text,
                          fontSize: 14,
                        }}
                      >
                        <span style={{
                          width: 24,
                          textAlign: 'center',
                          color: i < 3 ? C.primary : C.textMuted,
                          fontWeight: 700,
                          fontStyle: 'italic',
                        }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                        <span style={{ fontSize: 12, color: C.textMuted }}>{b.author}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
`
}

// ============================================================
// 主流程: 写出全部 100 文件
// ============================================================
let total = 0
for (const site of SITES) {
  const dir = path.join(ROOT, site.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'shared.ts'), SHARED_TS)
  fs.writeFileSync(path.join(dir, 'index.ts'), genIndex(site))
  fs.writeFileSync(path.join(dir, 'HomeClone.tsx'), genHomeClone(site))
  fs.writeFileSync(path.join(dir, 'BookInfo.tsx'), genBookInfo(site))
  fs.writeFileSync(path.join(dir, 'CategoryList.tsx'), genCategoryList(site))
  fs.writeFileSync(path.join(dir, 'ReadChrome.tsx'), genReadChrome(site))
  fs.writeFileSync(path.join(dir, 'RankingView.tsx'), genRankingView(site))
  fs.writeFileSync(path.join(dir, 'FulltextView.tsx'), genFulltextView(site))
  fs.writeFileSync(path.join(dir, 'SearchView.tsx'), genSearchView(site))
  fs.writeFileSync(path.join(dir, 'KeywordView.tsx'), genKeywordView(site))
  total += 10
  console.log('✓ generated ' + site.id + '/ (' + 10 + ' files)')
}
console.log('\nTotal: ' + total + ' files written to ' + ROOT)
