// ============================================================
// clone-themes/huangjinwu/ReadChrome.tsx — 黄金屋 章节阅读外壳 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 居中窄列 + 章节标题 + 正文容器 + 上/下一章翻页栏
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import type { ReadChromeProps } from './shared'

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

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  usePublic()
  return (
    <div
      style={{
        background: C.bg,
        fontFamily: C.fontFamily,
        color: C.text,
        minHeight: '100%',
        padding: '24px 16px',
      }}
    >
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <article
          style={{
            background: C.surface,
            border: '1px solid ' + C.border,
            borderRadius: C.radius,
            boxShadow: C.cardShadow === 'none' ? undefined : C.cardShadow,
            padding: 24,
          }}
        >
          {chapterTitle && (
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: C.text,
                textAlign: 'center',
                margin: '0 0 24px',
                paddingBottom: 12,
                borderBottom: '1px solid ' + C.border,
              }}
            >
              {chapterTitle}
            </h1>
          )}
          <div
            className="chapter-content"
            style={{
              fontSize: 17,
              lineHeight: 1.9,
              color: C.text,
            }}
          >
            {children}
          </div>
          {(onPrev || onNext) && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 12,
                marginTop: 32,
                paddingTop: 16,
                borderTop: '1px solid ' + C.border,
              }}
            >
              {onPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  style={{
                    padding: '8px 22px',
                    border: '1px solid ' + C.border,
                    borderRadius: C.radius,
                    background: C.surfaceAlt,
                    color: C.text,
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                  aria-label="上一章"
                >
                  上一章
                </button>
              )}
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  style={{
                    padding: '8px 22px',
                    border: 'none',
                    borderRadius: C.radius,
                    background: C.primary,
                    color: C.primaryText,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                  aria-label="下一章"
                >
                  下一章
                </button>
              )}
            </div>
          )}
        </article>
      </div>
    </div>
  )
}
