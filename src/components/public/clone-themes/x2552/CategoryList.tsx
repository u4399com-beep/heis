'use client'
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: v.textMuted }}>加载中...</div>
  if (!books.length) return <div style={{ padding: 40, textAlign: 'center', color: v.textMuted }}>暂无书籍</div>
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: v.text, marginBottom: 16 }}>{label}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {books.map((b) => (
          <div key={b.id} {...bookNavProps(navigate, b.id)} style={{ padding: 8, background: v.surface, border: '1px solid ' + v.border, borderRadius: v.radius, cursor: 'pointer' }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: v.primary }}>{b.name}</span>
            <span style={{ fontSize: 12, color: v.textMuted, marginLeft: 8 }}>{b.author}</span>
          </div>
        ))}
      </div>
      {total > size && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          {page > 1 && <button onClick={() => onPage(page - 1)} style={{ padding: '6px 16px', border: '1px solid ' + v.border, borderRadius: v.radius, background: v.surface, color: v.text, cursor: 'pointer' }}>上一页</button>}
          <span style={{ padding: '6px 12px', color: v.textMuted }}>第 {page} 页</span>
          {page * size < total && <button onClick={() => onPage(page + 1)} style={{ padding: '6px 16px', border: '1px solid ' + v.border, borderRadius: v.radius, background: v.surface, color: v.text, cursor: 'pointer' }}>下一页</button>}
        </div>
      )}
    </div>
  )
}
