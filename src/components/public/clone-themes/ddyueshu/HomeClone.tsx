// ============================================================
// clone-themes/ddyueshu — 得得小说 ddyueshu.cc 1:1 真克隆
// 实测 probe-html2/probe-ddyueshu.{html,css} (biquge.css 模板, GBK 编码)
// 硬编码源站实际 CSS 变量值 (不用 theme.vars):
//   body { background:#E9FAFF; color:#555; font-family:宋体; font-size:12px; }
//   a { color:#6F78A7; text-decoration:none; }
//   .nav { background:#88C6E5; height:40px; width:980px; }
//   .nav ul li a { color:#FFF; font-size:15px; font-weight:700; padding:0 14px; }
//   #main { width:980px; margin:auto; }
//   #hotcontent .l { background:#FEF9EF; border:3px solid #C3DFEA; float:left; width:695px; }
//   #hotcontent .l .item { float:left; width:335px; padding:10px 0 0 10px; }
//   #hotcontent .r { border:3px solid #C3DFEA; float:right; width:265px; background:#FEF9EF; }
//   #hotcontent h2 { background:#E1ECED; border-bottom:1px solid #DDD; font-size:14px; font-weight:700; }
//   .novelslist { border:3px solid #A6D3E8; width:968px; background:#FEF9EF; }
//   .novelslist .content { border-right:dotted 1px #A6D3E8; padding:0 3px; float:left; width:315px; }
//   #newscontent .l { border:3px solid #88C6E5; width:695px; background:#E1ECED; }
//   #newscontent .r { width:265px; border:3px solid #88C6E5; background:#E1ECED; }
//   #newscontent h2 { background:#A6D3E8; height:30px; line-height:30px; font-size:14px; font-weight:bold; }
//   .novelslist li .s1 { width:10%; } / .s2 { width:20%; } / .s3 { width:49%; } / .s4 { color:#B3B3B3; width:15%; }
//   #firendlink { border:1px solid #DDD; width:949px; padding:9px; }
//   #firendlink a { color:#548161; margin:0 9px 0 0; }
//   radius: 2px
// DOM 结构:
//   #wrapper > .header (logo) + .nav (10 分类: 首页/我的书架/玄幻/修真/都市/穿越/网游/科幻/排行榜/小说大全)
//   #main > #hotcontent (左 .l 4 大卡 + 右 .r 推荐强档) + .novelslist (3 列分类) + #newscontent (最新入库 + 最近更新)
//   #firendlink (友情链接: 得得小说/APP/...
//   .footer (.footer_link + .footer_cont)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { BookGridSkeleton } from '../../bits'
import { fmtDate } from '../../seo'
import type { BookItem } from '../../types'
import type { ReactNode } from 'react'
import type { HomeCloneProps } from '../shared-props'

const FONT_STACK = '"宋体", "SimSun", "Microsoft YaHei", Arial, sans-serif'
const BG = '#E9FAFF'
const INK = '#555555'
const MUTED = '#B3B3B3'
const LINK = '#6F78A7'
const NAV_BG = '#88C6E5'
const HEAD_H2 = '#E1ECED'
const NEWS_H2 = '#A6D3E8'
const CARD_BG = '#FEF9EF'
const BORDER = '#A6D3E8'
const BORDER_NEWS = '#88C6E5'
const FRIEND_LINK = '#548161'

const NAV_ITEMS = [
  '首页', '我的书架', '玄幻小说', '修真小说', '都市小说', '穿越小说', '网游小说', '科幻小说', '排行榜', '小说大全',
]

