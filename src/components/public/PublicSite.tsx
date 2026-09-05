// ============================================================
// 前台站群站点渲染 SPA 主壳
// - 站点数据加载 + 主题应用（inline vars）
// - 内部视图路由（home/book/read/search/keyword/category）
// - window.history.replaceState 同步查询串
// - embedMode：顶栏站点切换 + 左下角返回后台悬浮按钮
// - 主题预览覆盖：仅首载入口解析 ?theme=<themeId>（后台主题卡片"预览前台"
//   深链），临时覆盖站点主题呈现在线预览；不入 viewToUrl/parseView 持久化，
//   站内 pushState 导航保持预览，切换站点即还原站点自身主题
// ============================================================
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftCircle, Eye } from 'lucide-react'
import { getTheme } from '@/lib/crawl/themes'
import { fetchSites } from './data'
import { parseView, PublicProvider, viewToUrl, type PublicCtxValue, type ViewParams } from './ctx'
import { useSiteSEO, withAlpha } from './seo'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { HomeView } from './HomeView'
import { BookView } from './BookView'
import { ReadView } from './ReadView'
import { SearchView } from './SearchView'
import { KeywordView } from './KeywordView'
import { CategoryView } from './CategoryView'
import { Sk } from './bits'
import type { SiteInfo } from './types'

export type { ViewParams, PublicView } from './ctx'

