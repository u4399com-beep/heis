'use client'
// ============================================================
// clone-pilishuwu ReadChrome — 章节阅读页外壳
// 参考: probe-pilishuwu-chapter.html 实为首页抓取 (源站反爬把章节页跳回首页)
//       故按 wmcms-web 章节模板 + pilishuwu.css 已有 class 名构造:
//       .mod-top-wr header (简版) / .ui-wm .read-content-wr (章节内容容器)
//       / .bookname h2 (章节标题) / #booktxt #content (正文) /
//       .bottem1 / .bottem2 (上下章翻页, 同 shipsay/ddyueshu 模板风格)
// CSS 由 CloneCSSLoader 加载 public/clone-css/pilishuwu.css
// ============================================================
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared'
import { cloneNavHandlers } from '../shared'
import { useEffect, useState } from 'react'

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  const [fontSize, setFontSize] = useState(19)

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
  // 字号控制 (A- / A+)
  const changeSize = (delta: number) => setFontSize(s => Math.max(14, Math.min(28, s + delta)))
  // 顶部跳转 (利用 history API)
  const goTop = () => { if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }

  // 章节切换时自动滚回顶部
  useEffect(() => { goTop() }, [chapterTitle])

  return (
    <>
      {/* ============ 顶部 header (简版 mod-top-wr) ============ */}
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
              <li><a className="mod-top-nav-home" href="/index.html" title="首页" onClick={goHome}><span>首页</span></a></li>
              <li><a href="/top/index.html" title="排行榜" onClick={goRanking}><span>排行榜</span></a></li>
              <li><a href="/quanben/sort/" title="全本小说" onClick={goFulltext}><span>全本小说</span></a></li>
              <li><a href="/history.html" title="阅读足迹" onClick={goHistory}><span>阅读足迹</span></a></li>
            </ul>
            <a className="mod-top-nav-user ui-right" href="#" onClick={(e) => e.preventDefault()} title="域名发布页">域名发布页</a>
          </div>
        </div>
      </div>

      {/* ============ 章节内容容器 (ui-wm read-content-wr) ============ */}
      <div className="ui-wm ui-mb20 ui-mt20 clearfix">
        <div className="works-chapter-wr works-stack ui-wm ui-mb20">
          {/* 章节标题 */}
          <div className="bookname">
            <h2 style={{ textAlign: 'center', fontSize: 24, fontWeight: 'bold', color: '#333', padding: '20px 0' }}>
              {chapterTitle || '章节阅读'}
            </h2>
          </div>

          {/* 字号控制 + 上下章翻页 */}
          <div className="bottem1" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #eee', borderTop: '1px solid #eee', marginBottom: 16, flexWrap: 'wrap' }}>
            <a href="javascript:void(0)" title="减小字号" onClick={(e) => { e.preventDefault(); changeSize(-1) }} style={{ display: 'inline-block', padding: '4px 10px', background: '#fff', border: '1px solid #ddd', color: '#666', cursor: 'pointer' }}>A-</a>
            <a href="javascript:void(0)" title="增大字号" onClick={(e) => { e.preventDefault(); changeSize(1) }} style={{ display: 'inline-block', padding: '4px 10px', background: '#fff', border: '1px solid #ddd', color: '#666', cursor: 'pointer' }}>A+</a>
            <span style={{ color: '#999', fontSize: 12 }}>字号: {fontSize}px</span>
            <span style={{ margin: '0 12px', color: '#eee' }}>|</span>
            {onPrev && (
              <a
                href="javascript:void(0)"
                title="上一章"
                onClick={(e) => { e.preventDefault(); onPrev() }}
                style={{ display: 'inline-block', padding: '4px 14px', background: '#fd8929', color: '#fff', cursor: 'pointer', textDecoration: 'none' }}
              >上一章</a>
            )}
            <a
              href="javascript:void(0)"
              title="回顶部"
              onClick={(e) => { e.preventDefault(); goTop() }}
              style={{ display: 'inline-block', padding: '4px 14px', background: '#fff', border: '1px solid #ddd', color: '#666', cursor: 'pointer', textDecoration: 'none' }}
            >回顶部</a>
            {onNext && (
              <a
                href="javascript:void(0)"
                title="下一章"
                onClick={(e) => { e.preventDefault(); onNext() }}
                style={{ display: 'inline-block', padding: '4px 14px', background: '#fd8929', color: '#fff', cursor: 'pointer', textDecoration: 'none' }}
              >下一章</a>
            )}
          </div>

          {/* 章节正文 (children) */}
          <div
            id="booktxt"
            className="read-content-wr"
            style={{ background: '#fff', padding: '24px 32px', margin: '0 auto', maxWidth: 900 }}
          >
            <div
              id="content"
              className="read-content"
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: 1.9,
                color: '#333',
                wordBreak: 'break-word',
                textAlign: 'justify',
                textIndent: '2em',
              }}
            >
              {children || <p style={{ textAlign: 'center', color: '#999' }}>本章内容加载中...</p>}
            </div>
          </div>

          {/* 底部上下章翻页 */}
          <div className="bottem2" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '20px 0', borderTop: '1px solid #eee', marginTop: 16, flexWrap: 'wrap' }}>
            {onPrev && (
              <a
                href="javascript:void(0)"
                title="上一章"
                onClick={(e) => { e.preventDefault(); onPrev() }}
                style={{ display: 'inline-block', padding: '6px 24px', background: '#fd8929', color: '#fff', cursor: 'pointer', textDecoration: 'none' }}
              >« 上一章</a>
            )}
            <a
              href="javascript:void(0)"
              title="回顶部"
              onClick={(e) => { e.preventDefault(); goTop() }}
              style={{ display: 'inline-block', padding: '6px 24px', background: '#fff', border: '1px solid #ddd', color: '#666', cursor: 'pointer', textDecoration: 'none' }}
            >返回顶部</a>
            {onNext && (
              <a
                href="javascript:void(0)"
                title="下一章"
                onClick={(e) => { e.preventDefault(); onNext() }}
                style={{ display: 'inline-block', padding: '6px 24px', background: '#fd8929', color: '#fff', cursor: 'pointer', textDecoration: 'none' }}
              >下一章 »</a>
            )}
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
            <li><a href="/top/index.html" onClick={goRanking}>排行榜</a></li>
            <li><a href="/quanben/sort/" onClick={goFulltext}>全本小说</a></li>
            <li><a href="/history.html" onClick={goHistory}>阅读足迹</a></li>
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
            </div>
          </div>
        </div>
        <div className="mod-footer-border"></div>
      </div>
    </>
  )
}
