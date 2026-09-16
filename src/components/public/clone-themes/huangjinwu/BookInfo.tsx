<<<<<<< HEAD
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
=======
'use client'
// huangjinwu.org (黄金屋) 书籍详情页 1:1 克隆 — default 模板
// 源站 DOM: .book-detail (.book-cover + .book-info + .book-intro) + .detail-header
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { navigate } = usePublic()
  if (!book) return null

  return (
    <div style={{ background: '#f0f4fb', color: '#1e293b', fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 16, minHeight: '100%' }}>
      <div className="container" style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 16px' }}>
        {/* 面包屑 */}
        <div className="breadcrumb" style={{ color: '#64748b', fontSize: 15, marginBottom: '1.6rem', marginTop: '-1.6rem', overflow: 'hidden', padding: '1.2rem 0', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <ul className="breadcrumb-list" style={{ alignItems: 'center', display: 'flex', gap: '0.8rem', listStyle: 'none', margin: 0, padding: 0 }}>
            <li className="breadcrumb-item">
              <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#1d4ed8', textDecoration: 'none' }}>首页</a>
            </li>
            <li className="breadcrumb-separator" style={{ color: '#64748b' }}>/</li>
            <li className="breadcrumb-item">
              <span style={{ color: '#1d4ed8', cursor: 'pointer' }}>{book.category}</span>
            </li>
            <li className="breadcrumb-separator" style={{ color: '#64748b' }}>/</li>
            <li className="breadcrumb-item active" style={{ color: '#64748b' }}>{book.name}</li>
          </ul>
        </div>

        {/* 源站 .detail-header (.detail-cover-wrapper + .detail-info) */}
        <div className="detail-header" style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)', marginBottom: '2.4rem', padding: '2.4rem', display: 'flex', alignItems: 'flex-start', gap: '2.4rem', flexWrap: 'wrap' }}>
          {/* 封面 */}
          <div className="detail-cover-wrapper" style={{ flexShrink: 0, position: 'relative' }}>
            <div className="detail-cover" style={{ width: 180, height: 250, borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 12px rgba(15,23,42,0.08)', border: '1px solid #dbe4f0' }}>
              <BookCover name={book.name} cover={book.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
            </div>
          </div>

          {/* 详情 */}
          <div className="detail-info" style={{ flex: 1, minWidth: 0 }}>
            <h1 className="detail-title" style={{ color: '#1e293b', fontSize: 32, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3, marginBottom: '2rem', textAlign: 'left', margin: '0 0 1.6rem' }}>
              {book.name}
            </h1>
            <div className="detail-meta" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid #dbe4f0', borderRadius: 10, color: '#64748b', display: 'flex', flexWrap: 'wrap', fontSize: 15, gap: '2rem', padding: '1.6rem 2rem', marginBottom: '1.6rem' }}>
              <span style={{ alignItems: 'center', display: 'flex' }}>
                作者：<a href="#" style={{ color: '#1d4ed8', textDecoration: 'none' }}>{book.author}</a>
              </span>
              <span style={{ alignItems: 'center', display: 'flex' }}>
                分类：<span style={{ color: '#1d4ed8' }}>{book.category}</span>
              </span>
              <span style={{ alignItems: 'center', display: 'flex' }}>
                状态：<span style={{ color: book.status === 'completed' ? '#64748b' : '#2563eb' }}>{statusLabel(book.status)}</span>
              </span>
              <span style={{ alignItems: 'center', display: 'flex' }}>
                字数：{formatWords(book.wordCount)}
              </span>
              <span style={{ alignItems: 'center', display: 'flex' }}>
                更新：{fmtDate(book.updatedAt) || '—'}
              </span>
            </div>
            {book.keywords && (
              <p style={{ color: '#64748b', fontSize: 14, marginBottom: '1.6rem' }}>
                <strong style={{ color: '#1e293b', marginRight: 8 }}>关键词：</strong>{book.keywords}
              </p>
            )}

            {/* 行动按钮 */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: '1.6rem' }}>
              {firstChapterId && (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                  style={{ padding: '12px 28px', background: '#2563eb', color: '#fff', borderRadius: 10, fontSize: 16, fontWeight: 600, textDecoration: 'none' }}
                >
                  开始阅读
                </a>
              )}
              <button
                type="button"
                onClick={onScrollToc}
                style={{ padding: '12px 20px', background: '#fff', color: '#1e293b', border: '1px solid #dbe4f0', borderRadius: 10, fontSize: 15, cursor: 'pointer' }}
              >
                章节目录
              </button>
              <a
                href={`/api/public/download?book=${book.id}`}
                style={{ padding: '12px 20px', background: '#fff', color: '#2563eb', border: '1px solid rgba(37,99,235,0.5)', borderRadius: 10, fontSize: 15, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                TXT 下载
              </a>
            </div>
          </div>
        </div>

        {/* 内容简介 */}
        <div className="book-intro" style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)', marginBottom: '2.4rem', padding: '2.4rem' }}>
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', color: '#1e293b', fontSize: 21, fontWeight: 600, marginBottom: '1.6rem', paddingLeft: '1.6rem', borderLeft: '4px solid #2563eb', borderRadius: '2px 0 0 2px' }}>
            内容简介
          </h2>
          <p style={{ fontSize: 15, color: '#1e293b', lineHeight: 1.85, textIndent: '2em', margin: 0 }}>
            {book.intro || '暂无简介'}
          </p>
        </div>

        {/* 章节列表入口 */}
        <div className="book-detail" style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)', marginBottom: '2.4rem', padding: '2.4rem' }}>
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#1e293b', fontSize: 21, fontWeight: 600, marginBottom: '1.6rem', paddingLeft: '1.6rem', borderLeft: '4px solid #2563eb', borderRadius: '2px 0 0 2px' }}>
            <span>章节目录</span>
            <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 14, padding: '4px 8px' }}>
              查看全部 →
            </button>
          </h2>
          <p style={{ textAlign: 'center', color: '#64748b', padding: '32px 0', margin: 0, fontSize: 15 }}>
            点击 <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 15, padding: 0 }}>章节目录</button> 查看完整章节列表
          </p>
        </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
      </div>
    </div>
  )
}
