// ============================================================
// clone-themes/shipsay — 船说CMS demo.shipsay.com 1:1 真克隆
// 实测 probe-html2/probe-shipsay.{html,css} (shipsay.css, 18.5KB)
// 硬编码源站实际 CSS 变量值 (不用 theme.vars):
//   body { color:#666; font-size:14px; background:#f4f4f4; font-family:"微软雅黑", "Microsoft Yahei", Arial, Tahoma, Verdana, sans-serif }
//   a { color:#1a1a1a; text-decoration:none; }
//   a:hover, .hot, .act * { color:#ed4259; }   /* hover 红色 */
//   .fullflag { color:#fff; background:#ed4259; border:1px solid #ed4259; }
//   .red { color:#bf2c24 } / .blue { color:#4284ed } / .orange { color:#f0643a }
//   .container { max-width:960px; margin:0 auto; display:flex; flex-flow:wrap; }
//   .navigation bg #3e3d43 / nav a color #fbfbfb height 41px line-height 41px padding 0 20px
//   nav a:hover { color:#fbfbfb; border-top:2px solid #ed4259; background:#252428; line-height:37px; }
//   .side_commend bg #fff, padding 10px 10px 5px, width 700px
//   .side_commend li width 49%, margin 10px 6px 18px 0
//   .side_commend img 100x133, hover transform scale(1.1)
//   aside width 250px, margin-left 10px, bg #fff
//   .popular li flex space-between, height 41px, border-bottom 1px dotted #e6e6e6
//   .sortvisit width 312px
//   .lastupdate width 700px
//   #footer bg #3e3d43, color #fbfbfb
// DOM 结构:
//   header > .container.head (logo + form.search + .header_right icons 首页/书库/完本/足迹)
//   .navigation > nav.container > a (8 分类: 首页/玄幻/武侠/都市/历史/科幻/游戏/女生/其他)
//   .container > .side_commend.side_commend_width (700px) > p.title + ul.flex (6 大神小说宽卡)
//     li: .img_span > a > img + span(category/status) + .w100 > a > h2 + p.indent + .li_bottom
//   .container > aside (250px) > .popular > p.title + ul.popular > li (book + author.gray)
//   .container > .section.flex > 8 .sortvisit (312px each, 3 per row) > a (cat name) + ul (1 大卡 + 12 链表)
//   .container > .lastupdate (700px) > p.title + ul.odd (最新章节 4 列: 类别/书名/章节/作者+时间)
//   .container > .section.link (友情链接)
//   #footer > footer.container (站点信息)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { BookGridSkeleton } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { HomeCloneProps } from '../shared-props'
import type { ReactNode } from 'react'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", Arial, Tahoma, Verdana, sans-serif'
const BG = '#f4f4f4'
const INK = '#666666'
const MUTED = '#969ba3'
const LINK = '#1a1a1a'
const PRIMARY = '#ed4259'
const NAV_BG = '#3e3d43'
const CARD_BG = '#ffffff'
const BORDER = '#e0e0e0'

