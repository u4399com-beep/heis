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
    </div>
  )
}
