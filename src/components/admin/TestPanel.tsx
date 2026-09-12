'use client'

// ============================================================
// TestPanel — 规则编辑器内嵌的四段测试面板
// 输入测试 URL → 调用 /api/admin/rules/test → 按段落类型展示结果
//
// feat-c 扩展: 在原有提取结果展示之上, 新增"可视化调试"折叠区:
//   左侧 DebugHtmlViewer(sandbox="" iframe 渲染注入 <mark> 高亮的 debugHtml)
//   右侧"匹配详情"面板(可点击行 → 高亮对应 iframe mark + 闪烁)
//   左右仅在 lg+ 并排, 移动端纵向堆叠(响应式 lg:grid-cols-5)
//   debugHtml 为 null(服务端调试构建失败) → 隐藏调试区, 仅展示提取结果
//
// agent-X-rule-test 增强:
//   - 测试模式三态: 'single' (单 URL 测试) / 'compare' (对比两份规则) / 'batch' (多 URL)
//   - 对比模式: 同 URL 跑 2 份规则(A=当前规则, B=JSON 草稿导入), 结果并排展示
//     让用户在改规则时直接看到"前/后"差异, 不需切换标签
//   - 批量模式: 一次粘贴最多 10 个 URL, 串行测试(避免并发打爆源站), 结果汇总表
//   - MatchesPanel/ExtractedDataBody/MetaChips 包 React.memo 截断无关重渲
//   - TestPanel 内部 abortRef: 切换模式或新测试时主动 abort 上次未完的 fetch
//   - activeMatch 子字段解构, 让 DebugHtmlViewer memo 比较稳定
// ============================================================
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { FlaskConical, Loader2, Bug, ChevronDown, MousePointerClick, Inbox, GitCompareArrows, ListChecks, XCircle } from 'lucide-react'
import {
  api,
  type CleanConfig,
  type DebugMatch,
  type FetchConfig,
  type PageRule,
  type RuleSection,
  type RuleTestResult,
} from './helpers'
import { DebugHtmlViewer } from './DebugHtmlViewer'

interface TestPanelProps {
  section: RuleSection
  rule: PageRule
  fetchConfig: FetchConfig
  /** 内容清洗配置(仅 content 段测试时随请求发送, 与实采 runner 使用 rule.clean 对齐) */
  cleanConfig?: CleanConfig
  /** 预填的测试地址 */
  defaultUrl?: string
  /**
   * 对比模式专用: 第二份规则(规则 B)。若提供则默认进入对比模式; 父组件可在外部 toggle。
   * 留空则不显示对比按钮(降级为单测模式面板)。
   */
  compareRule?: PageRule
}

type TestMode = 'single' | 'compare' | 'batch'

const BATCH_URL_MAX = 10

export function TestPanel({ section, rule, fetchConfig, cleanConfig, defaultUrl, compareRule }: TestPanelProps) {
  const [mode, setMode] = useState<TestMode>('single')

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium text-zinc-200">测试面板</span>
        <span className="text-xs text-zinc-500">输入该段落的真实页面地址进行试采</span>
        <div className="ml-auto">
          {/* 测试模式切换: 仅当 compareRule 提供时显示对比按钮 */}
          <Tabs value={mode} onValueChange={(v) => setMode(v as TestMode)}>
            <TabsList className="h-7 bg-zinc-900">
              <TabsTrigger value="single" className="px-2 text-[11px]">
                <FlaskConical className="mr-1 h-3 w-3" />
                单测
              </TabsTrigger>
              {compareRule && (
                <TabsTrigger value="compare" className="px-2 text-[11px]">
                  <GitCompareArrows className="mr-1 h-3 w-3" />
                  对比
                </TabsTrigger>
              )}
              <TabsTrigger value="batch" className="px-2 text-[11px]">
                <ListChecks className="mr-1 h-3 w-3" />
                批量
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {mode === 'single' && (
        <SingleTestPanel
          section={section}
          rule={rule}
          fetchConfig={fetchConfig}
          cleanConfig={cleanConfig}
          defaultUrl={defaultUrl}
        />
      )}
      {mode === 'compare' && compareRule && (
        <CompareTestPanel
          section={section}
          ruleA={rule}
          ruleB={compareRule}
          fetchConfig={fetchConfig}
          cleanConfig={cleanConfig}
          defaultUrl={defaultUrl}
        />
      )}
      {mode === 'batch' && (
        <BatchTestPanel
          section={section}
          rule={rule}
          fetchConfig={fetchConfig}
          cleanConfig={cleanConfig}
          defaultUrl={defaultUrl}
        />
      )}
    </div>
  )
}

