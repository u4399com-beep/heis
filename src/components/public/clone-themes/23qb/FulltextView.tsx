'use client'
import type { FulltextViewProps } from '../shared'
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'

export function FulltextView({ books, loading, page, total, size, onPage }: FulltextViewProps) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: v.textMuted }}>加载中...</div>
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: v.text, marginBottom: 16 }}>全本完本小说</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {books.map((b) => (
          <div key={b.id} {...bookNavProps(navigate, b.id)} style={{ cursor: 'pointer', background: v.surface, border: '1px solid ' + v.border, borderRadius: v.radius, overflow: 'hidden' }}>
            <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
            <div style={{ padding: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: v.text }}>{b.name}</h3>
              <p style={{ fontSize: 12, color: v.textMuted }}>{b.author}</p>
              <p style={{ fontSize: 11, color: v.textMuted }}>{formatWords(b.wordCount)}</p>
            </div>
          </div>
        ))}
      </div>
      {total > size && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          {page > 1 && <button onClick={() => onPage(page - 1)} style={{ padding: '6px 16px', border: '1px solid ' + v.border, borderRadius: v.radius, cursor: 'pointer' }}>上一页</button>}
          <span style={{ padding: '6px 12px' }}>第 {page} 页</span>
          {page * size < total && <button onClick={() => onPage(page + 1)} style={{ padding: '6px 16px', border: '1px solid ' + v.border, borderRadius: v.radius, cursor: 'pointer' }}>下一页</button>}
        </div>
      )}
    </div>
  )
}