export default function PublicSite({
  initialSiteId,
  initialView,
  onBack,
  embedMode,
}: {
  initialSiteId?: string
  initialView?: { view: 'home' | 'book' | 'read' | 'search' | 'keyword' | 'category'; bookId?: string; chapterId?: string; q?: string; tag?: string; cat?: string; page?: number; theme?: string }
  onBack?: () => void
  embedMode?: boolean
}) {
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [siteId, setSiteId] = useState('')
  const [view, setView] = useState<ViewParams>(() => {
    // 深链保真: initialView 已是 parseView 同构的完整参数(cat/page 等), 逐字段透传
    // (原先硬捾 cat: undefined 使 /?view=category&cat=x 深链/刷新丢分类过滤, 而
    //  viewToUrl 自身序列化 cat、parseView 反解 cat —— 只丢首载入口一环)
    if (initialView) {
      // theme 是主题预览覆盖参数, 归 themeOverride state 管, 不混入视图路由参数
      const { theme: _themeOverride, ...rest } = initialView
      return rest as ViewParams
    }
    if (typeof window !== 'undefined') return parseView(window.location.search)
    return { view: 'home' }
  })
  const [loadErr, setLoadErr] = useState('')
  // 主题预览覆盖(?theme=): 仅首载入口参数, 不进 viewToUrl/parseView 持久化 ——
  // 站内导航保持预览; switchSite 切站即清除(语义: 预览只看这一主题, 切站还原)
  const [themeOverride, setThemeOverride] = useState<string | null>(() => {
    if (initialView?.theme) return initialView.theme
    if (typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.search).get('theme')
      if (t) return t
    }
    return null
  })

  // 挂载：加载站点列表并选定站点
  useEffect(() => {
    let alive = true
    const parsed = initialView ? ({ ...initialView } as ViewParams) : parseView(window.location.search)
    const wantedSite = initialSiteId || parsed.site || ''
    fetchSites()
      .then((list) => {
        if (!alive) return
        // ii-a 修复: 停用站点(status=false)不进前台 —— 站点选择 fallback 链与切换器
        // 均只在启用站内进行, 修前停用站仍可经默认站 fallback/切换器/深链直达
        const active = list.filter((x) => x.status !== false)
        setSites(active)
        // site 参数非法时兜底：默认站点 → 列表第一个，而不是白屏
        const s = active.find((x) => x.id === wantedSite) || active.find((x) => x.isDefault) || active[0]
        if (s) setSiteId(s.id)
        else setLoadErr('暂无可用站点，请先在后台创建站点')
      })
      .catch((e: Error) => {
        if (!alive) return
        setLoadErr(e.message || '站点加载失败')
      })
    return () => {
      alive = false
    }
  }, [])

  // 浏览器前进/后退：同步 URL → 内部 state（pushState 写入的历史可回退恢复）
  useEffect(() => {
    const onPop = () => {
      const p = parseView(window.location.search)
      setView(p)
      if (p.site && sites.some((s) => s.id === p.site)) setSiteId(p.site)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [sites])

  // 站内导航：setState + pushState（保留历史，后退可回上一视图）+ 回顶
  const navigate = useCallback(
    (p: ViewParams) => {
      setView(p)
      window.history.pushState(null, '', viewToUrl(p, siteId))
      window.scrollTo({ top: 0 })
    },
    [siteId],
  )

  // embedMode 站点切换：切站点回首页并带 site 参数；同时解除主题预览覆盖(还原站点自身主题)
  const switchSite = useCallback(
    (id: string) => {
      setSiteId(id)
      setThemeOverride(null)
      const p: ViewParams = { view: 'home', site: id }
      setView(p)
      window.history.pushState(null, '', viewToUrl(p, id))
      window.scrollTo({ top: 0 })
    },
    [],
  )

  const site = useMemo(() => sites.find((s) => s.id === siteId) || null, [sites, siteId])
  // 主题解析: 预览覆盖(?theme=)优先于站点自身主题; getTheme 对非法 id 自带回退
  const theme = useMemo(() => getTheme(themeOverride || site?.themeId), [themeOverride, site?.themeId])

  const ctxValue: PublicCtxValue | null = useMemo(
    () =>
      site
        ? {
            site,
            sites,
            theme,
            embedMode: !!embedMode,
            // embedMode 下切换器走 navigate({view:'home', site:id}) 也可；提供 switchSite 保持语义清晰
            navigate: (p) => {
              if (p.site && p.site !== site.id) {
                switchSite(p.site)
              } else {
                navigate(p)
              }
            },
          }
        : null,
    [site, sites, theme, embedMode, navigate, switchSite],
  )

  // 首屏加载期 SEO 兜底（仅站点未就绪时接管 head；站点就绪后完全退位给各视图，防止父子互覆盖）
  useSiteSEO({
    title: '站点加载中',
    site: null,
    enabled: !site,
  })

  /* ---------- 加载中 / 失败外壳 ---------- */
  if (loadErr) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#12121a] px-4 text-center" style={{ fontFamily: theme.vars.fontFamily }}>
        <p className="text-lg font-bold text-white">站点加载失败</p>
        <p className="text-sm text-white/60">{loadErr}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-white/10 px-5 py-2 text-sm text-white transition-opacity hover:opacity-80"
        >
          重新加载
        </button>
        {embedMode && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/60 transition-opacity hover:opacity-80"
            aria-label="返回后台"
          >
            <ArrowLeftCircle className="h-4 w-4" aria-hidden />
            返回后台
          </button>
        )}
      </div>
    )
  }

  if (!ctxValue || !site) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#12121a] px-4" style={{ fontFamily: theme.vars.fontFamily }}>
        <div className="flex items-center gap-2 text-sm text-white/70">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white/70" aria-hidden />
          正在进入阅读站…
        </div>
        <Sk className="mt-2 h-3 w-40" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
      </div>
    )
  }

  const v = theme.vars

  const renderView = () => {
    switch (view.view) {
      case 'book':
        return <BookView key={`book-${view.bookId || ''}-${site.id}`} bookId={view.bookId} tocPage={view.page || 1} />
      case 'read':
        return <ReadView key={`read-${view.chapterId || ''}`} chapterId={view.chapterId} />
      case 'search':
        return <SearchView key={`search-${view.q || ''}`} q={view.q} />
      case 'keyword':
        return <KeywordView key={`kw-${view.tag || ''}`} tag={view.tag} />
      case 'category':
        return <CategoryView key={`cat-${view.cat || ''}-${site.id}`} cat={view.cat} page={view.page || 1} />
      default:
        return <HomeView key={`home-${site.id}-${view.cat || ''}`} page={view.page || 1} cat={view.cat} />
    }
  }

  return (
    <PublicProvider value={ctxValue}>
      <div
        className="flex min-h-screen w-full flex-col"
        style={{
          background: v.bg,
          color: v.text,
          fontFamily: v.fontFamily,
          minHeight: '100vh',
        }}
      >
        <SiteHeader />
        <main className="w-full flex-1">{renderView()}</main>
        <SiteFooter />

        {embedMode && (
          <button
            type="button"
            onClick={onBack}
            className="fixed bottom-5 left-5 z-50 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold shadow-lg transition-transform hover:scale-105"
            style={{
              background: `linear-gradient(120deg, ${v.primary}, ${v.accent})`,
              color: v.primaryText,
              boxShadow: `0 8px 24px ${withAlpha(v.primary, 0.45)}`,
            }}
            aria-label="返回后台管理系统"
          >
            <ArrowLeftCircle className="h-4 w-4" aria-hidden />
            返回后台
          </button>
        )}

        {/* 主题预览指示胶囊: ?theme= 覆盖生效期间展示(不遮内容, 切站后随覆盖解除而消失) */}
        {embedMode && themeOverride && (
          <div
            className="fixed bottom-[72px] left-5 z-50 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-zinc-900/75 px-3 py-1 text-xs text-zinc-300 shadow-lg backdrop-blur"
            aria-label="主题预览指示"
          >
            <Eye className="h-3 w-3 text-teal-300" aria-hidden />
            预览主题：{theme.name}
          </div>
        )}
      </div>
    </PublicProvider>
  )
}
