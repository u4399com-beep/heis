<<<<<<< HEAD
// ============================================================
// clone-themes/101kks — 101看書 101kks.com 1:1 真克隆
// 实测 probe-html2/probe-101kks.{html,css} (cdnshu 模板, 4306 行 CSS)
// 硬编码源站实际 CSS 变量值 (不用 theme.vars):
//   body { background:#f2f3f4; color:#333; font-size:14px; font-family:"Microsoft YaHei"; }
//   a { color:#666; }
//   header { background:#fff2df; }  /* 米黄头 */
//   .headbox { max-width:1250px; }
//   .booklist-card { background:#fff; border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,0.08); border:1px solid rgba(0,0,0,0.06); height:128px; }
//   .booklist-cover-section { background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); }  /* 蓝紫渐变 */
//   .booklist-title { font-size:14px; font-weight:600; color:#2c3e50; }
//   .booklist-meta { color:#7f8c8d; font-size:12px; }
//   .bookimg { width:48px; height:64px; float:left; margin-right:10px; }
// DOM 结构:
//   .leftmenu (左侧抽屉) + header (headbox: menubtn+logo+search+menu1+lang) + .main (.container)
//   .main > .container > .adbanner + .row.col-xinindex (搜索+书单卡)
//   + .booklist-grid (booklist-card list)
//   + .mybox (block_booklist)
//   footer (站内信息)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { BookGridSkeleton } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { HomeCloneProps } from '../shared-props'
import type { ReactNode } from 'react'

const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif'
const BG = '#f2f3f4'
const INK = '#333333'
const MUTED = '#7f8c8d'
const LINK = '#666666'
const HEADER_BG = '#fff2df'
const PRIMARY = '#667eea'
const ACCENT = '#764ba2'
const BORDER = 'rgba(0,0,0,0.06)'
const RADIUS = '10px'

const NAV_ITEMS = ['首頁', '排行榜', '完本小說', '小說分類', '我的書架', '閱讀記錄']

