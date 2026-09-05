'use client'

// ============================================================
// RuleEditor — 全屏规则编辑器 Dialog
// 四个采集段页签 + 反反爬设置 + 内容清洗设置, 每段内嵌测试面板
// ============================================================
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Save, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { FieldRuleEditor } from './FieldRuleEditor'
import { TestPanel } from './TestPanel'
import {
  api,
  arrayToLines,
  linesToArray,
  safeParseRuleConfig,
  SECTION_FIELD_DEFS,
  type CleanConfig,
  type FetchConfig,
  type PageRule,
  type RuleConfig,
  type RuleRow,
  type RuleSection,
} from './helpers'

interface RuleEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null 表示新建 */
  rule: RuleRow | null
  onSaved: () => void
}

const PAGE_TAB_LABELS: Record<RuleSection, string> = {
  list: '列表页',
  book: '书籍信息页',
  toc: '章节目录页',
  content: '章节内容页',
}

function headersToText(h?: Record<string, string>): string {
  return Object.entries(h || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function textToHeaders(t: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of linesToArray(t)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export function RuleEditor({ open, onOpenChange, rule, onSaved }: RuleEditorProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [config, setConfig] = useState<RuleConfig>(() => safeParseRuleConfig(''))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(rule?.name || '')
      setDescription(rule?.description || '')
      setEnabled(rule?.enabled ?? true)
      // 兜底解析: 旧格式/损坏 JSON 不会白屏, 回退默认配置
      setConfig(safeParseRuleConfig(rule?.config))
    }
  }, [open, rule])

  const setSection = (section: RuleSection, patch: Partial<PageRule>) => {
    setConfig((c) => ({ ...c, [section]: { ...c[section], ...patch } }))
  }
  const setField = (section: RuleSection, key: string, value: unknown) => {
    setConfig((c) => ({
      ...c,
      [section]: { ...c[section], fields: { ...c[section].fields, [key]: value } },
    }))
  }
  const setFetch = (patch: Partial<FetchConfig>) => {
    setConfig((c) => ({ ...c, fetch: { ...c.fetch, ...patch } }))
  }
  const setClean = (patch: Partial<CleanConfig>) => {
    setConfig((c) => ({ ...c, clean: { ...c.clean, ...patch } }))
  }

  const save = async () => {
    if (!name.trim()) {
      toast.error('请填写规则名称')
      return
    }
    setSaving(true)
    try {
      if (rule) {
        await api.put(`/api/admin/rules/${rule.id}`, { name: name.trim(), description, enabled, config })
        toast.success('规则已更新')
      } else {
        await api.post('/api/admin/rules', { name: name.trim(), description, enabled, config })
        toast.success('规则已创建')
      }
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] sm:max-w-[min(1100px,96vw)] flex-col gap-0 overflow-hidden border-zinc-800 bg-zinc-900 p-0 sm:rounded-xl">
        <DialogHeader className="shrink-0 border-b border-zinc-800 bg-zinc-900 px-6 py-4">
          <DialogTitle className="text-base text-zinc-100">
            {rule ? '编辑采集规则' : '新建采集规则'}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            规则同时支持 CSS 选择器 / XPath / 正则表达式三种提取方式, 每个段落页签内可单独试采
          </DialogDescription>
        </DialogHeader>

        <div className="admin-scroll min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {/* 基本信息 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">规则名称 *</Label>
              <Input
                className="h-9 border-zinc-700 bg-zinc-950 text-sm"
                placeholder="例: 某某小说网全站采集"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">规则描述</Label>
              <Input
                className="h-9 border-zinc-700 bg-zinc-950 text-sm"
                placeholder="适用站点 / 备注"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {/* forceMount: 页签切换不卸载面板, 保留各段测试面板的 URL/结果/加载状态(隐藏由 .rule-tabs CSS 负责) */}
          <Tabs defaultValue="list" className="rule-tabs mt-5">
            <TabsList className="h-9 w-full justify-start gap-1 overflow-x-auto border border-zinc-800 bg-zinc-950">
              <TabsTrigger value="list" className="px-3 text-xs">列表页</TabsTrigger>
              <TabsTrigger value="book" className="px-3 text-xs">书籍信息页</TabsTrigger>
              <TabsTrigger value="toc" className="px-3 text-xs">章节目录页</TabsTrigger>
              <TabsTrigger value="content" className="px-3 text-xs">章节内容页</TabsTrigger>
              <TabsTrigger value="fetch" className="px-3 text-xs">反反爬设置</TabsTrigger>
              <TabsTrigger value="clean" className="px-3 text-xs">内容清洗</TabsTrigger>
            </TabsList>

            <TabsContent value="list" forceMount className="mt-4">
              <PageRulePanel
                section="list"
                pageRule={config.list}
                onChange={(p) => setSection('list', p)}
                onFieldChange={(k, v) => setField('list', k, v)}
                fetchConfig={config.fetch}
                extra={
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-400">
                      列表地址模板 <span className="text-zinc-600">支持 {'{page}'} 占位符</span>
                    </Label>
                    <Input
                      className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
                      placeholder="例: https://example.com/sort/1_{page}.html"
                      value={config.list.urlTemplate || ''}
                      onChange={(e) => setSection('list', { urlTemplate: e.target.value })}
                    />
                  </div>
                }
              />
            </TabsContent>

            <TabsContent value="book" forceMount className="mt-4">
              <PageRulePanel
                section="book"
                pageRule={config.book}
                onChange={(p) => setSection('book', p)}
                onFieldChange={(k, v) => setField('book', k, v)}
                fetchConfig={config.fetch}
              />
            </TabsContent>

            <TabsContent value="toc" forceMount className="mt-4">
              <PageRulePanel
                section="toc"
                pageRule={config.toc}
                onChange={(p) => setSection('toc', p)}
                onFieldChange={(k, v) => setField('toc', k, v)}
                fetchConfig={config.fetch}
                pagination={config.toc.pagination}
                onPaginationChange={(p) =>
                  setSection('toc', { pagination: { ...(config.toc.pagination || { enabled: false, maxPages: 20 }), ...p } })
                }
                extra={
                  <FieldRuleEditor
                    label="目录页链接规则(可选)"
                    value={config.toc.tocLink}
                    onChange={(v) => setSection('toc', { tocLink: v || undefined })}
                    placeholder="目录在独立页面时配置: 从书籍页提取目录页地址; 未配置时默认在书籍页内直接解析章节"
                  />
                }
              />
            </TabsContent>

            <TabsContent value="content" forceMount className="mt-4">
              <PageRulePanel
                section="content"
                pageRule={config.content}
                onChange={(p) => setSection('content', p)}
                onFieldChange={(k, v) => setField('content', k, v)}
                fetchConfig={config.fetch}
                cleanConfig={config.clean}
                pagination={config.content.pagination}
                showJoinWith
                onPaginationChange={(p) =>
                  setSection('content', { pagination: { ...(config.content.pagination || { enabled: false, maxPages: 10 }), ...p } })
                }
              />
            </TabsContent>

            <TabsContent value="fetch" forceMount className="mt-4">
              <FetchPanel fetch={config.fetch} onChange={setFetch} />
            </TabsContent>

            <TabsContent value="clean" forceMount className="mt-4">
              <CleanPanel clean={config.clean} onChange={setClean} />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 border-t border-zinc-800 bg-zinc-900 px-6 py-3 sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            启用该规则
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存规则
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------- 单个采集段面板 ----------------
interface PageRulePanelProps {
  section: RuleSection
  pageRule: PageRule
  onChange: (patch: Partial<PageRule>) => void
  onFieldChange: (key: string, value: unknown) => void
  fetchConfig: FetchConfig
  extra?: ReactNode
  pagination?: NonNullable<PageRule['pagination']>
  onPaginationChange?: (patch: Partial<NonNullable<PageRule['pagination']>>) => void
  showJoinWith?: boolean
  /** 透传清洗配置给测试面板(content 段) */
  cleanConfig?: CleanConfig
}

function PageRulePanel({ section, pageRule, onChange, onFieldChange, fetchConfig, extra, pagination, onPaginationChange, showJoinWith, cleanConfig }: PageRulePanelProps) {
  const fields = useMemo(() => SECTION_FIELD_DEFS[section], [section])

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {/* 左列: 规则配置 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
          <div>
            <div className="text-sm font-medium text-zinc-200">{PAGE_TAB_LABELS[section]}规则</div>
            <div className="text-xs text-zinc-500">
              {section === 'list'
                ? '用于范围模式发现书籍入口'
                : section === 'book'
                  ? '提取书名 / 作者 / 分类 / 简介 / 封面等'
                  : section === 'toc'
                    ? '提取章节标题与链接, 支持目录翻页合并'
                    : '提取章节正文, 支持正文翻页合并'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={pageRule.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
            <span className="text-xs text-zinc-400">启用</span>
          </div>
        </div>

        {extra}

        {/* 列表页/目录页: itemSelector */}
        {(section === 'list' || section === 'toc') && (
          <FieldRuleEditor
            label={section === 'list' ? '列表项容器 itemSelector' : '章节项容器 itemSelector'}
            value={pageRule.itemSelector}
            onChange={(v) => onChange({ itemSelector: v })}
            placeholder="先框定每条记录的容器, 再从容器内提取字段"
          />
        )}

        <div className="space-y-2">
          {fields.map((f) => (
            <FieldRuleEditor
              key={f.key}
              label={f.label}
              value={pageRule.fields?.[f.key]}
              onChange={(v) => onFieldChange(f.key, v)}
              placeholder={f.placeholder}
            />
          ))}
        </div>

        {/* 翻页设置 */}
        {pagination && onPaginationChange && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">翻页设置</span>
              <div className="flex items-center gap-2">
                <Switch checked={pagination.enabled} onCheckedChange={(v) => onPaginationChange({ enabled: v })} />
                <span className="text-xs text-zinc-400">启用翻页合并</span>
              </div>
            </div>
            {pagination.enabled && (
              <div className="space-y-3 pt-1">
                <FieldRuleEditor
                  label="下一页链接 nextLink"
                  value={pagination.nextLink}
                  onChange={(v) => onPaginationChange({ nextLink: v })}
                  placeholder="未配置时自动尝试 a:contains(下一页) / 下一页"
                />
                <div className="flex items-center gap-2">
                  <Label className="w-20 shrink-0 text-right text-xs text-zinc-500">最大合并</Label>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 w-24 border-zinc-700 bg-zinc-950 text-xs"
                    value={pagination.maxPages}
                    onChange={(e) => onPaginationChange({ maxPages: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <span className="text-xs text-zinc-600">页(防止死循环)</span>
                </div>
                {showJoinWith && (
                  <div className="flex items-center gap-2">
                    <Label className="w-20 shrink-0 text-right text-xs text-zinc-500">合并分隔</Label>
                    <Input
                      className="h-8 flex-1 border-zinc-700 bg-zinc-950 font-mono text-xs"
                      placeholder="例: <br/> 或 \n"
                      value={pagination.joinWith || ''}
                      onChange={(e) => onPaginationChange({ joinWith: e.target.value })}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 右列: 测试面板 */}
      <div>
        <TestPanel
          section={section}
          rule={pageRule}
          fetchConfig={fetchConfig}
          cleanConfig={cleanConfig}
          defaultUrl={section === 'list' ? (pageRule.urlTemplate || '').replace('{page}', '1') : ''}
        />
      </div>
    </div>
  )
}

// ---------------- 反反爬设置 ----------------
function FetchPanel({ fetch: fc, onChange }: { fetch: FetchConfig; onChange: (p: Partial<FetchConfig>) => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // token 预取生效条件与引擎一致(fetchPage: tokenUrl+tokenPattern 配置齐全才预取)
  const tokenConfigured = !!(fc.tokenUrl?.trim() && fc.tokenPattern?.trim())
  return (
    <div className="space-y-5">
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">抓取引擎</Label>
            <Select value={fc.engine} onValueChange={(v) => onChange({ engine: v as FetchConfig['engine'] })}>
              <SelectTrigger className="h-9 border-zinc-700 bg-zinc-950 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto · 自动升级(HTTP被拦切浏览器)</SelectItem>
                <SelectItem value="http">http · 纯HTTP直连</SelectItem>
                <SelectItem value="browser">browser · 强制JS浏览器渲染</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">UA 模式</Label>
            <Select value={fc.uaMode} onValueChange={(v) => onChange({ uaMode: v as FetchConfig['uaMode'] })}>
              <SelectTrigger className="h-9 border-zinc-700 bg-zinc-950 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rotate">rotate · 每次随机UA池轮换</SelectItem>
                <SelectItem value="fixed">fixed · 固定UA</SelectItem>
                <SelectItem value="custom">custom · 自定义UA</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {fc.uaMode === 'custom' && (
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">自定义 User-Agent</Label>
            <Input
              className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
              value={fc.customUa || ''}
              onChange={(e) => onChange({ customUa: e.target.value || undefined })}
              placeholder="Mozilla/5.0 (…)"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">超时 (ms)</Label>
            <Input
              type="number"
              className="h-9 border-zinc-700 bg-zinc-950 text-sm"
              value={fc.timeout}
              onChange={(e) => onChange({ timeout: Number(e.target.value) || 20000 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">失败重试次数</Label>
            <Input
              type="number"
              min={0}
              className="h-9 border-zinc-700 bg-zinc-950 text-sm"
              value={fc.retries}
              onChange={(e) => onChange({ retries: Number(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">浏览器等待选择器</Label>
            <Input
              className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
              placeholder="可选, 例: #content"
              value={fc.waitSelector || ''}
              onChange={(e) => onChange({ waitSelector: e.target.value || undefined })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">浏览器等待 (ms)</Label>
            <Input
              type="number"
              className="h-9 border-zinc-700 bg-zinc-950 text-sm"
              value={fc.waitMs ?? 800}
              onChange={(e) => onChange({ waitMs: Number(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">
            点击展开选择器 <span className="text-zinc-600">懒加载目录站, 例: #loadmore / .catalog-all</span>
          </Label>
          <Input
            className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
            placeholder="可选, 浏览器渲染后点击该元素以展开AJAX目录; 页面无此元素时自动跳过"
            value={fc.clickSelector || ''}
            onChange={(e) => onChange({ clickSelector: e.target.value || undefined })}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">
            触发浏览器渲染的状态码 <span className="text-zinc-600">逗号分隔</span>
          </Label>
          <Input
            className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
            placeholder="403, 412, 429, 503"
            value={(fc.browserFallbackStatus || []).join(', ')}
            onChange={(e) =>
              onChange({
                browserFallbackStatus: e.target.value
                  .split(',')
                  .map((s) => Number(s.trim()))
                  .filter((n) => Number.isFinite(n) && n > 0),
              })
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ToggleRow label="自动跟随 Cookie" checked={!!fc.autoCookie} onChange={(v) => onChange({ autoCookie: v })} />
          <ToggleRow label="携带 Referer" checked={!!fc.referer} onChange={(v) => onChange({ referer: v })} />
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Cookie 字符串</Label>
          <Textarea
            className="admin-scroll max-h-40 min-h-24 border-zinc-700 bg-zinc-950 font-mono text-xs"
            placeholder={'k=v; k2=v2 (多行会自动拼接)'}
            value={fc.cookies || ''}
            onChange={(e) => onChange({ cookies: e.target.value || undefined })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">
            附加请求头 <span className="text-zinc-600">每行一条, 格式 k: v</span>
          </Label>
          <HeadersTextarea value={fc.headers} onChange={(headers) => onChange({ headers })} />
        </div>
      </div>
    </div>

    {/* 高级: token 预取钩子(bb-d)与同站并发闸门(aa-f) — 引擎已支持而 UI 未暴露的字段 */}
    <Collapsible
      open={advancedOpen}
      onOpenChange={setAdvancedOpen}
      className="rounded-md border border-zinc-800 bg-zinc-950/60"
    >
      <CollapsibleTrigger
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left hover:bg-zinc-900/60"
        aria-expanded={advancedOpen}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          高级选项
          <span className="text-xs font-normal text-zinc-600">token 预取钩子 / 同站并发闸门 / 镜像切换 / 传输模式</span>
        </span>
        <Badge
          variant="outline"
          className={
            tokenConfigured
              ? 'border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-400'
              : 'border-zinc-700 bg-transparent text-[10px] text-zinc-500'
          }
        >
          {tokenConfigured ? 'token 预取已配置' : '未配置 token 预取'}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid grid-cols-1 gap-4 border-t border-zinc-800 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="adv-token-url" className="text-xs text-zinc-400">Token 预取地址 tokenUrl</Label>
            <Input
              id="adv-token-url"
              className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
              placeholder="http://127.0.0.1:3010/rewrite?url={url}"
              value={fc.tokenUrl || ''}
              onChange={(e) => onChange({ tokenUrl: e.target.value || undefined })}
            />
            <p className="text-[11px] leading-relaxed text-zinc-600">
              请求前先从该端点预取动态 token(响应体含 token 的任意接口, 通常 JSON)。
              支持 {'{url}'} 占位符 = 当前请求 URL 的 URL 编码(对接外置转换代理)。预取失败自动降级直连不断链; 同站 30s 缓存。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-token-pattern" className="text-xs text-zinc-400">Token 提取表达式 tokenPattern</Label>
            <Input
              id="adv-token-pattern"
              className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
              placeholder={'data.token 或 regex:"token":"([^"]+)"'}
              value={fc.tokenPattern || ''}
              onChange={(e) => onChange({ tokenPattern: e.target.value || undefined })}
            />
            <p className="text-[11px] leading-relaxed text-zinc-600">
              &apos;regex:&apos; 前缀 = 正则(取第一捕获组, 无捕获组取全匹配); 否则按 JSON 点路径(如 data.token)。与 tokenUrl 同时配置才生效。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-token-injection" className="text-xs text-zinc-400">Token 注入方式 tokenInjection</Label>
            <Select
              value={fc.tokenInjection || 'url'}
              onValueChange={(v) => onChange({ tokenInjection: v as FetchConfig['tokenInjection'] })}
            >
              <SelectTrigger id="adv-token-injection" className="h-9 border-zinc-700 bg-zinc-950 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="url">url · 写入 URL 占位符或查询参数</SelectItem>
                <SelectItem value="header">header · 写入请求头 tokenHeaderName</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-zinc-600">
              url = 替换请求 URL 中 {'{token}'}/%7Btoken%7D 占位符(无占位符时追加 ?token= 或 &amp;token=);
              header = 注入请求头(头名见下)。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-token-header" className="text-xs text-zinc-400">Token 请求头名 tokenHeaderName</Label>
            <Input
              id="adv-token-header"
              className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
              placeholder="X-Token"
              value={fc.tokenHeaderName || ''}
              onChange={(e) => onChange({ tokenHeaderName: e.target.value || undefined })}
            />
            <p className="text-[11px] leading-relaxed text-zinc-600">
              仅注入方式 = header 时使用, 缺省 X-Token。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-hostgate" className="text-xs text-zinc-400">同站并发上限 hostGateLimit</Label>
            <Input
              id="adv-hostgate"
              type="number"
              min={1}
              max={10}
              className="h-9 border-zinc-700 bg-zinc-950 text-sm"
              value={fc.hostGateLimit ?? 3}
              onChange={(e) => onChange({ hostGateLimit: Math.min(10, Math.max(1, Number(e.target.value) || 3)) })}
            />
            <p className="text-[11px] leading-relaxed text-zinc-600">
              同一站点同时在飞请求数上限(1~10, 缺省 3)。同站连续失败自动降额、连续成功自动回升, 保护源站并降低被封概率。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-mirror" className="text-xs text-zinc-400">镜像域名故障切换 mirrorDomains</Label>
            <Input
              id="adv-mirror"
              className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
              placeholder="apibi.cc,apiqu.cc,apige.cc"
              value={fc.mirrorDomains || ''}
              onChange={(e) => onChange({ mirrorDomains: e.target.value || undefined })}
            />
            <p className="text-[11px] leading-relaxed text-zinc-600">
              逗号分隔镜像域名, 主域 403/5xx/超时自动切换(顺序=优先级, 至多组大小次; 404 不切换)。
              可选带端口(如 localhost:3010); token 预取按重写后 URL 重签。上限 10 条。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-fetchmode" className="text-xs text-zinc-400">采集传输模式 fetchMode</Label>
            <Select
              value={fc.fetchMode || 'native'}
              onValueChange={(v) => onChange({ fetchMode: v === 'native' ? undefined : v })}
            >
              <SelectTrigger id="adv-fetchmode" className="h-9 border-zinc-700 bg-zinc-950 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="native">native · 引擎内置链路(缺省)</SelectItem>
                <SelectItem value="scrapling-static">scrapling-static · curl_cffi 指纹伪装</SelectItem>
                <SelectItem value="scrapling-stealthy">scrapling-stealthy · 隐身浏览器+CF求解</SelectItem>
                <SelectItem value="scrapling-playwright">scrapling-playwright · Playwright 渲染</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-zinc-600">
              scrapling-* 经本机桥服务(mini-services/scrapling-bridge, 缺省 127.0.0.1:3012)以
              Scrapling 代发: static=curl_cffi TLS 指纹伪装; stealthy=patchright 隐身浏览器+Cloudflare
              挑战自动求解; playwright=裸 Chromium JS 渲染。目标响应如实返回(token 预取/Cookie
              重试等 native 步骤跳过); 桥不可达自动降级 native 链。需先启动桥:
              cd mini-services/scrapling-bridge &amp;&amp; bun run dev。
            </p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <span className="text-xs text-zinc-400">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

/**
 * 附加请求头编辑器 — 聚焦走本地草稿, 失焦一次性 textToHeaders 提交。
 * 修前 bug(rr-d2): value=headersToText(config) ⇄ onChange=textToHeaders(输入) 双向受控,
 * textToHeaders 对「无冒号行/空行」是有损丢弃(i>0 判定) → 逐键输入新头 key(未打冒号前)
 * 每键都被回弹吞掉(实测 keyboard.type('X-Probe') 后值=''), 且「已有行+回车+续输」
 * 会把新输入拼进上一行的值造成静默改值(实测 'zh-CN'+'abc'→'zh-CNabc')。
 * 草稿态方案保留逐键自由编辑, blur 时才解析提交; 点保存按钮前 blur 先行, 提交时序安全。
 */
function HeadersTextarea({
  value,
  onChange,
}: {
  value?: Record<string, string>
  onChange: (headers: Record<string, string>) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Textarea
      className="admin-scroll max-h-48 min-h-32 border-zinc-700 bg-zinc-950 font-mono text-xs"
      placeholder={'Accept-Language: zh-CN,zh;q=0.9\nX-Requested-With: XMLHttpRequest'}
      value={draft ?? headersToText(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return
        onChange(textToHeaders(draft))
        setDraft(null)
      }}
    />
  )
}

// ---------------- 内容清洗设置 ----------------
function CleanPanel({ clean, onChange }: { clean: CleanConfig; onChange: (p: Partial<CleanConfig>) => void }) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">
            移除元素选择器 <span className="text-zinc-600">每行一个 CSS 选择器</span>
          </Label>
          <Textarea
            className="admin-scroll max-h-48 min-h-32 border-zinc-700 bg-zinc-950 font-mono text-xs"
            placeholder={'script\n.ad\n#recommend'}
            value={arrayToLines(clean.removeSelectors)}
            onChange={(e) => onChange({ removeSelectors: linesToArray(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">
            广告正则 <span className="text-zinc-600">每行一条, 匹配的段落将被删除</span>
          </Label>
          <Textarea
            className="admin-scroll max-h-48 min-h-32 border-zinc-700 bg-zinc-950 font-mono text-xs"
            placeholder={'请记住本书.*?域名\n最新章节请到.*?查看'}
            value={arrayToLines(clean.adPatterns)}
            onChange={(e) => onChange({ adPatterns: linesToArray(e.target.value) })}
          />
        </div>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">
            标签白名单 <span className="text-zinc-600">逗号分隔, 白名单外标签剥壳保留文本</span>
          </Label>
          <Input
            className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs"
            placeholder="p, br, b, strong, em, i, u"
            value={(clean.whitelist || []).join(', ')}
            onChange={(e) => onChange({ whitelist: e.target.value.split(/[,,]/).map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
        <ToggleRow label="规范段落 (合并空段 / 缩进清理)" checked={clean.normalize} onChange={(v) => onChange({ normalize: v })} />
        <ToggleRow label="纯文本模式 (去掉所有标签只留换行)" checked={clean.plainText} onChange={(v) => onChange({ plainText: v })} />
        <Separator className="bg-zinc-800" />
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-500">
          清洗仅作用于章节正文段落。测试面板选择"章节内容页"页签即可预览清洗前后的长度对比与正文效果。
        </div>
      </div>
    </div>
  )
}
