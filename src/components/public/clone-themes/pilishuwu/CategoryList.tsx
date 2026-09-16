'use client'
// pilishuwu.com 分类列表页 1:1 克隆 — wmcms-web 模板
// 源站 DOM: .ui-wm > .novelslist (table.grid) + 分页
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()

  if (loading) {
    return (
      <div className="ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', padding: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 40, textAlign: 'center', color: '#999' }}>
          加载中...
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div className="ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', padding: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 40, textAlign: 'center', color: '#999' }}>
          没有找到相关小说
        </div>
      </div>
    )
  }

  return (
    <div className="ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', padding: 16, fontFamily: '"宋体", Arial, sans-serif', fontSize: 12, color: '#666' }}>
      {/* 面包屑 */}
      <div className="breadcrumb" style={{ padding: '8px 0', marginBottom: 12, color: '#999' }}>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fa8729', textDecoration: 'none' }}>首页</a>
        <span style={{ margin: '0 6px' }}>&gt;</span>
        <span style={{ color: '#333' }}>{label}</span>
      </div>

      <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#333', margin: '0 0 12px', paddingBottom: 8, borderBottom: '2px solid #f1854b' }}>
          {label}小说列表
        </h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafafa', color: '#666' }}>
              <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400, width: 80 }}>类别</th>
              <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>书名</th>
              <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>最新章节</th>
              <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400, width: 100 }}>作者</th>
              <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400, width: 80 }}>字数</th>
              <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400, width: 80 }}>更新</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id} style={{ borderTop: '1px dashed #eee' }}>
                <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#fa8729', fontSize: 12 }}>[{b.category}]</span>
                </td>
                <td style={{ padding: '8px 6px' }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#333', textDecoration: 'none', fontWeight: 700 }}>
                    {b.name}
                  </a>
                </td>
                <td style={{ padding: '8px 6px', color: '#999', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.latestChapter || '—'}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.author}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{formatWords(b.wordCount)}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > size && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 12, borderTop: '1px dashed #eee' }}>
            {page > 1 && (
              <button onClick={() => onPage(page - 1)} style={{ padding: '6px 18px', border: '1px solid #f1854b', borderRadius: 4, background: '#fff', color: '#fa8729', cursor: 'pointer', fontSize: 13 }}>
                上一页
              </button>
            )}
            <span style={{ color: '#999', fontSize: 13 }}>第 {page} 页 / 共 {Math.ceil(total / size)} 页</span>
            {page * size < total && (
              <button onClick={() => onPage(page + 1)} style={{ padding: '6px 18px', border: '1px solid #f1854b', borderRadius: 4, background: '#f1854b', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                下一页
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