// ---------------- 单测模式(原 TestPanel 主体) ----------------
function SingleTestPanel({
  section,
  rule,
  fetchConfig,
  cleanConfig,
  defaultUrl,
}: Omit<TestPanelProps, 'compareRule'>) {
  const [url, setUrl] = useState(defaultUrl || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RuleTestResult | null>(null)
  const [error, setError] = useState('')
  const [activeMatch, setActiveMatch] = useState<{ field: string; idx: number } | null>(null)
  const aliveRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      // 卸载时取消进行中的请求, 避免 setState-after-unmount
      abortRef.current?.abort()
    }
  }, [])

  const runTest = useCallback(async () => {
    if (!url.trim()) {
      setError('请输入测试 URL')
      return
    }
    // 取消上次未完的请求(切到新 URL 时旧响应不再有意义)
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError('')
    setResult(null)
    setActiveMatch(null)
    try {
      const data = await api.post<RuleTestResult>(
        '/api/admin/rules/test',
        {
          section,
          url: url.trim(),
          rule,
          fetch: fetchConfig,
          ...(section === 'content' && cleanConfig ? { clean: cleanConfig } : {}),
        },
        // api.post 不接受 init, 但底层 fetch 仍受 ctrl 影响 — 这里 ctrl 仅用作本地取消标记,
        // 实际请求 abort 需 api 层支持 signal。fallback: aliveRef 兜底丢弃陈旧响应。
      )
      if (!aliveRef.current || ctrl.signal.aborted) return
      setResult(data)
    } catch (e) {
      if (!aliveRef.current || ctrl.signal.aborted) return
      setError(e instanceof Error ? e.message : '测试失败')
    } finally {
      if (aliveRef.current && !ctrl.signal.aborted) setLoading(false)
    }
  }, [url, section, rule, fetchConfig, cleanConfig])

  return (
    <>
      <div className="flex gap-2">
        <Input
          className="h-9 flex-1 border-zinc-700 bg-zinc-900 font-mono text-xs"
          placeholder={
            section === 'list'
              ? '列表页地址, 支持 {page} 占位符'
              : section === 'book'
                ? '书籍信息页地址'
                : section === 'toc'
                  ? '章节目录页地址'
                  : '章节内容页地址'
          }
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) runTest()
          }}
        />
        <Button type="button" size="sm" className="h-9 gap-1.5" disabled={loading} onClick={runTest}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
          {loading ? '测试中…' : '开始测试'}
        </Button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-400">
          {error}
        </div>
      )}

      {loading && <TestLoadingSkeleton />}

      {!loading && result && (
        <TestResultView
          result={result}
          activeMatch={activeMatch}
          onMatchClick={setActiveMatch}
        />
      )}
    </>
  )
}

