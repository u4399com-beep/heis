'use client'

// ============================================================
// 系统设置 — 下载默认站点信息 / 数据目录说明
// ============================================================
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FolderOpen, Loader2, Save, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { api, safeJsonParse } from './helpers'

interface DownloadSetting {
  siteName?: string
  siteUrl?: string
}

export function SettingsSection() {
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const settings = await api.get<Record<string, unknown>>('/api/admin/settings')
        const dl = safeJsonParse<DownloadSetting>(
          typeof settings.download === 'string' ? settings.download : JSON.stringify(settings.download ?? null),
          {},
        )
        setSiteName(dl.siteName || '')
        setSiteUrl(dl.siteUrl || '')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载设置失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/admin/settings', { download: { siteName, siteUrl } })
      toast.success('设置已保存')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Settings className="h-5 w-5 text-violet-400" />
          系统设置
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">TXT 生成时的默认站点信息与数据目录说明</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-zinc-200">下载默认站点信息</CardTitle>
            <CardDescription className="text-xs text-zinc-500">TXT 生成表单将预填此处配置的站点名称与域名</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">站点名称</Label>
                  <Input className="h-9 border-zinc-700 bg-zinc-950 text-sm" placeholder="例: 笔趣阁" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">站点域名 / 地址</Label>
                  <Input className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs" placeholder="www.example.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
                </div>
                <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  保存设置
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <FolderOpen className="h-4 w-4 text-amber-400" />
              数据目录说明
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500">TXT 存储模式与封面转存的落盘位置</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-2.5">
              <DirRow dir="data/novels" desc="章节 TXT 存储 — 每本书一个子文件夹, 每章一个 txt 文件" />
              <DirRow dir="data/covers" desc="封面存储 — 采集的封面图自动转为 webp 格式" />
              <DirRow dir="data/downloads" desc="下载成品 — 合成后的完整 TXT 电子书文件" />
              <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-500">
                提示: 数据库存储模式下章节正文保存在 SQLite 中, 无需依赖文件目录; TXT 模式的章节会在采集时同步落盘,
                删除书籍时会连带清理对应文件夹。
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function DirRow({ dir, desc }: { dir: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      <code className="shrink-0 rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-emerald-400">{dir}</code>
      <span className="text-xs text-zinc-400">{desc}</span>
    </div>
  )
}
