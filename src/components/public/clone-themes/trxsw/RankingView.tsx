'use client'
// ============================================================
// clone-trxsw RankingView — 1:1 精仿天人小说 trxsw.com 排行榜页
// 参考: themes.ts AiraBrowser 反查 DOM (.vlist 章节列表 + .pager 翻页)
//   唐人小说 CMS 通用排行榜页: .breadcrumb + .tabs (5 tab 切换排序) +
//   .rank-list (整页大列表: 排名 + 封面 + 信息 + 简介) + .pager 分页 +
//   侧栏 .hot (本周热门 10 本) + .tags (相关分类)
// CSS 由 CloneCSSLoader 加载 public/clone-css/trxsw.css
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { statusLabel, formatWords } from '../../seo'
import type { RankingViewProps } from '../shared'
import { cloneNavHandlers, useCloneCategories } from '../shared'
import type { BookItem } from '../../types'

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

// 排行榜 tab 定义 (与 themes.ts 注释 + 唐人小说 CMS 通用排行一致)
const RANK_TABS = [
  { id: 'allvisit', name: '总点击' },
  { id: 'monthvisit', name: '月点击' },
  { id: 'weekvisit', name: '周点击' },
  { id: 'dayvisit', name: '日点击' },
  { id: 'allvote', name: '总推荐' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
] as const

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage, initialCategories }: RankingViewProps) {
  const { site, navigate } = usePublic()
  // R28-1A: 复用 useCloneCategories (SSR initialCategories 优先 + 空时 fetch + DEFAULT_NAV 兜底)
  const cats = useCloneCategories(initialCategories, DEFAULT_NAV)

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 12)
  const totalPages = Math.max(1, Math.ceil(total / size))
  // 侧栏本周热门: 前 10 本 (与主排行不重复)
  const weekTop10 = books.slice(0, 10)

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'q')
  const goRanking = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'ranking' }) }
  const goFulltext = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'fulltext' }) }
  const goHistory = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'history' }) }

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

  // 渲染 rank-list li (整页大列表, 含排名 + 封面 + 信息)
  const renderRankItem = (b: BookItem, idx: number) => {
    const dateStr = b.updatedAt ? new Date(b.updatedAt).toISOString().slice(0, 10) : ''
    return (
      <li key={b.id}>
        <span className="rank-no">{(page - 1) * size + idx + 1}</span>
        <a className="rank-cover" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>
          <BookCover name={b.name} cover={b.cover} className="w-full h-full" />
        </a>
        <div className="rank-info">
          <a className="rank-title" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
          <div className="rank-author">作者：<a href="javascript:;" title={b.author} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: b.author }) }}>{b.author}</a></div>
          <div className="rank-meta">
            <span>分类：{b.category || '小说'}</span>
            <span>状态：{statusLabel(b.status)}</span>
            <span>字数：{formatWords(b.wordCount)}</span>
            <span>更新：{dateStr}</span>
          </div>
          <div className="rank-desc">{b.intro || '暂无简介'}</div>
        </div>
      </li>
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
          <a href="/top/" className="nav-link active" onClick={goRanking}>排行榜</a>
          <a href="/quanben/" className="nav-link" onClick={goFulltext}>完本</a>
        </div>
      </nav>

      {/* ============ 主体 ============ */}
      <div className="wrap">
        <div className="breadcrumb">
          <a href="/" onClick={goHome}>首页</a>
          <span className="breadcrumb-sep">»</span>
          <span>排行榜</span>
        </div>

        {/* 排行榜 tab */}
        <div className="tabs">
          {RANK_TABS.map(t => (
            <a
              key={t.id}
              href="javascript:void(0)"
              className={'tab' + (tab === t.id ? ' active' : '')}
              onClick={(e) => { e.preventDefault(); onTabChange(t.id) }}
            >{t.name}</a>
          ))}
        </div>

        <main className="main">
          <div className="main-content">
            <section className="section">
              <div className="section-title">
                <h2>{RANK_TABS.find(t => t.id === tab)?.name || '排行榜'}</h2>
                <span className="more muted">共 {total} 部</span>
              </div>

              {loading ? (
                <div className="loading">加载中...</div>
              ) : !books.length ? (
                <div className="empty">
                  暂无排行数据
                  <br />
                  <a className="empty-action" href="/" onClick={goHome}>返回首页</a>
                </div>
              ) : (
                <ul className="rank-list">
                  {books.map((b, i) => renderRankItem(b, i))}
                </ul>
              )}

              {renderPager()}
            </section>
          </div>

          <aside className="sidebar">
            <section className="section hot">
              <div className="section-title">
                <h2>本周热门</h2>
              </div>
              <ul className="hot-list">
                {weekTop10.length ? weekTop10.map((b, i) => (
                  <li key={b.id}>
                    <span className="hot-no">{i + 1}</span>
                    <a className="hot-title" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    <span className="hot-author">{b.author}</span>
                  </li>
                )) : (
                  <li style={{ padding: '20px 16px', color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>暂无数据</li>
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
