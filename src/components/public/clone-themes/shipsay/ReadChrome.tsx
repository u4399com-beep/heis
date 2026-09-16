<<<<<<< HEAD
// ============================================================
// clone-themes/shipsay ReadChrome — 船说CMS章节页外壳 1:1 克隆
// 实测 shipsay.css: .content 正文 + .bottem1/.bottem2 翻页
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", Arial, Tahoma, Verdana, sans-serif'
const INK = '#666666'
const LINK = '#1a1a1a'
const PRIMARY = '#ed4259'
const CARD_BG = '#ffffff'
const BORDER = '#e0e0e0'
const NAV_BG = '#3e3d43'

const NAV_ITEMS = ['首页', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生', '其他']

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: '#f4f4f4' }}>
      <header style={{ background: CARD_BG, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: '960px', margin: '0 auto', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: PRIMARY, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>船说CMS</a>
          <form style={{ flex: 1, display: 'flex', minWidth: '240px' }} onSubmit={(e) => e.preventDefault()}>
            <input type="text" placeholder="搜索小说" style={{ flex: 1, height: '34px', padding: '0 12px', border: `1px solid ${BORDER}`, fontSize: '14px' }} />
            <button type="submit" style={{ background: PRIMARY, color: '#fff', border: 'none', padding: '0 14px', cursor: 'pointer', fontSize: '14px' }}>搜索</button>
          </form>
        </div>
      </header>
      <div className="navigation" style={{ background: NAV_BG }}>
        <nav style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', height: '41px' }}>
          {NAV_ITEMS.map((n, i) => (
            <a key={n} href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: '#fbfbfb', lineHeight: '41px', padding: '0 20px', fontSize: '14px', textDecoration: 'none' }}>{n}</a>
          ))}
        </nav>
      </div>
      <div style={{ maxWidth: '900px', margin: '14px auto', padding: '0 14px' }}>
        <div style={{ background: CARD_BG, padding: '24px' }}>
          <h1 style={{ textAlign: 'center', fontSize: '22px', fontWeight: 700, margin: '0 0 20px', color: LINK }}>{chapterTitle}</h1>
          {children}
          <div style={{ marginTop: '24px', paddingTop: '14px', borderTop: `1px dashed ${BORDER}`, textAlign: 'center' }}>
            {onPrev && <a href="javascript:;" onClick={onPrev} style={{ padding: '6px 14px', background: PRIMARY, color: '#fff', textDecoration: 'none', fontSize: '14px', margin: '0 6px' }}>{prevLabel}</a>}
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, color: LINK, textDecoration: 'none', fontSize: '14px', margin: '0 6px' }}>返回首页</a>
            {onNext && <a href="javascript:;" onClick={onNext} style={{ padding: '6px 14px', background: PRIMARY, color: '#fff', textDecoration: 'none', fontSize: '14px', margin: '0 6px' }}>{nextLabel}</a>}
          </div>
        </div>
      </div>
      <div id="footer" style={{ background: NAV_BG, color: '#fbfbfb', marginTop: '20px' }}>
        <footer style={{ maxWidth: '960px', margin: '0 auto', padding: '20px 14px', textAlign: 'center', fontSize: '13px' }}>
          <p style={{ margin: '0 0 6px' }}>🚩 <a href="/" style={{ color: '#fbfbfb', textDecoration: 'none' }}>船说CMS</a> 书友最值得收藏的网络小说阅读网</p>
=======
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
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
        </footer>
      </div>
    </div>
  )
}
