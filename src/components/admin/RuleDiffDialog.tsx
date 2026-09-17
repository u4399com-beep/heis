'use client'

// ============================================================
// RuleDiffDialog — 规则对比工具 (agent-PP-ui5)
// 选择两条规则, 并排展示四段 list/book/toc/content + fetch/clean 配置,
// 字段级差异高亮(改前红 / 改后绿 / 仅一侧灰), 帮助决定从哪条规则迁移字段。
//
// 数据源: 已有 /api/admin/rules 列表 (无需新 API)
// 解析: 复用 helpers.safeParseRuleConfig 把 JSON 字符串还原为 RuleConfig 形状
// 零写入: 全只读, 不调 PUT/POST; 关闭即释放所有状态
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowRight, Diff, Loader2, X } from 'lucide-react'
import { api, safeParseRuleConfig, type RuleConfig, type RuleRow, type RuleSection } from './helpers'

const SECTIONS: { key: RuleSection; label: string }[] = [
  { key: 'list', label: '列表页' },
  { key: 'book', label: '书籍页' },
  { key: 'toc', label: '目录页' },
  { key: 'content', label: '内容页' },
]

interface DiffCell {
  /** 字段名 */
  field: string
  /** 左侧值 (序列化为字符串, 缺省空串) */
  left: string
  /** 右侧值 */
  right: string
  /** 仅左侧有 / 仅右侧有 / 两边都有但不同 / 两边相同 */
  status: 'same' | 'added' | 'removed' | 'changed'
}

/** 把单段配置 flatten 成 field → string 映射, 便于逐字段 diff */
function flattenSection(section: RuleConfig[RuleSection]): Record<string, string> {
  const out: Record<string, string> = {}
  if (section?.urlTemplate) out.urlTemplate = section.urlTemplate
  // fields.* (选择器/正则等)
  if (section?.fields) {
    for (const [k, v] of Object.entries(section.fields)) {
      out[`fields.${k}`] = typeof v === 'string' ? v : JSON.stringify(v)
    }
  }
  // list 段额外: listStart/listEnd/pagerType
  if ('listStart' in section && typeof section.listStart === 'number') out.listStart = String(section.listStart)
  if ('listEnd' in section && typeof section.listEnd === 'number') out.listEnd = String(section.listEnd)
  if ('pagerType' in section && typeof section.pagerType === 'string') out.pagerType = section.pagerType
  return out
}

function flattenFetch(cfg: RuleConfig): Record<string, string> {
  const f = (cfg.fetch || {}) as unknown as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of [
    'engine',
    'method',
    'charset',
    'userAgent',
    'referer',
    'useProxy',
    'hostGateLimit',
    'enableFingerprint',
    'acceptHeaderProfile',
    'connectTimeoutMs',
    'retryStrategy',
    'turnstileBypass',
    'turnstileBypassLevel',
    'ucBridgeUrl',
  ] as const) {
    const v = f[k]
    if (v === undefined || v === null) continue
    out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  if (f.headers && typeof f.headers === 'object') {
    out.headers = JSON.stringify(f.headers)
  }
  return out
}

function flattenClean(cfg: RuleConfig): Record<string, string> {
  const c = (cfg.clean || {}) as unknown as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of [
    'removeScripts',
    'removeIframes',
    'removeAds',
    'trimWhitespace',
    'normalizePunctuation',
    'removeImages',
    'collapseEmptyLines',
    'normalize',
    'plainText',
  ] as const) {
    const v = c[k]
    if (v === undefined || v === null) continue
    out[k] = String(v)
  }
  if (Array.isArray(c.removeSelectors)) out.removeSelectors = JSON.stringify(c.removeSelectors)
  if (Array.isArray(c.adPatterns)) out.adPatterns = JSON.stringify(c.adPatterns)
  if (Array.isArray(c.whitelist)) out.whitelist = JSON.stringify(c.whitelist)
  return out
}

/** 计算两组 field → string 的逐字段 diff */
function computeDiff(left: Record<string, string>, right: Record<string, string>): DiffCell[] {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  const rows: DiffCell[] = []
  for (const k of keys) {
    const l = left[k] ?? ''
    const r = right[k] ?? ''
    let status: DiffCell['status'] = 'same'
    if (!l && r) status = 'added'
    else if (l && !r) status = 'removed'
    else if (l !== r) status = 'changed'
    rows.push({ field: k, left: l, right: r, status })
  }
  // 字段名排序, 避免随机顺序
  rows.sort((a, b) => a.field.localeCompare(b.field))
  return rows
}

