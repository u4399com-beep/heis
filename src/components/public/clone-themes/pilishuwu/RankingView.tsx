'use client'
// ============================================================
// clone-pilishuwu RankingView — 排行榜页
// 参考: probe-pilishuwu.html 中 in-rank-wr 区块结构 (源站排行版块)
// 复刻: .mod-top-wr header / .mod-top-nav-wr nav (排行榜 active) /
//       .ui-wm .in-rank-wr (整页宽度) / .mod-tab-handle (h2 + ul li tabs:
//       月榜/周榜/日榜/总榜/最新入库) / .mod-tab-content-wr > .mod-tab-content >
//       ol.in-rank-list li (sub.in-rank-no-orange/1-3 + sub.in-rank-no-gray/4+ +
//       a.in-rank-name + i.ui-rank-trend-keep) + .ret-page-wr.mod-page 分页
// CSS 由 CloneCSSLoader 加载 public/clone-css/pilishuwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
import type { RankingViewProps } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: '0', name: '全部小说' }, { id: '1', name: '男频小说' },
  { id: '2', name: '女频小说' }, { id: '3', name: '电子图书' },
  { id: '4', name: '无CP小说' }, { id: '5', name: '纯爱小说' },
  { id: '6', name: '百合小说' }, { id: '8', name: '轻小说' },
]

// 排行榜 tab 定义 (与源站月榜/周榜/日榜 + 扩展总榜/最新入库)
const RANK_TABS = [
  { id: 'monthvisit', name: '月榜' },
  { id: 'weekvisit', name: '周榜' },
  { id: 'dayvisit', name: '日榜' },
  { id: 'allvisit', name: '总榜' },
  { id: 'lastupdate', name: '最新入库' },
]

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage }: RankingViewProps) {
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

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 8)
  const totalPages = Math.max(1, Math.ceil(total / size))
  // 排行榜列表: 整页 40 条 (双 ol, 左右各 20)
  const rankLeft = books.slice(0, 20)
  const rankRight = books.slice(20, 40)

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

  // 排行榜 li 渲染 (sub 颜色按名次分: 1-3 橙, 4+ 灰)
  const renderRankLi = (b: BookItem, idx: number) => (
    <li key={b.id}>
      <sub className={idx < 3 ? 'in-rank-no-orange' : 'in-rank-no-gray'}>{idx + 1}</sub>
      <a
        className="in-rank-name"
        href={`/${b.categoryId || '0'}/${b.id}/info.html`}
        title={b.name}
        target="_blank"
        {...bookNavProps(navigate, b.id)}
      >{b.name}</a>
      <i className="ui-rank-trend-keep"></i>
    </li>
  )

  // 分页 (复用 ret-page-wr 风格)
  const renderPager = () => {
    if (total <= size) return null
    const start = Math.max(1, page - 4)
    const end = Math.min(totalPages, start + 9)
    const nums: number[] = []
    for (let i = start; i <= end; i++) nums.push(i)
    return (
      <div className="ret-page-wr mod-page" id="pagination-rank" style={{ textAlign: 'center', marginTop: 16 }}>
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
      {/* ============ 顶部 header ============ */}
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
              <li><a href="/0/list/1.html" title="全部小说" onClick={(e) => goCat(e, undefined)}><span>全部小说</span></a></li>
              <li className="active"><a href="/top/index.html" title="排行榜" onClick={goRanking}><span>排行榜</span></a></li>
              {navCats.map(c => (
                <li key={c.id}><a href={`/${c.id}/list/1.html`} title={c.name} onClick={(e) => goCat(e, c.id)}><span>{c.name}</span></a></li>
              ))}
              <li id="homebox"></li>
            </ul>
            <div className="mod-top-nav-tool ui-right" id="loginbox"></div>
            <a className="mod-top-nav-user ui-right" href="#" onClick={(e) => e.preventDefault()} title="域名发布页">域名发布页</a>
          </div>
        </div>
      </div>

      {/* ============ 排行榜主体 (in-rank-wr 整页宽度) ============ */}
      <div className="ui-wm ui-mb20 ui-mt40 clearfix">
        <div className="in-rank-wr" style={{ width: '100%', float: 'none' }}>
          <div className="mod-tab-handle clearfix">
            <h2>热门排行</h2>
            <ul id="top-rank-handle">
              {RANK_TABS.map(t => (
                <li key={t.id} className={tab === t.id ? 'active' : ''}>
                  <a
                    href="javascript:void(0);"
                    onClick={(e) => { e.preventDefault(); onTabChange(t.id) }}
                  >{t.name}</a>
                </li>
              ))}
            </ul>
          </div>
          <div id="top-rank-panel" className="mod-tab-content-wr">
            <div className="mod-tab-content clearfix">
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>加载中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>暂无排行数据</div>
              ) : (
                <>
                  <ol className="in-rank-list ui-left ui-pr10">
                    {rankLeft.map((b, i) => renderRankLi(b, i))}
                  </ol>
                  <ol className="in-rank-list ui-left">
                    {rankRight.map((b, i) => renderRankLi(b, i + 20))}
                  </ol>
                </>
              )}
            </div>
          </div>
          <div className="in-rank-spacing"></div>
        </div>

        {/* 分页 */}
        {renderPager()}
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
