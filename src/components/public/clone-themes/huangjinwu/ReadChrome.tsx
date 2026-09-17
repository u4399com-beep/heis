'use client'
import type { ReadChromeProps } from '../shared'
const C = {
  "id": "huangjinwu",
  "bg": "linear-gradient(180deg,#f5f8ff 0%,#eef3fb 100%)",
  "surface": "#fff",
  "text": "#1e293b",
  "muted": "#64748b",
  "primary": "#2563eb",
  "accent": "#1d4ed8",
  "border": "#dbe4f0",
  "radius": "6px",
  "font": "-apple-system,\"Microsoft YaHei\",sans-serif",
  "maxW": 1200
}
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