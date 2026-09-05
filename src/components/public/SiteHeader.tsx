// ============================================================
// 站点头部 — 站名 + 搜索框 + 分类导航 + (embedMode)站点切换器
// 按 theme.vars.headerStyle 呈现 5 种结构差异
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { ChevronDown, Compass, Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getTheme } from '@/lib/crawl/themes'
import { fetchCategories } from './data'
import { usePublic } from './ctx'
import { withAlpha } from './seo'
import type { CategoryItem } from './types'
import { Sk } from './bits'

function useCategories() {
  const [cats, setCats] = useState<CategoryItem[]>([])
  // pending 独立于数据：接口失败时也要退出骨架屏，避免导航区永久闪烁
  const [pending, setPending] = useState(true)
  useEffect(() => {
    let alive = true
    fetchCategories()
      .then((list) => {
        if (!alive) return
        setCats(list)
        setPending(false)
      })
      .catch(() => {
        if (!alive) return
        setCats([])
        setPending(false)
      })
    return () => {
      alive = false
    }
  }, [])
  return { cats, pending }
}

function SearchBox({ compact }: { compact?: boolean }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const [q, setQ] = useState('')
  const fire = () => navigate({ view: 'search', q: q.trim() })
  return (
    <form
      className={`flex items-center gap-2 ${compact ? 'w-44' : 'w-full max-w-md'}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        fire()
      }}
    >
      <div
        className="flex w-full items-center gap-2 px-3 py-1.5"
        style={{
          background: v.surface,
          border: `1px solid ${v.border}`,
          borderRadius: '999px',
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索书名 / 作者 / 关键词"
          className="w-full bg-transparent text-sm outline-none placeholder:opacity-60"
          style={{ color: v.text }}
          aria-label="站内搜索"
        />
        <button type="submit" aria-label="搜索" className="shrink-0 transition-opacity hover:opacity-75" style={{ color: v.primary }}>
          <Search className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </form>
  )
}

function CategoryNav({ cats, loading }: { cats: CategoryItem[]; loading: boolean }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  if (loading) {
    return (
      <div className="flex gap-3 py-1">
        {Array.from({ length: 6 }).map((_, i) => <Sk key={i} className="h-4 w-14" />)}
      </div>
    )
  }
  return (
    <nav className="flex items-center gap-1 overflow-x-auto pb-0.5" aria-label="分类导航">
      <button
        type="button"
        onClick={() => navigate({ view: 'home' })}
        className="shrink-0 rounded-full px-3 py-1 text-sm transition-opacity hover:opacity-80"
        style={{ color: v.primary, background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08) }}
      >
        全部
      </button>
      {cats.slice(0, 10).map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => navigate({ view: 'category', cat: c.id })}
          className="shrink-0 rounded-full px-3 py-1 text-sm transition-colors hover:opacity-80"
          style={{ color: v.text }}
        >
          {c.name}
          {c._count?.books ? <span className="ml-1 text-[10px] opacity-60">{c._count.books}</span> : null}
        </button>
      ))}
    </nav>
  )
}

/** 站点切换器（仅 embedMode 显示） */
function SiteSwitcher() {
  const { site, sites, theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
          style={{ background: withAlpha(v.primary, theme.dark ? 0.2 : 0.1), color: v.primary, border: `1px solid ${withAlpha(v.primary, 0.4)}` }}
          aria-label="切换站点"
        >
          <Compass className="h-3.5 w-3.5" aria-hidden />
          {site.name}
          <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        style={{ background: v.surface, border: `1px solid ${v.border}`, color: v.text, borderRadius: v.radius }}
      >
        {/* ii-a 修复: 停用站点(status=false)不进切换器(防御性过滤, 上游 PublicSite 已滤) */}
        {sites.filter((x) => x.status !== false).map((s) => {
          const t = getTheme(s.themeId)
          const active = s.id === site.id
          return (
            <DropdownMenuItem
              key={s.id}
              onClick={() => navigate({ view: 'home', site: s.id })}
              style={{ color: active ? v.primary : v.text, fontSize: 13 }}
              aria-label={`切换到站点 ${s.name}`}
            >
              <span className="flex overflow-hidden rounded-full" style={{ width: 26, height: 12 }} aria-hidden>
                {t.preview.map((c, i) => <span key={i} className="h-full flex-1" style={{ background: c }} />)}
              </span>
              <span className="truncate">{s.name}</span>
              <span className="ml-auto text-[10px] opacity-60">{t.name}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** pili 搜索框 — 复古直角输入 + 橙色方块提交钮（原站 mod-top-search DNA） */
function PiliSearchBox({ compact }: { compact?: boolean }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const [q, setQ] = useState('')
  return (
    <form
      className={`flex items-stretch ${compact ? 'w-full max-w-xs' : 'w-full max-w-md'}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        navigate({ view: 'search', q: q.trim() })
      }}
    >
      <div
        className="flex w-full items-center border border-r-0 px-3"
        style={{ borderColor: '#e0b070', background: v.surface, borderRadius: `${v.radius} 0 0 ${v.radius}` }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="可搜索小说名 / 作者名"
          className="h-9 w-full bg-transparent text-sm outline-none placeholder:opacity-55"
          style={{ color: v.text }}
          aria-label="站内搜索"
        />
      </div>
      <button
        type="submit"
        className="shrink-0 px-4 text-sm font-bold transition-opacity hover:opacity-85"
        style={{ background: `linear-gradient(180deg, ${v.primary}, #e96c07)`, color: v.primaryText, borderRadius: `0 ${v.radius} ${v.radius} 0` }}
        aria-label="搜索"
      >
        搜索
      </button>
    </form>
  )
}

