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
    </div>
  )
}
