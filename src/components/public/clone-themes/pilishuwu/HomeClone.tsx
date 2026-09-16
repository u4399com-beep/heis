// ============================================================
// clone-themes/pilishuwu — 霹雳书屋 pilishuwu.com 1:1 真克隆
// 实测 probe-html2/probe-pilishuwu.{html,css} (wmcms-web 模板, 5239 行)
// 硬编码源站实际 CSS 变量值 (不用 theme.vars):
//   body { color: #666; background: transparent; font-family: sans-serif; }
//   .mod-top-search-submit { background-color:#fd8929; color:#fff; }
//   .mod-top-search-submit:hover { background-color:#ec5245; }
//   .nav-list .active { color:#d71704; }
//   .mod-top-tag a:hover { color:#d71704; }
//   radius: 2px (wmcms-web 复古直角风)
// DOM 结构 (wmcms-web):
//   .mod-top-wr > .mod-top-frame (logo + 搜索 + 热搜词) + .mod-top-nav-wr (.mod-top-nav-list)
//   .in-banner-wrap (轮播图)
//   .in-rank-wr (月榜/总榜)
//   .in-strong-wr (独家推荐 + .in-slider-wr 大卡列表)
//   .in-sign-wr (纯爱小说列表)
//   .in-vip-wr (VIP书单)
//   .mod-footer-wr (.mod-footer-info)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { BookGridSkeleton } from '../../bits'
import type { HomeCloneProps } from '../shared-props'
import type { ReactNode } from 'react'

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif'
const BG = '#fdf6ec'
const INK = '#333333'
const MUTED = '#888888'
const PRIMARY = '#fd8929' // 霹雳橙
const ACCENT = '#ec5245' // hover 红橙
const RED = '#d71704' // 红 active
const BORDER = '#ffe4c4'

