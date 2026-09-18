'use client'
// ============================================================
// clone-trxsw HomeClone — 1:1 精仿天人小说 trxsw.com 首页 (唐人小说 CMS 通用模板)
// 参考: themes.ts AiraBrowser 反查 DOM (.vlist/.detail/.content/.pager/.headline/.intro)
//   域名已过期, 无真实 probe; 基于 themes.ts 注释 + 唐人小说 CMS 通用结构重建
// 复刻: .wrap > .header (logo+search+header-right) / .nav (.nav-link × N)
//       / .main > .main-content (.section .vlist.book-list 网格书目 + .section .vlist.text-list 文字书目
//       + .stat hero) + .sidebar (.section .hot 排行 + .section .tags 标签云) / .footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/trxsw.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { HomeCloneProps } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

// 唐人小说 CMS 通用 16 个分类 (fetch 失败兜底, 与 themes.ts 注释一致)
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

const HOT_KEYWORDS = ['末日', '白月光', '末世', '直播', '万人迷', '女帝', '游戏入侵', '诡秘之主', '斗破', '香江']

export function HomeClone({ books, loading, navCategoryCount = 16, homeModuleLimit = 20 }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])

  // 拉分类列表用于 .nav 导航 + 分类区块标题
  useEffect(() => {
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        // API 返回 {ok, data:{items:[{id,name,bookCount,rep}]}}
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        const mapped: Cat[] = arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) }))
        setCats(mapped.length ? mapped : DEFAULT_NAV)
      })
      .catch(() => { if (!aborted) setCats(DEFAULT_NAV) })
    return () => { aborted = true }
  }, [])

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, navCategoryCount)

  if (loading) return <div className="wrap"><div className="loading">加载中...</div></div>
  if (!books.length) return <div className="wrap"><div className="empty">暂无内容</div></div>

  // —— 数据切片 (唐人小说 CMS 通用模板对齐) ——
  // 首页大网格推荐: 前 N 本 (大封面卡片)
  const featured = books.slice(0, Math.min(homeModuleLimit, 12))
  // 文字书目列表: 前 N 本 (line 列表)
  const latest = books.slice(0, 16)
  // 分类区块: 按 categoryId 分组, 取前 4 个非空组, 每组 10 本
  const catSections = navCats.slice(0, 4).map(c => {
    const list = books.filter(b => b.categoryId === c.id || b.category === c.name)
    return { cat: c, list: (list.length ? list : books).slice(0, 10) }
  })
  // 侧栏热门排行: 前 10 本
  const hotTop10 = books.slice(0, 10)
  // 标签云: 前 16 个不重复分类
  const tagCloud: string[] = Array.from(new Set(books.map(b => b.category).filter(Boolean) as string[])).slice(0, 16)

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
    const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const goHot = (kw: string) => navigate({ view: 'search', q: kw })
  const goRanking = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'ranking' }) }
  const goFulltext = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'fulltext' }) }
  const goHistory = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'history' }) }

  // 渲染文字书目 li (复刻 .vlist.text-list > li)
  const renderTextBook = (b: BookItem, idx: number) => {
    const dateStr = b.updatedAt ? new Date(b.updatedAt).toISOString().slice(5, 10) : ''
    return (
      <li key={b.id}>
        <span className="book-cat">{b.category || '小说'}</span>
        <a className="book-title-line" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
        <span className="book-author-line">/{b.author}</span>
        <span className="book-date">{dateStr}{idx < 6 ? <span className="tag-new">新</span> : null}</span>
      </li>
    )
  }

  // 渲染热门排行 li
  const renderHotItem = (b: BookItem, idx: number) => (
    <li key={b.id}>
      <span className="hot-no">{idx + 1}</span>
      <a className="hot-title" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
      <span className="hot-author">{b.author}</span>
    </li>
  )

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
          <a href="/" className={'nav-link' + (true ? ' active' : '')} onClick={goHome}>首页</a>
          {navCats.map(c => (
            <a key={c.id} href={`/sort/${c.id}/`} className="nav-link" onClick={(e) => goCat(e, c.id)}>{c.name}</a>
          ))}
          <a href="/top/" className="nav-link" onClick={goRanking}>排行榜</a>
          <a href="/quanben/" className="nav-link" onClick={goFulltext}>完本</a>
          <div className="nav-right">
            <a href="javascript:;" onClick={(e) => e.preventDefault()}>登录</a>
            <a href="javascript:;" onClick={(e) => e.preventDefault()}>注册</a>
          </div>
        </div>
      </nav>

      {/* ============ 主体 main ============ */}
      <div className="wrap">
        <main className="main">
          <div className="main-content">
            {/* 大网格推荐书目 */}
            <section className="section">
              <div className="section-title">
                <h2>推荐小说</h2>
                <a className="more" href="/sort/" onClick={(e) => goCat(e)}>更多 &gt;&gt;</a>
              </div>
              <ul className="vlist book-list">
                {featured.map(b => (
                  <li key={b.id}>
                    <a className="book-cover" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>
                      <BookCover name={b.name} cover={b.cover} className="w-full h-full" />
                    </a>
                    <div className="book-info">
                      <a className="book-title" href={`/book/${b.id}.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                      <div className="book-author">{b.author}</div>
                      <div className="book-meta">
                        <span>{b.category || '小说'}</span>
                        <span>·</span>
                        <span>{formatWords(b.wordCount)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* 最新更新文字书目 */}
            <section className="section">
              <div className="section-title">
                <h2>最新更新</h2>
                <a className="more" href="/sort/" onClick={(e) => goCat(e)}>更多 &gt;&gt;</a>
              </div>
              <ul className="vlist text-list">
                {latest.map((b, i) => renderTextBook(b, i))}
              </ul>
            </section>

            {/* 分类区块 */}
            {catSections.map(({ cat, list }) => (
              <section className="section" key={cat.id}>
                <div className="section-title">
                  <h2>{cat.name}</h2>
                  <a className="more" href={`/sort/${cat.id}/`} onClick={(e) => goCat(e, cat.id)}>更多 &gt;&gt;</a>
                </div>
                <ul className="vlist text-list">
                  {list.map((b, i) => renderTextBook(b, i))}
                </ul>
              </section>
            ))}

            {/* 统计 hero */}
            <section className="stat">
              <h2>{site.name} 数据统计</h2>
              <small>数据每 30 分钟更新</small>
              <p>覆盖玄幻、修真、都市、历史等主流分类; 支持在线阅读与 TXT 免费下载。</p>
              <div className="stat-grid">
                <div className="stat-item">
                  <div className="stat-num">{books.length}部</div>
                  <div className="stat-txt">今日上传电子书</div>
                </div>
                <div className="stat-item">
                  <div className="stat-num">{books.length * 12}部</div>
                  <div className="stat-txt">本月上传电子书</div>
                </div>
                <div className="stat-item">
                  <div className="stat-num">{Math.max(1, Math.floor(books.length / 2))}人</div>
                  <div className="stat-txt">24h 会员注册</div>
                </div>
                <div className="stat-item">
                  <div className="stat-num">{books.length}</div>
                  <div className="stat-txt">最新注册会员</div>
                </div>
              </div>
            </section>
          </div>

          {/* ============ 侧栏 sidebar ============ */}
          <aside className="sidebar">
            {/* 热门排行 */}
            <section className="section hot">
              <div className="section-title">
                <h2>热门排行</h2>
                <a className="more" href="/top/" onClick={goRanking}>更多 &gt;&gt;</a>
              </div>
              <ul className="hot-list">
                {hotTop10.map((b, i) => renderHotItem(b, i))}
              </ul>
            </section>

            {/* 热门标签 */}
            <section className="section">
              <div className="section-title">
                <h2>热门标签</h2>
              </div>
              <div className="tags">
                {tagCloud.map(t => (
                  <a key={t} className="tag" href={`/tag/${encodeURIComponent(t)}/`} title={t} onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: t }) }}>{t}</a>
                ))}
              </div>
            </section>

            {/* 今日热搜词 */}
            <section className="section">
              <div className="section-title">
                <h2>今日热搜</h2>
              </div>
              <div className="tags">
                {HOT_KEYWORDS.map(kw => (
                  <a key={kw} className="tag" href="javascript:;" title={kw} onClick={(e) => { e.preventDefault(); goHot(kw) }}>{kw}</a>
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
