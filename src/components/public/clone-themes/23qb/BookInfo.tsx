<<<<<<< HEAD
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
=======
'use client'
// 23qb.net (铅笔小说) 书籍详情页 1:1 克隆 — mxstatic .book-info 模板
// 源站 DOM: .book-info (.book-cover + .book-detail + .book-intro)
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { navigate } = usePublic()
  if (!book) return null

  return (
    <div className="page" style={{ background: '#f8f9f9', color: '#282828', fontFamily: '-apple-system-font, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif', fontSize: 14, minHeight: '100%' }}>
      <div className="wrapper" style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 15px 24px', boxSizing: 'border-box' }}>
        {/* 面包屑 */}
        <div className="breadcrumb" style={{ padding: '8px 0', marginBottom: 12, color: '#999', fontSize: 13 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#282828', textDecoration: 'none' }}>首页</a>
          <span style={{ margin: '0 6px' }}>&gt;</span>
          <span style={{ color: '#ff2a14' }}>{book.name}</span>
        </div>

        <div className="book-info box" style={{ background: '#fff', borderRadius: 8, padding: 24, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {/* 封面 */}
          <div className="book-cover" style={{ flex: '0 0 180px', width: 180, height: 240, position: 'relative' }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 6, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <BookCover name={book.name} cover={book.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
            </div>
          </div>

          {/* 详情 */}
          <div className="book-detail" style={{ flex: '1 1 480px', minWidth: 0, padding: '8px 0' }}>
            <h1 className="book-title" style={{ fontSize: 28, fontWeight: 700, color: '#282828', margin: '0 0 16px', lineHeight: 1.3 }}>
              {book.name}
            </h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, fontSize: 13, color: '#666' }}>
              <span style={{ background: 'rgba(255,42,20,0.08)', color: '#ff2a14', padding: '3px 10px', borderRadius: 4, fontSize: 12 }}>
                {book.category}
              </span>
              <span style={{ background: '#f3f5f7', color: '#282828', padding: '3px 10px', borderRadius: 4, fontSize: 12 }}>
                {statusLabel(book.status)}
              </span>
              <span style={{ background: 'transparent', border: '1px solid #eaecef', color: '#666', padding: '2px 10px', borderRadius: 4, fontSize: 12 }}>
                {formatWords(book.wordCount)}
              </span>
            </div>
            <div style={{ fontSize: 14, color: '#666', lineHeight: 2, marginBottom: 16 }}>
              <p style={{ margin: '4px 0' }}>
                <strong style={{ color: '#282828', marginRight: 8 }}>作者：</strong>
                <a href="#" style={{ color: '#ff2a14', textDecoration: 'none' }}>{book.author}</a>
              </p>
              <p style={{ margin: '4px 0' }}>
                <strong style={{ color: '#282828', marginRight: 8 }}>最新章节：</strong>
                <span style={{ color: '#666' }}>{book.latestChapter || '暂无'}</span>
              </p>
              <p style={{ margin: '4px 0' }}>
                <strong style={{ color: '#282828', marginRight: 8 }}>更新时间：</strong>
                <span style={{ color: '#999' }}>{fmtDate(book.updatedAt) || '—'}</span>
              </p>
              {book.keywords && (
                <p style={{ margin: '4px 0' }}>
                  <strong style={{ color: '#282828', marginRight: 8 }}>关键词：</strong>
                  <span style={{ color: '#999' }}>{book.keywords}</span>
                </p>
              )}
            </div>

            {/* 行动按钮 */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {firstChapterId && (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                  style={{ padding: '10px 28px', background: 'linear-gradient(90deg, #ff9800, #ff2a14)', color: '#fff', borderRadius: 22, fontSize: 15, fontWeight: 700, textDecoration: 'none' }}
                >
                  开始阅读
                </a>
              )}
              <button
                type="button"
                onClick={onScrollToc}
                style={{ padding: '10px 20px', background: '#fff', color: '#282828', border: '1px solid #eaecef', borderRadius: 22, fontSize: 14, cursor: 'pointer' }}
              >
                章节目录
              </button>
              <a
                href={`/api/public/download?book=${book.id}`}
                style={{ padding: '10px 20px', background: '#fff', color: '#ff2a14', border: '1px solid #ff2a14', borderRadius: 22, fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                TXT 下载
              </a>
            </div>
          </div>
        </div>

        {/* 内容简介 */}
        <div className="book-intro box" style={{ background: '#fff', borderRadius: 8, padding: 24, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#282828', margin: '0 0 12px', padding: '0 0 0 12px', borderLeft: '4px solid #ff2a14' }}>
            内容简介
          </h2>
          <p style={{ fontSize: 14, color: '#555', lineHeight: 1.85, textIndent: '2em', margin: 0 }}>
            {book.intro || '暂无简介'}
          </p>
        </div>

        {/* 章节列表入口 */}
        <div className="box" style={{ background: '#fff', borderRadius: 8, padding: 24, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#282828', margin: '0 0 12px', padding: '0 0 0 12px', borderLeft: '4px solid #ff2a14', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>章节目录</span>
            <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#ff2a14', cursor: 'pointer', fontSize: 13, padding: '4px 8px' }}>
              查看全部 →
            </button>
          </h2>
          <p style={{ textAlign: 'center', color: '#999', padding: '24px 0', margin: 0, fontSize: 13 }}>
            点击 <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#ff2a14', cursor: 'pointer', fontSize: 13, padding: 0 }}>章节目录</button> 查看完整章节列表
          </p>
        </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
      </div>
    </div>
  )
}
