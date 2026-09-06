'use client'

// ============================================================
// TXT 下载区块 — 左侧生成表单 / 右侧任务列表(3s轮询)
// 批量操作: 全选/行复选框 + 批量删除/批量重试(仅失败)/批量重新生成(仅完成)
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from './ConfirmDialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, FileDown, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  BatchActionButton,
  BatchBar,
  BatchCheckbox,
  runBatch,
  useBatchSelection,
} from './batch'
import {
  api,
  fmtBytes,
  fmtDateTime,
  fmtNum,
  safeJsonParse,
  type BookListRow,
  type DownloadJobRow,
} from './helpers'

interface DownloadJobOptions {
  siteInfo?: boolean
  siteName?: string
  siteUrl?: string
  insertAds?: boolean
  ads?: string[]
  adInterval?: number
  obfuscate?: boolean
  obfuscateMode?: string
  obfuscateDensity?: number
  headerTemplate?: string
  footerTemplate?: string
}

interface DownloadsSectionProps {
  /** 从书籍管理跳转过来时预选的书籍 */
  preselectBookId?: string | null
  onConsumedPreselect?: () => void
}

const OBFUSCATE_MODES: { value: string; label: string }[] = [
  { value: 'zero-width', label: '零宽字符 (肉眼不可见)' },
  { value: 'homoglyph', label: '同形字替换' },
  { value: 'punctuation', label: '标点扰动' },
  { value: 'mixed', label: '混合模式' },
]

