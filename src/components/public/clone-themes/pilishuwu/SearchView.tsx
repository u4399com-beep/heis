'use client'
// ============================================================
// clone-pilishuwu SearchView — 搜索结果页
// 参考: probe-pilishuwu-book.html 的 ret-search-list 结构 (源站列表页样式)
//       + 源站搜索模块 /module/search/search.php 表单 action
// 复刻: .mod-top-wr header (搜索框预填 q) / .mod-top-nav-wr nav /
//       .ui-wm .ret-main-wr .ret-main (.ret-search-head.clearfix
//       .ret-result-num em "搜索 X 结果") + .ret-search-result
//       ul.ret-search-list li.ret-search-item (.ret-works-cover +
//       .ret-works-info h3 + p.ret-works-author + p.ret-works-tags +
//       p.ret-works-decs + a.ret-works-view.ui-btn-pink)
// CSS 由 CloneCSSLoader 加载 public/clone-css/pilishuwu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { statusLabel, formatWords } from '../../seo'
import type { SearchViewProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: '0', name: '全部小说' }, { id: '1', name: '男频小说' },
  { id: '2', name: '女频小说' }, { id: '3', name: '电子图书' },
  { id: '4', name: '无CP小说' }, { id: '5', name: '纯爱小说' },
  { id: '6', name: '百合小说' }, { id: '8', name: '轻小说' },
]

export function SearchView({ q, books, loading, initialCategories }: SearchViewProps) {
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

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 8)

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
    const v = (e.currentTarget.elements.namedItem('key') as HTMLInputElement)?.value?.trim()
    if (v) navigate({ view: 'search', q: v })
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

  return (
    <>
      {/* ============ 顶部 header (搜索框预填 q) ============ */}
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
                    <input className="mod-search-input" type="text" name="key" placeholder="可搜索小说名/作者名" defaultValue={q || ''} autoComplete="off" />
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
              <li><a href="/top/index.html" title="排行榜" onClick={goRanking}><span>排行榜</span></a></li>
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

      {/* ============ 搜索结果主体 (ret-main-wr) ============ */}
      <div className="ui-wm ui-mb20 ui-mt40 clearfix">
        <div className="ret-main-wr ui-mb40 ui-left" style={{ width: '100%' }}>
          <div className="ret-main">
            {/* 顶部标题 + 结果数 */}
            <div className="ret-search-head clearfix">
              <h1 className="ui-left" style={{ fontSize: 22, fontWeight: 'bold', color: '#333', padding: '8px 0', marginRight: 20 }}>
                搜索: <span style={{ color: '#fd8929' }}>{q || ''}</span>
              </h1>
              <span className="ret-result-num ui-right" style={{ marginTop: 14 }}>
                共<em>{books.length}</em>个结果
              </span>
            </div>

            {/* 搜索结果列表 */}
            <div className="ret-search-result">
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>搜索中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                  未找到与 "<strong style={{ color: '#fd8929' }}>{q}</strong>" 相关的书籍
                  <br />
                  <a
                    href="javascript:void(0)"
                    onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}
                    style={{ display: 'inline-block', marginTop: 16, padding: '6px 16px', background: '#fd8929', color: '#fff', textDecoration: 'none' }}
                  >返回首页</a>
                </div>
              ) : (
                <ul className="ret-search-list clearfix">
                  {books.map(b => (
                    <li className="ret-search-item clearfix" key={b.id}>
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
