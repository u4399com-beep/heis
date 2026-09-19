'use client'
// ============================================================
// clone-shipsay SearchView — 1:1 精仿 demo.shipsay.com 搜索结果页
// 参考: public/clone-css/shipsay.css 的 .searchresult (padding-top:4px
//       width:100%!) / .searchresult h3,p (overflow:hidden height:20px) /
//       .searchresult .searchresult_p (height:46px line-height:24px overflow:
//       hidden margin:10px 0 — 简介) / .searchresult h3 (font-size:1.2em) /
//       .searchresult div (margin-top:10px) / .side_commend .lastupdate 风格
// 复刻: header>.container.head (搜索框 defaultValue=q 预填) /
//       .navigation>nav / .container>.section .searchresult × N (h3 书名 +
//       p 作者/类别/字数 + p.searchresult_p 简介 + div 最新章节) +
//       .container>.aside .popular 热门小说 + .section.link + #footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/shipsay.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { SearchViewProps } from '../shared'
import { cloneNavHandlers, useCloneCategories } from '../shared'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: '1', name: '玄幻' }, { id: '2', name: '武侠' },
  { id: '3', name: '都市' }, { id: '4', name: '历史' },
  { id: '5', name: '科幻' }, { id: '6', name: '游戏' },
  { id: '7', name: '女生' }, { id: '8', name: '其他' },
]

export function SearchView({ q, books, loading, initialCategories }: SearchViewProps) {
  const { site, navigate } = usePublic()
  // R28-1A: 复用 useCloneCategories (SSR initialCategories 优先 + 空时 fetch + DEFAULT_NAV 兜底)
  const cats = useCloneCategories(initialCategories, DEFAULT_NAV)

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 8)
  // 热门小说(侧栏): 当前结果前 12 本
  const hotBooks = books.slice(0, 12)

  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch, goCat } = cloneNavHandlers(navigate, 'searchkey')

  return (
    <>
      {/* ============ header (搜索框预填 q) ============ */}
      <header>
        <div className="container head">
          <a id="logo" href="/" onClick={goHome}>
            <span>{site.name}</span>
            <p>{site.domain}</p>
          </a>
          <form name="t_frmsearch" onSubmit={goSearch}>
            <input id="searchkey" name="searchkey" className="search_input" placeholder="搜索书名或作者" defaultValue={q} autoComplete="off" />
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

      {/* ============ 搜索结果主体 ============ */}
      <div className="container">
        <div className="section">
          <p className="title"><i className="fa fa-search fa-lg">&nbsp;</i>搜索：{q || ' '}</p>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#969ba3' }}>搜索中...</div>
          ) : !books.length ? (
            <div className="msgdiv" style={{ textAlign: 'center' }}>
              <p>未找到与 "<strong style={{ color: '#bf2c24' }}>{q}</strong>" 相关的书籍</p>
              <a className="l_btn" href="/" onClick={goHome}>返回首页</a>
            </div>
          ) : (
            books.map(b => (
              <div className="searchresult" key={b.id}>
                <h3><a {...bookNavProps(navigate, b.id)}>{b.name}</a></h3>
                <p>作者：{b.author} &nbsp; 类别：{b.category || '小说'} &nbsp; 字数：{formatWords(b.wordCount)}</p>
                <p className="searchresult_p">{b.intro || '暂无简介'}</p>
                <div>
                  <a className="gray" {...bookNavProps(navigate, b.id)}>最新章节：{b.latestChapter || '点击阅读'}</a>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 侧栏: 热门小说 */}
        {hotBooks.length > 0 && (
          <aside>
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
        )}
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
