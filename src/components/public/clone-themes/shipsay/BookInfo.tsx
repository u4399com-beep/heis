// ============================================================
// clone-themes/shipsay BookInfo — 船说CMS书籍详情页 1:1 克隆
// 实测 shipsay.css: .side_commend .detail (左封面 + 右标题/作者/简介)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", Arial, Tahoma, Verdana, sans-serif'
const INK = '#666666'
const MUTED = '#969ba3'
const LINK = '#1a1a1a'
const PRIMARY = '#ed4259'
const ACCENT = '#bf2c24'
const CARD_BG = '#ffffff'
const BORDER = '#e0e0e0'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <div className="side_commend" style={{ fontFamily: FONT_STACK, color: INK, background: CARD_BG, padding: '14px' }} data-clone-shipsay-book>
      <div className="detail" style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
        <div style={{ flexShrink: 0 }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </div>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{ margin: '0 0 10px', fontSize: '22px', fontWeight: 700, color: LINK }}>
            <a href={`/?view=book&id=${book.id}`} style={{ color: LINK, textDecoration: 'none' }}>{book.name}</a>
          </h1>
          <div style={{ marginBottom: '6px', fontSize: '14px', color: MUTED }}>
            作者：<a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: LINK, textDecoration: 'none' }}>{book.author}</a>
            <span style={{ margin: '0 8px' }}>|</span>
            分类：{book.categoryId ? (
              <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: PRIMARY, fontSize: '14px' }}>{book.category}</button>
            ) : <span style={{ color: PRIMARY }}>{book.category}</span>}
            <span style={{ margin: '0 8px' }}>|</span>
            <StatusBadge status={book.status} small />
            <span style={{ margin: '0 8px' }}>|</span>
            字数：{formatWords(book.wordCount)}
            <span style={{ margin: '0 8px' }}>|</span>
            更新：{fmtDate(book.updatedAt) || ''}
          </div>
          <p className="intro" style={{ margin: '10px 0', textIndent: '2em', lineHeight: '1.8', fontSize: '14px', color: INK }}>{book.intro || '暂无简介'}</p>
          <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
            {savedPos?.chapterId && (
              <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '8px 14px', border: `1px solid ${PRIMARY}`, color: PRIMARY, background: 'transparent', cursor: 'pointer', fontSize: '14px' }}>
                继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
              </button>
            )}
            <button type="button" onClick={onScrollToc} style={{ padding: '8px 14px', border: `1px solid ${BORDER}`, color: INK, background: CARD_BG, cursor: 'pointer', fontSize: '14px' }}>目录</button>
            <a href={`/api/public/download?book=${book.id}`} style={{ padding: '8px 14px', border: `1px solid ${ACCENT}`, color: ACCENT, background: 'transparent', textDecoration: 'none', fontSize: '14px' }}>TXT 下载</a>
            <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
          </div>
        </div>
      </div>
    </div>
  )
}
