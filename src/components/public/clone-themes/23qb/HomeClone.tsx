// 23qb.net (铅笔小说) 首页 1:1 克隆 — mxstatic 模板
// 源站 CSS: /clone-css/23qb.css (mxstatic/css/style.css + mxhtmlblack.css)
// 源站 DOM: body.homepage > #header(.header-content + #search-content) + #main.wrapper(.content > .box.module)
// 实测颜色: body bg #f8f9f9 / 头部背景图 searchbg.jpg / 主色 #ff2a14 / nav 选中橙色渐变 #ff9800→#ff2a14
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'
import { BookCover } from '../../BookCover'

function Skeleton() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 24, marginBottom: 12 }}>
        <div style={{ height: 28, background: '#f3f5f7', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 36, background: '#f3f5f7', borderRadius: 4 }} />
      </div>
    </div>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 13, homeModuleLimit = 18 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站 .nav-menu-item 实测导航项 (probe-23qb.html)
  const NAV_ITEMS = [
    { name: '首页', href: '/' },
    { name: '言情', href: '/book/lastupdate_0_1_0_0_0_0_0_1_0.html' },
    { name: '都市', href: '/book/lastupdate_0_2_0_0_0_0_0_1_0.html' },
    { name: '唯美', href: '/book/lastupdate_0_3_0_0_0_0_0_1_0.html' },
    { name: '穿越', href: '/book/lastupdate_0_4_0_0_0_0_0_1_0.html' },
    { name: '青春', href: '/book/lastupdate_0_5_0_0_0_0_0_1_0.html' },
    { name: '玄幻', href: '/book/lastupdate_0_6_0_0_0_0_0_1_0.html' },
    { name: '武侠', href: '/book/lastupdate_0_7_0_0_0_0_0_1_0.html' },
    { name: '军事', href: '/book/lastupdate_0_8_0_0_0_0_0_1_0.html' },
    { name: '竞技', href: '/book/lastupdate_0_9_0_0_0_0_0_1_0.html' },
    { name: '科幻', href: '/book/lastupdate_0_10_0_0_0_0_0_1_0.html' },
    { name: '悬疑', href: '/book/lastupdate_0_11_0_0_0_0_0_1_0.html' },
    { name: '同人', href: '/book/lastupdate_0_12_0_0_0_0_0_1_0.html' },
    { name: '职场', href: '/book/lastupdate_0_13_0_0_0_0_0_1_0.html' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  // 热搜词 (源自 search-tag hot)
  const HOT_SEARCH = ['问鼎', '朕和她', '麒麟', '一不小心成了白月光', '年少成名', '不老泉', '大小姐她总是不求上进', '蛊真人', '江海不渡', '夫人她马甲又轰动全城了']

  const latestBooks = books.slice(0, homeModuleLimit)

  return (
    <div style={{ background: '#f8f9f9', color: '#282828', fontFamily: '-apple-system-font, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif', fontSize: 14, minHeight: '100%' }}>
      {/* 源站 #header — fixed 头部 + 导航 */}
      <header id="header" className="wrapper" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 15px', boxSizing: 'border-box' }}>
        <div className="header-content" style={{ position: 'relative', width: '100%' }}>
          {/* logo + nav 横排 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '12px 0', flexWrap: 'wrap' }}>
            <div className="header-logo">
              <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} className="logo" title={site.name} style={{ display: 'flex', alignItems: 'center', fontSize: 24, fontWeight: 700, color: '#282828', textDecoration: 'none' }}>
                {site.name}
              </a>
            </div>
            <nav className="nav" style={{ flex: 1, minWidth: 0 }}>
              <ul className="nav-menu-items" style={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: 0, gap: 4 }}>
                {visibleNav.map((item, i) => (
                  <li key={item.name} className={`nav-menu-item ${i === 0 ? 'selected' : ''}`} style={{ padding: '0 11px', fontSize: 16, lineHeight: '45px' }}>
                    <a
                      href={item.href}
                      onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
                      style={{ color: '#282828', textDecoration: 'none', display: 'inline-block', position: 'relative' }}
                    >
                      <span style={{ fontWeight: 700, position: 'relative' }}>
                        {item.name}
                        {i === 0 && (
                          <span style={{ position: 'absolute', bottom: -8, left: '32%', width: '35%', height: 4, background: 'linear-gradient(90deg, #ff9800, #ff2a14)', borderRadius: 5 }} />
                        )}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          {/* 源站 #search-content — 搜索区 */}
          <div id="search-content" style={{ padding: '32px 0', textAlign: 'center' }}>
            <div className="index-logo" style={{ marginBottom: 16 }}>
              <span className="logo-s" style={{ display: 'inline-block' }}>
                <h1 style={{ fontSize: 32, fontWeight: 700, color: '#282828', margin: 0 }}>{site.name}</h1>
              </span>
            </div>
            <form action="/search.html" onSubmit={(e) => e.preventDefault()} style={{ maxWidth: 600, margin: '0 auto' }}>
              <div className="search-main">
                <div className="search-box" style={{ display: 'flex', background: '#fff', borderRadius: 24, padding: '6px 6px 6px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', alignItems: 'center' }}>
                  <input
                    className="search-input"
                    type="search"
                    name="searchkey"
                    autoComplete="off"
                    placeholder="搜索喜欢的小说、作者、标签"
                    style={{ flex: 1, height: 36, border: 'none', outline: 'none', fontSize: 14, background: 'transparent' }}
                  />
                  <a href="/book/" className="search-btn search-cupfox" title="书库" style={{ color: '#ff2a14', fontSize: 16, padding: '0 16px', textDecoration: 'none' }}>书库</a>
                  <button className="search-btn search-go" type="submit" style={{ width: 56, height: 36, background: 'linear-gradient(90deg, #ff9800, #ff2a14)', border: 'none', borderRadius: 18, color: '#fff', cursor: 'pointer', fontSize: 16 }}>
                    搜
                  </button>
                </div>
              </div>
              {/* 今日热门 hot 词 */}
              <div className="search-tag" style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {HOT_SEARCH.map((kw) => (
                  <a
                    key={kw}
                    href="javascript:;"
                    onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: kw }) }}
                    style={{ color: '#282828', fontSize: 13, padding: '4px 12px', background: '#f3f5f7', borderRadius: 12, textDecoration: 'none' }}
                  >
                    {kw}
                  </a>
                ))}
              </div>
            </form>
          </div>
        </div>
      </header>

      {/* 源站 #main — 主体 */}
      <main id="main" className="wrapper" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 15px 24px', boxSizing: 'border-box' }}>
        <div className="content">
          {/* 热门推荐模块 */}
          <div className="box module" style={{ background: '#fff', borderRadius: 8, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #f3f5f7' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#282828', margin: 0, padding: '0 0 0 12px', borderLeft: '4px solid #ff2a14' }}>
                热门推荐
              </h2>
              <a href="#" style={{ color: '#ff2a14', fontSize: 13, textDecoration: 'none' }}>更多 →</a>
            </div>
            <div className="module-list module-lines-list">
              <div className="module-items" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16 }}>
                {latestBooks.map((b, i) => (
                  <div key={b.id} className="module-item" style={{ textAlign: 'center' }}>
                    <div className="module-item-cover" style={{ position: 'relative', width: '100%', aspectRatio: '3/4', marginBottom: 8, borderRadius: 6, overflow: 'hidden', background: '#f3f5f7' }}>
                      <div className="module-item-top" style={{ position: 'absolute', top: 0, left: 0, width: 24, height: 24, background: i < 3 ? 'linear-gradient(135deg, #ff9800, #ff2a14)' : '#aaa', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px 0 6px 0', zIndex: 2 }}>
                        {i + 1}
                      </div>
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                        className="module-item-pic"
                        style={{ display: 'block', width: '100%', height: '100%' }}
                      >
                        <BookCover name={b.name} cover={b.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
                      </a>
                    </div>
                    <div className="module-item-titlebox">
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} className="module-item-title" style={{ color: '#282828', textDecoration: 'none', fontSize: 14, fontWeight: 500, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.name}
                      </a>
                    </div>
                    <div className="module-item-text" style={{ color: '#999', fontSize: 12, marginTop: 2 }}>{b.author}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 最近更新表格 */}
          <div className="box module" style={{ background: '#fff', borderRadius: 8, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #f3f5f7' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#282828', margin: 0, padding: '0 0 0 12px', borderLeft: '4px solid #ff2a14' }}>
                最近更新
              </h2>
              <a href="#" style={{ color: '#ff2a14', fontSize: 13, textDecoration: 'none' }}>更多 →</a>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9f9', color: '#666' }}>
                  <th style={{ padding: '10px 6px', textAlign: 'left', fontWeight: 400, fontSize: 13 }}>类别</th>
                  <th style={{ padding: '10px 6px', textAlign: 'left', fontWeight: 400, fontSize: 13 }}>书名</th>
                  <th style={{ padding: '10px 6px', textAlign: 'left', fontWeight: 400, fontSize: 13 }}>最新章节</th>
                  <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 400, fontSize: 13 }}>作者</th>
                  <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 400, fontSize: 13 }}>字数</th>
                  <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 400, fontSize: 13 }}>更新</th>
                </tr>
              </thead>
              <tbody>
                {latestBooks.slice(0, 15).map((b) => (
                  <tr key={b.id} style={{ borderTop: '1px solid #f3f5f7' }}>
                    <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#ff2a14', fontSize: 12, background: 'rgba(255,42,20,0.08)', padding: '2px 8px', borderRadius: 4 }}>{b.category}</span>
                    </td>
                    <td style={{ padding: '10px 6px' }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#282828', textDecoration: 'none', fontWeight: 500 }}>
                        {b.name}
                      </a>
                    </td>
                    <td style={{ padding: '10px 6px', color: '#999', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.latestChapter || '—'}
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.author}</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{formatWords(b.wordCount)}</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* 源站 #footer */}
      <footer id="footer" className="wrapper" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 15px', textAlign: 'center', color: '#666', fontSize: 12, borderTop: '1px solid #eaecef' }}>
        <p className="sitemap" style={{ margin: '0 0 8px' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#282828', textDecoration: 'none', margin: '0 8px' }}>{site.name}</a>
          <span style={{ color: '#ddd' }}>|</span>
          <a href="#" style={{ color: '#282828', textDecoration: 'none', margin: '0 8px' }}>RSS</a>
          <span style={{ color: '#ddd' }}>|</span>
          <a href="#" style={{ color: '#282828', textDecoration: 'none', margin: '0 8px' }}>Google</a>
          <span style={{ color: '#ddd' }}>|</span>
          <a href="#" style={{ color: '#282828', textDecoration: 'none', margin: '0 8px' }}>Bing</a>
        </p>
        <p style={{ margin: '4px 0' }}>Copyright © {new Date().getFullYear()} {site.name} · {site.domain}</p>
        <p style={{ margin: '4px 0', color: '#999' }}>铅笔小说 · 最值得书友收藏的网络小说阅读网 · 共收录 {formatWords(books.reduce((s, b) => s + (b.wordCount || 0), 0))}小说</p>
      </footer>
    </div>
  )
}
