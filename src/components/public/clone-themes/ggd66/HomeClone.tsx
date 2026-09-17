// ============================================================
// clone-themes/ggd66/HomeClone.tsx — 格格党 首页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 顶部 banner + 多模块书籍网格 (auto-fill minmax 响应式)
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { HomeCloneProps } from './shared'

const C = {
  bg: "#f9f9f9",
  surface: "#ffffff",
  surfaceAlt: "#cdf3eb",
  text: "#333333",
  textMuted: "#888888",
  primary: "#00886d",
  primaryText: "#ffffff",
  accent: "#ff5500",
  border: "#cccccc",
  radius: "4px",
  cardShadow: "0 1px 1px rgba(0,0,0,0.05)",
  fontFamily: "\"微软雅黑\", \"Microsoft YaHei\", simsun, arial, sans-serif",
  maxW: 1200,
}

function BookCard({ b }: { b: HomeCloneProps['books'][number] }) {
  const { navigate } = usePublic()
  return (
    <a
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
        transition: 'transform 200ms ease',
      }}
      aria-label={'查看《' + b.name + '》详情'}
    >
      <div style={{ position: 'relative' }}>
        <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
        <span style={{ position: 'absolute', left: 6, top: 6 }}><StatusBadge status={b.status} small /></span>
        <span
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            borderRadius: 999,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 700,
            background: C.primary,
            color: C.primaryText,
          }}
        >
          {formatWords(b.wordCount)}
        </span>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
        <p style={{ fontSize: 12, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</p>
        <p style={{ fontSize: 11, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ marginRight: 4, padding: '0 4px', borderRadius: C.radius, background: C.surfaceAlt, color: C.primary }}>{b.category}</span>
          {b.latestChapter || '暂无章节'}
        </p>
      </div>
    </a>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps) {
  usePublic()
  if (loading) return <BookGridSkeleton count={12} />
  if (!books || !books.length) return <EmptyState text="暂无书籍" />
  return (
    <div
      style={{
        background: C.bg,
        fontFamily: C.fontFamily,
        color: C.text,
        minHeight: '100%',
        padding: 16,
      }}
    >
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <section style={{ marginBottom: 16 }}>
          <h2 style={{
            fontSize: 18,
            fontWeight: 700,
            color: C.text,
            margin: '0 0 12px',
            paddingBottom: 8,
            borderBottom: '2px solid ' + C.primary,
          }}>
            最新上架
          </h2>
        </section>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          {books.map((b) => (
            <BookCard key={b.id} b={b} />
          ))}
        </div>
      </div>
    </div>
  )
}
