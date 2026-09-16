// ============================================================
// clone-themes/huangjinwu CategoryList — 黄金屋分类页 1:1 克隆
// 实测 huangjinwu default 模板: .book-grid .book-card 列表
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
const INK = '#1e293b'
const MUTED = '#64748b'
const PRIMARY = '#2563eb'
const BORDER = '#dbe4f0'
const CARD_BG = '#fff'
const HOVER_BG = '#e8f1ff'
const RADIUS = '6px'
const RADIUS_LG = '10px'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }}>
      <h1 className="page-title" style={{ fontSize: '20px', fontWeight: 700, color: INK, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: PRIMARY }}>📁</span>{label}
      </h1>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {['全部', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生'].map((n, i) => (
          <a key={n} href="javascript:;" style={{ color: i === 0 ? '#fff' : INK, padding: '6px 14px', borderRadius: RADIUS_LG, fontSize: '14px', textDecoration: 'none', background: i === 0 ? PRIMARY : HOVER_BG }}>{n}</a>
        ))}
      </div>
      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>加载中...</div>
      ) : !books.length ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>没有找到相关书籍</div>
      ) : (
        <div className="book-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
          {books.map((b) => (
            <a key={b.id} href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} title={b.name} className="book-card" style={{ display: 'flex', gap: '12px', padding: '14px', borderRadius: RADIUS_LG, background: CARD_BG, border: `1px solid ${BORDER}`, textDecoration: 'none', color: INK }}>
              <div style={{ flexShrink: 0 }}>
                <BookCover name={b.name} cover={b.cover} className="book-cover" />
              </div>
              <div className="book-info" style={{ flex: 1, minWidth: 0 }}>
                <div className="book-title" style={{ fontSize: '16px', fontWeight: 600, color: INK, marginBottom: '4px' }}>{b.name}</div>
                <div className="book-author" style={{ fontSize: '13px', color: MUTED, marginBottom: '6px' }}>作者：{b.author} · <StatusBadge status={b.status} small /></div>
                <div className="book-desc" style={{ fontSize: '13px', color: MUTED, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: '8px' }}>{b.intro}</div>
                <div className="book-badges" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ background: HOVER_BG, color: PRIMARY, padding: '2px 8px', borderRadius: RADIUS, fontSize: '12px' }}>{b.category}</span>
                  <span style={{ background: '#f1f5f9', color: MUTED, padding: '2px 8px', borderRadius: RADIUS, fontSize: '12px' }}>{formatWords(b.wordCount)}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '20px 0' }}>
        {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, background: CARD_BG, color: INK, textDecoration: 'none', borderRadius: RADIUS }}>上一页</a>}
        <span style={{ padding: '6px 14px', background: PRIMARY, color: '#fff', borderRadius: RADIUS }}>{page}</span>
        <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, background: CARD_BG, color: INK, textDecoration: 'none', borderRadius: RADIUS }}>下一页</a>
        <span style={{ padding: '6px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
      </div>
    </div>
  )
}
