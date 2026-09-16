'use client'
// shipsay (船说CMS) 章节阅读页 1:1 克隆 — static/shipsay 模板
// 源站 DOM: main.container > .text_title(.style_h1 + .text_info) + .text(#article) + .read_nav(返回目录/上一章/下一章)
// 实测 #article 字号 18px 行高 1.8em / .read_nav bg #FBF6EC / .read_nav 高 60px
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  return (
    <div className="read_bg" style={{ background: '#e7e1d4', color: '#262626', fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 14, lineHeight: 1.5, minHeight: '100%' }}>
      <main className="container" style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexWrap: 'wrap' }}>
        {/* 源站 .text_title — 章节标题 + meta */}
        <div className="text_title" style={{ padding: '40px 64px 10px', width: '100%' }}>
          <h1 className="style_h1" style={{ fontWeight: 700, fontSize: 24, color: '#555', textAlign: 'justify', margin: '0 60px 10px 0' }}>
            {chapterTitle || '正在阅读'}
          </h1>
          <div className="text_info" style={{ color: 'gray', fontSize: 14 }}>
            <span style={{ display: 'inline-block', margin: '0 15px 5px 0' }}>
              来自：<a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: 'gray', textDecoration: 'none' }}>{site.name}</a>
            </span>
            <span style={{ display: 'inline-block', margin: '0 15px 5px 0' }}>来源：{site.domain}</span>
          </div>
        </div>

        {/* 源站 #article — 正文区 */}
        <div className="text" style={{ position: 'relative', width: '100%' }}>
          <div id="article" style={{ padding: '0 64px 20px', fontSize: 18, color: '#262626', minHeight: 200 }}>
            {children}
          </div>
        </div>

        {/* 源站 .read_nav — 翻页区 */}
        {(onPrev || onNext) && (
          <div className="read_nav" style={{ height: 60, boxShadow: '0 0 10px rgba(0, 0, 0, 0.3)', background: '#FBF6EC', marginTop: 10, width: '100%', display: 'flex', lineHeight: '60px' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ textAlign: 'center', width: '33.33%', fontSize: 18, color: '#1a1a1a', textDecoration: 'none' }}>
              目录
            </a>
            {onPrev && (
              <a href="#" onClick={(e) => { e.preventDefault(); onPrev() }} style={{ textAlign: 'center', width: '34%', borderLeft: '1px solid #ddd', borderRight: '1px solid #ddd', fontSize: 18, color: '#1a1a1a', textDecoration: 'none' }}>
                {prevLabel}
              </a>
            )}
            {onNext ? (
              <a href="#" onClick={(e) => { e.preventDefault(); onNext() }} style={{ textAlign: 'center', width: '33.33%', fontSize: 18, color: '#1a1a1a', textDecoration: 'none' }}>
                {nextLabel}
              </a>
            ) : (
              <a href="#" style={{ textAlign: 'center', width: '33.33%', fontSize: 18, color: '#888', textDecoration: 'none' }}>无</a>
            )}
          </div>
        )}
      </main>

      {/* 源站 #footer */}
      <div id="footer" style={{ background: '#3e3d43', marginTop: 24 }}>
        <footer className="container" style={{ maxWidth: 900, margin: '0 auto', color: '#fbfbfb', padding: '15px 0', flexFlow: 'column wrap', alignItems: 'center', fontSize: 12, lineHeight: 1.5, textAlign: 'center' }}>
          <p style={{ margin: 0, color: '#fbfbfb' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fbfbfb', textDecoration: 'none' }}>{site.name}</a>
            &nbsp;书友最值得收藏的网络小说阅读网
          </p>
          <p style={{ margin: '4px 0 0', color: '#fbfbfb' }}>Copyright © {new Date().getFullYear()} {site.name}({site.domain})</p>
        </footer>
      </div>
    </div>
  )
}
