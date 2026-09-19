'use client'
// ============================================================
// clone-pilishuwu HomeClone — 1:1 精仿 pilishuwu.com 霹雳书屋首页
// 参考: agent-ctx/probe-html2/probe-pilishuwu.html (源站真实 DOM, 5239 行)
// 复刻: .mod-top-wr (header logo+search) / .mod-top-nav-wr (nav)
//       / .newyear-bg-wrap .mod-tags-wr .mod-animate-list (独家推荐 banner)
//       / .in-banner-wr + .in-rank-wr (推荐位 + 热门排行)
//       / .in-strong-wr .in-slider-list .mod-cover-list (精品推荐)
//       / .in-sign-wr .in-sign-cover + .in-sign-work-wr (纯爱小说等大封面 + 简介)
//       / .in-vip-wr .in-rise-wr .in-rise-list (最新入库 网格)
//       / in-rise-ta-wrap table (最新更新表格)
//       / .linkBox (友情链接) + .mod-fixed-top-wr (悬浮栏) + .mod-footer-wr (footer)
// CSS 由 CloneCSSLoader 加载 public/clone-css/pilishuwu.css (85KB), 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { addFavoriteSite, useTraditionalChinese } from '../tools'
import type { HomeCloneProps } from '../shared'
import { cloneNavHandlers } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

// 简繁切换按钮 — pilishuwu 风格 (mod-top-nav-tool 内文字链接, 与域名发布页同行)
function TcTogglePilishuwu() {
  const { isTc, mounted, toggleTc } = useTraditionalChinese()
  const label = mounted && isTc ? '简体' : '繁體'
  return (
    <a
      href="#tc-toggle"
      title="简繁切换"
      onClick={(e) => { e.preventDefault(); toggleTc() }}
      style={{ fontSize: 14, color: '#666' }}
    >
      {label}
    </a>
  )
}

// 源站默认 9 个导航分类 (与 probe 顺序一致, fetch 失败兜底)
const DEFAULT_NAV: Cat[] = [
  { id: '0', name: '全部小说' }, { id: '1', name: '男频小说' },
  { id: '2', name: '女频小说' }, { id: '3', name: '电子图书' },
  { id: '4', name: '无CP小说' }, { id: '5', name: '纯爱小说' },
  { id: '6', name: '百合小说' }, { id: '8', name: '轻小说' },
]

