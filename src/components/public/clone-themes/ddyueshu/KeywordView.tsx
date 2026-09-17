// ============================================================
// clone-themes/ddyueshu/KeywordView.tsx — 得得小说 关键词落地页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 大标题=tag + 主书籍卡 + 次要书单 (auto-fill minmax 响应式)
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { BookGridSkeleton, EmptyState, StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { KeywordViewProps } from './shared'

const C = {
  bg: "#E9FAFF",
  surface: "#ffffff",
  surfaceAlt: "#E1ECED",
  text: "#555555",
  textMuted: "#B3B3B3",
  primary: "#6F78A7",
  primaryText: "#ffffff",
  accent: "#88C6E5",
  border: "#A6D3E8",
  radius: "2px",
  cardShadow: "none",
  fontFamily: "\"宋体\", \"SimSun\", \"Microsoft YaHei\", Arial, sans-serif",
  maxW: 980,
}

export function KeywordView({ tag, books, loading }: KeywordViewProps) {
  const { navigate } = usePublic()
  const main = books && books.length > 0 ? books[0] : null
  const others = books && books.length > 1 ? books.slice(1) : []
  return (
    <div style={{ background: C.bg, fontFamily: C.fontFamily, color: C.text, padding: 16 }}>
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{
            fontSize: 28,
            fontWeight: 800,
            color: C.text,
            margin: '0 0 8px',
          }}>
            “{tag}” 相关小说推荐
          </h1>
          <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>
            精选“{tag}”相关小说 · 在线阅读 + 全文免费阅读 + TXT 下载
          </p>
        </header>
        {loading ? (
          <BookGridSkeleton count={6} />
        ) : !books || !books.length ? (
          <EmptyState text={'暂无与“' + tag + '”直接匹配的书籍'} hint="试试浏览其他分类或搜索其他关键词" />
        ) : (
          <>
            {main && (
              <section
                style={{
                  background: C.surface,
                  border: '1px solid ' + C.border,
                  borderRadius: C.radius,
                  boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
                  padding: 20,
                  marginBottom: 24,
                }}
                aria-label="主关键词书籍"
              >
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ width: 144, flexShrink: 0, overflow: 'hidden', borderRadius: C.radius, border: '1px solid ' + C.border }}>
                    <BookCover name={main.name} cover={main.cover} className="aspect-[3/4] w-full" />
                  </div>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', color: C.accent }}>主关键词书籍</span>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: '4px 0 8px' }}>
                      <a
                        href={'/?view=book&id=' + main.id}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                          e.preventDefault()
                          navigate({ view: 'book', bookId: main.id })
                        }}
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        {main.name}
                      </a>
                    </h2>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13, color: C.textMuted, marginBottom: 8 }}>
                      <span>作者: {main.author}</span>
                      <span style={{ padding: '0 6px', borderRadius: C.radius, background: C.surfaceAlt, color: C.primary }}>{main.category}</span>
                      <StatusBadge status={main.status} />
                      <span>{formatWords(main.wordCount)}</span>
                    </div>
                    <p style={{ fontSize: 14, lineHeight: 1.8, color: C.text, margin: '0 0 12px' }}>
                      {main.intro || '暂无简介'}
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate({ view: 'book', bookId: main.id })}
                      style={{
                        padding: '8px 18px',
                        background: C.primary,
                        color: C.primaryText,
                        border: 'none',
                        borderRadius: C.radius,
                        cursor: 'pointer',
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                      aria-label={'查看《' + main.name + '》详情'}
                    >
                      查看书籍详情
                    </button>
                  </div>
                </div>
              </section>
            )}
            {others.length > 0 && (
              <section aria-label="其他相关书籍">
                <h2 style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: C.text,
                  margin: '0 0 12px',
                  paddingBottom: 6,
                  borderBottom: '1px solid ' + C.border,
                }}>
                  其他相关书籍
                </h2>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {others.map((b, i) => (
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
                          padding: '10px 0',
                          borderBottom: '1px solid ' + C.border,
                          textDecoration: 'none',
                          color: C.text,
                          fontSize: 14,
                        }}
                      >
                        <span style={{
                          width: 24,
                          textAlign: 'center',
                          color: i < 3 ? C.primary : C.textMuted,
                          fontWeight: 700,
                          fontStyle: 'italic',
                        }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                        <span style={{ fontSize: 12, color: C.textMuted }}>{b.author}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
