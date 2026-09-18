'use client'
// ============================================================
// clone-huangjinwu BookInfo — 1:1 精仿 huangjinwu.org 书籍详情页
// 参考: agent-ctx/probe-html2/probe-huangjinwu.html + huangjinwu.css 中的
//       .detail-header/.detail-cover/.detail-info/.detail-title/.detail-meta/
//       .detail-actions/.btn-primary/.btn-secondary/.detail-section/
//       .detail-section-title/.detail-description/.detail-intro-content/
//       .intro-toggle-btn/.chapter-list/.chapter-item 等 selector
// (huangjinwu 无 book probe, 从首页 DOM + CSS class 推断子页结构)
// 复刻: .header-group (复用首页玻璃 header) + .main-content > .container
//       > .breadcrumb + .detail-header (.detail-cover-wrapper + .detail-info
//       .detail-title + .detail-meta span × 6 + .detail-actions .btn-primary +
//       .btn-secondary) + .detail-section (.detail-section-title + .detail-description
//       .detail-intro-content + .intro-toggle-btn) + .detail-section (.detail-section-title
//       + .chapter-list .chapter-item × N) + .footers
// CSS 由 CloneCSSLoader 加载 public/clone-css/huangjinwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { formatWords, statusLabel, fmtDate } from '../../seo'
import type { BookInfoProps } from '../shared'
import { useState } from 'react'

const NAV_ITEMS = [
  { id: 'home', name: '首页', icon: 'icon-book' },
  { id: 'rank', name: '排行榜', icon: 'icon-hot' },
  { id: 'list', name: '书库', icon: 'icon-sort' },
  { id: 'tag', name: '标签', icon: 'icon-mark' },
  { id: 'author', name: '作者', icon: 'icon-user' },
  { id: 'dzss', name: '电子书', icon: 'icon-read' },
  { id: 'search', name: '搜索', icon: 'icon-search' },
]

export function BookInfo({ book, onScrollToc, onContinueRead, onGoCategory }: BookInfoProps) {
  const { site, navigate } = usePublic()
  const [introExpanded, setIntroExpanded] = useState(false)

  if (!book) return null

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
    if (onGoCategory && catId) onGoCategory(catId)
    else navigate({ view: 'category', cat: catId })
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

  // 拆分 keywords 字段为标签数组
  const tags = (book.keywords || '').split(/[,，、;；\s]+/).filter(Boolean).slice(0, 12)

  return (
    <>
      {/* 顶部 header (复用首页玻璃 header 结构) */}
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
                  <li className="dropdown-item-logged-in"><a href="/user/register" onClick={(e) => e.preventDefault()}>注册</a></li>
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
              <li className="breadcrumb-item">
                {book.categoryId ? (
                  <a href={`/list/${book.categoryId}`} onClick={(e) => goCat(e, book.categoryId!)}>{book.category || '小说'}</a>
                ) : (
                  <span>{book.category || '小说'}</span>
                )}
              </li>
              <li className="breadcrumb-separator">/</li>
              <li className="breadcrumb-item active">{book.name}</li>
            </ol>
          </nav>

          {/* 详情头部: 封面 + 标题 + 元数据 + 操作 */}
          <div className="detail-header">
            <div className="detail-cover-wrapper">
              <BookCover name={book.name} cover={book.cover} className="detail-cover" />
            </div>
            <div className="detail-info">
              <h1 className="detail-title">{book.name}</h1>
              <div className="detail-meta">
                <span>作者：{book.author}</span>
                <span>
                  分类：
                  {book.categoryId ? (
                    <a href={`/list/${book.categoryId}`} onClick={(e) => goCat(e, book.categoryId!)}>{book.category || '小说'}</a>
                  ) : (
                    <span>{book.category || '小说'}</span>
                  )}
                </span>
                <span>状态：{statusLabel(book.status)}</span>
                <span>字数：{formatWords(book.wordCount)}</span>
                {book.latestChapter && <span>最新：{book.latestChapter}</span>}
                <span>更新：{fmtDate(book.updatedAt)}</span>
              </div>
              <div className="detail-actions">
                <button type="button" className="btn btn-primary" onClick={() => { if (onContinueRead) onContinueRead(); else onScrollToc() }}>
                  <span className="iconfont icon-read"></span> 开始阅读
                </button>
                <button type="button" className="btn btn-secondary" onClick={onScrollToc}>
                  <span className="iconfont icon-sort"></span> 查看目录
                </button>
              </div>
            </div>
          </div>

          {/* 内容简介 */}
          <div className="detail-section">
            <div className="detail-section-header">
              <h2 className="detail-section-title">内容简介</h2>
            </div>
            <div className="detail-description">
              <div className={`detail-intro-content${introExpanded ? ' expanded' : ''}`}>
                <p>{book.intro || '暂无简介'}</p>
              </div>
              <button type="button" className={`intro-toggle-btn${introExpanded ? ' expanded' : ''}`} onClick={() => setIntroExpanded(v => !v)} aria-expanded={introExpanded}>
                {introExpanded ? '收起' : '展开全部'}
              </button>
            </div>
          </div>

          {/* 标签 */}
          {tags.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-header">
                <h2 className="detail-section-title">小说标签</h2>
              </div>
              <div className="tag-list">
                {tags.map(t => (
                  <a key={t} className="tag-item" href={`/tag/${encodeURIComponent(t)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: t }) }}>
                    <span className="tag-name">{t}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* 章节目录(占位, 实际目录由 BookView 父级渲染 TocList; 此处仅渲染章节入口提示) */}
          <div className="detail-section">
            <div className="detail-section-header">
              <h2 className="detail-section-title">章节目录</h2>
              <button type="button" className="btn btn-sm" onClick={onScrollToc}>查看完整目录</button>
            </div>
            <ul className="chapter-list">
              <li className="chapter-item">
                <a href="javascript:;" onClick={(e) => { e.preventDefault(); onScrollToc() }}>点击查看《{book.name}》完整章节目录</a>
              </li>
              {book.latestChapter && (
                <li className="chapter-item">
                  <a href="javascript:;" onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}>最新章节：{book.latestChapter}</a>
                </li>
              )}
            </ul>
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