function Nav() {
  return (
    <div className="nav" style={{ background: NAV_BG, height: '40px', width: '100%', maxWidth: '980px', margin: '10px auto 0', overflow: 'hidden', fontFamily: FONT_STACK }}>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {NAV_ITEMS.map((n) => (
          <li key={n} style={{ float: 'left', lineHeight: '44px' }}>
            <a href="javascript:;" style={{ color: '#FFF', fontSize: '15px', fontWeight: 700, padding: '0 14px', textDecoration: 'none' }}>{n}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Header() {
  return (
    <div className="header" style={{ height: '61px', width: '100%', maxWidth: '980px', margin: '0 auto', fontFamily: FONT_STACK, display: 'flex', alignItems: 'center', gap: '30px', padding: '0 10px' }}>
      <div className="header_logo" style={{ flexShrink: 0 }}>
        <a href="/" style={{ color: NAV_BG, fontSize: '24px', fontWeight: 700, textDecoration: 'none' }}>得得小说</a>
      </div>
      <div className="header_search" style={{ flex: 1, maxWidth: '420px' }}>
        <form style={{ width: '100%', height: '32px', borderRadius: '2px', border: `2px solid ${NAV_BG}`, position: 'relative', overflow: 'hidden', display: 'flex' }} onSubmit={(e) => e.preventDefault()}>
          <input type="text" placeholder="可搜书名/作者" style={{ flex: 1, height: '100%', padding: '0 6px', border: 'none', fontSize: '14px', lineHeight: '20px' }} />
          <button type="submit" style={{ width: '100px', height: '100%', background: NAV_BG, color: '#FFF', fontSize: '16px', cursor: 'pointer', border: 'none' }}>搜索</button>
        </form>
      </div>
    </div>
  )
}

function HotItem({ book, idx }: { book: BookItem; idx: number }) {
  const { navigate } = usePublic()
  return (
    <div className="item" style={{ float: 'left', width: '335px', padding: '10px 0 0 10px', display: 'flex', gap: '10px', fontFamily: FONT_STACK }}>
      <div className="image" style={{ float: 'left', width: '120px', flexShrink: 0 }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </a>
      </div>
      <dl style={{ float: 'right', width: '190px', margin: 0, padding: 0 }}>
        <dt style={{ borderBottom: '1px dotted #A6D3E8', fontSize: '14px', fontWeight: 700, height: '25px', lineHeight: '25px', overflow: 'hidden' }}>
          <span style={{ color: MUTED, float: 'right', fontWeight: 400 }}>{idx + 1}</span>
          <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: LINK, textDecoration: 'none' }}>{book.name}</a>
        </dt>
        <dd style={{ height: '120px', lineHeight: '20px', overflow: 'hidden', textIndent: '2em', padding: '7px 0 0', margin: 0, fontSize: '12px', color: INK }}>
          {book.intro}
        </dd>
      </dl>
    </div>
  )
}

function NovelsRow({ title, books }: { title: string; books: BookItem[] }) {
  const { navigate } = usePublic()
  return (
    <div className="content" style={{ borderRight: 'dotted 1px #A6D3E8', padding: '0 3px', float: 'left', width: '315px', fontFamily: FONT_STACK }}>
      <h2 style={{ borderBottom: '1px solid #A6D3E8', fontSize: '14px', fontWeight: 'bold', padding: '0 0 0 5px', lineHeight: '25px', height: '25px', overflow: 'hidden', margin: 0, background: HEAD_H2 }}>{title}</h2>
      {books[0] && (
        <div className="top" style={{ padding: '10px 0 0 5px', display: 'flex', gap: '10px' }}>
          <div className="image" style={{ float: 'left', width: '71px' }}>
            <a href={`/?view=book&id=${books[0].id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: books[0].id }) }}>
              <BookCover name={books[0].name} cover={books[0].cover} className="book-cover" />
            </a>
          </div>
          <dl style={{ float: 'right', width: '219px', margin: 0 }}>
            <dt style={{ height: '25px', lineHeight: '25px', overflow: 'hidden', fontWeight: 'bold' }}>
              <a href={`/?view=book&id=${books[0].id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: books[0].id }) }} style={{ color: LINK, textDecoration: 'none' }}>{books[0].name}</a>
            </dt>
            <dd style={{ lineHeight: '20px', height: '60px', overflow: 'hidden', margin: 0, fontSize: '12px', color: INK }}>{books[0].intro}</dd>
          </dl>
        </div>
      )}
      <ul style={{ padding: '10px 0 0', margin: 0, listStyle: 'none' }}>
        {books.slice(1, 13).map((b) => (
          <li key={b.id} style={{ color: MUTED, height: '20px', lineHeight: '20px', fontSize: '12px', overflow: 'hidden', float: 'left', width: '155px' }}>
            <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ fontSize: '13px', color: LINK, textDecoration: 'none' }}>{b.name}</a>/{b.author}
          </li>
        ))}
      </ul>
    </div>
  )
}

