// ============================================================
// clone-themes/23qb BookInfo — 铅笔小说书籍详情页 1:1 克隆
// 实测 mxstatic 模板: .book-info (.book-cover + .book-detail + .book-intro)
//   .novel-info-item (display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '-apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif'
const INK = '#282828'
const MUTED = '#888888'
const HOVER = '#ff2a14'
const BORDER = '#eaedf1'
const RADIUS = '5px'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <div className="book-info" style={{ fontFamily: FONT_STACK, color: INK, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: RADIUS, padding: '20px' }} data-clone-23qb-book>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div className="book-cover" style={{ flexShrink: 0 }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </div>
        <div className="book-detail" style={{ flex: 1, minWidth: 280 }}>
          <h1 className="novel-info-item" style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.name}</h1>
          <div className="novel-info-item" style={{ marginBottom: '6px', fontSize: '14px', color: MUTED }}>
            作者：<a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: INK, textDecoration: 'none' }}>{book.author}</a>
          </div>
          <div className="novel-info-item" style={{ marginBottom: '6px', fontSize: '14px', color: MUTED }}>
            分类：{book.categoryId ? (
              <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: HOVER, fontSize: '14px' }}>{book.category}</button>
            ) : <span style={{ color: HOVER }}>{book.category}</span>}
            <span style={{ marginLeft: '12px' }}><StatusBadge status={book.status} small /></span>
          </div>
          <div className="novel-info-item" style={{ marginBottom: '6px', fontSize: '14px', color: MUTED }}>
            字数：{formatWords(book.wordCount)} · 更新：{fmtDate(book.updatedAt) || '未知'}
          </div>
          <div className="novel-info-item" style={{ marginBottom: '6px', fontSize: '14px', color: MUTED }}>
            最新章节：<a href="javascript:;" onClick={onScrollToc} style={{ color: HOVER, textDecoration: 'none' }}>{book.latestChapter || '暂无'}</a>
          </div>
          <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
            {savedPos?.chapterId && (
              <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '8px 16px', border: `1px solid ${HOVER}`, color: HOVER, background: 'transparent', cursor: 'pointer', fontSize: '14px', borderRadius: RADIUS }}>
                继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
              </button>
            )}
            <button type="button" onClick={onScrollToc} style={{ padding: '8px 16px', border: `1px solid ${BORDER}`, color: INK, background: '#fff', cursor: 'pointer', fontSize: '14px', borderRadius: RADIUS }}>目录</button>
            <a href={`/api/public/download?book=${book.id}`} style={{ padding: '8px 16px', border: `1px solid ${HOVER}`, color: HOVER, background: 'transparent', textDecoration: 'none', fontSize: '14px', borderRadius: RADIUS }}>TXT 下载</a>
            <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
          </div>
        </div>
      </div>
      <div className="book-intro" style={{ marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${BORDER}`, fontSize: '14px', lineHeight: 1.8, color: INK }}>
        <h3 style={{ margin: '0 0 10px', fontSize: '16px', fontWeight: 700 }}>内容简介</h3>
        <p style={{ margin: 0, textIndent: '2em', whiteSpace: 'pre-wrap' }}>{book.intro || '暂无简介'}</p>
      </div>
    </div>
  )
}
