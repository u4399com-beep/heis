'use client'
// aijjxs.com 书籍详情页 1:1 克隆
import type { BookInfoProps } from '../shared'
export function BookInfo({ book }: BookInfoProps) {
  if (!book) return null
  return (
    <div className="wrap" style={{ maxWidth: 1220, margin: '0 auto', padding: '18px 14px 36px' }}>
      <article className="panel" style={{ background: 'rgba(255,253,248,.9)', border: '1px solid #e5dccd', borderRadius: 14, padding: 24 }}>
        <h3 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', margin: '0 0 16px' }}>《{book.name}》</h3>
        <div className="kv" style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
          <div className="pic" style={{ width: 120, height: 160, overflow: 'hidden', borderRadius: 8, border: '1px solid #e5dccd' }}>
            {book.cover && <img src={book.cover} alt={book.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
          <div style={{ flex: 1, fontSize: 14, color: '#1f2937', lineHeight: 2 }}>
            <p><strong>书籍作者：</strong>{book.author}</p>
            <p><strong>书籍分类：</strong><span style={{ color: '#b45309' }}>{book.category}</span></p>
            <p><strong>写作进度：</strong>{book.status === 'completed' ? '已完结' : book.status === 'ongoing' ? '连载中' : '未知'}</p>
            <p><strong>字数：</strong>{(book.wordCount / 10000).toFixed(1)}万字</p>
            <p><strong>最新章节：</strong>{book.latestChapter || '暂无'}</p>
          </div>
        </div>
        <div className="desc" style={{ padding: '12px 0', borderTop: '1px dashed #e5dccd', fontSize: 14, color: '#6b7280', lineHeight: 1.8 }}>
          <strong style={{ color: '#1f2937' }}>内容简介：</strong><br />
          {book.intro || '暂无简介'}
        </div>
      </article>
    </div>
  )
}
