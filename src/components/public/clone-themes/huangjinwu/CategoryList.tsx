// ============================================================
// clone-themes/huangjinwu/CategoryList.tsx — 黄金屋 分类列表页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 标题 + 网格列表 + 分页 (auto-fill minmax 响应式)
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from './shared'

const C = {
  bg: "linear-gradient(180deg, #f5f8ff 0%, #eef3fb 100%)",
  surface: "#ffffff",
  surfaceAlt: "#e8f1ff",
  text: "#1e293b",
  textMuted: "#64748b",
  primary: "#2563eb",
  primaryText: "#ffffff",
  accent: "#1d4ed8",
  border: "#dbe4f0",
  radius: "6px",
  cardShadow: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(37,99,235,0.06)",
  fontFamily: "-apple-system, BlinkMacSystemFont, \"Microsoft YaHei\", \"PingFang SC\", \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif",
  maxW: 1180,
}

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  const totalPages = Math.ceil(total / size) || 1
  if (loading) {
    return (
      <div style={{ background: C.bg, fontFamily: C.fontFamily, padding: 16 }}>
        <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
          <BookGridSkeleton count={12} />
        </div>
      </div>
    )
  }
  if (!books || !books.length) {
    return (
      <div style={{ background: C.bg, fontFamily: C.fontFamily, padding: 16 }}>
        <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
          <EmptyState text="暂无书籍" />
        </div>
      </div>
    )
  }
  return (
    <div style={{ background: C.bg, fontFamily: C.fontFamily, color: C.text, padding: 16 }}>
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <h1 style={{
          fontSize: 20,
          fontWeight: 700,
          color: C.text,
          margin: '0 0 16px',
          paddingBottom: 8,
          borderBottom: '2px solid ' + C.primary,
        }}>
          {label}
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: C.textMuted }}>
            共 {total} 本 · 第 {page} / {totalPages} 页
          </span>
        </h1>
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
                <p style={{ fontSize: 11, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ marginRight: 4, padding: '0 4px', borderRadius: C.radius, background: C.surfaceAlt, color: C.primary }}>{b.category}</span>
                  {formatWords(b.wordCount)}
                </p>
              </div>
            </a>
          ))}
        </div>
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
