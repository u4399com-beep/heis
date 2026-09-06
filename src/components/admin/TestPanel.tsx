'use client'

// ============================================================
// TestPanel — 规则编辑器内嵌的四段测试面板
// 输入测试 URL → 调用 /api/admin/rules/test → 按段落类型展示结果
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { FlaskConical, Loader2 } from 'lucide-react'
import { api, type CleanConfig, type FetchConfig, type PageRule, type RuleSection, type RuleTestResult } from './helpers'

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
  const aliveRef = useRef(true)

  // 卸载后(编辑器关闭/切页签)停止异步 setState
  useEffect(() => {
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

      {result && <TestResultView result={result} />}
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

function TestResultView({ result }: { result: RuleTestResult }) {
  if (result.type === 'list') {
    const sample = (result.sample || []) as Record<string, string>[]
    const keys = sample.length ? Object.keys(sample[0]) : []
    return (
      <div className="mt-1">
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
                      <TableCell key={k} className="max-w-[260px] truncate py-1.5 font-mono text-xs text-zinc-300" title={row[k]}>
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
      <div className="mt-1">
        <MetaChips result={result} />
        {entries.length === 0 ? (
          <div className="text-xs text-zinc-500">未提取到任何字段, 请检查字段规则</div>
        ) : (
          <div className="space-y-1.5">
            {entries.map(([k, v]) => (
              <div key={k} className="flex gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
                <span className="w-20 shrink-0 text-xs text-zinc-500">{labels[k] || k}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-300" title={v}>
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
      <div className="mt-1">
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
              <span className="min-w-0 flex-1 truncate font-mono text-zinc-500" title={it.url}>
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
    <div className="mt-1">
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
