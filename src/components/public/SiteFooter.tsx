// ============================================================
// 站群页脚 — 站名 / 描述 / 友情链接+站群链轮 / 备案风格文本，随 flex 布局置底
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import { Landmark, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { usePublic } from './ctx'
import { siteKeywordList, withAlpha } from './seo'
import { TagCloud, SuggestTagCloud } from './bits'
import { fetchFooterLinks, type FooterLinksData } from './data'

export function SiteFooter() {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const year = new Date().getFullYear()

  // 友链/链轮 — 客户端拉取, 失败静默降级不渲染模块
  const [footerLinks, setFooterLinks] = useState<FooterLinksData | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    let alive = true
    fetchFooterLinks(false, site.id).then((d) => {
      if (alive) setFooterLinks(d)
    })
    return () => {
      alive = false
    }
  }, [site.id])

  const refreshWheel = () => {
    if (refreshing) return
    setRefreshing(true)
    fetchFooterLinks(true, site.id)
      .then((d) => {
        if (d) setFooterLinks(d)
      })
      .finally(() => setRefreshing(false))
  }

  const hasFriend = !!footerLinks?.friend.length
  const hasWheel = !!footerLinks?.wheel.length
  return (
    <footer style={{ borderTop: `1px solid ${v.border}`, background: v.headerStyle === 'transparent' ? v.surface : 'transparent' }}>
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center text-xs font-black"
              style={{ background: `linear-gradient(135deg, ${v.primary}, ${v.accent})`, color: v.primaryText, borderRadius: v.radius }}
              aria-hidden
            >
              {site.name.slice(0, 1)}
            </span>
            <span className="text-sm font-bold" style={{ color: v.text }}>{site.title || site.name}</span>
            <span className="text-xs" style={{ color: v.textMuted }}>{site.domain}</span>
          </div>
          <nav className="flex items-center gap-4 text-xs" aria-label="页脚导航">
            <button type="button" onClick={() => navigate({ view: 'home' })} className="transition-opacity hover:opacity-70" style={{ color: v.textMuted }}>
              首页
            </button>
            <button type="button" onClick={() => navigate({ view: 'search', q: '' })} className="transition-opacity hover:opacity-70" style={{ color: v.textMuted }}>
              搜索
            </button>
            <button type="button" onClick={() => navigate({ view: 'category' })} className="transition-opacity hover:opacity-70" style={{ color: v.textMuted }}>
              更多书籍
            </button>
          </nav>
        </div>
        {site.description && (
          <p className="text-xs leading-relaxed" style={{ color: v.textMuted }}>{site.description}</p>
        )}
        <TagCloud tags={siteKeywordList(site)} />
        {/* 随机下拉词(页脚版: 12 个, 无换一批) */}
        <SuggestTagCloud count={12} />
        {footerLinks && (hasFriend || hasWheel) && (
          <nav
            aria-label="友情链接"
            className="space-y-1.5 text-xs leading-relaxed"
            style={{ color: v.textMuted, borderTop: `1px dashed ${withAlpha(v.border, 0.7)}`, paddingTop: 12 }}
          >
            {hasFriend && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="shrink-0 font-medium" style={{ color: v.text }}>
                  友情链接：
                </span>
                {footerLinks!.friend.map((l) => (
                  <a
                    key={l.id}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={l.name}
                    className="transition-opacity hover:opacity-70"
                  >
                    {l.name}
                  </a>
                ))}
              </div>
            )}
            {hasWheel && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="shrink-0 font-medium" style={{ color: v.text }}>
                  站群链轮：
                </span>
                {footerLinks!.wheel.map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener"
                    title={l.text}
                    className="transition-opacity hover:opacity-70"
                  >
                    {l.text}
                  </a>
                ))}
                <button
                  type="button"
                  onClick={refreshWheel}
                  disabled={refreshing}
                  aria-label="换一批链轮链接"
                  className="ml-1 inline-flex shrink-0 items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[11px] transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{ borderColor: withAlpha(v.border, 0.9) }}
                >
                  {refreshing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
                  换一批
                </button>
              </div>
            )}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: v.textMuted, borderTop: `1px dashed ${withAlpha(v.border, 0.7)}`, paddingTop: 12 }}>
          <span className="inline-flex items-center gap-1">
            <Landmark className="h-3 w-3" aria-hidden />
            © {year} {site.name} · {site.domain} · 保留所有权利
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            本站内容来自公开网络采集，仅作技术演示，如有侵权请联系删除
          </span>
          <span>GEO {site.geoRegion} · {site.geoPlacename}</span>
        </div>
      </div>
    </footer>
  )
}
