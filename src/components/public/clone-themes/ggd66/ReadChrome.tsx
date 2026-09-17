// ============================================================
// clone-themes/ggd66/ReadChrome.tsx — 格格党 章节阅读外壳 (R19-1A)
// 1:1 克隆源站配色 (硬编码 #xxxxxx, 不用 theme.vars)
// DOM: 居中窄列 + 章节标题 + 正文容器 + 上/下一章翻页栏
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import type { ReadChromeProps } from './shared'

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
