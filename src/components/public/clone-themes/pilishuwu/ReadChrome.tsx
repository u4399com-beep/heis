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
        </div>
      </div>
    </div>
  )
}
