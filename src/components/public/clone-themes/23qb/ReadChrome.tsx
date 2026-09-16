'use client'
// 23qb.net (铅笔小说) 章节阅读页 1:1 克隆 — mxstatic 模板
// 源站 DOM: #content (正文区)
// 实测 #content 字号 14pt 行高 1.85, 主色 #ff2a14
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  return (
    <div className="page" style={{ background: '#f8f9f9', color: '#282828', fontFamily: '-apple-system-font, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif', fontSize: 14, minHeight: '100%' }}>
      <div className="wrapper" style={{ maxWidth: 800, margin: '0 auto', padding: '80px 15px 24px', boxSizing: 'border-box' }}>
        <div style={{ background: '#fff', borderRadius: 8, padding: '24px 32px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          {/* 面包屑 */}
          <div className="con_top" style={{ borderBottom: '1px dashed #eaecef', paddingBottom: 12, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: '#999' }}>
            <div>
              <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#ff2a14', textDecoration: 'none' }}>{site.name}</a>
              <span style={{ margin: '0 6px' }}>&gt;</span>
              <span>在线阅读</span>
            </div>
            <span style={{ color: '#999' }}>返回书页</span>
          </div>

          {/* 章节标题 */}
          {chapterTitle && (
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#282828', textAlign: 'center', margin: '0 0 24px', padding: '12px 0', borderBottom: '1px solid #eaecef' }}>
              {chapterTitle}
            </h1>
          )}

          {/* 正文 */}
          <div id="content" style={{ fontSize: 16, lineHeight: 1.85, color: '#282828', padding: '12px 0', textIndent: '2em' }}>
            {children}
          </div>

          {/* 翻页 */}
          {(onPrev || onNext) && (
            <div className="bottem2" style={{ borderTop: '1px solid #eaecef', clear: 'both', textAlign: 'center', margin: '20px auto 0', padding: '16px 0', display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              {onPrev && (
                <button onClick={onPrev} style={{ padding: '8px 24px', border: '1px solid #eaecef', borderRadius: 22, background: '#fff', color: '#282828', fontSize: 14, cursor: 'pointer' }}>
                  {prevLabel}
                </button>
              )}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}
                style={{ padding: '8px 24px', border: '1px solid #eaecef', borderRadius: 22, background: '#fff', color: '#666', fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                返回首页
              </a>
              {onNext && (
                <button onClick={onNext} style={{ padding: '8px 24px', border: 'none', borderRadius: 22, background: 'linear-gradient(90deg, #ff9800, #ff2a14)', color: '#fff', fontSize: 14, cursor: 'pointer' }}>
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
