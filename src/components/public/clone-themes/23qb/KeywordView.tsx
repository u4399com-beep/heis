'use client'
// ============================================================
// clone-23qb KeywordView — 1:1 精仿 www.23qb.net 标签关键词落地页
// 参考: 23qb.css .search-stat/.module.module-list.module-items (按源站分类页结构复刻)
// 复刻: header(简版) / main#main.wrapper > .content > .list > .box
//   ( .search-stat (h1 标签名 + h2 计数) + .module .module-list .module-items 网格 )
// ============================================================
import type { KeywordViewProps } from '../shared'
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'

export function KeywordView({ tag, books, loading }: KeywordViewProps) {
  const { site, navigate } = usePublic()

  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  return (
    <>
      {/* header (简版) */}
      <header id="header" className="wrapper">
        <div className="header-content">
          <div className="banyundog-com">
            <div className="header-logo">
              <h1 className="slogan">{site.name}</h1>
              <div className="fixed-logo">
                <a href="/" className="logo" title={site.name} onClick={goHome}><span>{site.name}</span></a>
              </div>
            </div>
          </div>
          <div className="nav-search">
            <form action="/search.html" className="search-dh" onSubmit={goSearch} />
          </div>
          <div className="header-module">
            <ul className="nav-menu-items">
              <li className="nav-menu-item"><a href="/" title="首页" onClick={goHome}><span>首页</span></a></li>
            </ul>
          </div>
        </div>
        <div id="search-content">
          <form action="/search.html" onSubmit={goSearch}>
            <div className="search-main">
              <div className="search-box">
                <input className="search-input ac_wd" id="txtKeywords" type="search" name="searchkey" autoComplete="off" placeholder="搜索喜欢的小说、作者、标签" defaultValue={tag} />
                <a href="/book/" className="search-btn search-cupfox" title="书库" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>书库</a>
                <button className="search-btn search-go" type="submit"><i className="icon-search" /></button>
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
              <div className="search-stat">
                <h1>{tag}</h1>
                <h2>共 {books.length} 部相关作品</h2>
              </div>

              {loading ? (
                <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center' }}>暂无相关书籍</div>
              ) : (
                <div className="module">
                  <div className="module-list module-lines-list">
                    <div className="module-items">
                      {books.map((b, i) => (
                        <div key={b.id} className="module-item">
                          <div className="module-item-cover">
                            {i < 3 && <div className={`module-item-top top${i + 1}`}>{i + 1}</div>}
                            <div className="module-item-pic">
                              <a {...bookNavProps(navigate, b.id)} title={b.name} />
                              <BookCover name={b.name} cover={b.cover} className="lazy lazyloaded" style={{ width: '100%', height: '100%' }} />
                              <div className="loading" />
                            </div>
                            <div className="module-item-caption">
                              <span>{b.category || '小说'} {formatWords(b.wordCount)}</span>
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
              )}
            </div>
          </div>
        </div>
      </main>

      {/* footer */}
      <footer id="footer" className="wrapper pd60">
        <p className="sitemap">
          <span>{site.name}</span>
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
