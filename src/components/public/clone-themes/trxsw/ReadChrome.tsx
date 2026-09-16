<<<<<<< HEAD
// ============================================================
// clone-themes/trxsw ReadChrome — 天人小说章节页外壳 1:1 克隆
// 域名已过期但规则保留, 通过 GitHub mason173/aira-browser 反查真实 DOM:
//   chapterTitleSelector: 'h1.headline' / contentSelector: '.content' / .pager 翻页
// 硬编码源站实际 CSS 变量值 (themes.ts vars):
//   bg #f5f7fa / surface #fff / text #333 / textMuted #888
//   primary #2c7be5 (深蓝) / accent #1a5fb4 / border #e0e6ed / radius 4px
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '"Microsoft YaHei", Arial, sans-serif'
const BG = '#f5f7fa'
const SURFACE = '#ffffff'
const SURFACE_ALT = '#eef2f7'
const INK = '#333333'
const MUTED = '#888888'
const PRIMARY = '#2c7be5'
const PRIMARY_TEXT = '#ffffff'
const BORDER = '#e0e6ed'
const RADIUS = '4px'
const SHADOW = '0 1px 3px rgba(0,0,0,0.05)'

const NAV_ITEMS = ['首页', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生']

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: BG }}>
      <header style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: PRIMARY, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>天人小说</a>
          <form style={{ flex: 1, display: 'flex', minWidth: '240px' }} onSubmit={(e) => e.preventDefault()}>
            <input type="text" placeholder="搜索书名 / 作者…" style={{ flex: 1, height: '34px', padding: '0 12px', border: `1px solid ${BORDER}`, borderRight: 'none', fontSize: '13px', outline: 'none' }} />
            <button type="submit" style={{ background: PRIMARY, color: PRIMARY_TEXT, border: 'none', padding: '0 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>搜索</button>
          </form>
        </div>
      </header>
      <div style={{ background: SURFACE_ALT, borderTop: `2px solid ${PRIMARY}` }}>
        <nav style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexWrap: 'wrap' }}>
          {NAV_ITEMS.map((n, i) => (
            <a key={n} href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: i === 0 ? PRIMARY : INK, fontWeight: i === 0 ? 700 : 400, padding: '10px 16px', fontSize: '14px', textDecoration: 'none', borderRight: `1px solid ${BORDER}` }}>{n}</a>
          ))}
        </nav>
      </div>
      <div style={{ maxWidth: '900px', margin: '14px auto', padding: '0 14px' }}>
        <div style={{ background: SURFACE, padding: '24px', border: `1px solid ${BORDER}`, borderRadius: RADIUS, boxShadow: SHADOW }}>
          <h1 className="headline" style={{ textAlign: 'center', fontSize: '22px', fontWeight: 700, margin: '0 0 20px', color: INK }}>{chapterTitle}</h1>
          <div className="content">{children}</div>
          <div className="pager" style={{ marginTop: '24px', paddingTop: '14px', borderTop: `1px dashed ${BORDER}`, textAlign: 'center' }}>
            {onPrev && <a href="javascript:;" onClick={onPrev} style={{ padding: '6px 14px', background: PRIMARY, color: PRIMARY_TEXT, textDecoration: 'none', fontSize: '14px', margin: '0 6px', borderRadius: RADIUS }}>{prevLabel}</a>}
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, color: INK, textDecoration: 'none', fontSize: '14px', margin: '0 6px', borderRadius: RADIUS }}>返回首页</a>
            {onNext && <a href="javascript:;" onClick={onNext} style={{ padding: '6px 14px', background: PRIMARY, color: PRIMARY_TEXT, textDecoration: 'none', fontSize: '14px', margin: '0 6px', borderRadius: RADIUS }}>{nextLabel}</a>}
          </div>
        </div>
      </div>
      <footer style={{ maxWidth: '1080px', margin: '20px auto 0', padding: '14px', textAlign: 'center', fontSize: '12px', color: MUTED, borderTop: `1px solid ${BORDER}` }}>
        <p style={{ margin: 0, fontWeight: 600, color: INK }}>天人小说 — 精品小说在线阅读</p>
        <p style={{ margin: '4px 0 0', opacity: 0.8 }}>trxsw.com · 本站所有内容均收集自互联网, 仅供试读</p>
