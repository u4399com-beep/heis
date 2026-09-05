// ============================================================
// 首页分类图文卡 — 6 个非空分类 + 各自代表书封面(字数最高带封面书)
// 响应式 grid, 点击跳分类页; 加载骨架 / 失败·空数据静默不渲染
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { FolderOpen } from 'lucide-react'
import { fetchShowcaseCategories, type ShowcaseCategory } from './data'
import { usePublic } from './ctx'
import { Sk } from './bits'
import { BookCover } from './BookCover'

const SHOWCASE_COUNT = 6

/** 分类卡键盘可达（Enter/Space 触发，配合 onClick 使用） */
function catNavProps(navigate: (p: { view: 'category'; cat: string }) => void, catId: string) {
  const open = () => navigate({ view: 'category', cat: catId })
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
    },
  }
}

function ShowcaseSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6" aria-hidden>
      {Array.from({ length: SHOWCASE_COUNT }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Sk className="aspect-[3/4] w-full" />
          <Sk className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  )
}

export function CategoryShowcase() {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const [items, setItems] = useState<ShowcaseCategory[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetchShowcaseCategories().then((d) => {
      if (!alive) return
      if (d && d.length) setItems(d)
      else setFailed(true) // 拉取失败/无数据 → 整块静默不渲染
    })
    return () => {
      alive = false
    }
  }, [])

  if (failed) return null
  if (!items) return <ShowcaseSkeleton />

  const cards = items.slice(0, SHOWCASE_COUNT)
  if (!cards.length) return null

  return (
    <section aria-label="分类图文导航">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.id}
            className="cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1"
            style={{
              background: v.surface,
              border: `1px solid ${v.border}`,
              borderRadius: v.radius,
              boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
            }}
            {...catNavProps(navigate, c.id)}
            aria-label={`浏览「${c.name}」分类书籍`}
          >
            <BookCover name={c.rep?.name || c.name} cover={c.rep?.cover} className="aspect-[3/4] w-full" />
            <div className="space-y-0.5 p-2.5">
              <div className="flex items-center justify-between gap-1">
                <h3 className="line-clamp-1 text-xs font-bold" style={{ color: v.text }}>
                  {c.name}
                </h3>
                <FolderOpen className="h-3 w-3 shrink-0" style={{ color: v.primary }} aria-hidden />
              </div>
              <p className="text-[10px]" style={{ color: v.textMuted }}>
                {c.bookCount} 本
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
