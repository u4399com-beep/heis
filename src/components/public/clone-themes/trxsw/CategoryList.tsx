// ============================================================
// clone-themes/trxsw CategoryList — 天人小说分类页 1:1 克隆
// 域名已过期但规则保留, 反推 DOM: .sort 筛选条 + .vlist 列表 + .pager 分页
// 硬编码源站实际 CSS 变量值 (themes.ts vars):
//   bg #f5f7fa / surface #fff / text #333 / textMuted #888
//   primary #2c7be5 (深蓝) / accent #1a5fb4 / border #e0e6ed / radius 4px
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '"Microsoft YaHei", Arial, sans-serif'
const BG = '#f5f7fa'
const SURFACE = '#ffffff'
const INK = '#333333'
const MUTED = '#888888'
const PRIMARY = '#2c7be5'
const PRIMARY_TEXT = '#ffffff'
const BORDER = '#e0e6ed'
const RADIUS = '4px'
const SHADOW = '0 1px 3px rgba(0,0,0,0.05)'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, background: BG, minHeight: '100vh', padding: '14px' }}>
      <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
        {/* 面包屑 */}
        <div style={{ fontSize: '12px', color: MUTED, marginBottom: '10px' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: PRIMARY, textDecoration: 'none' }}>首页</a>
          <span style={{ margin: '0 6px' }}>&gt;</span>
          <span style={{ color: INK }}>{label}</span>
        </div>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: INK, margin: '0 0 14px' }}>{label}</h1>
        {/* 筛选条 */}
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: RADIUS, padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['全部', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生'].map((n, i) => (
            <a key={n} href="javascript:;" style={{ padding: '4px 12px', fontSize: '13px', border: `1px solid ${BORDER}`, background: i === 0 ? PRIMARY : SURFACE, color: i === 0 ? PRIMARY_TEXT : INK, textDecoration: 'none', fontWeight: i === 0 ? 700 : 400, borderRadius: RADIUS }}>{n}</a>
          ))}
        </div>
        {/* 书籍列表 */}
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: MUTED, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: RADIUS }}>加载中...</div>
        ) : !books.length ? (
          <div style={{ padding: '40px', textAlign: 'center', color: MUTED, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: RADIUS }}>没有找到相关书籍</div>
        ) : (
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '12px' }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
              {books.map((b) => (
                <li key={b.id} style={{ display: 'flex', gap: '10px', padding: '10px', borderBottom: `1px dashed ${BORDER}` }}>
                  <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ flexShrink: 0 }}>
                    <BookCover name={b.name} cover={b.cover} className="book-cover" />
                  </a>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: INK, textDecoration: 'none', fontSize: '14px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>{b.name}</a>
                    <div style={{ fontSize: '12px', color: MUTED, marginBottom: '4px' }}>{b.author}</div>
                    <div style={{ fontSize: '12px', color: MUTED, marginBottom: '4px' }}>{b.category} · <StatusBadge status={b.status} small /> · {formatWords(b.wordCount)}</div>
                    <p style={{ margin: 0, fontSize: '12px', color: MUTED, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.intro}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* 分页 */}
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center', padding: '20px 0' }}>
          {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, background: SURFACE, color: INK, textDecoration: 'none', borderRadius: RADIUS }}>上一页</a>}
          <span style={{ padding: '6px 14px', background: PRIMARY, color: PRIMARY_TEXT, borderRadius: RADIUS }}>{page}</span>
          <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, background: SURFACE, color: INK, textDecoration: 'none', borderRadius: RADIUS }}>下一页</a>
          <span style={{ padding: '4px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
        </div>
      </div>
    </div>
  )
}
