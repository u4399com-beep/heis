<<<<<<< HEAD
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
=======
'use client'
// trxsw (同人小说网, 域名已过期) 分类列表页 1:1 克隆 — 现代简洁模板
// 源站 DOM 反查: .headline (标签标题) + .vlist (书籍列表 li) + .pager (翻页)
// 实测颜色: --bg #f5f7fa / --surface #fff / --primary #2c7be5 / --border #e0e6ed / --radius 4px
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { site, navigate } = usePublic()

  if (loading) {
    return (
      <div style={{ background: '#f5f7fa', color: '#333', fontFamily: '"Microsoft YaHei", Arial, sans-serif', fontSize: 14, lineHeight: 1.6, minHeight: '100%' }}>
        <div className="container" style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 16px', textAlign: 'center', background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4 }}>
          加载中...
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div style={{ background: '#f5f7fa', color: '#333', fontFamily: '"Microsoft YaHei", Arial, sans-serif', fontSize: 14, lineHeight: 1.6, minHeight: '100%' }}>
        <div className="container" style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 16px', textAlign: 'center', background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4 }}>
          没有找到相关小说
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#f5f7fa', color: '#333', fontFamily: '"Microsoft YaHei", Arial, sans-serif', fontSize: 14, lineHeight: 1.6, minHeight: '100%' }}>
      {/* 源站 .header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e0e6ed' }}>
        <div className="container" style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} className="logo" style={{ fontSize: 22, fontWeight: 700, color: '#2c7be5', textDecoration: 'none' }}>
            {site.name}
          </a>
          <nav style={{ flex: 1, display: 'flex', gap: 4, minWidth: 200, flexWrap: 'wrap' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ padding: '6px 12px', color: '#fff', background: '#2c7be5', borderRadius: 4, textDecoration: 'none', fontSize: 14 }}>首页</a>
            <a href="#" style={{ padding: '6px 12px', color: '#333', textDecoration: 'none', fontSize: 14 }}>书库</a>
            <a href="#" style={{ padding: '6px 12px', color: '#333', textDecoration: 'none', fontSize: 14 }}>排行</a>
          </nav>
        </div>
      </header>

      <div className="container" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px' }}>
        {/* 面包屑 */}
        <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2c7be5', textDecoration: 'none' }}>首页</a>
          <span style={{ margin: '0 6px' }}>/</span>
          <span>{label}</span>
        </div>

        {/* .headline 分类标题 */}
        <h1 className="headline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 18, fontWeight: 700, color: '#333', margin: '0 0 16px', padding: '0 0 8px', borderBottom: '2px solid #2c7be5' }}>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ display: 'inline-block', width: 4, height: 18, background: '#2c7be5', marginRight: 8, borderRadius: 2 }} />
            {label}小说列表
          </span>
          <span style={{ fontSize: 12, fontWeight: 400, color: '#888' }}>共 {total} 本</span>
        </h1>

        {/* .vlist 书籍列表 */}
        <div style={{ background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4 }}>
          <ul className="vlist" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {books.map((b) => (
              <li key={b.id} style={{ padding: '8px 12px', borderBottom: '1px solid #e0e6ed', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ color: '#2c7be5', fontSize: 11, background: '#e8f1ff', padding: '1px 6px', borderRadius: 2, flexShrink: 0 }}>{b.category}</span>
                <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#333', textDecoration: 'none', flexShrink: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                  {b.name}
                </a>
                <span style={{ color: '#888', fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.latestChapter || '暂无章节'}
                </span>
                <span style={{ color: '#888', fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}>{b.author}</span>
                <span style={{ color: '#888', fontSize: 11, flexShrink: 0 }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* .pager 分页 */}
        {total > size && (
          <div className="pager" style={{ display: 'flex', gap: 10, justifyContent: 'center', padding: 20 }}>
            {page > 1 && (
              <a href="#" onClick={(e) => { e.preventDefault(); onPage(page - 1) }} style={{ padding: '6px 16px', border: '1px solid #e0e6ed', borderRadius: 4, textDecoration: 'none', color: '#333', background: '#fff', cursor: 'pointer' }}>
                上一页
              </a>
            )}
            <span style={{ padding: '6px 16px', border: '1px solid #2c7be5', borderRadius: 4, background: '#2c7be5', color: '#fff', fontWeight: 600 }}>{page}</span>
            <span style={{ padding: '6px 12px', color: '#888' }}>共 {Math.ceil(total / size)} 页</span>
            {page * size < total && (
              <a href="#" onClick={(e) => { e.preventDefault(); onPage(page + 1) }} style={{ padding: '6px 16px', border: '1px solid #e0e6ed', borderRadius: 4, textDecoration: 'none', color: '#333', background: '#fff', cursor: 'pointer' }}>
                下一页
              </a>
            )}
          </div>
        )}
      </div>

      {/* 源站 .footer */}
      <footer style={{ background: '#fff', borderTop: '1px solid #e0e6ed', padding: '20px 16px', textAlign: 'center', color: '#888', fontSize: 12, marginTop: 24 }}>
        <p style={{ margin: 0 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2c7be5', textDecoration: 'none' }}>{site.name}</a>
          &nbsp;·&nbsp;Copyright © {new Date().getFullYear()} {site.name}({site.domain}) · 共 {formatWords(total)} 本
        </p>
      </footer>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
    </div>
  )
}
