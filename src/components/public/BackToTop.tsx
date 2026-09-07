// ============================================================
// BackToTop — 返回顶部悬浮按钮 (与 FeedbackWidget 叠加不重叠)
// 滚动 > 400px 才出现; 在阅读器视图使用内部滚动容器而非 window
// 淡入淡出 + 平滑滚动
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

const SHOW_AFTER = 400
const SCROLL_DURATION = 360

/** 平滑滚动: target scrollTop → 0 with ease-out quad */
function smoothScrollToTop(el: HTMLElement | Window) {
  if (el === window) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  // 浏览器原生支持 element.scrollTo({behavior})
  try {
    ;(el as HTMLElement).scrollTo({ top: 0, behavior: 'smooth' })
    return
  } catch {
    /* ignore */
  }
  // 手动缓动 (兜底)
  const start = (el as HTMLElement).scrollTop
  if (start <= 0) return
  const startTime = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - startTime) / SCROLL_DURATION)
    const eased = 1 - (1 - t) * (1 - t) // ease-out quad
    ;(el as HTMLElement).scrollTop = start * (1 - eased)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let readerEl: HTMLElement | null = null

    const check = () => {
      // 检测是否在阅读器视图: 内部可滚动容器优先
      const reader = document.querySelector<HTMLElement>('[data-reader-scroll]')
      if (reader) {
        const top = reader.scrollTop
        setVisible(top > SHOW_AFTER)
        return
      }
      // 退化: 用 window.scrollY
      const sy = window.scrollY || document.documentElement.scrollTop
      setVisible(sy > SHOW_AFTER)
    }

    const onReaderScroll = () => check()
    const onWindowScroll = () => check()

    // mount + 视图切换 polling(轻量, 500ms 间隔)
    check()
    window.addEventListener('scroll', onWindowScroll, { passive: true })

    let pollId = 0
    const poll = () => {
      const r = document.querySelector<HTMLElement>('[data-reader-scroll]')
      if (r !== readerEl) {
        if (readerEl) readerEl.removeEventListener('scroll', onReaderScroll)
        readerEl = r
        if (readerEl) readerEl.addEventListener('scroll', onReaderScroll, { passive: true })
        check()
      }
    }
    pollId = window.setInterval(poll, 500)

    return () => {
      window.removeEventListener('scroll', onWindowScroll)
      if (readerEl) readerEl.removeEventListener('scroll', onReaderScroll)
      if (pollId) window.clearInterval(pollId)
    }
  }, [])

  const onClick = () => {
    const reader = document.querySelector<HTMLElement>('[data-reader-scroll]')
    if (reader) smoothScrollToTop(reader)
    else smoothScrollToTop(window)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="返回顶部"
      tabIndex={visible ? 0 : -1}
      className={`fixed bottom-[80px] right-5 z-40 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/90 text-zinc-200 shadow-lg backdrop-blur transition-all duration-200 hover:border-violet-500/60 hover:bg-zinc-800 hover:text-violet-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 sm:bottom-[88px] sm:h-11 sm:w-11 ${
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <ArrowUp className="h-4 w-4" aria-hidden />
      <span className="sr-only">返回顶部</span>
    </button>
  )
}
