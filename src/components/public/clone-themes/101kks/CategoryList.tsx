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
      </div>
    </div>
  )
}
