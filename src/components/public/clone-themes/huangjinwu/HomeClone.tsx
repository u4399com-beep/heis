<<<<<<< HEAD
// ============================================================
// clone-themes/huangjinwu — 黄金屋 huangjinwu.org 1:1 真克隆
// 实测 probe-html2/probe-huangjinwu.{html,css} (default 模板, :root 23 变量)
// 硬编码源站实际 CSS 变量值 (不用 theme.vars):
//   --bg-color: #f0f4fb / --bg-gradient: linear-gradient(180deg,#f5f8ff 0%,#eef3fb 100%);
//   --card-bg: #fff / --header-bg: rgba(255,255,255,.92)
//   --footer-bg: #e2eaf5 / --hover-color: #e8f1ff
//   --primary-color: #0f172a (深墨色, 用于 a 颜色)
//   --secondary-color: #2563eb (蓝, 用于 hover + navbar active)
//   --logo-color: #1d4ed8 / --text-color: #1e293b / --text-light: #64748b
//   --text-muted: #94a3b8 / --border-color: #dbe4f0
//   --shadow: 0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(37,99,235,.06)
//   --border-radius: 6px / --border-radius-lg: 10px
//   --font-family-ui: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica Neue", Arial, sans-serif
// DOM 结构 (default 模板):
//   .header-group > .headers (backdrop-blur header) > .container > .navbar (logo + .navbar-menu 7 项 + .navbar-search)
//   .main-content > .container > .hot-section (热门推荐) > .book-grid .book-card
//   footer (.footer-bg #e2eaf5)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { BookGridSkeleton } from '../../bits'
import { formatWords } from '../../seo'
import type { HomeCloneProps } from '../shared-props'
import type { ReactNode } from 'react'

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
const BG = 'linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%)'
const INK = '#1e293b'
const MUTED = '#64748b'
const TEXT_MUTED = '#94a3b8'
const PRIMARY = '#2563eb'
const LOGO = '#1d4ed8'
const BORDER = '#dbe4f0'
const CARD_BG = '#fff'
const HEADER_BG = 'rgba(255,255,255,0.92)'
const FOOTER_BG = '#e2eaf5'
const HOVER_BG = '#e8f1ff'
const SHADOW = '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)'
const RADIUS = '6px'
const RADIUS_LG = '10px'

const NAV_ITEMS = ['首页', '排行榜', '书库', '标签', '作者', '电子书', '搜索']

