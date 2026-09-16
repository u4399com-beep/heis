// ============================================================
// clone-themes/huangjinwu BookInfo — 黄金屋书籍详情页 1:1 克隆
// 实测 huangjinwu default 模板: .book-detail (.book-cover + .book-info + .book-intro)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
const INK = '#1e293b'
const MUTED = '#64748b'
const PRIMARY = '#2563eb'
const LOGO = '#1d4ed8'
const BORDER = '#dbe4f0'
const CARD_BG = '#fff'
const SHADOW = '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)'
const RADIUS = '6px'
const RADIUS_LG = '10px'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <div className="book-detail" style={{ fontFamily: FONT_STACK, color: INK, background: CARD_BG, borderRadius: RADIUS_LG, padding: '20px', border: `1px solid ${BORDER}`, boxShadow: SHADOW }} data-clone-huangjinwu-book>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div className="book-cover" style={{ flexShrink: 0 }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </div>
        <div className="book-info" style={{ flex: 1, minWidth: 280 }}>
          <h1 className="book-title" style={{ margin: '0 0 10px', fontSize: '24px', fontWeight: 700, color: INK }}>{book.name}</h1>
          <div className="book-author" style={{ fontSize: '14px', color: MUTED, marginBottom: '8px' }}>
            作者：<a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: LOGO, textDecoration: 'none' }}>{book.author}</a>
            <span style={{ margin: '0 8px' }}>·</span>
            分类：{book.categoryId ? (
              <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: LOGO, fontSize: '14px' }}>{book.category}</button>
            ) : <span style={{ color: LOGO }}>{book.category}</span>}
            <span style={{ margin: '0 8px' }}>·</span>
            <StatusBadge status={book.status} small />
            <span style={{ margin: '0 8px' }}>·</span>
            字数：{formatWords(book.wordCount)}
            <span style={{ margin: '0 8px' }}>·</span>
            更新：{fmtDate(book.updatedAt) || ''}
          </div>
          <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
            {savedPos?.chapterId && (
              <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '8px 14px', border: `1px solid ${PRIMARY}`, color: PRIMARY, background: 'transparent', cursor: 'pointer', fontSize: '14px', borderRadius: RADIUS }}>
                继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
              </button>
            )}
            <button type="button" onClick={onScrollToc} style={{ padding: '8px 14px', border: `1px solid ${BORDER}`, color: INK, background: CARD_BG, cursor: 'pointer', fontSize: '14px', borderRadius: RADIUS }}>目录</button>
            <a href={`/api/public/download?book=${book.id}`} style={{ padding: '8px 14px', border: `1px solid ${PRIMARY}`, color: PRIMARY, background: 'transparent', textDecoration: 'none', fontSize: '14px', borderRadius: RADIUS }}>TXT 下载</a>
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
