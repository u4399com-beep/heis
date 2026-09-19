'use client'
// ============================================================
// clone-huangjinwu SearchView — 1:1 精仿 huangjinwu.org 搜索结果页
// 参考: huangjinwu.css 中 .breadcrumb/.search-form/.search-form-inline/
//       .search-input/.btn-primary/.search-result-info/.search-empty/
//       .book-list/.book-list-item/.book-list-cover/.book-list-info/
//       .book-list-title/.book-list-desc/.book-list-meta/.book-badges 等 selector
// (huangjinwu 无 search probe, 从首页 DOM + CSS class 推断搜索页结构)
// 复刻: .header-group (玻璃 header) + .main-content > .container
//       > .breadcrumb + .search-form (.search-form-inline: input.search-input
//       + button.btn-primary "搜索") + .search-result-info (共 N 条结果)
//       + .book-list (book-list-item × N: .book-list-cover + .book-list-info
//       .book-list-title + .book-list-desc + .book-list-meta + .book-badges)
//       / .search-empty (无结果) + .footers
// CSS 由 CloneCSSLoader 加载 public/clone-css/huangjinwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords, statusLabel, fmtDate } from '../../seo'
import type { SearchViewProps } from '../shared'
import { cloneNavHandlers } from '../shared'

const NAV_ITEMS = [
  { id: 'home', name: '首页', icon: 'icon-book' },
  { id: 'rank', name: '排行榜', icon: 'icon-hot' },
  { id: 'list', name: '书库', icon: 'icon-sort' },
  { id: 'tag', name: '标签', icon: 'icon-mark' },
  { id: 'author', name: '作者', icon: 'icon-user' },
  { id: 'dzss', name: '电子书', icon: 'icon-read' },
  { id: 'search', name: '搜索', icon: 'icon-search' },
]

export function SearchView({ q, books, loading }: SearchViewProps) {
  const { site, navigate } = usePublic()

  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'keyword')
  const goNav = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    if (id === 'home') navigate({ view: 'home' })
    else if (id === 'rank') navigate({ view: 'ranking' })
    else if (id === 'list' || id === 'dzss') navigate({ view: 'fulltext' })
    else if (id === 'search') navigate({ view: 'search' })
    else if (id === 'tag') navigate({ view: 'keyword', tag: '小说' })
    else if (id === 'author') navigate({ view: 'search' })
  }
  return (
    <>
      {/* 顶部 header (玻璃 header) */}
      <div className="header-group">
        <div className="headers">
          <div className="container">
            <div className="navbar">
              <div className="user-dropdown">
                <button className="user-toggle user-dropdown-toggle" aria-label="个人中心" type="button">
                  <span className="iconfont icon-user"></span>
                </button>
                <ul className="user-dropdown-menu">
                  <li><a href="/user/history" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}>临时书架</a></li>
                  <li className="dropdown-item-logged-in"><a href="/user/login" onClick={(e) => e.preventDefault()}>登录</a></li>
                </ul>
              </div>
              <a href="/" className="logo" title={site.name} onClick={goHome}>
                <span className="iconfont icon-book"></span>{site.name}
              </a>
              <div className="sidebar-wrapper">
                <div className="sidebar-header">
                  <a href="/" className="sidebar-logo" title={site.name} onClick={goHome}>
                    <span className="iconfont icon-book"></span>
                    <span className="sidebar-logo-text">{site.name}</span>
                  </a>
                </div>
                <ul className="navbar-menu">
                  {NAV_ITEMS.map(n => (
                    <li key={n.id}>
                      <a href={n.id === 'home' ? '/' : `/${n.id}`} onClick={(e) => goNav(e, n.id)}>
                        <span className={`menu-icon iconfont ${n.icon}`}></span>
                        <span className="menu-text">{n.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <form className="navbar-search" onSubmit={goSearch}>
                <input className="navbar-search-input" type="text" placeholder="可搜书名、作者、角色" name="keyword" defaultValue={q || ''} autoComplete="off" required />
                <button className="navbar-search-btn" type="submit" aria-label="搜索">
                  <span className="iconfont icon-search"></span>
                </button>
              </form>
              <button className="theme-toggle" type="button" aria-label="切换主题">
                <span className="iconfont icon-dark"></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="container">
          {/* 面包屑 */}
          <nav className="breadcrumb" aria-label="面包屑">
            <ol className="breadcrumb-list">
              <li className="breadcrumb-item"><a href="/" onClick={goHome}>首页</a></li>
              <li className="breadcrumb-separator">/</li>
              <li className="breadcrumb-item active">搜索：{q}</li>
            </ol>
          </nav>

          {/* 大搜索框 */}
          <form className="search-form" onSubmit={goSearch}>
            <div className="search-form-inline">
              <input type="text" name="keyword" className="search-input" placeholder="可搜书名、作者、角色" defaultValue={q || ''} />
              <button type="submit" className="btn btn-primary">
                <span className="iconfont icon-search"></span> 搜索
              </button>
            </div>
          </form>

          {/* 搜索结果统计 */}
          {q && (
            <div className="search-result-info">
              共找到 <strong>{books.length}</strong> 条与「<strong>{q}</strong>」相关的小说
            </div>
          )}

          {/* 搜索结果列表 */}
          {loading ? (
            <div className="empty-state"><p>搜索中...</p></div>
          ) : !books.length ? (
            <div className="search-empty">
              <p>未找到与「{q}」相关的小说，换个关键词试试吧。</p>
            </div>
          ) : (
            <div className="book-list">
              {books.map(b => (
                <div className="book-list-item" key={b.id}>
                  <a href={`/novel/${b.id}`} title={b.name} {...bookNavProps(navigate, b.id)}>
                    <div className="book-list-cover">
                      <BookCover name={b.name} cover={b.cover} />
                    </div>
                    <div className="book-list-info">
                      <h3 className="book-list-title">{b.name}</h3>
                      <div className="book-list-desc">{b.intro || '暂无简介'}</div>
                      <div className="book-list-meta">
                        <span>作者：{b.author}</span>
                        <span>分类：{b.category || '小说'}</span>
                        <span>状态：{statusLabel(b.status)}</span>
                        <span>字数：{formatWords(b.wordCount)}</span>
                        <span>更新：{fmtDate(b.updatedAt)}</span>
                      </div>
                      <div className="book-badges">
                        <span className="book-badge category">{b.category || '小说'}</span>
                        <span className="book-badge status">{b.status === 'completed' ? '全本' : '连载'}</span>
                        <span className="book-badge words">{formatWords(b.wordCount)}</span>
                      </div>
                    </div>
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 页脚 */}
      <div className="footers">
        <div className="container">
          <p className="copyright">本站小说由根据搜索引擎转码，只为让更多读者欣赏，不保存小说内及数据，仅作宣传展示。</p>
          <p className="copyright">Copyright ©{new Date().getFullYear()}{site.name}</p>
        </div>
      </div>
    </>
  )
}
