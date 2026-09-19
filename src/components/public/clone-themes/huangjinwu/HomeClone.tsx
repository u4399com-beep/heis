'use client'
// ============================================================
// clone-huangjinwu HomeClone — 1:1 精仿 huangjinwu.org 首页
// 参考: agent-ctx/probe-html2/probe-huangjinwu.html (源站真实 DOM)
// 复刻: .header-group > .headers > .container > .navbar (.user-dropdown + .logo
//       + .sidebar-wrapper .navbar-menu 7 项 + .navbar-search + .theme-toggle)
//       + .menu-toggle + .menu-overlay
//       / .main-content > .container > .hot-section (热门推荐 .book-grid × 6)
//       / .sort-section (分类排行榜 .category-ranking-grid × 6 module)
//       / .update-section (最新更新 .book-grid × N)
//       / .detail-section.ebook-more-ebooks (最新电子书 .chapter-list)
//       / .footers > .container > .sitemap + .copyright
// CSS 由 CloneCSSLoader 加载 public/clone-css/huangjinwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import { addFavoriteSite, useTraditionalChinese } from '../tools'
import type { HomeCloneProps } from '../shared'
import { cloneNavHandlers, useCloneCategories, mapCatWithBangSuffix, type CloneCategory } from '../shared'
import type { BookItem } from '../../types'

// 源站 navbar-menu 7 项固定导航
const NAV_ITEMS: { id: string; name: string; icon: string }[] = [
  { id: 'home', name: '首页', icon: 'icon-book' },
  { id: 'rank', name: '排行榜', icon: 'icon-hot' },
  { id: 'list', name: '书库', icon: 'icon-sort' },
  { id: 'tag', name: '标签', icon: 'icon-mark' },
  { id: 'author', name: '作者', icon: 'icon-user' },
  { id: 'dzss', name: '电子书', icon: 'icon-read' },
  { id: 'search', name: '搜索', icon: 'icon-search' },
]

// 源站首页 6 个分类排行榜 (与 .sort-section 中 .ranking-module 一一对应)
// R31-1D: 改为 CloneCategory 类型 (与 useCloneCategories hook 返回值一致)
const DEFAULT_RANK_CATS: CloneCategory[] = [
  { id: 'xuanhuan', name: '玄幻小说榜' },
  { id: 'xianxia', name: '仙侠小说榜' },
  { id: 'dushi', name: '都市小说榜' },
  { id: 'lishi', name: '历史小说榜' },
  { id: 'wangyou', name: '网游小说榜' },
  { id: 'kehuan', name: '科幻小说榜' },
]

// 源站首页 sitemap 链接
const SITEMAP_LINKS = [
  { href: '/sitemap/html/category', title: '小说大全' },
  { href: '/sitemap/html/news', title: '相关小说大全' },
  { href: '/sitemap/html/tag', title: '标签大全' },
  { href: '/sitemap/html/author', title: '作者大全' },
  { href: '/sitemap/html/ebook', title: '电子书大全' },
  { href: '/sitemap/html/ebooknews', title: '相关电子书大全' },
]