=======
'use client'
// trxsw (同人小说网, 域名已过期) 章节阅读页 1:1 克隆 — 现代简洁模板
// 源站 DOM 反查: .content (正文 max-width 800px) + .pager (翻页)
// 实测 #content line-height 2 / font-size 16px / --primary #2c7be5
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  return (
    <div style={{ background: '#f5f7fa', color: '#333', fontFamily: '"Microsoft YaHei", Arial, sans-serif', fontSize: 14, lineHeight: 1.6, minHeight: '100%' }}>
      {/* 源站 .header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e0e6ed' }}>
        <div className="container" style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} className="logo" style={{ fontSize: 22, fontWeight: 700, color: '#2c7be5', textDecoration: 'none' }}>
            {site.name}
          </a>
          <nav style={{ flex: 1, display: 'flex', gap: 4, minWidth: 200, flexWrap: 'wrap' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ padding: '6px 12px', color: '#fff', background: '#2c7be5', borderRadius: 4, textDecoration: 'none', fontSize: 14 }}>首页</a>
            <a href="#" style={{ padding: '6px 12px', color: '#333', textDecoration: 'none', fontSize: 14 }}>书库</a>
          </nav>
        </div>
      </header>

      {/* 面包屑 */}
      <div className="container" style={{ maxWidth: 800, margin: '0 auto', padding: '12px 16px 0' }}>
        <div style={{ color: '#888', fontSize: 12 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2c7be5', textDecoration: 'none' }}>{site.name}</a>
          <span style={{ margin: '0 6px' }}>/</span>
          <span>在线阅读</span>
        </div>
      </div>

      {/* 源站 .content — 正文区 max-width 800px */}
      <div className="content" style={{ maxWidth: 800, margin: '0 auto', padding: 20, lineHeight: 2, fontSize: 16, color: '#333' }}>
        <div style={{ background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4, padding: '24px 32px' }}>
          {/* 章节标题 */}
          {chapterTitle && (
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#333', textAlign: 'center', margin: '0 0 24px', padding: '0 0 16px', borderBottom: '1px solid #e0e6ed' }}>
              {chapterTitle}
            </h1>
          )}

          {/* 正文 */}
          <div id="content" style={{ fontSize: 16, lineHeight: 2, color: '#333', textIndent: '2em' }}>
            {children}
          </div>

          {/* 翻页 .pager */}
          {(onPrev || onNext) && (
            <div className="pager" style={{ display: 'flex', gap: 10, justifyContent: 'center', padding: '20px 0', marginTop: 24, borderTop: '1px solid #e0e6ed' }}>
              {onPrev && (
                <a href="#" onClick={(e) => { e.preventDefault(); onPrev() }} style={{ padding: '6px 16px', border: '1px solid #e0e6ed', borderRadius: 4, textDecoration: 'none', color: '#333', background: '#fff', cursor: 'pointer' }}>
                  {prevLabel}
                </a>
              )}
              <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ padding: '6px 16px', border: '1px solid #e0e6ed', borderRadius: 4, textDecoration: 'none', color: '#666', background: '#fff' }}>
                返回首页
              </a>
              {onNext && (
                <a href="#" onClick={(e) => { e.preventDefault(); onNext() }} style={{ padding: '6px 16px', border: '1px solid #2c7be5', borderRadius: 4, textDecoration: 'none', color: '#fff', background: '#2c7be5', cursor: 'pointer' }}>
                  {nextLabel}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 源站 .footer */}
      <footer style={{ background: '#fff', borderTop: '1px solid #e0e6ed', padding: '20px 16px', textAlign: 'center', color: '#888', fontSize: 12, marginTop: 24 }}>
        <p style={{ margin: 0 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2c7be5', textDecoration: 'none' }}>{site.name}</a>
          &nbsp;·&nbsp;Copyright © {new Date().getFullYear()} {site.name}({site.domain})
        </p>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
      </footer>
    </div>
  )
}
