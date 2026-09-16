'use client'
// ddyueshu.cc 分类列表页 1:1 克隆 — biquge.css 模板
// 源站 DOM: .box_con > .con_top + table.grid + 分页
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()

  if (loading) {
    return (
      <div className="box_con" style={{ width: 980, maxWidth: '100%', margin: '70px auto 16px', padding: '0 14px', background: '#E9FAFF', color: '#555', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12 }}>
        <div style={{ background: '#FEF9EF', border: '3px solid #C3DFEA', borderRadius: 4, padding: 40, textAlign: 'center', color: '#888' }}>
          加载中...
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div className="box_con" style={{ width: 980, maxWidth: '100%', margin: '70px auto 16px', padding: '0 14px', background: '#E9FAFF', color: '#555', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12 }}>
        <div style={{ background: '#FEF9EF', border: '3px solid #C3DFEA', borderRadius: 4, padding: 40, textAlign: 'center', color: '#888' }}>
          没有找到相关小说
        </div>
      </div>
    )
  }

  return (
    <div className="box_con" style={{ width: 980, maxWidth: '100%', margin: '70px auto 16px', padding: '0 14px', background: '#E9FAFF', color: '#555', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12 }}>
      <div className="con_top" style={{ borderBottom: '1px solid #88C6E5', textAlign: 'left', padding: '0 10px', lineHeight: '40px', height: 40, background: '#E1ECED', marginBottom: 10 }}>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#6F78A7', textDecoration: 'none' }}>{'>'} 首页</a>
        <span style={{ color: '#B3B3B3' }}>&nbsp;&gt;&nbsp;{label}</span>
      </div>

      {/* 源站 table.grid caption */}
      <table className="grid" style={{ border: '2px solid #C3DFEA', borderCollapse: 'collapse', margin: '0 auto 12px', padding: 3, width: '100%' }}>
        <caption style={{ background: '#E1ECED', border: '2px solid #C3DFEA', borderBottom: 0, fontSize: 14, fontWeight: 700, padding: '5px 0', textAlign: 'center', verticalAlign: 'middle', color: '#1f6cb2' }}>
          {label}小说列表
        </caption>
        <thead>
          <tr style={{ background: '#F6F8FE', borderBottom: '1px solid #DDDDDD', fontSize: 14, fontWeight: 700 }}>
            <th style={{ padding: '6px 8px', textAlign: 'left', width: 80, color: '#555' }}>类别</th>
            <th style={{ padding: '6px 8px', textAlign: 'left', color: '#555' }}>书名 / 最新章节</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', width: 80, color: '#555' }}>作者</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', width: 80, color: '#555' }}>字数</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', width: 80, color: '#555' }}>更新</th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <tr key={b.id} style={{ borderTop: '1px solid #C3DFEA' }}>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4, whiteSpace: 'nowrap' }}>
                <span style={{ color: '#1f6cb2', fontSize: 12 }}>[{b.category}]</span>
              </td>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#6F78A7', textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>
                  {b.name}
                </a>
                <span style={{ color: '#B3B3B3', marginLeft: 8, fontSize: 12 }}>{b.latestChapter || '暂无章节'}</span>
              </td>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4, textAlign: 'right', color: '#B3B3B3', fontSize: 12, whiteSpace: 'nowrap' }}>{b.author}</td>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4, textAlign: 'right', color: '#555', fontSize: 12, whiteSpace: 'nowrap' }}>{formatWords(b.wordCount)}</td>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4, textAlign: 'right', color: '#B3B3B3', fontSize: 12, whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {total > size && (
        <div className="bottem1" style={{ clear: 'both', textAlign: 'center', margin: '8px 5px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          {page > 1 && (
            <button onClick={() => onPage(page - 1)} style={{ padding: '6px 16px', border: '1px solid #88C6E5', borderRadius: 4, background: '#fff', color: '#1f6cb2', cursor: 'pointer', fontSize: 13 }}>
              上一页
            </button>
          )}
          <span style={{ padding: '6px 12px', color: '#888', fontSize: 13 }}>第 {page} 页 / 共 {Math.ceil(total / size)} 页</span>
          {page * size < total && (
            <button onClick={() => onPage(page + 1)} style={{ padding: '6px 16px', border: '1px solid #88C6E5', borderRadius: 4, background: '#1f6cb2', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
              下一页
            </button>
          )}
        </div>
      )}
    </div>
  )
}
