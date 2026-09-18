'use client'
// ============================================================
// clone-trxsw FulltextView — 1:1 精仿天人小说 trxsw.com 全本完本小说页
// 参考: themes.ts AiraBrowser 反查 DOM (.vlist 章节列表 + .pager 翻页)
//   唐人小说 CMS 通用列表页模板 (与 CategoryList 同模式):
//   .breadcrumb + .filter-bar (筛选条) + .list-item (横向 list 列表) +
//   .pager 分页 + 侧栏 .hot 全本排行 + .tags 标签云
// CSS 由 CloneCSSLoader 加载 public/clone-css/trxsw.css
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { statusLabel, formatWords } from '../../seo'
import type { FulltextViewProps } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: 'xuanhuan', name: '玄幻' }, { id: 'xiuzhen', name: '修真' },
  { id: 'dushi', name: '都市' }, { id: 'lishi', name: '历史' },
  { id: 'wangyou', name: '网游' }, { id: 'kehuan', name: '科幻' },
  { id: 'kongbu', name: '恐怖' }, { id: 'yanqing', name: '言情' },
  { id: 'junshi', name: '军事' }, { id: 'wuxia', name: '武侠' },
  { id: 'lingyi', name: '灵异' }, { id: 'jingji', name: '竞技' },
  { id: 'tongren', name: '同人' }, { id: 'junxiao', name: '校园' },
  { id: 'shehui', name: '社会' }, { id: 'other', name: '其他' },
]

