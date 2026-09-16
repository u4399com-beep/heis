<<<<<<< HEAD
// ============================================================
// clone-themes/pilishuwu ReadChrome — 霹雳书屋章节页外壳 1:1 克隆
// 实测 probe-html2/probe-pilishuwu-chapter.html (wmcms-web 模板):
//   .mod-top-wr (顶 logo+nav)
//   .read-main-wr > .read-main-content (#content 正文容器)
//   .read-foot (上一章/下一章/目录/书签)
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif'
const INK = '#333333'
const PRIMARY = '#fd8929'
const BORDER = '#ffe4c4'

const NAV_ITEMS = ['首页', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生', '其他']

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: '#fdf6ec' }}>
      <div className="mod-top-wr" style={{ background: '#fff', borderBottom: `2px solid ${PRIMARY}` }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '14px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <a href="/" style={{ color: PRIMARY, fontSize: '24px', fontWeight: 700, textDecoration: 'none' }}>霹雳书屋</a>
          <div style={{ flex: 1, minWidth: '280px', display: 'flex' }}>
            <input type="text" placeholder="可搜索小说名/作者名" style={{ flex: 1, height: '40px', padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: '2px 0 0 2px', fontSize: '14px' }} />
            <button type="submit" style={{ background: PRIMARY, color: '#fff', border: 'none', padding: '0 18px', fontSize: '14px', cursor: 'pointer', borderRadius: '0 2px 2px 0' }}>搜索</button>
          </div>
        </div>
        <div style={{ background: PRIMARY }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 14px', display: 'flex', alignItems: 'center', height: '40px' }}>
            <ul style={{ display: 'flex', gap: '20px', listStyle: 'none', margin: 0, padding: 0 }}>
              {NAV_ITEMS.map((n, i) => (
                <li key={n}><a href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: i === 0 ? '#fff' : 'rgba(255,255,255,0.85)', fontWeight: i === 0 ? 700 : 400, fontSize: '14px', textDecoration: 'none' }}>{n}</a></li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '14px auto', padding: '0 14px' }}>
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: '2px', padding: '14px' }}>
          <h1 style={{ textAlign: 'center', fontSize: '24px', fontWeight: 700, margin: '0 0 14px', color: INK }}>{chapterTitle}</h1>
          {children}
          <div style={{ marginTop: '24px', paddingTop: '14px', borderTop: `1px dashed ${BORDER}`, display: 'flex', justifyContent: 'center', gap: '12px' }}>
            {onPrev && <a href="javascript:;" onClick={onPrev} style={{ padding: '6px 14px', background: PRIMARY, color: '#fff', textDecoration: 'none', borderRadius: '2px', fontSize: '14px' }}>{prevLabel}</a>}
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, color: INK, textDecoration: 'none', borderRadius: '2px', fontSize: '14px' }}>返回首页</a>
            {onNext && <a href="javascript:;" onClick={onNext} style={{ padding: '6px 14px', background: PRIMARY, color: '#fff', textDecoration: 'none', borderRadius: '2px', fontSize: '14px' }}>{nextLabel}</a>}
          </div>
=======
'use client'
// pilishuwu.com 章节阅读页 1:1 克隆 — wmcms-web .read 模板
// 源站 DOM: .read .con_top + .bookname + #content + .bottem2
// 实测 #content 字号 14pt 行高 1.85
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  return (
    <div className="wmcms-web" style={{ minWidth: 1200, maxWidth: '100%', background: '#fafafa', color: '#333', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12, lineHeight: 1.5 }}>
      <div className="ui-wm" style={{ width: 1000, maxWidth: '100%', margin: '0 auto', padding: '16px', boxSizing: 'border-box' }}>
        <div style={{ background: '#fff', border: '1px solid #dcd8d4', borderRadius: 4, padding: '24px 32px' }}>
          {/* 面包屑 + 站点链接 */}
          <div className="con_top" style={{ borderBottom: '1px dashed #dcd8d4', paddingBottom: 12, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: '#999' }}>
            <div>
              <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fa8729', textDecoration: 'none' }}>{site.name}</a>
              <span style={{ margin: '0 6px' }}>&gt;</span>
              <span>在线阅读</span>
            </div>
            <span style={{ color: '#999' }}>返回书页</span>
          </div>

          {/* 章节标题 */}
          {chapterTitle && (
            <h1 className="bookname" style={{ fontSize: 24, fontWeight: 700, color: '#333', textAlign: 'center', margin: '0 0 20px', padding: '12px 0', borderBottom: '1px solid #dcd8d4' }}>
              {chapterTitle}
            </h1>
          )}

          {/* 正文 */}
          <div id="content" style={{ fontSize: 14, lineHeight: 1.85, color: '#1f2937', padding: '12px 0', textIndent: '2em' }}>
            {children}
          </div>

          {/* 翻页 */}
          {(onPrev || onNext) && (
            <div className="bottem2" style={{ borderTop: '1px dashed #dcd8d4', clear: 'both', textAlign: 'center', margin: '20px auto 0', padding: '16px 0', display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              {onPrev && (
                <button onClick={onPrev} style={{ padding: '8px 24px', border: '1px solid #f1854b', borderRadius: 4, background: '#fff', color: '#fa8729', fontSize: 14, cursor: 'pointer' }}>
                  {prevLabel}
                </button>
              )}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}
                style={{ padding: '8px 24px', border: '1px solid #dcd8d4', borderRadius: 4, background: '#fff', color: '#666', fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                返回首页
              </a>
              {onNext && (
                <button onClick={onNext} style={{ padding: '8px 24px', border: '1px solid #f1854b', borderRadius: 4, background: '#f1854b', color: '#fff', fontSize: 14, cursor: 'pointer' }}>
                  {nextLabel}
                </button>
              )}
            </div>
          )}
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
        </div>
      </div>
    </div>
  )
}
