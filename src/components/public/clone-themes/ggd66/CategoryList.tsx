// ============================================================
// clone-themes/ggd66 CategoryList — 格格党分类页 1:1 克隆
// 实测 simple 模板: .item 推荐卡 grid
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", simsun, arial, sans-serif'
const INK = '#333333'
const MUTED = '#888888'
const LINK = '#00886d'
const BREADCRUMB_BG = '#cdf3eb'
const BORDER = '#cccccc'
const RADIUS = '4px'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }}>
      <div className="breadcrumb" style={{ overflow: 'hidden', margin: '0 0 10px', padding: '8px 15px', border: '1px solid #ccc', borderRadius: RADIUS, backgroundColor: BREADCRUMB_BG, listStyle: 'none', fontSize: '14px' }}>
        <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ color: LINK, textDecoration: 'none' }}>首页</a>
        {' > '}
        <span style={{ color: INK }}>{label}</span>
      </div>
      <h2 style={{ marginTop: '10px', padding: '0 0 10px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: '18px' }}>{label}</h2>
      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>加载中...</div>
      ) : !books.length ? (
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>没有找到相关书籍</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '14px' }}>
          {books.map((b) => (
            <div key={b.id} className="item" style={{ display: 'flex', gap: '10px', padding: '10px 0 0', borderBottom: `1px dashed ${BORDER}` }}>
              <div className="image" style={{ float: 'left', marginRight: '10px', width: '90px', flexShrink: 0 }}>
                <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}>
                  <BookCover name={b.name} cover={b.cover} className="book-cover" />
                </a>
              </div>
              <dl style={{ margin: 0, flex: 1, minWidth: 0 }}>
                <dt style={{ overflow: 'hidden', height: '25px', borderBottom: '1px dotted #ccc', fontWeight: 700, fontSize: '15px', lineHeight: '25px' }}>
                  <span style={{ float: 'right', fontWeight: 400, fontSize: '14px', color: MUTED }}>{b.author}</span>
                  <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: LINK, textDecoration: 'none' }}>{b.name}</a>
                </dt>
                <dd style={{ overflow: 'hidden', padding: '7px 0 0', height: '60px', textIndent: '2em', fontSize: '13px', lineHeight: '20px', color: MUTED, margin: 0 }}>
                  {b.intro}
                </dd>
                <dd style={{ margin: '4px 0 0', fontSize: '12px', color: MUTED }}>{b.category} · {formatWords(b.wordCount)} · <StatusBadge status={b.status} small /></dd>
              </dl>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '20px 0' }}>
        {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', borderRadius: RADIUS }}>上一页</a>}
        <span style={{ padding: '4px 12px', background: LINK, color: '#fff', borderRadius: RADIUS }}>{page}</span>
        <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', borderRadius: RADIUS }}>下一页</a>
        <span style={{ padding: '4px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
      </div>
    </div>
  )
}
