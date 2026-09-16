'use client'
// 101kks.com (101看書) 书籍详情页 1:1 克隆 — cdnshu 模板 (繁體)
// 源站 DOM: .main .bookinfo (.bookimg + .newnav) + #intro + .chapter-list
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { navigate } = usePublic()
  if (!book) return null

  return (
    <div style={{ background: '#f2f3f4', color: '#333', fontFamily: '"Microsoft YaHei", sans-serif', fontSize: 14, minHeight: '100%' }}>
      <div className="main">
        <div className="container" style={{ maxWidth: 1112, margin: '90px auto 16px', padding: '0 15px', boxSizing: 'border-box' }}>
          {/* 面包屑 */}
          <div className="breadcrumb" style={{ padding: '8px 0', marginBottom: 12, color: '#888', fontSize: 13 }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#1f6cb2', textDecoration: 'none' }}>首頁</a>
            <span style={{ margin: '0 6px' }}>&gt;</span>
            <span style={{ color: '#333' }}>{book.category}</span>
            <span style={{ margin: '0 6px' }}>&gt;</span>
            <span style={{ color: '#1f6cb2' }}>{book.name}</span>
          </div>

          <div className="mybox bookinfo" style={{ background: '#fff', borderRadius: 3, padding: 24, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* 封面 */}
            <div className="bookimg" style={{ flex: '0 0 180px', width: 180, height: 240 }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 4, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                <BookCover name={book.name} cover={book.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
              </div>
            </div>

            {/* 详情 */}
            <div className="newnav" style={{ flex: '1 1 480px', minWidth: 0, padding: '8px 0' }}>
              <h1 style={{ fontSize: 26, fontWeight: 700, color: '#333', margin: '0 0 16px', lineHeight: 1.3 }}>
                {book.name}
              </h1>
              <div className="labelbox" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, fontSize: 13, color: '#888' }}>
                <span style={{ background: 'rgba(31,108,178,0.1)', color: '#1f6cb2', padding: '3px 12px', borderRadius: 4, fontSize: 12 }}>
                  {book.category}
                </span>
                <span style={{ background: '#f5f5f5', color: '#333', padding: '3px 12px', borderRadius: 4, fontSize: 12 }}>
                  {statusLabel(book.status)}
                </span>
                <span style={{ background: 'transparent', border: '1px solid #ddd', color: '#888', padding: '2px 12px', borderRadius: 4, fontSize: 12 }}>
                  {formatWords(book.wordCount)}
                </span>
              </div>
              <div style={{ fontSize: 14, color: '#666', lineHeight: 2, marginBottom: 16 }}>
                <p style={{ margin: '4px 0' }}>
                  <strong style={{ color: '#333', marginRight: 8 }}>作者：</strong>
                  <a href="#" style={{ color: '#1f6cb2', textDecoration: 'none' }}>{book.author}</a>
                </p>
                <p style={{ margin: '4px 0' }}>
                  <strong style={{ color: '#333', marginRight: 8 }}>最新章節：</strong>
                  <span style={{ color: '#666' }}>{book.latestChapter || '暫無'}</span>
                </p>
                <p style={{ margin: '4px 0' }}>
                  <strong style={{ color: '#333', marginRight: 8 }}>更新於：</strong>
                  <span style={{ color: '#999' }}>{fmtDate(book.updatedAt) || '—'}</span>
                </p>
                {book.keywords && (
                  <p style={{ margin: '4px 0' }}>
                    <strong style={{ color: '#333', marginRight: 8 }}>關鍵詞：</strong>
                    <span style={{ color: '#999' }}>{book.keywords}</span>
                  </p>
                )}
              </div>

              {/* 行动按钮 */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {firstChapterId && (
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                    style={{ padding: '10px 28px', background: '#1f6cb2', color: '#fff', borderRadius: 4, fontSize: 15, fontWeight: 700, textDecoration: 'none' }}
                  >
                    開始閱讀
                  </a>
                )}
                <button
                  type="button"
                  onClick={onScrollToc}
                  style={{ padding: '10px 20px', background: '#fff', color: '#1f6cb2', border: '1px solid #1f6cb2', borderRadius: 4, fontSize: 14, cursor: 'pointer' }}
                >
                  章節目錄
                </button>
                <a
                  href={`/api/public/download?book=${book.id}`}
                  style={{ padding: '10px 20px', background: '#fff', color: '#e84118', border: '1px solid #e84118', borderRadius: 4, fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                >
                  TXT 下載
                </a>
              </div>
            </div>
          </div>

          {/* 内容简介 */}
          <div id="intro" className="mybox" style={{ background: '#fff', borderRadius: 3, padding: 24, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)' }}>
            <h3 className="mytitle" style={{ margin: '0 0 12px', borderBottom: '1px solid rgba(150,150,150,0.2)', paddingBottom: 5, fontSize: 16, color: '#333' }}>
              內容簡介
            </h3>
            <p className="ellipsis_2" style={{ fontSize: 14, color: '#555', lineHeight: 1.85, textIndent: '2em', margin: 0 }}>
              {book.intro || '暫無簡介'}
            </p>
          </div>

          {/* 章节列表入口 */}
          <div className="chapter-list mybox" style={{ background: '#fff', borderRadius: 3, padding: 24, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)' }}>
            <h3 className="mytitle" style={{ margin: '0 0 12px', borderBottom: '1px solid rgba(150,150,150,0.2)', paddingBottom: 5, fontSize: 16, color: '#333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>章節目錄</span>
              <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#1f6cb2', cursor: 'pointer', fontSize: 13, padding: '4px 8px' }}>
                查看全部 →
              </button>
            </h3>
            <p style={{ textAlign: 'center', color: '#999', padding: '24px 0', margin: 0, fontSize: 13 }}>
              點擊 <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#1f6cb2', cursor: 'pointer', fontSize: 13, padding: 0 }}>章節目錄</button> 查看完整章節列表
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
