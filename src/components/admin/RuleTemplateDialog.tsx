'use client'

// ============================================================
// RuleTemplateDialog — 规则模板库浏览器 (feat-round-8: Feature A2)
// 网格展示 8 个预置模板, 支持「分类筛选 + 关键字搜索 + 预览配置 JSON + 一键创建规则」。
// 「使用此模板」按钮: POST /api/admin/rules 创建一条带模板 config 的新规则
//   (name 预填为 "[模板] 笔趣阁标准模板", 用户可在规则编辑器里改名/改 URL);
// 「预览配置」按钮: 打开子对话框展示模板的完整 RuleConfig JSON(只读 <pre> 块)。
//
// 视觉规范 (feat-round-8 S1/S2):
//   - 主对话框 max-w-4xl, max-h-[85vh], 内层 scroll;
//   - 筛选条 sticky top, bg-zinc-950/80 backdrop-blur;
//   - 模板卡片: border-zinc-800 bg-zinc-900/60 hover:border-violet-600 hover:bg-zinc-900 transition;
//   - 分类徽章颜色: biquge=violet / api=sky / forum=amber / wiki=emerald / custom=zinc;
//   - 难度徽章颜色: easy=emerald / medium=amber / hard=red;
//   - 桌面 2 列 / 移动 1 列网格, gap-4。
//
// agent-X-rule-test 增强:
//   - 关键字搜索加 300ms 防抖(避免大模板列表逐键全量过滤)
//   - 新增"难度"筛选下拉(easy/medium/hard/全部)
//   - 卡片名称/描述中匹配关键字的文字高亮(emerald), 让用户看到为何被命中
//   - 模板卡片包 React.memo, 关键字/分类切换时仅重渲染过滤变化的卡片
// ============================================================
import { memo, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Eye, FileJson, LayoutTemplate, Loader2, Sparkles, Tags } from 'lucide-react'
import { toast } from 'sonner'
import { api, type RuleRow } from './helpers'
import {
  RULE_TEMPLATES,
  filterTemplates,
  TEMPLATE_CATEGORY_COLORS,
  TEMPLATE_DIFFICULTY_COLORS,
  type RuleTemplate,
  type RuleTemplateCategory,
  type RuleTemplateDifficulty,
} from '@/lib/crawl/rule-templates'

interface RuleTemplateDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 创建规则成功后回调(供父组件刷新规则列表) */
  onCreated?: (rule: RuleRow) => void
}

type DifficultyFilter = RuleTemplateDifficulty | 'all'

