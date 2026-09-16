'use client'
// pilishuwu.com 书籍详情页 1:1 克隆 — wmcms-web .detail 模板
// 源站 DOM: wmcms-web .detail (左封面 + 右标题/作者/简介) + .vlist (章节)
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { navigate } = usePublic()
  if (!book) return null

  return (
    <div className="wmcms-web" style={{ minWidth: 1200, maxWidth: '100%', background: '#fff', color: '#666', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12, lineHeight: 1.5 }}>
      <div className="ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', padding: 16, boxSizing: 'border-box' }}>
        <div className="detail" style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 24, marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {/* 封面 */}
          <div className="cover" style={{ flex: '0 0 210px', width: 210, height: 280 }}>
            <BookCover name={book.name} cover={book.cover} className="w-full h-full" style={{ borderRadius: 2 }} />
          </div>
          {/* 主信息 */}
          <div className="info" style={{ flex: '1 1 480px', minWidth: 0, padding: '8px 0' }}>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: '#333', margin: '0 0 12px', lineHeight: 1.3 }}>
              {book.name}
            </h2>
            <div style={{ background: '#fafafa', border: '1px solid #eee', padding: '12px 16px', borderRadius: 4, marginBottom: 14 }}>
              <p style={{ margin: '4px 0', fontSize: 14, color: '#666' }}>
                <strong style={{ color: '#333', marginRight: 8 }}>作者：</strong>
                <a href="#" style={{ color: '#fa8729', textDecoration: 'none' }}>{book.author}</a>
              </p>
              <p style={{ margin: '4px 0', fontSize: 14, color: '#666' }}>
                <strong style={{ color: '#333', marginRight: 8 }}>分类：</strong>
                <span style={{ color: '#fa8729' }}>{book.category}</span>
              </p>
              <p style={{ margin: '4px 0', fontSize: 14, color: '#666' }}>
                <strong style={{ color: '#333', marginRight: 8 }}>状态：</strong>
                <span style={{ color: book.status === 'completed' ? '#999' : '#fa8729' }}>{statusLabel(book.status)}</span>
                <span style={{ color: '#999', marginLeft: 16 }}>字数：{formatWords(book.wordCount)}</span>
              </p>
              <p style={{ margin: '4px 0', fontSize: 14, color: '#666' }}>
                <strong style={{ color: '#333', marginRight: 8 }}>更新：</strong>{fmtDate(book.updatedAt) || '—'}
                <span style={{ color: '#999', marginLeft: 16 }}>最新章节：</span>
                <a href="#" style={{ color: '#fa8729', textDecoration: 'none' }}>{book.latestChapter || '暂无'}</a>
              </p>
              {book.keywords && (
                <p style={{ margin: '4px 0', fontSize: 13, color: '#999' }}>
                  <strong style={{ color: '#333', marginRight: 8 }}>关键词：</strong>{book.keywords}
                </p>
              )}
            </div>

            {/* 行动按钮 */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
              {firstChapterId && (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                  style={{ padding: '10px 28px', background: '#f1854b', color: '#fff', borderRadius: 4, fontSize: 15, fontWeight: 700, textDecoration: 'none' }}
                >
                  开始阅读
                </a>
              )}
              <button
                type="button"
                onClick={onScrollToc}
                style={{ padding: '10px 20px', background: '#fff', color: '#fa8729', border: '1px solid #f1854b', borderRadius: 4, fontSize: 14, cursor: 'pointer' }}
              >
                章节目录
              </button>
              <a
                href={`/api/public/download?book=${book.id}`}
                style={{ padding: '10px 20px', background: '#fff', color: '#666', border: '1px solid #dcd8d4', borderRadius: 4, fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                TXT 下载
              </a>
            </div>
          </div>
        </div>

        {/* 内容简介 */}
        <div className="intro" style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#333', margin: '0 0 12px', paddingBottom: 8, borderBottom: '2px solid #f1854b' }}>
            内容简介
          </h3>
          <p style={{ fontSize: 14, color: '#555', lineHeight: 1.8, textIndent: '2em', margin: 0 }}>
            {book.intro || '暂无简介'}
          </p>
        </div>

        {/* 章节列表入口 */}
        <div className="vlist" style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#333', margin: '0 0 12px', paddingBottom: 8, borderBottom: '2px solid #f1854b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>章节目录</span>
            <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#fa8729', cursor: 'pointer', fontSize: 13, padding: '4px 8px' }}>
              查看全部 →
            </button>
          </h3>
          <p style={{ textAlign: 'center', color: '#999', padding: '24px 0', margin: 0, fontSize: 13 }}>
            点击 <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#fa8729', cursor: 'pointer', fontSize: 13, padding: 0 }}>章节目录</button> 查看完整章节列表
          </p>
        </div>
      </div>
    </div>
  )
}
