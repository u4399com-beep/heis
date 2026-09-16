// ============================================================
// clone-themes/trxsw BookInfo — 天人小说书籍详情页 1:1 克隆
// 域名已过期但规则保留, 通过 GitHub mason173/aira-browser 反查真实 DOM:
//   .detail (img + .name strong + .author a) + .intro + .vlist
// 硬编码源站实际 CSS 变量值 (themes.ts vars):
//   bg #f5f7fa / surface #fff / text #333 / textMuted #888
//   primary #2c7be5 (深蓝) / accent #1a5fb4 / border #e0e6ed / radius 4px
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '"Microsoft YaHei", Arial, sans-serif'
const BG = '#f5f7fa'
const SURFACE = '#ffffff'
const INK = '#333333'
const MUTED = '#888888'
const PRIMARY = '#2c7be5'
const ACCENT = '#1a5fb4'
const BORDER = '#e0e6ed'
const RADIUS = '4px'
const SHADOW = '0 1px 3px rgba(0,0,0,0.05)'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, background: BG, minHeight: '100vh', padding: '14px' }} data-clone-trxsw-book>
      <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
        {/* 面包屑 */}
        <div style={{ fontSize: '12px', color: MUTED, marginBottom: '10px' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: PRIMARY, textDecoration: 'none' }}>首页</a>
          <span style={{ margin: '0 6px' }}>&gt;</span>
          {book.categoryId ? (
            <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: PRIMARY, fontSize: '12px' }}>{book.category}</button>
          ) : <span style={{ color: INK }}>{book.category}</span>}
          <span style={{ margin: '0 6px' }}>&gt;</span>
          <span style={{ color: INK }}>{book.name}</span>
        </div>
        {/* .detail 卡 */}
        <div className="detail" style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '20px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ flexShrink: 0 }}>
            <BookCover name={book.name} cover={book.cover} className="book-cover" />
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h1 className="name" style={{ fontSize: '24px', fontWeight: 700, color: INK, margin: '0 0 12px' }}>
              <strong>{book.name}</strong>
            </h1>
            <div className="author" style={{ fontSize: '14px', color: MUTED, marginBottom: '8px' }}>
              <span>作者：</span>
              <a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: PRIMARY, textDecoration: 'none' }}>{book.author}</a>
              <span style={{ margin: '0 10px' }}>|</span>
              <span>分类：</span>
              {book.categoryId ? (
                <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: PRIMARY, fontSize: '14px' }}>{book.category}</button>
              ) : <span style={{ color: PRIMARY }}>{book.category}</span>}
              <span style={{ margin: '0 10px' }}>|</span>
              <StatusBadge status={book.status} small />
              <span style={{ margin: '0 10px' }}>|</span>
              <span>字数：{formatWords(book.wordCount)}</span>
              <span style={{ margin: '0 10px' }}>|</span>
              <span>更新：{fmtDate(book.updatedAt) || ''}</span>
            </div>
            <p className="intro" style={{ margin: '12px 0', textIndent: '2em', lineHeight: '1.8', fontSize: '14px', color: INK }}>{book.intro || '暂无简介'}</p>
            <div style={{ marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
              {savedPos?.chapterId && (
                <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '8px 14px', border: `1px solid ${PRIMARY}`, color: PRIMARY, background: 'transparent', cursor: 'pointer', fontSize: '14px', borderRadius: RADIUS }}>
                  继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
                </button>
              )}
              <button type="button" onClick={onScrollToc} style={{ padding: '8px 14px', border: `1px solid ${BORDER}`, color: INK, background: SURFACE, cursor: 'pointer', fontSize: '14px', borderRadius: RADIUS }}>目录</button>
              <a href={`/api/public/download?book=${book.id}`} style={{ padding: '8px 14px', border: `1px solid ${ACCENT}`, color: ACCENT, background: 'transparent', textDecoration: 'none', fontSize: '14px', borderRadius: RADIUS }}>TXT 下载</a>
              <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
