'use client'
// huangjinwu.org (黄金屋) 分类列表页 1:1 克隆 — default 模板
// 源站 DOM: .container .book-list (book-list-item)
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()

  if (loading) {
    return (
      <div style={{ background: '#f0f4fb', padding: '32px 16px' }}>
        <div className="container" style={{ maxWidth: 1180, margin: '0 auto' }}>
          <div style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, padding: 40, textAlign: 'center', color: '#64748b' }}>加载中...</div>
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div style={{ background: '#f0f4fb', padding: '32px 16px' }}>
        <div className="container" style={{ maxWidth: 1180, margin: '0 auto' }}>
          <div style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, padding: 40, textAlign: 'center', color: '#64748b' }}>没有找到相关小说</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#f0f4fb', color: '#1e293b', fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 16, minHeight: '100%' }}>
      <div className="main-content" style={{ padding: '32px 0' }}>
        <div className="container" style={{ maxWidth: 1180, margin: '0 auto', padding: '0 16px' }}>
          {/* 面包屑 */}
          <div className="breadcrumb" style={{ color: '#64748b', fontSize: 15, marginBottom: '1.6rem', padding: '1.2rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <ul className="breadcrumb-list" style={{ alignItems: 'center', display: 'flex', gap: '0.8rem', listStyle: 'none', margin: 0, padding: 0 }}>
              <li className="breadcrumb-item">
                <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#1d4ed8', textDecoration: 'none' }}>首页</a>
              </li>
              <li className="breadcrumb-separator" style={{ color: '#64748b' }}>/</li>
              <li className="breadcrumb-item active" style={{ color: '#64748b' }}>{label}</li>
            </ul>
          </div>

          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#1e293b', fontSize: 21, fontWeight: 600, marginBottom: '2rem', paddingLeft: '1.6rem', borderLeft: '4px solid #2563eb', borderRadius: '2px 0 0 2px' }}>
            <span>{label}小说列表</span>
            <span style={{ color: '#64748b', fontSize: 14, fontWeight: 400 }}>共 {total} 本</span>
          </h1>

          {/* 源站 .book-list — 列表型卡片 */}
          <ul className="book-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {books.map((b) => (
              <li key={b.id} className="book-list-item" style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)', marginBottom: '1.6rem', padding: '2rem', transition: 'box-shadow 0.3s' }}>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                  style={{ color: '#1e293b', display: 'flex', gap: '2.4rem', textDecoration: 'none' }}
                >
                  <div className="book-list-cover" style={{ background: '#dbe4f0', border: '1px solid #dbe4f0', borderRadius: 10, flexShrink: 0, height: 130, overflow: 'hidden', position: 'relative', width: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>
                    {b.category}
                  </div>
                  <div className="book-list-info" style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
                    <div className="book-list-title" style={{ color: '#1e293b', fontSize: 18, fontWeight: 600, marginBottom: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name}
                    </div>
                    <div className="book-list-desc" style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: '1.6rem', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {b.intro || '暂无简介'}
                    </div>
                    <div className="book-list-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '2.4rem', color: '#64748b', fontSize: 14 }}>
                      <span>作者：{b.author}</span>
                      <span>分类：{b.category}</span>
                      <span>字数：{formatWords(b.wordCount)}</span>
                      <span>更新：{b.updatedAt ? fmtDate(b.updatedAt) : '—'}</span>
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>

          {total > size && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: '2.4rem' }}>
              {page > 1 && (
                <button onClick={() => onPage(page - 1)} style={{ padding: '10px 24px', border: '1px solid #dbe4f0', borderRadius: 10, background: '#fff', color: '#1e293b', cursor: 'pointer', fontSize: 15 }}>
                  上一页
                </button>
              )}
              <span style={{ color: '#64748b', fontSize: 15 }}>第 {page} 页 / 共 {Math.ceil(total / size)} 页</span>
              {page * size < total && (
                <button onClick={() => onPage(page + 1)} style={{ padding: '10px 24px', border: 'none', borderRadius: 10, background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 15 }}>
                  下一页
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
