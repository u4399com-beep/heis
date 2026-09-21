// ============================================================
// 小说管理系统 — 主入口 (R42-1C: 旧 Next.js TS 端已迁移到 Go 后端)
//
// 当前职责: 仅作为 Next.js dev server 占位首页, 显示项目迁移状态.
// 全部业务 (admin 后台 + 前台站群 + 采集 + API) 已在 Go 后端实现:
//   - go-backend/main.go (路由 + FuncMap)
//   - go-backend/admin.go (admin handler + 8 个新页面)
//   - go-backend/crawl/* (采集引擎 8 模块 ~7600 行)
//   - go-backend/templates/* (94 模板: 11 套主题 × 8 页型 + 6 admin)
//   - go-backend/services/* (9 个 mini-services: proxy/bridge)
//
// Go 二进制 heis-backend 独立监听端口 (与 Next.js dev :3000 解耦),
// Caddy 网关 :81 走 XTransformPort 转发到 mini-services (3010-3015).
// 业务请求请通过 Go 后端获取 (旧 Next.js 路由 src/app/api/* 已全部移除).
// ============================================================
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '小说管理系统 — 已迁移到 Go 后端',
  description: '本项目已迁移到 Go 后端 (go-backend/heis-backend). 当前 Next.js 仅保留首页占位, 业务请访问 Go 后端服务.',
  robots: { index: false, follow: false },
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-2xl">
        🦫
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
        小说管理系统 — 已迁移到 Go 后端
      </h1>
      <p className="max-w-prose text-sm leading-6 text-zinc-600">
        R42-1C 清理完成: 旧 Next.js TS 端 (~81000 行 / 350 文件) 已被 Go 后端
        (go-backend/, ~16500 行) 完整替代并移除. 当前页面是占位首页,
        业务路由 (admin 后台 / 站群前台 / 采集 API / mini-services) 全部由 Go 二进制
        heis-backend 提供.
      </p>

      <ul className="mt-2 w-full max-w-prose space-y-2 text-left text-sm text-zinc-700">
        <li className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
          <span className="font-mono text-xs text-zinc-500">go-backend/main.go</span>
          <br />
          路由注册 + 11 套主题 view 装配 + 86 个 FuncMap 字段
        </li>
        <li className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
          <span className="font-mono text-xs text-zinc-500">go-backend/admin.go</span>
          <br />
          admin handler + 8 个新页面 (categories/links/themes/downloads/settings/feedback/backup/seo-audit)
        </li>
        <li className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
          <span className="font-mono text-xs text-zinc-500">go-backend/crawl/*</span>
          <br />
          采集引擎 8 模块 (~7600 行): fetcher/parser/cleaner/runner/storage/hostgate/smart/types
        </li>
        <li className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
          <span className="font-mono text-xs text-zinc-500">go-backend/templates/*</span>
          <br />
          94 模板 (11 主题 × 8 页型 + 6 admin) — 复刻源站 DOM, SSR 渲染
        </li>
        <li className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
          <span className="font-mono text-xs text-zinc-500">go-backend/services/*</span>
          <br />
          9 个 mini-services (bqg713/deqixs/fetch-relay/moli/qimao/scrapling/uc/xjp/curl-impersonate)
        </li>
      </ul>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="https://github.com/your-repo/heis-backend"
          className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-700"
        >
          查看源码
        </Link>
        <Link
          href="/manifest.json"
          className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
        >
          PWA Manifest
        </Link>
      </div>

      <p className="mt-2 text-xs text-zinc-400">
        Next.js dev server 仍在 :3000 运行 (平台约束), 仅供占位; 业务流量请走 Go 后端.
      </p>
    </main>
  )
}
