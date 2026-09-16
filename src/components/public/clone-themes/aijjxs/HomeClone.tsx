// ============================================================
// clone-themes/aijjxs — 久久小说 aijjxs.com 1:1 真克隆
// 实测 probe-html2/probe-aijjxs.{html,css} + probe-aijjxs-{book,chapter,category}.html
// 硬编码源站实际 CSS 变量值 (不用 theme.vars):
//   --bg #f3efe7 / --paper #fffdf8 / --ink #1f2937 / --muted #6b7280
//   --line #e5dccd / --brand #0f766e (青绿) / --brand-dark #115e59
//   --accent #b45309 (琥珀) / --shadow 0 10px 30px rgba(17,24,39,0.08) / --radius 14px
//   --chip #eef9f7 / --rank #fff5e6
//   body 双层 radial-gradient + 基色 #f3efe7
//   body font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif
//   a: var(--brand-dark) #115e59 / hover var(--brand) #0f766e
// DOM 结构 (源站 .wrap max-width 1220px + .top-float nav + .top header + .layout grid 1fr 330px):
//   .top-float (顶栏 nav: 首页/穿越/重生/古代架空/现代言情/总裁豪门/仙侠幻想/同人衍生/无限流/耽于纯美/玄幻魔法/都市异能/历史军事/网游小说/惊悚悬疑/文学名著 + 登录/注册)
//   .wrap > header.top (h1.logo 站内搜索 + form.search + .search-history 热搜词)
//   main.layout (1fr 330px) > section (panel latest-upload + panel 封面推荐 + panel 小说分类 + panel 专题书单) + aside (today-qd-users + panel.rank 24小时 + panel.rank 一周 + panel 热门作者)
//   footer.foot (网站简介 · 网站帮助 · 版权声明 · 网站地图 · 友情链接 · 留言建议)
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookGridSkeleton } from '../../bits'
import { BookCover } from '../../BookCover'
import { fmtDate, formatWords } from '../../seo'
import type { BookItem } from '../../types'
import type { ReactNode } from 'react'

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
const BG = 'radial-gradient(1000px 420px at 0 -10%, #e0f2fe 0%, transparent 60%), radial-gradient(900px 520px at 100% 0, #ffedd5 0%, transparent 60%), #f3efe7'
const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#e5dccd'
const BRAND = '#0f766e'
const BRAND_DARK = '#115e59'
const ACCENT = '#b45309'
const PAPER = '#fffdf8'
const SHADOW = '0 10px 30px rgba(17, 24, 39, 0.08)'
const RADIUS = '14px'
const CHIP = '#eef9f7'
const RANK_BG = '#fff5e6'

const NAV_ITEMS = [
  { label: '首页', href: '/', active: true },
  { label: '穿越', href: '/txt/chuanyue/' },
  { label: '重生', href: '/txt/chongshengxiaoshuo/' },
  { label: '古代架空', href: '/txt/lsjs/' },
  { label: '现代言情', href: '/txt/young/' },
  { label: '总裁豪门', href: '/txt/qinggan/' },
  { label: '仙侠幻想', href: '/txt/wuxia/' },
  { label: '同人衍生', href: '/txt/tongrenxiaoshuo/' },
  { label: '无限流', href: '/txt/wuxianliu/' },
  { label: '耽于纯美', href: '/txt/dmtr/' },
  { label: '玄幻魔法', href: '/txt/xuanhuan/' },
  { label: '都市异能', href: '/txt/dushi/' },
  { label: '历史军事', href: '/txt/tiexue/' },
  { label: '网游小说', href: '/txt/juben/' },
  { label: '惊悚悬疑', href: '/txt/kongbu/' },
  { label: '文学名著', href: '/txt/gdmz/' },
]

const HOT_WORDS = ['末日', '白月光', '末世', '直播', '万人迷', '女帝', '游戏入侵', '诡秘之主', '斗破', '香江']

