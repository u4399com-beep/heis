// ============================================================
// clone-themes/trxsw HomeClone — 天人小说首页 1:1 克隆
// 域名已过期但规则保留, 通过 GitHub mason173/aira-browser 反查真实 DOM:
//   站点: https://www.trxsw.com/ (天人小说, 唐人小说路由, 路径前缀 /tangren_)
// 硬编码源站实际 CSS 变量值 (themes.ts vars):
//   bg #f5f7fa / surface #fff / surfaceAlt #eef2f7 / text #333 / textMuted #888
//   primary #2c7be5 (深蓝) / accent #1a5fb4 / border #e0e6ed / radius 4px
//   fontFamily: "Microsoft YaHei", Arial, sans-serif / cardShadow 0 1px 3px rgba(0,0,0,0.05)
// DOM 结构 (AiraBrowser 完整配置反推):
//   header (logo + 搜索框 + 用户菜单)
//   nav (浅蓝灰底 + 8 分类)
//   主区双栏: 左主栏 .vlist 最新更新 (5 列: 类别/书名/最新章节/作者/时间)
//             右侧栏 热门推荐 (前3 加蓝号) + 完本推荐 (.detail-style 小卡)
//   主体下方: 分类列表网格 (6 列)
//   footer (友情链接 + 站点信息)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { BookGridSkeleton } from '../../bits'
import { fmtDate } from '../../seo'
import type { BookItem } from '../../types'
import type { HomeCloneProps } from '../shared-props'
import type { ReactNode } from 'react'

const FONT_STACK = '"Microsoft YaHei", Arial, sans-serif'
const BG = '#f5f7fa'
const SURFACE = '#ffffff'
const SURFACE_ALT = '#eef2f7'
const INK = '#333333'
const MUTED = '#888888'
const PRIMARY = '#2c7be5'
const PRIMARY_TEXT = '#ffffff'
const BORDER = '#e0e6ed'
const RADIUS = '4px'
const SHADOW = '0 1px 3px rgba(0,0,0,0.05)'

const NAV_ITEMS = ['首页', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生']

function Header() {
  const { navigate } = usePublic()
  return (
    <header style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: PRIMARY, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>天人小说</a>
        <span style={{ fontSize: '12px', color: MUTED }}>trxsw.com</span>
        <form style={{ flex: 1, display: 'flex', minWidth: '240px' }} onSubmit={(e) => e.preventDefault()}>
          <input type="text" placeholder="搜索书名 / 作者…" style={{ flex: 1, height: '34px', padding: '0 12px', border: `1px solid ${BORDER}`, borderRight: 'none', fontSize: '13px', outline: 'none' }} />
          <button type="submit" style={{ background: PRIMARY, color: PRIMARY_TEXT, border: 'none', padding: '0 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>搜索</button>
        </form>
        <div style={{ display: 'flex', gap: '14px', fontSize: '12px' }}>
          <span style={{ color: INK }}>书架</span>
          <span style={{ color: INK }}>排行</span>
          <span style={{ color: INK }}>登录</span>
        </div>
      </div>
    </header>
  )
}

function Nav() {
  const { navigate } = usePublic()
  return (
    <div style={{ background: SURFACE_ALT, borderTop: `2px solid ${PRIMARY}` }}>
      <nav style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexWrap: 'wrap' }}>
        {NAV_ITEMS.map((n, i) => (
          <a key={n} href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: i === 0 ? PRIMARY : INK, fontWeight: i === 0 ? 700 : 400, padding: '10px 16px', fontSize: '14px', textDecoration: 'none', borderRight: `1px solid ${BORDER}` }}>{n}</a>
        ))}
      </nav>
    </div>
  )
}

