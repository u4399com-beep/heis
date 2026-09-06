'use client'

// ============================================================
// 仪表盘 — 统计卡片 / 最近任务 / 最近入库 / 分类分布
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  BookMarked,
  Download,
  FileCode2,
  FileStack,
  Globe,
  LayoutDashboard,
  ListChecks,
  Loader2,
  RefreshCw,
  Tags,
} from 'lucide-react'
import {
  api,
  BOOK_STATUS_META,
  coverUrl,
  fmtDateTime,
  fmtNum,
  fmtWords,
  PHASE_META,
  safeJsonParse,
  TASK_STATUS_META,
  type StatsData,
  type TaskProgress,
  type TaskStatus,
} from './helpers'

interface DashboardProps {
  onNavigate?: (section: string) => void
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const aliveRef = useRef(true)

  // 卸载后停止异步 setState
  useEffect(() => {
    return () => {
      aliveRef.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<StatsData>('/api/admin/stats')
      if (aliveRef.current) setStats(data)
    } catch {
      // 静默失败, 卡片显示 0
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const cards = [
    { key: 'books', label: '书籍', value: stats?.books ?? 0, icon: BookMarked, tone: 'text-violet-400', section: 'books' },
    {
      key: 'chapters',
      label: '章节',
      value: stats?.chapters ?? 0,
      sub: `总字数 ${fmtWords(stats?.totalWords)}`,
      icon: FileStack,
      tone: 'text-sky-400',
      section: 'books',
    },
    { key: 'rules', label: '采集规则', value: stats?.rules ?? 0, icon: FileCode2, tone: 'text-amber-400', section: 'rules' },
    {
      key: 'tasks',
      label: '采集任务',
      value: stats?.tasks ?? 0,
      sub: `运行中 ${stats?.runningTasks ?? 0}`,
      icon: ListChecks,
      tone: 'text-emerald-400',
      section: 'tasks',
    },
    { key: 'sites', label: '站点', value: stats?.sites ?? 0, icon: Globe, tone: 'text-teal-400', section: 'sites' },
    { key: 'tags', label: '下拉词', value: stats?.tags ?? 0, icon: Tags, tone: 'text-rose-400', section: 'books' },
    { key: 'downloads', label: '下载成品', value: stats?.downloads ?? 0, icon: Download, tone: 'text-orange-400', section: 'downloads' },
  ]

  const maxCat = Math.max(1, ...(stats?.categories || []).map((c) => c._count?.books || 0))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <LayoutDashboard className="h-5 w-5 text-violet-400" />
            仪表盘
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">书库与采集系统运行总览</p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={load}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          刷新数据
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-7">
        {cards.map((c) => (
          <Card
            key={c.key}
            role="button"
            tabIndex={0}
            aria-label={`查看${c.label}`}
            className="cursor-pointer border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
            onClick={() => onNavigate?.(c.section)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNavigate?.(c.section)
              }
            }}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">{c.label}</span>
                <c.icon className={`h-4 w-4 ${c.tone}`} />
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                {loading ? <Loader2 className="h-5 w-5 animate-spin text-zinc-600" /> : fmtNum(c.value)}
              </div>
              {c.sub && <div className="mt-0.5 text-[11px] text-zinc-500">{c.sub}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 最近任务 */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm text-zinc-200">最近任务</CardTitle>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500 hover:text-zinc-200" onClick={() => onNavigate?.('tasks')}>
              查看全部
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!stats?.recentTasks?.length ? (
              <div className="py-8 text-center text-xs text-zinc-600">暂无任务</div>
            ) : (
              <div className="space-y-2">
                {stats.recentTasks.map((t) => {
                  const meta = TASK_STATUS_META[t.status as TaskStatus] || TASK_STATUS_META.pending
                  const prog = safeJsonParse<TaskProgress>(t.progress, {})
                  // 钳制到 0~100, 防止 booksDone 计入更新导致超 100%
                  const pct = prog.contentTotal
                    ? Math.min(100, Math.round(((prog.contentDone || 0) / prog.contentTotal) * 100))
                    : prog.booksTotal
                      ? Math.min(100, Math.round(((prog.booksDone || 0) / prog.booksTotal) * 100))
                      : t.status === 'done'
                        ? 100
                        : 0
                  return (
                    <div key={t.id} className="rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-zinc-200" title={t.name}>
                          {t.name}
                        </span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${meta.className}`}>{meta.label}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
                        <span>
                          {t.rule?.name || '-'} · {PHASE_META[prog.phase || 'idle'] || ''}
                          {prog.phaseNote ? ` · ${prog.phaseNote}` : ''}
                        </span>
                        <span>{fmtDateTime(t.updatedAt)}</span>
                      </div>
                      <Progress value={pct} className="mt-2 h-1.5 bg-zinc-800" />
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* 最近入库 */}
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm text-zinc-200">最近入库书籍</CardTitle>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500 hover:text-zinc-200" onClick={() => onNavigate?.('books')}>
                查看全部
              </Button>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {!stats?.recentBooks?.length ? (
                <div className="py-8 text-center text-xs text-zinc-600">暂无书籍</div>
              ) : (
                <div className="admin-scroll max-h-64 space-y-2 overflow-y-auto">
                  {stats.recentBooks.map((b) => {
                    const meta = BOOK_STATUS_META[b.status] || BOOK_STATUS_META.unknown
                    return (
                      <div key={b.id} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
                        <div className="h-[53px] w-10 shrink-0 overflow-hidden rounded border border-zinc-800 bg-zinc-900">
                          {b.cover ? (
                            <img src={coverUrl(b.cover)} alt={b.name} className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">无封面</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-zinc-200">{b.name}</span>
                            <Badge variant="outline" className={`shrink-0 text-[10px] ${meta.className}`}>
                              {meta.label}
                            </Badge>
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500">
                            {b.author} · {b._count?.chapters || 0} 章 · {fmtDateTime(b.updatedAt)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 分类分布 */}
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-zinc-200">分类分布</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {!stats?.categories?.length ? (
                <div className="py-8 text-center text-xs text-zinc-600">暂无分类</div>
              ) : (
                <div className="admin-scroll max-h-64 space-y-2 overflow-y-auto pr-1">
                  {stats.categories.map((c) => {
                    const count = c._count?.books || 0
                    return (
                      <div key={c.id} className="flex items-center gap-3">
                        <span className="w-20 shrink-0 truncate text-right text-xs text-zinc-400" title={c.name}>
                          {c.name}
                        </span>
                        <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                            style={{ width: `${Math.round((count / maxCat) * 100)}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right font-mono text-xs text-zinc-500">{count}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