/** 顶栏 .top-float — 全宽青绿底 + nav 16 项 + 登录/注册 */
function TopFloat() {
  return (
    <div className="top-float" style={{ background: '#fff', borderBottom: `2px solid ${BRAND}` }}>
      <div className="top-float-inner" style={{ maxWidth: '1220px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', height: '40px', fontFamily: FONT_STACK }}>
        <nav className="top-float-nav" style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
          {NAV_ITEMS.map((n) => (
            <a key={n.label} href={n.href} style={{ fontSize: '14px', color: n.active ? BRAND : '#475569', fontWeight: n.active ? 700 : 400, textDecoration: 'none' }}>{n.label}</a>
          ))}
        </nav>
        <div className="top-float-auth" style={{ display: 'flex', gap: '12px' }}>
          <a href="/e/member/login" style={{ fontSize: '14px', color: BRAND_DARK, textDecoration: 'none' }}>登录</a>
          <a href="/e/member/register/" style={{ fontSize: '14px', color: BRAND_DARK, textDecoration: 'none' }}>注册</a>
        </div>
      </div>
    </div>
  )
}

/** header.top — logo + 搜索 + 热搜词 */
function TopHeader() {
  return (
    <header className="top" style={{ background: 'rgba(255,253,248,.9)', border: `1px solid ${LINE}`, boxShadow: SHADOW, borderRadius: RADIUS, padding: '16px', marginTop: '14px' }}>
      <div className="top-1" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <h1 className="logo" style={{ margin: 0, fontSize: '20px', letterSpacing: '1px', color: INK, fontFamily: FONT_STACK }}>
          站内搜索<small style={{ fontSize: '13px', color: MUTED, marginLeft: '8px' }}>快速找到你想要的TXT电子书</small>
        </h1>
        <div className="top-links" style={{ display: 'flex', gap: '8px 10px', fontSize: '14px', flexWrap: 'wrap', alignItems: 'center', color: '#475569' }}>
          欢迎访问久久小说下载网，请 <a href="/e/member/login/" style={{ color: BRAND, fontWeight: 600, textDecoration: 'none' }}>登陆帐户</a> 或 <a href="/e/member/register/" style={{ color: BRAND, fontWeight: 600, textDecoration: 'none' }}>注册会员</a>
        </div>
      </div>
      <form className="search" style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 128px', gap: '10px' }} onSubmit={(e) => e.preventDefault()}>
        <input type="hidden" name="show" value="title,writer" />
        <input type="text" name="keyboard" placeholder="请输入书名或作者关键字" style={{ height: '44px', borderRadius: '10px', border: `1px solid ${LINE}`, padding: '0 13px', fontSize: '15px', background: PAPER, color: INK }} />
        <button type="submit" style={{ border: '0', borderRadius: '10px', background: `linear-gradient(135deg,${BRAND},${BRAND_DARK})`, color: '#fff', fontSize: '15px', cursor: 'pointer' }}>搜索全站</button>
      </form>
      <div className="search-history" style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: MUTED, marginRight: '2px' }}>今日热搜</span>
        {HOT_WORDS.map((w) => (
          <a key={w} href="javascript:;" data-key={w} style={{ fontSize: '13px', color: BRAND_DARK, padding: '2px 9px', background: CHIP, border: `1px solid ${BRAND}33`, borderRadius: '999px', textDecoration: 'none' }}>{w}</a>
        ))}
      </div>
    </header>
  )
}

/** Panel 区块标题 */
function PanelH3({ title, sub }: { title: string; sub?: string }) {
  return (
    <h3 style={{ margin: 0, borderBottom: '1px solid rgba(255,214,224,0.28)', fontSize: '18px', color: INK, padding: '10px 14px', fontFamily: FONT_STACK }}>
      {title}
      {sub && <small style={{ fontSize: '13px', color: ACCENT, marginLeft: '8px' }}>{sub}</small>}
    </h3>
  )
}

