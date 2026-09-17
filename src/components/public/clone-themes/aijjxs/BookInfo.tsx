// ============================================================
// clone-themes/aijjxs/BookInfo.tsx — 久久小说 书籍详情页 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 封面 + 信息键值表 + 简介面板 + 操作按钮
// ============================================================
'use client'

import { BookCover } from '../../BookCover'
import { usePublic } from '../../ctx'
import { StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { BookInfoProps } from './shared'

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

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onContinueRead, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  const wordText = formatWords(book.wordCount)
  const continueRead = () => {
    if (onContinueRead) return onContinueRead()
    if (savedPos && savedPos.chapterId) {
      navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId })
    } else if (firstChapterId) {
      navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId })
    } else {
      onScrollToc()
    }
  }
  return (
    <div
      style={{
        background: C.bg,
        fontFamily: C.fontFamily,
        color: C.text,
        padding: 16,
      }}
    >
      <div style={{ maxWidth: C.maxW, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            gap: 20,
            background: C.surface,
            border: '1px solid ' + C.border,
            borderRadius: C.radius,
            boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
            padding: 20,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ width: 120, height: 160, flexShrink: 0, overflow: 'hidden', borderRadius: C.radius, border: '1px solid ' + C.border }}>
            <BookCover name={book.name} cover={book.cover} className="aspect-[3/4] w-full" />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 12px' }}>{book.name}</h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13, color: C.textMuted, marginBottom: 12 }}>
              <span>作者: <a
                href="#"
                onClick={(e) => { e.preventDefault() }}
                style={{ color: C.primary, textDecoration: 'none' }}
              >{book.author}</a></span>
              <span>分类: {book.categoryId ? (
                <a
                  href={'/?view=category&cat=' + encodeURIComponent(book.categoryId)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                    e.preventDefault()
                    const cid = book.categoryId
                    if (!cid) return
                    if (onGoCategory) onGoCategory(cid)
                    else navigate({ view: 'category', cat: cid })
                  }}
                  style={{ color: C.primary, textDecoration: 'none' }}
                >{book.category}</a>
              ) : book.category}</span>
              <span>字数: {wordText}</span>
              <StatusBadge status={book.status} />
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.8, color: C.textMuted, margin: '0 0 12px' }}>
              最新章节: {book.latestChapter || '暂无'}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={continueRead}
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
                aria-label="开始阅读"
              >
                {savedPos && savedPos.chapterId ? '继续阅读' : '开始阅读'}
              </button>
              <button
                type="button"
                onClick={onScrollToc}
                style={{
                  padding: '8px 18px',
                  background: C.surfaceAlt,
                  color: C.text,
                  border: '1px solid ' + C.border,
                  borderRadius: C.radius,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
                aria-label="查看目录"
              >
                查看目录
              </button>
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 14,
            background: C.surface,
            border: '1px solid ' + C.border,
            borderRadius: C.radius,
            boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
            padding: 20,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid ' + C.border }}>
            内容简介
          </h2>
          <div style={{ fontSize: 14, lineHeight: 1.9, color: C.textMuted, whiteSpace: 'pre-wrap' }}>
            {book.intro || '暂无简介'}
          </div>
        </div>
      </div>
    </div>
  )
}
