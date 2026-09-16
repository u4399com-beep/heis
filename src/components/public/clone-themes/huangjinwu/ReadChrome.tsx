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
    </div>
  )
}
