'use client'
// ggd66 (格格党) 分类列表页 1:1 克隆 — static/simple 模板
// 源站 DOM: .container > .content(.content-left #gengxin h2 + ul > li .s1/.s2/.s3/.s4/.s5)
// 实测颜色: body bg #f9f9f9 / a #00886d / .header bg #1abc9c / .footer bg #56ccb5 / h2 border #ccc
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { site, navigate } = usePublic()

  if (loading) {
    return (
      <div style={{ background: '#f9f9f9', color: '#888', fontFamily: '"微软雅黑", Microsoft Yahei, simsun, arial, sans-serif', fontSize: 15, lineHeight: 1.5, minHeight: '100%' }}>
        <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto', padding: '40px 0', textAlign: 'center', background: '#fff' }}>
          加载中...
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div style={{ background: '#f9f9f9', color: '#888', fontFamily: '"微软雅黑", Microsoft Yahei, simsun, arial, sans-serif', fontSize: 15, lineHeight: 1.5, minHeight: '100%' }}>
        <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto', padding: '40px 0', textAlign: 'center', background: '#fff' }}>
          没有找到相关小说
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#f9f9f9', color: '#888', fontFamily: '"微软雅黑", Microsoft Yahei, simsun, arial, sans-serif', fontSize: 15, lineHeight: 1.5, minHeight: '100%' }}>
      {/* 源站 .header */}
      <div className="header" style={{ backgroundColor: '#1abc9c', marginBottom: 10, width: '100%', boxShadow: '0 1px 1px #1abc9c', lineHeight: '50px' }}>
        <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
          <div className="header-left" style={{ marginRight: 20, textAlign: 'left', textShadow: '1px 1px 2px #000', fontSize: 18, color: '#fff' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} title={site.name} className="logo" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700 }}>{site.name}</a>
          </div>
          <div className="header-right" style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 15, color: '#fff' }}>
            <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 4px' }}>阅读历史</a>
            <span style={{ opacity: 0.6 }}>|</span>
            <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 4px' }}>登录</a>
            <span style={{ opacity: 0.6 }}>|</span>
            <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 4px' }}>注册</a>
          </div>
          <div className="clear" style={{ clear: 'both' }} />
        </div>
      </div>

      <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto' }}>
        <div className="content" style={{ clear: 'both', margin: '10px 0' }}>
          <div className="content-left" style={{ float: 'left', width: '73%' }}>
            <h2 style={{ margin: 0, padding: '0 0 10px 12px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: 18, lineHeight: 2 }}>
              {label}小说列表
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, background: '#fff' }}>
              {books.map((b) => (
                <li key={b.id} style={{ padding: '8px 12px', borderBottom: '1px dashed #eee', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, lineHeight: 1.6, flexWrap: 'wrap' }}>
                  <span className="s1" style={{ width: 100, flexShrink: 0, color: '#888' }}>[{b.category}]</span>
                  <span className="s2" style={{ width: 200, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} target="_blank" style={{ color: '#00886d', textDecoration: 'none' }}>{b.name}</a>
                  </span>
                  <span className="s3" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.latestChapter ? (
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} target="_blank" style={{ color: '#888', textDecoration: 'none' }}>{b.latestChapter}</a>
                    ) : <span style={{ color: '#aaa' }}>暂无章节</span>}
                  </span>
                  <span className="s4" style={{ width: 90, flexShrink: 0, textAlign: 'right', color: '#888', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</span>
                  <span className="s5" style={{ width: 70, flexShrink: 0, textAlign: 'right', color: '#aaa', fontSize: 12 }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</span>
                </li>
              ))}
            </ul>

            {/* 分页 */}
            {total > size && (
              <div style={{ clear: 'both', textAlign: 'center', margin: '12px 5px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                {page > 1 && (
                  <button onClick={() => onPage(page - 1)} style={{ padding: '6px 16px', border: '1px solid #56ccb5', borderRadius: 4, background: '#fff', color: '#00886d', cursor: 'pointer', fontSize: 13 }}>
                    上一页
                  </button>
                )}
                <span style={{ padding: '6px 12px', color: '#888', fontSize: 13 }}>第 {page} 页 / 共 {Math.ceil(total / size)} 页</span>
                {page * size < total && (
                  <button onClick={() => onPage(page + 1)} style={{ padding: '6px 16px', border: '1px solid #56ccb5', borderRadius: 4, background: '#1abc9c', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                    下一页
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="clear" style={{ clear: 'both' }} />
        </div>
      </div>

      {/* 源站 .footer */}
      <div className="footer" style={{ padding: '10px 0', backgroundColor: '#56ccb5', boxShadow: '0 -1px 1px #56ccb5', color: '#fff', textAlign: 'center', fontSize: 14 }}>
        <p style={{ margin: 0, padding: 0, color: '#fff' }}>Copyright {new Date().getFullYear()} {site.name}({site.domain}) All Rights Reserved · 共 {formatWords(total)} 本</p>
        <div className="clear" style={{ clear: 'both' }} />
      </div>
    </div>
  )
}
