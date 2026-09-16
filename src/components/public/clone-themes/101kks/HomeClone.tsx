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
    </div>
  )
}
