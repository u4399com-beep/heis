// ============================================================
// 小说管理系统 — 主入口 (唯一路由)
// 通过查询串/伪静态路径在 后台管理 / 前台站群站点 之间切换:
//   /                          → 后台管理
//   /?view=home|book|read|...  → 前台站点(查询串模式)
//   /book/123.html             → 前台书籍页(伪静态模式, 需 rewrite 配合)
//   /?admin=1                  → 强制后台
// 站群: /?view=...&site=<siteId> 或 /book/123.html?site=<siteId>
// ============================================================
'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import AdminApp from '@/components/admin/AdminApp'
import PublicSite from '@/components/public/PublicSite'
import { LoginGate } from '@/components/admin/LoginGate'
import { parseViewPath, PSEUDO_PRESETS, type PseudoStaticStyle } from '@/lib/pseudostatic'

type PublicViewObj = {
  view: 'home' | 'book' | 'read' | 'search' | 'keyword' | 'category' | 'history'
  bookId?: string
  chapterId?: string
  q?: string
  tag?: string
  cat?: string
  site?: string
  page?: number
  theme?: string
}

function Shell() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view')
  const forceAdmin = searchParams.get('admin') === '1'

  // R7-20: 伪静态路径检测 — 重写后浏览器 URL 仍是伪静态路径(如 /book/123.html),
  // 但查询串无 ?view=; 此时尝试从 pathname 解析视图参数。
  // 站点的 pseudoStaticStyle 在 PublicSite 加载后才知, 首载用 'query' 兜底;
  // parseViewPath 对所有风格都尝试解析(内部有 fallback 链), 命中即用。
  let publicView: PublicViewObj | undefined = undefined
  if (!forceAdmin) {
    if (view) {
      // 查询串模式(?view=xxx) — 原生支持
      publicView = {
        view: view as 'home' | 'book' | 'read' | 'search' | 'keyword' | 'category' | 'history',
        bookId: searchParams.get('id') || undefined,
        chapterId: searchParams.get('chapter') || undefined,
        q: searchParams.get('q') || undefined,
        tag: searchParams.get('tag') || undefined,
        cat: searchParams.get('cat') || undefined,
        site: searchParams.get('site') || undefined,
        page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
        theme: searchParams.get('theme') || undefined,
      }
    } else if (typeof window !== 'undefined') {
      // 伪静态路径模式 — 从 pathname 解析(尝试所有风格, 命中即用)
      const pathname = window.location.pathname
      if (pathname && pathname !== '/') {
        for (const preset of PSEUDO_PRESETS) {
          const parsed = parseViewPath(pathname, window.location.search, preset.id as PseudoStaticStyle)
          if (parsed.view !== 'home' || parsed.bookId || parsed.chapterId || parsed.cat || parsed.tag) {
            publicView = parsed
            break
          }
        }
      }
    }
  }

  const isSite = !!publicView && !forceAdmin

  if (isSite && publicView) {
    return (
      <PublicSite
        initialSiteId={publicView.site}
        initialView={publicView}
        embedMode
        onBack={() => {
          window.location.href = '/?admin=1'
        }}
      />
    )
  }

  return (
    <LoginGate>
      <AdminApp
        onPreviewSite={(themeId) => {
          window.location.href = themeId ? `/?view=home&theme=${encodeURIComponent(themeId)}` : '/?view=home'
        }}
      />
    </LoginGate>
  )
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400 text-sm">
          正在加载系统…
        </div>
      }
    >
      <Shell />
    </Suspense>
  )
}
