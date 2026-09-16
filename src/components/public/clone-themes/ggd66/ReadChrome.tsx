'use client'
// ggd66 (格格党) 章节阅读页 1:1 克隆 — static/simple 模板
// 源站 DOM: .container > .content(.content-left h1.bookname + #content + .bottem2 上一章/下一章)
// 实测 #content 字号 16px 行高 2
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  return (
    <div style={{ background: '#f9f9f9', color: '#888', fontFamily: '"微软雅黑", Microsoft Yahei, simsun, arial, sans-serif', fontSize: 15, lineHeight: 1.5, minHeight: '100%' }}>
      {/* 源站 .header */}
      <div className="header" style={{ backgroundColor: '#1abc9c', marginBottom: 10, width: '100%', boxShadow: '0 1px 1px #1abc9c', lineHeight: '50px' }}>
        <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
          <div className="header-left" style={{ marginRight: 20, textAlign: 'left', textShadow: '1px 1px 2px #000', fontSize: 18, color: '#fff' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} title={site.name} className="logo" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700 }}>{site.name}</a>
          </div>
          <div className="header-right" style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 15, color: '#fff' }}>
            <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 4px' }}>阅读历史</a>
            <span style={{ opacity: 0.6 }}>|</span>
            <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 4px' }}>登录</a>
            <span style={{ opacity: 0.6 }}>|</span>
            <a href="#" style={{ color: '#fff', textDecoration: 'none', margin: '0 4px' }}>注册</a>
          </div>
          <div className="clear" style={{ clear: 'both' }} />
        </div>
      </div>

      <div className="container" style={{ width: '90%', maxWidth: 1200, margin: '0 auto' }}>
        <div className="content" style={{ clear: 'both', margin: '10px 0' }}>
          <div className="content-left" style={{ float: 'left', width: '73%' }}>
            {/* 章节标题 */}
            {chapterTitle && (
              <h1 style={{ margin: 0, padding: '10px 12px', borderBottom: '1px solid #ccc', color: '#333', fontWeight: 500, fontSize: 22, lineHeight: 1.6, textAlign: 'center', background: '#fff' }}>
                {chapterTitle}
              </h1>
            )}

            {/* 源站 #content — 正文区 */}
            <div id="content" style={{ background: '#fff', padding: '20px 16px', fontSize: 16, lineHeight: 2, color: '#333', textIndent: '2em', minHeight: 400 }}>
              {children}
            </div>

            {/* 源站 .bottem2 — 翻页区 */}
            {(onPrev || onNext) && (
              <div className="bottem2" style={{ clear: 'both', textAlign: 'center', margin: '12px 0', padding: 12, background: '#fff', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
                {onPrev && (
                  <button onClick={onPrev} style={{ border: '1px solid #56ccb5', background: '#fff', color: '#00886d', fontSize: 14, padding: '6px 20px', margin: '0 6px', cursor: 'pointer', borderRadius: 4 }}>
                    {prevLabel}
                  </button>
                )}
                <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#00886d', fontSize: 14, padding: '6px 20px', margin: '0 6px', textDecoration: 'none', border: '1px solid #eee', borderRadius: 4 }}>
                  返回首页
                </a>
                {onNext && (
                  <button onClick={onNext} style={{ border: '1px solid #1abc9c', background: '#1abc9c', color: '#fff', fontSize: 14, padding: '6px 20px', margin: '0 6px', cursor: 'pointer', borderRadius: 4 }}>
                    {nextLabel}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="clear" style={{ clear: 'both' }} />
        </div>
      </div>

      {/* 源站 .footer */}
      <div className="footer" style={{ padding: '10px 0', backgroundColor: '#56ccb5', boxShadow: '0 -1px 1px #56ccb5', color: '#fff', textAlign: 'center', fontSize: 14 }}>
        <p style={{ margin: 0, padding: 0, color: '#fff' }}>Copyright {new Date().getFullYear()} {site.name}({site.domain}) All Rights Reserved</p>
        <div className="clear" style={{ clear: 'both' }} />
      </div>
    </div>
  )
}
