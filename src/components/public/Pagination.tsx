'use client'
// R17: 重建窗口期最小分页组件 (替代被删的旧 Pagination)
import { usePublic } from './ctx'

export function Pagination({ page, total, size, onPage, center }: {
  page: number; total: number; size: number; onPage: (p: number) => void; center?: boolean
}) {
  const { theme } = usePublic()
  const v = theme.vars
  const totalPages = Math.ceil(total / size) || 1
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', justifyContent: center ? 'center' : 'flex-start', gap: 8, marginTop: 16, alignItems: 'center' }}>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}
        style={{ padding: '6px 16px', border: `1px solid ${v.border}`, borderRadius: v.radius, background: v.surface, color: v.text, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1, fontSize: 14 }}>
        上一页
      </button>
      <span style={{ padding: '6px 12px', color: v.textMuted, fontSize: 14 }}>{page} / {totalPages}</span>
      <button disabled={page >= totalPages} onClick={() => onPage(page + 1)}
        style={{ padding: '6px 16px', border: `1px solid ${v.border}`, borderRadius: v.radius, background: v.surface, color: v.text, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.5 : 1, fontSize: 14 }}>
        下一页
      </button>
    </div>
  )
}