function Header() {
  return (
    <div className="header-group" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
      <div className="headers" style={{ backdropFilter: 'saturate(1.2) blur(12px)', background: HEADER_BG, borderBottom: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
        <div className="container" style={{ maxWidth: '1180px', margin: '0 auto', padding: '12px 16px' }}>
          <div className="navbar" style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <a href="/" className="logo" style={{ color: LOGO, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>
              <span style={{ marginRight: '6px' }}>📚</span>黄金屋
            </a>
            <ul className="navbar-menu" style={{ display: 'flex', gap: '6px', listStyle: 'none', margin: 0, padding: 0, flex: 1, minWidth: 0 }}>
              {NAV_ITEMS.map((n, i) => (
                <li key={n}>
                  <a href="javascript:;" style={{ color: i === 0 ? '#fff' : INK, padding: '8px 14px', borderRadius: RADIUS_LG, fontSize: '14px', textDecoration: 'none', display: 'inline-block', background: i === 0 ? PRIMARY : 'transparent', fontWeight: i === 0 ? 600 : 400 }}>{n}</a>
                </li>
              ))}
            </ul>
            <form className="navbar-search" style={{ display: 'flex', minWidth: '240px', flex: 0 }} onSubmit={(e) => e.preventDefault()}>
              <input className="navbar-search-input" type="text" placeholder="可搜书名、作者、角色" style={{ flex: 1, height: '38px', padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: RADIUS, fontSize: '14px' }} />
              <button className="navbar-search-btn" type="submit" style={{ background: PRIMARY, color: '#fff', border: 'none', padding: '0 14px', cursor: 'pointer', borderRadius: RADIUS }}>搜索</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

function BookCard({ book }: { book: { id: string; name: string; author: string; intro: string; cover?: string | null; category: string; wordCount?: number } }) {
  const { navigate } = usePublic()
  return (
    <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} title={book.name} className="book-card" style={{ display: 'flex', gap: '12px', padding: '14px', borderRadius: RADIUS_LG, background: CARD_BG, border: `1px solid ${BORDER}`, textDecoration: 'none', color: INK, transition: 'background .2s' }}>
      <div style={{ flexShrink: 0 }}>
        <BookCover name={book.name} cover={book.cover} className="book-cover" />
      </div>
      <div className="book-info" style={{ flex: 1, minWidth: 0 }}>
        <div className="book-title" style={{ fontSize: '16px', fontWeight: 600, color: INK, marginBottom: '4px' }}>{book.name}</div>
        <div className="book-author" style={{ fontSize: '13px', color: MUTED, marginBottom: '6px' }}>作者：{book.author}</div>
        <div className="book-desc" style={{ fontSize: '13px', color: MUTED, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: '8px' }}>{book.intro}</div>
        <div className="book-badges" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span className="book-badge category" style={{ background: HOVER_BG, color: PRIMARY, padding: '2px 8px', borderRadius: RADIUS, fontSize: '12px' }}>{book.category}</span>
          <span className="book-badge words" style={{ background: '#f1f5f9', color: MUTED, padding: '2px 8px', borderRadius: RADIUS, fontSize: '12px' }}>{formatWords(book.wordCount)}</span>
        </div>
      </div>
    </a>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps): ReactNode {
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh' }}>
        <Header />
        <div style={{ maxWidth: '1180px', margin: '14px auto', padding: '14px' }}>
          <BookGridSkeleton count={8} />
        </div>
      </div>
    )
  }

  const hot = books.slice(0, 6)
  const list1 = books.slice(6, 18)
  const list2 = books.slice(18, 30)

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <Header />
      <div className="main-content" style={{ maxWidth: '1180px', margin: '0 auto', padding: '20px 16px' }}>
        <div className="container">
          {/* 热门推荐 */}
          <section className="hot-section" style={{ marginBottom: '20px' }}>
            <h2 className="page-title" style={{ fontSize: '20px', fontWeight: 700, color: INK, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: PRIMARY }}>🔥</span>热门推荐
            </h2>
            <div className="book-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              {hot.map((b) => <BookCard key={b.id} book={b} />)}
            </div>
          </section>

          <section style={{ marginBottom: '20px' }}>
            <h2 className="page-title" style={{ fontSize: '20px', fontWeight: 700, color: INK, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: PRIMARY }}>📚</span>最近更新
            </h2>
            <div className="book-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              {list1.map((b) => <BookCard key={b.id} book={b} />)}
            </div>
          </section>

          <section>
            <h2 className="page-title" style={{ fontSize: '20px', fontWeight: 700, color: INK, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: PRIMARY }}>⭐</span>完本推荐
            </h2>
            <div className="book-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              {list2.map((b) => <BookCard key={b.id} book={b} />)}
            </div>
          </section>
        </div>
      </div>
      <footer style={{ background: FOOTER_BG, padding: '20px 14px', textAlign: 'center', color: MUTED, fontSize: '13px' }}>
        <p style={{ margin: '0 0 6px' }}>书中自有颜如玉，书中自有黄金屋</p>
        <p style={{ margin: 0, color: TEXT_MUTED }}>Copyright © 黄金屋 huangjinwu.org All Rights Reserved</p>
      </footer>
=======
// huangjinwu.org (黄金屋) 首页 1:1 克隆 — default 模板
// 源站 CSS: /clone-css/huangjinwu.css (static/default/style.css)
// 源站 DOM: .header-group(.headers .container .navbar) > .main-content .container(.hot-section .book-grid + .sort-section .category-ranking-grid + .update-section .book-grid + .detail-section .chapter-list) > .footers
// 实测颜色: --bg-color #f0f4fb / --secondary-color #2563eb / --logo-color #1d4ed8 / --card-bg #fff / --header-bg rgba(255,255,255,.92)
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

function Skeleton() {
  return (
    <div className="container" style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, padding: 24, marginBottom: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)' }}>
        <div style={{ height: 28, background: '#f5f8ff', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 36, background: '#f5f8ff', borderRadius: 4 }} />
      </div>
    </div>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 7, homeModuleLimit = 18 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站 .navbar-menu 实测导航项 (probe-huangjinwu.html)
  const NAV_ITEMS = [
    { name: '首页', href: '/' },
    { name: '排行榜', href: '/rank' },
    { name: '书库', href: '/list' },
    { name: '标签', href: '/tag' },
    { name: '作者', href: '/author' },
    { name: '电子书', href: '/dzss' },
    { name: '搜索', href: '/search' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  const hotBooks = books.slice(0, homeModuleLimit)
  const updateBooks = books.slice(0, homeModuleLimit)
  // 3 个分类榜单
  const rankSections = [
    { title: '玄幻小说榜', items: books.slice(0, 10) },
    { title: '仙侠小说榜', items: books.slice(8, 18) },
    { title: '都市小说榜', items: books.slice(4, 14) },
  ]

  return (
    <div style={{ background: '#f0f4fb', color: '#1e293b', fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 16, minHeight: '100%' }}>
      {/* 源站 .header-group — 顶部 sticky 头部 */}
      <div className="header-group" style={{ isolation: 'isolate', position: 'sticky', top: 0, zIndex: 1001 }}>
        <div className="headers" style={{ background: 'rgba(255,255,255,0.92)', borderBottom: '1px solid #dbe4f0', boxShadow: '0 1px 0 rgba(220,228,240,0.4), 0 8px 32px rgba(15,23,42,0.06)', backdropFilter: 'saturate(1.2) blur(12px)' }}>
          <div className="container" style={{ maxWidth: 1180, margin: '0 auto', padding: '0 1.6rem' }}>
            <div className="navbar" style={{ display: 'flex', alignItems: 'center', gap: '1.6rem', padding: '1.6rem 0', position: 'relative' }}>
              <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} className="logo" title={site.name} style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto', fontSize: 20, fontWeight: 600, color: '#1d4ed8', textDecoration: 'none', gap: 8 }}>
                <span>📚</span>
                <span>{site.name}</span>
              </a>
              <nav className="navbar-menu" style={{ flex: 1, display: 'flex', listStyle: 'none', padding: 0, margin: 0, gap: '0.4rem', overflowX: 'auto' }}>
                {visibleNav.map((item, i) => (
                  <li key={item.name} style={{ flexShrink: 1, minWidth: 0 }}>
                    <a
                      href={item.href}
                      onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
                      style={{
                        display: 'block',
                        padding: '0.6rem 1.6rem',
                        borderRadius: 10,
                        color: '#1e293b',
                        fontSize: 16,
                        fontWeight: 500,
                        textDecoration: 'none',
                        background: i === 0 ? '#2563eb' : 'transparent',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      <span style={{ color: i === 0 ? '#fff' : '#1e293b' }}>{item.name}</span>
                    </a>
                  </li>
                ))}
              </nav>
              {/* 搜索 */}
              <form className="navbar-search" onSubmit={(e) => e.preventDefault()} style={{ position: 'relative', flex: '0 0 auto' }}>
                <input
                  className="navbar-search-input"
                  type="text"
                  placeholder="可搜书名、作者、角色"
                  name="keyword"
                  style={{
                    width: 200,
                    height: 36,
                    background: '#f0f4fb',
                    border: '1px solid #dbe4f0',
                    borderRadius: 10,
                    color: '#1e293b',
                    fontSize: 14,
                    outline: 0,
                    padding: '0 36px 0 16px',
                    boxSizing: 'border-box',
                  }}
                />
                <button type="submit" aria-label="搜索" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}>🔍</button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* 源站 .main-content */}
      <div className="main-content" style={{ minHeight: 'calc(100vh - 173px)', padding: '32px 0' }}>
        <div className="container" style={{ maxWidth: 1180, margin: '0 auto', padding: '0 16px' }}>
          {/* .hot-section 热门推荐 */}
          <section className="hot-section" style={{ marginBottom: '3.2rem' }}>
            <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', color: '#1e293b', fontSize: 21, fontWeight: 600, marginBottom: '2rem', paddingLeft: '1.6rem', borderLeft: '4px solid #2563eb', borderRadius: '2px 0 0 2px', letterSpacing: '-0.02em' }}>
              🔥 热门推荐
            </h2>
            <div className="book-grid" style={{ display: 'grid', gap: '2.4rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginBottom: '3.2rem' }}>
              {hotBooks.map((b) => (
                <a
                  key={b.id}
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                  title={b.name}
                  className="book-card"
                  style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)', color: '#1e293b', display: 'block', overflow: 'hidden', textDecoration: 'none', transition: 'transform 0.25s, box-shadow 0.3s' }}
                >
                  <div className="book-info" style={{ padding: '1.6rem' }}>
                    <div className="book-title" style={{ color: '#1e293b', fontSize: 16, fontWeight: 500, lineHeight: 1.4, marginBottom: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name}
                    </div>
                    <div className="book-author" style={{ color: '#64748b', fontSize: 14, marginBottom: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      作者：{b.author}
                    </div>
                    <div className="book-desc" style={{ color: '#64748b', fontSize: 14, lineHeight: 1.5, marginBottom: '1.2rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2.55em' }}>
                      {b.intro || '暂无简介'}
                    </div>
                    <div className="book-badges" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.8rem', marginTop: '1.2rem' }}>
                      <span className="book-badge category" style={{ background: '#2563eb', color: '#fff', borderRadius: 10, padding: '0.4rem 1.2rem', fontSize: 12, fontWeight: 500, lineHeight: 1.5 }}>{b.category}</span>
                      <span className="book-badge status" style={{ background: '#e8f1ff', border: '1px solid #dbe4f0', color: '#1e293b', borderRadius: 10, padding: '0.4rem 1.2rem', fontSize: 12, fontWeight: 500, lineHeight: 1.5 }}>
                        {b.status === 'completed' ? '全本' : '连载'}
                      </span>
                      <span className="book-badge words" style={{ background: 'transparent', border: '1px solid #dbe4f0', color: '#64748b', borderRadius: 10, padding: '0.4rem 1.2rem', fontSize: 12, fontWeight: 500, lineHeight: 1.5 }}>
                        {formatWords(b.wordCount)}
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>

          {/* .sort-section 分类排行榜 */}
          <section className="sort-section" style={{ marginBottom: '3.2rem' }}>
            <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', color: '#1e293b', fontSize: 21, fontWeight: 600, marginBottom: '2rem', paddingLeft: '1.6rem', borderLeft: '4px solid #2563eb', borderRadius: '2px 0 0 2px', letterSpacing: '-0.02em' }}>
              📊 分类排行榜
            </h2>
            <div className="category-ranking-grid" style={{ display: 'grid', gap: '2.4rem', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', marginBottom: '3.2rem' }}>
              {rankSections.map((sec) => (
                <div key={sec.title} className="ranking-module" style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)', overflow: 'hidden' }}>
                  <div className="ranking-module-title" style={{ alignItems: 'center', background: '#f0f4fb', borderBottom: '1px solid #dbe4f0', color: '#1e293b', display: 'flex', fontSize: 18, fontWeight: 600, gap: '0.8rem', padding: '1.4rem 1.6rem' }}>
                    <span style={{ background: '#2563eb', borderRadius: 6, content: '', height: 16, width: 3 }} />
                    {sec.title}
                  </div>
                  <div className="ranking-list" style={{ counterReset: 'ranking-counter', display: 'flex', flexDirection: 'column', listStyle: 'none', padding: '0.4rem 0' }}>
                    {sec.items.map((b, i) => (
                      <div key={b.id} className="ranking-item" style={{ alignItems: 'center', borderBottom: '1px solid #dbe4f0', display: 'flex', gap: '1.2rem', padding: '0.8rem 1.6rem' }}>
                        <span style={{
                          flexShrink: 0,
                          width: 24,
                          height: 24,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: i === 0 ? '#2563eb' : i === 1 ? 'rgba(37,99,235,0.7)' : i === 2 ? 'rgba(37,99,235,0.38)' : '#e8f1ff',
                          color: i < 3 ? '#fff' : '#64748b',
                          fontSize: 14,
                          fontWeight: 600,
                          borderRadius: 10,
                        }}>
                          {i + 1}
                        </span>
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                          className="ranking-title"
                          style={{ color: '#1e293b', flex: 1, fontSize: 16, fontWeight: 500, overflow: 'hidden', textDecoration: 'none', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {b.name}
                        </a>
                        <span className="ranking-author" style={{ color: '#64748b', flexShrink: 0, fontSize: 14, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* .update-section 最新更新 */}
          <section className="update-section" style={{ marginBottom: '3.2rem' }}>
            <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', color: '#1e293b', fontSize: 21, fontWeight: 600, marginBottom: '2rem', paddingLeft: '1.6rem', borderLeft: '4px solid #2563eb', borderRadius: '2px 0 0 2px', letterSpacing: '-0.02em' }}>
              🕒 最新更新
            </h2>
            <div className="book-grid" style={{ display: 'grid', gap: '2.4rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {updateBooks.map((b) => (
                <a
                  key={b.id}
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                  title={b.name}
                  className="book-card"
                  style={{ background: '#fff', border: '1px solid #dbe4f0', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)', color: '#1e293b', display: 'block', overflow: 'hidden', textDecoration: 'none' }}
                >
                  <div className="book-info" style={{ padding: '1.6rem' }}>
                    <div className="book-title" style={{ color: '#1e293b', fontSize: 16, fontWeight: 500, lineHeight: 1.4, marginBottom: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name}
                    </div>
                    <div className="book-author" style={{ color: '#64748b', fontSize: 14, marginBottom: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      作者：{b.author}
                    </div>
                    <div className="book-desc" style={{ color: '#64748b', fontSize: 14, lineHeight: 1.5, marginBottom: '1.2rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2.55em' }}>
                      {b.intro || '暂无简介'}
                    </div>
                    <div className="book-badges" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.8rem', marginTop: '1.2rem' }}>
                      <span style={{ background: '#2563eb', color: '#fff', borderRadius: 10, padding: '0.4rem 1.2rem', fontSize: 12, fontWeight: 500 }}>{b.category}</span>
                      <span style={{ background: '#e8f1ff', border: '1px solid #dbe4f0', color: '#1e293b', borderRadius: 10, padding: '0.4rem 1.2rem', fontSize: 12, fontWeight: 500 }}>
                        {b.status === 'completed' ? '全本' : '连载'}
                      </span>
                    </div>
                    <div className="book-update-time" style={{ borderTop: '1px solid #dbe4f0', color: '#64748b', fontSize: 14, marginTop: '1.2rem', paddingTop: '1.2rem' }}>
                      {b.latestChapter ? `更新至：${b.latestChapter}` : '—'} · {b.updatedAt ? fmtDate(b.updatedAt) : '—'}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>

          {/* .detail-section 最新电子书 (chapter-list) */}
          <section className="detail-section" style={{ marginBottom: '3.2rem' }}>
            <h3 className="section-title" style={{ alignItems: 'center', color: '#1e293b', display: 'flex', fontSize: 18, fontWeight: 600, gap: '0.8rem', marginBottom: '2rem' }}>
              📖 最新电子书
            </h3>
            <ul className="chapter-list chapter-list--all" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {books.slice(0, 24).map((b) => (
                <li key={b.id} className="chapter-item" style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                    title={b.name}
                    style={{ color: '#1e293b', textDecoration: 'none' }}
                  >
                    《{b.name}》{b.author}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* 源站 .footers */}
      <div className="footers" style={{ background: '#e2eaf5', padding: '24px 0', textAlign: 'center' }}>
        <div className="container" style={{ maxWidth: 1180, margin: '0 auto', padding: '0 16px' }}>
          <p className="sitemap" style={{ marginBottom: 8, color: '#1e293b' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#1d4ed8', textDecoration: 'none', margin: '0 6px' }} target="_blank">小说</a>|
            <a href="#" style={{ color: '#1d4ed8', textDecoration: 'none', margin: '0 6px' }} target="_blank">相关小说</a>|
            <a href="#" style={{ color: '#1d4ed8', textDecoration: 'none', margin: '0 6px' }} target="_blank">标签</a>|
            <a href="#" style={{ color: '#1d4ed8', textDecoration: 'none', margin: '0 6px' }} target="_blank">作者</a>|
            <a href="#" style={{ color: '#1d4ed8', textDecoration: 'none', margin: '0 6px' }} target="_blank">电子书</a>|
            <a href="#" style={{ color: '#1d4ed8', textDecoration: 'none', margin: '0 6px' }} target="_blank">相关电子书</a>
          </p>
          <p className="copyright" style={{ color: '#64748b', fontSize: 14, margin: '4px 0' }}>
            本站小说由根据搜索引擎转码，只为让更多读者欣赏，不保存小说内及数据，仅作宣传展示。
          </p>
          <p className="copyright" style={{ color: '#64748b', fontSize: 14, margin: '4px 0' }}>
            Copyright © {new Date().getFullYear()} {site.name} · {site.domain}
          </p>
        </div>
      </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
    </div>
  )
}
