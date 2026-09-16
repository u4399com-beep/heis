'use client'
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { HomeCloneProps } from '../shared'

export function HomeClone({ books, loading, homeModuleLimit = 20 }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
  if (!books.length) return null
  const list = books.slice(0, homeModuleLimit)
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>{site.name}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {list.map((b) => (
          <div key={b.id} {...bookNavProps(navigate, b.id)} style={{ cursor: 'pointer', background: '#fff', border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
            <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
            <div style={{ padding: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
              <p style={{ fontSize: 12, color: '#888' }}>{b.author}</p>
              <p style={{ fontSize: 11, color: '#aaa' }}>{formatWords(b.wordCount)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
