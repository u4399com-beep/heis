'use client'
// ============================================================
// clone-23qb HomeClone — 1:1 精仿 www.23qb.net 铅笔小说首页
// 参考: agent-ctx/probe-html2/probe-23qb.html (源站真实 DOM)
// 复刻: header#header.wrapper > .header-content (logo+nav+header-module) + #search-content
//        / main#main.wrapper > .content > .list > .box (.module.module-list.module-lines-list.module-items + .list-item × N)
//        / footer#footer.wrapper.pd60
// CSS 由 CloneCSSLoader 加载 public/clone-css/23qb.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import type { HomeCloneProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

export function HomeClone({ books, loading, navCategoryCount = 13, homeModuleLimit = 16 }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])

  // 拉分类列表用于 nav + list-item 分类区块标题
  useEffect(() => {
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        // API 返回 {ok, data:{items:[{id,name,bookCount,rep}]}}
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        setCats(arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [])

  if (loading) return <div className="wrapper"><div className="content" style={{ padding: 40, textAlign: 'center' }}>加载中...</div></div>
  if (!books.length) return <div className="wrapper"><div className="content" style={{ padding: 40, textAlign: 'center' }}>暂无内容</div></div>

  // 大封面网格: 字数最多的前 homeModuleLimit 本 (1-16 排名)
  const topBooks = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, homeModuleLimit)
  // 分类区块: 每个分类前 10 本 (与源站 .list-item 一致)
  const navCats = cats.slice(0, navCategoryCount)
  const sections = (navCats.length ? navCats : [{ id: 'all', name: '热门小说' }]).map(c => {
    const list = books.filter(b => (b.categoryId || b.category) === c.id || b.category === c.name)
    const pool = list.length > 1 ? list : books
    return { cat: c, list: pool.slice(0, 10) }
  })

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

  return (
    <>
      {/* header */}
      <header id="header" className="wrapper">
        <div className="header-content">
          <div className="banyundog-com">
            <div className="header-logo">
              <h1 className="slogan">{site.name}</h1>
              <div className="fixed-logo">
                <a href="/" className="logo" title={site.name} onClick={goHome}>
                  <span>{site.name}</span>
                </a>
              </div>
            </div>
          </div>
          <div className="nav-search">
            <form action="/search.html" className="search-dh" onSubmit={goSearch} />
          </div>
          <div className="nav">
            <ul className="nav-menu-items">
              <li className="nav-menu-item selected"><a href="/" title="首页" onClick={goHome}><span>首页</span></a></li>
              {navCats.map(c => (
                <li key={c.id} className="nav-menu-item">
                  <a href={`/book/lastupdate_0_${c.id}_0_0_0_0_0_1_0.html`} title={c.name} onClick={(e) => goCat(e, c.id)}>
                    <span>{c.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="header-module">
            <ul className="nav-menu-items">
              <li className="nav-menu-item drop">
                <span className="nav-menu-icon"><i className="icon-all" /></span>
                <div className="drop-content sub-block">
                  <div className="drop-content-box grid-box">
                    <ul className="drop-content-items grid-items">
                      {navCats.map(c => (
                        <li key={c.id} className="grid-item">
                          <a href={`/book/lastupdate_0_${c.id}_0_0_0_0_0_1_0.html`} title={c.name} onClick={(e) => goCat(e, c.id)}>
                            <div className="grid-item-name">{c.name}</div>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="shortcuts-mobile-overlay" />
              </li>
              <li className="space-line-bold" />
              <li className="nav-menu-item drop wapblock">
                <a className="mac_user" href="/login.php" title="会员中心" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}>
                  <i className="iconfont icon-yonghu-fuben" />
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div id="search-content">
          <div className="index-logo">
            <span className="logo-s"><span>{site.name}</span></span>
          </div>
          <form action="/search.html" onSubmit={goSearch}>
            <div className="search-main">
              <div className="search-box">
                <input className="search-input ac_wd" id="txtKeywords" type="search" name="searchkey" autoComplete="off" placeholder="搜索喜欢的小说、作者、标签" />
                <a href="/book/" className="search-btn search-cupfox" title="书库" onClick={(e) => goCat(e)}>书库</a>
                <button className="search-btn search-go" type="submit">
                  <i className="icon-search" />
                </button>
                <button className="cancel-btn" type="button">取消</button>
              </div>
            </div>
          </form>
        </div>
      </header>

      {/* main */}
      <main id="main" className="wrapper">
        <div className="content">
          <div className="list">
            <div className="box">
              {/* 大封面网格 (字数榜 1-N) */}
              <div className="module">
                <div className="module-list module-lines-list">
                  <div className="module-items">
                    {topBooks.map((b, i) => (
                      <div key={b.id} className="module-item">
                        <div className="module-item-cover">
                          <div className={`module-item-top${i < 3 ? ` top${i + 1}` : ''}`}>{i + 1}</div>
                          <div className="module-item-pic">
                            <a {...bookNavProps(navigate, b.id)} title={b.name} />
                            <BookCover name={b.name} cover={b.cover} className="lazy lazyloaded" style={{ width: '100%', height: '100%' }} />
                            <div className="loading" />
                          </div>
                          <div className="module-item-caption">
                            <span>{b.category || '小说'} {b.author}</span>
                          </div>
                        </div>
                        <div className="module-item-titlebox">
                          <a {...bookNavProps(navigate, b.id)} className="module-item-title" title={b.name}>{b.name}</a>
                        </div>
                        <div className="module-item-text">{b.author}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 分类区块 × N (每区前 10 名) */}
              {sections.map(({ cat, list }) => (
                <div key={cat.id} className="list-item">
                  <h5 className="item-title">
                    <i className="icon-hot" />
                    <span>{cat.name}</span>
                  </h5>
                  {list.map((b, i) => (
                    <a key={b.id} className="item" title={b.name} {...bookNavProps(navigate, b.id)}>
                      <span className={`order ${i === 0 ? 'one' : i === 1 ? 'two' : i === 2 ? 'three' : ''}`}>{String(i + 1).padStart(2, '0')}</span>
                      <span className="keyword">{b.name}</span>
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* friendlink */}
      <div id="friendlink" className="wrapper hidden-xs">
        <div className="content">
          <h2>友情链接：</h2>
        </div>
      </div>

      {/* footer */}
      <footer id="footer" className="wrapper pd60">
        <p className="sitemap">
          <span style={{ display: 'inline-block', verticalAlign: 'middle' }}>{site.name}</span>
          <a href="/" onClick={goHome}>RSS</a>
          <span className="space-line-bold" />
          <a href="/" onClick={goHome}>Google</a>
          <span className="space-line-bold" />
          <a href="/" onClick={goHome}>Bing</a>
        </p>
        <p>{site.title || site.name}</p>
      </footer>
    </>
  )
}
