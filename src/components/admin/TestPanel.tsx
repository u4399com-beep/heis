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
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FlaskConical, Loader2, Bug, ChevronDown, MousePointerClick, Inbox } from 'lucide-react'
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
}

export function TestPanel({ section, rule, fetchConfig, cleanConfig, defaultUrl }: TestPanelProps) {
  const [url, setUrl] = useState(defaultUrl || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RuleTestResult | null>(null)
  const [error, setError] = useState('')
  // feat-c: 当前激活的匹配(由"匹配详情"行点击设置, 传给 DebugHtmlViewer 高亮对应 mark)
  const [activeMatch, setActiveMatch] = useState<{ field: string; idx: number } | null>(null)
  const aliveRef = useRef(true)

  // 挂载/重挂载时复位 aliveRef(StrictMode dev 下会 卸载→重挂载, 旧实现只设 false 不复位 → 卡 loading)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const runTest = async () => {
    if (!url.trim()) {
      setError('请输入测试 URL')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    setActiveMatch(null) // 新测试: 清空旧激活状态, 避免高亮残留
    try {
      const data = await api.post<RuleTestResult>('/api/admin/rules/test', {
        section,
        url: url.trim(),
        rule,
        fetch: fetchConfig,
        // 清洗配置仅在 content 段生效(后端只在该段消费), 缺省时后端用默认清洗
        ...(section === 'content' && cleanConfig ? { clean: cleanConfig } : {}),
      })
      if (!aliveRef.current) return
      setResult(data)
    } catch (e) {
      if (!aliveRef.current) return
      setError(e instanceof Error ? e.message : '测试失败')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium text-zinc-200">测试面板</span>
        <span className="text-xs text-zinc-500">输入该段落的真实页面地址进行试采</span>
      </div>

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
    </div>
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

  return (
    <div className="mt-4 space-y-4">
      {/* feat-c: 可视化调试区(折叠, 默认展开; 仅当 debugHtml 不为 null 时显示) */}
      {hasDebug && (
        <VisualDebugSection
          debugHtml={result.debugHtml || ''}
          rawHtml={result.rawHtml || ''}
          matches={matches}
          activeMatch={activeMatch}
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
  activeMatch,
  onMatchClick,
}: {
  debugHtml: string
  rawHtml: string
  matches: DebugMatch[]
  activeMatch: { field: string; idx: number } | null
  onMatchClick: (m: { field: string; idx: number } | null) => void
}) {
  // 默认展开: 调试数据存在(本组件已被渲染即意味着 debugHtml 不为 null)
  const [open, setOpen] = useState(true)

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
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
              {/* 左: 高亮 HTML 预览(桌面 3/5, 移动端满宽) */}
              <div className="lg:col-span-3">
                <DebugHtmlViewer
                  debugHtml={debugHtml}
                  rawHtml={rawHtml}
                  activeMatch={activeMatch}
                />
              </div>
              {/* 右: 匹配详情(桌面 2/5, 移动端满宽) */}
              <div className="lg:col-span-2">
                <MatchesPanel
                  matches={matches}
                  activeMatch={activeMatch}
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
function MatchesPanel({
  matches,
  activeMatch,
  onMatchClick,
}: {
  matches: DebugMatch[]
  activeMatch: { field: string; idx: number } | null
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
              const isActive =
                activeMatch?.field === m.field && activeMatch?.idx === m.idx
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
}

/** feat-c: 既有提取数据展示 — 把原 TestResultView 主体抽出来, 与可视化调试区并列 */
function ExtractedDataView({ result }: { result: RuleTestResult }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <FlaskConical className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-xs font-medium text-zinc-300">提取结果</span>
      </div>
      <ExtractedDataBody result={result} />
    </div>
  )
}

/** 原 TestResultView 主体内容(MetaChips + 各段表格/字段/正文) */
function ExtractedDataBody({ result }: { result: RuleTestResult }) {
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
}

function MetaChips({ result }: { result: RuleTestResult }) {
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
}
