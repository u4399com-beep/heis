'use client'
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, onScrollToc }: BookInfoProps) {
  const { theme } = usePublic()
  const v = theme.vars
  if (!book) return null
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
      <div style={{ display: 'flex', gap: 20, background: v.surface, border: '1px solid ' + v.border, borderRadius: v.radius, padding: 24 }}>
        <div style={{ width: 120, height: 160, flexShrink: 0, overflow: 'hidden', borderRadius: v.radius, border: '1px solid ' + v.border }}>
          <BookCover name={book.name} cover={book.cover} className="w-full h-full" />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: v.text, marginBottom: 8 }}>{book.name}</h1>
          <p style={{ color: v.textMuted, fontSize: 14, lineHeight: 2 }}>作者: {book.author} | 分类: {book.category} | 字数: {(book.wordCount / 10000).toFixed(1)}万字</p>
          <p style={{ color: v.textMuted, fontSize: 13, lineHeight: 1.8, marginTop: 8 }}>{book.intro?.slice(0, 200)}...</p>
          <button onClick={onScrollToc} style={{ marginTop: 12, padding: '6px 16px', background: v.primary, color: v.primaryText, border: 'none', borderRadius: v.radius, cursor: 'pointer' }}>开始阅读</button>
        </div>
      </div>
    </div>
  )
}