function SectionTitle({ main, more }: { main: string; more?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${BORDER}`, paddingBottom: '8px', marginBottom: '8px' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '15px', fontWeight: 700, color: INK }}>
        <span style={{ display: 'inline-block', width: '4px', height: '14px', background: PRIMARY }} />
        {main}
      </h2>
      <span style={{ fontSize: '12px', color: MUTED }}>{more || '更多'}</span>
    </div>
  )
}

function VListRow({ book, idx }: { book: BookItem; idx: number }) {
  const { navigate } = usePublic()
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 4px', borderBottom: `1px dashed ${BORDER}`, listStyle: 'none', fontSize: '13px' }}>
      <span style={{ width: '24px', textAlign: 'center', fontWeight: 700, color: idx < 3 ? PRIMARY : MUTED }}>{String(idx + 1).padStart(2, '0')}</span>
      <span style={{ width: '15%', color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>[{book.category}]</span>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ width: '20%', color: INK, textDecoration: 'none', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.name}</a>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ flex: 1, minWidth: 0, color: MUTED, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.latestChapter || '暂无章节'}</a>
      <span style={{ width: '15%', textAlign: 'right', color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.author}</span>
      <span style={{ width: '10%', textAlign: 'right', color: MUTED }}>{book.updatedAt ? fmtDate(book.updatedAt).slice(5) : '—'}</span>
    </li>
  )
}

function PopularRow({ book, idx }: { book: BookItem; idx: number }) {
  const { navigate } = usePublic()
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 2px', borderBottom: `1px dashed ${BORDER}`, listStyle: 'none' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', fontSize: '11px', fontWeight: 700, color: idx < 3 ? PRIMARY_TEXT : MUTED, background: idx < 3 ? PRIMARY : SURFACE_ALT, borderRadius: RADIUS }}>{idx + 1}</span>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ flex: 1, minWidth: 0, color: INK, fontSize: '13px', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.name}</a>
      <span style={{ color: MUTED, fontSize: '12px' }}>{book.author}</span>
    </li>
  )
}

function CompletedCard({ book }: { book: BookItem }) {
  const { navigate } = usePublic()
  return (
    <li style={{ listStyle: 'none' }}>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ display: 'flex', gap: '8px', padding: '6px', textDecoration: 'none', border: `1px solid ${BORDER}`, borderRadius: RADIUS, background: SURFACE }}>
        <div style={{ width: '44px', flexShrink: 0 }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.name}</h3>
          <p style={{ margin: '2px 0', fontSize: '11px', color: MUTED }}>{book.author}</p>
          <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: '10px', color: book.status === 'completed' ? PRIMARY_TEXT : MUTED, background: book.status === 'completed' ? PRIMARY : SURFACE_ALT, borderRadius: RADIUS }}>
            {book.status === 'completed' ? '已完结' : '连载中'}
          </span>
        </div>
      </a>
    </li>
  )
}

function CatButton({ name, count, categoryId }: { name: string; count: number; categoryId?: string }) {
  const { navigate } = usePublic()
  return (
    <button type="button" onClick={() => categoryId && navigate({ view: 'category', cat: categoryId })} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', padding: '8px 12px', textAlign: 'left', border: `1px solid ${BORDER}`, borderRadius: RADIUS, background: SURFACE_ALT, cursor: 'pointer' }}>
      <span style={{ fontSize: '13px', fontWeight: 500, color: INK }}>{name}</span>
      <span style={{ fontSize: '11px', color: MUTED }}>{count} 本</span>
    </button>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps): ReactNode {
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh' }}>
        <Header />
        <Nav />
        <div style={{ maxWidth: '1080px', margin: '14px auto', padding: '14px' }}>
          <BookGridSkeleton count={8} />
        </div>
      </div>
    )
  }
  if (!books.length) return null

  const latest = [...books].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 24)
  const popular = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 10)
  const completed = books.filter((b) => b.status === 'completed').slice(0, 4)
  const catList = Array.from(new Set(books.map((b) => b.category).filter(Boolean)))

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <Header />
      <Nav />
      <div style={{ maxWidth: '1080px', margin: '14px auto', padding: '0 14px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: '14px' }}>
        <section style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '12px' }}>
          <SectionTitle main="最新更新" more="查看全部" />
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {latest.map((b, i) => <VListRow key={b.id} book={b} idx={i} />)}
          </ul>
        </section>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <section style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '12px' }}>
            <SectionTitle main="热门推荐" more="榜单" />
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {popular.map((b, i) => <PopularRow key={b.id} book={b} idx={i} />)}
            </ul>
          </section>
          {completed.length > 0 && (
            <section style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '12px' }}>
              <SectionTitle main="完本推荐" more="更多" />
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {completed.map((b) => <CompletedCard key={b.id} book={b} />)}
              </ul>
            </section>
          )}
        </aside>
      </div>
      {catList.length > 0 && (
        <section style={{ maxWidth: '1080px', margin: '14px auto', padding: '0 14px' }}>
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '12px' }}>
            <SectionTitle main="分类导航" more="全部分类" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px', marginTop: '8px' }}>
              {catList.map((c) => {
                const count = books.filter((b) => b.category === c).length
                const sample = books.find((b) => b.category === c)
                return <CatButton key={c} name={c} count={count} categoryId={sample?.categoryId ?? undefined} />
              })}
            </div>
          </div>
        </section>
      )}
      <footer style={{ maxWidth: '1080px', margin: '14px auto', padding: '14px', textAlign: 'center', fontSize: '12px', color: MUTED, borderTop: `1px solid ${BORDER}` }}>
        <p style={{ margin: 0, fontWeight: 600, color: INK }}>天人小说 — 精品小说在线阅读</p>
        <p style={{ margin: '4px 0 0', opacity: 0.8 }}>trxsw.com · 本站所有内容均收集自互联网, 仅供试读</p>
      </footer>
    </div>
  )
}
