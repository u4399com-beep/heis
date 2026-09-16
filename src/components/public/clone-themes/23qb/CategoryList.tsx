<<<<<<< HEAD
// ============================================================
// clone-themes/23qb CategoryList — 铅笔小说分类页 1:1 克隆
// 实测 mxstatic 模板: 网格封面卡
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '-apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif'
const INK = '#282828'
const MUTED = '#888888'
const HOVER = '#ff2a14'
const BORDER = '#eaedf1'
const RADIUS = '5px'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: INK, margin: '0 0 14px' }}>{label}</h1>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {['全部', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生'].map((n, i) => (
          <a key={n} href="javascript:;" style={{ padding: '4px 12px', fontSize: '13px', border: `1px solid ${BORDER}`, borderRadius: RADIUS, background: i === 0 ? HOVER : '#fff', color: i === 0 ? '#fff' : INK, textDecoration: 'none' }}>{n}</a>
        ))}
      </div>
      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>加载中...</div>
      ) : !books.length ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>没有找到相关书籍</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '20px' }}>
          {books.map((b) => (
            <div key={b.id} className="module-item" style={{ width: '100%' }}>
              <div className="module-item-cover" style={{ position: 'relative', paddingTop: '140%', borderRadius: RADIUS, overflow: 'hidden', background: '#eee' }}>
                <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} title={b.name} style={{ position: 'absolute', inset: 0 }}>
                  <BookCover name={b.name} cover={b.cover} className="book-cover" />
                </a>
              </div>
              <div className="module-item-titlebox" style={{ marginTop: '6px' }}>
                <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} title={b.name} style={{ color: INK, textDecoration: 'none', fontSize: '14px', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</a>
                <div style={{ fontSize: '12px', color: MUTED, marginTop: '2px' }}>{b.author} · {formatWords(b.wordCount)} · <StatusBadge status={b.status} small /></div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '20px 0' }}>
        {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', borderRadius: RADIUS }}>上一页</a>}
        <span style={{ padding: '4px 12px', background: HOVER, color: '#fff', borderRadius: RADIUS }}>{page}</span>
        <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', borderRadius: RADIUS }}>下一页</a>
        <span style={{ padding: '4px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
=======
'use client'
// 23qb.net (铅笔小说) 分类列表页 1:1 克隆 — mxstatic 模板
// 源站 DOM: .wrapper > .content > .box.module (table)
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()

  if (loading) {
    return (
      <div className="page" style={{ background: '#f8f9f9', padding: '80px 15px 24px' }}>
        <div className="wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 40, textAlign: 'center', color: '#999' }}>加载中...</div>
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div className="page" style={{ background: '#f8f9f9', padding: '80px 15px 24px' }}>
        <div className="wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 40, textAlign: 'center', color: '#999' }}>没有找到相关小说</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ background: '#f8f9f9', color: '#282828', fontFamily: '-apple-system-font, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif', fontSize: 14, minHeight: '100%' }}>
      <div className="wrapper" style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 15px 24px', boxSizing: 'border-box' }}>
        {/* 面包屑 */}
        <div className="breadcrumb" style={{ padding: '8px 0', marginBottom: 12, color: '#999', fontSize: 13 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#282828', textDecoration: 'none' }}>首页</a>
          <span style={{ margin: '0 6px' }}>&gt;</span>
          <span style={{ color: '#ff2a14' }}>{label}</span>
        </div>

        <div className="content">
          <div className="box module" style={{ background: '#fff', borderRadius: 8, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #f3f5f7' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#282828', margin: 0, padding: '0 0 0 12px', borderLeft: '4px solid #ff2a14' }}>
                {label}小说列表
              </h2>
              <span style={{ color: '#999', fontSize: 13 }}>共 {total} 本</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9f9', color: '#666' }}>
                  <th style={{ padding: '10px 6px', textAlign: 'left', fontWeight: 400, fontSize: 13 }}>类别</th>
                  <th style={{ padding: '10px 6px', textAlign: 'left', fontWeight: 400, fontSize: 13 }}>书名</th>
                  <th style={{ padding: '10px 6px', textAlign: 'left', fontWeight: 400, fontSize: 13 }}>最新章节</th>
                  <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 400, fontSize: 13 }}>作者</th>
                  <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 400, fontSize: 13 }}>字数</th>
                  <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 400, fontSize: 13 }}>更新</th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.id} style={{ borderTop: '1px solid #f3f5f7' }}>
                    <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#ff2a14', fontSize: 12, background: 'rgba(255,42,20,0.08)', padding: '2px 8px', borderRadius: 4 }}>{b.category}</span>
                    </td>
                    <td style={{ padding: '10px 6px' }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#282828', textDecoration: 'none', fontWeight: 500 }}>
                        {b.name}
                      </a>
                    </td>
                    <td style={{ padding: '10px 6px', color: '#999', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.latestChapter || '—'}
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.author}</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{formatWords(b.wordCount)}</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {total > size && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 12, borderTop: '1px solid #f3f5f7' }}>
                {page > 1 && (
                  <button onClick={() => onPage(page - 1)} style={{ padding: '8px 24px', border: '1px solid #eaecef', borderRadius: 22, background: '#fff', color: '#282828', cursor: 'pointer', fontSize: 13 }}>
                    上一页
                  </button>
                )}
                <span style={{ color: '#999', fontSize: 13 }}>第 {page} 页 / 共 {Math.ceil(total / size)} 页</span>
                {page * size < total && (
                  <button onClick={() => onPage(page + 1)} style={{ padding: '8px 24px', border: 'none', borderRadius: 22, background: 'linear-gradient(90deg, #ff9800, #ff2a14)', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                    下一页
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