/** 行式书籍 li (book in latest-upload / 分类列表) */
function BookLine({ book, idx }: { book: BookItem; idx: number }) {
  const { navigate } = usePublic()
  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', borderBottom: `1px dashed ${LINE}`, padding: '9px 14px', alignItems: 'center' }}>
      <span className="line-main" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
        <span className="cat" style={{ flex: '0 0 auto', fontSize: '11px', color: BRAND, background: '#e8f7f4', border: '1px solid #b9e3dc', borderRadius: '999px', padding: '4px 8px' }}>{book.category}</span>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: BRAND_DARK, textDecoration: 'none', fontSize: '14px' }}>{book.name}</a>
        <span className="author" style={{ flex: '0 0 auto', fontSize: '12px', color: '#64748b' }}>{book.author}</span>
      </span>
      <span className="date" style={{ flex: '0 0 auto', minWidth: '42px', color: MUTED, fontSize: '12px', textAlign: 'left' }}>
        {idx < 16 ? <span style={{ color: '#F03' }}>{fmtDate(book.updatedAt) || '今天'}</span> : (fmtDate(book.updatedAt) || '')}
      </span>
    </li>
  )
}

/** 封面推荐卡 (.book grid2) */
function BookCard2({ book }: { book: BookItem }) {
  const { navigate } = usePublic()
  return (
    <div className="book" style={{ border: `1px solid ${LINE}`, borderRadius: '12px', background: '#fff', padding: '10px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: '10px' }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }}>
          <BookCover name={book.name} cover={book.cover} className="book-cover" />
        </a>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h4 style={{ margin: 0, fontSize: '15px', lineHeight: 1.4, color: INK }}>
            <span className="badge" style={{ display: 'inline-block', fontSize: '12px', color: '#fff', background: ACCENT, borderRadius: '5px', padding: '1px 6px', marginRight: '6px' }}>新</span>
            <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: INK, textDecoration: 'none' }}>{book.name}</a>
          </h4>
          <div className="meta" style={{ color: MUTED, fontSize: '12px', marginTop: '4px' }}>{book.author} · {book.category} · {formatWords(book.wordCount)} · {fmtDate(book.updatedAt) || ''}</div>
          <div className="desc" style={{ marginTop: '4px', fontSize: '13px', color: '#9ca3af', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.intro}</div>
        </div>
      </div>
    </div>
  )
}

/** 排行榜 li (.rank .lines li) */
function RankLine({ book, no }: { book: BookItem; no: number }) {
  const { navigate } = usePublic()
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '6px', borderBottom: `1px dashed ${LINE}`, padding: '7px 14px' }}>
      <span className="no" style={{ display: 'inline-block', minWidth: '18px', textAlign: 'center', fontWeight: 'bold', color: no <= 3 ? '#9a3412' : '#9a3412' }}>{no}</span>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} title={book.name} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: BRAND_DARK, textDecoration: 'none', fontSize: '13px', flex: 1 }}>{book.name}</a>
      <span className="date" style={{ marginLeft: 'auto', color: MUTED, fontSize: '12px', textAlign: 'right' }}>{book.author}</span>
    </li>
  )
}

/** 排行榜头卡 (.book_r) */
function RankHeadCard({ book }: { book: BookItem }) {
  const { navigate } = usePublic()
  return (
    <div className="book_r" style={{ marginBottom: '10px', display: 'flex', gap: '10px' }}>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }}>
        <BookCover name={book.name} cover={book.cover} className="book-cover" />
      </a>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h4 style={{ margin: 0, fontSize: '14px' }}>
          <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} style={{ color: INK, textDecoration: 'none' }}>{book.name}</a>
        </h4>
        <div className="meta" style={{ color: MUTED, fontSize: '12px', marginTop: '4px' }}>{book.author} · {book.category} · {formatWords(book.wordCount)}</div>
        <div className="desc" style={{ marginTop: '4px', fontSize: '13px', color: '#9ca3af', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.intro}</div>
      </div>
    </div>
  )
}

