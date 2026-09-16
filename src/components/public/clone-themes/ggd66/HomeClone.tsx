// ============================================================
// clone-themes/ggd66 — 格格党 ggd66.com 1:1 真克隆
// 实测 probe-html2/probe-ggd66.{html,css} (simple 模板, 172 行 CSS)
// 硬编码源站实际 CSS 变量值 (不用 theme.vars):
//   body { background-color:#f9f9f9; color:#888; font-weight:400; font-size:15px; font-family:"微软雅黑", Microsoft Yahei, simsun, arial, sans-serif; line-height:150%; }
//   a { color:#00886d; text-decoration:none; }
//   a:hover { color:#f50; text-decoration:none; }
//   .header { background-color:#56ccb5; height:50px; line-height:50px; box-shadow:0 1px 1px #1abc9c; }
//   .header, .header a { color:#fff; }
//   .header .header-left { text-shadow:1px 1px 2px #000; font-size:18px; }
//   .header .header-right { font-size:15px; }
//   .container, .footer p { width:90%; max-width:75pc; }  /* 1200px */
//   .content-left { float:left; width:73%; }
//   .content-right { float:right; width:25%; }
//   #fengtui .item { float:left; padding:10px 0 0; width:50%; }
//   #fengtui .item .image { float:left; margin-right:10px; width:90pt; }  /* 120px */
//   #fengtui .item .image img { padding:1px; border:1px solid #ccc; background-color:#fff; }
//   #fengtui .item dl dt { overflow:hidden; height:25px; border-bottom:1px dotted #ccc; font-weight:700; font-size:15px; line-height:25px; }
//   #fengtui .item dl dd { overflow:hidden; padding:7px 0 0; height:90pt; text-indent:2em; font-size:14px; line-height:24px; }
//   #fengyou ul li, #zuixin ul li { overflow:hidden; padding:4px 0; height:28px; border-bottom:1px dashed #ccc; font-size:14px; line-height:28px; }
//   .breadcrumb { padding:8px 15px; border:1px solid #ccc; border-radius:4px; background-color:#cdf3eb; font-size:14px; }
//   h2 { margin-top:10px; padding:0 0 10px; border-bottom:1px solid #ccc; color:#333; font-weight:500; font-size:18px; }
//   .footer { padding:10px 0; background-color:#56ccb5; box-shadow:0 -1px 1px #56ccb5; color:#fff; text-align:center; font-size:14px; }
// DOM 结构 (simple 模板):
//   .header (header-left logo + header-right 链接) + .container
//   .content > .content-left (fengtui 推荐 + #gengxin 更新列表) + .content-right (fengyou 排行榜)
//   .footer
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { BookGridSkeleton } from '../../bits'
import { fmtDate } from '../../seo'
import type { HomeCloneProps } from '../shared-props'
import type { ReactNode } from 'react'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", simsun, arial, sans-serif'
const BG = '#f9f9f9'
const INK = '#333333'
const MUTED = '#888888'
const LINK = '#00886d'
const HEADER_BG = '#56ccb5'