const NAV_ITEMS = ['首页', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生', '其他']

function Header() {
  return (
    <header style={{ background: CARD_BG, borderBottom: `1px solid ${BORDER}` }}>
      <div className="container head" style={{ maxWidth: '960px', margin: '0 auto', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <a href="/" style={{ color: PRIMARY, fontSize: '24px', fontWeight: 700, textDecoration: 'none' }}>船说CMS</a>
        <form name="t_frmsearch" style={{ flex: 1, display: 'flex', minWidth: '240px' }} onSubmit={(e) => e.preventDefault()}>
          <input id="searchkey" type="text" name="searchkey" className="search_input" placeholder="猫腻" style={{ flex: 1, height: '36px', padding: '0 12px', border: `1px solid ${BORDER}`, fontSize: '14px' }} />
          <button type="submit" id="search_btn" title="搜索" style={{ background: PRIMARY, color: '#fff', border: 'none', padding: '0 14px', cursor: 'pointer', fontSize: '14px' }}>搜索</button>
        </form>
        <div className="header_right" style={{ display: 'flex', gap: '14px' }}>
          <a href="javascript:;" style={{ color: LINK, fontSize: '12px', textDecoration: 'none', textAlign: 'center' }}>🏠<br />首页</a>
          <a href="javascript:;" style={{ color: LINK, fontSize: '12px', textDecoration: 'none', textAlign: 'center' }}>📚<br />书库</a>
          <a href="javascript:;" style={{ color: LINK, fontSize: '12px', textDecoration: 'none', textAlign: 'center' }}>☕<br />完本</a>
          <a href="javascript:;" style={{ color: LINK, fontSize: '12px', textDecoration: 'none', textAlign: 'center' }}>📖<br />足迹</a>
        </div>
      </div>
    </header>
  )
}

function Navigation() {
  const { navigate } = usePublic()
  return (
    <div className="navigation" style={{ background: NAV_BG }}>
      <nav className="container" style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', height: '41px' }}>
        {NAV_ITEMS.map((n, i) => (
          <a key={n} href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: '#fbfbfb', lineHeight: '41px', padding: '0 20px', fontSize: '14px', textDecoration: 'none', display: 'inline-block' }}>{n}</a>
        ))}
      </nav>
    </div>
  )
}

function BigCard({ book }: { book: { id: string; name: string; author: string; intro: string; cover?: string | null; category: string; wordCount?: number; updatedAt?: string; status?: string } }) {
  const { navigate } = usePublic()
  return (
    <li style={{ width: '49%', margin: '10px 6px 18px 0', display: 'flex', gap: '10px', listStyle: 'none' }}>
      <div className="img_span" style={{ position: 'relative', width: '100px', flexShrink: 0 }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </a>
        <span style={{ position: 'absolute', top: '108px', left: 0, background: 'rgba(0,0,0,.4)', color: '#fff', width: '100px', height: '25px', lineHeight: '25px', textAlign: 'center', fontSize: '12px' }}>{book.category} / {book.status === 'completed' ? '完本' : '连载'}</span>
      </div>
      <div className="w100" style={{ flex: 1, minWidth: 0 }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }}>
          <h2 style={{ fontSize: '16px', height: '24px', lineHeight: '24px', color: LINK, margin: 0 }}>{book.name}</h2>
        </a>
        <p className="indent" style={{ margin: '4px 0', fontSize: '12px', color: MUTED, lineHeight: '1.7', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.intro}</p>
        <div className="li_bottom" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
          <a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ fontSize: '12px', color: LINK, textDecoration: 'none' }}>👤 {book.author}</a>
          <div style={{ display: 'flex', gap: '4px' }}>
            <em className="orange" style={{ color: '#f0643a', border: '1px solid #ccc', padding: '0 4px', fontSize: '11px', fontStyle: 'normal' }}>{formatWords(book.wordCount)}</em>
            <em className="blue" style={{ color: '#4284ed', border: '1px solid #ccc', padding: '0 4px', fontSize: '11px', fontStyle: 'normal' }}>{fmtDate(book.updatedAt) || ''}</em>
          </div>
        </div>
      </div>
    </li>
  )
}

function PopularItem({ book, no }: { book: { id: string; name: string; author: string }; no: number }) {
  const { navigate } = usePublic()
  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '41px', borderBottom: '1px dotted #e6e6e6', listStyle: 'none', padding: '0 6px' }}>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: no <= 3 ? PRIMARY : LINK, fontSize: '14px', textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: no <= 3 ? PRIMARY : MUTED, fontWeight: 700, marginRight: '6px' }}>{no}</span>
        {book.name}
      </a>
      <a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} className="gray" style={{ color: MUTED, fontSize: '12px', textDecoration: 'none', flexShrink: 0 }}>{book.author}</a>
    </li>
  )
}

function SortVisitItem({ book }: { book: { id: string; name: string; author: string; intro: string; cover?: string | null; category: string; wordCount?: number } }) {
  const { navigate } = usePublic()
  return (
    <li style={{ width: '50%', height: '38px', lineHeight: '38px', borderBottom: '1px dashed #ccc', listStyle: 'none', padding: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: LINK, fontSize: '14px', textDecoration: 'none' }}>{book.name}</a>
    </li>
  )
}

