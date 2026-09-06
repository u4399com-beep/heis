// ============================================================
// 首页视图 — 随机下拉词 + 6 分类图文卡 + 排序切换 + 按 theme.layout 分发 6 种布局（全主题去分页, 一次拉 48 本）
// ============================================================
'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowDownWideNarrow, Flame, Hash, Home } from 'lucide-react'
import { fetchBooks, type BooksData } from './data'
import { usePublic } from './ctx'
import { siteKeywordList, useSiteSEO, withAlpha } from './seo'
import { EmptyState, ErrorState, SuggestTagCloud, TagCloud } from './bits'
import { CategoryShowcase } from './CategoryShowcase'
// 默认主题 aurora → shelf: 首屏保证, 保持静态 import; 其余 6 布局按需分包(ab-d 懒加载试点)
// —— 布局仅在本组件内引用且站点/主题经客户端 fetch 获知, SSR 首屏只会命中 shelf,
//    非默认布局只会在数据到达后的客户端渲染分支中触发 chunk 拉取, 无首屏闪烁/CLS 回归面
import { HomeShelf } from './layouts/HomeShelf'
const HomeList = dynamic(() => import('./layouts/HomeList').then((m) => m.HomeList))
const HomeGrid = dynamic(() => import('./layouts/HomeGrid').then((m) => m.HomeGrid))
const HomeMinimal = dynamic(() => import('./layouts/HomeMinimal').then((m) => m.HomeMinimal))
const HomeMagazine = dynamic(() => import('./layouts/HomeMagazine').then((m) => m.HomeMagazine))
const HomeTheater = dynamic(() => import('./layouts/HomeTheater').then((m) => m.HomeTheater))
const HomePili = dynamic(() => import('./layouts/HomePili').then((m) => m.HomePili))
import type { BookItem } from './types'

interface FetchState {
  key: string
  data?: BooksData
  error?: string
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
      .then((d) => {
        if (!alive) return
        setState({ key, data: d })
      })
      .catch((e: Error) => {
        if (!alive) return
        setState({ key, error: e.message })
      })
    return () => {
      alive = false
    }
  }, [key, site.id, cat, sort, page])

  const loading = !state || state.key !== key
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''

  const catName = cat ? data?.books[0]?.category || '当前分类' : ''

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  useSiteSEO({
    title: site.title || `${site.name} - 精品小说在线阅读`,
    description: site.description || `${site.name}提供各类小说在线阅读`,
    keywords: site.keywords || '小说,在线阅读',
    canonicalPath: cat ? `/?cat=${cat}&site=${site.id}` : `/?site=${site.id}`,
    site,
    jsonLd: useMemo(
      () => [
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: site.name,
          url: `${origin}/`,
          description: site.description,
          inLanguage: 'zh-CN',
          potentialAction: {
            '@type': 'SearchAction',
            target: `${origin}/?view=search&q={search_term_string}&site=${site.id}`,
            'query-input': 'required name=search_term_string',
          },
        },
      ],
      [origin, site.id, site.name, site.description],
    ),
  })

  const books: BookItem[] = data?.books || []

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* 页头区: 随机下拉词(全站搜索热词) + 换一批 */}
      <section className="mb-5" aria-label="搜索热词">
        <SuggestTagCloud count={16} refresh />
      </section>

      {/* 6 分类图文卡(代表书封面) */}
      <div className="mb-6">
        <CategoryShowcase />
      </div>

      {/* 排序切换 + 分类筛选提示 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSort('latest')
              navigate({ view: 'home', cat, page: 1 })
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              background: sort === 'latest' ? v.primary : v.surface,
              color: sort === 'latest' ? v.primaryText : v.text,
              border: `1px solid ${sort === 'latest' ? v.primary : v.border}`,
              borderRadius: v.radius,
            }}
            aria-pressed={sort === 'latest'}
          >
            <Home className="h-3.5 w-3.5" aria-hidden />
            最新更新
          </button>
          <button
            type="button"
            onClick={() => {
              setSort('words')
              navigate({ view: 'home', cat, page: 1 })
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              background: sort === 'words' ? v.primary : v.surface,
              color: sort === 'words' ? v.primaryText : v.text,
              border: `1px solid ${sort === 'words' ? v.primary : v.border}`,
              borderRadius: v.radius,
            }}
            aria-pressed={sort === 'words'}
          >
            <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />
            字数最多
          </button>
        </div>
        {cat && (
          <button
            type="button"
            onClick={() => navigate({ view: 'home' })}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
            style={{ background: withAlpha(v.accent, 0.14), color: v.accent, border: `1px solid ${withAlpha(v.accent, 0.4)}` }}
            aria-label="清除分类筛选"
          >
            分类：{catName} · 点击清除
          </button>
        )}
      </div>

      {error ? (
        <ErrorState message="书籍列表加载失败" detail={error} />
      ) : !loading && !books.length && !data ? (
        <EmptyState />
      ) : !loading && !books.length ? (
        <EmptyState text="本页暂无书籍" hint="换个分类或翻页看看" />
      ) : (
        <>
          {theme.layout === 'shelf' && <HomeShelf books={books} loading={loading} />}
          {theme.layout === 'list' && <HomeList books={books} loading={loading} />}
          {theme.layout === 'grid' && <HomeGrid books={books} loading={loading} />}
          {theme.layout === 'minimal' && <HomeMinimal books={books} loading={loading} />}
          {theme.layout === 'magazine' && <HomeMagazine books={books} loading={loading} />}
          {theme.layout === 'theater' && <HomeTheater books={books} loading={loading} />}
          {theme.layout === 'pili' && <HomePili books={books} loading={loading} />}
        </>
      )}

      {/* 热门标签云 */}
      {!loading && books.length > 0 && (
        <section className="pt-8" aria-label="热门标签">
          <div className="mb-3 flex items-center gap-2">
            <Hash className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: v.text }}>热门标签</h2>
            <Flame className="h-3.5 w-3.5" style={{ color: v.accent }} aria-hidden />
          </div>
          <TagCloud tags={siteKeywordList(site)} />
        </section>
      )}
    </div>
  )
}
