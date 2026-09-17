// ============================================================
// 首页视图 — 随机下拉词 + 6 分类图文卡 + 排序切换 + 按 theme.layout 分发 10 种 clone-* 布局
// (全主题去分页, 一次拉 48 本)
// R10-1A: 废弃 theme-matrix 1728 组合 + 17 旧 preset; 改为 9 套精仿 clone-* 布局
// R11-1B: 扩充至 10 套 (新增 clone-trxsw 天人小说)
// R12-1: 删除 clone-trxsw, 重写 9 套 preset 基于真实抓取的 CSS 变量
// R13-1B: 重新克隆 10 个站点主题 (含 trxsw): 恢复 clone-trxsw 基于 AiraBrowser 反查 DOM
// R14-1A: 全量重克隆 10 个站点主题含子页面 DOM; 10 个 HomeClone*.tsx + 10 套 BookInfoLayout
// R15-1B: 拆为 10 套 clone-themes/<site>/{HomeClone,BookInfo,CategoryList,ReadChrome,index.ts}, 删除 BookInfoLayout.tsx + 旧 10 个 HomeClone*.tsx
// R19-1B: clone-themes 由 R19-1A 重建, 此处恢复 10 个 dynamic import + 按 theme.layout 分发
//         透传 site.navCategoryCount/site.homeModuleLimit 给 HomeClone (R16 站点配置项)
// ============================================================
'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowDownWideNarrow, Home as HomeIcon } from 'lucide-react'
import { fetchBooks, type BooksData } from './data'
import { usePublic } from './ctx'
import { siteKeywordList, useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { EmptyState, ErrorState, SuggestTagCloud, TagCloud, BookGridSkeleton, bookNavProps, StatusBadge } from './bits'
import { CategoryShowcase } from './CategoryShowcase'
import { BookCover } from './BookCover'
import { formatWords } from './seo'
import type { BookItem } from './types'

// R15-1B: 10 个 clone-themes/<site>/HomeClone 懒加载分包 (硬编码颜色, 不用 theme.vars)
// R19-1B 接线: clone-themes 由 R19-1A 重建, 此处恢复 dynamic import
const HomeCloneAijjxs = dynamic(() => import('./clone-themes/aijjxs').then((m) => m.HomeClone))
const HomeCloneDdyueshu = dynamic(() => import('./clone-themes/ddyueshu').then((m) => m.HomeClone))
const HomeClonePilishuwu = dynamic(() => import('./clone-themes/pilishuwu').then((m) => m.HomeClone))
const HomeClone23qb = dynamic(() => import('./clone-themes/23qb').then((m) => m.HomeClone))
const HomeClone101kks = dynamic(() => import('./clone-themes/101kks').then((m) => m.HomeClone))
const HomeCloneHuangjinwu = dynamic(() => import('./clone-themes/huangjinwu').then((m) => m.HomeClone))
const HomeCloneGgd66 = dynamic(() => import('./clone-themes/ggd66').then((m) => m.HomeClone))
const HomeCloneShipsay = dynamic(() => import('./clone-themes/shipsay').then((m) => m.HomeClone))
const HomeCloneX2552 = dynamic(() => import('./clone-themes/x2552').then((m) => m.HomeClone))
const HomeCloneTrxsw = dynamic(() => import('./clone-themes/trxsw').then((m) => m.HomeClone))

// 已知 clone-* layout 列表 (用于 unknown 布局兜底判定)
const CLONE_LAYOUTS = [
  'clone-aijjxs',
  'clone-ddyueshu',
  'clone-pilishuwu',
  'clone-23qb',
  'clone-101kks',
  'clone-huangjinwu',
  'clone-ggd66',
  'clone-shipsay',
  'clone-x2552',
  'clone-trxsw',
] as const

interface FetchState { key: string; data?: BooksData; error?: string }

/** R19 通用网格兜底 — 重建窗口期保证前台不白屏 (未知 layout 时回退) */
function GenericBookGrid({ books, loading }: { books: BookItem[]; loading: boolean }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  if (loading) return <BookGridSkeleton count={12} />
  if (!books.length) return <EmptyState />
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {books.map((b) => (
        <article
          key={b.id}
          className="group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1.5"
          style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow }}
          {...bookNavProps(navigate, b.id)}
          aria-label={`查看《${b.name}》详情`}
        >
          <div className="relative">
            <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
            <span className="absolute left-2 top-2"><StatusBadge status={b.status} small /></span>
            <span className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: withAlpha(v.primaryText, 0.9), color: v.primary }}>
              {formatWords(b.wordCount)}
            </span>
          </div>
          <div className="space-y-1 p-3">
            <h3 className="line-clamp-1 text-sm font-bold" style={{ color: v.text }}>{b.name}</h3>
            <p className="line-clamp-1 text-xs" style={{ color: v.textMuted }}>{b.author}</p>
            <p className="line-clamp-1 text-[11px]" style={{ color: v.textMuted }}>
              <span className="mr-1 rounded-full px-1.5 py-px" style={{ background: v.surfaceAlt, color: v.accent }}>{b.category}</span>
              {b.latestChapter || '暂无章节'}
            </p>
          </div>
        </article>
      ))}
    </div>
  )
}

