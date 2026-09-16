'use client'
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  const { theme } = usePublic()
  const v = theme.vars
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      {chapterTitle && <h1 style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', color: v.text, marginBottom: 24 }}>{chapterTitle}</h1>}
      <div style={{ fontSize: 17, lineHeight: 2, color: v.text }}>{children}</div>
      {(onPrev || onNext) && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 32, paddingTop: 16, borderTop: '1px solid ' + v.border }}>
          {onPrev && <button onClick={onPrev} style={{ padding: '6px 20px', border: '1px solid ' + v.border, borderRadius: v.radius, background: v.surface, color: v.text, cursor: 'pointer' }}>上一章</button>}
          {onNext && <button onClick={onNext} style={{ padding: '6px 20px', border: '1px solid ' + v.border, borderRadius: v.radius, background: v.primary, color: v.primaryText, cursor: 'pointer' }}>下一章</button>}
        </div>
      )}
    </div>
  )
}