function Header() {
  return (
    <div className="header" style={{ backgroundColor: HEADER_BG, marginBottom: '10px', width: '100%', height: '50px', boxShadow: '0 1px 1px #1abc9c', lineHeight: '50px', color: '#fff', fontFamily: FONT_STACK }}>
      <div className="container" style={{ width: '90%', maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="header-left" style={{ float: 'left', marginRight: '20px', textAlign: 'left', textShadow: '1px 1px 2px #000', fontSize: '18px' }}>
          <a href="/" style={{ color: '#fff', textDecoration: 'none' }}>格格党</a>
        </div>
        <div className="header-right" style={{ float: 'right', textAlign: 'right', fontSize: '15px' }}>
          <a href="/history.html" style={{ color: '#fff', textDecoration: 'none', marginRight: '8px' }}>阅读历史</a>|
          <a href="/login/" style={{ color: '#fff', textDecoration: 'none', margin: '0 8px' }}>登录</a>|
          <a href="/register" style={{ color: '#fff', textDecoration: 'none', marginLeft: '8px' }}>注册</a>
        </div>
      </div>
    </div>
  )
}

function FengTuiItem({ book }: { book: { id: string; name: string; author: string; intro: string; cover?: string | null; category: string } }) {
  const { navigate } = usePublic()
  return (
    <div className="item" style={{ float: 'left', padding: '10px 0 0', width: '50%', display: 'flex', gap: '10px' }}>
      <div className="image" style={{ float: 'left', marginRight: '10px', width: '120px', flexShrink: 0 }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </a>
      </div>
      <dl style={{ margin: 0, flex: 1, minWidth: 0 }}>
        <dt style={{ overflow: 'hidden', height: '25px', borderBottom: '1px dotted #ccc', fontWeight: 700, fontSize: '15px', lineHeight: '25px' }}>
          <span style={{ float: 'right', fontWeight: 400, fontSize: '14px', color: MUTED }}>{book.author}</span>
          <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: LINK, textDecoration: 'none' }}>{book.name}</a>
        </dt>
        <dd style={{ overflow: 'hidden', padding: '7px 0 0', height: '100px', textIndent: '2em', fontSize: '14px', lineHeight: '24px', color: MUTED, margin: 0 }}>
          {book.intro}
        </dd>
      </dl>
    </div>
  )
}

function GengXinItem({ book }: { book: { id: string; name: string; author: string; latestChapter?: string; category: string; updatedAt?: string } }) {
  const { navigate } = usePublic()
  return (
    <li style={{ overflow: 'hidden', padding: '4px 0', height: '28px', borderBottom: '1px dashed #ccc', fontSize: '14px', lineHeight: '28px', display: 'flex', gap: '10px', listStyle: 'none' }}>
      <span className="s1" style={{ width: '90px', color: MUTED, display: 'inline-block' }}>[{book.category}]</span>
      <span className="s2" style={{ width: '180px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: LINK, textDecoration: 'none' }}>{book.name}</a>
      </span>
      <span className="s3" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: MUTED, textDecoration: 'none' }}>{book.latestChapter || '最新章节'}</a>
      </span>
      <span className="s5" style={{ width: '90px', textAlign: 'right', color: MUTED, display: 'inline-block' }}>{fmtDate(book.updatedAt) || '今天'}</span>
      <span className="s4" style={{ width: '100px', color: MUTED, textAlign: 'right' }}>{book.author}</span>
    </li>
  )
}

function FengYouItem({ book, no }: { book: { id: string; name: string; author: string }; no: number }) {
  const { navigate } = usePublic()
  return (
    <li style={{ overflow: 'hidden', padding: '4px 0', height: '28px', borderBottom: '1px dashed #ccc', fontSize: '14px', lineHeight: '28px', display: 'flex', gap: '8px', listStyle: 'none' }}>
      <span style={{ display: 'inline-block', width: '20px', textAlign: 'center', color: no <= 3 ? '#f50' : MUTED, fontWeight: 700 }}>{no}</span>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ flex: 1, color: LINK, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.name}</a>
      <span style={{ color: MUTED, fontSize: '13px', textAlign: 'right', width: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.author}</span>
    </li>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps): ReactNode {
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh' }}>
        <Header />
        <div style={{ width: '90%', maxWidth: '1200px', margin: '14px auto', padding: '14px' }}>
          <BookGridSkeleton count={8} />
        </div>
      </div>
    )
  }

  const recommend = books.slice(0, 8)
  const latest = books.slice(0, 20)
  const rank = books.slice(0, 15)

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <Header />
      <div className="container" style={{ width: '90%', maxWidth: '1200px', margin: '0 auto' }}>
        <div className="content">
          <div className="content-left" style={{ float: 'left', width: '73%' }}>
            {/* 风推 */}
            <div id="fengtui">
              <h2 style={{ marginTop: '10px', padding: '0 0 10px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: '18px' }}>推荐小说</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                {recommend.map((b) => <FengTuiItem key={b.id} book={b} />)}
              </div>
            </div>
            {/* 最新更新 */}
            <div id="gengxin" style={{ marginTop: '20px' }}>
              <h2 style={{ marginTop: '10px', padding: '0 0 10px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: '18px' }}>最近更新</h2>
              <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
                {latest.map((b) => <GengXinItem key={b.id} book={b} />)}
              </ul>
            </div>
          </div>
          <div className="content-right" id="fengyou" style={{ float: 'right', width: '25%' }}>
            <h2 style={{ marginTop: '10px', padding: '0 0 10px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: '18px' }}>阅读排行榜</h2>
            <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
              {rank.map((b, i) => <FengYouItem key={b.id} book={b} no={i + 1} />)}
            </ul>
          </div>
          <div style={{ clear: 'both' }} />
        </div>
      </div>
      <div className="footer" style={{ padding: '10px 0', backgroundColor: HEADER_BG, boxShadow: '0 -1px 1px #56ccb5', color: '#fff', textAlign: 'center', fontSize: '14px', fontFamily: FONT_STACK, marginTop: '20px' }}>
        <div className="container" style={{ width: '90%', maxWidth: '1200px', margin: '0 auto' }}>
          <p style={{ margin: '5px 0' }}>格格党 - 无弹窗小说阅读网</p>
          <p style={{ margin: '5px 0' }}>Copyright © ggd66.com All Rights Reserved</p>
        </div>
      </div>
    </div>
  )
}
