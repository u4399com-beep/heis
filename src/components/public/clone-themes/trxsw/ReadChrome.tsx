'use client'
// ============================================================
// clone-trxsw ReadChrome — 1:1 精仿天人小说 trxsw.com 章节阅读页
// 参考: themes.ts AiraBrowser 反查 DOM:
//   contentSelector: '.content'             // 正文容器
//   chapterTitleSelector: 'h1.headline'      // 章节标题
//   prevSelector: '.pager a:first-of-type'  // 上一章
//   nextSelector: '.pager a:nth-of-type(3)' // 下一章 (★非翻页!)
// 复刻: .wrap > .header (简版) / .nav / .breadcrumb / .headline (章节标题) /
//   .content (正文容器, 含 .read-tools 字号控制) / .pager (上下章翻页) / .footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/trxsw.css
// ============================================================
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared'
import { cloneNavHandlers } from '../shared'
import { useEffect, useState } from 'react'

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  const [fontSize, setFontSize] = useState(16)

  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'q')
  const goRanking = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'ranking' }) }
  const goFulltext = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'fulltext' }) }
  const goHistory = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'history' }) }
  // 字号控制
  const changeSize = (delta: number) => setFontSize(s => Math.max(14, Math.min(28, s + delta)))
  // 章节切换时自动滚回顶部
  const goTop = () => { if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }
  useEffect(() => { goTop() }, [chapterTitle])

  return (
    <>
      {/* ============ 顶部 header (简版) ============ */}
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
            <a href="/top/" onClick={goRanking}>排行</a>
            <a href="/quanben/" onClick={goFulltext}>完本</a>
            <a href="/history.html" onClick={goHistory}>足迹</a>
          </div>
        </div>
      </header>

      <nav className="nav">
        <div className="nav-inner">
          <a href="/" className="nav-link" onClick={goHome}>首页</a>
          <a href="/top/" className="nav-link" onClick={goRanking}>排行榜</a>
          <a href="/quanben/" className="nav-link" onClick={goFulltext}>完本</a>
          <a href="/history.html" className="nav-link" onClick={goHistory}>阅读足迹</a>
        </div>
      </nav>

      {/* ============ 章节内容容器 ============ */}
      <div className="wrap">
        {/* 面包屑 */}
        <div className="breadcrumb">
          <a href="/" onClick={goHome}>首页</a>
          <span className="breadcrumb-sep">»</span>
          <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); goTop() }}>{site.name}</a>
          <span className="breadcrumb-sep">»</span>
          <span>{chapterTitle || '章节阅读'}</span>
        </div>

        {/* 章节标题 .headline (与 themes.ts AiraBrowser chapterTitleSelector: 'h1.headline' 一致) */}
        <h1 className="headline">
          {chapterTitle || '章节阅读'}
          <span className="headline-meta">本章内容由 {site.name} 提供 · 仅供书友免费阅读</span>
        </h1>

        {/* 字号控制条 */}
        <div className="content">
          <div className="read-tools">
            <a className="tool-btn" href="javascript:void(0)" title="减小字号" onClick={(e) => { e.preventDefault(); changeSize(-1) }}>A-</a>
            <span className="tool-info">字号: {fontSize}px</span>
            <a className="tool-btn" href="javascript:void(0)" title="增大字号" onClick={(e) => { e.preventDefault(); changeSize(1) }}>A+</a>
            <span className="tool-sep">|</span>
            {onPrev && (
              <a className="tool-btn" href="javascript:void(0)" title="上一章" onClick={(e) => { e.preventDefault(); onPrev() }}>« 上一章</a>
            )}
            <a className="tool-btn" href="javascript:void(0)" title="回顶部" onClick={(e) => { e.preventDefault(); goTop() }}>回顶部</a>
            {onNext && (
              <a className="tool-btn" href="javascript:void(0)" title="下一章" onClick={(e) => { e.preventDefault(); onNext() }}>下一章 »</a>
            )}
          </div>

          {/* 章节正文 children (包裹在 .content 容器内, 字号由 fontSize 控制) */}
          <div style={{ fontSize: `${fontSize}px`, lineHeight: 1.95 }}>
            {children || <p style={{ textAlign: 'center', color: 'var(--muted)' }}>本章内容加载中...</p>}
          </div>
        </div>

        {/* 底部上下章翻页 .pager (与 themes.ts AiraBrowser prevSelector/nextSelector 一致) */}
        <div className="pager">
          <span className="pager-total">章节导航</span>
          {onPrev ? (
            <a href="javascript:void(0)" className="pager-prev" onClick={(e) => { e.preventDefault(); onPrev() }}>« 上一章</a>
          ) : (
            <span className="pager-prev disabled">« 上一章</span>
          )}
          <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); goTop() }}>回顶部</a>
          <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>返回首页</a>
          {onNext ? (
            <a href="javascript:void(0)" className="pager-next" onClick={(e) => { e.preventDefault(); onNext() }}>下一章 »</a>
          ) : (
            <span className="pager-next disabled">下一章 »</span>
          )}
        </div>
      </div>

      {/* ============ footer ============ */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-links">
            <a href="/" onClick={goHome}>首页</a>
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
