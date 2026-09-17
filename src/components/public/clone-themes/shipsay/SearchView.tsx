// ============================================================
// clone-themes/shipsay/SearchView.tsx — 船说CMS 搜索结果页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 查询关键字标题 + 结果网格 (auto-fill minmax 响应式) + 空态
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { SearchViewProps } from './shared'

const C = {
  bg: "#f4f4f4",
  surface: "#ffffff",
  surfaceAlt: "#fafafa",
  text: "#666666",
  textMuted: "#969ba3",
  primary: "#ed4259",
  primaryText: "#ffffff",
  accent: "#bf2c24",
  border: "#e0e0e0",
  radius: "3px",
  cardShadow: "0 2px 6px rgba(0,0,0,0.06)",
  fontFamily: "\"微软雅黑\", \"Microsoft YaHei\", Arial, Tahoma, Verdana, sans-serif",
  maxW: 960,
}

export function SearchView({ q, books, loading }: SearchViewProps) {
  const { navigate } = usePublic()
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
          “{q}” 的搜索结果
          {!loading && books && (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: C.textMuted }}>
              共 {books.length} 本
            </span>
          )}
        </h1>
        {loading ? (
          <BookGridSkeleton count={12} />
        ) : !books || !books.length ? (
          <EmptyState text={'没有找到与“' + q + '”相关的书籍'} hint="试试更换关键词或浏览全部分类" />
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
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ marginRight: 4, padding: '0 4px', borderRadius: C.radius, background: C.surfaceAlt, color: C.primary }}>{b.category}</span>
                    {formatWords(b.wordCount)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
