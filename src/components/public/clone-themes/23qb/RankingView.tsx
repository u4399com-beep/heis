'use client'
// ============================================================
// clone-23qb RankingView — 1:1 精仿 www.23qb.net 排行榜页
// 参考: 23qb.css .module-tab/.module-tab-item/.list .list-item .item/.order/.keyword
// 复刻: header(简版) / main#main.wrapper > .content > .list > .box
//   ( .module-tab .module-tab-items (Tab 切换) + .list .list-item .item × N (排名项) + #page 分页 )
// ============================================================
import type { RankingViewProps } from '../shared'
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'

const TABS = [
  { id: 'allvisit', name: '总点击' },
  { id: 'allvote', name: '总推荐' },
  { id: 'monthvisit', name: '月点击' },
  { id: 'weekvisit', name: '周点击' },
  { id: 'dayvisit', name: '日点击' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
]

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage }: RankingViewProps) {
  const { site, navigate } = usePublic()

  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  const totalPages = Math.max(1, Math.ceil(total / size))
  const from = Math.max(1, page - 2)
  const to = Math.min(totalPages, from + 4)
  const pageItems: number[] = []
  for (let i = from; i <= to; i++) pageItems.push(i)

  // 分段排名: 前 10 大封面网格 + 后续 list-item 排名
  const top = books.slice(0, 10)
  const rest = books.slice(10)

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
                <h1>排行榜</h1>
                <h2>共 {total} 部作品</h2>
              </div>

              {/* Tab 切换 */}
              <div className="module-tab">
                <div className="module-tab-items">
                  {TABS.map(t => (
                    <a
                      key={t.id}
                      className={`module-tab-item${tab === t.id ? ' selected' : ''}`}
                      onClick={(e) => { e.preventDefault(); onTabChange(t.id) }}
                    >
                      <span>{t.name}</span>
                    </a>
                  ))}
                </div>
              </div>

              {loading ? (
                <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center' }}>暂无数据</div>
              ) : (
                <>
                  {/* 前 10 名 — 大封面网格 */}
                  <div className="module">
                    <div className="module-list module-lines-list">
                      <div className="module-items">
                        {top.map((b, i) => (
                          <div key={b.id} className="module-item">
                            <div className="module-item-cover">
                              <div className={`module-item-top${i < 3 ? ` top${i + 1}` : ''}`}>{(page - 1) * size + i + 1}</div>
                              <div className="module-item-pic">
                                <a {...bookNavProps(navigate, b.id)} title={b.name} />
                                <img className="lazy lazyloaded" alt={b.name} src={b.cover || '/mxstatic/image/loading.gif'} />
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

                  {/* 后续排名 — 列表 */}
                  {rest.length > 0 && (
                    <div className="list-item">
                      <h5 className="item-title">
                        <i className="icon-hot" />
                        <span>排行完整列表</span>
                      </h5>
                      {rest.map((b, i) => {
                        const rank = (page - 1) * size + 10 + i + 1
                        return (
                          <a key={b.id} className="item" title={b.name} {...bookNavProps(navigate, b.id)}>
                            <span className="order">{String(rank).padStart(2, '0')}</span>
                            <span className="keyword">{b.name}</span>
                          </a>
                        )
                      })}
                    </div>
                  )}
                </>
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
