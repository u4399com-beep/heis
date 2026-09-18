'use client'
// ============================================================
// clone-shipsay ReadChrome — 1:1 精仿 demo.shipsay.com 章节阅读页
// 参考: public/clone-css/shipsay.css 的 main[class='container'] max-width:900px /
//       .text_title (padding:40px 64px 10px) / .style_h1 (24px bold #555) /
//       .text_info span (gray 14px) / .text (position:relative) /
//       .fontsize (display:flex + button 3 sizes) / #article (padding 0 64px 20px
//       font-size:18px color:#262626 min-height:200px) / #article>p
//       (text-indent:2em line-height:1.8em) / .read_nav (height:60px bg:#FBF6EC
//       display:flex line-height:60px) / .read_nav a (33.33% width 18px text-center)
// 复刻: header>.container.head / .navigation>nav / main.container .text_title
//       h1.style_h1 + .text_info span (来源/时间) / .text .fontsize (A-/A/A+)
//       + #article children / .read_nav a × 3 (上一章/目录/下一章) +
//       .container>.section.link + #footer>footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/shipsay.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared'
import { useEffect, useState } from 'react'

const DEFAULT_NAV = [
  { id: '1', name: '玄幻' }, { id: '2', name: '武侠' },
  { id: '3', name: '都市' }, { id: '4', name: '历史' },
  { id: '5', name: '科幻' }, { id: '6', name: '游戏' },
  { id: '7', name: '女生' }, { id: '8', name: '其他' },
]

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  // 字号档位: 16/19/22 (对应 .fontsize button 的 30/33/36 px 视觉尺寸)
  const [sizeIdx, setSizeIdx] = useState(1)
  const fontSizes = [16, 19, 22]
  const fontSize = fontSizes[sizeIdx]

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const goTop = () => { if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }

  // 章节切换时自动滚回顶部
  useEffect(() => { goTop() }, [chapterTitle])

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
          {DEFAULT_NAV.map(c => (
            <a key={c.id} href={`/sort/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
          ))}
          <div id="user_panel" />
        </nav>
      </div>

      {/* ============ 章节阅读 (main.container) ============ */}
      <main className="container read_bg">
        {/* 章节标题 */}
        <div className="text_title">
          <h1 className="style_h1">{chapterTitle || '章节阅读'}</h1>
          <div className="text_info">
            <span>来源：{site.name}</span>
            <span>欢迎阅读{site.name}</span>
          </div>
        </div>

        {/* 正文 + 字号控制 */}
        <div className="text">
          <div className="fontsize">
            <button title="小字号" onClick={() => setSizeIdx(0)}>A</button>
            <button title="中字号" onClick={() => setSizeIdx(1)}>A</button>
            <button title="大字号" onClick={() => setSizeIdx(2)}>A</button>
            <span style={{ marginLeft: 12, alignSelf: 'center', color: '#666', fontSize: 14 }}>字号: {fontSize}px</span>
          </div>
          <div id="article" style={{ fontSize, lineHeight: 1.8 }}>
            {children || <p style={{ textAlign: 'center', color: '#999' }}>本章内容加载中...</p>}
          </div>
        </div>

        {/* 翻页 .read_nav (3 列: 上一章/目录/下一章) */}
        <div className="read_nav">
          <a href="javascript:;" title="上一章" onClick={(e) => { e.preventDefault(); if (onPrev) onPrev() }}>上一章</a>
          <a href="javascript:;" title="回顶部" onClick={(e) => { e.preventDefault(); goTop() }}>目录</a>
          <a href="javascript:;" title="下一章" onClick={(e) => { e.preventDefault(); if (onNext) onNext() }}>下一章</a>
        </div>
      </main>

      {/* ============ 友情链接 ============ */}
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
