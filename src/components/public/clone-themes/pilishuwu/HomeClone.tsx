// pilishuwu.com 首页 1:1 克隆 — wmcms-web 模板
// 源站 CSS: /clone-css/pilishuwu.css (wmcms.global.css + main-header-content/nav/bg)
// 源站 DOM: .mod-top-wr (.mod-top-logo + .mod-top-search + .mod-top-nav-list) +
//           .mod-tags-wr (热门推荐) + .in-rank-wr (热门排行) + .mod-footer-wr
// 实测颜色: nav bg #f1854b / search bg #ece8e6 / .mod-footer-wr #f69057 / 主色 #fa8729
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'
import { BookCover } from '../../BookCover'

function Skeleton() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 24, marginBottom: 12 }}>
        <div style={{ height: 28, background: '#f6f6f6', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 36, background: '#f6f6f6', borderRadius: 4 }} />
      </div>
    </div>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 11, homeModuleLimit = 24 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站 .mod-top-nav-list 实测导航项 (probe-pilishuwu.html)
  const NAV_ITEMS = [
    { name: '首页', href: '/index.html' },
    { name: '全部小说', href: '/0/list/1.html' },
    { name: '排行榜', href: '/top/index.html' },
    { name: '男频小说', href: '/1/list/1.html' },
    { name: '女频小说', href: '/2/list/1.html' },
    { name: '电子图书', href: '/3/list/1.html' },
    { name: '无CP小说', href: '/4/list/1.html' },
    { name: '纯爱小说', href: '/5/list/1.html' },
    { name: '百合小说', href: '/6/list/1.html' },
    { name: '轻小说', href: '/8/list/1.html' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  // 热搜词 (源自 .mod-top-tag, 风格相符)
  const HOT_SEARCH = ['诡秘之主', '人鱼陷落', '全球高考', '我见南山', '半仙', '天启预报', '深海余烬', '明克街13号', '诸界第一因', '嘉佑嬉事']

  const latestBooks = books.slice(0, homeModuleLimit)
  const coverBooks = books.slice(0, 8)
  const rankBooks = books.slice(0, 16)

  return (
    <div className="mod-top-wr" style={{ minWidth: 1200, color: '#666', fontFamily: '"宋体", Arial, "Segoe UI", sans-serif', fontSize: 12, lineHeight: 1.5 }}>
      {/* 源站 .mod-top-frame — logo + search */}
      <div className="mod-top-frame">
        <div className="mod-top-tool-wr ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', height: 127, display: 'flex', alignItems: 'center', padding: '0 16px', boxSizing: 'border-box' }}>
          <div className="mod-top-logo-wr" style={{ display: 'flex', alignItems: 'center', width: 384, height: 127 }}>
            <h1 className="mod-top-logo" style={{ width: '100%', height: 110, margin: 0, padding: 0 }}>
              <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} title={site.name} style={{ display: 'flex', alignItems: 'center', fontSize: 36, fontWeight: 700, color: '#fa8729', textDecoration: 'none', height: '100%' }}>
                {site.name}
              </a>
            </h1>
          </div>
          <div className="mod-top-search-wr" style={{ flex: 1, marginTop: 32, maxWidth: 470 }}>
            <form className="mod-top-search" onSubmit={(e) => e.preventDefault()} style={{ position: 'relative', height: 44, padding: 4, margin: '0 0 5px 0', background: '#ece8e6', zIndex: 10, display: 'flex' }}>
              <div className="mod-search-input-wr" style={{ position: 'relative', flex: 1, height: 42, border: '1px solid #dcd8d4', borderRight: 'none', background: '#fff' }}>
                <input
                  type="text"
                  name="key"
                  placeholder="可搜索小说名/作者名"
                  style={{ position: 'absolute', zIndex: 12, width: '100%', height: '100%', padding: '0 12px', background: 'none', border: 'none', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <button type="submit" style={{ width: 74, height: 44, border: 0, background: '#f1854b', color: '#fff', cursor: 'pointer', borderRadius: '0 2px 2px 0', fontSize: 16 }}>
                搜索
              </button>
            </form>
            <ul className="mod-top-tag" style={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: '6px 0 0 6px', gap: 10 }}>
              {HOT_SEARCH.map((kw) => (
                <li key={kw}>
                  <a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: kw }) }} style={{ color: '#717171', textDecoration: 'none', fontSize: 12 }}>
                    {kw}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* 源站 .mod-top-nav-wr — 橙色导航条 */}
      <div className="mod-top-nav-wr" style={{ height: 58, background: 'linear-gradient(180deg, #f1854b 0%, #ec5245 100%)' }}>
        <div className="mod-top-nav ui-wm" style={{ position: 'relative', width: 1200, maxWidth: '100%', margin: '0 auto', padding: '0 16px', boxSizing: 'border-box' }}>
          <ul className="mod-top-nav-list" style={{ display: 'flex', listStyle: 'none', padding: 0, margin: 0, height: 54, marginTop: 2 }}>
            {visibleNav.map((item, i) => (
              <li key={item.name} style={{ height: 54 }}>
                <a
                  href={item.href}
                  onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
                  style={{
                    height: 54,
                    lineHeight: '54px',
                    display: 'block',
                    paddingLeft: 20,
                    position: 'relative',
                    textDecoration: 'none',
                  }}
                >
                  <span style={{ display: 'block', padding: '0 27px 0 6px', lineHeight: '54px', fontFamily: '"微软雅黑"', fontSize: 16, color: '#fff' }}>
                    {item.name}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <div className="mod-top-nav-tool" style={{ float: 'right', marginTop: 10, marginRight: 0, display: 'flex', alignItems: 'center', height: 54 }}>
            <a href="#" style={{ color: '#fff', fontSize: 15, textAlign: 'center', fontWeight: 700, textDecoration: 'none' }}>
              域名发布页
            </a>
          </div>
        </div>
      </div>

      {/* 源站 .mod-tags-wr — 独家推荐 + 排行榜 */}
      <div className="mod-tags-wr ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', padding: 16, boxSizing: 'border-box', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* 独家推荐 (左: 4 个 book 卡) */}
        <div style={{ flex: '1 1 800px', minWidth: 320 }}>
          <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#333', margin: '0 0 12px', paddingBottom: 8, borderBottom: '2px solid #f1854b' }}>
              独家推荐
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
              {coverBooks.map((b) => (
                <div key={b.id} className="mod-cover-list" style={{ textAlign: 'center' }}>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                    className="mod-cover-list-thumb"
                    style={{ display: 'block', position: 'relative', width: '100%', height: 220, background: '#fff', overflow: 'hidden', borderRadius: 2 }}
                  >
                    <BookCover name={b.name} cover={b.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
                  </a>
                  <h5 style={{ margin: '8px 0 4px', fontSize: 13, fontWeight: 700 }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#333', textDecoration: 'none' }}>
                      {b.name}
                    </a>
                  </h5>
                  <p className="mod-cover-list-intro" style={{ fontSize: 12, color: '#999', margin: '2px 0' }}>{b.author}</p>
                  <p style={{ fontSize: 11, color: '#fa8729', margin: '2px 0' }}>{b.category}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 最近更新列表 (biquge 风格表格) */}
          <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 16, marginTop: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#333', margin: '0 0 12px', paddingBottom: 8, borderBottom: '2px solid #f1854b' }}>
              最近更新
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f6f6f6', color: '#666' }}>
                  <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>类别</th>
                  <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>书名</th>
                  <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>最新章节</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>作者</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400 }}>更新</th>
                </tr>
              </thead>
              <tbody>
                {latestBooks.slice(0, 16).map((b) => (
                  <tr key={b.id} style={{ borderTop: '1px dashed #eee' }}>
                    <td style={{ padding: '6px 6px', color: '#fa8729', fontSize: 12, whiteSpace: 'nowrap' }}>[{b.category}]</td>
                    <td style={{ padding: '6px 6px' }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#333', textDecoration: 'none' }}>{b.name}</a>
                    </td>
                    <td style={{ padding: '6px 6px', color: '#999', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.latestChapter || '—'}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.author}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: '#999', whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 热门排行榜 (右) */}
        <div className="in-rank-wr" style={{ flex: '0 0 320px', minWidth: 280 }}>
          <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #f1854b', paddingBottom: 8, marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#333', margin: 0 }}>热门排行</h2>
              <ul style={{ display: 'flex', listStyle: 'none', padding: 0, margin: '0 0 0 auto', gap: 6, fontSize: 12 }}>
                <li style={{ background: '#f1854b', color: '#fff', padding: '2px 8px', borderRadius: 2 }}>月榜</li>
                <li style={{ color: '#999', padding: '2px 8px' }}>周榜</li>
                <li style={{ color: '#999', padding: '2px 8px' }}>日榜</li>
              </ul>
            </div>
            <ol className="in-rank-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {rankBooks.map((b, i) => (
                <li key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed #eee', fontSize: 13 }}>
                  <sub style={{
                    flexShrink: 0,
                    width: 18,
                    height: 18,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    background: i < 3 ? '#f1854b' : '#cccccc',
                    color: '#fff',
                    verticalAlign: 'middle',
                    borderRadius: 2,
                  }}>
                    {i + 1}
                  </sub>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} className="in-rank-name" style={{ flex: 1, color: '#333', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name}
                  </a>
                  <span style={{ color: '#999', fontSize: 11, flexShrink: 0 }}>{b.author}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* 源站 .mod-footer-wr — 橙色 footer */}
      <div className="mod-footer-wr" style={{ position: 'relative', paddingTop: 34, background: '#f69057', marginTop: 32 }}>
        <div className="mod-footer-border" style={{ position: 'absolute', top: -10, width: '100%', height: 10, background: 'linear-gradient(90deg, transparent, #fa8729, transparent)' }} />
        <div className="mod-footer-main-wr" style={{ minHeight: 64 }}>
          <div className="mod-footer-main ui-wm" style={{ width: 1200, maxWidth: '100%', margin: '0 auto', padding: '16px 16px', textAlign: 'center' }}>
            <div style={{ marginBottom: 8 }}>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fff', textDecoration: 'none', margin: '0 8px', fontSize: 13 }}>首页</a>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>|</span>
              <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 8px', fontSize: 13 }}>排行榜</a>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>|</span>
              <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 8px', fontSize: 13 }}>书库</a>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>|</span>
              <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 8px', fontSize: 13 }}>标签</a>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>|</span>
              <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 8px', fontSize: 13 }}>作者</a>
            </div>
            <div className="mod-footer-info" style={{ color: '#fff', fontSize: 12, lineHeight: '22px', textAlign: 'center' }}>
              本站所有小说为完本转载作品，所有内容版权归版权方或原作者所有。
            </div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 8 }}>
              Copyright © {new Date().getFullYear()} {site.name} · {site.domain} · 共收录 {formatWords(books.reduce((s, b) => s + (b.wordCount || 0), 0))}小说
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