function Header() {
  return (
    <header style={{ background: HEADER_BG, padding: '12px 14px' }}>
      <div className="headbox clearfix" style={{ maxWidth: '1250px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <div className="logo" style={{ flexShrink: 0 }}>
          <a href="/" style={{ color: PRIMARY, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>101看書</a>
        </div>
        <div className="search" style={{ flex: 1, minWidth: '260px', display: 'flex' }}>
          <input id="searchkey" className="searchinput" type="text" placeholder="請輸入書名或作者" style={{ flex: 1, height: '40px', padding: '0 12px', border: 'none', borderRadius: '8px', fontSize: '14px' }} />
          <button id="searchbtn" style={{ background: PRIMARY, color: '#fff', border: 'none', padding: '0 18px', fontSize: '14px', cursor: 'pointer', borderRadius: '8px' }}>搜索</button>
        </div>
        <div className="lang" style={{ display: 'flex', gap: '6px', fontSize: '13px', color: LINK }}>
          <a href="javascript:;" style={{ color: LINK, textDecoration: 'none' }}>繁體</a>
          <span>|</span>
          <a href="javascript:;" style={{ color: LINK, textDecoration: 'none' }}>簡體</a>
        </div>
      </div>
      <div className="menu1" style={{ maxWidth: '1250px', margin: '8px auto 0' }}>
        <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', listStyle: 'none', margin: 0, padding: 0 }}>
          {NAV_ITEMS.map((n, i) => (
            <li key={n}>
              <a href="javascript:;" style={{ color: i === 0 ? PRIMARY : LINK, fontSize: '14px', textDecoration: 'none', fontWeight: i === 0 ? 700 : 400 }}>{n}</a>
            </li>
          ))}
        </ul>
      </div>
    </header>
  )
}

function BookCard({ book }: { book: { id: string; name: string; author: string; intro: string; cover?: string | null; category: string; wordCount?: number; updatedAt?: string } }) {
  const { navigate } = usePublic()
  // R15-1C a11y fix: 原 <div onClick> 不可键盘可达(Tab 跳过/屏读器不识别为可点击);
  // 改为 <a href> + onClick preventDefault, 与 huangjinwu/23qb 等其它 9 套主题统一模式
  return (
    <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} className="booklist-card" style={{ background: '#fff', borderRadius: RADIUS, boxShadow: '0 2px 10px rgba(0,0,0,0.08)', border: `1px solid ${BORDER}`, padding: '14px', display: 'flex', gap: '12px', cursor: 'pointer', minHeight: '128px', textDecoration: 'none', color: INK }}>
      <div className="booklist-cover-section" style={{ width: '60px', height: '80px', background: `linear-gradient(135deg, ${PRIMARY} 0%, ${ACCENT} 100%)`, borderRadius: '6px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <BookCover name={book.name} cover={book.cover} className="book-cover" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="booklist-title" style={{ fontSize: '14px', fontWeight: 600, color: '#2c3e50', lineHeight: 1.3, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.name}</div>
        <div className="booklist-meta" style={{ display: 'flex', gap: '12px', fontSize: '12px', color: MUTED, marginBottom: '6px' }}>
          <span>{book.author}</span>
          <span>· {book.category}</span>
          <span>· {formatWords(book.wordCount)}</span>
          <span>· {fmtDate(book.updatedAt) || ''}</span>
        </div>
        <div style={{ fontSize: '13px', color: MUTED, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.intro}</div>
      </div>
    </a>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps): ReactNode {
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh' }}>
        <Header />
        <div style={{ maxWidth: '1250px', margin: '14px auto', padding: '14px' }}>
          <BookGridSkeleton count={8} />
        </div>
      </div>
    )
  }

  const latest = books.slice(0, 12)
  const hot = books.slice(12, 24)

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <Header />
      <div className="main" style={{ maxWidth: '1250px', margin: '0 auto', padding: '14px' }}>
        <div className="adbanner mybox" style={{ marginBottom: '14px', background: '#fff', borderRadius: RADIUS, padding: '10px 14px', border: `1px solid ${BORDER}`, fontSize: '13px', color: MUTED }}>
          請記住我們的域名：<strong style={{ color: PRIMARY }}>101kks.com</strong> · 無廣告彈窗 · 全免費繁體小說網
        </div>

        <section style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ display: 'inline-block', width: '4px', height: '20px', background: PRIMARY, borderRadius: '2px' }} />
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#2c3e50' }}>最近更新</h2>
          </div>
          <div className="booklist-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: '12px' }}>
            {latest.map((b) => <BookCard key={b.id} book={b} />)}
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ display: 'inline-block', width: '4px', height: '20px', background: ACCENT, borderRadius: '2px' }} />
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#2c3e50' }}>熱門推薦</h2>
          </div>
          <div className="booklist-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: '12px' }}>
            {hot.map((b) => <BookCard key={b.id} book={b} />)}
          </div>
        </section>
      </div>
      <footer style={{ background: '#fff', borderTop: `1px solid ${BORDER}`, padding: '20px 14px', textAlign: 'center', color: MUTED, fontSize: '13px' }}>
        Copyright © 101看書 All Rights Reserved<br />
        本站所有小說均轉載自網絡，版權歸原作者所有
      </footer>
=======
// 101kks.com (101看書) 首页 1:1 克隆 — cdnshu 模板 (繁體中文站点)
// 源站 CSS: /clone-css/101kks.css (style.css + block_booklist.css)
// 源站 DOM: header (.headbox .menubtn + .logo + .search + .menu1) > .main.container (.adbanner + .col-xinindex > .mybox .xinlogo + .searchBox + .indexdaohang + .booklist-block) > .foot
// 实测颜色: header bg #1f6cb2 (蓝色) / body bg #f2f3f4 / .indexdaohang li bg #1f6cb2 / .mybox bg #fff / cookie-container bg #1f6cb2
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'
import { BookCover } from '../../BookCover'

function Skeleton() {
  return (
    <div style={{ maxWidth: 1112, margin: '0 auto', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 3, padding: 24, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)' }}>
        <div style={{ height: 28, background: '#f5f5f5', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 36, background: '#f5f5f5', borderRadius: 4 }} />
      </div>
    </div>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 6, homeModuleLimit = 24 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站 .menu1 ul 实测导航项 (probe-101kks.html, 繁体)
  const NAV_ITEMS = [
    { name: '首頁', href: '/' },
    { name: '排行', href: '/novels/hot' },
    { name: '完本', href: '/novels/full' },
    { name: '分類', href: '/novels/class' },
    { name: '我的書架', href: '/bookcase' },
    { name: '閱讀記錄', href: '/history' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  const latestBooks = books.slice(0, homeModuleLimit)
  const hotBooks = books.slice(0, 12)

  return (
    <div style={{ background: '#f2f3f4', color: '#333', fontFamily: '"Microsoft YaHei", sans-serif', fontSize: 14, minHeight: '100%' }}>
      {/* 源站 header — fixed 蓝色顶栏 */}
      <header style={{ background: '#1f6cb2', color: '#fff', height: 75, width: '100%', position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="headbox clearfix" style={{ maxWidth: 1250, padding: '0 15px', margin: '0 auto', display: 'flex', alignItems: 'center', height: 75, gap: 16 }}>
          <div className="logo" style={{ display: 'flex', alignItems: 'center', height: 75, flexShrink: 0 }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ fontSize: 25, color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
              {site.name}
            </a>
          </div>
          {/* 搜索框 */}
          <form action="/search" method="post" onSubmit={(e) => e.preventDefault()} style={{ flex: 1, padding: '19px 20px', maxWidth: 460, minWidth: 200 }}>
            <div className="search" style={{ display: 'flex', alignItems: 'center', height: 36 }}>
              <i style={{ display: 'block', borderLeft: '1px solid #fff', fontSize: 18, lineHeight: '36px', textAlign: 'center', width: 50, color: '#fff' }}>🔍</i>
              <div className="inputbox" style={{ flex: 1 }}>
                <input
                  type="text"
                  name="searchkey"
                  placeholder="請輸入搜索內容！"
                  style={{ width: '100%', height: 36, background: 'transparent', border: 'none', textIndent: 12, color: '#fff', fontSize: 16, outline: 'none' }}
                />
              </div>
            </div>
          </form>
          {/* 导航菜单 */}
          <nav className="menu1" style={{ flexShrink: 0 }}>
            <ul style={{ display: 'flex', height: 75, alignItems: 'center', listStyle: 'none', padding: 0, margin: 0, gap: 4 }}>
              {visibleNav.map((item, i) => (
                <li key={item.name}>
                  <a
                    href={item.href}
                    onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
                    style={{
                      color: '#fff',
                      borderRadius: 5,
                      lineHeight: '32px',
                      display: 'block',
                      fontSize: 16,
                      padding: '0 15px',
                      textDecoration: 'none',
                      background: i === 0 ? 'rgba(255,255,255,0.2)' : 'transparent',
                    }}
                  >
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      {/* 源站 .main.container */}
      <div className="main">
        <div className="container" style={{ maxWidth: 1112, margin: '16px auto', minHeight: 300, padding: '0 15px', boxSizing: 'border-box' }}>
          {/* 源站 .adbanner — 域名提示横幅 */}
          <div className="adbanner mybox" style={{ marginBottom: 0, background: '#fff', borderRadius: 3, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)' }}>
            <div className="headerad" style={{ textAlign: 'center', color: '#1f6cb2', fontSize: 14, fontWeight: 700 }}>
              歡迎訪問 {site.name} · 請記住我們的域名：{site.domain}
            </div>
          </div>

          {/* 源站 .col-xinindex — 中部主体 */}
          <ul className="row" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li className="col-xinindex" style={{ width: '100%' }}>
              <div className="mybox" style={{ background: '#fff', borderRadius: 3, padding: 16, margin: '24px 0', boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)' }}>
                {/* logo */}
                <div className="xinlogo" style={{ maxWidth: 300, fontSize: 35, margin: '40px auto', fontWeight: 550, textAlign: 'center', color: '#1f6cb2' }}>
                  {site.name}
                </div>

                {/* 中央搜索框 */}
                <div className="searchBox" style={{ maxWidth: 600, margin: '0 auto 24px', textAlign: 'center' }}>
                  <form onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="searchkey"
                      className="searchinput"
                      autoComplete="off"
                      type="text"
                      placeholder="請輸入小說名/作者名"
                      style={{ flex: 1, height: 40, padding: '0 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, outline: 'none' }}
                    />
                    <button type="submit" id="searchbtn" style={{ width: 80, height: 40, background: '#1f6cb2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 16 }}>搜</button>
                  </form>
                </div>

                {/* 快捷入口 (我的書架/閱讀記錄/排行榜/完本小說) */}
                <div className="indexdaohang" style={{ textAlign: 'center', marginBottom: 20 }}>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
                    {[
                      { name: '我的書架', href: '/bookcase' },
                      { name: '閱讀記錄', href: '/history' },
                      { name: '排行榜', href: '/novels/hot' },
                      { name: '完本小說', href: '/novels/full' },
                    ].map((it) => (
                      <li key={it.name} style={{ background: '#1f6cb2', width: 140, height: 50, display: 'inline-block', borderRadius: 10, lineHeight: '50px', margin: '0.5rem', cursor: 'pointer' }}>
                        <a
                          href={it.href}
                          onClick={(e) => { e.preventDefault(); if (it.href === '/novels/hot') navigate({ view: 'home' }) }}
                          style={{ color: '#f6f6f6', textDecoration: 'none', display: 'block', height: '100%' }}
                        >
                          <h3 className="ellipsis_1" style={{ fontSize: 16, color: '#f6f6f6', fontWeight: 500, margin: 0, lineHeight: '50px' }}>
                            {it.name}
                          </h3>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 热门书单推荐 */}
                <div>
                  <h3 className="mytitle" style={{ margin: '0 0 10px', borderBottom: '1px solid rgba(150,150,150,0.2)', paddingBottom: 5, fontSize: 16, color: '#333' }}>
                    熱門書單推薦
                  </h3>
                  <div className="booklist-block" style={{ width: '100%' }}>
                    <div className="booklist-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, padding: 0, margin: 0 }}>
                      {latestBooks.slice(0, 9).map((b) => (
                        <a
                          key={b.id}
                          href="#"
                          onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                          className="booklist-card-link"
                          style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                        >
                          <div className="booklist-card" style={{ background: '#fff', borderRadius: 10, boxShadow: '0 2px 10px rgba(0,0,0,0.08)', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)', height: 128, display: 'flex' }}>
                            {/* 封面区 (左侧紫蓝渐变) */}
                            <div className="booklist-cover-section" style={{ flex: '0 0 120px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <div style={{ width: 60, height: 80, background: 'rgba(255,255,255,0.9)', borderRadius: 3, overflow: 'hidden' }}>
                                <BookCover name={b.name} cover={b.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
                              </div>
                            </div>
                            {/* 文字信息 */}
                            <div className="booklist-info-section" style={{ flex: 1, padding: 12, overflow: 'hidden' }}>
                              <h3 className="booklist-title" style={{ fontSize: 15, fontWeight: 700, color: '#333', margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {b.name}
                              </h3>
                              <div className="booklist-meta" style={{ display: 'flex', gap: 10, fontSize: 12, color: '#999', marginBottom: 6 }}>
                                <span><i style={{ marginRight: 4 }}>📊</i>{formatWords(b.wordCount)}</span>
                                <span><i style={{ marginRight: 4 }}>📚</i>{b.category}</span>
                              </div>
                              <div className="booklist-desc" style={{ fontSize: 12, color: '#999', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {b.intro || '暂无简介'}
                              </div>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 最近更新表格 */}
                <div style={{ marginTop: 24 }}>
                  <h3 className="mytitle" style={{ margin: '0 0 10px', borderBottom: '1px solid rgba(150,150,150,0.2)', paddingBottom: 5, fontSize: 16, color: '#333' }}>
                    最近更新
                  </h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5', color: '#666' }}>
                        <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>類別</th>
                        <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>書名</th>
                        <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>最新章節</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>作者</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>字數</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>更新</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestBooks.slice(0, 15).map((b) => (
                        <tr key={b.id} style={{ borderTop: '1px solid #eee' }}>
                          <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                            <span style={{ color: '#1f6cb2', fontSize: 12 }}>[{b.category}]</span>
                          </td>
                          <td style={{ padding: '8px 6px' }}>
                            <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#333', textDecoration: 'none', fontWeight: 500 }}>
                              {b.name}
                            </a>
                          </td>
                          <td style={{ padding: '8px 6px', color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.latestChapter || '—'}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: '#888', whiteSpace: 'nowrap' }}>{b.author}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: '#888', whiteSpace: 'nowrap' }}>{formatWords(b.wordCount)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: '#888', whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 热门推荐短卡列表 */}
                <div style={{ marginTop: 24 }}>
                  <h3 className="mytitle" style={{ margin: '0 0 10px', borderBottom: '1px solid rgba(150,150,150,0.2)', paddingBottom: 5, fontSize: 16, color: '#333' }}>
                    熱門推薦
                  </h3>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                    {hotBooks.map((b, i) => (
                      <li key={b.id} style={{ padding: '8px 10px', background: '#f9f9f9', borderRadius: 4, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flexShrink: 0, width: 20, height: 20, background: i < 3 ? '#e84118' : '#aaa', color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 2 }}>
                          {i + 1}
                        </span>
                        <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ flex: 1, color: '#333', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {b.name}
                        </a>
                        <span style={{ color: '#999', fontSize: 11, flexShrink: 0 }}>{b.author}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>

      {/* 源站 .foot */}
      <div className="foot" style={{ textAlign: 'center', background: '#fff', padding: '20px 0' }}>
        <div className="copyright">
          <div style={{ marginBottom: 8 }}>
            <a href="/novels/hot" style={{ display: 'inline-block', padding: '0 10px', lineHeight: '200%', color: '#333', textDecoration: 'none' }}>排行榜</a>
            <a href="/last" style={{ display: 'inline-block', padding: '0 10px', lineHeight: '200%', color: '#333', textDecoration: 'none' }}>最新更新</a>
            <a href="/booklist/index/all" style={{ display: 'inline-block', padding: '0 10px', lineHeight: '200%', color: '#333', textDecoration: 'none' }}>書單推薦</a>
            <a href="/reviews/all/" style={{ display: 'inline-block', padding: '0 10px', lineHeight: '200%', color: '#333', textDecoration: 'none' }}>熱門書評</a>
            <a href="/all.html" style={{ display: 'inline-block', padding: '0 10px', lineHeight: '200%', color: '#333', textDecoration: 'none' }}>全部小說</a>
            <a href="/newtags" style={{ display: 'inline-block', padding: '0 10px', lineHeight: '200%', color: '#333', textDecoration: 'none' }}>熱門標籤</a>
          </div>
          <p style={{ padding: '10px 0', color: '#888', fontSize: 12 }}>
            Copyright © {new Date().getFullYear()} {site.name} · {site.domain} · 共收录 {formatWords(books.reduce((s, b) => s + (b.wordCount || 0), 0))}小说
          </p>
          <div style={{ fontSize: 12, color: '#888' }}>
            <span>友情連結：</span>
            <a href={site.domain ? `https://${site.domain}` : '#'} target="_blank" title={site.name} style={{ color: '#333', textDecoration: 'none', marginRight: 6 }}>{site.name}</a>|
            <a href="/privacy_policy.html" style={{ color: '#333', textDecoration: 'none', margin: '0 6px' }}>Cookies Policy</a>|
            <a href="/DMCA.html" style={{ color: '#333', textDecoration: 'none' }}>DMCA</a>
          </div>
        </div>
      </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
    </div>
  )
}