function statusTone(status: DiffCell['status']): { row: string; leftBg: string; rightBg: string; label: string } {
  switch (status) {
    case 'added':
      return { row: 'bg-emerald-500/5', leftBg: 'bg-transparent', rightBg: 'bg-emerald-500/15', label: '新增' }
    case 'removed':
      return { row: 'bg-red-500/5', leftBg: 'bg-red-500/15', rightBg: 'bg-transparent', label: '移除' }
    case 'changed':
      return { row: 'bg-amber-500/5', leftBg: 'bg-amber-500/15', rightBg: 'bg-amber-500/15', label: '变更' }
    default:
      return { row: '', leftBg: '', rightBg: '', label: '相同' }
  }
}

interface RuleDiffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 由 RulesSection 工具栏按钮预选的第一条规则(可选) */
  preselectLeftId?: string | null
}

export function RuleDiffDialog({ open, onOpenChange, preselectLeftId }: RuleDiffDialogProps) {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [leftId, setLeftId] = useState<string>(preselectLeftId || '')
  const [rightId, setRightId] = useState<string>('')

  // 拉取规则列表 (打开时拉一次, 供两个 Select 使用);
  // agent-PP-ui5: 若有 preselectLeftId, 在拉取完成后自动应用为左侧选择 (避开 setState-in-effect lint)
  useEffect(() => {
    if (!open) return
    api
      .get<RuleRow[]>('/api/admin/rules')
      .then((rs) => {
        const list = Array.isArray(rs) ? rs : []
        setRules(list)
        if (preselectLeftId && list.some((r) => r.id === preselectLeftId)) {
          setLeftId(preselectLeftId)
        }
      })
      .catch(() => setRules([]))
      .finally(() => setLoading(false))
  }, [open, preselectLeftId])

  const leftRule = useMemo(() => rules.find((r) => r.id === leftId) || null, [rules, leftId])
  const rightRule = useMemo(() => rules.find((r) => r.id === rightId) || null, [rules, rightId])

  const leftCfg = useMemo<RuleConfig | null>(
    () => (leftRule ? safeParseRuleConfig(leftRule.config) : null),
    [leftRule],
  )
  const rightCfg = useMemo<RuleConfig | null>(
    () => (rightRule ? safeParseRuleConfig(rightRule.config) : null),
    [rightRule],
  )

  // 计算各段 diff
  const sectionDiffs = useMemo(() => {
    if (!leftCfg || !rightCfg) return null
    const result: Record<RuleSection, DiffCell[]> = {} as Record<RuleSection, DiffCell[]>
    for (const s of SECTIONS) {
      result[s.key] = computeDiff(
        flattenSection(leftCfg[s.key] || ({} as RuleConfig[RuleSection])),
        flattenSection(rightCfg[s.key] || ({} as RuleConfig[RuleSection])),
      )
    }
    return result
  }, [leftCfg, rightCfg])

  const fetchDiff = useMemo(
    () => (leftCfg && rightCfg ? computeDiff(flattenFetch(leftCfg), flattenFetch(rightCfg)) : null),
    [leftCfg, rightCfg],
  )
  const cleanDiff = useMemo(
    () => (leftCfg && rightCfg ? computeDiff(flattenClean(leftCfg), flattenClean(rightCfg)) : null),
    [leftCfg, rightCfg],
  )

  // 统计: 变更字段总数
  const changeSummary = useMemo(() => {
    let changed = 0
    let added = 0
    let removed = 0
    let same = 0
    const all = [...(sectionDiffs ? Object.values(sectionDiffs).flat() : []), ...(fetchDiff || []), ...(cleanDiff || [])]
    for (const c of all) {
      if (c.status === 'added') added++
      else if (c.status === 'removed') removed++
      else if (c.status === 'changed') changed++
      else same++
    }
    return { changed, added, removed, same, total: all.length }
  }, [sectionDiffs, fetchDiff, cleanDiff])

  const swap = useCallback(() => {
    setLeftId(rightId)
    setRightId(leftId)
  }, [leftId, rightId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-scroll max-h-[92vh] sm:max-w-5xl overflow-y-auto border-zinc-800 bg-zinc-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-100">
            <span className="flex size-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-400">
              <Diff className="size-4" />
            </span>
            规则对比工具
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            并排展示两条规则的全部字段, 高亮差异(变更/新增/移除), 帮助迁移字段或评估规则改版影响
          </DialogDescription>
        </DialogHeader>

        {/* 选择栏 */}
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400" htmlFor="diff-left">规则 A</label>
            <Select value={leftId} onValueChange={setLeftId}>
              <SelectTrigger id="diff-left" className="border-zinc-700 bg-zinc-950 text-sm text-zinc-200">
                <SelectValue placeholder={loading ? '加载中…' : '选择规则 A'} />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-900">
                {rules.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-sm text-zinc-200">
                    {r.name}{!r.enabled ? ' (停用)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-center pb-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
              onClick={swap}
              disabled={!leftId || !rightId}
              aria-label="交换左右规则"
              title="交换 A/B"
            >
              <ArrowRight className="size-3.5" />
              交换
            </Button>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400" htmlFor="diff-right">规则 B</label>
            <Select value={rightId} onValueChange={setRightId}>
              <SelectTrigger id="diff-right" className="border-zinc-700 bg-zinc-950 text-sm text-zinc-200">
                <SelectValue placeholder={loading ? '加载中…' : '选择规则 B'} />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-900">
                {rules.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-sm text-zinc-200">
                    {r.name}{!r.enabled ? ' (停用)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 差异摘要 */}
        {sectionDiffs && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs">
            <Diff className="size-3.5 text-violet-400" aria-hidden />
            <span className="text-zinc-400">差异摘要:</span>
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-400">
              变更 {changeSummary.changed}
            </Badge>
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
              新增 {changeSummary.added}
            </Badge>
            <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-400">
              移除 {changeSummary.removed}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-zinc-500">
              相同 {changeSummary.same}
            </Badge>
            <span className="ml-auto text-zinc-500">共 {changeSummary.total} 字段</span>
          </div>
        )}

        {/* 内容区 */}
        <ScrollArea className="max-h-[60vh] rounded-md border border-zinc-800">
          <div className="p-3">
            {!leftCfg || !rightCfg ? (
              <div className="flex h-40 items-center justify-center text-xs text-zinc-500">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    正在加载规则列表…
                  </>
                ) : (
                  <>
                    <X className="mr-2 size-4" />
                    请同时选择规则 A 与规则 B 查看差异
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {sectionDiffs && SECTIONS.map((s) => (
                  <DiffBlock
                    key={s.key}
                    title={`${s.label} (${s.key})`}
                    rows={sectionDiffs[s.key]}
                    leftName={leftRule?.name || 'A'}
                    rightName={rightRule?.name || 'B'}
                  />
                ))}
                {fetchDiff && (
                  <DiffBlock
                    title="反反爬 / 抓取配置 (fetch)"
                    rows={fetchDiff}
                    leftName={leftRule?.name || 'A'}
                    rightName={rightRule?.name || 'B'}
                  />
                )}
                {cleanDiff && (
                  <DiffBlock
                    title="内容清洗 (clean)"
                    rows={cleanDiff}
                    leftName={leftRule?.name || 'A'}
                    rightName={rightRule?.name || 'B'}
                  />
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function DiffBlock({ title, rows, leftName, rightName }: { title: string; rows: DiffCell[]; leftName: string; rightName: string }) {
  const hasDiff = rows.some((r) => r.status !== 'same')
  return (
    <details open={hasDiff} className="rounded-md border border-zinc-800 bg-zinc-950/40">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-300">
        <span className="mr-2">{title}</span>
        {hasDiff ? (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-400">
            {rows.filter((r) => r.status !== 'same').length} 项差异
          </Badge>
        ) : (
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-400">
            完全一致
          </Badge>
        )}
      </summary>
      <div className="border-t border-zinc-800">
        {/* 表头 */}
        <div className="grid grid-cols-[1fr_1fr] border-b border-zinc-800/70 text-[10px] text-zinc-500">
          <div className="px-3 py-1.5 truncate" title={leftName}>{leftName}</div>
          <div className="px-3 py-1.5 truncate" title={rightName}>{rightName}</div>
        </div>
        {/* 行 */}
        {rows.length === 0 ? (
          <div className="px-3 py-3 text-center text-[11px] text-zinc-600">无字段</div>
        ) : (
          rows.map((r) => {
            const tone = statusTone(r.status)
            return (
              <div key={r.field} className={`grid grid-cols-[1fr_1fr] border-b border-zinc-800/40 last:border-0 ${tone.row}`}>
                <div className="px-3 py-1.5 font-mono text-[11px]">
                  <span className="text-zinc-500">{r.field}:</span>{' '}
                  <span className={`break-all px-1 ${tone.leftBg} ${r.status === 'removed' ? 'text-red-300 line-through' : 'text-zinc-200'}`}>
                    {r.left || <span className="text-zinc-700">—</span>}
                  </span>
                </div>
                <div className="px-3 py-1.5 font-mono text-[11px]">
                  <span className="text-zinc-500">{r.field}:</span>{' '}
                  <span className={`break-all px-1 ${tone.rightBg} ${r.status === 'added' ? 'text-emerald-300' : 'text-zinc-200'}`}>
                    {r.right || <span className="text-zinc-700">—</span>}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </details>
  )
}
