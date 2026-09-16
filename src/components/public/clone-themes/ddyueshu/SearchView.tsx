'use client'
import type { SearchViewProps } from '../shared'
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'

export function SearchView({ q, books, loading }: SearchViewProps) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: v.text, marginBottom: 16 }}>搜索: {q}</h1>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: v.textMuted }}>搜索中...</div> : !books.length ? <div style={{ padding: 40, textAlign: 'center', color: v.textMuted }}>未找到相关书籍</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {books.map((b) => (
            <div key={b.id} {...bookNavProps(navigate, b.id)} style={{ padding: 12, background: v.surface, border: '1px solid ' + v.border, borderRadius: v.radius, cursor: 'pointer' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: v.primary }}>{b.name}</span>
              <span style={{ fontSize: 12, color: v.textMuted, marginLeft: 8 }}>{b.author} · {b.category}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
