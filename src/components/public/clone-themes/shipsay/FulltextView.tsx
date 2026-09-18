'use client'
// ============================================================
// clone-shipsay FulltextView — 1:1 精仿 demo.shipsay.com 全本完本小说页
// 参考: public/clone-css/shipsay.css 的 .store / .store_left / #store_right /
//       .side_commend .flex li / .img_span / .w100 / .li_bottom / .pages /
//       span.fullflag (完本图标 红底白字) / .side_commend img (100x133)
// 复刻: header>.container.head / .navigation>nav / .container>.store
//       .store_left>.side_commend.side_commend_width (p.title 全本完本小说 +
//       ul.flex li × N 含 .img_span a BookCover + span 类别/完本 + .w100
//       a h2 书名 + p.indent 简介 + .li_bottom a 作者 + div em.orange 字数 +
//       em.blue 日期) + .pages 分页 + #store_right (全部分类 + 热门小说 侧栏) +
//       .section.link + #footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/shipsay.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { FulltextViewProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: '1', name: '玄幻' }, { id: '2', name: '武侠' },
  { id: '3', name: '都市' }, { id: '4', name: '历史' },
  { id: '5', name: '科幻' }, { id: '6', name: '游戏' },
  { id: '7', name: '女生' }, { id: '8', name: '其他' },
]

export function FulltextView({ books, loading, page, total, size, onPage, initialCategories }: FulltextViewProps) {
  const { site, navigate } = usePublic()
  // R25: SSR 首载用 page.tsx server fetch 的 initialCategories 初始化, 避免 SSR 时 cats=[] → navigation 没分类
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))

  useEffect(() => {
    if (cats.length > 0) return
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
  }, [cats.length])

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 8)
  const totalPages = Math.max(1, Math.ceil(total / size))
  const fmtDateShort = (d?: string | null) => d ? new Date(d).toISOString().slice(0, 10) : ''
  // 侧栏热门完本: 前 12 本
  const hotBooks = books.slice(0, 12)
  // 热门作者: 前 12 本不重复作者
  const topAuthors: string[] = Array.from(new Set(books.slice(0, 24).map(b => b.author).filter(Boolean)).values()).slice(0, 12)

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

      {/* ============ 全本完本 (store) ============ */}
      <div className="container">
        <div className="store">
          {/* 左侧: 全本完本卡片列表 */}
          <div className="store_left">
            <div className="side_commend side_commend_width">
              <p className="title"><i className="fa fa-coffee fa-lg">&nbsp;</i>全本完本小说</p>
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#969ba3' }}>加载中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#969ba3' }}>暂无全本小说</div>
              ) : (
                <ul className="flex">
                  {books.map(b => (
                    <li key={b.id}>
                      <div className="img_span">
                        <a {...bookNavProps(navigate, b.id)}>
                          <BookCover name={b.name} cover={b.cover} style={{ width: 100, height: 133 }} />
                        </a>
                        <span className="fullflag">完本</span>
                      </div>
                      <div className="w100">
                        <a {...bookNavProps(navigate, b.id)}><h2>{b.name}</h2></a>
                        <p className="indent">{b.intro || '暂无简介'}</p>
                        <div className="li_bottom">
                          <a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: b.author }) }}><i className="fa fa-user-circle-o">&nbsp;{b.author}</i></a>
                          <div>
                            <em className="orange">{formatWords(b.wordCount)}</em>
                            <em className="blue">{fmtDateShort(b.updatedAt)}</em>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {/* 分页 */}
              {renderPages()}
            </div>
          </div>

          {/* 右侧: 全部分类 + 热门完本 + 热门作者 */}
          <div id="store_right">
            <ul>
              <li className="store_title">全部分类</li>
              {navCats.map(c => (
                <li key={c.id}><a href={`/sort/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a></li>
              ))}
            </ul>
            <ul>
              <li className="store_title">热门完本</li>
              {hotBooks.map(b => (
                <li key={b.id}><a {...bookNavProps(navigate, b.id)}>{b.name}</a></li>
              ))}
            </ul>
            <div>
              <div className="store_title">热门作者</div>
              {topAuthors.map(a => (
                <a key={a} href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: a }) }}>{a}</a>
              ))}
            </div>
          </div>
        </div>
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
