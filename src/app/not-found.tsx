import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '404 - 页面不存在',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12 text-center">
          <p className="text-[7rem] font-black leading-none sm:text-[9rem]">404</p>
          <h1 className="mt-4 text-xl font-bold text-zinc-100 sm:text-2xl">页面不存在</h1>
          <p className="mt-2 max-w-md text-sm text-zinc-500">
            你访问的页面可能已被移除或地址错误
          </p>
          <div className="mt-8">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-md bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition-colors hover:bg-violet-500"
            >
              返回首页
            </Link>
          </div>
        </main>
      </body>
    </html>
  )
}
