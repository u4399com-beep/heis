'use client'
// ggd66 (格格党) 书籍详情页 1:1 克隆 — static/simple 模板
// 源站 DOM: .container > .content(.content-left #fengtui h2 + .item .image + dl) + .content-right (排行)
// 实测颜色: body bg #f9f9f9 / a #00886d / h2 border #ccc / .header bg #1abc9c / .footer bg #56ccb5
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { site, navigate } = usePublic()
  if (!book) return null

  return (
    <div style={{ background: '#f9f9f9', color: '#888', fontFamily: '"微软雅黑", Microsoft Yahei, simsun, arial, sans-serif', fontSize: 15, lineHeight: 1.5, minHeight: '100%' }}>
      {/* 源站 .header */}
      <div className="header" style={{ backgroundColor: '#1abc9c', marginBottom: 10, width: '100%', boxShadow: '0 1px 1px #1abc9c', lineHeight: '50px' }}>
        <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
          <div className="header-left" style={{ float: 'left', marginRight: 20, textAlign: 'left', textShadow: '1px 1px 2px #000', fontSize: 18, color: '#fff' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} title={site.name} className="logo" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700 }}>{site.name}</a>
          </div>
          <div className="header-right" style={{ float: 'right', textAlign: 'right', fontSize: 15, marginLeft: 'auto', color: '#fff' }}>
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
        {/* 源站 .content — 单栏, .content-left 73% */}
        <div className="content" style={{ clear: 'both', margin: '10px 0' }}>
          <div className="content-left" style={{ float: 'left', width: '73%' }}>
            <h2 style={{ margin: 0, padding: '0 0 10px 12px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: 18, lineHeight: 2 }}>
              {book.name} - {book.author}
            </h2>
            <div className="item" style={{ display: 'flex', gap: 16, padding: '12px', background: '#fff' }}>
              <div className="image" style={{ flexShrink: 0, width: 120, height: 150, border: '1px solid #eee', background: '#fff' }}>
                <BookCover name={book.name} cover={book.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
              </div>
              <dl style={{ flex: 1, minWidth: 0, margin: 0 }}>
                <dt style={{ marginBottom: 8, fontSize: 16 }}>
                  <span style={{ color: '#888', marginRight: 8 }}>作者：{book.author}</span>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: '#00886d', textDecoration: 'none', fontSize: 18, fontWeight: 700 }}>{book.name}</a>
                </dt>
                <dd style={{ margin: 0, color: '#888', lineHeight: 1.8, fontSize: 14 }}>
                  <p style={{ margin: '4px 0' }}>
                    <strong style={{ color: '#333' }}>类别：</strong>
                    <span style={{ color: '#00886d' }}>{book.category}</span>
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    <strong style={{ color: '#333' }}>状态：</strong>
                    <span style={{ color: book.status === 'completed' ? '#888' : '#f50' }}>{statusLabel(book.status)}</span>
                    <span style={{ color: '#888', marginLeft: 12 }}>字数：{formatWords(book.wordCount)}</span>
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    <strong style={{ color: '#333' }}>更新：</strong>
                    <span style={{ color: '#888' }}>{fmtDate(book.updatedAt) || '—'}</span>
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    <strong style={{ color: '#333' }}>最新章节：</strong>
                    <span style={{ color: '#888' }}>{book.latestChapter || '暂无'}</span>
                  </p>

                  {/* 行动按钮 */}
                  <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {firstChapterId && (
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                        style={{ display: 'inline-block', padding: '8px 24px', background: '#1abc9c', color: '#fff', borderRadius: 4, fontSize: 15, fontWeight: 700, textDecoration: 'none' }}
                      >
                        开始阅读
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={onScrollToc}
                      style={{ padding: '8px 20px', background: '#fff', color: '#00886d', border: '1px solid #56ccb5', borderRadius: 4, fontSize: 15, cursor: 'pointer' }}
                    >
                      章节目录
                    </button>
                    <a
                      href={`/api/public/download?book=${book.id}`}
                      style={{ padding: '8px 20px', background: '#fff', color: '#f50', border: '1px solid #fda85a', borderRadius: 4, fontSize: 15, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                    >
                      TXT 下载
                    </a>
                  </div>
                </dd>
              </dl>
              <div className="clear" style={{ clear: 'both' }} />
            </div>

            {/* 内容简介 */}
            <div className="intro" style={{ margin: '12px 0', padding: '12px', background: '#fff', borderTop: '2px solid #1abc9c' }}>
              <strong style={{ color: '#333', fontSize: 16 }}>内容简介：</strong>
              <p style={{ margin: '8px 0 0', color: '#888', fontSize: 14, lineHeight: 1.8, textIndent: '2em' }}>
                {book.intro || '暂无简介'}
              </p>
            </div>

            {/* 章节目录入口 */}
            <div style={{ padding: '12px', background: '#fff', borderTop: '1px solid #eee' }}>
              <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#00886d', cursor: 'pointer', fontSize: 15, padding: '8px 16px' }}>
                查看完整章节列表 →
              </button>
            </div>
          </div>
          <div className="clear" style={{ clear: 'both' }} />
        </div>
      </div>

      {/* 源站 .footer */}
      <div className="footer" style={{ padding: '10px 0', backgroundColor: '#56ccb5', boxShadow: '0 -1px 1px #56ccb5', color: '#fff', textAlign: 'center', fontSize: 14 }}>
        <p style={{ margin: 0, padding: 0, color: '#fff' }}>本站所有小说为转载作品，转载至本站只是为了让更多读者欣赏。</p>
        <p style={{ margin: '4px 0 0', padding: 0, color: '#fff' }}>Copyright {new Date().getFullYear()} {site.name}({site.domain}) All Rights Reserved</p>
        <div className="clear" style={{ clear: 'both' }} />
      </div>
    </div>
  )
}
