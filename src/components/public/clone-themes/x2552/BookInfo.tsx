'use client'
import type { BookInfoProps } from '../shared'
import { BookCover } from '../../BookCover'
const C = {"id":"x2552","bg":"#fafafa","surface":"#fff","text":"#666","muted":"#999","primary":"#2f468f","accent":"#ff6600","border":"#eee","radius":"3px","font":"\"Microsoft YaHei\",sans-serif","maxW":1200}
export function BookInfo({ book, onScrollToc }: BookInfoProps) {
  if (!book) return null
  return (
    <div style={{ maxWidth: C.maxW, margin: '0 auto', padding: 20, fontFamily: C.font, color: C.text }}>
      <div style={{ display: 'flex', gap: 20, background: C.surface, border: '1px solid ' + C.border, borderRadius: C.radius, padding: 24 }}>
        <div style={{ width: 120, height: 160, flexShrink: 0, overflow: 'hidden', borderRadius: C.radius, border: '1px solid ' + C.border }}>
          <BookCover name={book.name} cover={book.cover} className="w-full h-full" />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 8 }}>{book.name}</h1>
          <p style={{ color: C.muted, fontSize: 14, lineHeight: 2 }}>作者: {book.author} | 分类: {book.category} | 字数: {(book.wordCount / 10000).toFixed(1)}万字</p>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.8, marginTop: 8 }}>{book.intro}</p>
          <button onClick={onScrollToc} style={{ marginTop: 12, padding: '6px 16px', background: C.primary, color: '#fff', border: 'none', borderRadius: C.radius, cursor: 'pointer' }}>开始阅读</button>
        </div>
      </div>
    </div>
  )
}