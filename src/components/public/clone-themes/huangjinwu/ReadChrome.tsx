'use client'
// ============================================================
// clone-huangjinwu ReadChrome — 1:1 精仿 huangjinwu.org 章节阅读页外壳
// 参考: huangjinwu.css 中 .reader-container/.reader-header/.reader-title/
//       .reader-controls/.reader-content/.reader-content h1/#chapterTitle/
//       .reader-content p/.reader-nav/.btn-primary/.btn-secondary 等 selector
// (huangjinwu 无 chapter probe, 从首页 DOM + CSS class 推断子页结构)
// 复刻: .header-group (玻璃 header) + .main-content > .container
//       > .breadcrumb + .reader-container (.reader-header .reader-title
//       章节标题 + .reader-controls 翻页按钮) + .reader-content (children 正文
//       h1#chapterTitle + p 段落) + .reader-nav (.btn-primary 上一章/.btn-secondary
//       目录/.btn-primary 下一章) + .footers
// CSS 由 CloneCSSLoader 加载 public/clone-css/huangjinwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared'
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

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  const { site, navigate } = usePublic()

  const goNav = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    if (id === 'home') navigate({ view: 'home' })
    else if (id === 'rank') navigate({ view: 'ranking' })
    else if (id === 'list' || id === 'dzss') navigate({ view: 'fulltext' })
    else if (id === 'search') navigate({ view: 'search' })
    else if (id === 'tag') navigate({ view: 'keyword', tag: '小说' })
    else if (id === 'author') navigate({ view: 'search' })
  }
  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'keyword')

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
                <input className="navbar-search-input" type="text" placeholder="可搜书名、作者、角色" name="keyword" autoComplete="off" required />
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
              <li className="breadcrumb-item"><a href="/list" onClick={(e) => { e.preventDefault(); navigate({ view: 'fulltext' }) }}>书库</a></li>
              <li className="breadcrumb-separator">/</li>
              <li className="breadcrumb-item active">{chapterTitle || '章节阅读'}</li>
            </ol>
          </nav>

          {/* 阅读器外壳 */}
          <div className="reader-container">
            <div className="container">
              {/* 阅读器头部: 标题 + 控件 */}
              <div className="reader-header">
                <h1 className="reader-title">{chapterTitle || '章节阅读'}</h1>
                <div className="reader-controls">
                  {onPrev && (
                    <button type="button" className="btn btn-secondary" onClick={onPrev}>
                      <span className="iconfont icon-back"></span> 上一章
                    </button>
                  )}
                  {onNext && (
                    <button type="button" className="btn btn-primary" onClick={onNext}>
                      下一章 <span className="iconfont icon-read"></span>
                    </button>
                  )}
                </div>
              </div>

              {/* 阅读器正文 (children 由父级 ReadView 渲染分页/段落) */}
              <article className="reader-content">
                <h1 id="chapterTitle">{chapterTitle}</h1>
                <div className="content">
                  {children}
                </div>
              </article>

              {/* 阅读器底部翻页 */}
              <nav className="reader-nav">
                {onPrev && (
                  <button type="button" className="btn btn-secondary" onClick={onPrev}>
                    <span className="iconfont icon-back"></span> 上一章
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => navigate({ view: 'home' })}>
                  <span className="iconfont icon-book"></span> 返回首页
                </button>
                {onNext && (
                  <button type="button" className="btn btn-primary" onClick={onNext}>
                    下一章 <span className="iconfont icon-read"></span>
                  </button>
                )}
              </nav>
            </div>
          </div>
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
