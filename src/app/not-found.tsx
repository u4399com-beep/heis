// ============================================================
// 全局 404 页面 (app/not-found.tsx — Next.js App Router 内置约定)
// 居中: 大号渐变 404 / BookOpen 图标 / 返回首页 + 返回后台按钮
// 底纹: 径向光晕 + 点阵 (CSS class .not-found-bg)
// ============================================================
import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, Home, LayoutDashboard } from 'lucide-react'

export const metadata: Metadata = {
  title: '404 - 页面不存在',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <html lang="zh-CN">
      <body className="not-found-bg min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12 text-center">
          {/* 顶部 BookOpen 图标 */}
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 text-zinc-500">
            <BookOpen className="h-8 w-8" aria-hidden />
          </div>

          {/* 大号 404 渐变文字 */}
          <p className="not-found-404 text-[7rem] font-black leading-none sm:text-[9rem]">404</p>

          {/* 文案 */}
          <h1 className="mt-4 text-xl font-bold text-zinc-100 sm:text-2xl">页面不存在</h1>
          <p className="mt-2 max-w-md text-sm text-zinc-500">
            你访问的页面可能已被移除或地址错误
          </p>

          {/* 操作按钮 */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition-colors hover:bg-violet-500"
            >
              <Home className="h-4 w-4" aria-hidden />
              返回首页
            </Link>
            <Link
              href="/?admin=1"
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden />
              返回后台
            </Link>
          </div>
        </main>
      </body>
    </html>
  )
}
