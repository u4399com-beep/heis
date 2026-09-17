'use client'
import type { KeywordViewProps } from '../shared'
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
const C = {
  "id": "23qb",
  "bg": "#f8f9f9",
  "surface": "#fff",
  "text": "#282828",
  "muted": "#888",
  "primary": "#ff2a14",
  "accent": "#c01a0c",
  "border": "#eee",
  "radius": "5px",
  "font": "\"Microsoft YaHei\",sans-serif",
  "maxW": 1200
}
export function KeywordView({ tag, books, loading }: KeywordViewProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ maxWidth: C.maxW, margin: '0 auto', padding: 20, fontFamily: C.font, color: C.text }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>"{tag}" 相关小说</h1>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>加载中...</div> : !books.length ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>暂无相关书籍</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {books.map((b) => (
            <div key={b.id} {...bookNavProps(navigate, b.id)} style={{ padding: 8, background: C.surface, border: '1px solid ' + C.border, borderRadius: C.radius, cursor: 'pointer' }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: C.primary }}>{b.name}</span>
              <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>{b.author}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}