// ============================================================
// clone-themes/x2552 BookInfo — 吾爱文学书籍详情页 1:1 克隆
// 实测 heibing 模板: #centeri .block .blocktitle + #info + #intro
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", "宋体", Verdana, Arial, sans-serif'
const INK = '#333333'
const MUTED = '#666666'
const LINK = '#2f468f'
const HOVER = '#ff6600'
const BORDER = '#E4E4E4'
const HEADER_BG = '#f5f5dc'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <div className="main" style={{ width: '100%', maxWidth: '960px', margin: '0 auto', fontFamily: FONT_STACK, color: INK }} data-clone-x2552-book>
      <div className="block" style={{ border: `1px solid ${BORDER}`, marginTop: '8px' }}>
        <div className="blocktitle" style={{ height: '40px', lineHeight: '40px', fontSize: '14px', background: HEADER_BG, padding: '0 10px' }}>
          <span style={{ fontWeight: 700, color: INK }}>{book.name}</span>
        </div>
        <div className="blockcontent" style={{ padding: '14px' }}>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ flexShrink: 0 }}>
              <div style={{ border: `1px solid ${BORDER}`, padding: '5px', width: '120px', height: '150px' }}>
                <BookCover name={book.name} cover={book.cover} className="book-cover" />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <h1 style={{ margin: '0 0 10px', fontSize: '22px', fontWeight: 700, color: INK }}>{book.name}</h1>
              <div style={{ fontSize: '13px', color: MUTED, lineHeight: '2' }}>
                作者：<a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: LINK, textDecoration: 'none' }}>{book.author}</a><br />
                分类：{book.categoryId ? (
                  <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: LINK, fontSize: '13px' }}>{book.category}</button>
                ) : <span style={{ color: LINK }}>{book.category}</span>}<br />
                状态：<StatusBadge status={book.status} small /><br />
                字数：{formatWords(book.wordCount)}<br />
                更新：{fmtDate(book.updatedAt) || ''}
              </div>
              <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
                {savedPos?.chapterId && (
                  <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '6px 12px', border: `1px solid ${LINK}`, color: LINK, background: 'transparent', cursor: 'pointer', fontSize: '12px' }}>
                    继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
                  </button>
                )}
                <button type="button" onClick={onScrollToc} style={{ padding: '6px 12px', border: `1px solid ${BORDER}`, color: INK, background: '#fff', cursor: 'pointer', fontSize: '12px' }}>目录</button>
                <a href={`/api/public/download?book=${book.id}`} style={{ padding: '6px 12px', border: `1px solid ${HOVER}`, color: HOVER, background: 'transparent', textDecoration: 'none', fontSize: '12px' }}>TXT 下载</a>
                <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: `1px dashed ${BORDER}`, textIndent: '2em', fontSize: '12px', lineHeight: '1.8', color: INK }}>
            {book.intro || '暂无简介'}
          </div>
        </div>
      </div>
    </div>
  )
}
