'use client'
// ============================================================
// clone-23qb ReadChrome — 1:1 精仿 www.23qb.net 章节阅读页外壳
// 参考: 23qb.css .article/.article-title/.article-content/.chepnav (无 probe, 按源站 CSS class 复刻)
// 复刻: header(简版) / main#main.wrapper > .article > main
//   ( .chepnav (上下导航) + .article-title (章节标题) + .article-content (正文 children)
//     + .chepnav (底部上下章按钮) )
// ============================================================
import type { ReadChromeProps } from '../shared'
import { cloneNavHandlers } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  // R27-1C: 复用 cloneNavHandlers (10 套主题共享 goHome/goSearch 逻辑)
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'searchkey')

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

      {/* main — 阅读外壳 */}
      <main id="main" className="wrapper">
        <div className="article">
          <main>
            {/* 顶部章节导航 */}
            {(onPrev || onNext) && (
              <div className="chepnav">
                {onPrev && <a onClick={(e) => { e.preventDefault(); onPrev() }}><i>«</i> 上一章</a>}
                <i>·</i>
                {onNext && <a onClick={(e) => { e.preventDefault(); onNext() }}>下一章 <i>»</i></a>}
              </div>
            )}

            {/* 章节标题 */}
            {chapterTitle && <h1 className="article-title">{chapterTitle}</h1>}

            {/* 正文 */}
            <div className="article-content">
              {children}
            </div>

            {/* 底部章节导航 */}
            {(onPrev || onNext) && (
              <div className="chepnav" style={{ marginTop: 40, textAlign: 'center' }}>
                {onPrev && <a onClick={(e) => { e.preventDefault(); onPrev() }}><i>«</i> 上一章</a>}
                <i>·</i>
                {onNext && <a onClick={(e) => { e.preventDefault(); onNext() }}>下一章 <i>»</i></a>}
              </div>
            )}
          </main>
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
