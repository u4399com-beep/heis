'use client'
// ============================================================
// clone-huangjinwu FulltextView — 1:1 精仿 huangjinwu.org 全本小说页
// 参考: huangjinwu.css 中 .breadcrumb/.page-title/.filter-bar/.filter-tags/
//       .filter-tag/.book-list/.book-list-item/.book-list-cover/.book-list-info/
//       .book-list-title/.book-list-desc/.book-list-meta/.book-badges/
//       .pagination/.pagination-list/.page-link/.page-info 等 selector
// (huangjinwu 无 fulltext probe, 从首页 DOM + CSS class 推断全本页结构)
// 复刻: .header-group (玻璃 header) + .main-content > .container
//       > .breadcrumb + .page-title (全本完本) + .filter-bar (.filter-tags
//       分类切换) + .book-list (book-list-item × N: .book-list-cover + .book-list-info)
//       + .pagination + .footers
// CSS 由 CloneCSSLoader 加载 public/clone-css/huangjinwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords, statusLabel, fmtDate } from '../../seo'
import type { FulltextViewProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: 'xuanhuan', name: '玄幻' },
  { id: 'xianxia', name: '仙侠' },
  { id: 'dushi', name: '都市' },
  { id: 'lishi', name: '历史' },
  { id: 'wangyou', name: '网游' },
  { id: 'kehuan', name: '科幻' },
  { id: 'qita', name: '其他' },
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

export function FulltextView({ books, loading, page, total, size, onPage }: FulltextViewProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])

  useEffect(() => {
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        const mapped: Cat[] = arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) }))
        setCats(mapped.length ? mapped : DEFAULT_NAV)
      })
      .catch(() => { if (!aborted) setCats(DEFAULT_NAV) })
    return () => { aborted = true }
  }, [])

  const navCats = cats.length ? cats : DEFAULT_NAV
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
              <li className="breadcrumb-item active">全本小说</li>
            </ol>
          </nav>

          {/* 全本标题 */}
          <h2 className="page-title">
            <span className="iconfont icon-book"></span> 全本完本小说
          </h2>

          {/* 分类筛选 */}
          <div className="filter-bar">
            <div className="filter-tags">
              {navCats.map(c => (
                <a key={c.id} className="filter-tag" href={`/list/${c.id}`} onClick={(e) => goCat(e, c.id)}>
                  {c.name}
                </a>
              ))}
            </div>
          </div>

          {/* 全本列表 (book-list-item) */}
          <div className="book-list">
            {loading ? (
              <div className="empty-state"><p>全本小说加载中...</p></div>
            ) : !books.length ? (
              <div className="empty-state"><p>暂无全本小说</p></div>
            ) : books.map(b => (
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
