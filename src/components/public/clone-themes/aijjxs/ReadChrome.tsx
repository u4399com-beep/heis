'use client'
import type { ReadChromeProps } from '../shared'
const C = {"id":"aijjxs","bg":"#f3efe7","surface":"#fffdf8","text":"#1f2937","muted":"#6b7280","primary":"#0f766e","accent":"#b45309","border":"#e5dccd","radius":"14px","font":"\"PingFang SC\",\"Microsoft YaHei\",sans-serif","maxW":1220}
export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, fontFamily: C.font, color: C.text }}>
      {chapterTitle && <h1 style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 24 }}>{chapterTitle}</h1>}
      <div style={{ fontSize: 17, lineHeight: 2 }}>{children}</div>
      {(onPrev || onNext) && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 32, paddingTop: 16, borderTop: '1px solid ' + C.border }}>
          {onPrev && <button onClick={onPrev} style={{ padding: '6px 20px', border: '1px solid ' + C.border, borderRadius: C.radius, background: C.surface, color: C.text, cursor: 'pointer' }}>上一章</button>}
          {onNext && <button onClick={onNext} style={{ padding: '6px 20px', border: '1px solid ' + C.border, borderRadius: C.radius, background: C.primary, color: '#fff', cursor: 'pointer' }}>下一章</button>}
        </div>
      )}
    </div>
  )
}