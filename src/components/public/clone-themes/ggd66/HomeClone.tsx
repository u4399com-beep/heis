// ggd66 (格格党) 首页 1:1 克隆 — 使用源站 CSS class 名, 硬编码颜色
// 源站 CSS: /clone-css/ggd66.css (static/simple/style.css)
// 源站 DOM: .header(.header-left + .header-right + .header-nav 4 项) + .container > .content(#fengtui .content-left 6 卡 + #fengyou .content-right 14 排行) + .content(#zuixin .content-right 32 最新 + #gengxin .content-left 30 更新) + .content.tuijian 友链 + .footer
// 实测颜色: body bg #f9f9f9 / .header bg #1abc9c / a #00886d / .footer bg #56ccb5 / h2 border #ccc
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'
import { BookCover } from '../../BookCover'

function Skeleton() {
  return (
    <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto', padding: '12px 0' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 4, padding: 24, marginBottom: 12 }}>
        <div style={{ height: 28, background: '#f0f0f0', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 32, background: '#f0f0f0', borderRadius: 4 }} />
      </div>
    </div>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 4, homeModuleLimit = 12 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站 .header-nav 实测导航项 (从 probe-ggd66.html 提取)
  const NAV_ITEMS = [
    { name: '首 页', href: '/' },
    { name: '书 库', href: '/sort/' },
    { name: '全本', href: '/quanben/sort/' },
    { name: '搜索', href: '/search/' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  // 热门小说推荐 (6 卡)
  const fengtuiBooks = books.slice(0, 6)
  // 阅读排行榜 (13 条)
  const rankBooks = books.slice(0, 13)
  // 最新小说 (30 条)
  const zuixinBooks = books.slice(0, 30)
  // 最近更新 (homeModuleLimit 条)
  const gengxinBooks = books.slice(0, Math.max(homeModuleLimit, 20))

  return (
    <div style={{ background: '#f9f9f9', color: '#888', fontFamily: '"微软雅黑", Microsoft Yahei, simsun, arial, sans-serif', fontSize: 15, lineHeight: 1.5, minHeight: '100%' }}>
      {/* 源站 .header — bg #1abc9c, 高 75pt(移动)/50px(桌面) */}
      <div className="header" style={{ backgroundColor: '#1abc9c', marginBottom: 10, width: '100%', boxShadow: '0 1px 1px #1abc9c', lineHeight: '50px' }}>
        <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
          <div className="header-left" style={{ float: 'left', marginRight: 20, textAlign: 'left', textShadow: '1px 1px 2px #000', fontSize: 18, color: '#fff' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} title={site.name} className="logo" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700 }}>{site.name}</a>
          </div>
          <div className="header-nav" style={{ float: 'left', width: 300, fontSize: 16, display: 'flex', flexWrap: 'wrap' }}>
            {visibleNav.map((item, i) => (
              <a
                key={item.name}
                href={item.href}
                onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
                style={{ float: 'left', width: 60, textShadow: '1px 1px 1px #666', color: '#fff', textDecoration: 'none', lineHeight: '32px', textAlign: 'center' }}
              >
                {item.name}
              </a>
            ))}
          </div>
          <div className="header-right" style={{ float: 'right', textAlign: 'right', fontSize: 15, marginLeft: 'auto', color: '#fff' }}>
            <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 4px' }}>阅读历史</a>
            <span style={{ color: '#fff', opacity: 0.6 }}>|</span>
            <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 4px' }}>登录</a>
            <span style={{ color: '#fff', opacity: 0.6 }}>|</span>
            <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 4px' }}>注册</a>
          </div>
          <div className="clear" style={{ clear: 'both' }} />
        </div>
      </div>

      {/* 源站 .container */}
      <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto' }}>
        {/* 第一行 .content — #fengtui (content-left 73%) + #fengyou (content-right 25%) */}
        <div className="content" style={{ clear: 'both', margin: '10px 0', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {/* #fengtui 热门小说推荐 */}
          <div className="content-left" id="fengtui" style={{ flex: '0 0 73%', minWidth: 0, background: '#fff' }}>
            <h2 style={{ margin: 0, padding: '0 0 10px 12px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: 18, lineHeight: 2 }}>热门小说推荐</h2>
            {fengtuiBooks.map((b) => (
              <div key={b.id} className="item" style={{ display: 'flex', gap: 12, padding: '10px 12px', borderBottom: '1px dashed #eee' }}>
                <div className="image" style={{ flexShrink: 0, width: 120, height: 150 }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}>
                    <BookCover name={b.name} cover={b.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
                  </a>
                </div>
                <dl style={{ flex: 1, minWidth: 0, margin: 0 }}>
                  <dt style={{ marginBottom: 6 }}>
                    <span style={{ color: '#888', marginRight: 8 }}>{b.author}</span>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#00886d', textDecoration: 'none', fontSize: 16, fontWeight: 600 }}>{b.name}</a>
                  </dt>
                  <dd style={{ margin: 0, color: '#888', lineHeight: 1.6, fontSize: 13, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {b.intro || '暂无简介'}
                  </dd>
                </dl>
                <div className="clear" style={{ clear: 'both' }} />
              </div>
            ))}
          </div>

          {/* #fengyou 阅读排行榜 */}
          <div className="content-right" id="fengyou" style={{ flex: '0 0 25%', minWidth: 240, background: '#fff' }}>
            <div className="search" style={{ overflow: 'hidden', margin: 0, padding: 10, width: 'auto' }}>
              <form name="articlesearch" method="post" action="/search/" style={{ position: 'relative', border: '2px solid #56ccb5', borderRadius: 5, background: '#fff', display: 'flex' }} onSubmit={(e) => e.preventDefault()}>
                <input
                  name="searchkey"
                  type="text"
                  className="text"
                  placeholder="搜索从这里开始..."
                  style={{ margin: 0, padding: 0, width: '80%', outline: 0, background: '#f9f9f9', color: '#56ccb5', textIndent: '1em', height: 38, border: 'none', fontSize: 15 }}
                />
                <button type="submit" name="submit" style={{ height: 38, border: 'none', fontSize: 16, background: '#56ccb5', color: '#fff', lineHeight: '38px', cursor: 'pointer', padding: '0 12px' }}>搜 索</button>
              </form>
            </div>
            <h2 style={{ margin: '8px 0 0', padding: '0 0 10px 12px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: 18, lineHeight: 2 }}>阅读排行榜</h2>
            <ul style={{ listStyle: 'none', padding: '0 12px', margin: 0 }}>
              {rankBooks.map((b) => (
                <li key={b.id} style={{ padding: '5px 0', borderBottom: '1px dashed #eee', fontSize: 14, lineHeight: 1.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#888' }}>[{b.category?.slice(0, 2) || '小说'}] </span>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#00886d', textDecoration: 'none' }}>{b.name}</a>
                  <span style={{ color: '#888', marginLeft: 6, fontSize: 12 }}>{b.author}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="clear" style={{ clear: 'both' }} />
        </div>

        {/* 第二行 .content — #zuixin (content-right 25%) + #gengxin (content-left 73%) */}
        <div className="content" style={{ clear: 'both', margin: '10px 0', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {/* #zuixin 最新小说 */}
          <div className="content-right" id="zuixin" style={{ flex: '0 0 25%', minWidth: 240, background: '#fff', order: 2 }}>
            <h2 style={{ margin: 0, padding: '0 0 10px 12px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: 18, lineHeight: 2 }}>最新小说</h2>
            <ul style={{ listStyle: 'none', padding: '0 12px', margin: 0 }}>
              {zuixinBooks.map((b) => (
                <li key={b.id} style={{ padding: '5px 0', borderBottom: '1px dashed #eee', fontSize: 13, lineHeight: 1.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#888' }}>[{b.category?.slice(0, 2) || '小说'}] </span>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#00886d', textDecoration: 'none' }}>{b.name}</a>
                  <span style={{ color: '#888', marginLeft: 6, fontSize: 12 }}>{b.author}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* #gengxin 最近更新 */}
          <div className="content-left" id="gengxin" style={{ flex: '0 0 73%', minWidth: 0, background: '#fff', order: 1 }}>
            <h2 style={{ margin: 0, padding: '0 0 10px 12px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: 18, lineHeight: 2 }}>最近更新</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {gengxinBooks.map((b) => (
                <li key={b.id} style={{ padding: '8px 12px', borderBottom: '1px dashed #eee', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, lineHeight: 1.6, flexWrap: 'wrap' }}>
                  <span className="s1" style={{ width: 100, flexShrink: 0, color: '#888' }}>[{b.category}]</span>
                  <span className="s2" style={{ width: 200, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} target="_blank" style={{ color: '#00886d', textDecoration: 'none' }}>{b.name}</a>
                  </span>
                  <span className="s3" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.latestChapter ? (
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} target="_blank" style={{ color: '#888', textDecoration: 'none' }}>{b.latestChapter}</a>
                    ) : <span style={{ color: '#aaa' }}>暂无章节</span>}
                  </span>
                  <span className="s4" style={{ width: 90, flexShrink: 0, textAlign: 'right', color: '#888', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</span>
                  <span className="s5" style={{ width: 70, flexShrink: 0, textAlign: 'right', color: '#aaa', fontSize: 12 }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="clear" style={{ clear: 'both' }} />
        </div>

        {/* 源站 .content.tuijian — 友情链接 */}
        <div className="content tuijian" style={{ clear: 'both', margin: '10px 0', background: '#fff', padding: 12 }}>
          <strong style={{ color: '#333', marginRight: 8 }}>友情链接：</strong>
          <span style={{ display: 'inline-block' }}>
            <a href="#" style={{ color: '#00886d', textDecoration: 'none', fontSize: 13, marginRight: 10 }}>小说阅读网</a>
            <a href="#" style={{ color: '#00886d', textDecoration: 'none', fontSize: 13, marginRight: 10 }}>免费小说</a>
            <a href="#" style={{ color: '#00886d', textDecoration: 'none', fontSize: 13, marginRight: 10 }}>言情小说吧</a>
            <a href="#" style={{ color: '#00886d', textDecoration: 'none', fontSize: 13, marginRight: 10 }}>起点中文网</a>
            <a href="#" style={{ color: '#00886d', textDecoration: 'none', fontSize: 13, marginRight: 10 }}>笔趣阁</a>
            <a href="#" style={{ color: '#00886d', textDecoration: 'none', fontSize: 13, marginRight: 10 }}>好书网</a>
          </span>
          <div className="clear" style={{ clear: 'both' }} />
        </div>
      </div>

      {/* 源站 .footer — bg #56ccb5 */}
      <div className="footer" style={{ padding: '10px 0', backgroundColor: '#56ccb5', boxShadow: '0 -1px 1px #56ccb5', color: '#fff', textAlign: 'center', fontSize: 14 }}>
        <p style={{ margin: 0, padding: 0, color: '#fff' }}>本站所有小说为转载作品，所有章节均由网友上传，转载至本站只是为了宣传本书让更多读者欣赏。</p>
        <p style={{ margin: '4px 0 0', padding: 0, color: '#fff' }}>Copyright {new Date().getFullYear()} {site.name}({site.domain}) All Rights Reserved · {formatWords(books.reduce((s, b) => s + (b.wordCount || 0), 0))}小说</p>
        <div className="clear" style={{ clear: 'both' }} />
      </div>
    </div>
  )
}