function NewsRow({ book }: { book: BookItem }) {
  const { navigate } = usePublic()
  return (
    <li style={{ padding: '5px 0 0', borderBottom: '1px solid #DDD', height: '25px', lineHeight: '25px', overflow: 'hidden', fontFamily: FONT_STACK, display: 'flex', gap: '10px' }}>
      <span className="s1" style={{ width: '75px', display: 'inline-block' }}>[{book.category}]</span>
      <span className="s2" style={{ width: '165px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: LINK, textDecoration: 'none' }}>{book.name}</a>
      </span>
      <span className="s3" style={{ width: '300px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: LINK, textDecoration: 'none' }}>{book.latestChapter || '最新章节'}</a>
      </span>
      <span className="s4" style={{ color: MUTED, width: '90px', textAlign: 'right', display: 'inline-block' }}>{book.author}</span>
      <span className="s5" style={{ color: MUTED, marginLeft: 'auto', textAlign: 'right' }}>{fmtDate(book.updatedAt) || '今天'}</span>
    </li>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps): ReactNode {
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh', padding: '14px' }}>
        <Header />
        <Nav />
        <BookGridSkeleton count={8} />
      </div>
    )
  }

  const hot = books.slice(0, 4)
  const cat1 = books.slice(4, 17)
  const cat2 = books.slice(17, 30)
  const cat3 = books.slice(30, 43)
  const newsLatest = books.slice(0, 15)
  const newsRecent = books.slice(15, 30)

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <div id="wrapper">
        <Header />
        <Nav />
        <div id="main" style={{ width: '100%', maxWidth: '980px', margin: '0 auto' }}>
          <div id="hotcontent" style={{ paddingTop: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div className="l" style={{ background: CARD_BG, border: `3px solid ${BORDER}`, float: 'left', minHeight: '330px', width: '695px', padding: '0 0 10px', display: 'flex', flexWrap: 'wrap' }}>
              {hot.map((b, i) => <HotItem key={b.id} book={b} idx={i} />)}
            </div>
            <div className="r" style={{ border: `3px solid ${BORDER}`, float: 'right', width: '265px', background: CARD_BG, flex: 1, maxWidth: '265px' }}>
              <h2 style={{ background: HEAD_H2, borderBottom: '1px solid #DDD', fontSize: '14px', fontWeight: 700, height: '30px', lineHeight: '30px', margin: 0, padding: '0 0 0 10px' }}>推荐强档</h2>
              <ul style={{ padding: '10px', margin: 0, listStyle: 'none' }}>
                {books.slice(4, 12).map((b) => (
                  <li key={b.id} style={{ borderBottom: '1px solid #DDD', height: '28px', lineHeight: '28px', overflow: 'hidden', padding: '5px 0 0' }}>
                    <span className="s1" style={{ width: '40px', display: 'inline-block' }}>[{b.category}]</span>
                    <span className="s2" style={{ color: MUTED }}><a href={`/?view=book&id=${b.id}`} style={{ color: LINK, textDecoration: 'none' }}>{b.name}</a></span>
                    <span className="s5" style={{ float: 'right', textAlign: 'right' }}>{b.author}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="novelslist" style={{ margin: '2px auto', border: `3px solid ${BORDER}`, width: '100%', maxWidth: '968px', padding: '3px', background: CARD_BG, display: 'flex', gap: '3px' }}>
            <NovelsRow title="玄幻小说" books={cat1} />
            <NovelsRow title="都市小说" books={cat2} />
            <NovelsRow title="历史小说" books={cat3} />
          </div>

          <div id="newscontent" style={{ margin: '10px auto', display: 'flex', gap: '10px' }}>
            <div className="l" style={{ border: `3px solid ${BORDER_NEWS}`, float: 'left', width: '695px', background: HEAD_H2, flex: 1 }}>
              <h2 style={{ background: NEWS_H2, height: '30px', lineHeight: '30px', fontSize: '14px', fontWeight: 'bold', margin: 0, padding: '0 0 0 10px' }}>最新入库小说列表</h2>
              <ul style={{ padding: '10px', margin: 0, listStyle: 'none' }}>
                {newsLatest.map((b) => <NewsRow key={b.id} book={b} />)}
              </ul>
            </div>
            <div className="r" style={{ float: 'right', width: '265px', border: `3px solid ${BORDER_NEWS}`, background: HEAD_H2, flexShrink: 0 }}>
              <h2 style={{ background: NEWS_H2, height: '30px', lineHeight: '30px', fontSize: '14px', fontWeight: 'bold', margin: 0, padding: '0 0 0 10px' }}>最近更新小说</h2>
              <ul style={{ padding: '10px', margin: 0, listStyle: 'none' }}>
                {newsRecent.map((b) => (
                  <li key={b.id} style={{ padding: '5px 0 0', borderBottom: '1px solid #DDD', height: '25px', lineHeight: '25px', overflow: 'hidden' }}>
                    <span className="s1" style={{ width: '40px', display: 'inline-block' }}>[{b.category}]</span>
                    <span className="s2" style={{ color: MUTED }}><a href={`/?view=book&id=${b.id}`} style={{ color: LINK, textDecoration: 'none' }}>{b.name}</a></span>
                    <span className="s5" style={{ float: 'right', textAlign: 'right' }}>{fmtDate(b.updatedAt) || '今天'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div id="firendlink" style={{ border: '1px solid #DDD', lineHeight: '22px', width: '100%', maxWidth: '949px', margin: '10px auto', padding: '9px 0 9px 9px', fontFamily: FONT_STACK, fontSize: '12px' }}>
          友情链接：
          <a href="https://wap.ddyueshu.cc/" target="_blank" rel="noreferrer" style={{ color: FRIEND_LINK, display: 'inline-block', margin: '0 9px 0 0', textDecoration: 'none' }}>得得小说</a>
          <a href="https://app.ddyueshu.cc" target="_blank" rel="noreferrer" style={{ color: FRIEND_LINK, display: 'inline-block', margin: '0 9px 0 0', textDecoration: 'none' }}>得得小说APP</a>
          <a href="https://www.ddyueshu.cc/" target="_blank" rel="noreferrer" style={{ color: FRIEND_LINK, display: 'inline-block', margin: '0 9px 0 0', textDecoration: 'none' }}>得得小说app下载地址</a>
        </div>

        <div className="footer" style={{ overflow: 'hidden', textAlign: 'center', width: '100%', maxWidth: '980px', margin: '10px auto 0', fontFamily: FONT_STACK, fontSize: '12px', color: MUTED }}>
          <div className="footer_link" style={{ borderBottom: `2px solid ${NAV_BG}`, height: '25px', lineHeight: '25px', overflow: 'hidden' }} />
          <div className="footer_cont" style={{ padding: '10px 0' }}>
            <p style={{ margin: 0, color: MUTED, lineHeight: '20px' }}>
              Copyright © 得得小说 All Rights Reserved<br />
              本站所有小说为转载作品，所有章节均由网友上传，转载至本站只为宣传本书让更多读者欣赏。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