export function FulltextView({ books, loading, page, total, size, onPage, initialCategories }: FulltextViewProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))

  useEffect(() => {
    if (cats.length > 0) return
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
  }, [cats.length])

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 12)
  const totalPages = Math.max(1, Math.ceil(total / size))
  // 侧栏全本排行: 前 10 本
  const hotTop10 = books.slice(0, 10)

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const goRanking = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'ranking' }) }
  const goFulltext = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'fulltext' }) }
  const goHistory = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'history' }) }

  const renderListItem = (b: BookItem) => {
    const dateStr = b.updatedAt ? new Date(b.updatedAt).toISOString().slice(0, 10) : ''
    return (
      <div className="list-item" key={b.id}>
        <a className="list-cover" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>
          <BookCover name={b.name} cover={b.cover} className="w-full h-full" />
        </a>
        <div className="list-info">
          <div className="list-title">
            <a href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
            {b.status === 'completed' && <span className="tag-new" style={{ marginLeft: 8 }}>完结</span>}
          </div>
          <div className="list-author">
            作者：<a href="javascript:;" title={b.author} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: b.author }) }}>{b.author}</a>
          </div>
          <div className="list-meta">
            <span className="meta-item"><span className="meta-label">分类：</span><span className="meta-value">{b.category || '小说'}</span></span>
            <span className="meta-item"><span className="meta-label">状态：</span><span className="meta-value">{statusLabel(b.status)}</span></span>
            <span className="meta-item"><span className="meta-label">字数：</span><span className="meta-value">{formatWords(b.wordCount)}</span></span>
            <span className="meta-item"><span className="meta-label">更新：</span><span className="meta-value">{dateStr}</span></span>
          </div>
          <div className="list-desc">{b.intro || '暂无简介'}</div>
          <div className="list-actions">
            <a className="btn-sm" href={`/book/${b.id}.html`} {...bookNavProps(navigate, b.id)}>开始阅读</a>
          </div>
        </div>
      </div>
    )
  }

  const renderPager = () => {
    if (total <= size) {
      return (
        <div className="pager">
          <span className="pager-total">共 {total} 部</span>
        </div>
      )
    }
    const start = Math.max(1, page - 4)
    const end = Math.min(totalPages, start + 9)
    const nums: number[] = []
    for (let i = start; i <= end; i++) nums.push(i)
    return (
      <div className="pager">
        <span className="pager-total">共 {total} 部</span>
        {page > 1 ? (
          <a href="javascript:void(0)" className="pager-prev" onClick={(e) => { e.preventDefault(); onPage(page - 1) }}>上一页</a>
        ) : (
          <span className="pager-prev disabled">上一页</span>
        )}
        {start > 1 && <span className="pager-ellipsis">...</span>}
        {nums.map(n => n === page ? (
          <span key={n} className="pager-current">{n}</span>
        ) : (
          <a key={n} href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onPage(n) }}>{n}</a>
        ))}
        {end < totalPages && <span className="pager-ellipsis">...</span>}
        {page < totalPages ? (
          <a href="javascript:void(0)" className="pager-next" onClick={(e) => { e.preventDefault(); onPage(page + 1) }}>下一页</a>
        ) : (
          <span className="pager-next disabled">下一页</span>
        )}
      </div>
    )
  }

  return (
    <>
      {/* ============ 顶部 header ============ */}
      <header className="header">
        <div className="header-inner">
          <h1 className="logo">
            <a href="/" onClick={goHome}>{site.name}</a>
            <small>天人小说 · 在线免费阅读</small>
          </h1>
          <form className="search" onSubmit={goSearch}>
            <input type="text" name="q" placeholder="输入书名 / 作者 / 关键字" autoComplete="off" />
            <button type="submit">搜 索</button>
          </form>
          <div className="header-right">
            <a href="/" onClick={goHome}>首页</a>
            <a href="/sort/" onClick={(e) => goCat(e)}>书库</a>
            <a href="/quanben/" onClick={goFulltext}>完本</a>
            <a href="/history.html" onClick={goHistory}>足迹</a>
          </div>
        </div>
      </header>

      <nav className="nav">
        <div className="nav-inner">
          <a href="/" className="nav-link" onClick={goHome}>首页</a>
          {navCats.map(c => (
            <a key={c.id} href={`/sort/${c.id}/`} className="nav-link" onClick={(e) => goCat(e, c.id)}>{c.name}</a>
          ))}
          <a href="/top/" className="nav-link" onClick={goRanking}>排行榜</a>
          <a href="/quanben/" className="nav-link active" onClick={goFulltext}>完本</a>
        </div>
      </nav>

      {/* ============ 主体 ============ */}
      <div className="wrap">
        <div className="breadcrumb">
          <a href="/" onClick={goHome}>首页</a>
          <span className="breadcrumb-sep">»</span>
          <a href="/quanben/" onClick={goFulltext}>完本</a>
          <span className="breadcrumb-sep">»</span>
          <span>全本完本小说</span>
        </div>

        {/* 筛选条 */}
        <div className="filter-bar">
          <span className="filter-label">排序：</span>
          <a className="filter-tag active" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>最新上传</a>
          <a className="filter-tag" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>字数最多</a>
          <a className="filter-tag" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>人气最高</a>
          <a className="filter-tag" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>最近完结</a>
        </div>

        <main className="main">
          <div className="main-content">
            <section className="section">
              <div className="section-title">
                <h2>全本完本小说</h2>
                <span className="more muted">共 {total} 部</span>
              </div>

              {loading ? (
                <div className="loading">加载中...</div>
              ) : !books.length ? (
                <div className="empty">
                  暂无全本完本小说
                  <br />
                  <a className="empty-action" href="/" onClick={goHome}>返回首页</a>
                </div>
              ) : (
                <div>
                  {books.map(b => renderListItem(b))}
                </div>
              )}

              {renderPager()}
            </section>
          </div>

          <aside className="sidebar">
            <section className="section hot">
              <div className="section-title">
                <h2>全本排行</h2>
              </div>
              <ul className="hot-list">
                {hotTop10.length ? hotTop10.map((b, i) => (
                  <li key={b.id}>
                    <span className="hot-no">{i + 1}</span>
                    <a className="hot-title" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    <span className="hot-author">{b.author}</span>
                  </li>
                )) : (
                  <li style={{ padding: '20px 16px', color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>暂无排行数据</li>
                )}
              </ul>
            </section>

            <section className="section">
              <div className="section-title">
                <h2>全部分类</h2>
              </div>
              <div className="tags">
                {navCats.slice(0, 12).map(c => (
                  <a key={c.id} className="tag" href={`/sort/${c.id}/`} title={c.name} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
                ))}
              </div>
            </section>
          </aside>
        </main>
      </div>

      {/* ============ footer ============ */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-links">
            <a href="/" onClick={goHome}>首页</a>
            <a href="/sort/" onClick={(e) => goCat(e)}>书库</a>
            <a href="/top/" onClick={goRanking}>排行榜</a>
            <a href="/quanben/" onClick={goFulltext}>完本</a>
            <a href="/history.html" onClick={goHistory}>足迹</a>
          </div>
          <div className="footer-copyright">
            {site.footerText || `Copyright © ${site.name} All Rights Reserved · 本站所有小说为转载作品, 版权归原作者所有`}
          </div>
        </div>
      </footer>
    </>
  )
}
