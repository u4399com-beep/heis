'use client'
// ============================================================
// clone-pilishuwu BookInfo — 1:1 精仿 pilishuwu.com 霹雳书屋书籍详情页
// 参考: agent-ctx/probe-html2/probe-pilishuwu-category.html (源站真实 DOM, 720 行)
// 复刻: .mod-top-wr header / .mod-top-nav-wr nav / .ui-wm 主体 (.ui-left.works-intro-wr
//       .works-intro .works-cover img + .works-intro-status label / .works-intro-detail
//       .works-intro-text h2.works-intro-title + p.works-intro-short / .works-intro-opera
//       .works-intro-tags .tags-show a.works-intro-tags-item / .works-intro-active
//       a.works-intro-view.ui-btn-orange / .works-vote ul.works-vote-list + #novel_data
//       .works-status ul + .ui-right .works-author-wr) + .works-chapter-wr.works-stack
//       ul.words-xone-menu.works-chapter-menu + .ui-right .works-simi-wr (同标签推荐) +
//       .works-more-wr.works-stack #youMayLike ul.mod-cover-list (看过本书的人还看过)
// CSS 由 CloneCSSLoader 加载 public/clone-css/pilishuwu.css, 全部用源站真实 class 名
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
  { id: '0', name: '全部小说' }, { id: '1', name: '男频小说' },
  { id: '2', name: '女频小说' }, { id: '3', name: '电子图书' },
  { id: '4', name: '无CP小说' }, { id: '5', name: '纯爱小说' },
  { id: '6', name: '百合小说' }, { id: '8', name: '轻小说' },
]

