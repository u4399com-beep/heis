// ============================================================
// clone-themes/23qb ReadChrome — 铅笔小说章节页外壳 1:1 克隆
// 实测 mxstatic 模板: .read-main (#content 正文)
//   header#header (logo + nav + search)
//   main#main .read-content (#content 章节正文)
//   footer#footer
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '-apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif'
const INK = '#282828'
const MUTED = '#888888'
const HOVER = '#ff2a14'
const BORDER = '#eaedf1'
const RADIUS = '5px'

const NAV_ITEMS = ['首页', '言情', '都市', '唯美', '玄幻', '武侠', '历史', '科幻', '游戏', '竞技', '悬疑', '同人', '职场', '其他']

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: '#f8f9f9' }}>
      <header style={{ background: '#fff', boxShadow: '0 7px 21px rgba(149,157,165,0.22)', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: INK, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>铅笔小说</a>
            <div style={{ flex: 1, minWidth: '260px', display: 'flex' }}>
              <input type="search" placeholder="搜索" style={{ flex: 1, height: '40px', padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: RADIUS, fontSize: '14px' }} />
              <button type="submit" style={{ background: '#fff', border: `1px solid ${BORDER}`, borderLeft: 'none', padding: '0 14px', cursor: 'pointer' }} aria-label="搜索">🔍</button>
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '0', listStyle: 'none', margin: 0, padding: 0 }}>
              {NAV_ITEMS.map((n, i) => (
                <li key={n} style={{ padding: '0 11px', fontSize: '16px', fontWeight: 700 }}>
                  <a href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: i === 0 ? HOVER : INK, textDecoration: 'none' }}>{n}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </header>
      <main style={{ maxWidth: '900px', margin: '14px auto', padding: '0 14px' }}>
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: RADIUS, padding: '24px' }}>
          <h1 style={{ textAlign: 'center', fontSize: '24px', fontWeight: 700, margin: '0 0 20px', color: INK }}>{chapterTitle}</h1>
          {children}
          <div style={{ marginTop: '24px', paddingTop: '14px', borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'center', gap: '12px' }}>
            {onPrev && <a href="javascript:;" onClick={onPrev} style={{ padding: '6px 14px', background: HOVER, color: '#fff', textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px' }}>{prevLabel}</a>}
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, color: INK, textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px' }}>返回首页</a>
            {onNext && <a href="javascript:;" onClick={onNext} style={{ padding: '6px 14px', background: HOVER, color: '#fff', textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px' }}>{nextLabel}</a>}
          </div>
        </div>
      </main>
      <footer style={{ background: '#fff', borderTop: `1px solid ${BORDER}`, padding: '20px 14px', textAlign: 'center', color: MUTED, fontSize: '13px' }}>
        铅笔小说 · 最值得书友收藏的网络小说阅读网
      </footer>
    </div>
  )
}