/** feat-c: 测试中骨架屏 — 模拟"可视化调试 + 提取结果"两块区域的占位高度 */
function TestLoadingSkeleton() {
  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <Skeleton className="h-[460px] lg:col-span-3" />
          <Skeleton className="h-[460px] lg:col-span-2" />
        </div>
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

/** feat-c: 提取结果 + 可视化调试区组合视图 */
function TestResultView({
  result,
  activeMatch,
  onMatchClick,
}: {
  result: RuleTestResult
  activeMatch: { field: string; idx: number } | null
  onMatchClick: (m: { field: string; idx: number } | null) => void
}) {
  const hasDebug = !!result.debugHtml
  const matches = (result.debugMatches || []) as DebugMatch[]

  // activeMatch 子字段解构, 让传给 DebugHtmlViewer 的 props 引用稳定(配合 memo)
  const activeField = activeMatch?.field ?? null
  const activeIdx = activeMatch?.idx ?? null

  return (
    <div className="mt-4 space-y-4">
      {/* feat-c: 可视化调试区(折叠, 默认展开; 仅当 debugHtml 不为 null 时显示) */}
      {hasDebug && (
        <VisualDebugSection
          debugHtml={result.debugHtml || ''}
          rawHtml={result.rawHtml || ''}
          matches={matches}
          activeField={activeField}
          activeIdx={activeIdx}
          onMatchClick={onMatchClick}
        />
      )}

      {/* 既有提取结果展示(始终展示, 跟"调试构建是否成功"解耦) */}
      <ExtractedDataView result={result} />
    </div>
  )
}

/** feat-c: 可视化调试折叠区 */
function VisualDebugSection({
  debugHtml,
  rawHtml,
  matches,
  activeField,
  activeIdx,
  onMatchClick,
}: {
  debugHtml: string
  rawHtml: string
  matches: DebugMatch[]
  activeField: string | null
  activeIdx: number | null
  onMatchClick: (m: { field: string; idx: number } | null) => void
}) {
  // 默认展开: 调试数据存在(本组件已被渲染即意味着 debugHtml 不为 null)
  const [open, setOpen] = useState(true)
  const [pickerOn, setPickerOn] = useState(false)
  const [pickedSelector, setPickedSelector] = useState('')

  const onPick = useCallback((sel: string) => {
    setPickedSelector(sel)
  }, [])

  const activeMatch = useMemo(
    () => (activeField !== null && activeIdx !== null ? { field: activeField, idx: activeIdx } : null),
    [activeField, activeIdx],
  )

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-900/60"
          >
            <Bug className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-medium text-zinc-200">可视化调试</span>
            <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-400">
              {matches.length} 项匹配
            </Badge>
            <span className="ml-auto text-xs text-zinc-500">
              {open ? '点击折叠' : '点击展开'}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-zinc-800 p-3">
            {/* agent-X: 元素选择器切换条 — 启用后 iframe 接管点击事件, 命中元素回填下方输入框 */}
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <Button
                type="button"
                size="sm"
                variant={pickerOn ? 'default' : 'outline'}
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => setPickerOn((v) => !v)}
                title="开启后点击 iframe 内元素自动生成 CSS 选择器"
              >
                <MousePointerClick className="h-3 w-3" />
                {pickerOn ? '关闭选择器' : '元素选择器'}
              </Button>
              {pickerOn && (
                <span className="text-zinc-500">点击 iframe 元素 → 生成 CSS 选择器</span>
              )}
              {pickedSelector && (
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                  {pickedSelector}
                </code>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
              {/* 左: 高亮 HTML 预览(桌面 3/5, 移动端满宽) */}
              <div className="lg:col-span-3">
                <DebugHtmlViewer
                  debugHtml={debugHtml}
                  rawHtml={rawHtml}
                  activeMatch={activeMatch}
                  pickerEnabled={pickerOn}
                  onPick={onPick}
                />
              </div>
              {/* 右: 匹配详情(桌面 2/5, 移动端满宽) */}
              <div className="lg:col-span-2">
                <MatchesPanel
                  matches={matches}
                  activeField={activeField}
                  activeIdx={activeIdx}
                  onMatchClick={onMatchClick}
                />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

/** feat-c: 匹配详情面板 — 列出每条匹配的字段名/选择器/索引/值预览, 行可点击高亮 */
const MatchesPanel = memo(function MatchesPanel({
  matches,
  activeField,
  activeIdx,
  onMatchClick,
}: {
  matches: DebugMatch[]
  activeField: string | null
  activeIdx: number | null
  onMatchClick: (m: { field: string; idx: number } | null) => void
}) {
  if (matches.length === 0) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-center">
        <Inbox className="h-10 w-10 text-zinc-600" />
        <div className="mt-2 text-sm font-medium text-zinc-400">无匹配项</div>
        <div className="mt-1 text-xs text-zinc-600">
          规则未在该页面命中任何元素, 请检查选择器或更换测试 URL
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
        <MousePointerClick className="h-3.5 w-3.5 text-violet-400" />
        <span className="font-medium text-zinc-200">匹配详情</span>
        <span className="text-zinc-500">点击行高亮 iframe 中对应元素</span>
      </div>
      <div className="admin-scroll max-h-[460px] flex-1 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="h-8 px-2 text-[11px] text-zinc-500">字段</TableHead>
              <TableHead className="h-8 px-2 text-[11px] text-zinc-500">#</TableHead>
              <TableHead className="h-8 px-2 text-[11px] text-zinc-500">值预览</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.map((m, i) => {
              const isActive = activeField === m.field && activeIdx === m.idx
              return (
                <TableRow
                  key={`${m.field}-${m.idx}-${i}`}
                  onClick={() => onMatchClick({ field: m.field, idx: m.idx })}
                  className={`cursor-pointer border-zinc-800/70 transition-colors ${
                    isActive
                      ? 'bg-violet-500/15 hover:bg-violet-500/20'
                      : 'hover:bg-zinc-900/60'
                  }`}
                >
                  <TableCell className="px-2 py-1.5">
                    <span className="font-mono text-[11px] font-medium text-violet-300">
                      {m.field}
                    </span>
                  </TableCell>
                  <TableCell className="px-2 py-1.5 text-[11px] text-zinc-500">
                    {m.idx}
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate px-2 py-1.5 font-mono text-[11px] text-zinc-300"
                    title={m.value || '(空)'}
                  >
                    {m.preview || <span className="text-zinc-600 italic">(空)</span>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="border-t border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-[10px] text-zinc-500">
        共 {matches.length} 条 · 选择器摘要见每行 title
      </div>
    </div>
  )
})

/** feat-c: 既有提取数据展示 — 把原 TestResultView 主体抽出来, 与可视化调试区并列 */
const ExtractedDataView = memo(function ExtractedDataView({ result }: { result: RuleTestResult }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <FlaskConical className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-xs font-medium text-zinc-300">提取结果</span>
      </div>
      <ExtractedDataBody result={result} />
    </div>
  )
})

/** 原 TestResultView 主体内容(MetaChips + 各段表格/字段/正文) */
const ExtractedDataBody = memo(function ExtractedDataBody({ result }: { result: RuleTestResult }) {
  if (result.type === 'list') {
    const sample = (result.sample || []) as Record<string, string>[]
    const keys = sample.length ? Object.keys(sample[0]) : []
    return (
      <div>
        <MetaChips result={result} />
        <div className="mb-2 text-sm text-zinc-300">
          提取到 <span className="font-semibold text-emerald-400">{result.count ?? 0}</span> 条列表项
        </div>
        {sample.length > 0 && (
          <div className="admin-scroll max-h-72 overflow-y-auto rounded-md border border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="h-8 text-xs text-zinc-500">#</TableHead>
                  {keys.map((k) => (
                    <TableHead key={k} className="h-8 text-xs text-zinc-500">
                      {k}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sample.map((row, i) => (
                  <TableRow key={i} className="border-zinc-800/70">
                    <TableCell className="py-1.5 text-xs text-zinc-600">{i + 1}</TableCell>
                    {keys.map((k) => (
                      <TableCell
                        key={k}
                        className="max-w-[260px] truncate py-1.5 font-mono text-xs text-zinc-300"
                        title={row[k]}
                      >
                        {row[k] || '-'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    )
  }

  if (result.type === 'book') {
    const fields = result.fields || {}
    const labels: Record<string, string> = {
      name: '书名', author: '作者', category: '分类', keywords: '关键词',
      intro: '简介', cover: '封面', latestChapter: '最新章节', status: '状态',
    }
    const entries = Object.entries(fields)
    return (
      <div>
        <MetaChips result={result} />
        {entries.length === 0 ? (
          <div className="text-xs text-zinc-500">未提取到任何字段, 请检查字段规则</div>
        ) : (
          <div className="space-y-1.5">
            {entries.map(([k, v]) => (
              <div
                key={k}
                className="flex gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-3 py-1.5"
              >
                <span className="w-20 shrink-0 text-xs text-zinc-500">{labels[k] || k}</span>
                <span
                  className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-300"
                  title={v}
                >
                  {v || '-'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (result.type === 'toc') {
    const sample = (result.sample || []) as { title: string; url: string }[]
    return (
      <div>
        <MetaChips result={result} />
        <div className="mb-2 flex gap-4 text-sm text-zinc-300">
          <span>
            章节 <span className="font-semibold text-emerald-400">{result.count ?? 0}</span> 章
          </span>
          <span>
            翻页 <span className="font-semibold text-amber-400">{result.pages ?? 1}</span> 页
          </span>
        </div>
        <div className="admin-scroll max-h-72 space-y-1 overflow-y-auto rounded-md border border-zinc-800 p-2">
          {sample.map((it, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-8 shrink-0 text-right text-zinc-600">{i + 1}</span>
              <span className="w-44 shrink-0 truncate text-zinc-300" title={it.title}>
                {it.title || '-'}
              </span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-zinc-500"
                title={it.url}
              >
                {it.url || '-'}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // content
  return (
    <div>
      <MetaChips result={result} />
      <div className="mb-2 flex flex-wrap gap-4 text-sm text-zinc-300">
        <span>
          合并页数 <span className="font-semibold text-amber-400">{result.pages ?? 1}</span>
        </span>
        <span>
          清洗前 <span className="font-semibold text-zinc-100">{result.rawLength ?? 0}</span> 字符
        </span>
        <span>
          清洗后 <span className="font-semibold text-emerald-400">{result.cleanedLength ?? 0}</span> 字符
        </span>
      </div>
      <div className="admin-scroll max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/60 p-3 text-xs leading-relaxed text-zinc-300">
        {result.cleanedText || '(空)'}
      </div>
      <div className="mt-1 text-right text-[10px] text-zinc-600">预览已截取前 1500 字符</div>
    </div>
  )
})

const MetaChips = memo(function MetaChips({ result }: { result: RuleTestResult }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
        引擎: {result.engine === 'browser' ? '浏览器渲染' : result.engine === 'http' ? 'HTTP直连' : result.engine}
      </Badge>
      <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
        耗时 {result.ms} ms
      </Badge>
      <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
        HTML {(result.htmlSize / 1024).toFixed(1)} KB
      </Badge>
    </div>
  )
})

// ============================================================
// agent-X-rule-test: 对比测试模式 — 同 URL 跑两份规则, 结果并排展示
// 让用户在改规则时直接看到"前/后"差异, 不需切换标签。
// 串行执行(避免并发打爆源站), 共享 aliveRef; A 与 B 各自维护独立 result/error。
// ============================================================
function CompareTestPanel({
  section,
  ruleA,
  ruleB,
  fetchConfig,
  cleanConfig,
  defaultUrl,
}: {
  section: RuleSection
  ruleA: PageRule
  ruleB: PageRule
  fetchConfig: FetchConfig
  cleanConfig?: CleanConfig
  defaultUrl?: string
}) {
  const [url, setUrl] = useState(defaultUrl || '')
  const [loading, setLoading] = useState(false)
  const [resultA, setResultA] = useState<RuleTestResult | null>(null)
  const [resultB, setResultB] = useState<RuleTestResult | null>(null)
  const [errorA, setErrorA] = useState('')
  const [errorB, setErrorB] = useState('')
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const runCompare = useCallback(async () => {
    if (!url.trim()) {
      setErrorA('请输入测试 URL')
      setErrorB('')
      return
    }
    setLoading(true)
    setErrorA('')
    setErrorB('')
    setResultA(null)
    setResultB(null)
    const payload = (rule: PageRule) => ({
      section,
      url: url.trim(),
      rule,
      fetch: fetchConfig,
      ...(section === 'content' && cleanConfig ? { clean: cleanConfig } : {}),
    })
    // A 先跑, 完成 (成功/失败) 后再跑 B; 串行避免源站被打爆
    try {
      const a = await api.post<RuleTestResult>('/api/admin/rules/test', payload(ruleA))
      if (!aliveRef.current) return
      setResultA(a)
    } catch (e) {
      if (!aliveRef.current) return
      setErrorA(e instanceof Error ? e.message : 'A 测试失败')
    }
    try {
      const b = await api.post<RuleTestResult>('/api/admin/rules/test', payload(ruleB))
      if (!aliveRef.current) return
      setResultB(b)
    } catch (e) {
      if (!aliveRef.current) return
      setErrorB(e instanceof Error ? e.message : 'B 测试失败')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [url, section, ruleA, ruleB, fetchConfig, cleanConfig])

  return (
    <>
      <div className="flex gap-2">
        <Input
          className="h-9 flex-1 border-zinc-700 bg-zinc-900 font-mono text-xs"
          placeholder="同一 URL, 用于对比规则 A 与规则 B 的提取结果"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) runCompare()
          }}
        />
        <Button type="button" size="sm" className="h-9 gap-1.5" disabled={loading} onClick={runCompare}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
          {loading ? '对比中…' : '对比测试'}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-500">
        串行测试 A → B(避免并发打爆源站), 各自独立展示提取结果与匹配数。
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <CompareColumn
          title="规则 A · 当前规则"
          accent="sky"
          loading={loading}
          result={resultA}
          error={errorA}
        />
        <CompareColumn
          title="规则 B · 待比对规则"
          accent="violet"
          loading={loading}
          result={resultB}
          error={errorB}
        />
      </div>
    </>
  )
}

function CompareColumn({
  title,
  accent,
  loading,
  result,
  error,
}: {
  title: string
  accent: 'sky' | 'violet'
  loading: boolean
  result: RuleTestResult | null
  error: string
}) {
  const accentClass = accent === 'sky' ? 'border-sky-500/40' : 'border-violet-500/40'
  return (
    <div className={`rounded-lg border ${accentClass} bg-zinc-950/60 p-3`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-200">{title}</span>
        {result && (
          <div className="flex items-center gap-1 text-[10px] text-zinc-500">
            <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
              {result.ms}ms
            </Badge>
            {typeof result.count === 'number' && (
              <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
                {result.count} 项
              </Badge>
            )}
            {typeof result.cleanedLength === 'number' && (
              <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
                {result.cleanedLength} 字
              </Badge>
            )}
          </div>
        )}
      </div>
      {loading && <Skeleton className="h-32 w-full" />}
      {!loading && error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
      {!loading && !error && !result && (
        <div className="text-xs text-zinc-600">点击「对比测试」后展示</div>
      )}
      {!loading && !error && result && (
        <CompareResultBody result={result} />
      )}
    </div>
  )
}

/** 对比模式的精简结果展示: 不带 DebugHtmlViewer(避免两个 iframe 同时渲染拖慢),
 *  只展示提取条数/字段值预览, 让用户直观对比 A/B 差异 */
function CompareResultBody({ result }: { result: RuleTestResult }) {
  if (result.type === 'list' || result.type === 'toc') {
    const sample = (result.sample || []) as Record<string, string>[]
    return (
      <div className="space-y-1">
        {sample.length === 0 && <div className="text-xs text-zinc-600">未提取到任何项</div>}
        {sample.slice(0, 5).map((row, i) => (
          <div key={i} className="truncate font-mono text-[11px] text-zinc-300" title={JSON.stringify(row).slice(0, 200)}>
            {i + 1}. {Object.values(row).slice(0, 3).join(' / ') || '-'}
          </div>
        ))}
        {sample.length > 5 && <div className="text-[10px] text-zinc-500">… 共 {sample.length} 项, 仅显示前 5</div>}
      </div>
    )
  }
  if (result.type === 'book') {
    const fields = result.fields || {}
    const entries = Object.entries(fields)
    return (
      <div className="space-y-0.5">
        {entries.length === 0 && <div className="text-xs text-zinc-600">未提取到任何字段</div>}
        {entries.slice(0, 6).map(([k, v]) => (
          <div key={k} className="truncate text-[11px] text-zinc-300" title={v}>
            <span className="text-zinc-500">{k}:</span> {v || '-'}
          </div>
        ))}
        {entries.length > 6 && <div className="text-[10px] text-zinc-500">… 共 {entries.length} 字段</div>}
      </div>
    )
  }
  // content
  return (
    <div className="admin-scroll max-h-44 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-900/40 p-2 text-[11px] text-zinc-300">
      {result.cleanedText || '(空)'}
    </div>
  )
}

// ============================================================
// agent-X-rule-test: 批量 URL 测试模式 — 一次粘贴最多 10 个 URL,
// 串行测试(BATCH_CONCURRENCY=1), 结果汇总表显示每条的成功/失败/提取数/耗时。
// 串行而非并发: 站点限流(429/403)会让并发失败更多, 串行给源站喘息。
// ============================================================
interface BatchRow {
  url: string
  status: 'pending' | 'running' | 'ok' | 'error'
  result?: RuleTestResult
  error?: string
  ms?: number
  count?: number
}

function BatchTestPanel({
  section,
  rule,
  fetchConfig,
  cleanConfig,
  defaultUrl,
}: {
  section: RuleSection
  rule: PageRule
  fetchConfig: FetchConfig
  cleanConfig?: CleanConfig
  defaultUrl?: string
}) {
  const [text, setText] = useState(defaultUrl ? defaultUrl + '\n' : '')
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<BatchRow[]>([])
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const urls = useMemo(
    () =>
      text
        .split(/[\s,，;；\n]+/)
        .map((s) => s.trim())
        .filter((s) => /^https?:\/\//.test(s))
        .slice(0, BATCH_URL_MAX),
    [text],
  )

  const runBatch = useCallback(async () => {
    if (urls.length === 0) {
      // 不引 sonner(根 layout 已挂), 仅通过 setRows 留个空提示行 — 但空 URL 时不应进入,
      // 因为按钮在 urls.length === 0 时已 disabled。此处留兜底 return, 不再触发 UI 副作用。
      return
    }
    setRunning(true)
    const initial: BatchRow[] = urls.map((u) => ({ url: u, status: 'pending' }))
    setRows(initial)
    for (let i = 0; i < initial.length; i++) {
      if (!aliveRef.current) return
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'running' } : r)))
      try {
        const t0 = Date.now()
        const data = await api.post<RuleTestResult>('/api/admin/rules/test', {
          section,
          url: initial[i].url,
          rule,
          fetch: fetchConfig,
          ...(section === 'content' && cleanConfig ? { clean: cleanConfig } : {}),
        })
        if (!aliveRef.current) return
        const ms = Date.now() - t0
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: 'ok', result: data, ms, count: extractCount(data, section) } : r,
          ),
        )
      } catch (e) {
        if (!aliveRef.current) return
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: 'error', error: e instanceof Error ? e.message : '测试失败' } : r,
          ),
        )
      }
    }
    setRunning(false)
  }, [urls, section, rule, fetchConfig, cleanConfig])

  const okCount = rows.filter((r) => r.status === 'ok').length
  const errCount = rows.filter((r) => r.status === 'error').length

  return (
    <>
      <Textarea
        className="admin-scroll min-h-24 border-zinc-700 bg-zinc-900 font-mono text-xs"
        placeholder={`每行/逗号分隔一个 URL, 最多 ${BATCH_URL_MAX} 个\nhttps://example.com/list-1.html\nhttps://example.com/list-2.html`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={running}
      />
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
        <span>识别到 {urls.length} 个有效 URL{urls.length >= BATCH_URL_MAX ? ` (上限 ${BATCH_URL_MAX})` : ''}</span>
        <span className="ml-auto">串行测试(避免打爆源站)</span>
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-9 gap-1.5"
          onClick={runBatch}
          disabled={running || urls.length === 0}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
          {running ? '批量测试中…' : '开始批量测试'}
        </Button>
        {rows.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
            onClick={() => setRows([])}
            disabled={running}
          >
            清空结果
          </Button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-xs">
            <span className="font-medium text-zinc-200">结果汇总</span>
            <span className="text-zinc-500">
              成功 <span className="text-emerald-400">{okCount}</span>
              {' · '}失败 <span className="text-red-400">{errCount}</span>
              {` · 共 ${rows.length}`}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="h-8 text-xs text-zinc-500">#</TableHead>
                <TableHead className="h-8 text-xs text-zinc-500">URL</TableHead>
                <TableHead className="h-8 text-right text-xs text-zinc-500">结果</TableHead>
                <TableHead className="h-8 text-right text-xs text-zinc-500">耗时</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} className="border-zinc-800/70">
                  <TableCell className="py-1.5 text-xs text-zinc-600">{i + 1}</TableCell>
                  <TableCell className="max-w-[280px] truncate py-1.5 font-mono text-[11px] text-zinc-300" title={r.url}>
                    {r.url}
                  </TableCell>
                  <TableCell className="py-1.5 text-right text-xs">
                    {r.status === 'pending' && <span className="text-zinc-600">待测</span>}
                    {r.status === 'running' && (
                      <span className="inline-flex items-center gap-1 text-amber-400">
                        <Loader2 className="h-3 w-3 animate-spin" /> 测试中
                      </span>
                    )}
                    {r.status === 'ok' && (
                      <span className="text-emerald-400">
                        ✓ {typeof r.count === 'number' ? `${r.count} 项` : '成功'}
                      </span>
                    )}
                    {r.status === 'error' && (
                      <span className="inline-flex items-center gap-1 text-red-400" title={r.error}>
                        <XCircle className="h-3 w-3" /> 失败
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-[11px] text-zinc-500">
                    {r.ms ? `${r.ms}ms` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}

/** 从 RuleTestResult 提取"条数"指标, 不同段含义不同 */
function extractCount(result: RuleTestResult, section: RuleSection): number | undefined {
  if (section === 'content') return result.cleanedLength
  if (section === 'book') return result.fields ? Object.keys(result.fields).length : 0
  return result.count
}
