// ============================================================
// 小说管理系统 — 主入口 (唯一路由)
// 通过查询串在 后台管理 / 前台站群站点 之间切换:
//   /                → 后台管理
//   /?view=home|book|read|search|keyword|category → 前台站点
//   /?admin=1        → 强制后台
// 站群: /?view=...&site=<siteId> 指定站点(或按域名自动匹配)
// ============================================================
'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import AdminApp from '@/components/admin/AdminApp'
import PublicSite from '@/components/public/PublicSite'

function Shell() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view')
  const forceAdmin = searchParams.get('admin') === '1'
  const isSite = !!view && !forceAdmin

  const publicView = isSite
    ? {
        view: view as 'home' | 'book' | 'read' | 'search' | 'keyword' | 'category',
        bookId: searchParams.get('id') || undefined,
        chapterId: searchParams.get('chapter') || undefined,
        q: searchParams.get('q') || undefined,
        tag: searchParams.get('tag') || undefined,
        cat: searchParams.get('cat') || undefined,
        site: searchParams.get('site') || undefined,
        page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
        // 主题预览覆盖(?theme=): 仅首载入口参数, PublicSite 用后即弃不入持久化路由
        theme: searchParams.get('theme') || undefined,
      }
    : undefined

  if (isSite) {
    return (
      <PublicSite
        initialSiteId={publicView?.site}
        initialView={publicView}
        embedMode
        onBack={() => {
          window.location.href = '/?admin=1'
        }}
      />
    )
  }

  return (
    <AdminApp
      onPreviewSite={(themeId) => {
        // 主题卡片"预览前台"携带 themeId → 前台以 ?theme= 覆盖预览对应主题
        // (PublicSite 仅首载入口解析该参数, 站内导航/切站后自然还原站点自身主题)
        window.location.href = themeId ? `/?view=home&theme=${encodeURIComponent(themeId)}` : '/?view=home'
      }}
    />
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
