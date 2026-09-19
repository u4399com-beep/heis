'use client'
// ============================================================
// clone-23qb CategoryList — 1:1 精仿 www.23qb.net 分类列表页
// 参考: 23qb.css (probe-23qb-category.html 被 CF 拦截, 按源站 list .module-items 结构复刻)
// 复刻: header(简版) / main#main.wrapper > .content > .list > .box
//   ( .module.module-list.module-lines-list.module-items 网格 + #page 分页 )
// ============================================================
import type { CategoryListProps } from '../shared'
import { cloneNavHandlers, clonePageItems } from '../shared'
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { site, navigate } = usePublic()
  // R27-1C: 复用 cloneNavHandlers + clonePageItems
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'searchkey')
  const { totalPages, pageItems } = clonePageItems(page, total, size)

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
                <input className="search-input ac_wd" id="txtKeywords" type="search" name="searchkey" autoComplete="off" placeholder="搜索喜欢的小说、作者、标签" />
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
                <h1>{label}</h1>
                <h2>共 {total} 部作品</h2>
              </div>

              {loading ? (
                <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center' }}>暂无书籍</div>
              ) : (
                <div className="module">
                  <div className="module-list module-lines-list">
                    <div className="module-items">
                      {books.map((b, i) => (
                        <div key={b.id} className="module-item">
                          <div className="module-item-cover">
                            {i < 3 && <div className={`module-item-top top${i + 1}`}>{(page - 1) * size + i + 1}</div>}
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

              {/* 分页 */}
              {totalPages > 1 && (
                <div id="page">
                  {page > 1 && (
                    <a className="page-previous" onClick={(e) => { e.preventDefault(); onPage(page - 1) }}>上一页</a>
                  )}
                  {pageItems.map(p => (
                    p === page ? (
                      <strong key={p}>{p}</strong>
                    ) : (
                      <a key={p} onClick={(e) => { e.preventDefault(); onPage(p) }}>{p}</a>
                    )
                  ))}
                  {page < totalPages && (
                    <a className="page-next" onClick={(e) => { e.preventDefault(); onPage(page + 1) }}>下一页</a>
                  )}
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
