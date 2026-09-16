// ============================================================
// clone-themes/101kks BookInfo — 101看書书籍详情页 1:1 克隆
// 实测 probe-html2/probe-101kks-book.html (cdnshu 模板):
//   .main .bookinfo (.bookimg + .newnav) + #intro + .chapter-list
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif'
const INK = '#333333'
const MUTED = '#7f8c8d'
const PRIMARY = '#667eea'
const ACCENT = '#764ba2'
const BORDER = 'rgba(0,0,0,0.08)'
const RADIUS = '10px'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <div className="main" style={{ fontFamily: FONT_STACK, color: INK, background: '#fff', borderRadius: RADIUS, padding: '20px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', border: `1px solid ${BORDER}` }} data-clone-101kks-book>
      <div className="bookinfo" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div className="bookimg" style={{ flexShrink: 0 }}>
          <div style={{ width: '120px', height: '160px', background: `linear-gradient(135deg, ${PRIMARY} 0%, ${ACCENT} 100%)`, borderRadius: '6px', padding: '2px' }}>
            <BookCover name={book.name} cover={book.cover} className="book-cover" />
          </div>
        </div>
        <div className="newnav" style={{ flex: 1, minWidth: 280 }}>
          <h1 className="ellipsis_2" style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: 700, color: '#2c3e50', lineHeight: 1.4 }}>{book.name}</h1>
          <div className="labelbox" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '13px', color: MUTED, marginBottom: '8px' }}>
            <span>作者：<a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: PRIMARY, textDecoration: 'none' }}>{book.author}</a></span>
            <span>分類：{book.categoryId ? (
              <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: PRIMARY, fontSize: '13px' }}>{book.category}</button>
            ) : <span style={{ color: PRIMARY }}>{book.category}</span>}</span>
            <span><StatusBadge status={book.status} small /></span>
            <span>字數：{formatWords(book.wordCount)}</span>
            <span>更新於：{fmtDate(book.updatedAt) || ''}</span>
          </div>
          <div id="intro" className="ellipsis_2" style={{ fontSize: '13px', color: MUTED, lineHeight: 1.7, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: '12px' }}>{book.intro || '暫無簡介'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="開始閱讀" />
            {savedPos?.chapterId && (
              <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '8px 14px', border: `1px solid ${PRIMARY}`, color: PRIMARY, background: 'transparent', cursor: 'pointer', fontSize: '13px', borderRadius: RADIUS }}>
                繼續閱讀 {savedPos.title ? `· ${savedPos.title}` : ''}
              </button>
            )}
            <button type="button" onClick={onScrollToc} style={{ padding: '8px 14px', border: `1px solid ${BORDER}`, color: INK, background: '#fff', cursor: 'pointer', fontSize: '13px', borderRadius: RADIUS }}>目錄</button>
            <a href={`/api/public/download?book=${book.id}`} style={{ padding: '8px 14px', border: `1px solid ${ACCENT}`, color: ACCENT, background: 'transparent', textDecoration: 'none', fontSize: '13px', borderRadius: RADIUS }}>TXT 下載</a>
            <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
          </div>
        </div>
      </div>
    </div>
  )
}
