'use client'
// ============================================================
// clone-trxsw BookInfo — 1:1 精仿天人小说 trxsw.com 书籍详情页
// 参考: themes.ts AiraBrowser 反查 DOM:
//   bookTitleSelector: '.detail .name strong'  // 书名
//   authorSelector: '.detail .author a'         // 作者
//   coverSelector: '.detail > img'              // 封面
//   synopsisSelector: '.intro'                  // 简介
//   chapterLinkSelector: '.vlist > li:not(.now) > a, .read > li > a'  // 目录章节链
// 复刻: .wrap > .header / .nav / .breadcrumb / .detail (封面 + .name strong +
//   .author a + .detail-meta + .detail-actions) / .intro (简介, 可展开/收起) /
//   .detail-tags 标签 / .section .chapter-list (章节目录) / .sidebar (.hot 同类 + .tags)
// CSS 由 CloneCSSLoader 加载 public/clone-css/trxsw.css
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { statusLabel, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared'
import { cloneNavHandlers, useCloneCategories } from '../shared'
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

export function BookInfo({ book, onScrollToc, onContinueRead, onGoCategory, initialCategories }: BookInfoProps) {
  const { site, navigate } = usePublic()
  // R28-1A: 复用 useCloneCategories (SSR initialCategories 优先 + 空时 fetch + DEFAULT_NAV 兜底)
  const cats = useCloneCategories(initialCategories, DEFAULT_NAV)
  const [related, setRelated] = useState<BookItem[]>([])
  const [introExpanded, setIntroExpanded] = useState(false)

  // 拉分类列表用于 .nav 导航

  // 拉"猜您喜欢": 同分类前 8 本 (排除当前书)
  useEffect(() => {
    if (!book?.id) return
    let aborted = false
    const cat = book.categoryId || ''
    const sp = new URLSearchParams({ size: '8', sort: 'hot' })
    if (cat) sp.set('cat', cat)
    if (site?.id) sp.set('site', site.id)
    fetch(`/api/public/books?${sp.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const list: BookItem[] = (d?.data?.books || d?.books || []).filter((b: BookItem) => b.id !== book.id).slice(0, 8)
        setRelated(list)
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [book?.id, book?.categoryId, site?.id])

  if (!book) return null

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 12)
  // 侧栏同类热门: 前 10 本
  const hotTop10 = related.slice(0, 10)
  // 标签拆分
  const tagList: string[] = (book.keywords || '').split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 10)
  // fallback: 用分类名 + 书名首字组合作标签
  if (!tagList.length && book.category) tagList.push(book.category)

  const fmtDateShort = (d?: string | null) => d ? new Date(d).toISOString().slice(0, 10) : ''

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    if (onGoCategory && catId) onGoCategory(catId)
    else navigate({ view: 'category', cat: catId })
  }
  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'q')
  const goRanking = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'ranking' }) }
  const goFulltext = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'fulltext' }) }
  const goHistory = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'history' }) }

  // 章节目录 (book.toc 字段不存在于 BookDetail, 由父视图通过 onScrollToc 触发显示)
  // 此处仅渲染 "开始阅读" + "查看目录" 按钮 + 同类推荐

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

      {/* ============ 导航 nav ============ */}
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
        {/* 面包屑 */}
        <div className="breadcrumb">
          <a href="/" onClick={goHome}>首页</a>
          <span className="breadcrumb-sep">»</span>
          <a href={`/sort/${book.categoryId || ''}/`} onClick={(e) => goCat(e, book.categoryId || undefined)}>{book.category || '小说'}</a>
          <span className="breadcrumb-sep">»</span>
          <span>{book.name}</span>
        </div>

        <main className="main">
          <div className="main-content">
            {/* 书籍详情 .detail */}
            <div className="detail">
              <div className="detail-cover">
                <BookCover name={book.name} cover={book.cover} className="w-full h-full" />
              </div>
              <div className="detail-info">
                <h1 className="detail-name"><strong>{book.name}</strong></h1>
                <div className="detail-author">
                  作者：<a href="javascript:;" title={book.author} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }}>{book.author}</a>
                </div>
                <div className="detail-meta">
                  <span className="meta-item"><span className="meta-label">分类：</span><span className="meta-value">{book.category || '小说'}</span></span>
                  <span className="meta-item"><span className="meta-label">状态：</span><span className="meta-value">{statusLabel(book.status)}</span></span>
                  <span className="meta-item"><span className="meta-label">字数：</span><span className="meta-value">{formatWords(book.wordCount)}</span></span>
                  <span className="meta-item"><span className="meta-label">更新：</span><span className="meta-value">{fmtDateShort(book.updatedAt)}</span></span>
                </div>
                <div className="detail-actions">
                  <a
                    className="btn btn-primary"
                    href={`javascript:void(0)`}
                    title={`开始阅读 ${book.name}`}
                    onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}
                  >开始阅读</a>
                  <a
                    className="btn btn-outline"
                    href="javascript:void(0)"
                    title="查看目录"
                    onClick={(e) => { e.preventDefault(); onScrollToc() }}
                  >章节目录</a>
                  <a
                    className="btn"
                    href="javascript:void(0)"
                    title="收藏本书"
                    onClick={(e) => e.preventDefault()}
                  >加入书架</a>
                </div>
                {/* 标签 */}
                <div className="detail-tags">
                  {tagList.map(t => (
                    <a key={t} className="tag" href={`/tag/${encodeURIComponent(t)}/`} title={t} onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: t }) }}>{t}</a>
                  ))}
                </div>
              </div>
            </div>

            {/* 内容简介 .intro */}
            <div className="intro">
              <div className="intro-title">内容简介</div>
              <div className="intro-content" style={{ maxHeight: introExpanded ? 'none' : '120px', overflow: 'hidden' }}>
                {book.intro || '暂无简介'}
              </div>
              <a
                className="intro-toggle"
                href="javascript:void(0)"
                onClick={(e) => { e.preventDefault(); setIntroExpanded(v => !v) }}
              >{introExpanded ? '收起 ▲' : '展开全文 ▼'}</a>
            </div>

            {/* 最新章节预告 (利用 book.latestChapter) */}
            <section className="section">
              <div className="section-title">
                <h2>最新章节</h2>
                <a className="more" href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onScrollToc() }}>完整目录 &gt;&gt;</a>
              </div>
              <ul className="vlist">
                <li className="now">
                  <span className="chapter-no">·</span>
                  <a href="javascript:void(0)" title={book.latestChapter || '最新章节'} onClick={(e) => { e.preventDefault(); onScrollToc() }}>{book.latestChapter || '最新章节'}</a>
                  <span className="chapter-meta">{fmtDateShort(book.updatedAt)}</span>
                </li>
              </ul>
            </section>
          </div>

          {/* ============ 侧栏 ============ */}
          <aside className="sidebar">
            {/* 同类热门 */}
            <section className="section hot">
              <div className="section-title">
                <h2>{book.category || '小说'} 排行</h2>
                <a className="more" href={`/sort/${book.categoryId || ''}/`} onClick={(e) => goCat(e, book.categoryId || undefined)}>更多 &gt;&gt;</a>
              </div>
              <ul className="hot-list">
                {hotTop10.length ? (
                  hotTop10.map((b, i) => (
                    <li key={b.id}>
                      <span className="hot-no">{i + 1}</span>
                      <a className="hot-title" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                      <span className="hot-author">{b.author}</span>
                    </li>
                  ))
                ) : (
                  <li style={{ padding: '20px 16px', color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>暂无推荐</li>
                )}
              </ul>
            </section>

            {/* 相关标签 */}
            {tagList.length > 0 && (
              <section className="section">
                <div className="section-title">
                  <h2>相关标签</h2>
                </div>
                <div className="tags">
                  {tagList.map(t => (
                    <a key={t} className="tag" href={`/tag/${encodeURIComponent(t)}/`} title={t} onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: t }) }}>{t}</a>
                  ))}
                </div>
              </section>
            )}

            {/* 友情链接 */}
            <div className="link-box">
              <span className="link-title">友情链接</span>
              <span className="link-list">
                <a href="javascript:;" onClick={(e) => e.preventDefault()}>{site.name}</a>
                <a href="javascript:;" onClick={(e) => e.preventDefault()}>{site.name}镜像</a>
                <a href="javascript:;" onClick={(e) => e.preventDefault()}>永久地址</a>
              </span>
            </div>
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
