'use client'
import type { KeywordViewProps } from '../shared'
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'

export function KeywordView({ tag, books, loading }: KeywordViewProps) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: v.text, marginBottom: 16 }}>"{tag}" 相关小说</h1>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: v.textMuted }}>加载中...</div> : !books.length ? <div style={{ padding: 40, textAlign: 'center', color: v.textMuted }}>暂无相关书籍</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {books.map((b) => (
            <div key={b.id} {...bookNavProps(navigate, b.id)} style={{ padding: 8, background: v.surface, border: '1px solid ' + v.border, borderRadius: v.radius, cursor: 'pointer' }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: v.primary }}>{b.name}</span>
              <span style={{ fontSize: 12, color: v.textMuted, marginLeft: 8 }}>{b.author}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
