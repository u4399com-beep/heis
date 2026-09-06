'use client'

// ============================================================
// 主题模板 — 8 套前台主题卡片 / 预览 / 设为默认站点主题
// ============================================================
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, Loader2, Palette, RefreshCw, Star } from 'lucide-react'
import { toast } from 'sonner'
import { api, type SiteRow } from './helpers'

interface ThemeRow {
  id: string
  name: string
  desc: string
  layout: string
  dark: boolean
  /** 阅读页布局配置（themes API 直接返回注册表, 旧数据可缺省） */
  read?: { layout?: string }
  preview: [string, string, string]
}

/** 阅读布局中文标签（与 themes.ts READ_LAYOUT_LABEL 对齐, 避免引入服务端模块） */
const READ_LABEL: Record<string, string> = {
  classic: '典书版',
  immersive: '沉浸暗夜',
  paginated: '分页横滑',
  pili: '书屋版',
}

/** hex → rgba 淡色（缩略图主题色着色用; 非 6 位 hex 色值原样返回兜底） */
function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** 阅读版式缩略示意 — 同时体现 readLayout 版式差异与主题 preview 三色配色差异 */
function ReadMiniPreview({ layout, preview }: { layout: string; preview: [string, string, string] }) {
  const [bg, primary, accent] = preview
  // 外框底色 = 主题 bg 色(preview[0]), 描边 = 主题 primary 淡色
  const frame = { background: bg, border: `1px solid ${tint(primary, 0.35)}` }
  if (layout === 'pili') {
    // 书屋版: 顶部细橙头条 + 暖纸面行 + 底部橙色翻章条
    return (
      <div className="relative h-12 w-full overflow-hidden rounded-md" style={frame} aria-hidden>
        <span className="absolute inset-x-0 top-0 block h-2" style={{ backgroundColor: tint(primary, 0.85) }} />
        <span className="absolute left-1/2 top-[14px] block h-1 w-1/3 -translate-x-1/2 rounded" style={{ backgroundColor: tint(primary, 0.75) }} />
        <span className="absolute left-1/2 top-[22px] block h-0.5 w-3/4 -translate-x-1/2 rounded" style={{ backgroundColor: tint(primary, 0.3) }} />
        <span className="absolute left-1/2 top-[27px] block h-0.5 w-2/3 -translate-x-1/2 rounded" style={{ backgroundColor: tint(primary, 0.26) }} />
        <span className="absolute inset-x-3 bottom-1 flex h-2.5 items-center justify-between rounded-sm px-1" style={{ backgroundColor: tint(primary, 0.88) }}>
          <span className="block h-0.5 w-3 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.9)' }} />
          <span className="block h-0.5 w-3 rounded" style={{ backgroundColor: tint(accent, 0.9) }} />
          <span className="block h-0.5 w-3 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.9)' }} />
        </span>
      </div>
    )
  }
  if (layout === 'immersive') {
    // 全幅暗底 + 底部翻章条 + 右下悬浮胶囊
    return (
      <div className="relative h-12 w-full overflow-hidden rounded-md" style={frame} aria-hidden>
        <span className="absolute inset-x-2 top-2 block h-1 w-10 rounded" style={{ backgroundColor: tint(primary, 0.9) }} />
        <span className="absolute inset-x-2 top-[18px] block h-1 w-full max-w-[85%] rounded" style={{ backgroundColor: tint(primary, 0.45) }} />
        <span className="absolute inset-x-2 top-[28px] block h-1 w-full max-w-[78%] rounded" style={{ backgroundColor: tint(primary, 0.4) }} />
        <span className="absolute inset-x-2 top-[38px] block h-1 w-full max-w-[60%] rounded" style={{ backgroundColor: tint(primary, 0.32) }} />
        <span className="absolute bottom-1 left-1/2 flex h-2.5 w-16 -translate-x-1/2 items-center justify-center rounded-full" style={{ backgroundColor: tint(accent, 0.4) }} />
        <span className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full" style={{ backgroundColor: tint(accent, 0.85) }} />
      </div>
    )
  }
  if (layout === 'paginated') {
    // 双列对开页 + 页码
    return (
      <div className="flex h-12 w-full gap-1.5 overflow-hidden rounded-md p-1.5" style={frame} aria-hidden>
        <span className="flex-1 space-y-1 rounded-sm p-1" style={{ backgroundColor: tint(primary, 0.14) }}>
          <span className="block h-1 w-3/4 rounded" style={{ backgroundColor: tint(primary, 0.6) }} />
          <span className="block h-0.5 w-full rounded" style={{ backgroundColor: tint(primary, 0.32) }} />
          <span className="block h-0.5 w-full rounded" style={{ backgroundColor: tint(primary, 0.32) }} />
          <span className="block h-0.5 w-5/6 rounded" style={{ backgroundColor: tint(primary, 0.32) }} />
        </span>
        <span className="flex-1 space-y-1 rounded-sm p-1" style={{ backgroundColor: tint(primary, 0.14) }}>
          <span className="block h-0.5 w-full rounded" style={{ backgroundColor: tint(primary, 0.32) }} />
          <span className="block h-0.5 w-full rounded" style={{ backgroundColor: tint(primary, 0.32) }} />
          <span className="block h-0.5 w-2/3 rounded" style={{ backgroundColor: tint(primary, 0.32) }} />
          <span className="ml-auto block h-1 w-6 rounded" style={{ backgroundColor: tint(accent, 0.65) }} />
        </span>
      </div>
    )
  }
  // classic: 居中窄栏纸面 + 三键导航
  return (
    <div className="flex h-12 w-full flex-col items-center overflow-hidden rounded-md px-4 py-1.5" style={frame} aria-hidden>
      <span className="block h-1.5 w-1/2 rounded" style={{ backgroundColor: tint(primary, 0.8) }} />
      <span className="mt-1 block h-0.5 w-1/3 rounded" style={{ backgroundColor: tint(primary, 0.45) }} />
      <span className="mt-1 block h-0.5 w-full max-w-[80%] rounded" style={{ backgroundColor: tint(primary, 0.26) }} />
      <span className="mt-0.5 block h-0.5 w-full max-w-[80%] rounded" style={{ backgroundColor: tint(primary, 0.26) }} />
      <span className="mt-1.5 flex w-full max-w-[80%] items-center justify-between">
        <span className="block h-1 w-8 rounded-sm" style={{ backgroundColor: tint(primary, 0.32) }} />
        <span className="block h-1 w-8 rounded-sm" style={{ backgroundColor: tint(accent, 0.7) }} />
        <span className="block h-1 w-8 rounded-sm" style={{ backgroundColor: tint(primary, 0.32) }} />
      </span>
    </div>
  )
}

