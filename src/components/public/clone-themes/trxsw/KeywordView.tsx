'use client'
// ============================================================
// clone-trxsw KeywordView — 1:1 精仿天人小说 trxsw.com 关键词/标签落地页
// 参考: themes.ts AiraBrowser 反查 DOM (.vlist 章节列表 + .pager 翻页)
//   唐人小说 CMS 通用标签落地页: .header (搜索框预填 tag) / .nav / .breadcrumb /
//   .filter-bar (排序筛选) + .list-item (横向 list 列表) + .empty (空态友好) +
//   侧栏 .hot (热门标签小说) + .tags (相关标签云, 从 books 拆分)
// CSS 由 CloneCSSLoader 加载 public/clone-css/trxsw.css
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { statusLabel, formatWords } from '../../seo'
import type { KeywordViewProps } from '../shared'
import { cloneNavHandlers } from '../shared'
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

export function KeywordView({ tag, books, loading, initialCategories }: KeywordViewProps) {
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
  const hotTop10 = books.slice(0, 10)
  // 从 books.category 拆分相关分类 (前 16 个不重复, 排除当前 tag)
  const relatedTags: string[] = Array.from(new Set(
    books.map(b => b.category).filter(Boolean) as string[]
  )).filter(t => t !== tag).slice(0, 16)

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'q')
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

  return (
    <>
      {/* ============ 顶部 header (搜索框预填 tag) ============ */}
      <header className="header">
        <div className="header-inner">
          <h1 className="logo">
            <a href="/" onClick={goHome}>{site.name}</a>
            <small>天人小说 · 在线免费阅读</small>
          </h1>
          <form className="search" onSubmit={goSearch}>
            <input type="text" name="q" placeholder="输入书名 / 作者 / 关键字" defaultValue={tag || ''} autoComplete="off" />
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
          <a href="/quanben/" className="nav-link" onClick={goFulltext}>完本</a>
        </div>
      </nav>

      {/* ============ 主体 ============ */}
      <div className="wrap">
        <div className="breadcrumb">
          <a href="/" onClick={goHome}>首页</a>
          <span className="breadcrumb-sep">»</span>
          <span>标签：{tag}</span>
        </div>

        {/* 排序筛选 */}
        <div className="filter-bar">
          <span className="filter-label">排序：</span>
          <a className="filter-tag active" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>综合</a>
          <a className="filter-tag" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>最新上传</a>
          <a className="filter-tag" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>人气最高</a>
          <a className="filter-tag" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>字数最多</a>
        </div>

        <main className="main">
          <div className="main-content">
            <section className="section">
              <div className="section-title">
                <h2>「{tag}」相关小说</h2>
                <span className="more muted">共 {books.length} 部</span>
              </div>

              {loading ? (
                <div className="loading">加载中...</div>
              ) : !books.length ? (
                <div className="empty">
                  未找到与「<strong style={{ color: 'var(--primary)' }}>{tag}</strong>」相关的小说
                  <br />
                  换个关键词试试吧。
                  <br />
                  <a className="empty-action" href="/" onClick={goHome}>返回首页</a>
                </div>
              ) : (
                <div>
                  {books.map(b => renderListItem(b))}
                </div>
              )}
            </section>
          </div>

          <aside className="sidebar">
            <section className="section hot">
              <div className="section-title">
                <h2>{tag} 热门</h2>
              </div>
              <ul className="hot-list">
                {hotTop10.length ? hotTop10.map((b, i) => (
                  <li key={b.id}>
                    <span className="hot-no">{i + 1}</span>
                    <a className="hot-title" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    <span className="hot-author">{b.author}</span>
                  </li>
                )) : (
                  <li style={{ padding: '20px 16px', color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>暂无热门数据</li>
                )}
              </ul>
            </section>

            {/* 相关标签云 (从 books 拆分) */}
            {relatedTags.length > 0 && (
              <section className="section">
                <div className="section-title">
                  <h2>相关标签</h2>
                </div>
                <div className="tags">
                  {relatedTags.map(t => (
                    <a key={t} className="tag" href={`/tag/${encodeURIComponent(t)}/`} title={t} onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: t }) }}>{t}</a>
                  ))}
                </div>
              </section>
            )}

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
