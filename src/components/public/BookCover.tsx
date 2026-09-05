// ============================================================
// 封面渲染 — 有图 lazy 加载 / 加载失败回退渐变占位 / 无图渐变占位块（书名文字）
// ============================================================
'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { usePublic } from './ctx'
import { coverSrc } from './seo'

export function BookCover({
  name,
  cover,
  className,
  style,
  showAuthor,
}: {
  name: string
  cover?: string | null
  className?: string
  style?: CSSProperties
  showAuthor?: string
}) {
  const { theme } = usePublic()
  const v = theme.vars
  const [failed, setFailed] = useState(false)

  // cover 变化时重置失败态（同一组件复用于不同书籍）
  const [prevCover, setPrevCover] = useState(cover)
  if (prevCover !== cover) {
    setPrevCover(cover)
    setFailed(false)
  }

  const src = failed ? null : coverSrc(cover)
  return (
    <div
      className={`relative overflow-hidden ${className || ''}`}
      style={{ borderRadius: v.radius, ...style }}
    >
      {src ? (
        <img
          src={src}
          alt={`${name} 封面`}
          loading="lazy"
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center"
          style={{ background: `linear-gradient(135deg, ${v.primary} 0%, ${v.accent} 100%)` }}
          role="img"
          aria-label={`${name} 封面占位`}
        >
          <span
            className="line-clamp-3 font-bold leading-snug"
            style={{ color: v.primaryText, writingMode: 'vertical-rl', letterSpacing: '0.15em' }}
          >
            {name.slice(0, 12)}
          </span>
          {showAuthor && (
            <span className="text-[10px] opacity-80" style={{ color: v.primaryText }}>{showAuthor}</span>
          )}
        </div>
      )}
    </div>
  )
}
