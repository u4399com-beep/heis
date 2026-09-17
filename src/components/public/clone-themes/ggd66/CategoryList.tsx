'use client'
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
const C = {
  "id": "ggd66",
  "bg": "#f9f9f9",
  "surface": "#fff",
  "text": "#888",
  "muted": "#aaa",
  "primary": "#00886d",
  "accent": "#56ccb5",
  "border": "#eee",
  "radius": "4px",
  "font": "\"微软雅黑\",Microsoft Yahei,sans-serif",
  "maxW": 1200
}
export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontFamily: C.font }}>加载中...</div>
  if (!books.length) return <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontFamily: C.font }}>暂无书籍</div>
  return (
    <div style={{ maxWidth: C.maxW, margin: '0 auto', padding: 20, fontFamily: C.font, color: C.text }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{label}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {books.map((b) => (
          <div key={b.id} {...bookNavProps(navigate, b.id)} style={{ padding: 8, background: C.surface, border: '1px solid ' + C.border, borderRadius: C.radius, cursor: 'pointer' }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: C.primary }}>{b.name}</span>
            <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>{b.author}</span>
          </div>
        ))}
      </div>
      {total > size && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          {page > 1 && <button onClick={() => onPage(page - 1)} style={{ padding: '6px 16px', border: '1px solid ' + C.border, borderRadius: C.radius, background: C.surface, color: C.text, cursor: 'pointer' }}>上一页</button>}
          <span style={{ padding: '6px 12px', color: C.muted }}>第 {page} 页</span>
          {page * size < total && <button onClick={() => onPage(page + 1)} style={{ padding: '6px 16px', border: '1px solid ' + C.border, borderRadius: C.radius, background: C.surface, color: C.text, cursor: 'pointer' }}>下一页</button>}
        </div>
      )}
    </div>
  )
}