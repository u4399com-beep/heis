'use client'

// ============================================================
// 系统设置 — 下载默认站点信息 / 数据目录说明 / mini-service 配置
// ============================================================
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FolderOpen, Loader2, Save, Settings, Server, KeyRound, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { api, safeJsonParse } from './helpers'

interface DownloadSetting {
  siteName?: string
  siteUrl?: string
}

/** mini-service 配置形态: { xjp: { ywkey, ywguid }, qimao: { token }, ... } */
interface MiniServiceConfig {
  xjp?: { ywkey?: string; ywguid?: string }
  qimao?: { token?: string }
  deqixs?: { signKey?: string }
  bqg713?: { [k: string]: string }
  fetchRelay?: { [k: string]: string }
  scrapling?: { [k: string]: string }
}

/** 各 mini-service 的配置 schema(供 UI 动态渲染字段) */
const SERVICE_SCHEMAS: Array<{
  key: keyof MiniServiceConfig
  name: string
  port: number
  desc: string
  fields: Array<{ id: string; label: string; placeholder: string; type: 'text' | 'password' }>
}> = [
  {
    key: 'xjp',
    name: 'xjp-proxy',
    port: 3015,
    desc: '新键盘小说网正文解密代理 — 小雨/起点源需要 Ywkey/Ywguid 登录凭证才能采集正文',
    fields: [
      { id: 'ywkey', label: 'Ywkey', placeholder: '从登录后的请求头抓取', type: 'password' },
      { id: 'ywguid', label: 'Ywguid', placeholder: '从登录后的请求头抓取', type: 'password' },
    ],
  },
  {
    key: 'qimao',
    name: 'qimao-proxy',
    port: 3013,
    desc: '七猫官方 API 签名代理 — 如需访问付费内容需配置 token',
    fields: [
      { id: 'token', label: 'Token', placeholder: '七猫 API token(可选)', type: 'password' },
    ],
  },
  {
    key: 'deqixs',
    name: 'deqixs-proxy',
    port: 3014,
    desc: '得奇小说网正文签名代理 — 如需配置签名密钥',
    fields: [
      { id: 'signKey', label: 'SignKey', placeholder: '签名密钥(可选)', type: 'password' },
    ],
  },
]

export function SettingsSection() {
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [miniConfig, setMiniConfig] = useState<MiniServiceConfig>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingMini, setSavingMini] = useState(false)
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({})

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
        // mini-service 配置
        const mc = safeJsonParse<MiniServiceConfig>(
          typeof settings.miniServiceConfig === 'string' ? settings.miniServiceConfig : JSON.stringify(settings.miniServiceConfig ?? null),
          {},
        )
        setMiniConfig(mc || {})
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

  const saveMiniConfig = async () => {
    setSavingMini(true)
    try {
      await api.put('/api/admin/settings', { miniServiceConfig: miniConfig })
      toast.success('mini-service 配置已保存, 60秒内生效(缓存自动刷新)')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingMini(false)
    }
  }

  const updateField = (serviceKey: keyof MiniServiceConfig, fieldId: string, value: string) => {
    setMiniConfig((prev) => ({
      ...prev,
      [serviceKey]: { ...(prev[serviceKey] || {}), [fieldId]: value },
    }))
  }

  const toggleShow = (key: string) => {
    setShowSecret((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Settings className="h-5 w-5 text-violet-400" />
          系统设置
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">TXT 生成默认信息 / 数据目录 / mini-service 采集代理配置</p>
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

      {/* mini-service 配置区 */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
            <Server className="h-4 w-4 text-emerald-400" />
            Mini-service 采集代理配置
          </CardTitle>
          <CardDescription className="text-xs text-zinc-500">
            各 mini-service 的登录凭证 / 签名密钥等敏感配置。保存后 60 秒内生效(代理 60s 缓存自动刷新)。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : (
            <>
              <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-300">
                <strong className="font-semibold">⚠ 凭证获取说明:</strong>
                <ul className="mt-1.5 space-y-1 text-amber-200/80">
                  <li>• Ywkey/Ywguid: 登录目标站后, 打开浏览器开发者工具 → Network → 任意请求头复制</li>
                  <li>• 凭证会过期(通常 7-30 天), 失效后重新登录抓取并更新此处配置</li>
                  <li>• 凭证存储在 SQLite 数据库中, 仅主应用可读; mini-service 通过 BRIDGE_KEY 鉴权拉取</li>
                  <li>• 生产环境务必设置 <code className="rounded bg-amber-900/40 px-1">BRIDGE_KEY</code> 环境变量防止未授权访问</li>
                </ul>
              </div>

              {SERVICE_SCHEMAS.map((svc) => {
                const svcConfig = (miniConfig[svc.key] || {}) as Record<string, string>
                return (
                  <div key={svc.key} className="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <KeyRound className="h-3.5 w-3.5 text-violet-400" />
                          <span className="text-sm font-medium text-zinc-200">{svc.name}</span>
                          <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">:{svc.port}</code>
                        </div>
                        <p className="mt-0.5 text-[11px] text-zinc-500">{svc.desc}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {svc.fields.map((field) => {
                        const secretKey = `${svc.key}.${field.id}`
                        const isSecret = field.type === 'password' && !showSecret[secretKey]
                        return (
                          <div key={field.id} className="space-y-1.5">
                            <Label className="text-xs text-zinc-400">{field.label}</Label>
                            <div className="relative">
                              <Input
                                className="h-9 border-zinc-700 bg-zinc-950 font-mono text-xs pr-9"
                                type={isSecret ? 'password' : 'text'}
                                placeholder={field.placeholder}
                                value={svcConfig[field.id] || ''}
                                onChange={(e) => updateField(svc.key, field.id, e.target.value)}
                              />
                              {field.type === 'password' && (
                                <button
                                  type="button"
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                                  onClick={() => toggleShow(secretKey)}
                                  aria-label={showSecret[secretKey] ? '隐藏' : '显示'}
                                >
                                  {showSecret[secretKey] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              <Button size="sm" className="gap-1.5" onClick={saveMiniConfig} disabled={savingMini}>
                {savingMini ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                保存 mini-service 配置
              </Button>
            </>
          )}
        </CardContent>
      </Card>
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