const NAV_ITEMS = ['首页', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生', '其他']

function TopHeader() {
  return (
    <div className="mod-top-wr" style={{ background: '#fff', borderBottom: `2px solid ${PRIMARY}` }}>
      <div className="mod-top-frame" style={{ maxWidth: '1200px', margin: '0 auto', padding: '14px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <h1 className="mod-top-logo" style={{ margin: 0 }}>
          <a href="/" style={{ color: PRIMARY, fontSize: '24px', fontWeight: 700, textDecoration: 'none' }}>霹雳书屋</a>
        </h1>
        <div className="mod-top-search-wr" style={{ flex: 1, minWidth: '280px', display: 'flex', gap: '0' }}>
          <input type="text" name="key" placeholder="可搜索小说名/作者名" style={{ flex: 1, height: '40px', padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: '2px 0 0 2px', fontSize: '14px' }} />
          <button type="submit" className="mod-top-search-submit" style={{ background: PRIMARY, color: '#fff', border: 'none', padding: '0 18px', fontSize: '14px', cursor: 'pointer', borderRadius: '0 2px 2px 0' }}>搜索</button>
        </div>
        <ul className="mod-top-tag" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', listStyle: 'none', margin: 0, padding: 0 }}>
          {['全球高考', '我见南山', '人鱼陷落', '死亡万花筒'].map((w) => (
            <li key={w}><a href="javascript:;" style={{ color: MUTED, fontSize: '12px', textDecoration: 'none' }}>{w}</a></li>
          ))}
        </ul>
      </div>
      <div className="mod-top-nav-wr" style={{ background: PRIMARY }}>
        <div className="mod-top-nav" style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 14px', display: 'flex', alignItems: 'center', height: '40px' }}>
          <ul className="mod-top-nav-list" style={{ display: 'flex', gap: '20px', listStyle: 'none', margin: 0, padding: 0 }}>
            {NAV_ITEMS.map((n, i) => (
              <li key={n}><a href="javascript:;" style={{ color: i === 0 ? '#fff' : 'rgba(255,255,255,0.85)', fontWeight: i === 0 ? 700 : 400, fontSize: '14px', textDecoration: 'none' }}>{n}</a></li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function StrongCard({ book }: { book: { id: string; name: string; author: string; intro: string; cover?: string | null; category: string; wordCount?: number } }) {
  const { navigate } = usePublic()
  return (
    <div className="mod-top-ani-a" style={{ display: 'block', width: '180px', marginRight: '14px', textDecoration: 'none', color: INK }}>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} title={book.name}>
        <BookCover name={book.name} cover={book.cover} className="book-cover" />
      </a>
      <div className="mod-ani-text1" style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} title={book.name} style={{ fontSize: '14px', color: INK, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>{book.name}</a>
        <span style={{ fontSize: '12px', color: MUTED }}>{book.author}</span>
      </div>
      <p style={{ margin: '4px 0 0', fontSize: '11px', color: MUTED }}>浏览量 {Math.floor((book.wordCount || 0) / 100)}</p>
    </div>
  )
}

function RankItem({ no, book }: { no: number; book: { id: string; name: string } }) {
  const { navigate } = usePublic()
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', borderBottom: '1px dashed #eee' }}>
      <sub style={{ color: no <= 3 ? PRIMARY : '#999', fontSize: '12px', fontWeight: 700, marginRight: '4px' }}>{no}</sub>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} title={book.name} style={{ color: INK, textDecoration: 'none', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.name}</a>
    </li>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps): ReactNode {
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh', padding: '0' }}>
        <TopHeader />
        <div style={{ maxWidth: '1200px', margin: '14px auto', padding: '14px' }}>
          <BookGridSkeleton count={8} />
        </div>
      </div>
    )
  }

  const strongBooks = books.slice(0, 8)
  const monthRank = books.slice(0, 16)
  const vipBooks = books.slice(8, 20)
  const signBooks = books.slice(20, 32)

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <TopHeader />
      <div style={{ maxWidth: '1200px', margin: '14px auto', padding: '0 14px' }}>
        {/* 独家推荐 */}
        <div className="in-strong-wr" style={{ marginBottom: '20px' }}>
          <div className="in-title-wr" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-block', width: '4px', height: '20px', background: PRIMARY, borderRadius: '2px' }} />
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: INK }}>独家推荐</h3>
          </div>
          <div className="in-slider-wr in-content" style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '10px' }}>
            {strongBooks.map((b) => <StrongCard key={b.id} book={b} />)}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '20px' }}>
          <div>
            {/* VIP精选 */}
            <div className="in-vip-wr" style={{ marginBottom: '20px', background: '#fff', padding: '14px', borderRadius: '2px', border: `1px solid ${BORDER}` }}>
              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-block', width: '4px', height: '18px', background: ACCENT, borderRadius: '2px' }} />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: INK }}>VIP精选</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '14px' }}>
                {vipBooks.map((b) => <StrongCard key={b.id} book={b} />)}
              </div>
            </div>
            {/* 纯爱小说 */}
            <div className="in-sign-wr" style={{ background: '#fff', padding: '14px', borderRadius: '2px', border: `1px solid ${BORDER}` }}>
              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-block', width: '4px', height: '18px', background: RED, borderRadius: '2px' }} />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: INK }}>纯爱小说</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '14px' }}>
                {signBooks.map((b) => <StrongCard key={b.id} book={b} />)}
              </div>
            </div>
          </div>

          <div>
            {/* 月榜 */}
            <div className="in-rank-wr" style={{ background: '#fff', padding: '14px', borderRadius: '2px', border: `1px solid ${BORDER}` }}>
              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-block', width: '4px', height: '18px', background: PRIMARY, borderRadius: '2px' }} />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: INK }}>月榜</h3>
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {monthRank.map((b, i) => <RankItem key={b.id} no={i + 1} book={b} />)}
              </ol>
            </div>
          </div>
        </div>
      </div>

      <div className="mod-footer-wr" style={{ background: '#fff', borderTop: `2px solid ${PRIMARY}`, padding: '20px 14px', marginTop: '20px', textAlign: 'center' }}>
        <div className="mod-footer-info" style={{ color: MUTED, fontSize: '12px', lineHeight: '1.8' }}>
          本站所有小说为完本转载作品，所有内容版权归版权方或原作者所有。<br />
          Copyright © 霹雳书屋 All Rights Reserved
        </div>
      </div>
    </div>
  )
}
