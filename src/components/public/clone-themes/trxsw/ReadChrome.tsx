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
      </footer>
    </div>
  )
}
