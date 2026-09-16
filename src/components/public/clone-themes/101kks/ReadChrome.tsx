<<<<<<< HEAD
// ============================================================
// clone-themes/101kks ReadChrome — 101看書章节页外壳 1:1 克隆
// 实测 probe-html2/probe-101kks-chapter.html (cdnshu 模板):
//   header (headbox) + .main #content + footer
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif'
const INK = '#333333'
const MUTED = '#7f8c8d'
const PRIMARY = '#667eea'
const HEADER_BG = '#fff2df'
const BORDER = 'rgba(0,0,0,0.08)'
const RADIUS = '10px'

const NAV_ITEMS = ['首頁', '排行榜', '完本小說', '小說分類', '我的書架', '閱讀記錄']

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: '#f2f3f4' }}>
      <header style={{ background: HEADER_BG, padding: '12px 14px' }}>
        <div style={{ maxWidth: '1250px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: PRIMARY, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>101看書</a>
          <div style={{ flex: 1, minWidth: '260px', display: 'flex' }}>
            <input type="text" placeholder="請輸入書名或作者" style={{ flex: 1, height: '40px', padding: '0 12px', border: 'none', borderRadius: '8px', fontSize: '14px' }} />
            <button style={{ background: PRIMARY, color: '#fff', border: 'none', padding: '0 18px', fontSize: '14px', cursor: 'pointer', borderRadius: '8px' }}>搜索</button>
          </div>
        </div>
        <div style={{ maxWidth: '1250px', margin: '8px auto 0' }}>
          <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', listStyle: 'none', margin: 0, padding: 0 }}>
            {NAV_ITEMS.map((n, i) => (
              <li key={n}><a href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: i === 0 ? PRIMARY : '#666', fontSize: '14px', textDecoration: 'none', fontWeight: i === 0 ? 700 : 400 }}>{n}</a></li>
            ))}
          </ul>
        </div>
      </header>
      <main style={{ maxWidth: '900px', margin: '14px auto', padding: '0 14px' }}>
        <div style={{ background: '#fff', borderRadius: RADIUS, padding: '24px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', border: `1px solid ${BORDER}` }}>
          <h1 style={{ textAlign: 'center', fontSize: '24px', fontWeight: 700, margin: '0 0 20px', color: INK }}>{chapterTitle}</h1>
          {children}
          <div style={{ marginTop: '24px', paddingTop: '14px', borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'center', gap: '12px' }}>
            {onPrev && <a href="javascript:;" onClick={onPrev} style={{ padding: '6px 14px', background: PRIMARY, color: '#fff', textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px' }}>{prevLabel}</a>}
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, color: INK, textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px' }}>返回首頁</a>
            {onNext && <a href="javascript:;" onClick={onNext} style={{ padding: '6px 14px', background: PRIMARY, color: '#fff', textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px' }}>{nextLabel}</a>}
          </div>
        </div>
      </main>
      <footer style={{ padding: '20px 14px', textAlign: 'center', color: MUTED, fontSize: '13px' }}>
        Copyright © 101看書 All Rights Reserved
      </footer>
=======
'use client'
// 101kks.com (101看書) 章节阅读页 1:1 克隆 — cdnshu 模板 (繁體)
// 源站 DOM: #content (正文区), 源站章节字号 18pt 行高 2
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  return (
    <div style={{ background: '#f2f3f4', color: '#333', fontFamily: '"Microsoft YaHei", sans-serif', fontSize: 14, minHeight: '100%' }}>
      <div className="main">
        <div className="container" style={{ maxWidth: 900, margin: '90px auto 16px', padding: '0 15px', boxSizing: 'border-box' }}>
          <div className="mybox" style={{ background: '#fff', borderRadius: 3, padding: '24px 32px', boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)' }}>
            {/* 面包屑 */}
            <div className="con_top" style={{ borderBottom: '1px dashed #eee', paddingBottom: 12, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: '#888' }}>
              <div>
                <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#1f6cb2', textDecoration: 'none' }}>{site.name}</a>
                <span style={{ margin: '0 6px' }}>&gt;</span>
                <span>線上閱讀</span>
              </div>
              <span style={{ color: '#888' }}>返回書頁</span>
            </div>

            {/* 章节标题 */}
            {chapterTitle && (
              <h1 className="bookname" style={{ fontSize: 24, fontWeight: 700, color: '#333', textAlign: 'center', margin: '0 0 24px', padding: '12px 0', borderBottom: '1px dashed #eee' }}>
                {chapterTitle}
              </h1>
            )}

            {/* 正文 */}
            <div id="content" style={{ fontSize: 18, lineHeight: 2, color: '#333', padding: '12px 0', textIndent: '2em' }}>
              {children}
            </div>

            {/* 翻页 */}
            {(onPrev || onNext) && (
              <div className="bottem2" style={{ borderTop: '1px dashed #eee', clear: 'both', textAlign: 'center', margin: '20px auto 0', padding: '16px 0', display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
                {onPrev && (
                  <button onClick={onPrev} style={{ padding: '8px 24px', border: '1px solid #1f6cb2', borderRadius: 4, background: '#fff', color: '#1f6cb2', fontSize: 14, cursor: 'pointer' }}>
                    {prevLabel}
                  </button>
                )}
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}
                  style={{ padding: '8px 24px', border: '1px solid #ddd', borderRadius: 4, background: '#fff', color: '#666', fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                >
                  返回首頁
                </a>
                {onNext && (
                  <button onClick={onNext} style={{ padding: '8px 24px', border: '1px solid #1f6cb2', borderRadius: 4, background: '#1f6cb2', color: '#fff', fontSize: 14, cursor: 'pointer' }}>
                    {nextLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
    </div>
  )
}