interface ThemesSectionProps {
  onPreviewSite?: (themeId?: string) => void
}

export function ThemesSection({ onPreviewSite }: ThemesSectionProps) {
  const [themes, setThemes] = useState<ThemeRow[]>([])
  const [sites, setSites] = useState<SiteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ts, ss] = await Promise.all([api.get<ThemeRow[]>('/api/admin/themes'), api.get<SiteRow[]>('/api/admin/sites')])
      setThemes(Array.isArray(ts) ? ts : [])
      setSites(Array.isArray(ss) ? ss : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载主题失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
      load()
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
            <span className="text-xs font-normal text-zinc-500">(共 {themes.length} 套)</span>
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            每套主题独立配色/布局/字体, 可直接预览前台效果; 默认站点: {defaultSite ? defaultSite.name : '未设置'}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载主题…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {themes.map((t) => (
            <Card key={t.id} className={`overflow-hidden border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-700 ${isDefaultTheme(t.id) ? 'ring-1 ring-amber-500/40' : ''}`}>
              <CardContent className="p-0">
                <div className="flex h-2">
                  {t.preview.map((c, i) => (
                    <span key={i} className="h-full flex-1" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <div className="p-4">
                  {/* 阅读版式缩略示意(readLayout 维度 × 主题 preview 配色维度) */}
                  <ReadMiniPreview layout={t.read?.layout || 'classic'} preview={t.preview} />
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-100">{t.name}</span>
                    <div className="flex items-center gap-1.5">
                      {isDefaultTheme(t.id) && (
                        <Badge className="border-transparent bg-amber-500/15 text-[10px] text-amber-400">
                          <Star className="mr-0.5 h-2.5 w-2.5" />
                          默认
                        </Badge>
                      )}
                      <Badge variant="outline" className="border-zinc-700 bg-zinc-950 text-[10px] text-zinc-300">
                        {t.layout}
                      </Badge>
                      <Badge variant="outline" className="border-teal-800/70 bg-teal-500/10 text-[10px] text-teal-300">
                        阅读·{READ_LABEL[t.read?.layout || 'classic'] || t.read?.layout || 'classic'}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${t.dark ? 'border-zinc-600 bg-zinc-800 text-zinc-300' : 'border-zinc-700 bg-zinc-950 text-zinc-400'}`}>
                        {t.dark ? '暗色' : '亮色'}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1.5 min-h-8 text-xs leading-relaxed text-zinc-500">{t.desc}</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1 gap-1.5 border-zinc-700 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-800"
                      onClick={() => onPreviewSite?.(t.id)}
                    >
                      <ExternalLink className="h-3 w-3" />
                      预览前台
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1 gap-1.5 border-amber-500/40 bg-amber-500/10 text-xs text-amber-400 hover:bg-amber-500/20"
                      onClick={() => applyDefault(t)}
                      disabled={applying === t.id}
                    >
                      {applying === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className="h-3 w-3" />}
                      设为默认站点主题
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
