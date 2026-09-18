'use client'
// ============================================================
// clone-huangjinwu RankingView — 1:1 精仿 huangjinwu.org 排行榜页
// 参考: huangjinwu.css 中 .filter-bar/.filter-tags/.filter-tag.active/
//       .category-ranking-grid/.ranking-module/.ranking-module-title/
//       .ranking-list/.ranking-item:before (counter)/.ranking-title/
//       .ranking-author/.pagination 等 selector + 首页 .sort-section
// (huangjinwu 无 rank probe, 从首页 .sort-section + CSS class 推断排行页结构)
// 复刻: .header-group (玻璃 header) + .main-content > .container
//       > .breadcrumb + .page-title (排行榜) + .filter-bar (.filter-tags 5 个 tab:
//       总点击/总推荐/总收藏/字数榜/最近更新) + .category-ranking-grid
//       (.ranking-module × 6 分类排行榜, .ranking-list 含 .ranking-item × 10
//       .ranking-title + .ranking-author) + .pagination + .footers
// CSS 由 CloneCSSLoader 加载 public/clone-css/huangjinwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
import type { RankingViewProps } from '../shared'

const TABS = [
  { id: 'allvisit', name: '总点击' },
  { id: 'allvote', name: '总推荐' },
  { id: 'goodnum', name: '总收藏' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
] as const

// 排行榜 6 个分类模块
const RANK_MODULES = [
  { id: 'xuanhuan', name: '玄幻小说榜' },
  { id: 'xianxia', name: '仙侠小说榜' },
  { id: 'dushi', name: '都市小说榜' },
  { id: 'lishi', name: '历史小说榜' },
  { id: 'wangyou', name: '网游小说榜' },
  { id: 'kehuan', name: '科幻小说榜' },
]

const NAV_ITEMS = [
  { id: 'home', name: '首页', icon: 'icon-book' },
  { id: 'rank', name: '排行榜', icon: 'icon-hot' },
  { id: 'list', name: '书库', icon: 'icon-sort' },
  { id: 'tag', name: '标签', icon: 'icon-mark' },
  { id: 'author', name: '作者', icon: 'icon-user' },
  { id: 'dzss', name: '电子书', icon: 'icon-read' },
  { id: 'search', name: '搜索', icon: 'icon-search' },
]

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage }: RankingViewProps) {
  const { site, navigate } = usePublic()
  const totalPages = Math.max(1, Math.ceil(total / size))

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
  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('keyword') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  // 6 个分类排行榜: 每个模块按 categoryId 过滤, fallback 全集
  const rankSections = RANK_MODULES.map((m, i) => {
    const list = books.filter(b => b.categoryId === m.id || (b.category || '') === m.name.replace(/小说榜$/, ''))
    const pool = list.length >= 3 ? list : books.slice(i * 10, i * 10 + 10).length ? books.slice(i * 10, i * 10 + 10) : books
    return { cat: m, list: pool.slice(0, 10) }
  })

  // 分页
  const renderPager = () => {
    if (total <= size) return null
    const start = Math.max(1, page - 4)
    const end = Math.min(totalPages, start + 9)
    const nums: number[] = []
    for (let i = start; i <= end; i++) nums.push(i)
    return (
      <div className="pagination">
        <ul className="pagination-list">
          <li><button type="button" className="page-link" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button></li>
          {nums.map(n => (
            <li key={n}><button type="button" className={`page-link${n === page ? ' active' : ''}`} onClick={() => onPage(n)} disabled={n === page}>{n}</button></li>
          ))}
          <li><button type="button" className="page-link" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>下一页</button></li>
        </ul>
        <span className="page-info">第 {page} / {totalPages} 页 · 共 {total} 条</span>
      </div>
    )
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
              <li className="breadcrumb-item active">排行榜</li>
            </ol>
          </nav>

          {/* 排行榜标题 */}
          <h2 className="page-title">
            <span className="iconfont icon-hot"></span> 排行榜
          </h2>

          {/* 排序 tab 切换 */}
          <div className="filter-bar">
            <div className="filter-tags">
              {TABS.map(t => (
                <a key={t.id} className={`filter-tag${tab === t.id ? ' active' : ''}`} href={`?tab=${t.id}`} onClick={(e) => { e.preventDefault(); onTabChange(t.id) }}>
                  {t.name}
                </a>
              ))}
            </div>
          </div>

          {/* 分类排行榜 (6 个 module × 10 item) */}
          {loading ? (
            <div className="empty-state"><p>排行数据加载中...</p></div>
          ) : !books.length ? (
            <div className="empty-state"><p>暂无排行数据</p></div>
          ) : (
            <div className="category-ranking-grid">
              {rankSections.map(({ cat, list }) => (
                <div className="ranking-module" key={cat.id}>
                  <div className="ranking-module-title">
                    <a href={`/list/${cat.id}`} onClick={(e) => goCat(e, cat.id)} style={{ color: 'inherit', textDecoration: 'none' }}>{cat.name}</a>
                  </div>
                  <div className="ranking-list">
                    {list.length ? list.map(b => (
                      <div className="ranking-item" key={b.id}>
                        <a href={`/novel/${b.id}`} title={b.name} className="ranking-title" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                        <span className="ranking-author">{b.author}</span>
                      </div>
                    )) : (
                      <div className="ranking-item"><span className="ranking-title">暂无数据</span><span className="ranking-author"></span></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分页 */}
          {renderPager()}
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