function LastUpdateItem({ book }: { book: { id: string; name: string; author: string; latestChapter?: string; category: string; updatedAt?: string } }) {
  const { navigate } = usePublic()
  return (
    <li style={{ display: 'flex', alignItems: 'center', height: '41px', borderBottom: '1px dotted #e6e6e6', listStyle: 'none' }}>
      <span style={{ width: '9%', color: PRIMARY, fontSize: '13px' }}>「{book.category}」</span>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ width: '25%', color: LINK, fontSize: '13px', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.name}</a>
      <a href="javascript:;" onClick={() => navigate({ view: 'book', bookId: book.id })} className="gray" style={{ width: '41%', color: MUTED, fontSize: '13px', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.latestChapter || '最新章节'}</a>
      <span style={{ width: '25%', textAlign: 'right', color: MUTED, fontSize: '12px' }}>
        <a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} className="gray" style={{ color: MUTED, textDecoration: 'none' }}>{book.author}</a>
        &nbsp;&nbsp;{fmtDate(book.updatedAt) || '今天'}
      </span>
    </li>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps): ReactNode {
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh' }}>
        <Header />
        <Navigation />
        <div style={{ maxWidth: '960px', margin: '14px auto', padding: '14px' }}>
          <BookGridSkeleton count={8} />
        </div>
      </div>
    )
  }

  const bigBooks = books.slice(0, 6)
  const popular = books.slice(0, 16)
  const sortvisit = books.slice(0, 24)
  const lastupdate = books.slice(0, 20)

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <Header />
      <Navigation />
      <div className="container" style={{ maxWidth: '960px', margin: '10px auto', padding: '0 10px', display: 'flex', flexFlow: 'wrap', gap: '10px' }}>
        {/* 大神小说 */}
        <div className="side_commend side_commend_width" style={{ background: CARD_BG, padding: '10px 10px 5px', width: '700px', flex: '1 1 700px' }}>
          <p className="title" style={{ color: LINK, fontSize: '14px', fontWeight: 700, padding: '4px 0', borderBottom: `1px solid ${BORDER}`, margin: '0 0 10px' }}>👍 大神小说</p>
          <ul className="flex" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', listStyle: 'none', margin: 0, padding: 0 }}>
            {bigBooks.map((b) => <BigCard key={b.id} book={b} />)}
          </ul>
        </div>
        {/* 热门小说 aside */}
        <aside style={{ width: '250px', flexShrink: 0, background: CARD_BG, padding: '10px 10px 5px' }}>
          <p className="title" style={{ color: LINK, fontSize: '14px', fontWeight: 700, padding: '4px 0', borderBottom: `1px solid ${BORDER}`, margin: '0 0 10px' }}>🔥 热门小说</p>
          <ul className="popular odd" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {popular.map((b, i) => <PopularItem key={b.id} book={b} no={i + 1} />)}
          </ul>
        </aside>
        {/* 分类列表 */}
        <div className="section flex" style={{ width: '100%', background: CARD_BG, padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {['玄幻魔法', '武侠修真', '都市言情', '历史军事', '科幻灵异', '游戏竞技'].map((cat, i) => (
            <div key={cat} className="sortvisit" style={{ width: '312px', flex: '1 1 312px' }}>
              <a href="javascript:;" style={{ color: '#555', fontWeight: 700, borderBottom: '1px solid #ddd', display: 'block', padding: '6px 0' }}>{cat}</a>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap' }}>
                {sortvisit.slice(i * 4, (i + 1) * 4).map((b) => <SortVisitItem key={b.id} book={b} />)}
              </ul>
            </div>
          ))}
        </div>
        {/* 最新章节 */}
        <div className="lastupdate" style={{ width: '700px', flex: '1 1 700px', background: CARD_BG, padding: '10px' }}>
          <p className="title" style={{ color: LINK, fontSize: '14px', fontWeight: 700, padding: '4px 0', borderBottom: `1px solid ${BORDER}`, margin: '0 0 10px' }}>🕐 最新章节</p>
          <ul className="odd" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {lastupdate.map((b) => <LastUpdateItem key={b.id} book={b} />)}
          </ul>
        </div>
      </div>
      <div id="footer" style={{ background: NAV_BG, color: '#fbfbfb', marginTop: '20px' }}>
        <footer className="container" style={{ maxWidth: '960px', margin: '0 auto', padding: '20px 14px', textAlign: 'center', fontSize: '13px' }}>
          <p style={{ margin: '0 0 6px' }}>🚩 <a href="/" style={{ color: '#fbfbfb', textDecoration: 'none' }}>船说CMS</a> 书友最值得收藏的网络小说阅读网</p>
          <p style={{ margin: 0 }}><a href="javascript:;" style={{ color: '#fbfbfb', textDecoration: 'none' }}>简体版</a> · <a href="javascript:;" style={{ color: '#fbfbfb', textDecoration: 'none' }}>繁體版</a></p>
        </footer>
      </div>
    </div>
  )
}
