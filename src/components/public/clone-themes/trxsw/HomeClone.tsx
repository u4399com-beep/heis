<<<<<<< HEAD
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
=======
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
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
    </div>
  )
}

<<<<<<< HEAD
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
=======
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
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
      </footer>
    </div>
  )
}
