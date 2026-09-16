<<<<<<< HEAD
// ============================================================
// clone-themes/101kks CategoryList — 101看書分类页 1:1 克隆
// 实测 probe-html2/probe-101kks-category.html (cdnshu 模板):
//   .booklist-grid (booklist-card list)
//   .page 分页
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { fmtDate, formatWords } from '../../seo'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif'
const INK = '#333333'
const MUTED = '#7f8c8d'
const PRIMARY = '#667eea'
const ACCENT = '#764ba2'
const BORDER = 'rgba(0,0,0,0.08)'
const RADIUS = '10px'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <span style={{ display: 'inline-block', width: '4px', height: '20px', background: PRIMARY, borderRadius: '2px' }} />
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#2c3e50' }}>{label}</h1>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {['全部', '玄幻', '武俠', '都市', '歷史', '科幻', '遊戲', '女生'].map((n, i) => (
          <a key={n} href="javascript:;" style={{ padding: '4px 12px', fontSize: '13px', border: `1px solid ${BORDER}`, borderRadius: '999px', background: i === 0 ? PRIMARY : '#fff', color: i === 0 ? '#fff' : INK, textDecoration: 'none' }}>{n}</a>
        ))}
      </div>
      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>加載中...</div>
      ) : !books.length ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>沒有找到相關書籍</div>
      ) : (
        <div className="booklist-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: '12px' }}>
          {books.map((b) => (
            // R15-1C a11y fix: 原 <div onClick> 改为 <a href> + onClick preventDefault (键盘可达 + 屏读器识别为链接)
            <a key={b.id} href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} className="booklist-card" style={{ background: '#fff', borderRadius: RADIUS, boxShadow: '0 2px 10px rgba(0,0,0,0.08)', border: `1px solid ${BORDER}`, padding: '14px', display: 'flex', gap: '12px', cursor: 'pointer', minHeight: '128px', textDecoration: 'none', color: INK }}>
              <div style={{ width: '60px', height: '80px', background: `linear-gradient(135deg, ${PRIMARY} 0%, ${ACCENT} 100%)`, borderRadius: '6px', flexShrink: 0, padding: '2px' }}>
                <BookCover name={b.name} cover={b.cover} className="book-cover" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#2c3e50', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: MUTED, marginBottom: '6px' }}>
                  <span>{b.author}</span>
                  <span>· {b.category}</span>
                  <span>· {formatWords(b.wordCount)}</span>
                  <span>· {fmtDate(b.updatedAt) || ''}</span>
                </div>
                <div style={{ fontSize: '13px', color: MUTED, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.intro}</div>
              </div>
            </a>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '20px 0' }}>
        {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '6px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', borderRadius: RADIUS }}>上一頁</a>}
        <span style={{ padding: '6px 12px', background: PRIMARY, color: '#fff', borderRadius: RADIUS }}>{page}</span>
        <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '6px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', borderRadius: RADIUS }}>下一頁</a>
        <span style={{ padding: '6px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
=======
'use client'
// 101kks.com (101看書) 分类列表页 1:1 克隆 — cdnshu 模板 (繁體)
// 源站 DOM: .container .mybox (table)
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()

  if (loading) {
    return (
      <div style={{ background: '#f2f3f4', padding: '90px 15px 16px' }}>
        <div style={{ maxWidth: 1112, margin: '0 auto' }}>
          <div className="mybox" style={{ background: '#fff', borderRadius: 3, padding: 40, textAlign: 'center', color: '#999', boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)' }}>加載中...</div>
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div style={{ background: '#f2f3f4', padding: '90px 15px 16px' }}>
        <div style={{ maxWidth: 1112, margin: '0 auto' }}>
          <div className="mybox" style={{ background: '#fff', borderRadius: 3, padding: 40, textAlign: 'center', color: '#999', boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)' }}>沒有找到相關小說</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#f2f3f4', color: '#333', fontFamily: '"Microsoft YaHei", sans-serif', fontSize: 14, minHeight: '100%' }}>
      <div className="main">
        <div className="container" style={{ maxWidth: 1112, margin: '90px auto 16px', padding: '0 15px', boxSizing: 'border-box' }}>
          {/* 面包屑 */}
          <div className="breadcrumb" style={{ padding: '8px 0', marginBottom: 12, color: '#888', fontSize: 13 }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#1f6cb2', textDecoration: 'none' }}>首頁</a>
            <span style={{ margin: '0 6px' }}>&gt;</span>
            <span style={{ color: '#333' }}>{label}</span>
          </div>

          <div className="mybox" style={{ background: '#fff', borderRadius: 3, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)' }}>
            <h3 className="mytitle" style={{ margin: '0 0 12px', borderBottom: '1px solid rgba(150,150,150,0.2)', paddingBottom: 5, fontSize: 16, color: '#333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{label}小說列表</span>
              <span style={{ color: '#888', fontSize: 13, fontWeight: 400 }}>共 {total} 本</span>
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f5f5f5', color: '#666' }}>
                  <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>類別</th>
                  <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>書名</th>
                  <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>最新章節</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>作者</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>字數</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>更新</th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#1f6cb2', fontSize: 12, background: 'rgba(31,108,178,0.1)', padding: '2px 8px', borderRadius: 4 }}>{b.category}</span>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#333', textDecoration: 'none', fontWeight: 500 }}>
                        {b.name}
                      </a>
                    </td>
                    <td style={{ padding: '8px 6px', color: '#888', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.latestChapter || '—'}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: '#888', whiteSpace: 'nowrap' }}>{b.author}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: '#888', whiteSpace: 'nowrap' }}>{formatWords(b.wordCount)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: '#888', whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {total > size && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 12, borderTop: '1px solid #eee' }}>
                {page > 1 && (
                  <button onClick={() => onPage(page - 1)} style={{ padding: '8px 20px', border: '1px solid #1f6cb2', borderRadius: 4, background: '#fff', color: '#1f6cb2', cursor: 'pointer', fontSize: 13 }}>
                    上一頁
                  </button>
                )}
                <span style={{ color: '#888', fontSize: 13 }}>第 {page} 頁 / 共 {Math.ceil(total / size)} 頁</span>
                {page * size < total && (
                  <button onClick={() => onPage(page + 1)} style={{ padding: '8px 20px', border: '1px solid #1f6cb2', borderRadius: 4, background: '#1f6cb2', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                    下一頁
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
      </div>
    </div>
  )
}
