// trxsw (同人小说网, 域名已过期) 首页 1:1 克隆 — 使用源站 CSS class 名 (.vlist/.detail/.content/.pager/.headline/.intro)
// 源站 CSS: /clone-css/trxsw.css (CSS 变量风格, 现代简洁)
// 实测颜色: --bg #f5f7fa / --surface #ffffff / --text #333 / --muted #888 / --primary #2c7be5 / --primary-dark #1a5fb4 / --border #e0e6ed / --radius 4px
// 源站 DOM 反查: .headline (区块标题) + .vlist (列表 li) + .detail (详情 flex) + .intro (简介) + .content (正文) + .pager (翻页)
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'
import { BookCover } from '../../BookCover'

function Skeleton() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px' }}>
      <div style={{ background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4, padding: 24, marginBottom: 12 }}>
        <div style={{ height: 28, background: '#f0f3f9', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 60, background: '#f0f3f9', borderRadius: 4 }} />
      </div>
    </div>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 8, homeModuleLimit = 20 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站导航项 (从 CSS 风格推测为现代小说站通用分类)
  const NAV_ITEMS = [
    { name: '首页', href: '/' },
    { name: '玄幻', href: '/xuanhuan/' },
    { name: '武侠', href: '/wuxia/' },
    { name: '都市', href: '/dushi/' },
    { name: '历史', href: '/lishi/' },
    { name: '科幻', href: '/kehuan/' },
    { name: '同人', href: '/tongren/' },
    { name: '完本', href: '/quanben/' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  const latestBooks = books.slice(0, Math.max(homeModuleLimit, 16))
  const hotBooks = books.slice(0, 6)
  const rankBooks = books.slice(0, 10)

  return (
    <div style={{ background: '#f5f7fa', color: '#333', fontFamily: '"Microsoft YaHei", Arial, sans-serif', fontSize: 14, lineHeight: 1.6, minHeight: '100%' }}>
      {/* 源站 .header — logo + 导航 + 搜索 */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e0e6ed', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <div className="container" style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} className="logo" style={{ fontSize: 22, fontWeight: 700, color: '#2c7be5', textDecoration: 'none', flexShrink: 0 }}>
            {site.name}
          </a>
          <nav style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, minWidth: 200 }}>
            {visibleNav.map((item, i) => (
              <a
                key={item.name}
                href={item.href}
                onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
                style={{ padding: '6px 12px', color: i === 0 ? '#fff' : '#333', background: i === 0 ? '#2c7be5' : 'transparent', borderRadius: 4, textDecoration: 'none', fontSize: 14, fontWeight: i === 0 ? 600 : 400 }}
              >
                {item.name}
              </a>
            ))}
          </nav>
          <form onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', gap: 0, minWidth: 240 }}>
            <input
              type="text"
              name="q"
              placeholder="搜索小说/作者"
              style={{ flex: 1, height: 32, padding: '0 12px', border: '1px solid #e0e6ed', borderRadius: '4px 0 0 4px', outline: 'none', fontSize: 14, background: '#f5f7fa' }}
            />
            <button type="submit" style={{ height: 32, padding: '0 16px', border: 'none', background: '#2c7be5', color: '#fff', borderRadius: '0 4px 4px 0', cursor: 'pointer', fontSize: 14 }}>搜索</button>
          </form>
        </div>
      </header>

      <div className="container" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px' }}>
        {/* .headline 热门推荐 */}
        <section style={{ marginBottom: 16 }}>
          <h2 className="headline" style={{ display: 'flex', alignItems: 'center', fontSize: 18, fontWeight: 700, color: '#333', margin: '0 0 12px', padding: '0 0 8px', borderBottom: '2px solid #2c7be5' }}>
            <span style={{ display: 'inline-block', width: 4, height: 18, background: '#2c7be5', marginRight: 8, borderRadius: 2 }} />
            热门推荐
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {hotBooks.map((b) => (
              <a
                key={b.id}
                href="#"
                onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                style={{ background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4, padding: 12, textDecoration: 'none', color: '#333', display: 'block', transition: 'box-shadow 0.2s' }}
              >
                <div style={{ width: '100%', aspectRatio: '3/4', marginBottom: 8, borderRadius: 4, overflow: 'hidden' }}>
                  <BookCover name={b.name} cover={b.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{b.author}</div>
                <div style={{ fontSize: 11, color: '#2c7be5', marginTop: 4 }}>
                  <span style={{ background: '#e8f1ff', padding: '1px 6px', borderRadius: 2 }}>{b.category}</span>
                  <span style={{ marginLeft: 6, color: '#888' }}>{formatWords(b.wordCount)}</span>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* .headline 最新更新 + .vlist */}
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
          <div>
            <h2 className="headline" style={{ display: 'flex', alignItems: 'center', fontSize: 18, fontWeight: 700, color: '#333', margin: '0 0 12px', padding: '0 0 8px', borderBottom: '2px solid #2c7be5' }}>
              <span style={{ display: 'inline-block', width: 4, height: 18, background: '#2c7be5', marginRight: 8, borderRadius: 2 }} />
              最新更新
            </h2>
            <div style={{ background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4 }}>
              <ul className="vlist" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {latestBooks.map((b) => (
                  <li key={b.id} style={{ padding: '8px 12px', borderBottom: '1px solid #e0e6ed', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ color: '#2c7be5', fontSize: 11, background: '#e8f1ff', padding: '1px 6px', borderRadius: 2, flexShrink: 0 }}>{b.category}</span>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#333', textDecoration: 'none', flexShrink: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {b.name}
                    </a>
                    <span style={{ color: '#888', fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.latestChapter || '暂无章节'}
                    </span>
                    <span style={{ color: '#888', fontSize: 11, flexShrink: 0 }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 右侧排行 */}
          <aside>
            <h2 className="headline" style={{ display: 'flex', alignItems: 'center', fontSize: 16, fontWeight: 700, color: '#333', margin: '0 0 12px', padding: '0 0 8px', borderBottom: '2px solid #2c7be5' }}>
              <span style={{ display: 'inline-block', width: 4, height: 16, background: '#2c7be5', marginRight: 8, borderRadius: 2 }} />
              阅读排行榜
            </h2>
            <div style={{ background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4 }}>
              <ul className="vlist" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {rankBooks.map((b, i) => (
                  <li key={b.id} style={{ padding: '8px 12px', borderBottom: '1px solid #e0e6ed', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{
                      flexShrink: 0,
                      width: 18,
                      height: 18,
                      borderRadius: 2,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: i < 3 ? '#fff' : '#888',
                      background: i === 0 ? '#2c7be5' : i === 1 ? '#1a5fb4' : i === 2 ? '#7ba9ef' : '#e8f1ff',
                    }}>
                      {i + 1}
                    </span>
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#333', textDecoration: 'none', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </section>
      </div>

      {/* 源站 .footer */}
      <footer style={{ background: '#fff', borderTop: '1px solid #e0e6ed', padding: '20px 16px', textAlign: 'center', color: '#888', fontSize: 12, marginTop: 24 }}>
        <p style={{ margin: 0 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2c7be5', textDecoration: 'none' }}>{site.name}</a>
          &nbsp;·&nbsp;<a href="#" style={{ color: '#2c7be5', textDecoration: 'none' }}>关于我们</a>
          &nbsp;·&nbsp;<a href="#" style={{ color: '#2c7be5', textDecoration: 'none' }}>网站地图</a>
          &nbsp;·&nbsp;<a href="#" style={{ color: '#2c7be5', textDecoration: 'none' }}>免责声明</a>
        </p>
        <p style={{ margin: '6px 0 0' }}>
          Copyright © {new Date().getFullYear()} {site.name}({site.domain}) All Rights Reserved · {formatWords(books.reduce((s, b) => s + (b.wordCount || 0), 0))}小说
        </p>
      </footer>
    </div>
  )
}
