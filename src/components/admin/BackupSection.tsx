'use client'

// ============================================================
// 数据备份 — 后台区块
// 两张并排卡片: 导出 (violet) + 导入 (sky)
// - 导出: 显示当前数据库计数 + 文件大小估算 + 一键下载按钮
// - 导入: 拖拽 / 选择文件 → 预览 (version/exportedAt/counts) → 选择模式
//        (合并 upsert / 替换 delete-first 危险) → 二次确认 → POST → toast
// - 导入历史: localStorage 保存最近 5 条
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfirmDialog } from './ConfirmDialog'
import {
  AlertTriangle,
  CalendarClock,
  Database,
  Download,
  FileJson,
  History,
  Loader2,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type BackupFile, type RestoreResult, type StatsData } from './helpers'

interface HistoryEntry {
  filename: string
  timestamp: string
  counts?: Record<string, number>
  mode: string
  took: number
}

const HISTORY_KEY = 'heis-backup-history'
const HISTORY_LIMIT = 5
const LAST_EXPORT_KEY = 'heis-last-export'
// 建议备份间隔: 7 天 (超过该阈值在顶部显示提醒)
const STALE_BACKUP_DAYS = 7

interface LastExport {
  ts: number
  estBytes: number
}

export function BackupSection() {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // ---- import state ----
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<BackupFile | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [restoring, setRestoring] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // ---- import history ----
  const [history, setHistory] = useState<HistoryEntry[]>([])
  // feat-bb-2: 最近一次导出记录 (localStorage; 用于顶部「上次备份」提醒)
  const [lastExport, setLastExport] = useState<LastExport | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 加载基础统计 + 历史
  useEffect(() => {
    ;(async () => {
      try {
        const s = await api.get<StatsData>('/api/admin/stats')
        setStats(s)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载统计失败')
      } finally {
        setLoading(false)
      }
    })()
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) setHistory(JSON.parse(raw))
    } catch {
      /* 忽略 localStorage 损坏 */
    }
    try {
      const raw = localStorage.getItem(LAST_EXPORT_KEY)
      if (raw) setLastExport(JSON.parse(raw) as LastExport)
    } catch {
      /* 忽略 localStorage 损坏 */
    }
  }, [])

  // feat-bb-2: 备份过期提醒 (上次导出超过 STALE_BACKUP_DAYS 天)
  const staleBackupDays = lastExport
    ? Math.floor((Date.now() - lastExport.ts) / (24 * 60 * 60 * 1000))
    : null
  const isStale = staleBackupDays !== null && staleBackupDays >= STALE_BACKUP_DAYS

  /** 估算备份体积 (书籍 * 1.2 KB + 章节 * 1.5 KB + 其他基础 5 KB) */
  const estimatedBytes = (() => {
    if (!stats) return 0
    return (
      5 * 1024 +
      stats.books * 1.2 * 1024 +
      stats.chapters * 1.5 * 1024 +
      stats.rules * 8 * 1024 +
      stats.sites * 2 * 1024
    )
  })()

  const doExport = async () => {
    setExporting(true)
    try {
      // 后端返回 Content-Disposition, 浏览器收到 attachment 自动下载
      // 用 location 触发整页跳转 (带 cookie), 比 fetch + Blob 简单且不占内存
      window.location.href = '/api/admin/backup'
      toast.success('开始导出数据库, 文件将通过浏览器下载')
      // feat-bb-2: 记录本次导出时间到 localStorage (用于「上次备份」提醒)
      const entry: LastExport = { ts: Date.now(), estBytes: estimatedBytes }
      setLastExport(entry)
      try {
        localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify(entry))
      } catch {
        /* 静默 */
      }
    } finally {
      // 状态恢复: 等待浏览器开始跳转后清除按钮 loading
      setTimeout(() => setExporting(false), 1500)
    }
  }

  const parseFile = useCallback(async (f: File | null) => {
    if (!f) return
    if (f.size > 200 * 1024 * 1024) {
      setParseError('文件过大 (>200MB), 拒绝导入')
      setFile(null)
      setParsed(null)
      return
    }
    setFile(f)
    setParsed(null)
    setParseError(null)
    try {
      const text = await f.text()
      const obj = JSON.parse(text) as BackupFile
      if (typeof obj.version !== 'number') {
        throw new Error('缺少 version 字段, 不是有效的备份文件')
      }
      if (obj.version !== 1) {
        throw new Error(`备份版本 ${obj.version} 不被支持 (当前仅支持 v1)`)
      }
      if (!obj.data || typeof obj.data !== 'object') {
        throw new Error('缺少 data 字段, 不是有效的备份文件')
      }
      setParsed(obj)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : '文件解析失败')
      setParsed(null)
    }
  }, [])

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    void parseFile(f)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0] || null
    void parseFile(f)
  }

  const resetImport = () => {
    setFile(null)
    setParsed(null)
    setParseError(null)
    setMode('merge')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const appendHistory = (entry: HistoryEntry) => {
    const next = [entry, ...history].slice(0, HISTORY_LIMIT)
    setHistory(next)
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    } catch {
      /* 静默 */
    }
  }

  const doRestore = async () => {
    if (!parsed || !file) return
    setRestoring(true)
    try {
      const text = await file.text()
      const backup = JSON.parse(text) as BackupFile
      const result = await api.post<RestoreResult>('/api/admin/backup/restore', {
        data: backup,
        mode,
      })
      toast.success(
        `导入完成 · 书籍 ${result.imported.books} / 章节 ${result.imported.chapters} / 规则 ${result.imported.rules} · 耗时 ${(result.took / 1000).toFixed(1)}s`,
      )
      if (result.warnings.length > 0) {
        toast.warning(`导入过程产生 ${result.warnings.length} 条警告, 详情见日志`)
      }
      appendHistory({
        filename: file.name,
        timestamp: new Date().toISOString(),
        counts: parsed.counts,
        mode: mode === 'merge' ? '合并' : '替换',
        took: result.took,
      })
      resetImport()
      // 重新拉取 stats 以反映新数据
      try {
        const s = await api.get<StatsData>('/api/admin/stats')
        setStats(s)
      } catch {
        /* 静默 */
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败')
    } finally {
      setRestoring(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Database className="h-5 w-5 text-violet-400" />
          数据备份
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          一键导出全库为 JSON, 或从备份文件恢复; 支持合并 (保留现有) / 替换 (覆盖全部) 两种模式
        </p>
      </div>

      {/* feat-bb-2: 上次备份时间 + 自动提醒 */}
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="cursor-help border-zinc-700 bg-zinc-900/60 text-xs text-zinc-300">
              <CalendarClock className="h-3 w-3 text-violet-400" />
              {lastExport
                ? `上次备份: ${new Date(lastExport.ts).toLocaleString('zh-CN')} · 估算 ${formatBytes(lastExport.estBytes)}`
                : '本地未记录备份历史'}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <div>记录于浏览器 localStorage, 仅本机可见</div>
            <div className="text-zinc-400">建议每周备份一次, 重大变更前主动备份</div>
          </TooltipContent>
        </Tooltip>
        {isStale && staleBackupDays !== null && (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-xs text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            {staleBackupDays >= 30 ? `已 ${staleBackupDays} 天未备份, 强烈建议立即备份` : `已 ${staleBackupDays} 天未备份, 建议再次备份`}
          </Badge>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="cursor-help border-zinc-700 bg-zinc-900/60 text-xs text-zinc-400">
              <CalendarClock className="h-3 w-3" />
              建议每 7 天备份一次
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <div>当前未启用服务端定时备份</div>
            <div className="text-zinc-400">可手动定期访问本页发起导出</div>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* 顶部统计 + 估算 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <StatPill label="书籍" value={stats?.books} loading={loading} />
        <StatPill label="章节" value={stats?.chapters} loading={loading} />
        <StatPill label="规则" value={stats?.rules} loading={loading} />
        <StatPill label="任务" value={stats?.tasks} loading={loading} />
        <StatPill label="站点" value={stats?.sites} loading={loading} />
        <StatPill label="分类" value={stats?.categories?.length} loading={loading} />
        <StatPill label="下载任务" value={stats?.downloads} loading={loading} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 导出卡片 (violet) */}
        <Card className="border-violet-500/30 bg-violet-950/10">
          <CardContent className="p-6">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-500/15 ring-1 ring-violet-500/40">
                <Download className="h-5 w-5 text-violet-300" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-100">导出完整数据库</h3>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  导出全部书库、规则、任务、站点、设置等数据为 JSON 文件, 可用于迁移或备份
                </p>
              </div>
            </div>

            <div className="mb-4 space-y-2 rounded-md border border-violet-500/20 bg-zinc-950/40 p-3 text-xs">
              <Row label="包含内容">
                设置 · 分类 · 站点 · 友链 · 规则 · 书籍(含章节+标签) · 任务 · 下载任务
              </Row>
              <Row label="任务日志">
                不导出 (体积过大, 通常数万行)
              </Row>
              <Row label="大库降级">
                书籍 &gt; 500 时仅导出元数据, 跳过章节正文
              </Row>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-200">
                <FileJson className="h-3 w-3" />
                预估 {formatBytes(estimatedBytes)}
              </Badge>
              {stats && stats.books > 500 && (
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-200">
                  <AlertTriangle className="h-3 w-3" />
                  大库模式
                </Badge>
              )}
            </div>

            <Alert className="border-amber-500/30 bg-amber-950/30 text-amber-200">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle className="text-xs font-medium">导出文件包含全部书库数据, 请妥善保管</AlertTitle>
              <AlertDescription className="text-[11px] text-amber-200/70">
                建议存放于离线位置, 不要上传到公开仓库
              </AlertDescription>
            </Alert>

            <Button
              className="mt-4 w-full gap-1.5 bg-violet-600 hover:bg-violet-500"
              onClick={doExport}
              disabled={exporting || loading}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? '准备下载…' : '导出完整数据库'}
            </Button>
          </CardContent>
        </Card>

        {/* 导入卡片 (sky) */}
        <Card className="border-sky-500/30 bg-sky-950/10">
          <CardContent className="p-6">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/40">
                <Upload className="h-5 w-5 text-sky-300" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-100">导入备份文件</h3>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  选择或拖入 .json 备份文件, 预览后选择导入模式并确认
                </p>
              </div>
            </div>

            {/* 拖拽区 */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`mb-4 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed p-6 text-center transition-colors ${
                dragOver
                  ? 'border-sky-400 bg-sky-500/15'
                  : 'border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900'
              }`}
            >
              <FileJson className="h-7 w-7 text-sky-400/70" />
              <div className="text-xs font-medium text-zinc-300">
                {file ? file.name : '点击选择或拖入 .json 备份文件'}
              </div>
              {file && (
                <div className="text-[10px] text-zinc-500">
                  {formatBytes(file.size)}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={onFileInput}
              />
            </div>

            {/* 错误提示 */}
            {parseError && (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-xs font-medium">文件解析失败</AlertTitle>
                <AlertDescription className="text-[11px]">{parseError}</AlertDescription>
              </Alert>
            )}

            {/* 预览 */}
            {parsed && (
              <div className="mb-4 space-y-2 rounded-md border border-sky-500/20 bg-zinc-950/40 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">备份版本</span>
                  <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-200">
                    v{parsed.version}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">导出时间</span>
                  <span className="font-mono text-zinc-300">
                    {parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('zh-CN') : '-'}
                  </span>
                </div>
                {parsed.warnings && parsed.warnings.length > 0 && (
                  <div className="rounded border border-amber-500/30 bg-amber-950/30 p-2 text-[11px] text-amber-200/80">
                    {parsed.warnings.map((w, i) => (
                      <div key={i}>⚠ {w}</div>
                    ))}
                  </div>
                )}
                {parsed.counts && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Object.entries(parsed.counts).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
                        {COUNT_LABEL[k] || k}: {v}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 模式选择 */}
            {parsed && (
              <div className="mb-4">
                <Label className="mb-2 text-xs font-medium text-zinc-300">导入模式</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as 'merge' | 'replace')}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                >
                  <label
                    htmlFor="mode-merge"
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors ${
                      mode === 'merge'
                        ? 'border-sky-500/60 bg-sky-500/10'
                        : 'border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900'
                    }`}
                  >
                    <RadioGroupItem value="merge" id="mode-merge" className="mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-zinc-200">合并 (upsert)</div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                        按 id 逐条创建或更新, 保留原有数据; 同 id 的记录会被覆盖
                      </div>
                    </div>
                  </label>
                  <label
                    htmlFor="mode-replace"
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors ${
                      mode === 'replace'
                        ? 'border-red-500/60 bg-red-500/10'
                        : 'border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900'
                    }`}
                  >
                    <RadioGroupItem value="replace" id="mode-replace" className="mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-1 text-xs font-medium text-red-300">
                        <AlertTriangle className="h-3 w-3" />
                        替换 (危险)
                      </div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                        先删除全表数据再插入, 不可恢复; 适用于完整克隆部署
                      </div>
                    </div>
                  </label>
                </RadioGroup>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
                onClick={resetImport}
                disabled={!file || restoring}
              >
                清除
              </Button>
              <Button
                size="sm"
                className={`flex-1 gap-1.5 ${
                  mode === 'replace'
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-sky-600 hover:bg-sky-500'
                }`}
                disabled={!parsed || restoring}
                onClick={() => setConfirmOpen(true)}
              >
                {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {mode === 'replace' ? '覆盖导入' : '合并导入'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 导入历史 */}
      {history.length > 0 && (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-200">
              <History className="h-4 w-4 text-zinc-400" />
              导入历史 (本地)
            </div>
            <div className="space-y-1.5">
              {history.map((h, i) => (
                <div
                  key={`${h.timestamp}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileJson className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <span className="truncate font-mono text-zinc-300" title={h.filename}>
                      {h.filename}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-zinc-500">
                    <Badge
                      variant="outline"
                      className={
                        h.mode === '替换'
                          ? 'border-red-500/40 bg-red-500/10 text-red-300'
                          : 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                      }
                    >
                      {h.mode}
                    </Badge>
                    <span className="font-mono">{new Date(h.timestamp).toLocaleString('zh-CN')}</span>
                    <span>{(h.took / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-zinc-500 hover:text-zinc-300"
                onClick={() => {
                  setHistory([])
                  try {
                    localStorage.removeItem(HISTORY_KEY)
                  } catch {
                    /* 静默 */
                  }
                }}
              >
                清空历史
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (!v) setConfirmOpen(false)
        }}
        title={mode === 'replace' ? '确认覆盖导入' : '确认合并导入'}
        description={
          mode === 'replace' ? (
            <span className="space-y-1">
              <span className="block">替换模式将先删除全部现有数据再插入备份内容, 不可恢复。</span>
              <span className="block">建议在执行前再次导出当前数据库作为安全副本。</span>
              {parsed?.counts && (
                <span className="mt-2 block rounded border border-red-500/30 bg-red-950/30 p-2 text-red-200">
                  即将删除现有全部数据, 导入: 书籍 {parsed.counts.books || 0} / 章节 {parsed.counts.chapters || 0} / 规则 {parsed.counts.rules || 0}
                </span>
              )}
            </span>
          ) : (
            <span className="space-y-1">
              <span className="block">合并模式将按 id upsert, 同 id 的现有记录会被覆盖。</span>
              {parsed?.counts && (
                <span className="mt-2 block rounded border border-sky-500/30 bg-sky-950/30 p-2 text-sky-200">
                  即将导入: 书籍 {parsed.counts.books || 0} / 章节 {parsed.counts.chapters || 0} / 规则 {parsed.counts.rules || 0}
                </span>
              )}
            </span>
          )
        }
        confirmText={mode === 'replace' ? '确认覆盖' : '确认合并'}
        tone={mode === 'replace' ? 'danger' : 'amber'}
        loading={restoring}
        onConfirm={doRestore}
      />
    </div>
  )
}

// ---------------- helpers ----------------

const COUNT_LABEL: Record<string, string> = {
  settings: '设置',
  categories: '分类',
  sites: '站点',
  friendLinks: '友链',
  rules: '规则',
  books: '书籍',
  chapters: '章节',
  tasks: '任务',
  downloadJobs: '下载',
}

function StatPill({
  label,
  value,
  loading,
}: {
  label: string
  value?: number
  loading: boolean
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-zinc-200">
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-zinc-500" /> : (value ?? 0).toLocaleString('zh-CN')}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="text-right text-zinc-300">{children}</span>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
