'use client'
// ============================================================
// clone-pilishuwu CategoryList — 1:1 精仿 pilishuwu.com 霹雳书屋分类列表页
// 参考: agent-ctx/probe-html2/probe-pilishuwu-book.html (源站真实 DOM, 1160 行)
// 复刻: .mod-top-wr header / .mod-top-nav-wr nav / .ui-wm 主体:
//       .ret-side-wr.ui-left .category-left-rank (h3.rank-side-title +
//       ol.custom-rank-list li.rank-item span.rank-num + a.rank-img img +
//       .rank-info p.rank-t a + p.rank-a + p.rank-s) + .ret-main-wr.ui-left
//       .ret-main (.ret-search-head.clearfix ul#search-condition.ret-search-type
//       li a.ret-search-time + .ret-head-page #pagination1 a.mod_page_next +
//       a.current + .ret-result-num em) + .ret-search-result ul.ret-search-list
//       li.ret-search-item (.ret-works-cover a.mod-cover-list-thumb img +
//       p.mod-cover-list-updata a.mod-cover-list-mask + .ret-works-info h3 +
//       p.ret-works-author + p.ret-works-tags + p.ret-works-decs +
//       a.ret-works-view.ui-btn-pink) + .ret-page-wr.mod-page #pagination2
// CSS 由 CloneCSSLoader 加载 public/clone-css/pilishuwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { statusLabel, formatWords } from '../../seo'
import type { CategoryListProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: '0', name: '全部小说' }, { id: '1', name: '男频小说' },
  { id: '2', name: '女频小说' }, { id: '3', name: '电子图书' },
  { id: '4', name: '无CP小说' }, { id: '5', name: '纯爱小说' },
  { id: '6', name: '百合小说' }, { id: '8', name: '轻小说' },
]

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])

  // 拉分类列表用于 mod-top-nav-list (active 状态匹配当前 cat)
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

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 8)
  const totalPages = Math.max(1, Math.ceil(total / size))
  // 左侧月点击排行: 前 10 本 (第 1 名带 rank-img + rank-s 简介, 2-10 名只显示文字)
  const rankTop10 = books.slice(0, 10)

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
    const q = (e.currentTarget.elements.namedItem('key') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const goRanking = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'ranking' })
  }
  const goFulltext = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'fulltext' })
  }
  const goHistory = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'history' })
  }

  // 分页区间: 上一页 / 1..N / 下一页 / 尾页
  const renderPager = (id: string) => {
    if (total <= size) return null
    const start = Math.max(1, page - 4)
    const end = Math.min(totalPages, start + 9)
    const nums: number[] = []
    for (let i = start; i <= end; i++) nums.push(i)
    return (
      <div className={id === 'pagination1' ? 'ret-head-page ui-right' : 'ret-page-wr mod-page'} id={id}>
        {page > 1 ? (
          <a href="javascript:void(0)" className="mod_page_next" onClick={(e) => { e.preventDefault(); onPage(page - 1) }}>上一页</a>
        ) : (
          <a href="javascript:alert('已经是第一页了');" className="mod_page_next" onClick={(e) => e.preventDefault()}>第一页</a>
        )}
        {nums.map(n => n === page ? (
          <a key={n} href="javascript:void(0)" className="current">{n}</a>
        ) : (
          <a key={n} href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onPage(n) }}>{n}</a>
        ))}
        {page < totalPages ? (
          <a href="javascript:void(0)" className="mod_page_next" onClick={(e) => { e.preventDefault(); onPage(page + 1) }}>下一页</a>
        ) : (
          <a href="javascript:alert('已经是最后一页了');" className="mod_page_next" onClick={(e) => e.preventDefault()}>最后页</a>
        )}
      </div>
    )
  }

  return (
    <>
      {/* ============ 顶部 header (mod-top-wr) ============ */}
      <div className="mod-top-wr">
        <div className="mod-top-frame">
          <div className="mod-top-tool-wr ui-wm">
            <div className="mod-top-logo-wr ui-left">
              <h1 className="mod-top-logo ui-left ui-text-hide">
                <a title={site.name} href="/index.html" onClick={goHome}>
                  <span className="mod-top-logo-text" style={{ display: 'inline-block', fontSize: 22, fontWeight: 'bold', color: '#fd8929', lineHeight: '40px', padding: '0 8px' }}>{site.name}</span>
                  <span className="ico-ani"></span>
                </a>
              </h1>
              <div className="mod-top-event ui-left ui-dn"></div>
            </div>
            <div className="mod-top-search-wr ui-left">
              <form action="/module/search/search.php" method="get" onSubmit={goSearch}>
                <input type="hidden" name="module" value="novel" />
                <input type="hidden" name="type" value="0" />
                <div id="top-search" className="mod-top-search">
                  <div className="mod-search-input-wr ui-left">
                    <input className="mod-search-input" type="text" name="key" placeholder="可搜索小说名/作者名" autoComplete="off" />
                  </div>
                  <button className="mod-search-submit ui-left ui-text-hide" type="submit">搜索</button>
                </div>
              </form>
              <ul className="mod-top-tag" id="hotWord"></ul>
            </div>
          </div>
        </div>

        <div className="mod-top-nav-wr">
          <div className="mod-top-nav ui-wm">
            <ul className="mod-top-nav-list ui-left">
              <li>
                <a className="mod-top-nav-home" href="/index.html" title="首页" onClick={goHome}>
                  <span>首页</span>
                </a>
              </li>
              <li className={label === '全部小说' ? 'active' : ''}>
                <a href="/0/list/1.html" title="全部小说" onClick={(e) => goCat(e, undefined)}><span>全部小说</span></a>
              </li>
              <li><a href="/top/index.html" title="排行榜" onClick={goRanking}><span>排行榜</span></a></li>
              {navCats.map(c => (
                <li key={c.id} className={label === c.name ? 'active' : ''}>
                  <a href={`/${c.id}/list/1.html`} title={c.name} onClick={(e) => goCat(e, c.id)}><span>{c.name}</span></a>
                </li>
              ))}
              <li id="homebox"></li>
            </ul>
            <div className="mod-top-nav-tool ui-right" id="loginbox"></div>
            <a className="mod-top-nav-user ui-right" href="#" onClick={(e) => e.preventDefault()} title="域名发布页">域名发布页</a>
          </div>
        </div>
      </div>

      {/* ============ 主体: 左侧排行 + 右侧列表 ============ */}
      <div className="ui-wm ui-mb20 ui-mt40 clearfix">
        {/* 左侧月点击排行 (category-left-rank) */}
        <div className="ret-side-wr ui-left">
          <div className="category-left-rank">
            <h3 className="rank-side-title">月点击排行</h3>
            <ol className="custom-rank-list">
              {rankTop10.map((b, i) => (
                <li className="rank-item" key={b.id}>
                  <span className="rank-num"></span>
                  {i === 0 && (
                    <a target="_blank" className="rank-img" title={b.name} href={`/${b.categoryId || '0'}/${b.id}/info.html`} {...bookNavProps(navigate, b.id)}>
                      <BookCover name={b.name} cover={b.cover} style={{ width: 85, height: 113 }} />
                    </a>
                  )}
                  <div className="rank-info">
                    <p className="rank-t">
                      <a href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    </p>
                    <p className="rank-a">作者：{b.author}</p>
                    {i === 0 && <p className="rank-s">{b.intro || '暂无简介'}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* 右侧主列表 (ret-main-wr) */}
        <div className="ret-main-wr ui-mb40 ui-left">
          <div className="ret-main">
            {/* 顶部筛选条 + 分页 + 结果数 */}
            <div className="ret-search-head clearfix">
              <ul id="search-condition" className="ret-search-type ui-left">
                <li className="active"><a className="ret-search-time" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>更新</a></li>
                <li><a className="ret-search-time" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>点击</a></li>
                <li><a className="ret-search-time" href="javascript:void(0)" onClick={(e) => e.preventDefault()}>字数</a></li>
              </ul>
              {renderPager('pagination1')}
              <span className="ret-result-num ui-right">共<em>{total}</em>个结果</span>
            </div>

            {/* 搜索结果列表 */}
            <div className="ret-search-result">
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>加载中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>暂无书籍</div>
              ) : (
                <ul className="ret-search-list clearfix">
                  {books.map(b => (
                    <li className="ret-search-item clearfix" key={b.id}>
                      {/* 封面 */}
                      <div className="ret-works-cover">
                        <a className="mod-cover-list-thumb mod-cover-effect ui-db" title={b.name} href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                          <BookCover name={b.name} cover={b.cover} style={{ width: 100, height: 133 }} />
                          <span className="mod-layer-mask">&nbsp;&nbsp;</span>
                        </a>
                        <p className="mod-cover-list-updata">
                          <a className="mod-cover-list-mask" href={`/${b.categoryId || '0'}/${b.id}/read/1.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                            <span className="mod-cover-list-text">{b.latestChapter || '第1章'}</span>
                          </a>
                        </p>
                      </div>
                      {/* 详情 */}
                      <div className="ret-works-info">
                        <h3 className="ret-works-title clearfix">
                          <a href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                        </h3>
                        <p className="ret-works-author" title={b.author}>作者：{b.author}</p>
                        <p className="ret-works-tags">
                          <a href={`/${b.categoryId || '0'}/list/1.html`} target="_blank" onClick={(e) => goCat(e, b.categoryId || undefined)}>分类：{b.category || '小说'}</a>
                          <span>点击：<em>{Math.max(1, Math.floor((b.wordCount || 0) / 1000))}</em></span>
                          <span>字数：<em>{formatWords(b.wordCount)}</em></span>
                          <span>状态：<em>{statusLabel(b.status)}</em></span>
                        </p>
                        <p className="ret-works-decs">{b.intro || '暂无简介'}</p>
                        <a className="ret-works-view ui-btn-pink" href={`/${b.categoryId || '0'}/${b.id}/read/1.html`} target="_blank" {...bookNavProps(navigate, b.id)}>开始阅读</a>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 底部分页 */}
            {renderPager('pagination2')}
          </div>
        </div>
      </div>

      {/* ============ 友情链接 + 悬浮栏 + footer ============ */}
      <div className="linkBox">
        <span className="linkTitle">友情链接</span>
        <p className="linkList">
          <a href="#" onClick={(e) => e.preventDefault()}>永久地址</a>
          <a href="#" onClick={(e) => e.preventDefault()}>{site.name}二站</a>
          <a href="#" onClick={(e) => e.preventDefault()}>{site.name}</a>
        </p>
      </div>

      <div id="fixed" className="mod-fixed-top-wr">
        <div className="mod-fixed-top ui-wm">
          <ul className="mod-fixed-top-tags ui-left">
            <li className="active"><a href="/index.html" onClick={goHome}>首页</a></li>
            {navCats.slice(0, 6).map(c => (
              <li key={c.id}><a href={`/${c.id}/list/1.html`} title={c.name} onClick={(e) => goCat(e, c.id)}>{c.name}</a></li>
            ))}
          </ul>
          <div className="mod-fix-search-wr ui-left">
            <form action="/module/search/search.php" method="post" onSubmit={goSearch}>
              <input type="hidden" name="module" value="novel" />
              <input type="hidden" name="type" value="0" />
              <div>
                <div className="mod-fix-search ui-left">
                  <input className="mod-search-input" type="text" name="key" placeholder="可搜索小说名/作者名/标签" />
                </div>
                <button className="mod-search-submit ui-left" type="submit">搜索</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div className="mod-footer-wr">
        <div className="mod-footer-main-wr">
          <div className="mod-footer-main ui-wm">
            <div className="mod-footer-info">
              {site.footerText || `本站所有小说为完本转载作品，所有内容版权归版权方或原作者所有。`}
              <br />
              <span style={{ display: 'inline-block', marginTop: 8 }}>
                <a href="/index.html" onClick={goHome} style={{ marginRight: 12 }}>首页</a>
                <a href="/0/list/1.html" onClick={(e) => goCat(e, undefined)} style={{ marginRight: 12 }}>全部小说</a>
                <a href="/top/index.html" onClick={goRanking} style={{ marginRight: 12 }}>排行榜</a>
                <a href="/quanben/sort/" onClick={goFulltext} style={{ marginRight: 12 }}>全本小说</a>
                <a href="/history.html" onClick={goHistory}>阅读足迹</a>
              </span>
            </div>
          </div>
        </div>
        <div className="mod-footer-border"></div>
      </div>
    </>
  )
}
