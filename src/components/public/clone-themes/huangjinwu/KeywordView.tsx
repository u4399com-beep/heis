'use client'
// ============================================================
// clone-huangjinwu KeywordView — 1:1 精仿 huangjinwu.org 标签关键词落地页
// 参考: huangjinwu.css 中 .breadcrumb/.page-title/.search-form/
//       .search-form-inline/.search-input/.search-result-info/
//       .section-title/.tag-list/.tag-item/.tag-name/.tag-count/
//       .book-list/.book-list-item 等 selector
// (huangjinwu 无 keyword probe, 从首页 DOM + CSS class 推断关键词页结构)
// 复刻: .header-group (玻璃 header) + .main-content > .container
//       > .breadcrumb + .page-title ("tag" 相关小说) + .search-form (搜索框
//       预填 tag) + .search-result-info (共 N 条) + .book-list (book-list-item × N)
//       + .detail-section.hot-tags-section (.section-title + .tag-list
//       .tag-item × N 相关标签) + .footers
// CSS 由 CloneCSSLoader 加载 public/clone-css/huangjinwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords, statusLabel, fmtDate } from '../../seo'
import type { KeywordViewProps } from '../shared'
import type { BookItem } from '../../types'

const NAV_ITEMS = [
  { id: 'home', name: '首页', icon: 'icon-book' },
  { id: 'rank', name: '排行榜', icon: 'icon-hot' },
  { id: 'list', name: '书库', icon: 'icon-sort' },
  { id: 'tag', name: '标签', icon: 'icon-mark' },
  { id: 'author', name: '作者', icon: 'icon-user' },
  { id: 'dzss', name: '电子书', icon: 'icon-read' },
  { id: 'search', name: '搜索', icon: 'icon-search' },
]

export function KeywordView({ tag, books, loading }: KeywordViewProps) {
  const { site, navigate } = usePublic()

  // 相关标签: 从 books 的 keywords 字段拆分去重, fallback 用书籍首字
  const relatedTags: string[] = Array.from(new Set(
    books.slice(0, 24).flatMap(b => {
      const kw = (b as any).keywords
      if (kw) return String(kw).split(/[,，、;；\s]+/).filter(Boolean)
      return [b.category].filter(Boolean) as string[]
    })
  )).filter(t => t && t !== tag).slice(0, 16)

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goNav = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    if (id === 'home') navigate({ view: 'home' })
    else if (id === 'rank') navigate({ view: 'ranking' })
    else if (id === 'list' || id === 'dzss') navigate({ view: 'fulltext' })
    else if (id === 'search') navigate({ view: 'search' })
    else if (id === 'tag') navigate({ view: 'keyword', tag: '小说' })
    else if (id === 'author') navigate({ view: 'search' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const kw = (e.currentTarget.elements.namedItem('keyword') as HTMLInputElement)?.value?.trim()
    if (kw) navigate({ view: 'search', q: kw })
  }
  const goTag = (e: React.MouseEvent, t: string) => {
    e.preventDefault()
    navigate({ view: 'keyword', tag: t })
  }

  const renderBookItem = (b: BookItem) => (
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
  )

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
                <input className="navbar-search-input" type="text" placeholder="可搜书名、作者、角色" name="keyword" defaultValue={tag || ''} autoComplete="off" required />
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
              <li className="breadcrumb-item"><a href="/tag" onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: '小说' }) }}>标签</a></li>
              <li className="breadcrumb-separator">/</li>
              <li className="breadcrumb-item active">{tag}</li>
            </ol>
          </nav>

          {/* 关键词标题 */}
          <h2 className="page-title">
            <span className="iconfont icon-mark"></span> 「{tag}」相关小说
          </h2>

          {/* 搜索框 */}
          <form className="search-form" onSubmit={goSearch}>
            <div className="search-form-inline">
              <input type="text" name="keyword" className="search-input" placeholder="可搜书名、作者、角色" defaultValue={tag || ''} />
              <button type="submit" className="btn btn-primary">
                <span className="iconfont icon-search"></span> 搜索
              </button>
            </div>
          </form>

          {/* 结果统计 */}
          {tag && (
            <div className="search-result-info">
              共找到 <strong>{books.length}</strong> 部与「<strong>{tag}</strong>」相关的小说
            </div>
          )}

          {/* 书籍列表 */}
          {loading ? (
            <div className="empty-state"><p>加载中...</p></div>
          ) : !books.length ? (
            <div className="search-empty">
              <p>暂无与「{tag}」相关的小说。</p>
            </div>
          ) : (
            <div className="book-list">
              {books.map(b => renderBookItem(b))}
            </div>
          )}

          {/* 相关标签 */}
          {relatedTags.length > 0 && (
            <div className="detail-section hot-tags-section">
              <h2 className="section-title">
                <span className="iconfont icon-mark"></span> 相关标签
              </h2>
              <div className="tag-list">
                {relatedTags.map(t => (
                  <a key={t} className="tag-item" href={`/tag/${encodeURIComponent(t)}`} onClick={(e) => goTag(e, t)}>
                    <span className="tag-name">{t}</span>
                  </a>
                ))}
              </div>
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
