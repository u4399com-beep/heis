// ============================================================
// clone-themes/aijjxs/FulltextView.tsx — 久久小说 全本完本页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 标题 + 完本网格 (auto-fill minmax 响应式) + 分页
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { FulltextViewProps } from './shared'

const C = {
  bg: "radial-gradient(1000px 420px at 0 -10%, #e0f2fe 0%, transparent 60%), radial-gradient(900px 520px at 100% 0, #ffedd5 0%, transparent 60%), #f3efe7",
  surface: "#fffdf8",
  surfaceAlt: "#eef9f7",
  text: "#1f2937",
  textMuted: "#6b7280",
  primary: "#0f766e",
  primaryText: "#ffffff",
  accent: "#b45309",
  border: "#e5dccd",
  radius: "14px",
  cardShadow: "0 10px 30px rgba(17, 24, 39, 0.08)",
  fontFamily: "\"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"Helvetica Neue\", Arial, sans-serif",
  maxW: 1220,
}

export function FulltextView({ books, loading, page, total, size, onPage }: FulltextViewProps) {
  const { navigate } = usePublic()
  const totalPages = Math.ceil(total / size) || 1
  return (
    <div style={{ background: C.bg, fontFamily: C.fontFamily, color: C.text, padding: 16 }}>
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: C.text,
          margin: '0 0 16px',
          paddingBottom: 8,
          borderBottom: '2px solid ' + C.primary,
        }}>
          全本完本小说
        </h1>
        {loading ? (
          <BookGridSkeleton count={12} />
        ) : !books || !books.length ? (
          <EmptyState text="暂无全本小说" />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {books.map((b) => (
              <a
                key={b.id}
                href={'/?view=book&id=' + b.id}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault()
                  navigate({ view: 'book', bookId: b.id })
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: C.surface,
                  border: '1px solid ' + C.border,
                  borderRadius: C.radius,
                  boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
                  overflow: 'hidden',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
                aria-label={'查看《' + b.name + '》详情'}
              >
                <div style={{ position: 'relative' }}>
                  <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                  <span style={{ position: 'absolute', left: 6, top: 6 }}><StatusBadge status={b.status} small /></span>
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
                  <p style={{ fontSize: 12, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</p>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>
                    {formatWords(b.wordCount)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24, alignItems: 'center' }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
              style={{
                padding: '6px 16px',
                border: '1px solid ' + C.border,
                borderRadius: C.radius,
                background: C.surface,
                color: C.text,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                opacity: page <= 1 ? 0.5 : 1,
                fontSize: 14,
              }}
              aria-label="上一页"
            >
              上一页
            </button>
            <span style={{ padding: '6px 12px', color: C.textMuted, fontSize: 14 }}>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPage(page + 1)}
              style={{
                padding: '6px 16px',
                border: '1px solid ' + C.border,
                borderRadius: C.radius,
                background: C.surface,
                color: C.text,
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                opacity: page >= totalPages ? 0.5 : 1,
                fontSize: 14,
              }}
              aria-label="下一页"
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
