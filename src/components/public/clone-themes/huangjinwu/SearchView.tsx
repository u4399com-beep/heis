'use client'
import type { SearchViewProps } from '../shared'
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
const C = {
  "id": "huangjinwu",
  "bg": "linear-gradient(180deg,#f5f8ff 0%,#eef3fb 100%)",
  "surface": "#fff",
  "text": "#1e293b",
  "muted": "#64748b",
  "primary": "#2563eb",
  "accent": "#1d4ed8",
  "border": "#dbe4f0",
  "radius": "6px",
  "font": "-apple-system,\"Microsoft YaHei\",sans-serif",
  "maxW": 1200
}
export function SearchView({ q, books, loading }: SearchViewProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ maxWidth: C.maxW, margin: '0 auto', padding: 20, fontFamily: C.font, color: C.text }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>搜索: {q}</h1>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>搜索中...</div> : !books.length ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>未找到相关书籍</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {books.map((b) => (
            <div key={b.id} {...bookNavProps(navigate, b.id)} style={{ padding: 12, background: C.surface, border: '1px solid ' + C.border, borderRadius: C.radius, cursor: 'pointer' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.primary }}>{b.name}</span>
              <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>{b.author} · {b.category}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}