export function HomeView({ page, cat }: { page: number; cat?: string }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [sort, setSort] = useState<'latest' | 'words'>('latest')
  const [state, setState] = useState<FetchState | null>(null)
  const key = `${site.id}|${cat || ''}|${sort}|${page}`

  useEffect(() => {
    let alive = true
    fetchBooks({ site: site.id, cat, sort, page, size: 48 })
      .then(d => { if (alive) setState({ key, data: d }) })
      .catch((e: Error) => { if (alive) setState({ key, error: e.message }) })
    return () => { alive = false }
  }, [key, site.id, cat, sort, page])

  const loading = !state || state.key !== key
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''
  const catName = cat ? data?.books[0]?.category || '当前分类' : ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  useSiteSEO({
    title: site.title || generateTitle({ siteName: site.name, category: catName || undefined }),
    description: site.description || generateMetaDescription({ siteName: site.name, category: catName || undefined, intro: '精品小说在线阅读' }),
    keywords: site.keywords || generateKeywords({ siteName: site.name, category: catName || undefined }),
    canonicalPath: cat ? `/?cat=${cat}&site=${site.id}` : `/?site=${site.id}`,
    site,
    jsonLd: useMemo(() => [{
      '@context': 'https://schema.org', '@type': 'WebSite',
      name: site.name, url: `${origin}/`, description: site.description, inLanguage: 'zh-CN',
      potentialAction: { '@type': 'SearchAction', target: `${origin}/?view=search&q={search_term_string}&site=${site.id}`, 'query-input': 'required name=search_term_string' },
    }], [origin, site.id, site.name, site.description]),
  })

  const books: BookItem[] = data?.books || []
  // R19-1B: 透传 site.navCategoryCount/site.homeModuleLimit 给 HomeClone (R16 站点配置项)
  const navCategoryCount = site.navCategoryCount
  const homeModuleLimit = site.homeModuleLimit

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <section className="mb-5"><SuggestTagCloud count={16} refresh /></section>
      <div className="mb-6"><CategoryShowcase /></div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setSort('latest'); navigate({ view: 'home', cat, page: 1 }) }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ background: sort === 'latest' ? v.primary : v.surface, color: sort === 'latest' ? v.primaryText : v.text, border: `1px solid ${sort === 'latest' ? v.primary : v.border}`, borderRadius: v.radius }}
            aria-pressed={sort === 'latest'}><HomeIcon className="h-3.5 w-3.5" aria-hidden />最新更新</button>
          <button type="button" onClick={() => { setSort('words'); navigate({ view: 'home', cat, page: 1 }) }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ background: sort === 'words' ? v.primary : v.surface, color: sort === 'words' ? v.primaryText : v.text, border: `1px solid ${sort === 'words' ? v.primary : v.border}`, borderRadius: v.radius }}
            aria-pressed={sort === 'words'}><ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />字数最多</button>
        </div>
        {cat && <button type="button" onClick={() => navigate({ view: 'home' })}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
          style={{ background: withAlpha(v.accent, 0.14), color: v.accent, border: `1px solid ${withAlpha(v.accent, 0.4)}` }}
          aria-label="清除分类筛选">分类：{catName} · 点击清除</button>}
      </div>
      {error ? <ErrorState message="书籍列表加载失败" detail={error} /> : (
        <>
          {/* R15-1B: 10 套 clone-themes/<site>/HomeClone 按 theme.layout 分发 (硬编码颜色, 不用 theme.vars)
              R19-1B 接线: clone-themes 由 R19-1A 重建, 此处恢复 10 个 dynamic import + 分发分支
              透传 navCategoryCount/homeModuleLimit (R16 站点配置项) */}
          {theme.layout === 'clone-aijjxs' && <HomeCloneAijjxs books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {theme.layout === 'clone-ddyueshu' && <HomeCloneDdyueshu books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {theme.layout === 'clone-pilishuwu' && <HomeClonePilishuwu books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {theme.layout === 'clone-23qb' && <HomeClone23qb books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {theme.layout === 'clone-101kks' && <HomeClone101kks books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {theme.layout === 'clone-huangjinwu' && <HomeCloneHuangjinwu books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {theme.layout === 'clone-ggd66' && <HomeCloneGgd66 books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {theme.layout === 'clone-shipsay' && <HomeCloneShipsay books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {theme.layout === 'clone-x2552' && <HomeCloneX2552 books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {theme.layout === 'clone-trxsw' && <HomeCloneTrxsw books={books} loading={loading} navCategoryCount={navCategoryCount} homeModuleLimit={homeModuleLimit} />}
          {/* R19-1B: 兜底 — 未知 layout/loading 期无任何布局命中时用 GenericBookGrid (重建窗口期保证不白屏) */}
          {!CLONE_LAYOUTS.includes(theme.layout as typeof CLONE_LAYOUTS[number]) && (
            <GenericBookGrid books={books} loading={loading} />
          )}
        </>
      )}
      {!loading && books.length > 0 && (
        <section className="pt-8" aria-label="热门标签">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-bold tracking-widest" style={{ color: v.text }}>热门标签</span>
          </div>
          <TagCloud tags={siteKeywordList(site)} />
        </section>
      )}
    </div>
  )
}
