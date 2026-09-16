// ============================================================
// clone-themes/ddyueshu ReadChrome — 得得小说章节页外壳 1:1 克隆
// 实测 biquge.css .content_read 模板:
//   .content_read { overflow:hidden; width:980px; margin:2px auto; }
//   .box_con { border:2px solid #88C6E5; overflow:hidden; width:976px; }
//   .con_top { border-bottom:#88C6E5 1px solid; padding:0 10px; line-height:40px; height:40px; background:#E1ECED; }
//   #content { font-size:19pt; letter-spacing:0.2em; line-height:150%; width:85%; margin:auto; }
//   .bookname { border-bottom:1px dashed #88C6E5; line-height:30px; padding:10px; }
//   .bookname h1 { font:25px/35px 宋体; text-align:center; }
//   .bottem2 { border-top:1px dashed #88C6E5; clear:both; text-align:center; padding:15px; }
//   .bottem2 a { color:#085308; font-size:14px; margin:0 10px; }
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '"宋体", "SimSun", "Microsoft YaHei", Arial, sans-serif'
const INK = '#555555'
const LINK = '#6F78A7'
const NAV_BG = '#88C6E5'
const HEAD_H2 = '#E1ECED'
const BORDER_NEWS = '#88C6E5'

const NAV_ITEMS = ['首页', '我的书架', '玄幻小说', '修真小说', '都市小说', '穿越小说', '网游小说', '科幻小说', '排行榜', '小说大全']

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: '#E9FAFF' }}>
      <div style={{ height: '61px', width: '100%', maxWidth: '980px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '30px', padding: '0 10px' }}>
        <div style={{ flexShrink: 0 }}>
          <a href="/" style={{ color: NAV_BG, fontSize: '24px', fontWeight: 700, textDecoration: 'none' }}>得得小说</a>
        </div>
      </div>
      <div className="nav" style={{ background: NAV_BG, height: '40px', width: '100%', maxWidth: '980px', margin: '10px auto 0', overflow: 'hidden' }}>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {NAV_ITEMS.map((n) => (
            <li key={n} style={{ float: 'left', lineHeight: '44px' }}>
              <a href="javascript:;" onClick={() => n === '首页' && navigate({ view: 'home' })} style={{ color: '#FFF', fontSize: '15px', fontWeight: 700, padding: '0 14px', textDecoration: 'none' }}>{n}</a>
            </li>
          ))}
        </ul>
      </div>
      <div className="content_read" style={{ overflow: 'hidden', width: '100%', maxWidth: '980px', margin: '12px auto' }}>
        <div className="box_con" style={{ border: `2px solid ${BORDER_NEWS}`, overflow: 'hidden', background: '#fff', padding: '0 0 10px' }}>
          <div className="con_top" style={{ borderBottom: `1px solid ${BORDER_NEWS}`, padding: '0 10px', lineHeight: '40px', height: '40px', background: HEAD_H2, fontSize: '12px' }}>
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ color: LINK, textDecoration: 'none' }}>返回首页</a>
            {' > '}
            <a href="javascript:;" style={{ color: LINK, textDecoration: 'none' }}>{chapterTitle || '章节阅读'}</a>
          </div>
          <div className="bookname" style={{ borderBottom: '1px dashed #88C6E5', lineHeight: '30px', padding: '10px 0', textAlign: 'center' }}>
            <h1 style={{ font: '25px/35px "宋体"', textAlign: 'center', margin: 0, color: INK }}>{chapterTitle}</h1>
          </div>
          {children}
          <div className="bottem2" style={{ borderTop: '1px dashed #88C6E5', clear: 'both', textAlign: 'center', padding: '15px' }}>
            {onPrev && <a href="javascript:;" onClick={onPrev} style={{ color: '#085308', fontSize: '14px', margin: '0 10px', textDecoration: 'none' }}>{prevLabel}</a>}
            <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ color: '#085308', fontSize: '14px', margin: '0 10px', textDecoration: 'none' }}>返回首页</a>
            {onNext && <a href="javascript:;" onClick={onNext} style={{ color: '#085308', fontSize: '14px', margin: '0 10px', textDecoration: 'none' }}>{nextLabel}</a>}
          </div>
        </div>
      </div>
    </div>
  )
}
