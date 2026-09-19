'use client'
// ============================================================
// clone-shipsay HomeClone — 1:1 精仿 demo.shipsay.com 首页
// 参考: agent-ctx/probe-html2/probe-shipsay.html (源站真实 DOM)
// 复刻: header>.container.head / .navigation>nav / .container>.side_commend+aside / .container>.section.flex>.sortvisit
// CSS 由 CloneCSSLoader 加载 public/clone-css/shipsay.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import { addFavoriteSite, useTraditionalChinese } from '../tools'
import type { HomeCloneProps } from '../shared'
import { cloneNavHandlers } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

// 简繁切换按钮 — shipsay 风格 (fa fa-language + br + 文案)
function TcToggleShip() {
  const { isTc, mounted, toggleTc } = useTraditionalChinese()
  // SSR/水合一致: mount 前显示简体态 "繁體", mount 后按当前状态显示 "简体"/"繁體"
  const label = mounted && isTc ? '简体' : '繁體'
  return (
    <a
      href="#tc-toggle"
      title="简繁切换"
      onClick={(e) => { e.preventDefault(); toggleTc() }}
    >
      <i className="fa fa-language fa-lg" /><br />{label}
    </a>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 8, homeModuleLimit = 6, initialCategories }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  // R24: SSR 首载用 page.tsx server fetch 的 initialCategories 初始化, 避免 SSR 时 cats=[] → navigation 没分类
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))

  // client 端补充: initialCategories 缺失或为空时 fetch
  useEffect(() => {
    if (cats.length > 0) return
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        // API 返回 {ok, data:{items:[{id,name,bookCount,rep}]}}
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        setCats(arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [cats.length])

  if (loading) return <div className="container" style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
  if (!books.length) return <div className="container" style={{ padding: 40, textAlign: 'center' }}>暂无内容</div>

  // 大神小说: 字数最多的前 N 本 (横向 flex 大封面)
  const topBooks = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, homeModuleLimit)
  // 热门小说: 前 12 本 (侧边文字列表)
  const popular = books.slice(0, 12)
  // 分类区块: 按 categories 列出每个分类, 每区 1 大封面 + 11 本文字列表
  const navCats = cats.slice(0, navCategoryCount)
  const sections = (navCats.length ? navCats : [{ id: 'all', name: '全部' }]).map(c => {
    const list = books.filter(b => (b.categoryId || b.category) === c.id || b.category === c.name)
    const pool = list.length > 1 ? list : books
    return { cat: c, list: pool.slice(0, 12) }
  })

  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch, goCat } = cloneNavHandlers(navigate, 'searchkey')

  return (
    <>
      {/* header */}
      <header>
        <div className="container head">
          <a id="logo" href="/" onClick={goHome}>
            <span>{site.name}</span>
            <p>{site.domain}</p>
          </a>
          <form name="t_frmsearch" onSubmit={goSearch}>
            <input id="searchkey" name="searchkey" className="search_input" placeholder="搜索书名或作者" autoComplete="off" />
            <input type="hidden" name="searchtype" value="all" />
            <button type="submit" id="search_btn" title="搜索"><i className="fa fa-search fa-lg" /></button>
          </form>
          <div className="header_right">
            <a id="home" href="/" onClick={goHome}><i className="fa fa-home fa-lg" /><br />首页</a>
            <a href="/sort/" onClick={(e) => goCat(e)}><i className="fa fa-book fa-lg" /><br />书库</a>
            <a href="/quanben/sort/" onClick={(e) => goCat(e)}><i className="fa fa-coffee fa-lg" /><br />完本</a>
            <a href="/history.html" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}><i className="fa fa-history fa-lg" /><br />足迹</a>
            <a href="#favorite" title="收藏本站 (Ctrl+D)" onClick={(e) => addFavoriteSite(e)}><i className="fa fa-star fa-lg" /><br />收藏本站</a>
            <TcToggleShip />
          </div>
        </div>
      </header>

      {/* navigation */}
      <div className="navigation">
        <nav className="container">
          <a href="/" onClick={goHome}>首页</a>
          {navCats.map(c => (
            <a key={c.id} href={`/sort/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
          ))}
          <div id="user_panel" />
        </nav>
      </div>

      {/* 大神小说 + 热门小说 */}
      <div className="container">
        <div className="side_commend side_commend_width">
          <p className="title"><i className="fa fa-thumbs-o-up fa-lg">&nbsp;</i>大神小说</p>
          <ul className="flex">
            {topBooks.map(b => (
              <li key={b.id}>
                <div className="img_span">
                  <a {...bookNavProps(navigate, b.id)}>
                    <BookCover name={b.name} cover={b.cover} style={{ width: 120, height: 160 }} />
                  </a>
                  <span>{b.category || '小说'} / {b.status === 'completed' ? '完结' : '连载'}</span>
                </div>
                <div className="w100">
                  <a {...bookNavProps(navigate, b.id)}><h2>{b.name}</h2></a>
                  <p className="indent">{b.intro || '暂无简介'}</p>
                  <div className="li_bottom">
                    <a><i className="fa fa-user-circle-o">&nbsp;{b.author}</i></a>
                    <div>
                      <em className="orange">{formatWords(b.wordCount)}</em>
                      <em className="blue">{b.updatedAt ? new Date(b.updatedAt).toISOString().slice(0, 10) : ''}</em>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <aside>
          <p className="title"><i className="fa fa-fire fa-lg">&nbsp;</i>热门小说</p>
          <ul className="popular odd">
            {popular.map(b => (
              <li key={b.id}>
                <a {...bookNavProps(navigate, b.id)}>{b.name}</a>
                <a className="gray">{b.author}</a>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* 分类区块 */}
      <div className="container">
        <div className="section flex">
          {sections.map(({ cat, list }) => (
            <div key={cat.id} className="sortvisit">
              <a href={`/sort/${cat.id}/`} onClick={(e) => goCat(e, cat.id)}>{cat.name}</a>
              <ul>
                {list[0] && (
                  <div>
                    <a {...bookNavProps(navigate, list[0].id)}>
                      <BookCover name={list[0].name} cover={list[0].cover} style={{ width: 120, height: 160 }} />
                    </a>
                    <p>
                      <a {...bookNavProps(navigate, list[0].id)}>{list[0].name}</a>
                      <i>&nbsp;/&nbsp;{list[0].author}</i>
                      <br />&nbsp;&nbsp;&nbsp;&nbsp;{list[0].intro || '暂无简介'}
                    </p>
                  </div>
                )}
                {list.slice(1, 12).map(b => (
                  <li key={b.id}>
                    <a {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    <i>&nbsp;/ {b.author}</i>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
