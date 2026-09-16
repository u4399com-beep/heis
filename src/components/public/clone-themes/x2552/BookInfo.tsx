<<<<<<< HEAD
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
=======
'use client'
// x2552 (吾爱文学网) 书籍详情页 1:1 克隆 — heibing 模板
// 源站 DOM: .main(#a_head .so + #a_main dt + #at 表格章节) + .btnlinks 行动按钮 + #content .intro 简介 + .footer
// 实测颜色: a #2f468f / a:hover #ff6600 / .btnlinks .read #FF6600 / #content dd padding 10px
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { site, navigate } = usePublic()
  if (!book) return null

  return (
    <div style={{ color: '#666', background: '#fff', font: '12px/120% "Microsoft YaHei", Arial, Verdana, sans-serif', minHeight: '100%' }}>
      {/* 源站 .main.m_head — 简化版 */}
      <div className="main m_head" style={{ width: 960, maxWidth: '100%', margin: '10px auto 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <div className="h_logo fl" style={{ width: 180, flexShrink: 0, textAlign: 'center' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ display: 'inline-block', fontSize: 24, fontWeight: 700, color: '#2f468f', textDecoration: 'none' }}>
            {site.name}
          </a>
        </div>
        <div className="h_body fl" style={{ flex: 1, minWidth: 280 }}>
          <form target="_blank" action="/search" method="post" name="articlesearch" id="articlesearch" style={{ margin: 0 }} onSubmit={(e) => e.preventDefault()}>
            <dl className="fl searchbox" style={{ display: 'flex', alignItems: 'center', margin: 0, padding: '10px 0 0' }}>
              <dt style={{ display: 'flex', alignItems: 'center', width: 260, height: 28, border: '1px solid #CCCCCC', background: '#fff', borderRadius: 2 }}>
                <input type="text" name="searchkey" placeholder="可搜索小说名/作者" style={{ width: 240, background: 'transparent', border: 'none', color: '#666', height: 20, padding: '4px 8px 0 8px', outline: 'none', fontSize: 12 }} />
              </dt>
              <dd style={{ paddingLeft: 4 }}>
                <a href="javascript:void(0);" className="so_book" onClick={() => navigate({ view: 'search' })} style={{ display: 'inline-block', width: 70, height: 28, lineHeight: '28px', textAlign: 'center', background: '#2f468f', color: '#fff', textDecoration: 'none', marginRight: 4 }}>搜书名</a>
              </dd>
            </dl>
          </form>
        </div>
        <div className="cl" style={{ clear: 'both' }} />
      </div>

      {/* 源站 .main.m_menu — 简化版 */}
      <div className="main m_menu" style={{ width: 960, maxWidth: '100%', margin: '5px auto 0', height: 40, background: 'linear-gradient(to bottom, #4a78c4, #2f468f)' }}>
        <ul style={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: 0, height: '100%' }}>
          <li style={{ fontSize: 14, paddingLeft: 12, fontWeight: 700, lineHeight: '39px' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fff', textDecoration: 'none' }}>吾爱首页</a>
          </li>
          <li style={{ fontSize: 14, paddingLeft: 12, fontWeight: 700, lineHeight: '39px' }}>
            <a href="#" style={{ color: '#fff', textDecoration: 'none' }}>书库</a>
          </li>
          <li style={{ fontSize: 14, paddingLeft: 12, fontWeight: 700, lineHeight: '39px' }}>
            <a href="#" style={{ color: '#fff', textDecoration: 'none' }}>全本</a>
          </li>
        </ul>
      </div>

      {/* 源站 #a_main — 书籍信息区 */}
      <div id="a_main" style={{ width: 960, maxWidth: '100%', margin: '10px auto 0' }}>
        <dl style={{ margin: 0 }}>
          <dt style={{ lineHeight: '30px', padding: '0 15px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
            {/* 封面 */}
            <div style={{ flexShrink: 0, width: 120, height: 160, border: '1px solid #E4E4E4', padding: 4, background: '#fff', boxSizing: 'border-box' }}>
              <BookCover name={book.name} cover={book.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
            </div>
            {/* 书名 + meta */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 22, textAlign: 'left', lineHeight: '32px', height: 'auto', margin: 0, color: '#333', fontWeight: 700, paddingBottom: 8, borderBottom: '1px solid #E4E4E4', marginBottom: 8 }}>
                {book.name}
              </h1>
              <div style={{ lineHeight: '24px', fontSize: 13, color: '#666' }}>
                <p style={{ margin: '4px 0' }}>
                  作者：<a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>{book.author}</a>
                  <span style={{ marginLeft: 16 }}>类别：<a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'category', cat: book.categoryId || '' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>{book.category}</a></span>
                </p>
                <p style={{ margin: '4px 0' }}>
                  状态：<span style={{ color: book.status === 'completed' ? '#888' : '#FF3300' }}>{statusLabel(book.status)}</span>
                  <span style={{ marginLeft: 16 }}>字数：{formatWords(book.wordCount)}</span>
                </p>
                <p style={{ margin: '4px 0' }}>
                  更新时间：{fmtDate(book.updatedAt) || '—'}
                </p>
                <p style={{ margin: '4px 0' }}>
                  最新章节：
                  {book.latestChapter ? <a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>{book.latestChapter}</a> : <span style={{ color: '#888' }}>暂无</span>}
                </p>
              </div>

              {/* 行动按钮 .btnlinks */}
              <div className="btnlinks" style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {firstChapterId && (
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                    className="read"
                    style={{ display: 'inline-block', marginRight: 10, background: '#2f468f', color: '#FF6600', width: 100, height: 30, textAlign: 'center', lineHeight: '30px', textDecoration: 'none', borderRadius: 2, fontWeight: 700 }}
                  >
                    立即阅读
                  </a>
                )}
                <button
                  type="button"
                  onClick={onScrollToc}
                  style={{ marginRight: 10, background: '#fff', color: '#666', border: '1px solid #E4E4E4', width: 100, height: 30, lineHeight: '30px', textAlign: 'center', cursor: 'pointer', borderRadius: 2 }}
                >
                  章节目录
                </button>
                <a
                  href={`/api/public/download?book=${book.id}`}
                  style={{ display: 'inline-block', background: '#fff', color: '#666', border: '1px solid #E4E4E4', width: 100, height: 30, lineHeight: '30px', textAlign: 'center', textDecoration: 'none', borderRadius: 2 }}
                >
                  TXT 下载
                </a>
              </div>
            </div>
          </dt>
        </dl>
      </div>

      {/* 源站 #content .intro — 简介 */}
      <div className="main" style={{ width: 960, maxWidth: '100%', margin: '10px auto 0' }}>
        <div className="block" style={{ border: '1px solid #E4E4E4', background: '#fff' }}>
          <div className="blocktitle" style={{ height: 40, lineHeight: '40px', fontSize: 14, background: '#2f468f', color: '#fff', padding: '0 12px' }}>
            内容简介
          </div>
          <div className="blockcontent">
            <div id="contents" style={{ padding: 25, lineHeight: '26px', fontSize: 14, color: '#666' }}>
              {book.intro || '暂无简介'}
            </div>
          </div>
        </div>
      </div>

      {/* 源站 .main.footer */}
      <div className="main footer" style={{ width: 960, maxWidth: '100%', margin: '8px auto 0', background: '#f7faff', border: '1px solid #E4E4E4' }}>
        <div className="ftc" style={{ padding: '10px 12px', lineHeight: '22px', textAlign: 'center', fontSize: 12, color: '#666' }}>
          Copyright © {new Date().getFullYear()} <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>{site.name}</a>({site.domain}) All Rights Reserved
        </div>
      </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
    </div>
  )
}