export function DownloadsSection({ preselectBookId, onConsumedPreselect }: DownloadsSectionProps) {
  // 书籍选择
  const [books, setBooks] = useState<BookListRow[]>([])
  const [bookQuery, setBookQuery] = useState('')
  const [bookId, setBookId] = useState('')

  // 表单
  const [siteInfo, setSiteInfo] = useState(true)
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [insertAds, setInsertAds] = useState(false)
  const [adsText, setAdsText] = useState('本书由 {site} 收录整理, 更多精彩好书请访问本站。')
  const [adInterval, setAdInterval] = useState(10)
  const [obfuscate, setObfuscate] = useState(false)
  const [obfuscateMode, setObfuscateMode] = useState('zero-width')
  const [densityPercent, setDensityPercent] = useState(5)
  const [headerTemplate, setHeaderTemplate] = useState('《{book}》\n作者: {author}\n来源: {site}\n\n简介: {intro}')
  const [footerTemplate, setFooterTemplate] = useState('\n— 全书完 · 访问 {site} 阅读更多 —')

  const [jobs, setJobs] = useState<DownloadJobRow[]>([])
  const [generating, setGenerating] = useState(false)
  const [deleting, setDeleting] = useState<DownloadJobRow | null>(null)

  // ---- 批量操作状态(有进行中任务时轮询刷新不丢已选) ----
  const jobIds = useMemo(() => jobs.map((j) => j.id), [jobs])
  const batch = useBatchSelection(jobIds)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const jobsPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const aliveRef = useRef(true)

  // 卸载后停止异步 setState
  useEffect(() => {
    return () => {
      aliveRef.current = false
    }
  }, [])

  const loadBooks = useCallback(async (q?: string) => {
    try {
      const data = await api.get<{ books: BookListRow[] }>('/api/admin/books', { page: 1, size: 50, q: q || undefined })
      if (!aliveRef.current) return
      setBooks(data.books || [])
    } catch {
      if (aliveRef.current) setBooks([])
    }
  }, [])

  const loadJobs = useCallback(async (silent = false) => {
    try {
      const data = await api.get<DownloadJobRow[]>('/api/admin/downloads')
      if (!aliveRef.current) return
      setJobs(Array.isArray(data) ? data : [])
    } catch (e) {
      if (!silent && aliveRef.current) toast.error(e instanceof Error ? e.message : '加载下载任务失败')
    }
  }, [])

  const loadSiteDefaults = useCallback(async () => {
    try {
      const settings = await api.get<Record<string, unknown>>('/api/admin/settings')
      const dl = safeJsonParse<{ siteName?: string; siteUrl?: string }>(typeof settings.download === 'string' ? settings.download : JSON.stringify(settings.download || null), {})
      if (!aliveRef.current) return
      if (dl?.siteName) setSiteName(dl.siteName)
      if (dl?.siteUrl) setSiteUrl(dl.siteUrl)
    } catch {
      /* 忽略 */
    }
  }, [])

  useEffect(() => {
    loadBooks()
    loadJobs()
    loadSiteDefaults()
  }, [loadBooks, loadJobs, loadSiteDefaults])

  // 预选书籍
  useEffect(() => {
    if (preselectBookId) {
      setBookId(preselectBookId)
      onConsumedPreselect?.()
    }
  }, [preselectBookId, onConsumedPreselect])

  // 轮询: 有进行中任务时 3s 刷新
  useEffect(() => {
    const active = jobs.some((j) => j.status === 'pending' || j.status === 'running')
    if (active) {
      jobsPollRef.current = setInterval(() => loadJobs(true), 3000)
    }
    return () => {
      if (jobsPollRef.current) clearInterval(jobsPollRef.current)
    }
  }, [jobs, loadJobs])

  const generate = async () => {
    if (!bookId) {
      toast.error('请选择要生成的书籍')
      return
    }
    // 后端校验站点URL必须带协议, 这里自动补全, 避免 www.a.com 直接被拒
    const siteUrlTrim = siteUrl.trim()
    const normalizedSiteUrl = siteUrlTrim && !/^https?:\/\//i.test(siteUrlTrim) ? `https://${siteUrlTrim}` : siteUrlTrim
    setGenerating(true)
    try {
      await api.post('/api/admin/downloads', {
        bookId,
        siteInfo,
        siteName,
        siteUrl: normalizedSiteUrl,
        insertAds,
        ads: adsText.split('\n').map((l) => l.trim()).filter(Boolean),
        adInterval,
        obfuscate,
        obfuscateMode,
        obfuscateDensity: densityPercent / 100,
        headerTemplate,
        footerTemplate,
      })
      toast.success('生成任务已创建, 正在后台合成 TXT')
      setBookId('')
      await loadJobs(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建生成任务失败')
    } finally {
      setGenerating(false)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await api.del(`/api/admin/downloads/${deleting.id}`)
      toast.success('下载记录已删除')
      setDeleting(null)
      loadJobs(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  // ---- 批量动作: delete 删记录+成品文件; retry/regenerate 委托服务端复用既有 POST 建新任务 ----
  const runJobsBatch = async (action: string, describe: (n: number) => string) => {
    setBatchRunning(true)
    try {
      const res = await runBatch('/api/admin/downloads/batch', { action, ids: batch.selectedOrdered }, (r) => describe(r.affected ?? 0))
      if (res) {
        batch.clearSelection()
        await loadJobs(true)
      }
    } finally {
      setBatchRunning(false)
    }
  }

  const downloadFile = (id: string) => {
    window.open(`/api/public/download?id=${encodeURIComponent(id)}`, '_blank')
  }

  const selectedBook = useMemo(() => books.find((b) => b.id === bookId), [books, bookId])

  const JOB_STATUS: Record<string, { label: string; className: string }> = {
    pending: { label: '排队中', className: 'bg-zinc-700/60 text-zinc-300 border-zinc-600' },
    running: { label: '生成中', className: 'bg-violet-500/15 text-violet-400 border-violet-500/40' },
    done: { label: '已完成', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' },
    error: { label: '失败', className: 'bg-red-500/15 text-red-400 border-red-500/40' },
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <FileDown className="h-5 w-5 text-violet-400" />
          TXT 下载
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">将书籍合成为带站点信息 / 广告 / 反盗版混淆的 TXT 成品</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 表单 */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <Sparkles className="h-4 w-4 text-amber-400" />
              生成选项
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">选择书籍 *</Label>
              <div className="flex gap-2">
                <Input
                  className="h-9 flex-1 border-zinc-700 bg-zinc-950 text-sm"
                  placeholder="搜索书名后刷新列表…"
                  value={bookQuery}
                  onChange={(e) => setBookQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadBooks(bookQuery.trim())}
                />
                <Button variant="outline" size="sm" className="h-9 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={() => loadBooks(bookQuery.trim())}>
                  搜索
                </Button>
              </div>
              {/* bookId 为空串时 Radix 也会显示 placeholder, 且保持始终受控(避免 uncontrolled→controlled 告警) */}
              <Select value={bookId} onValueChange={setBookId}>
                <SelectTrigger className="h-9 border-zinc-700 bg-zinc-950 text-sm">
                  <SelectValue placeholder="选择要生成的书籍" />
                </SelectTrigger>
                <SelectContent>
                  {books.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-sm">
                      {b.name} · {b.author} ({b._count?.chapters || 0}章)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">注入站点信息</span>
                <Switch checked={siteInfo} onCheckedChange={setSiteInfo} />
              </div>
              {siteInfo && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Input className="h-8 border-zinc-700 bg-zinc-950 text-xs" placeholder="站点名称" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
                  <Input className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs" placeholder="站点域名 www.a.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
                </div>
              )}
            </div>

            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">插入广告文案</span>
                <Switch checked={insertAds} onCheckedChange={setInsertAds} />
              </div>
              {insertAds && (
                <div className="mt-3 space-y-2">
                  <Textarea
                    className="admin-scroll max-h-28 min-h-16 border-zinc-700 bg-zinc-950 text-xs"
                    placeholder="每行一条广告文案, 支持 {site} 变量"
                    value={adsText}
                    onChange={(e) => setAdsText(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Label className="shrink-0 text-xs text-zinc-500">每</Label>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-20 border-zinc-700 bg-zinc-950 text-xs"
                      value={adInterval}
                      onChange={(e) => setAdInterval(Math.max(1, Number(e.target.value) || 10))}
                    />
                    <span className="text-xs text-zinc-500">章插入一次</span>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">文本混淆 (反盗版采集)</span>
                <Switch checked={obfuscate} onCheckedChange={setObfuscate} />
              </div>
              {obfuscate && (
                <div className="mt-3 space-y-3">
                  <Select value={obfuscateMode} onValueChange={setObfuscateMode}>
                    <SelectTrigger className="h-8 border-zinc-700 bg-zinc-950 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OBFUSCATE_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value} className="text-xs">
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>混淆密度</span>
                      <span className="font-mono text-violet-300">{densityPercent}%</span>
                    </div>
                    <Slider min={0} max={30} step={1} value={[densityPercent]} onValueChange={([v]) => setDensityPercent(v)} />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-zinc-400">
                自定义头尾模板 <span className="text-zinc-600">变量: {'{book} {author} {site} {intro}'}</span>
              </Label>
              <Textarea
                className="admin-scroll max-h-24 min-h-14 border-zinc-700 bg-zinc-950 font-mono text-xs"
                placeholder="文件开头模板"
                value={headerTemplate}
                onChange={(e) => setHeaderTemplate(e.target.value)}
              />
              <Textarea
                className="admin-scroll max-h-24 min-h-14 border-zinc-700 bg-zinc-950 font-mono text-xs"
                placeholder="文件结尾模板"
                value={footerTemplate}
                onChange={(e) => setFooterTemplate(e.target.value)}
              />
            </div>

            <Button className="w-full gap-1.5" onClick={generate} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              生成 TXT 成品
            </Button>
            {selectedBook && <p className="text-center text-[11px] text-zinc-600">将使用《{selectedBook.name}》共 {fmtNum(selectedBook._count?.chapters || 0)} 章生成</p>}
          </CardContent>
        </Card>

        {/* 任务列表 */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm text-zinc-200">生成任务</CardTitle>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-zinc-500 hover:text-zinc-200" onClick={() => loadJobs()}>
              <RefreshCw className="h-3 w-3" />
              刷新
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {/* 批量操作条(已选>0 时出现) */}
            <BatchBar count={batch.selectedCount} onClear={batch.clearSelection} hint="重试仅失败可用 / 重新生成仅完成可用">
              <BatchActionButton
                running={batchRunning}
                className="text-red-400 hover:text-red-300"
                onClick={() => setBatchConfirmOpen(true)}
              >
                <Trash2 className="h-3 w-3" />
                删除
              </BatchActionButton>
              <BatchActionButton
                running={batchRunning}
                className="text-amber-400 hover:text-amber-300"
                onClick={() => void runJobsBatch('retry', (n) => `已为 ${n} 个失败任务重建生成作业`)}
              >
                重试失败
              </BatchActionButton>
              <BatchActionButton
                running={batchRunning}
                className="text-violet-400 hover:text-violet-300"
                onClick={() => void runJobsBatch('regenerate', (n) => `已为 ${n} 个已完成任务重新生成`)}
              >
                重新生成
              </BatchActionButton>
            </BatchBar>
            {jobs.length === 0 ? (
              <div className="py-16 text-center text-sm text-zinc-500">暂无生成任务, 从左侧表单发起第一次生成</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="w-9 pr-0">
                      <BatchCheckbox
                        checked={batch.allSelected}
                        indeterminate={batch.indeterminate}
                        onCheckedChange={batch.toggleAll}
                        ariaLabel="全选下载任务"
                      />
                    </TableHead>
                    <TableHead className="text-xs text-zinc-500">书籍</TableHead>
                    <TableHead className="text-xs text-zinc-500">状态</TableHead>
                    <TableHead className="text-xs text-zinc-500">大小</TableHead>
                    <TableHead className="hidden text-xs text-zinc-500 sm:table-cell">时间</TableHead>
                    <TableHead className="text-right text-xs text-zinc-500">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => {
                    const meta = JOB_STATUS[j.status] || JOB_STATUS.pending
                    const opts = safeJsonParse<DownloadJobOptions>(j.options, {})
                    return (
                      <TableRow key={j.id} className="border-zinc-800/70">
                        <TableCell className="pr-0">
                          <BatchCheckbox
                            checked={batch.selected.has(j.id)}
                            onCheckedChange={() => batch.toggle(j.id)}
                            ariaLabel={`选择《${j.book?.name || '下载任务'}》的生成记录`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[180px] truncate text-sm text-zinc-200" title={j.book?.name}>
                            {j.book?.name || '-'}
                          </div>
                          <div className="text-[11px] text-zinc-600">
                            {opts.obfuscate ? `混淆:${opts.obfuscateMode || '-'} ` : ''}
                            {opts.insertAds ? '广告' : ''}
                            {opts.siteInfo ? ' 站点信息' : ''}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}>
                            {(j.status === 'pending' || j.status === 'running') && <Loader2 className="h-3 w-3 animate-spin" />}
                            {meta.label}
                          </span>
                          {j.status === 'error' && (
                            <div className="mt-1 max-w-[160px] truncate text-[10px] text-red-400/80" title={j.error || ''}>
                              {j.error || ''}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-zinc-400">{j.size ? fmtBytes(j.size) : '-'}</TableCell>
                        <TableCell className="hidden text-xs text-zinc-500 sm:table-cell">{fmtDateTime(j.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                              disabled={j.status !== 'done'}
                              title={j.status === 'done' ? '新窗口下载' : '生成完成后可下载'}
                              onClick={() => downloadFile(j.id)}
                            >
                              <Download className="h-3 w-3" />
                              下载
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400/80 hover:text-red-400" onClick={() => setDeleting(j)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={batchConfirmOpen}
        onOpenChange={setBatchConfirmOpen}
        title={`确认批量删除 ${batch.selectedCount} 条下载记录?`}
        description="将删除所选生成记录及成品文件, 需要时可重新生成。"
        confirmText="删除"
        onConfirm={() => {
          setBatchConfirmOpen(false)
          void runJobsBatch('delete', (n) => `已删除 ${n} 条下载记录及成品文件`)
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="确认删除下载记录?"
        description={`将删除《${deleting?.book?.name}》的生成记录及成品文件, 需要时可重新生成。`}
        confirmText="删除"
        onConfirm={doDelete}
      />

      <div className="flex justify-end">
        <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-[10px] text-zinc-600">
          成品存放于 data/downloads 目录, 有进行中任务时每 3 秒自动刷新
        </Badge>
      </div>
    </div>
  )
}
