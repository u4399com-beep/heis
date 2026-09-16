'use client'
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>加载中...</div>
  if (!books.length) return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>没有找到相关书籍</div>

  return (
    <div className="wrap" style={{ maxWidth: 1220, margin: '0 auto', padding: '18px 14px 36px' }}>
      <article className="panel" style={{ background: 'rgba(255,253,248,.9)', border: '1px solid #e5dccd', borderRadius: 14, padding: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', margin: '0 0 16px', paddingBottom: 8, borderBottom: '2px solid #0f766e' }}>
          {label}电子书下载
        </h1>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f7f1e3', color: '#6b7280' }}>
              <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>类别</th>
              <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>书名 / 最新章节</th>
              <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>字数</th>
              <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>更新</th>
            </tr></thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.id} style={{ borderTop: '1px solid #e5dccd' }}>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}><span style={{ color: '#b45309', fontSize: 12 }}>{b.category}</span></td>
                  <td style={{ padding: '8px 6px' }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#115e59', textDecoration: 'none', fontWeight: 500 }}>《{b.name}》</a>
                    <span style={{ color: '#6b7280', marginLeft: 8, fontSize: 12 }}>{b.latestChapter || '暂无章节'}</span>
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: '#6b7280', fontSize: 12 }}>{formatWords(b.wordCount)}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: '#6b7280', fontSize: 12 }}>{b.updatedAt ? new Date(b.updatedAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > size && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            {page > 1 && <button onClick={() => onPage(page - 1)} style={{ padding: '6px 16px', border: '1px solid #0f766e', borderRadius: 8, background: '#fff', color: '#0f766e', cursor: 'pointer' }}>上一页</button>}
            <span style={{ padding: '6px 12px', color: '#6b7280' }}>第 {page} 页</span>
            {page * size < total && <button onClick={() => onPage(page + 1)} style={{ padding: '6px 16px', border: '1px solid #0f766e', borderRadius: 8, background: '#fff', color: '#0f766e', cursor: 'pointer' }}>下一页</button>}
          </div>
        )}
      </article>
    </div>
  )
}
