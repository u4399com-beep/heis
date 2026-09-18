'use client'
// ============================================================
// clone-shipsay RankingView — 1:1 精仿 demo.shipsay.com 排行榜页
// 参考: public/clone-css/shipsay.css 的 .ulcard (tab 切换条 30px margin-top
//       border-bottom 1px #eee) / .ulcard li (height:40px font-size:18px padding
//       0 20px) / .act (border-bottom:2px solid #ed4259 active 态) /
//       .lastupdate (4 列布局: nth-child 9%/25%/41%/25% — 类别/书名/最新章节/
//       作者+日期) / .lastupdate li (display:flex flex-flow:wrap height:41px
//       line-height:41px border-bottom dotted) / .pages (分页 strong 高亮)
// 复刻: header>.container.head / .navigation>nav / .container>.section
//       .ulcard tabs × N (li.act active) + .lastupdate (p.title + ul.odd
//       li × N 含 span 排名 + a 书名 + a.gray 最新章节 + span 作者+日期) +
//       .pages 分页 + #store_right (热门小说 侧栏) + .section.link + #footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/shipsay.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
import type { RankingViewProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: '1', name: '玄幻' }, { id: '2', name: '武侠' },
  { id: '3', name: '都市' }, { id: '4', name: '历史' },
  { id: '5', name: '科幻' }, { id: '6', name: '游戏' },
  { id: '7', name: '女生' }, { id: '8', name: '其他' },
]

const TABS = [
  { id: 'allvisit', name: '总点击榜' },
  { id: 'monthvisit', name: '月点击榜' },
  { id: 'weekvisit', name: '周点击榜' },
  { id: 'dayvisit', name: '日点击榜' },
  { id: 'allvote', name: '总推荐榜' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
] as const

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage }: RankingViewProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])

  useEffect(() => {
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        const mapped: Cat[] = arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) }))
        setCats(mapped.length ? mapped : DEFAULT_NAV)
      })
      .catch(() => { if (!aborted) setCats(DEFAULT_NAV) })
    return () => { aborted = true }
  }, [])

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 8)
  const totalPages = Math.max(1, Math.ceil(total / size))
  const fmtDateShort = (d?: string | null) => d ? new Date(d).toISOString().slice(5, 10).replace('-', '') : ''
  // 侧栏热门小说: 前 12 本
  const hotBooks = books.slice(0, 12)
  // 当前 tab 名
  const currentTabName = TABS.find(t => t.id === tab)?.name || '排行榜'

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  // 分页 .pages (上一页 / 页码 / 下一页 / 尾页 + #pagestats)
  const renderPages = () => {
    if (total <= size) return null
    const start = Math.max(1, page - 5)
    const end = Math.min(totalPages, start + 9)
    const nums: number[] = []
    for (let i = start; i <= end; i++) nums.push(i)
    return (
      <div className="pages">
        <em id="pagestats">共 {total} 条</em>
        {page > 1 && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(page - 1) }}>上一页</a>}
        {nums.map(n => n === page ? <strong key={n}>{n}</strong> : <a key={n} href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(n) }}>{n}</a>)}
        {page < totalPages && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(page + 1) }}>下一页</a>}
        {page < totalPages && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(totalPages) }}>尾页</a>}
      </div>
    )
  }

  return (
    <>
      {/* ============ header ============ */}
      <header>
        <div className="container head">
          <a id="logo" href="/" onClick={goHome}>
            <span>{site.name}</span>
            <p>{site.domain}</p>
          </a>
          <form name="t_frmsearch" onSubmit={goSearch}>
            <input id="searchkey" name="searchkey" className="search_input" placeholder="搜索书名或作者" autoComplete="off" />
            <input type="hidden" name="searchtype" value="all" />
            <button type="submit" id="search_btn" title="搜索"><i className="fa fa-search fa-lg" /></button>
          </form>
          <div className="header_right">
            <a id="home" href="/" onClick={goHome}><i className="fa fa-home fa-lg" /><br />首页</a>
            <a href="/sort/" onClick={(e) => goCat(e)}><i className="fa fa-book fa-lg" /><br />书库</a>
            <a href="/quanben/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'fulltext' }) }}><i className="fa fa-coffee fa-lg" /><br />完本</a>
            <a href="/history.html" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}><i className="fa fa-history fa-lg" /><br />足迹</a>
          </div>
        </div>
      </header>

      {/* ============ navigation ============ */}
      <div className="navigation">
        <nav className="container">
          <a href="/" onClick={goHome}>首页</a>
          {navCats.map(c => (
            <a key={c.id} href={`/sort/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
          ))}
          <div id="user_panel" />
        </nav>
      </div>

      {/* ============ 排行榜主体 ============ */}
      <div className="container">
        <div className="section">
          {/* tab 切换条 .ulcard */}
          <ul className="ulcard">
            {TABS.map(t => (
              <li key={t.id} className={tab === t.id ? 'act' : ''}>
                <a href="javascript:;" onClick={(e) => { e.preventDefault(); onTabChange(t.id) }}>{t.name}</a>
              </li>
            ))}
          </ul>

          {/* 排行列表 .lastupdate */}
          <div className="lastupdate">
            <p className="title"><i className="fa fa-trophy fa-lg">&nbsp;</i>{currentTabName}</p>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#969ba3' }}>加载中...</div>
            ) : !books.length ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#969ba3' }}>暂无排行数据</div>
            ) : (
              <ul className="odd">
                {books.map((b, i) => (
                  <li key={b.id}>
                    <span><i className="fa fa-bookmark">&nbsp;{i + 1}</i></span>
                    <a {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    <a className="gray" href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}>{b.latestChapter || '—'}</a>
                    <span><a className="gray" href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: b.author }) }}>{b.author}</a>&nbsp;&nbsp;{fmtDateShort(b.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 分页 */}
          {renderPages()}
        </div>
      </div>

      {/* ============ 侧栏: 热门小说 ============ */}
      <div className="container">
        <aside style={{ width: '100%' }}>
          <p className="title"><i className="fa fa-fire fa-lg">&nbsp;</i>热门小说</p>
          <ul className="popular odd">
            {hotBooks.map(b => (
              <li key={b.id}>
                <a {...bookNavProps(navigate, b.id)}>{b.name}</a>
                <a className="gray" href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: b.author }) }}>{b.author}</a>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* ============ 友情链接 ============ */}
      <div className="container">
        <div className="section link">
          <p className="title"><i className="fa fa-link">&nbsp;</i>友情链接</p>
          <a href={site.domain ? `https://${site.domain}` : '/'} target="_blank">{site.name}</a>
          <a href="/" onClick={goHome}>{site.name}首页</a>
        </div>
      </div>

      {/* ============ footer ============ */}
      <div id="footer">
        <footer className="container">
          <p><i className="fa fa-flag"></i>&nbsp;<a href="/" onClick={goHome}>{site.name}</a>&nbsp;书友最值得收藏的网络小说阅读网</p>
          <p>{site.footerText || `本站所有小说为完本转载作品，所有内容版权归版权方或原作者所有。`}</p>
        </footer>
      </div>
    </>
  )
}
