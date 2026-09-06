'use client'

// ============================================================
// AdminApp — 后台管理主壳
// 左侧栏导航切换 9 大区块; 对外接口: <AdminApp onPreviewSite={fn} />
// ============================================================
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import {
  BookMarked,
  BookOpenText,
  ExternalLink,
  FileCode2,
  FileDown,
  FolderTree,
  Globe,
  LayoutDashboard,
  Link2,
  ListChecks,
  Palette,
  Settings,
} from 'lucide-react'
import { Dashboard } from './Dashboard'
import { RulesSection } from './RulesSection'
import { TasksSection } from './TasksSection'
import { BooksSection } from './BooksSection'
import { CategoriesSection } from './CategoriesSection'
import { SitesSection } from './SitesSection'
import { ThemesSection } from './ThemesSection'
import { DownloadsSection } from './DownloadsSection'
import { LinksSection } from './LinksSection'
import { SettingsSection } from './SettingsSection'

type SectionKey =
  | 'dashboard'
  | 'rules'
  | 'tasks'
  | 'books'
  | 'categories'
  | 'sites'
  | 'links'
  | 'themes'
  | 'downloads'
  | 'settings'

const NAV: { key: SectionKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { key: 'rules', label: '采集规则', icon: FileCode2 },
  { key: 'tasks', label: '采集任务', icon: ListChecks },
  { key: 'books', label: '书籍管理', icon: BookMarked },
  { key: 'categories', label: '分类管理', icon: FolderTree },
  { key: 'sites', label: '站群系统', icon: Globe },
  { key: 'links', label: '友链链轮', icon: Link2 },
  { key: 'themes', label: '主题模板', icon: Palette },
  { key: 'downloads', label: 'TXT下载', icon: FileDown },
  { key: 'settings', label: '系统设置', icon: Settings },
]

const SCROLLBAR_CSS = `
.admin-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.admin-scroll::-webkit-scrollbar-track { background: transparent; }
.admin-scroll::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
.admin-scroll::-webkit-scrollbar-thumb:hover { background: #52525b; }
.admin-scroll { scrollbar-width: thin; scrollbar-color: #3f3f46 transparent; }
/* 规则编辑器页签 forceMount 后 Radix 不再自动隐藏非激活面板, 由这里补上隐藏 */
.rule-tabs [role="tabpanel"][data-state="inactive"] { display: none; }
`

export default function AdminApp({ onPreviewSite }: { onPreviewSite?: (themeId?: string) => void }) {
  const [section, setSection] = useState<SectionKey>('dashboard')
  const [downloadPreselect, setDownloadPreselect] = useState<string | null>(null)

  // 后台启用深色主题 (卸载时还原)
  useEffect(() => {
    document.documentElement.classList.add('dark')
    return () => document.documentElement.classList.remove('dark')
  }, [])

  const goDownload = (bookId: string) => {
    setDownloadPreselect(bookId)
    setSection('downloads')
  }

  const renderSection = () => {
    switch (section) {
      case 'rules':
        return <RulesSection />
      case 'tasks':
        return <TasksSection />
      case 'books':
        return <BooksSection onGoDownload={goDownload} />
      case 'categories':
        return <CategoriesSection />
      case 'sites':
        return <SitesSection />
      case 'links':
        return <LinksSection />
      case 'themes':
        return <ThemesSection onPreviewSite={onPreviewSite} />
      case 'downloads':
        return <DownloadsSection preselectBookId={downloadPreselect} onConsumedPreselect={() => setDownloadPreselect(null)} />
      case 'settings':
        return <SettingsSection />
      case 'dashboard':
      default:
        return <Dashboard onNavigate={(s) => setSection(s as SectionKey)} />
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <style dangerouslySetInnerHTML={{ __html: SCROLLBAR_CSS }} />

      {/* 顶栏 */}
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/15">
              <BookOpenText className="h-4.5 w-4.5 text-violet-400" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight text-zinc-100">小说管理系统</div>
              <div className="text-[10px] leading-tight text-zinc-500">后台控制中心 · 采集 / 书库 / 站群</div>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800"
            onClick={() => onPreviewSite?.()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            前台预览
          </Button>
        </div>

        {/* 移动端横向导航 */}
        <nav aria-label="后台导航" className="admin-scroll flex gap-1 overflow-x-auto border-t border-zinc-800 px-2 py-1.5 lg:hidden">
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setSection(n.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                section === n.key ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              <n.icon className="h-3.5 w-3.5" />
              {n.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex w-full flex-1">
        {/* 侧栏 (lg+) */}
        <aside className="hidden w-52 shrink-0 flex-col gap-1 self-start overflow-y-auto border-r border-zinc-800 p-3 lg:sticky lg:top-[58px] lg:flex lg:h-[calc(100vh-58px)]">
          {NAV.map((n) => {
            const active = section === n.key
            return (
              <button
                key={n.key}
                type="button"
                onClick={() => setSection(n.key)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'border border-violet-500/30 bg-violet-500/15 font-medium text-violet-300'
                    : 'border border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <n.icon className={`h-4 w-4 ${active ? 'text-violet-400' : ''}`} />
                {n.label}
              </button>
            )
          })}
          <div className="mt-auto px-3 pt-4 text-[10px] leading-relaxed text-zinc-700">
            采集核心已就绪
            <br />
            支持 CSS / XPath / 正则
          </div>
        </aside>

        {/* 主内容 */}
        <main className="min-w-0 flex-1 p-4 pb-10 lg:p-6 lg:pb-10">{renderSection()}</main>
      </div>

      {/* 页脚 */}
      <footer className="mt-auto border-t border-zinc-800 px-4 py-3 text-center text-[11px] text-zinc-600">
        小说管理系统 · 后台管理 — 规则采集 / 任务调度 / 书库运营 / 站群主题 / TXT 成品下载
      </footer>

      <Toaster theme="dark" position="top-center" richColors closeButton />
    </div>
  )
}