// 简繁切换按钮 — huangjinwu 风格 (navbar 内 iconfont icon-language + 文字)
function TcToggleHuangjinwu() {
  const { isTc, mounted, toggleTc } = useTraditionalChinese()
  const label = mounted && isTc ? '简体' : '繁體'
  return (
    <a
      href="#tc-toggle"
      title="简繁切换"
      className="navbar-link"
      onClick={(e) => { e.preventDefault(); toggleTc() }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, color: 'inherit', textDecoration: 'none', fontSize: 13 }}
    >
      <span className="iconfont icon-language"></span>
      <span>{label}</span>
    </a>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 8, homeModuleLimit = 12, initialCategories }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  // R31-1D 修复: 用 useCloneCategories hook + mapCatWithBangSuffix 映射
  // R29-1D worklog 声称重构了本文件, 但实际未改 (仍走 useState+useEffect+fetch);
  // 现 R31-1D 真正落地, 51/51 clone 全部走 hook, 0 残留.
  // huangjinwu 的 sort-section 标题需加“榜”后缀, 通过 mapCatWithBangSuffix 实现
  const cats = useCloneCategories(initialCategories, DEFAULT_RANK_CATS, 60, mapCatWithBangSuffix)

  if (loading) return <div className="main-content"><div className="container" style={{ padding: 40, textAlign: 'center' }}>加载中...</div></div>
  if (!books.length) return <div className="main-content"><div className="container empty-state"><p>暂无内容</p></div></div>

  // 热门推荐: 取前 6 本
  const hotBooks = books.slice(0, 6)
  // 最新更新: 取接下来的 12 本
  const updateBooks = books.slice(6, 6 + homeModuleLimit)
  // 分类排行榜: 取 navCategoryCount 个 module, 每个含 10 本 (按 categoryId 分组, 不够时 fallback 全集)
  const rankCats = (cats.length ? cats : DEFAULT_RANK_CATS).slice(0, navCategoryCount)
  const rankSections = rankCats.map((c, i) => {
    const list = books.filter(b => b.categoryId === c.id || (b.category || '').replace(/榜$/, '') === c.name.replace(/榜$/, ''))
    const pool = list.length >= 3 ? list : books.slice(i * 10, i * 10 + 10).length ? books.slice(i * 10, i * 10 + 10) : books
    return { cat: c, list: pool.slice(0, 10) }
  })
  // 最新电子书 chapter-list: 取书籍的 latestChapter 渲染列表
  const ebookList = books.filter(b => b.latestChapter).slice(0, 24)

  // nav 跳转
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
  const { goHome, goSearch, goCat } = cloneNavHandlers(navigate, 'keyword')

  // 渲染单个 .book-card (无图, 仅文字 + 简介的卡片, 复刻源站 .book-card 结构)
  const renderBookCard = (b: BookItem) => (
    <a key={b.id} href={`/novel/${b.id}`} title={b.name} className="book-card" {...bookNavProps(navigate, b.id)}>
      <div className="book-info">
        <div className="book-title">{b.name}</div>
        <div className="book-author">作者：{b.author}</div>
        <div className="book-desc">{b.intro || '暂无简介'}</div>
        <div className="book-badges">
          <span className="book-badge category">{b.category || '小说'}</span>
          <span className="book-badge status">{b.status === 'completed' ? '全本' : '连载'}</span>
          <span className="book-badge words">{formatWords(b.wordCount)}</span>
        </div>
      </div>
    </a>
  )

  // 渲染单个 .ranking-item (排行榜文字列表行)
  const renderRankingItem = (b: BookItem) => (
    <div className="ranking-item" key={b.id}>
      <a href={`/novel/${b.id}`} title={b.name} className="ranking-title" {...bookNavProps(navigate, b.id)}>{b.name}</a>
      <span className="ranking-author">{b.author}</span>
    </div>
  )

  return (
    <>
      {/* 顶部 header (玻璃效果, CSS 已配置 backdrop-filter) */}
      <div className="header-group">
        <div className="headers">
          <div className="container">
            <div className="navbar">
              {/* 用户下拉 */}
              <div className="user-dropdown">
                <button className="user-toggle user-dropdown-toggle" aria-label="个人中心" type="button">
                  <span className="iconfont icon-user"></span>
                </button>
                <ul className="user-dropdown-menu">
                  <li><a href="/user/history" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}>临时书架</a></li>
                  <li className="dropdown-item-logged-out"><a href="/user/bookcase" onClick={(e) => e.preventDefault()}>会员书架</a></li>
                  <li className="dropdown-item-logged-out"><a href="/user/passwd" onClick={(e) => e.preventDefault()}>修改密码</a></li>
                  <li className="dropdown-item-logged-in"><a href="/user/login" onClick={(e) => e.preventDefault()}>登录</a></li>
                  <li className="dropdown-item-logged-in"><a href="/user/register" onClick={(e) => e.preventDefault()}>注册</a></li>
                </ul>
              </div>
              {/* logo */}
              <a href="/" className="logo" title={site.name} onClick={goHome}>
                <span className="iconfont icon-book"></span>{site.name}
              </a>
              {/* 侧边栏(移动端抽屉/桌面端水平导航) */}
              <div className="sidebar-wrapper">
                <div className="sidebar-header">
                  <a href="/" className="sidebar-logo" title={site.name} onClick={goHome}>
                    <span className="iconfont icon-book"></span>
                    <span className="sidebar-logo-text">{site.name}</span>
                  </a>
                </div>
                <ul className="navbar-menu" id="navbarMenu">
                  {NAV_ITEMS.map(n => (
                    <li key={n.id} className={n.id === 'search' ? 'navbar-menu-search' : undefined}>
                      <a href={n.id === 'home' ? '/' : `/${n.id}`} onClick={(e) => goNav(e, n.id)}>
                        <span className={`menu-icon iconfont ${n.icon}`}></span>
                        <span className="menu-text">{n.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              {/* 搜索框 (桌面端) */}
              <form className="navbar-search" action="/search" method="get" onSubmit={goSearch}>
                <input className="navbar-search-input" type="text" placeholder="可搜书名、作者、角色" name="keyword" id="searchkey" autoComplete="off" required />
                <button className="navbar-search-btn" type="submit" aria-label="搜索">
                  <span className="iconfont icon-search"></span>
                </button>
              </form>
              {/* 主题切换 (装饰, 不绑定) */}
              <button className="theme-toggle" type="button" aria-label="切换主题">
                <span className="iconfont icon-dark"></span>
              </button>
              {/* 收藏本站 + 简繁切换 */}
              <a href="#favorite" title="收藏本站 (Ctrl+D)" className="navbar-link" onClick={(e) => addFavoriteSite(e)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, color: 'inherit', textDecoration: 'none' }}>
                <span className="iconfont icon-mark"></span>
                <span style={{ fontSize: 13 }}>收藏本站</span>
              </a>
              <TcToggleHuangjinwu />
            </div>
          </div>
          <div className="menu-overlay" id="menuOverlay" aria-hidden="true"></div>
        </div>
        <button className="menu-toggle" id="menuToggle" aria-label="菜单" type="button">
          <span className="iconfont icon-menu"></span>
        </button>
      </div>

      {/* 主内容区 */}
      <div className="main-content">
        <div className="container">
          {/* 热门推荐 */}
          <div className="hot-section">
            <h2 className="page-title">
              <span className="iconfont icon-hot"></span> 热门推荐
            </h2>
            <div className="book-grid">
              {hotBooks.map(b => renderBookCard(b))}
            </div>
          </div>

          {/* 分类排行榜 (6 个 module) */}
          <div className="sort-section">
            <h2 className="page-title">
              <span className="iconfont icon-sort"></span> 分类排行榜
            </h2>
            <div className="category-ranking-grid">
              {rankSections.map(({ cat, list }) => (
                <div className="ranking-module" key={cat.id}>
                  <div className="ranking-module-title">
                    <a href={`/list/${cat.id}`} title={cat.name} onClick={(e) => goCat(e, cat.id)} style={{ color: 'inherit', textDecoration: 'none' }}>{cat.name}</a>
                  </div>
                  <div className="ranking-list">
                    {list.length ? list.map(b => renderRankingItem(b)) : (
                      <div className="ranking-item"><span className="ranking-title">暂无数据</span><span className="ranking-author"></span></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 最新更新 */}
          <div className="update-section">
            <h2 className="page-title">
              <span className="iconfont icon-time"></span> 最新更新
            </h2>
            <div className="book-grid">
              {updateBooks.map(b => renderBookCard(b))}
            </div>
          </div>

          {/* 最新电子书 chapter-list */}
          {ebookList.length > 0 && (
            <div className="detail-section ebook-more-ebooks">
              <h3 className="section-title">
                <span className="iconfont icon-read"></span> 最新电子书
              </h3>
              <ul className="chapter-list chapter-list--all">
                {ebookList.map(b => (
                  <li className="chapter-item" key={b.id}>
                    <a href={`/dzs/${b.id}`} title={`《${b.name}》${b.author}`} {...bookNavProps(navigate, b.id)}>
                      《{b.name}》{b.author}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* 页脚 */}
      <div className="footers">
        <div className="container">
          <p className="sitemap">
            {SITEMAP_LINKS.map((l, i) => (
              <span key={l.href}>
                <a href={l.href} title={l.title} onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>{l.title}</a>
                {i < SITEMAP_LINKS.length - 1 ? ' | ' : ''}
              </span>
            ))}
          </p>
          <p className="copyright">本站小说由根据搜索引擎转码，只为让更多读者欣赏，不保存小说内及数据，仅作宣传展示。</p>
          <p className="copyright">Copyright ©{new Date().getFullYear()}{site.name}</p>
        </div>
      </div>
    </>
  )
}