/** pili 奶油渐变分类导航条（原站 mod-top-nav-wr DNA: 奶油底棕字 + 首项高亮） */
function PiliCategoryNav({ cats, loading }: { cats: CategoryItem[]; loading: boolean }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const item = 'shrink-0 whitespace-nowrap px-3.5 py-2 text-sm font-medium transition-colors min-h-[44px] inline-flex items-center'
  return (
    <nav
      data-pili-nav
      className="overflow-x-auto border-y"
      style={{
        background: 'linear-gradient(180deg, #fff5e5, #fee9c4)',
        borderColor: '#eed3a4',
      }}
      aria-label="分类导航"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center px-2 sm:px-4">
        <button
          type="button"
          onClick={() => navigate({ view: 'home' })}
          className={`${item} font-bold`}
          style={{ color: '#7d360f', background: 'linear-gradient(180deg, #ffdca0, #ffefd3)', boxShadow: 'inset 0 0 0 1px #e8bd7d' }}
          aria-label="返回首页"
        >
          首页
        </button>
        {loading ? (
          <span className="flex items-center gap-3 px-3 py-2">
            {Array.from({ length: 6 }).map((_, i) => <Sk key={i} className="h-4 w-14" style={{ backgroundColor: 'rgba(125,54,15,0.12)' }} />)}
          </span>
        ) : (
          cats.slice(0, 12).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate({ view: 'category', cat: c.id })}
              className={`${item} hover:underline`}
              style={{ color: '#7d360f' }}
              aria-label={`浏览 ${c.name} 分类`}
            >
              {c.name}
              {c._count?.books ? <span className="ml-1 text-[10px] opacity-60">{c._count.books}</span> : null}
            </button>
          ))
        )}
      </div>
    </nav>
  )
}

