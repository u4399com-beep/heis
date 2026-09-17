'use client'
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { HomeCloneProps } from '../shared'
const C = {"id":"trxsw","bg":"#f5f7fa","surface":"#fff","text":"#333","muted":"#888","primary":"#2c7be5","accent":"#1a5fb4","border":"#e0e6ed","radius":"4px","font":"\"Microsoft YaHei\",Arial,sans-serif","maxW":1200}
export function HomeClone({ books, loading, homeModuleLimit = 20 }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontFamily: C.font }}>加载中...</div>
  if (!books.length) return null
  const list = books.slice(0, homeModuleLimit)
  return (
    <div style={{ maxWidth: C.maxW, margin: '0 auto', padding: 16, fontFamily: C.font, background: C.bg, color: C.text, minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '2px solid ' + C.primary, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{site.name}</h1>
        <span style={{ fontSize: 13, color: C.muted }}>共 {books.length} 本</span>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {list.map(b => (
          <div key={b.id} {...bookNavProps(navigate, b.id)} style={{ cursor: 'pointer', background: C.surface, border: '1px solid ' + C.border, borderRadius: C.radius, overflow: 'hidden' }}>
            <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
            <div style={{ padding: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>{b.name}</h3>
              <p style={{ fontSize: 12, color: C.muted }}>{b.author}</p>
              <p style={{ fontSize: 11, color: C.muted }}>{formatWords(b.wordCount)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}