// ============================================================
// clone-themes/pilishuwu BookInfo — 霹雳书屋书籍详情页 1:1 克隆
// 实测 probe-html2/probe-pilishuwu-book.html (wmcms-web 模板):
//   .detail (h2 + .info + .cover + .intro + .vlist)
//   .detail .cover img + .detail .info (作者/分类/状态/字数)
//   .detail .intro 简介
//   .vlist 章节列表
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif'
const INK = '#333333'
const MUTED = '#888888'
const PRIMARY = '#fd8929'
const ACCENT = '#ec5245'
const BORDER = '#ffe4c4'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <div className="detail" style={{ fontFamily: FONT_STACK, color: INK, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: '2px', padding: '14px' }} data-clone-pilishuwu-book>
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
        <div className="cover" style={{ flexShrink: 0 }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </div>
        <div className="info" style={{ flex: 1, minWidth: 280 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 700, color: INK }}>{book.name}</h2>
          <p style={{ margin: '4px 0', fontSize: '14px', color: MUTED }}>
            作者：<a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: PRIMARY, textDecoration: 'none' }}>{book.author}</a>
            <span style={{ marginLeft: '10px' }}>分类：</span>
            {book.categoryId ? (
              <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: PRIMARY, fontSize: '14px' }}>{book.category}</button>
            ) : <span style={{ color: PRIMARY }}>{book.category}</span>}
            <span style={{ marginLeft: '10px' }}><StatusBadge status={book.status} small /></span>
            <span style={{ marginLeft: '10px' }}>字数：{formatWords(book.wordCount)}</span>
            <span style={{ marginLeft: '10px' }}>更新：{fmtDate(book.updatedAt) || ''}</span>
          </p>
          <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
            {savedPos?.chapterId && (
              <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '6px 12px', border: `1px solid ${PRIMARY}`, color: PRIMARY, background: 'transparent', cursor: 'pointer', fontSize: '14px' }}>
                继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
              </button>
            )}
            <button type="button" onClick={onScrollToc} style={{ padding: '6px 12px', border: `1px solid ${BORDER}`, color: INK, background: '#fff', cursor: 'pointer', fontSize: '14px' }}>目录</button>
            <a href={`/api/public/download?book=${book.id}`} style={{ padding: '6px 12px', border: `1px solid ${ACCENT}`, color: ACCENT, background: 'transparent', textDecoration: 'none', fontSize: '14px' }}>TXT 下载</a>
            <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
          </div>
        </div>
      </div>
      <div className="intro" style={{ marginTop: '14px', paddingTop: '12px', borderTop: `1px dashed ${BORDER}`, textIndent: '2em', lineHeight: 1.8, fontSize: '14px', color: INK }}>
        {book.intro || '暂无简介'}
      </div>
    </div>
  )
}
