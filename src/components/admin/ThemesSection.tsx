'use client'

// ============================================================
// 主题模板 — 17 精选 (5 精仿 + 12 设计) + 1728 组合 = 1745 套主题, 分页浏览/搜索/预览
// ============================================================
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ExternalLink, Loader2, Palette, RefreshCw, Search, Star } from 'lucide-react'
import { toast } from 'sonner'
import { api, type SiteRow } from './helpers'

interface ThemeRow {
  id: string
  name: string
  desc: string
  layout: string
  dark: boolean
  read?: { layout?: string }
  preview: [string, string, string]
}

function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function ReadMiniPreview({ layout: _layout, preview, dark: _dark }: { layout: string; preview: [string, string, string]; dark: boolean }) {
  const [bg, primary, accent] = preview
  const frame = { background: bg, border: `1px solid ${tint(primary, 0.35)}` }
  // 通用: 几条横线模拟文字 + 底部翻页条
  return (
    <div className="relative h-12 w-full overflow-hidden rounded-md" style={frame} aria-hidden>
      <span className="absolute inset-x-2 top-2 block h-1 w-10 rounded" style={{ backgroundColor: tint(primary, 0.9) }} />
      <span className="absolute inset-x-2 top-[18px] block h-1 w-full max-w-[85%] rounded" style={{ backgroundColor: tint(primary, 0.45) }} />
      <span className="absolute inset-x-2 top-[28px] block h-1 w-full max-w-[78%] rounded" style={{ backgroundColor: tint(primary, 0.4) }} />
      <span className="absolute inset-x-2 top-[38px] block h-1 w-full max-w-[60%] rounded" style={{ backgroundColor: tint(primary, 0.32) }} />
      <span className="absolute bottom-1 left-1/2 flex h-2.5 w-16 -translate-x-1/2 items-center justify-center rounded-full" style={{ backgroundColor: tint(accent, 0.4) }} />
    </div>
  )
}

interface ThemesSectionProps {
  onPreviewSite?: (themeId?: string) => void
}

export function ThemesSection({ onPreviewSite }: ThemesSectionProps) {
  const [themes, setThemes] = useState<ThemeRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [sites, setSites] = useState<SiteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string>('')

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const [ts, ss] = await Promise.all([
        api.get<{ items: ThemeRow[]; total: number; totalPages: number }>(`/api/admin/themes?page=${p}&size=60`),
        api.get<SiteRow[]>('/api/admin/sites'),
      ])
      setThemes(ts.items || [])
      setTotal(ts.total || 0)
      setTotalPages(ts.totalPages || 1)
      setSites(Array.isArray(ss) ? ss : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载主题失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(1)
  }, [load])

  const filteredThemes = search
    ? themes.filter((t) => t.id.toLowerCase().includes(search.toLowerCase()) || t.name.includes(search))
    : themes

  const defaultSite = sites.find((s) => s.isDefault)

  const applyDefault = async (theme: ThemeRow) => {
    if (!defaultSite) {
      toast.error('尚无默认站点, 请先在「站群系统」中设置默认站点')
      return
    }
    setApplying(theme.id)
    try {
      await api.put(`/api/admin/sites/${defaultSite.id}`, { themeId: theme.id })
      toast.success(`已将默认站点「${defaultSite.name}」的主题设为「${theme.name}」`)
      load(page)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '设置失败')
    } finally {
      setApplying('')
    }
  }

  const isDefaultTheme = (id: string) => defaultSite?.themeId === id

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <Palette className="h-5 w-5 text-violet-400" />
            主题模板
            <span className="text-xs font-normal text-zinc-500">(共 {total} 套: 5 精仿 + 12 设计 + {Math.max(0, total - 17)} 组合)</span>
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            12 配色 × 12 风格 × 12 布局 = 1728 组合 + 17 精选预设 (5 精仿 + 12 设计); 默认站点: {defaultSite ? defaultSite.name : '未设置'}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={() => load(page)}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
      </div>

      {/* 搜索栏 */}
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <Input
          className="h-9 border-zinc-700 bg-zinc-950 pl-8 text-sm"
          placeholder="搜索主题ID或名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          加载主题列表...
        </div>
      ) : filteredThemes.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-500">未找到匹配的主题</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredThemes.map((t) => (
            <Card key={t.id} className={`border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-700 ${isDefaultTheme(t.id) ? 'ring-1 ring-violet-500/50' : ''}`}>
              <CardContent className="space-y-2 p-3">
                {/* 缩略预览 */}
                <ReadMiniPreview layout={t.read?.layout || 'classic'} preview={t.preview} dark={t.dark} />
                {/* 标题 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-zinc-100">{t.name}</h3>
                    <code className="text-[10px] text-zinc-500">{t.id}</code>
                  </div>
                  {isDefaultTheme(t.id) && (
                    <Badge className="shrink-0 bg-violet-500/20 text-violet-300 hover:bg-violet-500/30">
                      <Star className="mr-0.5 h-3 w-3" />
                      当前
                    </Badge>
                  )}
                </div>
                {/* 描述 */}
                <p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{t.desc}</p>
                {/* 标签 */}
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">{t.layout}</Badge>
                  {t.read?.layout && <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">{t.read.layout}</Badge>}
                  {t.dark && <Badge variant="outline" className="border-zinc-700 text-[10px] text-indigo-400">暗色</Badge>}
                </div>
                {/* 操作 */}
                <div className="flex gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 border-zinc-700 bg-transparent px-2 text-xs text-zinc-300 hover:bg-zinc-800"
                    onClick={() => onPreviewSite?.(t.id)}
                  >
                    <ExternalLink className="h-3 w-3" />
                    预览
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 border-zinc-700 bg-transparent px-2 text-xs text-zinc-300 hover:bg-zinc-800"
                    disabled={applying === t.id || !defaultSite}
                    onClick={() => applyDefault(t)}
                  >
                    {applying === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className="h-3 w-3" />}
                    设为默认
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 分页 */}
      {!search && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-zinc-700 bg-zinc-900 text-zinc-300"
            disabled={page <= 1 || loading}
            onClick={() => { setPage(page - 1); load(page - 1) }}
          >
            上一页
          </Button>
          <span className="text-xs text-zinc-500">
            {page} / {totalPages} 页
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-zinc-700 bg-zinc-900 text-zinc-300"
            disabled={page >= totalPages || loading}
            onClick={() => { setPage(page + 1); load(page + 1) }}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  )
}
