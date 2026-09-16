// ============================================================
// clone-themes/23qb — 铅笔小说 23qb.net 1:1 真克隆
// 实测 probe-html2/probe-23qb.{html,css} (mxstatic 模板, 9222 行 CSS)
// 硬编码源站实际 CSS 变量值 (不用 theme.vars):
//   body { background:#f8f9f9; color:#282828; font-family: -apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif }
//   a { color:#282828; text-decoration:none; }
//   a:hover { color:#ff2a14; }
//   .header-content { box-shadow: 0 7px 21px rgba(149,157,165,0.22); border-bottom: 1px #eaedf1; }
//   .nav-menu-item { padding: 0 11px; font-size: 16px; font-weight: 700; }
//   .nav-menu-item-name { color: #282828; }
//   .module-item { width: 200px; margin: 0 20px 20px 0; font-size: 14px; }
//   .module-item-cover { padding-top: 140%; border-radius: 5px; }
//   .module-item-caption { background: linear-gradient(rgba(0,0,0,0.68)->transparent); }
//   .block-box-item { background: #eaedf1; padding: 15px; border-radius: 10px; }
//   radius: 5px
// DOM 结构 (mxstatic):
//   header#header.wrapper > .header-content (logo + .nav-search + .nav .nav-menu-items 14 分类)
//   .header-module (额外 drop 分类 + 用户中心)
//   main#main.wrapper > .content > .list > .box > .module > .module-list .module-items .module-item*
//   footer#footer.wrapper (sitemap + 版权)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { BookGridSkeleton } from '../../bits'
import type { HomeCloneProps } from '../shared-props'
import type { ReactNode } from 'react'

const FONT_STACK = '-apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif'
const BG = '#f8f9f9'
const INK = '#282828'
const MUTED = '#888888'
const HOVER = '#ff2a14'
const BORDER = '#eaedf1'
const RADIUS = '5px'

const NAV_ITEMS = ['首页', '言情', '都市', '唯美', '玄幻', '武侠', '历史', '科幻', '游戏', '竞技', '悬疑', '同人', '职场', '其他']