export function BookInfo({ book, onScrollToc, onContinueRead, onGoCategory, initialCategories }: BookInfoProps) {
  const { site, navigate } = usePublic()
  // R28-1A: 复用 useCloneCategories (SSR initialCategories 优先 + 空时 fetch + DEFAULT_NAV 兜底)
  const cats = useCloneCategories(initialCategories, DEFAULT_NAV)
  const [related, setRelated] = useState<BookItem[]>([])

  // 拉分类列表用于 mod-top-nav-list

  // 拉"看过本书的人还看过": 同分类前 8 本(排除当前书)
  useEffect(() => {
    if (!book?.id) return
    let aborted = false
    const cat = book.categoryId || ''
    const sp = new URLSearchParams({ size: '8', sort: 'latest' })
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

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 8)
  // 同标签推荐 works-simi-list: 4 本
  const simiBooks = related.slice(0, 4)
  // 看过本书的人还看过 works-more-wr: 8 本
  const youMayLike = related.slice(0, 8)

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    if (onGoCategory && catId) onGoCategory(catId)
    else navigate({ view: 'category', cat: catId })
  }
  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'key')
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

  // 标签拆分 (book.keywords 以逗号或顿号分隔)
  const tagList: string[] = (book.keywords || '').split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 8)
  const fmtDateShort = (d?: string | null) => d ? new Date(d).toISOString().slice(0, 10) : ''

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

      {/* ============ 主体: 作品信息 (works-intro-wr) ============ */}
      <div className="ui-wm ui-mb20 ui-mt40 clearfix">
        <div className="ui-left works-intro-wr">
          <div className="works-intro clearfix">
            {/* 左侧封面 + 完结状态 */}
            <div className="works-cover ui-left">
              <BookCover name={book.name} cover={book.cover} style={{ marginLeft: 20, width: 210, height: 280 }} />
              <div className="works-cover-shadow"></div>
              <label className="works-intro-status">{statusLabel(book.status)}</label>
            </div>

            {/* 右侧详情 */}
            <div className="works-intro-detail ui-left">
              <div className="works-intro-text">
                <div className="works-intro-head clearfix">
                  <h2 className="works-intro-title ui-left"><strong>{book.name}</strong>（作者：{book.author}）</h2>
                </div>
                <p className="works-intro-short ui-text-gray9">{book.intro || '暂无简介'}</p>
              </div>
              <div className="works-intro-opera">
                <div className="ui-left">
                  {/* 标签 */}
                  <p className="works-intro-tags">
                    <span className="ui-left">标签：</span>
                    <span id="tags-show" className="tags-show">
                      {tagList.length ? tagList.map(t => (
                        <a key={t} href={`/search/3/${encodeURIComponent(t)}/1.html`} className="works-intro-tags-item" onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: t }) }}>{t}</a>
                      )) : <a className="works-intro-tags-item" href={`/${book.categoryId || '0'}/list/1.html`} onClick={(e) => goCat(e, book.categoryId || undefined)}>{book.category || '小说'}</a>}
                    </span>
                  </p>
                  {/* 操作按钮 */}
                  <div className="works-intro-active clearfix">
                    <a
                      className="works-intro-view ui-btn-orange ui-radius3"
                      title={`开始阅读${book.name}`}
                      href={`/${book.categoryId || '0'}/${book.id}/read/1.html`}
                      onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}
                    >开始阅读</a>
                    <a
                      className="works-intro-view ui-btn-orange ui-radius3"
                      title={`${book.name}目录`}
                      href={`/${book.categoryId || '0'}/${book.id}/menu/1.html`}
                      onClick={(e) => { e.preventDefault(); onScrollToc() }}
                      style={{ marginLeft: 10 }}
                    >章节目录</a>
                  </div>
                </div>
                <div className="ui-right">
                  <p className="clearfix">
                    <a className="works-report ui-right" style={{ color: '#FF0000' }} href="javascript:void(0)" title="留言反馈" onClick={(e) => e.preventDefault()}>留言反馈</a>
                  </p>
                </div>
              </div>
            </div>

            {/* 投票 + 统计 (works-vote) */}
            <div className="works-vote clearfix">
              <ul className="works-vote-list ui-left clearfix">
                <li>
                  <strong>{Math.max(1, Math.floor((book.wordCount || 0) / 10000))}</strong>
                  <a className="works-vote-red works-vote-btn" href="javascript:void(0)" title="鲜花" onClick={(e) => e.preventDefault()}>鲜花</a>
                  <p>鲜花</p>
                </li>
                <li>
                  <strong>0</strong>
                  <a className="works-vote-black works-vote-btn" href="javascript:void(0)" title="鸡蛋" onClick={(e) => e.preventDefault()}>鸡蛋</a>
                  <p>鸡蛋</p>
                </li>
                <li>
                  <span className="border-right"></span>
                </li>
              </ul>
              <div id="novel_data" className="works-status ui-left">
                <ul>
                  <li>总点击:{Math.max(1, Math.floor((book.wordCount || 0) / 1000))}</li>
                  <li>日点击:{Math.max(1, Math.floor((book.wordCount || 0) / 10000))}</li>
                  <li>周点击:{Math.max(1, Math.floor((book.wordCount || 0) / 8000))}</li>
                  <li>月点击:{Math.max(1, Math.floor((book.wordCount || 0) / 5000))}</li>
                </ul>
                <ul className="clear">
                  <li>总收藏:0</li>
                  <li>日收藏:0</li>
                  <li>周收藏:0</li>
                  <li>月收藏:0</li>
                </ul>
                <ul className="clear">
                  <li>总推荐:0</li>
                  <li>日推荐:0</li>
                  <li>周推荐:0</li>
                  <li>月推荐:0</li>
                </ul>
                <ul className="clear">
                  <li>字数:{formatWords(book.wordCount)}</li>
                  <li>更新:{fmtDateShort(book.updatedAt)}</li>
                  <li>最新:{book.latestChapter || '—'}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧作者信息 (works-author-wr) */}
        <div className="ui-right">
          <div className="works-author-wr">
            <div className="works-author-intro clearfix" style={{ height: 120 }}>
              <a className="works-author-face ui-left" href="javascript:void(0)" title={book.author} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }}>
                <BookCover name={book.author} cover={null} style={{ width: 85, height: 113 }} />
              </a>
              <dl className="works-author-info ui-left" style={{ marginTop: 25 }}>
                <dt>
                  <a className="works-author-name" href="javascript:void(0)" title={book.author} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }}>{book.author}</a>
                </dt>
                <dd style={{ lineHeight: '24px' }}>作者等级：初入文坛</dd>
                <dd style={{ lineHeight: '24px' }}>签约状态：未签约</dd>
                <dd style={{ lineHeight: '24px' }}>是否上架：未上架</dd>
              </dl>
            </div>
            <div className="clearfix">
              <h3 className="works-author-title ui-left" style={{ marginTop: 24 }}>作者公告</h3>
              <p className="works-author-notice">此作者暂时没有公告！</p>
              <span className="works-author-robe"></span>
            </div>
            <div className="works-slider-ad" style={{ height: 213 }}>
              <div className="bx-wrapper mod-slider">
                <div className="bx-viewport" style={{ height: 200, position: 'relative', marginTop: 13 }}>
                  <ul className="works-slider-list">
                    <div style={{ lineHeight: '225px', textAlign: 'center' }}>该作者暂无其他作品</div>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="subscribe-tip-wrap ui-wm clearfix" style={{ marginBottom: 20 }}></div>

      {/* ============ 章节列表 (works-chapter-wr) ============ */}
      <div className="works-chapter-wr works-stack ui-wm ui-mb20">
        <ul className="words-xone-menu clearfix works-chapter-menu">
          <li className="active">
            <a href={`/${book.categoryId || '0'}/${book.id}/menu/1.html`} title={`${book.name}的章节列表`} onClick={(e) => { e.preventDefault(); onScrollToc() }}>查看完整章节目录</a>
          </li>
        </ul>
        <div className="works-chapter-list-tabcon">
          <div className="works-chapter-list-con" id="chapter">
            <div className="works-chapter-top subscribe-wrap">
              <ul className="works-chapter-log ui-left">
                <li>
                  <span className="ui-font-fb">最新章：</span>
                  <a className="works-ft-new" href={`/${book.categoryId || '0'}/${book.id}/read/1.html`} onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}>
                    {book.latestChapter || '第1章'}
                  </a>
                  <span className="ui-pl10 ui-text-gray6">{book.updatedAt ? new Date(book.updatedAt).toISOString().replace('T', ' ').slice(0, 19) : ''}</span>
                </li>
              </ul>
              <div className="chapter-page-pager"></div>
            </div>
            <div className="works-chapter-list-wr ui-left">
              <ol className="chapter-page-new works-chapter-list">
                <li>
                  <p><span className="works-chapter-item"><a href={`/${book.categoryId || '0'}/${book.id}/read/1.html`} title={book.latestChapter || '第1章'} onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}>{book.latestChapter || '第1章'}</a></span></p>
                  <p><span className="ui-text-gray9 ui-pl10">点击目录查看完整章节列表</span></p>
                </li>
              </ol>
            </div>
            <div className="clear"></div>
          </div>
        </div>
      </div>

      {/* ============ 同标签推荐 (works-simi-wr) ============ */}
      {simiBooks.length > 0 && (
        <div className="ui-right">
          <div className="works-simi-wr">
            <h3 className="works-title">同标签推荐</h3>
            <ul id="works-simi-list" className="works-simi-list">
              {simiBooks.map(b => (
                <li key={b.id}>
                  <a className="works-simi-cover" title={b.name} href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                    <BookCover name={b.name} cover={b.cover} style={{ width: 90, height: 120 }} />
                  </a>
                  <h5 className="works-simi-name">
                    <a href={`/${b.categoryId || '0'}/${b.id}/info.html`} title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                  </h5>
                  <p style={{ padding: '8px 0' }}>作者：{b.author}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ============ 看过本书的人还看过 (works-more-wr) ============ */}
      {youMayLike.length > 0 && (
        <div className="works-more-wr works-stack ui-mb20" id="youMayLike">
          <h3 className="works-title-small">看过《{book.name}》的人还看过....</h3>
          <ul id="mod-cover-list" className="mod-cover-list clearfix">
            {youMayLike.map(b => (
              <li key={b.id}>
                <a className="mod-cover-list-thumb mod-cover-effect ui-db" title={b.name} href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                  <BookCover name={b.name} cover={b.cover} style={{ width: 110, height: 150 }} />
                  <span className="mod-layer-mask">&nbsp;&nbsp;</span>
                </a>
                <p className="mod-cover-list-updata">
                  <a className="mod-cover-list-mask" href={`/${b.categoryId || '0'}/${b.id}/read/1.html`} target="_blank" title={b.name} {...bookNavProps(navigate, b.id)}>
                    <span className="mod-cover-list-text">{b.latestChapter || '第1章'}</span>
                  </a>
                </p>
                <h5 style={{ paddingBottom: 15 }}>
                  <a className="mod-cover-list-name" href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                </h5>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ============ 友情链接 + 悬浮栏 + footer (与首页一致) ============ */}
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
