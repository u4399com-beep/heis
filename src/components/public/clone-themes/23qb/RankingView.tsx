// ============================================================
// clone-themes/23qb/RankingView.tsx — 铅笔小说 排行榜页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: tab 切换栏 + 排序列表 (前3加色徽章) + 分页
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { RankingViewProps } from './shared'

const C = {
  bg: "#f8f9f9",
  surface: "#ffffff",
  surfaceAlt: "#eaedf1",
  text: "#282828",
  textMuted: "#888888",
  primary: "#ff2a14",
  primaryText: "#ffffff",
  accent: "#c01a0c",
  border: "#eaedf1",
  radius: "5px",
  cardShadow: "0 7px 21px rgba(149,157,165,0.22)",
  fontFamily: "-apple-system-font, BlinkMacSystemFont, \"Helvetica Neue\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", Arial, sans-serif",
  maxW: 1200,
}

const TABS = [
  { id: 'allvisit', name: '总点击' },
  { id: 'allvote', name: '总推荐' },
  { id: 'goodnum', name: '总收藏' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
  { id: 'postdate', name: '最新入库' },
]

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage }: RankingViewProps) {
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
          排行榜
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              style={{
                padding: '6px 14px',
                background: tab === t.id ? C.primary : C.surface,
                color: tab === t.id ? C.primaryText : C.text,
                border: '1px solid ' + (tab === t.id ? C.primary : C.border),
                borderRadius: C.radius,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
              aria-pressed={tab === t.id}
            >
              {t.name}
            </button>
          ))}
        </div>
        {loading ? (
          <BookGridSkeleton count={10} />
        ) : !books || !books.length ? (
          <EmptyState text="暂无排行数据" />
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {books.map((b, i) => (
              <li key={b.id}>
                <a
                  href={'/?view=book&id=' + b.id}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                    e.preventDefault()
                    navigate({ view: 'book', bookId: b.id })
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    background: C.surface,
                    border: '1px solid ' + C.border,
                    borderRadius: C.radius,
                    boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                  aria-label={'查看《' + b.name + '》详情'}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 700,
                      background: i < 3 ? C.accent : C.surfaceAlt,
                      color: i < 3 ? C.primaryText : C.textMuted,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ width: 40, flexShrink: 0, overflow: 'hidden', borderRadius: C.radius, border: '1px solid ' + C.border }}>
                    <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
                    <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.author} · {b.category} · {formatWords(b.wordCount)}
                    </p>
                  </div>
                  <StatusBadge status={b.status} small />
                </a>
              </li>
            ))}
          </ol>
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
