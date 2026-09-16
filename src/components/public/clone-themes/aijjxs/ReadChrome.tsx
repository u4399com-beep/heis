'use client'
import type { ReadChromeProps } from '../shared'
export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  return (
    <div className="wrap" style={{ maxWidth: 800, margin: '0 auto', padding: '18px 14px 36px' }}>
      <article className="panel" style={{ background: 'rgba(255,253,248,.9)', border: '1px solid #e5dccd', borderRadius: 14, padding: '24px 32px' }}>
        {chapterTitle && <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1f2937', textAlign: 'center', margin: '0 0 24px' }}>{chapterTitle}</h1>}
        <div id="view_content_txt" style={{ fontSize: 17, lineHeight: 2, color: '#1f2937' }}>
          {children}
        </div>
        {(onPrev || onNext) && (
          <div className="pager" style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 32, paddingTop: 16, borderTop: '1px solid #e5dccd' }}>
            {onPrev && <button onClick={onPrev} style={{ padding: '6px 20px', border: '1px solid #0f766e', borderRadius: 8, background: '#fff', color: '#0f766e', cursor: 'pointer' }}>上一章</button>}
            {onNext && <button onClick={onNext} style={{ padding: '6px 20px', border: '1px solid #0f766e', borderRadius: 8, background: '#0f766e', color: '#fff', cursor: 'pointer' }}>下一章</button>}
          </div>
        )}
      </article>
    </div>
  )
}