export function HomeClone({ books, loading, navCategoryCount = 8, initialCategories }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  // R24: SSR 首载用 page.tsx server fetch 的 initialCategories 初始化, 避免 SSR 时 cats=[] → navigation 没分类
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))

  // 拉分类列表用于 mod-top-nav-list + 各分类区块
  // R24: cats 为空时才 fetch, 避免覆盖 SSR initialCategories 数据
  useEffect(() => {
    if (cats.length > 0) return
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
  }, [cats.length])

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, navCategoryCount)

  if (loading) return <div className="ui-wm" style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
  if (!books.length) return <div className="ui-wm" style={{ padding: 40, textAlign: 'center' }}>暂无内容</div>

  // —— 数据切片 (与源站各模块对齐) ——
  // 独家推荐 banner: 字数最多前 8 本 (横向滚动列表, 每项 210x280 大封面)
  const aniBooks = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 8)
  // 热门排行 in-rank-wr: 前 16 本分两 ol, 前 3 名橙底, 后 13 名灰底
  const rankBooks = books.slice(0, 16)
  const rankLeft = rankBooks.slice(0, 8)
  const rankRight = rankBooks.slice(8, 16)
  // in-rank-recommend 文字列表 4 本
  const rankRec = books.slice(16, 20)
  // 精品推荐 in-slider-list (mod-cover-list): 8 本
  const strongBooks = books.slice(0, 8)
  // 纯爱小说 in-sign-wr: 8 本大封面 + 简介
  const signBooks = books.slice(0, 8)
  // 最新入库 in-rise-list: 8 本小封面网格
  const riseBooks = books.slice(0, 8)
  // 最新更新表格 in-rise-ta: 剩余本数 (取 24 行)
  const latestUpdates = books.slice(0, 24)

  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch, goCat } = cloneNavHandlers(navigate, 'key')
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
      <a className="in-rank-name" href={`/${b.categoryId || '0'}/${b.id}/info.html`} title={b.name} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
      <i className="ui-rank-trend-keep"></i>
    </li>
  )

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

        {/* 顶部导航 mod-top-nav */}
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
            <div className="mod-top-nav-tool ui-right" id="loginbox">
              <a href="#favorite" title="收藏本站 (Ctrl+D)" onClick={(e) => addFavoriteSite(e)} style={{ marginRight: 12, fontSize: 14, color: '#666' }}>
                收藏本站
              </a>
              <TcTogglePilishuwu />
            </div>
            <a className="mod-top-nav-user ui-right" href="#" onClick={(e) => e.preventDefault()} title="域名发布页">域名发布页</a>
          </div>
        </div>
      </div>

      {/* ============ 独家推荐 banner (newyear-bg-wrap) ============ */}
      <div className="newyear-bg-wrap">
        <div className="mod-tags-wr ui-wm">
          <ul className="mod-animate-list clearfix">
            <li className="first"><span className="ui-ico-animate">独家推荐</span></li>
            {aniBooks.map(b => (
              <li key={b.id}>
                <a href={`/${b.categoryId || '0'}/${b.id}/info.html`} title={b.name} target="_blank" className="mod-top-ani-a" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                <div className="mod-ani-info">
                  <span className="mod-ico-top">&nbsp;</span>
                  <a className="mod-ani-img" href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                    <BookCover name={b.name} cover={b.cover} style={{ width: 210, height: 280 }} />
                  </a>
                  <div className="mod-ani-text1 clearfix">
                    <a href={`/${b.categoryId || '0'}/${b.id}/info.html`} className="ui-left ui-fs-18" title={b.name} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    <a className="ui-right ui-txt-fb" title={b.author} href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: b.author }) }}>{b.author}</a>
                  </div>
                  <div className="mod-ani-text2">
                    <p className="ui-ani-fplay">浏览量{(b.wordCount || 0) * 12 + 8000}</p>
                    &nbsp;开始阅读：<a href={`/${b.categoryId || '0'}/${b.id}/read/1.html`} title={`第1章 ${b.latestChapter || '正文'}`} target="_blank" {...bookNavProps(navigate, b.id)}>第1章 {b.latestChapter || '正文'}</a>
                  </div>
                  <ul className="mod-ani-ul clearfix"></ul>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ============ 推荐位 banner + 热门排行 (in-banner-wr + in-rank-wr) ============ */}
      <div className="ui-wm ui-mb40 ui-mt20 clearfix">
        {/* 推荐位 banner (左侧大封面) */}
        <div className="in-banner-wr ui-left">
          <ul className="in-banner-list">
            {strongBooks.slice(0, 4).map(b => (
              <li key={b.id}>
                <a href={`/${b.categoryId || '0'}/${b.id}/info.html`} className={`no${(b.id.charCodeAt(0) % 50) + 1}`} target="_blank" title={b.name} {...bookNavProps(navigate, b.id)}>
                  <BookCover name={b.name} cover={b.cover} style={{ width: '100%', height: 220 }} />
                  <p className="in-banner-info">
                    <strong>{b.name}</strong>
                    <span className="in-banner-ft-info">{b.author}</span>
                    <i className="in-banner-icon">&nbsp;</i>
                  </p>
                  <span className="in-banner-bg"></span>
                  <span className="in-banner-name bg-org">《{b.name}》<span className="icon-right"></span></span>
                </a>
              </li>
            ))}
          </ul>
          <div className="in-banner-arrow" id="in-banner-arrow">
            <a className="in-banner-leftbtn" title="上一页" href="javascript:;" onClick={(e) => e.preventDefault()}>上一页</a>
            <a className="in-banner-rightbtn" title="下一页" href="javascript:;" onClick={(e) => e.preventDefault()}>下一页</a>
          </div>
        </div>

        {/* 热门排行 (右侧月/周/日榜) */}
        <div className="in-rank-wr ui-right">
          <div className="mod-tab-handle clearfix">
            <h2>热门排行</h2>
            <ul id="top-rank-handle">
              <li className="active"><a href="javascript:void(0);" onClick={(e) => e.preventDefault()}>月榜</a></li>
              <li><a href="javascript:void(0);" onClick={(e) => e.preventDefault()}>周榜</a></li>
              <li><a href="javascript:void(0);" onClick={(e) => e.preventDefault()}>日榜</a></li>
            </ul>
          </div>
          <div id="top-rank-panel" className="mod-tab-content-wr">
            <div className="mod-tab-content clearfix">
              <ol className="in-rank-list ui-left ui-pr10">
                {rankLeft.map((b, i) => renderRankLi(b, i))}
              </ol>
              <ol className="in-rank-list ui-left">
                {rankRight.map((b, i) => renderRankLi(b, i + 8))}
              </ol>
            </div>
          </div>
          <div className="in-rank-spacing"></div>
          <ul className="in-rank-recommend">
            {rankRec.map(b => (
              <li key={b.id}><a href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a></li>
            ))}
          </ul>
        </div>
      </div>

      {/* ============ 精品推荐 (in-strong-wr) ============ */}
      <div className="in-strong-wr ui-wm ui-mb40" id="in-strong-wr">
        <div className="in-title-wr title-line-bg ui-mb20 clearfix">
          <h3 className="in-title-big ui-left veins">精品<em>推荐</em></h3>
        </div>
        <div id="in-slider-wr" className="in-slider-wr in-content">
          <ul id="in-slider-list" className="in-slider-list mod-cover-list clearfix">
            {strongBooks.map(b => (
              <li key={b.id}>
                <a className="mod-cover-list-thumb mod-cover-effect ui-db" title={b.name} href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                  <BookCover name={b.name} cover={b.cover} style={{ width: 140, height: 190 }} />
                  <span className="mod-layer-mask">&nbsp;&nbsp;</span>
                </a>
                <p className="mod-cover-list-updata">
                  <a className="mod-cover-list-mask" href={`/${b.categoryId || '0'}/${b.id}/read/1.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                    <span className="mod-cover-list-text">{b.latestChapter || '第1章'}</span>
                  </a>
                </p>
                <h5><a className="mod-cover-list-name" href={`/${b.categoryId || '0'}/${b.id}/info.html`} title={b.name} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a></h5>
                <p className="mod-cover-list-intro-1">{b.intro || '暂无简介'}</p>
                <p className="mod-cover-list-intro">{b.author}</p>
                <p className="mod-cover-list-tag">
                  <a className="mod-tag-item" href={`/${b.categoryId || '0'}/list/1.html`} target="_blank" title={b.category || '小说'} onClick={(e) => goCat(e, b.categoryId || undefined)}>{b.category || '小说'}</a>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ============ 纯爱小说 (in-sign-wr) — 大封面 + 简介切换 ============ */}
      <div className="in-sign-wr ui-wm ui-mb40" id="in-sign-wr">
        <div className="in-title-wr ui-mb20"><h3 className="in-title-big">纯爱<em>小说</em></h3></div>
        <div className="in-content-wr">
          <div className="in-sign-left-wr">
            <div id="in-sign-cover" className="in-sign-cover">
              {signBooks.map((b, i) => (
                <a key={b.id} className={i === 0 ? '' : 'ui-dn'} href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" title={b.name} {...bookNavProps(navigate, b.id)}>
                  <BookCover name={b.name} cover={b.cover} style={{ width: 210, height: 280 }} />
                </a>
              ))}
            </div>
          </div>
          <div className="in-sign-right-wr">
            <div id="in-sign-intro" className="in-sign-work-wr">
              {signBooks.map((b, i) => (
                <div key={b.id} className={`in-sign-work ${i === 0 ? '' : 'ui-dn'}`}>
                  <div className="clearfix">
                    <h4 className="ui-left">
                      <a className="in-sign-work-name ui-ahover-normal" href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    </h4>
                  </div>
                  <p className="in-sign-work-author ui-text-gray9">
                    <b>作者：{b.author}</b>
                    <span>标签：{b.category || '小说'}</span>
                  </p>
                  <p className="in-sign-work-intro"><a href={`/${b.categoryId || '0'}/${b.id}/info.html`} {...bookNavProps(navigate, b.id)}>{b.intro || '暂无简介'}</a></p>
                </div>
              ))}
            </div>
            <div className="in-sign-handle">
              <ul id="in-sign-handle" className="in-sign-list clearfix">
                {signBooks.map((b, i) => (
                  <li key={b.id} className={i === 0 ? 'active' : ''} data-ping={`new.ac_index.Sign.works.${i + 1}`}>
                    <a className="in-sign-thumb ui-db" title={b.name} href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                      <BookCover name={b.name} cover={b.cover} style={{ width: 100, height: 133 }} />
                      <span className="in-sign-mask">&nbsp;&nbsp;</span>
                    </a>
                    <p className="mod-cover-list-updata">
                      <a className="mod-cover-list-mask" href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                        <span className="mod-cover-list-text">{b.author}</span>
                      </a>
                    </p>
                    <h5 className="in-sign-name"><a className="ui-text-gray3" href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a></h5>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ============ 最新入库 (in-vip-wr > in-rise-wr) ============ */}
      <div className="in-vip-wr ui-wm ui-mb40 clearfix" id="in-vip-wr">
        <div className="in-rise-wr ui-left">
          <div className="in-title-wr clearfix">
            <h3 className="in-title-big ui-left veins" id="in-create">最新<em>入库</em></h3>
            <div className="in-rise-tab ui-right veins" id="in-rise-tab">
              <a className="in-rise-tab-leftbtn" href="javascript:void(0);" title="上一页" onClick={(e) => e.preventDefault()}>&nbsp;</a>
              <a className="in-rise-tab-num current" href="javascript:void(0);" title="最新入库1-10" onClick={(e) => e.preventDefault()}>1-10</a>
              <a className="in-rise-tab-num" href="javascript:void(0);" title="最新入库11-20" onClick={(e) => e.preventDefault()}>11-20</a>
              <a className="in-rise-tab-num" href="javascript:void(0);" title="最新入库21-30" onClick={(e) => e.preventDefault()}>21-30</a>
              <a className="in-rise-tab-rightbtn" href="javascript:void(0);" title="下一页" onClick={(e) => e.preventDefault()}>&nbsp;</a>
            </div>
          </div>
          <ul id="in-rise-list" className="in-rise-list mod-cover-list-samll clearfix">
            <li>
              <div className="in-rise-con clearfix">
                {riseBooks.map(b => (
                  <div className="in-rise-item" key={b.id}>
                    <div className="mousetouch">
                      <a className="mod-cover-list-thumb-samll mod-cover-effect ui-db mod-cover-list-thumb-small" href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                        <BookCover name={b.name} cover={b.cover} style={{ width: 100, height: 133 }} />
                        <span className="mod-layer-mask">&nbsp;&nbsp;</span>
                      </a>
                      <a href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" {...bookNavProps(navigate, b.id)}>
                        <div className="content"><span>{b.intro || '暂无简介'}</span></div>
                      </a>
                    </div>
                    <h5>
                      <a className="mod-cover-list-name" href={`/${b.categoryId || '0'}/${b.id}/info.html`} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    </h5>
                    <p className="mod-cover-list-intro">{b.author}</p>
                    <p className="mod-cover-list-tag">
                      <a className="mod-tag-item" href={`/${b.categoryId || '0'}/list/1.html`} target="_blank" title={b.category || '小说'} onClick={(e) => goCat(e, b.categoryId || undefined)}>{b.category || '小说'}</a>
                    </p>
                  </div>
                ))}
              </div>
            </li>
          </ul>
        </div>
      </div>

      {/* ============ 最新更新表格 (in-rise-ta-wrap) ============ */}
      <div className="in-vip-wr ui-wm ui-mb40 clearfix">
        <div className="in-rise-wr ui-left" style={{ width: '100%' }}>
          <div className="in-title-wr clearfix">
            <h3 className="in-title-big ui-left veins">最新<em>更新</em></h3>
            <div className="in-rise-tab ui-right veins">
              <a href="javascript:void(0);" onClick={(e) => e.preventDefault()} style={{ fontSize: 14, color: '#666' }}>共{books.length}本</a>
            </div>
          </div>
          <div className="in-rise-ta-wrap">
            <table border={0} cellSpacing={1} cellPadding={0} className="in-rise-ta">
              <tbody>
                {latestUpdates.map(b => (
                  <tr key={b.id}>
                    <td className="td1">
                      <span className="in-risecon-first">
                        <a href={`/${b.categoryId || '0'}/list/1.html`} target="_blank" title={b.category || '小说'} onClick={(e) => goCat(e, b.categoryId || undefined)}>【{b.category || '小说'}】</a>
                      </span>
                    </td>
                    <td className="td2">小说名称：<a href={`/${b.categoryId || '0'}/${b.id}/info.html`} target="_blank" className="ft-weight" title={b.name} {...bookNavProps(navigate, b.id)}>{b.name}</a></td>
                    <td className="td3">最新章节：<a href={`/${b.categoryId || '0'}/${b.id}/read/1.html`} target="_blank" title={b.latestChapter || '第1章'} {...bookNavProps(navigate, b.id)}>{b.latestChapter || '第1章'}</a></td>
                    <td className="td4">作者：{b.author}</td>
                    <td>更新时间：{b.updatedAt ? new Date(b.updatedAt).toISOString().replace('T', ' ').slice(0, 19) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ============ 友情链接 (linkBox) ============ */}
      <div className="linkBox">
        <span className="linkTitle">友情链接</span>
        <p className="linkList">
          <a href="#" onClick={(e) => e.preventDefault()}>永久地址</a>
          <a href="#" onClick={(e) => e.preventDefault()}>{site.name}二站</a>
          <a href="#" onClick={(e) => e.preventDefault()}>{site.name}</a>
          <a href="#" onClick={(e) => e.preventDefault()}>{site.name}三站</a>
        </p>
      </div>

      {/* ============ 悬浮栏 (mod-fixed-top-wr) ============ */}
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

      {/* ============ 左侧悬浮栏 (mod-fixed-left-wr) ============ */}
      <div className="mod-fixed-left-wr" id="mod-fixed-left-wr">
        <ul className="mod-fixed-left-tags" id="mod-fixed-left-tags">
          <li><a href="#in-banner-wr" onClick={(e) => e.preventDefault()} title="封面推荐">封面<br />推荐</a></li>
          <li><a href="#in-strong-wr" onClick={(e) => e.preventDefault()} title="精品推荐">精品<br />推荐</a></li>
          <li><a href="javascript:void(0)" onClick={(e) => e.preventDefault()} title="分类小说">分类<br />小说</a></li>
          <li><a href="#in-vip-wr" onClick={(e) => e.preventDefault()} title="最新入库">最新<br />入库</a></li>
          <li><a href="#latest-update" onClick={(e) => e.preventDefault()} title="最新更新">最新<br />更新</a></li>
        </ul>
        <a className="tab-top" id="mod-fixed-left-top" href="javascript:void(0);" title="顶部" onClick={(e) => { e.preventDefault(); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }}>顶部</a>
      </div>

      {/* ============ footer (mod-footer-wr) ============ */}
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
