// ============================================================
// clone-themes/ggd66 ReadChrome — 格格党章节页外壳 1:1 克隆
// 实测 simple 模板: #content 正文
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", simsun, arial, sans-serif'
const INK = '#333333'
const LINK = '#00886d'
const HEADER_BG = '#56ccb5'
const BREADCRUMB_BG = '#cdf3eb'
const BORDER = '#cccccc'
const RADIUS = '4px'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: '#f9f9f9' }}>
      <div className="header" style={{ backgroundColor: HEADER_BG, marginBottom: '10px', width: '100%', height: '50px', boxShadow: '0 1px 1px #1abc9c', lineHeight: '50px', color: '#fff' }}>
        <div className="container" style={{ width: '90%', maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="header-left" style={{ textShadow: '1px 1px 2px #000', fontSize: '18px' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fff', textDecoration: 'none' }}>格格党</a>
          </div>
          <div className="header-right" style={{ fontSize: '15px' }}>
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ color: '#fff', textDecoration: 'none', margin: '0 8px' }}>返回首页</a>
          </div>
        </div>
      </div>
      <div className="container" style={{ width: '90%', maxWidth: '1200px', margin: '14px auto' }}>
        <div className="breadcrumb" style={{ overflow: 'hidden', margin: '0 0 10px', padding: '8px 15px', border: '1px solid #ccc', borderRadius: RADIUS, backgroundColor: BREADCRUMB_BG, listStyle: 'none', fontSize: '14px' }}>
          <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ color: LINK, textDecoration: 'none' }}>首页</a>
          {' > '}
          <span style={{ color: INK }}>{chapterTitle}</span>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: RADIUS, padding: '24px' }}>
          <h1 style={{ textAlign: 'center', fontSize: '22px', fontWeight: 700, margin: '0 0 20px', color: INK }}>{chapterTitle}</h1>
          {children}
          <div style={{ marginTop: '24px', paddingTop: '14px', borderTop: `1px dashed ${BORDER}`, textAlign: 'center' }}>
            {onPrev && <a href="javascript:;" onClick={onPrev} style={{ padding: '6px 14px', background: LINK, color: '#fff', textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px', margin: '0 6px' }}>{prevLabel}</a>}
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ padding: '6px 14px', border: `1px solid ${BORDER}`, color: INK, textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px', margin: '0 6px' }}>返回首页</a>
            {onNext && <a href="javascript:;" onClick={onNext} style={{ padding: '6px 14px', background: LINK, color: '#fff', textDecoration: 'none', borderRadius: RADIUS, fontSize: '14px', margin: '0 6px' }}>{nextLabel}</a>}
          </div>
        </div>
      </div>
      <div className="footer" style={{ padding: '10px 0', backgroundColor: HEADER_BG, boxShadow: '0 -1px 1px #56ccb5', color: '#fff', textAlign: 'center', fontSize: '14px', marginTop: '20px' }}>
        <div className="container" style={{ width: '90%', maxWidth: '1200px', margin: '0 auto' }}>
          <p style={{ margin: '5px 0' }}>格格党 - 无弹窗小说阅读网</p>
          <p style={{ margin: '5px 0' }}>Copyright © ggd66.com All Rights Reserved</p>
        </div>
      </div>
    </div>
  )
}