/** pili 头部 — 白底 logo+搜索+右侧按钮, 下方奶油渐变分类条 */
function PiliHeader({ cats, pending }: { cats: CategoryItem[]; pending: boolean }) {
  const { theme, embedMode, navigate } = usePublic()
  const v = theme.vars
  return (
    <div data-pili-header>
      <div style={{ background: v.surface, borderBottom: '1px solid #f0e6d2' }}>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <SiteMark />
          <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1 sm:px-6">
            <div className="mx-auto sm:max-w-md">
              <PiliSearchBox />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* pili 复古顶钮: 充值风奶油按钮(浏览全部) */}
            <button
              type="button"
              onClick={() => navigate({ view: 'category' })}
              className="hidden min-h-[36px] items-center border px-3.5 text-sm font-bold transition-colors hover:brightness-105 sm:inline-flex"
              style={{ borderColor: '#cc6007', background: '#fbe4bb', color: '#7d360f', borderRadius: v.radius }}
              aria-label="浏览全部小说分类"
            >
              全部小说
            </button>
            {embedMode && <SiteSwitcher />}
          </div>
        </div>
      </div>
      <PiliCategoryNav cats={cats} loading={pending} />
    </div>
  )
}

function SiteMark() {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <button
      type="button"
      onClick={() => navigate({ view: 'home' })}
      className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
      aria-label={`返回 ${site.name} 首页`}
    >
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black"
        style={{ background: `linear-gradient(135deg, ${v.primary}, ${v.accent})`, color: v.primaryText, borderRadius: v.radius }}
        aria-hidden
      >
        {site.name.slice(0, 1)}
      </span>
      <span
        className="text-lg font-bold tracking-wide"
        style={{ color: v.text, fontFamily: v.titleFont }}
      >
        {site.name}
      </span>
    </button>
  )
}

export function SiteHeader() {
  const { theme, embedMode } = usePublic()
  const v = theme.vars
  const { cats, pending } = useCategories()

  const headerBg: CSSProperties =
    v.headerStyle === 'gradient'
      ? { background: `linear-gradient(120deg, ${withAlpha(v.primary, theme.dark ? 0.24 : 0.14)}, ${withAlpha(v.accent, theme.dark ? 0.16 : 0.1)})` }
      : v.headerStyle === 'solid'
        ? { background: v.surface }
        : v.headerStyle === 'centered'
          ? { background: v.surface }
          : { background: 'transparent' }

  const bottomBorder = v.headerStyle === 'pili'
    ? 'none' // pili 自带报头分隔线+分类条边框, 不叠外层 border
    : `1px solid ${v.headerStyle === 'transparent' ? withAlpha(v.border, 0.5) : v.border}`

  return (
    <header style={{ ...headerBg, borderBottom: bottomBorder, backdropFilter: v.headerStyle === 'gradient' ? 'blur(10px)' : undefined }}>
      {v.headerStyle === 'pili' ? (
        // 白底报头 + 奶油渐变分类条（pili 霹雳书屋）
        <PiliHeader cats={cats} pending={pending} />
      ) : v.headerStyle === 'centered' ? (
        // 报头居中式（paper）：站名居中 + 搜索居中 + 分类导航居中
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-4 py-5">
          {embedMode && (
            <div className="flex w-full justify-end">
              <SiteSwitcher />
            </div>
          )}
          <SiteMark />
          <SearchBox />
          <div className="w-full">
            <div className="flex justify-center">
              <CategoryNav cats={cats} loading={pending} />
            </div>
          </div>
        </div>
      ) : v.headerStyle === 'split' ? (
        // 左右分列式（bamboo）：极简细线
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-5">
            <SiteMark />
            <div className="hidden sm:block"><SearchBox compact /></div>
            {embedMode && <SiteSwitcher />}
          </div>
          <div className="border-t py-2" style={{ borderColor: withAlpha(v.border, 0.6) }}>
            <CategoryNav cats={cats} loading={pending} />
          </div>
        </div>
      ) : (
        // 常规两行式（solid/gradient/transparent）：上行 站名+搜索+切换，下行分类
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <SiteMark />
            <div className="hidden md:block"><SearchBox /></div>
            <div className="flex items-center gap-2">
              {/* md 以下用紧凑搜索框（原 sm 断点会在平板区间丢失搜索入口） */}
              <div className="md:hidden"><SearchBox compact /></div>
              {embedMode && <SiteSwitcher />}
            </div>
          </div>
          <div className="pb-2">
            <CategoryNav cats={cats} loading={pending} />
          </div>
        </div>
      )}
    </header>
  )
}
