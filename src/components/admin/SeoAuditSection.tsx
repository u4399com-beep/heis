'use client'

// ============================================================
// SEO 体检 — 后台区块
// 顶部摘要条 + 每站点卡片 (大字评分 + conic-gradient 圆环 + 问题时间轴 + 通过项折叠)
// 评分配色: ≥80 绿 / 60-79 琥珀 / <60 红
// feat-bb-2: 严重度筛选 toggle (全部 / 仅错误 / 错误+警告)
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  Filter,
  Globe,
  Info,
  Loader2,
  RefreshCw,
  Stethoscope,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, SEO_CATEGORY_META, type SeoAuditReport, type SeoAuditSite } from './helpers'

const ISSUE_SEVERITY_META: Record<string, { label: string; icon: typeof AlertCircle; iconClass: string; border: string; bg: string }> = {
  error: {
    label: '错误',
    icon: AlertCircle,
    iconClass: 'text-red-400',
    border: 'border-l-red-500',
    bg: 'bg-red-500/5',
  },
  warning: {
    label: '警告',
    icon: AlertTriangle,
    iconClass: 'text-amber-400',
    border: 'border-l-amber-500',
    bg: 'bg-amber-500/5',
  },
  info: {
    label: '提示',
    icon: Info,
    iconClass: 'text-sky-400',
    border: 'border-l-sky-500',
    bg: 'bg-sky-500/5',
  },
}

function scoreColor(score: number): { text: string; ring: string; bg: string; label: string } {
  if (score >= 80) return { text: 'text-emerald-400', ring: '#10b981', bg: 'bg-emerald-500/10', label: '优秀' }
  if (score >= 60) return { text: 'text-amber-400', ring: '#f59e0b', bg: 'bg-amber-500/10', label: '需改进' }
  return { text: 'text-red-400', ring: '#ef4444', bg: 'bg-red-500/10', label: '严重' }
}

function scoreGradient(score: number): string {
  // 圆环用 conic-gradient 实现: 0% 起 旋转到 (score/100)*360deg 用主色, 余下用 zinc-800
  const deg = Math.max(0, Math.min(100, score)) * 3.6
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'
  return `conic-gradient(${color} ${deg}deg, #3f3f46 ${deg}deg 360deg)`
}

