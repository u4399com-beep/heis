<<<<<<< HEAD
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
=======
// ddyueshu.cc 首页 1:1 克隆 — 使用源站 CSS class 名, 硬编码颜色
// 源站 CSS: /clone-css/ddyueshu.css (biquge.css 模板)
// 源站 DOM: #wrapper > .header + .nav + #main(#hotcontent .l/.r + .novelslist + #newscontent .l/.r) + #firendlink + .footer
// 实测颜色: body bg #E9FAFF / nav bg #88C6E5 / .l bg #FEF9EF border #C3DFEA / a #6F78A7 / .nav a #fff
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'
import { BookCover } from '../../BookCover'

function Skeleton() {
  return (
    <div id="wrapper" style={{ maxWidth: 980, margin: '0 auto', padding: '12px' }}>
      <div style={{ background: '#FEF9EF', border: '3px solid #C3DFEA', borderRadius: 4, padding: 24, marginBottom: 12 }}>
        <div style={{ height: 28, background: '#E1ECED', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 36, background: '#E1ECED', borderRadius: 4 }} />
      </div>
    </div>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 10, homeModuleLimit = 24 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站 .nav 实测导航项 (从 probe-ddyueshu.html 提取)
  const NAV_ITEMS = [
    { name: '首页', href: '/' },
    { name: '我的书架', href: '/modules/article/bookcase.php' },
    { name: '玄幻小说', href: '/xuanhuanxiaoshuo/' },
    { name: '修真小说', href: '/xiuzhenxiaoshuo/' },
    { name: '都市小说', href: '/dushixiaoshuo/' },
    { name: '穿越小说', href: '/chuanyuexiaoshuo/' },
    { name: '网游小说', href: '/wangyouxiaoshuo/' },
    { name: '科幻小说', href: '/kehuanxiaoshuo/' },
    { name: '排行榜', href: '/paihangbang/' },
    { name: '全部小说', href: '/xiaoshuodaquan/' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  // 热搜词 (站内通常搜索词, 风格相符)
  const HOT_SEARCH = ['元尊', '圣墟', '诡秘之主', '斗破苍穹', '完美世界', '大奉打更人', '凡人修仙传', '盗墓笔记', '雪中悍刀行', '剑来']

  const latestBooks = books.slice(0, homeModuleLimit)
  const hotBooks = books.slice(0, 4)
  const rankBooks = books.slice(0, 12)

  // 源站: .novelslist 3 列 (玄幻 / 修真 / 都市) → 用 books 1-3 段填充
  const novelSections = [
    { title: '玄幻小说', items: books.slice(0, 12) },
    { title: '修真小说', items: books.slice(6, 18) },
    { title: '都市小说', items: books.slice(12, 24) },
  ]

  return (
    <div id="wrapper" style={{ background: '#E9FAFF', minHeight: '100%', color: '#555', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12 }}>
      {/* 源站 .ywtop 顶部条 — 设为首页 / 加入收藏 / 登录注册 */}
      <div className="ywtop" style={{ background: '#E1ECED', borderBottom: '1px solid #A6D3E8', color: '#888', height: 28, lineHeight: '28px', width: '100%' }}>
        <div className="ywtop_con" style={{ maxWidth: 980, margin: '0 auto', textIndent: 16, verticalAlign: 'middle', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px' }}>
          <div style={{ display: 'flex', gap: 18 }}>
            <span style={{ color: '#888' }}>设为首页</span>
            <span style={{ color: '#888' }}>加入收藏</span>
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
            <a href="#" style={{ color: '#888', textDecoration: 'none' }}>登陆</a>
            <a href="#" style={{ color: '#888', textDecoration: 'none' }}>注册</a>
          </div>
        </div>
      </div>

      {/* 源站 .header — logo + 搜索框 */}
      <div className="header" style={{ height: 61, width: 980, maxWidth: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', padding: '0 14px', flexWrap: 'wrap' }}>
        <div className="header_logo" style={{ flexShrink: 0, marginRight: 24 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ display: 'inline-block', fontSize: 24, fontWeight: 700, color: '#1f6cb2', textDecoration: 'none' }}>
            {site.name}
          </a>
        </div>
        <div className="header_search" style={{ flex: 1, minWidth: 260, maxWidth: 470, margin: '8px 0' }}>
          <form style={{ display: 'flex', width: '100%', height: 32, borderRadius: 2, border: '2px solid #88C6E5', overflow: 'hidden', position: 'relative' }} onSubmit={(e) => e.preventDefault()}>
            <input
              type="text"
              name="searchkey"
              placeholder="可搜索小说名/作者名"
              style={{ flex: 1, height: '100%', padding: '0 8px', border: 'none', outline: 'none', fontSize: 14, background: '#fff', color: '#333' }}
            />
            <button
              type="submit"
              style={{ width: 80, height: '100%', border: 'none', background: '#88C6E5', color: '#fff', fontSize: 16, cursor: 'pointer' }}
            >
              搜索
            </button>
          </form>
        </div>
      </div>

      {/* 源站 .nav — 蓝底导航条 */}
      <div className="nav" style={{ background: '#88C6E5', height: 40, width: 980, maxWidth: '100%', margin: '10px auto 0', overflow: 'hidden', padding: '0 14px' }}>
        <ul style={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: 0 }}>
          {visibleNav.map((item, i) => (
            <li key={item.name} style={{ lineHeight: '40px' }}>
              <a
                href={item.href}
                onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
                style={{
                  display: 'inline-block',
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 700,
                  padding: '0 14px',
                  textDecoration: 'none',
                  background: i === 0 ? 'rgba(255,255,255,0.18)' : 'transparent',
                }}
              >
                {item.name}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* 源站 #main 容器 */}
      <div id="main" style={{ width: 980, maxWidth: '100%', margin: '0 auto', padding: '0 14px' }}>
        {/* 源站 #hotcontent — 左 4 推荐大图 + 右侧"最强推荐"小列表 */}
        <div id="hotcontent" style={{ paddingTop: 10 }}>
          <div className="l" style={{ background: '#FEF9EF', border: '3px solid #C3DFEA', borderRadius: 4, padding: '0 0 10px', marginBottom: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {hotBooks.map((b) => (
              <div key={b.id} className="item" style={{ display: 'flex', gap: 10, padding: '10px 0 0 10px' }}>
                <div className="image" style={{ flexShrink: 0, width: 120 }}>
                  <div style={{ width: 120, height: 150, border: '1px solid #DDD', background: '#fff', padding: 1 }}>
                    <BookCover name={b.name} cover={b.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
                  </div>
                </div>
                <dl style={{ flex: 1, minWidth: 0, margin: 0, paddingRight: 5 }}>
                  <dt style={{ borderBottom: '1px dotted #A6D3E8', fontSize: 14, fontWeight: 700, height: 25, lineHeight: '25px', overflow: 'hidden', display: 'flex', justifyContent: 'space-between' }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#6F78A7', textDecoration: 'none' }}>{b.name}</a>
                    <span style={{ color: '#B3B3B3', fontWeight: 400, fontSize: 12 }}>{b.category}</span>
                  </dt>
                  <dd style={{ height: 120, lineHeight: '20px', overflow: 'hidden', textIndent: '2em', paddingTop: 7, color: '#555', margin: 0, fontSize: 12 }}>
                    {b.intro || '暂无简介'}
                  </dd>
                </dl>
                <div className="clear" style={{ clear: 'both' }} />
              </div>
            ))}
          </div>

          <div className="r" style={{ background: '#FEF9EF', border: '3px solid #C3DFEA', borderRadius: 4, padding: 0, marginBottom: 10 }}>
            <h2 style={{ background: '#E1ECED', borderBottom: '1px solid #DDD', fontSize: 14, fontWeight: 700, height: 30, lineHeight: '30px', margin: 0, padding: '0 0 0 10px', color: '#555' }}>
              最强推荐
            </h2>
            <ul style={{ listStyle: 'none', padding: 10, margin: 0 }}>
              {rankBooks.map((b, i) => (
                <li key={b.id} style={{ borderBottom: '1px solid #DDDDDD', height: 28, lineHeight: '28px', overflow: 'hidden', padding: '5px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 40, color: '#1f6cb2', fontSize: 12, flexShrink: 0 }}>
                    [{b.category?.slice(0, 2) || '推荐'}]
                  </span>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ flex: 1, color: '#6F78A7', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {b.name}
                  </a>
                  <span style={{ color: '#B3B3B3', fontSize: 12, textAlign: 'right' }}>{i < 3 ? '热' : '荐'}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 源站 .novelslist — 3 列分类区块 */}
        {novelSections.map((sec) => (
          <div key={sec.title} className="novelslist" style={{ margin: '12px auto', border: '3px solid #A6D3E8', borderRadius: 4, padding: 3, background: '#FEF9EF' }}>
            <div className="content" style={{ padding: '0 6px' }}>
              <h2 style={{ borderBottom: '1px solid #A6D3E8', fontSize: 14, fontWeight: 700, padding: '0 0 0 5px', lineHeight: '25px', height: 25, margin: 0, overflow: 'hidden', color: '#555' }}>
                {sec.title}
              </h2>
              <div style={{ display: 'flex', gap: 10, padding: '8px 0' }}>
                {sec.items[0] && (
                  <div className="top" style={{ display: 'flex', gap: 8, flex: '0 0 200px', alignItems: 'flex-start' }}>
                    <div className="image" style={{ width: 71, flexShrink: 0, padding: '8px 0 0 5px' }}>
                      <div style={{ width: 67, height: 82, border: '1px solid #DDDDDD', padding: 1, background: '#fff' }}>
                        <BookCover name={sec.items[0].name} cover={sec.items[0].cover} className="w-full h-full" style={{ borderRadius: 0 }} />
                      </div>
                    </div>
                    <dl style={{ flex: 1, margin: 0, paddingTop: 10, minWidth: 0 }}>
                      <dt style={{ height: 25, lineHeight: '25px', overflow: 'hidden', fontWeight: 700, fontSize: 13 }}>
                        <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: sec.items[0].id }) }} style={{ color: '#6F78A7', textDecoration: 'none' }}>{sec.items[0].name}</a>
                      </dt>
                      <dd style={{ lineHeight: '20px', height: 60, overflow: 'hidden', margin: 0, color: '#555', fontSize: 12 }}>
                        {sec.items[0].intro || '暂无简介'}
                      </dd>
                    </dl>
                  </div>
                )}
                <ul style={{ flex: 1, listStyle: 'none', padding: '8px 0 0 0', margin: 0, minWidth: 0 }}>
                  {sec.items.slice(1, 11).map((b) => (
                    <li key={b.id} style={{ color: '#B3B3B3', height: 20, lineHeight: '20px', fontSize: 12, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#6F78A7', textDecoration: 'none', fontSize: 13 }}>
                        《{b.name}》
                      </a>
                      <span style={{ color: '#B3B3B3', marginLeft: 4 }}>/ {b.author}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}

        {/* 源站 #newscontent — 左最近更新表格 + 右最近入库列表 */}
        <div id="newscontent" style={{ margin: '12px auto', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="l" style={{ flex: '1 1 320px', border: '3px solid #88C6E5', background: '#E1ECED', borderRadius: 4, minWidth: 0 }}>
            <h2 style={{ margin: 0, overflow: 'hidden', padding: '0 0 0 10px', background: '#A6D3E8', height: 30, lineHeight: '30px', fontSize: 14, fontWeight: 700, borderBottom: '1px solid #DDD', color: '#fff' }}>
              最新更新小说列表
            </h2>
            <ul style={{ listStyle: 'none', padding: 10, margin: 0, background: '#E1ECED' }}>
              {latestBooks.map((b) => (
                <li key={b.id} style={{ padding: '5px 0 0 0', borderBottom: '1px solid #DDDDDD', height: 25, lineHeight: '25px', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span className="s1" style={{ width: 75, color: '#1f6cb2', flexShrink: 0 }}>[{b.category}]</span>
                  <span className="s2" style={{ width: 165, flexShrink: 0, overflow: 'hidden' }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#6F78A7', textDecoration: 'none' }}>{b.name}</a>
                  </span>
                  <span className="s3" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, color: '#555' }}>
                    {b.latestChapter || '暂无章节'}
                  </span>
                  <span className="s4" style={{ color: '#B3B3B3', width: 90, textAlign: 'right', flexShrink: 0 }}>{b.author}</span>
                  <span className="s5" style={{ color: '#B3B3B3', flexShrink: 0, textAlign: 'right' }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="r" style={{ flex: '0 0 265px', border: '3px solid #88C6E5', background: '#E1ECED', borderRadius: 4, minWidth: 240 }}>
            <h2 style={{ margin: 0, overflow: 'hidden', padding: '0 0 0 10px', background: '#A6D3E8', height: 30, lineHeight: '30px', fontSize: 14, fontWeight: 700, borderBottom: '1px solid #DDD', color: '#fff' }}>
              最近入库小说
            </h2>
            <ul style={{ listStyle: 'none', padding: 10, margin: 0 }}>
              {rankBooks.map((b) => (
                <li key={b.id} style={{ padding: '5px 0 0 0', borderBottom: '1px solid #DDDDDD', height: 25, lineHeight: '25px', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span className="s1" style={{ width: 40, color: '#1f6cb2', flexShrink: 0 }}>[{b.category?.slice(0, 2) || '小说'}]</span>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ flex: 1, color: '#6F78A7', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name}
                  </a>
                  <span className="s5" style={{ color: '#B3B3B3', flexShrink: 0 }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 源站 #firendlink */}
        <div id="firendlink" style={{ border: '1px solid #DDD', lineHeight: '22px', margin: '10px auto', padding: '9px 0 9px 9px', color: '#555' }}>
          <strong>友情链接：</strong>
          {HOT_SEARCH.map((kw) => (
            <a
              key={kw}
              href="javascript:;"
              onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: kw }) }}
              style={{ color: '#548161', display: 'inline-block', margin: '0 9px 0 0', textDecoration: 'none', fontSize: 12 }}
            >
              {kw}
            </a>
          ))}
          <span style={{ color: '#888' }}>(更多链接)</span>
        </div>
      </div>

      {/* 源站 .footer */}
      <div className="footer" style={{ textAlign: 'center', margin: '10px auto 0', padding: '16px 14px', color: '#555', fontSize: 12 }}>
        <div style={{ marginBottom: 6 }}>
          <a href="#" style={{ color: '#6F78A7', textDecoration: 'none', margin: '0 6px' }}>网站地图</a>
          <span style={{ color: '#B3B3B3' }}>·</span>
          <a href="#" style={{ color: '#6F78A7', textDecoration: 'none', margin: '0 6px' }}>关于我们</a>
          <span style={{ color: '#B3B3B3' }}>·</span>
          <a href="#" style={{ color: '#6F78A7', textDecoration: 'none', margin: '0 6px' }}>免责声明</a>
          <span style={{ color: '#B3B3B3' }}>·</span>
          <a href="#" style={{ color: '#6F78A7', textDecoration: 'none', margin: '0 6px' }}>联系方式</a>
        </div>
        <div style={{ color: '#B3B3B3' }}>
          Copyright © {new Date().getFullYear()} {site.name} · {site.domain} · {formatWords(books.reduce((s, b) => s + (b.wordCount || 0), 0))}小说
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
        </div>
      </div>
    </div>
  )
}
