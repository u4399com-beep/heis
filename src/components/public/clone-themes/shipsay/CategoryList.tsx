// ============================================================
// clone-themes/shipsay CategoryList — 船说CMS分类页 1:1 克隆
// 实测 shipsay.css: .sortvisit (312px) 列表
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", Arial, Tahoma, Verdana, sans-serif'
const INK = '#666666'
const MUTED = '#969ba3'
const LINK = '#1a1a1a'
const PRIMARY = '#ed4259'
const CARD_BG = '#ffffff'
const BORDER = '#e0e0e0'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: LINK, margin: '0 0 14px' }}>{label}</h1>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {['全部', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生'].map((n, i) => (
          <a key={n} href="javascript:;" style={{ padding: '4px 12px', fontSize: '13px', border: `1px solid ${BORDER}`, background: i === 0 ? PRIMARY : CARD_BG, textDecoration: 'none', fontWeight: i === 0 ? 700 : 400, color: i === 0 ? '#fff' : LINK }}>{n}</a>
        ))}
      </div>
      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>加载中...</div>
      ) : !books.length ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>没有找到相关书籍</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: '12px' }}>
          {books.map((b) => (
            <div key={b.id} className="sortvisit" style={{ background: CARD_BG, padding: '10px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ flexShrink: 0 }}>
                  <BookCover name={b.name} cover={b.cover} className="book-cover" />
                </a>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: LINK, textDecoration: 'none', fontSize: '14px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>{b.name}</a>
                  <div style={{ fontSize: '12px', color: MUTED, marginBottom: '4px' }}>{b.author}</div>
                  <div style={{ fontSize: '12px', color: MUTED, marginBottom: '4px' }}>{b.category} · <StatusBadge status={b.status} small /> · {formatWords(b.wordCount)}</div>
                  <p style={{ margin: 0, fontSize: '12px', color: MUTED, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.intro}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '20px 0' }}>
        {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: CARD_BG, color: LINK, textDecoration: 'none' }}>上一页</a>}
        <span style={{ padding: '4px 12px', background: PRIMARY, color: '#fff' }}>{page}</span>
        <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: CARD_BG, color: LINK, textDecoration: 'none' }}>下一页</a>
        <span style={{ padding: '4px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
      </div>
    </div>
  )
}
