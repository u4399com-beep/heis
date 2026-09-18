'use client'
// ============================================================
// clone-23qb SearchView — 1:1 精仿 www.23qb.net 搜索结果页
// 参考: 23qb.css .search-stat/.module-search-item/.novel-cover/.novel-info
// 复刻: header(简版) / main#main.wrapper > .content > .list > .box
//   ( .search-stat (h1 搜索词 + h2 计数) + .module-search-item × N
//     ( .novel-cover (封面) + .novel-info (.novel-info-header h3 + .novel-info-items 元数据 + .novel-info-content 简介) ) )
// ============================================================
import type { SearchViewProps } from '../shared'
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords, statusLabel, fmtDate } from '../../seo'

export function SearchView({ q, books, loading }: SearchViewProps) {
  const { site, navigate } = usePublic()

  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const v = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (v) navigate({ view: 'search', q: v })
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
                <input className="search-input ac_wd" id="txtKeywords" type="search" name="searchkey" autoComplete="off" placeholder="搜索喜欢的小说、作者、标签" defaultValue={q} />
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
                <h1>{q}</h1>
                <h2>共 {books.length} 部作品</h2>
              </div>

              {loading ? (
                <div style={{ padding: 40, textAlign: 'center' }}>搜索中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center' }}>未找到相关书籍</div>
              ) : (
                books.map(b => (
                  <div key={b.id} className="module-search-item">
                    {/* 封面 */}
                    <div className="novel-cover">
                      <div className="module-item-cover">
                        <div className="module-item-pic">
                          <a {...bookNavProps(navigate, b.id)} title={b.name} />
                          <BookCover name={b.name} cover={b.cover} className="lazy lazyloaded" style={{ width: '100%', height: '100%' }} />
                          <div className="loading" />
                        </div>
                        <div className="module-item-caption">
                          <span>{b.category || '小说'}</span>
                        </div>
                      </div>
                    </div>

                    {/* 信息 */}
                    <div className="novel-info">
                      <div className="novel-info-header">
                        <h3><a {...bookNavProps(navigate, b.id)} title={b.name}>{b.name}</a></h3>
                      </div>
                      <div className="novel-info-main">
                        <div className="novel-info-items">
                          <div className="novel-info-itemtitle">作者</div>
                          <div className="novel-info-actor">{b.author}</div>
                        </div>
                        <div className="novel-info-items">
                          <div className="novel-info-itemtitle">分类</div>
                          <div className="novel-info-actor">{b.category || '小说'}</div>
                        </div>
                        <div className="novel-info-items">
                          <div className="novel-info-itemtitle">状态</div>
                          <div className="novel-info-actor">{statusLabel(b.status)}</div>
                        </div>
                        <div className="novel-info-items">
                          <div className="novel-info-itemtitle">字数</div>
                          <div className="novel-info-actor">{formatWords(b.wordCount)}</div>
                        </div>
                        {b.updatedAt && (
                          <div className="novel-info-items">
                            <div className="novel-info-itemtitle">更新</div>
                            <div className="novel-info-actor">{fmtDate(b.updatedAt)}</div>
                          </div>
                        )}
                      </div>
                      <div className="novel-info-content">
                        <p>{b.intro || '暂无简介'}</p>
                      </div>
                    </div>
                  </div>
                ))
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
