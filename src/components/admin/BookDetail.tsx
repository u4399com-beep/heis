'use client'

// ============================================================
// BookDetail — 书籍详情大对话框
// 基本信息编辑 / 下拉关键词管理 / 章节目录浏览与正文编辑
// 章节批量: 目录多选 → 批量删除 / 批量标记未采
// ============================================================
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from './ConfirmDialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, FileText, Loader2, RefreshCw, Save, Tag, Trash2, X } from 'lucide-react'
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
  BOOK_STATUS_META,
  coverUrl,
  fmtDateTime,
  fmtNum,
  fmtWords,
  type BookDetailData,
  type BookTagRow,
  type CategoryRow,
  type ChapterRow,
  type TocRow,
} from './helpers'

interface BookDetailProps {
  bookId: string | null
  onClose: () => void
  onChanged: () => void
}

export function BookDetail({ bookId, onClose, onChanged }: BookDetailProps) {
  const [book, setBook] = useState<BookDetailData | null>(null)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [saving, setSaving] = useState(false)
  const [refreshingTags, setRefreshingTags] = useState(false)

  // 表单
  const [form, setForm] = useState({ name: '', author: '', keywords: '', intro: '', status: 'unknown', categoryId: '' })

  // 目录分页
  const [toc, setToc] = useState<TocRow[]>([])
  const [tocTotal, setTocTotal] = useState(0)
  const [tocPage, setTocPage] = useState(1)
  const [tocLoading, setTocLoading] = useState(false)
  const TOC_SIZE = 50

  // 章节编辑
  const [chapter, setChapter] = useState<ChapterRow | null>(null)
  const [chapterContent, setChapterContent] = useState('')
  const [chapterLoading, setChapterLoading] = useState(false)
  const [chapterSaving, setChapterSaving] = useState(false)

  // 章节批量(作用于当前目录页勾选, 跨页保留)
  const tocIds = useMemo(() => toc.map((c) => c.id), [toc])
  const chBatch = useBatchSelection(tocIds)
  const [chBatchRunning, setChBatchRunning] = useState(false)
  const [chBatchConfirm, setChBatchConfirm] = useState<'' | 'delete' | 'unfetched'>('')

  // 分卷分组(kk-a): 当前页出现卷名才启用(连续相同 volume 为一组, 空卷归「正文」);
  // 旧书全空卷 → tocGroups=null → 渲染与改前完全一致(零回归)
  const [volCollapsed, setVolCollapsed] = useState<Set<string>>(new Set())
  const tocGroups = useMemo(() => {
    if (!toc.some((c) => c.volume)) return null
    const groups: { volume: string; chapters: TocRow[] }[] = []
    for (const c of toc) {
      const vol = c.volume || ''
      const last = groups[groups.length - 1]
      if (last && last.volume === vol) last.chapters.push(c)
      else groups.push({ volume: vol, chapters: [c] })
    }
    return groups
  }, [toc])
  const toggleVol = (vol: string) =>
    setVolCollapsed((s) => {
      const n = new Set(s)
      if (n.has(vol)) n.delete(vol)
      else n.add(vol)
      return n
    })

  const aliveRef = useRef(true)
  const bookSeqRef = useRef(0)
  const tocSeqRef = useRef(0)
  const chSeqRef = useRef(0)

  // 卸载后停止异步 setState
  useEffect(() => {
    return () => {
      aliveRef.current = false
    }
  }, [])

  // seq 卫: 快速关开切换不同书籍时, 旧书的慢响应不得覆盖新书的表单(与 loadToc 同款防线)
  const loadBook = useCallback(async (id: string) => {
    const seq = ++bookSeqRef.current
    try {
      const data = await api.get<BookDetailData>(`/api/admin/books/${id}`)
      if (!aliveRef.current || seq !== bookSeqRef.current) return
      setBook(data)
      setForm({
        name: data.name || '',
        author: data.author || '',
        keywords: data.keywords || '',
        intro: data.intro || '',
        status: data.status || 'unknown',
        categoryId: data.categoryId || '',
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载书籍详情失败')
    }
  }, [])

  const loadToc = useCallback(async (id: string, page: number) => {
    const seq = ++tocSeqRef.current
    setTocLoading(true)
    try {
      let p = page
      // 回退重拉: 章节被删除/数据收缩导致当前页越界时, 转到最后一页再取一次(与书籍列表分页兜底同策略)
      for (;;) {
        const data = await api.get<{ total: number; chapters: TocRow[] }>(`/api/admin/books/${id}/toc`, { page: p, size: TOC_SIZE })
        if (!aliveRef.current || seq !== tocSeqRef.current) return
        const maxPage = Math.max(1, Math.ceil((data.total || 0) / TOC_SIZE))
        if (!(data.chapters || []).length && p > maxPage) {
          p = maxPage
          setTocPage(maxPage)
          continue
        }
        setToc(data.chapters || [])
        setTocTotal(data.total || 0)
        return
      }
    } catch (e) {
      if (aliveRef.current && seq === tocSeqRef.current) toast.error(e instanceof Error ? e.message : '加载目录失败')
    } finally {
      if (aliveRef.current && seq === tocSeqRef.current) setTocLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!bookId) {
      setChapter(null)
      setChapterContent('')
      return
    }
    setBook(null)
    setToc([])
    setTocPage(1)
    setChapter(null)
    setChapterContent('')
    setVolCollapsed(new Set())
    loadBook(bookId)
    loadToc(bookId, 1)
    api.get<CategoryRow[]>('/api/admin/categories').then((cs) => setCategories(Array.isArray(cs) ? cs : [])).catch(() => setCategories([]))
  }, [bookId, loadBook, loadToc])

  const patchForm = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }))

  const save = async () => {
    if (!book) return
    setSaving(true)
    try {
      await api.put(`/api/admin/books/${book.id}`, { ...form, categoryId: form.categoryId || null })
      toast.success('书籍信息已保存')
      await loadBook(book.id)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const refreshTags = async () => {
    if (!book) return
    setRefreshingTags(true)
    try {
      const res = await api.post<{ added: number; updated: number; engines: string[] }>(`/api/admin/books/${book.id}/keywords`, { limit: 25 })
      toast.success(`下拉词刷新完成: 新增 ${res.added}, 更新 ${res.updated}${res.engines?.length ? ` (${res.engines.join('/')})` : ''}`)
      await loadBook(book.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下拉词刷新失败')
    } finally {
      setRefreshingTags(false)
    }
  }

  const removeTag = async (tag: string) => {
    if (!book) return
    try {
      await api.del(`/api/admin/books/${book.id}/keywords`, { tag })
      setBook((b) => (b ? { ...b, tags: b.tags.filter((t) => t.tag !== tag) } : b))
      toast.success(`已移除关键词「${tag}」`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '移除失败')
    }
  }

  const openChapter = async (ch: TocRow) => {
    const seq = ++chSeqRef.current
    setChapterLoading(true)
    setChapter({ ...ch, bookId: bookId || '' })
    setChapterContent('')
    try {
      const data = await api.get<ChapterRow>(`/api/admin/chapters/${ch.id}`)
      if (!aliveRef.current || seq !== chSeqRef.current) return
      setChapter(data)
      setChapterContent(data.content || '')
    } catch (e) {
      if (aliveRef.current && seq === chSeqRef.current) toast.error(e instanceof Error ? e.message : '加载章节失败')
    } finally {
      if (aliveRef.current && seq === chSeqRef.current) setChapterLoading(false)
    }
  }

  const saveChapter = async () => {
    if (!chapter) return
    setChapterSaving(true)
    try {
      await api.put(`/api/admin/chapters/${chapter.id}`, { title: chapter.title, content: chapterContent })
      toast.success('章节已保存')
      setChapter(null)
      if (bookId) loadToc(bookId, tocPage)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setChapterSaving(false)
    }
  }

  const tocTotalPages = Math.max(1, Math.ceil(tocTotal / TOC_SIZE))

  // 章节批量动作: 成功→清选+重拉当前页目录+通知外层刷新字数
  const runChapterBatch = async (action: string, describe: string) => {
    if (!bookId) return
    setChBatchRunning(true)
    try {
      const res = await runBatch('/api/admin/chapters/batch', { action, ids: chBatch.selectedOrdered }, () => describe)
      if (res) {
        chBatch.clearSelection()
        await loadToc(bookId, tocPage)
        onChanged()
      }
    } finally {
      setChBatchRunning(false)
    }
  }

  const doChapterBatch = () => {
    const kind = chBatchConfirm
    setChBatchConfirm('')
    void runChapterBatch(
      kind === 'delete' ? 'delete' : 'markUnfetched',
      kind === 'delete' ? `已删除 ${chBatch.selectedCount} 个章节` : `已将 ${chBatch.selectedCount} 个章节标记为未采(正文已清空, 保留源地址供重采)`
    )
  }

  // 目录单行渲染(分卷/非分卷两分支共用, 标记与改前一致)
  const renderTocRow = (c: TocRow) => (
    <TableRow key={c.id} className="border-zinc-800/70">
      <TableCell className="py-1.5 pr-0">
        <BatchCheckbox
          checked={chBatch.selected.has(c.id)}
          onCheckedChange={() => chBatch.toggle(c.id)}
          ariaLabel={`选择「${c.title}」`}
        />
      </TableCell>
      <TableCell className="py-1.5 font-mono text-xs text-zinc-600">{c.idx}</TableCell>
      <TableCell className="max-w-[320px] truncate py-1.5 text-xs text-zinc-300" title={c.title}>
        {c.title}
      </TableCell>
      <TableCell className="py-1.5 font-mono text-xs text-zinc-500">{fmtWords(c.wordCount)}</TableCell>
      <TableCell className="py-1.5">
        <Badge
          variant="outline"
          className={`text-[10px] ${
            c.fetched
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : 'border-zinc-700 bg-zinc-900 text-zinc-500'
          }`}
        >
          {c.fetched ? '已采' : '未采'}
        </Badge>
      </TableCell>
      <TableCell className="py-1.5 text-[10px] text-zinc-500">{c.storage === 'txt' ? 'TXT' : 'DB'}</TableCell>
      <TableCell className="py-1.5 text-right">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px] text-violet-400 hover:text-violet-300"
          onClick={() => openChapter(c)}
        >
          查看
        </Button>
      </TableCell>
    </TableRow>
  )

  return (
    <>
      <Dialog open={!!bookId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="admin-scroll max-h-[94vh] sm:max-w-[min(880px,96vw)] overflow-y-auto border-zinc-800 bg-zinc-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-100">
            <BookOpen className="h-4 w-4 text-violet-400" />
            书籍详情
          </DialogTitle>
          <DialogDescription className="break-all text-xs text-zinc-500">
            {book?.sourceUrl ? `来源: ${book.sourceUrl}` : '手动创建, 无来源地址'}
          </DialogDescription>
        </DialogHeader>

        {!book ? (
          <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : (
          <div className="space-y-5">
            {/* 基本信息 */}
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="shrink-0">
                <div className="h-[133px] w-24 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
                  {book.cover ? (
                    <img src={coverUrl(book.cover)} alt={book.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">无封面</div>
                  )}
                </div>
                <div className="mt-1.5 text-center text-[10px] text-zinc-600">{fmtNum(book._count?.chapters || 0)} 章</div>
              </div>
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">书名</Label>
                  <Input className="h-8 border-zinc-700 bg-zinc-950 text-sm" value={form.name} onChange={(e) => patchForm({ name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">作者</Label>
                  <Input className="h-8 border-zinc-700 bg-zinc-950 text-sm" value={form.author} onChange={(e) => patchForm({ author: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">分类</Label>
                  <Select value={form.categoryId || '__none__'} onValueChange={(v) => patchForm({ categoryId: v === '__none__' ? '' : v })}>
                    <SelectTrigger className="h-8 border-zinc-700 bg-zinc-950 text-sm">
                      <SelectValue placeholder="未分类" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-sm">
                        未分类
                      </SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-sm">
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">状态</Label>
                  <Select value={form.status} onValueChange={(v) => patchForm({ status: v })}>
                    <SelectTrigger className="h-8 border-zinc-700 bg-zinc-950 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ongoing" className="text-sm">连载中</SelectItem>
                      <SelectItem value="completed" className="text-sm">已完结</SelectItem>
                      <SelectItem value="unknown" className="text-sm">未知</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs text-zinc-400">关键词 (站内SEO)</Label>
                  <Input className="h-8 border-zinc-700 bg-zinc-950 text-sm" placeholder="逗号分隔" value={form.keywords} onChange={(e) => patchForm({ keywords: e.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs text-zinc-400">简介</Label>
                  <Textarea className="admin-scroll max-h-40 min-h-20 border-zinc-700 bg-zinc-950 text-sm" value={form.intro} onChange={(e) => patchForm({ intro: e.target.value })} />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Button size="sm" className="h-8 gap-1.5" onClick={save} disabled={saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    保存基本信息
                  </Button>
                  <span className="text-xs text-zinc-600">
                    更新于 {fmtDateTime(book.updatedAt)} · 存储模式: {book.storageMode === 'txt' ? 'TXT' : '数据库'}
                  </span>
                </div>
              </div>
            </div>

            <Separator className="bg-zinc-800" />

            {/* 下拉关键词 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <Tag className="h-4 w-4 text-rose-400" />
                  下拉关键词
                  <span className="text-xs font-normal text-zinc-500">({book.tags?.length || 0} 个, 来自搜索引擎 suggest)</span>
                </div>
                <Button size="sm" variant="outline" className="h-7 gap-1 border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800" onClick={refreshTags} disabled={refreshingTags}>
                  {refreshingTags ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  刷新下拉词
                </Button>
              </div>
              <div className="admin-scroll flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
                {book.tags?.length ? (
                  book.tags.map((t: BookTagRow) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 py-0.5 pl-2.5 pr-1 text-xs text-zinc-300"
                      title={`来源: ${t.source === 'manual' ? '手动' : 'suggest'} · 热度 ${t.hits}`}
                    >
                      {t.tag}
                      <span className="font-mono text-[10px] text-zinc-600">{t.hits}</span>
                      <button
                        type="button"
                        className="rounded-full p-0.5 text-zinc-600 hover:bg-red-500/20 hover:text-red-400"
                        onClick={() => removeTag(t.tag)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-zinc-600">暂无关键词, 点击「刷新下拉词」从搜索引擎聚合</span>
                )}
              </div>
            </div>

            <Separator className="bg-zinc-800" />

            {/* 章节目录 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <FileText className="h-4 w-4 text-amber-400" />
                  章节目录
                  <span className="text-xs font-normal text-zinc-500">(共 {fmtNum(tocTotal)} 章)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0 border-zinc-700 bg-zinc-900 text-zinc-300"
                    disabled={tocPage <= 1 || tocLoading}
                    onClick={() => {
                      const p = tocPage - 1
                      setTocPage(p)
                      if (bookId) loadToc(bookId, p)
                    }}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="min-w-16 text-center text-xs text-zinc-400">
                    {tocPage} / {tocTotalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0 border-zinc-700 bg-zinc-900 text-zinc-300"
                    disabled={tocPage >= tocTotalPages || tocLoading}
                    onClick={() => {
                      const p = tocPage + 1
                      setTocPage(p)
                      if (bookId) loadToc(bookId, p)
                    }}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="admin-scroll max-h-96 overflow-y-auto rounded-md border border-zinc-800">
                <BatchBar count={chBatch.selectedCount} onClear={chBatch.clearSelection} hint="仅当前页勾选">
                  <BatchActionButton
                    running={chBatchRunning}
                    className="text-red-400 hover:text-red-300"
                    onClick={() => setChBatchConfirm('delete')}
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </BatchActionButton>
                  <BatchActionButton
                    running={chBatchRunning}
                    className="text-amber-400 hover:text-amber-300"
                    onClick={() => setChBatchConfirm('unfetched')}
                    title="清空已采内容并标记为未采, 保留源章节地址供重新采集"
                  >
                    标记未采
                  </BatchActionButton>
                </BatchBar>
                {tocLoading ? (
                  <div className="flex items-center justify-center py-10 text-xs text-zinc-500">
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    加载目录…
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="w-9 pr-0">
                          <BatchCheckbox
                            checked={chBatch.allSelected}
                            indeterminate={chBatch.indeterminate}
                            onCheckedChange={chBatch.toggleAll}
                            ariaLabel="全选本页章节"
                          />
                        </TableHead>
                        <TableHead className="w-14 text-xs text-zinc-500">序号</TableHead>
                        <TableHead className="text-xs text-zinc-500">标题</TableHead>
                        <TableHead className="w-20 text-xs text-zinc-500">字数</TableHead>
                        <TableHead className="w-20 text-xs text-zinc-500">正文</TableHead>
                        <TableHead className="w-16 text-xs text-zinc-500">存储</TableHead>
                        <TableHead className="w-16 text-right text-xs text-zinc-500">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {toc.length === 0 ? (
                        <TableRow className="border-zinc-800/70">
                          <TableCell colSpan={7} className="py-8 text-center text-xs text-zinc-600">
                            暂无章节
                          </TableCell>
                        </TableRow>
                      ) : tocGroups ? (
                        // 分卷模式: 卷头行(可折叠) + 组内章节行; 卷头样式沿用 zinc 设计语言
                        tocGroups.map((g, gi) => {
                          const collapsed = volCollapsed.has(g.volume)
                          return (
                            <Fragment key={`vol-${gi}-${g.volume}`}>
                              <TableRow className="border-zinc-800/70 bg-zinc-950/70">
                                <TableCell colSpan={7} className="py-1.5">
                                  <button
                                    type="button"
                                    data-vol-head
                                    className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5 text-left"
                                    aria-expanded={!collapsed}
                                    onClick={() => toggleVol(g.volume)}
                                  >
                                    {collapsed ? (
                                      <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
                                    ) : (
                                      <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
                                    )}
                                    {/* 超长卷名截断防撑宽(table-auto 下 break-all 不阻撑宽): 完整名走 title 提示 */}
                                    <span
                                      className="max-w-[560px] truncate text-xs font-semibold tracking-wide text-zinc-200"
                                      title={g.volume || '正文'}
                                    >{g.volume || '正文'}</span>
                                    <span className="text-[10px] text-zinc-600">{g.chapters.length} 章</span>
                                  </button>
                                </TableCell>
                              </TableRow>
                              {!collapsed && g.chapters.map(renderTocRow)}
                            </Fragment>
                          )
                        })
                      ) : (
                        toc.map(renderTocRow)
                      )}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* 章节查看/编辑 — 独立于外层 Dialog, 避免外层关闭后内层滞留; bookId 清空时同步关闭 */}
    <Dialog open={!!chapter && !!bookId} onOpenChange={(v) => !v && setChapter(null)}>
        <DialogContent className="flex max-h-[92vh] sm:max-w-[min(760px,96vw)] flex-col border-zinc-800 bg-zinc-900">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-sm text-zinc-100">
              章节内容
              {chapter && (
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  第 {chapter.idx} 章 · {fmtWords(chapter.wordCount)} 字 · {chapter.storage === 'txt' ? 'TXT存储' : '数据库'}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">查看与编辑章节标题及正文内容</DialogDescription>
            {chapter && (
              <div className="mt-1">
                <Input
                  className="h-8 border-zinc-700 bg-zinc-950 text-sm"
                  value={chapter.title}
                  onChange={(e) => setChapter((c) => (c ? { ...c, title: e.target.value } : c))}
                  placeholder="章节标题"
                />
              </div>
            )}
          </DialogHeader>
          {chapterLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载正文…
            </div>
          ) : (
            <Textarea
              className="admin-scroll min-h-0 flex-1 resize-none border-zinc-700 bg-zinc-950 font-mono text-xs leading-relaxed"
              value={chapterContent}
              onChange={(e) => setChapterContent(e.target.value)}
              placeholder="章节正文 (支持 HTML)"
            />
          )}
          <DialogFooter className="shrink-0">
            <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800" onClick={() => setChapter(null)}>
              取消
            </Button>
            <Button size="sm" className="gap-1.5" onClick={saveChapter} disabled={chapterLoading || chapterSaving}>
              {chapterSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存章节
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 章节批量确认 */}
      <ConfirmDialog
        open={!!chBatchConfirm}
        onOpenChange={(v) => !v && setChBatchConfirm('')}
        title={
          chBatchConfirm === 'delete'
            ? `确认批量删除 ${chBatch.selectedCount} 个章节?`
            : `确认将 ${chBatch.selectedCount} 个章节标记为未采?`
        }
        description={
          chBatchConfirm === 'delete'
            ? '将删除所选章节记录及其 TXT 文件, 该操作不可恢复。'
            : '将清空这些章节的已采正文(含 TXT 文件)并标记为未采, 源章节地址保留, 可通过重采任务重新采集。'
        }
        tone={chBatchConfirm === 'delete' ? 'danger' : 'amber'}
        onConfirm={doChapterBatch}
      />
    </>
  )
}
