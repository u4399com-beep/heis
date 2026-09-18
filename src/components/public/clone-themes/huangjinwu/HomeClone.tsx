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
import type { HomeCloneProps } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

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
const DEFAULT_RANK_CATS: Cat[] = [
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

export function HomeClone({ books, loading, navCategoryCount = 8, homeModuleLimit = 12, initialCategories }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  // R24: SSR 首载用 page.tsx server fetch 的 initialCategories 初始化, 避免 SSR 时 cats=[] → navigation 没分类
  // huangjinwu 的 sort-section 标题需加“榜”后缀, 与 client fetch 逻辑保持一致
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: (c.name || c.title || String(c)) + '榜' })))

  // 拉分类列表用于 sort-section 排行榜标题
  // R24: cats 为空时才 fetch, 避免覆盖 SSR initialCategories 数据
  useEffect(() => {
    if (cats.length > 0) return
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        const mapped: Cat[] = arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: (c.name || c.title || String(c)) + '榜' }))
        setCats(mapped.length ? mapped : DEFAULT_RANK_CATS)
      })
      .catch(() => { if (!aborted) setCats(DEFAULT_RANK_CATS) })
    return () => { aborted = true }
  }, [cats.length])

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
  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('keyword') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

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
                    <li key={n.id}>
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
