<<<<<<< HEAD
// ============================================================
// clone-themes/pilishuwu CategoryList — 霹雳书屋分类页 1:1 克隆
// 实测 probe-html2/probe-pilishuwu-category.html (wmcms-web 模板):
//   .sort .warp .sub_sort_title (h1 + 筛选)
//   .bk-list (左封面 + 右书名/作者/简介)
//   .page 分页
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif'
const INK = '#333333'
const MUTED = '#888888'
const PRIMARY = '#fd8929'
const BORDER = '#ffe4c4'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }}>
      <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: '2px', padding: '14px', marginBottom: '14px' }}>
        <h1 style={{ margin: '0 0 10px', fontSize: '22px', fontWeight: 700, color: INK }}>{label}</h1>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['全部', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生'].map((n, i) => (
            <a key={n} href="javascript:;" style={{ padding: '4px 10px', fontSize: '13px', border: `1px solid ${BORDER}`, borderRadius: '2px', background: i === 0 ? PRIMARY : '#fff', color: i === 0 ? '#fff' : INK, textDecoration: 'none' }}>{n}</a>
          ))}
        </div>
      </div>
      <div className="bk-list">
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>加载中...</div>
        ) : !books.length ? (
          <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>没有找到相关书籍</div>
        ) : (
          books.map((b) => (
            <div key={b.id} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: '2px', padding: '12px', marginBottom: '10px', display: 'flex', gap: '12px' }}>
              <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ flexShrink: 0 }}>
                <BookCover name={b.name} cover={b.cover} className="book-cover" />
              </a>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }}>
                  <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: INK, textDecoration: 'none' }}>{b.name}</a>
                </h3>
                <p style={{ margin: '2px 0', fontSize: '12px', color: MUTED }}>{b.author} · {b.category} · {formatWords(b.wordCount)} · <StatusBadge status={b.status} small /></p>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: MUTED, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.intro}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '12px 0' }}>
        {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', fontSize: '13px' }}>上一页</a>}
        <span style={{ padding: '4px 12px', background: PRIMARY, color: '#fff' }}>{page}</span>
        <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', fontSize: '13px' }}>下一页</a>
        <span style={{ padding: '4px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
=======
'use client'
// pilishuwu.com 分类列表页 1:1 克隆 — wmcms-web 模板
// 源站 DOM: .ui-wm > .novelslist (table.grid) + 分页
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()

  if (loading) {
    return (
      <div className="ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', padding: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 40, textAlign: 'center', color: '#999' }}>
          加载中...
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div className="ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', padding: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 40, textAlign: 'center', color: '#999' }}>
          没有找到相关小说
        </div>
      </div>
    )
  }

  return (
    <div className="ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', padding: 16, fontFamily: '"宋体", Arial, sans-serif', fontSize: 12, color: '#666' }}>
      {/* 面包屑 */}
      <div className="breadcrumb" style={{ padding: '8px 0', marginBottom: 12, color: '#999' }}>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fa8729', textDecoration: 'none' }}>首页</a>
        <span style={{ margin: '0 6px' }}>&gt;</span>
        <span style={{ color: '#333' }}>{label}</span>
      </div>

      <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#333', margin: '0 0 12px', paddingBottom: 8, borderBottom: '2px solid #f1854b' }}>
          {label}小说列表
        </h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafafa', color: '#666' }}>
              <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400, width: 80 }}>类别</th>
              <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>书名</th>
              <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>最新章节</th>
              <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400, width: 100 }}>作者</th>
              <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400, width: 80 }}>字数</th>
              <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400, width: 80 }}>更新</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id} style={{ borderTop: '1px dashed #eee' }}>
                <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#fa8729', fontSize: 12 }}>[{b.category}]</span>
                </td>
                <td style={{ padding: '8px 6px' }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#333', textDecoration: 'none', fontWeight: 700 }}>
                    {b.name}
                  </a>
                </td>
                <td style={{ padding: '8px 6px', color: '#999', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.latestChapter || '—'}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.author}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{formatWords(b.wordCount)}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > size && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 12, borderTop: '1px dashed #eee' }}>
            {page > 1 && (
              <button onClick={() => onPage(page - 1)} style={{ padding: '6px 18px', border: '1px solid #f1854b', borderRadius: 4, background: '#fff', color: '#fa8729', cursor: 'pointer', fontSize: 13 }}>
                上一页
              </button>
            )}
            <span style={{ color: '#999', fontSize: 13 }}>第 {page} 页 / 共 {Math.ceil(total / size)} 页</span>
            {page * size < total && (
              <button onClick={() => onPage(page + 1)} style={{ padding: '6px 18px', border: '1px solid #f1854b', borderRadius: 4, background: '#f1854b', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                下一页
              </button>
            )}
          </div>
        )}
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
      </div>
    </div>
  )
}
