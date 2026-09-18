'use client'
// ============================================================
// clone-shipsay BookInfo — 1:1 精仿 demo.shipsay.com 书籍详情页
// 参考: agent-ctx/probe-html2/probe-shipsay.html (源站首页真实 DOM) +
//       public/clone-css/shipsay.css 的 .novel_info_main / .novel_info_title /
//       .chapter_list / .l_btn / .l_btn_0 / .indent / .section / .sortvisit
// 复刻: header>.container.head / .navigation>nav / .container>.section
//       .novel_info_main (img + .novel_info_title h1+p span+i+div+a)
//       + .indent>p (简介) + .l_btn/.l_btn_0 (开始阅读/查看目录)
//       + .container>.section .chapter_list (章节列表) +
//       .container>.section.flex .sortvisit (同类推荐) +
//       .container>.section.link (友情链接) + #footer>footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/shipsay.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords, statusLabel } from '../../seo'
import type { BookInfoProps } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: '1', name: '玄幻' }, { id: '2', name: '武侠' },
  { id: '3', name: '都市' }, { id: '4', name: '历史' },
  { id: '5', name: '科幻' }, { id: '6', name: '游戏' },
  { id: '7', name: '女生' }, { id: '8', name: '其他' },
]

export function BookInfo({ book, onScrollToc, onContinueRead, onGoCategory, initialCategories }: BookInfoProps) {
  const { site, navigate } = usePublic()
  // R25: SSR 首载用 page.tsx server fetch 的 initialCategories 初始化, 避免 SSR 时 cats=[] → navigation 没分类
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))
  const [related, setRelated] = useState<BookItem[]>([])

  // 拉分类列表用于 navigation nav + sortvisit 同类推荐
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

  // 拉"同类推荐": 同分类前 12 本(排除当前书)
  useEffect(() => {
    if (!book?.id) return
    let aborted = false
    const cat = book.categoryId || ''
    const sp = new URLSearchParams({ size: '13', sort: 'latest' })
    if (cat) sp.set('cat', cat)
    if (site?.id) sp.set('site', site.id)
    fetch(`/api/public/books?${sp.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const list: BookItem[] = (d?.data?.books || d?.books || []).filter((b: BookItem) => b.id !== book.id).slice(0, 12)
        setRelated(list)
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [book?.id, book?.categoryId, site?.id])

  if (!book) return null

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 8)
  const fmtDateShort = (d?: string | null) => d ? new Date(d).toISOString().slice(0, 10) : ''

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    if (onGoCategory && catId) onGoCategory(catId)
    else navigate({ view: 'category', cat: catId })
  }
  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  return (
    <>
      {/* ============ header ============ */}
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
            <a href="/quanben/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'fulltext' }) }}><i className="fa fa-coffee fa-lg" /><br />完本</a>
            <a href="/history.html" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}><i className="fa fa-history fa-lg" /><br />足迹</a>
          </div>
        </div>
      </header>

      {/* ============ navigation ============ */}
      <div className="navigation">
        <nav className="container">
          <a href="/" onClick={goHome}>首页</a>
          {navCats.map(c => (
            <a key={c.id} href={`/sort/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
          ))}
          <div id="user_panel" />
        </nav>
      </div>

      {/* ============ 书籍信息 (novel_info_main) ============ */}
      <div className="container">
        <div className="section">
          <div className="novel_info_main">
            {/* 封面 (img 120x160 float left) */}
            <BookCover name={book.name} cover={book.cover} style={{ width: 120, height: 160, marginRight: 20, marginTop: 8, boxShadow: '3px 4px 10px #999', float: 'left' }} />
            {/* 标题 + 元数据 */}
            <div className="novel_info_title">
              <h1>{book.name}</h1>
              <p>
                <span>作者：{book.author}</span>
                <span>类别：{book.category || '小说'}</span>
                <span>状态：{statusLabel(book.status)}</span>
                <span>字数：{formatWords(book.wordCount)}</span>
                <span>更新：{fmtDateShort(book.updatedAt)}</span>
              </p>
              <i>最新章节：<a {...bookNavProps(navigate, book.id)} onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}>{book.latestChapter || '第1章'}</a></i>
              <div>
                <a className="l_btn" href={`javascript:void(0)`} title={`开始阅读${book.name}`} onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}>开始阅读</a>
                <a className="l_btn_0" href={`javascript:void(0)`} title={`${book.name}目录`} onClick={(e) => { e.preventDefault(); onScrollToc() }}>查看目录</a>
              </div>
            </div>
            {/* 简介 (indent > p) */}
            <div className="indent">
              <p>{book.intro || '暂无简介'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ============ 章节列表 (chapter_list) ============ */}
      <div className="container">
        <div className="section">
          <div className="chapter_list">
            <p className="title"><i className="fa fa-list fa-lg">&nbsp;</i>最新章节</p>
            <ul>
              <li><a href={`javascript:void(0)`} title={book.latestChapter || '第1章'} onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}>{book.latestChapter || '第1章'}</a></li>
              <li><a href={`javascript:void(0)`} title={`${book.name}目录`} onClick={(e) => { e.preventDefault(); onScrollToc() }}>查看完整章节目录 &gt;&gt;</a></li>
            </ul>
          </div>
        </div>
      </div>

      {/* ============ 同类推荐 (sortvisit) ============ */}
      {related.length > 0 && (
        <div className="container">
          <div className="section flex">
            <div className="sortvisit">
              <a href={`javascript:void(0)`} onClick={(e) => { e.preventDefault(); if (book.categoryId) { if (onGoCategory) onGoCategory(book.categoryId); else navigate({ view: 'category', cat: book.categoryId || undefined }) } }}>同类推荐</a>
              <ul>
                {related[0] && (
                  <div>
                    <a {...bookNavProps(navigate, related[0].id)}>
                      <BookCover name={related[0].name} cover={related[0].cover} style={{ width: 60, height: 80, marginRight: 15, marginTop: 5 }} />
                    </a>
                    <p>
                      <a {...bookNavProps(navigate, related[0].id)}>{related[0].name}</a>
                      <i>&nbsp;/&nbsp;{related[0].author}</i>
                      <br />&nbsp;&nbsp;&nbsp;&nbsp;{related[0].intro || '暂无简介'}
                    </p>
                  </div>
                )}
                {related.slice(1, 12).map(b => (
                  <li key={b.id}>
                    <a {...bookNavProps(navigate, b.id)}>{b.name}</a>
                    <i>&nbsp;/ {b.author}</i>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ============ 友情链接 (section.link) ============ */}
      <div className="container">
        <div className="section link">
          <p className="title"><i className="fa fa-link">&nbsp;</i>友情链接</p>
          <a href={site.domain ? `https://${site.domain}` : '/'} target="_blank">{site.name}</a>
          <a href="/" onClick={goHome}>{site.name}首页</a>
        </div>
      </div>

      {/* ============ footer ============ */}
      <div id="footer">
        <footer className="container">
          <p><i className="fa fa-flag"></i>&nbsp;<a href="/" onClick={goHome}>{site.name}</a>&nbsp;书友最值得收藏的网络小说阅读网</p>
          <p>{site.footerText || `本站所有小说为完本转载作品，所有内容版权归版权方或原作者所有。`}</p>
        </footer>
      </div>
    </>
  )
}