function Header() {
  return (
    <header id="header" className="wrapper" style={{ background: '#fff', boxShadow: '0 7px 21px rgba(149,157,165,0.22)', borderBottom: `1px solid ${BORDER}` }}>
      <div className="header-content" style={{ maxWidth: '1200px', margin: '0 auto', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div className="header-logo">
            <h1 className="slogan" style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: INK }}>
              <a href="/" style={{ color: INK, textDecoration: 'none' }}>铅笔小说</a>
            </h1>
          </div>
          <div className="nav-search" style={{ flex: 1, minWidth: '260px', display: 'flex' }}>
            <input type="search" placeholder="搜索喜欢的小说、作者、标签" style={{ flex: 1, height: '40px', padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: RADIUS, fontSize: '14px' }} />
            <button type="submit" style={{ background: '#fff', border: `1px solid ${BORDER}`, borderLeft: 'none', padding: '0 14px', cursor: 'pointer' }} aria-label="搜索">🔍</button>
          </div>
          <a href="/login.php" style={{ color: INK, fontSize: '14px', textDecoration: 'none' }}>会员中心</a>
        </div>
        <div className="nav" style={{ marginTop: '12px' }}>
          <ul className="nav-menu-items" style={{ display: 'flex', flexWrap: 'wrap', gap: '0', listStyle: 'none', margin: 0, padding: 0 }}>
            {NAV_ITEMS.map((n, i) => (
              <li key={n} className="nav-menu-item" style={{ padding: '0 11px', fontSize: '16px', fontWeight: 700 }} >
                <a href="javascript:;" style={{ color: i === 0 ? HOVER : INK, textDecoration: 'none' }}>{n}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </header>
  )
}

function ModuleItem({ book, no }: { book: { id: string; name: string; author: string; cover?: string | null; category: string; wordCount?: number; intro?: string }; no: number }) {
  const { navigate } = usePublic()
  return (
    <div className="module-item" style={{ width: '200px', margin: '0 20px 20px 0', fontSize: '14px' }}>
      <div className="module-item-cover" style={{ position: 'relative', paddingTop: '140%', borderRadius: RADIUS, overflow: 'hidden', background: '#eee' }}>
        <div className="module-item-top" style={{ position: 'absolute', top: '6px', left: '6px', fontSize: '12px', color: '#fff', background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: RADIUS, zIndex: 2 }}>{no}</div>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} title={book.name} style={{ position: 'absolute', inset: 0 }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </a>
      </div>
      <div className="module-item-titlebox" style={{ marginTop: '6px' }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} title={book.name} className="module-item-title" style={{ color: INK, textDecoration: 'none', fontSize: '14px', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.name}</a>
        <div className="module-item-text" style={{ fontSize: '12px', color: MUTED, marginTop: '2px' }}>{book.author}</div>
      </div>
    </div>
  )
}

function RankList({ title, books, icon }: { title: string; books: { id: string; name: string }[]; icon: string }) {
  const { navigate } = usePublic()
  return (
    <div className="list-item" style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
      <h5 className="item-title" style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 700, color: INK }}>{icon} {title}</h5>
      {books.map((b, i) => (
        <a key={b.id} href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} title={b.name} className="item" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px dashed #f0f0f0', textDecoration: 'none', color: INK }}>
          <span className={`order ${i < 3 ? (i === 0 ? 'one' : i === 1 ? 'two' : 'three') : ''}`} style={{ display: 'inline-block', minWidth: '20px', textAlign: 'center', fontSize: '13px', color: i < 3 ? HOVER : MUTED, fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</span>
          <span className="keyword" style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
        </a>
      ))}
    </div>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps): ReactNode {
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh' }}>
        <Header />
        <div style={{ maxWidth: '1200px', margin: '14px auto', padding: '14px' }}>
          <BookGridSkeleton count={8} />
        </div>
      </div>
    )
  }

  const top = books.slice(0, 16)
  const rankYanqing = books.slice(0, 10)
  const rankXuanhuan = books.slice(10, 20)

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <Header />
      <main id="main" className="wrapper" style={{ maxWidth: '1200px', margin: '0 auto', padding: '14px' }}>
        <div className="content">
          {/* 推荐: 16 封面卡 */}
          <div className="list">
            <div className="box">
              <div className="module">
                <div className="module-list module-lines-list">
                  <div className="module-items" style={{ display: 'flex', flexWrap: 'wrap' }}>
                    {top.map((b, i) => <ModuleItem key={b.id} book={b} no={i + 1} />)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '20px' }}>
            <RankList title="言情小说" books={rankYanqing} icon="🔥" />
            <RankList title="玄幻小说" books={rankXuanhuan} icon="🔥" />
          </div>
        </div>
      </main>
      <footer id="footer" className="wrapper" style={{ background: '#fff', borderTop: `1px solid ${BORDER}`, padding: '20px 14px', textAlign: 'center' }}>
        <p className="sitemap" style={{ margin: '0 0 8px', fontSize: '13px' }}>
          <a href="/rss.xml" style={{ color: INK, textDecoration: 'none', margin: '0 6px' }}>RSS</a>
          <span style={{ margin: '0 6px', color: BORDER }}>|</span>
          <a href="/rss/google.xml" style={{ color: INK, textDecoration: 'none', margin: '0 6px' }}>Google</a>
          <span style={{ margin: '0 6px', color: BORDER }}>|</span>
          <a href="/rss/bing.xml" style={{ color: INK, textDecoration: 'none', margin: '0 6px' }}>Bing</a>
        </p>
        <p style={{ margin: 0, color: MUTED, fontSize: '13px' }}>铅笔小说 · 最值得书友收藏的网络小说阅读网</p>
      </footer>
    </div>
  )
}
