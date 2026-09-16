// ============================================================
// clone-themes/ggd66 BookInfo — 格格党书籍详情页 1:1 克隆
// 实测 simple 模板: .content-left .item .book-info
//   .breadcrumb (面包屑) + .book-info (cover + .info + intro)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", simsun, arial, sans-serif'
const INK = '#333333'
const MUTED = '#888888'
const LINK = '#00886d'
const HOVER = '#ff5500'
const BREADCRUMB_BG = '#cdf3eb'
const BORDER = '#cccccc'
const RADIUS = '4px'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }} data-clone-ggd66-book>
      <div className="breadcrumb" style={{ overflow: 'hidden', margin: '0 0 10px', padding: '8px 15px', border: '1px solid #ccc', borderRadius: RADIUS, backgroundColor: BREADCRUMB_BG, listStyle: 'none', fontSize: '14px' }}>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: LINK, textDecoration: 'none' }}>首页</a>
        {' > '}
        <a href={`/?view=book&id=${book.id}`} style={{ color: LINK, textDecoration: 'none' }}>{book.name}</a>
      </div>
      <div className="book-info" style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: RADIUS, padding: '20px' }}>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div className="book-cover" style={{ flexShrink: 0 }}>
            <BookCover name={book.name} cover={book.cover} className="book-cover" />
          </div>
          <div className="book-detail" style={{ flex: 1, minWidth: 280 }}>
            <h1 style={{ margin: '0 0 10px', fontSize: '22px', fontWeight: 700, color: INK }}>{book.name}</h1>
            <dl style={{ margin: '0 0 10px' }}>
              <dt style={{ padding: '4px 0', fontSize: '14px', color: MUTED }}>
                作者：<a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: LINK, textDecoration: 'none' }}>{book.author}</a>
                <span style={{ marginLeft: '10px' }}>分类：{book.categoryId ? (
                  <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: LINK, fontSize: '14px' }}>{book.category}</button>
                ) : <span style={{ color: LINK }}>{book.category}</span>}</span>
                <span style={{ marginLeft: '10px' }}><StatusBadge status={book.status} small /></span>
                <span style={{ marginLeft: '10px' }}>字数：{formatWords(book.wordCount)}</span>
                <span style={{ marginLeft: '10px' }}>更新：{fmtDate(book.updatedAt) || ''}</span>
              </dt>
            </dl>
            <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
              {savedPos?.chapterId && (
                <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '6px 12px', border: `1px solid ${LINK}`, color: LINK, background: 'transparent', cursor: 'pointer', fontSize: '14px', borderRadius: RADIUS }}>
                  继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
                </button>
              )}
              <button type="button" onClick={onScrollToc} style={{ padding: '6px 12px', border: `1px solid ${BORDER}`, color: INK, background: '#fff', cursor: 'pointer', fontSize: '14px', borderRadius: RADIUS }}>目录</button>
              <a href={`/api/public/download?book=${book.id}`} style={{ padding: '6px 12px', border: `1px solid ${HOVER}`, color: HOVER, background: 'transparent', textDecoration: 'none', fontSize: '14px', borderRadius: RADIUS }}>TXT 下载</a>
              <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
            </div>
          </div>
        </div>
        <div className="book-intro" style={{ marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${BORDER}`, fontSize: '14px', lineHeight: 1.8, color: INK }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '16px', fontWeight: 700 }}>内容简介</h3>
          <p style={{ margin: 0, textIndent: '2em', whiteSpace: 'pre-wrap' }}>{book.intro || '暂无简介'}</p>
        </div>
      </div>
    </div>
  )
}