export function HomeClone({ books, loading }: { books: BookItem[]; loading?: boolean }): ReactNode {
  const featured = books.slice(0, 2)
  const femaleBooks = books.filter((b) => /穿越|现言|重生|言情|总裁/.test(b.category)).slice(0, 9)
  const maleBooks = books.filter((b) => /玄幻|都市|历史|网游|科幻/.test(b.category)).slice(0, 9)
  const mysteryBooks = books.filter((b) => /惊悚|悬疑|灵异/.test(b.category)).slice(0, 9)
  const rank24 = books.slice(0, 10)
  const rankWeek = books.slice(10, 20)
  const latest = books.slice(0, 16)
  const top10 = books.slice(0, 10)

  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh', padding: '14px' }}>
        <TopFloat />
        <TopHeader />
        <div style={{ marginTop: '16px' }}>
          <BookGridSkeleton count={8} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <TopFloat />
      <div className="wrap" style={{ maxWidth: '1220px', margin: '0 auto', padding: '18px 14px 36px' }}>
        <TopHeader />

        <main className="layout" style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 330px', gap: '14px' }}>
          <section>
            {/* 最新上传 */}
            <article className="panel latest-upload" style={{ border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW }}>
              <PanelH3 title="最新上传" sub="" />
              <div className="body" style={{ padding: '12px 14px' }}>
                <ul className="lines lines-books lines-books-2col" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '0 16px' }}>
                  {latest.map((b, i) => <BookLine key={b.id} book={b} idx={i} />)}
                </ul>
              </div>
            </article>

            {/* 封面推荐 */}
            <article className="panel" style={{ marginTop: '14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW }}>
              <PanelH3 title="封面推荐" />
              <div className="body grid2" style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '12px' }}>
                {featured.map((b) => <BookCard2 key={b.id} book={b} />)}
              </div>
            </article>

            {/* 小说分类 */}
            <article className="panel" style={{ marginTop: '14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW }}>
              <PanelH3 title="小说分类" />
              <div className="body grid2" style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '12px' }}>
                <div>
                  <h4 style={{ margin: '0 0 6px', fontSize: '15px', color: INK }}>女生小说 <a href="/txt/" style={{ fontSize: '12px', color: BRAND, textDecoration: 'none' }}>更多&gt;&gt;</a></h4>
                  <ul className="lines lines-books" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {femaleBooks.map((b, i) => <BookLine key={b.id} book={b} idx={i + 20} />)}
                  </ul>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 6px', fontSize: '15px', color: INK }}>男生小说 <a href="/nanshengxiaoshuo/" style={{ fontSize: '12px', color: BRAND, textDecoration: 'none' }}>更多&gt;&gt;</a></h4>
                  <ul className="lines lines-books" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {maleBooks.map((b, i) => <BookLine key={b.id} book={b} idx={i + 30} />)}
                  </ul>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 6px', fontSize: '15px', color: INK }}>悬疑小说 <a href="/txt/kongbu/" style={{ fontSize: '12px', color: BRAND, textDecoration: 'none' }}>更多&gt;&gt;</a></h4>
                  <ul className="lines lines-books" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {mysteryBooks.map((b, i) => <BookLine key={b.id} book={b} idx={i + 40} />)}
                  </ul>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 6px', fontSize: '15px', color: INK }}>纯美小说 <a href="/danmeixiaoshuo/" style={{ fontSize: '12px', color: BRAND, textDecoration: 'none' }}>更多&gt;&gt;</a></h4>
                  <ul className="lines lines-books" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {books.slice(20, 30).map((b, i) => <BookLine key={b.id} book={b} idx={i + 50} />)}
                  </ul>
                </div>
              </div>
            </article>

            {/* 专题书单 */}
            <article className="panel" style={{ marginTop: '14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW }}>
              <PanelH3 title="专题书单" />
              <div className="body grid3" style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '10px' }}>
                <div className="desc" style={{ marginTop: '8px', padding: '10px', borderRadius: '10px', border: `1px solid #ece2d2`, background: '#fff', color: '#374151', fontSize: '14px' }}>
                  <strong style={{ color: BRAND_DARK }}>高分重生文</strong><br />节奏快、反转多、女性成长线清晰。
                </div>
                <div className="desc" style={{ marginTop: '8px', padding: '10px', borderRadius: '10px', border: `1px solid #ece2d2`, background: '#fff', color: '#374151', fontSize: '14px' }}>
                  <strong style={{ color: BRAND_DARK }}>穿越种田合集</strong><br />日常经营、家长里短、慢热耐看。
                </div>
                <div className="desc" style={{ marginTop: '8px', padding: '10px', borderRadius: '10px', border: `1px solid #ece2d2`, background: '#fff', color: '#374151', fontSize: '14px' }}>
                  <strong style={{ color: BRAND_DARK }}>都市爽文精选</strong><br />升级流、事业线、金手指开局。
                </div>
              </div>
            </article>
          </section>

          <aside>
            {/* 今日签到 */}
            <div className="today-qd-users" style={{ margin: 0, padding: '12px 13px 8px 16px', border: `1px solid ${LINE}`, borderRadius: '12px', background: PAPER }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '16px', color: '#2d4a40' }}>今日已签到</h3>
              <ul className="qd-user-list" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: '6px' }}>
                {['szs', 'zhx123', '小七67', 'wxac', 'mantou'].map((u) => (
                  <li key={u}>
                    <a href="javascript:;" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
                      <img src="/e/data/images/nouserpic.gif" alt={u} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #f0dfbf', background: '#f7f7f7' }} />
                      <span style={{ display: 'block', width: '100%', textAlign: 'center', fontSize: '11px', color: '#3d4b52', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* 24小时热榜 */}
            <article className="panel rank" style={{ marginTop: '14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: RANK_BG, boxShadow: SHADOW }}>
              <PanelH3 title="24小时热榜" />
              <div className="body" style={{ padding: '12px 14px' }}>
                {rank24[0] && <RankHeadCard book={rank24[0]} />}
                <ul className="lines" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {rank24.slice(1).map((b, i) => <RankLine key={b.id} book={b} no={i + 2} />)}
                </ul>
              </div>
            </article>

            {/* 一周热榜 */}
            <article className="panel rank" style={{ marginTop: '14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: RANK_BG, boxShadow: SHADOW }}>
              <PanelH3 title="一周热榜" />
              <div className="body" style={{ padding: '12px 14px' }}>
                {rankWeek[0] && <RankHeadCard book={rankWeek[0]} />}
                <ul className="lines" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {rankWeek.slice(1).map((b, i) => <RankLine key={b.id} book={b} no={i + 2} />)}
                </ul>
              </div>
            </article>

            {/* 热门作者 */}
            <article className="panel" style={{ marginTop: '14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW }}>
              <PanelH3 title="热门作者" />
              <div className="body tags" style={{ padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {top10.map((b) => (
                  <a key={b.id} href="javascript:;" title={b.author} style={{ border: `1px solid #cae8e3`, background: CHIP, padding: '4px 10px', borderRadius: '999px', fontSize: '13px', color: BRAND_DARK, textDecoration: 'none' }}>{b.author}</a>
                ))}
              </div>
            </article>
          </aside>
        </main>

        <footer className="foot" style={{ marginTop: '24px', paddingTop: '12px', borderTop: `1px solid ${LINE}`, fontSize: '13px', color: MUTED, textAlign: 'center' }}>
          <a href="/support/about.html" style={{ color: BRAND_DARK, textDecoration: 'none' }}>网站简介</a> · <a href="/support/help.html" style={{ color: BRAND_DARK, textDecoration: 'none' }}>网站帮助</a> · <a href="/support/declare.html" style={{ color: BRAND_DARK, textDecoration: 'none' }}>版权声明</a> · <a href="/support/sitemap.html" style={{ color: BRAND_DARK, textDecoration: 'none' }}>网站地图</a> · <a href="/link/" style={{ color: BRAND_DARK, textDecoration: 'none' }}>友情链接</a> · <a href="/e/tool/gbook/index.php?bid=2" style={{ color: BRAND_DARK, textDecoration: 'none' }}>留言建议</a>
          <br />
          Copyright © 久久小说下载网 All Rights Reserved<br />
          本站所有小说电子书均系网友上传，仅供书友之间免费下载预览！
        </footer>
      </div>
    </div>
  )
}