export function SeoAuditSection({ onNavigateSites }: { onNavigateSites?: () => void }) {
  const [report, setReport] = useState<SeoAuditReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  // feat-bb-2: 严重度筛选 — 'all' / 'error' / 'warn+'
  const [sevFilter, setSevFilter] = useState<'all' | 'error' | 'warn+'>('all')

  const load = useCallback(async () => {
    setScanning(true)
    try {
      const r = await api.get<SeoAuditReport>('/api/admin/seo-audit')
      setReport(r)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'SEO 体检扫描失败')
    } finally {
      setLoading(false)
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // feat-bb-2: 应用严重度筛选 — 过滤后仅显示选中级别及更严重的问题
  const filterIssues = useCallback((issues: SeoAuditSite['issues']) => {
    if (sevFilter === 'all') return issues
    if (sevFilter === 'error') return issues.filter((i) => i.severity === 'error')
    // 'warn+' → 错误 + 警告
    return issues.filter((i) => i.severity === 'error' || i.severity === 'warning')
  }, [sevFilter])

  const summary = report?.summary
  const sites = report?.sites ?? []

  // 摘要数据
  const summaryCards = useMemo(() => {
    if (!summary) return []
    return [
      { key: 'total', label: '站点数', value: summary.totalSites, color: 'text-zinc-100', ring: 'border-zinc-700 bg-zinc-900/60' },
      { key: 'avg', label: '平均分', value: summary.avgScore, color: scoreColor(summary.avgScore).text, ring: 'border-zinc-700 bg-zinc-900/60' },
      { key: 'issues', label: '总问题', value: summary.totalIssues, color: 'text-amber-400', ring: 'border-amber-500/30 bg-amber-950/30' },
      { key: 'errors', label: '错误', value: summary.totalErrors, color: 'text-red-400', ring: 'border-red-500/30 bg-red-950/30' },
    ]
  }, [summary])

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <Stethoscope className="h-5 w-5 text-violet-400" />
            站点 SEO 体检
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            扫描所有站点的 SEO 配置, 发现问题与改进建议
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          onClick={load}
          disabled={scanning || loading}
        >
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          重新扫描
        </Button>
      </div>

      {/* feat-bb-2: 严重度筛选条 */}
      {!loading && sites.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
            <Filter className="h-3 w-3" />
            严重度:
          </span>
          {([
            { key: 'all', label: '全部', count: summary?.totalIssues ?? 0 },
            { key: 'error', label: '仅错误', count: summary?.totalErrors ?? 0 },
            { key: 'warn+', label: '错误+警告', count: (summary?.totalErrors ?? 0) + sites.reduce((s, site) => s + site.issues.filter((i) => i.severity === 'warning').length, 0) },
          ] as const).map((opt) => {
            const active = sevFilter === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSevFilter(opt.key)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                  active
                    ? 'border-violet-500/60 bg-violet-500/15 text-violet-200'
                    : 'border-zinc-700 bg-zinc-900/40 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                {opt.label}
                <span className="font-mono tabular-nums opacity-70">{opt.count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 摘要条 */}
      {loading ? (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex items-center justify-center py-12 text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在扫描站点 SEO 配置…
          </CardContent>
        </Card>
      ) : sites.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-zinc-500">
            <Globe className="h-8 w-8 text-zinc-600" aria-hidden />
            <p className="font-medium text-zinc-300">暂无站点</p>
            <p className="text-xs text-zinc-600">在站群系统中添加站点后即可进行 SEO 体检</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {summaryCards.map((s) => (
              <Card key={s.key} className={`border ${s.ring}`}>
                <CardContent className="py-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">{s.label}</div>
                  <div className={`mt-1 text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 站点卡片列表 */}
          <div className="space-y-3">
            {sites.map((site) => (
              <SiteAuditCard key={site.siteId} site={site} onNavigateSites={onNavigateSites} filterIssues={filterIssues} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// 单个站点卡片
// ============================================================
interface SiteAuditCardProps {
  site: SeoAuditSite
  onNavigateSites?: () => void
  // feat-bb-2: 严重度筛选函数 (父级传入, 卡片仅渲染过滤后的问题)
  filterIssues?: (issues: SeoAuditSite['issues']) => SeoAuditSite['issues']
}
function SiteAuditCard({ site, onNavigateSites, filterIssues }: SiteAuditCardProps) {
  const [passedOpen, setPassedOpen] = useState(false)
  const sc = scoreColor(site.score)
  const errorCount = site.issues.filter((i) => i.severity === 'error').length
  const warnCount = site.issues.filter((i) => i.severity === 'warning').length
  const infoCount = site.issues.filter((i) => i.severity === 'info').length
  // feat-bb-2: 过滤后的问题列表 (未筛选时与原数组相同)
  const visibleIssues = useMemo(
    () => (filterIssues ? filterIssues(site.issues) : site.issues),
    [filterIssues, site.issues],
  )
  const hiddenCount = site.issues.length - visibleIssues.length

  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardContent className="p-4 lg:p-6">
        {/* 头部: 站点名 + 域名 + 评分环 */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 shrink-0 text-zinc-500" />
              <h3 className="truncate text-sm font-semibold text-zinc-100">{site.siteName}</h3>
              <Badge variant="outline" className="border-zinc-700 bg-zinc-900 font-mono text-[10px] text-zinc-400">
                {site.domain}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge className={`border ${sc.bg} border-zinc-700 ${sc.text}`}>{sc.label}</Badge>
              {errorCount > 0 && (
                <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300">
                  <AlertCircle className="h-3 w-3" />
                  {errorCount} 错误
                </Badge>
              )}
              {warnCount > 0 && (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                  <AlertTriangle className="h-3 w-3" />
                  {warnCount} 警告
                </Badge>
              )}
              {infoCount > 0 && (
                <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-300">
                  <Info className="h-3 w-3" />
                  {infoCount} 提示
                </Badge>
              )}
              {onNavigateSites && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-200"
                  onClick={onNavigateSites}
                >
                  前往站点设置
                </Button>
              )}
            </div>
          </div>

          {/* 评分环 */}
          <div className="flex items-center gap-3">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <div
                className="absolute inset-0 rounded-full"
                style={{ background: scoreGradient(site.score) }}
                aria-hidden
              />
              <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-zinc-950">
                <div className="text-center">
                  <div className={`text-2xl font-bold tabular-nums ${sc.text}`}>{site.score}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 问题列表 */}
        {site.issues.length === 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-300">
            <Check className="h-4 w-4" />
            未发现任何 SEO 问题, 配置完整
          </div>
        ) : visibleIssues.length === 0 ? (
          // feat-bb-2: 严重度筛选后无匹配 (但站点存在问题)
          <div className="mt-4 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
            <Info className="h-4 w-4" />
            当前筛选条件下无可显示问题 (共 {site.issues.length} 项被过滤)
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {/* feat-bb-2: 被筛选隐藏的数量提示 */}
            {hiddenCount > 0 && (
              <div className="text-[11px] text-zinc-500">
                <Filter className="mr-1 inline h-3 w-3 align-text-bottom" />
                已隐藏 {hiddenCount} 项低严重度问题
              </div>
            )}
            {visibleIssues.map((it, i) => {
              const meta = ISSUE_SEVERITY_META[it.severity]
              const cat = SEO_CATEGORY_META[it.category] || { label: it.category, className: '' }
              const Icon = meta.icon
              return (
                <div
                  key={`${it.category}-${i}`}
                  className={`flex items-start gap-3 rounded-md border border-zinc-800 border-l-2 ${meta.border} ${meta.bg} p-3`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.iconClass}`} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={`border ${cat.className}`}>{cat.label}</Badge>
                      {/* feat-bb-2: 严重度徽章 (与图标颜色一致的独立徽章) */}
                      <Badge variant="outline" className={`border-zinc-700 ${meta.bg} ${meta.iconClass}`}>
                        {meta.label}
                      </Badge>
                      <span className="text-xs font-medium text-zinc-200">{it.message}</span>
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      <span className="text-zinc-400">建议: </span>
                      {it.fix}
                    </div>
                  </div>
                  {/* feat-bb-2: 修复建议 tooltip — 鼠标悬停看完整建议 (移动端长文本可见) */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 cursor-help rounded-full p-1 text-zinc-500 hover:bg-zinc-800 hover:text-violet-300"
                        aria-label="查看修复建议"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs text-xs">
                      <div className="font-medium text-zinc-300">修复建议</div>
                      <div className="mt-1 text-zinc-400">{it.fix}</div>
                      <div className="mt-1.5 text-[10px] text-zinc-500">类别: {cat.label} · 严重度: {meta.label}</div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )
            })}
          </div>
        )}

        {/* 通过项折叠 */}
        {site.passed.length > 0 && (
          <Collapsible open={passedOpen} onOpenChange={setPassedOpen} className="mt-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${passedOpen ? 'rotate-180' : ''}`} />
                查看通过项 {site.passed.length} 项
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 grid grid-cols-1 gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-2">
                {site.passed.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
