<<<<<<< HEAD
// ============================================================
// clone-themes/huangjinwu ReadChrome — 黄金屋章节页外壳 1:1 克隆
// 实测 huangjinwu default 模板: #content 正文容器
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
const INK = '#1e293b'
const MUTED = '#64748b'
const PRIMARY = '#2563eb'
const LOGO = '#1d4ed8'
const BORDER = '#dbe4f0'
const CARD_BG = '#fff'
const HEADER_BG = 'rgba(255,255,255,0.92)'
const FOOTER_BG = '#e2eaf5'
const RADIUS = '6px'
const RADIUS_LG = '10px'

const NAV_ITEMS = ['首页', '排行榜', '书库', '标签', '作者', '电子书', '搜索']

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: 'linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%)' }}>
      <div className="header-group" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="headers" style={{ backdropFilter: 'saturate(1.2) blur(12px)', background: HEADER_BG, borderBottom: `1px solid ${BORDER}` }}>
          <div className="container" style={{ maxWidth: '1180px', margin: '0 auto', padding: '12px 16px' }}>
            <div className="navbar" style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} className="logo" style={{ color: LOGO, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>
                <span style={{ marginRight: '6px' }}>📚</span>黄金屋
              </a>
              <ul className="navbar-menu" style={{ display: 'flex', gap: '6px', listStyle: 'none', margin: 0, padding: 0, flex: 1, minWidth: 0 }}>
                {NAV_ITEMS.map((n, i) => (
                  <li key={n}>
                    <a href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: i === 0 ? '#fff' : INK, padding: '8px 14px', borderRadius: RADIUS_LG, fontSize: '14px', textDecoration: 'none', display: 'inline-block', background: i === 0 ? PRIMARY : 'transparent', fontWeight: i === 0 ? 600 : 400 }}>{n}</a>
                  </li>
                ))}
              </ul>
              <form className="navbar-search" style={{ display: 'flex', minWidth: '240px' }} onSubmit={(e) => e.preventDefault()}>
                <input type="text" placeholder="可搜书名、作者、角色" style={{ flex: 1, height: '38px', padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: RADIUS, fontSize: '14px' }} />
                <button type="submit" style={{ background: PRIMARY, color: '#fff', border: 'none', padding: '0 14px', cursor: 'pointer', borderRadius: RADIUS }}>搜索</button>
              </form>
            </div>
          </div>
        </div>
      </div>
      <main style={{ maxWidth: '900px', margin: '14px auto', padding: '0 16px' }}>
        <div style={{ background: CARD_BG, borderRadius: RADIUS_LG, padding: '28px', border: `1px solid ${BORDER}` }}>
          <h1 style={{ textAlign: 'center', fontSize: '24px', fontWeight: 700, margin: '0 0 24px', color: INK }}>{chapterTitle}</h1>
          {children}
          <div style={{ marginTop: '28px', paddingTop: '14px', borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'center', gap: '12px' }}>
            {onPrev && <a href="javascript:;" onClick={onPrev} style={{ padding: '8px 16px', background: PRIMARY, color: '#fff', textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px' }}>{prevLabel}</a>}
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ padding: '8px 16px', border: `1px solid ${BORDER}`, color: INK, textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px' }}>返回首页</a>
            {onNext && <a href="javascript:;" onClick={onNext} style={{ padding: '8px 16px', background: PRIMARY, color: '#fff', textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px' }}>{nextLabel}</a>}
          </div>
        </div>
      </main>
      <footer style={{ background: FOOTER_BG, padding: '20px 14px', textAlign: 'center', color: MUTED, fontSize: '13px' }}>
        <p style={{ margin: '0 0 6px' }}>书中自有颜如玉，书中自有黄金屋</p>
        <p style={{ margin: 0, color: '#94a3b8' }}>Copyright © 黄金屋 huangjinwu.org All Rights Reserved</p>
      </footer>
=======
'use client'
// huangjinwu.org (黄金屋) 章节阅读页 1:1 克隆 — default 模板
// 源站 DOM: #content (正文区)
// 实测 --reader-text #1e293b / --reader-bg #f8fafc / --reader-border #d8e3f0
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  return (
    <div style={{ background: '#f8fafc', color: '#1e293b', fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 16, minHeight: '100%' }}>
      <div className="container" style={{ maxWidth: 800, margin: '0 auto', padding: '32px 16px' }}>
        <div style={{ background: '#fff', border: '1px solid #d8e3f0', borderRadius: 10, padding: '32px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)' }}>
          {/* 面包屑 */}
          <div className="con_top" style={{ borderBottom: '1px solid #d8e3f0', paddingBottom: 16, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, color: '#64748b' }}>
            <div>
              <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#1d4ed8', textDecoration: 'none' }}>{site.name}</a>
              <span style={{ margin: '0 6px' }}>/</span>
              <span>在线阅读</span>
            </div>
            <span style={{ color: '#64748b' }}>返回书页</span>
          </div>

          {/* 章节标题 */}
          {chapterTitle && (
            <h1 style={{ fontSize: 26, fontWeight: 600, color: '#1e293b', textAlign: 'center', margin: '0 0 32px', padding: '12px 0', borderBottom: '1px solid #d8e3f0', letterSpacing: '-0.01em' }}>
              {chapterTitle}
            </h1>
          )}

          {/* 正文 */}
          <div id="content" style={{ fontSize: 17, lineHeight: 1.85, color: '#1e293b', padding: '12px 0', textIndent: '2em' }}>
            {children}
          </div>

          {/* 翻页 */}
          {(onPrev || onNext) && (
            <div className="bottem2" style={{ borderTop: '1px solid #d8e3f0', clear: 'both', textAlign: 'center', margin: '32px auto 0', padding: '16px 0', display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              {onPrev && (
                <button onClick={onPrev} style={{ padding: '10px 28px', border: '1px solid #dbe4f0', borderRadius: 10, background: '#fff', color: '#1e293b', fontSize: 15, cursor: 'pointer' }}>
                  {prevLabel}
                </button>
              )}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}
                style={{ padding: '10px 28px', border: '1px solid #dbe4f0', borderRadius: 10, background: '#fff', color: '#64748b', fontSize: 15, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                返回首页
              </a>
              {onNext && (
                <button onClick={onNext} style={{ padding: '10px 28px', border: 'none', borderRadius: 10, background: '#2563eb', color: '#fff', fontSize: 15, cursor: 'pointer' }}>
                  {nextLabel}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
    </div>
  )
}
