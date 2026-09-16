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
        </div>
      </div>
    </div>
  )
}