export function RuleTemplateDialog({ open, onOpenChange, onCreated }: RuleTemplateDialogProps) {
  const [category, setCategory] = useState<RuleTemplateCategory | 'all'>('all')
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all')
  const [keyword, setKeyword] = useState('')
  // agent-X: 防抖 — 让用户输入流畅, 不每次按键都全量过滤 8 条记录
  const [debouncedKw, setDebouncedKw] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKw(keyword.trim()), 300)
    return () => clearTimeout(t)
  }, [keyword])

  const [previewing, setPreviewing] = useState<RuleTemplate | null>(null)
  const [creating, setCreating] = useState<string | null>(null) // 正在创建的模板 id (用于按钮 loading)

  const filtered = useMemo(
    () => {
      // 复用 filterTemplates 但叠加 difficulty 过滤; keyword 用防抖后的版本
      const base = filterTemplates(RULE_TEMPLATES, { category, keyword: debouncedKw })
      if (difficulty === 'all') return base
      return base.filter((t) => t.difficulty === difficulty)
    },
    [category, difficulty, debouncedKw],
  )

  const handleUseTemplate = async (tpl: RuleTemplate) => {
    setCreating(tpl.id)
    try {
      const created = await api.post<RuleRow>('/api/admin/rules', {
        name: `[模板] ${tpl.name}`,
        description: tpl.description,
        config: tpl.config,
        enabled: true,
      })
      toast.success(`已从模板创建规则「[模板] ${tpl.name}」`)
      onCreated?.(created)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建规则失败')
    } finally {
      setCreating(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-h-[85vh] flex-col gap-0 border-zinc-800 bg-zinc-950 p-0 sm:max-w-4xl"
          showCloseButton
        >
          {/* 头部 */}
          <DialogHeader className="flex-shrink-0 border-b border-zinc-800 p-6 pb-4">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
              <LayoutTemplate className="h-5 w-5 text-violet-400" />
              规则模板库
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500">
              选择一个预设模板快速创建采集规则, 安装后可自行修改 URL / 选择器 / 字段映射等配置。
            </DialogDescription>
          </DialogHeader>

          {/* 筛选条 (sticky top) */}
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur">
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as RuleTemplateCategory | 'all')}
            >
              <SelectTrigger
                size="sm"
                className="h-9 w-[140px] border-zinc-700 bg-zinc-900 text-sm text-zinc-300"
                aria-label="按分类筛选模板"
              >
                <SelectValue placeholder="全部分类" />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-200">
                <SelectItem value="all">全部分类</SelectItem>
                <SelectItem value="biquge">笔趣阁系</SelectItem>
                <SelectItem value="api">API JSON</SelectItem>
                <SelectItem value="forum">论坛体</SelectItem>
                <SelectItem value="wiki">维基型</SelectItem>
                <SelectItem value="custom">通用</SelectItem>
              </SelectContent>
            </Select>
            {/* agent-X-rule-test: 难度筛选下拉 — easy/medium/hard/全部 */}
            <Select
              value={difficulty}
              onValueChange={(v) => setDifficulty(v as DifficultyFilter)}
            >
              <SelectTrigger
                size="sm"
                className="h-9 w-[120px] border-zinc-700 bg-zinc-900 text-sm text-zinc-300"
                aria-label="按难度筛选模板"
              >
                <SelectValue placeholder="全部难度" />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-200">
                <SelectItem value="all">全部难度</SelectItem>
                <SelectItem value="easy">简单</SelectItem>
                <SelectItem value="medium">中等</SelectItem>
                <SelectItem value="hard">困难</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="h-9 w-full flex-1 border-zinc-700 bg-zinc-900 text-sm text-zinc-200 placeholder:text-zinc-600"
              placeholder="按名称 / 描述 / 标签搜索… (300ms 防抖)"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              aria-label="搜索模板"
            />
            <div className="flex-shrink-0 text-xs text-zinc-500">
              {filtered.length} / {RULE_TEMPLATES.length} 个模板
            </div>
          </div>

          {/* 模板网格 (scroll) */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-zinc-500">
                <Sparkles className="h-8 w-8 text-zinc-700" />
                <p>没有匹配的模板, 换个关键字或难度试试。</p>
                {/* agent-X: 一键复位筛选条件 */}
                {(category !== 'all' || difficulty !== 'all' || keyword) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-zinc-400 hover:text-zinc-200"
                    onClick={() => {
                      setCategory('all')
                      setDifficulty('all')
                      setKeyword('')
                    }}
                  >
                    重置筛选
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {filtered.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    keyword={debouncedKw}
                    creating={creating === tpl.id}
                    onUse={() => handleUseTemplate(tpl)}
                    onPreview={() => setPreviewing(tpl)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 底部提示 */}
          <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950/80 px-6 py-3 text-xs text-zinc-600 backdrop-blur">
            模板使用占位域名 <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">https://example.com/</code>, 安装后请在规则编辑器里改成真实站点地址。
          </div>
        </DialogContent>
      </Dialog>

      {/* 配置预览子对话框 */}
      <Dialog open={!!previewing} onOpenChange={(v) => !v && setPreviewing(null)}>
        <DialogContent className="flex max-h-[80vh] flex-col gap-0 border-zinc-800 bg-zinc-950 p-0 sm:max-w-3xl">
          <DialogHeader className="flex-shrink-0 border-b border-zinc-800 p-6 pb-4">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-zinc-100">
              <FileJson className="h-4 w-4 text-violet-400" />
              {previewing?.name} — 配置预览
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">
              只读展示模板的完整 RuleConfig(JSON 格式, 4 段页面规则 + fetch + clean)。点击「使用此模板」即可基于此配置创建新规则。
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4">
            <pre className="overflow-auto rounded-md border border-zinc-800 bg-zinc-900/80 p-4 text-xs leading-relaxed text-zinc-300">
              {previewing ? JSON.stringify(previewing.config, null, 2) : ''}
            </pre>
            {previewing?.notes && (
              <div className="mt-3 rounded-md border border-amber-800/40 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-300/90">
                <span className="font-semibold text-amber-300">使用备注: </span>
                {previewing.notes}
              </div>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur">
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              onClick={() => setPreviewing(null)}
            >
              关闭
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-violet-600 text-white hover:bg-violet-500"
              disabled={!previewing || creating === previewing?.id}
              onClick={() => previewing && handleUseTemplate(previewing)}
            >
              {creating === previewing?.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              使用此模板
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ============================================================
// 模板卡片 — 网格单元 (feat-round-8 S1)
// agent-X: memo + keyword 高亮; 名称/描述中匹配关键字的文字加 emerald 高亮
// ============================================================
interface TemplateCardProps {
  template: RuleTemplate
  /** 当前搜索关键字(已防抖); 用于在名称/描述里高亮命中片段 */
  keyword?: string
  creating: boolean
  onUse: () => void
  onPreview: () => void
}

function highlightMatch(text: string, kw: string): React.ReactNode {
  if (!kw) return text
  const lower = text.toLowerCase()
  const kwl = kw.toLowerCase()
  const parts: React.ReactNode[] = []
  let i = 0
  let idx = lower.indexOf(kwl, i)
  let partKey = 0
  while (idx >= 0) {
    if (idx > i) parts.push(<span key={partKey++}>{text.slice(i, idx)}</span>)
    parts.push(
      <mark key={partKey++} className="rounded bg-emerald-500/30 px-0.5 text-emerald-200">
        {text.slice(idx, idx + kwl.length)}
      </mark>,
    )
    i = idx + kwl.length
    idx = lower.indexOf(kwl, i)
  }
  if (i < text.length) parts.push(<span key={partKey++}>{text.slice(i)}</span>)
  return parts
}

const TemplateCard = memo(function TemplateCard({
  template,
  keyword,
  creating,
  onUse,
  onPreview,
}: TemplateCardProps) {
  const catColor = TEMPLATE_CATEGORY_COLORS[template.category]
  const diffColor = TEMPLATE_DIFFICULTY_COLORS[template.difficulty]
  return (
    <Card className="group flex flex-col gap-3 border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-violet-600 hover:bg-zinc-900">
      {/* 头部: 分类徽章 + 难度徽章 */}
      <div className="flex items-start justify-between gap-2">
        <Badge
          variant="outline"
          className={`gap-1.5 px-2 py-0.5 text-[10px] font-medium ${catColor.badge}`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${catColor.dot}`} />
          {catColor.label}
        </Badge>
        <Badge
          variant="outline"
          className={`px-2 py-0.5 text-[10px] font-medium ${diffColor.badge}`}
        >
          {diffColor.label}
        </Badge>
      </div>

      {/* 名称 — 高亮匹配关键字 */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">{highlightMatch(template.name, keyword || '')}</h3>
      </div>

      {/* 描述 (2 行省略, 高亮匹配) */}
      <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">
        {highlightMatch(template.description, keyword || '')}
      </p>

      {/* 标签 chips */}
      {template.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {template.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded border border-zinc-700/70 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400"
            >
              <Tags className="h-2.5 w-2.5 opacity-60" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 备注 (1 行省略, 鼠标悬停 title) */}
      {template.notes && (
        <p
          className="line-clamp-1 text-[11px] text-zinc-500"
          title={template.notes}
        >
          <span className="text-zinc-600">备注: </span>
          {template.notes}
        </p>
      )}

      {/* 按钮组 */}
      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-8 flex-1 gap-1.5 bg-violet-600 text-xs text-white hover:bg-violet-500"
          disabled={creating}
          onClick={onUse}
        >
          {creating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          使用此模板
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800"
          onClick={onPreview}
        >
          <Eye className="h-3 w-3" />
          预览配置
        </Button>
      </div>
    </Card>
  )
})
