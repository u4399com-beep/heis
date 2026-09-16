// shipsay (船说CMS) 首页 1:1 克隆 — 使用源站 CSS class 名, 硬编码颜色
// 源站 CSS: /clone-css/shipsay.css (static/shipsay/style.css)
// 源站 DOM: header > .container.head(#logo + form + .header_right) + .navigation > nav.container(8 项) +
//   .container(.side_commend 700px + aside 250px) + .container(.section.flex 6 .sortvisit) + .container(.lastupdate 700px + aside 250px) + .container .section.link + #footer
// 实测颜色: a #1a1a1a / a:hover #ed4259 / .gray #666 / orange #f0643a / .head bg #3e3d43 / .lastupdate bg #fff / .section bg #fff
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'
import { BookCover } from '../../BookCover'

function Skeleton() {
  return (
    <div className="container" style={{ maxWidth: 960, margin: '0 auto', padding: '10px' }}>
      <div style={{ background: '#fff', padding: 16, marginBottom: 10 }}>
        <div style={{ height: 24, background: '#f0f0f0', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 100, background: '#f0f0f0', borderRadius: 4 }} />
      </div>
    </div>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 9, homeModuleLimit = 12 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站 nav 实测导航项 (从 probe-shipsay.html 提取)
  const NAV_ITEMS = [
    { name: '首页', href: '/' },
    { name: '玄幻', href: '/sort/1/1/' },
    { name: '武侠', href: '/sort/2/1/' },
    { name: '都市', href: '/sort/3/1/' },
    { name: '历史', href: '/sort/4/1/' },
    { name: '科幻', href: '/sort/5/1/' },
    { name: '游戏', href: '/sort/6/1/' },
    { name: '女生', href: '/sort/7/1/' },
    { name: '其他', href: '/sort/8/1/' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  // 大神小说 6 本
  const hotBooks = books.slice(0, 6)
  // 热门小说 12 本
  const popularBooks = books.slice(0, 12)
  // 6 个分类区块, 每区块 1 主图 + 12 列表
  const sortSections = [
    { title: '玄幻魔法', items: books.slice(0, 13) },
    { title: '武侠修真', items: books.slice(6, 19) },
    { title: '都市言情', items: books.slice(12, 25) },
    { title: '历史军事', items: books.slice(4, 17) },
    { title: '科幻灵异', items: books.slice(8, 21) },
    { title: '游戏竞技', items: books.slice(2, 15) },
  ]
  // 最新章节 30 条
  const lastUpdateBooks = books.slice(0, Math.max(homeModuleLimit, 20))
  // 最新入库 30 条
  const recentBooks = books.slice(0, 30)

  return (
    <div style={{ background: '#fbfbfb', color: '#1a1a1a', fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 14, lineHeight: 1.5, minHeight: '100%' }}>
      {/* 源站 header > .container.head */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e6e6e6' }}>
        <div className="container head" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', padding: '16px 5px' }}>
          <a id="logo" href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ fontWeight: 700, textAlign: 'center', textDecoration: 'none', flexShrink: 0, marginRight: 16 }}>
            <span style={{ fontSize: '1.5em', letterSpacing: '.15em', color: '#3e3d43' }}>{site.name}</span>
            <p style={{ fontWeight: 700, color: '#bf2c24', margin: 0 }}>{site.domain}</p>
          </a>
          <form name="t_frmsearch" method="post" action="/search/" style={{ display: 'flex', alignItems: 'center', height: 36, width: 300, margin: '5px 2px' }} onSubmit={(e) => e.preventDefault()}>
            <input
              id="searchkey"
              type="text"
              name="searchkey"
              className="search_input"
              placeholder="猫腻"
              autoComplete="off"
              style={{ textIndent: 10, height: '100%', border: '1px solid #e6e6e6', borderRadius: '3px 0 0 3px', borderRight: 0, flexGrow: 2, outline: 'none', fontSize: 14 }}
            />
            <input type="hidden" name="searchtype" value="all" />
            <button type="submit" id="search_btn" title="搜索" style={{ padding: '0 13px', height: '100%', border: 'none', borderRadius: '0 3px 3px 0', background: '#bf2c24', color: '#fbfbfb', cursor: 'pointer' }}>
              <i className="fa fa-search fa-lg">🔍</i>
            </button>
          </form>
          <div className="header_right" style={{ display: 'flex', alignItems: 'flex-end', fontSize: '1.1em', paddingTop: 8 }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} id="home" style={{ color: '#1a1a1a', paddingLeft: 30, textAlign: 'center', textDecoration: 'none' }}>
              <i className="fa fa-home fa-lg">🏠</i><br />首页
            </a>
            <a href="/sort/" style={{ color: '#1a1a1a', paddingLeft: 30, textAlign: 'center', textDecoration: 'none' }}>
              <i className="fa fa-book fa-lg">📚</i><br />书库
            </a>
            <a href="/quanben/sort/" style={{ color: '#1a1a1a', paddingLeft: 30, textAlign: 'center', textDecoration: 'none' }}>
              <i className="fa fa-coffee fa-lg">☕</i><br />完本
            </a>
            <a href="/history.html" style={{ color: '#1a1a1a', paddingLeft: 30, textAlign: 'center', textDecoration: 'none' }}>
              <i className="fa fa-history fa-lg">🕘</i><br />足迹
            </a>
          </div>
        </div>
      </header>

      {/* 源站 .navigation > nav.container — 8 分类 + 首页 */}
      <div className="navigation" style={{ background: '#3e3d43' }}>
        <nav className="container" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', fontSize: '1.15em' }}>
          {visibleNav.map((item, i) => (
            <a
              key={item.name}
              href={item.href}
              onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
              style={{ display: 'inline-block', color: '#fbfbfb', padding: '0 20px', height: 41, lineHeight: '41px', textDecoration: 'none' }}
            >
              {item.name}
            </a>
          ))}
          <div id="user_panel" style={{ marginLeft: 'auto' }} />
        </nav>
      </div>

      {/* 第一个 .container — 大神小说 + 热门小说 */}
      <div className="container" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap' }}>
        <div className="side_commend side_commend_width" style={{ width: 700, marginTop: 10, padding: '10px 10px 5px', background: '#fff' }}>
          <p className="title" style={{ display: 'flex', alignItems: 'center', width: '100%', fontWeight: 700, color: '#555', fontSize: '1.1em', paddingBottom: 8, borderBottom: '1px solid #ddd', margin: 0 }}>
            <i className="fa fa-thumbs-o-up fa-lg" style={{ marginRight: 4 }}>👍</i>&nbsp;大神小说
          </p>
          <ul className="flex" style={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: 0 }}>
            {hotBooks.map((b) => (
              <li key={b.id} style={{ width: '49%', display: 'flex', margin: '10px 6px 18px 0', lineHeight: '1.7em' }}>
                <div className="img_span" style={{ position: 'relative', marginRight: 15, flexShrink: 0 }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ width: 100, height: 133, overflow: 'hidden', display: 'block' }}>
                    <BookCover name={b.name} cover={b.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
                  </a>
                  <span style={{ width: 100, height: 25, background: 'rgba(0, 0, 0, .4)', display: 'flex', position: 'absolute', top: 108, color: '#fff', justifyContent: 'center', alignItems: 'center', fontSize: 11 }}>
                    {b.category} / {b.status === 'completed' ? '完本' : '连载'}
                  </span>
                </div>
                <div className="w100" style={{ flex: 1, minWidth: 0 }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ textDecoration: 'none' }}>
                    <h2 style={{ fontSize: '1.15em', display: 'block', height: 24, lineHeight: '24px', overflow: 'hidden', color: '#1a1a1a', margin: 0 }}>{b.name}</h2>
                  </a>
                  <p className="indent" style={{ textIndent: '2em', lineHeight: '1.8em', height: 77, overflow: 'hidden', margin: '7px 0', color: '#666', fontSize: 13 }}>
                    {b.intro || '暂无简介'}
                  </p>
                  <div className="li_bottom" style={{ display: 'flex', overflow: 'hidden', alignItems: 'center', flexFlow: 'nowrap' }}>
                    <a href="#" style={{ color: '#666', textDecoration: 'none' }}>
                      <i className="fa fa-user-circle-o" style={{ marginRight: 4 }}>👤</i>&nbsp;{b.author}
                    </a>
                    <div style={{ marginLeft: 'auto' }}>
                      <em className="orange" style={{ color: '#f0643a', border: '1px solid #ccc', borderRadius: 1, padding: '0 2px', fontSize: 10, marginRight: 4, fontStyle: 'normal' }}>{formatWords(b.wordCount)}</em>
                      <em className="blue" style={{ color: '#4284ed', border: '1px solid #ccc', borderRadius: 1, padding: '0 2px', fontSize: 10, marginRight: 4, fontStyle: 'normal' }}>{b.updatedAt ? fmtDate(b.updatedAt) : '—'}</em>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <aside style={{ width: 250, marginLeft: 10, marginTop: 10, padding: '10px 10px 5px', background: '#fff' }}>
          <p className="title" style={{ display: 'flex', alignItems: 'center', width: '100%', fontWeight: 700, color: '#555', fontSize: '1.1em', paddingBottom: 8, borderBottom: '1px solid #ddd', margin: 0 }}>
            <i className="fa fa-fire fa-lg" style={{ marginRight: 4 }}>🔥</i>&nbsp;热门小说
          </p>
          <ul className="popular odd" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {popularBooks.map((b) => (
              <li key={b.id} style={{ display: 'flex', justifyContent: 'space-between', flexFlow: 'nowrap', height: 41, borderBottom: '1px dotted #e6e6e6' }}>
                <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ lineHeight: '41px', overflow: 'hidden', fontSize: '1.1em', color: '#1a1a1a', textDecoration: 'none', flex: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {b.name}
                </a>
                <a className="gray" href="#" style={{ lineHeight: '41px', overflow: 'hidden', textAlign: 'right', color: '#666', textDecoration: 'none', marginLeft: 8, whiteSpace: 'nowrap' }}>
                  {b.author}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* 第二个 .container — .section.flex 6 .sortvisit 分类区块 */}
      <div className="container" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap' }}>
        <div className="section flex" style={{ width: '100%', margin: '10px 0 0', padding: 10, background: '#fff', display: 'flex', flexWrap: 'wrap' }}>
          {sortSections.map((sec) => (
            <div key={sec.title} className="sortvisit" style={{ flex: '1 1 320px', minWidth: 280, margin: '8px' }}>
              <a href="#" style={{ display: 'block', fontWeight: 700, fontSize: 16, padding: '6px 0', borderBottom: '1px solid #eee', color: '#3e3d43', textDecoration: 'none' }}>{sec.title}</a>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {sec.items[0] && (
                  <div style={{ display: 'flex', gap: 10, padding: '8px 0' }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: sec.items[0].id }) }} style={{ flexShrink: 0 }}>
                      <BookCover name={sec.items[0].name} cover={sec.items[0].cover} className="w-[60px] h-[80px]" style={{ borderRadius: 0 }} />
                    </a>
                    <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 12, color: '#666', lineHeight: '1.6em' }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: sec.items[0].id }) }} style={{ color: '#1a1a1a', textDecoration: 'none', fontWeight: 700 }}>{sec.items[0].name}</a>
                      <i style={{ color: '#888', fontStyle: 'normal' }}>&nbsp;/&nbsp;{sec.items[0].author}</i>
                      <br />
                      &nbsp;&nbsp;&nbsp;&nbsp;{sec.items[0].intro || '暂无简介'}
                    </p>
                  </div>
                )}
                {sec.items.slice(1, 13).map((b) => (
                  <li key={b.id} style={{ padding: '4px 0', borderBottom: '1px dotted #f0f0f0' }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#1a1a1a', textDecoration: 'none' }}>{b.name}</a>
                    <i style={{ color: '#888', fontStyle: 'normal' }}>&nbsp;/ {b.author}</i>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* 第三个 .container — 最新章节 + 最新小说 */}
      <div className="container" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap' }}>
        <div className="lastupdate" style={{ width: 700, margin: '10px 0 0', padding: 10, background: '#fff' }}>
          <p className="title" style={{ display: 'flex', alignItems: 'center', width: '100%', fontWeight: 700, color: '#555', fontSize: '1.1em', paddingBottom: 8, borderBottom: '1px solid #ddd', margin: 0 }}>
            <i className="fa fa-clock-o fa-lg" style={{ marginRight: 4 }}>🕒</i>&nbsp;最新章节
          </p>
          <ul className="odd" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {lastUpdateBooks.map((b) => (
              <li key={b.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', width: '100%', height: 41, lineHeight: '41px', overflow: 'hidden', borderBottom: '1px dotted #e6e6e6' }}>
                <span style={{ width: '9%', marginLeft: '-1%', color: '#888' }}>「{b.category?.slice(0, 2) || '小说'}」</span>
                <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ width: '25%', fontSize: '1.1em', color: '#1a1a1a', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</a>
                <a className="gray" href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ width: '41%', marginLeft: '1%', color: '#666', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.latestChapter || '暂无章节'}</a>
                <span style={{ width: '25%', textAlign: 'right', color: '#888' }}>
                  <a className="gray" href="#" style={{ color: '#666', textDecoration: 'none' }}>{b.author}</a>
                  &nbsp;&nbsp;{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <aside style={{ width: 250, marginLeft: 10, marginTop: 10, padding: '10px 10px 5px', background: '#fff' }}>
          <p className="title" style={{ display: 'flex', alignItems: 'center', width: '100%', fontWeight: 700, color: '#555', fontSize: '1.1em', paddingBottom: 8, borderBottom: '1px solid #ddd', margin: 0 }}>
            <i className="fa fa-pencil fa-lg" style={{ marginRight: 4 }}>✏️</i>&nbsp;最新小说
          </p>
          <ul className="popular odd" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recentBooks.map((b) => (
              <li key={b.id} style={{ display: 'flex', justifyContent: 'space-between', flexFlow: 'nowrap', height: 41, borderBottom: '1px dotted #e6e6e6' }}>
                <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ lineHeight: '41px', overflow: 'hidden', fontSize: '1.1em', color: '#1a1a1a', textDecoration: 'none', flex: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {b.name}
                </a>
                <a className="gray" href="#" style={{ lineHeight: '41px', overflow: 'hidden', textAlign: 'right', color: '#666', textDecoration: 'none', marginLeft: 8, whiteSpace: 'nowrap' }}>
                  {b.author}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* 第四个 .container — .section.link 友情链接 */}
      <div className="container" style={{ maxWidth: 960, margin: '10px auto 0', display: 'flex', flexWrap: 'wrap' }}>
        <div className="section link" style={{ width: '100%', margin: '10px 0 0', padding: 10, background: '#fff' }}>
          <p className="title" style={{ display: 'flex', alignItems: 'center', width: '100%', fontWeight: 700, color: '#555', fontSize: '1.1em', paddingBottom: 8, borderBottom: '1px solid #ddd', margin: 0 }}>
            <i className="fa fa-link" style={{ marginRight: 4 }}>🔗</i>&nbsp;友情链接
          </p>
          <div style={{ marginTop: 10 }}>
            <a href="#" target="_blank" rel="noreferrer" style={{ display: 'inline-block', padding: '0 10px 5px 0', color: '#1a1a1a', textDecoration: 'none' }}>船说CMS</a>
            <a href="#" target="_blank" rel="noreferrer" style={{ display: 'inline-block', padding: '0 10px 5px 0', color: '#1a1a1a', textDecoration: 'none' }}>小说阅读网</a>
            <a href="#" target="_blank" rel="noreferrer" style={{ display: 'inline-block', padding: '0 10px 5px 0', color: '#1a1a1a', textDecoration: 'none' }}>免费小说</a>
            <a href="#" target="_blank" rel="noreferrer" style={{ display: 'inline-block', padding: '0 10px 5px 0', color: '#1a1a1a', textDecoration: 'none' }}>笔趣阁</a>
          </div>
        </div>
      </div>

      {/* 源站 #footer */}
      <div id="footer" style={{ background: '#3e3d43' }}>
        <footer className="container" style={{ maxWidth: 960, margin: '0 auto', color: '#fbfbfb', padding: '15px 0', flexFlow: 'column wrap', alignItems: 'center', fontSize: 12, lineHeight: 1.5, textAlign: 'center' }}>
          <p style={{ margin: 0, color: '#fbfbfb' }}>
            <i className="fa fa-flag">🚩</i>&nbsp;
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fbfbfb', textDecoration: 'none' }}>{site.name}</a>
            &nbsp;书友最值得收藏的网络小说阅读网
          </p>
          <p style={{ margin: '4px 0 0', color: '#fbfbfb' }}>
            <a href="#" style={{ color: '#fbfbfb', textDecoration: 'none' }}>简体版</a> · <a href="#" style={{ color: '#fbfbfb', textDecoration: 'none' }}>繁體版</a>
          </p>
        </footer>
      </div>
    </div>
  )
}
